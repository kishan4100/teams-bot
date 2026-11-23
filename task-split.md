# Meal Poll Bot: Task Split (v3.2)

**Language:** Node.js (CommonJS)
**Changes since v3:** filled in Language; added "Agreed decisions" below; ticked Language and Time zone open questions.
**Changes since v3.2 (same version, later edits):** postPollCard posts without @mention (only reminders @mention non-voters); weekly reminders 09:00–21:00 only; HR-confirmed default times (weekly post Sat 10:00; Friday post + remind 08:30, close 12:00); manual polls read close time from getSchedule(); weekStart rule; HR answered Times, Vote visibility, Friday audience.
**Changes since v3.1:** added Person B functions `setMenuWeek`, `getSchedule`, `setSchedule`, `startScheduler`; new commands `show schedule` / `set schedule`; HR-only commands; reminders every 30 min; Person A functions are async in `bot/teamsActions.js`; scheduler decisions added to "Agreed decisions".
**Testing:** Microsoft 365 Agents Playground (no Azure, no admin approval needed)
**Project folder:** `hackathon/` (already created). Keep this file at `hackathon/task-split.md`.
**This file is the source of truth.** It replaces the contract in `meal-poll-bot-plan.md`.

---

## ⚠️ Instructions for Claude (read first)

Two developers are building this project in parallel, each with their own separate Claude session. **The two Claude sessions cannot talk to each other.** The developer you're working with is the only bridge to the other person and their Claude.

**You must stop and ask your developer to check with the other person before:**
- Changing, renaming, adding, or removing any function in the contract
- Changing the poll, summary, or menu objects, or any field name or value
- Deciding anything the other half depends on: sync vs async functions, how modules import or export each other, folder structure, storage file location, error handling (return `null` vs throw), date and time format, or time zone
- Adding a new library or dependency the whole project will use
- Making any assumption about how the other person's code works
- Filling in anything listed under "Open questions" below

**When this happens:**
1. Pause. Don't write code that depends on the decision yet.
2. Write a short, clear question your developer can copy and send to the other person, for example: *"Question for Person B: should recordVote be async? Person A's code needs to know whether to await it."*
3. Wait for your developer to come back with the answer.
4. Once agreed, remind your developer to update this file so both Claude sessions stay in sync.

**You can decide on your own (no need to ask):** anything that stays fully inside your developer's own half and doesn't affect the contract, such as internal helper functions, variable names, card text and layout, and test scripts.

**If you notice this file has changed** (the developer pastes a newer version), follow the newer version and point out what changed.

**Keep your handoff file up to date (required).** Your work will later be merged by a separate Claude session that has never seen your conversation. Its only information will be this file, the code, and your handoff file. So after every completed task, and before your developer stops for the day, update your handoff file (see "Handoff files" below). Write it so someone with zero context can merge your work without asking questions. Record what is actually true in the code, not what was planned.

---

## Folder structure

```
hackathon/
├── task-split.md          ← this file (same copy for both)
├── bot/                   ← Person A ONLY (Agents Toolkit project)
│   ├── HANDOFF-A.md       ← Person A's handoff file
│   └── mocks/             ← A's fake versions of Person B's functions
├── poll/                  ← Person B ONLY
│   ├── HANDOFF-B.md       ← Person B's handoff file
│   └── mocks/             ← B's fake versions of Person A's functions
└── MERGE-NOTES.md         ← created later by the merge session
```

Rules:
- Each person works **only inside their own folder**. Don't edit the other person's folder or anything at the root except this file (and only after agreeing on the change).
- Keep all mocks inside your own `mocks/` folder so the merge session can find and delete them easily.
- Don't import from the other person's folder yet. The merge session will connect them.
- If you share via Git, commit only your own folder.

---

## Handoff files

Each Claude session maintains one handoff file: `bot/HANDOFF-A.md` (Person A) and `poll/HANDOFF-B.md` (Person B). Create it at the start and **update it after every completed task.** Use this template:

