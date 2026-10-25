'use strict';
// End-to-end encrypted sync through your own Twofold relay (the Cloudflare Worker in /worker).
// A random 256-bit space key is created on your device and shared only inside the invite link you send.
// From it each device derives: the space id, an access token, and the AES-GCM key that encrypts every record and file.
// The relay stores only encrypted data and can't read any of it.

const SYNCED = new Set(['moments', 'events', 'chats', 'messages', 'stickers', 'lists', 'meals', 'pets', 'petlogs', 'media']);
const BIG = 20000;          // strings longer than this (photos as data URLs) travel as separate encrypted files
const PART = 1_000_000;     // file part size (the relay's SQLite rows hold up to 2 MB)
let cfg = null;             // settings.sync: { code, member, base, seq, members, couple }
let keys = null;            // { space, token, key }
let applying = false, pushing = false, pulling = false, socket = null, retry = 1000, lastSync = 0, syncError = '';
const otherMember = () => (myMember() === 'a' ? 'b' : 'a');

// ---------- Bytes, base64, crypto ----------
const enc = s => new TextEncoder().encode(s);
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(str) { const s = atob(str); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));

async function deriveKeys(code) {
  const base = await crypto.subtle.importKey('raw', unb64url(code), 'HKDF', false, ['deriveBits', 'deriveKey']);
  const params = info => ({ name: 'HKDF', hash: 'SHA-256', salt: enc('twofold-v1'), info: enc(info) });
  const bits = async info => new Uint8Array(await crypto.subtle.deriveBits(params(info), base, 256));
  return {
    space: hex((await bits('space')).slice(0, 16)),
    token: hex(await bits('token')),
    key: await crypto.subtle.deriveKey(params('data'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
  };
}
async function encryptBytes(bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keys.key, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}
async function decryptBytes(bytes) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, keys.key, bytes.subarray(12)));
}
const encryptText = async text => b64(await encryptBytes(enc(text)));
const decryptText = async data => new TextDecoder().decode(await decryptBytes(unb64(data)));
const sha256 = async bytes => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));

