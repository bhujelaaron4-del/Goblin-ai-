'use strict';
const auth = require('../lib/auth');
const tasks = require('../lib/tasks');

// GET -> the list
// POST {action:'add', text, due?} | {action:'done'|'undone'|'delete', id}
module.exports = async (req, res) => {
  if (!auth.requireAuth(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');

  if (!tasks.enabled()) {
    if (req.method === 'GET') return res.status(200).json({ enabled: false, items: [] });
    return res.status(400).json({ error: 'The to-do list needs memory to be set up first (setup Step 4).' });
  }
  try {
    if (req.method === 'GET') return res.status(200).json({ enabled: true, items: await tasks.list() });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

    const b = auth.readBody(req);
    let r;
    if (b.action === 'add') r = await tasks.add(b.text, b.due);
    else if (b.action === 'done' || b.action === 'undone') r = await tasks.setDone(String(b.id || ''), b.action === 'done');
    else if (b.action === 'delete') r = await tasks.remove(String(b.id || ''));
    else return res.status(400).json({ error: 'Unknown action.' });

    if (!r.ok) return res.status(r.reason === 'No task with that id.' ? 404 : 400).json({ error: r.reason });
    return res.status(200).json({ ok: true, item: r.item, items: await tasks.list() });
  } catch (e) {
    return res.status(502).json({ error: 'The to-do list is not answering: ' + e.message });
  }
};
