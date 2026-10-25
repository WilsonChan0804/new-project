'use strict';

// ---------- Storage (IndexedDB, on this device only) ----------
const STORES = ['moments', 'events', 'chats', 'messages', 'stickers'];
const dbReady = new Promise((resolve, reject) => {
  const req = indexedDB.open('moments-app', 1);
  req.onupgradeneeded = () => STORES.forEach(s => req.result.createObjectStore(s, { keyPath: 'id' }));
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
function tx(store, mode, fn) {
  return dbReady.then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && r.result);
    t.onerror = () => reject(t.error);
  }));
}
const db = {
  all: s => tx(s, 'readonly', st => st.getAll()),
  put: (s, v) => tx(s, 'readwrite', st => st.put(v)),
  del: (s, id) => tx(s, 'readwrite', st => st.delete(id)),
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- Helpers ----------
const $ = sel => document.querySelector(sel);
const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  kids.flat().forEach(k => k != null && el.append(k));
  return el;
};
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

// Downscale photos so the library and backup files stay a sensible size.
function readImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = h('canvas', { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
async function dataUrlToFile(dataUrl, name) {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], name, { type: blob.type });
}
function download(name, href) {
  const a = h('a', { href, download: name });
  document.body.append(a);
  a.click();
  a.remove();
}

// ---------- Sources: recognise links saved from other apps ----------
const SOURCES = [
  { id: 'instagram', name: 'Instagram', color: '#d62976', match: /instagram\.com/ },
  { id: 'threads', name: 'Threads', color: '#000000', match: /threads\.(net|com)/ },
  { id: 'facebook', name: 'Facebook', color: '#1877f2', match: /(facebook\.com|fb\.watch|fb\.me)/ },
  { id: 'letterboxd', name: 'Letterboxd', color: '#00c030', match: /(letterboxd\.com|boxd\.it)/ },
  { id: 'imdb', name: 'IMDb', color: '#c99a00', match: /imdb\.com/ },
  { id: 'reddit', name: 'Reddit', color: '#ff4500', match: /(reddit\.com|redd\.it)/ },
  { id: 'whatsapp', name: 'WhatsApp', color: '#25d366', match: /(whatsapp\.com|wa\.me)/ },
  { id: 'youtube', name: 'YouTube', color: '#ff0000', match: /(youtube\.com|youtu\.be)/ },
  { id: 'x', name: 'X', color: '#111111', match: /(twitter\.com|x\.com)/ },
  { id: 'tiktok', name: 'TikTok', color: '#25f4ee', match: /tiktok\.com/ },
  { id: 'spotify', name: 'Spotify', color: '#1db954', match: /spotify\.com/ },
];
const detectSource = url => SOURCES.find(s => s.match.test(url)) ||
  (url ? { id: 'web', name: 'Link', color: '#7a726b' } : null);
const extractUrl = text => (text.match(/https?:\/\/\S+/) || [])[0] || '';

// Outgoing share links: these open the other app's own composer.
function shareTargets(m) {
  const text = [m.text, m.link].filter(Boolean).join('\n');
  const enc = encodeURIComponent;
  return [
    ['WhatsApp', `https://wa.me/?text=${enc(text)}`],
    ['Threads', `https://www.threads.net/intent/post?text=${enc(text)}`],
    ['Facebook', m.link ? `https://www.facebook.com/sharer/sharer.php?u=${enc(m.link)}` : null],
    ['Reddit', m.link ? `https://www.reddit.com/submit?url=${enc(m.link)}&title=${enc(m.text || '')}` : null],
    ['X', `https://x.com/intent/post?text=${enc(text)}`],
  ].filter(([, href]) => href);
}

// Native share sheet (iPhone/Mac/Android/Windows): passes photos to Instagram, WhatsApp, Messages, AirDrop…
async function nativeShare({ text = '', url = '', images = [] }) {
  const files = await Promise.all(images.map((src, i) => dataUrlToFile(src, `moment-${i + 1}.${src.startsWith('data:image/png') ? 'png' : 'jpg'}`)));
  const payload = { text: [text, url].filter(Boolean).join('\n') };
  if (files.length && navigator.canShare?.({ files })) payload.files = files;
  if (navigator.share) {
    try { await navigator.share(payload); } catch (e) { if (e.name !== 'AbortError') toast('Share failed'); }
    return;
  }
  await navigator.clipboard?.writeText(payload.text);
  toast('Copied to clipboard');
}

