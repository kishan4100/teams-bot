// Secret Santa bot flow with a fake Teams API. Run: node scripts/testSanta.js
const assert = require("assert"), os = require("os"), path = require("path"), fs = require("fs");
process.env.POLL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "santa-bot-"));
process.env.BOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "santa-dm-"));
const actions = require("../teamsActions");
const santaBot = require("../santa");
const { buildSantaCard } = require("../cards/santaCards");
const santa = require("../../poll/santa");

const dms = [], updates = [];
const api = {
  conversations: {
    create: async ({ members }) => ({ id: "dm-" + members[0].id }),
    createActivity: async (cid, m) => { if (cid.startsWith("dm-")) dms.push({ cid, text: m.text }); return { id: "act1" }; },
    updateActivity: async (cid, id, m) => { updates.push(m); },
  },
};
actions.postCard = async () => ({ conversationId: "group", activityId: "act1" });
const mk = (id, type = "personal") => {
  const sent = [];
  return { sent, activity: { from: { id, name: "N-" + id }, conversation: { id: "c-" + id, conversationType: type, tenantId: "t1" }, value: null, replyToId: "act1" }, log: { warn() {}, error() {} }, send: async (m) => sent.push(m), api };
};

(async () => {
  const hr = mk("hr");
  await santaBot.startSanta(hr, { title: "Office Santa", budget: "Rs 500" });
  const ev = await santa.getCurrentEvent();
  const click = async (u, action) => { const c = mk(u, "groupChat"); c.activity.value = { action, eventId: ev.id }; await santaBot.handleAction(c); };
  for (const u of ["a", "b", "c"]) await click(u, "santa_join");
  assert.ok(JSON.stringify(updates.pop()).includes("3 joined"));
  await click("c", "santa_leave");
  await assert.rejects(() => santaBot.drawSanta(hr), /at least 3/); // too few: nothing sent
  assert.strictEqual(dms.length, 0);
  await click("c", "santa_join");
  await santaBot.drawSanta(hr);
  assert.strictEqual(dms.length, 3);
  assert.ok(dms.every((d) => d.text.includes("Secret Santa for") && !d.text.includes("N-" + d.cid.slice(3)))); // nobody gets themselves
  assert.ok(/Everyone has been told/.test(hr.sent[hr.sent.length - 1]));
  const g = mk("a", "groupChat"); await santaBot.mySanta(g);
  assert.ok(/1:1/.test(g.sent[0])); // never revealed in a group
  const p = mk("a"); await santaBot.mySanta(p);
  assert.ok(/Secret Santa for \*\*N-/.test(p.sent[0]));
  const outsider = mk("zzz"); await santaBot.mySanta(outsider);
  assert.ok(/didn't join/.test(outsider.sent[0]));
  assert.ok(!JSON.stringify(buildSantaCard(await santa.getCurrentEvent())).includes("assignments"));
  // A failing DM is reported, not fatal
  await santa.cancel(ev.id);
  await santaBot.startSanta(hr, { title: "Second" });
  const ev2 = await santa.getCurrentEvent();
  for (const u of ["x", "y", "z"]) { const c = mk(u, "groupChat"); c.activity.value = { action: "santa_join", eventId: ev2.id }; await santaBot.handleAction(c); }
  const hr2 = mk("hr"); hr2.api = { conversations: { ...api.conversations, create: async () => { throw new Error("blocked"); } } };
  await santaBot.drawSanta(hr2);
  assert.ok(/couldn't message/.test(hr2.sent[0]));
  // Reminder for people who haven't joined (before a draw)
  await santa.cancel(ev2.id);
  await santaBot.startSanta(hr, { title: "Third" });
  const ev3 = await santa.getCurrentEvent();
  const jc = mk("p1", "groupChat"); jc.activity.value = { action: "santa_join", eventId: ev3.id }; await santaBot.handleAction(jc);
  let reminded = null;
  actions.getMembers = async () => [{ userId: "p1", name: "P1" }, { userId: "p2", name: "P2" }, { userId: "p3", name: "P3" }];
  actions.sendSantaReminder = async (e, people) => { reminded = people.map((x) => x.userId); };
  const rh = mk("hr"); await santaBot.remindSanta(rh);
  assert.deepStrictEqual(reminded, ["p2", "p3"]);
  assert.ok(/2 of 3/.test(rh.sent[0]));

  // Known 1:1 chat is reused (no create); a stale one is re-created
  santaBot.rememberPersonal({ from: { id: "k" }, conversation: { id: "known-k", conversationType: "personal" } });
  santaBot.rememberPersonal({ from: { id: "g" }, conversation: { id: "grp", conversationType: "groupChat" } }); // groups ignored
  let created = [], sent = [];
  const api3 = { conversations: {
    create: async ({ members }) => { created.push(members[0].id); return { id: "new-" + members[0].id }; },
    createActivity: async (cid) => { if (cid === "known-stale") throw new Error("gone"); sent.push(cid); return { id: "x" }; },
    updateActivity: async () => {} } };
  const probe = mk("hr"); probe.api = api3;
  await santaBot._dm(probe, "k", "t1", "hi");
  assert.deepStrictEqual([created, sent], [[], ["known-k"]]);
  await santaBot._dm(probe, "g", "t1", "hi");                 // unknown user → creates a chat
  await santaBot._dm(probe, "g", "t1", "again");              // second time reuses it
  assert.deepStrictEqual([created, sent.slice(1)], [["g"], ["new-g", "new-g"]]);
  santaBot.rememberPersonal({ from: { id: "s" }, conversation: { id: "known-stale", conversationType: "personal" } });
  await santaBot._dm(probe, "s", "t1", "hi");
  assert.deepStrictEqual([created, sent.slice(-1)], [["g", "s"], ["new-s"]]);
  console.log("santa bot tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
