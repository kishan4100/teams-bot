// Small settings file: poll/data/settings.json. Currently: where reminders go by default ("group" or "dm").
const fs = require('fs');
const path = require('path');
const DATA_DIR = process.env.POLL_DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'settings.json');
const DELIVERY = ['group', 'dm'];

const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; } };

// Where reminders/alerts go when HR didn't say: "group" (the meal-poll chat) or "dm" (a private 1:1 message to each person).
async function getDelivery() { const d = load().reminderDelivery; return DELIVERY.includes(d) ? d : 'group'; }
async function setDelivery(d) {
  if (!DELIVERY.includes(d)) throw new Error('delivery must be "group" or "dm"');
  const s = load(); s.reminderDelivery = d;
  fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(s, null, 2)); fs.renameSync(FILE + '.tmp', FILE);
  return d;
}
module.exports = { DELIVERY, getDelivery, setDelivery };
