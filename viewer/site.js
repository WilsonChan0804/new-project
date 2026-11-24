/* Site study (phase 1): find the site on the Lands Department's map, draw its
 * boundary, make its area the site area the architect gives, mark the streets
 * it abuts (which gives the class of site), and send the area and class to
 * the GBP workbook. Kept with the project in the GBP workbook's file
 * (/api/gbp, part "study") - one site study per project, shared like the
 * workbook: members change it, viewers look.
 *
 * Rule-based only: the geometry and rules are in sitecore.js.
 */
import { api, project, headers } from "./nav.js";
import { ensureSignedIn, header } from "./pagekit.js";
import { toast } from "./tasks-util.js";
import * as S from "./sitecore.js";
import { site as bprSite } from "./gbpcore.js";
import { OZP, OZP_PORTAL } from "./ozptables.js";
import * as MS from "./sitemass.js";
import * as UN from "./siteunits.js";
import * as FL from "./sitefloor.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f1 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const f3 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 3, maximumFractionDigits: 3 }));

const TILE = "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/";
const ATTR = '<a href="https://portal.csdi.gov.hk" target="_blank" rel="noopener">&copy; Map from Lands Department</a>';
const HK = [22.35, 114.15];

let WB = { rev: 0, data: {} }, CAN = false, ST = null, map = null;
let L_ = null, layer = null, drawing = null, saveT = null, lastPts = null;
let PICK = null, MEAS = null; // picking edges for a street id; measuring: {a} or {}

function study() {
  const d = WB.data;
  d.study = d.study || {};
  const s = d.study;
  s.pts = Array.isArray(s.pts) ? s.pts : [];
  s.streets = s.streets && typeof s.streets === "object" ? s.streets : {};
  s.roads = s.roads && typeof s.roads === "object" ? s.roads : {};
  if (s.plan && s.plan.planno && !s.plan.plan) { s.plan.plan = String(s.plan.planno).replace(/\s+/g, "").toUpperCase(); delete s.plan.planno; }
  // the first form kept {edge: {width}}: one road per run of edges
  if (Object.values(s.streets).some((v) => v && typeof v === "object")) Object.assign(s, S.migrateStreets(s.streets, s.pts));
  return s;
}
const snap = () => { const s = study(); return { pts: s.pts.slice(), streets: Object.assign({}, s.streets), roads: JSON.parse(JSON.stringify(s.roads)) }; };
/* the roads in use, numbered in order: {id: 1, ...} */
function roadNos(s) {
  const ids = [...new Set([...Object.values(s.streets).map(String), ...Object.keys(s.roads)])].sort((a, b) => a - b), out = {};
  ids.forEach((id, k) => { out[id] = k + 1; });
  return out;
}
const roadName = (s, id, no) => (s.roads[id] && s.roads[id].name) || "Street " + (no || roadNos(s))[id];
function clsOf(s) {
  const no = roadNos(s), roads = {};
  for (const id of Object.keys(no)) roads[id] = { name: roadName(s, id, no), width: s.roads[id] ? s.roads[id].width : "" };
  return S.roadClass(s.pts.length, s.streets, roads, S.edges(s.pts));
}
function newRoad(s) {
  const id = Math.max(0, ...Object.keys(s.roads).map(Number), ...Object.values(s.streets).map(Number)) + 1;
  s.roads[id] = { name: "", width: "" };
  return id;
}
function pruneRoads(s) {
  const used = new Set(Object.values(s.streets).map(String));
  for (const id of Object.keys(s.roads)) if (!used.has(id) && !(s.roads[id] && s.roads[id].name)) delete s.roads[id];
}

/* ---------- saving (as the GBP workbook: rev, 409 -> take theirs, keep ours) */
function save() {
  if (!CAN) return;
  clearTimeout(saveT);
  for (const id of ["#st-saved", "#ms-saved", "#un-saved"]) { const e = $(id); if (e) e.textContent = "Saving …"; }
  saveT = setTimeout(push, 700);
}
async function push(again) {
  const mine = JSON.parse(JSON.stringify(WB.data.study || {})), quick = WB.data.quick;
  const res = await fetch("/api/gbp", { method: "PUT", headers: headers(true), body: JSON.stringify({ rev: WB.rev, data: WB.data }) });
  let body = null; try { body = await res.json(); } catch (e) {}
  if (res.status === 409 && body && body.detail && body.detail.current && !again) {
    // someone changed the workbook meanwhile: their workbook, our site study
    const cur = body.detail.current;
    WB.rev = cur.rev; WB.data = cur.data || {};
    WB.data.study = mine;
    if (push.quickSent) WB.data.quick = Object.assign(WB.data.quick || {}, push.quickSent);
    else if (!WB.data.quick && quick) WB.data.quick = quick;
    return push(true);
  }
  if (!res.ok) { for (const id of ["#st-saved", "#ms-saved", "#un-saved"]) { const e = $(id); if (e) e.textContent = "Not saved"; } toast((body && body.detail && (body.detail.message || body.detail)) || "Not saved", true); return; }
  WB.rev = body.rev; push.quickSent = null;
  for (const id of ["#st-saved", "#ms-saved", "#un-saved"]) { const e = $(id); if (e) e.textContent = "Saved with the project"; }
}

/* ---------- the map */
function initMap() {
  const L = window.L;
  map = L.map("st-map", { zoomControl: true, doubleClickZoom: false, maxZoom: 21 }).setView(HK, 12);
  const opt = { attribution: ATTR, maxNativeZoom: 19, maxZoom: 21, minZoom: 10 };
  const topo = L.tileLayer(TILE + "basemap/WGS84/{z}/{x}/{y}.png", opt);
  const photo = L.tileLayer(TILE + "imagery/WGS84/{z}/{x}/{y}.png", opt);
  const lab = L.tileLayer(TILE + "label/hk/en/WGS84/{z}/{x}/{y}.png", Object.assign({}, opt, { attribution: "" }));
  const labZh = L.tileLayer(TILE + "label/hk/tc/WGS84/{z}/{x}/{y}.png", Object.assign({}, opt, { attribution: "" }));
  topo.addTo(map); lab.addTo(map);
  L.control.layers({ "Map (Lands Department)": topo, "Aerial photo": photo }, { "Labels (English)": lab, "Labels (中文)": labZh }, { position: "topright" }).addTo(map);
  L.control.scale({ metric: true, imperial: false, position: "bottomleft" }).addTo(map);
  let failed = 0;
  topo.on("tileerror", () => { if (++failed === 6) hint("The map tiles do not load from here. You can still draw the boundary; the area and lengths are worked out all the same.", 9000); });
  layer = L.layerGroup().addTo(map);
  map.on("click", (ev) => {
    if (drawing) { drawing.push([ev.latlng.lat, ev.latlng.lng]); drawRubber(); return; }
    if (MEAS) measureClick(ev);
  });
  map.on("mousemove", (ev) => { if (MEAS && MEAS.a) measureRubber(ev); });
  map.on("dblclick", () => { if (drawing) finishDraw(); });
  map.on("moveend", () => { const s = study(), c = map.getCenter(); s.view = { c: [+c.lat.toFixed(6), +c.lng.toFixed(6)], z: map.getZoom() }; });
  L_ = L;
}

