'use strict';

/* =========================================================
   東京 4 日 —— 簡單、離線可用嘅行程
   行程存喺 localStorage；相片存喺 IndexedDB。
   ========================================================= */

const STORE_KEY = 'trip-planner:v3';
const SEED = window.SEED_TRIP || { seedVersion: 0, name: '我的旅程', days: [] };

const TYPES = {
  flight: '航班', train: '電車', bus: '巴士', walk: '步行', ferry: '船',
  hotel: '酒店', food: '食飯', sight: '景點', shop: '購物', other: '其他',
};
const TRANSPORT = new Set(['flight', 'train', 'bus', 'ferry', 'walk']);
const WEEK = '日一二三四五六';

/* ---------- 日語常用句 ---------- */
const PHRASES = [
  { cat: '基本', items: [
    ['こんにちは', 'konnichiwa', '你好'],
    ['ありがとうございます', 'arigatō gozaimasu', '多謝'],
    ['すみません', 'sumimasen', '唔好意思（叫人／借借）'],
    ['はい ／ いいえ', 'hai / iie', '係 ／ 唔係'],
    ['大丈夫です', 'daijōbu desu', '冇問題／唔使喇'],
    ['日本語が話せません', 'nihongo ga hanasemasen', '我唔識講日文'],
    ['英語は話せますか', 'eigo wa hanasemasu ka', '你識唔識講英文？'],
  ] },
  { cat: '餐廳', items: [
    ['二人です', 'futari desu', '兩位'],
    ['予約しています', 'yoyaku shite imasu', '我有訂位'],
    ['どのくらい待ちますか', 'dono kurai machimasu ka', '要等幾耐？'],
    ['英語のメニューはありますか', 'eigo no menyū wa arimasu ka', '有冇英文餐牌？'],
    ['おすすめは何ですか', 'osusume wa nan desu ka', '有咩推介？'],
    ['これをください', 'kore o kudasai', '我要呢個'],
    ['お水をください', 'omizu o kudasai', '唔該俾杯水'],
    ['お会計お願いします', 'okaikei onegaishimasu', '唔該埋單'],
    ['ごちそうさまでした', 'gochisōsama deshita', '多謝款待（食完講）'],
  ] },
  { cat: '購物', items: [
    ['いくらですか', 'ikura desu ka', '幾多錢？'],
    ['カードは使えますか', 'kādo wa tsukaemasu ka', '可唔可以碌卡？'],
    ['免税できますか', 'menzei dekimasu ka', '可唔可以退稅？'],
    ['袋はいりません', 'fukuro wa irimasen', '唔使袋'],
    ['これはありますか', 'kore wa arimasu ka', '有冇呢樣嘢？（指住相）'],
  ] },
  { cat: '交通', items: [
    ['駅はどこですか', 'eki wa doko desu ka', '車站喺邊？'],
    ['この電車は銀座に行きますか', 'kono densha wa Ginza ni ikimasu ka', '呢架車去唔去銀座？'],
    ['スカイライナーの切符を二枚ください', 'sukairainā no kippu o nimai kudasai', '唔該兩張 Skyliner 車飛'],
    ['ここまでお願いします', 'koko made onegaishimasu', '（的士）唔該去呢度'],
    ['ここで止めてください', 'koko de tomete kudasai', '（的士）喺度停得喇'],
  ] },
  { cat: '酒店', items: [
    ['チェックインお願いします', 'chekku-in onegaishimasu', '我想 Check-in'],
    ['荷物を預かってもらえますか', 'nimotsu o azukatte moraemasu ka', '可唔可以寄存行李？'],
    ['Wi-Fiのパスワードは何ですか', 'wai-fai no pasuwādo wa nan desu ka', 'Wi-Fi 密碼係咩？'],
  ] },
  { cat: '求助', items: [
    ['トイレはどこですか', 'toire wa doko desu ka', '洗手間喺邊？'],
    ['道に迷いました', 'michi ni mayoimashita', '我蕩失路'],
    ['助けてください', 'tasukete kudasai', '救命／幫幫我'],
    ['病院に連れて行ってください', 'byōin ni tsurete itte kudasai', '唔該帶我去醫院'],
    ['警察を呼んでください', 'keisatsu o yonde kudasai', '唔該幫我報警'],
  ] },
];

/* ---------- icons ---------- */
const ICONS = {
  flight: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  train: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l1.5-4M15 21l-1.5-4"/><path d="M9 14h.01M15 14h.01"/>',
  bus: '<rect x="4" y="3" width="16" height="14" rx="2"/><path d="M4 10h16M8 21v-4M16 21v-4"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="m7 21 3-7 3 3v4M6 12l3-4 4 1 3 3"/>',
  ferry: '<path d="M2 20c2 1 4 1 6 0s4-1 6 0 4 1 6 0M4 17l-1-5h18l-2 5M6 12V7h12v5"/>',
  hotel: '<path d="M3 20V5M3 15h18v5M21 15v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11" r="2"/>',
  food: '<path d="M4 2v7a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V2M7 2v20M20 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3zm0 0v7"/>',
  sight: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  shop: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/>',
  other: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  route: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
  car: '<path d="M5 17h14M6 17v2M18 17v2M5 11l2-5h10l2 5M4 11h16v6H4z"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  sound: '<path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
};
const icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

