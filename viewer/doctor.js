/* Checks > Doctor on the 3D page: LWK Model Doctor, run on the models shown.
 *
 * The same checks as the Revit tool (doctorcore.js has them): duplicates,
 * walls overlapping or nearly touching, walls and columns, the main model
 * against the other models loaded (links, consultants), doors, walls and
 * components against the floors. A score out of 100 (health.py's), the
 * findings in a list - click one to see it - and for each:
 *
 *   Not an error   for the whole project, kept on the server
 *                  (placement "doctoraccept", by its signature: the check,
 *                  the problem and the elements' Revit UniqueIds - the
 *                  Revit tool reads the same list)
 *   Make issue     a 3D issue at the element, with the finding in it
 *   Fix in Revit   queued (placement "doctorfix") for Model Doctor in Revit,
 *                  which lists the queue and says back fixed or why not
 *
 * Settings: one project item, "checkcfg-doctor". Each run is kept
 * ("doctorrun": the score, per check) for the history, and the next run
 * says what is new since and what has gone.
 */
import { createGeo, scopePicker } from "./checkgeo.js";
import { CHECKS, REVIT_ONLY, checkById, defaults, needs, kindOf, health, signature, hashText, SEV_NAME } from "./doctorcore.js";
import { saveCsv } from "./checkexport.js";
import { dueIn, nextNumber, numberText, elementLine } from "./checkissue.js";
import { day, dayTime } from "./dates.js";
import { openMenu } from "./ctxmenu.js";

