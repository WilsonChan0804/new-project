/* Dashboard for one task list: the four numbers, done / overdue, who holds
 * what, how long things take, and what is coming due. Drawn in the same
 * plain HTML / SVG as the issue dashboard (dashboard.js). */

import { esc, today, addDays, daysBetween, isOverdue, fmtDate, people } from "./tasks-util.js";

const C = { done: "#0e9f6e", open: "#f28022", over: "#e2453c", ok: "#3b82f6", bar: "#6366f1" };

function donut(parts, centre, label) {
  const total = parts.reduce((s, p) => s + p.n, 0) || 1;
  let a = -Math.PI / 2, arcs = "";
  for (const p of parts) {
    if (!p.n) continue;
    const a2 = a + (p.n / total) * Math.PI * 2 - 0.0001;
    const big = a2 - a > Math.PI ? 1 : 0;
    const r = 58, ri = 40;
    const P = (ang, rr) => `${70 + rr * Math.cos(ang)} ${70 + rr * Math.sin(ang)}`;
    arcs += `<path d="M${P(a, r)} A${r} ${r} 0 ${big} 1 ${P(a2, r)} L${P(a2, ri)} A${ri} ${ri} 0 ${big} 0 ${P(a, ri)}Z" fill="${p.c}" stroke="var(--panel)" stroke-width="2"><title>${esc(p.label)}: ${p.n} (${Math.round((p.n / total) * 100)}%)</title></path>`;
    a = a2;
  }
  return `<div class="donut"><svg viewBox="0 0 140 140" width="140" height="140">${arcs}`
    + `<text x="70" y="72" text-anchor="middle" class="big">${esc(centre)}</text>`
    + `<text x="70" y="88" text-anchor="middle" class="small">${esc(label)}</text></svg>`
    + `<ul>${parts.map((p) => `<li><i style="background:${p.c}"></i><span>${esc(p.label)}</span><b>${p.n}</b><small class="muted">${Math.round((p.n / total) * 100)}%</small></li>`).join("")}</ul></div>`;
}

/* horizontal bars, optionally split in two (done | open) */
function hbars(rows, opts) {
  opts = opts || {};
  if (!rows.length) return `<div class="empty">Nothing yet.</div>`;
  const max = Math.max(...rows.map((r) => r.total)) || 1;
  return `<div class="hbars">` + rows.map((r) =>
    `<div class="hbar${r.key ? " click" : ""}" ${r.key ? `data-owner="${esc(r.key)}"` : ""} title="${esc(r.tip || "")}"><span class="lab">${esc(r.label)}</span>`
    + `<span class="track tsplit">${(r.parts || [{ n: r.total, c: opts.color || C.bar }]).map((p) =>
      `<i style="width:${(p.n / max) * 100}%;background:${p.c}"></i>`).join("")}</span>`
    + `<span class="val">${esc(opts.fmt ? opts.fmt(r.total) : r.total)}</span></div>`).join("") + `</div>`;
}

/* completed per week, the last 12 weeks */
function weeks(tasks) {
  const t0 = today();
  const mon = addDays(t0, -((new Date(t0 + "T00:00:00Z").getUTCDay() + 6) % 7));
  const cols = [];
  for (let i = 11; i >= 0; i--) {
    const a = addDays(mon, -7 * i), b = addDays(a, 7);
    cols.push({ a, n: tasks.filter((t) => t.done && t.completed_at && t.completed_at.slice(0, 10) >= a && t.completed_at.slice(0, 10) < b).length });
  }
  const max = Math.max(1, ...cols.map((c) => c.n));
  const W = 560, H = 150, bw = W / cols.length;
  return `<svg class="tw" viewBox="0 0 ${W} ${H + 20}" width="100%" preserveAspectRatio="none">`
    + `<line x1="0" x2="${W}" y1="${H}" y2="${H}" stroke="var(--line)"/>`
    + cols.map((c, i) => {
      const h = (c.n / max) * (H - 18);
      return `<g><rect x="${i * bw + bw * 0.22}" y="${H - h}" width="${bw * 0.56}" height="${Math.max(h, c.n ? 2 : 0)}" rx="3" fill="${C.done}"><title>Week of ${fmtDate(c.a)}: ${c.n} completed</title></rect>`
        + (c.n ? `<text x="${i * bw + bw / 2}" y="${H - h - 4}" text-anchor="middle" class="tw-v">${c.n}</text>` : "")
        + `<text x="${i * bw + bw / 2}" y="${H + 14}" text-anchor="middle" class="tw-x">${esc(fmtDate(c.a))}</text></g>`;
    }).join("") + `</svg>`;
}

