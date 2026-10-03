#!/usr/bin/env node
/* The phone copies of a project's fast 3D models, made on the server.
 *
 *   node mobile.mjs <project folder> [--force] [--model <fragments/x.lwkm>]
 *
 * What the viewer does on the first computer that opens an export (see
 * computeExterior / growExterior / makeMobileFiles in viewer/model.js),
 * done here without a graphics card: each model is drawn from the 26
 * directions of a cube round it into a depth buffer on the processor, and
 * every element that shows (glass in a second layer, so what is behind a
 * curtain wall counts too) is "seen from outside". Openings touching the
 * outside are added. From that list the phone's copy is written, and both
 * are left next to the model:
 *
 *   <name>.ext.json       what is seen from outside (rule 2)
 *   <name>.mobile3.lwkm   the phone's copy (rule 3)
 *
 * Runs in the background after an upload (server/app.py); a computer that
 * opens the project first simply finds the work done.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_RULE = 2, MOBILE_RULE = 3;
const MOBILE_TRIS = 1500000;              // for all the models of a project together
const SMALL_DIAG = 1.2;

// the viewer's own file writer, so the copy is exactly what the viewer makes
async function viewerLwkm() {
  const candidates = [path.join(HERE, "..", "..", "viewer", "lwkm.js"), path.join(HERE, "..", "viewer", "lwkm.js")];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, "utf8");
    return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
  }
  throw new Error("viewer/lwkm.js not found next to the server");
}

const MOBILE_SKIP_CATS = new Set(["Furniture", "Furniture Systems", "Casework", "Rooms",
  "Plumbing Fixtures", "Lighting Fixtures", "Electrical Fixtures", "Specialty Equipment",
  "Lighting Devices", "Data Devices", "Fire Alarm Devices", "Communication Devices",
  "Security Devices", "Nurse Call Devices", "Telephone Devices", "Food Service Equipment",
  "Medical Equipment", "Signage", "Audio Visual Devices"]);
const GROW_FROM = new Set(["Walls", "Curtain Panels", "Curtain Wall Mullions", "Curtain Systems",
  "Floors", "Roofs", "Windows", "Doors", "Structural Columns", "Columns"]);
const GROW_TO = new Set(["Windows", "Doors", "Curtain Panels", "Curtain Wall Mullions", "Curtain Systems",
  "Railings", "Top Rails", "Handrails", "Wall Sweeps", "Fascias", "Gutters", "Roof Soffits"]);

function readLwkm(file) {
  let buf = fs.readFileSync(file);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const dv = new DataView(ab);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== "LWKM") {
    throw new Error("not an .lwkm file: " + file);
  }
  const jl = dv.getUint32(8, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 16, jl)));
  const base = 16 + jl, B = head.bin;
  return { head, pos: new Float32Array(ab, base + B.pos[0], B.pos[1]),
           idx: new Uint32Array(ab, base + B.idx[0], B.idx[1]),
           mat: new Float64Array(ab, base + B.mat[0], B.mat[1]) };
}
const sigOf = (h) => h.el.id.length + ":" + h.bin.idx[1] + ":" + h.meshes.length;

/* ---------------------------------------------------- 3x4 affine matrices */
const I34 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const mul = (A, B) => {           // A * B, both rows of [a b c t]
  const o = new Array(12);
  for (let r = 0; r < 3; r++) {
    const a0 = A[r * 4], a1 = A[r * 4 + 1], a2 = A[r * 4 + 2];
    o[r * 4] = a0 * B[0] + a1 * B[4] + a2 * B[8];
    o[r * 4 + 1] = a0 * B[1] + a1 * B[5] + a2 * B[9];
    o[r * 4 + 2] = a0 * B[2] + a1 * B[6] + a2 * B[10];
    o[r * 4 + 3] = a0 * B[3] + a1 * B[7] + a2 * B[11] + A[r * 4 + 3];
  }
  return o;
};
const trans = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];

/* Every piece of every element, in the model's local frame (the frame the
   baked positions are in): [element, mesh, matrix or null]. Typical-floor
   copies come as more pieces of the first copy's element (the viewer
   counts a copy seen as its element seen). */
