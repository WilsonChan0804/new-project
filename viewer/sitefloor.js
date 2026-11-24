/* Site study, stage 4: the typical floor of a domestic massing group - its
 * unit mix laid along a double-loaded corridor with a core of staircases,
 * lifts, a refuse room and an E&M riser (floorcore.js), drawn on the group's
 * floor plate, with the floor's GFA, concessions and the checks. The
 * settings are kept on the massing group (g.floor); "Use in Massing" sets
 * the group's GFA % from the layout.
 */
import * as FC from "./floorcore.js";
import * as M from "./massingcore.js";
import * as UC from "./unitcore.js";
import { toast } from "./tasks-util.js";
import * as PZ from "./planzoom.js";

const $ = (s, r = document) => r.querySelector(s);
const cap = (el, ev) => { try { el.setPointerCapture(ev.pointerId); } catch (e) { /* a synthetic or finished pointer */ } };
const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f0 = (x) => (x == null || isNaN(x) ? "–" : Math.round(x).toLocaleString("en-GB"));
const f1 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const f2 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

let C = null, ON = false, SEL = null, LAST = null;
let PSEL = null;          // the selected unit on the plan: index into LAST.placed
let SWAP = false;         // the next unit tapped swaps with the selected one
let FH = [], FI = -1, FKEY = null;   // undo history of the group's floor settings
const ZM = PZ.create();
let SC = 10, OX = 0, OY = 0, X0 = 0, Y0 = 0;

export function init(ctx) {
  C = ctx;
  const P = $("#st-fpanel");
  P.addEventListener("change", onChange);
  P.addEventListener("click", onClick);
  P.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches("input")) ev.target.blur(); });
  window.addEventListener("resize", () => ON && drawPlan());
  wirePlan();
  document.addEventListener("keydown", (ev) => {
    if (!ON || !(ev.ctrlKey || ev.metaKey) || ev.target.closest("input,select,textarea")) return;
    const k = ev.key.toLowerCase();
    if (k === "z" && !ev.shiftKey) { ev.preventDefault(); undo(-1); }
    if (k === "y" || (k === "z" && ev.shiftKey)) { ev.preventDefault(); undo(1); }
  });
}
/* the floor settings' history, per floor group */
function snapF(x) {
  if (FKEY !== x.key) { FH = []; FI = -1; FKEY = x.key; }
  const j = JSON.stringify(x.g.floor || {}); if (FH[FI] === j) return;
  FH = FH.slice(0, FI + 1); FH.push(j); if (FH.length > 60) FH.shift(); FI = FH.length - 1;
}
function undo(step) {
  const x = cur(); if (!x || !C.can()) return;
  snapF(x);
  const k = FI + step; if (k < 0 || k >= FH.length) return toast(step < 0 ? "Nothing to undo" : "Nothing to redo");
  FI = k; x.b.groups[x.gi].floor = JSON.parse(FH[FI]); PSEL = null; C.save(); render();
}
/* an edit of the floor's units: the automatic layout is taken as it stands first */
function edit(fn) {
  const x = cur(); if (!x || !LAST || !C.can()) return;
  snapF(x);
  const g = x.b.groups[x.gi], f = g.floor = g.floor || {};
  if (!f.seq) f.seq = JSON.parse(JSON.stringify(LAST.seq));
  const keep = fn(f.seq, f);
  snapF(x); C.save();
  if (keep == null) PSEL = null; else PSEL = keep;
  render();
}
/* the placed unit's entry in the edited order */
const entryOf = (q) => ({ band: q.band, i: q.si });
export function show(on) {
  ON = on;
  $("#st-fpanel").hidden = !on;
  $("#st-fplan").hidden = !on;
  document.body.classList.toggle("st-floors", on);
  if (on) render();
}

