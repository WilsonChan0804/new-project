/* The task panel on the right: everything about one task - who, when,
 * sub-tasks, what it is linked to (issues, sheets, 3D views, OneDrive and
 * ACC files), the discussion and the history. */

import { METHOD_OPTS, isMethod, ic } from "./tasks-util.js";
import { $, esc, avatar, people, fmtDate, fmtWhen, ago, isOverdue, priorityPill, pickPeople, pickOne, pickDate, PRIORITIES, toast, modal } from "./tasks-util.js";
import { chip, makeLink, classify, linkify } from "./filelinks.js";
import { upload, filesHtml, pendingHtml, catchFiles } from "./uploads.js";

let PEND = [];           // files waiting to go with the next comment

let CUR = null;          // { id, comments, activity, loadedFor }

export function close(T) {
  $("#t-detail").hidden = true;
  document.body.classList.remove("detail-on");
  CUR = null;
  T.closeTask();
}

export async function open(T, id) {
  if (!CUR || CUR.id !== id) PEND = [];
  CUR = { id, comments: [], activity: [], loading: true };
  $("#t-detail").hidden = false;
  document.body.classList.add("detail-on");
  paint(T);
  await loadExtra(T);
}

async function loadExtra(T) {
  const id = CUR && CUR.id;
  const t = T.task(id);
  if (!t || t.fresh && !t.number) { if (CUR) { CUR.loading = false; paint(T); } return; }
  try {
    const r = await T.api("/api/tasks/" + encodeURIComponent(id));
    if (!CUR || CUR.id !== id) return;
    CUR.comments = r.comments;
    CUR.activity = r.activity;
  } catch (e) { /* not on the server yet */ }
  if (CUR) { CUR.loading = false; paint(T); }
}

/* called after a save or a sync: keep what is being typed */
export function refresh(T) {
  if (!CUR) return;
  const t = T.task(CUR.id);
  if (!t) return close(T);
  if (t.comment_count !== CUR.commentCount) { CUR.commentCount = t.comment_count; loadExtra(T); }
  const a = document.activeElement;
  if (a && a.closest && a.closest("#t-detail") && /INPUT|TEXTAREA/.test(a.tagName)) return;
  paint(T);
}

function row(label, html, act) {
  return `<div class="td-r"><span class="td-l">${label}</span><div class="td-v${act ? " act" : ""}" ${act ? `data-act="${act}"` : ""}>${html}</div></div>`;
}

function issueUrl(l) {
  return l.url || `index.html?project=${encodeURIComponent(l.project)}&select=${encodeURIComponent(l.ref)}`;
}

