/* Site study, phase 2: Massing - the blocks on the site, their floor groups,
 * the live figures against the governing limits, the refuge floors, the
 * footprints on the map (corners, set-backs, measure), the 3D view with its
 * elevations and section, and the surroundings. Kept in study.massing with
 * the project. The figures are massingcore.js's.
 */
import * as S from "./sitecore.js";
import * as M from "./massingcore.js";
import * as UC from "./unitcore.js";
import { toast } from "./tasks-util.js";
import * as PT from "./plantools.js";
import * as SCH from "./schemes.js";
import * as SUN from "./sun.js";
import { iconSvg, iconColor } from "./icons.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f0 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { maximumFractionDigits: 0 }));
const f1 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const f2 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const TILE = "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/WGS84/";

let C = null, layer = null, ON = false, VIEW = "plan", T3 = null, SEL = null;
let TOOL = null; // "measure" {a} | "context" [pts]
let MEAS = [], rub = null;
let ELEV = 0, CUT = 50, SELG = null; // SELG: {b: block id, g: group index} - editing that group's own floor plate
const pref = (k, d) => { try { const v = localStorage.getItem("lwk-viewer:ms-" + k); return v == null ? d : v === "1"; } catch (e) { return d; } };
const setPref = (k, v) => { try { localStorage.setItem("lwk-viewer:ms-" + k, v ? "1" : "0"); } catch (e) {} };
let SNAP = pref("snap", true), SHADOW = pref("shadow", true), CTX3D = pref("ctx3d", true);

/* the surroundings' extent: half-width of the square, m (per project) */
const ctxR = () => { const m = mass(); return [250, 500, 1000, 1500].includes(+m.ctxR) ? +m.ctxR : 500; };
export function init(ctx) {
  C = ctx;
  layer = C.L.layerGroup();
  const P = $("#st-mpanel");
  P.addEventListener("change", onChange);
  P.addEventListener("click", onClick);
  P.addEventListener("toggle", (ev) => { const t = ev.target; if (t.dataset && t.dataset.topen != null) { const b = mass().blocks[+t.dataset.topen]; if (b) b.toolsOpen = t.open; } }, true);
  P.addEventListener("contextmenu", (ev) => {
    const t = ev.target.closest("[data-gfp]"); if (!t) return;
    ev.preventDefault();
    const [bi, gi] = t.dataset.gfp.split(".").map(Number), m = mass(), g = m.blocks[bi].groups[gi];
    if (g.fp && confirm("Back to the block's floor plate for these floors?")) { delete g.fp; SELG = null; changed(); }
  });
  P.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches("input")) ev.target.blur(); });
  $("#st-views").addEventListener("click", onViews);
  $("#st-views").addEventListener("change", onViews);
  $("#st-views").addEventListener("input", onViews);
  window.addEventListener("resize", () => T3 && T3.resize());
  // the keys the user can change (the shortcuts table: ? or the ⌨ button): each clicks its button in the bar
  PT.KS.register("massing", () => ON, MKEYS.map(([id, key, label, group, sel]) => ({ id, key, label, group, sel })), [
    { keys: "Ctrl+Z / Ctrl+Y", label: "Undo / redo", group: "Edit" }, { keys: "Esc", label: "Stop measuring or drawing", group: "Edit" }, { keys: "Enter / double-click", label: "Finish a neighbouring building", group: "Edit" },
    { keys: "Right-click a block", label: "Copy, paste, remove…", group: "Edit" }, { keys: "Alt + drag", label: "No snapping", group: "Edit" },
  ], "2 · Massing");
  document.addEventListener("keydown", (ev) => {
    if (ON && (ev.ctrlKey || ev.metaKey) && !ev.target.closest("input,select,textarea")) {
      const k = ev.key.toLowerCase();
      if (k === "z" && !ev.shiftKey) { ev.preventDefault(); return undo(-1); }
      if (k === "y" || (k === "z" && ev.shiftKey)) { ev.preventDefault(); return undo(1); }
    }
    if (ev.key === "Escape" && TOOL) endTool(); if (ev.key === "Enter" && TOOL && TOOL.kind === "context") finishContext(); });
  window.__mass = { t3: () => T3, selg: () => SELG };
  const map = C.map();
  // the middle button drags the map (Leaflet pans with the left only)
  { const el = map.getContainer(); let mp = null;
    el.addEventListener("mousedown", (ev) => { if (ev.button !== 1) return; ev.preventDefault(); mp = [ev.clientX, ev.clientY]; });
    addEventListener("mousemove", (ev) => { if (!mp) return; map.panBy([mp[0] - ev.clientX, mp[1] - ev.clientY], { animate: false }); mp = [ev.clientX, ev.clientY]; });
    addEventListener("mouseup", (ev) => { if (ev.button === 1) mp = null; }); }
  map.on("click", (ev) => { if (!ON || !TOOL) return; toolClick(ev); });
  map.on("dblclick", () => { if (ON && TOOL && TOOL.kind === "context") finishContext(); });
  map.on("mousemove", (ev) => { if (ON && TOOL && TOOL.kind === "measure" && TOOL.a) rubber(ev); });
  // right-click the map: paste a copied block there
  map.on("contextmenu", (ev) => { if (!ON || !C.can() || VIEW !== "plan" || !PT.clip.get("block")) return; PT.ctx(ev.originalEvent, [{ label: "Paste the block here", action: () => pasteBlock([ev.latlng.lat, ev.latlng.lng]) }]); });
}
/* a copied block put down with its middle at a point */
function pasteBlock(at) {
  const c = PT.clip.get("block"); if (!c) return;
  const b = c.data, m = mass(), mid = S.centroid(b.fp), dl = at[0] - mid[0], dg = at[1] - mid[1];
  const shift = (fp) => fp.map(([a, g]) => [a + dl, g + dg]);
  b.id = uid(); b.name = (b.name || "Block") + " (copy)"; b.fp = shift(b.fp); b.fromSite = false;
  for (const g of b.groups || []) if (g.fp) g.fp = shift(g.fp);
  m.blocks.push(b); SEL = b.id; changed();
}

/* a site edge's name: its number and the street on it */
function edgeName(i) {
  const s = C.study(), id = s.streets && s.streets[i], r = id != null && s.roads && s.roads[id];
  return `E${i + 1}${id != null ? " · " + (r && r.name ? r.name : "street") : ""}`;
}
function mass() {
  const s = C.study();
  s.massing = s.massing && typeof s.massing === "object" ? s.massing : {};
  const m = s.massing;
  m.blocks = Array.isArray(m.blocks) ? m.blocks : [];
  m.context = Array.isArray(m.context) ? m.context : [];
  m.grid = Object.assign({ on: false, step: 3, ang: 0 }, m.grid || {});
  // the first form typed concessions; GFA % now gives them, the typed figure is an extra
  for (const b of m.blocks) for (const g of b.groups || []) if (g.conc != null && g.extra == null) { g.extra = g.conc; delete g.conc; }
  return m;
}
const origin = () => { const s = C.study(); return s.pts.length >= 3 ? S.centroid(s.pts) : null; };
function model(m0) {
  const o = origin(), m = m0 || mass();
  const xy = (fp) => (o && fp && fp.length >= 3 ? S.toXY(fp, o) : null);
  return { blocks: m.blocks.map((b) => Object.assign({}, b, { fp: xy(b.fp) || [], groups: (b.groups || []).map((g) => Object.assign({}, g, { fp: xy(g.fp) })) })) };
}
const uid = () => "b" + Math.random().toString(36).slice(2, 8);

export function show(on) {
  ON = on;
  document.body.classList.toggle("st-mass", on);
  $("#st-panel").hidden = on;
  $("#st-mpanel").hidden = !on;
  $("#st-views").hidden = !on;
  if (on) { if (!HIST.length) snapHist(); layer.addTo(C.map()); render(); viewsBar(); } else { endTool(); layer.remove(); setView("plan"); }
}
export function refresh() { if (ON) render(); }