/* the domestic groups with their plates (metres about the site's centroid) */
function groups() {
  const s = C.study(), m = s.massing || {}, out = [];
  if (!s.pts || s.pts.length < 3) return out;
  const o = C.S.centroid(s.pts), xy = (fp) => (fp && fp.length >= 3 ? C.S.toXY(fp, o) : null);
  const model = { blocks: (m.blocks || []).map((b) => Object.assign({}, b, { fp: xy(b.fp) || [], groups: (b.groups || []).map((g) => Object.assign({}, g, { fp: xy(g.fp) })) })) };
  const bld = M.buildings(model);
  for (const [bi, b] of (m.blocks || []).entries()) {
    const B = bld.find((x) => x.blocks.includes(b.id));
    const top = B ? Math.max(0, ...B.storeys.filter((q) => q.storey).map((q) => q.no || 0)) : 0;
    for (const [gi, g] of (b.groups || []).entries()) {
      const isDom = g.use === "dom" || (Array.isArray(g.parts) && g.parts.some((q) => q.use === "dom"));
      if (!isDom) continue;
      const fp = xy(g.fp) || xy(b.fp);
      if (!fp) continue;
      out.push({ key: b.id + "." + gi, bi, gi, b, g, fp, top, label: `${b.name || "Block " + (bi + 1)} · ${g.n} × ${M.USES[g.use] ? M.USES[g.use].label : g.use}${(g.mix || []).length ? "" : " (no unit mix)"}` });
    }
  }
  return out;
}
const units = () => { const s = C.study(); return (s.units && Array.isArray(s.units.list)) ? s.units.list : []; };
function cur(list) { const L = list || groups(); return L.find((x) => x.key === SEL) || L.find((x) => (x.g.mix || []).length) || L[0] || null; }
const opts = (x) => Object.assign({}, FC.DEF, { storeyH: Number(x.g.h) || FC.DEF.storeyH }, x.g.floor || {});

function compute(x) {
  const list = units(), mix = [];
  for (const q of x.g.mix || []) { const u = list.find((v) => v.name === q.u); if (u) mix.push({ u, n: Number(q.n) || 0 }); }
  const o = opts(x);
  return FC.layout(Object.assign({}, o, { poly: x.fp, mix, lib: list, storeys: Number(x.g.n) || 1, floorsAbove: x.top || Number(x.g.n) || 1 }));
}

