/* Site study, stage 4: the typical floor of a domestic massing group - its
 * unit mix laid along a double-loaded corridor (straight, or bending in legs
 * at any angle) with a core of staircases, lifts, a refuse room and an E&M
 * riser (floorcore.js), drawn on the group's floor plate, with the floor's
 * GFA, concessions and the checks. The settings are kept on the massing
 * group (g.floor).
 *
 * Drawn like a drawing tool: an icon toolbar along the top of the plan, a
 * property bar under it for what is selected, the right-click menu, a
 * clipboard, a library of doors / windows / openings dragged onto walls
 * (plantools.js); walls, the corridor and lobbies drawn as polylines at any
 * angle (wallcore.js).
 */
import * as FC from "./floorcore.js";
import * as WC from "./wallcore.js";
import * as M from "./massingcore.js";
import * as UC from "./unitcore.js";
import { toast } from "./tasks-util.js";
import * as PZ from "./planzoom.js";
import * as PT from "./plantools.js";
import { outlineOf } from "./unitwalls.js";
import * as UN from "./siteunits.js";
import * as ME from "./measure.js";
import * as DM from "./dims.js";
import { headers } from "./nav.js";

const $ = (s, r = document) => r.querySelector(s);
let SPACE = false;
const MEAS = ME.create();   // the measures on the plan (for the visit)
addEventListener("keydown", (ev) => { if (ev.code === "Space" && !ev.target.closest("input,textarea,select")) { if (ON && !SPACE) { SPACE = true; } if (ON && document.getElementById("st-fplan") && !document.getElementById("st-fplan").hidden) ev.preventDefault(); } });
let SPACEPAN = false;   // Space held to pan: on its release nothing is turned
addEventListener("keyup", (ev) => {
  if (ev.code !== "Space") return;
  const tap = SPACE && !SPACEPAN; SPACE = false; SPACEPAN = false;
  // Space tapped (as in Revit): the selected unit or core piece turned 90° (Shift: a unit mirrored), a door's hinge flipped
  if (tap && ON && !ev.target.closest("input,textarea,select") && !$("#st-fpanel").hidden) spaceTurn(ev.shiftKey);
});
const cap = (el, ev) => { try { el.setPointerCapture(ev.pointerId); } catch (e) { /* a synthetic or finished pointer */ } };
const f3 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f0 = (x) => (x == null || isNaN(x) ? "–" : Math.round(x).toLocaleString("en-GB"));
const f1 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const R3 = (v) => Math.round(v * 1000) / 1000;

let C = null, ON = false, SEL = null, LAST = null;
let PSEL = null;          // the selected unit on the plan: index into LAST.placed (all the legs')
let SWAP = false;         // the next unit (or core piece) tapped swaps with the selected one
let VIEWKEY = "";         // the group the view was fitted to
let PTSEL = null;         // the selected party wall between units: {key, leg}
let WSEL = null;          // the selected floor wall: index into the floor's walls
let WSEG = 0;             // its selected segment
let OPSEL = null;         // the selected opening: {ci, di} on a core piece, or {wi, oi} on a floor wall
let SPSEL = false;        // the corridor (its spine) selected
let SPPT = null;          // a selected point of it (a bend): its turn in the bar
let WALLDRAW = null;      // a polyline being drawn: {kind: wall|corridor|lobby, pts, hover, typed}
let JOINA = null;         // the join tool: the first wall picked
let VSEL = null;          // the selected corner of the plate
let CSEL = null;          // the selected core piece: index into LAST.core (all the legs')
let TOOL = "select";      // select | wall | split | join | corridor | lobby | unit | add:stair | add:lift | add:refuse | add:riser | add:lobby
let LIBHOV = null;        // a library opening dragged over the plan: where it would go
let CTXP = null;          // where the last right-click was, in the plate frame
const SNAP = () => { try { return localStorage.getItem("lwk-viewer:fl-snap") !== "off"; } catch (e) { return true; } };
let FH = [], FI = -1, FKEY = null;   // undo history of the group's floor settings
const ZM = PZ.create();
let SC = 10, OX = 0, OY = 0, X0 = 0, Y0 = 0;
const pref = (k, d) => { try { return localStorage.getItem("lwk-viewer:" + k) || d; } catch (e) { return d; } };
const setPref = (k, v) => { try { localStorage.setItem("lwk-viewer:" + k, v); } catch (e) { /* private window */ } };
let VIEW = pref("fl-view", "plan");
const GRID = () => pref("fl-grid", "on") === "on";
const DIMS = () => pref("fl-dims", "on") === "on";
const FURN = () => pref("fl-furn", "on") === "on";
// the wall tool's settings
const WT = () => ({ t: Number(pref("fl-wt", "")) || null, m: pref("fl-wm", "rc"), just: pref("fl-wj", "c") });
const ADDU = () => pref("fl-addu", "");

/* the legs (one for a straight corridor): their frames to the plate frame */
const legs = () => (LAST && LAST.legs) || [];
const legK = (k) => legs().find((l) => l.k === k) || legs()[0];
const MULTI = () => !!(LAST && LAST.multi);
const fromLeg = (l, [u, v]) => [l.xf.ox + l.xf.c * u - l.xf.s * v, l.xf.oy + l.xf.s * u + l.xf.c * v];
const toLeg = (l, [x, y]) => { const dx = x - l.xf.ox, dy = y - l.xf.oy; return [l.xf.c * dx + l.xf.s * dy, -l.xf.s * dx + l.xf.c * dy]; };
const rotIn = (l, dx, dy) => [l.xf.c * dx + l.xf.s * dy, -l.xf.s * dx + l.xf.c * dy];
const pIdx = (ci) => { const c = LAST && LAST.core[ci]; return c && c.pi != null ? c.pi : ci; };
const localOf = (arr, gi, key) => { const q = LAST[arr][gi]; if (!q) return null; const l = legK(q.leg || 0); return { l, i: gi - l[key], q }; };
/* the leg whose part of the floor holds a plate-frame point (nearest its spine) */
function legAt(P) {
  const L = legs(); if (L.length <= 1) return L[0];
  let best = L[0], bd = Infinity;
  for (const l of L) {
    const sp = LAST.spine.path, a = sp[l.k], b = sp[l.k + 1], q = WC.nearestOnPath(P, [a, b]);
    if (q && q.d < bd) { bd = q.d; best = l; }
  }
  return best;
}

export function init(ctx) {
  C = ctx;
  const P = $("#st-fpanel");
  P.addEventListener("change", onChange);
  P.addEventListener("click", onClick);
  P.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches("input")) ev.target.blur(); });
  window.addEventListener("resize", () => ON && drawPlan());
  wirePlan();
  PT.handlers("floors", { tool: onTool, prop: onProp, refresh: () => drawPlan(), drag: { over: libOver, drop: libDrop } });
  const plan = () => ON && VIEW === "plan" && C.can();
  PT.keys(() => ON && !$("#st-fpanel").hidden, {
    "ctrl+z": () => undo(-1), "ctrl+y": () => undo(1),
    "ctrl+c": () => (plan() ? copySel(false) : false), "ctrl+x": () => (plan() ? copySel(true) : false), "ctrl+v": () => (plan() ? paste(CTXP || mid()) : false), "ctrl+d": () => (plan() ? duplicate() : false),
    delete: () => (plan() ? delSel() : false), backspace: () => (plan() ? delSel() : false),
    escape: () => { if (TOOL === "measure" && (MEAS.a || MEAS.list.length)) { if (MEAS.a) MEAS.a = null; else ME.clear(MEAS); return drawPlan(); } if (WALLDRAW) { WALLDRAW = null; return drawPlan(); } if (TOOL !== "select") { setTool("select"); return; } clearSel(); drawPlan(); },
    enter: () => { if (!WALLDRAW) return false; if (WALLDRAW.typed) typedPoint(); else finishDraw(); },
    tab: () => { if (!WALLDRAW || WALLDRAW.kind !== "wall") return false; const j = WT().just; setPref("fl-wj", j === "c" ? "l" : j === "l" ? "r" : "c"); drawPlan(); },
  });
  // the keys the user can change (the shortcuts table: ? or the ⌨ button)
  const tl = (id, key, label, group) => ({ id, key, label, group: group || "Draw", run: () => (plan() ? onTool(id) : false) });
  PT.KS.register("floors", () => ON && !$("#st-fpanel").hidden, [
    { id: "select", key: "v", label: "Select and move", group: "Draw", run: () => (plan() ? setTool("select") : false) },
    tl("wall", "w", "Wall"), tl("split", "x", "Cut a wall"), tl("join", "j", "Join walls"),
    tl("corridor", "c", "Corridor"), tl("lobby", "l", "Lobby / passage"),
    tl("unit", "u", "Unit", "Add"), tl("add:stair", "s", "Staircase", "Add"), tl("add:lift", "i", "Lift", "Add"), tl("add:refuse", "r", "Refuse room", "Add"), tl("add:riser", "e", "E&M riser", "Add"), tl("add:lobby", "b", "Protected lobby", "Add"),
    tl("lib", "d", "Doors, windows, openings library", "Add"),
    { id: "grid", key: "g", label: "Grid on / off", group: "View", run: () => onTool("grid") },
    { id: "snap", key: "n", label: "Snap on / off", group: "View", run: () => onTool("snap") },
    { id: "measure", key: "m", label: "Measure (two points; parallel faces: the clear width)", group: "View", run: () => (VIEW === "plan" ? onTool("measure") : false) },
    { id: "fit", key: "f", label: "Fit the plan in the window", group: "View", run: () => { if (VIEW !== "plan") return false; VIEWKEY = ""; PZ.reset(ZM); drawPlan(); } },
    tl("fitplate", "p", "Fit the plate round its units and core", "Edit"),
    { id: "v:3d", key: "t", label: "Plan / 3D", group: "View", run: () => onTool(VIEW === "plan" ? "v:3d" : "v:plan") },
  ], [
    { keys: "Ctrl+Z / Ctrl+Y", label: "Undo / redo", group: "Edit" }, { keys: "Ctrl+C / Ctrl+X / Ctrl+V", label: "Copy / cut / paste", group: "Edit" }, { keys: "Ctrl+D", label: "Duplicate", group: "Edit" },
    { keys: "Delete", label: "Remove the selected", group: "Edit" }, { keys: "Space (tap)", label: "Turn the selected unit or core piece 90°; a door: its hinge to the other side (Space held and dragged: pan)", group: "Edit" }, { keys: "Shift+Space", label: "Mirror the selected unit", group: "Edit" }, { keys: "Esc", label: "Stop drawing / clear the selection", group: "Edit" }, { keys: "Right-click", label: "Menu: copy, paste, add a door…", group: "Edit" },
    { keys: "Enter / double-click", label: "End a wall or corridor", group: "While drawing" }, { keys: "Tab", label: "Wall line: centre / left / right", group: "While drawing" },
    { keys: "0–9 .", label: "Type the next segment's length", group: "While drawing" }, { keys: "Shift", label: "Any angle (no 15° steps)", group: "While drawing" }, { keys: "Alt", label: "No snapping", group: "While drawing" },
    { keys: "Wheel / pinch", label: "Zoom", group: "View" }, { keys: "Drag the empty plan", label: "Pan", group: "View" },
  ], "4 · Floors");
  // for the browser tests: the layout, and a plan point on the screen
  window.__floors = { last: () => LAST, screen: (p) => { const b = $("#st-fplan").getBoundingClientRect(); return [b.left + OX + (p[0] - X0) * SC, b.top + OY + (p[1] - Y0) * SC]; }, leg: (k, p) => fromLeg(legK(k), p),
    drop: (P, type, w) => addOpening(openingTarget(P, w), type, w), spine: (fn) => editSpine(fn), FC, snapGeo: () => snapGeo(), sc: () => SC };
  // digits typed while drawing: the next segment's length
  document.addEventListener("keydown", (ev) => {
    if (!ON || !WALLDRAW || !WALLDRAW.pts.length || ev.target.closest("input,select,textarea")) return;
    if (/^[0-9.]$/.test(ev.key)) { WALLDRAW.typed = (WALLDRAW.typed || "") + ev.key; ev.preventDefault(); drawPlan(); }
    else if (ev.key === "Backspace" && WALLDRAW.typed) { WALLDRAW.typed = WALLDRAW.typed.slice(0, -1); ev.preventDefault(); ev.stopPropagation(); drawPlan(); }
  }, true);
}
const mid = () => (LAST ? [LAST.L / 2, LAST.D / 2] : [0, 0]);
function spaceTurn(shift) {
  if (VIEW !== "plan" || !C.can() || !LAST) return;
  if (OPSEL && opAt(OPSEL)) return onTool("o:flip");
  if (CSEL != null && LAST.core[CSEL]) return onTool("c:rot");
  if (PSEL != null && LAST.placed[PSEL]) return onTool(shift ? "u:flip" : "u:rot");
}
function clearSel() { PSEL = CSEL = WSEL = VSEL = PTSEL = OPSEL = SPPT = null; SPSEL = false; SWAP = false; JOINA = null; }
function setTool(t) {
  TOOL = t; WALLDRAW = null; JOINA = null; LIBHOV = null;
  if (t !== "select") clearSel();
  if (t === "wall" || t === "corridor" || t === "lobby") WALLDRAW = { kind: t, pts: [] };
  drawPlan();
}

/* the floor settings' history, per floor group */
function snapF(x) {
  if (FKEY !== x.key) { FH = []; FI = -1; FKEY = x.key; }
  const g = x.b.groups[x.gi], j = JSON.stringify({ floor: g.floor || {}, fp: g.fp || null, mix: g.mix || null }); if (FH[FI] === j) return;
  FH = FH.slice(0, FI + 1); FH.push(j); if (FH.length > 60) FH.shift(); FI = FH.length - 1;
}
function undo(step) {
  const x = cur(); if (!x || !C.can()) return;
  snapF(x);
  const k = FI + step; if (k < 0 || k >= FH.length) return toast(step < 0 ? "Nothing to undo" : "Nothing to redo");
  FI = k; const v = JSON.parse(FH[FI]), g = x.b.groups[x.gi]; g.floor = v.floor; if (v.fp) g.fp = v.fp; else delete g.fp; if (v.mix) g.mix = v.mix; clearSel(); C.save(); render();
}
/* an edit of the floor's units, each leg's list (SQ(leg)): the automatic layout taken as it stands first */
function edit(fn) {
  const x = cur(); if (!x || !LAST || !C.can()) return;
  snapF(x);
  const g = x.b.groups[x.gi], f = g.floor = g.floor || {};
  if (MULTI()) {
    if (!Array.isArray(f.legSeq)) f.legSeq = [];
    for (const l of legs()) if (!f.legSeq[l.k]) f.legSeq[l.k] = JSON.parse(JSON.stringify(l.r.seq));
  } else if (!f.seq) f.seq = JSON.parse(JSON.stringify(LAST.seq));
  const SQ = (k) => (MULTI() ? f.legSeq[k || 0] : f.seq);
  const keep = fn(SQ, f);
  snapF(x); C.save();
  PSEL = keep == null ? null : keep;
  render();
}
function editFloor(fn) {
  const x = cur(); if (!x || !LAST || !C.can()) return;
  snapF(x);
  const g = x.b.groups[x.gi], f = g.floor = g.floor || {};
  if (!f.frame) f.frame = LAST.frameAxis;
  const r = fn(f, g);
  snapF(x); C.save(); render();
  return r;
}
function editWalls(fn) {
  return editFloor((f) => {
    if (f.corrY == null && !MULTI()) f.corrY = LAST.y0;
    f.walls = Array.isArray(f.walls) ? f.walls : [];
    const keep = fn(f.walls, f);
    WSEL = keep == null ? null : keep;
  });
}
function editCore(fn) {
  return editFloor((f) => {
    if (!Array.isArray(f.pieces) || !f.pieces.length) f.pieces = JSON.parse(JSON.stringify(LAST.coreOut));
    const keep = fn(f.pieces, f);
    // the selection: the piece's place in the laid-out core, found again after the layout
    CSEL = keep == null ? null : { pi: keep };
    PSEL = null;
  });
}
/* an edit of the floor plate (plate-frame points): written to the floors' own plate - made from the block's when they have none */
function editPlate(fn) {
  const x = cur(); if (!x || !LAST || !C.can()) return;
  snapF(x);
  const g = x.b.groups[x.gi], f = g.floor = g.floor || {};
  if (!f.frame) f.frame = LAST.frameAxis;
  const pts = fn(LAST.F.poly.map((p) => p.slice()));
  if (!pts || pts.length < 3) return;
  // the frame's origin is the plate's lowest corner: when that moves, move what is stored with it, and the view, so nothing jumps
  const du = -Math.min(...pts.map((p) => p[0])), dv = -Math.min(...pts.map((p) => p[1]));
  // the layout as it is seen held in place (the core's pieces, each unit at its x), so the plate's edit does not reflow it
  if (!Array.isArray(f.pieces) || !f.pieces.length) f.pieces = JSON.parse(JSON.stringify(LAST.coreOut));
  const freeze = (l) => {
    const seq = { s: [], n: [] };
    for (const band of ["s", "n"]) for (const q of l.r.placed.filter((o) => o.band === band).sort((a2, b2) => a2.si - b2.si)) seq[band].push(Object.assign({ u: (q.entry && q.entry.u) || q.name, m: q.m }, q.r ? { r: q.r } : {}, { x: R3(q.x - l.A[0]) }));
    return seq;
  };
  if (MULTI()) f.legSeq = legs().map(freeze);
  else {
    if (f.corrY == null) f.corrY = LAST.y0;
    const seq = freeze(legs()[0]);
    for (const q of LAST.left || []) seq.s.push({ u: (q.u && q.u.name) || "", m: false });   // those not placed stay in the list
    if (LAST.placed.length) f.seq = seq;
  }
  FC.shiftFrame(f, du, dv);
  if (du || dv) { X0 += du; Y0 += dv; }
  VIEWKEY = cur() ? cur().key : "";
  const own = !!(g.fp && g.fp.length >= 3);
  g.fp = C.S.fromXY(pts.map((p) => LAST.F.from(p)), x.o);
  if (!own) toast("These floors now have their own floor plate (▱ in Massing); the block's footprint is unchanged");
  snapF(x); C.save(); render();
}
/* the placed unit's entry in its leg's edited order */
const entryOf = (q) => ({ band: q.band, i: q.si, leg: q.leg || 0 });

