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
  navigate: '<path d="m3 11 19-9-9 19-2-8z"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
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

const MAPQ = SEED.mapq || {};
const mq = s => MAPQ[s] || s || '';

/** 呢項行程完咗之後人喺邊 —— 用嚟計下一項嘅路線起點 */
function locOf(it) {
  if (!it) return '';
  if (TRANSPORT.has(it.type)) return mq(it.to);
  return it.mapQuery || mq(it.place) || it.address || '';
}
/** 呢項行程嘅目的地（Google Maps 用） */
const destOf = it => locOf(it) || it.titleJa || it.title;

/** Excel「預約/地圖 URL」欄入面嘅連結，前面嘅文字做標籤（例如「預約：https://…」） */
function xUrlLinks(it) {
  const parts = (it.xUrl || '').split(/(https?:\/\/[^\s，、]+)/);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) {
    const before = parts[i - 1].trim().replace(/[：:]\s*$/, '').trim();
    const url = parts[i];
    const isMap = /maps\.app\.goo\.gl|google\.[^/]+\/maps/.test(url);
    out.push({ label: before || (isMap ? 'Excel 地圖連結' : /ekitan|timetable/.test(url) ? '時刻表（Excel）' : 'Excel 連結'), url, isMap });
  }
  return out;
}

/** 每項嘅連結：1. 上一站 → 呢度  2. 我嘅位置 → 呢度，再加網站、Tabelog、時刻表等 */
function linksFor(it, prevLoc) {
  const L = [];
  const seen = new Set();
  const add = (label, url, kind = '', ic = '') => { if (url && !seen.has(url)) { seen.add(url); L.push({ label, url, kind, ic }); } };
  const t = it.type;
  if (t === 'flight') {
    const no = (it.number || '').replace(/\s+/g, '');
    if (no && !no.includes('待填')) add('航班狀態', `https://www.flightradar24.com/data/flights/${enc(no.toLowerCase())}`, 'accent', 'flight');
  } else {
    const mode = t === 'walk' ? 'walking' : 'transit';
    const dest = destOf(it);
    const origin = TRANSPORT.has(t) ? (mq(it.from) || prevLoc) : prevLoc;
    if (origin && origin !== dest) add('上一站 → 呢度', gmapDir(origin, dest, mode), 'accent', 'route');
    add('我嘅位置 → 呢度', gmapDir('', dest, mode), origin && origin !== dest ? '' : 'accent', 'navigate');
    if (!TRANSPORT.has(t)) add('地圖', gmapSearch(dest), '', 'map');
  }
  (it.tabelog || []).forEach(tb => add(`Tabelog ★${tb.rating}`, tb.url, 'tabelog', 'star'));
  xUrlLinks(it).forEach(l => add(l.label, l.url, '', l.isMap ? 'map' : 'ext'));
  if (it.url) add(it.type === 'food' ? '網站／訂位' : it.type === 'hotel' ? '酒店網站' : '官網', normUrl(it.url), '', 'ext');
  if (it.timetableUrl) add('時刻表', normUrl(it.timetableUrl), '', 'clock');
  (it.stationLinks || []).forEach(l => add(l.label, normUrl(l.url), '', 'map'));
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

function resizeImage(file, max = 1600) {
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
async function downloadOffline() {
  if (!navigator.onLine) return toast('要上網先下載到');
  toast('下載緊離線資料，請保持 App 開住…');
  await prefetchAll();
  const r = await prefetchMaps(msg => { const el = $('#mapStatus'); if (el) el.textContent = msg; });
  if (r.done >= r.total) localStorage.setItem('trip-maps4-at', String(Date.now()));
  updatePicStatus();
  toast(r.done >= r.total ? `離線資料已下載好（地圖 ${r.total} 格）` : '下載未完成——上網後再撳一次會繼續');
}
async function updatePicStatus() {
  const ms = $('#mapStatus');
  if (ms) { const t = +localStorage.getItem('trip-maps4-at'); ms.textContent = t ? `✓ 地圖及路線已下載（${new Date(t).getMonth() + 1}/${new Date(t).getDate()}）` : '地圖及路線：未下載'; }
  const el = $('#picStatus');
  if (!el) return;
  const items = allItems().filter(hasPicConf);
  let have = 0;
  for (const it of items) if (await PhotoDB.get(picConfKey(it)).catch(() => null)) have++;
  el.textContent = have === items.length
    ? `✓ 所有地點相片已經存喺手機（${have} 項）`
    : `地點相片：已下載 ${have}／${items.length} 項（要上網先下載到）`;
}

/* ---------- 天氣（Open-Meteo，免費；上網時更新，離線顯示最後一次） ---------- */
const ACCU_URL = 'https://www.accuweather.com/ja/jp/tokyo/226396/november-weather/226396';
const WX_API = 'https://api.open-meteo.com/v1/forecast?latitude=35.6762&longitude=139.6503&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=16';
const WMO = c => c === 0 ? ['☀️', '晴'] : c <= 2 ? ['🌤️', '大致晴'] : c === 3 ? ['☁️', '陰'] : c <= 48 ? ['🌫️', '霧']
  : c <= 57 ? ['🌦️', '毛毛雨'] : c <= 67 ? ['🌧️', '雨'] : c <= 77 ? ['🌨️', '雪'] : c <= 82 ? ['🌦️', '驟雨'] : ['⛈️', '雷雨'];
function wxCache() { try { return JSON.parse(localStorage.getItem('trip-wx') || 'null'); } catch { return null; } }
async function loadWeather() {
  if (!navigator.onLine) return;
  try {
    const r = await fetch(WX_API);
    if (!r.ok) return;
    const j = await r.json();
    if (!j.daily) return;
    localStorage.setItem('trip-wx', JSON.stringify({ at: Date.now(), j }));
    const el = $('#wx');
    if (el) el.innerHTML = wxText(currentDay());
  } catch { /* 冇網就用舊資料 */ }
}
function wxText(day) {
  const c = wxCache();
  const D = c?.j?.daily;
  const parts = [];
  const at = i => ({ e: WMO(D.weather_code[i]), hi: Math.round(D.temperature_2m_max[i]), lo: Math.round(D.temperature_2m_min[i]), pop: D.precipitation_probability_max?.[i] });
  if (c?.j?.current && D) {
    const [e, t] = WMO(c.j.current.weather_code);
    const i = D.time.indexOf(todayStr());
    const d = i >= 0 ? at(i) : null;
    parts.push(`<b>今日東京</b> ${e} ${t} ${Math.round(c.j.current.temperature_2m)}°${d ? `（${d.lo}–${d.hi}°）` : ''}`);
  }
  if (day && day.date !== todayStr()) {
    const p = dateParts(day.date);
    const i = D ? D.time.indexOf(day.date) : -1;
    if (i >= 0) { const d = at(i); parts.push(`<b>${p.m}/${p.d} 預測</b> ${d.e[0]} ${d.e[1]} ${d.lo}–${d.hi}°${d.pop != null ? ` · 降雨 ${d.pop}%` : ''}`); }
    else parts.push(`<b>${p.m}/${p.d}</b> 平年約 12–19°（出發前兩星期內先有預測）`);
  }
  if (c?.at) { const t = new Date(c.at); parts.push(`<small>更新 ${t.getMonth() + 1}/${t.getDate()} ${pad(t.getHours())}:${pad(t.getMinutes())}</small>`); }
  return parts.join('<br>') || '上網後顯示天氣';
}

/* ---------- 離線地圖（Leaflet）：可以放大縮小、拖動；圖塊下載一次之後冇網都用到 ---------- */
// 地圖圖塊：Esri World Street Map（免 API key）；載入唔到就用 OpenStreetMap。
// （CARTO 由 2026 年 9 月起要 API key，冇 key 只會俾「API KEY REQUIRED」水印圖。）
const TILE_SOURCES = [
  (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`,
  (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
];
const TILE_PREFIX = 'tile2:';
const MAX_CACHE_Z = 17; // 下載到 17 級；再放大會用 17 級放大顯示
// 日本國土地理院（GSI）地址搜尋：日文地址準確到街區；搵唔到先用 OpenStreetMap Nominatim
const GSI_URL = q => `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${enc(q)}`;
const NOMI_URL = q => `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=jp&accept-language=ja&q=${enc(q)}`;
const FOOT_URL = (a, b) => `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 車站同機場座標（固定，唔使上網查） */
const FIXED_LL = {
  '空港第2ビル駅': [35.77310, 140.38700], '成田国際空港 第2ターミナル': [35.77200, 140.38740], 'うなぎ四代目菊川 成田空港店': [35.77230, 140.38690],
  '京成上野駅': [35.71128, 139.77380], '上野駅': [35.71120, 139.77690], '築地駅': [35.66800, 139.77220], '根津駅': [35.71750, 139.76560],
  '千駄木駅': [35.72560, 139.76300], '早稲田駅': [35.70560, 139.72120], '新宿駅': [35.69050, 139.70040], '西武新宿駅': [35.69600, 139.70030],
  '東銀座駅': [35.66970, 139.76710], '銀座駅': [35.67170, 139.76500], '表参道駅': [35.66540, 139.71210], '明治神宮前駅': [35.66850, 139.70520],
  '代官山駅': [35.64810, 139.70340], '中目黒駅': [35.64410, 139.69900], '赤羽橋駅': [35.65510, 139.74370], '築地市場駅': [35.66500, 139.76630],
};
const ll = a => ({ lat: a[0], lon: a[1] });

let geoChain = Promise.resolve();
/** 地址 → 座標（結果存喺手機，之後離線用） */
async function geocode(q) {
  q = (q || '').trim();
  if (!q) return null;
  const key = 'geo2:' + q;
  const c = await PhotoDB.get(key).catch(() => null);
  if (c) return c.none ? null : c;
  if (!navigator.onLine) return null;
  const job = geoChain.then(async () => {
    let g = null, answered = false;
    try {
      const r = await fetch(GSI_URL(q));
      if (r.ok) { answered = true; const j = await r.json(); const f = j?.[0]?.geometry?.coordinates; if (f) g = { lat: +f[1], lon: +f[0] }; }
    } catch { /* 試 Nominatim */ }
    if (!g) {
      try {
        await sleep(1000);
        const r = await fetch(NOMI_URL(q));
        if (r.ok) { answered = true; const j = await r.json(); if (j[0]) g = { lat: +j[0].lat, lon: +j[0].lon }; }
      } catch { /* 冇結果 */ }
    }
    if (g || answered) await PhotoDB.put(key, g || { none: true }).catch(() => {});
    await sleep(300);
    return g;
  });
  geoChain = job.catch(() => {});
  return job;
}
function cleanAddr(a) {
  a = (a || '').replace(/〒\d{3}-\d{4}\s*/, '').replace(/^[^：]*：/, '').split(/[；（(]/)[0].trim();
  const m = a.match(/^(.*?[0-9０-９]+(?:[-－][0-9０-９]+)*)/);
  return m ? m[1] : a;
}
/** 只接受東京／成田一帶嘅座標；地址搜尋出錯（例如搵到第二個縣）就當搵唔到 */
const okPt = p => p && p.lat > 35.45 && p.lat < 35.95 && p.lon > 139.45 && p.lon < 140.55;
async function firstGeo(qs) {
  for (const q of qs.filter(Boolean)) { const g = await geocode(q); if (okPt(g)) return g; }
  return null;
}
async function placePt(it) {
  if (it.lat != null && it.lon != null) return { lat: it.lat, lon: it.lon };        // 你自己修正過
  if (Array.isArray(it.geo)) return ll(it.geo);
  if (FIXED_LL[it.place]) return ll(FIXED_LL[it.place]);
  return firstGeo([typeof it.geo === 'string' && cleanAddr(it.geo), cleanAddr(it.address), it.address, (it.titleJa || '').split(/[（(・]/)[0], it.place]);
}
const stationPt = s => s && FIXED_LL[s] ? Promise.resolve(ll(FIXED_LL[s])) : firstGeo([s, s && mq(s)]);
const startPt = it => it.type === 'walk' ? null : TRANSPORT.has(it.type) ? stationPt(it.from) : placePt(it);
const endPt = it => it.type === 'walk' ? null : TRANSPORT.has(it.type) ? stationPt(it.to) : placePt(it);

/** 計呢項嘅地圖：起點 a（上一站）、終點 b（呢度）、路線 */
async function mapGeom(list, idx) {
  const it = list[idx];
  if (it.type === 'flight') return null;
  const prevReal = list.slice(0, idx).reverse().find(x => x.type !== 'walk' && x.type !== 'flight');
  const nextReal = list.slice(idx + 1).find(x => x.type !== 'walk' && x.type !== 'flight');
  let a = null, b = null;
  if (it.type === 'walk') {
    a = (prevReal && await endPt(prevReal)) || await stationPt(it.from);
    b = (nextReal && await startPt(nextReal)) || await stationPt(it.to);
  } else if (TRANSPORT.has(it.type)) {
    a = await stationPt(it.from);
    b = await stationPt(it.to);
  } else {
    a = prevReal ? await endPt(prevReal) : null;
    b = await placePt(it);
  }
  if (!b && !a) return null;
  let route = null, walking = false;
  if (a && b && distM(a, b) > 30) {
    walking = !TRANSPORT.has(it.type) && distM(a, b) < 2500 || (it.type === 'walk' && distM(a, b) < 3000);
    if (walking) route = await footRoute(a, b);
  }
  return { a, b, route, walking };
}
async function footRoute(a, b) {
  const key = `route:${a.lat.toFixed(5)},${a.lon.toFixed(5)};${b.lat.toFixed(5)},${b.lon.toFixed(5)}`;
  const c = await PhotoDB.get(key).catch(() => null);
  if (c) return c;
  if (!navigator.onLine) return null;
  try {
    const r = await fetch(FOOT_URL(a, b));
    const j = await r.json();
    const coords = j.routes?.[0]?.geometry?.coordinates?.map(([lon, lat]) => [lat, lon]);
    if (coords?.length) { await PhotoDB.put(key, coords).catch(() => {}); return coords; }
  } catch { /* 用直線 */ }
  return null;
}
function distM(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const distStr = m => m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${Math.round(m / 10) * 10} 米`;
function bearingName(a, b) {
  const r = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  const deg = (Math.atan2(y, x) / r + 360) % 360;
  return ['北', '東北', '東', '東南', '南', '西南', '西', '西北'][Math.round(deg / 45) % 8];
}
const routeLen = r => r.slice(1).reduce((s, p, i) => s + distM({ lat: r[i][0], lon: r[i][1] }, { lat: p[0], lon: p[1] }), 0);
const tileX = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const tileY = (lat, z) => { const s = Math.sin(lat * Math.PI / 180); return Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z); };

async function getTile(z, x, y, fetchMissing) {
  const key = `${TILE_PREFIX}${z}/${x}/${y}`;
  let b = await PhotoDB.get(key).catch(() => null);
  if (!b && fetchMissing && navigator.onLine) {
    for (const src of TILE_SOURCES) {
      try {
        const r = await fetch(src(z, x, y));
        const type = r.headers.get('content-type') || '';
        if (r.ok && type.startsWith('image/')) { b = await r.blob(); if (b.size > 200) { await PhotoDB.put(key, b).catch(() => {}); break; } b = null; }
      } catch { /* 試下一個 */ }
    }
  }
  return b;
}

/* --- Leaflet --- */
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (!document.querySelector('link[href$="leaflet.css"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'vendor/leaflet/leaflet.css'; document.head.appendChild(l);
  }
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/leaflet/leaflet.js';
    s.onload = res;
    s.onerror = () => rej(new Error('載入唔到地圖工具'));
    document.head.appendChild(s);
  });
}
function offlineTileLayer() {
  const Layer = L.GridLayer.extend({
    createTile(c, done) {
      const img = document.createElement('img');
      img.alt = '';
      getTile(c.z, c.x, c.y, true).then(b => {
        if (!b) { img.className = 'tile-missing'; done(null, img); return; }
        img.onload = () => done(null, img);
        img.onerror = () => done(null, img);
        img.src = URL.createObjectURL(b);
      });
      return img;
    },
  });
  const layer = new Layer({ maxNativeZoom: MAX_CACHE_Z, maxZoom: 19, minZoom: 5, tileSize: 256, attribution: '© Esri · © OpenStreetMap' });
  layer.on('tileunload', e => { if (e.tile.src?.startsWith('blob:')) URL.revokeObjectURL(e.tile.src); });
  return layer;
}
const mapState = { map: null, id: null, layers: null, watch: null, pin: false };
function closeMapState() {
  if (mapState.watch != null) navigator.geolocation?.clearWatch(mapState.watch);
  mapState.map?.remove();
  Object.assign(mapState, { map: null, id: null, layers: null, watch: null, pin: false, fitted: false });
}

/** 喺詳情入面顯示（或者重畫）呢項嘅地圖 */
async function drawItemMap(id) {
  const box = document.querySelector(`.omap[data-map="${id}"]`);
  const info = $('#omap-info-' + id);
  const f = findItem(id);
  if (!box || !f) return;
  try { await loadLeaflet(); } catch (e) { info.textContent = e.message; return; }
  const g = await mapGeom(f.list, f.index);
  if (!box.isConnected) return;
  const holder = box.querySelector('.leaf');
  if (!g) {
    info.textContent = navigator.onLine ? '搵唔到呢個地點嘅座標——撳「修正位置」自己揀。' : '未有座標——上網時喺「資訊」撳「下載離線資料」，或者撳「修正位置」。';
    holder.classList.add('empty');
  } else holder.classList.remove('empty');
  if (mapState.id !== id || !mapState.map || mapState.map.getContainer() !== holder) {
    closeMapState();
    const map = L.map(holder, { zoomControl: true, attributionControl: true, maxZoom: 19, minZoom: 5, tap: true });
    map.attributionControl.setPrefix(false);
    offlineTileLayer().addTo(map);
    map.on('click', e => { if (mapState.pin) setItemLatLon(id, e.latlng.lat, e.latlng.lng); });
    Object.assign(mapState, { map, id, layers: L.layerGroup().addTo(map) });
    $('#modal').addEventListener('close', closeMapState, { once: true });
  }
  const { map, layers } = mapState;
  layers.clearLayers();
  const pts = [];
  const tip = (m, t) => m.bindTooltip(t, { permanent: true, direction: 'right', className: 'omap-tip', offset: [8, 0] });
  if (g?.route) layers.addLayer(L.polyline(g.route, { color: '#1a73e8', weight: 6, opacity: .85 }));
  else if (g?.a && g?.b) layers.addLayer(L.polyline([[g.a.lat, g.a.lon], [g.b.lat, g.b.lon]], { color: '#1a73e8', weight: 4, dashArray: '8 8' }));
  const apart = g?.a && g?.b && distM(g.a, g.b) > 30;
  if (g?.a && (apart || !g.b)) { layers.addLayer(tip(L.circleMarker([g.a.lat, g.a.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#8a8780', fillOpacity: 1 }), '上一站')); pts.push([g.a.lat, g.a.lon]); }
  if (g?.b) { layers.addLayer(tip(L.circleMarker([g.b.lat, g.b.lon], { radius: 10, color: '#fff', weight: 3, fillColor: '#e8452c', fillOpacity: 1 }), '呢度')); pts.push([g.b.lat, g.b.lon]); }
  if (g?.route) g.route.forEach(p => pts.push(p));
  if (ui.me) layers.addLayer(L.circleMarker([ui.me.lat, ui.me.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }).bindTooltip('你', { permanent: true, direction: 'left', className: 'omap-tip' }));
  if (!mapState.fitted) {
    if (pts.length > 1) map.fitBounds(pts, { padding: [36, 36], maxZoom: 17 });
    else if (pts.length === 1) map.setView(pts[0], 17);
    else map.setView([35.6762, 139.7503], 12);
    mapState.fitted = true;
  }
  setTimeout(() => map.invalidateSize(), 50);
  const lines = [];
  if (apart) lines.push(`${g.walking ? '步行' : '直線'}距離約 ${distStr(g.route ? routeLen(g.route) : distM(g.a, g.b))}${g.route ? '（步行路線）' : ''}`);
  if (ui.me && g?.b) lines.push(`你而家距離「呢度」${distStr(distM(ui.me, g.b))}，向${bearingName(ui.me, g.b)}行`);
  if (f.item.lat != null) lines.push('📍 用緊你修正嘅位置');
  if (mapState.pin) lines.push('👆 撳地圖上正確嘅位置');
  if (g) info.textContent = lines.join(' · ') || '兩指放大縮小、拖動睇周圍。';
}
function setItemLatLon(id, lat, lon) {
  mapState.pin = false;
  commit(() => { const it = findItem(id).item; if (lat == null) { delete it.lat; delete it.lon; } else { it.lat = +lat.toFixed(6); it.lon = +lon.toFixed(6); } },
    lat == null ? '已還原自動位置' : '已儲存呢度嘅位置');
  mapState.fitted = false;
  $('#pinpanel-' + id)?.setAttribute('hidden', '');
  drawItemMap(id);
}
function parseLatLon(s) {
  const m = String(s || '').match(/(-?\d{1,3}\.\d+)\s*[,，\s]\s*(-?\d{1,3}\.\d+)/);
  return m ? { lat: +m[1], lon: +m[2] } : null;
}
function startLocate(id) {
  if (!navigator.geolocation) return toast('呢部機唔支援定位');
  toast('搵緊你嘅位置…');
  if (mapState.watch != null) navigator.geolocation.clearWatch(mapState.watch);
  let first = true;
  mapState.watch = navigator.geolocation.watchPosition(p => {
    ui.me = { lat: p.coords.latitude, lon: p.coords.longitude };
    drawItemMap(id);
    if (first && mapState.map) { first = false; mapState.map.setView([ui.me.lat, ui.me.lon], Math.max(mapState.map.getZoom(), 16)); }
  }, () => toast('攞唔到位置——請容許「定位」權限'), { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 });
}

/** 要下載嘅地圖圖塊：每個地點周圍 14–17 級（細範圍）、東京＋成田總覽。上限 3,000 格 */
async function wantedTiles(onProgress) {
  const jobs = trip.days.flatMap(d => d.items.map((it, i) => [d.items, i])).filter(([l, i]) => l[i].type !== 'flight');
  const want = new Set();
  const addBox = (lat1, lon1, lat2, lon2, z) => {
    const x1 = tileX(Math.min(lon1, lon2), z), x2 = tileX(Math.max(lon1, lon2), z);
    const y1 = tileY(Math.max(lat1, lat2), z), y2 = tileY(Math.min(lat1, lat2), z);
    if ((x2 - x1 + 1) * (y2 - y1 + 1) > 60) return; // 範圍太大（地點出錯）就唔下載
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) want.add(`${z}/${x}/${y}`);
  };
  const around = (p, z, m) => { const dLat = m / 111000, dLon = m / (111000 * Math.cos(p.lat * Math.PI / 180)); addBox(p.lat - dLat, p.lon - dLon, p.lat + dLat, p.lon + dLon, z); };
  const R = { 14: 700, 15: 450, 16: 280, 17: 160 };
  for (const z of [11, 12]) addBox(35.63, 139.68, 35.73, 139.80, z);
  for (const z of [12, 13]) addBox(35.76, 140.37, 35.78, 140.40, z);
  let done = 0;
  for (const [list, i] of jobs) {
    const g = await mapGeom(list, i).catch(() => null);
    for (const p of [g?.a, g?.b].filter(okPt)) for (const z of [14, 15, 16, 17]) around(p, z, R[z]);
    if (g?.route && g.route.length) for (const z of [15, 16]) { const la = g.route.map(r => r[0]), lo = g.route.map(r => r[1]); addBox(Math.min(...la), Math.min(...lo), Math.max(...la), Math.max(...lo), z); }
    onProgress?.(`搵緊地點及路線 ${++done}／${jobs.length}`);
  }
  return [...want].slice(0, 3000);
}
/** 下載地圖：6 格同時下載；已經下載過嘅會跳過，所以中途停咗下次會由停低嗰度繼續 */
async function prefetchMaps(onProgress) {
  const tiles = await wantedTiles(onProgress);
  const wantKeys = new Set(tiles.map(t => TILE_PREFIX + t));
  // 清走唔需要嘅舊圖塊（之前出錯下載咗太多）
  const removed = await PhotoDB.run('readwrite', st => {
    let n = 0; const req = st.openCursor();
    req.onsuccess = () => { const c = req.result; if (!c) return; const k = String(c.key); if (k.startsWith('tile') && !wantKeys.has(k)) { c.delete(); n++; } c.continue(); };
    return { get result() { return n; } };
  }).catch(() => 0);
  let n = 0, i = 0;
  const worker = async () => {
    while (i < tiles.length && navigator.onLine) {
      const [z, x, y] = tiles[i++].split('/').map(Number);
      await getTile(z, x, y, true);
      n++;
      if (n % 10 === 0 || n === tiles.length) onProgress?.(`下載緊地圖 ${n}／${tiles.length}（可以隨時停，下次會繼續）`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { total: tiles.length, done: n, removed };
}

/* ---------- Excel 匯出／匯入（同你嘅 Itinerary 試算表一樣格式） ---------- */
const XL_HEAD = ['日期', '開始', '結束', '時長', '活動', '備註', '交通', '預約/地圖 URL'];
function loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/xlsx.full.min.js';
    s.onload = res;
    s.onerror = () => rej(new Error('載入唔到 Excel 工具（第一次要上網）'));
    document.head.appendChild(s);
  });
}
async function exportExcel() {
  try { await loadXLSX(); } catch (e) { return toast(e.message); }
  const aoa = [XL_HEAD];
  trip.days.forEach((d, i) => {
    if (i) aoa.push([]);
    const [y, m, dd] = d.date.split('-').map(Number);
    d.items.forEach(it => aoa.push([new Date(y, m - 1, dd), it.time || '', it.end || '—', durStr(durOf(it)) || '', it.title || '', it.xNote || '', it.xTransport || '', it.xUrl || '']));
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  for (let r = 1; r < aoa.length; r++) { const c = ws[XLSX.utils.encode_cell({ r, c: 0 })]; if (c) c.z = 'yyyy-mm-dd'; }
  ws['!cols'] = [12, 7, 7, 9, 38, 34, 46, 60].map(wch => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, `Tokyo_Itinerary_${todayStr()}.xlsx`);
  toast('已匯出 Excel');
}
const cellStr = v => { const s = String(v ?? '').trim(); return s === '—' || s === '-' ? '' : s; };
function cellDate(v) {
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : ''; }
  if (v instanceof Date) return ymd(v);
  const m = String(v || '').match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  return m ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` : '';
}
function cellTime(v) {
  if (typeof v === 'number') { const mins = Math.round((v % 1) * 1440); return fromMin(mins); }
  const m = String(v || '').match(/(\d{1,2})[:：](\d{2})/);
  return m ? `${pad(+m[1])}:${m[2]}` : '';
}
function guessType(act, tr) {
  if (/航班|起飛|Flight/i.test(act)) return 'flight';
  if (/早餐|午餐|晚餐|食/.test(act)) return 'food';
  if (/酒店|Check-in|Check-out/i.test(act)) return 'hotel';
  if (/→/.test(act) && /線|Skyliner|電車|地鐵|Metro|JR|巴士/.test(tr)) return 'train';
  if (/→/.test(act) || /^步行|步行約/.test(tr)) return 'walk';
  if (/免稅|購物|LOFT|Loft|書店|STOCK/.test(act)) return 'shop';
  return 'sight';
}
async function importExcel(file) {
  try {
    await loadXLSX();
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: false });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
    const hi = rows.findIndex(r => r.some(c => String(c).trim() === '活動'));
    if (hi < 0) throw new Error('搵唔到「活動」欄');
    const H = rows[hi].map(c => String(c).trim());
    const col = n => H.findIndex(h => h.startsWith(n));
    const C = { date: col('日期'), st: col('開始'), en: col('結束'), act: col('活動'), note: col('備註'), tr: col('交通'), url: col('預約') };
    const parsed = [];
    for (const r of rows.slice(hi + 1)) {
      const act = cellStr(r[C.act]), date = cellDate(r[C.date]);
      if (!act || !date) continue;
      parsed.push({ date, time: cellTime(r[C.st]), end: cellTime(r[C.en]), act, note: C.note >= 0 ? cellStr(r[C.note]) : '', tr: C.tr >= 0 ? cellStr(r[C.tr]) : '', url: C.url >= 0 ? cellStr(r[C.url]) : '' });
    }
    if (!parsed.length) throw new Error('Excel 入面搵唔到行程');
    const old = new Map(trip.days.map(d => [d.date, d]));
    const used = new Set();
    const days = [];
    let upd = 0, add = 0;
    for (const row of parsed) {
      let day = days.find(d => d.date === row.date);
      if (!day) {
        const o = old.get(row.date);
        day = { ...(o ? JSON.parse(JSON.stringify({ ...o, items: [] })) : { id: 'd' + row.date.replace(/-/g, ''), date: row.date, country: 'JP', city: '東京', title: '' }), items: [] };
        days.push(day);
      }
      const pool = (old.get(row.date)?.items || []).filter(i => !used.has(i.id));
      const m = pool.find(i => i.title === row.act) || pool.find(i => row.time && i.time === row.time);
      let it;
      if (m) { used.add(m.id); it = JSON.parse(JSON.stringify(m)); upd++; }
      else { it = { id: uid(), status: 'planned', type: guessType(row.act, row.tr) }; add++; }
      it.title = row.act;
      if (row.time) it.time = row.time; else delete it.time;
      if (row.end) it.end = row.end; else delete it.end;
      it.xNote = row.note; it.xTransport = row.tr; it.xUrl = row.url;
      day.items.push(it);
    }
    const removed = trip.days.reduce((n, d) => n + d.items.filter(i => !used.has(i.id)).length, 0);
    days.sort((a, b) => a.date.localeCompare(b.date));
    if (!confirm(`Excel 有 ${parsed.length} 項：更新 ${upd} 項、新增 ${add} 項、刪除 ${removed} 項。\n照 Excel 更新行程？（之後可以還原）`)) return;
    commit(() => { trip.days = days; ui.day = null; }, '已由 Excel 更新行程');
  } catch (e) {
    alert('匯入 Excel 唔到：' + e.message);
  }
}

/* =========================================================
   就地修改：撳任何資料就可以改（手機、電腦都得）
   ========================================================= */
/** 文字入面嘅網址變成可以撳嘅連結 */
const linkify = s => esc(s).replace(/https?:\/\/[^\s<>"'，、。；）)]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);

const menuToText = m => (m?.items || []).map(x => `${x.star ? '⭐ ' : ''}${x.name || ''} | ${x.ja || ''} | ${x.price || ''} | ${x.desc || ''}`).join('\n');
function textToMenuItems(txt) {
  return txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const star = /^(⭐|\*)/.test(l);
    const [name, ja, price, desc] = l.replace(/^(⭐|\*)\s*/, '').split('|').map(s => (s || '').trim());
    const o = { name };
    if (ja) o.ja = ja; if (price) o.price = price; if (desc) o.desc = desc; if (star) o.star = true;
    return o;
  }).filter(o => o.name);
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
const linksToText = ls => (ls || []).map(l => `${l.label} | ${l.url}`).join('\n');
function textToLinks(txt) {
  return txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/https?:\/\/\S+/);
    if (!m) return null;
    const label = l.replace(m[0], '').replace(/[|｜：:]\s*$/, '').replace(/^\s*[|｜]\s*/, '').trim();
    return { label: label || '連結', url: m[0] };
  }).filter(Boolean);
}
const tbToText = tbs => (tbs || []).map(t => [`${t.name} | ${t.rating} | ${t.reviews} | ${t.budget} | ${t.url}`, ...(t.summary || []).map(s => `- ${s}`)].join('\n')).join('\n\n');
function textToTb(txt) {
  return txt.split(/\n\s*\n/).map(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return null;
    const [name, rating, reviews, budget, url] = lines[0].split('|').map(s => (s || '').trim());
    return { name, rating: rating || '—', reviews: reviews || '—', budget: budget || '—', url: url || '', summary: lines.slice(1).map(l => l.replace(/^[-•・]\s*/, '')) };
  }).filter(t => t && t.name);
}

/** 特別欄位：點樣讀出嚟做文字、點樣由文字寫返入去 */
const FIELD_IO = {
  menuText: { get: it => menuToText(it.menu), set: (it, v) => { const items = textToMenuItems(v); if (items.length) it.menu = { ...(it.menu || {}), items }; else delete it.menu; } },
  menuTips: { get: it => it.menu?.tips || '', set: (it, v) => { if (!it.menu) it.menu = { items: [] }; if (v) it.menu.tips = v; else delete it.menu.tips; } },
  menuUrl: { get: it => it.menu?.url || '', set: (it, v) => { if (!it.menu) it.menu = { items: [] }; if (v) it.menu.url = v; else delete it.menu.url; } },
  ttText: { get: it => ttToText(it.timetable), set: (it, v) => { const t = textToTT(v); if (t.length) it.timetable = t; else delete it.timetable; } },
  linksText: { get: it => linksToText(it.links), set: (it, v) => { const l = textToLinks(v); if (l.length) it.links = l; else delete it.links; } },
  tbText: { get: it => tbToText(it.tabelog), set: (it, v) => { const t = textToTb(v); if (t.length) it.tabelog = t; else delete it.tabelog; } },
};
const FIELD_HINT = {
  menuText: '每行一樣：⭐ 中文名 | 日文名 | 價錢 | 描述（⭐ 代表推介）',
  ttText: '每行一班：開出 → 到達 | 班次 | 備註，例如 17:43 → 18:24 | 56號 | 建議',
  linksText: '每行一個：名稱 | 網址，例如 菜單 | https://…',
  tbText: '第一行：名稱 | 評分 | 評價數 | 預算 | Tabelog 網址；之後每行「- 摘要」。幾間餐廳之間空一行。',
  xUrl: '可以寫「預約：https://…」，網址會變成按鈕',
};

/** 可以就地修改嘅一行資料 */
function ef(kind, id, field, label, val, { ph = '撳呢度加', compact = false, h1 = false } = {}) {
  const shown = val ? linkify(val) : `<i class="muted">${ph}</i>`;
  return `<div class="ef ${compact ? 'compact' : ''} ${h1 ? 'h1' : ''} ${val ? '' : 'empty'}" data-act="ef" data-kind="${kind}" data-id="${id}" data-field="${field}">
    ${label ? `<span class="ef-k">${label}</span>` : ''}<div class="ef-v">${compact ? '' : shown}</div><span class="ef-pen" aria-hidden="true">✎</span></div>`;
}
const efTarget = el => el.dataset.kind === 'day' ? findDay(el.dataset.id) : findItem(el.dataset.id)?.item;
const findDay = id => trip.days.find(d => d.id === id);
function startEdit(el) {
  if (el.classList.contains('editing')) return;
  const obj = efTarget(el);
  if (!obj) return;
  const f = el.dataset.field;
  const cur = FIELD_IO[f] ? FIELD_IO[f].get(obj) : (obj[f] ?? '');
  el.classList.add('editing');
  const rows = Math.min(12, Math.max(2, String(cur).split('\n').length + 1));
  el.querySelector('.ef-v').innerHTML = `<textarea rows="${rows}">${esc(cur)}</textarea>
    ${FIELD_HINT[f] ? `<p class="hint">${FIELD_HINT[f]}</p>` : ''}
    <div class="row"><button type="button" class="chip dark" data-act="ef-save">儲存</button><button type="button" class="chip" data-act="ef-cancel">取消</button></div>`;
  const ta = el.querySelector('textarea');
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}
function saveEdit(el) {
  const v = el.querySelector('textarea').value.trim();
  const { kind, id, field } = el.dataset;
  if (field === 'title' && !v) return toast('標題唔可以留空');
  const sheetOpen = $('#modal').open && kind === 'item';
  const scroll = $('#modal .modal-body')?.scrollTop || 0;
  commit(() => {
    const obj = kind === 'day' ? findDay(id) : findItem(id).item;
    if (FIELD_IO[field]) FIELD_IO[field].set(obj, v);
    else if (v || field === 'ref') obj[field] = v; else delete obj[field];
  }, '已儲存');
  if (sheetOpen) { openItem(id); requestAnimationFrame(() => { const b = $('#modal .modal-body'); if (b) b.scrollTop = scroll; }); }
}
function cancelEdit(el) {
  const kind = el.dataset.kind, id = el.dataset.id;
  if (kind === 'item' && $('#modal').open) { const scroll = $('#modal .modal-body').scrollTop; openItem(id); requestAnimationFrame(() => { $('#modal .modal-body').scrollTop = scroll; }); }
  else render();
}

/* =========================================================
   相片：預設地點相＋你加嘅相，可以排次序、隱藏、刪除
   ========================================================= */
async function orderedPics(it, withHidden = false) {
  const commons = (await getItemPics(it)) || [];
  const all = [
    ...commons.map(p => ({ key: p.key, user: false, cap: p.title.replace(/^File:/, '').replace(/\.\w+$/, '') + '（Wikimedia Commons）' })),
    ...(it.photos || []).map(k => ({ key: k, user: true, cap: '你加嘅相' })),
  ];
  const hidden = new Set(it.picHidden || []);
  const deleted = new Set(it.picDeleted || []);
  const order = it.picOrder || [];
  const rank = k => { const i = order.indexOf(k); return i < 0 ? 1e6 : i; };
  return all.filter(p => !deleted.has(p.key)).map((p, i) => ({ ...p, n: i, hidden: hidden.has(p.key) })).filter(p => withHidden || !p.hidden).sort((a, b) => rank(a.key) - rank(b.key) || a.n - b.n);
}
/** 相片網址：手機有就用手機；你加嘅相如果手機冇，就由 GitHub 下載 */
async function photoURL(key) {
  const u = await blobURL(key);
  if (u || !key.startsWith('p_') || !navigator.onLine) return u;
  try {
    const r = await srvReq(`/api/photos/${key}.jpg`);
    if (!r.ok) return null;
    const b = await r.blob();
    await PhotoDB.put(key, b);
    await PhotoDB.put('up:' + key, 1);
    return blobURL(key);
  } catch { return null; }
}
function picsRow(it, big = false) {
  const n = (it.photos?.length || 0) + (hasPicConf(it) ? (big ? 3 : 2) : 0);
  return `<div class="pics ${big ? 'big' : ''} ${n ? '' : 'none'}" data-item="${it.id}" ${big ? 'data-big="1"' : ''}>${'<span class="pic skeleton"></span>'.repeat(Math.min(n, big ? 3 : 2))}
    <button type="button" class="pic add" data-act="add-photo" data-id="${it.id}" aria-label="加相">${icon('plus')}<span>加相</span></button></div>`;
}
async function hydratePics(root = document) {
  for (const box of root.querySelectorAll('.pics[data-item]')) {
    const it = findItem(box.dataset.item)?.item;
    if (!it) continue;
    const big = !!box.dataset.big;
    const arrange = big && ui.arrange === it.id;
    const list = await orderedPics(it, arrange);
    if (!box.isConnected) continue;
    const tiles = await Promise.all(list.map(async (p, i) => {
      const u = await photoURL(p.key);
      if (!u) return '';
      const k = esc(p.key);
      return `<div class="pic ${arrange ? 'arr' : ''} ${p.hidden ? 'hid' : ''}" data-key="${k}">
        <button type="button" class="picbtn" ${arrange ? '' : `data-act="view-pics" data-id="${it.id}" data-i="${i}"`}><img src="${u}" alt="" draggable="false"></button>
        ${arrange ? `<span class="picgrip" aria-hidden="true">⠿</span><span class="picctl">
          ${p.hidden
            ? `<button type="button" data-act="pic-unhide" data-id="${it.id}" data-key="${k}">👁 顯示</button>`
            : `<button type="button" data-act="pic-hide" data-id="${it.id}" data-key="${k}">🙈 隱藏</button>`}
          <button type="button" class="del" data-act="pic-del" data-id="${it.id}" data-key="${k}">🗑 刪除</button></span>` : ''}
      </div>`;
    }));
    if (!box.isConnected) continue;
    const shown = tiles.filter(Boolean).length;
    box.classList.toggle('none', !shown);
    box.classList.toggle('arranging', arrange);
    const ctl = big && (list.length > 0 || it.picHidden?.length)
      ? `<button type="button" class="pic arrange" data-act="pic-arrange" data-id="${it.id}">${arrange ? '✓<span>完成</span>' : '⇄<span>排次序／隱藏</span>'}</button>` : '';
    box.innerHTML = (arrange ? '<p class="hint arrhint">拖住相片移動次序（電腦用滑鼠拖；手機用手指按住拖）。</p>' : '') + tiles.join('')
      + `<button type="button" class="pic add" data-act="add-photo" data-id="${it.id}" aria-label="加相">${icon('plus')}<span>加相</span></button>` + ctl
      + (arrange && it.picDeleted?.length ? `<button type="button" class="pic arrange" data-act="pic-undelete" data-id="${it.id}">↺<span>還原刪除咗嘅預設相（${it.picDeleted.length}）</span></button>` : '');
    enableDrag(box, it.id, arrange);
  }
}

/* 拖放排序：滑鼠直接拖；手指喺「排次序」模式入面拖 */
let picDragJust = 0;
function enableDrag(box, id, arrange) {
  box.onpointerdown = e => {
    const tile = e.target.closest('.pic[data-key]');
    if (!tile || e.target.closest('.picctl') || e.button > 0) return;
    if (e.pointerType !== 'mouse' && !arrange) return; // 手機：要先撳「排次序」
    const x0 = e.clientX, y0 = e.clientY;
    let ghost = null;
    const move = ev => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        const r = tile.getBoundingClientRect();
        ghost = tile.cloneNode(true);
        ghost.className = 'pic ghost';
        Object.assign(ghost.style, { width: r.width + 'px', height: r.height + 'px', left: 0, top: 0 });
        ghost.dx = x0 - r.left; ghost.dy = y0 - r.top;
        document.body.appendChild(ghost);
        tile.classList.add('dragging');
      }
      ev.preventDefault();
      ghost.style.transform = `translate(${ev.clientX - ghost.dx}px, ${ev.clientY - ghost.dy}px) rotate(2deg)`;
      const over = [...box.querySelectorAll('.pic[data-key]')].find(t => {
        if (t === tile) return false;
        const r = t.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      });
      if (over) {
        const r = over.getBoundingClientRect();
        over.parentNode.insertBefore(tile, ev.clientX < r.left + r.width / 2 ? over : over.nextSibling);
      }
      // 近邊位自動捲動
      const br = box.getBoundingClientRect();
      if (ev.clientX > br.right - 30) box.scrollLeft += 12; else if (ev.clientX < br.left + 30) box.scrollLeft -= 12;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!ghost) return;
      ghost.remove();
      tile.classList.remove('dragging');
      picDragJust = Date.now();
      const keys = [...box.querySelectorAll('.pic[data-key]')].map(t => t.dataset.key);
      const it = findItem(id).item;
      if (JSON.stringify(keys) === JSON.stringify((it.picOrder || []).filter(k => keys.includes(k)))) return;
      commit(() => { const x = findItem(id).item; x.picOrder = [...keys, ...(x.picOrder || []).filter(k => !keys.includes(k))]; }, '已改相片次序');
      hydratePics($('#modal').open ? $('#modal') : document);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
}
// 拖完放手唔好當成「撳相」
document.addEventListener('click', e => { if (Date.now() - picDragJust < 300 && e.target.closest('.pics')) { e.stopPropagation(); e.preventDefault(); } }, true);

