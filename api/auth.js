'use strict';
const crypto = require('crypto');
const auth = require('../lib/auth');
const store = require('../lib/store');
const quiz = require('../lib/quiz');

const MAX_TRIES = 8; // wrong passwords allowed per window
const WINDOW_SECONDS = 15 * 60;
const local = new Map(); // used only when no Redis database is set up

function who(req) {
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim();
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

async function failures(id) {
  const key = 'ghost:fail:' + id;
  if (store.enabled()) {
    try {
      return Number((await store.get(key)) || 0);
    } catch (e) {
      /* fall through to the local counter */
    }
  }
  const row = local.get(key);
  return row && row.until > Date.now() ? row.n : 0;
}

async function addFailure(id) {
  const key = 'ghost:fail:' + id;
  if (store.enabled()) {
    try {
      await store.bump(key, WINDOW_SECONDS);
      return;
    } catch (e) {
      /* fall through */
    }
  }
  const row = local.get(key);
  if (row && row.until > Date.now()) row.n += 1;
  else local.set(key, { n: 1, until: Date.now() + WINDOW_SECONDS * 1000 });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const configured = auth.config().ok;

  if (req.method === 'GET') {
    return res.status(200).json({ configured, authenticated: auth.isLoggedIn(req) });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  const body = auth.readBody(req);

  if (body.logout) {
    auth.endSession(res);
    return res.status(200).json({ ok: true });
  }

  if (!configured) {
    return res.status(503).json({ error: 'Not set up yet. Add APP_PASSWORD (8+ characters) and SESSION_SECRET (32+ characters) in Vercel, then redeploy.' });
  }

  const id = who(req);
  if ((await failures(id)) >= MAX_TRIES) {
    return res.status(429).json({ error: 'Too many wrong tries. Wait 15 minutes and try again.' });
  }

  // The quiz (if you switched it on) and the password are checked together,
  // so a wrong guess never says which part was wrong.
  let prints = null;
  if (store.enabled()) {
    try {
      prints = await quiz.saved();
    } catch (e) {
      return res.status(503).json({ error: 'Could not check the quiz right now. Try again in a minute.' });
    }
  }
  const passOk = typeof body.password === 'string' && auth.passwordMatches(body.password);
  const quizOk = prints ? await quiz.check(body.quiz, prints) : true;

  if (passOk && quizOk) {
    auth.startSession(res);
    return res.status(200).json({ ok: true });
  }

  await addFailure(id);
  await new Promise((r) => setTimeout(r, 500));
  return res.status(401).json({ error: prints ? 'That did not match. Check your answers and password.' : 'Wrong password.' });
};
