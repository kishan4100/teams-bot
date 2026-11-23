// Person A's contract functions (task-split.md "Person A provides").
// Import: const actions = require("../bot/teamsActions"); all functions are async and throw on failure.
//
// All 7 implemented: postPollCard, updatePollCard, postSummary, postMenuPreview, postMenuCard,
// sendReminder, getMembers. (postPollCard has no @mention yet.)
//
// Where messages go:
//   - "target chat" (polls, summaries, menu card, reminders): set ONCE by HR sending `use this chat` in the
//     meal-poll group chat / channel. Saved to bot/data/target.json, so it survives restarts.
//     HR can then run every command from a 1:1 chat with the bot.
//   - "HR chat" (menu preview, paste box): the chat where HR typed the command (in memory).
// API client used for sending: the one from the most recent incoming message (ctx.api, any chat). It already
// points at the right service URL, which is what makes sending work in Agents Playground (app.send() needs
// bot credentials, and Playground has none). If no message has arrived since startup (e.g. the scheduler
// fires first after a restart), it falls back to app.api (needs real bot credentials, i.e. real Teams).

const { buildPollCard } = require("./cards/pollCard");
const { buildSummaryCard } = require("./cards/summaryCard");
const { buildMenuPreviewCard, buildMenuCard } = require("./cards/menuCards");
const { weeklyWeekStart, nowInOffice } = require("./dates");
const { formatDay, formatDateTime } = require("./cards/pollCard");
const fs = require("fs");
const path = require("path");

const DATA = process.env.BOT_DATA_DIR || path.join(__dirname, "data"); // BOT_DATA_DIR: tests use a temp folder
const TARGET_FILE = path.join(DATA, "target.json");

let target = loadTarget(); // { conversationId, conversationType, setAt }: where team posts go
let hrChat = null; // { conversationId, api }: where the last HR command was typed
let lastApi = null; // ctx.api from the most recent incoming activity
let appRef = null; // the App, for the app.api fallback
let lastTenantId = loadSmall("tenant.json").tenantId || null; // needed to open 1:1 chats; remembered across restarts
const pollCards = new Map(); // pollId -> { conversationId, activityId }  (in memory; lost on restart)

function loadSmall(name) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8")); } catch { return {}; }
}
function saveSmall(name, obj) {
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(path.join(DATA, name), JSON.stringify(obj, null, 2)); } catch { /* not critical */ }
}

function cardMessage(card) {
  return {
    type: "message",
    attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: card }],
  };
}

function loadTarget() {
  try {
    return JSON.parse(fs.readFileSync(TARGET_FILE, "utf8"));
  } catch {
    return null;
  }
}

// Called once from app.js with the App instance (fallback sender for the scheduler).
function init(app) {
  appRef = app;
}

// Called by app.js for every incoming activity: keep the freshest API client.
let firstActivityCallbacks = [];
function noteActivity(ctx) {
  if (ctx && ctx.api) lastApi = ctx.api;
  const tid = ctx && ctx.activity && ctx.activity.conversation && ctx.activity.conversation.tenantId;
  if (tid && tid !== lastTenantId) { lastTenantId = tid; saveSmall("tenant.json", { tenantId: tid }); }
  rememberPersonal(ctx && ctx.activity);
  if (firstActivityCallbacks.length) {
    const cbs = firstActivityCallbacks;
    firstActivityCallbacks = [];
    cbs.forEach((cb) => cb());
  }
}

// Run cb once, when the first activity arrives (used to delay the scheduler in Playground).
function onFirstActivity(cb) {
  if (lastApi) cb();
  else firstActivityCallbacks.push(cb);
}

// `use this chat`: make the current conversation the target and save it.
function useThisChat(ctx) {
  const conv = ctx.activity.conversation;
  target = { conversationId: conv.id, conversationType: conv.conversationType || null, setAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(TARGET_FILE), { recursive: true });
  fs.writeFileSync(TARGET_FILE, JSON.stringify(target, null, 2));
  lastApi = ctx.api;
  return target;
}

function getTargetInfo() {
  return target;
}

