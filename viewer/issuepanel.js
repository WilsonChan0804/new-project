/* Issue detail.
 *
 * Clicking an issue used to jump the view to it and stop there. The person
 * who most needs the list - the one deciding what to do next - could not
 * read the description, see who raised it, or answer it. This dialog is
 * the same on the sheets page and the 3D page, so an issue reads the same
 * wherever it was raised.
 *
 * Edits go back through the page's own save path (opts.onSave), so the
 * server write, the pending queue and the list refresh stay in one place.
 */

/* "Not an issue" is deliberately not in the status list. Dismissing
   someone else's observation is a different kind of act from moving it
   along a workflow, so it gets its own control, its own confirmation and
   its own recorded reason. */
import { ISSUE_TYPES, typeOptions, shortDate } from "./issuetypes.js";
import { chip, makeLink, classify, linkify } from "./filelinks.js";
import { elementsOf, elementsBlock, wireElementBlocks } from "./revit.js";
import { issueLink } from "./goto.js";
import { copyLink } from "./share.js";
import * as Store from "./store.js";

const STATUSES = ["Open", "In progress", "Resolved", "Closed"];
const CLOSED = ["Resolved", "Closed"];
const PRIORITIES = ["Low", "Normal", "High", "Critical"];

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const when = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString();
};

function options(list, current) {
  return list.map((v) =>
    `<option${v === current ? " selected" : ""}>${esc(v)}</option>`).join("");
}

function whereLine(it) {
  if (it.placement === "3d") {
    return (it.model_name ? esc(it.model_name) + " - " : "")
      + (it.ifc_guid ? "element " + esc(it.ifc_guid) : "3D model");
  }
  const a = it.anchor || {};
  return (it.sheet ? "Sheet " + esc(it.sheet) : "Sheet")
    + (a.view_name ? " - " + esc(a.view_name) : "")
    + (a.model_mm ? " - linked to the model" : "");
}

