# Handoff: Person B
Last updated: 2026-11-22
Contract version followed: v3.2

## Status
- Done: poll templates; createPoll, recordVote, getPoll, getOpenPolls, closePoll, getNonVoters; parseMenu, saveMenu, getMenu, setMenuWeek; getSchedule, setSchedule; scheduler (startScheduler, normal + demo mode); mocks of Person A's functions; 3 test scripts (all passing)
- In progress: none
- Not started: none
- HR answered (2026-11-22, via Kishan/Person A): default times below; weekly reminders 09:00–21:00 only; everyone sees who voted what; Friday poll open to anyone, separate from weekly

## How to run
- No `npm install` needed (built-in Node only; tested on Node v24.16.0).
- Tests: `cd poll && node test.js && node test-menu.js && node test-scheduler.js` → each prints `All ... tests passed`. Tests use a temp data dir, never `poll/data/`.
- Demo with mocks (no bot needed): `cd poll && POLL_DEMO=1 POLL_DEMO_STEP_SECONDS=10 node -e "require('./scheduler').startScheduler(require('./mocks/bot'))"`
- Env vars (all optional):
  - `POLL_DATA_DIR`: storage folder (default `poll/data/`)
  - `POLL_DEMO=1`: demo mode (post → remind → close, one step per interval, repeating with a fresh week each cycle)
  - `POLL_DEMO_STEP_SECONDS`: demo step length (default 60)

## Files
- `templates.json`: the two poll templates, copied exactly from the contract
- `poll.js`: poll functions, menu parser + save/get/setMenuWeek, schedule get/set, JSON-file storage
- `scheduler.js`: `startScheduler(bot)` (runs inside the bot process) + `tick(bot, nowMs)` (used by tests)
- `test.js`: poll tests (both types, revote, duplicate start, closed-poll vote, close twice, non-voters, errors)
- `test-menu.js`: sample menu → 5 days + warnings; missing dates/days; save/get
- `test-scheduler.js`: getSchedule/setSchedule, setMenuWeek, scheduler with a fake clock (post, no double post, 30-min reminders, skip when all voted, close, Friday catch-up, schedule change, bot function throwing)
- `mocks/bot.js`: fake versions of all 7 Person A functions (print to console; getMembers returns Ravi/Asha/Kiran)
- `data/polls.json`, `data/menus.json`, `data/schedule.json`: created at runtime on first write (not in source)

## Functions provided (ACTUAL code, not planned)
Import: `require('../poll/poll.js')` and `require('../poll/scheduler.js')` (CommonJS).
All `poll.js` functions are `async`. `startScheduler` is **sync**.

| Function | Returns | Errors |
|---|---|---|
| `createPoll(type, { weekStart, weekEnd, date, closesAt })` | poll object | throws on unknown type; weekly: throws if `weekStart`/`weekEnd` not `YYYY-MM-DD`; friday: throws if `date` not `YYYY-MM-DD` (any weekday accepted). If pollId already exists, returns it unchanged (votes kept). Missing `closesAt` → `null`. Irrelevant fields forced to `null`. |
| `recordVote(pollId, userId, name, optionId)` | updated poll | throws on unknown poll; throws on invalid optionId (open polls only). Closed poll → returned unchanged (check `poll.status === "closed"`). Revote replaces. `votedAt` = Asia/Kolkata `YYYY-MM-DDTHH:mm:ss`. |
| `getPoll(pollId)` | poll or `null` | none |
| `getOpenPolls()` | array of open polls | none |
| `closePoll(pollId)` | summary (every option in `counts`/`voters`, 0/empty if no votes) | throws on unknown poll. Already closed → same summary, nothing changed. |
| `getNonVoters(pollId, members)` | `[{ userId, name }]` from `members` who haven't voted | throws on unknown poll |
| `parseMenu(rawText)` | `{ weekStart, weekEnd, rawText, days, warnings }`; `days` always Mon–Fri (5) with `date`, `breakfast[]`, `lunch[]` | never throws. Fewer than 5 non-empty lines → warning "Only N line(s) found: line breaks may have been lost when pasting". No dates in text → `weekStart`, `weekEnd`, every `date` = `null` + warning. Missing day → empty arrays + warning. |
| `saveMenu(menu)` | `undefined` | throws if `menu.weekStart` not `YYYY-MM-DD`. Same week again → replaced. |
| `getMenu(weekStart)` | menu or `null` | none |
| `setMenuWeek(menu, weekStart)` | **new** menu (input untouched) with `weekStart`, `weekEnd` (+4), each `days[i].date` (Mon..Fri) filled; removes "No week dates" warning; adds "Week start X is not a Monday" if so | throws if `weekStart` not `YYYY-MM-DD` |
| `getSchedule()` | schedule object (below); defaults until `setSchedule` is first called | none |
| `setSchedule(kind, event, day, time)` | updated schedule (saved to `data/schedule.json`) | throws if kind not `weekly`/`friday`, event not `post`/`remind`/`close`, day unknown/ambiguous, time not `H:mm`/`HH:mm` 24h |
| `startScheduler(bot)` (scheduler.js) | `stop()` function | never throws from the timer; errors are logged |

Schedule object:
```json
{
  "weekly": { "post": { "day": "Saturday", "time": "10:00" }, "remind": { "day": "Monday", "time": "09:00" }, "close": { "day": "Monday", "time": "10:00" } },
  "friday": { "post": { "day": "Friday", "time": "08:30" }, "remind": { "day": "Friday", "time": "08:30" }, "close": { "day": "Friday", "time": "12:00" } },
  "remindEveryMinutes": 30
}
```
Day input: case-insensitive, any unambiguous prefix of 2+ letters (`sat`, `th`); stored/returned as full name. Time `9:05` → stored `09:05`.

