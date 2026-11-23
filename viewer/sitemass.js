/* Site study, phase 2: Massing - the blocks on the site, their floor groups,
 * the live figures against the governing limits, the refuge floors, the
 * footprints on the map and the 3D view. Kept in study.massing with the
 * project. The figures are massingcore.js's.
 */
import * as S from "./sitecore.js";
import * as M from "./massingcore.js";
import { toast } from "./tasks-util.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f0 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { maximumFractionDigits: 0 }));
const f1 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const f2 = (x) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

let C = null, layer = null, ON = false, VIEW = "plan", T3 = null, SEL = null;

export function init(ctx) {
  C = ctx;
  layer = C.L.layerGroup();
  $("#st-mpanel").addEventListener("change", onChange);
  $("#st-mpanel").addEventListener("click", onClick);
  $("#st-mpanel").addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches("input")) ev.target.blur(); });
  $("#st-views").addEventListener("click", (ev) => { const b = ev.target.closest("[data-v]"); if (b) setView(b.dataset.v); });
  window.addEventListener("resize", () => T3 && T3.resize());
}

function mass() {
  const s = C.study();
  s.massing = s.massing && typeof s.massing === "object" ? s.massing : {};
  const m = s.massing;
  m.blocks = Array.isArray(m.blocks) ? m.blocks : [];
  return m;
}
const origin = () => { const s = C.study(); return s.pts.length >= 3 ? S.centroid(s.pts) : null; };
/* the model in metres for massingcore */
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
  if (on) { layer.addTo(C.map()); render(); } else { layer.remove(); setView("plan"); }
}
export function refresh() { if (ON) render(); }

function setView(v) {
  VIEW = v;
  for (const b of document.querySelectorAll("#st-views [data-v]")) b.classList.toggle("on", b.dataset.v === v);
  $("#st-3d").hidden = v !== "3d";
  if (v === "3d") draw3d();
}

/* ---------- the panel */
function render() {
  if (!ON) return;
  const s = C.study(), m = mass(), can = C.can(), dis = can ? "" : " disabled";
  const A = C.siteArea(), pot = C.potential();
  const f = M.figures(model(), A, s.plan && s.plan.level, m.uc6);
  const rows = M.against(f, pot);
  const bar = (r) => {
    if (r.value == null) return `<div class="ms-row"><span>${r.label}</span><b>–</b></div>`;
    const pct = r.limit ? Math.min(100, r.value / r.limit * 100) : 0;
    const v = r.unit === "m²" ? f0(r.value) : r.unit === "%" ? f1(r.value) : r.unit === "mPD" ? f1(r.value) : String(r.value);
    const l = r.limit == null ? "" : r.unit === "m²" ? f0(r.limit) : r.unit === "%" || r.unit === "mPD" ? f1(r.limit) : String(r.limit);
    return `<div class="ms-row ${r.status}"><span>${r.label}</span><b>${v}${r.unit ? ` <small>${r.unit}</small>` : ""}</b><em>${r.limit != null ? `/ ${l} · ${esc(r.by)}${r.status === "over" ? " · over by " + (r.unit === "m²" ? f0(r.value - r.limit) : f1(r.value - r.limit)) : ""}` : "no limit given"}</em>${r.limit ? `<i><u style="width:${pct}%"></u></i>` : ""}</div>`;
  };
  const ref = f.buildings.map((b) => {
    const r = b.refuge, name = esc(b.top.name || "Building");
    const cls = r.need === "none" ? "good" : r.ok ? "good" : "bad";
    return `<p class="ms-ref ${cls}"><b>${name}</b>: ${esc(r.why)}${r.due.length ? `. <b>Refuge floor needed at storey ${r.due.join(", ")}</b> (the ${r.due.map((n) => n - 1 + "/F").join(", ")} counting G/F as storey 1)` : ""}${r.placed.length ? ` · placed at storey ${r.placed.join(", ")}` : ""}.</p>`;
  }).join("") || `<p class="muted st-note">Add a block to see the refuge floors.</p>`;
  const blocks = m.blocks.map((b, bi) => blockCard(b, bi, m, dis)).join("");
  const noSite = s.pts.length < 3;
  $("#st-mpanel").innerHTML = `
    <section class="st-card">
      <div class="st-head"><b>Massing</b><span class="muted" id="ms-saved">${can ? "Saved with the project" : "View only"}</span></div>
      ${noSite ? `<p class="st-need">Draw the site boundary first (Site).</p>` : ""}
      <div class="ms-sum">${rows.map(bar).join("")}
        <div class="ms-row"><span>Plot ratio</span><b>${f2(f.pr)}</b><em>domestic ${f2(f.dpr)} · non-domestic ${f2(f.npr)}</em></div>
        <div class="ms-row"><span>Height</span><b>${f1(f.height)} <small>m</small></b><em>${f.mpd == null ? "give the site level (Site, card 3) for mPD" : "from " + f1(Number(s.plan.level)) + " mPD"}</em></div>
        <div class="ms-row"><span>Concessions</span><b>${f0(f.conc)} <small>m²</small></b><em>${f.gfa ? `${f1(f.conc / (f.gfa + f.conc) * 100)}% of the GFA before them - check the 10% cap items in the GBP workbook step 4` : ""}</em></div>
      </div>
    </section>
    <section class="st-card">
      <div class="st-head"><b>Refuge floors</b><label class="st-chk"><input type="checkbox" data-mf="uc6"${m.uc6 ? " checked" : ""}${dis}> Use Classification 6</label></div>
      ${ref}
      <p class="muted st-note">${esc(M.REFUGE.src)}: over ${M.REFUGE.over} storeys above the lowest ground storey - not over ${M.REFUGE.roofUpTo}, a refuge on the roof may do; otherwise refuge floors not more than ${M.REFUGE.every} storeys apart (${M.REFUGE.everyUc6} for UC 6); the refuge floor is not counted, plant storeys are.</p>
    </section>
    ${blocks}
    ${can && !noSite ? `<div class="st-row ms-add"><button type="button" class="primary" data-ma="podium">+ Podium</button><button type="button" class="ghost" data-ma="tower">+ Tower</button><button type="button" class="ghost" data-ma="example">Example: podium + tower</button></div>` : ""}
    <section class="st-card">
      <div class="st-head"><b>Export</b></div>
      <div class="st-row"><button type="button" class="ghost" data-mx="obj"${m.blocks.length ? "" : " disabled"}>OBJ (3D)</button><button type="button" class="ghost" data-mx="png">PNG of the 3D view</button><button type="button" class="ghost" data-mx="gbp"${can && f.gfa ? "" : " disabled"}>Send GFA and height to GBP workbook</button></div>
    </section>`;
  drawPlan();
  if (VIEW === "3d") draw3d();
}

