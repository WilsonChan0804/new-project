/* List view: the grouped table, as in Lark - a row per task, sub-tasks
 * under an arrow, every cell editable where it stands. */

import { METHOD_OPTS, isMethod } from "./tasks-util.js";
import { esc, avatar, people, fmtDate, fmtWhen, isOverdue, priorityPill, progress, percentBar, pickPeople, pickOne, pickDate, PRIORITIES, PRI_RANK } from "./tasks-util.js";
import { badge } from "./filelinks.js";

/* A group that is a project: straight to its page, sheets and issues dashboard. */
export function groupLinks(b) {
  const g = b.group || {};
  const q = b.project ? "?project=" + encodeURIComponent(b.project) : "";
  return (g.reg ? ` <a class="tl-gl" href="projects.html?p=${encodeURIComponent(g.reg)}" title="The project page">Project</a>` : "")
    + (b.project ? ` <a class="tl-gl" href="index.html${q}" title="Sheets of ${esc(b.project)}">Sheets</a>`
      + ` <a class="tl-gl" href="dashboard.html${q}" title="Issues and tasks of ${esc(b.project)}">Dashboard</a>` : "");
}

export function columns(T) {
  const S = T.S;
  const cols = [
    { k: "priority", name: "Priority", w: 92 }, { k: "owners", name: "Owner", w: 150 },
    { k: "start", name: "Start", w: 90 }, { k: "due", name: "Due", w: 100 },
    { k: "progress", name: "Sub-tasks", w: 112 }, { k: "percent", name: "% complete", w: 112 },
  ];
  for (const f of T.fields()) cols.push({ k: "f:" + f.id, name: f.name, w: f.type === "person" ? 150 : f.type === "check" ? 90 : 120, field: f });
  cols.push({ k: "subscribers", name: "Subscribers", w: 150 }, { k: "creator", name: "Creator", w: 130 },
    { k: "created", name: "Created on", w: 130 }, { k: "completed", name: "Completed on", w: 130 },
    { k: "updated", name: "Updated on", w: 130 }, { k: "links", name: "Links & files", w: 120 });
  const saved = T.colWidths();
  for (const c of cols) if (saved[c.k]) c.w = saved[c.k];
  return cols.filter((c) => !S.hidden.has(c.k));
}

const MIN_COL_W = 60;
const MIN_TITLE_W = 120;

/* The grid's column template: the title column at its dragged width, else as wide as the room
   allows - but never more than 45% of a phone's screen, so the other columns stay in sight */
function template(T, cols) {
  const tw = T.colWidths().title;
  return (tw ? tw + "px" : "minmax(min(320px, 45vw), 1fr)") + " " + cols.map((c) => c.w + "px").join(" ");
}

function cell(T, t, c) {
  if (c.k === "priority") return priorityPill(t.priority);
  if (c.k === "owners") return people(t.owners) || `<span class="muted add">+</span>`;
  if (c.k === "start") return t.start ? esc(fmtDate(t.start)) : `<span class="muted add">&#128197;</span>`;
  if (c.k === "due") return t.due ? `<span class="${isOverdue(t) ? "bad" : ""}">${esc(fmtDate(t.due))}</span>` : `<span class="muted add">&#128197;</span>`;
  if (c.k === "progress") {
    const p = T.progressOf(t.id);
    return p.total ? progress(p.done, p.total) + ` <small class="muted">${p.done}/${p.total}</small>` : `<span class="muted">-</span>`;
  }
  if (c.k === "percent") {
    const pct = T.percentOf(t.id);
    const leaf = !T.children(t.id).length;
    return percentBar(pct, t.percent_at, t.percent_by) + (pct == null ? "" : ` <small class="muted">${pct}%</small>`)
      + (leaf && pct == null ? ` <span class="muted add">+</span>` : "");
  }
  if (c.k === "completed") return t.done && t.completed_at ? `<small>${esc(fmtWhen(t.completed_at))}</small>` : "";
  if (c.k === "subscribers") return people(t.subscribers, 4);
  if (c.k === "creator") return t.created_by ? people([{ uid: t.created_uid, name: t.created_by }]) : "";
  if (c.k === "created") return t.created_at ? `<small>${esc(fmtWhen(t.created_at))}</small>` : "";
  if (c.k === "updated") return t.updated_at ? `<small>${esc(fmtWhen(t.updated_at))}</small>` : "";
  if (c.k === "links") {
    if (!t.links.length) return "";
    const kinds = [...new Set(t.links.map((l) => l.kind))];
    return kinds.slice(0, 4).map((k) => badge(k)).join(" ") + ` <small class="muted">${t.links.length}</small>`;
  }
  if (c.field) {
    const v = t.vals[c.field.id];
    if (c.field.type === "person") return people(v) || `<span class="muted add">+</span>`;
    if (c.field.type === "date") return v ? esc(fmtDate(v)) : "";
    if (c.field.type === "check") return `<span class="cbx${v ? " on" : ""}"></span>`;
    if (c.field.type === "select" && v) return `<span class="sel-pill">${esc(v)}</span>`;
    return esc(v == null ? "" : v);
  }
  return "";
}

