/* Icons.
 *
 * Drawn as inline SVG paths rather than pulled from an icon font or a CDN.
 * The viewer is served from a machine that may be offline, and a missing
 * icon font degrades to blank squares - worse than no icons at all.
 *
 * Each icon carries a category. Tools that do related things share a hue,
 * so the toolbar can be scanned by colour before it is read.
 */

const C = {
  select: "#3b82f6",   // pointer and navigation
  shape: "#f28022",    // closed shapes
  line: "#e0562d",     // open geometry
  text: "#7c3aed",     // anything that carries words
  erase: "#ef4444",    // destructive
  view: "#0e9f6e",     // camera and display
  data: "#6b7280",     // neutral utilities
};

/* 24x24 viewBox, stroke-based so one path works at any size and inherits
   weight from the CSS. */
const PATHS = {
  select: "M5 3l14 8-6 1.5L9.5 19z",
  pan: "M9 11V5.5a1.5 1.5 0 013 0V11m0-1.5a1.5 1.5 0 013 0V12m0-1a1.5 1.5 0 013 0v4a6 6 0 01-6 6h-1.5a5 5 0 01-4-2L6 14.5a1.5 1.5 0 012-2.2L9.5 14",
  rect: "M4 6h16v12H4z",
  ellipse: "M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z",
  line: "M5 19L19 5",
  arrow: "M5 19L19 5M19 5h-6M19 5v6",
  cloud: "M6 15a3 3 0 010-6 4 4 0 017-2 3.5 3.5 0 013.5 3.5A3.5 3.5 0 0117 15z",
  cloudpoly: "M5 17a2 2 0 01-1-3.5 2 2 0 011-3.7 2.2 2.2 0 013-2.3 2.4 2.4 0 014-1 2.4 2.4 0 014 1.5 2.2 2.2 0 012 3.5 2 2 0 01-1 3.5 2 2 0 01-3 1.5 2.4 2.4 0 01-4 0 2.2 2.2 0 01-4 .5z",
  polyline: "M4 17l5-7 4 4 7-9",
  polygon: "M12 4l8 6-3 9H7l-3-9z",
  pen: "M4 20s2-6 6-10 8-5 8-5-1 4-5 8-9 7-9 7z",
  text: "M6 6h12M12 6v12M9 18h6",
  textbox: "M4 6h16v12H4zM8 10h8M8 14h5",
  callout: "M4 5h12v8H9l-3 3v-3H4zM18 16l3 4",
  stamp: "M9 4h6v4l-1 3h5v4H5v-4h5l-1-3zM4 19h16",
  measure: "M3 14l11-11 7 7-11 11zM8 9l2 2M11 6l2 2M5 12l2 2",
  dimension: "M4 8v8M20 8v8M4 12h16M6 10l-2 4M22 10l-2 4",
  snip: "M6 3v14h14M3 6h14v14M9 9l6 6",
  selecttext: "M9 4h6M12 4v16M9 20h6M5 9l-2 3 2 3M19 9l2 3-2 3",
  area: "M4 5h16v14H4zM8 9l8 6M8 15l8-6",
  angle: "M4 19h16M4 19L16 7M9 19a5 5 0 00-1.5-3.6",
  eraser: "M8 18H5l-2-2 9-9 6 6-5 5zM14 18h6",

  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  section: "M4 8h16v12H4zM4 8l4-4h16v12l-4 4",
  plane: "M3 13l9-5 9 5-9 5z",
  align: "M4 6h16M4 12h10M4 18h16",
  camera: "M4 8h3l2-2h6l2 2h3v11H4zM12 16a3.5 3.5 0 100-7 3.5 3.5 0 000 7z",
  issue: "M12 4l9 16H3zM12 10v4M12 17v.5",
  comment: "M4 5h16v11H10l-4 4v-4H4z",
  model: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5",
  sheet: "M6 3h9l4 4v14H6zM15 3v4h4",
  export: "M12 16V4M8 8l4-4 4 4M4 17v3h16v-3",
  link: "M10 14a4 4 0 006 .5l2-2a4 4 0 10-5.7-5.7l-1 1M14 10a4 4 0 00-6-.5l-2 2a4 4 0 105.7 5.7l1-1",
  filter: "M4 5h16l-6 7v6l-4 2v-8z",
  close: "M6 6l12 12M18 6L6 18",
  undo: "M9 10H5V6M5 10a8 8 0 113 6",
  trash: "M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13",
  flip: "M12 4v16M8 8L4 12l4 4M16 8l4 4-4 4",
  reset: "M4 12a8 8 0 108-8v4M8 4L12 4 12 8",
  copy: "M9 9h10v11H9zM5 15V4h10",
  paste: "M8 5H6v15h12V5h-2M9 3h6v4H9zM9 12h6M9 16h4",
  download: "M12 4v11M8 11l4 4 4-4M4 17v3h16v-3",
  upload: "M12 15V4M8 8l4-4 4 4M4 17v3h16v-3",
  pdf: "M6 3h9l4 4v14H6zM15 3v4h4M9 13h6M9 17h4",
  json: "M9 4c-2 0-2 2-2 4s-1 3-2 4c1 1 2 2 2 4s0 4 2 4M15 4c2 0 2 2 2 4s1 3 2 4c-1 1-2 2-2 4s0 4-2 4",
  ortho: "M5 5h14v14H5zM9 5v14M15 5v14",
  persp: "M8 5h8l5 14H3z",
  front: "M5 9h10v11H5zM5 9l4-4h10v11l-4 4M15 9l4-4",
  world: "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3.5 3 3.5 15 0 18M12 3c-3.5 3-3.5 15 0 18",
  home: "M4 11l8-7 8 7M6 9.5V20h12V9.5",
  box: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  highlight: "M9 11l6 6M4 20l3-1 11-11a2.1 2.1 0 00-3-3L4 16l-1 3zM14 20h7",
  match: "M4 20l5-5M9 15l6-6 3 3-6 6zM15 9l2-2a2 2 0 013 3l-2 2M16 20h5M18.5 17.5v5",
  walk: "M13 3a1.75 1.75 0 110 3.5 1.75 1.75 0 010-3.5zM9 21l2.5-7 2.5 2.5V21M7.5 12l3-3.5h3l2.5 4M10.5 8.5L9 14",
  palette: "M12 3a9 9 0 100 18c1 0 1.5-.8 1.5-1.6 0-.9-.7-1.4-.7-2.3 0-1 .8-1.6 1.8-1.6H17a4 4 0 004-4c0-4.7-4-8.5-9-8.5zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01",
};

