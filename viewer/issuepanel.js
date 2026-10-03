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

const STATUSES = ["Open", "In progress", "Resolved", "Closed"];
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
          <div id="detail-images"></div>
          <div class="detail-add">
            <input id="detail-file" type="file" accept="image/*" multiple hidden>
            <button id="detail-addimg" class="ghost">Add photo</button>
            <span class="muted" style="font-size:11px">Site photos, sketches,
              a screenshot of the clash</span>
          </div>
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
        + `<div class="cmt-t">${mentionHtml(c.text, c.mentions)}</div>`
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
