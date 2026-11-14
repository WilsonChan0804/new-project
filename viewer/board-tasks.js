/* Mind map nodes as tasks, as in Xmind - linked both ways.
 *
 * A map (its root node) is tied to one task list (root.tlist). Any node, a
 * branch or the whole map can become tasks: a branch becomes a task with
 * its children as sub-tasks. The node keeps the task's id (node.task) and
 * shows its priority, progress, due date and who it is for; a panel on the
 * node sets them. Changes go to the Tasks page at once, and changes made
 * there (or by anyone) arrive here within a poll: done, progress, dates,
 * people - and a new title becomes the node's text. A task deleted there
 * leaves the node as a plain node.
 */

import { childrenOf } from "./board-mind.js";
import { esc, uid } from "./board-util.js";

const PRI = { Urgent: ["P1", "#dc2626"], High: ["P2", "#ea580c"], Medium: ["P3", "#2563eb"], Low: ["P4", "#6b7280"] };
const POLL_MS = 20000;
const MAX_DEPTH = 5;

export function initTasks(app) {
  const { A, O, get, begin, rec, commit, invalidate, toast, pop, closePop, api, project, X } = app;
  const tasks = new Map();         // task id -> task, for the lists this board's maps use
  const revs = new Map();          // list id -> last rev seen
  const known = new Map();         // task id -> title last seen (to tell a rename on the Tasks page)
  const failed = new Set();        // lists this person cannot read
  let timer = null, busy = false;

  const rootOf = (id) => (A.F && A.F.rootOf && A.F.rootOf.get(id)) || id;
  const listOf = (node) => { const r = get(rootOf(node.id)); return r && r.tlist; };
  const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const boardLink = (n) => ({
    kind: "board", project: project(), ref: (A.board ? A.board.id : "") + ":" + n.id,
    url: "board.html?project=" + encodeURIComponent(project()) + "&board=" + encodeURIComponent(A.board ? A.board.id : "") + "&focus=" + encodeURIComponent(n.id),
    title: (A.board ? A.board.title + " › " : "") + String(n.text || "").slice(0, 120),
  });

  /* ---------------------------------------------------- the markers on a node */
  X.nodeTask = (el, o) => {
    let m = el.querySelector(":scope > .nd-task");
    const t = o.task && tasks.get(o.task);
    el.classList.toggle("tdone", !!(t && t.done));
    el.classList.toggle("has-task", !!o.task);
    if (!o.task) { if (m) m.remove(); return; }
    if (!m) { m = document.createElement("span"); m.className = "nd-task"; el.appendChild(m); }
    if (!t) { m.innerHTML = ""; return; }
    const parts = [];
    if (t.done) parts.push(`<i class="nt-done" title="Done">✔</i>`);
    const p = PRI[t.priority];
    if (p) parts.push(`<i class="nt-pri" style="background:${p[1]}" title="Priority: ${esc(t.priority)}">${p[0]}</i>`);
    const pct = t.done ? 100 : Number(t.percent) || 0;
    if (t.percent != null || t.done) {
      const a = (pct / 100) * Math.PI * 2, x = 7 + 6 * Math.sin(a), y = 7 - 6 * Math.cos(a);
      const arc = pct >= 100 ? `<circle cx="7" cy="7" r="6" fill="#16a34a"/>` : pct > 0 ? `<path d="M7 7V1A6 6 0 ${pct > 50 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z" fill="#16a34a"/>` : "";
      parts.push(`<svg class="nt-pie" width="14" height="14" viewBox="0 0 14 14" aria-label="${pct}% complete"><title>${pct}% complete</title><circle cx="7" cy="7" r="6" fill="#fff" stroke="#16a34a" stroke-width="1.4"/>${arc}</svg>`);
    }
    if (t.due) {
      const late = !t.done && t.due.slice(0, 10) < today();
      const d = new Date(t.due.slice(0, 10) + "T00:00:00");
      parts.push(`<i class="nt-due${late ? " late" : ""}" title="Due ${esc(t.due.slice(0, 10))}${late ? " - late" : ""}">${d.getDate()} ${d.toLocaleString("en", { month: "short" })}</i>`);
    }
    for (const w of (t.owners || []).slice(0, 2)) {
      const ini = String(w.name || "?").split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
      parts.push(`<i class="nt-who" title="${esc(w.name || "")}">${esc(ini)}</i>`);
    }
    m.innerHTML = parts.join("");
  };

  /* -------------------------------------------------------- the list a map uses */
  async function pickList(root) {
    if (root.tlist) return root.tlist;
    let r;
    try { r = await api("/api/task-lists"); } catch (e) { toast("Could not read the task lists: " + e.message); return null; }
    const mine = (r.lists || []).filter((l) => l.role === "editor" || l.role === "owner");
    return new Promise((resolve) => {
      const anchor = document.querySelector('#bd-ctx [data-act="task"]') || document.querySelector("#bd-ctx");
      pop(anchor, `<h4>Which task list should this map's tasks go to?</h4><div class="menu tl-pick">`
        + mine.map((l) => `<button type="button" data-v="${esc(l.id)}">${esc(l.title)}<small>${l.counts ? l.counts.total + " tasks" : ""}</small></button>`).join("")
        + `<button type="button" data-v="+new"><b>+ A new list: “${esc(String(root.text || "Map").slice(0, 60))}”</b></button></div>`,
      async (e) => {
        const b = e.target.closest("[data-v]");
        if (!b) return;
        closePop();
        let lid = b.dataset.v;
        if (lid === "+new") {
          try { lid = (await api("/api/task-lists", { method: "POST", body: JSON.stringify({ title: String(root.text || "Map").slice(0, 120) }) })).id; }
          catch (err) { toast("Could not make the list: " + err.message); resolve(null); return; }
        }
        const tx = begin();
        rec(tx, root.id);
        root.tlist = lid;
        commit(tx);
        resolve(lid);
      });
    });
  }

  /* ----------------------------------------------------------- make tasks */
  async function makeTasks(id, branch) {
    const n0 = get(id);
    if (!n0 || !A.board) return;
    const root = get(rootOf(id));
    const lid = await pickList(root);
    if (!lid) return;
    const F = A.F, patches = [], made = new Map();
    // how deep a node's task sits: sub-tasks go 5 levels at most
    const depthOf = (n) => { let d = 0, p = F.parentOf.get(n.id); while (p) { const pn = get(p); if (pn && (pn.task || made.has(p))) d++; p = F.parentOf.get(p); } return d; };
    const parentTask = (n) => {
      let p = F.parentOf.get(n.id);
      while (p) { const pn = get(p); const t = made.get(p) || (pn && pn.task && listOf(pn) === lid ? pn.task : null); if (t) return t; p = F.parentOf.get(p); }
      return "";
    };
    const walk = (n) => {
      if (!n.task) {
        const tid = uid("t");
        made.set(n.id, tid);
        let par = parentTask(n);
        if (par && depthOf(n) >= MAX_DEPTH) par = "";
        patches.push({ id: tid, title: String(n.text || "Untitled").slice(0, 300), parent_id: par, links: [boardLink(n)] });
      }
      if (branch) for (const k of childrenOf(F, n.id)) walk(k);
    };
    walk(n0);
    if (!patches.length) { toast("Those are tasks already."); return; }
    try { await api("/api/tasks", { method: "POST", body: JSON.stringify({ list: lid, tasks: patches }) }); }
    catch (e) { toast("Could not make the tasks: " + e.message); return; }
    const tx = begin();
    for (const [nid, tid] of made) { const n = get(nid); if (!n) continue; rec(tx, nid); n.task = tid; }
    commit(tx);
    invalidate([...made.keys()]);
    toast(patches.length === 1 ? "Made a task in the list" : `Made ${patches.length} tasks (a branch is a task with sub-tasks)`);
    poll(true);
  }

  /* ------------------------------------------------------ the task panel */
  async function patch(node, fields) {
    const lid = listOf(node);
    if (!lid || !node.task) return;
    for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];
    const t = tasks.get(node.task);
    if (t) Object.assign(t, fields);
    invalidate([node.id]);
    try { await api("/api/tasks", { method: "POST", body: JSON.stringify({ list: lid, tasks: [Object.assign({ id: node.task }, fields)] }) }); }
    catch (e) { toast("Could not change the task: " + e.message); }
  }
  function panel(btn, node) {
    const t = tasks.get(node.task) || { title: node.text };
    const days = (a, b) => (a && b ? Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 864e5) + 1 : "");
    const pct = t.done ? 100 : t.percent == null ? "" : t.percent;
    pop(btn, `<div class="tk-pan"><h4>Task</h4>
      <label class="tk-row"><span>Done</span><input type="checkbox" data-f="done"${t.done ? " checked" : ""}></label>
      <label class="tk-row"><span>Progress</span><select data-f="percent">${["", 0, 25, 50, 75, 100].map((v) => `<option value="${v}"${String(pct) === String(v) ? " selected" : ""}>${v === "" ? "-" : v + "%"}</option>`).join("")}</select></label>
      <label class="tk-row"><span>Priority</span><select data-f="priority">${["", "Urgent", "High", "Medium", "Low"].map((v) => `<option value="${v}"${(t.priority || "") === v ? " selected" : ""}>${v ? (PRI[v][0] + " " + v) : "-"}</option>`).join("")}</select></label>
      <label class="tk-row"><span>Start</span><input type="date" data-f="start" value="${esc((t.start || "").slice(0, 10))}"></label>
      <label class="tk-row"><span>Duration</span><input type="number" min="1" max="999" data-f="dur" value="${days(t.start, t.due)}" placeholder="days"></label>
      <label class="tk-row"><span>Due</span><input type="date" data-f="due" value="${esc((t.due || "").slice(0, 10))}"></label>
      <label class="tk-row"><span>Assignee</span><input type="text" class="ck-assign" data-f="owner" value="${esc(((t.owners || [])[0] || {}).name || "")}" placeholder="Name or email" autocomplete="off"></label>
      <div class="tk-acts"><a class="tk-open" href="tasks.html?list=${encodeURIComponent(listOf(node) || "")}&task=${encodeURIComponent(node.task)}">Open in Tasks</a><span class="spacer"></span><button type="button" data-f="unlink">Unlink</button></div></div>`, null);
    const box = document.querySelector("#bd-pop .tk-pan");
    if (!box) return;
    const val = (f) => box.querySelector(`[data-f="${f}"]`);
    box.addEventListener("change", (e) => {
      const f = e.target.dataset.f;
      if (!f) return;
      const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      if (f === "done") patch(node, { done: v });
      else if (f === "percent") patch(node, { percent: v === "" ? null : Number(v), done: Number(v) === 100 ? true : (tasks.get(node.task) || {}).done && Number(v) < 100 ? false : undefined });
      else if (f === "priority") patch(node, { priority: v });
      else if (f === "start" || f === "due") {
        patch(node, { [f]: v });
        const s = val("start").value, d = val("due").value;
        val("dur").value = s && d ? days(s, d) : "";
      } else if (f === "dur") {
        const s = val("start").value || today(), n = Math.max(1, Number(v) || 1);
        const due = new Date(Date.parse(s) + (n - 1) * 864e5).toISOString().slice(0, 10);
        val("start").value = s; val("due").value = due;
        patch(node, { start: s, due });
      } else if (f === "owner") patch(node, { owners: v.trim() ? [{ name: v.trim() }] : [] });
    });
    box.addEventListener("click", (e) => {
      if (e.target.dataset.f !== "unlink") return;
      const tx = begin(); rec(tx, node.id); delete node.task; commit(tx);
      invalidate([node.id]); closePop();
      toast("The node is no longer linked (the task stays in its list)");
    });
  }

  /* the bar's task button: the panel when it is a task, else what to make */
  X.taskButton = (btn, node) => {
    if (node.task) return panel(btn, node);
    const isRoot = rootOf(node.id) === node.id, kids = childrenOf(A.F, node.id).length;
    pop(btn, `<div class="menu">`
      + `<button type="button" data-v="one">Make a task of this</button>`
      + (kids ? `<button type="button" data-v="branch">${isRoot ? "Make tasks of the whole map" : "Make tasks of this branch"}<small>its topics become sub-tasks</small></button>` : "")
      + `</div>`, (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      closePop();
      makeTasks(node.id, b.dataset.v === "branch");
    });
  };

  /* a node's text edited here: the task takes the new title */
  X.nodeTextChanged = (node) => {
    const t = node.task && tasks.get(node.task);
    const title = String(node.text || "").slice(0, 300);
    if (!t || t.title === title) return;
    known.set(node.task, title);
    patch(node, { title });
  };

  /* -------------------------------------------------------------- the poll */
  async function poll(now) {
    if (busy || !A.board) return;
    busy = true;
    try {
      const lists = new Set();
      for (const o of O().values()) if (o.t === "node" && o.tlist) lists.add(o.tlist);
      for (const lid of lists) {
        if (failed.has(lid) && !now) continue;
        let r;
        try { r = await api("/api/tasks?list=" + encodeURIComponent(lid) + "&since=" + (revs.get(lid) || 0)); failed.delete(lid); }
        catch (e) { failed.add(lid); continue; }
        const full = !revs.get(lid);
        revs.set(lid, r.rev);
        const seen = new Set();
        for (const t of r.tasks || []) { seen.add(t.id); if (t.deleted) tasks.delete(t.id); else tasks.set(t.id, t); }
        // the nodes of the maps on this list
        const gone = [], renamed = [], touched = [];
        for (const o of O().values()) {
          if (o.t !== "node" || !o.task || listOf(o) !== lid) continue;
          const t = tasks.get(o.task);
          if (!t && (full || seen.has(o.task))) { gone.push(o); continue; }
          if (!t) continue;
          touched.push(o.id);
          const before = known.get(o.task);
          if (before !== undefined && before !== t.title && t.title && t.title !== o.text && !(A.edit && A.edit.id === o.id)) renamed.push([o, t.title]);
          known.set(o.task, t.title);
        }
        if (gone.length || renamed.length) {
          const tx = begin();
          for (const o of gone) { rec(tx, o.id); delete o.task; touched.push(o.id); }
          for (const [o, title] of renamed) { rec(tx, o.id); o.text = title; touched.push(o.id); }
          commit(tx);
        }
        if (touched.length) invalidate(touched);
      }
    } finally { busy = false; }
  }
  X.tasksBoardOpened = () => {
    tasks.clear(); revs.clear(); known.clear(); failed.clear();
    clearInterval(timer);
    poll(true);
    timer = setInterval(() => { if (!document.hidden) poll(false); }, POLL_MS);
  };
  addEventListener("focus", () => poll(false));
  X.tasksPoll = poll;
}
