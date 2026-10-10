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
  const H = { probe: null, dots: null, zones: [], walk: [], above: [], running: false, stop: false, worker: null, res: null };
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
  function fillModels() {
    const off = new Set(cfg().off || []);
    $("#head-mlist").innerHTML = geo.models().map((m) =>
      `<label class="row-check"><input type="checkbox" value="${esc(m.key)}"${off.has(m.key) ? "" : " checked"}> ${esc(m.label)}</label>`).join("")
      || '<span class="muted">No model loaded.</span>';
  }
  $("#head-mlist").onchange = () => {
    saveCfg({ off: [...$("#head-mlist").querySelectorAll("input:not(:checked)")].map((x) => x.value) });
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
    const ms = geo.models().filter((m) => !off.has(m.key));
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

  function paint() {
    const res = H.res, list = $("#head-list"), sum = $("#head-sum");
    if (!res) { list.innerHTML = ""; sum.innerHTML = ""; return; }
    sum.innerHTML = `<div class="ck-when muted">${esc(res.scope)} · floors ${res.limit.toFixed(2)} m, stairs ${res.stairLimit.toFixed(2)} m${res.minSpace ? `, lower than ${res.minSpace.toFixed(1)} m left out` : ""} · ${res.checked} points</div>`
      + `<div class="head-legend"><label class="it" title="Colour of the places under the limit (kept in this browser)"><input type="color" id="head-col" value="${lowCol()}"> under the limit</label>`
      + ` <span class="it"><span class="sw amber"></span> within 100 mm over it</span>`
      + ` <button class="ghost" id="head-clear" title="Take the coloured squares away">Clear</button></div>`
      + (res.zones.length ? `<div class="ck-export"><span class="muted">Export</span><button class="ghost" id="head-csv" title="A spreadsheet (CSV) of the places, for Excel">Spreadsheet</button>`
        + `<button class="ghost" id="head-rep" title="A report with a picture of each place, to print or save as PDF">Report</button></div><div id="head-ask"></div>` : "");
    $("#head-clear").onclick = () => { clearDots(); H.res = null; paint(); };
    $("#head-col").oninput = (ev) => { lsSet("col", ev.target.value); paintDots(); };
    if (res.zones.length) {
      $("#head-csv").onclick = exportCsv;
      $("#head-rep").onclick = () => {
        const a = $("#head-ask");
        if (a.innerHTML) { a.innerHTML = ""; return; }
        a.innerHTML = `<div class="ck-ask"><span class="muted">${res.zones.length} places in the report.</span>`
          + `<button class="primary" data-pics="1" title="Each place shown and copied - about a second each">With pictures</button><button class="ghost" data-pics="0">Without</button></div>`;
        a.onclick = (ev) => { const b = ev.target.closest("[data-pics]"); if (!b) return; a.innerHTML = ""; makeReport(b.dataset.pics === "1"); };
      };
    }
    if (!res.zones.length) { list.innerHTML = `<li class="muted ck-empty">All clear ${esc(res.scope)}.</li>`; return; }
    list.innerHTML = res.zones.map((z, i) => {
      const w = H.walk[z.walk], a = H.above[z.above];
      const lim = w && w.stair ? res.stairLimit : res.limit;
      const under = a && a.label ? `${a.label.cat}${a.label.name ? " · " + a.label.name : ""}` : "";
      return `<li class="ck-it${H.on === i ? " on" : ""}" data-n="${i}"><div class="ck-l1"><span class="ck-kind k-head">${z.minH.toFixed(2)} m</span>`
        + ` <span class="muted">${w && w.stair ? "stair / ramp" : "floor"} · limit ${lim.toFixed(2)}</span> <span class="muted">${esc(ctx.levelAt(z.at[1] + 0.1) || "")}</span></div>`
        + `<div class="ck-l2">under ${esc(under)} <span class="muted">· ${z.area.toFixed(1)} m²</span></div>`
        + `<div class="ck-acts"><button class="ghost" data-act="look">Look</button><button class="ghost" data-act="make">Make issue</button></div></li>`;
    }).join("");
  }
  /* A place: the storey cut out round it, what is overhead coloured, and
     its height drawn where it is lowest. */
  async function look(z) {
    const p = new THREE.Vector3(z.at[0], z.at[1], z.at[2]);
    ctx.focusAt(p, 4);
    const a = H.above[z.above], w = H.walk[z.walk];
    const OVER = "#f28022";
    await ctx.highlightMany(a ? [{ part: a.part, lid: a.lid }] : [], { a: OVER });
    const lim = w && w.stair ? H.res.stairLimit : H.res.limit;
    drawDim(p, p.clone().add(new THREE.Vector3(0, z.minH, 0)), `${(lim - z.minH).toFixed(2)} m short of ${lim.toFixed(2)} m`);
    const nm = (e) => (e && e.label ? `${e.label.cat}${e.label.name ? " · " + e.label.name : ""}` : "");
    ctx.legend(`<div class="cl-row"><span class="cl-sw" style="background:${OVER}"></span><b>Overhead</b> ${esc(nm(a))}</div>`
      + `<div class="cl-row"><span class="cl-sw" style="background:${lowCol()}"></span>under ${lim.toFixed(2)} m · lowest ${z.minH.toFixed(2)} m</div>`
      + `<div class="cl-row"><span class="cl-sw" style="background:${AMBER}"></span>within 100 mm over it</div>`);
  }
  /* Export: the places as a spreadsheet, or a report (pictures optional). */
  const zoneRow = (z) => {
    const w = H.walk[z.walk], a = H.above[z.above];
    const lim = w && w.stair ? H.res.stairLimit : H.res.limit;
    const p = ctx.toShared(new THREE.Vector3(z.at[0], z.at[1], z.at[2]));
    return { w, a, lim, p, lv: ctx.levelAt(z.at[1] + 0.1) || "",
             on: (w && w.label && w.label.cat) || (w && catLabel(w.cat)) || "", kind: w && w.stair ? "Stair / ramp" : "Floor" };
  };
  function exportCsv() {
    const res = H.res;
    if (!res || !res.zones.length) return;
    const rows = res.zones.map((z, i) => {
      const x = zoneRow(z), a = x.a && x.a.label ? x.a.label : {};
      return [i + 1, x.lv, x.kind, x.on, z.minH.toFixed(3), x.lim.toFixed(2), (x.lim - z.minH).toFixed(3), z.area.toFixed(2),
              a.model || "", a.cat || "", a.name || "", a.type || "", a.id || "", x.p[0], x.p[1], x.p[2]];
    });
    saveCsv(`${fileName(ctx.projectName())}-headroom-${new Date().toISOString().slice(0, 10)}.csv`,
      ["No", "Floor", "Where", "Standing on", "Lowest clear height m", "Limit m", "Short by m", "Area m2",
       "Overhead model", "Overhead category", "Overhead name", "Overhead type", "Overhead id", "X mm (project)", "Y mm (project)", "Z mm (project)"], rows);
    ctx.status(`${rows.length} places exported as a spreadsheet.`);
  }
  async function makeReport(withPics) {
    const res = H.res, list = res.zones.slice();
    const w = reportTab("Headroom report");
    if (!w) { ctx.status("The browser blocked the report tab - allow pop-ups for this site and try again."); return; }
    let imgs = [];
    if (withPics) {
      const v = ctx.viewNow();
      H.stop = false;
      $("#head-run").hidden = true; $("#head-stop").hidden = false;
      try {
        imgs = await pictures(list, (z) => look(z), () => ctx.shot(900), (t) => { progress(t); tabSay(w, t); }, () => H.stop, w);
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
    for (const z of list) {
      const k = zoneRow(z).lv || "-";
      if (!by.has(k)) by.set(k, { n: 0, area: 0, low: Infinity });
      const g = by.get(k); g.n++; g.area += z.area; g.low = Math.min(g.low, z.minH);
    }
    const nm = (e) => (e && e.label ? `${e.label.model} - ${e.label.cat}${e.label.name ? " - " + e.label.name : ""}${e.label.id ? " - id " + e.label.id : ""}` : "");
    writeReport(w, {
      title: "Headroom report", project: ctx.projectName(), unit: "places",
      sub: new Date().toLocaleString() + (ctx.author() ? " · prepared by " + ctx.author() : ""),
      meta: [["Where", res.scope], ["Limits", `floors ${res.limit.toFixed(2)} m, stairs and ramps ${res.stairLimit.toFixed(2)} m`],
        ["Left out", res.minSpace ? `spaces lower than ${res.minSpace.toFixed(1)} m (not used by people)` : "nothing"],
        ["Measured", `${res.checked} points, ${new Date(res.at).toLocaleString()}`]],
      table: { cols: ["Floor", "Places", "Area m²", "Lowest m"], rows: [...by.entries()].map(([k, g]) => [k, g.n, g.area.toFixed(1), g.low.toFixed(2)]) },
      items: list.map((z, i) => {
        const x = zoneRow(z);
        return { head: `${z.minH.toFixed(2)} m · ${x.kind}${x.lv ? " · " + x.lv : ""}`, tag: `${(x.lim - z.minH).toFixed(2)} m short`,
          img: imgs[i] || null,
          rows: [["Standing on", x.on], ["Overhead", nm(x.a), "#f28022"], ["Limit", `${x.lim.toFixed(2)} m`],
            ["Area under the limit", `${z.area.toFixed(1)} m²`, lowCol()], ["Where (project mm)", `X ${x.p[0]}, Y ${x.p[1]}, Z ${x.p[2]}`]] };
      }),
    });
    ctx.status(`Headroom report ready in a new tab: ${list.length} places - Print / Save as PDF there.`);
  }
  async function makeIssue(z) {
    await look(z);
    const w = H.walk[z.walk], a = H.above[z.above];
    const lim = w && w.stair ? H.res.stairLimit : H.res.limit;
    const lv = ctx.levelAt(z.at[1] + 0.1);
    const under = a && a.label ? `${a.label.cat}${a.label.name ? " - " + a.label.name : ""}` : "an element";
    const at = new THREE.Vector3(z.at[0], z.at[1] + Math.min(z.minH, 1.5), z.at[2]);
    await ctx.makeIssue(at, a ? { part: a.part, lid: a.lid } : null, {
      title: `Headroom ${z.minH.toFixed(2)} m${w && w.stair ? " on the stair" : ""}${lv ? " (" + lv + ")" : ""} - ${lim.toFixed(2)} m wanted`.slice(0, 120),
      description: [`Clear height ${z.minH.toFixed(3)} m under ${under}${a && a.label && a.label.id ? " (id " + a.label.id + ")" : ""}, over ${(w && w.label && w.label.cat) || (w && catLabel(w.cat)) || "the floor"}.`,
        `About ${z.area.toFixed(1)} m² under ${lim.toFixed(2)} m. Headroom scan, ${new Date().toLocaleDateString()}.`].join("\n"),
      type: a && a.model && a.model.rec.ref ? "coordination" : "design",
    });
  }
  $("#head-list").onclick = async (ev) => {
    const li = ev.target.closest(".ck-it");
    if (!li) return;
    const i = Number(li.dataset.n), z = H.res && H.res.zones[i];
    if (!z) return;
    H.on = i;
    box.querySelectorAll("#head-list .ck-it.on").forEach((x) => x.classList.remove("on"));
    li.classList.add("on");
    const act = ev.target.closest("[data-act]");
    if (act && act.dataset.act === "make") return makeIssue(z);
    return look(z);
  };

  return {
    probeAt,
    refresh() { fillScope(); fillModels(); showCfg(); },
    // the shared settings changed (someone else): shown, unless being typed in
    itemsChanged() { if (!box.contains(document.activeElement)) showCfg(); },
    leave() { clearProbe(); },
    get result() { return H.res; },
    // support and tests: what the last scan used
    debug: () => ({ walk: H.walk.map((e) => [e.model.key, e.cat, e.box.map((v) => +v.toFixed(2))]),
                    above: H.above.map((e) => [e.model.key, e.cat, e.box.map((v) => +v.toFixed(2))]),
                    dots: H.dots ? H.dots.count : 0, section: !!(ctx.sectionPlanes && ctx.sectionPlanes()) }),
  };
}
