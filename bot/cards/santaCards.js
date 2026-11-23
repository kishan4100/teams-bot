// Secret Santa join card. Names of people who joined are shown (it's a sign-up); pairings are never on any card.
function buildSantaCard(event) {
  const names = Object.values(event.participants).map((p) => p.name);
  const open = event.status === "joining";
  const body = [
    { type: "TextBlock", text: `🎅 ${event.title}`, weight: "Bolder", size: "Medium", wrap: true },
    { type: "TextBlock", text: open ? "Press Join to take part. HR will do the draw, and you'll get a private message telling you who you're Secret Santa for." : "🎁 The draw is done. Everyone in it has been told who they're Secret Santa for (private message). If you didn't get one, ask me `my santa`.", wrap: true, isSubtle: true, spacing: "None" },
  ];
  if (event.budget) body.push({ type: "TextBlock", text: `Budget: ${event.budget}`, wrap: true });
  body.push({ type: "TextBlock", text: names.length ? `**${names.length} joined:** ${names.join(", ")}` : "Nobody has joined yet.", wrap: true });
  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5", body,
    actions: open ? [
      { type: "Action.Submit", title: "🎁 Join", data: { action: "santa_join", eventId: event.id } },
      { type: "Action.Submit", title: "Leave", data: { action: "santa_leave", eventId: event.id } },
    ] : [],
  };
}
module.exports = { buildSantaCard };
