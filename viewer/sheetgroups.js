/* The Sheets list in groups (topics), and sheets hidden from the viewer.
 * Members make the groups (Groups ▾, or right-click a sheet > Move to group);
 * everyone folds them for themselves (kept in this browser) and can show one
 * group only. Admins hide sheets they do not want in the viewer: a hidden
 * sheet stays hidden after the next publish from Revit; admins still see it,
 * dimmed, under Hidden, to bring it back. Kept on the server in the
 * project's sheet_meta.json (GET / PUT /api/sheet-meta). */
import * as Store from "./store.js";
import { openMenu } from "./ctxmenu.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const M = { hidden: {}, groups: [], can_hide: false, can_group: false, loaded: false };
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
    Object.assign(M, { hidden: d.hidden || {}, groups: d.groups || [], can_hide: !!d.can_hide, can_group: !!d.can_group, loaded: true });
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
    const sh = (g.sheets || []).map((n) => by.get(String(n))).filter(Boolean);
    sh.forEach((s) => used.add(String(s.number)));
    // the group's sheets in the list's own order
    sh.sort((a, b) => shown.indexOf(a) - shown.indexOf(b));
    out.push({ id: g.id, name: g.name, sheets: sh, kind: "group" });
  }
  const rest = shown.filter((s) => !used.has(String(s.number)));
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
      ...(M.can_hide && sec.kind === "hidden" ? ["-", { label: `Unhide all ${sec.sheets.length}`, action: () => hide(sec.sheets.map((s) => s.number), false) }] : []),
    ]);
  });
  return li;
}

/* ------------------------------------------------------------ changes */

async function saveGroups(groups, note) {
  try {
    const d = await call("PUT", "/api/sheet-meta/groups", { groups });
    M.groups = d.groups || [];
    await CTX.reload();
    if (note) CTX.status(note);
  } catch (e) { CTX.status("Not saved: " + e.message); }
}

const newId = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 12);

export async function newGroup(numbers) {
  const name = (prompt("Name of the new group (a topic, e.g. Plans, Elevations, Sections):", "") || "").trim();
  if (!name) return;
  const nums = (numbers || []).map(String);
  const groups = M.groups.map((g) => Object.assign({}, g, { sheets: (g.sheets || []).filter((n) => !nums.includes(String(n))) }));
  groups.push({ id: newId(), name, set: CTX.set(), sheets: nums });
  await saveGroups(groups, `Group "${name}" made${nums.length ? ` with ${nums.length} sheet(s)` : " - right-click sheets > Move to group to fill it"}.`);
}

async function moveTo(numbers, gid) {
  const nums = numbers.map(String);
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

/* groups from the sheet numbers: A-101, A-102 ... -> "A-1xx" */
export async function groupsFromNumbers(list) {
  const key = (n) => {
    const m = /^(.*?)(\d)/.exec(String(n));
    return m ? m[1] + m[2] : String(n).replace(/\W.*$/, "") || "Other";
  };
  const by = new Map();
  for (const s of list.filter((x) => !x.hidden)) {
    const k = key(s.number);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(String(s.number));
  }
  if (by.size < 2) { alert("The sheet numbers here do not fall into groups by their beginning (A-1.., A-2.. ...). Make the groups by hand: Groups ▾ > New group."); return; }
  if (!confirm(`Make ${by.size} groups from the sheet numbers?\n\n${[...by].map(([k, v]) => `${k}xx - ${v.length} sheet(s)`).join("\n")}\n\nThe groups this set has now are replaced. You can rename and change them afterwards.`)) return;
  const set = CTX.set();
  const keep = M.groups.filter((g) => (g.set || "") !== set);
  await saveGroups(keep.concat([...by].map(([k, v]) => ({ id: newId(), name: k + "xx", set, sheets: v }))), `${by.size} groups made from the sheet numbers.`);
}

export async function hide(numbers, on) {
  if (!numbers.length) return;
  if (on && !confirm(`Hide ${numbers.length} sheet(s) from the viewer?\n\nNobody but admins sees them, and they stay hidden after the next publish from Revit. Admins find them under "Hidden from the viewer" to bring them back. Their markups and issues are kept.`)) return;
  try {
    await call("PUT", "/api/sheet-meta/hidden", { numbers, hide: on });
    await load();
    await CTX.reload();
    CTX.status(`${numbers.length} sheet(s) ${on ? "hidden from the viewer" : "shown again"}.`);
  } catch (e) { CTX.status("Not done: " + e.message); }
}

/* right-click a sheet (or the sheets chosen with Select) */
export function sheetMenu(ev, s, chosen) {
  if (!M.can_group && !M.can_hide) return;
  ev.preventDefault();
  const nums = chosen && chosen.length && chosen.includes(s.number) ? chosen : [s.number];
  const set = CTX.set();
  const groups = M.groups.filter((g) => (g.set || "") === set);
  const n = nums.length > 1 ? `${nums.length} sheets` : `"${s.number}"`;
  openMenu(ev.clientX, ev.clientY, [
    ...(M.can_group ? [
      ...groups.map((g) => ({ label: `Move ${esc(n)} to ${esc(g.name)}`, action: () => moveTo(nums, g.id) })),
      { label: `Move ${esc(n)} to a new group ...`, action: () => newGroup(nums) },
      ...(groups.length ? [{ label: `Move ${esc(n)} to Other (no group)`, action: () => moveTo(nums, null) }] : []),
    ] : []),
    ...(M.can_hide ? ["-", s.hidden
      ? { label: `Show ${esc(n)} in the viewer again`, action: () => hide(nums, false) }
      : { label: `Hide ${esc(n)} from the viewer ...`, danger: true, action: () => hide(nums, true) }] : []),
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
      { label: "Make groups from the sheet numbers ...", action: () => groupsFromNumbers(list) },
      { label: "Select sheets ... (to move or hide several)", action: () => CTX.startPick() },
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
