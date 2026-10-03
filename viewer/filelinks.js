/* Links to files that live outside the viewer: OneDrive, SharePoint and
 * Autodesk Construction Cloud (ACC / BIM 360) - plus the viewer's own
 * sheets and 3D views.
 *
 * The drawings, calcs and models the team works on stay where they are;
 * a task or an issue keeps a link to them. Opening one goes to OneDrive or
 * ACC itself, so their sign-in and permissions keep applying and nothing
 * is copied.
 *
 * Shared by the Tasks page and the issue window (issuepanel.js).
 */

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SERVICES = {
  onedrive: { label: "OneDrive", color: "#0a64d6", mark: "OD" },
  sharepoint: { label: "SharePoint", color: "#03787c", mark: "SP" },
  acc: { label: "ACC", color: "#1e1e1e", mark: "ACC" },
  sheet: { label: "Sheet", color: "#d1660e", mark: "2D" },
  view3d: { label: "3D view", color: "#7c3aed", mark: "3D" },
  issue: { label: "Issue", color: "#e2453c", mark: "#" },
  task: { label: "Task", color: "#0e9f6e", mark: "&#10003;" },
  project: { label: "Project", color: "#4f46e5", mark: "P" },
  url: { label: "Link", color: "#6b7480", mark: "↗" },
};

const EXT_KIND = {
  pdf: "PDF", rvt: "Revit", rfa: "Revit family", dwg: "DWG", dxf: "DXF", ifc: "IFC", nwd: "Navisworks",
  nwc: "Navisworks", xlsx: "Excel", xls: "Excel", xlsm: "Excel", csv: "CSV", docx: "Word", doc: "Word",
  pptx: "PowerPoint", jpg: "Image", jpeg: "Image", png: "Image", zip: "Zip", msg: "Email", txt: "Text",
};

/* What a pasted address points at. Recognises:
 *   OneDrive:   1drv.ms/..., onedrive.live.com/...
 *   SharePoint: <tenant>.sharepoint.com/... and <tenant>-my.sharepoint.com (OneDrive for Business)
 *   ACC:        acc.autodesk.com/..., docs.b360.autodesk.com/..., *.autodesk.com/docs
 *   the viewer: index.html?...sheet=  (a sheet), model.html?... (a 3D view)
 */
