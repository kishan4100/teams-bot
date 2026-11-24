// General agent: ONE Kompass workflow (SnackOverflow_Agent) + a tool registry in code.
// The bot sends the workflow a catalog of the tools THIS user may use; the model picks one (or asks / answers); CODE then decides:
// does the tool exist, is the user allowed (HR-only vs everyone), are the args valid, and does it need a confirmation card.
// New use case = new entry in TOOLS. The prompt is not edited per feature.
//
// Off unless KOMPASS_AGENT_FLOW_ID is set (see kompass.js). handleMessage returns false when it can't help, so the
// existing Chat flow stays as the fallback.
// Privacy: the model only gets the tool catalog, the asking user's own votes, the menu and open-poll titles. Never other
// people's names/votes, and never anything about Secret Santa pairings.

const kompass = require("./kompass");
const actions = require("./teamsActions");
const polls = require("../poll/poll");
const cmds = () => require("./commands").internals; // lazy: commands.js requires this file

// ---------- Tool registry ----------
// who: "hr" | "everyone". confirm: summary(args) → text for a Yes/Cancel card (use for anything public or hard to undo).
// args: name → { type: string|number|boolean|date|time|datetime|list, required, description, values? }
const TOOLS = [
  {
    name: "new_poll",
    who: "hr",
    description: "Create a poll on any topic (not the weekly meal or Friday polls). Shows a preview first; nothing is posted until HR confirms.",
    args: {
      question: { type: "string", required: true, description: "The poll question" },
      options: { type: "list", required: true, description: "2 to 10 answer options" },
      multi: { type: "boolean", required: false, description: "Allow several answers" },
      anonymous: { type: "boolean", required: false, description: "Hide who voted what" },
      closes_at: { type: "datetime", required: false, description: "When the poll closes (YYYY-MM-DDTHH:mm:ss)" },
    },
    run: async (context, a) => {
      const { parseDraft } = require("./commands");
      const { buildNewPollForm, buildPollPreview } = require("./cards/customPollCards");
      const [closeDate, closeTime] = a.closes_at ? a.closes_at.split("T") : ["", ""];
      const { draft, error } = parseDraft({
        q: a.question, opts: (a.options || []).join("\n"), multi: String(!!a.multi), anonymous: String(!!a.anonymous),
        closeDate, closeTime: closeTime ? closeTime.slice(0, 5) : "",
      });
      await context.send(actions.cardMessage(error ? buildNewPollForm(draft, error) : buildPollPreview(draft)));
    },
  },
  {
    name: "close_poll",
    who: "hr",
    description: "Close an open poll and post its results in the group. If several polls are open and none is named, the user is asked to pick.",
    args: { which: { type: "string", required: false, description: "'weekly' or 'friday' to pick a meal poll; leave out otherwise", values: ["weekly", "friday"] } },
    confirm: (a) => `Close the ${a.which ? a.which + " " : ""}poll and post the results to the group?`,
    run: (context, a) => cmds().closePollCmd(context, a.which),
  },
  {
    name: "reopen_poll",
    who: "hr",
    description: "Reopen the most recent closed meal poll (weekly or Friday); votes are kept. Only for the weekly and Friday meal polls.",
    args: { which: { type: "string", required: true, description: "'weekly' or 'friday'", values: ["weekly", "friday"] } },
    confirm: (a) => `Reopen the ${a.which} poll? Votes are kept and people can vote again.`,
    run: (context, a) => cmds().reopenPollCmd(context, a.which),
  },
  {
    name: "remind_voters",
    who: "hr",
    description: "Remind the people who haven't voted yet in an open poll (@mentions them in the group). Only for polls, not for Secret Santa.",
    args: {
      which: { type: "string", required: false, description: "'weekly' or 'friday' to pick a meal poll; leave out otherwise", values: ["weekly", "friday"] },
      delivery: { type: "string", required: false, description: "Where to send it: 'group' (in the group chat) or 'dm' (privately to each person). Leave out unless the user says", values: ["group", "dm"] },
    },
    confirm: (a) => `${a.delivery === "dm" ? "Privately message" : "Post a reminder for"} the people who haven't voted${a.which ? " in the " + a.which + " poll" : ""}${a.delivery === "dm" ? "" : " in the group"}?`,
    run: (context, a) => cmds().remindCmd(context, a.which, a.delivery),
  },
  {
    name: "start_weekly_poll",
    who: "hr",
    description: "Post next week's attendance poll in the group now.",
    args: {},
    confirm: () => "Post the weekly attendance poll to the group now?",
    run: (context) => cmds().startWeekly(context),
  },
  {
    name: "start_friday_poll",
    who: "hr",
    description: "Post the Friday veg / non-veg lunch poll in the group now.",
    args: {},
    confirm: () => "Post the Friday lunch poll to the group now?",
    run: (context) => cmds().startFriday(context),
  },
  {
    name: "show_schedule",
    who: "hr",
    description: "Show when the meal polls are posted, reminded and closed.",
    args: {},
    run: (context) => cmds().showScheduleCmd(context),
  },
  {
    name: "set_schedule",
    who: "hr",
    description: "Change when a meal poll is posted, reminded or closed.",
    args: {
      kind: { type: "string", required: true, description: "'weekly' or 'friday'", values: ["weekly", "friday"] },
      event: { type: "string", required: true, description: "'post', 'remind' or 'close'", values: ["post", "remind", "close"] },
      day: { type: "string", required: true, description: "Day of the week, e.g. 'fri' or 'mon'. The Friday lunch poll is normally posted/reminded/closed on 'fri'; if the user gives only a time for it, use 'fri'" },
      time: { type: "time", required: true, description: "24-hour HH:mm" },
    },
    confirm: (a) => `Set the ${a.kind} poll's ${a.event} time to ${a.day} ${a.time}?`,
    run: (context, a) => cmds().setScheduleCmd(context, [null, a.kind, a.event, a.day, a.time]),
  },
  {
    name: "feedback_summary",
    who: "hr",
    description: "Summarise the main themes of the last 7 days of anonymous meal feedback.",
    args: {},
    run: (context) => cmds().feedbackSummaryCmd(context),
  },
  {
    name: "send_feedback",
    who: "everyone",
    description: "Save anonymous feedback about the meals.",
    args: { text: { type: "string", required: true, description: "The feedback comment" } },
    run: (context, a) => cmds().feedbackCmd(context, [null, a.text]),
  },

  // ----- Recurring announcements: HR gives the message, time and days; the scheduler posts it in the group. -----
  {
    name: "schedule_announcement",
    who: "hr",
    description: "Post a message at a fixed time, either repeating every week on chosen days (e.g. 'every weekday at 18:30 remind everyone to switch off the AC') or ONCE on a single date (e.g. 'tomorrow at 5 pm tell everyone about the office party'). Use this for any scheduled reminder or notice. Give `days` for repeating, `date` for one day only, never both.",
    args: {
      text: { type: "string", required: true, description: "The message to post, written clearly and politely in the user's intent, keeping any names, numbers and details exactly as given. Do not include the time or days in it" },
      time: { type: "time", required: true, description: "When to post, 24-hour HH:mm" },
      days: { type: "list", required: false, description: "For a repeating alert: days to post on, any of mon, tue, wed, thu, fri, sat, sun, or the single word 'weekdays' or 'daily'. Leave out for a one-day alert" },
      date: { type: "date", required: false, description: "For a one-day alert: the date (YYYY-MM-DD), worked out from today. Leave out for a repeating alert" },
      delivery: { type: "string", required: false, description: "Where to send it: 'group' (in the group chat) or 'dm' (privately to each person). Leave out unless the user says", values: ["group", "dm"] },
    },
    confirm: (a) => `${a.delivery === "dm" ? "Privately message everyone in the group" : "Post this in the group"} ${when(a)}?\n\n"${a.text}"`,
    run: async (context, a) => {
      const announce = require("../poll/announce");
      if (!a.date && !(a.days && a.days.length)) return context.send("Should it repeat on certain days (e.g. every weekday), or be posted once on a single date?");
      if (a.date && a.days && a.days.length) return context.send("Is that a one-day alert or a repeating one? Tell me either the date or the days, not both.");
      if (a.date && `${a.date}T${a.time}:00` <= cmds().nowString()) return context.send("That date and time have already passed. Which date should I use?");
      const item = await announce.add({ text: a.text, time: a.time, days: a.days, date: a.date, delivery: a.delivery || "group", createdBy: { userId: context.activity.from.id } });
      actions.setTarget(context);
      await context.send(`✅ Scheduled ${when(item)}. I'll ${item.delivery === "dm" ? "message everyone in the group privately" : "post in the group"}:\n\n"${item.text}"`);
    },
  },
  {
    name: "set_reminder_delivery",
    who: "hr",
    description: "Set where the automatic poll reminders (and reminders without a stated choice) go: in the group chat, or as a private 1:1 message to each person who hasn't voted.",
    args: { delivery: { type: "string", required: true, description: "'group' or 'dm'", values: ["group", "dm"] } },
    confirm: (a) => `From now on, send reminders ${a.delivery === "dm" ? "privately (1:1) to each person" : "in the group chat"}?`,
    run: async (context, a) => {
      await require("../poll/settings").setDelivery(a.delivery);
      await context.send(`✅ Reminders will now be sent ${a.delivery === "dm" ? "privately to each person" : "in the group chat"}. You can still say "in the group" or "privately" on any single reminder.`);
    },
  },
  {
    name: "list_announcements",
    who: "hr",
    description: "Show all scheduled alerts and reminders (repeating and one-day) as a card where each one can be deleted.",
    args: {},
    run: async (context) => context.send(actions.cardMessage(alertsCard(await require("../poll/announce").list()))),
  },
  {
    name: "cancel_announcement",
    who: "hr",
    description: "Stop a repeating announcement. The number is its position in the list of announcements.",
    args: { number: { type: "number", required: true, description: "Its number in the list (1 = first)" } },
    confirm: (a) => {
      const x = require("../poll/announce").loadAllSync()[a.number - 1];
      return x ? `Stop the announcement ${when(x)}: "${x.text.slice(0, 80)}"?` : "Stop that announcement?";
    },
    run: async (context, a) => {
      const announce = require("../poll/announce");
      const x = (await announce.list())[a.number - 1];
      if (!x) return context.send("I can't find an announcement with that number. Ask me to list them.");
      await announce.remove(x.id);
      await context.send("✅ Stopped. It won't be posted again.");
    },
  },

  // ----- Read-only info (everyone). Answered by code from stored data; counts only, never who voted what. -----
  {
    name: "show_menu",
    who: "everyone",
    description: "Show the lunch/breakfast menu for a given day, or for this week if no day is given.",
    args: { date: { type: "date", required: false, description: "The day to show (YYYY-MM-DD)" } },
    run: async (context, a) => {
      const { date: today } = require("./dates").nowInOffice();
      const { addDays, dayOfWeek } = require("./dates");
      const day = a.date || today;
      const monday = addDays(day, -((dayOfWeek(day) + 6) % 7));
      const menu = await polls.getMenu(monday);
      if (!menu) return context.send("There's no menu saved for that week yet.");
      const rows = menu.days.filter((d) => !a.date || d.date === a.date).map((d) => `**${d.day}${d.date ? " " + d.date : ""}**\n- Breakfast: ${d.breakfast.join(", ") || "-"}\n- Lunch: ${d.lunch.join(", ") || "-"}`);
      await context.send(rows.length ? rows.join("\n\n") : "No menu for that day.");
    },
  },
  {
    name: "my_votes",
    who: "everyone",
    description: "Show what the user themselves voted in the meal polls this week and next.",
    args: {},
    run: async (context) => {
      const { my_votes } = await cmds().chatContext(context);
      await context.send(my_votes ? `Here's where you stand:\n\n${my_votes.split("\n").map((l) => `- ${l}`).join("\n")}` : "I don't see any open polls for you right now.");
    },
  },
  {
    name: "open_polls",
    who: "everyone",
    description: "List the polls that are open right now, with how many people have voted in each (counts only).",
    args: {},
    run: async (context) => {
      const open = await polls.getOpenPolls();
      if (!open.length) return context.send("There are no open polls right now.");
      await context.send(open.map((p) => `- ${p.question || (p.type === "friday_diet" ? `Friday lunch poll (${p.date})` : `Weekly poll (week of ${p.weekStart})`)}: ${Object.keys(p.responses).length} voted${p.closesAt ? `, closes ${p.closesAt.replace("T", " ").slice(0, 16)}` : ""}`).join("\n"));
    },
  },

  // ----- Secret Santa. Pairings are made and sent by code only (see santa.js); the model never sees them. -----
  {
    name: "start_secret_santa",
    who: "hr",
    description: "Open a Secret Santa: posts a Join card in the group. Does not draw yet.",
    args: {
      title: { type: "string", required: true, description: "Name of the event, e.g. 'Office Secret Santa 2026'" },
      budget: { type: "string", required: false, description: "Gift budget, e.g. 'Rs 500'" },
    },
    confirm: (a) => `Post a Secret Santa sign-up "${a.title}" to the group?`,
    run: (context, a) => require("./santa").startSanta(context, { title: a.title, budget: a.budget }),
  },
  {
    name: "draw_secret_santa",
    who: "hr",
    description: "Do the Secret Santa draw for the open event and privately tell each person who they got. Needs at least 3 people.",
    args: {},
    confirm: () => "Do the Secret Santa draw now? People can't join or leave after this.",
    run: (context) => require("./santa").drawSanta(context),
  },
  {
    name: "remind_secret_santa",
    who: "hr",
    description: "Remind the people in the group who haven't joined the open Secret Santa yet (@mentions them). Not for poll votes.",
    args: { delivery: { type: "string", required: false, description: "Where to send it: 'group' (in the group chat) or 'dm' (privately to each person). Leave out unless the user says", values: ["group", "dm"] }, },
    confirm: (a) => `${a.delivery === "dm" ? "Privately message" : "Post a reminder in the group for"} the people who haven't joined the Secret Santa?`,
    run: (context, a) => require("./santa").remindSanta(context, a.delivery),
  },
  {
    name: "my_santa",
    who: "everyone",
    description: "Tell the user who they are Secret Santa for (only works in a 1:1 chat).",
    args: {},
    run: (context) => require("./santa").mySanta(context),
  },
  {
    name: "secret_santa_status",
    who: "everyone",
    description: "Say whether a Secret Santa is open and how many people joined.",
    args: {},
    run: (context) => require("./santa").santaStatus(context),
  },
];

