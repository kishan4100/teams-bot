// Run: node test-custom.js   (custom / any-topic polls; uses a throwaway temp data dir)
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.POLL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'polltest-custom-'));
const p = require('./poll');
const { tick } = require('./scheduler');

(async () => {
  // --- validation
  await assert.rejects(p.createCustomPoll({ question: '', options: ['a', 'b'] }), /question/);
  await assert.rejects(p.createCustomPoll({ question: 'Q', options: ['only one'] }), /at least 2/);
  await assert.rejects(p.createCustomPoll({ question: 'Q', options: ['a', 'A'] }), /same/);
  await assert.rejects(p.createCustomPoll({ question: 'Q', options: Array.from({ length: 11 }, (_, i) => `o${i}`) }), /At most 10/);
  await assert.rejects(p.createCustomPoll({ question: 'Q', options: ['a', 'b'], closesAt: '2020-01-01T10:00:00' }), /past/);
  await assert.rejects(p.createCustomPoll({ question: 'Q', options: ['a', 'b'], closesAt: 'tomorrow' }), /YYYY/);

  // --- single choice, named
  const s = await p.createCustomPoll({ question: 'Team outing day?', options: [' Fri ', 'Sat', ''], createdBy: { userId: 'hr', name: 'HR' } });
  assert.equal(s.type, 'custom');
  assert.match(s.pollId, /^custom-\d{14}-[0-9a-f]{4}$/);
  assert.deepEqual(s.options, [{ id: 'o1', label: 'Fri' }, { id: 'o2', label: 'Sat' }]); // trimmed, blanks dropped
  assert.equal(s.multi, false);
  assert.equal(s.closesAt, null);
  await p.recordVote(s.pollId, 'u1', 'Ravi', 'o1');
  await p.recordVote(s.pollId, 'u2', 'Asha', 'o1');
  let poll = await p.recordVote(s.pollId, 'u2', 'Asha', ['o2']); // array with one id is accepted for single choice
  assert.equal(poll.responses.u2.optionId, 'o2');
  await assert.rejects(p.recordVote(s.pollId, 'u3', 'Sam', 'o9'), /Invalid option/);
  assert.deepEqual((await p.getNonVoters(s.pollId, [{ userId: 'u1', name: 'Ravi' }, { userId: 'u3', name: 'Sam' }])).map((m) => m.name), ['Sam']);
  let sum = await p.closePoll(s.pollId);
  assert.deepEqual(sum.counts, { o1: 1, o2: 1 });
  assert.deepEqual(sum.voters, { o1: ['Ravi'], o2: ['Asha'] });
  assert.deepEqual(sum.options.map((o) => o.label), ['Fri', 'Sat']);
  assert.equal(sum.anonymous, false);
  assert.equal((await p.recordVote(s.pollId, 'u3', 'Sam', 'o1')).status, 'closed'); // vote after close ignored

  // --- multi choice, anonymous
  const m = await p.createCustomPoll({ question: 'Which snacks?', options: ['Samosa', 'Chips', 'Fruit'], multi: true, anonymous: true });
  poll = await p.recordVote(m.pollId, 'u1', 'Ravi', 'o1,o3');
  assert.deepEqual(poll.responses.u1.optionIds, ['o1', 'o3']);
  assert.equal(poll.responses.u1.name, null); // anonymous: name never stored
  await p.recordVote(m.pollId, 'u2', 'Asha', ['o3', 'o3']); // duplicates collapse
  await p.recordVote(m.pollId, 'u1', 'Ravi', ['o2']); // revote replaces the whole set
  await assert.rejects(p.recordVote(m.pollId, 'u4', 'X', ''), /at least one/);
  await assert.rejects(p.recordVote(m.pollId, 'u4', 'X', 'o1,o7'), /Invalid option o7/);
  sum = await p.closePoll(m.pollId);
  assert.equal(sum.totalVotes, 2); // voters, not ticks
  assert.deepEqual(sum.counts, { o1: 0, o2: 1, o3: 1 });
  assert.deepEqual(sum.voters, { o1: [], o2: [], o3: [] }); // anonymous: no names
  assert.equal(sum.multi, true);

  // --- meal polls unchanged by the new fields
  const w = await p.createPoll('weekly_attendance', { weekStart: '2026-11-30', weekEnd: '2026-12-04' });
  await p.recordVote(w.pollId, 'u1', 'Ravi', 'bf_lunch');
  const ws = await p.closePoll(w.pollId);
  assert.equal(ws.options, undefined);
  assert.deepEqual(ws.voters.bf_lunch, ['Ravi']);

  // --- scheduler: custom poll with a close time is reminded (09:00–21:00, from 30 min after creation) and auto-closed
  const OFFSET = 330 * 60000;
  const ms = (local) => Date.parse(local + 'Z') - OFFSET; // Asia/Kolkata local → epoch ms
  const calls = [];
  const bot = {
    postPollCard: async () => {}, postMenuCard: async () => {},
    postSummary: async (x) => calls.push(['summary', x.pollId]),
    sendReminder: async (pl, nv) => calls.push(['remind', pl.pollId, nv.map((n) => n.name).join(',')]),
    getMembers: async () => [{ userId: 'u1', name: 'Ravi' }, { userId: 'u2', name: 'Asha' }],
  };
  // Build a poll with fixed createdAt / closesAt directly in storage so the test doesn't depend on today's date.
  const c = await p.createCustomPoll({ question: 'Lunch spot?', options: ['A', 'B'], closesAt: '2099-01-01T10:00:00' });
  const file = path.join(process.env.POLL_DATA_DIR, 'polls.json');
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  all[c.pollId].createdAt = '2030-03-05T08:10:00';
  all[c.pollId].closesAt = '2030-03-05T12:00:00';
  fs.writeFileSync(file, JSON.stringify(all));
  await p.recordVote(c.pollId, 'u1', 'Ravi', 'o1');

  calls.length = 0; await tick(bot, ms('2030-03-05T08:40:00')); // first slot (08:10 + 30) but before 09:00 → no reminder
  assert.deepEqual(calls.filter((x) => x[1] === c.pollId), []);
  calls.length = 0; await tick(bot, ms('2030-03-05T09:10:00')); // on the 30-min grid, inside window → Asha reminded
  assert.deepEqual(calls.filter((x) => x[1] === c.pollId), [['remind', c.pollId, 'Asha']]);
  calls.length = 0; await tick(bot, ms('2030-03-05T09:25:00')); // off-grid → nothing
  assert.deepEqual(calls.filter((x) => x[1] === c.pollId), []);
  calls.length = 0; await tick(bot, ms('2030-03-05T12:00:00')); // close time → summary
  assert.deepEqual(calls.filter((x) => x[1] === c.pollId), [['summary', c.pollId]]);
  assert.equal((await p.getPoll(c.pollId)).status, 'closed');

  console.log('All custom poll tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