// Called by commands.js for each HR command: remember where HR is typing (for the preview).
function setTarget(ctx) {
  hrChat = { conversationId: ctx.activity.conversation.id, api: ctx.api };
  lastApi = ctx.api;
}

// Called by app.js when a vote click arrives, so updatePollCard can find the card
// even if it was posted before a restart (Teams sends the card's id as replyToId).
function rememberPollCard(pollId, conversationId, activityId, api) {
  if (!pollId || !conversationId || !activityId) return;
  pollCards.set(pollId, { conversationId, activityId });
  if (api) lastApi = api;
}

// ---------- Private (1:1) messages ----------
// Known 1:1 chats (userId -> conversationId): filled whenever someone messages the bot in a personal chat, saved on disk.
const DM_FILE = path.join(DATA, "dm-conversations.json");
let dmChats = null;
const loadDm = () => (dmChats ||= (() => { try { return JSON.parse(fs.readFileSync(DM_FILE, "utf8")); } catch { return {}; } })());
function saveDm() {
  try { fs.mkdirSync(path.dirname(DM_FILE), { recursive: true }); fs.writeFileSync(DM_FILE, JSON.stringify(dmChats, null, 2)); } catch { /* not critical */ }
}
function rememberPersonal(activity) {
  if (!activity || !activity.from || !activity.conversation || activity.conversation.conversationType !== "personal") return;
  const chats = loadDm();
  if (chats[activity.from.id] !== activity.conversation.id) { chats[activity.from.id] = activity.conversation.id; saveDm(); }
}

/**
 * Send one private message (text) to a user. Reuses their 1:1 chat with the bot if known, otherwise creates one (Teams opens it
 * if the app is allowed to message them; unverified in real Teams). A stale saved chat is dropped and re-created once.
 * opts.api / opts.tenantId override the defaults (tests, or when a context is at hand). Throws if Teams refuses.
 */
async function sendDm(userId, text, opts = {}) {
  const api = opts.api || getApi();
  const chats = loadDm();
  if (chats[userId]) {
    try {
      await api.conversations.createActivity(chats[userId], { type: "message", text });
      return;
    } catch {
      delete chats[userId]; // stale: create a new one below
    }
  }
  const tenantId = opts.tenantId || lastTenantId;
  if (!tenantId) throw new Error("tenant id unknown yet (someone must message the bot once after startup)");
  const res = await api.conversations.create({ members: [{ id: userId }], tenantId });
  chats[userId] = res.id;
  saveDm();
  await api.conversations.createActivity(res.id, { type: "message", text });
}

/** DM the same text to several people ([{ userId, name }]). Returns the names it couldn't reach. */
async function sendDms(people, text, opts = {}) {
  const failed = [];
  for (const m of people) {
    try {
      await sendDm(m.userId, text, opts);
    } catch (err) {
      console.warn(`[dm] to ${m.userId} failed: ${err.message}`);
      failed.push(m.name);
    }
  }
  return failed;
}

function getApi() {
  if (lastApi) return lastApi;
  // app.api only works with real bot credentials (real Teams). Without them (Playground) it would call
  // Microsoft's public Teams endpoint unauthenticated, so don't try.
  if (appRef && process.env.CLIENT_ID) return appRef.api;
  throw new Error("Bot can't send yet: no message has arrived since startup (Playground needs one message first).");
}

function requireTarget() {
  if (!target) {
    throw new Error("No group chat set yet. Open the meal-poll group chat and send `use this chat` there.");
  }
  return { conversationId: target.conversationId, api: getApi() };
}

/** Post the poll card to the target chat. TODO: @mention (Phase 2, later). */
async function postPollCard(poll) {
  const { conversationId, api } = requireTarget();
  const res = await api.conversations.createActivity(conversationId, cardMessage(buildPollCard(poll)));
  pollCards.set(poll.pollId, { conversationId, activityId: res.id });
}

