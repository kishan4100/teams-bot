// node scripts/testKompass.js        → offline checks (no network)
// node scripts/testKompass.js live   → also calls the real Kompass workflows (needs KOMPASS_PROJECT_ID in bot/.env)
const assert = require("assert");
const kompass = require("../kompass");
const { aiMenu } = require("../commands");

(async () => {
  // aiMenu: AI output → parseMenu shape
  const ai = {
    weekStart: "2026-11-23",
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((day) => ({ day, breakfast: ["Idli", ""], lunch: ["Rice"] })),
    warnings: ["guessed lunch"],
  };
  const m = aiMenu(ai, "raw");
  assert.strictEqual(m.weekEnd, "2026-11-27");
  assert.strictEqual(m.days[4].date, "2026-11-27");
  assert.deepStrictEqual(m.days[0].breakfast, ["Idli"]); // empty items dropped
  assert.strictEqual(m.warnings.length, 2);
  assert.strictEqual(aiMenu({ ...ai, weekStart: "2026-11-24" }, "raw").weekStart, null); // not a Monday → week picker
  assert.throws(() => aiMenu({ days: [] }, "raw"));

  // runFlow: JSON output, string output, and errors (stubbed fetch)
  process.env.KOMPASS_PROJECT_ID = process.env.KOMPASS_PROJECT_ID || "test";
  const realFetch = global.fetch;
  const reply = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });
  global.fetch = reply(200, { success: true, data: { output: { type: "answer", text: "hi" } } });
  assert.deepStrictEqual(await kompass.chat({}), { type: "answer", text: "hi" });
  global.fetch = reply(200, { success: true, data: { output: '{"type":"unknown"}' } });
  assert.deepStrictEqual(await kompass.chat({}), { type: "unknown" });
  global.fetch = reply(403, { success: false, message: "Forbidden" });
  await assert.rejects(kompass.chat({}), /403: Forbidden/);
  global.fetch = realFetch;
  console.log("offline checks passed");

  if (process.argv[2] === "live") {
    const out = await kompass.chat({ message: "close the weekly poll", is_hr: "true", today: "2026-11-23 (Monday)", menu: "", my_votes: "" });
    assert.deepStrictEqual(out, { type: "command", command: "close poll weekly" });
    const menu = aiMenu(await kompass.extract("menu", "Mon: idli / rice, dal\nTue: poha / biryani\nWed: upma / roti, paneer\nThu: dosa / curd rice\nFri: bread / pulao", "2026-11-23"), "raw");
    assert.strictEqual(menu.days.length, 5);
    console.log("live checks passed:", JSON.stringify(menu.days[0]));
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
