'use strict';

// ---------- Storage (IndexedDB, on this device only) ----------
const STORES = ['moments', 'events', 'chats', 'messages', 'stickers', 'settings', 'lists', 'meals', 'pets', 'petlogs', 'media'];
const dbReady = new Promise((resolve, reject) => {
  const req = indexedDB.open('moments-app', 4);
  req.onupgradeneeded = () => STORES.forEach(s => {
    if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
  });
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
  get: (s, id) => tx(s, 'readonly', st => st.get(id)),
  put: (s, v) => tx(s, 'readwrite', st => st.put(v)),
  del: (s, id) => tx(s, 'readwrite', st => st.delete(id)),
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const getMoments = async () => (await db.all('moments')).map(m => ({ place: '', tags: [], photos: [], videos: [], reactions: [], mood: '', ...m }));

// ---------- Media (videos, voice notes) kept as blobs ----------
const mediaUrls = new Map();
async function putMedia(blob, extra = {}) {
  const id = uid();
  await db.put('media', { id, blob, type: blob.type, created: Date.now(), ...extra });
  return id;
}
async function mediaURL(id) {
  if (!mediaUrls.has(id)) {
    const m = await db.get('media', id);
    if (!m) return '';
    mediaUrls.set(id, URL.createObjectURL(m.blob));
  }
  return mediaUrls.get(id);
}
// A <video>/<audio> element whose source is loaded from the media store.
function mediaEl(tag, id, props = {}) {
  const el = h(tag, { controls: true, preload: 'metadata', playsInline: true, ...props });
  mediaURL(id).then(u => { el.src = u; });
  return el;
}
// First frame of a video as a small JPEG, for tiles and thumbnails.
function videoPoster(blob) {
  return new Promise(resolve => {
    const v = h('video', { muted: true, playsInline: true, preload: 'auto' });
    const url = URL.createObjectURL(blob);
    const done = src => { URL.revokeObjectURL(url); resolve(src); };
    v.onloadeddata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); };
    v.onseeked = () => {
      const k = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
      const c = h('canvas', { width: Math.round(v.videoWidth * k) || 320, height: Math.round(v.videoHeight * k) || 240 });
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      done(c.toDataURL('image/jpeg', 0.8));
    };
    v.onerror = () => done('');
    setTimeout(() => done(''), 8000);
    v.src = url;
  });
}
const thumbOf = m => m.photos?.[0] || m.videos?.[0]?.poster || '';

// ---------- Helpers ----------
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  kids.flat(Infinity).forEach(k => k != null && k !== false && el.append(k));
  return el;
};
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));
const icon = name => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.innerHTML = `<use href="#i-${name}"/>`;
  return s;
};
const roundBtn = (name, label, onclick, cls = 'plain') => h('button', { className: `round ${cls}`, type: 'button', ariaLabel: label, title: label, onclick }, icon(name));

const DAY = 86400000;
const isoDate = d => d.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
const today = () => isoDate(new Date());
const parseDate = s => new Date(s + 'T00:00');
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / DAY);
const fmtDate = (s, opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) => parseDate(s).toLocaleDateString(LOCALE, opts);
const initial = name => (name || '?').trim().charAt(0).toUpperCase() || '?';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Pastel tiles from the design, picked consistently per item.
const PASTELS = [['#E7B8AC', '#4A1F28'], ['#C9D3C0', '#26331F'], ['#B9C7D9', '#23344A'], ['#E5D3B3', '#4A3A1F'], ['#D8C1D6', '#3E2441'], ['#F0CDBF', '#4A2A1F']];
const pastel = id => PASTELS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % PASTELS.length];
const tileVars = id => { const [bg, fg] = pastel(id); return `--tile-bg:${bg};--tile-fg:${fg}`; };

function toast(msg, action) {
  const t = $('#toast');
  t.textContent = msg;
  t.onclick = action ? () => { t.classList.remove('show'); action.run(); } : null;
  t.classList.toggle('actionable', !!action);
  if (action) t.append(h('b', { textContent: action.label }));
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), action ? 4500 : 2200);
}

// Downscale photos so the library and backup files stay a sensible size.
// Tries createImageBitmap first (handles large photos and orientation), then a plain <img>.
async function readImage(file, max = 1600) {
  const toJpeg = (src, w, hgt) => {
    const k = Math.min(1, max / Math.max(w, hgt));
    const c = h('canvas', { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(hgt * k)) });
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; // transparent PNGs would otherwise turn black as JPEG
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(src, 0, 0, c.width, c.height);
    const px = x.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < px.length; i += 4 * 97) if (px[i] + px[i + 1] + px[i + 2] > 30) lit++;
    return lit ? c.toDataURL('image/jpeg', 0.85) : null; // all black = drawing failed
  };
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const out = toJpeg(bmp, bmp.width, bmp.height);
    bmp.close?.();
    if (out) return out;
  } catch {}
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const out = toJpeg(img, img.naturalWidth, img.naturalHeight);
    if (out) return out;
  } catch {} finally { URL.revokeObjectURL(url); }
  const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
  toast(heic ? 'This browser cannot open HEIC photos. Use Safari, or export the photo as JPEG.' : `Could not open ${file.name}`);
  throw new Error('unreadable image');
}
const isVideoFile = f => f.type.startsWith('video/') || /\.(mov|mp4|m4v|webm|3gp)$/i.test(f.name);
function loadScript(src) {
  return new Promise((resolve, reject) => document.head.append(h('script', { src, onload: resolve, onerror: () => reject(new Error('Could not load ' + src)) })));
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

// Dialogs: close buttons and tapping the backdrop.
$$('dialog').forEach(d => d.addEventListener('click', e => {
  if (e.target === d || e.target.closest('[data-close]')) d.close();
}));

// Segmented controls that switch between panes.
function bindSeg(seg, onPick) {
  seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    onPick(b);
  }));
}
const pickSeg = (seg, attr, value) => seg.querySelector(`[${attr}="${value}"]`)?.click();

// ---------- Theme ----------
const themePref = () => { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } };
function applyTheme(pref = themePref()) {
  try { localStorage.setItem('theme', pref); } catch {}
  const dark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]').content = dark ? '#141113' : '#FFFCF7';
  $$('#s-theme button').forEach(b => b.classList.toggle('on', b.dataset.v === pref));
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
$$('#s-theme button').forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.v)));

