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

const $ = (s, r = document) => r.querySelector(s);
const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f0 = (x) => (x == null || isNaN(x) ? "–" : Math.round(x).toLocaleString("en-GB"));
const f1 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const f2 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

let C = null, ON = false, SEL = null, LAST = null;

export function init(ctx) {
  C = ctx;
  const P = $("#st-fpanel");
  P.addEventListener("change", onChange);
  P.addEventListener("click", onClick);
  P.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches("input")) ev.target.blur(); });
  window.addEventListener("resize", () => ON && drawPlan());
}
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
  return FC.layout(Object.assign({}, o, { poly: x.fp, mix, storeys: Number(x.g.n) || 1, floorsAbove: x.top || Number(x.g.n) || 1 }));
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
  if (t.dataset.fsel != null) { SEL = t.value; return render(); }
  if (!x || !C.can()) return;
  const k = t.dataset.fo; if (!k) return;
  const g = x.b.groups[x.gi], f = g.floor = g.floor || {};
  if (k === "mic") f.mic = t.checked;
  else if (k === "core") f.core = t.value;
  else if (t.value === "") delete f[k];
  else f[k] = Math.max(0, parseFloat(t.value));
  C.save(); render();
}
function onClick(ev) {
  const t = ev.target.closest("button"); if (!t) return;
  if (t.dataset.fuse != null && LAST) {
    const x = cur(); if (!x) return;
    x.b.groups[x.gi].acc = Math.round(LAST.figures.acc * 10) / 10;
    C.save(); toast(`GFA % ${x.b.groups[x.gi].acc} set on the floor group in Massing`); render();
  }
}

