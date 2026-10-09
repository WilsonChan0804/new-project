/* Small pieces every Tasks view uses: escaping, dates, avatars, pills and
 * the person / option pickers. */

export const $ = (s, el) => (el || document).querySelector(s);
export const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

export const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const uid = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 20);

/* Dates are kept as YYYY-MM-DD (or YYYY-MM-DDTHH:MM). "Today" is Hong Kong
   / Manila time, which is where most of the team is. */
export function today() {
  const d = new Date(Date.now() + 8 * 3600e3);
  return d.toISOString().slice(0, 10);
}
export function addDays(ymd, n) {
  const d = new Date(ymd.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((Date.parse(b.slice(0, 10) + "T00:00:00Z") - Date.parse(a.slice(0, 10) + "T00:00:00Z")) / 86400e3);
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDate(ymd, withYear) {
  if (!ymd) return "";
  const y = ymd.slice(0, 4), m = Number(ymd.slice(5, 7)), d = Number(ymd.slice(8, 10));
  const showYear = withYear || y !== today().slice(0, 4);
  return `${MON[m - 1]} ${d}` + (showYear ? `, ${y}` : "");
}
export function fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!(s >= 0)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  if (s < 86400 * 30) return Math.floor(s / 86400) + " d ago";
  return fmtWhen(iso);
}

export const isOverdue = (t) => !t.done && t.due && t.due.slice(0, 10) < today();

/* Initials in a coloured circle - the colour follows the name, so a person
   is the same colour on every page. */
const AV = ["#e2453c", "#d1660e", "#0e9f6e", "#3b82f6", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#b45309", "#4f46e5"];
export function initials(name) {
  const p = String(name || "?").trim().split(/\s+/);
  return ((p[0] || "?")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}
export function avatarColor(name) {
  let h = 0;
  for (const c of String(name || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV[h % AV.length];
}
export function avatar(p, size) {
  const n = (p && p.name) || "?";
  return `<span class="av" style="background:${avatarColor(n)}${size ? `;width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px` : ""}" title="${esc(n)}">${esc(initials(n))}</span>`;
}
export function people(list, max) {
  list = list || [];
  if (!list.length) return "";
  max = max || 3;
  if (list.length === 1) return `<span class="person">${avatar(list[0])}<span>${esc(list[0].name)}</span></span>`;
  return `<span class="avs">${list.slice(0, max).map((p) => avatar(p)).join("")}`
    + (list.length > max ? `<span class="av more">+${list.length - max}</span>` : "") + `</span>`;
}

/* Line icons (24 x 24, drawn with currentColor), the same on every phone
   and computer - unlike emoji, which each system draws its own way. */
const ICONS = {
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  reply: '<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  forward: '<polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  back: '<polyline points="15 18 9 12 15 6"/>',
  next: '<polyline points="9 18 15 12 9 6"/>',
  up: '<polyline points="18 15 12 9 6 15"/>',
  down: '<polyline points="6 9 12 15 18 9"/>',
  menu: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  more: '<circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/><circle cx="5" cy="12" r="1.2"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  belloff: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><line x1="2" y1="2" x2="22" y2="22"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  compose: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  play: '<polygon points="7 4 20 12 7 20 7 4" fill="currentColor"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  read: '<polyline points="18 7 9.5 15.5 6 12"/><polyline points="22 7 13.5 15.5 12.5 14.5"/>',
  exit: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  whatsapp: '<path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9z"/><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  pin: '<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>',
  poll: '<line x1="4" y1="20" x2="4" y2="10"/><line x1="10" y1="20" x2="10" y2="4"/><line x1="16" y1="20" x2="16" y2="13"/><line x1="2" y1="20" x2="22" y2="20"/>',
  task: '<rect x="3" y="3" width="18" height="18" rx="3"/><polyline points="8 12 11 15 16 9"/>',
  hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
  format: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
  ulist: '<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
  olist: '<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  pluscircle: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
  expand: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
  shrink: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>',
  sendfill: '<path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12 3.39 13.87z" fill="currentColor" stroke="none"/>',
};
export function ic(name, size) {
  return `<svg class="ic" viewBox="0 0 24 24" width="${size || 16}" height="${size || 16}" fill="none" stroke="currentColor" stroke-width="2" `
    + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

export const PRIORITIES = ["", "Low", "Medium", "High", "Urgent"];
export const PRI_RANK = { Urgent: 4, High: 3, Medium: 2, Low: 1, "": 0 };
export function priorityPill(p) {
  if (!p) return `<span class="muted">-</span>`;
  return `<span class="pri pri-${esc(p.toLowerCase())}">${esc(p)}</span>`;
}

export function progress(done, total) {
  if (!total) return "";
  const pct = Math.round((done / total) * 100);
  return `<span class="prog" title="${done} of ${total} sub-tasks done"><i style="width:${pct}%"></i></span>`;
}

/* ------------------------------------------------------------ pop-ups */

let POP = null;
export function closePop() {
  if (POP) { POP.remove(); POP = null; }
}
document.addEventListener("pointerdown", (ev) => {
  if (POP && !POP.contains(ev.target)) closePop();
}, true);
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closePop(); });

/* A small box under an element. Returns the box. */
export function pop(anchor, html, width) {
  closePop();
  const el = document.createElement("div");
  el.className = "t-pop";
  el.innerHTML = html;
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = width || 260;
  el.style.width = w + "px";
  el.style.left = Math.max(6, Math.min(innerWidth - w - 6, r.left)) + "px";
  const below = innerHeight - r.bottom;
  if (below < 260 && r.top > below) el.style.bottom = (innerHeight - r.top + 4) + "px";
  else el.style.top = (r.bottom + 4) + "px";
  // wholly on screen, however tall it is (it scrolls when it cannot fit)
  const b = el.getBoundingClientRect();
  if (b.top < 6 || b.bottom > innerHeight - 6) {
    el.style.bottom = "";
    el.style.maxHeight = (innerHeight - 12) + "px";
    el.style.overflowY = "auto";
    el.style.top = Math.max(6, Math.min(innerHeight - 6 - Math.min(b.height, innerHeight - 12), b.top)) + "px";
  }
  POP = el;
  return el;
}

/* Choose people: the organisation's accounts, or a typed name when the
   server runs without accounts. Calls done(list) on every change. */
export function pickPeople(anchor, chosen, everyone, done) {
  let sel = (chosen || []).slice();
  const key = (p) => (p.uid != null ? "u" + p.uid : "n" + (p.name || "").toLowerCase());
  const el = pop(anchor, `<input class="pp-q" placeholder="Search people${everyone.length ? "" : " or type a name, Enter"}">`
    + `<div class="pp-list"></div>`, 280);
  const q = el.querySelector(".pp-q"), box = el.querySelector(".pp-list");
  const paint = () => {
    const s = q.value.trim().toLowerCase();
    const have = new Set(sel.map(key));
    const rows = everyone.filter((p) => !s || p.name.toLowerCase().includes(s)
      || (p.team || "").toLowerCase().includes(s) || (p.office || "").toLowerCase().includes(s));
    const extra = sel.filter((p) => !everyone.some((e) => key(e) === key(p)));
    box.innerHTML = extra.concat(rows).slice(0, 80).map((p) =>
      `<label class="pp-row"><input type="checkbox" data-k="${esc(key(p))}"${have.has(key(p)) ? " checked" : ""}>`
      + `${avatar(p)}<b>${esc(p.name)}</b><small>${esc([p.team, p.office].filter(Boolean).join(" · "))}</small></label>`).join("")
      || `<div class="muted pp-empty">${everyone.length ? "Nobody matches" : "Type a name and press Enter"}</div>`;
  };
  const all = () => everyone.concat(sel);
  box.addEventListener("change", (ev) => {
    const k = ev.target.dataset.k;
    if (!k) return;
    if (ev.target.checked) {
      const p = all().find((x) => key(x) === k);
      if (p && !sel.some((x) => key(x) === k)) sel.push({ uid: p.uid ?? null, name: p.name });
    } else sel = sel.filter((x) => key(x) !== k);
    done(sel.slice());
  });
  q.addEventListener("input", paint);
  q.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    const n = q.value.trim();
    if (!n) return;
    const hit = everyone.find((p) => p.name.toLowerCase() === n.toLowerCase());
    const p = hit ? { uid: hit.uid, name: hit.name } : { uid: null, name: n };
    if (!sel.some((x) => key(x) === key(p))) { sel.push(p); done(sel.slice()); }
    q.value = "";
    paint();
  });
  paint();
  q.focus();
  return el;
}

/* Choose one of a few values. */
export function pickOne(anchor, options, current, done) {
  const el = pop(anchor, options.map((o) => {
    const v = typeof o === "string" ? o : o.value;
    const label = typeof o === "string" ? (o || "None") : o.label;
    return `<div class="po-row${v === current ? " on" : ""}" data-v="${esc(v)}">${label}</div>`;
  }).join(""), 200);
  el.addEventListener("click", (ev) => {
    const r = ev.target.closest(".po-row");
    if (!r) return;
    closePop();
    done(r.dataset.v);
  });
  return el;
}

/* A date, with "clear". */
export function pickDate(anchor, current, done) {
  const el = pop(anchor, `<input type="date" class="pd-in" value="${esc((current || "").slice(0, 10))}">`
    + `<div class="pd-quick"><button data-d="0">Today</button><button data-d="1">Tomorrow</button>`
    + `<button data-d="7">+1 week</button><button data-d="x" class="ghost">Clear</button></div>`, 230);
  const inp = el.querySelector(".pd-in");
  inp.addEventListener("change", () => { closePop(); done(inp.value || ""); });
  el.querySelector(".pd-quick").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    closePop();
    done(b.dataset.d === "x" ? "" : addDays(today(), Number(b.dataset.d)));
  });
  setTimeout(() => { try { inp.showPicker && inp.showPicker(); } catch (e) {} }, 30);
  return el;
}