export function ensureDialog() {
  if (document.getElementById("detail-back")) return;
  const d = document.createElement("div");
  d.id = "detail-back";
  d.hidden = true;
  d.innerHTML = `
    <div id="detail-dlg">
      <div id="detail-head">
        <span class="pin issue" id="detail-no"></span>
        <input id="detail-title" placeholder="Title">
        <button id="detail-link" class="ghost" title="Copy a link to this issue">&#128279;</button>
        <button id="detail-close" class="ghost" title="Close">&#10005;</button>
      </div>
      <div id="detail-body">
        <div id="detail-main">
          <div id="detail-snap"></div>
          <label>Description
            <textarea id="detail-desc" rows="4"></textarea></label>
          <div class="detail-meta">
            <span id="detail-where"></span>
            <span id="detail-raised"></span>
          </div>
          <div id="detail-element"></div>
          <div id="detail-images"></div>
          <div class="detail-add">
            <input id="detail-file" type="file" accept="image/*" multiple hidden>
            <button id="detail-addimg" class="ghost">Add photo</button>
            <span class="muted" style="font-size:11px">Site photos, sketches,
              a screenshot of the clash</span>
          </div>
          <div class="disc-head"><b>Files</b> <span class="muted" style="font-size:11px">OneDrive, SharePoint, ACC</span></div>
          <div id="detail-files" class="fl-list"></div>
          <div class="fl-add"><input id="detail-fileurl" placeholder="Paste a OneDrive, SharePoint or ACC link"><button id="detail-addfile" class="ghost">Add</button></div>
          <div class="disc-head"><b>Tasks</b> <span id="detail-tcount" class="muted"></span><span class="spacer"></span>
            <button id="detail-newtask" class="ghost linkish" hidden>+ New task from this issue</button>
            <button id="detail-tochat" class="ghost linkish" title="Send this issue to a chat in the Messenger">Send to chat</button></div>
          <div id="detail-tasks"></div>
          <div id="detail-dismissed" hidden></div>
          <div class="disc-head"><b>Discussion</b> <span id="disc-count" class="muted"></span>
            <span class="spacer"></span><span id="disc-open" class="disc-open" hidden></span></div>
          <div id="detail-comments"></div>
          <div id="disc-replying" class="disc-replying" hidden></div>
          <div class="detail-add disc-compose">
            <textarea id="detail-newc" rows="2" placeholder="Write to everyone on this issue - a question, an answer, an update. @name to tell someone. Ctrl+Enter to post."></textarea>
            <div class="disc-actions">
              <label class="row-check" title="A query waits for an answer: it shows as open until someone replies and it is marked answered">
                <input type="checkbox" id="disc-query"> Query</label>
              <button id="detail-addc">Post</button>
            </div>
          </div>
        </div>
        <div id="detail-side">
          <label>Type<select id="detail-type"></select></label>
          <label>Status<select id="detail-status"></select></label>
          <label>Priority<select id="detail-priority"></select></label>
          <label>Assigned to<input id="detail-assignee" autocomplete="off" placeholder="choose or type a name"></label>
          <label>Due date<input id="detail-due" type="date"></label>
          <div class="spacer"></div>
          <button id="detail-jump" class="ghost">Show in view</button>
          <button id="detail-3d" class="ghost" title="Open the model at this point, on this floor">Show in 3D</button>
          <button id="detail-dismiss" class="ghost">Not an issue</button>
          <button id="detail-save">Save</button>
          <button id="detail-delete" class="ghost danger">Delete</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(d);
  // Esc closes the issue window (as the X does)
  addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || d.hidden) return;
    const x = document.getElementById("detail-close");
    if (x) { ev.preventDefault(); x.click(); }
  });
}

/* A comment with its @names picked out. */
function mentionHtml(text, names) {
  let h = esc(text);
  for (const n of names || []) {
    const e = esc("@" + n);
    h = h.split(e).join(`<b class="mention">${e}</b>`);
  }
  return h;
}

/* opts: { number, author, onSave(item), onDelete(item), onJump(item), onShow3D(item), level } */
export function openIssue(item, opts) {
  ensureDialog();
  const $ = (s) => document.querySelector(s);
  const back = $("#detail-back");
  const iss = item.issue || (item.issue = { status: "Open", priority: "Normal" });
  if (!Array.isArray(iss.comments)) iss.comments = [];

  $("#detail-no").textContent = opts.number || "";
  // a link that opens this issue where it is - on its sheet, or in 3D
  $("#detail-link").onclick = () => {
    const project = new URLSearchParams(location.search).get("project") || Store.currentProject() || "";
    copyLink(issueLink({ project, id: item.id, kind: item.placement === "3d" ? "3d" : "2d", sheet: item.sheet }),
      "issue " + (opts.number ? "#" + opts.number : ""));
  };
  $("#detail-title").value = iss.title || "";
  $("#detail-desc").value = iss.description || "";
  $("#detail-type").innerHTML = typeOptions(iss.type || "general");
  $("#detail-status").innerHTML = options(STATUSES, iss.status || "Open");
  $("#detail-priority").innerHTML = options(PRIORITIES, iss.priority || "Normal");
  $("#detail-assignee").value = iss.assigned_to || "";
  $("#detail-due").value = iss.due_date || "";
  // Where it is, and who raised it when - read from the record, never typed.
  const who = (item.issue && item.issue.author) || item.author || "";
  const at = (item.issue && item.issue.created_at) || item.created_at || "";
  $("#detail-where").textContent = whereLine(item)
    + (opts.level ? " - " + opts.level : "")
    + (who || at ? "  |  raised by " + (who || "unknown")
       + (at ? ", " + new Date(at).toLocaleString(undefined, { day: "numeric", month: "short",
            year: "numeric", hour: "2-digit", minute: "2-digit" }) : "") : "");
  $("#detail-raised").textContent = "Raised by "
    + (item.author || iss.author || "unknown")
    + (iss.created_at ? " on " + when(iss.created_at) : "");

  /* The picture can be taken again - after a copy is pasted somewhere
     else, or when the drawing / model has moved on since it was raised. */
  const snap = $("#detail-snap");
  const renderSnap = () => {
    snap.innerHTML = (item.snapshot
      ? `<img src="${esc(item.snapshot)}" alt="Snapshot" title="Click to enlarge">`
      : `<div class="nosnap">No snapshot</div>`)
      + ((opts.onResnap || opts.onEditSnapshot) && item.issue
        ? `<div class="snap-tools">`
          + (opts.onResnap ? `<button type="button" class="ghost" id="detail-resnap" title="${esc(opts.resnapHint || "Take the picture again from what the page shows now")}">&#128247; Update snapshot</button>` : "")
          + (opts.onEditSnapshot && item.snapshot ? `<button type="button" class="ghost" id="detail-editsnap" title="Draw on the picture, or change what was drawn on it">&#9998; Edit markup</button>` : "")
          + `<span class="muted" id="detail-resnap-note"></span></div>`
        : "");
    const eb = snap.querySelector("#detail-editsnap");
    if (eb) eb.onclick = async () => {
      const note = snap.querySelector("#detail-resnap-note");
      try {
        const ok = await opts.onEditSnapshot(item);
        if (!ok) return;
        note.textContent = " saving ...";
        await opts.onSave(collect());
        renderSnap();
        const n2 = snap.querySelector("#detail-resnap-note");
        if (n2) n2.textContent = " markup saved";
      } catch (e) { note.textContent = " failed: " + (e.message || e); }
    };
    const img = snap.querySelector("img");
    if (img) img.onclick = () => window.open(item.snapshot, "_blank");
    const b = snap.querySelector("#detail-resnap");
    if (b) b.onclick = async () => {
      const note = snap.querySelector("#detail-resnap-note");
      b.disabled = true;
      note.textContent = " taking the picture ...";
      try {
        const ok = await opts.onResnap(item);
        if (!ok) { note.textContent = " could not take a picture here"; b.disabled = false; return; }
        await opts.onSave(collect());
        renderSnap();
        const n2 = snap.querySelector("#detail-resnap-note");
        if (n2) n2.textContent = " updated";
      } catch (e) {
        note.textContent = " failed: " + (e.message || e);
        b.disabled = false;
      }
    };
  };
  renderSnap();

  if (!Array.isArray(iss.images)) iss.images = [];

  const renderImages = () => {
    const box = $("#detail-images");
    if (!iss.images.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="imgrow">` + iss.images.map((src, i) =>
      `<div class="imgcell"><img src="${esc(src)}" data-i="${i}">`
      + `<button class="imgdel" data-i="${i}" title="Remove">&#10005;</button>`
      + `</div>`).join("") + `</div>`;
    for (const img of box.querySelectorAll("img")) {
      img.onclick = () => window.open(img.src, "_blank");
    }
    for (const b of box.querySelectorAll(".imgdel")) {
      b.onclick = async () => {
        iss.images.splice(Number(b.dataset.i), 1);
        renderImages();
        await opts.onSave(collect());
      };
    }
  };

  const renderDismissed = () => {
    const box = $("#detail-dismissed");
    if (!iss.dismissed) { box.hidden = true; return; }
    box.hidden = false;
    box.className = "warn";
    box.textContent = "Marked as not an issue by "
      + (iss.dismissed.by || "?") + " on " + when(iss.dismissed.at)
      + (iss.dismissed.reason ? " - " + iss.dismissed.reason : "");
  };

  /* The discussion: every comment in time order, each answer under the
     message it answers. A query stays open until it is marked answered. */
  let replyTo = null;
  const me = opts.author || "";
  const cid = (c) => c.id || ((c.author || "") + "|" + (c.at || ""));
  const renderComments = () => {
    const box = $("#detail-comments");
    const all = iss.comments.filter((c) => c && !c.deleted);
    const ids = new Set(all.map(cid));
    const kids = new Map();
    const roots = [];
    for (const c of all) {
      if (c.reply_to && ids.has(c.reply_to)) {
        if (!kids.has(c.reply_to)) kids.set(c.reply_to, []);
        kids.get(c.reply_to).push(c);
      } else roots.push(c);
    }
    $("#disc-count").textContent = all.length ? `${all.length} message${all.length > 1 ? "s" : ""}` : "";
    const openQ = all.filter((c) => c.kind === "query" && !c.resolved).length;
    const oq = $("#disc-open");
    oq.hidden = !openQ;
    oq.textContent = openQ + (openQ > 1 ? " open queries" : " open query");
    if (!all.length) {
      box.innerHTML = `<div class="muted" style="font-size:11px">No messages yet. Ask a question or give an update - everyone on the project sees it here.</div>`;
      return;
    }
    const one = (c, depth) => {
      const answers = kids.get(cid(c)) || [];
      const q = c.kind === "query";
      const badge = !q ? "" : c.resolved
        ? `<span class="q-badge done" title="${esc("Answered - marked by " + (c.resolved_by || "?"))}">Answered</span>`
        : `<span class="q-badge">${answers.length ? "Query - replied" : "Query - awaiting reply"}</span>`;
      return `<div class="cmt${q ? " query" : ""}${c.author && c.author === me ? " mine" : ""}" style="margin-left:${Math.min(depth, 4) * 18}px">`
        + `<div class="cmt-h"><b>${esc(c.author || "?")}</b>${badge}<span class="spacer"></span><span>${esc(when(c.at))}</span></div>`
        + `<div class="cmt-t">${linkify(mentionHtml(c.text, c.mentions))}</div>`
        + `<div class="cmt-a"><button class="ghost linkish" data-reply="${esc(cid(c))}">Reply</button>`
        + (q && !c.resolved ? `<button class="ghost linkish" data-resolve="${esc(cid(c))}">Mark answered</button>` : "")
        + (q && c.resolved ? `<button class="ghost linkish" data-reopen="${esc(cid(c))}">Reopen query</button>` : "")
        + `</div></div>`
        + answers.map((a) => one(a, depth + 1)).join("");
    };
    box.innerHTML = roots.map((c) => one(c, 0)).join("");
    const find = (k) => iss.comments.find((c) => cid(c) === k);
    for (const b of box.querySelectorAll("[data-reply]")) b.onclick = () => {
      const c = find(b.dataset.reply);
      if (!c) return;
      replyTo = cid(c);
      const r = $("#disc-replying");
      r.hidden = false;
      r.innerHTML = `Replying to <b>${esc(c.author || "?")}</b>: "${esc((c.text || "").slice(0, 80))}${(c.text || "").length > 80 ? "..." : ""}" `
        + `<button class="ghost linkish" id="disc-noreply">cancel</button>`;
      $("#disc-noreply").onclick = () => { replyTo = null; r.hidden = true; };
      $("#disc-query").checked = false;
      $("#detail-newc").focus();
    };
    const flag = async (k, on) => {
      const c = find(k);
      if (!c) return;
      c.resolved = on;
      c.resolved_by = on ? me : null;
      c.resolved_at = on ? new Date().toISOString() : null;
      renderComments();
      await opts.onSave(collect());
    };
    for (const b of box.querySelectorAll("[data-resolve]")) b.onclick = () => flag(b.dataset.resolve, true);
    for (const b of box.querySelectorAll("[data-reopen]")) b.onclick = () => flag(b.dataset.reopen, false);
  };
  renderComments();
  renderImages();
  renderDismissed();
  if (!Array.isArray(iss.files)) iss.files = [];
  const renderFiles = () => {
    const box = $("#detail-files");
    box.innerHTML = iss.files.map((f) => chip(f, { remove: true })).join("")
      || `<span class="muted" style="font-size:11px">No files linked - the drawing, calc or model this is about.</span>`;
  };
  renderFiles();
  $("#detail-files").onclick = async (ev) => {
    const b = ev.target.closest("[data-remove]");
    if (!b) return;
    iss.files = iss.files.filter((f) => f.id !== b.dataset.remove);
    renderFiles();
    await opts.onSave(collect());
  };
  const addFile = async () => {
    const inp = $("#detail-fileurl");
    const url = inp.value.trim();
    if (!url) return;
    const c = classify(url);
    if (!c) { alert("That does not look like a web link (https://...)"); return; }
    const name = c.name || prompt(`A name for this ${c.service} link (the file name helps others find it)`, "") || "";
    iss.files.push(makeLink(url, name, opts.author));
    inp.value = "";
    renderFiles();
    await opts.onSave(collect());
  };
  $("#detail-addfile").onclick = addFile;
  $("#detail-fileurl").onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); addFile(); } };
  loadTasks(item, iss);
  // the Revit element it is about (3D issues), with Copy IDs / 3D / Revit
  wireElementBlocks();
  $("#detail-element").innerHTML = elementsBlock(currentProject(), elementsOf(item), "Revit element");
  const statusWas = iss.status || "Open";
  $("#detail-tochat").onclick = () => {
    const pid = currentProject();
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    const url = base + (item.sheet
      ? `index.html?project=${encodeURIComponent(pid)}&sheet=${encodeURIComponent(item.sheet)}&select=${encodeURIComponent(item.id)}`
      : `model.html?project=${encodeURIComponent(pid)}&select=${encodeURIComponent(item.id)}`);
    window.open(`messenger.html?share=${encodeURIComponent(url)}&title=${encodeURIComponent(`Issue #${iss.number || "?"} ${iss.title || ""}`)}`, "_blank");
  };

  const collect = () => {
    iss.title = $("#detail-title").value.trim() || iss.title || "Issue";
    iss.description = $("#detail-desc").value;
    iss.type = $("#detail-type").value || "general";
    iss.status = $("#detail-status").value;
    iss.priority = $("#detail-priority").value;
    iss.assigned_to = $("#detail-assignee").value.trim();
    iss.due_date = $("#detail-due").value;
    iss.updated_at = new Date().toISOString();
    return item;
  };

  const close = () => { back.hidden = true; };

  $("#detail-close").onclick = close;
  $("#detail-save").onclick = async () => {
    const b = $("#detail-save");
    b.disabled = true;
    try {
      await opts.onSave(collect());
      close();
      // resolved or closed now: offer to complete the tasks still open on it
      if (CLOSED.includes(iss.status) && !CLOSED.includes(statusWas)) offerTaskDone(item, iss);
    } finally {
      b.disabled = false;
    }
  };
  $("#detail-delete").onclick = async () => {
    if (!confirm("Delete this issue for everyone?")) return;
    await opts.onDelete(item);
    close();
  };
  $("#detail-jump").onclick = () => { close(); if (opts.onJump) opts.onJump(item); };
  $("#detail-jump").hidden = !opts.onJump;
  const can3d = !!(opts.onShow3D && item.anchor && item.anchor.model_mm);
  $("#detail-3d").hidden = !can3d;
  $("#detail-3d").onclick = () => { close(); if (can3d) opts.onShow3D(item); };

  /* Dismissing asks for a reason and warns plainly. Someone raised this
     because they thought it mattered; closing it without a word is how a
     real problem gets buried. */
  $("#detail-dismiss").onclick = async () => {
    if (iss.dismissed) {
      if (!confirm("Reopen this issue? It will go back to Open.")) return;
      delete iss.dismissed;
      iss.status = "Open";
      $("#detail-status").value = "Open";
      renderDismissed();
      await opts.onSave(collect());
      return;
    }
    const who = item.author || iss.author || "someone";
    const reason = prompt(
      "Mark as NOT an issue?\n\n"
      + who + " raised this. Dismissing it does not delete it - it stays "
      + "visible, and they can reopen it.\n\n"
      + "If you are not certain, add a comment asking them first.\n\n"
      + "Reason for dismissing:");
    if (reason === null) return;
    if (!reason.trim()) {
      alert("A reason is required. Dismissing without one leaves the person "
            + "who raised it with nothing to go on.");
      return;
    }
    iss.dismissed = { by: opts.author || "?", at: new Date().toISOString(),
                      reason: reason.trim() };
    iss.status = "Closed";
    $("#detail-status").value = "Closed";
    renderDismissed();
    await opts.onSave(collect());
  };

  /* Images are uploaded and stored by path, like snapshots: a data URL in
     the record would put a megabyte into every sync. */
  $("#detail-addimg").onclick = () => $("#detail-file").click();
  $("#detail-file").onchange = async () => {
    const files = Array.from($("#detail-file").files || []);
    $("#detail-file").value = "";
    if (!files.length || !opts.onUpload) return;
    for (const f of files) {
      try {
        const dataUrl = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = () => rej(new Error("Could not read " + f.name));
          fr.readAsDataURL(f);
        });
        const path = await opts.onUpload(dataUrl);
        if (path) iss.images.push(path);
      } catch (e) {
        alert("Could not add " + f.name + ": " + e.message);
      }
    }
    renderImages();
    await opts.onSave(collect());
  };

  $("#detail-addc").onclick = async () => {
    const t = $("#detail-newc").value.trim();
    if (!t) return;
    const named = (window.LWKMentions && window.LWKMentions.mentionsIn(t)) || [];
    const c = { id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
                author: opts.author || "?", text: t, at: new Date().toISOString() };
    if (named.length) c.mentions = named;
    if (replyTo) c.reply_to = replyTo;
    if ($("#disc-query").checked) c.kind = "query";
    iss.comments.push(c);
    $("#detail-newc").value = "";
    $("#disc-query").checked = false;
    replyTo = null;
    $("#disc-replying").hidden = true;
    renderComments();
    // A comment is worth saving on its own; nobody wants to lose one to a
    // missed Save button.
    await opts.onSave(collect());
  };

  /* Docked beside the model rather than over it: the point of opening an
     issue from the 3D list is to look at the place while reading about
     it, which a full-screen dialog makes impossible. */
  back.classList.toggle("docked", !!opts.docked);
  back.onclick = (ev) => {
    if (ev.target === back && !opts.docked) close();
  };
  $("#detail-newc").onkeydown = (ev) => {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); $("#detail-addc").click(); }
  };
  $("#disc-query").checked = false;
  $("#disc-replying").hidden = true;

  /* Others' messages arrive while the window is open: the record the page
     holds is checked every few seconds and new messages shown. */
  clearInterval(openIssue._live);
  if (opts.latest) {
    openIssue._live = setInterval(() => {
      if (back.hidden) { clearInterval(openIssue._live); return; }
      const fresh = opts.latest();
      const fc = fresh && fresh.issue && fresh.issue.comments;
      if (!Array.isArray(fc)) return;
      const have = new Set(iss.comments.map(cid));
      let changed = false;
      for (const c of fc) {
        const k = cid(c);
        if (!have.has(k)) { iss.comments.push(c); changed = true; continue; }
        const o = iss.comments.find((x) => cid(x) === k);
        if (o && (o.resolved !== c.resolved || o.deleted !== c.deleted)) {
          o.resolved = c.resolved; o.resolved_by = c.resolved_by; o.deleted = c.deleted; changed = true;
        }
      }
      const sig = iss.comments.map((c) => cid(c) + (c.resolved ? "r" : "") + (c.deleted ? "d" : "")).join(",");
      if (sig !== openIssue._sig) { openIssue._sig = sig; changed = true; }
      if (changed) {
        iss.comments.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
        renderComments();
      }
    }, 3000);
  }

  back.hidden = false;
  $("#detail-title").focus();
}


