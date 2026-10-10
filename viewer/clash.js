/* Clash check on the 3D page (the Checks section of the left panel).
 *
 * A rule is "set A against set B": each a model loaded here (the project's
 * own, a consultant's IFC, another project overlaid) and some of its
 * categories. A and B may be the same model - clashes inside the
 * architectural model. Rules are kept as items (placement "clashrule"),
 * like saved views, so everyone on the project sees the same rules and
 * the last result.
 *
 * A run: the boxes of every element in A and B (the models answer
 * getBoxes), the pairs whose boxes overlap (clashcore.pairs), then the
 * triangles of those pairs only (getItemsGeometry) judged in a worker
 * (clash-worker.js -> clashcore.judge). The result is compared with the
 * rule's last one: New, Still there, Gone.
 *
 * It checks what the viewer draws (Revit at medium detail, the IFC as
 * converted): quick everyday coordination, not a formal clash report.
 */
import { pairs as boxPairs } from "./clashcore.js";
import { createGeo, catLabel, scopePicker } from "./checkgeo.js";
import { saveCsv, fileName, reportTab, tabSay, writeReport, pictures } from "./checkexport.js";

const OPENINGS = new Set(["Doors", "Windows", "Curtain Panels", "Curtain Wall Mullions",
  "IFCDOOR", "IFCWINDOW", "IFCPLATE", "IFCMEMBER", "IFCOPENINGELEMENT", "IFCDOORSTANDARDCASE", "IFCWINDOWSTANDARDCASE"]);
const HOSTS = new Set(["Walls", "Floors", "Roofs", "Ceilings", "Curtain Systems",
  "IFCWALL", "IFCWALLSTANDARDCASE", "IFCCURTAINWALL", "IFCSLAB", "IFCROOF", "IFCCOVERING"]);
/* The building's fabric: two of these overlapping where they meet (a wall
   through a slab, a finish under a wall, a beam into a column) is a join,
   not a clash - unless the rule says otherwise (clashcore isJoin). */
// (not ceilings: a beam or a duct down through a ceiling is a real clash)
const FABRIC = new Set(["Walls", "Floors", "Roofs", "Columns", "Structural Columns", "Structural Framing",
  "Structural Foundations", "Stairs", "Runs", "Landings", "Ramps", "Railings", "Curtain Panels", "Curtain Wall Mullions",
  "IFCWALL", "IFCWALLSTANDARDCASE", "IFCCURTAINWALL", "IFCSLAB", "IFCROOF", "IFCCOLUMN", "IFCBEAM",
  "IFCMEMBER", "IFCPLATE", "IFCFOOTING", "IFCPILE", "IFCSTAIR", "IFCSTAIRFLIGHT", "IFCRAMP", "IFCRAMPFLIGHT", "IFCRAILING"]);
