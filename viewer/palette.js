/* Colour palette for markup colours.

   A small palette button beside a colour input opens a panel of standard
   colours and the ones used most recently, so the same red is the same red
   on every markup without retyping it. Choosing a colour sets the input and
   fires its input and change events, so the page reacts exactly as if the
   user had picked it in the browser's own colour picker. Recent colours are
   shared between the sheets page and the 3D snapshot editor.
 */

import * as Styles from "./styles.js";

const STANDARD = [
  "#ff3b30", "#f28022", "#ffcc00", "#34c759", "#00a3a3", "#007aff",
  "#5856d6", "#af52de", "#ff2d92", "#8e5a2b", "#000000", "#595959",
  "#a6a6a6", "#ffffff",
];
const RECENT_KEY = "lwk-viewer:recent-colours";
const MAX_RECENT = 7;

function recent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); }
  catch (e) { return []; }
}
function remember(c) {
  c = String(c || "").toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(c)) return;
  const list = [c, ...recent().filter((x) => x !== c)].slice(0, MAX_RECENT);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) {}
}

let open = null;
function close() {
  if (open) { open.remove(); open = null; }
}
document.addEventListener("pointerdown", (ev) => {
  if (open && !open.contains(ev.target) && !ev.target.closest(".palbtn")) close();
}, true);
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });

function swatchRow(colors, onPick) {
  const row = document.createElement("div");
  row.className = "pal-row";
  for (const c of colors) {
    const b = document.createElement("button");
    b.className = "pal-sw";
    b.style.background = c;
    b.title = c;
    b.addEventListener("click", () => onPick(c));
    row.appendChild(b);
  }
  return row;
}

/* the grid: ten hues, dark to light, then greys */
const HUES = [0, 24, 42, 56, 130, 168, 196, 218, 262, 322];
const hsl = (h, s, l) => {
  s /= 100; l /= 100;
  const f = (n) => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0"); };
  return "#" + f(0) + f(8) + f(4);
};
const GRID = [30, 45, 62, 80].flatMap((l) => HUES.map((h) => hsl(h, l > 70 ? 80 : 85, l)));
const GREYS = ["#000000", "#262626", "#404040", "#595959", "#737373", "#8c8c8c", "#a6a6a6", "#bfbfbf", "#d9d9d9", "#ffffff"];

function heading(text) {
  const h = document.createElement("div");
  h.className = "pal-h";
  h.textContent = text;
  return h;
}
function fail(e) { console.warn("palette", e); }

/* A row of colours someone added (theirs or the project's): x takes one off,
   + adds the colour now in the box. */
function customRow(colors, onPick, canEdit, isTeam, input) {
  const row = swatchRow(colors, onPick);
  row.classList.add("pal-own");
  if (!canEdit) return row;
  [...row.children].forEach((b, i) => {
    const x = document.createElement("span");
    x.className = "pal-x"; x.textContent = "×"; x.title = "Take off the palette";
    x.addEventListener("click", (ev) => { ev.stopPropagation(); Styles.removeColour(colors[i], isTeam).catch(fail); });
    b.appendChild(x);
    b.addEventListener("contextmenu", (ev) => { ev.preventDefault(); Styles.removeColour(colors[i], isTeam).catch(fail); });
  });
  const add = document.createElement("button");
  add.type = "button"; add.className = "pal-add"; add.textContent = "+";
  add.title = "Add the colour now in the box (" + input.value + ")" + (isTeam ? " for everyone on the project" : "");
  add.addEventListener("click", () => Styles.addColour(input.value, isTeam).catch(fail));
  row.appendChild(add);
  return row;
}

function show(input, anchor) {
  close();
  const pick = (c) => {
    input.value = c;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    remember(c);
    close();
  };
  const pop = document.createElement("div");
  pop.className = "pal-pop";
  const fill = () => {
    pop.innerHTML = "";
    const { mine, team } = Styles.lists();
    pop.append(heading("Standard"), swatchRow(STANDARD, pick), swatchRow(GRID, pick), swatchRow(GREYS, pick));
    if (team.colours.length || team.admin) pop.append(heading("Project colours"), customRow(team.colours, pick, team.admin, true, input));
    pop.append(heading("My colours"), customRow(mine.colours, pick, true, false, input));
    // a colour typed by its code (kept in My colours)
    const typed = document.createElement("div");
    typed.className = "pal-type";
    typed.innerHTML = '<input type="text" maxlength="7" placeholder="#rrggbb" aria-label="Colour code"><button type="button">Use</button>';
    const [tin, tb] = typed.children;
    const use = () => {
      let v = tin.value.trim().toLowerCase();
      if (!v.startsWith("#")) v = "#" + v;
      if (/^#[0-9a-f]{6}$/.test(v)) { Styles.addColour(v, false).catch(fail); pick(v); } else tin.classList.add("bad");
    };
    tb.addEventListener("click", use);
    tin.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") { ev.preventDefault(); use(); } });
    pop.appendChild(typed);
    const r = recent();
    if (r.length) pop.append(heading("Recent"), swatchRow(r, pick));
  };
  const placePop = () => {
    const a = anchor.getBoundingClientRect();
    pop.style.maxHeight = (innerHeight - 12) + "px";
    const w = pop.offsetWidth, h = Math.min(pop.scrollHeight, innerHeight - 12);
    pop.style.left = Math.max(6, Math.min(innerWidth - w - 6, a.left)) + "px";
    pop.style.top = Math.max(6, a.bottom + h + 6 < innerHeight ? a.bottom + 4 : Math.min(a.top - h - 4, innerHeight - h - 6)) + "px";
  };
  fill();
  document.body.appendChild(pop);
  placePop();
  open = pop;
  const off = Styles.onChange(() => { if (open === pop) { fill(); placePop(); } else off(); });
  Styles.load();
}

/* Put a palette button right after a colour input (inside its label, if it
   has one). Safe to call twice on the same input. */
export function attachPalette(input) {
  if (!input || input.dataset.palette) return;
  input.dataset.palette = "1";
  const b = document.createElement("button");
  b.type = "button";
  b.className = "palbtn";
  b.title = "Colours: standard, the project's, yours and recent";
  b.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" '
    + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M12 3a9 9 0 100 18c1 0 1.5-.8 1.5-1.6 0-.9-.7-1.4-.7-2.3 0-1 .8-1.6 1.8-1.6H17a4 4 0 004-4c0-4.7-4-8.5-9-8.5z"/>'
    + '<circle cx="7.5" cy="11" r=".8"/><circle cx="10" cy="7.5" r=".8"/><circle cx="14.5" cy="7.5" r=".8"/></svg>';
  b.addEventListener("click", (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (open) { close(); return; }
    show(input, b);
  });
  input.insertAdjacentElement("afterend", b);
  // colours chosen in the browser's own picker count as recent too
  input.addEventListener("change", () => remember(input.value));
}

export const _test = { STANDARD, GRID, GREYS, recent, remember };
