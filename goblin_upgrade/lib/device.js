'use strict';
// Remote control of the user's own Windows PC.
// Ghost puts short, checked commands in a queue. A small helper running on the PC asks for them,
// does them, and reports back. Nothing here can run anything that is not on the lists below.
const crypto = require('crypto');
const store = require('./store');

const KEY = 'ghost:dev:key';
const PKEY = 'ghost:phone:key';
const PSEEN = 'ghost:phone:seen';
const QUEUE = 'ghost:dev:q';
const SEEN = 'ghost:dev:seen';
const HOT = 'ghost:dev:hot';
const FAILS = 'ghost:dev:fails';
const LOCK = 'ghost:dev:lock';
const LOG = 'ghost:dev:log';
const pendingKey = (id) => 'ghost:dev:p:' + id;
const resultKey = (id) => 'ghost:dev:r:' + id;
const ID_RE = /^[a-z0-9]{8,24}$/;

const ACTIONS = ['shutdown', 'restart', 'cancel_shutdown', 'sleep', 'lock', 'open_app', 'close_app', 'open_url', 'type_text', 'press_key', 'brightness', 'open_folder', 'list_windows'];
const FOLDERS = ['downloads', 'documents', 'desktop', 'pictures', 'music', 'videos'];
const KEYS = ['enter', 'tab', 'escape', 'space', 'backspace', 'delete', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'f5',
  'new_tab', 'close_tab', 'next_tab', 'copy', 'paste', 'select_all', 'undo', 'save', 'alt_tab', 'show_desktop',
  'volume_up', 'volume_down', 'mute', 'play_pause', 'next_track', 'prev_track',
  'maximize', 'minimize', 'snap_left', 'snap_right', 'screenshot', 'task_view', 'fullscreen', 'new_window', 'close_window'];
const NAME_RE = /^[\p{L}\p{N} ._+-]{1,40}$/u;
const MAX_AGE_MS = 90 * 1000; // a command nobody picked up in 90 seconds is thrown away, never run late

const enabled = () => store.enabled();