const PINK = "#e85d8a", STREET = "#f28022", EDGE = "#3a3a3a";

function draw() {
  const L = L_, s = study();
  layer.clearLayers();
  if (s.pts.length < 3) return drawMeasures();
  L.polygon(s.pts, { color: PINK, weight: 1, fillColor: PINK, fillOpacity: 0.22, interactive: false }).addTo(layer);
  const lens = S.edges(s.pts), no = roadNos(s);
  s.pts.forEach((p, i) => {
    const q = s.pts[(i + 1) % s.pts.length], st = s.streets[i];
    const line = L.polyline([p, q], { color: st ? STREET : EDGE, weight: st ? 8 : 3, opacity: st ? 0.85 : 0.9 }).addTo(layer);
    const rd = st != null ? s.roads[st] || {} : null;
    const lab = `E${i + 1} · ` + (st != null ? `${esc(roadName(s, st, no))}${rd.width ? " · " + rd.width + " m" : ""} · ` : "") + `${f1(lens[i])} m`;
    line.bindTooltip(lab, { permanent: true, direction: "center", className: "st-edge-lab" + (st ? " st" : "") });
    if (CAN && !document.body.classList.contains("st-mass")) {
      line.on("click", (ev) => {
        L.DomEvent.stop(ev);
        if (drawing) return;
        if (MEAS) return measureClick(ev);
        if (PICK != null) { if (String(s.streets[i]) === String(PICK)) delete s.streets[i]; else s.streets[i] = +PICK; return changed(); }
        toggleStreet(i);
      });
      line.on("mouseover", () => line.setStyle({ weight: st ? 10 : 6 }));
      line.on("mouseout", () => line.setStyle({ weight: st ? 8 : 3 }));
    }
  });
  if (CAN && !drawing && PICK == null && !MEAS && !document.body.classList.contains("st-mass")) s.pts.forEach((p, i) => {
    const m = L.marker(p, { draggable: true, icon: L.divIcon({ className: "st-vx", iconSize: [14, 14] }), title: "Drag to move this corner; right-click to remove it" }).addTo(layer);
    m.on("drag", (ev) => { const ll = ev.target.getLatLng(); s.pts[i] = [ll.lat, ll.lng]; drawLight(); });
    m.on("dragend", () => { draw(); panel(); save(); });
    m.on("contextmenu", (ev) => { L.DomEvent.stop(ev); if (s.pts.length <= 3) return toast("A site needs three corners at least", true); removeCorner(i); });
  });
  drawMeasures();
  // a corner can be added on the middle of each edge
  if (CAN && !drawing && PICK == null && !MEAS && !document.body.classList.contains("st-mass")) s.pts.forEach((p, i) => {
    const q = s.pts[(i + 1) % s.pts.length];
    const m = L.marker([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], { icon: L.divIcon({ className: "st-mid", iconSize: [10, 10] }), title: "Click to add a corner here" }).addTo(layer);
    m.on("click", (ev) => { L.DomEvent.stop(ev); addCorner(i); });
  });
}
/* ---------- measuring: two clicks, snapped to the boundary's corners and edges (Alt: no snap) */
function snapLL(ev) {
  const s = study(), ll = [ev.latlng.lat, ev.latlng.lng];
  if (ev.originalEvent && ev.originalEvent.altKey) return ll;
  const P = (q) => map.latLngToContainerPoint(q), c = P(ll);
  let best = null, bd = 12;
  for (const q of s.pts) { const d = P(q).distanceTo(c); if (d < bd) { bd = d; best = q.slice(); } }
  if (best) return best;
  bd = 8;
  s.pts.forEach((a, i) => {
    const b = s.pts[(i + 1) % s.pts.length], pa = P(a), pb = P(b);
    const dx = pb.x - pa.x, dy = pb.y - pa.y, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((c.x - pa.x) * dx + (c.y - pa.y) * dy) / L2));
    const px = pa.x + dx * t, py = pa.y + dy * t, d = Math.hypot(c.x - px, c.y - py);
    if (d < bd) { bd = d; best = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  });
  return best || ll;
}
let mRubber = null;
function measureClick(ev) {
  const p = snapLL(ev);
  if (!MEAS.a) { MEAS.a = p; hint("Click the other side.", 0); return; }
  const s = study();
  s.measures = s.measures || [];
  s.measures.push({ a: MEAS.a, b: p, len: +S.distance(MEAS.a, p).toFixed(2) });
  MEAS = {};
  if (mRubber) { mRubber.remove(); mRubber = null; }
  hint(`${f1(s.measures[s.measures.length - 1].len)} m. Click to measure another; Esc to stop.`, 0);
  changed();
}
function measureRubber(ev) {
  const p = snapLL(ev);
  if (mRubber) mRubber.remove();
  mRubber = L_.polyline([MEAS.a, p], { color: "#1f6feb", weight: 2, dashArray: "4 4", interactive: false }).addTo(map);
  mRubber.bindTooltip(`${f1(S.distance(MEAS.a, p))} m`, { permanent: true, direction: "center", className: "st-edge-lab st-ms" }).openTooltip();
}
function drawMeasures() {
  const s = study();
  (s.measures || []).forEach((m, k) => {
    const l = L_.polyline([m.a, m.b], { color: "#1f6feb", weight: 2, interactive: false }).addTo(layer);
    [m.a, m.b].forEach((q) => L_.circleMarker(q, { radius: 3, color: "#1f6feb", fillOpacity: 1, interactive: false }).addTo(layer));
    l.bindTooltip(`M${k + 1} · ${f1(m.len)} m`, { permanent: true, direction: "center", className: "st-edge-lab st-ms" });
  });
}
function stopModes() {
  MEAS = null; PICK = null;
  if (mRubber) { mRubber.remove(); mRubber = null; }
  $("#st-map").classList.remove("st-drawing");
  hint("", 0);
}

/* while a corner is dragged: only the outline, fast */
let light = null;
function drawLight() {
  const s = study();
  if (light) light.remove();
  light = L_.polygon(s.pts, { color: PINK, weight: 2, dashArray: "4 4", fill: false, interactive: false }).addTo(map);
  panel(true);
}

