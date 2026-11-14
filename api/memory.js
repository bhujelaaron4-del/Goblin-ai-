'use strict';
const auth = require('../lib/auth');
const memory = require('../lib/memory');

// GET            -> list everything remembered
// POST {text}    -> remember something by hand
// DELETE ?id=xx  -> forget one thing
// DELETE ?all=1  -> forget everything
module.exports = async (req, res) => {
  if (!auth.requireAuth(req, res)) return;

  if (!memory.enabled()) {
    if (req.method === 'GET') return res.status(200).json({ enabled: false, items: [], max: memory.MAX_ITEMS });
    return res.status(400).json({ error: 'Memory is not set up yet. Add the Redis database from the setup steps.' });
  }

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ enabled: true, items: await memory.list(), max: memory.MAX_ITEMS });
    }

    if (req.method === 'POST') {
      const r = await memory.add(auth.readBody(req).text);
      if (!r.ok) return res.status(400).json({ error: r.reason });
      return res.status(200).json({ ok: true, item: r.item });
    }

    if (req.method === 'DELETE') {
      const q = req.query || {};
      if (q.all === '1') {
        await memory.clear();
        return res.status(200).json({ ok: true });
      }
      const r = await memory.remove(String(q.id || ''));
      if (!r.ok) return res.status(404).json({ error: r.reason });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (e) {
    return res.status(502).json({ error: 'Memory storage is not answering: ' + e.message });
  }
};