/* ---------- views: Plan / 3D / Elevation / Section, and the plan tools */
const MKEYS = [
  ["plan", "p", "Plan", "View", '#st-views [data-v="plan"]'], ["3d", "3", "3D", "View", '#st-views [data-v="3d"]'],
  ["elev", "e", "Elevation", "View", '#st-views [data-v="elev"]'], ["sect", "s", "Section", "View", '#st-views [data-v="sect"]'],
  ["measure", "m", "Measure (plan)", "Tools", '#st-views [data-tool="measure"]'], ["context", "k", "Draw a neighbouring building (plan)", "Tools", '#st-views [data-tool="context"]'],
  ["grid", "g", "Grid on / off (plan)", "Tools", "#st-views [data-grid]"], ["snap", "n", "Snap on / off (plan)", "Tools", "#st-views [data-snap]"],
];
/* the level whose plate is edited (on the plan and in 3D): the block's, or a floor group's own; and its plate matched to another's */
function levelBar() {
  const m = mass(), st = M.stacks(model()), opts = [["", "Plate: the block's"]];
  for (const b of m.blocks) {
    const sts = (st.find((x) => x.block.id === b.id) || { storeys: [] }).storeys;
    (b.groups || []).forEach((g, gi) => {
      const nos = sts.filter((q) => q.gi === gi && q.no != null).map((q) => q.no), lab = (M.USES[g.use] || {}).label || g.use;
      opts.push([b.id + ":" + gi, `${b.name || "Block"} · ${lab}${nos.length ? ` · floors ${Math.min(...nos)}–${Math.max(...nos)}` : ""}${g.fp ? " ▱" : ""}`]);
    });
  }
  const cur2 = SELG ? SELG.b + ":" + SELG.g : "", can = C.can() ? "" : " disabled";
  const IB2 = (attr, t, title, dis) => `<button type="button" ${attr} class="pt-b wt" title="${esc(title)}"${dis || !C.can() ? " disabled" : ""}><span>${t}</span></button>`;
  return `<span class="pt-sep"></span><select data-level title="The level whose plate you edit: on the plan, or click it in 3D and drag its corners"${can}>${opts.map(([v, l]) => `<option value="${esc(v)}"${v === cur2 ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`
    + (SELG ? IB2('data-match="below"', "≡ below", "Match the plate of the floors below (or the block's)") + IB2('data-match="above"', "≡ above", "Match the plate of the floors above") + IB2('data-match="block"', "≡ block", "Back to the block's plate") : "");
}
function viewsBar() {
  const s = C.study(), n = s.pts.length, no = {};
  const names = (i) => { const id = s.streets && s.streets[i]; const r = id != null && s.roads && s.roads[id]; return r && r.name ? r.name : id != null ? "Street" : "Edge " + (i + 1) + "–" + ((i + 1) % n + 1); };
  void no;
  const el = $("#st-views");
  el.classList.add("ms-ibar");
  const IB = (attr, icon, title, on) => `<button type="button" ${attr} class="pt-b${on ? " on" : ""}" title="${esc(title)}" style="--ico:${iconColor(icon)}">${iconSvg(icon, 18)}</button>`;
  el.innerHTML = `${IB('data-v="plan"', "plan", "Plan", VIEW === "plan")}${IB('data-v="3d"', "threed", "3D", VIEW === "3d")}${IB('data-v="elev"', "elev", "Elevation", VIEW === "elev")}${IB('data-v="sect"', "section", "Section", VIEW === "sect")}<span class="pt-sep"></span>
    ${VIEW === "elev" || VIEW === "sect" ? `<select data-elev title="Looking at the building square to this edge">${s.pts.map((p, i) => `<option value="${i}"${i === ELEV ? " selected" : ""}>${VIEW === "elev" ? "from " : "along "}${esc(edgeName(i))}</option>`).join("")}</select>` : ""}
    ${VIEW === "sect" ? `<input type="range" min="0" max="100" value="${CUT}" data-cut title="Where the section cuts">` : ""}
    ${VIEW === "plan" && C.can() ? IB('data-tool="measure"', "measure", "Measure: snaps to the site and the footprints", TOOL && TOOL.kind === "measure") + IB('data-tool="context"', "context", "Draw a neighbouring building for the 3D view", TOOL && TOOL.kind === "context") : ""}
    ${VIEW === "plan" ? gridBar() : ""}
    ${VIEW === "plan" ? IB("data-snap", "snap", "Snap corners to the site, the other footprints and the neighbours (Alt while dragging: free)", SNAP) : `${IB("data-shadow", "shadow", "Shadows on / off", SHADOW)}${IB("data-ctx3d", "world", "The buildings around: the Lands Department's 3D Spatial Data (CSDI)", CTX3D)}<select data-ctxr title="How far around: the map and the buildings, each side of the site">${[250, 500, 1000, 1500].map((v) => `<option value="${v}"${v === ctxR() ? " selected" : ""}>± ${v.toLocaleString("en-GB")} m</option>`).join("")}</select><span class="ms-ctxst" id="ms-ctxst"></span>`}
    ${VIEW === "3d" ? IB("data-sun", "plane", "Sun and shadow study: a date and the time of day (Hong Kong)", !!SUNS.on) + (SUNS.on ? sunBar() : "") : ""}
    ${VIEW !== "plan" ? IB("data-png", "camera", "Save this view as a picture (PNG)") : ""}${VIEW === "plan" || VIEW === "3d" ? levelBar() : ""}<span class="pt-sep"></span>${IB("data-legend", "legend", "Legend: what the colours and lines mean")}${IB("data-keys", "keys", "Keyboard shortcuts  (?)")}`;
  // each button's tooltip with its key from the user's keys
  for (const [id, , , , sel] of MKEYS) { const b = document.querySelector(sel), k = PT.KS.keyFor("massing", id); if (b && k) b.title += "  (" + k + ")"; }
}
/* the sun study's bar: the date, the time (a slider and play), where the sun is */
let SUNS = { on: false, d: "06-21", h: 10 }, SUNT = null;
function sunBar() {
  const [mo, dy] = SUNS.d.split("-").map(Number), p = SUN.position(mo, dy, SUNS.h), dl = SUN.daylight(mo, dy);
  return `<select data-sund title="The day">${SUN.PRESETS.map(([v, l]) => `<option value="${v}"${v === SUNS.d ? " selected" : ""}>${l}</option>`).join("")}</select>
    <input type="range" min="${Math.ceil((dl.rise || 6) * 4) / 4}" max="${Math.floor((dl.set || 18) * 4) / 4}" step="0.25" value="${SUNS.h}" data-sunh title="The time of day (local)">
    <button type="button" data-sunplay class="pt-b wt" title="Play the day"><span>${SUNT ? "❚❚" : "▶"}</span></button>
    <small class="ms-sunt" id="ms-sunt">${SUN.hhmm(SUNS.h)} · sun ${Math.round(p.az)}° / ${Math.max(0, p.alt).toFixed(0)}° up</small>`;
}
function applySun() {
  if (!T3 || !T3.setSun) return;
  if (!SUNS.on) return T3.setSun(null);
  const [mo, dy] = SUNS.d.split("-").map(Number), p = SUN.position(mo, dy, SUNS.h);
  T3.setSun(p.dir);
  const el = document.getElementById("ms-sunt"); if (el) el.textContent = `${SUN.hhmm(SUNS.h)} · sun ${Math.round(p.az)}° / ${Math.max(0, p.alt).toFixed(0)}° up`;
}
function gridBar() {
  const g = mass().grid, s = C.study(), can = C.can() ? "" : " disabled";
  return `<button type="button" data-grid class="pt-b${g.on ? " on" : ""}" title="A grid to draw to; corners snap to it" style="--ico:${iconColor("grid")}">${iconSvg("grid", 18)}</button>${g.on ? `<input type="number" min="0.1" step="0.1" data-gstep value="${g.step}" title="Grid spacing, m"${can}><small>m</small><input type="number" step="0.5" data-gang value="${+(+g.ang).toFixed(2)}" title="Grid rotation, degrees"${can}><small>°</small><select data-galign title="Square the grid to a site edge"${can}><option value="">∥ edge …</option>${s.pts.map((p, i) => `<option value="${i}">${esc(edgeName(i))}</option>`).join("")}</select>` : ""}`;
}
function onViews(ev) {
  const t = (ev.target.closest && ev.target.closest("button,select,input")) || ev.target;   // an icon's drawing: its button
  if (t.dataset.v && ev.type === "click") return setView(t.dataset.v);
  if (t.dataset.elev != null && ev.type === "change") { ELEV = +t.value; return draw3d(); }
  if (t.dataset.cut != null && ev.type === "input") { CUT = +t.value; if (T3) T3.cut(CUT); return; }
  if (t.dataset.png != null && ev.type === "click") return png();
  if (t.dataset.keys != null && ev.type === "click") return PT.KS.openPage("massing");
  if (t.dataset.legend != null && ev.type === "click") return PT.toggleLegend(t, () => {
    const sw = (c, st = "#333", dash = "") => `<rect x="2" y="2" width="24" height="12" fill="${c}" stroke="${st}" stroke-width="0.8"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`, ln = (c, dash = "", w = 1.6) => `<line x1="2" y1="8" x2="26" y2="8" stroke="${c}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
    return ["Uses", ...Object.values(M.USES).map((u) => ({ svg: sw(u.color), label: u.label })),
      "On the plan and in 3D",
      { svg: sw("#e2ebdd", "#2e7d32"), label: "The site" },
      { svg: sw("none", "#1f6feb", "5 4"), label: "Floors with a plate of their own" },
      { svg: sw("#fbd9bb", "#f28022"), label: "The level being edited (its corners orange)" },
      { svg: sw("#dfe3e8", "#b8bec6"), label: "Neighbouring buildings" },
      { svg: sw("#2ea043", "#2ea043"), label: "Refuge floor due" },
      "Elevation and section",
      { svg: ln("#666666"), label: "Site level (mPD)" },
      { svg: ln("#9aa3ad", "3 2", 1), label: "Floor levels: ▽ +mPD and the floor" },
      { svg: ln("#8a6d3b"), label: "Top of the building" },
      { svg: ln("#cf222e", "4 3"), label: "Height limit (OZP)" }];
  });
  if (t.dataset.level != null && ev.type === "change") {
    if (!t.value) { SELG = null; return render(); }
    const [bid, gi] = [t.value.slice(0, t.value.lastIndexOf(":")), +t.value.slice(t.value.lastIndexOf(":") + 1)];
    pickLevel(bid, gi);
    C.hint(VIEW === "3d" ? "Drag this level's corners (orange) in 3D; click a + for a corner more." : "Drag this level's corners on the plan; add corners on its edges.", 5000);
    return;
  }
  if (t.dataset.match && ev.type === "click" && SELG) {
    const m = mass(), b = m.blocks.find((q) => q.id === SELG.b); if (!b) return;
    const g = b.groups[SELG.g], cp = (fp) => fp.map((q) => q.slice());
    if (t.dataset.match === "block") delete g.fp;
    else {
      // the nearest group below / above with a plate of its own; else the block's
      const step = t.dataset.match === "below" ? -1 : 1;
      let src = null; for (let k = SELG.g + step; k >= 0 && k < b.groups.length; k += step) if (b.groups[k].fp && b.groups[k].fp.length >= 3) { src = b.groups[k].fp; break; }
      if (!src && step < 0) src = b.fp;
      if (!src) return C.hint("No floors above with a plate of their own.", 3000);
      g.fp = cp(src);
    }
    return changed();
  }
  const g = mass().grid;
  if (t.dataset.grid != null && ev.type === "click") { g.on = !g.on; C.save(); viewsBar(); return drawPlan(); }
  if (t.dataset.gstep != null && ev.type === "change") { g.step = Math.max(0.1, parseFloat(t.value) || 3); C.save(); return drawPlan(); }
  if (t.dataset.gang != null && ev.type === "change") { g.ang = parseFloat(t.value) || 0; C.save(); return drawPlan(); }
  if (t.dataset.galign != null && ev.type === "change" && t.value !== "") {
    const s2 = C.study(), o = origin(), xy = S.toXY(s2.pts, o), i = +t.value, a = xy[i], b = xy[(i + 1) % xy.length];
    g.ang = +(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI).toFixed(2); g.ox = a[0]; g.oy = a[1];
    C.save(); viewsBar(); return drawPlan();
  }
  if (t.dataset.snap != null && ev.type === "click") { SNAP = !SNAP; setPref("snap", SNAP); return viewsBar(); }
  if (t.dataset.ctxr != null && ev.type === "change") { mass().ctxR = +t.value; C.save(); return draw3d(); }
  if (t.dataset.ctx3d != null && ev.type === "click") { CTX3D = !CTX3D; setPref("ctx3d", CTX3D); viewsBar(); if (T3) T3.context(CTX3D ? C.study() : null); return; }
  if (t.dataset.sun != null && ev.type === "click") { SUNS.on = !SUNS.on; if (!SUNS.on && SUNT) { clearInterval(SUNT); SUNT = null; } if (SUNS.on && !SHADOW) { SHADOW = true; if (T3) T3.shadow(true); } viewsBar(); applySun(); return; }
  if (t.dataset.sund != null && ev.type === "change") { SUNS.d = t.value; const [mo, dy] = SUNS.d.split("-").map(Number), dl = SUN.daylight(mo, dy); SUNS.h = Math.max(dl.rise || 6, Math.min(dl.set || 18, SUNS.h)); viewsBar(); applySun(); return; }
  if (t.dataset.sunh != null && ev.type === "input") { SUNS.h = +t.value; applySun(); return; }
  if (t.closest && t.closest("[data-sunplay]") && ev.type === "click") {
    if (SUNT) { clearInterval(SUNT); SUNT = null; return viewsBar(); }
    const [mo, dy] = SUNS.d.split("-").map(Number), dl = SUN.daylight(mo, dy);
    if (SUNS.h >= (dl.set || 18) - 0.3) SUNS.h = Math.ceil((dl.rise || 6) * 4) / 4;
    SUNT = setInterval(() => { SUNS.h = +(SUNS.h + 0.25).toFixed(2); if (SUNS.h > (dl.set || 18) || !SUNS.on || VIEW !== "3d") { clearInterval(SUNT); SUNT = null; viewsBar(); return; } const r = document.querySelector("[data-sunh]"); if (r) r.value = SUNS.h; applySun(); }, 250);
    viewsBar(); return;
  }
  if (t.dataset.shadow != null && ev.type === "click") { SHADOW = !SHADOW; setPref("shadow", SHADOW); viewsBar(); if (T3) T3.shadow(SHADOW); return; }
  if (t.dataset.tool && ev.type === "click") {
    if (TOOL && TOOL.kind === t.dataset.tool) return endTool();
    endTool();
    TOOL = t.dataset.tool === "measure" ? { kind: "measure" } : { kind: "context", pts: [] };
    $("#st-map").classList.add("st-drawing");
    C.hint(TOOL.kind === "measure" ? "Click two points: it snaps to the site's and the footprints' corners and edges (Alt: free). From a footprint edge to the boundary it gives the set-back. Esc to stop." : "Click the corners of the neighbouring building; double-click (or Enter) to finish.", 0);
    viewsBar();
  }
}
function setView(v) {
  VIEW = v;
  $("#st-3d").hidden = v === "plan";
  if (v !== "plan") endTool();
  viewsBar();
  if (v !== "plan") draw3d();
}
function endTool() {
  TOOL = null;
  if (rub) { rub.remove(); rub = null; }
  const m = $("#st-map"); if (m) m.classList.remove("st-drawing");
  if (C) C.hint("", 0);
  if (ON) { viewsBar(); drawPlan(); }
}