/* ------------------------------------------------ tasks for an issue */

function apiHeaders() {
  const h = { "Content-Type": "application/json" };
  try {
    const t = localStorage.getItem("lwk-viewer:token");
    if (t) h["X-Viewer-Token"] = t;
  } catch (e) {}
  const p = currentProject();
  if (p) h["X-Project"] = p;
  return h;
}
function currentProject() {
  const q = new URLSearchParams(location.search).get("project");
  if (q) return q;
  try { return localStorage.getItem("lwk-viewer:project") || ""; } catch (e) { return ""; }
}

/* The tasks (Tasks page) that point at this issue, and a way to make one. */
async function loadTasks(item, iss) {
  const box = document.getElementById("detail-tasks");
  const btn = document.getElementById("detail-newtask");
  const count = document.getElementById("detail-tcount");
  box.innerHTML = "";
  count.textContent = "";
  btn.hidden = true;
  const pid = currentProject();
  let r;
  try {
    const res = await fetch("/api/tasks-by-issue?issue=" + encodeURIComponent(item.id) + "&project=" + encodeURIComponent(pid),
                            { headers: apiHeaders() });
    if (!res.ok) return;
    r = await res.json();
  } catch (e) { return; }
  count.textContent = r.tasks.length ? String(r.tasks.length) : "";
  box.innerHTML = r.tasks.map((t) => {
    const who = (t.owners || []).map((p) => p.name).join(", ");
    const late = !t.done && t.due && t.due.slice(0, 10) < new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    return `<div class="it-task${t.done ? " done" : ""}"><span class="it-tick">${t.done ? "&#10003;" : "&#9675;"}</span>`
      + (t.can_open ? `<a href="tasks.html?list=${encodeURIComponent(t.list_id)}&task=${encodeURIComponent(t.id)}" target="_blank">${esc(t.title || "Task")}</a>`
        : `<span>${esc(t.title || "Task")}</span>`)
      + `<small class="muted"> ${esc(t.list_title || "")}${who ? " · " + esc(who) : ""}</small>`
      + (t.due ? `<small class="${late ? "it-late" : "muted"}"> · due ${esc(t.due.slice(0, 10))}</small>` : "") + `</div>`;
  }).join("") || `<span class="muted" style="font-size:11px">No task points at this issue yet.</span>`;
  if (!r.lists.length || !item.issue) return;
  btn.hidden = false;
  btn.onclick = () => newTaskForm(item, iss, r.lists).catch((e) => alert("Could not make the task: " + e.message));
}