function row(T, t, cols, depth) {
  const kids = sortTasks(T, T.children(t.id));
  const open = T.S.expanded.has(t.id);
  const meta = [
    kids.length ? `<span class="tl-m" title="Sub-tasks">&#8627; ${kids.filter((k) => k.done).length}/${kids.length}</span>` : "",
    t.links.length ? `<span class="tl-m" title="Links and files">&#128206; ${t.links.length}</span>` : "",
    t.comment_count ? `<span class="tl-m" title="Comments">&#128172; ${t.comment_count}</span>` : "",
    // its linked issues: how many are still open
    t.issues_total ? (t.issues_open
      ? `<span class="tl-m iss-open" title="Linked issues still open">#${t.issues_open} open</span>`
      : `<span class="tl-m iss-done" title="Its linked issues are all resolved">#&#10003;</span>`) : "",
  ].join("");
  let h = `<div class="tl-row${t.done ? " done" : ""}${T.S.openId === t.id ? " sel" : ""}${depth ? " sub" : ""}" data-id="${esc(t.id)}"`
    + (T.canEdit() ? ` draggable="true"` : "") + `>`
    + `<div class="tl-c tl-title" style="padding-left:${8 + depth * 22}px">`
    + (kids.length ? `<button class="tl-exp ghost${open ? " open" : ""}" data-act="exp">&#9656;</button>` : `<span class="tl-exp"></span>`)
    + `<button class="tick${t.done ? " on" : ""}" data-act="done" title="${t.done ? "Mark not done" : "Mark done"}"></button>`
    + `<span class="tl-t" data-act="open">${esc(t.title || "Untitled task")}</span>${meta}`
    + (T.canEdit() && depth + 1 < T.MAX_DEPTH ? `<button class="ghost tl-addsub" data-act="addsub" title="Add a sub-task">+</button>` : "") + `</div>`
    + cols.map((c) => `<div class="tl-c" data-col="${esc(c.k)}">${cell(T, t, c)}</div>`).join("")
    + `</div>`;
  if (open) {
    for (const k of kids) h += row(T, k, cols, depth + 1);
    if (T.canEdit() && depth + 1 < T.MAX_DEPTH) h += `<div class="tl-row tl-newsub" style="--d:${depth + 1}"><div class="tl-c tl-title" style="padding-left:${8 + (depth + 1) * 22 + 22}px">`
      + `<input class="tl-new" data-parent="${esc(t.id)}" placeholder="+ Add sub-task, Enter"></div></div>`;
  }
  return h;
}

/* Sorting by a column (the header's arrows): ascending, descending, then
   back to the list's own order. Kept in this browser. */
