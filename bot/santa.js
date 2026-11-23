// Secret Santa on the bot side: join card, draw + private messages, "my santa". Storage/draw logic is in ../poll/santa.js.
// Never send pairings to the AI model: this file has no Kompass calls on purpose.
const actions = require("./teamsActions");
const settings = require("../poll/settings");
const santa = require("../poll/santa");
const { buildSantaCard } = require("./cards/santaCards");
const cmds = () => require("./commands").internals;

const cardRefs = new Map(); // eventId -> { conversationId, activityId } (in memory; lost on restart, then the card just isn't refreshed)

async function startSanta(context, { title, budget }) {
  const event = await santa.createEvent({ title, budget, createdBy: { userId: context.activity.from.id } });
  actions.setTarget(context);
  const ref = await actions.postCard(buildSantaCard(event));
  cardRefs.set(event.id, ref);
  await context.send("✅ Secret Santa posted in the group. When enough people have joined, ask me to draw it.");
}

// Private message via the shared sender in teamsActions (reuses known 1:1 chats, creates one if needed).
const dm = (context, userId, tenantId, text) =>
  actions.sendDm(userId, text, { api: context.api, tenantId: tenantId || (context.activity.conversation || {}).tenantId });

async function drawSanta(context) {
  const event = await santa.getCurrentEvent();
  if (!event || event.status !== "joining") {
    await context.send("There's no Secret Santa open for joining.");
    return;
  }
  const done = await santa.draw(event.id); // throws a readable error if fewer than 3 people
  const failed = [];
  for (const [giverId, p] of Object.entries(done.participants)) {
    const to = await santa.getAssignmentFor(done.id, giverId);
    try {
      await dm(context, giverId, p.tenantId, `🎅 **${done.title}**: you're Secret Santa for **${to.name}**.${done.budget ? ` Budget: ${done.budget}.` : ""} Keep it secret! (Lost this message? Ask me \`my santa\`.)`);
    } catch (err) {
      context.log.warn(`Secret Santa DM to ${giverId} failed: ${err.message}`);
      failed.push(p.name);
    }
  }
  await refreshCard(context, done);
  await context.send(
    `🎉 Draw done for ${Object.keys(done.participants).length} people.` +
      (failed.length ? ` I couldn't message ${failed.join(", ")}; they can ask me \`my santa\` in a 1:1 chat.` : " Everyone has been told privately.")
  );
}

async function refreshCard(context, event, activityOverride) {
  const ref = cardRefs.get(event.id) || (activityOverride && { conversationId: context.activity.conversation.id, activityId: activityOverride });
  if (!ref) return;
  try {
    await context.api.conversations.updateActivity(ref.conversationId, ref.activityId, actions.cardMessage(buildSantaCard(event)));
  } catch (err) {
    context.log.warn(`Could not refresh Secret Santa card: ${err.message}`);
  }
}

async function mySanta(context) {
  const event = await santa.getCurrentEvent();
  if (!event) return context.send("There's no Secret Santa right now.");
  if (event.status === "joining") return context.send(`${event.title} is still open for joining; the draw hasn't happened yet.`);
  const to = await santa.getAssignmentFor(event.id, context.activity.from.id);
  // Only ever shown in 1:1 chats, never in a group.
  if ((context.activity.conversation.conversationType || "") !== "personal") return context.send("Ask me `my santa` in a 1:1 chat with me, so it stays secret.");
  await context.send(to ? `🎅 You're Secret Santa for **${to.name}**.` : "You didn't join this Secret Santa.");
}

// HR: @mention group members who haven't joined yet (only while joining is open).
async function remindSanta(context, delivery) {
  const event = await santa.getCurrentEvent();
  if (!event || event.status !== "joining") return context.send("There's no Secret Santa open for joining.");
  actions.setTarget(context);
  let members;
  try {
    members = await actions.getMembers();
  } catch (err) {
    context.log.warn(`getMembers failed: ${err.message}`);
    return context.send("I couldn't get the member list, so I didn't send a reminder.");
  }
  const left = members.filter((m) => !event.participants[m.userId]);
  if (!left.length) return context.send("Everyone in the group has joined already 🎉 No reminder sent.");
  const how = delivery || (await settings.getDelivery());
  const { failed } = (await actions.sendSantaReminder(event, left, how)) || { failed: [] };
  await context.send(
    `Reminder ${how === "dm" ? "sent privately" : "posted in the group"}. ${left.length} of ${members.length} people haven't joined: ${left.map((m) => m.name).join(", ")}.` +
      (failed.length ? ` I couldn't message ${failed.join(", ")} privately, so I @mentioned them in the group.` : "")
  );
}

async function santaStatus(context) {
  const event = await santa.getCurrentEvent();
  if (!event) return context.send("There's no Secret Santa right now.");
  const n = Object.keys(event.participants).length;
  await context.send(`🎅 **${event.title}**: ${event.status === "joining" ? `open for joining, ${n} joined so far` : `draw done (${n} people)`}.`);
}

// Join / Leave buttons (anyone). Edits the card the button was on.
async function handleAction(context) {
  const v = context.activity.value;
  const from = context.activity.from;
  try {
    const tenantId = (context.activity.conversation || {}).tenantId || null;
    const event = v.action === "santa_join" ? await santa.join(v.eventId, from.id, from.name, tenantId) : await santa.leave(v.eventId, from.id);
    cardRefs.set(event.id, { conversationId: context.activity.conversation.id, activityId: context.activity.replyToId });
    await refreshCard(context, event, context.activity.replyToId);
  } catch (err) {
    await context.send(err.message);
  }
}

module.exports = { _dm: dm, rememberPersonal: actions.rememberPersonal, startSanta, drawSanta, remindSanta, mySanta, santaStatus, handleAction };
