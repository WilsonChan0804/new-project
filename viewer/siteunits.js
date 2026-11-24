/* Site study, stage 3: the units - each project's unit plans (rooms on a
 * 50 mm grid in any stepped outline, doors, the balcony, utility platform,
 * A/C platform, pipe duct, architectural feature), drawn as a sales-brochure
 * plan, with wall lines to drag; their saleable area, GFA and concessions;
 * and the office's library (/api/units/library). Kept in study.units.
 */
import * as U from "./unitcore.js";
import { TEMPLATES } from "./unittables.js";
import { api } from "./nav.js";
import { toast } from "./tasks-util.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f1 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const f2 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const SIDES = { n: "top", e: "right", s: "bottom", w: "left" };

let C = null, ON = false, LIB = { units: [] }, HIST = [], HI = -1, SELR = null;

export function init(ctx) {
  C = ctx;
  const P = $("#st-upanel");
  P.addEventListener("change", onChange);
  P.addEventListener("click", onClick);
  P.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches("input")) ev.target.blur(); });
  document.addEventListener("keydown", (ev) => {
    if (!ON || !(ev.ctrlKey || ev.metaKey) || ev.target.closest("input,select,textarea")) return;
    const k = ev.key.toLowerCase();
    if (k === "z" && !ev.shiftKey) { ev.preventDefault(); undo(-1); }
    if (k === "y" || (k === "z" && ev.shiftKey)) { ev.preventDefault(); undo(1); }
  });
  wirePlan();
}
export function store() {
  const s = C.study();
  s.units = s.units && typeof s.units === "object" ? s.units : {};
  const st = s.units;
  st.list = Array.isArray(st.list) ? st.list.map((u) => (u && u.rows ? U.fromRows(u) : u)) : [];
  if (st.sel == null || st.sel >= st.list.length) st.sel = st.list.length ? 0 : -1;
  return st;
}
const cur = () => { const st = store(); return st.list[st.sel] || null; };
const copyNamed = (u, list) => { const c = JSON.parse(JSON.stringify(u)); let nm = c.name || "Unit", k = 2; while (list.some((q) => q.name === nm)) nm = `${c.name} (${k++})`; c.name = nm; return c; };

export async function show(on) {
  ON = on;
  $("#st-upanel").hidden = !on;
  $("#st-uplan").hidden = !on;
  document.body.classList.toggle("st-units", on);
  if (!on) return;
  if (!HIST.length) snap();
  render();
  try { LIB = await api("/api/units/library"); render(); } catch (e) {}
}
function snap() { const j = JSON.stringify(store()); if (HIST[HI] === j) return; HIST = HIST.slice(0, HI + 1); HIST.push(j); if (HIST.length > 80) HIST.shift(); HI = HIST.length - 1; }
function undo(step) {
  const k = HI + step;
  if (k < 0 || k >= HIST.length) return toast(step < 0 ? "Nothing to undo" : "Nothing to redo");
  HI = k; C.study().units = JSON.parse(HIST[HI]); C.save(); render();
}
function changed() { snap(); C.save(); render(); }

