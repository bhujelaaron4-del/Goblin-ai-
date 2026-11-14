'use strict';
const auth = require('../lib/auth');

const DEFAULT_VOICE = 'ib8aaABAPZQpTo6hx8Jr'; // "Severin"
const MAX_CHARS = 1200; // keeps the free ElevenLabs amount going further

function fail(res, status, message) {
  return res.status(status).json({ error: message, fallback: true });
}

module.exports = async (req, res) => {
  if (!auth.requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return fail(res, 501, 'The Severin voice is not set up, so your device voice is used.');

  const text = String(auth.readBody(req).text || '').trim().slice(0, MAX_CHARS);
  if (!text) return res.status(400).json({ error: 'Nothing to read.' });

  const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voice), {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
      signal: ctl.signal,
    });
    if (!r.ok) {
      if (r.status === 401) return fail(res, 502, 'ElevenLabs refused the key or the free amount is used up, so your device voice is used.');
      if (r.status === 402 || r.status === 403) return fail(res, 502, 'This voice needs a paid ElevenLabs plan, so your device voice is used.');
      if (r.status === 429) return fail(res, 502, 'ElevenLabs is busy, so your device voice is used.');
      return fail(res, 502, 'ElevenLabs returned an error (' + r.status + '), so your device voice is used.');
    }
    const audio = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(audio);
  } catch (e) {
    return fail(res, 502, e.name === 'AbortError' ? 'ElevenLabs took too long, so your device voice is used.' : 'Could not reach ElevenLabs, so your device voice is used.');
  } finally {
    clearTimeout(timer);
  }
};
