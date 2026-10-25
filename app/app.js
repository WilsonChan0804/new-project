'use strict';

// ---------- Storage (IndexedDB, on this device only) ----------
const STORES = ['moments', 'events', 'chats', 'messages', 'stickers', 'settings'];
const dbReady = new Promise((resolve, reject) => {
  const req = indexedDB.open('moments-app', 2);
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
const getMoments = async () => (await db.all('moments')).map(m => ({ place: '', tags: [], photos: [], reactions: [], ...m }));

// ---------- Helpers ----------
const $ = sel => document.querySelector(sel);
const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  kids.flat().forEach(k => k != null && k !== false && el.append(k));
  return el;
};
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));
const icon = name => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.innerHTML = `<use href="#i-${name}"/>`;
  return s;
};
const iconBtn = (name, label, onclick) => h('button', { className: 'icon-btn', type: 'button', ariaLabel: label, title: label, onclick }, icon(name));

const DAY = 86400000;
const isoDate = d => d.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
const today = () => isoDate(new Date());
const parseDate = s => new Date(s + 'T00:00');
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / DAY);
const fmtDate = (s, opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) => parseDate(s).toLocaleDateString(undefined, opts);
const initials = name => name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

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

// Dialogs: close buttons and tapping the backdrop.
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => {
  if (e.target === d || e.target.closest('[data-close]')) d.close();
}));

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
const detectSource = url => !url ? null : SOURCES.find(s => s.match.test(url)) || { id: 'web', name: 'Link', color: '#85776d' };
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
    try { await navigator.share(payload); } catch (e) { if (e.name !== 'AbortError') toast('Share failed'); }
    return;
  }
  await navigator.clipboard?.writeText(payload.text);
  toast('Copied to clipboard');
}

// ---------- Navigation ----------
function go(view) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  document.body.dataset.view = view;
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
document.body.dataset.view = 'home';

// ---------- Settings ----------
let settings = { id: 'main', me: '', them: '', since: '', dates: [] };
let draftDates = [];

$('#open-settings').onclick = async () => {
  $('#s-me').value = settings.me;
  $('#s-them').value = settings.them;
  $('#s-since').value = settings.since;
  draftDates = [...settings.dates];
  renderDraftDates();
  const est = await navigator.storage?.estimate?.();
  $('#storage-info').textContent = est ? `Using ${(est.usage / 1048576).toFixed(1)} MB on this device.` : '';
  $('#settings-dialog').showModal();
};
function renderDraftDates() {
  fill($('#s-dates'), ...draftDates.map(d => h('div', { className: 'item' },
    h('span', { textContent: `${d.title} · ${fmtDate(d.date, { month: 'long', day: 'numeric' })}` }),
    iconBtn('trash', 'Remove', () => { draftDates = draftDates.filter(x => x !== d); renderDraftDates(); }))));
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
  $('#settings-dialog').close();
  renderHome();
  renderCalendar();
});

// Next yearly occurrence of a date, on or after today.
function nextOccurrence(dateStr) {
  const t = today(), [, mm, dd] = dateStr.split('-');
  let y = +t.slice(0, 4);
  if (`${y}-${mm}-${dd}` < t) y++;
  return `${y}-${mm}-${dd}`;
}

// ---------- Home ----------
const QUESTIONS = [
  'What made you smile today?', 'What is a small thing you are grateful for this week?',
  'Which song is stuck in your head right now?', 'Where would you go if you could travel tomorrow?',
  'What is the best thing you ate recently?', 'Which film or show would you rewatch tonight?',
  'What is a memory from this year you want to keep forever?', 'What is something new you learned lately?',
  'Who made your day better recently, and how?', 'What does a perfect lazy Sunday look like?',
  'What is one thing you want to do before the year ends?', 'Which photo on your phone makes you happiest?',
  'What is a habit you are proud of?', 'What is the most beautiful place you have seen?',
  'What would you tell yourself from five years ago?', 'What is your comfort food?',
  'What made you laugh out loud recently?', 'Which book, film or song changed how you think?',
  'What is a tiny adventure you could take this weekend?', 'What are you looking forward to next month?',
  'What is something you would like to get better at?', 'What does home mean to you?',
  'What is the kindest thing someone did for you lately?', 'Describe today in three words.',
  'What would your dream date or day out look like?', 'Which season do you love most, and why?',
  'What is a tradition you would like to start?', 'What is a moment you wish you could relive?',
];
const questionToday = () => {
  const start = new Date(new Date().getFullYear(), 0, 0);
  return QUESTIONS[Math.floor((new Date() - start) / DAY) % QUESTIONS.length];
};
let memoryPick = null;