// ---------- Tabs ----------
document.querySelectorAll('.tabs button').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + btn.dataset.view));
  window.scrollTo(0, 0);
}));

// ---------- Timeline ----------
let pendingPhotos = [];
let editingId = null;
$('#c-date').value = today();
SOURCES.forEach(s => $('#filter-source').append(h('option', { value: s.id, textContent: s.name })));

$('#c-photos').addEventListener('change', async e => {
  for (const f of e.target.files) pendingPhotos.push(await readImage(f));
  e.target.value = '';
  renderPreviews();
});
function renderPreviews() {
  $('#c-previews').replaceChildren(...pendingPhotos.map((src, i) =>
    h('img', { src, title: 'Tap to remove', onclick: () => { pendingPhotos.splice(i, 1); renderPreviews(); } })));
}
function resetComposer() {
  $('#composer').reset();
  $('#c-date').value = today();
  pendingPhotos = [];
  editingId = null;
  $('#composer button[type=submit]').textContent = 'Save';
  renderPreviews();
}

$('#composer').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('#c-text').value.trim();
  const link = $('#c-link').value.trim() || extractUrl(text);
  if (!text && !link && !pendingPhotos.length) return toast('Add some text, a link or a photo');
  const existing = editingId && (await db.all('moments')).find(m => m.id === editingId);
  await db.put('moments', {
    id: editingId || uid(),
    created: existing?.created || Date.now(),
    date: $('#c-date').value || today(),
    text, link,
    source: detectSource(link)?.id || null,
    tags: ($('#c-tags').value.match(/#?[\w-]+/g) || []).map(t => t.replace(/^#/, '').toLowerCase()),
    photos: pendingPhotos,
  });
  resetComposer();
  toast('Saved');
  renderTimeline();
  renderCalendar();
});

$('#search').addEventListener('input', () => renderTimeline());
$('#filter-source').addEventListener('change', () => renderTimeline());

async function renderTimeline() {
  const q = $('#search').value.toLowerCase();
  const src = $('#filter-source').value;
  const list = (await db.all('moments'))
    .filter(m => (!src || m.source === src) &&
      (!q || [m.text, m.link, ...m.tags].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);

  $('#timeline').replaceChildren(...(list.length ? list.map(momentCard) :
    [h('p', { className: 'empty', textContent: 'No moments yet. Write one above, or paste a link you want to keep.' })]));
}

function momentCard(m) {
  const s = m.link && detectSource(m.link);
  const actions = h('div', { className: 'actions' },
    h('button', { textContent: '↗ Share', onclick: () => nativeShare({ text: m.text, url: m.link, images: m.photos }) }),
    shareTargets(m).map(([name, href]) => h('button', { textContent: name, onclick: () => window.open(href, '_blank', 'noopener') })),
    h('button', { textContent: 'Edit', onclick: () => editMoment(m) }),
    h('button', { textContent: 'Delete', onclick: async () => {
      if (!confirm('Delete this moment?')) return;
      await db.del('moments', m.id); renderTimeline(); renderCalendar();
    } }),
  );
  return h('article', { className: 'card moment' },
    h('div', { className: 'meta' },
      h('span', { textContent: new Date(m.date + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) }),
      s && h('span', { textContent: s.name })),
    m.text && h('p', { textContent: m.text }),
    m.photos.length ? h('div', { className: 'photos' }, m.photos.map(src => h('img', { src, loading: 'lazy' }))) : null,
    s && h('a', { className: 'link-card', href: m.link, target: '_blank', rel: 'noopener' },
      h('span', { className: 'badge', style: `background:${s.color}`, textContent: s.name.slice(0, 2) }),
      h('div', { style: 'min-width:0' }, h('strong', { textContent: `Open in ${s.name}` }), h('div', { className: 'url', textContent: m.link }))),
    m.tags.length ? h('div', {}, m.tags.map(t => h('span', { className: 'tag', textContent: '#' + t }))) : null,
    actions,
  );
}

function editMoment(m) {
  editingId = m.id;
  $('#c-text').value = m.text;
  $('#c-link').value = m.link;
  $('#c-date').value = m.date;
  $('#c-tags').value = m.tags.map(t => '#' + t).join(' ');
  pendingPhotos = [...m.photos];
  renderPreviews();
  $('#composer button[type=submit]').textContent = 'Update';
  document.querySelector('.tabs button[data-view=timeline]').click();
  $('#c-text').focus();
}

// Content shared into the app (installed web app share target on Android/desktop Chrome, or ?url= links).
(function receiveShare() {
  const p = new URLSearchParams(location.search);
  const url = p.get('url') || extractUrl(p.get('text') || '');
  const text = [p.get('title'), p.get('text')].filter(Boolean).join('\n').replace(url, '').trim();
  if (!url && !text) return;
  $('#c-link').value = url;
  $('#c-text').value = text;
  history.replaceState(null, '', location.pathname);
  toast('Shared link ready — add a note and Save');
})();

// ---------- Calendar ----------
let calMonth = new Date(); calMonth.setDate(1);
let selectedDay = today();
$('#cal-prev').onclick = () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCalendar(); };
$('#cal-next').onclick = () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCalendar(); };