/* ---------- the panel (numbers only: fast, also while dragging) */
function render() { if (!ON) return; panel(); drawPlan(); if (VIEW !== "plan") draw3d(); viewsBar(); }
/* a level picked to edit: its own plate from now on (a copy of the block's when it has none) */
function pickLevel(bid, gi) {
  const b = mass().blocks.find((q) => q.id === bid), g = b && b.groups[gi]; if (!g) return;
  SEL = bid; SELG = { b: bid, g: gi };
  if (!g.fp && b.fp && b.fp.length >= 3) { g.fp = b.fp.map((q) => q.slice()); return changed(); }
  render();
}
function panel() {
  const s = C.study(), m = mass(), can = C.can(), dis = can ? "" : " disabled";
  const A = C.siteArea(), pot = C.potential();
  const f = M.figures(model(), A, s.plan && s.plan.level, m.uc6);
  const rows = M.against(f, pot);
  const bar = (r) => {
    if (r.value == null) return `<div class="ms-row"><span>${r.label}</span><b>–</b></div>`;
    const pct = r.limit ? Math.min(100, r.value / r.limit * 100) : 0;
    const fm = (x) => (r.unit === "m²" ? f0(x) : r.unit === "%" || r.unit === "mPD" ? f1(x) : String(x));
    return `<div class="ms-row ${r.status}"><span>${r.label}</span><b>${fm(r.value)}${r.unit ? ` <small>${r.unit}</small>` : ""}</b><em>${r.limit != null ? `/ ${fm(r.limit)} · ${esc(r.by)}${r.status === "over" ? " · over by " + fm(r.value - r.limit) : ""}` : "no limit given"}</em>${r.limit ? `<i><u style="width:${pct}%"></u></i>` : ""}</div>`;
  };
  const ref = f.buildings.map((b) => {
    const r = b.refuge, cls = r.need === "none" || r.ok ? "good" : "bad";
    return `<p class="ms-ref ${cls}"><b>${esc(b.top.name || "Building")}</b>: ${esc(r.why)}${r.due.length ? `. <b>Refuge floor needed at storey ${r.due.join(", ")}</b> (${r.due.map((n) => n - 1 + "/F").join(", ")}, G/F as storey 1)` : ""}${r.placed.length ? ` · placed at storey ${r.placed.join(", ")}` : ""}.</p>`;
  }).join("") || `<p class="muted st-note">Add a block to see the refuge floors.</p>`;
  const noSite = s.pts.length < 3;
  const capPct = f.gfa ? f.capConc / f.gfa * 100 : 0;
  $("#st-mpanel").innerHTML = `
    <section class="st-card">
      <div class="st-head"><b>Massing</b>${can ? `<span class="ms-undo"><button type="button" class="ghost st-ib" data-undo="-1" title="Undo (Ctrl+Z)"${HI > 0 ? "" : " disabled"}>↶ Undo</button><button type="button" class="ghost st-ib" data-undo="1" title="Redo (Ctrl+Y)"${HI < HIST.length - 1 ? "" : " disabled"}>↷</button></span>` : ""}<span class="muted" id="ms-saved">${can ? "Saved with the project" : "View only"}</span></div>
      ${noSite ? `<p class="st-need">Draw the site boundary first (1 · Site).</p>` : ""}
      <div class="ms-sum">${rows.map(bar).join("")}
        ${(() => { let fl = 0, sa = 0; for (const b of m.blocks) for (const g of b.groups || []) { const x = mixOf(g); fl += x.n * (Number(g.n) || 0); sa += x.sale * (Number(g.n) || 0); } return fl ? `<div class="ms-row"><span>Flats</span><b>${f0(fl)}</b><em>${f0(sa)} m² saleable · ${f1(sa / fl)} m² on average${f.dgfa ? ` · saleable ÷ domestic GFA ${f0(sa / f.dgfa * 100)}%` : ""}</em></div>` : ""; })()}
        <div class="ms-row"><span>Plot ratio</span><b>${f2(f.pr)}</b><em>domestic ${f2(f.dpr)} · non-domestic ${f2(f.npr)}</em></div>
        <div class="ms-row"><span>Height</span><b>${f1(f.height)} <small>m</small></b><em>${f.mpd == null ? "give the site level (Site, card 3) for mPD" : "from " + f1(Number(s.plan.level)) + " mPD"}</em></div>
        <div class="ms-row ${capPct > 10 ? "over" : ""}"><span>Concessions</span><b>${f0(f.capConc)} <small>m²</small></b><em>under the 10% cap: ${f1(capPct)}% of the GFA${capPct > 10 ? " – over 10%" : ""} · ${f0(f.conc - f.capConc)} m² more exempt (car park, plant, refuge, clubhouse ...)</em></div>
      </div>
    </section>
    <section class="st-card">
      <div class="st-head"><b>Refuge floors</b><label class="st-chk"><input type="checkbox" data-mf="uc6"${m.uc6 ? " checked" : ""}${dis}> Use Classification 6</label></div>
      ${ref}
      <p class="muted st-note">${esc(M.REFUGE.src)}: over ${M.REFUGE.over} storeys above the lowest ground storey - not over ${M.REFUGE.roofUpTo}, a refuge on the roof may do; otherwise refuge floors not more than ${M.REFUGE.every} storeys apart (${M.REFUGE.everyUc6} for UC 6). The refuge floor is not counted, plant storeys are; a transfer plate or an E&M zone that is not a storey is not.</p>
    </section>
    ${!noSite ? schemesCard(can) : ""}
    ${m.blocks.map((b, bi) => blockCard(b, bi, m, dis)).join("")}
    ${can && !noSite ? `<div class="st-row ms-add"><button type="button" class="primary" data-ma="podium">+ Podium</button><button type="button" class="ghost" data-ma="tower">+ Tower</button><button type="button" class="ghost" data-ma="example">Example: podium + tower</button></div>` : ""}
    ${m.context.length ? `<section class="st-card"><div class="st-head"><b>Surroundings</b><span class="muted">for the 3D view</span></div>
      <table class="ms-groups"><tbody>${m.context.map((c, i) => `<tr><td>${esc(c.name || "Building " + (i + 1))}</td><td>${f0(S.area(c.fp))} m²</td><td><input type="number" min="0" step="1" data-ctx="${i}" value="${esc(c.h)}"${dis}> m high</td><td>${can ? `<button type="button" class="ghost st-ib" data-ctxdel="${i}">×</button>` : ""}</td></tr>`).join("")}</tbody></table></section>` : ""}
    <section class="st-card">
      <div class="st-head"><b>Export</b></div>
      <div class="st-row"><button type="button" class="ghost" data-mx="obj"${m.blocks.length ? "" : " disabled"}>OBJ (3D)</button><button type="button" class="ghost" data-mx="png">PNG</button><button type="button" class="ghost" data-mx="gbp"${can && f.gfa ? "" : " disabled"}>Send GFA and height to GBP workbook</button></div>
    </section>`;
}

/* a massing's figures for the schemes' table */
function schemeFig(m0) {
  const s = C.study(), m = m0 || mass(), f = M.figures(model(m), C.siteArea(), s.plan && s.plan.level, m.uc6);
  let fl = 0, sa = 0; const by = {};
  for (const b of m.blocks || []) for (const g of b.groups || []) { const x = mixOf(g), k = Number(g.n) || 0; fl += x.n * k; sa += x.sale * k; for (const q of g.mix || []) by[q.u] = (by[q.u] || 0) + (Number(q.n) || 0) * k; }
  const r1 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
  const mix = fl ? Object.entries(by).sort((a, c) => c[1] - a[1]).map(([u, n]) => `${u.replace(/\s*\(.*$/, "")} ${Math.round(n / fl * 100)}%`).join(" · ") : "";
  return { gfa: f.gfa, dgfa: f.dgfa, ngfa: f.ngfa, pr: f.pr, sc: f.sc, height: f.height, mpd: f.mpd, storeys: f.storeys, flats: fl, mix, sale: r1(sa), avg: fl ? r1(sa / fl) : null, eff: f.dgfa ? r1(sa / f.dgfa * 100) : null, capPct: f.gfa ? r1(f.capConc / f.gfa * 100) : null };
}
function schemesCard(can) {
  const L = SCH.list(C.study());
  return `<section class="st-card ms-sch"><div class="st-head"><b>Schemes</b><span class="muted">options to compare</span></div>
    ${L.length ? `<table class="ms-groups"><tbody>${L.map((x) => `<tr><td><b>${esc(x.name)}</b><br><small class="muted">${esc(String(x.at || "").slice(0, 10))}${x.fig ? ` · GFA ${f0(x.fig.gfa)} m² · ${f0(x.fig.flats)} flats` : ""}</small></td><td class="ms-schb">${can ? `<button type="button" class="ghost st-ib" data-sch="open" data-sid="${x.id}" title="Make this scheme the massing you edit (the one now can be saved first)">Open</button><button type="button" class="ghost st-ib" data-sch="ren" data-sid="${x.id}" title="Rename">✎</button><button type="button" class="ghost st-ib" data-sch="dup" data-sid="${x.id}" title="Duplicate">⧉</button><button type="button" class="ghost st-ib" data-sch="del" data-sid="${x.id}" title="Delete">×</button>` : ""}</td></tr>`).join("")}</tbody></table>` : `<p class="muted st-note">Save the massing as Scheme A, change it, save it as Scheme B, then compare them side by side.</p>`}
    <div class="st-row">${can ? `<button type="button" class="primary" data-sch="save">Save as scheme</button>` : ""}<button type="button" class="ghost" data-sch="cmp"${L.length ? "" : " disabled"}>Compare</button></div></section>`;
}
function onScheme(d) {
  const s = C.study(), L = SCH.list(s), x = L.find((q) => q.id === d.sid);
  if (d.sch === "save") {
    const name = prompt("Name of this scheme", SCH.nextName(s)); if (name == null) return;
    let png = null; try { if (T3 && VIEW !== "plan") png = T3.thumb ? T3.thumb() : null; } catch (e) { png = null; }
    SCH.save(s, name.trim() || SCH.nextName(s), schemeFig(), png); C.save(); toast(`Saved as ${name.trim() || "a scheme"}`); return render();
  }
  if (d.sch === "cmp") {
    const cols = [{ name: "Now", current: true, fig: schemeFig() }, ...L.map((q) => ({ id: q.id, name: q.name, at: q.at, png: q.png, fig: schemeFig(q.massing) }))];
    return SCH.compare(cols, (id) => onScheme({ sch: "open", sid: id }));
  }
  if (!x) return;
  if (d.sch === "open") { if (!confirm(`Open ${x.name}? The massing you have now is replaced (Undo brings it back; save it as a scheme first to keep it).`)) return; SCH.open(s, x.id); SELG = null; SEL = null; changed(); toast(`${x.name} opened`); return; }
  if (d.sch === "ren") { const n = prompt("Rename the scheme", x.name); if (n && n.trim()) { x.name = n.trim(); C.save(); render(); } return; }
  if (d.sch === "dup") { SCH.duplicate(s, x.id); C.save(); return render(); }
  if (d.sch === "del") { if (!confirm(`Delete ${x.name}?`)) return; SCH.remove(s, x.id); C.save(); return render(); }
}

