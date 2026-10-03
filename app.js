'use strict';

/* =========================================================
   Trip Planner — offline-first itinerary for HK & Japan
   Data lives in localStorage (itinerary) + IndexedDB (photos).
   ========================================================= */

const STORE_KEY = 'trip-planner:v1';

const TYPES = {
  flight: { icon: '✈️', label: 'Flight' },
  train:  { icon: '🚆', label: 'Train / Metro' },
  bus:    { icon: '🚌', label: 'Bus' },
  ferry:  { icon: '⛴️', label: 'Ferry' },
  hotel:  { icon: '🏨', label: 'Hotel' },
  food:   { icon: '🍜', label: 'Food' },
  sight:  { icon: '📍', label: 'Sightseeing' },
  shop:   { icon: '🛍️', label: 'Shopping' },
  other:  { icon: '📝', label: 'Other' },
};
const TRANSPORT = new Set(['flight', 'train', 'bus', 'ferry']);
const COUNTRIES = { HK: 'Hong Kong', JP: 'Japan' };
const TAXI_PHRASE = {
  HK: '唔該，我想去呢度。<br><span class="small muted">請帶我去這裡 · Please take me here</span>',
  JP: 'ここへ行ってください。<br><span class="small muted">Please take me here</span>',
  '': 'Please take me here',
};

/* ---------- small helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const enc = encodeURIComponent;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const short = s => (s || '').split(/[,(]/)[0].trim();

function fmtDate(s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!s) return 'No date';
  const d = new Date(s + 'T00:00');
  return isNaN(d) ? s : d.toLocaleDateString(undefined, opts);
}
function addDays(s, n) {
  const d = s ? new Date(s + 'T00:00') : new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
}
function shiftTime(t, mins) {
  if (!/^\d{1,2}:\d{2}$/.test(t || '')) return t;
  const [h, m] = t.split(':').map(Number);
  const x = Math.max(0, Math.min(23 * 60 + 59, h * 60 + m + mins));
  return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`;
}
function normUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u;
}

/* ---------- link builders ---------- */
const gmapSearch = q => `https://www.google.com/maps/search/?api=1&query=${enc(q)}`;
const gmapDir = (from, to, mode = 'transit') =>
  `https://www.google.com/maps/dir/?api=1${from ? `&origin=${enc(from)}` : ''}&destination=${enc(to)}&travelmode=${mode}`;
const gsearch = q => `https://www.google.com/search?q=${enc(q)}`;
const gimages = q => `https://www.google.com/search?tbm=isch&q=${enc(q)}`;

/** Where an item "ends up" — used as the origin for the next item's route. */
function locOf(it) {
  if (!it) return '';
  if (TRANSPORT.has(it.type)) return it.to || '';
  return it.address || it.place || '';
}
function countryOf(it, day) { return it.country || (day && day.country) || ''; }

function stationMapQuery(name, country) {
  if (country === 'JP') return `${name} 構内図`;
  if (country === 'HK') return `${name} station exit map`;
  return `${name} station map`;
}

function linksFor(it, prevLoc, country) {
  const L = [];
  const add = (label, url, cls = '') => {
    if (label.length > 26) label = label.slice(0, 25).trim() + '…';
    if (url) L.push({ label, url, cls });
  };
  const t = it.type;
  if (it.url) add(t === 'hotel' ? 'Hotel site' : t === 'flight' ? 'Booking' : 'Website', normUrl(it.url), 'primary');

  if (t === 'flight') {
    const no = (it.number || '').replace(/\s+/g, '');
    if (no) {
      add('Flight status', `https://www.flightradar24.com/data/flights/${enc(no.toLowerCase())}`);
      add('Google status', gsearch(`${it.number} flight status`));
    }
    if (it.from) add(`Go to ${short(it.from)}`, gmapDir('', it.from));
    if (it.to) add(`${short(it.to)} terminal map`, gimages(`${it.to} airport terminal map`));
  } else if (TRANSPORT.has(t)) {
    const from = it.from || prevLoc;
    if (it.to) add('Route & times', gmapDir(from, it.to));
    if (it.from) add(`Get to ${short(it.from)}`, gmapDir('', it.from));
    if (t === 'train' || t === 'bus') {
      if (it.from) add(`${short(it.from)} map`, gimages(stationMapQuery(it.from, country)));
      if (it.to) add(`${short(it.to)} map`, gimages(stationMapQuery(it.to, country)));
    }
    if (it.number) add('Timetable', gsearch(`${it.number} ${it.from || ''} ${it.to || ''} timetable`));
    if (t === 'train' && country === 'HK') add('MTR planner', 'https://www.mtr.com.hk/en/customer/jp/index.php');
    if (t === 'train' && country === 'JP') add('Jorudan', 'https://world.jorudan.co.jp/mln/en/');
  } else {
    const q = locOf(it) || it.title;
    add('Map', gmapSearch(it.place && it.address ? `${it.place} ${it.address}` : q));
    if (prevLoc && prevLoc !== q) add('Route from previous', gmapDir(prevLoc, q));
    add('Route from here', gmapDir('', q));
    if (t === 'food') {
      const name = it.place || it.title;
      if (country === 'JP') add('Tabelog', gsearch(`site:tabelog.com ${name}`));
      if (country === 'HK') add('OpenRice', gsearch(`site:openrice.com ${name}`));
      add('Reviews', gsearch(`${name} ${it.address || ''} reviews`));
    } else {
      add('Food nearby', gmapSearch(`restaurants near ${q}`));
    }
  }
  (it.links || []).forEach(l => add(l.label || 'Link', normUrl(l.url), 'plain'));
  return L;
}

/* ---------- photos (IndexedDB) ---------- */
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
};
const photoURLs = new Map();

