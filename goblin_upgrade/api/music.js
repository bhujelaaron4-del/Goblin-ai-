'use strict';
const auth = require('../lib/auth');
const music = require('../lib/music');

// GET ?q=song name -> { id, title, channel } | { preview, art, title, channel } | { link }
module.exports = async (req, res) => {
  if (!auth.requireAuth(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  const q = music.cleanQuery(req.query && req.query.q);
  if (!q) return res.status(400).json({ error: 'Type a song name.' });
  try {
    const gallery = require('../lib/gallery');
    const own = gallery.enabled() && (await require('../lib/vault').allowed(req)) ? await gallery.matchSong(q) : null;
    if (own) return res.status(200).json({ mine: own.id, title: own.name.replace(/\.[A-Za-z0-9]{2,4}$/, ''), channel: 'My song' });
  } catch (e) {}
  const r = req.query.preview ? ((await music.preview(q)) || {}) : await music.find(q);
  if (r.id) return res.status(200).json({ id: r.id, title: r.title, channel: r.channel, alts: r.alts || [] });
  if (r.preview) return res.status(200).json({ preview: r.preview, art: r.art, title: r.title, channel: r.channel });
  if (r.candidates) return res.status(200).json({ candidates: r.candidates });
  return res.status(200).json({ link: r.link || music.searchLink(q) });
};
