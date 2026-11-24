// Runs every offline test and prints a summary. Run: npm test   (live Kompass calls are not included)
const { spawnSync } = require("child_process");
const path = require("path");
const bot = path.join(__dirname, "..");
const poll = path.join(__dirname, "..", "..", "poll");
const suites = [
  ...["test", "test-menu", "test-scheduler", "test-custom", "test-announce", "test-santa"].map((n) => [`poll/${n}`, poll, `${n}.js`]),
  ...["testDates", "testPollCard", "testCustomPoll", "testKompass", "testAgent", "testSanta", "testDelivery", "testLoad", "testSmallTalk"].map((n) => [`bot/${n}`, bot, `scripts/${n}.js`]),
];
let failed = 0;
for (const [name, cwd, file] of suites) {
  const r = spawnSync("node", [file], { cwd, encoding: "utf8" });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log((r.stdout + r.stderr).split("\n").slice(-12).join("\n"));
}
console.log(failed ? `\n${failed} suite(s) failed` : `\nAll ${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