// ---------- Sources: recognise links saved from other apps ----------
const SOURCES = [
  { id: 'instagram', name: 'Instagram', color: '#d62976', match: /instagram\.com/ },
  { id: 'threads', name: 'Threads', color: '#101010', match: /threads\.(net|com)/ },
  { id: 'facebook', name: 'Facebook', color: '#1877f2', match: /(facebook\.com|fb\.watch|fb\.me)/ },
  { id: 'letterboxd', name: 'Letterboxd', color: '#00b020', match: /(letterboxd\.com|boxd\.it)/ },
  { id: 'imdb', name: 'IMDb', color: '#c99a00', match: /imdb\.com/ },
  { id: 'reddit', name: 'Reddit', color: '#ff4500', match: /(reddit\.com|redd\.it)/ },
  { id: 'whatsapp', name: 'WhatsApp', color: '#25d366', match: /(whatsapp\.com|wa\.me)/ },
  { id: 'youtube', name: 'YouTube', color: '#ff0000', match: /(youtube\.com|youtu\.be)/ },
  { id: 'x', name: 'X', color: '#111111', match: /(twitter\.com|x\.com)/ },
  { id: 'tiktok', name: 'TikTok', color: '#111111', match: /tiktok\.com/ },
  { id: 'spotify', name: 'Spotify', color: '#1db954', match: /spotify\.com/ },
];
const detectSource = url => !url ? null : SOURCES.find(s => s.match.test(url)) || { id: 'web', name: 'Link', color: '#75656A' };
const extractUrl = text => (text.match(/https?:\/\/\S+/) || [])[0] || '';

// Outgoing share links: these open the other app's own composer.
function shareTargets(m) {
  const text = [m.text, m.link].filter(Boolean).join('\n');
  const enc = encodeURIComponent;
  return [
    ['whatsapp', `https://wa.me/?text=${enc(text)}`],
    ['threads', `https://www.threads.net/intent/post?text=${enc(text)}`],
    ['facebook', m.link && `https://www.facebook.com/sharer/sharer.php?u=${enc(m.link)}`],
    ['reddit', m.link && `https://www.reddit.com/submit?url=${enc(m.link)}&title=${enc(m.text || '')}`],
    ['x', `https://x.com/intent/post?text=${enc(text)}`],
  ].filter(([, href]) => href).map(([id, href]) => [SOURCES.find(s => s.id === id), href]);
}

// Native share sheet (iPhone/Mac/Android/Windows): passes photos to Instagram, WhatsApp, Messages, AirDrop…
async function nativeShare({ text = '', url = '', images = [], videos = [] }) {
  const files = await Promise.all(images.map((src, i) => dataUrlToFile(src, `moment-${i + 1}.${src.startsWith('data:image/png') ? 'png' : 'jpg'}`)));
  for (const v of videos) { const m = await db.get('media', v.id); if (m) files.push(new File([m.blob], `video-${files.length + 1}.${(m.type.split('/')[1] || 'mp4').split(';')[0]}`, { type: m.type })); }
  const payload = { text: [text, url].filter(Boolean).join('\n') };
  if (files.length && navigator.canShare?.({ files })) payload.files = files;
  if (navigator.share) {
    try { await navigator.share(payload); return true; } catch (e) { return e.name === 'AbortError'; }
  }
  await navigator.clipboard?.writeText(payload.text);
  toast('Copied to clipboard');
  return true;
}

