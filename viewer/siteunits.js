/* Site study, stage 3: the units - each project's unit plans (rooms on a
 * 50 mm grid in any stepped outline, doors, the balcony, utility platform,
 * A/C platform, pipe duct, architectural feature), drawn as a sales-brochure
 * plan, with wall lines to drag; their saleable area, GFA and concessions;
 * and the office's library (/api/units/library). Kept in study.units.
 */
import * as U from "./unitcore.js";
import { unitType as fcUnitType } from "./floorcore.js";
import { TEMPLATES } from "./unittables.js";
import { api, headers } from "./nav.js";
import { toast } from "./tasks-util.js";
import * as PZ from "./planzoom.js";
import { wallGeom } from "./unitwalls.js";
import * as PT from "./plantools.js";
import * as ME from "./measure.js";

const $ = (s, r = document) => r.querySelector(s);
const cap = (el, ev) => { try { el.setPointerCapture(ev.pointerId); } catch (e) { /* a synthetic or finished pointer */ } };
const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f1 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const f3 = (x) => (x == null || isNaN(x) ? "–" : (Math.round(Number(x) * 1000 + 1e-6) / 1000).toLocaleString("en-GB", { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
const n3 = (x) => (x == null || x === "" || isNaN(x) ? "" : Number(x).toFixed(3));
const f2 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
/* lengths as the user reads them: mm (a whole number), cm (one place) or m (three); a face's place to the mm first, so
   the pieces of a chain add up to its overall */
const LEN = () => { try { const v = localStorage.getItem("lwk-viewer:un-len"); return v === "cm" || v === "m" ? v : "mm"; } catch (e) { return "mm"; } };
const LK = () => ({ mm: 1000, cm: 100, m: 1 })[LEN()], LDP = () => ({ mm: 0, cm: 1, m: 3 })[LEN()];
const RP = (v) => Math.round(Number(v) * 1000 + 1e-6) / 1000;
const fL = (x) => (x == null || isNaN(x) ? "–" : (Math.round(Number(x) * LK() * 10 ** LDP() + 1e-6) / 10 ** LDP()).toLocaleString("en-GB", { minimumFractionDigits: LDP(), maximumFractionDigits: LDP(), useGrouping: false }));
const fLab = (a, b) => fL(RP(b) - RP(a));
const iL = (v) => (v == null || v === "" || isNaN(v) ? "" : (Math.round(Number(v) * LK() * 10 ** LDP() + 1e-6) / 10 ** LDP()).toFixed(LDP()));
const pL = (s) => parseFloat(s) / LK();
const uL = () => LEN();
const stepL = () => ({ mm: "5", cm: "0.5", m: "0.005" })[LEN()];
const SIDES = { n: "top", e: "right", s: "bottom", w: "left" };

let C = null, ON = false, LIB = { units: [] }, HIST = [], HI = -1, SELR = null;

export function init(ctx) {
  C = ctx;
  const P = $("#st-upanel");
  P.addEventListener("change", onChange);
  P.addEventListener("click", onClick);
  P.addEventListener("contextmenu", onTabMenu);
  P.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches("input")) ev.target.blur(); });
  document.addEventListener("keydown", (ev) => {
    if (!ON || !(ev.ctrlKey || ev.metaKey) || ev.target.closest("input,select,textarea")) return;
    const k = ev.key.toLowerCase();
    if (k === "z" && !ev.shiftKey) { ev.preventDefault(); undo(-1); }
    if (k === "y" || (k === "z" && ev.shiftKey)) { ev.preventDefault(); undo(1); }
  });
  wirePlan();
  // the keys the user can change (the shortcuts table: ? or the ⌨ button)
  const can = () => ON && C.can(), tool = (id) => () => { if (!can()) return false; TOOL = TOOL === id && id !== "select" ? "select" : id; SEL = null; drawPlan(); };
  const cyc = (k, vals) => () => { let v; try { v = localStorage.getItem(k); } catch (e) { /* none */ } const i = vals.indexOf(v || vals[0]); try { localStorage.setItem(k, vals[(i + 1) % vals.length]); } catch (e) { /* private */ } drawPlan(); };
  PT.KS.register("units", () => ON && !INPLACE, [
    { id: "select", key: "v", label: "Select", group: "Draw", run: tool("select") },
    // R on a selected fitting or balcony turns it (below), not the room tool
    { id: "room", key: "r", label: "Room", group: "Draw", run: () => ((SEL && (SEL.t === "fix" || SEL.t === "x")) || TOOL.startsWith("fix:") ? false : tool("room")()) },
    { id: "split-x", key: "|", label: "Split a room │", group: "Draw", run: tool("split-x") },
    { id: "split-y", key: "-", label: "Split a room ─", group: "Draw", run: tool("split-y") },
    { id: "door", key: "d", label: "Door", group: "Add", run: tool("door") },
    { id: "window", key: "w", label: "Window", group: "Add", run: tool("window") },
    { id: "lib", key: "l", label: "Doors, windows, openings library", group: "Add", run: () => { if (!can()) return false; PT.toggleLibrary(); drawPlan(); } },
    { id: "alines", key: "a", label: "Area lines: off / saleable / GFA / both", group: "View", run: cyc("lwk-viewer:un-alines", ["off", "saleable", "gfa", "both"]) },
    { id: "dims", key: "m", label: "Dimensions: inside rooms / wall centres / overall / off", group: "View", run: cyc("lwk-viewer:un-dims", ["chains", "centre", "overall", "off"]) },
    { id: "measure", key: "q", label: "Measure (two points; parallel faces: the clear width)", group: "View", run: () => { if (!ON) return false; TOOL = TOOL === "measure" ? "select" : "measure"; SEL = null; drawPlan(); } },
  ], [
    { keys: "Ctrl+Z / Ctrl+Y", label: "Undo / redo", group: "Edit" }, { keys: "Delete", label: "Remove the selected (a wall: opened)", group: "Edit" }, { keys: "Esc", label: "Select tool, clear the selection", group: "Edit" },
    { keys: "Space / R", label: "Turn the selected fitting or balcony 90°, or the one about to be placed", group: "Edit" }, { keys: "Space", label: "A selected door: its swing round its four ways (hinge, in / out)", group: "Edit" }, { keys: "F", label: "Flip the selected door's hinge", group: "Edit" }, { keys: "Right-click", label: "Menu: door type, delete…", group: "Edit" },
    { keys: "Alt + drag a wall", label: "Move the whole aligned line", group: "Edit" }, { keys: "Wheel / pinch", label: "Zoom", group: "View" }, { keys: "Drag the empty plan", label: "Pan", group: "View" },
  ], "3 · Units");
}
export function store() {
  const s = C.study();
  s.units = s.units && typeof s.units === "object" ? s.units : {};
  const st = s.units;
  if (!Array.isArray(st.list)) st.list = [];
  for (let i = 0; i < st.list.length; i++) if (st.list[i] && st.list[i].rows) st.list[i] = U.fromRows(st.list[i]);
  for (const u of st.list) {
    if (!Array.isArray(u.windows)) u.windows = U.genWindows(u);
    if (!Array.isArray(u.fixtures)) u.fixtures = U.genFixtures(u);
    // the first form of an open kitchen (a room) as a zone in the living room's space, once
    if (!u.zonesDone && (u.rooms || []).some((r) => r.kind === "OKIT")) { U.zoneKitchens(u); u.zonesDone = 1; if (u.orig) { const o = JSON.parse(u.orig); U.zoneKitchens(o); o.zonesDone = 1; u.orig = JSON.stringify(o); } }
    // the balcony, UP and A/C platform from the external wall's outer face (those made on its centre line moved out), once
    if (!u.xFace) { U.extrasToFace(u); if (u.orig) { const o = JSON.parse(u.orig); U.extrasToFace(o); u.orig = JSON.stringify(o); } }
    if (u.orig == null) setOrig(u);
  }
  if (st.sel == null || st.sel >= st.list.length) st.sel = st.list.length ? 0 : -1;
  return st;
}
/* the unit as it was loaded or last saved, for Reset */
const bare = (u) => { const c = JSON.parse(JSON.stringify(u)); delete c.orig; delete c.libId; return JSON.stringify(c); };
function setOrig(u) { u.orig = bare(u); }
const unsaved = (u) => !!(u && u.orig && bare(u) !== u.orig);
const cur = () => { const st = store(); return st.list[st.sel] || null; };
const copyNamed = (u, list) => { const c = JSON.parse(JSON.stringify(u)); let nm = c.name || "Unit", k = 2; while (list.some((q) => q.name === nm)) nm = `${c.name} (${k++})`; c.name = nm; return c; };