function setPicHidden(id, key, hide) {
  commit(() => {
    const x = findItem(id).item;
    const s = new Set(x.picHidden || []);
    hide ? s.add(key) : s.delete(key);
    if (s.size) x.picHidden = [...s]; else delete x.picHidden;
  }, hide ? '已隱藏（排次序入面可以再顯示）' : '已顯示');
  hydratePics($('#modal'));
}
function deletePic(id, key) {
  const user = key.startsWith('p_');
  if (!confirm(user ? '永久刪除呢張你加嘅相？' : '刪除呢張預設相？（佢唔會再出現；排次序入面可以還原）')) return false;
  commit(() => {
    const x = findItem(id).item;
    if (user) x.photos = (x.photos || []).filter(k => k !== key);
    else x.picDeleted = [...new Set([...(x.picDeleted || []), key])];
    if (x.picHidden) { x.picHidden = x.picHidden.filter(k => k !== key); if (!x.picHidden.length) delete x.picHidden; }
    if (x.picOrder) x.picOrder = x.picOrder.filter(k => k !== key);
  }, '已刪除相片');
  hydratePics($('#modal'));
  return true;
}

async function viewPics(id, start) {
  const it = findItem(id).item;
  const all = await orderedPics(it);
  if (!all.length) return;
  let i = Math.min(Math.max(0, start || 0), all.length - 1);
  const show = async form => {
    const p = all[i];
    form.querySelector('.viewer img').src = (await photoURL(p.key)) || '';
    form.querySelector('.viewer .cap').textContent = `${i + 1}／${all.length} · ${p.cap}`;
  };
  openModal({
    title: it.title,
    cls: 'viewer-modal',
    body: `<div class="viewer"><img alt="">
        ${all.length > 1 ? `<button type="button" class="nav l" aria-label="上一張">${icon('left')}</button><button type="button" class="nav r" aria-label="下一張">${icon('right')}</button>` : ''}
        <p class="cap"></p></div>
      <div class="row"><button type="button" class="btn" id="hidePic">🙈 隱藏</button><button type="button" class="btn danger" id="delPic">🗑 刪除</button><button type="button" class="btn" data-act="open" data-id="${id}">返去詳情</button></div>`,
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
      form.querySelector('#hidePic').onclick = () => { setPicHidden(id, all[i].key, true); openItem(id); };
      form.querySelector('#delPic').onclick = () => { if (deletePic(id, all[i].key)) openItem(id); };
      show(form);
    },
  });
}

