'use strict';
const auth = require('../lib/auth');

// Loaded here (not at the top) so a missing file gives a clear message instead of a crash.
function parts() {
  try {
    return { gallery: require('../lib/gallery'), vault: require('../lib/vault') };
  } catch (e) {
    return { error: 'Part of Ghost is missing on the server (' + String(e.message).split('\n')[0].slice(0, 120) + '). Upload the lib folder to GitHub again and wait for the green check.' };
  }
}

const WINDOW = 4 * 1024 * 1024; // one answer must stay under Vercel's 4.5 MB limit

// GET                    -> the list
// GET ?id=ID&thumb=1     -> small picture
// GET ?id=ID             -> the file (supports Range, so videos can play and skip around)
// POST {action:'begin'|'chunk'|'thumb'|'finish'|'abort'|'delete', ...}
module.exports = async (req, res) => {
  if (!auth.requireAuth(req, res)) return;
  const loaded = parts();
  if (loaded.error) return res.status(500).json({ error: loaded.error });
  const gallery = loaded.gallery;
  const vault = loaded.vault;

  if (!gallery.enabled()) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && !req.query.id) return res.status(200).json({ enabled: false, items: [], total: 0, limit: gallery.MAX_TOTAL });
    return res.status(400).json({ error: 'The gallery needs memory to be set up first (setup Step 4).' });
  }

  try {
    // the gallery password: status, unlock, lock and changing it are handled first
    const b0 = req.method === 'POST' ? auth.readBody(req) : {};
    if (req.method === 'GET' && req.query.status) {
      res.setHeader('Cache-Control', 'no-store');
      const has = await vault.isSet();
      return res.status(200).json({ enabled: true, hasPassword: has, locked: has && !vault.opened(req) });
    }
    if (req.method === 'POST' && ['unlock', 'lock', 'setpass', 'clearpass'].includes(b0.action)) {
      res.setHeader('Cache-Control', 'no-store');
      return await passwordAction(req, res, b0, vault);
    }
    if (!(await vault.allowed(req))) return res.status(423).json({ error: 'The gallery is locked.', locked: true });

    if (req.method === 'GET') {
      const id = String(req.query.id || '');
      if (!id && !req.query.thumbs) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(Object.assign({ enabled: true }, await gallery.list()));
      }
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.query.thumbs) {
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.status(200).json({ thumbs: await gallery.thumbs(String(req.query.thumbs).split(',')) });
      }
      if (req.query.thumb) {
        const t = await gallery.thumb(id);
        if (!t) return res.status(404).end();
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        return res.status(200).send(t);
      }
      const item = await gallery.find(id);
      if (!item) return res.status(404).end();
      let start = 0;
      let end = item.size - 1;
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
      if (range && (range[1] || range[2])) {
        if (range[1]) {
          start = Number(range[1]);
          if (range[2]) end = Math.min(Number(range[2]), item.size - 1);
        } else {
          start = Math.max(item.size - Number(range[2]), 0); // last N bytes
        }
        if (start > end || start >= item.size) {
          res.setHeader('Content-Range', 'bytes */' + item.size);
          return res.status(416).end();
        }
      }
      const partial = !!range || item.size > WINDOW;
      if (end - start + 1 > WINDOW) end = start + WINDOW - 1;
      const body = await gallery.bytes(item, start, end);
      res.setHeader('Content-Type', item.mime);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('Content-Length', String(body.length));
      if (partial) {
        res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + item.size);
        return res.status(206).send(body);
      }
      return res.status(200).send(body);
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
    res.setHeader('Cache-Control', 'no-store');
    const b = b0;
    let r;
    if (b.action === 'begin') r = await gallery.begin(b);
    else if (b.action === 'chunk') r = await gallery.putChunk(b.id, b.n, b.data);
    else if (b.action === 'thumb') r = await gallery.putThumb(b.id, b.data);
    else if (b.action === 'finish') r = await gallery.finish(b);
    else if (b.action === 'abort') r = await gallery.abort(b.id, b.chunks);
    else if (b.action === 'delete') r = await gallery.remove(b.id);
    else return res.status(400).json({ error: 'Unknown action.' });
    if (!r.ok) return res.status(r.reason === 'Not found.' ? 404 : 400).json({ error: r.reason });
    return res.status(200).json(r);
  } catch (e) {
    return res.status(502).json({ error: 'The gallery is not answering: ' + e.message });
  }
};

async function passwordAction(req, res, b, vault) {
  const text = (v) => String(v === undefined || v === null ? '' : v).slice(0, 200);
  if (b.action === 'lock') {
    vault.revoke(res);
    return res.status(200).json({ ok: true });
  }
  if (b.action === 'unlock') {
    if (!(await vault.isSet())) return res.status(200).json({ ok: true });
    if (await vault.tooMany()) return res.status(429).json({ error: 'Too many wrong tries. Wait 15 minutes and try again.' });
    if (!(await vault.check(text(b.password)))) {
      await vault.failed();
      return res.status(401).json({ error: 'Wrong gallery password.', wrong: true });
    }
    await vault.forgive();
    vault.grant(res);
    return res.status(200).json({ ok: true });
  }
  const has = await vault.isSet();
  if (has && !vault.opened(req)) return res.status(423).json({ error: 'Unlock the gallery first.', locked: true });
  if (has) {
    if (await vault.tooMany()) return res.status(429).json({ error: 'Too many wrong tries. Wait 15 minutes and try again.' });
    if (!(await vault.check(text(b.current)))) {
      await vault.failed();
      return res.status(401).json({ error: 'The current gallery password is wrong.', wrong: true });
    }
    await vault.forgive();
  }
  if (b.action === 'clearpass') {
    await vault.clear();
    vault.revoke(res);
    return res.status(200).json({ ok: true, hasPassword: false });
  }
  const pw = text(b.password);
  if (pw.length < vault.MIN_LENGTH) return res.status(400).json({ error: 'Use at least ' + vault.MIN_LENGTH + ' characters.' });
  await vault.set(pw);
  vault.grant(res);
  return res.status(200).json({ ok: true, hasPassword: true });
}
