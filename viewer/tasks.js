/* Tasks - the team's task lists (what Lark did), inside the viewer.
 *
 * A list belongs to a team (LWK-MANILA); its groups are usually the jobs
 * (SKW, Kai Tak 2A3 ...) and each group may name the viewer project it is
 * about. A task then links straight to that project's issues, sheets and
 * 3D views, and to the drawings and models kept in OneDrive and ACC.
 *
 * This file holds the state, the sync with the server and the frame of the
 * page (side bar, tabs, tool bar). Each view draws itself from the state:
 * tasks-list.js, tasks-kanban.js, tasks-gantt.js, tasks-dash.js,
 * tasks-people.js; the side panel is tasks-detail.js.
 *
 * Saving: a change is applied on the page at once and the changed fields
 * (only those) are sent shortly after; the server merges them field by
 * field, so two people editing one task rarely collide.
 */

import { api, project } from "./nav.js";
import { $, $$, esc, uid, today, isOverdue, PRI_RANK, avatar, modal, toast, pop, closePop, ago, fmtWhen } from "./tasks-util.js";
import { makeLink } from "./filelinks.js";
import * as ListView from "./tasks-list.js";
import * as KanbanView from "./tasks-kanban.js";
import * as GanttView from "./tasks-gantt.js";
import * as DashView from "./tasks-dash.js";
import * as PeopleView from "./tasks-people.js";
import * as Detail from "./tasks-detail.js";
import * as Undo from "./undo.js";

const LS = "lwk-tasks:";
const ls = {
  get(k, d) { try { const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} },
};

const S = {
  me: null, accounts: false, siteAdmin: false,
  people: [], lists: [],
  listId: "", list: null, role: "", groups: new Map(), fields: new Map(), tasks: new Map(), rev: 0,
  mode: "list",               // list | quick | people | activity
  quick: "owned", quickTasks: [],
  view: ls.get("view", "list"),
  filter: { q: "", status: "all", owner: "", pri: "" },
  sort: "custom", groupBy: "group",
  collapsed: new Set(), expanded: new Set(), hidden: new Set(),
  openId: "",
};
const pending = new Map();    // task id -> fields waiting to be sent
let flushTimer = null, saving = false;

/* ------------------------------------------------------------ the API views use */

export const T = {
  S, api,
  get me() { return S.me; },
  canEdit: () => S.role === "owner" || S.role === "editor",
  isOwner: () => S.role === "owner",
  people: () => S.people,
  groups: () => [...S.groups.values()].sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title)),
  fields: () => [...S.fields.values()].sort((a, b) => a.sort - b.sort),
  task: (id) => S.tasks.get(id),
  children: (id) => [...S.tasks.values()].filter((t) => t.parent_id === id).sort((a, b) => a.sort - b.sort),
  /* every sub-task below a task, at any level, in list order */
  descendants(id) {
    const out = [];
    const walk = (pid) => { for (const k of T.children(pid)) { out.push(k); walk(k.id); } };
    walk(id);
    return out;
  },
  /* 0 for a top task, 1 for its sub-task and so on */
  depth(id) {
    let n = 0, t = S.tasks.get(id);
    while (t && t.parent_id && n < 20) { t = S.tasks.get(t.parent_id); n++; }
    return n;
  },
  MAX_DEPTH: 5,
  progressOf(id) {
    const k = T.children(id);
    return { done: k.filter((t) => t.done).length, total: k.length };
  },
  everyOwner() {
    const m = new Map();
    for (const t of S.tasks.values()) for (const p of t.owners) m.set(p.uid != null ? "u" + p.uid : "n" + p.name, p);
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  },
  isMine(t) {
    const me = S.me || {};
    return (t.owners || []).some((p) => (me.uid != null && p.uid === me.uid)
      || (me.uid == null && me.name && p.name.toLowerCase() === me.name.toLowerCase()));
  },
  /* the top-level tasks the filters let through */
  visible() {
    const f = S.filter, q = f.q.trim().toLowerCase();
    const okOne = (t) => {
      if (f.status === "open" && t.done) return false;
      if (f.status === "done" && !t.done) return false;
      if (f.status === "overdue" && !isOverdue(t)) return false;
      if (f.status === "mine" && !T.isMine(t)) return false;
      if (f.owner && !t.owners.some((p) => ownerKey(p) === f.owner)) return false;
      if (f.pri && t.priority !== f.pri) return false;
      if (q && !(t.title.toLowerCase().includes(q) || String(t.number) === q.replace("#", "")
        || t.description.toLowerCase().includes(q))) return false;
      return true;
    };
    const tops = [...S.tasks.values()].filter((t) => !t.parent_id);
    // a parent shows when one of its sub-tasks matches too
    return tops.filter((t) => okOne(t) || ((q || f.owner) && T.descendants(t.id).some(okOne))).sort(sorter());
  },
  /* tasks bucketed by the "Group by" choice: [{key, title, project, tasks}] */
  buckets(tasks) {
    const by = S.groupBy;
    const out = new Map();
    const add = (key, title, t, extra) => {
      if (!out.has(key)) out.set(key, Object.assign({ key, title, tasks: [] }, extra || {}));
      if (t) out.get(key).tasks.push(t);
    };
    if (by === "group") {
      for (const g of T.groups()) add(g.id, g.title, null, { group: g, project: g.project });
      for (const t of tasks) add(t.group_id || "_", S.groups.get(t.group_id) ? S.groups.get(t.group_id).title : "No group", t);
    } else if (by === "owner") {
      for (const t of tasks) {
        if (!t.owners.length) add("_", "No owner", t);
        for (const p of t.owners) add(ownerKey(p), p.name, t, { person: p });
      }
    } else if (by === "priority") {
      for (const p of ["Urgent", "High", "Medium", "Low", ""]) add(p || "_", p || "No priority", null, { priority: p });
      for (const t of tasks) add(t.priority || "_", t.priority || "No priority", t);
    } else if (by === "status") {
      add("open", "Not done", null, { done: false });
      add("done", "Done", null, { done: true });
      for (const t of tasks) add(t.done ? "done" : "open", t.done ? "Done" : "Not done", t);
    } else {
      const d0 = today();
      const week = new Date(Date.parse(d0)); week.setUTCDate(week.getUTCDate() + 7);
      const wk = week.toISOString().slice(0, 10);
      for (const [k, n] of [["over", "Overdue"], ["today", "Today"], ["week", "Next 7 days"], ["later", "Later"], ["none", "No due date"], ["done", "Done"]]) add(k, n);
      for (const t of tasks) {
        const d = (t.due || "").slice(0, 10);
        add(t.done ? "done" : !d ? "none" : d < d0 ? "over" : d === d0 ? "today" : d <= wk ? "week" : "later", "", t);
      }
    }
    return [...out.values()];
  },
  save, create, remove, openTask, render, ownerKey, flush, toggleDone,
  /* every task in the order the open view lists them: a task, then its sub-tasks */
  sequence() {
    const out = [];
    for (const b of T.buckets(T.visible())) for (const t of b.tasks) {
      if (out.includes(t.id)) continue;
      out.push(t.id);
      for (const k of T.descendants(t.id)) out.push(k.id);
    }
    return out;
  },
  /* the custom field of that name (Lark's Completion method, Task completers, Milestone) */
  fieldNamed(name) { return T.fields().find((f) => f.name.trim().toLowerCase() === name); },
  methodOf(t) { const f = T.fieldNamed("completion method"); return f && t.vals[f.id] === "AND" ? "AND" : "OR"; },
  isMilestone(t) { const f = T.fieldNamed("milestone"); return !!(f && t.vals[f.id]); },
  async openListTask(listId, taskId) { await openList(listId); if (taskId && S.tasks.has(taskId)) openTask(taskId); },
  dropInto(t, bucket, beforeId) {
    /* what "moving into this column / group" means for each Group by */
    const patch = {};
    const by = S.groupBy;
    if (by === "group" && bucket.group) patch.group_id = bucket.group.id;
    if (by === "priority" && bucket.priority !== undefined) patch.priority = bucket.priority;
    if (by === "status" && bucket.done !== undefined) patch.done = bucket.done;
    if (by === "owner") patch.owners = bucket.person ? [bucket.person] : [];
    if (S.sort === "custom") {
      const list = bucket.tasks.filter((x) => x.id !== t.id);
      const i = beforeId ? list.findIndex((x) => x.id === beforeId) : list.length;
      const prev = list[i - 1], next = list[i];
      patch.sort = prev && next ? (prev.sort + next.sort) / 2 : prev ? prev.sort + 1 : next ? next.sort - 1 : Date.now() / 1000;
    }
    save(t.id, patch);
  },
};
window.LWKTasks = T;

