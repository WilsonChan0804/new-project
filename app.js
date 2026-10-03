'use strict';

/* =========================================================
   旅程 Planner — 離線可用嘅香港・日本行程
   行程存喺 localStorage；相片／附件存喺 IndexedDB。
   ========================================================= */

const STORE_KEY = 'trip-planner:v2';
const SEED = window.SEED_TRIP || { seedVersion: 0, name: '我的旅程', days: [], ideas: [] };

const TYPES = {
  flight: { label: '航班' },
  train:  { label: '鐵路／地鐵' },
  bus:    { label: '巴士' },
  walk:   { label: '步行' },
  ferry:  { label: '船' },
  hotel:  { label: '住宿' },
  food:   { label: '食飯' },
  sight:  { label: '景點' },
  shop:   { label: '購物' },
  other:  { label: '其他' },
};
const TRANSPORT = new Set(['flight', 'train', 'bus', 'ferry', 'walk']);
const COUNTRIES = { HK: '香港', JP: '日本', UK: '英國' };
const WEEK = '日一二三四五六';
const TAXI_PHRASE = {
  HK: '唔該，我想去呢度。<small>請帶我去這裡 · Please take me here</small>',
  JP: 'ここへ行ってください。<small>請帶我去呢度 · Please take me here</small>',
  UK: 'Please take me here.',
};

/* ---------- icons (stroke, 24×24) ---------- */
const ICONS = {
  flight: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  train: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l1.5-4M15 21l-1.5-4"/><path d="M9 14h.01M15 14h.01"/>',
  bus: '<rect x="4" y="3" width="16" height="14" rx="2"/><path d="M4 10h16M8 21v-4M16 21v-4M8 14h.01M16 14h.01"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="m7 21 3-7 3 3v4M6 12l3-4 4 1 3 3"/>',
  ferry: '<path d="M2 20c2 1 4 1 6 0s4-1 6 0 4 1 6 0M4 17l-1-5h18l-2 5M6 12V7h12v5M12 4v3"/>',
  hotel: '<path d="M3 20V5M3 15h18v5M21 15v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11" r="2"/>',
  food: '<path d="M4 2v7a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V2M7 2v20M20 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3zm0 0v7"/>',
  sight: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  shop: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/>',
  other: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  route: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  skip: '<path d="m5 4 10 8-10 8zM19 5v14"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  car: '<path d="M5 17h14M6 17v2M18 17v2M5 11l2-5h10l2 5M4 11h16v6H4z"/><path d="M7.5 14h.01M16.5 14h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/>',
  move: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  swap: '<path d="m16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z"/>',
  sort: '<path d="M3 6h18M6 12h12M10 18h4"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  ticket: '<path d="M2 9a3 3 0 0 0 0 6v3a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3a3 3 0 0 0 0-6V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M13 5v2M13 17v2M13 11v2"/>',
  bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
};
const icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

/* ---------- small helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const enc = encodeURIComponent;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const isHM = t => /^\d{1,2}:\d{2}$/.test(t || '');
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = x => { x = ((x % 1440) + 1440) % 1440; return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; };
const clampMin = x => Math.max(0, Math.min(23 * 60 + 59, x));

function durOf(it) {
  if (!isHM(it.time) || !isHM(it.end)) return null;
  return (toMin(it.end) - toMin(it.time) + 1440) % 1440;
}
function durStr(m) {
  if (m == null) return '';
  const h = Math.floor(m / 60), mm = m % 60;
  return h && mm ? `${h}小時${mm}分` : h ? `${h}小時` : `${mm}分`;
}
function dateParts(s) {
  const d = new Date(s + 'T00:00');
  return { d: d.getDate(), m: d.getMonth() + 1, w: WEEK[d.getDay()], y: d.getFullYear() };
}
function fmtDate(s, long = false) {
  if (!s) return '未定日期';
  const p = dateParts(s);
  return long ? `${p.m}月${p.d}日（星期${p.w}）` : `${p.m}月${p.d}日`;
}
function addDays(s, n) {
  const d = s ? new Date(s + 'T00:00') : new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
}
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00') - new Date(a + 'T00:00')) / 86400000);
function normUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u;
}
const short = s => (s || '').split(/[,(（]/)[0].trim();

/* ---------- link builders ---------- */
const gmapSearch = q => `https://www.google.com/maps/search/?api=1&query=${enc(q)}`;
const gmapDir = (from, to, mode = 'transit') =>
  `https://www.google.com/maps/dir/?api=1${from ? `&origin=${enc(from)}` : ''}&destination=${enc(to)}&travelmode=${mode}`;
const gsearch = q => `https://www.google.com/search?q=${enc(q)}`;
const gimages = q => `https://www.google.com/search?tbm=isch&q=${enc(q)}`;

/** 呢項行程完咗之後人喺邊 —— 用嚟計下一項嘅路線起點 */
function locOf(it) {
  if (!it) return '';
  if (TRANSPORT.has(it.type)) return it.to || '';
  return it.place || it.address || '';
}
const countryOf = (it, day) => it.country || (day && day.country) || '';
const nameOf = (raw, zh) => zh || short(raw);

function stationMapQuery(name, country) {
  if (country === 'JP') return `${name} 構内図`;
  if (country === 'HK') return `${name} 站 出口 地圖`;
  return `${name} station map`;
}

function linksFor(it, prevLoc, country) {
  const L = [];
  const add = (label, url, kind = '', ic = '') => { if (url) L.push({ label, url, kind, ic }); };
  const t = it.type;
  if (it.url) add(t === 'hotel' ? '酒店網站' : it.type === 'food' ? '網站／訂位' : '官方網站', normUrl(it.url), 'primary', 'ext');

  if (t === 'flight') {
    const no = (it.number || '').replace(/\s+/g, '');
    if (no && !no.includes('待填')) {
      add('航班狀態', `https://www.flightradar24.com/data/flights/${enc(no.toLowerCase())}`, '', 'flight');
      add('Google 航班', gsearch(`${it.number} flight status`));
    }
    if (it.from) add(`去${nameOf(it.from, it.fromZh)}`, gmapDir('', it.from), '', 'route');
    if (it.to) add('航廈圖', gimages(`${it.to} terminal map`), '', 'image');
  } else if (t === 'walk') {
    if (it.to) add('步行路線', gmapDir(it.from || prevLoc, it.to, 'walking'), 'primary-soft', 'route');
  } else if (TRANSPORT.has(t)) {
    if (it.to) add('路線及班次', gmapDir(it.from || prevLoc, it.to), 'primary-soft', 'route');
    if (it.from) add(`去${nameOf(it.from, it.fromZh)}`, gmapDir('', it.from), '', 'route');
    if (t === 'train') {
      if (it.from) add(`${nameOf(it.from, it.fromZh)} 站內圖`, gimages(stationMapQuery(it.from, country)), '', 'image');
      if (it.to) add(`${nameOf(it.to, it.toZh)} 站內圖`, gimages(stationMapQuery(it.to, country)), '', 'image');
    }
    if (it.timetableUrl) add('全日時刻表', normUrl(it.timetableUrl), '', 'clock');
    if (t === 'train' && country === 'HK') add('港鐵行程指南', 'https://www.mtr.com.hk/ch/customer/jp/index.php');
    if (t === 'train' && country === 'JP') add('Jorudan 轉乘', 'https://world.jorudan.co.jp/mln/zh-tw/');
  } else {
    const q = locOf(it) || it.titleJa || it.title;
    add('地圖', gmapSearch(q), 'primary-soft', 'map');
    if (prevLoc && prevLoc !== q) add('由上一站去', gmapDir(prevLoc, q), '', 'route');
    add('由我而家位置去', gmapDir('', q), '', 'route');
    if (t === 'food') {
      const name = it.titleJa || it.place || it.title;
      if (country === 'JP') add('Tabelog 食評', gsearch(`tabelog ${name}`));
      if (country === 'HK') add('OpenRice 食評', gsearch(`openrice ${name}`));
      add('Google 食評', gsearch(`${name} 評價`));
    } else if (t !== 'hotel' || country) {
      add('附近食肆', gmapSearch(`restaurants near ${q}`));
    }
  }
  (it.stationLinks || []).forEach(l => add(l.label, normUrl(l.url), '', 'map'));
  (it.links || []).forEach(l => add(l.label || '連結', normUrl(l.url), 'plain', 'ext'));
  return L;
}

/* ---------- IndexedDB：附件同離線相片 ---------- */
const PhotoDB = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('trip-planner-photos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos');
      r.onsuccess = () => { this._db = r.result; res(this._db); };
      r.onerror = () => rej(r.error);
    });
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('photos', mode);
      const req = fn(tx.objectStore('photos'));
      tx.oncomplete = () => res(req ? req.result : undefined);
      tx.onerror = () => rej(tx.error);
    });
  },
  put(id, blob) { return this.run('readwrite', s => s.put(blob, id)); },
  get(id) { return this.run('readonly', s => s.get(id)); },
  del(id) { return this.run('readwrite', s => s.delete(id)); },
  keys() { return this.run('readonly', s => s.getAllKeys()); },
};
const photoURLs = new Map();

