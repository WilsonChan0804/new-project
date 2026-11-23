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

const $ = (s, r = document) => r.querySelector(s);
const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f1 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const f3 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 3, maximumFractionDigits: 3 }));

const TILE = "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/";
const ATTR = '<a href="https://portal.csdi.gov.hk" target="_blank" rel="noopener">&copy; Map from Lands Department</a>';
const HK = [22.35, 114.15];

let WB = { rev: 0, data: {} }, CAN = false, ST = null, map = null;
let L_ = null, layer = null, drawing = null, saveT = null, lastPts = null;

function study() {
  const d = WB.data;
  d.study = d.study || {};
  const s = d.study;
  s.pts = Array.isArray(s.pts) ? s.pts : [];
  s.streets = s.streets && typeof s.streets === "object" ? s.streets : {};
  return s;
}

/* ---------- saving (as the GBP workbook: rev, 409 -> take theirs, keep ours) */
function save() {
  if (!CAN) return;
  clearTimeout(saveT);
  $("#st-saved") && ($("#st-saved").textContent = "Saving …");
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
  if (!res.ok) { $("#st-saved").textContent = "Not saved"; toast((body && body.detail && (body.detail.message || body.detail)) || "Not saved", true); return; }
  WB.rev = body.rev; push.quickSent = null;
  $("#st-saved").textContent = "Saved with the project";
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
  map.on("click", (ev) => { if (drawing) { drawing.push([ev.latlng.lat, ev.latlng.lng]); drawRubber(); } });
  map.on("dblclick", () => { if (drawing) finishDraw(); });
  map.on("moveend", () => { const s = study(), c = map.getCenter(); s.view = { c: [+c.lat.toFixed(6), +c.lng.toFixed(6)], z: map.getZoom() }; });
  L_ = L;
}

const PINK = "#e85d8a", STREET = "#f28022", EDGE = "#3a3a3a";

function draw() {
  const L = L_, s = study();
  layer.clearLayers();
  if (s.pts.length < 3) return;
  L.polygon(s.pts, { color: PINK, weight: 1, fillColor: PINK, fillOpacity: 0.22, interactive: false }).addTo(layer);
  const lens = S.edges(s.pts), no = streetNos(s);
  s.pts.forEach((p, i) => {
    const q = s.pts[(i + 1) % s.pts.length], st = s.streets[i];
    const line = L.polyline([p, q], { color: st ? STREET : EDGE, weight: st ? 8 : 3, opacity: st ? 0.85 : 0.9 }).addTo(layer);
    const lab = (st ? `Street ${no[i]}${st.width ? " · " + st.width + " m" : ""} · ` : "") + `${f1(lens[i])} m`;
    line.bindTooltip(lab, { permanent: true, direction: "center", className: "st-edge-lab" + (st ? " st" : "") });
    if (CAN) {
      line.on("click", (ev) => { L.DomEvent.stop(ev); if (drawing) return; toggleStreet(i); });
      line.on("mouseover", () => line.setStyle({ weight: st ? 10 : 6 }));
      line.on("mouseout", () => line.setStyle({ weight: st ? 8 : 3 }));
    }
  });
  if (CAN && !drawing) s.pts.forEach((p, i) => {
    const m = L.marker(p, { draggable: true, icon: L.divIcon({ className: "st-vx", iconSize: [14, 14] }), title: "Drag to move this corner; right-click to remove it" }).addTo(layer);
    m.on("drag", (ev) => { const ll = ev.target.getLatLng(); s.pts[i] = [ll.lat, ll.lng]; drawLight(); });
    m.on("dragend", () => { draw(); panel(); save(); });
    m.on("contextmenu", (ev) => { L.DomEvent.stop(ev); if (s.pts.length <= 3) return toast("A site needs three corners at least", true); removeCorner(i); });
  });
  // a corner can be added on the middle of each edge
  if (CAN && !drawing) s.pts.forEach((p, i) => {
    const q = s.pts[(i + 1) % s.pts.length];
    const m = L.marker([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], { icon: L.divIcon({ className: "st-mid", iconSize: [10, 10] }), title: "Click to add a corner here" }).addTo(layer);
    m.on("click", (ev) => { L.DomEvent.stop(ev); addCorner(i); });
  });
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
  if (st) s.streets[i + 1] = Object.assign({}, st); // both halves stay on the street
  changed();
}
function removeCorner(i) {
  const s = study(), n = s.pts.length;
  s.pts.splice(i, 1);
  // the edges either side (i-1 and i) become one: it keeps the street of either
  const prev = (i - 1 + n) % n, keep = s.streets[prev] || s.streets[i];
  shiftStreets((k) => (k === i ? null : k > i ? k - 1 : k));
  const np = (i - 1 + n - 1) % (n - 1);
  if (keep) s.streets[np] = keep; else delete s.streets[np];
  changed();
}
function toggleStreet(i) {
  const s = study();
  if (s.streets[i]) delete s.streets[i];
  else s.streets[i] = { width: "" };
  changed();
  if (s.streets[i]) setTimeout(() => { const el = $(`#st-panel input[data-sw="${i}"]`); el && el.focus(); }, 30);
}
function changed() { if (light) { light.remove(); light = null; } draw(); panel(); save(); }

