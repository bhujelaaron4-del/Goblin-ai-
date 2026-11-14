'use strict';
const auth = require('../lib/auth');
const history = require('../lib/history');
const chats = require('../lib/chats');

// GET                          -> the list of older chats
// GET ?id=...                  -> the messages of one older chat
// POST {action:'new', messages}      -> shelve the chat on screen, start an empty one
// POST {action:'open', id, messages} -> shelve the chat on screen, open an older one
// POST {action:'delete', id}         -> delete an older chat
module.exports = async (req, res) => {
  if (!auth.requireAuth(req, res)) return;

  if (!history.enabled()) {
    if (req.method === 'GET') return res.status(200).json({ enabled: false, chats: [] });
    return res.status(400).json({ error: 'Memory is not set up yet, so old chats cannot be kept.' });
  }

  try {
    if (req.method === 'GET') {
      const one = req.query && req.query.id;
      if (one) {
        const messages = await chats.peek(String(one));
        return messages ? res.status(200).json({ messages }) : res.status(404).json({ error: 'That chat is gone.' });
      }
      return res.status(200).json({ enabled: true, chats: await chats.list() });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

    const body = auth.readBody(req);
    const shown = body.messages === undefined ? [] : body.messages;
    if (!Array.isArray(shown) || !shown.every(history.valid)) {
      return res.status(400).json({ error: 'Those messages are not in the right shape.' });
    }

    if (body.action === 'new') {
      const updated = await chats.startNew(shown, String(body.shelfId || ''));
      return res.status(200).json({ ok: true, updated, chats: await chats.list() });
    }
    if (body.action === 'open') {
      const r = await chats.open(String(body.id || ''), shown, String(body.shelfId || ''));
      if (!r) return res.status(404).json({ error: 'That chat is gone.' });
      return res.status(200).json({ ok: true, messages: r.messages, updated: r.updated, chats: await chats.list() });
    }
    if (body.action === 'delete') {
      const ok = await chats.remove(String(body.id || ''));
      return res.status(ok ? 200 : 404).json(ok ? { ok: true, chats: await chats.list() } : { error: 'That chat is gone.' });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(502).json({ error: 'Chat storage is not answering: ' + e.message });
  }
};
