/* People: the organisation (the accounts on this server), by team or
 * office, with what each person holds across every task list you can see. */

import { esc, avatar, isOverdue, fmtDate, skeleton } from "./tasks-util.js";

export async function render(T, el) {
  const S = T.S;
  const P = S.peopleView || (S.peopleView = { by: "team", q: "", sel: null });
  if (!S.accounts) {
    el.innerHTML = `<div class="t-empty"><h3>People needs accounts</h3><p>This server runs with a shared passphrase, so it has no list of people. A site admin can switch accounts on (see the Admin page).</p></div>`;
    return;
  }
  if (!S.allTasks) {
    el.innerHTML = skeleton(6);
    try { S.allTasks = (await T.api("/api/tasks-mine?view=all")).tasks; } catch (e) { S.allTasks = []; }
    setTimeout(() => { S.allTasks = null; }, 60000);   // fresh again next time after a minute
  }
  const load = new Map();
  for (const t of S.allTasks) for (const p of t.owners) {
    if (p.uid == null) continue;
    const r = load.get(p.uid) || { open: 0, over: 0, done: 0, tasks: [] };
    t.done ? r.done++ : r.open++;
    if (isOverdue(t)) r.over++;
    r.tasks.push(t);
    load.set(p.uid, r);
  }
  const q = P.q.trim().toLowerCase();
  const ppl = T.people().filter((p) => !q || [p.name, p.email, p.team, p.office, p.company, p.discipline].join(" ").toLowerCase().includes(q));
  const groups = new Map();
  for (const p of ppl) {
    const k = p[P.by] || "(not set)";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === "(not set)") - (b === "(not set)") || a.localeCompare(b));
  const sel = P.sel != null ? T.people().find((p) => p.uid === P.sel) : null;
  const selLoad = sel && load.get(sel.uid);

  el.innerHTML = `<div class="tp">
    <div class="tp-main">
      <div class="tp-bar"><input id="tp-q" type="search" placeholder="Search name, email, team, office" value="${esc(P.q)}">
        <label class="tb-l">Group by <select id="tp-by">${[["team", "Team"], ["office", "Office"], ["company", "Company"], ["discipline", "Discipline"]].map(([v, n]) =>
          `<option value="${v}"${v === P.by ? " selected" : ""}>${n}</option>`).join("")}</select></label>
        <span class="muted">${ppl.length} people</span></div>
      ${keys.map((k) => `<h4 class="tp-h">${esc(k)} <span class="muted">${groups.get(k).length}</span></h4>`
        + groups.get(k).map((p) => {
          const l = load.get(p.uid) || { open: 0, over: 0, done: 0 };
          return `<div class="tp-row${P.sel === p.uid ? " sel" : ""}" data-uid="${p.uid}">${avatar(p, 34)}`
            + `<div class="tp-n"><b>${esc(p.name)}</b><small class="muted">${esc([p.discipline, p.office, p.company].filter(Boolean).join(" · "))}</small></div>`
            + `<a class="tp-mail" href="mailto:${esc(p.email)}" title="Email">${esc(p.email)}</a>`
            + `<div class="tp-load" title="Open / overdue / done tasks"><span>${l.open} open</span>`
            + (l.over ? `<span class="bad">${l.over} overdue</span>` : "") + `<span class="muted">${l.done} done</span></div></div>`;
        }).join("")).join("") || `<p class="muted">Nobody matches.</p>`}
    </div>
    ${sel ? `<aside class="tp-side"><div class="tp-who">${avatar(sel, 48)}<div><b>${esc(sel.name)}</b><br><small class="muted">${esc([sel.team, sel.office].filter(Boolean).join(" · "))}</small><br><a href="mailto:${esc(sel.email)}">${esc(sel.email)}</a></div></div>
      <h4>Open tasks</h4>${(selLoad ? selLoad.tasks.filter((t) => !t.done).sort((a, b) => (a.due || "9").localeCompare(b.due || "9")) : []).map((t) =>
        `<div class="tp-task" data-list="${esc(t.list_id)}" data-id="${esc(t.id)}"><span>${esc(t.title || "Untitled")}</span><small class="muted">${esc(t.list_title)} / ${esc(t.group_title)}</small>`
        + (t.due ? `<small class="${isOverdue(t) ? "bad" : "muted"}">due ${esc(fmtDate(t.due))}</small>` : "") + `</div>`).join("") || `<p class="muted">None in the lists you can see.</p>`}
    </aside>` : ""}
  </div>`;
  const qi = el.querySelector("#tp-q");
  qi.oninput = () => { P.q = qi.value; render(T, el).then(() => { const n = el.querySelector("#tp-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); };
  el.querySelector("#tp-by").onchange = (ev) => { P.by = ev.target.value; render(T, el); };
  el.onclick = async (ev) => {
    const task = ev.target.closest(".tp-task");
    if (task) {
      return T.openListTask(task.dataset.list, task.dataset.id);
    }
    const r = ev.target.closest(".tp-row");
    if (r && !ev.target.closest("a")) { P.sel = Number(r.dataset.uid); render(T, el); }
  };
}