/* ---------- the panel */
function render() {
  if (!ON) return;
  const st = store(), u = cur(), can = C.can(), dis = can ? "" : " disabled";
  const kindOpt = (k) => Object.entries(U.KINDS).map(([v, q]) => `<option value="${v}"${v === k ? " selected" : ""}>${q.label}</option>`).join("");
  const exOpt = (k) => Object.entries(U.EXTRAS).map(([v, q]) => `<option value="${v}"${v === k ? " selected" : ""}>${q.label}</option>`).join("");
  const num = (attr, v, step = 0.05) => `<input type="number" step="${step}" ${attr} value="${esc(v == null ? "" : +(+v).toFixed(3))}"${dis}>`;
  const tabs = st.list.map((x, i) => `<button type="button" class="un-tab${i === st.sel ? " on" : ""}" data-usel="${i}">${esc(x.name || "Unit")}<small>${U.figures(x).saleableFt} ft²</small></button>`).join("");
  let body = "";
  if (u) {
    const f = U.figures(u);
    const big = (l, v, s2) => `<div class="st-big"><small>${l}</small><b>${v}</b>${s2 ? `<span>${s2}</span>` : ""}</div>`;
    const rooms = u.rooms.map((r, i) => `<div class="un-room${SELR === r.id ? " sel" : ""}" data-rid="${esc(r.id)}">
        <select data-rk="${i}"${dis}>${kindOpt(r.kind)}</select><input class="un-nm" data-rn="${i}" value="${esc(r.name || "")}" placeholder="name"${dis}>
        <span class="un-xy">x ${num(`data-rx="${i}"`, r.x)} y ${num(`data-ry="${i}"`, r.y)}</span><span class="un-wh">${num(`data-rw="${i}"`, r.w)} × ${num(`data-rh="${i}"`, r.h)} m</span>
        <small>${f2(r.w * r.h)} m²</small>${can ? `<button type="button" class="ghost st-ib" data-rdel="${i}">×</button>` : ""}</div>`).join("");
    const doors = (u.doors || []).map((d, i) => `<div class="un-room">
        <select data-dr="${i}"${dis}>${u.rooms.map((r) => `<option value="${esc(r.id)}"${r.id === d.room ? " selected" : ""}>${esc(r.name || (U.KINDS[r.kind] || {}).label)}</option>`).join("")}</select>
        <select data-ds="${i}"${dis}>${Object.entries(SIDES).map(([k, v]) => `<option value="${k}"${k === d.side ? " selected" : ""}>${v} wall</option>`).join("")}</select>
        at ${num(`data-da="${i}"`, d.at)} w ${num(`data-dw="${i}"`, d.w)} <label class="st-chk"><input type="checkbox" data-de="${i}"${d.entry ? " checked" : ""}${dis}> entrance</label>
        ${can ? `<button type="button" class="ghost st-ib" data-ddel="${i}">×</button>` : ""}</div>`).join("");
    const extras = (u.extras || []).map((e, i) => `<div class="un-room">
        <select data-ek="${i}"${dis}>${exOpt(e.kind)}</select><span class="un-xy">x ${num(`data-ex="${i}"`, e.x)} y ${num(`data-ey="${i}"`, e.y)}</span><span class="un-wh">${num(`data-ew="${i}"`, e.w)} × ${num(`data-eh="${i}"`, e.h)} m</span>
        ${e.kind === "bal" || e.kind === "up" ? `splay ${num(`data-esp="${i}"`, e.splay || 0)}` : ""}
        ${e.kind === "acp" ? `<label class="st-chk" title="Meets the Code of Practice for external maintenance (APP-19 3(c))"><input type="checkbox" data-edfs="${i}"${e.dfs ? " checked" : ""}${dis}> DfS</label>` : ""}
        ${can ? `<button type="button" class="ghost st-ib" data-edel="${i}">×</button>` : ""}</div>`).join("");
    body = `
      <section class="st-card">
        <div class="st-head"><input class="ms-name" data-uf="name" value="${esc(u.name || "")}"${dis}><span class="muted">${f2(f.W)} × ${f2(f.D)} m</span></div>
        ${u.src ? `<p class="muted st-note">${esc(u.src)}</p>` : ""}
        <div class="st-bigs un-bigs">
          ${big("Saleable area", `${f1(f.saleable)} <i>m²</i>`, `<b>${f.saleableFt} ft²</b> · balcony ${f2(f.bal)} + UP ${f2(f.up)} m² included`)}
          ${big("Unit GFA", `${f1(f.gfa)} <i>m²</i>`, `enclosed ${f2(f.enclosed)} m²`)}
          ${big("Concessions", `${f2(f.balEx + f.upEx + f.acpFree + f.acpCapEx)} <i>m²</i>`, `under the 10% cap ${f2(f.capped)} · A/C platforms not counted ${f2(f.acpFree)}`)}
          ${big("Usable", `${f1(f.internal)} <i>m²</i>`, `inside the walls · ${f.efficiency ? Math.round(f.efficiency * 100) : "–"}% of the GFA`)}
        </div>
        ${f.warn.length ? `<ul class="un-warn">${f.warn.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : `<p class="st-sent good">No warnings.</p>`}
        <p class="muted st-note">Saleable area (First-hand Sales Ordinance s.8): to the outside of external walls and the middle of party walls, partitions included; balcony and utility platform added, A/C platform, pipe duct and features not. Concessions: balcony ${esc(U.RULES.bal.src)}; utility platform ${esc(U.RULES.up.src)}; A/C platform ${esc(U.RULES.acp.src)}.</p>
      </section>
      <section class="st-card">
        <div class="st-head"><b>Rooms</b><span class="muted">to the wall centrelines · drag a wall on the plan</span></div>
        ${rooms}${can ? `<button type="button" class="ghost st-ib" data-radd>+ Room</button>` : ""}
      </section>
      <section class="st-card">
        <div class="st-head"><b>Doors</b></div>
        ${doors || `<p class="muted st-note">None.</p>`}${can ? `<button type="button" class="ghost st-ib" data-dadd>+ Door</button>` : ""}
      </section>
      <section class="st-card">
        <div class="st-head"><b>Balcony, UP, A/C platform, P.D., A.F.</b></div>
        ${extras || `<p class="muted st-note">None.</p>`}${can ? `<button type="button" class="ghost st-ib" data-eadd>+ Add</button>` : ""}
      </section>
      <section class="st-card">
        <div class="st-head"><b>Walls and sides</b></div>
        <div class="un-walls">
          <label>External ${num('data-uf="wall"', u.wall, 0.01)} m</label><label>Party ${num('data-uf="party"', u.party, 0.01)} m</label><label>Partition ${num('data-uf="part"', u.part, 0.01)} m</label>
          <label>Façade (windows) <select data-uf="facade"${dis}>${Object.entries(SIDES).map(([k, v]) => `<option value="${k}"${(u.facade || "s") === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>
          <span class="un-party">Party walls on: ${Object.entries(SIDES).map(([k, v]) => `<label class="st-chk"><input type="checkbox" data-ups="${k}"${(u.partySides || []).includes(k) ? " checked" : ""}${dis}> ${v}</label>`).join("")}</span>
        </div>
      </section>`;
  }
  const libOpt = (LIB.units || []).map((x) => `<option value="${esc(x.id)}">${esc(x.name)} · ${U.figures(x.unit).saleableFt} ft²${x.by ? " · " + esc(x.by) : ""}</option>`).join("");
  $("#st-upanel").innerHTML = `
    <section class="st-card">
      <div class="st-head"><b>Units</b>${can ? `<span class="ms-undo"><button type="button" class="ghost st-ib" data-uundo="-1"${HI > 0 ? "" : " disabled"}>↶ Undo</button><button type="button" class="ghost st-ib" data-uundo="1"${HI < HIST.length - 1 ? "" : " disabled"}>↷</button></span>` : ""}<span class="muted" id="un-saved">${can ? "Saved with the project" : "View only"}</span></div>
      <div class="un-tabs">${tabs || `<p class="st-need">No units yet: start from a template or the office library.</p>`}</div>
      ${can ? `<div class="st-row"><select data-unew><option value="">+ New from a template …</option>${Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}">${esc(t.name)}${t.src ? " · " + esc(t.src.replace(/^after /, "")) : ""}</option>`).join("")}</select>
        <select data-ulib><option value="">+ From the office library …</option>${libOpt}</select></div>
        ${u ? `<div class="st-row"><button type="button" class="ghost st-ib" data-udup>Duplicate</button><button type="button" class="ghost st-ib" data-udel>Remove</button><button type="button" class="ghost st-ib" data-usave>Save to the office library</button><button type="button" class="ghost st-ib" data-usvg>SVG</button></div>` : ""}` : ""}
    </section>
    ${body}`;
  drawPlan();
}

function onChange(ev) {
  const t = ev.target, st = store(), u = cur(), d = t.dataset;
  const num = (v, x) => (isNaN(parseFloat(v)) ? x : parseFloat(v));
  if (d.unew != null && t.value) { st.list.push(copyNamed(TEMPLATES[t.value], st.list)); st.sel = st.list.length - 1; SELR = null; return changed(); }
  if (d.ulib != null && t.value) { const x = LIB.units.find((q) => q.id === t.value); if (x) { st.list.push(copyNamed(x.unit.rows ? U.fromRows(x.unit) : x.unit, st.list)); st.sel = st.list.length - 1; toast(`${x.name} copied into this project`); return changed(); } }
  if (!u) return;
  if (d.uf) { u[d.uf] = ["name", "facade"].includes(d.uf) ? t.value : Math.max(0, num(t.value, u[d.uf])); return changed(); }
  if (d.ups) { const s2 = new Set(u.partySides || []); if (t.checked) s2.add(d.ups); else s2.delete(d.ups); u.partySides = [...s2]; return changed(); }
  const R = (k) => u.rooms[+k];
  if (d.rk != null) { const r = R(d.rk), old = (U.KINDS[r.kind] || {}).label; r.kind = t.value; if (!r.name || r.name === old) r.name = U.KINDS[t.value].label; return changed(); }
  if (d.rn != null) { R(d.rn).name = t.value; return changed(); }
  for (const k of ["x", "y", "w", "h"]) if (d["r" + k] != null) { R(d["r" + k])[k] = Math.round(num(t.value, 0) * 20) / 20; if (k === "w" || k === "h") R(d["r" + k])[k] = Math.max(0.5, R(d["r" + k])[k]); return changed(); }
  const D = (k) => u.doors[+k];
  if (d.dr != null) { D(d.dr).room = t.value; return changed(); }
  if (d.ds != null) { D(d.ds).side = t.value; return changed(); }
  if (d.da != null) { D(d.da).at = Math.max(0, num(t.value, 0)); return changed(); }
  if (d.dw != null) { D(d.dw).w = Math.max(0.5, num(t.value, 0.8)); return changed(); }
  if (d.de != null) { D(d.de).entry = t.checked; return changed(); }
  const X = (k) => u.extras[+k];
  if (d.ek != null) { X(d.ek).kind = t.value; return changed(); }
  for (const k of ["x", "y", "w", "h"]) if (d["e" + k] != null) { X(d["e" + k])[k] = num(t.value, 0); return changed(); }
  if (d.esp != null) { X(d.esp).splay = Math.max(0, num(t.value, 0)); return changed(); }
  if (d.edfs != null) { X(d.edfs).dfs = t.checked; return changed(); }
}

async function onClick(ev) {
  const row = ev.target.closest(".un-room[data-rid]");
  if (row && !ev.target.closest("input,select,button")) { SELR = row.dataset.rid; return render(); }
  const t = ev.target.closest("button"); if (!t) return;
  const st = store(), u = cur(), d = t.dataset;
  if (d.uundo) return undo(+d.uundo);
  if (d.usel != null) { st.sel = +d.usel; SELR = null; C.save(); return render(); }
  if (!u) return;
  if (d.udup != null) { st.list.push(copyNamed(u, st.list)); st.sel = st.list.length - 1; return changed(); }
  if (d.udel != null) { if (!confirm(`Remove ${u.name}?`)) return; st.list.splice(st.sel, 1); st.sel = Math.min(st.sel, st.list.length - 1); return changed(); }
  if (d.usave != null) {
    try {
      const ex = (LIB.units || []).find((x) => x.name === u.name);
      if (ex && !confirm(`${u.name} is in the office library already. Replace it?`)) return;
      LIB = await api("/api/units/library", { method: "PUT", body: JSON.stringify({ id: ex ? ex.id : null, unit: u }) });
      toast(`${u.name} saved to the office library`); render();
    } catch (e) { toast(e.message, true); }
    return;
  }
  if (d.usvg != null) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([$("#st-uplan").innerHTML], { type: "image/svg+xml" })); a.download = (u.name || "unit") + ".svg"; a.click(); return; }
  if (d.radd != null) { const f = U.figures(u); const id = "r" + Date.now().toString(36); u.rooms.push({ id, kind: "BR", name: "Bedroom", x: f.box[2], y: f.box[1], w: 2.4, h: 2.4 }); SELR = id; return changed(); }
  if (d.rdel != null) { if (u.rooms.length <= 1) return toast("A unit needs one room at least", true); const r = u.rooms.splice(+d.rdel, 1)[0]; u.doors = (u.doors || []).filter((q) => q.room !== r.id); return changed(); }
  if (d.dadd != null) { (u.doors = u.doors || []).push({ room: (SELR && u.rooms.find((r) => r.id === SELR) ? SELR : u.rooms[0].id), side: "n", at: 0.2, w: 0.8 }); return changed(); }
  if (d.ddel != null) { u.doors.splice(+d.ddel, 1); return changed(); }
  if (d.eadd != null) { const f = U.figures(u); (u.extras = u.extras || []).push({ kind: "acp", x: f.box[0], y: f.box[3], w: 1.0, h: 0.6 }); return changed(); }
  if (d.edel != null) { u.extras.splice(+d.edel, 1); return changed(); }
}

