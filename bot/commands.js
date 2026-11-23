// Text commands (Person A, internal). handleCommand(context, text) → true if it handled the message.
//
// HR-only: every command below except "help". HR is identified by either env var (comma-separated lists):
//   HR_EMAIL   – email / UPN, checked by looking the sender up with getMemberById (result cached per user)
//   HR_USER_ID – Teams user id (activity.from.id) or AAD object id
// If neither is set, everyone counts as HR (that's the Playground setup; real Teams gets HR_EMAIL
// from env/.env.local via m365agents.local.yml).

const actions = require("./teamsActions");
// Person B's poll logic (merged 2026-11-22; was ./mocks/poll).
const polls = require("../poll/poll");
const { nowInOffice, addDays, weeklyWeekStart, fridayOnOrAfter, closesAtFor } = require("./dates");
const { formatDay, formatDateTime } = require("./cards/pollCard");
const { buildMenuPreviewCard, buildMenuInputCard } = require("./cards/menuCards");

const HELP = [
  "**Meal poll bot commands** (HR only):",
  "- `start weekly poll`: post next week's attendance poll",
  "- `start friday poll`: post the Friday veg / non-veg poll",
  "- `close poll` (or `close poll weekly` / `close poll friday`): close and post results",
  "- `remind` (or `remind weekly` / `remind friday`): remind people who haven't voted (@mentions them)",
  "- `set menu`: opens a box to paste the vendor's menu → preview → Confirm to post it",
  "- `show schedule`: when polls post, remind and close",
  "- `set schedule <weekly|friday> <post|remind|close> <day> <HH:mm>`: e.g. `set schedule friday close fri 12:30`",
  "- `use this chat`: send this once **in the meal-poll group, @mentioning me** (e.g. `@Snack Overflow use this chat`). Polls, results and the menu are posted there",
  "- `help`: show this list",
  "",
  "Tip: after `use this chat`, run all other commands in a 1:1 chat with me; only the results go to the group.",
].join("\n");

let warnedNoHr = false;
const hrLookupCache = new Map(); // Teams user id -> true/false (successful lookups only)
const listEnv = (name) => (process.env[name] || "").split(",").map((s) => s.trim()).filter(Boolean);

async function isHr(context) {
  const ids = listEnv("HR_USER_ID");
  const emails = listEnv("HR_EMAIL").map((e) => e.toLowerCase());
  if (ids.length === 0 && emails.length === 0) {
    if (!warnedNoHr) {
      context.log.warn("HR_EMAIL / HR_USER_ID not set: everyone is treated as HR (OK for Playground only).");
      warnedNoHr = true;
    }
    return true;
  }
  const from = context.activity.from || {};
  if (ids.includes(from.id) || (from.aadObjectId && ids.includes(from.aadObjectId))) return true;
  if (emails.length === 0) return false;
  if (hrLookupCache.has(from.id)) return hrLookupCache.get(from.id);
  try {
    const member = await context.api.conversations.getMemberById(context.activity.conversation.id, from.id);
    const ok = [member && member.email, member && member.userPrincipalName]
      .filter(Boolean)
      .some((e) => emails.includes(String(e).toLowerCase()));
    hrLookupCache.set(from.id, ok);
    return ok;
  } catch (err) {
    context.log.warn(`HR check: couldn't look up ${from.id}: ${err.message}`);
    return false; // not cached, so it's retried next time
  }
}

function nowString() {
  const n = nowInOffice();
  return `${n.date}T${n.time}`;
}

// Shared by both "start" commands.
async function startPoll(context, type, args, label) {
  const pollId = `${type}-${args.weekStart || args.date}`;
  const existing = await polls.getPoll(pollId);
  if (existing && existing.status === "closed") {
    await context.send(`The ${label} is already closed.`);
    return;
  }
  if (existing && actions.hasPollCardInTarget(pollId)) {
    await context.send(`The ${label} is already open in the group. Scroll up there to find its card.`);
    return;
  }
  // Otherwise (card never posted, posted before a restart, or posted to an older target chat):
  // (re-)post it to the current group chat with its existing votes.
  const poll = await polls.createPoll(type, args); // returns the existing poll (votes kept) if it exists
  actions.setTarget(context);
  await actions.postPollCard(poll);
  if (poll.closesAt && poll.closesAt <= nowString()) {
    await context.send(`⚠️ Its close time (${formatDateTime(poll.closesAt)}) has already passed, so the scheduler may close it straight away.`);
  }
}

async function startWeekly(context) {
  const { date } = nowInOffice();
  const weekStart = weeklyWeekStart(date);
  const schedule = await polls.getSchedule();
  await startPoll(context, "weekly_attendance", {
    weekStart,
    weekEnd: addDays(weekStart, 4),
    closesAt: closesAtFor(weekStart, schedule.weekly.close),
  }, `weekly poll for the week of ${formatDay(weekStart)}`);
}