/** Remind people who haven't joined the Secret Santa yet (@mentions them, in chunks). people = [{ userId, name }]. */
async function sendSantaReminder(event, people, delivery = "group") {
  const { conversationId, api } = requireTarget();
  if (delivery === "dm") {
    const failed = await sendDms(people, `🎅 Reminder: **${event.title}** is open. Press **Join** on the Secret Santa card in the group chat if you want to take part.`);
    if (failed.length) await sendSantaReminder(event, people.filter((m) => failed.includes(m.name)), "group");
    return { failed };
  }
  for (let i = 0; i < people.length; i += MENTIONS_PER_MESSAGE) {
    const chunk = people.slice(i, i + MENTIONS_PER_MESSAGE);
    const entities = chunk.map((m) => ({ type: "mention", text: `<at>${m.name}</at>`, mentioned: { id: m.userId, name: m.name } }));
    const names = entities.map((e) => e.text).join(", ");
    const text = i === 0
      ? `🎅 Reminder: **${event.title}** is open. Press **Join** on the Secret Santa card above if you want to take part.\nNot joined yet: ${names}`
      : `Not joined yet (cont.): ${names}`;
    await api.conversations.createActivity(conversationId, { type: "message", text, entities });
  }
  return { failed: [] };
}

/** Post a recurring announcement (plain text) to the target chat. */
async function postAnnouncement(a) {
  const { conversationId, api } = requireTarget();
  if (a.delivery === "dm") {
    const failed = await sendDms(await getMembers(), `🔔 ${a.text}`); // everyone in the group, privately
    if (failed.length) console.warn(`[announcement ${a.id}] couldn't DM: ${failed.join(", ")}`);
    return;
  }
  await api.conversations.createActivity(conversationId, { type: "message", text: `🔔 ${a.text}` });
}

/** Post any Adaptive Card to the target chat. Returns { conversationId, activityId }. */
async function postCard(card) {
  const { conversationId, api } = requireTarget();
  const res = await api.conversations.createActivity(conversationId, cardMessage(card));
  return { conversationId, activityId: res.id };
}

/** Replace the posted poll card with fresh counts (same message, edited in place). */
// Many people voting at once would mean one card edit per vote, and Teams limits how fast a message can be edited.
// So votes ask for a refresh and a single edit goes out ~1.5 s after the last one, showing the latest counts.
const refreshTimers = new Map();
function updatePollCardSoon(pollId, fetchPoll, delayMs = 1500) {
  clearTimeout(refreshTimers.get(pollId));
  refreshTimers.set(pollId, setTimeout(async () => {
    refreshTimers.delete(pollId);
    try {
      const poll = await fetchPoll();
      if (poll) await updatePollCard(poll);
    } catch (err) {
      console.warn(`[card refresh] ${pollId}: ${err.message}`);
    }
  }, delayMs));
}

async function updatePollCard(poll) {
  const ref = pollCards.get(poll.pollId);
  if (!ref) throw new Error(`No posted card known for poll ${poll.pollId}`);
  const api = getApi();
  await api.conversations.updateActivity(ref.conversationId, ref.activityId, cardMessage(buildPollCard(poll)));
}

/** Post the results card (counts + names; weekly also breakfast/lunch totals) to the target chat. */
async function postSummary(summary) {
  const { conversationId, api } = requireTarget();
  await api.conversations.createActivity(conversationId, cardMessage(buildSummaryCard(summary)));
  // Also flip the original poll card to "closed" (no buttons), whether the close came from the
  // `close poll` command or from the scheduler. Best effort: a failure here doesn't fail postSummary.
  if (pollCards.has(summary.pollId)) {
    try {
      const poll = await require("../poll/poll").getPoll(summary.pollId);
      if (poll) await updatePollCard(poll);
    } catch (err) {
      console.warn(`[bot] couldn't refresh closed poll card ${summary.pollId}: ${err.message}`);
    }
  }
}

/** Show the parsed menu to HR (the chat where HR typed the command) with Confirm / Cancel. */
async function postMenuPreview(menu) {
  const chat = hrChat || requireTarget(); // falls back to the group if HR's chat is unknown
  const defaultWeek = weeklyWeekStart(nowInOffice().date);
  await chat.api.conversations.createActivity(chat.conversationId, cardMessage(buildMenuPreviewCard(menu, { defaultWeek })));
}

/** Post the clean day-by-day menu card to the target chat. */
async function postMenuCard(menu) {
  const { conversationId, api } = requireTarget();
  await api.conversations.createActivity(conversationId, cardMessage(buildMenuCard(menu)));
}

