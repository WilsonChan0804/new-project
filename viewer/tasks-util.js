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

export function toast(msg, bad) {
  const t = document.createElement("div");
  t.className = "t-toast" + (bad ? " bad" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("on"), 10);
  setTimeout(() => { t.classList.remove("on"); setTimeout(() => t.remove(), 300); }, bad ? 5000 : 2500);
}
