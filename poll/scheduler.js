// Person B: scheduler. Runs INSIDE the bot process: the bot calls startScheduler(bot) once at startup,
// passing its own functions, so poll/ never imports bot/.
//   bot = { postPollCard, postSummary, postMenuCard, sendReminder, getMembers }  (all async, may throw)
// Normal mode: checks every 30s against getSchedule() (HR can change it any time, no restart).
// Demo mode (env POLL_DEMO=1): every step (default 60s, env POLL_DEMO_STEP_SECONDS) runs post → remind → close.
const fs = require('fs');
const path = require('path');
const p = require('./poll');
const announce = require('./announce');

// Asia/Kolkata is a fixed +05:30 (no DST), so plain offset math is exact.
const OFFSET = 330 * 60000, MIN = 60000, DAY = 1440 * MIN;
const toLocal = (ms) => new Date(ms + OFFSET).toISOString().slice(0, 19); // "YYYY-MM-DDTHH:mm:ss"
const toMs = (local) => Date.parse(local + 'Z') - OFFSET;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Latest moment <= nowMs that falls on {day, time}.
function lastOccurrence({ day, time }, nowMs) {
  for (let i = 0; i <= 7; i++) {
    const date = toLocal(nowMs - i * DAY).slice(0, 10);
    const ms = toMs(`${date}T${time}:00`);
    if (WEEKDAYS[new Date(date + 'T00:00:00Z').getUTCDay()] === day && ms <= nowMs) return ms;
  }
}
// Earliest moment > fromMs that falls on {day, time}.
function nextOccurrence({ day, time }, fromMs) {
  for (let i = 0; i <= 7; i++) {
    const date = toLocal(fromMs + i * DAY).slice(0, 10);
    const ms = toMs(`${date}T${time}:00`);
    if (WEEKDAYS[new Date(date + 'T00:00:00Z').getUTCDay()] === day && ms > fromMs) return ms;
  }
}
// Monday on or after a date (Sunday post → next day's week).
function mondayOnOrAfter(date) {
  const ms = toMs(date + 'T00:00:00');
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  return toLocal(ms + ((8 - dow) % 7) * DAY).slice(0, 10);
}
const plusDays = (date, n) => toLocal(toMs(date + 'T00:00:00') + n * DAY).slice(0, 10);

// Bot functions throw if posting fails: log and carry on.
async function call(bot, fn, ...args) {
  try { return await bot[fn](...args); }
  catch (e) { console.error(`[scheduler] ${fn} failed:`, e.message); }
}

async function remind(bot, poll) {
  const members = await call(bot, 'getMembers');
  if (!members) return;
  const nonVoters = await p.getNonVoters(poll.pollId, members);
  if (nonVoters.length) await call(bot, 'sendReminder', poll, nonVoters);
}

async function postNew(bot, type, opts, closesAt, menu) {
  const poll = await p.createPoll(type, { ...opts, closesAt });
  if (menu) await call(bot, 'postMenuCard', menu);
  await call(bot, 'postPollCard', poll);
  return poll;
}

const KINDS = { weekly: 'weekly_attendance', friday: 'friday_diet' };
const WEEKLY_REMIND_FROM = '09:00', WEEKLY_REMIND_TO = '21:00'; // Asia/Kolkata, inclusive (agreed with Person A)
const lastReminded = new Map(); // pollId -> minute already reminded (avoids double fire within a minute)

