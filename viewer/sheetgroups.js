/* The Sheets list in groups (topics), and sheets hidden from the viewer.
 * Members make the groups (Groups ▾, or right-click a sheet > Move to group);
 * everyone folds them for themselves (kept in this browser) and can show one
 * group only. Admins hide sheets they do not want in the viewer: a hidden
 * sheet stays hidden after the next publish from Revit; admins still see it,
 * dimmed, under Hidden, to bring it back - or delete it for good from
 * there (Hidden is the recycle bin). Sheets are put in order by dragging
 * (or Move up / Move down); a group keeps its own order, the sheets in no
 * group keep theirs per set. Kept on the server in the project's
 * sheet_meta.json (GET / PUT /api/sheet-meta). */
import * as Store from "./store.js";
import { openMenu } from "./ctxmenu.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const M = { hidden: {}, groups: [], order: {}, can_hide: false, can_group: false, loaded: false };
let CTX = null;

async function call(method, path, body) {
  const r = await fetch(path, { method, headers: Object.assign({ "Content-Type": "application/json" }, Store.authHeaders()),
                                body: body ? JSON.stringify(body) : undefined });
  let d = null;
  try { d = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error((d && d.detail) || "HTTP " + r.status);
  return d;
}

export async function load() {
  try {
    const d = await call("GET", "/api/sheet-meta");
    Object.assign(M, { hidden: d.hidden || {}, groups: d.groups || [], order: d.order || {}, can_hide: !!d.can_hide, can_group: !!d.can_group, loaded: true });
  } catch (e) { M.loaded = false; }
  return M;
}

export const canGroup = () => M.can_group;
export const canHide = () => M.can_hide;
export const canPick = () => M.can_group || M.can_hide;

/* ------------------------------------------------------------ folding */

const foldKey = () => `lwk.sheetfold.${Store.currentProject() || ""}.${CTX ? CTX.set() : ""}`;
function folds() {
  try { return JSON.parse(localStorage.getItem(foldKey()) || "{}") || {}; } catch (e) { return {}; }
}
function setFolds(f) {
  try { localStorage.setItem(foldKey(), JSON.stringify(f)); } catch (e) {}
}
export function isFolded(id) {
  const f = folds();
  return id in f ? !!f[id] : id === "_hidden";        // Hidden starts folded
}
function toggle(id) {
  const f = folds();
  f[id] = !isFolded(id);
  setFolds(f);
  CTX.render();
}
function only(id, secs) {
  const f = {};
  for (const s of secs) f[s.id] = s.id !== id;
  setFolds(f);
  CTX.render();
}
function all(secs) {
  const f = {};
  for (const s of secs) f[s.id] = s.id === "_hidden";
  setFolds(f);
  CTX.render();
}

/* ------------------------------------------------------------ the sections */

/* The set's sheets in sections: each group (in its order), the rest under
   Other, and (admins) Hidden. null when the set has no groups and nothing
   hidden: the plain list. */
/* The sheets in no group, in their saved order (those not in it after, as
   the list has them). */
export function ordered(list) {
  const ord = M.order[CTX.set()] || [];
  if (!ord.length) return list;
  const at = new Map(ord.map((n, i) => [String(n), i]));
  const idx = new Map(list.map((s, i) => [s, i]));
  const key = (s) => (at.has(String(s.number)) ? at.get(String(s.number)) : ord.length + idx.get(s));
  return list.slice().sort((a, b) => key(a) - key(b));
}

export function sections(list) {
  const set = CTX.set();
  const groups = M.groups.filter((g) => (g.set || "") === set);
  const hidden = list.filter((s) => s.hidden);
  if (!groups.length && !hidden.length) return null;
  const shown = list.filter((s) => !s.hidden);
  const by = new Map(shown.map((s) => [String(s.number), s]));
  const used = new Set();
  const out = [];
  for (const g of groups) {
    // the group's sheets in the group's own order (as dragged, or moved up / down)
    const sh = (g.sheets || []).map((n) => by.get(String(n))).filter(Boolean);
    sh.forEach((s) => used.add(String(s.number)));
    out.push({ id: g.id, name: g.name, sheets: sh, kind: "group" });
  }
  const rest = ordered(shown.filter((s) => !used.has(String(s.number))));
  if (rest.length || !groups.length) out.push({ id: "_other", name: groups.length ? "Other" : "Sheets", sheets: rest, kind: "other" });
  if (hidden.length) out.push({ id: "_hidden", name: "Hidden from the viewer", sheets: hidden, kind: "hidden" });
  return out;
}

export function head(sec, secs) {
  const li = document.createElement("li");
  li.className = "sg-head" + (sec.kind === "hidden" ? " sg-hid" : "");
  li.dataset.sg = sec.id;
  const shut = isFolded(sec.id);
  li.innerHTML = `<span class="sg-tri">${shut ? "&#9656;" : "&#9662;"}</span><b>${esc(sec.name)}</b> <span class="count-chip">${sec.sheets.length}</span>`
    + `<span class="spacer"></span><button type="button" class="ghost sm sg-more" title="Show only this group, show all${M.can_group && sec.kind === "group" ? ", rename, move or delete the group" : ""}" aria-label="Group menu">&#8943;</button>`;
  li.addEventListener("click", (ev) => {
    if (ev.target.closest(".sg-more")) return;
    toggle(sec.id);
  });
  li.querySelector(".sg-more").addEventListener("click", (ev) => {
    ev.stopPropagation();
    const r = ev.currentTarget.getBoundingClientRect();
    const i = M.groups.findIndex((g) => g.id === sec.id);
    openMenu(r.left, r.bottom + 4, [
      { label: "Show only this group", action: () => only(sec.id, secs) },
      { label: "Show all groups", action: () => all(secs) },
      ...(M.can_group && sec.kind === "group" ? ["-",
        { label: "Rename group ...", action: () => renameGroup(sec.id) },
        { label: "Move up", disabled: i <= 0, action: () => moveGroup(sec.id, -1) },
        { label: "Move down", disabled: i < 0 || i >= M.groups.length - 1, action: () => moveGroup(sec.id, 1) },
        { label: "Delete group (its sheets go to Other)", danger: true, action: () => deleteGroup(sec.id) }] : []),
      ...(M.can_hide && sec.kind === "hidden" ? ["-", { label: `Unhide all ${sec.sheets.length}`, action: () => hide(sec.sheets.map((s) => s.number), false) },
        { label: `Delete all ${sec.sheets.length} from the server ...`, danger: true, action: () => deleteForGood(sec.sheets.map((s) => s.number)) }] : []),
    ]);
  });
  return li;
}

/* ------------------------------------------------------------ changes */

/* A change shows at once (the list in memory is updated, nothing is read
   again) and is saved behind it; quick changes are saved one after another,
   each with the whole list, so the last one wins. Reading the whole sheet
   list again after every move kept a big project's server busy for
   seconds each time - after a few, the viewer showed Offline. */
let saving = Promise.resolve();
function saveGroups(groups, note) {
  M.groups = groups;
  show();
  if (note) CTX.status(note);
  if (CTX.afterAction) CTX.afterAction();
  saving = saving.then(async () => {
    try {
      const d = await call("PUT", "/api/sheet-meta/groups", { groups });
      if (M.groups === groups) { M.groups = d.groups || groups; show(); }
    } catch (e) {
      CTX.status("Not saved: " + e.message + " - the list is shown as the server has it");
      await load();
      await CTX.reload();
    }
  });
  return saving;
}

/* the groups and hidden sheets onto the sheet list already on the page */
function show() {
  if (CTX.apply) CTX.apply({ hidden: M.hidden, groups: M.groups });
  else CTX.render();
}

const newId = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 12);

