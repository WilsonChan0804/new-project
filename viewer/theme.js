/* Light, dark, or as the computer / phone is set (Auto). Remembered per
 * device; applied as soon as a page loads (nav.js imports this first).
 * The colours themselves are variables in style.css (:root and
 * :root[data-theme=dark]). Drawings, PDFs and the whiteboard stay paper-white. */

const KEY = "lwk-viewer:theme";
const media = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;

export function getTheme() {
  try { return localStorage.getItem(KEY) || "light"; } catch (e) { return "light"; }
}

export function applyTheme() {
  const t = getTheme();
  const dark = t === "dark" || (t === "auto" && media && media.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="color-scheme"]') || document.head.appendChild(Object.assign(document.createElement("meta"), { name: "color-scheme" }));
  meta.content = dark ? "dark" : "light";
  window.dispatchEvent(new CustomEvent("lwk-theme", { detail: { dark } }));
}

export function setTheme(t) {
  try { localStorage.setItem(KEY, t); } catch (e) {}
  applyTheme();
}

export function themeHtml() {
  const cur = getTheme();
  const b = (k, label) => `<button data-np="theme:${k}" class="${cur === k ? "pri" : ""}" aria-pressed="${cur === k}">${label}</button>`;
  return `${b("light", "Light")} ${b("dark", "Dark")} ${b("auto", "Auto")} <span class="muted">Auto follows your computer or phone</span>`;
}

applyTheme();
if (media && media.addEventListener) media.addEventListener("change", () => { if (getTheme() === "auto") applyTheme(); });