/* =========================================================
   雲端同步：行程同你加嘅相存喺你自己嘅 VM 伺服器，
   所有裝置（同之後嘅新版 App）都用同一份資料
   ========================================================= */
const DEFAULT_SERVER = 'https://20-189-122-56.sslip.io';
const srvBase = () => (localStorage.getItem('srv-url') || (/github\.io$|^$/.test(location.hostname) || location.protocol === 'file:' ? DEFAULT_SERVER : location.origin)).replace(/\/+$/, '');
const srvKey = () => localStorage.getItem('srv-key') || '';
const ghOn = () => !!srvKey(); // 有密碼先可以上傳
const isDirty = () => localStorage.getItem('srv-dirty') === '1';
const getRev = () => +localStorage.getItem('srv-rev') || 0;
const sync = { busy: false, timer: null };

function srvReq(path, { method = 'GET', body, json = true } = {}) {
  const headers = {};
  if (srvKey()) headers['X-Trip-Key'] = srvKey();
  if (body !== undefined && json) headers['Content-Type'] = 'application/json';
  return fetch(srvBase() + path, { method, headers, body: body === undefined ? undefined : (json ? JSON.stringify(body) : body), cache: 'no-store' });
}
function syncStatus(msg) {
  localStorage.setItem('srv-status', msg);
  const el = $('#ghStatus');
  if (el) el.textContent = msg;
}
const hhmm = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** 用伺服器嘅版本（保留呢部機加過、但伺服器冇嘅相） */
function adoptRemote(d) {
  const remote = d.trip;
  undoStack.push(JSON.stringify(trip));
  let kept = 0;
  const byId = new Map(remote.days.flatMap(x => x.items).map(i => [i.id, i]));
  allItems().forEach(it => {
    const r2 = byId.get(it.id);
    const extra = (it.photos || []).filter(p => r2 && !(r2.photos || []).includes(p));
    if (extra.length) { r2.photos = [...(r2.photos || []), ...extra]; kept += extra.length; }
  });
  trip = remote;
  ensurePhrases();
  save();
  localStorage.setItem('srv-rev', d.rev);
  localStorage.removeItem('srv-dirty');
  if (!$('#modal').open) render();
  if (kept) { localStorage.setItem('srv-dirty', '1'); schedulePush(); }
}
/** 由伺服器攞最新資料 */
async function pullSync({ quiet = true } = {}) {
  if (!navigator.onLine || sync.busy) return;
  let r;
  try { r = await srvReq('/api/trip'); } catch { if (!quiet) syncStatus('連唔到伺服器（' + srvBase() + '）'); return; }
  if (r.status === 404) { if (ghOn()) return pushSync(); return; }
  if (r.status === 401) { if (!quiet) syncStatus('需要密碼先睇到資料'); return; }
  if (!r.ok) { if (!quiet) syncStatus('伺服器回應 ' + r.status); return; }
  const d = await r.json();
  if (!d?.trip?.days) return;
  if (d.rev === getRev()) {
    if (isDirty() && ghOn()) pushSync(); else if (!quiet) syncStatus(`✓ 已經係最新（${hhmm()}）`);
    return;
  }
  if (JSON.stringify(trip) === JSON.stringify(d.trip)) { localStorage.setItem('srv-rev', d.rev); localStorage.removeItem('srv-dirty'); return; }
  let take = true;
  if (isDirty()) {
    take = confirm(getRev()
      ? '伺服器有另一部機嘅新修改，呢部機亦有未上傳嘅修改。\n「確定」＝用伺服器嗰份\n「取消」＝用呢部機嘅版本覆蓋伺服器'
      : '伺服器已經有一份行程。\n「確定」＝用伺服器嗰份（建議）\n「取消」＝用呢部機嘅版本，上傳覆蓋伺服器');
  }
  if (take) {
    adoptRemote(d);
    syncStatus(`✓ 已下載最新內容（${hhmm()}）`);
    if (!quiet || getRev() > 1) toast('已同步其他裝置嘅修改');
  } else {
    localStorage.setItem('srv-rev', d.rev);
    localStorage.setItem('srv-dirty', '1');
    if (ghOn()) pushSync();
  }
}
/** 上傳你加嘅相（未上傳過嘅） */
async function uploadPhotos() {
  const ids = [...new Set(allItems().flatMap(i => i.photos || []))];
  for (const id of ids) {
    if (await PhotoDB.get('up:' + id).catch(() => null)) continue;
    const blob = await PhotoDB.get(id).catch(() => null);
    if (!blob) continue;
    const r = await srvReq(`/api/photos/${id}`, { method: 'PUT', body: blob, json: false });
    if (r.status === 401) throw new Error('密碼唔啱');
    if (!r.ok) throw new Error(`上傳相片失敗（${r.status}）`);
    await PhotoDB.put('up:' + id, 1);
  }
}
/** 將呢部機嘅修改上傳 */
async function pushSync() {
  if (!ghOn() || !navigator.onLine || sync.busy) return;
  sync.busy = true;
  syncStatus('上傳緊…');
  try {
    await uploadPhotos();
    const r = await srvReq('/api/trip', { method: 'PUT', body: { baseRev: getRev(), trip } });
    if (r.status === 409) {
      sync.busy = false;
      const cur = await r.json();
      localStorage.setItem('srv-rev', '-1'); // 強制比較
      return handleConflict(cur);
    }
    if (r.status === 401) throw new Error('密碼唔啱');
    if (!r.ok) throw new Error(`伺服器回應 ${r.status}`);
    const j = await r.json();
    localStorage.setItem('srv-rev', j.rev);
    localStorage.removeItem('srv-dirty');
    syncStatus(`✓ 已儲存到雲端（${hhmm()}）`);
  } catch (e) {
    syncStatus('同步失敗：' + e.message + '（上網後會再試）');
  } finally { sync.busy = false; }
}
function handleConflict(cur) {
  if (JSON.stringify(cur.trip) === JSON.stringify(trip)) { localStorage.setItem('srv-rev', cur.rev); localStorage.removeItem('srv-dirty'); return; }
  if (confirm('另一部機啱啱改咗行程。\n「確定」＝用另一部機嘅版本（你呢次嘅修改可以撳「還原」攞返）\n「取消」＝用呢部機嘅版本覆蓋')) {
    adoptRemote(cur);
    syncStatus(`✓ 已下載最新內容（${hhmm()}）`);
  } else {
    localStorage.setItem('srv-rev', cur.rev);
    pushSync();
  }
}
function schedulePush() {
  localStorage.setItem('srv-dirty', '1');
  clearTimeout(sync.timer);
  if (ghOn()) { syncStatus('有未上傳嘅修改…'); sync.timer = setTimeout(pushSync, 2000); }
  else if (!sync.warned) { sync.warned = true; syncStatus('修改只存喺呢部機：去「資訊 → ☁️ 雲端同步」輸入密碼'); setTimeout(() => toast('修改未上雲端：去「資訊」輸入同步密碼'), 2600); }
}
function syncCardHtml() {
  return `<section class="card" id="sync">
    <h2>☁️ 雲端同步（手機、電腦一齊用）</h2>
    <p class="muted" id="ghStatus">${esc(localStorage.getItem('srv-status') || (ghOn() ? '已設定' : '未輸入密碼：可以睇雲端資料，但修改唔會上傳'))}</p>
    <p class="muted">你喺 App 改嘅所有嘢同你加嘅相，會存喺你自己嘅伺服器（<code>${esc(srvBase())}</code>）。其他裝置打開 App 會自動攞到最新；之後出新版 App 亦會用返呢份資料。</p>
    <label class="field">同步密碼（每部要改資料嘅裝置輸入一次）
      <input id="srvKey" type="password" autocomplete="current-password" placeholder="VM 安裝時顯示嘅密碼" value="${esc(srvKey())}"></label>
    <details class="adv"><summary>伺服器網址</summary>
      <label class="field">網址<input id="srvUrl" inputmode="url" value="${esc(srvBase())}"></label>
    </details>
    <div class="row">
      <button class="chip dark" data-act="srv-save">儲存並同步</button>
      <button class="chip" data-act="srv-now">而家同步</button>
      ${srvKey() ? '<button class="chip danger" data-act="srv-forget">喺呢部機移除密碼</button>' : ''}
    </div>
  </section>`;
}