async function renderCalendar() {
  const [moments, events] = await Promise.all([db.all('moments'), db.all('events')]);
  const count = {};
  [...moments, ...events].forEach(x => { count[x.date] = (count[x.date] || 0) + 1; });

  $('#cal-title').textContent = calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const start = new Date(calMonth); start.setDate(1 - ((start.getDay() + 6) % 7)); // weeks start Monday
  const cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => h('div', { className: 'dow', textContent: d }));
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = d.toLocaleDateString('en-CA');
    const cls = [d.getMonth() !== calMonth.getMonth() && 'other', key === today() && 'today', key === selectedDay && 'selected'].filter(Boolean).join(' ');
    cells.push(h('button', { className: cls, onclick: () => { selectedDay = key; renderCalendar(); } },
      String(d.getDate()),
      h('span', { className: 'dots' }, Array.from({ length: Math.min(count[key] || 0, 3) }, () => h('i')))));
  }
  $('#cal-grid').replaceChildren(...cells);

  $('#day-title').textContent = new Date(selectedDay + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const dayEvents = events.filter(e => e.date === selectedDay).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const dayMoments = moments.filter(m => m.date === selectedDay);
  const items = [
    ...dayEvents.map(e => h('div', { className: 'item' },
      h('span', { textContent: `${e.time ? e.time + ' · ' : ''}${e.title}` }),
      h('span', { className: 'actions' },
        h('button', { textContent: '+ Calendar', title: 'Add to Apple/Google/Outlook calendar', onclick: () => exportIcs(e) }),
        h('button', { textContent: '✕', onclick: async () => { await db.del('events', e.id); renderCalendar(); } })))),
    ...dayMoments.map(m => h('div', { className: 'item' },
      h('span', { textContent: '🗂 ' + (m.text || m.link || 'Photo moment').slice(0, 80) }))),
  ];
  $('#day-list').replaceChildren(...(items.length ? items : [h('p', { className: 'hint', textContent: 'Nothing on this day.' })]));
}

$('#event-form').addEventListener('submit', async e => {
  e.preventDefault();
  await db.put('events', { id: uid(), date: selectedDay, time: $('#ev-time').value, title: $('#ev-title').value.trim() });
  e.target.reset();
  renderCalendar();
});