/* ---------- the panel */
function render() {
  if (!ON) return;
  const P = $("#st-fpanel"), list = groups(), x = cur(list), can = C.can(), dis = can ? "" : " disabled";
  if (!x) {
    P.innerHTML = `<div class="st-card"><h3>4 · Floors</h3><p class="st-note">Draw a block in <b>2 · Massing</b> with a domestic floor group, and give it a <b>unit mix</b> (units from <b>3 · Units</b>). Its typical floor is laid out here: the units along a corridor, the staircases, lifts, refuse room and E&M riser, and the floor's GFA and concessions.</p></div>`;
    $("#st-fplan").innerHTML = `<div class="un-empty">No domestic floor group yet.</div>`;
    LAST = null; return;
  }
  SEL = x.key;
  const r = LAST = compute(x), o = opts(x);
  const num = (k, step, v, ttl, w = 56) => `<input type="number" step="${step}" data-fo="${k}" value="${esc(v)}" title="${esc(ttl)}" style="width:${w}px"${dis}>`;
  const mixTxt = (x.g.mix || []).map((q) => `${esc(q.u)} × ${esc(q.n)}`).join(", ") || "no unit mix: add one in 2 · Massing";
  let h = `<div class="st-card"><h3>4 · Floors <small>a typical floor</small></h3>
    <label class="st-lbl">Floor group <select data-fsel>${list.map((q) => `<option value="${esc(q.key)}"${q.key === x.key ? " selected" : ""}>${esc(q.label)}</option>`).join("")}</select></label>
    <p class="st-note">Unit mix a floor: ${mixTxt}. ${x.g.n} floors at ${f2(Number(x.g.h))} m; the building has ${x.top} storeys.</p></div>`;
  if (!r) { P.innerHTML = h + `<div class="st-card"><p class="st-note">This floor group has no floor plate.</p></div>`; drawPlan(); return; }
  const F = r.figures, accNow = x.g.acc == null || x.g.acc === "" ? (M.USES[x.g.use] || M.USES.dom).acc : Number(x.g.acc);
  h += `<div class="st-card"><div class="st-bigs"><div class="st-big"><b>${F.units}</b><span>flats a floor</span></div><div class="st-big"><b>${f1(F.gfa)} m²</b><span>floor GFA</span></div><div class="st-big"><b>${f1(F.acc)}%</b><span>GFA ÷ plate (Massing ${f1(accNow)}%)</span></div><div class="st-big"><b>${f1(F.efficiency)}%</b><span>saleable ÷ GFA</span></div></div>
    <table class="ms-fig">
      <tr><td>Floor plate</td><td>${f1(F.plate)} m²</td><td>${f1(r.L)} × ${f1(r.D)} m</td></tr>
      <tr><td>Units (GFA)</td><td>${f1(F.unitGfa)} m²</td><td>saleable ${f1(F.saleable)} m²</td></tr>
      <tr><td>Corridor</td><td>${f1(F.corridor)} m²</td><td>${f2(r.cw)} m wide${F.wideEx ? ` · ${f1(F.wideEx)} m² exempt (wider corridor, JPN 1)` : ""}</td></tr>
      <tr><td>Staircases</td><td>${f1(F.stair)} m²</td><td>${r.nS} × ${o.stairWidth} mm</td></tr>
      <tr><td>Lift shafts</td><td>${f1(F.lift)} m²</td><td>${r.nL} lifts</td></tr>
      <tr><td>Refuse room</td><td>${f1(F.refuse)} m²</td><td>exempt (APP-151 item 2.1)</td></tr>
      <tr><td>E&M riser</td><td>${f1(F.riser)} m²</td><td>exempt (items 2.2, 21)</td></tr>
      <tr><td>Residual → E&M</td><td>${f1(F.residual)} m²</td><td>taken as exempt E&M - check its use${F.plate && F.residual / F.plate > 0.1 ? ` · <b class="bad">${f0(F.residual / F.plate * 100)}% of the plate</b>: a ${f1(2 * r.deep + r.cw)} m deep plate fits these units` : ""}</td></tr>
      <tr><td>Units' concessions</td><td>${f1(F.unitEx)} m²</td><td>balcony, UP, A/C platform, façade</td></tr>
      ${F.mic ? `<tr><td>MiC</td><td>${f1(F.mic)} m²</td><td>${o.micPct}% of the floor's GFA (JPN 8 - check)</td></tr>` : ""}
    </table>
    ${can ? `<div class="st-row"><button type="button" class="primary st-ib" data-fuse title="Set the group's GFA % to the layout's">Use ${f1(F.acc)}% in Massing</button></div>` : ""}</div>`;
  h += `<div class="st-card"><h3>Edit the floor</h3>
    <p class="st-note">Tap a unit on the plan to flip it, move it along the corridor, send it to the other side, swap it with another or take it off this floor; or drag it onto another unit to swap them, onto a gap to move it there.</p>
    ${r.note ? `<p class="st-note warn">${esc(r.note)}. <button type="button" class="ghost st-ib" data-freset>Reset to the mix</button></p>` : ""}
    <div class="st-row"><label class="st-chk"><input type="checkbox" data-fo="corners"${o.corners ? " checked" : ""}${dis}> Corner units at the ends</label>
    ${can ? `<select data-fadd><option value="">+ Add a unit …</option>${units().map((u) => `<option>${esc(u.name)}</option>`).join("")}</select>` : ""}
    ${can && r.edited ? `<button type="button" class="ghost st-ib" data-freset>Reset to automatic</button>` : ""}
    ${can ? `<button type="button" class="ghost st-ib" data-fundo="-1" title="Undo (Ctrl+Z)">↶</button><button type="button" class="ghost st-ib" data-fundo="1" title="Redo (Ctrl+Y)">↷</button>` : ""}</div>
    ${r.cornerFac ? `<p class="st-note">Corner units: ${f1(r.cornerFac)} m of end wall as a second façade.</p>` : ""}</div>`;
  h += `<div class="st-card"><h3>Checks</h3><ul class="fl-checks">${r.checks.map((c) => `<li class="${c.ok ? "ok" : "bad"}"><b>${c.ok ? "✓" : "✗"} ${esc(c.what)}</b><br><small>${esc(c.text)}</small></li>`).join("")}</ul>
    ${r.left.length ? `<ul class="un-warn">${[...new Set(r.left.map((q) => q.why))].map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}</div>`;
  h += `<div class="st-card"><h3>Core and corridor</h3><div class="fl-set">
    <label>Corridor ${num("corridor", 0.05, o.corridor, "Clear width, m")} m</label>
    <label>Core <select data-fo="core"${dis}><option value="middle"${o.core === "middle" ? " selected" : ""}>in the middle</option><option value="ends"${o.core === "ends" ? " selected" : ""}>staircases at the ends</option></select></label>
    <label>Staircases ${num("stairs", 1, o.stairs, "How many", 44)} × ${num("stairWidth", 50, o.stairWidth, "Width, mm", 64)} mm</label>
    <label>Lifts ${num("lifts", 1, o.lifts || "", "Leave empty: by service time", 44)} <small>(auto ${r.lifts.n})</small></label>
    <label>Persons a flat ${num("persons", 0.5, o.persons, "For the lifts", 44)}</label>
    <label>5-min capacity ${num("hc5", 0.5, o.hc5, "% of the population", 44)}% · interval ≤ ${num("interval", 5, o.interval, "s", 44)} s</label>
    <label>Wider corridor exempt from ${num("wideBase", 0.05, o.wideBase, "m (JPN 1 - check)", 50)} to ${num("wideMax", 0.05, o.wideMax, "m", 50)} m</label>
    <label><input type="checkbox" data-fo="mic"${o.mic ? " checked" : ""}${dis}> MiC (JPN 8) ${num("micPct", 0.5, o.micPct, "% of the GFA, check", 44)}%</label>
    </div>
    <p class="st-note">Lifts: round trip ${r.lifts.rtt} s (${r.lifts.stops} stops, reversal ${f1(r.lifts.reversal)} floors, ${r.lifts.speed} m/s over ${f1(r.lifts.travel)} m), ${r.lifts.population} persons; CIBSE Guide D. Staircases from the GBP workbook's quick check (Table B1 / B3).</p></div>`;
  P.innerHTML = h;
  drawPlan();
}

function onChange(ev) {
  const t = ev.target, list = groups(), x = cur(list);
  if (t.dataset.fsel != null) { SEL = t.value; PSEL = null; PZ.reset(ZM); return render(); }
  if (t.dataset.fadd != null) {
    const nm = t.value; if (!nm || !LAST) return;
    // to the side with the most corridor left
    const used = (b) => LAST.placed.filter((q) => q.band === b).reduce((s2, q) => s2 + q.w, 0);
    const band = LAST.L - used("s") >= LAST.L - used("n") - LAST.core.reduce((s2, c) => s2 + c.w, 0) ? "s" : "n";
    return edit((seq) => { seq[band].push({ u: nm, m: false }); });
  }
  if (!x || !C.can()) return;
  const k = t.dataset.fo; if (!k) return;
  const g = x.b.groups[x.gi], f = g.floor = g.floor || {};
  snapF(x);
  if (k === "mic" || k === "corners") f[k] = t.checked;
  else if (k === "core") f.core = t.value;
  else if (t.value === "") delete f[k];
  else f[k] = Math.max(0, parseFloat(t.value));
  snapF(x); C.save(); render();
}
function onClick(ev) {
  const t = ev.target.closest("button"); if (!t) return;
  if (t.dataset.fundo) return undo(+t.dataset.fundo);
  if (t.dataset.freset != null) { const x = cur(); if (!x || !C.can()) return; snapF(x); const f = x.b.groups[x.gi].floor || {}; delete f.seq; snapF(x); C.save(); PSEL = null; return render(); }
  if (t.dataset.fuse != null && LAST) {
    const x = cur(); if (!x) return;
    x.b.groups[x.gi].acc = Math.round(LAST.figures.acc * 10) / 10;
    C.save(); toast(`GFA % ${x.b.groups[x.gi].acc} set on the floor group in Massing`); render();
  }
}

/* ---------- the plan */
const KC = { LD: "#c6d9ef", MBR: "#d5e4f5", BR: "#d5e4f5", OKIT: "#f4e3c6", KIT: "#f4e3c6", BATH: "#d6eee8", ENS: "#d6eee8", LOBBY: "#e7eaee", STORE: "#e7eaee" };
let DRAG = null;           // a unit being dragged: {i, x, y, dx, dy, moved} (px)
function drawPlan() {
  const host = $("#st-fplan"), r = LAST;
  if (!r) { if (!host.innerHTML) host.innerHTML = `<div class="un-empty">Choose a floor group.</div>`; return; }
  const bw = host.clientWidth || 900, bh = host.clientHeight || 700;
  const xs = r.F.poly.map((p) => p[0]), ys = r.F.poly.map((p) => p[1]);
  X0 = Math.min(0, ...xs); Y0 = Math.min(0, ...ys);
  const W = Math.max(r.L, ...xs) - X0, H = Math.max(r.D, ...ys) - Y0;
  const mg = Math.max(24, Math.min(70, 0.08 * Math.min(bw, bh)));
  const fit = Math.max(1, Math.min((bw - 2 * mg) / W, (bh - 2 * mg - 40) / H));
  ({ SC, OX, OY } = PZ.apply(ZM, fit, (bw - W * fit) / 2, (bh - H * fit) / 2 + 10, bw, bh));
  const sx = (x) => OX + (x - X0) * SC, sy = (y) => OY + (y - Y0) * SC;
  const fs = Math.max(7, Math.min(12, SC * 0.5));
  let g = `<polygon points="${r.F.poly.map((p) => sx(p[0]) + "," + sy(p[1])).join(" ")}" fill="#fbf3dc" stroke="#7a6a3a" stroke-width="1.5" />`;
  g += `<text x="${sx(r.L) - 4}" y="${sy(r.D) - 4}" text-anchor="end" font-size="${fs}" fill="#8a7a4a">residual → E&amp;M</text>`;
  g += `<rect x="${sx(0)}" y="${sy(r.y0)}" width="${r.L * SC}" height="${r.cw * SC}" fill="#eceff3" stroke="#9aa5b1" stroke-width="0.8" /><text x="${sx(r.L / 2)}" y="${sy(r.y0 + r.cw / 2) + fs / 3}" text-anchor="middle" font-size="${fs}" fill="#5b6b7b">CORRIDOR ${f2(r.cw)} m</text>`;
  for (const c of r.core) {
    const X = sx(c.x), Y = sy(c.y), w = c.w * SC, h = c.h * SC;
    const fill = c.kind === "stair" ? "#ffe0c2" : c.kind === "lift" ? "#dad7f0" : c.kind === "refuse" ? "#e3e7d3" : "#f1d6d6";
    g += `<rect x="${X}" y="${Y}" width="${w}" height="${h}" fill="${fill}" stroke="#333" stroke-width="1.2" />`;
    if (c.kind === "stair") { const k = 7; for (let i = 1; i < k; i++) g += `<line x1="${X + 2}" y1="${Y + h * i / k}" x2="${X + w / 2 - 1}" y2="${Y + h * i / k}" stroke="#a5642a" stroke-width="0.6" /><line x1="${X + w / 2 + 1}" y1="${Y + h * i / k}" x2="${X + w - 2}" y2="${Y + h * i / k}" stroke="#a5642a" stroke-width="0.6" />`; }
    if (c.kind === "lift") g += `<line x1="${X}" y1="${Y}" x2="${X + w}" y2="${Y + h}" stroke="#555" stroke-width="0.6" /><line x1="${X + w}" y1="${Y}" x2="${X}" y2="${Y + h}" stroke="#555" stroke-width="0.6" />`;
    if (w > fs * 2.5) g += `<text x="${X + w / 2}" y="${Y + h / 2 + 4}" text-anchor="middle" font-size="${fs - 1}" font-weight="700" fill="#222" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(c.label)}</text>`;
  }
  const tgt = DRAG && DRAG.moved ? dropTarget(DRAG) : null;
  for (const [pi, q] of r.placed.entries()) {
    const dg = DRAG && DRAG.moved && DRAG.i === pi, ox = q.x + (dg ? DRAG.dx / SC : 0), oy = q.y + (dg ? DRAG.dy / SC : 0);
    const sel = PSEL === pi, hot = tgt && tgt.pi === pi;
    g += `<g${dg ? ' opacity="0.75"' : ""}>`;
    for (const e of q.extras) g += `<rect x="${sx(ox + e.x)}" y="${sy(oy + e.y)}" width="${e.w * SC}" height="${e.h * SC}" fill="#dfe9f3" stroke="#3c4650" stroke-width="0.8" stroke-dasharray="4 2" />`;
    for (const rm of q.rooms) g += `<rect x="${sx(ox + rm.x)}" y="${sy(oy + rm.y)}" width="${rm.w * SC}" height="${rm.h * SC}" fill="${KC[rm.kind] || "#c6d9ef"}" stroke="#4a5866" stroke-width="0.7" />`;
    g += `<rect x="${sx(ox)}" y="${sy(oy)}" width="${q.w * SC}" height="${q.h * SC}" fill="${hot ? "rgba(242,128,34,.22)" : "none"}" stroke="${sel || hot ? "#f28022" : "#111"}" stroke-width="${sel || hot ? 3 : 2}" />`;
    if (q.corner) { const X = sx(q.corner === "w" ? ox : ox + q.w); g += `<line x1="${X}" y1="${sy(oy)}" x2="${X}" y2="${sy(oy + q.h)}" stroke="#2b6c8f" stroke-width="4" />`; }
    if (q.w * SC > fs * 5) g += `<text x="${sx(ox + q.w / 2)}" y="${sy(oy + q.h / 2)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="#1f2a36" paint-order="stroke" stroke="#fff" stroke-width="3" pointer-events="none">${esc(q.name || "Unit")}${q.m && !/mirrored/.test(q.name || "") ? " ⇋" : ""}</text>
      <text x="${sx(ox + q.w / 2)}" y="${sy(oy + q.h / 2) + fs + 2}" text-anchor="middle" font-size="${fs - 1}" fill="#3c4650" paint-order="stroke" stroke="#fff" stroke-width="3" pointer-events="none">${f1(q.fig.saleable)} m² · ${f2(q.w)} m</text>`;
    g += `<rect class="fl-u" data-pi="${pi}" x="${sx(ox)}" y="${sy(oy)}" width="${q.w * SC}" height="${q.h * SC}" fill="transparent" /></g>`;
  }
  const dim = (x1, y1, x2, y2, t, vert) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#555" stroke-width="0.8" /><text x="${(x1 + x2) / 2 + (vert ? -6 : 0)}" y="${(y1 + y2) / 2 + (vert ? 0 : -4)}" text-anchor="middle" font-size="${fs}" fill="#333"${vert ? ` transform="rotate(-90 ${(x1 + x2) / 2 - 6} ${(y1 + y2) / 2})"` : ""}>${t}</text>`;
  g += dim(sx(0), sy(0) - 14, sx(r.L), sy(0) - 14, f2(r.L) + " m");
  g += dim(sx(0) - 14, sy(0), sx(0) - 14, sy(r.D), f2(r.D) + " m", true);
  const F = r.figures;
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}" font-family="'Noto Sans HK', 'PingFang HK', sans-serif">${g}
    <text x="12" y="${bh - 12}" font-size="12" fill="#5b6b7b">${F.units} flats · GFA ${f1(F.gfa)} m² of ${f1(F.plate)} m²${SWAP ? " · tap the unit to swap with" : ""}</text></svg>${pop(r, sx, sy, bw, bh)}${PZ.bar(document.body.classList.contains("st-planfull"))}`;
}
/* the small menu by the selected unit */
function pop(r, sx, sy, bw, bh) {
  const q = PSEL != null && r.placed[PSEL]; if (!q || !C.can() || DRAG) return "";
  const L = Math.max(8, Math.min(sx(q.x), bw - 330)), T = Math.max(8, Math.min(q.band === "s" ? sy(q.y + q.h) + 8 : sy(q.y) - 50, bh - 90));
  return `<div class="fl-pop" style="left:${Math.round(L)}px;top:${Math.round(T)}px"><b>${esc(q.name)}</b>
    <button type="button" data-fu="flip" title="Mirror it left to right">⇋ Flip</button><button type="button" data-fu="left" title="One place towards the left">◀</button><button type="button" data-fu="right" title="One place towards the right">▶</button>
    <button type="button" data-fu="side">⇅ Other side</button><button type="button" data-fu="swap" class="${SWAP ? "on" : ""}">Swap with…</button><button type="button" data-fu="del">Remove</button></div>`;
}
const toPlan = (ev) => { const b = $("#st-fplan").getBoundingClientRect(); return [X0 + (ev.clientX - b.left - OX) / SC, Y0 + (ev.clientY - b.top - OY) / SC]; };
/* where a dragged unit lands: on another unit (swap), or a place along a side (move) */
function dropTarget(d) {
  const r = LAST, q = r.placed[d.i], cx = q.x + q.w / 2 + d.dx / SC, cy = q.y + q.h / 2 + d.dy / SC;
  const pi = r.placed.findIndex((o, k) => k !== d.i && cx >= o.x && cx <= o.x + o.w && cy >= o.y && cy <= o.y + o.h);
  if (pi >= 0) return { pi };
  const band = cy > r.y0 + r.cw / 2 ? "s" : "n";
  // the place: after every unit of that side whose middle is left of the drop
  const along = r.placed.filter((o, k) => k !== d.i && o.band === band).sort((a, b) => a.x - b.x);
  const before = along.filter((o) => o.x + o.w / 2 < cx);
  return { band, after: before.length ? before[before.length - 1] : null };
}
function swapEntries(seq, a, b) { const t = seq[a.band][a.i]; seq[a.band][a.i] = seq[b.band][b.i]; seq[b.band][b.i] = t; }
function moveEntry(seq, from, band, afterEntry) {
  const e = seq[from.band][from.i]; seq[from.band][from.i] = null;
  let k = afterEntry ? afterEntry.i + 1 : 0;
  seq[band].splice(k, 0, e);
  for (const b of ["s", "n"]) seq[b] = seq[b].filter(Boolean);
}
function unitAction(k) {
  const r = LAST, q = r && r.placed[PSEL]; if (!q) return;
  if (k === "swap") { SWAP = !SWAP; return drawPlan(); }
  const me = entryOf(q);
  if (k === "flip") return edit((seq) => { seq[me.band][me.i].m = !seq[me.band][me.i].m; return PSEL; });
  if (k === "del") return edit((seq) => { seq[me.band].splice(me.i, 1); });
  if (k === "side") return edit((seq) => { const [e] = seq[me.band].splice(me.i, 1); seq[me.band === "s" ? "n" : "s"].push(e); });
  if (k === "left" || k === "right") {
    const along = r.placed.filter((o) => o.band === q.band).sort((a, b) => a.x - b.x), at = along.indexOf(q), o = along[at + (k === "left" ? -1 : 1)];
    if (!o) return toast(k === "left" ? "It is the first along this side" : "It is the last along this side");
    const ob = entryOf(o);
    return edit((seq) => { swapEntries(seq, me, ob); return r.placed.indexOf(o); });
  }
}
function wirePlan() {
  const host = $("#st-fplan");
  let pan = null;
  host.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.pz) return PZ.barClick(ZM, b, host.getBoundingClientRect(), drawPlan);
    if (b.dataset.fu) return unitAction(b.dataset.fu);
  });
  host.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest(".pz-bar,.fl-pop")) return;
    if (PZ.down(ZM, ev)) { DRAG = null; pan = null; cap(host, ev); ev.preventDefault(); return drawPlan(); }
    const t = ev.target;
    if (t.dataset.pi != null && LAST) DRAG = { i: +t.dataset.pi, x: ev.clientX, y: ev.clientY, dx: 0, dy: 0, moved: false };
    else pan = { x: ev.clientX, y: ev.clientY, px: ZM.px, py: ZM.py, moved: false };
    cap(host, ev); ev.preventDefault();
  });
  host.addEventListener("pointermove", (ev) => {
    if (PZ.move(ZM, ev, host.getBoundingClientRect())) return drawPlan();
    if (pan) { const dx = ev.clientX - pan.x, dy = ev.clientY - pan.y; if (!pan.moved && Math.hypot(dx, dy) < 4) return; pan.moved = true; ZM.px = pan.px + dx; ZM.py = pan.py + dy; return drawPlan(); }
    if (DRAG) { const dx = ev.clientX - DRAG.x, dy = ev.clientY - DRAG.y; if (!DRAG.moved && Math.hypot(dx, dy) < 6) return; if (!C.can()) return; DRAG.moved = true; DRAG.dx = dx; DRAG.dy = dy; drawPlan(); }
  });
  const end = (ev) => {
    PZ.up(ZM, ev);
    if (pan) { const p = pan; pan = null; if (!p.moved) { PSEL = null; SWAP = false; } return drawPlan(); }
    if (!DRAG) return;
    const d = DRAG; DRAG = null;
    const r = LAST, q = r.placed[d.i]; if (!q) return drawPlan();
    if (!d.moved) {
      if (SWAP && PSEL != null && PSEL !== d.i) { const a = entryOf(r.placed[PSEL]), b = entryOf(q); SWAP = false; return edit((seq) => { swapEntries(seq, a, b); }); }
      PSEL = PSEL === d.i ? null : d.i; SWAP = false; return drawPlan();
    }
    const tg = dropTarget(d), me = entryOf(q);
    if (tg.pi != null) return edit((seq) => { swapEntries(seq, me, entryOf(r.placed[tg.pi])); });
    return edit((seq) => { moveEntry(seq, me, tg.band, tg.after ? entryOf(tg.after) : null); });
  };
  host.addEventListener("pointerup", end);
  host.addEventListener("pointercancel", end);
  host.addEventListener("wheel", (ev) => { if (ev.target.closest(".fl-pop,.pz-bar")) return; ev.preventDefault(); if (PZ.wheel(ZM, ev, host.getBoundingClientRect())) drawPlan(); }, { passive: false });
}
export function refresh() { if (ON) render(); }
void UC;