/* ---------- helpers ---------- */
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
const durOf = it => (isHM(it.time) && isHM(it.end)) ? (toMin(it.end) - toMin(it.time) + 1440) % 1440 : null;
function durStr(m) {
  if (m == null) return '';
  const h = Math.floor(m / 60), mm = m % 60;
  return h && mm ? `${h}小時${mm}分` : h ? `${h}小時` : `${mm}分`;
}
const dateParts = s => { const d = new Date(s + 'T00:00'); return { d: d.getDate(), m: d.getMonth() + 1, w: WEEK[d.getDay()] }; };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00') - new Date(a + 'T00:00')) / 86400000);
const normUrl = u => { u = (u || '').trim(); return !u ? '' : /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u; };
const nameOf = (raw, zh) => zh || (raw || '').split(/[,(（]/)[0].trim();

const gmapSearch = q => `https://www.google.com/maps/search/?api=1&query=${enc(q)}`;
const gmapDir = (from, to, mode = 'transit') =>
  `https://www.google.com/maps/dir/?api=1${from ? `&origin=${enc(from)}` : ''}&destination=${enc(to)}&travelmode=${mode}`;
const gsearch = q => `https://www.google.com/search?q=${enc(q)}`;

function locOf(it) {
  if (!it) return '';
  return TRANSPORT.has(it.type) ? (it.to || '') : (it.place || it.address || '');
}

/** 每項最有用嘅連結 */
function linksFor(it, prevLoc) {
  const L = [];
  const add = (label, url, kind = '', ic = '') => { if (url) L.push({ label, url, kind, ic }); };
  const t = it.type;
  if (t === 'flight') {
    const no = (it.number || '').replace(/\s+/g, '');
    if (no && !no.includes('待填')) add('航班狀態', `https://www.flightradar24.com/data/flights/${enc(no.toLowerCase())}`, 'accent', 'flight');
    if (it.url) add('訂單', normUrl(it.url), '', 'ext');
  } else if (t === 'walk') {
    if (it.to) add('步行路線', gmapDir(it.from || prevLoc, it.to, 'walking'), 'accent', 'route');
  } else if (TRANSPORT.has(t)) {
    if (it.to) add('路線及班次', gmapDir(it.from || prevLoc, it.to), 'accent', 'route');
    if (it.timetableUrl) add('時刻表', normUrl(it.timetableUrl), '', 'clock');
    (it.stationLinks || []).forEach(l => add(l.label, normUrl(l.url), '', 'map'));
  } else {
    const q = locOf(it) || it.titleJa || it.title;
    if (it.place || it.address) {
      add('導航', gmapDir('', q), 'accent', 'route');
      add('地圖', gmapSearch(q), '', 'map');
    }
    if (it.url) add(t === 'food' ? '網站／訂位' : t === 'hotel' ? '酒店網站' : '官網', normUrl(it.url), '', 'ext');
    if (t === 'food' && it.titleJa) add('Tabelog 食評', gsearch(`tabelog ${it.titleJa}`), '', 'star');
  }
  (it.links || []).forEach(l => add(l.label || '連結', normUrl(l.url), '', 'ext'));
  return L;
}

/* ---------- 讀音（Web Speech，用手機內置日文聲） ---------- */
function speak(text, lang = 'ja-JP') {
  if (!('speechSynthesis' in window)) return toast('呢部機唔支援讀音');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[（(].*?[）)]/g, ''));
  u.lang = lang;
  u.rate = 0.85;
  const v = speechSynthesis.getVoices().find(v => v.lang.replace('_', '-').toLowerCase().startsWith(lang.slice(0, 2)));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}
if ('speechSynthesis' in window) speechSynthesis.getVoices();
const speakBtn = (text, cls = '') => text ? `<button type="button" class="speak ${cls}" data-act="speak" data-text="${esc(text)}" aria-label="讀出">${icon('sound')}</button>` : '';

