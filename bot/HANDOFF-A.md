# Handoff: Person A
Last updated: 2026-11-22 (MERGED with Person B's poll/; see ../MERGE-NOTES.md)
Contract version followed: v3.2 (incl. later edits)

## Status
- Done:
  - Project scaffolded in `bot/` (Agents Toolkit "Simple Bot", JavaScript, `atk` CLI 1.1.19, Teams SDK v2)
  - Poll card (`cards/pollCard.js`), summary card (`cards/summaryCard.js`)
  - Vote click → `recordVote` → `updatePollCard`. **Checked in Agents Playground**: the card is edited in place and a re-vote moves the vote.
  - `use this chat` (target group, saved to `bot/data/target.json`). Tested against a fake Teams endpoint: commands from the 1:1 chat before it's set → clear error; after it → poll posted to the group and the preview stays in the 1:1 chat; after a restart, posts still go to the group.
  - `show schedule` / `set schedule <weekly|friday> <post|remind|close> <day> <HH:mm>` → `getSchedule` / `setSchedule`. setSchedule's error messages are shown to HR as-is; a partial `set schedule …` shows the format. Unit-tested against the mock; not yet checked in Playground.
  - `use this chat` **checked in Playground** (Group Chat, with @mention).
  - `remind [weekly|friday]` → `getMembers` → `getNonVoters` → `sendReminder` (@mentions non-voters in chunks of 20). If `getMembers` fails → general reminder without mentions, and HR is told. If everyone has voted → nothing posted, and HR is told. Tested against a fake Teams endpoint (member list with 25 people incl. a bot; member-list failure); **not yet checked in Playground** (unknown whether Playground supports the member list).
  - Commands `help`, `start weekly poll`, `start friday poll`, `close poll [weekly|friday]` (`commands.js`), with an HR-only check (`HR_USER_ID`)
  - Contract functions `postPollCard`, `updatePollCard`, `postSummary`, `postMenuPreview`, `postMenuCard` (`teamsActions.js`)
  - Start/close commands **checked in Playground** (2026-11-22): help, start weekly poll, close poll weekly; the card switched to closed.
  - `set menu` alone → a card with a multi-line text box + Preview button (`menu_text` action). This is needed because Playground's message box drops line breaks when pasting. `set menu` + pasted text in the same message also works. Either way → `parseMenu` → preview card (warnings, days) → Confirm → `saveMenu` → `postMenuCard`; Cancel; when `weekStart` is null, a week picker (Input.Date, defaults to the coming Monday) → `setMenuWeek` → the preview is updated in place with Confirm. Tested against a fake Teams endpoint; **not yet checked in Playground.**
- In progress: none
- Not started:

## How to run
- Install: `cd bot && npm install`
- Bot: `npm run watch` (nodemon, reloads on file changes) or `npm start`. Port 3978, endpoint `/api/messages`. With no CLIENT_ID, auth is off (template behaviour).
- Playground, second terminal: `npx @microsoft/m365agentsplayground` → opens http://localhost:56150 → Personal Chat. Or VS Code (open the `bot/` folder) → Run and Debug → "Debug in Microsoft 365 Agents Playground".
- Tests: `node scripts/testPollCard.js` and `node scripts/testDates.js`
- Env vars (HR check, `commands.js` `isHr`):
  - `HR_EMAIL`: HR's email / UPN (comma-separated list allowed, case-insensitive). The sender is looked up with `api.conversations.getMemberById(conversationId, from.id)` and their `email` / `userPrincipalName` compared; successful lookups are cached per user, failed lookups are refused and not cached. **Set in `env/.env.local` (gitignored) as Kishan's email for now; HR will change it later.** It reaches the bot only in real-Teams local debug, via `m365agents.local.yml` → `.localConfigs`.
  - `HR_USER_ID` (optional alternative): Teams user id (`activity.from.id`) or AAD object id.
  - **If neither is set, everyone is treated as HR.** That's the case in Playground (`.localConfigs.playground` and plain `npm start` don't set them), so testing works with Playground's fake user.
  - Not verified in real Teams: that `getMemberById` returns `email` or `userPrincipalName` for chat members. Tested against a fake endpoint only.

