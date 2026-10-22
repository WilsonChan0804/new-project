/* Copy and paste tasks: choose rows with Ctrl / Shift-click, copy them
 * (Ctrl+C, or right-click > Copy), then paste them as sub-tasks of another
 * task, below it, or into a group. A copied task brings its whole branch of
 * sub-tasks. Copies start fresh: not done, no percent, no comments.
 * The copy is kept in this browser, so it pastes into another list too. */
import { esc, uid, toast, pop, closePop } from "./tasks-util.js";

const KEY = "lwk.tasks.clip";
let CLIP = null;
let anchorId = "";            // the last row clicked, for Shift-click ranges

function readClip() {
  if (CLIP) return CLIP;
  try { CLIP = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { CLIP = null; }
  return CLIP;
}
function count(items) {
  return items.reduce((n, it) => n + 1 + count(it.kids || []), 0);
}
function height(items) {
  return items.reduce((m, it) => Math.max(m, 1 + height(it.kids || [])), 0);
}

/* ------------------------------------------------------------ choosing rows */

/* A Ctrl / Shift-click on a row: true when it was one (the row is not opened) */
export function pickClick(T, ev, id) {
  const S = T.S;
  if (ev.shiftKey && anchorId) {
    const seq = T.sequence();
    const a = seq.indexOf(anchorId), b = seq.indexOf(id);
    if (a < 0 || b < 0) return false;
    if (!(ev.ctrlKey || ev.metaKey)) S.picked.clear();
    for (const x of seq.slice(Math.min(a, b), Math.max(a, b) + 1)) S.picked.add(x);
    T.render();
    return true;
  }
  if (ev.ctrlKey || ev.metaKey) {
    if (!S.picked.size && S.openId && S.openId !== id) S.picked.add(S.openId);
    S.picked.has(id) ? S.picked.delete(id) : S.picked.add(id);
    anchorId = id;
    T.render();
    return true;
  }
  anchorId = id;
  if (S.picked.size) { S.picked.clear(); T.render(); }
  return false;
}

/* ------------------------------------------------------------ copy */

function chosen(T) {
  const S = T.S;
  const ids = S.picked.size ? [...S.picked] : S.openId ? [S.openId] : [];
  const set = new Set(ids.filter((id) => T.task(id)));
  // a task under another chosen one comes with it, once
  const under = (t) => { for (let p = T.task(t.parent_id); p; p = T.task(p.parent_id)) if (set.has(p.id)) return true; return false; };
  const order = T.sequence();
  return [...set].map((id) => T.task(id)).filter((t) => !under(t))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

export function copy(T, list) {
  const tasks = list || chosen(T);
  if (!tasks.length) { toast("Choose a task first (Ctrl-click to choose several)", true); return; }
  const branch = (t) => ({
    title: t.title, description: t.description, priority: t.priority, start: t.start, due: t.due,
    owners: (t.owners || []).slice(), vals: JSON.parse(JSON.stringify(t.vals || {})), links: JSON.parse(JSON.stringify(t.links || [])),
    kids: T.children(t.id).map(branch),
  });
  CLIP = {
    list: T.S.listId,
    fields: T.fields().map((f) => ({ id: f.id, name: f.name, type: f.type })),
    items: tasks.map(branch),
  };
  try { localStorage.setItem(KEY, JSON.stringify(CLIP)); } catch (e) {}
  const n = count(CLIP.items);
  toast(`Copied ${n} task${n === 1 ? "" : "s"} - right-click a task or group to paste`);
}

/* ------------------------------------------------------------ paste */

/* where: {parent: task} (as its sub-tasks), {after: task} (below it, same
   level) or {group: id} (top tasks of that group) */
export function paste(T, where) {
  const clip = readClip();
  if (!clip || !clip.items || !clip.items.length) { toast("Nothing copied yet - choose tasks and press Ctrl+C", true); return; }
  if (!T.canEdit()) { toast("You can only look at this list", true); return; }
  const S = T.S;
  let parent = null, group = "", sort0, sortStep = 1;
  if (where.parent) {
    parent = where.parent;
    group = parent.group_id;
    sort0 = T.children(parent.id).reduce((m, k) => Math.max(m, k.sort), 0) + 1;
  } else if (where.after) {
    const a = where.after;
    parent = a.parent_id ? T.task(a.parent_id) : null;
    group = a.group_id;
    const sibs = (parent ? T.children(parent.id) : [...S.tasks.values()].filter((t) => !t.parent_id && t.group_id === a.group_id))
      .sort((x, y) => x.sort - y.sort);
    const next = sibs[sibs.findIndex((x) => x.id === a.id) + 1];
    sort0 = next ? a.sort + (next.sort - a.sort) / (clip.items.length + 1) : a.sort + 1;
    sortStep = next ? (next.sort - a.sort) / (clip.items.length + 1) : 1;
  } else {
    group = where.group || "";
    sort0 = [...S.tasks.values()].filter((t) => !t.parent_id && t.group_id === group).reduce((m, k) => Math.max(m, k.sort), 0) + 1;
  }
  const depth0 = parent ? T.depth(parent.id) + 1 : 0;
  if (depth0 + height(clip.items) > T.MAX_DEPTH) {
    toast(`Too deep: sub-tasks go ${T.MAX_DEPTH} levels at most`, true);
    return;
  }
  // custom fields: the same list as is; another list's by name and type
  const here = T.fields();
  const map = {};
  for (const f of clip.fields || []) {
    const g = clip.list === S.listId ? here.find((x) => x.id === f.id)
      : here.find((x) => x.name.trim().toLowerCase() === f.name.trim().toLowerCase() && x.type === f.type);
    if (g) map[f.id] = g.id;
  }
  const completers = T.fieldNamed("task completers");
  let dropped = 0;
  const rows = [], tops = [];
  const add = (it, pid, sort) => {
    const id = uid();
    const vals = {};
    for (const [k, v] of Object.entries(it.vals || {})) {
      if (!map[k]) { if (v !== "" && v != null && !(Array.isArray(v) && !v.length)) dropped++; continue; }
      if (completers && map[k] === completers.id) continue;      // a fresh copy: nobody has finished it
      vals[map[k]] = v;
    }
    rows.push({ id, parent_id: pid, group_id: group, title: it.title || "", description: it.description || "",
                priority: it.priority || "", start: it.start || "", due: it.due || "", owners: it.owners || [],
                vals, links: it.links || [], sort });
    (it.kids || []).forEach((k, i) => add(k, id, i + 1));
    return id;
  };
  clip.items.forEach((it, i) => tops.push(add(it, parent ? parent.id : "", sort0 + i * sortStep)));
  const n = rows.length;
  T.createMany(rows, tops, `pasted ${n} task${n === 1 ? "" : "s"}`);
  if (parent) S.expanded.add(parent.id);
  for (const r of rows) if (rows.some((x) => x.parent_id === r.id)) S.expanded.add(r.id);
  S.picked.clear();
  T.render();
  toast(`Pasted ${n} task${n === 1 ? "" : "s"}` + (parent ? ` under "${parent.title || "task"}"` : "")
    + (dropped ? ` - ${dropped} custom field value${dropped === 1 ? "" : "s"} this list has no field for left out` : ""), !!dropped);
}

/* ------------------------------------------------------------ the menu */

export function menu(T, ev, t, bucket) {
  ev.preventDefault();
  const S = T.S;
  if (t && !S.picked.has(t.id) && S.picked.size) { S.picked.clear(); T.render(); }
  const sel = t && S.picked.has(t.id) ? chosen(T) : t ? [t] : [];
  const clip = readClip();
  const n = clip && clip.items ? count(clip.items) : 0;
  const ed = T.canEdit();
  const name = (x) => esc(`"${(x.title || "task").slice(0, 30)}"`);
  let h = "";
  if (sel.length) h += `<div class="po-row" data-c="copy">Copy ${sel.length > 1 ? sel.length + " tasks" : name(sel[0])}${sel.some((x) => T.children(x.id).length) ? " with sub-tasks" : ""}</div>`;
  if (ed && n && t) {
    h += `<div class="po-row" data-c="sub">Paste ${n} as sub-task${n === 1 ? "" : "s"} of ${name(t)}</div>`
      + `<div class="po-row" data-c="after">Paste ${n} below ${name(t)}</div>`;
  }
  if (ed && n && bucket && bucket.group) h += `<div class="po-row" data-c="group">Paste ${n} task${n === 1 ? "" : "s"} into ${esc(bucket.group.title)}</div>`;
  if (!h) h = `<div class="muted" style="padding:8px">${ed ? "Copy a task first (right-click it > Copy, or Ctrl+C)" : "You can only look at this list"}</div>`;
  const at = { getBoundingClientRect: () => ({ left: ev.clientX, right: ev.clientX, top: ev.clientY, bottom: ev.clientY }) };
  const box = pop(at, h, 300);
  box.onclick = (e) => {
    const b = e.target.closest("[data-c]");
    if (!b) return;
    closePop();
    const c = b.dataset.c;
    if (c === "copy") copy(T, sel);
    else if (c === "sub") paste(T, { parent: t });
    else if (c === "after") paste(T, { after: t });
    else if (c === "group") paste(T, { group: bucket.group.id });
  };
}

/* ------------------------------------------------------------ keys */

const typing = (el) => el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
export function keys(T) {
  document.addEventListener("keydown", (ev) => {
    if (typing(ev.target) || typing(document.activeElement)) return;
    if (ev.key === "Escape" && T.S.picked.size) { T.S.picked.clear(); T.render(); return; }
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
    const k = ev.key.toLowerCase();
    if (k === "c") {
      if (String(getSelection() || "").trim()) return;    // copying text on the page
      if (!T.S.picked.size && !T.S.openId) return;
      ev.preventDefault();
      copy(T);
    } else if (k === "v") {
      const S = T.S;
      const target = S.picked.size === 1 ? T.task([...S.picked][0]) : !S.picked.size && S.openId ? T.task(S.openId) : null;
      if (!target) { if (readClip()) toast("Choose one task to paste under, or right-click a task or group", true); return; }
      ev.preventDefault();
      paste(T, { parent: target });
    }
  });
}