// ---------- Navigation ----------
function go(view) {
  $$('.tabs [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  document.body.dataset.view = view;
  if (view === 'chat') enterChat();
  window.scrollTo(0, 0);
}
$$('.tabs [data-view]').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
$$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
document.body.dataset.view = 'home';

// ---------- Settings & onboarding ----------
let settings = { id: 'main', me: '', them: '', since: '', dates: [] };
let draftDates = [];
const partner = () => settings.them || 'your person';

// ---------- Avatars: photo, emoji on a colour, or initial ----------
function avatarEl(spec, name, cls = '') {
  const el = h('div', { className: `av ${cls}` });
  if (spec?.photo) { el.classList.add('has-photo'); el.append(h('img', { src: spec.photo, alt: '' })); }
  else if (spec?.emoji) { el.classList.add('emoji'); el.style.background = spec.bg || '#F7F1EA'; el.textContent = spec.emoji; }
  else el.textContent = initial(name);
  return el;
}
function avatar(who, extra = '') {
  return avatarEl(settings.avatars?.[who], who === 'me' ? settings.me : settings.them, `${who} ${extra}`);
}
const AVATAR_EMOJI = ['🐱', '😺', '😸', '😻', '🐈', '🐈‍⬛', '🐾', '🐶', '🐰', '🐻', '🐼', '🦊', '🐯', '🐹', '🐧', '🐥', '👩', '👨', '🧑', '👧', '👦', '👩🏻', '👨🏻', '💁‍♀️', '🙋‍♂️', '🧕', '👸', '🤴', '😊', '😎', '🥰', '🤓', '❤️', '🌸', '🌻', '⭐', '🍓', '🍜', '☕', '🎧'];
const AVATAR_BG = ['#E7B8AC', '#C9D3C0', '#B9C7D9', '#E5D3B3', '#D8C1D6', '#F0CDBF', '#C2415B', '#2A1E22', '#FFFFFF'];
async function openAvatarEditor(title, spec, name, onSave) {
  let mode = spec?.photo ? 'photo' : spec?.emoji ? 'emoji' : 'photo';
  let emoji = spec?.emoji || '🐱', bg = spec?.bg || AVATAR_BG[0];
  let img = null, zoom = 1, ox = 0, oy = 0;
  if (spec?.photo) { img = new Image(); img.src = spec.photo; await img.decode().catch(() => {}); }
  const cv = h('canvas', { width: 512, height: 512, className: 'av-canvas' });
  const draw = () => {
    const c = cv.getContext('2d');
    c.clearRect(0, 0, 512, 512);
    if (mode === 'emoji') {
      c.fillStyle = bg; c.beginPath(); c.arc(256, 256, 256, 0, 7); c.fill();
      c.font = '300px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(emoji, 256, 280);
    } else if (img) {
      c.save(); c.beginPath(); c.arc(256, 256, 256, 0, 7); c.clip();
      const k = Math.max(512 / img.width, 512 / img.height) * zoom;
      c.drawImage(img, 256 - img.width * k / 2 + ox, 256 - img.height * k / 2 + oy, img.width * k, img.height * k);
      c.restore();
    } else {
      c.fillStyle = '#F7F1EA'; c.beginPath(); c.arc(256, 256, 256, 0, 7); c.fill();
      c.fillStyle = '#75656A'; c.font = '600 40px Inter,sans-serif'; c.textAlign = 'center'; c.fillText(T('Choose a photo'), 256, 268);
    }
  };
  // Drag to position the photo inside the circle.
  let drag = null;
  cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, ox, oy }; };
  cv.onpointermove = e => { if (!drag || mode !== 'photo') return; const k = 512 / cv.getBoundingClientRect().width; ox = drag.ox + (e.clientX - drag.x) * k; oy = drag.oy + (e.clientY - drag.y) * k; draw(); };
  cv.onpointerup = () => { drag = null; };
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    img = new Image(); img.src = await readImage(f, 1200); await img.decode(); zoom = 1; ox = oy = 0; mode = 'photo'; render();
  } });
  const stickers = await db.all('stickers');
  const render = () => {
    fill($('#sheet-body'),
      h('h2', { className: 'sheet-title', textContent: title }),
      h('div', { className: 'av-editor' }, cv,
        h('div', { className: 'seg two' },
          h('button', { type: 'button', className: mode === 'photo' ? 'on' : '', textContent: 'Photo', onclick: () => { mode = 'photo'; render(); } }),
          h('button', { type: 'button', className: mode === 'emoji' ? 'on' : '', textContent: 'Emoji', onclick: () => { mode = 'emoji'; render(); } })),
        mode === 'photo' ? [
          h('div', { className: 'row' }, h('label', { className: 'pill-btn' }, file, icon('image'), img ? 'Change photo' : 'Choose photo'),
            img && h('label', { className: 'field grow' }, h('span', { textContent: 'Zoom' }),
              h('input', { type: 'range', min: 1, max: 4, step: 0.05, value: zoom, oninput: e => { zoom = +e.target.value; draw(); } }))),
          stickers.length ? h('div', { className: 'field' }, h('span', { textContent: 'Or use a sticker' }),
            h('div', { className: 'av-stickers' }, stickers.slice(0, 24).map(st => h('img', { src: st.src, alt: 'Sticker', onclick: async () => { img = new Image(); img.src = st.src; await img.decode(); zoom = 1; ox = oy = 0; draw(); } })))) : null,
        ] : [
          h('div', { className: 'emoji-grid' }, AVATAR_EMOJI.map(e => h('button', { type: 'button', className: e === emoji ? 'on' : '', textContent: e, onclick: () => { emoji = e; render(); } }))),
          h('div', { className: 'swatches' }, AVATAR_BG.map(c => h('button', { type: 'button', className: c === bg ? 'on' : '', style: `background:${c}`, ariaLabel: c, onclick: () => { bg = c; render(); } }))),
        ],
        h('div', { className: 'row' },
          h('button', { type: 'button', className: 'pill-btn', textContent: 'Use initial', onclick: async () => { await onSave(null); $('#sheet').close(); } }),
          h('button', { type: 'button', className: 'cta grow', textContent: 'Save', onclick: async () => {
            if (mode === 'photo' && !img) return toast('Choose a photo first');
            const out = h('canvas', { width: 256, height: 256 });
            out.getContext('2d').drawImage(cv, 0, 0, 256, 256);
            await onSave(mode === 'emoji' ? { emoji, bg } : { photo: out.toDataURL('image/png') });
            $('#sheet').close();
          } }))));
    draw();
  };
  render();
  $('#sheet').showModal();
}
function editMyAvatar(who) {
  const name = who === 'me' ? settings.me : settings.them;
  openAvatarEditor(who === 'me' ? 'Your picture' : `${name || 'Partner'}'s picture`, settings.avatars?.[who], name, async spec => {
    settings.avatars = { ...settings.avatars, [who]: spec };
    await db.put('settings', settings);
    refresh();
  });
}

bindSeg($('#ob-seg'), b => {
  $$('.ob-pane').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.pane; });
  $('#ob-go').textContent = b.dataset.pane === 'fresh' ? 'Create our space' : 'Choose backup file';
  $('#ob-go').setAttribute('form', b.dataset.pane === 'fresh' ? 'ob-form' : '');
});
$('#ob-go').addEventListener('click', e => {
  if ($('#ob-go').getAttribute('form')) return; // submits the form
  e.preventDefault();
  $('#ob-import').click();
});
$('#ob-me').addEventListener('input', () => { $('#ob-av').textContent = initial($('#ob-me').value); });
$('#ob-form').addEventListener('submit', async e => {
  e.preventDefault();
  settings = { ...settings, me: $('#ob-me').value.trim(), them: $('#ob-them').value.trim(), since: $('#ob-since').value };
  await db.put('settings', settings);
  if (settings.them) await partnerChat(true);
  $('#onboard').hidden = true;
  refresh();
});
$('#ob-import').addEventListener('change', e => importBackup(e.target));

