// Greetings / thanks / what-can-you-do are answered in code. Run: node scripts/testSmallTalk.js
const assert = require("assert"), os = require("os"), path = require("path"), fs = require("fs");
process.env.POLL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "st-"));
process.env.BOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "st-bot-"));
const { reply } = require("../smalltalk");
const { examplesFor, TOOLS, EXAMPLES } = require("../agent");
const r = (t, name = "Kishan HJ", hr = false) => reply(t, name, hr, examplesFor);

// Every tool has an example sentence (so help lists stay in sync), and HR sees more than everyone else
for (const t of TOOLS) assert.ok(EXAMPLES[t.name], `no example for ${t.name}`);
assert.ok(examplesFor(true).length > examplesFor(false).length);
assert.ok(!examplesFor(false).join(" ").includes("draw the secret santa"));
assert.ok(examplesFor(true).join(" ").includes("draw the secret santa"));
assert.strictEqual(examplesFor(true, 4).length, 4);
assert.strictEqual(examplesFor(false, 2)[0], "what's the menu tomorrow?"); // useful things first for everyone
assert.strictEqual(examplesFor(true, 1)[0], EXAMPLES.new_poll);

// Greetings in many forms, with first name
for (const g of ["hi", "Hello!", "hey there", "HEYYY", "hii", "good morning", "Good evening bot", "namaste", "yo", "hi @Snack Overflow", "<at>Snack Overflow</at> hello"]) {
  const x = r(g); assert.ok(x && x.includes("Kishan") && x.includes("Try one of these"), g);
}
assert.ok(r("good morning").startsWith("Good morning Kishan") && r("good evening").startsWith("Good evening Kishan")); // mirrors what they said
// Thanks, bye, how are you, who are you
for (const t of ["thanks", "thank you!", "thx", "ok thanks", "awesome", "👍 thanks"]) assert.ok(r(t) && /welcome|help|anytime|glad|😊|🙌|👍/i.test(r(t)), t);
assert.ok(/bye|later|care/i.test(r("bye")));
assert.ok(/great|ready/i.test(r("how are you")));
assert.ok(/Snack Overflow/.test(r("who are you")));
assert.strictEqual(r("👍"), "😊");
// What can you do: role-aware
const user = r("what can you do?"), hr = r("what can you do", "Asha", true);
assert.ok(user.includes("did I vote?") && !user.includes("draw the secret santa") && user.includes("HR-only"));
assert.ok(hr.includes("draw the secret santa") && hr.includes("every weekday at 6:30 pm") && !hr.includes("HR-only"));
assert.ok(r("help me") && r("what can i ask you"));
// Real requests are NOT swallowed
for (const t of ["hi, close the poll", "hello can you start the weekly poll", "thanks, now remind everyone", "close the poll", "make a poll", "what's for lunch", "ok so I want to make a poll about lunch", "great biryani today", ""]) assert.strictEqual(r(t), null, t);
// No name → still fine
assert.ok(r("hi", "").startsWith("Hi") || r("hi", "").startsWith("Hello") || r("hi", "").startsWith("Hey"));
console.log("small talk tests passed");