// Card listing the scheduled alerts, each with a Delete button (handled in handleAction: agent_delete_alert).
function alertsCard(all) {
  const body = [{ type: "TextBlock", text: `🔔 Scheduled alerts (${all.length})`, weight: "Bolder", size: "Medium" }];
  if (!all.length) body.push({ type: "TextBlock", text: "No alerts are scheduled. Ask me, e.g. \"every weekday at 6:30 pm remind everyone to switch off the AC\".", wrap: true, isSubtle: true });
  all.forEach((a, i) => {
    body.push({
      type: "Container", style: "emphasis", spacing: "Medium",
      items: [
        { type: "TextBlock", text: `${i + 1}. ${a.text.length > 140 ? a.text.slice(0, 137) + "..." : a.text}`, wrap: true, weight: "Bolder" },
        { type: "TextBlock", text: `${when(a)} · ${a.delivery === "dm" ? "🔒 private message to everyone" : "👥 group"}`, wrap: true, isSubtle: true, size: "Small", spacing: "None" },
        { type: "ActionSet", actions: [{ type: "Action.Submit", title: "🗑️ Delete", style: "destructive", data: { action: "agent_delete_alert", id: a.id } }] },
      ],
    });
  });
  return { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5", body };
}

// "at 18:30 on mon, tue, every week" / "once on 2026-11-25 at 18:30"
const when = (a) => (a.date ? `once on ${a.date} at ${a.time}` : `at ${a.time} on ${(a.days || []).join(", ")}, every week`);

// One example sentence per tool, used for "what can you do?" and the "I didn't understand" reply (kept here so it stays in sync).
const EXAMPLES = {
  // order matters: the first few are what a greeting shows. HR first, then things everyone can do.
  new_poll: "make a poll about the team outing: Fri, Sat, Sun",
  schedule_announcement: "every weekday at 6:30 pm remind everyone to switch off the AC",
  remind_voters: "remind the people who haven't voted (add *privately* for 1:1)",
  close_poll: "close the poll",
  start_secret_santa: "start a secret santa called Office Santa, budget 500",
  show_menu: "what's the menu tomorrow?",
  my_votes: "did I vote?",
  open_polls: "which polls are open?",
  send_feedback: "feedback the biryani was great",
  my_santa: "my santa",
  secret_santa_status: "secret santa status",
  list_announcements: "list alerts (you can delete them from the card)",
  cancel_announcement: "delete the second alert",
  reopen_poll: "reopen the friday poll",
  start_weekly_poll: "start the weekly poll",
  start_friday_poll: "start the friday poll",
  show_schedule: "show the poll schedule",
  set_schedule: "push the friday cutoff to 12:30",
  set_reminder_delivery: "send reminders privately from now on",
  draw_secret_santa: "draw the secret santa",
  remind_secret_santa: "remind people to join the secret santa",
  feedback_summary: "summarise this week's meal feedback",
};
// Example sentences for what this user can do right now (HR gets the extra HR ones), in EXAMPLES order; n = how many (0 = all).
function examplesFor(isHr, n = 0) {
  const ok = new Set(TOOLS.filter((t) => allowed(t, isHr)).map((t) => t.name));
  const all = Object.keys(EXAMPLES).filter((name) => ok.has(name)).map((name) => EXAMPLES[name]);
  return n ? all.slice(0, n) : all;
}

const byName = (name) => TOOLS.find((t) => t.name === name);
const allowed = (tool, isHr) => tool.who === "everyone" || isHr;

// What the model sees for this user: no run/confirm/who, and HR-only tools only for HR.
function buildCatalog(isHr) {
  return TOOLS.filter((t) => allowed(t, isHr)).map((t) => ({
    name: t.name,
    description: t.description,
    args: Object.fromEntries(
      Object.entries(t.args).map(([k, d]) => [
        k, { type: d.type, required: !!d.required, description: d.values ? `${d.description} (one of: ${d.values.join(", ")})` : d.description },
      ])
    ),
  }));
}

// ---------- Validation (code never trusts the model's args) ----------
const RE = { date: /^\d{4}-\d{2}-\d{2}$/, time: /^([01]\d|2[0-3]):[0-5]\d$/, datetime: /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/ };

// Returns { args } (only known args, correctly typed) or { error } (text for the user).
function validateArgs(tool, given) {
  const input = given && typeof given === "object" && !Array.isArray(given) ? given : {};
  const args = {};
  for (const [name, def] of Object.entries(tool.args)) {
    let v = input[name];
    if (v === undefined || v === null || v === "") {
      if (def.required) return { error: `I'm missing "${name}" (${def.description}).` };
      continue;
    }
    switch (def.type) {
      case "string": if (typeof v !== "string") v = String(v); v = v.trim().slice(0, 500); break;
      case "number": v = Number(v); if (!Number.isFinite(v)) return { error: `"${name}" should be a number.` }; break;
      case "boolean": if (v === "true") v = true; else if (v === "false") v = false; if (typeof v !== "boolean") return { error: `"${name}" should be yes or no.` }; break;
      case "date": case "time": case "datetime": if (typeof v !== "string" || !RE[def.type].test(v)) return { error: `"${name}" isn't a valid ${def.type}.` }; break;
      case "list":
        if (!Array.isArray(v)) return { error: `"${name}" should be a list.` };
        v = v.map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
        break;
    }
    if (def.values && !def.values.includes(typeof v === "string" ? v.toLowerCase() : v)) return { error: `"${name}" must be one of: ${def.values.join(", ")}.` };
    if (typeof v === "string" && def.values) v = v.toLowerCase();
    args[name] = v;
  }
  return { args };
}

// ---------- Short per-user conversation memory (for "ask" follow-ups) ----------
const MEMORY_MS = 10 * 60 * 1000;
const MAX_TURNS = 6;
const memory = new Map(); // userId -> { at, turns: [{role, text}] }

function recall(userId) {
  const m = memory.get(userId);
  return m && Date.now() - m.at < MEMORY_MS ? m.turns : [];
}
function remember(userId, ...turns) {
  const prior = recall(userId);
  memory.set(userId, { at: Date.now(), turns: [...prior, ...turns].slice(-MAX_TURNS) });
}

// ---------- Model output ----------
function parseReply(out) {
  if (typeof out === "string") {
    const m = out.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    try { out = JSON.parse(m); } catch { return null; }
  }
  return out && typeof out === "object" && typeof out.type === "string" ? out : null;
}

// ---------- Actions taken (sent to the model as `recent_actions`, so "undo that" / "same for Friday" make sense) ----------
// Per user, last few actions with outcome. Saved to bot/data/agent-actions.json so it survives a restart; entries older than
// 48 h are dropped. Holds only what that user asked the bot to do (tool name + their own args), never other people's data.
const fs = require("fs");
const path = require("path");
const ACTIONS_FILE = path.join(process.env.BOT_DATA_DIR || path.join(__dirname, "data"), "agent-actions.json");
const MAX_ACTIONS = 8, ACTIONS_TTL_MS = 48 * 3600 * 1000;
let actionLog = null;
const loadActions = () => (actionLog ||= (() => { try { return JSON.parse(fs.readFileSync(ACTIONS_FILE, "utf8")); } catch { return {}; } })());

function shortArgs(args) {
  return Object.fromEntries(Object.entries(args || {}).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 120) : Array.isArray(v) ? v.slice(0, 10) : v]));
}
// status: "done" | "failed: <reason>" | "cancelled by user" (done = the tool ran without an error; a tool may still have
// replied "can't find that", which is why the wording is "ran")
function logAction(userId, toolName, args, status) {
  const log = loadActions();
  const now = Date.now(), office = require("./dates").nowInOffice();
  const list = (log[userId] || []).filter((a) => now - a.ts < ACTIONS_TTL_MS);
  list.push({ ts: now, at: `${office.date} ${office.time.slice(0, 5)}`, tool: toolName, args: shortArgs(args), status });
  log[userId] = list.slice(-MAX_ACTIONS);
  try { fs.mkdirSync(path.dirname(ACTIONS_FILE), { recursive: true }); fs.writeFileSync(ACTIONS_FILE, JSON.stringify(log, null, 2)); } catch { /* not critical */ }
}
const recentActions = (userId) => (loadActions()[userId] || []).filter((a) => Date.now() - a.ts < ACTIONS_TTL_MS).map(({ at, tool, args, status }) => ({ at, tool, args, status }));

