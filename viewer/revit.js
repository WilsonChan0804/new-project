/* Revit elements on issues and tasks.
 *
 * An element is { id: Revit ElementId, uid: Revit UniqueId, name, category }.
 *
 *  - Copy Revit IDs: the ElementIds, comma separated - in Revit, Manage >
 *    Select by ID takes them as they are (no add-in needed).
 *  - Show in 3D: model.html?elements=<UniqueIds> picks them out in the model.
 *  - Show in Revit: asks Revit's LWK add-in to select them (server
 *    /api/revit/requests, which the add-in polls - server/REVIT_ADDIN_API.md).
 *    When the add-in is not listening, the IDs are copied instead.
 */

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function headers() {
  const h = { "Content-Type": "application/json" };
  try { const t = localStorage.getItem("lwk-viewer:token"); if (t) h["X-Viewer-Token"] = t; } catch (e) {}
  return h;
}

/* The elements of an issue item (3D), however it was saved. */
export function elementsOf(item) {
  if (!item) return [];
  const e = item.element;
  if (e && (e.revit_id || e.revit_uid || e.id || e.uid)) {
    return [{ id: String(e.revit_id || e.id || ""), uid: e.revit_uid || e.uid || "", name: e.name || "", category: e.category || "" }];
  }
  return [];
}

export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
  }
  const t = document.createElement("textarea");
  t.value = text;
  t.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.appendChild(t);
  t.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) {}
  t.remove();
  return ok;
}

export async function copyIds(els) {
  const ids = els.map((e) => e.id).filter(Boolean);
  if (!ids.length) { say("These elements have no Revit ElementId (only an IFC GUID).", true); return false; }
  const ok = await copyText(ids.join(","));
  say(ok ? `Copied ${ids.length} Revit ID${ids.length === 1 ? "" : "s"} - in Revit: Manage > Select by ID, paste.` : "Could not copy: " + ids.join(","), !ok);
  return ok;
}

export function view3dUrl(project, els) {
  const keys = els.map((e) => e.uid || e.id).filter(Boolean).slice(0, 200);
  return "model.html?" + new URLSearchParams({ project, elements: keys.join(",") }).toString();
}

export async function showInRevit(project, els, extra) {
  try {
    const res = await fetch("/api/revit/requests", { method: "POST", headers: headers(),
      body: JSON.stringify(Object.assign({ project, kind: "select", elements: els }, extra || {})) });
    const r = await res.json();
    if (!res.ok) throw new Error(r.detail || "HTTP " + res.status);
    if (r.addin_seen) { say("Sent to Revit: the LWK add-in selects them there."); return "sent"; }
  } catch (e) { /* the IDs below still help */ }
  const ids = els.map((e) => e.id).filter(Boolean);
  const ok = ids.length && await copyText(ids.join(","));
  say((ok ? "Revit IDs copied. " : "") + "Revit's LWK add-in is not listening yet - in Revit use Manage > Select by ID and paste.", !ok);
  return "copied";
}

/* What Revit has selected now (sent by the add-in), or []. */
export async function revitSelection() {
  try {
    const res = await fetch("/api/revit/selection", { headers: headers() });
    const r = await res.json();
    return r.elements || [];
  } catch (e) { return []; }
}

/* A block listing elements, with the three buttons. */
export function elementsBlock(project, els, title) {
  if (!els || !els.length) return "";
  const cats = [...new Set(els.map((e) => e.category).filter(Boolean))];
  return `<div class="rv-els" data-rv-project="${esc(project)}" data-rv-els="${esc(JSON.stringify(els))}">`
    + `<div class="rv-h">${esc(title || "Revit elements")} <span class="muted">${els.length}${cats.length ? " · " + esc(cats.slice(0, 3).join(", ")) : ""}</span></div>`
    + els.slice(0, 12).map((e) => `<div class="rv-e"><b>${esc(e.name || e.category || "Element")}</b>`
      + `<small>${esc([e.category, e.id ? "Revit id " + e.id : "", !e.id && e.uid ? e.uid.slice(0, 18) + "..." : ""].filter(Boolean).join(" · "))}</small></div>`).join("")
    + (els.length > 12 ? `<div class="rv-e muted">... and ${els.length - 12} more</div>` : "")
    + `<div class="rv-b"><button type="button" class="ghost" data-rv="copy" title="For Revit: Manage > Select by ID">Copy Revit IDs</button>`
    + `<a class="ghost rv-3d" href="${esc(view3dUrl(project, els))}" data-rv="3d">Show in 3D</a>`
    + `<button type="button" class="ghost" data-rv="revit" title="Revit's LWK add-in selects them">Show in Revit</button></div></div>`;
}

/* One click handler for every such block on the page. */
let wired = false;
export function wireElementBlocks() {
  if (wired) return;
  wired = true;
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-rv]");
    if (!b || b.dataset.rv === "3d") return;
    const box = b.closest("[data-rv-els]");
    if (!box) return;
    ev.preventDefault();
    let els = [];
    try { els = JSON.parse(box.dataset.rvEls); } catch (e) {}
    if (b.dataset.rv === "copy") copyIds(els);
    if (b.dataset.rv === "revit") showInRevit(box.dataset.rvProject, els);
  });
  css();
}

function say(text, bad) {
  let t = document.getElementById("rv-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "rv-toast";
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.className = bad ? "bad" : "";
  t.hidden = false;
  clearTimeout(say.timer);
  say.timer = setTimeout(() => { t.hidden = true; }, 6000);
}

function css() {
  if (document.getElementById("rv-css")) return;
  const st = document.createElement("style");
  st.id = "rv-css";
  st.textContent = `
.rv-els { border: 1px solid var(--line, #e2e6ec); border-left: 3px solid #7c3aed; border-radius: 8px; padding: 6px 10px; margin: 4px 0 8px; font-size: 12.5px; }
.rv-h { font-weight: 700; font-size: 12px; margin-bottom: 3px; }
.rv-e { display: flex; gap: 8px; align-items: baseline; padding: 1px 0; }
.rv-e small { color: var(--muted, #6b7480); font-size: 11px; }
.rv-b { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 5px; }
.rv-b button, .rv-b a { font-size: 12px; padding: 2px 9px; border: 1px solid var(--line, #e2e6ec); border-radius: 6px; text-decoration: none; color: var(--ink, #1f2430); background: var(--panel, #fff); cursor: pointer; }
.rv-b button:hover, .rv-b a:hover { border-color: #7c3aed; color: #7c3aed; }
#rv-toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 500; background: #1f2430; color: #fff; padding: 8px 14px; border-radius: 8px; font-size: 13px; max-width: 92vw; box-shadow: 0 6px 20px rgba(0,0,0,.25); }
#rv-toast.bad { background: #b42318; }
#rv-toast[hidden] { display: none; }
`;
  document.head.appendChild(st);
}
