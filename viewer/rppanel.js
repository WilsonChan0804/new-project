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
  if (!sc) return;
  const pp = document.getElementById("props");
  const ppOn = pp && pp.classList.contains("pp-on") && getComputedStyle(pp).display !== "none" && pp.getBoundingClientRect().height > 0;
  if (matchMedia("(max-width: 700px)").matches) {
    // the phone: above the properties sheet (or the tool bar) at the bottom
    const tb = document.getElementById("tools");
    let floor = innerHeight;
    if (ppOn) floor = pp.getBoundingClientRect().top;
    else if (tb && tb.getBoundingClientRect().height) floor = tb.getBoundingClientRect().top;
    el.style.top = "auto"; el.style.right = "";
    el.style.bottom = Math.round(innerHeight - floor + 8) + "px";
    el.style.maxHeight = Math.max(120, Math.round(floor - 8 - 120)) + "px";
    return;
  }
  el.style.bottom = "";
  // the drawing area (with the properties panel at its top right: under it)
  const row = document.getElementById("stage-row") || sc;
  const r = row.getBoundingClientRect();
  let top = r.top + 12;
  if (ppOn) top = pp.getBoundingClientRect().bottom + 8;
  // and above the zoom bar at the bottom right
  let floor = r.bottom - 12;
  const zb = document.getElementById("zoombar");
  if (zb && zb.getBoundingClientRect().height) floor = Math.min(floor, zb.getBoundingClientRect().top - 8);
  let right = innerWidth - r.right + 12;
  if (ppOn && floor - top < 160) {
    // no room under the panel: beside it instead
    const q = pp.getBoundingClientRect();
    top = q.top; right = innerWidth - q.left + 8;
  }
  el.style.top = Math.round(top) + "px";
  el.style.right = Math.round(right) + "px";
  el.style.maxHeight = Math.max(120, Math.round(floor - top)) + "px";
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

/* The panel's content, set only when it changed. The drawing is redrawn
   all the time (the pointer moving, other people's markups arriving) and
   each redraw asks the panels to paint: rebuilding them each time replaced
   the button under the pointer between press and release, so × never
   closed it (and a drag selected all its text). A field being typed in is
   not rebuilt under the typing either. True when it was rebuilt. */
export function fill(p, html) {
  if (p.__html === html) return false;
  const a = document.activeElement;
  if (p.__html && a && p.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return false;
  p.innerHTML = html;
  p.__html = html;
  return true;
}

/* After the panel is filled: its – and × buttons, folded or not, and its place */
export function finishDock(p, o) {
  let min = false;
  try { min = localStorage.getItem(MIN + o.key) === "1"; } catch (e) {}
  p.classList.toggle("rp-min", min);
  let b = p.querySelector(":scope > .rp-btns");
  if (!b) {
    b = document.createElement("span");
    b.className = "rp-btns";
    b.innerHTML = `<button type="button" data-rp="min"></button>`
      + `<button type="button" data-rp="close" title="Close the panel (it comes back with another tool, or from its chip)">×</button>`;
    p.appendChild(b);
  }
  const mb = b.querySelector("[data-rp=min]");
  mb.title = min ? "Open the panel" : "Fold the panel to its title";
  mb.textContent = min ? "▾" : "–";
  mb.onclick = () => {
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

addEventListener("lwk-panels", () => {
  for (const el of document.querySelectorAll(".rp-panel:not([hidden]), .rp-chip:not([hidden])")) place(el);
});
addEventListener("resize", () => {
  for (const el of document.querySelectorAll(".rp-panel:not([hidden]), .rp-chip:not([hidden])")) place(el);
});
