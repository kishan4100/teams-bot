// Cards for custom (any-topic) polls. HR-facing only; everyone else sees the normal poll card.
//   buildNewPollForm(draft, error) → the "New poll" form (question, options, multi, anonymous, close time)
//   buildPollPreview(draft)        → how the poll will look + Post / Edit / Cancel
//   buildPostedCard(poll, note)    → HR's confirmation in the 1:1 chat, with Remind now / Close now while open
//   buildPollChooser(polls, verb)  → "which poll?" buttons when several polls are open (verb: "close" | "remind")
// All button data carries what the next step needs (the draft or the pollId), so nothing is kept in memory.

const { buildPollCard, formatDay, formatDateTime } = require("./pollCard");

function card(body, actions) {
  const c = { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5", body, msteams: { width: "Full" } };
  if (actions && actions.length) c.actions = actions;
  return c;
}

function buildNewPollForm(draft = {}, error = null) {
  const body = [
    { type: "TextBlock", text: "🗳️ New poll", weight: "Bolder", size: "Medium" },
    { type: "TextBlock", text: "Fill this in, then press Preview. Nothing is posted until you confirm.", isSubtle: true, wrap: true, spacing: "None" },
  ];
  if (error) body.push({ type: "TextBlock", text: `⚠️ ${error}`, color: "Attention", wrap: true });
  body.push(
    { type: "Input.Text", id: "q", label: "Question", placeholder: "e.g. Which day for the team outing?", maxLength: 300, value: draft.question || "" },
    { type: "Input.Text", id: "opts", label: "Options (one per line, 2 to 10)", isMultiline: true, placeholder: "Friday\nSaturday\nSunday", value: (draft.options || []).join("\n") },
    { type: "Input.Toggle", id: "multi", title: "Allow several answers", valueOn: "true", valueOff: "false", value: draft.multi ? "true" : "false" },
    { type: "Input.Toggle", id: "anonymous", title: "Anonymous (don't show who voted what)", valueOn: "true", valueOff: "false", value: draft.anonymous ? "true" : "false" },
    { type: "TextBlock", text: "Close time (optional). If set, people who haven't voted get reminders and the poll closes by itself.", wrap: true, isSubtle: true },
    {
      type: "ColumnSet",
      columns: [
        { type: "Column", width: "stretch", items: [{ type: "Input.Date", id: "closeDate", label: "Close date", value: draft.closeDate || undefined }] },
        { type: "Column", width: "stretch", items: [{ type: "Input.Time", id: "closeTime", label: "Close time", value: draft.closeTime || undefined }] },
      ],
    }
  );
  return card(body, [
    { type: "Action.Submit", title: "Preview", data: { action: "cpoll_preview" } },
    { type: "Action.Submit", title: "Cancel", data: { action: "cpoll_cancel" } },
  ]);
}

// draft: { draftId, question, options[], multi, anonymous, closeDate, closeTime, closesAt }
function buildPollPreview(draft) {
  const fake = {
    pollId: "preview", type: "custom", question: draft.question,
    options: draft.options.map((label, i) => ({ id: `o${i + 1}`, label })),
    closesAt: draft.closesAt, status: "open", responses: {}, multi: draft.multi, anonymous: draft.anonymous,
  };
  const pollCard = buildPollCard(fake);
  const info = [
    draft.closesAt ? `Closes ${formatDateTime(draft.closesAt)}; reminders every 30 min (09:00–21:00) until then.` : "No close time: close it yourself with Close now or `close poll`.",
  ];
  return card(
    [
      { type: "TextBlock", text: "👀 Preview: not posted yet", weight: "Bolder", size: "Medium" },
      { type: "TextBlock", text: info.join(" "), isSubtle: true, wrap: true, spacing: "None" },
      { type: "Container", style: "emphasis", items: pollCard.body.filter((b) => b.type !== "Input.ChoiceSet") },
    ],
    [
      { type: "Action.Submit", title: "✅ Post to the group", data: { action: "cpoll_post", draft } },
      { type: "Action.Submit", title: "Edit", data: { action: "cpoll_edit", draft } },
      { type: "Action.Submit", title: "Cancel", data: { action: "cpoll_cancel" } },
    ]
  );
}

function buildPostedCard(poll, note = null) {
  const open = poll.status === "open";
  const body = [
    { type: "TextBlock", text: open ? "✅ Poll posted to the group" : "🔒 Poll closed, results posted to the group", weight: "Bolder", size: "Medium", wrap: true },
    { type: "TextBlock", text: poll.question, wrap: true, spacing: "None" },
    {
      type: "TextBlock", isSubtle: true, wrap: true, spacing: "None",
      text: open ? (poll.closesAt ? `Closes ${formatDateTime(poll.closesAt)}` : "No close time set") : "Closed",
    },
  ];
  if (note) body.push({ type: "TextBlock", text: note, wrap: true, isSubtle: true });
  return card(body, open ? [
    { type: "Action.Submit", title: "Remind now", data: { action: "cpoll_remind", pollId: poll.pollId, from: "posted" } },
    { type: "Action.Submit", title: "Close now", data: { action: "cpoll_close", pollId: poll.pollId, from: "posted" } },
  ] : []);
}

function pollTitle(poll) {
  if (poll.type === "weekly_attendance") return `Weekly meal poll (week of ${formatDay(poll.weekStart)})`;
  if (poll.type === "friday_diet") return `Friday lunch poll (${formatDay(poll.date)})`;
  const q = poll.question.length > 60 ? poll.question.slice(0, 57) + "..." : poll.question;
  return `"${q}"`;
}

function buildPollChooser(openPolls, verb) {
  return card(
    [{ type: "TextBlock", text: `${openPolls.length} polls are open. Which one should I ${verb}?`, weight: "Bolder", wrap: true }],
    openPolls.slice(0, 6).map((p) => ({
      type: "Action.Submit",
      title: pollTitle(p),
      data: { action: verb === "close" ? "cpoll_close" : "cpoll_remind", pollId: p.pollId },
    }))
  );
}

module.exports = { buildNewPollForm, buildPollPreview, buildPostedCard, buildPollChooser, pollTitle };
