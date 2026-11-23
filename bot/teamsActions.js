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

const TARGET_FILE = path.join(__dirname, "data", "target.json");

let target = loadTarget(); // { conversationId, conversationType, setAt }: where team posts go
let hrChat = null; // { conversationId, api }: where the last HR command was typed
let lastApi = null; // ctx.api from the most recent incoming activity
let appRef = null; // the App, for the app.api fallback
const pollCards = new Map(); // pollId -> { conversationId, activityId }  (in memory; lost on restart)

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

/** Post a recurring announcement (plain text) to the target chat. */
async function postAnnouncement(a) {
  const { conversationId, api } = requireTarget();
  await api.conversations.createActivity(conversationId, { type: "message", text: `🔔 ${a.text}` });
}

/** Post any Adaptive Card to the target chat. Returns { conversationId, activityId }. */
async function postCard(card) {
  const { conversationId, api } = requireTarget();
  const res = await api.conversations.createActivity(conversationId, cardMessage(card));
  return { conversationId, activityId: res.id };
}

/** Replace the posted poll card with fresh counts (same message, edited in place). */
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
async function sendReminder(poll, nonVoters) {
  const { conversationId, api } = requireTarget();
  const closes = poll.closesAt ? ` before ${formatDateTime(poll.closesAt)}` : "";
  const intro = `⏰ Reminder: please vote in ${pollLabel(poll)}${closes}. Vote on the poll card above.`;

  if (!Array.isArray(nonVoters)) {
    await api.conversations.createActivity(conversationId, { type: "message", text: `${intro}\nIf you've already voted, thanks!` });
    return;
  }
  if (nonVoters.length === 0) return;

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
  updatePollCard,
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
