// Recurring announcements: HR sets "post <text> in the group at <time> on <days>". CommonJS, async like poll.js.
// Data: poll/data/announcements.json. The scheduler calls due() every 30 s and posts what's due.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.POLL_DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'announcements.json');
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FULL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const CATCH_UP_MINUTES = 15; // bot was down at the exact time: still post if it's at most this late, else skip today

const loadAllSync = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } };
const save = (list) => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(list, null, 2)); fs.renameSync(FILE + '.tmp', FILE); };

// ["mon","Tuesday","weekdays","daily"] → ["mon","tue",...] in week order. Throws a readable error on anything else.
function normalizeDays(input) {
  const out = new Set();
  for (const raw of [].concat(input || [])) {
    const d = String(raw).trim().toLowerCase();
    if (d === 'weekdays' || d === 'weekday') ['mon', 'tue', 'wed', 'thu', 'fri'].forEach((x) => out.add(x));
    else if (d === 'daily' || d === 'everyday' || d === 'every day') DAYS.forEach((x) => out.add(x));
    else if (DAYS.includes(d.slice(0, 3)) && (d.length === 3 || FULL.includes(d))) out.add(d.slice(0, 3));
    else throw new Error(`"${raw}" isn't a day of the week.`);
  }
  if (out.size === 0) throw new Error('Which days should it be posted on?');
  return DAYS.filter((d) => out.has(d)).sort((a, b) => ((DAYS.indexOf(a) + 6) % 7) - ((DAYS.indexOf(b) + 6) % 7)); // Mon..Sun
}

async function add({ text, time, days, createdBy = null } = {}) {
  const t = String(text || '').trim();
  if (!t) throw new Error('The announcement needs some text.');
  if (t.length > 1000) throw new Error('The announcement is too long (max 1000 characters).');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) throw new Error('Time must be HH:mm (24-hour).');
  const item = { id: crypto.randomBytes(3).toString('hex'), text: t, time, days: normalizeDays(days), createdAt: new Date().toISOString(), createdBy, lastSent: null };
  const list = loadAllSync(); list.push(item); save(list);
  return item;
}

const list = async () => loadAllSync();
async function remove(id) {
  const all = loadAllSync(); const i = all.findIndex((a) => a.id === id);
  if (i < 0) throw new Error('That announcement no longer exists.');
  const [gone] = all.splice(i, 1); save(all); return gone;
}

// nowLocal = "YYYY-MM-DDTHH:mm:ss" (office time), dow = 0..6 (Sunday = 0). Marks what it returns as sent for today.
async function due(nowLocal, dow) {
  const date = nowLocal.slice(0, 10), hhmm = nowLocal.slice(11, 16);
  const mins = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const all = loadAllSync(); const out = [];
  for (const a of all) {
    if (!a.days.includes(DAYS[dow]) || a.lastSent === date) continue;
    const late = mins(hhmm) - mins(a.time);
    if (late < 0 || late > CATCH_UP_MINUTES) continue;
    a.lastSent = date; out.push(a);
  }
  if (out.length) save(all); // marked before posting, so a slow/failed post never repeats
  return out;
}

module.exports = { DAYS, normalizeDays, add, list, loadAllSync, remove, due, CATCH_UP_MINUTES };
