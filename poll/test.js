// Run: node test.js   (uses a throwaway temp data dir, never touches poll/data)
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.POLL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'polltest-'));
const p = require('./poll');

(async () => {
  // Weekly poll
  const w = await p.createPoll('weekly_attendance', { weekStart: '2026-11-23', weekEnd: '2026-11-27', closesAt: '2026-11-23T10:00:00' });
  assert.equal(w.pollId, 'weekly_attendance-2026-11-23');
  assert.equal(w.date, null);
  assert.equal(w.status, 'open');
  assert.equal(w.options.length, 3);

  await p.recordVote(w.pollId, 'u1', 'Ravi', 'bf_lunch');
  await p.recordVote(w.pollId, 'u2', 'Asha', 'bf_lunch');
  let poll = await p.recordVote(w.pollId, 'u2', 'Asha', 'lunch_only'); // revote replaces
  assert.equal(Object.keys(poll.responses).length, 2);
  assert.equal(poll.responses.u2.optionId, 'lunch_only');
  assert.match(poll.responses.u2.votedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

  // Duplicate start keeps votes
  const again = await p.createPoll('weekly_attendance', { weekStart: '2026-11-23', weekEnd: '2026-11-27' });
  assert.equal(Object.keys(again.responses).length, 2);

  await assert.rejects(p.recordVote(w.pollId, 'u3', 'X', 'bogus'));
  await assert.rejects(p.recordVote('nope', 'u3', 'X', 'veg'));

  const members = [{ userId: 'u1', name: 'Ravi' }, { userId: 'u2', name: 'Asha' }, { userId: 'u3', name: 'Kiran' }];
  assert.deepEqual(await p.getNonVoters(w.pollId, members), [{ userId: 'u3', name: 'Kiran' }]);

  // Friday poll
  const thu = await p.createPoll('friday_diet', { date: '2026-11-26' }); // any date allowed
  assert.equal(thu.pollId, 'friday_diet-2026-11-26');
  await p.closePoll(thu.pollId);
  await assert.rejects(p.createPoll('friday_diet', {})); // date still required
  const f = await p.createPoll('friday_diet', { date: '2026-11-27' });
  assert.equal(f.pollId, 'friday_diet-2026-11-27');
  assert.equal(f.weekStart, null);
  assert.equal(f.closesAt, null);
  await p.recordVote(f.pollId, 'u1', 'Ravi', 'nonveg');
  await p.recordVote(f.pollId, 'u1', 'Ravi', 'veg');
  assert.equal((await p.getOpenPolls()).length, 2);

  // Close weekly
  const s = await p.closePoll(w.pollId);
  assert.deepEqual(s, {
    pollId: w.pollId, type: 'weekly_attendance', question: 'Team, kindly vote for this week.',
    totalVotes: 2, counts: { bf_lunch: 1, lunch_only: 1, none: 0 },
    voters: { bf_lunch: ['Ravi'], lunch_only: ['Asha'], none: [] },
  });
  // Vote on closed poll ignored
  poll = await p.recordVote(w.pollId, 'u3', 'Kiran', 'none');
  assert.equal(poll.status, 'closed');
  assert.equal(poll.responses.u3, undefined);
  assert.deepEqual(await p.closePoll(w.pollId), s); // closing twice
  assert.deepEqual((await p.getOpenPolls()).map((x) => x.pollId), [f.pollId]);

  // Close Friday
  const fs2 = await p.closePoll(f.pollId);
  assert.deepEqual(fs2.counts, { veg: 1, nonveg: 0 });

  // setCloseTime: moves an open poll's close time; a closed poll is left as it was
  const f2 = await p.createPoll('friday_diet', { date: '2026-12-04', closesAt: '2026-12-04T12:00:00' });
  assert.equal((await p.setCloseTime(f2.pollId, '2026-12-04T12:30:00')).closesAt, '2026-12-04T12:30:00');
  assert.equal((await p.getPoll(f2.pollId)).closesAt, '2026-12-04T12:30:00');
  assert.equal((await p.setCloseTime(f.pollId, '2026-12-31T00:00:00')).closesAt, f.closesAt);

  // reopenLatestPoll: latest closed poll of the type, votes kept; nothing to reopen if the latest is open
  const r = await p.reopenLatestPoll('weekly_attendance', () => null);
  assert.equal(r.pollId, w.pollId);
  assert.equal(r.status, 'open');
  assert.equal(r.closesAt, null);
  assert.equal(Object.keys(r.responses).length, 2);
  assert.equal(await p.reopenLatestPoll('weekly_attendance', () => null), null);
  assert.equal(await p.reopenLatestPoll('friday_diet', () => null), null); // latest friday (f2) is open

  assert.equal(await p.getPoll('missing'), null);
  await assert.rejects(p.createPoll('lunch_party', {}));

  console.log('All poll tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
