'use strict';
// Photo and video gallery kept in the same Upstash database as Ghost's memory.
// Every file is cut into small pieces (CHUNK bytes each) so each piece fits one database request.
const store = require('./store');

const CHUNK = 512 * 1024; // raw bytes per piece
const INDEX = 'ghost:gallery';
const MAX_IMAGE = 4 * 1024 * 1024;
const mb = (name, fallback, max) => Math.min(Math.max(Number(process.env[name]) || fallback, 1), max) * 1024 * 1024;
const MAX_VIDEO = mb('GALLERY_VIDEO_MB', 40, 1000);
const MAX_AUDIO = 20 * 1024 * 1024;
const MAX_TOTAL = mb('GALLERY_MB', 190, 50000); // the free database is 256 MB; raise GALLERY_MB if you upgrade it
const MAX_ITEMS = 3000;
const MAX_THUMB_CHARS = 180000; // base64 characters
const ID_RE = /^[a-z0-9]{8,24}$/;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const AUDIO_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/flac'];
const kindOf = (mime) => (IMAGE_TYPES.includes(mime) ? 'image' : VIDEO_TYPES.includes(mime) ? 'video' : AUDIO_TYPES.includes(mime) ? 'audio' : '');

const MAX_PIECES = Math.ceil(Math.max(MAX_VIDEO, MAX_AUDIO) / CHUNK);
const enabled = () => store.enabled();
const chunkKey = (id, n) => 'ghost:g:' + id + ':' + n;
const thumbKey = (id) => 'ghost:g:' + id + ':t';

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function readIndex() {
  const raw = await store.get(INDEX);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}
const writeIndex = (list) => store.set(INDEX, JSON.stringify(list));

async function list() {
  const items = await readIndex();
  const total = items.reduce((s, i) => s + i.size, 0);
  return { items: items.slice().reverse(), total, limit: MAX_TOTAL, videoMax: MAX_VIDEO, audioMax: MAX_AUDIO };
}

function cleanName(name) {
  return String(name || 'file').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80) || 'file';
}

// Checks a file before its pieces are sent. Returns { ok, id } or { ok:false, reason }.
async function begin(meta) {
  const mime = String(meta && meta.mime || '').toLowerCase();
  const size = Number(meta && meta.size);
  const kind = kindOf(mime);
  const isImage = kind === 'image';
  const isVideo = kind === 'video';
  if (!kind) return { ok: false, reason: 'Only photos, videos and songs (mp3, m4a, wav, ogg) can be stored.' };
  if (!Number.isInteger(size) || size < 1) return { ok: false, reason: 'That file is empty.' };
  if (isImage && size > MAX_IMAGE) return { ok: false, reason: 'That photo is too big (4 MB max).' };
  if (isVideo && size > MAX_VIDEO) return { ok: false, reason: 'That video is too big (' + Math.round(MAX_VIDEO / 1048576) + ' MB max). Try a shorter one.' };
  if (kind === 'audio' && size > MAX_AUDIO) return { ok: false, reason: 'That song is too big (20 MB max).' };
  const items = await readIndex();
  if (items.length >= MAX_ITEMS) return { ok: false, reason: 'The gallery is full. Delete some things first.' };
  const used = items.reduce((s, i) => s + i.size, 0);
  if (used + size > MAX_TOTAL) return { ok: false, reason: 'The gallery is full (about ' + Math.round(MAX_TOTAL / 1048576) + ' MB). Delete some things first.' };
  return { ok: true, id: newId(), chunks: Math.ceil(size / CHUNK), chunkSize: CHUNK };
}

function validBase64(data, maxRaw) {
  return typeof data === 'string' && data.length > 0 && data.length <= Math.ceil(maxRaw / 3) * 4 + 4 && data.length % 4 === 0 && B64_RE.test(data);
}

async function putChunk(id, n, data) {
  if (!ID_RE.test(String(id))) return { ok: false, reason: 'Bad id.' };
  if (!Number.isInteger(n) || n < 0 || n >= MAX_PIECES) return { ok: false, reason: 'Bad piece number.' };
  if (!validBase64(data, CHUNK)) return { ok: false, reason: 'Bad piece.' };
  await store.set(chunkKey(id, n), data);
  return { ok: true };
}

async function putThumb(id, data) {
  if (!ID_RE.test(String(id))) return { ok: false, reason: 'Bad id.' };
  if (typeof data !== 'string' || data.length > MAX_THUMB_CHARS || !B64_RE.test(data) || data.length % 4 !== 0 || !data.length) return { ok: false, reason: 'Bad picture.' };
  await store.set(thumbKey(id), data);
  return { ok: true };
}

