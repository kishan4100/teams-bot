// Generic poll Adaptive Card builder (Person A, internal to bot/).
// Renders ANY poll object from the v3 contract using only its own fields:
// question, options, responses, status, weekStart/weekEnd/date, closesAt.
// Pure function: no SDK calls, so it is safe to unit test and reuse in
// postPollCard (new message) and updatePollCard (replace existing message).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Parse "YYYY-MM-DD" (or the date part of "YYYY-MM-DDTHH:mm:ss") without
// going through Date's UTC parsing, so the displayed day never shifts.
function parseLocalDate(value) {
  if (!value || typeof value !== "string") return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  return {
    date: new Date(Number(y), Number(mo) - 1, Number(d)),
    time: hh !== undefined ? `${hh}:${mm}` : null,
  };
}

function formatDay(value) {
  const p = parseLocalDate(value);
  if (!p) return value || "";
  const d = p.date;
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function formatDateTime(value) {
  const p = parseLocalDate(value);
  if (!p) return value || "";
  return p.time ? `${formatDay(value)}, ${p.time}` : formatDay(value);
}

function periodText(poll) {
  if (poll.weekStart && poll.weekEnd) {
    return `Week: ${formatDay(poll.weekStart)} – ${formatDay(poll.weekEnd)}`;
  }
  if (poll.date) return `For: ${formatDay(poll.date)}`;
  return null;
}

// Count votes per option from poll.responses. total = number of voters (for multi-choice polls one voter
// can tick several options, so the per-option counts can add up to more than total).
function countVotes(poll) {
  const counts = {};
  for (const opt of poll.options || []) counts[opt.id] = 0;
  let total = 0;
  for (const r of Object.values(poll.responses || {})) {
    if (!r) continue;
    total += 1;
    for (const id of r.optionIds || [r.optionId]) if (id in counts) counts[id] += 1;
  }
  return { counts, total };
}

// Buttons for short single-choice polls; checkboxes/radio list + a Vote button otherwise.
const MAX_BUTTONS = 5;
const usesChoiceSet = (poll) => !!poll.multi || (poll.options || []).length > MAX_BUTTONS;

// Simple text bar; Adaptive Cards 1.5 has no progress-bar element.
function bar(count, total, width = 10) {
  if (total === 0) return "░".repeat(width);
  const filled = Math.round((count / total) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/**
 * Build the poll Adaptive Card.
 * @param {object} poll  Poll object as defined in task-split.md (v3).
 * @returns {object}     Adaptive Card JSON (attach with contentType
 *                       "application/vnd.microsoft.card.adaptive").
 *
 * Button click payload (arrives in activity.value when using Action.Submit):
 *   { action: "vote", pollId, optionId }
 */
function buildPollCard(poll) {
  const isOpen = poll.status === "open";
  const { counts, total } = countVotes(poll);
  const period = periodText(poll);

  const body = [
    {
      type: "TextBlock",
      text: poll.question,
      weight: "Bolder",
      size: "Medium",
      wrap: true,
    },
  ];

  if (period) {
    body.push({ type: "TextBlock", text: period, isSubtle: true, spacing: "None", wrap: true });
  }

  body.push({
    type: "TextBlock",
    text: isOpen
      ? poll.closesAt ? `Closes: ${formatDateTime(poll.closesAt)}` : "Open"
      : "🔒 This poll is closed",
    isSubtle: isOpen,
    color: isOpen ? "Default" : "Attention",
    spacing: "None",
    wrap: true,
  });

  const notes = [poll.multi && "Pick all that apply", poll.anonymous && "Anonymous: names are never shown"].filter(Boolean);
  if (notes.length) body.push({ type: "TextBlock", text: notes.join(" · "), isSubtle: true, size: "Small", spacing: "None", wrap: true });

  // One row per option: label | bar | count
  for (const opt of poll.options || []) {
    const c = counts[opt.id] || 0;
    body.push({
      type: "ColumnSet",
      spacing: "Small",
      columns: [
        { type: "Column", width: "stretch", items: [{ type: "TextBlock", text: opt.label, wrap: true }] },
        { type: "Column", width: "auto", items: [{ type: "TextBlock", text: bar(c, total), fontType: "Monospace", isSubtle: true }] },
        { type: "Column", width: "auto", items: [{ type: "TextBlock", text: String(c), weight: "Bolder" }] },
      ],
    });
  }

  body.push({
    type: "TextBlock",
    text: `${poll.multi ? "Voters" : "Total votes"}: ${total}${isOpen ? (usesChoiceSet(poll) ? " · vote again to change your answer" : " · tap again to change your vote") : ""}`,
    isSubtle: true,
    size: "Small",
    separator: true,
    wrap: true,
  });

  const card = {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.5",
    body,
    msteams: { width: "Full" },
  };

  if (isOpen && usesChoiceSet(poll)) {
    // Click payload: { action: "vote", pollId, choices: "o1,o3" } (Teams adds the input values to `data`).
    body.push({
      type: "Input.ChoiceSet",
      id: "choices",
      isMultiSelect: !!poll.multi,
      style: "expanded",
      choices: poll.options.map((o) => ({ title: o.label, value: o.id })),
    });
    card.actions = [{ type: "Action.Submit", title: "Vote", data: { action: "vote", pollId: poll.pollId } }];
  } else if (isOpen) {
    card.actions = (poll.options || []).map((opt) => ({
      type: "Action.Submit",
      title: opt.label,
      data: { action: "vote", pollId: poll.pollId, optionId: opt.id },
    }));
  }

  return card;
}

module.exports = { buildPollCard, countVotes, formatDay, formatDateTime };
