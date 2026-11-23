// Reminder/alert delivery: group vs private (1:1). Fake Teams API. Run: node scripts/testDelivery.js
const assert = require("assert"), os = require("os"), path = require("path"), fs = require("fs");
process.env.BOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "deliv-bot-"));
process.env.POLL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "deliv-poll-"));
const actions = require("../teamsActions");
const settings = require("../../poll/settings");
const announce = require("../../poll/announce");

const group = [], dms = [];
const api = { conversations: {
  getMembers: async () => [{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }, { id: "p3", name: "P3" }],
  create: async ({ members }) => { if (members[0].id === "p3") throw new Error("blocked"); return { id: "dm-" + members[0].id }; },
  createActivity: async (cid, m) => { (cid === "grp" ? group : dms).push({ cid, text: m.text, entities: m.entities }); return { id: "a" }; },
} };
const ctx = { activity: { from: { id: "hr" }, conversation: { id: "grp", conversationType: "groupChat", tenantId: "t1" } }, api, log: { warn() {} } };
const poll = { pollId: "weekly_attendance-2026-11-23", type: "weekly_attendance", weekStart: "2026-11-23", closesAt: "2026-11-23T10:00:00" };
const people = [{ userId: "p1", name: "P1" }, { userId: "p3", name: "P3" }];

(async () => {
  actions.useThisChat(ctx);
  actions.noteActivity(ctx); // learns the tenant id

  // Default is group
  assert.strictEqual(await settings.getDelivery(), "group");
  let r = await actions.sendReminder(poll, people, "group");
  assert.strictEqual(group.length, 1); assert.ok(group[0].entities.length === 2); assert.deepStrictEqual(r.failed, []); assert.strictEqual(dms.length, 0);

  // Private: one DM each; p3 can't be reached → @mentioned in the group instead
  group.length = 0;
  r = await actions.sendReminder(poll, people, "dm");
  assert.deepStrictEqual(dms.map((d) => d.cid), ["dm-p1"]);
  assert.ok(!dms[0].text.includes("above")); // wording fits a private message
  assert.deepStrictEqual(r.failed, ["P3"]);
  assert.strictEqual(group.length, 1); assert.ok(group[0].text.includes("P3") && !group[0].text.includes("P1"));

  // Santa reminder, same rules
  dms.length = 0; group.length = 0;
  r = await actions.sendSantaReminder({ title: "Santa" }, people, "dm");
  assert.strictEqual(dms.length, 1); assert.deepStrictEqual(r.failed, ["P3"]); assert.strictEqual(group.length, 1);

  // Announcements: group vs dm (everyone in the group)
  dms.length = 0; group.length = 0;
  await actions.postAnnouncement({ id: "x", text: "Switch off the AC", delivery: "group" });
  assert.strictEqual(group.length, 1); assert.strictEqual(dms.length, 0);
  group.length = 0;
  await actions.postAnnouncement({ id: "y", text: "Switch off the AC", delivery: "dm" });
  assert.deepStrictEqual(dms.map((d) => d.cid).sort(), ["dm-p1", "dm-p2"]); // p3 blocked; nothing posted in the group
  assert.strictEqual(group.length, 0);

  // Settings + announcement storage
  await settings.setDelivery("dm"); assert.strictEqual(await settings.getDelivery(), "dm");
  await assert.rejects(() => settings.setDelivery("sms"), /group/);
  assert.strictEqual((await announce.add({ text: "x", time: "18:30", days: ["mon"] })).delivery, "group");
  assert.strictEqual((await announce.add({ text: "x", time: "18:30", days: ["mon"], delivery: "dm" })).delivery, "dm");
  await assert.rejects(() => announce.add({ text: "x", time: "18:30", days: ["mon"], delivery: "fax" }), /delivery/);
  console.log("delivery tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
