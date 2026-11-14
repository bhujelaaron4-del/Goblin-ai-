'use strict';
const store = require('./store');

// The conversation, kept in your own Redis database so every device shows the same chat.
// Only text is kept. Files are never stored, just their names.
const KEY = 'ghost:chat';
const MAX_MESSAGES = 200;
const MAX_TEXT = 8000;
const music = require('./music');
const EVENT_TYPES = ['saved', 'forgot', 'app', 'task', 'done', 'play', 'mood', 'pc', 'open', 'confirm'];
const phone = require('./phone');

function enabled() {
  return store.enabled();
}

function valid(m) {
  return Boolean(m) && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';
}

function clean(list) {
  return list
    .filter(valid)
    .slice(-MAX_MESSAGES)
    .map((m) => {
      const out = { role: m.role, content: m.content.slice(0, MAX_TEXT) };
      if (Array.isArray(m.names) && m.names.length) out.names = m.names.slice(0, 4).map((n) => String(n).slice(0, 80));
      if (Array.isArray(m.events)) {
        const events = m.events
          .filter((e) => e && EVENT_TYPES.includes(e.type) && typeof e.text === 'string')
          .slice(0, 6)
          .map((e) => {
            const o = { type: e.type, text: e.text.slice(0, 200) };
            if (e.type === 'open') {
              if (typeof e.url === 'string' && phone.OPEN_URL_RE.test(e.url)) o.url = e.url;
              else return null;
            }
            if (e.type === 'confirm' && ['medium', 'high'].includes(e.risk)) o.risk = e.risk;
            if (e.type === 'play') {
              if (typeof e.id === 'string' && /^[\w-]{11}$/.test(e.id)) o.id = e.id;
              if (Number.isInteger(e.start) && e.start > 0 && e.start < 86400) o.start = e.start;
              if (typeof e.mine === 'string' && /^[a-z0-9]{8,24}$/.test(e.mine)) o.mine = e.mine;
              if (typeof e.preview === 'string' && music.PREVIEW_RE.test(e.preview)) o.preview = e.preview.slice(0, 400);
              if (typeof e.art === 'string' && music.ART_RE.test(e.art)) o.art = e.art.slice(0, 400);
              if (typeof e.channel === 'string') o.channel = e.channel.slice(0, 80);
              if (Array.isArray(e.alts)) {
                o.alts = e.alts
                  .filter((a) => a && typeof a.id === 'string' && /^[\w-]{11}$/.test(a.id))
                  .slice(0, 4)
                  .map((a) => ({ id: a.id, title: String(a.title || '').slice(0, 150), channel: String(a.channel || '').slice(0, 80) }));
              }
              if (typeof e.url === 'string' && /^https:\/\/www\.youtube\.com\//.test(e.url)) o.url = e.url.slice(0, 300);
            }
            return o;
          })
          .filter(Boolean);
        if (events.length) out.events = events;
      }
      return out;
    });
}

async function load() {
  const raw = await store.get(KEY);
  if (!raw) return { messages: [], updated: 0 };
  try {
    const o = JSON.parse(raw);
    return { messages: Array.isArray(o.messages) ? o.messages : [], updated: Number(o.updated) || 0 };
  } catch (e) {
    return { messages: [], updated: 0 };
  }
}

// Replaces the saved chat. Returns its new version number, which always goes up.
async function save(messages) {
  const prev = await load();
  const updated = Math.max(Date.now(), prev.updated + 1);
  await store.set(KEY, JSON.stringify({ updated, messages: clean(messages) }));
  return updated;
}

module.exports = { enabled, valid, clean, load, save, MAX_MESSAGES };
