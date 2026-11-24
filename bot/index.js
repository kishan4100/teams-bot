require("./proxy");
const app = require("./app");

// Node 20 stops the process on an unhandled promise rejection. A bot should log it and keep serving everyone else.
process.on("unhandledRejection", (reason) => console.error("[unhandled rejection]", reason && reason.stack ? reason.stack : reason));
const actions = require("./teamsActions");
const { startScheduler } = require("../poll/scheduler");

// Start the application
(async () => {
  await app.start();
  console.log(`\nBot started, app listening to`, process.env.PORT || process.env.port || 3978);

  // Person B's scheduler runs inside the bot process and calls these bot functions.
  // Normal mode checks every 30 s; POLL_DEMO=1 (+ POLL_DEMO_STEP_SECONDS) runs post → remind → close quickly.
  // Set POLL_SCHEDULER=off to disable it (e.g. while testing manual commands only).
  if (process.env.POLL_SCHEDULER !== "off") {
    const { postPollCard, postSummary, postMenuCard, sendReminder, getMembers, postAnnouncement } = actions;
    const start = () => startScheduler({ postPollCard, postSummary, postMenuCard, sendReminder, getMembers, postAnnouncement });
    if (process.env.CLIENT_ID) {
      start(); // real Teams: the bot can post proactively right away
    } else {
      // Playground (no bot credentials): the bot can only send once a message has arrived, so wait for one.
      console.log("[scheduler] waiting for the first message (Playground mode), then starting");
      actions.onFirstActivity(start);
    }
  }
})();
