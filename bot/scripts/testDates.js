// Checks for dates.js and summary card. Run: node scripts/testDates.js
const assert = require("assert");
const d = require("../dates");
const { buildSummaryCard } = require("../cards/summaryCard");

// weekStart rule (v3.2): Sat +2, Sun +1, Mon same day, Tue–Fri next Monday. 2026-11-21 is a Saturday.
const cases = {
  "2026-11-21": "2026-11-23", // Sat
  "2026-11-22": "2026-11-23", // Sun
  "2026-11-23": "2026-11-23", // Mon
  "2026-11-24": "2026-11-30", // Tue
  "2026-11-27": "2026-11-30", // Fri
};
for (const [today, want] of Object.entries(cases)) assert.strictEqual(d.weeklyWeekStart(today), want, today);

assert.strictEqual(d.fridayOnOrAfter("2026-11-27"), "2026-11-27"); // Fri
assert.strictEqual(d.fridayOnOrAfter("2026-11-28"), "2026-12-04"); // Sat
assert.strictEqual(d.fridayOnOrAfter("2026-11-23"), "2026-11-27"); // Mon

assert.strictEqual(d.closesAtFor("2026-11-23", { day: "Monday", time: "10:00" }), "2026-11-23T10:00:00");
assert.strictEqual(d.closesAtFor("2026-11-23", { day: "Sunday", time: "20:00" }), "2026-11-22T20:00:00");
assert.strictEqual(d.closesAtFor("2026-11-27", { day: "Friday", time: "12:00" }), "2026-11-27T12:00:00");
assert.strictEqual(d.closesAtFor("2026-11-27", { day: "Friday", time: "9:05" }), "2026-11-27T09:05:00");
assert.strictEqual(d.addDays("2026-12-30", 4), "2027-01-03");

// nowInOffice is in Asia/Kolkata: 2026-11-22T20:00Z is 2026-11-23 01:30 IST.
assert.deepStrictEqual(d.nowInOffice(new Date("2026-11-22T20:00:00Z")), { date: "2026-11-23", time: "01:30:00" });

// Summary card: weekly totals + names.
const card = JSON.stringify(buildSummaryCard({
  pollId: "weekly_attendance-2026-11-23", type: "weekly_attendance", question: "Team, kindly vote for this week.",
  totalVotes: 4, counts: { bf_lunch: 2, lunch_only: 1, none: 1 },
  voters: { bf_lunch: ["Ravi", "Asha"], lunch_only: ["Sam"], none: ["Lee"] },
}));
assert.ok(card.includes('"text":"2","size":"ExtraLarge"') && card.includes("Breakfast count"), "breakfast = bf_lunch");
assert.ok(card.includes('"text":"3","size":"ExtraLarge"') && card.includes("Lunch count"), "lunch = bf_lunch + lunch_only");
assert.ok(card.includes("Winner: Breakfast + Lunch"), "winner line");
assert.ok(card.includes("Ravi, Asha"), "names shown");
assert.ok(card.includes("Week starting Mon 23 Nov"), "week shown");

const fri = JSON.stringify(buildSummaryCard({
  pollId: "friday_diet-2026-11-27", type: "friday_diet", question: "Q", totalVotes: 0,
  counts: { veg: 0, nonveg: 0 }, voters: { veg: [], nonveg: [] },
}));
assert.ok(!fri.includes("Breakfast count"), "no meal totals on Friday");
assert.ok(fri.includes("For Fri 27 Nov"));

console.log("All date + summary checks passed.");
