/* IFC -> fragments, for consultant models (server/refs.py).
 *
 *   node ifc2frag.mjs <in.ifc> <out.frag>
 *
 * Any IFC 2x3 or IFC4 file - from SketchUp, Revit, Tekla, ArchiCAD, Rhino
 * - becomes the same .frag format the viewer already shows, with its
 * elements, their properties and their real coordinates kept. Uses the
 * same fragments version as viewer/vendor/three-fragments.js (3.4.7) and
 * web-ifc to read the IFC. Bundled in tools/ifc/ - nothing to install.
 *
 * Prints progress lines, then one JSON line: {"ok":true,"bytes":...}.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error("usage: node ifc2frag.mjs <in.ifc> <out.frag>");
  process.exit(2);
}

/* The converter comes bundled (tools/ifc/frags.bundle.cjs and the web-ifc
   wasm beside it), so nothing has to be installed. A newer copy installed
   with `npm install` in this folder is used first when there is one. */
let FRAGS, WASM = path.join(HERE, "node_modules", "web-ifc") + path.sep;
try {
  FRAGS = await import("@thatopen/fragments");
} catch (e) {
  try {
    const { createRequire } = await import("node:module");
    FRAGS = createRequire(import.meta.url)(path.join(HERE, "ifc", "frags.bundle.cjs"));
    WASM = path.join(HERE, "ifc") + path.sep;
  } catch (e2) {
    console.error("The IFC converter is missing: server/tools/ifc/frags.bundle.cjs (" + e2.message + ")");
    process.exit(3);
  }
}

const t0 = Date.now();
/* Only the start of the file is read for the check: reading a whole IFC
   as text fails past 512 MB ("Cannot create a string longer than ..."). */
const fd = fs.openSync(src, "r");
const hb = Buffer.alloc(4096);
const hn = fs.readSync(fd, hb, 0, 4096, 0);
fs.closeSync(fd);
const head = hb.subarray(0, hn).toString("latin1");
const MB = fs.statSync(src).size / 1048576;
if (!/ISO-10303-21/.test(head)) {
  console.error("That file is not an IFC (STEP) file. Ask for IFC 2x3 or IFC4 - .ifc, not .ifczip or .ifcxml.");
  process.exit(4);
}
const schema = (head.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i) || [])[1] || "?";
console.log(`reading ${path.basename(src)} (${MB.toFixed(1)} MB, ${schema})`);

/* One line saying why, for the page (refs.py shows the last line). */
function fail(e) {
  const m = String((e && (e.message || e)) || "");
  const big = /memory|alloc|out of bounds|RangeError|heap|Array buffer|too large|ERR_STRING_TOO_LONG/i.test(m + " " + (e && e.name));
  console.error(big
    ? `The IFC is too big to convert on this server (${MB.toFixed(0)} MB). Ask for it split (by building, storey or discipline) or exported without unneeded property sets, or give the server more memory.`
    : "The IFC could not be converted: " + m.split("\n")[0].slice(0, 240));
  process.exit(5);
}
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

const importer = new FRAGS.IfcImporter();
importer.wasm = { absolute: true, path: WASM };
let last = -1;
let bytes;
try {
  bytes = await importer.process({
    bytes: new Uint8Array(fs.readFileSync(src)),
    raw: false,
    progressCallback: (p) => {
      const pct = Math.floor((typeof p === "number" ? p : 0) * 100 / 10) * 10;
      if (pct !== last) { last = pct; console.log(`progress ${pct}%`); }
    },
  });
} catch (e) { fail(e); }
const tmp = out + ".part";
fs.writeFileSync(tmp, bytes);
fs.renameSync(tmp, out);
console.log(JSON.stringify({ ok: true, bytes: bytes.length, ms: Date.now() - t0, schema }));