/* ---------- drawing a new boundary */
let rubber = null;
function startDraw() {
  if (!CAN) return;
  const s = study();
  lastPts = { pts: s.pts.slice(), streets: Object.assign({}, s.streets) };
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
    else { s.pts = clean; s.streets = {}; if (s.target > 0) matchArea(true); hint("Click an edge to mark it as a street. Drag a corner to move it.", 6000); }
  } else hint("", 0);
  draw(); panel(); tools(); save();
}
function startRect() {
  const s = study(), a = s.target > 0 ? s.target : 1000, c = map.getCenter();
  lastPts = { pts: s.pts.slice(), streets: Object.assign({}, s.streets) };
  s.pts = S.rectangle([c.lat, c.lng], a);
  s.streets = {};
  changed();
  fit();
  hint(`A rectangle of ${f1(a)} m² in the middle of the map: drag its corners onto the site, then Match area.`, 7000);
}
function matchArea(quiet) {
  const s = study();
  if (!(s.target > 0)) return toast("Give the site area to match first", true);
  if (s.pts.length < 3) return toast("Draw the boundary first", true);
  const r = S.scaleTo(s.pts, s.target);
  s.pts = r.pts; s.factor = r.factor;
  if (!quiet) { changed(); hint(`Scaled ×${r.factor.toFixed(4)} about its centre: the boundary is now ${f1(s.target)} m².`, 6000); }
}
function undoShape() {
  if (!lastPts) return;
  const s = study(), now = { pts: s.pts.slice(), streets: Object.assign({}, s.streets) };
  s.pts = lastPts.pts; s.streets = lastPts.streets; lastPts = now;
  changed();
}
function clearAll() {
  const s = study();
  if (!s.pts.length) return;
  if (!confirm("Clear the site boundary and its streets for everyone on this project?")) return;
  lastPts = { pts: s.pts.slice(), streets: Object.assign({}, s.streets) };
  s.pts = []; s.streets = {}; s.factor = null;
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
  el.innerHTML = drawing
    ? `<button type="button" class="primary" data-t="finish"${drawing.length < 3 ? " disabled" : ""}>Finish</button><button type="button" data-t="back"${drawing.length ? "" : " disabled"}>Undo corner</button><button type="button" data-t="cancel">Cancel</button>`
    : `<button type="button" class="primary" data-t="draw" title="Click the site's corners on the map">✎ Draw boundary</button>
       <button type="button" data-t="rect" title="A rectangle of the site area, to drag onto the site">▭ Rectangle</button>
       <button type="button" data-t="match"${s.pts.length >= 3 && s.target > 0 ? "" : " disabled"} title="Scale the boundary about its centre to the site area">⤢ Match area</button>
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
  });
  L_.DomEvent.disableClickPropagation($("#st-tools"));
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && drawing) finishDraw(true);
    if (ev.key === "Enter" && drawing && drawing.length >= 3 && !ev.target.closest("input")) finishDraw();
  });
}

/* ---------- the panel */
function streetsList(s) {
  return Object.entries(s.streets).map(([k, v]) => ({ edge: +k, width: v && v.width !== "" && v.width != null ? Number(v.width) : "" }));
}
/* each street edge's street number: pieces of one street share it */
function streetNos(s) {
  const edges = Object.keys(s.streets).map(Number).sort((a, b) => a - b), n = s.pts.length;
  // as siteClass, but every marked edge (whatever its width) is named
  const all = S.siteClass(n, edges.map((e) => ({ edge: e, width: 99 })), s.pts).streetOf || {};
  const map = {}, out = {}; let k = 0;
  for (const e of edges) { const g = all[e]; if (map[g] == null) map[g] = ++k; out[e] = map[g]; }
  return out;
}
function panel(light) {
  const s = study(), el = $("#st-panel");
  const a = S.area(s.pts), n = s.pts.length, lens = S.edges(s.pts);
  const cls = n >= 3 ? S.siteClass(n, streetsList(s), s.pts) : null;
  const diff = s.target > 0 && n >= 3 ? a - s.target : null;
  const dis = CAN ? "" : " disabled";
  const ok = diff != null && Math.abs(diff) < 0.05;
  const res = n >= 3 ? `<div class="st-bigs">
      <div class="st-big"><small>Boundary area</small><b>${f3(a)}</b><i>m²</i>${diff != null ? `<span class="${ok ? "good" : "warn"}">${ok ? "matches the site area" : (diff > 0 ? "+" : "") + f3(diff) + " m² from the site area"}</span>` : ""}</div>
      <div class="st-big"><small>Class of site</small><b>${cls.cls}</b><span>${esc(cls.why)}</span></div>
      <div class="st-big"><small>Perimeter</small><b>${f1(S.perimeter(s.pts))}</b><i>m</i><span>${n} corners${s.factor && Math.abs(s.factor - 1) > 1e-6 ? ` · last scaled ×${s.factor.toFixed(4)}` : ""}</span></div>
    </div>` : `<p class="st-need">${CAN ? "Find the site on the map, then <b>Draw boundary</b> (click its corners) or start from a <b>Rectangle</b> of the site area." : "No site boundary yet."}</p>`;
  if (light) { const r = $("#st-res", el); if (r) r.innerHTML = res; return; }
  const no = n >= 3 ? streetNos(s) : {};
  const rows = n >= 3 ? s.pts.map((p, i) => {
    const st = s.streets[i];
    return `<tr class="${st ? "st-on" : ""}"><td>${i + 1}–${(i + 1) % n + 1}</td><td class="num">${f1(lens[i])}</td>
      <td><label class="st-chk"><input type="checkbox" data-se="${i}"${st ? " checked" : ""}${dis}> ${st ? "Street " + no[i] : "Street"}</label></td>
      <td>${st ? `<input type="number" step="0.1" min="0" data-sw="${i}" value="${esc(st.width)}" placeholder="width"${dis}> m${st.width !== "" && st.width != null && +st.width < S.STREET_MIN ? ` <em class="warn" title="Under ${S.STREET_MIN} m: not a specified street for the class of site">&lt; ${S.STREET_MIN} m</em>` : ""}` : ""}</td></tr>`;
  }).join("") : "";
  el.innerHTML = `
    <section class="st-card">
      <div class="st-head"><b>1 · The site</b><span class="muted" id="st-saved">${CAN ? "Saved with the project" : "View only"}</span></div>
      <label class="st-f">Site name / lot<input data-sf="name" value="${esc(s.name || "")}" placeholder="e.g. TKO Area 137, STTL 618"${dis}></label>
      <label class="st-f">Site area to match (m²)<input type="number" step="any" min="0" data-sf="target" value="${esc(s.target || "")}" placeholder="from the lease / survey"${dis}></label>
      <div id="st-res">${res}</div>
    </section>
    ${n >= 3 ? `<section class="st-card">
      <div class="st-head"><b>2 · Edges and streets</b><span class="muted">click an edge on the map, or tick it here</span></div>
      <table class="st-edges"><thead><tr><th>Edge</th><th class="num">Length m</th><th>Abuts</th><th>Street width</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted st-note">B(P)R reg. 2: class B is a corner site on two specified streets, class C on three. A street under ${S.STREET_MIN} m wide does not count. The street widths also go to the GBP workbook later (height and site coverage by street width come in phase 2).</p>
    </section>` : ""}
    <section class="st-card">
      <div class="st-head"><b>3 · GBP workbook</b></div>
      <p class="muted st-note">Puts the site area${n >= 3 ? ` (${f3(s.target > 0 && ok ? s.target : a)} m²)` : ""} and the class of site${cls ? ` (${cls.cls})` : ""} into the workbook's step 1, for everyone on the project.</p>
      <div class="st-row"><button type="button" class="primary" id="st-send"${n >= 3 && CAN ? "" : " disabled"}>Send to GBP workbook</button>
      <a class="st-link" id="st-open" href="codes.html?${new URLSearchParams({ project: project(), tab: "gbp", sec: "site" })}">Open GBP workbook ›</a></div>
      ${sentNote()}
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
    else if (t.dataset.se != null) toggleStreet(+t.dataset.se);
    else if (t.dataset.sw != null) { const i = +t.dataset.sw; if (s.streets[i]) s.streets[i].width = t.value === "" ? "" : Math.max(0, parseFloat(t.value)); changed(); }
  });
  el.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches("input")) ev.target.blur(); });
  el.addEventListener("click", (ev) => {
    if (ev.target.id !== "st-send") return;
    const s = study(), a = S.area(s.pts), cls = S.siteClass(s.pts.length, streetsList(s), s.pts);
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
  };
  $("#st-find").addEventListener("submit", go);
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
  document.body.classList.toggle("st-ro", !CAN);
  const s = study();
  if (s.pts.length >= 3) fit();
  else if (s.view && s.view.c) map.setView(s.view.c, s.view.z || 16);
  draw(); panel(); tools();
  window.__site = { study, S }; // for the tests
})();
