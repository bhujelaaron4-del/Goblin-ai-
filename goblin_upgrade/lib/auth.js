'use strict';
const crypto = require('crypto');

const COOKIE = 'ghost_session';
const MAX_AGE = 60 * 60 * 24 * 30; // stay logged in for 30 days

function config() {
  const password = process.env.APP_PASSWORD || '';
  const secret = process.env.SESSION_SECRET || '';
  return { password, secret, ok: password.length >= 8 && secret.length >= 32 };
}

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function passwordMatches(input) {
  const { password } = config();
  return crypto.timingSafeEqual(sha(input), sha(password));
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createSession() {
  const { secret } = config();
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + MAX_AGE * 1000 })).toString('base64url');
  return payload + '.' + sign(payload, secret);
}

function parseCookies(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    });
  return out;
}

function isLoggedIn(req) {
  const { ok, secret } = config();
  if (!ok) return false;
  const token = parseCookies(req.headers && req.headers.cookie)[COOKIE];
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload, secret));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && exp > Date.now();
  } catch (e) {
    return false;
  }
}

function cookie(value, maxAge) {
  return COOKIE + '=' + value + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + maxAge;
}

function startSession(res) {
  res.setHeader('Set-Cookie', cookie(createSession(), MAX_AGE));
}

function endSession(res) {
  res.setHeader('Set-Cookie', cookie('', 0));
}

// Use at the top of every private endpoint. Returns true when the caller may continue.
function requireAuth(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!config().ok) {
    res.status(503).json({ error: 'Not set up yet. Add APP_PASSWORD (8+ characters) and SESSION_SECRET (32+ characters) in Vercel, then redeploy.' });
    return false;
  }
  if (!isLoggedIn(req)) {
    res.status(401).json({ error: 'Please log in again.', login: true });
    return false;
  }
  return true;
}

// Reads a JSON body whether or not the platform already parsed it.
function readBody(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string') {
    try {
      return JSON.parse(b);
    } catch (e) {
      return {};
    }
  }
  return {};
}

module.exports = { config, passwordMatches, startSession, endSession, isLoggedIn, requireAuth, readBody };
