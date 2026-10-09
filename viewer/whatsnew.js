/* What's new: after each update, a small card lists what changed, once.
 * The list is kept here, newest first; each release adds its entry when
 * it raises LWK_VERSION (nav.js). The bell panel's "What's new" opens the
 * whole list at any time. Nothing leaves the page: what has been seen is
 * remembered in this browser. */

export const ENTRIES = [
  {
    version: "2026-10-16", date: "9 Oct 2026",
    items: [
      "**Copy link** to a sheet, an issue, a project or an exact **3D view** (camera, section, floor) - the 🔗 buttons.",
      "**Dark mode**: the bell > Look > Dark (or Auto, to follow your computer or phone).",
      "**Sections fold** on a project's panel and on the Admin page, and stay as you left them.",
      "**Folders** remembers which folders you had open; the sheet list and the chat list keep your place in view.",
      "Notes look the same everywhere, and lists show grey placeholders while they load.",
      "This **What's new** card - shown once after each update.",
    ],
  },
  {
    version: "2026-10-13", date: "8 Oct 2026",
    items: [
      "Projects are listed by status (**Active**, On hold, Completed, Archived), then by name - here and in every project drop-down. The Projects page sorts by any column.",
      "Folders show the **date and time** a file was changed.",
      "Phones: pinch zoom keeps the spot between your fingers.",
    ],
  },
  {
    version: "2026-10-12", date: "8 Oct 2026",
    items: [
      "**00 BIM** in every project's Folders: its 2D sheets and 3D models, always up to date, to open and download (read-only).",
      "3D: show a whole model **in one colour** to compare it with another; ↺ puts it back.",
      "Phones and tablets: documents open with every page to scroll and zoom.",
    ],
  },
];

const SEEN = "lwk-viewer:whatsnew-seen";
const md = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

function css() {
  if (document.getElementById("wn-css")) return;
  const s = document.createElement("style");
  s.id = "wn-css";
  s.textContent = `
#wn-card { position: fixed; left: 16px; bottom: 16px; z-index: 1500; width: 360px; max-width: calc(100vw - 32px);
  max-height: min(70vh, 560px); overflow: auto; background: var(--panel, #fff); color: var(--ink, #1f2430);
  border: 1px solid var(--line, #e2e6ec); border-top: 4px solid var(--accent, #f28022); border-radius: 10px;
  box-shadow: 0 12px 34px rgba(20, 26, 36, .22); padding: 14px 16px 12px; font-size: 13px; }
#wn-card h3 { margin: 0 0 2px; font-size: 15px; }
#wn-card .wn-v { color: var(--muted, #6b7480); font-size: 11px; margin: 10px 0 4px; font-weight: 600; }
#wn-card ul { margin: 0; padding-left: 18px; }
#wn-card li { margin: 4px 0; line-height: 1.4; }
#wn-card .wn-btns { display: flex; justify-content: flex-end; gap: 6px; margin: 12px -16px -12px; padding: 8px 16px 12px;
  position: sticky; bottom: -12px; background: var(--panel, #fff); border-top: 1px solid var(--line-soft, #eef0f3); }
#wn-card .wn-x { position: absolute; top: 8px; right: 8px; border: 0; background: none; font-size: 16px; cursor: pointer; color: var(--muted, #6b7480); }
@media (max-width: 600px) { #wn-card { left: 8px; right: 8px; bottom: 8px; width: auto; } }`;
  document.head.appendChild(s);
}

function card(entries, all) {
  document.getElementById("wn-card")?.remove();
  css();
  const el = document.createElement("div");
  el.id = "wn-card";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "What's new");
  el.innerHTML = `<button class="wn-x" title="Close" data-wn="x">&#10005;</button><h3>What's new</h3>`
    + entries.map((e) => `<div class="wn-v">${md(e.date)} &middot; version ${md(e.version.slice(5))}</div>`
      + `<ul>${e.items.map((t) => `<li>${md(t)}</li>`).join("")}</ul>`).join("")
    + `<div class="wn-btns">${all ? "" : `<button class="ghost" data-wn="all">Show all</button>`}<button class="primary" data-wn="x">Got it</button></div>`;
  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-wn]");
    if (!b) return;
    if (b.dataset.wn === "all") return card(ENTRIES, true);
    el.remove();
  });
  document.body.appendChild(el);
}

/* After an update: what is newer than what this browser last saw, once.
   A browser that has never seen any: the latest entry only. */
export function checkWhatsNew(version) {
  let seen = "";
  try { seen = localStorage.getItem(SEEN) || ""; } catch (e) { return; }
  const fresh = ENTRIES.filter((e) => e.version <= version && (seen ? e.version > seen : e === ENTRIES[0]));
  try { localStorage.setItem(SEEN, version); } catch (e) {}
  if (!fresh.length) return;
  const show = () => card(fresh, false);
  if (document.readyState === "complete") setTimeout(show, 1200); else addEventListener("load", () => setTimeout(show, 1200));
}

export function showWhatsNew() { card(ENTRIES, true); }
