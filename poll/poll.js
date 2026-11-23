// Person B: poll logic. CommonJS, all exported functions async (agreed with Person A).
const fs = require('fs');
const path = require('path');
const TEMPLATES = require('./templates.json');

const DATA_DIR = process.env.POLL_DATA_DIR || path.join(__dirname, 'data');
const POLLS_FILE = path.join(DATA_DIR, 'polls.json');
const TZ = 'Asia/Kolkata';

// Sync file I/O inside async functions: each call reads+writes in one tick, so no interleaving races.
function load(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
}
function save(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(file + '.tmp', file); // atomic replace, no half-written file on crash
}

// "YYYY-MM-DDTHH:mm:ss" in office local time, no offset.
function now() {
  return new Date().toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T');
}
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function createPoll(type, { weekStart = null, weekEnd = null, date = null, closesAt = null } = {}) {
  const t = TEMPLATES[type];
  if (!t) throw new Error(`Unknown poll type: ${type}`);
  if (t.scope === 'week') {
    if (!isDate(weekStart) || !isDate(weekEnd)) throw new Error('weekly poll needs weekStart and weekEnd as YYYY-MM-DD');
    date = null;
  } else {
    if (!isDate(date)) throw new Error('friday poll needs date as YYYY-MM-DD'); // any weekday allowed (demo-friendly)
    weekStart = weekEnd = null;
  }
  const pollId = `${type}-${weekStart || date}`;
  const polls = load(POLLS_FILE);
  if (polls[pollId]) return polls[pollId]; // duplicate start: return existing, keep votes
  const poll = {
    pollId, type, question: t.question, options: t.options.map((o) => ({ ...o })),
    weekStart, weekEnd, date, closesAt, status: 'open', responses: {},
  };
  polls[pollId] = poll;
  save(POLLS_FILE, polls);
  return poll;
}

async function recordVote(pollId, userId, name, optionId) {
  const polls = load(POLLS_FILE);
  const poll = polls[pollId];
  if (!poll) throw new Error(`Unknown poll: ${pollId}`);
  if (poll.status === 'closed') return poll; // ignored; caller checks status
  if (!poll.options.some((o) => o.id === optionId)) throw new Error(`Invalid option ${optionId} for ${pollId}`);
  poll.responses[userId] = { name, optionId, votedAt: now() }; // revote replaces
  save(POLLS_FILE, polls);
  return poll;
}

async function getPoll(pollId) {
  return load(POLLS_FILE)[pollId] || null;
}

async function getOpenPolls() {
  return Object.values(load(POLLS_FILE)).filter((p) => p.status === 'open');
}

function summarize(poll) {
  const counts = {}, voters = {};
  for (const o of poll.options) { counts[o.id] = 0; voters[o.id] = []; }
  for (const r of Object.values(poll.responses)) { counts[r.optionId]++; voters[r.optionId].push(r.name); }
  return {
    pollId: poll.pollId, type: poll.type, question: poll.question,
    totalVotes: Object.keys(poll.responses).length, counts, voters,
  };
}

async function closePoll(pollId) {
  const polls = load(POLLS_FILE);
  const poll = polls[pollId];
  if (!poll) throw new Error(`Unknown poll: ${pollId}`);
  if (poll.status !== 'closed') { poll.status = 'closed'; save(POLLS_FILE, polls); }
  return summarize(poll); // closing twice returns same summary (votes are frozen once closed)
}

async function getNonVoters(pollId, members) {
  const poll = load(POLLS_FILE)[pollId];
  if (!poll) throw new Error(`Unknown poll: ${pollId}`);
  return members.filter((m) => !poll.responses[m.userId]).map(({ userId, name }) => ({ userId, name }));
}

// ---------- Menu ----------
const MENUS_FILE = path.join(DATA_DIR, 'menus.json');
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const DAY_RE = new RegExp(`^(${DAYS.join('|')})\\b\\s*[-:]?\\s*(.*)$`, 'i');
const HEADING_RE = /^(breakfast|lunch)\b\s*[-:]?\s*(.*)$/i;
const WEEK_RE = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(?:to|-|–)\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i;