export function classify(url) {
  const raw = String(url || "").trim();
  let u = null;
  try { u = new URL(raw, location.href); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  const path = decodeURIComponent(u.pathname);
  const q = u.searchParams;
  let kind = "url";
  if (host === "1drv.ms" || host.endsWith("onedrive.live.com")) kind = "onedrive";
  else if (/-my\.sharepoint\.com$/.test(host)) kind = "onedrive";      // OneDrive for Business
  else if (host.endsWith(".sharepoint.com")) kind = "sharepoint";
  else if (host === "acc.autodesk.com" || host.endsWith(".b360.autodesk.com")
           || (host.endsWith("autodesk.com") && /\/(docs|build|projects)\//.test(path))) kind = "acc";
  else if (u.origin === location.origin && /\/tasks\.html$/.test(u.pathname) && q.get("task")) kind = "task";
  else if (u.origin === location.origin && /\/projects\.html$/.test(u.pathname) && q.get("p")) kind = "project";
  else if (u.origin === location.origin && /\/(index|model)\.html$/.test(u.pathname) && q.get("select")) kind = "issue";
  else if (u.origin === location.origin && /\/index\.html$/.test(u.pathname) && q.get("sheet")) kind = "sheet";
  else if (u.origin === location.origin && /\/model\.html$/.test(u.pathname)) kind = "view3d";

  // A readable name: SharePoint and OneDrive often carry it in a parameter,
  // ACC in the last part of the path; a short link carries none.
  let name = q.get("file") || q.get("filename") || q.get("name") || "";
  const id = q.get("id") || "";
  if (!name && id) name = id.split("/").pop();
  if (!name) {
    const parts = path.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    if (/\.[a-z0-9]{2,5}$/i.test(last)) name = last;
  }
  if (kind === "sheet") name = "Sheet " + q.get("sheet");
  if (kind === "view3d") name = "3D view" + (q.get("project") ? " - " + q.get("project") : "");
  if (kind === "task") name = "Task";
  if (kind === "issue") name = "Issue" + (q.get("sheet") ? " on " + q.get("sheet") : "");
  if (kind === "project") name = "Project";
  const ext = (name.match(/\.([a-z0-9]{2,5})$/i) || [])[1] || "";
  return {
    kind, url: u.href, name,
    ext: ext.toLowerCase(), type: EXT_KIND[ext.toLowerCase()] || "",
    project: q.get("project") || "", ref: (kind === "issue" ? q.get("select") : kind === "task" ? q.get("task") : q.get("sheet") || q.get("select")) || "",
    service: SERVICES[kind].label,
  };
}

/* A link record as stored on a task or an issue. */
export function makeLink(url, title, by) {
  const c = classify(url);
  if (!c) return null;
  return {
    id: "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    kind: c.kind, url: c.url, title: (title || "").trim() || c.name || c.service + " link",
    project: c.project, ref: c.ref, added_by: by || "", added_at: new Date().toISOString(),
  };
}

export function badge(kind) {
  const s = SERVICES[kind] || SERVICES.url;
  return `<span class="fl-badge" style="background:${s.color}" title="${esc(s.label)}">${s.mark.startsWith("&") ? s.mark : esc(s.mark)}</span>`;
}

/* One link as a chip that opens it. Viewer links open in this tab's
   neighbour (same app); outside services in a new tab. */
export function chip(link, opts) {
  opts = opts || {};
  const s = SERVICES[link.kind] || SERVICES.url;
  const c = classify(link.url) || {};
  const sub = [s.label, c.type].filter(Boolean).join(" · ");
  return `<span class="fl-chip" data-id="${esc(link.id || "")}">`
    + badge(link.kind)
    + `<a href="${esc(link.url)}" target="${["sheet", "view3d", "task", "issue", "project"].includes(link.kind) ? "_self" : "_blank"}"`
    + ` rel="noopener" title="${esc(link.url)}">${esc(link.title || c.name || link.url)}</a>`
    + `<small>${esc(sub)}</small>`
    + (opts.remove ? `<button type="button" class="fl-x ghost" data-remove="${esc(link.id || "")}" title="Remove the link (the file itself stays)">&#10005;</button>` : "")
    + `</span>`;
}

/* Addresses in already-escaped text turned into chips - for comments. */
export function linkify(html) {
  return String(html).replace(/(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)])/g, (m) => {
    const url = m.replace(/&amp;/g, "&");
    const c = classify(url);
    if (!c) return m;
    if (c.kind === "url") return `<a href="${esc(url)}" target="_blank" rel="noopener">${m}</a>`;
    return chip({ kind: c.kind, url, title: c.name || c.service + " file" });
  });
}

/* The styles, once per page - so a page needs nothing but the import. */
(function css() {
  if (document.getElementById("fl-css")) return;
  const st = document.createElement("style");
  st.id = "fl-css";
  st.textContent = `
.fl-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; vertical-align: middle;
  border: 1px solid var(--line, #e2e6ec); background: var(--panel, #fff); border-radius: 6px;
  padding: 2px 6px 2px 3px; margin: 2px 4px 2px 0; font-size: 12px; line-height: 1.4; }
.fl-chip a { color: var(--ink, #1f2430); text-decoration: none; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 320px; }
.fl-chip a:hover { text-decoration: underline; color: var(--accent-deep, #d1660e); }
.fl-chip small { color: var(--muted, #6b7480); font-size: 10px; white-space: nowrap; }
.fl-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 18px;
  padding: 0 4px; border-radius: 4px; color: #fff; font-size: 9px; font-weight: 700; letter-spacing: .3px; }
.fl-x { padding: 0 4px !important; font-size: 10px; line-height: 1; color: var(--muted, #6b7480); }
.fl-list { display: flex; flex-wrap: wrap; }
.fl-add { display: flex; gap: 6px; margin-top: 4px; }
.fl-add input { flex: 1; font-size: 12px; }
`;
  document.head.appendChild(st);
})();
