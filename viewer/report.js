/* Issue report for meetings and for handing to consultants: a cover with
 * the numbers, then every issue with its picture, details, comments and
 * (optionally) its history, grouped by who holds it, by sheet or by status.
 * "Print / Save as PDF" uses the browser's own PDF printer, so the report
 * needs nothing installed on the server.
 *
 * Pictures: a 3D issue shows the snapshot taken when it was raised; a sheet
 * issue shows the drawing itself, cropped round the markup, with the markup
 * outlined - rendered from the sheet's PDF here, so it is the current sheet.
 *
 * Opened from the Dashboard's Report button, it reports exactly the issues
 * the dashboard's filters show; opened on its own, every open issue.
 */

import { api, project } from "./nav.js";
import { ISSUE_TYPES } from "./issuetypes.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const STATUS_COLORS = { "Open": "#e2453c", "In progress": "#e8a13a", "Resolved": "#3b82f6",
                        "Closed": "#0e9f6e", "Not an issue": "#9ca3af" };
const TYPE = new Map(ISSUE_TYPES.map((t) => [t.id, t]));
const MM_PT = 72 / 25.4;
const fmt = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

const R = { man: null, items: [], issues: [], me: null, pdfs: new Map() };

async function load() {
  const pid = project();
  if (!pid) throw new Error("No project chosen - open the report from the Dashboard.");
  R.me = await api("/api/me");
  const [man, items] = await Promise.all([
    fetch("/data/" + encodeURIComponent(pid) + "/manifest.json").then((r) => (r.ok ? r.json() : {})),
    api("/api/items?since=0"),
  ]);
  R.man = man || {};
  R.items = (items.items || []).filter((i) => !i.deleted && i.issue);
  let ids = null;
  try { ids = JSON.parse(sessionStorage.getItem("lwk-report:" + pid) || "null"); } catch (e) {}
  const pick = ids && ids.length ? new Set(ids)
    : new Set(R.items.filter((i) => !i.issue.dismissed && !["Resolved", "Closed"].includes(i.issue.status || "Open")).map((i) => i.id));
  R.issues = R.items.filter((i) => pick.has(i.id));
  R.fromDashboard = !!(ids && ids.length);
}

function sheetOf(num) {
  return ((R.man.sheets || []).find((s) => s.number === num)) || null;
}

function whereOf(it) {
  if (it.sheet) {
    const s = sheetOf(it.sheet);
    return `${it.sheet}${s && s.name ? " " + s.name : ""}`;
  }
  return "3D model" + (it.issue.level ? " · " + it.issue.level : "");
}

const statusOf = (it) => (it.issue.dismissed ? "Not an issue" : (it.issue.status || "Open"));

function overdue(it) {
  const d = it.issue.due_date;
  if (!d || ["Resolved", "Closed"].includes(statusOf(it)) || it.issue.dismissed) return false;
  return new Date(d + "T23:59:59") < new Date();
}

/* ---------------------------------------------------------- pictures */

async function sheetPdf(num) {
  if (R.pdfs.has(num)) return R.pdfs.get(num);
  const s = sheetOf(num);
  const p = s && s.pdf ? pdfjsLib.getDocument({ url: "/data/" + encodeURIComponent(project()) + "/" + s.pdf,
    withCredentials: true }).promise.then((d) => d.getPage(1)) : Promise.resolve(null);
  R.pdfs.set(num, p);
  return p;
}

/* The drawing round the markup: 60 mm of paper around it at 150 dpi,
   with the markup's outline drawn on top in red. */