/* A modal with a form; resolves with the form element on OK, null on cancel. */
export function modal(title, bodyHtml, okLabel) {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "t-modal-back";
    back.innerHTML = `<form class="t-modal" onsubmit="return false"><h3>${esc(title)}</h3>${bodyHtml}`
      + `<div class="t-modal-foot"><span class="t-modal-msg muted"></span><span class="spacer"></span>`
      + `<button type="button" class="ghost" data-x>Cancel</button><button type="submit" class="primary">${esc(okLabel || "OK")}</button></div></form>`;
    document.body.appendChild(back);
    const form = back.querySelector("form");
    const end = (v) => { back.remove(); resolve(v); };
    back.querySelector("[data-x]").onclick = () => end(null);
    back.addEventListener("pointerdown", (ev) => { if (ev.target === back) end(null); });
    form.addEventListener("keydown", (ev) => { if (ev.key === "Escape") end(null); });
    form.onsubmit = () => { end(form); return false; };
    const first = form.querySelector("input, textarea, select");
    if (first) setTimeout(() => first.focus(), 20);
  });
}

/* Grey placeholder rows while a list loads (style.css .lwk-skel). */
export function skeleton(rows = 6, label = "Loading") {
  const widths = [62, 44, 78, 55, 70, 38, 66, 50];
  let h = `<div class="lwk-skel-wrap" role="status" aria-label="${label}">`;
  for (let i = 0; i < rows; i++) {
    h += `<div class="lwk-skel-row"><span class="lwk-skel dot"></span><span class="lwk-skel" style="width:${widths[i % widths.length]}%"></span>`
      + `<span class="lwk-skel" style="width:${10 + (i * 7) % 14}%;margin-left:auto"></span></div>`;
  }
  return h + `</div>`;
}

export function toast(msg, bad) {
  const t = document.createElement("div");
  t.className = "t-toast" + (bad ? " bad" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("on"), 10);
  setTimeout(() => { t.classList.remove("on"); setTimeout(() => t.remove(), 300); }, bad ? 5000 : 2500);
}

/* Lark's "Completion method", in words. */
export const METHOD_OPTS = [
  { value: "OR", label: "<b>OR</b> &nbsp;<small>done when <u>any</u> owner completes it</small>" },
  { value: "AND", label: "<b>AND</b> &nbsp;<small>every owner completes their own part</small>" },
];
export const isMethod = (f) => f && f.name.trim().toLowerCase() === "completion method";