async function startFriday(context) {
  const { date: today } = nowInOffice();
  const date = fridayOnOrAfter(today);
  const schedule = await polls.getSchedule();
  await startPoll(context, "friday_diet", {
    date,
    closesAt: closesAtFor(date, schedule.friday.close),
  }, `Friday poll for ${formatDay(date)}`);
}

async function closePollCmd(context, which) {
  const typeFor = { weekly: "weekly_attendance", friday: "friday_diet" };
  if (which && !typeFor[which]) {
    await context.send("Use `close poll`, `close poll weekly` or `close poll friday`.");
    return;
  }
  let open = await polls.getOpenPolls();
  if (which) open = open.filter((p) => p.type === typeFor[which]);
  if (open.length === 0) {
    await context.send(which ? `There's no open ${which} poll.` : "There are no open polls.");
    return;
  }
  if (open.length > 1) {
    await context.send(`There are ${open.length} open polls. Say \`close poll weekly\` or \`close poll friday\`.`);
    return;
  }
  const { pollId } = open[0];
  actions.setTarget(context);
  const summary = await polls.closePoll(pollId);
  await actions.postSummary(summary); // also flips the original card to "closed"
}

// Teams may deliver pasted multi-line text as HTML (<p>, <br>, entities). Turn it back into plain lines.
// (Not verified for every Teams client; Playground sends plain text.)
function htmlToText(s) {
  if (!/<[a-z][^>]*>/i.test(s)) return s;
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function setMenuCmd(context, rawText) {
  if (!rawText.trim()) {
    // No text yet: show a card with a multi-line box (keeps line breaks when pasting).
    await context.send(actions.cardMessage(buildMenuInputCard()));
    return;
  }
  const menu = await polls.parseMenu(rawText);
  actions.setTarget(context);
  await actions.postMenuPreview(menu);
}

// Edit the preview card the button was clicked on.
async function updatePreview(context, menu, opts) {
  const { activity } = context;
  if (!activity.replyToId) return;
  try {
    await context.api.conversations.updateActivity(
      activity.conversation.id, activity.replyToId, actions.cardMessage(buildMenuPreviewCard(menu, opts))
    );
  } catch (err) {
    context.log.warn(`Could not update menu preview: ${err.message}`);
  }
}

// Buttons on the menu preview card: menu_setweek / menu_confirm / menu_cancel.
async function handleMenuAction(context) {
  if (!(await isHr(context))) {
    await context.send("Sorry, only HR can do that.");
    return;
  }
  const { action, menu, weekStart, menuText } = context.activity.value;
  try {
    if (action === "menu_text") {
      if (!menuText || !menuText.trim()) {
        await context.send("The box is empty. Paste the menu into it, then press Preview.");
        return;
      }
      await setMenuCmd(context, menuText);
    } else if (action === "menu_cancel") {
      await updatePreview(context, menu, { status: "cancelled" });
    } else if (action === "menu_setweek") {
      if (!weekStart) {
        await context.send("Please pick a date first.");
        return;
      }
      const dated = await polls.setMenuWeek(menu, weekStart); // throws if not YYYY-MM-DD
      await updatePreview(context, dated, {});
    } else if (action === "menu_confirm") {
      await polls.saveMenu(menu);
      await actions.postMenuCard(menu);
      await updatePreview(context, menu, { status: "posted" });
    }
  } catch (err) {
    context.log.error(`Menu action ${action} failed: ${err.stack || err.message}`);
    await context.send(`Sorry, that didn't work: ${err.message}`);
  }
}

async function useThisChatCmd(context) {
  actions.useThisChat(context);
  const personal = (context.activity.conversation.conversationType || "") === "personal";
  await context.send(
    personal
      ? "OK, I'll post polls, results and the menu **in this 1:1 chat**. (For the real setup, send `use this chat` in the meal-poll group instead.)"
      : "✅ Got it. Polls, results and the menu will be posted **in this chat**. HR can run the other commands from a 1:1 chat with me."
  );
}

// Pick the single open poll (optionally of one type). Replies to HR and returns null if ambiguous/none.
async function pickOpenPoll(context, which, verb) {
  const typeFor = { weekly: "weekly_attendance", friday: "friday_diet" };
  if (which && !typeFor[which]) {
    await context.send(`Use \`${verb}\`, \`${verb} weekly\` or \`${verb} friday\`.`);
    return null;
  }
  let open = await polls.getOpenPolls();
  if (which) open = open.filter((p) => p.type === typeFor[which]);
  if (open.length === 0) {
    await context.send(which ? `There's no open ${which} poll.` : "There are no open polls.");
    return null;
  }
  if (open.length > 1) {
    await context.send(`There are ${open.length} open polls. Say \`${verb} weekly\` or \`${verb} friday\`.`);
    return null;
  }
  return open[0];
}

async function remindCmd(context, which) {
  const poll = await pickOpenPoll(context, which, "remind");
  if (!poll) return;
  actions.setTarget(context);
  let members = null;
  try {
    members = await actions.getMembers();
  } catch (err) {
    context.log.warn(`getMembers failed, sending a general reminder: ${err.message}`);
  }
  if (!members) {
    await actions.sendReminder(poll, null);
    await context.send("I couldn't get the member list, so I posted a general reminder (no @mentions).");
    return;
  }
  const nonVoters = await polls.getNonVoters(poll.pollId, members);
  if (nonVoters.length === 0) {
    await context.send("Everyone has voted already 🎉 No reminder sent.");
    return;
  }
  await actions.sendReminder(poll, nonVoters);
  await context.send(`Reminder posted. ${nonVoters.length} of ${members.length} people haven't voted: ${nonVoters.map((m) => m.name).join(", ")}.`);
}

function scheduleText(sch) {
  const row = (label, e) => `- ${label}: **${e.day} ${e.time}**`;
  return [
    "**Schedule** (Asia/Kolkata):",
    "",
    "**Weekly attendance poll**",
    row("Post", sch.weekly.post),
    row("Reminders start", sch.weekly.remind),
    row("Close", sch.weekly.close),
    "",
    "**Friday lunch poll**",
    row("Post", sch.friday.post),
    row("Reminders start", sch.friday.remind),
    row("Close", sch.friday.close),
    "",
    `Reminders repeat every ${sch.remindEveryMinutes} min to people who haven't voted (weekly: only 09:00–21:00).`,
    "Change with e.g. `set schedule weekly post sat 10:00`.",
  ].join("\n");
}

async function showScheduleCmd(context) {
  await context.send(scheduleText(await polls.getSchedule()));
}

async function setScheduleCmd(context, m) {
  const [, kind, event, day, time] = m;
  try {
    const sch = await polls.setSchedule(kind.toLowerCase(), event.toLowerCase(), day, time);
    await context.send(`✅ Updated. ${scheduleText(sch)}\n\nA new close time applies from the next poll, not one that's already open.`);
  } catch (err) {
    // setSchedule throws readable messages on bad input (agreed in v3.2), so show them as-is.
    await context.send(`That didn't work: ${err.message}\nFormat: \`set schedule <weekly|friday> <post|remind|close> <day> <HH:mm>\``);
  }
}

const COMMANDS = [
  { re: /^help$/i, hrOnly: false, run: (ctx) => ctx.send(HELP) },
  { re: /^use this chat$/i, hrOnly: true, run: useThisChatCmd },
  { re: /^show schedule$/i, hrOnly: true, run: showScheduleCmd },
  { re: /^set schedule (\S+) (\S+) (\S+) (\S+)$/i, hrOnly: true, run: setScheduleCmd },
  {
    re: /^set schedule\b.*$/i,
    hrOnly: true,
    run: (ctx) => ctx.send("Format: `set schedule <weekly|friday> <post|remind|close> <day> <HH:mm>`, e.g. `set schedule friday close fri 12:30`"),
  },
  { re: /^start weekly poll$/i, hrOnly: true, run: startWeekly },
  { re: /^start friday poll$/i, hrOnly: true, run: startFriday },
  { re: /^remind(?:\s+(\w+))?$/i, hrOnly: true, run: (ctx, m) => remindCmd(ctx, m[1] && m[1].toLowerCase()) },
  { re: /^close poll(?:\s+(\w+))?$/i, hrOnly: true, run: (ctx, m) => closePollCmd(ctx, m[1] && m[1].toLowerCase()) },
];

async function handleCommand(context, rawText) {
  // Drop any leftover "<at>Bot</at>" mention text (stripMentionsText only removes mentions listed in entities).
  const text = htmlToText((rawText || "").replace(/<at>[^<]*<\/at>/gi, " ")).trim();
  // "set menu" keeps its line breaks, so it's matched before whitespace is collapsed.
  const menuMatch = text.match(/^\s*set menu\b[ \t]*\r?\n?([\s\S]*)$/i);
  if (menuMatch) {
    if (!(await isHr(context))) {
      await context.send("Sorry, only HR can use that command.");
      return true;
    }
    try {
      await setMenuCmd(context, menuMatch[1]);
    } catch (err) {
      context.log.error(`set menu failed: ${err.stack || err.message}`);
      await context.send(`Sorry, that didn't work: ${err.message}`);
    }
    return true;
  }

  const clean = text.replace(/\s+/g, " ").trim();
  for (const cmd of COMMANDS) {
    const m = clean.match(cmd.re);
    if (!m) continue;
    if (cmd.hrOnly && !(await isHr(context))) {
      await context.send("Sorry, only HR can use that command.");
      return true;
    }
    try {
      await cmd.run(context, m);
    } catch (err) {
      context.log.error(`Command "${clean}" failed: ${err.stack || err.message}`);
      await context.send(`Sorry, that didn't work: ${err.message}`);
    }
    return true;
  }
  return false;
}

module.exports = { handleCommand, handleMenuAction, htmlToText };
