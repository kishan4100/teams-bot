// Menu cards (Person A, internal).
//   buildMenuPreviewCard(menu, opts) → HR-only preview with warnings and Confirm / Cancel
//     (or a week picker when menu.weekStart is null, per the v3.2 "no week dates" decision).
//   buildMenuCard(menu)              → the clean day-by-day card posted to the team.
// The whole menu object is carried in the buttons' data, so Confirm works even after a bot restart.

const { formatDay } = require("./pollCard");

function list(items) {
  return items && items.length ? items.join(", ") : "—";
}

function dayBlocks(menu) {
  return (menu.days || []).map((d) => ({
    type: "Container",
    separator: true,
    items: [
      {
        type: "TextBlock",
        text: d.date ? `${d.day} · ${formatDay(d.date).replace(/^\w+ /, "")}` : d.day,
        weight: "Bolder",
        wrap: true,
      },
      {
        type: "FactSet",
        spacing: "Small",
        facts: [
          { title: "🍳 Breakfast", value: list(d.breakfast) },
          { title: "🍛 Lunch", value: list(d.lunch) },
        ],
      },
    ],
  }));
}

function weekTitle(menu) {
  return menu.weekStart && menu.weekEnd
    ? `${formatDay(menu.weekStart)} – ${formatDay(menu.weekEnd)}`
    : "week not set";
}

function card(body, actions) {
  const c = {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.5",
    body,
    msteams: { width: "Full" },
  };
  if (actions && actions.length) c.actions = actions;
  return c;
}

/**
 * @param {object} menu  contract menu object
 * @param {object} [opts]
 * @param {string} [opts.status]      "pending" (default) | "posted" | "cancelled"
 * @param {string} [opts.defaultWeek] YYYY-MM-DD shown in the week picker when weekStart is null
 */
function buildMenuPreviewCard(menu, opts = {}) {
  const status = opts.status || "pending";
  const body = [
    { type: "TextBlock", text: "👀 Menu preview: check before posting", weight: "Bolder", size: "Medium", wrap: true },
    { type: "TextBlock", text: `Week: ${weekTitle(menu)}`, isSubtle: true, spacing: "None", wrap: true },
  ];

  const warnings = menu.warnings || [];
  if (warnings.length) {
    body.push({
      type: "Container",
      style: "warning",
      items: [
        { type: "TextBlock", text: "Please check:", weight: "Bolder", wrap: true },
        ...warnings.map((w) => ({ type: "TextBlock", text: `⚠️ ${w}`, wrap: true, spacing: "Small" })),
      ],
    });
  }

  body.push(...dayBlocks(menu));

  if (status === "posted") {
    body.push({ type: "TextBlock", text: "✅ Confirmed and posted to the team.", color: "Good", weight: "Bolder", separator: true, wrap: true });
    return card(body);
  }
  if (status === "cancelled") {
    body.push({ type: "TextBlock", text: "❌ Cancelled. Nothing was posted.", color: "Attention", separator: true, wrap: true });
    return card(body);
  }

  const actions = [];
  if (!menu.weekStart) {
    body.push(
      { type: "TextBlock", text: "No week dates were found. Pick the Monday of the menu's week:", wrap: true, separator: true },
      { type: "Input.Date", id: "weekStart", value: opts.defaultWeek || undefined }
    );
    actions.push({ type: "Action.Submit", title: "Set week", data: { action: "menu_setweek", menu } });
  } else {
    actions.push({ type: "Action.Submit", title: "✅ Confirm and post", data: { action: "menu_confirm", menu } });
  }
  actions.push({ type: "Action.Submit", title: "Cancel", data: { action: "menu_cancel", menu } });
  return card(body, actions);
}

// Card with a multi-line text box for pasting the vendor's menu (keeps line breaks,
// which the normal message box may drop when pasting).
function buildMenuInputCard() {
  return card(
    [
      { type: "TextBlock", text: "🍽️ Paste this week's menu", weight: "Bolder", size: "Medium", wrap: true },
      {
        type: "TextBlock",
        text: "Paste the vendor's menu exactly as you got it (include the first line with the dates, e.g. \"Menu for the week 2/11/26 to 6/11/26\"), then press Preview.",
        wrap: true,
        isSubtle: true,
      },
      {
        type: "Input.Text",
        id: "menuText",
        isMultiline: true,
        placeholder: "Menu for the week 2/11/26 to 6/11/26\nMonday\nupma + chutney\nLunch\n...",
      },
    ],
    [{ type: "Action.Submit", title: "Preview", data: { action: "menu_text" } }]
  );
}

function buildMenuCard(menu) {
  return card([
    { type: "TextBlock", text: "🍽️ Menu for the week", weight: "Bolder", size: "Medium", wrap: true },
    { type: "TextBlock", text: weekTitle(menu), isSubtle: true, spacing: "None", wrap: true },
    ...dayBlocks(menu),
  ]);
}

module.exports = { buildMenuPreviewCard, buildMenuCard, buildMenuInputCard };