function loadSettingsForm() {
  $('#s-me').value = settings.me;
  $('#s-them').value = settings.them;
  $('#s-since').value = settings.since;
  draftDates = [...settings.dates];
  renderDraftDates();
  applyTheme();
  navigator.storage?.estimate?.().then(est => {
    $('#storage-info').textContent = `Using ${(est.usage / 1048576).toFixed(1)} MB on this device.`;
  });
}
function renderDraftDates() {
  fill($('#s-dates'), draftDates.map(d => h('div', {},
    h('span', { textContent: `${d.title} · ${fmtDate(d.date, { month: 'long', day: 'numeric' })}` }),
    roundBtn('trash', 'Remove', () => { draftDates = draftDates.filter(x => x !== d); renderDraftDates(); }))));
}
$('#s-date-add').onclick = () => {
  const title = $('#s-date-title').value.trim(), date = $('#s-date-date').value;
  if (!title || !date) return toast('Add a name and a date');
  draftDates.push({ id: uid(), title, date });
  $('#s-date-title').value = $('#s-date-date').value = '';
  renderDraftDates();
};
$$('#s-lang button').forEach(b => { b.classList.toggle('on', b.dataset.v === LANG); b.onclick = () => setLanguage(b.dataset.v); });
$('#settings-form').addEventListener('submit', async e => {
  e.preventDefault();
  settings = { ...settings, me: $('#s-me').value.trim(), them: $('#s-them').value.trim(), since: $('#s-since').value, dates: draftDates };
  await db.put('settings', settings);
  toast('Saved');
  refresh();
});

// Next yearly occurrence of a date, on or after today.
function nextOccurrence(dateStr) {
  const t = today(), [, mm, dd] = dateStr.split('-');
  let y = +t.slice(0, 4);
  if (`${y}-${mm}-${dd}` < t) y++;
  return `${y}-${mm}-${dd}`;
}
// Other modules (shopping, pets) add their own calendar items and countdowns here.
const calendarSources = [];
const upcomingSources = [];
async function upcoming() {
  const t = today();
  const events = await db.all('events');
  const list = [
    ...(await Promise.all(upcomingSources.map(f => f()))).flat().filter(u => u.date >= t),
    ...settings.dates.map(d => ({ label: d.title, date: nextOccurrence(d.date) })),
    ...events.filter(e => e.date >= t).map(e => ({ label: e.title, date: e.date })),
  ];
  if (settings.since) {
    if (settings.since.slice(5) !== t.slice(5) || settings.since < t) list.push({ label: 'Anniversary', date: nextOccurrence(settings.since) });
    const n = daysBetween(settings.since, t) + 1;
    const milestone = Math.ceil((n + 1) / 100) * 100;
    list.push({ label: `Day ${milestone.toLocaleString()}`, date: isoDate(new Date(parseDate(settings.since).getTime() + (milestone - 1) * DAY)) });
  }
  return list.sort((a, b) => a.date.localeCompare(b.date));
}
const daysTogether = () => settings.since ? daysBetween(settings.since, today()) + 1 : 0;

// ---------- Home ----------
const PROMPTS = [
  'Share something that made you smile today', 'Show what you are eating right now', 'Capture the view from where you are',
  'Share something that reminded you of them', 'Show a tiny detail you noticed today', 'Share what you are listening to',
  'Capture your favourite corner of today', 'Share something you are grateful for', 'Show the sky above you right now',
  'Share a film, show or post you loved lately', 'Capture something that made you laugh', 'Share a place you want to go together',
];
const promptToday = () => PROMPTS[Math.floor(Date.now() / DAY) % PROMPTS.length];

async function renderHome() {
  const moments = await getMoments();
  const now = new Date(), hr = now.getHours();
  $('#greet-time').textContent = `${now.toLocaleDateString(LOCALE, { weekday: 'long' })} ${hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening'}`;
  $('#greet').textContent = `Hi, ${settings.me || 'there'}`;
  fill($('#duo'), avatar('me'), settings.them && avatar('them'));

  // Hero: days together and the next countdown.
  const next = (await upcoming())[0];
  const n = daysTogether();
  const nextIn = next && daysBetween(today(), next.date);
  fill($('#hero'),
    h('div', { className: 'top' },
      h('div', {},
        h('span', { className: 'names', textContent: settings.them ? `${settings.me} & ${settings.them}` : settings.me }),
        h('span', { className: 'big', textContent: n ? `${n.toLocaleString()} ${n === 1 ? 'day' : 'days'}` : plural(moments.length, 'moment') }),
        h('span', { textContent: n ? 'together' : 'saved so far' })),
      icon('heart')),
    next ? h('button', { className: 'bar', onclick: () => openCalendarOn(next.date) },
      h('span', { textContent: `${next.label} ${nextIn === 0 ? 'is today' : nextIn === 1 ? 'is tomorrow' : `in ${nextIn} days`}` }), h('b', { textContent: 'Plan it' })) :
      h('button', { className: 'bar', onclick: () => openUs('settings') },
        h('span', { textContent: 'Add your anniversary and birthdays' }), h('b', { textContent: 'Add' })),
  );

  // Partner card: last message and a one-tap nudge.
  if (settings.them) {
    const chat = await partnerChat();
    const msgs = chat ? (await db.all('messages')).filter(m => m.chat === chat.id).sort((a, b) => b.at - a.at) : [];
    const last = msgs[0];
    fill($('#status'),
      avatar('them'),
      h('div', { className: 't', style: 'cursor:pointer', onclick: () => go('chat') },
        h('strong', { textContent: `Send ${settings.them} some love` }),
        h('span', { textContent: last ? `You: ${last.kind === 'text' ? last.body : last.kind} · ${new Date(last.at).toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' })}` : 'Tap the heart to send a nudge' })),
      roundBtn('heart', `Send ${settings.them} a nudge`, async () => {
        const c = await partnerChat(true);
        await db.put('messages', { id: uid(), chat: c.id, kind: 'text', body: '❤️', at: Date.now() });
        toast(`Sent ${settings.them} a nudge`);
        renderHome();
      }, 'tint'));
  } else {
    fill($('#status'),
      h('div', { className: 'av plus' }, icon('plus')),
      h('div', { className: 't' }, h('strong', { textContent: 'Add your person' }), h('span', { textContent: 'Partner, best friend or family' })),
      roundBtn('next', 'Open settings', () => openUs('settings'), 'tint'));
  }

  // Today's moment prompt.
  const sharedToday = moments.filter(m => m.date === today()).length;
  fill($('#today'),
    h('div', { style: 'display:flex;flex-direction:column;gap:4px' },
      h('span', { className: 'kicker', textContent: "Today's moment" }),
      h('span', { className: 'today-q', textContent: promptToday() })),
    h('div', { className: 'today-row' },
      h('span', { className: 'sm muted', textContent: sharedToday ? `You shared ${plural(sharedToday, 'moment')} today` : `Nothing shared yet today${settings.them ? ` · ${settings.them} will love it` : ''}` }),
      h('button', { className: 'inv-btn', textContent: 'Capture', onclick: () => openComposer({ prompt: promptToday(), camera: true }) })),
  );

  // Recent moments.
  const recent = [...moments].sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created).slice(0, matchMedia('(min-width: 900px)').matches ? 4 : 3);
  fill($('#recent'), recent.length ? recent.map(m => {
    const photo = thumbOf(m);
    return h('button', { className: 'tile' + (photo ? ' has-img' : ''), style: tileVars(m.id), onclick: () => openDetail(m) },
      photo && h('img', { src: photo, alt: '' }),
      m.videos.length ? h('span', { className: 'play-badge' }, icon('play')) : null,
      h('span', { textContent: caption(m) }));
  }) : [h('p', { className: 'sm muted', style: 'grid-column:1/-1', textContent: 'Your moments will show up here. Tap + to share the first one.' })]);
}
const caption = m => (m.text || '').split('\n')[0] || (m.link && detectSource(m.link).name) || m.place || 'A moment';

