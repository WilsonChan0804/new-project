/* Issue templates: what a team raises again and again, one choice away.
 *
 * A "Template" list at the top of the new-issue dialogs (sheets and 3D)
 * fills the title, description, type, priority, assignee and due date;
 * "Save as template" keeps what is in the dialog under a name, for the
 * whole project (on the server). */

let _cache = null;

async function load(Store) {
  if (_cache) return _cache;
  try { _cache = (await Store.api("/api/templates")).templates || []; } catch (e) { _cache = []; }
  return _cache;
}

async function save(Store, list) {
  const r = await Store.api("/api/templates", { method: "POST", body: JSON.stringify({ templates: list }) });
  _cache = r.templates || list;
  return _cache;
}

const dateIn = (days) => {
  const d = new Date(Date.now() + Number(days) * 86400000);
  return d.toISOString().slice(0, 10);
};

/* prefix: "f" (sheets) or "i3" (3D). */
export function attachTemplates(Store, dialog, prefix) {
  if (!dialog || dialog.querySelector(".tpl-row")) return;
  const $ = (id) => document.getElementById(prefix + "-" + id);
  const row = document.createElement("div");
  row.className = "tpl-row";
  row.innerHTML = `<select class="tpl-pick" title="Fill this issue from a template"><option value="">Template ...</option></select>`
    + `<button type="button" class="ghost tpl-save" title="Keep what is in this dialog as a template for the project">Save as template</button>`
    + `<button type="button" class="ghost tpl-del" title="Delete the chosen template" hidden>&#10005;</button>`;
  const h = dialog.querySelector("h3");
  if (h) h.after(row); else dialog.prepend(row);
  const pick = row.querySelector(".tpl-pick"), del = row.querySelector(".tpl-del");
  const fill = async () => {
    const list = await load(Store);
    const cur = pick.value;
    pick.innerHTML = `<option value="">Template ...</option>`
      + list.map((t, i) => `<option value="${i}">${String(t.name).replace(/</g, "&lt;")}</option>`).join("");
    if (cur && list[cur]) pick.value = cur;
    del.hidden = !pick.value;
  };
  fill();
  // refreshed each time the dialog opens
  new MutationObserver(() => { if (!dialog.closest("[hidden]")) { pick.value = ""; del.hidden = true; fill(); } })
    .observe(dialog.parentElement || dialog, { attributes: true, attributeFilter: ["hidden"] });
  pick.addEventListener("change", async () => {
    const t = (await load(Store))[pick.value];
    del.hidden = !t;
    if (!t) return;
    const set = (id, v) => { const el = $(id); if (el && v !== null && v !== undefined && v !== "") el.value = v; };
    set("title", t.title);
    set("desc", t.description);
    set("type", t.type);
    set("priority", t.priority);
    set("assignee", t.assigned_to);
    if (t.due_days !== null && t.due_days !== undefined && t.due_days !== "" && isFinite(Number(t.due_days))) {
      set("due", dateIn(t.due_days));
    }
  });
  row.querySelector(".tpl-save").addEventListener("click", async () => {
    const name = (prompt("Name of the template:", ($("title") || {}).value || "") || "").trim();
    if (!name) return;
    const due = ($("due") || {}).value;
    const t = {
      name, title: ($("title") || {}).value || "", description: ($("desc") || {}).value || "",
      type: ($("type") || {}).value || "", priority: ($("priority") || {}).value || "",
      assigned_to: ($("assignee") || {}).value || "",
      due_days: due ? String(Math.max(0, Math.round((Date.parse(due) - Date.now()) / 86400000))) : null,
    };
    const list = (await load(Store)).filter((x) => x.name !== name).concat([t]);
    try { await save(Store, list); await fill(); alert(`Template "${name}" saved for this project.`); }
    catch (e) { alert("Could not save the template: " + e.message); }
  });
  del.addEventListener("click", async () => {
    const list = await load(Store);
    const t = list[pick.value];
    if (!t || !confirm(`Delete the template "${t.name}"?`)) return;
    try { await save(Store, list.filter((x) => x !== t)); pick.value = ""; await fill(); }
    catch (e) { alert("Could not delete: " + e.message); }
  });
}