/* ---------- IndexedDB ---------- */
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
  put(id, v) { return this.run('readwrite', s => s.put(v, id)); },
  get(id) { return this.run('readonly', s => s.get(id)); },
  del(id) { return this.run('readwrite', s => s.delete(id)); },
};
const blobURLs = new Map();
async function blobURL(key) {
  if (blobURLs.has(key)) return blobURLs.get(key);
  const b = await PhotoDB.get(key).catch(() => null);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  blobURLs.set(key, u);
  return u;
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

/* ---------- 預先揀好嘅地點相（Wikimedia Commons）：下載一次，之後離線可睇 ---------- */
const CAPI = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=url|mime&iiurlwidth=1000';
const hasPicConf = it => !!(it.pics?.length || it.picCat || it.picQuery);
const picConfKey = it => 'piclist:' + JSON.stringify([it.pics || [], it.picCat || '', it.picQuery || '']);

async function capi(params) {
  const j = await (await fetch(CAPI + params)).json();
  return Object.values(j.query?.pages || {});
}
async function resolvePics(it) {
  const out = [], seen = new Set();
  const push = p => {
    const ii = p.imageinfo?.[0];
    if (!ii?.thumburl || !/jpe?g|png|webp/i.test(ii.mime || '') || seen.has(p.title)) return;
    seen.add(p.title);
    out.push({ title: p.title, thumb: ii.thumburl });
  };
  const norm = s => s.replace(/_/g, ' ').toLowerCase();
  if (it.pics?.length) {
    const pages = await capi('&titles=' + enc(it.pics.join('|'))).catch(() => []);
    it.pics.forEach(t => { const p = pages.find(x => norm(x.title) === norm(t)); if (p) push(p); });
  }
  if (out.length < 3 && it.picCat) (await capi(`&generator=categorymembers&gcmtitle=${enc(it.picCat)}&gcmtype=file&gcmlimit=12`).catch(() => [])).forEach(push);
  if (out.length < 3 && it.picQuery) (await capi(`&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=${enc('filetype:bitmap ' + it.picQuery)}`).catch(() => []))
    .sort((a, b) => (a.index || 0) - (b.index || 0)).forEach(push);
  return out.slice(0, 3);
}

const picPending = new Map();
/** 返回 [{key, title}]；離線又未下載過就返回 null */
function getItemPics(it) {
  if (!hasPicConf(it)) return Promise.resolve([]);
  const ck = picConfKey(it);
  if (picPending.has(ck)) return picPending.get(ck);
  const p = (async () => {
    let titles = await PhotoDB.get(ck).catch(() => null);
    if (!titles && navigator.onLine) {
      const found = await resolvePics(it).catch(() => []);
      titles = [];
      for (const r of found) {
        const key = 'pic:' + r.title;
        try {
          if (!(await PhotoDB.get(key))) {
            const res = await fetch(r.thumb);
            if (!res.ok) continue;
            await PhotoDB.put(key, await res.blob());
          }
          titles.push(r.title);
        } catch { /* skip this one */ }
      }
      if (titles.length) await PhotoDB.put(ck, titles).catch(() => {});
    }
    return titles ? titles.map(t => ({ key: 'pic:' + t, title: t })) : null;
  })().finally(() => picPending.delete(ck));
  picPending.set(ck, p);
  return p;
}

async function hydratePics(root = document) {
  for (const box of root.querySelectorAll('.pics[data-item]')) {
    const it = findItem(box.dataset.item)?.item;
    if (!it) continue;
    const list = await getItemPics(it);
    if (!box.isConnected) continue;
    box.querySelectorAll('.pic.skeleton').forEach(s => s.remove());
    if (list?.length) {
      const html = (await Promise.all(list.map(async (p, i) => {
        const u = await blobURL(p.key);
        return u ? `<button type="button" class="pic" data-act="view-pics" data-id="${it.id}" data-i="${i}"><img src="${u}" alt=""></button>` : '';
      }))).join('');
      box.insertAdjacentHTML('afterbegin', html);
    }
    for (const img of box.querySelectorAll('img[data-photo]')) {
      const u = await blobURL(img.dataset.photo);
      if (u) img.src = u;
    }
  }
}

async function prefetchAll() {
  if (!navigator.onLine) return;
  const items = allItems().filter(hasPicConf);
  let done = 0;
  for (const it of items) {
    await getItemPics(it);
    done++;
    const el = $('#picStatus');
    if (el) el.textContent = `下載緊地點相片：${done}／${items.length}`;
  }
  updatePicStatus();
}
async function updatePicStatus() {
  const el = $('#picStatus');
  if (!el) return;
  const items = allItems().filter(hasPicConf);
  let have = 0;
  for (const it of items) if (await PhotoDB.get(picConfKey(it)).catch(() => null)) have++;
  el.textContent = have === items.length
    ? `✓ 所有地點相片已經存喺手機（${have} 項）`
    : `地點相片：已下載 ${have}／${items.length} 項（要上網先下載到）`;
}

/* ---------- state ---------- */
let trip = load() || freshSeed();
const ui = { tab: 'plan', day: null };
const undoStack = [];

function freshSeed() { return JSON.parse(JSON.stringify(SEED)); }
function load() { try { const s = localStorage.getItem(STORE_KEY); return s ? JSON.parse(s) : null; } catch { return null; } }
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(trip)); } catch { toast('⚠️ 儲存唔到'); } }
const allItems = () => trip.days.flatMap(d => d.items);
function findItem(id) {
  for (const day of trip.days) {
    const i = day.items.findIndex(x => x.id === id);
    if (i >= 0) return { list: day.items, index: i, item: day.items[i], day };
  }
  return null;
}
function commit(fn, msg) {
  undoStack.push(JSON.stringify(trip));
  if (undoStack.length > 40) undoStack.shift();
  fn();
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
function shiftFrom(list, index, mins) {
  list.slice(index).forEach(it => {
    if (it.status === 'done' || !isHM(it.time)) return;
    const d = durOf(it);
    it.time = fromMin(Math.max(0, Math.min(1439, toMin(it.time) + mins)));
    if (d != null) it.end = fromMin(toMin(it.time) + d);
  });
}
const hotelItem = () => allItems().find(i => i.type === 'hotel' && i.address);

/* ---------- rendering ---------- */
function render() {
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.id === ui.tab));
  const view = $('#view');
  view.innerHTML = ({ plan: renderPlan, bookings: renderBookings, phrases: renderPhrases, info: renderInfo }[ui.tab])();
  hydratePics(view);
  if (ui.tab === 'info') updatePicStatus();
}

function currentDay() {
  if (!ui.day) ui.day = (trip.days.find(d => d.date === todayStr()) || trip.days[0] || {}).id;
  return trip.days.find(d => d.id === ui.day) || trip.days[0];
}