// ---------- Composer ----------
const MOODS = ['Happy', 'Grateful', 'Missing you', 'Cozy', 'Adventurous'];
let pendingPhotos = [];
let pendingVideos = []; // { id?, blob?, poster }
let editingId = null;
let mood = '';

let composerSaved = null; // optional callback after saving (e.g. mark chat messages as saved)
function openComposer({ moment = null, photos = [], videos = [], link = '', text = '', prompt = '', camera = false, tags = [], onSaved = null } = {}) {
  composerSaved = onSaved;
  $('#composer').reset();
  editingId = moment?.id || null;
  $('#composer-title').textContent = moment ? 'Edit moment' : 'New moment';
  $('#c-text').value = moment?.text ?? text;
  $('#c-text').placeholder = prompt || 'What made this moment special?';
  $('#c-link').value = moment?.link ?? link;
  $('#c-place').value = moment?.place ?? '';
  $('#c-date').value = moment?.date ?? today();
  $('#c-tags').value = (moment?.tags || tags).map(t => '#' + t).join(' ');
  $('#c-more').open = !!(moment?.link || moment?.place || moment?.tags?.length || link || tags.length);
  mood = moment?.mood || '';
  pendingPhotos = moment ? [...moment.photos] : photos;
  pendingVideos = moment ? [...(moment.videos || [])] : videos;
  $('#c-stage').style.cssText = tileVars(editingId || 'new');
  renderMoods();
  renderStage();
  showSource();
  updateSubmit();
  $('#composer-dialog').showModal();
  if (camera && !pendingPhotos.length && matchMedia('(pointer: coarse)').matches) $('#c-camera').click();
}
$('#fab').onclick = () => openComposer();
$('#m-add').onclick = () => openComposer();

function renderMoods() {
  fill($('#c-moods'), MOODS.map(m => h('button', {
    type: 'button', className: 'chip' + (m === mood ? ' on' : ''), textContent: m, ariaPressed: String(m === mood),
    onclick: () => { mood = mood === m ? '' : m; renderMoods(); },
  })));
}
function renderStage() {
  const total = pendingPhotos.length + pendingVideos.length;
  $('#c-empty').hidden = total > 0;
  $('#c-add-label').textContent = total ? '+ Add more' : 'Photos / videos';
  const count = i => total > 1 && h('span', { className: 'count', textContent: `${i + 1} / ${total}` });
  fill($('#c-photos-view'),
    pendingPhotos.map((src, i) => h('figure', {},
      h('img', { src, alt: '' }), count(i),
      h('button', { type: 'button', ariaLabel: 'Remove photo', onclick: () => { pendingPhotos.splice(i, 1); renderStage(); } }, icon('x')))),
    pendingVideos.map((v, i) => {
      const vid = h('video', { controls: true, playsInline: true, preload: 'metadata', poster: v.poster || '' });
      if (v.blob) vid.src = URL.createObjectURL(v.blob); else mediaURL(v.id).then(u => { vid.src = u; });
      return h('figure', {}, vid, count(pendingPhotos.length + i),
        h('button', { type: 'button', ariaLabel: 'Remove video', onclick: () => { pendingVideos.splice(i, 1); renderStage(); } }, icon('x')));
    }));
}
async function addPhotos(e) {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) {
    try {
      if (isVideoFile(f)) {
        if (f.size > 300 * 1048576) { toast(`${f.name} is over 300 MB — please trim it first`); continue; }
        pendingVideos.push({ blob: f, poster: await videoPoster(f) });
      } else pendingPhotos.push(await readImage(f));
    } catch {}
    renderStage();
  }
}
$('#c-photos').addEventListener('change', addPhotos);
$('#c-camera').addEventListener('change', addPhotos);
function showSource() {
  const s = detectSource($('#c-link').value.trim());
  $('#c-source').textContent = s ? `Saved from ${s.name}` : '';
}
$('#c-link').addEventListener('input', showSource);
function updateSubmit() {
  $('#c-share-sub').textContent = `Opens WhatsApp, Instagram or Messages${settings.them ? ` to send to ${settings.them}` : ''}`;
  $('#c-submit span').textContent = $('#c-share').checked ? `Save & share${settings.them ? ` with ${settings.them}` : ''}` : (editingId ? 'Save changes' : 'Save moment');
}
$('#c-share').addEventListener('change', updateSubmit);

