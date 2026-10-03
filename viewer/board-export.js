/* A board as a picture (PNG) and as a backup file (JSON).
 *
 * The picture is drawn onto a canvas object by object, from the same data
 * the page shows. The shortcut - wrapping the page's own HTML in an SVG
 * and photographing that - does not work in Safari, which is what every
 * iPad on site runs, and silently drops uploaded pictures everywhere else.
 */

import { col, isDark, route, arrowHead, penPath, unionBox, uid, clone } from "./board-util.js";
import { forest, branchPath } from "./board-mind.js";

const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';
const STATUS_COLORS = { "Open": "#e2453c", "In progress": "#e8a13a", "Resolved": "#3b82f6",
                        "Closed": "#0e9f6e", "Not an issue": "#9ca3af" };
export const statusColor = (s) => STATUS_COLORS[s] || "#9aa3af";

/* Break text into lines no wider than maxW. Words are kept whole when they
   fit; a word (or a run of Chinese, which has no spaces) that is wider than
   the line is broken wherever it has to be. */
function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text || "").split("\n")) {
    let line = "";
    const words = para.split(/(\s+)/);
    for (const w of words) {
      if (ctx.measureText(line + w).width <= maxW) { line += w; continue; }
      if (line.trim()) { out.push(line.trimEnd()); line = ""; }
      if (/^\s+$/.test(w)) continue;
      if (ctx.measureText(w).width <= maxW) { line = w; continue; }
      for (const ch of w) {
        if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ""; }
        line += ch;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

function textBlock(ctx, o, box, opt) {
  // opt: fs, bold, color, align, valign, padX, padY, lineH
  const fs = o.fs || opt.fs;
  ctx.font = `${(o.bold === undefined ? opt.bold : o.bold) ? "700" : opt.weight || "400"} ${fs}px ${FONT}`;
  ctx.fillStyle = col(o.color, opt.color);
  ctx.textBaseline = "middle";
  const align = o.align || opt.align || "center";
  const padX = opt.padX || 0, padY = opt.padY || 0;
  const lines = wrap(ctx, o.text, Math.max(10, box.w - padX * 2));
  const lh = fs * (opt.lineH || 1.3);
  const total = lines.length * lh;
  let y = opt.valign === "top" ? box.y + padY : box.y + Math.max(padY, (box.h - total) / 2);
  ctx.textAlign = align;
  const x = align === "left" ? box.x + padX : align === "right" ? box.x + box.w - padX : box.x + box.w / 2;
  for (const ln of lines) {
    ctx.fillText(ln, x, y + lh / 2);
    y += lh;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function shapePath(ctx, o) {
  const { x, y, w, h } = o;
  if (o.kind === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (o.kind === "diamond") {
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h / 2); ctx.lineTo(x + w / 2, y + h); ctx.lineTo(x, y + h / 2);
    ctx.closePath();
  } else {
    roundRect(ctx, x, y, w, h, o.kind === "round" ? Math.min(w, h) * 0.22 : 2);
  }
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/* The box a connector occupies, for working out how big the picture is. */
export function connRoute(o, all) {
  const A = o.a && o.a.o ? all.get(o.a.o) : null, B = o.b && o.b.o ? all.get(o.b.o) : null;
  if ((o.a && o.a.o && (!A || A._hidden)) || (o.b && o.b.o && (!B || B._hidden))) return null;
  return route(o.kind || "straight", A, B, o.a || { x: 0, y: 0 }, o.b || { x: 0, y: 0 });
}

export function boxOf(o, all) {
  if (o.t === "conn") {
    const r = connRoute(o, all);
    if (!r) return null;
    const xs = r.pts.map((p) => p.x), ys = r.pts.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  if (o._hidden || o.t === "comment" || o.t === "react" || o.t === "timer") return null;
  const b = { x: o.x || 0, y: o.y || 0, w: o.w || 0, h: o.h || 0 };
  if (o.t === "frame") { b.y -= 26; b.h += 26; }
  return b;
}

/* Draw these objects. `all` is every object of the board (a connector
   needs the things it joins, a node its parent). */
export async function toCanvas(list, all, opt) {
  opt = opt || {};
  const boxes = list.map((o) => boxOf(o, all)).filter(Boolean);
  const bb = unionBox(boxes) || { x: 0, y: 0, w: 400, h: 300 };
  const pad = opt.pad == null ? 40 : opt.pad;
  const W = bb.w + pad * 2, H = bb.h + pad * 2;
  // Canvases have a size limit (and iPads a low one); a huge board gets a coarser picture, not a blank one.
  let scale = opt.scale || 2;
  scale = Math.min(scale, 8000 / W, 8000 / H, Math.sqrt(24e6 / (W * H)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(W * scale));
  canvas.height = Math.max(1, Math.round(H * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = opt.background || "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.translate(pad - bb.x, pad - bb.y);

  const images = new Map();
  await Promise.all(list.filter((o) => o.t === "image" && /^\/snapshots\//.test(o.src || ""))
    .map(async (o) => images.set(o.id, await loadImage(o.src))));

  const inList = new Set(list.map((o) => o.id));
  const byZ = (a, b) => (a.z || 0) - (b.z || 0);
  const frames = list.filter((o) => o.t === "frame").sort(byZ);
  const rest = list.filter((o) => !["frame", "conn", "comment", "react", "timer"].includes(o.t) && !o._hidden).sort(byZ);
  const conns = list.filter((o) => o.t === "conn");

  for (const o of frames) {
    roundRect(ctx, o.x, o.y, o.w, o.h, 6);
    ctx.fillStyle = col(o.fill, "#ffffff"); ctx.fill();
    ctx.strokeStyle = "#c3cad4"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = `600 14px ${FONT}`; ctx.fillStyle = "#414a5a"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText(String(o.text || ""), o.x + 4, o.y - 8, o.w);
  }

  // mind-map branches go under the nodes
  const F = forest(all);
  for (const o of rest) {
    if (o.t !== "node") continue;
    const p = F.parentOf.get(o.id) && all.get(F.parentOf.get(o.id));
    if (!p || !inList.has(p.id) || p._hidden) continue;
    ctx.strokeStyle = col(o._color, "#9aa3af"); ctx.lineWidth = 2.5; ctx.lineCap = "round";
    ctx.stroke(new Path2D(branchPath(p, o, o._dir || 1)));
  }

  for (const o of rest) {
    ctx.save();
    if (o.t === "sticky") {
      ctx.shadowColor = "rgba(20,26,36,.25)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
      ctx.fillStyle = col(o.fill, "#fff3a3");
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.shadowColor = "transparent";
      textBlock(ctx, o, o, { fs: 16, color: isDark(o.fill) ? "#ffffff" : "#1f2430", padX: 12, padY: 12 });
    } else if (o.t === "text") {
      textBlock(ctx, o, o, { fs: 16, color: "#1f2430", align: "left", valign: "top", padX: 4, padY: 2, lineH: 1.4 });
    } else if (o.t === "shape") {
      shapePath(ctx, o);
      const fill = col(o.fill, "#ffffff");
      if (fill !== "transparent") { ctx.fillStyle = fill; ctx.fill(); }
      ctx.strokeStyle = col(o.stroke, "#1f2430"); ctx.lineWidth = o.sw || 2; ctx.stroke();
      const inset = o.kind === "ellipse" || o.kind === "diamond" ? o.w * 0.14 : 0;
      textBlock(ctx, o, { x: o.x + inset, y: o.y, w: o.w - inset * 2, h: o.h },
                { fs: 14, color: isDark(o.fill) ? "#ffffff" : "#1f2430", padX: 10, padY: 6 });
    } else if (o.t === "image") {
      const img = images.get(o.id);
      if (img) ctx.drawImage(img, o.x, o.y, o.w, o.h);
      else { ctx.fillStyle = "#eef1f5"; ctx.fillRect(o.x, o.y, o.w, o.h); }
    } else if (o.t === "pen") {
      ctx.translate(o.x, o.y);
      const sx = (o.w || 1) / (o.ow || o.w || 1), sy = (o.h || 1) / (o.oh || o.h || 1);
      ctx.scale(sx, sy);
      ctx.strokeStyle = col(o.color, "#1f2430"); ctx.lineWidth = (o.sw || 3) / Math.max(sx, sy);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.stroke(new Path2D(penPath(o.pts || [])));
    } else if (o.t === "node") {
      const d = o._depth || 0, bc = col(o._color, "#c3cad4");
      roundRect(ctx, o.x, o.y, o.w, o.h, d === 0 ? 12 : 9);
      if (d === 0) {
        ctx.fillStyle = col(o.fill, "#1f2430"); ctx.fill();
      } else {
        ctx.fillStyle = col(o.fill, "#ffffff"); ctx.fill();
        if (d === 1 && !o.fill) { ctx.globalAlpha = 0.16; ctx.fillStyle = bc; ctx.fill(); ctx.globalAlpha = 1; }
        ctx.strokeStyle = bc; ctx.lineWidth = 1.5; ctx.stroke();
      }
      const dark = d === 0 ? !o.fill || isDark(o.fill) : isDark(o.fill);
      textBlock(ctx, o, o, { fs: d === 0 ? 16 : d === 1 ? 14 : 13, bold: d === 0, weight: d === 1 ? "600" : "400",
                             color: dark ? "#ffffff" : "#1f2430", align: "left", padX: d === 0 ? 18 : d === 1 ? 14 : 12, padY: 4 });
      if (o.collapsed && o._below) {
        const cx = o._dir < 0 ? o.x - 8 : o.x + o.w + 8, cy = o.y + o.h / 2;
        ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fillStyle = bc; ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = `700 10px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(o._below), cx, cy + 0.5);
      }
    } else if (o.t === "link") {
      const st = o.kind === "sheet" ? "#3b82f6" : statusColor(o.status);
      ctx.shadowColor = "rgba(20,26,36,.15)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
      roundRect(ctx, o.x, o.y, o.w, o.h, 7); ctx.fillStyle = "#fff"; ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = "#e2e6ec"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = st; ctx.fillRect(o.x, o.y + 3, 4, o.h - 6);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.font = `700 12px ${FONT}`; ctx.fillStyle = "#1f2430";
      const head = o.kind === "sheet" ? "Sheet " + (o.ref || "") : "#" + (o.num || "?");
      ctx.fillText(head, o.x + 12, o.y + 20);
      if (o.kind !== "sheet") {
        ctx.font = `600 10px ${FONT}`; ctx.fillStyle = st;
        ctx.fillText(String(o.status || ""), o.x + 18 + ctx.measureText(head).width * 1.25, o.y + 20);
      }
      ctx.font = `600 13px ${FONT}`; ctx.fillStyle = "#1f2430";
      wrap(ctx, o.title || "", o.w - 24).slice(0, 2).forEach((ln, i) => ctx.fillText(ln, o.x + 12, o.y + 40 + i * 17));
      ctx.font = `400 11px ${FONT}`; ctx.fillStyle = "#6b7480";
      const meta = [o.who, o.due ? "due " + o.due : ""].filter(Boolean).join("  -  ");
      if (meta) ctx.fillText(meta, o.x + 12, o.y + o.h - 10, o.w - 24);
    }
    ctx.restore();
  }

  for (const o of conns) {
    const r = connRoute(o, all);
    if (!r) continue;
    const c = col(o.color, "#1f2430");
    ctx.save();
    ctx.strokeStyle = c; ctx.lineWidth = o.sw || 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (o.dash) ctx.setLineDash([8, 6]);
    ctx.stroke(new Path2D(r.d));
    ctx.setLineDash([]);
    const size = 8 + (o.sw || 2) * 2;
    if ((o.arrow || "end") !== "none") ctx.stroke(new Path2D(arrowHead(r.p2, r.from2, size)));
    if (o.arrow === "both") ctx.stroke(new Path2D(arrowHead(r.p1, r.from1, size)));
    if (o.text) {
      ctx.font = `400 12px ${FONT}`;
      const w = ctx.measureText(o.text).width + 12;
      ctx.fillStyle = opt.background || "#ffffff";
      ctx.fillRect(r.mid.x - w / 2, r.mid.y - 10, w, 20);
      ctx.fillStyle = "#1f2430"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(o.text, r.mid.x, r.mid.y + 0.5);
    }
    ctx.restore();
  }
  return canvas;
}

export function canvasBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const safeName = (s) => String(s || "board").replace(/[^\w一-鿿 .-]+/g, "_").trim().slice(0, 60) || "board";

/* ---------------------------------------------------------------- backup */

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/* Everything needed to rebuild the board somewhere else - another project,
   another server. Pictures travel inside the file: on another server the
   /snapshots/ paths would point at nothing. */
export async function exportJson(title, objects) {
  const out = { format: "lwk-board", version: 1, title, exported_at: new Date().toISOString(),
                objects: objects.filter((o) => o.t !== "timer"), images: {} };
  for (const o of out.objects) {
    if (o.t !== "image" || !o.src || out.images[o.src]) continue;
    try {
      const res = await fetch(o.src);
      if (res.ok) out.images[o.src] = await blobToDataUrl(await res.blob());
    } catch (e) { /* the picture is missing; the rest of the board is still worth saving */ }
  }
  return out;
}

/* Objects for a new board from a backup: fresh ids (so the same file can be
   imported twice), pictures uploaded again. `upload` takes a data URL and
   answers the new path. */
export async function importJson(data, upload) {
  if (!data || data.format !== "lwk-board" || !Array.isArray(data.objects)) {
    throw new Error("This is not a board backup (.json saved with Export)");
  }
  const srcMap = new Map();
  for (const [src, url] of Object.entries(data.images || {})) {
    if (typeof url === "string" && /^data:image\/(png|jpe?g);base64,/i.test(url)) {
      try { srcMap.set(src, await upload(url)); } catch (e) { /* that picture is left out */ }
    }
  }
  return { title: String(data.title || "Imported board"), objects: remap(data.objects, srcMap) };
}

/* Copies of objects under new ids, with every reference between them
   (parent, connector ends, comment targets) pointing at the copies. */
export function remap(objects, srcMap) {
  const ids = new Map();
  const list = objects.filter((o) => o && typeof o === "object" && typeof o.id === "string").map(clone);
  for (const o of list) ids.set(o.id, uid(o.t === "node" ? "n" : "o"));
  const out = [];
  for (const o of list) {
    o.id = ids.get(o.id);
    for (const k of ["rev", "cby", "cat", "uby", "uat"]) delete o[k];
    if (o.t === "node") o.parent = o.parent && ids.has(o.parent) ? ids.get(o.parent) : null;
    if (o.t === "conn") {
      for (const end of ["a", "b"]) {
        const e = o[end];
        if (e && e.o) o[end] = ids.has(e.o) ? { o: ids.get(e.o) } : { x: e.x || 0, y: e.y || 0 };
      }
    }
    if (o.t === "comment" || o.t === "react") {
      if (!ids.has(o.on)) continue;
      o.on = ids.get(o.on);
    }
    if (o.t === "image") {
      if (srcMap && srcMap.has(o.src)) o.src = srcMap.get(o.src);
      else if (srcMap && !/^\/snapshots\/[0-9a-f]{8,40}\.(jpg|png)$/.test(o.src || "")) continue;
    }
    out.push(o);
  }
  return out;
}
