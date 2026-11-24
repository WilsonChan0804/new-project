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
  if (!Array.isArray(st.list)) st.list = [];
  for (let i = 0; i < st.list.length; i++) if (st.list[i] && st.list[i].rows) st.list[i] = U.fromRows(st.list[i]);
  for (const u of st.list) { if (!Array.isArray(u.windows)) u.windows = U.genWindows(u); if (!Array.isArray(u.fixtures)) u.fixtures = U.genFixtures(u); }
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
  const exOpt = (k) => Object.entries(Object.assign({ bay: { label: "Balcony / UP / A/C bay" } }, U.EXTRAS)).map(([v, q]) => `<option value="${v}"${v === k ? " selected" : ""}>${q.label}</option>`).join("");
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
        ${e.kind === "bal" || e.kind === "up" || e.kind === "bay" ? `splay ${num(`data-esp="${i}"`, e.splay || 0)}` : ""}
        ${e.kind === "bay" ? `<div class="un-bay">${(e.parts || []).map((q, k) => `<span><select data-bpk="${i}.${k}"${dis}>${["bal", "up", "acp"].map((v) => `<option value="${v}"${v === q.kind ? " selected" : ""}>${U.EXTRAS[v].label}</option>`).join("")}</select> ${num(`data-bpl="${i}.${k}"`, q.len)} m${can ? `<button type="button" class="ghost st-ib" data-bpdel="${i}.${k}">×</button>` : ""}</span>`).join("")}${can ? `<button type="button" class="ghost st-ib" data-bpadd="${i}">+ part</button>` : ""}<small>parts along the bay's long side</small></div>` : ""}
        ${e.kind === "acp" ? `<label class="st-chk" title="Meets the Code of Practice for external maintenance (APP-19 3(c))"><input type="checkbox" data-edfs="${i}"${e.dfs ? " checked" : ""}${dis}> DfS</label>` : ""}
        ${can ? `<button type="button" class="ghost st-ib" data-edel="${i}">×</button>` : ""}</div>`).join("");
    body = `
      <section class="st-card">
        <div class="st-head"><input class="ms-name" data-uf="name" value="${esc(u.name || "")}"${dis}><span class="muted">${f2(f.W)} × ${f2(f.D)} m</span></div>
        ${u.src ? `<p class="muted st-note">${esc(u.src)}</p>` : ""}
        <div class="st-bigs un-bigs">
          ${big("Saleable area", `${f1(f.saleable)} <i>m²</i>`, `<b>${f.saleableFt} ft²</b> · balcony ${f2(f.bal)} + UP ${f2(f.up)} m² included`)}
          ${big("Unit GFA", `${f1(f.gfa)} <i>m²</i>`, `enclosed ${f2(f.enclosed)} m²`)}
          ${big("Concessions", `${f2(f.balEx + f.upEx + f.acpFree + f.acpCapEx + f.cwEx + f.pcEx)} <i>m²</i>`, `under the 10% cap ${f2(f.capped)}${f.pcEx ? ` (precast façade ${f2(f.pcEx)})` : ""} · A/C platforms not counted ${f2(f.acpFree)}${f.cwEx ? ` · curtain wall ${f2(f.cwEx)} not GFA` : ""}`)}
          ${big("Usable", `${f1(f.internal)} <i>m²</i>`, `inside the walls · ${f.efficiency ? Math.round(f.efficiency * 100) : "–"}% of the GFA`)}
        </div>
        ${f.warn.length ? `<ul class="un-warn">${f.warn.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : `<p class="st-sent good">No warnings.</p>`}
        <p class="muted st-note">Saleable area (First-hand Sales Ordinance s.8): to the outside of external walls and the middle of party walls, partitions included; balcony and utility platform added, A/C platform, pipe duct and features not. Façades: curtain wall ${esc(U.FACADES.cw.src)}; precast ${esc(U.FACADES.pc.src)}. Concessions: balcony ${esc(U.RULES.bal.src)}; utility platform ${esc(U.RULES.up.src)}; A/C platform ${esc(U.RULES.acp.src)}.</p>
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
          <label>External walls <select data-uf="facadeType"${dis}>${Object.entries(U.FACADES).map(([k, q]) => `<option value="${k}"${(u.facadeType || "rc") === k ? " selected" : ""}>${q.label}</option>`).join("")}</select></label>
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
        ${u ? `<div class="st-row"><button type="button" class="ghost st-ib" data-udup>Duplicate</button><button type="button" class="ghost st-ib" data-umir title="A handed copy: the same layout flipped left to right">⇋ Mirror</button><button type="button" class="ghost st-ib" data-udel>Remove</button><button type="button" class="ghost st-ib" data-usave title="${u.libId ? "Update the entry it came from" : "Add it to the office library"}">${u.libId ? "Update in the office library" : "Save to the office library"}</button><button type="button" class="ghost st-ib" data-usavenew>Save as new</button><button type="button" class="ghost st-ib" data-usvg>SVG</button></div>` : ""}` : ""}
    </section>
    ${body}`;
  drawPlan();
}

function onChange(ev) {
  const t = ev.target, st = store(), u = cur(), d = t.dataset;
  const num = (v, x) => (isNaN(parseFloat(v)) ? x : parseFloat(v));
  if (d.unew != null && t.value) { st.list.push(copyNamed(TEMPLATES[t.value], st.list)); st.sel = st.list.length - 1; SELR = null; return changed(); }
  if (d.ulib != null && t.value) { const x = LIB.units.find((q) => q.id === t.value); if (x) { const c = copyNamed(x.unit.rows ? U.fromRows(x.unit) : x.unit, st.list); c.libId = x.id; st.list.push(c); st.sel = st.list.length - 1; toast(`${x.name} copied into this project`); return changed(); } }
  if (!u) return;
  if (d.uf) { u[d.uf] = ["name", "facade", "facadeType"].includes(d.uf) ? t.value : Math.max(0, num(t.value, u[d.uf])); return changed(); }
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
  if (d.ek != null) { const e = X(d.ek); e.kind = t.value; if (t.value === "bay" && !e.parts) e.parts = [{ kind: "bal", len: Math.max(e.w, e.h) * 0.5 }, { kind: "up", len: Math.max(e.w, e.h) * 0.3 }, { kind: "acp", len: Math.max(e.w, e.h) * 0.2 }]; return changed(); }
  if (d.bpk) { const [i, k] = d.bpk.split(".").map(Number); X(i).parts[k].kind = t.value; return changed(); }
  if (d.bpl) { const [i, k] = d.bpl.split(".").map(Number), e = X(i); e.parts[k].len = Math.max(0.3, num(t.value, 1)); const L = e.parts.reduce((s2, q) => s2 + q.len, 0); if (e.h >= e.w) e.h = +L.toFixed(3); else e.w = +L.toFixed(3); return changed(); }
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
  if (d.umir != null) { const v = U.mirrorUnit(ensure(u)); delete v.libId; st.list[st.sel] = v; SEL = null; return changed(); }
  if (d.udup != null) { st.list.push(copyNamed(u, st.list)); st.sel = st.list.length - 1; return changed(); }
  if (d.udel != null) { if (!confirm(`Remove ${u.name}?`)) return; st.list.splice(st.sel, 1); st.sel = Math.min(st.sel, st.list.length - 1); return changed(); }
  if (d.usave != null || d.usavenew != null) {
    try {
      let id = null;
      if (d.usave != null) {
        const ex = (LIB.units || []).find((x) => x.id === u.libId) || (LIB.units || []).find((x) => x.name === u.name);
        if (ex && !confirm(`Update "${ex.name}" in the office library with this unit?`)) return;
        id = ex ? ex.id : null;
      } else {
        const nm = prompt("Name in the office library", u.name + " (edited)"); if (!nm) return;
        u.name = nm;
      }
      const body = JSON.parse(JSON.stringify(u)); delete body.libId;
      LIB = await api("/api/units/library", { method: "PUT", body: JSON.stringify({ id, unit: body }) });
      const row = id ? LIB.units.find((x) => x.id === id) : LIB.units.slice().reverse().find((x) => x.name === u.name);
      if (row) u.libId = row.id;
      C.save(); toast(`${u.name} saved to the office library`); render();
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
  if (d.bpadd != null) { const e = u.extras[+d.bpadd]; e.parts.push({ kind: "acp", len: 0.6 }); if (e.h >= e.w) e.h = +(e.h + 0.6).toFixed(3); else e.w = +(e.w + 0.6).toFixed(3); return changed(); }
  if (d.bpdel) { const [i, k] = d.bpdel.split(".").map(Number), e = u.extras[i], q = e.parts.splice(k, 1)[0]; if (e.h >= e.w) e.h = +(e.h - q.len).toFixed(3); else e.w = +(e.w - q.len).toFixed(3); if (!e.parts.length) u.extras.splice(i, 1); return changed(); }
}

/* ---------- the plan, as a sales brochure: walls, doors, fixtures, labels */
/* ---------- the plan, as a sales brochure: walls, windows, doors, fittings, labels, dimension chains */
let SC = 60, OX = 40, OY = 40, BX = 0, BY = 0;
let SEL = null;      // {t: "wall"|"door"|"win"|"fix", i | key}
let TOOL = "select"; // select | door | window | split-x | split-y | room | fix:<kind>
let ROOMK = "BR";     // the kind a drawn room gets
let LIVE = null;     // while a wall line is dragged: {axis, at, d}
const DIMS = () => { try { return localStorage.getItem("lwk-viewer:un-dims") || "chains"; } catch (e) { return "chains"; } };
const FIXK = { bath: "Bath tub", shower: "Shower", wc: "WC", basin: "Basin", counter: "Kitchen counter", sink: "Sink", hob: "Hob", wardrobe: "Wardrobe" };

function ensure(u) {
  if (!Array.isArray(u.windows)) u.windows = U.genWindows(u);
  if (!Array.isArray(u.fixtures)) u.fixtures = U.genFixtures(u);
  u.walls = u.walls && typeof u.walls === "object" ? u.walls : {};
  return u;
}
/* a point along a room's side: its two ends in plan metres */
function sideSeg(r, side, at, w) {
  if (side === "n") return [[r.x + at, r.y], [r.x + at + w, r.y], [0, 1]];
  if (side === "s") return [[r.x + at, r.y + r.h], [r.x + at + w, r.y + r.h], [0, -1]];
  if (side === "w") return [[r.x, r.y + at], [r.x, r.y + at + w], [1, 0]];
  return [[r.x + r.w, r.y + at], [r.x + r.w, r.y + at + w], [-1, 0]];
}

function drawPlan() {
  const host = $("#st-uplan"), u0 = cur();
  if (!u0) { host.innerHTML = `<div class="un-empty">Choose a template or a unit from the office library.</div>`; return; }
  const u = ensure(u0), f = U.figures(u);
  const exs = U.expandBays(u.extras || []);
  const xs = [f.box[0], f.box[2], ...exs.flatMap((e) => [e.x, e.x + e.w])], ys = [f.box[1], f.box[3], ...exs.flatMap((e) => [e.y, e.y + e.h])];
  BX = Math.min(...xs); BY = Math.min(...ys);
  const W = Math.max(...xs) - BX, H = Math.max(...ys) - BY;
  const bw = host.clientWidth || 900, bh = host.clientHeight || 700;
  SC = Math.max(20, Math.min((bw - 260) / W, (bh - 260) / H));
  OX = (bw - W * SC) / 2; OY = (bh - H * SC) / 2 + 20;
  const sx = (x) => OX + (x - BX) * SC, sy = (y) => OY + (y - BY) * SC;
  const wall = +(u.wall ?? 0.15), pt = +(u.part ?? 0.075), party = +(u.party ?? 0.15);
  let g = "";
  // the extras behind: bays as one dashed outline with their parts
  for (const [xi, e] of (u.extras || []).entries()) {
    const X = sx(e.x), Y = sy(e.y), w = e.w * SC, h = e.h * SC, sp = (+e.splay || 0) * SC;
    const pts = sp && e.splayL ? `${X},${Y} ${X + w},${Y} ${X + w},${Y + h} ${X + sp},${Y + h} ${X},${Y + h - sp}` : sp ? `${X},${Y} ${X + w},${Y} ${X + w},${Y + h - sp} ${X + w - sp},${Y + h} ${X},${Y + h}` : `${X},${Y} ${X + w},${Y} ${X + w},${Y + h} ${X},${Y + h}`;
    g += `<polygon data-xi="${xi}" points="${pts}" fill="${e.kind === "roof" ? "#eef1f4" : "#dfe9f3"}" stroke="#3c4650" stroke-width="1.2" stroke-dasharray="${e.kind === "pd" || e.kind === "af" ? "0" : "6 3"}" />`;
    const parts = e.kind === "bay" ? U.expandBays([e]) : [e];
    parts.forEach((p, k) => {
      const PX = sx(p.x), PY = sy(p.y), pw = p.w * SC, ph = p.h * SC;
      if (e.kind === "bay" && k > 0) g += (e.h >= e.w) ? `<line x1="${PX}" y1="${PY}" x2="${PX + pw}" y2="${PY}" stroke="#3c4650" stroke-width="0.8" stroke-dasharray="3 2" />` : `<line x1="${PX}" y1="${PY}" x2="${PX}" y2="${PY + ph}" stroke="#3c4650" stroke-width="0.8" stroke-dasharray="3 2" />`;
      const kk = U.EXTRAS[p.kind] || {};
      if (pw > 22 && ph > 14) g += `<text x="${PX + pw / 2}" y="${PY + ph / 2 - 1}" text-anchor="middle" font-size="${Math.min(11, pw / 5)}" fill="#3c4650">${esc(kk.zh || "")}</text><text x="${PX + pw / 2}" y="${PY + ph / 2 + 10}" text-anchor="middle" font-size="${Math.min(10, pw / 6)}" fill="#3c4650">${esc(kk.ab || "")} ${f2(p.w * p.h)}</text>`;
    });
  }
  // the rooms
  const near = LIVE ? new Set(u.rooms.filter((r) => LIVE.axis === "x" ? Math.abs(r.x - LIVE.at) < 0.01 || Math.abs(r.x + r.w - LIVE.at) < 0.01 : Math.abs(r.y - LIVE.at) < 0.01 || Math.abs(r.y + r.h - LIVE.at) < 0.01).map((r) => r.id)) : null;
  for (const r of u.rooms) g += `<rect data-rid="${esc(r.id)}" class="un-r" x="${sx(r.x)}" y="${sy(r.y)}" width="${r.w * SC}" height="${r.h * SC}" fill="${near && near.has(r.id) ? "#f6d9b8" : SELR === r.id ? "#a9c6e8" : "#c6d9ef"}" />`;
  // the fittings
  for (const [i, x] of u.fixtures.entries()) g += fixture(x, sx, sy, SEL && SEL.t === "fix" && SEL.i === i, i);
  // the walls
  for (const e of f.edges) {
    const sel = SEL && SEL.t === "wall" && SEL.key === e.key;
    if (U.isOpen(u, e)) { g += `<line x1="${sx(e.x1)}" y1="${sy(e.y1)}" x2="${sx(e.x2)}" y2="${sy(e.y2)}" stroke="${sel ? "#f28022" : "#4a5866"}" stroke-width="${sel ? 3 : 1}" stroke-dasharray="6 4" />`; continue; }
    const t = (e.t != null ? e.t : e.kind === "ext" ? wall : e.kind === "party" ? party : pt) * SC;
    if (e.kind === "ext" && e.facade === "cw") {
      // a curtain wall: glass all along, the mullions
      const vert = e.x1 === e.x2, o = Math.max(2, t / 3);
      g += `<line x1="${sx(e.x1)}" y1="${sy(e.y1)}" x2="${sx(e.x2)}" y2="${sy(e.y2)}" stroke="${sel ? "#f9d2ad" : "#d7ecf7"}" stroke-width="${Math.max(4, t)}" />`;
      g += vert ? `<line x1="${sx(e.x1) - o}" y1="${sy(e.y1)}" x2="${sx(e.x2) - o}" y2="${sy(e.y2)}" stroke="#2b6c8f" stroke-width="1" /><line x1="${sx(e.x1) + o}" y1="${sy(e.y1)}" x2="${sx(e.x2) + o}" y2="${sy(e.y2)}" stroke="#2b6c8f" stroke-width="1" />`
        : `<line x1="${sx(e.x1)}" y1="${sy(e.y1) - o}" x2="${sx(e.x2)}" y2="${sy(e.y2) - o}" stroke="#2b6c8f" stroke-width="1" /><line x1="${sx(e.x1)}" y1="${sy(e.y1) + o}" x2="${sx(e.x2)}" y2="${sy(e.y2) + o}" stroke="#2b6c8f" stroke-width="1" />`;
      const L = e.len, k = Math.max(1, Math.round(L / 1.2));
      for (let j = 0; j <= k; j++) { const q = j / k, X = sx(e.x1 + (e.x2 - e.x1) * q), Y = sy(e.y1 + (e.y2 - e.y1) * q); g += vert ? `<line x1="${X - o - 2}" y1="${Y}" x2="${X + o + 2}" y2="${Y}" stroke="#2b6c8f" stroke-width="1.5" />` : `<line x1="${X}" y1="${Y - o - 2}" x2="${X}" y2="${Y + o + 2}" stroke="#2b6c8f" stroke-width="1.5" />`; }
      continue;
    }
    if (e.kind === "ext" && e.facade === "pc") {
      g += `<line x1="${sx(e.x1)}" y1="${sy(e.y1)}" x2="${sx(e.x2)}" y2="${sy(e.y2)}" stroke="${sel ? "#f28022" : "#6f7b87"}" stroke-width="${Math.max(4, t)}" stroke-linecap="square" /><line x1="${sx(e.x1)}" y1="${sy(e.y1)}" x2="${sx(e.x2)}" y2="${sy(e.y2)}" stroke="#fff" stroke-width="1" stroke-dasharray="2 5" />`;
      continue;
    }
    g += `<line x1="${sx(e.x1)}" y1="${sy(e.y1)}" x2="${sx(e.x2)}" y2="${sy(e.y2)}" stroke="${sel ? "#f28022" : e.kind === "part" ? "#2a2f35" : "#111"}" stroke-width="${Math.max(e.kind === "part" ? 2 : 3.5, t)}" stroke-linecap="square" />`;
  }
  // the wall lines to drag / click
  for (const e of f.edges) {
    const v = e.x1 === e.x2, hw = 6;
    g += v ? `<rect class="un-drag v" data-ek="${esc(e.key)}" x="${sx(e.x1) - hw}" y="${sy(e.y1)}" width="${hw * 2}" height="${(e.y2 - e.y1) * SC}" />`
      : `<rect class="un-drag h" data-ek="${esc(e.key)}" x="${sx(e.x1)}" y="${sy(e.y1) - hw}" width="${(e.x2 - e.x1) * SC}" height="${hw * 2}" />`;
  }
  // the windows: a gap in the wall with the glazing lines
  for (const [i, w] of u.windows.entries()) {
    const r = u.rooms.find((q) => q.id === w.room); if (!r) continue;
    const [a, b] = sideSeg(r, w.side, +w.at || 0, +w.w || 1), th = Math.max(4, wall * SC) + 1, sel = SEL && SEL.t === "win" && SEL.i === i;
    const vert = a[0] === b[0], o = th / 4;
    g += `<line x1="${sx(a[0])}" y1="${sy(a[1])}" x2="${sx(b[0])}" y2="${sy(b[1])}" stroke="#fff" stroke-width="${th}" />`;
    g += vert ? `<line x1="${sx(a[0]) - o}" y1="${sy(a[1])}" x2="${sx(b[0]) - o}" y2="${sy(b[1])}" stroke="${sel ? "#f28022" : "#111"}" stroke-width="1" /><line x1="${sx(a[0]) + o}" y1="${sy(a[1])}" x2="${sx(b[0]) + o}" y2="${sy(b[1])}" stroke="${sel ? "#f28022" : "#111"}" stroke-width="1" />`
      : `<line x1="${sx(a[0])}" y1="${sy(a[1]) - o}" x2="${sx(b[0])}" y2="${sy(b[1]) - o}" stroke="${sel ? "#f28022" : "#111"}" stroke-width="1" /><line x1="${sx(a[0])}" y1="${sy(a[1]) + o}" x2="${sx(b[0])}" y2="${sy(b[1]) + o}" stroke="${sel ? "#f28022" : "#111"}" stroke-width="1" />`;
    g += `<line class="un-hit" data-wi="${i}" x1="${sx(a[0])}" y1="${sy(a[1])}" x2="${sx(b[0])}" y2="${sy(b[1])}" stroke="transparent" stroke-width="${th + 8}" />`;
  }
  // the doors: a gap, the leaf from its hinge, the swing
  for (const [i, d] of (u.doors || []).entries()) {
    const r = u.rooms.find((q) => q.id === d.room); if (!r) continue;
    const dw = +d.w || 0.8, [a, b, inn] = sideSeg(r, d.side, +d.at || 0, dw), sel = SEL && SEL.t === "door" && SEL.i === i;
    const H = d.hinge === "end" ? b : a, O = d.hinge === "end" ? a : b, k = d.swing === "out" ? -1 : 1;
    const P = [H[0] + inn[0] * dw * k, H[1] + inn[1] * dw * k];
    const cr = (P[0] - H[0]) * (O[1] - H[1]) - (P[1] - H[1]) * (O[0] - H[0]);
    const th = (d.entry ? wall : pt) * SC + 3;
    g += `<line x1="${sx(a[0])}" y1="${sy(a[1])}" x2="${sx(b[0])}" y2="${sy(b[1])}" stroke="#c6d9ef" stroke-width="${th}" />`;
    g += `<path d="M ${sx(H[0])} ${sy(H[1])} L ${sx(P[0])} ${sy(P[1])} A ${dw * SC} ${dw * SC} 0 0 ${cr > 0 ? 1 : 0} ${sx(O[0])} ${sy(O[1])}" fill="none" stroke="${sel ? "#f28022" : "#2a2f35"}" stroke-width="${sel ? 2 : 1}" />`;
    g += `<line class="un-hit" data-di="${i}" x1="${sx(a[0])}" y1="${sy(a[1])}" x2="${sx(b[0])}" y2="${sy(b[1])}" stroke="transparent" stroke-width="${th + 10}" />`;
  }
  // the labels
  for (const r of u.rooms) {
    const k = U.KINDS[r.kind] || {}; if (!k.zh && !k.ab) continue;
    const X = sx(r.x + r.w / 2), Y = sy(r.y + r.h / 2), w = r.w * SC, fs = Math.max(9, Math.min(13, w / 7)), lv = near && near.has(r.id);
    const no = r.name && /\d/.test(r.name) ? r.name.match(/\d+/)[0] : "";
    g += `<text x="${X}" y="${Y - 4}" text-anchor="middle" font-size="${fs}" fill="#1f2a36" pointer-events="none">${esc(k.zh)}${no ? " " + no : ""}</text><text x="${X}" y="${Y + fs}" text-anchor="middle" font-size="${fs - 1}" fill="#1f2a36" pointer-events="none">${esc(k.ab)}${no}</text>
      <text x="${X}" y="${Y + fs * 2 + 2}" text-anchor="middle" font-size="${lv ? fs : fs - 3}" font-weight="${lv ? 700 : 400}" fill="${lv ? "#b4520a" : "#5b6b7b"}" pointer-events="none">${f2(r.w)} × ${f2(r.h)}</text>`;
  }
  g += dims(u, f, sx, sy);
  if (LIVE) g += `<text x="${bw / 2}" y="${bh - 40}" text-anchor="middle" font-size="14" font-weight="700" fill="#b4520a">${LIVE.d >= 0 ? "+" : ""}${f2(LIVE.d)} m</text>`;
  g += `<text x="${bw - 20}" y="${bh - 18}" text-anchor="end" font-size="11" fill="#6b7785">${esc(u.name || "")} · ${f.saleableFt} ft² · ${f1(f.saleable)} m²</text>`;
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}" font-family="'Noto Sans HK', 'PingFang HK', sans-serif">${g}</svg>${toolbar()}${popup(u, f, sx, sy)}`;
}