function shiftStreets(fn) {
  const s = study(), out = {};
  for (const [k, v] of Object.entries(s.streets)) { const j = fn(+k); if (j != null) out[j] = v; }
  s.streets = out;
}
function addCorner(i) {
  const s = study(), p = s.pts[i], q = s.pts[(i + 1) % s.pts.length];
  const st = s.streets[i];
  s.pts.splice(i + 1, 0, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
  shiftStreets((k) => (k > i ? k + 1 : k));
  if (st != null) s.streets[i + 1] = st; // both halves stay on the street
  changed();
}
function removeCorner(i) {
  const s = study(), n = s.pts.length;
  s.pts.splice(i, 1);
  // the edges either side (i-1 and i) become one: it keeps the street of either
  const prev = (i - 1 + n) % n, keep = s.streets[prev] != null ? s.streets[prev] : s.streets[i];
  shiftStreets((k) => (k === i ? null : k > i ? k - 1 : k));
  const np = (i - 1 + n - 1) % (n - 1);
  if (keep != null) s.streets[np] = keep; else delete s.streets[np];
  changed();
}
/* a click on an edge: off a street, or onto the street of the edge next to
   it (past short splays), else a new street */
function toggleStreet(i) {
  const s = study(), n = s.pts.length, lens = S.edges(s.pts);
  if (s.streets[i] != null) { delete s.streets[i]; pruneRoads(s); return changed(); }
  const near = (dir) => { let e = (i + dir + n) % n, k = 0; while (k < n && s.streets[e] == null && lens[e] < S.SPLAY) { e = (e + dir + n) % n; k++; } return s.streets[e]; };
  const id = near(-1) != null ? near(-1) : near(1) != null ? near(1) : newRoad(s);
  s.streets[i] = id;
  changed();
}
function changed() { if (light) { light.remove(); light = null; } draw(); panel(); save(); }

/* ---------- drawing a new boundary */
let rubber = null;
function startDraw() {
  if (!CAN) return;
  const s = study();
  lastPts = snap();
  drawing = [];
  layer.clearLayers();
  $("#st-map").classList.add("st-drawing");
  hint("Click each corner of the site in turn. Double-click (or Finish) to close it. Esc to stop.");
  tools();
}
function drawRubber() {
  if (rubber) rubber.remove();
  rubber = L_.layerGroup().addTo(map);
  L_.polyline(drawing.concat(drawing.length > 2 ? [drawing[0]] : []), { color: PINK, weight: 2, dashArray: "5 5", interactive: false }).addTo(rubber);
  drawing.forEach((p) => L_.circleMarker(p, { radius: 4, color: PINK, fillOpacity: 1, interactive: false }).addTo(rubber));
  const n = drawing.length;
  hint(n < 3 ? `Corner ${n}: ${3 - n} more at least.` : `${n} corners · ${f1(S.area(drawing))} m². Double-click or Finish to close.`);
  tools();
}
function finishDraw(cancel) {
  const s = study();
  if (rubber) { rubber.remove(); rubber = null; }
  const pts = drawing;
  drawing = null;
  $("#st-map").classList.remove("st-drawing");
  // a double-click adds the same point twice
  const clean = (pts || []).filter((p, i, a) => !i || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-7);
  if (!cancel && clean.length >= 3) {
    if (S.selfCrosses(clean)) { toast("The boundary crosses itself: draw the corners in order round the site", true); }
    else { s.pts = clean; s.streets = {}; s.roads = {}; s.factor = null; hint(s.target > 0 ? `Traced ${f1(S.area(clean))} m². Mark the streets (click an edge), then Match area if it should be ${f1(s.target)} m².` : "Click an edge to mark it as a street. Drag a corner to move it.", 8000); }
  } else hint("", 0);
  draw(); panel(); tools(); save();
}
function startRect() {
  const s = study(), a = s.target > 0 ? s.target : 1000, c = map.getCenter();
  lastPts = snap();
  s.pts = S.rectangle([c.lat, c.lng], a);
  s.streets = {}; s.roads = {};
  changed();
  fit();
  hint(`A rectangle of ${f1(a)} m² in the middle of the map: drag its corners onto the site, then Match area.`, 7000);
}
function matchArea() {
  const s = study();
  if (!(s.target > 0)) return toast("Give the site area to match first", true);
  if (s.pts.length < 3) return toast("Draw the boundary first", true);
  lastPts = snap();
  if (s.mmode === "keep") {
    const n = s.pts.length, fixed = new Set();
    for (const e of Object.keys(s.streets).map(Number)) { fixed.add(e); fixed.add((e + 1) % n); }
    if (!fixed.size) return toast("Mark the street edges first: they stay, the other corners move", true);
    const free = s.pts.map((p, i) => i).filter((i) => s.streets[i] == null && S.edges(s.pts)[i] >= S.SPLAY);
    const grow = s.target > S.area(s.pts);
    const r = S.matchKeeping(s.pts, s.target, [...fixed], free);
    if (!r) return toast("Keeping the street edges cannot reach that area: try Scale about centre", true);
    s.pts = r.pts; s.factor = null;
    changed();
    hint(r.how === "edges" ? `The edge${r.moved > 1 ? "s" : ""} off the streets moved ${grow ? "out" : "in"} ${f1(Math.abs(r.offset))} m; the street edges stayed. ${f1(s.target)} m².`
      : `The ${r.moved} corners off the streets moved (×${r.factor.toFixed(4)} from the centre); the street edges stayed. ${f1(s.target)} m².`, 8000);
    return;
  }
  const r = S.scaleTo(s.pts, s.target);
  s.pts = r.pts; s.factor = r.factor;
  changed(); hint(`Scaled ×${r.factor.toFixed(4)} about its centre: the boundary is now ${f1(s.target)} m².`, 6000);
}
function undoShape() {
  if (!lastPts) return;
  const s = study(), now = snap();
  s.pts = lastPts.pts; s.streets = lastPts.streets; s.roads = lastPts.roads || s.roads; lastPts = now;
  changed();
}
function clearAll() {
  const s = study();
  if (!s.pts.length) return;
  if (!confirm("Clear the site boundary and its streets for everyone on this project?")) return;
  lastPts = snap();
  s.pts = []; s.streets = {}; s.roads = {}; s.factor = null;
  changed();
  hint("Cleared. Undo shape puts it back.", 6000);
}
function fit() { const s = study(); if (s.pts.length >= 3) map.fitBounds(L_.latLngBounds(s.pts), { padding: [60, 60], maxZoom: 19 }); }

let hintT = null;
function hint(t, ms) {
  const h = $("#st-hint");
  clearTimeout(hintT);
  h.hidden = !t; h.textContent = t || "";
  if (t && ms) hintT = setTimeout(() => { h.hidden = true; }, ms);
}

function tools() {
  const el = $("#st-tools"), s = study();
  if (!CAN) { el.innerHTML = `<span class="st-ro">View only</span><button type="button" data-t="fit">Fit</button>`; return; }
  if (PICK != null) { el.innerHTML = `<span class="st-ro">Picking edges for <b>${esc(roadName(s, PICK))}</b></span><button type="button" class="primary" data-t="done">Done</button>`; return; }
  if (MEAS) { el.innerHTML = `<span class="st-ro">📏 Measuring (snaps to the boundary; Alt: free)</span><button type="button" class="primary" data-t="done">Done</button>`; return; }
  el.innerHTML = drawing
    ? `<button type="button" class="primary" data-t="finish"${drawing.length < 3 ? " disabled" : ""}>Finish</button><button type="button" data-t="back"${drawing.length ? "" : " disabled"}>Undo corner</button><button type="button" data-t="cancel">Cancel</button>`
    : `<button type="button" class="primary" data-t="draw" title="Click the site's corners on the map">✎ Draw boundary</button>
       <button type="button" data-t="rect" title="A rectangle of the site area, to drag onto the site">▭ Rectangle</button>
       <span class="st-mm"><button type="button" data-t="match"${s.pts.length >= 3 && s.target > 0 ? "" : " disabled"} title="Make the boundary the site area">⤢ Match area</button><select data-t="mmode" title="How Match area changes the boundary"><option value="scale"${s.mmode !== "keep" ? " selected" : ""}>scale about centre</option><option value="keep"${s.mmode === "keep" ? " selected" : ""}>keep street edges</option></select></span>
       <button type="button" data-t="measure" title="Measure a distance on the map, e.g. a street's width">📏 Measure</button>
       <button type="button" data-t="fit"${s.pts.length >= 3 ? "" : " disabled"}>Fit</button>
       <button type="button" data-t="undo"${lastPts ? "" : " disabled"}>Undo shape</button>
       <button type="button" data-t="clear"${s.pts.length ? "" : " disabled"}>Clear</button>`;
}
function wireTools() {
  $("#st-tools").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-t]");
    if (!b) return;
    ev.stopPropagation();
    const t = b.dataset.t;
    if (t === "draw") startDraw();
    else if (t === "finish") finishDraw();
    else if (t === "cancel") { finishDraw(true); }
    else if (t === "back") { drawing.pop(); drawRubber(); }
    else if (t === "rect") startRect();
    else if (t === "match") matchArea();
    else if (t === "fit") fit();
    else if (t === "undo") undoShape();
    else if (t === "clear") clearAll();
    else if (t === "measure") { stopModes(); MEAS = {}; $("#st-map").classList.add("st-drawing"); hint("Click one side of the street, then the other.", 0); draw(); tools(); }
    else if (t === "done") { stopModes(); draw(); tools(); panel(); }
  });
  $("#st-tools").addEventListener("change", (ev) => { if (ev.target.dataset.t === "mmode") { study().mmode = ev.target.value; save(); } });
  L_.DomEvent.disableClickPropagation($("#st-tools"));
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && drawing) finishDraw(true);
    else if (ev.key === "Escape" && (MEAS || PICK != null)) { stopModes(); draw(); tools(); panel(); }
    if (ev.key === "Enter" && drawing && drawing.length >= 3 && !ev.target.closest("input")) finishDraw();
  });
}