// Adds the file to the list once every piece is in place and the size matches.
async function finish(meta) {
  const id = String(meta && meta.id || '');
  if (!ID_RE.test(id)) return { ok: false, reason: 'Bad id.' };
  const mime = String(meta.mime || '').toLowerCase();
  const type = kindOf(mime);
  const size = Number(meta.size);
  if (!type || !Number.isInteger(size) || size < 1) return { ok: false, reason: 'Bad file.' };
  const chunks = Math.ceil(size / CHUNK);
  // every piece must exist, and the last one must have the right length
  for (let n = 0; n < chunks; n++) {
    const piece = await store.get(chunkKey(id, n));
    if (!piece) return { ok: false, reason: 'Some of the file did not arrive. Try again.' };
    const want = n < chunks - 1 ? CHUNK : size - CHUNK * (chunks - 1);
    if (Buffer.from(piece, 'base64').length !== want) return { ok: false, reason: 'The file did not arrive whole. Try again.' };
  }
  const hasThumb = !!(await store.get(thumbKey(id)));
  const items = await readIndex();
  if (items.some((i) => i.id === id)) return { ok: false, reason: 'Already saved.' };
  const item = { id, name: cleanName(meta.name), type, mime, size, chunks, thumb: hasThumb, created: Date.now() };
  if ((type === 'video' || type === 'audio') && Number.isFinite(Number(meta.duration))) item.duration = Math.max(0, Math.min(86400, Math.round(Number(meta.duration))));
  items.push(item);
  await writeIndex(items);
  return { ok: true, item };
}

// Throws away pieces of a file that did not finish.
async function abort(id, chunks) {
  if (!ID_RE.test(String(id))) return { ok: false, reason: 'Bad id.' };
  const count = Math.min(Math.max(Number(chunks) || 0, 0), MAX_PIECES);
  const items = await readIndex();
  if (items.some((i) => i.id === id)) return { ok: false, reason: 'That one is already saved.' };
  for (let n = 0; n < count; n++) await store.del(chunkKey(id, n));
  await store.del(thumbKey(id));
  return { ok: true };
}

async function remove(id) {
  if (!ID_RE.test(String(id))) return { ok: false, reason: 'Bad id.' };
  const items = await readIndex();
  const item = items.find((i) => i.id === id);
  if (!item) return { ok: false, reason: 'Not found.' };
  await writeIndex(items.filter((i) => i.id !== id));
  for (let n = 0; n < item.chunks; n++) await store.del(chunkKey(id, n));
  await store.del(thumbKey(id));
  return { ok: true };
}

async function find(id) {
  if (!ID_RE.test(String(id))) return null;
  return (await readIndex()).find((i) => i.id === id) || null;
}

// Many small pictures in one go: { id: base64 }
async function thumbs(ids) {
  const clean = ids.filter((i) => ID_RE.test(String(i))).slice(0, 24);
  const got = await store.mget(clean.map(thumbKey));
  const out = {};
  clean.forEach((id, n) => { if (got[n]) out[id] = got[n]; });
  return out;
}

async function thumb(id) {
  if (!ID_RE.test(String(id))) return null;
  const data = await store.get(thumbKey(id));
  return data ? Buffer.from(data, 'base64') : null;
}

// Bytes start..end (inclusive) of a stored file.
async function bytes(item, start, end) {
  const first = Math.floor(start / CHUNK);
  const last = Math.floor(end / CHUNK);
  const parts = [];
  for (let n = first; n <= last; n++) {
    const piece = await store.get(chunkKey(item.id, n));
    if (!piece) throw new Error('A piece of the file is missing.');
    parts.push(Buffer.from(piece, 'base64'));
  }
  const all = Buffer.concat(parts);
  const offset = start - first * CHUNK;
  return all.subarray(offset, offset + (end - start + 1));
}

module.exports = { enabled, list, begin, putChunk, putThumb, finish, abort, remove, find, thumb, thumbs, bytes, CHUNK, MAX_VIDEO, MAX_AUDIO, MAX_IMAGE, MAX_TOTAL };

// Finds one of the user's own songs by what they asked for ("play my voice memo", "play Sunsetz").
const norm = (t) => String(t || '').toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
async function matchSong(query) {
  const q = norm(query);
  if (!q) return null;
  const songs = (await readIndex()).filter((i) => i.type === 'audio');
  const words = q.split(' ').filter((w) => w.length > 1 && !['play', 'song', 'the', 'my', 'by', 'a'].includes(w));
  let best = null;
  for (const it of songs) {
    const n = norm(it.name);
    if (!n) continue;
    if (q.includes(n) || (words.length && words.every((w) => n.includes(w)))) {
      if (!best || n.length > norm(best.name).length) best = it;
    }
  }
  return best;
}
module.exports.matchSong = matchSong;