## Files
- `index.js`: starts the app, then Person B's `startScheduler({ postPollCard, postSummary, postMenuCard, sendReminder, getMembers })`. Real Teams (CLIENT_ID set): starts immediately. Playground: starts on the first incoming message (`actions.onFirstActivity`). `POLL_SCHEDULER=off` disables it.
- `app.js`: message handler. Order: vote click (`activity.value.action === "vote"`) → `handleVote`; menu card buttons (`menu_text` / `menu_setweek` / `menu_confirm` / `menu_cancel`) → `handleMenuAction`; then `handleCommand`; then the template's `/reset` `/count` `/diag` `/state` `/runtime` and my `/pollcard [friday]` test command; anything else → "Type help".
- `commands.js`: text commands, menu preview button handling, and the HR check. Converts HTML text (`<p>`, `<br>`, entities) to plain lines before matching. Uses `dates.js`, `teamsActions.js` and the poll module (mock).
- `dates.js`: Asia/Kolkata "today", the weekStart rule, the Friday on or after today, and `closesAtFor(anchor, scheduleEntry)`.
- `teamsActions.js`: Person A contract functions, plus internal `init`, `noteActivity`, `useThisChat`, `getTargetInfo`, `setTarget`, `rememberPollCard`, `hasPollCard`, `cardMessage`.
- `data/target.json` (created at runtime, gitignored): the saved target chat.
- `cards/pollCard.js`: `buildPollCard(poll)`.
- `cards/menuCards.js`: `buildMenuInputCard()`, `buildMenuPreviewCard(menu, { status, defaultWeek })` and `buildMenuCard(menu)`. The whole menu object rides in the preview buttons' `data`, so Confirm works after a restart.
- `cards/summaryCard.js`: `buildSummaryCard(summary)`. Counts + names per option; weekly also shows Breakfast count = bf_lunch and Lunch count = bf_lunch + lunch_only.
- `scripts/testPollCard.js`, `scripts/testDates.js`: assertion scripts.
- `m365agents.local.yml`: template file, plus one line passing `HR_EMAIL` into `.localConfigs`.
- `appPackage/manifest.json`: template file with the name ("Snack Overflow" / "Snack Overflow: the meal poll bot", joke name chosen by Kishan on 2026-11-22), descriptions and command list changed to this bot's commands. Bot scopes unchanged (personal, team, groupChat).
- `env/.env.local`: template file (gitignored), plus `HR_EMAIL=…`.
- `config.js`, `proxy.js`, other `m365agents*.yml`, other `env/` files, `infra/`, appPackage icons: unchanged template files.

## Functions provided (ACTUAL code, not planned)
Contract functions, in `bot/teamsActions.js` (CommonJS; from `poll/` use `require("../bot/teamsActions")`). All async; they throw on failure.
- `postPollCard(poll)` → resolves to nothing. Posts the poll card to the target chat and remembers its message id for that pollId. Throws if there is no target chat yet, or Teams rejects the send. **No @mention yet.**
- `updatePollCard(poll)` → resolves to nothing. Edits the posted card in place (counts, or the "closed" state with no buttons). Throws if no card is known for that pollId.
- `postSummary(summary)` → resolves to nothing. Posts the results card. Throws if there is no target chat.
- `postMenuPreview(menu)` → resolves to nothing. Posts the preview to the **HR chat** (where HR typed the last command; falls back to the target chat). Buttons: Confirm/Cancel, or a week picker when `menu.weekStart` is null.
- `postMenuCard(menu)` → resolves to nothing. Posts the clean day-by-day menu card to the target chat.
- `getMembers()` → `[{ userId, name }]` from `api.conversations.getMembers(targetConversationId)`. `userId` = Teams user id (`29:...`), same as votes. Bots (ids starting with `28:`) are excluded. Throws if there is no target or Teams refuses.
- `sendReminder(poll, nonVoters)` → resolves to nothing. Posts to the target chat:
  - `nonVoters` = array → "⏰ Reminder…" text + @mentions (standard `<at>Name</at>` text + `mention` entities), max 20 per message (my own cap, not a verified Teams limit), extra messages for the rest
  - `[]` → posts nothing
  - `null`/not an array → general reminder with no mentions (the contract's "else @mention the channel/group" fallback; mentioning the whole group isn't implemented)