/* ---------- the panel */
function panel(light) {
  const s = study(), el = $("#st-panel");
  const a = S.area(s.pts), n = s.pts.length, lens = S.edges(s.pts);
  const cls = n >= 3 ? clsOf(s) : null;
  const diff = s.target > 0 && n >= 3 ? a - s.target : null;
  const dis = CAN ? "" : " disabled";
  const ok = diff != null && Math.abs(diff) < 0.05;
  const res = n >= 3 ? `<div class="st-bigs">
      <div class="st-big"><small>Boundary area</small><b>${f3(a)}</b><i>m²</i>${diff != null ? `<span class="${ok ? "good" : "warn"}">${ok ? "matches the site area" : (diff > 0 ? "+" : "") + f3(diff) + " m² from the site area"}</span>` : ""}</div>
      <div class="st-big"><small>Class of site</small><b>${cls.cls}</b><span>${esc(cls.why)}</span></div>
      <div class="st-big"><small>Perimeter</small><b>${f1(S.perimeter(s.pts))}</b><i>m</i><span>${n} corners${s.factor && Math.abs(s.factor - 1) > 1e-6 ? ` · last scaled ×${s.factor.toFixed(4)}` : ""}</span></div>
    </div>` : `<p class="st-need">${CAN ? "Find the site on the map, then <b>Draw boundary</b> (click its corners) or start from a <b>Rectangle</b> of the site area." : "No site boundary yet."}</p>`;
  if (light) { const r = $("#st-res", el); if (r) r.innerHTML = res; return; }
  const no = n >= 3 ? roadNos(s) : {};
  const opts = (cur) => `<option value="">–</option>${Object.keys(no).map((id) => `<option value="${id}"${String(cur) === id ? " selected" : ""}>${esc(roadName(s, id, no))}</option>`).join("")}<option value="new">+ New street</option>`;
  const rows = n >= 3 ? s.pts.map((p, i) => {
    const st = s.streets[i];
    return `<tr class="${st != null ? "st-on" : ""}"><td title="From corner ${i + 1} to corner ${(i + 1) % n + 1}">E${i + 1}</td><td class="num">${f1(lens[i])}</td>
      <td><select data-se="${i}"${dis}>${opts(st)}</select></td></tr>`;
  }).join("") : "";
  const roadRows = Object.keys(no).map((id) => { const r = s.roads[id] || {}; const w = r.width;
    return `<tr><td><b>${no[id]}</b></td><td><input data-rn="${id}" value="${esc(r.name || "")}" placeholder="Street ${no[id]}: its name"${dis}></td>
      <td class="nw"><input type="number" step="0.1" min="0" data-rw="${id}" value="${esc(w == null ? "" : w)}" placeholder="width"${dis}> m${w !== "" && w != null && +w < S.STREET_MIN ? ` <em class="warn" title="Under ${S.STREET_MIN} m: not a specified street">&lt; ${S.STREET_MIN}</em>` : ""}</td>
      <td class="nw">${CAN ? `<button type="button" class="ghost st-ib${String(PICK) === id ? " on" : ""}" data-rpick="${id}" title="Pick its edges on the map">⌖</button><button type="button" class="ghost st-ib" data-rdel="${id}" title="Remove this street">×</button>` : ""}<small class="muted">${Object.values(s.streets).filter((v) => String(v) === id).length} edges</small></td></tr>`; }).join("");
  const ms = s.measures || [];
  const msRows = ms.map((m, k) => `<tr><td>M${k + 1}</td><td class="num">${f1(m.len)} m</td><td>${CAN && Object.keys(no).length ? `<select data-muse="${k}"><option value="">Use as width of …</option>${Object.keys(no).map((id) => `<option value="${id}">${esc(roadName(s, id, no))}</option>`).join("")}</select>` : ""}</td><td>${CAN ? `<button type="button" class="ghost st-ib" data-mdel="${k}" title="Remove">×</button>` : ""}</td></tr>`).join("");
  const addRow = CAN ? `<div class="st-add"><input id="st-add-name" placeholder="Street name, e.g. Fuk Hang Tsuen Road"><input id="st-add-w" type="number" step="0.1" min="0" placeholder="width m"><button type="button" class="ghost" id="st-add">+ Add street</button></div>` : "";
  el.innerHTML = `
    <section class="st-card">
      <div class="st-head"><b>1 · The site</b><span class="muted" id="st-saved">${CAN ? "Saved with the project" : "View only"}</span></div>
      <label class="st-f">Site name / lot<input data-sf="name" value="${esc(s.name || "")}" placeholder="e.g. TKO Area 137, STTL 618"${dis}></label>
      <label class="st-f">Site area to match (m²)<input type="number" step="any" min="0" data-sf="target" value="${esc(s.target || "")}" placeholder="from the lease / survey"${dis}></label>
      <div id="st-res">${res}</div>
    </section>
    ${n >= 3 ? `<section class="st-card">
      <div class="st-head"><b>2 · Edges and streets</b><span class="muted">click an edge on the map, or tick it here</span></div>
      ${roadRows ? `<table class="st-roads"><thead><tr><th></th><th>Street</th><th>Width</th><th></th></tr></thead><tbody>${roadRows}</tbody></table>` : `<p class="st-need">Add a street by its name and pick its edges, or click the edges along each street on the map: the edges next to one already on a street join it.</p>`}
      ${addRow}
      ${msRows ? `<table class="st-ms-list"><tbody>${msRows}</tbody></table><button type="button" class="ghost st-ib" id="st-mclear"${CAN ? "" : " disabled"}>Clear measures</button>` : `<p class="muted st-note">📏 <b>Measure</b> (map tools): click both sides of a street to check its width.</p>`}
      <details class="st-edl"${roadRows ? "" : " open"}><summary>Edges (${n})</summary>
      <table class="st-edges"><thead><tr><th>Edge</th><th class="num">Length m</th><th>Abuts</th></tr></thead><tbody>${rows}</tbody></table></details>
      <p class="muted st-note">B(P)R reg. 2: class B is a corner site on two specified streets, class C on three. The pieces of one street are one street; streets meet at a corner on edges side by side, or across a short splay (under ${S.SPLAY} m). A street with no width is taken as ${S.STREET_MIN} m or more; one under ${S.STREET_MIN} m does not count.</p>
    </section>` : ""}
    ${planCards(s, n >= 3 ? (s.target > 0 && ok ? s.target : a) : s.target || null, cls)}
    <section class="st-card">
      <div class="st-head"><b>5 · GBP workbook</b></div>
      <p class="muted st-note">Puts the site area${n >= 3 ? ` (${f3(s.target > 0 && ok ? s.target : a)} m²)` : ""} and the class of site${cls ? ` (${cls.cls})` : ""} into the workbook's step 1, for everyone on the project.</p>
      <div class="st-row"><button type="button" class="primary" id="st-send"${n >= 3 && CAN ? "" : " disabled"}>Send to GBP workbook</button>
      <a class="st-link" id="st-open" href="codes.html?${new URLSearchParams({ project: project(), tab: "gbp", sec: "site" })}">Open GBP workbook ›</a></div>
      ${sentNote()}
    </section>`;
}
/* ---------- 3 Planning (OZP) and lease, 4 development potential */
/* the plans known: built in (ozptables.js) and the office list (/api/ozp) */
let OFFICE = { plans: {} }, NOTES = null;
const normPlan = (x) => String(x || "").replace(/\s+/g, "").toUpperCase();
const normZone = (x) => { const z = String(x || "").replace(/\s+/g, " ").trim(); return z.length <= 12 ? z.toUpperCase() : z; };
function planOf(no) {
  const k = normPlan(no), b = Object.keys(OZP).find((x) => normPlan(x) === k), o = OFFICE.plans[k];
  if (!b && !o) return null;
  const zones = Object.assign({}, o ? o.zones : {}, b ? OZP[b].zones : {});
  return { builtIn: b ? OZP[b] : null, office: o || null, zones };
}
function zoneOf(pl) {
  const P = planOf(pl.plan); if (!P) return null;
  const z = normZone(pl.zone), k = Object.keys(P.zones).find((x) => normZone(x) === z);
  return k ? Object.assign({ key: k, office: !(P.builtIn && P.builtIn.zones[k]) }, P.zones[k]) : null;
}
function fillZone(o, z) {
  for (const f of ["dpr", "npr", "pr", "sc", "storeys"]) o[f] = z[f] == null ? "" : z[f];
  o.bh = z.bh != null ? z.bh : z.bhPlan ? o.bh || "" : "";
  o.bhPlan = !!z.bhPlan;
}
function notesBox(pl) {
  if (!NOTES) return "";
  if (NOTES.error) return `<p class="bad st-note">${esc(NOTES.error)}</p>`;
  if (NOTES.busy) return `<p class="muted st-note">Reading the Notes …</p>`;
  const lab = { dpr: "Dom PR", npr: "Non-dom PR", pr: "PR", sc: "SC %", bh: "BH mPD", storeys: "Storeys", dgfa: "Dom GFA", ngfa: "Non-dom GFA", gfa: "GFA" };
  const vals = (v) => Object.keys(lab).filter((k) => v[k] != null).map((k) => `${lab[k]} <b>${v[k].toLocaleString("en-GB")}</b>`).concat(v.bhPlan ? ["BH on the Plan"] : []).join(" · ");
  return `<div class="st-notes"><div class="st-head"><b>From the Notes: ${esc(NOTES.plan || "plan")}</b><button type="button" class="ghost" data-nclose>×</button></div>
    ${NOTES.zones.length ? `<table>${NOTES.zones.map((z, i) => `<tr${normZone(z.zone) === normZone(pl.zone) ? ' class="on"' : ""}><td><b>${esc(z.zone)}</b></td><td>${vals(z.values)}<small>${esc(Object.values(z.evidence || {})[0] || "")}</small></td><td><button type="button" class="ghost" data-nuse="${i}"${CAN ? "" : " disabled"}>Use</button></td></tr>`).join("")}</table>
    <div class="st-row"><button type="button" class="ghost" id="st-nsave"${CAN ? "" : " disabled"}>Save all ${NOTES.zones.length} to the office list</button><span class="muted st-note">Read from the Notes' own wording: check each against the Notes.</span></div>`
    : `<p class="muted st-note">No restrictions found in the wording of these Notes: type them.</p>`}</div>`;
}
async function ozpPut(plan, zone, values, src) {
  OFFICE = await api("/api/ozp", { method: "PUT", body: JSON.stringify({ plan, zone, values, src }) });
}
/* the development potential rows (B(P)R, OZP, lease; the strictest) */
function potentialOf(s, areaM2, cls) {
  const pl = s.plan || {}, ls = s.lease || {};
  // B(P)R from the height: the OZP or lease height less the site level
  const bh = [pl.bh, ls.bh].map(Number).filter((x) => x > 0);
  const top = bh.length ? Math.min(...bh) : null;
  const h = top != null && pl.level !== "" && pl.level != null ? top - Number(pl.level) : null;
  const B = areaM2 && cls && h > 0 ? bprSite({ area: areaM2, cls: cls.cls, kind: "domestic", height: h }) : null;
  const bpr = B && B.status === "ok" ? { dpr: B.dom.pr, npr: B.non.pr, sc: B.dom.sc } : {};
  const rows = S.potential({ area: areaM2, bpr, ozp: { dpr: pl.dpr, npr: pl.npr, pr: pl.pr, sc: pl.sc, bh: pl.bh, storeys: pl.storeys }, lease: ls });
  return { rows, B, h };
}
function siteAreaOf(s) {
  const a = S.area(s.pts), n = s.pts.length;
  return n >= 3 ? (s.target > 0 && Math.abs(a - s.target) < 0.05 ? s.target : a) : s.target || null;
}
function planCards(s, areaM2, cls) {
  const pl = s.plan || {}, ls = s.lease || {}, dis = CAN ? "" : " disabled";
  const z = zoneOf(pl), PP = planOf(pl.plan), P = PP && PP.builtIn;
  const inp = (grp, k, v, ph, w) => `<input type="number" step="any" min="0" data-${grp}="${k}" value="${esc(v == null ? "" : v)}" placeholder="${esc(ph || "")}"${dis}${w ? ` style="width:${w}px"` : ""}>`;
  const plans = [...new Set([...Object.keys(OZP), ...Object.keys(OFFICE.plans)])].map((k) => `<option value="${esc(k)}">`).join("");
  const zones = PP ? Object.keys(PP.zones).map((k) => `<option value="${esc(k)}">`).join("") : "";
  const { rows, B, h } = potentialOf(s, areaM2, cls);
  const fmt = (r, v) => (v == null ? "–" : r.unit === "m²" ? f1(v) : r.unit === "%" ? f1(v) : r.unit === "mPD" ? f1(v) : String(v));
  return `<section class="st-card" id="st-plan">
      <div class="st-head"><b>3 · Planning and lease</b><a class="st-link" href="${OZP_PORTAL}" target="_blank" rel="noopener">OZP portal ›</a></div>
      <div class="st-grid">
        <label class="st-f">Plan no.<input data-pl="plan" list="st-plans" value="${esc(pl.plan || pl.planno || "")}" placeholder="e.g. S/TM-LTYY/14"${dis}></label>
        <label class="st-f">Zone<input data-pl="zone" list="st-zones" value="${esc(pl.zone || "")}" placeholder="e.g. CDA, R(A)9"${dis}></label>
      </div>
      <datalist id="st-plans">${plans}</datalist><datalist id="st-zones">${zones}</datalist>
      <p class="st-known ${z ? "good" : pl.plan ? "warn" : ""}">${z ? `${esc(z.key)}: filled in from ${z.office ? `the office list${z.by ? " (" + esc(z.by) + (z.at ? ", " + esc(z.at) : "") + ")" : ""}${z.src ? " · " + esc(z.src) : ""}` : esc(P.name)}` : PP ? `${esc(normPlan(pl.plan))} is known: choose its zone (${Object.keys(PP.zones).length} zones).` : pl.plan ? `${esc(normPlan(pl.plan))} is not in the list yet: read its Notes PDF, or type the figures and save them for the office.` : "Type the plan no.: a plan in the list fills in its zone's restrictions."}</p>
      <div class="st-row st-ozp-act">
        <label class="ghost st-up${CAN ? "" : " off"}">📄 Read the Notes PDF<input type="file" accept="application/pdf,.pdf" id="st-notes"${dis} hidden></label>
        <button type="button" class="ghost" id="st-ozp-save"${CAN && pl.plan && pl.zone ? "" : " disabled"} title="Keep these figures for this plan and zone, for everyone in the office">Save to the office list</button>
      </div>
      ${notesBox(pl)}
      <table class="st-lim"><thead><tr><th></th><th>OZP</th><th>Lease</th></tr></thead><tbody>
        <tr><td>Domestic PR / GFA m²</td><td>${inp("pl", "dpr", pl.dpr, "PR", 70)}</td><td>${inp("ls", "dgfa", ls.dgfa, "GFA m²", 100)}</td></tr>
        <tr><td>Non-domestic PR / GFA m²</td><td>${inp("pl", "npr", pl.npr, "PR", 70)}</td><td>${inp("ls", "ngfa", ls.ngfa, "GFA m²", 100)}</td></tr>
        <tr><td>Total PR / GFA m²</td><td>${inp("pl", "pr", pl.pr, "PR", 70)}</td><td>${inp("ls", "gfa", ls.gfa, "GFA m²", 100)}</td></tr>
        <tr><td>Site coverage %</td><td>${inp("pl", "sc", pl.sc, "none", 70)}</td><td>${inp("ls", "sc", ls.sc, "none", 100)}</td></tr>
        <tr><td>Building height mPD</td><td>${inp("pl", "bh", pl.bh, z && z.bhPlan ? "on the Plan" : "none", 70)}</td><td>${inp("ls", "bh", ls.bh, "none", 100)}</td></tr>
        <tr><td>Storeys</td><td>${inp("pl", "storeys", pl.storeys, "none", 70)}</td><td>${inp("ls", "storeys", ls.storeys, "none", 100)}</td></tr>
      </tbody></table>
      <label class="st-f">Site formation level (mPD) <small>for the B(P)R height band</small>${inp("pl", "level", pl.level, "e.g. 6.0")}</label>
      ${z && z.bhPlan && !(pl.bh > 0) ? `<p class="st-sent warn">The height of ${esc(pl.zone)} is on the Plan: read it there and type it.</p>` : ""}
      ${z && z.note ? `<p class="muted st-note">${esc(z.note)}</p>` : ""}
      ${P ? `<p class="muted st-note">${esc(P.common)} <i>Source: ${esc(P.name)}, ${esc(P.src)}.</i></p>` : `<p class="muted st-note">Read the plan's Notes on the OZP portal and type the restrictions.</p>`}
    </section>
    <section class="st-card" id="st-pot">
      <div class="st-head"><b>4 · Development potential</b><span class="muted">the strictest governs</span></div>
      ${areaM2 ? "" : `<p class="st-need">Give the site area (step 1) for the GFAs.</p>`}
      <table class="st-pot"><thead><tr><th></th><th>B(P)R</th><th>OZP</th><th>Lease</th><th>Governs</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${r.label}${r.unit ? ` <small>${r.unit}</small>` : ""}</td>${["bpr", "ozp", "lease"].map((k) => `<td class="num${r[k] != null && r.value != null && Math.abs(r[k] - r.value) < 1e-9 ? " gov" : ""}">${fmt(r, r[k])}</td>`).join("")}<td class="num"><b>${fmt(r, r.value)}</b>${r.by ? `<small>${esc(r.by)}</small>` : ""}</td></tr>`).join("")}
      </tbody></table>
      <p class="muted st-note">${B && B.status === "ok" ? `B(P)R: class ${esc(cls.cls)}, a building of ${f1(h)} m (${esc(B.band)}), domestic site coverage and plot ratios from the First Schedule.` : "B(P)R figures need the class of site, a height (OZP or lease) and the site level."} GFA = plot ratio × the site area; the OZP's and lease's exemptions are not taken off here.</p>
    </section>`;
}
function sentNote() {
  const q = WB.data.quick, s = study();
  if (!q || q.area == null) return "";
  const a = S.area(s.pts), same = s.pts.length >= 3 && Math.abs(q.area - (s.target > 0 && Math.abs(a - s.target) < 0.05 ? s.target : a)) < 0.01;
  return `<p class="st-sent ${same ? "good" : "warn"}">The workbook has ${f3(q.area)} m², class ${esc(q.cls || "–")}${same ? "" : " — not the same as here"}.</p>`;
}
function wirePanel() {
  const el = $("#st-panel");
  el.addEventListener("change", (ev) => {
    const t = ev.target, s = study();
    if (t.dataset.sf === "name") { s.name = t.value.trim(); save(); }
    else if (t.dataset.sf === "target") { const v = parseFloat(t.value); s.target = v > 0 ? v : null; panel(); tools(); save(); }
    else if (t.dataset.se != null) {
      const i = +t.dataset.se;
      if (t.value === "") delete s.streets[i];
      else s.streets[i] = t.value === "new" ? newRoad(s) : +t.value;
      pruneRoads(s); changed();
    }
    else if (t.dataset.muse != null && t.value) { const m = s.measures[+t.dataset.muse]; (s.roads[t.value] = s.roads[t.value] || {}).width = +m.len.toFixed(1); changed(); }
    else if (t.dataset.rn != null) { (s.roads[t.dataset.rn] = s.roads[t.dataset.rn] || {}).name = t.value.trim(); changed(); }
    else if (t.dataset.rw != null) { (s.roads[t.dataset.rw] = s.roads[t.dataset.rw] || {}).width = t.value === "" ? "" : Math.max(0, parseFloat(t.value)); changed(); }
    else if (t.dataset.pl != null || t.dataset.ls != null) {
      const grp = t.dataset.pl != null ? "plan" : "lease", k = t.dataset.pl != null ? t.dataset.pl : t.dataset.ls;
      const o = s[grp] = s[grp] || {};
      o[k] = t.type === "number" ? (t.value === "" ? "" : Math.max(0, parseFloat(t.value))) : t.value.trim();
      if (grp === "plan" && k === "plan") { o.plan = normPlan(o.plan); delete o.planno; }
      if (grp === "plan" && (k === "zone" || k === "plan")) { const z = zoneOf(o); if (z) { o.zone = z.key; fillZone(o, z); } }
      panel(); save();
    }
  });
  el.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches("input")) ev.target.blur(); });
  el.addEventListener("change", async (ev) => {
    if (ev.target.id !== "st-notes" || !ev.target.files[0]) return;
    NOTES = { busy: true }; panel();
    try {
      const r = await fetch("/api/ozp/notes", { method: "POST", headers: headers(false), body: ev.target.files[0] });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.detail || "Not read");
      NOTES = b;
      const s = study(), o = s.plan = s.plan || {};
      if (b.plan && !o.plan) o.plan = normPlan(b.plan);
    } catch (e) { NOTES = { error: e.message }; }
    panel(); save();
  });
  el.addEventListener("click", async (ev) => {
    const s = study(), o = s.plan = s.plan || {};
    const t = ev.target;
    if (t.id === "st-add") {
      const name = $("#st-add-name").value.trim(), w = $("#st-add-w").value;
      if (!name) { toast("Type the street's name", true); return $("#st-add-name").focus(); }
      const id = newRoad(s); s.roads[id] = { name, width: w === "" ? "" : Math.max(0, parseFloat(w)) };
      stopModes(); PICK = id; $("#st-map").classList.add("st-drawing");
      hint(`Click the edges along ${name} on the map; click one again to take it off. Done (or Esc) when finished.`, 0);
      changed(); tools(); return;
    }
    if (t.dataset.rpick) { stopModes(); PICK = t.dataset.rpick; $("#st-map").classList.add("st-drawing"); hint(`Click the edges along ${roadName(s, PICK)}. Done (or Esc) when finished.`, 0); draw(); tools(); panel(); return; }
    if (t.dataset.rdel) {
      const id = t.dataset.rdel;
      if (!confirm(`Remove ${roadName(s, id)} and take its edges off?`)) return;
      for (const [e, v] of Object.entries(s.streets)) if (String(v) === id) delete s.streets[e];
      delete s.roads[id]; if (String(PICK) === id) stopModes();
      changed(); tools(); return;
    }
    if (t.dataset.mdel != null) { s.measures.splice(+t.dataset.mdel, 1); return changed(); }
    if (t.id === "st-mclear") { s.measures = []; return changed(); }
    if (ev.target.closest("[data-nclose]")) { NOTES = null; return panel(); }
    const use = ev.target.closest("[data-nuse]");
    if (use) {
      const z = NOTES.zones[+use.dataset.nuse];
      if (NOTES.plan) o.plan = normPlan(NOTES.plan);
      o.zone = z.zone; fillZone(o, z.values);
      panel(); save(); return;
    }
    if (ev.target.id === "st-nsave") {
      try {
        for (const z of NOTES.zones) await ozpPut(NOTES.plan || o.plan, z.zone, z.values, `Notes (${z.heading || ""}) read ${new Date().toISOString().slice(0, 10)}`);
        toast(`Saved ${NOTES.zones.length} zones of ${NOTES.plan} for the office`); panel();
      } catch (e) { toast(e.message, true); }
      return;
    }
    if (ev.target.id === "st-ozp-save") {
      try {
        await ozpPut(o.plan, o.zone, { dpr: o.dpr, npr: o.npr, pr: o.pr, sc: o.sc, bh: o.bh, storeys: o.storeys, bhPlan: o.bhPlan }, "typed from the Notes");
        toast(`${normPlan(o.plan)} ${o.zone} saved: the office gets it when they type the plan no.`); panel();
      } catch (e) { toast(e.message, true); }
      return;
    }
  });
  el.addEventListener("click", (ev) => {
    if (ev.target.id !== "st-send") return;
    const s = study(), a = S.area(s.pts), cls = clsOf(s);
    const areaOut = +(s.target > 0 && Math.abs(a - s.target) < 0.05 ? s.target : a).toFixed(3);
    const q = WB.data.quick || (WB.data.quick = {});
    if (q.area != null && Math.abs(q.area - areaOut) > 0.01 && !confirm(`The workbook has ${f3(q.area)} m². Replace it with ${f3(areaOut)} m² (class ${cls.cls})?`)) return;
    q.area = areaOut; q.cls = cls.cls;
    push.quickSent = { area: areaOut, cls: cls.cls };
    panel(); save();
    toast(`Sent: ${f3(areaOut)} m², class ${cls.cls}`);
  });
}

