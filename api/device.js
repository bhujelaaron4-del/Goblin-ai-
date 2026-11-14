'use strict';
// Two kinds of caller:
//  1. The PC helper, which proves itself with its own key (Authorization: Bearer ...).
//  2. The logged-in Ghost page (cookie): status, download helper, confirm, emergency stop.
const auth = require('../lib/auth');
const device = require('../lib/device');

// "Hey Ghost" from the PC helper or the Android app: the device has already turned speech into words
// on the device itself. Only those words arrive here. Same brain, same safety rules as typing in Ghost.
async function voice(b, role) {
  if (await device.locked()) return { reply: 'Remote control is stopped. Turn it back on in Ghost, under My PC.', events: [] };
  const text = String(b.text || '').trim().slice(0, 300);
  if (!text) return { reply: '', events: [] };
  const past = (Array.isArray(b.history) ? b.history : []).slice(-6).map((m) => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', content: String((m && m.content) || '').slice(0, 300) }));
  const tz = /^[A-Za-z0-9_\/+-]{1,40}$/.test(String(b.tz || '')) ? String(b.tz) : 'UTC';
  const who = role === 'phone' ? 'phone' : 'PC';
  await device.log({ label: 'Voice (' + who + '): "' + text.replace(/"/g, "'") + '"', risk: 'low', status: 'heard' });
  const chat = require('./chat');
  // music, mood and gallery make no sense from a speaker; the PC cannot show phone buttons
  const dropTools = role === 'phone' ? ['play_song', 'set_mood'] : ['play_song', 'set_mood', 'open_on_phone'];
  const r = await chat.think({ messages: past.concat([{ role: 'user', content: text }]), tz, voice: true }, { galleryAllowed: async () => false, dropTools, phoneVoice: role === 'phone' });
  const keep = role === 'phone' ? ['confirm', 'pc', 'open'] : ['confirm', 'pc'];
  return { reply: r.reply, events: (r.events || []).filter((e) => keep.includes(e.type)) };
}

async function helper(req, res, token) {
  res.setHeader('Cache-Control', 'no-store');
  if (!device.enabled()) return res.status(503).json({ error: 'Memory database is not set up.' });
  const role = await device.whoIs(token);
  if (!role) return res.status(401).json({ error: 'This device is not allowed. Pair it again from Ghost.' });
  if (role === 'phone') {
    // the phone app may talk to Ghost, confirm or decline, and press stop. It can never pick up PC commands.
    await device.markPhone();
    if (req.method === 'GET') return res.status(200).json({ ok: true, locked: await device.locked() });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
    const pb = auth.readBody(req);
    try {
      if (pb.action === 'voice') return res.status(200).json(await voice(pb, 'phone'));
      if (pb.action === 'confirm') return res.status(200).json(await device.confirm(pb.pid));
      if (pb.action === 'decline') return res.status(200).json(await device.decline(pb.pid));
      if (pb.action === 'stop') { await device.stopAll(); return res.status(200).json({ ok: true, locked: true }); }
      if (pb.action === 'ping') return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(e.status || 502).json({ error: e.message });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  }
  if (req.method === 'GET') return res.status(200).json(await device.poll());
  if (req.method === 'POST') {
    const b = auth.readBody(req);
    try {
      if (b.action === 'voice') return res.status(200).json(await voice(b, 'pc'));
    } catch (e) {
      return res.status(e.status || 502).json({ error: e.message });
    }
    // a real click on the PC's own Yes/No box counts as the user's confirmation; stopping is always allowed
    if (b.action === 'confirm') return res.status(200).json(await device.confirm(b.pid));
    if (b.action === 'decline') return res.status(200).json(await device.decline(b.pid));
    if (b.action === 'stop') { await device.stopAll(); return res.status(200).json({ ok: true, locked: true }); }
    const ok = await device.report(b.id, b.ok, b.message);
    return res.status(ok ? 200 : 400).json({ ok });
  }
  return res.status(405).json({ error: 'Method not allowed.' });
}

module.exports = async (req, res) => {
  const bearer = /^Bearer ([A-Za-z0-9]{20,100})$/.exec(String((req.headers && req.headers.authorization) || ''));
  try {
    if (bearer) return await helper(req, res, bearer[1]);
    if (!auth.requireAuth(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    if (!device.enabled()) return res.status(200).json({ enabled: false });

    if (req.method === 'GET' && req.query.status) {
      const [online, locked, history, key, pkey, pseen] = await Promise.all([device.online(), device.locked(), device.history(), device.getKey(false), device.getPhoneKey(false), device.phoneSeen()]);
      return res.status(200).json({ enabled: true, paired: !!key, online, locked, history: history.slice(0, 25), phonePaired: !!pkey, phoneOnline: pseen });
    }
    if (req.method === 'GET' && req.query.pair === 'phone') {
      const key = await device.getPhoneKey(true);
      const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
      const url = proto + '://' + String(req.headers.host || '').replace(/[^A-Za-z0-9.:-]/g, '');
      return res.status(200).json({ code: 'GHOST|' + url + '|' + key });
    }
    if (req.method === 'GET' && req.query.setup) {
      const key = await device.getKey(true);
      const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
      const url = proto + '://' + String(req.headers.host || '').replace(/[^A-Za-z0-9.:-]/g, '');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="start-ghost-pc.bat"');
      const tz = /^[A-Za-z0-9_\/+-]{1,40}$/.test(String(req.query.tz || '')) ? String(req.query.tz) : 'UTC';
      return res.status(200).send(device.helperFile(url, key, tz));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
    const b = auth.readBody(req);
    if (b.action === 'confirm') return res.status(200).json(await device.confirm(b.pid));
    if (b.action === 'decline') return res.status(200).json(await device.decline(b.pid));
    if (b.action === 'stop') { await device.stopAll(); return res.status(200).json({ ok: true, locked: true }); }
    if (b.action === 'resume') { await device.resume(); return res.status(200).json({ ok: true, locked: false }); }
    if (b.action === 'warm') {
      // the page tells the helper someone is about to give a command, so it checks every second for a while
      if (await device.getKey(false)) await device.warm();
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'disconnect_phone') {
      await device.resetPhoneKey();
      await device.log({ label: 'Phone disconnected. The old app pairing no longer works.', risk: 'high', status: 'disconnected' });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'disconnect') {
      await device.resetKey();
      await device.log({ label: 'PC disconnected. The old helper can no longer connect.', risk: 'high', status: 'disconnected' });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(502).json({ error: 'Ghost could not reach its database: ' + e.message });
  }
};