// ---------- Running a tool (shared by the first message and the confirm button) ----------
async function execute(context, tool, args) {
  const userId = context.activity.from.id;
  try {
    await tool.run(context, args);
    logAction(userId, tool.name, args, "done");
  } catch (err) {
    context.log.error(`Agent tool ${tool.name} failed: ${err.stack || err.message}`);
    logAction(userId, tool.name, args, `failed: ${String(err.message).slice(0, 100)}`);
    await context.send(`Sorry, that didn't work: ${err.message}`);
  }
}

function confirmCard(tool, args) {
  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5",
    body: [{ type: "TextBlock", text: `❓ ${tool.confirm(args)}`, wrap: true, weight: "Bolder" }],
    actions: [
      { type: "Action.Submit", title: "✅ Yes", data: { action: "agent_confirm", tool: tool.name, args } },
      { type: "Action.Submit", title: "Cancel", data: { action: "agent_cancel", tool: tool.name, args } },
    ],
  };
}

// ---------- Entry points ----------
// Returns true if it replied; false → caller falls back to the Chat flow.
async function handleMessage(context, text) {
  if (!kompass.agentEnabled()) return false;
  const userId = context.activity.from.id;
  const isHr = await cmds().isHr(context);
  const catalog = buildCatalog(isHr);
  let reply;
  try {
    const ctx = await cmds().chatContext(context);
    const open = (await polls.getOpenPolls()).map((p) => ({ type: p.type, title: p.question || p.type, closesAt: p.closesAt || null }));
    reply = parseReply(await kompass.agent({
      message: text.slice(0, 1000),
      is_hr: String(isHr),
      today: ctx.today,
      tools: JSON.stringify(catalog),
      context: JSON.stringify({ menu: ctx.menu, my_votes: ctx.my_votes, open_polls: open, recent_actions: recentActions(userId) }),
      conversation: JSON.stringify(recall(userId)),
    }));
  } catch (err) {
    context.log.warn(`Agent call failed, falling back to Chat: ${err.message}`);
    return false;
  }
  if (!reply) return false;

  if (reply.type === "answer" && reply.text) {
    await context.send(String(reply.text));
    remember(userId, { role: "user", text }, { role: "bot", text: String(reply.text) });
    return true;
  }
  if (reply.type === "ask" && reply.question) {
    await context.send(String(reply.question));
    remember(userId, { role: "user", text }, { role: "bot", text: String(reply.question) });
    return true;
  }
  if (reply.type === "tool") {
    const tool = byName(reply.name);
    if (!tool) {
      await context.send("I can't do that yet.");
      return true;
    }
    if (!allowed(tool, isHr)) {
      await context.send("Only HR can do that.");
      return true;
    }
    const v = validateArgs(tool, reply.args);
    if (v.error) {
      await context.send(`${v.error} Could you tell me?`);
      remember(userId, { role: "user", text }, { role: "bot", text: v.error });
      return true;
    }
    // The request is complete: keep it in the short conversation too, with what the bot did, so follow-ups can refer to it.
    remember(userId, { role: "user", text }, { role: "bot", text: `[${tool.confirm ? "asked HR to confirm" : "ran"} ${tool.name} ${JSON.stringify(shortArgs(v.args))}]` });
    if (tool.confirm) await context.send(actions.cardMessage(confirmCard(tool, v.args)));
    else await execute(context, tool, v.args);
    return true;
  }
  return false; // "unknown" or anything unexpected
}