function piecesOf(d) {
  const h = d.head, mat = d.mat, E = h.el.id.length;
  const off = h.offset || [0, 0, 0];
  const ToffI = trans(-off[0], -off[1], -off[2]), Toff = trans(off[0], off[1], off[2]);
  const row = (r) => Array.from(mat.subarray(r * 12, r * 12 + 12));
  const flat = new Map();
  const flatDef = (df, depth = 0) => {
    if (flat.has(df)) return flat.get(df);
    const out = [];
    const def = h.defs[df];
    for (const mi of def.meshes) out.push([mi, null]);
    if (depth < 12) for (const [k, r] of def.kids) {
      const M = row(r);
      for (const [mi, m] of flatDef(k, depth + 1)) out.push([mi, m ? mul(M, m) : M]);
    }
    flat.set(df, out);
    return out;
  };
  const own = Array.from({ length: E }, () => []);
  for (let e = 0; e < E; e++) for (const mi of h.el.baked[e] || []) own[e].push([mi, null]);
  for (const [e, df, r] of h.inst) {
    const M = mul(ToffI, row(r));
    for (const [mi, m] of flatDef(df)) own[e].push([mi, m ? mul(M, m) : M]);
  }
  const copies = new Map();              // element -> extra matrices (the other copies)
  for (const g of h.groups || []) {
    const cs = g.copies.map((r) => mul(mul(ToffI, row(r)), Toff));
    for (const e of g.elements) copies.set(e, cs);
  }
  return { own, copies };
}

function meshBoxes(d) {
  const { pos, head } = d;
  return head.meshes.map(([vs, vc]) => {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let k = vs; k < vs + vc; k++) {
      const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
      if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (z < b[2]) b[2] = z;
      if (x > b[3]) b[3] = x; if (y > b[4]) b[4] = y; if (z > b[5]) b[5] = z;
    }
    return b;
  });
}
function boxThrough(b, M, out) {
  if (!isFinite(b[0])) return;
  for (let k = 0; k < 8; k++) {
    const x = k & 1 ? b[3] : b[0], y = k & 2 ? b[4] : b[1], z = k & 4 ? b[5] : b[2];
    const X = M ? M[0] * x + M[1] * y + M[2] * z + M[3] : x;
    const Y = M ? M[4] * x + M[5] * y + M[6] * z + M[7] : y;
    const Z = M ? M[8] * x + M[9] * y + M[10] * z + M[11] : z;
    if (X < out[0]) out[0] = X; if (Y < out[1]) out[1] = Y; if (Z < out[2]) out[2] = Z;
    if (X > out[3]) out[3] = X; if (Y > out[4]) out[4] = Y; if (Z > out[5]) out[5] = Z;
  }
}