/* ---------- the plan */
const KC = { LD: "#c6d9ef", MBR: "#d5e4f5", BR: "#d5e4f5", OKIT: "#f4e3c6", KIT: "#f4e3c6", BATH: "#d6eee8", ENS: "#d6eee8", LOBBY: "#e7eaee", STORE: "#e7eaee" };
function drawPlan() {
  const host = $("#st-fplan"), r = LAST;
  if (!r) { if (!host.innerHTML) host.innerHTML = `<div class="un-empty">Choose a floor group.</div>`; return; }
  const bw = host.clientWidth || 900, bh = host.clientHeight || 700;
  const xs = r.F.poly.map((p) => p[0]), ys = r.F.poly.map((p) => p[1]);
  const X0 = Math.min(0, ...xs) - 1, Y0 = Math.min(0, ...ys) - 2, W = Math.max(r.L, ...xs) - X0 + 1, H = Math.max(r.D, ...ys) - Y0 + 2;
  const SC = Math.max(4, Math.min((bw - 120) / W, (bh - 140) / H));
  const OX = (bw - W * SC) / 2, OY = (bh - H * SC) / 2 + 20;
  const sx = (x) => OX + (x - X0) * SC, sy = (y) => OY + (y - Y0) * SC;
  const fs = Math.max(8, Math.min(12, SC * 0.5));
  let g = `<polygon points="${r.F.poly.map((p) => sx(p[0]) + "," + sy(p[1])).join(" ")}" fill="#fbf3dc" stroke="#7a6a3a" stroke-width="1.5" />`;
  g += `<text x="${sx(r.L) - 4}" y="${sy(r.D) - 4}" text-anchor="end" font-size="${fs}" fill="#8a7a4a">residual → E&amp;M</text>`;
  g += `<rect x="${sx(0)}" y="${sy(r.y0)}" width="${r.L * SC}" height="${r.cw * SC}" fill="#eceff3" stroke="#9aa5b1" stroke-width="0.8" /><text x="${sx(r.L / 2)}" y="${sy(r.y0 + r.cw / 2) + 4}" text-anchor="middle" font-size="${fs}" fill="#5b6b7b">CORRIDOR ${f2(r.cw)} m</text>`;
  for (const c of r.core) {
    const X = sx(c.x), Y = sy(c.y), w = c.w * SC, h = c.h * SC;
    const fill = c.kind === "stair" ? "#ffe0c2" : c.kind === "lift" ? "#dad7f0" : c.kind === "refuse" ? "#e3e7d3" : "#f1d6d6";
    g += `<rect x="${X}" y="${Y}" width="${w}" height="${h}" fill="${fill}" stroke="#333" stroke-width="1.2" />`;
    if (c.kind === "stair") { const k = 7; for (let i = 1; i < k; i++) g += `<line x1="${X + 2}" y1="${Y + h * i / k}" x2="${X + w / 2 - 1}" y2="${Y + h * i / k}" stroke="#a5642a" stroke-width="0.6" /><line x1="${X + w / 2 + 1}" y1="${Y + h * i / k}" x2="${X + w - 2}" y2="${Y + h * i / k}" stroke="#a5642a" stroke-width="0.6" />`; }
    if (c.kind === "lift") g += `<line x1="${X}" y1="${Y}" x2="${X + w}" y2="${Y + h}" stroke="#555" stroke-width="0.6" /><line x1="${X + w}" y1="${Y}" x2="${X}" y2="${Y + h}" stroke="#555" stroke-width="0.6" />`;
    g += `<text x="${X + w / 2}" y="${Y + h / 2 + 4}" text-anchor="middle" font-size="${fs - 1}" font-weight="700" fill="#222" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(c.label)}</text>`;
  }
  for (const q of r.placed) {
    const ox = q.x, oy = q.y;
    for (const e of q.extras) g += `<rect x="${sx(ox + e.x)}" y="${sy(oy + e.y)}" width="${e.w * SC}" height="${e.h * SC}" fill="#dfe9f3" stroke="#3c4650" stroke-width="0.8" stroke-dasharray="4 2" />`;
    for (const rm of q.rooms) g += `<rect x="${sx(ox + rm.x)}" y="${sy(oy + rm.y)}" width="${rm.w * SC}" height="${rm.h * SC}" fill="${KC[rm.kind] || "#c6d9ef"}" stroke="#4a5866" stroke-width="0.7" />`;
    g += `<rect x="${sx(ox)}" y="${sy(oy)}" width="${q.w * SC}" height="${q.h * SC}" fill="none" stroke="#111" stroke-width="2" />`;
    g += `<text x="${sx(ox + q.w / 2)}" y="${sy(oy + q.h / 2)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="#1f2a36" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(q.name || "Unit")}</text>
      <text x="${sx(ox + q.w / 2)}" y="${sy(oy + q.h / 2) + fs + 2}" text-anchor="middle" font-size="${fs - 1}" fill="#3c4650" paint-order="stroke" stroke="#fff" stroke-width="3">${f1(q.fig.saleable)} m² · ${f2(q.w)} m</text>`;
  }
  // overall dimensions
  const dim = (x1, y1, x2, y2, t, vert) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#555" stroke-width="0.8" /><text x="${(x1 + x2) / 2 + (vert ? -6 : 0)}" y="${(y1 + y2) / 2 + (vert ? 0 : -4)}" text-anchor="middle" font-size="${fs}" fill="#333"${vert ? ` transform="rotate(-90 ${(x1 + x2) / 2 - 6} ${(y1 + y2) / 2})"` : ""}>${t}</text>`;
  g += dim(sx(0), sy(0) - 14, sx(r.L), sy(0) - 14, f2(r.L) + " m");
  g += dim(sx(0) - 14, sy(0), sx(0) - 14, sy(r.D), f2(r.D) + " m", true);
  const F = r.figures;
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}" font-family="'Noto Sans HK', 'PingFang HK', sans-serif">${g}
    <text x="12" y="${bh - 12}" font-size="12" fill="#5b6b7b">Typical floor · ${F.units} flats · GFA ${f1(F.gfa)} m² of a ${f1(F.plate)} m² plate · the plate turned to its long side</text></svg>`;
}
export function refresh() { if (ON) render(); }
void UC;
