/* List view: the grouped table, as in Lark - a row per task, sub-tasks
 * under an arrow, every cell editable where it stands. */

import { esc, avatar, people, fmtDate, fmtWhen, isOverdue, priorityPill, progress, pickPeople, pickOne, pickDate, PRIORITIES } from "./tasks-util.js";
import { badge } from "./filelinks.js";

export function columns(T) {
  const S = T.S;
  const cols = [
    { k: "priority", name: "Priority", w: 92 }, { k: "owners", name: "Owner", w: 150 },
    { k: "start", name: "Start", w: 90 }, { k: "due", name: "Due", w: 100 },
    { k: "progress", name: "Sub-tasks", w: 112 },
  ];
  for (const f of T.fields()) cols.push({ k: "f:" + f.id, name: f.name, w: f.type === "person" ? 150 : f.type === "check" ? 90 : 120, field: f });
  cols.push({ k: "subscribers", name: "Subscribers", w: 150 }, { k: "creator", name: "Creator", w: 130 },
    { k: "created", name: "Created on", w: 130 }, { k: "completed", name: "Completed on", w: 130 },
    { k: "updated", name: "Updated on", w: 130 }, { k: "links", name: "Links & files", w: 120 });
  return cols.filter((c) => !S.hidden.has(c.k));
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
  const kids = T.children(t.id);
  const open = T.S.expanded.has(t.id);
  const meta = [
    kids.length ? `<span class="tl-m" title="Sub-tasks">&#8627; ${kids.filter((k) => k.done).length}/${kids.length}</span>` : "",
    t.links.length ? `<span class="tl-m" title="Links and files">&#128206; ${t.links.length}</span>` : "",
    t.comment_count ? `<span class="tl-m" title="Comments">&#128172; ${t.comment_count}</span>` : "",
  ].join("");
  let h = `<div class="tl-row${t.done ? " done" : ""}${T.S.openId === t.id ? " sel" : ""}${depth ? " sub" : ""}" data-id="${esc(t.id)}"`
    + (T.canEdit() ? ` draggable="true"` : "") + `>`
    + `<div class="tl-c tl-title" style="padding-left:${8 + depth * 22}px">`
    + (kids.length ? `<button class="tl-exp ghost${open ? " open" : ""}" data-act="exp">&#9656;</button>` : `<span class="tl-exp"></span>`)
    + `<button class="tick${t.done ? " on" : ""}" data-act="done" title="${t.done ? "Mark not done" : "Mark done"}"></button>`
    + `<span class="tl-t" data-act="open">${esc(t.title || "Untitled task")}</span>${meta}</div>`
    + cols.map((c) => `<div class="tl-c" data-col="${esc(c.k)}">${cell(T, t, c)}</div>`).join("")
    + `</div>`;
  if (open) {
    for (const k of kids) h += row(T, k, cols, depth + 1);
    if (T.canEdit()) h += `<div class="tl-row tl-newsub" style="--d:${depth + 1}"><div class="tl-c tl-title" style="padding-left:${8 + (depth + 1) * 22 + 22}px">`
      + `<input class="tl-new" data-parent="${esc(t.id)}" placeholder="+ Add sub-task, Enter"></div></div>`;
  }
  return h;
}

export function render(T, el) {
  const S = T.S;
  const cols = columns(T);
  const tpl = `minmax(320px, 1fr) ` + cols.map((c) => c.w + "px").join(" ");
  const buckets = T.buckets(T.visible());
  let h = `<div class="tl" style="--cols:${tpl}">`
    + `<div class="tl-row tl-head"><div class="tl-c tl-title">Task title</div>${cols.map((c) => `<div class="tl-c">${esc(c.name)}</div>`).join("")}</div>`;
  for (const b of buckets) {
    if (S.groupBy !== "group" && !b.tasks.length && b.key !== "_") continue;
    const shut = S.collapsed.has(b.key);
    h += `<div class="tl-group" data-b="${esc(b.key)}">`
      + `<div class="tl-gh"><button class="ghost tl-gt" data-act="fold">${shut ? "&#9656;" : "&#9662;"}</button>`
      + `<b>${esc(b.title)}</b> <span class="muted">${b.tasks.length}</span>`
      + (b.project ? ` <a class="tl-proj" href="index.html?project=${encodeURIComponent(b.project)}" title="Open this project's sheets">${badge("sheet")} ${esc(b.project)}</a>` : "")
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
}

function wire(T, el, buckets) {
  const S = T.S;
  const bucketOf = (key) => buckets.find((b) => b.key === key);
  el.onclick = (ev) => {
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
    if (act && act.dataset.act === "done") return T.save(t.id, { done: !t.done });
    const c = ev.target.closest("[data-col]");
    if (!c || !T.canEdit()) return T.openTask(t.id);
    const k = c.dataset.col;
    if (k === "priority") return pickOne(c, PRIORITIES, t.priority, (v) => T.save(t.id, { priority: v }));
    if (k === "owners") return pickPeople(c, t.owners, T.people(), (v) => T.save(t.id, { owners: v }));
    if (k === "start" || k === "due") return pickDate(c, t[k], (v) => T.save(t.id, { [k]: v }));
    if (k.startsWith("f:")) {
      const f = T.S.fields.get(k.slice(2));
      const set = (v) => T.save(t.id, { vals: { [f.id]: v } });
      if (f.type === "person") return pickPeople(c, t.vals[f.id] || [], T.people(), set);
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
  el.ondragend = () => { dragId = null; T.S.dragging = false; for (const x of el.querySelectorAll(".drop-before, .drop-in, .dragging")) x.classList.remove("drop-before", "drop-in", "dragging"); };
  el.ondragover = (ev) => {
    if (!dragId) return;
    const g = ev.target.closest(".tl-group");
    if (!g) return;
    ev.preventDefault();
    for (const x of el.querySelectorAll(".drop-before, .drop-in")) x.classList.remove("drop-before", "drop-in");
    const r = ev.target.closest(".tl-row[data-id]");
    if (r && !r.classList.contains("sub") && r.dataset.id !== dragId) r.classList.add("drop-before");
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
    if (t.parent_id) T.save(t.id, { parent_id: "" });      // a sub-task dragged out becomes a task
    T.dropInto(t, b, r && !r.classList.contains("sub") && r.dataset.id !== dragId ? r.dataset.id : null);
  };
}