/* the dimension chains: a tick at every wall line along each side, the room spans between, the overall outside */
function dims(u, f, sx, sy) {
  const mode = DIMS(); if (mode === "off") return "";
  const [x0, y0, x1, y1] = f.box, R = u.rooms, e = 0.01;
  const ex = U.expandBays(u.extras || []);
  const ox0 = Math.min(x0, ...ex.map((q) => q.x)), ox1 = Math.max(x1, ...ex.map((q) => q.x + q.w)), oy0 = Math.min(y0, ...ex.map((q) => q.y)), oy1 = Math.max(y1, ...ex.map((q) => q.y + q.h));
  let g = "";
  const tick = (X, Y, v) => (v ? `<line x1="${X - 4}" y1="${Y + 4}" x2="${X + 4}" y2="${Y - 4}" stroke="#333" />` : `<line x1="${X - 4}" y1="${Y + 4}" x2="${X + 4}" y2="${Y - 4}" stroke="#333" />`);
  const chainH = (vals, Y) => {
    const v = [...new Set(vals.map((q) => +q.toFixed(3)))].sort((a, b) => a - b);
    g += `<line x1="${sx(v[0])}" y1="${Y}" x2="${sx(v[v.length - 1])}" y2="${Y}" stroke="#333" stroke-width="0.8" />`;
    v.forEach((q, i) => { g += tick(sx(q), Y, true); if (i) { const L = q - v[i - 1]; if ((L * SC) > 18) g += `<text x="${(sx(q) + sx(v[i - 1])) / 2}" y="${Y - 4}" text-anchor="middle" font-size="10">${f2(L)}</text>`; } });
  };
  const chainV = (vals, X) => {
    const v = [...new Set(vals.map((q) => +q.toFixed(3)))].sort((a, b) => a - b);
    g += `<line x1="${X}" y1="${sy(v[0])}" x2="${X}" y2="${sy(v[v.length - 1])}" stroke="#333" stroke-width="0.8" />`;
    v.forEach((q, i) => { g += tick(X, sy(q), false); if (i) { const L = q - v[i - 1]; if ((L * SC) > 18) g += `<text x="${X - 5}" y="${(sy(q) + sy(v[i - 1])) / 2}" text-anchor="middle" font-size="10" transform="rotate(-90 ${X - 5} ${(sy(q) + sy(v[i - 1])) / 2})">${f2(L)}</text>`; } });
  };
  const top = sy(oy0) - 26, bot = sy(oy1) + 26, lef = sx(ox0) - 26, rig = sx(ox1) + 26;
  if (mode === "chains") {
    chainH(R.filter((r) => Math.abs(r.y - y0) < e).flatMap((r) => [r.x, r.x + r.w]), top);
    chainH(R.filter((r) => Math.abs(r.y + r.h - y1) < e).flatMap((r) => [r.x, r.x + r.w]), bot);
    chainV(R.filter((r) => Math.abs(r.x - x0) < e).flatMap((r) => [r.y, r.y + r.h]), lef);
    chainV(R.filter((r) => Math.abs(r.x + r.w - x1) < e).flatMap((r) => [r.y, r.y + r.h]), rig);
  }
  // overall
  chainH([x0, x1], top - 22); chainV([y0, y1], rig + 22);
  return g;
}

