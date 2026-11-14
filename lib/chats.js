'use strict';
const store = require('./store');
const history = require('./history');

// Your older chats, kept in your own Redis database.
// A small list (title, time) plus one entry per chat. The newest MAX_CHATS are kept.
const INDEX = 'ghost:chats';
const MAX_CHATS = 30;
const ID_RE = /^[a-z0-9]{6,24}$/;

function titleOf(messages) {
  const first = messages.find((m) => m.role === 'user' && m.content.trim());
  const t = (first ? first.content : 'Chat').replace(/\s+/g, ' ').trim();
  return t.length > 48 ? t.slice(0, 47) + '…' : t;
}

async function list() {
  const raw = await store.get(INDEX);
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.filter((c) => c && ID_RE.test(c.id)) : [];
  } catch (e) {
    return [];
  }
}

async function writeIndex(items) {
  await store.set(INDEX, JSON.stringify(items));
}

// Puts a conversation on the shelf. Nothing happens for an empty one.
async function archive(messages, wantedId) {
  const clean = history.clean(messages || []);
  if (!clean.length) return null;
  // the page may pick the id itself, so it can show the chat in its list right away
  const id = ID_RE.test(wantedId || '') ? wantedId : Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const [, items] = await Promise.all([store.set('ghost:c:' + id, JSON.stringify(clean)), list()]);
  items.unshift({ id, title: titleOf(clean), updated: Date.now(), count: clean.length });
  const dropped = items.splice(MAX_CHATS);
  await writeIndex(items);
  await Promise.all(dropped.map((d) => store.del('ghost:c:' + d.id).catch(() => {})));
  return id;
}

// Starts a new chat: the chat on screen goes on the shelf, and the current chat is emptied.
async function startNew(messages, shelfId) {
  const [, updated] = await Promise.all([archive(messages, shelfId), history.save([])]);
  return updated;
}

// One older chat, without switching to it (the page keeps a copy so opening is instant).
async function peek(id) {
  if (!ID_RE.test(id)) return null;
  const raw = await store.get('ghost:c:' + id);
  if (!raw) return null;
  try { return history.clean(JSON.parse(raw)); } catch (e) { return null; }
}

// Opens an older chat: the chat on screen goes on the shelf, the old one becomes the current chat.
async function open(id, messages, shelfId) {
  const opened = await peek(id);
  if (!opened) return null;
  await remove(id);
  const [, updated] = await Promise.all([archive(messages, shelfId), history.save(opened)]);
  return { messages: opened, updated };
}

async function remove(id) {
  if (!ID_RE.test(id)) return false;
  const items = await list();
  const left = items.filter((c) => c.id !== id);
  if (left.length !== items.length) await writeIndex(left);
  await store.del('ghost:c:' + id);
  return left.length !== items.length;
}

module.exports = { list, archive, startNew, peek, open, remove, MAX_CHATS };