// .ics file opens in Apple Calendar / Outlook / Google Calendar import.
function exportIcs(e) {
  const d = e.date.replace(/-/g, '');
  const when = e.time ? `DTSTART:${d}T${e.time.replace(':', '')}00` : `DTSTART;VALUE=DATE:${d}`;
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Moments//EN', 'BEGIN:VEVENT',
    `UID:${e.id}@moments`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    when, `SUMMARY:${e.title.replace(/[,;]/g, '\\$&')}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  download(`${e.title.slice(0, 30) || 'event'}.ics`, 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics));
}

// ---------- Chat ----------
// Messages are stored locally. Real-time delivery to other people needs a server (see README).
let activeChat = null;
$('#new-chat').addEventListener('submit', async e => {
  e.preventDefault();
  const chat = { id: uid(), name: $('#new-chat-name').value.trim(), created: Date.now() };
  await db.put('chats', chat);
  e.target.reset();
  activeChat = chat.id;
  renderChats();
});

async function renderChats() {
  const chats = (await db.all('chats')).sort((a, b) => b.created - a.created);
  if (!activeChat && chats[0]) activeChat = chats[0].id;
  $('#chat-list').replaceChildren(...chats.map(c => h('li', {
    className: c.id === activeChat ? 'active' : '', textContent: c.name,
    onclick: () => { activeChat = c.id; renderChats(); },
  })));
  const chat = chats.find(c => c.id === activeChat);
  $('#chat-title').textContent = chat ? chat.name : 'Create a chat to start';
  const msgs = chat ? (await db.all('messages')).filter(m => m.chat === chat.id).sort((a, b) => a.at - b.at) : [];
  $('#messages').replaceChildren(...msgs.map(m => h('div', { className: `msg me${m.kind === 'sticker' ? ' sticker' : ''}` },
    m.kind === 'text' ? m.body : h('img', { src: m.body, className: m.kind === 'photo' ? 'photo' : '' }),
    h('time', { textContent: new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }))));
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

async function sendMessage(kind, body) {
  if (!activeChat) return toast('Create a chat first');
  await db.put('messages', { id: uid(), chat: activeChat, kind, body, at: Date.now() });
  renderChats();
}
$('#msg-form').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('#msg-text').value.trim();
  if (text) sendMessage('text', text);
  $('#msg-text').value = '';
});
$('#msg-photo').addEventListener('change', async e => {
  if (e.target.files[0]) sendMessage('photo', await readImage(e.target.files[0], 1200));
  e.target.value = '';
});
$('#toggle-tray').onclick = () => { $('#sticker-tray').hidden = !$('#sticker-tray').hidden; };

// ---------- Sticker maker ----------
const cv = $('#st-canvas');
const ctx = cv.getContext('2d');
const S = 512;
const st = { img: null, x: 0, y: 0, seeds: [] };
const ctrl = id => $('#st-' + id);

ctrl('file').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => { st.img = img; st.x = 0; st.y = 0; st.seeds = []; ctrl('zoom').value = 1; drawSticker(); };
  img.src = URL.createObjectURL(f);
  e.target.value = '';
});
['shape', 'zoom', 'outline', 'caption', 'tol'].forEach(id => ctrl(id).addEventListener('input', () => {
  if (id === 'zoom' || id === 'shape') st.seeds = [];
  ctrl('tol-wrap').hidden = ctrl('shape').value !== 'cutout';
  drawSticker();
}));

// Drag to pan; in cut-out mode a tap erases the connected background colour under the finger.
let drag = null;
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, sx: st.x, sy: st.y, moved: false }; });
cv.addEventListener('pointermove', e => {
  if (!drag) return;
  const k = S / cv.getBoundingClientRect().width;
  const dx = (e.clientX - drag.x) * k, dy = (e.clientY - drag.y) * k;
  if (Math.hypot(dx, dy) > 6) drag.moved = true;
  if (drag.moved) { st.x = drag.sx + dx; st.y = drag.sy + dy; st.seeds = []; drawSticker(); }
});
cv.addEventListener('pointerup', e => {
  if (drag && !drag.moved && ctrl('shape').value === 'cutout' && st.img) {
    const r = cv.getBoundingClientRect();
    st.seeds.push([Math.floor((e.clientX - r.left) * S / r.width), Math.floor((e.clientY - r.top) * S / r.height)]);
    drawSticker();
  }
  drag = null;
});

function shapePath(c, shape, pad) {
  const w = S - pad * 2;
  c.beginPath();
  if (shape === 'circle') c.arc(S / 2, S / 2, w / 2, 0, Math.PI * 2);
  else if (shape === 'rounded') c.roundRect(pad, pad, w, w, w * 0.18);
  else if (shape === 'heart') {
    const x = S / 2, top = pad + w * 0.28, bot = pad + w;
    c.moveTo(x, bot);
    c.bezierCurveTo(pad - w * 0.05, pad + w * 0.6, pad, pad - w * 0.05, x, top);
    c.bezierCurveTo(S - pad, pad - w * 0.05, S - pad + w * 0.05, pad + w * 0.6, x, bot);
  } else c.rect(pad, pad, w, w);
}

function floodErase(data, sx, sy, tol) {
  const p0 = (sy * S + sx) * 4;
  if (data[p0 + 3] === 0) return;
  const [r0, g0, b0] = [data[p0], data[p0 + 1], data[p0 + 2]];
  const seen = new Uint8Array(S * S);
  const stack = [sy * S + sx];
  while (stack.length) {
    const i = stack.pop();
    if (seen[i]) continue;
    seen[i] = 1;
    const p = i * 4;
    if (data[p + 3] === 0 || Math.abs(data[p] - r0) + Math.abs(data[p + 1] - g0) + Math.abs(data[p + 2] - b0) > tol * 3) continue;
    data[p + 3] = 0;
    const x = i % S;
    if (x > 0) stack.push(i - 1);
    if (x < S - 1) stack.push(i + 1);
    if (i >= S) stack.push(i - S);
    if (i < S * S - S) stack.push(i + S);
  }
}

function drawSticker() {
  ctx.clearRect(0, 0, S, S);
  if (!st.img) {
    ctx.fillStyle = getComputedStyle(document.body).color;
    ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Choose a photo to start', S / 2, S / 2);
    return;
  }
  const shape = ctrl('shape').value;
  const outline = +ctrl('outline').value;
  const caption = ctrl('caption').value.trim();
  const pad = outline + 8;

  // 1. Photo, cover-fit, with pan and zoom.
  const body = h('canvas', { width: S, height: S });
  const b = body.getContext('2d');
  const k = Math.max(S / st.img.width, S / st.img.height) * +ctrl('zoom').value;
  const w = st.img.width * k, ht = st.img.height * k;
  b.save();
  if (shape !== 'cutout') { shapePath(b, shape, pad); b.clip(); }
  b.drawImage(st.img, (S - w) / 2 + st.x, (S - ht) / 2 + st.y, w, ht);
  b.restore();
  if (shape === 'cutout' && st.seeds.length) {
    const id = b.getImageData(0, 0, S, S);
    st.seeds.forEach(([x, y]) => floodErase(id.data, x, y, +ctrl('tol').value));
    b.putImageData(id, 0, 0);
  }

  // 2. White die-cut outline: stamp the silhouette in a ring around itself.
  if (outline > 0) {
    const sil = h('canvas', { width: S, height: S });
    const sc = sil.getContext('2d');
    sc.drawImage(body, 0, 0);
    sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = '#fff';
    sc.fillRect(0, 0, S, S);
    for (let a = 0; a < 24; a++) {
      const t = a / 24 * Math.PI * 2;
      ctx.drawImage(sil, Math.cos(t) * outline, Math.sin(t) * outline);
    }
  }
  ctx.drawImage(body, 0, 0);

  // 3. Caption.
  if (caption) {
    ctx.font = '900 64px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#fff';
    ctx.strokeText(caption, S / 2, S - 30, S - 40);
    ctx.fillText(caption, S / 2, S - 30, S - 40);
  }
}

ctrl('save').onclick = async () => {
  if (!st.img) return toast('Choose a photo first');
  await db.put('stickers', { id: uid(), src: cv.toDataURL('image/png'), created: Date.now() });
  toast('Sticker saved');
  renderStickers();
};

async function renderStickers() {
  const list = (await db.all('stickers')).sort((a, b) => b.created - a.created);
  $('#st-library').replaceChildren(...(list.length ? list.map(s => h('figure', {},
    h('img', { src: s.src }),
    h('div', { className: 'actions' },
      h('button', { textContent: '↗', title: 'Share (e.g. to WhatsApp)', onclick: () => nativeShare({ images: [s.src] }) }),
      h('button', { textContent: '⤓', title: 'Download PNG', onclick: () => download('sticker.png', s.src) }),
      h('button', { textContent: '✕', title: 'Delete', onclick: async () => { await db.del('stickers', s.id); renderStickers(); } })))) :
    [h('p', { className: 'hint', textContent: 'Your stickers will appear here.' })]));
  $('#sticker-tray').replaceChildren(...list.map(s => h('img', { src: s.src, onclick: () => sendMessage('sticker', s.src) })));
}

// ---------- Backup to computer ----------
$('#open-backup').onclick = async () => {
  const est = await navigator.storage?.estimate?.();
  const persisted = await navigator.storage?.persisted?.();
  $('#storage-info').textContent = est
    ? `Using ${(est.usage / 1048576).toFixed(1)} MB on this device${persisted ? ' (protected from automatic clean-up)' : ''}.`
    : '';
  $('#backup-dialog').showModal();
};
$('#export').onclick = async () => {
  const data = { app: 'moments', version: 1, exported: new Date().toISOString() };
  for (const s of STORES) data[s] = await db.all(s);
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  download(`moments-backup-${today()}.json`, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('#import').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'moments') throw new Error('Not a Moments backup');
    let n = 0;
    for (const s of STORES) for (const item of data[s] || []) { await db.put(s, item); n++; }
    toast(`Restored ${n} items`);
    renderAll();
  } catch (err) {
    toast('Could not restore: ' + err.message);
  }
});

// ---------- Boot ----------
function renderAll() { renderTimeline(); renderCalendar(); renderChats(); renderStickers(); }
renderAll();
drawSticker();
navigator.storage?.persist?.();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
