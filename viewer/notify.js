/* Notifications for chat messages, on every page (loaded by nav.js).
 *
 * While any viewer page is open - in a tab, a window or the installed app -
 * it waits on /api/chat/notify, which the server holds open until something
 * changes, so a new message is known within a second or two:
 *   - a system notification (Windows / macOS / Android), unless that chat
 *     is open in front of you; a click opens the chat at the message;
 *   - "(3)" in the tab's title and the number on the app's icon;
 *   - the Chat links' badges, at once.
 *
 * The bell in the header: turn notifications on (the browser asks once),
 * choose all messages / only @mentions and direct messages / none, turn on
 * push for this device (messages arrive with no page open - needs the
 * https address, see push.py), and install the viewer as an app.
 */

import { showWhatsNew } from "./whatsnew.js";
import { setTheme, themeHtml } from "./theme.js";

const TOKEN_KEY = "lwk-viewer:token";
const SEEN_KEY = "lwk-viewer:notified";
const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } };

async function call(path, opts) {
  const o = Object.assign({}, opts || {});
  o.headers = Object.assign({ "X-Viewer-Token": token(), "Content-Type": "application/json" }, o.headers || {});
  const r = await fetch(path, o);
  if (!r.ok) {
    let m = r.statusText;
    try { m = (await r.json()).detail || m; } catch (e) {}
    throw new Error(m);
  }
  return r.json();
}

const N = {
  rev: 0, total: 0, mentions: 0, inbox: 0, level: "all", muted: [],
  installEv: null, started: false,
};

const hasNotes = () => "Notification" in window;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
const pushable = () => window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window;

/* --------------------------------------------------------------- the loop */

function seen(id) {
  try {
    const l = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
    if (l.includes(id)) return true;
    l.push(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify(l.slice(-200)));
  } catch (e) {}
  return false;
}

/* the chat open in front of the person: no notification for it */
function inFront(room) {
  return !document.hidden && document.hasFocus() && window.LWKOpenRoom === room;
}

async function show(n) {
  if (!hasNotes() || Notification.permission !== "granted") return;
  if ((!n.inbox && inFront(n.room)) || seen(n.id)) return;
  const opts = { body: n.body, tag: n.id, icon: "icons/icon-192.png", badge: "icons/icon-192.png",
                 data: { url: n.url } };
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && reg.showNotification) { await reg.showNotification(n.title, opts); return; }
  } catch (e) {}
  try {
    const x = new Notification(n.title, opts);
    x.onclick = () => { window.focus(); location.href = n.url; x.close(); };
  } catch (e) { /* Android Chrome only allows it from the worker */ }
}

function counts(total, mentions) {
  N.total = total; N.mentions = mentions;
  const want = (total ? `(${total > 99 ? "99+" : total}) ` : "") + document.title.replace(/^\(\d+\+?\)\s*/, "");
  if (document.title !== want) document.title = want;
  try {
    if (navigator.setAppBadge) { if (total) navigator.setAppBadge(total); else navigator.clearAppBadge(); }
  } catch (e) {}
  window.dispatchEvent(new CustomEvent("lwk-unread", { detail: { total, mentions } }));
  paintBell();
}

async function loop() {
  let fails = 0;
  for (;;) {
    if (!token()) return;
    try {
      const r = await call(`/api/chat/notify?since=${N.rev}${N.rev ? "&wait=25" : ""}`);
      if (r.same) continue;
      if (N.rev) for (const n of r.items || []) show(n);
      N.rev = r.rev;
      if (r.level) N.level = r.level;
      if (r.muted) N.muted = r.muted;
      if (r.inbox !== undefined) N.inbox = r.inbox;
      if (r.total !== undefined) counts(r.total, r.mentions || 0);
      if ((r.items || []).some((x) => x.inbox) && panel) paintPanel();
      fails = 0;
      // a page in the background asks less often (the browser slows it anyway)
      if (document.hidden) await new Promise((res) => setTimeout(res, 1500));
    } catch (e) {
      fails++;
      await new Promise((res) => setTimeout(res, Math.min(60000, 3000 * fails)));
    }
  }
}

/* ---------------------------------------------------------------- the bell */

const BELL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;