async function hydratePhotos(root = document) {
  for (const img of root.querySelectorAll('img[data-photo]')) {
    const id = img.dataset.photo;
    if (!photoURLs.has(id)) {
      const blob = await PhotoDB.get(id).catch(() => null);
      if (!blob) { img.alt = '搵唔到'; continue; }
      photoURLs.set(id, URL.createObjectURL(blob));
    }
    img.src = photoURLs.get(id);
  }
}

function resizeImage(file, max = 2000) {
  return new Promise(res => {
    const img = new Image();
    const u = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u);
      c.toBlob(b => res(b || file), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(u); res(file); };
    img.src = u;
  });
}

/* ---------- 地點封面相（Wikipedia），第一次上網時下載，之後離線可用 ---------- */
const coverURLs = new Map();
const coverPending = new Map();

async function fetchWikiImage(wiki) {
  const i = wiki.indexOf(':');
  const lang = wiki.slice(0, i), title = wiki.slice(i + 1);
  const api = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=pageimages&piprop=thumbnail&pithumbsize=1000&redirects=1&titles=${enc(title)}`;
  const j = await (await fetch(api)).json();
  const page = Object.values(j.query?.pages || {})[0];
  const src = page?.thumbnail?.source;
  if (!src) return null;
  const r = await fetch(src);
  return r.ok ? r.blob() : null;
}

function getCover(wiki) {
  if (coverURLs.has(wiki)) return Promise.resolve(coverURLs.get(wiki));
  if (coverPending.has(wiki)) return coverPending.get(wiki);
  const p = (async () => {
    const key = 'cover:' + wiki;
    let blob = await PhotoDB.get(key).catch(() => null);
    if (!blob && navigator.onLine) {
      blob = await fetchWikiImage(wiki).catch(() => null);
      if (blob) await PhotoDB.put(key, blob).catch(() => {});
      else { coverURLs.set(wiki, null); return null; } // 試過網絡都冇
    }
    if (!blob) return null; // 離線又未下載：下次再試
    const url = URL.createObjectURL(blob);
    coverURLs.set(wiki, url);
    return url;
  })().finally(() => coverPending.delete(wiki));
  coverPending.set(wiki, p);
  return p;
}

function hydrateCovers(root = document) {
  root.querySelectorAll('[data-cover]').forEach(async el => {
    const url = await getCover(el.dataset.cover);
    if (url) { el.style.backgroundImage = `url("${url}")`; el.classList.add('loaded'); }
    else el.classList.add('nocover');
  });
}

function allItems() { return [...trip.days.flatMap(d => d.items), ...trip.ideas]; }
const allWikis = () => [...new Set(allItems().map(i => i.wiki).filter(Boolean))];

async function prefetchCovers(force = false) {
  if (!navigator.onLine) return;
  const wikis = allWikis();
  let done = 0;
  for (const w of wikis) {
    if (force) { coverURLs.delete(w); await PhotoDB.del('cover:' + w).catch(() => {}); }
    await getCover(w);
    done++;
    const el = $('#coverStatus');
    if (el) el.textContent = `離線相片：${done}／${wikis.length}`;
  }
  updateCoverStatus();
}
async function updateCoverStatus() {
  const el = $('#coverStatus');
  if (!el) return;
  const keys = new Set(await PhotoDB.keys().catch(() => []));
  const wikis = allWikis();
  const have = wikis.filter(w => keys.has('cover:' + w)).length;
  el.textContent = `離線地點相：已下載 ${have}／${wikis.length}`;
}

/* ---------- Wikimedia Commons 搵相（頭 3 張） ---------- */
async function commonsSearch(q, n = 3) {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${enc('filetype:bitmap ' + q)}&gsrnamespace=6&gsrlimit=${n}&prop=imageinfo&iiprop=url&iiurlwidth=1000`;
  const j = await (await fetch(api)).json();
  return Object.values(j.query?.pages || {})
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map(p => ({ title: p.title.replace(/^File:/, ''), thumb: p.imageinfo?.[0]?.thumburl, full: p.imageinfo?.[0]?.url, page: p.imageinfo?.[0]?.descriptionurl }))
    .filter(x => x.thumb);
}

function imageQueries(it, country) {
  const qs = [];
  if (it.type === 'flight') {
    if (it.to) qs.push(`${it.to} terminal`);
    if (it.from) qs.push(`${it.from} terminal`);
  } else if (TRANSPORT.has(it.type)) {
    for (const s of [it.from, it.to]) if (s) qs.push(country === 'JP' ? `${short(s)} 構内図` : `${short(s)} station`);
    for (const s of [it.from, it.to]) if (s) qs.push(short(s));
  }
  qs.push(it.titleJa || it.place || it.title);
  return [...new Set(qs.filter(Boolean))].slice(0, 4);
}

/* ---------- state ---------- */
let trip = load() || freshSeed();
const ui = { tab: 'plan', open: new Set(), collapsed: new Set(), img: {} };
const undoStack = [];

function freshSeed() { return JSON.parse(JSON.stringify(SEED)); }
function load() {
  try { const s = localStorage.getItem(STORE_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(trip)); } catch { toast('⚠️ 儲存唔到——手機空間可能唔夠'); }
}
function normalize() {
  trip.days = trip.days || [];
  trip.ideas = trip.ideas || [];
  trip.days.forEach(d => { d.items = d.items || []; });
  trip.days.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
}
/** 所有改動都經呢度，咁先可以「還原」 */
function commit(fn, msg) {
  undoStack.push(JSON.stringify(trip));
  if (undoStack.length > 60) undoStack.shift();
  fn();
  normalize();
  save();
  render();
  if (msg) toast(msg, true);
}
function undo() {
  if (!undoStack.length) return toast('冇嘢可以還原');
  trip = JSON.parse(undoStack.pop());
  save();
  render();
  toast('已還原');
}

function findItem(id) {
  for (const day of trip.days) {
    const i = day.items.findIndex(x => x.id === id);
    if (i >= 0) return { list: day.items, index: i, item: day.items[i], day };
  }
  const i = trip.ideas.findIndex(x => x.id === id);
  if (i >= 0) return { list: trip.ideas, index: i, item: trip.ideas[i], day: null };
  return null;
}
const findDay = id => trip.days.find(d => d.id === id);

/* ---------- 時間槽邏輯 ---------- */
/** 上／下移：兩項交換位置，同時交換時段。每項保留自己嘅時長，中間嘅空檔不變。 */
function swapSlots(list, i, j) {
  if (i < 0 || j >= list.length) return;
  const a = list[i], b = list[j];
  if (isHM(a.time) && isHM(b.time)) {
    const S = toMin(a.time);
    const dA = durOf(a) ?? 0, dB = durOf(b) ?? 0;
    const aEnd = toMin(a.time) + dA;
    const gap = Math.max(0, toMin(b.time) - aEnd);
    const hadEndA = isHM(a.end), hadEndB = isHM(b.end);
    b.time = fromMin(S);
    if (hadEndB) b.end = fromMin(S + dB);
    a.time = fromMin(S + dB + gap);
    if (hadEndA) a.end = fromMin(S + dB + gap + dA);
  }
  list[i] = b;
  list[j] = a;
}
/** 由 index 開始，將之後所有未完成嘅項目推後／提早 mins 分鐘 */
function shiftFrom(list, index, mins) {
  list.slice(index).forEach(it => {
    if (it.status === 'done' || !isHM(it.time)) return;
    const d = durOf(it);
    it.time = fromMin(clampMin(toMin(it.time) + mins));
    if (d != null) it.end = fromMin(toMin(it.time) + d);
  });
}

/* ---------- rendering ---------- */
function render() {
  normalize();
  $('#tripName').textContent = trip.name || '我的旅程';
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.id === ui.tab));
  const view = $('#view');
  const stripLeft = $('.strip')?.scrollLeft || 0;
  view.innerHTML = ({ plan: renderPlan, bookings: renderBookings, ideas: renderIdeas, info: renderInfo }[ui.tab])();
  const strip = $('.strip');
  if (strip) strip.scrollLeft = stripLeft;
  if (ui.activeDay) $(`.strip-day[data-id="${ui.activeDay}"]`)?.classList.add('is-active');
  hydratePhotos(view);
  hydrateCovers(view);
  if (ui.tab === 'info') { showStorageInfo(); updateCoverStatus(); }
}

function renderHero() {
  const first = trip.days[0]?.date, last = trip.days[trip.days.length - 1]?.date;
  const today = todayStr();
  let countdown = '', cdLabel = '';
  if (first) {
    const n = daysBetween(today, first);
    if (n > 0) { countdown = n; cdLabel = '日後出發'; }
    else if (last && daysBetween(today, last) >= 0) { countdown = `D${daysBetween(first, today) + 1}`; cdLabel = '旅程進行中'; }
    else { countdown = '✓'; cdLabel = '旅程完滿結束'; }
  }
  const jpDays = trip.days.filter(d => d.country === 'JP').length;
  const hkDays = trip.days.filter(d => d.country === 'HK').length;
  const seedNote = SEED.seedVersion > (trip.seedVersion || 0)
    ? `<div class="notice">${icon('info')}<div class="grow"><b>有新版行程資料</b><br><span class="muted">載入會取代你喺手機改過嘅內容（之後仍可還原）。</span></div><button class="btn dark sm" data-act="load-seed">載入</button></div>` : '';
  return `${seedNote}
  <section class="hero">
    <div class="hero-text">
      <p class="eyebrow">${first ? `${fmtDate(first)} – ${fmtDate(last)} · ${trip.days.length} 日` : '未有日子'}</p>
      <h1 class="display">${esc(trip.name || '我的旅程')}</h1>
    </div>
    <div class="stats">
      <div class="stat accent"><b>${countdown}</b><span>${cdLabel}</span></div>
      <div class="stat"><b>${jpDays}</b><span>日本日數</span></div>
      <div class="stat"><b>${hkDays}</b><span>香港日數</span></div>
    </div>
  </section>`;
}

