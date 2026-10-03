/* Colour palette for markup colours.

   A small palette button beside a colour input opens a panel of standard
   colours and the ones used most recently, so the same red is the same red
   on every markup without retyping it. Choosing a colour sets the input and
   fires its input and change events, so the page reacts exactly as if the
   user had picked it in the browser's own colour picker. Recent colours are
   shared between the sheets page and the 3D snapshot editor.
 */

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
  const h1 = document.createElement("div");
  h1.className = "pal-h"; h1.textContent = "Standard";
  pop.append(h1, swatchRow(STANDARD, pick));
  const r = recent();
  if (r.length) {
    const h2 = document.createElement("div");
    h2.className = "pal-h"; h2.textContent = "Recent";
    pop.append(h2, swatchRow(r, pick));
  }
  document.body.appendChild(pop);
  const a = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(6, Math.min(innerWidth - w - 6, a.left)) + "px";
  pop.style.top = (a.bottom + h + 6 < innerHeight ? a.bottom + 4 : a.top - h - 4) + "px";
  open = pop;
}

/* Put a palette button right after a colour input (inside its label, if it
   has one). Safe to call twice on the same input. */
export function attachPalette(input) {
  if (!input || input.dataset.palette) return;
  input.dataset.palette = "1";
  const b = document.createElement("button");
  b.type = "button";
  b.className = "palbtn";
  b.title = "Standard and recent colours";
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

export const _test = { STANDARD, recent, remember };
