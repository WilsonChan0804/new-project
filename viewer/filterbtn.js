/* One "Filter" button instead of a row of drop-downs and tick boxes
 * (Tasks, Calendar). The page's own controls are moved into a small panel
 * under the button - not rebuilt, so what listens to them still does - and
 * the button counts the filters that are not at their default:
 * "Filter · 2".
 *
 * makeFilter({ before, groups: [{ title, els }], count, title })
 *   before: the element the button goes in front of
 *   groups: headed groups of the page's controls (elements)
 *   count:  () => how many filters are set
 * Returns { update } (call after the page changes a control itself).
 */
export function makeFilter({ before, groups, count, title }) {
  const wrap = document.createElement("span");
  wrap.className = "flt-wrap";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ghost flt-btn";
  btn.title = title || "Filter what is shown";
  btn.setAttribute("aria-haspopup", "dialog");
  const pop = document.createElement("div");
  pop.className = "flt-pop";
  pop.hidden = true;
  for (const g of groups) {
    const sec = document.createElement("div");
    sec.className = "flt-sec";
    if (g.title) {
      const h = document.createElement("div");
      h.className = "flt-h";
      h.textContent = g.title;
      sec.appendChild(h);
    }
    for (const el of g.els) if (el) sec.appendChild(el);
    pop.appendChild(sec);
  }
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "ghost flt-reset";
  reset.textContent = "Clear filters";
  pop.appendChild(reset);
  wrap.append(btn, pop);
  before.parentNode.insertBefore(wrap, before);

  const update = () => {
    const n = count();
    btn.innerHTML = `<span class="flt-i">&#9881;</span>Filter${n ? ` <b>· ${n}</b>` : ""} &#9662;`;
    btn.classList.toggle("active", n > 0);
    reset.hidden = !n;
  };
  const place = () => {
    const r = btn.getBoundingClientRect();
    pop.style.top = (r.bottom + 4) + "px";
    pop.style.left = Math.max(6, Math.min(innerWidth - pop.offsetWidth - 6, r.left)) + "px";
  };
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    pop.hidden = !pop.hidden;
    if (!pop.hidden) place();
  });
  document.addEventListener("pointerdown", (ev) => { if (!pop.hidden && !wrap.contains(ev.target)) pop.hidden = true; });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") pop.hidden = true; });
  pop.addEventListener("change", update);
  pop.addEventListener("input", update);
  reset.addEventListener("click", () => {
    // each control back to its first option / ticked, then told so
    for (const el of pop.querySelectorAll("select[data-flt], input[data-flt]")) {
      if (el.tagName === "SELECT") el.selectedIndex = 0;
      else if (el.type === "checkbox") el.checked = true;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    update();
  });
  update();
  return { update, button: btn, panel: pop };
}
