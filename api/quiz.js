'use strict';
const auth = require('../lib/auth');
const quiz = require('../lib/quiz');
const store = require('../lib/store');

// GET  (no login needed) -> the questions, and whether the quiz is switched on
// POST (login + password) {answers:[...]} -> set or change the quiz;  {clear:true} -> switch it off
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    if (!store.enabled()) return res.status(200).json({ enabled: false, set: false, questions: quiz.QUESTIONS });
    try {
      return res.status(200).json({ enabled: true, set: await quiz.isSet(), questions: quiz.QUESTIONS });
    } catch (e) {
      return res.status(502).json({ error: 'Could not check the quiz right now.' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!auth.requireAuth(req, res)) return;
  if (!store.enabled()) return res.status(400).json({ error: 'The quiz needs memory to be set up first (setup Step 4).' });

  const body = auth.readBody(req);
  if (typeof body.password !== 'string' || !auth.passwordMatches(body.password)) {
    await new Promise((r) => setTimeout(r, 500));
    return res.status(403).json({ error: 'Wrong password.' });
  }

  try {
    if (body.clear === true) {
      await quiz.clear();
      return res.status(200).json({ ok: true, set: false });
    }
    if (!quiz.usable(body.answers)) {
      return res.status(400).json({ error: 'Answer all ' + quiz.QUESTIONS.length + ' questions (at least 2 letters each).' });
    }
    await quiz.save(body.answers);
    return res.status(200).json({ ok: true, set: true });
  } catch (e) {
    return res.status(502).json({ error: 'Could not save the quiz: ' + e.message });
  }
};
