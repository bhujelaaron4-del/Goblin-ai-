'use strict';
// Plain commands like "open notepad" or "shut down in 5 seconds" do not need the AI at all.
// Running them straight away saves the two or three seconds the AI would take, so they feel instant.
// Anything that is not an exact, simple command returns null and goes to the AI as before.

const KNOWN = new Set(['instagram', 'youtube', 'facebook', 'whatsapp', 'whatsapp web', 'gmail', 'google', 'netflix', 'twitter', 'x', 'tiktok', 'reddit', 'telegram', 'github',
  'discord', 'snapchat', 'maps', 'chrome', 'google chrome', 'edge', 'microsoft edge', 'notepad', 'calculator', 'calc', 'paint', 'file explorer', 'explorer', 'files',
  'task manager', 'settings', 'camera', 'spotify', 'word', 'excel', 'powerpoint', 'vscode', 'vs code', 'snipping tool', 'clock']);
const PC = '(?:pc|computer|laptop)';

function seconds(n, unit) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return null;
  const secs = /^m/i.test(unit) ? v * 60 : v;
  return Math.min(Math.round(secs), 3600);
}

function clean(text) {
  return String(text || '').toLowerCase()
    .replace(/[.!?,]+$/g, '')
    .replace(/^(?:hey ghost[, ]*|ghost[, ]*|please |can you |could you |just )+/g, '')
    .replace(/(?: please| now| for me)+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parse(text) {
  const t = clean(text);
  if (!t || t.length > 80) return null;
  let m;
  const after = '(?: (?:in|after) (\\d+(?:\\.\\d+)?) ?(seconds?|secs?|s|minutes?|mins?|m))?';

  if ((m = new RegExp('^(?:shut ?down|turn off|power off)(?: my)?(?: ' + PC + ')?' + after + '$').exec(t))) {
    if (/^(?:turn|power) off/.test(t) && !new RegExp(PC).test(t)) return null; // "turn off the lights" is not for the PC
    const args = { action: 'shutdown' };
    if (m[1]) { const d = seconds(m[1], m[2]); if (d === null) return null; args.delay_seconds = d; }
    return { args };
  }
  if ((m = new RegExp('^(?:restart|reboot)(?: my)?(?: ' + PC + ')?' + after + '$').exec(t))) {
    const args = { action: 'restart' };
    if (m[1]) { const d = seconds(m[1], m[2]); if (d === null) return null; args.delay_seconds = d; }
    return { args };
  }
  if (new RegExp('^(?:cancel|stop|abort) (?:the |my )?(?:shut ?down|restart)$').test(t)) return { args: { action: 'cancel_shutdown' } };
  if (new RegExp('^lock(?: my)?(?: (?:' + PC + '|screen))?$').test(t)) return { args: { action: 'lock' } };
  if (new RegExp('^(?:put (?:my )?' + PC + ' to sleep|sleep(?: my)?(?: ' + PC + ')?)$').test(t)) return { args: { action: 'sleep' } };
  if ((m = /^(?:take a )?screenshot$/.exec(t))) return { args: { action: 'press_key', key: 'screenshot' } };
  if ((m = /^(maximi[sz]e|minimi[sz]e)(?: (?:this|the))?(?: window)?$/.exec(t))) return { args: { action: 'press_key', key: m[1].startsWith('max') ? 'maximize' : 'minimize' } };
  if ((m = /^brightness (?:to )?(\d{1,3})(?: ?%| percent)?$/.exec(t))) return { args: { action: 'brightness', level: Number(m[1]) } };
  if ((m = /^open (?:my |the )?(downloads|documents|desktop|pictures|music|videos)(?: folder)?$/.exec(t))) return { args: { action: 'open_folder', target: m[1] } };
  if (/^(?:what(?:'s| is) open|what windows are open|list (?:open )?windows)$/.test(t)) return { args: { action: 'list_windows' } };
  if ((m = /^volume (up|down)$/.exec(t))) return { args: { action: 'press_key', key: 'volume_' + m[1], count: 5 } };
  if ((m = new RegExp('^(open|close) (?:the |my )?([a-z0-9 ._+-]{1,30}?)( on (?:my |the )?' + PC + ')?$').exec(t))) {
    const name = m[2].trim();
    if (!KNOWN.has(name) && !m[3]) return null; // any other name only when you said it is for the PC
    return { args: { action: m[1] === 'open' ? 'open_app' : 'close_app', target: name } };
  }
  return null;
}

// What to say after the command, using only what the PC really reported.
function say(r, events) {
  if (!r) return 'Something went wrong.';
  if (r.error) return String(r.error);
  switch (r.status) {
    case 'needs_confirmation': { const c = (events || []).find((e) => e.type === 'confirm'); return 'Please confirm: ' + (c ? c.text : 'this action') + '.'; }
    case 'done': return String(r.message || 'Done.');
    case 'failed': return 'That did not work: ' + String(r.message || '');
    case 'offline': return 'The PC helper is not running, so nothing was sent. Start it from My PC in the menu.';
    case 'locked': return 'Remote control is stopped (emergency stop). Turn it back on in My PC.';
    case 'sent_not_confirmed': return 'Sent, but the PC has not confirmed yet.';
    default: return String(r.message || 'Done.');
  }
}

module.exports = { parse, say };