$('#composer').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('#c-text').value.trim();
  const link = $('#c-link').value.trim() || extractUrl(text);
  if (!text && !link && !pendingPhotos.length && !pendingVideos.length) return toast('Add a photo, a video, a caption or a link');
  const existing = editingId && await db.get('moments', editingId);
  const videos = [];
  for (const v of pendingVideos) videos.push(v.id ? { id: v.id, poster: v.poster } : { id: await putMedia(v.blob, { kind: 'video' }), poster: v.poster });
  for (const old of existing?.videos || []) if (!videos.some(v => v.id === old.id)) await db.del('media', old.id);
  const m = {
    ...existing,
    id: editingId || uid(),
    created: existing?.created || Date.now(),
    date: $('#c-date').value || today(),
    text, link, mood,
    source: detectSource(link)?.id || null,
    place: $('#c-place').value.trim(),
    tags: [...new Set(($('#c-tags').value.match(/[\w-]+/g) || []).map(t => t.toLowerCase()))],
    photos: pendingPhotos,
    videos,
    reactions: existing?.reactions || [],
  };
  // Start the share first so it still counts as a direct response to the tap.
  const shared = $('#c-share').checked ? nativeShare({ text: m.text, url: m.link, images: m.photos, videos }) : null;
  await db.put('moments', m);
  await composerSaved?.(m);
  composerSaved = null;
  $('#composer-dialog').close();
  toast(editingId ? 'Updated' : 'Saved to your moments');
  refresh();
  if (shared && !(await shared)) openDetail(m);
});

// Content shared into the app (installed web app share target on Android/desktop Chrome, or ?url= links).
function receiveShare() {
  const p = new URLSearchParams(location.search);
  const url = p.get('url') || extractUrl(p.get('text') || '');
  const text = [p.get('title'), p.get('text')].filter(Boolean).join('\n').replace(url, '').trim();
  if (!url && !text) return;
  history.replaceState(null, '', location.pathname);
  openComposer({ link: url, text });
}

// ---------- Moments ----------
const REACTIONS = ['❤️', '😂', '😮', '🥹', '🔥'];
let filter = 'all';
let memoryPick = null;
bindSeg($('#m-filter'), b => { filter = b.dataset.f; renderMoments(); });
$('#search-toggle').onclick = () => {
  const w = $('#search-wrap');
  w.hidden = !w.hidden;
  if (w.hidden) { $('#search').value = ''; renderMoments(); } else $('#search').focus();
};
$('#search').addEventListener('input', () => renderMoments());