const recentConfirms = new Set();

// Buttons on confirmation cards: agent_confirm / agent_cancel. Permission and args are checked again here
// because card payloads come from the client.
async function handleAction(context) {
  const v = context.activity.value;
  if (!(await cmds().isHr(context))) {
    await context.send("Sorry, only HR can do that.");
    return;
  }
  if (v.action === "agent_cancel") {
    const t = byName(v.tool);
    if (t) logAction(context.activity.from.id, t.name, validateArgs(t, v.args).args || {}, "cancelled by user");
    await cmds().replaceCard(context, { type: "AdaptiveCard", version: "1.5", body: [{ type: "TextBlock", text: "❌ Cancelled. Nothing was done." }] });
    return;
  }
  if (v.action === "agent_delete_alert") {
    const announce = require("../poll/announce");
    try {
      await announce.remove(v.id);
    } catch {
      /* already gone: just show the current list */
    }
    await cmds().replaceCard(context, alertsCard(await announce.list()));
    return;
  }
  if (v.action === "agent_confirm") {
    // A fast double-click sends the same confirmation twice: run it once. Keyed by the card (or, without one, by user + tool + args).
    const key = `${context.activity.from.id}|${(context.activity.conversation || {}).id}|${context.activity.replyToId || v.tool + JSON.stringify(v.args)}`;
    if (recentConfirms.has(key)) return;
    recentConfirms.add(key);
    setTimeout(() => recentConfirms.delete(key), 60 * 1000).unref();
  }
  const tool = v.action === "agent_confirm" && byName(v.tool);
  const checked = tool && tool.confirm ? validateArgs(tool, v.args) : null;
  if (!checked || checked.error) {
    await context.send("Sorry, I couldn't do that. Please ask again.");
    return;
  }
  await cmds().replaceCard(context, { type: "AdaptiveCard", version: "1.5", body: [{ type: "TextBlock", text: `✅ ${tool.confirm(checked.args)} Yes, doing it.`, wrap: true }] });
  await execute(context, tool, checked.args);
}

module.exports = { examplesFor, EXAMPLES, recentActions, TOOLS, buildCatalog, validateArgs, parseReply, handleMessage, handleAction };