async function renderHome() {
  const [moments, events] = await Promise.all([getMoments(), db.all('events')]);
  const hour = new Date().getHours();
  $('#greeting').textContent = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}${settings.me ? ', ' + settings.me : ''}`;
  $('#home-title').textContent = settings.them ? `${settings.me || 'You'} & ${settings.them}` : 'Your moments';

  // Hero: days together (or a moment count) and countdowns.
  const t = today();
  const countdowns = [
    ...settings.dates.map(d => ({ label: d.title, date: nextOccurrence(d.date) })),
    ...events.filter(e => e.date >= t && daysBetween(t, e.date) <= 60).map(e => ({ label: e.title, date: e.date })),
  ];
  let big, names;
  if (settings.since) {
    const n = daysBetween(settings.since, t) + 1;
    big = [String(n.toLocaleString()), h('small', { textContent: n === 1 ? 'day together' : 'days together' })];
    names = `Since ${fmtDate(settings.since, { month: 'long', day: 'numeric', year: 'numeric' })}`;
    const milestone = Math.ceil((n + 1) / 100) * 100;
    countdowns.push({ label: `Day ${milestone.toLocaleString()}`, date: isoDate(new Date(parseDate(settings.since).getTime() + (milestone - 1) * DAY)) });
  } else {
    big = [String(moments.length), h('small', { textContent: moments.length === 1 ? 'moment saved' : 'moments saved' })];
    names = 'Your little archive of life';
  }
  countdowns.sort((a, b) => a.date.localeCompare(b.date));
  fill($('#hero'), 
    h('div', { className: 'names', textContent: names }),
    h('div', { className: 'big' }, big),
    countdowns.length ? h('div', { className: 'countdowns' }, countdowns.slice(0, 6).map(c => {
      const n = daysBetween(t, c.date);
      return h('div', { className: 'cd' }, h('b', { textContent: n === 0 ? 'Today!' : n === 1 ? 'Tomorrow' : `in ${n} days` }), c.label);
    })) : null,
    !settings.me && !settings.since ? h('button', { className: 'btn setup', textContent: 'Personalise', onclick: () => $('#open-settings').click() }) : null,
  );

  // Question of the day.
  const q = questionToday();
  const answered = moments.find(m => m.qdate === t);
  const qInput = h('input', { placeholder: 'Your answer…', required: true });
  fill($('#question'), 
    h('div', { className: 'eyebrow' }, icon('heart'), 'Question of the day'),
    h('p', { className: 'q', textContent: q }),
    answered ? h('p', { className: 'done', textContent: answered.answer || answered.text }) :
      h('form', { onsubmit: async e => {
        e.preventDefault();
        await db.put('moments', { id: uid(), created: Date.now(), date: t, text: `${q}\n— ${qInput.value.trim()}`,
          answer: qInput.value.trim(), qdate: t, link: '', source: null, place: '', tags: ['questions'], photos: [], reactions: [] });
        toast('Saved to your moments');
        refresh();
      } }, qInput, h('button', { className: 'btn primary', textContent: 'Save' })),
  );

  // On this day (earlier years), else a random memory.
  const md = t.slice(5);
  const onThisDay = moments.filter(m => m.date.slice(5) === md && m.date < t);
  let mem = memoryPick && moments.find(m => m.id === memoryPick);
  if (!mem) mem = onThisDay[0] || moments[Math.floor(Math.random() * moments.length)];
  $('#memory-title').textContent = mem && mem.date.slice(5) === md && mem.date < t ? 'On this day' : 'A memory';
  $('#memory-shuffle').hidden = moments.length < 2;
  fill($('#memory'), mem ? memoryCard(mem) :
    h('div', { className: 'card empty', textContent: 'Your memories will resurface here. Save your first moment with the + button.' }));

  // Monthly recap.
  const month = t.slice(0, 7);
  const inMonth = moments.filter(m => m.date.startsWith(month));
  const photos = inMonth.flatMap(m => m.photos);
  $('#recap-title').textContent = new Date().toLocaleDateString(undefined, { month: 'long' }) + ' so far';
  $('#recap-play').hidden = !photos.length;
  fill($('#recap'), 
    h('div', { className: 'stats' },
      h('div', {}, h('b', { textContent: inMonth.length }), 'moments'),
      h('div', {}, h('b', { textContent: photos.length }), 'photos'),
      h('div', {}, h('b', { textContent: inMonth.filter(m => m.link).length }), 'links'),
      h('div', {}, h('b', { textContent: new Set(inMonth.map(m => m.date)).size }), 'days')),
    photos.length ? h('div', { className: 'collage' }, photos.slice(0, 9).map(src => h('img', { src, loading: 'lazy' }))) :
      h('p', { className: 'hint', textContent: 'Add photos this month and they will build into a collage and a recap you can play.' }),
  );
}

function memoryCard(m) {
  const ago = Math.floor(daysBetween(m.date, today()) / 365);
  const when = ago >= 1 ? `${ago} year${ago > 1 ? 's' : ''} ago · ${fmtDate(m.date)}` : fmtDate(m.date);
  const photo = m.photos[0];
  return h('div', { className: 'memory' + (photo ? '' : ' text-only'), onclick: () => openActions(m) },
    photo && h('img', { src: photo }),
    h('div', { className: 'cap' },
      h('div', { className: 'when', textContent: when }),
      h('div', { className: 'txt', textContent: m.text || m.link || m.place || 'A photo moment' })));
}
$('#memory-shuffle').onclick = async () => {
  const all = await getMoments();
  const others = all.filter(m => m.id !== memoryPick);
  memoryPick = others[Math.floor(Math.random() * others.length)]?.id;
  renderHome();
};
$('#recap-play').onclick = async () => {
  const month = today().slice(0, 7);
  const slides = (await getMoments()).filter(m => m.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date))
    .flatMap(m => m.photos.map(src => ({ src, text: m.text, date: m.date })));
  playSlides(slides);
};

// Story-style slideshow.
let player = null;
function playSlides(slides) {
  if (!slides.length) return toast('No photos to play yet');
  const dlg = $('#player');
  let i = 0;
  const show = () => {
    if (i >= slides.length) return dlg.close();
    const s = slides[i];
    const img = $('#player-img');
    img.src = s.src;
    img.style.animation = 'none'; void img.offsetWidth; img.style.animation = '';
    fill($('#player-cap'), h('small', { textContent: fmtDate(s.date) }), (s.text || '').split('\n')[0]);
    fill($('#player-bars'), ...slides.map((_, j) => h('i', { className: j < i ? 'done' : j === i ? 'cur' : '' })));
    clearTimeout(player);
    player = setTimeout(() => { i++; show(); }, 3500);
  };
  dlg.onclick = e => {
    if (e.target.closest('[data-close]')) return;
    i = Math.max(0, i + (e.clientX < innerWidth / 3 ? -1 : 1));
    show();
  };
  dlg.onclose = () => clearTimeout(player);
  dlg.showModal();
  show();
}

// ---------- Composer ----------
let pendingPhotos = [];
let editingId = null;

function openComposer({ mode = 'write', moment = null, photos = [], link = '', text = '' } = {}) {
  $('#composer').reset();
  editingId = moment?.id || null;
  $('#composer-title').textContent = moment ? 'Edit moment' : 'New moment';
  $('#c-text').value = moment?.text ?? text;
  $('#c-link').value = moment?.link ?? link;
  $('#c-place').value = moment?.place ?? '';
  $('#c-date').value = moment?.date ?? today();
  $('#c-tags').value = (moment?.tags || []).map(t => '#' + t).join(' ');
  pendingPhotos = moment ? [...moment.photos] : photos;
  renderPreviews();
  showSource();
  $('#composer-dialog').showModal();
  (mode === 'link' ? $('#c-link') : $('#c-text')).focus();
}
$('#fab').onclick = () => openComposer();
document.querySelectorAll('[data-compose]').forEach(b => b.addEventListener('click', () => openComposer({ mode: b.dataset.compose })));
$('#quick-snap').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) openComposer({ photos: [await readImage(f)] });
});

async function addPhotos(e) {
  for (const f of e.target.files) pendingPhotos.push(await readImage(f));
  e.target.value = '';
  renderPreviews();
}
$('#c-photos').addEventListener('change', addPhotos);
$('#c-camera').addEventListener('change', addPhotos);
function renderPreviews() {
  fill($('#c-previews'), ...pendingPhotos.map((src, i) => h('figure', {},
    h('img', { src }),
    h('button', { type: 'button', ariaLabel: 'Remove photo', onclick: () => { pendingPhotos.splice(i, 1); renderPreviews(); } }, icon('x')))));
}
function showSource() {
  const s = detectSource($('#c-link').value.trim());
  $('#c-source').textContent = s ? `Saved from ${s.name}` : '';
}
$('#c-link').addEventListener('input', showSource);

$('#composer').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('#c-text').value.trim();
  const link = $('#c-link').value.trim() || extractUrl(text);
  if (!text && !link && !pendingPhotos.length) return toast('Add some words, a link or a photo');
  const existing = editingId && await db.get('moments', editingId);
  await db.put('moments', {
    ...existing,
    id: editingId || uid(),
    created: existing?.created || Date.now(),
    date: $('#c-date').value || today(),
    text, link,
    source: detectSource(link)?.id || null,
    place: $('#c-place').value.trim(),
    tags: [...new Set(($('#c-tags').value.match(/[\w-]+/g) || []).map(t => t.toLowerCase()))],
    photos: pendingPhotos,
    reactions: existing?.reactions || [],
  });
  $('#composer-dialog').close();
  toast(editingId ? 'Updated' : 'Saved');
  refresh();
});

// Content shared into the app (installed web app share target on Android/desktop Chrome, or ?url= links).
function receiveShare() {
  const p = new URLSearchParams(location.search);
  const url = p.get('url') || extractUrl(p.get('text') || '');
  const text = [p.get('title'), p.get('text')].filter(Boolean).join('\n').replace(url, '').trim();
  if (!url && !text) return;
  history.replaceState(null, '', location.pathname);
  openComposer({ mode: 'write', link: url, text });
}

// ---------- Moments feed ----------
const REACTIONS = ['❤️', '😂', '😮', '🥹', '🔥'];
let filter = { type: 'all' };
$('#search').addEventListener('input', () => renderFeed());

async function renderFeed() {
  const moments = await getMoments();
  const q = $('#search').value.toLowerCase().replace(/^#/, '');

  // Filter chips, built from what's actually in the library.
  const srcIds = new Set(moments.map(m => m.source).filter(Boolean));
  const tags = [...new Set(moments.flatMap(m => m.tags))].sort();
  const chip = (label, f, dot) => h('button', {
    className: 'chip' + (JSON.stringify(f) === JSON.stringify(filter) ? ' on' : ''),
    onclick: () => { filter = f; renderFeed(); },
  }, dot && h('i', { style: `background:${dot}` }), label);
  fill($('#chips'), 
    chip('All', { type: 'all' }), chip('Photos', { type: 'photos' }), chip('Links', { type: 'links' }),
    SOURCES.filter(s => srcIds.has(s.id)).map(s => chip(s.name, { type: 'src', v: s.id }, s.color)),
    tags.map(t => chip('#' + t, { type: 'tag', v: t })),
  );

  const list = moments.filter(m =>
    (filter.type === 'all' || (filter.type === 'photos' && m.photos.length) || (filter.type === 'links' && m.link) ||
      (filter.type === 'src' && m.source === filter.v) || (filter.type === 'tag' && m.tags.includes(filter.v))) &&
    (!q || [m.text, m.link, m.place, ...m.tags].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);

  fill($('#feed'), ...(list.length ? list.map(postCard) :
    [h('div', { className: 'card empty', textContent: moments.length ? 'Nothing matches that.' : 'No moments yet. Tap + to save your first one.' })]));
}

function postCard(m) {
  const s = detectSource(m.link);
  let carousel = null, dots = null;
  if (m.photos.length) {
    carousel = h('div', { className: 'carousel' }, m.photos.map(src => h('img', { src, loading: 'lazy' })));
    if (m.photos.length > 1) {
      dots = h('div', { className: 'dots' }, m.photos.map((_, i) => h('i', { className: i ? '' : 'on' })));
      carousel.addEventListener('scroll', () => {
        const i = Math.round(carousel.scrollLeft / carousel.clientWidth);
        [...dots.children].forEach((d, j) => d.classList.toggle('on', i === j));
      }, { passive: true });
    }
  }
  return h('article', { className: 'post' },
    h('div', { className: 'head' },
      h('div', {},
        h('div', { className: 'when', textContent: fmtDate(m.date) }),
        m.place && h('div', { className: 'where' }, icon('pin'), m.place)),
      iconBtn('more', 'More', () => openActions(m))),
    carousel, dots,
    h('div', { className: 'body' },
      m.text && h('p', { className: 'txt', textContent: m.text }),
      s && h('a', { className: 'link-card', href: m.link, target: '_blank', rel: 'noopener' },
        h('span', { className: 'badge', style: `background:${s.color}`, textContent: s.name.slice(0, 2) }),
        h('div', { className: 'meta' }, h('strong', { textContent: `Open in ${s.name}` }), h('div', { className: 'url', textContent: m.link }))),
      m.tags.length ? h('div', { className: 'tags' }, m.tags.map(t => h('button', {
        className: 'tag', textContent: '#' + t, onclick: () => { filter = { type: 'tag', v: t }; renderFeed(); },
      }))) : null,
      h('div', { className: 'reacts' }, REACTIONS.map(r => h('button', {
        className: 'react' + (m.reactions.includes(r) ? ' on' : ''), textContent: r,
        onclick: async () => {
          const reactions = m.reactions.includes(r) ? m.reactions.filter(x => x !== r) : [...m.reactions, r];
          await db.put('moments', { ...m, reactions });
          renderFeed();
        },
      })))),
  );
}

function openActions(m) {
  const close = () => $('#actions-dialog').close();
  const row = (badge, label, fn, cls = '') => h('button', { className: cls, onclick: () => { close(); fn(); } }, badge, label);
  fill($('#actions-body'), h('div', { className: 'action-list' },
    row(h('span', { className: 'badge', style: 'background:var(--accent)' }, icon('share')), 'Share… (Instagram, Messages, AirDrop)',
      () => nativeShare({ text: m.text, url: m.link, images: m.photos })),
    shareTargets(m).map(([s, href]) => row(h('span', { className: 'badge', style: `background:${s.color}`, textContent: s.name.slice(0, 2) }),
      `Post to ${s.name}`, () => window.open(href, '_blank', 'noopener'))),
    h('hr'),
    row(h('span', { className: 'badge', style: 'background:var(--plum)' }, icon('pen')), 'Edit', () => openComposer({ moment: m })),
    row(h('span', { className: 'badge', style: 'background:#d23c3c' }, icon('trash')), 'Delete', async () => {
      if (!confirm('Delete this moment?')) return;
      await db.del('moments', m.id);
      refresh();
    }, 'danger'),
  ));
  $('#actions-dialog').showModal();
}

// ---------- Calendar ----------
let calMonth = new Date(); calMonth.setDate(1);
let selectedDay = today();
$('#cal-prev').onclick = () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCalendar(); };
$('#cal-next').onclick = () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCalendar(); };
$('#cal-today').onclick = () => { calMonth = new Date(); calMonth.setDate(1); selectedDay = today(); renderCalendar(); };

async function renderCalendar() {
  const [moments, events] = await Promise.all([getMoments(), db.all('events')]);
  const byDay = {};
  const slot = k => (byDay[k] ||= { m: [], e: [], s: [] });
  moments.forEach(m => slot(m.date).m.push(m));
  events.forEach(e => slot(e.date).e.push(e));
  const year = calMonth.getFullYear();
  settings.dates.forEach(d => [year - 1, year, year + 1].forEach(y => slot(y + d.date.slice(4)).s.push(d)));

  $('#cal-title').textContent = calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const start = new Date(calMonth); start.setDate(1 - ((start.getDay() + 6) % 7)); // weeks start Monday
  const cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => h('div', { className: 'dow', textContent: d }));
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = isoDate(d);
    const x = byDay[key];
    const photo = x?.m.find(m => m.photos.length)?.photos[0];
    const cls = [d.getMonth() !== calMonth.getMonth() && 'other', key === today() && 'today', key === selectedDay && 'selected', photo && 'has-photo'];
    cells.push(h('button', { className: cls.filter(Boolean).join(' '), onclick: () => { selectedDay = key; renderCalendar(); } },
      photo && h('img', { src: photo, alt: '' }),
      h('span', { textContent: d.getDate() }),
      x && h('span', { className: 'marks' },
        !photo && x.m.length ? h('i') : null, x.e.length ? h('i', { className: 'ev' }) : null, x.s.length ? h('i', { className: 'sp' }) : null)));
  }
  fill($('#cal-grid'), ...cells);

  $('#day-title').textContent = selectedDay === today() ? 'Today' : fmtDate(selectedDay, { weekday: 'long', month: 'long', day: 'numeric' });
  const x = byDay[selectedDay] || { m: [], e: [], s: [] };
  const items = [
    ...x.s.map(d => h('div', { className: 'item' }, h('i', { className: 'k', style: 'background:#e8a33d' }),
      h('div', { className: 't' }, h('div', { textContent: d.title }), h('div', { className: 's', textContent: 'Special date' })))),
    ...x.e.sort((a, b) => (a.time || '').localeCompare(b.time || '')).map(e => h('div', { className: 'item' },
      h('i', { className: 'k', style: 'background:var(--plum)' }),
      h('div', { className: 't' }, h('div', { textContent: e.title }), h('div', { className: 's', textContent: e.time || 'All day' })),
      iconBtn('download', 'Add to Apple/Google/Outlook calendar', () => exportIcs(e)),
      iconBtn('trash', 'Delete', async () => { await db.del('events', e.id); renderCalendar(); renderHome(); }))),
    ...x.m.map(m => h('div', { className: 'item', style: 'cursor:pointer', onclick: () => openActions(m) },
      m.photos[0] ? h('img', { src: m.photos[0] }) : h('i', { className: 'k', style: 'background:var(--accent)' }),
      h('div', { className: 't' }, h('div', { textContent: (m.text || m.link || 'Photo moment').split('\n')[0].slice(0, 80) }),
        h('div', { className: 's', textContent: m.place || 'Moment' })))),
  ];
  fill($('#day-list'), ...(items.length ? items : [h('p', { className: 'hint', textContent: 'Nothing here yet.' })]));
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
  openChat(chat.id);
});
$('#chat-back').onclick = () => $('#chat-layout').classList.remove('show-thread');
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
  if (!activeChat && chats[0] && matchMedia('(min-width: 900px)').matches) activeChat = chats[0].id;

  fill($('#chat-list'), ...chats.map(c => h('li', { className: c.id === activeChat ? 'active' : '', onclick: () => openChat(c.id) },
    h('div', { className: 'avatar', textContent: initials(c.name) }),
    h('div', { className: 't' }, h('strong', { textContent: c.name }),
      h('div', { className: 'last', textContent: !last[c.id] ? 'Say hi 👋' : last[c.id].kind === 'text' ? last[c.id].body : last[c.id].kind === 'sticker' ? 'Sticker' : 'Photo' })))));

  const chat = chats.find(c => c.id === activeChat);
  $('#chat-title').textContent = chat ? chat.name : 'No chat selected';
  $('#chat-avatar').textContent = chat ? initials(chat.name) : '';
  const msgs = chat ? all.filter(m => m.chat === chat.id).sort((a, b) => a.at - b.at) : [];
  let lastDay = '';
  const nodes = [];
  msgs.forEach(m => {
    const day = isoDate(new Date(m.at));
    if (day !== lastDay) nodes.push(h('div', { className: 'day-sep', textContent: day === today() ? 'Today' : fmtDate(day) }));
    lastDay = day;
    nodes.push(h('div', { className: `msg ${m.kind}` },
      m.kind === 'text' ? m.body : h('img', { src: m.body, alt: m.kind }),
      h('time', { textContent: new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })));
  });
  fill($('#messages'), ...(nodes.length ? nodes : [h('p', { className: 'empty', textContent: chat ? 'No messages yet.' : 'Start a chat on the left.' })]));
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

// ---------- Sticker studio ----------
const cv = $('#st-canvas');
const ctx = cv.getContext('2d');
const S = 512;
const st = { img: null, x: 0, y: 0, seeds: [], shape: 'circle' };
const ctrl = id => $('#st-' + id);

ctrl('file').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => { st.img = img; st.x = 0; st.y = 0; st.seeds = []; ctrl('zoom').value = 1; drawSticker(); };
  img.src = URL.createObjectURL(f);
  e.target.value = '';
});
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
  $('.stage-pick').style.display = st.img ? 'none' : '';
  if (!st.img) return;
  const outline = +ctrl('outline').value;
  const caption = ctrl('caption').value.trim();
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
  fill($('#st-library'), ...(list.length ? list.map(s => h('figure', {},
    h('img', { src: s.src, alt: 'Sticker' }),
    h('div', { className: 'row' },
      iconBtn('share', 'Share (e.g. to WhatsApp)', () => nativeShare({ images: [s.src] })),
      iconBtn('download', 'Download PNG', () => download('sticker.png', s.src)),
      iconBtn('trash', 'Delete', async () => { await db.del('stickers', s.id); renderStickers(); })))) :
    [h('p', { className: 'hint', textContent: 'Stickers you make will appear here, ready to use in Chat.' })]));
  fill($('#sticker-tray'), ...(list.length ? list.map(s => h('img', { src: s.src, alt: 'Sticker', onclick: () => sendMessage('sticker', s.src) })) :
    [h('p', { className: 'hint', textContent: 'No stickers yet. Make one in the Stickers tab.' })]));
}

// ---------- Backup to computer ----------
$('#export').onclick = async () => {
  const data = { app: 'moments', version: 2, exported: new Date().toISOString() };
  for (const s of STORES) data[s] = await db.all(s);
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  download(`moments-backup-${today()}.json`, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('#import').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'moments') throw new Error('not a Moments backup');
    let n = 0;
    for (const s of STORES) for (const item of data[s] || []) { await db.put(s, item); n++; }
    settings = (await db.get('settings', 'main')) || settings;
    $('#settings-dialog').close();
    toast(`Restored ${n} items`);
    refresh();
  } catch (err) {
    toast('Could not restore: ' + err.message);
  }
});

// ---------- Boot ----------
function refresh() { renderHome(); renderFeed(); renderCalendar(); renderChats(); renderStickers(); }
(async () => {
  settings = { ...settings, ...(await db.get('settings', 'main')) };
  refresh();
  drawSticker();
  receiveShare();
})();
navigator.storage?.persist?.();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