function dayLabel(d) {
  const n = daysBetween(d, today());
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  return fmtDate(d, d.slice(0, 4) === today().slice(0, 4) ? { weekday: 'long', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

async function renderMoments() {
  const moments = await getMoments();
  const q = $('#search').value.toLowerCase().replace(/^#/, '');

  // Feature card: on this day in earlier years, otherwise a random memory.
  const t = today();
  const past = moments.filter(m => m.date < t);
  const onThisDay = past.filter(m => m.date.slice(5) === t.slice(5));
  let mem = memoryPick && past.find(m => m.id === memoryPick);
  if (!mem) mem = onThisDay[0] || past[Math.floor(Math.random() * past.length)];
  if (mem) {
    const yrs = +t.slice(0, 4) - +mem.date.slice(0, 4);
    const kicker = mem.date.slice(5) === t.slice(5) && yrs > 0 ? `On this day · ${plural(yrs, 'year')} ago` : `A memory · ${fmtDate(mem.date, { month: 'short', year: 'numeric' })}`;
    fill($('#feature'), h('div', { className: 'thumb', style: tileVars(mem.id) }, thumbOf(mem) && h('img', { src: thumbOf(mem), alt: '' })),
      h('div', { className: 't' },
        h('span', { className: 'k', textContent: kicker }),
        h('span', { className: 'h', textContent: caption(mem) }),
        h('span', { className: 'm', textContent: [mem.photos.length && plural(mem.photos.length, 'photo'), mem.videos.length && plural(mem.videos.length, 'video')].filter(Boolean).join(' · ') || mem.place || 'Tap to open' })));
    $('#feature').onclick = () => openDetail(mem);
  } else fill($('#feature'));

  const list = moments.filter(m =>
    (filter === 'all' || (filter === 'photos' && (m.photos.length || m.videos.length)) || (filter === 'links' && m.link) || (filter === 'loved' && m.reactions.length)) &&
    (!q || [m.text, m.link, m.place, m.mood, detectSource(m.link)?.name, ...m.tags].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);

  const groups = [];
  list.forEach(m => {
    if (groups.at(-1)?.date !== m.date) groups.push({ date: m.date, items: [] });
    groups.at(-1).items.push(m);
  });
  fill($('#days'), groups.length ? groups.map(g => {
    const photos = g.items.reduce((n, m) => n + m.photos.length + m.videos.length, 0);
    return h('section', { className: 'day' },
      h('div', { className: 'day-head' }, h('h2', { textContent: dayLabel(g.date) }),
        h('span', { className: 'sm muted', textContent: photos ? plural(photos, 'photo') : plural(g.items.length, 'moment') })),
      h('div', { className: 'grid2' }, g.items.map(m => {
        const th = thumbOf(m);
        const s = !th && m.link && detectSource(m.link);
        return h('figure', { onclick: () => openDetail(m) },
          h('div', { className: 'tile' + (th ? ' has-img' : ''), style: tileVars(m.id) },
            th && h('img', { src: th, alt: '', loading: 'lazy' }),
            m.videos.length ? h('span', { className: 'play-badge' }, icon('play')) : null,
            m.reactions.length ? h('span', { className: 'by loved' }, icon('heart')) : h('span', { className: 'by', textContent: initial(settings.me) }),
            s && h('span', { className: 'src', textContent: s.name })),
          h('figcaption', { textContent: caption(m) }));
      })));
  }) : [h('p', { className: 'empty', textContent: moments.length ? 'Nothing matches that.' : 'No moments yet. Tap + to share your first one.' })]);
}

function openDetail(m) {
  const s = detectSource(m.link);
  let carousel = null, dots = null;
  const slides = m.photos.length + m.videos.length;
  if (slides) {
    carousel = h('div', { className: 'carousel' }, m.photos.map(src => h('img', { src, alt: '' })),
      m.videos.map(v => mediaEl('video', v.id, { poster: v.poster || '' })));
    if (slides > 1) {
      dots = h('div', { className: 'dots' }, Array.from({ length: slides }, (_, i) => h('i', { className: i ? '' : 'on' })));
      carousel.addEventListener('scroll', () => {
        const i = Math.round(carousel.scrollLeft / carousel.clientWidth);
        [...dots.children].forEach((d, j) => d.classList.toggle('on', i === j));
      }, { passive: true });
    }
  }
  const close = () => $('#detail').close();
  const act = (ico, label, fn, cls = '') => h('button', { className: cls, onclick: () => { close(); fn(); } }, ico, label);
  const reacts = h('div', { className: 'reacts' }, REACTIONS.map(r => h('button', {
    className: 'react' + (m.reactions.includes(r) ? ' on' : ''), textContent: r, ariaLabel: `React ${r}`,
    onclick: async e => {
      m.reactions = m.reactions.includes(r) ? m.reactions.filter(x => x !== r) : [...m.reactions, r];
      e.currentTarget.classList.toggle('on', m.reactions.includes(r));
      await db.put('moments', m);
      renderMoments();
    },
  })));
  fill($('#detail-body'), h('div', { className: 'detail' },
    carousel, dots,
    h('div', { className: 'meta' },
      h('span', { textContent: fmtDate(m.date) }),
      m.place && h('span', {}, icon('pin'), m.place),
      m.mood && h('span', { className: 'mood-pill', textContent: m.mood })),
    m.text && h('p', { className: 'txt', textContent: m.text, translate: false }),
    s && h('a', { className: 'link-card', href: m.link, target: '_blank', rel: 'noopener' },
      h('span', { className: 'badge', style: `background:${s.color}`, textContent: s.name.slice(0, 2) }),
      h('span', { className: 'meta2' }, h('strong', { textContent: `Open in ${s.name}` }), h('span', { className: 'url', textContent: m.link }))),
    m.tags.length ? h('div', { className: 'tags' }, m.tags.map(t => h('button', {
      textContent: '#' + t, onclick: () => { close(); go('moments'); $('#search-wrap').hidden = false; $('#search').value = '#' + t; renderMoments(); },
    }))) : null,
    reacts,
    h('div', { className: 'actions' },
      act(h('span', { className: 'ico', style: 'background:var(--accent)' }, icon('share')), `Share${settings.them ? ` with ${settings.them}` : ''}… (WhatsApp, Instagram, Messages)`,
        () => nativeShare({ text: m.text, url: m.link, images: m.photos, videos: m.videos })),
      shareTargets(m).map(([src, href]) => act(h('span', { className: 'ico', style: `background:${src.color}`, textContent: src.name.slice(0, 2) }),
        `Post to ${src.name}`, () => window.open(href, '_blank', 'noopener'))),
      h('hr'),
      act(h('span', { className: 'ico', style: 'background:#9A4A8C' }, icon('pen')), 'Edit', () => openComposer({ moment: m })),
      act(h('span', { className: 'ico', style: 'background:#D2384F' }, icon('trash')), 'Delete', async () => {
        if (!confirm(T('Delete this moment?'))) return;
        await db.del('moments', m.id);
        for (const v of m.videos) await db.del('media', v.id);
        refresh();
      }, 'danger')),
  ));
  $('#detail').showModal();
  $('#detail').scrollTop = 0;
}

// Story-style slideshow of this month's photos.
let playerTimer = null;
$('#recap-play').onclick = async () => {
  const month = today().slice(0, 7);
  let pool = (await getMoments()).filter(m => m.photos.length);
  const thisMonth = pool.filter(m => m.date.startsWith(month));
  if (thisMonth.length) pool = thisMonth;
  playSlides(pool.sort((a, b) => a.date.localeCompare(b.date)).flatMap(m => m.photos.map(src => ({ src, text: m.text, date: m.date }))));
};
function playSlides(slides) {
  if (!slides.length) return toast('Add some photos first');
  const dlg = $('#player');
  let i = 0;
  const show = () => {
    if (i >= slides.length) return dlg.close();
    const s = slides[i], img = $('#player-img');
    img.src = s.src;
    img.style.animation = 'none'; void img.offsetWidth; img.style.animation = '';
    fill($('#player-cap'), h('small', { textContent: fmtDate(s.date) }), (s.text || '').split('\n')[0]);
    fill($('#player-bars'), slides.map((_, j) => h('i', { className: j < i ? 'done' : j === i ? 'cur' : '' })));
    clearTimeout(playerTimer);
    playerTimer = setTimeout(() => { i++; show(); }, 3500);
  };
  dlg.onclick = e => {
    if (e.target.closest('[data-close]')) return;
    i = Math.max(0, i + (e.clientX < innerWidth / 3 ? -1 : 1));
    show();
  };
  dlg.onclose = () => clearTimeout(playerTimer);
  dlg.showModal();
  show();
}

// ---------- Us ----------
bindSeg($('#us-seg'), b => $$('.us-pane').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.pane; }));
function openUs(pane) { go('us'); pickSeg($('#us-seg'), 'data-pane', pane); }
function openCalendarOn(date) {
  selectedDay = date;
  calMonth = parseDate(date); calMonth.setDate(1);
  renderCalendar();
  openUs('calendar');
}
function renderUs() {
  const tap = (el, who) => { el.onclick = () => editMyAvatar(who); el.title = 'Change picture'; el.classList.add('editable'); return el; };
  fill($('#us-duo'), tap(avatar('me'), 'me'), settings.them ? tap(avatar('them'), 'them') : h('div', { className: 'av plus' }, icon('plus')));
  $('#us-names').textContent = settings.them ? `${settings.me} & ${settings.them}` : settings.me;
  const n = daysTogether();
  $('#us-days').textContent = n ? `${n.toLocaleString()} days together · since ${fmtDate(settings.since, { month: 'long', day: 'numeric', year: 'numeric' })}` : 'Add your "together since" date in Settings';
  loadSettingsForm();
}

// Calendar
let calMonth = new Date(); calMonth.setDate(1);
let selectedDay = today();
$('#cal-prev').onclick = () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCalendar(); };
$('#cal-next').onclick = () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCalendar(); };
$('#cal-today').onclick = () => { calMonth = new Date(); calMonth.setDate(1); selectedDay = today(); renderCalendar(); };

async function renderCalendar() {
  const [moments, events] = await Promise.all([getMoments(), db.all('events')]);
  const byDay = {};
  const slot = k => (byDay[k] ||= { m: [], e: [], s: [], x: [] });
  (await Promise.all(calendarSources.map(f => f()))).flat().forEach(it => slot(it.date).x.push(it));
  moments.forEach(m => slot(m.date).m.push(m));
  events.forEach(e => slot(e.date).e.push(e));
  const year = calMonth.getFullYear();
  const specials = [...settings.dates, ...(settings.since ? [{ title: 'Anniversary', date: settings.since }] : [])];
  specials.forEach(d => [year - 1, year, year + 1].forEach(y => { if (`${y}${d.date.slice(4)}` >= d.date) slot(y + d.date.slice(4)).s.push(d); }));

  $('#cal-title').textContent = calMonth.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
  const start = new Date(calMonth); start.setDate(1 - ((start.getDay() + 6) % 7)); // weeks start Monday
  const cells = Array.from({ length: 7 }, (_, i) => h('div', { className: 'dow', textContent: new Date(2024, 0, 1 + i).toLocaleDateString(LOCALE, { weekday: 'narrow' }) })); // 1 Jan 2024 was a Monday
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = isoDate(d);
    const x = byDay[key];
    const photo = x?.m.find(m => m.photos.length)?.photos[0];
    const cls = [d.getMonth() !== calMonth.getMonth() && 'other', key === today() && 'today', key === selectedDay && 'selected', photo && 'has-photo'];
    cells.push(h('button', { className: cls.filter(Boolean).join(' '), ariaLabel: fmtDate(key), onclick: () => { selectedDay = key; renderCalendar(); } },
      photo && h('img', { src: photo, alt: '' }),
      h('span', { textContent: d.getDate() }),
      h('span', { className: 'marks' },
        !photo && x?.m.length ? h('i') : null, x?.e.length ? h('i', { className: 'ev' }) : null, x?.s.length ? h('i', { className: 'sp' }) : null,
        [...new Set(x?.x.map(it => it.color) || [])].map(c => h('i', { style: `background:${c}` })))));
  }
  fill($('#cal-grid'), cells);

  $('#day-title').textContent = selectedDay === today() ? 'Today' : fmtDate(selectedDay, { weekday: 'long', month: 'long', day: 'numeric' });
  const x = byDay[selectedDay] || { m: [], e: [], s: [], x: [] };
  const items = [
    ...x.s.map(d => h('div', { className: 'item' }, h('i', { className: 'k', style: 'background:#C2603A' }),
      h('div', { className: 't' }, h('span', { textContent: d.title }), h('span', { className: 's', textContent: 'Special date' })))),
    ...x.e.sort((a, b) => (a.time || '').localeCompare(b.time || '')).map(e => h('div', { className: 'item' },
      h('i', { className: 'k', style: 'background:#3C6E91' }),
      h('div', { className: 't' }, h('span', { textContent: e.title }), h('span', { className: 's', textContent: e.time || 'All day' })),
      roundBtn('download', 'Add to Apple/Google/Outlook calendar', () => exportIcs(e)),
      roundBtn('trash', 'Delete', async () => { await db.del('events', e.id); renderCalendar(); renderHome(); }))),
    ...x.m.map(m => h('div', { className: 'item', style: 'cursor:pointer', onclick: () => openDetail(m) },
      m.photos[0] ? h('img', { src: m.photos[0], alt: '' }) : h('i', { className: 'k', style: 'background:var(--accent)' }),
      h('div', { className: 't' }, h('span', { textContent: caption(m) }), h('span', { className: 's', textContent: m.place || m.mood || 'Moment' })))),
    ...x.x.sort((a, b) => (a.sort || '').localeCompare(b.sort || '')).map(it => it.render()),
  ];
  fill($('#day-list'), items.length ? items : [h('p', { className: 'sm muted', style: 'padding:12px 0', textContent: 'Nothing planned yet.' })]);
}

