# Merge notes: Snack Overflow (meal poll bot)

Merged on 2026-11-22 by Person A's Claude session, at Kishan's request (instead of a separate merge session).
Sources: `bot/` (Person A), `poll/` from `hackathon-personB.zip` (Person B), `task-split.md` v3.2 (Person B's latest copy, including the "no @mention on poll post" edit).

## 1. Contract check (before connecting anything)

Compared `poll/HANDOFF-B.md` "Functions provided" and `bot/HANDOFF-A.md` against `task-split.md` v3.2.

| Area | Result |
|---|---|
| Person B's 13 functions: names, params, returns, async (`startScheduler` sync), null vs throw | Match |
| Person A's 7 functions: async, throw on failure, `getMembers` → `[{ userId, name }]` | Match |
| Import paths | `require("../poll/poll")`, `require("../poll/scheduler")`, as stated in HANDOFF-B |
| Dates / times / time zone (Asia/Kolkata, no offset) | Match |
| weekStart rule (Monday on or after) | Same in `bot/dates.js` and `poll/scheduler.js` |
| `postPollCard` without @mention | Both sides agree (task-split v3.2 later edit) |

**No mismatches found**, so nothing needed resolving with the developers.

Person B's tests pass on Node 20.20.2 (Person B tested on Node 24).

## 2. What was connected / changed

| File | Change | Why |
|---|---|---|
| `poll/` | Copied in unchanged from the zip (minus `mocks/`) | Person B's half |
| `task-split.md` | Replaced with Person B's copy | It was newer (no-@mention edit) |
| `bot/app.js`, `bot/commands.js` | `require("./mocks/poll")` → `require("../poll/poll")` | Use the real logic |
| `bot/index.js` | Calls `startScheduler({ postPollCard, postSummary, postMenuCard, sendReminder, getMembers })` after the app starts. Real Teams: immediately. Playground: on the first incoming message. `POLL_SCHEDULER=off` disables it. | The scheduler must run inside the bot. In Playground the bot can't send until a message has arrived. |
| `bot/teamsActions.js` | `postSummary` now also flips the original poll card to "closed" | Scheduler-closed polls kept their vote buttons otherwise |
| `bot/teamsActions.js` | `app.api` fallback used only when `CLIENT_ID` is set; `onFirstActivity()` added | Avoid unauthenticated calls to Microsoft's endpoint from Playground |
| `bot/package.json` | `nodemonConfig.ignore: ["data/*"]` | Writing `bot/data/target.json` was restarting the bot under `npm run watch` |
| `bot/mocks/`, `poll/mocks/` | Deleted | Real functions connected; nothing references them |

## 3. How to run

No extra installs: `poll/` uses built-in Node only. Install the bot once with `cd bot && npm install`.

**Tests (all should pass):**
```bash
cd poll && node test.js && node test-menu.js && node test-scheduler.js
cd ../bot && node scripts/testDates.js && node scripts/testPollCard.js
```

**Playground:**
1. Terminal 1: `cd bot && npm run watch`
2. Terminal 2: `cd bot && npx @microsoft/m365agentsplayground`, which opens http://localhost:56150
3. In Group Chat, send `@Test Bot use this chat` (pick the bot from the @ list).
4. Run everything else from Personal Chat (`help` lists the commands).

**Scheduler demo (fast cycle: post → remind → close, repeating):**
```bash
cd bot && POLL_DEMO=1 POLL_DEMO_STEP_SECONDS=30 npm run watch
```
Then send any message in Playground; the scheduler starts on the first message. Polls and results appear in the chat set with `use this chat`.
Demo mode creates polls for future fake weeks. To keep them out of the real data, add `POLL_DATA_DIR=/tmp/polldemo`.

**Real Teams:** VS Code (open the `bot/` folder) → Run and Debug → "Debug in Teams (Chrome/Edge)". Then:
1. Add the bot to a group chat and send `@Snack Overflow use this chat` there.
2. Run commands from a 1:1 chat with the bot.

HR is checked by `HR_EMAIL` in `bot/env/.env.local` (currently Kishan's email).

## 3b. Current deployment (decided 2026-11-22)

- **Where it runs:** on Kishan's laptop, via VS Code **"Run bot (upload app manually in Teams)"** (dev tunnel; skips the toolkit's sideloading check). It only works while the laptop is awake and that run is active.
- **How Teams gets it (2026-11-23):** custom upload is still disabled for Kishan, so the app package (`bot/appPackage/build/appPackage.local.zip`) is **submitted to the org catalog** (Teams → Apps → Manage your apps → Upload an app → Submit an app to your org). The admin approves it in the Teams admin center, and it then appears under "Built for your org". Manifest changes (name, icon, commands) need re-submission and approval; code changes don't.
- **Permanent hosting:** postponed. It needs an always-on host with HTTPS, a persistent disk and a single instance (e.g. Azure App Service with Always On, or a small VM), then an org publish with admin approval.
- **While the laptop is off or asleep:**
  - posts and closes catch up when the bot starts again
  - reminder slots in that period are skipped
  - polls, votes and the target chat are kept on disk

## 4. Where data lives

| Data | File |
|---|---|
| Polls + votes | `poll/data/polls.json` |
| Menus | `poll/data/menus.json` |
| Schedule (after HR's first change) | `poll/data/schedule.json` |
| Target group chat | `bot/data/target.json` |

All are created on first write. No database is needed for one office. Person B's writes are atomic (temp file + rename).
Git: the project is in https://github.com/kishan4100/teams-bot (public). The root `.gitignore` excludes `node_modules/`, runtime data (`poll/data/`, `bot/data/`), and secrets/local settings (`bot/env/.env.local`, `bot/env/*.user`, `.localConfigs*`). After cloning, add `HR_EMAIL=...` to `bot/env/.env.local` yourself.

## 5. Verified vs not yet verified

**Verified:**
- All 5 test scripts.
- End-to-end against a fake Teams endpoint with the real `poll/` code: `use this chat`; manual start (re-posts the poll the scheduler had already created); votes saved to JSON; `remind` with @mentions; `set menu` using the real parser (sample menu → 5 days, 2 warnings) → Confirm → menu saved and posted; `show schedule`; `close poll` → results + card closed; late vote refused.
- Scheduler demo mode: both polls posted, reminders, close + results, cards flipped to closed, cycle repeats.
- Earlier, with mocks, in Playground: poll card, voting, start/close, `use this chat`.

**Not yet verified (needs Playground or real Teams):**
- The merged build in Playground.
- In real Teams:
  - the HR email check (`getMemberById` returning email/UPN)
  - the member list
  - @mentions actually notifying people
  - posting to the group using the API client from HR's 1:1 chat
  - the scheduler posting proactively via `app.api` after a restart
  - whether pasted menu text keeps its line breaks
- Whether custom app upload is allowed in the tenant. If not, use "Submit to org" + admin approval.

## 6. Known behaviour worth knowing

- **Catch-up posting:** the scheduler catches up. Starting the bot between Saturday 10:00 and Monday 10:00 creates that week's poll at once. If no group is set yet, or (in Playground) before the first message, the poll is created but not posted. HR's `start weekly poll` then posts it, with any votes kept.
- **Forgotten cards:** after a restart, the bot forgets which message holds each poll card. Votes still work (a click re-registers its card), and `start weekly poll` re-posts the card.
- **Weekly reminders:** they repeat every 30 minutes from the start time, but only between 09:00 and 21:00. Friday reminders have no time window.
- **Reminder grid:** reminders fire on an exact 30-minute grid, so a slot is skipped if the bot is down at that minute (Person B's known issue). Posts and closes do catch up.

## 7. AI features (Kompass), added 2026-11-23

The bot calls two workflows on Kompass, DotKonnekt's AI platform (dev, tenant `devtest`, project "Snack Overflow"). Code: `bot/kompass.js`, wired in `bot/commands.js` and `bot/app.js`.

| Feature | How to try it | Workflow |
|---|---|---|
| Food Q&A | "what's for lunch on Wednesday?", "did I vote?" | `SnackOverflow_Chat` |
| Plain-English HR commands | "push the friday cutoff to half past 12" → runs `set schedule friday close fri 12:30` (HR check still applies) | `SnackOverflow_Chat` |
| AI menu reading | `set menu` with a messy menu; AI is used only when the normal parser gives warnings | `SnackOverflow_Extract` (task `menu`) |
| Feedback themes | anyone: `feedback 👍 loved the biryani`; HR: `feedback summary` (last 7 days) | `SnackOverflow_Extract` (task `feedback`) |

**Setup:** create `bot/.env` (gitignored) with `KOMPASS_PROJECT_ID=<Snack Overflow project id>`. Ask the team for the id; the project id is the only credential, so don't commit it. Without it, AI is off and the bot behaves as before.

**Test:** `cd bot && node scripts/testKompass.js` (offline) or `node scripts/testKompass.js live` (calls Kompass).

**Notes:**
- Replies take about 3–5 s (menu: about 10 s). The bot shows no typing indicator while it waits.
- Feedback is stored anonymously (date + text only) in `bot/data/feedback.json`.
- Only the asking user's own vote and the saved menus go to the AI, never other people's names or votes.
- Cost per call is shown in Kompass Traces (about $0.008 per chat call in testing).