function paint(T) {
  const box = $("#t-detail");
  const t = T.task(CUR.id);
  if (!t) { box.hidden = true; return; }
  CUR.commentCount = t.comment_count;
  const ed = T.canEdit();
  const g = T.S.groups.get(t.group_id);
  const parent = t.parent_id && T.task(t.parent_id);
  const kids = T.children(t.id);
  const meUid = T.me && T.me.uid;
  const following = (t.subscribers || []).some((s) => s.uid != null && s.uid === meUid);
  const issues = t.links.filter((l) => l.kind === "issue");
  const others = t.links.filter((l) => l.kind !== "issue");
  const scroll = box.querySelector(".td-body") ? box.querySelector(".td-body").scrollTop : 0;

  const seq = T.sequence(), at = seq.indexOf(t.id);
  box.innerHTML = `<div class="td-top">
      <button class="ghost td-backbtn icon-btn" data-act="close" title="Back to the list">${ic("back", 18)} Back</button>
      <button class="td-done icon-btn${t.done ? " on" : ""}" data-act="done"${ed ? "" : " disabled"}>${t.done ? ic("check") + " Completed" : "Mark complete"}</button>
      <span class="spacer"></span>
      <span class="td-nav"><button class="ghost" data-act="prev" title="Previous task (K)"${at > 0 ? "" : " disabled"}>${ic("up")}</button>`
        + `<small class="muted">${at >= 0 ? at + 1 + " / " + seq.length : ""}</small>`
        + `<button class="ghost" data-act="next" title="Next task (J)"${at >= 0 && at < seq.length - 1 ? "" : " disabled"}>${ic("down")}</button></span>
      ${T.S.accounts ? `<button class="ghost icon-btn" data-act="follow" title="${following ? "Following - you get emails when it changes. Click to stop" : "Get emails when it changes or someone comments"}">${ic(following ? "bell" : "belloff")}<span class="lab">${following ? "Following" : "Follow"}</span></button>` : ""}
      <button class="ghost icon-btn" data-act="share" title="Send this task to a chat in the Messenger">${ic("share")}<span class="lab">Share</span></button>
      <button class="ghost" data-act="copy" title="Copy a link to this task">${ic("link")}</button>
      ${ed ? `<button class="ghost danger" data-act="delete" title="Delete task">${ic("trash")}</button>` : ""}
      <button class="ghost td-x" data-act="close" title="Close">${ic("close")}</button>
    </div>
    <div class="td-body">
      ${parent ? `<a href="#" class="td-parent" data-open="${esc(parent.id)}">&larr; ${esc(parent.title || "Parent task")}</a>` : ""}
      <textarea class="td-title" rows="1" placeholder="Task title"${ed ? "" : " readonly"}>${esc(t.title)}</textarea>
      <div class="td-num muted">${t.number ? "#" + t.number + " · " : ""}created by ${esc(t.created_by || "?")} ${t.created_at ? esc(ago(t.created_at)) : ""}</div>
      ${row("&#128100; Owners", people(t.owners, 6) || `<span class="muted">Add owner</span>`, ed && "owners")}
      ${row("&#128197; Dates", `<span data-act="start" class="${ed ? "act" : ""}">${t.start ? esc(fmtDate(t.start, true)) : `<span class="muted">Start</span>`}</span> &ndash; `
        + `<span data-act="due" class="${ed ? "act" : ""} ${isOverdue(t) ? "bad" : ""}">${t.due ? esc(fmtDate(t.due, true)) : `<span class="muted">Due</span>`}</span>`)}
      ${row("&#9776; Group", `${esc(T.S.list.title)} / <b>${esc(g ? g.title : "-")}</b>`
        + (g && g.project ? ` <a class="td-proj" href="index.html?project=${encodeURIComponent(g.project)}">${esc(g.project)}</a>` : ""), ed && !parent && "group")}
      ${row("&#9873; Priority", priorityPill(t.priority), ed && "priority")}
      ${T.fields().map((f) => {
        const v = t.vals[f.id];
        const shown = f.type === "person" ? (people(v, 6) || `<span class="muted">Add</span>`)
          : f.type === "date" ? (v ? esc(fmtDate(v, true)) : `<span class="muted">-</span>`)
          : f.type === "check" ? `<span class="cbx${v ? " on" : ""}"></span>`
            + (f.name.trim().toLowerCase() === "milestone" ? ` <small class="muted">${v ? "a milestone - a gold diamond on the Gantt" : "tick to mark as a milestone"}</small>` : "")
          : isMethod(f) ? `<span class="sel-pill">${v === "AND" ? "AND" : "OR"}</span> <small class="muted">${v === "AND"
            ? `every owner completes their part${t.owners.length > 1 ? ` (${(t.vals[(T.fieldNamed("task completers") || {}).id] || []).length} of ${t.owners.length} done)` : ""}`
            : "done when any owner completes it"}</small>`
          : (v != null && v !== "" ? esc(v) : `<span class="muted">-</span>`);
        return row(esc(f.name), shown, ed && "f:" + f.id);
      }).join("")}
      <textarea class="td-desc" rows="3" placeholder="${ed ? "Add description" : ""}"${ed ? "" : " readonly"}>${esc(t.description)}</textarea>

      ${!parent ? `<h4>Sub-tasks ${kids.length ? `<span class="muted">${kids.filter((k) => k.done).length} / ${kids.length}</span>` : ""}</h4>
      <div class="td-subs">${kids.map((k) => `<div class="td-sub${k.done ? " done" : ""}" data-id="${esc(k.id)}">`
        + `<button class="tick${k.done ? " on" : ""}" data-act="subdone"></button><span class="td-st" data-open="${esc(k.id)}">${esc(k.title || "Untitled")}</span>`
        + `<span class="spacer"></span>${k.due ? `<small class="${isOverdue(k) ? "bad" : "muted"}">${esc(fmtDate(k.due))}</small>` : ""}${people(k.owners, 2)}</div>`).join("")}</div>
      ${ed ? `<input class="td-newsub" placeholder="+ Add sub-task, Enter">` : ""}` : ""}

      <h4>Linked issues ${issues.length ? `<span class="muted">${issues.length}</span>` : ""}</h4>
      <div class="fl-list">${issues.map((l) => chip({ ...l, url: issueUrl(l) }, { remove: ed })).join("") || `<span class="muted td-none">No issues linked</span>`}</div>
      ${ed ? `<button class="ghost td-add" data-act="linkissue">+ Link an issue${g && g.project ? " of " + esc(g.project) : ""}</button>` : ""}

      <h4>Files, sheets and 3D views ${others.length ? `<span class="muted">${others.length}</span>` : ""}</h4>
      <div class="fl-list">${others.map((l) => chip(l, { remove: ed })).join("") || `<span class="muted td-none">Paste a OneDrive, SharePoint or ACC link, or a sheet / 3D link from the viewer</span>`}</div>
      ${ed ? `<div class="fl-add"><input class="td-link" placeholder="https://... (OneDrive, SharePoint, ACC, viewer)"><button data-act="addlink">Add</button></div>` : ""}
      ${g && g.project ? `<div class="td-open">Open ${esc(g.project)}: <a href="index.html?project=${encodeURIComponent(g.project)}">Sheets</a> · <a href="model.html?project=${encodeURIComponent(g.project)}">3D</a> · <a href="dashboard.html?project=${encodeURIComponent(g.project)}">Issues dashboard</a></div>` : ""}

      <h4>Comments ${t.comment_count ? `<span class="muted">${t.comment_count}</span>` : ""}</h4>
      <div class="td-comments">${CUR.loading ? `<p class="muted">Loading ...</p>` : CUR.comments.map((c) =>
        `<div class="td-c">${avatar({ name: c.author })}<div><div class="td-ch"><b>${esc(c.author)}</b> <small class="muted" title="${esc(fmtWhen(c.created_at))}">${esc(ago(c.created_at))}</small>`
        + ((ed && (c.uid === meUid || !T.S.accounts)) && CUR.editing !== c.id ? ` <button class="ghost linkish" data-editc="${esc(c.id)}">edit</button>` : "")
        + ((ed && (c.uid === meUid || T.isOwner() || !T.S.accounts)) ? ` <button class="ghost linkish" data-delc="${esc(c.id)}">delete</button>` : "")
        + `</div>`
        + (CUR.editing === c.id
          ? `<div class="td-cedit"><textarea class="td-cedit-t" rows="3">${esc(c.body)}</textarea><div><button class="primary" data-savec="${esc(c.id)}">Save</button> <button class="ghost" data-cancelc>Cancel</button></div></div>`
          : `<div class="td-ct">${mentionify(linkify(esc(c.body)), T)}${c.edited_at ? ` <small class="muted">(edited)</small>` : ""}</div>`)
        + `${filesHtml(c.files)}</div></div>`).join("") || `<p class="muted td-none">No comments yet.</p>`}</div>
      ${ed ? `<div class="td-compose"><textarea class="td-newc" rows="2" placeholder="Add a comment. @name to tell someone; paste a screenshot or OneDrive / ACC links. Ctrl+Enter to send."></textarea>`
        + `<div class="td-cbtns"><button class="ghost" data-act="attach" title="Attach pictures or files (up to 50 MB each)">&#128206;</button><button class="primary" data-act="comment">Send</button></div></div>`
        + `<div class="td-pend">${pendingHtml(PEND)}</div><input type="file" class="td-file" multiple hidden>` : ""}

      <details class="td-hist"><summary>History</summary>${CUR.activity.map((a) =>
        `<div class="td-hr"><b>${esc(a.by || "?")}</b> ${a.event === "changed" ? `changed ${esc(a.field)}${a.field === "description" ? "" : `: <span class="muted">${esc(a.old || "-")}</span> &rarr; ${esc(a.new || "-")}`}` : esc(a.event)}`
        + ` <small class="muted">${esc(fmtWhen(a.at))}</small></div>`).join("") || `<p class="muted">-</p>`}</details>
      <div class="td-subscr muted">${(t.subscribers || []).length ? "Followers: " + t.subscribers.map((s) => esc(s.name)).join(", ") : ""}</div>
    </div>`;
  box.querySelector(".td-body").scrollTop = scroll;
  const ta = box.querySelector(".td-title");
  const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
  fit();
  ta.oninput = fit;
  wire(T, box, t);
}

function mentionify(html, T) {
  for (const p of T.people()) {
    const e = esc("@" + p.name);
    if (html.includes(e)) html = html.split(e).join(`<b class="mention">${e}</b>`);
  }
  return html;
}

function wire(T, box, t) {
  const ed = T.canEdit();
  const title = box.querySelector(".td-title");
  title.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); title.blur(); } };
  title.onchange = () => { if (title.value.trim() !== t.title) T.save(t.id, { title: title.value.trim() }); };
  const desc = box.querySelector(".td-desc");
  desc.onchange = () => { if (desc.value !== t.description) T.save(t.id, { description: desc.value }); };
  if (t.fresh && !t.title) setTimeout(() => title.focus(), 30);

  box.onclick = async (ev) => {
    const op = ev.target.closest("[data-open]");
    if (op) { ev.preventDefault(); return T.openTask(op.dataset.open); }
    const rm = ev.target.closest("[data-remove]");
    if (rm) {
      return T.save(t.id, { links: t.links.filter((l) => l.id !== rm.dataset.remove) });
    }
    // changing your own comment, in place
    const ec = ev.target.closest("[data-editc]");
    if (ec) { CUR.editing = ec.dataset.editc; paint(T); const ta = document.querySelector(".td-cedit-t"); if (ta) ta.focus(); return; }
    if (ev.target.closest("[data-cancelc]")) { CUR.editing = null; return paint(T); }
    const sc = ev.target.closest("[data-savec]");
    if (sc) {
      const ta = document.querySelector(".td-cedit-t");
      try {
        await T.api(`/api/tasks/${t.id}/comments/${sc.dataset.savec}`, { method: "PATCH", body: JSON.stringify({ body: ta ? ta.value : "" }) });
        CUR.editing = null;
        await loadExtra(T);
      } catch (e) { toast(e.message, true); }
      return;
    }
    const dc = ev.target.closest("[data-delc]");
    if (dc) {
      if (!confirm("Delete this comment?")) return;
      try {
        await T.api(`/api/tasks/${t.id}/comments/${dc.dataset.delc}`, { method: "DELETE" });
        t.comment_count = Math.max(0, t.comment_count - 1);
        await loadExtra(T);
      } catch (e) { toast(e.message, true); }
      return;
    }
    const a = ev.target.closest("[data-act]");
    if (!a) return;
    const k = a.dataset.act;
    if (k === "close") return close(T);
    if (k === "prev" || k === "next") return step(T, k === "next" ? 1 : -1);
    if (k === "share") {
      const url = location.origin + location.pathname.replace(/[^/]*$/, "") + `tasks.html?list=${t.list_id}&task=${t.id}`;
      window.open(`messenger.html?share=${encodeURIComponent(url)}&title=${encodeURIComponent(t.title || "Task")}`, "_blank");
      return;
    }
    if (k === "copy") {
      const url = location.origin + location.pathname.replace(/[^/]*$/, "") + `tasks.html?list=${t.list_id}&task=${t.id}`;
      try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch (e) { prompt("Link to this task", url); }
      return;
    }
    if (k === "follow") {
      const on = !(t.subscribers || []).some((s) => s.uid === T.me.uid);
      try { t.subscribers = (await T.api(`/api/tasks/${t.id}/subscribe`, { method: "POST", body: JSON.stringify({ on }) })).subscribers; paint(T); }
      catch (e) { toast(e.message, true); }
      return;
    }
    if (!ed) return;
    if (k === "done") return T.toggleDone(t);
    if (k === "delete") return T.remove(t.id);
    if (k === "owners") return pickPeople(a, t.owners, T.people(), (v) => T.save(t.id, { owners: v }));
    if (k === "start" || k === "due") return pickDate(a, t[k], (v) => T.save(t.id, { [k]: v }));
    if (k === "priority") return pickOne(a, PRIORITIES, t.priority, (v) => T.save(t.id, { priority: v }));
    if (k === "group") return pickOne(a, T.groups().map((g) => ({ value: g.id, label: esc(g.title) + (g.project ? ` <small class="muted">${esc(g.project)}</small>` : "") })),
      t.group_id, (v) => T.save(t.id, { group_id: v }));
    if (k.startsWith("f:")) {
      const f = T.S.fields.get(k.slice(2));
      const set = (v) => T.save(t.id, { vals: { [f.id]: v } });
      if (f.type === "person") return pickPeople(a, t.vals[f.id] || [], T.people(), set);
      if (isMethod(f)) return pickOne(a, METHOD_OPTS, t.vals[f.id] || "OR", set);
      if (f.type === "select") return pickOne(a, [""].concat(f.options), t.vals[f.id] || "", set);
      if (f.type === "date") return pickDate(a, t.vals[f.id], set);
      if (f.type === "check") return set(!t.vals[f.id]);
      const v = prompt(f.name, t.vals[f.id] == null ? "" : t.vals[f.id]);
      if (v !== null) set(v);
      return;
    }
    if (k === "subdone") {
      const s = T.task(ev.target.closest(".td-sub").dataset.id);
      return T.toggleDone(s);
    }
    if (k === "addlink") return addLink(T, t, box.querySelector(".td-link"));
    if (k === "linkissue") return linkIssue(T, t);
    if (k === "comment") return sendComment(T, t, box.querySelector(".td-newc"));
    if (k === "attach") return box.querySelector(".td-file").click();
  };
  const ns = box.querySelector(".td-newsub");
  if (ns) ns.onkeydown = (ev) => {
    if (ev.key !== "Enter" || !ns.value.trim()) return;
    T.create({ title: ns.value.trim(), parent_id: t.id, group_id: t.group_id });
    T.S.expanded.add(t.id);
    ns.value = "";
    paint(T);
    setTimeout(() => { const n = $("#t-detail .td-newsub"); if (n) n.focus(); }, 0);
  };
  const li = box.querySelector(".td-link");
  if (li) li.onkeydown = (ev) => { if (ev.key === "Enter") addLink(T, t, li); };
  const nc = box.querySelector(".td-newc");
  if (nc) {
    nc.onkeydown = (ev) => { if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) sendComment(T, t, nc); };
    mentionPicker(T, nc);
    const take = (fs) => addFiles(T, t, fs);
    catchFiles(nc, take);
    box.querySelector(".td-file").onchange = (ev) => { take(Array.from(ev.target.files || [])); ev.target.value = ""; };
    box.querySelector(".td-pend").onclick = (ev) => {
      const b = ev.target.closest("[data-unpend]");
      if (b) { PEND.splice(Number(b.dataset.unpend), 1); paintPend(); }
    };
  }
}

function addLink(T, t, input) {
  const url = input.value.trim();
  if (!url) return;
  const c = classify(url);
  if (!c) return toast("That does not look like a web link (https://...)", true);
  let title = c.name;
  if (!title && c.kind !== "sheet" && c.kind !== "view3d") {
    // a short share link carries no file name: ask for one
    title = prompt(`A name for this ${c.service} link (the file name helps others find it)`, "") || "";
  }
  const l = makeLink(url, title, T.me.name);
  T.save(t.id, { links: t.links.concat([l]) });
  input.value = "";
}

/* The issue picker: filled while the window is open. */
async function fillIssuePicker(T, form, t) {
  const list = form.querySelector(".li-list"), sel = form.querySelector("[name=p]"), q = form.querySelector("[name=q]");
  let items = [];
  const paint = () => {
    const s = q.value.trim().toLowerCase().replace("#", "");
    const have = new Set(t.links.filter((l) => l.kind === "issue").map((l) => l.project + "|" + l.ref));
    list.innerHTML = items.filter((it) => !s || String(it.issue.number) === s || (it.issue.title || "").toLowerCase().includes(s))
      .slice(0, 300).map((it) => `<option value="${esc(it.id)}"${have.has(sel.value + "|" + it.id) ? " disabled" : ""}>#${esc(it.issue.number || "?")} ${esc(it.issue.title || "Issue")} - ${esc(it.issue.status || "Open")}${it.sheet ? " · " + esc(it.sheet) : it.placement === "3d" ? " · 3D" : ""}</option>`).join("")
      || `<option disabled>No issues</option>`;
  };
  const load = async () => {
    list.innerHTML = `<option disabled>Loading ...</option>`;
    try {
      const r = await T.api("/api/items?since=0", { headers: { "X-Project": sel.value } });
      items = (r.items || []).filter((it) => it.issue && !it.deleted).sort((a, b) => (b.issue.number || 0) - (a.issue.number || 0));
    } catch (e) { items = []; list.innerHTML = `<option disabled>${esc(e.message)}</option>`; return; }
    paint();
  };
  sel.onchange = load;
  q.oninput = paint;
  list.ondblclick = () => form.requestSubmit();
  await load();
  return () => items;
}