$('#event-form').addEventListener('submit', async e => {
  e.preventDefault();
  await db.put('events', { id: uid(), date: selectedDay, time: $('#ev-time').value, title: $('#ev-title').value.trim() });
  e.target.reset();
  renderCalendar();
  renderHome();
});

// .ics file opens in Apple Calendar / Outlook / Google Calendar import.
function exportIcs(e) {
  const d = e.date.replace(/-/g, '');
  const when = e.time ? `DTSTART:${d}T${e.time.replace(':', '')}00` : `DTSTART;VALUE=DATE:${d}`;
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Twofold//EN', 'BEGIN:VEVENT',
    `UID:${e.id}@twofold`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    when, `SUMMARY:${e.title.replace(/[,;]/g, '\\$&')}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  download(`${e.title.slice(0, 30) || 'event'}.ics`, 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics));
}

// ---------- Backup to computer ----------
$('#export').onclick = async () => {
  const data = { app: 'moments', version: 3, exported: new Date().toISOString() };
  // Videos and voice notes are blobs; store them as base64 text inside the backup.
  const toDataURL = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
  for (const s of STORES) data[s] = await Promise.all((await db.all(s)).map(async it => it.blob instanceof Blob ? { ...it, blob: await toDataURL(it.blob), __blob: true } : it));
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  download(`moments-backup-${today()}.json`, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
async function importBackup(input) {
  const f = input.files[0];
  input.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'moments') throw new Error('not a backup from this app');
    let n = 0;
    for (const s of STORES) for (let item of data[s] || []) {
      if (item.__blob) { const { __blob, ...rest } = item; item = { ...rest, blob: await (await fetch(item.blob)).blob() }; }
      await db.put(s, item); n++;
    }
    settings = { ...settings, ...(await db.get('settings', 'main')) };
    $('#onboard').hidden = !!settings.me;
    toast(`Restored ${n} items`);
    refresh();
  } catch (err) {
    toast('Could not restore: ' + err.message);
  }
}
$('#import').addEventListener('change', e => importBackup(e.target));

// ---------- Boot ----------
const renderers = [renderHome, renderMoments, renderCalendar, renderUs];
function refresh() { renderers.forEach(r => r()); }
// Wait for the other scripts (shopping.js, pets.js) to register their renderers.
document.addEventListener('DOMContentLoaded', async () => {
  applyTheme();
  settings = { ...settings, ...(await db.get('settings', 'main')) };
  $('#onboard').hidden = !!settings.me;
  refresh();
  receiveShare();
  $('#file-warning').hidden = location.protocol !== 'file:';
});
navigator.storage?.persist?.();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