function renderPlan() {
  const day = currentDay();
  if (!day) return `<div class="card">未有行程。</div>`;
  const today = todayStr();
  const tabs = trip.days.map((d, i) => {
    const p = dateParts(d.date);
    return `<button class="daytab ${d.id === day.id ? 'on' : ''} ${d.date === today ? 'today' : ''}" data-act="day" data-id="${d.id}">
      <span>Day ${i + 1}</span><b>${p.m}/${p.d}</b><span>星期${p.w}</span></button>`;
  }).join('');

  const isToday = day.date === today;
  const locs = day.items.map(locOf).filter(Boolean).filter((v, i, a) => v !== a[i - 1]).slice(0, 10);
  const routeUrl = locs.length >= 2 ? 'https://www.google.com/maps/dir/' + locs.map(enc).join('/') : '';
  const p = dateParts(day.date);

  let items = '';
  let prevLoc = '';
  const now = nowHM();
  const nextId = isToday ? (day.items.find(i => i.status !== 'done' && (!isHM(i.end) || i.end > now)) || {}).id : null;
  day.items.forEach(it => {
    items += it.type === 'walk' ? renderWalk(it, prevLoc) : renderItem(it, prevLoc, it.id === nextId);
    if (locOf(it)) prevLoc = locOf(it);
  });

  return `<nav class="daytabs">${tabs}</nav>
    ${renderCountdown(day)}
    <section class="dayhead">
      <p class="eyebrow">${p.m}月${p.d}日 星期${p.w} · ${esc(day.city || '')}</p>
      <h1>${esc(day.title || '')}</h1>
      ${day.notes ? `<p class="muted">${esc(day.notes)}</p>` : ''}
      <div class="row">
        ${routeUrl ? `<a class="chip dark" href="${routeUrl}" target="_blank" rel="noopener">${icon('route')}全日路線</a>` : ''}
        <a class="chip" href="${gsearch(`東京 天気 ${p.m}月${p.d}日`)}" target="_blank" rel="noopener">${icon('cloud')}天氣</a>
        <button class="chip" data-act="hotel">${icon('hotel')}返酒店</button>
      </div>
    </section>
    <div class="list">${items}</div>`;
}

function renderCountdown(day) {
  const first = trip.days[0]?.date;
  if (!first || day.id !== trip.days[0].id) return '';
  const n = daysBetween(todayStr(), first);
  return n > 0 ? `<div class="count"><b>${n}</b><span>日後出發</span></div>` : '';
}

function renderWalk(it, prevLoc) {
  const d = durOf(it);
  return `<div class="walk ${it.status === 'done' ? 'done' : ''}" id="item-${it.id}">
    <span class="t">${esc(it.time || '')}</span>
    ${icon('walk')}
    <span class="grow">步行${d ? ` ${durStr(d)}` : ''} · ${esc(it.title)}</span>
    <a class="mini" href="${gmapDir(it.from || prevLoc, it.to, 'walking')}" target="_blank" rel="noopener">路線</a>
  </div>`;
}

function picsRow(it, big = false) {
  const user = (it.photos || []).map(p => `<button type="button" class="pic" data-act="view-photo" data-id="${it.id}" data-photo="${p}"><img data-photo="${p}" alt=""></button>`).join('');
  const sk = hasPicConf(it) ? '<span class="pic skeleton"></span>'.repeat(big ? 3 : 2) : '';
  return `<div class="pics ${big ? 'big' : ''}" data-item="${it.id}">${sk}${user}
    <button type="button" class="pic add" data-act="add-photo" data-id="${it.id}" aria-label="加相">${icon('plus')}<span>加相</span></button></div>`;
}

function titleHtml(it) {
  // 電車項目嘅日文站名已經喺路線行顯示，唔使重複
  const dupRoute = TRANSPORT.has(it.type) && it.type !== 'flight' && (it.from || it.to);
  const ja = it.titleJa && it.titleJa !== it.title && !dupRoute ? it.titleJa : '';
  return `<h3 class="title">${esc(it.title)}${ja ? ` <span class="ja" lang="ja">${esc(ja)}</span>` : ''}</h3>`;
}
function routeHtml(it, big = false) {
  if (!TRANSPORT.has(it.type) || !(it.from || it.to)) return '';
  const side = (raw, zh) => `<b>${esc(nameOf(raw, zh))}</b>${raw && zh && raw !== zh ? ` <span lang="ja">${esc(raw)}</span>` : ''}`;
  return `<p class="route ${big ? 'big' : ''}">${side(it.from, it.fromZh)} → ${side(it.to, it.toZh)}</p>`;
}

function renderItem(it, prevLoc, isNext) {
  const d = durOf(it);
  const isT = TRANSPORT.has(it.type);
  const badges = [it.menu ? '菜單' : '', it.timetable?.length ? '時刻表' : '', it.planB ? '後備方案' : '']
    .filter(Boolean).map(b => `<span class="badge">${b}</span>`).join('');
  const links = linksFor(it, prevLoc).slice(0, 3)
    .map(l => `<a class="chip ${l.kind}" href="${esc(l.url)}" target="_blank" rel="noopener">${l.ic ? icon(l.ic) : ''}${esc(l.label)}</a>`).join('');
  return `<article class="item t-${it.type} ${it.status === 'done' ? 'done' : ''} ${isNext ? 'next' : ''}" id="item-${it.id}">
    <div class="when"><b>${esc(it.time || '')}</b>${isHM(it.end) ? `<span>${esc(it.end)}</span>` : ''}${d ? `<em>${durStr(d)}</em>` : ''}</div>
    <div class="card">
      <div class="head" data-act="open" data-id="${it.id}">
        <span class="dot">${icon(it.type)}</span>
        <div class="grow">
          <p class="kind">${TYPES[it.type] || ''}${it.number ? ` · ${esc(it.number)}` : ''}${isNext ? ' <b class="nowtag">下一項</b>' : ''}${it.status === 'done' ? ' · ✓ 完成' : ''}</p>
          ${titleHtml(it)}
          ${routeHtml(it)}
        </div>
        ${speakBtn(it.titleJa || (isT ? it.to : ''))}
      </div>
      ${picsRow(it)}
      ${it.notes ? `<p class="note">${esc(it.notes.split('\n')[0])}</p>` : ''}
      <div class="row">${links}<button type="button" class="chip more" data-act="open" data-id="${it.id}">${badges || '詳情'}${icon('right')}</button></div>
    </div>
  </article>`;
}

