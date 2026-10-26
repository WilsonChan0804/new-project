/* The 3D page's controls as in the template: one floating toolbar at the
 * bottom of the view (orbit, walk | fit, section box, measure | + Add issue)
 * and a row of chips at its top left (floor, projection, issue pins, plan
 * overlay, and a ⋯ menu for the rest). The existing buttons are moved, not
 * rebuilt, so everything model.js has wired to them keeps working. */

const ICON = {
  orbit: `<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>`,
  walk: `<circle cx="13" cy="4" r="2"/><path d="M10 22l2-7 3 3v6M8 12l3-4 4 2 2 3M11 8l-1 6"/>`,
  fit: `<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>`,
  box: `<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>`,
  measure: `<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>`,
  pin: `<path d="M5 3v18M5 4h11l-2 4 2 4H5"/>`,
  more: `<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>`,
};
const svg = (k) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
const $ = (id) => document.getElementById(id);

function iconize(btn, icon, label) {
  if (!btn) return null;
  btn.classList.add("v3-b");
  btn.removeAttribute("data-icon");
  btn.innerHTML = svg(icon) + `<span class="v3-lab">${label}</span>`;
  btn.setAttribute("aria-label", label);
  return btn;
}

export function installV3Bar(wrap) {
  if (!wrap || $("v3-bar")) return;
  const bar = document.createElement("div");
  bar.id = "v3-bar";
  bar.className = "v3-bar";
  const sep = () => { const s = document.createElement("span"); s.className = "v3-sep"; return s; };

  // navigate / walk
  bar.append(iconize($("m-nav"), "orbit", "Orbit") || "", iconize($("m-walk"), "walk", "Walk") || "", sep());
  // fit / section box / measure
  const fit = iconize($("fit3d"), "fit", "Fit");
  const sec = $("sec-on");
  const box = document.createElement("button");
  box.type = "button";
  box.id = "v3-box";
  box.title = "Section box on or off - then drag the orange arrows on the model";
  iconize(box, "box", "Section box");
  const paintBox = () => box.classList.toggle("active", !!(sec && sec.checked));
  box.onclick = () => { if (sec) { sec.click(); paintBox(); } };
  if (sec) sec.addEventListener("change", paintBox);
  setInterval(paintBox, 1000);          // set elsewhere too (views, clash results)
  bar.append(fit || "", box, iconize($("m-measure"), "measure", "Measure") || "", sep());
  // + Add issue, the main action
  const add = $("m-issue");
  if (add) { add.classList.add("v3-add"); add.innerHTML = `<span aria-hidden="true">+</span> Add issue`; bar.append(add); }
  wrap.appendChild(bar);

  // the chips at the top left
  const chips = document.createElement("div");
  chips.id = "v3-chips";
  chips.className = "v3-chips";
  const floor = $("floor-select");
  if (floor) {
    const f = document.createElement("label");
    f.className = "v3-chip v3-floor";
    f.title = floor.title;
    f.append("Floor ", floor);
    chips.append(f);
  }
  const ortho = $("pv-ortho");
  if (ortho) { ortho.classList.add("v3-chip"); ortho.removeAttribute("data-icon"); chips.append(ortho); }
  const pins = $("pins-toggle");
  if (pins) {
    const p = document.createElement("button");
    p.type = "button";
    p.className = "v3-chip v3-pins";
    p.title = "Show or hide the issue markers on the model";
    const paint = () => { p.innerHTML = svg("pin") + " Issue pins"; p.classList.toggle("on", pins.classList.contains("active") || !/Show/.test(pins.textContent)); };
    p.onclick = () => { pins.click(); paint(); };
    paint();
    chips.append(p);
  }
  const plan = $("plan-draw");
  if (plan) { plan.classList.add("v3-chip"); chips.append(plan); }
  const planPick = $("plan-draw-pick");
  if (planPick) chips.append(planPick);

  // ⋯ the rest: copy view link, BCF, front / world, + Task
  const more = document.createElement("span");
  more.className = "v3-more";
  more.innerHTML = `<button type="button" class="v3-chip" id="v3-more-btn" aria-haspopup="menu" title="More: view link, BCF, front and world, + Task, + Query">${svg("more")}</button>`
    + `<div id="v3-more-items" class="v3-menu" hidden role="menu"></div>`;
  chips.append(more);
  const items = more.querySelector("#v3-more-items");
  for (const id of ["view-link", "bcf-menu", "bcf-pair", "import-bcf-file", "pv-setalign", "pv-clearalign", "lwk-send-task", "lwk-send-query"]) {
    const n = $(id);
    if (!n) continue;
    if (id === "view-link") { n.textContent = "Copy a link to this view"; }
    n.classList.remove("ghost");
    items.append(n);
  }
  const mb = more.querySelector("#v3-more-btn");
  mb.onclick = (ev) => { ev.stopPropagation(); items.hidden = !items.hidden; };
  document.addEventListener("pointerdown", (ev) => { if (!items.hidden && !more.contains(ev.target)) items.hidden = true; });
  wrap.appendChild(chips);

  // the Selection part shrinks to one line while nothing is selected - the issues get the room
  const ib = $("inspect-body");
  if (ib) {
    const fold = () => ib.classList.toggle("v3-nosel", /Click an element in the model/.test(ib.textContent || "") && ib.children.length === 0);
    fold();
    new MutationObserver(fold).observe(ib, { childList: true, characterData: true, subtree: true });
  }

  // nothing left worth a row of its own
  const pb = $("page-bar");
  if (pb) pb.classList.add("pb-hidden");
  dispatchEvent(new Event("resize"));
}
