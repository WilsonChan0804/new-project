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
const head = fs.readFileSync(src, { encoding: "latin1", flag: "r" }).slice(0, 2000);
if (!/ISO-10303-21/.test(head)) {
  console.error("That file is not an IFC (STEP) file. Ask for IFC 2x3 or IFC4 - .ifc, not .ifczip or .ifcxml.");
  process.exit(4);
}
const schema = (head.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i) || [])[1] || "?";
console.log(`reading ${path.basename(src)} (${(fs.statSync(src).size / 1048576).toFixed(1)} MB, ${schema})`);

const importer = new FRAGS.IfcImporter();
importer.wasm = { absolute: true, path: WASM };
let last = -1;
const bytes = await importer.process({
  bytes: new Uint8Array(fs.readFileSync(src)),
  raw: false,
  progressCallback: (p) => {
    const pct = Math.floor((typeof p === "number" ? p : 0) * 100 / 10) * 10;
    if (pct !== last) { last = pct; console.log(`progress ${pct}%`); }
  },
});
const tmp = out + ".part";
fs.writeFileSync(tmp, bytes);
fs.renameSync(tmp, out);
console.log(JSON.stringify({ ok: true, bytes: bytes.length, ms: Date.now() - t0, schema }));