/* ---------- 3D */
async function draw3d() {
  const host = $("#st-f3d");
  host.hidden = !(ON && VIEW === "3d");
  $("#st-fplan").hidden = !ON || VIEW === "3d";
  mountBars();
  if (host.hidden) { const F3 = await import("./floor3d.js"); F3.hide(); return; }
  const x = cur();
  if (!LAST || !x) return;
  const F3 = await import("./floor3d.js");
  await F3.show(host, LAST, { storeys: x.g.n, storeyH: Number(x.g.h) || FC.DEF.storeyH, show: pref("fl-3dshow", "all") });
}
export function show(on) {
  ON = on;
  $("#st-fpanel").hidden = !on;
  $("#st-fplan").hidden = !on || VIEW === "3d";
  if (!on && $("#st-f3d")) $("#st-f3d").hidden = true;
  document.body.classList.toggle("st-floors", on);
  if (on) render(); else PT.unmount("floors");
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

/* timings (?debug=floors: also in the console) */
const DEBUG = /[?&]debug=floors\b/.test(location.search);
const TIMES = (window.__floorsT = {});
function timed(name, fn) {
  const t0 = performance.now(), v = fn(), dt = performance.now() - t0;
  TIMES[name] = Math.round(dt * 10) / 10; TIMES[name + "#"] = (TIMES[name + "#"] || 0) + 1;
  if (DEBUG && dt > 4) console.log(`[floors] ${name} ${dt.toFixed(1)} ms`);
  return v;
}
/* the layout, kept for the same input: a selection or a redraw lays nothing out again, and carry's trials are reused */
const LCACHE = new Map();
function layoutOf(inp) {
  const keys = Object.keys(inp).filter((k) => inp[k] != null && k !== "lib" && k !== "mix").sort();
  // the units it can use: only those named in it (the whole library is large)
  const names = new Set((inp.mix || []).map((q) => q.u && q.u.name));
  for (const sq of [inp.seq, ...(inp.legSeq || [])]) if (sq) for (const e of [...(sq.s || []), ...(sq.n || [])]) names.add(e.u);
  const key = JSON.stringify(keys.map((k) => [k, inp[k]])) + "|" + JSON.stringify((inp.mix || []).map((q) => [q.u, q.n])) + "|" + JSON.stringify((inp.lib || []).filter((u) => names.has(u.name)));
  if (LCACHE.has(key)) { const r = LCACHE.get(key); LCACHE.delete(key); LCACHE.set(key, r); return r; }
  const r = timed("layout", () => FC.layoutLegs(inp));
  LCACHE.set(key, r); while (LCACHE.size > 12) LCACHE.delete(LCACHE.keys().next().value);
  return r;
}
function compute(x) {
  const list = units(), mix = [];
  for (const q of x.g.mix || []) { const u = list.find((v) => v.name === q.u); if (u) mix.push({ u, n: Number(q.n) || 0 }); }
  const o = opts(x);
  const r = layoutOf(Object.assign({}, o, { poly: x.fp, mix, lib: list, storeys: Number(x.g.n) || 1, floorsAbove: x.top || Number(x.g.n) || 1 }));
  // a selection by the stored piece: its place in the new core
  if (r && CSEL && typeof CSEL === "object") { const k = r.core.findIndex((c, ci) => (c.pi != null ? c.pi : ci) === CSEL.pi); CSEL = k >= 0 ? k : null; }
  return r;
}

/* every domestic group with its typical floor laid out (5 · Mix): [{x, r | null, mix: [{u, n}]}] */
export function layouts() {
  if (!C) return [];
  const list = units();
  return groups().map((x) => {
    const mix = [];
    for (const q of x.g.mix || []) { const u = list.find((v) => v.name === q.u); if (u) mix.push({ u, n: Number(q.n) || 0 }); }
    const hand = !!((x.g.floor || {}).seq || (x.g.floor || {}).legSeq);
    let r = null;
    if (mix.length || hand) { try { r = layoutOf(Object.assign({}, opts(x), { poly: x.fp, mix, lib: list, storeys: Number(x.g.n) || 1, floorsAbove: x.top || Number(x.g.n) || 1 })); } catch (e) { r = null; } }
    return { x, r, mix };
  });
}
/* open a group (from 5 · Mix) */
export function select(key) { SEL = key; if (ON) render(); }

/* ---------- the panel: the figures, the checks, the settings */
function render() { return timed("render", render0); }
function render0() {
  if (!ON) return;
  const P = $("#st-fpanel"), list = groups(), x = cur(list), can = C.can(), dis = can ? "" : " disabled";
  if (!x) {
    P.innerHTML = `<div class="st-card"><h3>4 · Floors</h3><p class="st-note">Draw a block in <b>2 · Massing</b> with a domestic floor group, and give it a <b>unit mix</b> (units from <b>3 · Units</b>). Its typical floor is laid out here.</p></div>`;
    $("#st-fplan").innerHTML = `<div class="un-empty">No domestic floor group yet.</div>`;
    LAST = null; PT.unmount("floors"); return;
  }
  SEL = x.key;
  const r = LAST = compute(x), o = opts(x);
  const num = (k, step, v, ttl, w = 56) => { const len = step < 1 && step !== 0.5; const val = len && v !== "" && v != null && !isNaN(v) ? Number(v).toFixed(3) : v; return `<input type="number" step="${len ? 0.001 : step}" data-fo="${k}" value="${esc(val)}" title="${esc(ttl)}" style="width:${w}px"${dis}>`; };
  const mixTxt = (x.g.mix || []).map((q) => `${esc(q.u)} × ${esc(q.n)}`).join(", ") || "no unit mix: add one in 2 · Massing";
  let h = `<div class="st-card"><h3>4 · Floors <small>a typical floor</small></h3>
    <label class="st-lbl">Floor group <select data-fsel>${list.map((q) => `<option value="${esc(q.key)}"${q.key === x.key ? " selected" : ""}>${esc(q.label)}</option>`).join("")}</select></label>
    <p class="st-note">${mixTxt} · ${x.g.n} floors at ${f3(Number(x.g.h))} m</p></div>`;
  if (!r) { P.innerHTML = h + `<div class="st-card"><p class="st-note">This floor group has no floor plate.</p></div>`; drawPlan(); return; }
  // Massing follows: the group's GFA % kept to the layout's (its floor GFA over its plate)
  const follow = !(x.g.floor && x.g.floor.follow === false) && (x.g.mix || []).length > 0;
  if (follow && can && r.figures.acc != null && (x.g.accFrom !== "floors" || Math.abs(Number(x.g.acc) - Math.round(r.figures.acc * 10) / 10) > 0.05)) {
    x.b.groups[x.gi].acc = Math.round(r.figures.acc * 10) / 10; x.b.groups[x.gi].accFrom = "floors"; C.save();
  }
  const F = r.figures, accNow = x.g.acc == null || x.g.acc === "" ? (M.USES[x.g.use] || M.USES.dom).acc : Number(x.g.acc);
  const open = (k, d) => (pref("fl-card-" + k, d ? "1" : "0") === "1" ? " open" : "");
  h += `<div class="st-card"><div class="st-bigs"><div class="st-big"><b>${F.units}</b><span>flats a floor</span></div><div class="st-big"><b>${f1(F.gfa)} m²</b><span>floor GFA</span></div><div class="st-big"><b>${f1(F.acc)}%</b><span>GFA ÷ plate (Massing ${f1(accNow)}%)</span></div>${F.efficiency != null ? `<div class="st-big"><b>${f1(F.efficiency)}%</b><span>saleable ÷ GFA</span></div>` : ""}</div>
    ${can ? `<div class="st-row"><label class="st-chk" title="Massing's GFA % for these floors kept to this layout's, as it changes"><input type="checkbox" data-ffollow${follow ? " checked" : ""}> Massing follows 4 · Floors</label>${follow ? "" : `<button type="button" class="primary st-ib" data-fuse title="Set the group's GFA % to the layout's">Use ${f1(F.acc)}% in Massing</button>`}</div>` : ""}
    ${r.note ? `<p class="st-note warn">${esc(r.note)}. <button type="button" class="ghost st-ib" data-freset>Reset to the mix</button></p>` : ""}
    <details data-card="fig"${open("fig", false)}><summary>Areas</summary>
    <table class="ms-fig">
      <tr><td>Floor plate</td><td>${f1(F.plate)} m²</td><td>${f3(r.L)} × ${f3(r.D)} m${r.multi ? ` · ${r.legs.length} legs` : ""}</td></tr>
      <tr><td>Units (GFA)</td><td>${f1(F.unitGfa)} m²</td><td>saleable ${f1(F.saleable)} m²</td></tr>
      <tr><td>Corridor</td><td>${f1(F.corridor)} m²</td><td>${f3(r.cw)} m wide</td></tr>
      <tr><td>Wider corridor exempt</td><td>${f1(F.wideEx)} m²</td><td>JPN 1</td></tr>
      <tr><td>Wider lift lobby exempt</td><td>${f1(F.lobbyEx)} m²</td><td>JPN 1</td></tr>
      <tr><td>Staircases</td><td>${f1(F.stair)} m²</td><td>${r.nS} × ${o.stairWidth} mm · ${r.stair.risers}R@${Math.round(r.stair.riser * 1000)} · ${Math.round(r.stair.going * 1000)}G</td></tr>
      <tr><td>Lift shafts</td><td>${f1(F.lift)} m²</td><td>${r.nL} lifts</td></tr>
      ${F.lobby ? `<tr><td>Protected lobbies</td><td>${f1(F.lobby)} m²</td><td>in the GFA</td></tr>` : ""}
      <tr><td>Core and floor walls</td><td>${f1(F.coreWalls)} m²</td><td></td></tr>
      <tr><td>Party walls</td><td>${f1(F.partyWalls)} m²</td><td></td></tr>
      <tr><td>Refuse room</td><td>${f1(F.refuse)} m²</td><td>exempt</td></tr>
      <tr><td>E&M riser</td><td>${f1(F.riser)} m²</td><td>exempt</td></tr>
      <tr><td>Residual → E&M</td><td>${f1(F.residual)} m²</td><td>${F.plate && F.residual / F.plate > 0.1 ? `<b class="bad">${f0(F.residual / F.plate * 100)}% of the plate</b>` : "check its use"}</td></tr>
      <tr><td>Units' concessions</td><td>${f1(F.unitEx)} m²</td><td>balcony, UP, A/C, façade</td></tr>
      ${F.mic ? `<tr><td>MiC</td><td>${f1(F.mic)} m²</td><td>${o.micPct}% (JPN 8)</td></tr>` : ""}
    </table></details></div>`;
  h += targetCard(x, r, can, open);
  h += `<details class="st-card" data-card="chk"${open("chk", true)}><summary><b>Checks</b> <small>${r.checks.filter((c) => !c.ok).length ? `<span class="bad">${r.checks.filter((c) => !c.ok).length} to look at</span>` : "all clear"}</small></summary><ul class="fl-checks">${r.checks.map((c) => `<li class="${c.ok ? "ok" : "bad"}"><b>${c.ok ? "✓" : "✗"} ${esc(c.what)}</b><br><small>${esc(c.text)}</small></li>`).join("")}</ul>
    ${r.left.length ? `<ul class="un-warn">${[...new Set(r.left.map((q) => q.why))].map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}</details>`;
  h += `<details class="st-card" data-card="set"${open("set", false)}><summary><b>Core and corridor</b></summary><div class="fl-set">
    <label>Corridor ${num("corridor", 0.05, o.corridor, "Clear width, m")} m</label>
    <label>Fit plate: gaps under ${num("fitGap", 0.05, o.fitGap != null && o.fitGap !== "" ? o.fitGap : 0.5, "Fit the plate: gaps and notches narrower than this are closed (m)", 56)} m closed</label>
    <label>Core <select data-fo="core"${dis}><option value="middle"${o.core === "middle" ? " selected" : ""}>in the middle</option><option value="ends"${o.core === "ends" ? " selected" : ""}>staircases at the ends</option><option value="behind"${o.core === "behind" ? " selected" : ""}>staircase behind the lifts</option></select></label>
    <label>Staircase <select data-fo="stairType"${dis}><option value="dogleg"${o.stairType === "dogleg" ? " selected" : ""}>dog-leg</option><option value="dogleg2"${o.stairType === "dogleg2" ? " selected" : ""}>dog-leg, 2 risers on the half landing</option><option value="scissor"${o.stairType === "scissor" ? " selected" : ""}>scissor</option></select></label>
    <label><input type="checkbox" data-fo="lobby"${o.lobby ? " checked" : ""}${dis}> Protected lobby ${num("lobbyDepth", 0.05, o.lobbyDepth, "m, its clear depth", 56)} m</label>
    <label>Staircases ${num("stairs", 1, o.stairs, "How many", 44)} × ${num("stairWidth", 50, o.stairWidth, "Width, mm", 64)} mm · R ≤ ${num("riser", 0.005, o.riser, "riser, m (MoE: 0.175 at most)", 56)} G ${num("going", 0.005, o.going, "going, m (MoE: 0.225 at least)", 56)}</label>
    <label>Walls: core ${num("coreWall", 0.025, o.coreWall, "m, round the staircases, lifts, refuse room, riser", 56)} · party ${num("partyWall", 0.025, o.partyWall, "m, between units", 56)} m <small>(each can be set on its own)</small></label>
    <label>Grid ${num("gridX", 0.1, o.gridX || "", "m along the corridor (1, 2, 3 …); empty: no grid", 50)} × ${num("gridY", 0.1, o.gridY || "", "m across (A, B, C …)", 50)} m · offset ${num("gridOX", 0.1, o.gridOX || "", "m", 46)} / ${num("gridOY", 0.1, o.gridOY || "", "m", 46)}</label>
    <label>Lifts ${num("lifts", 1, o.lifts || "", "Leave empty: by service time", 44)} <small>auto ${r.lifts.n}</small> · persons a flat ${num("persons", 1, o.persons || "", "Leave empty: from each flat's usable floor area", 44)}</label>
    <label>5-min capacity ${num("hc5", 0.5, o.hc5, "% of the population", 44)}% · interval ≤ ${num("interval", 5, o.interval, "s", 44)} s</label>
    <label>JPN 1 corridor ${num("wideBase", 0.05, o.wideBase, "m: exempt over this width", 50)} – ${num("wideMax", 0.05, o.wideMax, "m: up to this width", 50)} · lift lobby ${num("lobbyMin", 0.05, o.lobbyMin, "m", 50)} – ${num("lobbyMax", 0.05, o.lobbyMax, "m", 50)} m</label>
    <label><input type="checkbox" data-fo="corners"${o.corners ? " checked" : ""}${dis}> Corner units at the ends</label>
    <label><input type="checkbox" data-fo="mic"${o.mic ? " checked" : ""}${dis}> MiC (JPN 8) ${num("micPct", 0.5, o.micPct, "% of the GFA, check", 44)}%</label>
    </div>
    <p class="st-note">Lifts: round trip ${r.lifts.rtt} s, ${r.lifts.population} persons (CIBSE Guide D). Staircases: Table B1 / B3.</p></details>`;
  P.innerHTML = h;
  drawPlan();
  if (VIEW === "3d") draw3d();
}

/* the target mix: shares by type, a number of flats a floor (or as many as fit); filled, and how near the layout comes */
function targetCard(x, r, can, open) {
  const T = (x.g.floor && x.g.floor.target) || {}, sh = T.shares || {}, dis = can ? "" : " disabled";
  const got = {}, n = r.placed.length; for (const q of r.placed) { const k = FC.unitType(q.u); got[k] = (got[k] || 0) + 1; }
  const tot = FC.MIX_TYPES.reduce((s2, [k]) => s2 + (Number(sh[k]) || 0), 0), has = tot > 0;
  const lib = units(), avail = new Set(lib.map((u) => FC.unitType(u)));
  const rows = FC.MIX_TYPES.map(([k, lab]) => {
    const want = has ? (Number(sh[k]) || 0) / tot * 100 : null, now = n ? (got[k] || 0) / n * 100 : 0, d = want == null || (sh[k] == null && !got[k]) ? null : now - want;
    return `<tr><td>${esc(lab)}${avail.has(k) ? "" : ' <small class="muted" title="No unit of this type in 3 · Units">(none in Units)</small>'}</td><td><input type="number" min="0" max="100" step="5" data-ftg="${k}" value="${sh[k] != null ? esc(sh[k]) : ""}" style="width:52px"${dis}>%</td><td>${got[k] || 0} <small>(${f0(now)}%)</small></td><td>${d == null ? "" : `<b class="${Math.abs(d) <= 100 / Math.max(1, n) + 0.01 ? "good" : "bad"}">${d >= 0 ? "+" : ""}${f0(d)}%</b>`}</td></tr>`;
  }).join("");
  const sale = r.placed.reduce((s2, q) => s2 + ((q.fig && q.fig.saleable) || 0), 0), fl = Number(x.g.n) || 1;
  return `<details class="st-card" data-card="tgt"${open("tgt", false)}><summary><b>Target mix</b> <small>${has ? `${n} flats a floor` : "shares by type"}</small></summary>
    <table class="ms-fig fl-tgt"><tr><th></th><th>target</th><th>laid out</th><th>Δ</th></tr>${rows}</table>
    <div class="st-row"><label>Flats a floor <input type="number" min="1" step="1" data-ftg="n" value="${T.n != null ? esc(T.n) : ""}" placeholder="most" title="Empty: as many as fit" style="width:60px"${dis}></label>${can ? `<button type="button" class="primary st-ib" data-ffill${has ? "" : " disabled"} title="Choose the unit mix to meet the shares (from the units of each type in the mix, else from 3 · Units) and lay the floor out again">Fill to target</button>` : ""}</div>
    <p class="st-note">Yield: ${n} × ${fl} floors = <b>${f0(n * fl)} flats</b> · ${f0(sale * fl)} m² saleable · ${n ? f1(sale / n) : "–"} m² on average · GFA ${f0(r.figures.gfa * fl)} m²</p></details>`;
}
/* the mix chosen for the target and laid out: so many flats, or as many as fit (one more until one is left over) */
function fillTarget() {
  const x = cur(); if (!x || !LAST || !C.can()) return;
  const T = (x.g.floor && x.g.floor.target) || {}, lib = units();
  const tryN = (k) => { const mix = FC.mixForTarget(lib, T.shares, k, x.g.mix); const m2 = []; for (const q of mix) { const u = lib.find((v) => v.name === q.u); if (u) m2.push({ u, n: q.n }); } const r = layoutOf(Object.assign({}, opts(x), { poly: x.fp, mix: m2, lib, storeys: Number(x.g.n) || 1, floorsAbove: x.top || Number(x.g.n) || 1, seq: null, legSeq: null })); return { mix, r }; };
  let best;
  if (Number(T.n) > 0) best = tryN(Number(T.n));
  else {
    // as many as fit: down from the flats now until all of them fit, then up one at a time while they still do
    const fits = (t, k) => t.r && !(t.r.left && t.r.left.length) && t.r.placed.length >= k;
    let k = Math.max(1, LAST.placed.length); best = tryN(k);
    while (k > 1 && !fits(best, k)) { k--; best = tryN(k); }
    for (let i = 0; i < 30 && fits(best, k); i++) { const nx = tryN(k + 1); if (!fits(nx, k + 1)) break; best = nx; k++; }
  }
  if (!best.mix.length) return toast("No unit of the types asked for: add one in 3 · Units", true);
  snapF(x);
  const g = x.b.groups[x.gi], f = g.floor = g.floor || {};
  g.mix = best.mix; delete f.seq; delete f.legSeq; delete f.corrY;
  snapF(x); C.save(); clearSel(); render();
  toast(`Mix set: ${best.mix.map((q) => `${q.u} × ${q.n}`).join(", ")}`);
}
function setTarget(k, v) {
  const x = cur(); if (!x || !C.can()) return;
  const g = x.b.groups[x.gi], f = g.floor = g.floor || {}, T = f.target = f.target || { shares: {} };
  T.shares = T.shares || {};
  if (k === "n") { if (v === "" || !(Number(v) > 0)) delete T.n; else T.n = Math.round(Number(v)); }
  else if (v === "" || v == null) delete T.shares[k]; else T.shares[k] = Math.max(0, Number(v));
  C.save(); render();
}

function onChange(ev) {
  const t = ev.target, list = groups(), x = cur(list);
  if (t.dataset.ftg != null) return setTarget(t.dataset.ftg, t.value);
  if (t.dataset.fsel != null) { SEL = t.value; clearSel(); PZ.reset(ZM); return render(); }
  if (t.dataset.ffollow != null && x && C.can()) { const g = x.b.groups[x.gi], f = g.floor = g.floor || {}; if (t.checked) delete f.follow; else { f.follow = false; delete g.accFrom; } C.save(); return render(); }
  if (!x || !C.can()) return;
  const k = t.dataset.fo; if (!k) return;
  setFloor(k, t.type === "checkbox" ? t.checked : t.value);
}
/* a floor setting changed (from the panel or the property bar) */
function setFloor(k, v) {
  const x = cur(); if (!x || !C.can()) return;
  const g = x.b.groups[x.gi], f = g.floor = g.floor || {};
  snapF(x);
  if (k === "mic" || k === "corners" || k === "lobby") f[k] = !!v;
  else if (k === "core" || k === "stairType") f[k] = v;
  else if (v === "" || v == null) delete f[k];
  else f[k] = Math.max(0, parseFloat(v));
  snapF(x); C.save(); render();
}
function onClick(ev) {
  const d = ev.target.closest("details[data-card]");
  if (d && ev.target.closest("summary")) setTimeout(() => setPref("fl-card-" + d.dataset.card, d.open ? "1" : "0"), 0);
  const t = ev.target.closest("button"); if (!t) return;
  if (t.dataset.freset != null) return resetFloor();
  if (t.dataset.ffill != null) return fillTarget();
  if (t.dataset.fuse != null && LAST) {
    const x = cur(); if (!x) return;
    x.b.groups[x.gi].acc = Math.round(LAST.figures.acc * 10) / 10;
    C.save(); toast(`GFA % ${x.b.groups[x.gi].acc} set on the floor group in Massing`); render();
  }
}
function resetFloor() { editFloor((f) => { delete f.seq; delete f.legSeq; delete f.corrY; }); clearSel(); }

/* ---------- exports: the floor as DXF (plan metres, Y up), the unit and area schedules as Excel */
function exportMenu() {
  const b = document.querySelector('#st-fplan [data-pt="export"], [data-pt="export"]'), r0 = b ? b.getBoundingClientRect() : { left: 400, bottom: 120 };
  PT.ctx({ preventDefault() {}, clientX: r0.left, clientY: r0.bottom + 4 }, [
    { label: "Floor plan as DXF (AutoCAD / Revit)", action: () => exportDxf("dxf") },
    { label: "Floor plan as DWG", action: () => exportDxf("dwg") },
    "-",
    { label: "Unit and area schedules (Excel)", action: () => exportXlsx() },
  ]);
}
/* the floor's entities in plan metres, each on its layer (Y up for CAD) */
function floorEnts() {
  const r = LAST, E = [], Y = (p) => [Math.round(p[0] * 1000) / 1000, Math.round(-p[1] * 1000) / 1000];
  const pl = (l, pts, closed = true) => E.push({ t: "pl", l, p: pts.map(Y), closed });
  const rect = (l, L, x0, y0, x1, y1) => pl(l, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map((q) => fromLeg(L, q)));
  const txt = (l, p, h, s2, rot = 0) => E.push({ t: "text", l, p: Y(p), h, s: s2, a: "c", v: "m", r: rot });
  pl("A-SLAB-OUTL", r.F.poly);
  pl("A-CORR", WC.wallPoly(r.spine.path, r.cw, "c"));
  for (const L of legs()) {
    const lr = L.r, ang = -(L.xf.ang || 0) * 180 / Math.PI;
    for (const q of lr.placed) {
      for (const rm of q.rooms) rect("A-AREA-ROOM", L, q.x + rm.x, q.y + rm.y, q.x + rm.x + rm.w, q.y + rm.y + rm.h);
      for (const e of q.extras || []) rect("A-AREA-BAL", L, q.x + e.x, q.y + e.y, q.x + e.x + e.w, q.y + e.y + e.h);
      for (const w of FC.placedWalls(q).rects) rect(w.m === "blk" ? "A-WALL-BLK" : "A-WALL-RC", L, w.x0, w.y0, w.x1, w.y1);
      const loc = (q.doors || []).length ? FC.placedWalls(q, { x: 0, y: 0 }).rects : [];
      for (const d0 of q.doors || []) { const { d } = FC.doorOnWall(d0, loc, q.wt || 0.15), H = [q.x + d.H[0], q.y + d.H[1]], O = [q.x + d.O[0], q.y + d.O[1]], w = Math.hypot(O[0] - H[0], O[1] - H[1]); E.push({ t: "line", l: "A-DOOR", p: [Y(fromLeg(L, H)), Y(fromLeg(L, [H[0] + d.sn[0] * w, H[1] + d.sn[1] * w]))] }); }
      for (const fx of q.fixtures || []) { const rq = fx.rot === 90 || fx.rot === 270, w = rq ? fx.h : fx.w, h = rq ? fx.w : fx.h, cx = q.x + fx.x + fx.w / 2, cy = q.y + fx.y + fx.h / 2; rect("A-FURN", L, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2); }
      txt("A-AREA-IDEN", fromLeg(L, [q.x + q.w / 2, q.y + q.h / 2]), 0.25, `${q.name || "Unit"} · ${(q.fig && q.fig.saleable || 0).toFixed(1)} m2`, ang);
    }
    for (const w of FC.coreWallRects(lr.core, lr.coreWall || r.coreWall || 0.25)) rect("A-WALL-CORE", L, w.x0, w.y0, w.x1, w.y1);
    for (const c of lr.core) { if (c.kind === "passage") continue; txt("A-AREA-IDEN", fromLeg(L, [c.x + c.w / 2, c.y + c.h / 2]), 0.25, c.label || c.kind, ang); for (const d of c.doors || []) E.push({ t: "line", l: "A-DOOR", p: [Y(fromLeg(L, d.H)), Y(fromLeg(L, d.O))] }); }
  }
  for (const w of r.walls || []) for (const q of w.pieces || []) pl(w.m === "blk" ? "A-WALL-BLK" : "A-WALL-RC", q);
  return E;
}
async function exportDxf(fmt) {
  const x = cur(); if (!x || !LAST) return;
  try { const { downloadCad } = await import("./sbddxf.js"); const n = await downloadCad(floorEnts(), `${x.b.name || "Block"} typical floor`, fmt); toast(`Saved the floor plan (${Math.round(n / 1024)} kB)`); }
  catch (e) { toast("No CAD file: " + e.message, true); }
}
/* the unit schedule (each unit type: areas, a floor, the group) and the area schedule (the floor's areas, the group's) */
async function exportXlsx() {
  const x = cur(); if (!x || !LAST) return;
  const r = LAST, F = r.figures, fl = Number(x.g.n) || 1, by = new Map();
  for (const q of r.placed) { const k = q.name || "Unit"; if (!by.has(k)) by.set(k, { q, n: 0 }); by.get(k).n++; }
  const r1 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
  const units = [...by.values()].map(({ q, n }) => { const f = q.fig || {}; return [q.name, FC.MIX_TYPES.find((t) => t[0] === FC.unitType(q.u))[1], r1(f.saleable), r1(f.gfa), r1(f.bal), r1(f.up), r1(f.acp), n, n * fl, r1(f.saleable * n * fl)]; });
  const tot = units.reduce((s2, u) => [s2[0] + u[7], s2[1] + u[8], s2[2] + u[9]], [0, 0, 0]);
  units.push(["TOTAL", "", "", "", "", "", "", tot[0], tot[1], r1(tot[2])]);
  const area = [["Floor plate", F.plate, F.plate * fl, ""], ["Units (GFA)", F.unitGfa, F.unitGfa * fl, ""], ["Saleable", F.saleable, F.saleable * fl, ""], ["Corridor", F.corridor, F.corridor * fl, ""],
    ["Wider corridor exempt", -F.wideEx, -F.wideEx * fl, "JPN 1"], ["Wider lift lobby exempt", -F.lobbyEx, -F.lobbyEx * fl, "JPN 1"], ["Staircases", F.stair, F.stair * fl, ""], ["Lift shafts", F.lift, F.lift * fl, ""],
    ["Protected lobbies", F.lobby, F.lobby * fl, ""], ["Core and floor walls", F.coreWalls, F.coreWalls * fl, ""], ["Party walls", F.partyWalls, F.partyWalls * fl, ""],
    ["Refuse room", F.refuse, F.refuse * fl, "exempt"], ["E&M riser", F.riser, F.riser * fl, "exempt"], ["Residual (E&M)", F.residual, F.residual * fl, "check its use"],
    ["Units' concessions (balcony, UP, A/C)", F.unitEx, F.unitEx * fl, "APP-19, APP-42"], ["GFA", F.gfa, F.gfa * fl, ""]].map((q) => [q[0], r1(q[1]), r1(q[2]), q[3]]);
  const name = `${x.b.name || "Block"} - ${x.label.replace(/^.*· /, "")} schedules`;
  const sheets = [
    { name: "Unit schedule", title: `Unit schedule · ${x.label}`, note: `${fl} floors · ${r.placed.length} flats a floor`, head: ["Unit", "Type", "Saleable m2", "GFA m2", "Balcony m2", "UP m2", "A/C m2", "A floor", "All floors", "Saleable total m2"], widths: [34, 26, 12, 12, 12, 10, 10, 10, 12, 16], rows: units },
    { name: "Area schedule", title: `Area schedule · ${x.label}`, note: "A typical floor and the floor group; exempt items as negative", head: ["Item", "A floor m2", `${fl} floors m2`, "Note"], widths: [40, 14, 16, 20], rows: area },
  ];
  try {
    const res = await fetch("/api/gbp/xlsx", { method: "POST", headers: headers(true), body: JSON.stringify({ name, sheets }) });
    if (!res.ok) { let m = "HTTP " + res.status; try { m = (await res.json()).detail || m; } catch (e) {} throw new Error(m); }
    const blob = await res.blob(), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name.replace(/[\\/:*?"<>|]+/g, "_") + ".xlsx"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Saved the schedules (Excel)");
  } catch (e) { toast("No Excel: " + e.message, true); }
}

/* ---------- the toolbar and the property bar */
function toolbarHtml() {
  const can = C.can(), T = (id, icon, title, key, extra) => Object.assign({ id, icon, title, key, on: TOOL === id }, extra || {});
  const viewG = [{ id: "v:plan", icon: "plan", title: "Plan", on: VIEW === "plan" }, { id: "v:3d", icon: "threed", title: "3D", on: VIEW === "3d" }];
  if (VIEW === "3d") return PT.toolbar([viewG, [{ id: "v:all", icon: "elev", title: "All the floors", on: pref("fl-3dshow", "all") === "all" }, { id: "v:top", icon: "plane", title: "The typical floor", on: pref("fl-3dshow", "all") === "top" }]], null, "floors");
  const G = [[T("select", "select", "Select and move", "V")]];
  if (can) {
    G.push([T("wall", "wall", "Wall: click its points, double-click or Enter to end; Tab: centre / left / right line", "W"), T("split", "split", "Cut a wall where you click", "X"), T("join", "join", "Join two walls that meet: click one, then the other", "J")]);
    G.push([T("corridor", "corridor", "Corridor: draw its centre line; it may turn at any angle", "C"), T("lobby", "passage", "Lobby / passage: draw its centre line", "L")]);
    G.push([T("unit", "unit", "Unit: choose it in the bar, then click where it goes", "U"), T("add:stair", "stair", "Staircase: click where it goes", "S"), T("add:lift", "lift", "Lift"), T("add:refuse", "refuse", "Refuse room"), T("add:riser", "riser", "E&M riser"), T("add:lobby", "lobby", "Protected lobby")]);
    G.push([{ id: "lib", icon: "library", title: "Doors, windows and openings: drag one onto a wall", key: "D", on: PT.libraryOpen() }]);
  }
  G.push([{ id: "measure", icon: "measure", title: "Measure: click two points (they snap to corners and faces; two parallel faces give the clear width); Esc clears", key: "M", on: TOOL === "measure" }, { id: "grid", icon: "grid", title: "Grid: 1 m background and the structural grid", key: "G", on: GRID() }, { id: "snap", icon: "snap", title: "Snap to edges and the grid (hold Alt: free)", on: SNAP() },
    { id: "dims", icon: "dimension", title: "Dimensions: the plate overall, the units' widths along the corridor, the corridor's clear width", on: DIMS() }, { id: "furn", icon: "fixture", title: "Fittings and furniture in the units (set in 3 · Units)", on: FURN() },
    { id: "export", icon: "export", title: "Export: the floor as DXF (AutoCAD / Revit), the unit and area schedules as Excel" },
    ...(can ? [{ id: "undo", icon: "undo", title: "Undo", key: "Ctrl+Z" }, { id: "redo", icon: "redo", title: "Redo", key: "Ctrl+Y" }, { id: "fitplate", icon: "corner", title: "Fit the plate close round the units (balconies, UP, A/C left out), the core and the corridor; gaps under the fit gap (Core and corridor) closed" }, { id: "reset", icon: "reset", title: "Reset the units to automatic", disabled: !(LAST && LAST.edited) }] : [])]);
  G.push(viewG);
  return PT.toolbar(G, null, "floors");
}
function mountBars() {
  if (!ON) return PT.unmount("floors");
  PT.mount("floors", toolbarHtml(), VIEW === "plan" && LAST && TOOL === "measure" ? measureBar() : VIEW === "plan" && C.can() && LAST ? propHtml() : "", VIEW === "plan" ? PT.OPENINGS : null);
}
const TYPES = [["door", "Door"], ["door2", "Double door"], ["sliding", "Sliding, 1 leaf"], ["sliding2", "Sliding, 2 leaves"], ["opening", "Opening"], ["panel", "Access panel"], ["window", "Window"], ["cw", "Curtain wall"]];
function measureBar() {
  const n = MEAS.list.length, last = MEAS.list[n - 1];
  return PT.propBar({ icon: "measure", text: "Measure", sub: MEAS.a ? "now the second point" : last ? `last: ${f3(last.L)} m${last.clear ? " clear (between parallel faces)" : ""}` : "click two points: corners, faces' middles, or on a face" }, [], [{ id: "m:clear", icon: "trash", title: "Clear the measures (Esc)", disabled: !n && !MEAS.a }]);
}
function propHtml() {
  const r = LAST, o = opts(cur()), x = cur();
  const acts = (list) => list.map(([id, icon, title, dis]) => ({ id, icon, title, disabled: !!dis }));
  // an opening
  if (OPSEL) {
    const op = opAt(OPSEL); if (op) {
      return PT.propBar({ icon: PT.OPEN_BY[op.type] ? PT.OPEN_BY[op.type].icon : "door", text: TYPES.find((q) => q[0] === op.type) ? TYPES.find((q) => q[0] === op.type)[1] : "Door", sub: op.where },
        [{ key: "o.type", type: "sel", label: "type", value: op.type, options: TYPES }, { key: "o.w", label: "w", value: op.w, unit: "m", step: 0.05 }],
        acts([["o:flip", "flip", "Hinge on the other side"], ["o:copy", "copy", "Copy (Ctrl+C)"], ["o:del", "trash", "Remove (Delete)"]]));
    }
  }
  if (PTSEL) {
    const own = Number(((MULTI() ? ((o.legPartyT || [])[PTSEL.leg] || {}) : (o.partyT || {})))[PTSEL.key]) || null;
    return PT.propBar({ icon: "wall", text: "Party wall" }, [{ key: "p.t", label: "thickness", value: own, ph: f3(Number(o.partyWall) || 0.2), unit: "m", title: "Its own thickness; empty: the floor's" }], []);
  }
  if (WSEL != null && r.walls[WSEL]) {
    const w = r.walls[WSEL], k = Math.min(WSEG, w.path.length - 2), a = w.path[k], b = w.path[k + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180 / Math.PI;
    return PT.propBar({ icon: "wall", text: "Wall", sub: `${f3(WC.pathLen(w.path))} m · ${w.path.length - 1} segment${w.path.length > 2 ? "s" : ""}` }, [
      { key: "w.t", label: "t", value: w.t, unit: "m", step: 0.005 },
      { key: "w.m", type: "sel", value: w.m, options: [["rc", "RC"], ["blk", "Block"]] },
      { key: "w.just", type: "seg", value: w.just, options: [["c", "justc", "Centre line"], ["l", "justl", "Left face on the line"], ["r", "justr", "Right face on the line"]] },
      { key: "w.len", label: `segment ${k + 1}`, value: len, unit: "m", title: "Its length: the end point moves" },
      { key: "w.ang", label: "∠", value: ang, unit: "°", step: 0.5, dp: 1, w: 56, title: "Its angle on the plan" },
    ], acts([["w:split", "split", "Cut it at the selected segment's middle"], ["w:copy", "copy", "Copy (Ctrl+C)"], ["w:del", "trash", "Remove (Delete)"]]));
  }
  if (SPSEL) {
    const sp = r.spine.path, lens = sp.slice(1).map((q, k) => Math.hypot(q[0] - sp[k][0], q[1] - sp[k][1]));
    const ang = (k) => Math.round(Math.atan2(-(sp[k + 1][1] - sp[k][1]), sp[k + 1][0] - sp[k][0]) * 1800 / Math.PI) / 10;
    const legF = lens.flatMap((L, k) => [{ key: "s.len." + k, label: lens.length > 1 ? `leg ${k + 1}` : "length", value: L, unit: "m", w: 64, title: "Its length: the corridor beyond it moves along" }, { key: "s.ang." + k, label: "∠", value: ang(k), unit: "°", step: 0.5, dp: 1, w: 56, title: "Its direction on the plan: the corridor beyond it turns" }]);
    const bendF = SPPT != null && SPPT > 0 && SPPT < sp.length - 1 ? [{ key: "s.bend." + SPPT, label: `bend ${SPPT}`, value: bendAt(sp, SPPT), unit: "°", step: 0.5, dp: 1, w: 56, title: "The angle between the two legs at this bend (180°: straight on)" }] : [];
    return PT.propBar({ icon: "corridor", text: "Corridor", sub: r.multi ? `${r.legs.length} legs` : "drag it across, or its + to bend it" }, [
      { key: "f.corridor", label: "width", value: o.corridor, unit: "m", step: 0.05 }, ...legF, ...bendF,
      ...(r.multi ? [{ key: "s.coreLeg", type: "sel", label: "core in", value: r.coreLeg, options: r.legs.map((l) => [l.k, "leg " + (l.k + 1)]) }] : []),
    ], acts([["s:bend", "bend", "Add a bend in the longest leg's middle; drag it out"], ["s:straight", "reset", "Back to one straight corridor", !(x.g.floor || {}).spine]]));
  }
  if (VSEL != null && r.F.poly[VSEL]) {
    const p = r.F.poly[VSEL], nx = r.F.poly[(VSEL + 1) % r.F.poly.length];
    return PT.propBar({ icon: "corner", text: "Plate corner " + (VSEL + 1) }, [{ key: "v.x", label: "x", value: p[0], unit: "m" }, { key: "v.y", label: "y", value: p[1], unit: "m" }, { key: "v.len", label: "edge", value: Math.hypot(nx[0] - p[0], nx[1] - p[1]), unit: "m", title: "To the next corner: the next corner moves" }],
      acts([["vx:del", "trash", "Remove the corner (Delete)", r.F.poly.length <= 3]]));
  }
  if (CSEL != null && typeof CSEL === "number" && r.core[CSEL]) {
    const c = r.core[CSEL], cw0 = r.coreWall || 0.25, t = Number(c.wt) > 0 ? Number(c.wt) : cw0, dr = c.door || {};
    if (c.kind === "passage") {
      return PT.propBar({ icon: "passage", text: c.label || "Passage", sub: c.for ? (c.auto !== false ? `follows ${c.for}'s door` : "drawn by hand") : "" }, [{ key: "c.pw", label: "width", value: c.width || 1.2, unit: "m" }],
        acts([["c:bend", "bend", "Add a bend: drag it out for an L or a Z"], ["c:unbend", "undo", "Take off the last bend", (c.path || []).length <= 2], ...(c.for ? [["c:reroute", "route", `From ${c.for}'s door to the corridor again`, c.auto !== false]] : []), ["c:copy", "copy", "Copy"], ["c:del", "trash", "Remove"]]));
    }
    const F = [
      { key: "c.cw", label: "clear", value: c.w - 2 * t, unit: "×", title: "Clear width inside its walls" }, { key: "c.ch", value: c.h - 2 * t, unit: "m", title: "Clear depth inside its walls" },
      { key: "c.wt", label: "wall", value: Number(c.wt) > 0 ? Number(c.wt) : null, ph: f3(cw0), unit: "m", title: "Its own wall; empty: the core's" },
      { key: "c.door", type: "sel", label: "door", value: dr.side || "", options: [["", "auto"], ["n", "top"], ["e", "right"], ["s", "bottom"], ["w", "left"]], title: "The face its door is on; drag the door along the wall to move it" },
    ];
    if (c.kind === "stair") F.push({ key: "f.stairType", type: "sel", value: o.stairType, options: [["dogleg", "dog-leg"], ["dogleg2", "dog-leg, 2R landing"], ["scissor", "scissor"]] }, { key: "f.stairWidth", label: "w", value: o.stairWidth, unit: "mm", step: 50, w: 60 }, { key: "f.riser", label: "R ≤", value: o.riser, step: 0.005, w: 60 }, { key: "f.going", label: "G ≥", value: o.going, step: 0.005, w: 60 }, { key: "", type: "read", value: `${r.stair.risers} risers · ${r.stair.t1}+${r.stair.t2} treads` });
    if (r.multi) F.push({ key: "c.leg", type: "sel", label: "leg", value: c.leg || 0, options: r.legs.map((l) => [l.k, String(l.k + 1)]) });
    return PT.propBar({ icon: c.kind === "riser" ? "riser" : c.kind, text: c.label, sub: `${f3(c.w)} × ${f3(c.h)} m` }, F,
      acts([["c:rot", "rotate", "Turn it 90°"], ["c:swap", "flip", "Swap with … (then click the other)"], ["add:lift", "lift", "+ Lift beside the last"], ["c:copy", "copy", "Copy (Ctrl+C)"], ["c:del", "trash", "Remove (Delete)"], ["c:reset", "reset", "Reset the core to automatic", !r.coreEdited]]));
  }
  if (PSEL != null && r.placed[PSEL]) {
    const q = r.placed[PSEL], l = legK(q.leg || 0);
    return PT.propBar({ icon: "unit", text: q.name, sub: `${f1(q.fig.saleable)} m² saleable${q.flags && q.flags.length ? " · " + q.flags[0] : ""}` }, [
      { key: "u.type", type: "sel", pick: "unit", label: "type", value: q.entry.u || q.name, options: units().map((u) => [u.name, u.name]) },
      { key: "u.x", label: "at", value: q.x - l.A[0], unit: "m", title: "Along the corridor from its start" },
      { key: "u.side", type: "seg", value: q.band, options: [["n", "↑", "This side of the corridor"], ["s", "↓", "The other side"]] },
    ], acts([["u:flip", "mirror", "Mirror it"], ["u:rot", "rotate", "Turn it 90°"], ["u:swap", "flip", "Swap with … (then click the other)"], ...(q.fixed ? [["u:free", "align", "Back into the row along the corridor"]] : []), ["u:edit", "edit", "Edit this unit type in place"], ["u:variant", "copy", "A variant for this flat only"], ["u:del", "trash", "Remove (Delete)"]]));
  }
  // nothing selected: the tool's own settings
  if (TOOL === "wall") return PT.propBar({ icon: "wall", text: "Wall", sub: WALLDRAW && WALLDRAW.typed ? `length ${WALLDRAW.typed} m - Enter` : "click points · type a length · Enter" }, [
    { key: "t.t", label: "t", value: WT().t || Number(o.coreWall) || 0.25, unit: "m", step: 0.005 }, { key: "t.m", type: "sel", value: WT().m, options: [["rc", "RC"], ["blk", "Block"]] },
    { key: "t.just", type: "seg", value: WT().just, options: [["c", "justc", "Centre line (Tab)"], ["l", "justl", "Left face on the line"], ["r", "justr", "Right face on the line"]] }], []);
  if (TOOL === "corridor" || TOOL === "lobby") return PT.propBar({ icon: TOOL === "corridor" ? "corridor" : "passage", text: TOOL === "corridor" ? "Corridor" : "Lobby / passage", sub: "click points along its middle · Enter to end" }, [{ key: "f.corridor", label: "width", value: o.corridor, unit: "m", step: 0.05 }], []);
  if (TOOL === "unit") return PT.propBar({ icon: "unit", text: "Add a unit", sub: "click beside the corridor" }, [{ key: "t.unit", type: "sel", pick: "unit", value: ADDU() || (units()[0] || {}).name, options: units().map((u) => [u.name, u.name]) }], []);
  if (TOOL.startsWith("add:")) return PT.propBar({ icon: TOOL.slice(4), text: "Add " + ({ stair: "a staircase", lift: "a lift", refuse: "a refuse room", riser: "an E&M riser", lobby: "a protected lobby" }[TOOL.slice(4)]), sub: "click where it goes" }, [], []);
  if (TOOL === "split") return PT.propBar({ icon: "split", text: "Cut a wall", sub: "click it where it is to be cut" }, [], []);
  if (TOOL === "join") return PT.propBar({ icon: "join", text: "Join walls", sub: JOINA != null ? "now click the wall to join it to" : "click the first wall" }, [], []);
  const F2 = r.figures;
  return PT.propBar({ icon: "plan", text: `${F2.units} flats`, sub: `GFA ${f1(F2.gfa)} m² · ${f1(F2.acc)}% of the plate · right-click for more` }, [], []);
}

