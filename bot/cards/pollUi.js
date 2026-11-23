// Shared look for poll cards and result cards (Adaptive Cards 1.5, no custom CSS in Teams, so the "fun" comes from
// emoji, container colours and weighted columns used as progress bars).
//   metaOf(poll)            → { icon, title } banner for the poll type
//   optionIcon(poll, opt, i)→ emoji for an option (meal options have their own, custom polls get 1️⃣ 2️⃣ …)
//   optionRows(poll, counts, total, { names, winnerIcon }) → card elements: one tile per option with a % bar

const NUMBERS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
const MEAL_ICONS = { bf_lunch: "🍳🍛", lunch_only: "🍛", none: "🚫", veg: "🥗", nonveg: "🍗" };

function metaOf(poll) {
  if (poll.type === "weekly_attendance") return { icon: "🍽️", title: "WEEKLY MEAL PLAN" };
  if (poll.type === "friday_diet") return { icon: "🍗", title: "FRIDAY LUNCH" };
  return { icon: "🗳️", title: "QUICK POLL" };
}

const optionIcon = (poll, opt, i) => MEAL_ICONS[opt.id] || NUMBERS[i] || "▫️";

// Pill-like info chip. colour: Default | Accent | Good | Attention | Warning
function chip(text, color = "Default") {
  return { type: "Column", width: "auto", items: [{ type: "TextBlock", text, size: "Small", color, wrap: false, weight: "Bolder" }] };
}

// ---------- Bar styles (pick one with POLL_CARD_STYLE in bot/.env; read on every call) ----------
//   blocks : 🟩🟩🟩⬜⬜  emoji squares, vivid on any theme (default)
//   text   : ▰▰▰▱▱     coloured text bar
//   tiles  : no bar, bold % with a tile per option
//   bars   : the first version (container-colour slabs)
const STYLES = ["blocks", "text", "tiles", "bars"];
const currentStyle = () => (STYLES.includes(process.env.POLL_CARD_STYLE) ? process.env.POLL_CARD_STYLE : "blocks");

// Banner at the top of a card. Every style except "bars" uses the neutral grey banner with a coloured label.
function banner(style, { icon, label, title, tone }) {
  const slab = style === "bars";
  const container = { type: "Container", bleed: true, style: slab ? ({ open: "accent", closed: "emphasis", results: "good" }[tone]) : "emphasis" };
  container.items = [{
    type: "ColumnSet",
    columns: [
      { type: "Column", width: "auto", verticalContentAlignment: "Center", items: [{ type: "TextBlock", text: icon, size: "ExtraLarge" }] },
      {
        type: "Column", width: "stretch", verticalContentAlignment: "Center",
        items: [
          { type: "TextBlock", text: label, size: "Small", weight: "Bolder", spacing: "None", ...(slab ? { isSubtle: true } : { color: { open: "Accent", closed: "Attention", results: "Good" }[tone] }) },
          { type: "TextBlock", text: title, weight: "Bolder", size: "Large", wrap: true, spacing: "None" },
        ],
      },
    ],
  }];
  return container;
}

// The bar under an option (or null when the style has none).
function barElement(style, count, total, leading) {
  const pct = total ? count / total : 0;
  if (style === "blocks") {
    const f = Math.round(pct * 10);
    return { type: "TextBlock", text: (leading ? "🟩" : "🟦").repeat(f) + "⬜".repeat(10 - f), size: "Medium", spacing: "None" };
  }
  if (style === "text") {
    const f = Math.round(pct * 12);
    return { type: "TextBlock", text: "▰".repeat(f) + "▱".repeat(12 - f), size: "Large", fontType: "Monospace", color: leading ? "Good" : "Accent", spacing: "None" };
  }
  if (style === "bars") return barRow(count, total, leading);
  return null; // tiles
}

// Progress bar made of two weighted columns (first version, "bars" style).
function barRow(count, total, leading) {
  const pct = total ? count / total : 0;
  const filled = Math.round(pct * 20); // 20 steps is plenty of resolution
  const cell = (style) => ({ type: "Column", style, items: [{ type: "TextBlock", text: " ", size: "Small" }] });
  const columns = [];
  if (filled > 0) columns.push({ ...cell(leading ? "good" : "accent"), width: String(filled) });
  if (filled < 20) columns.push({ ...cell("emphasis"), width: String(20 - filled) });
  return { type: "ColumnSet", columns, spacing: "Small" };
}

/**
 * One tile per option: icon + label, "count · pct%", bar, optional names.
 * names: { optionId: ["Ravi", ...] } (results card only; omit for the live poll card).
 */
function optionRows(poll, counts, total, { names = null, winnerIcon = "🔥", style = currentStyle() } = {}) {
  const max = Math.max(0, ...Object.values(counts));
  return (poll.options || []).map((opt, i) => {
    const c = counts[opt.id] || 0;
    const leading = max > 0 && c === max;
    const pct = total ? Math.round((c / total) * 100) : 0;
    const items = [
      {
        type: "ColumnSet",
        columns: [
          { type: "Column", width: "auto", verticalContentAlignment: "Center", items: [{ type: "TextBlock", text: optionIcon(poll, opt, i), size: "Large" }] },
          { type: "Column", width: "stretch", verticalContentAlignment: "Center", items: [{ type: "TextBlock", text: `${opt.label}${leading ? ` ${winnerIcon}` : ""}`, weight: "Bolder", wrap: true }] },
          { type: "Column", width: "auto", verticalContentAlignment: "Center", items: [{ type: "TextBlock", text: `${c} · ${pct}%`, weight: "Bolder", color: leading ? "Good" : "Default" }] },
        ],
      },
    ];
    const barEl = barElement(style, c, total, leading);
    if (barEl) items.push(barEl);
    if (names) {
      const list = names[opt.id] || [];
      if (list.length) items.push({ type: "TextBlock", text: `👤 ${list.join(", ")}`, isSubtle: true, size: "Small", wrap: true, spacing: "Small" });
    }
    return style === "tiles"
      ? { type: "Container", style: "emphasis", spacing: "Small", items }
      : { type: "Container", spacing: "Medium", items };
  });
}

module.exports = { metaOf, optionIcon, chip, optionRows, banner, currentStyle, STYLES };
