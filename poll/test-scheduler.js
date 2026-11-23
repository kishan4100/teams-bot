// Run: node test-scheduler.js   (temp data dir; fake clock via tick(bot, nowMs))
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.POLL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'schedtest-'));
const p = require('./poll');
const { tick } = require('./scheduler');

const at = (local) => Date.parse(local + '+05:30'); // Asia/Kolkata wall time → ms
let calls = [];
const bot = {
  postPollCard: async (poll) => calls.push(['postPollCard', poll.pollId, poll.closesAt]),
  postMenuCard: async (menu) => calls.push(['postMenuCard', menu.weekStart]),
  postSummary: async (s) => calls.push(['postSummary', s.pollId, s.totalVotes]),
  sendReminder: async (poll, nv) => calls.push(['sendReminder', poll.pollId, nv.map((m) => m.name)]),
  getMembers: async () => [{ userId: 'u1', name: 'Ravi' }, { userId: 'u2', name: 'Asha' }, { userId: 'u3', name: 'Kiran' }],
};
const take = () => { const c = calls; calls = []; return c; };

(async () => {
  // ---- schedule functions ----
  assert.deepEqual((await p.getSchedule()).weekly.post, { day: 'Saturday', time: '10:00' });
  assert.deepEqual((await p.getSchedule()).friday.post, { day: 'Friday', time: '08:30' });
  assert.equal((await p.getSchedule()).remindEveryMinutes, 30);
  const s = await p.setSchedule('friday', 'close', 'FRI', '9:05');
  assert.deepEqual(s.friday.close, { day: 'Friday', time: '09:05' });
  assert.deepEqual((await p.getSchedule()).friday.close, { day: 'Friday', time: '09:05' });
  await p.setSchedule('friday', 'close', 'friday', '12:00');
  assert.deepEqual((await p.getSchedule()).friday.remind, { day: 'Friday', time: '08:30' });
  await assert.rejects(p.setSchedule('daily', 'post', 'Mon', '10:00'));
  await assert.rejects(p.setSchedule('weekly', 'open', 'Mon', '10:00'));
  await assert.rejects(p.setSchedule('weekly', 'post', 's', '10:00')); // ambiguous
  await assert.rejects(p.setSchedule('weekly', 'post', 'Funday', '10:00'));
  await assert.rejects(p.setSchedule('weekly', 'post', 'Mon', '25:00'));

  // ---- setMenuWeek ----
  const bare = await p.parseMenu('Monday\nPoha\nLunch\nRice');
  const dated = await p.setMenuWeek(bare, '2026-11-23');
  assert.equal(dated.weekEnd, '2026-11-27');
  assert.deepEqual(dated.days.map((d) => d.date), ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
  assert.ok(!dated.warnings.some((w) => w.startsWith('No week dates')));
  assert.equal(bare.weekStart, null); // original untouched
  assert.ok((await p.setMenuWeek(bare, '2026-11-24')).warnings.includes('Week start 2026-11-24 is not a Monday'));
  await assert.rejects(p.setMenuWeek(bare, '23/11/26'));
  await p.saveMenu(dated);

  // ---- scheduler, normal mode ----
  await tick(bot, at('2026-11-21T09:59:00')); // Saturday before post
  assert.deepEqual(take(), []);
  await tick(bot, at('2026-11-21T10:00:10')); // Saturday post time
  assert.deepEqual(take(), [
    ['postMenuCard', '2026-11-23'],
    ['postPollCard', 'weekly_attendance-2026-11-23', '2026-11-23T10:00:00'],
  ]);
  await tick(bot, at('2026-11-21T10:00:40')); // no double post
  assert.deepEqual(take(), []);

  await p.recordVote('weekly_attendance-2026-11-23', 'u1', 'Ravi', 'bf_lunch');
  await tick(bot, at('2026-11-23T09:00:05')); // reminders start Monday 09:00
  await tick(bot, at('2026-11-23T09:00:35')); // same minute: once only
  assert.deepEqual(take(), [['sendReminder', 'weekly_attendance-2026-11-23', ['Asha', 'Kiran']]]);
  await tick(bot, at('2026-11-23T09:15:00')); // between slots
  assert.deepEqual(take(), []);
  await p.recordVote('weekly_attendance-2026-11-23', 'u2', 'Asha', 'none');
  await p.recordVote('weekly_attendance-2026-11-23', 'u3', 'Kiran', 'lunch_only');
  await tick(bot, at('2026-11-23T09:30:00')); // everyone voted: no reminder
  assert.deepEqual(take(), []);
  await tick(bot, at('2026-11-23T10:00:00')); // close
  assert.deepEqual(take(), [['postSummary', 'weekly_attendance-2026-11-23', 3]]);
  await tick(bot, at('2026-11-23T10:00:30'));
  assert.deepEqual(take(), []);

  await tick(bot, at('2026-11-25T12:00:00')); // Wednesday: nothing
  assert.deepEqual(take(), []);

  await tick(bot, at('2026-11-27T08:25:00')); // before Friday post
  assert.deepEqual(take(), []);
  await tick(bot, at('2026-11-27T08:40:00')); // Friday, bot started late: catches up
  assert.deepEqual(take(), [['postPollCard', 'friday_diet-2026-11-27', '2026-11-27T12:00:00']]);
  await tick(bot, at('2026-11-27T09:00:00'));
  assert.deepEqual(take(), [['sendReminder', 'friday_diet-2026-11-27', ['Ravi', 'Asha', 'Kiran']]]);
  await tick(bot, at('2026-11-27T11:30:00'));
  assert.equal(take().length, 1);
  await tick(bot, at('2026-11-27T12:00:00'));
  assert.deepEqual(take(), [['postSummary', 'friday_diet-2026-11-27', 0]]);

  // HR changes schedule from Teams: weekly post moves to Sunday 18:00
  await p.setSchedule('weekly', 'post', 'Sun', '18:00');
  await tick(bot, at('2026-11-28T10:00:00')); // old Saturday time: nothing
  assert.deepEqual(take(), []);
  await tick(bot, at('2026-11-29T18:00:00'));
  assert.deepEqual(take(), [['postPollCard', 'weekly_attendance-2026-11-30', '2026-11-30T10:00:00']]);

  // Weekly reminders only 09:00–21:00
  await p.setSchedule('weekly', 'remind', 'Sun', '20:30');
  await tick(bot, at('2026-11-29T20:30:00'));
  await tick(bot, at('2026-11-29T21:00:00'));
  assert.equal(take().length, 2);
  await tick(bot, at('2026-11-29T21:30:00'));
  await tick(bot, at('2026-11-30T08:30:00'));
  assert.deepEqual(take(), []);
  await tick(bot, at('2026-11-30T09:00:00'));
  assert.equal(take().length, 1);

  // A failing bot function is logged, not thrown
  const broken = { ...bot, postPollCard: async () => { throw new Error('no chat saved'); } };
  const err = console.error; console.error = () => {};
  await tick(broken, at('2026-12-04T08:30:00'));
  console.error = err;
  assert.ok(await p.getPoll('friday_diet-2026-12-04'));

  console.log('All scheduler tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