/* ---------- 地圖連結：iPhone 直接開 Google Maps App／Apple 地圖 ---------- */
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isGmaps = u => /^https:\/\/(www\.)?google\.[a-z.]+\/maps|^https:\/\/maps\.google\./.test(u);
const MAP_APPS = { gapp: 'Google Maps App', apple: 'Apple 地圖', web: '網頁版 Google Maps' };
function mapLink(url, app) {
  if (app === 'gapp') return url.replace(/^https:\/\//, 'comgooglemapsurl://');
  if (app !== 'apple') return url;
  const u = new URL(url);
  const q = k => u.searchParams.get(k) || '';
  const flg = { walking: 'w', driving: 'd', transit: 'r' }[q('travelmode')] || 'r';
  if (/\/maps\/search/.test(u.pathname)) return `https://maps.apple.com/?q=${enc(q('query'))}`;
  if (/\/maps\/dir\/?$/.test(u.pathname) && q('destination')) return `https://maps.apple.com/?${q('origin') ? `saddr=${enc(q('origin'))}&` : ''}daddr=${enc(q('destination'))}&dirflg=${flg}`;
  const stops = u.pathname.replace(/^\/maps\/dir\/?/, '').split('/').filter(Boolean).map(s => decodeURIComponent(s.replace(/\+/g, ' ')));
  if (/\/maps\/dir\//.test(u.pathname) && stops.length >= 2) return `https://maps.apple.com/?saddr=${enc(stops[0])}&daddr=${stops.slice(1).map(enc).join('+to:')}&dirflg=${flg}`;
  if (q('q') || q('query')) return `https://maps.apple.com/?q=${enc(q('q') || q('query'))}`;
  return url;
}
function openMap(url, app) {
  const target = mapLink(url, app);
  if (target.startsWith('comgooglemapsurl:')) location.href = target;
  else window.open(target, '_blank', 'noopener');
}
function chooseMapApp(url) {
  openModal({
    title: '用邊個 App 開地圖？',
    body: `<div class="bigbtns one">
        <button type="button" class="btn dark" data-app="gapp">Google Maps App（我有裝）</button>
        <button type="button" class="btn" data-app="apple">Apple 地圖（iPhone 內置）</button>
        <button type="button" class="btn" data-app="web">網頁版 Google Maps</button>
      </div>
      <label class="check"><input type="checkbox" id="mapRemember" checked> 記住我嘅選擇（可以喺「資訊」改）</label>
      <p class="hint">如果撳「Open in app」會去 App Store，即係部機未裝 Google Maps App：揀 Apple 地圖或者網頁版就得。</p>`,
    onOpen: form => form.querySelectorAll('[data-app]').forEach(b => {
      b.onclick = () => {
        if (form.querySelector('#mapRemember').checked) localStorage.setItem('map-app', b.dataset.app);
        closeModal();
        openMap(url, b.dataset.app);
      };
    }),
  });
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
  trip.updatedAt = Date.now();
  save();
  schedulePush();
  render();
  if (msg) toast(msg, true);
}
function undo() {
  if (!undoStack.length) return toast('冇嘢可以還原');
  trip = JSON.parse(undoStack.pop());
  save();
  schedulePush();
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
    items += renderItem(it, prevLoc, it.id === nextId);
    if (locOf(it)) prevLoc = locOf(it);
  });

  return `<nav class="daytabs">${tabs}</nav>
    ${renderCountdown(day)}
    <section class="dayhead">
      <p class="eyebrow">${p.m}月${p.d}日 星期${p.w} · ${esc(day.city || '')}</p>
      ${ef('day', day.id, 'title', '', day.title || '', { ph: '撳呢度加標題', h1: true })}
      ${ef('day', day.id, 'notes', '', day.notes || '', { ph: '撳呢度加當日備註' })}
      <div class="row">
        ${routeUrl ? `<a class="chip dark" href="${routeUrl}" target="_blank" rel="noopener">${icon('route')}全日路線</a>` : ''}
      </div>
      <div class="wxbar">
        <a class="chip" href="${ACCU_URL}" target="_blank" rel="noopener">${icon('cloud')}天氣</a>
        <span class="wx" id="wx">${wxText(day)}</span>
      </div>
    </section>
    <p class="legend"><b>開始</b> · 至 結束 · <span class="dur">需時</span></p>
    <div class="list">${items}</div>`;
}