/* the opening selected: {type, w, where} */
function opAt(s) {
  const r = LAST;
  if (s.wi != null) { const w = r.walls[s.wi], o = w && (w.openings || [])[s.oi]; return o ? { type: o.type || "door", w: Number(o.w) || 0.9, where: "in a wall" } : null; }
  const c = r.core[s.ci], d = c && (c.doors || [])[s.di]; if (!d) return null;
  return { type: d.type || (d.slide ? "sliding2" : "door"), w: d.w, where: c.label };
}

function onTool(id) {
  if (id.startsWith("v:")) {
    const v = id.slice(2);
    if (v === "all" || v === "top") { setPref("fl-3dshow", v); return draw3d(); }
    VIEW = v; setPref("fl-view", VIEW); if (VIEW === "plan") { $("#st-f3d").hidden = true; $("#st-fplan").hidden = false; drawPlan(); } return draw3d();
  }
  if (id === "lib") { PT.toggleLibrary(); return drawPlan(); }
  if (id === "measure") { setTool(TOOL === "measure" ? "select" : "measure"); return drawPlan(); }
  if (id === "m:clear") { ME.clear(MEAS); return drawPlan(); }
  if (id === "grid") { setPref("fl-grid", GRID() ? "off" : "on"); return drawPlan(); }
  if (id === "dims") { setPref("fl-dims", DIMS() ? "off" : "on"); mountBars(); return drawPlan(); }
  if (id === "furn") { setPref("fl-furn", FURN() ? "off" : "on"); mountBars(); return drawPlan(); }
  if (id === "export") return exportMenu();
  if (id === "snap") { setPref("fl-snap", SNAP() ? "off" : "on"); return drawPlan(); }
  if (id === "undo") return undo(-1);
  if (id === "redo") return undo(1);
  if (id === "fitplate") return fitPlate();
  if (id === "reset") return resetFloor();
  if (/^(select|wall|split|join|corridor|lobby|unit|add:\w+)$/.test(id)) return setTool(TOOL === id && id !== "select" ? "select" : id);
  // the property bar's buttons
  const [k, a] = id.split(":");
  if (k === "u") return unitAction(a);
  if (k === "c") return coreAction(a);
  if (k === "w") {
    if (a === "del") return delSel();
    if (a === "copy") return copySel(false);
    if (a === "split") { const w = LAST.walls[WSEL], s2 = WC.segLen(w.path, WSEG) / 2; return editWalls((A) => { const parts = WC.splitWall(A[WSEL], WSEG, s2); A.splice(WSEL, 1, ...parts); return WSEL; }); }
  }
  if (k === "o") {
    if (a === "del") return delSel();
    if (a === "copy") return copySel(false);
    if (a === "flip") return editOpening((o) => { o.hinge = o.hinge === "end" ? "start" : "end"; });
  }
  if (k === "vx" && a === "del") return removeCorner(VSEL);
  if (k === "s") {
    if (a === "straight") {
      // one straight corridor along the plate, through the first leg's middle
      const sp = LAST.spine.path, y = (sp[0][1] + sp[1][1]) / 2, xs = LAST.F.poly.map((p) => p[0]);
      const line = [[Math.min(...xs), y], [Math.max(...xs), y]];
      SPSEL = false;
      return editFloor((f) => { carry(f, line); delete f.spine; f.corrY = R3(y - (Number(opts(cur()).corridor) || 1.5) / 2); });
    }
    if (a === "bend") return editSpine((sp) => { let best = 0, bl = -1; for (let j = 0; j < sp.length - 1; j++) { const l = WC.segLen(sp, j); if (l > bl) { bl = l; best = j; } } const p0 = sp[best], p1 = sp[best + 1]; sp.splice(best + 1, 0, [R3((p0[0] + p1[0]) / 2), R3((p0[1] + p1[1]) / 2)]); return sp; });
  }
}
function onProp(key, v) {
  const r = LAST, x = cur(); if (!r || !x || !C.can()) return;
  const num = parseFloat(v), k = key.split(".")[0], a = key.slice(k.length + 1);
  if (k === "f") return setFloor(a, v);
  if (k === "t") {
    if (a === "t") setPref("fl-wt", num > 0 ? String(num) : "");
    if (a === "m") setPref("fl-wm", v);
    if (a === "just") setPref("fl-wj", v);
    if (a === "unit") setPref("fl-addu", v);
    return drawPlan();
  }
  if (k === "p") {
    const { key: pk, leg } = PTSEL;
    return editFloor((f) => {
      const set = (o) => { if (num > 0) o[pk] = R3(num); else delete o[pk]; };
      if (MULTI()) { f.legPartyT = Array.isArray(f.legPartyT) ? f.legPartyT : []; f.legPartyT[leg] = f.legPartyT[leg] || {}; set(f.legPartyT[leg]); }
      else { f.partyT = f.partyT && typeof f.partyT === "object" ? f.partyT : {}; set(f.partyT); if (!Object.keys(f.partyT).length) delete f.partyT; }
    });
  }
  if (k === "w") {
    const i = WSEL;
    return editWalls((A) => {
      const w = A[i];
      if (a === "t" && num > 0) w.t = R3(num);
      if (a === "m") w.m = v;
      if (a === "just") w.just = v;
      if ((a === "len" && num > 0) || a === "ang") {
        const P = WC.cleanPath(w.path), s0 = Math.min(WSEG, P.length - 2), p0 = P[s0], p1 = P[s0 + 1];
        const L = a === "len" ? num : Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), an = a === "ang" ? -num * Math.PI / 180 : Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
        const np = [R3(p0[0] + Math.cos(an) * L), R3(p0[1] + Math.sin(an) * L)], d = [np[0] - p1[0], np[1] - p1[1]];
        // the end point moves, and the rest of the wall with it
        for (let j = s0 + 1; j < P.length; j++) P[j] = [R3(P[j][0] + d[0]), R3(P[j][1] + d[1])];
        w.path = P;
      }
      return i;
    });
  }
  if (k === "o") return editOpening((o) => { if (a === "type") o.type = v; if (a === "w" && num > 0.3) o.w = R3(num); });
  if (k === "v") {
    const i = VSEL;
    return editPlate((P) => { if (a === "x") P[i][0] = num; if (a === "y") P[i][1] = num; if (a === "len" && num > 0) { const n2 = (i + 1) % P.length, d = [P[n2][0] - P[i][0], P[n2][1] - P[i][1]], L = Math.hypot(...d) || 1; P[n2] = [R3(P[i][0] + d[0] / L * num), R3(P[i][1] + d[1] / L * num)]; } return P; });
  }
  if (k === "s" && a === "coreLeg") return editFloor((f) => { f.coreLeg = +v; delete f.pieces; delete f.legSeq; });
  if (k === "s" && /^(len|ang|bend)\.\d+$/.test(a) && !isNaN(num)) {
    const [what, js] = a.split("."), j = +js;
    return editSpine((sp) => {
      if (what === "len") { if (!(num > 0.5)) return null; const d = WC.dirOf(sp[j], sp[j + 1]).d, np = [sp[j][0] + d[0] * num, sp[j][1] + d[1] * num]; return moveRest(sp, j + 1, [np[0] - sp[j + 1][0], np[1] - sp[j + 1][1]]); }
      if (what === "ang") return turnRest(sp, j, -num * Math.PI / 180 - Math.atan2(sp[j + 1][1] - sp[j][1], sp[j + 1][0] - sp[j][0]));
      // a bend: the angle between its legs; the legs after it turn about it, the way it turns now
      const cur0 = bendAt(sp, j), t0 = turnAt(sp, j), want = Math.max(1, Math.min(180, num));
      return turnRest(sp, j, (t0 >= 0 ? 1 : -1) * (want - cur0) * Math.PI / 180);
    }, true);
  }
  if (k === "u") {
    const q = r.placed[PSEL], me = entryOf(q), l = legK(me.leg);
    if (a === "type") return edit((SQ) => { SQ(me.leg)[me.band][me.i].u = v; return PSEL; });
    if (a === "x" && !isNaN(num)) return edit((SQ) => { SQ(me.leg)[me.band][me.i].x = R3(num); return PSEL; });
    if (a === "side" && v !== me.band) return edit((SQ) => { const S = SQ(me.leg), [e] = S[me.band].splice(me.i, 1); delete e.x; S[v].push(e); });
    void l;
  }
  if (k === "c") {
    const c = r.core[CSEL], i = pIdx(CSEL), cw0 = r.coreWall || 0.25, t = Number(c.wt) > 0 ? Number(c.wt) : cw0;
    if (a === "cw" && num > 0) return editCore((P) => { P[i].w = R3(num + 2 * t); return i; });
    if (a === "ch" && num > 0) return editCore((P) => { P[i].h = R3(num + 2 * t); return i; });
    if (a === "wt") return editCore((P) => { if (v === "" || !(num > 0)) delete P[i].wt; else P[i].wt = Math.max(0.05, R3(num)); return i; });
    if (a === "door") return editCore((P) => { if (v) P[i].door = Object.assign({}, P[i].door, { side: v, at: P[i].door && P[i].door.at != null ? P[i].door.at : 0.5 }); else delete P[i].door; return i; });
    if (a === "pw" && num > 0) return editCore((P) => { if (!Array.isArray(P[i].path)) P[i].path = FC.passageShape(Object.assign({}, P[i])).path; P[i].width = Math.max(0.6, R3(num)); return i; });
    if (a === "leg") {
      const to = legK(+v), mid2 = to.r.corr ? (to.r.corr.x0 + to.r.corr.x1) / 2 : to.r.L / 2;
      return editCore((P) => { const q2 = P[i]; q2.leg = to.k; q2.x = R3(mid2 - q2.w / 2 - to.A[0]); q2.y = R3(to.r.y0 - q2.h - to.A[1]); delete q2.path; return i; });
    }
  }
}
/* a spine's bend k: the angle between its legs (180: straight on), and its turn (signed, on the plan) */
function turnAt(sp, k) { const a0 = Math.atan2(-(sp[k][1] - sp[k - 1][1]), sp[k][0] - sp[k - 1][0]), a1 = Math.atan2(-(sp[k + 1][1] - sp[k][1]), sp[k + 1][0] - sp[k][0]); let t = (a1 - a0) * 180 / Math.PI; while (t > 180) t -= 360; while (t < -180) t += 360; return t; }
function bendAt(sp, k) { return Math.round((180 - Math.abs(turnAt(sp, k))) * 10) / 10; }
/* the points from i on moved by d; the points after j turned by an angle about point j (y down: positive turns clockwise on the plan) */
function moveRest(sp, i, d) { return sp.map((p, k) => (k >= i ? [p[0] + d[0], p[1] + d[1]] : p)); }
function turnRest(sp, j, an) { const c = Math.cos(an), s2 = Math.sin(an), o = sp[j]; return sp.map((p, k) => (k > j ? [o[0] + (p[0] - o[0]) * c - (p[1] - o[1]) * s2, o[1] + (p[0] - o[0]) * s2 + (p[1] - o[1]) * c] : p)); }
/* the selected opening's stored record, edited */
function editOpening(fn) {
  const s = OPSEL; if (!s) return;
  if (s.wi != null) return editWalls((A) => { const o = A[s.wi].openings[s.oi]; if (o) fn(o); return s.wi; });
  const c = LAST.core[s.ci], d = c.doors[s.di], i = pIdx(s.ci);
  return editCore((P) => {
    const q = P[i];
    if (d.oi != null) { const o = q.openings[d.oi]; if (o) fn(o); }
    else { q.door = Object.assign({ side: d.side, at: atOnFace(c, d) }, q.door); fn(q.door); if (q.door.type === "door") delete q.door.type; }
    return i;
  });
}
/* where a door is along its face, 0 .. 1 */
function atOnFace(c, d) {
  const t = d.t || (Number(c.wt) > 0 ? Number(c.wt) : LAST.coreWall || 0.25), horiz = d.side === "n" || d.side === "s";
  const m = horiz ? (d.H[0] + d.O[0]) / 2 : (d.H[1] + d.O[1]) / 2, a = (horiz ? c.x : c.y) + t, L = (horiz ? c.w : c.h) - 2 * t;
  return Math.max(0, Math.min(1, (m - a) / (L || 1)));
}
/* the corridor's spine edited (one made from the straight corridor first) */
function editSpine(fn, keepSel) {
  const sp0 = (LAST.spine.path || []).map((p) => p.slice());
  const out0 = fn(sp0.map((p) => p.slice()));
  if (!out0 || out0.length < 2) return;
  const out = out0.map((p) => [R3(p[0]), R3(p[1])]);
  // an end off the plate (a straight corridor runs the plate's box; a corner may be cut): brought in to the plate's edge
  for (const [e, nb] of [[0, 1], [out.length - 1, out.length - 2]]) if (!onPlate(out[e])) { const q = toPlateEdge(out[e], out[nb]); if (q) out[e] = q; }
  // the corridor kept on the plate: the points that moved or are new
  const bad = out.findIndex((p) => !sp0.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-3) && !onPlate(p));
  if (bad >= 0) return toast(bad === 0 || bad === out.length - 1 ? "That end of the corridor would be off the floor plate" : "That bend would be off the floor plate", true);
  return editFloor((f) => {
    carry(f, out);
    f.spine = { path: out };
    SPSEL = true; if (!keepSel) SPPT = null;
  });
}
/* a point on the plate, its edges included (within 50 mm) */
/* from p (off the plate) towards q: the first point on the plate's edge, a little inside */
function toPlateEdge(p, q) {
  const P = LAST.F.poly, dx = q[0] - p[0], dy = q[1] - p[1]; let best = null;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], ex = b[0] - a[0], ey = b[1] - a[1], den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den, u = ((a[0] - p[0]) * dy - (a[1] - p[1]) * dx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (best == null || t < best)) best = t;
  }
  if (best == null) return null;
  const L = Math.hypot(dx, dy) || 1, t2 = Math.min(1, best + 0.02 / L);
  return [R3(p[0] + dx * t2), R3(p[1] + dy * t2)];
}
function onPlate(p) {
  const P = LAST.F.poly; if (WC.inPoly(P, p[0], p[1])) return true;
  for (let i = 0; i < P.length; i++) { const q = WC.nearestOnPath(p, [P[i], P[(i + 1) % P.length]]); if (q && q.d <= 0.05) return true; }
  return false;
}
/* the units and the core as they stand, carried onto a new corridor line, so none is lost */
function carry(f, out) { return timed("carry", () => carry0(f, out)); }
function carry0(f, out) {
  // both ways tried - each unit where it stands, or in its order laid along the new legs - the one that places more, with fewer clashes, kept
  const x = cur(), list = units(), mix = [];
  for (const q of x.g.mix || []) { const u = list.find((v) => v.name === q.u); if (u) mix.push({ u, n: Number(q.n) || 0 }); }
  const trial = (M3) => {
    // as the floor will be stored (so the one kept is the layout the page then shows, from the cache)
    const o = Object.assign({}, opts(x), { seq: M3.seq || null, legSeq: M3.legSeq || null, spine: { path: out }, pieces: M3.pieces || null, corrY: null });
    if (!M3.seq) o.seq = null; if (M3.seq) { o.legSeq = null; o.coreLeg = null; } else if (o.coreLeg != null && o.coreLeg >= out.length - 1) o.coreLeg = null;
    if (!M3.pieces) o.pieces = null;
    const r = layoutOf(Object.assign(o, { poly: x.fp, mix, lib: list, storeys: Number(x.g.n) || 1, floorsAbove: x.top || Number(x.g.n) || 1 }));
    // the units standing clear (inside the plate, on nothing else) first, then the fewer clashes; those that do not fit stay in the floor's list
    trial.last = r;
    // no unit lost first (one flagged is shown and can be moved; one dropped is not seen), then those clear, then the core clear
    return r ? [r.placed.length * 1000 + r.placed.filter((q) => !(q.flags && q.flags.length)).length * 10 + r.core.filter((c) => !(c.flags && c.flags.length)).length, -r.issues.length] : [-1, -1e9];
  };
  const A1 = FC.migrateToSpine(LAST, out, true), A2 = FC.migrateToSpine(LAST, out, false), cands = [A1, A2];
  // each where it stands, but those that then clash laid along their leg again
  trial(A1);
  if (trial.last && A1.legSeq) {
    const A3 = JSON.parse(JSON.stringify(A1));
    for (const l of trial.last.legs) for (const q of l.r.placed) if (q.flags && q.flags.length) { const e = ((A3.legSeq[l.k] || {})[q.band] || [])[q.si]; if (e) delete e.x; }
    cands.push(A3);
  }
  // a core never moved by hand is laid out again; a floor never edited, all of it
  if (!LAST.coreEdited) cands.push(Object.assign({}, A2, { pieces: null }));
  if (!LAST.coreEdited && !LAST.edited) cands.push({ legSeq: null, seq: null, pieces: null, fresh: true });
  let M2 = cands[0], best = null;
  // the first that places every unit and piece clear of the rest is taken: the others are not tried
  const clean = (r) => r && r.placed.length >= LAST.placed.length && !(r.left && r.left.length) && !r.issues.length && r.placed.every((q) => !(q.flags && q.flags.length)) && r.core.every((c) => !(c.flags && c.flags.length));
  for (const c of cands) { const sc = trial(c); if (!best || sc[0] > best[0] || (sc[0] === best[0] && sc[1] > best[1])) { best = sc; M2 = c; } if (clean(trial.last)) break; }
  if (M2.seq) { f.seq = M2.seq; delete f.legSeq; delete f.coreLeg; }
  else if (M2.legSeq) { f.legSeq = M2.legSeq; delete f.seq; if (f.coreLeg != null && f.coreLeg >= out.length - 1) delete f.coreLeg; }
  else { delete f.seq; delete f.legSeq; }
  delete f.corrY;
  if (M2.pieces && LAST.core.length) f.pieces = M2.pieces; else if (!M2.pieces) delete f.pieces;
}

