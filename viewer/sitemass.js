/* Site study, phase 2: Massing - the blocks on the site, their floor groups,
 * the live figures against the governing limits, the refuge floors, the
 * footprints on the map (corners, set-backs, measure), the 3D view with its
 * elevations and section, and the surroundings. Kept in study.massing with
 * the project. The figures are massingcore.js's.
 */
import * as S from "./sitecore.js";
import * as M from "./massingcore.js";
import { toast } from "./tasks-util.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f0 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { maximumFractionDigits: 0 }));
const f1 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const f2 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const TILE = "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/WGS84/";

let C = null, layer = null, ON = false, VIEW = "plan", T3 = null, SEL = null;
let TOOL = null; // "measure" {a} | "context" [pts]
let MEAS = [], rub = null;
let ELEV = 0, CUT = 50;

export function init(ctx) {
  C = ctx;
  layer = C.L.layerGroup();
  const P = $("#st-mpanel");
  P.addEventListener("change", onChange);
  P.addEventListener("click", onClick);
  P.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches("input")) ev.target.blur(); });
  $("#st-views").addEventListener("click", onViews);
  $("#st-views").addEventListener("change", onViews);
  $("#st-views").addEventListener("input", onViews);
  window.addEventListener("resize", () => T3 && T3.resize());
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && TOOL) endTool(); if (ev.key === "Enter" && TOOL && TOOL.kind === "context") finishContext(); });
  const map = C.map();
  map.on("click", (ev) => { if (!ON || !TOOL) return; toolClick(ev); });
  map.on("dblclick", () => { if (ON && TOOL && TOOL.kind === "context") finishContext(); });
  map.on("mousemove", (ev) => { if (ON && TOOL && TOOL.kind === "measure" && TOOL.a) rubber(ev); });
}

function mass() {
  const s = C.study();
  s.massing = s.massing && typeof s.massing === "object" ? s.massing : {};
  const m = s.massing;
  m.blocks = Array.isArray(m.blocks) ? m.blocks : [];
  m.context = Array.isArray(m.context) ? m.context : [];
  // the first form typed concessions; GFA % now gives them, the typed figure is an extra
  for (const b of m.blocks) for (const g of b.groups || []) if (g.conc != null && g.extra == null) { g.extra = g.conc; delete g.conc; }
  return m;
}
const origin = () => { const s = C.study(); return s.pts.length >= 3 ? S.centroid(s.pts) : null; };
function model() {
  const o = origin(), m = mass();
  return { blocks: m.blocks.map((b) => Object.assign({}, b, { fp: o && b.fp && b.fp.length >= 3 ? S.toXY(b.fp, o) : [] })) };
}
const uid = () => "b" + Math.random().toString(36).slice(2, 8);

export function show(on) {
  ON = on;
  document.body.classList.toggle("st-mass", on);
  $("#st-panel").hidden = on;
  $("#st-mpanel").hidden = !on;
  $("#st-views").hidden = !on;
  if (on) { layer.addTo(C.map()); render(); viewsBar(); } else { endTool(); layer.remove(); setView("plan"); }
}
export function refresh() { if (ON) render(); }