async function hydratePhotos() {
  for (const img of document.querySelectorAll('img[data-photo]')) {
    const id = img.dataset.photo;
    if (!photoURLs.has(id)) {
      const blob = await PhotoDB.get(id).catch(() => null);
      if (!blob) { img.alt = 'missing'; continue; }
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

/* ---------- state ---------- */
let trip = load() || sampleTrip();
const ui = { tab: 'plan', open: new Set(), collapsed: new Set() };
const undoStack = [];

function load() {
  try { const s = localStorage.getItem(STORE_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(trip));
  } catch {
    toast('⚠️ Could not save — storage may be full');
  }
}
function normalize() {
  trip.days = trip.days || [];
  trip.ideas = trip.ideas || [];
  trip.days.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
}
/** Every change goes through here so it can be undone. */
function commit(fn, msg) {
  undoStack.push(JSON.stringify(trip));
  if (undoStack.length > 50) undoStack.shift();
  fn();
  normalize();
  save();
  render();
  if (msg) toast(msg, true);
}
function undo() {
  if (!undoStack.length) return toast('Nothing to undo');
  trip = JSON.parse(undoStack.pop());
  save();
  render();
  toast('Undone');
}

/** Locate an item anywhere (days or ideas). */
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

/* ---------- rendering ---------- */
function render() {
  normalize();
  $('#tripName').textContent = trip.name || 'My trip';
  const first = trip.days[0]?.date, last = trip.days[trip.days.length - 1]?.date;
  $('#tripSub').textContent = first ? `${fmtDate(first)} – ${fmtDate(last)} · ${trip.days.length} days` : '';
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.id === ui.tab));
  const view = $('#view');
  view.innerHTML = ({ plan: renderPlan, bookings: renderBookings, ideas: renderIdeas, info: renderInfo }[ui.tab])();
  hydratePhotos();
  if (ui.tab === 'info') showStorageInfo();
}

function renderPlan() {
  const today = todayStr();
  let html = '';
  const todayDay = trip.days.find(d => d.date === today);
  if (todayDay) {
    html += `<div class="banner"><div class="grow"><b>Today: Day ${trip.days.indexOf(todayDay) + 1}</b> · ${esc(todayDay.city || '')}</div>
      <button class="btn" data-act="jump-today">Jump ↓</button></div>`;
  }
  if (!trip.days.length) html += `<div class="card empty">No days yet. Add your first day below, or import a backup in <b>Info</b>.</div>`;

  let prevLoc = '';
  trip.days.forEach((day, di) => {
    html += renderDay(day, di, today, prevLoc);
    const locs = day.items.filter(i => i.status !== 'skipped').map(locOf).filter(Boolean);
    if (locs.length) prevLoc = locs[locs.length - 1];
  });
  html += `<button class="btn wide" data-act="add-day">＋ Add day</button>`;
  return html;
}

function renderDay(day, di, today, prevLoc) {
  const isToday = day.date === today;
  const collapsed = ui.collapsed.has(day.id);
  const active = day.items.filter(i => i.status !== 'skipped');
  const locs = active.map(locOf).filter(Boolean).slice(0, 10);
  const routeUrl = locs.length >= 2 ? 'https://www.google.com/maps/dir/' + locs.map(enc).join('/') : '';
  const country = day.country || '';

  let nextId = null;
  if (isToday) {
    const now = nowHM();
    const pending = day.items.filter(i => !i.status || i.status === 'planned');
    nextId = (pending.find(i => !i.time || i.time >= now) || pending[pending.length - 1] || {}).id;
  }

  let items = '';
  day.items.forEach(it => {
    items += renderItem(it, { prevLoc, country: countryOf(it, day), isNext: it.id === nextId });
    if (it.status !== 'skipped' && locOf(it)) prevLoc = locOf(it);
  });
  if (!day.items.length) items = `<div class="empty">Nothing planned yet.</div>`;

  return `<section class="day ${isToday ? 'today' : ''} ${collapsed ? 'collapsed' : ''}" id="day-${day.id}">
    <div class="day-head" data-act="toggle-day" data-id="${day.id}">
      <div class="day-num">D${di + 1}</div>
      <div class="day-title">
        <h2>${esc(fmtDate(day.date))}${day.city ? ' · ' + esc(day.city) : ''}</h2>
        <div class="muted small">${esc(day.title || '')}${day.title ? ' · ' : ''}${day.items.length} item${day.items.length === 1 ? '' : 's'}${country ? ' · ' + COUNTRIES[country] : ''}</div>
      </div>
      <span class="chev">▾</span>
    </div>
    <div class="day-tools">
      <button class="chip plain" data-act="add-item" data-id="${day.id}">＋ Add</button>
      ${routeUrl ? `<a class="chip" href="${routeUrl}" target="_blank" rel="noopener">🗺️ Whole day route</a>` : ''}
      ${day.city ? `<a class="chip" href="${gsearch('weather ' + day.city + ' ' + fmtDate(day.date, { month: 'short', day: 'numeric' }))}" target="_blank" rel="noopener">☁️ Weather</a>` : ''}
      <button class="chip plain" data-act="sort-day" data-id="${day.id}">⇅ Sort by time</button>
      <button class="chip plain" data-act="edit-day" data-id="${day.id}">✏️ Day</button>
    </div>
    ${day.notes ? `<div class="day-tools small muted" style="white-space:pre-wrap">${esc(day.notes)}</div>` : ''}
    <div class="day-body">${items}</div>
  </section>`;
}

function renderItem(it, { prevLoc = '', country = '', isNext = false, idea = false } = {}) {
  const T = TYPES[it.type] || TYPES.other;
  const open = ui.open.has(it.id);
  const status = it.status || 'planned';
  let sub = [];
  if (TRANSPORT.has(it.type)) {
    if (it.number) sub.push(it.number);
    if (it.from || it.to) sub.push(`${it.from || '?'} → ${it.to || '?'}`);
  } else {
    if (it.place && it.place !== it.title) sub.push(it.place);
    else if (it.address) sub.push(it.address);
  }
  if (it.ref) sub.push(`Ref ${it.ref}`);

  const tags = [
    isNext ? `<span class="tag next">NEXT</span>` : '',
    status === 'done' ? `<span class="tag done">✓ done</span>` : '',
    status === 'skipped' ? `<span class="tag">skipped</span>` : '',
    it.planB ? `<span class="tag planb">Plan B</span>` : '',
    it.photos?.length ? `<span class="tag">📎${it.photos.length}</span>` : '',
  ].join('');

  const links = linksFor(it, prevLoc, country)
    .map(l => `<a class="chip ${l.cls}" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('');

  const kv = [
    ['Address', it.address], ['Local name', it.localName], ['Booking', it.ref],
    ['Cost', it.cost], ['Notes', it.notes],
  ].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');

  const photos = (it.photos || []).map(p => `<img data-photo="${p}" data-act="view-photo" data-id="${it.id}" alt="attachment">`).join('');

  return `<div class="item status-${status} ${isNext ? 'next' : ''} ${open ? 'open' : ''}" id="item-${it.id}">
    <div class="item-time">${esc(it.time || '')}${it.endTime ? `<span class="end">${esc(it.endTime)}</span>` : ''}</div>
    <div class="item-main">
      <div class="item-head" data-act="toggle-item" data-id="${it.id}">
        <div class="item-title">${T.icon} ${esc(it.title || '(untitled)')}${tags}</div>
        ${sub.length ? `<div class="item-sub">${esc(sub.join(' · '))}</div>` : ''}
      </div>
      <div class="links">${links}</div>
      <div class="details">
        ${kv ? `<dl class="kv">${kv}</dl>` : ''}
        ${it.planB ? `<div class="planb-box"><b>Plan B:</b> ${esc(it.planB)}</div>` : ''}
        ${photos ? `<div class="photos">${photos}</div>` : ''}
        <div class="actions">
          ${status !== 'done' ? `<button class="btn" data-act="status" data-id="${it.id}" data-val="done">✓ Done</button>` : ''}
          ${status !== 'skipped' ? `<button class="btn" data-act="status" data-id="${it.id}" data-val="skipped">⤼ Skip</button>` : ''}
          ${status !== 'planned' ? `<button class="btn" data-act="status" data-id="${it.id}" data-val="planned">↺ Reset</button>` : ''}
          <button class="btn" data-act="edit-item" data-id="${it.id}">✏️ Edit</button>
          ${idea ? '' : `<button class="btn" data-act="move-up" data-id="${it.id}">↑</button>
          <button class="btn" data-act="move-down" data-id="${it.id}">↓</button>`}
          <button class="btn" data-act="move-item" data-id="${it.id}">📅 ${idea ? 'Schedule' : 'Move'}</button>
          ${idea || !it.time ? '' : `<button class="btn" data-act="shift" data-id="${it.id}">⏱ Delay</button>`}
          ${it.planB ? `<button class="btn" data-act="swap-planb" data-id="${it.id}">⇄ Use Plan B</button>` : ''}
          ${it.localName || it.address ? `<button class="btn" data-act="taxi" data-id="${it.id}">🚕 Show driver</button>` : ''}
          <button class="btn" data-act="add-photo" data-id="${it.id}">📷 Attach</button>
          <button class="btn" data-act="dup-item" data-id="${it.id}">⧉ Copy</button>
          <button class="btn danger" data-act="del-item" data-id="${it.id}">🗑</button>
        </div>
      </div>
    </div>
  </div>`;
}

function renderBookings() {
  const rows = [];
  trip.days.forEach((day, di) => day.items.forEach(it => {
    if (it.ref || it.type === 'flight' || it.type === 'hotel' || it.photos?.length) rows.push({ it, day, di });
  }));
  trip.ideas.forEach(it => { if (it.ref) rows.push({ it, day: null }); });
  let html = `<p class="muted small">Everything with a booking number, plus all flights and hotels. Works offline — attach screenshots of tickets/QR codes so you have them without signal.</p>`;
  if (!rows.length) html += `<div class="card empty">No bookings yet. Add a booking/confirmation number to any item.</div>`;
  for (const { it, day, di } of rows) {
    const T = TYPES[it.type] || TYPES.other;
    const when = day ? `D${di + 1} · ${fmtDate(day.date)}${it.time ? ' · ' + it.time : ''}` : 'Unscheduled';
    const photos = (it.photos || []).map(p => `<img data-photo="${p}" data-act="view-photo" data-id="${it.id}" alt="attachment">`).join('');
    const extra = TRANSPORT.has(it.type) ? [it.number, it.from && it.to ? `${it.from} → ${it.to}` : ''].filter(Boolean).join(' · ') : (it.address || '');
    html += `<div class="card">
      <div class="booking-row">
        <div class="grow">
          <div class="muted small">${esc(when)}</div>
          <div class="item-title">${T.icon} ${esc(it.title)}</div>
          ${extra ? `<div class="item-sub">${esc(extra)}</div>` : ''}
          ${it.ref ? `<div class="ref">${esc(it.ref)}</div>` : '<div class="muted small">No booking number saved</div>'}
        </div>
        ${it.ref ? `<button class="btn" data-act="copy" data-val="${esc(it.ref)}">Copy</button>` : ''}
      </div>
      ${photos ? `<div class="photos">${photos}</div>` : ''}
      <div class="links">
        ${it.url ? `<a class="chip primary" href="${esc(normUrl(it.url))}" target="_blank" rel="noopener">Open booking/site</a>` : ''}
        <button class="chip plain" data-act="goto-item" data-id="${it.id}">View in plan</button>
        <button class="chip plain" data-act="add-photo" data-id="${it.id}">📷 Attach ticket</button>
      </div>
    </div>`;
  }
  return html;
}

function renderIdeas() {
  let html = `<p class="muted small">A backlog of places you <i>might</i> visit — handy when plans change, it rains, or you have spare time. Use <b>📅 Schedule</b> to drop one into a day. Items you remove from a day can be parked here too.</p>`;
  html += `<div class="day"><div class="day-body" style="border-top:0">`;
  html += trip.ideas.length
    ? trip.ideas.map(it => renderItem(it, { country: it.country || '', idea: true })).join('')
    : `<div class="empty">No ideas yet.</div>`;
  html += `</div></div><button class="btn wide" data-act="add-idea">＋ Add idea</button>`;
  return html;
}

function renderInfo() {
  const hotels = [];
  trip.days.forEach(d => d.items.forEach(it => { if (it.type === 'hotel') hotels.push(it); }));
  const uniqHotels = [...new Map(hotels.map(h => [h.title, h])).values()];
  return `
  <div class="card">
    <h2>Trip</h2>
    <div class="btn-row">
      <button class="btn" data-act="rename-trip">✏️ Rename trip</button>
      <button class="btn" data-act="add-day">＋ Add day</button>
    </div>
  </div>

  <div class="card">
    <h2>🆘 Emergency</h2>
    <h3>Hong Kong</h3>
    <ul class="plain">
      <li>Police / Fire / Ambulance: <a href="tel:999"><b>999</b></a></li>
      <li>HK Tourism Board visitor hotline: <a href="tel:+85225081234">+852 2508 1234</a></li>
    </ul>
    <h3>Japan</h3>
    <ul class="plain">
      <li>Police: <a href="tel:110"><b>110</b></a> · Fire / Ambulance: <a href="tel:119"><b>119</b></a></li>
      <li>JNTO Japan Visitor Hotline (24h, English): <a href="tel:+815038162787">050-3816-2787</a></li>
    </ul>
    ${uniqHotels.length ? `<h3>Your hotels</h3><ul class="plain">${uniqHotels.map(h => `<li><b>${esc(h.title)}</b>${h.address ? `<br><span class="small">${esc(h.address)}</span>` : ''}${h.localName ? `<br><span class="small">${esc(h.localName)}</span>` : ''}</li>`).join('')}</ul>` : ''}
  </div>

  <div class="card">
    <h2>📴 Getting ready for no signal</h2>
    <ul class="plain">
      <li>Open this page once while online and <b>Add to Home Screen</b> — it then loads with no network.</li>
      <li>In Google Maps, download <b>offline areas</b> for Hong Kong, Tokyo, Kyoto/Osaka etc. (search and walking directions work offline; train times do not).</li>
      <li>Use <b>📷 Attach</b> to save screenshots of tickets, QR codes, hotel confirmations and station maps — they're stored on this device.</li>
      <li>Add the <b>local-language name</b> to hotels and key places so <b>🚕 Show driver</b> works.</li>
      <li>Export a backup below and keep it in your files/email.</li>
    </ul>
  </div>

  <div class="card">
    <h2>🔗 Handy links</h2>
    <ul class="plain">
      <li><a href="https://www.vjw.digital.go.jp/" target="_blank" rel="noopener">Visit Japan Web</a> (immigration & customs QR)</li>
      <li><a href="https://www.mtr.com.hk/en/customer/jp/index.php" target="_blank" rel="noopener">MTR journey planner</a> · <a href="https://www.hko.gov.hk/en/" target="_blank" rel="noopener">HK Observatory</a></li>
      <li><a href="https://world.jorudan.co.jp/mln/en/" target="_blank" rel="noopener">Jorudan train route finder</a> · <a href="https://www.jreast.co.jp/multi/en/" target="_blank" rel="noopener">JR East</a> · <a href="https://smart-ex.jp/en/" target="_blank" rel="noopener">smartEX Shinkansen</a></li>
      <li><a href="https://www.jma.go.jp/bosai/en_forecast/" target="_blank" rel="noopener">Japan weather (JMA)</a></li>
    </ul>
  </div>

  <div class="card">
    <h2>💾 Backup & sync</h2>
    <p class="muted small">Your plan is saved on this device only. Export a file to back it up or move it to another phone/laptop (attachments included).</p>
    <div class="btn-row">
      <button class="btn primary" data-act="export">⬇️ Export backup</button>
      <button class="btn" data-act="import">⬆️ Import backup</button>
      <button class="btn" data-act="persist">🔒 Keep data safe</button>
    </div>
    <div class="btn-row" style="margin-top:10px">
      <button class="btn danger" data-act="reset-sample">Load sample trip</button>
      <button class="btn danger" data-act="reset-blank">Start blank</button>
    </div>
    <p class="muted small" id="storageInfo"></p>
  </div>`;
}

/* ---------- modal ---------- */
function openModal({ title, body, submitLabel = 'Save', onSubmit, onOpen }) {
  const dlg = $('#modal');
  dlg.innerHTML = `<form class="modal-form" novalidate>
    <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></header>
    <div class="modal-body">${body}</div>
    ${onSubmit ? `<footer><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary">${esc(submitLabel)}</button></footer>` : ''}
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

function itemFormHtml(it) {
  const f = (name, label, attrs = '') =>
    `<label>${label}<input name="${name}" value="${esc(it[name] || '')}" ${attrs}></label>`;
  const typeOpts = Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${it.type === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('');
  const linksTxt = (it.links || []).map(l => `${l.label} | ${l.url}`).join('\n');
  return `
    <div class="grid2">
      <label>Type<select name="type">${typeOpts}</select></label>
      <div class="grid2" style="grid-template-columns:1fr 1fr">
        <label>Start<input type="time" name="time" value="${esc(it.time || '')}"></label>
        <label>End<input type="time" name="endTime" value="${esc(it.endTime || '')}"></label>
      </div>
    </div>
    ${f('title', 'Title *', 'required placeholder="e.g. Dinner at Ichiran"')}
    <div class="tonly">
      <div class="grid2">
        ${f('from', 'From (station / airport)', 'placeholder="Shinjuku Station"')}
        ${f('to', 'To', 'placeholder="Kyoto Station"')}
      </div>
      ${f('number', 'Flight / train / bus no.', 'placeholder="CX 520 · Nozomi 21"')}
    </div>
    <div class="ponly">${f('place', 'Place name (what Google Maps should search)', 'placeholder="Ichiran Shibuya"')}</div>
    ${f('address', 'Address')}
    ${f('localName', 'Name in Japanese / Chinese (for taxi drivers)', 'placeholder="一蘭 渋谷店"')}
    <div class="grid2">
      ${f('ref', 'Booking / confirmation no.')}
      ${f('cost', 'Cost', 'placeholder="¥3,000"')}
    </div>
    ${f('url', 'Website / booking link', 'inputmode="url" placeholder="https://…"')}
    <label>Notes<textarea name="notes" rows="3" placeholder="Opening hours, what to order, exit number…">${esc(it.notes || '')}</textarea></label>
    <label>Plan B — backup if this falls through<textarea name="planB" rows="2" placeholder="If closed/raining: go to …">${esc(it.planB || '')}</textarea></label>
    <label>Extra links (one per line: Label | URL)<textarea name="links" rows="2" placeholder="Menu | https://…">${esc(linksTxt)}</textarea></label>
    <label>Country (for review/station links)<select name="country">
      <option value="">Same as day</option>
      ${Object.entries(COUNTRIES).map(([k, v]) => `<option value="${k}" ${it.country === k ? 'selected' : ''}>${v}</option>`).join('')}
    </select></label>`;
}

function readItemForm(fd, it) {
  for (const k of ['type', 'time', 'endTime', 'title', 'from', 'to', 'number', 'place', 'address', 'localName', 'ref', 'cost', 'url', 'notes', 'planB', 'country']) {
    const v = (fd.get(k) || '').toString().trim();
    if (v) it[k] = v; else delete it[k];
  }
  it.links = (fd.get('links') || '').toString().split('\n').map(line => {
    line = line.trim();
    if (!line) return null;
    const i = line.lastIndexOf('|');
    return i >= 0 ? { label: line.slice(0, i).trim(), url: line.slice(i + 1).trim() } : { label: 'Link', url: line };
  }).filter(l => l && l.url);
  if (!it.links.length) delete it.links;
  return it;
}

function bindTypeToggle(form) {
  const sync = () => { form.dataset.kind = TRANSPORT.has(form.elements.type.value) ? 'transport' : 'place'; };
  form.elements.type.addEventListener('change', sync);
  sync();
}

function editItem(id) {
  const f = findItem(id);
  if (!f) return;
  openModal({
    title: 'Edit item',
    body: itemFormHtml(f.item),
    onOpen: bindTypeToggle,
    onSubmit: fd => commit(() => { readItemForm(fd, findItem(id).item); }, 'Saved'),
  });
}

function addItem(target) { // target: day id, or 'ideas'
  const draft = { id: uid(), type: 'sight', status: 'planned' };
  openModal({
    title: target === 'ideas' ? 'New idea' : 'Add to day',
    body: itemFormHtml(draft),
    submitLabel: 'Add',
    onOpen: bindTypeToggle,
    onSubmit: fd => commit(() => {
      readItemForm(fd, draft);
      if (target === 'ideas') trip.ideas.push(draft);
      else findDay(target).items.push(draft);
      ui.open.add(draft.id);
    }, 'Added'),
  });
}

function dayFormHtml(d) {
  return `
    <label>Date<input type="date" name="date" value="${esc(d.date || '')}"></label>
    <div class="grid2">
      <label>City<input name="city" value="${esc(d.city || '')}" placeholder="Tokyo"></label>
      <label>Country<select name="country">
        <option value="">—</option>
        ${Object.entries(COUNTRIES).map(([k, v]) => `<option value="${k}" ${d.country === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select></label>
    </div>
    <label>Theme / title<input name="title" value="${esc(d.title || '')}" placeholder="Asakusa & Ueno"></label>
    <label>Day notes<textarea name="notes" rows="3">${esc(d.notes || '')}</textarea></label>`;
}
function readDayForm(fd, d) {
  for (const k of ['date', 'city', 'country', 'title', 'notes']) {
    const v = (fd.get(k) || '').toString().trim();
    if (v) d[k] = v; else delete d[k];
  }
}

function editDay(id) {
  const d = findDay(id);
  openModal({
    title: 'Edit day',
    body: dayFormHtml(d) + `<div class="btn-row" style="margin-top:6px">
        <button type="button" class="btn" id="dupDay">⧉ Duplicate day</button>
        <button type="button" class="btn danger" id="delDay">🗑 Delete day</button></div>
        <p class="hint" style="margin-top:8px">Deleting a day moves its items to <b>Ideas</b>, so nothing is lost.</p>`,
    onSubmit: fd => commit(() => readDayForm(fd, findDay(id)), 'Day updated'),
    onOpen: form => {
      form.querySelector('#delDay').onclick = () => {
        closeModal();
        commit(() => {
          const day = findDay(id);
          trip.ideas.push(...day.items);
          trip.days = trip.days.filter(x => x.id !== id);
        }, 'Day deleted — items moved to Ideas');
      };
      form.querySelector('#dupDay').onclick = () => {
        closeModal();
        commit(() => {
          const day = findDay(id);
          const copy = JSON.parse(JSON.stringify(day));
          copy.id = uid();
          copy.date = addDays(day.date, 1);
          copy.items.forEach(i => { i.id = uid(); i.status = 'planned'; });
          trip.days.push(copy);
        }, 'Day duplicated');
      };
    },
  });
}

function addDay() {
  const lastDay = trip.days[trip.days.length - 1];
  const d = { id: uid(), date: lastDay ? addDays(lastDay.date, 1) : todayStr(), city: lastDay?.city, country: lastDay?.country, items: [] };
  openModal({
    title: 'Add day',
    body: dayFormHtml(d),
    submitLabel: 'Add day',
    onSubmit: fd => commit(() => { readDayForm(fd, d); trip.days.push(d); }, 'Day added'),
  });
}

function moveItem(id) {
  const f = findItem(id);
  const opts = trip.days.map((d, i) =>
    `<option value="${d.id}" ${f.day && f.day.id === d.id ? 'selected' : ''}>Day ${i + 1} · ${esc(fmtDate(d.date))}${d.city ? ' · ' + esc(d.city) : ''}</option>`).join('');
  openModal({
    title: `Move “${f.item.title}”`,
    body: `<label>Move to<select name="to"><option value="ideas" ${!f.day ? 'selected' : ''}>💡 Ideas (unscheduled)</option>${opts}</select></label>
      <label>New start time (optional)<input type="time" name="time" value="${esc(f.item.time || '')}"></label>
      <p class="hint">The item is placed by time in the new day.</p>`,
    submitLabel: 'Move',
    onSubmit: fd => commit(() => {
      const cur = findItem(id);
      const [it] = cur.list.splice(cur.index, 1);
      const t = (fd.get('time') || '').toString();
      if (t) it.time = t; else delete it.time;
      const to = fd.get('to');
      if (to === 'ideas') { trip.ideas.push(it); return; }
      const list = findDay(to).items;
      const at = it.time ? list.findIndex(x => x.time && x.time > it.time) : -1;
      if (at >= 0) list.splice(at, 0, it); else list.push(it);
    }, 'Moved'),
  });
}

function shiftItems(id) {
  const f = findItem(id);
  openModal({
    title: 'Running late?',
    body: `<p class="hint" style="margin:0 0 10px">Shift <b>${esc(f.item.title)}</b> and everything after it on this day.</p>
      <div class="btn-row" style="margin-bottom:12px">
        ${[-30, 15, 30, 60, 90, 120].map(m => `<button type="button" class="btn" data-min="${m}">${m > 0 ? '+' : ''}${m} min</button>`).join('')}
      </div>
      <label>Or custom minutes (negative = earlier)<input type="number" name="mins" value="30" step="5"></label>`,
    submitLabel: 'Shift',
    onOpen: form => form.querySelectorAll('[data-min]').forEach(b => {
      b.onclick = () => { form.elements.mins.value = b.dataset.min; form.requestSubmit(); };
    }),
    onSubmit: fd => {
      const mins = parseInt(fd.get('mins'), 10);
      if (!mins) return;
      commit(() => {
        const cur = findItem(id);
        cur.list.slice(cur.index).forEach(it => {
          if (it.status === 'done') return;
          it.time = shiftTime(it.time, mins);
          if (it.endTime) it.endTime = shiftTime(it.endTime, mins);
        });
      }, `Shifted ${mins > 0 ? '+' : ''}${mins} min`);
    },
  });
}

function showTaxi(id) {
  const { item: it, day } = findItem(id);
  const c = countryOf(it, day);
  openModal({
    title: '🚕 Show to driver',
    body: `<div class="taxi">
      <div class="phrase">${TAXI_PHRASE[c] || TAXI_PHRASE['']}</div>
      <div class="big">${esc(it.localName || it.place || it.title)}</div>
      ${it.address ? `<div class="addr">${esc(it.address)}</div>` : ''}
      ${it.localName && it.place ? `<div class="muted" style="margin-top:12px">${esc(it.place)}</div>` : ''}
    </div>`,
  });
}

function viewPhoto(itemId, photoId) {
  openModal({
    title: findItem(itemId)?.item.title || 'Attachment',
    body: `<img class="photo-full" data-photo="${photoId}" alt="">
      <div class="btn-row" style="margin-top:12px"><button type="button" class="btn danger" id="delPhoto">Remove attachment</button></div>`,
    onOpen: form => {
      hydratePhotos();
      form.querySelector('#delPhoto').onclick = () => {
        if (!confirm('Remove this attachment?')) return;
        closeModal();
        commit(() => {
          const it = findItem(itemId).item;
          it.photos = (it.photos || []).filter(p => p !== photoId);
        }, 'Attachment removed');
        PhotoDB.del(photoId).catch(() => {});
      };
    },
  });
}

/* ---------- import / export ---------- */
async function exportTrip() {
  const ids = new Set();
  const all = [...trip.days.flatMap(d => d.items), ...trip.ideas];
  all.forEach(it => (it.photos || []).forEach(p => ids.add(p)));
  const photos = {};
  for (const id of ids) {
    const blob = await PhotoDB.get(id).catch(() => null);
    if (blob) photos[id] = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  }
  const data = JSON.stringify({ app: 'trip-planner', version: 1, exportedAt: new Date().toISOString(), trip, photos });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = `${(trip.name || 'trip').replace(/[^\w-]+/g, '-')}-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('Backup downloaded');
}

async function importTrip(file) {
  try {
    const data = JSON.parse(await file.text());
    const t = data.trip || data; // accept either a full backup or a bare trip object
    if (!Array.isArray(t.days)) throw new Error('No "days" found in file');
    if (!confirm(`Replace the current plan with “${t.name || 'imported trip'}” (${t.days.length} days)? You can undo this.`)) return;
    for (const [id, url] of Object.entries(data.photos || {})) {
      const blob = await (await fetch(url)).blob();
      await PhotoDB.put(id, blob);
    }
    // fill in any missing ids/status so hand-written JSON works too
    const fix = it => { it.id = it.id || uid(); it.type = it.type || 'other'; it.status = it.status || 'planned'; return it; };
    t.days.forEach(d => { d.id = d.id || uid(); d.items = (d.items || []).map(fix); });
    t.ideas = (t.ideas || []).map(fix);
    commit(() => { trip = t; }, 'Imported');
  } catch (e) {
    alert('Could not import: ' + e.message);
  }
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, withUndo = false) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${withUndo ? '<button data-act="undo">Undo</button>' : ''}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), withUndo ? 5000 : 2500);
}

/* ---------- actions ---------- */
const actions = {
  tab: id => { ui.tab = id; render(); window.scrollTo(0, 0); },
  undo,
  'toggle-day': id => { ui.collapsed.has(id) ? ui.collapsed.delete(id) : ui.collapsed.add(id); render(); },
  'toggle-item': id => { ui.open.has(id) ? ui.open.delete(id) : ui.open.add(id); $('#item-' + id)?.classList.toggle('open'); },
  'jump-today': () => document.querySelector('.day.today')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  'add-day': addDay,
  'edit-day': editDay,
  'add-item': addItem,
  'add-idea': () => addItem('ideas'),
  'edit-item': editItem,
  'move-item': moveItem,
  shift: shiftItems,
  taxi: showTaxi,
  'sort-day': id => commit(() => {
    findDay(id).items.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  }, 'Sorted by time'),
  status: (id, el) => commit(() => {
    const it = findItem(id).item;
    it.status = el.dataset.val;
    if (it.status !== 'planned') ui.open.delete(id);
  }, el.dataset.val === 'skipped' ? 'Skipped' : el.dataset.val === 'done' ? 'Marked done' : 'Reset'),
  'move-up': id => commit(() => {
    const f = findItem(id);
    if (f.index > 0) [f.list[f.index - 1], f.list[f.index]] = [f.list[f.index], f.list[f.index - 1]];
  }),
  'move-down': id => commit(() => {
    const f = findItem(id);
    if (f.index < f.list.length - 1) [f.list[f.index + 1], f.list[f.index]] = [f.list[f.index], f.list[f.index + 1]];
  }),
  'dup-item': id => commit(() => {
    const f = findItem(id);
    const copy = { ...JSON.parse(JSON.stringify(f.item)), id: uid(), status: 'planned', photos: [...(f.item.photos || [])] };
    f.list.splice(f.index + 1, 0, copy);
    ui.open.add(copy.id);
  }, 'Copied'),
  'del-item': id => commit(() => {
    const f = findItem(id);
    f.list.splice(f.index, 1);
  }, 'Deleted'),
  'swap-planb': id => commit(() => {
    const it = findItem(id).item;
    const oldTitle = it.title, oldPlace = it.place, oldNotes = it.notes;
    const plan = it.planB.trim();
    const firstLine = plan.split('\n')[0].replace(/^(if [^:]*:\s*)/i, '').trim();
    it.title = firstLine.slice(0, 80) || plan.slice(0, 80);
    it.place = it.title;
    delete it.address; delete it.localName; delete it.url;
    it.notes = plan;
    it.planB = `Original plan: ${oldTitle}${oldPlace && oldPlace !== oldTitle ? ' (' + oldPlace + ')' : ''}${oldNotes ? '\n' + oldNotes : ''}`;
  }, 'Switched to Plan B — edit to add details'),
  'add-photo': id => { pendingPhotoItem = id; $('#photoInput').click(); },
  'view-photo': (id, el) => viewPhoto(id, el.dataset.photo),
  'goto-item': id => {
    const f = findItem(id);
    ui.tab = f.day ? 'plan' : 'ideas';
    ui.open.add(id);
    if (f.day) ui.collapsed.delete(f.day.id);
    render();
    $('#item-' + id)?.scrollIntoView({ block: 'center' });
  },
  copy: (_, el) => navigator.clipboard?.writeText(el.dataset.val).then(() => toast('Copied'), () => toast('Copy failed')),
  'rename-trip': () => openModal({
    title: 'Rename trip',
    body: `<label>Trip name<input name="name" value="${esc(trip.name || '')}" required></label>`,
    onSubmit: fd => commit(() => { trip.name = fd.get('name').toString().trim(); }),
  }),
  export: exportTrip,
  import: () => $('#importInput').click(),
  persist: async () => {
    if (!navigator.storage?.persist) return toast('Not supported on this browser');
    const ok = await navigator.storage.persist();
    toast(ok ? '🔒 Browser will keep your data' : 'Browser declined — install to Home Screen and export backups');
  },
  'reset-sample': () => { if (confirm('Replace your plan with the sample trip? (Undo is available)')) commit(() => { trip = sampleTrip(); }, 'Sample loaded'); },
  'reset-blank': () => { if (confirm('Clear everything and start blank? (Undo is available)')) commit(() => { trip = { name: 'My trip', days: [], ideas: [] }; }, 'Cleared'); },
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
    return toast('Could not save photo: ' + err.message);
  }
  commit(() => {
    const it = findItem(id).item;
    it.photos = [...(it.photos || []), ...ids];
    ui.open.add(id);
  }, `Attached ${ids.length} photo${ids.length > 1 ? 's' : ''} (available offline)`);
});
$('#importInput').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) importTrip(file);
});

