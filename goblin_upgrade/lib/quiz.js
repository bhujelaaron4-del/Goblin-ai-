'use strict';
const crypto = require('crypto');
const store = require('./store');

// A secret quiz that comes before the password when you log in.
// Only fingerprints of your answers are saved (never the answers), in your own Redis database.
const KEY = 'ghost:quiz';
const QUESTIONS = [
  'What is your favourite sport?',
  'What is your favourite food?',
  "What is your best friend's first name?",
  'What is your favourite game?',
];

// "Cricket!", " cricket " and "CRICKET" all count as the same answer.
function normalize(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');
}

function fingerprint(i, answer) {
  const secret = process.env.SESSION_SECRET || '';
  return crypto.createHmac('sha256', secret).update(i + '|' + normalize(answer)).digest('hex');
}

function usable(answers) {
  return Array.isArray(answers) && answers.length === QUESTIONS.length &&
    answers.every((a) => typeof a === 'string' && normalize(a).length >= 2 && a.length <= 80);
}

async function saved() {
  const raw = await store.get(KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return Array.isArray(o.prints) && o.prints.length === QUESTIONS.length ? o.prints : null;
  } catch (e) {
    return null;
  }
}

async function isSet() {
  return (await saved()) !== null;
}

// True only if every answer matches. Always checks all of them, so timing tells nothing.
async function check(answers, prints) {
  const have = prints || (await saved());
  if (!have) return true; // no quiz set
  if (!Array.isArray(answers) || answers.length !== QUESTIONS.length) return false;
  let ok = true;
  for (let i = 0; i < QUESTIONS.length; i++) {
    const a = Buffer.from(fingerprint(i, answers[i]));
    const b = Buffer.from(have[i]);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) ok = false;
  }
  return ok;
}

async function save(answers) {
  await store.set(KEY, JSON.stringify({ prints: answers.map((a, i) => fingerprint(i, a)) }));
}

async function clear() {
  await store.del(KEY);
}

module.exports = { QUESTIONS, usable, saved, isSet, check, save, clear, normalize };
