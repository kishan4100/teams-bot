// Date helpers for the bot's commands. All dates are Asia/Kolkata "YYYY-MM-DD" strings
// (task-split v3.2: no offsets, office time zone), independent of the laptop's time zone.

const TZ = "Asia/Kolkata";
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Current date and time in Asia/Kolkata → { date: "YYYY-MM-DD", time: "HH:mm:ss" }
function nowInOffice(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

// Pure calendar arithmetic on "YYYY-MM-DD" (UTC under the hood, so no DST/zone shifts).
function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function dayOfWeek(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}

// Agreed rule (v3.2): the Monday on or after today. Sat +2, Sun +1, Mon same day, Tue–Fri next Monday.
function weeklyWeekStart(today) {
  return addDays(today, (8 - dayOfWeek(today)) % 7);
}

// Bot-side choice: the Friday on or after today (Friday = today).
function fridayOnOrAfter(today) {
  return addDays(today, (5 - dayOfWeek(today) + 7) % 7);
}

// closesAt from a schedule entry { day: "Monday", time: "10:00" }:
// the last `day` on or before `anchor` (weekly: anchor = weekStart; friday: anchor = the poll date).
// So "close Monday 10:00" → weekStart 10:00, "close Sunday 20:00" → the day before weekStart.
function closesAtFor(anchor, entry) {
  const target = DAY_NAMES.indexOf(entry.day);
  if (target < 0) throw new Error(`Unknown day in schedule: ${entry.day}`);
  const back = (dayOfWeek(anchor) - target + 7) % 7;
  const [h, m] = entry.time.split(":");
  return `${addDays(anchor, -back)}T${h.padStart(2, "0")}:${m}:00`;
}

module.exports = { nowInOffice, addDays, dayOfWeek, weeklyWeekStart, fridayOnOrAfter, closesAtFor };
