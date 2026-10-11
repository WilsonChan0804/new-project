/* Headroom on the 3D page (Checks > Headroom).
 *
 * Probe: click a floor, a stair tread or a landing; a line goes straight up
 * to the first thing above and its length is shown (and can be kept as a
 * dimension for everyone).
 *
 * Scan: on one floor (or inside the section box, or the whole model) the
 * floors, stairs, landings and ramps are sampled on a grid, and the clear
 * height above each point is measured to what hangs overhead - slabs,
 * ceilings, beams, stairs above, ducts, pipes, cable trays, equipment and
 * fittings, in the models chosen (the consultants' too). Points under the
 * limit are coloured red (amber: within 100 mm over it) and joined into
 * zones; each zone can be looked at and made an issue.
 *
 * Measured vertically from where people stand; a stair's headroom is read
 * from its treads. What the viewer draws is what is measured.
 */
import { createGeo, catLabel, scopePicker } from "./checkgeo.js";
import { saveCsv, fileName, reportTab, tabSay, writeReport, pictures } from "./checkexport.js";
import { dueIn, nextNumber, numberText, elementLine, xyzText } from "./checkissue.js";

const WALK = /^(Floors|Stairs|Runs|Landings|Ramps|IFCSLAB|IFCSTAIR|IFCSTAIRFLIGHT|IFCRAMP|IFCRAMPFLIGHT)$/;
const STAIRISH = /stair|runs|landing|ramp/i;
const ABOVE = new RegExp("^(Floors|Roofs|Roof Soffits|Ceilings|Structural Framing|Stairs|Runs|Landings|Ramps"
  + "|Ducts|Duct Fittings|Duct Accessories|Flex Ducts|Pipes|Pipe Fittings|Pipe Accessories|Flex Pipes"
  + "|Cable Trays|Cable Tray Fittings|Conduits|Conduit Fittings|Mechanical Equipment|Lighting Fixtures|Air Terminals|Sprinklers"
  + "|IFCSLAB|IFCROOF|IFCCOVERING|IFCBEAM|IFCSTAIR|IFCSTAIRFLIGHT|IFCRAMP|IFCRAMPFLIGHT|IFCFLOWSEGMENT|IFCFLOWFITTING|IFCFLOWTERMINAL"
  + "|IFCDUCTSEGMENT|IFCDUCTFITTING|IFCPIPESEGMENT|IFCPIPEFITTING|IFCCABLECARRIERSEGMENT|IFCCABLECARRIERFITTING|IFCAIRTERMINAL"
  + "|IFCLIGHTFIXTURE|IFCENERGYCONVERSIONDEVICE|IFCUNITARYEQUIPMENT|IFCFLOWMOVINGDEVICE|IFCFLOWCONTROLLER|IFCDUCTSILENCER"
  + "|IFCFIRESUPPRESSIONTERMINAL)$");