/* the units on these floors (domestic): from 3 · Units, so many a floor */
function unitList() { const s = C.study(); return (s.units && Array.isArray(s.units.list)) ? s.units.list : []; }
function mixOf(g) {
  const list = unitList(), out = { n: 0, sale: 0, gfa: 0 };
  for (const x of g.mix || []) { const u = list.find((q) => q.name === x.u); if (!u) continue; const f = UC.figures(u), k = Number(x.n) || 0; out.n += k; out.sale += k * f.saleable; out.gfa += k * f.gfa; }
  return out;
}
function mixRow(g, bi, gi, ga, dis) {
  if (g.use !== "dom" || !unitList().length) return "";
  const list = unitList(), mx = mixOf(g), n = Number(g.n) || 0;
  const items = (g.mix || []).map((x, mi) => `<span class="ms-mix"><select data-gmu="${bi}.${gi}.${mi}"${dis}>${list.map((u) => `<option${u.name === x.u ? " selected" : ""}>${esc(u.name)}</option>`).join("")}</select>×<input type="number" min="0" step="1" data-gmn="${bi}.${gi}.${mi}" value="${esc(x.n)}"${dis}>${dis ? "" : `<button type="button" class="ghost st-ib" data-gmdel="${bi}.${gi}.${mi}">×</button>`}</span>`).join("");
  const fill = ga ? mx.gfa / ga : 0;
  return `<tr class="ms-part"><td colspan="8">Units / floor: ${items}${dis ? "" : `<button type="button" class="ghost st-ib" data-gmadd="${bi}.${gi}">+ unit</button>`}
    ${mx.n ? `<small> = ${mx.n * n} flats · ${f1(mx.sale / mx.n)} m² saleable on average · units ${f0(mx.gfa)} of ${f0(ga)} m² a floor (${f0(fill * 100)}%)${fill > 1 ? " – more than the floor" : ""}</small>` : ""}</td></tr>`;
}
/* the uses sharing these floors: each its share of the plate */
function partRows(g, bi, gi, ga, dis, useOpt) {
  if (!Array.isArray(g.parts) || g.parts.length < 2) return "";
  const tot = g.parts.reduce((x, q) => x + (Number(q.share) || 0), 0) || 1;
  return g.parts.map((q, pi) => { const u = M.USES[q.use] || M.USES.dom; return `<tr class="ms-part" style="--c:${u.color}">
    <td>↳ <select data-gp="${bi}.${gi}.${pi}.use"${dis}>${useOpt(q.use)}</select></td>
    <td colspan="2"><input type="number" min="0" max="100" step="1" data-gp="${bi}.${gi}.${pi}.share" value="${esc(q.share)}"${dis}>% <small>${f0(ga * (Number(q.share) || 0) / tot)} m²</small></td>
    <td><input type="number" min="0" max="100" step="1" data-gp="${bi}.${gi}.${pi}.acc" value="${esc(q.acc == null ? "" : q.acc)}" placeholder="${u.acc}"${dis}></td>
    <td colspan="3"></td>
    <td class="nw">${dis ? "" : `<button type="button" class="ghost st-ib" data-gpdel="${bi}.${gi}.${pi}" title="Remove this use">×</button>${pi === g.parts.length - 1 ? `<button type="button" class="ghost st-ib" data-gpadd="${bi}.${gi}" title="Another use">+</button>` : ""}`}</td></tr>`; }).join("");
}
function blockCard(b, bi, m, dis) {
  const a = b.fp && b.fp.length >= 3 ? S.area(b.fp) : 0;
  const others = m.blocks.filter((x) => x.id !== b.id);
  const useOpt = (cur) => Object.entries(M.USES).map(([k, u]) => `<option value="${k}"${k === cur ? " selected" : ""}>${u.label}</option>`).join("");
  const isSt = (g) => (g.storey == null ? (M.USES[g.use] || M.USES.dom).storey !== false : !!g.storey);
  const n = (b.groups || []).reduce((s2, g) => s2 + (isSt(g) ? Number(g.n) || 0 : 0), 0);
  const h = (b.groups || []).reduce((s2, g) => s2 + (Number(g.n) || 0) * (Number(g.h) || 0), 0);
  const gr = (b.groups || []).map((g, gi) => {
    const u = M.USES[g.use] || M.USES.dom, acc = g.acc == null || g.acc === "" ? u.acc : Math.max(0, Math.min(100, Number(g.acc)));
    const ga = g.fp && g.fp.length >= 3 ? S.area(g.fp) : a;
    const conc = ga * (1 - acc / 100) + (Number(g.extra) || 0);
    return `<tr style="--c:${u.color}">
      <td><i class="ms-sw"></i><select data-g="${bi}.${gi}.use"${dis}>${useOpt(g.use)}</select></td>
      <td><input type="number" min="0" step="1" data-g="${bi}.${gi}.n" value="${esc(g.n)}"${dis}></td>
      <td><input type="number" min="0" step="0.05" data-g="${bi}.${gi}.h" value="${esc(g.h)}"${dis}></td>
      <td><input type="number" min="0" max="100" step="0.1" data-g="${bi}.${gi}.acc" value="${esc(g.acc == null ? "" : g.acc)}" placeholder="${u.acc}"${dis}${g.accFrom === "floors" ? ' title="From 4 · Floors: the typical floor\'s GFA ÷ its plate (untick Follow 4 · Floors there to type it)" class="ms-fromfl"' : ""}></td>
      <td class="num" title="Floor area not counted as GFA (+ the extra)">${f0(conc)}</td>
      <td><input type="number" min="0" step="1" data-g="${bi}.${gi}.extra" value="${esc(g.extra == null ? "" : g.extra)}" placeholder="0" title="Extra concession per floor outside the footprint (balconies, utility platforms)"${dis}></td>
      <td><input type="checkbox" data-gs="${bi}.${gi}"${isSt(g) ? " checked" : ""} title="Counts as a storey"${dis}></td>
      <td class="nw">${dis ? "" : `<button type="button" class="ghost st-ib${g.parts && g.parts.length > 1 ? " on" : ""}" data-gsplit="${bi}.${gi}" title="Split these floors between more than one use">⫽</button><button type="button" class="ghost st-ib${g.fp ? " on" : ""}${SELG && SELG.b === b.id && SELG.g === gi ? " ed" : ""}" data-gfp="${bi}.${gi}" title="${g.fp ? "Its own floor plate (click to edit it on the plan; right-click: back to the block's)" : "Give these floors their own floor plate"}">▱</button><button type="button" class="ghost st-ib" data-gup="${bi}.${gi}" title="Move down">↓</button><button type="button" class="ghost st-ib" data-gdel="${bi}.${gi}" title="Remove">×</button>`}</td></tr>${partRows(g, bi, gi, ga, dis, useOpt)}${mixRow(g, bi, gi, ga, dis)}`;
  }).join("");
  const s = C.study(), sel = SEL === b.id;
  const edgeOpts = s.pts.map((p, i) => `<option value="${i}"${+b.align === i ? " selected" : ""}>${esc(edgeName(i))}</option>`).join("");
  return `<section class="st-card ms-block${sel ? " sel" : ""}" data-bid="${b.id}">
    <div class="st-head"><input class="ms-name" data-b="${bi}.name" value="${esc(b.name || "")}"${dis}><span class="muted" data-barea="${b.id}">${f0(a)} m² · ${n} storeys · ${f1(h)} m</span></div>
    <div class="ms-fp"><label>On <select data-b="${bi}.on"${dis}><option value="">the ground</option>${others.map((x) => `<option value="${x.id}"${b.on === x.id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label></div>
    ${dis ? "" : `<details class="ms-tools"${b.toolsOpen ? " open" : ""} data-topen="${bi}"><summary>Shape the footprint</summary>
      <div class="ms-trow"><b>Fill the site</b> set back <input type="number" min="0" step="0.5" data-fpset="${bi}" value="${esc(b.setback == null ? 3 : b.setback)}"> m from every site edge <button type="button" class="ghost st-ib" data-fp="${bi}.site">Apply</button>
        <small>then click a site edge on the plan to give that edge its own set-back</small></div>
      <div class="ms-trow"><b>Rectangle</b> <input type="number" min="1" step="0.5" data-fpw="${bi}" value="${esc(b.w || 30)}"> × <input type="number" min="1" step="0.5" data-fpd="${bi}" value="${esc(b.d || 20)}"> m, long side parallel to <select data-fpal="${bi}">${edgeOpts}</select> <button type="button" class="ghost st-ib" data-fp="${bi}.rect">Apply</button>
        <small>placed in the middle of the block below (or of the site); then drag it</small></div>
      <div class="ms-trow"><b>Grow / shrink</b> by <input type="number" step="0.5" data-fpoff="${bi}" value="${esc(b.off == null ? 1 : b.off)}"> m <button type="button" class="ghost st-ib" data-fp="${bi}.grow">Apply</button>
        <small>every edge moves out the distance; a minus figure moves them in</small></div>
    </details>`}
    ${b.edges ? `<p class="muted st-note">Set-backs: ${b.edges.map((d, i) => `E${i + 1} ${f1(d)} m`).join(" · ")}</p>` : ""}
    <table class="ms-groups"><thead><tr><th>Use</th><th>No.</th><th>Ht m</th><th title="The share of the floor area counted as GFA">GFA %</th><th title="Concession per floor: area × (1 − GFA %) + extra">Conc.</th><th title="Extra concession per floor (outside the footprint)">+Extra</th><th title="Counts as a storey">St.</th><th></th></tr></thead><tbody>${gr}</tbody></table>
    ${dis ? "" : `<div class="st-row"><button type="button" class="ghost st-ib" data-gadd="${bi}">+ Floors above</button><button type="button" class="ghost st-ib" data-gtr="${bi}">+ Transfer plate</button><button type="button" class="ghost st-ib" data-bdup="${bi}">Duplicate</button><button type="button" class="ghost st-ib" data-bdel="${bi}">Remove</button></div>`}
  </section>`;
}

/* undo / redo: the massing as it was after each change */
let HIST = [], HI = -1;
function snapHist() {
  const j = JSON.stringify(mass());
  if (HIST[HI] === j) return;
  HIST = HIST.slice(0, HI + 1); HIST.push(j);
  if (HIST.length > 80) HIST.shift();
  HI = HIST.length - 1;
}
function undo(step) {
  if (!HIST.length) return;
  const k = HI + step;
  if (k < 0 || k >= HIST.length) return toast(step < 0 ? "Nothing to undo" : "Nothing to redo");
  HI = k; C.study().massing = JSON.parse(HIST[HI]); SELG = null;
  C.save(); render();
}
function changed() { snapHist(); C.save(); render(); }

function onChange(ev) {
  const t = ev.target, m = mass();
  if (t.dataset.mf === "uc6") { m.uc6 = t.checked; return changed(); }
  if (t.dataset.b) { const [bi, k] = t.dataset.b.split("."); m.blocks[+bi][k] = t.value; return changed(); }
  if (t.dataset.gmu || t.dataset.gmn) {
    const [bi, gi, mi] = (t.dataset.gmu || t.dataset.gmn).split(".").map(Number), x = m.blocks[bi].groups[gi].mix[mi];
    if (t.dataset.gmu) x.u = t.value; else x.n = Math.max(0, parseInt(t.value) || 0);
    return changed();
  }
  if (t.dataset.gp) {
    const [bi, gi, pi, k] = t.dataset.gp.split("."), q = m.blocks[+bi].groups[+gi].parts[+pi];
    q[k] = k === "use" ? t.value : t.value === "" ? null : Math.max(0, parseFloat(t.value));
    if (k === "use") q.acc = null;
    if (+pi === 0 && k === "use") m.blocks[+bi].groups[+gi].use = t.value;
    return changed();
  }
  if (t.dataset.gs) { const [bi, gi] = t.dataset.gs.split(".").map(Number); m.blocks[bi].groups[gi].storey = t.checked; return changed(); }
  if (t.dataset.g) {
    const [bi, gi, k] = t.dataset.g.split("."), g = m.blocks[+bi].groups[+gi];
    g[k] = k === "use" ? t.value : t.value === "" ? (k === "acc" || k === "extra" ? null : 0) : Math.max(0, parseFloat(t.value));
    if (k === "use") { g.acc = null; g.storey = null; }
    if (k === "acc") { delete g.accFrom; if (g.floor) g.floor.follow = false; }   // typed here: no longer from 4 · Floors
    return changed();
  }
  if (t.dataset.topen != null) return;
  if (t.dataset.ctx != null) { m.context[+t.dataset.ctx].h = Math.max(0, parseFloat(t.value) || 0); return changed(); }
  const num = (v, d) => (isNaN(parseFloat(v)) ? d : parseFloat(v));
  if (t.dataset.fpset != null) { const b = m.blocks[+t.dataset.fpset]; b.setback = Math.max(0, num(t.value, 3)); b.edges = null; C.save(); }
  if (t.dataset.fpw != null) { m.blocks[+t.dataset.fpw].w = Math.max(1, num(t.value, 30)); C.save(); }
  if (t.dataset.fpd != null) { m.blocks[+t.dataset.fpd].d = Math.max(1, num(t.value, 20)); C.save(); }
  if (t.dataset.fpal != null) { m.blocks[+t.dataset.fpal].align = +t.value; C.save(); }
  if (t.dataset.fpoff != null) { m.blocks[+t.dataset.fpoff].off = num(t.value, 1); C.save(); }
}

/* the footprints: from the site (a set-back for each edge), a rectangle squared to a site edge, or grown/shrunk */
function footprint(kind, b) {
  const s = C.study(), o = origin();
  if (!o) return;
  const sxy = S.toXY(s.pts, o);
  if (kind === "site") {
    b.fromSite = true;
    const d = b.edges && b.edges.length === sxy.length ? b.edges : sxy.map(() => (b.setback == null ? 3 : b.setback));
    b.fp = S.fromXY(M.inset(sxy, d), o);
  } else if (kind === "rect") {
    b.fromSite = false;
    const base = b.on ? mass().blocks.find((x) => x.id === b.on) : null;
    const c = base && base.fp && base.fp.length >= 3 ? S.toXY([S.centroid(base.fp)], o)[0] : [0, 0];
    const e = Math.min(sxy.length - 1, +b.align || 0), p = sxy[e], q = sxy[(e + 1) % sxy.length];
    const t = Math.atan2(q[1] - p[1], q[0] - p[0]), w = b.w || 30, d = b.d || 20;
    const r = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, y]) => [c[0] + x * Math.cos(t) - y * Math.sin(t), c[1] + x * Math.sin(t) + y * Math.cos(t)]);
    b.fp = S.fromXY(r, o);
  } else if (kind === "grow" && b.fp && b.fp.length >= 3) {
    b.fp = S.fromXY(M.grow(S.toXY(b.fp, o), Number(b.off) || 0), o);
    b.fromSite = false;
  }
}

function onClick(ev) {
  const t = ev.target.closest("button") || ev.target, m = mass(), d = t.dataset || {};
  const card = ev.target.closest(".ms-block");
  if (card && SEL !== card.dataset.bid && !ev.target.closest("button,input,select")) { SEL = card.dataset.bid; SELG = null; render(); return; }
  if (d.undo) return undo(+d.undo);
  if (d.sch) return onScheme(d);
  if (d.ma) {
    if (d.ma === "example") {
      const p = { id: uid(), name: "Podium", setback: 3, groups: [{ use: "lobby", n: 1, h: 6 }, { use: "car", n: 2, h: 4.5 }, { use: "club", n: 1, h: 5 }, { use: "transfer", n: 1, h: 2.5 }] };
      footprint("site", p);
      const t2 = { id: uid(), name: "Tower 1", on: p.id, w: 35, d: 22, align: 0, groups: [{ use: "dom", n: 21, h: 3.15, acc: 92, extra: 20 }, { use: "refuge", n: 1, h: 4.5 }, { use: "dom", n: 18, h: 3.15, acc: 92, extra: 20 }] };
      footprint("rect", t2);
      m.blocks.push(p, t2); SEL = t2.id;
    } else {
      const pod = d.ma === "podium";
      const base = pod ? null : m.blocks.find((x) => !x.on);
      const b = pod ? { id: uid(), name: "Podium " + (m.blocks.filter((x) => !x.on).length + 1), setback: 3, groups: [{ use: "lobby", n: 1, h: 6 }, { use: "non", n: 2, h: 5 }] }
        : { id: uid(), name: "Tower " + (m.blocks.filter((x) => x.on).length + 1), on: base ? base.id : "", w: 30, d: 20, align: 0, groups: [{ use: "dom", n: 20, h: 3.15, acc: 90 }] };
      footprint(pod ? "site" : "rect", b);
      m.blocks.push(b); SEL = b.id;
    }
    return changed();
  }
  if (d.fp) { const [bi, k] = d.fp.split("."); footprint(k, m.blocks[+bi]); SEL = m.blocks[+bi].id; return changed(); }
  if (d.gadd != null) { const b = m.blocks[+d.gadd], last = (b.groups || []).slice(-1)[0]; (b.groups = b.groups || []).push(last ? Object.assign({}, last) : { use: "dom", n: 1, h: 3.15 }); return changed(); }
  if (d.gfp) {
    const [bi, gi] = d.gfp.split(".").map(Number), b = m.blocks[bi], g = b.groups[gi];
    if (!g.fp) g.fp = b.fp.map((q) => q.slice());
    SEL = b.id; SELG = SELG && SELG.b === b.id && SELG.g === gi ? null : { b: b.id, g: gi };
    if (SELG) C.hint(`Editing the floor plate of ${b.name}'s floors ${gi + 1}: drag its corners, add corners on its edges. Click ▱ again to go back to the block.`, 6000);
    return changed();
  }
  if (d.gsplit) {
    const [bi, gi] = d.gsplit.split(".").map(Number), g = m.blocks[bi].groups[gi];
    if (g.parts && g.parts.length > 1) { if (!confirm("One use for these floors again?")) return; delete g.parts; }
    else g.parts = [{ use: g.use, share: 60, acc: g.acc }, { use: g.use === "retail" ? "lobby" : "retail", share: 40 }];
    return changed();
  }
  if (d.gmadd) { const [bi, gi] = d.gmadd.split(".").map(Number), g = m.blocks[bi].groups[gi], l = unitList(); (g.mix = g.mix || []).push({ u: l[0].name, n: 4 }); return changed(); }
  if (d.gmdel) { const [bi, gi, mi] = d.gmdel.split(".").map(Number); m.blocks[bi].groups[gi].mix.splice(mi, 1); return changed(); }
  if (d.gpadd) { const [bi, gi] = d.gpadd.split(".").map(Number); m.blocks[bi].groups[gi].parts.push({ use: "em", share: 10 }); return changed(); }
  if (d.gpdel) {
    const [bi, gi, pi] = d.gpdel.split(".").map(Number), g = m.blocks[bi].groups[gi];
    g.parts.splice(pi, 1); if (g.parts.length < 2) { g.use = g.parts[0] ? g.parts[0].use : g.use; delete g.parts; } else g.use = g.parts[0].use;
    return changed();
  }
  if (d.gtr != null) { const b = m.blocks[+d.gtr]; (b.groups = b.groups || []).push({ use: "transfer", n: 1, h: 2.5 }); return changed(); }
  if (d.gdel) { const [bi, gi] = d.gdel.split(".").map(Number); m.blocks[bi].groups.splice(gi, 1); return changed(); }
  if (d.gup) { const [bi, gi] = d.gup.split(".").map(Number), g = m.blocks[bi].groups; if (gi > 0) [g[gi - 1], g[gi]] = [g[gi], g[gi - 1]]; return changed(); }
  if (d.bdup != null) { const b = JSON.parse(JSON.stringify(m.blocks[+d.bdup])); b.id = uid(); b.name += " (copy)"; const o = origin(); if (o) b.fp = S.fromXY(S.toXY(b.fp, o).map(([x, y]) => [x + 10, y - 10]), o); m.blocks.push(b); SEL = b.id; return changed(); }
  if (d.bdel != null) {
    const b = m.blocks[+d.bdel];
    if (!confirm(`Remove ${b.name || "this block"}?`)) return;
    for (const x of m.blocks) if (x.on === b.id) x.on = b.on || "";
    m.blocks.splice(+d.bdel, 1); return changed();
  }
  if (d.ctxdel != null) { m.context.splice(+d.ctxdel, 1); return changed(); }
  if (d.mx === "obj") return download(M.toObj(model(), C.study().plan && C.study().plan.level), "massing.obj", "text/plain");
  if (d.mx === "png") return png();
  if (d.mx === "gbp") {
    const s = C.study(), f = M.figures(model(), C.siteArea(), s.plan && s.plan.level, m.uc6);
    C.sendToWorkbook({ gfaTotal: +f.gfa.toFixed(3), height: +f.height.toFixed(3) });
    toast(`Sent: total GFA ${f0(f.gfa)} m², height ${f1(f.height)} m`);
  }
}
function png() {
  if (VIEW === "plan") setView("3d");
  setTimeout(() => { if (T3) { const a = document.createElement("a"); a.href = T3.png(); a.download = "massing-" + VIEW + ".png"; a.click(); } }, 500);
}
function download(text, name, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- the plan: footprints, their corners and set-backs, measure, context */
function drawPlan() {
  const L = C.L, m = mass(), can = C.can() && !TOOL, s = C.study(), o = origin();
  layer.clearLayers();
  drawGrid(L, m, s, o);
  s.pts.forEach((p, i) => {
    const q = s.pts[(i + 1) % s.pts.length];
    L.marker([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], { interactive: false, icon: L.divIcon({ className: "ms-eno", html: `<span>E${i + 1}</span>`, iconSize: [0, 0] }) }).addTo(layer);
  });
  for (const c of m.context) L.polygon(c.fp, { color: "#8d949c", weight: 1, fillColor: "#c3c8ce", fillOpacity: 0.5, interactive: false }).addTo(layer);
  for (const b of m.blocks) {
    if (!b.fp || b.fp.length < 3) continue;
    const top = (b.groups || []).filter((g) => g.use !== "transfer").slice(-1)[0], col = (M.USES[(top && top.use) || "dom"] || M.USES.dom).color;
    const sel = SEL === b.id;
    const pg = L.polygon(b.fp, { color: sel ? "#d1660e" : "#7a6a55", weight: sel ? 2.5 : 1, fillColor: col, fillOpacity: b.on ? 0.85 : 0.6 }).addTo(layer);
    pg.on("click", () => { if (TOOL) return; SEL = b.id; render(); });
    if (can) pg.on("contextmenu", (ev) => {
      L.DomEvent.stop(ev); SEL = b.id; render();
      const bi = m.blocks.indexOf(b);
      PT.ctx(ev.originalEvent, [
        { label: "Copy", key: "Ctrl+C", action: () => PT.clip.set("block", b) },
        { label: "Paste here", key: "Ctrl+V", disabled: !PT.clip.get("block"), action: () => pasteBlock([ev.latlng.lat, ev.latlng.lng]) },
        { label: "Duplicate", action: () => { const c = JSON.parse(JSON.stringify(b)); c.id = uid(); c.name += " (copy)"; const o2 = origin(); if (o2) c.fp = S.fromXY(S.toXY(c.fp, o2).map(([x, y]) => [x + 10, y - 10]), o2); m.blocks.push(c); SEL = c.id; changed(); } },
        "-", { label: "Delete the block", danger: true, action: () => { m.blocks.splice(bi, 1); SEL = null; changed(); } },
      ]);
    });
    // floors with their own plate (from 4 · Floors, or set here): dashed over the block, so the change shows
    for (const [gi2, g2] of (b.groups || []).entries()) if (g2.fp && g2.fp.length >= 3 && !(SELG && SELG.b === b.id && SELG.g === gi2)) L.polygon(g2.fp, { color: "#1f6feb", weight: 1.8, dashArray: "5 4", fill: false, interactive: false }).bindTooltip(`${esc(b.name)}: ${g2.n} × ${esc((M.USES[g2.use] || {}).label || g2.use)} - their own plate, ${f0(S.area(g2.fp))} m²${g2.accFrom === "floors" ? " (from 4 · Floors)" : ""}`, { sticky: true }).addTo(layer);
    if (!sel) { pg.bindTooltip(`${esc(b.name)} · ${f0(S.area(b.fp))} m²`, { direction: "center", className: "st-edge-lab" }); continue; }
    const G = SELG && SELG.b === b.id ? (b.groups || [])[SELG.g] : null, T = G && G.fp ? G : b;
    if (T !== b) L.polygon(T.fp, { color: "#1f6feb", weight: 2.5, dashArray: "6 4", fillOpacity: 0.15, fillColor: "#1f6feb" }).addTo(layer);
    // its edges: length and set-back from the boundary
    const lab = L.layerGroup().addTo(layer);
    const labels = () => {
      lab.clearLayers();
      if (!o) return;
      const xy = S.toXY(T.fp, o), sb = M.setbacks(xy, S.toXY(s.pts, o)), lens = S.edges(T.fp);
      T.fp.forEach((p, i) => {
        const q = T.fp[(i + 1) % T.fp.length];
        L.marker([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], { interactive: false, icon: L.divIcon({ className: "ms-elab", html: `<span>${f1(lens[i])} m${sb[i] != null ? ` · <b>${f1(sb[i])} m</b> to boundary` : ""}</span>`, iconSize: [0, 0] }) }).addTo(lab);
      });
    };
    labels();
    if (!can) continue;
    const tp = T === b ? pg : null; const live = () => { if (tp) tp.setLatLngs(T.fp); labels(); panel(); };
    T.fp.forEach((p, i) => {
      const mk = L.marker(p, { draggable: true, icon: L.divIcon({ className: "st-vx ms-vx", iconSize: [12, 12] }), title: "Drag; right-click to remove" }).addTo(layer);
      mk.on("drag", (ev) => { const ll = ev.target.getLatLng(); const sn = SNAP && !(ev.originalEvent && ev.originalEvent.altKey) ? snapLL([ll.lat, ll.lng], T.fp, i) : null; if (sn) ev.target.setLatLng(sn); T.fp[i] = sn || [ll.lat, ll.lng]; if (T === b) b.fromSite = false; live(); });
      mk.on("dragend", () => changed());
      mk.on("contextmenu", (ev) => { L.DomEvent.stop(ev); PT.ctx(ev.originalEvent, [{ label: "Remove the corner", danger: true, disabled: T.fp.length <= 3, action: () => { T.fp.splice(i, 1); changed(); } }, { label: "Add a corner after it", action: () => { const q = T.fp[(i + 1) % T.fp.length]; T.fp.splice(i + 1, 0, [(T.fp[i][0] + q[0]) / 2, (T.fp[i][1] + q[1]) / 2]); changed(); } }]); });
    });
    T.fp.forEach((p, i) => {
      const q = T.fp[(i + 1) % T.fp.length];
      const mk = L.marker([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], { icon: L.divIcon({ className: "st-mid", iconSize: [10, 10] }), title: "Click to add a corner" }).addTo(layer);
      mk.on("click", (ev) => { L.DomEvent.stop(ev); T.fp.splice(i + 1, 0, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]); changed(); });
    });
    const c = S.centroid(T.fp);
    const mv = L.marker(c, { draggable: true, icon: L.divIcon({ className: "ms-move", html: "✥", iconSize: [22, 22] }), title: "Drag to move the block" }).addTo(layer);
    let from = null, orig = null;
    mv.on("dragstart", () => { from = c; orig = T.fp.map((q) => q.slice()); });
    mv.on("drag", (ev) => { const ll = ev.target.getLatLng(), dl = ll.lat - from[0], dg = ll.lng - from[1]; T.fp = orig.map(([a, g]) => [a + dl, g + dg]); if (T === b) b.fromSite = false; live(); });
    mv.on("dragend", () => changed());
    // a footprint from the site: click a site edge for its own set-back
    if (b.fromSite && o && T === b) {
      const n = s.pts.length;
      s.pts.forEach((p, i) => {
        const q = s.pts[(i + 1) % n], dv = b.edges && b.edges.length === n ? b.edges[i] : b.setback == null ? 3 : b.setback;
        const ln = L.polyline([p, q], { color: "#d1660e", weight: 10, opacity: 0.01 }).addTo(layer);
        ln.bindTooltip(`set-back ${f1(dv)} m · click to change`, { sticky: true });
        ln.on("click", (ev) => {
          L.DomEvent.stop(ev);
          const v = prompt(`Set-back of ${b.name} from edge ${i + 1}–${(i + 1) % n + 1} (m)`, String(dv));
          if (v == null || isNaN(parseFloat(v))) return;
          b.edges = b.edges && b.edges.length === n ? b.edges : s.pts.map(() => (b.setback == null ? 3 : b.setback));
          b.edges[i] = Math.max(0, parseFloat(v));
          footprint("site", b); changed();
        });
      });
    }
  }
  // the measures
  for (const ms of MEAS) {
    L.polyline([ms.a, ms.b], { color: "#1f6feb", weight: 2, interactive: false }).addTo(layer)
      .bindTooltip(`${f2(ms.len)} m`, { permanent: true, direction: "center", className: "st-edge-lab st-ms" });
  }
  if (TOOL && TOOL.kind === "context" && TOOL.pts.length) L.polyline(TOOL.pts, { color: "#5b6168", dashArray: "4 4", interactive: false }).addTo(layer);
}

/* the grid in local metres: lines every step along and across the angle, through (ox, oy) */
function gridXY() {
  const m = mass(), g = m.grid, s = C.study(), o = origin();
  if (!g.on || !o) return null;
  const t = (Number(g.ang) || 0) * Math.PI / 180, ox = Number(g.ox) || 0, oy = Number(g.oy) || 0;
  return { o, t, ox, oy, st: Math.max(0.1, Number(g.step) || 3),
    toG: ([x, y]) => { const dx = x - ox, dy = y - oy; return [dx * Math.cos(t) + dy * Math.sin(t), -dx * Math.sin(t) + dy * Math.cos(t)]; },
    fromG: ([u, v]) => [ox + u * Math.cos(t) - v * Math.sin(t), oy + u * Math.sin(t) + v * Math.cos(t)], R: Math.max(80, ...S.toXY(s.pts, o).map((p) => Math.hypot(p[0], p[1]))) * 1.6 };
}
function drawGrid(L, m, s, o) {
  const G = gridXY(); if (!G) return;
  const lim = G.R + Math.hypot(G.ox, G.oy), n = Math.min(400, Math.ceil(lim / G.st));
  const every = n > 150 ? Math.ceil(n / 150) : 1;
  for (let k = -n; k <= n; k += every) {
    const major = k % (5 * every) === 0, sty = { color: major ? "#5b6470" : "#8794a3", weight: major ? 0.9 : 0.5, opacity: major ? 0.55 : 0.35, interactive: false };
    L.polyline(S.fromXY([G.fromG([k * G.st, -lim]), G.fromG([k * G.st, lim])], o), sty).addTo(layer);
    L.polyline(S.fromXY([G.fromG([-lim, k * G.st]), G.fromG([lim, k * G.st])], o), sty).addTo(layer);
  }
}
/* the nearest grid point to ll, if within 10 px */
function snapGrid(ll) {
  const G = gridXY(); if (!G) return null;
  const [u, v] = G.toG(S.toXY([ll], G.o)[0]);
  const q = S.fromXY([G.fromG([Math.round(u / G.st) * G.st, Math.round(v / G.st) * G.st])], G.o)[0];
  const map = C.map();
  return map.latLngToContainerPoint(q).distanceTo(map.latLngToContainerPoint(ll)) < 10 ? q : null;
}
function snapPts() {
  const s = C.study(), m = mass(), polys = [s.pts, ...m.blocks.flatMap((b) => [b.fp || [], ...(b.groups || []).map((g) => g.fp || [])]), ...m.context.map((c) => c.fp)];
  return polys.filter((p) => p && p.length >= 2);
}
function snap(ev) {
  const ll = [ev.latlng.lat, ev.latlng.lng];
  if (ev.originalEvent && ev.originalEvent.altKey) return ll;
  const map = C.map(), P = (q) => map.latLngToContainerPoint(q), c = P(ll);
  let best = null, bd = 12;
  for (const poly of snapPts()) for (const q of poly) { const d = P(q).distanceTo(c); if (d < bd) { bd = d; best = q.slice(); } }
  if (best) return best;
  bd = 8;
  for (const poly of snapPts()) poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length], pa = P(a), pb = P(b);
    const dx = pb.x - pa.x, dy = pb.y - pa.y, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((c.x - pa.x) * dx + (c.y - pa.y) * dy) / L2));
    const d = Math.hypot(c.x - pa.x - dx * t, c.y - pa.y - dy * t);
    if (d < bd) { bd = d; best = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  });
  return best || snapGrid(ll) || ll;
}
/* snap a dragged corner to the corners and edges of the site, the other
   footprints and plates, and the neighbours (not to its own polygon) */