Also exports `TEMPLATES` (poll.js) and `tick(bot, nowMs)` (scheduler.js, for tests).

### Scheduler behaviour (normal mode, checks every 30s, Asia/Kolkata)
- **Post:** if now is between the latest post time and the next close time, and this cycle's poll doesn't exist yet → `createPoll` with `closesAt` = that close time → `postMenuCard(menu)` (weekly only, if a menu is saved for that week) → `postPollCard(poll)`. Catches up if the bot was down at post time. If a poll with the same pollId already exists (e.g. started manually), does nothing.
  - Weekly `weekStart` = Monday on or after the post date. Friday `date` = the post date.
- **Remind:** for open polls with `closesAt`: starting at the remind time, every `remindEveryMinutes` until close → `getMembers()` → `getNonVoters` → `sendReminder(poll, nonVoters)`. Skipped when nobody is missing. Weekly polls: only 09:00–21:00 (inclusive).
- **Close:** open polls whose `closesAt` has passed → `closePoll` → `postSummary(summary)`.
- Polls with `closesAt: null` are never auto-reminded or auto-closed.
- Schedule changes are read on every check (no restart). Changing the close time affects the next poll, not one already open (its `closesAt` is fixed).
- Every bot function call is wrapped in try/catch and logged (`[scheduler] <fn> failed: ...`).

## Functions I expect from the other person
Passed in to `startScheduler(bot)` as `{ postPollCard, postSummary, postMenuCard, sendReminder, getMembers }` (call sites: `scheduler.js` `postNew`, `remind`, `tick`, `demoStep`). Person A says all 7 are async, live in `bot/teamsActions.js`, `getMembers()` → `[{ userId, name }]`, others resolve to nothing, and they throw if posting fails. `postPollCard`/`postMenuCard`/`sendReminder`/`postSummary` are called with no incoming message, so they must post proactively.

## Mocks to replace at merge
- `poll/mocks/bot.js` → `bot/teamsActions.js`. Only used by the manual demo command above; no source file requires it. At merge the bot calls `startScheduler(require('./teamsActions'))` (or an object with those 5 functions) once at startup.

## Deviations from the contract
None. (v3.2 added setMenuWeek, getSchedule, setSchedule, startScheduler by agreement.)

## Decisions agreed with the other person
Agreed with Person A on 2026-11-22:
- CommonJS; all functions async except startScheduler (sync)
- getPoll/getMenu → null when not found; createPoll throws on unknown type or missing/bad dates; recordVote throws on unknown poll or invalid option; closePoll and getNonVoters throw on unknown poll; vote on closed poll returns poll unchanged. Person A catches errors and shows a short message.
- Duplicate createPoll → return existing, don't reset votes
- Times `YYYY-MM-DDTHH:mm:ss` no offset, dates `YYYY-MM-DD`, time zone Asia/Kolkata (confirmed)
- closesAt default null
- closePoll twice → same summary, no changes
- friday_diet accepts any date, no Friday check
- Storage: poll/data/{polls,menus,schedule}.json, built-in Node only; Person A never reads them
- Person A always sends dates as YYYY-MM-DD and times as YYYY-MM-DDTHH:mm:ss, Asia/Kolkata
- Menu with null weekStart: Person A's preview shows only Cancel, or HR picks the Monday → setMenuWeek → preview with Confirm → saveMenu. Person A never fills date fields.
- Scheduler runs inside the bot: Person A calls startScheduler(bot functions) at startup
- `show schedule` / `set schedule <weekly|friday> <post|remind|close> <day> <HH:mm>` are HR-only; Person A checks sender ID against an HR ID setting
- `remind` = reminder start time; repeats every 30 min (remindEveryMinutes) until close
- Weekly reminders only 09:00–21:00 Asia/Kolkata; Friday reminders no window (default 08:30 → 12:00 close). Friday defaults changed to match Person A (remind 08:30, close 12:00)
- Person A's manual start commands read the close time from getSchedule() and pass it as closesAt
- weekStart = Monday on or after post day (Sat +2, Sun +1, Mon same, Tue–Fri next Monday); same rule in bot and scheduler

## Dependencies added
None.

## Known issues / TODO
- Default times (HR-confirmed): weekly Sat 10:00 post / Mon 09:00 remind / Mon 10:00 close; Friday 08:30 / 08:30 / 12:00. HR can change them from Teams
- Weekly reminder window 09:00–21:00 is a constant in scheduler.js (WEEKLY_REMIND_FROM/TO), not editable from Teams; reminder slots stay on the 30-min grid from the start time
- Friday poll reminders go to all non-voting members (HR: anyone can vote, separate from weekly). Friday reminders are NOT limited to 09:00–21:00 (08:30 → 12:00); confirmed by Person A 2026-11-22
- `remindEveryMinutes` is only editable in `data/schedule.json`, not from Teams
- Reminders fire on an exact minute; a slot is skipped if the bot is down at that minute (posts and closes do catch up)
- setSchedule doesn't check that post < remind < close makes sense
- parseMenu with no "Lunch" heading guesses: first item = breakfast, rest = lunch (warns). Week dates read as day/month/year; 2-digit year → 20xx.
- Demo mode creates polls for future fake weeks in the data dir; use `POLL_DATA_DIR` pointing to a scratch folder for demos
- Storage is single JSON files rewritten on every write; fine for one office, not for many concurrent processes

## Notes for the merge session
- Storage path set in poll.js (`DATA_DIR`, env `POLL_DATA_DIR`); move to shared config at merge if desired.
- Normal mode and demo mode are mutually exclusive (`POLL_DEMO=1`).
- Asia/Kolkata handled as fixed +05:30 offset in scheduler.js (no DST in India).
