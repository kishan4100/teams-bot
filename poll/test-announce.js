// Run: node test-announce.js
const assert = require('assert'), os = require('os'), path = require('path'), fs = require('fs');
process.env.POLL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'announce-'));
const a = require('./announce');
const { tick } = require('./scheduler');
// Asia/Kolkata is +05:30: build a UTC ms for a local time.
const at = (local) => Date.parse(local + 'Z') - 330 * 60000;

(async () => {
  assert.deepStrictEqual(a.normalizeDays(['weekdays']), ['mon', 'tue', 'wed', 'thu', 'fri']);
  assert.deepStrictEqual(a.normalizeDays(['Friday', 'mon']), ['mon', 'fri']);
  assert.strictEqual(a.normalizeDays('daily').length, 7);
  assert.throws(() => a.normalizeDays(['funday']), /isn't a day/);
  assert.throws(() => a.normalizeDays([]), /Which days/);
  await assert.rejects(() => a.add({ text: '', time: '18:30', days: ['mon'] }), /text/);
  await assert.rejects(() => a.add({ text: 'x', time: '6:30pm', days: ['mon'] }), /HH:mm/);

  const item = await a.add({ text: 'Turn off AC and lights before leaving.', time: '18:30', days: ['weekdays'] });
  const posted = [];
  const bot = { postAnnouncement: async (x) => posted.push(x.text), getMembers: async () => [], postPollCard: async () => {}, postSummary: async () => {}, postMenuCard: async () => {}, sendReminder: async () => {} };

  await tick(bot, at('2026-11-23T18:29:30')); assert.strictEqual(posted.length, 0);   // Monday, one minute early
  await tick(bot, at('2026-11-23T18:30:10')); assert.strictEqual(posted.length, 1);   // on time
  await tick(bot, at('2026-11-23T18:30:40')); assert.strictEqual(posted.length, 1);   // not twice the same day
  await tick(bot, at('2026-11-24T18:30:05')); assert.strictEqual(posted.length, 2);   // next day again
  await tick(bot, at('2026-11-28T18:30:05')); assert.strictEqual(posted.length, 2);   // Saturday: not in Mon–Fri
  await tick(bot, at('2026-11-25T18:40:00')); assert.strictEqual(posted.length, 3);   // bot was 10 min late: catch up
  await tick(bot, at('2026-11-26T19:10:00')); assert.strictEqual(posted.length, 3);   // 40 min late: skipped for today

  // One-time alert: posts once on its date, then is gone; a missed one is dropped the next day
  const one = await a.add({ text: 'Party at 5!', time: '17:00', date: '2026-12-01' });
  await assert.rejects(() => a.add({ text: 'x', time: '17:00', date: '1 Dec' }), /YYYY-MM-DD/);
  const n0 = posted.length;
  await tick(bot, at('2026-11-30T17:00:10')); assert.strictEqual(posted.length, n0);          // day before
  await tick(bot, at('2026-12-01T17:00:10')); assert.strictEqual(posted.length, n0 + 1);      // on the day (Tuesday)
  assert.ok(posted[posted.length - 1].startsWith('Party'));
  await tick(bot, at('2026-12-01T17:00:40')); assert.strictEqual(posted.length, n0 + 1);      // not twice
  assert.ok(!(await a.list()).some((x) => x.id === one.id));                                   // deleted after posting
  const missed = await a.add({ text: 'Missed', time: '09:00', date: '2026-12-02' });
  await tick(bot, at('2026-12-03T09:00:10')); assert.ok(!(await a.list()).some((x) => x.id === missed.id)); // bot was off that day

  assert.strictEqual((await a.list()).length, 1);
  await a.remove(item.id);
  await tick(bot, at('2026-11-27T18:30:05')); assert.strictEqual(posted.length, n0 + 1);   // removed
  await assert.rejects(() => a.remove(item.id), /no longer exists/);
  // Two independent alerts at different times, days and delivery: each fires on its own, neither affects the other
  const ac = await a.add({ text: 'Switch off the AC', time: '18:30', days: ['weekdays'] });
  const ts = await a.add({ text: 'Submit timesheets', time: '11:00', days: ['fri'], delivery: 'dm' });
  const seen = [];
  const bot2 = { ...bot, postAnnouncement: async (x) => seen.push(`${x.text}|${x.delivery}`) };
  await tick(bot2, at('2026-12-04T11:00:10')); // Friday 11:00
  assert.deepStrictEqual(seen, ['Submit timesheets|dm']);
  await tick(bot2, at('2026-12-04T18:30:10')); // Friday 18:30
  assert.deepStrictEqual(seen, ['Submit timesheets|dm', 'Switch off the AC|group']);
  await tick(bot2, at('2026-12-07T11:00:10')); // Monday 11:00: only the Friday one is silent
  assert.strictEqual(seen.length, 2);
  await a.remove(ac.id); await a.remove(ts.id);
  console.log('announce tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
