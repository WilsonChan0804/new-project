/* Right-click menu.
 *
 * The reference viewers put the next likely action under the right mouse
 * button, where the hand already is, instead of across the screen in a
 * toolbar. One small module serves both pages; each page supplies the
 * entries that make sense for what was clicked.
 *
 * Entries: { label, key?, action, disabled?, danger? } or "-" for a rule.
 */

let menu = null;

function ensure() {
  if (menu) return menu;
  menu = document.createElement("div");
  menu.id = "ctxmenu";
  menu.hidden = true;
  document.body.appendChild(menu);

  const close = () => { menu.hidden = true; };
  // Any click elsewhere, a scroll, a resize or Escape dismisses it.
  document.addEventListener("pointerdown", (ev) => {
    if (!menu.hidden && !menu.contains(ev.target)) close();
  }, true);
  addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });
  addEventListener("resize", close);
  addEventListener("blur", close);
  document.addEventListener("scroll", close, true);
  return menu;
}

export function openMenu(x, y, entries) {
  const m = ensure();
  m.innerHTML = "";

  for (const e of entries) {
    if (e === "-") {
      const hr = document.createElement("div");
      hr.className = "ctx-sep";
      m.appendChild(hr);
      continue;
    }
    if (!e) continue;
    const b = document.createElement("button");
    b.className = "ctx-item" + (e.danger ? " danger" : "");
    b.disabled = !!e.disabled;
    b.innerHTML = `<span>${e.label}</span>`
      + (e.key ? `<kbd>${e.key}</kbd>` : "");
    b.addEventListener("click", () => {
      m.hidden = true;
      try { e.action(); } catch (err) { console.error(err); }
    });
    m.appendChild(b);
  }

  // Show first, measure, then keep it on screen: a menu opened near the
  // right or bottom edge must flip rather than run off the page.
  m.hidden = false;
  m.style.left = "0px";
  m.style.top = "0px";
  const r = m.getBoundingClientRect();
  const px = Math.min(x, innerWidth - r.width - 6);
  const py = Math.min(y, innerHeight - r.height - 6);
  m.style.left = Math.max(6, px) + "px";
  m.style.top = Math.max(6, py) + "px";
}

export function closeMenu() {
  if (menu) menu.hidden = true;
}