const CATEGORY = {
  select: "select", pan: "select",
  rect: "shape", ellipse: "shape", cloud: "shape", cloudpoly: "shape", polygon: "shape",
  line: "line", arrow: "line", polyline: "line", pen: "line",
  text: "text", textbox: "text", callout: "text", stamp: "shape",
  measure: "data", dimension: "data", snip: "view", selecttext: "text", area: "data", angle: "data", filter: "data", model: "data", sheet: "data",
  link: "data", export: "data", undo: "data", reset: "data",
  eraser: "erase", trash: "erase", close: "erase",
  fit: "view", section: "view", plane: "view", align: "view",
  camera: "view", flip: "view",
  copy: "select", paste: "select", download: "data", upload: "data", pdf: "erase", json: "data",
  ortho: "view", persp: "view", front: "view", world: "view", home: "view",
  box: "view", palette: "shape", walk: "view", highlight: "line", match: "shape",
  issue: "shape", comment: "select",
};

export function iconSvg(name, size) {
  const d = PATHS[name];
  if (!d) return "";
  const s = size || 18;
  return `<svg class="ico" viewBox="0 0 24 24" width="${s}" height="${s}" `
    + `fill="none" stroke="currentColor" stroke-width="1.8" `
    + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
    + `<path d="${d}"/></svg>`;
}

export const iconColor = (name) => C[CATEGORY[name] || "data"];
export const hasIcon = (name) => !!PATHS[name];

/* Build a toolbar button: icon above, short label below. The label stays
   because a colour-coded glyph alone is a guessing game the first time
   someone opens the tool. */
export function iconButton(name, label, title) {
  const b = document.createElement("button");
  b.className = "ibtn";
  b.title = title || label;
  b.innerHTML = iconSvg(name) + `<span>${label}</span>`;
  if (hasIcon(name)) b.style.setProperty("--ico", iconColor(name));
  return b;
}


/* Put an icon on every element marked data-icon="name", keeping its text as
   a label beside it. The markup stays plain buttons with words; the icons
   are added once at start-up. */
export function decorateIcons(root) {
  /* Only ADDS: the icon goes in front, and bare text is wrapped as the
     label. Child elements are left exactly where they are. The first
     version rebuilt the contents from the text, which deleted the
     section-box checkbox inside its label and stopped the 3D page's
     start-up at "#sec-on". */
  for (const el of (root || document).querySelectorAll("[data-icon]")) {
    if (el.dataset.decorated) continue;
    const name = el.dataset.icon;
    if (!hasIcon(name)) continue;
    for (const node of [...el.childNodes]) {
      if (node.nodeType === 3 && node.textContent.trim()) {
        const lab = document.createElement("span");
        lab.className = "lab";
        lab.textContent = node.textContent.trim();
        el.replaceChild(lab, node);
      }
    }
    el.insertAdjacentHTML("afterbegin", iconSvg(name, 16));
    el.classList.add("icbtn");
    el.style.setProperty("--ico", iconColor(name));
    el.dataset.decorated = "1";
  }
}