/**
 * Members of the target chat as [{ userId, name }]. userId = Teams user id (same as activity.from.id,
 * which is what votes are recorded under). Bots are left out. Throws if Teams refuses.
 */
async function getMembers() {
  const { conversationId, api } = requireTarget();
  const members = await api.conversations.getMembers(conversationId);
  return (members || [])
    .filter((m) => m && m.id && !String(m.id).startsWith("28:")) // "28:" = bot ids in Teams
    .map((m) => ({ userId: m.id, name: m.name || "Unknown" }));
}

// Max @mentions per reminder message. Not a documented Teams number we verified; chunking just keeps
// each message small.
const MENTIONS_PER_MESSAGE = 20;

function pollLabel(poll) {
  if (poll.type === "weekly_attendance" && poll.weekStart) return `this week's meal poll (week of ${formatDay(poll.weekStart)})`;
  if (poll.type === "friday_diet" && poll.date) return `the Friday lunch poll (${formatDay(poll.date)})`;
  if (poll.type === "custom") return `the poll "${poll.question}"`;
  return "the meal poll";
}

/**
 * Post a reminder to the target chat.
 * nonVoters = [{ userId, name }] → @mentions them (in chunks of MENTIONS_PER_MESSAGE).
 * nonVoters = null/undefined (member list unavailable) → a general reminder without mentions.
 * nonVoters = [] → nothing is sent.
 */
async function sendReminder(poll, nonVoters, delivery = "group") {
  const { conversationId, api } = requireTarget();
  const closes = poll.closesAt ? ` before ${formatDateTime(poll.closesAt)}` : "";
  const intro = `⏰ Reminder: please vote in ${pollLabel(poll)}${closes}. Vote on the poll card above.`;
  if (delivery === "dm" && Array.isArray(nonVoters)) {
    // Private: one 1:1 message each. Anyone the bot can't reach is @mentioned in the group instead (so nobody is missed).
    const failed = await sendDms(nonVoters, `${intro.replace("above", "in the group chat")}`);
    if (failed.length) await sendReminder(poll, nonVoters.filter((m) => failed.includes(m.name)), "group");
    return { failed };
  }

  if (!Array.isArray(nonVoters)) {
    await api.conversations.createActivity(conversationId, { type: "message", text: `${intro}\nIf you've already voted, thanks!` });
    return { failed: [] };
  }
  if (nonVoters.length === 0) return { failed: [] };

  for (let i = 0; i < nonVoters.length; i += MENTIONS_PER_MESSAGE) {
    const chunk = nonVoters.slice(i, i + MENTIONS_PER_MESSAGE);
    const entities = chunk.map((m) => ({
      type: "mention",
      text: `<at>${m.name}</at>`,
      mentioned: { id: m.userId, name: m.name },
    }));
    const names = entities.map((e) => e.text).join(", ");
    const text = i === 0 ? `${intro}\nNot voted yet: ${names}` : `Not voted yet (cont.): ${names}`;
    await api.conversations.createActivity(conversationId, { type: "message", text, entities });
  }
  return { failed: [] };
}

// True if a card for this poll has been posted (or clicked) since the bot started.
function hasPollCard(pollId) {
  return pollCards.has(pollId);
}

// True if that card is in the current target chat (false if it went to an older target).
function hasPollCardInTarget(pollId) {
  const ref = pollCards.get(pollId);
  return !!(ref && target && ref.conversationId === target.conversationId);
}

module.exports = {
  postPollCard,
  postCard,
  postAnnouncement,
  sendSantaReminder,
  sendDm,
  sendDms,
  rememberPersonal,
  updatePollCard,
  updatePollCardSoon,
  postSummary,
  postMenuPreview,
  postMenuCard,
  sendReminder,
  getMembers,
  hasPollCard,
  hasPollCardInTarget,
  cardMessage,
  // internal helpers for app.js / commands.js (not part of the contract)
  init,
  noteActivity,
  onFirstActivity,
  useThisChat,
  getTargetInfo,
  setTarget,
  rememberPollCard,
};