/* opened in place from 4 · Floors: a floating window over the floor plan, a banner with Done */
let INPLACE = null;
/* in place: the plan in a floating window (a title bar to drag it by, Done and ×, resized from its corner) over the floor plan, which stays live */
let WIN = null;
function openWin(title) {
  const host = $("#st-uplan");
  if (!WIN) {
    WIN = document.createElement("div"); WIN.id = "un-win";
    WIN.innerHTML = `<div class="un-win-bar"><b></b><span><button type="button" class="primary st-ib" data-wdone>Done</button><button type="button" class="ghost st-ib" data-wdone title="Close">×</button></span></div>`;
    WIN._home = [host.parentNode, host.nextSibling];
    host.parentNode.appendChild(WIN);
    WIN.appendChild(host);
    const bar = WIN.querySelector(".un-win-bar");
    bar.addEventListener("click", (ev) => { if (ev.target.closest("[data-wdone]")) { const cb = INPLACE && INPLACE.onDone; show(false).then(() => cb && cb()); } });
    bar.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest("button")) return;
      const r = WIN.getBoundingClientRect(), pr = WIN.offsetParent.getBoundingClientRect(), dx = ev.clientX - r.left, dy = ev.clientY - r.top;
      const mv = (e) => { WIN.style.left = Math.max(0, Math.min(pr.width - 80, e.clientX - pr.left - dx)) + "px"; WIN.style.top = Math.max(0, Math.min(pr.height - 40, e.clientY - pr.top - dy)) + "px"; WIN.style.right = "auto"; };
      const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
      addEventListener("pointermove", mv); addEventListener("pointerup", up); ev.preventDefault();
    });
    new ResizeObserver(() => { if (ON && WIN) drawPlan(); }).observe(WIN);
  }
  WIN.querySelector(".un-win-bar b").textContent = "✎ " + (title || "");
}
function closeWin() {
  if (!WIN) return;
  const host = $("#st-uplan"), [par, next] = WIN._home;
  par.insertBefore(host, next && next.parentNode === par ? next : null);
  WIN.remove(); WIN = null;
}
export async function show(on, opts) {
  INPLACE = on && opts && opts.inplace ? opts : null;
  document.body.classList.toggle("st-inplace", !!INPLACE);
  if (INPLACE) { const u = cur(); openWin(u ? u.name + " - in place" : "in place"); } else closeWin();
  ON = on;
  $("#st-upanel").hidden = !on;
  $("#st-uplan").hidden = !on;
  document.body.classList.toggle("st-units", on);
  if (!on) { PT.unmount("units"); return; }
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
/* the units' figures for their tabs, kept per unit (an edit forgets the one edited) */
const FIGC = new WeakMap();
const tabFig = (x) => { let f = FIGC.get(x); if (!f) { f = U.figures(x); FIGC.set(x, f); } return f; };
function changed() { const st0 = store(); if (st0 && st0.list && st0.list[st0.sel]) FIGC.delete(st0.list[st0.sel]); snap(); C.save(); render(); if (INPLACE && INPLACE.onChange) INPLACE.onChange(); }

/* ---------- the panel */
function render() {
  if (!ON) return;
  const st = store(), u = cur(), can = C.can(), dis = can ? "" : " disabled";
  const kindOpt = (k) => Object.entries(U.KINDS).map(([v, q]) => `<option value="${v}"${v === k ? " selected" : ""}>${q.label}</option>`).join("");
  const exOpt = (k) => Object.entries(Object.assign({ bay: { label: "Balcony / UP / A/C bay" } }, U.EXTRAS)).map(([v, q]) => `<option value="${v}"${v === k ? " selected" : ""}>${q.label}</option>`).join("");
  const num = (attr, v) => `<input type="number" step="${stepL()}" ${attr} value="${esc(iL(v))}"${dis}>`;
  const tabs = st.list.map((x, i) => `<button type="button" class="un-tab${i === st.sel ? " on" : ""}" data-usel="${i}">${esc(x.name || "Unit")}<small>${tabFig(x).saleableFt} ft²</small></button>`).join("");
  let body = "";
  if (u) {
    const f = U.figures(u);
    const big = (l, v, s2) => `<div class="st-big"><small>${l}</small><b>${v}</b>${s2 ? `<span>${s2}</span>` : ""}</div>`;
    const CL = clearAll(u);
    const rooms = u.rooms.map((r, i) => `<div class="un-room${SELR === r.id ? " sel" : ""}" data-rid="${esc(r.id)}">
        <select data-rk="${i}"${dis}>${kindOpt(r.kind)}</select><input class="un-nm" data-rn="${i}" value="${esc(r.name || "")}" placeholder="name"${dis}>${can ? `<button type="button" class="ghost st-ib un-x" data-rdel="${i}" title="Remove the room">×</button>` : ""}
        <span class="un-l2">${(() => { const c = CL.boxes[i], ttl = (t2) => ` title="${t2}"`; return `<span class="un-xy">x <span${ttl("Its inside face from the unit's inside corner: moves its west wall (the room beside it follows; its east wall stays)")}>${num(`data-rx="${i}"`, RP(c.x0) - RP(CL.x0))}</span> y <span${ttl("Its inside face from the unit's inside corner: moves its north wall (the room beside it follows)")}>${num(`data-ry="${i}"`, RP(c.y0) - RP(CL.y0))}</span></span><span class="un-wh"><span${ttl("Its clear width inside the walls: moves its east wall (the room beside it follows)")}>${num(`data-rw="${i}"`, RP(c.x1) - RP(c.x0))}</span> × <span${ttl("Its clear depth inside the walls: moves its south wall (the room beside it follows)")}>${num(`data-rh="${i}"`, RP(c.y1) - RP(c.y0))}</span> ${uL()}</span>`; })()}
        <small title="To the wall centre lines (as the GFA)">${f2(r.w * r.h)} m²</small></span></div>`).join("");
    const doors = (u.doors || []).map((d, i) => `<div class="un-room">
        <select data-dr="${i}"${dis}>${u.rooms.map((r) => `<option value="${esc(r.id)}"${r.id === d.room ? " selected" : ""}>${esc(r.name || (U.KINDS[r.kind] || {}).label)}</option>`).join("")}</select>
        <select data-ds="${i}"${dis}>${Object.entries(SIDES).map(([k, v]) => `<option value="${k}"${k === d.side ? " selected" : ""}>${v} wall</option>`).join("")}</select>
        ${can ? `<button type="button" class="ghost st-ib un-x" data-ddel="${i}" title="Remove the door">×</button>` : ""}
        <span class="un-l2"><label>at ${num(`data-da="${i}"`, d.at)}</label><label>w ${num(`data-dw="${i}"`, d.w)} ${uL()}</label><label class="st-chk"><input type="checkbox" data-de="${i}"${d.entry ? " checked" : ""}${dis}> entrance</label></span></div>`).join("");
    const extras = (u.extras || []).map((e, i) => `<div class="un-room">
        <select data-ek="${i}"${dis}>${exOpt(e.kind)}</select>${can ? `<button type="button" class="ghost st-ib un-x" data-edel="${i}" title="Remove">×</button>` : ""}
        <span class="un-l2"><span class="un-xy">x ${num(`data-ex="${i}"`, e.x)} y ${num(`data-ey="${i}"`, e.y)}</span><span class="un-wh">${num(`data-ew="${i}"`, e.w)} × ${num(`data-eh="${i}"`, e.h)} ${uL()}</span>
        ${e.kind === "bal" || e.kind === "up" || e.kind === "bay" ? `<label>splay ${num(`data-esp="${i}"`, e.splay || 0)}</label>` : ""}
        ${e.kind === "bay" ? `<div class="un-bay">${(e.parts || []).map((q, k) => `<span><select data-bpk="${i}.${k}"${dis}>${["bal", "up", "acp"].map((v) => `<option value="${v}"${v === q.kind ? " selected" : ""}>${U.EXTRAS[v].label}</option>`).join("")}</select> ${num(`data-bpl="${i}.${k}"`, q.len)} ${uL()}${can ? `<button type="button" class="ghost st-ib" data-bpdel="${i}.${k}">×</button>` : ""}</span>`).join("")}${can ? `<button type="button" class="ghost st-ib" data-bpadd="${i}">+ part</button>` : ""}<small>parts along the bay's long side</small></div>` : ""}
        ${e.kind === "acp" ? `<label class="st-chk" title="Meets the Code of Practice for external maintenance (APP-19 3(c))"><input type="checkbox" data-edfs="${i}"${e.dfs ? " checked" : ""}${dis}> DfS</label>` : ""}</span></div>`).join("");
    body = `
      <section class="st-card">
        <div class="st-head"><input class="ms-name" data-uf="name" value="${esc(u.name || "")}"${dis}><span class="muted">${f3(f.W)} × ${f3(f.D)} ${uL()}</span></div>
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
        <div class="st-head"><b>Rooms</b><span class="muted">clear sizes, inside the walls · drag a wall on the plan</span></div>
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
          <label>External ${num('data-uf="wall"', u.wall)} ${uL()}</label><label>Party ${num('data-uf="party"', u.party)} ${uL()}</label><label>Partition ${num('data-uf="part"', u.part)} ${uL()}</label>
          <label>External walls <select data-uf="facadeType"${dis}>${Object.entries(U.FACADES).map(([k, q]) => `<option value="${k}"${(u.facadeType || "rc") === k ? " selected" : ""}>${q.label}</option>`).join("")}</select></label>
          <label>GFA measured to: external walls <select data-uf="gfaExt"${dis}>${[["outer", "outer face"], ["centre", "centre"], ["inner", "inner face"]].map(([k, v]) => `<option value="${k}"${(u.gfaExt || "outer") === k ? " selected" : ""}>${v}</option>`).join("")}</select> · party walls <select data-uf="gfaParty"${dis}>${[["centre", "centre"], ["outer", "outer face"]].map(([k, v]) => `<option value="${k}"${(u.gfaParty || "centre") === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>
          <label>Partitions in line with a thicker wall <select data-uf="join"${dis}><option value="edge"${u.join !== "centre" ? " selected" : ""}>flush with its inside face</option><option value="centre"${u.join === "centre" ? " selected" : ""}>centre to centre</option></select></label>
          <label title="The band this unit goes in on the flat mix table (5 · Mix): by its bedrooms, or set here (a special unit)">Mix band <select data-uf="band"${dis}>${[["", `Auto (by bedrooms: ${["Studio", "1-BR", "2-BR", "3-BR"][Number(fcUnitType(u))]})`], ["0", "Studio"], ["1", "1-BR"], ["2", "2-BR"], ["3", "3-BR"], ["sp", "Special unit"]].map(([k, v]) => `<option value="${k}"${(u.band || "") === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>
          <label>Façade (windows) <select data-uf="facade"${dis}>${Object.entries(SIDES).map(([k, v]) => `<option value="${k}"${(u.facade || "s") === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>
          <span class="un-party">Party walls on: ${Object.entries(SIDES).map(([k, v]) => `<label class="st-chk"><input type="checkbox" data-ups="${k}"${(u.partySides || []).includes(k) ? " checked" : ""}${dis}> ${v}</label>`).join("")}</span>
        </div>
      </section>`;
  }
  const libOpt = (LIB.units || []).filter((x) => !(x.unit && x.unit.tplFor)).map((x) => `<option value="${esc(x.id)}">${esc(x.name)} · ${U.figures(x.unit).saleableFt} ft²${x.by ? " · " + esc(x.by) : ""}</option>`).join("");
  $("#st-upanel").innerHTML = (INPLACE ? `<section class="st-card un-inplace"><div class="st-head"><b>✎ Editing ${esc(u ? u.name : "")} in place</b><button type="button" class="primary st-ib" data-uinpl>Done</button></div><p class="st-note">${esc(INPLACE.title || "")} - the floor is laid out again with it when you are done.${u && u.variantOf ? ` A variant of ${esc(u.variantOf)}, for that flat only.` : " Changes are to this unit type: every flat of it changes."}</p></section>` : "") + `
    <section class="st-card">
      <div class="st-head"><b>Units</b>${can ? `<span class="ms-undo"><button type="button" class="ghost st-ib" data-uundo="-1"${HI > 0 ? "" : " disabled"}>↶ Undo</button><button type="button" class="ghost st-ib" data-uundo="1"${HI < HIST.length - 1 ? "" : " disabled"}>↷</button>${unsaved(u) ? `<button type="button" class="ghost st-ib" data-ureset title="Back to the unit as it was made or last saved to the library">⟲ Reset</button>` : ""}</span>` : ""}<span class="muted" id="un-saved">${can ? "Saved with the project" : "View only"}</span></div>
      <div class="un-tabs">${tabs || `<p class="st-need">No units yet: start from a template or the office library.</p>`}</div>
      ${can ? `<div class="st-row"><select data-unew data-pick="tpl"><option value="">+ New from a template …</option>${Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}">${esc(t.name)}${tplOverride(k) ? " · edited by the office" : t.src ? " · " + esc(t.src.replace(/^after /, "")) : ""}</option>`).join("")}</select>
        <select data-ulib data-pick="ulib"><option value="">+ From the office library …</option>${libOpt}</select></div>
        ${u ? `<div class="st-row"><button type="button" class="ghost st-ib" data-udup>Duplicate</button><button type="button" class="ghost st-ib" data-umir title="A handed copy: the same layout flipped left to right">⇋ Mirror</button><button type="button" class="ghost st-ib" data-udel>Remove</button><button type="button" class="ghost st-ib" data-usave title="${u.libId ? "Update the entry it came from" : "Add it to the office library"}">${u.libId ? "Update in the office library" : "Save to the office library"}</button><button type="button" class="ghost st-ib" data-usavenew>Save as new</button>${u.tplOf && TEMPLATES[u.tplOf] ? `<button type="button" class="ghost st-ib" data-utpl title="Make this unit the template &quot;${esc(TEMPLATES[u.tplOf].name)}&quot; for everyone in the office: + New from a template gives it from now on">Save as the template</button>${tplOverride(u.tplOf) ? `<button type="button" class="ghost st-ib" data-utplreset title="The template as it was built in (the office's edit removed)">Template as built in</button>` : ""}` : ""}<button type="button" class="ghost st-ib" data-usvg>SVG</button></div>` : ""}` : ""}
    </section>
    ${body}`;
  drawPlan();
}

function onChange(ev) {
  const t = ev.target, st = store(), u = cur(), d = t.dataset;
  const num = (v, x) => (isNaN(parseFloat(v)) ? x : pL(v));   // the panel's lengths, in the unit shown
  if (d.unew != null && t.value) { const k = t.value, c = ensure(copyNamed(tplUnit(k), st.list)); delete c.tplFor; delete c.libId; c.tplOf = k; setOrig(c); st.list.push(c); st.sel = st.list.length - 1; SELR = null; return changed(); }
  if (d.ulib != null && t.value) { const x = LIB.units.find((q) => q.id === t.value); if (x) { const c = copyNamed(x.unit.rows ? U.fromRows(x.unit) : x.unit, st.list); c.libId = x.id; ensure(c); setOrig(c); st.list.push(c); st.sel = st.list.length - 1; toast(`${x.name} copied into this project`); return changed(); } }
  if (!u) return;
  if (d.uf) { u[d.uf] = d.uf === "band" && !t.value ? (delete u.band, undefined) : ["name", "facade", "facadeType", "join", "gfaExt", "gfaParty", "band"].includes(d.uf) ? t.value : Math.max(0, num(t.value, u[d.uf])); return changed(); }
  if (d.ups) { const s2 = new Set(u.partySides || []); if (t.checked) s2.add(d.ups); else s2.delete(d.ups); u.partySides = [...s2]; return changed(); }
  const R = (k) => u.rooms[+k];
  if (d.rk != null) { const r = R(d.rk), old = (U.KINDS[r.kind] || {}).label; r.kind = t.value; if (!r.name || r.name === old) r.name = U.KINDS[t.value].label; return changed(); }
  if (d.rn != null) { R(d.rn).name = t.value; return changed(); }
  // a clear figure typed: the wall on that side moves by the difference, the rooms on its line with it (as a drag: no gap)
  for (const k of ["x", "y", "w", "h"]) if (d["r" + k] != null) {
    const i = +d["r" + k], r = R(i), CL = clearAll(u), c = CL.boxes[i], v = num(t.value, NaN);
    if (!isFinite(v)) return render();
    // from the figure as shown (to the mm): typed 0.150 less moves the wall 0.150, whatever half-millimetre a wall leaves
    const cur0 = { x: RP(c.x0) - RP(CL.x0), y: RP(c.y0) - RP(CL.y0), w: RP(c.x1) - RP(c.x0), h: RP(c.y1) - RP(c.y0) }[k], D = v - cur0;
    if (Math.abs(D) < 2.5e-4) return render();
    const nw = k === "w" ? v : k === "x" ? c.x1 - c.x0 - D : c.x1 - c.x0, nh = k === "h" ? v : k === "y" ? c.y1 - c.y0 - D : c.y1 - c.y0;
    if (nw < 0.5 || nh < 0.5) { toast("A room is 0.5 m inside its walls at least", true); return render(); }
    const axis = k === "x" || k === "w" ? "x" : "y", at = k === "x" ? r.x : k === "y" ? r.y : k === "w" ? r.x + r.w : r.y + r.h;
    if (!typedMove(u, axis, at, D, [r.id])) render();
    return;
  }
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
  if (d.uinpl != null) { const cb = INPLACE && INPLACE.onDone; await show(false); if (cb) cb(); return; }
  if (d.usel != null) { st.sel = +d.usel; SELR = null; C.save(); return render(); }
  if (!u) return;
  if (d.umir != null) { const v = U.mirrorUnit(ensure(u)); delete v.libId; st.list[st.sel] = v; SEL = null; return changed(); }
  if (d.ureset != null) {
    if (!confirm(`Reset ${u.name} to how it was ${u.libId ? "saved in the office library" : "when it was made"}? (Undo brings the edits back)`)) return;
    const v = JSON.parse(u.orig); v.orig = u.orig; if (u.libId) v.libId = u.libId;
    st.list[st.sel] = v; SEL = null; SELR = null; return changed();
  }
  if (d.udup != null) { st.list.push(copyNamed(u, st.list)); st.sel = st.list.length - 1; return changed(); }
  if (d.udel != null) { if (!confirm(`Remove ${u.name}?`)) return; st.list.splice(st.sel, 1); st.sel = Math.min(st.sel, st.list.length - 1); return changed(); }
  if (d.utpl != null && u.tplOf && TEMPLATES[u.tplOf]) {
    const k = u.tplOf, ex = tplOverride(k);
    if (!confirm(`Make ${u.name} the template "${TEMPLATES[k].name}" for the office? + New from a template gives this layout from now on (Template as built in brings the original back).`)) return;
    try {
      const body = JSON.parse(JSON.stringify(u)); delete body.libId; delete body.orig; delete body.tplOf; body.tplFor = k; body.name = TEMPLATES[k].name;
      LIB = await api("/api/units/library", { method: "PUT", body: JSON.stringify({ id: ex ? ex.id : null, unit: body }) });
      toast(`Template "${TEMPLATES[k].name}" saved for the office`); render();
    } catch (e) { toast(e.message, true); }
    return;
  }
  if (d.utplreset != null && u.tplOf) {
    const ex = tplOverride(u.tplOf); if (!ex) return;
    if (!confirm(`Remove the office's edit of the template "${TEMPLATES[u.tplOf].name}"? + New from a template gives the built-in one again (this unit stays as it is).`)) return;
    try { LIB = await api("/api/units/library?id=" + encodeURIComponent(ex.id), { method: "DELETE" }); toast("The template is as built in again"); render(); } catch (e) { toast(e.message, true); }
    return;
  }
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
      const body = JSON.parse(JSON.stringify(u)); delete body.libId; delete body.orig; delete body.tplOf; delete body.tplFor;
      LIB = await api("/api/units/library", { method: "PUT", body: JSON.stringify({ id, unit: body }) });
      const row = id ? LIB.units.find((x) => x.id === id) : LIB.units.slice().reverse().find((x) => x.name === u.name);
      if (row) u.libId = row.id;
      setOrig(u);
      // the project's other copies of that library unit (picked from it before): updated too when asked; each keeps its name
      const others = row ? st.list.filter((q) => q && q !== u && q.libId === row.id) : [];
      if (others.length && confirm(`${others.length} other cop${others.length > 1 ? "ies" : "y"} of it in this project (${others.map((q) => q.name).join(", ")}): update ${others.length > 1 ? "them" : "it"} to this layout too?`)) {
        for (const q of others) { const i = st.list.indexOf(q), c = JSON.parse(JSON.stringify(body)); c.name = q.name; c.libId = row.id; ensure(c); setOrig(c); st.list[i] = c; }
      }
      C.save(); toast(`${u.name} saved to the office library${others.length ? "" : ""}`); render();
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

/* a fitting's box on the plan (turned 90 or 270: its width and depth swap about its middle) */
function fixBox(x) {
  const rot = ((+x.rot || 0) % 360 + 360) % 360, q = rot === 90 || rot === 270, bw = q ? +x.h : +x.w, bh = q ? +x.w : +x.h, cx = +x.x + x.w / 2, cy = +x.y + x.h / 2;
  return { x0: cx - bw / 2, x1: cx + bw / 2, y0: cy - bh / 2, y1: cy + bh / 2, q };
}
/* right-click a unit's tab: open, rename, duplicate, mirror, save to the library, remove */
function onTabMenu(ev) {
  const b = ev.target.closest(".un-tab[data-usel]"); if (!b) return;
  ev.preventDefault();
  const st = store(), i = +b.dataset.usel, can = C.can();
  const go = (attr) => { if (st.sel !== i) { st.sel = i; SELR = null; SEL = null; C.save(); render(); } const el = $(`#st-upanel [${attr}]`); if (el) el.click(); };
  const u = st.list[i]; if (!u) return;
  PT.ctx(ev, [
    { label: "Open", action: () => { st.sel = i; SELR = null; SEL = null; C.save(); render(); } },
    { label: "Rename…", disabled: !can, action: () => { const nm = prompt("Name", u.name || ""); if (!nm || nm === u.name) return; st.sel = i; u.name = nm.slice(0, 80); changed(); } },
    { label: "Duplicate", disabled: !can, action: () => go("data-udup") },
    { label: "⇋ Mirror (a handed copy)", disabled: !can, action: () => go("data-umir") },
    "-",
    { label: u.libId ? "Update in the office library" : "Save to the office library", disabled: !can, action: () => go("data-usave") },
    { label: "Save as new in the office library…", disabled: !can, action: () => go("data-usavenew") },
    ...(u.tplOf && TEMPLATES[u.tplOf] ? [{ label: `Save as the template "${TEMPLATES[u.tplOf].name}"`, disabled: !can, action: () => go("data-utpl") }] : []),
    { label: "SVG of the plan", action: () => go("data-usvg") },
    "-",
    { label: "Remove", danger: true, disabled: !can, action: () => go("data-udel") },
  ]);
}
/* a template as the office has it: the office's own edit of it (saved from a unit: "Save as the template") or the one
   built in */
function tplOverride(k) { return (LIB.units || []).filter((x) => x.unit && x.unit.tplFor === k).slice(-1)[0] || null; }
function tplUnit(k) { const o = tplOverride(k); if (o) return Object.assign(JSON.parse(JSON.stringify(o.unit.rows && !(o.unit.rooms || []).length ? U.fromRows(o.unit) : o.unit)), { name: TEMPLATES[k] ? TEMPLATES[k].name : o.unit.name }); const t = TEMPLATES[k]; return t && (t.rooms ? t : U.fromRows(t)); }
/* the lines a zone or a fitting snaps to: the walls' centre lines and both their faces -> {xs, ys} */
function snapLines(v) {
  const xs = [], ys = [], wall = +(v.wall ?? 0.15), pt = +(v.part ?? 0.075), party = +(v.party ?? 0.15);
  for (const r of v.rooms) { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); }
  for (const e of U.edges(v)) {
    const t = e.t != null ? e.t : e.kind === "ext" ? U.extWallT(v, e) : e.kind === "party" ? party : pt;
    void wall;
    if (e.x1 === e.x2) xs.push(e.x1 - t / 2, e.x1 + t / 2); else ys.push(e.y1 - t / 2, e.y1 + t / 2);
  }
  return { xs: [...new Set(xs.map((q) => +q.toFixed(4)))], ys: [...new Set(ys.map((q) => +q.toFixed(4)))] };
}
/* ---------- the plan, as a sales brochure: walls, doors, fixtures, labels */
/* ---------- the plan, as a sales brochure: walls, windows, doors, fittings, labels, dimension chains */
let SC = 60, OX = 40, OY = 40, BX = 0, BY = 0;
const ZM = PZ.create(); // the plan's zoom and pan
let ZFOR = null;        // the unit it is for
let WENDS = null;       // a selected partition's two ends on the plan
/* the office's hatches: RC dark grey, block diagonal, precast diagonal with a dashed diagonal */
const HATCH = `<defs><marker id="un-ar" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6 z" fill="#222"/></marker><pattern id="hp-rc" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)"><rect width="5" height="5" fill="#8b9096"/><line x1="0" y1="0" x2="0" y2="5" stroke="#5c6166" stroke-width="1.2"/></pattern>
  <pattern id="hp-blk" patternUnits="userSpaceOnUse" width="4.5" height="4.5" patternTransform="rotate(45)"><rect width="4.5" height="4.5" fill="#fff"/><line x1="0" y1="0" x2="0" y2="4.5" stroke="#4a4f55" stroke-width="0.55"/></pattern>
  <pattern id="hp-pc" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><rect width="7" height="7" fill="#fff"/><line x1="0" y1="0" x2="0" y2="7" stroke="#4a4f55" stroke-width="0.6"/><line x1="3.5" y1="0" x2="3.5" y2="7" stroke="#4a4f55" stroke-width="0.6" stroke-dasharray="1.4 1.4"/></pattern></defs>`;
const ROOMFILL = { LD: "#fbf3d5", MBR: "#fbf3d5", BR: "#fbf3d5", STUDY: "#fbf3d5", BATH: "#eef6f4", ENS: "#eef6f4", LOBBY: "#fbf3d5", OKIT: "#fbf3d5", KIT: "#f9efd8", STORE: "#f3f1ea" };
const ALINES = () => { try { return localStorage.getItem("lwk-viewer:un-alines") || "off"; } catch (e) { return "off"; } };
let SEL = null;      // {t: "wall"|"door"|"win"|"fix", i | key}
let TOOL = "select"; // select | door | window | split-x | split-y | room | fix:<kind>
let HOVW = null;      // a library opening dragged over a wall: {e, along}
let ROOMK = "BR";     // the kind a drawn room gets
let GHOST = null, FIXROT = 0;   // a fitting about to be placed: under the cursor, turned by Space / R
let LIVE = null;     // while a wall line is dragged: {axis, at, d}
const DIMS = () => { try { return localStorage.getItem("lwk-viewer:un-dims") || "chains"; } catch (e) { return "chains"; } };
/* the room names: both (Chinese over English, as the brochures), English or Chinese */
const LANG = () => { try { return localStorage.getItem("lwk-viewer:un-lang") || "both"; } catch (e) { return "both"; } };
/* what + Balcony / UP adds outside a wall: its depth from the wall and its length along it; a bay's parts */
const XADD = {
  bay: { label: "Bay: balcony + UP + A/C", depth: 1.2, parts: [{ kind: "bal", len: 1.7 }, { kind: "up", len: 1.25 }, { kind: "acp", len: 0.6 }] },
  bal: { label: "Balcony", depth: 1.2, len: 1.7 },
  up: { label: "Utility platform", depth: 1.2, len: 1.25 },
  acp: { label: "A/C platform", depth: 0.6, len: 1.0 },
  pd: { label: "Pipe duct", depth: 0.4, len: 0.6 },
};
const PART_LEN = { bal: 1.7, up: 1.25, acp: 0.6 };
/* the areas a balcony, utility platform and A/C platform are kept at: change one side, the other follows (unless "keep area" is off) */
export const XAREA = { bal: 2.0, up: 1.5, acp: 0.8 };
const up2 = (v) => Math.ceil(v * 100 - 1e-6) / 100;
export function keepArea(e, changed) {
  if (e.free) return e;
  if (e.kind in XAREA) {
    if (changed === "w") e.h = up2(XAREA[e.kind] / e.w); else e.w = up2(XAREA[e.kind] / e.h);
  } else if (e.kind === "bay") {
    const vert = e.h >= e.w, depth = vert ? e.w : e.h;
    if ((vert && changed === "w") || (!vert && changed === "h")) {
      for (const q of e.parts || []) if (q.kind in XAREA) q.len = up2(XAREA[q.kind] / depth);
      const L = +(e.parts || []).reduce((a, q) => a + (+q.len || 0), 0).toFixed(3);
      if (vert) e.h = L; else e.w = L;
    }
  }
  return e;
}
const FIXK = { bath: "Bath tub", shower: "Shower", wc: "WC", basin: "Basin", counter: "Kitchen counter (sink + hob)", sink: "Sink", hob: "Hob", fridge: "Fridge", wm: "Washing machine",
  bed1: "Single bed 0.9 × 1.9", bed: "Double bed 1.5 × 1.9", bedq: "Queen bed 1.5 × 2.0", wardrobe: "Wardrobe 0.6 deep", sofa2: "Sofa, 2 seats", sofa: "Sofa, 3 seats", dining: "Dining for 4", dining6: "Dining for 6", desk: "Desk", tv: "TV cabinet", shoe: "Shoe cabinet" };
/* the furniture (the rest are fittings), each kind's size and how it is drawn */
const FURN = new Set(["bed1", "bed", "bedq", "wardrobe", "sofa2", "sofa", "dining", "dining6", "desk", "tv", "shoe"]);
const FIXSZ = { bath: [1.5, 0.7], shower: [0.9, 0.9], wc: [0.4, 0.65], basin: [0.5, 0.4], counter: [1.8, 0.6], sink: [0.6, 0.5], hob: [0.6, 0.5], fridge: [0.6, 0.65], wm: [0.6, 0.6], wardrobe: [1.2, 0.6], bed1: [0.9, 1.9], bed: [1.5, 1.9], bedq: [1.5, 2.0], sofa2: [1.5, 0.85], sofa: [1.8, 0.85], dining: [1.2, 0.8], dining6: [1.8, 0.9], desk: [1.0, 0.55], tv: [1.8, 0.4], shoe: [0.9, 0.35] };
const DRAWAS = { bed1: "bed", bedq: "bed", sofa2: "sofa", dining6: "dining" };
const fixOpts = (cur2) => `<optgroup label="Fittings">${Object.entries(FIXK).filter(([k]) => !FURN.has(k)).map(([k, v]) => `<option value="${k}"${cur2 === k ? " selected" : ""}>${esc(v)}</option>`).join("")}</optgroup><optgroup label="Furniture">${Object.entries(FIXK).filter(([k]) => FURN.has(k)).map(([k, v]) => `<option value="${k}"${cur2 === k ? " selected" : ""}>${esc(v)}</option>`).join("")}</optgroup>`;

/* small drawings for the pickers: a unit's plan (rooms, balcony / UP / A/C dashed, its fittings), a fitting or a piece of furniture */
export function unitThumb(u, W = 88, H = 66) {
  if (!u || !Array.isArray(u.rooms) || !u.rooms.length) return "";
  const R = [...u.rooms, ...(u.extras || [])].map((r) => [+r.x || 0, +r.y || 0, +r.w || 0, +r.h || 0]);
  const x0 = Math.min(...R.map((r) => r[0])), y0 = Math.min(...R.map((r) => r[1])), x1 = Math.max(...R.map((r) => r[0] + r[2])), y1 = Math.max(...R.map((r) => r[1] + r[3]));
  const k = Math.min((W - 6) / Math.max(0.5, x1 - x0), (H - 6) / Math.max(0.5, y1 - y0)), ox = (W - (x1 - x0) * k) / 2, oy = (H - (y1 - y0) * k) / 2;
  const sx = (v) => ox + (v - x0) * k, sy = (v) => oy + (v - y0) * k;
  let g = "";
  for (const e of u.extras || []) g += `<rect x="${sx(+e.x)}" y="${sy(+e.y)}" width="${(+e.w) * k}" height="${(+e.h) * k}" fill="#eef3f8" stroke="#6b7c8f" stroke-width="0.5" stroke-dasharray="2 1.2"/>`;
  for (const r of u.rooms) g += `<rect x="${sx(+r.x)}" y="${sy(+r.y)}" width="${(+r.w) * k}" height="${(+r.h) * k}" fill="${ROOMFILL[r.kind] || "#fbf3d5"}" stroke="#4a525b" stroke-width="${Math.max(0.6, 0.15 * k)}"/>`;
  for (const f of Array.isArray(u.fixtures) ? u.fixtures : U.genFixtures(u)) g += fixture(f, sx, sy, false, -1, k).replace(/ class="un-fix"| class="un-fhit"| data-fi="-1"/g, "");
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
}
export function fixThumb(kind, W = 88, H = 66) {
  const sz = FIXSZ[kind]; if (!sz) return "";
  const k = Math.min((W - 10) / sz[0], (H - 20) / sz[1]), ox = (W - sz[0] * k) / 2, oy = (H - 12 - sz[1] * k) / 2;
  const f = { kind, x: 0, y: 0, w: sz[0], h: sz[1], rot: 0 };
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${fixture(f, (v) => ox + v * k, (v) => oy + v * k, false, -1, k).replace(/ class="un-fix"| class="un-fhit"| data-fi="-1"/g, "")}<text x="${W / 2}" y="${H - 1}" text-anchor="middle" font-size="8" fill="#6b7480">${sz[0]} × ${sz[1]} m</text></svg>`;
}
PT.previews("fix", (k) => fixThumb(k));
PT.previews("tpl", (k) => unitThumb(tplUnit(k)));
PT.previews("ulib", (id) => { const x = (LIB.units || []).find((q) => String(q.id) === String(id)); return x ? unitThumb(x.unit) : ""; });
PT.previews("unit", (name) => { const s = C && C.study(), l = s && s.units && Array.isArray(s.units.list) ? s.units.list : []; return unitThumb(l.find((q) => q.name === name)); });

/* a fitting of kind k centred on P, turned FIXROT quarter turns (the stored box is its footprint) */
function ghostFix(k, P) {
  const sz = FIXSZ[k] || [0.6, 0.6];
  let f = { kind: k, x: +(P[0] - sz[0] / 2).toFixed(2), y: +(P[1] - sz[1] / 2).toFixed(2), w: sz[0], h: sz[1], rot: 0 };
  for (let i = 0; i < FIXROT; i++) f = U.rotateFixture(f);
  return f;
}
function ensure(u) {
  if (!Array.isArray(u.windows)) u.windows = U.genWindows(u);
  if (!Array.isArray(u.fixtures)) u.fixtures = U.genFixtures(u);
  u.walls = u.walls && typeof u.walls === "object" ? u.walls : {};
  return u;
}
/* a point along a room's side: its two ends in plan metres */
/* the measures on the unit plan (for the visit), and what they snap to: the walls' faces and ends, the rooms' corners */
const MEAS = ME.create();
function measureGeo(u) {
  const f = U.figures(u), pts = [], segs = [];
  for (const e of f.edges) {
    if (U.isOpen(u, e)) continue;
    const t = U.tOfU ? U.tOfU(u, e) : 0.1, v = Math.abs(e.x1 - e.x2) < 1e-6;
    for (const sg of [-1, 1]) { const a = v ? [e.x1 + sg * t / 2, e.y1] : [e.x1, e.y1 + sg * t / 2], b = v ? [e.x2 + sg * t / 2, e.y2] : [e.x2, e.y2 + sg * t / 2]; segs.push([a, b]); pts.push(a, b); }
  }
  for (const r of u.rooms) pts.push([r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]);
  return { pts, segs };
}
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
  // fit: a margin for the dimension chains and the tool bar, smaller on a phone; then the zoom and pan
  const mg = Math.max(40, Math.min(130, 0.18 * Math.min(bw, bh))), top = Math.min(70, 30 + mg / 3);
  const fit = Math.max(4, Math.min((bw - 2 * mg) / W, (bh - 2 * mg - top / 2) / H));
  if (ZFOR !== store().sel) { PZ.reset(ZM); ZFOR = store().sel; }
  ({ SC, OX, OY } = PZ.apply(ZM, fit, (bw - W * fit) / 2, (bh - H * fit) / 2 + top / 3, bw, bh));
  const sx = (x) => OX + (x - BX) * SC, sy = (y) => OY + (y - BY) * SC;
  const wall = +(u.wall ?? 0.15), pt = +(u.part ?? 0.075), party = +(u.party ?? 0.15);
  let g = "";
  // the extras behind: bays as one dashed outline with their parts
  for (const [xi, e] of (u.extras || []).entries()) {
    const X = sx(e.x), Y = sy(e.y), w = e.w * SC, h = e.h * SC, sp = (+e.splay || 0) * SC;
    const pts = sp && e.splayL ? `${X},${Y} ${X + w},${Y} ${X + w},${Y + h} ${X + sp},${Y + h} ${X},${Y + h - sp}` : sp ? `${X},${Y} ${X + w},${Y} ${X + w},${Y + h - sp} ${X + w - sp},${Y + h} ${X},${Y + h}` : `${X},${Y} ${X + w},${Y} ${X + w},${Y + h} ${X},${Y + h}`;
    const xsel = SEL && SEL.t === "x" && SEL.i === xi;
    g += `<polygon class="un-x" data-xi="${xi}" points="${pts}" fill="${xsel ? "#f9dcc0" : e.kind === "roof" ? "#f4f4f2" : "#fffdf6"}" stroke="${xsel ? "#f28022" : "#3c4650"}" stroke-width="${xsel ? 2.5 : 0.8}" stroke-dasharray="${e.kind === "pd" || e.kind === "af" ? "0" : "6 3"}" />`;
    const parts = e.kind === "bay" ? U.expandBays([e]) : [e];
    parts.forEach((p, k) => {
      const PX = sx(p.x), PY = sy(p.y), pw = p.w * SC, ph = p.h * SC;
      if (e.kind === "bay" && k > 0) g += (e.h >= e.w) ? `<line x1="${PX}" y1="${PY}" x2="${PX + pw}" y2="${PY}" stroke="#3c4650" stroke-width="0.8" stroke-dasharray="3 2" pointer-events="none" />` : `<line x1="${PX}" y1="${PY}" x2="${PX}" y2="${PY + ph}" stroke="#3c4650" stroke-width="0.8" stroke-dasharray="3 2" pointer-events="none" />`;
      const kk = U.EXTRAS[p.kind] || {};
      if (pw > 22 && ph > 14) { const lg = LANG(); g += (lg === "en" ? "" : `<text x="${PX + pw / 2}" y="${PY + ph / 2 - 1}" text-anchor="middle" font-size="${Math.min(11, pw / 5)}" fill="#3c4650" pointer-events="none">${esc(kk.zh || "")}${lg === "zh" ? " " + f2(p.w * p.h) : ""}</text>`) + (lg === "zh" ? "" : `<text x="${PX + pw / 2}" y="${PY + ph / 2 + (lg === "en" ? 3 : 10)}" text-anchor="middle" font-size="${Math.min(10, pw / 6)}" fill="#3c4650" pointer-events="none">${esc(kk.ab || "")} ${f2(p.w * p.h)}</text>`); }
    });
  }
  // the rooms: pale like the office's plans; a space (living / dining with its foyer) as one
  const near = LIVE ? new Set(u.rooms.filter((r) => LIVE.axis === "x" ? Math.abs(r.x - LIVE.at) < 0.01 || Math.abs(r.x + r.w - LIVE.at) < 0.01 : Math.abs(r.y - LIVE.at) < 0.01 || Math.abs(r.y + r.h - LIVE.at) < 0.01).map((r) => r.id)) : null;
  const selSpace = SELR ? U.spaceOf(u.rooms.find((q) => q.id === SELR)) : null;
  for (const r of u.rooms) g += `<rect data-rid="${esc(r.id)}" class="un-r" x="${sx(r.x)}" y="${sy(r.y)}" width="${r.w * SC}" height="${r.h * SC}" fill="${near && near.has(r.id) ? "#f6d9b8" : selSpace && U.spaceOf(r) === selSpace ? "#f3e3ad" : ROOMFILL[r.kind] || "#fbf3d5"}" />`;
  // the open kitchen and other zones: dashed, over the rooms
  for (const [zi, z] of (u.zones || []).entries()) {
    const zs = SEL && SEL.t === "z" && SEL.i === zi, k = U.KINDS[z.kind] || {};
    g += `<rect x="${sx(z.x)}" y="${sy(z.y)}" width="${z.w * SC}" height="${z.h * SC}" fill="none" stroke="${zs ? "#f28022" : "#4a5866"}" stroke-width="${zs ? 2 : 0.7}" stroke-dasharray="5 3" pointer-events="none" />`;
  }
  // the fittings and furniture
  for (const [i, x] of u.fixtures.entries()) g += fixture(x, sx, sy, SEL && SEL.t === "fix" && SEL.i === i, i);
  // the walls at their thickness: partitions first (block, hatched), then the external and party walls (RC dark grey; precast hatched and dashed); each wall's two faces drawn
  WENDS = null;
  const tOf = (e) => (e.t != null ? e.t : e.kind === "ext" ? (U.FACADES[e.facade] && U.FACADES[e.facade].t != null ? U.FACADES[e.facade].t : wall) : e.kind === "party" ? party : pt);
  const band = (e, a, b, t, ext) => {   // the wall's rectangle from a to b along it, ext beyond its ends
    const v = e.x1 === e.x2;
    return v ? [sx(e.x1 - t / 2), sy(e.y1 + a - ext), t * SC, (b - a + 2 * ext) * SC] : [sx(e.x1 + a - ext), sy(e.y1 - t / 2), (b - a + 2 * ext) * SC, t * SC];
  };
  const faces = (e, a, b, t, ext, st, w) => {
    const v = e.x1 === e.x2;
    if (v) { const X1 = sx(e.x1 - t / 2), X2 = sx(e.x1 + t / 2), Y1 = sy(e.y1 + a - ext), Y2 = sy(e.y1 + b + ext); return `<line x1="${X1}" y1="${Y1}" x2="${X1}" y2="${Y2}" stroke="${st}" stroke-width="${w}" /><line x1="${X2}" y1="${Y1}" x2="${X2}" y2="${Y2}" stroke="${st}" stroke-width="${w}" />`; }
    const Y1 = sy(e.y1 - t / 2), Y2 = sy(e.y1 + t / 2), X1 = sx(e.x1 + a - ext), X2 = sx(e.x1 + b + ext);
    return `<line x1="${X1}" y1="${Y1}" x2="${X2}" y2="${Y1}" stroke="${st}" stroke-width="${w}" /><line x1="${X1}" y1="${Y2}" x2="${X2}" y2="${Y2}" stroke="${st}" stroke-width="${w}" />`;
  };
  const LW = Math.max(0.8, Math.min(1.4, SC * 0.022));   // wall faces, as the plans' heavier line
  // the openings cut the walls: windows and doors on their lines
  const GEO = wallRects(u, f);
  GEOR = GEO.rects;
  // the open (or shortened) partitions: a dashed line to find them
  for (const e of f.edges) {
    if (e.kind !== "part") continue;
    const sel = SEL && SEL.t === "wall" && SEL.key === e.key;
    const v = e.x1 === e.x2, P = (d) => (v ? [e.x1, e.y1 + d] : [e.x1 + d, e.y1]);
    if (U.isOpen(u, e)) {
      const sp = (() => { const A = u.rooms.find((q) => q.id === e.a), B = u.rooms.find((q) => q.id === e.b); return A && B && U.spaceOf(A) === U.spaceOf(B); })();
      if (sel || !sp) g += `<line x1="${sx(e.x1)}" y1="${sy(e.y1)}" x2="${sx(e.x2)}" y2="${sy(e.y2)}" stroke="${sel ? "#f28022" : "#8a949e"}" stroke-width="${sel ? 2.5 : 0.6}" stroke-dasharray="6 4" />`;
      continue;
    }
    const [a, b] = U.solidPart(u, e);
    if (b - a < e.len - 1e-6) g += `<line x1="${sx(e.x1)}" y1="${sy(e.y1)}" x2="${sx(e.x2)}" y2="${sy(e.y2)}" stroke="#8a949e" stroke-width="0.6" stroke-dasharray="6 4" />`;
    if (sel && C.can()) WENDS = { key: e.key, pts: [[P(a), "s"], [P(b), "e"]] };
  }
  // the walls as one: block partitions under the RC / precast, the outer lines heavy, a thin line where two materials meet
  const FILL = { blk: "url(#hp-blk)", rc: "url(#hp-rc)", pc: "url(#hp-pc)" };
  for (const m of ["blk", "pc", "rc"]) for (const r of GEO.rects) if (r.m === m) g += `<rect x="${sx(r.x0)}" y="${sy(r.y0)}" width="${(r.x1 - r.x0) * SC}" height="${(r.y1 - r.y0) * SC}" fill="${FILL[m]}" />`;
  for (const l of GEO.lines) g += `<line x1="${sx(l.x1)}" y1="${sy(l.y1)}" x2="${sx(l.x2)}" y2="${sy(l.y2)}" stroke="${l.k === "join" ? "#555" : "#111"}" stroke-width="${l.k === "join" ? 0.45 : l.k === "blk" ? LW * 0.8 : LW}" stroke-linecap="square" />`;
  if (SEL && SEL.t === "wall") for (const r of GEO.rects) if (r.key === SEL.key) g += `<rect x="${sx(r.x0)}" y="${sy(r.y0)}" width="${(r.x1 - r.x0) * SC}" height="${(r.y1 - r.y0) * SC}" fill="#f28022" fill-opacity="0.25" stroke="#f28022" stroke-width="2" pointer-events="none" />`;
  // the curtain walls
  for (const e of f.edges) {
    if (!(e.kind === "ext" && e.facade === "cw")) continue;
    const sel = SEL && SEL.t === "wall" && SEL.key === e.key, t = tOf(e), v = e.x1 === e.x2;
    const nx = e.face === "e" ? 1 : e.face === "w" ? -1 : 0, ny = e.face === "s" ? 1 : e.face === "n" ? -1 : 0;
    if (e.kind === "ext" && e.facade === "cw") {
      // a curtain wall: the glass panes flush with the mullions' outer face, a mullion every 1.2 m or so; a 100 mm curb
      // (a low wall, 300 mm high: light, not hatched) on the inside - not under a door (to the balcony); doors and windows
      // in it as on any wall (the panes and mullions stop at them, a mullion each side)
      const o1 = t / 2, cur = 0.1, gt = 0.024, mw = 0.05, md = t, len = e.len;
      // the walls meeting its ends: the curb, glass and mullions stop at their faces (not over them)
      const endT = (px, py) => Math.max(0, ...f.edges.filter((q) => q !== e && (q.x1 === q.x2) !== v && !U.isOpen(u, q) && !(q.kind === "ext" && q.facade === "cw") && ((Math.abs(q.x1 - px) < 1e-6 && Math.abs(q.y1 - py) < 1e-6) || (Math.abs(q.x2 - px) < 1e-6 && Math.abs(q.y2 - py) < 1e-6))).map((q) => tOf(q) / 2));
      const L0 = endT(e.x1, e.y1), L1 = len - endT(e.x2, e.y2);
      const R = (a0, a1, f0, f1, fill, st, sw, extra = "") => {
        const lo = Math.min(f0, f1), hi = Math.max(f0, f1);
        return v ? `<rect x="${sx(e.x1 + Math.min(nx * lo, nx * hi))}" y="${sy(e.y1 + a0)}" width="${(hi - lo) * SC}" height="${(a1 - a0) * SC}" fill="${fill}" stroke="${st}" stroke-width="${sw}"${extra} />`
          : `<rect x="${sx(e.x1 + a0)}" y="${sy(e.y1 + Math.min(ny * lo, ny * hi))}" width="${(a1 - a0) * SC}" height="${(hi - lo) * SC}" fill="${fill}" stroke="${st}" stroke-width="${sw}"${extra} />`;
      };
      // its openings, along it
      const spans = [];
      for (const [list, kind] of [[u.doors || [], "door"], [u.windows || [], "win"]]) for (const d of list) {
        const r = u.rooms.find((q) => q.id === d.room); if (!r) continue;
        const [pa, pb] = sideSeg(r, d.side, +d.at || 0, +d.w || (kind === "door" ? 0.8 : 1));
        if (v ? Math.abs(pa[0] - e.x1) > 1e-6 || Math.abs(pb[0] - e.x1) > 1e-6 : Math.abs(pa[1] - e.y1) > 1e-6 || Math.abs(pb[1] - e.y1) > 1e-6) continue;
        const s0 = v ? Math.min(pa[1], pb[1]) - e.y1 : Math.min(pa[0], pb[0]) - e.x1, s1 = v ? Math.max(pa[1], pb[1]) - e.y1 : Math.max(pa[0], pb[0]) - e.x1;
        if (s1 <= L0 || s0 >= L1) continue;
        spans.push({ a: Math.max(L0, s0), b: Math.min(L1, s1), kind });
      }
      spans.sort((p1, p2) => p1.a - p2.a);
      const minus = (lo, hi, cut) => { let out = [[lo, hi]]; for (const c of cut) out = out.flatMap(([x0, x1]) => (c.b <= x0 || c.a >= x1 ? [[x0, x1]] : [[x0, c.a], [c.b, x1]].filter(([q0, q1]) => q1 - q0 > 1e-3))); return out; };
      // the curb: not under the doors
      for (const [c0, c1] of minus(L0, L1, spans.filter((q) => q.kind === "door"))) g += R(c0, c1, -o1, -(o1 + cur), "#e4e7eb", "#6b7480", LW * 0.5);
      // the mullions: on the module, none inside an opening, one each side of it
      const k = Math.max(1, Math.round(len / 1.2)), ms = new Set();
      for (let j = 0; j <= k; j++) { const q = Math.max(L0 + mw / 2, Math.min(L1 - mw / 2, L0 + (L1 - L0) * j / k)); if (!spans.some((sp) => q > sp.a + mw && q < sp.b - mw)) ms.add(+q.toFixed(4)); }
      for (const sp of spans) { ms.add(+sp.a.toFixed(4)); ms.add(+sp.b.toFixed(4)); }
      const mlist = [...ms].sort((p1, p2) => p1 - p2);
      // the glass: a pane between each two mullions, its outer face flush with theirs (the wall's outer face)
      for (let j = 0; j < mlist.length - 1; j++) {
        const a0 = mlist[j], a1 = mlist[j + 1], mid = (a0 + a1) / 2;
        if (spans.some((sp) => mid > sp.a && mid < sp.b) || a1 - a0 < 0.02) continue;
        g += R(Math.max(L0, a0 + mw / 2), Math.min(L1, a1 - mw / 2), o1, o1 - gt, "#cfe6f3", "#2b6c8f", 0.6);
      }
      for (const q of mlist) g += R(Math.max(L0, q - mw / 2), Math.min(L1, q + mw / 2), o1, o1 - md, "#2b6c8f", "none", 0);
      if (sel) g += `<line x1="${sx(e.x1)}" y1="${sy(e.y1)}" x2="${sx(e.x2)}" y2="${sy(e.y2)}" stroke="#f28022" stroke-width="2" />`;
      if (SC > 45) { const mx = sx((e.x1 + e.x2) / 2 - nx * (o1 + cur + 0.12)), my = sy((e.y1 + e.y2) / 2 - ny * (o1 + cur + 0.12)); g += `<text x="${mx}" y="${my}" font-size="8" fill="#2b6c8f" text-anchor="middle" pointer-events="none"${v ? ` transform="rotate(-90 ${mx} ${my})"` : ""}>C.W. · 100 curb 300 H${spans.some((q) => q.kind === "door") ? " (none at the door)" : ""}</text>`; }
      continue;
    }
  }
  // the wall lines to drag / click
  for (const e of f.edges) {
    const v = e.x1 === e.x2, hw = 6;
    g += v ? `<rect class="un-drag v" data-ek="${esc(e.key)}" x="${sx(e.x1) - hw}" y="${sy(e.y1)}" width="${hw * 2}" height="${(e.y2 - e.y1) * SC}" />`
      : `<rect class="un-drag h" data-ek="${esc(e.key)}" x="${sx(e.x1)}" y="${sy(e.y1) - hw}" width="${(e.x2 - e.x1) * SC}" height="${hw * 2}" />`;
  }
  // the thickness of the wall a window or door sits in, and how far its centre is off the grid line
  const wallT = (room, side) => { const e = f.edges.find((q) => q.kind !== "part" && q.a === room && q.face === side) || f.edges.find((q) => q.kind === "part" && (q.a === room || q.b === room)); return e ? tOf(e) : pt; };
  const wallAt = (a, b) => {
    const v = Math.abs(a[0] - b[0]) < 1e-6, m = v ? (a[1] + b[1]) / 2 : (a[0] + b[0]) / 2;
    const e = f.edges.find((q) => (q.x1 === q.x2) === v && Math.abs((v ? q.x1 : q.y1) - (v ? a[0] : a[1])) < 1e-6 && m >= (v ? q.y1 : q.x1) - 1e-6 && m <= (v ? q.y2 : q.x2) + 1e-6);
    return e ? { t: tOf(e), o: GEO.off.get(e) || 0 } : null;
  };
  // the windows: frame - glass - frame across the cut, the sill inside
  for (const [i, w] of u.windows.entries()) {
    const r = u.rooms.find((q) => q.id === w.room); if (!r) continue;
    const [a, b] = sideSeg(r, w.side, +w.at || 0, +w.w || 1), at = wallAt(a, b), t = at ? at.t : wallT(w.room, w.side), o = at ? at.o : 0, sel = SEL && SEL.t === "win" && SEL.i === i;
    const vert = a[0] === b[0], st = sel ? "#f28022" : "#222";
    const L = (off, wd) => vert ? `<line x1="${sx(a[0] + o + off)}" y1="${sy(a[1])}" x2="${sx(b[0] + o + off)}" y2="${sy(b[1])}" stroke="${st}" stroke-width="${wd}" />` : `<line x1="${sx(a[0])}" y1="${sy(a[1] + o + off)}" x2="${sx(b[0])}" y2="${sy(b[1] + o + off)}" stroke="${st}" stroke-width="${wd}" />`;
    g += L(-t / 2, 0.7) + L(-0.012, 0.45) + L(0.012, 0.45) + L(t / 2, 0.7);
    g += `<line class="un-hit" data-wi="${i}" x1="${sx(a[0])}" y1="${sy(a[1])}" x2="${sx(b[0])}" y2="${sy(b[1])}" stroke="transparent" stroke-width="${t * SC + 8}" />`;
  }
  // the doors: a rebated frame at each jamb (flush with the face the door opens to), the leaf open at 90 degrees from its hinge, the swing
  for (const [i, d] of (u.doors || []).entries()) {
    const r = u.rooms.find((q) => q.id === d.room); if (!r) continue;
    const dw = +d.w || 0.8, [a, b, inn] = sideSeg(r, d.side, +d.at || 0, dw), sel = SEL && SEL.t === "door" && SEL.i === i;
    const at = wallAt(a, b), t = at ? at.t : wallT(d.room, d.side), o = at ? at.o : 0, vert = a[0] === b[0], st = sel ? "#f28022" : "#222";
    const hit = `<line class="un-hit" data-di="${i}" x1="${sx(a[0])}" y1="${sy(a[1])}" x2="${sx(b[0])}" y2="${sy(b[1])}" stroke="transparent" stroke-width="${t * SC + 4}" />`;
    if (d.type === "sliding" || d.type === "sliding2") { g += slideSvg(a, b, t, o, vert, st, d, sel, sx, sy) + hit; continue; }
    if (d.type === "panel") {
      // an access panel: three lines on the wall across it
      const nm = vert ? [1, 0] : [0, 1], P2 = (p, nn) => [p[0] + nm[0] * (o + nn), p[1] + nm[1] * (o + nn)];
      const ln = (p, q, w) => `<line x1="${sx(p[0])}" y1="${sy(p[1])}" x2="${sx(q[0])}" y2="${sy(q[1])}" stroke="${st}" stroke-width="${w}" />`;
      g += `<polygon points="${[P2(a, -t / 2), P2(b, -t / 2), P2(b, t / 2), P2(a, t / 2)].map((q) => sx(q[0]) + "," + sy(q[1])).join(" ")}" fill="#fff" stroke="${st}" stroke-width="0.6" />` + ln(P2(a, -t * 0.35), P2(b, -t * 0.35), 0.6) + ln(P2(a, 0), P2(b, 0), 0.6) + ln(P2(a, t * 0.35), P2(b, t * 0.35), 0.6) + hit;
      continue;
    }
    if (d.type === "opening") {
      // an opening: the jambs, no leaf; a dashed line across
      const nm = vert ? [1, 0] : [0, 1], P2 = (p, nn) => [p[0] + nm[0] * (o + nn), p[1] + nm[1] * (o + nn)];
      const ln = (p, q, w, ex = "") => `<line x1="${sx(p[0])}" y1="${sy(p[1])}" x2="${sx(q[0])}" y2="${sy(q[1])}" stroke="${st}" stroke-width="${w}"${ex} />`;
      g += `<polygon points="${[P2(a, -t / 2), P2(b, -t / 2), P2(b, t / 2), P2(a, t / 2)].map((q) => sx(q[0]) + "," + sy(q[1])).join(" ")}" fill="#fff" stroke="none" />` + ln(P2(a, -t / 2), P2(a, t / 2), 0.8) + ln(P2(b, -t / 2), P2(b, t / 2), 0.8) + ln(P2(a, 0), P2(b, 0), 0.5, ' stroke-dasharray="3 2"') + hit;
      continue;
    }
    if (d.type === "door2" && !d._half) {
      // a double door: two leaves meeting in the middle
      const h1 = Object.assign({}, d, { _half: 1, w: dw / 2, hinge: "start", _noJamb: "b" }), h2 = Object.assign({}, d, { _half: 1, at: (+d.at || 0) + dw / 2, w: dw / 2, hinge: "end", _noJamb: "a" });
      u.doors.splice(i, 1, h1); g += drawDoorOnce(i); u.doors.splice(i, 1, h2); g += drawDoorOnce(i); u.doors.splice(i, 1, d);
      g += hit; continue;
    }
    g += drawDoorOnce(i) + hit;
  }
  function drawDoorOnce(i) {
    let g = "";
    const d = u.doors[i], r = u.rooms.find((q) => q.id === d.room);
    const dw = +d.w || 0.8, [a, b, inn] = sideSeg(r, d.side, +d.at || 0, dw), sel = SEL && SEL.t === "door" && SEL.i === i;
    const at = wallAt(a, b), t = at ? at.t : wallT(d.room, d.side), o = at ? at.o : 0, vert = a[0] === b[0], st = sel ? "#f28022" : "#222";
    const k = d.swing === "out" ? -1 : 1, sn = [inn[0] * k, inn[1] * k];                   // the side the door opens to
    const al = vert ? [0, 1] : [1, 0], ctr = vert ? [o, 0] : [0, o];
    const fw = 0.05, fd = Math.min(t, 0.1), stp = 0.015, lt = 0.04;
    // a point by the jamb J: uu along the opening (into it), nn from the swing face into the wall (negative: out in the room)
    const pt2 = (J, s2, uu, nn) => [J[0] + ctr[0] + al[0] * s2 * uu + sn[0] * (t / 2 - nn), J[1] + ctr[1] + al[1] * s2 * uu + sn[1] * (t / 2 - nn)];
    const poly = (ps) => `<polygon points="${ps.map((q) => sx(q[0]) + "," + sy(q[1])).join(" ")}" fill="#fff" stroke="${st}" stroke-width="0.7" />`;
    // a double door's halves: no frame where the two leaves meet
    for (const [J, s2, nm] of [[a, 1, "a"], [b, -1, "b"]]) if (d._noJamb !== nm) g += poly([[0, 0], [fw, 0], [fw, lt], [fw + stp, lt], [fw + stp, fd], [0, fd]].map(([uu, nn]) => pt2(J, s2, uu, nn)));
    const hinge = d.hinge === "end" ? [b, -1] : [a, 1], other = d.hinge === "end" ? [a, 1] : [b, -1];
    const lw2 = dw - (d._noJamb ? fw : 2 * fw), sf = d._noJamb ? 0 : fw;
    const Hp = pt2(hinge[0], hinge[1], fw, 0), tip = pt2(hinge[0], hinge[1], fw, -lw2), shut = pt2(other[0], other[1], sf, 0);
    g += poly([[fw, 0], [fw + lt, 0], [fw + lt, -lw2], [fw, -lw2]].map(([uu, nn]) => pt2(hinge[0], hinge[1], uu, nn)));
    const cr = (tip[0] - Hp[0]) * (shut[1] - Hp[1]) - (tip[1] - Hp[1]) * (shut[0] - Hp[0]);
    g += `<path d="M ${sx(tip[0])} ${sy(tip[1])} A ${lw2 * SC} ${lw2 * SC} 0 0 ${cr > 0 ? 1 : 0} ${sx(shut[0])} ${sy(shut[1])}" fill="none" stroke="${st}" stroke-width="${sel ? 1.4 : 0.45}" />`;
    return g;
  }
  // the zones' hit areas and labels (over the walls, under the room labels)
  for (const [zi, z] of (u.zones || []).entries()) {
    const k = U.KINDS[z.kind] || {}, X = sx(z.x + z.w / 2), Y = sy(z.y + z.h / 2), fs = Math.max(7, Math.min(11, z.w * SC / 8, SC * 0.26));
    // picked by its dashed outline, so the fittings inside it stay clickable
    g += `<rect class="un-z" data-zi="${zi}" x="${sx(z.x)}" y="${sy(z.y)}" width="${z.w * SC}" height="${z.h * SC}" fill="none" stroke="transparent" stroke-width="10" pointer-events="stroke" />`;
    { const lg = LANG(), one = lg !== "both", t1 = lg === "en" ? k.ab || z.kind : k.zh || "", t2 = k.ab || z.kind;
      g += `<text x="${X}" y="${one ? Y + fs / 3 : Y - 2}" text-anchor="middle" font-size="${fs}" fill="#1f2a36" pointer-events="none">${esc(t1)}</text>` + (one ? "" : `<text x="${X}" y="${Y + fs}" text-anchor="middle" font-size="${fs - 1}" fill="#1f2a36" pointer-events="none">${esc(t2)}</text>`); }
    if (SEL && SEL.t === "z" && SEL.i === zi && C.can()) for (const [cx, cy, c] of [[z.x, z.y, "nw"], [z.x + z.w, z.y, "ne"], [z.x + z.w, z.y + z.h, "se"], [z.x, z.y + z.h, "sw"], [z.x + z.w / 2, z.y, "n"], [z.x + z.w, z.y + z.h / 2, "e"], [z.x + z.w / 2, z.y + z.h, "s"], [z.x, z.y + z.h / 2, "w"]]) g += c.length === 2 ? `<rect class="un-zh" data-zh="${zi}:${c}" x="${sx(cx) - 5}" y="${sy(cy) - 5}" width="10" height="10" fill="#fff" stroke="#f28022" stroke-width="2" style="cursor:${c === "nw" || c === "se" ? "nwse" : "nesw"}-resize" />` : `<circle class="un-zh" data-zh="${zi}:${c}" cx="${sx(cx)}" cy="${sy(cy)}" r="5" fill="#fff" stroke="#f28022" stroke-width="2" style="cursor:${c === "n" || c === "s" ? "ns" : "ew"}-resize"><title>Drag this edge (to a wall's face or centre line; Alt: free)</title></circle>`;
  }
  // the selected fitting's edges: drag one to make it wider or longer
  if (SEL && SEL.t === "fix" && u.fixtures[SEL.i] && C.can()) {
    const B = fixBox(u.fixtures[SEL.i]);
    g += `<text x="${sx((B.x0 + B.x1) / 2)}" y="${sy(B.y0) - 8}" text-anchor="middle" font-size="10" font-weight="700" fill="#b4520a" pointer-events="none" paint-order="stroke" stroke="#fff" stroke-width="3">${fL(B.x1 - B.x0)} × ${fL(B.y1 - B.y0)} ${uL()}</text>`;
    for (const [c, X, Y] of [["n", (B.x0 + B.x1) / 2, B.y0], ["s", (B.x0 + B.x1) / 2, B.y1], ["w", B.x0, (B.y0 + B.y1) / 2], ["e", B.x1, (B.y0 + B.y1) / 2]])
      g += `<circle class="un-fh" data-fh="${SEL.i}:${c}" cx="${sx(X)}" cy="${sy(Y)}" r="5" fill="#fff" stroke="#f28022" stroke-width="2" style="cursor:${c === "n" || c === "s" ? "ns" : "ew"}-resize"><title>Drag to make it ${c === "n" || c === "s" ? "deeper / shallower" : "wider / narrower"} (to a wall face; Alt: free)</title></circle>`;
  }
  // the selected wall's temporary dimensions (as Revit): the clear width of the room each side of it - click one to type
  if (SEL && SEL.t === "wall" && C.can()) {
    const e = f.edges.find((q) => q.key === SEL.key);
    if (e && !U.isOpen(u, e)) {
      // about a quarter along the wall: clear of the rooms' names in their middles
      const v = e.x1 === e.x2, line = v ? e.x1 : e.y1, mid = v ? e.y1 + (e.y2 - e.y1) * 0.27 : e.x1 + (e.x2 - e.x1) * 0.27;
      const rs = [e.a, e.b].filter(Boolean).map((id) => u.rooms.find((q) => q.id === id)).filter(Boolean);
      for (const r of rs) {
        const c = clearBox(r, GEOR), before = v ? Math.abs(r.x + r.w - line) < 0.01 : Math.abs(r.y + r.h - line) < 0.01;
        const a = v ? c.x0 : c.y0, b = v ? c.x1 : c.y1, at = Math.max(v ? r.y + 0.3 : r.x + 0.3, Math.min(v ? r.y + r.h - 0.3 : r.x + r.w - 0.3, mid));
        const P = (q) => (v ? [sx(q), sy(at)] : [sx(at), sy(q)]), A = P(a), Bp = P(b), M = [(A[0] + Bp[0]) / 2, (A[1] + Bp[1]) / 2], L = fLab(a, b);
        g += `<line x1="${A[0]}" y1="${A[1]}" x2="${Bp[0]}" y2="${Bp[1]}" stroke="#1f6feb" stroke-width="1" pointer-events="none" />`;
        for (const T of [A, Bp]) g += v ? `<line x1="${T[0]}" y1="${T[1] - 5}" x2="${T[0]}" y2="${T[1] + 5}" stroke="#1f6feb" stroke-width="1" pointer-events="none" />` : `<line x1="${T[0] - 5}" y1="${T[1]}" x2="${T[0] + 5}" y2="${T[1]}" stroke="#1f6feb" stroke-width="1" pointer-events="none" />`;
        g += `<g class="un-td" data-td="${before ? "b" : "a"}:${esc(r.id)}"><rect x="${M[0] - 24}" y="${M[1] - 9}" width="48" height="16" rx="8" fill="#fff" stroke="#1f6feb" data-td="${before ? "b" : "a"}:${esc(r.id)}" /><text x="${M[0]}" y="${M[1] + 3}" text-anchor="middle" font-size="10" font-weight="700" fill="#1f6feb" data-td="${before ? "b" : "a"}:${esc(r.id)}">${L}</text><title>Click and type the clear width: the selected wall moves (the room beside it follows)</title></g>`;
      }
    }
  }
  // the labels: one a space, at its largest piece, its area when it has more than one
  for (const r of u.rooms) {
    if (r.space && r.space !== r.id) continue;
    const k = U.KINDS[r.kind] || {}; if (!k.zh && !k.ab) continue;
    const parts = u.rooms.filter((q) => U.spaceOf(q) === r.id), big = parts.reduce((m, q) => (q.w * q.h > m.w * m.h ? q : m), r);
    const X = sx(big.x + big.w / 2), Y = sy(big.y + big.h / 2), w = big.w * SC, fs = Math.max(7, Math.min(12, w / 7, SC * 0.28)), lv = near && near.has(r.id);
    const no = r.name && /\d/.test(r.name) ? r.name.match(/\d+/)[0] : "";
    const small = big.h * SC < fs * 4.2, size = parts.length > 1 ? f1(parts.reduce((s2, q) => s2 + q.w * q.h, 0)) + " m²" : (() => { const c = clearBox(r, GEOR); return `${fLab(c.x0, c.x1)} × ${fLab(c.y0, c.y1)}`; })();
    const lg = LANG(), t1 = lg === "en" ? `${k.ab || ""}${no}` : `${k.zh || ""}${no ? " " + no : ""}`, two = lg === "both";
    g += `<text x="${X}" y="${small ? Y + fs / 3 : Y - 4}" text-anchor="middle" font-size="${fs}" fill="#1f2a36" pointer-events="none">${esc(t1)}</text>` + (small && !lv ? "" : (two ? `<text x="${X}" y="${Y + fs}" text-anchor="middle" font-size="${fs - 1}" fill="#1f2a36" pointer-events="none">${esc(k.ab)}${no}</text>` : "") + `
      <text x="${X}" y="${Y + fs * (two ? 2 : 1) + 2}" text-anchor="middle" font-size="${lv ? fs : fs - 3}" font-weight="${lv ? 700 : 400}" fill="${lv ? "#b4520a" : "#5b6b7b"}" pointer-events="none">${size}</text>`);
  }
  // the saleable and GFA lines, to check the figures
  const AL = ALINES();
  if (AL !== "off") {
    const ring = (rg, col, dash) => rg.rings.map((pts) => `<polygon points="${pts.map(([x, y]) => sx(x) + "," + sy(y)).join(" ")}" fill="none" stroke="${col}" stroke-width="1.6" stroke-dasharray="${dash}" pointer-events="none" />`).join("");
    const exs2 = U.expandBays(u.extras || []).filter((e) => e.kind === "bal" || e.kind === "up");
    if (AL === "saleable" || AL === "both") g += ring(f.ringS, "#c62828", "9 3 2 3") + exs2.map((e) => `<rect x="${sx(e.x)}" y="${sy(e.y)}" width="${e.w * SC}" height="${e.h * SC}" fill="none" stroke="#c62828" stroke-width="1.2" stroke-dasharray="9 3 2 3" pointer-events="none" />`).join("");
    if (AL === "gfa" || AL === "both") g += ring(f.ringG, "#1565c0", "6 3");
    const lines = [];
    if (AL === "saleable" || AL === "both") lines.push([`#c62828`, `Saleable ${f2(f.saleable)} m² = within the line ${f2(f.ringArea)} + balcony ${f2(f.bal)} + UP ${f2(f.up)}`]);
    if (AL === "gfa" || AL === "both") lines.push([`#1565c0`, `GFA ${f2(f.gfa)} m² = within the line ${f2(f.gfaRing)}${f.pcEx ? "" : ""} + balcony ${f2(f.bal - f.balEx)} + UP ${f2(f.up - f.upEx)} (not exempt)${Math.abs(f.gfa - (f.gfaRing + f.bal - f.balEx + f.up - f.upEx)) > 0.02 ? ` · corners ${f2(f.gfa - (f.gfaRing + f.bal - f.balEx + f.up - f.upEx))}` : ""}`]);
    lines.forEach(([c, t2], k) => { g += `<text x="14" y="${bh - 46 + k * 15}" font-size="11.5" fill="${c}" font-weight="600">${esc(t2)}</text>`; });
  }
  // a selected partition's ends: drag to shorten it
  if (WENDS) for (const [p, k] of WENDS.pts) g += `<circle class="un-wend" data-wend="${k}" cx="${sx(p[0])}" cy="${sy(p[1])}" r="7" fill="#fff" stroke="#f28022" stroke-width="2.5" />`;
  g += dims(u, f, sx, sy);
  if (HOVW) g += `<line x1="${sx(HOVW.e.x1)}" y1="${sy(HOVW.e.y1)}" x2="${sx(HOVW.e.x2)}" y2="${sy(HOVW.e.y2)}" stroke="#1f6feb" stroke-width="8" stroke-opacity="0.45" pointer-events="none" />`;
  if (GHOST && TOOL.startsWith("fix:")) g += `<g pointer-events="none" opacity="0.6">${fixture(ghostFix(TOOL.slice(4), GHOST), sx, sy, true, -1).replace(/ class="un-fix"| class="un-fhit"| data-fi="-1"/g, "")}</g>`;
  if (LIVE) g += `<text x="${bw / 2}" y="${bh - 40}" text-anchor="middle" font-size="14" font-weight="700" fill="#b4520a">${LIVE.d >= 0 ? "+" : ""}${fL(LIVE.d)} ${uL()}</text>`;
  g += `<text x="${bw - 20}" y="${bh - 18}" text-anchor="end" font-size="11" fill="#6b7785">${esc(u.name || "")} · ${f.saleableFt} ft² · ${f1(f.saleable)} m²</text>`;
  if (!INPLACE) g += ME.svg(MEAS, sx, sy);
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}" font-family="'Noto Sans HK', 'PingFang HK', sans-serif">${HATCH}${g}</svg>${INPLACE ? toolbar() + popup(u, f, sx, sy, bw, bh) : ""}${PZ.bar(document.body.classList.contains("st-planfull"))}`;
  if (!INPLACE) { const pp = popup(u, f, sx, sy, bw, bh); PT.mount("units", topBar(), pp ? `<div class="pt-prop un-prop">${pp.replace(/^<div class="un-pop"[^>]*>/, "").replace(/<\/div>$/, "")}</div>` : `<div class="pt-prop"><span class="pt-pt"><b>${esc(u.name || "Unit")}</b><small>${f.saleableFt} ft² · ${f1(f.saleable)} m² · click a wall, door or room · right-click for more</small></span></div>`, C.can() ? PT.OPENINGS : null); }
  else PT.unmount("units");
}
/* the icon toolbar along the top of the unit plan */
function topBar() {
  const can = C.can(), T = (id, icon, title, key, text) => ({ id, icon, title, key, text, on: TOOL === id });
  const sel = (attr, opts, cur2, ttl) => `<select ${attr} title="${esc(ttl)}" class="pt-sel">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === cur2 ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const G = [[T("select", "select", "Select: click a wall, door, window, fitting, balcony or UP; drag a wall (Alt: the whole line)", "V")]];
  if (can) {
    G.push([T("room", "room", "Room: drag a rectangle beside the rooms", "R"), { html: sel("data-roomk", Object.entries(U.KINDS).map(([k, q]) => [k, q.label]), ROOMK, "The kind of the room you draw") }, T("split-x", "split", "Split │: click a room", "", "│"), T("split-y", "split", "Split ─: click a room", "", "─")]);
    G.push([T("door", "door", "Door: click a wall", "D"), T("window", "window", "Window: click an external wall", "W"), { id: "lib", icon: "library", title: "Doors, windows and openings: drag one onto a wall", on: PT.libraryOpen() }]);
    G.push([{ html: sel("data-xadd", [["", "Balcony / UP …"], ...Object.entries(XADD).map(([k, v]) => [k, v.label])], TOOL.startsWith("x:") ? TOOL.slice(2) : "", "Then click an external wall: it goes outside it") }, { html: `<select data-fixadd data-pick="fix" title="A fitting or furniture: then click a room to place it (Space or R turns it)" class="pt-sel"><option value="">Fitting / furniture …</option>${fixOpts(TOOL.startsWith("fix:") ? TOOL.slice(4) : "")}</select>` }]);
  }
  G.push([T("measure", "measure", "Measure: click two points (they snap to the walls' faces and corners; two parallel faces give the clear width); Esc clears", "Q")]);
  G.push([{ html: sel("data-alines", [["off", "Area lines: off"], ["saleable", "Saleable line"], ["gfa", "GFA line"], ["both", "Saleable + GFA"]], ALINES(), "The saleable and GFA lines") }, { html: sel("data-dims", [["chains", "Dims: inside rooms"], ["centre", "Dims: wall centres"], ["overall", "Dims: overall"], ["off", "Dims: off"]], DIMS(), "Dimensions: each room's clear size inside its walls (and the walls), or to the walls' centre lines") }, { html: sel("data-ulang", [["both", "名 Names: 中 / EN"], ["en", "Names: English"], ["zh", "名稱：中文"]], LANG(), "The room names: bilingual, English or Chinese") }, { html: sel("data-ulen", [["mm", "Units: mm"], ["cm", "Units: cm"], ["m", "Units: m"]], LEN(), "The lengths on the plan and in the panel: millimetres, centimetres or metres") }]);
  if (can) G.push([{ id: "undo", icon: "undo", title: "Undo", key: "Ctrl+Z" }, { id: "redo", icon: "redo", title: "Redo", key: "Ctrl+Y" }]);
  G.push([{ id: "brochure", icon: "pdf", title: "Unit plans as a brochure: one A4 a unit, with its furniture, dimensions and areas (print, or save as PDF)" }, { id: "uxlsx", icon: "export", title: "Unit schedule (Excel): every unit's areas" }]);
  return PT.toolbar(G, null, "units");
}

/* ---------- the brochure: each unit's plan as on the sales brochures (A4, its furniture and dimensions, the areas) */
function brochure(which) {
  const st = store(); if (!st.list.length) return toast("No unit to print", true);
  const host = $("#st-uplan"), keep = { sel: st.sel, SEL, TOOL, SELR, style: host.getAttribute("style") || "", z: JSON.stringify(ZM) };
  const pages = [];
  try {
    host.setAttribute("style", keep.style + ";width:1000px;height:1100px;position:fixed;left:-5000px;top:0");
    SEL = null; SELR = null; TOOL = "select";
    (which || [st.sel]).forEach((i) => {
      const u = st.list[i]; if (!u) return;
      st.sel = i; ZFOR = null; drawPlan();
      const svg = host.querySelector("svg"); if (!svg) return;
      const c = svg.cloneNode(true);
      c.querySelectorAll("[class*=hit], .un-fhit, [data-wend], .pt-bar").forEach((x) => x.remove());
      c.setAttribute("viewBox", `0 0 ${svg.clientWidth || 1000} ${svg.clientHeight || 1100}`); c.removeAttribute("width"); c.removeAttribute("height");
      const f = U.figures(ensure(u)), ft = (m) => Math.round(m * U.M2_FT2);
      const row = (l, m) => (m > 0 ? `<tr><td>${esc(l)}</td><td>${m.toFixed(3)} m²</td><td>${ft(m).toLocaleString("en-GB")} ft²</td></tr>` : "");
      pages.push(`<section class="pg"><header><h1>${esc(u.name || "Unit")}</h1><span>${esc(C.study().name || "")}</span></header><div class="plan">${c.outerHTML}</div>
        <table><tbody>${row("Saleable area", f.saleable)}${row("Balcony", f.bal)}${row("Utility platform", f.up)}${row("Air-conditioning plant platform", f.acp)}</tbody></table>
        <footer><svg width="34" height="44" viewBox="0 0 34 44"><path d="M17 2 L28 40 L17 32 L6 40 Z" fill="#222"/><text x="17" y="44" text-anchor="middle" font-size="9">N</text></svg><small>The saleable area as defined in the Residential Properties (First-hand Sales) Ordinance (Cap. 621): the unit's floor area to the outside of its external walls and the middle of the walls it shares; balcony, utility platform and A/C platform listed apart. For a scheme study, not for sale.</small></footer></section>`);
    });
  } finally {
    host.setAttribute("style", keep.style); st.sel = keep.sel; SEL = keep.SEL; TOOL = keep.TOOL; SELR = keep.SELR; ZFOR = keep.sel; try { Object.assign(ZM, JSON.parse(keep.z)); } catch (e) {} drawPlan();
  }
  const w = window.open("", "_blank"); if (!w) return toast("Allow pop-ups to print the brochure", true);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Unit plans</title><style>
    @page { size: A4; margin: 12mm; } body { font: 12px/1.4 system-ui, sans-serif; color: #222; margin: 0; }
    .pg { page-break-after: always; display: flex; flex-direction: column; height: 270mm; } .pg:last-child { page-break-after: auto; }
    header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1.5px solid #222; margin-bottom: 6mm; } h1 { font-size: 20px; margin: 0 0 2mm; }
    .plan { flex: 1; min-height: 0; } .plan svg { width: 100%; height: 100%; }
    table { border-collapse: collapse; margin: 4mm 0; } td { padding: 2px 14px 2px 0; } td:nth-child(2), td:nth-child(3) { text-align: right; font-variant-numeric: tabular-nums; }
    footer { display: flex; gap: 12px; align-items: flex-end; color: #555; } footer small { font-size: 9px; }
    @media screen { body { background: #e8eaed; } .pg { background: #fff; width: 186mm; margin: 10mm auto; padding: 12mm; box-shadow: 0 2px 10px rgba(0,0,0,.15); } }
  </style></head><body>${pages.join("")}<script>setTimeout(() => window.print(), 400);<\/script></body></html>`);
  w.document.close();
}
/* the unit schedule: every unit in 3 · Units with its areas (Excel) */
async function unitsXlsx() {
  const st = store(); if (!st.list.length) return toast("No unit", true);
  const r3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
  const rows = st.list.map((u) => { const f = U.figures(ensure(u)); return [u.name || "Unit", r3(f.saleable), f.saleableFt, r3(f.gfa), r3(f.bal), r3(f.up), r3(f.acp), r3(f.balEx + f.upEx + f.acpCapEx), f.efficiency != null ? r3(f.efficiency * 100) : ""]; });
  const sheets = [{ name: "Units", title: "Unit schedule", note: "Saleable to Cap. 621; GFA and exemptions as in 3 · Units", head: ["Unit", "Saleable m2", "Saleable ft2", "GFA m2", "Balcony m2", "UP m2", "A/C m2", "Exempt m2", "Internal ÷ GFA %"], widths: [36, 12, 12, 12, 12, 10, 10, 12, 14], rows }];
  try {
    const res = await fetch("/api/gbp/xlsx", { method: "POST", headers: headers(true), body: JSON.stringify({ name: "Unit schedule", sheets }) });
    if (!res.ok) { let m = "HTTP " + res.status; try { m = (await res.json()).detail || m; } catch (e) {} throw new Error(m); }
    const blob = await res.blob(), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "Unit schedule.xlsx"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast("Saved the unit schedule (Excel)");
  } catch (e) { toast("No Excel: " + e.message, true); }
}

/* the walls as built (their rects, lines and offsets): for the plan and for the panel's clear sizes */
function wallRects(u, f) {
  const wall = +(u.wall ?? 0.15), pt = +(u.part ?? 0.075), party = +(u.party ?? 0.15);
  const tOf = (e) => (e.t != null ? e.t : e.kind === "ext" ? (U.FACADES[e.facade] && U.FACADES[e.facade].t != null ? U.FACADES[e.facade].t : wall) : e.kind === "party" ? party : pt);
  const OPS = [];
  for (const w of u.windows || []) { const r = u.rooms.find((q) => q.id === w.room); if (r) { const [a, b] = sideSeg(r, w.side, +w.at || 0, +w.w || 1); OPS.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] }); } }
  for (const d of u.doors || []) { const r = u.rooms.find((q) => q.id === d.room); if (r) { const [a, b] = sideSeg(r, d.side, +d.at || 0, +d.w || 0.8); OPS.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] }); } }
  return wallGeom(u, f.edges, { tOf, isOpen: (e) => U.isOpen(u, e), solid: (e) => U.solidPart(u, e), openings: OPS });
}
/* a figure typed: the wall line moves by D (to the mm), the rooms on it with it (as a drag); refused when a room would be
   under 0.5 m inside its walls */
function typedMove(u, axis, at, D, seed) {
  if (Math.abs(D) < 2.5e-4) return false;
  const v = U.moveLine(u, axis, at, D, null, null, seed, true), cl = clearAll(v);
  if (cl.boxes.some((c) => c.x1 - c.x0 < 0.5 - 1e-6 || c.y1 - c.y0 < 0.5 - 1e-6)) { toast("A room is 0.5 m inside its walls at least", true); return false; }
  const st0 = store(); st0.list[st0.sel] = v; changed(); return true;
}
/* a number typed over a dimension on the plan (Enter: apply, Esc or away: cancel) */
function dimInput(el, value, apply) {
  const host = $("#st-uplan"), hb = host.getBoundingClientRect(), b = el.getBoundingClientRect();
  const old = host.querySelector(".un-dimin"); if (old) old.remove();
  const inp = document.createElement("input");
  inp.type = "number"; inp.step = stepL(); inp.className = "un-dimin"; inp.value = value; inp.title = "In " + uL();
  inp.style.left = (b.left + b.width / 2 - hb.left - 36) + "px"; inp.style.top = (b.top + b.height / 2 - hb.top - 12) + "px";
  host.appendChild(inp); inp.focus(); inp.select();
  let done = false;
  const close = () => { if (done) return; done = true; inp.remove(); };
  inp.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Escape") { ev.preventDefault(); close(); }
    else if (ev.key === "Enter") { ev.preventDefault(); const x = pL(inp.value); close(); if (isFinite(x)) apply(Math.round(x * 2000) / 2000); }
  });
  inp.addEventListener("blur", close);
  inp.addEventListener("pointerdown", (ev) => ev.stopPropagation());
}
/* a dimension clicked: a temporary one of the selected wall ("b" the room before it, "a" after) or a chain's room piece */
function onDimClick(el) {
  const u0 = cur(); if (!u0 || !C.can()) return;
  const u = ensure(u0), f = U.figures(u), rects = wallRects(u, f).rects;
  if (el.dataset.td) {
    const [side, rid] = el.dataset.td.split(":"), e = SEL && SEL.t === "wall" && f.edges.find((q) => q.key === SEL.key), r = u.rooms.find((q) => q.id === rid);
    if (!e || !r) return;
    const v = e.x1 === e.x2, c = clearBox(r, rects), now = v ? RP(c.x1) - RP(c.x0) : RP(c.y1) - RP(c.y0);
    dimInput(el, iL(now), (x) => { const D = x - now; typedMove(u, v ? "x" : "y", v ? e.x1 : e.y1, side === "b" ? D : -D, [e.a, e.b].filter(Boolean)); });
    return;
  }
  if (el.dataset.cd) {
    const [rid, k] = el.dataset.cd.split(":"), r = u.rooms.find((q) => q.id === rid); if (!r) return;
    const c = clearBox(r, rects), now = k === "w" ? RP(c.x1) - RP(c.x0) : RP(c.y1) - RP(c.y0);
    // on the unit's outline: the whole straight wall (the façade stays straight); inside: that piece of partition
    const at = k === "w" ? r.x + r.w : r.y + r.h, outer = Math.abs(at - (k === "w" ? f.box[2] : f.box[3])) < 0.01;
    dimInput(el, iL(now), (x) => typedMove(u, k === "w" ? "x" : "y", at, x - now, outer ? null : [r.id]));
  }
}
/* each room's clear box, and the unit's inside corner (the least clear x and y): what the panel shows */
function clearAll(u) {
  const f = U.figures(u), rects = wallRects(u, f).rects, boxes = u.rooms.map((r) => clearBox(r, rects));
  return { boxes, x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)) };
}
/* a room inside its walls (as built, the walls' rects): its clear box {x0, y0, x1, y1}; a side with no wall (open) stays
   on its line. Probed at a quarter, the middle and three quarters along each side (a door cuts the wall at one) */
let GEOR = [];
function clearBox(r, rects) {
  const e = 1e-6, fr = [0.25, 0.5, 0.75], R = rects || [];
  let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
  for (const k of fr) {
    const px = r.x + r.w * k, py = r.y + r.h * k;
    for (const q of R) {
      if (q.x0 <= px + e && q.x1 >= px - e) {
        if (q.y0 <= r.y + e && q.y1 >= r.y - e && q.y1 < r.y + r.h / 2) y0 = Math.max(y0, q.y1);
        if (q.y0 <= r.y + r.h + e && q.y1 >= r.y + r.h - e && q.y0 > r.y + r.h / 2) y1 = Math.min(y1, q.y0);
      }
      if (q.y0 <= py + e && q.y1 >= py - e) {
        if (q.x0 <= r.x + e && q.x1 >= r.x - e && q.x1 < r.x + r.w / 2) x0 = Math.max(x0, q.x1);
        if (q.x0 <= r.x + r.w + e && q.x1 >= r.x + r.w - e && q.x0 > r.x + r.w / 2) x1 = Math.min(x1, q.x0);
      }
    }
  }
  // a side no probe found a wall on (a door across most of it): the wall pieces anywhere along it, away from its corners
  const m = 0.2, along = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > 0.01;
  if (y0 === r.y) for (const q of R) if (along(q.x0, q.x1, r.x + m, r.x + r.w - m) && q.y0 <= r.y + e && q.y1 >= r.y - e && q.y1 < r.y + r.h / 2) y0 = Math.max(y0, q.y1);
  if (y1 === r.y + r.h) for (const q of R) if (along(q.x0, q.x1, r.x + m, r.x + r.w - m) && q.y0 <= r.y + r.h + e && q.y1 >= r.y + r.h - e && q.y0 > r.y + r.h / 2) y1 = Math.min(y1, q.y0);
  if (x0 === r.x) for (const q of R) if (along(q.y0, q.y1, r.y + m, r.y + r.h - m) && q.x0 <= r.x + e && q.x1 >= r.x - e && q.x1 < r.x + r.w / 2) x0 = Math.max(x0, q.x1);
  if (x1 === r.x + r.w) for (const q of R) if (along(q.y0, q.y1, r.y + m, r.y + r.h - m) && q.x0 <= r.x + r.w + e && q.x1 >= r.x + r.w - e && q.x0 > r.x + r.w / 2) x1 = Math.min(x1, q.x0);
  // still open (no wall on it: open to the next room): to the far face of the wall that carries its line on beyond the
  // room (the kitchen open to the living room ends where the living room starts, under the bath's partition)
  const carry = (line, horiz, lo, hi) => {
    let best = null;
    for (const q of R) {
      const th = horiz ? q.y1 - q.y0 : q.x1 - q.x0, a0 = horiz ? q.x0 : q.y0, a1 = horiz ? q.x1 : q.y1, b0 = horiz ? q.y0 : q.x0, b1 = horiz ? q.y1 : q.x1;
      // a wall that ends in the room's corner (by up to half a wall) still carries the line on; one across the room does not
      if (th > 0.4 || b0 > line + e || b1 < line - e || Math.min(a1, hi) - Math.max(a0, lo) > 0.2) continue;
      const d = Math.max(0, a1 <= (lo + hi) / 2 ? lo - a1 : a0 - hi);
      if (d <= 0.6 && (!best || d < best.d)) best = { d, b0, b1 };
    }
    return best;
  };
  if (y0 === r.y) { const c = carry(r.y, true, r.x, r.x + r.w); if (c) y0 = c.b0; }
  if (y1 === r.y + r.h) { const c = carry(r.y + r.h, true, r.x, r.x + r.w); if (c) y1 = c.b1; }
  if (x0 === r.x) { const c = carry(r.x, false, r.y, r.y + r.h); if (c) x0 = c.b0; }
  if (x1 === r.x + r.w) { const c = carry(r.x + r.w, false, r.y, r.y + r.h); if (c) x1 = c.b1; }
  return { x0, y0, x1, y1 };
}
/* the dimension chains: a tick at every wall line along each side, the room spans between, the overall outside */
function dims(u, f, sx, sy) {
  const mode = DIMS(); if (mode === "off") return "";
  const [x0, y0, x1, y1] = f.box, R = u.rooms, e = 0.01;
  const ex = U.expandBays(u.extras || []);
  const ox0 = Math.min(x0, ...ex.map((q) => q.x)), ox1 = Math.max(x1, ...ex.map((q) => q.x + q.w)), oy0 = Math.min(y0, ...ex.map((q) => q.y)), oy1 = Math.max(y1, ...ex.map((q) => q.y + q.h));
  let g = "";
  const DO = Math.max(14, Math.min(26, SC * 0.45)), dfs = Math.max(8, Math.min(10, SC * 0.22));
  const tick = (X, Y, v) => (v ? `<line x1="${X - 4}" y1="${Y + 4}" x2="${X + 4}" y2="${Y - 4}" stroke="#333" />` : `<line x1="${X - 4}" y1="${Y + 4}" x2="${X + 4}" y2="${Y - 4}" stroke="#333" />`);
  // the ticks at the faces' places to the mm: each piece is the difference of two of them, so the pieces add up to the overall
  const uniq = (vals) => { const v = vals.filter((q) => isFinite(q)).map(RP).sort((a, b) => a - b), out = []; for (const q of v) if (!out.length || q - out[out.length - 1] > 5e-4) out.push(q); return out; };
  // a piece that is a room's clear width / depth (pieces: [{a, b, cd}]) is clickable: type a figure to move its wall
  const cdOf = (pieces, a, b) => { const p = (pieces || []).find((q) => Math.abs(RP(q.a) - a) < 6e-4 && Math.abs(RP(q.b) - b) < 6e-4); return p ? ` data-cd="${esc(p.cd)}" class="un-cd"` : ""; };
  const tw = (t) => t.length * dfs * 0.6 + 4;
  // a piece too narrow for its figure: the figure outside the chain (away from the plan), near and far by turns, with a short leader
  const CH = (window.__unChains = []);   // for the tests: each chain's figures
  const chainH = (vals, Y, pieces, out = -1) => {
    const v = uniq(vals); if (v.length < 2) return;
    CH.push({ dir: "h", Y, figs: v.slice(1).map((q, i) => fL(q - v[i])) });
    g += `<line x1="${sx(v[0])}" y1="${Y}" x2="${sx(v[v.length - 1])}" y2="${Y}" stroke="#333" stroke-width="0.8" />`;
    let k = 0;
    v.forEach((q, i) => {
      g += tick(sx(q), Y, true); if (!i) return;
      const t = fL(q - v[i - 1]), X = (sx(q) + sx(v[i - 1])) / 2, fits = (q - v[i - 1]) * SC > tw(t);
      if (fits) { g += `<text x="${X}" y="${Y - 3}" text-anchor="middle" font-size="${dfs}"${cdOf(pieces, v[i - 1], q)}>${t}</text>`; return; }
      const dy = out * (dfs + 3) * (k++ % 2 ? 1.9 : 1), ty = Y + dy + (dy > 0 ? dfs * 0.8 : -2);
      g += `<line x1="${X}" y1="${Y}" x2="${X}" y2="${Y + dy * 0.6}" stroke="#666" stroke-width="0.5" /><text x="${X}" y="${ty}" text-anchor="middle" font-size="${dfs * 0.9}" fill="#444"${cdOf(pieces, v[i - 1], q)}>${t}</text>`;
    });
  };
  const chainV = (vals, X, pieces, out = -1) => {
    const v = uniq(vals); if (v.length < 2) return;
    CH.push({ dir: "v", X, figs: v.slice(1).map((q, i) => fL(q - v[i])) });
    g += `<line x1="${X}" y1="${sy(v[0])}" x2="${X}" y2="${sy(v[v.length - 1])}" stroke="#333" stroke-width="0.8" />`;
    let k = 0;
    v.forEach((q, i) => {
      g += tick(X, sy(q), false); if (!i) return;
      const t = fL(q - v[i - 1]), Y = (sy(q) + sy(v[i - 1])) / 2, fits = (q - v[i - 1]) * SC > tw(t);
      if (fits) { g += `<text x="${X - 4}" y="${Y}" text-anchor="middle" font-size="${dfs}" transform="rotate(-90 ${X - 4} ${Y})"${cdOf(pieces, v[i - 1], q)}>${t}</text>`; return; }
      const dx = out * (dfs + 3) * (k++ % 2 ? 1.9 : 1), tx = X + dx + (dx > 0 ? dfs * 0.8 : -2);
      g += `<line x1="${X}" y1="${Y}" x2="${X + dx * 0.6}" y2="${Y}" stroke="#666" stroke-width="0.5" /><text x="${tx}" y="${Y}" text-anchor="middle" font-size="${dfs * 0.9}" fill="#444" transform="rotate(-90 ${tx} ${Y})"${cdOf(pieces, v[i - 1], q)}>${t}</text>`;
    });
  };
  const top = sy(oy0) - DO, bot = sy(oy1) + DO, lef = sx(ox0) - DO, rig = sx(ox1) + DO;
  // the walls' outer faces (the overall), from the walls as built
  const WR = GEOR || [], ofx0 = Math.min(x0, ...WR.map((q) => q.x0)), ofx1 = Math.max(x1, ...WR.map((q) => q.x1)), ofy0 = Math.min(y0, ...WR.map((q) => q.y0)), ofy1 = Math.max(y1, ...WR.map((q) => q.y1));
  if (mode === "chains") {
    // inside each room (its clear width) and the walls between, to the outer faces: as the sales brochures
    const C = (r) => clearBox(r, WR);
    const side = (rs, k) => { const ps = rs.map((r) => { const c = C(r); return k === "w" ? { a: c.x0, b: c.x1, cd: r.id + ":w" } : { a: c.y0, b: c.y1, cd: r.id + ":h" }; }); return { vals: ps.flatMap((p) => [p.a, p.b]), ps }; };
    const T = side(R.filter((r) => Math.abs(r.y - y0) < e), "w"), B = side(R.filter((r) => Math.abs(r.y + r.h - y1) < e), "w");
    const Lf = side(R.filter((r) => Math.abs(r.x - x0) < e), "h"), Rt = side(R.filter((r) => Math.abs(r.x + r.w - x1) < e), "h");
    chainH([ofx0, ofx1, ...T.vals], top, T.ps, -1); chainH([ofx0, ofx1, ...B.vals], bot, B.ps, 1);
    chainV([ofy0, ofy1, ...Lf.vals], lef, Lf.ps, -1); chainV([ofy0, ofy1, ...Rt.vals], rig, Rt.ps, 1);
  } else if (mode === "centre") {
    chainH(R.filter((r) => Math.abs(r.y - y0) < e).flatMap((r) => [r.x, r.x + r.w]), top);
    chainH(R.filter((r) => Math.abs(r.y + r.h - y1) < e).flatMap((r) => [r.x, r.x + r.w]), bot);
    chainV(R.filter((r) => Math.abs(r.x - x0) < e).flatMap((r) => [r.y, r.y + r.h]), lef);
    chainV(R.filter((r) => Math.abs(r.x + r.w - x1) < e).flatMap((r) => [r.y, r.y + r.h]), rig);
  }
  // overall: to the walls' outer faces (to the centre lines with the centre-line chains)
  if (mode === "centre") { chainH([x0, x1], top - DO * 0.85); chainV([y0, y1], rig + DO * 0.85); }
  else { chainH([ofx0, ofx1], top - DO * 0.85); chainV([ofy0, ofy1], rig + DO * 0.85); }
  return g;
}

/* a fitting or a piece of furniture as on the office's plans: drawn at rotation 0 in its own box, then turned */
/* a fitting or a piece of furniture for another plan (Floors): sx / sy its plan to screen, k its pixels a metre, faint */
export function fixtureSvg(x, sx, sy, k) { return `<g pointer-events="none" opacity="0.55">${fixture(x, sx, sy, false, -1, k).replace(/ class="un-fix"| class="un-fhit"| data-fi="-1"/g, "")}</g>`; }
function fixture(x, sx, sy, sel, i, k0) {
  const SC_ = k0 || SC;
  const rot = ((+x.rot || 0) % 360 + 360) % 360, q = rot === 90 || rot === 270;
  const W = (q ? x.h : x.w) * SC_, H = (q ? x.w : x.h) * SC_, cx = sx(x.x + x.w / 2), cy = sy(x.y + x.h / 2);
  const st = sel ? "#f28022" : "#2a2f35", sw = sel ? 1.6 : 0.6, th = 0.45;
  const R = (a, b, c, d, extra = "") => `<rect x="${a}" y="${b}" width="${Math.max(0, c)}" height="${Math.max(0, d)}" fill="#fff" stroke="${st}" stroke-width="${sw}"${extra} />`;
  const Ln = (a, b, c, d, w = th, dash = "") => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="${st}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ""} />`;
  const Ci = (a, b, r, w = th) => `<circle cx="${a}" cy="${b}" r="${Math.max(0.5, r)}" fill="none" stroke="${st}" stroke-width="${w}" />`;
  const m = Math.min(W, H);
  let d = "";
  switch (DRAWAS[x.kind] || x.kind) {
    case "tv": d = R(0, 0, W, H) + Ln(W * 0.2, H * 0.35, W * 0.8, H * 0.35, th * 1.6) + `<text x="${W / 2}" y="${H * 0.85}" text-anchor="middle" font-size="${Math.max(4, Math.min(W, H) * 0.4)}" fill="${st}">TV</text>`; break;
    case "shoe": d = R(0, 0, W, H) + Ln(0, 0, W, H) + Ln(W, 0, 0, H); break;
    case "bath": d = R(0, 0, W, H) + `<rect x="${W * 0.06}" y="${H * 0.1}" width="${W * 0.88}" height="${H * 0.8}" rx="${m * 0.3}" fill="none" stroke="${st}" stroke-width="${th}" />` + Ci(W * 0.85, H / 2, m * 0.05); break;
    case "shower": d = R(0, 0, W, H) + Ln(0, 0, W, H) + Ln(W, 0, 0, H) + Ci(W / 2, H / 2, m * 0.07) + Ci(W / 2, H / 2, m * 0.03); break;
    case "wc": {
      // a close-coupled WC: the cistern with its lid and push button against the wall, the pan narrowing to it, the seat and its opening
      const P = (x, y) => `${(W * x).toFixed(2)} ${(H * y).toFixed(2)}`;
      d = `<rect x="${W * 0.06}" y="0" width="${W * 0.88}" height="${H * 0.24}" rx="${m * 0.04}" fill="#fff" stroke="${st}" stroke-width="${sw}" />` +
        `<rect x="${W * 0.12}" y="${H * 0.035}" width="${W * 0.76}" height="${H * 0.17}" rx="${m * 0.03}" fill="none" stroke="${st}" stroke-width="${th * 0.8}" />` + Ci(W / 2, H * 0.12, m * 0.05, th * 0.8) +
        `<path d="M ${P(0.3, 0.24)} C ${P(0.16, 0.3)} ${P(0.1, 0.46)} ${P(0.1, 0.62)} C ${P(0.1, 0.85)} ${P(0.28, 0.99)} ${P(0.5, 0.99)} C ${P(0.72, 0.99)} ${P(0.9, 0.85)} ${P(0.9, 0.62)} C ${P(0.9, 0.46)} ${P(0.84, 0.3)} ${P(0.7, 0.24)} Z" fill="#fff" stroke="${st}" stroke-width="${sw}" />` +
        `<path d="M ${P(0.5, 0.36)} C ${P(0.29, 0.36)} ${P(0.21, 0.5)} ${P(0.21, 0.64)} C ${P(0.21, 0.8)} ${P(0.34, 0.9)} ${P(0.5, 0.9)} C ${P(0.66, 0.9)} ${P(0.79, 0.8)} ${P(0.79, 0.64)} C ${P(0.79, 0.5)} ${P(0.71, 0.36)} ${P(0.5, 0.36)} Z" fill="none" stroke="${st}" stroke-width="${th}" />` +
        Ln(W * 0.3, H * 0.3, W * 0.7, H * 0.3, th * 0.8);
      break;
    }
    case "basin": d = R(0, 0, W, H) + `<ellipse cx="${W / 2}" cy="${H * 0.55}" rx="${W * 0.34}" ry="${H * 0.32}" fill="none" stroke="${st}" stroke-width="${th}" />` + Ci(W / 2, H * 0.14, m * 0.05); break;
    case "counter": {
      // a kitchen counter: its front line dashed (the wall cabinets above), a sink and a two-ring hob
      const L = W >= H, sw2 = L ? Math.min(W * 0.32, 0.55 * SC_) : W * 0.7, sh2 = L ? H * 0.7 : Math.min(H * 0.32, 0.55 * SC_);
      d = R(0, 0, W, H) + (L ? Ln(0, H * 0.9, W, H * 0.9, th, "4 2") : Ln(W * 0.9, 0, W * 0.9, H, th, "4 2"));
      const sxx = L ? W * 0.12 : (W - sw2) / 2, syy = L ? (H - sh2) / 2 : H * 0.12;
      d += `<rect x="${sxx}" y="${syy}" width="${sw2}" height="${sh2}" rx="3" fill="#fff" stroke="${st}" stroke-width="${th}" />` + Ci(sxx + sw2 / 2, syy + sh2 / 2, m * 0.06);
      const hx = L ? W * 0.72 : W / 2, hy = L ? H / 2 : H * 0.72, r1 = m * 0.17;
      d += L ? Ci(hx - r1 * 1.15, hy, r1) + Ci(hx + r1 * 1.15, hy, r1 * 0.8) : Ci(hx, hy - r1 * 1.15, r1) + Ci(hx, hy + r1 * 1.15, r1 * 0.8);
      break;
    }
    case "sink": d = R(0, 0, W, H) + `<rect x="${W * 0.1}" y="${H * 0.15}" width="${W * 0.8}" height="${H * 0.7}" rx="3" fill="none" stroke="${st}" stroke-width="${th}" />` + Ci(W / 2, H / 2, m * 0.07) + Ln(W / 2, 0, W / 2, H * 0.15); break;
    case "hob": d = R(0, 0, W, H) + Ci(W * 0.3, H / 2, m * 0.25) + Ci(W * 0.3, H / 2, m * 0.12) + Ci(W * 0.72, H / 2, m * 0.2) + Ci(W * 0.72, H / 2, m * 0.09); break;
    case "fridge": d = R(0, 0, W, H) + Ln(0, H * 0.12, W, H * 0.12) + `<text x="${W / 2}" y="${H * 0.62}" text-anchor="middle" font-size="${Math.max(5, m * 0.28)}" fill="${st}">REF</text>`; break;
    case "wm": d = R(0, 0, W, H) + Ci(W / 2, H / 2, m * 0.34) + Ci(W / 2, H / 2, m * 0.2) + `<text x="${W / 2}" y="${H * 0.95}" text-anchor="middle" font-size="${Math.max(4, m * 0.14)}" fill="${st}">W/M</text>`; break;
    case "wardrobe": {
      d = `<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="${st}" stroke-width="${sw}" />` + Ln(0, H / 2, W, H / 2, th, "3 2");
      const n2 = Math.max(2, Math.round(W / (0.12 * SC_)));
      for (let k = 1; k < n2; k++) d += Ln(W * k / n2, H * 0.2, W * k / n2, H * 0.8, 0.35);
      break;
    }
    case "bed": {
      // a bed, its head at the top: pillows (two on a double), the cover folded back at one corner
      const dbl = W > 1.2 * SC_;
      d = R(0, 0, W, H) + (dbl ? R(W * 0.06, H * 0.04, W * 0.4, H * 0.14) + R(W * 0.54, H * 0.04, W * 0.4, H * 0.14) : R(W * 0.12, H * 0.04, W * 0.76, H * 0.14));
      d += Ln(0, H * 0.22, W, H * 0.22) + `<path d="M ${W * 0.55} ${H * 0.22} L ${W} ${H * 0.22} L ${W} ${H * 0.5} Z" fill="#fff" stroke="${st}" stroke-width="${th}" />` + Ln(W * 0.55, H * 0.22, W, H * 0.5);
      break;
    }
    case "sofa": d = R(0, 0, W, H) + R(0, 0, W, H * 0.25) + R(0, H * 0.25, W * 0.1, H * 0.75) + R(W * 0.9, H * 0.25, W * 0.1, H * 0.75) + Ln(W / 2, H * 0.25, W / 2, H); break;
    case "dining": {
      // the chairs evenly along each long side, each in the middle of its share: 2 a side (dining for 4), 3 (for 6)
      const n = x.kind === "dining6" ? 3 : 2, slot = W / n, cw = Math.min(slot * 0.85, 0.45 * SC_), ch = Math.min(H * 0.32, 0.42 * SC_);
      for (let k = 0; k < n; k++) { const cx0 = slot * (k + 0.5) - cw / 2; d += R(cx0, -ch * 0.75, cw, ch) + R(cx0, H - ch * 0.25, cw, ch); }
      d += R(0, 0, W, H);
      break;
    }
    case "desk": d = R(0, 0, W, H) + `<rect x="${W * 0.35}" y="${H * 0.75}" width="${W * 0.3}" height="${H * 0.5}" rx="3" fill="#fff" stroke="${st}" stroke-width="${th}" />`; break;
    default: d = R(0, 0, W, H);
  }
  return `<g class="un-fix" data-fi="${i}" transform="translate(${cx} ${cy}) rotate(${rot}) translate(${-W / 2} ${-H / 2})">${d}<rect class="un-fhit" data-fi="${i}" x="0" y="0" width="${W}" height="${H}" fill="transparent" /></g>`;
}

function toolbar() {
  if (!C.can()) return "";
  const b = (t, l, ti) => `<button type="button" data-tool="${t}" class="${TOOL === t ? "on" : ""}" title="${ti}">${l}</button>`;
  return `<div class="un-bar">${b("select", "↖ Select", "Click a wall, door, window, fitting, balcony or UP; drag a wall (Alt: the whole aligned line)")}${b("door", "+ Door", "Click a wall where the door goes")}${b("window", "+ Window", "Click an external wall")}${b("split-x", "✂ Split │", "Click a room: a new wall up and down at that point")}${b("split-y", "✂ Split ─", "Click a room: a new wall across at that point")}${b("room", "▭ + Room", "Drag a rectangle beside the rooms: a new room (snaps to the walls, 50 mm grid)")}
    <select data-roomk title="The kind of the room you draw">${Object.entries(U.KINDS).map(([k, q]) => `<option value="${k}"${ROOMK === k ? " selected" : ""}>${q.label}</option>`).join("")}</select>
    <select data-xadd title="Then click an external wall: it goes outside it"><option value="">+ Balcony / UP …</option>${Object.entries(XADD).map(([k, v]) => `<option value="${k}"${TOOL === "x:" + k ? " selected" : ""}>${v.label}</option>`).join("")}</select>
    <select data-fixadd data-pick="fix" title="Click a room to place it"><option value="">+ Fitting / furniture …</option>${fixOpts(TOOL.startsWith("fix:") ? TOOL.slice(4) : "")}</select>
    <select data-alines title="The saleable and GFA lines, to check the figures"><option value="off"${ALINES() === "off" ? " selected" : ""}>Area lines: off</option><option value="saleable"${ALINES() === "saleable" ? " selected" : ""}>Saleable line</option><option value="gfa"${ALINES() === "gfa" ? " selected" : ""}>GFA line</option><option value="both"${ALINES() === "both" ? " selected" : ""}>Saleable + GFA</option></select>
    <select data-dims title="Dimensions"><option value="chains"${DIMS() === "chains" ? " selected" : ""}>Dimensions: inside rooms</option><option value="centre"${DIMS() === "centre" ? " selected" : ""}>wall centres</option><option value="overall"${DIMS() === "overall" ? " selected" : ""}>overall</option><option value="off"${DIMS() === "off" ? " selected" : ""}>off</option></select></div>`;
}

/* a sliding door in the wall from a to b (t thick, its middle o off the line): a frame at each jamb, the leaves
   on two tracks overlapping, no swing; 2 leaves meet in the middle, 1 leaf slides along the wall; svg */
export function slideSvg(a, b, t, o, vert, st, d, sel, sx, sy) {
  const al = vert ? [0, 1] : [1, 0], nm = vert ? [1, 0] : [0, 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const P = (s2, nn) => [a[0] + al[0] * s2 + nm[0] * (o + nn), a[1] + al[1] * s2 + nm[1] * (o + nn)];
  const rect = (s0, s1, n0, n1, fill) => { const q = [P(s0, n0), P(s1, n0), P(s1, n1), P(s0, n1)]; return `<polygon points="${q.map((p) => sx(p[0]) + "," + sy(p[1])).join(" ")}" fill="${fill}" stroke="${st}" stroke-width="${sel ? 1.2 : 0.6}" />`; };
  const fw = 0.05, lt = Math.min(0.04, t / 4), gap = Math.min(0.01, t / 10), flip = d.hinge === "end";
  let g = rect(0, fw, -t / 2, t / 2, "#fff") + rect(L - fw, L, -t / 2, t / 2, "#fff");
  const a0 = fw, a1 = L - fw, ov = 0.05;
  if (d.type === "sliding2") {
    const m = (a0 + a1) / 2;
    g += rect(a0, m + ov, -lt - gap / 2, -gap / 2, "#fff") + rect(m - ov, a1, gap / 2, lt + gap / 2, "#fff");
  } else {
    // one leaf on the outer track, the fixed panel behind it; flip: from the other jamb
    const m = (a0 + a1) / 2;
    g += flip ? rect(m - ov, a1, -lt - gap / 2, -gap / 2, "#fff") + rect(a0, m + ov, gap / 2, lt + gap / 2, "#eef4fa") : rect(a0, m + ov, -lt - gap / 2, -gap / 2, "#fff") + rect(m - ov, a1, gap / 2, lt + gap / 2, "#eef4fa");
  }
  // the arrows: which way each leaf slides
  const ar = (s0, s1, nn) => { const p0 = P(s0, nn), p1 = P(s1, nn); return `<line x1="${sx(p0[0])}" y1="${sy(p0[1])}" x2="${sx(p1[0])}" y2="${sy(p1[1])}" stroke="${st}" stroke-width="0.5" marker-end="url(#un-ar)" />`; };
  const off = t / 2 + 0.12, mm = (a0 + a1) / 2, q = (a1 - a0) / 4;
  g += d.type === "sliding2" ? ar(mm - 0.05, mm - q, -off) + ar(mm + 0.05, mm + q, off) : flip ? ar(mm + q, mm - q, -off) : ar(mm - q, mm + q, -off);
  return g;
}

/* the small menu by what is selected */
function popup(u, f, sx, sy, bw = 9999, bh = 9999) {
  if (!SEL || !C.can()) return "";
  let at = null, html = "";
  if (SEL.t === "wall") {
    const e = f.edges.find((q) => q.key === SEL.key); if (!e) return "";
    at = [sx((e.x1 + e.x2) / 2), sy((e.y1 + e.y2) / 2)];
    const o = u.walls[e.key] || {}, open = U.isOpen(u, e), def = e.kind === "ext" ? u.wall : e.kind === "party" ? u.party : u.part;
    html = `<b>${e.kind === "ext" ? "External wall" : e.kind === "party" ? "Party wall" : "Partition"}</b> ${fL(e.len)} ${uL()}
      ${e.kind === "part" ? `<button type="button" data-pw="toggle">${open ? "Put the wall back" : "Delete wall"}</button><button type="button" data-pw="join">Join the rooms</button><button type="button" data-pw="space">${(() => { const A = u.rooms.find((q) => q.id === e.a), B = u.rooms.find((q) => q.id === e.b); return A && B && U.spaceOf(A) === U.spaceOf(B) ? "Separate the spaces" : "One space (L-shaped)"; })()}</button>
        ${open ? "" : `<label>solid from <input type="number" step="${stepL()}" min="0" data-pws value="${iL(U.solidPart(u, e)[0])}"> to <input type="number" step="${stepL()}" min="0" data-pwe value="${iL(U.solidPart(u, e)[1])}"> ${uL()}</label>${o.s != null || o.e != null ? `<button type="button" data-pw="full">Full length</button>` : ""}<small>or drag its ends</small>`}
        ${open ? "" : `<label>line <select data-pwa><option value=""${!o.align ? " selected" : ""}>${u.join === "centre" ? "centre (unit setting)" : "flush (unit setting)"}</option><option value="c"${o.align === "c" ? " selected" : ""}>centre to centre</option><option value="flip"${o.align === "flip" ? " selected" : ""}>flush, the other face</option></select></label>`}` : ""}
      ${e.kind !== "part" ? `<span class="un-seg"><button type="button" data-pw="kind-ext"${e.kind === "ext" ? ' class="on"' : ""}>External</button><button type="button" data-pw="kind-party"${e.kind === "party" ? ' class="on"' : ""}>Party</button></span>${o.kind ? `<small>this wall only</small>` : ""}` : ""}
      ${e.kind === "ext" ? `<label>façade <select data-pwf>${Object.entries(U.FACADES).map(([k, q]) => `<option value="${k}"${(o.f || u.facadeType || "rc") === k ? " selected" : ""}>${q.label}</option>`).join("")}</select></label>` : ""}
      <label>thickness <input type="number" step="${stepL()}" min="0" data-pwt value="${o.t != null ? iL(o.t) : ""}" placeholder="${iL(e.kind === "ext" && U.FACADES[o.f || u.facadeType || "rc"].t != null ? U.FACADES[o.f || u.facadeType || "rc"].t : def)}"> ${uL()}</label>
      <button type="button" data-pw="door">+ Door here</button>${e.kind !== "part" ? `<button type="button" data-pw="win">+ Window here</button>` : ""}`;
  } else if (SEL.t === "door") {
    const d = u.doors[SEL.i], r = d && u.rooms.find((q) => q.id === d.room); if (!r) return "";
    const [a, b] = sideSeg(r, d.side, +d.at || 0, +d.w || 0.8); at = [sx((a[0] + b[0]) / 2), sy((a[1] + b[1]) / 2)];
    const dt = d.type || "hinged";
    html = `<b>Door</b> <label>type <select data-pdt>${[["hinged", "Hinged"], ["door2", "French (double)"], ["sliding", "Sliding, 1 leaf"], ["sliding2", "Sliding, 2 leaves"], ["opening", "Opening (no leaf)"], ["panel", "Access panel"]].map(([k, l]) => `<option value="${k}"${dt === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>${dt === "hinged" || dt === "door2" ? `<button type="button" data-pd="hinge">⇋ Flip hinge</button><button type="button" data-pd="swing">${d.swing === "out" ? "Swing in" : "Swing out"}</button>` : dt === "opening" ? "" : `<button type="button" data-pd="hinge">⇋ Flip leaves</button>`}<label>w <input type="number" step="${stepL()}" data-pdw value="${iL(d.w)}"> ${uL()}</label><button type="button" data-pd="pushs" title="Its start against the wall it is nearest (its face)">⇤ Push to the wall</button><button type="button" data-pd="pushe" title="Its end against the wall it is nearest (its face)">Push to the wall ⇥</button><label title="How far a pushed door stands off the wall's face">nib <select data-pdnib>${[0, 0.1].map((v) => `<option value="${v}"${+(u.doorNib || 0) === v ? " selected" : ""}>${v * 1000} mm</option>`).join("")}</select></label><button type="button" data-pd="del">Remove</button><small>drag it along the wall: it stops at the walls' faces (Alt: free)</small>`;
  } else if (SEL.t === "win") {
    const w = u.windows[SEL.i], r = w && u.rooms.find((q) => q.id === w.room); if (!r) return "";
    const [a, b] = sideSeg(r, w.side, +w.at || 0, +w.w || 1); at = [sx((a[0] + b[0]) / 2), sy((a[1] + b[1]) / 2)];
    html = `<b>Window</b> <label>w <input type="number" step="${stepL()}" data-pww value="${iL(w.w)}"> ${uL()}</label><button type="button" data-pwin="del">Remove</button><small>drag it along the wall</small>`;
  } else if (SEL.t === "z") {
    const z = (u.zones || [])[SEL.i]; if (!z) return "";
    at = [sx(z.x + z.w), sy(z.y)];
    html = `<b>${esc((U.KINDS[z.kind] || {}).label || z.kind)}</b> <label><input type="number" step="${stepL()}" data-pzw value="${iL(z.w)}"> × <input type="number" step="${stepL()}" data-pzh value="${iL(z.h)}"> ${uL()}</label><button type="button" data-pz2="del">Remove</button><small>a zone in the room: drag it, or its corners - no wall moves</small>`;
  } else if (SEL.t === "x") {
    const e = (u.extras || [])[SEL.i]; if (!e) return "";
    at = [sx(e.x + e.w), sy(e.y)];
    const nm = e.kind === "bay" ? "Balcony / UP / A/C bay" : (U.EXTRAS[e.kind] || {}).label || e.kind;
    html = `<b>${esc(nm)}</b> <label><input type="number" step="${stepL()}" data-pxw value="${iL(e.w)}"> × <input type="number" step="${stepL()}" data-pxh value="${iL(e.h)}"> ${uL()}</label>
      ${e.kind === "bay" ? `<span class="un-parts">${e.parts.map((q, k) => `<span class="un-chip">${esc((U.EXTRAS[q.kind] || {}).ab || q.kind)} ${fL(q.len)}<button type="button" data-pxd="${k}" title="Omit this part">×</button></span>`).join("")}</span>` : ""}
      ${["bal", "up", "acp"].includes(e.kind) || e.kind === "bay" ? `<button type="button" data-pxp="bal">+ BAL</button><button type="button" data-pxp="up">+ UP</button><button type="button" data-pxp="acp">+ A/C</button>` : ""}
      ${["bal", "up", "acp", "bay"].includes(e.kind) ? `<label class="st-chk" title="Balcony 2.0, UP 1.5, A/C platform 0.8 m²: change one side, the other follows"><input type="checkbox" data-pxfree${e.free ? "" : " checked"}> keep area</label>` : ""}
      <button type="button" data-px="rot">⟳ Rotate</button><button type="button" data-px="del">Remove</button><small>drag it to move (it snaps to the walls)</small>`;
  } else if (SEL.t === "fix") {
    const x = u.fixtures[SEL.i]; if (!x) return "";
    at = [sx(x.x + x.w), sy(x.y)];
    html = `<b>${esc(FIXK[x.kind] || x.kind)}</b> <button type="button" data-pf="rot">⟳ Rotate 90°</button><label><input type="number" step="${stepL()}" data-pfw value="${iL(x.w)}"> × <input type="number" step="${stepL()}" data-pfh value="${iL(x.h)}"> ${uL()}</label><button type="button" data-pf="del">Remove</button><small>drag to move</small>`;
  }
  if (!at) return "";
  const pw = Math.min(360, bw - 16), L = Math.max(8, Math.min(at[0] + 12, bw - pw - 8)), T = Math.max(56, Math.min(at[1] + 12, bh - 150));
  return `<div class="un-pop" style="left:${Math.round(L)}px;top:${Math.round(T)}px;max-width:${pw}px">${html}</div>`;
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
  const ok = ROOMK === "OKIT" || ROOMK === "KIT" ? w >= 0.3 && h >= 0.3 : U.addRoom(cur(), { x: x0, y: y0, w, h }, ROOMK);
  g.innerHTML = `<rect x="${X}" y="${Y}" width="${w * SC}" height="${h * SC}" fill="${ok ? "rgba(242,128,34,.18)" : "rgba(200,40,40,.15)"}" stroke="${ok ? "#f28022" : "#c62828"}" stroke-width="1.5" stroke-dasharray="6 3" />
    <text x="${X + w * SC / 2}" y="${Y + h * SC / 2}" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="700" fill="#b4520a">${fL(w)} × ${fL(h)} ${uL()} · ${f2(w * h)} m²</text>`;
}

/* the unit's wall under the pointer (within tol m): {e, rs, along (m from the room's corner on that side)} */
function wallUnder(ev, tol) {
  const u = cur(); if (!u) return null;
  const b = $("#st-uplan").getBoundingClientRect();
  if (ev.clientX < b.left || ev.clientX > b.right || ev.clientY < b.top || ev.clientY > b.bottom) return null;
  const P = toPlan(ev), f = U.figures(u);
  let best = null;
  for (const e of f.edges) {
    const v = e.x1 === e.x2, d = v ? Math.abs(P[0] - e.x1) : Math.abs(P[1] - e.y1), lo = v ? Math.min(e.y1, e.y2) : Math.min(e.x1, e.x2), hi = v ? Math.max(e.y1, e.y2) : Math.max(e.x1, e.x2), s = v ? P[1] : P[0];
    if (s < lo - 0.05 || s > hi + 0.05 || d > tol || U.isOpen(u, e)) continue;
    if (!best || d < best.d) best = { e, d };
  }
  if (!best) return null;
  const rs = edgeRoomSide(best.e), r = u.rooms.find((q) => q.id === rs.room);
  return { e: best.e, rs, along: rs.side === "n" || rs.side === "s" ? P[0] - r.x : P[1] - r.y, r };
}
/* an opening of the library's (or the menu's) kind put on that wall */
function placeOpening(hit, id, w) {
  const u = cur(); if (!u || !C.can()) return;
  const { e, rs, along, r } = hit, L = rs.side === "n" || rs.side === "s" ? r.w : r.h;
  const ww = Math.min(Number(w) || 0.9, e.len - 0.1), at = +Math.max(0, Math.min(L - ww, along - ww / 2)).toFixed(2);
  if (id === "window" || id === "cw") {
    if (e.kind === "part") return toast("A window goes on an external wall", true);
    if (id === "cw") { const o = u.walls[e.key] = u.walls[e.key] || {}; o.f = "cw"; SEL = { t: "wall", key: e.key }; return changed(); }
    u.windows.push({ room: rs.room, side: rs.side, at, w: +ww.toFixed(2) }); SEL = { t: "win", i: u.windows.length - 1 }; return changed();
  }
  const type = { door: null, door2: "door2", doorU: "door2", sliding: "sliding", sliding2: "sliding2", opening: "opening", panel: "panel" }[id];
  u.doors.push(Object.assign({ room: rs.room, side: rs.side, at, w: +ww.toFixed(2), hinge: "start", swing: "in" }, type ? { type } : {}));
  SEL = { t: "door", i: u.doors.length - 1 }; return changed();
}
/* the right-click menu: on a wall, a door or window, a room, a fitting or balcony */
function onContext(ev) {
  const u0 = cur(); if (!u0 || !C.can()) return;
  ev.preventDefault();
  const u = ensure(u0), t = ev.target, f = U.figures(u), hit = wallUnder(ev, 0.4), M2 = [];
  const del = (fn) => ({ label: "Delete", key: "Del", danger: true, action: () => { fn(); SEL = null; changed(); } });
  if (t.dataset.di != null) { const i = +t.dataset.di; SEL = { t: "door", i }; drawPlan(); M2.push(...[["hinged", "Hinged door"], ["door2", "French door (double)"], ["sliding2", "Sliding door"], ["opening", "Opening"]].map(([k, l]) => ({ label: "Make it: " + l, action: () => { if (k === "hinged") delete u.doors[i].type; else u.doors[i].type = k; changed(); } })), { label: "Flip the hinge", action: () => { const dd = u.doors[i]; dd.hinge = dd.hinge === "end" ? "start" : "end"; changed(); } },
      ...["start", "end"].map((en) => ({ label: en === "start" ? "⇤ Push to the wall" : "Push to the wall ⇥", action: () => { const dd = u.doors[i], st = U.doorStops(u, dd).filter((q) => q.end === en); if (!st.length) return toast("No wall meets this side", true); const at0 = +dd.at || 0; dd.at = st.reduce((m, q) => (Math.abs(q.at - at0) < Math.abs(m.at - at0) ? q : m)).at; changed(); } })), "-", del(() => u.doors.splice(i, 1))); }
  else if (t.dataset.wi != null) { const i = +t.dataset.wi; SEL = { t: "win", i }; drawPlan(); M2.push(del(() => u.windows.splice(i, 1))); }
  else if (t.dataset.fi != null) { const i = +t.dataset.fi; SEL = { t: "fix", i }; drawPlan(); M2.push({ label: "Rotate 90°", action: () => { u.fixtures[i] = U.rotateFixture(u.fixtures[i]); changed(); } }, { label: "Copy", action: () => PT.clip.set("fixture", u.fixtures[i]) }, del(() => u.fixtures.splice(i, 1))); }
  else if (t.dataset.xi != null) { const i = +t.dataset.xi; SEL = { t: "x", i }; drawPlan(); M2.push({ label: "Rotate", action: () => { const e = u.extras[i]; [e.w, e.h] = [e.h, e.w]; changed(); } }, del(() => u.extras.splice(i, 1))); }
  else if (hit) {
    const e = hit.e; SEL = { t: "wall", key: e.key }; drawPlan();
    M2.push({ label: "Add a door here", action: () => placeOpening(hit, "door", 0.8) }, { label: "Add a sliding door here", action: () => placeOpening(hit, "sliding2", Math.min(2.0, e.len - 0.4)) }, { label: "Add a French door here (double)", action: () => placeOpening(hit, "door2", Math.min(1.5, e.len - 0.2)) }, { label: "Add an opening here", action: () => placeOpening(hit, "opening", 0.9) });
    if (e.kind !== "part") M2.push({ label: "Add a window here", action: () => placeOpening(hit, "window", 1.2) }, "-", { label: e.kind === "party" ? "Make it external" : "Make it a party wall", action: () => { const o = u.walls[e.key] = u.walls[e.key] || {}, k = e.kind === "party" ? "ext" : "party", side = (u.partySides || []).includes(e.face) ? "party" : "ext"; if (k === side) delete o.kind; else o.kind = k; changed(); } });
    else M2.push("-", { label: U.isOpen(u, e) ? "Put the wall back" : "Delete the wall", action: () => { const o = u.walls[e.key] = u.walls[e.key] || {}; o.open = !U.isOpen(u, e); changed(); } }, { label: "Join the two rooms", action: () => { const v = U.joinRooms(u, e.a, e.b); if (!v) return toast("These two rooms do not make one rectangle", true); const st0 = store(); st0.list[st0.sel] = v; SEL = null; changed(); } });
  } else if (t.dataset.rid) {
    const P = toPlan(ev), r = u.rooms.find((q) => q.id === t.dataset.rid);
    const sp = (ax) => () => { const v = U.splitRoom(u, r.id, ax, ax === "x" ? P[0] - r.x : P[1] - r.y); if (v === u) return toast("Too near the room's edge", true); const st0 = store(); st0.list[st0.sel] = v; changed(); };
    M2.push({ label: "Split │ here", action: sp("x") }, { label: "Split ─ here", action: sp("y") });
    const fc = PT.clip.get("fixture"); if (fc) M2.push({ label: "Paste the fitting here", action: () => { const q = fc.data; u.fixtures.push(Object.assign({}, q, { x: +(P[0] - q.w / 2).toFixed(2), y: +(P[1] - q.h / 2).toFixed(2) })); changed(); } });
  } else return;
  void f;
  PT.ctx(ev, M2);
}
function wirePlan() {
  const host = $("#st-uplan"), top = $("#st-ptop");
  let drag = null;
  const planChange = (ev) => {
    const t = ev.target, u = cur(); if (!u) return;
    if (t.dataset.alines != null) { try { localStorage.setItem("lwk-viewer:un-alines", t.value); } catch (e) {} return drawPlan(); }
    if (t.dataset.dims != null) { try { localStorage.setItem("lwk-viewer:un-dims", t.value); } catch (e) {} return drawPlan(); }
    if (t.dataset.ulang != null) { try { localStorage.setItem("lwk-viewer:un-lang", t.value); } catch (e) {} return drawPlan(); }
    if (t.dataset.ulen != null) { try { localStorage.setItem("lwk-viewer:un-len", t.value); } catch (e) {} render(); return drawPlan(); }
    if (t.dataset.roomk != null) { ROOMK = t.value; TOOL = "room"; return drawPlan(); }
    if (t.dataset.xadd != null) { TOOL = t.value ? "x:" + t.value : "select"; SEL = null; return drawPlan(); }
    if (t.dataset.pxw != null || t.dataset.pxh != null) { const e = u.extras[SEL.i]; const v = Math.max(0.2, Math.round((pL(t.value) || 0) * 20) / 20); if (t.dataset.pxw != null) e.w = v; else e.h = v; keepArea(e, t.dataset.pxw != null ? "w" : "h"); return changed(); }
    if (t.dataset.pxfree != null) { const e = u.extras[SEL.i]; if (t.checked) delete e.free; else e.free = true; if (!e.free) keepArea(e, e.h >= e.w ? "w" : "h"); return changed(); }
    if (t.dataset.fixadd != null) { TOOL = t.value ? "fix:" + t.value : "select"; FIXROT = 0; GHOST = null; SEL = null; return drawPlan(); }
    if (t.dataset.pwf != null) { const o = u.walls[SEL.key] = u.walls[SEL.key] || {}; o.f = t.value; if (t.value === "cw") u.windows = u.windows.filter((w) => !(w.room === SEL.key.split(":")[0] && w.side === SEL.key.split(":")[1])); return changed(); }
    if (t.dataset.pws != null || t.dataset.pwe != null) {
      const e = U.figures(u).edges.find((q) => q.key === SEL.key); if (!e) return;
      const o = u.walls[SEL.key] = u.walls[SEL.key] || {}, [a, b] = U.solidPart(u, e), v = Math.round((pL(t.value) || 0) * 20) / 20;
      if (t.dataset.pws != null) o.s = Math.max(0, Math.min(v, b - 0.1)); else o.e = Math.min(e.len, Math.max(v, a + 0.1));
      if (o.s === 0) delete o.s; if (o.e != null && Math.abs(o.e - e.len) < 1e-6) delete o.e;
      return changed();
    }
    if (t.dataset.pzw != null || t.dataset.pzh != null) { const z = u.zones[SEL.i]; const v = Math.max(0.3, Math.round((pL(t.value) || 0) * 20) / 20); if (t.dataset.pzw != null) z.w = v; else z.h = v; return changed(); }
    if (t.dataset.pwa != null) { const o = u.walls[SEL.key] = u.walls[SEL.key] || {}; if (t.value) o.align = t.value; else delete o.align; return changed(); }
    if (t.dataset.pwt != null) { const o = u.walls[SEL.key] = u.walls[SEL.key] || {}; if (t.value === "") delete o.t; else o.t = Math.max(0, pL(t.value)); return changed(); }
    if (t.dataset.pdt != null) { const dd = u.doors[SEL.i]; if (t.value === "hinged") delete dd.type; else dd.type = t.value; return changed(); }
    if (t.dataset.pdnib != null) { u.doorNib = +t.value || 0; if (!u.doorNib) delete u.doorNib; return changed(); }
    if (t.dataset.pdw != null) { u.doors[SEL.i].w = Math.max(0.5, pL(t.value) || 0.8); return changed(); }
    if (t.dataset.pww != null) { u.windows[SEL.i].w = Math.max(0.3, pL(t.value) || 1); return changed(); }
    if (t.dataset.pfw != null) { u.fixtures[SEL.i].w = Math.max(0.2, pL(t.value) || 0.5); return changed(); }
    if (t.dataset.pfh != null) { u.fixtures[SEL.i].h = Math.max(0.2, pL(t.value) || 0.5); return changed(); }
  };
  host.addEventListener("change", planChange);
  if (top) top.addEventListener("change", (ev) => { if (ON && !INPLACE) planChange(ev); });
  const planClick = (ev) => {
    const t = ev.target.closest("button"); const u = cur(); if (!t || !u) return;
    if (t.dataset.pz) return PZ.barClick(ZM, t, host.getBoundingClientRect(), drawPlan);
    const d = t.dataset;
    if (d.tool) { TOOL = d.tool; SEL = null; return drawPlan(); }
    const f = U.figures(u);
    if (d.pw) {
      const e = f.edges.find((q) => q.key === SEL.key); if (!e) return;
      if (d.pw === "space") {
        const A = u.rooms.find((q) => q.id === e.a), B = u.rooms.find((q) => q.id === e.b); if (!A || !B) return;
        if (U.spaceOf(A) === U.spaceOf(B)) { for (const r of [A, B]) if (r.space && r.space !== r.id) delete r.space; if (!A.space && !B.space) { /* the main one keeps the rest */ } }
        else { const main = (A.kind === "LD" || A.w * A.h >= B.w * B.h) ? A : B, other = main === A ? B : A, sp = U.spaceOf(main), was = U.spaceOf(other); for (const r of u.rooms) if (U.spaceOf(r) === was) r.space = sp; if (main.space === main.id) delete main.space; }
        return changed();
      }
      if (d.pw === "kind-ext" || d.pw === "kind-party") {
        // this wall alone; the same as its side's setting: no override kept
        const k = d.pw.slice(5), o = u.walls[e.key] = u.walls[e.key] || {}, side = (u.partySides || []).includes(e.face) ? "party" : "ext";
        if (k === side) delete o.kind; else o.kind = k;
        return changed();
      }
      if (d.pw === "full") { const o = u.walls[e.key] || {}; delete o.s; delete o.e; return changed(); }
      if (d.pw === "toggle") { const o = u.walls[e.key] = u.walls[e.key] || {}; o.open = !U.isOpen(u, e); return changed(); }
      if (d.pw === "join") { const v = U.joinRooms(u, e.a, e.b); if (!v) return toast("These two rooms do not make one rectangle", true); { const st0 = store(); st0.list[st0.sel] = v; } SEL = null; return changed(); }
      const rs = edgeRoomSide(e);
      if (d.pw === "door") {
        // to a balcony or utility platform: a sliding door, 2 leaves, as wide as the wall allows (to 2.4 m)
        const sl = U.byOutdoor(u, e), dw = sl ? +Math.max(0.8, Math.min(2.4, e.len - 0.4)).toFixed(2) : 0.8;
        const r0 = u.rooms.find((q) => q.id === rs.room);
        u.doors.push(Object.assign({ room: rs.room, side: rs.side, at: +(Math.max(0, (e.len - dw) / 2) + (rs.from - (rs.side === "n" || rs.side === "s" ? r0.x : r0.y))).toFixed(2), w: dw, hinge: "start", swing: "in" }, sl ? { type: "sliding2" } : {}));
        SEL = { t: "door", i: u.doors.length - 1 }; return changed();
      }
      if (d.pw === "win") { const r = u.rooms.find((q) => q.id === rs.room), ww = Math.min(1.5, e.len - 0.4); u.windows.push({ room: rs.room, side: rs.side, at: +((rs.from - (rs.side === "n" || rs.side === "s" ? r.x : r.y)) + (e.len - ww) / 2).toFixed(2), w: +ww.toFixed(2) }); SEL = { t: "win", i: u.windows.length - 1 }; return changed(); }
    }
    if (d.pd) { const dd = u.doors[SEL.i]; if (d.pd === "hinge") dd.hinge = dd.hinge === "end" ? "start" : "end"; if (d.pd === "swing") dd.swing = dd.swing === "out" ? "in" : "out"; if (d.pd === "del") { u.doors.splice(SEL.i, 1); SEL = null; }
      if (d.pd === "pushs" || d.pd === "pushe") { const st = U.doorStops(u, dd).filter((q) => q.end === (d.pd === "pushs" ? "start" : "end")); if (!st.length) return toast("No wall meets this side", true); const at0 = +dd.at || 0; dd.at = st.reduce((m, q) => (Math.abs(q.at - at0) < Math.abs(m.at - at0) ? q : m)).at; }
      return changed(); }
    if (d.px) {
      const e = u.extras[SEL.i]; if (!e) return;
      if (d.px === "rot") { [e.w, e.h] = [e.h, e.w]; return changed(); }
      if (d.px === "del") { u.extras.splice(SEL.i, 1); SEL = null; return changed(); }
    }
    if (d.pxp) { const e = u.extras[SEL.i]; if (!e) return; if (e.kind !== "bay") { e.parts = [{ kind: e.kind in PART_LEN ? e.kind : "bal", len: +(Math.max(e.w, e.h)).toFixed(3) }]; e.kind = "bay"; } const L = e.free ? PART_LEN[d.pxp] : up2(XAREA[d.pxp] / (e.h >= e.w ? e.w : e.h)); e.parts.push({ kind: d.pxp, len: L }); if (e.h >= e.w) e.h = +(e.h + L).toFixed(3); else e.w = +(e.w + L).toFixed(3); return changed(); }
    if (d.pxd != null) {
      const e = u.extras[SEL.i]; if (!e || e.kind !== "bay") return;
      const [q] = e.parts.splice(+d.pxd, 1), L = +q.len || 0;
      if (!e.parts.length) { u.extras.splice(SEL.i, 1); SEL = null; return changed(); }
      if (e.h >= e.w) e.h = +Math.max(0.3, e.h - L).toFixed(3); else e.w = +Math.max(0.3, e.w - L).toFixed(3);
      return changed();
    }
    if (d.pz2 === "del") { u.zones.splice(SEL.i, 1); SEL = null; return changed(); }
    if (d.pwin === "del") { u.windows.splice(SEL.i, 1); SEL = null; return changed(); }
    if (d.pf) { if (d.pf === "rot") u.fixtures[SEL.i] = U.rotateFixture(u.fixtures[SEL.i]); if (d.pf === "del") { u.fixtures.splice(SEL.i, 1); SEL = null; } return changed(); }
  };
  host.addEventListener("click", planClick);
  if (top) top.addEventListener("click", (ev) => { if (ON && !INPLACE && !ev.target.closest("[data-pt]")) planClick(ev); });
  // the top bar's tools, the library dropped onto a wall
  PT.handlers("units", {
    tool: (id) => {
      if (id === "lib") { PT.toggleLibrary(); return drawPlan(); }
      if (id === "undo") return undo(-1);
      if (id === "redo") return undo(1);
      if (id === "brochure") { const st = store(), bt = document.querySelector('[data-pt="brochure"]'), r0 = bt ? bt.getBoundingClientRect() : { left: 400, bottom: 120 }; return PT.ctx({ preventDefault() {}, clientX: r0.left, clientY: r0.bottom + 4 }, [{ label: `This unit: ${(cur() || {}).name || "Unit"}`, action: () => brochure([st.sel]) }, { label: `All ${st.list.length} units`, action: () => brochure(st.list.map((_, i) => i)) }]); }
      if (id === "uxlsx") return unitsXlsx();
      TOOL = TOOL === id && id !== "select" ? "select" : id; SEL = null; drawPlan();
    },
    refresh: () => drawPlan(),
    drag: {
      over: (item, ev) => { HOVW = ON ? wallUnder(ev, 0.5) : null; drawPlan(); },
      drop: (item, ev) => { HOVW = null; const hit = ON ? wallUnder(ev, 0.5) : null; if (!hit) { drawPlan(); return toast("Drop it on a wall of the unit", true); } placeOpening(hit, item.id, item.w); },
    },
  });
  host.addEventListener("contextmenu", (ev) => onContext(ev));
  host.addEventListener("mousedown", (ev) => { if (ev.button === 1) ev.preventDefault(); });   // no autoscroll
  host.addEventListener("pointerdown", (ev) => {
    const t = ev.target, u0 = cur(); if (!u0 || ev.target.closest(".un-bar,.un-pop,.pz-bar,.un-dimin")) return;
    // a dimension: type its figure
    const dm = ev.button === 0 && t.closest && t.closest("[data-td],[data-cd]");
    if (dm && C.can()) { ev.preventDefault(); ev.stopPropagation(); setTimeout(() => onDimClick(dm), 0); return; }
    // a second finger: whatever was being dragged goes back, and the two pinch the plan
    if (PZ.down(ZM, ev)) {
      if (drag) { if (drag.u0) { const st0 = store(); st0.list[st0.sel] = drag.u0; } drag = null; LIVE = null; }
      cap(host, ev); ev.preventDefault(); drawPlan(); return;
    }
    // the middle button: pan, whatever is under it
    if (ev.button === 1) { ev.preventDefault(); drag = { kind: "pan", x: ev.clientX, y: ev.clientY, px: ZM.px, py: ZM.py, moved: false }; cap(host, ev); return; }
    if (TOOL === "measure" && ev.button === 0) { ev.preventDefault(); ME.click(MEAS, ME.snap(toPlan(ev), measureGeo(ensure(u0)), 12 / SC)); drawPlan(); return; }
    const u = ensure(u0), f = U.figures(u), P = toPlan(ev), can = C.can();
    // tools that click a room or a wall
    if (can && TOOL !== "select") {
      if ((TOOL === "door" || TOOL === "window") && t.dataset.ek) {
        const e = f.edges.find((q) => q.key === t.dataset.ek), rs = e && edgeRoomSide(e);
        if (!e || (TOOL === "window" && e.kind === "part")) return toast("A window goes on an external wall", true);
        const r = u.rooms.find((q) => q.id === rs.room), along = rs.side === "n" || rs.side === "s" ? P[0] - r.x : P[1] - r.y;
        if (TOOL === "door") { const sl = U.byOutdoor(u, e), dw = sl ? +Math.max(0.8, Math.min(2.4, e.len - 0.4)).toFixed(2) : 0.8; u.doors.push(Object.assign({ room: rs.room, side: rs.side, at: +Math.max(0, along - dw / 2).toFixed(2), w: dw, hinge: "start", swing: "in" }, sl ? { type: "sliding2" } : {})); SEL = { t: "door", i: u.doors.length - 1 }; }
        else { u.windows.push({ room: rs.room, side: rs.side, at: +Math.max(0, along - 0.6).toFixed(2), w: 1.2 }); SEL = { t: "win", i: u.windows.length - 1 }; }
        TOOL = "select"; return changed();
      }
      if (TOOL.startsWith("split") && t.dataset.rid) {
        const r = u.rooms.find((q) => q.id === t.dataset.rid), ax = TOOL === "split-x" ? "x" : "y";
        const v = U.splitRoom(u, r.id, ax, ax === "x" ? P[0] - r.x : P[1] - r.y);
        if (v === u) return toast("Too near the room's edge", true);
        { const st0 = store(); st0.list[st0.sel] = v; } TOOL = "select"; return changed();
      }
      // the wall clicked: its line, or a window / door in it
      const wi = t.dataset.wi != null ? u.windows[+t.dataset.wi] : t.dataset.di != null ? u.doors[+t.dataset.di] : null;
      const ek = t.dataset.ek || (wi ? wi.room + ":" + wi.side : "");
      if (TOOL.startsWith("x:") && ek) {
        const e = f.edges.find((q) => q.key === ek || (q.kind !== "part" && q.a === wi?.room && q.face === wi?.side && (q.x1 === q.x2 ? P[1] >= q.y1 - 0.05 && P[1] <= q.y2 + 0.05 : P[0] >= q.x1 - 0.05 && P[0] <= q.x2 + 0.05)));
        if (!e || e.kind === "part") return toast("Click an external wall: it goes outside it", true);
        const k = TOOL.slice(2), X = XADD[k], vert = e.x1 === e.x2;
        const len = X.parts ? X.parts.reduce((s2, q) => s2 + q.len, 0) : X.len, dep = X.depth;
        const out = e.face === "e" || e.face === "s" ? 1 : -1, wallAt = (vert ? e.x1 : e.y1) + out * U.extWallT(u, e) / 2;   // its outer face
        const mid = Math.round(((vert ? P[1] : P[0]) - len / 2) * 20) / 20, lo = vert ? e.y1 : e.x1, hi = vert ? e.y2 : e.x2;
        const a = Math.max(lo - len / 2, Math.min(mid, hi - len / 2));
        const ex = vert ? { x: out > 0 ? wallAt : wallAt - dep, y: a, w: dep, h: len } : { x: a, y: out > 0 ? wallAt : wallAt - dep, w: len, h: dep };
        for (const q of ["x", "y", "w", "h"]) ex[q] = +ex[q].toFixed(3);
        u.extras = u.extras || [];
        const nx2 = Object.assign({ kind: X.parts ? "bay" : k }, ex, X.parts ? { parts: X.parts.map((q) => Object.assign({}, q)) } : {});
        keepArea(nx2, vert ? "w" : "h");   // at its area: balcony 2.0, UP 1.5, A/C 0.8 m²
        u.extras.push(nx2);
        SEL = { t: "x", i: u.extras.length - 1 }; TOOL = "select"; return changed();
      }
      if (TOOL === "room") {
        drag = { kind: "newroom", P0: snapRoom(u, P), P1: null };
        cap(host, ev); ev.preventDefault(); return;
      }
      if (TOOL.startsWith("fix:") && t.dataset.rid) {
        u.fixtures.push(ghostFix(TOOL.slice(4), P));
        SEL = { t: "fix", i: u.fixtures.length - 1 }; TOOL = "select"; GHOST = null; FIXROT = 0; return changed();
      }
      return;
    }
    if (t.dataset.fh && can) { const [fi, c] = t.dataset.fh.split(":"); drag = { kind: "fh", i: +fi, c, P, u0: JSON.parse(JSON.stringify(u)), moved: false }; cap(host, ev); ev.preventDefault(); return; }
    if (t.dataset.zh && can) { const [zi, c] = t.dataset.zh.split(":"); drag = { kind: "zh", i: +zi, c, P, u0: JSON.parse(JSON.stringify(u)), moved: false }; }
    else if (t.dataset.zi != null) { SEL = { t: "z", i: +t.dataset.zi }; if (can) drag = { kind: "zone", i: +t.dataset.zi, P, u0: JSON.parse(JSON.stringify(u)), moved: false }; drawPlan(); }
    else if (t.dataset.xi != null) { SEL = { t: "x", i: +t.dataset.xi }; if (can) drag = { kind: "x", i: +t.dataset.xi, P, u0: JSON.parse(JSON.stringify(u)), moved: false }; drawPlan(); }
    else if (t.dataset.wend && WENDS && can) { drag = { kind: "wend", key: WENDS.key, end: t.dataset.wend, u0: JSON.parse(JSON.stringify(u)), moved: false }; }
    else if (t.dataset.di != null) { SEL = { t: "door", i: +t.dataset.di }; if (can) drag = { kind: "door", i: +t.dataset.di, P, u0: JSON.parse(JSON.stringify(u)), moved: false }; drawPlan(); }
    else if (t.dataset.wi != null) { SEL = { t: "win", i: +t.dataset.wi }; if (can) drag = { kind: "win", i: +t.dataset.wi, P, u0: JSON.parse(JSON.stringify(u)), moved: false }; drawPlan(); }
    else if (t.dataset.fi != null) { SEL = { t: "fix", i: +t.dataset.fi }; if (can) drag = { kind: "fix", i: +t.dataset.fi, P, u0: JSON.parse(JSON.stringify(u)), moved: false }; drawPlan(); }
    else if (t.dataset.ek) {
      const e = f.edges.find((q) => q.key === t.dataset.ek);
      if (can && e) drag = { kind: "wall", e, key: e.key, x: ev.clientX, y: ev.clientY, u0: JSON.parse(JSON.stringify(u)), alt: ev.altKey, moved: false };
      else { SEL = { t: "wall", key: t.dataset.ek }; drawPlan(); }
    } else if (t.dataset.rid) { SELR = t.dataset.rid; SEL = null; render(); return; }
    else { drag = { kind: "pan", x: ev.clientX, y: ev.clientY, px: ZM.px, py: ZM.py, moved: false }; }
    if (drag) { cap(host, ev); ev.preventDefault(); }
  });
  host.addEventListener("pointermove", (ev) => {
    if (PZ.move(ZM, ev, host.getBoundingClientRect())) return drawPlan();
    if (!drag && TOOL.startsWith("fix:") && cur()) { GHOST = toPlan(ev); if (!drawPlan.raf) drawPlan.raf = requestAnimationFrame(() => { drawPlan.raf = 0; drawPlan(); }); return; }
    if (!drag && TOOL === "measure" && cur()) { MEAS.hover = ME.snap(toPlan(ev), measureGeo(ensure(cur())), 12 / SC); if (!drawPlan.raf) drawPlan.raf = requestAnimationFrame(() => { drawPlan.raf = 0; drawPlan(); }); return; }
    if (!drag) return;
    if (drag.kind === "pan") {
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true; ZM.px = drag.px + dx; ZM.py = drag.py + dy; return drawPlan();
    }
    const st = store(), P = toPlan(ev);
    if (drag.kind === "newroom") { drag.P1 = snapRoom(cur(), P); return roomPreview(drag); }
    if (drag.kind === "wall") {
      const e = drag.e, v = e.x1 === e.x2, dist = v ? (ev.clientX - drag.x) / SC : (ev.clientY - drag.y) / SC;
      if (Math.abs(dist) < 0.025 && !drag.moved) return;
      drag.moved = true;
      // just this piece of wall (its rooms); Alt: the whole line it is aligned with
      st.list[st.sel] = U.moveLine(drag.u0, v ? "x" : "y", v ? e.x1 : e.y1, dist, null, null, drag.alt ? null : [e.a, e.b].filter(Boolean));
      LIVE = { axis: v ? "x" : "y", at: (v ? e.x1 : e.y1) + Math.round(dist * 20) / 20, d: Math.round(dist * 20) / 20 };
      return render();
    }
    if (drag.kind === "wend") {
      const v = JSON.parse(JSON.stringify(drag.u0)), e = U.figures(v).edges.find((q) => q.key === drag.key); if (!e) return;
      const along = Math.round(((e.x1 === e.x2 ? P[1] - e.y1 : P[0] - e.x1)) * 20) / 20, [a, b] = U.solidPart(v, e), o = v.walls[e.key] = v.walls[e.key] || {};
      if (drag.end === "s") o.s = Math.max(0, Math.min(along, b - 0.1)); else o.e = Math.min(e.len, Math.max(along, a + 0.1));
      if (o.s === 0) delete o.s; if (o.e != null && Math.abs(o.e - e.len) < 1e-6) delete o.e;
      drag.moved = true; st.list[st.sel] = v; return drawPlan();
    }
    const dx = P[0] - drag.P[0], dy = P[1] - drag.P[1];
    if (Math.hypot(dx, dy) < 0.03 && !drag.moved) return;
    drag.moved = true;
    const v = JSON.parse(JSON.stringify(drag.u0)), snapv = (q) => Math.round(q * 20) / 20;
    if (drag.kind === "door" || drag.kind === "win") {
      const o = (drag.kind === "door" ? v.doors : v.windows)[drag.i], r = v.rooms.find((q) => q.id === o.room);
      const L = o.side === "n" || o.side === "s" ? r.w : r.h, delta = o.side === "n" || o.side === "s" ? dx : dy;
      const raw = (+o.at || 0) + delta, sn = drag.kind === "door" && !ev.altKey ? U.snapDoorAt(v, o, raw) : null;
      o.at = Math.max(0, Math.min(L - (+o.w || 0.8), sn != null ? sn : snapv(raw)));
    } else if (drag.kind === "fix") { const x = v.fixtures[drag.i]; x.x = snapv(x.x + dx); x.y = snapv(x.y + dy); }
    else if (drag.kind === "fh") {
      // one edge of a fitting pulled: the other stays; to a wall face or centre line near (0.15 m), else 10 mm
      const x = v.fixtures[drag.i], B = fixBox(x), { xs, ys } = snapLines(v), c = drag.c;
      const s1 = (p, L) => { let b = null; for (const a of L) if (Math.abs(a - p) <= 0.15 && (b == null || Math.abs(a - p) < Math.abs(b - p))) b = a; return ev.altKey || b == null ? Math.round(p * 100) / 100 : +b.toFixed(3); };
      if (c === "w") B.x0 = Math.min(B.x1 - 0.2, s1(B.x0 + dx, xs)); if (c === "e") B.x1 = Math.max(B.x0 + 0.2, s1(B.x1 + dx, xs));
      if (c === "n") B.y0 = Math.min(B.y1 - 0.2, s1(B.y0 + dy, ys)); if (c === "s") B.y1 = Math.max(B.y0 + 0.2, s1(B.y1 + dy, ys));
      const bw = +(B.x1 - B.x0).toFixed(3), bh = +(B.y1 - B.y0).toFixed(3), cx = (B.x0 + B.x1) / 2, cy = (B.y0 + B.y1) / 2;
      x.w = B.q ? bh : bw; x.h = B.q ? bw : bh; x.x = +(cx - x.w / 2).toFixed(3); x.y = +(cy - x.h / 2).toFixed(3);
    }
    else if (drag.kind === "zone" || drag.kind === "zh") {
      // a zone: moved or a corner pulled, to the wall lines near (0.25 m) or the 50 mm grid; no room changes
      const z = v.zones[drag.i], { xs, ys } = snapLines(v);
      const s1 = (p, L) => { let b = null; for (const a of L) if (Math.abs(a - p) <= 0.25 && (b == null || Math.abs(a - p) < Math.abs(b - p))) b = a; return ev.altKey || b == null ? snapv(p) : +b.toFixed(3); };
      if (drag.kind === "zone") { const sn = (p, w, L) => { let b = null; for (const a of L) for (const c of [a - p, a - (p + w)]) if (Math.abs(c) <= 0.25 && (b == null || Math.abs(c) < Math.abs(b))) b = c; return ev.altKey || b == null ? snapv(p) : +(p + b).toFixed(3); }; z.x = sn(z.x + dx, z.w, xs); z.y = sn(z.y + dy, z.h, ys); }
      else {
        let x0 = z.x, y0 = z.y, x1 = z.x + z.w, y1 = z.y + z.h;
        if (drag.c.includes("w")) x0 = s1(x0 + dx, xs); else if (drag.c.includes("e")) x1 = s1(x1 + dx, xs);
        if (drag.c.includes("n")) y0 = s1(y0 + dy, ys); else if (drag.c.includes("s")) y1 = s1(y1 + dy, ys);
        if (x1 - x0 >= 0.3 && y1 - y0 >= 0.3) Object.assign(z, { x: +x0.toFixed(3), y: +y0.toFixed(3), w: +(x1 - x0).toFixed(3), h: +(y1 - y0).toFixed(3) });
      }
    }
    else if (drag.kind === "x") {
      // a balcony / UP / bay: to the wall lines near (0.25 m), else the 50 mm grid
      const x = v.extras[drag.i], xs = [], ys = [];
      for (const r of v.rooms) { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); }
      for (const e of U.edges(v)) if (e.kind === "ext") { const t = U.extWallT(v, e) / 2; if (e.x1 === e.x2) xs.push(e.x1 + (e.face === "e" ? t : -t)); else ys.push(e.y1 + (e.face === "s" ? t : -t)); }
      const sn = (p, w, L) => { let b = null; for (const a of L) for (const c of [a - p, a - (p + w)]) if (Math.abs(c) <= 0.25 && (b == null || Math.abs(c) < Math.abs(b))) b = c; return b != null ? +(p + b).toFixed(3) : snapv(p); };
      x.x = ev.altKey ? snapv(x.x + dx) : sn(x.x + dx, x.w, xs); x.y = ev.altKey ? snapv(x.y + dy) : sn(x.y + dy, x.h, ys);
    }
    st.list[st.sel] = v;
    drawPlan();
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null; LIVE = null;
    if (d.kind === "pan") { if (!d.moved) SEL = null; return drawPlan(); }
    if (d.kind === "newroom") {
      const u = cur(); if (!u || !d.P1) return drawPlan();
      const rect = { x: Math.min(d.P0[0], d.P1[0]), y: Math.min(d.P0[1], d.P1[1]), w: Math.abs(d.P1[0] - d.P0[0]), h: Math.abs(d.P1[1] - d.P0[1]) };
      if (rect.w < 0.05 && rect.h < 0.05) return drawPlan();
      if (ROOMK === "OKIT" || ROOMK === "KIT") {
        if (rect.w < 0.3 || rect.h < 0.3) return drawPlan();
        const q = (a) => Math.round(a * 20) / 20;
        (u.zones = u.zones || []).push({ kind: ROOMK, x: q(rect.x), y: q(rect.y), w: q(rect.w), h: q(rect.h) });
        SEL = { t: "z", i: u.zones.length - 1 }; return changed();
      }
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
  host.addEventListener("pointerup", (ev) => { PZ.up(ZM, ev); end(); });
  host.addEventListener("pointercancel", (ev) => { PZ.up(ZM, ev); end(); });
  host.addEventListener("wheel", (ev) => {
    if (ev.target.closest(".un-pop,.un-bar,.pz-bar")) return;
    ev.preventDefault(); if (PZ.wheel(ZM, ev, host.getBoundingClientRect())) drawPlan();
  }, { passive: false });
  document.addEventListener("keydown", (ev) => {
    if (!ON || ev.target.closest("input,select,textarea")) return;
    if (ev.key === "Escape") { if (TOOL === "measure" && (MEAS.a || MEAS.list.length)) { if (MEAS.a) MEAS.a = null; else ME.clear(MEAS); return drawPlan(); } TOOL = "select"; SEL = null; drawPlan(); }
    const u = cur(); if (!u || !C.can()) return;
    // Space (as in Revit): turn what is about to be placed, or the selected: a fitting 90°, a door's swing round its four ways
    if ((ev.key === " " || ev.key.toLowerCase() === "r") && TOOL.startsWith("fix:") && !ev.ctrlKey && !ev.metaKey) { ev.preventDefault(); FIXROT = (FIXROT + 1) % 4; return drawPlan(); }
    if (!SEL) return;
    if (ev.key === " " && !ev.ctrlKey && !ev.metaKey) {
      if (SEL.t === "fix") { ev.preventDefault(); u.fixtures[SEL.i] = U.rotateFixture(u.fixtures[SEL.i]); return changed(); }
      if (SEL.t === "x") { ev.preventDefault(); const e = u.extras[SEL.i]; [e.w, e.h] = [e.h, e.w]; return changed(); }
      if (SEL.t === "door") { ev.preventDefault(); const dd = u.doors[SEL.i], k = (dd.hinge === "end" ? 1 : 0) + (dd.swing === "out" ? 2 : 0), n2 = [1, 3, 0, 2][k]; dd.hinge = n2 & 1 ? "end" : "start"; dd.swing = n2 & 2 ? "out" : "in"; return changed(); }
    }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      if (SEL.t === "door") u.doors.splice(SEL.i, 1); else if (SEL.t === "win") u.windows.splice(SEL.i, 1); else if (SEL.t === "fix") u.fixtures.splice(SEL.i, 1); else if (SEL.t === "x") u.extras.splice(SEL.i, 1); else if (SEL.t === "z") u.zones.splice(SEL.i, 1);
      else if (SEL.t === "wall") { (u.walls[SEL.key] = u.walls[SEL.key] || {}).open = true; }
      SEL = null; changed();
    }
    if (ev.key.toLowerCase() === "r" && SEL.t === "x") { const e = u.extras[SEL.i]; [e.w, e.h] = [e.h, e.w]; changed(); }
    if (ev.key.toLowerCase() === "r" && SEL.t === "fix") { u.fixtures[SEL.i] = U.rotateFixture(u.fixtures[SEL.i]); changed(); }
    if (ev.key.toLowerCase() === "f" && SEL.t === "door") { const dd = u.doors[SEL.i]; dd.hinge = dd.hinge === "end" ? "start" : "end"; changed(); }
  });
  window.addEventListener("resize", () => ON && drawPlan());
}