function renderCountdown(day) {
  const first = trip.days[0]?.date;
  if (!first || day.id !== trip.days[0].id) return '';
  const n = daysBetween(todayStr(), first);
  return n > 0 ? `<div class="count"><b>${n}</b><span>日後出發</span></div>` : '';
}

function whenHtml(it) {
  if (!isHM(it.time)) return '<div class="when"></div>';
  const d = durOf(it);
  return `<div class="when" aria-label="${esc(it.time)} 開始${isHM(it.end) ? `，${esc(it.end)} 結束` : ''}">
    <b>${esc(it.time)}</b>
    ${isHM(it.end) ? `<span class="to">至 ${esc(it.end)}</span>` : ''}
    ${d ? `<span class="dur">${durStr(d)}</span>` : ''}
  </div>`;
}

function titleHtml(it) {
  // 電車項目嘅日文站名已經喺路線行顯示，唔使重複
  const dupRoute = TRANSPORT.has(it.type) && it.type !== 'flight' && (it.from || it.to);
  // 標題已經包含日文名（例如「早餐：まぐろのみやこ」）就唔再重複
  const jaBase = (it.titleJa || '').split(/[（(]/)[0].trim();
  const ja = it.titleJa && it.titleJa !== it.title && !dupRoute && !(jaBase && it.title.includes(jaBase)) ? it.titleJa : '';
  return `<h3 class="title">${esc(it.title)}${ja ? ` <span class="ja" lang="ja">${esc(ja)}</span>` : ''}</h3>`;
}
function routeHtml(it, big = false) {
  if (!TRANSPORT.has(it.type) || it.type === 'walk' || !(it.from || it.to)) return '';
  const side = (raw, zh) => `<b>${esc(nameOf(raw, zh))}</b>${raw && zh && raw !== zh ? ` <span lang="ja">${esc(raw)}</span>` : ''}`;
  return `<p class="route ${big ? 'big' : ''}">${side(it.from, it.fromZh)} → ${side(it.to, it.toZh)}</p>`;
}
/** Excel 原文：交通、備註 */
function xlRows(it) {
  return ['xTransport', 'xNote'].filter(k => it[k]).map(k => ef('item', it.id, k, k === 'xTransport' ? '交通' : '備註', it[k])).join('');
}
const chipHtml = l => `<a class="chip ${l.kind}" href="${esc(l.url)}" target="_blank" rel="noopener">${l.ic ? icon(l.ic) : ''}${esc(l.label)}</a>`;

function renderItem(it, prevLoc, isNext) {
  const isT = TRANSPORT.has(it.type);
  const isWalk = it.type === 'walk';
  const badges = [it.tabelog ? '食評' : '', it.menu ? '菜單' : '', it.timetable?.length ? '時刻表' : '', it.planB ? '後備方案' : '']
    .filter(Boolean).map(b => `<span class="badge">${b}</span>`).join('');
  const links = linksFor(it, prevLoc).slice(0, isWalk ? 2 : 3).map(chipHtml).join('');
  return `<article class="item t-${it.type} ${isWalk ? 'is-walk' : ''} ${it.status === 'done' ? 'done' : ''} ${isNext ? 'next' : ''}" id="item-${it.id}">
    ${whenHtml(it)}
    <div class="card">
      <div class="head" data-act="open" data-id="${it.id}">
        <span class="dot">${icon(it.type)}</span>
        <div class="grow">
          <p class="kind">${TYPES[it.type] || ''}${it.number && !isWalk ? ` · ${esc(it.number)}` : ''}${isNext ? ' <b class="nowtag">下一項</b>' : ''}${it.status === 'done' ? ' · ✓ 完成' : ''}</p>
          ${titleHtml(it)}
          ${routeHtml(it)}
        </div>
        ${isWalk ? '' : speakBtn(it.titleJa || (isT ? it.to : ''))}
      </div>
      ${xlRows(it)}
      ${picsRow(it)}
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
  const E = (field, label, opt) => ef('item', id, field, label, FIELD_IO[field] ? FIELD_IO[field].get(it) : it[field], opt);
  const when = [it.time, it.end].filter(Boolean).join(' 至 ') + (durOf(it) ? `（${durStr(durOf(it))}）` : '');
  const xl = `<div class="ef ro" data-act="edit" data-id="${id}"><span class="ef-k">時間</span><div class="ef-v">${esc(when) || '<i class="muted">撳呢度加時間</i>'}</div><span class="ef-pen">✎</span></div>
    ${E('title', '活動')}${E('xTransport', '交通')}${E('xNote', '備註')}${E('xUrl', '預約/地圖 URL')}`;
  const extraF = [['titleJa', '日文'], ['address', '地址'], ['hours', '營業時間'], ['ref', '訂位號碼'], ['url', '網站'], ['notes', '補充'], ['linksText', '其他連結'], ['planB', '後備方案']];
  const hasV = ([k]) => !!(FIELD_IO[k] ? FIELD_IO[k].get(it) : it[k]);
  const extra = extraF.filter(hasV).map(([k, l]) => E(k, l)).join('');
  const extraEmpty = extraF.filter(f => !hasV(f)).map(([k, l]) => E(k, l)).join('');
  const links = linksFor(it, prevLoc).map(chipHtml).join('');
  const tabelog = it.tabelog?.length ? `<section class="sec tb"><h4>${icon('star')}Tabelog 食評${E('tbText', '改', { compact: true })}</h4>
    ${it.tabelog.map(tb => `<div class="tbrow">
      <div class="score"><b>${esc(tb.rating)}</b><small>Tabelog</small></div>
      <div class="grow">
        <p class="tbname" lang="ja">${esc(tb.name)}</p>
        <p class="hint">${esc(tb.reviews)} 則評價 · 預算 ${esc(tb.budget)}</p>
        <ul>${(tb.summary || []).map(s => `<li>${linkify(s)}</li>`).join('')}</ul>
        ${tb.url ? `<a class="chip tabelog" href="${esc(normUrl(tb.url))}" target="_blank" rel="noopener">${icon('ext')}開 Tabelog 頁面</a>` : ''}
      </div></div>`).join('')}
    <p class="hint">評分及摘要係 2026 年 10 月整理，離線都睇到；最新評分以 Tabelog 為準。</p></section>` : '';
  const addMore = [!it.tabelog?.length && !isT ? E('tbText', '＋ Tabelog 食評', { compact: true }) : '', !it.menu && !isT ? E('menuText', '＋ 菜單', { compact: true }) : '', !it.timetable?.length && isT && it.type !== 'walk' ? E('ttText', '＋ 時刻表', { compact: true }) : ''].join('');
  const menu = it.menu ? `<section class="sec"><h4>${icon('food')}菜單及推介${it.menu.url ? ` <a href="${esc(normUrl(it.menu.url))}" target="_blank" rel="noopener">完整菜單</a>` : ''}${E('menuText', '改', { compact: true })}</h4>
    <ul class="menu">${(it.menu.items || []).map(m => `<li><div class="grow"><b>${m.star ? '⭐ ' : ''}${esc(m.name)}</b>${m.ja ? `<span class="mja" lang="ja">${esc(m.ja)}${speakBtn(m.ja, 'sm')}</span>` : ''}${m.desc ? `<small>${linkify(m.desc)}</small>` : ''}</div>${m.price ? `<span class="price">${esc(m.price)}</span>` : ''}</li>`).join('')}</ul>
    ${E('menuTips', '貼士')}${E('menuUrl', '完整菜單網址')}</section>` : '';
  const nextIdx = f.day.date === todayStr() && it.timetable ? it.timetable.findIndex(r => r.dep >= nowHM()) : -1;
  const tt = it.timetable?.length ? `<section class="sec"><h4>${icon('clock')}時刻表${it.timetableUrl ? ` <a href="${esc(normUrl(it.timetableUrl))}" target="_blank" rel="noopener">官方全日</a>` : ''}${E('ttText', '改', { compact: true })}</h4>
    <table class="tt"><tr><th>開出</th><th>到達</th><th>班次</th><th></th></tr>${it.timetable.map((r, i) => `<tr class="${r.note ? 'pick' : ''} ${i === nextIdx ? 'nextrow' : ''}"><td><b>${esc(r.dep)}</b></td><td>${esc(r.arr || '')}</td><td>${esc(r.name || '')}</td><td>${esc(r.note || '')}${i === nextIdx ? ' 下一班' : ''}</td></tr>`).join('')}</table>
    ${E('timetableNote', '備註')}${E('timetableUrl', '官方時刻表網址')}</section>` : '';
  const map = it.type === 'flight' ? '' : `<section class="sec"><h4>${icon('map')}地圖（離線可用）</h4>
    <div class="omap" data-map="${id}"><div class="leaf"></div>
      <button type="button" class="omap-full" data-act="map-full" aria-label="全螢幕">⤢</button></div>
    <p class="hint omap-info" id="omap-info-${id}">載入緊…</p>
    <div class="row">
      <button type="button" class="chip" data-act="locate" data-id="${id}">${icon('navigate')}我喺邊（GPS）</button>
      <button type="button" class="chip" data-act="pin-fix" data-id="${id}">${icon('edit')}修正位置</button>
    </div>
    <div class="pinpanel" id="pinpanel-${id}" hidden>
      <p class="hint">位置唔啱？揀一個方法：</p>
      <div class="row">
        <button type="button" class="chip dark" data-act="pin-tap" data-id="${id}">👆 喺地圖上撳</button>
        <button type="button" class="chip" data-act="pin-me" data-id="${id}">📍 用我而家位置</button>
        ${it.lat != null ? `<button type="button" class="chip" data-act="pin-reset" data-id="${id}">還原自動位置</button>` : ''}
      </div>
      <label class="pinpaste">或者貼上 Google Maps 座標（例如 35.66551, 139.77064）
        <span class="row"><input id="pinval-${id}" inputmode="decimal" placeholder="35.66551, 139.77064"><button type="button" class="chip dark" data-act="pin-paste" data-id="${id}">儲存</button></span></label>
      <p class="hint">Google Maps 攞座標：長按地點 → 落咗紅色大頭針 → 向上掃，撳座標就會複製。</p>
    </div></section>`;
  const taxiable = it.titleJa || it.address || (isT && it.to && it.type !== 'walk');
  openModal({
    title: `${it.time || ''} ${TYPES[it.type] || ''}`,
    cls: 'sheet',
    body: `<div class="sheet-title"><div class="grow">${titleHtml(it)}</div>${speakBtn(it.titleJa || (isT && it.type !== 'walk' ? it.to : ''))}</div>
      ${routeHtml(it, true)}
      <div class="efs">${xl}</div>
      <div class="row">${links}</div>
      ${picsRow(it, true)}
      ${map}
      ${extra ? `<div class="efs">${extra}</div>` : ''}
      ${extraEmpty ? `<details class="adv addinfo"><summary>＋ 加其他資料（地址、連結、後備方案…）</summary><div class="efs">${extraEmpty}</div></details>` : ''}
      ${tabelog}${menu}${tt}
      ${addMore ? `<div class="row addmore">${addMore}</div>` : ''}
      <div class="actions">
        ${it.status === 'done' ? `<button type="button" class="btn" data-act="undone" data-id="${id}">${icon('reset')}未完成</button>` : `<button type="button" class="btn dark" data-act="done" data-id="${id}">${icon('check')}完成</button>`}
        ${isHM(it.time) ? `<button type="button" class="btn" data-act="shift" data-id="${id}">${icon('clock')}延遲</button>` : ''}
        ${taxiable ? `<button type="button" class="btn" data-act="taxi" data-id="${id}">${icon('car')}俾司機睇</button>` : ''}
        <button type="button" class="btn" data-act="edit" data-id="${id}">${icon('edit')}修改</button>
        <button type="button" class="btn danger" data-act="del" data-id="${id}">${icon('trash')}刪除</button>
      </div>`,
    onOpen: form => { hydratePics(form); drawItemMap(id); },
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
/* ---------- 日語（可以自己加、改、刪；漢字上面有平假名，下面有羅馬拼音） ---------- */
function ensurePhrases() {
  if (Array.isArray(trip.phrases)) return false;
  trip.phrases = PHRASES.map((g, gi) => ({ id: 'g' + gi, cat: g.cat, items: g.items.map(([ja, ro, zh], i) => ({ id: `q${gi}_${i}`, ja, ro, zh })) }));
  return true;
}
const rdCache = (() => { try { return JSON.parse(localStorage.getItem('readings-cache') || '{}'); } catch { return {}; } })();
const readingOf = ja => READINGS[ja] || rdCache[ja] || null;
const rdPending = new Set();
/** 冇預先準備嘅讀音：上網時問伺服器（pykakasi） */
async function fetchReading(text) {
  const r = await srvReq('/api/reading', { method: 'POST', body: { text } });
  if (!r.ok) throw new Error(r.status === 501 ? '伺服器未裝自動讀音' : `伺服器回應 ${r.status}`);
  const j = await r.json();
  return { ruby: j.ruby, ro: j.romaji, kana: j.kana };
}
async function fillReadings(texts) {
  const todo = texts.filter(t => t && !readingOf(t) && !rdPending.has(t) && /[぀-ヿ㐀-鿿]/.test(t));
  if (!todo.length || !navigator.onLine) return;
  todo.forEach(t => rdPending.add(t));
  let got = 0;
  for (const t of todo) {
    try { rdCache[t] = await fetchReading(t); got++; } catch { break; }
  }
  if (got) { localStorage.setItem('readings-cache', JSON.stringify(rdCache)); if (ui.tab === 'phrases' && !$('#modal').open) render(); }
}
/** 漢字上面加平假名 */
function rubyHtml(ja, ph = {}) {
  if (ph.kana) return `<span class="kana" lang="ja">${esc(ph.kana)}</span>${esc(ja)}`;
  const segs = ph.ruby || readingOf(ja)?.ruby;
  if (!segs) return esc(ja);
  return segs.map(([t, r]) => r ? `<ruby>${esc(t)}<rp>(</rp><rt>${esc(r)}</rt><rp>)</rp></ruby>` : esc(t)).join('');
}
const romajiOf = (ja, ph = {}) => ph.ro || readingOf(ja)?.ro || '';

function renderPhrases() {
  ensurePhrases();
  const edit = ui.phrEdit;
  const places = [...new Map(allItems().filter(i => i.titleJa && i.type !== 'walk').map(i => [i.titleJa, i])).values()];
  const row = (ja, zh, ph = {}, gid = '') => `<div class="phrase-wrap">
    <button class="phrase" data-act="speak" data-text="${esc(ja)}">
      <div class="grow"><b lang="ja">${rubyHtml(ja, ph)}</b>${romajiOf(ja, ph) ? `<span class="ro">${esc(romajiOf(ja, ph))}</span>` : ''}<span class="zh">${esc(zh)}</span></div>${icon('sound')}</button>
    ${edit && ph.id ? `<span class="phr-ctl"><button class="chip" data-act="phr-edit" data-id="${ph.id}" data-g="${gid}">✎ 改</button><button class="chip danger" data-act="phr-del" data-id="${ph.id}" data-g="${gid}">🗑</button></span>` : ''}</div>`;
  setTimeout(() => fillReadings([...trip.phrases.flatMap(g => g.items.filter(p => !p.kana && !p.ruby).map(p => p.ja)), ...places.map(i => i.titleJa)]), 50);
  return `<section class="pagehead"><h1>日語</h1>
      <p class="muted">撳任何一句就會讀出嚟（用手機內置日文聲，冇網都得）。漢字上面係平假名，下面係羅馬拼音。</p>
      <div class="row"><button class="chip ${edit ? 'dark' : ''}" data-act="phr-mode">${edit ? '✓ 完成' : '✎ 加／改句子'}</button></div></section>
    ${trip.phrases.map(g => `<section class="card phr"><h2>${edit ? `<span class="grow">${esc(g.cat)}</span><button class="chip" data-act="phr-cat" data-g="${g.id}">✎</button><button class="chip danger" data-act="phr-cat-del" data-g="${g.id}">🗑</button>` : esc(g.cat)}</h2>
      ${g.items.map(p => row(p.ja, p.zh, p, g.id)).join('')}
      ${edit ? `<button class="chip accent addphr" data-act="phr-add" data-g="${g.id}">＋ 加句子</button>` : ''}</section>`).join('')}
    ${edit ? `<button class="btn" data-act="phr-cat-add">＋ 新分類</button>` : ''}
    <section class="card phr"><h2>地點讀音</h2><p class="hint">地點名喺行程項目入面改（日文名）。</p>${places.map(i => row(i.titleJa, i.title)).join('')}</section>`;
}

function phraseForm(gid, pid) {
  const g = trip.phrases.find(x => x.id === gid);
  const p = pid ? g.items.find(x => x.id === pid) : { ja: '', zh: '', ro: '' };
  const rd = p.ja ? readingOf(p.ja) : null;
  let auto = { ruby: p.ruby || rd?.ruby || null, kana: p.kana || (p.ruby || rd?.ruby ? (p.ruby || rd.ruby).map(([t, r]) => r || t).join('') : ''), ro: p.ro || rd?.ro || '' };
  const autoKana = auto.kana;
  openModal({
    title: pid ? '改句子' : `加句子（${g.cat}）`,
    body: `<label>日文<textarea name="ja" rows="2" lang="ja" required>${esc(p.ja)}</textarea></label>
      <label>中文意思<input name="zh" value="${esc(p.zh)}"></label>
      <div class="row"><button type="button" class="chip dark" id="autoRd">↻ 自動產生讀音（要上網）</button></div>
      <p class="phr-preview" lang="ja" id="rdPrev"></p>
      <label>平假名讀音（可以自己改）<input name="kana" lang="ja" value="${esc(auto.kana)}"></label>
      <label>羅馬拼音（可以自己改）<input name="ro" value="${esc(auto.ro)}"></label>
      <p class="hint">儲存時冇讀音嘅話，上網時會自動補上。</p>`,
    onOpen: form => {
      const prev = () => { form.querySelector('#rdPrev').innerHTML = rubyHtml(form.ja.value.trim(), form.kana.value !== auto.kana ? { kana: form.kana.value } : { ruby: auto.ruby }); };
      const gen = async () => {
        const ja = form.ja.value.trim();
        if (!ja) return;
        const b = form.querySelector('#autoRd'); b.textContent = '產生緊…';
        try {
          const r = READINGS[ja] || await fetchReading(ja);
          auto = { ruby: r.ruby || null, kana: r.kana || (r.ruby || []).map(([t, x]) => x || t).join(''), ro: r.ro };
          form.kana.value = auto.kana; form.ro.value = auto.ro;
        } catch (e) { toast('產生唔到讀音：' + e.message); }
        b.textContent = '↻ 自動產生讀音（要上網）';
        prev();
      };
      form.querySelector('#autoRd').onclick = gen;
      form.ja.addEventListener('change', gen);
      form.kana.addEventListener('input', prev);
      prev();
    },
    onSubmit: fd => {
      const ja = fd.get('ja').toString().trim();
      if (!ja) return false;
      const kana = fd.get('kana').toString().trim(), ro = fd.get('ro').toString().trim();
      const np = { id: p.id || 'q' + uid(), ja, zh: fd.get('zh').toString().trim() };
      if (ro) np.ro = ro;
      if (kana && kana !== auto.kana) np.kana = kana;          // 自己改過讀音
      else if (auto.ruby && !READINGS[ja]) np.ruby = auto.ruby; // 自動讀音一齊存，其他裝置唔使再問
      commit(() => {
        const gg = trip.phrases.find(x => x.id === gid);
        const i = gg.items.findIndex(x => x.id === np.id);
        if (i >= 0) gg.items[i] = np; else gg.items.push(np);
      }, pid ? '已修改' : '已加入');
    },
  });
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
    <h2>📴 離線資料</h2>
    <p class="muted" id="picStatus">檢查緊相片…</p>
    <p class="muted" id="mapStatus"></p>
    <div class="row"><button class="chip dark" data-act="offline-all">${icon('download')}下載離線資料（相片＋地圖＋步行路線）</button></div>
    <ul class="plain">
      <li>上網時打開一次，再「加到主畫面」—— 之後冇網都開到。</li>
      <li>每項「詳情」入面有<b>離線地圖</b>：上一站 → 呢度嘅位置同步行路線；撳「顯示我嘅位置」用 GPS（冇網都得）睇距離同方向。</li>
      <li>餐廳嘅 Tabelog 評分、菜單、營業時間已經存喺 App 入面，離線都睇到。外部網站本身（Tabelog、京成等）要上網先開到。</li>
      <li>Google Maps 預先下載「東京」離線地圖，冇網都可以搜尋同駕車導航。</li>
      <li>喺「日語」頁試一次讀音。冇聲：iPhone 設定 → 輔助使用 → 朗讀內容 → 聲音 → 日文。</li>
    </ul>
  </section>
  <section class="card">
    <h2>${icon('table')} Excel</h2>
    <p class="muted">格式同你嘅 Itinerary 試算表一樣（日期、開始、結束、時長、活動、備註、交通、預約/地圖 URL）。喺 Excel 改完再匯入，App 會按「活動」或「開始時間」配對，保留相片、菜單、Tabelog 等資料。</p>
    <div class="row">
      <button class="chip dark" data-act="xlsx-export">${icon('download')}匯出 Excel</button>
      <button class="chip" data-act="xlsx-import">${icon('table')}匯入 Excel</button>
    </div>
  </section>
  ${syncCardHtml()}
  <section class="card">
    <h2>🗺 地圖 App</h2>
    <p class="muted">iPhone 撳地圖連結時用：${esc(MAP_APPS[localStorage.getItem('map-app')] || '每次問我')}</p>
    <div class="row">${Object.entries(MAP_APPS).map(([k, v]) => `<button class="chip ${localStorage.getItem('map-app') === k ? 'dark' : ''}" data-act="map-app" data-id="${k}">${v}</button>`).join('')}
      <button class="chip" data-act="map-app" data-id="">每次問我</button></div>
  </section>
  <section class="card">
    <h2>💾 備份檔</h2>
    <p class="muted">冇設定 GitHub 同步嘅時候，可以用備份檔搬資料：「匯出備份」→ AirDrop／WhatsApp／電郵傳去另一部機 →「匯入備份」。</p>
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
  const ta = (name, label, rows = 2) => `<label>${label}<textarea name="${name}" rows="${rows}">${esc(it[name] || '')}</textarea></label>`;
  openModal({
    title: '修改（同 Excel 欄位一樣）',
    body: `<div class="grid2">
        <label>開始<input type="time" name="time" value="${esc(it.time || '')}"></label>
        <label>結束<input type="time" name="end" value="${esc(it.end || '')}"></label>
      </div>
      ${f('title', '活動', 'required')}
      ${ta('xNote', '備註')}
      ${ta('xTransport', '交通')}
      ${ta('xUrl', '預約/地圖 URL')}
      <details class="adv"><summary>其他資料</summary>
        ${f('titleJa', '日文名稱', 'lang="ja"')}
        ${TRANSPORT.has(it.type) ? f('number', '航班／班次') : ''}
        ${f('ref', '訂位／確認號碼')}
        ${f('address', '地址')}
        ${f('url', '網站／訂單連結', 'inputmode="url"')}
        ${ta('notes', '補充', 3)}
      </details>
      ${isHM(it.end) ? `<label class="check"><input type="checkbox" name="push" checked> 改結束時間時，之後嘅行程跟住移</label>` : ''}`,
    onSubmit: fd => commit(() => {
      const cur = findItem(id);
      for (const k of ['time', 'end', 'title', 'xNote', 'xTransport', 'xUrl', 'titleJa', 'number', 'ref', 'address', 'url', 'notes']) {
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
      <div class="big" lang="ja">${rubyHtml(big)}</div>
      ${romajiOf(big) ? `<p class="muted">${esc(romajiOf(big))}</p>` : ''}
      ${!isT && it.address ? `<div class="addr" lang="ja">${esc(it.address)}</div>` : ''}
      <div class="row center">
        <button type="button" class="btn dark" data-act="speak" data-text="${esc(`${big}までお願いします`)}">${icon('sound')}讀出</button>
        <a class="btn" href="${gmapDir('', isT ? it.to : (it.place || it.address))}" target="_blank" rel="noopener">${icon('route')}導航</a>
      </div>
    </div>`,
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
    const photos = Object.entries(data.photos || {});
    const choose = mode => new Promise(res => openModal({
      title: '匯入備份',
      body: `<p>備份有 ${t.days.length} 日行程、${photos.length} 張你加嘅相。</p>
        <div class="bigbtns one">
          <button type="button" class="btn dark" data-mode="photos">只加入相片（保留呢部機嘅行程）</button>
          <button type="button" class="btn" data-mode="all">取代整個行程（連相片）</button>
          <button type="button" class="btn ghost" data-mode="">取消</button>
        </div>`,
      onOpen: form => form.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => { closeModal(); res(b.dataset.mode); }; }),
    }));
    const mode = await choose();
    if (!mode) return;
    for (const [id, url] of photos) await PhotoDB.put(id, await (await fetch(url)).blob());
    if (mode === 'all') return commit(() => { trip = t; ui.day = null; }, '已匯入整個行程');
    // 只合併相片：按項目 id（或者同日同活動名）加入相片
    const src = t.days.flatMap(d => d.items.map(i => [d.date, i]));
    let added = 0;
    commit(() => {
      trip.days.forEach(d => d.items.forEach(it => {
        const m = src.find(([, x]) => x.id === it.id) || src.find(([dd, x]) => dd === d.date && x.title === it.title);
        const ps = (m?.[1].photos || []).filter(p => !(it.photos || []).includes(p));
        if (ps.length) { it.photos = [...(it.photos || []), ...ps]; added += ps.length; }
      }));
    }, `已加入相片`);
    toast(`已加入 ${added} 張相`);
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
  ef: (_, el) => startEdit(el),
  'ef-save': (_, el) => saveEdit(el.closest('.ef')),
  'ef-cancel': (_, el) => cancelEdit(el.closest('.ef')),
  'pic-hide': (id, el) => setPicHidden(id, el.dataset.key, true),
  'pic-unhide': (id, el) => setPicHidden(id, el.dataset.key, false),
  'pic-del': (id, el) => deletePic(id, el.dataset.key),
  'pic-undelete': id => { commit(() => { delete findItem(id).item.picDeleted; }, '已還原預設相'); hydratePics($('#modal')); },
  'pic-arrange': id => { ui.arrange = ui.arrange === id ? null : id; hydratePics($('#modal')).then(() => $('#modal .pics.big')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })); },
  'map-app': id => { if (id) localStorage.setItem('map-app', id); else localStorage.removeItem('map-app'); render(); },
  'phr-mode': () => { ui.phrEdit = !ui.phrEdit; render(); },
  'phr-add': (_, el) => phraseForm(el.dataset.g),
  'phr-edit': (id, el) => phraseForm(el.dataset.g, id),
  'phr-del': (id, el) => { if (!confirm('刪除呢句？')) return; commit(() => { const g = trip.phrases.find(x => x.id === el.dataset.g); g.items = g.items.filter(x => x.id !== id); }, '已刪除'); },
  'phr-cat': (_, el) => { const g = trip.phrases.find(x => x.id === el.dataset.g); const n = prompt('分類名稱', g.cat); if (n && n.trim()) commit(() => { trip.phrases.find(x => x.id === el.dataset.g).cat = n.trim(); }); },
  'phr-cat-del': (_, el) => { const g = trip.phrases.find(x => x.id === el.dataset.g); if (!confirm(`刪除「${g.cat}」分類同入面 ${g.items.length} 句？`)) return; commit(() => { trip.phrases = trip.phrases.filter(x => x.id !== el.dataset.g); }, '已刪除'); },
  'phr-cat-add': () => { const n = prompt('新分類名稱（例如：購物）'); if (n && n.trim()) commit(() => { trip.phrases.push({ id: 'g' + uid(), cat: n.trim(), items: [] }); }, '已加分類'); },
  'srv-save': async () => {
    const key = ($('#srvKey')?.value || '').trim(), url = ($('#srvUrl')?.value || '').trim().replace(/\/+$/, '');
    if (key) localStorage.setItem('srv-key', key); else localStorage.removeItem('srv-key');
    if (url && url !== srvBase()) localStorage.setItem('srv-url', url);
    syncStatus('檢查緊…');
    try {
      const p = await (await srvReq('/api/ping')).json();
      if (key && !p.edit) return syncStatus('✗ 密碼唔啱');
    } catch { return syncStatus('✗ 連唔到伺服器：' + srvBase()); }
    await pullSync({ quiet: false });
    if (isDirty()) await pushSync();
    if (ui.tab === 'info' && !$('#modal').open) render();
  },
  'srv-now': () => { syncStatus('同步緊…'); (isDirty() && ghOn() ? pushSync() : pullSync({ quiet: false })); },
  'srv-forget': () => { if (!confirm('喺呢部機移除同步密碼？')) return; localStorage.removeItem('srv-key'); localStorage.removeItem('srv-status'); render(); },
  copy: (_, el) => navigator.clipboard?.writeText(el.dataset.val).then(() => toast('已複製'), () => toast('複製唔到')),
  prefetch: () => { toast('下載緊相片…'); prefetchAll().then(() => toast('相片已存好，離線可睇')); },
  'offline-all': () => downloadOffline(),
  'xlsx-export': () => exportExcel(),
  'xlsx-import': () => $('#xlsxInput').click(),
  locate: id => startLocate(id),
  'map-full': (_, el) => { const box = el.closest('.omap'); box.classList.toggle('full'); el.textContent = box.classList.contains('full') ? '✕' : '⤢'; setTimeout(() => mapState.map?.invalidateSize(), 60); },
  'pin-fix': id => { const p = $('#pinpanel-' + id); if (p) p.hidden = !p.hidden; },
  'pin-tap': id => { mapState.pin = true; toast('撳地圖上正確嘅位置'); drawItemMap(id); },
  'pin-me': id => {
    if (!navigator.geolocation) return toast('呢部機唔支援定位');
    navigator.geolocation.getCurrentPosition(p => setItemLatLon(id, p.coords.latitude, p.coords.longitude), () => toast('攞唔到位置'), { enableHighAccuracy: true, timeout: 20000 });
  },
  'pin-paste': id => { const v = parseLatLon($('#pinval-' + id)?.value); if (!v) return toast('格式唔啱，例如 35.66551, 139.77064'); setItemLatLon(id, v.lat, v.lon); },
  'pin-reset': id => setItemLatLon(id, null, null),
  export: exportTrip,
  import: () => $('#importInput').click(),
  reset: () => { if (confirm('重設為原始行程？你改過嘅內容會被取代（可以還原）。')) commit(() => { trip = freshSeed(); ui.day = null; }, '已重設'); },
};

