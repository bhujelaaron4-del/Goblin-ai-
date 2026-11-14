'use strict';
// Tiny client for an Upstash Redis database (free plan), over its REST address.
// Works with the variable names Vercel adds (KV_REST_API_*) and Upstash's own names.

function creds() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

function enabled() {
  return creds() !== null;
}

async function cmd(args) {
  const c = creds();
  if (!c) throw new Error('Memory storage is not set up');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(c.url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: ctl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) throw new Error(data.error || 'Storage error ' + r.status);
    return data.result;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Memory storage took too long to answer');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const get = (key) => cmd(['GET', key]);
const set = (key, value, ttl) => cmd(ttl ? ['SET', key, value, 'EX', String(ttl)] : ['SET', key, value]);
const del = (key) => cmd(['DEL', key]);
const rpush = (key, value) => cmd(['RPUSH', key, value]);
const lpop = (key) => cmd(['LPOP', key]);
const evalScript = (script, keys, args) => cmd(['EVAL', script, String(keys.length)].concat(keys, args || []));
const mget = (keys) => (keys.length ? cmd(['MGET'].concat(keys)) : Promise.resolve([]));

// Counts something for `seconds` seconds. Returns the new count.
async function bump(key, seconds) {
  const n = await cmd(['INCR', key]);
  if (n === 1) await cmd(['EXPIRE', key, String(seconds)]);
  return n;
}

module.exports = { enabled, get, set, del, mget, rpush, lpop, evalScript, bump };