/* ---------- finding a place */
function wireFind() {
  const go = async () => {
    const q = $("#st-q").value.trim(), box = $("#st-hits");
    if (!q) return;
    // "E 836694 N 819070" or "836694, 819070": HK 1980 Grid
    const m = q.match(/^\s*E?\s*(8\d{5}(?:\.\d+)?)\s*[, ]\s*N?\s*(8\d{5}(?:\.\d+)?)\s*$/i);
    if (m) { const p = S.hk80ToWgs84(+m[1], +m[2]); map.setView(p, 18); box.hidden = true; return; }
    const ll = q.match(/^\s*(2[12]\.\d+)\s*,\s*(11[34]\.\d+)\s*$/);
    if (ll) { map.setView([+ll[1], +ll[2]], 18); box.hidden = true; return; }
    box.hidden = false; box.innerHTML = `<p class="muted">Finding …</p>`;
    // a lot number (STTL 121, TKOTL 137, IL 152, DD 123 Lot 456): the Lands Department's lot search and boundary
    if (LOT_RE.test(q)) return findLot(q, box);
    return findPlace(q, box);
  };
  $("#st-find").addEventListener("submit", go);
}
/* a place, an address or a building: the Lands Department's Location Search */
async function findPlace(q, box) {
    try {
      const r = await api("/api/site/search?" + new URLSearchParams({ q }));
      const rows = r.results || [];
      box.innerHTML = rows.length ? rows.map((x, i) => `<button type="button" data-hit="${i}"><b>${esc(x.name)}</b>${x.zh && x.zh !== x.name ? ` <span>${esc(x.zh)}</span>` : ""}<small>${esc(x.address)}</small></button>`).join("")
        : `<p class="muted">Nothing found. Try an address, a building name, or HK 1980 grid "E 836694 N 819070".</p>`;
      box.onclick = (ev) => {
        const b = ev.target.closest("[data-hit]");
        if (!b) return;
        const x = rows[+b.dataset.hit], p = S.hk80ToWgs84(x.x, x.y);
        map.setView(p, 18);
        const mk = L_.circleMarker(p, { radius: 9, color: STREET, weight: 3, fill: false }).addTo(map);
        setTimeout(() => mk.remove(), 6000);
        box.hidden = true;
      };
    } catch (e) { box.innerHTML = `<p class="bad">${esc(e.message)}</p>`; }
}