document.addEventListener('click', e => {
  // 資料入面嘅連結照常打開；改緊嘅輸入框唔理
  const link = e.target.closest('a[href]');
  if (link && !link.dataset.act) {
    if (isGmaps(link.href) && isIOS()) {
      e.preventDefault();
      const app = localStorage.getItem('map-app');
      if (app) openMap(link.href, app); else chooseMapApp(link.href);
    }
    return;
  }
  if (e.target.closest('.ef.editing textarea, .ef.editing .hint')) return;
  const el = e.target.closest('[data-act]');
  if (!el || !actions[el.dataset.act]) return;
  e.preventDefault();
  e.stopPropagation();
  actions[el.dataset.act](el.dataset.id, el, e);
});

document.addEventListener('keydown', e => {
  const ta = e.target.closest?.('.ef.editing textarea');
  if (!ta) return;
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(ta.closest('.ef')); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(ta.closest('.ef')); }
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
$('#xlsxInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importExcel(f); });
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
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
setInterval(() => { if (ui.tab === 'plan' && !$('#modal').open) render(); }, 60_000);

/* ---------- boot ---------- */
if ((trip.seedVersion || 0) < SEED.seedVersion) {
  if (confirm('有新版行程，要唔要載入？（你改過嘅內容會被取代）')) trip = freshSeed();
  else trip.seedVersion = SEED.seedVersion;
}
// 將新版種子資料嘅定位欄位加入已儲存行程（唔會改你嘅內容）
(() => {
  const seedItems = new Map(SEED.days.flatMap(d => d.items).map(i => [i.id, i]));
  let changed = false;
  trip.days.forEach(d => d.items.forEach(it => {
    const s = seedItems.get(it.id);
    if (!s) return;
    for (const k of ['geo', 'place', 'mapQuery']) if (s[k] && it[k] == null) { it[k] = s[k]; changed = true; }
  }));
  if (changed) save();
})();
ensurePhrases();
$('#tripName').textContent = trip.name || '東京';
save();
updateNet();
render();
loadWeather();
// 清走舊版下載嘅 CARTO 水印圖塊（一次）
if (!localStorage.getItem('trip-tiles-cleaned')) {
  PhotoDB.run('readwrite', st => { const req = st.openCursor(); req.onsuccess = () => { const c = req.result; if (!c) return; if (String(c.key).startsWith('tile:')) c.delete(); c.continue(); }; return null; })
    .then(() => localStorage.setItem('trip-tiles-cleaned', '1')).catch(() => {});
}
window.addEventListener('online', loadWeather);
// 雲端同步：開 App、返回 App、重新上網都會攞最新
let lastPull = 0;
const autoPull = () => { if (Date.now() - lastPull < 60_000) return; lastPull = Date.now(); pullSync(); };
autoPull();
window.addEventListener('online', () => { lastPull = 0; autoPull(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoPull(); });
setTimeout(() => prefetchAll().then(() => { if (ui.tab !== 'plan' || $('#modal').open) return; render(); }), 1200);