Where messages go (agreed with Kishan: HR works 1:1 with the bot, results go to the group):
- **Target chat** (poll cards, summaries, menu card): set only by HR sending `use this chat` in the meal-poll group. Saved to `bot/data/target.json` (`{ conversationId, conversationType, setAt }`; gitignored), so it **survives restarts**. Until it's set, every posting function throws "No group chat set yet…", and HR sees that message.
- **HR chat** (menu preview, paste box): wherever HR typed the command (`setTarget(ctx)`, in memory).
- **API client for sending**: `ctx.api` from the most recent incoming activity in any chat (`noteActivity`, called first in `app.js`). It points at the right service URL, which is what makes Playground work. Fallback when nothing has arrived since startup (e.g. the scheduler fires first after a restart): `app.api` via `init(app)`, which needs real bot credentials (real Teams). Assumption, not verified: in real Teams the 1:1 chat and the group share a service URL, so the client from HR's 1:1 chat can post to the group. `app.send()` is not used: it throws "App has no credentials set up" without CLIENT_ID.
- The pollId → card message id map is still in memory; after a restart, a vote click re-registers its card from `replyToId`.
- `postSummary` also refreshes the original poll card to "closed" (best effort), so scheduler-closed polls lose their buttons too.
- `getApi()` falls back to `app.api` only when `CLIENT_ID` is set; otherwise it throws until a message has arrived.

User id convention: votes use `activity.from.id` as `userId`. `getMembers()` must return the same kind of id, so that `getNonVoters` matches.

## Functions I expect from the other person
**Merged:** `require("../poll/poll")` in `app.js` and `commands.js`; `require("../poll/scheduler")` in `index.js`; `teamsActions.postSummary` also calls `getPoll` (to flip the card to closed). All calls are awaited.
- `app.js` `handleVote`: `recordVote`. Throws → the user sees "poll couldn't be found". Returns a closed poll → "poll is closed".
- `app.js` `/pollcard` test command: `createPoll`
- `commands.js`:
  - `start weekly poll` / `start friday poll`: `getSchedule`, `getPoll` (to detect an existing poll), `createPoll`
  - `close poll`: `getOpenPolls`, `closePoll`, `getPoll`
  - `remind`: `getOpenPolls`, `getNonVoters(pollId, members)` with members from `getMembers()`
  - `show schedule` / `set schedule`: `getSchedule`, `setSchedule(kind, event, day, time)` (kind/event lowercased; day and time passed through as typed)
  - `set menu`: `parseMenu`. Preview buttons (`handleMenuAction`): `setMenuWeek` (week picker), `saveMenu` (Confirm). If `saveMenu` throws, HR sees the message and the preview stays as it was.
- Errors thrown inside any command are caught and shown to HR as "Sorry, that didn't work: <message>".

## Mocks to replace at merge
Done on 2026-11-22: `bot/mocks/` and `poll/mocks/` were deleted; real modules are connected.

## Deviations from the contract
- `postPollCard(poll)` posts the card **without an @mention**. Kishan decided on 2026-11-22: "mention not needed, only reminder notification is enough". `sendReminder` @mentions non-voters. Signature and behaviour are otherwise unchanged; Person B's code is not affected. To do: Kishan tells Person B and updates the `postPollCard` row in task-split.md.