/* ---------- 詳情（彈出） ---------- */
function openItem(id) {
  const f = findItem(id);
  if (!f) return;
  const it = f.item;
  const isT = TRANSPORT.has(it.type);
  const prevLoc = (() => { for (let i = f.index - 1; i >= 0; i--) if (locOf(f.list[i])) return locOf(f.list[i]); return ''; })();
  const kv = [['時間', [it.time, it.end].filter(Boolean).join(' – ')], ['地址', it.address], ['營業時間', it.hours], ['訂位號碼', it.ref], ['備註', it.notes]]
    .filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  const links = linksFor(it, prevLoc).map(l => `<a class="chip ${l.kind}" href="${esc(l.url)}" target="_blank" rel="noopener">${l.ic ? icon(l.ic) : ''}${esc(l.label)}</a>`).join('');
  const menu = it.menu ? `<section class="sec"><h4>${icon('food')}菜單及推介${it.menu.url ? ` <a href="${esc(normUrl(it.menu.url))}" target="_blank" rel="noopener">完整菜單</a>` : ''}</h4>
    <ul class="menu">${it.menu.items.map(m => `<li><div class="grow"><b>${m.star ? '⭐ ' : ''}${esc(m.name)}</b>${m.ja ? `<span class="mja" lang="ja">${esc(m.ja)}${speakBtn(m.ja, 'sm')}</span>` : ''}${m.desc ? `<small>${esc(m.desc)}</small>` : ''}</div>${m.price ? `<span class="price">${esc(m.price)}</span>` : ''}</li>`).join('')}</ul>
    ${it.menu.tips ? `<p class="hint">${esc(it.menu.tips)}</p>` : ''}</section>` : '';
  const nextIdx = f.day.date === todayStr() && it.timetable ? it.timetable.findIndex(r => r.dep >= nowHM()) : -1;
  const tt = it.timetable?.length ? `<section class="sec"><h4>${icon('clock')}時刻表${it.timetableUrl ? ` <a href="${esc(normUrl(it.timetableUrl))}" target="_blank" rel="noopener">官方全日</a>` : ''}</h4>
    <table class="tt"><tr><th>開出</th><th>到達</th><th>班次</th><th></th></tr>${it.timetable.map((r, i) => `<tr class="${r.note ? 'pick' : ''} ${i === nextIdx ? 'nextrow' : ''}"><td><b>${esc(r.dep)}</b></td><td>${esc(r.arr || '')}</td><td>${esc(r.name || '')}</td><td>${esc(r.note || '')}${i === nextIdx ? ' 下一班' : ''}</td></tr>`).join('')}</table>
    ${it.timetableNote ? `<p class="hint">${esc(it.timetableNote)}</p>` : ''}</section>` : '';
  const taxiable = it.titleJa || it.address || (isT && it.to);
  openModal({
    title: `${it.time || ''} ${TYPES[it.type] || ''}`,
    cls: 'sheet',
    body: `<div class="sheet-title"><div class="grow">${titleHtml(it)}</div>${speakBtn(it.titleJa || (isT ? it.to : ''))}</div>
      ${routeHtml(it, true)}
      ${picsRow(it, true)}
      <div class="row">${links}</div>
      ${kv ? `<dl class="kv">${kv}</dl>` : ''}
      ${it.planB ? `<div class="planb"><b>後備方案</b><p>${esc(it.planB)}</p></div>` : ''}
      ${menu}${tt}
      <div class="actions">
        ${it.status === 'done' ? `<button type="button" class="btn" data-act="undone" data-id="${id}">${icon('reset')}未完成</button>` : `<button type="button" class="btn dark" data-act="done" data-id="${id}">${icon('check')}完成</button>`}
        ${isHM(it.time) ? `<button type="button" class="btn" data-act="shift" data-id="${id}">${icon('clock')}延遲</button>` : ''}
        ${taxiable ? `<button type="button" class="btn" data-act="taxi" data-id="${id}">${icon('car')}俾司機睇</button>` : ''}
        <button type="button" class="btn" data-act="edit" data-id="${id}">${icon('edit')}修改</button>
        <button type="button" class="btn danger" data-act="del" data-id="${id}">${icon('trash')}刪除</button>
      </div>`,
    onOpen: form => hydratePics(form),
  });
}

