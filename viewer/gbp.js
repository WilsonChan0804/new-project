/* Codes > GBP workbook: the calculations a set of General Building Plans
 * carries, worked from the model's rooms and areas and from what the
 * project's people type in - one workbook per project, kept on the server
 * (server/gbp.py), calculated here (gbpcore.js) from the code tables
 * (gbptables.js).
 *
 *   Site, PR & SC      Cap. 123F First Schedule
 *   GFA & concessions  per floor; PNAP APP-151 items, the 10% cap, item limits
 *   Occupancy & exits  FS Code Table B1 -> B2, rooms and storeys
 *   Staircases         discharge value vs Table B3/B4 (B12)
 *
 * A model row's value changed here is kept as a change on top of the
 * model (✎, ↺ puts the model's value back); rows can be added by hand, so
 * a project without a model works the same way.
 */
import { api, headers, project } from "./nav.js";
import { esc, toast } from "./tasks-util.js";
import * as C from "./gbpcore.js";
import { B1, SRC, APP151, ITEM_LIMITS } from "./gbptables.js";
import { loadModel, roomRows, areaRows, widthsOf, MAP_DEFAULTS, MAP_LABELS } from "./gbpmodel.js";

const PARTS = [
  { id: "site", label: "Site, PR & SC" },
  { id: "gfa", label: "GFA & concessions" },
  { id: "moe", label: "Occupancy & exits" },
  { id: "stairs", label: "Staircase discharge" },
  { id: "map", label: "Model & mapping" },
  { id: "next", label: "Sanitary, FRR, greenery", soon: true },
];
const G = { el: null, wb: null, model: null, modelErr: "", part: "site", t: null, saving: false, opts: {} };
const KEEP = "lwk-viewer:gbp-part";

