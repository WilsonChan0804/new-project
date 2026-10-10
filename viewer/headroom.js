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
import { createGeo, catLabel } from "./checkgeo.js";

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
    </div>
    <details class="head-models"><summary>Models counted</summary><div id="head-mlist"></div></details>
    <div class="chk-row">
      <select id="head-scope" title="Where to scan" aria-label="Where to scan"><option value="all">Whole model</option></select>
      <button id="head-run" class="primary" title="Measure the clear height all over">Scan</button>
      <button id="head-stop" class="ghost" hidden>Stop</button>
    </div>
    <div id="head-prog" class="chk-prog" hidden><span></span></div>
    <div id="head-sum"></div>
    <ul id="head-list" class="clash-list"></ul>`;
  const $ = (s) => box.querySelector(s);
  $("#head-lim").value = lsGet("lim", 2.3);
  $("#head-lim-st").value = lsGet("limst", 2.0);
  const limits = () => ({ limit: Math.max(0.5, Number($("#head-lim").value) || 2.3), stairLimit: Math.max(0.5, Number($("#head-lim-st").value) || 2.0) });
  $("#head-lim").onchange = () => { lsSet("lim", limits().limit); paintDots(); };
  $("#head-lim-st").onchange = () => { lsSet("limst", limits().stairLimit); paintDots(); };

  function progress(t) { const p = $("#head-prog"); p.hidden = !t; p.querySelector("span").textContent = t || ""; }

  /* ------------------------------------------------------------ probe */

  function clearProbe() {
    if (!H.probe) return;
    ctx.overlay().remove(H.probe.group);
    H.probe.group.traverse((o) => { if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } if (o.geometry) o.geometry.dispose(); });
    H.probe = null;
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
    ctx.overlay().add(g);
    H.probe = { group: g, a: p, b: q, h };
    ctx.redraw();
    const verdict = h < stairLimit ? `under the ${stairLimit.toFixed(2)} m stair limit` : h < limit ? `under the ${limit.toFixed(2)} m floor limit (enough for a stair)` : "enough";
    ctx.status(`Clear height ${h.toFixed(3)} m here - ${verdict}. Keep makes it a dimension for everyone; Esc or Probe again to stop.`);
    $("#head-sum").innerHTML = `<div class="head-probe-res"><b>${h.toFixed(3)} m</b> <span class="muted">${esc(verdict)}</span> <button class="ghost" id="head-keep">Keep</button></div>`
      + ($("#head-sum").dataset.keep ? "" : "");
    $("#head-keep").onclick = async () => {
      if (!H.probe) return;
      await ctx.keepDim(H.probe.a, H.probe.b, "Headroom " + H.probe.h.toFixed(3) + " m");
      clearProbe();
      $("#head-keep").remove();
    };
  }
  $("#head-probe").onclick = () => {
    const on = ctx.mode() !== "headroom";
    ctx.setMode(on ? "headroom" : "nav");
    if (!on) clearProbe();
  };

  /* ------------------------------------------------------------- scan */

  function fillScope() {
    const sel = $("#head-scope"), was = sel.value;
    const rows = ctx.floorRows();
    sel.innerHTML = `<option value="all">Whole model</option><option value="box">Inside the section box</option>`
      + rows.map((r, i) => `<option value="f:${i}">Floor: ${esc(r.name)}</option>`).reverse().join("");
    sel.value = [...sel.options].some((o) => o.value === was) ? was
      : (ctx.floorIndex() != null && rows[ctx.floorIndex()] ? "f:" + ctx.floorIndex() : (rows.length ? "f:0" : "all"));
  }
  function fillModels() {
    const off = new Set(lsGet("off", []));
    $("#head-mlist").innerHTML = geo.models().map((m) =>
      `<label class="row-check"><input type="checkbox" value="${esc(m.key)}"${off.has(m.key) ? "" : " checked"}> ${esc(m.label)}</label>`).join("")
      || '<span class="muted">No model loaded.</span>';
  }
  $("#head-mlist").onchange = () => {
    lsSet("off", [...$("#head-mlist").querySelectorAll("input:not(:checked)")].map((x) => x.value));
  };
  $("#head-scope").onfocus = fillScope;
  box.querySelector(".head-models").addEventListener("toggle", fillModels);

  function scope() {
    const v = $("#head-scope").value;
    if (v.startsWith("f:")) {
      const rows = ctx.floorRows(), i = Number(v.slice(2)), r = rows[i];
      if (!r) return { err: "That floor is not known any more." };
      // standing from just under this level to just under the next
      const yLo = r.y - 0.4, yHi = i + 1 < rows.length ? rows[i + 1].y - 0.4 : r.y + 6;
      return { label: "on " + r.name, yLo, yHi, test: (b) => b[4] >= yLo && b[1] <= yHi + 6 };
    }
    if (v === "box") {
      const planes = ctx.sectionPlanes();
      if (!planes) return { err: "Turn the section box on first (Section > Box), or scan a floor." };
      const c = new THREE.Vector3();
      const inside = (b) => planes.every((p) => {
        for (let i = 0; i < 8; i++) { c.set(i & 1 ? b[3] : b[0], i & 2 ? b[4] : b[1], i & 4 ? b[5] : b[2]); if (p.distanceToPoint(c) >= 0) return true; }
        return false;
      });
      return { label: "inside the section box", yLo: -Infinity, yHi: Infinity, test: inside, planes };
    }
    return { label: "in the whole model", yLo: -Infinity, yHi: Infinity, test: null };
  }

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
    const off = new Set(lsGet("off", []));
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
        const want = cats.filter((k) => WALK.test(k) || ABOVE.test(k));
        await geo.elementsOf(m, want, sc.test, (el) => {
          const key = el.part.id + ":" + el.lid;
          if (seen.has(key)) return;
          el.k = key;
          seen.set(key, el);
          if (WALK.test(el.cat) && el.box[4] >= sc.yLo && el.box[1] <= sc.yHi) { el.stair = STAIRISH.test(el.cat); walk.push(el); }
          if (ABOVE.test(el.cat) && el.box[4] >= sc.yLo) above.push(el);
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
      const { limit, stairLimit } = limits();
      const res = await scanThere(W, A, { step: 0.25, stairStep: 0.2, fine: 0.1, limit, stairLimit, yLo: sc.yLo, yHi: sc.yHi, maxH: 6 });
      // a section box: only what stands inside it
      if (sc.planes) {
        const v = new THREE.Vector3();
        res.points = res.points.filter((p) => sc.planes.every((pl) => pl.distanceToPoint(v.set(p[0], p[1], p[2])) >= 0));
        res.zones = res.zones.filter((z) => sc.planes.every((pl) => pl.distanceToPoint(v.set(z.at[0], z.at[1], z.at[2])) >= 0));
      }
      H.walk = W; H.above = A;
      for (const e of all) e.tris = null;          // let the triangles go
      await geo.nameAll([...new Set(res.zones.flatMap((z) => [W[z.walk], A[z.above]].filter(Boolean)))]);
      H.res = Object.assign(res, { scope: sc.label, at: new Date().toISOString(), limit, stairLimit, ms: performance.now() - t0 });
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
    const M = new THREE.Matrix4(), red = new THREE.Color(0xe2453c), amber = new THREE.Color(0xf0a020);
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
    sum.innerHTML = `<div class="ck-when muted">${esc(res.scope)} · floors ${res.limit.toFixed(2)} m, stairs ${res.stairLimit.toFixed(2)} m · ${res.checked} points</div>`
      + `<div class="head-legend"><span class="it"><span class="sw red"></span> under the limit</span> <span class="it"><span class="sw amber"></span> within 100 mm over it</span>`
      + ` <button class="ghost" id="head-clear" title="Take the coloured squares away">Clear</button></div>`;
    $("#head-clear").onclick = () => { clearDots(); H.res = null; paint(); };
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
  async function look(z) {
    const p = new THREE.Vector3(z.at[0], z.at[1], z.at[2]);
    ctx.focusAt(p);
    const a = H.above[z.above];
    if (a) await ctx.highlightMany([{ part: a.part, lid: a.lid }]);
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
    refresh() { fillScope(); fillModels(); },
    leave() { clearProbe(); },
    get result() { return H.res; },
    // support and tests: what the last scan used
    debug: () => ({ walk: H.walk.map((e) => [e.model.key, e.cat, e.box.map((v) => +v.toFixed(2))]),
                    above: H.above.map((e) => [e.model.key, e.cat, e.box.map((v) => +v.toFixed(2))]),
                    dots: H.dots ? H.dots.count : 0, section: !!(ctx.sectionPlanes && ctx.sectionPlanes()) }),
  };
}