// One check. Exported for tests; nowMs injectable.
async function tick(bot, nowMs = Date.now()) {
  const sched = await p.getSchedule();

  // Post: if we're inside a post→close window and this cycle's poll doesn't exist yet, create + post it.
  // (Also catches up if the bot was down at post time. A manually started poll with the same pollId is left alone.)
  for (const [kind, type] of Object.entries(KINDS)) {
    const s = sched[kind];
    const postMs = lastOccurrence(s.post, nowMs);
    const closeMs = nextOccurrence(s.close, postMs);
    if (nowMs >= closeMs) continue;
    const postDate = toLocal(postMs).slice(0, 10);
    let opts, menu = null;
    if (kind === 'weekly') {
      const weekStart = mondayOnOrAfter(postDate);
      opts = { weekStart, weekEnd: plusDays(weekStart, 4) };
      menu = await p.getMenu(weekStart);
    } else {
      opts = { date: postDate };
    }
    if (await p.getPoll(`${type}-${opts.weekStart || opts.date}`)) continue;
    await postNew(bot, type, opts, toLocal(closeMs), menu);
  }

    // Recurring announcements (HR-defined text at a set time on set days). Optional bot function.
  if (bot.postAnnouncement) {
    const local = toLocal(nowMs);
    for (const a of await announce.due(local, new Date(local.slice(0, 10) + 'T00:00:00Z').getUTCDay())) await call(bot, 'postAnnouncement', a);
  }

  // Close and remind every open poll that has a closesAt (polls with closesAt null are left to manual commands).
  for (const poll of await p.getOpenPolls()) {
    if (!poll.closesAt) continue;
    const closeMs = toMs(poll.closesAt);
    if (nowMs >= closeMs) {
      await call(bot, 'postSummary', await p.closePoll(poll.pollId));
      continue;
    }
    const hhmm = toLocal(nowMs).slice(11, 16);
    let startMs;
    if (poll.type === 'custom') {
      // Custom polls: reminders start one interval after the poll was created, same 09:00–21:00 window as weekly.
      startMs = toMs(poll.createdAt) + sched.remindEveryMinutes * MIN;
      if (nowMs < startMs) continue;
      if (hhmm < WEEKLY_REMIND_FROM || hhmm > WEEKLY_REMIND_TO) continue;
    } else {
      const kind = poll.type === 'weekly_attendance' ? 'weekly' : 'friday';
      startMs = lastOccurrence(sched[kind].remind, nowMs);
      if (closeMs - startMs >= 7 * DAY) continue; // reminder start belongs to a different cycle
      if (kind === 'weekly' && (hhmm < WEEKLY_REMIND_FROM || hhmm > WEEKLY_REMIND_TO)) continue; // no weekly reminders at night
    }
    const minute = Math.floor(nowMs / MIN);
    // ponytail: exact-minute match; a reminder slot is skipped if the bot is down at that minute.
    if ((minute - Math.floor(startMs / MIN)) % sched.remindEveryMinutes !== 0) continue;
    if (lastReminded.get(poll.pollId) === minute) continue;
    lastReminded.set(poll.pollId, minute);
    await remind(bot, poll);
  }
}

// Demo: step 0 post (latest saved menu + both polls), step 1 remind, step 2 close. Repeats with a fresh week each cycle.
function latestMenu() {
  try {
    const menus = JSON.parse(fs.readFileSync(path.join(process.env.POLL_DATA_DIR || path.join(__dirname, 'data'), 'menus.json'), 'utf8'));
    const k = Object.keys(menus).sort().pop();
    return k ? menus[k] : null;
  } catch { return null; }
}
async function demoStep(bot, state, stepMs) {
  const now = Date.now();
  if (state.step % 3 === 0) {
    let weekStart = mondayOnOrAfter(toLocal(now).slice(0, 10));
    while (await p.getPoll(`weekly_attendance-${weekStart}`)) weekStart = plusDays(weekStart, 7); // unused fake week
    const closesAt = toLocal(now + 2 * stepMs);
    state.polls = [
      await postNew(bot, 'weekly_attendance', { weekStart, weekEnd: plusDays(weekStart, 4) }, closesAt, latestMenu()),
      await postNew(bot, 'friday_diet', { date: plusDays(weekStart, 4) }, closesAt, null),
    ];
  } else if (state.step % 3 === 1) {
    for (const poll of state.polls) await remind(bot, poll);
  } else {
    for (const poll of state.polls) await call(bot, 'postSummary', await p.closePoll(poll.pollId));
  }
  state.step++;
}

// Call once at bot startup. Sync; returns a stop() function.
function startScheduler(bot) {
  const demo = process.env.POLL_DEMO === '1';
  const stepMs = (Number(process.env.POLL_DEMO_STEP_SECONDS) || 60) * 1000;
  const state = { step: 0, polls: [] };
  const run = () => (demo ? demoStep(bot, state, stepMs) : tick(bot))
    .catch((e) => console.error('[scheduler] error:', e)); // never let the timer die
  console.log(`[scheduler] started (${demo ? `demo, step ${stepMs / 1000}s` : 'normal, Asia/Kolkata'})`);
  run();
  const id = setInterval(run, demo ? stepMs : 30000);
  return () => clearInterval(id);
}

module.exports = { startScheduler, tick };
