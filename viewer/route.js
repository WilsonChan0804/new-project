/* Route distance on a plan: travel distance, a dead end, staircase to
 * staircase, from the fireman's lift, from the TRS ...
 *
 * A route markup is the points the person clicked (points_mm: the start,
 * any points it must pass, the end) - so moving, adding and removing points
 * work as on any polyline - and between each two of them a leg:
 *
 *   Shortest  the shortest way round the plan's walls and whatever else
 *             is ticked to block (routecore.js, in route-worker.js), from
 *             the plan cut the add-in publishes beside the sheet's PDF
 *             (planroute.py). Doors pass unless ticked.
 *   Points    straight from point to point: the total of the clicked
 *             points, on any sheet (an imported PDF too).
 *
 * The legs are kept on the markup (legs_mm), each with the points and
 * settings it was found for (leg_for), so only a leg whose end moved is
 * looked for again, and everyone sees the same route.
 */

export const PURPOSES = ["Travel distance", "Dead end", "Staircase to staircase", "From fireman's lift", "From TRS", "Distance"];
const KEEP = "lwk-sheets:route";
const CELL_MODEL_MM = 100;           // the grid: 100 mm in the building
const DEF = { mode: "shortest", purpose: "Travel distance", limit_m: "", clear_mm: 300, block: null };