const D = () => {
  const d = G.wb.data;
  d.site = d.site || {};
  d.map = d.map || {};
  for (const k of ["rooms", "areas"]) { d[k] = d[k] || {}; d[k].over = d[k].over || {}; d[k].add = d[k].add || []; d[k].hide = d[k].hide || []; }
  d.stairs = d.stairs || [];
  d.storeys = d.storeys || {};
  d.b1 = d.b1 || [];
  d.limits = d.limits || {};
  return d;
};
const can = () => !!(G.wb && G.wb.can_edit);
const chip = (st, txt) => `<span class="gb-st gb-${st || "check"}">${esc(txt || { ok: "OK", fail: "Fails", check: "Check", na: "—" }[st] || "Check")}</span>`;
const f3 = (x) => (x == null || x === "" || !isFinite(x) ? "" : Number(x).toLocaleString("en-GB", { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
const f0 = (x) => (x == null || x === "" || !isFinite(x) ? "" : Number(x).toLocaleString("en-GB"));
const src = (k) => SRC[k] ? `<button type="button" class="gb-src" data-clause="${esc(SRC[k].doc + " " + SRC[k].ref)}" title="Find it in the library">§ ${esc(SRC[k].doc)} · ${esc(SRC[k].ref)}</button>` : "";

/* ------------------------------------------------------------- the levels */

export function levelRank(name) {
  const s = String(name || "").toUpperCase().replace(/\s+/g, "");
  let m;
  if ((m = /^B(\d+)/.exec(s)) || (m = /^(\d+)B/.exec(s))) return -Number(m[1]);
  if (/^(G|GF|G\/F|GROUND)/.test(s)) return 0;
  if ((m = /^(\d+)(\/F|F|ST|ND|RD|TH)?/.exec(s))) return Number(m[1]);
  if ((m = /^L(\d+)/.exec(s))) return Number(m[1]);
  if (/^(UR|UPPERROOF|UPPER)/.test(s)) return 1001;
  if (/^(R\/F|RF|ROOF|R)/.test(s)) return 1000;
  return 500;
}
const byLevel = (a, b) => levelRank(b) - levelRank(a) || String(a).localeCompare(String(b));

/* ----------------------------------------------------------- calculations */

function calc() {
  const d = D();
  const s = C.site(d.site);
  const areas = areaRows(G.model, d.map, d.areas.over, d.areas.add, d.areas.hide);
  const limits = ITEM_LIMITS.map((l) => Object.assign({}, l, d.limits[l.item] != null ? { pct_of_floor_gfa: Number(d.limits[l.item]) } : {}));
  const g = C.gfa(areas, { permitted: s.gfa != null ? s.gfa : null, limits });
  const scRows = areas.filter((a) => String(a.type || "").toUpperCase().startsWith("SC"));
  const sc = C.siteCoverage(scRows, s.sc_area != null ? s.sc_area : null);
  const rooms = C.occupancy(roomRows(G.model, d.map, d.rooms.over, d.rooms.add, d.rooms.hide).filter((r) => r.ufa !== false), d.b1);
  for (const r of rooms) {
    const ws = widthsOf(r.widths);
    r.exit = C.checkExits(r.load, ws.length ? { widths: ws } : { n: r.exits, total: r.doors_total, least: r.door_each });
  }
  const loads = C.storeyLoads(rooms);
  const levels = [...new Set([...loads.keys(), ...Object.keys(d.storeys)])].sort(byLevel);
  const storeys = levels.map((lv) => {
    const o = d.storeys[lv] || {};
    const cap = o.capacity != null && o.capacity !== "" ? Number(o.capacity) : loads.get(lv) || 0;
    const ws = widthsOf(o.routes);
    const marks = String(o.stairs || "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    return { level: lv, capacity: cap, from_rooms: loads.get(lv) || 0, stairs: marks, ground: !!o.ground, basement: !!o.basement,
      routes: o.routes || "", exit: C.checkExits(cap, ws.length ? { widths: ws } : null, { storey: true, single_stair: !!d.site.single_stair }) };
  });
  const dis = C.discharge(storeys, d.stairs.map((x) => Object.assign({}, x, { sprinkler: x.sprinkler != null && x.sprinkler !== "" ? x.sprinkler : !!d.site.sprinkler })), { sprinkler: !!d.site.sprinkler });
  let comp = null;
  if (s.status === "ok" && s.kind === "composite") {
    const scD = scRows.filter((a) => /^SC-D0$/i.test(a.type) && !a.deduct).reduce((t, a) => t + a.area, 0);
    const scN = scRows.filter((a) => /^SC-ND0$/i.test(a.type) && !a.deduct).reduce((t, a) => t + a.area, 0);
    comp = C.compositeIndex(s, g.dom, g.non, scD, scN);
  }
  const st = {
    site: s.status === "ok" ? C.worst([sc.rows.length ? sc.status : "ok", comp ? (comp.ok_pr && comp.ok_sc ? "ok" : "fail") : "ok"]) : "check",
    gfa: !g.levels.length ? "check" : C.worst([g.status || "check", g.concessions.length ? g.cap_status : "ok", ...g.limits.map((x) => x.status)]),
    moe: !rooms.length ? "check" : C.worst([...rooms.map((r) => (r.status === "check" ? "check" : r.exit.status)), ...storeys.map((x) => x.exit.status)]),
    stairs: !d.stairs.length ? "check" : dis.status,
  };
  return { s, areas, g, sc, rooms, storeys, dis, comp, st };
}

/* ------------------------------------------------------------------ saving */

function changed(rerender = true) {
  clearTimeout(G.t);
  G.t = setTimeout(save, 700);
  if (rerender) render();
}
async function save() {
  if (!can() || G.saving) return;
  G.saving = true;
  try {
    const out = await api("/api/gbp", { method: "PUT", body: JSON.stringify({ rev: G.wb.rev, data: G.wb.data }) });
    G.wb.rev = out.rev; G.wb.by = out.by; G.wb.at = out.at;
    const s = G.el.querySelector(".gb-saved");
    if (s) s.textContent = "Saved";
  } catch (e) {
    if (e.status === 409) {
      toast("Someone else changed the workbook meanwhile - showing theirs now; make your change again.", true);
      await loadWb(); render();
    } else toast("Not saved: " + e.message, true);
  } finally { G.saving = false; }
}
async function loadWb() {
  G.wb = await api("/api/gbp");
  G.wb.data = G.wb.data || {};
}

/* ------------------------------------------------------------------ editing */

// a value typed into a cell: kept as a change on the model row (over) or on
// the person's own row (add)
function setCell(kind, uid, f, raw) {
  const d = D()[kind];
  const v = ["area", "by_number", "exits", "doors_total", "door_each", "routes_total", "route_each", "factor"].includes(f)
    ? (raw === "" ? null : Number(raw)) : f === "deduct" || f === "ufa" ? !!raw : raw;
  const own = d.add.find((x) => x.id === uid);
  if (own) own[f] = v;
  else { d.over[uid] = d.over[uid] || {}; d.over[uid][f] = v; }
  changed();
}
function addRow(kind) {
  const id = (kind === "rooms" ? "r" : "a") + Date.now().toString(36);
  const lv = (G.el.querySelector(`[data-newlevel="${kind}"]`) || {}).value || "";
  D()[kind].add.push(kind === "rooms" ? { id, level: lv, number: "", name: "New room", area: 0, key: "" } : { id, level: lv, number: "", name: "New area", area: 0, type: "GFA-ND0", deduct: false });
  changed();
}
function rowAct(kind, uid, act) {
  const d = D()[kind];
  if (act === "reset") delete d.over[uid];
  else if (act === "del") {
    const i = d.add.findIndex((x) => x.id === uid);
    if (i >= 0) d.add.splice(i, 1);
    else if (!d.hide.includes(uid)) d.hide.push(uid);
  }
  changed();
}

const cell = (kind, r, f, type, opts) => {
  const o = opts || {};
  const ch = (r.changed || []).includes(f);
  const v = r[f];
  if (!can() || o.ro) return `<td class="${o.cls || ""}">${esc(type === "num" ? (o.int ? f0(v) : f3(v)) : v == null ? "" : String(v))}</td>`;
  const attrs = `data-k="${kind}" data-u="${esc(r.uid)}" data-f="${f}"`;
  if (type === "bool") return `<td class="c ${ch ? "gb-ch" : ""}"><input type="checkbox" ${attrs}${v ? " checked" : ""}></td>`;
  if (type === "list") return `<td class="${ch ? "gb-ch" : ""}"><input ${attrs} list="${o.list}" value="${esc(v == null ? "" : v)}" class="gb-in ${o.cls || ""}"${o.ph ? ` placeholder="${esc(o.ph)}"` : ""}></td>`;
  return `<td class="${ch ? "gb-ch" : ""}"><input ${attrs} ${type === "num" ? 'type="number" step="any"' : ""} value="${esc(v == null ? "" : v)}" class="gb-in ${type === "num" ? "n" : ""} ${o.cls || ""}"${o.ph ? ` placeholder="${esc(o.ph)}"` : ""}></td>`;
};
const rowTools = (kind, r) => (can() ? `<td class="gb-rt">${r.changed && r.changed.length ? `<button type="button" class="gb-x" data-act="reset" data-k="${kind}" data-u="${esc(r.uid)}" title="Back to the model's values">↺</button>` : ""}`
  + `<button type="button" class="gb-x" data-act="del" data-k="${kind}" data-u="${esc(r.uid)}" title="${r.from === "model" ? "Leave this one out of the workbook" : "Delete this row"}">✕</button></td>` : "<td></td>");

/* -------------------------------------------------------------------- parts */

function partSite(R) {
  const d = D().site, s = R.s;
  const sel = (k, opts) => `<select data-site="${k}"${can() ? "" : " disabled"}>${opts.map(([v, t]) => `<option value="${v}"${String(d[k] || "") === v ? " selected" : ""}>${t}</option>`).join("")}</select>`;
  const inp = (k, ph, step = "any") => `<input type="number" step="${step}" data-site="${k}" value="${esc(d[k] == null ? "" : d[k])}" placeholder="${esc(ph)}"${can() ? "" : " disabled"}>`;
  const res = (lbl, v, unit, sub) => `<div class="gb-big"><small>${lbl}</small><b>${v}${unit ? ` <span>${unit}</span>` : ""}</b>${sub ? `<em>${sub}</em>` : ""}</div>`;
  return `<div class="gb-card"><h3>Site</h3><div class="gb-form">
      <label>Site area (m²)${inp("area", "e.g. 7192.891")}</label>
      <label>Class of site${sel("cls", [["", "Choose ..."], ["A", "Class A - one street"], ["B", "Class B - two streets (corner)"], ["C", "Class C - three streets"]])}</label>
      <label>Building${sel("kind", [["non-domestic", "Non-domestic"], ["domestic", "Domestic"], ["composite", "Composite"]])}</label>
      <label>Street low level (mPD)${inp("street_low", "e.g. 156.790")}</label>
      <label>Street high level (mPD)${inp("street_high", "e.g. 161.180")}</label>
      <label>Roof level (mPD)${inp("roof", "e.g. 178.600")}</label>
      <label>or the height (m)${inp("height", "if not from levels")}</label>
      <label class="gb-chk"><input type="checkbox" data-site="sprinkler"${d.sprinkler ? " checked" : ""}${can() ? "" : " disabled"}> Sprinkler protected throughout</label>
      <label class="gb-chk"><input type="checkbox" data-site="single_stair"${d.single_stair ? " checked" : ""}${can() ? "" : " disabled"}> One required staircase allowed (B6.1)</label>
    </div></div>
    <div class="gb-card"><h3>Permitted (Cap. 123F First Schedule) ${chip(s.status === "ok" ? "ok" : "check", s.status === "ok" ? s.band : "Needs data")}</h3>
      ${s.status !== "ok" ? `<p class="muted">${esc(s.why)}</p>` : `
      <div class="gb-bigs">
        ${res("Mean street level", s.mean != null ? f3(s.mean) : "—", "mPD")}
        ${res("Height of building", f3(s.height), "m", s.mean != null ? `${f3(d.roof)} - ${f3(s.mean)}` : "")}
        ${res("Site coverage", s.sc, "%", `${f3(s.sc_area)} m²`)}
        ${res("Plot ratio", s.pr, "", `GFA ${f3(s.gfa)} m²`)}
      </div>
      <table class="gb-t"><tr><th></th><th>SC %</th><th>SC area m²</th><th>PR</th><th>GFA m²</th></tr>
        <tr${s.kind === "domestic" ? ' class="on"' : ""}><td>Domestic</td><td>${s.dom.sc}</td><td>${f3(s.dom.sc_area)}</td><td>${s.dom.pr}</td><td>${f3(s.dom.gfa)}</td></tr>
        <tr${s.kind === "non-domestic" ? ' class="on"' : ""}><td>Non-domestic</td><td>${s.non.sc}</td><td>${f3(s.non.sc_area)}</td><td>${s.non.pr}</td><td>${f3(s.non.gfa)}</td></tr></table>
      ${R.comp ? `<p>Composite (reg 21): PR ${R.comp.pr} ${chip(R.comp.ok_pr ? "ok" : "fail")} · SC ${R.comp.sc} ${chip(R.comp.ok_sc ? "ok" : "fail")} - each part as a share of what it may have, together not more than 1.</p>` : ""}`}
      <p class="gb-srcs">${src("first")}</p></div>
    <div class="gb-card"><h3>Actual site coverage ${R.sc.rows.length ? chip(R.sc.status || "check") : chip("check", "No SC areas")}</h3>
      ${R.sc.rows.length ? `<p>Covered ${f3(R.sc.outline)} m² - deducted ${f3(R.sc.deduct)} m² = <b>${f3(R.sc.actual)} m²</b>${R.sc.permitted != null ? ` against ${f3(R.sc.permitted)} m² permitted (${(R.sc.actual / (s.area || 1) * 100).toFixed(2)}% of the site)` : ""}.</p>`
        : `<p class="muted">Areas with Area-Type SC-D0 / SC-ND0 (and SC-D1/2, SC-ND1/2 deducted) give the actual site coverage - from the model's site coverage area plan, or add them under GFA & concessions.</p>`}</div>`;
}

function partGfa(R) {
  const g = R.g, d = D();
  const levels = g.levels.slice().sort((a, b) => byLevel(a.level, b.level));
  const lvRows = levels.map((L) => `<tr><td>${esc(L.level || "(no level)")}</td><td class="n">${f3(L.outline)}</td><td class="n">${f3(L.deduct)}</td><td class="n"><b>${f3(L.gfa)}</b></td><td class="n">${f3(L.dom)}</td><td class="n">${f3(L.non)}</td></tr>`).join("");
  const conc = g.concessions.map((c) => `<tr><td>${esc(c.item)}</td><td>${esc(c.text)}</td><td>${esc(c.pn || "")}</td><td class="c">${c.pre ? "✓" : ""}</td><td class="c">${c.cap ? "✓" : ""}</td>`
    + `<td>${esc(Object.entries(c.levels).sort((a, b) => byLevel(a[0], b[0])).map(([l, a]) => `${l} ${f3(a)}`).join(", "))}</td><td class="n"><b>${f3(c.area)}</b></td></tr>`).join("");
  const lim = g.limits.map((x) => `<tr><td>${esc(x.item)}</td><td>${esc(x.label)}</td><td>${esc(x.level)}</td><td class="n">${f3(x.area)}</td><td class="n">${f3(x.allowed)}</td><td>${chip(x.status)}</td></tr>`).join("");
  const rows = R.areas.slice().sort((a, b) => byLevel(a.level, b.level) || String(a.type).localeCompare(String(b.type)));
  const types = ["GFA-D0", "GFA-ND0", ...APP151.map((a) => "GFA-C" + a.item), "SC-D0", "SC-D1", "SC-D2", "SC-ND0", "SC-ND1", "SC-ND2", "FC-0", "FC-1"];
  return `<div class="gb-card"><h3>GFA by floor ${chip(R.st.gfa)}</h3>
      ${levels.length ? `<table class="gb-t"><tr><th>Floor</th><th>Outline m²</th><th>Deducted m²</th><th>GFA m²</th><th>Domestic</th><th>Non-domestic</th></tr>${lvRows}
        <tr class="tot"><td>Total</td><td></td><td></td><td class="n"><b>${f3(g.total)}</b></td><td class="n">${f3(g.dom)}</td><td class="n">${f3(g.non)}</td></tr></table>
        <p>${g.permitted != null ? `Total GFA ${f3(g.total)} m² against ${f3(g.permitted)} m² permitted ${chip(g.status)} (plot ratio ${(g.total / (R.s.area || 1)).toFixed(3)})` : "Give the site (Site, PR & SC) to compare with the permitted GFA."}</p>`
        : `<p class="muted">No GFA areas yet: areas with Area-Type GFA-D0 / GFA-ND0 (the outline), deducted ones (Area Deduct = Yes) and concessions GFA-C<i>item</i> (e.g. GFA-C2.3 for an AHU room) - from the model's GFA area plans, or added below.</p>`}
      <p class="gb-srcs">${src("reg23")}</p></div>
    <div class="gb-card"><h3>GFA concessions (PNAP APP-151) ${g.concessions.length ? chip(g.cap_status) : ""}</h3>
      ${g.concessions.length ? `<table class="gb-t"><tr><th>Item</th><th>Feature</th><th>Practice notes</th><th>Pre-req.</th><th>10% cap</th><th>Floors</th><th>Area m²</th></tr>${conc}</table>
        <p>Under the overall cap: <b>${f3(g.capped)} m²</b> against ${g.cap_pct}% of the total GFA = ${f3(g.cap_allowed)} m² ${chip(g.cap_status)}. A composite development is capped for its domestic and non-domestic parts separately (para 4).</p>`
        : `<p class="muted">No concessions (Area-Type GFA-C<i>item</i>) yet.</p>`}
      ${lim ? `<h4>Item limits</h4><table class="gb-t"><tr><th>Item</th><th></th><th>Floor</th><th>Area m²</th><th>Allowed m²</th><th></th></tr>${lim}</table>` : ""}
      <p class="gb-lim">${ITEM_LIMITS.map((l) => `${esc(l.label)}: at most <input type="number" step="any" data-limit="${esc(l.item)}" value="${esc(d.limits[l.item] != null ? d.limits[l.item] : l.pct_of_floor_gfa)}"${can() ? "" : " disabled"}>% of that floor's GFA <small class="muted">(office setting - verify with ${esc(l.verify)})</small>`).join("<br>")}</p>
      <p class="gb-srcs">${src("app151")} ${src("office")}</p></div>
    <div class="gb-card"><h3>Areas (${rows.length})</h3>
      <datalist id="gb-types">${types.map((t) => `<option value="${t}">`).join("")}</datalist>
      <div class="gb-scroll"><table class="gb-t gb-ed"><tr><th>Floor</th><th>No.</th><th>Name</th><th>Area-Type</th><th>Deducted</th><th>Area m²</th><th></th></tr>
      ${rows.map((r) => `<tr class="${r.from === "added" ? "gb-own" : ""}">${cell("areas", r, "level", "text")}${cell("areas", r, "number", "text", { cls: "s" })}${cell("areas", r, "name", "text")}${cell("areas", r, "type", "list", { list: "gb-types", cls: "s" })}${cell("areas", r, "deduct", "bool")}${cell("areas", r, "area", "num")}${rowTools("areas", r)}</tr>`).join("")}
      </table></div>
      ${can() ? `<p><input data-newlevel="areas" placeholder="Floor (e.g. 1/F)" class="gb-nl"> <button type="button" class="ghost" data-add="areas">+ Area</button>${D().areas.hide.length ? ` <button type="button" class="ghost" data-unhide="areas">Show the ${D().areas.hide.length} left out</button>` : ""}</p>` : ""}</div>`;
}

function partMoe(R) {
  const keys = [...B1, ...D().b1];
  const rooms = R.rooms.slice().sort((a, b) => byLevel(a.level, b.level) || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
  const ex = (r) => {
    if (r.status === "check") return `<td colspan="4" class="muted">${esc(r.why)}</td><td>${chip("check")}</td>`;
    const e = r.exit;
    if (e.status === "na") return `<td colspan="4" class="muted">${esc(e.req.why)}</td><td>${chip("na")}</td>`;
    if (e.req.beyond) return `<td colspan="4" class="muted">${esc(e.req.why)}</td><td>${chip("check")}</td>`;
    const it = (i) => (e.items[i] ? `${f0(e.items[i].need)} / ${e.items[i].have == null ? "?" : f0(e.items[i].have)}` : "");
    return `<td class="n">${it(0)}</td><td class="n">${it(1)}</td><td class="n">${it(2)}</td>${cell("rooms", r, "widths", "text", { ph: "900, 1050 x2", cls: "w" })}<td>${chip(e.status)}</td>`;
  };
  const st = R.storeys.map((L) => {
    const o = D().storeys[L.level] || {};
    const e = L.exit;
    const need = e.need ? `${e.need.n} · ${f0(e.need.total)} mm · ${f0(e.need.each)} mm` : esc(e.req.why || "");
    const inp = (f, ph, cls) => `<input data-storey="${esc(L.level)}" data-f="${f}" value="${esc(o[f] == null ? "" : o[f])}" placeholder="${esc(ph)}" class="gb-in ${cls || ""}"${can() ? "" : " disabled"}>`;
    return `<tr><td>${esc(L.level || "(no level)")}</td><td class="n">${f0(L.from_rooms)}</td><td>${inp("capacity", "", "n")}</td><td class="n"><b>${f0(L.capacity)}</b></td>
      <td>${need}</td><td>${inp("routes", "1200 x3", "w")}</td><td>${inp("stairs", "S-1, S-2", "w")}</td>
      <td class="c"><input type="checkbox" data-storey="${esc(L.level)}" data-f="ground"${L.ground ? " checked" : ""}${can() ? "" : " disabled"}></td>
      <td class="c"><input type="checkbox" data-storey="${esc(L.level)}" data-f="basement"${L.basement ? " checked" : ""}${can() ? "" : " disabled"}></td><td>${e.status === "na" ? chip("na") : chip(e.status)}</td></tr>`;
  }).join("");
  return `<div class="gb-card"><h3>Rooms: occupant capacity and exits ${chip(R.st.moe)}</h3>
      <datalist id="gb-keys">${keys.map((k) => `<option value="${esc(k.key)}">${esc((k.factor ? k.factor + " m² - " : "") + k.use)}</option>`).join("")}</datalist>
      <p class="muted">Exits: required / provided - from the room's parameters, or the door widths typed here (wider doors counted at 1.5 × the narrowest, B7.3). Rooms not counted in the UFA are left out.</p>
      <div class="gb-scroll"><table class="gb-t gb-ed"><tr><th>Floor</th><th>No.</th><th>Room</th><th>Use (B1)</th><th>UFA m²</th><th>Factor</th><th>By number</th><th>Load</th><th>Exit doors</th><th>Total width</th><th>Each</th><th>Door widths</th><th></th><th></th></tr>
      ${rooms.map((r) => `<tr class="${r.from === "added" ? "gb-own" : ""}">${cell("rooms", r, "level", "text", { cls: "s" })}${cell("rooms", r, "number", "text", { cls: "s" })}${cell("rooms", r, "name", "text")}${cell("rooms", r, "key", "list", { list: "gb-keys", cls: "s" })}${cell("rooms", r, "area", "num")}<td class="n" title="${esc(r.use || "")}">${r.factor ? r.factor : ""}</td>${cell("rooms", r, "by_number", "num", { int: true, cls: "s" })}<td class="n"><b>${r.load == null ? "" : f0(r.load)}</b></td>${ex(r)}${rowTools("rooms", r)}</tr>`).join("")}
      </table></div>
      ${can() ? `<p><input data-newlevel="rooms" placeholder="Floor (e.g. G/F)" class="gb-nl"> <button type="button" class="ghost" data-add="rooms">+ Room</button>${D().rooms.hide.length ? ` <button type="button" class="ghost" data-unhide="rooms">Show the ${D().rooms.hide.length} left out</button>` : ""}</p>` : ""}
      <details class="gb-more"><summary>Uses of the office's own (${D().b1.length})</summary>
        <p class="muted">A Use Classification key that is not in Table B1 (e.g. "DR" dressing room, 2 m² per person) - with its factor and why.</p>
        <table class="gb-t">${D().b1.map((x, i) => `<tr><td>${esc(x.key)}</td><td>${esc(x.factor)} m²</td><td>${esc(x.use)}</td><td>${can() ? `<button type="button" class="gb-x" data-delb1="${i}">✕</button>` : ""}</td></tr>`).join("")}</table>
        ${can() ? `<p><input id="gb-b1k" placeholder="Key" class="s"> <input id="gb-b1f" type="number" step="any" placeholder="m² per person" class="s"> <input id="gb-b1u" placeholder="Use and why"> <button type="button" class="ghost" id="gb-b1add">Add</button></p>` : ""}
      </details>
      <p class="gb-srcs">${src("b1")} ${src("b2")} ${src("b7")}</p></div>
    <div class="gb-card"><h3>Storeys</h3>
      <p class="muted">The storey's occupant capacity is the sum of its rooms (or type your own). Exit routes: their widths (at least 2 routes, B8.1). Staircases: the marks of the required staircases the storey uses - for the discharge.</p>
      <div class="gb-scroll"><table class="gb-t gb-ed"><tr><th>Floor</th><th>From rooms</th><th>Own figure</th><th>Capacity</th><th>Needs (routes · total · each)</th><th>Exit route widths</th><th>Staircases used</th><th>Ground</th><th>Basement</th><th></th></tr>${st}</table></div>
      ${can() ? `<p><input id="gb-newst" placeholder="Add a floor (e.g. R/F)" class="gb-nl"> <button type="button" class="ghost" id="gb-addst">+ Floor</button></p>` : ""}
      <p class="gb-srcs">${src("b8")}</p></div>`;
}

function partStairs(R) {
  const d = D(), dis = R.dis;
  const lv = R.storeys.filter((x) => !x.ground);
  const marks = d.stairs.map((s) => String(s.mark));
  const chk = (s, i, f) => `<td class="c"><input type="checkbox" data-stair="${i}" data-f="${f}"${s[f] ? " checked" : ""}${can() ? "" : " disabled"}></td>`;
  const inp = (s, i, f, ph, num) => `<td><input data-stair="${i}" data-f="${f}" ${num ? 'type="number" step="any"' : ""} value="${esc(s[f] == null ? "" : s[f])}" placeholder="${esc(ph)}" class="gb-in ${num ? "n" : "s"}"${can() ? "" : " disabled"}></td>`;
  const rows = d.stairs.map((s, i) => {
    const r = dis.stairs.find((x) => String(x.mark) === String(s.mark)) || {};
    return `<tr>${inp(s, i, "mark", "S-1")}${inp(s, i, "width", "1200", true)}<td class="n">${f0(r.served)}</td>${inp(s, i, "storeys", "auto", true)}${chk(s, i, "up")}${chk(s, i, "scissors")}
      <td class="n">${r.capacity == null ? "?" : f0(r.capacity)} <small class="muted">${esc(r.table || "")}</small></td><td class="n"><b>${f0(r.value)}</b></td><td>${chip(r.status)}${r.note ? `<br><small class="muted">${esc(r.note)}</small>` : ""}</td>
      <td>${can() ? `<button type="button" class="gb-x" data-delstair="${i}">✕</button>` : ""}</td></tr>`;
  }).join("");
  const grid = lv.length && marks.length ? `<div class="gb-scroll"><table class="gb-t"><tr><th>Floor</th><th>Capacity</th>${marks.map((m) => `<th>${esc(m)}</th>`).join("")}</tr>
    ${lv.map((L) => `<tr><td>${esc(L.level)}</td><td class="n">${f0(L.capacity)}</td>${marks.map((m) => { const row = dis.storeys.find((x) => x.level === L.level); return `<td class="n">${row && row.shares[m] != null ? f0(row.shares[m]) : ""}</td>`; }).join("")}</tr>`).join("")}
    <tr class="tot"><td>Discharge value</td><td></td>${marks.map((m) => `<td class="n"><b>${f0((dis.stairs.find((x) => String(x.mark) === m) || {}).value)}</b></td>`).join("")}</tr></table></div>` : "";
  return `<div class="gb-card"><h3>Required staircases ${chip(R.st.stairs)}</h3>
      <p class="muted">${d.site.sprinkler ? "Sprinkler protected: Table B4." : "Not sprinkler protected: Table B3 (tick it under Site if the whole building is)."} Storeys served: counted from the floors that list the staircase (Occupancy & exits > Storeys), or typed. Each floor's capacity is shared between the staircases it uses.</p>
      <div class="gb-scroll"><table class="gb-t gb-ed"><tr><th>Mark</th><th>Clear width mm</th><th>Storeys served</th><th>Own figure</th><th>Exit upwards</th><th>Scissors</th><th>Capacity</th><th>Discharge value</th><th></th><th></th></tr>${rows}</table></div>
      ${can() ? `<p><button type="button" class="ghost" id="gb-addstair">+ Staircase</button></p>` : ""}
      ${dis.unshared.length ? `<p class="gb-warn">No staircase given for: ${esc(dis.unshared.join(", "))} - list them under Storeys.</p>` : ""}
      <p>All storeys above the ground storey: <b>${f0(dis.total.above)}</b> persons; the staircases take <b>${f0(dis.total.capacity)}</b> ${chip(dis.total.status)}${dis.total.basement ? ` · basements ${f0(dis.total.basement)} / ${f0(dis.total.basement_capacity)}` : ""} (B12.1 / B12.2).</p>
      <p class="gb-srcs">${src(d.site.sprinkler ? "b4" : "b3")} ${src("b12")}</p></div>
    ${grid ? `<div class="gb-card"><h3>Each floor's share</h3>${grid}</div>` : ""}`;
}

function partMap() {
  const d = D(), m = G.model;
  return `<div class="gb-card"><h3>From the model</h3>
      ${G.modelErr ? `<p class="gb-warn">${esc(G.modelErr)}</p>` : m ? `<p>${m.rooms.length} room(s) and ${m.areas.length} area(s) on ${m.sheets} published plan sheet(s)${m.schemes.length ? ` - area schemes: ${esc(m.schemes.join(", "))}` : ""}.</p>
        <p class="muted">Only rooms and areas shown on a published plan sheet come here. Publish the GBP area plans (GFA, site coverage) and the floor plans with rooms from Revit; anything else can be typed in.</p>` : "<p class=\"muted\">Reading the sheets ...</p>"}
      <p><button type="button" class="ghost" id="gb-reload">Read the model again</button></p></div>
    <div class="gb-card"><h3>Parameter names</h3>
      <p class="muted">The names of the Revit parameters the workbook reads (the office's GBP setting names by default). Change them if this project's are different.</p>
      <table class="gb-t">${Object.keys(MAP_DEFAULTS).map((k) => `<tr><td>${esc(MAP_LABELS[k])}</td><td><input data-map="${k}" value="${esc(d.map[k] || "")}" placeholder="${esc(MAP_DEFAULTS[k])}"${can() ? "" : " disabled"}></td></tr>`).join("")}</table></div>`;
}

/* --------------------------------------------------------------------- page */

function render() {
  if (!G.el || !G.wb) return;
  const R = calc();
  G.last = R;
  const nav = PARTS.map((p) => `<button type="button" class="gb-p${p.id === G.part ? " on" : ""}" data-part="${p.id}"${p.soon ? " disabled title=\"Next release\"" : ""}>${esc(p.label)}${R.st[p.id] ? " " + chip(R.st[p.id]) : p.soon ? ' <small class="muted">next</small>' : ""}</button>`).join("");
  const body = { site: partSite, gfa: partGfa, moe: partMoe, stairs: partStairs, map: partMap }[G.part](R);
  const keepScroll = (G.el.querySelector(".gb-main") || {}).scrollTop || 0;
  G.el.innerHTML = `<aside class="gb-nav">${nav}<div class="gb-meta">${can() ? "" : "<b>View only</b><br>"}${G.wb.at ? `Last change ${esc(G.wb.by || "")}, ${esc(G.wb.at.replace("T", " ").slice(0, 16))}` : "Nothing saved yet"}<br><span class="gb-saved"></span></div>
      <div class="gb-acts"><button type="button" class="ghost" id="gb-xlsx">Excel (all)</button></div></aside>
    <section class="gb-main">${body}<p class="gb-disc">Worked from the code tables as transcribed (each result names its source). Check against the current documents before submission; the Building Authority's decision prevails.</p></section>`;
  G.el.querySelector(".gb-main").scrollTop = keepScroll;
}

function wire() {
  const el = G.el;
  el.addEventListener("click", (ev) => {
    const t = ev.target.closest("button");
    if (!t) return;
    if (t.dataset.part) { G.part = t.dataset.part; try { localStorage.setItem(KEEP, G.part); } catch (e) {} render(); return; }
    if (t.dataset.clause) { if (G.opts.findClause) G.opts.findClause(t.dataset.clause); return; }
    if (t.dataset.act) return rowAct(t.dataset.k, t.dataset.u, t.dataset.act);
    if (t.dataset.add) return addRow(t.dataset.add);
    if (t.dataset.unhide) { D()[t.dataset.unhide].hide = []; return changed(); }
    if (t.dataset.delstair != null) { D().stairs.splice(Number(t.dataset.delstair), 1); return changed(); }
    if (t.dataset.delb1 != null) { D().b1.splice(Number(t.dataset.delb1), 1); return changed(); }
    if (t.id === "gb-addstair") { D().stairs.push({ mark: "S-" + (D().stairs.length + 1), width: 1200 }); return changed(); }
    if (t.id === "gb-addst") { const v = (el.querySelector("#gb-newst").value || "").trim(); if (v) { D().storeys[v] = D().storeys[v] || {}; changed(); } return; }
    if (t.id === "gb-b1add") {
      const k = el.querySelector("#gb-b1k").value.trim(), f = Number(el.querySelector("#gb-b1f").value);
      if (!k || !(f > 0)) { toast("A key and a factor (m² per person)", true); return; }
      D().b1 = D().b1.filter((x) => x.key !== k).concat([{ key: k, factor: f, use: el.querySelector("#gb-b1u").value.trim() || k }]);
      return changed();
    }
    if (t.id === "gb-reload") { readModel().then(render); return; }
    if (t.id === "gb-xlsx") return excel();
  });
  el.addEventListener("change", (ev) => {
    const t = ev.target, d = D();
    if (t.dataset.site) { d.site[t.dataset.site] = t.type === "checkbox" ? t.checked : t.type === "number" ? (t.value === "" ? null : Number(t.value)) : t.value; return changed(); }
    if (t.dataset.k && t.dataset.f) return setCell(t.dataset.k, t.dataset.u, t.dataset.f, t.type === "checkbox" ? t.checked : t.value.trim());
    if (t.dataset.storey) {
      const o = d.storeys[t.dataset.storey] = d.storeys[t.dataset.storey] || {};
      o[t.dataset.f] = t.type === "checkbox" ? t.checked : t.dataset.f === "capacity" ? (t.value === "" ? null : Number(t.value)) : t.value.trim();
      return changed();
    }
    if (t.dataset.stair != null) {
      const s = d.stairs[Number(t.dataset.stair)];
      s[t.dataset.f] = t.type === "checkbox" ? t.checked : t.type === "number" ? (t.value === "" ? null : Number(t.value)) : t.value.trim();
      return changed();
    }
    if (t.dataset.map) { if (t.value.trim()) d.map[t.dataset.map] = t.value.trim(); else delete d.map[t.dataset.map]; return changed(); }
    if (t.dataset.limit) { d.limits[t.dataset.limit] = t.value === "" ? null : Number(t.value); return changed(); }
  });
}

/* ------------------------------------------------------------------- Excel */

function sheetsOf(R) {
  const S = [];
  const s = R.s;
  S.push({ name: "Site PR SC", title: "Site coverage & plot ratio calculation", note: `${SRC.first.doc}, ${SRC.first.ref}`,
    head: ["Item", "Value"], widths: [48, 30],
    rows: [["Site boundary area (m2)", s.area], ["Class of site", s.cls], ["Mean street level (mPD)", s.mean], ["Height of building (m)", s.height], ["Height band", s.band],
      ["Permitted site coverage (%)", s.sc], ["Permitted site coverage area (m2)", s.sc_area], ["Permitted plot ratio", s.pr], ["Permitted GFA (m2)", s.gfa],
      ["Actual site coverage area (m2)", R.sc.actual], ["Actual GFA (m2)", R.g.total]] });
  S.push({ name: "GFA", title: "GFA calculation by floor", note: SRC.reg23.doc + " " + SRC.reg23.ref, head: ["Floor", "Outline m2", "Deducted m2", "GFA m2", "Domestic m2", "Non-domestic m2"],
    rows: R.g.levels.map((L) => [L.level, L.outline, L.deduct, L.gfa, L.dom, L.non]).concat([["TOTAL", "", "", R.g.total, R.g.dom, R.g.non]]) });
  S.push({ name: "GFA concessions", title: "List of GFA concessions (PNAP APP-151)", note: `Under the 10% overall cap: ${R.g.capped} m2 of ${R.g.cap_allowed} m2 allowed`,
    head: ["Item", "Feature", "Practice notes", "Pre-requisites", "10% cap", "Area m2"], widths: [8, 60, 22, 12, 10, 12],
    rows: R.g.concessions.map((c) => [c.item, c.text, c.pn, c.pre ? "Yes" : "", c.cap ? "Yes" : "", c.area]) });
  S.push({ name: "Areas", title: "Areas", head: ["Floor", "No.", "Name", "Area-Type", "Deducted", "Area m2", "From"],
    rows: R.areas.map((a) => [a.level, a.number, a.name, a.type, a.deduct ? "Yes" : "No", a.area, a.from === "model" ? (a.changed ? "model, changed" : "model") : "added"]) });
  const lbl = { ok: "OK", fail: "Fails", check: "Check", na: "-" };
  S.push({ name: "Rooms exits", title: "Schedule of minimum of exit route & exit door", note: `${SRC.b1.ref}; ${SRC.b2.ref}`,
    head: ["Floor", "No.", "Room", "Use", "UFA m2", "Factor", "Occupant load", "Exits req'd", "Exits prov'd", "Total width req'd", "Total width prov'd", "Each req'd", "Each prov'd", "Status"],
    rows: R.rooms.map((r) => { const e = r.exit, it = e.items || []; return [r.level, r.number, r.name, r.key, r.area, r.factor || (r.by_number != null ? "by number" : ""), r.load,
      it[0] ? it[0].need : "", it[0] ? it[0].have : "", it[1] ? it[1].need : "", it[1] ? it[1].have : "", it[2] ? it[2].need : "", it[2] ? it[2].have : "", lbl[r.status === "check" ? "check" : e.status]]; }),
    marks: R.rooms.map((r) => (r.status === "check" ? "check" : r.exit.status)) });
  S.push({ name: "Storeys", title: "Calculation of discharge value", note: SRC.b12.ref,
    head: ["Floor", "Storey occupant capacity", "Min. no. of exit routes", "Min. total width (mm)", "Min. width each (mm)", "Staircases used", ...R.dis.stairs.map((x) => String(x.mark))],
    rows: R.storeys.map((L) => { const row = R.dis.storeys.find((x) => x.level === L.level) || { shares: {} }; return [L.level, L.capacity, L.exit.need ? L.exit.need.n : "", L.exit.need ? L.exit.need.total : "", L.exit.need ? L.exit.need.each : "", L.stairs.join(", "), ...R.dis.stairs.map((x) => (row.shares[x.mark] != null ? row.shares[x.mark] : ""))]; })
      .concat([["DISCHARGE VALUE", "", "", "", "", "", ...R.dis.stairs.map((x) => x.value)]]) });
  S.push({ name: "Staircases", title: "Staircase discharge compliance", note: `${D().site.sprinkler ? SRC.b4.ref : SRC.b3.ref}`,
    head: ["Staircase", "Clear width (mm)", "Storeys served", "Discharge capacity", "Discharge value", "Value <= capacity"],
    rows: R.dis.stairs.map((x) => [x.mark, x.width, x.served, x.capacity, x.value, lbl[x.status]]), marks: R.dis.stairs.map((x) => x.status) });
  return S;
}

async function excel() {
  const R = G.last || calc();
  const p = project();
  try {
    const res = await fetch("/api/gbp/xlsx", { method: "POST", headers: headers(true),
      body: JSON.stringify({ name: "GBP workbook - " + p, project: p, sheets: sheetsOf(R) }) });
    if (!res.ok) { let m = "HTTP " + res.status; try { m = (await res.json()).detail || m; } catch (e) {} throw new Error(m); }
    const kept = res.headers.get("X-Kept");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "GBP workbook - " + p + ".xlsx";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(kept ? "Downloaded, and kept in Folders: " + kept : "Downloaded");
  } catch (e) { toast("No Excel: " + e.message, true); }
}

async function readModel() {
  G.modelErr = "";
  try { G.model = await loadModel(project(), headers()); }
  catch (e) { G.model = { rooms: [], areas: [], schemes: [], sheets: 0 }; G.modelErr = e.message; }
}

export async function mountGbp(el, opts) {
  G.el = el; G.opts = opts || {};
  try { const p = localStorage.getItem(KEEP); if (p && PARTS.some((x) => x.id === p && !x.soon)) G.part = p; } catch (e) {}
  el.innerHTML = `<p class="muted" style="padding:20px">Opening the workbook ...</p>`;
  if (!project()) { el.innerHTML = `<p class="muted" style="padding:20px">Choose a project first (the project list at the top).</p>`; return; }
  await Promise.all([loadWb(), readModel()]);
  wire();
  render();
}
export const _test = { calc, sheetsOf, G };
