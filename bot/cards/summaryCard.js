// Summary Adaptive Card for a closed poll (Person A, internal).
// Input: the contract's summary object. Shows counts + names per option
// (HR decided everyone may see who voted what). Weekly polls also get HR's totals:
// breakfast = bf_lunch, lunch = bf_lunch + lunch_only.

const { formatDay } = require("./pollCard");

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

  const body = [
    { type: "TextBlock", text: "📊 Poll closed: results", weight: "Bolder", size: "Medium", wrap: true },
    { type: "TextBlock", text: summary.question, wrap: true, spacing: "None" },
  ];
  if (date) {
    body.push({
      type: "TextBlock",
      text: isWeekly ? `Week starting ${formatDay(date)}` : `For ${formatDay(date)}`,
      isSubtle: true, spacing: "None", wrap: true,
    });
  }

  if (isWeekly) {
    const breakfast = counts.bf_lunch || 0;
    const lunch = (counts.bf_lunch || 0) + (counts.lunch_only || 0);
    body.push({
      type: "FactSet",
      separator: true,
      facts: [
        { title: "🍳 Breakfast count", value: String(breakfast) },
        { title: "🍛 Lunch count", value: String(lunch) },
      ],
    });
  }

  for (const id of Object.keys(counts)) {
    const names = voters[id] || [];
    body.push({
      type: "Container",
      separator: true,
      items: [
        {
          type: "ColumnSet",
          columns: [
            { type: "Column", width: "stretch", items: [{ type: "TextBlock", text: LABELS[id] || id, weight: "Bolder", wrap: true }] },
            { type: "Column", width: "auto", items: [{ type: "TextBlock", text: String(counts[id]), weight: "Bolder" }] },
          ],
        },
        { type: "TextBlock", text: names.length ? names.join(", ") : "—", isSubtle: true, wrap: true, spacing: "None" },
      ],
    });
  }

  body.push({ type: "TextBlock", text: `Total votes: ${summary.totalVotes ?? 0}`, isSubtle: true, size: "Small", separator: true });

  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.5",
    body,
    msteams: { width: "Full" },
  };
}

module.exports = { buildSummaryCard };
