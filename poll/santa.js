// Secret Santa: events, join/leave, draw. CommonJS, async like poll.js. Data in poll/data/santa.json (POLL_DATA_DIR respected).
// Pairings are sensitive: whoever runs the bot machine can read this file. They are never sent to an AI model.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.POLL_DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'santa.json');
const MIN_PEOPLE = 3; // with 2 people each just gets the other, so it's no secret

const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; } };
const save = (d) => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(d, null, 2)); fs.renameSync(FILE + '.tmp', FILE); };

// Shuffle, then each person gives to the next in the circle: one big cycle, so nobody gets themselves.
function derangement(ids) {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  const out = {};
  a.forEach((giver, i) => { out[giver] = a[(i + 1) % a.length]; });
  return out;
}

async function createEvent({ title, budget = null, createdBy = null } = {}) {
  const t = String(title || '').trim();
  if (!t) throw new Error('Secret Santa needs a title');
  const all = load();
  if (Object.values(all).some((e) => e.status === 'joining')) throw new Error('A Secret Santa is already open for joining. Draw or cancel it first.');
  const id = `santa-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
  all[id] = { id, title: t.slice(0, 100), budget: budget ? String(budget).slice(0, 40) : null, status: 'joining', createdAt: new Date().toISOString(), createdBy, participants: {}, assignments: null };
  save(all);
  return all[id];
}

const getEvent = async (id) => load()[id] || null;
// The event people can join now, else the latest drawn one, else null.
async function getCurrentEvent() {
  const list = Object.values(load()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return list.filter((e) => e.status === 'joining').pop() || list.filter((e) => e.status === 'drawn').pop() || null;
}

async function join(id, userId, name, tenantId = null) {
  const all = load(); const e = all[id];
  if (!e) throw new Error('Unknown Secret Santa');
  if (e.status !== 'joining') throw new Error('The draw is already done.');
  e.participants[userId] = { name: name || 'Unknown', tenantId };
  save(all); return e;
}
async function leave(id, userId) {
  const all = load(); const e = all[id];
  if (!e) throw new Error('Unknown Secret Santa');
  if (e.status !== 'joining') throw new Error('The draw is already done.');
  delete e.participants[userId];
  save(all); return e;
}

// Returns the event; assignments are stored as { giverId: receiverId }. Throws if too few people or already drawn.
async function draw(id) {
  const all = load(); const e = all[id];
  if (!e) throw new Error('Unknown Secret Santa');
  if (e.status !== 'joining') throw new Error('The draw is already done.');
  const ids = Object.keys(e.participants);
  if (ids.length < MIN_PEOPLE) throw new Error(`Need at least ${MIN_PEOPLE} people to draw (${ids.length} joined).`);
  e.assignments = derangement(ids);
  e.status = 'drawn'; e.drawnAt = new Date().toISOString();
  save(all); return e;
}

async function cancel(id) {
  const all = load();
  if (!all[id]) throw new Error('Unknown Secret Santa');
  delete all[id]; save(all);
}

// Who this user gives to: { name, userId } or null (not in the draw / not drawn yet).
async function getAssignmentFor(id, userId) {
  const e = load()[id];
  if (!e || !e.assignments || !e.assignments[userId]) return null;
  const to = e.assignments[userId];
  return { userId: to, name: (e.participants[to] || {}).name || 'Unknown' };
}

module.exports = { MIN_PEOPLE, derangement, createEvent, getEvent, getCurrentEvent, join, leave, draw, cancel, getAssignmentFor };
