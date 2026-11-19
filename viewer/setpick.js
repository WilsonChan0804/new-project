/* Which set new drawings go in, in the upload windows (PDF, CAD, Folders >
 * Add to the Sheets page): the set shown now, another set, or a new one.
 *
 *   const sp = setPicker(el, { sets, current, newName });
 *   sp.value()          the set's name ("" never: falls back to newName)
 *   sp.onChange(fn)     called when the choice or the name changes
 */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let N = 0;
export function setPicker(el, { sets, current, newName, fallback = "Uploaded PDFs" }) {
  const id = "sp" + (++N);
  const list = [...new Set((sets || []).filter(Boolean))];
  const cur = current && list.includes(current) ? current : "";
  const others = list.filter((s) => s !== cur);
  // the usual choice: the set shown; else an existing set; else a new one
  const def = cur ? "cur" : others.length && !newName ? "other" : "new";
  el.innerHTML = `<div class="sp-box" style="margin-top:8px"><div style="font-weight:600;margin-bottom:4px">Put the drawings in</div>`
    + (cur ? `<label class="sp-opt" style="display:flex;align-items:center;gap:6px;margin:4px 0;font-weight:400"><input type="radio" style="width:auto;margin:0;flex:none" name="${id}" value="cur"${def === "cur" ? " checked" : ""}> Add to the current set: <b>${esc(cur)}</b></label>` : "")
    + (others.length ? `<label class="sp-opt" style="display:flex;align-items:center;gap:6px;margin:4px 0;font-weight:400"><input type="radio" style="width:auto;margin:0;flex:none" name="${id}" value="other"${def === "other" ? " checked" : ""}> Add to ${cur ? "another" : "a"} set `
      + `<select class="sp-other" style="flex:1;min-width:0;width:auto;margin:0">${others.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}</select></label>` : "")
    + `<label class="sp-opt" style="display:flex;align-items:center;gap:6px;margin:4px 0;font-weight:400"><input type="radio" style="width:auto;margin:0;flex:none" name="${id}" value="new"${def === "new" ? " checked" : ""}> New set `
    + `<input type="text" class="sp-new" maxlength="60" placeholder="e.g. GBP submission 1" value="${esc(newName || "")}" style="flex:1;min-width:0;width:auto;margin:0"></label>`
    + `<div class="sp-note muted" style="font-size:12px;margin-top:2px">Each set is its own entry under Set: in the Sheets list.</div></div>`;
  const fns = [];
  const how = () => (el.querySelector(`input[name="${id}"]:checked`) || {}).value || "new";
  const value = () => {
    const h = how();
    if (h === "cur") return cur;
    if (h === "other") return el.querySelector(".sp-other").value;
    return el.querySelector(".sp-new").value.trim().slice(0, 60) || newName || fallback;
  };
  const note = () => {
    const h = how(), v = value(), n = el.querySelector(".sp-note");
    n.textContent = h === "new" && list.includes(v) ? `There is a set called "${v}" already: the drawings are added to it.` : "Each set is its own entry under Set: in the Sheets list.";
  };
  const fire = () => { note(); fns.forEach((f) => f(value())); };
  el.querySelectorAll(`input[name="${id}"]`).forEach((r) => r.addEventListener("change", fire));
  const sel = el.querySelector(".sp-other");
  if (sel) sel.addEventListener("change", () => { el.querySelector(`input[name="${id}"][value="other"]`).checked = true; fire(); });
  const nw = el.querySelector(".sp-new");
  nw.addEventListener("focus", () => { el.querySelector(`input[name="${id}"][value="new"]`).checked = true; fire(); });
  nw.addEventListener("input", fire);
  return { value, onChange: (f) => fns.push(f), how };
}