export async function newGroup(numbers) {
  const name = (prompt("Name of the new group (a topic, e.g. Plans, Elevations, Sections):", "") || "").trim();
  if (!name) return;
  const nums = (numbers || []).map(String);
  const groups = M.groups.map((g) => Object.assign({}, g, { sheets: (g.sheets || []).filter((n) => !nums.includes(String(n))) }));
  groups.push({ id: newId(), name, set: CTX.set(), sheets: nums });
  await saveGroups(groups, `Group "${name}" made${nums.length ? ` with ${nums.length} sheet(s)` : " - fill it with ☰ > Move / hide sheets, or drag sheets onto it"}.`);
}

async function moveTo(numbers, gid) {
  const nums = inListOrder(numbers);
  const groups = M.groups.map((g) => Object.assign({}, g, { sheets: (g.sheets || []).filter((n) => !nums.includes(String(n))) }));
  const g = groups.find((x) => x.id === gid);
  if (g) g.sheets = g.sheets.concat(nums);
  await saveGroups(groups, g ? `${nums.length} sheet(s) moved to "${g.name}".` : `${nums.length} sheet(s) moved to Other.`);
}

async function renameGroup(id) {
  const g = M.groups.find((x) => x.id === id);
  const to = g && (prompt("New name of the group:", g.name) || "").trim();
  if (!to || to === g.name) return;
  await saveGroups(M.groups.map((x) => (x.id === id ? Object.assign({}, x, { name: to }) : x)), `Group renamed to "${to}".`);
}