const SORT_KEY = "lwk.tasks.sort";
function sortState() {
  try { return JSON.parse(localStorage.getItem(SORT_KEY) || "null"); } catch (e) { return null; }
}
function setSort(v) {
  try { v ? localStorage.setItem(SORT_KEY, JSON.stringify(v)) : localStorage.removeItem(SORT_KEY); } catch (e) {}
}
// the value a task sorts by in a column (null: empty, always last)
function sortVal(T, t, k) {
  const first = (ps) => (ps && ps[0] ? String(ps[0].name || "").toLowerCase() : null);
  if (k === "title") return String(t.title || "").toLowerCase();
  if (k === "priority") return t.priority ? PRI_RANK[t.priority] || 0 : null;
  if (k === "owners") return first(t.owners);
  if (k === "subscribers") return t.subscribers && t.subscribers.length ? t.subscribers.length : null;
  if (k === "start" || k === "due") return t[k] || null;
  if (k === "progress") { const p = T.progressOf(t.id); return p.total ? p.done / p.total : null; }
  if (k === "percent") return T.percentOf(t.id);
  if (k === "creator") return t.created_by ? String(t.created_by).toLowerCase() : null;
  if (k === "created") return t.created_at || null;
  if (k === "completed") return t.done && t.completed_at ? t.completed_at : null;
  if (k === "updated") return t.updated_at || null;
  if (k === "links") return t.links.length || null;
  if (k.startsWith("f:")) {
    const v = t.vals[k.slice(2)];
    if (v == null || v === "") return null;
    if (Array.isArray(v)) return first(v);
    return typeof v === "number" || typeof v === "boolean" ? Number(v) : String(v).toLowerCase();
  }
  return null;
}
export function sortTasks(T, list) {
  const so = sortState();
  if (!so || !so.k) return list;
  const d = so.dir === "desc" ? -1 : 1;
  return list.map((t, i) => [t, sortVal(T, t, so.k), i]).sort((a, b) => {
    if (a[1] == null || b[1] == null) return a[1] == null && b[1] == null ? a[2] - b[2] : a[1] == null ? 1 : -1;
    return (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] - b[2]) * d;
  }).map((x) => x[0]);
}
function headCell(k, name, cls, resizable) {
  const so = sortState();
  const on = so && so.k === k;
  const arrow = on ? (so.dir === "desc" ? "&#9660;" : "&#9650;") : "&#8661;";
  return `<div class="tl-c tl-sortable${cls ? " " + cls : ""}${on ? " sorted" : ""}" data-sort="${esc(k)}" title="Sort by ${esc(name)}${on ? (so.dir === "desc" ? " (descending - click again for the list's own order)" : " (ascending - click again for descending)") : ""}">`
    + (resizable ? `<b class="tl-grip" data-grip="${esc(k)}" title="Drag to resize"></b>` : "")
    + `${esc(name)} <span class="tl-sort">${arrow}</span></div>`;
}

export function render(T, el) {
  const S = T.S;
  const cols = columns(T);
  const tpl = template(T, cols);
  const buckets = T.buckets(T.visible());
  for (const b of buckets) b.tasks = sortTasks(T, b.tasks);
  let h = `<div class="tl" style="--cols:${tpl}">`
    + `<div class="tl-row tl-head">${headCell("title", "Task title", "tl-title", true)}${cols.map((c) => headCell(c.k, c.name, "", true)).join("")}</div>`;
  for (const b of buckets) {
    if (S.groupBy !== "group" && !b.tasks.length && b.key !== "_") continue;
    const shut = S.collapsed.has(b.key);
    h += `<div class="tl-group" data-b="${esc(b.key)}">`
      + `<div class="tl-gh"><button class="ghost tl-gt" data-act="fold">${shut ? "&#9656;" : "&#9662;"}</button>`
      + `<b>${esc(b.title)}</b> <span class="muted">${b.tasks.length}</span>`
      + groupLinks(b)
      + `</div>`;
    if (!shut) {
      h += b.tasks.map((t) => row(T, t, cols, 0)).join("");
      if (T.canEdit() && (S.groupBy === "group" ? !!b.group : true))
        h += `<div class="tl-row tl-newrow"><div class="tl-c tl-title"><input class="tl-new" data-b="${esc(b.key)}" placeholder="+ New task"></div></div>`;
    }
    h += `</div>`;
  }
  if (!buckets.some((b) => b.tasks.length) && (S.filter.q || S.filter.status !== "all" || S.filter.owner || S.filter.pri))
    h += `<p class="muted" style="padding:14px">No task matches the filters.</p>`;
  h += `</div>`;
  const scroll = el.scrollTop;
  el.innerHTML = h;
  el.scrollTop = scroll;
  wire(T, el, buckets);
  wireResize(T, el, cols);
}

/* Drag a header cell's own grip to resize just that column - every row picks up the new width
   at once, since they all read the same --cols custom property from their shared ancestor. */