const clean = (s) => s.replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim();
function tidyItem(s) {
  s = s.replace(/\s*\+\s*/g, ' + ').replace(/\s*\(\s*/g, ' (').replace(/\s*\)/g, ')').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// d/m/y (day first) → YYYY-MM-DD
function dmy(d, m, y) {
  if (y.length === 2) y = '20' + y;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}
const NO_DATES = 'No week dates found in the text (expected e.g. "2/11/26 to 6/11/26")';
const isMonday = (d) => new Date(d + 'T00:00:00Z').getUTCDay() === 1;
function addDays(iso, n) {
  const t = new Date(iso + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

async function parseMenu(rawText) {
  const warnings = [];
  let weekStart = null, weekEnd = null;
  const byDay = {}; // day -> { pre: [], breakfast: [], lunch: [], section, bfHeading, lunchHeading }
  let cur = null;

  const lines = String(rawText).split(/\r?\n/).map(clean).filter(Boolean);
  if (lines.length < 5) warnings.push(`Only ${lines.length} line(s) found: line breaks may have been lost when pasting`);
  for (const line of lines) {
    const wk = !cur && !weekStart && line.match(WEEK_RE);
    if (wk) { weekStart = dmy(wk[1], wk[2], wk[3]); weekEnd = dmy(wk[4], wk[5], wk[6]); continue; }

    let rest = line;
    const dm = line.match(DAY_RE);
    if (dm) {
      const day = DAYS.find((d) => d.toLowerCase() === dm[1].toLowerCase());
      cur = byDay[day] ||= { pre: [], breakfast: [], lunch: [], section: 'pre', bfHeading: false, lunchHeading: false };
      rest = dm[2];
      if (!rest) continue;
    }
    if (!cur) { warnings.push(`Ignored text before the first day: "${line}"`); continue; }

    const hm = rest.match(HEADING_RE);
    if (hm) {
      cur.section = hm[1].toLowerCase();
      if (cur.section === 'lunch') cur.lunchHeading = true; else cur.bfHeading = true;
      rest = hm[2];
      if (!rest) continue;
    }
    cur[cur.section].push(tidyItem(rest));
  }

  if (!weekStart) warnings.push(NO_DATES);
  else if (!isMonday(weekStart)) warnings.push(`Week start ${weekStart} is not a Monday`);

  const days = DAYS.map((day, i) => {
    const d = byDay[day];
    const date = weekStart ? addDays(weekStart, i) : null;
    if (!d) { warnings.push(`${day}: not found in the menu`); return { day, date, breakfast: [], lunch: [] }; }
    let breakfast = [...d.pre, ...d.breakfast], lunch = d.lunch;
    if (!d.lunchHeading) {
      // ponytail: naive guess, first item = breakfast, rest = lunch; HR checks the preview
      lunch = breakfast.slice(1);
      breakfast = breakfast.slice(0, 1);
      if (lunch.length) warnings.push(`${day}: no 'Lunch' heading found, guessed which items are lunch`);
    }
    if (!breakfast.length) warnings.push(`${day}: no breakfast items found`);
    if (!lunch.length) warnings.push(`${day}: no lunch items found`);
    return { day, date, breakfast, lunch };
  });

  return { weekStart, weekEnd, rawText, days, warnings };
}

async function saveMenu(menu) {
  if (!menu || !isDate(menu.weekStart)) throw new Error('menu needs weekStart as YYYY-MM-DD');
  const menus = load(MENUS_FILE);
  menus[menu.weekStart] = menu; // saving again for the same week replaces it
  save(MENUS_FILE, menus);
}

async function getMenu(weekStart) {
  return load(MENUS_FILE)[weekStart] || null;
}

// HR picked the Monday in the preview: returns a NEW menu with week dates filled.
async function setMenuWeek(menu, weekStart) {
  if (!isDate(weekStart)) throw new Error('weekStart must be YYYY-MM-DD');
  const warnings = menu.warnings.filter((w) => w !== NO_DATES && !w.startsWith('Week start '));
  if (!isMonday(weekStart)) warnings.push(`Week start ${weekStart} is not a Monday`);
  return {
    ...menu, weekStart, weekEnd: addDays(weekStart, 4),
    days: menu.days.map((d, i) => ({ ...d, date: addDays(weekStart, i) })), // days are always Mon..Fri
    warnings,
  };
}

// ---------- Schedule (HR edits from Teams) ----------
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_SCHEDULE = {
  // Confirmed by HR 2026-11-22
  weekly: { post: { day: 'Saturday', time: '10:00' }, remind: { day: 'Monday', time: '09:00' }, close: { day: 'Monday', time: '10:00' } },
  friday: { post: { day: 'Friday', time: '08:30' }, remind: { day: 'Friday', time: '08:30' }, close: { day: 'Friday', time: '12:00' } },
  remindEveryMinutes: 30,
};

async function getSchedule() {
  const saved = load(SCHEDULE_FILE);
  return Object.keys(saved).length ? saved : structuredClone(DEFAULT_SCHEDULE);
}

async function setSchedule(kind, event, day, time) {
  if (!['weekly', 'friday'].includes(kind)) throw new Error('kind must be weekly or friday');
  if (!['post', 'remind', 'close'].includes(event)) throw new Error('event must be post, remind or close');
  const d = String(day).trim().toLowerCase();
  const dayName = d.length >= 2 && WEEKDAYS.find((w) => w.toLowerCase().startsWith(d));
  if (!dayName || WEEKDAYS.filter((w) => w.toLowerCase().startsWith(d)).length > 1) throw new Error(`Unknown day: ${day}`);
  const t = String(time).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!t || +t[1] > 23 || +t[2] > 59) throw new Error(`Time must be HH:mm (24h), got: ${time}`);
  const schedule = await getSchedule();
  schedule[kind][event] = { day: dayName, time: `${t[1].padStart(2, '0')}:${t[2]}` };
  save(SCHEDULE_FILE, schedule);
  return schedule;
}

module.exports = {
  createPoll, recordVote, getPoll, getOpenPolls, closePoll, getNonVoters,
  parseMenu, saveMenu, getMenu, setMenuWeek, getSchedule, setSchedule, TEMPLATES,
};