/* A small form over the issue window (the issue pages have no modal of
   their own). Resolves with the form, or null on Cancel. */
function miniForm(title, html, ok) {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "it-form-back";
    back.innerHTML = `<form class="it-form" onsubmit="return false"><h3>${esc(title)}</h3>${html}`
      + `<div class="it-form-b"><span class="it-form-msg muted"></span><span class="spacer"></span><button type="button" class="ghost" data-x>Cancel</button>`
      + `<button type="submit" class="primary">${esc(ok)}</button></div></form>`;
    document.body.appendChild(back);
    const f = back.querySelector("form");
    const done = (v) => { back.remove(); resolve(v); };
    back.querySelector("[data-x]").onclick = () => done(null);
    f.onsubmit = () => { done(f); return false; };
    back.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); done(null); } });
    setTimeout(() => { const i = f.querySelector("input, select"); if (i) i.focus(); }, 0);
  });
}

const issueUrlOf = (item, pid) => item.sheet
  ? `index.html?project=${encodeURIComponent(pid)}&sheet=${encodeURIComponent(item.sheet)}&select=${encodeURIComponent(item.id)}`
  : `model.html?project=${encodeURIComponent(pid)}&select=${encodeURIComponent(item.id)}`;

/* "New task from this issue": the list and group of this project first,
   the issue's assignee as owner, its due date, its files and element. */
