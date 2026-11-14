/* Saved markup styles and palette colours.

   "Mine" follow the person to every device they sign in on (/api/me/styles);
   the project's are kept by its admins for everyone on it (/api/styles).
   Without accounts, or before the server answers, a copy on this device is
   used, so the lists show at once and work offline.

   A style is { id, name, type, style } - type is the markup it was saved
   from (for its icon); style holds the look: color, fill, tcolor, fillop,
   width, dash, font, size, align. */

import { api } from "./nav.js";

const CACHE = "lwk-viewer:my-styles";
const TEAM_CACHE = "lwk-viewer:team-styles:";
const empty = () => ({ styles: [], colours: [] });

let mine = readLocal(CACHE) || empty();
let team = Object.assign(empty(), { admin: false });
let local = false;            // no account: mine live on this device only
let loading = null;
const subs = new Set();

function readLocal(k) {
  try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v && Array.isArray(v.styles) ? v : null; }
  catch (e) { return null; }
}
function writeLocal(k, v) {
  try { localStorage.setItem(k, JSON.stringify({ styles: v.styles, colours: v.colours })); } catch (e) {}
}
function projectId() {
  return new URLSearchParams(location.search).get("project") || (() => {
    try { return sessionStorage.getItem("lwk-viewer:tab-project") || localStorage.getItem("lwk-viewer:project") || ""; }
    catch (e) { return ""; }
  })();
}
function emit() { for (const f of subs) { try { f(); } catch (e) { console.error(e); } } }

export function onChange(f) { subs.add(f); return () => subs.delete(f); }
export function lists() { return { mine, team, local }; }

export function load(again) {
  if (loading && !again) return loading;
  const pid = projectId();
  const cached = pid && readLocal(TEAM_CACHE + pid);
  if (cached) team = Object.assign(team, cached);
  loading = Promise.all([
    api("/api/me/styles").then((r) => { mine = r; local = false; writeLocal(CACHE, mine); })
      .catch((e) => { if (e.status === 401 || e.status === 404) local = true; }),
    pid ? api("/api/styles").then((r) => { team = r; writeLocal(TEAM_CACHE + pid, r); }).catch(() => {}) : Promise.resolve(),
  ]).then(emit);
  emit();
  return loading;
}

async function saveMine(next) {
  mine = next;
  writeLocal(CACHE, mine);
  emit();
  if (local) return;
  try { mine = await api("/api/me/styles", { method: "PUT", body: JSON.stringify(next) }); writeLocal(CACHE, mine); emit(); }
  catch (e) { if (e.status === 401) local = true; else throw e; }
}
async function saveTeam(next) {
  const r = await api("/api/styles", { method: "PUT", body: JSON.stringify(next) });
  team = r;
  const pid = projectId();
  if (pid) writeLocal(TEAM_CACHE + pid, r);
  emit();
}
const list = (isTeam) => (isTeam ? team : mine);
const save = (isTeam, next) => (isTeam ? saveTeam(next) : saveMine(next));
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function addStyle(name, type, style, isTeam) {
  const L = list(isTeam);
  return save(isTeam, { styles: [...L.styles, { id: newId(), name, type: type || "", style }], colours: L.colours });
}
export function updateStyle(id, patch, isTeam) {
  const L = list(isTeam);
  return save(isTeam, { styles: L.styles.map((s) => (s.id === id ? Object.assign({}, s, patch) : s)), colours: L.colours });
}
export function removeStyle(id, isTeam) {
  const L = list(isTeam);
  return save(isTeam, { styles: L.styles.filter((s) => s.id !== id), colours: L.colours });
}
export function addColour(c, isTeam) {
  c = String(c || "").toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(c)) return Promise.resolve();
  const L = list(isTeam);
  if (L.colours.includes(c)) return Promise.resolve();
  return save(isTeam, { styles: L.styles, colours: [...L.colours, c].slice(-60) });
}
export function removeColour(c, isTeam) {
  const L = list(isTeam);
  return save(isTeam, { styles: L.styles, colours: L.colours.filter((x) => x !== c) });
}