/* Link one or more issues of a project to the task. */
async function linkIssue(T, t) {
  const g = T.S.groups.get(t.group_id);
  const projects = await T.projects();
  if (!projects.length) return toast("No viewer projects you can open", true);
  const pid = (g && g.project) || projects[0].id;
  const p = modal("Link an issue", `<label>Project<select name="p">${projects.map((p) =>
    `<option value="${esc(p.id)}"${p.id === pid ? " selected" : ""}>${esc(p.title)}</option>`).join("")}</select></label>`
    + `<label>Find <input name="q" placeholder="Number or words of the title"></label>`
    + `<select name="i" size="10" class="li-list" multiple></select><p class="muted" style="font-size:11px">Ctrl+click to link several.</p>`, "Link");
  const form = document.querySelector(".t-modal");
  const getItems = await fillIssuePicker(T, form, t);
  const f = await p;
  if (!f) return;
  const items = getItems();
  const chosen = [...f.i.selectedOptions].map((o) => items.find((it) => it.id === o.value)).filter(Boolean);
  if (!chosen.length) return;
  const proj = f.p.value;
  const add = chosen.map((it) => ({
    id: "l" + Math.random().toString(36).slice(2, 10), kind: "issue", project: proj, ref: it.id,
    title: `#${it.issue.number || "?"} ${it.issue.title || "Issue"}`,
    url: it.sheet ? `index.html?project=${encodeURIComponent(proj)}&sheet=${encodeURIComponent(it.sheet)}&select=${encodeURIComponent(it.id)}`
      : `model.html?project=${encodeURIComponent(proj)}&select=${encodeURIComponent(it.id)}`,
    added_by: T.me.name, added_at: new Date().toISOString(),
  }));
  T.save(t.id, { links: t.links.concat(add) });
}