function css() {
  if (document.getElementById("lwk-notify-css")) return;
  const s = document.createElement("style");
  s.id = "lwk-notify-css";
  s.textContent = `
#lwk-bell { display: inline-flex; align-items: center; gap: 4px; position: relative; cursor: pointer; }
#lwk-bell .dot { position: absolute; top: 2px; right: 2px; width: 8px; height: 8px; border-radius: 50%; background: #e11d48; border: 1.5px solid #fff; }
#lwk-bell .dot[hidden], #lwk-bell .cnt[hidden] { display: none; }
#lwk-bell .cnt { position: absolute; top: -4px; right: -6px; min-width: 15px; height: 15px; padding: 0 3px; border-radius: 8px; background: #e11d48;
  color: #fff; font: 700 10px/15px system-ui, sans-serif; text-align: center; box-sizing: border-box; }
.lwk-np { max-height: calc(100vh - 70px); overflow-y: auto; }
.lwk-np h4 { display: flex; align-items: center; }
.lwk-np .lnk { margin-left: auto; border: 0 !important; background: none !important; color: var(--accent-deep, #d1660e) !important; font-size: 11px !important; padding: 0 !important; }
.np-list { display: flex; flex-direction: column; gap: 2px; max-height: 260px; overflow-y: auto; }
.np-it { display: flex; gap: 8px; padding: 6px; border-radius: 6px; text-decoration: none; color: inherit; }
.np-it:hover { background: rgba(242,128,34,.1); }
.np-it.new { background: rgba(242,128,34,.08); }
.np-it.new b { color: var(--accent-deep, #d1660e); }
.np-k { flex: none; width: 22px; height: 22px; border-radius: 50%; background: var(--accent-soft, #ffeedd); color: var(--accent-deep, #d1660e); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; }
.np-t { display: flex; flex-direction: column; min-width: 0; }
.np-t b { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.np-t small { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lwk-np { position: fixed; z-index: 10000; width: 330px; max-width: calc(100vw - 16px); background: var(--panel, #fff); color: var(--ink, #1f2937);
  border-radius: 10px; box-shadow: 0 12px 36px rgba(0,0,0,.22); padding: 14px; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
.lwk-np h4 { margin: 0 0 6px; font-size: 13px; }
.lwk-np section { padding: 10px 0; border-top: 1px solid var(--line-soft, #eef0f3); }
.lwk-np section:first-of-type { border-top: 0; padding-top: 0; }
.lwk-np label { display: flex !important; flex-direction: row !important; gap: 8px; align-items: flex-start; justify-content: flex-start;
  padding: 3px 0; margin: 0; cursor: pointer; text-align: left; font-weight: 400; width: auto; }
.lwk-np label > span { flex: 1; }
.lwk-np input[type=radio] { flex: none; width: 16px !important; height: 16px !important; margin: 2px 0 0 !important; padding: 0 !important;
  box-shadow: none !important; border: 0; accent-color: #f28022; }
.lwk-np .muted { color: var(--muted, #6b7280); font-size: 12px; }
.lwk-np button { font: inherit; padding: 5px 12px; border-radius: 6px; border: 1px solid var(--line-2, #d0d5dd); background: var(--panel, #fff); color: var(--ink-2, #414a5a); cursor: pointer; }
.lwk-np button.pri { background: #f28022; color: #fff; border-color: #f28022; font-weight: 600; }
.lwk-np .ok { color: var(--ok, #067647); font-weight: 600; }
.lwk-np .bad { color: var(--bad, #b42318); }
`;
  document.head.appendChild(s);
}

function placeBell() {
  if (document.getElementById("lwk-bell")) return true;
  const nav = document.getElementById("lwk-nav");
  if (!nav) return false;
  const b = document.createElement("a");
  b.href = "#";
  b.id = "lwk-bell";
  b.title = "Notifications and the app";
  b.innerHTML = BELL + `<b class="dot" hidden></b>`;
  b.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); togglePanel(b); };
  const s = document.getElementById("lwk-search-btn");
  if (s && s.parentNode === nav) nav.insertBefore(b, s.nextSibling); else nav.insertBefore(b, nav.firstChild);
  paintBell();
  return true;
}

function paintBell() {
  const b = document.getElementById("lwk-bell");
  if (!b) return;
  // a dot until notifications are on (and not refused) - the way in
  const off = hasNotes() && Notification.permission === "default" && N.level !== "off";
  b.querySelector(".dot").hidden = !off && !N.inbox;
  let n = b.querySelector(".cnt");
  if (!n) { n = document.createElement("b"); n.className = "cnt"; b.appendChild(n); }
  n.hidden = !N.inbox;
  n.textContent = N.inbox > 99 ? "99+" : String(N.inbox || "");
  if (N.inbox) b.querySelector(".dot").hidden = true;
  b.title = N.inbox ? `${N.inbox} new for you - tasks, issues and @mentions` : "Notifications and the app";
}

