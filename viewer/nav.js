/* Header links shared by the sheet and 3D pages: Dashboard, Admin, who is
 * signed in, and sign out. Kept separate from app.js and model.js so both
 * pages get the same behaviour from one file.
 *
 * It also adapts the sign-in form when the server runs with accounts
 * (email + password instead of name + shared passphrase), sends someone
 * with a temporary password to set their own, marks the page read-only for
 * a Viewer, and offers the project's members as assignees.
 */

import { installSearch } from "./search.js";
import { startNotify } from "./notify.js";


/* Which version of the viewer this browser is running - shown small beside
   the name, so "I can't see the new button" can be told apart from "the
   server still has the old files" at a glance. */
const LWK_VERSION = "2026-10-14";
(function () {
  const b = document.querySelector(".brand");
  if (b && !b.querySelector(".ver")) {
    const s = document.createElement("small");
    s.className = "ver";
    s.textContent = LWK_VERSION.slice(5);
    b.title = "LWK Viewer " + LWK_VERSION;
    b.appendChild(s);
  }
})();
const TOKEN_KEY = "lwk-viewer:token";
const PROJECT_KEY = "lwk-viewer:project";

export function project() {
  const q = new URLSearchParams(location.search).get("project");
  if (q) return q;
  try { return localStorage.getItem(PROJECT_KEY) || ""; } catch (e) { return ""; }
}

export function headers(json) {
  const h = {};
  if (json) h["Content-Type"] = "application/json";
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) h["X-Viewer-Token"] = t;
  } catch (e) {}
  const p = project();
  if (p) h["X-Project"] = p;
  return h;
}