function fixture(x, sx, sy, sel, i) {
  const X = sx(x.x), Y = sy(x.y), w = x.w * SC, h = x.h * SC, st = sel ? "#f28022" : "#2a2f35", sw = sel ? 2 : 1;
  let g = `<g class="un-fix" data-fi="${i}">`;
  if (x.kind === "bath") g += `<rect x="${X}" y="${Y}" width="${w}" height="${h}" rx="4" fill="#fff" stroke="${st}" stroke-width="${sw}" /><rect x="${X + 5}" y="${Y + 5}" width="${w - 10}" height="${h - 10}" rx="10" fill="none" stroke="${st}" stroke-width="0.8" />`;
  else if (x.kind === "shower") g += `<rect x="${X}" y="${Y}" width="${w}" height="${h}" fill="#fff" stroke="${st}" stroke-width="${sw}" /><line x1="${X}" y1="${Y}" x2="${X + w}" y2="${Y + h}" stroke="${st}" stroke-width="0.6" /><line x1="${X + w}" y1="${Y}" x2="${X}" y2="${Y + h}" stroke="${st}" stroke-width="0.6" />`;
  else if (x.kind === "wc") { const long = h >= w; g += `<rect x="${X}" y="${Y}" width="${w}" height="${h}" rx="${Math.min(w, h) / 2.2}" fill="#fff" stroke="${st}" stroke-width="${sw}" />` + (long ? `<rect x="${X}" y="${(x.rot === 180 ? Y + h - h * 0.3 : Y)}" width="${w}" height="${h * 0.3}" fill="#fff" stroke="${st}" stroke-width="${sw}" />` : `<rect x="${(x.rot === 270 ? X + w - w * 0.3 : X)}" y="${Y}" width="${w * 0.3}" height="${h}" fill="#fff" stroke="${st}" stroke-width="${sw}" />`); }
  else if (x.kind === "basin") g += `<rect x="${X}" y="${Y}" width="${w}" height="${h}" fill="#fff" stroke="${st}" stroke-width="${sw}" /><ellipse cx="${X + w / 2}" cy="${Y + h / 2}" rx="${w * 0.35}" ry="${h * 0.32}" fill="none" stroke="${st}" stroke-width="0.8" />`;
  else if (x.kind === "counter") { const long = w >= h; g += `<rect x="${X}" y="${Y}" width="${w}" height="${h}" fill="#fff" stroke="${st}" stroke-width="${sw}" stroke-dasharray="5 2" />` + (long ? `<rect x="${X + w * 0.15}" y="${Y + h * 0.2}" width="${Math.min(w * 0.3, 0.5 * SC)}" height="${h * 0.6}" fill="none" stroke="${st}" /><circle cx="${X + w * 0.75}" cy="${Y + h / 2}" r="${h * 0.18}" fill="none" stroke="${st}" />` : `<rect x="${X + w * 0.2}" y="${Y + h * 0.15}" width="${w * 0.6}" height="${Math.min(h * 0.3, 0.5 * SC)}" fill="none" stroke="${st}" /><circle cx="${X + w / 2}" cy="${Y + h * 0.75}" r="${w * 0.18}" fill="none" stroke="${st}" />`); }
  else if (x.kind === "sink") g += `<rect x="${X}" y="${Y}" width="${w}" height="${h}" rx="3" fill="#fff" stroke="${st}" stroke-width="${sw}" />`;
  else if (x.kind === "hob") g += `<rect x="${X}" y="${Y}" width="${w}" height="${h}" fill="#fff" stroke="${st}" stroke-width="${sw}" /><circle cx="${X + w * 0.3}" cy="${Y + h / 2}" r="${Math.min(w, h) * 0.18}" fill="none" stroke="${st}" /><circle cx="${X + w * 0.7}" cy="${Y + h / 2}" r="${Math.min(w, h) * 0.18}" fill="none" stroke="${st}" />`;
  else if (x.kind === "wardrobe") g += `<rect x="${X}" y="${Y}" width="${w}" height="${h}" fill="none" stroke="${st}" stroke-width="${sw}" stroke-dasharray="2 2" /><line x1="${X}" y1="${Y}" x2="${X + w}" y2="${Y + h}" stroke="${st}" stroke-width="0.6" />`;
  return g + `<rect class="un-fhit" data-fi="${i}" x="${X}" y="${Y}" width="${w}" height="${h}" fill="transparent" /></g>`;
}