async function moveGroup(id, by) {
  const gs = M.groups.slice();
  const i = gs.findIndex((x) => x.id === id), j = i + by;
  if (i < 0 || j < 0 || j >= gs.length) return;
  [gs[i], gs[j]] = [gs[j], gs[i]];
  await saveGroups(gs);
}

async function deleteGroup(id) {
  const g = M.groups.find((x) => x.id === id);
  if (!g || !confirm(`Delete the group "${g.name}"?\n\nIts ${(g.sheets || []).length} sheet(s) go to Other; no sheet is deleted.`)) return;
  await saveGroups(M.groups.filter((x) => x.id !== id), `Group "${g.name}" deleted.`);
}

/* ------------------------------------------------------------ order */

// numbers in the order the list shows them (a choice made by clicking, put in order)
function inListOrder(numbers) {
  const want = new Set(numbers.map(String));
  const all = CTX.list ? CTX.list().map((s) => String(s.number)) : [];
  const out = all.filter((n) => want.has(n));
  for (const n of want) if (!out.includes(n)) out.push(n);
  return out;
}

// the sheets in no group (not hidden), in the order they are shown
function otherOrder(groups) {
  const set = CTX.set();
  const inG = new Set(groups.filter((g) => (g.set || "") === set).flatMap((g) => (g.sheets || []).map(String)));
  return ordered((CTX.list ? CTX.list() : []).filter((s) => !s.hidden && !inG.has(String(s.number)))).map((s) => String(s.number));
}

let savingOrder = Promise.resolve();
function saveOrder(numbers) {
  const set = CTX.set();
  M.order = Object.assign({}, M.order, { [set]: numbers });
  show();
  savingOrder = savingOrder.then(() => call("PUT", "/api/sheet-meta/order", { set, numbers })
    .catch((e) => CTX.status("Order not saved: " + e.message)));
  return savingOrder;
}

/* Sheets dropped on a sheet (before it, or after it): into its group (or
   out of any, when it is in none), in that place. */
export function dropSheets(numbers, target, after) {
  const nums = inListOrder(numbers);
  target = String(target);
  if (nums.includes(target) || !M.can_group) return;
  const set = CTX.set();
  const groups = M.groups.map((g) => Object.assign({}, g, { sheets: (g.sheets || []).map(String).filter((n) => !nums.includes(n)) }));
  const tg = groups.find((g) => (g.set || "") === set && g.sheets.includes(target));
  const moved = M.groups.some((g) => (g.sheets || []).some((n) => nums.includes(String(n))));
  const what = nums.length > 1 ? `${nums.length} sheets` : `"${nums[0]}"`;
  if (tg) {
    tg.sheets.splice(tg.sheets.indexOf(target) + (after ? 1 : 0), 0, ...nums);
    return saveGroups(groups, `${what} put ${after ? "after" : "before"} "${target}" in "${tg.name}".`);
  }
  const rest = otherOrder(groups).filter((n) => !nums.includes(n));
  const i = rest.indexOf(target);
  rest.splice(i < 0 ? rest.length : i + (after ? 1 : 0), 0, ...nums);
  if (moved) saveGroups(groups);
  CTX.status(`${what} put ${after ? "after" : "before"} "${target}".`);
  return saveOrder(rest);
}

/* Sheets dropped on a section's heading: to the end of that group (or Other). */
export function dropOnSection(numbers, secId) {
  if (secId === "_hidden") return hide(numbers, true);
  const nums = inListOrder(numbers);
  if (secId === "_other") return moveTo(nums, null);
  return moveTo(nums, secId);
}

/* one place up or down within its section */
function step(s, by) {
  const n = String(s.number);
  const set = CTX.set();
  const g = M.groups.find((x) => (x.set || "") === set && (x.sheets || []).map(String).includes(n));
  if (g) {
    const arr = g.sheets.map(String), i = arr.indexOf(n), j = i + by;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return saveGroups(M.groups.map((x) => (x === g ? Object.assign({}, x, { sheets: arr }) : x)));
  }
  const arr = otherOrder(M.groups), i = arr.indexOf(n), j = i + by;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  return saveOrder(arr);
}