function snapLL(ll, own, idx) {
  const map = C.map(), P = (q) => map.latLngToContainerPoint(q), c = P(ll);
  const polys = snapPts().filter((p) => p !== own);
  if (own) polys.push(own.filter((_, j) => j !== idx));
  let best = null, bd = 10;
  for (const poly of polys) for (const q of poly) { const d = P(q).distanceTo(c); if (d < bd) { bd = d; best = q.slice(); } }
  if (best) return best;
  bd = 7;
  for (const poly of polys.filter((p) => p !== own)) poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length], pa = P(a), pb = P(b);
    const dx = pb.x - pa.x, dy = pb.y - pa.y, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((c.x - pa.x) * dx + (c.y - pa.y) * dy) / L2));
    const d = Math.hypot(c.x - pa.x - dx * t, c.y - pa.y - dy * t);
    if (d < bd) { bd = d; best = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  });
  return best || snapGrid(ll);
}
function toolClick(ev) {
  const p = snap(ev);
  if (TOOL.kind === "measure") {
    if (!TOOL.a) { TOOL.a = p; return; }
    MEAS.push({ a: TOOL.a, b: p, len: S.distance(TOOL.a, p) });
    TOOL.a = null; if (rub) { rub.remove(); rub = null; }
    C.hint(`${f2(MEAS[MEAS.length - 1].len)} m. Click to measure another; Esc to stop.`, 0);
    drawPlan(); return;
  }
  TOOL.pts.push(p); drawPlan();
}
function rubber(ev) {
  const p = snap(ev);
  if (rub) rub.remove();
  rub = C.L.polyline([TOOL.a, p], { color: "#1f6feb", weight: 2, dashArray: "4 4", interactive: false }).addTo(C.map());
  rub.bindTooltip(`${f2(S.distance(TOOL.a, p))} m`, { permanent: true, direction: "center", className: "st-edge-lab st-ms" }).openTooltip();
}
function finishContext() {
  const pts = TOOL.pts.filter((p, i, a) => !i || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-7);
  if (pts.length < 3) { endTool(); return; }
  const h = parseFloat(prompt("Height of this neighbouring building (m above the ground)", "60"));
  mass().context.push({ fp: pts, h: isNaN(h) ? 30 : Math.max(0, h) });
  endTool(); changed();
}