export function createRoute(ctx) {
  const { S, Store, status, redraw, putItem, activeScale } = ctx;
  const R = { key: "", plan: null, cats: [], blocking: [], loading: null, worker: null, req: 0, wait: new Map(), panel: null };

  let defaults = Object.assign({}, DEF);
  try { Object.assign(defaults, JSON.parse(localStorage.getItem(KEEP) || "{}")); } catch (e) {}
  const keepDefaults = () => { try { localStorage.setItem(KEEP, JSON.stringify(defaults)); } catch (e) {} };

  /* ------------------------------------------------------------ the plan */

  function worker() {
    if (R.worker === null) {
      try {
        R.worker = new Worker(new URL("./route-worker.js", import.meta.url), { type: "module" });
        R.worker.onmessage = (ev) => {
          const m = ev.data || {};
          const w = R.wait.get(m.req);
          if (w) { R.wait.delete(m.req); w(m); }
        };
      } catch (e) { R.worker = false; }
    }
    return R.worker || null;
  }

  /* The open sheet's plan cut (sheets/<name>.route.json), read once */
  async function loadPlan(sheet) {
    R.plan = null; R.cats = []; R.blocking = [];
    R.key = "";
    if (!sheet || !sheet.route) { paintPanel(); return null; }
    const key = sheet.number + "|" + (sheet.exported_at || "") + "|" + sheet.route;
    R.key = key;
    R.loading = (async () => {
      const r = await fetch(Store.dataUrl(sheet.route));
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (R.key !== key) return null;
      R.plan = j;
      const present = new Set();
      for (const v of Object.values(j.viewports || {})) for (const c of Object.keys(v.cats || {})) present.add(c);
      R.cats = (j.categories || []).filter((c) => present.has(c));
      R.blocking = j.blocking || [];
      const w = worker();
      if (w) w.postMessage({ op: "load", key, vps: j.viewports || {} });
      return j;
    })().catch((e) => { console.warn("route plan", e); if (R.key === key) R.plan = null; return null; });
    const j = await R.loading;
    paintPanel();
    // routes on this sheet found before the plan was read: look again
    if (j) for (const it of S.items) if (it.type === "route" && it.sheet === sheet.number && stale(it)) await refresh(it);
    return j;
  }

  /* The plan viewport a point is in (one the add-in cut) */
  function viewportAt(p, rooms) {
    if (!R.plan || !S.sheet) return null;
    let best = null, area = Infinity;
    for (const vp of S.sheet.viewports || []) {
      const r = vp.paper_rect_mm;
      const v = r && R.plan.viewports && R.plan.viewports[String(vp.element_id)];
      // the route needs the plan's cut; the Area tool its rooms
      if (!v || (rooms ? !(v.rooms || []).length : !Object.keys(v.cats || {}).length)) continue;
      if (p[0] >= r[0] && p[0] <= r[0] + r[2] && p[1] >= r[1] && p[1] <= r[1] + r[3] && r[2] * r[3] < area) { best = vp; area = r[2] * r[3]; }
    }
    return best;
  }

  const settings = (it) => Object.assign({}, DEF, it.route || {});
  const blockOf = (st) => (Array.isArray(st.block) ? st.block : (R.blocking.length ? R.blocking : ["Walls"]))
    .filter((c) => !R.cats.length || R.cats.includes(c));
  const scaleOf = (it) => { const s = activeScale(it.points_mm[0], it); return s ? s.scale : null; };
  const k2 = (p) => p[0].toFixed(2) + "," + p[1].toFixed(2);
  function legKey(it, i) {
    const st = settings(it);
    const a = it.points_mm[i], b = it.points_mm[i + 1];
    if (st.mode !== "shortest") return "p|" + k2(a) + "|" + k2(b);
    return ["s", k2(a), k2(b), blockOf(st).join(","), st.clear_mm, scaleOf(it) || "", R.key].join("|");
  }
  function stale(it) {
    const n = it.points_mm.length - 1;
    for (let i = 0; i < n; i++) if (!it.leg_for || it.leg_for[i] !== legKey(it, i)) return true;
    return false;
  }

  /* The legs looked for again where their ends or settings changed */
  async function refresh(it) {
    if (!it || it.type !== "route") return false;
    const st = settings(it);
    const n = it.points_mm.length - 1;
    const legs = [], keys = [];
    for (let i = 0; i < n; i++) keys.push(legKey(it, i));
    const old = it.leg_for || [], oldLegs = it.legs_mm || [];
    const want = [];
    for (let i = 0; i < n; i++) {
      const j = old.indexOf(keys[i]);          // a leg kept from before (also when a point was added before it)
      if (j >= 0 && oldLegs[j]) legs[i] = oldLegs[j];
      else if (st.mode !== "shortest") legs[i] = [it.points_mm[i], it.points_mm[i + 1]];
      else want.push(i);
    }
    if (want.length) {
      if (R.loading) await R.loading;
      const vp = viewportAt(it.points_mm[0]);
      const sc = scaleOf(it);
      const w = worker();
      let found = null;
      if (vp && sc && w) {
        const req = ++R.req;
        found = await new Promise((res) => {
          R.wait.set(req, res);
          w.postMessage({ op: "route", req, key: R.key, vp: String(vp.element_id), rect: vp.paper_rect_mm,
            block: blockOf(st), cell: CELL_MODEL_MM / sc, clear: (Number(st.clear_mm) || 0) / sc,
            legs: want.map((i) => [it.points_mm[i], it.points_mm[i + 1]]) });
          setTimeout(() => { if (R.wait.has(req)) { R.wait.delete(req); res(null); } }, 20000);
        });
      }
      want.forEach((i, k) => {
        const pts = found && found.legs && found.legs[k];
        // nothing found (or no plan here): straight, and the leg says so
        legs[i] = pts ? pts.map((p) => [+p[0].toFixed(2), +p[1].toFixed(2)]) : [it.points_mm[i], it.points_mm[i + 1]];
        if (!pts) keys[i] = "x|" + keys[i];
      });
    }
    it.legs_mm = legs;
    it.leg_for = keys;
    return true;
  }

  /* What to draw: the legs (a leg still being looked for: straight) */
  function legsOf(it) {
    const out = [];
    const n = it.points_mm.length - 1;
    for (let i = 0; i < n; i++) {
      const k = legKey(it, i), have = it.leg_for && it.leg_for[i];
      const ok = have === k && it.legs_mm && it.legs_mm[i];
      const failed = have === "x|" + k;
      out.push({ pts: ok ? it.legs_mm[i] : [it.points_mm[i], it.points_mm[i + 1]], pending: !ok && !failed, failed });
    }
    return out;
  }

  const plen = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };

  /* The length in the building (m), or null without a scale */
  function lengthM(it) {
    const sc = scaleOf(it);
    if (!sc) return null;
    return legsOf(it).reduce((s, l) => s + plen(l.pts), 0) * sc / 1000;
  }

  function label(it) {
    const st = settings(it);
    const L = lengthM(it);
    const paper = legsOf(it).reduce((s, l) => s + plen(l.pts), 0);
    const head = st.purpose && st.purpose !== "Distance" ? st.purpose + ": " : "";
    if (L == null) return { text: head + paper.toFixed(1) + " mm (paper - set a scale)", state: "" };
    const lim = Number(st.limit_m);
    let text = head + L.toFixed(2) + " m", state = "";
    const lg = legsOf(it);
    if (lg.some((l) => l.failed)) {
      // a leg drawn straight because nothing gets through: no verdict on it
      return { text: text + "  - no way through: move a point or untick what blocks it", state: "fail" };
    }
    if (lim > 0) {
      if (L <= lim + 1e-9) { text += "  ≤ " + lim + " m ✓"; state = "ok"; }
      else { text += "  " + (L - lim).toFixed(2) + " m over " + lim + " m"; state = "over"; }
    }
    if (lg.some((l) => l.pending)) text += "  ...";
    return { text, state };
  }

  /* Where the + of leg i sits: halfway along it */
  function legMid(it, i) {
    const l = legsOf(it)[i];
    if (!l) return null;
    const half = plen(l.pts) / 2;
    let s = 0;
    for (let k = 1; k < l.pts.length; k++) {
      const a = l.pts[k - 1], b = l.pts[k], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (s + d >= half && d > 0) { const f = (half - s) / d; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
      s += d;
    }
    return l.pts[0];
  }

  /* A new route takes the panel's settings, and the scale in force */
  function stamp(it) {
    // a double-click to finish clicks the last point more than once
    it.points_mm = it.points_mm.filter((p, i, a) => !i || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.3);
    if (it.points_mm.length < 2) it.points_mm.push(it.points_mm[0].slice());
    it.route = { mode: hasPlanAt(it.points_mm[0]) ? defaults.mode : "points", purpose: defaults.purpose,
      limit_m: defaults.limit_m, clear_mm: defaults.clear_mm, block: Array.isArray(defaults.block) ? defaults.block.slice() : null };
    if (!it.scale) { const s = activeScale(it.points_mm[0], null); if (s) it.scale = s.scale; }
  }
  const hasPlanAt = (p) => !!viewportAt(p);

  /* After a change: the legs again, drawn, saved */
  async function changed(it) {
    await refresh(it);
    // the page's copy may have been replaced meanwhile (each save reloads
    // them): the legs go onto the one shown now
    const cur = S.items.find((x) => x.id === it.id);
    if (cur && cur !== it) {
      cur.route = it.route;
      cur.legs_mm = it.legs_mm;
      cur.leg_for = it.leg_for;
      if (stale(cur)) await refresh(cur);
    }
    redraw();
    putItem(cur || it);
    paintPanel();
  }

  /* ------------------------------------------------------------ the panel */

  function selected() {
    if (!S.sel || S.sel.length !== 1) return null;
    const it = S.items.find((x) => x.id === S.sel[0]);
    return it && it.type === "route" ? it : null;
  }

  function paintPanel() {
    const it = selected();
    const on = !!it || S.tool === "route";
    let p = R.panel;
    if (!on) { if (p) p.hidden = true; return; }
    if (!p) {
      p = R.panel = document.createElement("div");
      p.id = "route-panel";
      p.className = "rp-panel";
      document.body.appendChild(p);
    }
    p.hidden = false;
    const st = it ? settings(it) : Object.assign({}, DEF, defaults);
    const plan = !!R.plan;
    const here = it ? hasPlanAt(it.points_mm[0]) : plan;
    const block = new Set(blockOf(st));
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const L = it ? label(it) : null;
    p.innerHTML = `<div class="rp-h"><b>${it ? "Route" : "New route"}</b>${L ? `<span class="rp-len ${L.state}">${esc(L.text)}</span>` : ""}</div>`
      + `<div class="rp-r"><label>For <select data-k="purpose">${PURPOSES.map((x) => `<option${x === st.purpose ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></label>`
      + `<label>Limit <input data-k="limit_m" type="number" min="0" step="0.5" value="${esc(st.limit_m)}" placeholder="none"> m</label></div>`
      + `<div class="rp-r rp-mode"><label><input type="radio" name="rp-mode" value="shortest"${st.mode === "shortest" ? " checked" : ""}${plan ? "" : " disabled"}> Shortest route</label>`
      + `<label><input type="radio" name="rp-mode" value="points"${st.mode !== "shortest" || !plan ? " checked" : ""}> Points I click</label></div>`
      + (plan
        ? `<div class="rp-cats"${st.mode === "shortest" ? "" : " hidden"}><div class="rp-sub">Blocks the route <small>(unticked: passes through)</small></div>`
          + R.cats.map((c) => `<label><input type="checkbox" data-cat="${esc(c)}"${block.has(c) ? " checked" : ""}> ${esc(c)}</label>`).join("")
          + `<label class="rp-clear">Clearance from walls <input data-k="clear_mm" type="number" min="0" step="50" value="${esc(st.clear_mm)}"> mm</label></div>`
        : `<div class="rp-note">This sheet has no plan cut yet: the distance is the total of the points you click. Publish the sheet again from Revit (floor plans) to find the shortest route round the walls.</div>`)
      + (it && st.mode === "shortest" && !here && plan ? `<div class="rp-note">The start is not on a published floor plan of this sheet: straight from point to point.</div>` : "")
      + `<div class="rp-tip">${it ? "Drag a point to adjust; + on a leg adds a point the route must pass; double-click a point to remove it."
        : "Click the start, then the end - double-click (or Enter) to finish. Click points on the way to make the route pass them."}</div>`
      + (it && st.mode === "shortest" && plan ? `<div class="rp-r"><button type="button" data-act="again">Find again</button></div>` : "");
    const apply = (patch) => {
      if (it) {
        it.route = Object.assign(settings(it), patch);
        changed(it);
      } else {
        Object.assign(defaults, patch);
        keepDefaults();
        paintPanel();
      }
    };
    for (const el of p.querySelectorAll("[data-k]")) el.onchange = () => apply({ [el.dataset.k]: el.type === "number" ? (el.value === "" ? "" : Number(el.value)) : el.value });
    for (const el of p.querySelectorAll("[name=rp-mode]")) el.onchange = () => apply({ mode: el.value });
    for (const el of p.querySelectorAll("[data-cat]")) el.onchange = () => {
      apply({ block: [...p.querySelectorAll("[data-cat]")].filter((x) => x.checked).map((x) => x.dataset.cat) });
    };
    const again = p.querySelector("[data-act=again]");
    if (again) again.onclick = () => { it.leg_for = []; changed(it); };
  }

  /* The Revit room round a paper point (Area > Click inside), or null */
  function roomAt(p) {
    const vp = viewportAt(p, true);
    if (!vp) return null;
    const inside = (P, L) => {
      let c = false;
      for (let i = 0, j = L.length - 1; i < L.length; j = i++) {
        const a = L[i], b = L[j];
        if ((a[1] > P[1]) !== (b[1] > P[1]) && P[0] < (b[0] - a[0]) * (P[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
      }
      return c;
    };
    let best = null, area = Infinity;
    for (const r of R.plan.viewports[String(vp.element_id)].rooms || []) {
      const L = r.loops || [];
      if (!L.length || !inside(p, L[0]) || L.slice(1).some((h) => inside(p, h))) continue;
      let a = 0;
      for (let i = 0; i < L[0].length; i++) { const q = L[0][i], w = L[0][(i + 1) % L[0].length]; a += q[0] * w[1] - w[0] * q[1]; }
      if (Math.abs(a) < area) { area = Math.abs(a); best = r; }
    }
    return best;
  }
  const hasRooms = () => !!(R.plan && Object.values(R.plan.viewports || {}).some((v) => (v.rooms || []).length));

  return { roomAt, hasRooms, loadPlan, refresh, changed, legsOf, legMid, label, lengthM, stamp, paintPanel, stale, hasPlan: () => !!R.plan };
}