function wireResize(T, el, cols) {
  const tl = el.querySelector(".tl");
  if (!tl) return;
  for (const grip of el.querySelectorAll("[data-grip]")) {
    grip.onpointerdown = (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const k = grip.dataset.grip;
      const isTitle = k === "title";
      const c = isTitle ? { k, w: grip.parentElement.getBoundingClientRect().width } : cols.find((x) => x.k === k);
      if (!c) return;
      grip.setPointerCapture(ev.pointerId);
      grip.classList.add("drag");
      const x0 = ev.clientX, w0 = c.w;
      const rest = () => cols.map((x) => x.w + "px").join(" ");
      const move = (e) => {
        c.w = Math.max(isTitle ? MIN_TITLE_W : MIN_COL_W, Math.round(w0 + (e.clientX - x0)));
        const tw = isTitle ? c.w : T.colWidths().title;
        tl.style.setProperty("--cols", (tw ? tw + "px" : "minmax(min(320px, 45vw), 1fr)") + " " + rest());
      };
      const up = () => {
        grip.classList.remove("drag");
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
        T.setColWidth(k, c.w);
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    };
  }
}

function wire(T, el, buckets) {
  const S = T.S;
  const bucketOf = (key) => buckets.find((b) => b.key === key);
  el.onclick = (ev) => {
    if (ev.target.closest("[data-grip]")) return;   // the end of a resize drag, not a sort
    const sh = ev.target.closest(".tl-head [data-sort]");
    if (sh) {
      const k = sh.dataset.sort, so = sortState();
      setSort(!so || so.k !== k ? { k, dir: "asc" } : so.dir === "asc" ? { k, dir: "desc" } : null);
      return render(T, el);
    }
    const act = ev.target.closest("[data-act]");
    const rowEl = ev.target.closest(".tl-row[data-id]");
    const t = rowEl && T.task(rowEl.dataset.id);
    if (act && act.dataset.act === "fold") {
      const k = ev.target.closest(".tl-group").dataset.b;
      S.collapsed.has(k) ? S.collapsed.delete(k) : S.collapsed.add(k);
      T.saveCollapsed();
      return render(T, el);
    }
    if (!t) return;
    if (act && act.dataset.act === "exp") {
      S.expanded.has(t.id) ? S.expanded.delete(t.id) : S.expanded.add(t.id);
      return render(T, el);
    }
    if (act && act.dataset.act === "addsub") {
      S.expanded.add(t.id);
      render(T, el);
      const n = el.querySelector(`.tl-new[data-parent="${CSS.escape(t.id)}"]`);
      if (n) n.focus();
      return;
    }
    if (act && act.dataset.act === "done") return T.toggleDone(t);
    const c = ev.target.closest("[data-col]");
    if (!c || !T.canEdit()) return T.openTask(t.id);
    const k = c.dataset.col;
    if (k === "priority") return pickOne(c, PRIORITIES, t.priority, (v) => T.save(t.id, { priority: v }));
    if (k === "owners") return pickPeople(c, t.owners, T.members(), (v) => T.save(t.id, { owners: v }), T.people());
    if (k === "start" || k === "due") return pickDate(c, t[k], (v) => T.save(t.id, { [k]: v }));
    if (k === "percent") {
      if (T.children(t.id).length) return;   // an aggregate of its sub-tasks, not typed in here
      const v = prompt("Percent complete (0-100)", t.percent == null ? "" : t.percent);
      if (v === null) return;
      if (v.trim() === "") return T.save(t.id, { percent: null });
      const n = Number(v);
      if (!isNaN(n)) T.save(t.id, { percent: Math.max(0, Math.min(100, Math.round(n))) });
      return;
    }
    if (k.startsWith("f:")) {
      const f = T.S.fields.get(k.slice(2));
      const set = (v) => T.save(t.id, { vals: { [f.id]: v } });
      if (f.type === "person") return pickPeople(c, t.vals[f.id] || [], T.members(), set, T.people());
      if (isMethod(f)) return pickOne(c, METHOD_OPTS, t.vals[f.id] || "OR", set);
      if (f.type === "select") return pickOne(c, [""].concat(f.options), t.vals[f.id] || "", set);
      if (f.type === "date") return pickDate(c, t.vals[f.id], set);
      if (f.type === "check") return set(!t.vals[f.id]);
      const v = prompt(f.name, t.vals[f.id] == null ? "" : t.vals[f.id]);
      if (v !== null) set(v);
      return;
    }
    T.openTask(t.id);
  };
  el.onkeydown = (ev) => {
    const inp = ev.target.closest(".tl-new");
    if (!inp || ev.key !== "Enter" || !inp.value.trim()) return;
    const fields = { title: inp.value.trim() };
    if (inp.dataset.parent) {
      const par = T.task(inp.dataset.parent);
      fields.parent_id = par.id;
      fields.group_id = par.group_id;
    } else {
      const b = bucketOf(inp.dataset.b);
      if (b && b.group) fields.group_id = b.group.id;
      if (b && b.priority !== undefined) fields.priority = b.priority;
      if (b && b.person) fields.owners = [b.person];
      if (b && b.done !== undefined) fields.done = b.done;
    }
    T.create(fields);
    // keep typing the next one
    const sel = inp.dataset.parent ? `.tl-new[data-parent="${inp.dataset.parent}"]` : `.tl-new[data-b="${inp.dataset.b}"]`;
    setTimeout(() => { const n = el.querySelector(sel); if (n) n.focus(); }, 0);
  };

  /* drag a row onto another row (goes before it) or onto a group */
  let dragId = null;
  el.ondragstart = (ev) => {
    const r = ev.target.closest(".tl-row[data-id]");
    if (!r) return;
    dragId = r.dataset.id;
    T.S.dragging = true;
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", dragId);
    r.classList.add("dragging");
  };
  el.ondragend = () => { dragId = null; T.S.dragging = false; for (const x of el.querySelectorAll(".drop-before, .drop-in, .drop-nest, .dragging")) x.classList.remove("drop-before", "drop-in", "drop-nest", "dragging"); };
  /* dropped on the right half of a task's title: it becomes that task's
     sub-task (as in Lark), unless that makes a loop or goes too deep */
  const nestTarget = (ev, r) => {
    if (!r || r.dataset.id === dragId) return null;
    const cell = ev.target.closest(".tl-title");
    if (!cell) return null;
    const box = cell.getBoundingClientRect();
    if (ev.clientX < box.left + box.width * 0.45) return null;
    const par = T.task(r.dataset.id), t = T.task(dragId);
    if (!par || !t || par.id === t.parent_id) return null;
    if (T.descendants(t.id).some((k) => k.id === par.id)) return null;
    const below = (id) => Math.max(0, ...T.children(id).map((k) => 1 + below(k.id)));
    if (T.depth(par.id) + 1 + below(t.id) >= T.MAX_DEPTH) return null;
    return par;
  };
  el.ondragover = (ev) => {
    if (!dragId) return;
    const g = ev.target.closest(".tl-group");
    if (!g) return;
    ev.preventDefault();
    for (const x of el.querySelectorAll(".drop-before, .drop-in, .drop-nest")) x.classList.remove("drop-before", "drop-in", "drop-nest");
    const r = ev.target.closest(".tl-row[data-id]");
    if (nestTarget(ev, r)) r.classList.add("drop-nest");
    else if (r && !r.classList.contains("sub") && r.dataset.id !== dragId) r.classList.add("drop-before");
    else g.classList.add("drop-in");
  };
  el.ondrop = (ev) => {
    if (!dragId) return;
    ev.preventDefault();
    const g = ev.target.closest(".tl-group");
    const r = ev.target.closest(".tl-row[data-id]");
    const t = T.task(dragId);
    const b = g && bucketOf(g.dataset.b);
    if (!t || !b) return;
    const par = nestTarget(ev, r);
    if (par) {
      const last = T.children(par.id).reduce((m, k) => Math.max(m, k.sort), 0);
      T.S.expanded.add(par.id);
      return T.save(t.id, { parent_id: par.id, group_id: par.group_id, sort: last + 1 });
    }
    if (t.parent_id) T.save(t.id, { parent_id: "" });      // a sub-task dragged out becomes a task
    T.dropInto(t, b, r && !r.classList.contains("sub") && r.dataset.id !== dragId ? r.dataset.id : null);
  };
}