function ownerKey(p) { return p.uid != null ? "u" + p.uid : "n" + (p.name || "").toLowerCase(); }

function sorter() {
  const s = S.sort;
  return (a, b) => {
    if (s === "due") return (a.due || "9999").localeCompare(b.due || "9999") || a.sort - b.sort;
    if (s === "start") return (a.start || "9999").localeCompare(b.start || "9999") || a.sort - b.sort;
    if (s === "priority") return (PRI_RANK[b.priority] - PRI_RANK[a.priority]) || a.sort - b.sort;
    if (s === "title") return a.title.localeCompare(b.title);
    if (s === "created") return (b.created_at || "").localeCompare(a.created_at || "");
    return a.sort - b.sort;
  };
}

/* ------------------------------------------------------------ saving */

/* What a change was, for the Undo note */
const FIELD_LABEL = { title: "title", description: "description", priority: "priority", start: "start date",
  due: "due date", owners: "owners", group_id: "group", parent_id: "parent task", sort: "order",
  links: "links", vals: "field" };
function changeLabel(t, patch) {
  const ks = Object.keys(patch).filter((k) => k !== "sort" || Object.keys(patch).length === 1);
  const name = `"${(t.title || "task").slice(0, 40)}"`;
  if ("done" in patch) return (patch.done ? "ticked " : "unticked ") + name;
  if (ks.length === 2 && "start" in patch && "due" in patch) return "dates of " + name;
  if ("group_id" in patch && !("parent_id" in patch)) return "moved " + name;
  if ("parent_id" in patch) return (patch.parent_id ? "made a sub-task: " : "made a task: ") + name;
  return ks.map((k) => FIELD_LABEL[k] || k).join(", ") + " of " + name;
}
const copy = (v) => (v === undefined ? "" : JSON.parse(JSON.stringify(v)));

function save(id, patch) {
  const t = S.tasks.get(id);
  if (!t || !T.canEdit()) return;
  if (!Undo.replaying()) {
    // the old values of exactly the fields changed: Ctrl+Z saves them back
    const old = {};
    for (const k of Object.keys(patch)) {
      if (k === "vals") {
        old.vals = {};
        for (const f of Object.keys(patch.vals || {})) old.vals[f] = t.vals[f] === undefined ? null : copy(t.vals[f]);
      } else old[k] = copy(t[k]);
    }
    if (patch.group_id && !("group_id" in old)) old.group_id = t.group_id;
    const redoPatch = copy(patch);
    Undo.record({ label: changeLabel(t, patch), undo: () => save(id, old), redo: () => save(id, redoPatch) });
  }
  Object.assign(t, patch);
  if (patch.vals) t.vals = Object.assign({}, t.vals, patch.vals);
  if ("done" in patch) t.completed_at = patch.done ? new Date().toISOString() : "";
  const p = pending.get(id) || { id };
  for (const [k, v] of Object.entries(patch)) p[k] = k === "vals" ? Object.assign({}, p.vals || {}, v) : v;
  pending.set(id, p);
  if (patch.group_id) for (const k of T.descendants(id)) k.group_id = patch.group_id;
  render();
  if (S.openId === id) Detail.refresh(T);
  schedule();
}

/* Ticking a task. Completion method OR (the usual): any owner finishing it
   finishes it. AND: every owner ticks their own part - who has is kept in
   "Task completers" - and the task is done when all of them have. */
function toggleDone(t) {
  const cf = T.fieldNamed("task completers");
  const me = S.me || {};
  const meP = { uid: me.uid, name: me.name };
  const isMe = (p) => (me.uid != null && p.uid === me.uid) || (me.uid == null && p.name === me.name);
  if (T.methodOf(t) === "AND" && t.owners.length > 1 && cf) {
    let done = (t.vals[cf.id] || []).slice();
    if (!t.owners.some(isMe)) {
      if (!confirm(`This task is done when all ${t.owners.length} owners have finished their part (completion method AND), and you are not one of them.\n\nMark the whole task as ${t.done ? "not done" : "done"} anyway?`)) return;
      return save(t.id, { done: !t.done, vals: { [cf.id]: t.done ? [] : t.owners.slice() } });
    }
    done = done.some(isMe) ? done.filter((p) => !isMe(p)) : done.concat([meP]);
    const all = t.owners.every((o) => done.some((d) => (o.uid != null && d.uid === o.uid) || d.name === o.name));
    if (!all && !t.done) toast(`Your part is done - ${t.owners.length - done.length} more owner${t.owners.length - done.length > 1 ? "s" : ""} to go`);
    return save(t.id, { vals: { [cf.id]: done }, done: all });
  }
  const patch = { done: !t.done };
  if (cf) patch.vals = { [cf.id]: t.done ? [] : [meP] };
  save(t.id, patch);
}

function create(fields) {
  if (!T.canEdit()) return null;
  const id = uid();
  const groups = T.groups();
  const t = Object.assign({
    id, list_id: S.listId, group_id: groups.length ? groups[0].id : "", parent_id: "", number: null,
    title: "", description: "", done: false, completed_at: "", priority: "", start: "", due: "",
    owners: [], vals: {}, links: [], subscribers: [], sort: Date.now() / 1000, comment_count: 0,
    created_by: S.me.name, created_uid: S.me.uid, created_at: new Date().toISOString(), fresh: true,
  }, fields || {});
  S.tasks.set(id, t);
  const p = { id };
  for (const k of ["group_id", "parent_id", "title", "description", "done", "priority", "start", "due", "owners", "vals", "links", "sort"]) p[k] = t[k];
  pending.set(id, p);
  render();
  schedule(50);
  if (!Undo.replaying()) {
    Undo.record({ label: `new task "${(t.title || "task").slice(0, 40)}"`, merge: false,
                  undo: () => deleteNow(id), redo: () => restoreNow(id) }, { separate: true });
  }
  return t;
}

