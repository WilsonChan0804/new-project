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
let SWAP = false;         // the next unit (or core piece) tapped swaps with the selected one
let CSEL = null;          // the selected core piece: index into LAST.core
const SNAP = () => { try { return localStorage.getItem("lwk-viewer:fl-snap") !== "off"; } catch (e) { return true; } };
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
  const g = x.b.groups[x.gi], j = JSON.stringify({ floor: g.floor || {}, fp: g.fp || null }); if (FH[FI] === j) return;
  FH = FH.slice(0, FI + 1); FH.push(j); if (FH.length > 60) FH.shift(); FI = FH.length - 1;
}
function undo(step) {
  const x = cur(); if (!x || !C.can()) return;
  snapF(x);
  const k = FI + step; if (k < 0 || k >= FH.length) return toast(step < 0 ? "Nothing to undo" : "Nothing to redo");
  FI = k; const v = JSON.parse(FH[FI]), g = x.b.groups[x.gi]; g.floor = v.floor; if (v.fp) g.fp = v.fp; else delete g.fp; PSEL = null; CSEL = null; C.save(); render();
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
/* an edit of the core: the automatic core taken as it stands first */
function editCore(fn) {
  const x = cur(); if (!x || !LAST || !C.can()) return;
  snapF(x);
  const g = x.b.groups[x.gi], f = g.floor = g.floor || {};
  if (!Array.isArray(f.pieces) || !f.pieces.length) f.pieces = JSON.parse(JSON.stringify(LAST.coreOut));
  if (!f.frame) f.frame = LAST.frameAxis;
  const keep = fn(f.pieces, f);
  snapF(x); C.save();
  CSEL = keep == null ? null : keep; PSEL = null;
  render();
}
/* an edit of the floor plate (plate-frame points): written to the floors' own plate - made from the block's when they have none */
function editPlate(fn) {
  const x = cur(); if (!x || !LAST || !C.can()) return;
  snapF(x);
  const g = x.b.groups[x.gi], f = g.floor = g.floor || {};
  if (!f.frame) f.frame = LAST.frameAxis;
  const pts = fn(LAST.F.poly.map((p) => p.slice()));
  if (!pts || pts.length < 3) return;
  const own = !!(g.fp && g.fp.length >= 3);
  g.fp = C.S.fromXY(pts.map((p) => LAST.F.from(p)), x.o);
  if (!own) toast("These floors now have their own floor plate (▱ in Massing); the block's footprint is unchanged");
  snapF(x); C.save(); render();
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
      out.push({ key: b.id + "." + gi, bi, gi, b, g, fp, top, o, label: `${b.name || "Block " + (bi + 1)} · ${g.n} × ${M.USES[g.use] ? M.USES[g.use].label : g.use}${(g.mix || []).length ? "" : " (no unit mix)"}` });
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
    <div class="st-row"><label class="st-chk"><input type="checkbox" data-fsnap${SNAP() ? " checked" : ""}> Snap to the edges near (Alt: no snap)</label>${can ? `<button type="button" class="ghost st-ib" data-ffit title="The plate becomes the rectangle round it, its units and the core">Fit the plate to the units</button>` : ""}</div>
    <p class="st-note">Drag a unit or a core piece (stair, lift, refuse, riser) where it should go - onto another to swap them; tap it for rotate, swap, flip and more. Drag the plate's corners, or its + to add a corner, to reshape the floor plate (these floors get their own plate).</p>
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
  if (t.dataset.fsnap != null) { try { localStorage.setItem("lwk-viewer:fl-snap", t.checked ? "on" : "off"); } catch (e) {} return; }
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
  if (t.dataset.ffit != null) return fitPlate();
  if (t.dataset.freset != null) { const x = cur(); if (!x || !C.can()) return; snapF(x); const f = x.b.groups[x.gi].floor || {}; delete f.seq; snapF(x); C.save(); PSEL = null; return render(); }
  if (t.dataset.fuse != null && LAST) {
    const x = cur(); if (!x) return;
    x.b.groups[x.gi].acc = Math.round(LAST.figures.acc * 10) / 10;
    C.save(); toast(`GFA % ${x.b.groups[x.gi].acc} set on the floor group in Massing`); render();
  }
}

/* ---------- the plan */
const KC = { LD: "#c6d9ef", MBR: "#d5e4f5", BR: "#d5e4f5", OKIT: "#f4e3c6", KIT: "#f4e3c6", BATH: "#d6eee8", ENS: "#d6eee8", LOBBY: "#e7eaee", STORE: "#e7eaee" };
let DRAG = null;           // a drag on the plan: {k: unit|core|vert, i, x, y, dx, dy, moved} (px)
function drawPlan() {
  const host = $("#st-fplan"), r = LAST;
  if (!r) { if (!host.innerHTML) host.innerHTML = `<div class="un-empty">Choose a floor group.</div>`; return; }
  const bw = host.clientWidth || 900, bh = host.clientHeight || 700;
  // the box: the plate, and anything put outside it
  const xs = [...r.F.poly.map((p) => p[0]), ...r.placed.flatMap((q) => [q.x, q.x + q.w]), ...r.core.flatMap((c) => [c.x, c.x + c.w])];
  const ys = [...r.F.poly.map((p) => p[1]), ...r.placed.flatMap((q) => [q.y, q.y + q.h]), ...r.core.flatMap((c) => [c.y, c.y + c.h])];
  if (!DRAG) { X0 = Math.min(0, ...xs); Y0 = Math.min(0, ...ys); drawPlan.W = Math.max(r.L, ...xs) - X0; drawPlan.H = Math.max(r.D, ...ys) - Y0; }
  const W = drawPlan.W, H = drawPlan.H;
  const mg = Math.max(24, Math.min(70, 0.08 * Math.min(bw, bh)));
  const fit = Math.max(1, Math.min((bw - 2 * mg) / W, (bh - 2 * mg - 40) / H));
  ({ SC, OX, OY } = PZ.apply(ZM, fit, (bw - W * fit) / 2, (bh - H * fit) / 2 + 10, bw, bh));
  const sx = (x) => OX + (x - X0) * SC, sy = (y) => OY + (y - Y0) * SC;
  const fs = Math.max(7, Math.min(12, SC * 0.5)), can = C.can();
  const poly = DRAG && DRAG.k === "vert" && DRAG.poly ? DRAG.poly : r.F.poly;
  let g = `<polygon points="${poly.map((p) => sx(p[0]) + "," + sy(p[1])).join(" ")}" fill="#fbf3dc" stroke="#7a6a3a" stroke-width="1.5" />`;
  g += `<text x="${sx(r.L) - 4}" y="${sy(r.D) - 4}" text-anchor="end" font-size="${fs}" fill="#8a7a4a">residual → E&amp;M</text>`;
  g += `<rect x="${sx(0)}" y="${sy(r.y0)}" width="${r.L * SC}" height="${r.cw * SC}" fill="#eceff3" stroke="#9aa5b1" stroke-width="0.8" /><text x="${sx(r.L / 2)}" y="${sy(r.y0 + r.cw / 2) + fs / 3}" text-anchor="middle" font-size="${fs}" fill="#5b6b7b">CORRIDOR ${f2(r.cw)} m</text>`;
  const hot = DRAG && DRAG.moved && DRAG.k !== "vert" ? dropTarget(DRAG) : null;
  for (const [ci, c0] of r.core.entries()) {
    const dg = DRAG && DRAG.moved && DRAG.k === "core" && DRAG.i === ci, c = dg ? Object.assign({}, c0, DRAG.at) : c0;
    const X = sx(c.x), Y = sy(c.y), w = c.w * SC, h = c.h * SC, bad = c0.flags && c0.flags.length, sel = CSEL === ci, tg = hot && hot.ci === ci;
    const fill = c.kind === "stair" ? "#ffe0c2" : c.kind === "lift" ? "#dad7f0" : c.kind === "refuse" ? "#e3e7d3" : "#f1d6d6";
    g += `<g${dg ? ' opacity="0.8"' : ""}><rect x="${X}" y="${Y}" width="${w}" height="${h}" fill="${fill}" stroke="${sel || tg ? "#f28022" : bad ? "#c62828" : "#333"}" stroke-width="${sel || tg || bad ? 2.5 : 1.2}" />`;
    if (c.kind === "stair") { const k = 7, vert = h >= w; for (let i = 1; i < k; i++) g += vert ? `<line x1="${X + 2}" y1="${Y + h * i / k}" x2="${X + w / 2 - 1}" y2="${Y + h * i / k}" stroke="#a5642a" stroke-width="0.6" /><line x1="${X + w / 2 + 1}" y1="${Y + h * i / k}" x2="${X + w - 2}" y2="${Y + h * i / k}" stroke="#a5642a" stroke-width="0.6" />` : `<line x1="${X + w * i / k}" y1="${Y + 2}" x2="${X + w * i / k}" y2="${Y + h / 2 - 1}" stroke="#a5642a" stroke-width="0.6" /><line x1="${X + w * i / k}" y1="${Y + h / 2 + 1}" x2="${X + w * i / k}" y2="${Y + h - 2}" stroke="#a5642a" stroke-width="0.6" />`; }
    if (c.kind === "lift") g += `<line x1="${X}" y1="${Y}" x2="${X + w}" y2="${Y + h}" stroke="#555" stroke-width="0.6" /><line x1="${X + w}" y1="${Y}" x2="${X}" y2="${Y + h}" stroke="#555" stroke-width="0.6" />`;
    if (Math.max(w, h) > fs * 2.5) g += `<text x="${X + w / 2}" y="${Y + h / 2 + 4}" text-anchor="middle" font-size="${fs - 1}" font-weight="700" fill="#222" paint-order="stroke" stroke="#fff" stroke-width="3" pointer-events="none">${esc(c.label)}</text>`;
    g += `<rect class="fl-u" data-ci="${ci}" x="${X}" y="${Y}" width="${w}" height="${h}" fill="transparent" /></g>`;
  }
  for (const [pi, q] of r.placed.entries()) {
    const dg = DRAG && DRAG.moved && DRAG.k === "unit" && DRAG.i === pi, ox = dg ? DRAG.at.x : q.x, oy = dg ? DRAG.at.y : q.y;
    const sel = PSEL === pi, tg = hot && hot.pi === pi, bad = q.flags && q.flags.length;
    g += `<g${dg ? ' opacity="0.75"' : ""}>`;
    for (const e of q.extras) g += `<rect x="${sx(ox + e.x)}" y="${sy(oy + e.y)}" width="${e.w * SC}" height="${e.h * SC}" fill="#dfe9f3" stroke="#3c4650" stroke-width="0.8" stroke-dasharray="4 2" />`;
    for (const rm of q.rooms) g += `<rect x="${sx(ox + rm.x)}" y="${sy(oy + rm.y)}" width="${rm.w * SC}" height="${rm.h * SC}" fill="${KC[rm.kind] || "#c6d9ef"}" stroke="#4a5866" stroke-width="0.7" />`;
    g += `<rect x="${sx(ox)}" y="${sy(oy)}" width="${q.w * SC}" height="${q.h * SC}" fill="${tg ? "rgba(242,128,34,.22)" : bad ? "rgba(198,40,40,.12)" : "none"}" stroke="${sel || tg ? "#f28022" : bad ? "#c62828" : "#111"}" stroke-width="${sel || tg || bad ? 3 : 2}" />`;
    if (q.corner) { const X = sx(q.corner === "w" ? ox : ox + q.w); g += `<line x1="${X}" y1="${sy(oy)}" x2="${X}" y2="${sy(oy + q.h)}" stroke="#2b6c8f" stroke-width="4" />`; }
    if (q.w * SC > fs * 5) g += `<text x="${sx(ox + q.w / 2)}" y="${sy(oy + q.h / 2)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="#1f2a36" paint-order="stroke" stroke="#fff" stroke-width="3" pointer-events="none">${esc(q.name || "Unit")}${q.m && !/mirrored/.test(q.name || "") ? " ⇋" : ""}</text>
      <text x="${sx(ox + q.w / 2)}" y="${sy(oy + q.h / 2) + fs + 2}" text-anchor="middle" font-size="${fs - 1}" fill="${bad ? "#c62828" : "#3c4650"}" paint-order="stroke" stroke="#fff" stroke-width="3" pointer-events="none">${bad ? esc(q.flags[0]) : `${f1(q.fig.saleable)} m² · ${f2(q.w)} m`}</text>`;
    g += `<rect class="fl-u" data-pi="${pi}" x="${sx(ox)}" y="${sy(oy)}" width="${q.w * SC}" height="${q.h * SC}" fill="transparent" /></g>`;
  }
  // the plate's corners to drag, a + on each edge to add one
  if (can) {
    for (const [vi, p] of poly.entries()) {
      const nx = poly[(vi + 1) % poly.length];
      g += `<circle class="fl-vm" data-vm="${vi}" cx="${sx((p[0] + nx[0]) / 2)}" cy="${sy((p[1] + nx[1]) / 2)}" r="6" fill="#fff" stroke="#7a6a3a" stroke-width="1.2" /><text x="${sx((p[0] + nx[0]) / 2)}" y="${sy((p[1] + nx[1]) / 2) + 3.5}" text-anchor="middle" font-size="10" fill="#7a6a3a" pointer-events="none">+</text>`;
    }
    for (const [vi, p] of poly.entries()) g += `<circle class="fl-v" data-vi="${vi}" cx="${sx(p[0])}" cy="${sy(p[1])}" r="7" fill="#7a6a3a" stroke="#fff" stroke-width="2" />`;
  }
  const dim = (x1, y1, x2, y2, t, vert) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#555" stroke-width="0.8" /><text x="${(x1 + x2) / 2 + (vert ? -6 : 0)}" y="${(y1 + y2) / 2 + (vert ? 0 : -4)}" text-anchor="middle" font-size="${fs}" fill="#333"${vert ? ` transform="rotate(-90 ${(x1 + x2) / 2 - 6} ${(y1 + y2) / 2})"` : ""}>${t}</text>`;
  g += dim(sx(0), sy(0) - 16, sx(r.L), sy(0) - 16, f2(r.L) + " m");
  g += dim(sx(0) - 16, sy(0), sx(0) - 16, sy(r.D), f2(r.D) + " m", true);
  const F = r.figures;
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}" font-family="'Noto Sans HK', 'PingFang HK', sans-serif">${g}
    <text x="12" y="${bh - 12}" font-size="12" fill="#5b6b7b">${F.units} flats · GFA ${f1(F.gfa)} m² of ${f1(F.plate)} m²${SWAP ? " · tap the other one to swap with" : ""}</text></svg>${pop(r, sx, sy, bw, bh)}${PZ.bar(document.body.classList.contains("st-planfull"))}`;
}
/* the small menu by the selected unit or core piece */
function pop(r, sx, sy, bw, bh) {
  if (!C.can() || DRAG) return "";
  const at = (q) => [Math.max(8, Math.min(sx(q.x), bw - 340)), Math.max(8, Math.min(q.y + q.h / 2 > r.y0 ? sy(q.y + q.h) + 8 : sy(q.y) - 54, bh - 90))];
  const q = PSEL != null && r.placed[PSEL];
  if (q) {
    const [L, T] = at(q);
    return `<div class="fl-pop" style="left:${Math.round(L)}px;top:${Math.round(T)}px"><b>${esc(q.name)}</b>
      <button type="button" data-fu="flip" title="Mirror it left to right">⇋ Flip</button><button type="button" data-fu="rot" title="Turn it 90°">⟳ Rotate</button><button type="button" data-fu="left" title="Swap with the unit on its left">◀</button><button type="button" data-fu="right" title="Swap with the unit on its right">▶</button>
      <button type="button" data-fu="side">⇅ Other side</button><button type="button" data-fu="swap" class="${SWAP ? "on" : ""}">Swap with…</button>${q.fixed ? `<button type="button" data-fu="free" title="Back into the row along the corridor">Back in the row</button>` : ""}<button type="button" data-fu="del">Remove</button>
      ${q.flags && q.flags.length ? `<small class="bad">${esc(q.flags.join(" · "))}</small>` : ""}</div>`;
  }
  const c = CSEL != null && r.core[CSEL];
  if (c) {
    const [L, T] = at(c);
    return `<div class="fl-pop" style="left:${Math.round(L)}px;top:${Math.round(T)}px"><b>${esc(c.label)}</b> ${f2(c.w)} × ${f2(c.h)} m
      <button type="button" data-fc="rot">⟳ Rotate 90°</button><button type="button" data-fc="swap" class="${SWAP ? "on" : ""}">Swap with…</button><button type="button" data-fc="lift">+ Lift</button><button type="button" data-fc="del">Remove</button>${r.coreEdited ? `<button type="button" data-fc="reset">Reset core</button>` : ""}
      ${c.flags && c.flags.length ? `<small class="bad">${esc(c.flags.join(" · "))}</small>` : ""}</div>`;
  }
  return "";
}
const toPlan = (ev) => { const b = $("#st-fplan").getBoundingClientRect(); return [X0 + (ev.clientX - b.left - OX) / SC, Y0 + (ev.clientY - b.top - OY) / SC]; };
/* the edges a dragged thing may snap to, along x and across y */
function edgesFor(r, skipUnit, skipCore) {
  const ex = [0, r.L], ey = [0, r.D, r.y0, r.y1];
  r.placed.forEach((q, i) => { if (i !== skipUnit) { ex.push(q.x, q.x + q.w); } });
  r.core.forEach((c, i) => { if (i !== skipCore) { ex.push(c.x, c.x + c.w); ey.push(c.y, c.y + c.h); } });
  return { ex, ey };
}
/* where a dragged unit or piece is now (snapped), in plan metres */
function dragAt(d, alt) {
  const r = LAST, snap = SNAP() && !alt;
  if (d.k === "unit") {
    const q = r.placed[d.i], cx = q.x + d.dx / SC, cy = q.y + q.h / 2 + d.dy / SC;
    const band = cy > r.y0 + r.cw / 2 ? "s" : "n";
    // the unit flips to face the corridor from the other side, so its depth stays its depth
    const y = band === "s" ? r.y1 : r.y0 - q.h;
    const { ex } = edgesFor(r, d.i, -1);
    return { x: snap ? FC.snap1(cx, q.w, ex) : Math.round(cx * 20) / 20, y, band };
  }
  const c = r.core[d.i], x = c.x + d.dx / SC, y = c.y + d.dy / SC, { ex, ey } = edgesFor(r, -1, d.i);
  return { x: snap ? FC.snap1(x, c.w, ex) : Math.round(x * 20) / 20, y: snap ? FC.snap1(y, c.h, ey) : Math.round(y * 20) / 20 };
}
/* a drop onto another unit / piece swaps them */
function dropTarget(d) {
  const r = LAST, P = d.k === "unit" ? r.placed[d.i] : r.core[d.i], cx = P.x + P.w / 2 + d.dx / SC, cy = P.y + P.h / 2 + d.dy / SC;
  const on = (o) => cx >= o.x && cx <= o.x + o.w && cy >= o.y && cy <= o.y + o.h;
  if (d.k === "unit") { const pi = r.placed.findIndex((o, k) => k !== d.i && on(o)); return pi >= 0 ? { pi } : null; }
  const ci = r.core.findIndex((o, k) => k !== d.i && on(o)); return ci >= 0 ? { ci } : null;
}
/* swap two units' places: what stands there changes, the places stay */
function swapEntries(seq, a, b) {
  const A = seq[a.band][a.i], B = seq[b.band][b.i];
  for (const k of ["u", "m", "r"]) { const t = A[k]; if (B[k] == null) delete A[k]; else A[k] = B[k]; if (t == null) delete B[k]; else B[k] = t; }
}
function unitAction(k) {
  const r = LAST, q = r && r.placed[PSEL]; if (!q) return;
  if (k === "swap") { SWAP = !SWAP; return drawPlan(); }
  const me = entryOf(q);
  if (k === "flip") return edit((seq) => { seq[me.band][me.i].m = !seq[me.band][me.i].m; return PSEL; });
  if (k === "rot") return edit((seq) => { const e = seq[me.band][me.i]; e.r = ((Number(e.r) || 0) + 90) % 360; if (!e.r) delete e.r; if (e.x == null) e.x = q.x; return PSEL; });
  if (k === "free") return edit((seq) => { delete seq[me.band][me.i].x; });
  if (k === "del") return edit((seq) => { seq[me.band].splice(me.i, 1); });
  if (k === "side") return edit((seq) => { const [e] = seq[me.band].splice(me.i, 1); delete e.x; seq[me.band === "s" ? "n" : "s"].push(e); });
  if (k === "left" || k === "right") {
    const along = r.placed.filter((o) => o.band === q.band).sort((a, b) => a.x - b.x), at = along.indexOf(q), o = along[at + (k === "left" ? -1 : 1)];
    if (!o) return toast(k === "left" ? "It is the first along this side" : "It is the last along this side");
    const ob = entryOf(o);
    return edit((seq) => { swapEntries(seq, me, ob); return r.placed.indexOf(o); });
  }
}
function coreAction(k) {
  const r = LAST, c = r && r.core[CSEL]; if (!c) return;
  if (k === "swap") { SWAP = !SWAP; return drawPlan(); }
  if (k === "reset") { const x = cur(); if (!x) return; snapF(x); delete x.b.groups[x.gi].floor.pieces; snapF(x); C.save(); CSEL = null; return render(); }
  const i = CSEL;
  if (k === "rot") return editCore((P) => { const q = P[i], cx = q.x + q.w / 2, cy = q.y + q.h / 2; [q.w, q.h] = [q.h, q.w]; q.x = Math.round((cx - q.w / 2) * 20) / 20; q.y = Math.round((cy - q.h / 2) * 20) / 20; return i; });
  if (k === "del") return editCore((P) => { P.splice(i, 1); });
  if (k === "lift") return editCore((P) => { const L = P.filter((q) => q.kind === "lift"), last = L[L.length - 1] || P[i]; P.push({ kind: "lift", label: "Lift " + (L.length + 1), x: Math.round((last.x + last.w) * 20) / 20, y: last.y, w: FC.DEF.lift[0], h: FC.DEF.lift[1] }); return P.length - 1; });
}
function swapCore(P, a, b) { const A = P[a], B = P[b]; const ax = A.x, ay = A.y; A.x = B.x + (B.w - A.w) / 2; A.y = B.y + (B.h - A.h) / 2; B.x = ax + (A.w - B.w) / 2; B.y = ay + (A.h - B.h) / 2; for (const q of [A, B]) { q.x = Math.round(q.x * 20) / 20; q.y = Math.round(q.y * 20) / 20; } }
function wirePlan() {
  const host = $("#st-fplan");
  let pan = null;
  host.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.pz) return PZ.barClick(ZM, b, host.getBoundingClientRect(), drawPlan);
    if (b.dataset.fu) return unitAction(b.dataset.fu);
    if (b.dataset.fc) return coreAction(b.dataset.fc);
  });
  host.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest(".pz-bar,.fl-pop")) return;
    if (PZ.down(ZM, ev)) { DRAG = null; pan = null; cap(host, ev); ev.preventDefault(); return drawPlan(); }
    const t = ev.target;
    if (t.dataset.vm != null && LAST && C.can()) { const k = +t.dataset.vm; ev.preventDefault(); return editPlate((P) => { const a = P[k], b = P[(k + 1) % P.length]; P.splice(k + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); return P; }); }
    if (t.dataset.vi != null && LAST && C.can()) DRAG = { k: "vert", i: +t.dataset.vi, x: ev.clientX, y: ev.clientY, dx: 0, dy: 0, moved: false };
    else if (t.dataset.pi != null && LAST) DRAG = { k: "unit", i: +t.dataset.pi, x: ev.clientX, y: ev.clientY, dx: 0, dy: 0, moved: false };
    else if (t.dataset.ci != null && LAST) DRAG = { k: "core", i: +t.dataset.ci, x: ev.clientX, y: ev.clientY, dx: 0, dy: 0, moved: false };
    else pan = { x: ev.clientX, y: ev.clientY, px: ZM.px, py: ZM.py, moved: false };
    cap(host, ev); ev.preventDefault();
  });
  host.addEventListener("pointermove", (ev) => {
    if (PZ.move(ZM, ev, host.getBoundingClientRect())) return drawPlan();
    if (pan) { const dx = ev.clientX - pan.x, dy = ev.clientY - pan.y; if (!pan.moved && Math.hypot(dx, dy) < 4) return; pan.moved = true; ZM.px = pan.px + dx; ZM.py = pan.py + dy; return drawPlan(); }
    if (!DRAG) return;
    const dx = ev.clientX - DRAG.x, dy = ev.clientY - DRAG.y;
    if (!DRAG.moved && Math.hypot(dx, dy) < 6) return;
    if (!C.can()) return;
    DRAG.moved = true; DRAG.dx = dx; DRAG.dy = dy;
    if (DRAG.k === "vert") {
      const P = LAST.F.poly.map((p) => p.slice()), p0 = P[DRAG.i];
      P[DRAG.i] = [Math.round((p0[0] + dx / SC) * 20) / 20, Math.round((p0[1] + dy / SC) * 20) / 20];
      DRAG.poly = P;
    } else DRAG.at = dragAt(DRAG, ev.altKey);
    drawPlan();
  });
  const end = (ev) => {
    PZ.up(ZM, ev);
    if (pan) { const p = pan; pan = null; if (!p.moved) { PSEL = null; CSEL = null; SWAP = false; } return drawPlan(); }
    if (!DRAG) return;
    const d = DRAG; DRAG = null;
    const r = LAST;
    if (d.k === "vert") { if (d.moved && d.poly) return editPlate(() => d.poly); return drawPlan(); }
    if (d.k === "core") {
      if (!d.moved) {
        if (SWAP && CSEL != null && CSEL !== d.i) { const a = CSEL; SWAP = false; return editCore((P) => { swapCore(P, a, d.i); return d.i; }); }
        CSEL = CSEL === d.i ? null : d.i; PSEL = null; SWAP = false; return drawPlan();
      }
      const tg = dropTarget(d);
      if (tg && tg.ci != null) return editCore((P) => { swapCore(P, d.i, tg.ci); return tg.ci; });
      const at = d.at || dragAt(d, ev.altKey);
      return editCore((P) => { P[d.i].x = at.x; P[d.i].y = at.y; return d.i; });
    }
    const q = r.placed[d.i]; if (!q) return drawPlan();
    if (!d.moved) {
      if (SWAP && PSEL != null && PSEL !== d.i) { const a = entryOf(r.placed[PSEL]), b = entryOf(q); SWAP = false; return edit((seq) => { swapEntries(seq, a, b); }); }
      PSEL = PSEL === d.i ? null : d.i; CSEL = null; SWAP = false; return drawPlan();
    }
    const tg = dropTarget(d), me = entryOf(q);
    if (tg && tg.pi != null) return edit((seq) => { swapEntries(seq, me, entryOf(r.placed[tg.pi])); });
    // put it where it was dropped: on its side of the corridor, at that x
    const at = d.at || dragAt(d, ev.altKey);
    return edit((seq) => {
      const e = seq[me.band][me.i]; e.x = at.x;
      if (at.band !== me.band) { seq[me.band].splice(me.i, 1); seq[at.band].push(e); }
    });
  };
  host.addEventListener("pointerup", end);
  host.addEventListener("pointercancel", end);
  host.addEventListener("wheel", (ev) => { if (ev.target.closest(".fl-pop,.pz-bar")) return; ev.preventDefault(); if (PZ.wheel(ZM, ev, host.getBoundingClientRect())) drawPlan(); }, { passive: false });
}
/* the plate's rectangle round itself, its units and core (the frame's axes) */
function fitPlate() {
  const r = LAST; if (!r) return;
  const xs = [...r.F.poly.map((p) => p[0]), ...r.placed.flatMap((q) => [q.x, q.x + q.w]), ...r.core.flatMap((c) => [c.x, c.x + c.w])];
  const ys = [...r.F.poly.map((p) => p[1]), ...r.placed.flatMap((q) => [q.y, q.y + q.h]), ...r.core.flatMap((c) => [c.y, c.y + c.h])];
  const a = Math.min(...xs), b = Math.max(...xs), c = Math.min(...ys), d = Math.max(...ys);
  editPlate(() => [[a, c], [b, c], [b, d], [a, d]]);
}
export function refresh() { if (ON) render(); }
void UC;
