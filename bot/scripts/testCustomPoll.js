// Checks for custom-poll cards and form parsing. Run: node scripts/testCustomPoll.js
const assert = require("assert");
const { buildPollCard } = require("../cards/pollCard");
const { buildSummaryCard } = require("../cards/summaryCard");
const { buildPollPreview, buildPostedCard, buildPollChooser, buildNewPollForm } = require("../cards/customPollCards");
const { parseDraft } = require("../commands");

const base = { pollId: "custom-1", type: "custom", question: "Team outing?", status: "open", closesAt: null, responses: {} };
const opts = (n) => Array.from({ length: n }, (_, i) => ({ id: `o${i + 1}`, label: `Option ${i + 1}` }));

// Single choice, few options → one button per option
let c = buildPollCard({ ...base, options: opts(3) });
assert.strictEqual(c.actions.length, 3);
assert.deepStrictEqual(c.actions[0].data, { action: "vote", pollId: "custom-1", optionId: "o1" });
assert.ok(!c.body.some((b) => b.type === "Input.ChoiceSet"));

// Single choice, many options → radio list + Vote
c = buildPollCard({ ...base, options: opts(7) });
let cs = c.body.find((b) => b.type === "Input.ChoiceSet");
assert.ok(cs && cs.isMultiSelect === false && cs.choices.length === 7);
assert.deepStrictEqual(c.actions.map((a) => a.title), ["Vote"]);

// Multi choice → checkboxes; counts per option, total = voters
c = buildPollCard({ ...base, options: opts(3), multi: true, anonymous: true,
  responses: { u1: { name: null, optionIds: ["o1", "o3"] }, u2: { name: null, optionIds: ["o3"] } } });
cs = c.body.find((b) => b.type === "Input.ChoiceSet");
assert.ok(cs.isMultiSelect);
const txt = JSON.stringify(c);
assert.ok(txt.includes("Pick all that apply") && txt.includes("Anonymous"));
assert.ok(txt.includes("Voters: 2"));
const counts = c.body.filter((b) => b.type === "ColumnSet").map((r) => r.columns[2].items[0].text);
assert.deepStrictEqual(counts, ["1", "0", "2"]);

// Closed → no inputs, no buttons
c = buildPollCard({ ...base, options: opts(3), multi: true, status: "closed" });
assert.strictEqual(c.actions, undefined);
assert.ok(!c.body.some((b) => b.type === "Input.ChoiceSet"));

// Results: custom labels; anonymous hides names
const sum = { pollId: "custom-1", type: "custom", question: "Q", totalVotes: 2, counts: { o1: 2, o2: 0 },
  voters: { o1: ["Ravi", "Asha"], o2: [] }, options: [{ id: "o1", label: "Friday" }, { id: "o2", label: "Saturday" }] };
let s = JSON.stringify(buildSummaryCard(sum));
assert.ok(s.includes("Friday") && s.includes("Saturday") && s.includes("Ravi, Asha"));
assert.ok(!s.includes("Week starting") && !s.includes("For "));
s = JSON.stringify(buildSummaryCard({ ...sum, anonymous: true, voters: { o1: [], o2: [] } }));
assert.ok(s.includes("Anonymous poll") && !s.includes("Ravi") && !s.includes("—"));

// Form parsing
let r = parseDraft({ q: " Outing? ", opts: "Fri\n\n Sat \nSun", multi: "true", anonymous: "false" });
assert.strictEqual(r.error, undefined);
assert.deepStrictEqual(r.draft.options, ["Fri", "Sat", "Sun"]);
assert.strictEqual(r.draft.multi, true);
assert.strictEqual(r.draft.closesAt, null);
assert.ok(/^[0-9a-f]{12}$/.test(r.draft.draftId));
assert.match(parseDraft({ q: "", opts: "a\nb" }).error, /question/);
assert.match(parseDraft({ q: "Q", opts: "a" }).error, /at least 2/);
assert.match(parseDraft({ q: "Q", opts: "a\nA" }).error, /same/);
assert.match(parseDraft({ q: "Q", opts: "a\nb", closeTime: "10:00" }).error, /date/);
assert.match(parseDraft({ q: "Q", opts: "a\nb", closeDate: "2020-01-01", closeTime: "10:00" }).error, /past/);
r = parseDraft({ q: "Q", opts: "a\nb", closeDate: "2099-05-01" });
assert.strictEqual(r.draft.closesAt, "2099-05-01T18:00:00"); // date only → 18:00
r = parseDraft({ q: "Q", opts: "a\nb", closeDate: "2099-05-01", closeTime: "09:30" });
assert.strictEqual(r.draft.closesAt, "2099-05-01T09:30:00");

// Preview / posted / chooser / form
const prev = buildPollPreview(r.draft);
assert.deepStrictEqual(prev.actions.map((a) => a.data.action), ["cpoll_post", "cpoll_edit", "cpoll_cancel"]);
assert.strictEqual(prev.actions[0].data.draft.closesAt, "2099-05-01T09:30:00");
assert.ok(!JSON.stringify(prev).includes("Input.ChoiceSet")); // preview isn't votable
const posted = buildPostedCard({ ...base, options: opts(2) });
assert.deepStrictEqual(posted.actions.map((a) => a.data.action), ["cpoll_remind", "cpoll_close"]);
assert.strictEqual(buildPostedCard({ ...base, options: opts(2), status: "closed" }).actions, undefined);
const ch = buildPollChooser([{ ...base, options: opts(2) }, { pollId: "weekly_attendance-2026-11-30", type: "weekly_attendance", weekStart: "2026-11-30" }], "close");
assert.deepStrictEqual(ch.actions.map((a) => a.title), ['"Team outing?"', "Weekly meal poll (week of Mon 30 Nov)"]);
assert.ok(ch.actions.every((a) => a.data.action === "cpoll_close"));
const form = JSON.stringify(buildNewPollForm({ question: "Q", options: ["a", "b"], multi: true }, "Oops"));
assert.ok(form.includes("Oops") && form.includes('"value":"a\\nb"') && form.includes('"id":"multi"'));

console.log("All custom poll card checks passed.");
