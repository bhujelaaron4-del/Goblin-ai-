'use strict';
// Finds a song on YouTube so the page can play it in its own small player.
// With a free YOUTUBE_API_KEY it picks the best matching video. Without one, it hands back
// a YouTube search link instead, so "play X" always does something.

const API = process.env.YOUTUBE_API_BASE || 'https://www.googleapis.com/youtube/v3';
const ITUNES = process.env.ITUNES_API_BASE || 'https://itunes.apple.com';
const PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.itunes\.apple\.com\//;
const ART_RE = /^https:\/\/[a-z0-9-]+\.mzstatic\.com\//;

function ready() {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

function searchLink(query) {
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
}

function decode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

function cleanQuery(q) {
  return String(q || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function cleanStart(n) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 && v < 86400 ? v : 0;
}

// Lowercase words only, so "Perfect - Ed Sheeran (Official Video)" and "perfect ed sheeran" compare equal.
const NOISE = new Set(['play', 'song', 'songs', 'music', 'by', 'the', 'official', 'video', 'lyrics', 'lyric', 'audio', 'feat', 'ft', 'full', 'version', 'please', 'a']);
function words(t) {
  return String(t || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ')
    .filter((w) => w && !NOISE.has(w));
}
// 1 when every word you typed is in the song title or the singer's name.
function score(query, title, artist) {
  const q = words(query);
  if (!q.length) return 0;
  const have = new Set(words(title + ' ' + artist));
  return q.filter((w) => have.has(w)).length / q.length;
}

function pick(hit) {
  const art = String(hit.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/600x600bb.');
  return { preview: hit.previewUrl, art: ART_RE.test(art) ? art : '', title: String(hit.trackName || '').slice(0, 150), channel: String(hit.artistName || '').slice(0, 80) };
}

async function itunes(q, country) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(ITUNES + '/search?media=music&entity=song&limit=20&country=' + country + '&term=' + encodeURIComponent(q), { signal: ctl.signal });
    const data = await r.json().catch(() => ({}));
    return r.ok ? (data.results || []).filter((h) => PREVIEW_RE.test(String(h.previewUrl || ''))) : [];
  } catch (e) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Free fallback with no key: a 30-second preview from Apple's public music search.
// Returns the song when it clearly matches what was typed, otherwise a short list to choose from.
async function preview(q) {
  const lists = await Promise.all(['us', 'in', 'gb'].map((c) => itunes(q, c)));
  const seen = new Set();
  const all = [];
  lists.forEach((l) => l.forEach((h) => {
    const k = String(h.trackId || h.previewUrl);
    if (!seen.has(k)) { seen.add(k); all.push(h); }
  }));
  if (!all.length) return null;
  const ranked = all
    .map((h, i) => ({ h, i, s: score(q, h.trackName, h.artistName) }))
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const best = ranked[0];
  if (best.s === 1) return Object.assign(pick(best.h), { sure: true });
  return { candidates: ranked.slice(0, 6).map((r) => pick(r.h)), unsure: true };
}

// Returns { id, title, channel } (full song) or { preview, art, title, channel } (30-second preview) or { link, reason }.
async function find(query) {
  const q = cleanQuery(query);
  if (!q) return { reason: 'No song name.' };
  if (!ready()) return (await preview(q)) || { link: searchLink(q), reason: 'no-key' };

  const url = API + '/search?part=snippet&type=video&videoEmbeddable=true&videoCategoryId=10&maxResults=8&safeSearch=none&q=' + encodeURIComponent(q);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(url, { headers: { 'x-goog-api-key': process.env.YOUTUBE_API_KEY }, signal: ctl.signal });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return (await preview(q)) || { link: searchLink(q), reason: (data.error && data.error.message) || 'YouTube error ' + r.status };
    const found = (data.items || [])
      .filter((h) => h && h.id && /^[\w-]{11}$/.test(String(h.id.videoId || '')))
      .map((h) => ({ id: h.id.videoId, title: decode(h.snippet && h.snippet.title).slice(0, 150), channel: decode(h.snippet && h.snippet.channelTitle).slice(0, 80) }));
    if (!found.length) return (await preview(q)) || { link: searchLink(q), reason: 'no-match' };
    // Vevo and some labels block playing outside YouTube, so those go last
    const blocked = (c) => /vevo$/i.test(c.channel);
    const ordered = found.filter((c) => !blocked(c)).concat(found.filter(blocked));
    return Object.assign({}, ordered[0], { alts: ordered.slice(1, 5) });
  } catch (e) {
    return (await preview(q)) || { link: searchLink(q), reason: e.name === 'AbortError' ? 'YouTube took too long.' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { preview, score, PREVIEW_RE, ART_RE, ready, find, searchLink, cleanQuery, cleanStart };