function renderStrip() {
  const today = todayStr();
  return `<nav class="strip" aria-label="日子">${trip.days.map(d => {
    const p = dateParts(d.date);
    return `<button class="strip-day c-${d.country || 'x'} ${d.group ? 'g-tour' : ''} ${d.date === today ? 'is-today' : ''} ${d.items.length ? '' : 'is-empty'}" data-act="goto-day" data-id="${d.id}">
      <span class="w">${p.w}</span><b>${p.d}</b><span class="c">${esc(short(d.city || '') || '—')}</span></button>`;
  }).join('')}</nav>`;
}

function renderPlan() {
  const today = todayStr();
  let html = renderHero() + renderStrip();
  if (!trip.days.length) html += `<div class="card empty">未有日子。喺下面加第一日，或者去「資訊」匯入備份。</div>`;
  let prevLoc = '';
  let lastMonth = '';
  trip.days.forEach((day, di) => {
    const p = day.date ? dateParts(day.date) : null;
    const month = p ? `${p.y}年${p.m}月` : '';
    if (month && month !== lastMonth) { html += `<h2 class="month">${month}</h2>`; lastMonth = month; }
    html += renderDay(day, di, today, prevLoc);
    const locs = day.items.filter(i => i.status !== 'skipped').map(locOf).filter(Boolean);
    if (locs.length) prevLoc = locs[locs.length - 1];
  });
  html += `<button class="btn ghost wide" data-act="add-day">${icon('plus')} 加一日</button>`;
  return html;
}

function renderDay(day, di, today, prevLoc) {
  const isToday = day.date === today;
  const empty = !day.items.length;
  const collapsed = ui.collapsed.has(day.id);
  const p = day.date ? dateParts(day.date) : { d: '?', m: '', w: '' };
  const active = day.items.filter(i => i.status !== 'skipped');
  const locs = active.map(locOf).filter(Boolean).filter((v, i, a) => v !== a[i - 1]).slice(0, 10);
  const routeUrl = locs.length >= 2 ? 'https://www.google.com/maps/dir/' + locs.map(enc).join('/') : '';
  const cover = day.items.find(i => i.wiki && i.type !== 'hotel')?.wiki || day.items.find(i => i.wiki)?.wiki;

  let nextId = null;
  if (isToday) {
    const now = nowHM();
    const pending = day.items.filter(i => !i.status || i.status === 'planned');
    nextId = (pending.find(i => !isHM(i.time) || (i.end || i.time) >= now) || {}).id;
  }

  if (empty) {
    return `<section class="day day-empty c-${day.country || 'x'} ${isToday ? 'today' : ''}" id="day-${day.id}">
      <div class="dnum"><b>${p.d}</b><span>${p.m}月 · ${p.w}</span></div>
      <div class="grow"><h3>${esc(day.title || '未有安排')}</h3><p class="muted">${esc(day.city || '')}</p></div>
      <button class="icon-btn" data-act="insert" data-day="${day.id}" data-index="0" aria-label="加項目">${icon('plus')}</button>
      <button class="icon-btn" data-act="edit-day" data-id="${day.id}" aria-label="改日子">${icon('edit')}</button>
    </section>`;
  }

  let items = '';
  day.items.forEach((it, idx) => {
    items += renderInsert(day.id, idx);
    items += renderItem(it, { prevLoc, country: countryOf(it, day), isNext: it.id === nextId, isToday, dayId: day.id });
    if (it.status !== 'skipped' && locOf(it)) prevLoc = locOf(it);
  });
  items += renderInsert(day.id, day.items.length);

  return `<section class="day c-${day.country || 'x'} ${isToday ? 'today' : ''} ${collapsed ? 'collapsed' : ''} ${day.group ? 'g-tour' : ''}" id="day-${day.id}">
    <header class="day-head ${cover ? 'has-cover' : ''}">
      ${cover ? `<div class="day-cover" data-cover="${esc(cover)}"></div>` : ''}
      <div class="day-head-inner" data-act="toggle-day" data-id="${day.id}">
        <div class="dnum"><b>${p.d}</b><span>${p.m}月 · 星期${p.w}</span></div>
        <div class="grow">
          <div class="day-tags">
            <span class="tag">第${di + 1}日</span>
            ${day.country ? `<span class="tag country">${COUNTRIES[day.country] || day.country}</span>` : ''}
            ${day.group ? `<span class="tag tour">跟團</span>` : ''}
            ${isToday ? `<span class="tag now">今日</span>` : ''}
          </div>
          <h3>${esc(day.title || day.city || '')}</h3>
          <p class="muted">${esc(day.city || '')}${day.cityJa && day.cityJa !== day.city ? ` · ${esc(day.cityJa)}` : ''} · ${day.items.length} 項</p>
        </div>
        <span class="chev">${icon('chevron')}</span>
      </div>
    </header>
    <div class="day-tools">
      ${routeUrl ? `<a class="chip dark" href="${routeUrl}" target="_blank" rel="noopener">${icon('route')}全日路線</a>` : ''}
      ${day.city ? `<a class="chip" href="${gsearch(`${short(day.cityJa || day.city)} 天氣 ${fmtDate(day.date)}`)}" target="_blank" rel="noopener">${icon('cloud')}天氣</a>` : ''}
      <button class="chip" data-act="sort-day" data-id="${day.id}">${icon('sort')}按時間排</button>
      <button class="chip" data-act="edit-day" data-id="${day.id}">${icon('edit')}改日子</button>
    </div>
    ${day.notes ? `<div class="day-notes">${esc(day.notes)}</div>` : ''}
    <div class="timeline">${items}</div>
  </section>`;
}

function renderInsert(dayId, index) {
  return `<div class="insert"><button data-act="insert" data-day="${dayId}" data-index="${index}" aria-label="喺呢度加項目">${icon('plus')}</button></div>`;
}

function renderItem(it, { prevLoc = '', country = '', isNext = false, isToday = false, idea = false } = {}) {
  const T = TYPES[it.type] || TYPES.other;
  const open = ui.open.has(it.id);
  const status = it.status || 'planned';
  const d = durOf(it);
  const isT = TRANSPORT.has(it.type);

  const sub = [];
  if (isT) {
    if (it.from || it.to) sub.push(`${nameOf(it.from, it.fromZh) || '?'} → ${nameOf(it.to, it.toZh) || '?'}`);
    if (it.number) sub.push(it.number);
  } else if (it.address) sub.push(it.address);
  if (it.ref) sub.push(`訂位 ${it.ref}`);

  const tags = [
    isNext ? `<span class="tag now">下一項</span>` : '',
    status === 'done' ? `<span class="tag ok">${icon('check')}完成</span>` : '',
    status === 'skipped' ? `<span class="tag">已跳過</span>` : '',
    it.planB ? `<span class="tag warn">有後備</span>` : '',
    it.menu ? `<span class="tag">菜單</span>` : '',
    it.timetable?.length ? `<span class="tag">時刻表</span>` : '',
    it.photos?.length ? `<span class="tag">${icon('image')}${it.photos.length}</span>` : '',
  ].join('');

  const links = linksFor(it, prevLoc, country);
  const shown = open ? links : links.slice(0, 3);
  const linkHtml = shown.map(l => `<a class="chip ${l.kind}" href="${esc(l.url)}" target="_blank" rel="noopener">${l.ic ? icon(l.ic) : ''}${esc(l.label)}</a>`).join('')
    + (!open && links.length > 3 ? `<button class="chip more" data-act="toggle-item" data-id="${it.id}">+${links.length - 3}</button>` : '');

  const time = isHM(it.time)
    ? `<b>${esc(it.time)}</b>${isHM(it.end) ? `<span>${esc(it.end)}</span>` : ''}${d ? `<em>${durStr(d)}</em>` : ''}`
    : `<b class="muted">—</b>`;

  return `<article class="item t-${it.type} status-${status} ${isNext ? 'next' : ''} ${open ? 'open' : ''}" id="item-${it.id}">
    <div class="item-time">${time}</div>
    <div class="item-rail"><span class="dot">${icon(it.type)}</span></div>
    <div class="item-card">
      <div class="item-head" data-act="toggle-item" data-id="${it.id}">
        <div class="grow">
          <div class="item-kicker">${T.label}${tags}</div>
          <h4 class="item-title">${esc(it.title || '（未命名）')}</h4>
          ${it.titleJa && it.titleJa !== it.title ? `<p class="item-ja" lang="ja">${esc(it.titleJa)}</p>` : ''}
          ${sub.length ? `<p class="item-sub">${esc(sub.join(' · '))}</p>` : ''}
        </div>
        ${it.wiki ? `<div class="thumb" data-cover="${esc(it.wiki)}"></div>` : ''}
      </div>
      <div class="links">${linkHtml}</div>
      ${open ? renderDetails(it, country, isToday, idea) : ''}
    </div>
  </article>`;
}