```markdown
# Handoff: Person [A/B]
Last updated: <date and time>
Contract version followed: v3

## Status
- Done: <list>
- In progress: <list>
- Not started: <list>

## How to run
<install command, run command, how to run tests, env variables needed>

## Files
<each file and what it does, one line each>

## Functions provided (ACTUAL code, not planned)
<exact name, parameters, return value, sync or async, how to import it, errors thrown or null returned>

## Functions I expect from the other person
<how my code calls them, where the call sites are, which mock file stands in for them>

## Mocks to replace at merge
<file path of each mock, and what real function replaces it>

## Deviations from the contract
<anything different from task-split.md and why; write "None" if none>

## Decisions agreed with the other person
<question, answer, when>

## Dependencies added
<library, version, why>

## Known issues / TODO
<bugs, shortcuts, things not tested>

## Notes for the merge session
<anything else that would help, e.g., config values, gotchas>
```

---

## What the bot must support

Based on what HR currently does on WhatsApp every week:

1. **Weekly menu:** the vendor sends a messy text menu for Mon–Fri (breakfast + lunch per day). HR pastes it into the bot, the bot parses it into a clean day-by-day card, HR previews and confirms, then the bot posts it.
2. **Weekly attendance poll:** "Team, kindly vote for this week." One choice for the **whole week**: Breakfast + Lunch / Only Lunch / No BF, No lunch.
3. **Friday lunch poll:** "Please vote for your preference for today's lunch." Veg / Non veg. **Only on Fridays.**
4. **Notifications:** posts go to a dedicated Teams channel or group chat, with an @mention so people are notified, plus a reminder before the cutoff.
5. **Summaries:** when a poll closes, the bot posts counts (and who voted what, like WhatsApp's "View votes").

### Priority (we have limited time)
- **Must:** weekly poll, Friday poll, voting, summaries, manual commands
- **Should:** menu parsing + preview + menu card, scheduler, reminder
- **Stretch:** reminder @mentions only non-voters, simple web dashboard

---

## Open questions (do NOT assume, ask the team / HR)

- [x] **Language** and conventions: sync vs async, imports/exports, error handling (`null` vs throw) → see "Agreed decisions"
- [x] **Times:** → HR confirmed the defaults in "Agreed decisions"; HR changes them with `set schedule`
- [x] **Time zone** → Asia/Kolkata
- [x] **Vote visibility:** → everyone sees who voted what (HR)
- [x] **Friday poll audience:** → anyone can vote, separate from the weekly poll (HR). Reminders go to all non-voters.
- [x] **Who can run HR commands:** → only HR (one HR person; Person A checks sender ID against an HR ID setting)

## Agreed decisions (Person A + Person B, 2026-11-22)

- **Modules:** CommonJS (`module.exports` / `require`).
- **Async:** all Person B functions are `async` (Person A always `await`s them), except `startScheduler`, which is sync.
- **Not found:** `getPoll` / `getMenu` return `null`.
- **Throws:** `createPoll` on unknown type or missing/badly formatted dates; `recordVote` on unknown poll or invalid option; `closePoll` and `getNonVoters` on unknown poll. Person A catches these and shows the user a short message.
- **Closed poll vote:** `recordVote` returns the poll unchanged; Person A checks `poll.status === "closed"`.
- **Duplicate start:** `createPoll` with an existing `pollId` returns the existing poll, votes kept.
- **Close twice:** `closePoll` returns the same summary again, nothing changed.
- **Friday poll date:** any date accepted (no Friday check) so it can be tested on demo day.
- **Time format:** datetimes `"YYYY-MM-DDTHH:mm:ss"` with no offset, dates `"YYYY-MM-DD"`, time zone **Asia/Kolkata**.
- **closesAt:** `null` when not given (card shows "Open").
- **Storage:** `poll/data/polls.json` and `poll/data/menus.json`, built-in Node only. Person A never reads these files directly. Schedule is stored in `poll/data/schedule.json` (defaults in code until HR changes something).
- **Person A functions:** all 7 are async, in `bot/teamsActions.js` (`require("../bot/teamsActions")`). `getMembers()` → `[{ userId, name }]`, the rest resolve to nothing. They **throw** if posting fails (e.g. chat not known yet); callers catch and log.
- **Menu with no week dates:** `parseMenu` returns `weekStart`, `weekEnd` and every `days[].date` as `null` + a warning. Preview shows only Cancel, or HR picks the Monday → `setMenuWeek` → preview again with Confirm. Person A never fills date fields themselves; `saveMenu` throws on null `weekStart`.
- **Scheduler runs inside the bot:** Person A calls `startScheduler({ postPollCard, postSummary, postMenuCard, sendReminder, getMembers })` once at startup. `poll/` never imports `bot/`.
- **Schedule from Teams (HR only):** `show schedule` → `getSchedule()`; `set schedule <weekly|friday> <post|remind|close> <day> <HH:mm>` → `setSchedule(...)`. Day = English day name, case-insensitive, unambiguous prefix allowed (`sat`), always returned in full (`"Saturday"`). Time = 24h `HH:mm`, Asia/Kolkata.
- **Reminders:** `remind` = when reminders **start**; they repeat every `remindEveryMinutes` (30, file setting, not editable from Teams) to non-voters until close. Skipped when everyone has voted. **Weekly** reminders only between 09:00 and 21:00 Asia/Kolkata (inclusive, fixed in scheduler.js), none at night. Friday reminders have no window (default 08:30 until 12:00 close).
- **Auto close/remind only for polls with `closesAt`:** polls started with `closesAt: null` are only closed by the `close poll` command. A change to the close time applies to the **next** poll, not one already open.
- **Manual polls:** Person A's `start weekly poll` / `start friday poll` read the close time from `getSchedule()` and pass it as `closesAt`, so they always match the scheduler, which reminds and auto-closes them too.
- **Weekly weekStart:** the Monday on or after the post day, Asia/Kolkata (Sat +2, Sun +1, Mon same day, Tue–Fri next Monday). Same rule in bot and scheduler.
- **Default times (HR may change from Teams):** weekly post Sat 10:00, remind Mon 09:00, close Mon 10:00; Friday post Fri 08:30, remind Fri 08:30, close Fri 12:00. *(Confirmed by HR; HR can change them with `set schedule`.)*

---

## The shared contract (do not change without telling each other)

### Poll templates (constant, owned by Person B)

```json
{
  "weekly_attendance": {
    "question": "Team, kindly vote for this week.",
    "options": [
      { "id": "bf_lunch",   "label": "Breakfast + Lunch" },
      { "id": "lunch_only", "label": "Only Lunch" },
      { "id": "none",       "label": "No BF, No lunch" }
    ],
    "scope": "week"
  },
  "friday_diet": {
    "question": "Please vote for your preference for today's lunch.",
    "options": [
      { "id": "veg",    "label": "Veg" },
      { "id": "nonveg", "label": "Non veg" }
    ],
    "scope": "day"
  }
}
```

### Poll object

```json
{
  "pollId": "weekly_attendance-2026-11-23",
  "type": "weekly_attendance",
  "question": "Team, kindly vote for this week.",
  "options": [ { "id": "bf_lunch", "label": "Breakfast + Lunch" } ],
  "weekStart": "2026-11-23",
  "weekEnd": "2026-11-27",
  "date": null,
  "closesAt": "2026-11-23T10:00:00",
  "status": "open",
  "responses": {
    "<teamsUserId>": { "name": "Ravi", "optionId": "bf_lunch", "votedAt": "2026-11-22T18:02:00" }
  }
}
```

- `type`: `"weekly_attendance"` or `"friday_diet"`
- Weekly poll: `weekStart` + `weekEnd` set, `date` is `null`
- Friday poll: `date` set (a Friday), `weekStart` / `weekEnd` are `null`
- `pollId` format: `<type>-<weekStart or date>`
- `status`: `"open"` or `"closed"`
- One vote per person (single select). Voting again **replaces** the previous vote.

### Summary object

```json
{
  "pollId": "weekly_attendance-2026-11-23",
  "type": "weekly_attendance",
  "question": "Team, kindly vote for this week.",
  "totalVotes": 35,
  "counts": { "bf_lunch": 21, "lunch_only": 8, "none": 6 },
  "voters": { "bf_lunch": ["Ravi", "Asha"], "lunch_only": ["..."], "none": ["..."] }
}
```

For HR, a weekly summary means: breakfast count = `bf_lunch`, lunch count = `bf_lunch + lunch_only`.

### Menu object

```json
{
  "weekStart": "2026-11-02",
  "weekEnd": "2026-11-06",
  "rawText": "<exactly what HR pasted>",
  "days": [
    {
      "day": "Monday",
      "date": "2026-11-02",
      "breakfast": ["Upma + chutney"],
      "lunch": ["Shahi mixed veg", "Phulka", "Rice", "Dal", "Salad (chola)"]
    }
  ],
  "warnings": ["Tuesday: no 'Lunch' heading found, guessed which items are lunch"]
}
```

`warnings` lists anything the parser wasn't sure about, so HR can check the preview before posting.

### Functions (our own names, not SDK functions)

**Person B provides (`poll/`):**

| Function | Returns |
|---|---|
| `createPoll(type, { weekStart, weekEnd, date, closesAt })` | poll (built from template) |
| `recordVote(pollId, userId, name, optionId)` | updated poll (ignores votes on closed polls) |
| `getPoll(pollId)` | poll |
| `getOpenPolls()` | list of open polls |
| `closePoll(pollId)` | summary |
| `getNonVoters(pollId, members)` | list of `{ userId, name }` who haven't voted |
| `parseMenu(rawText)` | menu (with `warnings`) |
| `saveMenu(menu)` | nothing |
| `getMenu(weekStart)` | menu or nothing |
| `setMenuWeek(menu, weekStart)` | new menu with `weekStart`, `weekEnd` (+4) and each `days[].date` filled; date warnings updated |
| `getSchedule()` | schedule object (example below) |
| `setSchedule(kind, event, day, time)` | updated schedule; throws on bad input |
| `startScheduler(bot)` | **sync**; starts the timer, returns `stop()`. Import from `poll/scheduler.js` |

Schedule object (from `getSchedule()`):

```json
{
  "weekly": { "post": { "day": "Saturday", "time": "10:00" }, "remind": { "day": "Monday", "time": "09:00" }, "close": { "day": "Monday", "time": "10:00" } },
  "friday": { "post": { "day": "Friday", "time": "08:30" }, "remind": { "day": "Friday", "time": "08:30" }, "close": { "day": "Friday", "time": "12:00" } },
  "remindEveryMinutes": 30
}
```

**Person A provides (`bot/`):**

| Function | Purpose |
|---|---|
| `postPollCard(poll)` | Post poll card to the channel/group (no @mention) |
| `updatePollCard(poll)` | Update live counts on the card |
| `postSummary(summary)` | Post results when a poll closes |
| `postMenuPreview(menu)` | Show parsed menu to HR with **Confirm** / **Cancel** buttons (only HR sees it) |
| `postMenuCard(menu)` | Post the clean day-by-day menu to the channel/group |
| `sendReminder(poll, nonVoters)` | Reminder before cutoff (@mention non-voters if possible, else @mention the channel/group) |
| `getMembers()` | List of `{ userId, name }` in the channel/group |

**Until the other half is ready, use a mock** (fake version returning sample data).

---

## Person A: Teams side (`bot/`)

### Phase 1 (0:15–0:45): Setup + poll card
- [ ] Agents Toolkit → Create a New Agent/App → plain bot template (no AI/OpenAI template), created inside `hackathon/` with the folder name `bot`
- [ ] Run "Debug in Microsoft 365 Agents Playground", confirm "hello" works
- [ ] Create `bot/HANDOFF-A.md` from the template
- [ ] Mock Person B's functions in `bot/mocks/`
- [ ] One generic poll **Adaptive Card** that renders any poll from its `question` + `options` (one button per option, live count per option)

### Phase 2 (0:45–1:30): Commands and clicks
- [ ] Button click → `recordVote(...)` → `updatePollCard(...)`
- [ ] Commands:
  - `start weekly poll` → `createPoll("weekly_attendance", ...)` → `postPollCard(...)`
  - `start friday poll` → `createPoll("friday_diet", ...)` → `postPollCard(...)`
  - `close poll` → `closePoll(...)` → `postSummary(...)`
  - `set menu` + pasted text → `parseMenu(...)` → `postMenuPreview(...)`; on **Confirm** → `saveMenu(...)` → `postMenuCard(...)`
  - `remind` → `getMembers()` → `getNonVoters(...)` → `sendReminder(...)`
- [ ] Summary card: counts per option + names per option (pending the visibility question)
- [ ] Menu card: one section per day, breakfast and lunch listed clearly

### Verify in current Microsoft docs (don't trust generated code blindly)
- How Adaptive Card button clicks reach the bot, and how to update a card
- How to @mention users or a channel/group in a bot message
- How to get the member list of a channel/group chat
- How to post proactively (needed for the scheduler)
- Note: some of these (mentions, members, proactive) may not fully work in Playground; test them in real Teams later

### Done when
In the Playground: both polls can be started, voted on, and closed with correct summaries; `set menu` shows a preview and posts a clean menu card.

---

## Person B: Logic side (`poll/`)

### Phase 1 (0:15–0:45): Polls and votes (no bot project needed yet)
- [ ] Work in `hackathon/poll/`, storage in a JSON file (or SQLite) inside `poll/`
- [ ] Create `poll/HANDOFF-B.md` from the template
- [ ] Poll templates constant
- [ ] `createPoll`, `recordVote`, `getPoll`, `getOpenPolls`, `closePoll`, `getNonVoters`
- [ ] Revoting replaces the old vote; votes on closed polls are ignored
- [ ] Test script for both poll types, including revote and closed-poll cases

### Phase 2 (0:45–1:30): Menu parser + scheduler
- [ ] `parseMenu(rawText)` using the sample below as the test input
  - Detect day names (Monday…Friday, any capitalization)
  - Detect "breakfast" / "lunch" headings; strip ✨ emojis and extra spaces
  - First item(s) after a day with no heading = breakfast
  - If a day has no "Lunch" heading, make a best guess and add a `warnings` entry
  - Handle day names appearing in odd places (e.g., "Wednesday" right after Tuesday's items)
  - Read week dates from the first line if present (`2/11/26 to 6/11/26` is **day/month/year**)
  - Keep `rawText` so nothing is lost
- [ ] `saveMenu`, `getMenu`
- [ ] Mock Person A's functions in `poll/mocks/` (just print to console)
- [ ] Scheduler (times are **open questions**, keep them in one config file):
  - Weekly: post menu card (if saved) + weekly poll → reminder before cutoff → close + summary
  - Friday: post Friday poll in the morning → reminder → close + summary
  - **Demo mode flag:** everything runs every couple of minutes

### Sample menu text (test input for `parseMenu`)

```
Menu for the week 2/11/26 to 6/11/26
Monday
✨ upma +chutney✨
✨ Lunch✨
Shahi mixed veg
Phulka
Rice
Dal
Salad( chola )

✨ tuesday✨
 ✨ veg moong dal idli+chutney
Pav bhaji
Chitrana
Raita
Wednesday

✨ aloo stuffed sandwiches
✨ Lunch✨
Paneer butter masala
Phulka
Dal fry
Rice
Salad

✨ Thursday ✨
✨ breakfast ✨
Idli sambhar chutney
✨ Lunch✨
Bhindi sabzi+ gutte sabzi
Phulka
Pulav
Raita
Rass malai
Salad

✨ Friday ✨
Breakfast -cabbage + veggie paratha + curd
```

Note the messiness: Tuesday has no "Lunch" heading, "Wednesday" sits at the end of Tuesday's items, and Friday's breakfast is on the same line as its label. The screenshot was cut off after Friday's breakfast, so Friday lunch is missing from this sample.

### Done when
Test scripts pass for both polls and the sample menu parses into 5 days with sensible warnings; scheduler calls Person A's (mocked) functions on time.

---

## Merge (1:30–2:15): single merge session

A **new, separate Claude session** merges the two halves. Both developers should be present to answer questions.

**Before starting the merge:** both developers make sure their handoff file is fully up to date.

**Give the merge session:** this file, `bot/HANDOFF-A.md`, `poll/HANDOFF-B.md`, and access to the `hackathon/` folder.

**Merge session steps:**
1. Read all three files. Compare each handoff's "Functions provided (ACTUAL code)" against the contract and list every mismatch (names, parameters, sync/async, return values, imports). Ask the developers before resolving any mismatch.
2. Connect `bot/` to `poll/`: replace every mock listed in both handoffs with the real function.
3. Combine dependencies into the bot project, and check for version conflicts.
4. Move the scheduler config and storage file paths into one place.
5. Run Person B's test scripts, then test in Playground with the manual commands.
6. Delete both `mocks/` folders once everything works.
7. Write `MERGE-NOTES.md` at the root: what was connected, what was changed and why, how to run the full bot, and what's still broken.

**Prompt for the merge session:**
> I'm merging two halves of a hackathon project. Read task-split.md, bot/HANDOFF-A.md, and poll/HANDOFF-B.md first. Before changing any code, list every mismatch between the two handoffs and the contract, and ask me how to resolve each one. Then replace the mocks with the real functions, combine dependencies, and help me test in Agents Playground. Keep MERGE-NOTES.md updated as you go.

### Checklist
- [ ] Weekly poll: card appears, votes update counts, revote replaces old vote
- [ ] Friday poll works the same way
- [ ] Closing posts correct summaries (weekly: breakfast and lunch totals)
- [ ] Votes after closing are ignored
- [ ] `set menu` → preview with warnings → Confirm → clean menu card
- [ ] Reminder posts
- [ ] Scheduler runs in demo mode (scheduled/proactive posts may not show in Playground; if not, demo with manual commands and test scheduling in real Teams after approval)

---

## Later: real Teams (after it works in Playground)
- Create a dedicated Teams channel or group chat for meal polls and add the bot there
- Register the bot (Teams Developer Portal or Agents Toolkit, using work account; we can create app registrations but have no Azure subscription)
- Run on laptop with a dev tunnel
- Submit the app package via Teams → Manage your apps → Upload an app → Submit an app to your org
- Admin approves → test mentions, reminders, scheduler in real Teams → demo

---

## Prompts for Claude (paste this file first)

**Person A:**
> I'm Person A in this task split. We're using [LANGUAGE] with the Microsoft 365 Agents Toolkit and testing in Agents Playground. Help me with my tasks one at a time, starting with Phase 1: a generic poll Adaptive Card built from a poll object's question and options. Work only in hackathon/bot/. Flag any Teams SDK method you're not sure about so I can check the docs, stop to ask me before deciding anything listed in the Claude instructions, and keep bot/HANDOFF-A.md updated after every task.

**Person B:**
> I'm Person B in this task split. We're using [LANGUAGE]. Help me with my tasks one at a time, starting with Phase 1: poll templates, storage, and the poll functions, matching the contract exactly, plus a test script. Work only in hackathon/poll/. Stop to ask me before deciding anything listed in the Claude instructions, and keep poll/HANDOFF-B.md updated after every task.