/* ---------- the plan */
const KC = { BATH: "#eef6f4", ENS: "#eef6f4", STORE: "#f3f1ea" };   // the rooms otherwise pale, as on the unit plans
let DRAG = null;           // a drag on the plan: {k, i (global), leg, x, y, dx, dy (px, in the leg's axes), moved}
function drawPlan() { return timed("draw", drawPlan0); }
function drawPlan0() {
  const host = $("#st-fplan"), r = LAST;
  if (!r) { if (!host.innerHTML) host.innerHTML = `<div class="un-empty">Choose a floor group.</div>`; mountBars(); return; }
  const bw = host.clientWidth || 900, bh = host.clientHeight || 700;
  // the box: the plate and its corridor
  const xs = [...r.F.poly.map((p) => p[0]), ...((r.spine && r.spine.path) || []).map((p) => p[0])];
  const ys = [...r.F.poly.map((p) => p[1]), ...((r.spine && r.spine.path) || []).map((p) => p[1])];
  const gk = cur() ? cur().key : "";
  if (!DRAG && (VIEWKEY !== gk || !drawPlan.W)) { X0 = Math.min(0, ...xs); Y0 = Math.min(0, ...ys); drawPlan.W = Math.max(r.L, ...xs) - X0; drawPlan.H = Math.max(r.D, ...ys) - Y0; VIEWKEY = gk; }
  const W = drawPlan.W, H = drawPlan.H, top = 96;   // room for the toolbar and the property bar
  const mg = Math.max(24, Math.min(70, 0.08 * Math.min(bw, bh)));
  const fit = Math.max(1, Math.min((bw - 2 * mg) / W, (bh - 2 * mg - top) / H));
  ({ SC, OX, OY } = PZ.apply(ZM, fit, (bw - W * fit) / 2, (bh - H * fit + top) / 2, bw, bh));
  const sx = (x) => OX + (x - X0) * SC, sy = (y) => OY + (y - Y0) * SC;
  const fs = Math.max(7, Math.min(12, SC * 0.5)), can = C.can();
  const poly = DRAG && DRAG.k === "vert" && DRAG.poly ? DRAG.poly : r.F.poly;
  let bgGrid = "";
  let g = `<polygon points="${poly.map((p) => sx(p[0]) + "," + sy(p[1])).join(" ")}" fill="#fbf3dc" fill-opacity="0.85" stroke="#7a6a3a" stroke-width="1.5" />`;
  // the corridor (a bending one: its mitred shape, the knuckles too); picked to edit its line
  const spPath = DRAG && (DRAG.k === "spt" || DRAG.k === "spsel") && DRAG.path ? DRAG.path : r.spine.path;
  const cpoly = WC.wallPoly(spPath, r.cw, "c");
  g += `<polygon class="fl-sp" data-spine="1" points="${cpoly.map((p) => sx(p[0]) + "," + sy(p[1])).join(" ")}" fill="#eceff3" stroke="${SPSEL ? "#f28022" : "#9aa5b1"}" stroke-width="${SPSEL ? 2 : 0.8}" />`;
  const PTW = drawPlan.ptw = [];
  // every leg's left-over and strips first, then every leg's units and core over them, so no leg covers another's units
  const LG = legs().map((l) => drawLeg(l, sx, sy, fs, PTW));
  for (const q of LG) g += q.under;
  // the plate's overall dimensions, above and to the left
  if (DIMS() && SC > 3) {
    const P = r.F.poly, xs = P.map((p) => p[0]), ys = P.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), dfs = Math.max(8, Math.min(11, SC * 0.25));
    g += DM.chain([x0, y0], [x1, y0], [0, x1 - x0], 46, sx, sy, { fs: dfs }) + DM.chain([x0, y1], [x0, y0], [0, y1 - y0], 46, sx, sy, { fs: dfs });
  }
  for (const q of LG) g += q.over;
  // the walls drawn on the floor, at any angle: their outlines first, their fills over them, so walls that meet read as one
  const FILL = { blk: "url(#fl-blk)", rc: "url(#fl-rc)" };
  const wview = (r.walls || []).map((w, wi) => (DRAG && DRAG.moved && (DRAG.k === "fwpt" || DRAG.k === "fwseg") && DRAG.i === wi && DRAG.path ? FC.floorWalls([Object.assign({}, w, { path: DRAG.path, openings: WC.keepOpenings(w, DRAG.path, DRAG.k === "fwseg" ? DRAG.p : -1) })], w.t)[0] || w : w));
  const LWf = Math.max(0.7, Math.min(1.3, SC * 0.03)), pts = (P) => P.map((p) => sx(p[0]) + "," + sy(p[1])).join(" ");
  for (const w of wview) for (const q of w.pieces) g += `<polygon points="${pts(q)}" fill="#111" stroke="#111" stroke-width="${LWf * 2}" stroke-linejoin="miter" pointer-events="none" />`;
  for (const w of wview) for (const q of w.pieces) g += `<polygon points="${pts(q)}" fill="${FILL[w.m] || FILL.rc}" stroke="none" pointer-events="none" />`;
  // their openings
  wview.forEach((w, wi) => (w.ops || []).forEach((o, oi) => { g += openingSvg(o, sx, sy, OPSEL && OPSEL.wi === wi && OPSEL.oi === oi); if (can) g += `<line class="fl-op" data-fwo="${wi}:${oi}" x1="${sx(o.a[0])}" y1="${sy(o.a[1])}" x2="${sx(o.b[0])}" y2="${sy(o.b[1])}" stroke="transparent" stroke-width="${Math.max(10, w.t * SC + 6)}" />`; }));
  // picked by their pieces; a selected one's points and segments to drag
  for (const [wi, w] of wview.entries()) {
    const quads = WC.segQuads(w.path, w.t, w.just);
    quads.forEach((q, k) => { g += `<polygon class="fl-fw" data-fw="${wi}" data-seg="${k}" points="${pts(q)}" fill="${WSEL === wi ? (WSEG === k ? "rgba(242,128,34,.35)" : "rgba(242,128,34,.15)") : JOINA === wi ? "rgba(31,111,235,.3)" : "transparent"}" stroke="${WSEL === wi ? "#f28022" : "transparent"}" stroke-width="${WSEL === wi ? 1.5 : 8}" />`; });
    if (WSEL === wi && can) {
      w.path.forEach(([x, y], k) => { g += `<circle class="fl-ppt" data-fwpt="${k}" cx="${sx(x)}" cy="${sy(y)}" r="7" fill="#fff" stroke="#f28022" stroke-width="2.5" />`; });
      for (let k = 0; k < w.path.length - 1; k++) { const m2 = [(w.path[k][0] + w.path[k + 1][0]) / 2, (w.path[k][1] + w.path[k + 1][1]) / 2]; g += `<rect class="fl-ppt" data-fwseg="${k}" x="${sx(m2[0]) - 5}" y="${sy(m2[1]) - 5}" width="10" height="10" fill="#f28022" stroke="#fff" stroke-width="1.5" style="cursor:move" />`; }
    }
  }
  // the corridor's line when selected: its points to drag, a + in each leg to add a bend
  if ((SPSEL || TOOL === "corridor") && can) {
    g += `<polyline points="${pts(spPath)}" fill="none" stroke="#f28022" stroke-width="1.5" stroke-dasharray="6 4" pointer-events="none" />`;
    spPath.forEach((p, k) => { g += `<circle class="fl-ppt" data-spt="${k}" cx="${sx(p[0])}" cy="${sy(p[1])}" r="7.5" fill="#fff" stroke="#f28022" stroke-width="2.5" />`; });
    for (let k = 0; k < spPath.length - 1; k++) { const m2 = [(spPath[k][0] + spPath[k + 1][0]) / 2, (spPath[k][1] + spPath[k + 1][1]) / 2]; g += `<g class="fl-ppt" data-spm="${k}"><circle data-spm="${k}" cx="${sx(m2[0])}" cy="${sy(m2[1])}" r="7" fill="#f28022" stroke="#fff" stroke-width="1.5" /><text x="${sx(m2[0])}" y="${sy(m2[1]) + 4}" text-anchor="middle" font-size="12" fill="#fff" pointer-events="none">+</text></g>`; }
  }
  // the corridor's legs: each its length and direction, each bend its turn (the corridor selected)
  if (SPSEL) {
    const ang = (a, b) => Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180 / Math.PI;
    for (let k = 0; k < spPath.length - 1; k++) {
      const a = spPath[k], b = spPath[k + 1], m2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], L = Math.hypot(b[0] - a[0], b[1] - a[1]), dg = ang(a, b);
      g += `<text x="${sx(m2[0])}" y="${sy(m2[1]) - Math.max(10, r.cw * SC / 2 + 6)}" text-anchor="middle" font-size="12" font-weight="700" fill="#c25e0a" paint-order="stroke" stroke="#fff" stroke-width="3.5" pointer-events="none">${f1(L)} m · ${Math.round(dg * 10) / 10}°</text>`;
    }
    for (let k = 1; k < spPath.length - 1; k++) {
      const a0 = ang(spPath[k - 1], spPath[k]), a1 = ang(spPath[k], spPath[k + 1]); let t = a1 - a0; while (t > 180) t -= 360; while (t < -180) t += 360;
      const P0 = spPath[k], R2 = 24, s0 = (180 + a0) * Math.PI / 180, s1 = a1 * Math.PI / 180;
      const e0 = [sx(P0[0]) + R2 * Math.cos(s0), sy(P0[1]) - R2 * Math.sin(s0)], e1 = [sx(P0[0]) + R2 * Math.cos(s1), sy(P0[1]) - R2 * Math.sin(s1)];
      g += `<path d="M ${e0[0]} ${e0[1]} A ${R2} ${R2} 0 0 ${t > 0 ? 1 : 0} ${e1[0]} ${e1[1]}" fill="none" stroke="#1f6feb" stroke-width="1.5" pointer-events="none" />`;
      g += `<text x="${sx(P0[0]) + 30}" y="${sy(P0[1]) + 30}" font-size="12" font-weight="700" fill="#1f6feb" paint-order="stroke" stroke="#fff" stroke-width="3.5" pointer-events="none">${Math.round(Math.abs(180 - Math.abs(t)) * 10) / 10}°${SPPT === k ? " ✎" : ""}</text>`;
    }
  }
  // a library opening dragged over: where it would go
  if (LIBHOV) g += `<line x1="${sx(LIBHOV.a[0])}" y1="${sy(LIBHOV.a[1])}" x2="${sx(LIBHOV.b[0])}" y2="${sy(LIBHOV.b[1])}" stroke="#1f6feb" stroke-width="${Math.max(5, LIBHOV.t * SC)}" stroke-opacity="0.55" pointer-events="none" />`;
  // a polyline being drawn: a wall at its thickness and line, a corridor or a lobby at its width
  if (WALLDRAW && WALLDRAW.pts.length) {
    const P = WALLDRAW.hover ? WALLDRAW.pts.concat([WALLDRAW.hover]) : WALLDRAW.pts, wt = WT(), o0 = opts(cur());
    const tt = WALLDRAW.kind === "wall" ? wt.t || Number(o0.coreWall) || 0.25 : Number(o0.corridor) || 1.5;
    if (P.length >= 2) g += `<polygon points="${pts(WC.wallPoly(P, tt, WALLDRAW.kind === "wall" ? wt.just : "c"))}" fill="${WALLDRAW.kind === "wall" ? "rgba(242,128,34,.45)" : "rgba(31,111,235,.18)"}" stroke="#f28022" stroke-width="1" pointer-events="none" />`;
    g += `<polyline points="${pts(P)}" fill="none" stroke="#f28022" stroke-width="1" stroke-dasharray="4 3" pointer-events="none" />`;
    for (const [x, y] of WALLDRAW.pts) g += `<circle cx="${sx(x)}" cy="${sy(y)}" r="4" fill="#f28022" pointer-events="none" />`;
    if (WALLDRAW.hover && WALLDRAW.pts.length) {
      const a = WALLDRAW.pts[WALLDRAW.pts.length - 1], b = WALLDRAW.hover, L = Math.hypot(b[0] - a[0], b[1] - a[1]), an = Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180 / Math.PI;
      g += `<text x="${sx(b[0]) + 12}" y="${sy(b[1]) - 10}" font-size="12" fill="#c25e0a" font-weight="600" paint-order="stroke" stroke="#fff" stroke-width="3" pointer-events="none">${WALLDRAW.typed ? WALLDRAW.typed + " m ⏎" : f3(L) + " m · " + Math.round(an) + "°"}</text>`;
    }
  }
  // the structural grid: chain-dotted lines, bubbles at both ends
  const GL = gridLines(r), gb = Math.max(7, Math.min(11, SC * 0.35));
  const pxs = r.F.poly.map((p) => p[0]), pys = r.F.poly.map((p) => p[1]), gx0 = Math.min(...pxs) - 1.5, gx1 = Math.max(...pxs) + 1.5, gy0 = Math.min(...pys) - 1.5, gy1 = Math.max(...pys) + 1.5;
  if (GRID()) {
    const p1 = SC, p5 = 5 * SC, ox = sx(0), oy = sy(0);
    bgGrid = `<pattern id="fl-g1" patternUnits="userSpaceOnUse" x="${ox}" y="${oy}" width="${p1}" height="${p1}"><path d="M ${p1} 0 L 0 0 0 ${p1}" fill="none" stroke="#d9dee5" stroke-width="0.5"/></pattern><pattern id="fl-g5" patternUnits="userSpaceOnUse" x="${ox}" y="${oy}" width="${p5}" height="${p5}"><rect width="${p5}" height="${p5}" fill="url(#fl-g1)"/><path d="M ${p5} 0 L 0 0 0 ${p5}" fill="none" stroke="#b8c0ca" stroke-width="0.9"/></pattern>`;
  }
  const bub = (X, Y, t) => `<circle cx="${X}" cy="${Y}" r="${gb}" fill="#fff" stroke="#c0392b" stroke-width="0.9" /><text x="${X}" y="${Y + gb * 0.38}" text-anchor="middle" font-size="${gb * 1.05}" fill="#c0392b" pointer-events="none">${t}</text>`;
  if (GRID()) for (const l of GL.x) g += `<line x1="${sx(l.at)}" y1="${sy(gy0)}" x2="${sx(l.at)}" y2="${sy(gy1)}" stroke="#c0392b" stroke-width="0.6" stroke-dasharray="10 3 2 3" pointer-events="none" />` + bub(sx(l.at), sy(gy0) - gb, l.lab) + bub(sx(l.at), sy(gy1) + gb, l.lab);
  if (GRID()) for (const l of GL.y) g += `<line x1="${sx(gx0)}" y1="${sy(l.at)}" x2="${sx(gx1)}" y2="${sy(l.at)}" stroke="#c0392b" stroke-width="0.6" stroke-dasharray="10 3 2 3" pointer-events="none" />` + bub(sx(gx0) - gb, sy(l.at), l.lab) + bub(sx(gx1) + gb, sy(l.at), l.lab);
  // the plate's corners to drag, a + on each edge to add one
  if (can && TOOL === "select") {
    for (const [vi, p] of poly.entries()) {
      const nx = poly[(vi + 1) % poly.length];
      g += `<circle class="fl-vm" data-vm="${vi}" cx="${sx((p[0] + nx[0]) / 2)}" cy="${sy((p[1] + nx[1]) / 2)}" r="6" fill="#fff" stroke="#7a6a3a" stroke-width="1.2" /><text x="${sx((p[0] + nx[0]) / 2)}" y="${sy((p[1] + nx[1]) / 2) + 3.5}" text-anchor="middle" font-size="10" fill="#7a6a3a" pointer-events="none">+</text>`;
    }
    for (const [vi, p] of poly.entries()) g += `<circle class="fl-v" data-vi="${vi}" cx="${sx(p[0])}" cy="${sy(p[1])}" r="7" fill="${VSEL === vi ? "#f28022" : "#7a6a3a"}" stroke="#fff" stroke-width="2" />`;
  }
  const dim = (x1, y1, x2, y2, t, vert) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#555" stroke-width="0.8" /><text x="${(x1 + x2) / 2 + (vert ? -6 : 0)}" y="${(y1 + y2) / 2 + (vert ? 0 : -4)}" text-anchor="middle" font-size="${fs}" fill="#333"${vert ? ` transform="rotate(-90 ${(x1 + x2) / 2 - 6} ${(y1 + y2) / 2})"` : ""}>${t}</text>`;
  g += dim(sx(0), sy(0) - 16, sx(r.L), sy(0) - 16, f3(r.L) + " m");
  g += dim(sx(0) - 16, sy(0), sx(0) - 16, sy(r.D), f3(r.D) + " m", true);
  const F = r.figures, cursor = TOOL === "select" ? "" : TOOL === "split" ? "crosshair" : TOOL === "join" ? "pointer" : "crosshair";
  host.style.cursor = cursor;
  g += ME.svg(MEAS, sx, sy);
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}" font-family="'Noto Sans HK', 'PingFang HK', sans-serif"><defs><pattern id="fl-rc" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)"><rect width="5" height="5" fill="#8b9096"/><line x1="0" y1="0" x2="0" y2="5" stroke="#5c6166" stroke-width="1.2"/></pattern><pattern id="fl-blk" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)"><rect width="4" height="4" fill="#fff"/><line x1="0" y1="0" x2="0" y2="4" stroke="#8a8f95" stroke-width="0.6"/></pattern><pattern id="fl-em" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(-45)"><rect width="8" height="8" fill="#f6e7c4"/><line x1="0" y1="0" x2="0" y2="8" stroke="#d9b56a" stroke-width="0.8"/></pattern><pattern id="fl-lx" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(-45)"><rect width="7" height="7" fill="#e3edf9"/><line x1="0" y1="0" x2="0" y2="7" stroke="#7fa6d6" stroke-width="0.7"/></pattern><pattern id="fl-ex" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><rect width="7" height="7" fill="#e3f1e3"/><line x1="0" y1="0" x2="0" y2="7" stroke="#8cc28c" stroke-width="0.7"/></pattern>${bgGrid}</defs>${bgGrid ? `<rect width="${bw}" height="${bh}" fill="url(#fl-g5)" pointer-events="none" />` : ""}${g}
    <text x="12" y="${bh - 12}" font-size="12" fill="#5b6b7b">${F.units} flats · GFA ${f1(F.gfa)} m² of ${f1(F.plate)} m²${SWAP ? " · click the other one to swap with" : ""}</text></svg>${PZ.bar(document.body.classList.contains("st-planfull"))}`;
  mountBars();
}

/* one leg of the floor in its own frame: its corridor's exempt strips, the core, the units, their walls, doors and windows */
function drawLeg(l, SX, SY, fs, PTW) {
  const r = l.r, sx = (u) => u * SC, sy = (v) => v * SC, can = C.can(), o0 = opts(cur());
  const tf = `matrix(${l.xf.c} ${l.xf.s} ${-l.xf.s} ${l.xf.c} ${SX(l.xf.ox)} ${SY(l.xf.oy)})`;
  let g = "";
  // what is left of the plate: found by itself, each region E&M
  for (const z of r.residuals || []) {
    // one path a region (its cells, those cut by a slanted edge as their part inside): one element, not one a cell
    const n1 = (v) => Math.round(v * 10) / 10;
    let d = "";
    for (const c of z.cells) {
      if (c.poly) d += "M" + c.poly.map((q) => n1(sx(q[0])) + " " + n1(sy(q[1]))).join("L") + "Z";
      else { const x0 = n1(sx(c.x0)), y0 = n1(sy(c.y0)), x1 = n1(sx(c.x1) + 0.5), y1 = n1(sy(c.y1) + 0.5); d += `M${x0} ${y0}H${x1}V${y1}H${x0}Z`; }
    }
    if (d) g += `<path d="${d}" fill="url(#fl-em)" pointer-events="none" />`;
    if (z.area >= 1) g += `<text x="${sx(z.at[0])}" y="${sy(z.at[1]) + fs / 3}" text-anchor="middle" font-size="${fs - 1}" fill="#7a5a1a" font-weight="600" paint-order="stroke" stroke="#fff" stroke-width="3" pointer-events="none">E&amp;M ${f1(z.area)} m²</text>`;
  }
  const CX0 = r.corr ? r.corr.x0 : 0, CX1 = r.corr ? r.corr.x1 : r.L;
  // JPN 1: the exempt parts as strips down the middle of the corridor (green) and of the lift lobby in front of the lifts (blue)
  const J = r.jpn1 || {}, cy0 = (r.y0 + r.y1) / 2;
  const strip = (x0, x1, w, fill, col, lab) => (w > 1e-6 && x1 - x0 > 0.05 ? `<rect x="${sx(x0)}" y="${sy(cy0 - w / 2)}" width="${(x1 - x0) * SC}" height="${w * SC}" fill="url(#${fill})" stroke="${col}" stroke-width="0.8" stroke-dasharray="5 3" pointer-events="none" />` + (lab && (x1 - x0) * SC > 140 ? `<text x="${sx((x0 + x1) / 2)}" y="${sy(cy0 + r.cw / 2) - 3}" text-anchor="middle" font-size="${fs - 2}" fill="${col}" pointer-events="none">${lab}</text>` : "") : "");
  if (J.lobby) {
    g += strip(CX0, J.lobby.x0, J.corrW, "fl-ex", "#2e7d32", "") + strip(J.lobby.x1, CX1, J.corrW, "fl-ex", "#2e7d32", `corridor exempt ${f3(J.corrW)} m (JPN 1)`);
    g += strip(J.lobby.x0, J.lobby.x1, J.lobW, "fl-lx", "#1565c0", `lift lobby exempt ${f3(J.lobW)} m`);
  } else g += strip(CX0, CX1, J.corrW || 0, "fl-ex", "#2e7d32", `corridor exempt ${f3(J.corrW || 0)} m (JPN 1)`);
  if ((CX1 - CX0) * SC > 160) g += `<text x="${sx((CX0 + CX1) / 2)}" y="${sy(r.y0 + r.cw / 2) + fs / 3}" text-anchor="middle" font-size="${fs}" fill="#5b6b7b" pointer-events="none">CORRIDOR ${f3(r.cw)} m</text>`;
  const under = g; g = "";
  const hot = DRAG && DRAG.moved && (DRAG.k === "unit" || DRAG.k === "core") && DRAG.leg === l.k ? dropTarget(DRAG) : null;
  const cwl = r.coreWall || 0.25;
  // the core's pieces where they are (one being dragged at its new place), their doors with them
  const cview = r.core.map((c0, li) => {
    const ci = l.co + li;
    if (!(DRAG && DRAG.moved && DRAG.i === ci && (DRAG.k === "core" || DRAG.k === "cedge" || DRAG.k === "ppt"))) return c0;
    if (DRAG.k === "cedge") return Object.assign({}, c0, DRAG.box, { doors: [] });
    if (DRAG.k === "ppt") return FC.passageShape(Object.assign({}, c0, { path: DRAG.path }));
    if (!DRAG.at) return c0;
    const dx = DRAG.at.x - c0.x, dy = DRAG.at.y - c0.y;
    const moved = Object.assign({}, c0, DRAG.at, { doors: (c0.doors || []).map((d) => ({ ...d, H: [d.H[0] + dx, d.H[1] + dy], O: [d.O[0] + dx, d.O[1] + dy] })) });
    if (c0.path) { moved.path = c0.path.map(([x, y]) => [x + dx, y + dy]); moved.rects = c0.rects.map((q) => ({ x0: q.x0 + dx, x1: q.x1 + dx, y0: q.y0 + dy, y1: q.y1 + dy })); }
    return moved;
  });
  const uview = r.placed.map((q, li) => (DRAG && DRAG.moved && DRAG.k === "unit" && DRAG.i === l.po + li && DRAG.at ? { x: DRAG.at.x, y: DRAG.at.y } : { x: q.x, y: q.y }));
  const KF = { stair: "#fff", lift: "#dad7f0", refuse: "#e3e7d3", riser: "#f1d6d6", lobby: "#e8eef6" };
  for (const c of cview) {
    if (c.kind === "passage") {
      for (const q of c.rects || [{ x0: c.x, y0: c.y, x1: c.x + c.w, y1: c.y + c.h }]) g += `<rect x="${sx(q.x0)}" y="${sy(q.y0)}" width="${(q.x1 - q.x0) * SC}" height="${(q.y1 - q.y0) * SC}" fill="#eceff3" />`;
      for (const ln of outlineOf((c.rects || []).map((q) => Object.assign({ m: "rc" }, q)))) g += `<line x1="${sx(ln.x1)}" y1="${sy(ln.y1)}" x2="${sx(ln.x2)}" y2="${sy(ln.y2)}" stroke="#9aa5b1" stroke-width="0.8" stroke-dasharray="4 2" pointer-events="none" />`;
      continue;
    }
    const tw = Number(c.wt) > 0 ? Number(c.wt) : cwl, IX = sx(c.x + tw), IY = sy(c.y + tw), iw = Math.max(0, (c.w - 2 * tw) * SC), ih = Math.max(0, (c.h - 2 * tw) * SC);
    g += `<rect x="${IX}" y="${IY}" width="${iw}" height="${ih}" fill="${KF[c.kind] || "#f1d6d6"}" />`;
    if (c.kind === "stair") g += stairSvg(r.stair, IX, IY, iw, ih);
    if (c.kind === "lift") g += liftSvg(c, IX, IY, iw, ih);
  }
  for (const [li, q] of r.placed.entries()) {
    const { x: ox, y: oy } = uview[li];
    for (const e of q.extras) g += `<rect x="${sx(ox + e.x)}" y="${sy(oy + e.y)}" width="${e.w * SC}" height="${e.h * SC}" fill="#dfe9f3" stroke="#3c4650" stroke-width="0.8" stroke-dasharray="4 2" />`;
    for (const rm of q.rooms) g += `<rect x="${sx(ox + rm.x)}" y="${sy(oy + rm.y)}" width="${rm.w * SC}" height="${rm.h * SC}" fill="${KC[rm.kind] || "#fbf3d5"}" />`;
    if (FURN() && SC > 12) for (const fx of q.fixtures || []) g += UN.fixtureSvg(Object.assign({}, fx, { x: ox + fx.x, y: oy + fx.y }), sx, sy, SC);
  }
  // every wall of the leg as one: the units' (cut by their doors), the core's (cut by its doors), the party walls between units
  const WR = [];
  for (const [li, q] of r.placed.entries()) WR.push(...FC.placedWalls(q, uview[li]).rects);
  WR.push(...FC.coreWallRects(cview, cwl));
  const PT0 = MULTI() ? ((o0.legPartyT || [])[l.k] || {}) : (o0.partyT || {});
  for (const band of ["s", "n"]) {
    const qs = r.placed.map((q, k) => ({ q, at: uview[k] })).filter((o) => o.q.band === band).sort((a, b) => a.at.x - b.at.x);
    for (let k = 1; k < qs.length; k++) {
      const A = qs[k - 1], Bq = qs[k], gap = Bq.at.x - (A.at.x + A.q.w);
      if (gap > 0.6 || gap < -0.05) continue;
      const key = A.q.gs === "l" && A.q.gk ? A.q.gk : Bq.q.gs === "r" && Bq.q.gk ? Bq.q.gk : band + ":" + A.q.si, own = Number(PT0[key]) > 0 ? Number(PT0[key]) : null;
      const m2 = (A.at.x + A.q.w + Bq.at.x) / 2, t = own || Math.max(Number(o0.partyWall) || 0.2, gap + (A.q.u.party || 0.15));
      const ya = Math.max(A.at.y, Bq.at.y), yb = Math.min(A.at.y + A.q.h, Bq.at.y + Bq.q.h);
      if (yb - ya > 0.1) { WR.push({ x0: m2 - t / 2, y0: ya, x1: m2 + t / 2, y1: yb, m: "rc" }); PTW.push({ key, leg: l.k, own, t, x0: m2 - t / 2, y0: ya, x1: m2 + t / 2, y1: yb }); }
    }
  }
  const FILL = { blk: "url(#fl-blk)", rc: "url(#fl-rc)", pc: "url(#fl-rc)" };
  for (const m of ["blk", "pc", "rc"]) for (const w of WR) if (w.m === m) g += `<rect x="${sx(w.x0)}" y="${sy(w.y0)}" width="${(w.x1 - w.x0) * SC}" height="${(w.y1 - w.y0) * SC}" fill="${FILL[m]}" pointer-events="none" />`;
  const LWf = Math.max(0.7, Math.min(1.3, SC * 0.03));
  for (const ln of outlineOf(WR)) g += `<line x1="${sx(ln.x1)}" y1="${sy(ln.y1)}" x2="${sx(ln.x2)}" y2="${sy(ln.y2)}" stroke="${ln.k === "join" ? "#666" : "#111"}" stroke-width="${ln.k === "join" ? 0.4 : ln.k === "blk" ? LWf * 0.75 : LWf}" stroke-linecap="square" pointer-events="none" />`;
  // the doors: the units' and the core's, by their type
  const D = (d, ox, oy, t, sel) => doorSvg(d, ox, oy, t, sx, sy, sel);
  for (const [li, q] of r.placed.entries()) {
    const rects = (q.doors || []).length ? FC.placedWalls(q, { x: 0, y: 0 }).rects : [];
    for (const d of q.doors || []) { const a = FC.doorOnWall(d, rects, q.wt || 0.15); g += D(a.d, uview[li].x, uview[li].y, a.t); }
  }
  // the windows and the curtain walls in the units' external walls
  for (const [li, q] of r.placed.entries()) {
    if (!(q.ops || []).length) continue;
    const ox = uview[li].x, oy = uview[li].y, rects = FC.placedWalls(q, uview[li]).rects;
    for (const o of q.ops) {
      const a = [ox + o.a[0], oy + o.a[1]], b = [ox + o.b[0], oy + o.b[1]], v = Math.abs(a[0] - b[0]) < 1e-6, m2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const w0 = rects.find((w) => m2[0] >= w.x0 - 0.02 && m2[0] <= w.x1 + 0.02 && m2[1] >= w.y0 - 0.02 && m2[1] <= w.y1 + 0.02);
      const half = (q.wt || 0.15) / 2, c0 = w0 ? (v ? w0.x0 : w0.y0) : (v ? a[0] : a[1]) - half, c1 = w0 ? (v ? w0.x1 : w0.y1) : (v ? a[0] : a[1]) + half;
      const s0 = v ? Math.min(a[1], b[1]) : Math.min(a[0], b[0]), s1 = v ? Math.max(a[1], b[1]) : Math.max(a[0], b[0]);
      const L = (c, wd, col) => (v ? `<line x1="${sx(c)}" y1="${sy(s0)}" x2="${sx(c)}" y2="${sy(s1)}"` : `<line x1="${sx(s0)}" y1="${sy(c)}" x2="${sx(s1)}" y2="${sy(c)}"`) + ` stroke="${col}" stroke-width="${wd}" pointer-events="none" />`;
      g += v ? `<rect x="${sx(c0)}" y="${sy(s0)}" width="${(c1 - c0) * SC}" height="${(s1 - s0) * SC}" fill="#fff" pointer-events="none" />` : `<rect x="${sx(s0)}" y="${sy(c0)}" width="${(s1 - s0) * SC}" height="${(c1 - c0) * SC}" fill="#fff" pointer-events="none" />`;
      const cm = (c0 + c1) / 2;
      if (o.k === "win") g += L(c0, 0.7, "#111") + L(cm - 0.012, 0.45, "#2b6cb0") + L(cm + 0.012, 0.45, "#2b6cb0") + L(c1, 0.7, "#111");
      else g += cwSvg((ss, nn) => (v ? [cm + nn, s0 + ss] : [s0 + ss, cm + nn]), s1 - s0, c1 - c0, sx, sy);
    }
  }
  let doorHits = "";
  cview.forEach((c, li) => (c.doors || []).forEach((d, di) => {
    const ci = l.co + li, sel = OPSEL && OPSEL.ci === ci && OPSEL.di === di;
    g += D(d, 0, 0, d.t || cwl, sel);
    if (can && c === r.core[li]) doorHits += `<line class="fl-op" data-cdo="${ci}:${di}" x1="${sx(d.H[0])}" y1="${sy(d.H[1])}" x2="${sx(d.O[0])}" y2="${sy(d.O[1])}" stroke="transparent" stroke-width="${Math.max(10, (d.t || cwl) * SC + 6)}" />`;
  }));
  // a core door being slid along its wall: where it goes
  if (DRAG && DRAG.k === "cdo" && DRAG.leg === l.k && DRAG.prev) g += `<line x1="${sx(DRAG.prev.a[0])}" y1="${sy(DRAG.prev.a[1])}" x2="${sx(DRAG.prev.b[0])}" y2="${sy(DRAG.prev.b[1])}" stroke="#f28022" stroke-width="${Math.max(5, cwl * SC)}" stroke-opacity="0.7" pointer-events="none" />`;
  // the labels, the selection and what to pick
  for (const [li, c] of cview.entries()) {
    const ci = l.co + li, c0 = r.core[li], X = sx(c.x), Y = sy(c.y), w = c.w * SC, h = c.h * SC, bad = c0.flags && c0.flags.length, sel = CSEL === ci, tg = hot && hot.ci === ci;
    if (sel || tg || bad) g += `<rect x="${X}" y="${Y}" width="${w}" height="${h}" fill="none" stroke="${sel || tg ? "#f28022" : "#c62828"}" stroke-width="2.5" pointer-events="none" />`;
    if (Math.max(w, h) > fs * 2.5) g += `<text x="${X + w / 2}" y="${Y + h / 2 + 4}" text-anchor="middle" font-size="${fs - 1}" font-weight="700" fill="#222" paint-order="stroke" stroke="#fff" stroke-width="3" pointer-events="none">${esc(c.label)}</text>`;
    g += `<rect class="fl-u" data-ci="${ci}" x="${X}" y="${Y}" width="${w}" height="${h}" fill="transparent"${c !== c0 ? ' opacity="0.8"' : ""} />`;
  }
  g += doorHits;   // over the pieces, so a door is picked rather than its piece
  if (CSEL != null && CSEL - l.co >= 0 && CSEL - l.co < cview.length && can) {
    const c = cview[CSEL - l.co];
    if (c.kind === "passage" && c.path) {
      g += `<polyline points="${c.path.map(([x, y]) => sx(x) + "," + sy(y)).join(" ")}" fill="none" stroke="#f28022" stroke-width="1.5" stroke-dasharray="5 3" pointer-events="none" />`;
      c.path.forEach(([x, y], k) => { g += `<circle class="fl-ppt" data-ppt="${k}" cx="${sx(x)}" cy="${sy(y)}" r="7" fill="#fff" stroke="#f28022" stroke-width="2.5" />`; });
    } else {
      for (const [e, X, Y] of [["n", c.x + c.w / 2, c.y], ["s", c.x + c.w / 2, c.y + c.h], ["w", c.x, c.y + c.h / 2], ["e", c.x + c.w, c.y + c.h / 2]]) g += `<rect class="fl-ce" data-ce="${e}" x="${sx(X) - 6}" y="${sy(Y) - 6}" width="12" height="12" fill="#fff" stroke="#f28022" stroke-width="2.5" />`;
    }
  }
  for (const [li, q] of r.placed.entries()) {
    const pi = l.po + li, { x: ox, y: oy } = uview[li], sel = PSEL === pi, tg = hot && hot.pi === pi, bad = q.flags && q.flags.length;
    if (sel || tg || bad) g += `<rect x="${sx(ox)}" y="${sy(oy)}" width="${q.w * SC}" height="${q.h * SC}" fill="${tg ? "rgba(242,128,34,.22)" : bad ? "rgba(198,40,40,.12)" : "none"}" stroke="${sel || tg ? "#f28022" : "#c62828"}" stroke-width="3" pointer-events="none" />`;
    if (q.corner) { const X = sx(q.corner === "w" ? ox - q.wt / 2 : ox + q.w + q.wt / 2); g += `<line x1="${X}" y1="${sy(oy)}" x2="${X}" y2="${sy(oy + q.h)}" stroke="#2b6c8f" stroke-width="3" pointer-events="none" />`; }
    if (q.w * SC > fs * 5) g += `<text x="${sx(ox + q.w / 2)}" y="${sy(oy + q.h / 2)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="#1f2a36" paint-order="stroke" stroke="#fff" stroke-width="3" pointer-events="none">${esc(q.name || "Unit")}${q.m && !/mirrored/.test(q.name || "") ? " ⇋" : ""}</text>
      <text x="${sx(ox + q.w / 2)}" y="${sy(oy + q.h / 2) + fs + 2}" text-anchor="middle" font-size="${fs - 1}" fill="${bad ? "#c62828" : "#3c4650"}" paint-order="stroke" stroke="#fff" stroke-width="3" pointer-events="none">${bad ? esc(q.flags[0]) : `${f1(q.fig.saleable)} m² · ${f3(q.w)} m`}</text>`;
    g += `<rect class="fl-u" data-pi="${pi}" x="${sx(ox)}" y="${sy(oy)}" width="${q.w * SC}" height="${q.h * SC}" fill="transparent" />`;
  }
  for (const w of PTW.filter((q) => q.leg === l.k)) { const sel = PTSEL && PTSEL.key === w.key && PTSEL.leg === l.k; g += `<rect class="fl-fw" data-ptw="${w.key}" data-leg="${l.k}" x="${sx(w.x0) - 3}" y="${sy(w.y0)}" width="${(w.x1 - w.x0) * SC + 6}" height="${(w.y1 - w.y0) * SC}" fill="${sel ? "rgba(242,128,34,.25)" : "transparent"}" stroke="${sel ? "#f28022" : "none"}" stroke-width="1.5" />`; }
  // the dimensions: the units' widths along each side of the corridor, and the corridor's clear width
  if (DIMS() && VIEW === "plan" && SC > 6) {
    const dfs = Math.max(7.5, Math.min(10, SC * 0.22)), off = Math.max(18, Math.min(34, SC * 0.9));
    for (const band of ["n", "s"]) {
      const qs = r.placed.map((q, k) => ({ q, at: uview[k] })).filter((o) => o.q.band === band); if (!qs.length) continue;
      const xs = qs.flatMap((o) => [o.at.x, o.at.x + o.q.w]), x0 = Math.min(...xs), x1 = Math.max(...xs);
      const yo = band === "n" ? Math.min(...qs.map((o) => o.at.y)) : Math.max(...qs.map((o) => o.at.y + o.q.h));
      g += DM.chain([x0, yo], [x1, yo], xs.map((x) => x - x0), band === "n" ? off : -off, sx, sy, { fs: dfs });
    }
    if (r.corr && r.y1 > r.y0) { const xm = r.corr.x0 + Math.min(1.2, (r.corr.x1 - r.corr.x0) / 2); g += DM.chain([xm, r.y0], [xm, r.y1], [0, r.y1 - r.y0], 0, sx, sy, { fs: dfs, col: "#0b57d0" }); }
  }
  // a piece or unit dragged in from another leg: where it lands, turned with this leg
  if (DRAG && DRAG.cross && DRAG.cross.k === l.k) { const c2 = DRAG.cross; g += `<rect x="${sx(c2.x)}" y="${sy(c2.y)}" width="${c2.w * SC}" height="${c2.h * SC}" fill="rgba(242,128,34,.18)" stroke="#f28022" stroke-width="2" stroke-dasharray="6 3" pointer-events="none" />`; }
  return { under: `<g transform="${tf}" pointer-events="none">${under}</g>`, over: `<g transform="${tf}" data-legg="${l.k}">${g}</g>` };
}

