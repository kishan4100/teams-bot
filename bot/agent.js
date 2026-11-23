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
    name: "remind_voters",
    who: "hr",
    description: "Remind the people who haven't voted yet in an open poll (@mentions them in the group).",
    args: { which: { type: "string", required: false, description: "'weekly' or 'friday' to pick a meal poll; leave out otherwise", values: ["weekly", "friday"] } },
    confirm: (a) => `Post a reminder to people who haven't voted${a.which ? " in the " + a.which + " poll" : ""}?`,
    run: (context, a) => cmds().remindCmd(context, a.which),
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
      await context.send(my_votes || "I don't see any polls for this week yet.");
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
const forget = (userId) => memory.delete(userId);

// ---------- Model output ----------
function parseReply(out) {
  if (typeof out === "string") {
    const m = out.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    try { out = JSON.parse(m); } catch { return null; }
  }
  return out && typeof out === "object" && typeof out.type === "string" ? out : null;
}

// ---------- Running a tool (shared by the first message and the confirm button) ----------
async function execute(context, tool, args) {
  try {
    await tool.run(context, args);
  } catch (err) {
    context.log.error(`Agent tool ${tool.name} failed: ${err.stack || err.message}`);
    await context.send(`Sorry, that didn't work: ${err.message}`);
  }
}

function confirmCard(tool, args) {
  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5",
    body: [{ type: "TextBlock", text: `❓ ${tool.confirm(args)}`, wrap: true, weight: "Bolder" }],
    actions: [
      { type: "Action.Submit", title: "✅ Yes", data: { action: "agent_confirm", tool: tool.name, args } },
      { type: "Action.Submit", title: "Cancel", data: { action: "agent_cancel" } },
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
      context: JSON.stringify({ menu: ctx.menu, my_votes: ctx.my_votes, open_polls: open }),
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
    forget(userId); // the request is complete
    if (tool.confirm) await context.send(actions.cardMessage(confirmCard(tool, v.args)));
    else await execute(context, tool, v.args);
    return true;
  }
  return false; // "unknown" or anything unexpected
}

// Buttons on confirmation cards: agent_confirm / agent_cancel. Permission and args are checked again here
// because card payloads come from the client.
async function handleAction(context) {
  const v = context.activity.value;
  if (!(await cmds().isHr(context))) {
    await context.send("Sorry, only HR can do that.");
    return;
  }
  if (v.action === "agent_cancel") {
    await cmds().replaceCard(context, { type: "AdaptiveCard", version: "1.5", body: [{ type: "TextBlock", text: "❌ Cancelled. Nothing was done." }] });
    return;
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

module.exports = { TOOLS, buildCatalog, validateArgs, parseReply, handleMessage, handleAction };
