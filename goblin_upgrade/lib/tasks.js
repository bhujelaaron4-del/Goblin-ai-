'use strict';
const crypto = require('crypto');
const store = require('./store');

// A simple to-do and homework list, kept in your own Redis database.
const KEY = 'ghost:tasks';
const MAX_TASKS = 100;
const MAX_TEXT = 200;

function enabled() {
  return store.enabled();
}

async function list() {
  const raw = await store.get(KEY);
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  } catch (e) {
    return [];
  }
}

const persist = (items) => store.set(KEY, JSON.stringify(items));

function cleanDue(due) {
  const d = String(due || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : '';
}

async function add(text, due) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return { ok: false, reason: 'Nothing to add.' };
  if (clean.length > MAX_TEXT) return { ok: false, reason: 'Too long. Keep each task under ' + MAX_TEXT + ' characters.' };
  const items = await list();
  const same = items.find((t) => !t.done && t.text.toLowerCase() === clean.toLowerCase());
  if (same) return { ok: true, item: same, duplicate: true };
  if (items.filter((t) => !t.done).length >= MAX_TASKS) return { ok: false, reason: 'The list is full. Finish or delete something first.' };
  const item = { id: crypto.randomBytes(3).toString('hex'), text: clean, due: cleanDue(due), done: false, created: new Date().toISOString() };
  items.push(item);
  await persist(items);
  return { ok: true, item };
}

async function setDone(id, done) {
  const items = await list();
  const t = items.find((x) => x.id === id);
  if (!t) return { ok: false, reason: 'No task with that id.' };
  t.done = !!done;
  // finished tasks are kept for a while, but only the newest 30
  const open = items.filter((x) => !x.done);
  const finished = items.filter((x) => x.done).slice(-30);
  await persist(open.concat(finished));
  return { ok: true, item: t };
}

async function remove(id) {
  const items = await list();
  const t = items.find((x) => x.id === id);
  if (!t) return { ok: false, reason: 'No task with that id.' };
  await persist(items.filter((x) => x.id !== id));
  return { ok: true, item: t };
}

// For the assistant's instructions: the open tasks, soonest first.
function promptBlock(items) {
  const open = items.filter((t) => !t.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  if (!open.length) return 'The user has no open tasks on their to-do list.';
  return 'The user\'s open to-do list (id in brackets):\n' + open.map((t) => '- [' + t.id + '] ' + t.text + (t.due ? ' (due ' + t.due + ')' : '')).join('\n');
}

module.exports = { enabled, list, add, setDone, remove, promptBlock, MAX_TASKS };