const CFG_ID = "checkcfg-doctor";
const SEV_COL = { 3: "#C4382E", 2: "#E8A93A", 1: "#9AA5B1" };
const MAX_TRIS = 12e6;
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function createDoctor(ctx) {
  const box = document.getElementById("doc-box");
  if (!box) return null;
  const { THREE } = ctx;
  const geo = createGeo(ctx);
  const D = { results: null, rep: null, els: [], rows: [], sel: new Set(), last: null, running: false, stop: false,
    filter: { check: "", problem: "", sev: "", acc: "hide" }, openCheck: null, lastRun: null, worker: null };

  box.innerHTML = `
    <div class="doc-head">
      <div class="doc-badge" id="doc-badge"><b>-</b><small>not run</small></div>
      <div class="doc-sum"><div class="doc-t">Model health</div>
        <div class="muted" id="doc-note">Run the checks to score the models shown.</div>
        <div class="doc-bar"><span id="doc-bar"></span></div>
        <div class="doc-hist" id="doc-hist"></div></div>
    </div>
    <div class="chk-row">
      <select id="doc-scope" title="Where to check" aria-label="Where to check">
        <option value="all">Whole model</option><option value="floors">Floors</option><option value="box">Inside the section box</option></select>
      <button id="doc-run" class="primary" title="Run the ticked checks on the models shown">Run</button>
      <button id="doc-stop" class="ghost" hidden>Stop</button>
      <button id="doc-cfg" class="ghost" title="Which checks, and their settings">Checks &#9662;</button>
    </div>
    <div class="chk-row ck-fr" id="doc-fr" hidden>
      <span class="muted">from</span><select id="doc-from" aria-label="From floor"></select>
      <span class="muted">to</span><select id="doc-to" aria-label="To floor"></select>
    </div>
    <div id="doc-prog" class="chk-prog" hidden><span></span></div>
    <div id="doc-checks" class="doc-checks" hidden></div>
    <div class="doc-filters" id="doc-filters" hidden>
      <select id="doc-fcheck" aria-label="Check"></select>
      <select id="doc-fprob" aria-label="Problem"></select>
      <select id="doc-fsev" aria-label="Severity"><option value="">All severities</option><option value="3">Critical only</option><option value="2">Critical + warning</option></select>
      <select id="doc-facc" aria-label="Not an error"><option value="hide">Hide not-an-error</option><option value="all">Show all</option><option value="only">Only not-an-error</option></select>
    </div>
    <div id="doc-sumline" class="muted doc-sumline"></div>
    <ul id="doc-list" class="clash-list doc-list"></ul>
    <div id="doc-acts" class="doc-acts" hidden></div>`;
  const $ = (id) => document.getElementById(id);
  const picker = scopePicker(ctx, THREE, $("doc-scope"), $("doc-from"), $("doc-to"), $("doc-fr"));

  /* ------------------------------------------------ project-wide records */
  const items = () => ctx.items() || [];
  const cfg = () => {
    const it = items().find((x) => x.id === CFG_ID && !x.deleted);
    const c = (it && it.cfg) || {};
    const d = defaults();
    const opts = {};
    for (const k of Object.keys(d)) opts[k] = Object.assign({}, d[k], (c.opts || {})[k] || {});
    return { enabled: Object.assign(Object.fromEntries(CHECKS.map((x) => [x.id, true])), c.enabled || {}), opts };
  };
  let saveT = null;
  function saveCfg(c) {
    clearTimeout(saveT);
    saveT = setTimeout(() => ctx.putItem({ id: CFG_ID, placement: "checkcfg", cfg: c, author: ctx.author(), updated_at: new Date().toISOString() }), 400);
  }
  const bySig = (placement) => {
    const m = new Map();
    for (const it of items()) if (it.placement === placement && !it.deleted && it.signature) m.set(it.signature, it);
    return m;
  };
  const accepted = () => bySig("doctoraccept");
  const queued = () => bySig("doctorfix");
  const issuesBySig = () => {
    const m = new Map();
    for (const it of items()) if (it.placement === "3d" && !it.deleted && it.doctor && it.doctor.signature) m.set(it.doctor.signature, it);
    return m;
  };
  const runs = () => items().filter((x) => x.placement === "doctorrun" && !x.deleted).sort((a, b) => String(b.at).localeCompare(String(a.at)));

  /* ------------------------------------------------------------- checks */
  function paintChecks() {
    const c = cfg();
    const res = D.results || {};
    const rep = D.rep ? Object.fromEntries(D.rep.checks.map((x) => [x.id, x])) : {};
    $("doc-checks").innerHTML = CHECKS.map((k) => {
      const r = res[k.id], p = rep[k.id];
      const n = p ? p.issues : null, note = r && r.issues.some((f) => f.scoreless) && !n;
      const badge = n == null ? (note ? "n/a" : "-") : String(n);
      const col = n == null || note ? "#9AA5B1" : n ? "#C4382E" : "#2E9E5B";
      const open = D.openCheck === k.id;
      return `<div class="doc-ck${open ? " open" : ""}" data-ck="${k.id}">`
        + `<label class="row-check"><input type="checkbox" data-en="${k.id}"${c.enabled[k.id] ? " checked" : ""}> <b>${esc(k.title)}</b></label>`
        + `<span class="doc-n" style="background:${col}" title="${p ? `${p.issues} finding(s) on ${p.affected} of ${p.population} elements` : note ? "nothing to measure against" : "not run"}">${badge}</span>`
        + `<button class="ghost doc-gear" data-gear="${k.id}" title="Settings">&#9881;</button>`
        + `<div class="muted doc-desc">${esc(k.description)}${r && r.error ? ` <b style="color:#C4382E">Error: ${esc(String(r.error).split("\n")[0])}</b>` : ""}</div>`
        + (open ? `<div class="doc-opts">${Object.entries(k.options).map(([key, [lab, def, unit]]) => {
          const v = c.opts[k.id][key];
          if (typeof def === "boolean") return `<label class="row-check"><input type="checkbox" data-opt="${k.id}|${key}"${v ? " checked" : ""}> ${esc(lab)}</label>`;
          return `<label>${esc(lab)}${unit && unit !== "text" ? " (" + esc(unit) + ")" : ""}<input data-opt="${k.id}|${key}" value="${esc(v)}" ${unit === "text" ? "" : 'inputmode="decimal"'}></label>`;
        }).join("")}<button class="ghost" data-reset="${k.id}">Back to the defaults</button></div>` : "")
        + `</div>`;
    }).join("") + REVIT_ONLY.map((k) => `<div class="doc-ck off"><b>${esc(k.title)}</b> <span class="muted">- ${esc(k.why)}</span></div>`).join("")
      + `<div class="chk-row"><button class="ghost" data-all="1">All</button><button class="ghost" data-all="0">None</button></div>`;
  }
  $("doc-checks").addEventListener("change", (ev) => {
    const t = ev.target, c = cfg();
    if (t.dataset.en) { c.enabled[t.dataset.en] = t.checked; saveCfg(c); }
    if (t.dataset.opt) {
      const [id, key] = t.dataset.opt.split("|");
      const def = checkById(id).options[key][1];
      let v = t.type === "checkbox" ? t.checked : t.value;
      if (typeof def === "number") { v = Number(String(v).replace(",", ".")); if (!isFinite(v)) { ctx.status("Not a number - not kept."); t.value = c.opts[id][key]; return; } }
      c.opts[id][key] = v;
      saveCfg(c);
    }
  });
  $("doc-checks").addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-gear],[data-reset],[data-all]");
    if (!t) return;
    const c = cfg();
    if (t.dataset.gear) { D.openCheck = D.openCheck === t.dataset.gear ? null : t.dataset.gear; paintChecks(); }
    if (t.dataset.reset) { c.opts[t.dataset.reset] = defaults()[t.dataset.reset]; saveCfg(c); setTimeout(paintChecks, 450); }
    if (t.dataset.all) { for (const k of CHECKS) c.enabled[k.id] = t.dataset.all === "1"; saveCfg(c); setTimeout(paintChecks, 450); }
  });
  $("doc-cfg").addEventListener("click", () => { $("doc-checks").hidden = !$("doc-checks").hidden; if (!$("doc-checks").hidden) paintChecks(); });

  /* ------------------------------------------------------------ the run */
  const say = (t) => ctx.status(t);
  const prog = (f, t) => {
    const p = $("doc-prog");
    p.hidden = f == null;
    if (f != null) { p.firstChild.style.width = Math.round(f * 100) + "%"; p.title = t || ""; }
    if (t) say(t);
  };

  function hostOf(models) {
    return models.find((m) => !m.rec.ref && m.rec.entry && m.rec.entry.role === "host")
      || models.find((m) => !m.rec.ref) || models[0] || null;
  }

  async function collect(c, scope) {
    const models = geo.models();
    if (!models.length) throw new Error("No model is shown - tick one in Models first.");
    const host = hostOf(models);
    const on = CHECKS.filter((k) => c.enabled[k.id]);
    const kinds = new Set(), trisKinds = new Set();
    let allHost = false, links = false;
    for (const k of on) {
      const n = needs(k.id, c.opts[k.id]);
      if (n.all) allHost = true;
      for (const x of n.kinds || []) { kinds.add(x); if (n.tris) trisKinds.add(x); }
      if (n.links) links = true;
    }
    const raw = [];
    for (const m of models) {
      const isHost = m === host;
      if (!isHost && !links) continue;
      const cats = [...(await geo.catsOf(m)).keys()].filter((cat) => (isHost && allHost) || kinds.has(kindOf(cat)));
      await geo.elementsOf(m, cats, scope.test || null, (e) => { e.host = isHost; raw.push(e); }, () => D.stop, (t) => prog(0.05, t));
      if (D.stop) return null;
    }
    await geo.nameAll(raw);
    // the triangles of what is measured in plan or against the floors
    const want = raw.filter((e) => trisKinds.has(kindOf(e.cat)));
    let total = 0;
    for (let i = 0; i < want.length; i += 500) {
      if (D.stop) return null;
      prog(0.1 + 0.3 * (i / Math.max(1, want.length)), `Reading the shapes ... ${i} of ${want.length}`);
      const part = want.slice(i, i + 500);
      const tris = await geo.trisOf(part);
      part.forEach((e, j) => { e.tris = tris[j]; total += tris[j] ? tris[j].length / 9 : 0; });
      if (total > MAX_TRIS) throw new Error("Too much to read at once - check floors, or inside the section box.");
    }
    const els = raw.map((e, k) => {
      const info = e.info || {};
      let dr = null;
      try {
        const md = e.part.model;
        if (md.head && md.head.dr && typeof md.elementOfId === "function") { const ix = md.elementOfId(e.lid); if (ix != null) dr = md.head.dr[ix] || null; }
      } catch (err) { dr = null; }
      return { k, model: e.model.key, modelLabel: e.model.label, host: e.host, cat: e.cat, type: info.type || "", name: info.name || (e.label && e.label.name) || "",
        level: info.level || "", uid: info.revit_uid || info.ifc_guid || e.guid || e.id, rid: Number(info.revit_id) || 0, box: e.box, tris: e.tris || null, dr };
    });
    D.raw = raw;
    return els;
  }

  function worker() {
    if (D.worker === null) {
      try { D.worker = new Worker(new URL("./doctor-worker.js", import.meta.url), { type: "module" }); } catch (e) { D.worker = false; }
    }
    return D.worker || null;
  }
  let seq = 0;
  async function runOne(id, opts, els) {
    const w = worker();
    if (!w) {
      const { runCheck } = await import("./doctorcore.js");
      return { result: runCheck(id, els, opts), error: null };
    }
    const my = ++seq;
    return new Promise((res) => {
      const on = (ev) => { const m = ev.data || {}; if (m.type === "checked" && m.seq === my) { w.removeEventListener("message", on); res(m); } };
      w.addEventListener("message", on);
      w.postMessage({ type: "check", id, opts, seq: my });
    });
  }

  async function run() {
    if (D.running) return;
    const scope = picker.get();
    if (scope.err) { say(scope.err); return; }
    const c = cfg();
    const on = CHECKS.filter((k) => c.enabled[k.id]);
    if (!on.length) { say("No checks ticked - Checks ▾."); return; }
    D.running = true; D.stop = false;
    $("doc-run").disabled = true; $("doc-stop").hidden = false;
    try {
      prog(0, "Reading the models ...");
      const els = await collect(c, scope);
      if (!els) { say("Stopped."); return; }
      const w = worker();
      // the worker keeps its own copy (the triangles are copied once)
      if (w) w.postMessage({ type: "els", els });
      const results = {};
      for (let i = 0; i < on.length; i++) {
        if (D.stop) break;
        const k = on[i];
        prog(0.4 + 0.6 * (i / on.length), `[${i + 1}/${on.length}] ${k.title} ...`);
        const m = await runOne(k.id, c.opts, els);
        results[k.id] = m.result ? { issues: m.result.issues, population: m.result.population, ms: m.ms } : { issues: [], population: 0, error: m.error || "failed" };
      }
      if (w) w.postMessage({ type: "clear" });
      for (const el of els) el.tris = null;            // let go of the shapes
      D.els = els;
      const uidOf = (k) => (els[k] ? els[k].uid : "");
      for (const r of Object.values(results)) for (const f of r.issues) f.sig = signature(f, uidOf);
      D.results = results;
      D.scope = scope.label;
      const acc = accepted();
      D.rep = health(results, (f) => acc.has(f.sig));
      await keepRun(scope.label);
      D.sel.clear();
      paint();
      say(D.stop ? "Stopped - the checks run so far are shown." : `Model Doctor: ${D.rep.grade} ${D.rep.score.toFixed(0)}/100 - ${D.rep.issues} finding(s) ${scope.label}.`);
    } catch (e) {
      say("Model Doctor: " + (e.message || e));
    } finally {
      D.running = false;
      $("doc-run").disabled = false; $("doc-stop").hidden = true;
      prog(null);
    }
  }
  $("doc-run").addEventListener("click", run);
  $("doc-stop").addEventListener("click", () => { D.stop = true; });

  /* what this run found, kept for the history and for "new since last time" */
  async function keepRun(label) {
    const prev = runs()[0] || null;
    D.lastRun = prev;
    const sigs = [];
    for (const r of Object.values(D.results)) for (const f of r.issues) if (!f.scoreless) sigs.push(f.sig);
    const rec = { id: "doctorrun-" + Date.now().toString(36), placement: "doctorrun", at: new Date().toISOString(), by: ctx.myName(),
      scope: label, score: Math.round(D.rep.score * 10) / 10, grade: D.rep.grade, colour: D.rep.colour, issues: D.rep.issues, accepted: D.rep.accepted,
      per: D.rep.checks.map((x) => ({ id: x.id, issues: x.issues, population: x.population })), sigs: sigs.slice(0, 4000) };
    await ctx.putItem(rec);
  }

  /* ------------------------------------------------------------- paint */
  function rowsNow() {
    if (!D.results) return [];
    const acc = accepted(), q = queued(), iss = issuesBySig();
    const prevSigs = D.lastRun && D.lastRun.sigs ? new Set(D.lastRun.sigs) : null;
    const out = [], notes = new Set();
    for (const [id, r] of Object.entries(D.results)) for (const f of r.issues) {
      // one line for a notice several checks give ("no other models ...")
      if (f.scoreless) { if (notes.has(f.text)) continue; notes.add(f.text); }
      out.push(Object.assign(f, { acc: acc.get(f.sig) || null, queued: q.get(f.sig) || null, issue: iss.get(f.sig) || null,
        isNew: prevSigs ? !prevSigs.has(f.sig) && !f.scoreless : false }));
    }
    out.sort((a, b) => (!!a.acc - !!b.acc) || (b.severity - a.severity) || a.problem.localeCompare(b.problem));
    return out;
  }
  function paintHead() {
    const rep = D.rep;
    const b = $("doc-badge");
    if (!rep) { b.style.background = "#9AA5B1"; b.innerHTML = "<b>-</b><small>not run</small>"; }
    else {
      b.style.background = rep.colour;
      b.innerHTML = `<b>${rep.grade}</b><small>${rep.score.toFixed(0)}/100</small>`;
      $("doc-note").textContent = `${rep.label} - ${rep.issues} open finding(s)${rep.accepted ? ", " + rep.accepted + " not an error" : ""} (${rep.lost.toFixed(1)} of 100 points lost)`
        + (D.scope ? ", " + D.scope : "");
      $("doc-bar").style.width = rep.score.toFixed(1) + "%";
      $("doc-bar").style.background = rep.colour;
    }
    const hist = runs().slice(0, 8);
    $("doc-hist").innerHTML = hist.length ? "Runs: " + hist.map((r) => `<span class="doc-h" style="border-color:${esc(r.colour)}" title="${esc(dayTime(r.at))} by ${esc(r.by || "?")}, ${esc(r.scope || "")}: ${r.issues} open">${esc(r.grade)} ${Math.round(r.score)} <small>${esc(day(r.at))}</small></span>`).join("") : "";
  }
  function paint() {
    paintHead();
    if (!$("doc-checks").hidden) paintChecks();
    const all = rowsNow();
    D.rows = all;
    const fl = $("doc-filters");
    fl.hidden = !D.results;
    if (!D.results) { $("doc-list").innerHTML = ""; $("doc-sumline").textContent = ""; paintActs(); return; }
    // the filters' choices from what was found
    const keep = (sel, opts, cur) => { sel.innerHTML = opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join(""); sel.value = opts.some(([v]) => v === cur) ? cur : ""; };
    const checks = [...new Set(all.map((f) => f.check))];
    keep($("doc-fcheck"), [["", "All checks"], ...checks.map((id) => [id, checkById(id) ? checkById(id).title : id])], D.filter.check);
    const probs = [...new Set(all.filter((f) => !D.filter.check || f.check === D.filter.check).map((f) => f.problem))].sort();
    keep($("doc-fprob"), [["", "All problems"], ...probs.map((p) => [p, p])], D.filter.problem);
    $("doc-fsev").value = D.filter.sev; $("doc-facc").value = D.filter.acc;
    const F = D.filter;
    const shown = all.filter((f) => (!F.check || f.check === F.check) && (!F.problem || f.problem === F.problem)
      && (!F.sev || (F.sev === "3" ? f.severity === 3 : f.severity >= 2))
      && (F.acc === "all" || (F.acc === "only" ? !!f.acc : !f.acc)));
    D.shown = shown;
    const gone = D.lastRun && D.lastRun.sigs ? D.lastRun.sigs.filter((s) => !all.some((f) => f.sig === s)).length : 0;
    const nNew = all.filter((f) => f.isNew).length;
    const nSel = all.filter((f) => D.sel.has(f.sig)).length;
    $("doc-sumline").innerHTML = esc(`Showing ${shown.length} of ${all.length}` + (D.lastRun ? ` · since ${day(D.lastRun.at)}: ${nNew} new, ${gone} gone` : ""))
      + ` <span class="doc-pick"><button class="ghost" data-pick="all" title="Choose every finding shown">&#9745; All shown</button>`
      + (nSel ? `<button class="ghost" data-pick="none">Clear (${nSel})</button>` : "") + `</span>`;
    const ul = $("doc-list");
    ul.innerHTML = shown.slice(0, 1500).map((f, i) => {
      const chips = [f.isNew ? `<span class="chip doc-new">New</span>` : "",
        f.acc ? `<span class="chip doc-acc" title="By ${esc(f.acc.by || "?")} ${esc(day(f.acc.at))}">Not an error</span>` : "",
        f.queued ? `<span class="chip doc-q" title="${esc(f.queued.reason || "")}">${f.queued.status === "fixed" ? "Fixed in Revit" : f.queued.status === "skipped" ? "Revit: not fixed" : "Queued for Revit"}</span>` : "",
        f.issue ? `<span class="chip doc-iss">Issue${f.issue.issue && f.issue.issue.number ? " #" + f.issue.issue.number : ""}</span>` : ""].join("");
      return `<li data-i="${i}" class="${D.sel.has(f.sig) ? "sel" : ""}${f.scoreless ? " note" : ""}">`
        + (f.scoreless ? `<span class="doc-tick off"></span>` : `<span class="doc-tick" data-tick title="Choose it (for Not an error, Make issues ...)">${D.sel.has(f.sig) ? "&#10003;" : ""}</span>`)
        + `<span class="doc-sev" style="background:${SEV_COL[f.severity]}" title="${SEV_NAME[f.severity]}"></span>`
        + `<div class="doc-b"><div class="doc-p"><b>${esc(f.problem)}</b>${f.value_mm != null ? ` <span class="muted">${(f.value_mm > 0 ? "+" : "") + f.value_mm.toFixed(1)} mm</span>` : ""} ${chips}</div>`
        + `<div class="doc-x">${esc(f.text)}</div></div></li>`;
    }).join("") + (shown.length > 1500 ? `<li class="muted">... ${shown.length - 1500} more - narrow the filters.</li>` : "")
      + (!shown.length ? `<li class="muted">${all.length ? "Nothing matches the filters." : "Nothing found - the checks ticked are clean."}</li>` : "");
    paintActs();
  }
  for (const [id, key] of [["doc-fcheck", "check"], ["doc-fprob", "problem"], ["doc-fsev", "sev"], ["doc-facc", "acc"]])
    $(id).addEventListener("change", (ev) => { D.filter[key] = ev.target.value; if (key === "check") D.filter.problem = ""; paint(); });

  /* ------------------------------------------------------------ choose */
  // a click shows the finding (and chooses only it); the tick box, Ctrl and
  // Shift choose several without moving the view
  $("doc-list").addEventListener("click", async (ev) => {
    const li = ev.target.closest("li[data-i]");
    if (!li) return;
    const f = D.shown[Number(li.dataset.i)];
    if (!f || f.scoreless) return;
    const tick = !!ev.target.closest("[data-tick]");
    if (ev.shiftKey && D.last != null) {
      const a = D.shown.findIndex((x) => x.sig === D.last), b = Number(li.dataset.i);
      if (a >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (!D.shown[i].scoreless) D.sel.add(D.shown[i].sig);
    } else if (tick || ev.ctrlKey || ev.metaKey) { if (D.sel.has(f.sig)) D.sel.delete(f.sig); else D.sel.add(f.sig); }
    else { D.sel.clear(); D.sel.add(f.sig); }
    D.last = f.sig;
    D.asking = false;
    paint();
    if (!tick && !ev.shiftKey && !(ev.ctrlKey || ev.metaKey)) await show(f);
  });
  $("doc-list").addEventListener("dblclick", async (ev) => {
    const li = ev.target.closest("li[data-i]");
    const f = li && D.shown[Number(li.dataset.i)];
    if (f && !ev.target.closest("[data-tick]")) await show(f, true);
  });
  $("doc-sumline").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-pick]");
    if (!b) return;
    if (b.dataset.pick === "all") for (const f of D.shown || []) { if (!f.scoreless) D.sel.add(f.sig); }
    else D.sel.clear();
    paint();
  });
  // right-click: the chosen ones (this one, when it is not among them)
  $("doc-list").addEventListener("contextmenu", (ev) => {
    const li = ev.target.closest("li[data-i]");
    const f = li && D.shown[Number(li.dataset.i)];
    if (!f || f.scoreless) return;
    ev.preventDefault();
    if (!D.sel.has(f.sig)) { D.sel.clear(); D.sel.add(f.sig); D.last = f.sig; paint(); }
    const n = chosen(), k = n.length, cnt = (x) => (k > 1 ? ` (${x})` : "");
    const nAcc = n.filter((x) => x.acc).length, nFix = n.filter((x) => x.fix && !x.queued).length, nIss = n.filter((x) => !x.issue).length;
    openMenu(ev.clientX, ev.clientY, [
      { label: "Show it", disabled: k !== 1, action: () => show(f) },
      { label: "Show only these elements", disabled: k !== 1, action: () => show(f, true) },
      "-",
      { label: "Not an error" + cnt(k - nAcc), disabled: nAcc === k, title: nAcc === k ? "Already not an error" : "For everyone on the project (Revit reads it too)", action: () => act("accept", n) },
      { label: "Reopen" + cnt(nAcc), disabled: !nAcc, title: nAcc ? "" : "None of these is marked not an error", action: () => act("reopen", n) },
      { label: (nIss > 1 ? "Make issues" : "Make issue") + cnt(nIss), disabled: !nIss, title: nIss ? "A 3D issue at each, with its dimension" : "They have issues already", action: () => act("issue", n) },
      { label: "Fix in Revit" + cnt(nFix), disabled: !nFix, title: nFix ? "Queued for Model Doctor in Revit" : "Revit cannot fix these automatically, or they are queued already", action: () => act("fix", n) },
      "-",
      { label: "Copy Revit IDs", action: () => act("ids", n) },
    ]);
  });

  const elsOf = (f) => (f.els || []).map((k) => D.raw && D.raw[k]).filter(Boolean);
  const centreOf = (list) => {
    const b = new THREE.Box3();
    for (const e of list) b.union(new THREE.Box3(new THREE.Vector3(e.box[0], e.box[1], e.box[2]), new THREE.Vector3(e.box[3], e.box[4], e.box[5])));
    return b;
  };
  async function show(f, only) {
    let list = elsOf(f);
    if (!list.length) { say(f.text); return; }
    // against a floor: the door, wall or component lit, not the whole slab
    if (/^(door_floor|wall_base_floor|wall_top_soffit|element_floor)$/.test(f.check) && D.raw[f.primary]) list = [D.raw[f.primary]];
    await ctx.highlightMany(list.map((e) => ({ part: e.part, lid: e.lid })));
    if (only) await ctx.isolateMany(list.map((e) => ({ part: e.part, lid: e.lid })));
    const bx = centreOf(list);
    const c = bx.getCenter(new THREE.Vector3()), size = bx.getSize(new THREE.Vector3());
    ctx.focusAt(c, Math.max(1.5, Math.min(8, Math.max(size.x, size.z) * 0.6 + 1)));
    // where it was measured: an orange dimension on the model
    D.dims = ctx.showDims ? ctx.showDims(f.dim ? [f.dim] : []) : [];
    say(`${f.problem}: ${f.text}` + (f.dim ? ` (${f.dim.label}, the orange dimension)` : "") + (only ? " - only these shown; Show all brings everything back." : ""));
  }

  /* ----------------------------------------------------------- actions */
  const chosen = () => D.rows.filter((f) => D.sel.has(f.sig) && !f.scoreless);
  function paintActs() {
    const a = $("doc-acts");
    const n = chosen();
    a.hidden = !D.results;
    if (!D.results) return;
    const fixable = n.filter((f) => f.fix && !f.queued), accN = n.filter((f) => f.acc).length;
    if (D.asking) {
      const want = n.filter((f) => !f.issue).length;
      a.innerHTML = `<span>Make <b>${want}</b> issue${want === 1 ? "" : "s"}, due ${esc(dueIn(3))}</span>`
        + `<input id="doc-assign" class="ck-assign" placeholder="Assign to (optional)" autocomplete="off">`
        + `<button class="primary" data-a="issue-go">Make</button><button class="ghost" data-a="issue-no">Cancel</button>`;
      return;
    }
    a.innerHTML = `<span class="muted">${n.length ? n.length + " chosen" : "Tick findings (or Shift / Ctrl click) for several; right-click for the menu"}</span>`
      + `<button class="ghost" data-a="accept"${n.length && accN < n.length ? "" : " disabled"} title="Not an error, for everyone on the project (Revit reads it too). It stays in the list and leaves the score.">Not an error</button>`
      + `<button class="ghost" data-a="reopen"${accN ? "" : " disabled"} title="Count it again">Reopen</button>`
      + `<button class="ghost" data-a="issue"${n.length ? "" : " disabled"} title="A 3D issue for each, at the element">Make issue${n.length > 1 ? "s" : ""}</button>`
      + `<button class="ghost" data-a="fix"${fixable.length ? "" : " disabled"} title="${n.length && !fixable.length ? "Revit cannot fix these automatically (or they are queued already)" : "Ask Model Doctor in Revit to fix them: it lists the queue and says back fixed, or why not"}">Fix in Revit${fixable.length ? " (" + fixable.length + ")" : ""}</button>`
      + `<button class="ghost" data-a="ids"${n.length ? "" : " disabled"} title="The Revit element ids, for Select by ID">Copy IDs</button>`
      + `<button class="ghost" data-a="csv" title="All the findings as a spreadsheet">CSV</button>`;
  }
  $("doc-acts").addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-a]");
    if (!b || b.disabled) return;
    if (b.dataset.a === "issue-no") { D.asking = false; paintActs(); return; }
    if (b.dataset.a === "issue-go") { const i = $("doc-assign"); D.asking = false; return makeIssues(chosen(), i ? i.value.trim() : ""); }
    return act(b.dataset.a, chosen());
  });
  $("doc-acts").addEventListener("keydown", (ev) => {
    if (ev.target.id === "doc-assign" && ev.key === "Enter") { ev.preventDefault(); const v = ev.target.value.trim(); D.asking = false; makeIssues(chosen(), v); }
  });
  const uidsOf = (f) => elsOf(f).map((e) => (e.info && (e.info.revit_uid || e.info.ifc_guid)) || e.guid || "").filter(Boolean);
  const ridsOf = (f) => elsOf(f).map((e) => (e.info && e.info.revit_id) || "").filter(Boolean);
  /* one action on these findings (the bar and the right-click menu) */
  async function act(a, n) {
    const me = ctx.myName(), now = new Date().toISOString();
    if (a === "accept") {
      for (const f of n) if (!f.acc) await ctx.putItem({ id: "doctoraccept-" + hashText(f.sig), placement: "doctoraccept", signature: f.sig, check: f.check, problem: f.problem,
        uids: uidsOf(f), text: f.text, by: me, at: now, deleted: false });
      rescore(); say(`${n.length} finding(s): not an error, for the whole project.`);
    } else if (a === "reopen") {
      for (const f of n) if (f.acc) await ctx.removeItem(f.acc.id);
      rescore(); say(`${n.length} finding(s) open again.`);
    } else if (a === "fix") {
      const list = n.filter((f) => f.fix && !f.queued);
      for (const f of list) await ctx.putItem({ id: "doctorfix-" + hashText(f.sig), placement: "doctorfix", signature: f.sig, check: f.check, problem: f.problem,
        uids: uidsOf(f), revit_ids: ridsOf(f), primary_uid: (D.raw[f.primary] && D.raw[f.primary].info && D.raw[f.primary].info.revit_uid) || "",
        value_mm: f.value_mm, text: f.text, fix: f.fix, model: (elsOf(f)[0] || {}).model ? elsOf(f)[0].model.label : "", status: "queued", by: me, at: now });
      paint(); say(`${list.length} finding(s) queued for Model Doctor in Revit (LWK tab > Model Doctor > Fix queue).`);
    } else if (a === "issue") {
      // one: straight away; several: who to assign them to first
      if (n.filter((f) => !f.issue).length > 1) { D.asking = true; paintActs(); const i = $("doc-assign"); if (i) i.focus(); return; }
      return makeIssues(n, "");
    }
    return act2(a, n, me);
  }
  async function makeIssues(n, assign) {
    {
      let made = 0;
      const todo = n.filter((f) => !f.issue);
      for (const f of todo) {
        say(`Making issue ${made + 1} of ${todo.length} ...`);
        const list = elsOf(f);
        if (!list.length) continue;
        await show(f);
        const bx = centreOf(list);
        const num = nextNumber(ctx.items(), "Doctor");
        const pre = {
          title: `Doctor ${numberText(num)} - ${f.problem}${list[0].info && list[0].info.level ? " (" + list[0].info.level + ")" : ""}`.slice(0, 120),
          description: [f.text, ...list.map((e) => (e.label ? elementLine(e.label) : "")).filter(Boolean),
            `Model Doctor (${(checkById(f.check) || {}).title || f.check}), ${day(Date.now())}.`, f.fix ? "Revit can fix it: " + f.fix + "." : ""].filter(Boolean).join("\n"),
          type: /clash/.test(f.check) ? "clash" : "coordination", status: "Open", priority: f.severity === 3 ? "High" : "Normal", due_date: dueIn(3),
          doctor: { check: f.check, problem: f.problem, signature: f.sig, value_mm: f.value_mm },
          // its dimension kept with it: shown again whenever it is opened
          dims: D.dims && D.dims.length ? D.dims : undefined,
        };
        if (assign) pre.assigned_to = assign;
        const it = await ctx.createIssue(bx.getCenter(new THREE.Vector3()), { part: list[0].part, lid: list[0].lid }, pre);
        if (it) made++;
      }
      paint(); say(`${made} issue(s) made${assign ? ", assigned to " + assign : ""} - Issues in 3D.`);
    }
  }
  async function act2(a, n, me) {
    if (a === "ids") {
      const ids = [...new Set(n.flatMap(ridsOf))];
      try { await navigator.clipboard.writeText(ids.join(",")); say(`${ids.length} Revit id(s) copied - Revit: Manage > Select by ID.`); }
      catch (e) { prompt("Revit ids:", ids.join(",")); }
    } else if (a === "csv") {
      const cols = ["Check", "Severity", "Problem", "Status", "Model", "Category", "Type", "Level", "Revit ids", "Issue", "Value (mm)", "New"];
      const rows = D.rows.map((f) => {
        const list = elsOf(f), e0 = list[0];
        return [(checkById(f.check) || {}).title || f.check, SEV_NAME[f.severity], f.problem, f.acc ? "not an error" : f.queued ? f.queued.status : "open",
          e0 ? e0.model.label : "", e0 ? e0.cat : "", e0 && e0.info ? e0.info.type || "" : "", e0 && e0.info ? e0.info.level || "" : "",
          ridsOf(f).join(" "), f.text, f.value_mm == null ? "" : f.value_mm, f.isNew ? "yes" : ""];
      });
      saveCsv("Model Doctor - " + (ctx.projectName() || "model"), cols, rows);
    }
  }
  function rescore() {
    if (D.results) { const acc = accepted(); D.rep = health(D.results, (f) => acc.has(f.sig)); }
    paint();
  }

  return {
    refresh() { picker.fill(); paintHead(); if (D.results) paint(); },
    // the project's items changed (someone else accepted, Revit fixed ...)
    itemsChanged() { if (D.results) rescore(); else paintHead(); },
  };
}