/* Hidden is the recycle bin: from there, deleted for good (admins). */
export async function deleteForGood(numbers) {
  const nums = numbers.map(String).filter((n) => n in M.hidden);
  if (!nums.length) { CTX.status("Only hidden sheets can be deleted: hide them first (they go to Hidden, the recycle bin)."); return; }
  const what = nums.length > 1 ? `${nums.length} sheets` : `the sheet "${nums[0]}"`;
  if (!confirm(`Delete ${what} from the server for good?\n\n${nums.slice(0, 12).join(", ")}${nums.length > 12 ? " ..." : ""}\n\n`
    + "Their PDF is removed and they do not come back, not even with the next publish from Revit. "
    + "Markups and issues on them are kept in the project, with no sheet to show on.\n\nThis cannot be undone.")) return;
  try {
    const d = await call("POST", "/api/sheet-meta/delete", { numbers: nums });
    await load();
    await CTX.reload();
    CTX.status(`${d.deleted} sheet(s) deleted from the server.`);
    if (CTX.afterAction) CTX.afterAction();
  } catch (e) { CTX.status("Not deleted: " + e.message); }
}

export async function hide(numbers, on) {
  if (!numbers.length) return;
  if (on && !confirm(`Hide ${numbers.length} sheet(s) from the viewer?\n\nNobody but admins sees them, and they stay hidden after the next publish from Revit. Admins find them under "Hidden from the viewer" to bring them back. Their markups and issues are kept.`)) return;
  try {
    await call("PUT", "/api/sheet-meta/hidden", { numbers, hide: on });
    const h = Object.assign({}, M.hidden);
    for (const n of numbers) { if (on) h[String(n)] = { at: new Date().toISOString() }; else delete h[String(n)]; }
    M.hidden = h;
    show();
    if (CTX.afterAction) CTX.afterAction();
    CTX.status(`${numbers.length} sheet(s) ${on ? "hidden from the viewer" : "shown again"}.`);
  } catch (e) { CTX.status("Not done: " + e.message); }
}

/* right-click a sheet (or the sheets chosen with Select) */
export function sheetMenu(ev, s, chosen) {
  if (!M.can_group && !M.can_hide) return;
  ev.preventDefault();
  // with sheets ticked (Move / hide sheets): all of them, the one clicked too
  const nums = chosen && chosen.length ? [...new Set(chosen.concat([s.number]))] : [s.number];
  const set = CTX.set();
  const groups = M.groups.filter((g) => (g.set || "") === set);
  const n = nums.length > 1 ? `${nums.length} sheets` : `"${s.number}"`;
  openMenu(ev.clientX, ev.clientY, [
    ...(M.can_group ? [
      ...groups.map((g) => ({ label: `Move ${esc(n)} to ${esc(g.name)}`, action: () => moveTo(nums, g.id) })),
      { label: `Move ${esc(n)} to a new group ...`, action: () => newGroup(nums) },
      ...(groups.length ? [{ label: `Move ${esc(n)} to Other (no group)`, action: () => moveTo(nums, null) }] : []),
    ] : []),
    ...(M.can_group && nums.length === 1 && !s.hidden ? ["-",
      { label: "Move up", action: () => step(s, -1) },
      { label: "Move down", action: () => step(s, 1) }] : []),
    ...(M.can_hide ? ["-", s.hidden
      ? { label: `Show ${esc(n)} in the viewer again`, action: () => hide(nums, false) }
      : { label: `Hide ${esc(n)} from the viewer ...`, danger: true, action: () => hide(nums, true) }] : []),
    ...(M.can_hide && s.hidden ? [{ label: `Delete ${esc(n)} from the server ...`, danger: true, action: () => deleteForGood(nums) }] : []),
  ]);
}

/* Groups ▾ in the Sheets heading */
export function groupsMenu(btn, list) {
  const r = btn.getBoundingClientRect();
  const set = CTX.set();
  const secs = sections(list) || [];
  openMenu(r.left, r.bottom + 4, [
    ...(M.can_group ? [
      { label: "New group ...", action: () => newGroup([]) },
      { label: "Move / hide sheets", action: () => CTX.startPick() },
    ] : []),
    ...(secs.length ? ["-", { label: "Show all groups", action: () => all(secs) }, { label: "Fold all groups", action: () => { const f = {}; secs.forEach((x) => { f[x.id] = true; }); setFolds(f); CTX.render(); } }] : []),
    ...(!M.can_group && !secs.length ? [{ label: "No groups in this set yet - a project member can make them", disabled: true, action: () => {} }] : []),
  ]);
  void set;
}

export function init(ctx) {
  CTX = ctx;
  return load();
}