function toolbar() {
  if (!C.can()) return "";
  const b = (t, l, ti) => `<button type="button" data-tool="${t}" class="${TOOL === t ? "on" : ""}" title="${ti}">${l}</button>`;
  return `<div class="un-bar">${b("select", "↖ Select", "Click a wall, door, window or fitting; drag a wall line")}${b("door", "+ Door", "Click a wall where the door goes")}${b("window", "+ Window", "Click an external wall")}${b("split-x", "✂ Split │", "Click a room: a new wall up and down at that point")}${b("split-y", "✂ Split ─", "Click a room: a new wall across at that point")}${b("room", "▭ + Room", "Drag a rectangle beside the rooms: a new room (snaps to the walls, 50 mm grid)")}
    <select data-roomk title="The kind of the room you draw">${Object.entries(U.KINDS).map(([k, q]) => `<option value="${k}"${ROOMK === k ? " selected" : ""}>${q.label}</option>`).join("")}</select>
    <select data-fixadd title="Click a room to place it"><option value="">+ Fitting …</option>${Object.entries(FIXK).map(([k, v]) => `<option value="${k}"${TOOL === "fix:" + k ? " selected" : ""}>${v}</option>`).join("")}</select>
    <select data-dims title="Dimensions"><option value="chains"${DIMS() === "chains" ? " selected" : ""}>Dimensions: chains</option><option value="overall"${DIMS() === "overall" ? " selected" : ""}>overall</option><option value="off"${DIMS() === "off" ? " selected" : ""}>off</option></select></div>`;
}

