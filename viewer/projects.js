/* Project picker.
 *
 * Shown after sign-in when no project is chosen yet, and reachable from the
 * header at any time. Each project is one export folder on the server; the
 * newest export is listed first because that is usually the one wanted.
 *
 * Switching reloads the page rather than swapping data in place. Every part
 * of the viewer - loaded models, open sheet, issue list, undo history,
 * polling - belongs to one project, and a reload is the one way to be sure
 * nothing from the previous job survives into the next.
 */
import * as Store from "./store.js";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function when(t) {
  const d = new Date(t * 1000);
  return isNaN(d) ? "" : d.toLocaleDateString(undefined,
    { day: "numeric", month: "short", year: "numeric" });
}

function go(id) {
  Store.setProject(id);
  const url = new URL(location.href);
  url.searchParams.set("project", id);
  location.href = url.toString();
}

/* Resolves once a project is chosen. Returns immediately when the URL or
   the last visit already names one that still exists. */
export async function ensureProject() {
  let data;
  try { data = await Store.listProjects(); }
  catch (e) { return Store.currentProject(); }

  const list = data.projects || [];
  // The old single-project server has exactly one, called "default".
  if (data.single) {
    if (Store.currentProject() !== "default") Store.setProject("default");
    fillSwitcher(list, "default");
    return "default";
  }

  const cur = Store.currentProject();
  if (cur && list.some((p) => p.id === cur)) {
    Store.setProject(cur);
    fillSwitcher(list, cur);
    return cur;
  }
  if (list.length === 1) { go(list[0].id); return new Promise(() => {}); }

  showPicker(list);
  return new Promise(() => {});      // the page reloads when one is picked
}

export function showPicker(list) {
  let back = document.getElementById("proj-back");
  if (!back) {
    back = document.createElement("div");
    back.id = "proj-back";
    document.body.appendChild(back);
  }
  if (!list.length) {
    back.innerHTML = `<div id="proj-dlg"><h3>No projects yet</h3>
      <p class="muted">Export a project from Revit into its own folder under
      the exports folder, run convert.bat on it, then reload this page.</p></div>`;
    back.hidden = false;
    return;
  }
  back.innerHTML = `<div id="proj-dlg">
    <h3>Choose a project</h3>
    <div id="proj-grid">${list.map((p) => `
      <button class="proj-card" data-id="${esc(p.id)}">
        <span class="pc-title">${esc(p.title)}</span>
        <span class="pc-id">${esc(p.id)}</span>
        <span class="pc-meta">${p.sheets} sheet${p.sheets === 1 ? "" : "s"}
          &middot; ${p.models} model${p.models === 1 ? "" : "s"}
          &middot; exported ${esc(when(p.updated))}</span>
      </button>`).join("")}
    </div></div>`;
  back.hidden = false;
  for (const b of back.querySelectorAll(".proj-card")) {
    b.addEventListener("click", () => go(b.dataset.id));
  }
}

function fillSwitcher(list, cur) {
  const sel = document.getElementById("proj-switch");
  if (!sel) return;
  sel.innerHTML = list.map((p) =>
    `<option value="${esc(p.id)}"${p.id === cur ? " selected" : ""}>`
    + `${esc(p.title)}</option>`).join("");
  // Nothing to switch between: keep the header uncluttered.
  sel.hidden = list.length < 2;
  sel.onchange = () => go(sel.value);
}