export async function api(path, opts) {
  opts = opts || {};
  const res = await fetch(path, Object.assign({}, opts,
    { headers: Object.assign(headers(!!opts.body), opts.headers || {}) }));
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    const err = new Error((data && data.detail) || ("HTTP " + res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

/* A page's last answer kept on this device (per account), shown at once on
   the next visit while the server is asked again - as the Messenger does.
   Signing out clears them. */
const KEEP = "lwk-viewer:keep:";
export function keptCopy(name) {
  try {
    const u = localStorage.getItem(KEEP + "uid");
    return u ? JSON.parse(localStorage.getItem(KEEP + u + ":" + name) || "null") : null;
  } catch (e) { return null; }
}
export function keepCopy(name, value, uid) {
  try {
    if (uid) localStorage.setItem(KEEP + "uid", String(uid));
    const u = localStorage.getItem(KEEP + "uid");
    if (!u) return;
    const s = JSON.stringify(value);
    if (s.length > 1500000) { localStorage.removeItem(KEEP + u + ":" + name); return; }
    localStorage.setItem(KEEP + u + ":" + name, s);
  } catch (e) { /* full: the next visit simply waits for the server */ }
}

export const link = (page, extra) => {
  const p = project();
  const q = new URLSearchParams();
  if (p) q.set("project", p);
  for (const [k, v] of Object.entries(extra || {})) if (v) q.set(k, v);
  const s = q.toString();
  return page + (s ? "?" + s : "");
};

export async function signOut() {
  /* offline.js: changes still waiting to upload stay on the device (the
     person is asked first), and the service worker forgets the answers it
     kept for this sign-in. */
  try {
    if (window.LWKOffline && window.LWKOffline.beforeSignOut
        && !(await window.LWKOffline.beforeSignOut())) return;
  } catch (e) {}
  try { await fetch("/api/logout", { method: "POST" }); } catch (e) {}
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  // the Messenger's copy of the last chats (chat.js) is this person's
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("lwk-viewer:chat:") || k.startsWith(KEEP)) localStorage.removeItem(k);
  } catch (e) {}
  location.href = "index.html";
}

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* The sign-in form says "email" and "password" when accounts are on. */
async function adaptGate() {
  let info;
  try { info = await (await fetch("/api/ping")).json(); } catch (e) { return; }
  if (!info || !info.accounts) return;
  const name = document.getElementById("gate-name");
  const pass = document.getElementById("gate-pass");
  if (!name || !pass) return;
  const relabel = (input, text) => {
    const label = input.closest("label");
    if (label && label.firstChild && label.firstChild.nodeType === 3) {
      label.firstChild.textContent = text;
    }
  };
  relabel(name, "Email");
  relabel(pass, "Password");
  name.type = "email";
  name.autocomplete = "username";
  pass.autocomplete = "current-password";
  name.placeholder = "you@lwk.com";
  try {
    const last = localStorage.getItem("lwk-viewer:email");
    if (last) name.value = last;
  } catch (e) {}
  name.addEventListener("change", () => {
    try { localStorage.setItem("lwk-viewer:email", name.value.trim()); } catch (e) {}
  });
}

let ME = null;

/* Once signed in: header links, role, assignee list. */
async function afterSignIn() {
  for (let i = 0; i < 600; i++) {
    try {
      ME = await api("/api/me");
      break;
    } catch (e) {
      if (e.status !== 401) return;             // server trouble: leave the page alone
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!ME) return;
  if (ME.user && ME.user.must_change) {
    location.href = "admin.html?first=1&next="
      + encodeURIComponent(location.pathname + location.search) + "#account";
    return;
  }
  const p = project();
  const role = !ME.accounts || ME.site_admin ? "admin" : (ME.projects || {})[p] || "";
  const managesSomething = ME.site_admin
    || Object.values(ME.projects || {}).some((r) => r === "admin");
  document.body.dataset.role = role;
  document.body.classList.toggle("role-viewer", role === "viewer");

  const header = document.querySelector("header");
  if (header && !document.getElementById("lwk-nav")) {
    const nav = document.createElement("div");
    nav.id = "lwk-nav";
    nav.innerHTML =
      `<a href="#" id="lwk-send-task" title="Keep this sheet or 3D view on a task (Tasks page)">+ Task</a>`
      + (managesSomething && ME.accounts
        ? `<a href="${link("admin.html")}" title="People and project members">Admin</a>` : "")
      + (ME.user
        ? `<span class="who" title="${esc(ME.user.email)}">${esc(ME.user.name)}`
          + (role === "viewer" ? ` <em>viewer</em>` : "") + `</span>`
          + `<a href="${link("admin.html")}#account" title="Password">Account</a>`
          + `<a href="#" id="lwk-signout">Sign out</a>`
        : "");
    header.appendChild(nav);
    // The page links in the same place and order as on every other page:
    // Projects, Sheets, 3D, Board, Tasks, Chat, Calendar, Dashboard - in the group
    // that already holds this page's Sheets and 3D buttons.
    const mode = header.querySelector(".mode");
    if (mode && !document.getElementById("lwk-to-projects")) {
      const mk = (id, label, page, title, cls) => {
        const b = document.createElement("button");
        b.id = id;
        b.textContent = label;
        b.title = title;
        if (cls) b.className = cls;
        b.onclick = () => { location.href = link(page); };
        return b;
      };
      mode.classList.add("page-links");
      mode.insertBefore(mk("lwk-to-projects", "Projects", "projects.html", "Your projects: their sheets, 3D, tasks, issues, files and chat"), mode.firstChild);
      mode.appendChild(mk("lwk-to-board", "Board", "board.html", "Whiteboards: notes, mind maps, rules and ideas for the team"));
      mode.appendChild(mk("lwk-to-tasks", "Tasks", "tasks.html", "Team task lists: who does what, by when"));
      mode.appendChild(mk("lwk-to-chat", "Chat", "messenger.html", "Messenger: project channels, group chats, direct messages", "chat-link"));
      mode.appendChild(mk("lwk-to-cal", "Calendar", "calendar.html", "Meetings, your tasks and issues by date - and in Outlook"));
      mode.appendChild(mk("lwk-to-folders", "Folders", "folders.html", "The project's files: folders on the server, pinned and starred documents"));
      mode.appendChild(mk("lwk-to-dash", "Dashboard", "dashboard.html", "Issues and tasks of this project"));
      chatBadge.on = false;
      setTimeout(chatBadge, 300);
    }
    setTimeout(startNotify, 400);
    const st = document.getElementById("lwk-send-task");
    if (st) st.onclick = (ev) => { ev.preventDefault(); sendToTask(); };
    const so = document.getElementById("lwk-signout");
    if (so) so.onclick = (ev) => { ev.preventDefault(); signOut(); };
  }

  if (role === "viewer") {
    const bar = document.createElement("div");
    bar.id = "readonly-bar";
    bar.textContent = "You are a Viewer on this project: you can look and read, "
      + "but not add or change issues and comments.";
    document.body.appendChild(bar);
    setTimeout(() => bar.remove(), 8000);
  }

  // The issue forms' "Assign to" drops down the project's members.
  if (ME.accounts && p) {
    try {
      const m = await api("/api/members");
      MEMBERS = (m.members || []).filter((x) => x.active);
      wireMemberPicker();
      wireMentions();
    } catch (e) { /* no members list: typing a name still works */ }
  }
}

/* "+ Task": the sheet or 3D place on screen now, as a link kept on a task.
   The sheet page keeps the sheet number; the 3D page the point looked at,
   which model.html?at= flies back to. */
function viewLink() {
  const p = project();
  const base = location.origin + location.pathname.replace(/[^/]*$/, "");
  const sh = window.SHEETS && window.SHEETS.S && window.SHEETS.S.sheet;
  if (sh) {
    return { url: base + "index.html?" + new URLSearchParams({ project: p, sheet: sh.number }).toString(),
             title: "Sheet " + sh.number + (sh.name ? " - " + sh.name : "") };
  }
  // elements selected in 3D: the task keeps them ("elements to change")
  const els = window.LWK3D && window.LWK3D.selectedElements ? window.LWK3D.selectedElements() : [];
  if (els.length) {
    const keys = els.map((e) => e.uid || e.id).filter(Boolean).slice(0, 40);
    const cats = [...new Set(els.map((e) => e.category).filter(Boolean))];
    return { url: base + "model.html?" + new URLSearchParams({ project: p, elements: keys.join(",") }).toString(),
             title: els.length === 1 ? `${els[0].category || "Element"}: ${els[0].name || els[0].id}` : `${els.length} elements: ${cats.slice(0, 3).join(", ")}`,
             elements: els };
  }
  const L = window.LWK;
  if (L && L.S && L.S.controls && L.sceneToInternalMM) {
    const mm = L.sceneToInternalMM(L.S.controls.target).map((n) => Math.round(n));
    return { url: base + "model.html?" + new URLSearchParams({ project: p, at: mm.join(","), label: "a task" }).toString(),
             title: "3D view" };
  }
  return { url: location.href, title: document.title };
}

function sendToTask() {
  const v = viewLink();
  // the element list is handed over beside the address (it can be long)
  try {
    if (v.elements) localStorage.setItem("lwk-viewer:attach-elements", JSON.stringify({ url: v.url, elements: v.elements.slice(0, 500), at: Date.now() }));
  } catch (e) {}
  window.open(link("tasks.html", { attach: v.url, title: v.title }), "_blank");
}

/* ------------------------------------------------ assignee drop-down */

/* A real drop-down under every "Assign to" box - a <datalist> only shows
   suggestions once something is typed, and not at all on an iPhone. The
   box still accepts a typed name, for someone outside the project. */
let MEMBERS = [];
const ASSIGN_INPUTS = "#f-assignee, #detail-assignee, #i3-assignee";

function wireMemberPicker() {
  if (wireMemberPicker.done) return;
  wireMemberPicker.done = true;
  const pick = document.createElement("div");
  pick.id = "member-pick";
  pick.hidden = true;
  document.body.appendChild(pick);
  let input = null;

  const show = (inp) => {
    input = inp;
    const q = (inp.value || "").trim().toLowerCase();
    const list = MEMBERS.filter((m) => !q || m.name.toLowerCase().includes(q)
      || (m.email || "").toLowerCase().includes(q) || (m.office || "").toLowerCase().includes(q)
      || m.name.toLowerCase() === q);
    const all = q && list.length === 0 ? MEMBERS : list;
    pick.innerHTML = `<div class="mp-row mp-none" data-v="">Unassigned</div>`
      + all.map((m) => `<div class="mp-row" data-v="${esc(m.name)}"><b>${esc(m.name)}</b>`
        + `<span>${esc([m.office, m.company, m.role === "viewer" ? "viewer" : ""].filter(Boolean).join(" · "))}</span></div>`).join("")
      + (MEMBERS.length ? "" : `<div class="mp-empty">No members on this project yet.</div>`);
    const r = inp.getBoundingClientRect();
    pick.style.left = Math.max(4, Math.min(innerWidth - 284, r.left)) + "px";
    pick.style.width = Math.max(220, r.width) + "px";
    const below = innerHeight - r.bottom;
    pick.style.maxHeight = Math.max(140, Math.min(300, Math.max(below, r.top) - 12)) + "px";
    if (below < 180 && r.top > below) {
      pick.style.top = ""; pick.style.bottom = (innerHeight - r.top + 4) + "px";
    } else {
      pick.style.bottom = ""; pick.style.top = (r.bottom + 4) + "px";
    }
    pick.hidden = false;
  };
  const hide = () => { pick.hidden = true; input = null; };

  document.addEventListener("focusin", (ev) => {
    if (ev.target.matches && ev.target.matches(ASSIGN_INPUTS)) {
      ev.target.removeAttribute("list");
      ev.target.setAttribute("autocomplete", "off");
      show(ev.target);
    }
  });
  document.addEventListener("click", (ev) => {
    if (ev.target.matches && ev.target.matches(ASSIGN_INPUTS)) show(ev.target);
  });
  document.addEventListener("input", (ev) => {
    if (ev.target.matches && ev.target.matches(ASSIGN_INPUTS)) show(ev.target);
  });
  document.addEventListener("focusout", (ev) => {
    if (ev.target === input) setTimeout(() => { if (document.activeElement !== input) hide(); }, 150);
  });
  addEventListener("scroll", () => { if (input) show(input); }, true);
  // pointerdown, so the choice lands before the box loses focus
  pick.addEventListener("pointerdown", (ev) => {
    const row = ev.target.closest(".mp-row");
    if (!row || !input) return;
    ev.preventDefault();
    input.value = row.dataset.v;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const inp = input;
    hide();
    inp.blur();
  });
}

/* ------------------------------------------------------ @mentions */

/* Typing @ in a comment (or a description) lists the project's members;
   choosing one writes "@Full Name". The server tells that person in the
   Teams channel with a real Teams @mention (by their email), so it reaches
   them as a notification, not just a line in a channel. */
const MENTION_INPUTS = "#detail-newc, #detail-desc, #i3-desc, #f-desc, #f-comment";
export const members = () => MEMBERS.slice();

function wireMentions() {
  if (wireMentions.done) return;
  wireMentions.done = true;
  const pick = document.createElement("div");
  pick.id = "mention-pick";
  pick.hidden = true;
  document.body.appendChild(pick);
  let box = null, start = -1, rows = [], cur = 0;

  const hide = () => { pick.hidden = true; box = null; start = -1; };
  const token = (ta) => {
    const upto = ta.value.slice(0, ta.selectionStart);
    const m = /(^|[\s(])@([^\s@]{0,30})$/.exec(upto);
    return m ? { at: upto.length - m[2].length - 1, q: m[2].toLowerCase() } : null;
  };
  const paint = () => {
    pick.innerHTML = rows.map((m, i) => `<div class="mp-row${i === cur ? " on" : ""}" data-i="${i}">`
      + `<b>${esc(m.name)}</b><span>${esc([m.office, m.company].filter(Boolean).join(" · "))}</span></div>`).join("");
  };
  const show = (ta) => {
    const t = token(ta);
    if (!t || !MEMBERS.length) return hide();
    rows = MEMBERS.filter((m) => !t.q || m.name.toLowerCase().includes(t.q)
      || (m.email || "").toLowerCase().startsWith(t.q)).slice(0, 8);
    if (!rows.length) return hide();
    box = ta; start = t.at; cur = 0;
    paint();
    const r = ta.getBoundingClientRect();
    pick.style.left = Math.max(4, Math.min(innerWidth - 264, r.left)) + "px";
    pick.style.width = Math.min(260, Math.max(200, r.width)) + "px";
    if (innerHeight - r.bottom < 200 && r.top > 200) {
      pick.style.top = ""; pick.style.bottom = (innerHeight - r.top + 4) + "px";
    } else {
      pick.style.bottom = ""; pick.style.top = (r.bottom + 4) + "px";
    }
    pick.hidden = false;
  };
  const choose = (m) => {
    if (!box || !m) return;
    const ta = box, end = ta.selectionStart;
    const ins = "@" + m.name + " ";
    ta.value = ta.value.slice(0, start) + ins + ta.value.slice(end);
    const at = start + ins.length;
    ta.setSelectionRange(at, at);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    hide();
    ta.focus();
  };
  document.addEventListener("input", (ev) => {
    if (ev.target.matches && ev.target.matches(MENTION_INPUTS)) show(ev.target);
  });
  document.addEventListener("keydown", (ev) => {
    if (pick.hidden || ev.target !== box) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      cur = (cur + (ev.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length;
      paint(); ev.preventDefault();
    } else if (ev.key === "Enter" || ev.key === "Tab") {
      choose(rows[cur]); ev.preventDefault();
    } else if (ev.key === "Escape") { hide(); }
  }, true);
  document.addEventListener("focusout", (ev) => {
    if (ev.target === box) setTimeout(() => { if (document.activeElement !== box) hide(); }, 150);
  });
  pick.addEventListener("pointerdown", (ev) => {
    const row = ev.target.closest(".mp-row");
    if (!row) return;
    ev.preventDefault();
    choose(rows[Number(row.dataset.i)]);
  });
}

/* The members named with @ in a text, by their exact names. */
export function mentionsIn(text) {
  const t = String(text || "").toLowerCase();
  return MEMBERS.filter((m) => m.name && t.includes("@" + m.name.toLowerCase())).map((m) => m.name);
}

// for the issue panel, without it importing this module
window.LWKMentions = { mentionsIn, members };

export const me = () => ME;

/* The issue windows move with their title bar (and stay where they were
   put, for this browser). */
function draggable(sel) {
  const dlg = document.querySelector(sel);
  const head = dlg && dlg.querySelector("h3");
  if (!head) return;
  const key = "lwk.dlgpos." + sel;
  try {
    const p = JSON.parse(localStorage.getItem(key) || "null");
    if (p && innerWidth > 900) Object.assign(dlg.style, { left: Math.min(p.x, innerWidth - 120) + "px", top: Math.min(p.y, innerHeight - 60) + "px", right: "auto" });
  } catch (e) {}
  let from = null;
  head.addEventListener("pointerdown", (ev) => {
    const r = dlg.getBoundingClientRect();
    from = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
    head.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  head.addEventListener("pointermove", (ev) => {
    if (!from) return;
    const x = Math.max(0, Math.min(innerWidth - 80, ev.clientX - from.dx));
    const y = Math.max(0, Math.min(innerHeight - 40, ev.clientY - from.dy));
    Object.assign(dlg.style, { left: x + "px", top: y + "px", right: "auto" });
  });
  const end = () => {
    if (!from) return;
    from = null;
    const r = dlg.getBoundingClientRect();
    try { localStorage.setItem(key, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) })); } catch (e) {}
  };
  head.addEventListener("pointerup", end);
  head.addEventListener("pointercancel", end);
}
draggable("#dialog");
draggable("#i3-dlg");

// The sheet and 3D pages; the dashboard and admin pages do this themselves.
if (document.getElementById("gate") && !document.body.classList.contains("own-nav")) {
  adaptGate();
  afterSignIn();
}


/* The number of unread chat messages beside every "Chat" link, on every
   page (Messenger: chat.py). Looked at every 30 seconds. */
export function chatBadge() {
  if (chatBadge.on) return;
  const links = () => document.querySelectorAll("a.chat-link, button.chat-link");
  if (!links().length) return;
  chatBadge.on = true;
  const paint = async (known) => {
    if (!known && document.hidden) return;
    let n = 0, m = 0;
    if (known) { n = known.total; m = known.mentions; }
    else { try { const r = await api("/api/chat/unread"); n = r.total; m = r.mentions; } catch (e) { return; } }
    for (const a of links()) {
      let b = a.querySelector(".chat-badge");
      if (!b) { b = document.createElement("b"); b.className = "chat-badge"; a.appendChild(b); }
      b.hidden = !n;
      b.textContent = n > 99 ? "99+" : String(n);
      b.classList.toggle("at", !!m);
      b.title = m ? m + " mention" + (m > 1 ? "s" : "") + " of you" : n + " unread";
    }
  };
  paint();
  setInterval(paint, 30000);
  // notify.js knows at once when a message comes
  window.addEventListener("lwk-unread", (ev) => paint(ev.detail));
}
// after the page has drawn its header (and signed in)
setTimeout(() => { try { if (localStorage.getItem(TOKEN_KEY)) { chatBadge(); startNotify(); } } catch (e) {} }, 2500);


/* The project pickers (Board, Dashboard, the sheets and 3D pages): the viewer
   projects you can open, listed under the names of their projects - a
   project with several parts (Site 1, Site 2) as a group. */
export async function projectOptions(current, fallback) {
  const e = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const opt = (id, label) => `<option value="${e(id)}"${id === current ? " selected" : ""}>${e(label)}</option>`;
  try {
    const r = await api("/api/project-choices");
    // every project under its own title, its models (one or several) below
    let h = "";
    const titles = {};
    for (const p of r.projects) {
      const head = p.name + (p.code && p.code !== p.name ? " · " + p.code : "");
      // the option keeps the project's name, so the closed drop-down still says it
      h += `<optgroup label="${e(head)}">` + p.parts.map((x) => opt(x.id, p.parts.length === 1 ? p.name : p.name + " · " + x.title)).join("") + `</optgroup>`;
      for (const x of p.parts) titles[x.id] = head;
    }
    if (r.others.length) h += `<optgroup label="Not on the Projects page">` + r.others.map((x) => opt(x.id, x.title)).join("") + `</optgroup>`;
    return { html: h, titles, ids: r.projects.flatMap((p) => p.parts.map((x) => x.id)).concat(r.others.map((x) => x.id)) };
  } catch (err) {
    return fallback ? fallback() : { html: "", ids: [] };
  }
}

// the search on every page (search.js): its button goes into #lwk-nav
if (document.querySelector("header")) installSearch();

/* Project first, then its model or sheet set: the one long drop-down
   (every project with its parts under it) shown as two. They are built
   from that drop-down itself - its groups are the projects, their options
   the parts (and, on the Sheets page, the PDF sets) - and choosing sets
   its value and fires its change, so each page goes on as before. The
   original stays in the page, hidden. */
const PHONE_Q = "(max-width: 700px), (pointer: coarse) and (max-height: 520px)";
export function projectTwoStep(sel) {
  if (!sel || sel._two) return;
  const proj = document.createElement("select");
  const part = document.createElement("select");
  proj.className = (sel.className || "") + " two-proj";
  part.className = (sel.className || "") + " two-part";
  proj.title = "Project";
  part.title = "Model / sheet set of this project";
  const wrap = document.createElement("span");
  wrap.className = "two-wrap";
  wrap.append(proj, part);
  sel.before(wrap);
  sel._two = { proj, part, wrap };
  /* On a phone the header is one row that scrolls sideways, and the two
     drop-downs at its far end were off the screen: there they go first,
     just after the logo. */
  const home = document.createComment("two-step");
  wrap.before(home);
  // a phone, upright or on its side (wider than 700 then, but no room either)
  const phone = matchMedia(PHONE_Q);
  const place = () => {
    const brand = document.querySelector("header .brand");
    if (phone.matches && brand && brand.parentNode === wrap.parentNode) brand.after(wrap);
    else home.after(wrap);
  };
  place();
  if (phone.addEventListener) phone.addEventListener("change", place);
  const NOT = "Not on the Projects page";
  const groups = () => {
    const out = [];
    for (const n of sel.children) {
      if (n.tagName === "OPTGROUP" && n.label !== NOT) {
        out.push({ key: "g:" + n.label, label: n.label, opts: [...n.querySelectorAll("option")] });
      } else if (n.tagName === "OPTGROUP") {
        for (const o of n.querySelectorAll("option")) out.push({ key: "o:" + o.value, label: o.textContent, opts: [o] });
      } else if (n.tagName === "OPTION") {
        out.push({ key: "o:" + n.value, label: n.textContent, opts: [n] });
      }
    }
    return out;
  };
  const shortName = (label, o) => {
    const t = (o.textContent || "").trim();
    const head = label.split(" · ")[0];
    const s = t.startsWith(head + " · ") ? t.slice(head.length + 3) : t;
    return s === head || s === label ? "Model and sheets" : s;
  };
  let painting = false;
  const paint = () => {
    painting = true;
    const gs = groups();
    const cur = sel.selectedOptions[0] || sel.options[0];
    const at = gs.find((g) => g.opts.includes(cur)) || gs[0];
    const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    // a phone: the short name only (the code is cut off anyway)
    const small = matchMedia(PHONE_Q).matches;
    proj.innerHTML = gs.map((g) => `<option value="${esc(g.key)}"${g === at ? " selected" : ""}>${esc(small ? g.label.split(" · ")[0] : g.label)}</option>`).join("");
    part.innerHTML = at ? at.opts.map((o) => `<option value="${esc(o.value)}"${o === cur ? " selected" : ""}>${esc(shortName(at.label, o))}</option>`).join("") : "";
    // shown even with one: it says which model / sheet set this is
    part.hidden = !at || !at.opts.length;
    proj.hidden = sel.hidden && gs.length < 2 && part.hidden;
    sel.hidden = true;
    sel.style.display = "none";
    painting = false;
  };
  const choose = (value) => {
    if (sel.value === value) return;
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  };
  proj.onchange = () => {
    const g = groups().find((x) => x.key === proj.value);
    if (!g || !g.opts.length) return;
    let want = g.opts[0].value;
    try { const k = localStorage.getItem("lwk-viewer:part:" + g.key); if (k && g.opts.some((o) => o.value === k)) want = k; } catch (e) {}
    choose(want);
    paint();
  };
  part.onchange = () => {
    try { localStorage.setItem("lwk-viewer:part:" + proj.value, part.value); } catch (e) {}
    choose(part.value);
  };
  new MutationObserver(() => { if (!painting) paint(); }).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ["selected", "label"] });
  sel.addEventListener("change", () => { if (!painting) paint(); });
  paint();
}
