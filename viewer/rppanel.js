/* The floating panel of a tool (Route, Area): placed over the drawing, at
 * the top right of what is on screen - not over the issue list beside it -
 * with – (fold to its title) and × (close). Closed, it stays away until
 * another tool is picked or another markup chosen; a small chip in its
 * corner brings it back.
 *
 *   if (!dock(panel, { key: "route", sig, label: "Route", repaint })) return;   // closed: nothing to fill
 */

const closed = {};            // key -> the tool and selection it was closed for
const MIN = "lwk-sheets:panel-min:";

function place(el) {
  const sc = document.getElementById("scroll");
  if (!sc || matchMedia("(max-width: 700px)").matches) { el.style.top = el.style.right = el.style.maxHeight = ""; return; }
  const r = sc.getBoundingClientRect();
  el.style.top = Math.round(r.top + 10) + "px";
  el.style.right = Math.round(innerWidth - r.right + 12) + "px";
  el.style.maxHeight = Math.max(120, Math.round(r.height - 20)) + "px";
}

function chip(key) {
  let c = document.getElementById("rp-chip-" + key);
  if (!c) {
    c = document.createElement("button");
    c.type = "button";
    c.id = "rp-chip-" + key;
    c.className = "rp-chip";
    document.body.appendChild(c);
  }
  return c;
}

/* The panel shown (true), or closed for now (false: it is hidden, its chip shown) */
export function dock(p, o) {
  const c = chip(o.key);
  if (closed[o.key] !== undefined && closed[o.key] === o.sig) {
    p.hidden = true;
    c.hidden = false;
    c.textContent = "⚙ " + o.label;
    c.title = "Show the " + o.label + " panel again";
    place(c);
    c.onclick = () => { delete closed[o.key]; c.hidden = true; o.repaint(); };
    return false;
  }
  delete closed[o.key];
  c.hidden = true;
  p.hidden = false;
  return true;
}

/* After the panel is filled: its – and × buttons, folded or not, and its place */
export function finishDock(p, o) {
  let min = false;
  try { min = localStorage.getItem(MIN + o.key) === "1"; } catch (e) {}
  p.classList.toggle("rp-min", min);
  const b = document.createElement("span");
  b.className = "rp-btns";
  b.innerHTML = `<button type="button" data-rp="min" title="${min ? "Open the panel" : "Fold the panel to its title"}">${min ? "▾" : "–"}</button>`
    + `<button type="button" data-rp="close" title="Close the panel (it comes back with another tool, or from its chip)">×</button>`;
  p.appendChild(b);
  b.querySelector("[data-rp=min]").onclick = () => {
    try { localStorage.setItem(MIN + o.key, min ? "0" : "1"); } catch (e) {}
    o.repaint();
  };
  b.querySelector("[data-rp=close]").onclick = () => { closed[o.key] = o.sig; o.repaint(); };
  place(p);
}

/* The panel not wanted at all (no tool, nothing chosen): its chip goes too, and
   a close is forgotten */
export function undock(key) {
  delete closed[key];            // next time the tool is picked, the panel shows again
  const c = document.getElementById("rp-chip-" + key);
  if (c) c.hidden = true;
}

addEventListener("resize", () => {
  for (const el of document.querySelectorAll(".rp-panel:not([hidden]), .rp-chip:not([hidden])")) place(el);
});