/* ---------- 訂單 ---------- */
function renderBookings() {
  const rows = [];
  trip.days.forEach((day, di) => day.items.forEach(it => {
    if (it.type === 'flight' || 'ref' in it || it.photos?.length || (it.type === 'hotel' && /check-in/i.test(it.title))) rows.push({ it, day, di });
  }));
  let html = `<section class="pagehead"><h1>訂單</h1><p class="muted">機票、酒店、餐廳訂位。電子機票、QR code 截圖用「加相」存喺度，冇網都睇到。</p></section>`;
  for (const { it, day, di } of rows) {
    const p = dateParts(day.date);
    const missing = it.type === 'flight' && (!it.number || it.number.includes('待填'));
    html += `<div class="card booking t-${it.type}">
      <div class="head" data-act="open" data-id="${it.id}">
        <span class="dot">${icon(it.type)}</span>
        <div class="grow">
          <p class="kind">Day ${di + 1} · ${p.m}/${p.d}（${p.w}）${it.time ? ' · ' + esc(it.time) : ''}</p>
          ${titleHtml(it)}
          ${it.ref ? `<p class="ref">${esc(it.ref)}</p>` : `<p class="hint ${missing ? 'warn' : ''}">${missing ? '⚠️ 航班號／時間未填' : '未填訂位號碼'}</p>`}
        </div>
      </div>
      ${picsRow(it)}
      <div class="row">
        ${it.ref ? `<button class="chip" data-act="copy" data-val="${esc(it.ref)}">${icon('copy')}複製號碼</button>` : ''}
        ${it.url ? `<a class="chip dark" href="${esc(normUrl(it.url))}" target="_blank" rel="noopener">${icon('ext')}開訂單／網站</a>` : ''}
        <button class="chip" data-act="edit" data-id="${it.id}">${icon('edit')}填資料</button>
      </div>
    </div>`;
  }
  return html;
}

/* ---------- 日語 ---------- */
function renderPhrases() {
  const places = [...new Map(allItems().filter(i => i.titleJa && i.type !== 'walk').map(i => [i.titleJa, i])).values()];
  const row = (ja, zh, ro = '') => `<button class="phrase" data-act="speak" data-text="${esc(ja)}">
      <div class="grow"><b lang="ja">${esc(ja)}</b>${ro ? `<span class="ro">${esc(ro)}</span>` : ''}<span class="zh">${esc(zh)}</span></div>${icon('sound')}</button>`;
  return `<section class="pagehead"><h1>日語</h1><p class="muted">撳任何一句就會讀出嚟（用手機內置日文聲，冇網都得）。</p></section>
    ${PHRASES.map(g => `<section class="card phr"><h2>${g.cat}</h2>${g.items.map(([ja, ro, zh]) => row(ja, zh, ro)).join('')}</section>`).join('')}
    <section class="card phr"><h2>地點讀音</h2>${places.map(i => row(i.titleJa, i.title)).join('')}</section>`;
}

/* ---------- 資訊（日本） ---------- */
function renderInfo() {
  const h = hotelItem();
  return `<section class="pagehead"><h1>日本資訊</h1></section>
  <section class="card">
    <h2>🆘 緊急</h2>
    <ul class="plain">
      <li>警察 <a class="tel" href="tel:110">110</a> · 火警／救護車 <a class="tel" href="tel:119">119</a></li>
      <li>JNTO 旅客熱線（24 小時，有中文）<a href="tel:+815038162787">050-3816-2787</a></li>
      <li>入境處「協助在外香港居民」熱線 <a href="tel:+8521868">(+852) 1868</a></li>
    </ul>
    <button class="phrase" data-act="speak" data-text="助けてください"><div class="grow"><b lang="ja">助けてください</b><span class="zh">救命／幫幫我</span></div>${icon('sound')}</button>
  </section>
  ${h ? `<section class="card">
    <h2>🏨 酒店</h2>
    <p><b>三井花園飯店 銀座築地</b><br><span lang="ja">${esc(h.titleJa)}</span><br><span class="muted">${esc(h.address)}</span><br><span class="muted">電話 03-5565-2731</span></p>
    <div class="row"><button class="chip dark" data-act="hotel">${icon('car')}俾司機睇／導航</button>${speakBtn(h.titleJa)}</div>
  </section>` : ''}
  <section class="card">
    <h2>📋 要知</h2>
    <ul class="plain">
      <li><b>時差</b>：日本比香港快 1 小時。</li>
      <li><b>插頭</b>：A 型兩腳扁插、100V —— 香港三腳插要帶<b>轉換插頭</b>。</li>
      <li><b>天氣</b>：10 月尾東京大約 13–20°C，早晚涼，帶薄外套。</li>
      <li><b>交通卡</b>：iPhone「錢包」可以加 Suica，拍卡搭車、便利店俾錢。</li>
      <li><b>現金</b>：築地、谷中好多小店只收現金；7-Eleven ATM 可以用海外卡提款。</li>
      <li><b>退稅</b>：同一間店同日買滿 ¥5,000（未連稅），出示護照。</li>
      <li><b>貼士</b>：日本唔使俾貼士。</li>
      <li><b>垃圾桶</b>：街上好少，帶個膠袋。</li>
    </ul>
  </section>
  <section class="card">
    <h2>🔗 連結</h2>
    <div class="row">
      <a class="chip" href="https://www.vjw.digital.go.jp/" target="_blank" rel="noopener">Visit Japan Web</a>
      <a class="chip" href="https://www.keisei.co.jp/keisei/tetudou/skyliner/tc/" target="_blank" rel="noopener">Skyliner</a>
      <a class="chip" href="https://www.tokyometro.jp/tcn/" target="_blank" rel="noopener">東京 Metro</a>
      <a class="chip" href="https://world.jorudan.co.jp/mln/zh-tw/" target="_blank" rel="noopener">Jorudan 轉乘</a>
      <a class="chip" href="https://www.jma.go.jp/bosai/forecast/" target="_blank" rel="noopener">日本天氣</a>
    </div>
  </section>
  <section class="card">
    <h2>📴 出發前準備</h2>
    <p class="muted" id="picStatus">檢查緊相片…</p>
    <div class="row"><button class="chip dark" data-act="prefetch">${icon('download')}下載所有地點相片</button></div>
    <ul class="plain">
      <li>上網時打開一次，再「加到主畫面」—— 之後冇網都開到。</li>
      <li>Google Maps 預先下載「東京」離線地圖。</li>
      <li>喺「日語」頁試一次讀音。冇聲：iPhone 設定 → 輔助使用 → 朗讀內容 → 聲音 → 日文。</li>
    </ul>
  </section>
  <section class="card">
    <h2>💾 備份</h2>
    <div class="row">
      <button class="chip" data-act="export">${icon('download')}匯出備份</button>
      <button class="chip" data-act="import">匯入備份</button>
      <button class="chip danger" data-act="reset">重設為原始行程</button>
    </div>
  </section>`;
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
  if (!dlg.open) dlg.showModal();
  if (onOpen) onOpen(form);
  return form;
}
const closeModal = () => $('#modal').open && $('#modal').close();

