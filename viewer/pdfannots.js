/* Markups as real PDF annotations.

   Every markup becomes the annotation PDF editors themselves create -
   Square, Circle, Line, PolyLine, Polygon (with the cloud border effect),
   Ink, FreeText (with the callout form), Stamp - so in PDF-XChange, Acrobat
   or Bluebeam each one can be selected, moved, restyled, replied to and
   deleted. An issue also gets a sticky note carrying its details.

   Each annotation carries its own drawn appearance (/AP) as well as its
   definition. Without one, some viewers - browsers included - show nothing
   at all; editors redraw it anyway when the markup is changed.

   Text the standard PDF fonts cannot draw (Chinese, for one) is drawn in
   the appearance as a picture, via the `rasterText` callback, while the
   annotation's text itself stays real, searchable and editable.

   Paper millimetres (from the page's lower-left corner) are turned into
   PDF points on the page's own box, so a centre-origin page is handled
   exactly as on screen.
 */

const MM_PT = 72 / 25.4;

const rgb3 = (hex) => {
  const h = String(hex || "#ff3b30").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const f = (n) => (Math.round(n * 1000) / 1000).toString();

/* Latin-1 text as a PDF literal string for the appearance; null when a
   character is outside what the standard fonts can draw. */
function latin1(s) {
  let out = "";
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c > 255) return null;
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (c < 32 || c > 126) out += "\\" + c.toString(8).padStart(3, "0");
    else out += ch;
  }
  return "(" + out + ")";
}

function dashArray(style, w) {
  const d = style && style.dash;
  if (d === "dash") return [6 * w, 3 * w];
  if (d === "dot") return [w, 2 * w];
  if (d === "dashdot") return [6 * w, 2.5 * w, w, 2.5 * w];
  return null;
}

function bbox(pts, pad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

function rotateAbout(pts, deg, c) {
  if (!deg) return pts;
  // the viewer rotates on screen, where y runs down; on paper y runs up
  const r = -deg * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
  return pts.map(([x, y]) => [c[0] + (x - c[0]) * cs - (y - c[1]) * sn,
                              c[1] + (x - c[0]) * sn + (y - c[1]) * cs]);
}

function ellipsePts(cx, cy, rx, ry, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / n * Math.PI * 2;
    out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return out;
}

/* A revision cloud along a closed polygon: arcs bulging outward. */
function cloudPath(pts, arc) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  const outward = area > 0 ? -1 : 1;                   // flip the normal for clockwise
  let ops = `${f(pts[0][0])} ${f(pts[0][1])} m\n`;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / arc));
    const ux = (b[0] - a[0]) / n, uy = (b[1] - a[1]) / n;
    const nx = -uy * outward, ny = ux * outward;        // perpendicular, outward
    for (let k = 0; k < n; k++) {
      const s = [a[0] + ux * k, a[1] + uy * k], e = [a[0] + ux * (k + 1), a[1] + uy * (k + 1)];
      const h = 0.7;                                    // bulge height, as a share of the arc
      ops += `${f(s[0] + nx * h)} ${f(s[1] + ny * h)} ${f(e[0] + nx * h)} ${f(e[1] + ny * h)} ${f(e[0])} ${f(e[1])} c\n`;
    }
  }
  return ops;
}

function arrowHead(tip, from, size) {
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const l = [tip[0] - size * Math.cos(a - 0.4), tip[1] - size * Math.sin(a - 0.4)];
  const r = [tip[0] - size * Math.cos(a + 0.4), tip[1] - size * Math.sin(a + 0.4)];
  return `${f(l[0])} ${f(l[1])} m ${f(tip[0])} ${f(tip[1])} l ${f(r[0])} ${f(r[1])} l S\n`;
}

/* The shared pieces of every annotation's appearance: colour, width, dash
   and, where there is a fill, its transparency. */
function strokeSetup(style, w) {
  const [r, g, b] = rgb3(style.color);
  const d = dashArray(style, w);
  return `${f(r)} ${f(g)} ${f(b)} RG ${f(w)} w 1 J 1 j ${d ? "[" + d.map(f).join(" ") + "] 0 d" : "[] 0 d"}\n`;
}

