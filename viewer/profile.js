/* One profile button at the top right of every page, instead of Admin,
 * Account, Sign out, the "online - name" chip and Offline side by side.
 *
 * The pages keep building those as before (each its own way); this finds
 * them in the header, hides them, and offers them in a menu. Nothing is
 * rebuilt, so what they do stays theirs. Two stay in sight when they have
 * something to say: the connection chip when it is not plain "online"
 * (offline, changes waiting), and Offline while it shows a state
 * (offline, downloading, uploading).
 */
import { getTheme, setTheme } from "./theme.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function parts(header) {
  const nav = header.querySelector("#lwk-nav");
  const q = (s) => (nav ? nav.querySelector(s) : null);
  const who = q(".who");
  const shown = (el) => el && !el.hidden;
  const admin = nav ? [...nav.querySelectorAll('a[href*="admin.html"]')].find((a) => !/#account/.test(a.getAttribute("href") || "") && shown(a)) : null;
  const account = q('a[href*="#account"]');
  const signout = nav ? [...nav.querySelectorAll('[id$="signout"]')].find(shown) : null;
  const conn = document.getElementById("conn");
  // the name: the page's own "who", else the connection chip's "online - name"
  let name = who ? (who.firstChild && who.firstChild.nodeType === 3 ? who.firstChild.textContent : who.textContent).trim() : "";
  if (!name && conn) { const m = /online - (.+)$/.exec(conn.textContent || ""); if (m) name = m[1].trim(); }
  return { nav, who, name, email: who ? who.title || "" : "", viewer: !!(who && who.querySelector("em")),
           admin, account, signout, conn, off: document.getElementById("off-btn") };
}

const initials = (n) => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";

function status(P) {
  const off = P.off && P.off.classList.contains("is-off");
  const bad = P.conn && !P.conn.classList.contains("ok") && /offline/i.test(P.conn.textContent || "");
  if (off || bad || (navigator.onLine === false)) return { cls: "off", text: "Offline" };
  if (P.conn && !P.conn.classList.contains("ok") && (P.conn.textContent || "").trim()) return { cls: "wait", text: P.conn.textContent.trim() };
  return { cls: "on", text: "Online" };
}

function sync(header) {
  const P = parts(header);
  let chip = document.getElementById("lwk-me");
  if (!chip) {
    chip = document.createElement("button");
    chip.id = "lwk-me";
    chip.type = "button";
    chip.className = "me-chip";
    chip.setAttribute("aria-haspopup", "menu");
    chip.addEventListener("click", (ev) => { ev.stopPropagation(); toggleMenu(header, chip); });
    header.appendChild(chip);
    header.classList.add("has-me");
  } else if (chip.nextElementSibling) header.appendChild(chip);    // always last
  const st = status(P);
  const html = `<span class="me-av">${esc(initials(P.name))}</span><span class="me-dot ${st.cls}"></span>`;
  if (chip.innerHTML !== html) chip.innerHTML = html;
  chip.title = (P.name ? P.name + " - " : "") + st.text + ". Account, Admin, Offline, Sign out";
}

function toggleMenu(header, chip) {
  const old = document.getElementById("lwk-me-menu");
  if (old) { old.remove(); return; }
  const P = parts(header);
  const st = status(P);
  const m = document.createElement("div");
  m.id = "lwk-me-menu";
  m.className = "me-menu";
  m.setAttribute("role", "menu");
  const theme = getTheme();
  m.innerHTML = `<div class="me-head"><span class="me-av big">${esc(initials(P.name))}</span><div><b>${esc(P.name || "Signed in")}</b>`
    + (P.email ? `<small>${esc(P.email)}</small>` : "") + (P.viewer ? `<small>Viewer on this project</small>` : "")
    + `<small class="me-st ${st.cls}"><i></i>${esc(st.text)}</small></div></div>`
    + (P.off ? `<button data-me="off" role="menuitem">Work offline ...<small>Keep this project on this device; what is waiting to upload</small></button>` : "")
    + (P.admin ? `<button data-me="admin" role="menuitem">Admin<small>People and project members</small></button>` : "")
    + `<button data-me="account" role="menuitem">Account<small>Your password</small></button>`
    + `<div class="me-theme"><span>Theme</span>${["light", "dark", "auto"].map((k) => `<button data-theme="${k}" class="${theme === k ? "on" : ""}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div>`
    + (P.signout ? `<hr><button data-me="signout" role="menuitem" class="me-out">Sign out</button>` : "");
  document.body.appendChild(m);
  const r = chip.getBoundingClientRect();
  m.style.top = (r.bottom + 6) + "px";
  m.style.right = Math.max(6, innerWidth - r.right) + "px";
  const close = () => { m.remove(); document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", esc_, true); };
  const away = (ev) => { if (!m.contains(ev.target) && ev.target !== chip && !chip.contains(ev.target)) close(); };
  const esc_ = (ev) => { if (ev.key === "Escape") close(); };
  document.addEventListener("pointerdown", away, true);
  document.addEventListener("keydown", esc_, true);
  m.addEventListener("click", (ev) => {
    const t = ev.target.closest("button[data-theme]");
    if (t) {
      setTheme(t.dataset.theme);
      m.querySelectorAll("[data-theme]").forEach((b) => b.classList.toggle("on", b === t));
      return;
    }
    const b = ev.target.closest("[data-me]");
    if (!b) return;
    const k = b.dataset.me;
    close();
    if (k === "off" && P.off) P.off.click();
    if (k === "admin" && P.admin) location.href = P.admin.href;
    if (k === "account") location.href = P.account ? P.account.href : "admin.html#account";
    if (k === "signout" && P.signout) P.signout.click();
  });
}

/* Watches the header: the pages fill it in their own time. */
export function installProfile() {
  const header = document.querySelector("header");
  if (!header || header.dataset.me) return;
  header.dataset.me = "1";
  let t = 0;
  const run = () => { t = 0; try { sync(header); } catch (e) {} };
  new MutationObserver(() => { if (!t) t = setTimeout(run, 50); })
    .observe(header, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden"] });
  window.addEventListener("online", run);
  window.addEventListener("offline", run);
  run();
}
