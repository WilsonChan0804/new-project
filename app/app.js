'use strict';

// ---------- Storage (IndexedDB, on this device only) ----------
const STORES = ['moments', 'events', 'chats', 'messages', 'stickers', 'settings', 'lists', 'meals', 'pets', 'petlogs'];
const dbReady = new Promise((resolve, reject) => {
  const req = indexedDB.open('moments-app', 3);
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
const getMoments = async () => (await db.all('moments')).map(m => ({ place: '', tags: [], photos: [], reactions: [], mood: '', ...m }));

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
const fmtDate = (s, opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) => parseDate(s).toLocaleDateString(undefined, opts);
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
async function nativeShare({ text = '', url = '', images = [] }) {
  const files = await Promise.all(images.map((src, i) => dataUrlToFile(src, `moment-${i + 1}.${src.startsWith('data:image/png') ? 'png' : 'jpg'}`)));
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

function avatar(who, extra = '') {
  const name = who === 'me' ? settings.me : settings.them;
  return h('div', { className: `av ${who} ${extra}`, textContent: initial(name) });
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
  $('#greet-time').textContent = `${now.toLocaleDateString(undefined, { weekday: 'long' })} ${hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening'}`;
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
        h('span', { textContent: last ? `You: ${last.kind === 'text' ? last.body : last.kind} · ${new Date(last.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Tap the heart to send a nudge' })),
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
    const photo = m.photos[0];
    return h('button', { className: 'tile' + (photo ? ' has-img' : ''), style: tileVars(m.id), onclick: () => openDetail(m) },
      photo && h('img', { src: photo, alt: '' }),
      h('span', { textContent: caption(m) }));
  }) : [h('p', { className: 'sm muted', style: 'grid-column:1/-1', textContent: 'Your moments will show up here. Tap + to share the first one.' })]);
}
const caption = m => (m.text || '').split('\n')[0] || (m.link && detectSource(m.link).name) || m.place || 'A moment';

// ---------- Composer ----------
const MOODS = ['Happy', 'Grateful', 'Missing you', 'Cozy', 'Adventurous'];
let pendingPhotos = [];
let editingId = null;
let mood = '';

function openComposer({ moment = null, photos = [], link = '', text = '', prompt = '', camera = false } = {}) {
  $('#composer').reset();
  editingId = moment?.id || null;
  $('#composer-title').textContent = moment ? 'Edit moment' : 'New moment';
  $('#c-text').value = moment?.text ?? text;
  $('#c-text').placeholder = prompt || 'What made this moment special?';
  $('#c-link').value = moment?.link ?? link;
  $('#c-place').value = moment?.place ?? '';
  $('#c-date').value = moment?.date ?? today();
  $('#c-tags').value = (moment?.tags || []).map(t => '#' + t).join(' ');
  $('#c-more').open = !!(moment?.link || moment?.place || moment?.tags?.length || link);
  mood = moment?.mood || '';
  pendingPhotos = moment ? [...moment.photos] : photos;
  $('#c-stage').style.cssText = tileVars(editingId || 'new');
  renderMoods();
  renderStage();
  showSource();
  updateSubmit();
  $('#composer-dialog').showModal();
  if (camera && !pendingPhotos.length && matchMedia('(pointer: coarse)').matches) $('#c-camera').click();
}
$('#fab').onclick = () => openComposer();

function renderMoods() {
  fill($('#c-moods'), MOODS.map(m => h('button', {
    type: 'button', className: 'chip' + (m === mood ? ' on' : ''), textContent: m, ariaPressed: String(m === mood),
    onclick: () => { mood = mood === m ? '' : m; renderMoods(); },
  })));
}
function renderStage() {
  $('#c-empty').hidden = pendingPhotos.length > 0;
  $('#c-add-label').textContent = pendingPhotos.length ? '+ Add more' : 'Choose photos';
  fill($('#c-photos-view'), pendingPhotos.map((src, i) => h('figure', {},
    h('img', { src, alt: '' }),
    pendingPhotos.length > 1 && h('span', { className: 'count', textContent: `${i + 1} / ${pendingPhotos.length}` }),
    h('button', { type: 'button', ariaLabel: 'Remove photo', onclick: () => { pendingPhotos.splice(i, 1); renderStage(); } }, icon('x')))));
}
async function addPhotos(e) {
  for (const f of e.target.files) pendingPhotos.push(await readImage(f));
  e.target.value = '';
  renderStage();
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
  if (!text && !link && !pendingPhotos.length) return toast('Add a photo, a caption or a link');
  const existing = editingId && await db.get('moments', editingId);
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
    reactions: existing?.reactions || [],
  };
  // Start the share first so it still counts as a direct response to the tap.
  const shared = $('#c-share').checked ? nativeShare({ text: m.text, url: m.link, images: m.photos }) : null;
  await db.put('moments', m);
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
    fill($('#feature'), h('div', { className: 'thumb', style: tileVars(mem.id) }, mem.photos[0] && h('img', { src: mem.photos[0], alt: '' })),
      h('div', { className: 't' },
        h('span', { className: 'k', textContent: kicker }),
        h('span', { className: 'h', textContent: caption(mem) }),
        h('span', { className: 'm', textContent: mem.photos.length ? plural(mem.photos.length, 'photo') : mem.place || 'Tap to open' })));
    $('#feature').onclick = () => openDetail(mem);
  } else fill($('#feature'));

  const list = moments.filter(m =>
    (filter === 'all' || (filter === 'photos' && m.photos.length) || (filter === 'links' && m.link) || (filter === 'loved' && m.reactions.length)) &&
    (!q || [m.text, m.link, m.place, m.mood, detectSource(m.link)?.name, ...m.tags].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);

  const groups = [];
  list.forEach(m => {
    if (groups.at(-1)?.date !== m.date) groups.push({ date: m.date, items: [] });
    groups.at(-1).items.push(m);
  });
  fill($('#days'), groups.length ? groups.map(g => {
    const photos = g.items.reduce((n, m) => n + m.photos.length, 0);
    return h('section', { className: 'day' },
      h('div', { className: 'day-head' }, h('h2', { textContent: dayLabel(g.date) }),
        h('span', { className: 'sm muted', textContent: photos ? plural(photos, 'photo') : plural(g.items.length, 'moment') })),
      h('div', { className: 'grid2' }, g.items.map(m => {
        const s = !m.photos.length && m.link && detectSource(m.link);
        return h('figure', { onclick: () => openDetail(m) },
          h('div', { className: 'tile' + (m.photos[0] ? ' has-img' : ''), style: tileVars(m.id) },
            m.photos[0] && h('img', { src: m.photos[0], alt: '', loading: 'lazy' }),
            m.reactions.length ? h('span', { className: 'by loved' }, icon('heart')) : h('span', { className: 'by', textContent: initial(settings.me) }),
            s && h('span', { className: 'src', textContent: s.name })),
          h('figcaption', { textContent: caption(m) }));
      })));
  }) : [h('p', { className: 'empty', textContent: moments.length ? 'Nothing matches that.' : 'No moments yet. Tap + to share your first one.' })]);
}

function openDetail(m) {
  const s = detectSource(m.link);
  let carousel = null, dots = null;
  if (m.photos.length) {
    carousel = h('div', { className: 'carousel' }, m.photos.map(src => h('img', { src, alt: '' })));
    if (m.photos.length > 1) {
      dots = h('div', { className: 'dots' }, m.photos.map((_, i) => h('i', { className: i ? '' : 'on' })));
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
    m.text && h('p', { className: 'txt', textContent: m.text }),
    s && h('a', { className: 'link-card', href: m.link, target: '_blank', rel: 'noopener' },
      h('span', { className: 'badge', style: `background:${s.color}`, textContent: s.name.slice(0, 2) }),
      h('span', { className: 'meta2' }, h('strong', { textContent: `Open in ${s.name}` }), h('span', { className: 'url', textContent: m.link }))),
    m.tags.length ? h('div', { className: 'tags' }, m.tags.map(t => h('button', {
      textContent: '#' + t, onclick: () => { close(); go('moments'); $('#search-wrap').hidden = false; $('#search').value = '#' + t; renderMoments(); },
    }))) : null,
    reacts,
    h('div', { className: 'actions' },
      act(h('span', { className: 'ico', style: 'background:var(--accent)' }, icon('share')), `Share${settings.them ? ` with ${settings.them}` : ''}… (WhatsApp, Instagram, Messages)`,
        () => nativeShare({ text: m.text, url: m.link, images: m.photos })),
      shareTargets(m).map(([src, href]) => act(h('span', { className: 'ico', style: `background:${src.color}`, textContent: src.name.slice(0, 2) }),
        `Post to ${src.name}`, () => window.open(href, '_blank', 'noopener'))),
      h('hr'),
      act(h('span', { className: 'ico', style: 'background:#9A4A8C' }, icon('pen')), 'Edit', () => openComposer({ moment: m })),
      act(h('span', { className: 'ico', style: 'background:#D2384F' }, icon('trash')), 'Delete', async () => {
        if (!confirm('Delete this moment?')) return;
        await db.del('moments', m.id);
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

// ---------- Chat ----------
// Messages are stored locally. Real-time delivery to the other person needs a server (see README).
let activeChat = null;

async function partnerChat(create = false) {
  if (!settings.them) return null;
  const chats = await db.all('chats');
  let c = chats.find(x => x.id === settings.partnerChat) || chats.find(x => x.name === settings.them);
  if (!c && create) {
    c = { id: uid(), name: settings.them, created: Date.now() };
    await db.put('chats', c);
  }
  if (c && settings.partnerChat !== c.id) {
    settings.partnerChat = c.id;
    if (c.name !== settings.them) { c.name = settings.them; await db.put('chats', c); }
    await db.put('settings', settings);
  }
  return c;
}
async function enterChat() {
  if (!activeChat) activeChat = (await partnerChat(true))?.id || null;
  $('#chat-layout').classList.toggle('show-thread', !!activeChat);
  renderChats();
}
$('#new-chat').addEventListener('submit', async e => {
  e.preventDefault();
  const chat = { id: uid(), name: $('#new-chat-name').value.trim(), created: Date.now() };
  await db.put('chats', chat);
  e.target.reset();
  openChat(chat.id);
});
$('#chat-back').onclick = () => { $('#chat-layout').classList.remove('show-thread'); renderChats(); };
function openChat(id) {
  activeChat = id;
  $('#chat-layout').classList.add('show-thread');
  renderChats();
}

async function renderChats() {
  const [chats, all] = await Promise.all([db.all('chats'), db.all('messages')]);
  const last = {};
  all.forEach(m => { if (!last[m.chat] || m.at > last[m.chat].at) last[m.chat] = m; });
  chats.sort((a, b) => (last[b.id]?.at || b.created) - (last[a.id]?.at || a.created));

  fill($('#chat-list'), chats.map(c => h('li', { className: c.id === activeChat ? 'active' : '', onclick: () => openChat(c.id) },
    h('div', { className: 'av them', style: c.id === settings.partnerChat ? '' : tileVars(c.id).replace('--tile-bg', 'background').replace(';--tile-fg', ';color'), textContent: initial(c.name) }),
    h('div', { className: 't' }, h('strong', { textContent: c.name }),
      h('span', { className: 'last', textContent: !last[c.id] ? 'Say hi 👋' : last[c.id].kind === 'text' ? last[c.id].body : last[c.id].kind === 'sticker' ? 'Sticker' : 'Photo' })))));

  const chat = chats.find(c => c.id === activeChat);
  $('#chat-title').textContent = chat ? chat.name : 'Chat';
  $('#chat-avatar').textContent = chat ? initial(chat.name) : '';
  $('#msg-text').placeholder = chat ? `Message ${chat.name}` : 'Message';
  const msgs = chat ? all.filter(m => m.chat === chat.id).sort((a, b) => a.at - b.at) : [];
  let lastDay = '';
  const nodes = [];
  msgs.forEach(m => {
    const day = isoDate(new Date(m.at));
    if (day !== lastDay) nodes.push(h('span', { className: 'day-sep', textContent: day === today() ? 'Today' : fmtDate(day) }));
    lastDay = day;
    if (m.kind === 'text') nodes.push(h('div', { className: 'msg', textContent: m.body }));
    else nodes.push(h('div', { className: 'msg-media' },
      h('img', { src: m.body, alt: m.kind, className: m.kind }),
      m.kind === 'photo' && h('div', { className: 'saved-row' }, m.saved ?
        [h('span', { className: 'saved-chip', textContent: `♥ ${settings.me || 'You'}` }), h('span', { className: 'sm muted', textContent: 'Saved to Moments' })] :
        h('button', { className: 'saved-chip', textContent: '♡ Save to Moments', onclick: () => saveMessagePhoto(m, chat) }))));
  });
  const lastMsg = msgs.at(-1);
  if (lastMsg) nodes.push(h('span', { className: 'seen', textContent: `Sent ${new Date(lastMsg.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` }));
  fill($('#messages'), nodes.length ? nodes : [h('p', { className: 'empty', textContent: chat ? `Say hi to ${chat.name} 👋` : 'Start a chat.' })]);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

async function saveMessagePhoto(msg, chat) {
  const m = { id: uid(), created: Date.now(), date: isoDate(new Date(msg.at)), text: `From our chat with ${chat.name}`, link: '', source: null,
    place: '', tags: ['chat'], photos: [msg.body], reactions: ['❤️'], mood: '' };
  await db.put('moments', m);
  await db.put('messages', { ...msg, saved: m.id });
  toast('Saved to Moments');
  refresh();
}
async function sendMessage(kind, body) {
  if (!activeChat) return toast('Start a chat first');
  await db.put('messages', { id: uid(), chat: activeChat, kind, body, at: Date.now() });
  renderChats();
}
$('#msg-form').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('#msg-text').value.trim();
  if (text) sendMessage('text', text);
  $('#msg-text').value = '';
});
$$('#quick-replies button').forEach(b => b.addEventListener('click', () => sendMessage('text', b.textContent)));
$('#msg-photo').addEventListener('change', async e => {
  if (e.target.files[0]) sendMessage('photo', await readImage(e.target.files[0], 1200));
  e.target.value = '';
});
$('#toggle-tray').onclick = () => { $('#sticker-tray').hidden = !$('#sticker-tray').hidden; };

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
  fill($('#us-duo'), avatar('me'), settings.them ? avatar('them') : h('div', { className: 'av plus' }, icon('plus')));
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

  $('#cal-title').textContent = calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const start = new Date(calMonth); start.setDate(1 - ((start.getDay() + 6) % 7)); // weeks start Monday
  const cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => h('div', { className: 'dow', textContent: d }));
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

// ---------- Sticker studio ----------
const cv = $('#st-canvas');
const ctx = cv.getContext('2d');
const S = 512;
const st = { img: null, x: 0, y: 0, seeds: [], shape: 'circle' };
const ctrl = id => $('#st-' + id);

function loadStickerPhoto(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const img = new Image();
  img.onload = () => { st.img = img; st.x = 0; st.y = 0; st.seeds = []; ctrl('zoom').value = 1; drawSticker(); };
  img.src = URL.createObjectURL(f);
}
ctrl('file').addEventListener('change', loadStickerPhoto);
ctrl('camera').addEventListener('change', loadStickerPhoto);
ctrl('shape').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  ctrl('shape').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  st.shape = b.dataset.v;
  st.seeds = [];
  const cut = st.shape === 'cutout';
  ctrl('tol-wrap').hidden = !cut;
  ctrl('hint').textContent = cut ? 'Tap the background to erase it. Drag to move the photo.' : 'Drag the photo to position it.';
  drawSticker();
}));
['zoom', 'outline', 'caption', 'tol'].forEach(id => ctrl(id).addEventListener('input', () => {
  if (id === 'zoom') st.seeds = [];
  drawSticker();
}));
ctrl('undo').onclick = () => { st.seeds.pop(); drawSticker(); };

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
  if (drag && !drag.moved && st.shape === 'cutout' && st.img) {
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
  ctrl('undo').hidden = !st.seeds.length;
  ctrl('empty').hidden = !!st.img;
  cv.parentElement.classList.toggle('loaded', !!st.img);
  if (!st.img) return;
  const outline = +ctrl('outline').value;
  const text = ctrl('caption').value.trim();
  const pad = outline + 8;

  // 1. Photo, cover-fit, with pan and zoom.
  const body = h('canvas', { width: S, height: S });
  const b = body.getContext('2d');
  const k = Math.max(S / st.img.width, S / st.img.height) * +ctrl('zoom').value;
  const w = st.img.width * k, ht = st.img.height * k;
  b.save();
  if (st.shape !== 'cutout') { shapePath(b, st.shape, pad); b.clip(); }
  b.drawImage(st.img, (S - w) / 2 + st.x, (S - ht) / 2 + st.y, w, ht);
  b.restore();
  if (st.shape === 'cutout' && st.seeds.length) {
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
  if (text) {
    ctx.font = '700 64px "Bricolage Grotesque", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#2A1E22';
    ctx.fillStyle = '#fff';
    ctx.strokeText(text, S / 2, S - 30, S - 40);
    ctx.fillText(text, S / 2, S - 30, S - 40);
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
  fill($('#st-library'), list.length ? list.map(s => h('figure', {},
    h('img', { src: s.src, alt: 'Sticker' }),
    h('div', { className: 'row' },
      roundBtn('share', 'Share (e.g. to WhatsApp)', () => nativeShare({ images: [s.src] })),
      roundBtn('download', 'Download PNG', () => download('sticker.png', s.src)),
      roundBtn('trash', 'Delete', async () => { await db.del('stickers', s.id); renderStickers(); })))) :
    [h('p', { className: 'sm muted', textContent: 'Stickers you make will appear here, ready to use in Chat.' })]);
  fill($('#sticker-tray'), list.length ? list.map(s => h('img', { src: s.src, alt: 'Sticker', onclick: () => sendMessage('sticker', s.src) })) :
    [h('p', { className: 'sm muted', textContent: 'No stickers yet. Make one in Us → Stickers.' })]);
}

// ---------- Backup to computer ----------
$('#export').onclick = async () => {
  const data = { app: 'moments', version: 2, exported: new Date().toISOString() };
  for (const s of STORES) data[s] = await db.all(s);
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
    for (const s of STORES) for (const item of data[s] || []) { await db.put(s, item); n++; }
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
const renderers = [renderHome, renderMoments, renderCalendar, renderChats, renderStickers, renderUs];
function refresh() { renderers.forEach(r => r()); }
// Wait for the other scripts (shopping.js, pets.js) to register their renderers.
document.addEventListener('DOMContentLoaded', async () => {
  applyTheme();
  settings = { ...settings, ...(await db.get('settings', 'main')) };
  $('#onboard').hidden = !!settings.me;
  refresh();
  drawSticker();
  receiveShare();
});
navigator.storage?.persist?.();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