/* ---------- the plan, as a sales brochure: walls, doors, fixtures, labels */
let SC = 60, OX = 40, OY = 40, BX = 0, BY = 0;
function drawPlan() {
  const host = $("#st-uplan"), u = cur();
  if (!u) { host.innerHTML = `<div class="un-empty">Choose a template or a unit from the office library.</div>`; return; }
  const f = U.figures(u);
  const xs = [f.box[0], f.box[2], ...(u.extras || []).flatMap((e) => [e.x, e.x + e.w])], ys = [f.box[1], f.box[3], ...(u.extras || []).flatMap((e) => [e.y, e.y + e.h])];
  BX = Math.min(...xs); BY = Math.min(...ys);
  const W = Math.max(...xs) - BX, H = Math.max(...ys) - BY;
  const bw = host.clientWidth || 900, bh = host.clientHeight || 700;
  SC = Math.max(20, Math.min((bw - 220) / W, (bh - 200) / H));
  OX = (bw - W * SC) / 2; OY = (bh - H * SC) / 2;
  const sx = (x) => OX + (x - BX) * SC, sy = (y) => OY + (y - BY) * SC;
  const wall = +u.wall || 0.2, pt = +u.part || 0.1, party = +u.party || 0.2;
  let g = "";
  // the extras behind, dashed
  for (const e of u.extras || []) {
    const X = sx(e.x), Y = sy(e.y), w = e.w * SC, h = e.h * SC, sp = (+e.splay || 0) * SC;
    const pts = sp ? `${X},${Y} ${X + w},${Y} ${X + w},${Y + h - sp} ${X + w - sp},${Y + h} ${X},${Y + h}` : `${X},${Y} ${X + w},${Y} ${X + w},${Y + h} ${X},${Y + h}`;
    g += `<polygon class="un-ex" data-xi="${(u.extras || []).indexOf(e)}" points="${pts}" fill="${e.kind === "roof" ? "#eef1f4" : "#dfe9f3"}" stroke="#3c4650" stroke-width="1" stroke-dasharray="${e.kind === "pd" || e.kind === "af" ? "0" : "5 3"}" />`;
    const k = U.EXTRAS[e.kind] || {};
    if (w > 22 && h > 14) g += `<text x="${X + w / 2}" y="${Y + h / 2 - 1}" text-anchor="middle" font-size="${Math.min(11, w / 5)}" fill="#3c4650">${esc(k.zh || "")}</text><text x="${X + w / 2}" y="${Y + h / 2 + 10}" text-anchor="middle" font-size="${Math.min(10, w / 6)}" fill="#3c4650">${esc(k.ab || "")}</text>`;
  }
  // the rooms
  for (const r of u.rooms) {
    const X = sx(r.x), Y = sy(r.y), w = r.w * SC, h = r.h * SC, sel = SELR === r.id;
    g += `<rect class="un-r" data-rid="${esc(r.id)}" x="${X}" y="${Y}" width="${w}" height="${h}" fill="${sel ? "#a9c6e8" : "#c6d9ef"}" />`;
  }
  g += fixtures(u, sx, sy);
  // the walls: external thick, party, partitions thin; open kitchens none
  for (const e of f.edges) {
    if (U.isOpen(u, e)) { g += `<line x1="${sx(e.x1)}" y1="${sy(e.y1)}" x2="${sx(e.x2)}" y2="${sy(e.y2)}" stroke="#4a5866" stroke-width="1" stroke-dasharray="6 4" />`; continue; }
    const t = (e.kind === "ext" ? wall : e.kind === "party" ? party : pt) * SC;
    g += `<line x1="${sx(e.x1)}" y1="${sy(e.y1)}" x2="${sx(e.x2)}" y2="${sy(e.y2)}" stroke="${e.kind === "part" ? "#2a2f35" : "#111"}" stroke-width="${Math.max(e.kind === "part" ? 2 : 4, t)}" stroke-linecap="square" />`;
  }
  // the doors: a gap and the swing
  for (const d of u.doors || []) {
    const r = u.rooms.find((q) => q.id === d.room); if (!r) continue;
    const dw = (+d.w || 0.8) * SC, at = (+d.at || 0) * SC, th = (d.entry ? wall : pt) * SC + 3;
    let x1, y1, x2, y2, arc;
    const X = sx(r.x), Y = sy(r.y), w = r.w * SC, h = r.h * SC;
    if (d.side === "n" || d.side === "s") {
      const yy = d.side === "n" ? Y : Y + h, dir = d.side === "n" ? 1 : -1;
      x1 = X + at; x2 = x1 + dw; y1 = y2 = yy;
      arc = `M ${x1} ${yy} L ${x1} ${yy + dir * dw} A ${dw} ${dw} 0 0 ${dir > 0 ? 0 : 1} ${x2} ${yy}`;
    } else {
      const xx = d.side === "w" ? X : X + w, dir = d.side === "w" ? 1 : -1;
      y1 = Y + at; y2 = y1 + dw; x1 = x2 = xx;
      arc = `M ${xx} ${y1} L ${xx + dir * dw} ${y1} A ${dw} ${dw} 0 0 ${dir > 0 ? 1 : 0} ${xx} ${y2}`;
    }
    g += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#c6d9ef" stroke-width="${th}" /><path d="${arc}" fill="none" stroke="#2a2f35" stroke-width="1" />`;
  }
  // the labels
  for (const r of u.rooms) {
    const k = U.KINDS[r.kind] || {}; if (!k.zh && !k.ab) continue;
    const X = sx(r.x + r.w / 2), Y = sy(r.y + r.h / 2), w = r.w * SC, fs = Math.max(9, Math.min(13, w / 7));
    const nm = r.name && r.name !== k.label ? r.name : "";
    g += `<text x="${X}" y="${Y - 4}" text-anchor="middle" font-size="${fs}" fill="#1f2a36">${esc(k.zh)}${nm && /\d/.test(nm) ? " " + esc(nm.match(/\d+/)[0]) : ""}</text><text x="${X}" y="${Y + fs}" text-anchor="middle" font-size="${fs - 1}" fill="#1f2a36">${esc(k.ab)}${nm && /\d/.test(nm) ? esc(nm.match(/\d+/)[0]) : ""}</text>
      <text x="${X}" y="${Y + fs * 2 + 2}" text-anchor="middle" font-size="${fs - 3}" fill="#5b6b7b">${f2(r.w)} × ${f2(r.h)}</text>`;
  }
  // the wall lines to drag
  for (const [i, e] of f.edges.entries()) {
    const v = e.x1 === e.x2, hw = 6;
    g += v ? `<rect class="un-drag v" data-ei="${i}" x="${sx(e.x1) - hw}" y="${sy(e.y1)}" width="${hw * 2}" height="${(e.y2 - e.y1) * SC}" />`
      : `<rect class="un-drag h" data-ei="${i}" x="${sx(e.x1)}" y="${sy(e.y1) - hw}" width="${(e.x2 - e.x1) * SC}" height="${hw * 2}" />`;
  }
  // overall dimensions
  const [ax, ay, bx2, by2] = f.box;
  g += `<line x1="${sx(ax)}" y1="${sy(BY) - 22}" x2="${sx(bx2)}" y2="${sy(BY) - 22}" stroke="#333" /><text x="${sx((ax + bx2) / 2)}" y="${sy(BY) - 28}" text-anchor="middle" font-size="12">${f2(bx2 - ax)} m</text>`;
  g += `<line x1="${sx(BX + W) + 22}" y1="${sy(ay)}" x2="${sx(BX + W) + 22}" y2="${sy(by2)}" stroke="#333" /><text x="${sx(BX + W) + 28}" y="${sy((ay + by2) / 2)}" font-size="12">${f2(by2 - ay)} m</text>`;
  g += `<text x="${bw - 20}" y="${bh - 18}" text-anchor="end" font-size="11" fill="#6b7785">${esc(u.name || "")} · ${f.saleableFt} ft² · ${f1(f.saleable)} m²</text>`;
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}" font-family="'Noto Sans HK', 'PingFang HK', sans-serif">${g}</svg>`;
}
/* bath: tub or shower, WC and basin; kitchen: the counter; store: ST */
function fixtures(u, sx, sy) {
  let g = "";
  const S = (x, y, w, h, extra = "") => `<rect x="${sx(x)}" y="${sy(y)}" width="${w * SC}" height="${h * SC}" fill="none" stroke="#2a2f35" stroke-width="1" ${extra}/>`;
  for (const r of u.rooms) {
    if (r.kind === "BATH" || r.kind === "ENS") {
      const long = r.w >= r.h;
      if (long) { g += S(r.x + 0.1, r.y + 0.1, Math.min(1.5, r.w - 0.2), 0.7, 'rx="3"'); g += S(r.x + r.w - 0.55, r.y + r.h - 0.6, 0.4, 0.5, 'rx="8"'); }
      else { g += S(r.x + 0.1, r.y + 0.1, 0.7, Math.min(1.5, r.h - 0.2), 'rx="3"'); g += S(r.x + r.w - 0.5, r.y + r.h - 0.55, 0.4, 0.45, 'rx="8"'); }
      g += `<circle cx="${sx(r.x + r.w - 0.3)}" cy="${sy(r.y + 0.35)}" r="${0.17 * SC}" fill="none" stroke="#2a2f35" stroke-width="1" />`;
    }
    if (r.kind === "OKIT" || r.kind === "KIT") {
      const long = r.w >= r.h;
      g += long ? S(r.x + 0.05, r.y + 0.05, r.w - 0.1, 0.6, 'stroke-dasharray="4 2"') : S(r.x + 0.05, r.y + 0.05, 0.6, r.h - 0.1, 'stroke-dasharray="4 2"');
      g += S(r.x + 0.2, r.y + 0.12, 0.45, 0.4);
    }
    if (r.kind === "STORE") g += `<text x="${sx(r.x + r.w / 2)}" y="${sy(r.y + r.h / 2) + 4}" text-anchor="middle" font-size="10">ST</text>`;
  }
  return g;
}
function wirePlan() {
  const host = $("#st-uplan");
  let drag = null;
  host.addEventListener("pointerdown", (ev) => {
    const t = ev.target, u = cur(); if (!u) return;
    if (t.dataset.rid && !t.classList.contains("un-drag")) { SELR = t.dataset.rid; render(); return; }
    if (!C.can() || t.dataset.ei == null) return;
    const e = U.figures(u).edges[+t.dataset.ei]; if (!e) return;
    drag = { e, x: ev.clientX, y: ev.clientY, u0: JSON.parse(JSON.stringify(u)), alt: ev.altKey };
    host.setPointerCapture(ev.pointerId); ev.preventDefault();
  });
  host.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const st = store(), e = drag.e, v = e.x1 === e.x2;
    const dist = v ? (ev.clientX - drag.x) / SC : (ev.clientY - drag.y) / SC;
    // the whole wall line moves (Alt: only this piece)
    st.list[st.sel] = U.moveLine(drag.u0, v ? "x" : "y", v ? e.x1 : e.y1, dist, drag.alt ? (v ? e.y1 : e.x1) : null, drag.alt ? (v ? e.y2 : e.x2) : null);
    render();
  });
  const end = () => { if (drag) { drag = null; changed(); } };
  host.addEventListener("pointerup", end);
  host.addEventListener("pointercancel", end);
  window.addEventListener("resize", () => ON && drawPlan());
}
