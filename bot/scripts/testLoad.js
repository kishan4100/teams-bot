// 40 people voting at once: no lost votes, card/result sizes stay small. Run: node scripts/testLoad.js
const assert = require("assert"), os = require("os"), path = require("path"), fs = require("fs");
process.env.POLL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "load-"));
process.env.BOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "load-bot-"));
const polls = require("../../poll/poll");
const actions = require("../teamsActions");
const { buildPollCard } = require("../cards/pollCard");
const { buildSummaryCard } = require("../cards/summaryCard");
(async () => {
  const poll = await polls.createCustomPoll({ question: "Team outing?", options: ["Fri", "Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Day 8", "Day 9", "Day 10"], multi: true });
  const meal = await polls.createPoll("weekly_attendance", { weekStart: "2026-11-23", weekEnd: "2026-11-27", closesAt: "2026-11-23T10:00:00" });
  await Promise.all(Array.from({ length: 40 }, (_, i) => Promise.all([
    polls.recordVote(poll.pollId, `u${i}`, `Person Number ${i}`, [`o${(i % 10) + 1}`, `o${((i + 3) % 10) + 1}`].join(",")),
    polls.recordVote(meal.pollId, `u${i}`, `Person Number ${i}`, ["bf_lunch", "lunch_only", "none"][i % 3]),
  ])));
  for (const id of [poll.pollId, meal.pollId]) assert.strictEqual(Object.keys((await polls.getPoll(id)).responses).length, 40);
  const live = JSON.stringify(buildPollCard(await polls.getPoll(meal.pollId)));
  const res = JSON.stringify(buildSummaryCard(await polls.closePoll(poll.pollId)));
  const res2 = JSON.stringify(buildSummaryCard(await polls.closePoll(meal.pollId)));
  console.log(`live card ${live.length} bytes, custom results (10 options, 40 voters) ${res.length} bytes, meal results ${res2.length} bytes`);
  assert.ok(live.length < 12000 && res.length < 20000 && res2.length < 20000, "Teams cards must stay well under ~28 KB");
  // 40 vote clicks in a burst → ONE card edit with the final counts (Teams limits how often a message can be edited)
  const edits = [];
  actions.rememberPollCard(meal.pollId, "grp", "act1", { conversations: { updateActivity: async (c, id, m) => { edits.push(JSON.stringify(m)); } } });
  const reopened = await polls.getPoll(meal.pollId);
  for (let i = 0; i < 40; i++) actions.updatePollCardSoon(meal.pollId, () => polls.getPoll(meal.pollId), 50);
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(edits.length, 1, `expected 1 edit, got ${edits.length}`);
  assert.ok(edits[0].includes("40 votes"));
  console.log("load test passed");
})().catch((e) => { console.error(e); process.exit(1); });
