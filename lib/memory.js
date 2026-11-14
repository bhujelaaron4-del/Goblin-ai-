'use strict';
const crypto = require('crypto');
const store = require('./store');

const KEY = 'ghost:memories';
const MAX_ITEMS = 300;
const MAX_LENGTH = 400;

function enabled() {
  return store.enabled();
}

async function list() {
  const raw = await store.get(KEY);
  if (!raw) return [];
  try {
    const items = JSON.parse(raw);
    return Array.isArray(items) ? items : [];
  } catch (e) {
    return [];
  }
}

function persist(items) {
  return store.set(KEY, JSON.stringify(items));
}

function normalize(text) {
  return String(text).toLowerCase().replace(/\s+/g, ' ').replace(/[.!\s]+$/, '').trim();
}

// Things that should never be kept, even if the user or the model tries.
function looksSecret(text) {
  return (
    /\b(?:\d[ -]?){13,19}\b/.test(text) ||
    /AIza[0-9A-Za-z_-]{20,}/.test(text) ||
    /\bsk-[A-Za-z0-9_-]{16,}/.test(text) ||
    /\b(password|passcode|pin|otp|cvv|api key|secret key)\b\s*(is|=|:)/i.test(text)
  );
}

async function add(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return { ok: false, reason: 'Nothing to save.' };
  if (clean.length > MAX_LENGTH) return { ok: false, reason: 'Too long. Keep each memory under ' + MAX_LENGTH + ' characters.' };
  if (looksSecret(clean)) return { ok: false, reason: 'That looks like a password, key or card number. Those are never saved.' };
  const items = await list();
  const key = normalize(clean);
  const same = items.find((m) => normalize(m.text) === key);
  if (same) return { ok: true, item: same, duplicate: true };
  if (items.length >= MAX_ITEMS) return { ok: false, reason: 'Memory is full (' + MAX_ITEMS + ' items). Forget something first.' };
  const item = { id: crypto.randomBytes(3).toString('hex'), text: clean, created: new Date().toISOString() };
  items.push(item);
  await persist(items);
  return { ok: true, item };
}

async function remove(id) {
  const items = await list();
  const found = items.find((m) => m.id === id);
  if (!found) return { ok: false, reason: 'No memory with that id.' };
  await persist(items.filter((m) => m.id !== id));
  return { ok: true, item: found };
}

async function clear() {
  await persist([]);
}

// The block that goes into the assistant's instructions.
function promptBlock(items) {
  if (!items.length) return 'Saved memories: none yet.';
  return 'Saved memories (id, then fact):\n' + items.map((m) => '- [' + m.id + '] ' + m.text).join('\n');
}

module.exports = { enabled, list, add, remove, clear, promptBlock, MAX_ITEMS, MAX_LENGTH };
