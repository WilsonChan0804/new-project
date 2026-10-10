/* Exporting what the checks found (clash.js, headroom.js): a spreadsheet
 * (CSV, for Excel), or a report with a picture of each place, written into
 * a new browser tab to print or save as PDF (the browser's own printer, as
 * the issue report does - nothing to install).
 *
 * The pictures are taken here, in the 3D page: each place is shown as Look
 * shows it (cut out, the elements coloured) and the view is copied. The tab
 * is opened at once (a browser only lets a click open one) and filled in
 * when the pictures are ready.
 */
import { download } from "./bcf.js";

const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* Spreadsheet text: one row each, quoted, a byte-order mark so Excel reads
   Chinese names right. */
export function csvText(cols, rows) {
  const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  return "﻿" + [cols.map(q).join(",")].concat(rows.map((r) => r.map(q).join(","))).join("\r\n");
}
export function saveCsv(name, cols, rows) {
  download(new Blob([csvText(cols, rows)], { type: "text/csv;charset=utf-8" }), name);
}
export const fileName = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "export";

/* A new tab, opened now (while the click still counts), saying it is being
   prepared. null: the browser blocked it. */
export function reportTab(title) {
  const w = window.open("", "_blank");
  if (!w) return null;
  w.document.open();
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>`
    + `<body style="font:14px system-ui,sans-serif;padding:40px;color:#333"><p id="msg">Preparing the report ...</p></body>`);
  w.document.close();
  return w;
}
export function tabSay(w, text) {
  try { const m = w.document.getElementById("msg"); if (m) m.textContent = text; } catch (e) {}
}

/* The report: rep = { title, project, sub, meta: [[label, value]],
   table: { cols, rows } (the summary), items: [{ head, tag, tagColor, img,
   rows: [[label, value]] }] }. */
export function writeReport(w, rep) {
  const meta = (rep.meta || []).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("");
  const table = rep.table && rep.table.rows.length ? `<table class="sum"><tr>${rep.table.cols.map((c, i) => `<th${i ? ' class="n"' : ""}>${esc(c)}</th>`).join("")}</tr>`
    + rep.table.rows.map((r) => `<tr>${r.map((v, i) => `<td${i ? ' class="n"' : ""}>${esc(v)}</td>`).join("")}</tr>`).join("") + `</table>` : "";
  const items = (rep.items || []).map((it, n) => `<div class="it">`
    + `<div class="hd"><span class="no">${n + 1}</span>${it.tag ? `<span class="tag" style="background:${esc(it.tagColor || "#e2453c")}">${esc(it.tag)}</span>` : ""}<b>${esc(it.head)}</b></div>`
    + `<div class="bd">${it.img ? `<img src="${it.img}" alt="">` : ""}`
    + `<table class="kv">${(it.rows || []).map(([k, v, sw]) => `<tr><th>${sw ? `<span class="sw" style="background:${esc(sw)}"></span>` : ""}${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table></div></div>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(rep.title)}</title><style>
    @page { size: A4; margin: 14mm; }
    body { font: 12px/1.45 system-ui, "Segoe UI", "Microsoft JhengHei", sans-serif; color: #222; margin: 0; background: #f4f4f4; }
    .bar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #ddd; padding: 10px 24px; display: flex; gap: 12px; align-items: center; }
    .bar button { font: inherit; padding: 6px 14px; border: 1px solid #f28022; background: #f28022; color: #fff; border-radius: 6px; cursor: pointer; }
    .doc { max-width: 190mm; margin: 16px auto; background: #fff; padding: 14mm; box-shadow: 0 1px 4px rgba(0,0,0,.12); }
    h1 { font-size: 20px; margin: 0 0 4px; } h1 span { color: #f28022; }
    .sub { color: #666; margin-bottom: 14px; }
    table { border-collapse: collapse; width: 100%; }
    table.meta th, table.meta td, table.sum th, table.sum td { border-bottom: 1px solid #e4e4e4; padding: 4px 6px; text-align: left; vertical-align: top; }
    table.meta th { width: 30%; color: #555; font-weight: 600; }
    table.sum { margin: 14px 0 6px; } table.sum th { background: #f6f6f6; } .n { text-align: right; }
    .it { border: 1px solid #ddd; border-radius: 6px; margin: 12px 0; break-inside: avoid; page-break-inside: avoid; }
    .hd { background: #f6f6f6; padding: 6px 10px; display: flex; gap: 8px; align-items: center; border-bottom: 1px solid #ddd; }
    .no { font-weight: 700; color: #888; min-width: 22px; }
    .tag { color: #fff; border-radius: 10px; padding: 1px 8px; font-size: 11px; font-weight: 600; }
    .bd { padding: 8px 10px; }
    .bd img { width: 100%; max-height: 95mm; object-fit: contain; display: block; margin-bottom: 6px; background: #eee; }
    table.kv th { text-align: left; color: #555; font-weight: 600; width: 26%; padding: 2px 6px 2px 0; vertical-align: top; }
    table.kv td { padding: 2px 0; word-break: break-word; }
    .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
    .foot { color: #999; margin-top: 18px; font-size: 11px; }
    @media print { body { background: #fff; } .bar { display: none; } .doc { box-shadow: none; margin: 0; padding: 0; max-width: none; } }
  </style></head><body>
  <div class="bar"><button onclick="print()">Print / Save as PDF</button><span>${esc((rep.items || []).length)} ${esc(rep.unit || "items")}</span></div>
  <div class="doc"><h1>${esc(rep.title)}${rep.project ? ` · <span>${esc(rep.project)}</span>` : ""}</h1>
  <div class="sub">${esc(rep.sub || "")}</div>
  <table class="meta">${meta}</table>${table}${items || '<p class="sub">Nothing to report.</p>'}
  <div class="foot">LWK Viewer · ${esc(location.origin)} · checks what the viewer draws - quick coordination, not a formal report</div></div></body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/* A picture of each item: show(item) puts it on screen; shot() copies the
   view. Stops when stop() says so, or the report tab is closed. */
export async function pictures(list, show, shot, say, stop, w) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if ((stop && stop()) || (w && w.closed)) break;
    say(`Pictures ${i + 1} of ${list.length} ...`);
    try { await show(list[i]); out[i] = await shot(); } catch (e) { out[i] = null; }
  }
  return out;
}