function renderDetails(it, country, isToday, idea) {
  const status = it.status || 'planned';
  const kv = [
    ['地址', it.address], ['營業時間', it.hours], ['訂位號碼', it.ref], ['費用', it.cost], ['備註', it.notes],
  ].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  const photos = (it.photos || []).map(p => `<img data-photo="${p}" data-act="view-photo" data-id="${it.id}" alt="附件">`).join('');
  const isT = TRANSPORT.has(it.type);
  const btn = (act, ic, label, extra = '') => `<button class="btn sm ${extra}" data-act="${act}" data-id="${it.id}">${icon(ic)}${label}</button>`;
  return `<div class="details">
    ${it.wiki ? `<div class="hero-photo" data-cover="${esc(it.wiki)}"><span>相片：Wikipedia</span></div>` : ''}
    ${kv ? `<dl class="kv">${kv}</dl>` : ''}
    ${it.planB ? `<div class="planb"><b>後備方案</b><p>${esc(it.planB)}</p></div>` : ''}
    ${it.menu ? renderMenu(it.menu) : ''}
    ${it.timetable?.length || it.timetableNote ? renderTimetable(it, isToday) : ''}
    ${renderImagePanel(it, country)}
    ${photos ? `<div class="sec"><h5>${icon('image')}附件（離線可睇）</h5><div class="photos">${photos}</div></div>` : ''}
    <div class="actions">
      ${status !== 'done' ? btn('status-done', 'check', '完成') : ''}
      ${status !== 'skipped' ? btn('status-skip', 'skip', '跳過') : ''}
      ${status !== 'planned' ? btn('status-reset', 'reset', '重設') : ''}
      ${btn('edit-item', 'edit', '修改')}
      ${idea ? '' : btn('move-up', 'up', '上移') + btn('move-down', 'down', '下移')}
      ${btn('move-item', 'move', idea ? '排入日子' : '搬去第日')}
      ${!idea && isHM(it.time) ? btn('shift', 'clock', '延遲') : ''}
      ${it.planB ? btn('swap-planb', 'swap', '用後備方案') : ''}
      ${it.titleJa || it.address || (isT && it.to) ? btn('taxi', 'car', '俾司機睇') : ''}
      ${btn('add-photo', 'camera', '加相')}
      ${btn('dup-item', 'copy', '複製')}
      ${btn('del-item', 'trash', '刪除', 'danger')}
    </div>
  </div>`;
}

function renderMenu(menu) {
  const rows = (menu.items || []).map(m => `<li class="${m.star ? 'star' : ''}">
      <div class="grow">
        <div class="mname">${m.star ? icon('star', 'gold') : ''}${esc(m.name)}</div>
        ${m.ja ? `<div class="mja" lang="ja">${esc(m.ja)}</div>` : ''}
        ${m.desc ? `<div class="mdesc">${esc(m.desc)}</div>` : ''}
      </div>
      ${m.price ? `<div class="mprice">${esc(m.price)}</div>` : ''}
    </li>`).join('');
  return `<div class="sec menu">
    <h5>${icon('food')}菜單及推介${menu.url ? `<a href="${esc(normUrl(menu.url))}" target="_blank" rel="noopener">完整菜單 ${icon('ext')}</a>` : ''}</h5>
    <ul>${rows}</ul>
    ${menu.tips ? `<p class="hint">${esc(menu.tips)}</p>` : ''}
  </div>`;
}

function renderTimetable(it, isToday) {
  const now = nowHM();
  const rows = it.timetable || [];
  const nextIdx = isToday ? rows.findIndex(r => r.dep >= now) : -1;
  const body = rows.map((r, i) => `<tr class="${i === nextIdx ? 'next' : ''} ${r.note ? 'pick' : ''}">
      <td><b>${esc(r.dep)}</b></td><td>${esc(r.arr || '')}</td><td>${esc(r.name || '')}</td><td>${esc(r.note || '')}${i === nextIdx ? ' <span class="tag now">下一班</span>' : ''}</td>
    </tr>`).join('');
  return `<div class="sec timetable">
    <h5>${icon('clock')}時刻表${it.timetableUrl ? `<a href="${esc(normUrl(it.timetableUrl))}" target="_blank" rel="noopener">全日 ${icon('ext')}</a>` : ''}</h5>
    ${rows.length ? `<table><thead><tr><th>開出</th><th>到達</th><th>班次</th><th></th></tr></thead><tbody>${body}</tbody></table>` : ''}
    ${it.timetableNote ? `<p class="hint">${esc(it.timetableNote)}</p>` : ''}
  </div>`;
}