async function newTaskForm(item, iss, lists) {
  const pid = currentProject();
  const H = apiHeaders();
  const [allLists, ppl] = await Promise.all([
    fetch("/api/task-lists", { headers: H }).then((r) => r.json()).catch(() => ({ lists: [] })),
    fetch("/api/people", { headers: H }).then((r) => r.json()).catch(() => ({ people: [] })),
  ]);
  const linked = new Set((allLists.lists || []).filter((l) => (l.groups || []).some((g) => g.project === pid)).map((l) => l.id));
  const cands = lists.slice().sort((a, b) => linked.has(b.id) - linked.has(a.id));
  const people = ppl.people || [];
  const who = (iss.assigned_to || "").trim().toLowerCase();
  const owner = people.find((p) => p.name.toLowerCase() === who) || people.find((p) => who && p.name.toLowerCase().startsWith(who));
  const els = elementsOf(item);
  const f = miniForm("New task from issue #" + (iss.number || "?"),
    `<label>Task list <select name="list">${cands.map((l) => `<option value="${esc(l.id)}">${esc(l.title)}${linked.has(l.id) ? "" : " (no group for " + esc(pid) + ")"}</option>`).join("")}</select></label>`
    + `<label>Group <select name="group"><option value="">Loading ...</option></select></label>`
    + `<label>Title <input name="title" value="${esc(`#${iss.number || "?"} ${iss.title || "Issue"}`)}"></label>`
    + `<div class="it-2"><label>Owner <select name="owner"><option value="">Nobody yet</option>${people.map((p) => `<option value="${p.uid}"${owner && owner.uid === p.uid ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>`
    + `<label>Due <input type="date" name="due" value="${esc((iss.due_date || "").slice(0, 10))}"></label></div>`
    + (els.length ? `<p class="muted" style="font-size:11px;margin:2px 0">The Revit element (${esc(els[0].category || els[0].name || "element")}${els[0].id ? ", id " + esc(els[0].id) : ""}) goes with it.</p>` : "")
    + `<label class="row-check"><input type="checkbox" name="go"> Open the task when made</label>`, "Make the task");
  // the groups of the chosen list, this project's first
  const form = document.querySelector(".it-form");
  if (form) {
    const fill = async () => {
      const gsel = form.querySelector("[name=group]");
      try {
        const all = await (await fetch("/api/tasks?list=" + encodeURIComponent(form.list.value), { headers: H })).json();
        const gs = (all.groups || []).filter((g) => !g.deleted);
        gs.sort((a, b) => (b.project === pid) - (a.project === pid));
        gsel.innerHTML = gs.map((g) => `<option value="${esc(g.id)}">${esc(g.title)}${g.project === pid ? " (" + esc(pid) + ")" : ""}</option>`).join("") || `<option value="">(no groups)</option>`;
      } catch (e) { gsel.innerHTML = `<option value="">(no groups)</option>`; }
    };
    form.list.onchange = fill;
    fill();
  }
  const done = await f;
  if (!done) return;
  const id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 20);
  const own = people.find((p) => String(p.uid) === done.owner.value);
  const where = item.sheet ? "Sheet " + item.sheet : "3D" + (item.level ? " · " + item.level : "");
  const links = [{ kind: "issue", project: pid, ref: item.id, title: `#${iss.number || "?"} ${iss.title || "Issue"}`, url: issueUrlOf(item, pid) }]
    .concat((iss.files || []).map((x) => Object.assign({}, x)));
  if (els.length) {
    links.push({ kind: "view3d", project: pid, url: `model.html?project=${encodeURIComponent(pid)}&elements=${encodeURIComponent(els.map((e) => e.uid || e.id).join(","))}`,
      title: (els.length === 1 ? els[0].name || els[0].category || "Element" : els.length + " elements") + " (Revit)", elements: els });
  }
  const body = { list: done.list.value, tasks: [{
    id, title: done.title.value.trim() || iss.title || "Issue", group_id: done.group.value || "", due: done.due.value || "",
    owners: own ? [{ uid: own.uid, name: own.name }] : [],
    priority: { Critical: "Urgent", High: "High", Normal: "Medium", Low: "Low" }[iss.priority] || "",
    description: [iss.description || "", where + (els.length ? " · " + (els[0].category || "") + " " + (els[0].name || "") + (els[0].id ? " (Revit id " + els[0].id + ")" : "") : "")].filter(Boolean).join("\n\n"),
    links,
  }] };
  const res = await fetch("/api/tasks", { method: "POST", headers: H, body: JSON.stringify(body) });
  const out = await res.json();
  if (!res.ok) throw new Error(out.detail || "HTTP " + res.status);
  if (done.go.checked) window.open(`tasks.html?list=${encodeURIComponent(done.list.value)}&task=${encodeURIComponent(id)}`, "_blank");
  loadTasks(item, iss);
}

/* The issue was just resolved: its tasks still open can be completed too. */
async function offerTaskDone(item, iss) {
  const pid = currentProject();
  let r;
  try {
    r = await (await fetch("/api/tasks-by-issue?issue=" + encodeURIComponent(item.id) + "&project=" + encodeURIComponent(pid), { headers: apiHeaders() })).json();
  } catch (e) { return; }
  const open = (r.tasks || []).filter((t) => !t.done && t.can_open);
  if (!open.length) return;
  const f = await miniForm(`Issue #${iss.number || "?"} is ${iss.status}`,
    `<p class="muted" style="font-size:12px;margin-top:0">These tasks on it are still open:</p>`
    + open.map((t, i) => `<label class="row-check"><input type="checkbox" name="t${i}" checked> <b>${esc(t.title || "Task")}</b> <small class="muted">${esc(t.list_title || "")}</small></label>`).join(""),
    "Mark them done");
  if (!f) return;
  const byList = {};
  open.forEach((t, i) => { if (f["t" + i] && f["t" + i].checked) (byList[t.list_id] = byList[t.list_id] || []).push({ id: t.id, done: true }); });
  for (const [list, tasks] of Object.entries(byList)) {
    try {
      const res = await fetch("/api/tasks", { method: "POST", headers: apiHeaders(), body: JSON.stringify({ list, tasks }) });
      if (!res.ok) { const o = await res.json().catch(() => ({})); alert("Could not complete the task: " + (o.detail || res.status)); }
    } catch (e) { alert("Could not complete the task: " + e.message); }
  }
}

(function css() {
  if (document.getElementById("it-css")) return;
  const st = document.createElement("style");
  st.id = "it-css";
  st.textContent = `#detail-tasks { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; font-size: 12px; }
.it-task a { color: var(--accent-deep, #d1660e); font-weight: 600; text-decoration: none; }
.it-form-back { position: fixed; inset: 0; z-index: 300; background: rgba(20,26,36,.35); display: flex; align-items: center; justify-content: center; padding: 12px; }
.it-form { background: var(--panel, #fff); border-radius: 12px; padding: 16px 18px; width: min(460px, 96vw); max-height: 90vh; overflow: auto; box-shadow: 0 20px 60px rgba(20,26,36,.3); display: flex; flex-direction: column; gap: 8px; }
.it-form h3 { margin: 0 0 4px; font-size: 16px; }
.it-form label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted, #6b7480); }
.it-form label.row-check { flex-direction: row; align-items: center; gap: 6px; color: var(--ink, #1f2430); }
.it-form input:not([type=checkbox]), .it-form select { font-size: 14px; }
.it-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.it-form-b { display: flex; gap: 6px; align-items: center; margin-top: 6px; }
.it-task.done a, .it-task.done span { text-decoration: line-through; color: var(--muted, #6b7480); }
.it-tick { display: inline-block; width: 16px; color: var(--ok, #0e9f6e); }
.it-late { color: var(--bad, #e2453c); }
#detail-files { margin-bottom: 2px; }`;
  document.head.appendChild(st);
})();