## Decisions agreed with the other person
Agreed 2026-11-22, via the developers (items 1–4, 6, 7, 9 proposed by A; 5, 8, 10, 11 are Person B's final answers; A to send OK on 10 and 11):
1. Module format: CommonJS (`require` / `module.exports`). The bot template is CommonJS.
2. All Person B functions are `async`; A always `await`s them.
3. `getPoll` / `getMenu` return `null` when not found. `createPoll` throws on an unknown type. `recordVote` throws on an unknown poll or invalid option, and on a closed poll returns the poll unchanged (A checks `poll.status === "closed"`).
4. `createPoll` with an existing pollId returns the existing poll and keeps its votes.
5. Times: `"YYYY-MM-DDTHH:mm:ss"` office local time, no offset; dates `"YYYY-MM-DD"`. **Time zone: Asia/Kolkata (confirmed).**
6. `closesAt` may be `null`.
7. `closePoll` on an already-closed poll returns the same summary again.
8. **No Friday check:** `createPoll("friday_diet", { date })` accepts any date.
9. B's storage is `poll/data/polls.json` and `poll/data/menus.json`, built-in Node only.
10. `closePoll` and `getNonVoters` throw on an unknown pollId.
11. `createPoll` throws if weekStart/weekEnd (weekly) or date (friday) is missing or not `YYYY-MM-DD`.

Person B's real `poll/poll.js` implements all of the above (merged 2026-11-22).

Open-question answers from Kishan (from HR), 2026-11-22. **Now in task-split.md v3.2 (later edits), which is the source of truth for times; the notes below are history:**
- Times (Asia/Kolkata):
  - Weekly poll posts on **Saturday (any time) for the following week**, and closes **Monday 10:00** (closesAt = `<weekStart>T10:00:00`).
  - Friday poll posts **Friday 08:30** and closes **Friday 12:00** (closesAt = `<date>T12:00:00`).
  - Reminders: **every 30 minutes, to people who haven't voted**, until the poll closes. Weekly poll: **every 30 min during the day only (09:00–21:00)**, no night reminders (Kishan chose option A on 2026-11-22; the exact hours are A's suggestion, not yet confirmed with HR). As of B's last message, B was still "waiting for HR" on night skipping, so this answer has not reached B yet.
- Proposed by B (2026-11-22), A says OK: if the menu text has no week dates, `parseMenu` does not throw. It returns `weekStart: null` and a warning, and `saveMenu` throws when `weekStart` is null. A's menu preview shows the warnings and has no Confirm button when `weekStart` is null. The mock implements this. B confirmed that `weekEnd` and every `days[].date` are also null in that case.
- Proposed by B (2026-11-22), A says OK, to go into task-split v3.2: new B function `setMenuWeek(menu, weekStart)` (async). It returns a NEW menu with weekStart set, weekEnd = +4 days, days[].date filled Monday–Friday, the "no week dates" warning removed, and a warning added if the date isn't a Monday. It throws if weekStart isn't YYYY-MM-DD. A must not fill these fields itself. A's flow: HR picks the Monday in the preview → setMenuWeek → preview shown again with Confirm → saveMenu. The mock implements this.
- Agreed with B (task-split v3.2): new B functions `getSchedule()` and `setSchedule(kind, event, day, time)`, both async. A adds the Teams commands `show schedule` and `set schedule <weekly|friday> <post|remind|close> <day> <HH:mm>`, HR only.
  - `day` is case-insensitive: a full name or any unambiguous start of 2+ letters (`sat`, `SATURDAY`, `th`). getSchedule always returns the full name ("Saturday"). `time` is 24-hour, `9:05` or `09:05`. setSchedule throws with a readable message on bad input, which A can show to HR as-is.
  - `remind` sets when reminders **start**. They repeat every 30 min to non-voters until close, and stop once everyone has voted. The 30 min can't be changed from Teams.
  - The getSchedule return shape is in v3.2 ("Schedule object"). The mock implements getSchedule and setSchedule with v3.2's defaults and validation.