/* ---------- online / offline ---------- */
function updateNet() {
  const on = navigator.onLine;
  const el = $('#netStatus');
  el.textContent = on ? '● Online' : '● Offline';
  el.classList.toggle('offline', !on);
  document.body.classList.toggle('is-offline', !on);
}
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// refresh the "NEXT" marker every minute while open
setInterval(() => { if (ui.tab === 'plan' && !$('#modal').open) render(); }, 60_000);

/* ---------- sample data ---------- */
function sampleTrip() {
  const S = (o) => ({ id: uid(), status: 'planned', ...o });
  return {
    name: 'Hong Kong & Japan (sample)',
    days: [
      { id: uid(), date: '2026-12-01', city: 'Hong Kong', country: 'HK', title: 'Arrive & The Peak', items: [
        S({ type: 'flight', time: '07:35', endTime: '11:20', title: 'Flight to Hong Kong', number: 'CX 000', from: 'Your home airport', to: 'Hong Kong International Airport', ref: 'ABC123', notes: 'SAMPLE — replace with your real flight.' }),
        S({ type: 'train', time: '12:15', title: 'Airport Express to Kowloon', from: 'Airport Station Hong Kong', to: 'Kowloon Station', notes: 'Tap Octopus card or credit card. ~22 min.' }),
        S({ type: 'hotel', time: '13:00', title: 'Hotel check-in (sample)', place: 'Tsim Sha Tsui', address: 'Tsim Sha Tsui, Kowloon, Hong Kong', localName: '尖沙咀', ref: 'HTL-0001' }),
        S({ type: 'food', time: '14:00', title: 'Lunch: Tim Ho Wan', place: 'Tim Ho Wan Sham Shui Po', localName: '添好運 深水埗', notes: 'Baked BBQ pork buns.', planB: 'If queue too long: Australia Dairy Company, Jordan' }),
        S({ type: 'sight', time: '18:30', title: 'Victoria Peak at sunset', place: 'The Peak Tower', localName: '山頂凌霄閣', planB: 'If foggy: Avenue of Stars + Symphony of Lights at 20:00' }),
      ] },
      { id: uid(), date: '2026-12-02', city: 'Hong Kong', country: 'HK', title: 'Central & Kowloon', items: [
        S({ type: 'food', time: '09:00', title: 'Dim sum breakfast', place: 'Lin Heung Kui', localName: '蓮香居' }),
        S({ type: 'ferry', time: '11:00', title: 'Star Ferry to TST', from: 'Central Pier 7', to: 'Tsim Sha Tsui Star Ferry Pier' }),
        S({ type: 'shop', time: '19:00', title: 'Temple Street Night Market', place: 'Temple Street Night Market', localName: '廟街夜市' }),
      ] },
      { id: uid(), date: '2026-12-03', city: 'Tokyo', country: 'JP', title: 'Fly to Tokyo', items: [
        S({ type: 'flight', time: '09:00', endTime: '14:30', title: 'Flight HKG → Tokyo', number: 'CX 000', from: 'Hong Kong International Airport', to: 'Narita International Airport', ref: 'DEF456', notes: 'SAMPLE — fill in Visit Japan Web before landing.' }),
        S({ type: 'train', time: '15:45', title: "Narita Express to Shinjuku", number: "N'EX", from: 'Narita Airport Terminal 2·3 Station', to: 'Shinjuku Station', notes: 'Reserved seats. ~80 min.' }),
        S({ type: 'hotel', time: '17:30', title: 'Hotel check-in (sample)', place: 'Shinjuku', address: 'Shinjuku, Tokyo', localName: '新宿', ref: 'HTL-0002' }),
        S({ type: 'food', time: '19:30', title: 'Ramen: Ichiran Shinjuku', place: 'Ichiran Shinjuku Central East Exit', localName: '一蘭 新宿中央東口店' }),
      ] },
      { id: uid(), date: '2026-12-04', city: 'Tokyo', country: 'JP', title: 'Asakusa & Shibuya', items: [
        S({ type: 'sight', time: '09:00', title: 'Senso-ji Temple', place: 'Senso-ji', localName: '浅草寺' }),
        S({ type: 'food', time: '12:30', title: 'Lunch in Asakusa', place: 'Asakusa Imahan', localName: '浅草今半 本店', planB: 'Any tempura place on Denboin-dori' }),
        S({ type: 'sight', time: '17:00', title: 'Shibuya Sky', place: 'Shibuya Sky', localName: 'SHIBUYA SKY', ref: 'Timed ticket 17:00', planB: 'If cloudy: Shibuya Crossing view from Starbucks / Magnet' }),
      ] },
      { id: uid(), date: '2026-12-05', city: 'Kyoto', country: 'JP', title: 'Shinkansen to Kyoto', items: [
        S({ type: 'train', time: '09:00', endTime: '11:15', title: 'Shinkansen Tokyo → Kyoto', number: 'Nozomi', from: 'Tokyo Station', to: 'Kyoto Station', ref: 'Car 7 Seat 12A', notes: 'Buy bento at Tokyo Station Ekibenya Matsuri.' }),
        S({ type: 'sight', time: '14:00', title: 'Fushimi Inari Taisha', place: 'Fushimi Inari Taisha', localName: '伏見稲荷大社' }),
      ] },
    ],
    ideas: [
      S({ type: 'sight', title: 'teamLab Planets (rainy-day option)', place: 'teamLab Planets TOKYO', country: 'JP' }),
      S({ type: 'food', title: 'Tsukiji Outer Market breakfast', place: 'Tsukiji Outer Market', localName: '築地場外市場', country: 'JP' }),
      S({ type: 'sight', title: 'Big Buddha & Ngong Ping 360', place: 'Tian Tan Buddha', localName: '天壇大佛', country: 'HK' }),
    ],
  };
}

/* ---------- boot ---------- */
function showStorageInfo() {
  navigator.storage?.estimate?.().then(({ usage, quota }) => {
    const el = $('#storageInfo');
    if (el) el.textContent = `Storage used: ${(usage / 1048576).toFixed(1)} MB of ${(quota / 1048576).toFixed(0)} MB available.`;
  });
}

normalize();
updateNet();
render();