/* ---------- find by lot number: LandsD Land Parcel Number search + the iC1000 Lot Index (/api/site/lot, /api/site/lotgeom) */
const LOT_RE = /^\s*(([A-Z]{0,6}L)\s*\d+[A-Z]?|DD\s*\d+\s*(LOT\s*(NO\.?)?)?\s*\d+[A-Z]?)(\s*(S\.?|SEC\.?|SECTION)\s*[A-Z]\b.*|\s*R\.?P\.?)?\s*$/i;
let lotLayer = null;
async function findLot(q, box) {
  let rows = [];
  try { rows = (await api("/api/site/lot?" + new URLSearchParams({ no: q }))).results || []; }
  catch (e) { box.innerHTML = `<p class="bad">${esc(e.message)}</p>`; return; }
  if (!rows.length) return findPlace(q, box);
  box.innerHTML = `<p class="muted">${rows.length > 1 ? "Lots found - choose one" : "Lot found"} (Lands Department)</p>` + rows.map((x, i) => `<button type="button" data-lot="${i}"><b>${esc(x.name)}</b> <span>${esc(x.place)}</span>${x.score != null && x.score < 100 ? `<small>match ${Math.round(x.score)}</small>` : ""}</button>`).join("");
  box.onclick = async (ev) => {
    const b = ev.target.closest("[data-lot]"), u = ev.target.closest("[data-lotuse]");
    if (u && box._lot) return useLot(box._lot, box);
    if (!b) return;
    const x = rows[+b.dataset.lot];
    map.setView(S.hk80ToWgs84(x.x, x.y), 18);
    b.disabled = true;
    try {
      const g = (await api("/api/site/lotgeom?" + new URLSearchParams({ id: x.id, x: x.x, y: x.y, ext: (x.ext || []).join(","), type: x.type || "lot" }))).lot;
      const rings = g.rings.map((r) => r.map(([e, n]) => S.hk80ToWgs84(e, n)));
      if (lotLayer) lotLayer.remove();
      lotLayer = L_.polygon(rings, { color: "#c62828", weight: 3, dashArray: "6 4", fillColor: "#c62828", fillOpacity: 0.08 }).addTo(map).bindTooltip(esc(g.name), { permanent: true, direction: "center", className: "st-edge-lab st" });
      map.fitBounds(lotLayer.getBounds(), { padding: [60, 60], maxZoom: 19 });
      const area = S.area(rings[0]);
      box._lot = { name: g.name, id: g.id, pts: rings[0], area };
      box.innerHTML = `<div class="st-lot"><b>${esc(g.name)}</b> <span>${esc(x.place)}</span><br><small>${f1(area)} m² from the lot boundary (LandsD iC1000 - for identification only, not a survey)${g.rings.length > 1 ? ` · ${g.rings.length} parts, the first is used` : ""}</small>
        <div class="st-row">${CAN ? `<button type="button" class="primary st-ib" data-lotuse>Use as the site boundary</button>` : ""}<a class="st-link" href="${OZP_PORTAL}" target="_blank" rel="noopener">Open the OZP portal ›</a></div>
        <small class="muted">The zoning: choose the plan and zone under <b>3 · Planning and lease</b>; the plan's Notes can be read there. Lot data © Lands Department.</small></div>` + rows.map((y, i) => `<button type="button" data-lot="${i}"><b>${esc(y.name)}</b> <span>${esc(y.place)}</span></button>`).join("");
    } catch (e) { b.disabled = false; toast(e.message, true); }
  };
}
function useLot(lot, box) {
  const s = study();
  if (s.pts.length >= 3 && !confirm(`Replace the site boundary with ${lot.name} (${f1(lot.area)} m²)?`)) return;
  lastPts = snap();
  s.pts = lot.pts.slice(); s.streets = {}; s.roads = {}; s.factor = null;
  s.lot = { name: lot.name, id: lot.id, area: Math.round(lot.area * 100) / 100 };
  if (!s.name) s.name = lot.name;
  if (!(s.target > 0)) s.target = Math.round(lot.area * 100) / 100;
  if (lotLayer) { lotLayer.remove(); lotLayer = null; }
  box.hidden = true;
  changed(); fit();
  hint(`${lot.name}: ${f1(lot.area)} m². Mark the streets (click an edge); Undo shape puts the old boundary back.`, 8000);
}