const MAX_PAIRS = 30000;           // boxes that touch; more: asked first (it takes a while)
const HARD_PAIRS = 1000000;        // more than this: a smaller scope only
const MS_PAIR = 2.5;               // about how long a pair takes to judge (ms)
const CHUNK = 120;                 // pairs judged per round trip
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const isRule = (it) => it && it.placement === "clashrule" && !it.deleted;
const isSet = (it) => it && it.placement === "clashset" && !it.deleted;
const COLS = { a: "#f28022", b: "#1e88e5" };      // A and B, unless chosen (per person)
/* A side's name filter: words (comma between) in the name, type or family. */
export function nameMatch(side, label) {
  const q = String(side.q || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
  if (!q.length) return true;
  const t = [label.name, label.type, label.family, label.cat].filter(Boolean).join(" ").toLowerCase();
  const hit = q.some((w) => t.includes(w));
  return side.qmode === "not" ? !hit : hit;
}

export { catLabel };

export function createClash(ctx) {
  const { THREE } = ctx;
  const C = { rules: [], ruleId: null, running: false, stop: false, result: null, shown: [], marker: null, worker: null,
              filter: "all", elsewhere: false, msg: null, over: null, force: false };
  const $ = (s) => document.querySelector(s);
  const box = $("#clash-box");
  if (!box) return null;

  /* ------------------------------------------------------- the models */

  const geo = createGeo(ctx);
  const models = geo.models, modelByKey = geo.modelByKey, catsOf = geo.catsOf;
  // a side's models: ["*"] (every model loaded) or keys; rules from before
  // had one model ({ model })
  const sideKeys = (side) => (side.models && side.models.length ? side.models : side.model ? [side.model] : []);
  // a saved selection set (shared with the project): a side may follow one
  const sets = () => (ctx.items() || []).filter(isSet).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const setById = (id) => (id ? sets().find((x) => x.id === id) || null : null);
  // what a side picks now: its set's models, categories and name filter if it follows one
  const resolve = (side) => {
    const st = setById(side.set);
    return st ? { models: st.models || [], cats: st.cats || [], q: st.q || "", qmode: st.qmode || "has", set: st.id, setName: st.name } : side;
  };
  const sideModels = (side) => {
    const keys = sideKeys(side);
    return keys.includes("*") ? models() : keys.map(modelByKey).filter(Boolean);
  };
  const sideText = (side0) => {
    const side = resolve(side0);
    const keys = sideKeys(side);
    const ms = keys.includes("*") ? "all models" : keys.length === 1 ? ((modelByKey(keys[0]) || {}).label || keys[0]) : keys.length + " models";
    return `${side.setName ? "set \u201c" + side.setName + "\u201d - " : ""}${ms}: ${(side.cats || []).map(catLabel).slice(0, 3).join(", ")}${(side.cats || []).length > 3 ? " +" + (side.cats.length - 3) : ""}`
      + (side.q ? ` (name ${side.qmode === "not" ? "without" : "with"} \u201c${side.q}\u201d)` : "");
  };

  /* -------------------------------------------------------- the rules */

  function loadRules() {
    C.rules = (ctx.items() || []).filter(isRule).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (!C.rules.some((r) => r.id === C.ruleId)) C.ruleId = C.rules.length ? C.rules[0].id : null;
    try { const k = localStorage.getItem(ctx.storeKey("rule")); if (k && C.rules.some((r) => r.id === k)) C.ruleId = k; } catch (e) {}
    const sel = $("#clash-rule");
    sel.innerHTML = C.rules.length ? C.rules.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")
      : `<option value="">No rules yet - press + to make one</option>`;
    sel.value = C.ruleId || "";
    $("#clash-edit").disabled = $("#clash-run").disabled = !C.ruleId;
    $("#clash-del").disabled = !C.ruleId;
    const r = rule();
    C.result = r && r.last ? r.last : null;
    $("#clash-info").innerHTML = r
      ? `Shared with the project${r.author ? " · made by " + esc(r.author) : ""}<br>A: ${esc(sideText(r.a))}<br>B: ${esc(sideText(r.b))}`
      : "Rules are shared with everyone on the project.";
    paint();
  }
  const rule = () => C.rules.find((r) => r.id === C.ruleId) || null;
  const selSig = (x) => JSON.stringify([[...sideKeys(x)].sort(), [...(x.cats || [])].sort(), x.q || "", x.q ? x.qmode || "has" : ""]);

  async function editRule(r) {
    const ms = models();
    if (!ms.length) { ctx.status("Load a model first."); return; }
    const isNew = !r;
    r = r ? JSON.parse(JSON.stringify(r)) : {
      id: ctx.uid(), placement: "clashrule", name: "", created_at: new Date().toISOString(), author: ctx.author(),
      a: { models: [ms[0].key], cats: [] }, b: { models: [(ms.find((m) => m.rec.ref && m.key !== ms[0].key) || ms[0]).key], cats: [] },
      tol_mm: 10, clear_mm: 0, skip_openings: true, skip_joins: true, open: false, ignored: [],
    };
    // a side following a set shows the set as it is now
    for (const s of ["a", "b"]) {
      const v = resolve(r[s]);
      r[s] = { models: sideKeys(v), cats: v.cats || [], q: v.q || "", qmode: v.qmode || "has", set: v.set || null };
    }
    const side = async (s, title) => {
      const keys = new Set(r[s].models);
      const all = keys.has("*");
      const chosen = all ? ms : ms.filter((m) => keys.has(m.key));
      // the categories of the models ticked, by name (Ducts in every MEP link at once)
      const names = new Set();
      for (const m of chosen) for (const k of (await catsOf(m)).keys()) names.add(k);
      const cats = [...names].sort((x, y) => catLabel(x).localeCompare(catLabel(y)));
      const on = new Set(r[s].cats || []);
      const ss = sets();
      return `<fieldset class="ck-side" data-side="${s}"><legend>${title}</legend>`
        + `<div class="ck-setbar"><select data-set title="A saved selection set: models, categories and a name filter, shared with the project">`
        + `<option value="">Custom selection</option>${ss.map((x) => `<option value="${esc(x.id)}"${r[s].set === x.id ? " selected" : ""}>Set: ${esc(x.name)}</option>`).join("")}</select>`
        + `<button type="button" class="ghost" data-saveset title="Keep this side's selection as a set, to pick in other rules">Save as set</button>`
        + `<button type="button" class="ghost" data-delset${r[s].set ? "" : " disabled"} title="Delete this set (rules using it keep its selection)">Delete set</button></div>`
        + `<div class="ck-cats-bar"><span class="muted">Models</span><button type="button" class="ghost" data-mall>All</button><button type="button" class="ghost" data-mnone>None</button></div>`
        + `<div class="ck-models"><label><input type="checkbox" data-allm${all ? " checked" : ""}> <b>All models</b></label>`
        + ms.map((x) => `<label><input type="checkbox" data-m value="${esc(x.key)}"${all || keys.has(x.key) ? " checked" : ""}${all ? " disabled" : ""}> ${esc(x.label)}</label>`).join("")
        + `</div>`
        + `<div class="ck-cats-bar"><button type="button" class="ghost" data-all>All</button><button type="button" class="ghost" data-none>None</button>`
        + `<input type="search" data-q placeholder="Filter"></div>`
        + `<div class="ck-cats">${cats.map((k) => `<label><input type="checkbox" value="${esc(k)}"${on.has(k) ? " checked" : ""}> ${esc(catLabel(k))}</label>`).join("")
          || '<span class="muted">Tick a model above.</span>'}</div>`
        + `<div class="ck-q"><select data-qmode aria-label="Name filter"><option value="has">Name has</option><option value="not"${r[s].qmode === "not" ? " selected" : ""}>Name has not</option></select>`
        + `<input type="text" data-qtext maxlength="200" value="${esc(r[s].q || "")}" placeholder="any name - or e.g. FLR, Finish" title="Words in the element's name, type or family; a comma between words: any of them"></div></fieldset>`;
    };
    const dlg = document.createElement("div");
    dlg.className = "ck-dlg-back";
    const draw = async () => {
      dlg.innerHTML = `<form class="ck-dlg" onsubmit="return false"><h3>${isNew ? "New clash rule" : "Clash rule"}</h3>`
        + `<label class="ck-name">Name <input name="name" required maxlength="80" value="${esc(r.name)}" placeholder="e.g. Ceilings x Beams"></label>`
        + `<div class="ck-sides">${await side("a", "Set A")}${await side("b", "Set B")}</div>`
        + `<div class="ck-opts"><label>Overlap that counts <input name="tol" type="number" min="0" max="500" step="1" value="${r.tol_mm}"> mm</label>`
        + `<label title="Also report elements that come closer than this without touching (0 = off)">Clearance <input name="clear" type="number" min="0" max="2000" step="5" value="${r.clear_mm}"> mm</label>`
        + `<label class="ck-chk"><input name="skip" type="checkbox"${r.skip_openings !== false ? " checked" : ""}> Leave out doors and windows in their walls, floors and roofs</label>`
        + `<div class="ck-help muted">A door or a window always sits inside the wall it is in - without this, each one is reported against its own wall.</div>`
        + `<label class="ck-chk"><input name="joins" type="checkbox"${r.skip_joins !== false ? " checked" : ""}> Leave out joins between walls, floors, roofs, columns, beams and stairs</label>`
        + `<div class="ck-help muted">Where these meet (a wall standing on a slab, a finish under a wall, a landing built into a wall) Revit cleans the join up, but each element is exported whole, so they overlap. On: only one mostly inside the other (a duplicate, one buried in another) counts. Services, furniture and ceilings are not affected.</div>`
        + `<label class="ck-chk"><input name="open" type="checkbox"${r.open ? " checked" : ""}> Report open surfaces crossing each other (no depth)</label>`
        + `<div class="ck-help muted">Some elements are surfaces, not closed solids (some IFC exports, a pipe without end caps). They have no inside, so how deep they cross cannot be measured. Off: a surface counts only where it goes into a solid. On: two surfaces that just cross are reported too - more thorough, more noise.</div></div>`
        + `<p class="muted ck-note">Set A and B can be the same model: clashes inside it. Checks what the viewer draws - quick coordination, not a formal clash report.</p>`
        + `<div class="ck-foot"><span class="ck-msg bad"></span><span class="spacer"></span><button type="button" class="ghost" data-x>Cancel</button><button type="submit" class="primary">Save</button></div></form>`;
      wire();
    };
    const keep = () => {
      const f = dlg.querySelector("form");
      r.name = f.name.value.trim();
      for (const s of ["a", "b"]) {
        const fs = f.querySelector(`[data-side="${s}"]`);
        r[s].models = fs.querySelector("[data-allm]").checked ? ["*"] : [...fs.querySelectorAll("[data-m]:checked")].map((x) => x.value);
        // categories not listed now (their model unticked) stay as they were
        const listed = new Set([...fs.querySelectorAll(".ck-cats input")].map((x) => x.value));
        r[s].cats = [...new Set([...(r[s].cats || []).filter((k) => !listed.has(k)),
                                 ...[...fs.querySelectorAll(".ck-cats input:checked")].map((x) => x.value)])];
        r[s].q = fs.querySelector("[data-qtext]").value.trim();
        r[s].qmode = fs.querySelector("[data-qmode]").value;
        // changed from its set: a custom selection from now on
        const st = setById(r[s].set);
        if (st && selSig(st) !== selSig(r[s])) r[s].set = null;
      }
      r.tol_mm = Math.max(0, Math.min(500, Number(f.tol.value) || 0));
      r.clear_mm = Math.max(0, Math.min(2000, Number(f.clear.value) || 0));
      r.skip_openings = f.skip.checked;
      r.open = f.open.checked;
      r.skip_joins = f.joins.checked;
    };
    let done;
    const ended = new Promise((res) => { done = res; });
    async function saveSet(s) {
      keep();
      const cur = setById(r[s].set);
      const name = (prompt("Name for this selection set (shared with the project)", cur ? cur.name : "") || "").trim().slice(0, 80);
      if (!name) return;
      const old = sets().find((x) => String(x.name).toLowerCase() === name.toLowerCase());
      if (old && old !== cur && !confirm(`Replace the set "${old.name}"? Rules using it will check the new selection.`)) return;
      const base = old || { id: ctx.uid(), placement: "clashset", created_at: new Date().toISOString(), author: ctx.author() };
      const it = Object.assign({}, base, { name, models: [...r[s].models], cats: [...r[s].cats], q: r[s].q || "", qmode: r[s].qmode || "has",
                                           updated_at: new Date().toISOString() });
      if (!(await ctx.putItem(it))) return;
      r[s].set = it.id;
      await draw();
      ctx.status(`Selection set "${name}" saved for everyone on the project.`);
    }
    const wire = () => {
      const f = dlg.querySelector("form");
      f.querySelector("[data-x]").onclick = () => { dlg.remove(); done(null); };
      f.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { dlg.remove(); done(null); } });
      for (const fs of f.querySelectorAll(".ck-side")) {
        const s = fs.dataset.side;
        // other models ticked: their categories listed, the ticks kept
        fs.querySelector(".ck-models").onchange = async () => { keep(); await draw(); };
        fs.querySelector("[data-mall]").onclick = async () => { keep(); r[s].models = ["*"]; r[s].set = null; await draw(); };
        fs.querySelector("[data-mnone]").onclick = async () => { keep(); r[s].models = []; r[s].set = null; await draw(); };
        fs.querySelector("[data-set]").onchange = async (ev) => {
          keep();
          const st = setById(ev.target.value);
          if (st) r[s] = { models: [...(st.models || [])], cats: [...(st.cats || [])], q: st.q || "", qmode: st.qmode || "has", set: st.id };
          else r[s].set = null;
          await draw();
        };
        fs.querySelector("[data-saveset]").onclick = () => saveSet(s);
        fs.querySelector("[data-delset]").onclick = async () => {
          const st = setById(r[s].set);
          if (!st || !confirm(`Delete the selection set "${st.name}"? Rules using it keep its selection.`)) return;
          keep();
          await ctx.putItem(Object.assign({}, st, { deleted: true, updated_at: new Date().toISOString() }));
          r[s].set = null;
          await draw();
        };
        fs.querySelector("[data-qmode]").onchange = () => keep();
        fs.querySelector("[data-all]").onclick = () => fs.querySelectorAll(".ck-cats label:not([hidden]) input").forEach((x) => { x.checked = true; });
        fs.querySelector("[data-none]").onclick = () => fs.querySelectorAll(".ck-cats input").forEach((x) => { x.checked = false; });
        fs.querySelector("[data-q]").oninput = (ev) => {
          const q = ev.target.value.trim().toLowerCase();
          fs.querySelectorAll(".ck-cats label").forEach((l) => { l.hidden = !!q && !l.textContent.toLowerCase().includes(q); });
        };
      }
      f.onsubmit = () => {
        keep();
        const msg = f.querySelector(".ck-msg");
        if (!r.name) { msg.textContent = "Give it a name."; return false; }
        if (!r.a.models.length || !r.b.models.length) { msg.textContent = "Tick at least one model on each side."; return false; }
        if (!r.a.cats.length || !r.b.cats.length) { msg.textContent = "Tick at least one category on each side."; return false; }
        dlg.remove(); done(r); return false;
      };
    };
    document.body.appendChild(dlg);
    await draw();
    setTimeout(() => { const n = dlg.querySelector("[name=name]"); if (n) n.focus(); }, 20);
    const got = await ended;
    if (!got) return;
    // a changed rule starts afresh: its old result asked a different question
    const old = rule();
    const sig = (x) => JSON.stringify([selSig(resolve(x.a)), selSig(resolve(x.b)), x.tol_mm, x.clear_mm, x.skip_openings, !!x.open, x.skip_joins !== false]);
    const same = !isNew && old && sig(got) === sig(old);
    if (!same) got.last = null;
    got.updated_at = new Date().toISOString();
    if (!(await ctx.putItem(got))) return;
    C.ruleId = got.id;
    try { localStorage.setItem(ctx.storeKey("rule"), got.id); } catch (e) {}
    loadRules();
    ctx.status(`Clash rule "${got.name}" saved for everyone on the project.`);
  }

  async function deleteRule() {
    const r = rule();
    if (!r || !confirm(`Delete the clash rule "${r.name}"? Issues made from it stay.`)) return;
    if (await ctx.putItem(Object.assign({}, r, { deleted: true }))) { C.ruleId = null; loadRules(); }
  }

  /* ------------------------------------------------------- the scope */

  const scope = scopePicker(ctx, THREE, $("#clash-scope"), $("#clash-from"), $("#clash-to"), $("#clash-fr"));
  const scopeTest = () => scope.get();
  const fillScope = () => scope.fill();

  /* -------------------------------------------------- the elements' data */

  const E = new Map();          // "partId:lid" -> { part, lid, cat, box }
  const ekey = (part, lid) => part.id + ":" + lid;

  async function setOf(side, sc, which) {
    const ms = sideModels(side);
    if (!ms.length) throw new Error(`None of the models of ${which} is loaded here - turn them on in the Models panel first.`);
    const out = [];
    for (const m of ms) {
      await geo.elementsOf(m, side.cats, sc.test, (el) => {
        const key = ekey(el.part, el.lid);
        if (!E.has(key)) E.set(key, el);
        out.push(key);
      }, () => C.stop, progress);
      if (C.stop) break;
    }
    return [...new Set(out)];
  }

  // the triangles of these elements (keys), for the worker
  async function trisOf(keys) {
    const t = await geo.trisOf(keys.map((k) => E.get(k)));
    const out = [];
    keys.forEach((k, i) => { if (t[i]) out.push({ k, tris: t[i], box: E.get(k).box }); });
    return out;
  }

  /* ---------------------------------------------------------- the worker */

  let jid = 0;
  const waiting = new Map();
  function worker() {
    if (C.worker !== null) return C.worker;
    try {
      C.worker = new Worker(new URL("./clash-worker.js", import.meta.url), { type: "module" });
      C.worker.onmessage = (ev) => {
        const w = waiting.get(ev.data.id);
        if (w) { waiting.delete(ev.data.id); w(ev.data.out); }
      };
      C.worker.onerror = () => { C.worker = false; for (const w of waiting.values()) w(null); waiting.clear(); };
    } catch (e) { C.worker = false; }
    return C.worker;
  }
  // without a worker (an old browser): the same judge, here, a little at a time
  let inline = null;
  async function judgeHere(els, ps, opt) {
    if (!inline) inline = { judge: (await import("./clashcore.js")).judge, els: new Map() };
    for (const e of els) inline.els.set(e.k, e);
    const out = [];
    const optJ = Object.assign({}, opt, { join: true });
    for (const [n, a, b, j] of ps) {
      const A = inline.els.get(a), B = inline.els.get(b);
      out.push([n, A && B ? inline.judge(A, B, j ? optJ : opt) : null]);
      if (out.length % 10 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    return out;
  }
  function judgeThere(els, ps, opt) {
    const w = worker();
    if (!w) return judgeHere(els, ps, opt);
    if (els.length) w.postMessage({ type: "add", els: els.map((e) => ({ k: e.k, tris: e.tris, box: e.box })) }, els.map((e) => e.tris.buffer));
    const id = ++jid;
    return new Promise((res) => {
      waiting.set(id, (out) => res(out || judgeHere(els, ps, opt)));
      w.postMessage({ type: "judge", id, pairs: ps, opt });
    });
  }
  function dropThere(keys) {
    if (C.worker) C.worker.postMessage({ type: "drop", keys });
    if (inline) for (const k of keys) inline.els.delete(k);
  }

  /* ------------------------------------------------------------- a run */

  function progress(t) {
    const p = $("#clash-prog");
    p.hidden = !t;
    p.querySelector("span").textContent = t || "";
  }

  const dur = (ms) => (ms < 90e3 ? Math.max(1, Math.round(ms / 1000)) + " s" : ms < 5400e3 ? Math.round(ms / 60e3) + " min" : (ms / 3600e3).toFixed(1) + " h");
  // a clash's name: the pair of elements' ids (checkgeo nameAll)
  const nameAll = (keys) => geo.nameAll(keys.map((k) => E.get(k)));

  async function run() {
    const r0 = rule();
    if (!r0 || C.running) return;
    const sc = scopeTest();
    if (sc.err) { ctx.status(sc.err); C.msg = sc.err; paint(); return; }
    // the sides as they pick now (a saved set may have changed)
    const r = Object.assign({}, r0, { a: resolve(r0.a), b: resolve(r0.b) });
    const force = C.force;
    C.force = false; C.over = null; C.msg = null;
    C.running = true; C.stop = false;
    $("#clash-run").hidden = true; $("#clash-stop").hidden = false;
    const t0 = performance.now();
    E.clear();
    let found = null, cand = null, nA = 0, nB = 0, sameSet = false;
    try {
      const a = await setOf(r.a, sc, "set A");
      const keysOf = (side) => sideModels(side).map((m) => m.key).sort().join("|");
      sameSet = keysOf(r.a) === keysOf(r.b) && JSON.stringify([...r.a.cats].sort()) === JSON.stringify([...r.b.cats].sort())
        && (r.a.q || "") === (r.b.q || "") && (r.a.qmode || "has") === (r.b.qmode || "has");
      const b = sameSet ? a : await setOf(r.b, sc, "set B");
      nA = a.length; nB = sameSet ? 0 : b.length;
      if (C.stop) throw new Error("Stopped.");
      const tol = (r.tol_mm || 0) / 1000, clear = (r.clear_mm || 0) / 1000;
      progress(`Comparing ${a.length} with ${b.length} elements ...`);
      const need = clear > 0 ? -clear : tol;
      cand = boxPairs(a.map((k) => E.get(k).box), sameSet ? null : b.map((k) => E.get(k).box), need, sameSet)
        .map(([i, j]) => [a[i], (sameSet ? a : b)[j]]);
      // never an element against itself (a model in both sets), each pair once
      const seenP = new Set();
      cand = cand.filter(([x, y]) => {
        if (x === y) return false;
        const k = x < y ? x + "~" + y : y + "~" + x;
        if (seenP.has(k)) return false;
        seenP.add(k);
        if (r.skip_openings !== false) {
          const cx = E.get(x).cat, cy = E.get(y).cat;
          if ((OPENINGS.has(cx) && HOSTS.has(cy)) || (OPENINGS.has(cy) && HOSTS.has(cx))) return false;
        }
        return true;
      });
      // a name filter: only the elements whose boxes touch something are named
      if (r.a.q || r.b.q) {
        progress(`Reading the names of ${new Set(cand.flat()).size} elements ...`);
        await nameAll([...new Set(cand.flat())]);
        const okA = (k) => nameMatch(r.a, E.get(k).label || {}), okB = (k) => nameMatch(r.b, E.get(k).label || {});
        cand = cand.filter(([x, y]) => (okA(x) && okB(y)) || (sameSet && okA(y) && okB(x)));
      }
      if (cand.length > HARD_PAIRS || (cand.length > (C.maxPairs || MAX_PAIRS) && !force)) {
        C.over = { n: cand.length, scope: sc.label, hard: cand.length > HARD_PAIRS };
        throw new Error(`${cand.length.toLocaleString()} pairs of elements touch ${sc.label}` + (C.over.hard ? " - too many to check at once." : " - that takes a while."));
      }
      // near each other first, so each element's triangles are fetched once and let go
      const ctr = (k) => { const bb = E.get(k).box; return (bb[0] + bb[3]) * 0.5 + (bb[2] + bb[5]) * 0.5 * 1e-3 + (bb[1] + bb[4]) * 1e3; };
      cand.sort((p, q) => Math.min(ctr(p[0]), ctr(p[1])) - Math.min(ctr(q[0]), ctr(q[1])));
      const left = new Map();
      for (const [x, y] of cand) { left.set(x, (left.get(x) || 0) + 1); left.set(y, (left.get(y) || 0) + 1); }
      const sent = new Set();
      found = [];
      const opt = { tol, clear, open: !!r.open };
      const tJ = performance.now();
      for (let i = 0; i < cand.length; i += CHUNK) {
        if (C.stop) throw new Error("Stopped.");
        const chunk = cand.slice(i, i + CHUNK);
        const fresh = [...new Set(chunk.flat())].filter((k) => !sent.has(k));
        const els = await trisOf(fresh);
        for (const e of els) sent.add(e.k);
        const joins = r.skip_joins !== false;
        const out = await judgeThere(els, chunk.map((p, n) => [i + n, p[0], p[1],
          joins && FABRIC.has(E.get(p[0]).cat) && FABRIC.has(E.get(p[1]).cat)]), opt);
        for (const [n, res] of out || []) if (res) found.push({ a: cand[n][0], b: cand[n][1], res });
        // let go of what no later pair needs
        const drop = [];
        for (const [x, y] of chunk) for (const k of [x, y]) {
          const n = left.get(k) - 1;
          left.set(k, n);
          if (!n) { drop.push(k); sent.delete(k); }
        }
        if (drop.length) dropThere(drop);
        const done = Math.min(i + CHUNK, cand.length);
        const eta = (performance.now() - tJ) / done * (cand.length - done);
        progress(`Checking ${done.toLocaleString()} of ${cand.length.toLocaleString()} pairs - ${found.length} found`
          + (cand.length > 5000 && done > CHUNK * 3 ? ` - about ${dur(eta)} to go` : "") + " ...");
      }
      await finish(r0, sc, found, { pairs: cand.length, a: nA, b: nB, ms: performance.now() - t0 });
    } catch (e) {
      const msg = String(e.message || e);
      // stopped part way: what was found so far is kept (nothing marked gone)
      if (msg === "Stopped." && found && found.length && cand) {
        C.msg = `Stopped: ${found.length} found in the pairs checked so far - kept. Run again to check them all.`;
        await finish(r0, sc, found, { pairs: cand.length, a: nA, b: nB, ms: performance.now() - t0, partial: true });
      } else {
        C.msg = msg;
        ctx.status("Clash check: " + msg);
        progress("");
        paint();
      }
    } finally {
      C.running = false;
      $("#clash-run").hidden = false; $("#clash-stop").hidden = true;
      if (C.worker) C.worker.postMessage({ type: "clear" });
      if (inline) inline.els.clear();
    }
  }

  async function finish(r, sc, found, stats) {
    progress("Naming what was found ...");
    const ignored = new Set(r.ignored || []);
    const now = {};
    await nameAll([...new Set(found.flatMap((f) => [f.a, f.b]))]);
    for (const f of found) {
      const ia = E.get(f.a).id, ib = E.get(f.b).id;
      const where = sc.label;
      const key = ia < ib ? ia + "~" + ib : ib + "~" + ia;
      if (now[key]) continue;
      const A = E.get(ia < ib ? f.a : f.b), B = E.get(ia < ib ? f.b : f.a);
      now[key] = {
        key, kind: f.res.kind, depth_mm: f.res.depth != null ? Math.round(f.res.depth * 1000) : null,
        dist_mm: f.res.kind === "clearance" ? Math.round(f.res.dist * 1000) : null,
        point: f.res.point.map((v) => +v.toFixed(3)),
        // and in the project's coordinates: the scene's origin follows the
        // first model loaded, which another session may load differently
        point_shared_mm: ctx.toShared(new THREE.Vector3(...f.res.point)),
        // how big the place is (to frame it)
        size: f.res.box ? +Math.hypot(f.res.box[3] - f.res.box[0], f.res.box[4] - f.res.box[1], f.res.box[5] - f.res.box[2]).toFixed(2) : null,
        level: ctx.levelAt(f.res.point[1]) || "",
        a: Object.assign({ cat_key: A.cat }, A.label), b: Object.assign({ cat_key: B.cat }, B.label),
        ignored: ignored.has(key) || undefined,
        where,
      };
    }
    // compared with the last run: what is new, and what has gone (within what was checked this time)
    const prev = (r.last && r.last.clashes) || {};
    const inScope = inScopeOf(sc);
    let nNew = 0, nGone = 0;
    for (const c of Object.values(now)) {
      const was = prev[c.key];
      c.state = was && was.state !== "gone" ? "still" : "new";
      c.first_at = was && was.first_at ? was.first_at : new Date().toISOString();
      if (c.state === "new" && !c.ignored) nNew++;
    }
    for (const [k, c] of Object.entries(prev)) {
      if (now[k] || c.state === "gone") continue;
      if (stats.partial || !inScope(c)) { now[k] = c; continue; }          // not looked at this time: as it was
      now[k] = Object.assign({}, c, { state: "gone", gone_at: new Date().toISOString() });
      nGone++;
    }
    for (const [k, c] of Object.entries(prev)) if (!now[k] && c.state === "gone" && Date.now() - Date.parse(c.gone_at || 0) < 30 * 864e5) now[k] = c;
    // when each place was last checked (the list shows the one chosen)
    const runs = Object.assign({}, (r.last && r.last.runs) || {});
    runs[sc.label] = { at: new Date().toISOString(), by: ctx.author(), pairs: stats.pairs, partial: !!stats.partial };
    for (const k of Object.keys(runs).sort((x, y) => Date.parse(runs[y].at) - Date.parse(runs[x].at)).slice(20)) delete runs[k];
    const last = { at: new Date().toISOString(), by: ctx.author(), scope: sc.label, stats, runs, clashes: now };
    C.result = last;
    // kept on the rule for everyone (the biggest results only partly)
    const keepN = Object.values(now).sort((x, y) => (x.state === "gone") - (y.state === "gone")).slice(0, 2500);
    const saved = Object.assign({}, r, { last: Object.assign({}, last, { clashes: Object.fromEntries(keepN.map((c) => [c.key, c])) }) });
    const okSave = await ctx.putItem(saved);
    progress("");
    paint();
    const live = Object.values(now).filter((c) => c.state !== "gone" && !c.ignored);
    const n = live.filter(inScope).length, elsewhere = live.length - n;
    ctx.status(`${r.name}: ${n} clash${n === 1 ? "" : "es"} ${sc.label}`
      + (elsewhere ? ` (${elsewhere} elsewhere, kept from earlier runs)` : "")
      + (nNew ? `, ${nNew} new` : "") + (nGone ? `, ${nGone} gone since last time` : "")
      + ` (${stats.pairs} pairs checked in ${(stats.ms / 1000).toFixed(1)} s)` + (okSave ? "." : " - the result could not be saved."));
  }

  /* ---------------------------------------------------------- the list */

  // clashes near each other and sharing an element: one group
  function groups(list) {
    const parent = list.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const byEl = new Map();
    list.forEach((c, i) => {
      for (const id of c.key.split("~")) {
        if (!byEl.has(id)) byEl.set(id, []);
        byEl.get(id).push(i);
      }
    });
    for (const ids of byEl.values()) {
      for (let k = 1; k < ids.length; k++) {
        const p = list[ids[0]].point, q = list[ids[k]].point;
        if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 4) parent[find(ids[k])] = find(ids[0]);
      }
    }
    const g = new Map();
    list.forEach((c, i) => { const r = find(i); if (!g.has(r)) g.set(r, []); g.get(r).push(c); });
    return [...g.values()];
  }
  const issueOf = (key) => (ctx.items() || []).find((it) => it.clash && it.clash.key === key && !it.deleted) || null;
  const KIND = { hard: "Overlap", inside: "Inside", cross: "Crossing", clearance: "Too close" };
  const amount = (c) => (c.kind === "clearance" ? `${c.dist_mm} mm apart` : c.depth_mm != null ? `${c.depth_mm} mm` : "");

  // is a saved clash inside this scope (where it is in project coordinates)
  const inScopeOf = (sc) => (c) => {
    if (!sc || !sc.test) return true;
    const f = c.point_shared_mm ? ctx.fromShared(c.point_shared_mm) : null;
    const p = f ? f.toArray() : c.point;
    return sc.test([p[0], p[1], p[2], p[0], p[1], p[2]]);
  };
  // A and B colours: chosen by each person, kept in this browser
  const colours = () => { try { return Object.assign({}, COLS, JSON.parse(localStorage.getItem("lwk-clash-colours") || "{}")); } catch (e) { return Object.assign({}, COLS); } };

  function paint() {
    const list = $("#clash-list"), sum = $("#clash-sum");
    const res = C.result, r0 = rule();
    // the message of the last try (too many pairs, stopped, an error)
    let top = "";
    if (C.over) {
      const est = C.over.n * MS_PAIR;
      top = `<div class="ck-over"><b>${C.over.n.toLocaleString()} pairs of elements touch ${esc(C.over.scope)}.</b> `
        + (C.over.hard ? "Too many to check at once - check some floors, or inside the section box."
          : `Checking them all takes about ${dur(est)} (you can Stop at any time; what is found so far is kept).`)
        + `<div class="ck-acts">${C.over.hard ? "" : '<button class="primary" data-over="all">Check them all</button>'}`
        + `<button class="ghost" data-over="floors">Choose floors instead</button></div></div>`;
    } else if (C.msg) top = `<div class="ck-over">${esc(C.msg)}</div>`;
    if (!res) {
      sum.innerHTML = top + (r0 && !top ? `<span class="muted">Not run yet. Choose where and press Run.</span>` : "");
      list.innerHTML = "";
      C.shown = [];
      return;
    }
    // the place chosen: the list shows what lies in it
    const sc = scope.get();
    const here = inScopeOf(sc.err ? null : sc);
    const label = sc.err ? "" : sc.label;
    const ran = (res.runs && res.runs[label]) || (res.scope === label ? { at: res.at, by: res.by } : null);
    const all = Object.values(res.clashes || {});
    const inHere = all.filter(here);
    const view = C.elsewhere ? all : inHere;
    const liveOf = (xs) => xs.filter((c) => c.state !== "gone" && !c.ignored);
    const nElse = liveOf(all).length - liveOf(inHere).length;
    const live = liveOf(view);
    const cnt = { all: live.length, new: live.filter((c) => c.state === "new").length,
                  gone: view.filter((c) => c.state === "gone").length, ignored: view.filter((c) => c.ignored && c.state !== "gone").length };
    // a quick filter on how deep, and the order (kept per rule, on this device)
    let hide = 0, order = "level";
    try { hide = Number(localStorage.getItem(ctx.storeKey("hide:" + (r0 && r0.id)))) || 0; order = localStorage.getItem(ctx.storeKey("order")) || "level"; } catch (e) {}
    const shallow = (c) => hide > 0 && c.depth_mm != null && c.depth_mm < hide;
    const nHidden = view.filter((c) => c.state !== "gone" && !c.ignored && shallow(c)).length;
    const when = (x) => new Date(x.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const col = colours();
    sum.innerHTML = top
      + `<div class="ck-when muted">${ran ? [when(ran), ran.by, label + (ran.partial ? " (stopped part way)" : "")].filter(Boolean).map(esc).join(" · ")
        : esc(label ? `Not checked ${label} yet - press Run.` : sc.err || "")}</div>`
      + (nElse > 0 || C.elsewhere ? `<div class="ck-else muted">${C.elsewhere ? `Showing everywhere (${nElse} elsewhere).` : `${nElse} more elsewhere, from earlier runs.`} `
        + `<button class="ghost" data-else>${C.elsewhere ? "Only here" : "Show"}</button></div>` : "")
      + `<div class="ck-legend"><label title="Colour of element A (kept in this browser)"><input type="color" data-col="a" value="${col.a}"> A</label>`
      + `<span class="muted">${esc(r0 ? sideText(r0.a) : "")}</span>`
      + `<label title="Colour of element B (kept in this browser)"><input type="color" data-col="b" value="${col.b}"> B</label>`
      + `<span class="muted">${esc(r0 ? sideText(r0.b) : "")}</span></div>`
      + `<div class="ck-tools"><label title="Leave out overlaps shallower than this (without running again)">Hide under <input type="number" id="clash-hide" min="0" max="500" step="5" value="${hide || ""}" placeholder="0"> mm</label>`
      + `<select id="clash-order" title="Order of the list"><option value="level"${order === "level" ? " selected" : ""}>By floor</option><option value="depth"${order === "depth" ? " selected" : ""}>Deepest first</option></select>`
      + `${nHidden ? ` <span class="muted">${nHidden} hidden</span>` : ""}</div>`
      + `<div class="ck-filt">${[["all", "Open", cnt.all], ["new", "New", cnt.new], ["gone", "Gone", cnt.gone], ["ignored", "Not an issue", cnt.ignored]]
        .map(([k, l, n]) => `<button class="ghost${C.filter === k ? " active" : ""}" data-f="${k}">${l} <b>${n}</b></button>`).join("")}</div>`
      + `<div class="ck-export"><span class="muted">Export the list</span><button class="ghost" data-exp="csv" title="A spreadsheet (CSV) of the clashes listed, for Excel">Spreadsheet</button>`
      + `<button class="ghost" data-exp="report" title="A report with a picture of each clash, to print or save as PDF">Report</button></div>`;
    const pick = view.filter((c) => C.filter === "gone" ? c.state === "gone"
      : C.filter === "ignored" ? c.ignored && c.state !== "gone"
      : C.filter === "new" ? c.state === "new" && !c.ignored && !shallow(c)
      : c.state !== "gone" && !c.ignored && !shallow(c));
    const deep = (c) => (c.depth_mm != null ? c.depth_mm : c.kind === "clearance" ? -1 : 0);
    pick.sort((x, y) => order === "depth" ? deep(y) - deep(x) : String(x.level).localeCompare(String(y.level)) || deep(y) - deep(x));
    C.shown = pick;
    C.order = order;
    if (!pick.length) {
      list.innerHTML = `<li class="muted ck-empty">${C.filter === "all" ? (ran || C.elsewhere ? "No clashes " + esc(C.elsewhere ? "" : label) + "." : "") : "None."}</li>`;
      return;
    }
    const row = (c) => {
      const iss = issueOf(c.key);
      const n = C.shown.indexOf(c);
      return `<li class="ck-it${c.state === "new" ? " new" : ""}${c.state === "gone" ? " gone" : ""}${c.key === C.onKey ? " on" : ""}" data-n="${n}">`
        + `<div class="ck-l1"><span class="ck-kind k-${c.kind}">${KIND[c.kind] || c.kind}</span> <b>${esc(amount(c))}</b>`
        + `${c.level ? ` <span class="muted">${esc(c.level)}</span>` : ""}`
        + `${c.state === "new" ? ' <span class="ck-new">New</span>' : ""}${c.state === "gone" ? ' <span class="ck-gone">Gone</span>' : ""}</div>`
        + `<div class="ck-l2">${esc(c.a.cat)}${c.a.name ? " · " + esc(c.a.name) : ""} <span class="muted">x</span> ${esc(c.b.cat)}${c.b.name ? " · " + esc(c.b.name) : ""}</div>`
        + `<div class="ck-acts">`
        + (iss ? `<button class="ghost" data-act="issue" title="Open its issue">Issue ${iss.issue && iss.issue.number ? "#" + iss.issue.number : ""} · ${esc((iss.issue && iss.issue.status) || "Open")}</button>`
          : c.state !== "gone" ? `<button class="ghost" data-act="make" title="Raise a Clash issue here, with a picture">Make issue</button>` : "")
        + (c.state !== "gone" ? `<button class="ghost" data-act="only" title="Show only these two elements">Only these</button>` : "")
        + `<button class="ghost" data-act="secoff" title="Take the section box away: the whole model again">Section off</button>`
        + (c.state !== "gone" ? `<button class="ghost" data-act="ign" title="${c.ignored ? "Count it again" : "Not an issue: leave it out of the list next time too"}">${c.ignored ? "Count again" : "Not an issue"}</button>` : "")
        + `</div></li>`;
    };
    let h = "";
    if (C.filter === "gone" || order === "depth") h = pick.map(row).join("");
    else {
      for (const g of groups(pick)) {
        if (g.length === 1) { h += row(g[0]); continue; }
        h += `<li class="ck-grp"><b>${g.length} clashes</b> <span class="muted">around ${esc(g[0].a.name || g[0].a.cat)}${g[0].level ? " · " + esc(g[0].level) : ""}</span></li>` + g.map(row).join("");
      }
    }
    list.innerHTML = h;
  }

  /* ------------------------------------------------------- showing one */

  /* Where a clash is now: between its two elements as loaded (the middle
     of where their boxes meet), else its point in project coordinates,
     else (results from before) the scene point it was found at. */
  async function placeOf(c) {
    const [A, B] = [await partLidOf(c.key.split("~")[0]), await partLidOf(c.key.split("~")[1])];
    if (A && B) {
      try {
        const [ba] = await A.part.model.getBoxes([A.lid]), [bb] = await B.part.model.getBoxes([B.lid]);
        if (ba && bb && !ba.isEmpty() && !bb.isEmpty()) {
          const i = ba.clone().intersect(bb);
          const p = (i.isEmpty() ? ba.clone().union(bb) : i).getCenter(new THREE.Vector3());
          // the found point, if it lies where they meet (it is the better spot)
          const f = c.point_shared_mm ? ctx.fromShared(c.point_shared_mm) : null;
          return { p: f && !i.isEmpty() && i.clone().expandByScalar(0.05).containsPoint(f) ? f : p, A, B };
        }
      } catch (e) { /* below */ }
    }
    if (c.point_shared_mm) { const f = ctx.fromShared(c.point_shared_mm); if (f) return { p: f, A, B }; }
    return { p: new THREE.Vector3(...c.point), A, B };
  }
  async function partLidOf(id) {
    for (const e of E.values()) if (e.id === id) return e;
    return geo.find(id);         // a saved result: as loaded now
  }
  function putMarker(p) {
    if (C.marker) { ctx.overlay().remove(C.marker); C.marker.geometry.dispose(); C.marker.material.dispose(); C.marker = null; }
    if (!p) return;
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xe2453c, depthTest: false, transparent: true, opacity: 0.8 }));
    m.position.set(p[0], p[1], p[2]);
    m.renderOrder = 1000;
    m.userData.clashMarker = true;
    const r = Math.max(0.03, ctx.cameraDistance() * 0.006);
    m.scale.setScalar(r);
    ctx.overlay().add(m);
    C.marker = m;
    ctx.redraw();
  }
  async function show(c, only, keepView) {
    const { p: at, A, B } = await placeOf(c);
    c._at = at;
    C.shownAt = at.toArray();
    const els = [A, B].filter(Boolean);
    const col = colours();
    await ctx.highlightMany(els, col);
    if (only && els.length) await ctx.isolateMany(els);
    if (!keepView) await look(c);
    putMarker(at.toArray());
    const twoCol = !(A && B && A.part.model.head && A.part.model.head === B.part.model.head);
    const nm = (e) => `${e.cat}${e.name ? " · " + e.name : ""}`;
    C.lit = { c };
    ctx.legend(`<div class="cl-row"><span class="cl-sw" style="background:${col.a}"></span><b>A</b> ${esc(nm(c.a))}${A ? "" : ' <i>(not loaded)</i>'}</div>`
      + `<div class="cl-row"><span class="cl-sw" style="background:${twoCol ? col.b : col.a}"></span><b>B</b> ${esc(nm(c.b))}${B ? "" : ' <i>(not loaded)</i>'}</div>`
      + (twoCol ? "" : `<div class="cl-note">A and B are in one model: one colour</div>`)
      + `<div class="cl-row"><span class="cl-sw dot"></span>${esc(KIND[c.kind] || c.kind)} ${esc(amount(c))}</div>`);
    ctx.status(`${KIND[c.kind] || c.kind} ${amount(c)}${c.level ? " on " + c.level : ""}: A ${nm(c.a)} x B ${nm(c.b)}`
      + (only ? " - only these two shown; Show all brings everything back." : " - cut out round it; Section off shows the whole model."));
    return { A, B };
  }
  /* A clash inside the building: the storey cut out round it (a section
     box a few metres across), looked at from above at an angle. */
  async function look(c) {
    const p = c._at || (await placeOf(c)).p;
    const half = Math.max(1.5, Math.min(6, (c.size || 1) * 0.75 + 1));
    ctx.focusAt(p, half);
  }
  async function makeIssue(c) {
    const { A } = await show(c, false);
    const r = rule();
    const lines = (s, e) => `${s}: ${e.model} - ${e.cat}${e.name ? " - " + e.name : ""}${e.type && e.type !== e.name ? " (" + e.type + ")" : ""}${e.id ? " - id " + e.id : ""}`;
    await ctx.makeIssue(c._at || new THREE.Vector3(...c.point), A, {
      title: `Clash: ${c.a.cat} x ${c.b.cat}${c.level ? " (" + c.level + ")" : ""}`.slice(0, 120),
      description: [lines("A", c.a), lines("B", c.b),
        `${KIND[c.kind] || c.kind} ${amount(c)} - clash rule "${r ? r.name : ""}", ${new Date().toLocaleDateString()}`].join("\n"),
      type: "clash",
      clash: { key: c.key, rule: r ? r.id : null, kind: c.kind, depth_mm: c.depth_mm, dist_mm: c.dist_mm },
    });
  }
  async function toggleIgnore(c) {
    const r = rule();
    if (!r) return;
    const ign = new Set(r.ignored || []);
    if (ign.has(c.key)) ign.delete(c.key); else ign.add(c.key);
    c.ignored = ign.has(c.key) || undefined;
    const last = r.last ? Object.assign({}, r.last) : null;
    if (last && last.clashes && last.clashes[c.key]) last.clashes = Object.assign({}, last.clashes, { [c.key]: c });
    await ctx.putItem(Object.assign({}, r, { ignored: [...ign], last }));
    loadRules();
  }

  /* ------------------------------------------------------------ export */

  const STATE = (c) => (c.state === "gone" ? "Gone" : c.ignored ? "Not an issue" : c.state === "new" ? "New" : "Still there");
  const mm = (c) => (c.point_shared_mm || []).map((v) => Math.round(v));
  function exportCsv() {
    const r = rule();
    if (!r || !C.shown.length) { ctx.status("Nothing listed to export."); return; }
    const side = (e) => [e.model, e.cat, e.name, e.type, e.id];
    const rows = C.shown.map((c, i) => {
      const iss = issueOf(c.key), p = mm(c);
      return [i + 1, STATE(c), KIND[c.kind] || c.kind, c.depth_mm != null ? c.depth_mm : "", c.dist_mm != null ? c.dist_mm : "", c.level || "",
        ...side(c.a), ...side(c.b), p[0], p[1], p[2], (c.first_at || "").slice(0, 10), c.where || "",
        iss && iss.issue ? "#" + (iss.issue.number || "") + " " + (iss.issue.status || "Open") : ""];
    });
    saveCsv(`${fileName(ctx.projectName())}-clashes-${fileName(r.name)}-${new Date().toISOString().slice(0, 10)}.csv`,
      ["No", "Status", "Kind", "Overlap mm", "Gap mm", "Floor", "A model", "A category", "A name", "A type", "A id",
       "B model", "B category", "B name", "B type", "B id", "X mm (project)", "Y mm (project)", "Z mm (project)", "First found", "Found when checking", "Issue"], rows);
    ctx.status(`${rows.length} clashes exported as a spreadsheet.`);
  }
  /* The report: asks with or without pictures (each about a second), opens
     a tab and fills it. */
  function exportReport() {
    const r = rule();
    if (!r || !C.shown.length) { ctx.status("Nothing listed to export."); return; }
    const sum = $("#clash-sum");
    let ask = sum.querySelector(".ck-ask");
    if (ask) { ask.remove(); return; }
    sum.querySelector(".ck-export").insertAdjacentHTML("afterend", `<div class="ck-ask"><span class="muted">${C.shown.length} clashes in the report.</span>`
      + `<button class="primary" data-pics="1" title="Each clash shown and copied - about a second each">With pictures</button>`
      + `<button class="ghost" data-pics="0">Without</button></div>`);
    sum.querySelector(".ck-ask").onclick = (ev) => {
      const b = ev.target.closest("[data-pics]");
      if (!b) return;
      ev.stopPropagation();
      sum.querySelector(".ck-ask").remove();
      makeReport(b.dataset.pics === "1");
    };
  }
  async function makeReport(withPics) {
    const r = rule(), list = C.shown.slice();
    const w = reportTab(`Clash report - ${r.name}`);
    if (!w) { ctx.status("The browser blocked the report tab - allow pop-ups for this site and try again."); return; }
    let imgs = [];
    if (withPics) {
      const v = ctx.viewNow();
      C.stop = false;
      $("#clash-run").hidden = true; $("#clash-stop").hidden = false;
      try {
        imgs = await pictures(list, (c) => show(c, false), () => ctx.shot(900),
          (t) => { progress(t); tabSay(w, t); }, () => C.stop, w);
      } finally {
        progress("");
        $("#clash-run").hidden = false; $("#clash-stop").hidden = true;
        try { await clashOff(); } catch (e) {}
        ctx.viewBack(v);
      }
    }
    if (w.closed) return;
    const col = colours(), res = C.result || {};
    const sc = scope.get();
    const by = new Map();
    for (const c of list) {
      const k = c.level || "-";
      if (!by.has(k)) by.set(k, { n: 0, nw: 0, deep: 0 });
      const g = by.get(k); g.n++; if (c.state === "new") g.nw++; g.deep = Math.max(g.deep, c.depth_mm || 0);
    }
    const side = (e) => `${e.model} - ${e.cat}${e.name ? " - " + e.name : ""}${e.type && e.type !== e.name ? " (" + e.type + ")" : ""}${e.id ? " - id " + e.id : ""}`;
    writeReport(w, {
      title: "Clash report", project: ctx.projectName(), unit: "clashes",
      sub: new Date().toLocaleString() + (ctx.author() ? " · prepared by " + ctx.author() : ""),
      meta: [["Rule", r.name], ["A", sideText(r.a)], ["B", sideText(r.b)],
        ["Settings", `overlap that counts ${r.tol_mm} mm, clearance ${r.clear_mm} mm${r.skip_openings !== false ? ", doors and windows in their hosts left out" : ""}${r.skip_joins !== false ? ", joins left out" : ""}${r.open ? ", open surfaces crossing reported" : ""}`],
        ["Where", C.elsewhere ? "everywhere checked" : (sc.err ? "" : sc.label)],
        ["Last run", res.at ? [new Date(res.at).toLocaleString(), res.by, res.scope].filter(Boolean).join(" · ") : ""],
        ["Listed", `${list.length} (${({ all: "open", new: "new", gone: "gone", ignored: "not an issue" })[C.filter]})`]],
      table: { cols: ["Floor", "Clashes", "New", "Deepest mm"], rows: [...by.entries()].map(([k, g]) => [k, g.n, g.nw, g.deep || ""]) },
      items: list.map((c, i) => {
        const p = mm(c), iss = issueOf(c.key);
        return {
          head: `${amount(c)}${c.level ? " · " + c.level : ""} · ${STATE(c)}`, tag: KIND[c.kind] || c.kind,
          tagColor: c.kind === "clearance" ? "#d97706" : "#e2453c", img: imgs[i] || null,
          rows: [["A", side(c.a), col.a], ["B", side(c.b), col.b],
            ["Where (project mm)", p.length ? `X ${p[0]}, Y ${p[1]}, Z ${p[2]}` : ""],
            ["First found", c.first_at ? new Date(c.first_at).toLocaleDateString() : ""],
            ...(iss && iss.issue ? [["Issue", `#${iss.issue.number || ""} · ${iss.issue.status || "Open"}`]] : [])],
        };
      }),
    });
    ctx.status(`Clash report ready in a new tab: ${list.length} clashes${imgs.filter(Boolean).length ? ", with pictures" : ""} - Print / Save as PDF there.`);
  }
  // after the pictures: the elements back to their colours
  async function clashOff() { putMarker(null); C.lit = null; ctx.legend(null); await ctx.highlightMany([]); }

  /* ------------------------------------------------------------ wiring */

  $("#clash-rule").onchange = (ev) => {
    C.ruleId = ev.target.value || null;
    try { localStorage.setItem(ctx.storeKey("rule"), C.ruleId || ""); } catch (e) {}
    C.filter = "all";
    loadRules();
  };
  $("#clash-new").onclick = () => editRule(null);
  $("#clash-edit").onclick = () => editRule(rule());
  $("#clash-del").onclick = () => deleteRule();
  $("#clash-run").onclick = () => run();
  $("#clash-stop").onclick = () => { C.stop = true; };
  $("#clash-scope").onfocus = fillScope;
  $("#clash-sum").onchange = (ev) => {
    const r = rule();
    try {
      if (ev.target.id === "clash-hide") localStorage.setItem(ctx.storeKey("hide:" + (r && r.id)), String(Math.max(0, Number(ev.target.value) || 0)));
      if (ev.target.id === "clash-order") localStorage.setItem(ctx.storeKey("order"), ev.target.value);
    } catch (e) {}
    paint();
  };
  $("#clash-sum").onclick = (ev) => {
    const t = ev.target.closest("[data-f], [data-else], [data-over], [data-exp]");
    if (!t) return;
    if (t.dataset.f) C.filter = t.dataset.f;
    else if (t.hasAttribute("data-else")) C.elsewhere = !C.elsewhere;
    else if (t.dataset.over === "all") { C.force = true; run(); return; }
    else if (t.dataset.over === "floors") {
      C.over = null;
      const sel = $("#clash-scope");
      sel.value = "floors";
      sel.dispatchEvent(new Event("change"));
      ctx.status("Choose the floors (from ... to ...) and press Run.");
    }
    else if (t.dataset.exp === "csv") return exportCsv();
    else if (t.dataset.exp === "report") return exportReport();
    paint();
  };
  $("#clash-sum").addEventListener("input", (ev) => {
    const k = ev.target.dataset && ev.target.dataset.col;
    if (!k) return;
    const c = colours();
    c[k] = ev.target.value;
    try { localStorage.setItem("lwk-clash-colours", JSON.stringify(c)); } catch (e) {}
    // the clash shown takes the new colours
    if (C.lit) show(C.lit.c, false, true);
  });
  // another place chosen: its clashes listed
  for (const id of ["#clash-scope", "#clash-from", "#clash-to"]) $(id).addEventListener("change", () => { C.over = null; C.msg = null; paint(); });
  $("#clash-list").onclick = async (ev) => {
    const li = ev.target.closest(".ck-it");
    if (!li) return;
    const c = C.shown[Number(li.dataset.n)];
    if (!c) return;
    const act = ev.target.closest("[data-act]");
    const a = act && act.dataset.act;
    document.querySelectorAll("#clash-list .ck-it.on").forEach((x) => x.classList.remove("on"));
    li.classList.add("on");
    C.onKey = c.key;          // kept when the list is drawn again
    if (a === "make") return makeIssue(c);
    if (a === "issue") { const it = issueOf(c.key); if (it) ctx.selectIssue(it.id); return; }
    if (a === "ign") return toggleIgnore(c);
    if (a === "only") return show(c, true);
    if (a === "secoff") { ctx.sectionOff(); ctx.status("Section box off: the whole model."); return; }
    if (c.state === "gone") { c._at = (await placeOf(c)).p; await look(c); putMarker(c._at.toArray()); return; }
    return show(c, false);
  };

  return {
    refresh() { fillScope(); loadRules(); },
    // drawn again only when a rule or a clash issue changed (sync comes often)
    itemsChanged() {
      if (C.running) return;
      const sig = JSON.stringify((ctx.items() || []).filter((it) => it && (it.placement === "clashrule" || it.placement === "clashset" || it.clash))
        .map((it) => [it.id, it.deleted, it.updated_at, it.rev, it.last && it.last.at, (it.ignored || []).length,
                      it.issue && it.issue.status, it.issue && it.issue.number]));
      if (sig === C.sig) return;
      C.sig = sig;
      loadRules();
    },
    clearMarker() { putMarker(null); C.lit = null; ctx.legend(null); },
    // for a test: run the selected rule and wait
    async runNow() { await run(); return C.result; },
    get result() { return C.result; },
    get shownAt() { return C.shownAt || null; },
    // a test: how many pairs before asking
    testLimit(n) { C.maxPairs = n; },
    // support: the elements of the last run and their triangles
    debugEls: () => [...E.entries()].map(([k, e]) => ({ k, cat: e.cat, box: e.box, lid: e.lid, part: e.part.id })),
    async debugTris(keys) { return (await trisOf(keys)).map((x) => ({ k: x.k, tris: Array.from(x.tris), box: x.box })); },
  };
}
