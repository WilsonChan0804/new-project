/* Startup self-check.
 *
 * This file exists because of a pattern, not a theory. Editing these pages
 * by replacing a span of text between two markers has three times removed a
 * function that lived inside that span - wireChrome, then signIn and
 * connStatus - and each time the page failed at boot with a ReferenceError
 * that told the user nothing about what to do.
 *
 * So the page now states up front what it needs, and says plainly what is
 * missing rather than dying on the first use of it.
 */

/* Elements each page cannot work without. Not every id - only the ones
   whose absence breaks something the user would notice. */
const REQUIRED = {
  sheets: [
    "gate-back", "gate-name", "gate-pass", "gate-go", "gate-msg",
    "conn", "status", "errlog", "proj-switch",
    "sheet-list", "item-list", "tools", "overlay", "textlayer", "pdf", "scroll", "page",
    "group-by", "item-search", "issue-total", "filter-tabs",
    "poly-finish", "meas-scale", "f-type", "a-scale", "a-rotl", "a-rotr", "undo", "redo", "show-markups", "a-paste", "p-tcolor", "import-pdf-btn", "import-pdf", "split-toggle", "split-pane", "split-sheet", "split-svg", "export-pdf", "pdf-back", "pdf-go", "pdf-scope", "pdf-dpi", "pdf-report", "pdf-markups", "export-json", "import-json", "import-btn", "a-geom", "g-x", "g-y", "g-w", "g-h", "g-r",
    "dialog-back", "text-back",
  ],
  model: [
    "gate-back", "gate-name", "gate-pass", "gate-go", "gate-msg",
    "conn", "status", "errlog", "proj-switch",
    "model-list", "i3-list", "i3-group", "i3-search", "i3-count",
    "canvas-wrap", "inspect-body", "camline",
    "sec-on", "sec-face", "sec-align", "sec-flip", "sec-reset",
    "snap-back", "snap-tools", "snap-svg", "snap-img",
    "i3-back", "i3-title", "i3-save",
    "view-save", "view-list", "vis-isolate", "vis-hide", "vis-show",
    "m-measure", "pins-toggle", "meas-distance", "meas-angle", "meas-area",
    "pv-top", "pv-front", "pv-iso", "pv-section", "pv-ortho",
    "pv-setalign", "pv-clearalign", "pv-align", "floor-list", "floor-cut", "floor-up", "floor-down", "floor-exit", "floor-ortho", "floor-count", "floor-select", "cam-level", "floor-cal", "display-modes", "plan-draw", "plan-draw-pick", "snap-tcolor", "cat-list", "cat-all", "meas-keep", "dims-on", "dim-list",
    "meas-undo", "meas-clear",
  ],
};

export function checkPage(page, extras) {
  const problems = [];

  for (const id of (REQUIRED[page] || []).concat(extras || [])) {
    if (!document.getElementById(id)) problems.push("missing element #" + id);
  }
  return problems;
}

/* Functions the page's boot sequence calls. Passed in by name and value, so
   one deleted by an edit is reported here instead of throwing later. */
export function checkFunctions(map) {
  const problems = [];
  for (const name of Object.keys(map)) {
    if (typeof map[name] !== "function") {
      problems.push("missing function " + name + "()");
    }
  }
  return problems;
}

/* The shared store module must be the version this page was written for.
   When a browser mixes a new page script with an old cached store.js the
   first sign used to be "Store.validate is not a function" - accurate, and
   no help at all. This names the real cause. */
const STORE_NEEDS = ["validate", "listProjects", "currentProject", "dataUrl",
                     "pageUrl", "authHeaders", "login", "sync", "put", "remove", "all"];

export function checkModules(Store) {
  const missing = STORE_NEEDS.filter((k) => typeof Store[k] !== "function");
  if (!missing.length) return [];
  return ["files out of step: store.js is an older version (missing "
    + missing.join(", ") + "). Copy every file from the latest update into "
    + "the viewer folder, then press Ctrl+Shift+R."];
}

/* A device that keeps a project for offline use (offline.js) starts without
   the server: the header says "Offline - copy of <date>", and that is not a
   start-up problem. Without any copy, the missing server is one. */
function keptOffline() {
  try { return Object.keys(JSON.parse(localStorage.getItem("lwk-offline:copies") || "{}") || {}).length > 0; }
  catch (e) { return false; }
}

export async function checkServer() {
  try {
    const res = await fetch("/api/ping");
    if (!res.ok) return ["server answered " + res.status + " on /api/ping"];
    return [];
  } catch (e) {
    if (keptOffline()) return [];
    return ["cannot reach the server - no connection, or (on the server PC) run.bat is not running. "
      + "No project is kept on this device for working offline."];
  }
}

/* One visible report. Nothing appears when everything is in order, so this
   costs the user no attention on a normal load. */
export function report(problems) {
  if (!problems.length) return false;
  const el = document.getElementById("errlog");
  const text = "Startup check found " + problems.length + " problem(s):\n  "
    + problems.join("\n  ");
  if (el) {
    el.hidden = false;
    el.textContent = text;
  } else {
    // Even the error bar can be the thing that went missing.
    const d = document.createElement("pre");
    d.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99;"
      + "margin:0;padding:10px;background:#fdece8;color:#7a2f22;"
      + "font:11px Consolas,monospace;white-space:pre-wrap;max-height:40vh;"
      + "overflow:auto;border-top:1px solid #f2b8aa";
    d.textContent = text;
    document.body.appendChild(d);
  }
  return true;
}