/* a door in plan: its hinge H, closed end O, the side it opens to sn - hinged (leaf and swing), double, sliding, an opening, a window */
function doorSvg(d, ox, oy, t, sx, sy, sel) {
  const H = [ox + d.H[0], oy + d.H[1]], O = [ox + d.O[0], oy + d.O[1]], L2 = Math.hypot(O[0] - H[0], O[1] - H[1]) || d.w, st = sel ? "#f28022" : "#222";
  const al = [(O[0] - H[0]) / L2, (O[1] - H[1]) / L2], nm = [-al[1], al[0]], P = (s2, nn) => [H[0] + al[0] * s2 + nm[0] * nn, H[1] + al[1] * s2 + nm[1] * nn];
  const poly = (q, fill = "#fff") => `<polygon points="${q.map((p2) => sx(p2[0]) + "," + sy(p2[1])).join(" ")}" fill="${fill}" stroke="${st}" stroke-width="0.6" pointer-events="none" />`;
  const ln = (a, b, w = 0.6, extra = "") => `<line x1="${sx(a[0])}" y1="${sy(a[1])}" x2="${sx(b[0])}" y2="${sy(b[1])}" stroke="${st}" stroke-width="${w}"${extra} pointer-events="none" />`;
  const type = d.type || (d.slide ? "lift" : "door");
  if (type === "lift") return ln([H[0], H[1] + d.sn[1] * 0.06 + d.sn[0] * 0], [(H[0] + O[0]) / 2 + al[0] * 0.05 + d.sn[0] * 0.06, (H[1] + O[1]) / 2 + al[1] * 0.05 + d.sn[1] * 0.06], 1) + ln([(H[0] + O[0]) / 2 - al[0] * 0.05 + d.sn[0] * 0.12, (H[1] + O[1]) / 2 - al[1] * 0.05 + d.sn[1] * 0.12], [O[0] + d.sn[0] * 0.12, O[1] + d.sn[1] * 0.12], 1);
  const half = (t || 0.2) / 2;
  if (type === "window" || type === "cw") return poly([P(0, -half), P(L2, -half), P(L2, half), P(0, half)]) + ln(P(0, -0.012), P(L2, -0.012), 0.45, ' stroke-opacity="0.8"') + ln(P(0, 0.012), P(L2, 0.012), 0.45);
  // an access panel (into a PD / E&M space): three lines on the wall across its width, a small AP by it
  if (type === "panel") { const mid = P(L2 / 2, -half - 0.18), fz = Math.max(6, Math.min(9, SC * 0.18)); return poly([P(0, -half), P(L2, -half), P(L2, half), P(0, half)]) + ln(P(0, -half * 0.7), P(L2, -half * 0.7), 0.6) + ln(P(0, 0), P(L2, 0), 0.6) + ln(P(0, half * 0.7), P(L2, half * 0.7), 0.6) + `<text x="${sx(mid[0])}" y="${sy(mid[1]) + fz / 3}" text-anchor="middle" font-size="${fz}" fill="#555" pointer-events="none">AP</text>`; }
  if (type === "opening") return ln(P(0, -half), P(0, half), 0.8) + ln(P(L2, -half), P(L2, half), 0.8) + ln(P(0, 0), P(L2, 0), 0.5, ' stroke-dasharray="3 2"');
  if (type === "sliding" || type === "sliding2") { const lt = Math.min(0.04, half / 2), m2 = L2 / 2, ov = 0.05, jw = Math.min(0.05, L2 / 10); return poly([P(0, -half), P(jw, -half), P(jw, half), P(0, half)], "#fff") + poly([P(L2 - jw, -half), P(L2, -half), P(L2, half), P(L2 - jw, half)], "#fff") + poly([P(0, -lt), P(m2 + ov, -lt), P(m2 + ov, 0), P(0, 0)]) + poly([P(m2 - ov, 0), P(L2, 0), P(L2, lt), P(m2 - ov, lt)], type === "sliding" ? "#eef4fa" : "#fff"); }
  const sw = (h0, o0, len) => { const T = [h0[0] + d.sn[0] * len, h0[1] + d.sn[1] * len], cr = (T[0] - h0[0]) * (o0[1] - h0[1]) - (T[1] - h0[1]) * (o0[0] - h0[0]); return ln(h0, T, Math.max(0.6, SC * 0.03)) + `<path d="M ${sx(T[0])} ${sy(T[1])} A ${len * SC} ${len * SC} 0 0 ${cr > 0 ? 1 : 0} ${sx(o0[0])} ${sy(o0[1])}" fill="none" stroke="${sel ? st : "#444"}" stroke-width="0.5" pointer-events="none" />`; };
  // a rebated frame at each jamb, flush with the face the door opens to (50 mm frame, its stop 15 mm, at most 100 mm deep); the leaf hung inside it
  const fw = Math.min(0.05, L2 / 8), fd = Math.min(t || 0.2, 0.1), stp = 0.015, lt = 0.04, sn = d.sn;
  const FP = (s2, depth) => [H[0] + al[0] * s2 + sn[0] * (half - depth), H[1] + al[1] * s2 + sn[1] * (half - depth)];
  const frame = (s0, sg) => poly([[0, 0], [fw, 0], [fw, lt], [fw + stp, lt], [fw + stp, fd], [0, fd]].map(([uu, nn]) => FP(s0 + sg * uu, nn)));
  const Hf = FP(fw, 0), Of = FP(L2 - fw, 0);
  if (type === "door2") { const M2 = FP(L2 / 2, 0); return frame(0, 1) + frame(L2, -1) + sw(Hf, M2, L2 / 2 - fw) + sw(Of, M2, L2 / 2 - fw); }
  return frame(0, 1) + frame(L2, -1) + sw(Hf, Of, L2 - 2 * fw);
}
/* a curtain wall along a wall: P(s, n) the plan point s along it (0 .. L) and n across it from its middle line (T thick):
   its glass panels between two thin frame lines, a mullion (75 x 150 mm) at each end and about every 1.5 m */