const KIND_ICON = { mention: "@", assigned: "&#9745;", done: "&#10003;", comment: "&#128172;", issue: "!", due: "&#9200;", task: "&#9745;" };
async function recentHtml() {
  let r;
  try { r = await call("/api/chat/inbox"); } catch (e) { return ""; }
  if (!r.items.length) return `<section><h4>For you</h4><span class="muted">Tasks given to you, @mentions on tasks and issues, issues assigned to you - they show here.</span></section>`;
  const esc = (t) => String(t || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const when = (a) => { const d = new Date(a); return isNaN(d) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
  return `<section><h4>For you ${r.unread ? `<button class="lnk" data-np="readall">Mark all read</button>` : ""}</h4><div class="np-list">`
    + r.items.slice(0, 20).map((x) => `<a class="np-it${x.read ? "" : " new"}" href="${esc(x.url)}" data-in="${esc(x.id)}">`
      + `<span class="np-k">${KIND_ICON[x.kind] || "&#8226;"}</span><span class="np-t"><b>${esc(x.title)}</b><small>${esc(x.body)}</small><small class="muted">${esc(when(x.at))}</small></span></a>`).join("")
    + `</div></section>`;
}

let panel = null;
function closePanel() { if (panel) { panel.remove(); panel = null; } }

async function togglePanel(anchor) {
  if (panel) return closePanel();
  panel = document.createElement("div");
  panel.className = "lwk-np";
  document.body.appendChild(panel);
  const r = anchor.getBoundingClientRect();
  panel.style.top = Math.round(r.bottom + 6) + "px";
  panel.style.left = Math.max(8, Math.min(innerWidth - panel.offsetWidth - 8, r.right - panel.offsetWidth)) + "px";
  await paintPanel();
  const off = (ev) => {
    if (panel && !panel.contains(ev.target) && !ev.target.closest("#lwk-bell")) { closePanel(); document.removeEventListener("pointerdown", off, true); }
  };
  document.addEventListener("pointerdown", off, true);
  const esc = (ev) => { if (ev.key === "Escape") { closePanel(); document.removeEventListener("keydown", esc); } };
  document.addEventListener("keydown", esc);
}

async function pushState() {
  if (!pushable()) return { can: false };
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
    return { can: true, on: !!sub };
  } catch (e) { return { can: true, on: false }; }
}

async function paintPanel() {
  if (!panel) return;
  const perm = hasNotes() ? Notification.permission : "none";
  const ps = await pushState();
  const lv = (v, t, d) => `<label><input type="radio" name="lwk-lv" value="${v}"${N.level === v ? " checked" : ""}> <span>${t}<br><span class="muted">${d}</span></span></label>`;
  let note;
  if (perm === "granted") note = `<span class="ok">On for this browser</span>`;
  else if (perm === "denied") note = `<span class="bad">Blocked</span> <span class="muted">- allow notifications for this site in the browser's settings (the padlock by the address), then reload.</span>`;
  else if (perm === "none") note = isIOS() && !standalone()
    ? `<span class="muted">On iPhone and iPad: install the app first (below), then turn them on from the app.</span>`
    : `<span class="muted">This browser cannot show notifications.</span>`;
  else note = `<button class="pri" data-np="perm">Turn on notifications</button>`;
  let push;
  if (!window.isSecureContext) push = `<span class="muted">Needs the https address of the viewer (ask your admin) - on this http address notifications come while a viewer page or the app is open.</span>`;
  else if (!ps.can) push = `<span class="muted">This browser cannot receive push messages${isIOS() && !standalone() ? " - install the app first" : ""}.</span>`;
  else if (ps.on) push = `<span class="ok">On for this device</span> <button data-np="test">Send a test</button> <button data-np="pushoff">Turn off</button>`;
  else push = `<button data-np="pushon"${perm === "denied" ? " disabled" : ""}>Turn on for this device</button>`;
  let inst;
  if (standalone()) inst = `<span class="ok">Running as an app</span>`;
  else if (N.installEv) inst = `<button class="pri" data-np="install">Install the app</button> <span class="muted">its own window and icon, a badge with the unread count</span>`;
  else if (isIOS()) inst = `<span class="muted">In Safari: tap Share <b>&#x2191;</b>, then <b>Add to Home Screen</b>.</span>`;
  else inst = `<span class="muted">In Edge or Chrome: the <b>Install</b> icon at the right of the address bar (or menu &gt; Apps &gt; Install this site as an app). On Android: menu &gt; Add to Home screen.</span>`;
  const recent = await recentHtml();
  if (!panel) return;
  panel.innerHTML = recent + `<section><h4>Chat notifications</h4>${note}</section>
    <section><h4>Tell me about</h4>
      ${lv("all", "Every message", "in all my chats (muted chats left out)")}
      ${lv("mentions", "@mentions and direct messages", "group chats stay quiet unless I'm mentioned")}
      ${lv("off", "Nothing", "the unread counts only")}</section>
    <section><h4>When no page is open (push)</h4>${push}</section>
    <section><h4>The app</h4>${inst}</section>
    <section><h4>Look</h4>${themeHtml()}</section>
    <section><button class="lnk" data-np="whatsnew">What's new in the viewer</button></section>`;
  panel.onchange = async (ev) => {
    const r = ev.target.closest("input[name=lwk-lv]");
    if (!r) return;
    try { const p = await call("/api/chat/notify-settings", { method: "POST", body: JSON.stringify({ level: r.value }) }); N.level = p.level; paintBell(); }
    catch (e) { alert(e.message); }
  };
  panel.onclick = async (ev) => {
    const it = ev.target.closest("[data-in]");
    if (it) { call("/api/chat/inbox/read", { method: "POST", body: JSON.stringify({ ids: [it.dataset.in] }) }).catch(() => {}); return; }
    const b = ev.target.closest("[data-np]");
    if (!b) return;
    if (b.dataset.np === "readall") {
      ev.preventDefault();
      await call("/api/chat/inbox/read", { method: "POST", body: JSON.stringify({ all: true }) }).catch(() => {});
      N.inbox = 0; paintBell(); paintPanel();
      return;
    }
    const k = b.dataset.np;
    b.disabled = true;
    try {
      if (k === "perm") { await askPermission(); }
      else if (k === "pushon") { await pushOn(); }
      else if (k === "pushoff") { await pushOff(); }
      else if (k === "test") {
        const r = await call("/api/push/test", { method: "POST", body: "{}" });
        if (!r.devices) alert("No device of yours has push on - press Turn on for this device first.");
        else if (!r.sent) alert("Not delivered:\n\n" + r.results.map((x) => "- " + (x.device ? x.device.split(") ")[0] + ") " : "") + x.why).join("\n")
          + "\n\n(The server signs as " + r.contact + ".)");
        else alert(`Sent to ${r.sent} of ${r.devices} device${r.devices === 1 ? "" : "s"} - it should show in a moment.`);
      }
      else if (k === "install") { N.installEv.prompt(); await N.installEv.userChoice; N.installEv = null; }
      else if (k === "whatsnew") { closePanel(); showWhatsNew(); return; }
      else if (k.startsWith("theme:")) { setTheme(k.slice(6)); }
    } catch (e) { alert(e.message); }
    paintBell();
    paintPanel();
  };
}

async function askPermission() {
  if (!hasNotes()) return "none";
  const p = await Notification.requestPermission();
  // push too, when it can be had: the same "yes" covers it
  if (p === "granted" && window.isSecureContext && pushable()) { try { await pushOn(); } catch (e) {} }
  return p;
}

async function pushOn() {
  if (!pushable()) throw new Error("This browser cannot receive push messages here");
  if (hasNotes() && Notification.permission !== "granted") {
    if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications were not allowed");
  }
  const k = await call("/api/push/key");
  if (!k.key) throw new Error(k.why || "Push is not set up on the server");
  const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register("sw.js"));
  await navigator.serviceWorker.ready;
  const raw = Uint8Array.from(atob(k.key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - k.key.length % 4) % 4)), (c) => c.charCodeAt(0));
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
  await call("/api/push/subscribe", { method: "POST", body: JSON.stringify({ subscription: sub.toJSON() }) });
}

