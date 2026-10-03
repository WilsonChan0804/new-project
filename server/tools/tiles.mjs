#!/usr/bin/env node
/* The streamed form of a project's fast 3D models, made on the server.
 *
 *   node tiles.mjs <project folder> [--force] [--model <fragments/x.lwkm>]
 *
 * Each model is built exactly as the viewer builds it (the viewer's own
 * lwkm.js and three.js, from the viewer folder next to the server), with
 * what is seen from outside (<name>.ext.json, made by mobile.mjs just
 * before), and written as:
 *
 *   <name>.tidx   the index: every batch of the model, where it is, which
 *                 elements it holds and their boxes (gzip)
 *   <name>.tbin   the geometry: each batch in full and as up to three
 *                 coarser copies, each piece compressed on its own
 *
 * A phone or a tablet then fetches only the pieces its view needs - the
 * coarse ones first - and lets go of them again when its memory budget is
 * reached, instead of holding the whole model.
 *
 * Runs in the background after an upload, after mobile.mjs (server/app.py).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TILE_VERSION = 2;

function viewerDir() {
  for (const p of [path.join(HERE, "..", "..", "viewer"), path.join(HERE, "..", "viewer")]) {
    if (fs.existsSync(path.join(p, "lwkm.js"))) return p;
  }
  throw new Error("the viewer folder (lwkm.js) was not found next to the server");
}
// as a data: URL, so it loads as a module whatever Node's version thinks of a .js file
const importSource = (file) => import("data:text/javascript;base64," + fs.readFileSync(file).toString("base64"));

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

function readIndexMeta(file) {
  try {
    let buf = fs.readFileSync(file);
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    const jl = buf.readUInt32LE(8);
    return JSON.parse(buf.subarray(16, 16 + jl).toString("utf8"));
  } catch (e) { return null; }
}

async function main() {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith("--"));
  const force = args.includes("--force");
  const only = args.includes("--model") ? args[args.indexOf("--model") + 1] : null;
  if (!root) { console.error("usage: node tiles.mjs <project folder> [--force] [--model fragments/x.lwkm]"); process.exit(2); }
  const log = (s) => console.log(s);
  const man = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const models = (man.models || []).filter((m) => m.format === "lwkm" && m.fragments
    && fs.existsSync(path.join(root, m.fragments)));
  if (!models.length) { log("no fast 3D models"); return; }
  const vdir = viewerDir();
  const three = path.join(vdir, "vendor", "three-fragments.js");
  if (!fs.existsSync(three)) throw new Error("viewer/vendor/three-fragments.js is missing");
  const V = await importSource(three);
  const THREE = V.THREE;
  const L = await importSource(path.join(vdir, "lwkm.js"));
  let made = 0;
  for (const m of models) {
    if (only && m.fragments !== only) continue;
    const file = path.join(root, m.fragments);
    const stem = file.replace(/\.lwkm$/i, "");
    const t0 = Date.now();
    const d = readLwkm(file);
    const sig = sigOf(d.head);
    const E = d.head.el.id.length;
    let ext = null;
    try { ext = JSON.parse(fs.readFileSync(stem + ".ext.json", "utf8")); } catch (e) {}
    let exterior = null;
    if (ext && ext.sig === sig && Array.isArray(ext.ext) && ext.ext.length >= Math.max(1, E * 0.02)) {
      exterior = new Uint8Array(E);
      for (const e of ext.ext) if (e >= 0 && e < E) exterior[e] = 1;
    }
    const old = readIndexMeta(stem + ".tidx");
    if (!force && old && old.sig === sig && old.tileVersion === TILE_VERSION
        && !!old.hasExterior === !!exterior && fs.existsSync(stem + ".tbin")) {
      log(`${m.name}: tiles up to date`);
      continue;
    }
    const meta = { sig, tileVersion: TILE_VERSION, source: m.fragments, made: new Date().toISOString(),
                   hasExterior: !!exterior, extRule: exterior ? (ext.rule || 1) : 0 };
    const gzip = (u8) => zlib.gzipSync(Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength), { level: 6 });
    const out = await L.buildTiles(THREE, d, { name: m.name, exterior, gzip, meta });
    // the pack first, then the index that points into it
    const fd = fs.openSync(stem + ".tbin.part", "w");
    for (const p of out.pack) fs.writeSync(fd, p);
    fs.closeSync(fd);
    fs.renameSync(stem + ".tbin.part", stem + ".tbin");
    fs.writeFileSync(stem + ".tidx.part", gzip(out.index));
    fs.renameSync(stem + ".tidx.part", stem + ".tidx");
    made++;
    const src = fs.statSync(file).size;
    log(`${m.name}: tiles ${(fs.statSync(stem + ".tidx").size / 1e6).toFixed(2)} MB index + `
      + `${(out.packBytes / 1e6).toFixed(1)} MB pieces (model file ${(src / 1e6).toFixed(1)} MB), `
      + `${((Date.now() - t0) / 1000).toFixed(1)} s${exterior ? "" : " - no outside list yet, everything counts as outside"}`);
  }
  log(`done: ${made} model(s)`);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