function cwSvg(P, L, T, sx, sy, sel) {
  const poly = (q, fill, st = "none", w = 0) => `<polygon points="${q.map((p) => sx(p[0]) + "," + sy(p[1])).join(" ")}" fill="${fill}" stroke="${st}" stroke-width="${w}" pointer-events="none" />`;
  const ln = (a, b, col, w) => `<line x1="${sx(a[0])}" y1="${sy(a[1])}" x2="${sx(b[0])}" y2="${sy(b[1])}" stroke="${col}" stroke-width="${w}" pointer-events="none" />`;
  const gl = 0.025, mw = 0.075, md = Math.min(0.15, T * 0.9), col = sel ? "#f28022" : "#2b6cb0";
  let g = poly([P(0, -T / 2), P(L, -T / 2), P(L, T / 2), P(0, T / 2)], "#fff");
  g += poly([P(0, -gl), P(L, -gl), P(L, gl), P(0, gl)], "#d6e6f5") + ln(P(0, -gl), P(L, -gl), col, 0.7) + ln(P(0, gl), P(L, gl), col, 0.7);
  const k = Math.max(1, Math.round(L / 1.5));
  for (let i = 0; i <= k; i++) { const c = Math.min(L - mw / 2, Math.max(mw / 2, (L * i) / k)); g += poly([P(c - mw / 2, -md / 2), P(c + mw / 2, -md / 2), P(c + mw / 2, md / 2), P(c - mw / 2, md / 2)], "#334", "#111", 0.4); }
  return g;
}
/* an opening in a floor wall: o.a .. o.b on its middle line, its faces A and B, its type */
function openingSvg(o, sx, sy, sel) {
  const st = sel ? "#f28022" : "#222", P = (p) => sx(p[0]) + "," + sy(p[1]);
  let g = `<polygon points="${P(o.A[0])} ${P(o.A[1])} ${P(o.B[1])} ${P(o.B[0])}" fill="#fff" stroke="none" pointer-events="none" />`;
  const L = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]);
  const d = { H: o.hinge === "end" ? o.b : o.a, O: o.hinge === "end" ? o.a : o.b, sn: [Math.round(o.nl[0] * (o.swing === "out" ? -1 : 1) * 1000) / 1000, Math.round(o.nl[1] * (o.swing === "out" ? -1 : 1) * 1000) / 1000], w: L, type: o.type || "door" };
  if (d.type === "cw") { const dx = (o.b[0] - o.a[0]) / (L || 1), dy = (o.b[1] - o.a[1]) / (L || 1); return g + cwSvg((ss, nn) => [o.a[0] + dx * ss - dy * nn, o.a[1] + dy * ss + dx * nn], L, o.t || 0.2, sx, sy, sel); }
  return g + doorSvg(d, 0, 0, o.t, sx, sy, sel);
}
/* a staircase in its clear inside: a dog-leg (two flights along the longer side, the well, landings at both ends; "dogleg2" with two
   risers across the half landing) or a scissor (two single flights side by side, opposite ways, an RC wall between); UP / DN, a break line */
/* a lift in its clear shaft (X, Y, W, H on the plan): the car with its clearances, the counterweight on its rails at the
   back (the side away from its door), the car's guide rails at its sides */
function liftSvg(c, X, Y, W, H) {
  const side = ((c.doors || []).find((d) => d.slide || d.type === "lift") || (c.doors || [])[0] || {}).side || "s";
  // in the shaft's own terms: f the depth from the door, s across
  const vert = side === "n" || side === "s", D = vert ? H : W, Wd = vert ? W : H, k = SC;
  const cwD = Math.min(0.32 * k, D * 0.16), gap = Math.min(0.08 * k, Wd * 0.05), front = Math.min(0.06 * k, D * 0.04);
  const R = (f0, f1, s0, s1) => { let x0, x1, y0, y1; if (vert) { x0 = X + s0; x1 = X + s1; if (side === "s") { y0 = Y + H - f1; y1 = Y + H - f0; } else { y0 = Y + f0; y1 = Y + f1; } } else { y0 = Y + s0; y1 = Y + s1; if (side === "e") { x0 = X + W - f1; x1 = X + W - f0; } else { x0 = X + f0; x1 = X + f1; } } return [x0, y0, x1 - x0, y1 - y0]; };
  const rect = (q, ex) => `<rect x="${q[0]}" y="${q[1]}" width="${Math.max(0, q[2])}" height="${Math.max(0, q[3])}" ${ex} pointer-events="none" />`;
  let g = "";
  // the car
  const car = R(front, D - cwD - gap, gap * 1.5, Wd - gap * 1.5);
  g += rect(car, 'fill="#f3f2fb" stroke="#444" stroke-width="0.8"');
  g += rect(R(front + 2, D - cwD - gap - 2, gap * 1.5 + 2, Wd - gap * 1.5 - 2), 'fill="none" stroke="#999" stroke-width="0.4"');
  // the counterweight, hatched, on its two rails
  const cwW = Wd * 0.55, s0 = (Wd - cwW) / 2;
  g += rect(R(D - cwD + gap * 0.3, D - gap * 0.6, s0, s0 + cwW), 'fill="#d9dce0" stroke="#333" stroke-width="0.6"');
  for (const sR of [s0 - 2.5, s0 + cwW + 0.5]) g += rect(R(D - cwD + gap * 0.1, D - gap * 0.4, sR, sR + 2), 'fill="#333"');
  // the car's guide rails, half way along its sides
  const fm = (front + D - cwD - gap) / 2;
  for (const sR of [gap * 0.3, Wd - gap * 1.2]) g += rect(R(fm - 3, fm + 3, sR, sR + gap * 0.9), 'fill="#333"');
  return g;
}
function stairSvg(st, X, Y, W, H) {
  if (!st) return "";
  const along = H >= W, L = along ? H : W, A = along ? W : H;
  const k = L / (st.run + 2 * st.landing), run = st.run * k, land = st.landing * k, fw = (A - st.well * (A / st.W)) / 2, wl = A - 2 * fw;
  let g = "";
  const P = (u, v) => (along ? [X + v, Y + u] : [X + u, Y + v]);
  const line = (u1, v1, u2, v2, w = 0.6, extra = "") => { const [a, b] = P(u1, v1), [c, d] = P(u2, v2); return `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="#222" stroke-width="${w}"${extra} />`; };
  const [wx, wy] = P(land, fw), [ww, wh] = along ? [wl, run] : [run, wl];
  // the break line: a zig-zag across the flight where the plan cuts it (the treads beyond are above the cut: dashed)
  const uB = land + run * 0.5;
  // the break: two parallel zig-zag lines about 150 mm apart, white between them
  const gapB = Math.max(3, 0.15 * SC);
  const zig = (u0, v0, v1) => { const dv = v1 - v0, z = Math.min(run * 0.08, Math.abs(dv) * 0.3); return [[u0 + z * 2, v0], [u0 + z * 0.5, v0 + dv * 0.42], [u0 + z * 1.5, v0 + dv * 0.5], [u0 - z * 0.5, v0 + dv * 0.58], [u0 - z * 2, v1]].map(([u, v]) => P(u, v)); };
  const brk = (v0, v1) => { const A = zig(uB + gapB / 2, v0, v1), B = zig(uB - gapB / 2, v0, v1), pl = (q) => q.map((p) => p.join(",")).join(" ");
    return `<polygon points="${pl([...A, ...B.slice().reverse()])}" fill="#fff" stroke="none" /><polyline points="${pl(A)}" fill="none" stroke="#222" stroke-width="0.9" /><polyline points="${pl(B)}" fill="none" stroke="#222" stroke-width="0.9" />`; };
  // the walking line: a dot and its label at its start, along its points, an arrowhead and a label at its end
  const walk = (pts, l0, l1) => { const Q = pts.map(([u, v]) => P(u, v)), n2 = Q.length, [c, d] = Q[n2 - 1], [a, b] = Q[n2 - 2], ang = Math.atan2(d - b, c - a), hx = c - 6 * Math.cos(ang - 0.45), hy = d - 6 * Math.sin(ang - 0.45), jx = c - 6 * Math.cos(ang + 0.45), jy = d - 6 * Math.sin(ang + 0.45);
    const lab = (p, t, dy) => `<text x="${p[0]}" y="${p[1] + dy}" text-anchor="middle" font-size="7" font-weight="600" fill="#a5642a">${t}</text>`;
    return `<polyline points="${Q.map((q) => q.join(",")).join(" ")}" fill="none" stroke="#a5642a" stroke-width="0.9" /><path d="M ${hx} ${hy} L ${c} ${d} L ${jx} ${jy} Z" fill="#a5642a" /><circle cx="${Q[0][0]}" cy="${Q[0][1]}" r="1.8" fill="#a5642a" />` + (l0 ? lab(Q[0], l0, along ? 9 : -4) : "") + (l1 ? lab(Q[n2 - 1], l1, along ? 9 : -4) : ""); };
  const tread = (u, v0, v1, cut) => line(u, v0, u, v1, 0.5, cut && u < uB ? ' stroke-dasharray="2 1.5" stroke-opacity="0.7"' : "");
  g += line(land, 0, land, A, 0.8) + line(land + run, 0, land + run, A, 0.8);
  if (st.type === "scissor") {
    g += `<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" fill="url(#fl-rc)" stroke="#222" stroke-width="0.8" />`;
    for (let i = 1; i < st.t1; i++) { const u = land + i * run / st.t1; g += tread(u, 0, fw, true) + line(u, fw + wl, u, A, 0.5, u > land + run - (uB - land) ? ' stroke-dasharray="2 1.5" stroke-opacity="0.7"' : ""); }
    g += brk(0, fw) + brk(fw + wl, A);
    g += walk([[land + run * 0.95, fw / 2], [land + run * 0.06, fw / 2]], "UP A", "") + walk([[land + run * 0.05, fw + wl + fw / 2], [land + run * 0.94, fw + wl + fw / 2]], "UP B", "");
  } else {
    g += `<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" fill="#fff" stroke="#222" stroke-width="0.8" />`;
    for (let i = 1; i < st.t1; i++) g += tread(land + i * run / st.t1, 0, fw, true);
    for (let i = 1; i < st.t2; i++) g += tread(land + i * run / st.t2, fw + wl, A, false);
    if (st.land2) g += line(0, fw, land, fw, 0.5) + line(0, fw + wl, land, fw + wl, 0.5);
    g += brk(0, fw);
    // UP from the floor's landing to the break; DN from the floor's landing down the other flight
    // one walking line: UP at the foot of the first flight, up it, across the half landing, down the second to DN
    g += walk([[land + run * 0.95, fw / 2], [land * 0.5, fw / 2], [land * 0.5, fw + wl + fw / 2], [land + run * 0.95, fw + wl + fw / 2]], "UP", "DN");
  }
  // the risers and going: on the half landing, clear of the walking line across it
  const [lx, ly] = P(st.type === "scissor" ? land / 2 : land * 0.2, st.land2 ? A / 4 : A / 2);
  g += `<text x="${lx}" y="${ly + 3}" text-anchor="middle" font-size="7" fill="#333" pointer-events="none">${st.risers}R@${Math.round(st.riser * 1000)} · ${Math.round(st.going * 1000)}G</text>`;
  return g;
}
const toPlan = (ev) => { const b = $("#st-fplan").getBoundingClientRect(); return [X0 + (ev.clientX - b.left - OX) / SC, Y0 + (ev.clientY - b.top - OY) / SC]; };
/* the edges a dragged thing may snap to, along x and across y, in a leg's frame */
function edgesFor(l, skipUnit, skipCore, skipVert) {
  const r = l.r, ex = [0, r.L], ey = [0, r.D, r.y0, r.y1];
  r.placed.forEach((q, i) => { if (i !== skipUnit) { ex.push(q.x, q.x + q.w); ey.push(q.y, q.y + q.h); const g2 = (q.wt || 0) / 2; for (const rm of q.rooms) { ex.push(q.x + rm.x - g2, q.x + rm.x + rm.w + g2); ey.push(q.y + rm.y - g2, q.y + rm.y + rm.h + g2); } for (const e of q.extras || []) { ex.push(q.x + e.x, q.x + e.x + e.w); ey.push(q.y + e.y, q.y + e.y + e.h); } } });
  const cwl = r.coreWall || 0.25;
  r.core.forEach((c, i) => { if (i !== skipCore) { ex.push(c.x, c.x + c.w, c.x + cwl, c.x + c.w - cwl, c.x + cwl / 2, c.x + c.w - cwl / 2); ey.push(c.y, c.y + c.h, c.y + cwl, c.y + c.h - cwl); } });
  // the grid, when shown (in the plate frame: for a leg along it)
  if (GRID() && Math.abs(l.xf.c - 1) < 1e-6) {
    const G = gridLines(LAST); ex.push(...G.x.map((q) => q.at - l.xf.ox)); ey.push(...G.y.map((q) => q.at - l.xf.oy));
    for (let v = Math.floor(Math.min(0, ...r.F.poly.map((p) => p[0]))); v <= Math.max(r.L, ...r.F.poly.map((p) => p[0])) + 1; v++) ex.push(v);
    for (let v = Math.floor(Math.min(0, ...r.F.poly.map((p) => p[1]))); v <= Math.max(r.D, ...r.F.poly.map((p) => p[1])) + 1; v++) ey.push(v);
  }
  if (skipVert != null) LAST.F.poly.forEach((p, i) => { if (i !== skipVert) { ex.push(p[0]); ey.push(p[1]); } });
  return { ex, ey };
}
/* the structural grid: lines every gridX along the corridor (1, 2, 3 ...) and gridY across it (A, B, C ...), from the plate frame's origin plus an offset */
function gridLines(r) {
  const x = cur(), f = (x && x.g.floor) || {}, out = { x: [], y: [] };
  const gx = Number(f.gridX) || 0, gy = Number(f.gridY) || 0, ox = Number(f.gridOX) || 0, oy = Number(f.gridOY) || 0;
  if (gx >= 1) for (let k = 0, v = ox; v <= r.L + 1e-6 && k < 200; k++, v += gx) out.x.push({ at: R3(v), lab: String(k + 1) });
  if (gy >= 1) for (let k = 0, v = oy; v <= r.D + 1e-6 && k < 26; k++, v += gy) out.y.push({ at: R3(v), lab: String.fromCharCode(65 + k) });
  return out;
}
/* where a dragged unit or piece is now (snapped), in its leg's metres */
function dragAt(d, alt) {
  const l = legK(d.leg), r = l.r, snap = SNAP() && !alt;
  if (d.k === "unit") {
    const q = r.placed[d.li], cx = q.x + d.dx / SC, cy = q.y + q.h / 2 + d.dy / SC;
    const band = cy > r.y0 + r.cw / 2 ? "s" : "n";
    const y = band === "s" ? r.y1 + q.wt / 2 : r.y0 - q.h - q.wt / 2;
    const { ex } = edgesFor(l, d.li, -1);
    return { x: snap ? FC.snap1(cx, q.w, ex) : Math.round(cx * 20) / 20, y, band };
  }
  const c = r.core[d.li], x = c.x + d.dx / SC, y = c.y + d.dy / SC, { ex, ey } = edgesFor(l, -1, d.li);
  return { x: snap ? FC.snap1(x, c.w, ex) : Math.round(x * 20) / 20, y: snap ? FC.snap1(y, c.h, ey) : Math.round(y * 20) / 20 };
}
/* a drop onto another unit / piece of the same leg swaps them (global indices) */
function dropTarget(d) {
  const l = legK(d.leg), r = l.r, P = d.k === "unit" ? r.placed[d.li] : r.core[d.li]; if (!P) return null;
  const cx = P.x + P.w / 2 + d.dx / SC, cy = P.y + P.h / 2 + d.dy / SC;
  const on = (o) => cx >= o.x && cx <= o.x + o.w && cy >= o.y && cy <= o.y + o.h;
  if (d.k === "unit") { const k = r.placed.findIndex((o, j) => j !== d.li && on(o)); return k >= 0 ? { pi: l.po + k } : null; }
  const k = r.core.findIndex((o, j) => j !== d.li && on(o)); return k >= 0 ? { ci: l.co + k } : null;
}
/* swap two units' places: what stands there changes, the places stay */
function swapEntries(SQ, a, b) {
  const A = SQ(a.leg)[a.band][a.i], B = SQ(b.leg)[b.band][b.i];
  for (const k of ["u", "m", "r"]) { const t = A[k]; if (B[k] == null) delete A[k]; else A[k] = B[k]; if (t == null) delete B[k]; else B[k] = t; }
}
function unitAction(k) {
  const r = LAST, q = r && r.placed[PSEL]; if (!q) return;
  if (k === "swap") { SWAP = !SWAP; return drawPlan(); }
  if (k === "copy") return copySel(false);
  const me = entryOf(q);
  if (k === "edit" || k === "variant") {
    if (!C.can()) return;
    const st = UN.store(), x = cur(), nm = q.entry.u || q.name;
    let i = st.list.findIndex((u) => u.name === nm);
    if (i < 0) return toast("That unit is not in 3 · Units", true);
    if (k === "variant") {
      const base = st.list[i], c = JSON.parse(JSON.stringify(base)); delete c.orig; delete c.libId;
      let n2 = 1; while (st.list.some((u) => u.name === `${base.variantOf || base.name} (variant ${n2})`)) n2++;
      c.variantOf = base.variantOf || base.name; c.name = `${c.variantOf} (variant ${n2})`;
      st.list.push(c); i = st.list.length - 1;
      edit((SQ) => { SQ(me.leg)[me.band][me.i].u = c.name; return PSEL; });
    }
    st.sel = i; C.save();
    $("#st-fpanel").hidden = true; PT.unmount("floors");
    let live = 0;
    UN.show(true, { inplace: true, onChange: () => { if (!live) live = requestAnimationFrame(() => { live = 0; const x2 = cur(); if (x2) { LAST = compute(x2); drawPlan(); } }); }, title: `${x ? x.label : "The floor"}`, onDone: () => { $("#st-fpanel").hidden = !ON; document.body.classList.add("st-floors"); render(); } });
    return;
  }
  if (k === "flip") return edit((SQ) => { const e = SQ(me.leg)[me.band][me.i]; e.m = !e.m; return PSEL; });
  if (k === "rot") return edit((SQ) => { const e = SQ(me.leg)[me.band][me.i]; e.r = ((Number(e.r) || 0) + 90) % 360; if (!e.r) delete e.r; if (e.x == null) e.x = R3(q.x - legK(me.leg).A[0]); return PSEL; });
  if (k === "free") return edit((SQ) => { delete SQ(me.leg)[me.band][me.i].x; });
  if (k === "del") return edit((SQ) => { SQ(me.leg)[me.band].splice(me.i, 1); });
}
function coreAction(k) {
  const r = LAST, c = r && r.core[CSEL]; if (!c) return;
  if (k === "swap") { SWAP = !SWAP; return drawPlan(); }
  if (k === "copy") return copySel(false);
  if (k === "reset") { editFloor((f) => { delete f.pieces; }); CSEL = null; return; }
  const i = pIdx(CSEL);
  if (k === "rot") return editCore((P) => { const q = P[i], cx = q.x + q.w / 2, cy = q.y + q.h / 2; [q.w, q.h] = [q.h, q.w]; q.x = Math.round((cx - q.w / 2) * 20) / 20; q.y = Math.round((cy - q.h / 2) * 20) / 20; return i; });
  if (k === "del") { CSEL = null; return editCore((P) => { P.splice(i, 1); }); }
  if (k === "reroute") return editCore((P) => { P[i].auto = true; return i; });
  if (k === "bend" || k === "unbend") return editCore((P) => {
    const q = P[i]; if (!Array.isArray(q.path)) q.path = FC.passageShape(Object.assign({}, q)).path; if (q.for) q.auto = false;
    if (k === "unbend") { if (q.path.length > 2) q.path.splice(q.path.length - 2, 1); q.path = FC.orthoPath(q.path); return i; }
    let best = 0, bl = -1;
    for (let j = 0; j < q.path.length - 1; j++) { const len = Math.hypot(q.path[j + 1][0] - q.path[j][0], q.path[j + 1][1] - q.path[j][1]); if (len > bl) { bl = len; best = j; } }
    const a = q.path[best], b = q.path[best + 1];
    q.path.splice(best + 1, 0, [R3((a[0] + b[0]) / 2), R3((a[1] + b[1]) / 2)]);
    return i;
  });
  if (k === "lift") return editCore((P) => { const L = P.filter((q) => q.kind === "lift"), last = L[L.length - 1] || P[i]; P.push({ kind: "lift", label: "Lift " + (L.length + 1), x: Math.round((last.x + last.w) * 20) / 20, y: last.y, w: FC.DEF.lift[0], h: FC.DEF.lift[1], leg: last.leg }); return P.length - 1; });
}
function swapCore(P, a, b) { const A = P[a], B = P[b]; const ax = A.x, ay = A.y; A.x = B.x + (B.w - A.w) / 2; A.y = B.y + (B.h - A.h) / 2; B.x = ax + (A.w - B.w) / 2; B.y = ay + (A.h - B.h) / 2; for (const q of [A, B]) { q.x = Math.round(q.x * 20) / 20; q.y = Math.round(q.y * 20) / 20; } }

