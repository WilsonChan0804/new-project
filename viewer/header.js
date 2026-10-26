/* One header on every page, in one layout: the logo, the project picker
 * (always top left, beside the logo), the page tabs, then Search, the bell,
 * Help and your profile at the right.
 *
 * The pages still write their own <header> (each its own way, with the ids
 * their scripts use); this rearranges it once it is there. Their own page
 * links and project drop-downs stay in the page, hidden, so nothing that
 * reads them breaks. On Sheets and 3D the page's tools (Comment / Issue,
 * Files, Navigate, Measure, Floor plan ...) move to a toolbar row of their
 * own under the header.
 */

const TABS = [
  ["projects", "Projects", "projects.html", "Your projects"],
  ["dashboard", "Dashboard", "dashboard.html", "Issues and tasks of this project"],
  ["sheets", "Sheets", "index.html", "The project's drawings, with markups and issues"],
  ["3d", "3D", "model.html", "The project's 3D model"],
  ["board", "Board", "board.html", "Whiteboards: notes, mind maps, rules and ideas"],
  ["tasks", "Tasks", "tasks.html", "Team task lists: who does what, by when"],
  ["chat", "Chat", "messenger.html", "Project channels, group chats, direct messages"],
  ["calendar", "Calendar", "calendar.html", "Meetings, tasks and issues by date"],
  ["folders", "Folders", "folders.html", "The project's files"],
];

