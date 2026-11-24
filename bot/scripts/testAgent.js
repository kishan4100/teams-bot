// Tests the agent's routing/permissions/validation with a fake model (no network). Run: node scripts/testAgent.js
const assert = require("assert");
const os = require("os"), path = require("path"), fs = require("fs");
process.env.POLL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agent-test-"));
process.env.BOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bot-"));
process.env.KOMPASS_PROJECT_ID = "x";
process.env.KOMPASS_AGENT_FLOW_ID = "y";
process.env.HR_USER_ID = "hr1";
const kompass = require("../kompass");
const agent = require("../agent");

let fake; // what the "model" replies next
let seen; // last inputs sent to the model
kompass.agent = async (inputs) => { seen = inputs; return typeof fake === "function" ? fake(inputs) : fake; };

const mk = (id) => {
  const sent = [];
  return {
    sent,
    activity: { from: { id, name: id }, conversation: { id: "c1", conversationType: "personal" }, value: null },
    log: { warn() {}, error() {}, info() {} },
    send: async (m) => sent.push(m),
    api: {},
  };
};
const text = (m) => (typeof m === "string" ? m : JSON.stringify(m));

(async () => {
  // Catalog is per user
  const hrNames = agent.buildCatalog(true).map((t) => t.name);
  const userNames = agent.buildCatalog(false).map((t) => t.name);
  assert.ok(hrNames.includes("close_poll") && hrNames.includes("set_schedule"));
  assert.deepStrictEqual([...userNames].sort(), ["my_santa", "my_votes", "open_polls", "secret_santa_status", "send_feedback", "show_menu"]);
  assert.ok(!userNames.some((n) => /draw|start_|close|remind|set_|summary/.test(n)));
  assert.ok(!JSON.stringify(agent.buildCatalog(true)).includes('"run"'));

  // Validation
  const set = agent.TOOLS.find((t) => t.name === "set_schedule");
  assert.deepStrictEqual(agent.validateArgs(set, { kind: "Friday", event: "close", day: "fri", time: "12:30", junk: 1 }).args, { kind: "friday", event: "close", day: "fri", time: "12:30" });
  assert.ok(agent.validateArgs(set, { kind: "friday", event: "close", day: "fri", time: "12.30pm" }).error);
  assert.ok(agent.validateArgs(set, { kind: "monthly", event: "close", day: "fri", time: "12:30" }).error);
  assert.ok(agent.validateArgs(set, { kind: "friday" }).error);
  assert.deepStrictEqual(agent.parseReply('```json\n{"type":"unknown"}\n```'), { type: "unknown" });
  assert.strictEqual(agent.parseReply("not json"), null);

  // HR: tool with confirm → confirmation card, nothing run yet
  let c = mk("hr1");
  fake = { type: "tool", name: "set_schedule", args: { kind: "friday", event: "close", day: "fri", time: "12:30" } };
  assert.strictEqual(await agent.handleMessage(c, "push the friday cutoff to half past 12"), true);
  assert.strictEqual(c.sent.length, 1);
  assert.ok(text(c.sent[0]).includes("agent_confirm"));
  assert.strictEqual(JSON.parse(seen.tools).length, hrNames.length);
  assert.strictEqual(seen.is_hr, "true");

  // Non-HR asking for an HR tool → refused by code even if the model returns it
  c = mk("user1");
  fake = { type: "tool", name: "close_poll", args: {} };
  assert.strictEqual(await agent.handleMessage(c, "close the poll"), true);
  assert.deepStrictEqual(c.sent, ["Only HR can do that."]);
  assert.strictEqual(seen.is_hr, "false");
  assert.deepStrictEqual(JSON.parse(seen.tools).map((t) => t.name), userNames);

  // Unlisted tool
  c = mk("hr1");
  fake = { type: "tool", name: "draw_santa", args: {} };
  await agent.handleMessage(c, "do santa");
  assert.deepStrictEqual(c.sent, ["I can't do that yet."]);

  // Missing arg → question, and the turn is remembered for the next call
  c = mk("hr1");
  fake = { type: "ask", question: "What are the options?" };
  await agent.handleMessage(c, "make a poll about lunch");
  assert.deepStrictEqual(c.sent, ["What are the options?"]);
  fake = { type: "answer", text: "ok" };
  await agent.handleMessage(mk("hr1"), "pizza, pasta");
  const convo = JSON.parse(seen.conversation); // earlier turns (incl. what was done before) + this ask/answer
  assert.deepStrictEqual(convo.slice(-2).map((t) => t.text), ["make a poll about lunch", "What are the options?"]);

  // Answer / unknown / junk / model failure
  c = mk("user1");
  fake = { type: "answer", text: "Lunch is dal." };
  assert.strictEqual(await agent.handleMessage(c, "what's for lunch?"), true);
  assert.deepStrictEqual(c.sent, ["Lunch is dal."]);
  fake = { type: "unknown" };
  assert.strictEqual(await agent.handleMessage(mk("user1"), "hi"), false);
  fake = "garbage"; assert.strictEqual(await agent.handleMessage(mk("user1"), "hi"), false);
  fake = () => { throw new Error("boom"); }; assert.strictEqual(await agent.handleMessage(mk("user1"), "hi"), false);

  // Tool without confirm runs straight away (everyone tool: send_feedback)
  c = mk("user1");
  fake = { type: "tool", name: "send_feedback", args: { text: "loved the biryani" } };
  await agent.handleMessage(c, "feedback loved the biryani");
  assert.ok(c.sent.some((m) => /saved anonymously/.test(text(m))));
  fs.rmSync(path.join(__dirname, "..", "data", "feedback.json"), { force: true }); // created by the test

  // Confirm button: non-HR refused; HR with bad args refused; tampered tool name refused
  c = mk("user1"); c.activity.value = { action: "agent_confirm", tool: "close_poll", args: {} };
  await agent.handleAction(c);
  assert.ok(/only HR/.test(c.sent[0]));
  c = mk("hr1"); c.activity.value = { action: "agent_confirm", tool: "set_schedule", args: { kind: "x" } };
  await agent.handleAction(c);
  assert.ok(/couldn't do that/.test(c.sent[0]));
  c = mk("hr1"); c.activity.value = { action: "agent_confirm", tool: "send_feedback", args: { text: "hi" } }; // no confirm step → not allowed via button
  await agent.handleAction(c);
  assert.ok(/couldn't do that/.test(c.sent[0]));

  // Scheduling an announcement: HR gets a confirm card; clicking Yes saves it
  c = mk("hr1");
  fake = { type: "tool", name: "schedule_announcement", args: { text: "Please switch off the AC and lights before leaving.", time: "18:30", days: ["weekdays"] } };
  await agent.handleMessage(c, "remind everyone at 6:30pm mon to fri to switch off ac");
  assert.ok(text(c.sent[0]).includes("agent_confirm") && text(c.sent[0]).includes("18:30"));
  const yes = mk("hr1"); yes.activity.value = { action: "agent_confirm", tool: "schedule_announcement", args: { text: "Please switch off the AC and lights before leaving.", time: "18:30", days: ["weekdays"] } };
  await agent.handleAction(yes);
  assert.ok(yes.sent.some((m) => /Scheduled at 18:30 on mon, tue, wed, thu, fri, every week/.test(text(m))));
  assert.strictEqual(require("../../poll/announce").loadAllSync().length, 1);
  c = mk("user1"); fake = { type: "tool", name: "schedule_announcement", args: {} };
  await agent.handleMessage(c, "remind everyone"); assert.deepStrictEqual(c.sent, ["Only HR can do that."]);

  // One-day alert: needs a future date; both/neither days+date are questions; list shows "once on"
  const once = (args) => { const x = mk("hr1"); x.activity.value = { action: "agent_confirm", tool: "schedule_announcement", args }; return agent.handleAction(x).then(() => x.sent.map(text).join(" | ")); };
  assert.ok(/Scheduled once on 2099-01-05 at 17:00/.test(await once({ text: "Party at 5!", time: "17:00", date: "2099-01-05" })));
  assert.ok(/already passed/.test(await once({ text: "Old", time: "17:00", date: "2020-01-05" })));
  assert.ok(/one-day alert or a repeating/.test(await once({ text: "x", time: "17:00", date: "2099-01-05", days: ["mon"] })));
  assert.ok(/repeat on certain days/.test(await once({ text: "x", time: "17:00" })));
  c = mk("hr1"); fake = { type: "tool", name: "list_announcements", args: {} };
  await agent.handleMessage(c, "list"); assert.ok(/once on 2099-01-05 at 17:00/.test(text(c.sent[0])));

  // List alerts as a card with Delete buttons; deleting updates the card; non-HR can't delete
  const announce = require("../../poll/announce");
  for (const al of await announce.list()) await announce.remove(al.id);
  const a1 = await announce.add({ text: "Switch off the AC", time: "18:30", days: ["weekdays"] });
  const a2 = await announce.add({ text: "Party at 5!", time: "17:00", date: "2099-01-05", delivery: "dm" });
  c = mk("hr1"); fake = { type: "tool", name: "list_announcements", args: {} };
  await agent.handleMessage(c, "show my alerts");
  const listed = text(c.sent[0]);
  assert.ok(listed.includes("Scheduled alerts (2)") && listed.includes("Switch off the AC") && listed.includes("once on 2099-01-05") && listed.includes("agent_delete_alert") && listed.includes(a1.id));
  const del = mk("hr1"); del.activity.value = { action: "agent_delete_alert", id: a1.id }; del.activity.replyToId = "m1";
  await agent.handleAction(del);
  assert.deepStrictEqual((await announce.list()).map((x) => x.id), [a2.id]);
  const nh = mk("user1"); nh.activity.value = { action: "agent_delete_alert", id: a2.id };
  await agent.handleAction(nh); assert.ok(/only HR/.test(nh.sent[0])); assert.strictEqual((await announce.list()).length, 1);
  const again = mk("hr1"); again.activity.value = { action: "agent_delete_alert", id: a1.id }; again.activity.replyToId = "m1";
  await agent.handleAction(again); // already deleted: no crash
  await announce.remove(a2.id);
  c = mk("hr1"); await agent.handleMessage(c, "show my alerts"); assert.ok(text(c.sent[0]).includes("Scheduled alerts (0)"));

  // Actions taken are remembered per user and sent to the model next time (recent_actions) + kept in the conversation
  c = mk("memo1"); fake = { type: "tool", name: "send_feedback", args: { text: "great biryani" } };
  await agent.handleMessage(c, "feedback great biryani");
  fs.rmSync(path.join(__dirname, "..", "data", "feedback.json"), { force: true });
  fake = { type: "answer", text: "ok" };
  await agent.handleMessage(mk("memo1"), "do that again");
  const sentCtx = JSON.parse(seen.context);
  assert.strictEqual(sentCtx.recent_actions.length, 1);
  assert.deepStrictEqual([sentCtx.recent_actions[0].tool, sentCtx.recent_actions[0].status, sentCtx.recent_actions[0].args.text], ["send_feedback", "done", "great biryani"]);
  assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(sentCtx.recent_actions[0].at));
  assert.ok(JSON.parse(seen.conversation).some((t) => t.role === "bot" && t.text.includes("ran send_feedback")));
  await agent.handleMessage(mk("someone-else"), "hi");
  assert.deepStrictEqual(JSON.parse(seen.context).recent_actions, []); // other users never see it
  // cancelled and failed are recorded too
  const cx = mk("hr1"); cx.activity.value = { action: "agent_cancel", tool: "close_poll", args: {} }; await agent.handleAction(cx);
  assert.ok(agent.recentActions("hr1").some((a) => a.tool === "close_poll" && a.status === "cancelled by user"));
  for (let i = 0; i < 12; i++) { const y = mk("memo2"); fake = { type: "tool", name: "send_feedback", args: { text: "n" + i } }; await agent.handleMessage(y, "fb"); }
  fs.rmSync(path.join(__dirname, "..", "data", "feedback.json"), { force: true });
  assert.strictEqual(agent.recentActions("memo2").length, 8); // keeps the last 8
  assert.ok(fs.existsSync(path.join(process.env.BOT_DATA_DIR, "agent-actions.json"))); // saved to disk

  // "did I vote?" covers any-topic polls too: single answer, several answers, not voted, anonymous
  const msg = async (id, tool, args) => { const x = mk(id); fake = { type: "tool", name: tool, args }; await agent.handleMessage(x, "x"); return x.sent.map(text).join(" | "); };
  const polls = require("../../poll/poll");
  const p1 = await polls.createCustomPoll({ question: "Where should we go for the team outing?", options: ["Beach", "Hills", "City"] });
  const p2 = await polls.createCustomPoll({ question: "Which snacks?", options: ["Samosa", "Cake", "Fruit"], multi: true, anonymous: true });
  const p3 = await polls.createCustomPoll({ question: "Pick a day", options: ["Fri", "Sat"] });
  await polls.recordVote(p1.pollId, "voter1", "Voter One", "o2");
  await polls.recordVote(p2.pollId, "voter1", "Voter One", "o1,o3");
  const mv = await msg("voter1", "my_votes", {});
  assert.ok(mv.includes('Poll "Where should we go for the team outing?" (open): Hills'), mv);
  assert.ok(mv.includes("Samosa, Fruit"), mv);                       // several answers, anonymous poll: own choice still shown
  assert.ok(mv.includes('"Pick a day" (open): not voted yet'), mv);
  assert.ok(!(await msg("voter2", "my_votes", {})).includes("Hills")); // someone else's votes are never shown
  const ctxVotes = (await require("../commands").internals.chatContext(mk("voter1"))).my_votes;
  assert.ok(ctxVotes.includes("Hills") && ctxVotes.includes("Samosa, Fruit")); // and the model gets them in its context too
  await polls.closePoll(p1.pollId); await polls.closePoll(p2.pollId); await polls.closePoll(p3.pollId);

  // Registry sanity: unique names, known types, every tool runs something, HR tools that change things have confirm
  const names = agent.TOOLS.map((t) => t.name);
  assert.strictEqual(new Set(names).size, names.length);
  for (const t of agent.TOOLS) {
    assert.ok(typeof t.run === "function" && ["hr", "everyone"].includes(t.who) && t.description, t.name);
    for (const d of Object.values(t.args)) assert.ok(["string", "number", "boolean", "date", "time", "datetime", "list"].includes(d.type), t.name);
  }
  for (const n of ["close_poll", "reopen_poll", "remind_voters", "start_weekly_poll", "start_friday_poll", "set_schedule", "start_secret_santa", "draw_secret_santa", "remind_secret_santa", "set_reminder_delivery", "schedule_announcement", "cancel_announcement"]) assert.ok(agent.TOOLS.find((t) => t.name === n).confirm, n + " needs confirm");

  console.log("agent tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