/* Delete and undelete without asking: what Undo and Redo use */
async function deleteNow(id) {
  await flush();
  const subs = T.descendants(id);
  await api("/api/tasks", { method: "POST", body: JSON.stringify({ list: S.listId, tasks: [], deleted: [id] }) });
  S.tasks.delete(id);
  for (const k of subs) S.tasks.delete(k.id);
  if (S.openId === id || subs.some((k) => k.id === S.openId)) Detail.close(T);
  render();
}
async function restoreNow(id) {
  const r = await api(`/api/tasks/${encodeURIComponent(id)}/restore`, { method: "POST", body: "{}" });
  for (const x of r.tasks || []) S.tasks.set(x.id, x);
  render();
}

async function remove(id) {
  const t = S.tasks.get(id);
  if (!t) return;
  const subs = T.descendants(id);
  const kids = subs.length;
  if (!confirm(`Delete "${t.title || "this task"}"${kids ? ` and its ${kids} sub-task${kids > 1 ? "s" : ""}` : ""}?`)) return;
  await flush();
  try {
    await api("/api/tasks", { method: "POST", body: JSON.stringify({ list: S.listId, tasks: [], deleted: [id] }) });
    S.tasks.delete(id);
    for (const k of subs) S.tasks.delete(k.id);
    if (S.openId === id || subs.some((k) => k.id === S.openId)) Detail.close(T);
    render();
    Undo.record({ label: `deleted "${(t.title || "task").slice(0, 40)}"`, merge: false,
                  undo: () => restoreNow(id), redo: () => deleteNow(id) }, { separate: true });
  } catch (e) { toast(e.message, true); }
}

function schedule(ms) {
  clearTimeout(flushTimer);
  $("#t-save").textContent = "Saving ...";
  flushTimer = setTimeout(flush, ms == null ? 500 : ms);
}

async function flush() {
  clearTimeout(flushTimer);
  while (saving) await new Promise((r) => setTimeout(r, 100));
  if (!pending.size) { $("#t-save").textContent = ""; return; }
  const batch = [...pending.values()];
  pending.clear();
  saving = true;
  try {
    const res = await api("/api/tasks", { method: "POST", body: JSON.stringify({ list: S.listId, tasks: batch }) });
    for (const r of res.tasks || []) applyTask(r);
    $("#t-save").textContent = "Saved";
    render();
    if (S.openId) Detail.refresh(T);
    if ((res.open_issues || []).length) offerResolve(res.open_issues);
  } catch (e) {
    // put them back, under anything changed since
    for (const p of batch) {
      const now = pending.get(p.id);
      pending.set(p.id, Object.assign({}, p, now || {}));
    }
    $("#t-save").textContent = "Not saved - retrying";
    toast("Not saved: " + e.message, true);
    if (e.status && e.status < 500 && e.status !== 409) pending.clear();
    else schedule(5000);
  } finally {
    saving = false;
  }
}
/* A task just done whose issues are still open: offer to resolve them, the
   same as resolving them in the viewer (history, emails, chat card). */
async function offerResolve(list) {
  const mine = list.filter((x) => x.ok);
  if (!mine.length) return;
  const f = await modal("Resolve its issues too?", `<p class="muted" style="font-size:12px;margin-top:0">`
    + `<b>${esc(mine[0].task_title || "This task")}</b> is done. These linked issues are still open:</p>`
    + mine.map((x, i) => `<label class="row-check"><input type="checkbox" name="i${i}" checked> `
      + `<b>#${esc(x.number || "?")}</b> ${esc(x.title)} <small class="muted">(${esc(x.project)}${x.sheet ? " · " + esc(x.sheet) : " · 3D"} · ${esc(x.status)})</small></label>`).join("")
    + `<label>Mark them <select name="st"><option>Resolved</option><option>Closed</option></select></label>`, "Update issues");
  if (!f) return;
  const byTask = {};
  mine.forEach((x, i) => { if (f["i" + i] && f["i" + i].checked) (byTask[x.task_id] = byTask[x.task_id] || []).push({ project: x.project, id: x.id }); });
  let n = 0, skipped = [];
  for (const [tid, issues] of Object.entries(byTask)) {
    try {
      const r = await api(`/api/tasks/${tid}/close-issues`, { method: "POST", body: JSON.stringify({ issues, status: f.st.value }) });
      n += r.done.length;
      skipped = skipped.concat(r.skipped);
    } catch (e) { toast(e.message, true); }
  }
  if (n) toast(`${n} issue${n === 1 ? "" : "s"} marked ${f.st.value}`);
  if (skipped.length) toast(`Not changed: ${skipped.map((x) => x.reason).join("; ")}`, true);
  render();
  if (S.openId) Detail.refresh(T);
}

addEventListener("beforeunload", (ev) => {
  if (pending.size) { flush(); ev.preventDefault(); ev.returnValue = ""; }
});

function applyTask(r) {
  if (r.deleted) { S.tasks.delete(r.id); return; }
  const mine = pending.get(r.id);
  S.tasks.set(r.id, mine ? Object.assign(r, mine, { vals: Object.assign({}, r.vals, mine.vals || {}) }) : r);
}

/* ------------------------------------------------------------ loading */

async function loadLists() {
  const r = await api("/api/task-lists");
  S.lists = r.lists;
  S.siteAdmin = r.site_admin;
  S.accounts = r.accounts;
  S.me = Object.assign({}, S.me || {}, r.me);
  if (!S.me.name) { try { S.me.name = localStorage.getItem("lwk-viewer:name") || ""; } catch (e) {} }
  paintSide();
}

async function openList(id, keepView) {
  await flush();
  S.listId = id;
  S.mode = "list";
  S.tasks.clear(); S.groups.clear(); S.fields.clear(); S.rev = 0;
  S.hidden = new Set(ls.get("hidden:" + id, []));
  S.collapsed = new Set(ls.get("collapsed:" + id, []));
  ls.set("list", id);
  if (!keepView && S.view === "activity") S.view = "list";
  await pull();
  setUrl();
  paintSide();
  render();
}

async function pull() {
  if (!S.listId) return;
  const r = await api(`/api/tasks?list=${encodeURIComponent(S.listId)}&since=${S.rev}`);
  if (r.list.id !== S.listId) return;
  S.list = r.list;
  S.role = r.role;
  for (const g of r.groups) g.deleted ? S.groups.delete(g.id) : S.groups.set(g.id, g);
  for (const f of r.fields) f.deleted ? S.fields.delete(f.id) : S.fields.set(f.id, f);
  for (const t of r.tasks) applyTask(t);
  const changed = r.tasks.length || r.groups.length || r.fields.length;
  S.rev = r.rev;
  return changed;
}