const PAGE_OF = {
  "projects.html": "projects", "dashboard.html": "dashboard", "index.html": "sheets", "": "sheets",
  "model.html": "3d", "board.html": "board", "tasks.html": "tasks", "messenger.html": "chat",
  "calendar.html": "calendar", "folders.html": "folders", "admin.html": "admin",
};

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const initials = (s) => {
  const w = String(s || "").replace(/[^A-Za-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  return ((w[0] || "?")[0] + (w[1] ? w[1][0] : (w[0] || "").slice(1, 2))).toUpperCase();
};
const CHEV = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;

export function pageId() {
  const f = location.pathname.split("/").pop() || "";
  return PAGE_OF[f] || f.replace(/\.html$/, "");
}

export function installHeader({ api, project, link }) {
  const header = document.querySelector("body > header");
  if (!header || header.classList.contains("app-head") || document.body.classList.contains("embed")) return;
  header.classList.add("app-head");
  const page = pageId();
  document.body.dataset.page = page;

  // the logo: home is the Projects page
  const brand = header.querySelector(".brand");
  if (brand) {
    brand.classList.add("hd-brand");
    brand.title = "LWK + Partners - your projects";
    brand.style.cursor = "pointer";
    brand.addEventListener("click", () => { location.href = link("projects.html"); });
  }

  // each page's own links, retired (kept for the ids their scripts set)
  for (const g of header.querySelectorAll(".seg")) g.classList.add("hd-old");
  const firstMode = header.querySelector(":scope > .mode");
  if (firstMode && /Sheets|3D/.test(firstMode.textContent) && !firstMode.querySelector("#mode-comment, #m-nav")) {
    firstMode.classList.add("page-links", "hd-old");
  }

  // the project picker
  const pick = document.createElement("button");
  pick.type = "button";
  pick.id = "hd-proj";
  pick.className = "hd-proj";
  pick.setAttribute("aria-haspopup", "menu");
  pick.innerHTML = `<span class="hd-pi">··</span><span class="hd-pt"><b>Project</b><small>Choose a project</small></span>${CHEV}`;
  if (brand) brand.after(pick); else header.prepend(pick);

  // the page tabs
  const tabs = document.createElement("nav");
  tabs.id = "hd-tabs";
  tabs.setAttribute("aria-label", "Pages");
  tabs.innerHTML = TABS.map(([id, label, href, title]) =>
    `<a href="${esc(link(href))}" data-tab="${id}" title="${esc(title)}"${id === "chat" ? ` class="chat-link"` : ""}`
    + `${id === page ? ` aria-current="page"` : ""}>${esc(label)}</a>`).join("");
  pick.after(tabs);
  // the links carry the project: keep them current if a page changes it in place
  const relink = () => {
    for (const a of tabs.querySelectorAll("a[data-tab]")) {
      const t = TABS.find((x) => x[0] === a.dataset.tab);
      a.href = link(t[2]);
    }
  };

  // Sheets and 3D: the page's own tools on a toolbar row of their own
  if (page === "sheets" || page === "3d") {
    const bar = document.createElement("div");
    bar.className = "page-bar";
    bar.id = "page-bar";
    const keep = (n) => n === brand || n === pick || n === tabs || n.classList.contains("hd-old")
      || n.id === "lwk-nav" || n.id === "lwk-me" || n.id === "conn" || n.id === "project"
      || n.classList.contains("spacer") || n.classList.contains("hdr-brk");
    for (const n of [...header.children]) if (!keep(n)) bar.appendChild(n);
    // 3D: its second row's contents, straight onto the toolbar
    const row2 = bar.querySelector(".hdr-row2");
    if (row2) { while (row2.firstChild) bar.insertBefore(row2.firstChild, row2); row2.remove(); }
    header.after(bar);
    const conn = header.querySelector("#conn");
    if (conn) bar.appendChild(conn);
    // Sheets, as in the template: Comment / + Issue, Files and + Task sit on the drawing's own
    // toolbar; the extra row is kept (hidden) only for the drop-downs nothing shows any more
    const tools = page === "sheets" && document.getElementById("tools");
    if (tools) {
      const acts = document.createElement("div");
      acts.className = "tb-acts";
      acts.id = "tb-acts";
      const mode = bar.querySelector("#mode-comment");
      if (mode) acts.appendChild(mode.closest(".mode"));
      for (const sel of ["#files-btn", ".hdr-files", "#export-all"]) { const n = bar.querySelector(sel); if (n) acts.appendChild(n); }
      tools.after(acts);
      bar.classList.add("pb-hidden");
    }
  }

  // the project picker's list: projects, and the parts of a project of several
  let CH = null;
  const paint = () => {
    const cur = project();
    let name = "", sub = "";
    if (CH) {
      for (const p of CH.projects) {
        const part = p.parts.find((x) => x.id === cur);
        if (part) { name = p.name; sub = p.parts.length > 1 ? part.title : (p.code || ""); break; }
      }
      if (!name) { const o = CH.others.find((x) => x.id === cur); if (o) { name = o.title || o.id; sub = ""; } }
    }
    if (!name && cur) name = cur;
    pick.querySelector(".hd-pi").textContent = name ? initials(name) : "+";
    pick.querySelector(".hd-pt b").textContent = name || "No project";
    pick.querySelector(".hd-pt small").textContent = name ? (sub || " ") : "Choose a project";
    pick.title = name ? `Project: ${name}${sub ? " · " + sub : ""} - click to switch` : "Choose a project";
    relink();
  };
  const load = async () => {
    try { CH = await api("/api/project-choices"); } catch (e) { CH = null; }
    paint();
  };
  paint();
  // only once signed in (the sign-in form has no token yet)
  const tryLoad = () => {
    let t = null;
    try { t = localStorage.getItem("lwk-viewer:token"); } catch (e) {}
    if (t) load(); else setTimeout(tryLoad, 1500);
  };
  tryLoad();

  const go = (id) => {
    try { localStorage.setItem("lwk-viewer:project", id); sessionStorage.setItem("lwk-viewer:tab-project", id); } catch (e) {}
    const here = location.pathname.split("/").pop() || "index.html";
    location.href = here + "?project=" + encodeURIComponent(id);
  };

  let menu = null;
  const close = () => { if (menu) { menu.remove(); menu = null; pick.setAttribute("aria-expanded", "false"); } };
  const open = () => {
    close();
    menu = document.createElement("div");
    menu.id = "hd-proj-menu";
    menu.setAttribute("role", "menu");
    const cur = project();
    const rows = [];
    if (CH) {
      for (const p of CH.projects) {
        if (!p.parts.length) continue;
        if (p.parts.length === 1) {
          rows.push({ id: p.parts[0].id, name: p.name, sub: p.code || "", ini: initials(p.name), on: p.parts[0].id === cur, q: (p.name + " " + p.code + " " + p.full).toLowerCase() });
        } else {
          rows.push({ head: p.name, sub: p.code || "", ini: initials(p.name), q: (p.name + " " + p.code + " " + p.full).toLowerCase() });
          for (const x of p.parts) rows.push({ id: x.id, name: x.title, sub: "", part: true, on: x.id === cur, q: (p.name + " " + p.code + " " + x.title).toLowerCase() });
        }
      }
      if (CH.others.length) {
        rows.push({ head: "Not on the Projects page", sub: "", q: "" , plain: true });
        for (const o of CH.others) rows.push({ id: o.id, name: o.title || o.id, sub: "", part: true, on: o.id === cur, q: (o.title + " " + o.id).toLowerCase() });
      }
    }
    const row = (r) => r.head
      ? `<div class="hm-head${r.plain ? " plain" : ""}" data-q="${esc(r.q)}">${r.plain ? "" : `<span class="hd-pi">${esc(r.ini)}</span>`}<span><b>${esc(r.head)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</span></div>`
      : `<button type="button" role="menuitem" class="hm-row${r.part ? " part" : ""}${r.on ? " on" : ""}" data-id="${esc(r.id)}" data-q="${esc(r.q)}">`
        + (r.part ? "" : `<span class="hd-pi">${esc(r.ini)}</span>`)
        + `<span><b>${esc(r.name)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</span>${r.on ? `<span class="hm-tick">&#10003;</span>` : ""}</button>`;
    menu.innerHTML = (rows.length > 8 ? `<input type="search" class="hm-q" placeholder="Find a project" aria-label="Find a project">` : "")
      + `<div class="hm-list">${rows.map(row).join("") || `<div class="hm-empty">${CH ? "You are not on any project yet." : "Loading ..."}</div>`}</div>`
      + `<a class="hm-all" href="${esc(link("projects.html"))}">All projects &rarr;</a>`;
    document.body.appendChild(menu);
    const r = pick.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, r.left)) + "px";
    menu.style.top = (r.bottom + 6) + "px";
    pick.setAttribute("aria-expanded", "true");
    const q = menu.querySelector(".hm-q");
    if (q) {
      q.focus();
      q.oninput = () => {
        const s = q.value.trim().toLowerCase();
        for (const el of menu.querySelectorAll("[data-q]")) el.hidden = !!s && !el.dataset.q.includes(s);
      };
    }
    menu.onclick = (ev) => {
      const b = ev.target.closest(".hm-row");
      if (!b) return;
      close();
      if (b.dataset.id !== project()) go(b.dataset.id);
    };
    if (!CH) load().then(() => { if (menu) open(); });
  };
  pick.onclick = (ev) => { ev.stopPropagation(); if (menu) close(); else open(); };
  document.addEventListener("click", (ev) => { if (menu && !menu.contains(ev.target) && ev.target !== pick) close(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });
  addEventListener("resize", close);

  // Search, the bell, Help and the profile always last, at the right
  const settle = () => {
    const nav = header.querySelector("#lwk-nav");
    if (nav) nav.classList.add("hd-right");
    // "+ Task" keeps the sheet or 3D view on a task: a page tool, so on the page's toolbar
    const bar = document.getElementById("page-bar");
    const st = document.getElementById("lwk-send-task");
    const home = document.getElementById("tb-acts") || document.getElementById("v3-more-items") || bar;
    if (home && st && st.parentNode !== home) { st.classList.add("pb-task"); if (home === bar) bar.insertBefore(st, bar.querySelector("#conn")); else home.appendChild(st); }
    const sq = document.getElementById("lwk-send-query");
    if (home && sq && sq.parentNode !== home) { sq.classList.add("pb-task"); if (home === bar) bar.insertBefore(sq, bar.querySelector("#conn")); else home.appendChild(sq); }
    // a project of one model / one sheet set: nothing to choose there
    for (const sel of document.querySelectorAll(".page-bar .two-part")) {
      const one = sel.options.length <= 1;
      if (sel.hidden !== one) sel.hidden = one;
    }
    const s = document.getElementById("lwk-search-btn");
    if (s && !s.querySelector(".hd-kbd")) s.insertAdjacentHTML("beforeend", `<span class="hd-kbd">Ctrl K</span>`);
  };
  settle();
  new MutationObserver(settle).observe(header, { childList: true, subtree: true });
  const pb = document.getElementById("page-bar");
  if (pb) new MutationObserver(settle).observe(pb, { childList: true, subtree: true });
}