- Agreed with B: all 7 A functions are async, throw on failure, and are exported from `bot/teamsActions.js`.
- B's scheduler start (from B): `const { startScheduler } = require('../poll/scheduler'); startScheduler(require('./teamsActions'));` called once at bot startup (e.g. in `index.js`). It is sync and returns a `stop()` function. B wraps every call to A's functions in try/catch and logs errors. **Not wired yet; the merge session should add this.**
- From B: the scheduler only auto-reminds and auto-closes polls that have a `closesAt`. So A's manual `start weekly poll` / `start friday poll` must pass a `closesAt`. Plan: work it out from `getSchedule()`'s close day and time, so manual and scheduled polls always agree. If a manual command already created that week's or day's poll, the scheduler won't post it again.
- Agreed with B (in v3.2): weekly `weekStart` = the coming Monday in Asia/Kolkata (Sat +2, Sun +1, Mon = today, Tue–Fri = next Monday).
- Vote visibility: **everyone can see who voted what** (like WhatsApp), so the summary shows names.
- Friday poll audience: **anyone can vote**, independent of their weekly answer. (This is A's reading of "they are different from weekly".)
- HR commands: **only HR** can run them, and there is **one HR person**. Plan: their Teams user ID goes in a bot setting; in Playground the test user counts as HR.

## Dependencies added
None beyond the template. The template installs `@microsoft/teams.apps@2.0.16` and `@microsoft/teams.common@2.0.16` (Teams SDK v2), plus `@azure/identity`, `undici`, `env-cmd` and `nodemon`. `app.js` also requires `@microsoft/teams.api`, which is not listed in package.json but is installed as a sub-dependency (template behaviour).

## Known issues / TODO
- HR check by email (`HR_EMAIL`) is implemented and tested against a fake endpoint (match, case-insensitive, cached, non-HR refused, lookup failure refused, unset → everyone). Not yet tested in real Teams.
- The template logs "skipAuth is deprecated, use dangerouslyAllowUnauthenticatedRequests". This is harmless and left as generated.
- Confirmed in Playground: `Action.Submit` clicks arrive as `message` activities with no text and `activity.value` = the button's data.
- Confirmed in Playground: editing a message (`updateActivity`) works, so the counts refresh in place.
- Tested against a fake Teams endpoint (2026-11-22): help; start weekly poll; 3 votes incl. 2 users and a revote; duplicate start → "already open"; start friday poll + vote; `close poll` with 2 open → asks which; `close poll weekly` → summary (Breakfast 2, Lunch 3, names) + card switches to closed with no buttons; vote after close → "poll is closed"; `close poll friday`; `close poll` with none open; unknown text → help hint; HR_USER_ID set → non-HR is refused, HR is allowed.
- Bot-side date choices (internal, not in the contract): `start friday poll` uses the Friday on or after today (Asia/Kolkata). closesAt = the schedule's close day/time on or before the anchor (weekly anchor = weekStart, Friday anchor = the poll date). If that time has already passed, HR gets a warning; the scheduler may then close the poll right away.
- `start ...` when that poll already exists: if it's closed → "already closed"; if its card is already in the current target chat → "already open in the group"; otherwise (never posted, e.g. the scheduler created it before a group was set; posted before a restart; or posted to an older target) the card is (re-)posted to the target with its current votes.
- The target chat is saved to `bot/data/target.json`. The pollId→message-id map is still in memory only.
- In real Teams the poll card is shared, so it can't show "your vote" per person; you see only counts.
- Observed in Playground (2026-11-22): pasting multi-line text into the normal message box loses the line breaks ("Shahi mixed vegPhulkaRiceDal"). That's why the input card exists; HR should use it.
- Teams HTML in pasted text: handled by `htmlToText`, but not verified against real Teams (Playground sends plain text).
- `Input.Date` value format assumed to be `YYYY-MM-DD` (Adaptive Cards spec); `setMenuWeek` throws otherwise. Check in Playground and real Teams.
- SDK facts read from typings, not yet tested: `api.conversations.getMembers(conversationId)` exists; `'card.action'` is the route for Action.Execute.

## Notes for the merge session
- Real-Teams test (2026-11-22): Kishan is uploading via Agents Toolkit "Debug in Teams". Results not yet recorded here.
- In group chats and channels, Teams (and Playground) only deliver a message to the bot if it **@mentions the bot**. Confirmed in Playground 2026-11-22: a plain `help` in Group Chat never reached the bot. `stripMentionsText` removes the mention before command matching, and `commands.js` also strips any leftover `<at>…</at>` text. Card button clicks don't need a mention.
- Demo setup: (1) in the group chat, HR sends `@<bot> use this chat`; (2) HR runs everything else in a 1:1 chat with the bot. In Playground: "Group Chat" is the group and "Personal Chat" is the 1:1.
- The bot is Teams SDK v2 (`@microsoft/teams.apps`), not botbuilder or `@microsoft/agents-hosting`.