/* Others' changes: every few seconds while the page is in view. */
setInterval(async () => {
  // not while something is being dragged: a redraw would drop it
  if (document.hidden || !S.listId || S.mode !== "list" || saving || S.dragging) return;
  try {
    if (await pull()) {
      // a new-task box being typed in keeps its text
      const a = document.activeElement;
      if (!(a && a.closest && a.closest("#t-view") && a.value)) render();
      if (S.openId && !document.activeElement.closest("#t-detail")) Detail.refresh(T);
    }
  } catch (e) { /* offline for a moment: next time */ }
}, 5000);

async function loadQuick(view) {
  await flush();
  S.mode = "quick";
  S.quick = view;
  S.listId = "";
  setUrl();
  paintSide();
  $("#t-view").innerHTML = `<p class="muted" style="padding:20px">Loading ...</p>`;
  const r = await api("/api/tasks-mine?view=" + view);
  S.quickTasks = r.tasks;
  render();
}

/* ------------------------------------------------------------ the frame */

function paintSide() {
  $("#t-lists").innerHTML = S.lists.map((l) =>
    `<a class="ts-item sub${S.mode === "list" && l.id === S.listId ? " on" : ""}" data-list="${esc(l.id)}" title="${esc(l.team || "")}">`
    + `<span class="ts-i">&#9745;</span><span class="ts-t">${esc(l.title)}</span>`
    + (l.counts.overdue ? `<b class="ts-n bad" title="Overdue">${l.counts.overdue}</b>` : "")
    + `</a>`).join("") || `<div class="muted ts-empty">No lists yet</div>`;
  for (const a of $$(".ts-item[data-quick]")) a.classList.toggle("on", S.mode === "quick" && S.quick === a.dataset.quick);
  for (const a of $$(".ts-item[data-mode]")) a.classList.toggle("on", S.mode === a.dataset.mode);
}

function paintHead() {
  const inList = S.mode === "list" && S.list;
  $("#t-tabs").hidden = !inList;
  $("#t-bar").hidden = !inList || S.view === "dash" || S.view === "activity";
  $("#t-menu").hidden = !inList;
  $("#t-share").hidden = !inList || !S.accounts;
  $("#t-new").disabled = $("#t-new-more").disabled = !T.canEdit();
  for (const b of $$("#t-tabs button")) b.classList.toggle("on", b.dataset.view === S.view);
  if (inList) {
    $("#t-title").textContent = S.list.title;
    $("#t-team").textContent = [S.list.team, S.role === "viewer" ? "view only" : ""].filter(Boolean).join(" · ");
    const ms = (S.list.members || []).map((m) => S.people.find((p) => p.uid === m.uid)).filter(Boolean);
    $("#t-members").innerHTML = `<span class="avs">${ms.slice(0, 6).map((p) => avatar(p, 26)).join("")}`
      + (ms.length > 6 ? `<span class="av more" style="width:26px;height:26px">+${ms.length - 6}</span>` : "") + `</span>`;
    const owners = T.everyOwner();
    const cur = $("#f-owner").value;
    $("#f-owner").innerHTML = `<option value="">Any owner</option>` + owners.map((p) =>
      `<option value="${esc(ownerKey(p))}">${esc(p.name)}</option>`).join("");
    $("#f-owner").value = owners.some((p) => ownerKey(p) === cur) ? cur : "";
  } else {
    $("#t-members").innerHTML = "";
    $("#t-team").textContent = "";
    $("#t-title").textContent = S.mode === "quick" ? ({ owned: "Owned by me", subscribed: "Subscribed", all: "All tasks",
      created: "Created by me", assigned: "Assigned by me", completed: "Completed" })[S.quick]
      : S.mode === "people" ? "People" : S.mode === "activity" ? "Activities" : "Tasks";
  }
}

function render() {
  paintHead();
  const el = $("#t-view");
  if (S.mode !== "list" && !$("#t-detail").hidden) {
    $("#t-detail").hidden = true;
    document.body.classList.remove("detail-on");
    S.openId = "";
  }
  el.className = "v-" + (S.mode === "list" ? S.view : S.mode);
  if (S.mode === "people") return PeopleView.render(T, el);
  if (S.mode === "activity") return renderActivity(el, "");
  if (S.mode === "quick") return renderQuick(el);
  if (!S.list) {
    el.innerHTML = `<div class="t-empty"><h3>No task list open</h3>`
      + `<p>Start one for your team - groups inside it can each be a project.</p>`
      + `<button class="primary" id="t-empty-new">+ New task list</button> <button id="t-empty-lark">Import a Lark task list (.xlsx)</button></div>`;
    $("#t-empty-new").onclick = newList;
    $("#t-empty-lark").onclick = () => importFile(true);
    return;
  }
  if (S.view === "kanban") return KanbanView.render(T, el);
  if (S.view === "gantt") return GanttView.render(T, el);
  if (S.view === "dash") return DashView.render(T, el);
  if (S.view === "activity") return renderActivity(el, S.listId);
  return ListView.render(T, el);
}

function renderQuick(el) {
  const ts = S.quickTasks;
  if (!ts.length) { el.innerHTML = `<div class="t-empty"><p>Nothing here.</p></div>`; return; }
  el.innerHTML = `<table class="tq"><thead><tr><th>Task</th><th>List</th><th>Group</th><th>Priority</th><th>Owner</th><th>Due</th></tr></thead><tbody>`
    + ts.map((t) => `<tr data-list="${esc(t.list_id)}" data-id="${esc(t.id)}" class="${t.done ? "done" : ""}">`
      + `<td><span class="tick${t.done ? " on" : ""}"></span> ${esc(t.title || "Untitled")}${t.parent_id ? ` <small class="muted">sub-task</small>` : ""}</td>`
      + `<td>${esc(t.list_title)}</td><td>${esc(t.group_title)}</td>`
      + `<td>${t.priority ? `<span class="pri pri-${esc(t.priority.toLowerCase())}">${esc(t.priority)}</span>` : ""}</td>`
      + `<td>${t.owners.map((p) => esc(p.name)).join(", ")}</td>`
      + `<td class="${isOverdue(t) ? "bad" : ""}">${esc((t.due || "").slice(0, 10))}</td></tr>`).join("")
    + `</tbody></table>`;
  el.onclick = async (ev) => {
    const tr = ev.target.closest("tr[data-id]");
    if (!tr) return;
    await openList(tr.dataset.list);
    openTask(tr.dataset.id);
  };
}