/* the task before / after this one, in the order the list shows them */
function step(T, d) {
  if (!CUR) return;
  const seq = T.sequence();
  const i = seq.indexOf(CUR.id);
  const id = seq[i + d];
  if (id) T.openTask(id);
}
document.addEventListener("keydown", (ev) => {
  if (!CUR || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
  if (ev.key === "j" || ev.key === "J") { ev.preventDefault(); step(window.LWKTasks, 1); }
  if (ev.key === "k" || ev.key === "K") { ev.preventDefault(); step(window.LWKTasks, -1); }
  if (ev.key === "Escape" && !document.querySelector(".t-modal, .t-pop")) close(window.LWKTasks);
});

function paintPend() {
  const el = document.querySelector("#t-detail .td-pend");
  if (el) el.innerHTML = pendingHtml(PEND);
}

async function addFiles(T, t, files) {
  await T.flush();             // a new task must be on the server first
  for (const f of files) {
    const p = { name: f.name || "pasted.png", mime: f.type, size: f.size, url: f.type.startsWith("image/") ? URL.createObjectURL(f) : "" };
    PEND.push(p);
    paintPend();
    try { Object.assign(p, await upload(f, { task: t.id }, p.name)); }
    catch (e) { p.error = e.message; }
    paintPend();
  }
}

async function sendComment(T, t, ta) {
  const body = ta.value.trim();
  if (PEND.some((p) => !p.id && !p.error)) return toast("Still uploading - a moment", true);
  const files = PEND.filter((p) => p.id).map((p) => p.id);
  if (!body && !files.length) return;
  ta.disabled = true;
  try {
    // a brand-new task must reach the server before it can be commented on
    await T.flush();
    const r = await T.api(`/api/tasks/${t.id}/comments`, { method: "POST", body: JSON.stringify({ body, files, by: T.me.name }) });
    PEND = [];
    CUR.comments.push(r);
    Object.assign(t, { comment_count: r.task.comment_count, subscribers: r.task.subscribers });
    CUR.commentCount = t.comment_count;
    ta.value = "";
    ta.disabled = false;
    ta.blur();
    paint(T);
    T.render();
  } catch (e) {
    ta.disabled = false;
    toast(e.message, true);
  }
}

/* @ in a comment lists people */
function mentionPicker(T, ta) {
  ta.addEventListener("input", () => {
    const upto = ta.value.slice(0, ta.selectionStart);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(upto);
    if (!m || !T.people().length) return;
    const qq = m[2].toLowerCase();
    const opts = T.people().filter((p) => p.name.toLowerCase().includes(qq)).slice(0, 8);
    if (!opts.length) return;
    pickOne(ta, opts.map((p) => ({ value: p.name, label: avatar(p) + " " + esc(p.name) })), "", (name) => {
      const start = upto.length - m[2].length - 1;
      ta.value = ta.value.slice(0, start) + "@" + name + " " + ta.value.slice(ta.selectionStart);
      ta.focus();
    });
    setTimeout(() => ta.focus(), 0);
  });
}

