'use strict';
// A second password just for the gallery. Kept in the memory database as a salted hash.
const crypto = require('crypto');
const store = require('./store');

const KEY = 'ghost:vault';
const TRIES = 'ghost:vault:tries';
const COOKIE = 'ghost_vault';
const OPEN_SECONDS = 2 * 60 * 60; // stays open for 2 hours
const MIN_LENGTH = 6;
const MAX_TRIES = 6;

function secret() {
  return String(process.env.SESSION_SECRET || '') + ':gallery';
}

async function record() {
  const raw = await store.get(KEY);
  if (!raw) return null;
  try {
    const r = JSON.parse(raw);
    return r && r.salt && r.hash ? r : null;
  } catch (e) {
    return null;
  }
}

const hashOf = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');

async function isSet() {
  return (await record()) !== null;
}

async function check(pw) {
  const r = await record();
  if (!r) return false;
  const a = Buffer.from(hashOf(pw, r.salt), 'hex');
  const b = Buffer.from(r.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function set(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  await store.set(KEY, JSON.stringify({ salt, hash: hashOf(pw, salt) }));
}

const clear = () => store.del(KEY);

// Counts wrong tries. Returns false when too many.
async function tooMany() {
  return Number((await store.get(TRIES)) || 0) >= MAX_TRIES;
}
const failed = () => store.bump(TRIES, 15 * 60);
const forgive = () => store.del(TRIES);

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function grant(res) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + OPEN_SECONDS * 1000 })).toString('base64url');
  res.setHeader('Set-Cookie', COOKIE + '=' + payload + '.' + sign(payload) + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + OPEN_SECONDS);
}

function revoke(res) {
  res.setHeader('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
}

function opened(req) {
  const m = new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)').exec((req.headers && req.headers.cookie) || '');
  if (!m) return false;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now();
  } catch (e) {
    return false;
  }
}

// True when the caller may use the gallery: no password set, or already opened.
async function allowed(req) {
  if (opened(req)) return true;
  return !(await isSet());
}

module.exports = { MIN_LENGTH, isSet, check, set, clear, tooMany, failed, forgive, grant, revoke, opened, allowed };