async function renderActivity(el, listId) {
  el.innerHTML = `<p class="muted" style="padding:20px">Loading ...</p>`;
  const r = await api("/api/task-activity?limit=300" + (listId ? "&list=" + encodeURIComponent(listId) : ""));
  const names = Object.fromEntries(S.lists.map((l) => [l.id, l.title]));
  const say = (a) => {
    if (a.event === "created") return "created";
    if (a.event === "completed") return "completed";
    if (a.event === "reopened") return "reopened";
    if (a.event === "deleted") return "deleted";
    if (a.event === "comment") return "commented on";
    if (a.event === "imported") return "imported " + esc(a.new) + " into";
    if (a.event === "list-created") return "started the list";
    if (a.event === "list-renamed") return "renamed the list to";
    return `changed <b>${esc(a.field)}</b> of`;
  };
  let day = "";
  el.innerHTML = `<div class="t-act">` + (r.activity.map((a) => {
    const d = a.at.slice(0, 10);
    const head = d !== day ? `<h4>${esc(new Date(a.at).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }))}</h4>` : "";
    day = d;
    const detail = a.event === "changed" && a.field !== "description"
      ? ` <span class="muted">${esc(a.old || "-")} &rarr; </span>${esc(a.new || "-")}`
      : a.event === "comment" ? `<div class="ta-c">${esc(a.new)}</div>` : "";
    return head + `<div class="ta-row" ${a.task_id ? `data-list="${esc(a.list_id)}" data-id="${esc(a.task_id)}"` : ""}>`
      + avatar({ name: a.by }) + `<div><b>${esc(a.by || "?")}</b> ${say(a)} `
      + (a.task_id ? `<a href="#">${esc(a.title || "a task")}</a>` : a.title ? `<b>${esc(a.title)}</b>` : "")
      + detail
      + `<div class="muted ta-w">${esc(fmtWhen(a.at))}${listId ? "" : " · " + esc(names[a.list_id] || "")}</div></div></div>`;
  }).join("") || `<p class="muted">Nothing has happened yet.</p>`) + `</div>`;
  el.onclick = async (ev) => {
    const row = ev.target.closest(".ta-row[data-id]");
    if (!row || !ev.target.closest("a")) return;
    ev.preventDefault();
    if (row.dataset.list !== S.listId) await openList(row.dataset.list, true);
    if (S.tasks.has(row.dataset.id)) openTask(row.dataset.id);
    else toast("That task has been deleted");
  };
}

function openTask(id) {
  if (!S.tasks.has(id)) return;
  S.openId = id;
  setUrl();
  Detail.open(T, id);
  render();
}
T.closeTask = () => { S.openId = ""; setUrl(); render(); };

function setUrl() {
  const q = new URLSearchParams();
  const p = project();
  if (p) q.set("project", p);
  if (S.mode === "list" && S.listId) q.set("list", S.listId);
  if (S.mode === "quick") q.set("quick", S.quick);
  if (S.mode === "people" || S.mode === "activity") q.set("mode", S.mode);
  if (S.openId && S.mode === "list") q.set("task", S.openId);
  history.replaceState(null, "", "tasks.html?" + q.toString());
}

/* ------------------------------------------------------------ list settings */

async function newList() {
  const projects = await projectsList();
  const f = await modal("New task list", `
    <label>Name<input name="title" placeholder="e.g. LWK-MANILA" required maxlength="120"></label>
    <label>Team <input name="team" placeholder="e.g. Manila BIM team" maxlength="80"></label>
    <label>Groups <small class="muted">one per line; a group can be a project - pick it below after</small>
      <textarea name="groups" rows="4" placeholder="SKW&#10;Kai Tak 2A3&#10;NDH"></textarea></label>
    ${projects.length ? `<p class="muted" style="font-size:11px">A group named like a project folder (${esc(projects.slice(0, 3).map((p) => p.id).join(", "))}) is linked to it automatically.</p>` : ""}
    <label class="row-check"><input type="checkbox" name="fields" checked> Add "Modelers" and "Project Manager" people columns</label>`, "Create");
  if (!f) return;
  const groups = f.groups.value.split("\n").map((s) => s.trim()).filter(Boolean).map((t) => {
    const p = projects.find((p) => p.id.toLowerCase() === t.toLowerCase() || (p.title || "").toLowerCase() === t.toLowerCase());
    return { title: t, project: p ? p.id : "" };
  });
  try {
    const r = await api("/api/task-lists", { method: "POST", body: JSON.stringify({
      title: f.title.value, team: f.team.value, groups: groups.length ? groups : undefined,
      fields: f.fields.checked ? undefined : [] }) });
    await loadLists();
    await openList(r.id);
  } catch (e) { toast(e.message, true); }
}

let PROJECTS = null;
async function projectsList() {
  if (PROJECTS) return PROJECTS;
  try { PROJECTS = (await api("/api/projects")).projects || []; } catch (e) { PROJECTS = []; }
  return PROJECTS;
}
T.projects = projectsList;