/* ---------- start */
(async () => {
  const me = await ensureSignedIn();
  header(me);
  if (!project()) { $("#st-panel").innerHTML = `<p class="st-need">Open a project first (Projects).</p>`; return; }
  initMap(); wireTools(); wirePanel(); wireFind();
  try {
    const wb = await api("/api/gbp");
    WB = { rev: wb.rev || 0, data: wb.data || {} };
    CAN = !!wb.can_edit;
  } catch (e) { toast(e.message, true); }
  try { OFFICE = await api("/api/ozp"); } catch (e) {}
  document.body.classList.toggle("st-ro", !CAN);
  const s = study();
  if (s.pts.length >= 3) fit();
  else if (s.view && s.view.c) map.setView(s.view.c, s.view.z || 16);
  draw(); panel(); tools();
  MS.init({
    hint, headers: () => headers(false), study, save, can: () => CAN, map: () => map, L: L_, siteArea: () => siteAreaOf(study()),
    potential: () => { const s2 = study(); return potentialOf(s2, siteAreaOf(s2), s2.pts.length >= 3 ? clsOf(s2) : null).rows; },
    sendToWorkbook: ({ gfaTotal, height }) => {
      const q = WB.data.quick || (WB.data.quick = {});
      q.gfa = Object.assign({}, q.gfa || {}, { total: gfaTotal, use_permitted: false });
      q.hmode = "m"; q.height = height;
      push.quickSent = Object.assign({}, push.quickSent || {}, { gfa: q.gfa, hmode: "m", height });
      save();
    },
  });
  const setMode = (m) => {
    for (const b of document.querySelectorAll(".st-mode [data-mode]")) b.classList.toggle("on", b.dataset.mode === m);
    stopModes(); MS.show(m === "mass"); UN.show(m === "units"); FL.show(m === "floors");
    if (m === "units" || m === "floors") $("#st-panel").hidden = true;
    draw(); if (m === "site") { panel(); tools(); }
    try { sessionStorage.setItem("lwk-viewer:site-mode", m); } catch (e) {}
  };
  document.querySelector(".st-mode").addEventListener("click", (ev) => { const b = ev.target.closest("[data-mode]"); if (b) setMode(b.dataset.mode); });
  let m0 = "site"; try { m0 = new URLSearchParams(location.search).get("mode") || sessionStorage.getItem("lwk-viewer:site-mode") || "site"; } catch (e) {}
  UN.init({ study, save, can: () => CAN });
  FL.init({ study, save, can: () => CAN, S });
  if (m0 === "mass" || m0 === "units" || m0 === "floors") setMode(m0);
  window.__site = { study, S, map: () => map }; // for the tests
})();