/* --------------------------------------------------------- the 26 views */
function seenFromOutside(d, P, mboxes, log) {
  const h = d.head, pos = d.pos, idx = d.idx, E = h.el.id.length;
  const glassMesh = h.meshes.map((m) => ((h.materials[m[4]] || [0, 0, 0, 1])[3] < 0.99));
  // the whole model
  const all = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let e = 0; e < E; e++) {
    for (const [mi, M] of P.own[e]) {
      boxThrough(mboxes[mi], M, all);
      for (const C of P.copies.get(e) || []) boxThrough(mboxes[mi], M ? mul(C, M) : C, all);
    }
  }
  if (!isFinite(all[0])) return new Uint8Array(E);
  const c = [(all[0] + all[3]) / 2, (all[1] + all[4]) / 2, (all[2] + all[5]) / 2];
  const size = Math.max(all[3] - all[0], all[4] - all[1], all[5] - all[2]);
  // about 8 cm a pixel, at most 2048 x 2048 in 2 x 2 tiles (as the viewer)
  const tiles = Math.max(1, Math.min(2, Math.ceil(size / 150)));
  const RES = Math.max(512, Math.min(2048, Math.ceil(size / tiles / 0.08)));
  const seen = new Uint8Array(E);
  const zO = new Float32Array(RES * RES), iO = new Int32Array(RES * RES);
  const zG = new Float32Array(RES * RES), iG = new Int32Array(RES * RES);
  const corners = [];
  for (let k = 0; k < 8; k++) corners.push([k & 1 ? all[3] : all[0], k & 2 ? all[4] : all[1], k & 4 ? all[5] : all[2]]);
  let proj = new Float32Array(3 * 1024);
  const t0 = Date.now();
  let views = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    if (!dx && !dy && !dz) continue;
    const n = Math.hypot(dx, dy, dz), D = [dx / n, dy / n, dz / n];
    let up = Math.abs(D[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
    // right = up x D, up' = D x right
    let R = [up[1] * D[2] - up[2] * D[1], up[2] * D[0] - up[0] * D[2], up[0] * D[1] - up[1] * D[0]];
    const rl = Math.hypot(...R); R = R.map((v) => v / rl);
    const U = [D[1] * R[2] - D[2] * R[1], D[2] * R[0] - D[0] * R[2], D[0] * R[1] - D[1] * R[0]];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of corners) {
      const x = (q[0] - c[0]) * R[0] + (q[1] - c[1]) * R[1] + (q[2] - c[2]) * R[2];
      const y = (q[0] - c[0]) * U[0] + (q[1] - c[1]) * U[1] + (q[2] - c[2]) * U[2];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    for (let tx = 0; tx < tiles; tx++) for (let ty = 0; ty < tiles; ty++) {
      const X0 = x0 + (x1 - x0) * tx / tiles, X1 = x0 + (x1 - x0) * (tx + 1) / tiles;
      const Y0 = y0 + (y1 - y0) * ty / tiles, Y1 = y0 + (y1 - y0) * (ty + 1) / tiles;
      const sx = RES / (X1 - X0), sy = RES / (Y1 - Y0);
      zO.fill(-Infinity); iO.fill(-1); zG.fill(-Infinity); iG.fill(-1);
      // rows of the view: pixel x, pixel y, nearness (bigger = nearer the camera)
      const Vx = [R[0] * sx, R[1] * sx, R[2] * sx, (-(c[0] * R[0] + c[1] * R[1] + c[2] * R[2]) - X0) * sx];
      const Vy = [U[0] * sy, U[1] * sy, U[2] * sy, (-(c[0] * U[0] + c[1] * U[1] + c[2] * U[2]) - Y0) * sy];
      const Vz = [D[0], D[1], D[2], -(c[0] * D[0] + c[1] * D[1] + c[2] * D[2])];
      const draw = (e, mi, M) => {
        const [vs, vc, is, ic] = h.meshes[mi];
        if (!vc || !ic) return;
        // the view through the piece's matrix
        const a = M ? mul([...Vx, ...Vy, ...Vz], M) : [...Vx, ...Vy, ...Vz];
        if (proj.length < vc * 3) proj = new Float32Array(vc * 3 * 2);
        let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
        for (let k = 0; k < vc; k++) {
          const s = (vs + k) * 3, x = pos[s], y = pos[s + 1], z = pos[s + 2];
          const px = a[0] * x + a[1] * y + a[2] * z + a[3];
          const py = a[4] * x + a[5] * y + a[6] * z + a[7];
          proj[k * 3] = px; proj[k * 3 + 1] = py;
          proj[k * 3 + 2] = a[8] * x + a[9] * y + a[10] * z + a[11];
          if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py;
        }
        if (maxx < 0 || maxy < 0 || minx >= RES || miny >= RES) return;
        const glass = glassMesh[mi];
        const Z = glass ? zG : zO, ID = glass ? iG : iO;
        for (let t = is; t < is + ic; t += 3) {
          const A = idx[t] * 3, B = idx[t + 1] * 3, C = idx[t + 2] * 3;
          const ax = proj[A], ay = proj[A + 1], bx = proj[B], by = proj[B + 1], cx = proj[C], cy = proj[C + 1];
          let area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
          if (area === 0) continue;
          const lx = Math.max(0, Math.floor(Math.min(ax, bx, cx))), hx = Math.min(RES - 1, Math.ceil(Math.max(ax, bx, cx)));
          const ly = Math.max(0, Math.floor(Math.min(ay, by, cy))), hy = Math.min(RES - 1, Math.ceil(Math.max(ay, by, cy)));
          if (lx > hx || ly > hy) continue;
          const az = proj[A + 2], bz = proj[B + 2], cz = proj[C + 2];
          const inv = 1 / area;
          for (let py = ly; py <= hy; py++) {
            const fy = py + 0.5;
            for (let px = lx; px <= hx; px++) {
              const fx = px + 0.5;
              let w0 = ((bx - fx) * (cy - fy) - (by - fy) * (cx - fx)) * inv;
              let w1 = ((cx - fx) * (ay - fy) - (cy - fy) * (ax - fx)) * inv;
              const w2 = 1 - w0 - w1;
              if (w0 < 0 || w1 < 0 || w2 < 0) continue;
              const z = w0 * az + w1 * bz + w2 * cz;
              const p = py * RES + px;
              if (z > Z[p]) { Z[p] = z; ID[p] = e; }
            }
          }
        }
      };
      for (let e = 0; e < E; e++) {
        for (const [mi, M] of P.own[e]) {
          draw(e, mi, M);
          for (const Cm of P.copies.get(e) || []) draw(e, mi, M ? mul(Cm, M) : Cm);
        }
      }
      for (let p = 0; p < iO.length; p++) {
        if (iO[p] >= 0) seen[iO[p]] = 1;
        if (iG[p] >= 0 && zG[p] > zO[p]) seen[iG[p]] = 1;   // glass in front of what is behind it
      }
      views++;
    }
  }
  log(`  ${views} views at ${RES} px in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return seen;
}

/* Openings in the outside count as outside (as growExterior in the viewer). */
function grow(d, P, mboxes, seen, boxes) {
  const h = d.head, E = h.el.id.length;
  const cat = (e) => h.cats[h.el.cat[e]];
  const CELL = 4;
  let added = 0;
  for (let pass = 0; pass < 2; pass++) {
    const grid = new Map();
    for (let e = 0; e < E; e++) {
      const b = boxes[e];
      if (!seen[e] || !b || !GROW_FROM.has(cat(e))) continue;
      for (let x = Math.floor(b[0] / CELL); x <= Math.floor(b[3] / CELL); x++)
        for (let y = Math.floor(b[1] / CELL); y <= Math.floor(b[4] / CELL); y++)
          for (let z = Math.floor(b[2] / CELL); z <= Math.floor(b[5] / CELL); z++) {
            const k = x + "," + y + "," + z;
            let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(b);
          }
    }
    let now = 0;
    for (let e = 0; e < E; e++) {
      const b = boxes[e];
      if (seen[e] || !b || !GROW_TO.has(cat(e))) continue;
      const q = [b[0] - 0.03, b[1] - 0.03, b[2] - 0.03, b[3] + 0.03, b[4] + 0.03, b[5] + 0.03];
      let hit = false;
      for (let x = Math.floor(q[0] / CELL); x <= Math.floor(q[3] / CELL) && !hit; x++)
        for (let y = Math.floor(q[1] / CELL); y <= Math.floor(q[4] / CELL) && !hit; y++)
          for (let z = Math.floor(q[2] / CELL); z <= Math.floor(q[5] / CELL) && !hit; z++)
            for (const s of grid.get(x + "," + y + "," + z) || [])
              if (s[0] <= q[3] && s[3] >= q[0] && s[1] <= q[4] && s[4] >= q[1] && s[2] <= q[5] && s[5] >= q[2]) { hit = true; break; }
      if (hit) { seen[e] = 1; now++; }
    }
    added += now;
    if (!now) break;
  }
  return added;
}

function trisTotal(h) {
  const meshT = (mi) => h.meshes[mi][3] / 3;
  const defT = new Map();
  const dT = (d, depth = 0) => {
    if (defT.has(d)) return defT.get(d);
    let s = 0;
    for (const mi of h.defs[d].meshes) s += meshT(mi);
    if (depth < 12) for (const [k] of h.defs[d].kids) s += dT(k, depth + 1);
    defT.set(d, s);
    return s;
  };
  const E = h.el.id.length, t = new Float64Array(E);
  for (let e = 0; e < E; e++) for (const mi of h.el.baked[e] || []) t[e] += meshT(mi);
  for (const [e, d] of h.inst) t[e] += dT(d);
  for (const g of h.groups || []) for (const e of g.elements) t[e] *= 1 + g.copies.length;
  return t.reduce((a, b) => a + b, 0);
}

async function main() {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith("--"));
  const force = args.includes("--force");
  const only = args.includes("--model") ? args[args.indexOf("--model") + 1] : null;
  if (!root) { console.error("usage: node mobile.mjs <project folder> [--force] [--model fragments/x.lwkm]"); process.exit(2); }
  const log = (s) => console.log(s);
  const man = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const models = (man.models || []).filter((m) => m.format === "lwkm" && m.fragments
    && fs.existsSync(path.join(root, m.fragments)));
  if (!models.length) { log("no fast 3D models"); return; }
  const L = await viewerLwkm();
  // the phone's triangle budget is shared by size
  const sizes = new Map();
  for (const m of models) {
    try { sizes.set(m.fragments, trisTotal(readLwkm(path.join(root, m.fragments)).head)); } catch (e) { sizes.set(m.fragments, 0); }
  }
  const sum = [...sizes.values()].reduce((a, b) => a + b, 0) || 1;
  let made = 0;
  for (const m of models) {
    if (only && m.fragments !== only) continue;
    const file = path.join(root, m.fragments);
    const stem = file.replace(/\.lwkm$/i, "");
    const d = readLwkm(file);
    const sig = sigOf(d.head);
    let ext = null;
    try { ext = JSON.parse(fs.readFileSync(stem + ".ext.json", "utf8")); } catch (e) {}
    const mobileFile = `${stem}.mobile${MOBILE_RULE}.lwkm`;
    if (!force && ext && ext.sig === sig && (ext.rule || 1) >= EXT_RULE && fs.existsSync(mobileFile)) {
      log(`${m.name}: up to date`); continue;
    }
    log(`${m.name}: ${d.head.el.id.length} elements`);
    const t0 = Date.now();
    const P = piecesOf(d);
    const mboxes = meshBoxes(d);
    const E = d.head.el.id.length;
    // each element's box (its first copy), for growing and for sizes
    const boxes = new Array(E);
    for (let e = 0; e < E; e++) {
      const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const [mi, M] of P.own[e]) boxThrough(mboxes[mi], M, b);
      boxes[e] = isFinite(b[0]) ? b : null;
    }
    let seen;
    if (ext && ext.sig === sig && Array.isArray(ext.ext) && !force) {
      // a list made already (by a computer): grown, not drawn again
      seen = new Uint8Array(E);
      for (const e of ext.ext) if (e >= 0 && e < E) seen[e] = 1;
    } else {
      seen = seenFromOutside(d, P, mboxes, log);
    }
    const added = grow(d, P, mboxes, seen, boxes);
    const list = [];
    for (let e = 0; e < E; e++) if (seen[e]) list.push(e);
    if (list.length < Math.max(1, E * 0.02)) { log(`${m.name}: almost nothing seen (${list.length}) - not kept`); continue; }
    fs.writeFileSync(stem + ".ext.json.part", JSON.stringify({ sig, ext: list,
      made: new Date().toISOString(), views: 26, rule: EXT_RULE, by: "server" }));
    fs.renameSync(stem + ".ext.json.part", stem + ".ext.json");
    // the phone's copy
    const h = d.head;
    const keep = new Uint8Array(E), protect = new Uint8Array(E), diag = new Float32Array(E);
    for (let e = 0; e < E; e++) {
      const c = h.cats[h.el.cat[e]];
      const b = boxes[e];
      diag[e] = b ? Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) : 0;
      protect[e] = L.ENVELOPE_CATS.has(c) ? 1 : 0;
      const small = diag[e] < SMALL_DIAG && !protect[e];
      keep[e] = seen[e] && (protect[e] || !small) && !MOBILE_SKIP_CATS.has(c) ? 1 : 0;
    }
    const cap = Math.max(30000, Math.round(MOBILE_TRIS * (sizes.get(m.fragments) || 0) / sum));
    const out = L.writeMobileLwkm(d, keep, sig, { diag, maxTris: cap, protect });
    fs.writeFileSync(mobileFile + ".part", zlib.gzipSync(Buffer.from(out.buffer, out.byteOffset, out.byteLength), { level: 6 }));
    fs.renameSync(mobileFile + ".part", mobileFile);
    // older copies of this model go
    const dir = path.dirname(file), base = path.basename(stem);
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(base + ".mobile") && f.endsWith(".lwkm") && path.join(dir, f) !== mobileFile) {
        try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
      }
    }
    made++;
    log(`${m.name}: ${list.length} of ${E} outside (${added} openings added), phone copy `
      + `${(fs.statSync(mobileFile).size / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  log(`done: ${made} model(s)`);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