/* ---------- making things: a core piece, a unit, a polyline finished */
function addPiece(kind, P) {
  const r = LAST, o = opts(cur()), cwl = r.coreWall || 0.25, st = r.stair, l = legAt(P), lp = toLeg(l, P);
  const [cw0, ch0] = kind === "stair" ? [st.W, st.D] : kind === "lift" ? o.lift : kind === "refuse" ? o.refuse : kind === "riser" ? o.emr : [st.W, Number(o.lobbyDepth) || 1.8];
  const n2 = (k2) => r.core.filter((c) => c.kind === k2).length;
  const lab = { lobby: "Lobby", stair: "Stair " + String.fromCharCode(65 + n2("stair")), lift: "Lift " + (n2("lift") + 1), refuse: "Refuse", riser: "E&M riser" }[kind];
  const w = cw0 + 2 * cwl, h = ch0 + 2 * cwl;
  return editCore((Pc) => { Pc.push({ kind, label: lab, x: R3(lp[0] - w / 2 - l.A[0]), y: R3(lp[1] - h / 2 - l.A[1]), w: R3(w), h: R3(h), full: true, leg: l.k }); return Pc.length - 1; });
}
function addUnit(name, P) {
  if (!name) return toast("Choose the unit in the bar first", true);
  const l = legAt(P), lp = toLeg(l, P), band = lp[1] > (l.r.y0 + l.r.y1) / 2 ? "s" : "n";
  const u = units().find((v) => v.name === name), w = u ? FC.turn(u, 0).W : 6;
  return edit((SQ) => { SQ(l.k)[band].push({ u: name, m: false, x: R3(lp[0] - w / 2 - l.A[0]) }); });
}
function finishDraw() {
  const W = WALLDRAW; if (!W) return;
  const pts = WC.cleanPath(W.pts);
  WALLDRAW = { kind: W.kind, pts: [] };
  if (pts.length < 2) return drawPlan();
  if (W.kind === "wall") { const wt = WT(); return editWalls((A) => { A.push({ path: pts.map((p) => [R3(p[0]), R3(p[1])]), t: wt.t || Number(opts(cur()).coreWall) || 0.25, m: wt.m, just: wt.just }); return A.length - 1; }); }
  if (W.kind === "corridor") { setTool("select"); return editSpine(() => pts); }
  if (W.kind === "lobby") {
    const l = legAt(pts[0]), lp = pts.map((p) => toLeg(l, p)).map((p) => [R3(p[0] - l.A[0]), R3(p[1] - l.A[1])]);
    return editCore((P) => { P.push({ kind: "passage", label: "Passage", path: FC.orthoPath(lp), width: Number(opts(cur()).corridor) || 1.5, leg: l.k, auto: false }); return P.length - 1; });
  }
}
/* a typed length: the next point that far along the line to the pointer */
function typedPoint() {
  const W = WALLDRAW, L = parseFloat(W.typed); W.typed = "";
  if (!(L > 0) || !W.pts.length) return drawPlan();
  const a = W.pts[W.pts.length - 1], b = W.hover || [a[0] + 1, a[1]], d = WC.dirOf(a, b).d;
  W.pts.push([R3(a[0] + d[0] * L), R3(a[1] + d[1] * L)]);
  drawPlan();
}
/* a point being drawn: onto a wall's end or face end, the plate's corners, else held to 15° steps from the last (Shift: free) */
/* what a wall's point snaps to, in the plate frame (worked out once a layout): the corners and faces of the units'
   walls (their outer faces, the balconies left out), of the core's walls, the corridor's sides, the plate, the floor walls */