async function editGroups() {
  const projects = await projectsList();
  const reg = await registry();
  // a group points at a job on the Projects page (r:) - or straight at a viewer project (v:)
  const opts = (g) => {
    const cur = g.reg ? "r:" + g.reg : g.project ? "v:" + g.project : "";
    const o = (v, label) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${label}</option>`;
    return o("", "- no project -")
      + (reg.length ? `<optgroup label="Projects page">${reg.map((p) => o("r:" + p.id, esc(p.short || p.name) + (p.code ? " · " + esc(p.code) : ""))).join("")}</optgroup>` : "")
      + `<optgroup label="Viewer project only">${projects.map((p) => o("v:" + p.id, esc(p.title) + (p.title !== p.id ? " (" + esc(p.id) + ")" : ""))).join("")}`
      + (g.project && !g.reg && !projects.some((p) => p.id === g.project) ? o("v:" + g.project, esc(g.project)) : "") + `</optgroup>`;
  };
  const row = (g) => `<div class="eg-row" data-id="${esc(g.id || "")}"><input class="eg-t" value="${esc(g.title)}" placeholder="Group name">`
    + `<select class="eg-p">${opts(g)}</select><button type="button" class="ghost eg-up" title="Move up">&uarr;</button>`
    + `<button type="button" class="ghost eg-del" title="Delete">&#10005;</button></div>`;
  const back = modal("Groups and projects", `<p class="muted" style="font-size:12px">Link each group to its job on the Projects page: its tasks then count there, link that job's issues, sheets and 3D views, and post updates to the job's chat channel.</p>`
    + `<div class="eg">${T.groups().map(row).join("")}</div><button type="button" class="ghost eg-add">+ Add group</button>`, "Save");
  const form = document.querySelector(".t-modal");
  form.querySelector(".eg-add").onclick = () => {
    form.querySelector(".eg").insertAdjacentHTML("beforeend", row({ title: "", project: "", reg: "" }));
    form.querySelector(".eg .eg-row:last-child input").focus();
  };
  const dels = [];
  form.querySelector(".eg").onclick = (ev) => {
    const r = ev.target.closest(".eg-row");
    if (ev.target.closest(".eg-del")) { if (r.dataset.id) dels.push(r.dataset.id); r.remove(); }
    if (ev.target.closest(".eg-up") && r.previousElementSibling) r.parentNode.insertBefore(r, r.previousElementSibling);
  };
  const f = await back;
  if (!f) return;
  const groups = [...f.querySelectorAll(".eg-row")].map((r, i) => ({
    id: r.dataset.id || undefined, title: r.querySelector(".eg-t").value.trim() || "Group",
    ...(() => {
      const v = r.querySelector(".eg-p").value;
      return v.startsWith("r:") ? { reg: v.slice(2) } : { reg: "", project: v.slice(2) };
    })(), sort: i }));
  try {
    await api(`/api/task-lists/${S.listId}/groups`, { method: "POST", body: JSON.stringify({
      groups: groups.concat(dels.map((id) => ({ id, deleted: true }))) }) });
    await pull();
    render();
  } catch (e) { toast(e.message, true); }
}
T.editGroups = editGroups;

let REG = null;
async function registry(fresh) {
  if (REG && !fresh) return REG;
  try { REG = (await api("/api/registry")).projects || []; } catch (e) { REG = []; }
  return REG;
}
T.registry = registry;

async function editFields() {
  const cols = [["priority", "Priority"], ["owners", "Owner"], ["start", "Start"], ["due", "Due"], ["progress", "Sub-task progress"],
    ["completed", "Completed on"], ["subscribers", "Subscribers"], ["creator", "Creator"], ["created", "Created on"],
    ["updated", "Updated on"], ["links", "Links & files"]];
  const row = (f) => `<div class="eg-row" data-id="${esc(f.id || "")}"><input class="ef-n" value="${esc(f.name)}" placeholder="Column name">`
    + `<select class="ef-t">${["person", "select", "text", "date", "number", "check"].map((t) => `<option${t === f.type ? " selected" : ""}>${t}</option>`).join("")}</select>`
    + `<input class="ef-o" value="${esc((f.options || []).join(", "))}" placeholder="choices, for select">`
    + `<button type="button" class="ghost eg-del">&#10005;</button></div>`;
  const all = cols.concat(T.fields().map((f) => ["f:" + f.id, f.name]));
  const p = modal("Customize columns", `<h4>Show</h4><div class="ef-show">${all.map(([k, n]) =>
    `<label class="row-check"><input type="checkbox" data-k="${esc(k)}"${S.hidden.has(k) ? "" : " checked"}> ${esc(n)}</label>`).join("")}</div>`
    + (T.isOwner() ? `<h4>Custom fields</h4><div class="eg">${T.fields().map(row).join("")}</div><button type="button" class="ghost eg-add">+ Add field</button>` : ""), "Save");
  const form = document.querySelector(".t-modal");
  const dels = [];
  if (T.isOwner()) {
    form.querySelector(".eg-add").onclick = () => form.querySelector(".eg").insertAdjacentHTML("beforeend", row({ name: "", type: "person" }));
    form.querySelector(".eg").onclick = (ev) => {
      const r = ev.target.closest(".eg-row");
      if (ev.target.closest(".eg-del")) { if (r.dataset.id) dels.push(r.dataset.id); r.remove(); }
    };
  }
  const f = await p;
  if (!f) return;
  S.hidden = new Set([...f.querySelectorAll(".ef-show input")].filter((i) => !i.checked).map((i) => i.dataset.k));
  ls.set("hidden:" + S.listId, [...S.hidden]);
  if (T.isOwner()) {
    const fields = [...f.querySelectorAll(".eg-row")].filter((r) => r.querySelector(".ef-n").value.trim()).map((r, i) => ({
      id: r.dataset.id || undefined, name: r.querySelector(".ef-n").value.trim(), type: r.querySelector(".ef-t").value,
      options: r.querySelector(".ef-o").value.split(",").map((s) => s.trim()).filter(Boolean), sort: i }));
    try {
      await api(`/api/task-lists/${S.listId}/fields`, { method: "POST", body: JSON.stringify({
        fields: fields.concat(dels.map((id) => ({ id, deleted: true }))) }) });
      await pull();
    } catch (e) { toast(e.message, true); }
  }
  render();
}

async function editMembers() {
  const ms = new Map((S.list.members || []).map((m) => [m.uid, m.role]));
  const rows = S.people.map((p) => `<div class="em-row"><span class="person">${avatar(p)}<span>${esc(p.name)}</span></span>`
    + `<small class="muted">${esc([p.team, p.office].filter(Boolean).join(" · "))}</small>`
    + `<select data-uid="${p.uid}"${T.isOwner() ? "" : " disabled"}><option value="">-</option>`
    + ["viewer", "editor", "owner"].map((r) => `<option${ms.get(p.uid) === r ? " selected" : ""}>${r}</option>`).join("")
    + `</select></div>`).join("");
  const p = modal("Members of " + S.list.title, `<p class="muted" style="font-size:12px">Owner: settings and members. Editor: add and change tasks. Viewer: read only. Site admins see every list.</p>`
    + `<input class="em-q" placeholder="Filter people"><div class="em">${rows}</div>`, T.isOwner() ? "Save" : "Close");
  const form = document.querySelector(".t-modal");
  form.querySelector(".em-q").oninput = (ev) => {
    const q = ev.target.value.toLowerCase();
    for (const r of form.querySelectorAll(".em-row")) r.hidden = q && !r.textContent.toLowerCase().includes(q);
  };
  const f = await p;
  if (!f || !T.isOwner()) return;
  const members = [...f.querySelectorAll("select[data-uid]")].filter((s) => s.value).map((s) => ({ uid: Number(s.dataset.uid), role: s.value }));
  try {
    await api(`/api/task-lists/${S.listId}/members`, { method: "PUT", body: JSON.stringify({ members }) });
    S.rev = 0; await pull(); await loadLists(); render();
  } catch (e) { toast(e.message, true); }
}

/* A Lark export (.xlsx, as Lark gives it) or a CSV. Into this list, or
   (newList) as a new list named after the Lark one. The same export can be
   brought in again later: tasks are matched by their Lark task id. */
async function importFile(newList) {
  const f = await modal(newList ? "Import a Lark task list" : "Import into " + S.list.title,
    `<p class="muted" style="font-size:12px">In Lark: open the task list, <b>...</b> &rarr; <b>Export</b> (Excel). Choose that file here - .xlsx as it is, or a CSV.`
    + ` Groups, sub-tasks, owners, followers, Modelers, Project Manager, priorities, dates and done / not done all come in. Bringing the same list in again updates the tasks instead of adding them twice.</p>`
    + `<input type="file" name="file" accept=".xlsx,.csv,.tsv,.txt" required>`
    + (newList ? `<label>Name of the new list <input name="title" placeholder="from the file (e.g. LWK-MANILA)"></label>` : ""), "Import");
  if (!f) return;
  const file = f.file.files[0];
  if (!file) return;
  const body = {};
  if (/\.xlsx$/i.test(file.name)) {
    body.xlsx = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(",")[1]);
      fr.onerror = () => rej(new Error("Could not read the file"));
      fr.readAsDataURL(file);
    });
  } else body.csv = await file.text();
  if (newList && f.title.value.trim()) body.title = f.title.value.trim();
  toast("Importing ...");
  try {
    const r = await api(newList ? "/api/task-lists/import" : `/api/task-lists/${S.listId}/import`, { method: "POST", body: JSON.stringify(body) });
    if (newList) { await loadLists(); await openList(r.id); } else { S.rev = 0; await pull(); render(); }
    await modal("Imported", `<p>${r.created} new task${r.created === 1 ? "" : "s"}, ${r.updated} updated${r.groups ? `, ${r.groups} new group${r.groups === 1 ? "" : "s"}` : ""}.</p>`
      + (r.unmatched.length ? `<p class="muted" style="font-size:12px">These names have no account on this server yet, so they are kept as names: <b>${r.unmatched.map(esc).join(", ")}</b>.`
        + ` Once a site admin has made their accounts (Admin &rarr; People), use <b>...</b> &rarr; <b>Match names to accounts</b>.</p>` : "")
      + `<p class="muted" style="font-size:12px">Link each group to its job: <b>...</b> &rarr; <b>Groups and projects</b>.</p>`, "OK");
  } catch (e) { toast(e.message, true); }
}

