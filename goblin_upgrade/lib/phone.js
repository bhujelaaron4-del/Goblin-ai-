'use strict';
// Shortcuts for the user's phone (Android). A website cannot run apps on a phone by itself,
// so Ghost builds a safe link and shows it as a button. The user taps it, and the phone does the rest.
// Calls and messages open the dialer or the message app, so the user still presses Call or Send.

const SITES = {
  instagram: 'https://www.instagram.com/', youtube: 'https://www.youtube.com/', whatsapp: 'https://wa.me/', spotify: 'https://open.spotify.com/',
  maps: 'https://www.google.com/maps', gmail: 'https://mail.google.com/', facebook: 'https://www.facebook.com/', messenger: 'https://www.messenger.com/',
  tiktok: 'https://www.tiktok.com/', snapchat: 'https://www.snapchat.com/', telegram: 'https://t.me/', netflix: 'https://www.netflix.com/',
  twitter: 'https://x.com/', x: 'https://x.com/', google: 'https://www.google.com/', reddit: 'https://www.reddit.com/',
};
const KINDS = ['app', 'call', 'sms', 'whatsapp', 'directions', 'alarm', 'timer', 'camera', 'settings'];

const digits = (n) => String(n || '').replace(/[\s().-]/g, '');
const validNumber = (n) => /^\+?[0-9]{5,15}$/.test(n);

function build(a) {
  const kind = String(a && a.kind || '');
  if (!KINDS.includes(kind)) return { ok: false, reason: 'I cannot do that on the phone.' };
  const target = String(a.target || '').trim().slice(0, 80);
  const text = String(a.text || '').trim().slice(0, 300);
  if (kind === 'app') {
    const url = SITES[target.toLowerCase()];
    return url ? { ok: true, label: 'Open ' + target, url } : { ok: false, reason: 'I do not have a shortcut for ' + (target || 'that app') + '. I can open: ' + Object.keys(SITES).join(', ') + '.' };
  }
  if (kind === 'call' || kind === 'sms' || kind === 'whatsapp') {
    const n = digits(a.number);
    if (!validNumber(n)) return { ok: false, reason: 'I need the phone number first (with the country code, like +977...).' };
    if (kind === 'call') return { ok: true, label: 'Call ' + (target || n), url: 'tel:' + n };
    if (kind === 'sms') return { ok: true, label: 'Message ' + (target || n), url: 'sms:' + n + (text ? '?body=' + encodeURIComponent(text) : '') };
    return { ok: true, label: 'WhatsApp ' + (target || n), url: 'https://wa.me/' + n.replace('+', '') + (text ? '?text=' + encodeURIComponent(text) : '') };
  }
  if (kind === 'directions') {
    if (!target) return { ok: false, reason: 'Where to?' };
    return { ok: true, label: 'Directions to ' + target, url: 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(target) };
  }
  if (kind === 'alarm') {
    const h = parseInt(a.hour, 10);
    const m = parseInt(a.minute, 10) || 0;
    if (!(h >= 0 && h <= 23) || !(m >= 0 && m <= 59)) return { ok: false, reason: 'I need the alarm time.' };
    return { ok: true, label: 'Set alarm for ' + h + ':' + ('0' + m).slice(-2), url: 'intent:#Intent;action=android.intent.action.SET_ALARM;i.android.intent.extra.alarm.HOUR=' + h + ';i.android.intent.extra.alarm.MINUTES=' + m + ';end' };
  }
  if (kind === 'timer') {
    const s = parseInt(a.seconds, 10);
    if (!(s >= 1 && s <= 86400)) return { ok: false, reason: 'How long should the timer be?' };
    return { ok: true, label: 'Start a ' + (s >= 60 ? Math.round(s / 60) + ' minute' : s + ' second') + ' timer', url: 'intent:#Intent;action=android.intent.action.SET_TIMER;i.android.intent.extra.alarm.LENGTH=' + s + ';end' };
  }
  if (kind === 'camera') return { ok: true, label: 'Open the camera', url: 'intent:#Intent;action=android.media.action.STILL_IMAGE_CAMERA;end' };
  return { ok: true, label: 'Open phone settings', url: 'intent:#Intent;action=android.settings.SETTINGS;end' };
}

// What the saved chat is allowed to keep as a button address.
const OPEN_URL_RE = /^(https:\/\/[^\s"'<>]{1,300}|tel:\+?[0-9]{5,15}|sms:\+?[0-9]{5,15}(\?body=[A-Za-z0-9%._~-]{0,900})?|intent:#Intent;[A-Za-z0-9_.=;]{1,300}end)$/;

module.exports = { build, KINDS, SITES, OPEN_URL_RE };