const MAX_TRIS = 6e6;            // triangles sent to one scan
const CFG_ID = "checkcfg-headroom"; // the project's headroom settings (one item, shared)
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function createHeadroom(ctx) {
  const { THREE } = ctx;
  const box = document.getElementById("head-box");
  if (!box) return null;
  const geo = createGeo(ctx);
  const H = { probe: null, dots: null, zones: [], walk: [], above: [], running: false, stop: false, worker: null, res: null,
              live: null /* this scan */, view: "" /* "" this scan, else a saved result's id */, filter: "open" };
  const isSaved = (it) => it && it.placement === "headroomresult" && !it.deleted;
  const saved = () => (ctx.items() || []).filter(isSaved).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const issueOf = (key) => (ctx.items() || []).find((it) => it.headroom && it.headroom.key === key && !it.deleted) || null;
  const lsKey = (k) => ctx.storeKey("head:" + k);
  const lsGet = (k, d) => { try { const v = localStorage.getItem(lsKey(k)); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(lsKey(k), JSON.stringify(v)); } catch (e) {} };

  box.innerHTML = `
    <div class="chk-row"><button id="head-probe" class="ghost" title="Click a floor, a stair tread or a landing: the clear height above it">Probe</button>
      <span class="muted head-hint">a click on a floor or a tread: the height to what is above</span></div>
    <div class="head-lims">
      <label title="Clear height wanted over floors">Floors <input id="head-lim" type="number" min="1" max="6" step="0.05"> m</label>
      <label title="Clear height wanted over stair treads, landings and ramps">Stairs, ramps <input id="head-lim-st" type="number" min="1" max="6" step="0.05"> m</label>
      <label title="Lower than this is not a space people use - under a WC or a bench, in a duct or a ceiling void, where a stair runs in under the floor above: not reported">Ignore lower than <input id="head-min" type="number" min="0" max="3" step="0.1"> m</label>
    </div>
    <details class="head-models"><summary>Models counted</summary><div id="head-mlist"></div></details>
    <details class="head-models head-cats"><summary>What counts</summary>
      <div class="head-cat-cols"><div><b>Stood on</b><div id="head-walk"></div></div><div><b>Overhead</b><div id="head-above"></div></div></div>
      <button class="ghost" id="head-cat-reset" type="button" title="Back to the usual categories">Usual categories</button>
    </details>
    <div class="head-shared muted">Settings shared with the project</div>
    <div class="chk-row">
      <select id="head-scope" title="Where to scan" aria-label="Where to scan"><option value="all">Whole model</option><option value="floors">Floors</option><option value="box">Inside the section box</option></select>
      <button id="head-run" class="primary" title="Measure the clear height all over">Scan</button>
      <button id="head-stop" class="ghost" hidden>Stop</button>
    </div>
    <div class="chk-row ck-fr" id="head-fr" hidden>
      <span class="muted">from</span><select id="head-from" aria-label="From floor"></select>
      <span class="muted">to</span><select id="head-to" aria-label="To floor"></select>
    </div>
    <div id="head-prog" class="chk-prog" hidden><span></span></div>
    <div id="head-dim"></div>
    <div id="head-sum"></div>
    <ul id="head-list" class="clash-list"></ul>`;
  const $ = (s) => box.querySelector(s);
  /* The settings: one item for the project (everyone scans the same way);
     a copy in this browser for someone who can only look. */
  const DEF = { lim: 2.3, limst: 2.0, minSpace: 1.5, off: [], walk: null, above: null };
  function cfg() {
    const it = (ctx.items() || []).find((x) => x.id === CFG_ID && !x.deleted);
    return Object.assign({}, DEF, lsGet("cfg", {}), it && it.cfg ? it.cfg : {});
  }
  let saveT = null;
  function saveCfg(patch) {
    const c = Object.assign(cfg(), patch);
    lsSet("cfg", c);
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      ctx.putItem({ id: CFG_ID, placement: "checkcfg", cfg: c, author: ctx.author(), updated_at: new Date().toISOString() })
        .then((ok) => { $(".head-shared").textContent = ok ? "Settings shared with the project" : "Settings kept in this browser (view only)"; });
    }, 500);
  }
  function showCfg() {
    const c = cfg();
    $("#head-lim").value = c.lim; $("#head-lim-st").value = c.limst; $("#head-min").value = c.minSpace;
  }
  showCfg();
  const limits = () => ({ limit: Math.max(0.5, Number($("#head-lim").value) || 2.3), stairLimit: Math.max(0.5, Number($("#head-lim-st").value) || 2.0),
                          minSpace: Math.max(0, Number($("#head-min").value) || 0) });
  $("#head-lim").onchange = () => { saveCfg({ lim: limits().limit }); paintDots(); };
  $("#head-lim-st").onchange = () => { saveCfg({ limst: limits().stairLimit }); paintDots(); };
  $("#head-min").onchange = () => { saveCfg({ minSpace: limits().minSpace }); };
  const isWalk = (k) => { const c = cfg(); return c.walk ? c.walk.includes(k) : WALK.test(k); };
  const isAbove = (k) => { const c = cfg(); return c.above ? c.above.includes(k) : ABOVE.test(k); };

  // the colours: too low (chosen by each person), within 100 mm over, overhead
  const lowCol = () => lsGet("col", "#e2453c");
  const AMBER = "#f0a020";
  function progress(t) { const p = $("#head-prog"); p.hidden = !t; p.querySelector("span").textContent = t || ""; }

  /* ------------------------------------------------------------ probe */

  function clearProbe() {
    if (!H.probe) return;
    ctx.overlay().remove(H.probe.group);
    H.probe.group.traverse((o) => { if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } if (o.geometry) o.geometry.dispose(); });
    H.probe = null;
    const d = $("#head-dim");
    if (d) d.innerHTML = "";
    ctx.redraw();
  }
  async function probeAt(ev) {
    const found = await ctx.pickAt(ev);
    if (!found || !found.hit || !found.hit.point) { ctx.status("Click a floor, a stair tread or a landing."); return; }
    const p = found.hit.point.clone();
    const up = await ctx.rayHit(p.clone().add(new THREE.Vector3(0, 0.02, 0)), new THREE.Vector3(0, 1, 0), 40);
    clearProbe();
    if (!up || !up.point) { ctx.status("Nothing above this point within 40 m: open to the sky."); return; }
    const q = up.point.clone();
    const h = q.y - p.y;
    const { limit, stairLimit } = limits();
    const verdict = h < stairLimit ? `under the ${stairLimit.toFixed(2)} m stair limit` : h < limit ? `under the ${limit.toFixed(2)} m floor limit (enough for a stair)` : "enough";
    drawDim(p, q, verdict);
    ctx.status(`Clear height ${h.toFixed(3)} m here - ${verdict}. Keep makes it a dimension for everyone; Esc or Probe again to stop.`);
  }
  /* A clear height drawn in the model: a line from where one stands to what
     is overhead, its height on it, and Keep (a dimension for everyone). */
  function drawDim(p, q, verdict) {
    clearProbe();
    const h = q.y - p.y;
    const { limit, stairLimit } = limits();
    const col = h < stairLimit ? 0xe2453c : h < limit ? 0xd97706 : 0x0e9f6e;
    const g = new THREE.Group();
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, q]), new THREE.LineBasicMaterial({ color: col, depthTest: false }));
    line.renderOrder = 996;
    g.add(line);
    for (const v of [p, q]) {
      const tick = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: col, depthTest: false }));
      tick.position.copy(v); tick.renderOrder = 996; g.add(tick);
    }
    const lab = ctx.dimLabel(h.toFixed(3) + " m");
    lab.position.copy(p).add(q).multiplyScalar(0.5);
    g.add(lab);
    g.userData.headDim = h;
    ctx.overlay().add(g);
    H.probe = { group: g, a: p.clone(), b: q.clone(), h };
    ctx.redraw();
    $("#head-dim").innerHTML = `<div class="head-probe-res"><b>${h.toFixed(3)} m</b> <span class="muted">${esc(verdict || "")}</span> <button class="ghost" id="head-keep" title="Keep this height as a dimension in the model, for everyone">Keep</button></div>`;
    $("#head-keep").onclick = async () => {
      if (!H.probe) return;
      await ctx.keepDim(H.probe.a, H.probe.b, "Headroom " + H.probe.h.toFixed(3) + " m");
      clearProbe();
    };
  }
  $("#head-probe").onclick = () => {
    const on = ctx.mode() !== "headroom";
    ctx.setMode(on ? "headroom" : "nav");
    if (!on) clearProbe();
  };

  /* ------------------------------------------------------------- scan */

  const scopeP = scopePicker(ctx, THREE, $("#head-scope"), $("#head-from"), $("#head-to"), $("#head-fr"));
  const fillScope = () => scopeP.fill();
  // the consultant models counted too (loaded when scanning): on unless turned off
  const consOn = () => cfg().cons !== false;
  function fillModels() {
    const off = new Set(cfg().off || []);
    const cons = ctx.consultants() || [];
    const away = cons.filter((c) => !c.loaded);
    $("#head-mlist").innerHTML = (cons.length ? `<label class="row-check" title="Count the consultants' IFC models too - those not loaded here are loaded when you scan"><input type="checkbox" data-cons${consOn() ? " checked" : ""}> <b>Include consultant models</b></label>` : "")
      + (geo.models().map((m) =>
        `<label class="row-check"><input type="checkbox" value="${esc(m.key)}"${off.has(m.key) || (m.rec.ref && !consOn()) ? "" : " checked"}${m.rec.ref && !consOn() ? " disabled" : ""}> ${esc(m.label)}</label>`).join("")
      || '<span class="muted">No model loaded.</span>')
      + (consOn() ? away.map((c) => `<label class="row-check muted"><input type="checkbox" checked disabled> ${esc(c.label)} <span class="muted">(not loaded - loaded when scanning)</span></label>`).join("") : "");
  }
  $("#head-mlist").onchange = (ev) => {
    if (ev.target.matches("[data-cons]")) { saveCfg({ cons: ev.target.checked }); fillModels(); return; }
    saveCfg({ off: [...$("#head-mlist").querySelectorAll("input[value]:not(:checked):not(:disabled)")].map((x) => x.value) });
  };
  $("#head-scope").onfocus = fillScope;
  box.querySelector(".head-models").addEventListener("toggle", fillModels);

  // standing heights looked at: the floors' levels (just under), or all
  function scope() {
    const sc = scopeP.get();
    if (sc.err) return sc;
    if (sc.floors) { sc.yLo = sc.floors[0].lo - 0.4; sc.yHi = sc.floors[sc.floors.length - 1].hi - 0.4; }
    else { sc.yLo = -Infinity; sc.yHi = Infinity; }
    return sc;
  }

  /* What counts: the categories of the models counted, stood on and
     overhead. */
  async function fillCats() {
    const off = new Set(cfg().off || []);
    const names = new Set();
    for (const m of geo.models().filter((x) => !off.has(x.key))) for (const k of (await geo.catsOf(m)).keys()) names.add(k);
    const cats = [...names].sort((x, y) => catLabel(x).localeCompare(catLabel(y)));
    const list = (test, side) => cats.map((k) => `<label><input type="checkbox" data-side="${side}" value="${esc(k)}"${test(k) ? " checked" : ""}> ${esc(catLabel(k))}</label>`).join("")
      || '<span class="muted">No model counted.</span>';
    $("#head-walk").innerHTML = list(isWalk, "walk");
    $("#head-above").innerHTML = list(isAbove, "above");
  }
  box.querySelector(".head-cats").addEventListener("toggle", (ev) => { if (ev.target.open) fillCats(); });
  box.querySelector(".head-cats").addEventListener("change", (ev) => {
    const side = ev.target.dataset && ev.target.dataset.side;
    if (!side) return;
    // every category listed, as ticked (one not listed - a model not loaded - keeps its default)
    const ticked = [...box.querySelectorAll(`#head-${side} input:checked`)].map((x) => x.value);
    const shown = new Set([...box.querySelectorAll(`#head-${side} input`)].map((x) => x.value));
    const was = cfg()[side] || null;
    const keep = was ? was.filter((k) => !shown.has(k)) : [];
    saveCfg({ [side]: [...new Set([...keep, ...ticked])] });
  });
  $("#head-cat-reset").onclick = () => { saveCfg({ walk: null, above: null }); setTimeout(fillCats, 50); };

  function worker() {
    if (H.worker !== null) return H.worker;
    try { H.worker = new Worker(new URL("./head-worker.js", import.meta.url), { type: "module" }); } catch (e) { H.worker = false; }
    return H.worker;
  }
  async function scanThere(walk, above, opt) {
    const w = worker();
    const send = (x) => x.map((e) => ({ k: e.k, tris: e.tris, box: e.box, stair: !!e.stair }));
    if (!w) return (await import("./headcore.js")).scan(send(walk), send(above), opt);
    return new Promise((res, rej) => {
      w.onmessage = (ev) => (ev.data.err ? rej(new Error(ev.data.err)) : res(ev.data.out));
      w.onerror = (e) => rej(new Error(e.message || "the scan stopped"));
      // the same element is often both (a slab stood on and under the floor above): sent once each way
      w.postMessage({ type: "scan", id: 1, walk: send(walk), above: send(above), opt });
    });
  }

  async function run() {
    if (H.running) return;
    const sc = scope();
    if (sc.err) { ctx.status(sc.err); return; }
    const off = new Set(cfg().off || []);
    // the consultants' models: loaded first when they count
    if (consOn() && (ctx.consultants() || []).some((c) => !c.loaded)) {
      try { await ctx.ensureRefs(["*cons"], progress); } catch (e) { ctx.status("Could not load a consultant model: " + (e.message || e)); }
      progress("");
      fillModels();
    }
    const ms = geo.models().filter((m) => !off.has(m.key) && !(m.rec.ref && !consOn()));
    if (!ms.length) { ctx.status("Tick a model under Models counted."); return; }
    H.running = true; H.stop = false;
    $("#head-run").hidden = true; $("#head-stop").hidden = false;
    clearDots(); clearProbe();
    const t0 = performance.now();
    try {
      const walk = [], above = [], seen = new Map();
      for (const m of ms) {
        const cats = [...(await geo.catsOf(m)).keys()];
        const want = cats.filter((k) => isWalk(k) || isAbove(k));
        await geo.elementsOf(m, want, sc.test, (el) => {
          const key = el.part.id + ":" + el.lid;
          if (seen.has(key)) return;
          el.k = key;
          seen.set(key, el);
          if (isWalk(el.cat) && el.box[4] >= sc.yLo && el.box[1] <= sc.yHi) { el.stair = STAIRISH.test(el.cat); walk.push(el); }
          if (isAbove(el.cat) && el.box[4] >= sc.yLo) above.push(el);
        }, () => H.stop, progress);
        if (H.stop) throw new Error("Stopped.");
      }
      if (!walk.length) throw new Error("No floors, stairs or ramps " + sc.label + ".");
      // the triangles, a few hundred elements at a time
      const all = [...new Set([...walk, ...above])];
      let tris = 0;
      for (let i = 0; i < all.length; i += 300) {
        if (H.stop) throw new Error("Stopped.");
        const part = all.slice(i, i + 300);
        const t = await geo.trisOf(part);
        part.forEach((e, n) => { e.tris = t[n]; tris += t[n] ? t[n].length / 9 : 0; });
        if (tris > MAX_TRIS) throw new Error("Too much to measure at once - scan one floor, or inside the section box.");
        progress(`Reading the geometry: ${Math.min(i + 300, all.length)} of ${all.length} elements ...`);
      }
      const W = walk.filter((e) => e.tris), A = above.filter((e) => e.tris);
      progress(`Measuring over ${W.length} floors, stairs and ramps ...`);
      const { limit, stairLimit, minSpace } = limits();
      const res = await scanThere(W, A, { step: 0.25, stairStep: 0.2, fine: 0.1, limit, stairLimit, minSpace, yLo: sc.yLo, yHi: sc.yHi, maxH: 6 });
      // a section box: only what stands inside it
      if (sc.planes) {
        const v = new THREE.Vector3();
        res.points = res.points.filter((p) => sc.planes.every((pl) => pl.distanceToPoint(v.set(p[0], p[1], p[2])) >= 0));
        res.zones = res.zones.filter((z) => sc.planes.every((pl) => pl.distanceToPoint(v.set(z.at[0], z.at[1], z.at[2])) >= 0));
      }
      H.walk = W; H.above = A;
      for (const e of all) e.tris = null;          // let the triangles go
      await geo.nameAll([...new Set(res.zones.flatMap((z) => [W[z.walk], A[z.above]].filter(Boolean)))]);
      H.res = Object.assign(res, { scope: sc.label, at: new Date().toISOString(), limit, stairLimit, minSpace, ms: performance.now() - t0 });
      H.res.places = res.zones.map((z) => placeOf(z, H.res));
      H.live = H.res; H.view = "";
      paintDots();
      paint();
      const nf = res.zones.length;
      ctx.status(`Headroom ${sc.label}: ${res.checked} points measured, ${nf ? nf + " place" + (nf === 1 ? "" : "s") + " under the limit" : "all clear"} (${((performance.now() - t0) / 1000).toFixed(1)} s).`);
    } catch (e) {
      ctx.status("Headroom: " + (e.message || e));
    } finally {
      progress("");
      H.running = false;
      $("#head-run").hidden = false; $("#head-stop").hidden = true;
    }
  }
  $("#head-run").onclick = () => run();
  $("#head-stop").onclick = () => { H.stop = true; };

  /* ------------------------------------------------- squares on the floor */

  function clearDots() {
    if (!H.dots) return;
    ctx.overlay().remove(H.dots);
    H.dots.geometry.dispose(); H.dots.material.dispose();
    H.dots = null;
    ctx.redraw();
  }
  function paintDots() {
    clearDots();
    const res = H.res;
    if (!res || !res.points.length) return;
    const { limit, stairLimit } = limits();
    const pts = res.points.filter((p) => p[3] < (H.walk[p[5]] && H.walk[p[5]].stair ? stairLimit : limit) + 0.1);
    if (!pts.length) return;
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide,
                                           polygonOffset: true, polygonOffsetFactor: -2 });
    const mesh = new THREE.InstancedMesh(g, m, pts.length);
    const M = new THREE.Matrix4(), red = new THREE.Color(lowCol()), amber = new THREE.Color(AMBER);
    pts.forEach((p, i) => {
      const lim = H.walk[p[5]] && H.walk[p[5]].stair ? stairLimit : limit;
      const s = p[7] * 0.86;
      M.makeScale(s, 1, s).setPosition(p[0], p[1] + 0.03, p[2]);
      mesh.setMatrixAt(i, M);
      mesh.setColorAt(i, p[3] < lim ? red : amber);
    });
    mesh.renderOrder = 990;
    mesh.userData.headroom = true;
    ctx.overlay().add(mesh);
    H.dots = mesh;
    ctx.redraw();
  }

  /* ------------------------------------------------------------- zones */

  /* A place under the limit, as kept and shared: what it is over and under
     by their ids (the same from one scan to the next), where it is in the
     project's coordinates. Its key - the two elements and where, to half a
     metre - is how "Not an issue" and its issue find it again. */
  function placeOf(z, res) {
    const w = H.walk[z.walk], a = H.above[z.above];
    const at_mm = ctx.toShared(new THREE.Vector3(z.at[0], z.at[1], z.at[2]));
    const stair = !!(w && w.stair);
    const wid = (w && w.id) || "", aid = (a && a.id) || "";
    return {
      key: [wid, aid, ...at_mm.map((v) => Math.round(v / 500))].join("~"),
      minH: z.minH, area: z.area, at: z.at, at_mm, stair, lim: stair ? res.stairLimit : res.limit,
      level: ctx.levelAt(z.at[1] + 0.1) || "",
      on: (w && w.label && w.label.cat) || (w && catLabel(w.cat)) || "", wid, aid,
      a: a && a.label ? Object.assign({}, a.label) : null, consultant: !!(a && a.model && a.model.rec.ref),
    };
  }
  const ignored = () => new Set(cfg().ignored || []);
  /* Views kept for places (Save view), in one item for the project. */
  const VIEWS_ID = "headroom-views";
  const viewsItem = () => (ctx.items() || []).find((x) => x.id === VIEWS_ID && !x.deleted) || null;
  const viewOf = (pl) => {
    const sv = H.view ? saved().find((x) => x.id === H.view) : null;
    return (sv && sv.result && sv.result.views && sv.result.views[pl.key]) || ((viewsItem() || {}).views || {})[pl.key] || null;
  };
  async function saveViewFor(pl, on) {
    const v = on ? Object.assign(ctx.viewNow(), { name: "Headroom view" }) : null;
    const views = Object.assign({}, (viewsItem() || {}).views || {});
    if (v) views[pl.key] = v; else delete views[pl.key];
    const ok = await ctx.putItem({ id: VIEWS_ID, placement: "checkcfg", views, deleted: false, updated_at: new Date().toISOString() });
    const sv = H.view ? saved().find((x) => x.id === H.view) : null;
    if (sv && sv.result) {
      const sviews = Object.assign({}, sv.result.views || {});
      if (v) sviews[pl.key] = v; else delete sviews[pl.key];
      await ctx.putItem(Object.assign({}, sv, { result: Object.assign({}, sv.result, { views: sviews }) }));
    }
    paint();
    if (ok) ctx.status(on ? "View kept for this place: it opens there for everyone, and its issue uses it." : "The kept view is forgotten.");
  }
  const whereOf = (pl) => (pl.at_mm && ctx.fromShared(pl.at_mm)) || new THREE.Vector3(pl.at[0], pl.at[1], pl.at[2]);
  const underText = (pl) => (pl.a ? `${pl.a.cat}${pl.a.name ? " · " + pl.a.name : ""}` : "");
  const when = (x) => new Date(x).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  function paint() {
    const list = $("#head-list"), sum = $("#head-sum");
    const kept = saved();
    const sv = kept.find((x) => x.id === H.view);
    if (H.view && !sv) H.view = "";
    const res = H.res = sv ? sv.result : H.live;
    const top = H.live || kept.length ? `<div class="ck-results"><select id="head-view" title="Which result is listed: this scan, or one that was saved">`
      + `<option value="">${H.live ? "This scan · " + esc(when(H.live.at)) : "No scan here yet"}</option>`
      + kept.map((x) => `<option value="${esc(x.id)}"${x.id === H.view ? " selected" : ""}>${esc(x.name)}</option>`).join("") + `</select>`
      + (H.view ? (sv && ((sv.by || sv.author) === ctx.myName() || ctx.isAdmin()) ? `<button class="ghost" id="head-delres" title="Delete this saved result">Delete</button>` : "")
        : H.live ? `<button class="ghost" id="head-saveres" title="Keep this result under a name, for everyone on the project">Save result</button>` : "")
      + `</div>` + (sv ? `<div class="ck-when muted">Saved by ${esc(sv.by || sv.author || "")} · ${esc(when(sv.at))}</div>` : "") : "";
    if (!res) { list.innerHTML = ""; sum.innerHTML = top; wireTop(); return; }
    const ign = ignored();
    const places = res.places || [];
    const open = places.filter((pl) => !ign.has(pl.key)), off = places.filter((pl) => ign.has(pl.key));
    const pick = H.filter === "ignored" ? off : open;
    H.shown = pick;
    const toRaise = open.filter((pl) => !issueOf(pl.key));
    H.toRaise = toRaise;
    sum.innerHTML = top + `<div class="ck-when muted">${esc(res.scope)} · floors ${res.limit.toFixed(2)} m, stairs ${res.stairLimit.toFixed(2)} m${res.minSpace ? `, lower than ${res.minSpace.toFixed(1)} m left out` : ""} · ${res.checked} points</div>`
      + (H.view ? "" : `<div class="head-legend"><label class="it" title="Colour of the places under the limit (kept in this browser)"><input type="color" id="head-col" value="${lowCol()}"> under the limit</label>`
        + ` <span class="it"><span class="sw amber"></span> within 100 mm over it</span>`
        + ` <button class="ghost" id="head-clear" title="Take the coloured squares away">Clear</button></div>`)
      + (places.length ? `<div class="ck-filt"><button class="ghost${H.filter === "open" ? " active" : ""}" data-hf="open">Open <b>${open.length}</b></button>`
        + `<button class="ghost${H.filter === "ignored" ? " active" : ""}" data-hf="ignored">Not an issue <b>${off.length}</b></button></div>` : "")
      + (toRaise.length ? `<div class="ck-raise">` + (H.asking
        ? `<span>Raise <b>${toRaise.length}</b> issue${toRaise.length === 1 ? "" : "s"}, due ${esc(dueIn(3))}</span>`
          + `<input class="ck-assign" id="head-assign" placeholder="Assign to (optional)" autocomplete="off">`
          + `<button class="primary" data-hr="go">Raise</button><button class="ghost" data-hr="no">Cancel</button>`
        : `<button class="ghost" data-hr="ask" title="An issue for each place listed that is not 'Not an issue' and has no issue yet">Raise issues for all <b>${toRaise.length}</b></button>`) + `</div>` : "")
      + (pick.length ? `<div class="ck-export"><span class="muted">Export</span><button class="ghost" id="head-csv" title="A spreadsheet (CSV) of the places, for Excel">Spreadsheet</button>`
        + `<button class="ghost" id="head-rep" title="A report with a picture of each place, to print or save as PDF">Report</button></div><div id="head-ask"></div>` : "");
    wireTop();
    if (!H.view) {
      $("#head-clear").onclick = () => { clearDots(); H.live = H.res = null; paint(); };
      $("#head-col").oninput = (ev) => { lsSet("col", ev.target.value); paintDots(); };
    }
    if (pick.length) {
      $("#head-csv").onclick = exportCsv;
      $("#head-rep").onclick = () => {
        const a = $("#head-ask");
        if (a.innerHTML) { a.innerHTML = ""; return; }
        a.innerHTML = `<div class="ck-ask"><span class="muted">${pick.length} places in the report.</span>`
          + `<button class="primary" data-pics="1" title="Each place shown and copied - about a second each">With pictures</button><button class="ghost" data-pics="0">Without</button></div>`;
        a.onclick = (ev) => { const b = ev.target.closest("[data-pics]"); if (!b) return; a.innerHTML = ""; makeReport(b.dataset.pics === "1"); };
      };
    }
    if (!places.length) { list.innerHTML = `<li class="muted ck-empty">All clear ${esc(res.scope)}.</li>`; return; }
    if (!pick.length) { list.innerHTML = `<li class="muted ck-empty">None.</li>`; return; }
    list.innerHTML = pick.map((pl, i) => {
      const iss = issueOf(pl.key), isOff = ign.has(pl.key);
      return `<li class="ck-it${H.on === pl.key ? " on" : ""}" data-n="${i}"><div class="ck-l1"><span class="ck-kind k-head">${pl.minH.toFixed(2)} m</span>`
        + ` <span class="muted">${pl.stair ? "stair / ramp" : "floor"} · limit ${pl.lim.toFixed(2)}</span> <span class="muted">${esc(pl.level)}</span>`
        + `${viewOf(pl) ? ' <span class="ck-view" title="A view is kept for this place: it opens there, and its issue uses it">📷 view</span>' : ""}</div>`
        + `<div class="ck-l2">under ${esc(underText(pl))} <span class="muted">· ${pl.area.toFixed(1)} m²</span></div>`
        + `<div class="ck-acts"><button class="ghost" data-act="look">Look</button>`
        + (iss ? `<button class="ghost" data-act="issue" title="Open its issue">Issue ${iss.issue && iss.issue.number ? "#" + iss.issue.number : ""} · ${esc((iss.issue && iss.issue.status) || "Open")}</button>`
          : isOff ? "" : `<button class="ghost" data-act="make">Make issue</button>`)
        + `<button class="ghost" data-act="saveview" title="Keep the view as it is now (camera, section box, what is hidden) for this place - its issue and everyone after you use it">Save view</button>`
        + (viewOf(pl) ? `<button class="ghost" data-act="clearview" title="Forget the view kept for this place">Clear view</button>` : "")
        + `<button class="ghost" data-act="ign" title="${isOff ? "Count it again" : "Not an issue: left out of the list on every scan"}">${isOff ? "Count again" : "Not an issue"}</button></div></li>`;
    }).join("");
  }
  function wireTop() {
    const v = $("#head-view");
    if (v) v.onchange = () => { H.view = v.value; H.filter = "open"; paint(); };
    const s = $("#head-saveres");
    if (s) s.onclick = saveResult;
    const d = $("#head-delres");
    if (d) d.onclick = deleteResult;
  }
  $("#head-sum").addEventListener("click", (ev) => {
    const f = ev.target.closest("[data-hf]");
    if (f) { H.filter = f.dataset.hf; paint(); return; }
    const r = ev.target.closest("[data-hr]");
    if (!r) return;
    if (r.dataset.hr === "ask") { H.asking = true; paint(); const i = $("#head-assign"); if (i) i.focus(); }
    else if (r.dataset.hr === "no") { H.asking = false; paint(); }
    else { const i = $("#head-assign"); raiseAll(i ? i.value.trim() : ""); }
  });
  async function saveResult() {
    if (!H.live) return;
    const name = prompt("Name of this result", `Headroom ${H.live.scope} - ${new Date().toLocaleDateString()}`);
    if (!name || !name.trim()) return;
    const r = H.live;
    const it = { id: ctx.uid(), placement: "headroomresult", name: name.trim().slice(0, 120), at: new Date().toISOString(), by: ctx.myName(),
                 result: { scope: r.scope, at: r.at, limit: r.limit, stairLimit: r.stairLimit, minSpace: r.minSpace, checked: r.checked,
                           places: (r.places || []).slice(0, 2500),
                           views: Object.fromEntries(Object.entries((viewsItem() || {}).views || {}).filter(([k]) => (r.places || []).some((pl) => pl.key === k))) } };
    if (await ctx.putItem(it)) { H.view = it.id; paint(); ctx.status(`Result saved as "${it.name}" - everyone on the project can open it under Headroom.`); }
  }
  async function deleteResult() {
    const it = saved().find((x) => x.id === H.view);
    if (!it || !confirm(`Delete the saved result "${it.name}"?`)) return;
    await ctx.putItem(Object.assign({}, it, { deleted: true }));
    H.view = "";
    paint();
  }
  function toggleIgnore(pl) {
    const ign = ignored();
    if (ign.has(pl.key)) ign.delete(pl.key); else ign.add(pl.key);
    saveCfg({ ignored: [...ign] });
    paint();
  }
  /* A place: the storey cut out round it, what is overhead coloured, and
     its height drawn where it is lowest. */
  async function look(pl) {
    const p = whereOf(pl);
    const v = viewOf(pl);
    if (v) ctx.viewBack(v); else ctx.focusAt(p, 4);
    const OVER = "#f28022";
    const a = pl.aid ? await geo.find(pl.aid) : null;
    await ctx.highlightMany(a ? [a] : [], { a: OVER });
    drawDim(p, p.clone().add(new THREE.Vector3(0, pl.minH, 0)), `${(pl.lim - pl.minH).toFixed(2)} m short of ${pl.lim.toFixed(2)} m`);
    ctx.legend(`<div class="cl-row"><span class="cl-sw" style="background:${OVER}"></span><b>Overhead</b> ${esc(underText(pl))}</div>`
      + `<div class="cl-row"><span class="cl-sw" style="background:${lowCol()}"></span>under ${pl.lim.toFixed(2)} m · lowest ${pl.minH.toFixed(2)} m</div>`
      + `<div class="cl-row"><span class="cl-sw" style="background:${AMBER}"></span>within 100 mm over it</div>`);
    return a;
  }
  /* Export: the places listed as a spreadsheet, or a report (pictures optional). */
  function exportCsv() {
    const list = H.shown || [];
    if (!list.length) return;
    const rows = list.map((pl, i) => {
      const a = pl.a || {}, p = pl.at_mm || [];
      return [i + 1, pl.level, pl.stair ? "Stair / ramp" : "Floor", pl.on, pl.minH.toFixed(3), pl.lim.toFixed(2), (pl.lim - pl.minH).toFixed(3), pl.area.toFixed(2),
              a.model || "", a.cat || "", a.name || "", a.type || "", a.id || "", p[0], p[1], p[2]];
    });
    saveCsv(`${fileName(ctx.projectName())}-headroom-${new Date().toISOString().slice(0, 10)}.csv`,
      ["No", "Floor", "Where", "Standing on", "Lowest clear height m", "Limit m", "Short by m", "Area m2",
       "Overhead model", "Overhead category", "Overhead name", "Overhead type", "Overhead id", "X mm (project)", "Y mm (project)", "Z mm (project)"], rows, "Headroom");
    ctx.status(`${rows.length} places exported as a spreadsheet.`);
  }
  async function makeReport(withPics) {
    const res = H.res, list = (H.shown || []).slice();
    const w = reportTab("Headroom report");
    if (!w) { ctx.status("The browser blocked the report tab - allow pop-ups for this site and try again."); return; }
    let imgs = [];
    if (withPics) {
      const v = ctx.viewNow();
      H.stop = false;
      $("#head-run").hidden = true; $("#head-stop").hidden = false;
      try {
        imgs = await pictures(list, (pl) => look(pl), () => ctx.shot(900), (t) => { progress(t); tabSay(w, t); }, () => H.stop, w);
      } finally {
        progress("");
        $("#head-run").hidden = false; $("#head-stop").hidden = true;
        clearProbe(); ctx.legend(null);
        try { await ctx.highlightMany([]); } catch (e) {}
        ctx.viewBack(v);
      }
    }
    if (w.closed) return;
    const by = new Map();
    for (const pl of list) {
      const k = pl.level || "-";
      if (!by.has(k)) by.set(k, { n: 0, area: 0, low: Infinity });
      const g = by.get(k); g.n++; g.area += pl.area; g.low = Math.min(g.low, pl.minH);
    }
    writeReport(w, {
      title: "Headroom report", project: ctx.projectName(), unit: "places", folder: "Headroom",
      sub: new Date().toLocaleString() + (ctx.author() ? " · prepared by " + ctx.author() : ""),
      meta: [["Where", res.scope], ["Limits", `floors ${res.limit.toFixed(2)} m, stairs and ramps ${res.stairLimit.toFixed(2)} m`],
        ["Left out", res.minSpace ? `spaces lower than ${res.minSpace.toFixed(1)} m (not used by people)` : "nothing"],
        ["Measured", `${res.checked} points, ${new Date(res.at).toLocaleString()}`]],
      table: { cols: ["Floor", "Places", "Area m²", "Lowest m"], rows: [...by.entries()].map(([k, g]) => [k, g.n, g.area.toFixed(1), g.low.toFixed(2)]) },
      items: list.map((pl, i) => {
        const p = pl.at_mm || [], iss = issueOf(pl.key);
        return { head: `${pl.minH.toFixed(2)} m · ${pl.stair ? "Stair / ramp" : "Floor"}${pl.level ? " · " + pl.level : ""}`, tag: `${(pl.lim - pl.minH).toFixed(2)} m short`,
          img: imgs[i] || null,
          rows: [["Standing on", pl.on], ["Overhead", pl.a ? elementLine(pl.a) : "", "#f28022"], ["Limit", `${pl.lim.toFixed(2)} m`],
            ["Area under the limit", `${pl.area.toFixed(1)} m²`, lowCol()], ["Where (project mm)", `X ${p[0]}, Y ${p[1]}, Z ${p[2]}`],
            ...(iss && iss.issue ? [["Issue", `#${iss.issue.number || ""} · ${iss.issue.status || "Open"}`]] : [])] };
      }),
    });
    ctx.status(`Headroom report ready in a new tab: ${list.length} places - Print / Save as PDF there.`);
  }
  // what an issue from a place says: "Headroom issue 003 - 2.05 m under Ducts (L1)"
  function issueFields(pl, n) {
    return {
      title: `Headroom issue ${numberText(n)} - ${pl.minH.toFixed(2)} m under ${pl.a ? pl.a.cat : "an element"}${pl.stair ? " on the stair" : ""}${pl.level ? " (" + pl.level + ")" : ""}`.slice(0, 120),
      description: [`Clear height ${pl.minH.toFixed(3)} m, ${pl.lim.toFixed(2)} m wanted (${(pl.lim - pl.minH).toFixed(3)} m short)${pl.level ? " on " + pl.level : ""}.`,
        "Overhead: " + (pl.a ? elementLine(pl.a) : "an element"), "Standing on: " + (pl.on || (pl.stair ? "a stair / ramp" : "the floor")),
        `About ${pl.area.toFixed(1)} m² under ${pl.lim.toFixed(2)} m.`,
        xyzText(pl.at_mm) ? "Where: " + xyzText(pl.at_mm) : "",
        `Headroom scan ${H.res && H.res.scope ? H.res.scope + ", " : ""}${new Date().toLocaleDateString()}.`].filter(Boolean).join("\n"),
      type: pl.consultant ? "coordination" : "design",
      status: "Open",
      due_date: dueIn(3),
      headroom: { key: pl.key, minH: pl.minH, lim: pl.lim },
      // the height, drawn again whenever the issue's view is opened
      dims: [{ a_mm: ctx.sceneMM(whereOf(pl)), b_mm: ctx.sceneMM(whereOf(pl).add(new THREE.Vector3(0, pl.minH, 0))),
               label: `${pl.minH.toFixed(3)} m (${(pl.lim - pl.minH).toFixed(2)} m short)` }],
    };
  }
  const issueAt = (pl) => { const p = whereOf(pl); return p.clone().add(new THREE.Vector3(0, Math.min(pl.minH, 1.5), 0)); };
  async function makeIssue(pl) {
    const a = await look(pl);
    await ctx.makeIssue(issueAt(pl), a, issueFields(pl, nextNumber(ctx.items(), "Headroom issue")));
  }
  async function raiseAll(assign) {
    const list = (H.toRaise || []).slice();
    if (!list.length || H.running) return;
    H.running = true; H.stop = false; H.asking = false;
    $("#head-run").hidden = true; $("#head-stop").hidden = false;
    const v = ctx.viewNow();
    let n = nextNumber(ctx.items(), "Headroom issue"), made = 0;
    try {
      for (const pl of list) {
        if (H.stop) break;
        if (issueOf(pl.key)) continue;
        progress(`Raising issue ${made + 1} of ${list.length} ...`);
        const a = await look(pl);
        const f = issueFields(pl, n);
        if (assign) f.assigned_to = assign;
        if (await ctx.createIssue(issueAt(pl), a, f)) { made++; n++; }
      }
    } finally {
      progress("");
      H.running = false;
      $("#head-run").hidden = false; $("#head-stop").hidden = true;
      clearProbe(); ctx.legend(null);
      try { await ctx.highlightMany([]); } catch (e) {}
      ctx.viewBack(v);
      paint();
    }
    ctx.status(`${made} headroom issue${made === 1 ? "" : "s"} raised, due ${dueIn(3)}${assign ? ", assigned to " + assign : ""}${made < list.length ? " (" + (list.length - made) + " not raised)" : ""}.`);
  }
  $("#head-list").onclick = async (ev) => {
    const li = ev.target.closest(".ck-it");
    if (!li) return;
    const pl = (H.shown || [])[Number(li.dataset.n)];
    if (!pl) return;
    H.on = pl.key;
    box.querySelectorAll("#head-list .ck-it.on").forEach((x) => x.classList.remove("on"));
    li.classList.add("on");
    const act = ev.target.closest("[data-act]");
    const a = act && act.dataset.act;
    if (a === "make") return makeIssue(pl);
    if (a === "ign") return toggleIgnore(pl);
    if (a === "saveview") return saveViewFor(pl, true);
    if (a === "clearview") return saveViewFor(pl, false);
    if (a === "issue") { const it = issueOf(pl.key); if (it) ctx.selectIssue(it.id); return; }
    return look(pl);
  };

  return {
    probeAt,
    refresh() { fillScope(); fillModels(); showCfg(); },
    // the shared settings changed (someone else): shown, unless being typed in
    itemsChanged() {
      if (!box.contains(document.activeElement)) showCfg();
      if (H.running) return;
      const sig = JSON.stringify((ctx.items() || []).filter((it) => it && (isSaved(it) || it.headroom || it.id === CFG_ID || it.id === VIEWS_ID))
        .map((it) => [it.id, it.deleted, it.issue && it.issue.status, it.issue && it.issue.number, it.cfg && (it.cfg.ignored || []).length,
                      Object.keys(it.views || (it.result && it.result.views) || {}).length]));
      if (sig === H.sig) return;
      H.sig = sig;
      paint();
    },
    leave() { clearProbe(); },
    get result() { return H.res; },
    get shown() { return H.shown || []; },
    async raiseAllNow(assign) { paint(); await raiseAll(assign || ""); },
    ignoreNow(i) { const pl = (H.shown || [])[i]; if (pl) toggleIgnore(pl); },
    // support and tests: what the last scan used
    debug: () => ({ walk: H.walk.map((e) => [e.model.key, e.cat, e.box.map((v) => +v.toFixed(2))]),
                    above: H.above.map((e) => [e.model.key, e.cat, e.box.map((v) => +v.toFixed(2))]),
                    dots: H.dots ? H.dots.count : 0, section: !!(ctx.sectionPlanes && ctx.sectionPlanes()) }),
  };
}