/* the small menu by what is selected */
function popup(u, f, sx, sy) {
  if (!SEL || !C.can()) return "";
  let at = null, html = "";
  if (SEL.t === "wall") {
    const e = f.edges.find((q) => q.key === SEL.key); if (!e) return "";
    at = [sx((e.x1 + e.x2) / 2), sy((e.y1 + e.y2) / 2)];
    const o = u.walls[e.key] || {}, open = U.isOpen(u, e), def = e.kind === "ext" ? u.wall : e.kind === "party" ? u.party : u.part;
    html = `<b>${e.kind === "ext" ? "External wall" : e.kind === "party" ? "Party wall" : "Partition"}</b> ${f2(e.len)} m
      ${e.kind === "part" ? `<button type="button" data-pw="toggle">${open ? "Put the wall back" : "Delete wall"}</button><button type="button" data-pw="join">Join the rooms</button>` : ""}
      ${e.kind === "ext" ? `<label>façade <select data-pwf>${Object.entries(U.FACADES).map(([k, q]) => `<option value="${k}"${(o.f || u.facadeType || "rc") === k ? " selected" : ""}>${q.label}</option>`).join("")}</select></label>` : ""}
      <label>thickness <input type="number" step="0.005" min="0" data-pwt value="${o.t != null ? o.t : ""}" placeholder="${e.kind === "ext" && U.FACADES[o.f || u.facadeType || "rc"].t != null ? U.FACADES[o.f || u.facadeType || "rc"].t : def}"> m</label>
      <button type="button" data-pw="door">+ Door here</button>${e.kind !== "part" ? `<button type="button" data-pw="win">+ Window here</button>` : ""}`;
  } else if (SEL.t === "door") {
    const d = u.doors[SEL.i], r = d && u.rooms.find((q) => q.id === d.room); if (!r) return "";
    const [a, b] = sideSeg(r, d.side, +d.at || 0, +d.w || 0.8); at = [sx((a[0] + b[0]) / 2), sy((a[1] + b[1]) / 2)];
    html = `<b>Door</b> <button type="button" data-pd="hinge">⇋ Flip hinge</button><button type="button" data-pd="swing">${d.swing === "out" ? "Swing in" : "Swing out"}</button><label>w <input type="number" step="0.05" data-pdw value="${d.w}"> m</label><button type="button" data-pd="del">Remove</button><small>drag it along the wall</small>`;
  } else if (SEL.t === "win") {
    const w = u.windows[SEL.i], r = w && u.rooms.find((q) => q.id === w.room); if (!r) return "";
    const [a, b] = sideSeg(r, w.side, +w.at || 0, +w.w || 1); at = [sx((a[0] + b[0]) / 2), sy((a[1] + b[1]) / 2)];
    html = `<b>Window</b> <label>w <input type="number" step="0.05" data-pww value="${w.w}"> m</label><button type="button" data-pwin="del">Remove</button><small>drag it along the wall</small>`;
  } else if (SEL.t === "fix") {
    const x = u.fixtures[SEL.i]; if (!x) return "";
    at = [sx(x.x + x.w), sy(x.y)];
    html = `<b>${esc(FIXK[x.kind] || x.kind)}</b> <button type="button" data-pf="rot">⟳ Rotate 90°</button><label><input type="number" step="0.05" data-pfw value="${x.w}"> × <input type="number" step="0.05" data-pfh value="${x.h}"> m</label><button type="button" data-pf="del">Remove</button><small>drag to move</small>`;
  }
  return at ? `<div class="un-pop" style="left:${Math.round(at[0] + 12)}px;top:${Math.round(at[1] + 12)}px">${html}</div>` : "";
}

