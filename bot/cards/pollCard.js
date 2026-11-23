// Generic poll Adaptive Card builder (Person A, internal to bot/).
// Renders ANY poll object from the v3 contract using only its own fields:
// question, options, responses, status, weekStart/weekEnd/date, closesAt.
// Pure function: no SDK calls, so it is safe to unit test and reuse in
// postPollCard (new message) and updatePollCard (replace existing message).

const { metaOf, optionIcon, chip, optionRows, banner, currentStyle } = require("./pollUi");

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
    return `${formatDay(poll.weekStart)} – ${formatDay(poll.weekEnd)}`;
  }
  if (poll.date) return formatDay(poll.date);
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

  const meta = metaOf(poll);
  const body = [
    banner(currentStyle(), { icon: meta.icon, label: isOpen ? meta.title : `${meta.title} · CLOSED`, title: poll.question, tone: isOpen ? "open" : "closed" }),
  ];

  // Info chips: dates, close time, poll options
  const chips = [];
  if (period) chips.push(chip(`📅 ${period}`));
  chips.push(isOpen ? chip(poll.closesAt ? `⏳ Closes ${formatDateTime(poll.closesAt)}` : "🟢 Open", poll.closesAt ? "Warning" : "Good") : chip("🔒 Poll closed", "Attention"));
  if (poll.multi) chips.push(chip("☑️ Pick all that apply"));
  if (poll.anonymous) chips.push(chip("🕶️ Anonymous"));
  body.push({ type: "ColumnSet", columns: chips, spacing: "Small" });

  body.push(...optionRows(poll, counts, total));

  body.push({
    type: "ColumnSet",
    separator: true,
    spacing: "Medium",
    columns: [
      { type: "Column", width: "auto", items: [{ type: "TextBlock", text: `👥 ${total} ${poll.multi ? (total === 1 ? "voter" : "voters") : total === 1 ? "vote" : "votes"}`, weight: "Bolder", size: "Small" }] },
      {
        type: "Column", width: "stretch",
        items: [{
          type: "TextBlock", horizontalAlignment: "Right", isSubtle: true, size: "Small", wrap: true,
          text: isOpen ? (usesChoiceSet(poll) ? "Vote again to change your answer" : "Tap again to change your vote") : "Voting is closed",
        }],
      },
    ],
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
    card.actions = [{ type: "Action.Submit", title: "🗳️ Vote", style: "positive", data: { action: "vote", pollId: poll.pollId } }];
  } else if (isOpen) {
    card.actions = (poll.options || []).map((opt, i) => ({
      type: "Action.Submit",
      title: `${optionIcon(poll, opt, i)} ${opt.label}`,
      data: { action: "vote", pollId: poll.pollId, optionId: opt.id },
    }));
  }

  return card;
}

module.exports = { buildPollCard, countVotes, formatDay, formatDateTime };