function editItem(id) {
  const it = findItem(id).item;
  const oldEnd = it.end;
  const f = (name, label, attrs = '') => `<label>${label}<input name="${name}" value="${esc(it[name] || '')}" ${attrs}></label>`;
  openModal({
    title: '修改',
    body: `<div class="grid2">
        <label>開始<input type="time" name="time" value="${esc(it.time || '')}"></label>
        <label>結束<input type="time" name="end" value="${esc(it.end || '')}"></label>
      </div>
      ${f('title', '標題（中文）', 'required')}
      ${f('titleJa', '日文名稱', 'lang="ja"')}
      ${TRANSPORT.has(it.type) ? f('number', '航班／班次') : ''}
      ${f('ref', '訂位／確認號碼')}
      ${f('address', '地址')}
      ${f('url', '網站／訂單連結', 'inputmode="url"')}
      <label>備註<textarea name="notes" rows="4">${esc(it.notes || '')}</textarea></label>
      ${isHM(it.end) ? `<label class="check"><input type="checkbox" name="push" checked> 改結束時間時，之後嘅行程跟住移</label>` : ''}`,
    onSubmit: fd => commit(() => {
      const cur = findItem(id);
      for (const k of ['time', 'end', 'title', 'titleJa', 'number', 'ref', 'address', 'url', 'notes']) {
        if (!fd.has(k)) continue;
        const v = fd.get(k).toString().trim();
        if (v || (k === 'ref' && 'ref' in cur.item)) cur.item[k] = v; else delete cur.item[k];
      }
      if (fd.get('push') && isHM(oldEnd) && isHM(cur.item.end)) {
        const delta = toMin(cur.item.end) - toMin(oldEnd);
        if (delta) shiftFrom(cur.list, cur.index + 1, delta);
      }
    }, '已儲存'),
  });
}

function shiftItems(id) {
  const f = findItem(id);
  openModal({
    title: '遲咗？',
    body: `<p class="hint">「${esc(f.item.title)}」同當日之後所有項目一齊推後。</p>
      <div class="bigbtns">${[10, 15, 30, 45, 60].map(m => `<button type="button" class="btn" data-min="${m}">+${m} 分</button>`).join('')}
      <button type="button" class="btn ghost" data-min="-15">提早 15 分</button></div>`,
    onOpen: form => form.querySelectorAll('[data-min]').forEach(b => {
      b.onclick = () => {
        const m = parseInt(b.dataset.min, 10);
        closeModal();
        commit(() => { const cur = findItem(id); shiftFrom(cur.list, cur.index, m); }, m > 0 ? `已推後 ${m} 分鐘` : `已提早 ${-m} 分鐘`);
      };
    }),
  });
}

function showTaxi(it) {
  const isT = TRANSPORT.has(it.type);
  const big = isT ? it.to : (it.titleJa || it.place || it.title);
  openModal({
    title: '俾司機睇',
    cls: 'taxi-modal',
    body: `<div class="taxi">
      <p class="phrase-big" lang="ja">ここへ行ってください</p>
      <p class="muted">請帶我去呢度</p>
      <div class="big" lang="ja">${esc(big)}</div>
      ${!isT && it.address ? `<div class="addr" lang="ja">${esc(it.address)}</div>` : ''}
      <div class="row center">
        <button type="button" class="btn dark" data-act="speak" data-text="${esc(`${big}までお願いします`)}">${icon('sound')}讀出</button>
        <a class="btn" href="${gmapDir('', isT ? it.to : (it.place || it.address))}" target="_blank" rel="noopener">${icon('route')}導航</a>
      </div>
    </div>`,
  });
}

async function viewPics(id, start, userPhoto) {
  const it = findItem(id).item;
  const commons = (await getItemPics(it)) || [];
  const all = [
    ...commons.map(p => ({ key: p.key, cap: p.title.replace(/^File:/, '').replace(/\.\w+$/, '') + '（Wikimedia Commons）', user: false })),
    ...(it.photos || []).map(p => ({ key: p, cap: '你加嘅相', user: true })),
  ];
  if (!all.length) return;
  let i = userPhoto ? all.findIndex(p => p.key === userPhoto) : start;
  if (!(i >= 0)) i = 0;
  const show = async form => {
    const p = all[i];
    form.querySelector('.viewer img').src = (await blobURL(p.key)) || '';
    form.querySelector('.viewer .cap').textContent = `${i + 1}／${all.length} · ${p.cap}`;
    form.querySelector('#delPic').hidden = !p.user;
  };
  openModal({
    title: it.title,
    cls: 'viewer-modal',
    body: `<div class="viewer"><img alt="">
        ${all.length > 1 ? `<button type="button" class="nav l" aria-label="上一張">${icon('left')}</button><button type="button" class="nav r" aria-label="下一張">${icon('right')}</button>` : ''}
        <p class="cap"></p></div>
      <div class="row"><button type="button" class="btn danger" id="delPic">${icon('trash')}刪除呢張</button><button type="button" class="btn" data-act="open" data-id="${id}">返去詳情</button></div>`,
    onOpen: form => {
      const go = step => { i = (i + step + all.length) % all.length; show(form); };
      form.querySelector('.nav.l')?.addEventListener('click', () => go(-1));
      form.querySelector('.nav.r')?.addEventListener('click', () => go(1));
      let x0 = null;
      const v = form.querySelector('.viewer');
      v.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
      v.addEventListener('touchend', e => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0;
        if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
        x0 = null;
      });
      form.querySelector('#delPic').onclick = () => {
        const p = all[i];
        if (!p.user || !confirm('刪除呢張相？')) return;
        closeModal();
        commit(() => { const cur = findItem(id).item; cur.photos = (cur.photos || []).filter(x => x !== p.key); }, '已刪除相片');
        PhotoDB.del(p.key).catch(() => {});
      };
      show(form);
    },
  });
}