let SNAPG = null;
function snapGeo() {
  if (SNAPG && SNAPG.r === LAST) return SNAPG;
  const pts = [], segs = [], quad = (Q) => { pts.push(...Q); for (let k = 0; k < Q.length; k++) segs.push([Q[k], Q[(k + 1) % Q.length]]); };
  quad(LAST.F.poly);
  for (const l of legs()) {
    const r = l.r, cw = r.coreWall || 0.25;
    const rect = (x0, y0, x1, y1) => quad([[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map((q) => fromLeg(l, q)));
    for (const q of r.placed) {
      const g2 = (q.wt || 0.15) / 2; for (const rm of q.rooms) rect(q.x + rm.x - g2, q.y + rm.y - g2, q.x + rm.x + rm.w + g2, q.y + rm.y + rm.h + g2);
      // the walls as built (their real faces)
      for (const w of FC.placedWalls(q, { x: q.x, y: q.y }).rects) rect(w.x0, w.y0, w.x1, w.y1);
    }
    // a core piece's box is out to its walls' outer faces; their inner faces a wall in
    for (const c of r.core) if (c.kind !== "passage") { const t = Number(c.wt) > 0 ? Number(c.wt) : cw; rect(c.x, c.y, c.x + c.w, c.y + c.h); rect(c.x + t, c.y + t, c.x + c.w - t, c.y + c.h - t); }
    // the corridor's own box (marked, so its end is not snapped to itself)
    if (r.corr) { const n0 = segs.length; rect(r.corr.x0, r.y0, r.corr.x1, r.y1); for (let k = n0; k < segs.length; k++) segs[k][0] = Object.assign(segs[k][0].slice(), { corr: true }); }
  }
  for (const w of LAST.walls || []) {
    pts.push(...w.path);
    const [oa, ob] = WC.offsets(w.t, w.just);
    for (const o of [oa, ob]) { const q = WC.offsetPath(w.path, o); pts.push(q[0], q[q.length - 1]); for (let k = 0; k < q.length - 1; k++) segs.push([q[k], q[k + 1]]); }
  }
  return (SNAPG = { r: LAST, pts, segs });
}
/* a plan point snapped: to a corner near it; else where the line from the last point (in 15° steps) meets a face near it;
   else onto a face near it; else the 15° step and a length in 50 mm. Alt: free; Shift: any angle */
function snapPoint(P, last, ev, extra) {
  const tol = 12 / SC, free = !SNAP() || ev.altKey;
  if (!free) {
    const G = snapGeo(), cands = [...G.pts, ...(extra || [])];
    let best = null, bd = tol;
    for (const c of cands) { const d = Math.hypot(c[0] - P[0], c[1] - P[1]); if (d < bd) { bd = d; best = c; } }
    if (best) return [R3(best[0]), R3(best[1])];
    // the line from the last point at its angle step, to where it meets a face
    if (last && !ev.shiftKey) {
      const q0 = WC.snapAngle(last, P, 15), d = WC.dirOf(last, q0).d; let bt = null, bd2 = tol;
      for (const [a, b] of G.segs) {
        const ex = b[0] - a[0], ey = b[1] - a[1], den = d[0] * ey - d[1] * ex; if (Math.abs(den) < 1e-9) continue;
        const t = ((a[0] - last[0]) * ey - (a[1] - last[1]) * ex) / den, u = ((a[0] - last[0]) * d[1] - (a[1] - last[1]) * d[0]) / den;
        if (t <= 0.05 || u < -1e-6 || u > 1 + 1e-6) continue;
        const X = [last[0] + d[0] * t, last[1] + d[1] * t], dd = Math.hypot(X[0] - q0[0], X[1] - q0[1]); if (dd < bd2) { bd2 = dd; bt = X; }
      }
      if (bt) return [R3(bt[0]), R3(bt[1])];
    }
    // onto the face nearest
    let bs = null, bd3 = tol;
    for (const [a, b] of G.segs) { const q = WC.nearestOnPath(P, [a, b]); if (q && q.d < bd3) { bd3 = q.d; bs = q.p; } }
    if (bs && !last) return [R3(bs[0]), R3(bs[1])];
    if (bs && last && ev.shiftKey) return [R3(bs[0]), R3(bs[1])];
  }
  let q = last && !ev.shiftKey ? WC.snapAngle(last, P, 15) : P;
  if (!free && last) { const L = Math.hypot(q[0] - last[0], q[1] - last[1]), L2 = Math.round(L * 20) / 20, d = WC.dirOf(last, q).d; q = [last[0] + d[0] * L2, last[1] + d[1] * L2]; }
  else if (!free && !last) q = [Math.round(q[0] * 20) / 20, Math.round(q[1] * 20) / 20];
  return [R3(q[0]), R3(q[1])];
}
function drawPt(ev) {
  const P = toPlan(ev), W = WALLDRAW, last = W && W.pts[W.pts.length - 1];
  const extra = [...(W && W.kind !== "wall" ? LAST.spine.path : []), ...(W ? W.pts.slice(0, -1) : [])];
  return snapPoint(P, last, ev, extra);
}

/* ---------- openings: dropped from the library, added by right-click, slid along their walls */
const LIBTYPE = { door: "door", door2: "door2", doorU: "door2", sliding: "sliding", sliding2: "sliding2", opening: "opening", panel: "panel", window: "window", cw: "cw" };
/* where an opening would go at a plate-frame point: on a core piece's face, or a floor wall */
function openingTarget(P, w) {
  for (const l of legs()) {
    const lp = toLeg(l, P);
    for (const [li, c] of l.r.core.entries()) {
      if (c.kind === "passage") continue;
      if (lp[0] < c.x - 0.4 || lp[0] > c.x + c.w + 0.4 || lp[1] < c.y - 0.4 || lp[1] > c.y + c.h + 0.4) continue;
      const f = nearestFace(c, lp), t = Number(c.wt) > 0 ? Number(c.wt) : LAST.coreWall || 0.25, horiz = f.side === "n" || f.side === "s";
      const a0 = (horiz ? c.x : c.y) + t, L = (horiz ? c.w : c.h) - 2 * t, at = Math.max(0, Math.min(1, ((horiz ? lp[0] : lp[1]) - a0) / (L || 1)));
      const m = a0 + L * at, h = Math.min(w, L) / 2, line = f.side === "n" ? c.y + t / 2 : f.side === "s" ? c.y + c.h - t / 2 : f.side === "w" ? c.x + t / 2 : c.x + c.w - t / 2;
      const a = horiz ? [m - h, line] : [line, m - h], b = horiz ? [m + h, line] : [line, m + h];
      return { kind: "core", ci: l.co + li, side: f.side, at: R3(at), a: fromLeg(l, a), b: fromLeg(l, b), t };
    }
  }
  const q = WC.nearestOnWalls(P, LAST.walls || [], 0.6);
  if (q) { const wl = LAST.walls[q.i], o = WC.placeOpening(wl, q.seg, q.s, { w }); const [oa, ob] = WC.offsets(wl.t, wl.just), c = WC.offsetPath(wl.path, (oa + ob) / 2), d = WC.dirOf(c[q.seg], c[q.seg + 1]).d; return { kind: "wall", wi: q.i, seg: q.seg, at: o.at, w: o.w, a: [c[q.seg][0] + d[0] * o.at, c[q.seg][1] + d[1] * o.at], b: [c[q.seg][0] + d[0] * (o.at + o.w), c[q.seg][1] + d[1] * (o.at + o.w)], t: wl.t }; }
  return null;
}
function nearestFace(c, p) {
  const d = { n: Math.abs(p[1] - c.y), s: Math.abs(p[1] - (c.y + c.h)), w: Math.abs(p[0] - c.x), e: Math.abs(p[0] - (c.x + c.w)) };
  const side = Object.keys(d).sort((a, b) => d[a] - d[b])[0];
  return { side, d: d[side] };
}
function addOpening(tg, type, w) {
  if (!tg) return toast("Drop it on a wall: a core piece's or one drawn on the floor (a unit's doors are edited in 3 · Units)", true);
  if (tg.kind === "wall") return editWalls((A) => { const wl = A[tg.wi]; wl.openings = Array.isArray(wl.openings) ? wl.openings : []; wl.openings.push({ seg: tg.seg, at: tg.at, w: R3(w), type }); OPSEL = { wi: tg.wi, oi: wl.openings.length - 1 }; return null; });
  const i = pIdx(tg.ci), c = LAST.core[tg.ci];
  // dropped on a door already there (its own, or one added): that one becomes this, not a second one over it
  const t = Number(c.wt) > 0 ? Number(c.wt) : LAST.coreWall || 0.25, L = ((tg.side === "n" || tg.side === "s") ? c.w : c.h) - 2 * t;
  const hit = (c.doors || []).find((d) => d.side === tg.side && Math.abs(atOnFace(c, d) - tg.at) * L < (w + (d.w || 0.9)) / 2 - 0.02);
  return editCore((P) => {
    const q = P[i]; q.openings = Array.isArray(q.openings) ? q.openings : [];
    if (hit && hit.oi != null && q.openings[hit.oi]) Object.assign(q.openings[hit.oi], { side: tg.side, at: tg.at, w: R3(w), type });
    else if (hit) q.door = Object.assign({}, q.door, { side: tg.side, at: tg.at, type });
    else q.openings.push({ side: tg.side, at: tg.at, w: R3(w), type });
    return i;
  });
}
function libOver(item, ev) {
  if (!ON || VIEW !== "plan" || !LAST) return;
  const b = $("#st-fplan").getBoundingClientRect();
  const inside = ev.clientX >= b.left && ev.clientX <= b.right && ev.clientY >= b.top && ev.clientY <= b.bottom;
  LIBHOV = inside ? openingTarget(toPlan(ev), item.w) : null;
  if (!drawPlan.raf) drawPlan.raf = requestAnimationFrame(() => { drawPlan.raf = 0; drawPlan(); });
}
function libDrop(item, ev) {
  if (!ON || !LAST) return;
  const b = $("#st-fplan").getBoundingClientRect();
  LIBHOV = null;
  if (ev.clientX < b.left || ev.clientX > b.right || ev.clientY < b.top || ev.clientY > b.bottom) return drawPlan();
  addOpening(openingTarget(toPlan(ev), item.w), LIBTYPE[item.id] || "door", item.w);
}

/* ---------- the clipboard and the right-click menu */
function copySel(cut) {
  const r = LAST; if (!r) return false;
  if (PSEL != null && r.placed[PSEL]) { const q = r.placed[PSEL]; PT.clip.set("unit", { u: q.entry.u || q.name, m: q.m, r: q.r || 0, w: q.w }); toast("Unit copied"); if (cut) unitAction("del"); return; }
  if (CSEL != null && r.core[CSEL]) { const c = r.coreOut[pIdx(CSEL)] || r.coreOut[CSEL]; PT.clip.set("piece", c); toast(`${c.label} copied`); if (cut) coreAction("del"); return; }
  if (WSEL != null && r.walls[WSEL]) { const w = (cur().g.floor.walls || [])[WSEL]; PT.clip.set("wall", w); toast("Wall copied"); if (cut) delSel(); return; }
  if (OPSEL) { const o = opAt(OPSEL); PT.clip.set("opening", { type: o.type, w: o.w }); toast("Opening copied"); if (cut) delSel(); return; }
  return false;
}
function paste(P) {
  const c = PT.clip.get(); if (!c || !LAST) return toast("Nothing copied yet", true);
  if (c.kind === "unit") { const l = legAt(P), lp = toLeg(l, P), band = lp[1] > (l.r.y0 + l.r.y1) / 2 ? "s" : "n"; return edit((SQ) => { SQ(l.k)[band].push(Object.assign({ u: c.data.u, m: !!c.data.m, x: R3(lp[0] - (c.data.w || 6) / 2 - l.A[0]) }, c.data.r ? { r: c.data.r } : {})); }); }
  if (c.kind === "piece") { const l = legAt(P), lp = toLeg(l, P), q = Object.assign({}, c.data); delete q.path; delete q.door; delete q.openings; q.leg = l.k; q.x = R3(lp[0] - q.w / 2 - l.A[0]); q.y = R3(lp[1] - q.h / 2 - l.A[1]); q.label = q.label.replace(/\d+$/, (d) => String(Number(d) + 1)); return editCore((Pc) => { Pc.push(q); return Pc.length - 1; }); }
  if (c.kind === "wall") { const w = c.data, cx = w.path.reduce((s, p) => s + p[0], 0) / w.path.length, cy = w.path.reduce((s, p) => s + p[1], 0) / w.path.length; return editWalls((A) => { A.push(Object.assign({}, w, { path: w.path.map((p) => [R3(p[0] - cx + P[0]), R3(p[1] - cy + P[1])]) })); return A.length - 1; }); }
  if (c.kind === "opening") return addOpening(openingTarget(P, c.data.w), c.data.type, c.data.w);
}
function duplicate() {
  const r = LAST; if (!r) return false;
  if (copySel(false) === false) return false;
  let P = mid();
  if (PSEL != null) { const q = r.placed[PSEL], l = legK(q.leg || 0); P = fromLeg(l, [q.x + q.w * 1.5 + 0.2, q.y + q.h / 2]); }
  else if (CSEL != null) { const c = r.core[CSEL], l = legK(c.leg || 0); P = fromLeg(l, [c.x + c.w * 1.5, c.y + c.h / 2]); }
  else if (WSEL != null) { const w = r.walls[WSEL]; P = [w.path.reduce((s, p) => s + p[0], 0) / w.path.length + 1, w.path.reduce((s, p) => s + p[1], 0) / w.path.length + 1]; }
  paste(P);
}
function delSel() {
  const r = LAST; if (!r) return false;
  if (PSEL != null) return unitAction("del");
  if (CSEL != null) return coreAction("del");
  if (WSEL != null) { const k = WSEL; WSEL = null; return editWalls((A) => { A.splice(k, 1); }); }
  if (OPSEL) {
    const s = OPSEL; OPSEL = null;
    if (s.wi != null) return editWalls((A) => { A[s.wi].openings.splice(s.oi, 1); return s.wi; });
    const c = r.core[s.ci], d = c.doors[s.di], i = pIdx(s.ci);
    if (d.oi != null) return editCore((P) => { P[i].openings.splice(d.oi, 1); return i; });
    return toast("A piece keeps its own door: change its type, or drag it along the wall", true);
  }
  if (VSEL != null) return removeCorner(VSEL);
  return false;
}
function onContext(ev) {
  if (!LAST || !C.can() || VIEW !== "plan") return;
  ev.preventDefault();
  if (WALLDRAW && WALLDRAW.pts.length) { finishDraw(); return; }
  const t = ev.target, P = toPlan(ev); CTXP = P;
  const hasClip = !!PT.clip.get(), M2 = [];
  const common = (copyOk) => [{ label: "Cut", key: "Ctrl+X", action: () => copySel(true), disabled: !copyOk }, { label: "Copy", key: "Ctrl+C", action: () => copySel(false), disabled: !copyOk }, { label: "Paste here", key: "Ctrl+V", action: () => paste(P), disabled: !hasClip }, { label: "Duplicate", key: "Ctrl+D", action: duplicate, disabled: !copyOk }];
  const addOps = (tg) => [{ label: "Add a door here", action: () => addOpening(tg, "door", 0.9) }, { label: "Add a sliding door here", action: () => addOpening(tg, "sliding2", 1.8) }, { label: "Add a window here", action: () => addOpening(tg, "window", 1.2) }, { label: "Add an opening here", action: () => addOpening(tg, "opening", 0.9) }];
  clearSel();
  if (t.dataset.pi != null) {
    PSEL = +t.dataset.pi; drawPlan();
    M2.push(...common(true), "-", { label: "Mirror", action: () => unitAction("flip") }, { label: "Rotate 90°", action: () => unitAction("rot") }, { label: "Swap with …", action: () => unitAction("swap") }, { label: "Edit in place", action: () => unitAction("edit") }, "-", { label: "Delete", key: "Del", danger: true, action: () => unitAction("del") });
  } else if (t.dataset.ci != null || t.dataset.cdo != null) {
    const ci = t.dataset.ci != null ? +t.dataset.ci : +t.dataset.cdo.split(":")[0];
    CSEL = ci; drawPlan();
    const tg = openingTarget(P, 0.9);
    if (t.dataset.cdo != null) { const [c1, d1] = t.dataset.cdo.split(":").map(Number); OPSEL = { ci: c1, di: d1 }; CSEL = null; M2.push({ label: "Make it a door", action: () => editOpening((o) => { o.type = "door"; }) }, { label: "Make it sliding", action: () => editOpening((o) => { o.type = "sliding2"; }) }, { label: "Make it an opening", action: () => editOpening((o) => { o.type = "opening"; }) }, { label: "Make it a window", action: () => editOpening((o) => { o.type = "window"; }) }, "-", { label: "Delete", danger: true, action: delSel }); }
    else M2.push(...(tg && tg.kind === "core" && tg.ci === ci ? addOps(tg) : []), "-", ...common(true), "-", { label: "Rotate 90°", action: () => coreAction("rot") }, { label: "Swap with …", action: () => coreAction("swap") }, { label: "Delete", key: "Del", danger: true, action: () => coreAction("del") });
  } else if (t.dataset.fw != null || t.dataset.fwo != null) {
    const wi = t.dataset.fw != null ? +t.dataset.fw : +t.dataset.fwo.split(":")[0];
    WSEL = wi; WSEG = t.dataset.seg != null ? +t.dataset.seg : 0; drawPlan();
    const tg = openingTarget(P, 0.9), q = WC.nearestOnWalls(P, LAST.walls, 2);
    if (t.dataset.fwo != null) { const [w1, o1] = t.dataset.fwo.split(":").map(Number); OPSEL = { wi: w1, oi: o1 }; WSEL = null; M2.push({ label: "Make it a door", action: () => editOpening((o) => { o.type = "door"; }) }, { label: "Make it sliding", action: () => editOpening((o) => { o.type = "sliding2"; }) }, { label: "Make it an opening", action: () => editOpening((o) => { o.type = "opening"; }) }, { label: "Make it a window", action: () => editOpening((o) => { o.type = "window"; }) }, "-", { label: "Delete", danger: true, action: delSel }); }
    else M2.push(...addOps(tg && tg.kind === "wall" ? tg : null), "-", { label: "Cut the wall here", action: () => q && editWalls((A) => { const parts = WC.splitWall(A[q.i], q.seg, q.s); A.splice(q.i, 1, ...parts); return q.i; }) }, { label: "Delete this segment", action: () => q && editWalls((A) => { const parts = WC.deleteSegment(A[q.i], q.seg); A.splice(q.i, 1, ...parts); }) }, "-", ...common(true), "-", { label: "Delete the wall", key: "Del", danger: true, action: delSel });
  } else if (t.dataset.spt != null) {
    const k = +t.dataset.spt; SPSEL = true; drawPlan();
    M2.push({ label: "Remove this bend", disabled: !(k > 0 && k < LAST.spine.path.length - 1), action: () => editSpine((sp) => { sp.splice(k, 1); return sp; }) });
  } else if (t.dataset.spine != null || t.dataset.spm != null) {
    SPSEL = true; drawPlan();
    const sp = LAST.spine.path, q = WC.nearestOnPath(P, sp);
    M2.push({ label: "Add a bend here", action: () => editSpine((s2) => { s2.splice(q.seg + 1, 0, [R3(q.p[0]), R3(q.p[1])]); return s2; }) }, { label: "Straight again", disabled: !(cur().g.floor || {}).spine, action: () => onTool("s:straight") }, "-", { label: "Paste here", action: () => paste(P), disabled: !hasClip });
  } else if (t.dataset.vi != null) {
    VSEL = +t.dataset.vi; drawPlan();
    M2.push({ label: "Remove the corner", danger: true, disabled: LAST.F.poly.length <= 3, action: () => removeCorner(+t.dataset.vi) });
  } else if (t.dataset.ptw != null) {
    PTSEL = { key: t.dataset.ptw, leg: +(t.dataset.leg || 0) }; drawPlan();
    return;
  } else {
    drawPlan();
    M2.push({ label: "Paste here", key: "Ctrl+V", action: () => paste(P), disabled: !hasClip }, "-", { label: "Wall", key: "W", action: () => setTool("wall") }, { label: "Staircase here", action: () => addPiece("stair", P) }, { label: "Lift here", action: () => addPiece("lift", P) }, { label: "Unit here", disabled: !ADDU(), action: () => addUnit(ADDU(), P) }, "-", { label: "Fit the view", key: "F", action: () => { VIEWKEY = ""; PZ.reset(ZM); drawPlan(); } });
  }
  PT.ctx(ev, M2);
}

/* ---------- the pointer */
function wirePlan() {
  const host = $("#st-fplan");
  let pan = null;
  host.addEventListener("auxclick", (ev) => { if (ev.button === 1) ev.preventDefault(); });
  host.addEventListener("mousedown", (ev) => { if (ev.button === 1) ev.preventDefault(); });   // no autoscroll
  host.addEventListener("contextmenu", onContext);
  host.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.pz) { if (b.dataset.pz === "fit") VIEWKEY = ""; return PZ.barClick(ZM, b, host.getBoundingClientRect(), drawPlan); }
  });
  host.addEventListener("dblclick", (ev) => { if (WALLDRAW) { ev.preventDefault(); finishDraw(); return; } const t = ev.target; if (t.dataset && t.dataset.vi != null) { ev.preventDefault(); removeCorner(+t.dataset.vi); } });
  host.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest(".pz-bar")) return;
    if (ev.button === 2) return;   // the right button: its menu
    // the middle button (or Space held): pan, whatever is under it
    if (ev.button === 1 || SPACE) { if (SPACE) SPACEPAN = true; ev.preventDefault(); DRAG = null; pan = { x: ev.clientX, y: ev.clientY, px: ZM.px, py: ZM.py, moved: false }; cap(host, ev); return; }
    if (TOOL === "measure" && LAST && ev.button === 0) { ev.preventDefault(); ME.click(MEAS, ME.snap(toPlan(ev), snapGeo(), 12 / SC)); drawPlan(); return; }
    const can = C.can(), t = ev.target;
    // drawing a polyline: each click a point; a second click on the last point (or double-click, Enter) ends it
    if (WALLDRAW && LAST && can && ev.button === 0) {
      ev.preventDefault();
      const q = drawPt(ev), last = WALLDRAW.pts[WALLDRAW.pts.length - 1], now = Date.now();
      if (last && WALLDRAW.t && now - WALLDRAW.t < 450 && Math.hypot(q[0] - last[0], q[1] - last[1]) * SC < 8) return finishDraw();
      if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < 1e-6) return;
      WALLDRAW.pts.push(q); WALLDRAW.t = now; WALLDRAW.hover = null; WALLDRAW.typed = ""; return drawPlan();
    }
    if (PZ.down(ZM, ev)) { DRAG = null; pan = null; cap(host, ev); ev.preventDefault(); return drawPlan(); }
    if (LAST && can && TOOL === "split") { ev.preventDefault(); const q = WC.nearestOnWalls(toPlan(ev), LAST.walls, 0.5); if (!q) return toast("Click on a wall to cut it", true); return editWalls((A) => { const parts = WC.splitWall(A[q.i], q.seg, q.s); A.splice(q.i, 1, ...parts); return q.i; }); }
    if (LAST && can && TOOL === "join") {
      ev.preventDefault(); const q = WC.nearestOnWalls(toPlan(ev), LAST.walls, 0.5); if (!q) return toast("Click on a wall", true);
      if (JOINA == null || JOINA === q.i) { JOINA = q.i; return drawPlan(); }
      const a = JOINA; JOINA = null;
      const fw = cur().g.floor.walls, j = WC.joinWalls(fw[a], fw[q.i], 0.05);
      if (!j) { toast("These two walls do not meet at their ends", true); return drawPlan(); }
      return editWalls((A) => { const lo = Math.min(a, q.i), hi = Math.max(a, q.i); A.splice(hi, 1); A.splice(lo, 1, j); return lo; });
    }
    if (LAST && can && TOOL === "unit") { ev.preventDefault(); return addUnit(ADDU() || (units()[0] || {}).name, toPlan(ev)); }
    if (LAST && can && TOOL.startsWith("add:")) { ev.preventDefault(); const k = TOOL.slice(4); setTool("select"); return addPiece(k, toPlan(ev)); }
    const legOfEl = () => { const gEl = t.closest("[data-legg]"); return gEl ? +gEl.dataset.legg : 0; };
    if (t.dataset.fwpt != null && WSEL != null && can) { DRAG = { k: "fwpt", i: WSEL, p: +t.dataset.fwpt, x: ev.clientX, y: ev.clientY, dx: 0, dy: 0, moved: false }; cap(host, ev); ev.preventDefault(); return; }
    if (t.dataset.fwseg != null && WSEL != null && can) { WSEG = +t.dataset.fwseg; DRAG = { k: "fwseg", i: WSEL, p: +t.dataset.fwseg, x: ev.clientX, y: ev.clientY, dx: 0, dy: 0, moved: false }; cap(host, ev); ev.preventDefault(); return; }
    if (t.dataset.spt != null && can) { DRAG = { k: "spt", p: +t.dataset.spt, x: ev.clientX, y: ev.clientY, dx: 0, dy: 0, moved: false }; cap(host, ev); ev.preventDefault(); return; }
    if (t.dataset.spm != null && can) { const k = +t.dataset.spm; ev.preventDefault(); return editSpine((sp) => { const a = sp[k], b = sp[k + 1]; sp.splice(k + 1, 0, [R3((a[0] + b[0]) / 2), R3((a[1] + b[1]) / 2)]); return sp; }); }
    if (t.dataset.fwo != null && can) { const [wi, oi] = t.dataset.fwo.split(":").map(Number); clearSel(); OPSEL = { wi, oi }; DRAG = { k: "fwo", wi, oi, x: ev.clientX, y: ev.clientY, moved: false }; cap(host, ev); ev.preventDefault(); return drawPlan(); }
    if (t.dataset.cdo != null && can) { const [ci, di] = t.dataset.cdo.split(":").map(Number); clearSel(); OPSEL = { ci, di }; DRAG = { k: "cdo", ci, di, leg: legOfEl(), x: ev.clientX, y: ev.clientY, moved: false }; cap(host, ev); ev.preventDefault(); return drawPlan(); }
    if (t.dataset.ptw != null && LAST) { const lg = +(t.dataset.leg || 0); const same = PTSEL && PTSEL.key === t.dataset.ptw && PTSEL.leg === lg; clearSel(); PTSEL = same ? null : { key: t.dataset.ptw, leg: lg }; ev.preventDefault(); return drawPlan(); }
    if (t.dataset.fw != null && LAST) { const wi = +t.dataset.fw; const same = WSEL === wi && WSEG === +(t.dataset.seg || 0); clearSel(); WSEL = same ? null : wi; WSEG = +(t.dataset.seg || 0); ev.preventDefault(); return drawPlan(); }
    if (t.dataset.vm != null && LAST && can) { const k = +t.dataset.vm; ev.preventDefault(); return editPlate((P) => { const a = P[k], b = P[(k + 1) % P.length]; P.splice(k + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); return P; }); }
    if (t.dataset.ce != null && LAST && can && CSEL != null) { DRAG = { k: "cedge", i: CSEL, li: CSEL - legK(LAST.core[CSEL].leg || 0).co, leg: LAST.core[CSEL].leg || 0, e: t.dataset.ce, x: ev.clientX, y: ev.clientY, dx: 0, dy: 0, moved: false }; cap(host, ev); ev.preventDefault(); return; }
    if (t.dataset.ppt != null && LAST && can && CSEL != null) { DRAG = { k: "ppt", i: CSEL, li: CSEL - legK(LAST.core[CSEL].leg || 0).co, leg: LAST.core[CSEL].leg || 0, p: +t.dataset.ppt, x: ev.clientX, y: ev.clientY, dx: 0, dy: 0, moved: false }; cap(host, ev); ev.preventDefault(); return; }
    if (t.dataset.vi != null && LAST && can) DRAG = { k: "vert", i: +t.dataset.vi, x: ev.clientX, y: ev.clientY, dx: 0, dy: 0, moved: false };
    else if (t.dataset.pi != null && LAST) { const L1 = localOf("placed", +t.dataset.pi, "po"); DRAG = { k: "unit", i: +t.dataset.pi, li: L1.i, leg: L1.l.k, x: ev.clientX, y: ev.clientY, dx: 0, dy: 0, moved: false }; }
    else if (t.dataset.ci != null && LAST) { const L1 = localOf("core", +t.dataset.ci, "co"); DRAG = { k: "core", i: +t.dataset.ci, li: L1.i, leg: L1.l.k, x: ev.clientX, y: ev.clientY, dx: 0, dy: 0, moved: false }; }
    else if (t.dataset.spine != null && LAST) { const q = WC.nearestOnPath(toPlan(ev), LAST.spine.path); DRAG = { k: "spsel", seg: q ? q.seg : 0, x: ev.clientX, y: ev.clientY, moved: false }; }
    else pan = { x: ev.clientX, y: ev.clientY, px: ZM.px, py: ZM.py, moved: false };
    cap(host, ev); ev.preventDefault();
  });
  host.addEventListener("pointermove", (ev) => {
    if (TOOL === "measure" && LAST && !pan) { MEAS.hover = ME.snap(toPlan(ev), snapGeo(), 12 / SC); if (!drawPlan.raf) drawPlan.raf = requestAnimationFrame(() => { drawPlan.raf = 0; drawPlan(); }); return; }
    if (WALLDRAW && LAST && WALLDRAW.pts.length) { WALLDRAW.hover = drawPt(ev); if (!drawPlan.raf) drawPlan.raf = requestAnimationFrame(() => { drawPlan.raf = 0; drawPlan(); }); return; }
    if (PZ.move(ZM, ev, host.getBoundingClientRect())) return drawPlan();
    if (pan) { const dx = ev.clientX - pan.x, dy = ev.clientY - pan.y; if (!pan.moved && Math.hypot(dx, dy) < 4) return; pan.moved = true; ZM.px = pan.px + dx; ZM.py = pan.py + dy; return drawPlan(); }
    if (!DRAG) return;
    const rdx = ev.clientX - DRAG.x, rdy = ev.clientY - DRAG.y;
    if (!DRAG.moved && Math.hypot(rdx, rdy) < 6) return;
    if (!C.can()) return;
    // the corridor dragged: selected as it moves
    if (DRAG.k === "spsel" && !SPSEL) { clearSel(); SPSEL = true; }
    DRAG.moved = true;
    const l = DRAG.leg != null ? legK(DRAG.leg) : null;
    const [dx, dy] = l ? rotIn(l, rdx, rdy) : [rdx, rdy];
    DRAG.dx = dx; DRAG.dy = dy;
    const snap = SNAP() && !ev.altKey;
    if (DRAG.k === "vert") {
      const P = LAST.F.poly.map((p) => p.slice()), p0 = P[DRAG.i];
      const vx = p0[0] + dx / SC, vy = p0[1] + dy / SC;
      if (snap) { const { ex, ey } = edgesFor(legs()[0], -1, -1, DRAG.i); P[DRAG.i] = [FC.snap1(vx, 0, ex, 12 / SC), FC.snap1(vy, 0, ey, 12 / SC)]; }
      else P[DRAG.i] = [Math.round(vx * 20) / 20, Math.round(vy * 20) / 20];
      DRAG.poly = P;
    } else if (DRAG.k === "cedge") {
      const c = l.r.core[DRAG.li], cw0 = LAST.coreWall || 0.25, min = 2 * cw0 + 0.5, { ex, ey } = edgesFor(l, -1, DRAG.li);
      const S1 = (v, list) => (snap ? FC.snap1(v, 0, list, 12 / SC) : Math.round(v * 20) / 20);
      const b = { x: c.x, y: c.y, w: c.w, h: c.h };
      if (DRAG.e === "e") b.w = Math.max(min, S1(c.x + c.w + dx / SC, ex) - c.x);
      if (DRAG.e === "w") { const x0 = Math.min(c.x + c.w - min, S1(c.x + dx / SC, ex)); b.w = c.x + c.w - x0; b.x = x0; }
      if (DRAG.e === "s") b.h = Math.max(min, S1(c.y + c.h + dy / SC, ey) - c.y);
      if (DRAG.e === "n") { const y0 = Math.min(c.y + c.h - min, S1(c.y + dy / SC, ey)); b.h = c.y + c.h - y0; b.y = y0; }
      for (const k of ["x", "y", "w", "h"]) b[k] = R3(b[k]);
      DRAG.box = b;
    } else if (DRAG.k === "fwpt" || DRAG.k === "fwseg") {
      const w = LAST.walls[DRAG.i], P = w.path.map((q) => q.slice());
      const mv = (k) => { const p0 = w.path[k]; let q = [p0[0] + dx / SC, p0[1] + dy / SC];
        // a point dragged: snapped as when drawing (to the units' and core's faces and corners); a segment moved: by 50 mm
        if (DRAG.k === "fwpt") { P[k] = snapPoint(q, P[k - 1] || P[k + 1] || null, ev); return; }
        P[k] = snap ? [Math.round(q[0] * 20) / 20, Math.round(q[1] * 20) / 20] : [R3(q[0]), R3(q[1])]; };
      if (DRAG.k === "fwpt") mv(DRAG.p); else { mv(DRAG.p); mv(DRAG.p + 1); }
      DRAG.path = P;
    } else if (DRAG.k === "spsel") {
      // a leg dragged across: both its points square to it, the corridor kept on the plate
      const sp = LAST.spine.path, j = DRAG.seg, { nl } = WC.dirOf(sp[j], sp[j + 1]);
      let off = (dx * nl[0] + dy * nl[1]) / SC; if (snap) off = Math.round(off * 20) / 20;
      const fits = (o) => { const P2 = sp.map((p, k) => (k === j || k === j + 1 ? [p[0] + nl[0] * o, p[1] + nl[1] * o] : p)); // both faces of the moved leg on the plate (a spine end may stand off it, at a cut corner: it is brought in to the edge)
        const a = P2[j], b = P2[j + 1], d = WC.dirOf(a, b).d, h = LAST.cw / 2, t0 = j === 0 ? 0.1 : 0, t1 = j + 1 === sp.length - 1 ? 0.9 : 1;
        for (let t = t0; t <= t1 + 1e-9; t += (t1 - t0) / 8) for (const sg of [-1, 1]) { const q = [a[0] + (b[0] - a[0]) * t - d[1] * h * sg, a[1] + (b[1] - a[1]) * t + d[0] * h * sg]; if (!onPlate(q)) return null; }
        return P2; };
      let P2 = fits(off); for (let t = 0; !P2 && t < 12; t++) { off /= 2; P2 = fits(off); }
      DRAG.path = P2 ? P2.map((p) => [R3(p[0]), R3(p[1])]) : sp; DRAG.off = P2 ? off : 0;
      host.title = `${off >= 0 ? "+" : ""}${f3(off)} m`;
    } else if (DRAG.k === "spt") {
      const sp = LAST.spine.path.map((q) => q.slice()), p0 = sp[DRAG.p], nb = sp[DRAG.p - 1] || sp[DRAG.p + 1];
      let q = [p0[0] + dx / SC, p0[1] + dy / SC];
      if (!ev.shiftKey && nb) q = WC.snapAngle(nb, q, 15);
      // along its line, onto a face near it (a unit's or the core's wall, a wall drawn, the plate's edge): an end put on a wall's face
      if (nb && SNAP() && !ev.altKey) {
        const G = snapGeo(), dl = WC.dirOf(nb, q).d, tol = 12 / SC; let bt = null, bd = tol;
        for (const [a, b] of G.segs) {
          if (a.corr) continue;
          const ex = b[0] - a[0], ey = b[1] - a[1], den = dl[0] * ey - dl[1] * ex; if (Math.abs(den) < 1e-9) continue;
          const t = ((a[0] - nb[0]) * ey - (a[1] - nb[1]) * ex) / den, u = ((a[0] - nb[0]) * dl[1] - (a[1] - nb[1]) * dl[0]) / den;
          if (t <= 0.5 || u < -1e-6 || u > 1 + 1e-6) continue;
          const X = [nb[0] + dl[0] * t, nb[1] + dl[1] * t], dd = Math.hypot(X[0] - q[0], X[1] - q[1]); if (dd < bd) { bd = dd; bt = X; }
        }
        if (bt) q = bt;
      }
      sp[DRAG.p] = [R3(q[0]), R3(q[1])];
      DRAG.path = sp;
    } else if (DRAG.k === "ppt") {
      const c = l.r.core[DRAG.li], P = c.path.map((q) => q.slice()), p0 = P[DRAG.p], { ex, ey } = edgesFor(l, -1, DRAG.li);
      const vx = p0[0] + dx / SC, vy = p0[1] + dy / SC;
      P[DRAG.p] = snap ? [FC.snap1(vx, 0, ex, 12 / SC), FC.snap1(vy, 0, ey, 12 / SC)] : [Math.round(vx * 20) / 20, Math.round(vy * 20) / 20];
      DRAG.path = P;
    } else if (DRAG.k === "cdo") {
      // the door slides along its wall, round the corners onto the next face
      const c = LAST.core[DRAG.ci], d = c.doors[DRAG.di], lp = toLeg(l, toPlan(ev)), f = nearestFace(c, lp);
      const t = d.t || (Number(c.wt) > 0 ? Number(c.wt) : LAST.coreWall || 0.25), horiz = f.side === "n" || f.side === "s";
      const a0 = (horiz ? c.x : c.y) + t, L = (horiz ? c.w : c.h) - 2 * t, hw = Math.min(d.w, L) / 2;
      const at = Math.max(hw / (L || 1), Math.min(1 - hw / (L || 1), ((horiz ? lp[0] : lp[1]) - a0) / (L || 1)));
      const m2 = a0 + L * at, line = f.side === "n" ? c.y + t / 2 : f.side === "s" ? c.y + c.h - t / 2 : f.side === "w" ? c.x + t / 2 : c.x + c.w - t / 2;
      DRAG.prev = { side: f.side, at: R3(at), a: horiz ? [m2 - hw, line] : [line, m2 - hw], b: horiz ? [m2 + hw, line] : [line, m2 + hw] };
    } else if (DRAG.k === "fwo") {
      const w = LAST.walls[DRAG.wi], o = w.openings[DRAG.oi], P = toPlan(ev), [oa, ob] = WC.offsets(w.t, w.just), cpath = WC.offsetPath(w.path, (oa + ob) / 2), q = WC.nearestOnPath(P, cpath);
      const po = WC.placeOpening(w, q.seg, q.s, o), d = WC.dirOf(cpath[q.seg], cpath[q.seg + 1]).d;
      DRAG.op = po; LIBHOV = { a: [cpath[q.seg][0] + d[0] * po.at, cpath[q.seg][1] + d[1] * po.at], b: [cpath[q.seg][0] + d[0] * (po.at + po.w), cpath[q.seg][1] + d[1] * (po.at + po.w)], t: w.t };
    } else {
      DRAG.at = dragAt(DRAG, ev.altKey);
      // along the corridor into another leg: it turns with that leg
      DRAG.cross = null;
      if (MULTI() && (DRAG.k === "unit" || DRAG.k === "core")) {
        const tl = legAt(toPlan(ev));
        if (tl && tl.k !== DRAG.leg) {
          const own = legK(DRAG.leg).r, it = DRAG.k === "unit" ? own.placed[DRAG.li] : own.core[DRAG.li], lp = toLeg(tl, toPlan(ev));
          let y = lp[1] - it.h / 2, band = null;
          if (DRAG.k === "unit") { band = lp[1] > (tl.r.y0 + tl.r.y1) / 2 ? "s" : "n"; y = band === "s" ? tl.r.y1 + it.wt / 2 : tl.r.y0 - it.h - it.wt / 2; }
          DRAG.cross = { k: tl.k, x: R3(lp[0] - it.w / 2), y: R3(y), w: it.w, h: it.h, band };
        }
      }
    }
    if (!drawPlan.raf) drawPlan.raf = requestAnimationFrame(() => { drawPlan.raf = 0; drawPlan(); });
  });
  const end = (ev) => {
    PZ.up(ZM, ev);
    if (pan) { const p = pan; pan = null; if (!p.moved) { clearSel(); } return drawPlan(); }
    if (drawPlan.raf) { cancelAnimationFrame(drawPlan.raf); drawPlan.raf = 0; }
    if (!DRAG) return;
    const d = DRAG; DRAG = null; LIBHOV = null;
    const r = LAST;
    if (d.k === "spsel") { host.title = ""; if (d.moved && d.path && SPSEL) return editSpine(() => d.path, true); clearSel(); SPSEL = true; return drawPlan(); }
    if (d.k === "vert") { if (d.moved && d.poly) { VSEL = null; return editPlate(() => d.poly); } const now = Date.now(), dbl = drawPlan.lastV && drawPlan.lastV.i === d.i && now - drawPlan.lastV.t < 450; drawPlan.lastV = { i: d.i, t: now }; if (dbl) { drawPlan.lastV = null; return removeCorner(d.i); } clearSel(); VSEL = d.i; return drawPlan(); }
    if (d.k === "cedge") { if (!d.moved || !d.box) return drawPlan(); const A = legK(d.leg).A, i = pIdx(d.i); return editCore((P) => { Object.assign(P[i], { x: R3(d.box.x - A[0]), y: R3(d.box.y - A[1]), w: d.box.w, h: d.box.h }); return i; }); }
    if (d.k === "fwpt" || d.k === "fwseg") { if (!d.moved || !d.path) return drawPlan(); return editWalls((A) => { A[d.i].openings = WC.keepOpenings(A[d.i], d.path, d.k === "fwseg" ? d.p : -1); A[d.i].path = WC.cleanPath(d.path); return d.i; }); }
    if (d.k === "spt") { if (!d.moved || !d.path) { SPSEL = true; SPPT = d.p; return drawPlan(); } SPPT = d.p; return editSpine(() => d.path, true); }
    if (d.k === "ppt") { if (!d.moved || !d.path) return drawPlan(); const A = legK(d.leg).A, i = pIdx(d.i); return editCore((P) => { P[i].path = FC.orthoPath(d.path).map((p) => [R3(p[0] - A[0]), R3(p[1] - A[1])]); if (P[i].for) P[i].auto = false; return i; }); }
    if (d.k === "cdo") {
      if (!d.moved || !d.prev) return drawPlan();
      const c = r.core[d.ci], dd = c.doors[d.di], i = pIdx(d.ci);
      return editCore((P) => { const q = P[i]; if (dd.oi != null) Object.assign(q.openings[dd.oi], { side: d.prev.side, at: d.prev.at }); else q.door = Object.assign({}, q.door, { side: d.prev.side, at: d.prev.at }); return i; });
    }
    if (d.k === "fwo") { if (!d.moved || !d.op) return drawPlan(); return editWalls((A) => { A[d.wi].openings[d.oi] = d.op; OPSEL = { wi: d.wi, oi: d.oi }; return null; }); }
    if (d.k === "core") {
      if (!d.moved) {
        if (SWAP && CSEL != null && CSEL !== d.i) { const a = pIdx(CSEL), b = pIdx(d.i); SWAP = false; return editCore((P) => { swapCore(P, a, b); return b; }); }
        const was = CSEL === d.i; clearSel(); CSEL = was ? null : d.i; return drawPlan();
      }
      if (d.cross) { const tl = legK(d.cross.k), i = pIdx(d.i); return editCore((P) => { const q = P[i]; q.leg = tl.k; q.x = R3(d.cross.x - tl.A[0]); q.y = R3(d.cross.y - tl.A[1]); if (Array.isArray(q.path)) { delete q.path; q.auto = !!q.for; } return i; }); }
      const tg = dropTarget(d);
      if (tg && tg.ci != null) { const a = pIdx(d.i), b = pIdx(tg.ci); return editCore((P) => { swapCore(P, a, b); return b; }); }
      const at = d.at || dragAt(d, ev.altKey), A = legK(d.leg).A, i = pIdx(d.i), c0 = legK(d.leg).r.core[d.li];
      return editCore((P) => { const q = P[i], dx2 = at.x - c0.x, dy2 = at.y - c0.y; if (Array.isArray(q.path)) q.path = q.path.map(([x, y]) => [R3(x + dx2), R3(y + dy2)]); q.x = R3(at.x - A[0]); q.y = R3(at.y - A[1]); return i; });
    }
    const q = r.placed[d.i]; if (!q) return drawPlan();
    if (!d.moved) {
      if (SWAP && PSEL != null && PSEL !== d.i) { const a = entryOf(r.placed[PSEL]), b = entryOf(q); SWAP = false; return edit((SQ) => { swapEntries(SQ, a, b); }); }
      const was = PSEL === d.i; clearSel(); PSEL = was ? null : d.i; return drawPlan();
    }
    const tg = dropTarget(d), me = entryOf(q);
    if (d.cross) { const tl = legK(d.cross.k); return edit((SQ) => { const [e] = SQ(me.leg)[me.band].splice(me.i, 1); e.x = R3(d.cross.x - tl.A[0]); SQ(tl.k)[d.cross.band].push(e); }); }
    if (tg && tg.pi != null) return edit((SQ) => { swapEntries(SQ, me, entryOf(r.placed[tg.pi])); });
    const at = d.at || dragAt(d, ev.altKey), A = legK(d.leg).A;
    return edit((SQ) => {
      const S = SQ(me.leg), e = S[me.band][me.i]; e.x = R3(at.x - A[0]);
      if (at.band !== me.band) { S[me.band].splice(me.i, 1); S[at.band].push(e); }
    });
  };
  host.addEventListener("pointerup", end);
  host.addEventListener("pointercancel", end);
  host.addEventListener("wheel", (ev) => { if (ev.target.closest(".pz-bar")) return; ev.preventDefault(); if (PZ.wheel(ZM, ev, host.getBoundingClientRect())) drawPlan(); }, { passive: false });
}
function removeCorner(i) {
  if (!LAST || i == null || !C.can()) return;
  if (LAST.F.poly.length <= 3) return toast("A floor plate needs three corners at least", true);
  VSEL = null;
  editPlate((P) => { P.splice(i, 1); return P; });
}
/* the plate's rectangle round itself, its units and core (the frame's axes) */
function fitPlate() {
  const r = LAST; if (!r) return;
  // the plate drawn close round the units (out to their walls' outer faces; balconies, UP and A/C platforms left out),
  // the core and the corridor, gaps narrower than the fit gap closed
  const shapes = [];
  for (const l of legs()) {
    const L = l.r, cw = L.coreWall || 0.25, rect = (x0, y0, x1, y1) => shapes.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map((q) => fromLeg(l, q)));
    // a unit: its rooms and its walls at their own thickness (so the edge is on the external walls' outer faces)
    for (const q of L.placed) { for (const rm of q.rooms) rect(q.x + rm.x, q.y + rm.y, q.x + rm.x + rm.w, q.y + rm.y + rm.h); for (const w of FC.placedWalls(q).rects) rect(w.x0, w.y0, w.x1, w.y1); }
    for (const c of L.core) if (c.kind !== "passage") rect(c.x, c.y, c.x + c.w, c.y + c.h);   // its box is out to its walls' outer faces
    else for (const q of c.rects || []) rect(q.x0, q.y0, q.x1, q.y1);
    if (L.corr) rect(L.corr.x0, L.y0, L.corr.x1, L.y1);
  }
  // the walls drawn on the floor: the plate goes out to their outer faces too
  for (const w of r.walls || []) for (const q of w.pieces || []) if (q.length >= 3) shapes.push(q.map((p) => [p[0], p[1]]));
  const gap = Number(opts(cur()).fitGap); 
  const ring = FC.hugOutline(shapes, gap >= 0 && isFinite(gap) ? gap : 0.5);
  if (!ring) return toast("Nothing on the floor to fit the plate round", true);
  editPlate(() => ring);
}
export function refresh() { if (ON) render(); }
void UC;