function renderImagePanel(it, country) {
  const qs = imageQueries(it, country);
  const st = ui.img[it.id];
  return `<div class="sec imgsearch">
    <h5>${icon('search')}搵相／站內圖（頭 3 張）</h5>
    <div class="qchips">${qs.map(q => `<button class="chip ${st?.q === q ? 'dark' : ''}" data-act="img-search" data-id="${it.id}" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
      <button class="chip" data-act="img-custom" data-id="${it.id}">${icon('edit')}自己打</button></div>
    <div id="imgres-${it.id}">${renderImgResults(it.id)}</div>
  </div>`;
}

function renderImgResults(id) {
  const st = ui.img[id];
  if (!st) return `<p class="hint">揀一個關鍵字，會由 Wikimedia Commons 搵頭 3 張相；撳「儲存」就會存落手機，冇網都睇到。</p>`;
  if (st.loading) return `<p class="hint">搵緊「${esc(st.q)}」…</p>`;
  const google = `<a class="chip" href="${gimages(st.q)}" target="_blank" rel="noopener">${icon('ext')}喺 Google 圖片睇更多</a>`;
  if (st.error) return `<p class="hint">搵唔到（${esc(st.error)}）。</p>${google}`;
  if (!st.items.length) return `<p class="hint">Commons 冇「${esc(st.q)}」嘅相。</p>${google}`;
  return `<div class="imggrid">${st.items.map((r, i) => `<figure>
      <img src="${esc(r.thumb)}" alt="${esc(r.title)}" loading="lazy">
      <figcaption>
        <button class="btn sm dark" data-act="img-save" data-id="${id}" data-i="${i}">${st.saved?.[i] ? icon('check') + '已儲存' : icon('download') + '儲存'}</button>
        <a class="btn sm" href="${esc(r.full)}" target="_blank" rel="noopener">${icon('ext')}大圖</a>
      </figcaption></figure>`).join('')}</div>${google}`;
}

function renderBookings() {
  const rows = [];
  trip.days.forEach((day, di) => day.items.forEach(it => {
    if (it.ref || it.type === 'flight' || (it.type === 'hotel' && it.url) || (it.type === 'food' && it.url) || it.photos?.length) rows.push({ it, day, di });
  }));
  trip.ideas.forEach(it => { if (it.ref) rows.push({ it, day: null }); });
  let html = `<section class="page-head"><p class="eyebrow">訂單及票據</p><h1 class="display sm">訂單</h1>
    <p class="muted">所有航班、住宿、餐廳訂位同有訂位號碼嘅項目。冇網都睇到——記得將電子機票、QR code 截圖「加相」。</p></section>`;
  if (!rows.length) html += `<div class="card empty">未有訂單。喺任何項目加「訂位號碼」就會喺度出現。</div>`;
  for (const { it, day, di } of rows) {
    const T = TYPES[it.type] || TYPES.other;
    const when = day ? `第${di + 1}日 · ${fmtDate(day.date, true)}${isHM(it.time) ? ' · ' + it.time : ''}` : '未排日子';
    const photos = (it.photos || []).map(p => `<img data-photo="${p}" data-act="view-photo" data-id="${it.id}" alt="附件">`).join('');
    const extra = TRANSPORT.has(it.type) ? [it.number, it.from || it.to ? `${nameOf(it.from, it.fromZh)} → ${nameOf(it.to, it.toZh)}` : ''].filter(Boolean).join(' · ') : (it.address || '');
    const missing = it.type === 'flight' && (!it.number || it.number.includes('待填'));
    html += `<div class="card booking t-${it.type}">
      <div class="booking-row">
        <span class="dot">${icon(it.type)}</span>
        <div class="grow">
          <p class="eyebrow">${esc(when)} · ${T.label}</p>
          <h4 class="item-title">${esc(it.title)}</h4>
          ${it.titleJa && it.titleJa !== it.title ? `<p class="item-ja" lang="ja">${esc(it.titleJa)}</p>` : ''}
          ${extra ? `<p class="item-sub">${esc(extra)}</p>` : ''}
          ${it.ref ? `<div class="ref">${esc(it.ref)}</div>` : `<p class="hint ${missing ? 'warn' : ''}">${missing ? '⚠️ 航班資料未填' : '未有訂位號碼'}</p>`}
        </div>
        ${it.ref ? `<button class="btn sm" data-act="copy" data-val="${esc(it.ref)}">${icon('copy')}複製</button>` : ''}
      </div>
      ${photos ? `<div class="photos">${photos}</div>` : ''}
      <div class="links">
        ${it.url ? `<a class="chip dark" href="${esc(normUrl(it.url))}" target="_blank" rel="noopener">${icon('ext')}開訂單／網站</a>` : ''}
        <button class="chip" data-act="goto-item" data-id="${it.id}">${icon('calendar')}喺行程睇</button>
        <button class="chip" data-act="edit-item" data-id="${it.id}">${icon('edit')}修改</button>
        <button class="chip" data-act="add-photo" data-id="${it.id}">${icon('camera')}加票據相</button>
      </div>
    </div>`;
  }
  return html;
}

function renderIdeas() {
  let html = `<section class="page-head"><p class="eyebrow">後備清單</p><h1 class="display sm">靈感</h1>
    <p class="muted">「可能會去」嘅地方——落雨、臨時改計劃、有空檔時用。撳「排入日子」放落行程。刪除日子時，嗰日嘅項目都會搬嚟呢度。</p></section>`;
  html += `<div class="day"><div class="timeline">`;
  html += trip.ideas.length
    ? trip.ideas.map(it => renderItem(it, { country: it.country || '', idea: true })).join('')
    : `<div class="empty">未有靈感。</div>`;
  html += `</div></div><button class="btn ghost wide" data-act="add-idea">${icon('plus')} 加靈感</button>`;
  return html;
}

function renderInfo() {
  const hotels = [...new Map(allItems().filter(i => i.type === 'hotel' && (i.address || i.place)).map(h => [h.address || h.place, h])).values()];
  return `<section class="page-head"><p class="eyebrow">工具箱</p><h1 class="display sm">資訊</h1></section>
  <div class="grid-cards">
    <div class="card">
      <h2>${icon('info')}緊急電話</h2>
      <h3>香港</h3>
      <ul class="plain">
        <li>警察／消防／救護：<a href="tel:999"><b>999</b></a></li>
        <li>旅發局旅客熱線：<a href="tel:+85225081234">+852 2508 1234</a></li>
      </ul>
      <h3>日本</h3>
      <ul class="plain">
        <li>警察：<a href="tel:110"><b>110</b></a> · 消防／救護：<a href="tel:119"><b>119</b></a></li>
        <li>JNTO 旅客熱線（24小時，英／中）：<a href="tel:+815038162787">050-3816-2787</a></li>
      </ul>
      <h3>英國</h3>
      <ul class="plain"><li>Emergency：<a href="tel:999"><b>999</b></a> / <a href="tel:112">112</a></li></ul>
    </div>

    <div class="card">
      <h2>${icon('hotel')}住宿地址</h2>
      <ul class="plain">${hotels.map(h => `<li><b>${esc(h.title)}</b>${h.titleJa ? `<br><span lang="ja">${esc(h.titleJa)}</span>` : ''}${h.address ? `<br><span class="muted">${esc(h.address)}</span>` : ''}<br><button class="chip" data-act="taxi" data-id="${h.id}">${icon('car')}俾司機睇</button></li>`).join('')}</ul>
    </div>

    <div class="card">
      <h2>${icon('download')}冇網準備</h2>
      <p class="muted" id="coverStatus">離線地點相：計緊…</p>
      <div class="btn-row"><button class="btn dark sm" data-act="prefetch">${icon('download')}下載／更新所有地點相</button></div>
      <ul class="plain">
        <li>上網時打開一次，再「加到主畫面」——之後冇網都開到。</li>
        <li>Google Maps 預先下載「離線地圖」：香港、東京、富士山、高山、京都、大阪（搜尋同步行路線離線都用到，但電車班次唔得）。</li>
        <li>每項行程撳「搵相」→「儲存」，將站內圖、航廈圖存落手機。</li>
        <li>電子機票、QR code、酒店確認信截圖，用「加相」存喺對應項目。</li>
        <li>定期「匯出備份」，傳去自己 email。</li>
      </ul>
    </div>

    <div class="card">
      <h2>${icon('ext')}實用連結</h2>
      <ul class="plain">
        <li><a href="https://www.vjw.digital.go.jp/" target="_blank" rel="noopener">Visit Japan Web</a>（入境＋海關 QR）</li>
        <li><a href="https://www.keisei.co.jp/keisei/tetudou/skyliner/tc/" target="_blank" rel="noopener">京成 Skyliner</a> · <a href="https://www.tokyometro.jp/tcn/" target="_blank" rel="noopener">東京 Metro</a></li>
        <li><a href="https://world.jorudan.co.jp/mln/zh-tw/" target="_blank" rel="noopener">Jorudan 轉乘查詢</a> · <a href="https://japantravel.navitime.com/zh-tw/" target="_blank" rel="noopener">NAVITIME Japan Travel</a></li>
        <li><a href="https://www.jma.go.jp/bosai/forecast/" target="_blank" rel="noopener">日本氣象廳</a> · <a href="https://www.hko.gov.hk/tc/" target="_blank" rel="noopener">香港天文台</a></li>
        <li><a href="https://www.mtr.com.hk/ch/customer/jp/index.php" target="_blank" rel="noopener">港鐵行程指南</a> · <a href="https://www.citybus.com.hk/" target="_blank" rel="noopener">城巴</a></li>
      </ul>
    </div>

    <div class="card">
      <h2>${icon('copy')}備份及同步</h2>
      <p class="muted">行程只存喺呢部機。匯出檔案可以備份或者搬去另一部機（附件相片都會一齊匯出）。</p>
      <div class="btn-row">
        <button class="btn dark sm" data-act="export">${icon('download')}匯出備份</button>
        <button class="btn sm" data-act="import">匯入備份</button>
        <button class="btn sm" data-act="persist">鎖定資料唔俾瀏覽器清除</button>
      </div>
      <div class="btn-row">
        <button class="btn sm" data-act="rename-trip">${icon('edit')}改旅程名</button>
        <button class="btn sm danger" data-act="load-seed">重設為原始行程</button>
        <button class="btn sm danger" data-act="reset-blank">清空重新開始</button>
      </div>
      <p class="hint" id="storageInfo"></p>
    </div>
  </div>`;
}

/* ---------- modal ---------- */
function openModal({ title, body, submitLabel = '儲存', onSubmit, onOpen, cls = '' }) {
  const dlg = $('#modal');
  dlg.className = cls;
  dlg.innerHTML = `<form class="modal-form" novalidate>
    <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="關閉">${icon('x')}</button></header>
    <div class="modal-body">${body}</div>
    ${onSubmit ? `<footer><button type="button" class="btn" data-close>取消</button><button type="submit" class="btn dark">${esc(submitLabel)}</button></footer>` : ''}
  </form>`;
  const form = dlg.querySelector('form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    if (onSubmit && onSubmit(new FormData(form), form) === false) return;
    dlg.close();
  });
  dlg.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => dlg.close(); });
  dlg.onclick = e => { if (e.target === dlg) dlg.close(); };
  dlg.showModal();
  if (onOpen) onOpen(form);
  return form;
}
const closeModal = () => $('#modal').open && $('#modal').close();

const menuToText = m => (m?.items || []).map(x => `${x.star ? '⭐ ' : ''}${x.name || ''} | ${x.ja || ''} | ${x.price || ''} | ${x.desc || ''}`).join('\n');
function textToMenu(txt, old) {
  const items = txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const star = /^(⭐|\*)/.test(l);
    const [name, ja, price, desc] = l.replace(/^(⭐|\*)\s*/, '').split('|').map(s => (s || '').trim());
    const o = { name };
    if (ja) o.ja = ja; if (price) o.price = price; if (desc) o.desc = desc; if (star) o.star = true;
    return o;
  }).filter(o => o.name);
  return items.length ? { ...(old || {}), items } : (old?.url || old?.tips ? { ...old, items: [] } : undefined);
}
const ttToText = rows => (rows || []).map(r => `${r.dep} → ${r.arr || ''} | ${r.name || ''} | ${r.note || ''}`).join('\n');
function textToTT(txt) {
  return txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [times, name, note] = l.split('|').map(s => (s || '').trim());
    const m = times.match(/(\d{1,2}:\d{2})\D*(\d{1,2}:\d{2})?/);
    if (!m) return null;
    const o = { dep: m[1].padStart(5, '0') };
    if (m[2]) o.arr = m[2].padStart(5, '0'); if (name) o.name = name; if (note) o.note = note;
    return o;
  }).filter(Boolean).sort((a, b) => a.dep.localeCompare(b.dep));
}

function itemFormHtml(it, { insertNote = '' } = {}) {
  const f = (name, label, attrs = '') =>
    `<label>${label}<input name="${name}" value="${esc(it[name] || '')}" ${attrs}></label>`;
  const typeOpts = Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${it.type === k ? 'selected' : ''}>${v.label}</option>`).join('');
  const linksTxt = (it.links || []).map(l => `${l.label} | ${l.url}`).join('\n');
  return `
    ${insertNote}
    <div class="grid3">
      <label>類型<select name="type">${typeOpts}</select></label>
      <label>開始<input type="time" name="time" value="${esc(it.time || '')}"></label>
      <label>結束<input type="time" name="end" value="${esc(it.end || '')}"></label>
    </div>
    <p class="hint" id="durHint"></p>
    ${f('title', '標題（中文）*', 'required placeholder="例如：晚餐：一蘭拉麵"')}
    ${f('titleJa', '日文／當地名稱（俾司機睇、搜尋用）', 'lang="ja" placeholder="一蘭 渋谷店"')}
    <div class="tonly">
      <div class="grid2">
        ${f('from', '出發地（日文／英文，用嚟搜尋）', 'placeholder="新宿駅"')}
        ${f('fromZh', '出發地中文名', 'placeholder="新宿站"')}
        ${f('to', '目的地（日文／英文）', 'placeholder="京都駅"')}
        ${f('toZh', '目的地中文名', 'placeholder="京都站"')}
      </div>
      ${f('number', '班次／航班號', 'placeholder="CX 500 · Skyliner 56號"')}
      <label>時刻表（每行一班：開出 → 到達 | 班次 | 備註）<textarea name="timetable" rows="4" placeholder="17:43 → 18:24 | 56號 | 最貼合">${esc(ttToText(it.timetable))}</textarea></label>
      ${f('timetableNote', '時刻表備註')}
      ${f('timetableUrl', '全日時刻表連結', 'inputmode="url"')}
    </div>
    <div class="ponly">${f('place', 'Google Maps 搜尋名稱', 'placeholder="一蘭 渋谷店"')}</div>
    ${f('address', '地址')}
    <div class="grid2">
      ${f('hours', '營業時間')}
      ${f('cost', '費用', 'placeholder="¥3,000"')}
      ${f('ref', '訂位／確認號碼')}
      ${f('url', '網站／訂位連結', 'inputmode="url" placeholder="https://…"')}
    </div>
    <label>備註<textarea name="notes" rows="3" placeholder="出口號碼、要點、注意事項…">${esc(it.notes || '')}</textarea></label>
    <label>後備方案（萬一去唔到）<textarea name="planB" rows="2" placeholder="如果落雨／關門：改去…">${esc(it.planB || '')}</textarea></label>
    <details class="adv"><summary>菜單、連結、相片設定</summary>
      <label>菜單（每行一樣：⭐ 中文名 | 日文名 | 價錢 | 描述）<textarea name="menu" rows="4" placeholder="⭐ 雞白湯拉麵 | 鶏白湯Soba | ¥2,000 | 招牌">${esc(menuToText(it.menu))}</textarea></label>
      <label>完整菜單連結<input name="menuUrl" value="${esc(it.menu?.url || '')}" inputmode="url"></label>
      <label>其他連結（每行一個：名稱 | 網址）<textarea name="links" rows="2" placeholder="菜單 | https://…">${esc(linksTxt)}</textarea></label>
      <div class="grid2">
        <label>地點相（Wikipedia 條目）<input name="wiki" value="${esc(it.wiki || '')}" placeholder="ja:根津神社"></label>
        <label>國家（影響食評／站內圖連結）<select name="country">
          <option value="">跟返嗰日</option>
          ${Object.entries(COUNTRIES).map(([k, v]) => `<option value="${k}" ${it.country === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select></label>
      </div>
    </details>`;
}

function readItemForm(fd, it) {
  for (const k of ['type', 'time', 'end', 'title', 'titleJa', 'from', 'fromZh', 'to', 'toZh', 'number', 'place', 'address', 'hours', 'ref', 'cost', 'url', 'notes', 'planB', 'country', 'wiki', 'timetableNote', 'timetableUrl']) {
    const v = (fd.get(k) || '').toString().trim();
    if (v) it[k] = v; else delete it[k];
  }
  const tt = textToTT((fd.get('timetable') || '').toString());
  if (tt.length) it.timetable = tt; else delete it.timetable;
  const menu = textToMenu((fd.get('menu') || '').toString(), it.menu);
  const menuUrl = (fd.get('menuUrl') || '').toString().trim();
  if (menu || menuUrl) { it.menu = menu || { items: [] }; if (menuUrl) it.menu.url = menuUrl; else delete it.menu.url; }
  else delete it.menu;
  if (it.menu && !it.menu.items?.length && !it.menu.url && !it.menu.tips) delete it.menu;
  it.links = (fd.get('links') || '').toString().split('\n').map(line => {
    line = line.trim();
    if (!line) return null;
    const i = line.lastIndexOf('|');
    return i >= 0 ? { label: line.slice(0, i).trim(), url: line.slice(i + 1).trim() } : { label: '連結', url: line };
  }).filter(l => l && l.url);
  if (!it.links.length) delete it.links;
  return it;
}

function bindItemForm(form) {
  const sync = () => {
    form.dataset.kind = TRANSPORT.has(form.elements.type.value) ? 'transport' : 'place';
    const t = form.elements.time.value, e = form.elements.end.value;
    const d = t && e ? durOf({ time: t, end: e }) : null;
    $('#durHint', form).textContent = d != null ? `時長：${durStr(d)}` : '';
  };
  ['type', 'time', 'end'].forEach(n => form.elements[n].addEventListener('input', sync));
  sync();
}

function editItem(id) {
  const f = findItem(id);
  if (!f) return;
  const oldDur = durOf(f.item), oldEnd = f.item.end;
  openModal({
    title: '修改項目',
    body: itemFormHtml(f.item) + (f.day ? `<label class="check"><input type="checkbox" name="pushLater" checked> 時間變長／變短時，之後嘅行程自動跟住調整</label>` : ''),
    onOpen: bindItemForm,
    onSubmit: fd => commit(() => {
      const cur = findItem(id);
      readItemForm(fd, cur.item);
      if (fd.get('pushLater') && cur.day && isHM(oldEnd) && isHM(cur.item.end) && oldDur != null) {
        const delta = toMin(cur.item.end) - toMin(oldEnd);
        if (delta) shiftFrom(cur.list, cur.index + 1, delta);
      }
    }, '已儲存'),
  });
}

/** 喺 index 位置插入新項目；預設接住上一項完結時間開始，30 分鐘 */
function insertItem(dayId, index) {
  const day = findDay(dayId);
  const prev = day.items[index - 1], next = day.items[index];
  let start = prev ? (isHM(prev.end) ? prev.end : prev.time) : (next && isHM(next.time) ? fromMin(toMin(next.time) - 30) : '');
  const draft = { id: uid(), type: 'sight', status: 'planned' };
  if (isHM(start)) { draft.time = start; draft.end = fromMin(toMin(start) + 30); }
  const where = prev && next ? `插入喺「${prev.title}」同「${next.title}」之間` : prev ? `加喺「${prev.title}」之後` : next ? `加喺「${next.title}」之前` : `加去 ${fmtDate(day.date)}`;
  openModal({
    title: '加項目',
    body: itemFormHtml(draft, { insertNote: `<p class="hint strong">${esc(where)}</p>` })
      + (next ? `<label class="check"><input type="checkbox" name="pushLater" checked> 如果時間撞，之後嘅行程自動順延</label>` : ''),
    submitLabel: '加入',
    onOpen: bindItemForm,
    onSubmit: fd => commit(() => {
      readItemForm(fd, draft);
      const d = findDay(dayId);
      d.items.splice(index, 0, draft);
      const nx = d.items[index + 1];
      if (fd.get('pushLater') && nx && isHM(nx.time) && isHM(draft.end || draft.time)) {
        const overlap = toMin(draft.end || draft.time) - toMin(nx.time);
        if (overlap > 0) shiftFrom(d.items, index + 1, overlap);
      }
      ui.open.add(draft.id);
    }, '已加入'),
  });
}

function addIdea() {
  const draft = { id: uid(), type: 'sight', status: 'planned' };
  openModal({
    title: '加靈感',
    body: itemFormHtml(draft),
    submitLabel: '加入',
    onOpen: bindItemForm,
    onSubmit: fd => commit(() => { readItemForm(fd, draft); trip.ideas.push(draft); }, '已加入'),
  });
}

function dayFormHtml(d) {
  return `
    <label>日期<input type="date" name="date" value="${esc(d.date || '')}"></label>
    ${d.group ? `<label class="check"><input type="checkbox" name="groupShift" checked> 整團一齊改（同組嘅日子跟住移，保持連續）</label>` : ''}
    <div class="grid2">
      <label>城市（中文）<input name="city" value="${esc(d.city || '')}" placeholder="東京"></label>
      <label>城市（日文／英文）<input name="cityJa" value="${esc(d.cityJa || '')}" placeholder="東京"></label>
      <label>國家<select name="country">
        <option value="">—</option>
        ${Object.entries(COUNTRIES).map(([k, v]) => `<option value="${k}" ${d.country === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select></label>
      <label>分組（例如 tour）<input name="group" value="${esc(d.group || '')}"></label>
    </div>
    <label>主題<input name="title" value="${esc(d.title || '')}" placeholder="淺草、上野"></label>
    <label>當日備註<textarea name="notes" rows="4">${esc(d.notes || '')}</textarea></label>`;
}
function readDayForm(fd, d) {
  for (const k of ['date', 'city', 'cityJa', 'country', 'title', 'notes', 'group']) {
    const v = (fd.get(k) || '').toString().trim();
    if (v) d[k] = v; else delete d[k];
  }
}

function editDay(id) {
  const d = findDay(id);
  const oldDate = d.date;
  openModal({
    title: `改日子 · ${fmtDate(d.date)}`,
    body: dayFormHtml(d) + `<div class="btn-row">
        <button type="button" class="btn sm" id="dupDay">${icon('copy')}複製呢日</button>
        <button type="button" class="btn sm danger" id="delDay">${icon('trash')}刪除呢日</button></div>
        <p class="hint">刪除日子會將項目搬去「靈感」，唔會唔見。</p>`,
    onSubmit: fd => commit(() => {
      const day = findDay(id);
      readDayForm(fd, day);
      if (fd.get('groupShift') && day.group && oldDate && day.date && day.date !== oldDate) {
        const delta = daysBetween(oldDate, day.date);
        trip.days.filter(x => x.group === day.group && x.id !== day.id).forEach(x => { x.date = addDays(x.date, delta); });
        // 移走同新團期撞日、而且冇安排嘅空白日子
        const groupDates = new Set(trip.days.filter(x => x.group === day.group).map(x => x.date));
        trip.days = trip.days.filter(x => x.group === day.group || x.items.length || !groupDates.has(x.date));
        fillGaps();
      }
    }, '已更新日子'),
    onOpen: form => {
      form.querySelector('#delDay').onclick = () => {
        closeModal();
        commit(() => {
          const day = findDay(id);
          trip.ideas.push(...day.items);
          trip.days = trip.days.filter(x => x.id !== id);
        }, '已刪除日子，項目搬咗去「靈感」');
      };
      form.querySelector('#dupDay').onclick = () => {
        closeModal();
        commit(() => {
          const day = findDay(id);
          const copy = JSON.parse(JSON.stringify(day));
          copy.id = uid();
          copy.date = addDays(day.date, 1);
          delete copy.group;
          copy.items.forEach(i => { i.id = uid(); i.status = 'planned'; });
          trip.days.push(copy);
        }, '已複製日子');
      };
    },
  });
}

/** 補返中間冇咗嘅日子（例如移團期之後），用前一日嘅城市 */
function fillGaps() {
  normalize();
  const out = [];
  trip.days.forEach((d, i) => {
    const prev = out[out.length - 1];
    if (prev && prev.date && d.date) {
      for (let k = 1; k < daysBetween(prev.date, d.date); k++) {
        const base = prev.group ? (trip.days.slice(0, i).reverse().find(x => !x.group) || {}) : prev;
        out.push({ id: uid(), date: addDays(prev.date, k), city: base.city || prev.city, cityJa: base.cityJa, country: base.country || prev.country, title: `${base.city || ''}自由活動`, items: [] });
      }
    }
    out.push(d);
  });
  trip.days = out;
}

function addDay() {
  const lastDay = trip.days[trip.days.length - 1];
  const d = { id: uid(), date: lastDay ? addDays(lastDay.date, 1) : todayStr(), city: lastDay?.city, country: lastDay?.country, items: [] };
  openModal({
    title: '加一日',
    body: dayFormHtml(d),
    submitLabel: '加入',
    onSubmit: fd => commit(() => { readDayForm(fd, d); trip.days.push(d); }, '已加日子'),
  });
}

function moveItem(id) {
  const f = findItem(id);
  const opts = trip.days.map((d, i) =>
    `<option value="${d.id}" ${f.day && f.day.id === d.id ? 'selected' : ''}>第${i + 1}日 · ${esc(fmtDate(d.date, true))}${d.city ? ' · ' + esc(d.city) : ''}</option>`).join('');
  openModal({
    title: `搬「${f.item.title}」`,
    body: `<label>搬去<select name="to"><option value="ideas" ${!f.day ? 'selected' : ''}>靈感（未排日子）</option>${opts}</select></label>
      <label>新開始時間（可留空）<input type="time" name="time" value="${esc(f.item.time || '')}"></label>
      <p class="hint">時長會保留；項目會按時間插入新日子。</p>`,
    submitLabel: '搬',
    onSubmit: fd => commit(() => {
      const cur = findItem(id);
      const [it] = cur.list.splice(cur.index, 1);
      const d = durOf(it);
      const t = (fd.get('time') || '').toString();
      if (t) { it.time = t; if (d != null) it.end = fromMin(toMin(t) + d); } else { delete it.time; delete it.end; }
      const to = fd.get('to');
      if (to === 'ideas') { trip.ideas.push(it); return; }
      const list = findDay(to).items;
      const at = isHM(it.time) ? list.findIndex(x => isHM(x.time) && x.time > it.time) : -1;
      if (at >= 0) list.splice(at, 0, it); else list.push(it);
    }, '已搬'),
  });
}

function shiftItems(id) {
  const f = findItem(id);
  openModal({
    title: '遲咗／早咗？',
    body: `<p class="hint strong">將「${esc(f.item.title)}」同當日之後所有未完成項目一齊移。</p>
      <div class="btn-row">
        ${[-30, -15, 10, 15, 30, 60, 90].map(m => `<button type="button" class="btn sm ${m > 0 ? '' : 'ghost'}" data-min="${m}">${m > 0 ? '+' : ''}${m} 分</button>`).join('')}
      </div>
      <label>或者自己輸入分鐘（負數＝提早）<input type="number" name="mins" value="30" step="5"></label>`,
    submitLabel: '移時間',
    onOpen: form => form.querySelectorAll('[data-min]').forEach(b => {
      b.onclick = () => { form.elements.mins.value = b.dataset.min; form.requestSubmit(); };
    }),
    onSubmit: fd => {
      const mins = parseInt(fd.get('mins'), 10);
      if (!mins) return;
      commit(() => { const cur = findItem(id); shiftFrom(cur.list, cur.index, mins); }, `已${mins > 0 ? '延遲' : '提早'} ${Math.abs(mins)} 分鐘`);
    },
  });
}

function showTaxi(id) {
  const { item: it, day } = findItem(id);
  const c = countryOf(it, day) || 'JP';
  const isT = TRANSPORT.has(it.type);
  const big = isT ? (it.to || '') : (it.titleJa || it.place || it.title);
  const sub = isT ? (it.toZh || '') : (it.titleJa ? it.title : '');
  openModal({
    title: '俾司機睇',
    cls: 'taxi-modal',
    body: `<div class="taxi">
      <div class="phrase" lang="${c === 'JP' ? 'ja' : 'zh-HK'}">${TAXI_PHRASE[c] || TAXI_PHRASE.JP}</div>
      <div class="big" lang="${c === 'JP' ? 'ja' : 'zh-HK'}">${esc(big)}</div>
      ${!isT && it.address ? `<div class="addr">${esc(it.address)}</div>` : ''}
      ${sub ? `<div class="muted">${esc(sub)}</div>` : ''}
    </div>`,
  });
}

function viewPhoto(itemId, photoId) {
  openModal({
    title: findItem(itemId)?.item.title || '附件',
    body: `<img class="photo-full" data-photo="${photoId}" alt="">
      <div class="btn-row"><button type="button" class="btn sm danger" id="delPhoto">${icon('trash')}刪除附件</button></div>`,
    onOpen: form => {
      hydratePhotos(form);
      form.querySelector('#delPhoto').onclick = () => {
        if (!confirm('刪除呢張相？')) return;
        closeModal();
        commit(() => {
          const it = findItem(itemId).item;
          it.photos = (it.photos || []).filter(p => p !== photoId);
        }, '已刪除附件');
        PhotoDB.del(photoId).catch(() => {});
      };
    },
  });
}

/* ---------- 搵相 ---------- */
async function runImageSearch(id, q) {
  ui.img[id] = { q, loading: true, items: [] };
  const box = $('#imgres-' + id);
  const refresh = () => { const b = $('#imgres-' + id); if (b) b.innerHTML = renderImgResults(id); };
  if (box) box.innerHTML = renderImgResults(id);
  document.querySelectorAll(`[data-act="img-search"][data-id="${id}"]`).forEach(b => b.classList.toggle('dark', b.dataset.q === q));
  if (!navigator.onLine) { ui.img[id] = { q, error: '而家冇網絡', items: [] }; return refresh(); }
  try {
    ui.img[id] = { q, items: await commonsSearch(q, 3), saved: {} };
  } catch (e) {
    ui.img[id] = { q, error: e.message, items: [] };
  }
  refresh();
}

async function saveSearchImage(id, i) {
  const st = ui.img[id];
  const r = st?.items[i];
  if (!r || st.saved?.[i]) return;
  try {
    const blob = await (await fetch(r.thumb)).blob();
    const pid = 'p_' + uid();
    await PhotoDB.put(pid, blob);
    st.saved = { ...(st.saved || {}), [i]: true };
    commit(() => {
      const it = findItem(id).item;
      it.photos = [...(it.photos || []), pid];
      ui.open.add(id);
    }, '已儲存，冇網都睇到');
  } catch (e) {
    toast('儲存唔到：' + e.message);
  }
}

/* ---------- 匯入／匯出 ---------- */
async function exportTrip() {
  const ids = new Set();
  allItems().forEach(it => (it.photos || []).forEach(p => ids.add(p)));
  const photos = {};
  for (const id of ids) {
    const blob = await PhotoDB.get(id).catch(() => null);
    if (blob) photos[id] = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  }
  const data = JSON.stringify({ app: 'trip-planner', version: 2, exportedAt: new Date().toISOString(), trip, photos });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = `trip-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('已下載備份');
}

async function importTrip(file) {
  try {
    const data = JSON.parse(await file.text());
    const t = data.trip || data;
    if (!Array.isArray(t.days)) throw new Error('檔案入面搵唔到 days');
    if (!confirm(`用「${t.name || '匯入嘅行程'}」（${t.days.length} 日）取代現有行程？之後可以還原。`)) return;
    for (const [id, url] of Object.entries(data.photos || {})) {
      const blob = await (await fetch(url)).blob();
      await PhotoDB.put(id, blob);
    }
    const fix = it => { it.id = it.id || uid(); it.type = it.type || 'other'; it.status = it.status || 'planned'; if (it.endTime && !it.end) { it.end = it.endTime; delete it.endTime; } return it; };
    t.days.forEach(d => { d.id = d.id || uid(); d.items = (d.items || []).map(fix); });
    t.ideas = (t.ideas || []).map(fix);
    commit(() => { trip = t; }, '已匯入');
  } catch (e) {
    alert('匯入唔到：' + e.message);
  }
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, withUndo = false) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${withUndo ? `<button data-act="undo">還原</button>` : ''}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), withUndo ? 5000 : 2500);
}

/* ---------- actions ---------- */
const setStatus = (id, val, msg) => commit(() => {
  const it = findItem(id).item;
  it.status = val;
  if (val !== 'planned') ui.open.delete(id);
}, msg);

const actions = {
  tab: id => { ui.tab = id; render(); window.scrollTo(0, 0); },
  undo,
  'toggle-day': id => { ui.collapsed.has(id) ? ui.collapsed.delete(id) : ui.collapsed.add(id); $('#day-' + id)?.classList.toggle('collapsed'); },
  'toggle-item': id => {
    ui.open.has(id) ? ui.open.delete(id) : ui.open.add(id);
    const el = $('#item-' + id);
    const f = findItem(id);
    if (!el || !f) return render();
    // 只重畫呢一項，唔好成頁跳
    const prevLoc = (() => {
      if (!f.day) return '';
      for (let i = f.index - 1; i >= 0; i--) if (f.list[i].status !== 'skipped' && locOf(f.list[i])) return locOf(f.list[i]);
      return '';
    })();
    const isToday = f.day && f.day.date === todayStr();
    const tmp = document.createElement('div');
    tmp.innerHTML = renderItem(f.item, { prevLoc, country: countryOf(f.item, f.day), isNext: el.classList.contains('next'), isToday, idea: !f.day });
    const fresh = tmp.firstElementChild;
    el.replaceWith(fresh);
    hydrateCovers(fresh);
    hydratePhotos(fresh);
  },
  'goto-day': (id, chip) => {
    ui.activeDay = id;
    document.querySelectorAll('.strip-day.is-active').forEach(x => x.classList.remove('is-active'));
    chip?.classList.add('is-active');
    chip?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    ui.collapsed.delete(id);
    const el = $('#day-' + id);
    el?.classList.remove('collapsed');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'add-day': addDay,
  'edit-day': editDay,
  insert: (_, el) => insertItem(el.dataset.day, parseInt(el.dataset.index, 10)),
  'add-idea': addIdea,
  'edit-item': editItem,
  'move-item': moveItem,
  shift: shiftItems,
  taxi: showTaxi,
  'sort-day': id => commit(() => {
    findDay(id).items.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  }, '已按時間排好'),
  'status-done': id => setStatus(id, 'done', '已完成'),
  'status-skip': id => setStatus(id, 'skipped', '已跳過'),
  'status-reset': id => setStatus(id, 'planned', '已重設'),
  'move-up': id => commit(() => { const f = findItem(id); swapSlots(f.list, f.index - 1, f.index); }, '已上移（時段互換）'),
  'move-down': id => commit(() => { const f = findItem(id); swapSlots(f.list, f.index, f.index + 1); }, '已下移（時段互換）'),
  'dup-item': id => commit(() => {
    const f = findItem(id);
    const copy = { ...JSON.parse(JSON.stringify(f.item)), id: uid(), status: 'planned' };
    f.list.splice(f.index + 1, 0, copy);
    ui.open.add(copy.id);
  }, '已複製'),
  'del-item': id => commit(() => { const f = findItem(id); f.list.splice(f.index, 1); }, '已刪除'),
  'swap-planb': id => commit(() => {
    const it = findItem(id).item;
    const old = { title: it.title, titleJa: it.titleJa, notes: it.notes };
    const plan = it.planB.trim();
    const first = plan.split('\n')[0].replace(/^(如果[^：:]*[：:]\s*)/, '').trim();
    it.title = first.slice(0, 60) || plan.slice(0, 60);
    it.place = it.title;
    ['titleJa', 'address', 'url', 'wiki', 'menu', 'hours', 'ref'].forEach(k => delete it[k]);
    it.notes = plan;
    it.planB = `原本計劃：${old.title}${old.titleJa ? `（${old.titleJa}）` : ''}${old.notes ? '\n' + old.notes : ''}`;
  }, '已轉用後備方案——撳「修改」補資料'),
  'add-photo': id => { pendingPhotoItem = id; $('#photoInput').click(); },
  'view-photo': (id, el) => viewPhoto(id, el.dataset.photo),
  'img-search': (id, el) => runImageSearch(id, el.dataset.q),
  'img-custom': id => openModal({
    title: '自己打關鍵字',
    body: `<label>關鍵字（日文／英文效果最好）<input name="q" value="${esc(ui.img[id]?.q || '')}" required></label>`,
    submitLabel: '搵',
    onSubmit: fd => { runImageSearch(id, fd.get('q').toString().trim()); },
  }),
  'img-save': (id, el) => saveSearchImage(id, parseInt(el.dataset.i, 10)),
  'goto-item': id => {
    const f = findItem(id);
    ui.tab = f.day ? 'plan' : 'ideas';
    ui.open.add(id);
    if (f.day) ui.collapsed.delete(f.day.id);
    render();
    $('#item-' + id)?.scrollIntoView({ block: 'center' });
  },
  copy: (_, el) => navigator.clipboard?.writeText(el.dataset.val).then(() => toast('已複製'), () => toast('複製唔到')),
  'rename-trip': () => openModal({
    title: '改旅程名',
    body: `<label>旅程名稱<input name="name" value="${esc(trip.name || '')}" required></label>`,
    onSubmit: fd => commit(() => { trip.name = fd.get('name').toString().trim(); }),
  }),
  export: exportTrip,
  import: () => $('#importInput').click(),
  prefetch: () => { toast('下載緊地點相…'); prefetchCovers(true).then(() => toast('地點相已更新，離線可用')); },
  persist: async () => {
    if (!navigator.storage?.persist) return toast('呢個瀏覽器唔支援');
    const ok = await navigator.storage.persist();
    toast(ok ? '已鎖定，瀏覽器唔會自動清除' : '瀏覽器拒絕——請「加到主畫面」並定期匯出備份');
  },
  'load-seed': () => { if (confirm('載入原始行程？你喺手機改過嘅內容會被取代（之後可以還原）。')) commit(() => { trip = freshSeed(); }, '已載入原始行程'); },
  'reset-blank': () => { if (confirm('清空所有行程？（之後可以還原）')) commit(() => { trip = { name: '我的旅程', seedVersion: SEED.seedVersion, days: [], ideas: [] }; }, '已清空'); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  fn(el.dataset.id, el, e);
});

let pendingPhotoItem = null;
$('#photoInput').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length || !pendingPhotoItem) return;
  const id = pendingPhotoItem;
  const ids = [];
  try {
    for (const file of files) {
      const pid = 'p_' + uid();
      await PhotoDB.put(pid, await resizeImage(file));
      ids.push(pid);
    }
  } catch (err) {
    return toast('儲存唔到相：' + err.message);
  }
  commit(() => {
    const it = findItem(id).item;
    it.photos = [...(it.photos || []), ...ids];
    ui.open.add(id);
  }, `已加 ${ids.length} 張相（離線可睇）`);
});
$('#importInput').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) importTrip(file);
});

/* ---------- 網絡狀態 ---------- */
function updateNet() {
  const on = navigator.onLine;
  const el = $('#netStatus');
  el.innerHTML = `<i></i>${on ? '在線' : '離線'}`;
  el.classList.toggle('offline', !on);
  document.body.classList.toggle('is-offline', !on);
}
window.addEventListener('online', () => { updateNet(); prefetchCovers(); });
window.addEventListener('offline', updateNet);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// 每分鐘更新「下一項」
setInterval(() => { if (ui.tab === 'plan' && !$('#modal').open && !Object.values(ui.img).some(s => s.loading)) render(); }, 60_000);

function showStorageInfo() {
  navigator.storage?.estimate?.().then(({ usage, quota }) => {
    const el = $('#storageInfo');
    if (el) el.textContent = `已用空間：${(usage / 1048576).toFixed(1)} MB／可用 ${(quota / 1048576).toFixed(0)} MB`;
  });
}

/* ---------- boot ---------- */
if (trip.seedVersion == null && !load()) trip.seedVersion = SEED.seedVersion;
normalize();
save();
updateNet();
render();
// 自動跳去今日
if (trip.days.some(d => d.date === todayStr())) setTimeout(() => $('.day.today')?.scrollIntoView({ block: 'start' }), 50);
// 背景下載地點相，等冇網都有相睇
setTimeout(() => prefetchCovers(), 1500);
