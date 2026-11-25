/* Keyboard shortcuts: a table of a page's keys, opened with "?" or its ⌨ button.
 *
 * A page lists its actions {id, key, label, group, run | sel}; the keys of those
 * can be changed in the table (click the key, press the new one) and are kept in
 * this browser (localStorage, one entry for all the site study's pages). Fixed
 * keys (Ctrl+Z, Delete, Esc ...) are listed too, read only.
 */
const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const STORE = "lwk.keys.site";

/* the key pressed, as stored: "w", "shift+r", "alt+3" (Ctrl combinations are not offered: the fixed ones use them) */
export function keyOf(ev) {
  const k = ev.key || "";
  if (k.length === 1 && /[\x20-\x7e]/.test(k)) return k.toLowerCase();
  const c = ev.code || "";
  if (k === "Process" || k === "Unidentified" || k.length === 1 || !k) {
    let m = /^Key([A-Z])$/.exec(c);
    if (m) return m[1].toLowerCase();
    m = /^(?:Digit|Numpad)(\d)$/.exec(c);
    if (m) return m[1];
    if (c === "Space") return " ";
  }
  return k.toLowerCase();
}
export function keyName(ev) {
  const k = keyOf(ev);
  if (k === "shift" || k === "alt" || k === "control" || k === "meta") return "";
  // a shifted printable key is its own character ("?" not "shift+/")
  return (ev.altKey ? "alt+" : "") + (ev.shiftKey && k.length > 1 ? "shift+" : "") + k;
}
/* as shown: "W", "Shift+R", "Space" */
export function show(k) {
  if (!k) return "";
  return k.split("+").map((p) => (p === " " ? "Space" : p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join("+");
}

function saved() { try { return JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch (e) { return {}; } }
function save(all) { try { localStorage.setItem(STORE, JSON.stringify(all)); } catch (e) { /* private window: for this visit only */ } }

const PAGES = {};
/* a page's keys: its actions with the user's keys over the defaults */
export function keysOf(page) {
  const P = PAGES[page]; if (!P) return {};
  const mine = saved()[page] || {}, out = {};
  for (const a of P.actions) out[a.id] = mine[a.id] != null ? mine[a.id] : a.key || "";
  return out;
}
export const keyFor = (page, id) => show(keysOf(page)[id]);

/* register a page: on() says when its keys apply; actions [{id, key, label, group, run() | sel}];
   fixed [{keys, label, group}] are listed only (the page handles them itself) */
export function register(page, on, actions, fixed, title) {
  PAGES[page] = { on, actions, fixed: fixed || [], title: title || page };
  if (!register.wired) { register.wired = true; document.addEventListener("keydown", onKey); }
}
function onKey(ev) {
  if (ev.ctrlKey || ev.metaKey || document.querySelector(".ks-modal")) return;
  const t = ev.target; if (t && t.closest && t.closest("input,textarea,select,[contenteditable=true]")) return;
  const page = Object.keys(PAGES).find((p) => PAGES[p].on()); if (!page) return;
  const k = keyName(ev); if (!k) return;
  if (k === "?") { ev.preventDefault(); return openPage(page); }
  const ks = keysOf(page), a = PAGES[page].actions.find((x) => ks[x.id] === k); if (!a) return;
  const r = a.run ? a.run(ev) : (() => { const el = document.querySelector(a.sel); if (!el) return false; el.click(); })();
  if (r !== false) { ev.preventDefault(); ev.stopImmediatePropagation(); }
}
/* the table for a registered page (its keys editable) */
export function openPage(page) {
  const P = PAGES[page]; if (!P) return;
  openSheet(P.title, P.actions, P.fixed, { page });
}

/* the table: actions with ids (editable when opts.page is set), then the fixed keys */
export function openSheet(title, actions, fixed, opts) {
  opts = opts || {};
  document.querySelectorAll(".ks-modal").forEach((m) => m.remove());
  const m = document.createElement("div");
  m.className = "ks-modal"; m.tabIndex = -1;
  const draw = () => {
    const ks = opts.page ? keysOf(opts.page) : {}, groups = [];
    const put = (g, row) => { let G = groups.find((x) => x.g === g); if (!G) groups.push((G = { g, rows: [] })); G.rows.push(row); };
    for (const a of actions || []) put(a.group || "Tools", { id: a.id, label: a.label, key: opts.page ? ks[a.id] : a.key });
    for (const f of fixed || []) put(f.group || "Always", { label: f.label, fixed: f.keys });
    const dup = {}; for (const v of Object.values(ks)) if (v) dup[v] = (dup[v] || 0) + 1;
    m.innerHTML = `<div class="ks-box" role="dialog" aria-label="${esc(title)} shortcuts"><div class="ks-h"><b>⌨ ${esc(title)} · shortcuts</b><span>${opts.page ? "Click a key, then press the new one (Backspace: none)" : ""}</span><button type="button" data-ks="close" title="Close (Esc)">✕</button></div>
      <div class="ks-cols">${groups.map((G) => `<section><h4>${esc(G.g)}</h4><table>${G.rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${r.fixed ? r.fixed.split(" / ").map((k) => `<kbd>${esc(k)}</kbd>`).join(" ") : opts.page ? `<button type="button" class="ks-k${dup[r.key] > 1 ? " ks-dup" : ""}" data-kid="${esc(r.id)}" title="${dup[r.key] > 1 ? "This key is used twice" : "Change"}">${r.key ? esc(show(r.key)) : "—"}</button>` : `<kbd>${esc(show(r.key))}</kbd>`}</td></tr>`).join("")}</table></section>`).join("")}</div>
      <div class="ks-f">${opts.page ? `<button type="button" data-ks="reset">Back to the default keys</button>` : ""}<small>? opens this table</small></div></div>`;
  };
  let wait = null;
  m.addEventListener("click", (ev) => {
    if (ev.target === m) return close();
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.ks === "close") return close();
    if (b.dataset.ks === "reset") { const all = saved(); delete all[opts.page]; save(all); opts.onChange && opts.onChange(); return draw(); }
    if (b.dataset.kid) { wait = b.dataset.kid; m.querySelectorAll(".ks-k").forEach((x) => x.classList.toggle("ks-wait", x === b)); b.textContent = "press a key…"; }
  });
  const onKeyM = (ev) => {
    if (!m.isConnected) return document.removeEventListener("keydown", onKeyM, true);
    ev.stopPropagation();
    if (!wait) { if (ev.key === "Escape") close(); return; }
    ev.preventDefault();
    if (ev.key === "Escape") { wait = null; return draw(); }
    if (ev.ctrlKey || ev.metaKey) return;
    const k = ev.key === "Backspace" || ev.key === "Delete" ? "" : keyName(ev);
    if (k === null || (k === "" && ev.key !== "Backspace" && ev.key !== "Delete") || k === "?") return;
    const all = saved(); all[opts.page] = all[opts.page] || {}; all[opts.page][wait] = k; save(all); wait = null;
    opts.onChange && opts.onChange(); draw();
  };
  // while open, its keys come here first (the page's do not run)
  document.addEventListener("keydown", onKeyM, true);
  const close = () => { m.remove(); document.removeEventListener("keydown", onKeyM, true); opts.onClose && opts.onClose(); };
  draw(); document.body.appendChild(m); m.focus();
  return m;
}