/* ---------- 3D */
async function draw3d() {
  if (!T3) {
    const V = await import("./vendor/three-fragments.js");
    T3 = makeScene(V.THREE, V.OrbitControls, $("#st-3d"));
  }
  T3.build(model(), C.study(), mass(), VIEW, ELEV, C.potential());
  T3.context(CTX3D ? C.study() : null);
  if (VIEW === "sect") T3.cut(CUT);
  if (VIEW === "3d") applySun(); else if (T3.setSun) T3.setSun(null);
}
function makeScene(THREE, Orbit, host) {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.localClippingEnabled = true;
  host.appendChild(r.domElement);
  const over = document.createElement("div"); over.className = "ms-over"; host.appendChild(over);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf3f5f8);
  const persp = new THREE.PerspectiveCamera(38, 1, 1, 30000); persp.up.set(0, 0, 1);
  const ortho = new THREE.OrthographicCamera(-100, 100, 100, -100, -5000, 5000); ortho.up.set(0, 0, 1);
  let cam = persp;
  const ctl = new Orbit(persp, r.domElement);
  ctl.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };   // the middle button pans
  const hemi = new THREE.HemisphereLight(0xffffff, 0xe6e9ee, 2.0); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(-250, -350, 500); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.6;
  Object.assign(sun.shadow.camera, { left: -400, right: 400, top: 400, bottom: -400, near: 1, far: 3000 });
  scene.add(sun);
  const clip = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  let group = null, first = true, mode = "3d", labels = [], ground = null, groundKey = "";
  const resize = () => {
    const w = host.clientWidth || 800, h = host.clientHeight || 600;
    r.setSize(w, h, false); r.domElement.style.width = "100%"; r.domElement.style.height = "100%";
    persp.aspect = w / h; persp.updateProjectionMatrix();
    const k = ortho.userData.span || 100;
    Object.assign(ortho, { left: -k * w / h, right: k * w / h, top: k, bottom: -k }); ortho.updateProjectionMatrix();
  };
  const v3 = new THREE.Vector3();
  const paintLabels = () => {
    const w = host.clientWidth, h = host.clientHeight;
    over.innerHTML = mode === "3d" ? "" : labels.map((l) => {
      v3.set(l.x, l.y, l.z).project(cam);
      return `<span class="${l.cls}" style="left:${((v3.x + 1) / 2 * w).toFixed(0)}px;top:${((1 - v3.y) / 2 * h).toFixed(0)}px">${l.t}</span>`;
    }).join("");
  };
  const loop = () => { if (!host.hidden) { if (mode === "3d") ctl.update(); r.render(scene, cam); paintLabels(); } requestAnimationFrame(loop); };
  const shape = (xy) => { const sh = new THREE.Shape(); xy.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y))); sh.closePath(); return sh; };
  const mats = [];
  const mat = (o) => { const mm = new THREE.MeshLambertMaterial(o); mats.push(mm); return mm; };
  const groundMap = async (s, o, R) => {
    // the Lands Department map under the site, as in Plan
    const key = s.pts.map((p) => p.join(",")).join(";") + "|" + R;
    if (key === groundKey) return; groundKey = key;
    if (ground) { scene.remove(ground); ground = null; }
    const z = R > 900 ? 16 : R > 450 ? 17 : 18, n2 = 2 ** z, rad = Math.PI / 180;
    const tx = (lng) => (lng + 180) / 360 * n2, ty = (lat) => (1 - Math.log(Math.tan(lat * rad) + 1 / Math.cos(lat * rad)) / Math.PI) / 2 * n2;
    const dLat = R / 111320, dLng = R / (111320 * Math.cos(o[0] * rad));
    const x0 = Math.floor(tx(o[1] - dLng)), x1 = Math.floor(tx(o[1] + dLng)), y0 = Math.floor(ty(o[0] + dLat)), y1 = Math.floor(ty(o[0] - dLat));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 144) return;
    const cv = document.createElement("canvas"); cv.width = (x1 - x0 + 1) * 256; cv.height = (y1 - y0 + 1) * 256;
    const g = cv.getContext("2d");
    let got = 0;
    await Promise.all([...Array((x1 - x0 + 1) * (y1 - y0 + 1)).keys()].map(async (k) => {
      const x = x0 + (k % (x1 - x0 + 1)), y = y0 + Math.floor(k / (x1 - x0 + 1));
      try {
        let res = await fetch(`/api/site/tile/${z}/${x}/${y}`).catch(() => null);
        if (!res || !res.ok) res = await fetch(TILE + `${z}/${x}/${y}.png`, { mode: "cors" });
        if (!res.ok) return;
        const bm = await createImageBitmap(await res.blob());
        g.drawImage(bm, (x - x0) * 256, (y - y0) * 256); got++;
      } catch (e) { /* no tiles here: a plain ground */ }
    }));
    if (!got) { C.hint("The map tiles do not load into 3D here: the ground stays plain.", 5000); return; }
    const lng = (x) => x / n2 * 360 - 180, lat = (y) => { const t = Math.PI - 2 * Math.PI * y / n2; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(t) - Math.exp(-t))); };
    const [a, b] = S.toXY([[lat(y1 + 1), lng(x0)], [lat(y0), lng(x1 + 1)]], o);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    ground = new THREE.Mesh(new THREE.PlaneGeometry(b[0] - a[0], b[1] - a[1]), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85 }));
    ground.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, -0.05);
    ground.receiveShadow = true;
    scene.add(ground);
  };
  /* editing a level's plate in 3D: its outline at its top, a handle at each corner (drag it on that level's plane),
     a "+" at each edge's middle (click: a corner there); right-click a handle: remove it */
  let EDIT = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const editOverlay = (mdl, st, span) => {
    EDIT = null;
    if (mode !== "3d" || !SELG) return;
    const B = mdl.blocks.find((b) => b.id === SELG.b); if (!B) return;
    const G = (B.groups || [])[SELG.g]; if (!G) return;
    const fp = (G.fp && G.fp.length >= 3 ? G.fp : B.fp).map((p) => p.slice()); if (fp.length < 3) return;
    const sts = (st.find((x) => x.block.id === B.id) || { storeys: [] }).storeys.filter((q) => q.gi === SELG.g);
    if (!sts.length) return;
    const z = Math.max(...sts.map((q) => q.z1)) + 0.05, rH = Math.max(0.35, span / 140);
    const g2 = new THREE.Group(); group.add(g2);
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(fp.map(([x, y]) => new THREE.Vector3(x, y, z))), new THREE.LineBasicMaterial({ color: 0xf28022, depthTest: false }));
    line.renderOrder = 10; g2.add(line);
    const hv = new THREE.MeshBasicMaterial({ color: 0xf28022, depthTest: false }), hm = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
    const handles = [];
    fp.forEach(([x, y], k) => { const m2 = new THREE.Mesh(new THREE.SphereGeometry(rH, 14, 10), hv); m2.position.set(x, y, z); m2.renderOrder = 11; m2.userData = { hv: k }; g2.add(m2); handles.push(m2); });
    fp.forEach((p, k) => { const q = fp[(k + 1) % fp.length], m2 = new THREE.Mesh(new THREE.BoxGeometry(rH * 1.2, rH * 1.2, rH * 1.2), hm); m2.position.set((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, z); m2.renderOrder = 11; m2.userData = { hm: k }; g2.add(m2); handles.push(m2); });
    // what a corner snaps to: the other plates' corners
    const snapPts = mdl.blocks.flatMap((b) => [...(b.fp || []), ...(b.groups || []).flatMap((q) => q.fp || [])]);
    EDIT = { fp, z, handles, line, g2, snapPts, rH };
  };
  const rayAt = (ev) => { const rc = r.domElement.getBoundingClientRect(); ndc.set(((ev.clientX - rc.left) / rc.width) * 2 - 1, -((ev.clientY - rc.top) / rc.height) * 2 + 1); ray.setFromCamera(ndc, cam); return ray; };
  const onPlane = (ev, z) => { const rr = rayAt(ev), pl = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), out = new THREE.Vector3(); return rr.ray.intersectPlane(pl, out) ? [out.x, out.y] : null; };
  const commitEdit = () => {
    if (!EDIT) return;
    const m = mass(), b = m.blocks.find((q) => q.id === SELG.b), o = origin(); if (!b || !o) return;
    const g = b.groups[SELG.g]; if (!g) return;
    g.fp = S.fromXY(EDIT.fp, o); changed();
  };
  let DR = null;
  r.domElement.addEventListener("pointerdown", (ev) => {
    if (mode !== "3d" || ev.button !== 0) { DR = null; return; }
    DR = { x: ev.clientX, y: ev.clientY, moved: false };
    if (!EDIT || !C.can()) return;
    const hit = rayAt(ev).intersectObjects(EDIT.handles, false)[0];
    if (!hit) return;
    const u = hit.object.userData;
    if (u.hm != null) { const k = u.hm, p = EDIT.fp[k], q = EDIT.fp[(k + 1) % EDIT.fp.length]; EDIT.fp.splice(k + 1, 0, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]); DR = null; ev.stopPropagation(); return commitEdit(); }
    DR.k = u.hv; ctl.enabled = false; ev.stopPropagation();
    try { r.domElement.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic */ }
  }, true);
  r.domElement.addEventListener("pointermove", (ev) => {
    if (!DR) return;
    if (Math.hypot(ev.clientX - DR.x, ev.clientY - DR.y) > 4) DR.moved = true;
    if (DR.k == null || !EDIT) return;
    let p = onPlane(ev, EDIT.z); if (!p) return;
    // to another plate's corner within a handle's reach, else to 50 mm
    let best = null, bd = EDIT.rH * 2.5;
    for (const q of EDIT.snapPts) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd && !(EDIT.fp[DR.k] === q)) { bd = d; best = q; } }
    p = best && !ev.altKey ? [best[0], best[1]] : [Math.round(p[0] * 20) / 20, Math.round(p[1] * 20) / 20];
    EDIT.fp[DR.k] = p; EDIT.handles[DR.k].position.set(p[0], p[1], EDIT.z);
    const k2 = EDIT.fp.length;
    for (let k = 0; k < k2; k++) { const a = EDIT.fp[k], c = EDIT.fp[(k + 1) % k2]; EDIT.handles[k2 + k].position.set((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, EDIT.z); }
    EDIT.line.geometry.setFromPoints(EDIT.fp.map(([x, y]) => new THREE.Vector3(x, y, EDIT.z)));
  });
  r.domElement.addEventListener("pointerup", (ev) => {
    const d = DR; DR = null; ctl.enabled = true;
    if (!d) return;
    if (d.k != null) { if (d.moved) commitEdit(); return; }
    if (d.moved || mode !== "3d") return;
    // a click: the level under it chosen (or none)
    const meshes = group ? group.children.filter((q) => q.isMesh && q.userData && q.userData.bid) : [];
    const hit = rayAt(ev).intersectObjects(meshes, false)[0];
    const u = hit && hit.object.userData;
    if (u && !(SELG && SELG.b === u.bid && SELG.g === u.gi)) { pickLevel(u.bid, u.gi); C.hint("This level's plate: drag its corners (orange), click a + for a corner more, right-click a corner to remove it. Click elsewhere to finish.", 6000); }
    else if (!u && SELG) { SELG = null; render(); }
  });
  r.domElement.addEventListener("contextmenu", (ev) => {
    if (!EDIT || mode !== "3d" || !C.can()) return;
    const hit = rayAt(ev).intersectObjects(EDIT.handles, false)[0];
    if (!hit || hit.object.userData.hv == null) return;
    ev.preventDefault();
    if (EDIT.fp.length <= 3) return C.hint("A plate keeps 3 corners at least.", 3000);
    EDIT.fp.splice(hit.object.userData.hv, 1); commitEdit();
  });
  const build = (mdl, s, m, view, elev, pot) => {
    { const RR = ctxR(); persp.far = Math.max(30000, RR * 8); persp.updateProjectionMatrix(); Object.assign(sun.shadow.camera, { left: -RR, right: RR, top: RR, bottom: -RR, far: RR * 6 }); sun.shadow.camera.updateProjectionMatrix(); }
    mode = view === "plan" ? "3d" : view;
    LOOK = { s, view: mode, elev };
    resize();
    if (group) { scene.remove(group); group.traverse((x) => { if (x.geometry) x.geometry.dispose(); }); }
    mats.length = 0; labels = [];
    group = new THREE.Group();
    const o = s.pts.length >= 3 ? S.centroid(s.pts) : null;
    let zmax = 10, span = 60;
    if (o) {
      const sxy = S.toXY(s.pts, o);
      for (const p of sxy) span = Math.max(span, Math.hypot(p[0], p[1]));
      const site = new THREE.Mesh(new THREE.ShapeGeometry(shape(sxy)), new THREE.MeshLambertMaterial({ color: 0xe2ebdd }));
      site.position.z = 0.02; site.receiveShadow = true; group.add(site);
      const ol = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(sxy.map(([x, y]) => new THREE.Vector3(x, y, 0.06))), new THREE.LineBasicMaterial({ color: 0xcbd6c5 }));
      group.add(ol);
      // streets: light strips outside the street edges, at their widths
      let sg = 0; for (let i = 0; i < sxy.length; i++) { const [x1, y1] = sxy[i], [x2, y2] = sxy[(i + 1) % sxy.length]; sg += x1 * y2 - x2 * y1; }
      for (const [e, id] of Object.entries(s.streets || {})) {
        const a = sxy[+e], b = sxy[(+e + 1) % sxy.length]; if (!a || !b) continue;
        const rd = (s.roads || {})[id] || {}, w = Number(rd.width) > 0 ? Number(rd.width) : 8;
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = (sg > 0 ? dy : -dy) / L, ny = (sg > 0 ? -dx : dx) / L;
        const q = [a, b, [b[0] + nx * w, b[1] + ny * w], [a[0] + nx * w, a[1] + ny * w]];
        const st = new THREE.Mesh(new THREE.ShapeGeometry(shape(q)), new THREE.MeshLambertMaterial({ color: 0xffffff }));
        st.position.z = 0.03; st.receiveShadow = true; group.add(st);
      }
      groundMap(s, o, ctxR());
    }
    const clipping = mode === "sect" ? [clip] : [];
    const st = M.stacks(mdl), bs = M.buildings(mdl);
    for (const x of st) {
      if (x.block.fp.length < 3) continue;
      for (const p of x.block.fp) span = Math.max(span, Math.hypot(p[0], p[1]));
      const shapes = new Map();
      for (const sto of x.storeys) {
        const fp = sto.fp && sto.fp.length >= 3 ? sto.fp : x.block.fp;
        if (!shapes.has(fp)) shapes.set(fp, shape(fp));
        const sh = shapes.get(fp);
        const u = M.USES[sto.use] || M.USES.dom;
        const geo = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.05, sto.h - 0.12), bevelEnabled: false });
        const mesh = new THREE.Mesh(geo, mat({ color: new THREE.Color(u.color), transparent: sto.storey === false, opacity: sto.storey === false ? 0.75 : 1, clippingPlanes: clipping, side: THREE.DoubleSide }));
        mesh.position.z = sto.z0; mesh.castShadow = SHADOW; mesh.receiveShadow = SHADOW;
        mesh.userData = { bid: sto.block, gi: sto.gi };
        if (SELG && SELG.b === sto.block && SELG.g === sto.gi && mode === "3d") { mesh.material.emissive = new THREE.Color(0xf28022); mesh.material.emissiveIntensity = 0.35; }
        group.add(mesh);
        const flat = mode !== "3d";
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: flat ? 0x1b232c : 0x28323c, transparent: true, opacity: flat ? 0.85 : 0.3, clippingPlanes: clipping }));
        edges.position.z = sto.z0; group.add(edges);
        zmax = Math.max(zmax, sto.z1);
      }
    }
    // the surroundings
    const oo = o, LN = lineOf(s, o, view, elev);
    for (const c of m.context || []) {
      if (!oo || !c.fp || c.fp.length < 3) continue;
      const xy = S.toXY(c.fp, oo);
      if (LN && !nearLine(LN, xy)) continue;
      const geo = new THREE.ExtrudeGeometry(shape(xy), { depth: Math.max(1, Number(c.h) || 10), bevelEnabled: false });
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: LN ? 0xd5d9de : 0xdfe3e8, transparent: true, opacity: 0.9 }));
      mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
      group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0xb8bec6 })));
      zmax = Math.max(zmax, Number(c.h) || 0);
    }
    // the refuge floors due: a green ghost band
    for (const b of bs) {
      const rf = M.refuge(b.storeys, m.uc6);
      for (const no of rf.due) {
        const sto = b.storeys.find((x) => x.no === no); if (!sto) continue;
        const blk = st.find((x) => x.block.id === sto.block);
        const geo = new THREE.ExtrudeGeometry(shape(blk.block.fp.map(([x, y]) => [x * 1.06, y * 1.06])), { depth: sto.h, bevelEnabled: false });
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x2ea043, transparent: true, opacity: 0.35, depthWrite: false }));
        mesh.position.z = sto.z0; group.add(mesh);
      }
    }
    scene.add(group);
    editOverlay(mdl, st, span);
    // elevation / section: square to a site edge
    if ((mode === "elev" || mode === "sect") && o) {
      const sxy = S.toXY(s.pts, o), e = Math.min(elev, sxy.length - 1), a = sxy[e], b = sxy[(e + 1) % sxy.length];
      let sg = 0; for (let i = 0; i < sxy.length; i++) { const [x1, y1] = sxy[i], [x2, y2] = sxy[(i + 1) % sxy.length]; sg += x1 * y2 - x2 * y1; }
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      const out = [(sg > 0 ? dy : -dy) / L, (sg > 0 ? -dx : dx) / L]; // outward: where we stand
      const k = Math.max(span * 1.1, zmax * 0.62);
      ortho.userData.span = k;
      cam = ortho;
      ortho.position.set(out[0] * 2000, out[1] * 2000, zmax / 2);
      ortho.lookAt(0, 0, zmax / 2);
      resize();
      clip.normal.set(-out[0], -out[1], 0);
      ortho.userData.out = out; ortho.userData.range = span;
      // level lines and labels
      const lv = Number(s.plan && s.plan.level) || 0, side = [-dy / L * 1.2 * span, -dx / L * 1.2 * span];
      void side;
      const along = [dx / L, dy / L], far = [along[0] * span * 1.15, along[1] * span * 1.15];
      const line = (z, col, dash) => {
        const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-far[0], -far[1], z), new THREE.Vector3(far[0], far[1], z)]);
        const ln = new THREE.Line(g, dash ? new THREE.LineDashedMaterial({ color: col, dashSize: 3, gapSize: 2 }) : new THREE.LineBasicMaterial({ color: col }));
        if (dash) ln.computeLineDistances();
        group.add(ln);
      };
      line(0, 0x666666);
      labels.push({ x: far[0], y: far[1], z: 0, t: `${f1(lv)} mPD site level`, cls: "lv" });
      // each floor's level: a thin line across the building, its mark (▽ +mPD, the floor) at the building's end
      const tick = (z, t0, t1, col) => { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(along[0] * t0, along[1] * t0, z), new THREE.Vector3(along[0] * t1, along[1] * t1, z)]); group.add(new THREE.Line(g, new THREE.LineDashedMaterial({ color: col, dashSize: 1.2, gapSize: 0.8 }))); group.children[group.children.length - 1].computeLineDistances(); };
      for (const bb of bs) {
        const pts = bb.storeys.flatMap((q) => q.fp || []); if (!pts.length) continue;
        const ts = pts.map((p) => p[0] * along[0] + p[1] * along[1]);
        let t0 = Math.min(...ts) - 3, t1 = Math.max(...ts) + 3;
        // the marks at the end on the right of the view
        ortho.updateMatrixWorld(); const sxOf = (t) => new THREE.Vector3(along[0] * t, along[1] * t, 0).project(ortho).x;
        if (sxOf(t0) > sxOf(t1)) [t0, t1] = [t1, t0];
        const lvls = []; const seen = new Set();
        for (const q of bb.storeys) { if (seen.has(q.z0)) continue; seen.add(q.z0); lvls.push(q); }
        const many = lvls.length > 24;
        lvls.forEach((q, i) => {
          tick(q.z0, t0, t1, 0x9aa3ad);
          const first = i === 0 || lvls[i - 1].gi !== q.gi || lvls[i - 1].block !== q.block;
          if (!many || first || (q.no != null && q.no % 5 === 0)) labels.push({ x: along[0] * t1, y: along[1] * t1, z: q.z0, t: `▽ ${(lv + q.z0) >= 0 ? "+" : ""}${f2(lv + q.z0)} mPD · ${q.no == null ? (M.USES[q.use] || {}).label || q.use : q.no === 1 ? "G/F" : q.no - 1 + "/F"}`, cls: "lvf" });
        });
      }
      for (const bb of bs) {
        const top = bb.storeys.length ? bb.storeys[bb.storeys.length - 1].z1 : 0;
        line(top, 0x8a6d3b);
        labels.push({ x: far[0], y: far[1], z: top, t: `${f1(lv + top)} mPD · ${esc(bb.top.name || "")} · ${bb.storeys.filter((q) => q.storey !== false).length} st.`, cls: "lv" });
      }
      const bh = (pot || []).find((q) => q.key === "bh");
      if (bh && bh.value != null) { line(bh.value - lv, 0xcf222e, true); labels.push({ x: -far[0], y: -far[1], z: bh.value - lv, t: `${f1(bh.value)} mPD limit (${esc(bh.by)})`, cls: "lim" }); }
    } else {
      cam = persp;
      if (first || mode !== "3d") { const d = Math.max(span, zmax * 0.8, 90); persp.position.set(-d * 2.0, -d * 2.4, zmax * 0.9 + d * 1.2); ctl.target.set(0, 0, zmax / 3); first = false; }
      ctl.update();
    }
    look();
  };
  /* the line an elevation looks at (the site edge) or a section cuts along; null in 3D. {p, n}: a point on it, its normal */
  const lineOf = (s, o, view, elev) => {
    if (!o || (view !== "elev" && view !== "sect") || s.pts.length < 3) return null;
    const sxy = S.toXY(s.pts, o), e = Math.min(elev, sxy.length - 1), a = sxy[e], b = sxy[(e + 1) % sxy.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    if (view === "sect") return { sect: true, n: [dy / L, -dx / L] };   // the cut's point comes from clip at use
    // an elevation: the normal outward (where the viewer stands); what stands wholly in front of the edge is left out, so it hides nothing
    let sg = 0; for (let i = 0; i < sxy.length; i++) { const [x1, y1] = sxy[i], [x2, y2] = sxy[(i + 1) % sxy.length]; sg += x1 * y2 - x2 * y1; }
    return { p: a, n: sg > 0 ? [dy / L, -dx / L] : [-dy / L, dx / L], front: true };
  };
  const NEAR = 50;   // the surroundings shown in elevation and section: within 50 m of the line
  const distOf = (LN, x, y) => (LN.sect ? Math.abs(clip.normal.x * x + clip.normal.y * y + clip.constant) : Math.abs(LN.n[0] * (x - LN.p[0]) + LN.n[1] * (y - LN.p[1])));
  const nearLine = (LN, xy) => {
    let lo = Infinity, hi = -Infinity;
    for (const [x, y] of xy) { const d = LN.sect ? clip.normal.x * x + clip.normal.y * y + clip.constant : LN.n[0] * (x - LN.p[0]) + LN.n[1] * (y - LN.p[1]); lo = Math.min(lo, d); hi = Math.max(hi, d); }
    if (LN.front && lo > 1) return false;
    return (lo <= 0 && hi >= 0) || Math.min(Math.abs(lo), Math.abs(hi)) <= NEAR;
  };
  let LOOK = { s: null, view: "3d", elev: 0 }, nearMesh = null, nearKey = "";
  /* elevation / section: flat, clear colours (the sun off, more sky light); the CSDI surroundings near the line only, pale grey */
  const look = () => {
    const flat = mode !== "3d";
    hemi.intensity = flat ? 3.1 : 2.0; sun.intensity = flat ? 0 : SUNDIR && SUNDIR[2] <= 0 ? 0 : 1.0;
    if (!ctxMesh) return;
    const s = LOOK.s, o = s && s.pts.length >= 3 ? S.centroid(s.pts) : null, LN = flat && o ? lineOf(s, o, LOOK.view, LOOK.elev) : null;
    if (!LN || !ctxComp) { ctxMesh.visible = ctxOn; if (nearMesh) nearMesh.visible = false; return; }
    ctxMesh.visible = false;
    const B = ctxComp.box, keepC = new Uint8Array(ctxComp.n);
    let key = "";
    for (let c = 0; c < ctxComp.n; c++) {
      const xy = [[B[c * 4], B[c * 4 + 1]], [B[c * 4 + 2], B[c * 4 + 1]], [B[c * 4 + 2], B[c * 4 + 3]], [B[c * 4], B[c * 4 + 3]]];
      if (nearLine(LN, xy)) { keepC[c] = 1; key += c + ","; }
    }
    if (key !== nearKey || !nearMesh) {
      const T = ctxComp.tri, A = ctxArr; let k = 0;
      for (let i = 0; i < T.length; i++) if (keepC[T[i]]) k++;
      const out = new Float32Array(k * 9); let j = 0;
      for (let i = 0; i < T.length; i++) if (keepC[T[i]]) { out.set(A.subarray(i * 9, i * 9 + 9), j); j += 9; }
      if (nearMesh) { scene.remove(nearMesh); nearMesh.geometry.dispose(); }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(out, 3)); g.computeVertexNormals();
      nearMesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xd5d9de, side: THREE.DoubleSide, clippingPlanes: mode === "sect" ? [clip] : [] }));
      scene.add(nearMesh); nearKey = key;
    }
    nearMesh.material.clippingPlanes = mode === "sect" ? [clip] : [];
    nearMesh.visible = ctxOn;
  };
  void distOf;
  const cut = (pct) => {
    const out = ortho.userData.out; if (!out) return;
    const R = ortho.userData.range || 50;
    clip.constant = (pct / 100 * 2 - 1) * R; // from the far side to the near side
    look();
  };
  sun.castShadow = SHADOW;
  /* the buildings around, from the server (CSDI 3D Spatial Data), once per site */
  let ctxMesh = null, ctxKey = "", ctxBusy = false, ctxComp = null, ctxArr = null, ctxOn = false;
  const status = (t) => { const e = document.getElementById("ms-ctxst"); if (e) e.textContent = t; };
  const context = async (s) => {
    ctxOn = !!(s && s.pts.length >= 3);
    if (!ctxOn) { if (ctxMesh) ctxMesh.visible = false; if (nearMesh) nearMesh.visible = false; status(""); return; }
    const c = S.centroid(s.pts), R = ctxR();
    const key = c.map((x) => x.toFixed(5)).join(",") + "," + Math.round(R);
    if (key === ctxKey && ctxMesh) { look(); return; }
    if (ctxBusy) return;
    ctxBusy = true; status("loading the surroundings …");
    try {
      let res;
      for (let k = 0; k < 900; k++) { // the server builds a big area in the background: ask again until it is there
        res = await fetch(`/api/site/context?lat=${c[0]}&lng=${c[1]}&r=${Math.round(R)}`, { headers: C.headers() });
        if (res.status !== 202) break;
        const j = await res.json().catch(() => ({}));
        status(`loading the surroundings: ${j.stage || "…"}${j.total ? ` ${j.done} / ${j.total} tiles` : j.done ? ` ${j.done}` : ""}`);
        await new Promise((ok) => setTimeout(ok, 2000));
        if (ctxR() !== R) { ctxBusy = false; return context(C.study()); }
      }
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || "HTTP " + res.status); }
      const meta = JSON.parse(res.headers.get("X-Context") || "{}");
      const raw = new Float32Array(await res.arrayBuffer());
      // the buildings on the site itself go: the scheme replaces them
      const sxy = S.toXY(s.pts, c), keep = [];
      for (let i = 0; i < raw.length; i += 9) {
        const cx = (raw[i] + raw[i + 3] + raw[i + 6]) / 3, cy = (raw[i + 1] + raw[i + 4] + raw[i + 7]) / 3;
        if (!M.inside(sxy, cx, cy)) for (let k = 0; k < 9; k++) keep.push(raw[i + k]);
      }
      const arr = new Float32Array(keep);
      if (ctxMesh) { scene.remove(ctxMesh); ctxMesh.geometry.dispose(); }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      g.computeVertexNormals();
      ctxMesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xdfe3e8, side: THREE.DoubleSide }));
      ctxMesh.castShadow = SHADOW; ctxMesh.receiveShadow = SHADOW;
      scene.add(ctxMesh);
      ctxKey = key; ctxArr = arr; ctxComp = comps(arr); nearKey = ""; look();
      status(meta.triangles ? `${meta.triangles.toLocaleString("en-GB")} triangles · ${R.toLocaleString("en-GB")} m around${meta.capped ? " (capped: some tiles left out)" : ""} · © Lands Department 3D data` : "no buildings found around");
    } catch (e) { status("surroundings not loaded: " + e.message); }
    ctxBusy = false;
  };
  // the sun from a direction [east, north, up] (a shadow study), or back to the fixed light (null)
  let SUNDIR = null;
  const setSun = (dir) => {
    SUNDIR = dir; const RR = ctxR() * 2;
    if (dir) sun.position.set(dir[0] * RR, dir[1] * RR, Math.max(0.01, dir[2]) * RR); else sun.position.set(-250, -350, 500);
    look();
  };
  const shadow = (on) => { sun.castShadow = on; if (ctxMesh) { ctxMesh.castShadow = on; ctxMesh.receiveShadow = on; } if (group) group.traverse((x) => { if (x.isMesh) { x.castShadow = on; x.receiveShadow = on; } }); };
  resize(); loop();
  // for the browser tests: the level being edited, and a model point on the screen
  const editInfo = () => (EDIT ? { fp: EDIT.fp.map((p) => p.slice()), z: EDIT.z } : null);
  const screen = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(cam), rc = r.domElement.getBoundingClientRect(); return [rc.left + (v.x + 1) / 2 * rc.width, rc.top + (1 - v.y) / 2 * rc.height]; };
  return { context, shadow, setSun, build, resize, cut, editInfo, screen, png: () => { r.render(scene, cam); return r.domElement.toDataURL("image/png"); },
    // a small picture for a scheme (kept with it, so small: 240 px wide, JPEG)
    thumb: () => { r.render(scene, cam); const src = r.domElement, w = 240, h = Math.round(w * src.height / Math.max(1, src.width)), cv = document.createElement("canvas"); cv.width = w; cv.height = h; const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(src, 0, 0, w, h); return cv.toDataURL("image/jpeg", 0.7); } };
}