/* ---------- 匯入／匯出 ---------- */
async function exportTrip() {
  const photos = {};
  for (const id of allItems().flatMap(i => i.photos || [])) {
    const blob = await PhotoDB.get(id).catch(() => null);
    if (blob) photos[id] = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'trip-planner', version: 3, trip, photos })], { type: 'application/json' }));
  a.download = `tokyo-trip-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('已下載備份');
}
async function importTrip(file) {
  try {
    const data = JSON.parse(await file.text());
    const t = data.trip || data;
    if (!Array.isArray(t.days)) throw new Error('檔案格式唔啱');
    if (!confirm('用備份取代現有行程？')) return;
    for (const [id, url] of Object.entries(data.photos || {})) await PhotoDB.put(id, await (await fetch(url)).blob());
    commit(() => { trip = t; ui.day = null; }, '已匯入');
  } catch (e) { alert('匯入唔到：' + e.message); }
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
let pendingPhotoItem = null;
const actions = {
  tab: id => { ui.tab = id; render(); window.scrollTo(0, 0); },
  day: id => { ui.day = id; render(); window.scrollTo(0, 0); },
  undo,
  open: id => openItem(id),
  speak: (_, el) => speak(el.dataset.text),
  done: id => { closeModal(); commit(() => { findItem(id).item.status = 'done'; }, '已完成'); },
  undone: id => { closeModal(); commit(() => { findItem(id).item.status = 'planned'; }, '已改返未完成'); },
  shift: id => shiftItems(id),
  taxi: id => showTaxi(findItem(id).item),
  hotel: () => { const h = hotelItem(); if (h) showTaxi(h); },
  edit: id => editItem(id),
  del: id => { if (!confirm('刪除呢項？')) return; closeModal(); commit(() => { const f = findItem(id); f.list.splice(f.index, 1); }, '已刪除'); },
  'add-photo': id => { pendingPhotoItem = id; $('#photoInput').click(); },
  'view-pics': (id, el) => viewPics(id, parseInt(el.dataset.i, 10)),
  'view-photo': (id, el) => viewPics(id, 0, el.dataset.photo),
  copy: (_, el) => navigator.clipboard?.writeText(el.dataset.val).then(() => toast('已複製'), () => toast('複製唔到')),
  prefetch: () => { toast('下載緊相片…'); prefetchAll().then(() => toast('相片已存好，離線可睇')); },
  export: exportTrip,
  import: () => $('#importInput').click(),
  reset: () => { if (confirm('重設為原始行程？你改過嘅內容會被取代（可以還原）。')) commit(() => { trip = freshSeed(); ui.day = null; }, '已重設'); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !actions[el.dataset.act]) return;
  e.preventDefault();
  e.stopPropagation();
  actions[el.dataset.act](el.dataset.id, el, e);
});

$('#photoInput').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length || !pendingPhotoItem) return;
  const id = pendingPhotoItem;
  const ids = [];
  for (const file of files) {
    const pid = 'p_' + uid();
    try { await PhotoDB.put(pid, await resizeImage(file)); ids.push(pid); } catch (err) { toast('存唔到相：' + err.message); }
  }
  if (!ids.length) return;
  const wasOpen = $('#modal').open;
  closeModal();
  commit(() => { const it = findItem(id).item; it.photos = [...(it.photos || []), ...ids]; }, `已加 ${ids.length} 張相`);
  if (wasOpen) openItem(id);
});
$('#importInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importTrip(f); });

/* ---------- 網絡 ---------- */
function updateNet() {
  const on = navigator.onLine;
  const el = $('#netStatus');
  el.innerHTML = `<i></i>${on ? '在線' : '離線'}`;
  el.classList.toggle('offline', !on);
  document.body.classList.toggle('is-offline', !on);
}
window.addEventListener('online', () => { updateNet(); prefetchAll().then(() => { if (!$('#modal').open) render(); }); });
window.addEventListener('offline', updateNet);
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
setInterval(() => { if (ui.tab === 'plan' && !$('#modal').open) render(); }, 60_000);

/* ---------- boot ---------- */
if ((trip.seedVersion || 0) < SEED.seedVersion) {
  if (confirm('有新版行程，要唔要載入？（你改過嘅內容會被取代）')) trip = freshSeed();
  else trip.seedVersion = SEED.seedVersion;
}
$('#tripName').textContent = trip.name || '東京';
save();
updateNet();
render();
setTimeout(() => prefetchAll().then(() => { if (ui.tab !== 'plan' || $('#modal').open) return; render(); }), 1200);