async function relink() {
  try {
    const r = await api(`/api/task-lists/${S.listId}/relink`, { method: "POST", body: "{}" });
    toast(`${r.changed} task${r.changed === 1 ? "" : "s"} updated` + (r.unmatched.length ? ` - still no account: ${r.unmatched.join(", ")}` : ""), !!r.unmatched.length);
    S.rev = 0; await pull(); render();
  } catch (e) { toast(e.message, true); }
}

function exportCsv() {
  const fields = T.fields();
  const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const head = ["Number", "Task Title", "Custom Group", "Project", "Parent Task", "Owner", "Priority", "Start Time", "Due Date",
    "Status", "Completed At", "Description", "Links"].concat(fields.map((f) => f.name));
  const lines = [head.map(q).join(",")];
  const all = [...S.tasks.values()].sort((a, b) => (a.parent_id ? 1 : 0) - (b.parent_id ? 1 : 0) || a.sort - b.sort);
  for (const t of all) {
    const g = S.groups.get(t.group_id);
    const par = t.parent_id && S.tasks.get(t.parent_id);
    lines.push([t.number, t.title, g ? g.title : "", g ? g.project : "", par ? par.title : "", t.owners.map((p) => p.name).join(", "),
      t.priority, t.start, t.due, t.done ? "Done" : "Not done", (t.completed_at || "").slice(0, 16), t.description,
      t.links.map((l) => l.url).join(" ")].concat(fields.map((f) => {
      const v = t.vals[f.id];
      return Array.isArray(v) ? v.map((p) => p.name).join(", ") : v;
    })).map(q).join(","));
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" }));
  a.download = (S.list.title || "tasks") + ".csv";
  a.click();
}

async function listMenu(anchor) {
  const own = T.isOwner(), ed = T.canEdit();
  const items = [
    own && ["rename", "Rename list"], ed && ["groups", "Groups and projects"], ["fields", "Customize columns"],
    ed && ["import", "Import from Lark (.xlsx) / CSV"], ed && ["relink", "Match names to accounts"], ["export", "Export to CSV (Excel)"], own && ["delete", "Delete list"]].filter(Boolean);
  const el = pop(anchor, items.map(([k, n]) => `<div class="po-row${k === "delete" ? " bad" : ""}" data-k="${k}">${n}</div>`).join(""), 220);
  el.onclick = async (ev) => {
    const r = ev.target.closest(".po-row");
    if (!r) return;
    closePop();
    const k = r.dataset.k;
    if (k === "groups") editGroups();
    if (k === "fields") editFields();
    if (k === "import") importFile(false);
    if (k === "relink") relink();
    if (k === "export") exportCsv();
    if (k === "rename") {
      const f = await modal("Rename list", `<label>Name<input name="t" value="${esc(S.list.title)}" maxlength="120"></label>`
        + `<label>Team<input name="team" value="${esc(S.list.team || "")}" maxlength="80"></label>`, "Save");
      if (!f) return;
      await api("/api/task-lists/" + S.listId, { method: "PATCH", body: JSON.stringify({ title: f.t.value, team: f.team.value }) });
      await loadLists(); S.list.title = f.t.value; S.list.team = f.team.value; render();
    }
    if (k === "delete") {
      if (!confirm(`Delete the list "${S.list.title}" with all ${S.tasks.size} tasks? A site admin can restore it from the Admin page.`)) return;
      await api("/api/task-lists/" + S.listId, { method: "DELETE" });
      S.list = null; S.listId = ""; ls.set("list", "");
      await loadLists(); render();
    }
  };
}

/* "Send to task" from the sheets / 3D page: tasks.html?attach=<url>&title=... */
async function attachFromViewer(url, title) {
  const lists = S.lists.filter((l) => l.role !== "viewer");
  if (!lists.length) { toast("You are not an editor on any task list", true); return; }
  const all = (await api("/api/tasks-mine?view=all")).tasks.filter((t) => lists.some((l) => l.id === t.list_id));
  const opts = all.filter((t) => !t.done).map((t) => `<option value="${esc(t.list_id)}|${esc(t.id)}">${esc(t.list_title)} / ${esc(t.group_title)} - ${esc(t.title || "Untitled")}</option>`).join("");
  const f = await modal("Add this view to a task", `<p class="fl-preview"></p>`
    + `<label>Task<input name="q" placeholder="Type to filter"><select name="task" size="8">${opts}</select></label>`
    + `<label>Or a new task in<select name="list"><option value="">-</option>${lists.map((l) => `<option value="${esc(l.id)}">${esc(l.title)}</option>`).join("")}</select></label>`
    + `<label>Link title<input name="title" value="${esc(title || "")}"></label>`, "Add");
  if (!f) return;
  const link = makeLink(url, f.title.value, S.me.name);
  if (!link) return toast("That is not a link that can be kept", true);
  // Revit elements chosen on the 3D page come with it (nav.js sendToTask)
  try {
    const h = JSON.parse(localStorage.getItem("lwk-viewer:attach-elements") || "null");
    if (h && h.url === url && Date.now() - h.at < 30 * 60e3) {
      link.elements = h.elements;
      localStorage.removeItem("lwk-viewer:attach-elements");
    }
  } catch (e) {}
  if (f.task.value) {
    const [lid, tid] = f.task.value.split("|");
    await openList(lid);
    const t = S.tasks.get(tid);
    if (t) { save(tid, { links: t.links.concat([link]) }); openTask(tid); }
  } else if (f.list.value) {
    await openList(f.list.value);
    const t = create({ title: f.title.value || "New task", links: [link] });
    if (t) openTask(t.id);
  }
}

/* ------------------------------------------------------------ wiring */

function wire() {
  $("#t-side").onclick = (ev) => {
    const a = ev.target.closest(".ts-item");
    if (!a) return;
    ev.preventDefault();
    if (a.dataset.list) openList(a.dataset.list);
    else if (a.dataset.quick) loadQuick(a.dataset.quick);
    else if (a.dataset.mode) { flush(); S.mode = a.dataset.mode; S.listId = ""; S.list = null; setUrl(); paintSide(); render(); }
  };
  $("#t-side-toggle").onclick = () => document.body.classList.toggle("side-off");
  $("#t-side-open").onclick = () => document.body.classList.toggle("side-open");
  // a phone: choosing something in the drawer closes it; so does a tap beside it
  $("#t-side").addEventListener("click", (ev) => { if (ev.target.closest(".ts-item")) document.body.classList.remove("side-open"); });
  document.addEventListener("pointerdown", (ev) => {
    if (document.body.classList.contains("side-open") && !ev.target.closest("#t-side, #t-side-open")) document.body.classList.remove("side-open");
  });
  $("#t-newlist").onclick = (ev) => {
    const el = pop(ev.currentTarget, `<div class="po-row" data-k="new">New task list</div><div class="po-row" data-k="lark">Import a Lark task list (.xlsx)</div>`, 240);
    el.onclick = (e) => {
      const r = e.target.closest(".po-row");
      if (!r) return;
      closePop();
      if (r.dataset.k === "new") newList(); else importFile(true);
    };
  };
  $("#t-tabs").onclick = (ev) => {
    const b = ev.target.closest("button[data-view]");
    if (!b) return;
    S.view = b.dataset.view;
    ls.set("view", S.view);
    render();
  };
  $("#t-new").onclick = () => {
    const g = S.groupBy === "group" ? T.groups()[0] : null;
    const t = create(g ? { group_id: g.id } : {});
    if (t) openTask(t.id);
  };
  $("#t-new-more").onclick = (ev) => {
    const el = pop(ev.currentTarget, `<div class="po-row" data-k="group">New group</div><div class="po-row" data-k="import">Import from Lark (.xlsx) / CSV</div>`, 230);
    el.onclick = (e) => {
      const r = e.target.closest(".po-row");
      if (!r) return;
      closePop();
      if (r.dataset.k === "group") editGroups(); else importFile(false);
    };
  };
  $("#t-menu").onclick = (ev) => listMenu(ev.currentTarget);
  $("#t-share").onclick = editMembers;
  $("#t-cols").onclick = editFields;
  $("#f-q").oninput = (ev) => { S.filter.q = ev.target.value; render(); };
  $("#f-status").onchange = (ev) => { S.filter.status = ev.target.value; render(); };
  $("#f-owner").onchange = (ev) => { S.filter.owner = ev.target.value; render(); };
  $("#f-pri").onchange = (ev) => { S.filter.pri = ev.target.value; render(); };
  $("#f-sort").onchange = (ev) => { S.sort = ev.target.value; ls.set("sort", S.sort); render(); };
  $("#f-group").onchange = (ev) => { S.groupBy = ev.target.value; ls.set("groupBy", S.groupBy); render(); };
  S.sort = ls.get("sort", "custom"); $("#f-sort").value = S.sort;
  S.groupBy = ls.get("groupBy", "group"); $("#f-group").value = S.groupBy;
  T.saveCollapsed = () => ls.set("collapsed:" + S.listId, [...S.collapsed]);
}

/* The same sign-in the dashboard and boards use. */
async function ensureSignedIn() {
  try { S.me = await api("/api/me"); return; } catch (e) { if (e.status !== 401) throw e; }
  const info = await (await fetch("/api/ping")).json();
  const back = $("#gate-back");
  back.hidden = false;
  if (!info.accounts) {
    $("#gate-name").closest("label").firstChild.textContent = "Your name";
    $("#gate-pass").closest("label").firstChild.textContent = "Project passphrase";
    $("#gate-name").type = "text";
  }
  try { $("#gate-name").value = localStorage.getItem(info.accounts ? "lwk-viewer:email" : "lwk-viewer:name") || ""; } catch (e) {}
  await new Promise((resolve) => {
    const go = async () => {
      $("#gate-msg").textContent = "Signing in ...";
      try {
        const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: $("#gate-name").value.trim(), passphrase: $("#gate-pass").value }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Sign-in failed");
        localStorage.setItem("lwk-viewer:token", data.token);
        localStorage.setItem(info.accounts ? "lwk-viewer:email" : "lwk-viewer:name", $("#gate-name").value.trim());
        back.hidden = true;
        resolve();
      } catch (e) { $("#gate-msg").textContent = e.message; }
    };
    $("#gate-go").onclick = go;
    $("#gate-pass").onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); go(); } };
  });
  S.me = await api("/api/me");
}