function validate(a) {
  const action = String(a && a.action || '');
  if (!ACTIONS.includes(action)) return { ok: false, reason: 'Unknown PC action.' };
  const c = { action };
  if (action === 'open_app' || action === 'close_app') {
    const t = String(a.target || '').trim();
    if (!NAME_RE.test(t)) return { ok: false, reason: 'Say which app.' };
    c.target = t;
  }
  if (action === 'open_url') {
    const u = String(a.url || '').trim();
    if (!/^https?:\/\/[^\s"'<>`^|&;]{3,500}$/i.test(u)) return { ok: false, reason: 'That web address does not look right.' };
    c.url = u;
  }
  if (action === 'type_text') {
    const t = String(a.text || '');
    if (!t.trim() || t.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(t)) return { ok: false, reason: 'Nothing to type, or it is too long (500 letters max).' };
    c.text = t;
  }
  if (action === 'shutdown' || action === 'restart') {
    const d = a.delay_seconds === undefined || a.delay_seconds === null || a.delay_seconds === '' ? 2 : Number(a.delay_seconds);
    if (!Number.isFinite(d) || d < 0 || d > 3600) return { ok: false, reason: 'The delay must be between 0 seconds and 1 hour.' };
    c.delay = Math.round(d);
  }
  if (action === 'brightness') {
    const l = Number(a.level);
    if (!Number.isFinite(l) || l < 0 || l > 100) return { ok: false, reason: 'Brightness must be a number from 0 to 100.' };
    c.level = Math.round(l);
  }
  if (action === 'open_folder') {
    const f = String(a.target || '').toLowerCase().trim();
    if (!FOLDERS.includes(f)) return { ok: false, reason: 'I can open downloads, documents, desktop, pictures, music or videos.' };
    c.target = f;
  }
  if (action === 'press_key') {
    const k = String(a.key || '');
    if (!KEYS.includes(k)) return { ok: false, reason: 'I cannot press that key.' };
    c.key = k;
    c.count = Math.min(Math.max(parseInt(a.count, 10) || 1, 1), 25);
  }
  return { ok: true, command: c };
}

// ---- the key the helper uses to prove it is yours ----
async function getKey(create) {
  let k = await store.get(KEY);
  if (!k && create) {
    k = crypto.randomBytes(24).toString('hex');
    await store.set(KEY, k);
  }
  return k || '';
}
async function resetKey() {
  await store.del(KEY);
  await store.del(SEEN);
  return getKey(true);
}
async function checkKey(token) {
  if (Number((await store.get(FAILS)) || 0) >= 30) return false;
  const k = await getKey(false);
  const a = Buffer.from(String(token));
  const b = Buffer.from(k);
  if (!k || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await store.bump(FAILS, 15 * 60);
    return false;
  }
  return true;
}

const online = async () => (await store.get(SEEN)) !== null;

// ---- the Ghost phone app has its own key. It can talk to Ghost and confirm or stop, but never poll PC commands ----
async function getPhoneKey(create) {
  let k = await store.get(PKEY);
  if (!k && create) {
    k = crypto.randomBytes(24).toString('hex');
    await store.set(PKEY, k);
  }
  return k || '';
}
async function resetPhoneKey() {
  await store.del(PKEY);
  await store.del(PSEEN);
}
const phoneSeen = async () => (await store.get(PSEEN)) !== null;
const markPhone = () => store.set(PSEEN, '1', 600);
// Which device is this key? 'pc', 'phone' or '' (nobody). Wrong guesses are counted and locked out.
async function whoIs(token) {
  if (Number((await store.get(FAILS)) || 0) >= 30) return '';
  const a = Buffer.from(String(token));
  for (const [role, key] of [['pc', KEY], ['phone', PKEY]]) {
    const k = await store.get(key);
    const b = Buffer.from(k || '');
    if (k && a.length === b.length && crypto.timingSafeEqual(a, b)) return role;
  }
  await store.bump(FAILS, 15 * 60);
  return '';
}

// ---- risk levels ----
const MEDIUM_KEYS = ['close_tab', 'save', 'paste', 'undo', 'alt_tab', 'select_all', 'close_window'];
function riskOf(c) {
  if (c.action === 'shutdown' || c.action === 'restart') return 'high';
  if (c.action === 'close_app' || c.action === 'type_text' || c.action === 'sleep') return 'medium';
  if (c.action === 'press_key' && MEDIUM_KEYS.includes(c.key)) return 'medium';
  return 'low';
}
function inText(s) {
  const n = Number(s === undefined ? 2 : s);
  if (n <= 0) return 'right now';
  if (n < 60) return 'in ' + n + (n === 1 ? ' second' : ' seconds');
  const m = Math.round(n / 6) / 10;
  return 'in ' + m + (m === 1 ? ' minute' : ' minutes');
}
function describe(c) {
  const key = (c.key || '').replace(/_/g, ' ');
  const text = {
    shutdown: 'Shut down the PC ' + inText(c.delay),
    restart: 'Restart the PC ' + inText(c.delay),
    cancel_shutdown: 'Cancel the shutdown',
    sleep: 'Put the PC to sleep',
    lock: 'Lock the PC',
    open_app: 'Open ' + c.target,
    close_app: 'Close ' + c.target,
    open_url: 'Open ' + c.url,
    type_text: 'Type: "' + String(c.text || '').slice(0, 80) + '"',
    brightness: 'Set the screen brightness to ' + c.level + ' percent',
    open_folder: 'Open the ' + c.target + ' folder',
    list_windows: 'List the open windows',
    press_key: 'Press ' + key + (c.count > 1 ? ' x' + c.count : ''),
  }[c.action];
  return String(text || c.action).slice(0, 160);
}

// ---- activity history (newest first, last 60) ----
async function log(entry) {
  let list = [];
  try { list = JSON.parse((await store.get(LOG)) || '[]'); } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  list.unshift(Object.assign({ t: Date.now() }, entry));
  await store.set(LOG, JSON.stringify(list.slice(0, 60)));
}
async function history() {
  try { const l = JSON.parse((await store.get(LOG)) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; }
}

// ---- emergency stop ----
const locked = async () => (await store.get(LOCK)) !== null;
async function stopAll() {
  await store.set(LOCK, '1');
  await store.del(QUEUE);
  await store.del(HOT);
  await log({ label: 'EMERGENCY STOP: everything stopped, no more commands will run', risk: 'high', status: 'stopped' });
}
async function resume() {
  await store.del(LOCK);
  await log({ label: 'Remote control turned back on', risk: 'low', status: 'resumed' });
}

// ---- queue ----
async function push(command) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await store.rpush(QUEUE, JSON.stringify(Object.assign({ id, t: Date.now() }, command)));
  await store.set(HOT, '1', 120); // for 2 minutes the helper checks very often
  return id;
}

// One poll from the helper: marks the PC as online, pops the next fresh command.
// How often the helper checks in. Idle 10 s keeps the free database plan; on a paid plan set PC_IDLE_MS=2000 in Vercel for near-instant answers.
const clampMs = (v, lo, hi, d) => Math.min(Math.max(Number(v) || d, lo), hi);
const IDLE_MS = clampMs(process.env.PC_IDLE_MS, 1000, 60000, 10000);
const HOT_MS = clampMs(process.env.PC_HOT_MS, 200, 5000, 500);
const POLL_SCRIPT = "local l = redis.call('EXISTS', KEYS[4]); local c = false; if l == 0 then c = redis.call('LPOP', KEYS[1]) end; redis.call('SET', KEYS[2], '1', 'EX', 60); local h = redis.call('EXISTS', KEYS[3]); return {c, h, l}";
async function poll() {
  const r = await store.evalScript(POLL_SCRIPT, [QUEUE, SEEN, HOT, LOCK]);
  const hot = Array.isArray(r) && Number(r[1]) === 1;
  const locked = Array.isArray(r) && Number(r[2]) === 1;
  const next = locked ? 5000 : hot ? HOT_MS : IDLE_MS;
  let raw = !locked && Array.isArray(r) ? r[0] : null;
  for (let i = 0; raw && i < 5; i++) {
    let cmd = null;
    try { cmd = JSON.parse(raw); } catch (e) { cmd = null; }
    if (cmd && ID_RE.test(String(cmd.id)) && ACTIONS.includes(cmd.action) && Date.now() - Number(cmd.t) < MAX_AGE_MS) return { cmd, next, locked: false };
    raw = await store.lpop(QUEUE); // too old or broken: skip it
  }
  return { cmd: null, next, locked };
}

async function report(id, ok, message) {
  if (!ID_RE.test(String(id))) return false;
  await store.set(resultKey(id), JSON.stringify({ ok: !!ok, message: String(message || '').slice(0, 200) }), 300);
  return true;
}

// Runs one checked command from the chat. Medium and high risk ones wait for a real tap on Confirm.
async function request(command) {
  if (await locked()) return { status: 'locked', message: 'Remote control is stopped (emergency stop). The user must turn it back on in My PC.' };
  if (!(await online())) return { status: 'offline', message: 'The PC helper is not running, so nothing was sent. Tell the user to double-click start-ghost-pc.bat on the PC (My PC in the menu has it).' };
  const risk = riskOf(command);
  const label = describe(command);
  if (risk !== 'low') {
    const pid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await store.set(pendingKey(pid), JSON.stringify({ command, label, risk }), 120);
    await log({ label, risk, status: 'asked' });
    return { status: 'needs_confirmation', pid, label, risk };
  }
  return execute(command, label, risk);
}

async function execute(command, label, risk) {
  const id = await push(command);
  const r = await waitResult(id, 14000);
  if (!r) {
    await log({ label, risk, status: 'sent', message: 'No answer from the PC yet.' });
    return { status: 'sent_not_confirmed', label, message: 'Sent, but the PC has not confirmed yet. Do not say it worked.' };
  }
  await log({ label, risk, status: r.ok ? 'done' : 'failed', message: r.message });
  return { status: r.ok ? 'done' : 'failed', label, message: r.message };
}

// The Confirm / Cancel buttons call these. A tap by the user is the only way past medium and high risk.
async function confirm(pid) {
  if (!ID_RE.test(String(pid))) return { status: 'expired', message: 'That request is not valid.' };
  const raw = await store.get(pendingKey(pid));
  if (!raw) return { status: 'expired', message: 'That request expired. Ask Ghost again.' };
  await store.del(pendingKey(pid)); // works once
  if (await locked()) return { status: 'locked', message: 'Remote control is stopped.' };
  if (!(await online())) return { status: 'offline', message: 'The PC helper is not running.' };
  let p;
  try { p = JSON.parse(raw); } catch (e) { return { status: 'expired', message: 'That request was damaged.' }; }
  const check = validate(p.command);
  if (!check.ok) return { status: 'failed', message: check.reason };
  await log({ label: p.label, risk: p.risk, status: 'confirmed' });
  return execute(check.command, p.label, p.risk);
}
async function decline(pid) {
  if (!ID_RE.test(String(pid))) return { status: 'expired' };
  const raw = await store.get(pendingKey(pid));
  if (raw) {
    await store.del(pendingKey(pid));
    try { const p = JSON.parse(raw); await log({ label: p.label, risk: p.risk, status: 'declined' }); } catch (e) { /* ignore */ }
  }
  return { status: 'declined' };
}

async function waitResult(id, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const raw = await store.get(resultKey(id));
    if (raw) { try { return JSON.parse(raw); } catch (e) { return { ok: false, message: 'Bad answer.' }; } }
    await new Promise((r) => setTimeout(r, 120));
  }
  return null;
}

// ---- the helper program (a Windows .bat that carries a PowerShell script) ----
const HELPER = String.raw`@echo off
title Ghost AI - PC helper
echo Starting the Ghost PC helper. Keep this window open. Close it to stop Ghost from controlling this PC.
set "GHOSTBAT=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = Get-Content -Raw -LiteralPath '%~f0'; $i = $t.IndexOf('#PS'+'-START#'); Invoke-Expression $t.Substring($i)"
echo.
echo The helper stopped.
pause
exit /b
#PS-START#
$Base = '__URL__'
$Key = '__KEY__'
$Tz = '__TZ__'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class GhostKeys {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public static void Tap(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 2, UIntPtr.Zero); }
  public static void Combo(byte mod, byte vk) { keybd_event(mod, 0, 0, UIntPtr.Zero); Tap(vk); keybd_event(mod, 0, 2, UIntPtr.Zero); }
}
"@

$Sites = @{
  'instagram' = 'https://www.instagram.com'; 'youtube' = 'https://www.youtube.com'; 'facebook' = 'https://www.facebook.com';
  'whatsapp web' = 'https://web.whatsapp.com'; 'gmail' = 'https://mail.google.com'; 'google' = 'https://www.google.com';
  'netflix' = 'https://www.netflix.com'; 'twitter' = 'https://x.com'; 'x' = 'https://x.com'; 'tiktok' = 'https://www.tiktok.com';
  'reddit' = 'https://www.reddit.com'; 'telegram' = 'https://web.telegram.org'; 'github' = 'https://github.com';
  'discord' = 'https://discord.com/app'; 'snapchat' = 'https://web.snapchat.com'; 'maps' = 'https://www.google.com/maps'
}
$Apps = @{
  'chrome' = 'chrome'; 'google chrome' = 'chrome'; 'edge' = 'msedge'; 'microsoft edge' = 'msedge'; 'notepad' = 'notepad';
  'calculator' = 'calc'; 'calc' = 'calc'; 'paint' = 'mspaint'; 'file explorer' = 'explorer'; 'explorer' = 'explorer';
  'files' = 'explorer'; 'task manager' = 'taskmgr'; 'settings' = 'ms-settings:'; 'camera' = 'microsoft.windows.camera:';
  'spotify' = 'spotify:'; 'word' = 'winword'; 'excel' = 'excel'; 'powerpoint' = 'powerpnt'; 'vscode' = 'code'; 'vs code' = 'code';
  'whatsapp' = 'whatsapp:'; 'snipping tool' = 'snippingtool'; 'clock' = 'ms-clock:'
}
$Procs = @{
  'chrome' = @('chrome'); 'google chrome' = @('chrome'); 'edge' = @('msedge'); 'microsoft edge' = @('msedge'); 'notepad' = @('notepad');
  'calculator' = @('CalculatorApp', 'Calculator', 'calc'); 'calc' = @('CalculatorApp', 'Calculator', 'calc'); 'paint' = @('mspaint');
  'spotify' = @('Spotify'); 'word' = @('WINWORD'); 'excel' = @('EXCEL'); 'powerpoint' = @('POWERPNT'); 'vscode' = @('Code'); 'vs code' = @('Code');
  'whatsapp' = @('WhatsApp'); 'discord' = @('Discord'); 'task manager' = @('Taskmgr'); 'settings' = @('SystemSettings'); 'camera' = @('WindowsCamera')
}
$Never = @('explorer', 'winlogon', 'csrss', 'system', 'svchost', 'lsass', 'services', 'wininit', 'dwm', 'powershell', 'pwsh', 'cmd', 'conhost', 'smss', 'idle')
$Blocked = @('cmd', 'powershell', 'pwsh', 'wscript', 'cscript', 'mshta', 'regedit', 'reg', 'format', 'diskpart', 'bcdedit', 'net', 'sc')
$Browsers = @('chrome', 'msedge', 'firefox', 'brave', 'opera')
$VK = @{ 'volume_up' = 0xAF; 'volume_down' = 0xAE; 'mute' = 0xAD; 'play_pause' = 0xB3; 'next_track' = 0xB0; 'prev_track' = 0xB1 }
$WinK = @{ 'maximize' = 0x26; 'minimize' = 0x28; 'snap_left' = 0x25; 'snap_right' = 0x27; 'screenshot' = 0x2C; 'task_view' = 0x09 }
$SK = @{
  'enter' = '{ENTER}'; 'tab' = '{TAB}'; 'escape' = '{ESC}'; 'space' = ' '; 'backspace' = '{BACKSPACE}'; 'delete' = '{DELETE}';
  'up' = '{UP}'; 'down' = '{DOWN}'; 'left' = '{LEFT}'; 'right' = '{RIGHT}'; 'home' = '{HOME}'; 'end' = '{END}';
  'pageup' = '{PGUP}'; 'pagedown' = '{PGDN}'; 'f5' = '{F5}'; 'new_tab' = '^t'; 'close_tab' = '^w'; 'next_tab' = '^{TAB}';
  'copy' = '^c'; 'paste' = '^v'; 'select_all' = '^a'; 'undo' = '^z'; 'save' = '^s'; 'alt_tab' = '%{TAB}'; 'fullscreen' = '{F11}'; 'new_window' = '^n'; 'close_window' = '%{F4}'
}

function Say($t) { Write-Host ((Get-Date).ToString('HH:mm:ss') + '  ' + $t) }

# One connection that stays open, so every check-in skips the slow "say hello" step of a new connection.
Add-Type -AssemblyName System.Net.Http
$script:Http = New-Object System.Net.Http.HttpClient
$script:Http.Timeout = [TimeSpan]::FromSeconds(20)
$script:Http.DefaultRequestHeaders.Add('Authorization', ('Bearer ' + $Key))

function Call($method, $path, $body) {
  $resp = $null
  if ($body -ne $null) {
    $json = $body | ConvertTo-Json -Compress -Depth 6
    $content = New-Object System.Net.Http.StringContent($json, [System.Text.Encoding]::UTF8, 'application/json')
    $resp = $script:Http.PostAsync(($Base + $path), $content).GetAwaiter().GetResult()
  } else {
    $resp = $script:Http.GetAsync(($Base + $path)).GetAwaiter().GetResult()
  }
  $txt = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  $data = $null
  try { $data = $txt | ConvertFrom-Json } catch { }
  if (-not $resp.IsSuccessStatusCode) {
    $why = 'Ghost answered with error ' + [int]$resp.StatusCode
    if ($data -and $data.error) { $why = [string]$data.error }
    throw $why
  }
  return $data
}

function Esc-Keys([string]$s) {
  $o = ''
  foreach ($c in $s.ToCharArray()) {
    if ([int]$c -eq 13) { continue }
    elseif ([int]$c -eq 10) { $o += '{ENTER}' }
    elseif ('+^%~(){}[]'.Contains([string]$c)) { $o += ('{' + $c + '}') }
    else { $o += $c }
  }
  return $o
}

function Close-App([string]$name) {
  $n = $name.ToLower().Trim()
  $names = @()
  if ($Procs.ContainsKey($n)) { $names = $Procs[$n] } else { $names = @($n -replace ' ', '') }
  $count = 0
  foreach ($pn in $names) {
    if ($Never -contains $pn.ToLower()) { continue }
    foreach ($p in @(Get-Process -Name $pn -ErrorAction SilentlyContinue)) { if ($p.CloseMainWindow()) { $count++ } }
  }
  if ($count -eq 0) {
    foreach ($p in @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.ToLower().Contains($n) -and ($Browsers -contains $_.ProcessName.ToLower()) })) {
      if ($p.CloseMainWindow()) { $count++ }
    }
  }
  return $count
}

function Run($c) {
  $res = @{ ok = $true; message = 'Done.'; after = $null }
  switch ($c.action) {
    'shutdown' {
      $d = 2; if ($c.delay -ne $null) { $d = [int]$c.delay }; if ($d -lt 0 -or $d -gt 3600) { $d = 2 }
      & shutdown.exe /s /t $d /c 'Ghost AI: this PC is turning off. Tell Ghost cancel shutdown to stop it.'
      if ($d -le 3) { $res.message = 'Shutting down now.' } else { $res.message = ('The PC will turn off in ' + $d + ' seconds. Say cancel shutdown to stop it.') }
    }
    'restart' {
      $d = 2; if ($c.delay -ne $null) { $d = [int]$c.delay }; if ($d -lt 0 -or $d -gt 3600) { $d = 2 }
      & shutdown.exe /r /t $d /c 'Ghost AI: this PC is restarting. Tell Ghost cancel shutdown to stop it.'
      if ($d -le 3) { $res.message = 'Restarting now.' } else { $res.message = ('The PC will restart in ' + $d + ' seconds. Say cancel shutdown to stop it.') }
    }
    'cancel_shutdown' { & shutdown.exe /a; $res.message = 'Cancelled the shutdown.' }
    'lock' { $res.message = 'Locking the PC.'; $res.after = { Start-Sleep -Seconds 2; rundll32.exe user32.dll,LockWorkStation } }
    'sleep' { $res.message = 'Putting the PC to sleep.'; $res.after = { Start-Sleep -Seconds 3; rundll32.exe powrprof.dll,SetSuspendState 0,1,0 } }
    'open_url' { Start-Process $c.url; $res.message = 'Opened the page.' }
    'open_app' {
      $n = $c.target.ToLower().Trim()
      if ($Sites.ContainsKey($n)) { Start-Process $Sites[$n]; $res.message = ('Opened ' + $c.target + ' in the browser.') }
      elseif ($Apps.ContainsKey($n)) { Start-Process $Apps[$n]; $res.message = ('Opened ' + $c.target + '.') }
      elseif ($Blocked -contains $n) { $res.ok = $false; $res.message = 'I do not open that one.' }
      else {
        try { Start-Process $n -ErrorAction Stop; $res.message = ('Opened ' + $c.target + '.') }
        catch { $res.ok = $false; $res.message = ('I could not find an app called ' + $c.target + '.') }
      }
    }
    'close_app' {
      $k = Close-App $c.target
      if ($k -gt 0) { $res.message = ('Closed ' + $c.target + '.') }
      else { $res.ok = $false; $res.message = ('I could not find ' + $c.target + ' open. A website only closes if it is the tab you are looking at.') }
    }
    'brightness' {
      try {
        $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop
        Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte][int]$c.level } -ErrorAction Stop | Out-Null
        $res.message = ('Brightness is now ' + $c.level + ' percent.')
      } catch { $res.ok = $false; $res.message = 'This screen cannot change brightness from software. Desktop monitors usually cannot; laptops usually can.' }
    }
    'open_folder' {
      $f = @{ 'downloads' = 'shell:Downloads'; 'documents' = 'shell:Personal'; 'desktop' = 'shell:Desktop'; 'pictures' = 'shell:My Pictures'; 'music' = 'shell:My Music'; 'videos' = 'shell:My Video' }
      Start-Process explorer.exe $f[[string]$c.target]
      $res.message = ('Opened the ' + $c.target + ' folder.')
    }
    'list_windows' {
      $t = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.MainWindowTitle } | Select-Object -First 8)
      if ($t.Count -eq 0) { $res.message = 'No windows are open.' } else { $res.message = ('Open windows: ' + ($t -join '; ')) }
      if ($res.message.Length -gt 190) { $res.message = $res.message.Substring(0, 190) }
    }
    'type_text' { Start-Sleep -Milliseconds 800; [System.Windows.Forms.SendKeys]::SendWait((Esc-Keys $c.text)); $res.message = 'Typed it where the cursor is.' }
    'press_key' {
      $k = $c.key
      $n = [int]$c.count
      for ($i = 0; $i -lt $n; $i++) {
        if ($k -eq 'show_desktop') { [GhostKeys]::Combo([byte]0x5B, [byte]0x44) }
        elseif ($WinK.ContainsKey($k)) { [GhostKeys]::Combo([byte]0x5B, [byte]$WinK[$k]) }
        elseif ($VK.ContainsKey($k)) { [GhostKeys]::Tap([byte]$VK[$k]) }
        elseif ($SK.ContainsKey($k)) { [System.Windows.Forms.SendKeys]::SendWait($SK[$k]) }
        Start-Sleep -Milliseconds 60
      }
      $res.message = 'Pressed ' + $k + '.'
    }
    default { $res.ok = $false; $res.message = 'I do not know that action.' }
  }
  return $res
}

# ---------------------------------------------------------------- state
$script:wait = 10000
$script:told = $false
$script:wasLocked = $false
$script:Online = $false
$script:Locked = $false
$script:Quit = $false
$script:Muted = $false
$script:VoiceOn = $true
$script:VoiceOk = $false
$script:VoiceWhy = 'starting'
$script:Mode = ''
$script:Conv = @()
$script:Fails = 0
$script:Heard = ''

# ---------------------------------------------------------------- one check-in with Ghost (also runs commands)
function Poll-Once {
  try {
    $r = Call 'GET' '/api/device' $null
    $script:wait = [int]$r.next
    $script:Online = $true
    if ($r.locked) {
      if (-not $script:wasLocked) { & shutdown.exe /a 2>$null; Say 'EMERGENCY STOP is on. Commands are blocked and any shutdown was cancelled.'; $script:wasLocked = $true }
      $script:Locked = $true
    } else { $script:wasLocked = $false; $script:Locked = $false }
    if (-not $script:told) { Say 'Connected to Ghost.'; $script:told = $true }
    if ($r.cmd) {
      Say ('Command: ' + $r.cmd.action + ' ' + $r.cmd.target + $r.cmd.key + $r.cmd.url)
      $out = $null
      try { $out = Run $r.cmd } catch { $out = @{ ok = $false; message = ('That did not work: ' + $_.Exception.Message); after = $null } }
      Say ($out.message)
      Call 'POST' '/api/device' @{ id = $r.cmd.id; ok = [bool]$out.ok; message = [string]$out.message } | Out-Null
      if ($out.after) { & $out.after }
    }
  } catch {
    $script:wait = 10000
    $script:told = $false
    $script:Online = $false
    Say ('Cannot reach Ghost right now: ' + $_.Exception.Message)
  }
}

# A request that Ghost answers slowly. While it waits, keep checking in, because Ghost may need this very
# helper to run a command before it can answer.
function Call-Slow($body) {
  Add-Type -AssemblyName System.Net.Http
  $client = New-Object System.Net.Http.HttpClient
  try {
    $client.Timeout = [TimeSpan]::FromSeconds(60)
    $client.DefaultRequestHeaders.Add('Authorization', ('Bearer ' + $Key))
    $json = $body | ConvertTo-Json -Compress -Depth 6
    $content = New-Object System.Net.Http.StringContent($json, [System.Text.Encoding]::UTF8, 'application/json')
    $task = $client.PostAsync(($Base + '/api/device'), $content)
    while (-not $task.IsCompleted) {
      Poll-Once
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 500
    }
    $resp = $task.Result
    $txt = $resp.Content.ReadAsStringAsync().Result
    $data = $null
    try { $data = $txt | ConvertFrom-Json } catch { }
    if (-not $resp.IsSuccessStatusCode) {
      $why = 'Ghost answered with an error.'
      if ($data -and $data.error) { $why = [string]$data.error }
      throw $why
    }
    return $data
  } finally { $client.Dispose() }
}

# ---------------------------------------------------------------- the small window (status, mute, emergency stop)
function Set-Startup([bool]$on) {
  $lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Ghost AI PC helper.lnk'
  if ($on) {
    if (-not $env:GHOSTBAT) { return }
    $sh = New-Object -ComObject WScript.Shell
    $s = $sh.CreateShortcut($lnk)
    $s.TargetPath = $env:GHOSTBAT
    $s.WorkingDirectory = Split-Path $env:GHOSTBAT
    $s.WindowStyle = 7
    $s.Save()
  } else {
    if (Test-Path $lnk) { Remove-Item $lnk -Force }
  }
}

function Emergency {
  try { Call 'POST' '/api/device' @{ action = 'stop' } | Out-Null } catch { }
  & shutdown.exe /a 2>$null
  $script:VoiceOn = $false
  $script:Locked = $true
  Say 'EMERGENCY STOP pressed. Ghost can no longer control this PC and the microphone is off.'
}

$script:Form = New-Object System.Windows.Forms.Form
$script:Form.Text = 'Ghost AI - PC helper'
$script:Form.Size = New-Object System.Drawing.Size(380, 330)
$script:Form.StartPosition = 'CenterScreen'
$script:Form.FormBorderStyle = 'FixedDialog'
$script:Form.MaximizeBox = $false
function New-Lbl($text, $y, $h) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $text; $l.Left = 14; $l.Top = $y; $l.Width = 340; $l.Height = $h
  $script:Form.Controls.Add($l)
  return $l
}
$script:LblMic = New-Lbl 'Microphone: starting' 12 22
$script:LblNet = New-Lbl 'Ghost: connecting' 36 22
$script:LblHeard = New-Lbl 'Say "Hey Ghost" and then your command.' 60 40
$script:BtnMute = New-Object System.Windows.Forms.Button
$script:BtnMute.Text = 'Mute microphone'; $script:BtnMute.Left = 14; $script:BtnMute.Top = 108; $script:BtnMute.Width = 340; $script:BtnMute.Height = 36
$script:BtnStop = New-Object System.Windows.Forms.Button
$script:BtnStop.Text = 'EMERGENCY STOP'; $script:BtnStop.Left = 14; $script:BtnStop.Top = 152; $script:BtnStop.Width = 340; $script:BtnStop.Height = 44
$script:BtnStop.BackColor = [System.Drawing.Color]::FromArgb(200, 40, 40); $script:BtnStop.ForeColor = [System.Drawing.Color]::White
$script:ChkStart = New-Object System.Windows.Forms.CheckBox
$script:ChkStart.Text = 'Start Ghost helper with Windows'; $script:ChkStart.Left = 14; $script:ChkStart.Top = 208; $script:ChkStart.Width = 340
$script:ChkStart.Checked = (Test-Path (Join-Path ([Environment]::GetFolderPath('Startup')) 'Ghost AI PC helper.lnk'))
$note = New-Lbl 'Your voice is understood on this PC. Nothing is recorded or sent until you say Hey Ghost, and then only the words you said are sent. Closing this window stops the helper.' 236 58
$script:Form.Controls.AddRange(@($script:BtnMute, $script:BtnStop, $script:ChkStart))
$script:BtnMute.Add_Click({
  if ($script:Muted -or -not $script:VoiceOn) { $script:Muted = $false; $script:VoiceOn = $true } else { $script:Muted = $true }
})
$script:BtnStop.Add_Click({ Emergency })
$script:ChkStart.Add_CheckedChanged({ try { Set-Startup $script:ChkStart.Checked } catch { Say ('Could not change start with Windows: ' + $_.Exception.Message) } })
$script:Form.Add_FormClosing({ $script:Quit = $true })

function Refresh-Window {
  if (-not $script:VoiceOk) { $script:LblMic.Text = 'Microphone: off (' + $script:VoiceWhy + ')' }
  elseif ($script:Locked) { $script:LblMic.Text = 'Microphone: off (emergency stop is on)' }
  elseif ($script:Muted) { $script:LblMic.Text = 'Microphone: MUTED' }
  elseif (-not $script:VoiceOn) { $script:LblMic.Text = 'Wake word: off. Press Unmute to turn it on.' }
  else { $script:LblMic.Text = 'Microphone: listening for "Hey Ghost"' }
  if ($script:Online) { $script:LblNet.Text = 'Ghost: connected' } else { $script:LblNet.Text = 'Ghost: cannot reach it right now' }
  if ($script:Muted -or -not $script:VoiceOn) { $script:BtnMute.Text = 'Unmute microphone' } else { $script:BtnMute.Text = 'Mute microphone' }
  if ($script:Heard) { $script:LblHeard.Text = $script:Heard }
}

# ---------------------------------------------------------------- voice (Windows built-in speech, works offline)
function New-WakeGrammar {
  $ch = New-Object System.Speech.Recognition.Choices
  # similar sounding decoys help the recogniser say no when it is not really "hey ghost"
  foreach ($p in @('hey ghost', 'hey most', 'hey coast', 'hey host', 'hey post', 'hey toast', 'hey boast', 'hey roast')) { $ch.Add($p) }
  $gb = New-Object System.Speech.Recognition.GrammarBuilder
  $gb.Culture = $script:Eng.RecognizerInfo.Culture
  $gb.Append($ch)
  return (New-Object System.Speech.Recognition.Grammar($gb))
}
function Set-Mode([string]$m) {
  if ($script:Mode -eq $m) { return }
  $script:Eng.UnloadAllGrammars()
  if ($m -eq 'wake') { $script:Eng.LoadGrammar((New-WakeGrammar)) } else { $script:Eng.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar)) }
  $script:Mode = $m
}
function Start-Voice {
  try {
    Add-Type -AssemblyName System.Speech
    $info = $null
    foreach ($r in [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()) { if ($r.Culture.Name -like 'en*') { $info = $r; break } }
    if (-not $info) { throw 'Windows has no English speech recogniser installed (Settings > Time and language > Speech)' }
    $script:Eng = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
    $script:Eng.SetInputToDefaultAudioDevice()
    $script:Eng.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(900)
    $script:Eng.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(1200)
    $script:Tts = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $script:VoiceOk = $true
    $script:VoiceWhy = ''
    Say 'Voice is ready. Say Hey Ghost.'
  } catch {
    $script:VoiceOk = $false
    $script:VoiceWhy = [string]$_.Exception.Message
    if ($script:VoiceWhy.Length -gt 90) { $script:VoiceWhy = $script:VoiceWhy.Substring(0, 90) }
    Say ('Voice is off: ' + $_.Exception.Message + ' (remote control from Ghost still works)')
  }
}
function Hear([int]$ms) {
  try {
    $r = $script:Eng.Recognize([TimeSpan]::FromMilliseconds($ms))
    $script:Fails = 0
    return $r
  } catch {
    $script:Fails++
    if ($script:Fails -ge 5) { $script:VoiceOk = $false; $script:VoiceWhy = 'microphone problem'; Say ('Voice stopped: ' + $_.Exception.Message) }
    Start-Sleep -Milliseconds 400
    return $null
  }
}
function Speak([string]$t) {
  $t = ($t -replace '[*#_]', '').Trim()
  if (-not $t) { return }
  if ($t.Length -gt 400) { $t = $t.Substring(0, 400) }
  try { $script:Tts.Speak($t) } catch { }
}
function Confirm-OnPc([string]$what) {
  $script:Form.TopMost = $true
  $ans = [System.Windows.Forms.MessageBox]::Show($script:Form, ('Ghost wants to: ' + $what + [Environment]::NewLine + [Environment]::NewLine + 'Allow it?'), 'Ghost AI - please confirm', 'YesNo', 'Warning', 'Button2')
  $script:Form.TopMost = $false
  return ($ans -eq 'Yes')
}

function Converse {
  $script:Conv = @()
  Say 'Heard "Hey Ghost".'
  Speak "I'm here. What can I do for you?"
  $turn = 0
  while ($script:VoiceOk -and -not $script:Muted -and -not $script:Locked -and -not $script:Quit) {
    Set-Mode 'dict'
    $script:Heard = 'Listening for your command...'
    Refresh-Window; [System.Windows.Forms.Application]::DoEvents()
    $wait = 6000
    if ($turn -eq 0) { $wait = 8000 }
    $r = Hear $wait
    if (-not $r -or -not $r.Text) {
      if ($turn -eq 0) { Speak 'I did not hear anything.' }
      break
    }
    $turn++
    $cmd = $r.Text.Trim()
    $low = $cmd.ToLower().TrimEnd('.', '!', '?')
    $script:Heard = 'You said: ' + $cmd
    Say ('You said: ' + $cmd)
    if ($r.Confidence -lt 0.3) { Speak 'Sorry, I did not catch that.'; continue }
    if ($low -match '^(stop listening|stop listening to me|turn off voice|disable wake word)$') {
      $script:VoiceOn = $false
      Speak 'Okay. Wake-word detection is disabled.'
      break
    }
    if ($low -match '^(emergency stop|stop everything)$') { Emergency; Speak 'Emergency stop. Everything is blocked.'; break }
    if ($low -match '^(never mind|that is all|thank you|thanks|goodbye|bye|go to sleep)$') { Speak 'Okay.'; break }
    try {
      $a = Call-Slow @{ action = 'voice'; text = $cmd; tz = $Tz; history = $script:Conv }
      $said = [string]$a.reply
      $asked = $false
      foreach ($e in @($a.events)) {
        if ($e.type -eq 'confirm') {
          $asked = $true
          Say ('Asking you to confirm: ' + $e.text)
          Speak ('Please confirm on the screen: ' + $e.text)
          if (Confirm-OnPc $e.text) {
            $cr = Call-Slow @{ action = 'confirm'; pid = $e.pid }
            $said = [string]$cr.message
            if ($cr.status -ne 'done') { $said = 'That did not work. ' + $said }
          } else {
            try { Call-Slow @{ action = 'decline'; pid = $e.pid } | Out-Null } catch { }
            $said = 'Okay, cancelled.'
          }
        }
      }
      if (-not $asked -and -not $said) { $said = 'Done.' }
      $script:Heard = 'Ghost: ' + $said
      Say ('Ghost: ' + $said)
      Speak $said
      $script:Conv = @($script:Conv + @(@{ role = 'user'; content = $cmd }, @{ role = 'assistant'; content = $said }))
      if ($script:Conv.Count -gt 8) { $script:Conv = @($script:Conv | Select-Object -Last 8) }
    } catch {
      Say ('Voice command failed: ' + $_.Exception.Message)
      Speak 'Sorry, I could not reach Ghost.'
      break
    }
  }
  $script:Mode = ''
  $script:Heard = 'Say "Hey Ghost" and then your command.'
}

# ---------------------------------------------------------------- go
Say 'Ghost PC helper is running. Ghost can now control this PC. Close this window to stop.'
Start-Voice
$script:Form.Show()
$nextPoll = Get-Date
while (-not $script:Quit) {
  [System.Windows.Forms.Application]::DoEvents()
  if ((Get-Date) -ge $nextPoll) {
    Poll-Once
    $nextPoll = (Get-Date).AddMilliseconds($script:wait)
  }
  Refresh-Window
  if ($script:VoiceOk -and $script:VoiceOn -and -not $script:Muted -and -not $script:Locked) {
    Set-Mode 'wake'
    $w = Hear 250
    if ($w -and $w.Text -eq 'hey ghost' -and $w.Confidence -ge 0.75) { Converse; $nextPoll = Get-Date }
  } else {
    Start-Sleep -Milliseconds 250
  }
}
Say 'Stopped.'
`;

function helperFile(url, key, tz) {
  return HELPER.replace('__URL__', url).replace('__KEY__', key).replace('__TZ__', /^[A-Za-z0-9_\/+-]{1,40}$/.test(String(tz || '')) ? tz : 'UTC').replace(/\r?\n/g, '\r\n');
}

const warm = () => store.set(HOT, '1', 120);
module.exports = { warm, getPhoneKey, resetPhoneKey, phoneSeen, markPhone, whoIs, riskOf, describe, log, history, locked, stopAll, resume, request, confirm, decline, enabled, validate, getKey, resetKey, checkKey, online, push, poll, report, waitResult, helperFile, ACTIONS, KEYS, ID_RE };