async function pushOff() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (!sub) return;
  await call("/api/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
  await sub.unsubscribe();
}

/* ------------------------------------------------------------- the start */

window.addEventListener("beforeinstallprompt", (ev) => { ev.preventDefault(); N.installEv = ev; });
window.addEventListener("appinstalled", () => { N.installEv = null; });

/* a click on a notification shown by the worker, while a page is open */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (ev) => {
    const d = ev.data || {};
    if (d.type === "open-url" && d.url) location.href = d.url;
  });
}

export function startNotify() {
  if (N.started || !token()) return;
  N.started = true;
  css();
  let tries = 0;
  const tick = () => { if (!placeBell() && ++tries < 120) setTimeout(tick, 500); };
  tick();
  loop();
  // the worker makes the viewer installable as an app from any page
  if (window.isSecureContext && "serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistration().then((r) => r || navigator.serviceWorker.register("sw.js")).catch(() => {});
  }
  // a device that turned push on keeps its subscription fresh on the server
  if (window.isSecureContext && pushable() && hasNotes() && Notification.permission === "granted") {
    pushState().then((s) => { if (s.on) pushOn().catch(() => {}); });
  }
}

export const notifyState = () => ({ rev: N.rev, total: N.total, level: N.level, muted: N.muted.slice() });
/* mute / unmute one chat (Chat info) */
export async function muteRoom(id, on) {
  const p = await call("/api/chat/notify-settings", { method: "POST", body: JSON.stringify({ mute_room: id, on }) });
  N.muted = p.muted; N.level = p.level;
  return p;
}
window.LWKNotify = { state: notifyState, askPermission, pushOn, pushOff, muteRoom };
