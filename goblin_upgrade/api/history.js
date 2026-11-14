'use strict';
const auth = require('../lib/auth');
const history = require('../lib/history');

// GET   -> the saved chat and its version number
// POST  -> replace the saved chat (the page sends the whole chat; an empty list starts a new one)
module.exports = async (req, res) => {
  if (!auth.requireAuth(req, res)) return;

  if (!history.enabled()) {
    if (req.method === 'GET') return res.status(200).json({ enabled: false, messages: [], updated: 0 });
    return res.status(400).json({ error: 'Memory is not set up yet, so the chat cannot be shared between devices.' });
  }

  try {
    if (req.method === 'GET') {
      const saved = await history.load();
      return res.status(200).json({ enabled: true, messages: saved.messages, updated: saved.updated });
    }

    if (req.method === 'POST') {
      const messages = auth.readBody(req).messages;
      if (!Array.isArray(messages) || !messages.every(history.valid)) {
        return res.status(400).json({ error: 'Those messages are not in the right shape.' });
      }
      return res.status(200).json({ ok: true, updated: await history.save(messages) });
    }

    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (e) {
    return res.status(502).json({ error: 'Chat storage is not answering: ' + e.message });
  }
};
