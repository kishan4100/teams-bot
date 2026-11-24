// Summary Adaptive Card for a closed poll (Person A, internal).
// Input: the contract's summary object. Shows counts + names per option
// (HR decided everyone may see who voted what). Weekly polls also get HR's totals:
// breakfast = bf_lunch, lunch = bf_lunch + lunch_only.

const { formatDay } = require("./pollCard");
const { metaOf, chip, optionRows, banner, currentStyle } = require("./pollUi");

// Option labels aren't in the summary object, so keep a label table for known ids.
// Unknown ids fall back to the id itself.
const LABELS = {
  bf_lunch: "Breakfast + Lunch",
  lunch_only: "Only Lunch",
  none: "No BF, No lunch",
  veg: "Veg",
  nonveg: "Non veg",
};

// pollId format (contract): "<type>-<weekStart or date>"
function dateFromPollId(pollId) {
  const m = String(pollId).match(/(\d{4}-\d{2}-\d{2})$/);
  return m ? m[1] : null;
}

function buildSummaryCard(summary) {
  const counts = summary.counts || {};
  const voters = summary.voters || {};
  const date = dateFromPollId(summary.pollId);
  const isWeekly = summary.type === "weekly_attendance";
  const total = summary.totalVotes ?? 0;

  // Meal polls get their labels from the table, custom polls carry their own.
  const labelOf = Object.fromEntries((summary.options || []).map((o) => [o.id, o.label]));
  const options = Object.keys(counts).map((id) => ({ id, label: labelOf[id] || LABELS[id] || id }));
  const poll = { type: summary.type, options };

  const sectionLabel = (text) => ({ type: "TextBlock", text: text.toUpperCase(), size: "Small", weight: "Bolder", isSubtle: true, spacing: "Medium" });

  const meta = metaOf(poll);
  const body = [
    banner(currentStyle(), { icon: "📊", label: `${meta.title} · RESULTS`, title: summary.question, tone: "results" }),
  ];

  const chips = [];
  if (date) chips.push(chip(isWeekly ? `📅 Week starting ${formatDay(date)}` : `📅 For ${formatDay(date)}`));
  if (summary.multi) chips.push(chip("☑️ Several answers allowed"));
  if (summary.anonymous) chips.push(chip("🕶️ Anonymous poll"));
  if (chips.length) body.push({ type: "ColumnSet", columns: chips, spacing: "Small" });

  if (total === 0) body.push({ type: "TextBlock", text: "😴 Nobody voted this time", weight: "Bolder", size: "Medium", wrap: true, spacing: "Medium" });

  if (isWeekly) {
    // Stat tiles for HR's kitchen numbers: breakfast = bf_lunch, lunch = bf_lunch + lunch_only.
    const tile = (label, n) => ({
      type: "Column", width: "stretch", style: "emphasis",
      items: [
        { type: "TextBlock", text: String(n), size: "ExtraLarge", weight: "Bolder", horizontalAlignment: "Center", spacing: "None" },
        { type: "TextBlock", text: label, isSubtle: true, size: "Small", horizontalAlignment: "Center", spacing: "None" },
      ],
    });
    body.push(sectionLabel("Headcount"));
    body.push({
      type: "ColumnSet", spacing: "Small",
      columns: [tile("Breakfast count", counts.bf_lunch || 0), tile("Lunch count", (counts.bf_lunch || 0) + (counts.lunch_only || 0))],
    });
  }

  body.push(sectionLabel("Responses"));
  body.push(...optionRows(poll, counts, total, { names: summary.anonymous ? null : voters }));

  body.push({ type: "TextBlock", text: `👥 ${total} ${summary.multi ? (total === 1 ? "voter" : "voters") : total === 1 ? "vote" : "votes"}`, weight: "Bolder", size: "Small", separator: true, spacing: "Medium" });

  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.5",
    body,
    msteams: { width: "Full" },
  };
}

module.exports = { buildSummaryCard };