async function sheetCrop(it) {
  const page = await sheetPdf(it.sheet);
  const pts = it.points_mm || [];
  if (!page || !pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const pad = 35;
  let x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad;
  let y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  // at least 90 x 60 mm, in the page's proportions of a picture
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const w = Math.max(90, x1 - x0, (y1 - y0) * 1.5), h = w / 1.5;
  x0 = cx - w / 2; x1 = cx + w / 2; y0 = cy - h / 2; y1 = cy + h / 2;
  const dpi = 150, scale = dpi / 72;
  const o = page.view;
  const vp0 = page.getViewport({ scale });
  // the crop's corners in viewport pixels (handles page rotation)
  const c1 = vp0.convertToViewportPoint(x0 * MM_PT + o[0], y0 * MM_PT + o[1]);
  const c2 = vp0.convertToViewportPoint(x1 * MM_PT + o[0], y1 * MM_PT + o[1]);
  const left = Math.min(c1[0], c2[0]), top = Math.min(c1[1], c2[1]);
  const cw = Math.ceil(Math.abs(c2[0] - c1[0])), ch = Math.ceil(Math.abs(c2[1] - c1[1]));
  const vp = page.getViewport({ scale, offsetX: -left, offsetY: -top });
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  // the markup, outlined
  const px = pts.map((p) => vp.convertToViewportPoint(p[0] * MM_PT + o[0], p[1] * MM_PT + o[1]));
  ctx.strokeStyle = "rgba(226,69,60,.95)"; ctx.lineWidth = 3; ctx.lineJoin = "round";
  ctx.beginPath();
  if (["rect", "cloud", "ellipse"].includes(it.type) && px.length >= 2) {
    const l = Math.min(px[0][0], px[1][0]), t = Math.min(px[0][1], px[1][1]);
    const rw = Math.abs(px[1][0] - px[0][0]), rh = Math.abs(px[1][1] - px[0][1]);
    if (it.type === "ellipse") ctx.ellipse(l + rw / 2, t + rh / 2, rw / 2 + 4, rh / 2 + 4, 0, 0, 2 * Math.PI);
    else ctx.rect(l - 4, t - 4, rw + 8, rh + 8);
  } else {
    px.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    if (px.length === 1) ctx.arc(px[0][0], px[0][1], 14, 0, 2 * Math.PI);
  }
  ctx.stroke();
  return canvas;
}

/* ------------------------------------------------------------- render */

function issueHtml(it) {
  const iss = it.issue;
  const st = statusOf(it);
  const t = TYPE.get(iss.type) || { label: iss.type || "General" };
  const pics = $("#r-pics").checked;
  const late = overdue(it);
  const comments = (iss.comments || []).filter((c) => c && (c.text || "").trim());
  const hist = iss.history || [];
  return `<div class="issue" data-id="${esc(it.id)}">
    <div class="head"><span class="num">#${esc(iss.number || "?")}</span>
      <span class="title">${esc(iss.title || "Issue")}</span>
      <span class="pill" style="background:${STATUS_COLORS[st] || "#6b7280"}">${esc(st)}</span></div>
    <div class="body${pics ? "" : " nopic"}">
      <div>
        <table class="facts">
          <tr><td>Type</td><td>${esc(t.label)} · ${esc(iss.priority || "Normal")} priority</td></tr>
          <tr><td>Assigned to</td><td>${esc(iss.assigned_to || "Unassigned")}</td></tr>
          <tr><td>Due</td><td class="${late ? "late" : ""}">${iss.due_date ? esc(fmt(iss.due_date)) + (late ? " - overdue" : "") : "-"}</td></tr>
          <tr><td>Where</td><td>${esc(whereOf(it))}</td></tr>
          <tr><td>Raised</td><td>${esc(iss.author || it.author || "")} · ${esc(fmt(iss.created_at || it.created_at))}</td></tr>
          <tr><td>Last change</td><td>${esc(it.updated_by || iss.updated_by || "")} · ${esc(fmt(it.updated_at || iss.updated_at))}</td></tr>
        </table>
        ${iss.description ? `<div class="desc">${esc(iss.description)}</div>` : ""}
      </div>
      ${pics ? `<div class="pic" data-pic="${esc(it.id)}"><div class="cap">loading picture ...</div></div>` : ""}
    </div>
    ${$("#r-comments").checked && comments.length ? `<div class="comments">${comments.map((c) =>
      `<div class="c"><div class="who">${esc(c.author || "")} · ${esc(fmt(c.at || c.date || c.created_at))}</div>${esc(c.text)}</div>`).join("")}</div>` : ""}
    ${$("#r-history").checked && hist.length ? `<div class="hist">${hist.map((h) =>
      `${esc(fmt(h.at))} ${esc(h.by || "")}: ${h.event === "created" ? "raised" : h.event === "comment" ? "commented"
        : esc(h.field) + " " + esc(h.from || "-") + " → " + esc(h.to || "-")}`).join(" · ")}</div>` : ""}
  </div>`;
}

function groupKey(it, by) {
  if (by === "assignee") return it.issue.assigned_to || "Unassigned";
  if (by === "sheet") return it.sheet ? whereOf(it) : "3D model";
  if (by === "status") return statusOf(it);
  return "";
}

async function render() {
  const by = $("#r-group").value;
  const list = R.issues.slice().sort((a, b) => (a.issue.number || 0) - (b.issue.number || 0));
  const groups = new Map();
  for (const it of list) {
    const k = groupKey(it, by);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const count = (st) => list.filter((i) => statusOf(i) === st).length;
  const title = (R.man.source && R.man.source.title) || project();
  const who = R.me && R.me.user ? R.me.user.name : "";
  const kpi = (l, v, c) => `<div class="kpi ${c || ""}"><b>${v}</b><span>${l}</span></div>`;
  let html = `<section class="page cover">
    <h1>Issue report · <span>${esc(title)}</span></h1>
    <div class="sub">${esc(new Date().toLocaleString())}${who ? " · prepared by " + esc(who) : ""} ·
      ${R.fromDashboard ? "issues as filtered on the dashboard" : "all open issues"}</div>
    <div class="kpis">${kpi("Issues", list.length)}${kpi("Open", count("Open"))}${kpi("In progress", count("In progress"))}
      ${kpi("Resolved", count("Resolved"))}${kpi("Closed", count("Closed"))}
      ${kpi("Overdue", list.filter(overdue).length, list.some(overdue) ? "bad" : "")}</div>
    ${by !== "none" ? `<table><tr><th>${esc($("#r-group").selectedOptions[0].text)}</th><th class="n">Issues</th>
      <th class="n">Open</th><th class="n">Overdue</th></tr>${[...groups.entries()].map(([k, is]) =>
      `<tr><td>${esc(k)}</td><td class="n">${is.length}</td>
        <td class="n">${is.filter((i) => ["Open", "In progress"].includes(statusOf(i))).length}</td>
        <td class="n">${is.filter(overdue).length}</td></tr>`).join("")}</table>` : ""}
    <div class="foot">LWK Viewer · ${esc(location.origin)}</div></section>`;
  let first = true;
  for (const [k, is] of groups) {
    html += `<section class="page">${by !== "none" ? `<h2 class="group${first ? " first" : ""}">${esc(k)} · ${is.length}</h2>` : ""}
      ${is.map(issueHtml).join("")}</section>`;
    first = false;
  }
  $("#report").innerHTML = html;
  if ($("#r-pics").checked) await pictures(list);
}

async function pictures(list) {
  let done = 0;
  for (const it of list) {
    const box = document.querySelector(`[data-pic="${CSS.escape(it.id)}"]`);
    if (!box) continue;
    try {
      if (it.snapshot) {
        box.innerHTML = `<img src="${esc(it.snapshot)}" alt=""><div class="cap">Snapshot when raised</div>`;
      } else if (it.sheet) {
        const c = await sheetCrop(it);
        if (c) { box.innerHTML = ""; box.appendChild(c); box.insertAdjacentHTML("beforeend", `<div class="cap">Sheet ${esc(it.sheet)}, current version</div>`); }
        else box.innerHTML = `<div class="cap">No picture</div>`;
      } else {
        box.innerHTML = `<div class="cap">No picture</div>`;
      }
    } catch (e) {
      box.innerHTML = `<div class="cap">Picture unavailable</div>`;
    }
    $("#r-msg").textContent = `Pictures ${++done} of ${list.length} ...`;
  }
  $("#r-msg").textContent = `${list.length} issues - ready to print.`;
}

async function main() {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  $("#r-msg").textContent = "Loading ...";
  await load();
  for (const id of ["#r-group", "#r-pics", "#r-comments", "#r-history"]) $(id).onchange = render;
  $("#r-print").onclick = () => window.print();
  await render();
}

main().catch((e) => { $("#report").innerHTML = `<section class="page">Could not make the report: ${esc(e.message)}.
  Sign in on the Dashboard first, then press Report there.</section>`; });
