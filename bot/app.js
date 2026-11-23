const { stripMentionsText } = require("@microsoft/teams.api");
const { App } = require("@microsoft/teams.apps");
const { LocalStorage } = require("@microsoft/teams.common");
const config = require("./config");
const { ManagedIdentityCredential } = require("@azure/identity");
const actions = require("./teamsActions");
const { handleCommand, handleMenuAction } = require("./commands");
// Person B's poll logic (merged 2026-11-22; was ./mocks/poll).
const polls = require("../poll/poll");

// Handle a click on a poll card button (Action.Submit → message activity with `value`).
async function handleVote(context) {
  const { activity } = context;
  const { pollId, optionId } = activity.value;
  // The id of the card message being clicked (lets us update it even after a restart).
  actions.rememberPollCard(pollId, activity.conversation.id, activity.replyToId, context.api);

  let poll;
  try {
    // userId = Teams user id (activity.from.id). getMembers() must use the same id.
    poll = await polls.recordVote(pollId, activity.from.id, activity.from.name || "Unknown", optionId);
  } catch (err) {
    context.log.warn(`recordVote failed: ${err.message}`);
    await context.send("Sorry, that poll couldn't be found. It may have been removed.");
    return;
  }
  if (poll.status === "closed") {
    await context.send("Sorry, this poll is closed, so your vote wasn't counted.");
    return;
  }
  try {
    await actions.updatePollCard(poll);
  } catch (err) {
    context.log.warn(`updatePollCard failed: ${err.message}`);
  }
}

// Create storage for conversation history
const storage = new LocalStorage();

const createTokenFactory = () => {
  return async (scope, tenantId) => {
    const managedIdentityCredential = new ManagedIdentityCredential({
      clientId: process.env.CLIENT_ID,
    });
    const scopes = Array.isArray(scope) ? scope : [scope];
    const tokenResponse = await managedIdentityCredential.getToken(scopes, {
      tenantId: tenantId,
    });

    return tokenResponse.token;
  };
};

// Configure authentication using TokenCredentials
const tokenCredentials = {
  clientId: process.env.CLIENT_ID || "",
  token: createTokenFactory(),
};

const credentialOptions =
  config.MicrosoftAppType === "UserAssignedMsi" ? { ...tokenCredentials } : undefined;

// Create the app with storage
const app = new App({
  ...credentialOptions,
  storage,
  skipAuth: !process.env.CLIENT_ID,
});

const getConversationState = (conversationId) => {
  let state = storage.get(conversationId);
  if (!state) {
    state = { count: 0 };
    storage.set(conversationId, state);
  }
  return state;
};

app.on("message", async (context) => {
  const activity = context.activity;
  actions.noteActivity(context);
  // Card button clicks arrive as messages with no text and a `value` payload.
  if (activity.value && activity.value.action === "vote") {
    await handleVote(context);
    return;
  }
  if (activity.value && /^menu_/.test(activity.value.action || "")) {
    await handleMenuAction(context);
    return;
  }

  const text = (stripMentionsText(activity) || "").trim();

  // Meal poll commands (start weekly poll, start friday poll, close poll, help).
  if (await handleCommand(context, text)) return;

  if (text === "/reset") {
    storage.delete(activity.conversation.id);
    await context.send("Ok I've deleted the current conversation state.");
    return;
  }

  if (text === "/count") {
    const state = getConversationState(activity.conversation.id);
    await context.send(`The count is ${state.count}`);
    return;
  }

  if (text === "/diag") {
    await context.send(JSON.stringify(activity));
    return;
  }

  if (text === "/state") {
    const state = getConversationState(activity.conversation.id);
    await context.send(JSON.stringify(state));
    return;
  }

  if (text === "/runtime") {
    const runtime = {
      nodeversion: process.version,
      sdkversion: "2.0.0", // Microsoft Teams SDK
    };
    await context.send(JSON.stringify(runtime));
    return;
  }

  // Phase 1 test command: render a sample poll card from the mock poll module.
  // "/pollcard" = weekly sample, "/pollcard friday" = Friday sample.
  if (text === "/pollcard" || text === "/pollcard friday") {
    const friday = text.endsWith("friday");
    const poll = friday
      ? await polls.createPoll("friday_diet", { date: "2026-11-27", closesAt: "2026-11-27T11:00:00" })
      : await polls.createPoll("weekly_attendance", {
          weekStart: "2026-11-23",
          weekEnd: "2026-11-27",
          closesAt: "2026-11-23T10:00:00",
        });
    actions.setTarget(context);
    await actions.postPollCard(poll);
    return;
  }

  // Anything else: point to the command list (replaces the template's echo).
  await context.send("Sorry, I didn't understand that. Type `help` to see what I can do.");
});

actions.init(app);

module.exports = app;