function blockCard(b, bi, m, dis) {
  const o = origin(), a = o && b.fp && b.fp.length >= 3 ? S.area(b.fp) : 0;
  const others = m.blocks.filter((x) => x.id !== b.id);
  const useOpt = (cur) => Object.entries(M.USES).map(([k, u]) => `<option value="${k}"${k === cur ? " selected" : ""}>${u.label}</option>`).join("");
  const n = (b.groups || []).reduce((s2, g) => s2 + (Number(g.n) || 0), 0);
  const h = (b.groups || []).reduce((s2, g) => s2 + (Number(g.n) || 0) * (Number(g.h) || 0), 0);
  const gr = (b.groups || []).map((g, gi) => `<tr>
      <td><select data-g="${bi}.${gi}.use"${dis}>${useOpt(g.use)}</select></td>
      <td><input type="number" min="0" step="1" data-g="${bi}.${gi}.n" value="${esc(g.n)}"${dis}></td>
      <td><input type="number" min="0" step="0.05" data-g="${bi}.${gi}.h" value="${esc(g.h)}"${dis}></td>
      <td><input type="number" min="0" max="100" step="1" data-g="${bi}.${gi}.acc" value="${esc(g.acc == null ? "" : g.acc)}" placeholder="${(M.USES[g.use] || M.USES.dom).acc}"${dis}></td>
      <td><input type="number" min="0" step="1" data-g="${bi}.${gi}.conc" value="${esc(g.conc == null ? "" : g.conc)}" placeholder="0"${dis}></td>
      <td class="nw">${dis ? "" : `<button type="button" class="ghost st-ib" data-gup="${bi}.${gi}" title="Move down (earlier)">↓</button><button type="button" class="ghost st-ib" data-gdel="${bi}.${gi}" title="Remove">×</button>`}</td></tr>`).join("");
  return `<section class="st-card ms-block${SEL === b.id ? " sel" : ""}" data-bid="${b.id}">
    <div class="st-head"><input class="ms-name" data-b="${bi}.name" value="${esc(b.name || "")}"${dis}><span class="muted">${f0(a)} m² · ${n} storeys · ${f1(h)} m</span></div>
    <div class="ms-fp">
      <label>On <select data-b="${bi}.on"${dis}><option value="">the ground</option>${others.map((x) => `<option value="${x.id}"${b.on === x.id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
      ${dis ? "" : `<span>Footprint: <button type="button" class="ghost st-ib" data-fp="${bi}.site" title="The site boundary set back by the distance">site −</button><input type="number" min="0" step="0.5" data-fpset="${bi}" value="${esc(b.setback == null ? 3 : b.setback)}"> m <button type="button" class="ghost st-ib" data-fp="${bi}.rect" title="A rectangle of this area in the middle of the site">▭</button><input type="number" min="1" step="10" data-fparea="${bi}" value="${esc(b.rectArea || Math.round(a) || 600)}"> m²</span>`}
    </div>
    <table class="ms-groups"><thead><tr><th>Use</th><th>Storeys</th><th>Height m</th><th title="The share of the floor area counted as GFA">GFA %</th><th title="GFA concessions per storey (balconies, utility platforms, ...)">Conc. m²/fl</th><th></th></tr></thead><tbody>${gr}</tbody></table>
    ${dis ? "" : `<div class="st-row"><button type="button" class="ghost st-ib" data-gadd="${bi}">+ Floors above</button><button type="button" class="ghost st-ib" data-bdup="${bi}">Duplicate block</button><button type="button" class="ghost st-ib" data-bdel="${bi}">Remove block</button></div>`}
  </section>`;
}

function changed() { C.save(); render(); }

function onChange(ev) {
  const t = ev.target, m = mass();
  if (t.dataset.mf === "uc6") { m.uc6 = t.checked; return changed(); }
  if (t.dataset.b) { const [bi, k] = t.dataset.b.split("."); m.blocks[+bi][k] = t.value; return changed(); }
  if (t.dataset.g) {
    const [bi, gi, k] = t.dataset.g.split("."), g = m.blocks[+bi].groups[+gi];
    g[k] = k === "use" ? t.value : t.value === "" ? (k === "acc" || k === "conc" ? null : 0) : Math.max(0, parseFloat(t.value));
    if (k === "use") g.acc = null;
    return changed();
  }
  if (t.dataset.fpset != null) { m.blocks[+t.dataset.fpset].setback = Math.max(0, parseFloat(t.value) || 0); C.save(); }
  if (t.dataset.fparea != null) { m.blocks[+t.dataset.fparea].rectArea = Math.max(1, parseFloat(t.value) || 600); C.save(); }
}

function footprint(kind, b) {
  const s = C.study(), o = origin();
  if (!o) return;
  if (kind === "site") b.fp = S.fromXY(M.inset(S.toXY(s.pts, o), b.setback == null ? 3 : b.setback), o);
  else {
    const base = b.on ? mass().blocks.find((x) => x.id === b.on) : null;
    const c = base && base.fp && base.fp.length >= 3 ? S.toXY([S.centroid(base.fp)], o)[0] : [0, 0];
    b.fp = S.fromXY(M.rect(c, b.rectArea || 600), o);
  }
}

function onClick(ev) {
  const t = ev.target.closest("button") || ev.target, m = mass(), d = t.dataset || {};
  const card = ev.target.closest(".ms-block");
  if (card && SEL !== card.dataset.bid && !ev.target.closest("button,input,select")) { SEL = card.dataset.bid; render(); return; }
  if (d.ma) {
    if (d.ma === "example") {
      const p = { id: uid(), name: "Podium", setback: 3, groups: [{ use: "lobby", n: 1, h: 6 }, { use: "car", n: 2, h: 4.5 }, { use: "club", n: 1, h: 5 }] };
      footprint("site", p);
      const t2 = { id: uid(), name: "Tower 1", on: p.id, rectArea: 700, groups: [{ use: "dom", n: 21, h: 3.15, conc: 30 }, { use: "refuge", n: 1, h: 4.5 }, { use: "dom", n: 18, h: 3.15, conc: 30 }] };
      footprint("rect", t2);
      m.blocks.push(p, t2); SEL = t2.id;
    } else {
      const pod = d.ma === "podium";
      const base = pod ? null : m.blocks.find((x) => !x.on);
      const b = pod ? { id: uid(), name: "Podium " + (m.blocks.filter((x) => !x.on).length + 1), setback: 3, groups: [{ use: "lobby", n: 1, h: 6 }, { use: "non", n: 2, h: 5 }] }
        : { id: uid(), name: "Tower " + (m.blocks.filter((x) => x.on).length + 1), on: base ? base.id : "", rectArea: 600, groups: [{ use: "dom", n: 20, h: 3.15 }] };
      footprint(pod ? "site" : "rect", b);
      m.blocks.push(b); SEL = b.id;
    }
    return changed();
  }
  if (d.fp) { const [bi, k] = d.fp.split("."); footprint(k, m.blocks[+bi]); return changed(); }
  if (d.gadd != null) { const b = m.blocks[+d.gadd], last = (b.groups || []).slice(-1)[0]; (b.groups = b.groups || []).push(last ? Object.assign({}, last) : { use: "dom", n: 1, h: 3.15 }); return changed(); }
  if (d.gdel) { const [bi, gi] = d.gdel.split(".").map(Number); m.blocks[bi].groups.splice(gi, 1); return changed(); }
  if (d.gup) { const [bi, gi] = d.gup.split(".").map(Number), g = m.blocks[bi].groups; if (gi > 0) [g[gi - 1], g[gi]] = [g[gi], g[gi - 1]]; return changed(); }
  if (d.bdup != null) { const b = JSON.parse(JSON.stringify(m.blocks[+d.bdup])); b.id = uid(); b.name += " (copy)"; const o = origin(); if (o) b.fp = S.fromXY(S.toXY(b.fp, o).map(([x, y]) => [x + 10, y - 10]), o); m.blocks.push(b); SEL = b.id; return changed(); }
  if (d.bdel != null) {
    const b = m.blocks[+d.bdel];
    if (!confirm(`Remove ${b.name || "this block"}?`)) return;
    for (const x of m.blocks) if (x.on === b.id) x.on = b.on || "";
    m.blocks.splice(+d.bdel, 1); return changed();
  }
  if (d.mx === "obj") return download(M.toObj(model(), C.study().plan && C.study().plan.level), "massing.obj", "text/plain");
  if (d.mx === "png") { setView("3d"); setTimeout(() => { if (T3) { const a = document.createElement("a"); a.href = T3.png(); a.download = "massing.png"; a.click(); } }, 400); return; }
  if (d.mx === "gbp") {
    const s = C.study(), f = M.figures(model(), C.siteArea(), s.plan && s.plan.level, m.uc6);
    C.sendToWorkbook({ gfaTotal: +f.gfa.toFixed(3), height: +f.height.toFixed(3) });
    toast(`Sent: total GFA ${f0(f.gfa)} m², height ${f1(f.height)} m`);
  }
}
function download(text, name, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- the footprints on the map: drag a corner, or the middle to move */
function drawPlan() {
  const L = C.L, m = mass(), can = C.can();
  layer.clearLayers();
  for (const b of m.blocks) {
    if (!b.fp || b.fp.length < 3) continue;
    const top = (b.groups || []).slice(-1)[0], col = (M.USES[(top && top.use) || "dom"] || M.USES.dom).color;
    const sel = SEL === b.id;
    const pg = L.polygon(b.fp, { color: sel ? "#d1660e" : col, weight: sel ? 3 : 2, fillColor: col, fillOpacity: b.on ? 0.55 : 0.35 }).addTo(layer);
    pg.bindTooltip(`${esc(b.name)} · ${f0(S.area(b.fp))} m²`, { direction: "center", className: "st-edge-lab" });
    pg.on("click", () => { SEL = b.id; render(); });
    if (!can || !sel) continue;
    b.fp.forEach((p, i) => {
      const mk = L.marker(p, { draggable: true, icon: L.divIcon({ className: "st-vx ms-vx", iconSize: [12, 12] }) }).addTo(layer);
      mk.on("drag", (ev) => { const ll = ev.target.getLatLng(); b.fp[i] = [ll.lat, ll.lng]; pg.setLatLngs(b.fp); });
      mk.on("dragend", () => changed());
    });
    const c = S.centroid(b.fp);
    const mv = L.marker(c, { draggable: true, icon: L.divIcon({ className: "ms-move", html: "✥", iconSize: [22, 22] }), title: "Drag to move the block" }).addTo(layer);
    let from = null, orig = null;
    mv.on("dragstart", () => { from = c; orig = b.fp.map((q) => q.slice()); });
    mv.on("drag", (ev) => { const ll = ev.target.getLatLng(), dl = ll.lat - from[0], dg = ll.lng - from[1]; b.fp = orig.map(([a, g]) => [a + dl, g + dg]); pg.setLatLngs(b.fp); });
    mv.on("dragend", () => changed());
  }
}

/* ---------- 3D */
async function draw3d() {
  if (!T3) {
    const V = await import("./vendor/three-fragments.js");
    T3 = makeScene(V.THREE, V.OrbitControls, $("#st-3d"));
  }
  T3.build(model(), C.study(), mass());
}
function makeScene(THREE, Orbit, host) {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  host.appendChild(r.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef1f4);
  const cam = new THREE.PerspectiveCamera(40, 1, 1, 20000);
  cam.up.set(0, 0, 1);
  const ctl = new Orbit(cam, r.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-300, -400, 600); scene.add(sun);
  let group = null, first = true;
  const resize = () => { const w = host.clientWidth || 800, h = host.clientHeight || 600; r.setSize(w, h, false); r.domElement.style.width = "100%"; r.domElement.style.height = "100%"; cam.aspect = w / h; cam.updateProjectionMatrix(); };
  const loop = () => { if (!host.hidden) { ctl.update(); r.render(scene, cam); } requestAnimationFrame(loop); };
  const shape = (xy) => { const sh = new THREE.Shape(); xy.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y))); sh.closePath(); return sh; };
  const build = (mdl, s, m) => {
    resize();
    if (group) { scene.remove(group); group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    group = new THREE.Group();
    const o = s.pts.length >= 3 ? S.centroid(s.pts) : null;
    if (o) {
      const site = new THREE.Mesh(new THREE.ShapeGeometry(shape(S.toXY(s.pts, o))), new THREE.MeshBasicMaterial({ color: 0xe85d8a, transparent: true, opacity: 0.35 }));
      group.add(site);
      const lens = S.edges(s.pts), xy = S.toXY(s.pts, o);
      for (const [e] of Object.entries(s.streets || {})) {
        const a = xy[+e], b = xy[(+e + 1) % xy.length]; if (!a || !b) continue;
        const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a[0], a[1], 0.1), new THREE.Vector3(b[0], b[1], 0.1)]);
        group.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xf28022 })));
        void lens;
      }
    }
    const st = M.stacks(mdl), bs = M.buildings(mdl);
    let zmax = 10, span = 50;
    for (const x of st) {
      if (x.block.fp.length < 3) continue;
      const sh = shape(x.block.fp);
      for (const p of x.block.fp) span = Math.max(span, Math.hypot(p[0], p[1]));
      for (const sto of x.storeys) {
        const u = M.USES[sto.use] || M.USES.dom;
        const geo = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.05, sto.h - 0.15), bevelEnabled: false });
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: new THREE.Color(u.color), transparent: sto.use === "void", opacity: sto.use === "void" ? 0.4 : 1 }));
        mesh.position.z = sto.z0;
        group.add(mesh);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.35 }));
        edges.position.z = sto.z0; group.add(edges);
        zmax = Math.max(zmax, sto.z1);
      }
    }
    // the refuge floors due, as a green ghost band
    for (const b of bs) {
      const r = M.refuge(b.storeys, m.uc6);
      for (const no of r.due) {
        const sto = b.storeys.find((x) => x.no === no); if (!sto) continue;
        const blk = st.find((x) => x.block.id === sto.block);
        const geo = new THREE.ExtrudeGeometry(shape(blk.block.fp.map(([x, y]) => [x * 1.08, y * 1.08])), { depth: sto.h, bevelEnabled: false });
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x2ea043, transparent: true, opacity: 0.35, depthWrite: false }));
        mesh.position.z = sto.z0; group.add(mesh);
      }
    }
    scene.add(group);
    if (first) { cam.position.set(-span * 2.2, -span * 2.6, zmax * 1.1 + span); ctl.target.set(0, 0, zmax / 3); first = false; }
    ctl.update();
  };
  resize(); loop();
  return { build, resize, png: () => { r.render(scene, cam); return r.domElement.toDataURL("image/png"); } };
}