/* where a click on the plan is, in plan metres */
const toPlan = (ev) => { const r = $("#st-uplan").getBoundingClientRect(); return [BX + (ev.clientX - r.left - OX) / SC, BY + (ev.clientY - r.top - OY) / SC]; };
/* a wall edge: the room on it and that room's side */
function edgeRoomSide(e) {
  const vert = e.x1 === e.x2;
  if (e.kind === "part" || e.face) {
    if (vert) return { room: e.a, side: e.face ? e.face : "e", from: Math.min(e.y1, e.y2) };
    return { room: e.a, side: e.face ? e.face : "s", from: Math.min(e.x1, e.x2) };
  }
  return null;
}

/* a point for a new room: to an existing wall line within 0.25 m, else the 50 mm grid */
function snapRoom(u, P) {
  const xs = [], ys = [];
  for (const r of (u && u.rooms) || []) { xs.push(+r.x, +r.x + +r.w); ys.push(+r.y, +r.y + +r.h); }
  const s1 = (v, L) => { let b = null; for (const a of L) if (Math.abs(a - v) <= 0.25 && (b == null || Math.abs(a - v) < Math.abs(b - v))) b = a; return b != null ? b : Math.round(v * 20) / 20; };
  return [s1(P[0], xs), s1(P[1], ys)];
}
/* the rubber-band rectangle while a room is drawn, with its size */
function roomPreview(d) {
  const svg = $("#st-uplan svg"); if (!svg || !d.P1) return;
  let g = svg.querySelector(".un-newroom");
  if (!g) { g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.setAttribute("class", "un-newroom"); svg.appendChild(g); }
  const x0 = Math.min(d.P0[0], d.P1[0]), y0 = Math.min(d.P0[1], d.P1[1]), w = Math.abs(d.P1[0] - d.P0[0]), h = Math.abs(d.P1[1] - d.P0[1]);
  const X = OX + (x0 - BX) * SC, Y = OY + (y0 - BY) * SC;
  const ok = U.addRoom(cur(), { x: x0, y: y0, w, h }, ROOMK);
  g.innerHTML = `<rect x="${X}" y="${Y}" width="${w * SC}" height="${h * SC}" fill="${ok ? "rgba(242,128,34,.18)" : "rgba(200,40,40,.15)"}" stroke="${ok ? "#f28022" : "#c62828"}" stroke-width="1.5" stroke-dasharray="6 3" />
    <text x="${X + w * SC / 2}" y="${Y + h * SC / 2}" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="700" fill="#b4520a">${f2(w)} × ${f2(h)} m · ${f2(w * h)} m²</text>`;
}