export function annotateMarkups(P, doc, page, items, opts) {
  const ctx = doc.context;
  const box = page.getCropBox();
  const toPt = ([x, y]) => [x * MM_PT + box.x, y * MM_PT + box.y];
  const author = (opts && opts.author) || "";
  const labelFor = (opts && opts.labelFor) || (() => "");
  const images = (opts && opts.images) || {};
  const rasters = (opts && opts.rasters) || {};
  const helv = ctx.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica",
                         Encoding: "WinAnsiEncoding" });
  const helvRef = ctx.register(helv);
  const made = [];

  const gsRef = (alpha) => ctx.register(ctx.obj({ Type: "ExtGState", ca: alpha, CA: 1 }));

  function add(subtype, rect, extra, apOps, apRes) {
    const bb = [rect[0], rect[1], rect[2], rect[3]];
    const apStream = ctx.stream(apOps, {
      Type: "XObject", Subtype: "Form", BBox: bb, Matrix: [1, 0, 0, 1, 0, 0],
      Resources: apRes || {},
    });
    const dict = Object.assign({
      Type: "Annot", Subtype: subtype, Rect: bb, F: 4,
      M: P.PDFString.fromDate(new Date()),
      AP: { N: ctx.register(apStream) },
    }, extra);
    const ref = ctx.register(ctx.obj(dict));
    page.node.addAnnot(ref);
    made.push({ subtype, ref });
    return ref;
  }

  for (const it of items) {
    const st = it.style || {};
    const w = Math.max(0.25, (Number(st.width) || 0.5) * MM_PT);
    const [r, g, b] = rgb3(st.tcolor || st.color);      // text and labels
    const C = rgb3(st.color);                           // lines and borders
    const fillop = (Number(st.fillop) || 0) / 100;
    const IC = fillop > 0 ? rgb3(st.fill || st.color) : null;
    const raw = (it.points_mm || []).map(toPt);
    if (!raw.length) continue;
    const centre = [(Math.min(...raw.map((p) => p[0])) + Math.max(...raw.map((p) => p[0]))) / 2,
                    (Math.min(...raw.map((p) => p[1])) + Math.max(...raw.map((p) => p[1]))) / 2];
    const pts = rotateAbout(raw, it.rot || 0, centre);
    const iss = it.issue;
    const label = labelFor(it) || "";
    const contents = [iss ? iss.title : "", it.text || "", label].filter(Boolean).join("\n");
    const common = {
      C, T: P.PDFHexString.fromText(author || it.author || ""),
      Contents: P.PDFHexString.fromText(contents),
      NM: P.PDFString.of(String(it.id || "")),
      BS: Object.assign({ W: w, S: dashArray(st, w) ? "D" : "S" },
                        dashArray(st, w) ? { D: dashArray(st, w) } : {}),
    };
    if (IC) common.IC = IC;
    const setup = strokeSetup(st, w);
    const fillOps = (path) => IC
      ? `q /G0 gs ${f(IC[0])} ${f(IC[1])} ${f(IC[2])} rg ${path} f Q\n` : "";
    const res = IC ? { ExtGState: { G0: gsRef(fillop) } } : {};
    const pad = w * 2 + 2;
    const t = it.type;

    if ((t === "rect" || t === "textbox" && !it.text) && pts.length > 1 && !it.rot) {
      const [x0, y0, x1, y1] = bbox(raw.slice(0, 2), 0);
      const rect = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
      const path = `${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)} re`;
      add("Square", rect, Object.assign({}, common, { RD: [pad, pad, pad, pad] }),
          `q ${fillOps(path)}${setup}${path} S Q`, res);
    } else if ((t === "rect" || t === "ellipse" || t === "cloud") && pts.length > 1) {
      // rotated boxes, ellipses and clouds are polygons in a PDF
      const [x0, y0, x1, y1] = bbox(raw.slice(0, 2), 0);
      let poly = t === "ellipse"
        ? ellipsePts((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 64)
        : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      poly = rotateAbout(poly, it.rot || 0, centre);
      if (t === "ellipse" && !it.rot) {
        const k = 0.5523, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
        const path = `${f(cx + rx)} ${f(cy)} m ${f(cx + rx)} ${f(cy + k * ry)} ${f(cx + k * rx)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c `
          + `${f(cx - k * rx)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + k * ry)} ${f(cx - rx)} ${f(cy)} c `
          + `${f(cx - rx)} ${f(cy - k * ry)} ${f(cx - k * rx)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c `
          + `${f(cx + k * rx)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - k * ry)} ${f(cx + rx)} ${f(cy)} c h`;
        add("Circle", [x0 - pad, y0 - pad, x1 + pad, y1 + pad],
            Object.assign({}, common, { RD: [pad, pad, pad, pad] }), `q ${fillOps(path)}${setup}${path} S Q`, res);
      } else {
        const cloud = t === "cloud";
        const arc = Math.max(22, w * 10);   // scallops the size of a hand-drawn cloud
        const path = cloud ? cloudPath(poly, arc) + "h"
          : poly.map((p, i) => `${f(p[0])} ${f(p[1])} ${i ? "l" : "m"}`).join(" ") + " h";
        add("Polygon", bbox(poly, pad + (cloud ? arc : 0)),
            Object.assign({}, common, { Vertices: poly.flat() },
                          cloud ? { BE: { S: "C", I: 1 } } : {}),
            `q ${fillOps(path)}${setup}${path} S Q`, res);
      }
    } else if (t === "cloudpoly" && pts.length > 2) {
      const arc = Math.max(22, w * 10);
      const path = cloudPath(pts, arc) + "h";
      add("Polygon", bbox(pts, pad + arc),
          Object.assign({}, common, { Vertices: pts.flat(), BE: { S: "C", I: 1 } }),
          `q ${fillOps(path)}${setup}${path} S Q`, res);
    } else if ((t === "line" || t === "arrow" || t === "measure" || t === "dimension") && pts.length > 1) {
      const [a, e] = [pts[0], pts[1]];
      const size = Math.max(10, w * 5);
      let ops = `q ${setup}${f(a[0])} ${f(a[1])} m ${f(e[0])} ${f(e[1])} l S\n`;
      if (t === "arrow") ops += arrowHead(e, a, size);
      if (t === "measure" || t === "dimension") { ops += arrowHead(e, a, size); ops += arrowHead(a, e, size); }
      const lab = label && latin1(label);
      const fs = Math.max(6, (Number(st.size) || 3.5) * MM_PT);
      if (lab) {
        const ang = Math.atan2(e[1] - a[1], e[0] - a[0]);
        const up = ang > Math.PI / 2 || ang < -Math.PI / 2 ? ang + Math.PI : ang;
        const m = [(a[0] + e[0]) / 2 - Math.sin(up) * fs * 0.4, (a[1] + e[1]) / 2 + Math.cos(up) * fs * 0.4];
        ops += `BT /F1 ${f(fs)} Tf ${f(r)} ${f(g)} ${f(b)} rg ${f(Math.cos(up))} ${f(Math.sin(up))} ${f(-Math.sin(up))} ${f(Math.cos(up))} ${f(m[0])} ${f(m[1])} Tm ${lab} Tj ET\n`;
      }
      ops += "Q";
      add("Line", bbox([a, e], pad + fs * 1.5), Object.assign({}, common, {
        L: [a[0], a[1], e[0], e[1]],
        LE: t === "arrow" ? ["None", "OpenArrow"] : (t === "line" ? ["None", "None"] : ["OpenArrow", "OpenArrow"]),
      }, (t === "measure" || t === "dimension") ? { Cap: true, IT: "LineDimension" } : {}),
      ops, { Font: { F1: helvRef } });
    } else if ((t === "polyline" || t === "polygon" || t === "area" || t === "angle") && pts.length > 1) {
      const closed = t === "polygon" || t === "area";
      const path = pts.map((p, i) => `${f(p[0])} ${f(p[1])} ${i ? "l" : "m"}`).join(" ") + (closed ? " h" : "");
      let ops = `q ${closed ? fillOps(path) : ""}${setup}${path} S\n`;
      const lab = label && latin1(label);
      if (lab) {
        const [x0, y0, x1, y1] = bbox(pts, 0);
        const fs = Math.max(6, (Number(st.size) || 3.5) * MM_PT);
        ops += `BT /F1 ${f(fs)} Tf ${f(r)} ${f(g)} ${f(b)} rg ${f((x0 + x1) / 2)} ${f((y0 + y1) / 2)} Td ${lab} Tj ET\n`;
      }
      ops += "Q";
      const extra = Object.assign({}, common, { Vertices: pts.flat() },
        t === "area" ? { IT: "PolygonDimension" } : {}, t === "angle" ? { IT: "PolyLineDimension" } : {});
      add(closed ? "Polygon" : "PolyLine", bbox(pts, pad + 20), extra, ops,
          Object.assign({ Font: { F1: helvRef } }, res));
    } else if (t === "pen" && pts.length > 1) {
      const path = pts.map((p, i) => `${f(p[0])} ${f(p[1])} ${i ? "l" : "m"}`).join(" ");
      // A highlighter stays see-through in the PDF: CA on the annotation
      // for editors, and the same in its drawn appearance.
      const op = Number(st.op) || 0;
      if (op) {
        const gs = ctx.register(ctx.obj({ Type: "ExtGState", CA: op / 100, ca: op / 100 }));
        add("Ink", bbox(pts, pad), Object.assign({}, common, { InkList: [pts.flat()], CA: op / 100 }),
            `q /GH gs ${setup}${path} S Q`, { ExtGState: { GH: gs } });
      } else {
        add("Ink", bbox(pts, pad), Object.assign({}, common, { InkList: [pts.flat()] }),
            `q ${setup}${path} S Q`);
      }
    } else if (t === "stamp" && pts.length > 1) {
      // a rubber stamp: /Stamp annotation, drawn as the framed word
      const [x0, y0, x1, y1] = bbox(raw.slice(0, 2), 0);
      const sc = rgb3((it.stamp && it.stamp.color) || "#b91c1c");
      const hPt = y1 - y0, fs1 = hPt * 0.4, fs2 = hPt * 0.17;
      const word = latin1(it.text || "STAMP") || "(STAMP)";
      const who = latin1([(it.stamp && it.stamp.by) || it.author || "",
                          it.stamp && it.stamp.at ? String(it.stamp.at).slice(0, 10) : ""].filter(Boolean).join("  -  "));
      const cx = (x0 + x1) / 2;
      let ops = `q 1 1 1 rg ${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)} re f `
        + `${f(sc[0])} ${f(sc[1])} ${f(sc[2])} RG ${f(Math.max(1, hPt * 0.06))} w `
        + `${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)} re S\n`;
      // centred by an estimate of Helvetica-Bold's width
      const w1 = String(it.text || "").length * fs1 * 0.66;
      ops += `BT /F2 ${f(fs1)} Tf ${f(sc[0])} ${f(sc[1])} ${f(sc[2])} rg ${f(cx - w1 / 2)} ${f(y0 + hPt * 0.4)} Td ${word} Tj ET\n`;
      const stampRes = {};
      if (rasters[it.id]) {
        // a name the standard fonts cannot write: its line as a picture
        const lh = hPt * 0.26;
        ops += `q ${f(x1 - x0)} 0 0 ${f(lh)} ${f(x0)} ${f(y0 + hPt * 0.14 + fs2 * 0.35 - lh / 2)} cm /S0 Do Q\n`;
        stampRes.XObject = { S0: rasters[it.id] };
      } else if (who) {
        const w2 = String(who).length * fs2 * 0.5;
        ops += `BT /F1 ${f(fs2)} Tf ${f(sc[0])} ${f(sc[1])} ${f(sc[2])} rg ${f(cx - w2 / 2)} ${f(y0 + hPt * 0.14)} Td ${who} Tj ET\n`;
      }
      ops += "Q";
      const bold = ctx.register(ctx.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica-Bold",
                                          Encoding: "WinAnsiEncoding" }));
      const NAMES = { approved: "Approved", noted: "Approved", rejected: "NotApproved", revise: "NotApproved",
                      info: "ForComment", reviewed: "ForComment", void: "Void" };
      add("Stamp", [x0 - 1, y0 - 1, x1 + 1, y1 + 1], Object.assign({}, common, {
        C: sc, Name: P.PDFName.of(NAMES[(it.stamp && it.stamp.kind) || ""] || "Draft"),
        Contents: P.PDFHexString.fromText(it.text || ""),
      }), ops, Object.assign({ Font: { F1: helvRef, F2: bold } }, stampRes));
    } else if ((t === "text" || t === "textbox" || t === "callout") && pts.length) {
      const fs = Math.max(6, (Number(st.size) || 3.5) * MM_PT);
      const lines = String(it.text || "").split("\n");
      const anchor = t === "callout" ? pts[pts.length - 1] : pts[0];
      const widthPt = t === "textbox" && pts.length > 1
        ? Math.abs(pts[1][0] - pts[0][0])
        : Math.max(...lines.map((s) => s.length)) * fs * 0.55 + 8;
      const heightPt = t === "textbox" && pts.length > 1
        ? Math.abs(pts[1][1] - pts[0][1]) : lines.length * fs * 1.25 + 6;
      const x0 = t === "textbox" && pts.length > 1 ? Math.min(pts[0][0], pts[1][0]) : anchor[0];
      const yTop = t === "textbox" && pts.length > 1 ? Math.max(pts[0][1], pts[1][1]) : anchor[1] + heightPt / 2;
      const tb = [x0, yTop - heightPt, x0 + widthPt, yTop];
      const allLatin = lines.every((s) => latin1(s) !== null);
      let ops = "q ";
      if (IC) ops += fillOps(`${f(tb[0])} ${f(tb[1])} ${f(widthPt)} ${f(heightPt)} re`);
      if (t !== "text") ops += `${setup}${f(tb[0])} ${f(tb[1])} ${f(widthPt)} ${f(heightPt)} re S\n`;
      const apRes = Object.assign({ Font: { F1: helvRef } }, res);
      if (allLatin) {
        lines.forEach((s, i) => {
          ops += `BT /F1 ${f(fs)} Tf ${f(r)} ${f(g)} ${f(b)} rg ${f(tb[0] + 4)} ${f(yTop - 3 - fs * (i + 1) * 1.1)} Td ${latin1(s)} Tj ET\n`;
        });
      } else if (rasters[it.id]) {
        // Text the standard fonts cannot draw: shown as a picture here, and
        // still real, editable text in the annotation itself.
        apRes.XObject = { T0: rasters[it.id] };
        ops += `q ${f(widthPt)} 0 0 ${f(heightPt)} ${f(tb[0])} ${f(tb[1])} cm /T0 Do Q\n`;
      }
      let rect = [tb[0] - pad, tb[1] - pad, tb[2] + pad, tb[3] + pad];
      const extra = Object.assign({}, common, {
        DA: P.PDFString.of(`/Helv ${f(fs)} Tf ${f(r)} ${f(g)} ${f(b)} rg`),
        Q: st.align === "middle" ? 1 : st.align === "end" ? 2 : 0,
        Contents: P.PDFHexString.fromText(it.text || ""),
      });
      if (t === "callout" && pts.length > 1) {
        const cl = pts.slice(0, -1).concat([[tb[0], anchor[1]]]);
        const leader = cl.map((p, i) => `${f(p[0])} ${f(p[1])} ${i ? "l" : "m"}`).join(" ");
        ops += `${setup}${leader} S\n` + arrowHead(pts[0], pts[1], Math.max(10, w * 5));
        extra.IT = "FreeTextCallout";
        extra.CL = cl.flat();
        extra.LE = "OpenArrow";
        rect = bbox(cl.concat([[rect[0], rect[1]], [rect[2], rect[3]]]), pad);
      }
      ops += "Q";
      add("FreeText", rect, extra, ops, apRes);
    } else if (t === "image" && images[it.id] && pts.length > 1) {
      // A snip or pasted picture: a stamp, which editors let you move and resize.
      const [x0, y0, x1, y1] = bbox(raw.slice(0, 2), 0);
      add("Stamp", [x0, y0, x1, y1], Object.assign({}, common, { Name: "Image" }),
          `q ${f(x1 - x0)} 0 0 ${f(y1 - y0)} ${f(x0)} ${f(y0)} cm /Im0 Do Q`,
          { XObject: { Im0: images[it.id] } });
    }

    // An issue also gets a note with everything about it.
    if (iss) {
      const at = pts[0];
      const lines = [
        iss.title || "Issue",
        [iss.type, iss.status, iss.priority && iss.priority + " priority"].filter(Boolean).join("  |  "),
        iss.assigned_to ? "Assigned to " + iss.assigned_to + (iss.due_date ? ", due " + iss.due_date : "") : "",
        "Raised by " + (it.author || iss.author || "?") + (iss.created_at ? ", " + iss.created_at.slice(0, 10) : ""),
        iss.description || "",
        ...(iss.comments || []).map((c) => (c.author || "?") + ": " + c.text),
      ].filter(Boolean);
      const color = rgb3((opts && opts.issueColor && opts.issueColor(it)) || "#f28022");
      const s = 20;
      add("Text", [at[0], at[1], at[0] + s, at[1] + s], {
        C: color, Name: "Comment", Open: false,
        T: P.PDFHexString.fromText(it.author || iss.author || author),
        Contents: P.PDFHexString.fromText(lines.join("\n")),
        NM: P.PDFString.of("issue-" + String(it.id || "")),
      }, `q ${f(color[0])} ${f(color[1])} ${f(color[2])} rg 0 0 0 RG 0.8 w `
         + `${f(at[0] + 1)} ${f(at[1] + 4)} ${s - 2} ${s - 5} re B `
         + `${f(at[0] + 4)} ${f(at[1] + 4)} m ${f(at[0] + 4)} ${f(at[1])} l ${f(at[0] + 8)} ${f(at[1] + 4)} l f Q`);
    }
  }
  return made;
}