/* ---------- views: Plan / 3D / Elevation / Section, and the plan tools */
function viewsBar() {
  const s = C.study(), n = s.pts.length, no = {};
  const names = (i) => { const id = s.streets && s.streets[i]; const r = id != null && s.roads && s.roads[id]; return r && r.name ? r.name : id != null ? "Street" : "Edge " + (i + 1) + "–" + ((i + 1) % n + 1); };
  void no;
  const el = $("#st-views");
  el.innerHTML = `<button type="button" data-v="plan"${VIEW === "plan" ? ' class="on"' : ""}>Plan</button><button type="button" data-v="3d"${VIEW === "3d" ? ' class="on"' : ""}>3D</button><button type="button" data-v="elev"${VIEW === "elev" ? ' class="on"' : ""}>Elevation</button><button type="button" data-v="sect"${VIEW === "sect" ? ' class="on"' : ""}>Section</button>
    ${VIEW === "elev" || VIEW === "sect" ? `<select data-elev title="Looking at the building square to this edge">${s.pts.map((p, i) => `<option value="${i}"${i === ELEV ? " selected" : ""}>${VIEW === "elev" ? "from " : "along "}${esc(names(i))}</option>`).join("")}</select>` : ""}
    ${VIEW === "sect" ? `<input type="range" min="0" max="100" value="${CUT}" data-cut title="Where the section cuts">` : ""}
    ${VIEW === "plan" && C.can() ? `<button type="button" data-tool="measure" class="${TOOL && TOOL.kind === "measure" ? "on" : ""}" title="Measure: snaps to the site and the footprints">📏</button><button type="button" data-tool="context" class="${TOOL && TOOL.kind === "context" ? "on" : ""}" title="Draw a neighbouring building for the 3D view">+ Context</button>` : ""}
    ${VIEW !== "plan" ? `<button type="button" data-png title="Save this view as a picture">PNG</button>` : ""}`;
}
function onViews(ev) {
  const t = ev.target;
  if (t.dataset.v && ev.type === "click") return setView(t.dataset.v);
  if (t.dataset.elev != null && ev.type === "change") { ELEV = +t.value; return draw3d(); }
  if (t.dataset.cut != null && ev.type === "input") { CUT = +t.value; if (T3) T3.cut(CUT); return; }
  if (t.dataset.png != null && ev.type === "click") return png();
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
function render() { if (!ON) return; panel(); drawPlan(); if (VIEW !== "plan") draw3d(); }
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
      <div class="st-head"><b>Massing</b><span class="muted" id="ms-saved">${can ? "Saved with the project" : "View only"}</span></div>
      ${noSite ? `<p class="st-need">Draw the site boundary first (1 · Site).</p>` : ""}
      <div class="ms-sum">${rows.map(bar).join("")}
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
    ${m.blocks.map((b, bi) => blockCard(b, bi, m, dis)).join("")}
    ${can && !noSite ? `<div class="st-row ms-add"><button type="button" class="primary" data-ma="podium">+ Podium</button><button type="button" class="ghost" data-ma="tower">+ Tower</button><button type="button" class="ghost" data-ma="example">Example: podium + tower</button></div>` : ""}
    ${m.context.length ? `<section class="st-card"><div class="st-head"><b>Surroundings</b><span class="muted">for the 3D view</span></div>
      <table class="ms-groups"><tbody>${m.context.map((c, i) => `<tr><td>${esc(c.name || "Building " + (i + 1))}</td><td>${f0(S.area(c.fp))} m²</td><td><input type="number" min="0" step="1" data-ctx="${i}" value="${esc(c.h)}"${dis}> m high</td><td>${can ? `<button type="button" class="ghost st-ib" data-ctxdel="${i}">×</button>` : ""}</td></tr>`).join("")}</tbody></table></section>` : ""}
    <section class="st-card">
      <div class="st-head"><b>Export</b></div>
      <div class="st-row"><button type="button" class="ghost" data-mx="obj"${m.blocks.length ? "" : " disabled"}>OBJ (3D)</button><button type="button" class="ghost" data-mx="png">PNG</button><button type="button" class="ghost" data-mx="gbp"${can && f.gfa ? "" : " disabled"}>Send GFA and height to GBP workbook</button></div>
    </section>`;
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
    const conc = a * (1 - acc / 100) + (Number(g.extra) || 0);
    return `<tr style="--c:${u.color}">
      <td><i class="ms-sw"></i><select data-g="${bi}.${gi}.use"${dis}>${useOpt(g.use)}</select></td>
      <td><input type="number" min="0" step="1" data-g="${bi}.${gi}.n" value="${esc(g.n)}"${dis}></td>
      <td><input type="number" min="0" step="0.05" data-g="${bi}.${gi}.h" value="${esc(g.h)}"${dis}></td>
      <td><input type="number" min="0" max="100" step="1" data-g="${bi}.${gi}.acc" value="${esc(g.acc == null ? "" : g.acc)}" placeholder="${u.acc}"${dis}></td>
      <td class="num" title="Floor area not counted as GFA (+ the extra)">${f0(conc)}</td>
      <td><input type="number" min="0" step="1" data-g="${bi}.${gi}.extra" value="${esc(g.extra == null ? "" : g.extra)}" placeholder="0" title="Extra concession per floor outside the footprint (balconies, utility platforms)"${dis}></td>
      <td><input type="checkbox" data-gs="${bi}.${gi}"${isSt(g) ? " checked" : ""} title="Counts as a storey"${dis}></td>
      <td class="nw">${dis ? "" : `<button type="button" class="ghost st-ib" data-gup="${bi}.${gi}" title="Move down">↓</button><button type="button" class="ghost st-ib" data-gdel="${bi}.${gi}" title="Remove">×</button>`}</td></tr>`;
  }).join("");
  const s = C.study(), sel = SEL === b.id;
  const edgeOpts = s.pts.map((p, i) => `<option value="${i}"${+b.align === i ? " selected" : ""}>edge ${i + 1}–${(i + 1) % s.pts.length + 1}</option>`).join("");
  return `<section class="st-card ms-block${sel ? " sel" : ""}" data-bid="${b.id}">
    <div class="st-head"><input class="ms-name" data-b="${bi}.name" value="${esc(b.name || "")}"${dis}><span class="muted" data-barea="${b.id}">${f0(a)} m² · ${n} storeys · ${f1(h)} m</span></div>
    <div class="ms-fp"><label>On <select data-b="${bi}.on"${dis}><option value="">the ground</option>${others.map((x) => `<option value="${x.id}"${b.on === x.id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label></div>
    ${dis ? "" : `<div class="ms-tools">
      <span><b>Site −</b><input type="number" min="0" step="0.5" data-fpset="${bi}" value="${esc(b.setback == null ? 3 : b.setback)}"> m <button type="button" class="ghost st-ib" data-fp="${bi}.site" title="The site boundary set back; select the block and click a site edge on the plan for its own set-back">Set</button></span>
      <span><b>Rect</b><input type="number" min="1" step="0.5" data-fpw="${bi}" value="${esc(b.w || 30)}">×<input type="number" min="1" step="0.5" data-fpd="${bi}" value="${esc(b.d || 20)}"> m <select data-fpal="${bi}" title="Square to this site edge">${edgeOpts}</select> <button type="button" class="ghost st-ib" data-fp="${bi}.rect">Set</button></span>
      <span><b>Offset</b><input type="number" step="0.5" data-fpoff="${bi}" value="${esc(b.off == null ? 1 : b.off)}"> m <button type="button" class="ghost st-ib" data-fp="${bi}.grow" title="Grow (+) or shrink (−) this footprint">Apply</button></span>
    </div>`}
    ${b.edges ? `<p class="muted st-note">Set-backs per site edge: ${b.edges.map((d, i) => `${i + 1}–${(i + 1) % b.edges.length + 1}: ${f1(d)} m`).join(" · ")}</p>` : ""}
    <table class="ms-groups"><thead><tr><th>Use</th><th>No.</th><th>Ht m</th><th title="The share of the floor area counted as GFA">GFA %</th><th title="Concession per floor: area × (1 − GFA %) + extra">Conc.</th><th title="Extra concession per floor (outside the footprint)">+Extra</th><th title="Counts as a storey">St.</th><th></th></tr></thead><tbody>${gr}</tbody></table>
    ${dis ? "" : `<div class="st-row"><button type="button" class="ghost st-ib" data-gadd="${bi}">+ Floors above</button><button type="button" class="ghost st-ib" data-gtr="${bi}">+ Transfer plate</button><button type="button" class="ghost st-ib" data-bdup="${bi}">Duplicate</button><button type="button" class="ghost st-ib" data-bdel="${bi}">Remove</button></div>`}
  </section>`;
}

function changed() { C.save(); render(); }

function onChange(ev) {
  const t = ev.target, m = mass();
  if (t.dataset.mf === "uc6") { m.uc6 = t.checked; return changed(); }
  if (t.dataset.b) { const [bi, k] = t.dataset.b.split("."); m.blocks[+bi][k] = t.value; return changed(); }
  if (t.dataset.gs) { const [bi, gi] = t.dataset.gs.split(".").map(Number); m.blocks[bi].groups[gi].storey = t.checked; return changed(); }
  if (t.dataset.g) {
    const [bi, gi, k] = t.dataset.g.split("."), g = m.blocks[+bi].groups[+gi];
    g[k] = k === "use" ? t.value : t.value === "" ? (k === "acc" || k === "extra" ? null : 0) : Math.max(0, parseFloat(t.value));
    if (k === "use") { g.acc = null; g.storey = null; }
    return changed();
  }
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
  if (card && SEL !== card.dataset.bid && !ev.target.closest("button,input,select")) { SEL = card.dataset.bid; render(); return; }
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
  for (const c of m.context) L.polygon(c.fp, { color: "#8d949c", weight: 1, fillColor: "#c3c8ce", fillOpacity: 0.5, interactive: false }).addTo(layer);
  for (const b of m.blocks) {
    if (!b.fp || b.fp.length < 3) continue;
    const top = (b.groups || []).filter((g) => g.use !== "transfer").slice(-1)[0], col = (M.USES[(top && top.use) || "dom"] || M.USES.dom).color;
    const sel = SEL === b.id;
    const pg = L.polygon(b.fp, { color: sel ? "#d1660e" : "#7a6a55", weight: sel ? 2.5 : 1, fillColor: col, fillOpacity: b.on ? 0.85 : 0.6 }).addTo(layer);
    pg.on("click", () => { if (TOOL) return; SEL = b.id; render(); });
    if (!sel) { pg.bindTooltip(`${esc(b.name)} · ${f0(S.area(b.fp))} m²`, { direction: "center", className: "st-edge-lab" }); continue; }
    // its edges: length and set-back from the boundary
    const lab = L.layerGroup().addTo(layer);
    const labels = () => {
      lab.clearLayers();
      if (!o) return;
      const xy = S.toXY(b.fp, o), sb = M.setbacks(xy, S.toXY(s.pts, o)), lens = S.edges(b.fp);
      b.fp.forEach((p, i) => {
        const q = b.fp[(i + 1) % b.fp.length];
        L.marker([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], { interactive: false, icon: L.divIcon({ className: "ms-elab", html: `<span>${f1(lens[i])} m${sb[i] != null ? ` · <b>${f1(sb[i])} m</b> to boundary` : ""}</span>`, iconSize: [0, 0] }) }).addTo(lab);
      });
    };
    labels();
    if (!can) continue;
    const live = () => { pg.setLatLngs(b.fp); labels(); panel(); };
    b.fp.forEach((p, i) => {
      const mk = L.marker(p, { draggable: true, icon: L.divIcon({ className: "st-vx ms-vx", iconSize: [12, 12] }), title: "Drag; right-click to remove" }).addTo(layer);
      mk.on("drag", (ev) => { const ll = ev.target.getLatLng(); b.fp[i] = [ll.lat, ll.lng]; b.fromSite = false; live(); });
      mk.on("dragend", () => changed());
      mk.on("contextmenu", (ev) => { L.DomEvent.stop(ev); if (b.fp.length <= 3) return toast("A footprint needs three corners", true); b.fp.splice(i, 1); changed(); });
    });
    b.fp.forEach((p, i) => {
      const q = b.fp[(i + 1) % b.fp.length];
      const mk = L.marker([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], { icon: L.divIcon({ className: "st-mid", iconSize: [10, 10] }), title: "Click to add a corner" }).addTo(layer);
      mk.on("click", (ev) => { L.DomEvent.stop(ev); b.fp.splice(i + 1, 0, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]); changed(); });
    });
    const c = S.centroid(b.fp);
    const mv = L.marker(c, { draggable: true, icon: L.divIcon({ className: "ms-move", html: "✥", iconSize: [22, 22] }), title: "Drag to move the block" }).addTo(layer);
    let from = null, orig = null;
    mv.on("dragstart", () => { from = c; orig = b.fp.map((q) => q.slice()); });
    mv.on("drag", (ev) => { const ll = ev.target.getLatLng(), dl = ll.lat - from[0], dg = ll.lng - from[1]; b.fp = orig.map(([a, g]) => [a + dl, g + dg]); b.fromSite = false; live(); });
    mv.on("dragend", () => changed());
    // a footprint from the site: click a site edge for its own set-back
    if (b.fromSite && o) {
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

function snapPts() {
  const s = C.study(), m = mass(), polys = [s.pts, ...m.blocks.map((b) => b.fp || []), ...m.context.map((c) => c.fp)];
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
  return best || ll;
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
  if (VIEW === "sect") T3.cut(CUT);
}
function makeScene(THREE, Orbit, host) {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  r.shadowMap.enabled = true;
  r.localClippingEnabled = true;
  host.appendChild(r.domElement);
  const over = document.createElement("div"); over.className = "ms-over"; host.appendChild(over);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f5f7);
  const persp = new THREE.PerspectiveCamera(38, 1, 1, 30000); persp.up.set(0, 0, 1);
  const ortho = new THREE.OrthographicCamera(-100, 100, 100, -100, -5000, 5000); ortho.up.set(0, 0, 1);
  let cam = persp;
  const ctl = new Orbit(persp, r.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe6e9ee, 2.0));
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
    const key = s.pts.map((p) => p.join(",")).join(";");
    if (key === groundKey) return; groundKey = key;
    if (ground) { scene.remove(ground); ground = null; }
    const z = 18, n2 = 2 ** z, rad = Math.PI / 180;
    const tx = (lng) => (lng + 180) / 360 * n2, ty = (lat) => (1 - Math.log(Math.tan(lat * rad) + 1 / Math.cos(lat * rad)) / Math.PI) / 2 * n2;
    const dLat = R / 111320, dLng = R / (111320 * Math.cos(o[0] * rad));
    const x0 = Math.floor(tx(o[1] - dLng)), x1 = Math.floor(tx(o[1] + dLng)), y0 = Math.floor(ty(o[0] + dLat)), y1 = Math.floor(ty(o[0] - dLat));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) return;
    const cv = document.createElement("canvas"); cv.width = (x1 - x0 + 1) * 256; cv.height = (y1 - y0 + 1) * 256;
    const g = cv.getContext("2d");
    let got = 0;
    await Promise.all([...Array((x1 - x0 + 1) * (y1 - y0 + 1)).keys()].map(async (k) => {
      const x = x0 + (k % (x1 - x0 + 1)), y = y0 + Math.floor(k / (x1 - x0 + 1));
      try {
        const res = await fetch(TILE + `${z}/${x}/${y}.png`, { mode: "cors" });
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
  const build = (mdl, s, m, view, elev, pot) => {
    mode = view === "plan" ? "3d" : view;
    resize();
    if (group) { scene.remove(group); group.traverse((x) => { if (x.geometry) x.geometry.dispose(); }); }
    mats.length = 0; labels = [];
    group = new THREE.Group();
    const o = s.pts.length >= 3 ? S.centroid(s.pts) : null;
    let zmax = 10, span = 60;
    if (o) {
      const sxy = S.toXY(s.pts, o);
      for (const p of sxy) span = Math.max(span, Math.hypot(p[0], p[1]));
      const site = new THREE.Mesh(new THREE.ShapeGeometry(shape(sxy)), new THREE.MeshLambertMaterial({ color: 0xd9efd3 }));
      site.position.z = 0.02; site.receiveShadow = true; group.add(site);
      const ol = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(sxy.map(([x, y]) => new THREE.Vector3(x, y, 0.06))), new THREE.LineBasicMaterial({ color: 0xf28022 }));
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
      groundMap(s, o, Math.max(200, span * 2.5));
    }
    const clipping = mode === "sect" ? [clip] : [];
    const st = M.stacks(mdl), bs = M.buildings(mdl);
    for (const x of st) {
      if (x.block.fp.length < 3) continue;
      const sh = shape(x.block.fp);
      for (const p of x.block.fp) span = Math.max(span, Math.hypot(p[0], p[1]));
      for (const sto of x.storeys) {
        const u = M.USES[sto.use] || M.USES.dom;
        const geo = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.05, sto.h - 0.12), bevelEnabled: false });
        const mesh = new THREE.Mesh(geo, mat({ color: new THREE.Color(u.color), transparent: sto.storey === false, opacity: sto.storey === false ? 0.75 : 1, clippingPlanes: clipping, side: THREE.DoubleSide }));
        mesh.position.z = sto.z0; mesh.castShadow = true; mesh.receiveShadow = true;
        group.add(mesh);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, clippingPlanes: clipping }));
        edges.position.z = sto.z0; group.add(edges);
        zmax = Math.max(zmax, sto.z1);
      }
    }
    // the surroundings
    const oo = o;
    for (const c of m.context || []) {
      if (!oo || !c.fp || c.fp.length < 3) continue;
      const xy = S.toXY(c.fp, oo);
      const geo = new THREE.ExtrudeGeometry(shape(xy), { depth: Math.max(1, Number(c.h) || 10), bevelEnabled: false });
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xdfe3e8, transparent: true, opacity: 0.9 }));
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
      for (const bb of bs) {
        const top = bb.storeys.length ? bb.storeys[bb.storeys.length - 1].z1 : 0;
        line(top, 0x8a6d3b);
        labels.push({ x: far[0], y: far[1], z: top, t: `${f1(lv + top)} mPD · ${esc(bb.top.name || "")} · ${bb.storeys.filter((q) => q.storey !== false).length} st.`, cls: "lv" });
      }
      const bh = (pot || []).find((q) => q.key === "bh");
      if (bh && bh.value != null) { line(bh.value - lv, 0xcf222e, true); labels.push({ x: -far[0], y: -far[1], z: bh.value - lv, t: `${f1(bh.value)} mPD limit (${esc(bh.by)})`, cls: "lim" }); }
    } else {
      cam = persp;
      if (first || mode !== "3d") { persp.position.set(-span * 2.0, -span * 2.4, zmax * 0.9 + span); ctl.target.set(0, 0, zmax / 3); first = false; }
      ctl.update();
    }
  };
  const cut = (pct) => {
    const out = ortho.userData.out; if (!out) return;
    const R = ortho.userData.range || 50;
    clip.constant = (pct / 100 * 2 - 1) * R; // from the far side to the near side
  };
  resize(); loop();
  return { build, resize, cut, png: () => { r.render(scene, cam); return r.domElement.toDataURL("image/png"); } };
}