/* the buildings in a triangle soup (9 floats a triangle): triangles that share a corner are one building;
   -> {n, tri: Int32Array (a building a triangle), box: Float32Array (x0, y0, x1, y1 a building)} */
export function comps(arr) {
  const nt = Math.floor(arr.length / 9), P = new Int32Array(nt), id = new Map();
  for (let i = 0; i < nt; i++) P[i] = i;
  const find = (a) => { while (P[a] !== a) { P[a] = P[P[a]]; a = P[a]; } return a; };
  for (let i = 0; i < nt; i++) for (let k = 0; k < 3; k++) {
    const o = i * 9 + k * 3, h = Math.round(arr[o] * 20) + "," + Math.round(arr[o + 1] * 20) + "," + Math.round(arr[o + 2] * 20);
    const j = id.get(h);
    if (j == null) id.set(h, i); else { const a = find(i), b = find(j); if (a !== b) P[a] = b; }
  }
  const map = new Map(), tri = new Int32Array(nt);
  for (let i = 0; i < nt; i++) { const r = find(i); let c = map.get(r); if (c == null) { c = map.size; map.set(r, c); } tri[i] = c; }
  const box = new Float32Array(map.size * 4);
  for (let c = 0; c < map.size; c++) { box[c * 4] = box[c * 4 + 1] = Infinity; box[c * 4 + 2] = box[c * 4 + 3] = -Infinity; }
  for (let i = 0; i < nt; i++) { const c = tri[i]; for (let k = 0; k < 3; k++) { const x = arr[i * 9 + k * 3], y = arr[i * 9 + k * 3 + 1]; if (x < box[c * 4]) box[c * 4] = x; if (y < box[c * 4 + 1]) box[c * 4 + 1] = y; if (x > box[c * 4 + 2]) box[c * 4 + 2] = x; if (y > box[c * 4 + 3]) box[c * 4 + 3] = y; } }
  return { n: map.size, tri, box };
}