function headerLinks() {
  const p = project();
  const q = p ? "?project=" + encodeURIComponent(p) : "";
  for (const [id, page] of [["to-sheets", "index.html"], ["to-3d", "model.html"], ["to-board", "board.html"], ["to-dash", "dashboard.html"], ["to-admin", "admin.html"],
    ["to-projects", "projects.html"], ["to-chat", "messenger.html"]]) {
    if ($("#" + id)) $("#" + id).href = page + q;
  }
  const me = S.me || {};
  if (me.user) {
    $("#t-who").textContent = me.user.name;
    $("#to-admin").hidden = !(me.site_admin || Object.values(me.projects || {}).includes("admin"));
  }
  const so = $("#t-signout");
  so.hidden = !me.accounts;
  so.onclick = async (ev) => {
    ev.preventDefault();
    try { await fetch("/api/logout", { method: "POST" }); } catch (e) {}
    try { localStorage.removeItem("lwk-viewer:token"); } catch (e) {}
    location.href = "index.html";
  };
}

async function start() {
  wire();
  await ensureSignedIn();
  const me = S.me;
  if (me.user && me.user.must_change) {
    location.href = "admin.html?first=1&next=" + encodeURIComponent(location.pathname + location.search) + "#account";
    return;
  }
  S.me = { uid: me.user ? me.user.id : null, name: me.user ? me.user.name : "", user: me.user, accounts: me.accounts,
    site_admin: me.site_admin, projects: me.projects };
  headerLinks();
  try { const p = await api("/api/people"); S.people = p.people || []; } catch (e) { S.people = []; }
  await loadLists();
  const q = new URLSearchParams(location.search);
  if (q.get("attach")) {
    await attachFromViewer(q.get("attach"), q.get("title") || "");
    return;
  }
  if (q.get("mode") === "people" || q.get("mode") === "activity") { S.mode = q.get("mode"); paintSide(); render(); return; }
  if (q.get("quick")) return loadQuick(q.get("quick"));
  const want = q.get("list") || ls.get("list", "");
  const lid = S.lists.some((l) => l.id === want) ? want : (S.lists[0] && S.lists[0].id);
  if (lid) {
    await openList(lid, true);
    if (q.get("task") && S.tasks.has(q.get("task"))) openTask(q.get("task"));
  } else render();
  try { $("#n-owned").textContent = (await api("/api/tasks-mine?view=owned")).tasks.length || ""; } catch (e) {}
}

start().catch((e) => {
  $("#t-view").innerHTML = `<p class="bad" style="padding:20px">Could not load tasks: ${esc(e.message)}</p>`;
});

export { ago };