function wirePlan() {
  const host = $("#st-uplan");
  let drag = null;
  host.addEventListener("change", (ev) => {
    const t = ev.target, u = cur(); if (!u) return;
    if (t.dataset.dims != null) { try { localStorage.setItem("lwk-viewer:un-dims", t.value); } catch (e) {} return drawPlan(); }
    if (t.dataset.roomk != null) { ROOMK = t.value; TOOL = "room"; return drawPlan(); }
    if (t.dataset.fixadd != null) { TOOL = t.value ? "fix:" + t.value : "select"; return drawPlan(); }
    if (t.dataset.pwf != null) { const o = u.walls[SEL.key] = u.walls[SEL.key] || {}; o.f = t.value; if (t.value === "cw") u.windows = u.windows.filter((w) => !(w.room === SEL.key.split(":")[0] && w.side === SEL.key.split(":")[1])); return changed(); }
    if (t.dataset.pwt != null) { const o = u.walls[SEL.key] = u.walls[SEL.key] || {}; if (t.value === "") delete o.t; else o.t = Math.max(0, parseFloat(t.value)); return changed(); }
    if (t.dataset.pdw != null) { u.doors[SEL.i].w = Math.max(0.5, parseFloat(t.value) || 0.8); return changed(); }
    if (t.dataset.pww != null) { u.windows[SEL.i].w = Math.max(0.3, parseFloat(t.value) || 1); return changed(); }
    if (t.dataset.pfw != null) { u.fixtures[SEL.i].w = Math.max(0.2, parseFloat(t.value) || 0.5); return changed(); }
    if (t.dataset.pfh != null) { u.fixtures[SEL.i].h = Math.max(0.2, parseFloat(t.value) || 0.5); return changed(); }
  });
  host.addEventListener("click", (ev) => {
    const t = ev.target.closest("button"); const u = cur(); if (!t || !u) return;
    const d = t.dataset;
    if (d.tool) { TOOL = d.tool; SEL = null; return drawPlan(); }
    const f = U.figures(u);
    if (d.pw) {
      const e = f.edges.find((q) => q.key === SEL.key); if (!e) return;
      if (d.pw === "toggle") { const o = u.walls[e.key] = u.walls[e.key] || {}; o.open = !U.isOpen(u, e); return changed(); }
      if (d.pw === "join") { const v = U.joinRooms(u, e.a, e.b); if (!v) return toast("These two rooms do not make one rectangle", true); { const st0 = store(); st0.list[st0.sel] = v; } SEL = null; return changed(); }
      const rs = edgeRoomSide(e);
      if (d.pw === "door") { u.doors.push({ room: rs.room, side: rs.side, at: +(Math.max(0, (e.len - 0.8) / 2) + (rs.from - (rs.side === "n" || rs.side === "s" ? u.rooms.find((q) => q.id === rs.room).x : u.rooms.find((q) => q.id === rs.room).y))).toFixed(2), w: 0.8, hinge: "start", swing: "in" }); SEL = { t: "door", i: u.doors.length - 1 }; return changed(); }
      if (d.pw === "win") { const r = u.rooms.find((q) => q.id === rs.room), ww = Math.min(1.5, e.len - 0.4); u.windows.push({ room: rs.room, side: rs.side, at: +((rs.from - (rs.side === "n" || rs.side === "s" ? r.x : r.y)) + (e.len - ww) / 2).toFixed(2), w: +ww.toFixed(2) }); SEL = { t: "win", i: u.windows.length - 1 }; return changed(); }
    }
    if (d.pd) { const dd = u.doors[SEL.i]; if (d.pd === "hinge") dd.hinge = dd.hinge === "end" ? "start" : "end"; if (d.pd === "swing") dd.swing = dd.swing === "out" ? "in" : "out"; if (d.pd === "del") { u.doors.splice(SEL.i, 1); SEL = null; } return changed(); }
    if (d.pwin === "del") { u.windows.splice(SEL.i, 1); SEL = null; return changed(); }
    if (d.pf) { if (d.pf === "rot") u.fixtures[SEL.i] = U.rotateFixture(u.fixtures[SEL.i]); if (d.pf === "del") { u.fixtures.splice(SEL.i, 1); SEL = null; } return changed(); }
  });
  host.addEventListener("pointerdown", (ev) => {
    const t = ev.target, u0 = cur(); if (!u0 || ev.target.closest(".un-bar,.un-pop")) return;
    const u = ensure(u0), f = U.figures(u), P = toPlan(ev), can = C.can();
    // tools that click a room or a wall
    if (can && TOOL !== "select") {
      if ((TOOL === "door" || TOOL === "window") && t.dataset.ek) {
        const e = f.edges.find((q) => q.key === t.dataset.ek), rs = e && edgeRoomSide(e);
        if (!e || (TOOL === "window" && e.kind === "part")) return toast("A window goes on an external wall", true);
        const r = u.rooms.find((q) => q.id === rs.room), along = rs.side === "n" || rs.side === "s" ? P[0] - r.x : P[1] - r.y;
        if (TOOL === "door") { u.doors.push({ room: rs.room, side: rs.side, at: +Math.max(0, along - 0.4).toFixed(2), w: 0.8, hinge: "start", swing: "in" }); SEL = { t: "door", i: u.doors.length - 1 }; }
        else { u.windows.push({ room: rs.room, side: rs.side, at: +Math.max(0, along - 0.6).toFixed(2), w: 1.2 }); SEL = { t: "win", i: u.windows.length - 1 }; }
        TOOL = "select"; return changed();
      }
      if (TOOL.startsWith("split") && t.dataset.rid) {
        const r = u.rooms.find((q) => q.id === t.dataset.rid), ax = TOOL === "split-x" ? "x" : "y";
        const v = U.splitRoom(u, r.id, ax, ax === "x" ? P[0] - r.x : P[1] - r.y);
        if (v === u) return toast("Too near the room's edge", true);
        { const st0 = store(); st0.list[st0.sel] = v; } TOOL = "select"; return changed();
      }
      if (TOOL === "room") {
        drag = { kind: "newroom", P0: snapRoom(u, P), P1: null };
        host.setPointerCapture(ev.pointerId); ev.preventDefault(); return;
      }
      if (TOOL.startsWith("fix:") && t.dataset.rid) {
        const k = TOOL.slice(4), sz = { bath: [1.5, 0.7], shower: [0.9, 0.9], wc: [0.4, 0.65], basin: [0.5, 0.4], counter: [1.8, 0.6], sink: [0.6, 0.5], hob: [0.6, 0.5], wardrobe: [1.2, 0.6] }[k];
        u.fixtures.push({ kind: k, x: +(P[0] - sz[0] / 2).toFixed(2), y: +(P[1] - sz[1] / 2).toFixed(2), w: sz[0], h: sz[1], rot: 0 });
        SEL = { t: "fix", i: u.fixtures.length - 1 }; TOOL = "select"; return changed();
      }
      return;
    }
    if (t.dataset.di != null) { SEL = { t: "door", i: +t.dataset.di }; if (can) drag = { kind: "door", i: +t.dataset.di, P, u0: JSON.parse(JSON.stringify(u)), moved: false }; drawPlan(); }
    else if (t.dataset.wi != null) { SEL = { t: "win", i: +t.dataset.wi }; if (can) drag = { kind: "win", i: +t.dataset.wi, P, u0: JSON.parse(JSON.stringify(u)), moved: false }; drawPlan(); }
    else if (t.dataset.fi != null) { SEL = { t: "fix", i: +t.dataset.fi }; if (can) drag = { kind: "fix", i: +t.dataset.fi, P, u0: JSON.parse(JSON.stringify(u)), moved: false }; drawPlan(); }
    else if (t.dataset.ek) {
      const e = f.edges.find((q) => q.key === t.dataset.ek);
      if (can && e) drag = { kind: "wall", e, key: e.key, x: ev.clientX, y: ev.clientY, u0: JSON.parse(JSON.stringify(u)), alt: ev.altKey, moved: false };
      else { SEL = { t: "wall", key: t.dataset.ek }; drawPlan(); }
    } else if (t.dataset.rid) { SELR = t.dataset.rid; SEL = null; render(); return; }
    else { SEL = null; drawPlan(); return; }
    if (drag) { host.setPointerCapture(ev.pointerId); ev.preventDefault(); }
  });
  host.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const st = store(), P = toPlan(ev);
    if (drag.kind === "newroom") { drag.P1 = snapRoom(cur(), P); return roomPreview(drag); }
    if (drag.kind === "wall") {
      const e = drag.e, v = e.x1 === e.x2, dist = v ? (ev.clientX - drag.x) / SC : (ev.clientY - drag.y) / SC;
      if (Math.abs(dist) < 0.025 && !drag.moved) return;
      drag.moved = true;
      st.list[st.sel] = U.moveLine(drag.u0, v ? "x" : "y", v ? e.x1 : e.y1, dist, drag.alt ? (v ? e.y1 : e.x1) : null, drag.alt ? (v ? e.y2 : e.x2) : null);
      LIVE = { axis: v ? "x" : "y", at: (v ? e.x1 : e.y1) + Math.round(dist * 20) / 20, d: Math.round(dist * 20) / 20 };
      return render();
    }
    const dx = P[0] - drag.P[0], dy = P[1] - drag.P[1];
    if (Math.hypot(dx, dy) < 0.03 && !drag.moved) return;
    drag.moved = true;
    const v = JSON.parse(JSON.stringify(drag.u0)), snapv = (q) => Math.round(q * 20) / 20;
    if (drag.kind === "door" || drag.kind === "win") {
      const o = (drag.kind === "door" ? v.doors : v.windows)[drag.i], r = v.rooms.find((q) => q.id === o.room);
      const L = o.side === "n" || o.side === "s" ? r.w : r.h, delta = o.side === "n" || o.side === "s" ? dx : dy;
      o.at = Math.max(0, Math.min(L - (+o.w || 0.8), snapv((+o.at || 0) + delta)));
    } else if (drag.kind === "fix") { const x = v.fixtures[drag.i]; x.x = snapv(x.x + dx); x.y = snapv(x.y + dy); }
    st.list[st.sel] = v;
    drawPlan();
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null; LIVE = null;
    if (d.kind === "newroom") {
      const u = cur(); if (!u || !d.P1) return drawPlan();
      const rect = { x: Math.min(d.P0[0], d.P1[0]), y: Math.min(d.P0[1], d.P1[1]), w: Math.abs(d.P1[0] - d.P0[0]), h: Math.abs(d.P1[1] - d.P0[1]) };
      if (rect.w < 0.05 && rect.h < 0.05) return drawPlan();
      const v = U.addRoom(u, rect, ROOMK);
      if (!v) { toast("A room is at least 0.6 × 0.6 m and does not overlap another room", true); return drawPlan(); }
      const nr = v.rooms[v.rooms.length - 1];
      if (Array.isArray(v.fixtures)) v.fixtures.push(...U.genFixtures({ rooms: [nr] }));
      { const st0 = store(); st0.list[st0.sel] = v; }
      SELR = nr.id; SEL = null;
      return changed();
    }
    if (d.kind === "wall" && !d.moved) { SEL = { t: "wall", key: d.key }; return drawPlan(); }
    if (d.moved) changed(); else drawPlan();
  };
  host.addEventListener("pointerup", end);
  host.addEventListener("pointercancel", end);
  document.addEventListener("keydown", (ev) => {
    if (!ON || ev.target.closest("input,select,textarea")) return;
    if (ev.key === "Escape") { TOOL = "select"; SEL = null; drawPlan(); }
    const u = cur(); if (!u || !SEL || !C.can()) return;
    if (ev.key === "Delete" || ev.key === "Backspace") {
      if (SEL.t === "door") u.doors.splice(SEL.i, 1); else if (SEL.t === "win") u.windows.splice(SEL.i, 1); else if (SEL.t === "fix") u.fixtures.splice(SEL.i, 1);
      else if (SEL.t === "wall") { (u.walls[SEL.key] = u.walls[SEL.key] || {}).open = true; }
      SEL = null; changed();
    }
    if (ev.key.toLowerCase() === "r" && SEL.t === "fix") { u.fixtures[SEL.i] = U.rotateFixture(u.fixtures[SEL.i]); changed(); }
    if (ev.key.toLowerCase() === "f" && SEL.t === "door") { const dd = u.doors[SEL.i]; dd.hinge = dd.hinge === "end" ? "start" : "end"; changed(); }
  });
  window.addEventListener("resize", () => ON && drawPlan());
}
