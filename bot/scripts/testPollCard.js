// Quick check for cards/pollCard.js. Run: node scripts/testPollCard.js
// Prints card JSON you can paste into https://adaptivecards.io/designer
// (choose "Microsoft Teams" as host app) to see how it looks.
const assert = require("assert");
const { buildPollCard } = require("../cards/pollCard");

const weekly = {
  pollId: "weekly_attendance-2026-11-23",
  type: "weekly_attendance",
  question: "Team, kindly vote for this week.",
  options: [
    { id: "bf_lunch", label: "Breakfast + Lunch" },
    { id: "lunch_only", label: "Only Lunch" },
    { id: "none", label: "No BF, No lunch" },
  ],
  weekStart: "2026-11-23",
  weekEnd: "2026-11-27",
  date: null,
  closesAt: "2026-11-23T10:00:00",
  status: "open",
  responses: {
    u1: { name: "Ravi", optionId: "bf_lunch", votedAt: "2026-11-22T18:02:00" },
    u2: { name: "Asha", optionId: "bf_lunch", votedAt: "2026-11-22T18:05:00" },
    u3: { name: "Sam", optionId: "none", votedAt: "2026-11-22T18:07:00" },
  },
};

const friday = {
  pollId: "friday_diet-2026-11-27",
  type: "friday_diet",
  question: "Please vote for your preference for today's lunch.",
  options: [
    { id: "veg", label: "Veg" },
    { id: "nonveg", label: "Non veg" },
  ],
  weekStart: null,
  weekEnd: null,
  date: "2026-11-27",
  closesAt: "2026-11-27T11:00:00",
  status: "closed",
  responses: {},
};

const w = buildPollCard(weekly);
assert.strictEqual(w.actions.length, 3, "one button per option");
assert.deepStrictEqual(w.actions[0].data, { action: "vote", pollId: weekly.pollId, optionId: "bf_lunch" });
const wText = JSON.stringify(w);
assert.ok(wText.includes("Week: Mon 23 Nov – Fri 27 Nov"), "week range shown");
assert.ok(wText.includes("Closes: Mon 23 Nov, 10:00"), "closesAt shown");
assert.ok(wText.includes("Total votes: 3"), "total count");
assert.ok(!wText.includes("Ravi"), "no voter names on the poll card");

const f = buildPollCard(friday);
assert.strictEqual(f.actions, undefined, "closed poll has no buttons");
const fText = JSON.stringify(f);
assert.ok(fText.includes("For: Fri 27 Nov"), "friday date shown");
assert.ok(fText.includes("closed"), "closed label shown");
assert.ok(fText.includes("Total votes: 0"), "zero votes ok");

console.log("All pollCard checks passed.\n");
if (process.argv.includes("--print")) {
  console.log("Weekly card:\n" + JSON.stringify(w, null, 2));
  console.log("\nFriday card (closed):\n" + JSON.stringify(f, null, 2));
}