// ---------- Relay API ----------
const apiBase = () => cfg?.base || location.origin;
async function api(method, path, body, raw = false) {
  const res = await fetch(`${apiBase()}/api/space/${keys.space}/${path}`, {
    method, headers: { Authorization: `Bearer ${keys.token}`, ...(raw ? {} : { 'Content-Type': 'application/json' }) },
    body: body == null ? undefined : raw ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.json().catch(() => ({}))).error || res.statusText}`);
  return raw === 'blob' ? new Uint8Array(await res.arrayBuffer()) : res.json();
}

// ---------- Local change tracking (wraps the shared db helper) ----------
const rawPut = db.put, rawDel = db.del;
const outbox = (() => { try { return JSON.parse(localStorage.getItem('twofold-outbox') || '[]'); } catch { return []; } })();
const saveOutbox = () => { try { localStorage.setItem('twofold-outbox', JSON.stringify(outbox)); } catch {} };
function queue(kind, id, deletedAt = 0) {
  if (!cfg) return;
  const i = outbox.findIndex(o => o.kind === kind && o.id === id);
  if (i >= 0) outbox.splice(i, 1);
  outbox.push({ kind, id, deletedAt });
  saveOutbox();
  clearTimeout(queue.timer);
  queue.timer = setTimeout(push, 400);
}
db.put = async (s, v) => {
  const track = SYNCED.has(s) && !applying && !(s === 'media' && v.kind === 'break'); // cat-break clips stay on this device
  if (track) v = { ...v, _ts: Date.now() };
  await rawPut(s, v);
  if (track) queue(s, v.id);
  if (s === 'settings' && v.id === 'main' && !applying && cfg) queue('shared', 'couple');
};
db.del = async (s, id) => {
  await rawDel(s, id);
  if (SYNCED.has(s) && !applying) queue(s, id, Date.now());
};

// ---------- Big strings and files go out as encrypted blobs ----------
async function uploadBlob(hash, bytes) {
  const { missing } = await api('POST', 'blobs-missing', [hash]);
  if (!missing.length) return;
  const data = await encryptBytes(bytes);
  const parts = Math.max(1, Math.ceil(data.length / PART));
  for (let p = 0; p < parts; p++) await api('PUT', `blob/${hash}?part=${p}&parts=${parts}`, data.subarray(p * PART, (p + 1) * PART), true);
}
async function externalise(v) {
  if (typeof v === 'string' && v.length > BIG) {
    const bytes = enc(v), hash = await sha256(bytes);
    await uploadBlob(hash, bytes);
    return { __blob: hash, t: 's' };
  }
  if (v instanceof Blob) {
    const bytes = new Uint8Array(await v.arrayBuffer()), hash = await sha256(bytes);
    await uploadBlob(hash, bytes);
    return { __blob: hash, t: 'b', type: v.type };
  }
  if (Array.isArray(v)) return Promise.all(v.map(externalise));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = await externalise(x); return o; }
  return v;
}
const blobCache = new Map();
async function internalise(v) {
  if (v && typeof v === 'object' && v.__blob) {
    if (!blobCache.has(v.__blob)) blobCache.set(v.__blob, decryptBytes(await api('GET', `blob/${v.__blob}`, null, 'blob')));
    const bytes = await blobCache.get(v.__blob);
    return v.t === 's' ? new TextDecoder().decode(bytes) : new Blob([bytes], { type: v.type || '' });
  }
  if (Array.isArray(v)) return Promise.all(v.map(internalise));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = await internalise(x); return o; }
  return v;
}

// ---------- Shared details ----------
// 'member' records (one per person, only ever written by that person): name and picture.
// The 'couple' record: together-since date, special dates, the partner chat and the creator's name for the partner.
function myMemberRecord() { return { name: settings.me || '', avatar: settings.avatars?.me || null }; }
function coupleRecord() {
  return { since: settings.since || '', dates: settings.dates || [], chatId: settings.partnerChat || cfg.couple?.chatId || null,
    partnerName: cfg.couple?.partnerName || (myMember() === 'a' ? settings.them : '') || '' };
}
async function applyMember(id, rec) {
  cfg.members = { ...cfg.members, [id]: rec };
  if (id === myMember()) { settings.me = rec.name || settings.me; settings.avatars = { ...settings.avatars, me: rec.avatar || undefined }; }
  else { settings.them = rec.name || settings.them; settings.avatars = { ...settings.avatars, them: rec.avatar || undefined }; }
}
async function applyCouple(rec) {
  cfg.couple = rec;
  settings.since = rec.since ?? settings.since;
  settings.dates = rec.dates ?? settings.dates;
  if (rec.chatId) settings.partnerChat = rec.chatId;
  if (!cfg.members?.[otherMember()]?.name && myMember() === 'b' && rec.partnerName && !settings.me) settings.me = rec.partnerName;
}
async function saveCfg() { settings.sync = cfg; await rawPut('settings', settings); }

// ---------- Push & pull ----------
async function push() {
  if (!keys || pushing || !navigator.onLine) return;
  pushing = true;
  try {
    while (outbox.length) {
      const batch = outbox.slice(0, 20);
      const changes = [];
      for (const o of batch) {
        if (o.kind === 'shared') {
          const ts = Date.now();
          const mine = myMemberRecord(), couple = coupleRecord();
          if (JSON.stringify(mine) !== JSON.stringify(cfg.members?.[myMember()])) {
            changes.push({ kind: 'member', id: myMember(), ts, data: await encryptText(JSON.stringify(mine)) });
            cfg.members = { ...cfg.members, [myMember()]: mine };
          }
          if (JSON.stringify(couple) !== JSON.stringify(cfg.couple)) {
            changes.push({ kind: 'couple', id: 'couple', ts, data: await encryptText(JSON.stringify(couple)) });
            cfg.couple = couple;
          }
          await saveCfg();
          continue;
        }
        const rec = await db.get(o.kind, o.id);
        if (!rec) { changes.push({ kind: o.kind, id: o.id, ts: o.deletedAt || Date.now(), deleted: true }); continue; }
        if (o.kind === 'media' && rec.kind === 'break') continue;
        const data = await encryptText(JSON.stringify(await externalise(rec)));
        changes.push({ kind: o.kind, id: o.id, ts: rec._ts || 1, data });
      }
      if (changes.length) await api('POST', 'changes', changes);
      outbox.splice(0, batch.length);
      saveOutbox();
    }
    syncError = '';
    lastSync = Date.now();
  } catch (err) {
    syncError = err.message;
    setTimeout(push, 15000);
  } finally {
    pushing = false;
    renderSyncCard();
  }
}

async function pull() {
  if (!keys || pulling || !navigator.onLine) return;
  pulling = true;
  let changed = false, newFromPartner = null;
  try {
    for (let more = true; more;) {
      const res = await api('GET', `changes?since=${cfg.seq || 0}`);
      for (const c of res.changes) {
        if (outbox.some(o => o.kind === c.kind && o.id === c.id)) { cfg.seq = c.seq; continue; } // our newer edit is on its way
        applying = true;
        try {
          if (c.kind === 'member' || c.kind === 'couple') {
            const rec = JSON.parse(await decryptText(c.data));
            if (c.kind === 'member') await applyMember(c.id, rec); else await applyCouple(rec);
            await saveCfg();
            changed = true;
          }
          else if (SYNCED.has(c.kind)) {
            const local = await db.get(c.kind, c.id);
            if (!local || (local._ts || 0) < c.ts) {
              if (c.deleted) { if (local) await rawDel(c.kind, c.id); }
              else {
                const rec = await internalise(JSON.parse(await decryptText(c.data)));
                await rawPut(c.kind, { ...rec, _ts: c.ts });
                if (c.kind === 'messages' && !local && rec.from && rec.from !== myMember()) newFromPartner = rec;
              }
              changed = true;
            }
          }
        } finally { applying = false; }
        cfg.seq = c.seq;
      }
      await saveCfg();
      more = res.more;
    }
    syncError = '';
    lastSync = Date.now();
  } catch (err) {
    syncError = err.message;
  } finally {
    pulling = false;
    if (changed) refresh();
    renderSyncCard();
  }
  if (newFromPartner && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(settings.them || 'Twofold', { body: newFromPartner.kind === 'text' ? newFromPartner.body : T('📷 Photo'), tag: 'twofold-msg' });
  }
}

// Live updates over a WebSocket, with polling as a fallback.
function connect() {
  if (!keys || socket) return;
  const url = `${apiBase().replace(/^http/, 'ws')}/api/space/${keys.space}/ws?t=${keys.token}`;
  try { socket = new WebSocket(url); } catch { socket = null; return; }
  socket.onopen = () => { retry = 1000; pull(); };
  socket.onmessage = e => { if (e.data !== 'pong') pull(); };
  socket.onclose = () => { socket = null; if (keys) setTimeout(connect, retry = Math.min(retry * 2, 30000)); };
}
setInterval(() => { if (keys) { pull(); push(); socket?.readyState === 1 && socket.send('ping'); } }, 45000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && keys) { pull(); push(); if (!socket) connect(); } });
window.addEventListener('online', () => { if (keys) { push(); pull(); } });

// ---------- Create, join, leave ----------
async function relayReachable(base) {
  try { const r = await fetch(`${base}/api/ping`); return r.ok; } catch { return false; }
}
async function start(newCfg) {
  cfg = newCfg;
  keys = await deriveKeys(cfg.code);
  await saveCfg();
  connect();
}
async function createSpace() {
  if (!(await relayReachable(location.origin))) return openSheet(T('Sync needs your Twofold web address'), [],
    h('p', { className: 'sheet-preview', textContent: T('Open Twofold from your Cloudflare address (…workers.dev) to turn on sync. See the README for the 5-minute setup.') }));
  const code = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const k = await deriveKeys(code);
  const res = await fetch(`${location.origin}/api/space`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ space: k.space, token: k.token }) });
  if (!res.ok) return toast((await res.json().catch(() => ({}))).error || T('Could not create the space'));
  if (settings.them) await partnerChat(true);
  await start({ code, member: 'a', base: location.origin, seq: 0 });
  // Upload everything already on this device.
  for (const s of SYNCED) for (const r of await db.all(s)) if (!(s === 'media' && r.kind === 'break')) queue(s, r.id);
  queue('shared', 'couple');
  push();
  renderSyncCard();
  shareInvite();
}
function inviteLink() { return `${apiBase()}${location.pathname.replace(/[^/]*$/, '')}#join=${cfg.code}`; }
function shareInvite() {
  const link = inviteLink();
  openSheet(T('Invite your partner'), [
    { icon: 'share', label: T('Send the invite link'), run: () => nativeShare({ text: T('Join our private Twofold space:'), url: link }) },
    { icon: 'copy', label: T('Copy link'), color: '#3C6E91', run: () => { navigator.clipboard?.writeText(link); toast(T('Copied')); } },
  ], h('p', { className: 'sheet-preview', textContent: T('Anyone with this link can read your space, so only send it to your partner (WhatsApp is fine — it is encrypted) or use it on your own devices.') }));
}

function parseInvite(text) {
  const m = String(text).trim().match(/(?:#join=)?([A-Za-z0-9_-]{43})\s*$/);
  if (!m) return null;
  let base = location.origin;
  try { const u = new URL(text.trim()); if (/^https?:$/.test(u.protocol)) base = u.origin; } catch {}
  return { code: m[1], base };
}
async function joinSpace(text) {
  const inv = parseInvite(text);
  if (!inv) return toast(T('That invite link does not look right'));
  if (cfg?.code === inv.code) return toast(T('This device is already connected'));
  cfg = { code: inv.code, member: null, base: inv.base, seq: 0 };
  keys = await deriveKeys(inv.code);
  toast(T('Connecting…'));
  try { await api('GET', 'changes?since=0'); } catch (err) { cfg = keys = null; return toast(T('Could not join: ') + err.message); }
  // Find out who is who before applying the shared names.
  const first = await api('GET', 'changes?since=0');
  const shared = { members: {}, couple: {} };
  for (const c of first.changes.filter(c => c.kind === 'member' || c.kind === 'couple')) {
    const rec = JSON.parse(await decryptText(c.data));
    if (c.kind === 'member') shared.members[c.id] = rec; else shared.couple = rec;
  }
  chooseMember(shared, async member => {
    await start({ ...cfg, member, seq: 0 });
    for (const s of SYNCED) for (const r of await db.all(s)) if (!(s === 'media' && r.kind === 'break')) queue(s, r.id);
    await pull();
    if (!settings.me) settings.me = shared.members[member]?.name || (member === 'b' ? shared.couple.partnerName : '') || '';
    await rawPut('settings', settings);
    $('#onboard').hidden = !!settings.me;
    if (!settings.me) toast(T('Add your name to finish'));
    queue('shared', 'couple');
    refresh();
    toast(T('Connected — your space is syncing'));
  });
}
function chooseMember(shared, done) {
  const a = shared.members.a?.name, b = shared.members.b?.name || shared.couple.partnerName;
  fill($('#sheet-body'),
    h('h2', { className: 'sheet-title', textContent: T('Who are you on this device?') }),
    h('p', { className: 'sm muted', textContent: T('Your messages and moments will show under this name.') }),
    h('div', { className: 'actions' },
      h('button', { onclick: () => { $('#sheet').close(); done('a'); } }, h('span', { className: 'ico', style: 'background:#E7B8AC;color:#5A2A33', textContent: initial(a || 'A') }), a ? `${T("I'm")} ${a}` : T('The person who created the space')),
      h('button', { onclick: () => { $('#sheet').close(); done('b'); } }, h('span', { className: 'ico', style: 'background:#B9C7D9;color:#23344A', textContent: initial(b || 'B') }), b ? `${T("I'm")} ${b}` : T("I'm the partner who was invited"))));
  $('#sheet').showModal();
}
async function leaveSpace() {
  if (!confirm(T('Stop syncing on this device? Everything stays on this device, and you can join again with the invite link.'))) return;
  keys = null; socket?.close(); socket = null;
  delete settings.sync; cfg = null;
  outbox.splice(0); saveOutbox();
  await rawPut('settings', settings);
  renderSyncCard();
}

// ---------- Settings card ----------
async function renderSyncCard() {
  const card = $('#sync-card');
  if (!card) return;
  if (!cfg) {
    const input = h('input', { placeholder: T('Paste the invite link') });
    return fill(card,
      h('div', { className: 'sec-head' }, h('h2', { textContent: T('🔒 Sync with your partner') })),
      h('p', { className: 'sm muted', textContent: T('Messages, moments, plans, the shopping list and the cat diary sync between both of your phones and computers. Everything is encrypted on your device first, so the server only ever stores scrambled data.') }),
      h('button', { type: 'button', className: 'cta', onclick: createSpace }, icon('lock'), T('Create our private space')),
      h('div', { className: 'inline-form' }, input, h('button', { type: 'button', className: 'pill-btn', textContent: T('Join'), onclick: () => joinSpace(input.value) })));
  }
  let usage = '';
  try { const u = await api('GET', 'usage'); usage = `${(u.bytes / 1048576).toFixed(1)} MB · ${u.records} ${T('items on the server')}`; } catch {}
  const who = `${T('You are')} ${settings.me || (myMember() === 'a' ? 'A' : 'B')}`;
  fill(card,
    h('div', { className: 'sec-head' }, h('h2', { textContent: T('🔒 Sync with your partner') }),
      h('span', { className: 'sync-dot ' + (syncError ? 'err' : socket?.readyState === 1 ? 'on' : 'off') })),
    h('p', { className: 'sm', textContent: [who, syncError ? `${T('Problem')}: ${syncError}` : lastSync ? `${T('Synced')} ${new Date(lastSync).toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' })}` : T('Connecting…'),
      outbox.length ? `${outbox.length} ${T('waiting to send')}` : ''].filter(Boolean).join(' · ') }),
    usage && h('p', { className: 'sm muted', textContent: usage }),
    h('div', { className: 'row' },
      h('button', { type: 'button', className: 'pill-btn', onclick: shareInvite }, icon('share'), T('Invite / add a device')),
      h('button', { type: 'button', className: 'pill-btn', onclick: () => { push(); pull(); } }, T('Sync now')),
      h('button', { type: 'button', className: 'pill-btn danger', onclick: leaveSpace }, T('Disconnect'))));
}

// Invite links open straight into the join flow: …/#join=<code>
function handleInviteHash() {
  const m = location.hash.match(/join=([A-Za-z0-9_-]{43})/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  joinSpace(m[1]);
}

document.addEventListener('DOMContentLoaded', async () => {
  const s = await db.get('settings', 'main');
  if (s?.sync?.code) { cfg = s.sync; keys = await deriveKeys(cfg.code); connect(); push(); }
  renderSyncCard();
  handleInviteHash();
});
renderers.push(renderSyncCard);