export function render(T, el) {
  const S = T.S;
  const D = S.dash || (S.dash = { group: "", subs: true, range: "0" });
  let all = [...S.tasks.values()];
  if (!D.subs) all = all.filter((t) => !t.parent_id);
  if (D.group) all = all.filter((t) => t.group_id === D.group);
  if (D.range !== "0") {
    const since = addDays(today(), -Number(D.range));
    all = all.filter((t) => (t.created_at || "").slice(0, 10) >= since || (t.due || "") >= since || !t.done);
  }
  const done = all.filter((t) => t.done), open = all.filter((t) => !t.done), over = all.filter(isOverdue);

  // per person
  const per = new Map();
  for (const t of all) for (const p of (t.owners.length ? t.owners : [{ name: "No owner" }])) {
    const k = T.ownerKey(p);
    if (!per.has(k)) per.set(k, { key: k, label: p.name, done: 0, open: 0, over: 0, durs: [] });
    const r = per.get(k);
    t.done ? r.done++ : r.open++;
    if (isOverdue(t)) r.over++;
    if (t.done && t.completed_at) {
      const s = (t.start || t.created_at || "").slice(0, 10);
      if (s) r.durs.push(Math.max(0, daysBetween(s, t.completed_at.slice(0, 10))));
    }
  }
  const byPerson = [...per.values()].sort((a, b) => (b.done + b.open) - (a.done + a.open)).slice(0, 20).map((r) => ({
    key: r.key, label: r.label, total: r.done + r.open, tip: `${r.done} done, ${r.open} open, ${r.over} overdue`,
    parts: [{ n: r.done, c: C.done }, { n: r.open - r.over, c: C.open }, { n: r.over, c: C.over }] }));
  const durations = [...per.values()].filter((r) => r.durs.length).map((r) => ({
    key: r.key, label: r.label, total: Math.round((r.durs.reduce((s, x) => s + x, 0) / r.durs.length) * 10) / 10,
    tip: `average over ${r.durs.length} completed task${r.durs.length > 1 ? "s" : ""}` }))
    .sort((a, b) => b.total - a.total).slice(0, 20);
  const byGroup = T.groups().map((g) => {
    const ts = all.filter((t) => t.group_id === g.id);
    const d = ts.filter((t) => t.done).length, o = ts.filter(isOverdue).length;
    return { label: g.title + (g.project ? " · " + g.project : ""), total: ts.length, tip: `${d} done, ${ts.length - d} open, ${o} overdue`,
      parts: [{ n: d, c: C.done }, { n: ts.length - d - o, c: C.open }, { n: o, c: C.over }] };
  }).filter((r) => r.total);

  const t0 = today(), soon = addDays(t0, 14);
  const coming = open.filter((t) => t.due && t.due.slice(0, 10) >= t0 && t.due.slice(0, 10) <= soon).sort((a, b) => a.due.localeCompare(b.due));
  const list = (ts, empty) => ts.length ? `<table class="td-list">` + ts.slice(0, 15).map((t) =>
    `<tr data-id="${esc(t.id)}"><td>${esc(t.title || "Untitled")}</td><td>${people(t.owners, 2)}</td><td class="num ${isOverdue(t) ? "bad" : ""}">${esc(fmtDate(t.due))}</td></tr>`).join("")
    + `</table>` + (ts.length > 15 ? `<p class="muted" style="font-size:11px">and ${ts.length - 15} more</p>` : "") : `<div class="empty">${empty}</div>`;
  const legend = `<div class="td-leg"><span><i style="background:${C.done}"></i>Done</span><span><i style="background:${C.open}"></i>Open</span><span><i style="background:${C.over}"></i>Overdue</span></div>`;

  el.innerHTML = `<div id="dash" class="td">
    <section class="filters">
      <label>Group <select id="dd-group"><option value="">All groups</option>${T.groups().map((g) => `<option value="${esc(g.id)}"${g.id === D.group ? " selected" : ""}>${esc(g.title)}</option>`).join("")}</select></label>
      <label>Period <select id="dd-range">${[["0", "All time"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["365", "Last 12 months"]].map(([v, n]) => `<option value="${v}"${v === D.range ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <label class="check"><input type="checkbox" id="dd-subs"${D.subs ? " checked" : ""}> Count sub-tasks</label>
    </section>
    <div class="td-kpis">
      <div class="td-kpi"><span>Total tasks</span><b>${all.length}</b></div>
      <div class="td-kpi ok"><span>Completed tasks</span><b>${done.length}</b></div>
      <div class="td-kpi warn"><span>Incomplete tasks</span><b>${open.length}</b></div>
      <div class="td-kpi bad"><span>Overdue tasks</span><b>${over.length}</b></div>
    </div>
    <div class="grid two">
      <section class="card"><h3>Tasks by completion status</h3>${donut([
        { label: "Done", n: done.length, c: C.done }, { label: "Not done", n: open.length, c: C.open }],
        all.length ? Math.round((done.length / all.length) * 100) + "%" : "-", "done")}</section>
      <section class="card"><h3>Tasks by overdue status</h3>${donut([
        { label: "Not overdue", n: all.length - over.length, c: C.ok }, { label: "Overdue", n: over.length, c: C.over }],
        String(over.length), "overdue")}</section>
    </div>
    <div class="grid two">
      <section class="card"><h3>Tasks by assignee <small>click a name to see their tasks</small></h3>${legend}${hbars(byPerson)}</section>
      <section class="card"><h3>Average task duration by assignee <small>days, start to completion</small></h3>${hbars(durations, { color: C.bar, fmt: (v) => v.toFixed(1) })}</section>
    </div>
    <div class="grid two">
      <section class="card"><h3>By group / project</h3>${legend}${hbars(byGroup)}</section>
      <section class="card"><h3>Completed per week <small>last 12 weeks</small></h3>${weeks(all)}</section>
    </div>
    <div class="grid two">
      <section class="card"><h3>Overdue <small>${over.length}</small></h3>${list(over.sort((a, b) => a.due.localeCompare(b.due)), "Nothing overdue.")}</section>
      <section class="card"><h3>Due in the next 14 days <small>${coming.length}</small></h3>${list(coming, "Nothing due soon.")}</section>
    </div>
  </div>`;
  el.querySelector("#dd-group").onchange = (ev) => { D.group = ev.target.value; render(T, el); };
  el.querySelector("#dd-range").onchange = (ev) => { D.range = ev.target.value; render(T, el); };
  el.querySelector("#dd-subs").onchange = (ev) => { D.subs = ev.target.checked; render(T, el); };
  el.onclick = (ev) => {
    const tr = ev.target.closest("tr[data-id]");
    if (tr) return T.openTask(tr.dataset.id);
    const hb = ev.target.closest("[data-owner]");
    if (hb && hb.dataset.owner.length > 1) {
      S.filter.owner = hb.dataset.owner;
      S.view = "list";
      T.render();
      const sel = document.getElementById("f-owner");
      if (sel) sel.value = hb.dataset.owner;
    }
  };
}
