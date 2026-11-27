/* Schemes: the massing (with its floors) saved as options A, B, C ... and compared side by side.
 * A scheme is {id, name, at, massing (a copy of the study's), fig (its figures when saved), png (a 3D picture, if one was open)}.
 * Kept in the study (study.schemes), so they are saved with the project as the rest of it.
 */
const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function list(study) { study.schemes = Array.isArray(study.schemes) ? study.schemes : []; return study.schemes; }
/* the next free letter name: Scheme A, B, ... Z, AA */
export function nextName(study) {
  const used = new Set(list(study).map((s) => s.name));
  for (let i = 0; i < 702; i++) { const n = "Scheme " + (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26))); if (!used.has(n)) return n; }
  return "Scheme " + (list(study).length + 1);
}
export function save(study, name, fig, png) {
  const s = { id: "s" + Math.random().toString(36).slice(2, 8), name: name || nextName(study), at: new Date().toISOString(), massing: JSON.parse(JSON.stringify(study.massing || {})), fig: fig || null, png: png || null };
  list(study).push(s); study.schemeOn = s.id;   // the scheme the study is on (the step bar's chip)
  return s;
}
/* the study's massing becomes the scheme's (the scheme kept as it is) */
export function open(study, id) {
  const s = list(study).find((x) => x.id === id); if (!s) return false;
  study.massing = JSON.parse(JSON.stringify(s.massing || {})); study.schemeOn = s.id;
  return true;
}
export function remove(study, id) { const L = list(study), i = L.findIndex((x) => x.id === id); if (i >= 0) L.splice(i, 1); return i >= 0; }
export function duplicate(study, id) { const s = list(study).find((x) => x.id === id); if (!s) return null; const c = JSON.parse(JSON.stringify(s)); c.id = "s" + Math.random().toString(36).slice(2, 8); c.name = s.name + " (copy)"; c.at = new Date().toISOString(); list(study).push(c); return c; }

/* the rows compared: [key, label, unit, better ("hi" | "lo" | null), format] */
export const ROWS = [
  ["gfa", "GFA", "m²", "hi", 0], ["dgfa", "  domestic", "m²", null, 0], ["ngfa", "  non-domestic", "m²", null, 0],
  ["pr", "Plot ratio", "", null, 2], ["sc", "Site coverage", "%", null, 1], ["height", "Height", "m", "lo", 1], ["mpd", "Top", "mPD", "lo", 1], ["storeys", "Storeys", "", null, 0],
  ["flats", "Flats", "", "hi", 0], ["mix", "Mix", "", null, null], ["sale", "Saleable", "m²", "hi", 0], ["avg", "Average saleable", "m²", null, 1],
  ["eff", "Saleable ÷ domestic GFA", "%", "hi", 1], ["capPct", "Concessions (10% cap)", "%", "lo", 1],
];
const fmt = (v, d) => (v == null || v === "" ? "–" : typeof v === "number" ? v.toLocaleString("en-GB", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }) : esc(v));

/* the compare table: cols [{name, fig, png, current}] -> html (each row's best marked) */
export function table(cols) {
  const head = `<tr><th></th>${cols.map((c) => `<th>${c.png ? `<img src="${c.png}" alt="">` : ""}<b>${esc(c.name)}</b>${c.current ? "<small>now</small>" : c.at ? `<small>${esc(String(c.at).slice(0, 10))}</small>` : ""}</th>`).join("")}</tr>`;
  const body = ROWS.map(([k, label, unit, better, d]) => {
    const vals = cols.map((c) => (c.fig ? c.fig[k] : null)), nums = vals.filter((v) => typeof v === "number" && isFinite(v));
    const best = better && nums.length > 1 && new Set(nums).size > 1 ? (better === "hi" ? Math.max(...nums) : Math.min(...nums)) : null;
    return `<tr><td>${esc(label.trim())}${unit ? ` <small>${unit}</small>` : ""}</td>${vals.map((v) => `<td class="${best != null && v === best ? "sch-best" : ""}${label.startsWith("  ") ? " sch-sub" : ""}">${d == null ? esc(v || "–") : fmt(v, d)}</td>`).join("")}</tr>`;
  }).join("");
  return `<table class="sch-t"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

/* the modal: the table, with Open on each saved scheme */
export function compare(cols, onOpen) {
  document.querySelectorAll(".sch-modal").forEach((m) => m.remove());
  const m = document.createElement("div");
  m.className = "sch-modal"; m.tabIndex = -1;
  m.innerHTML = `<div class="sch-box" role="dialog" aria-label="Compare schemes"><div class="sch-h"><b>Compare schemes</b><span>${cols.length} side by side · the best of each row in green</span><button type="button" data-x title="Close (Esc)">✕</button></div>
    <div class="sch-scroll">${table(cols)}</div>
    <div class="sch-f">${cols.filter((c) => c.id).map((c) => `<button type="button" class="ghost" data-open="${esc(c.id)}">Open ${esc(c.name)}</button>`).join("")}</div></div>`;
  const close = () => { m.remove(); document.removeEventListener("keydown", key, true); };
  const key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); close(); } };
  m.addEventListener("click", (ev) => {
    if (ev.target === m || ev.target.closest("[data-x]")) return close();
    const b = ev.target.closest("[data-open]"); if (b) { close(); onOpen && onOpen(b.dataset.open); }
  });
  document.addEventListener("keydown", key, true);
  document.body.appendChild(m); m.focus();
  return m;
}
