/* The fast 3D format (.lwkm), written by the Revit exporter's fast3d.py.
 *
 * Loads straight into three.js - no worker, no conversion on the server -
 * and answers the same questions the rest of the viewer asks a fragments
 * model (raycast, setVisible, getItemsData, getBoxes ...), so model.js
 * treats both the same way.
 *
 * How it is drawn:
 *   - the elements drawn once are merged, one mesh per material;
 *   - a family type placed many times (doors, windows) is one mesh per
 *     material drawn as instances;
 *   - a typical floor (a group copied up the building) likewise: one mesh
 *     per material, one instance per copy.
 * Which element a triangle belongs to is a vertex attribute ("col"); a
 * small texture holds each element's state per copy (shown, hidden,
 * selected), read by the shader - hiding or selecting costs one texel,
 * never a rebuild.
 *
 * Picking is done on the CPU against the same arrays: each element keeps
 * its box and its triangle ranges, so a ray is tested against boxes first
 * and only the triangles of the elements it passes through.
 */

const INSTANCE_MIN = 6;          // placements before a family type is instanced
const MAX_BATCH_VERTS = 4e6;     // keeps each buffer well inside phone limits
const STATE_W = 4096;

const REVIT_TO_IFC = {
  "Walls": "IFCWALL", "Floors": "IFCSLAB", "Roofs": "IFCROOF", "Doors": "IFCDOOR",
  "Windows": "IFCWINDOW", "Columns": "IFCCOLUMN", "Structural Columns": "IFCCOLUMN",
  "Structural Framing": "IFCBEAM", "Stairs": "IFCSTAIR", "Ramps": "IFCRAMP",
  "Railings": "IFCRAILING", "Top Rails": "IFCRAILING", "Handrails": "IFCRAILING",
  "Curtain Panels": "IFCPLATE", "Curtain Wall Mullions": "IFCMEMBER",
  "Ceilings": "IFCCOVERING", "Furniture": "IFCFURNITURE", "Furniture Systems": "IFCFURNITURE",
  "Generic Models": "IFCBUILDINGELEMENTPROXY", "Rooms": "IFCSPACE",
  "Structural Foundations": "IFCFOOTING", "Plumbing Fixtures": "IFCSANITARYTERMINAL",
  "Lighting Fixtures": "IFCLIGHTFIXTURE", "Ducts": "IFCFLOWSEGMENT", "Pipes": "IFCFLOWSEGMENT",
  "Cable Trays": "IFCFLOWSEGMENT", "Conduits": "IFCFLOWSEGMENT",
  "Duct Fittings": "IFCFLOWFITTING", "Pipe Fittings": "IFCFLOWFITTING",
  "Mechanical Equipment": "IFCFLOWTERMINAL", "Air Terminals": "IFCFLOWTERMINAL",
  "Sprinklers": "IFCFLOWTERMINAL", "Electrical Equipment": "IFCDISTRIBUTIONELEMENT",
  "Electrical Fixtures": "IFCDISTRIBUTIONELEMENT", "Specialty Equipment": "Specialty equipment",
  "Casework": "Casework", "Planting": "Planting", "Entourage": "Entourage",
  "Mass": "Mass", "Parking": "Parking", "Site": "Site", "Topography": "Topography",
  "Toposolid": "Topography",
};

/* What makes a building look like itself: never treated as a "small
   thing" (drawn only near the camera) and never left out of a phone's
   copy, however small one piece is - a short wall, a small window. */
export const ENVELOPE_CATS = new Set(["Walls", "Windows", "Doors", "Curtain Panels", "Curtain Wall Mullions",
  "Curtain Systems", "Floors", "Roofs", "Columns", "Structural Columns", "Structural Framing",
  "Stairs", "Railings", "Top Rails", "Handrails", "Ramps", "Roof Soffits", "Fascias", "Gutters",
  "Wall Sweeps", "Slab Edges", "Topography", "Toposolid", "Site", "Structural Foundations"]);

/* Phones and tablets: what is drawn at what distance (metres, from the
   camera to each block of space or each copy).
   0 - the building itself (walls, floors, roofs, columns, facade panels):
       always;
   1 - openings and their trim (windows, doors, mullions, railings):
       in full within about 80 m, further off as their plainest copy
       (never left out: a facade without its windows would have holes);
   2 - everything else (furniture, fittings, equipment, generic models):
       within about 25 m.
   While the view moves, a little nearer still. */
export const TIER_NEAR = [Infinity, 80, 25];
const TIER1_CATS = new Set(["Windows", "Doors", "Curtain Wall Mullions", "Railings", "Top Rails",
  "Handrails", "Wall Sweeps", "Fascias", "Gutters", "Roof Soffits", "Slab Edges"]);
export function tierOfCat(c) {
  if (TIER1_CATS.has(c)) return 1;
  return ENVELOPE_CATS.has(c) ? 0 : 2;
}

/* ------------------------------------------------------- the cut (poché)

   Where a section cuts through a solid, the inside of the solid shows:
   the far faces, seen from their back. Those back faces are painted one
   flat colour - by kind of element, dark for walls and structure, lighter
   for floors, lighter still for fittings - so a cut reads like a drawing's
   solid fill, with no extra drawing passes. Only elements whose surface is
   closed get it (worked out once, the first time a section is used): an
   open surface seen from behind is not a cut, and stays as it is. */
export const CAP_CLASS = { none: 0, heavy: 1, slab: 2, light: 3, finish: 4 };
const CAP_OF_CAT = new Map([
  ...["Walls", "Columns", "Structural Columns", "Structural Framing", "Structural Foundations",
      "Structural Walls", "Curtain Systems"].map((c) => [c, 1]),
  ...["Floors", "Roofs", "Stairs", "Ramps", "Slab Edges", "Toposolid", "Topography", "Site",
      "Roof Soffits", "Fascias", "Gutters"].map((c) => [c, 2]),
  ...["Ceilings", "Wall Sweeps"].map((c) => [c, 4]),
]);
const capClassOfCat = (c) => CAP_OF_CAT.get(c) || 3;
let POCHE = null;
/* The uniforms every fast 3D material shares: whether the cut is filled,
   its colours, and the plan look (surfaces paled towards paper, and what
   lies below the floor faded away). */
export function pocheUniforms(THREE) {
  if (POCHE) return POCHE;
  // walls and structure, floors, fittings, finishes: oranges, strongest first
  const pal = [0xffffff, 0xf29a4a, 0xf6b67a, 0xf9cfa3, 0xfbe0c4, 0xf29a4a, 0xf29a4a, 0xf29a4a]
    .map((h) => { const c = new THREE.Color(h); return new THREE.Vector3(c.r, c.g, c.b); });
  POCHE = {
    capOn: { value: false },
    capPal: { value: pal },
    // x: floor level (world y), y: fade range (m), z: 1 = fade below on, w: paper (0..1)
    plan: { value: new THREE.Vector4(0, 6, 0, 0) },
  };
  return POCHE;
}

export async function fetchLwkm(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return gunzipIfNeeded(await res.arrayBuffer());
}

export async function gunzipIfNeeded(buf) {
  const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (b[0] === 0x1f && b[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("this browser cannot unpack the model (update Safari / iOS)");
    }
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    buf = await new Response(ds).arrayBuffer();
  }
  return buf;
}

export function parseLwkm(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "LWKM") throw new Error("not an .lwkm file");
  const jsonLen = dv.getUint32(8, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 16, jsonLen)));
  const base = 16 + jsonLen;
  const B = head.bin;
  const pos = new Float32Array(buf, base + B.pos[0], B.pos[1]);
  const idx = new Uint32Array(buf, base + B.idx[0], B.idx[1]);
  const mat = new Float64Array(buf, base + B.mat[0], B.mat[1]);
  return { head, pos, idx, mat };
}

/* The WebGPU trial (model.js, "Drawing with"): the renderer there takes
   node materials, not patched shaders, so the same drawing rules - hidden
   elements left out, the selection colour, the hatched cut, the plan look -
   are written again with three's node functions (TSL). Set once, before any
   model is built; null = WebGL, as always. */
let NODES = null;
export function useNodeMaterials(ns) { NODES = ns || null; }

/* ------------------------------------------------------------------ model */

/* Building a big model takes the processor for a second or more; it is
   done in slices of about 12 ms, handing the page back in between, so
   the view keeps moving and the page stays usable while models load. */
export async function createLwkModel(THREE, data, opts = {}) {
  let _sliceAt = performance.now();
  const slice = async () => {
    if (performance.now() - _sliceAt < 12) return;
    await new Promise((r) => setTimeout(r, 0));
    _sliceAt = performance.now();
  };
  /* A model streamed in tiles (see the tile files below) comes with no
     geometry at all: its batches are described by the index, and each
     batch's geometry - full or coarser - is fetched when the view needs it
     and let go again when memory is short. */
  const TILED = opts.tiled || null;
  const { head } = data;
  let { pos, idx, mat } = data;   // let go once the batches are built
  const E = head.el.id.length;
  const off = head.offset || [0, 0, 0];
  const Toff = new THREE.Matrix4().makeTranslation(off[0], off[1], off[2]);
  const ToffI = new THREE.Matrix4().makeTranslation(-off[0], -off[1], -off[2]);

  const m4 = (row) => {
    const o = row * 12;
    return new THREE.Matrix4().set(
      mat[o], mat[o + 1], mat[o + 2], mat[o + 3],
      mat[o + 4], mat[o + 5], mat[o + 6], mat[o + 7],
      mat[o + 8], mat[o + 9], mat[o + 10], mat[o + 11],
      0, 0, 0, 1);
  };

  /* A def (a family type's geometry) as a flat list of (mesh, matrix in
     the def's own frame), nested defs opened up. */
  const flatCache = new Map();
  function flatDef(d, depth = 0) {
    if (flatCache.has(d)) return flatCache.get(d);
    const out = [];
    const def = head.defs[d];
    const I = new THREE.Matrix4();
    for (const mi of def.meshes) out.push([mi, I]);
    if (depth < 12) {
      for (const [k, row] of def.kids) {
        const M = m4(row);
        for (const [mi, m] of flatDef(k, depth + 1)) out.push([mi, M.clone().multiply(m)]);
      }
    }
    flatCache.set(d, out);
    return out;
  }

  // group membership (the first copy's elements)
  const groupOf = new Int32Array(E).fill(-1);
  (head.groups || []).forEach((g, gi) => { for (const e of g.elements) groupOf[e] = gi; });

  // placements per def, outside groups: many -> instanced
  const defUse = new Map();
  for (const [e, d] of head.inst) {
    if (groupOf[e] >= 0) continue;
    defUse.set(d, (defUse.get(d) || 0) + 1);
  }

  /* Pieces each element is made of: [mesh, matrix-or-null(local frame)].
     Baked meshes are already in the local (offset) frame. */
  const pieces = TILED ? [] : Array.from({ length: E }, () => []);
  if (!TILED) for (let e = 0; e < E; e++) for (const mi of head.el.baked[e]) pieces[e].push([mi, null]);
  const instancedDefs = new Map();     // def -> [[element, matrix(local)]]
  for (const [e, d, row] of head.inst) {
    const Mloc = ToffI.clone().multiply(m4(row));
    if (groupOf[e] < 0 && (defUse.get(d) || 0) >= INSTANCE_MIN) {
      if (!instancedDefs.has(d)) instancedDefs.set(d, []);
      instancedDefs.get(d).push([e, Mloc]);
      continue;
    }
    for (const [mi, m] of flatDef(d)) pieces[e].push([mi, Mloc.clone().multiply(m)]);
  }

  /* ------------------------------------------------------------ batches

     Colours are per vertex, so a batch holds every material at once: one
     draw for a whole block of the building instead of one per material.
     The elements drawn once are split into blocks of space (CELL), so a
     block out of view, or cut away by the section box, is not drawn at
     all. Small things (fittings, fixtures) go in batches of their own that
     are only drawn near the camera. Copies of a family type or of a
     typical floor are instances, each culled on its own. */
  const CELL = [24, 24, 12];           // metres (model frame, Z up)
  const SMALL_DIAG = 1.2;              // metres: an element this size is "small"
  const envelope = (e) => ENVELOPE_CATS.has(head.cats[head.el.cat[e]]);
  const tierOfEl = (e) => (e === null || e === undefined || e >= E ? 0 : tierOfCat(head.cats[head.el.cat[e]]));
  const isSmall = (e, d) => d < SMALL_DIAG && !envelope(e);
  const batches = [];
  /* Where each element is drawn: (batch, column, instance) triples, kept
     as two flat number arrays (offsets per element, then the triples) -
     a Map of small arrays per drawn id took 50 MB for a model of 23,000
     elements with a typical floor copied 40 times. A typical floor's
     copies are not written down at all: copy k of member j is drawn
     where member j is, as instance k (see eachWhere). */
  let noteBuf = [];
  const note = (lid, b, col, inst) => {
    if (lid >= E) return;                // a copy: worked out from its member
    noteBuf.push(lid, b, col, inst);
  };
  let wOff = null, wData = null;
  function buildWhere() {
    const cnt = new Uint32Array(E + 1);
    for (let i = 0; i < noteBuf.length; i += 4) cnt[noteBuf[i] + 1]++;
    for (let e = 0; e < E; e++) cnt[e + 1] += cnt[e];
    wOff = cnt;
    wData = new Uint32Array(noteBuf.length / 4 * 3);
    const fill = wOff.slice(0, E);
    for (let i = 0; i < noteBuf.length; i += 4) {
      const o = fill[noteBuf[i]]++ * 3;
      wData[o] = noteBuf[i + 1]; wData[o + 1] = noteBuf[i + 2]; wData[o + 2] = noteBuf[i + 3];
    }
    noteBuf = null;
  }
  /* typical floors: [base id, members, copies] - copy k (1..n) of member j
     has the id base + (k - 1) * members + j */
  const groupsRt = [];
  function copyInfo(lid) {
    let lo = 0, hi = groupsRt.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, g = groupsRt[mid];
      if (lid < g.base) hi = mid - 1;
      else if (lid >= g.base + g.m * g.n) lo = mid + 1;
      else { const r = lid - g.base; return [g.members[r % g.m], Math.floor(r / g.m) + 1]; }
    }
    return null;
  }
  function eachWhere(lid, fn) {
    if (!wOff) return;
    let e = lid, kk = -1;
    if (lid >= E) { const c = copyInfo(lid); if (!c) return; e = c[0]; kk = c[1]; }
    for (let i = wOff[e]; i < wOff[e + 1]; i++) fn(wData[i * 3], wData[i * 3 + 1], kk < 0 ? wData[i * 3 + 2] : kk);
  }
  const hasWhere = (e) => wOff && wOff[e + 1] > wOff[e];
  function forEachLid(fn) {
    for (let e = 0; e < E; e++) if (hasWhere(e)) fn(e);
    for (const g of groupsRt) {
      for (let k = 1; k <= g.n; k++) {
        for (let j = 0; j < g.m; j++) if (hasWhere(g.members[j])) fn(g.base + (k - 1) * g.m + j);
      }
    }
  }
  /* instance matrices, 16 numbers each, and one matrix to read them into */
  const _im = new THREE.Matrix4(), _im2 = new THREE.Matrix4();
  const instM = (b, k, out = _im) => out.fromArray(b.im, k * 16);
  const materials = [];                // one per batch (display modes change these)
  const shared = { pick: { value: new THREE.Color(0xf28022) } };
  const matInfo = (mi) => head.materials[mi] || [180, 180, 180, 1];
  const isGlass = (mi) => matInfo(mi)[3] < 0.99;

  const PU = pocheUniforms(THREE);
  /* A batch's material: for WebGL, three's own with its shader patched;
     for the WebGPU trial, a node material doing the same.

     WebGPU: building a node material's shader costs the processor tens of
     milliseconds, and a project has thousands of batches - one material
     each made opening a model take minutes. So there every batch of a
     model shares one material (two: solid and glass), and the batches'
     states are gathered into one texture for the model (the "atlas"): a
     batch finds its own part of it by its offset, kept on its mesh. */
  function lwkMaterial(props, tex, cols) {
    if (NODES) return sharedNodeMaterial(props);
    const m = new THREE.MeshLambertMaterial(props);
    patchMaterial(m);
    m.userData.stateTex = tex.texture;
    m.userData.cols = cols;
    return m;
  }
  const ATLAS_W = 4096;
  const atlas = NODES ? { rows: 0, tex: null, node: null, used: 0, list: [] } : null;
  function atlasGrow(need) {
    let rows = Math.max(16, atlas.rows);
    while (rows * ATLAS_W < need) rows *= 2;
    if (rows === atlas.rows) return;
    const data = new Uint8Array(ATLAS_W * rows * 4);
    const t = new THREE.DataTexture(data, ATLAS_W, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    t.needsUpdate = true;
    const old = atlas.tex;
    atlas.tex = t; atlas.rows = rows;
    for (const e of atlas.list) e.ver = -1;          // copied again into the new one
    if (atlas.node) atlas.node.value = t;
    if (old) old.dispose();
  }
  function atlasAlloc(texture, data, count) {
    const off = atlas.used;
    atlas.used += count;
    if (atlas.used > atlas.rows * ATLAS_W) atlasGrow(atlas.used);
    atlas.list.push({ texture, data, off, count, ver: -1 });
    return off;
  }
  /* once a frame: the batches whose states changed are copied in */
  function atlasSync() {
    let dirty = false;
    const A = atlas.tex.image.data;
    for (const e of atlas.list) {
      if (e.ver === e.texture.version) continue;
      e.ver = e.texture.version;
      A.set(e.data.subarray(0, e.count * 4), e.off * 4);
      dirty = true;
    }
    if (dirty) atlas.tex.needsUpdate = true;
  }
  const nodeMats = new Map();
  function sharedNodeMaterial(props) {
    const key = props.transparent ? "glass" : "solid";
    let m = nodeMats.get(key);
    if (!m) { m = nodeMaterial(props); nodeMats.set(key, m); materials.push(m); }
    return m;
  }
  function nodeMaterial(props) {
    const { GPU, TSL: T } = NODES;
    if (!atlas.tex) atlasGrow(ATLAS_W * 16);
    const vc = props.vertexColors !== false;
    const m = new GPU.MeshLambertNodeMaterial({ ...props, vertexColors: false });
    m.userData.lwk = true;
    /* the display modes switch vertex colours on and off (White): that is
       a uniform here, so the material need not be built again */
    const useVC = T.uniform(vc ? 1 : 0);
    Object.defineProperty(m, "vertexColors", {
      get() { return useVC.value > 0.5; },
      set(v) { useVC.value = v ? 1 : 0; },
      configurable: true,
    });
    if (!atlas.node) atlas.node = T.texture(atlas.tex);
    // each batch's place in the atlas, and its width in elements: per mesh
    const off = T.userData("lwkOff", "int"), cols = T.userData("lwkCols", "int");
    // each instance's state, read once per vertex, the same for the whole triangle
    const si = off.add(T.int(T.attribute("iid", "float").add(0.5)).mul(cols)).add(T.int(T.attribute("col", "float").add(0.5)));
    const st = T.textureLoad(atlas.node, T.ivec2(si.mod(ATLAS_W), si.div(ATLAS_W))).mul(255).add(0.5).floor();
    const vSt = T.varying(st).setInterpolation(GPU.InterpolationSamplingType.FLAT);
    const state = vSt.x, cap = vSt.y, capIdx = vSt.z;
    const pick = T.uniform(new THREE.Color()).onRenderUpdate(() => shared.pick.value);
    // (the states are brought up to date once a frame, from here)
    const capOn = T.uniform(0).onRenderUpdate(() => { atlasSync(); return PU.capOn.value ? 1 : 0; });
    const plan = T.uniform(new THREE.Vector4()).onRenderUpdate(() => PU.plan.value);
    const pal = T.uniformArray(PU.capPal.value.map((v) => new THREE.Vector3(v.x, v.y, v.z)), "vec3");
    const vcol = T.attribute("color", "vec3");
    m.colorNode = T.Fn(() => {
      // hidden: left out altogether
      T.If(state.greaterThan(0.5).and(state.lessThan(1.5)), () => { T.Discard(); });
      const base = T.materialColor.mul(T.mix(T.vec3(1), vcol, useVC));
      return T.select(state.greaterThan(1.5), pick, base);
    })();
    m.opacityNode = T.select(state.greaterThan(1.5), T.float(1), T.materialOpacity);
    const worldY = T.positionWorld.y;
    m.outputNode = T.Fn(() => {
      const out = T.vec4(T.output).toVar();
      // the inside of a cut solid: its far faces, seen from behind
      const inside = T.select(cap.greaterThan(1.5), T.frontFacing, T.frontFacing.not());
      T.If(capOn.greaterThan(0.5).and(cap.greaterThan(0.5)).and(capIdx.greaterThan(0.5)).and(inside).and(state.lessThan(1.5)), () => {
        const fill = pal.element(T.int(capIdx));
        const h = T.mod(T.screenCoordinate.x.add(T.screenCoordinate.y), 9.0);
        out.assign(T.vec4(T.select(h.lessThan(1.6), fill.mul(0.72), fill), 1.0));
      }).ElseIf(plan.z.greaterThan(0.5).or(plan.w.greaterThan(0.0)), () => {
        const c = T.mix(out.rgb, T.vec3(1), plan.w);
        const below = T.select(plan.z.greaterThan(0.5), T.clamp(plan.x.sub(0.25).sub(worldY).div(plan.y), 0.0, 0.8), T.float(0));
        out.assign(T.vec4(T.mix(c, T.vec3(1), below), out.a));
      });
      return out;
    })();
    return m;
  }
  function patchMaterial(m) {
    m.userData.lwk = true;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.stateTex = { get value() { return m.userData.stateTex; } };
      sh.uniforms.cols = { get value() { return m.userData.cols || 1; } };
      sh.uniforms.pickColor = shared.pick;
      sh.uniforms.capOn = PU.capOn;
      sh.uniforms.capPal = PU.capPal;
      sh.uniforms.planLook = PU.plan;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", `#include <common>
          attribute float col;
          attribute float iid;
          uniform highp sampler2D stateTex;
          uniform int cols;
          flat varying float vState;
          flat varying float vCap;
          flat varying float vCapIdx;
          varying float vWorldY;`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          {
            int si = int(iid + 0.5) * cols + int(col + 0.5);
            int sw = textureSize(stateTex, 0).x;
            vec4 st = texelFetch(stateTex, ivec2(si % sw, si / sw), 0);
            vState = floor(st.r * 255.0 + 0.5);
            vCap = floor(st.g * 255.0 + 0.5);
            vCapIdx = floor(st.b * 255.0 + 0.5);
            vec4 wp4 = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
            vWorldY = wp4.y;
          }`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>
          uniform vec3 pickColor;
          uniform bool capOn;
          uniform vec3 capPal[8];
          uniform vec4 planLook;
          flat varying float vState;
          flat varying float vCap;
          flat varying float vCapIdx;
          varying float vWorldY;`)
        .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
          if (vState > 0.5 && vState < 1.5) discard;`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          if (vState > 1.5) { diffuseColor.rgb = pickColor; diffuseColor.a = 1.0; }`)
        .replace("#include <tonemapping_fragment>", `
          {
            // the inside of a cut solid: its far faces, seen from behind
            bool seenFromInside = vCap > 1.5 ? gl_FrontFacing : !gl_FrontFacing;
            if (capOn && vCap > 0.5 && vCapIdx > 0.5 && seenFromInside && vState < 1.5) {
              // the cut: its fill colour, hatched with a darker line at 45 degrees
              vec3 fillC = capPal[int(vCapIdx)];
              float hatch = mod(gl_FragCoord.x + gl_FragCoord.y, 9.0);
              gl_FragColor = vec4(hatch < 1.6 ? fillC * 0.72 : fillC, 1.0);
            } else if (planLook.z > 0.5 || planLook.w > 0.0) {
              vec3 c = mix(gl_FragColor.rgb, vec3(1.0), planLook.w);
              float below = planLook.z > 0.5 ? clamp((planLook.x - 0.25 - vWorldY) / planLook.y, 0.0, 0.8) : 0.0;
              gl_FragColor.rgb = mix(c, vec3(1.0), below);
            }
          }
          #include <tonemapping_fragment>`);
    };
    m.customProgramCacheKey = () => "lwkm" + (m.vertexColors ? "c" : "") + (m.transparent ? "t" : "");
  }

  // each mesh's own box (its source frame), worked out once
  const meshBoxes = new Map();
  function meshBox(mi) {
    let b = meshBoxes.get(mi);
    if (b) return b;
    b = new THREE.Box3();
    const [vs, vc] = head.meshes[mi];
    for (let k = vs; k < vs + vc; k++) b.expandByPoint(v3.set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]));
    meshBoxes.set(mi, b);
    return b;
  }
  const v3 = new THREE.Vector3();
  function piecesBox(list) {
    const b = new THREE.Box3();
    for (const p of list) {
      const mb = meshBox(p.mesh).clone();
      if (p.m) mb.applyMatrix4(p.m);
      b.union(mb);
    }
    return b;
  }
  const diag = (b) => (b.isEmpty() ? 0 : b.getSize(v3).length());

  /* Group a list of pieces into batches by key, then build each. */
  async function buildGrouped(list, keyOf, instances, cols, owner, kind, smallOf, interiorOf) {
    const byKey = new Map();
    for (const p of list) {
      const m = head.meshes[p.mesh];
      if (!m || !m[1] || !m[3]) continue;
      let k = keyOf(p);
      if (opts.tiers) k += "|t" + tierOfEl(owner(p.col, 0));
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(p);
    }
    for (const [k, plist] of byKey) {
      await slice();
      const glass = isGlass(head.meshes[plist[0].mesh][4]);
      const small = smallOf ? smallOf(plist[0]) : false;
      const interior = interiorOf ? interiorOf(plist[0]) : false;
      // phones and tablets: small things (fittings, fixtures) are not built at all
      if (small && opts.skipSmall) continue;
      // and, while outside, nor is the inside of the buildings
      if (interior && opts.exteriorOnly) continue;
      let start = 0;
      while (start < plist.length) {
        let nv = 0, ni = 0, end = start;
        while (end < plist.length) {
          const m = head.meshes[plist[end].mesh];
          if (nv && nv + m[1] > (opts.maxBatchVerts || MAX_BATCH_VERTS)) break;
          nv += m[1]; ni += m[3]; end++;
        }
        makeBatch(plist.slice(start, end), nv, ni, instances, cols, owner, kind, glass, small, interior,
                  opts.tiers ? tierOfEl(owner(plist[0].col, 0)) : 0);
        start = end;
      }
    }
  }

  function makeBatch(plist, nv, ni, instances, cols, owner, kind, glass, small, interior, tier) {
    /* The elements drawn once: numbered within the batch (0, 1, 2 ...),
       not by their number in the whole model. Each batch's state texture
       has one texel per element it holds - numbered by the model it had
       one per element of the whole model, and a model of 60,000 elements
       in 300 blocks of space carried 70 MB of mostly empty textures. */
    let oi = ownerInfo;
    if (kind === "once") {
      const localEl = [];
      const localOf = new Map();
      for (const p of plist) {
        if (!localOf.has(p.col)) { localOf.set(p.col, localEl.length); localEl.push(p.col); }
      }
      plist = plist.map((p) => ({ col: localOf.get(p.col), mesh: p.mesh, m: p.m }));
      const els = Uint32Array.from(localEl);
      cols = els.length;
      owner = (col) => els[col];
      oi = { t: 0, els };
    }
    const P = new Float32Array(nv * 3), I = new Uint32Array(ni), C = new Float32Array(nv);
    const RGB = new Uint8Array(nv * (glass ? 4 : 3));
    const cw = glass ? 4 : 3;
    const ranges = new Map();          // col -> [[istart, icount]]
    const boxes = new Map();           // col -> Box3 (batch frame)
    const colColor = new Map();        // col -> [r, g, b, a, triangles] its main colour (the far copy)
    let vo = 0, io = 0;
    for (const p of plist) {
      const [vs, vc, is, ic, mi] = head.meshes[p.mesh];
      const [r, g, bl, o] = matInfo(mi);
      const cc = colColor.get(p.col);
      if (!cc || cc[4] < ic) colColor.set(p.col, [r, g, bl, Math.round(o * 255), ic]);
      const bx = boxes.get(p.col) || new THREE.Box3();
      if (p.m) {
        const e = p.m.elements;
        for (let k = 0; k < vc; k++) {
          const s = (vs + k) * 3;
          const x = pos[s], y = pos[s + 1], z = pos[s + 2];
          const d = (vo + k) * 3;
          P[d] = e[0] * x + e[4] * y + e[8] * z + e[12];
          P[d + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
          P[d + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          bx.expandByPoint(v3.set(P[d], P[d + 1], P[d + 2]));
        }
      } else {
        P.set(pos.subarray(vs * 3, (vs + vc) * 3), vo * 3);
        for (let k = 0; k < vc; k++) {
          const d = (vo + k) * 3;
          bx.expandByPoint(v3.set(P[d], P[d + 1], P[d + 2]));
        }
      }
      for (let k = 0; k < vc; k++) {
        const c = (vo + k) * cw;
        RGB[c] = r; RGB[c + 1] = g; RGB[c + 2] = bl;
        if (glass) RGB[c + 3] = Math.round(o * 255);
      }
      for (let k = 0; k < ic; k++) I[io + k] = idx[is + k] + vo;
      C.fill(p.col, vo, vo + vc);
      boxes.set(p.col, bx);
      let rr = ranges.get(p.col);
      if (!rr) ranges.set(p.col, rr = []);
      rr.push([io, ic]);
      vo += vc; io += ic;
    }
    /* Positions as 16-bit integers over the batch's own box (a block of
       space, a floor, a family type - sub-millimetre either way), and
       indices as 16-bit where a batch is small enough: a third of the
       memory of plain floats, on the GPU and in the browser alike. The
       scale back to metres rides on each instance's matrix. */
    const bbox = new THREE.Box3();
    for (const bx of boxes.values()) bbox.union(bx);
    const qo = bbox.getCenter(new THREE.Vector3());
    const qs = bbox.getSize(new THREE.Vector3()).multiplyScalar(0.5).max(new THREE.Vector3(1e-4, 1e-4, 1e-4));
    const Q = new Int16Array(nv * 3);
    for (let k = 0; k < nv; k++) {
      Q[k * 3] = Math.round((P[k * 3] - qo.x) / qs.x * 32767);
      Q[k * 3 + 1] = Math.round((P[k * 3 + 1] - qo.y) / qs.y * 32767);
      Q[k * 3 + 2] = Math.round((P[k * 3 + 2] - qo.z) / qs.z * 32767);
    }
    const Qm = new THREE.Matrix4().makeTranslation(qo.x, qo.y, qo.z)
      .multiply(new THREE.Matrix4().makeScale(qs.x, qs.y, qs.z));
    const I2 = nv < 65536 ? Uint16Array.from(I) : I;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(Q, 3, true));
    g.setAttribute("col", new THREE.BufferAttribute(C, 1));
    g.setAttribute("color", new THREE.BufferAttribute(RGB, cw, true));
    g.setIndex(new THREE.BufferAttribute(I2, 1));
    g.boundingBox = bbox;                // in metres, the batch's frame
    g.boundingSphere = bbox.getBoundingSphere(new THREE.Sphere());
    // colours and element numbers live on the GPU only: once uploaded, the
    // browser's copy is let go (positions and indices stay, for picking)
    const drop = function () { this.array = null; };
    g.attributes.color.onUpload(drop);
    g.attributes.col.onUpload(drop);

    const n = instances.length;
    const tex = stateTexture(cols * n);
    const material = lwkMaterial({
      color: 0xffffff, vertexColors: true, flatShading: true, side: THREE.DoubleSide,
      transparent: glass, depthWrite: !glass, opacity: 1,
    }, tex, cols);
    if (!NODES) materials.push(material);
    const im = new Float64Array(n * 16);
    const I4 = new THREE.Matrix4();
    instances.forEach((M, k) => (M || I4).toArray(im, k * 16));
    const bi = batches.length;
    const deq = [qs.x / 32767, qs.y / 32767, qs.z / 32767, qo.x, qo.y, qo.z];
    const bRec = { geom: g, Q, deq, I: I2, ranges, boxes, cols, n, tex, im, Qm, material, interior: !!interior,
                   owner, oi, kind, glass, small, bi,
                   colColor, lod: [g, undefined, undefined, undefined], tris: ni / 3, tier: tier || 0 };
    batches.push(bRec);
    root.add(newMesh(g, material, bRec, bi));
    for (const col of ranges.keys()) {
      for (let k = 0; k < (kind === "group" ? 1 : n); k++) note(owner(col, k), bi, col, k);
    }
  }

  /* An InstancedMesh for a batch. Its own "iid" attribute says which
     original instance each drawn one is, so culling can pack the visible
     ones to the front and the shader still finds each one's state. */
  function newMesh(g, material, b, bi) {
    const n = b.n;
    const geom = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(g.attributes)) geom.setAttribute(k, a);
    geom.setIndex(g.index);
    geom.boundingBox = g.boundingBox; geom.boundingSphere = g.boundingSphere;
    const iid = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    for (let k = 0; k < n; k++) iid.array[k] = k;
    geom.setAttribute("iid", iid);
    const mesh = new THREE.InstancedMesh(geom, material, n);
    for (let k = 0; k < n; k++) mesh.setMatrixAt(k, _im2.fromArray(b.im, k * 16).multiply(b.Qm));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.userData.bi = bi;
    if (atlas) { mesh.userData.lwkOff = b.tex.texture.userData.lwkOff; mesh.userData.lwkCols = b.cols; }
    return mesh;
  }

  function stateTexture(count) {
    // as wide as it needs (up to 4096): a batch of 3 elements is 3 texels,
    // not a 4096-texel row - thousands of batches made that 16 KB each
    const w = Math.min(STATE_W, Math.max(1, count)), h = Math.max(1, Math.ceil(Math.max(1, count) / w));
    const arr = new Uint8Array(w * h * 4);
    const t = new THREE.DataTexture(arr, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    // WebGPU: never sent to the card itself - its part of the model's atlas is
    if (atlas) t.userData.lwkOff = atlasAlloc(t, arr, Math.max(1, count));
    return { texture: t, data: arr };
  }

  const root = new THREE.Group();
  root.name = opts.name || head.doc || "lwkm";
  // who each batch's columns belong to, written down for the tile files
  let ownerInfo = null;
  const groupDescs = [];

  // 1. the elements drawn once: by block of space, small things apart
  const once = [];
  const elSmall = new Uint8Array(E), elCell = new Array(E);
  const smallOf = new Uint8Array(E);        // every element: small or not (for the phone file)
  const diagOf = new Float32Array(E);       // every element: its size (the phone file drops the smallest first)
  const NEAR = opts.near || null;           // phones inside: only what is round the camera
  const EXT0 = opts.exterior || null;
  /* Inside, on a phone: the building's outside stays whole (what you see
     through a window or when you step out), the inside and the small
     things only round the camera. */
  const farOut = (e, box, small) => NEAR && box.distanceToPoint(NEAR.point) > NEAR.radius
    && (small || !(EXT0 && EXT0[e]));
  for (let e = 0; e < (TILED ? 0 : E); e++) {
    if ((e & 1023) === 0) await slice();
    if (groupOf[e] >= 0 || !pieces[e].length) continue;
    const list = pieces[e].map(([mi, m]) => ({ col: e, mesh: mi, m }));
    const b = piecesBox(list);
    elSmall[e] = isSmall(e, diag(b)) ? 1 : 0;
    smallOf[e] = elSmall[e];
    diagOf[e] = diag(b);
    const c = b.getCenter(new THREE.Vector3());
    if (farOut(e, b, elSmall[e])) continue;
    elCell[e] = `${Math.floor(c.x / CELL[0])},${Math.floor(c.y / CELL[1])},${Math.floor(c.z / CELL[2])}`;
    for (const p of list) once.push(p);
  }
  /* Seen from outside or not (worked out once by the viewer, see
     exterior in model.js): the inside is drawn only when the camera is in
     a building. Without that information everything counts as outside. */
  const EXT = opts.exterior || null;
  const inner = (e) => !!(EXT && !EXT[e]);
  await buildGrouped(once, (p) => `${elCell[p.col]}|${elSmall[p.col]}|${isGlass(head.meshes[p.mesh][4]) ? 1 : 0}|${inner(p.col) ? "i" : "e"}`,
               [null], E, (col) => col, "once", (p) => !!elSmall[p.col], (p) => inner(p.col));

  // 2. family types placed many times
  for (const [d, list] of instancedDefs) {
    await slice();
    const flat = flatDef(d).map(([mi, m]) => ({ col: 0, mesh: mi, m }));
    const small = isSmall(list[0][0], diag(piecesBox(flat)));
    const fb = piecesBox(flat);
    for (const x of list) { smallOf[x[0]] = small ? 1 : 0; diagOf[x[0]] = diag(fb); }
    for (const side of [false, true]) {
      const part = list.filter((x) => inner(x[0]) === side
        && (!NEAR || !farOut(x[0], fb.clone().applyMatrix4(x[1]), small)));
      if (!part.length) continue;
      const els = part.map((x) => x[0]);
      ownerInfo = { t: 1, els: Uint32Array.from(els) };
      await buildGrouped(flat, (p) => (isGlass(head.meshes[p.mesh][4]) ? "g" : "o"),
                   part.map((x) => x[1]), 1, (col, k) => els[k], "family", () => small, () => side);
    }
  }

  // 3. typical floors: the first copy's elements, one instance per copy
  let nextId = E;
  for (const g of head.groups || []) {
    const members = g.elements;
    if (!members.length) continue;
    await slice();
    const colOf = new Map(members.map((e, j) => [e, j]));
    const list = [];
    const gSmall = new Map();
    for (const e of members) {
      const pl = pieces[e].map(([mi, m]) => ({ col: colOf.get(e), mesh: mi, m }));
      gSmall.set(colOf.get(e), isSmall(e, diag(piecesBox(pl))) ? 1 : 0);
      smallOf[e] = gSmall.get(colOf.get(e));
      diagOf[e] = diag(piecesBox(pl));
      for (const p of pl) list.push(p);
    }
    const copies = [null].concat(g.copies.map((row) =>
      ToffI.clone().multiply(m4(row)).multiply(Toff)));
    const base = nextId;
    nextId += members.length * (copies.length - 1);
    groupsRt.push({ base, m: members.length, n: copies.length - 1, members: Uint32Array.from(members) });
    ownerInfo = { t: 2, base, members: Uint32Array.from(members) };
    groupDescs.push({ members, n: copies.length - 1, base });
    await buildGrouped(list, (p) => `${gSmall.get(p.col)}|${isGlass(head.meshes[p.mesh][4]) ? 1 : 0}|${inner(members[p.col]) ? "i" : "e"}`,
                 copies, members.length,
                 (col, k) => k === 0 ? members[col] : base + (k - 1) * members.length + col, "group",
                 (p) => !!gSmall.get(p.col), (p) => inner(members[p.col]));
  }
  if (TILED) await buildFromTiles();
  meshBoxes.clear();

  // the source arrays are copied into the batches: free them
  pos = idx = mat = null;
  data.pos = data.idx = data.mat = null;
  flatCache.clear();

  // the model's whole extent, every instance, in the model's own frame
  const fullBox = new THREE.Box3();
  for (const b of batches) for (let k = 0; k < b.n; k++) fullBox.union(b.geom.boundingBox.clone().applyMatrix4(instM(b, k)));
  buildWhere();

  const elementOf = (lid) => lid < E ? lid : (copyInfo(lid) || [null])[0];

  /* ------------------------------------------------------------ tiles

     The model as tiles: every batch described in the index (its place,
     its elements' boxes, which way its elements' faces turn), its
     geometry - the full one and up to three coarser ones - fetched when
     the view asks for it, and dropped again when the memory budget of
     the device is reached (the tile stream decides which: the ones not
     seen for longest). */
  const roots = [root];
  const uid = ++MODEL_UID;
  let tileGpu = 0, tileCpu = 0, disposed = false;
  const TIERS = !!opts.tiers;
  function meshOf(R, bi) {
    let a = R.userData.byBi;
    if (!a) {
      a = R.userData.byBi = [];
      for (const c of R.children) if (c.userData.bi !== undefined && !c.userData.lod) a[c.userData.bi] = c;
    }
    return a[bi];
  }
  async function buildFromTiles() {
    const ix = TILED.index, J = ix.json;
    const u32 = (r) => new Uint32Array(ix.blob, r[0], r[1]);
    const f32 = (r) => new Float32Array(ix.blob, r[0], r[1]);
    const f64 = (r) => new Float64Array(ix.blob, r[0], r[1]);
    const u8 = (r) => new Uint8Array(ix.blob, r[0], r[1]);
    for (const g of J.groups || []) {
      const members = u32(g.members);
      groupsRt.push({ base: g.base, m: members.length, n: g.n, members });
    }
    for (let bi = 0; bi < J.batches.length; bi++) {
      if ((bi & 31) === 0) await slice();
      const d = J.batches[bi];
      const n = d.n, cols = d.cols;
      const im = f64(d.inst);
      const bxa = f32(d.boxes);
      const boxes = new Map();
      for (let c = 0; c < cols; c++) {
        const o = c * 6;
        if (!(bxa[o] <= bxa[o + 3])) continue;
        boxes.set(c, new THREE.Box3(new THREE.Vector3(bxa[o], bxa[o + 1], bxa[o + 2]),
                                    new THREE.Vector3(bxa[o + 3], bxa[o + 4], bxa[o + 5])));
      }
      const [sx, sy, sz, ox, oy, oz] = d.deq;
      const Qm = new THREE.Matrix4().makeTranslation(ox, oy, oz)
        .multiply(new THREE.Matrix4().makeScale(sx * 32767, sy * 32767, sz * 32767));
      const g = new THREE.BufferGeometry();
      g.boundingBox = new THREE.Box3(new THREE.Vector3(d.bbox[0], d.bbox[1], d.bbox[2]),
                                     new THREE.Vector3(d.bbox[3], d.bbox[4], d.bbox[5]));
      g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
      const tex = stateTexture(cols * n);
      const material = lwkMaterial({
        color: 0xffffff, vertexColors: true, flatShading: true, side: THREE.DoubleSide,
        transparent: !!d.glass, depthWrite: !d.glass, opacity: 1,
      }, tex, cols);
      if (!NODES) materials.push(material);
      const bRec = { im, Qm, n, tex, cols };
      let owner;
      const oi = d.owner;
      if (oi.t === 0) { const els = u32(oi.els); owner = (col) => els[col]; }
      else if (oi.t === 1) { const els = u32(oi.els); owner = (col, k) => els[k]; }
      else { const mem = u32(oi.members), base = oi.base; owner = (col, k) => k === 0 ? mem[col] : base + (k - 1) * mem.length + col; }
      const lodAvail = d.levels.map((L) => !!L);
      const lodTris = d.levels.map((L) => (L ? L.tris : 0));
      const mesh = newMesh(g, material, bRec, bi);
      mesh.visible = false;
      mesh.count = 0;
      root.add(mesh);
      batches.push({ geom: g, Q: null, I: null, deq: d.deq, ranges: null, boxes, cols, n, tex, im, Qm, material,
                     interior: !!d.interior, owner, oi, kind: d.kind,
                     glass: !!d.glass, small: !!d.small, colColor: null, lod: [g, undefined, undefined, undefined],
                     lodAvail, lodTris, levels: d.levels, tris: d.tris, tier: d.tier || 0, res0: false, bi,
                     capFlags: d.cap ? u8(d.cap) : null });
      for (let c = 0; c < cols; c++) {
        if (!boxes.has(c)) continue;
        // a typical floor: only its first copy (the others follow from it)
        for (let k = 0; k < (oi.t === 2 ? 1 : n); k++) note(owner(c, k), bi, c, k);
      }
    }
  }
  const tileKey = (b, l) => uid + ":" + b.bi + ":" + l;
  const isRes = (b, l) => (l === 0 ? b.res0 : !!b.lod[l]);
  function installLevel(b, l, dec) {
    if (disposed) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(dec.Q, dec.qs || 3, true));
    g.setAttribute("col", new THREE.BufferAttribute(dec.C, 1));
    g.setAttribute("color", new THREE.BufferAttribute(dec.RGB, dec.cw, true));
    g.setIndex(new THREE.BufferAttribute(dec.I, 1));
    g.boundingBox = b.geom.boundingBox;
    g.boundingSphere = b.geom.boundingSphere;
    const drop = function () { this.array = null; };
    // on the graphics card only; the full copy keeps positions and indices for picking
    for (const a of l === 0 ? ["col", "color"] : ["col", "color", "position"]) g.attributes[a].onUpload(drop);
    if (l > 0) g.index.onUpload(drop);
    const gpu = dec.Q.byteLength + dec.I.byteLength + dec.C.byteLength + dec.RGB.byteLength;
    const cpu = l === 0 ? dec.Q.byteLength + dec.I.byteLength + (dec.rangeBytes || 0) : 0;
    if (l === 0) {
      b.Q = dec.Q; b.qStride = dec.qs || 3; b.I = dec.I; b.ranges = dec.ranges; b.res0 = true;
      for (const R of roots) {
        const mesh = meshOf(R, b.bi);
        if (!mesh) continue;
        const w = mesh.geometry;
        for (const k of ["position", "col", "color"]) w.setAttribute(k, g.attributes[k]);
        w.setIndex(g.index);
        mesh.userData.fresh = true;
      }
      b.geom0 = g;
    } else {
      b.lod[l] = g;
    }
    tileGpu += gpu; tileCpu += cpu;
    TILED.stream.add(tileKey(b, l), gpu + cpu, () => evictLevel(b, l, gpu, cpu));
  }
  function evictLevel(b, l, gpu, cpu) {
    tileGpu -= gpu; tileCpu -= cpu;
    if (l === 0) {
      for (const R of roots) {
        const mesh = meshOf(R, b.bi);
        if (!mesh) continue;
        const w = mesh.geometry;
        w.dispose();                         // the graphics card lets go of the buffers
        for (const k of ["position", "col", "color"]) w.deleteAttribute(k);
        w.setIndex(null);
        mesh.visible = false; mesh.count = 0;
      }
      b.Q = b.I = b.ranges = null; b.res0 = false; b.geom0 = null;
    } else {
      for (const R of roots) {
        const mesh = meshOf(R, b.bi);
        const lm = mesh && mesh.userData.lodMesh;
        if (lm && lm[l]) { R.remove(lm[l]); lm[l].geometry.dispose(); lm[l] = null; }
      }
      if (b.lod[l]) b.lod[l].dispose();
      b.lod[l] = undefined;
    }
  }
  function requestLevel(b, l, prio) {
    const L = b.levels[l];
    if (!L) return;
    TILED.stream.want(tileKey(b, l), prio, L.raw, async () => {
      const raw = await TILED.fetch(L.o, L.n);
      if (disposed) return;
      installLevel(b, l, decodeTileLevel(raw));
    });
  }
  /* The copy to draw for this batch now: the one wanted if it is here,
     else the nearest coarser, else the nearest finer; the wanted one (and,
     while nothing is here yet, the plainest - small, and it shows the
     building at once) is asked for. -1: nothing to draw yet. */
  function tileLevel(b, want, prio) {
    while (want > 0 && !b.lodAvail[want]) want--;
    if (!isRes(b, want)) {
      requestLevel(b, want, prio);
      let any = false;
      for (let l = 0; l <= LOD_TOP; l++) if (isRes(b, l)) { any = true; break; }
      if (!any) {
        let top = LOD_TOP;
        while (top > want && !b.lodAvail[top]) top--;
        if (top > want) requestLevel(b, top, prio * 1.5 + 0.01);
      }
    }
    let pick = -1;
    if (isRes(b, want)) pick = want;
    else {
      for (let l = want + 1; l <= LOD_TOP && pick < 0; l++) if (isRes(b, l)) pick = l;
      for (let l = want - 1; l >= 0 && pick < 0; l--) if (isRes(b, l)) pick = l;
    }
    if (pick >= 0) TILED.stream.touch(tileKey(b, pick));
    return pick;
  }

  /* The tile files, written on the server (tools/tiles.mjs): the index -
     batches, element boxes, who owns what, the cut flags - and one pack
     of every batch's geometry, full and coarser, each piece compressed on
     its own so it can be fetched on its own. */
  function writeTiles(gzip, meta) {
    const blob = new BlobWriter();
    const pack = [];
    let packOff = 0;
    const add = (u8) => {
      const z = gzip(u8);
      pack.push(z);
      const o = packOff;
      packOff += z.length;
      return { o, n: z.length, raw: u8.length };
    };
    const jb = [];
    for (const b of batches) {
      for (let l = 1; l <= LOD_TOP; l++) {
        if (b.lod[l] === undefined) { try { b.lod[l] = buildLod(b, l); } catch (e) { b.lod[l] = null; } }
      }
      const cap = new Uint8Array(b.cols);
      if (!b.glass) for (const [col, rr] of b.ranges) cap[col] = closedFlag(b.Q, b.I, rr);
      const ga = b.geom.attributes;
      const levels = [add(encodeTileLevel(b.Q, b.I, ga.col.array, ga.color.array, ga.color.itemSize, b.ranges, b.cols))];
      levels[0].tris = b.tris;
      for (let l = 1; l <= LOD_TOP; l++) {
        const g = b.lod[l];
        if (!g) { levels.push(null); continue; }
        const L = add(encodeTileLevel(g.attributes.position.array, g.index.array, g.attributes.col.array,
                                      g.attributes.color.array, g.attributes.color.itemSize, null, b.cols));
        L.tris = b.lodTris[l];
        levels.push(L);
      }
      const bx = new Float32Array(b.cols * 6).fill(NaN);
      for (const [col, x] of b.boxes) bx.set([x.min.x, x.min.y, x.min.z, x.max.x, x.max.y, x.max.z], col * 6);
      const M = new Float64Array(b.n * 16);
      M.set(b.im);
      const gb = b.geom.boundingBox;
      const oi = b.oi || { t: 0, els: Uint32Array.from([...b.boxes.keys()]) };
      const owner = oi.t === 2 ? { t: 2, base: oi.base, members: blob.add(oi.members) } : { t: oi.t, els: blob.add(oi.els) };
      jb.push({ kind: b.kind, glass: b.glass ? 1 : 0, small: b.small ? 1 : 0, interior: b.interior ? 1 : 0,
                tier: b.tier || 0, cols: b.cols, n: b.n, tris: b.tris, deq: b.deq,
                bbox: [gb.min.x, gb.min.y, gb.min.z, gb.max.x, gb.max.y, gb.max.z],
                inst: blob.add(M), boxes: blob.add(bx), cap: blob.add(cap), owner, levels });
    }
    const hl = Object.assign({}, head);
    for (const k of ["meshes", "defs", "inst", "bin", "groups"]) delete hl[k];
    hl.el = Object.assign({}, head.el);
    delete hl.el.baked;
    const json = Object.assign({ v: 1, E, head: hl, fullBox: [fullBox.min.x, fullBox.min.y, fullBox.min.z, fullBox.max.x, fullBox.max.y, fullBox.max.z],
      groups: groupDescs.map((g) => ({ members: blob.add(Uint32Array.from(g.members)), n: g.n, base: g.base })),
      batches: jb, packBytes: packOff }, meta || {});
    return { index: writeTileIndex(json, blob.bytes()), pack, packBytes: packOff };
  }

  /* -------------------------------------------------------------- state */
  function setState(lid, value, mask) {
    eachWhere(lid, (bi, col, k) => {
      const b = batches[bi];
      const si = (k * b.cols + col) * 4;
      const cur = b.tex.data[si];
      b.tex.data[si] = mask === "hide" ? (value ? (cur === 2 ? 2 : 1) : (cur === 1 ? 0 : cur))
                                       : (value ? 2 : (cur === 2 ? 0 : cur));
      b.dirty = true;
    });
  }
  const hiddenState = new Set();
  const flush = () => {
    for (const b of batches) if (b.dirty) { b.tex.texture.needsUpdate = true; b.dirty = false; }
  };
  const allIds = () => { const a = []; forEachLid((l) => a.push(l)); return a; };
  function* lidsIter() {
    for (let e = 0; e < E; e++) if (hasWhere(e)) yield e;
    for (const g of groupsRt) {
      for (let k = 1; k <= g.n; k++) for (let j = 0; j < g.m; j++) if (hasWhere(g.members[j])) yield g.base + (k - 1) * g.m + j;
    }
  }

  /* ------------------------------------------------------------ picking */
  const _ray = new THREE.Ray(), _r2 = new THREE.Ray(), _box = new THREE.Box3(), _hInv = new THREE.Matrix4(),
        _pw = new THREE.Vector3();
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(),
        _hit = new THREE.Vector3();
  function rayFrom(q) {
    const rc = new THREE.Raycaster();
    let m = q.mouse;
    if (q.ray) return q.ray.clone();
    const dom = q.dom;
    if (m && (Math.abs(m.x) > 1.0001 || Math.abs(m.y) > 1.0001) && dom) {
      const r = dom.getBoundingClientRect();
      const lx = m.x - r.left, ly = m.y - r.top;
      m = new THREE.Vector2((lx / r.width) * 2 - 1, -(ly / r.height) * 2 + 1);
    }
    rc.setFromCamera(m || new THREE.Vector2(0, 0), q.camera);
    return rc.ray.clone();
  }

  function hits(R, q, all) {
    const world = rayFrom(q);
    R.updateMatrixWorld(true);
    const toLocal = R.matrixWorld.clone().invert();
    _ray.copy(world).applyMatrix4(toLocal);
    const cand = [];
    for (const mesh of R.children) {
      const bi = mesh.userData.bi;
      if (bi === undefined || mesh.userData.lod) continue;
      if (!q.everything && !mesh.visible && !mesh.userData.nvis) continue;
      const b = batches[bi];
      const vis = q.everything ? null : mesh.userData.vis;
      for (let k = 0; k < b.n; k++) {
        if (vis && !vis[k]) continue;          // culled: not on screen
        _r2.copy(_ray).applyMatrix4(instM(b, k, _hInv).invert());
        const gb = b.geom.boundingBox;
        if (gb && !_r2.intersectsBox(gb)) continue;
        for (const [col, bx] of b.boxes) {
          const st = b.tex.data[(k * b.cols + col) * 4];
          if (st === 1) continue;
          const t = _r2.intersectBox(bx, _hit);
          if (t === null) continue;
          cand.push([_r2.origin.distanceToSquared(_hit), bi, k, col]);
        }
      }
    }
    cand.sort((x, y) => x[0] - y[0]);
    const out = [];
    let best = Infinity;
    for (const [d2, bi, k, col] of cand) {
      if (!all && d2 > best * best) break;
      const b = batches[bi];
      _r2.copy(_ray).applyMatrix4(instM(b, k, _hInv).invert());
      let tMin = Infinity;
      const nrm = new THREE.Vector3();
      const P = b.Q, I = b.I, [sx, sy, sz, ox, oy, oz] = b.deq;
      if (!P || !b.ranges) {
        /* streamed and only a coarse copy (or none) here: the element's
           box stands in - a far element can still be picked */
        const bx = b.boxes.get(col);
        const t = bx ? _r2.intersectBox(bx, _hit) : null;
        if (t) {
          tMin = _r2.origin.distanceTo(_hit);
          nrm.copy(_r2.direction).negate();
        }
      }
      for (const [is, ic] of (P && b.ranges && b.ranges.get(col)) || []) {
        for (let t = is; t < is + ic; t += 3) {
          const qs = b.qStride || 3;
          const i0 = I[t] * qs, i1 = I[t + 1] * qs, i2 = I[t + 2] * qs;
          _a.set(P[i0] * sx + ox, P[i0 + 1] * sy + oy, P[i0 + 2] * sz + oz);
          _b.set(P[i1] * sx + ox, P[i1 + 1] * sy + oy, P[i1 + 2] * sz + oz);
          _c.set(P[i2] * sx + ox, P[i2 + 1] * sy + oy, P[i2 + 2] * sz + oz);
          const h = _r2.intersectTriangle(_a, _b, _c, false, _hit);
          if (h) {
            const d = _r2.origin.distanceTo(h);
            // a section: a triangle cut away does not count (what is seen
            // through the cut - the solid's far side - is the hit)
            if (d < tMin && q.planes && q.planes.length) {
              _pw.copy(h).applyMatrix4(instM(b, k)).applyMatrix4(R.matrixWorld);
              if (!q.planes.every((pl) => pl.distanceToPoint(_pw) >= -0.002)) continue;
            }
            if (d < tMin) {
              tMin = d;
              nrm.subVectors(_c, _b).cross(_a.sub(_b)).normalize();
            }
          }
        }
      }
      if (tMin === Infinity) continue;
      const pLocal = _r2.at(tMin, new THREE.Vector3()).applyMatrix4(instM(b, k));
      let pWorld = pLocal.applyMatrix4(R.matrixWorld);
      const lid = b.owner(col, k);
      // the face's normal, in the world, turned towards the viewer
      const Mw = new THREE.Matrix4().multiplyMatrices(R.matrixWorld, instM(b, k));
      const nm = new THREE.Matrix3().getNormalMatrix(Mw);
      let normal = nrm.applyMatrix3(nm).normalize();
      if (Mw.determinant() < 0) normal.negate();
      /* a closed solid cut open: the ray met the inside of its far side,
         but what is seen there is the hatched cut face, on the plane the
         ray came in through - that is the hit (and it is nearer than the
         floor the wall stands on, so the wall wins in a plan) */
      if (q.planes && q.planes.length && normal.dot(world.direction) > 0
          && b.tex.data[(k * b.cols + col) * 4 + 1]) {
        let tIn = -Infinity, np = null;
        for (const pl of q.planes) {
          const dn = pl.normal.dot(world.direction), d0 = pl.distanceToPoint(world.origin);
          if (d0 < 0 && dn > 1e-9) { const t = -d0 / dn; if (t > tIn) { tIn = t; np = pl; } }
        }
        if (np && tIn > 0 && tIn < world.origin.distanceTo(pWorld)) {
          pWorld = world.at(tIn, new THREE.Vector3());
          normal = np.normal.clone();
        }
      }
      if (normal.dot(world.direction) > 0) normal.negate();
      const dist = world.origin.distanceTo(pWorld);
      out.push({ localId: lid, point: pWorld, distance: dist, normal });
      if (dist < best) best = dist;
    }
    out.sort((x, y) => x.distance - y.distance);
    if (all) {
      const seen = new Set();
      return out.filter((h) => !seen.has(h.localId) && seen.add(h.localId));
    }
    return out[0] || null;
  }

  /* --------------------------------------------------------- properties */
  let props = null, propsLoading = null;
  async function loadProps() {
    if (props || !opts.propsUrl) return props;
    if (!propsLoading) {
      propsLoading = fetch(opts.propsUrl).then((r) => r.ok ? r.json() : null)
        .catch(() => null).then((p) => (props = p));
    }
    return propsLoading;
  }
  const catKey = (e) => {
    const n = head.cats[head.el.cat[e]] || "Other";
    return REVIT_TO_IFC[n] || n;
  };

  let catIndex = null;
  let _yAt = performance.now();
  // let the page breathe during long passes after loading
  const yieldIfLong = async () => {
    if (performance.now() - _yAt < 12) return;
    await new Promise((r) => setTimeout(r, 0));
    _yAt = performance.now();
  };
  function boxOf(R, lid, fresh) {
    const out = new THREE.Box3();
    // one matrix update per call of getBoxes, not per element: with 6000
    // slabs this alone was a quarter of a second of frozen page
    if (!fresh) R.updateMatrixWorld(true);
    eachWhere(lid, (bi, col, k) => {
      const b = batches[bi];
      const bx = b.boxes.get(col);
      if (!bx) return;
      _box.copy(bx).applyMatrix4(instM(b, k)).applyMatrix4(R.matrixWorld);
      out.union(_box);
    });
    return out;
  }

  /* ------------------------------------------------------ the cut fill
     Per element: is its surface closed, and which way do its faces turn
     (a closed solid's volume, counted from its triangles, is positive when
     they face out). Written into the state texture (green: 1 faces out,
     2 faces in - a mirrored copy turns them round; blue: the fill colour),
     so the shader knows a back face it may fill. */
  let capState = 0, capPromise = null;
  function closedFlag(Q, I, rr) {
    const vid = new Map();
    let nv = 0;
    const id = (v) => {
      const key = ((Q[v * 3] >> 1) + 16384) + 32768 * (((Q[v * 3 + 1] >> 1) + 16384) + 32768 * ((Q[v * 3 + 2] >> 1) + 16384));
      let r = vid.get(key);
      if (r === undefined) { r = nv++; vid.set(key, r); }
      return r;
    };
    const edges = new Map(), turn = new Map();
    // how often each edge is used, and which way round: in a solid whose
    // faces all turn the same way every edge is walked once each way
    const edge = (a, b) => {
      const k = a < b ? a * 4194304 + b : b * 4194304 + a;
      edges.set(k, (edges.get(k) || 0) + 1);
      turn.set(k, (turn.get(k) || 0) + (a < b ? 1 : -1));
    };
    let vol = 0, tris = 0;
    for (const [is, ic] of rr) {
      for (let t = is; t < is + ic; t += 3) {
        const i0 = I[t], i1 = I[t + 1], i2 = I[t + 2];
        const a = id(i0), b = id(i1), c = id(i2);
        if (a === b || b === c || a === c) continue;
        tris++;
        edge(a, b); edge(b, c); edge(c, a);
        const ax = Q[i0 * 3], ay = Q[i0 * 3 + 1], az = Q[i0 * 3 + 2];
        const bx = Q[i1 * 3], by = Q[i1 * 3 + 1], bz = Q[i1 * 3 + 2];
        const cx = Q[i2 * 3], cy = Q[i2 * 3 + 1], cz = Q[i2 * 3 + 2];
        vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
      }
    }
    if (tris < 4 || !edges.size) return 0;
    let odd = 0, skew = 0;
    for (const n of edges.values()) if (n & 1) odd++;
    for (const t of turn.values()) if (t !== 0) skew++;
    if (odd > edges.size * 0.03) return 0;       // open: not a solid
    if (skew > edges.size * 0.03) return 0;      // faces turned every which way
    return vol > 0 ? 1 : vol < 0 ? 2 : 0;
  }
  function capBatch(b) {
    const flags = new Map();
    if (b.capFlags) {
      for (let c = 0; c < b.cols; c++) flags.set(c, b.capFlags[c]);
    } else if (!b.glass && b.Q && b.I && b.ranges) {
      for (const [col, rr] of b.ranges) flags.set(col, closedFlag(b.Q, b.I, rr));
    }
    const d = b.tex.data;
    for (let k = 0; k < b.n; k++) {
      const neg = instM(b, k).determinant() < 0;
      for (const col of b.boxes.keys()) {
        const e = elementOf(b.owner(col, k));
        const cls = b.glass || e === null || e === undefined ? 0 : capClassOfCat(head.cats[head.el.cat[e]]);
        const f = flags.get(col) || 0;
        const si = (k * b.cols + col) * 4;
        d[si + 1] = f === 0 ? 0 : ((f === 1) !== neg ? 1 : 2);
        d[si + 2] = cls;
      }
    }
    b.tex.texture.needsUpdate = true;
    b.capDone = true;
  }
  /* The first section: every batch checked, a slice at a time. */
  function prepareCaps() {
    if (capPromise) return capPromise;
    capState = 1;
    capPromise = (async () => {
      for (const b of batches) {
        if (b.capDone) continue;
        await yieldIfLong();
        try { capBatch(b); } catch (e) { b.capDone = true; }
      }
      capState = 2;
    })();
    return capPromise;
  }

  /* ------------------------------------------------ far copies (LOD)

     Like a game: what is far away is drawn from a coarser copy. Each
     batch gets up to two, made the first time they are needed by vertex
     clustering - every corner is snapped to a grid (1/64 or 1/24 of the
     batch's size), triangles that collapse go, the same triangle twice
     goes, and each element keeps one colour. A mullion or a door handle
     disappears, a facade stays a facade. The copy uses the same element
     numbers, so hiding, selecting and section boxes behave the same. */
  const LOD_DIV = [0, 64, 24, 6];      // level 3: every element (but the biggest) its box
  const LOD_TOP = LOD_DIV.length - 1;
  // a box's six faces, corners numbered x + 2y + 4z
  const BOX_FACES = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const LOD_ON = opts.lod !== false;
  const lodQueue = [];
  let lodBuilt = 0;
  function buildLod(b, level) {
    const gb = b.geom.boundingBox;
    const size = diag(gb);
    const gBatch = Math.max(size / LOD_DIV[level], 0.01);
    const [sx, sy, sz, ox, oy, oz] = b.deq;
    const Q = b.Q, I = b.I, nv = Q.length / 3;
    const cl = new Int32Array(nv).fill(-1);
    const acc = [];
    const P = [], C = [], RGB = [];
    const OI = [];
    const cw = b.glass ? 4 : 3;
    /* Every element stays, only plainer; corners of different elements
       never merge.
       - big ones (six steps across or more) are snapped to the step: a
         wall stays a wall, a mullion on it may go;
       - smaller ones with any detail become their box - at this distance
         a door or a window is a few pixels, and a box of its colour is
         what the eye sees;
       - an element that folds away entirely all the same (a thin rail)
         becomes its box too, unless it is thinner than the step. */
    const boxOut = (col, eb, cc) => {
      const base = P.length / 3;
      for (let k = 0; k < 8; k++) {
        P.push(k & 1 ? eb.max.x : eb.min.x, k & 2 ? eb.max.y : eb.min.y, k & 4 ? eb.max.z : eb.min.z);
        C.push(col);
        RGB.push(cc[0], cc[1], cc[2]);
        if (cw === 4) RGB.push(cc[3]);
      }
      for (const f of BOX_FACES) OI.push(base + f[0], base + f[1], base + f[2], base + f[0], base + f[2], base + f[3]);
    };
    for (const [col, rr] of b.ranges) {
      const eb = b.boxes.get(col);
      const ed = eb ? diag(eb) : size;
      const cc = b.colColor.get(col) || [180, 180, 180, 255];
      let etris = 0;
      for (const [, ic] of rr) etris += ic / 3;
      if (eb && ed < 6 * gBatch) {
        if (etris > 12) { boxOut(col, eb, cc); continue; }
      }
      const gs = Math.max(0.005, ed < 6 * gBatch ? ed / 6 : gBatch);
      const outBefore = OI.length;
      const mnx = eb ? eb.min.x : gb.min.x, mny = eb ? eb.min.y : gb.min.y, mnz = eb ? eb.min.z : gb.min.z;
      const map = new Map();
      const first = acc.length / 4;
      const clusterOf = (v) => {
        if (cl[v] >= 0) return cl[v];
        const x = Q[v * 3] * sx + ox, y = Q[v * 3 + 1] * sy + oy, z = Q[v * 3 + 2] * sz + oz;
        const key = Math.floor((x - mnx) / gs) + 8192 * (Math.floor((y - mny) / gs) + 8192 * Math.floor((z - mnz) / gs));
        let id = map.get(key);
        if (id === undefined) { id = acc.length / 4; map.set(key, id); acc.push(0, 0, 0, 0); }
        acc[id * 4] += x; acc[id * 4 + 1] += y; acc[id * 4 + 2] += z; acc[id * 4 + 3]++;
        return (cl[v] = id);
      };
      const tri = [];
      for (const [is, ic] of rr) {
        for (let t = is; t < is + ic; t += 3) {
          tri.push(clusterOf(I[t]), clusterOf(I[t + 1]), clusterOf(I[t + 2]));
        }
      }
      // the new corners of this element (clusters are this element's own)
      const base = P.length / 3;
      const nLoc = acc.length / 4 - first;
      for (let q = 0; q < nLoc; q++) {
        const id = first + q, c = acc[id * 4 + 3];
        P.push(acc[id * 4] / c, acc[id * 4 + 1] / c, acc[id * 4 + 2] / c);
        C.push(col);
        RGB.push(cc[0], cc[1], cc[2]);
        if (cw === 4) RGB.push(cc[3]);
      }
      const seen = new Set();
      for (let t = 0; t < tri.length; t += 3) {
        const a = tri[t] - first, bb = tri[t + 1] - first, c = tri[t + 2] - first;
        if (a === bb || bb === c || a === c) continue;
        // the same triangle (either way round) only once
        let lo = a, mid = bb, hi = c, tmp;
        if (lo > mid) { tmp = lo; lo = mid; mid = tmp; }
        if (mid > hi) { tmp = mid; mid = hi; hi = tmp; }
        if (lo > mid) { tmp = lo; lo = mid; mid = tmp; }
        const k2 = (lo * nLoc + mid) * nLoc + hi;
        if (seen.has(k2)) continue;
        seen.add(k2);
        OI.push(base + a, base + bb, base + c);
      }
      if (OI.length === outBefore && eb) {
        const sz = eb.getSize(v3);
        if (Math.min(sz.x, sz.y, sz.z) >= gBatch * 0.25) boxOut(col, eb, cc);
      }
    }
    const tris = OI.length / 3;
    // not worth it: the batch itself (or the finer copy) is drawn instead
    let finer = b.tris;
    for (let l = level - 1; l >= 1; l--) if (b.lod[l]) { finer = b.lodTris[l]; break; }
    if (!tris || tris > finer * 0.7) return null;
    const qs = [sx * 32767, sy * 32767, sz * 32767];
    const n2 = P.length / 3;
    const Qo = new Int16Array(n2 * 3);
    for (let k = 0; k < n2; k++) {
      Qo[k * 3] = Math.max(-32767, Math.min(32767, Math.round((P[k * 3] - ox) / qs[0] * 32767)));
      Qo[k * 3 + 1] = Math.max(-32767, Math.min(32767, Math.round((P[k * 3 + 1] - oy) / qs[1] * 32767)));
      Qo[k * 3 + 2] = Math.max(-32767, Math.min(32767, Math.round((P[k * 3 + 2] - oz) / qs[2] * 32767)));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(Qo, 3, true));
    g.setAttribute("col", new THREE.BufferAttribute(new Float32Array(C), 1));
    g.setAttribute("color", new THREE.BufferAttribute(new Uint8Array(RGB), cw, true));
    g.setIndex(new THREE.BufferAttribute(n2 < 65536 ? new Uint16Array(OI) : new Uint32Array(OI), 1));
    g.boundingBox = gb;
    g.boundingSphere = b.geom.boundingSphere;
    const drop = function () { this.array = null; };
    for (const a of ["col", "color"]) g.attributes[a].onUpload(drop);
    (b.lodTris || (b.lodTris = []))[level] = tris;
    return g;
  }
  /* Is this level's copy there (making the mesh for this placement)? If
     it has not been made yet it is queued, and the finer one drawn. */
  function lodMesh(R, mesh, b, level) {
    const g = b.lod[level];
    if (g === undefined) {
      // streamed: coarser copies come from the server, never made here
      if (!TILED && !b.queued) { b.queued = true; lodQueue.push(b); }
      return null;
    }
    if (g === null) return null;
    const lm = mesh.userData.lodMesh || (mesh.userData.lodMesh = []);
    if (!lm[level]) {
      const m = newMesh(g, b.material, b, mesh.userData.bi);
      m.userData.lod = level;
      m.userData.all = mesh.userData.all;
      m.count = 0;
      m.visible = false;
      R.add(m);
      lm[level] = m;
    }
    return lm[level];
  }
  function runLodQueue(budgetMs) {
    const t0 = performance.now();
    let did = 0;
    while (lodQueue.length && (did === 0 || performance.now() - t0 < budgetMs)) {
      const b = lodQueue.shift();
      for (let lv = 1; lv <= LOD_TOP; lv++) {
        if (b.lod[lv] === undefined) {
          try { b.lod[lv] = buildLod(b, lv); } catch (e) { b.lod[lv] = null; }
        }
      }
      b.queued = false;
      did++;
      lodBuilt++;
    }
    return did;
  }

  /* --------------------------------------------------------- culling
     Before a frame: which instances of each batch are worth drawing -
     inside the view, not wholly cut away by the section planes, not a
     speck at this distance, and (small things) near enough. Visible ones
     are packed to the front; the rest are simply not drawn. */
  const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _cam = new THREE.Vector3(),
        _wb = new THREE.Box3(), _mt = new THREE.Matrix4();
  const SMALL_NEAR = 45, SMALL_NEAR_MOVING = 30;
  /* A coarser copy once one grid step is under about 3 pixels (twice
     that while the view moves: a moving view is blurred anyway). */
  const PX_PER_RAD = 1086;             // 45 degree lens, 900 px high
  const uploaded = new WeakSet();      // position attributes already on the GPU
  let gpuGeomBytes = 0;                // what those take there (estimate)
  function geomBytes(g) {
    let n = 0;
    for (const [k, a] of Object.entries(g.attributes)) {
      if (k === "iid") continue;         // per placement, counted with the instances
      n += a.count * a.itemSize * (a.array ? a.array.BYTES_PER_ELEMENT : (k === "col" ? 4 : 1));
    }
    if (g.index) n += g.index.count * (g.index.array ? g.index.array.BYTES_PER_ELEMENT : 4);
    return n;
  }
  /* Memory the model takes (bytes, estimates): on the graphics card -
     geometry sent there, instance matrices, state textures - and in the
     page (positions and indices kept for picking, coarser copies). */
  function memStats() {
    let inst = 0, tex = 0, cpu = (wOff ? wOff.byteLength + wData.byteLength : 0);
    for (const b of batches) {
      cpu += (b.im && !TILED ? b.im.byteLength : 0) + b.n * 180;   // matrices, boxes seen from the camera
      tex += b.tex.data.byteLength;
      inst += b.n * 16 * 4 * 2;          // matrix + packed copy
      cpu += (b.Q ? b.Q.byteLength : 0) + (b.I ? b.I.byteLength : 0) + b.tex.data.byteLength;
      cpu += (b.boxes ? b.boxes.size : 0) * 80;
      for (let l = 1; l < b.lod.length; l++) {
        const g = b.lod[l];
        if (!g) continue;
        if (g.attributes.position.array) cpu += g.attributes.position.array.byteLength;
        if (g.index && g.index.array) cpu += g.index.array.byteLength;
      }
    }
    if (TILED) return { gpu: tileGpu + inst + tex, gpuGeom: tileGpu, cpu: cpu + tileCpu + tex + inst };
    return { gpu: gpuGeomBytes + inst + tex, gpuGeom: gpuGeomBytes, cpu };
  }
  function cull(R, camera, planes, moving, o = {}) {
    R.updateMatrixWorld(true);
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _fr.setFromProjectionMatrix(_pm);
    camera.getWorldPosition(_cam);
    // an instance under ~3 px (5 while moving) is not drawn
    // o.q: the frame rate's quality step (quality.js), 1 = as normal
    const q = o.q || 1;
    const tiny = (moving ? 0.005 : 0.0025) * q;
    // streamed: over the memory budget, coarser copies are asked for
    const errPx = (o.lodPx || 3) * (moving ? 2 : 1) * (TILED ? TILED.stream.pressure : 1) * q;
    const E_ = errPx / PX_PER_RAD;
    const lodOn = LOD_ON && !o.everything && o.lod !== false;
    let drawn = 0;
    for (const mesh of R.children) {
      const bi = mesh.userData.bi;
      if (bi === undefined || mesh.userData.lod) continue;
      const b = batches[bi];
      let wbs = mesh.userData.wb;
      if (!wbs) {
        wbs = mesh.userData.wb = [];
        for (let k = 0; k < b.n; k++) {
          wbs.push(b.geom.boundingBox.clone().applyMatrix4(_mt.multiplyMatrices(R.matrixWorld, instM(b, k))));
        }
        mesh.userData.vis = new Uint8Array(b.n);
        mesh.userData.all = mesh.instanceMatrix.array.slice();
      }
      const vis = mesh.userData.vis, all = mesh.userData.all;
      const lm = mesh.userData.lodMesh || [];
      if (o.outside && b.interior) {
        // the camera is outside every building: the inside is not drawn
        for (const m of [mesh, ...lm]) if (m) { m.visible = false; m.count = 0; }
        vis.fill(0);
        mesh.userData.nvis = 0;
        continue;
      }
      // where each level's visible instances are packed
      const tg = [mesh];
      for (let l = 1; l <= LOD_TOP; l++) tg.push(lm[l] || null);
      const cnt = tg.map(() => 0), chg = tg.map(() => false);
      let nvis = 0;
      for (let k = 0; k < b.n; k++) {
        const wb = wbs[k];
        let ok = _fr.intersectsBox(wb);
        if (ok && planes && planes.length) {
          for (const pl of planes) {
            // the box's corner furthest along the plane normal
            const x = pl.normal.x > 0 ? wb.max.x : wb.min.x;
            const y = pl.normal.y > 0 ? wb.max.y : wb.min.y;
            const z = pl.normal.z > 0 ? wb.max.z : wb.min.z;
            if (pl.normal.x * x + pl.normal.y * y + pl.normal.z * z + pl.constant < 0) { ok = false; break; }
          }
        }
        // inside: rooms on floors other than this one and the ones either
        // side are behind slabs - not drawn (the outside shell still is)
        if (ok && o.band && b.interior && (wb.max.y < o.band.lo || wb.min.y > o.band.hi)) ok = false;
        let lv = 0, prio = 10;
        if (ok && !o.everything) {
          const d = wb.distanceToPoint(_cam);
          if (d > 0) {
            const size = wb.min.distanceTo(wb.max);
            // how much it matters: its size on screen (the building's own
            // parts first, the inside and the small things after)
            prio = size / d * (b.tier ? 1 : 2) * (b.interior ? 0.7 : 1);
            if (size / d < tiny) ok = false;
            else if (b.small && d > (moving ? SMALL_NEAR_MOVING : SMALL_NEAR) / q) ok = false;
            else {
              const bt = TILED && !TIERS ? 0 : b.tier;
              const far = bt && d > TIER_NEAR[bt] * (moving ? 0.7 : 1) * (o.tierScale || 1) / q;
              // furniture and fittings: only round the camera
              if (far && bt === 2) ok = false;
              else if (lodOn) {
                // grid step of each copy, against what 3 pixels are at this distance
                const lim = d * E_;
                for (let l = LOD_TOP; l >= 1; l--) if (size / LOD_DIV[l] <= lim) { lv = l; break; }
                // windows and doors far off: still there (no holes in the
                // facade), as their plainest copy
                if (far) lv = LOD_TOP;
              }
            }
          }
        }
        vis[k] = ok ? 1 : 0;
        if (!ok) continue;
        nvis++;
        if (TILED) {
          // the copy that is here (the one wanted is asked for)
          lv = tileLevel(b, lodOn ? lv : 0, prio);
          if (lv < 0) continue;
          if (lv > 0 && !tg[lv]) tg[lv] = lodMesh(R, mesh, b, lv);
          if (!tg[lv]) continue;
        } else {
          while (lv > 0) {
            if (!tg[lv]) tg[lv] = lodMesh(R, mesh, b, lv);
            if (tg[lv]) break;
            lv--;
          }
        }
        const m = tg[lv];
        const n = cnt[lv]++;
        const arr = m.instanceMatrix.array, iid = m.geometry.attributes.iid.array;
        if (iid[n] !== k || m.userData.fresh) {
          for (let j = 0; j < 16; j++) arr[n * 16 + j] = all[k * 16 + j];
          iid[n] = k;
          chg[lv] = true;
        }
      }
      for (let lv = 0; lv < tg.length; lv++) {
        const m = tg[lv];
        if (!m) continue;
        const n = cnt[lv];
        if (m.count !== n || chg[lv] || m.userData.fresh) {
          m.count = n;
          m.instanceMatrix.needsUpdate = true;
          m.geometry.attributes.iid.needsUpdate = true;
          m.userData.fresh = false;
        }
        let show = n > 0;
        /* Sending geometry to the graphics card happens on the first frame
           a batch is drawn, all in one go - for a big model, several
           hundred milliseconds with the page frozen. Each frame gets a
           budget; batches over it wait for the next frame. */
        if (show && o.upload) {
          const pa = m.geometry.attributes.position;
          if (!uploaded.has(pa)) {
            if (o.upload.left <= 0) { show = false; o.upload.pending = true; }
            else { o.upload.left -= pa.count; uploaded.add(pa); gpuGeomBytes += geomBytes(m.geometry); }
          }
        }
        m.visible = show;
        if (show) drawn += n * (lv ? b.lodTris[lv] : b.tris);
      }
      mesh.userData.nvis = nvis;
    }
    return drawn;
  }

  /* -------------------------------------------------- the ID pass
     Each batch gets a material that writes, per pixel, which element it
     is (element index + 1 in RGB, the model's number in alpha), read back
     by model.js from 26 directions round the project. */
  const ID_VS = `
    attribute float col;
    attribute float iid;
    uniform highp sampler2D eidTex;
    uniform int cols;
    flat varying vec3 vId;
    void main() {
      int si = int(iid + 0.5) * cols + int(col + 0.5);
      int sw = textureSize(eidTex, 0).x;
      vId = texelFetch(eidTex, ivec2(si % sw, si / sw), 0).rgb;
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }`;
  const ID_FS = `
    uniform float mdl;
    flat varying vec3 vId;
    layout(location = 0) out highp vec4 idOut;
    void main() { idOut = vec4(vId, mdl); }`;
  function eidTexture(b) {
    if (b.eidTex) return b.eidTex;
    const count = b.cols * b.n, w = Math.min(STATE_W, Math.max(1, count)), h = Math.max(1, Math.ceil(Math.max(1, count) / w));
    const arr = new Uint8Array(w * h * 4);
    for (let k = 0; k < b.n; k++) {
      for (const col of b.ranges.keys()) {
        const e = elementOf(b.owner(col, k));
        if (e === null || e === undefined) continue;
        const v = e + 1, si = (k * b.cols + col) * 4;
        arr[si] = v & 255; arr[si + 1] = (v >> 8) & 255; arr[si + 2] = (v >> 16) & 255; arr[si + 3] = 255;
      }
    }
    const t = new THREE.DataTexture(arr, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    t.needsUpdate = true;
    b.eidTex = t;
    return t;
  }
  function idBegin(R, modelIdx) {
    for (const mesh of R.children) {
      const b = batches[mesh.userData.bi];
      if (!b) continue;
      if (mesh.userData.lod) { mesh.visible = false; mesh.count = 0; continue; }
      mesh.userData.normalMat = mesh.material;
      const m = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: ID_VS, fragmentShader: ID_FS,
        uniforms: { eidTex: { value: eidTexture(b) }, cols: { value: b.cols }, mdl: { value: (modelIdx + 1) / 255 } },
        side: THREE.DoubleSide,
      });
      mesh.material = m;
      mesh.userData.glass = b.glass;
      // everything, whatever the camera did last
      const all = mesh.userData.all || mesh.instanceMatrix.array.slice();
      mesh.userData.all = all;
      mesh.instanceMatrix.array.set(all);
      const iid = mesh.geometry.attributes.iid.array;
      for (let k = 0; k < b.n; k++) iid[k] = k;
      mesh.count = b.n;
      mesh.visible = true;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.attributes.iid.needsUpdate = true;
      mesh.userData.fresh = true;          // the next cull repacks every instance
      for (const lm of mesh.userData.lodMesh || []) if (lm) lm.userData.fresh = true;
      if (mesh.userData.vis) mesh.userData.vis.fill(1);
    }
  }
  /* pass "opaque": glass left out, so what is behind a curtain wall is seen;
     pass "glass": the opaque ones only fill the depth, the glass is drawn. */
  function idSetPass(R, pass) {
    for (const mesh of R.children) {
      if (!mesh.userData.normalMat) continue;
      const glass = mesh.userData.glass;
      mesh.visible = pass === "opaque" ? !glass : true;
      mesh.material.colorWrite = pass === "opaque" ? true : glass;
    }
  }
  function idEnd(R) {
    for (const mesh of R.children) {
      if (!mesh.userData.normalMat) continue;
      mesh.material.dispose();
      mesh.material = mesh.userData.normalMat;
      delete mesh.userData.normalMat;
      mesh.visible = true;
    }
    for (const b of batches) if (b.eidTex) { b.eidTex.dispose(); b.eidTex = null; }
  }

  let coord = null;

  /* One API per placement of the model: a link placed on several floors
     is one set of geometry drawn under several parents. */
  const makeApi = (R) => {
  let myCoord = null;
  const model = {
    format: "lwkm",
    object: R,
    smallOf,
    diagOf,
    box: fullBox,
    materials,
    head,
    elementCount: E,
    stats: () => ({ batches: batches.length,
                    triangles: batches.reduce((s, b) => s + b.tris * b.n, 0),
                    drawn: batches.reduce((s, b) => s + b.tris, 0),
                    interior: batches.reduce((s, b) => s + (b.interior ? b.tris * b.n : 0), 0) }),
    tiled: !!TILED,
    writeTiles: (gzip, meta) => writeTiles(gzip, meta),
    streamStats: TILED ? () => {
      let res0 = 0, resL = 0;
      for (const b of batches) { if (b.res0) res0++; for (let l = 1; l <= LOD_TOP; l++) if (b.lod[l]) resL++; }
      return { batches: batches.length, full: res0, coarse: resL, gpuMB: Math.round(tileGpu / 104857.6) / 10 };
    } : undefined,
    setCoordinationMatrix(m) { myCoord = m ? m.clone() : null; },
    async getCoordinationMatrix() { return myCoord ? myCoord.clone() : new THREE.Matrix4(); },
    useCamera() {},
    /* Called before drawing a frame; returns the triangles it will draw. */
    cull(camera, planes, moving, o) { return cull(R, camera, planes, moving, o); },
    /* Far copies waiting to be made: a few per frame (ms budget). True
       when some were made, so the frame is culled and drawn again. */
    lodWork(budgetMs) { return lodQueue.length ? runLodQueue(budgetMs) > 0 : false; },
    lodPending: () => lodQueue.length > 0,
    memStats: () => memStats(),
    prepareCaps: () => prepareCaps(),
    capsReady: () => capState === 2,
    lodStats: () => ({ built: lodBuilt, queued: lodQueue.length,
                       far1: batches.filter((b) => b.lod[1]).length, far2: batches.filter((b) => b.lod[2]).length,
                       far3: batches.filter((b) => b.lod[3]).length }),
    // the model knows what is seen from outside (so an inside exists, built or not)
    hasInterior: () => !!opts.exterior || !!(TILED && TILED.index.json.hasExterior),
    /* The pass that finds what is seen from outside: every batch drawn with
       a flat colour per element (model index in alpha). */
    idBegin(modelIdx) { idBegin(R, modelIdx); },
    idEnd() { idEnd(R); },
    idSetPass(pass) { idSetPass(R, pass); },
    elementCountForId: E,
    async raycast(q) { return hits(R, q, false); },
    raycastSync(q) { return hits(R, q, false); },
    async raycastAll(q) { return hits(R, q, true); },
    async getGuidsByLocalIds(ids) {
      return ids.map((lid) => lid < E ? (head.el.guid[lid] || null) : null);
    },
    async getLocalIdsByGuids(guids) {
      const m = new Map();
      head.el.guid.forEach((g, i) => { if (g) m.set(g, i); });
      return guids.map((g) => (m.has(g) ? m.get(g) : null));
    },
    async getBoxes(ids) {
      R.updateMatrixWorld(true);
      const out = new Array(ids.length);
      for (let i = 0; i < ids.length; i++) {
        out[i] = boxOf(R, ids[i], true);
        if ((i & 511) === 511) await yieldIfLong();
      }
      return out;
    },
    /* The triangles of elements, for snapping measurements to corners and
       edges: per element a list of { positions (metres, the batch's frame),
       indices, transform (to the scene) }. Only what is here in full
       (streamed models: the pieces near the view - the ones measured). */
    async getItemsGeometry(ids) {
      R.updateMatrixWorld(true);
      return ids.map((lid) => {
        const out = [];
        eachWhere(lid, (bi, col, k) => {
          const b = batches[bi];
          if (!b.Q || !b.I || !b.ranges) return;
          const rr = b.ranges.get(col);
          if (!rr) return;
          const qs = b.qStride || 3, [sx, sy, sz, ox, oy, oz] = b.deq;
          const map = new Map(), P = [], Ix = [];
          for (const [is, ic] of rr) {
            for (let t = is; t < is + ic; t++) {
              const v = b.I[t];
              let j = map.get(v);
              if (j === undefined) {
                j = P.length / 3; map.set(v, j);
                P.push(b.Q[v * qs] * sx + ox, b.Q[v * qs + 1] * sy + oy, b.Q[v * qs + 2] * sz + oz);
              }
              Ix.push(j);
            }
          }
          out.push({ positions: new Float32Array(P), indices: new Uint32Array(Ix),
                     transform: new THREE.Matrix4().multiplyMatrices(R.matrixWorld, instM(b, k)) });
        });
        return out;
      });
    },
    /* Where a cutting plane (world) passes through closed solids: line
       segments (world, 6 numbers each), for drawing the cut's outline.
       Only what is here in full; a slice at a time. */
    async cutSegments(plane) {
      R.updateMatrixWorld(true);
      const out = [];
      const W = new THREE.Matrix4(), Wi = new THREE.Matrix4(), lp = new THREE.Plane();
      const bx = new THREE.Box3(), a = new THREE.Vector3(), b2 = new THREE.Vector3();
      let n = 0;
      for (const b of batches) {
        if (!b.Q || !b.I || !b.ranges || b.glass) continue;
        const qs = b.qStride || 3, [sx, sy, sz, ox, oy, oz] = b.deq, Q = b.Q, I = b.I;
        for (let k = 0; k < b.n; k++) {
          W.multiplyMatrices(R.matrixWorld, instM(b, k));
          bx.copy(b.geom.boundingBox).applyMatrix4(W);
          if (!plane.intersectsBox(bx)) continue;
          Wi.copy(W).invert();
          lp.copy(plane).applyMatrix4(Wi);
          const nx = lp.normal.x, ny = lp.normal.y, nz = lp.normal.z, c = lp.constant;
          const dist = (v) => nx * (Q[v * qs] * sx + ox) + ny * (Q[v * qs + 1] * sy + oy) + nz * (Q[v * qs + 2] * sz + oz) + c;
          const td = b.tex.data;
          for (const [col, rr] of b.ranges) {
            const si = (k * b.cols + col) * 4;
            if (!td[si + 1] || !td[si + 2] || td[si] === 1) continue;   // not a closed solid, or hidden
            const cb = b.boxes.get(col);
            if (cb && !plane.intersectsBox(bx.copy(cb).applyMatrix4(W))) continue;
            for (const [is, ic] of rr) {
              for (let t = is; t < is + ic; t += 3) {
                const v0 = I[t], v1 = I[t + 1], v2 = I[t + 2];
                const d0 = dist(v0), d1 = dist(v1), d2 = dist(v2);
                if ((d0 > 0 && d1 > 0 && d2 > 0) || (d0 < 0 && d1 < 0 && d2 < 0)) continue;
                const pts = [];
                const edge = (va, vb, da, db) => {
                  if ((da > 0) === (db > 0) || da === db) return;
                  const u = da / (da - db);
                  pts.push(new THREE.Vector3(
                    (Q[va * qs] + (Q[vb * qs] - Q[va * qs]) * u) * sx + ox,
                    (Q[va * qs + 1] + (Q[vb * qs + 1] - Q[va * qs + 1]) * u) * sy + oy,
                    (Q[va * qs + 2] + (Q[vb * qs + 2] - Q[va * qs + 2]) * u) * sz + oz));
                };
                edge(v0, v1, d0, d1); edge(v1, v2, d1, d2); edge(v2, v0, d2, d0);
                if (pts.length < 2) continue;
                a.copy(pts[0]).applyMatrix4(W); b2.copy(pts[1]).applyMatrix4(W);
                out.push(a.x, a.y, a.z, b2.x, b2.y, b2.z);
              }
              if (++n % 64 === 0) await yieldIfLong();
            }
          }
        }
      }
      return new Float32Array(out);
    },
    async getPositions(ids) {
      R.updateMatrixWorld(true);
      return ids.map((lid) => boxOf(R, lid, true).getCenter(new THREE.Vector3()));
    },
    async setVisible(ids, visible) {
      const list = ids === undefined || ids === null ? allIds() : ids;
      // showing what is not hidden changes nothing: skip it (the category
      // pass shows every category of every part after each load)
      if (visible && !hiddenState.size) return;
      for (const lid of list) {
        if (visible && !hiddenState.has(lid)) continue;
        setState(lid, !visible, "hide");
        if (visible) hiddenState.delete(lid); else hiddenState.add(lid);
      }
      flush();
    },
    async resetVisible() {
      for (const lid of hiddenState) setState(lid, false, "hide");
      hiddenState.clear();
      flush();
    },
    async setColor(ids, color) {
      if (color) shared.pick.value.set(color);
      for (const lid of ids) setState(lid, true, "pick");
      flush();
    },
    async highlight(ids) { return model.setColor(ids); },
    /* For the model browser: every drawn id of these elements (a typical
       floor's element is drawn once per copy), and the properties file. */
    lidsOfElements(els) {
      const want = els instanceof Set ? els : new Set(els);
      const out = [];
      forEachLid((lid) => { const e = elementOf(lid); if (e != null && want.has(e)) out.push(lid); });
      return out;
    },
    elementOfId: (lid) => elementOf(lid),
    loadProps: () => loadProps(),
    async resetColor(ids) {
      for (const lid of ids || allIds()) setState(lid, false, "pick");
      flush();
    },
    async getItemsOfCategories(res) {
      // the ids per category never change once loaded: work them out once
      if (!catIndex) {
        catIndex = {};
        let n = 0;
        for (const lid of lidsIter()) {
          const e = elementOf(lid);
          if (e === null || e === undefined) continue;
          const k = catKey(e);
          (catIndex[k] = catIndex[k] || []).push(lid);
          if ((++n & 4095) === 0) await yieldIfLong();
        }
      }
      const out = {};
      for (const [k, ids] of Object.entries(catIndex)) {
        if (res && res.length && !res.some((r) => r.test(k))) continue;
        out[k] = ids.slice();
      }
      return out;
    },
    async getItemsWithGeometryCategories() {
      const s = new Set();
      forEachLid((lid) => { const e = elementOf(lid); if (e != null) s.add(catKey(e)); });
      return [...s];
    },
    async getSpatialStructure() { return null; },
    async getItemsData(ids) {
      const p = await loadProps();
      return ids.map((lid) => {
        const e = elementOf(lid);
        if (e === null || e === undefined) return null;
        const el = head.el;
        const d = {
          Name: { value: el.name[e] }, Category: { value: head.cats[el.cat[e]] },
          Family: { value: el.family[e] }, Type: { value: el.type[e] },
          Level: { value: el.level[e] }, ElementId: { value: el.id[e] },
          GlobalId: { value: lid < E ? el.guid[e] : null },
        };
        if (lid >= E) d.Copy = { value: "typical-floor copy " + (copyInfo(lid) || [0, "?"])[1] };
        const sets = [];
        const add = (title, obj, prefix) => {
          const HasProperties = Object.entries(obj || {}).map(([k, v]) =>
            ({ Name: { value: k }, NominalValue: { value: v } }));
          if (HasProperties.length) sets.push({ Name: { value: prefix + title }, HasProperties });
        };
        if (p && p.el && p.el[e]) for (const [g, obj] of Object.entries(p.el[e])) add(g, obj, "");
        const tid = p && p.type_id ? p.type_id[e] : null;
        if (p && tid != null && p.types && p.types[String(tid)]) {
          for (const [g, obj] of Object.entries(p.types[String(tid)])) add(g, obj, "Type: ");
        }
        if (sets.length) d.IsDefinedBy = sets;
        return d;
      });
    },
    /* Another placement of the same geometry (and the same element
       states - hiding a wall hides it on every copy of the link). */
    place() {
      const R2 = new THREE.Group();
      R2.name = root.name + " copy";
      for (const c of root.children) {
        if (c.userData.lod) continue;
        const b = batches[c.userData.bi];
        const m2 = newMesh(b.geom, b.material, b, c.userData.bi);
        if (TILED) {
          m2.visible = false; m2.count = 0;
          // a piece already here: this placement draws it too
          if (b.res0 && b.geom0) {
            for (const k of ["position", "col", "color"]) m2.geometry.setAttribute(k, b.geom0.attributes[k]);
            m2.geometry.setIndex(b.geom0.index);
          }
        }
        R2.add(m2);
      }
      roots.push(R2);
      return makeApi(R2);
    },
    dispose() {
      if (R.parent) R.parent.remove(R);
      const ri = roots.indexOf(R);
      if (R !== root) { if (ri >= 0) roots.splice(ri, 1); return; }
      disposed = true;
      if (TILED) TILED.stream.forget(uid + ":");
      for (const b of batches) {
        b.geom.dispose(); b.tex.texture.dispose(); b.material.dispose();
        if (b.geom0) b.geom0.dispose();
        for (const g of b.lod.slice(1)) if (g) g.dispose();
      }
      for (const RR of roots) RR.traverse((c) => { if (c.geometry) c.geometry.dispose(); });
    },
  };
  return model;
  };
  const model = makeApi(root);
  return model;
}


/* ------------------------------------------------------------ tile files

   <name>.tidx  the index: "LWKT", version, JSON length, data length, the
                JSON (batches, head, groups), then the data it points into
                (instance matrices, element boxes, owners, cut flags).
   <name>.tbin  the geometry: one gzip piece per batch and copy (full and up
                to three coarser), fetched one by one by offset.
   A piece: eight 32-bit numbers (tag, vertices, indices, index width,
   column width, colour width, range words, 1 = delta coded), then the
   positions (16-bit, each the difference from the vertex before), the
   indices (each the difference from the one before), the element
   columns, the colours, and for the full copy each element's triangle
   ranges (for picking). Differences compress far better than the values. */
let MODEL_UID = 0;
const TILE_TAG = 0x4c574b54;
class BlobWriter {
  constructor() { this.parts = []; this.off = 0; }
  add(ta) {
    const pad = (8 - (this.off % 8)) % 8;
    if (pad) { this.parts.push(new Uint8Array(pad)); this.off += pad; }
    const o = this.off;
    this.parts.push(new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength));
    this.off += ta.byteLength;
    return [o, ta.length];
  }
  bytes() {
    const out = new Uint8Array(this.off);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}
function writeTileIndex(json, blob) {
  const js = new TextEncoder().encode(JSON.stringify(json));
  const jl = (js.length + 7) & ~7;
  const out = new Uint8Array(16 + jl + blob.length);
  const dv = new DataView(out.buffer);
  out.set([76, 87, 75, 84], 0);            // "LWKT"
  dv.setUint32(4, 1, true);
  dv.setUint32(8, jl, true);
  dv.setUint32(12, blob.length, true);
  out.set(js, 16);
  for (let k = js.length; k < jl; k++) out[16 + k] = 32;
  out.set(blob, 16 + jl);
  return out;
}
export function parseTileIndex(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x544b574c) throw new Error("not a tile index");
  const jl = dv.getUint32(8, true), bl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 16, jl)));
  // the data copied to a buffer of its own (aligned for the typed views)
  const blob = buf.slice(16 + jl, 16 + jl + bl);
  return { json, blob };
}
const pad4 = (n) => (n + 3) & ~3;
/* Version 2 of a piece: every vertex attribute 4 bytes wide per corner
   step (positions as four 16-bit numbers, colours as four bytes, the
   element column as a 32-bit float). Phones and tablets draw WebGL through
   Metal, which wants that: narrower steps (6-byte positions, 3-byte
   colours) are copied into a wider form on the device first - more memory,
   at the worst moment. */
export function encodeTileLevel(Q, I, C, RGB, cw, ranges, cols) {
  const nv = Q.length / 3, ni = I.length, iw = I.BYTES_PER_ELEMENT;
  let rw = 0;
  if (ranges) { rw = 1; for (const rr of ranges.values()) rw += 2 + 2 * rr.length; }
  const oQ = 32, oI = oQ + nv * 8, oC = oI + pad4(ni * iw), oRGB = oC + nv * 4,
        oR = oRGB + nv * 4, size = oR + rw * 4;
  const buf = new ArrayBuffer(size);
  new Uint32Array(buf, 0, 8).set([TILE_TAG, nv, ni, iw, 4, 4, rw, 1 | 2]);
  const q = new Int16Array(buf, oQ, nv * 4);
  for (let v = 0; v < nv; v++) {
    for (let c = 0; c < 3; c++) q[v * 4 + c] = v ? Q[v * 3 + c] - Q[(v - 1) * 3 + c] : Q[c];
  }
  const ix = iw === 2 ? new Uint16Array(buf, oI, ni) : new Uint32Array(buf, oI, ni);
  for (let i = 0; i < ni; i++) ix[i] = i ? I[i] - I[i - 1] : I[0];
  new Float32Array(buf, oC, nv).set(C);
  const rgba = new Uint8Array(buf, oRGB, nv * 4);
  for (let v = 0; v < nv; v++) {
    rgba[v * 4] = RGB[v * cw]; rgba[v * 4 + 1] = RGB[v * cw + 1]; rgba[v * 4 + 2] = RGB[v * cw + 2];
    rgba[v * 4 + 3] = cw === 4 ? RGB[v * cw + 3] : 255;
  }
  if (ranges) {
    const r = new Uint32Array(buf, oR, rw);
    let o = 0;
    r[o++] = ranges.size;
    for (const [col, rr] of ranges) {
      r[o++] = col; r[o++] = rr.length;
      for (const [is, ic] of rr) { r[o++] = is; r[o++] = ic; }
    }
  }
  return new Uint8Array(buf);
}
export function decodeTileLevel(buf) {
  const h = new Uint32Array(buf, 0, 8);
  if (h[0] !== TILE_TAG) throw new Error("not a tile piece");
  const [, nv, ni, iw, cwid, cw, rw, flags] = h;
  const wide = !!(flags & 2), qs = wide ? 4 : 3;
  const oQ = 32, oI = oQ + pad4(nv * qs * 2), oC = oI + pad4(ni * iw), oRGB = oC + pad4(nv * cwid), oR = oRGB + pad4(nv * cw);
  const Q = new Int16Array(buf, oQ, nv * qs);
  const I = iw === 2 ? new Uint16Array(buf, oI, ni) : new Uint32Array(buf, oI, ni);
  if (flags & 1) {
    for (let i = qs; i < Q.length; i++) Q[i] += Q[i - qs];
    for (let i = 1; i < ni; i++) I[i] += I[i - 1];
  }
  const C = cwid === 2 ? new Uint16Array(buf, oC, nv) : new Float32Array(buf, oC, nv);
  const RGB = new Uint8Array(buf, oRGB, nv * cw);
  let ranges = null;
  if (rw) {
    const r = new Uint32Array(buf, oR, rw);
    ranges = new Map();
    let o = 1;
    for (let c = 0; c < r[0]; c++) {
      const col = r[o++], nr = r[o++];
      const rr = [];
      for (let j = 0; j < nr; j++) { rr.push([r[o], r[o + 1]]); o += 2; }
      ranges.set(col, rr);
    }
  }
  return { Q, qs, I, C, RGB, cw, ranges, rangeBytes: rw * 4 };
}

/* What decides which tiles are held: every model streamed from tiles asks
   it for the pieces its view wants (with how much they matter: size on
   screen), and it fetches the most wanted first, a few at a time. Within
   the memory budget everything stays; over it, the pieces not seen for
   longest are let go. When even what is on screen will not fit, the
   pressure rises and the models ask for coarser copies. */
export function createTileStream(o = {}) {
  const T = {
    limit: o.limitBytes || 512 * 1048576, maxActive: o.maxActive || 4,
    used: 0, active: 0, inflight: 0, frame: 0, pressure: 1, changed: false,
    loaded: 0, evicted: 0, failed: 0, fetched: 0,
  };
  const wants = new Map(), loading = new Set(), entries = new Map(), failedAt = new Map();
  T.beginFrame = () => { T.frame++; wants.clear(); };
  T.want = (key, prio, bytes, start) => {
    if (entries.has(key) || loading.has(key)) return;
    const f = failedAt.get(key);
    if (f !== undefined && T.frame - f < 300) return;
    const w = wants.get(key);
    if (!w || w.prio < prio) wants.set(key, { prio, bytes: bytes || 0, start });
  };
  T.touch = (key) => { const e = entries.get(key); if (e) e.last = T.frame; };
  T.add = (key, bytes, evict) => {
    entries.set(key, { bytes, evict, last: T.frame });
    T.used += bytes;
    T.loaded++;
    T.changed = true;
  };
  T.forget = (prefix) => {
    for (const [k, e] of [...entries]) if (k.startsWith(prefix)) { T.used -= e.bytes; entries.delete(k); }
  };
  const evictable = () => { let n = 0; for (const e of entries.values()) if (e.last < T.frame) n += e.bytes; return n; };
  T.pump = () => {
    if (!wants.size || T.active >= T.maxActive) return;
    const list = [...wants.entries()].sort((a, b) => b[1].prio - a[1].prio);
    let spare = T.limit - T.used - T.inflight + evictable();
    for (const [key, w] of list) {
      if (T.active >= T.maxActive) break;
      if (entries.has(key) || loading.has(key)) continue;
      if (w.bytes > spare && T.used > 0) { T.pressure = Math.min(8, T.pressure * 1.2); break; }
      spare -= w.bytes;
      loading.add(key);
      T.active++;
      T.inflight += w.bytes;
      Promise.resolve().then(w.start).then(() => { T.fetched++; }, (e) => {
        T.failed++;
        failedAt.set(key, T.frame);
        if (typeof console !== "undefined") console.warn("tile", key, e && e.message);
      }).finally(() => {
        loading.delete(key);
        T.active--;
        T.inflight -= w.bytes;
        T.changed = true;
      });
    }
  };
  T.enforce = () => {
    if (T.used > T.limit) {
      const cand = [...entries.entries()].filter(([, e]) => e.last < T.frame).sort((a, b) => a[1].last - b[1].last);
      for (const [k, e] of cand) {
        if (T.used <= T.limit * 0.9) break;
        try { e.evict(); } catch (err) { /* already gone */ }
        T.used -= e.bytes;
        entries.delete(k);
        T.evicted++;
        T.changed = true;
      }
      if (T.used > T.limit) T.pressure = Math.min(8, T.pressure * 1.25);
    } else if (T.used < T.limit * 0.6 && T.pressure > 1) {
      T.pressure = Math.max(1, T.pressure / 1.1);
    }
  };
  T.stats = () => ({ usedMB: Math.round(T.used / 104857.6) / 10, limitMB: Math.round(T.limit / 1048576),
                     pieces: entries.size, loading: loading.size, wanted: wants.size, loaded: T.loaded,
                     evicted: T.evicted, failed: T.failed, pressure: Math.round(T.pressure * 100) / 100 });
  return T;
}

/* Tiles for a model, on the server: the model is built as the viewer
   builds it (every batch, the outside known), each batch's coarser copies
   made, and all of it written out. gzip: (Uint8Array) -> Uint8Array. */
export async function buildTiles(THREE, data, o = {}) {
  /* pieces of at most 65,535 corners: 16-bit indices, a megabyte or so
     each - a phone never has to unpack and send one huge piece at once */
  const m = await createLwkModel(THREE, data, { name: o.name, exterior: o.exterior || null, tiers: true, lod: true,
                                                maxBatchVerts: 65535 });
  return m.writeTiles(o.gzip, o.meta);
}

/* ------------------------------------------------------ the phone's file

   A copy of a model with only what a phone should hold outside: elements
   seen from outside, none of the small ones. Element numbers stay as they
   are (the lists keep every element; a left-out one simply has no
   geometry), so issues, properties and the exterior list still match. */
export function writeMobileLwkm(data, keep, sourceSig, opt = {}) {
  const head = JSON.parse(JSON.stringify(data.head));
  const { pos, idx, mat } = data;
  const E = head.el.id.length;
  keep = Uint8Array.from(keep);
  /* Too many triangles still: like a game's far detail, the smallest
     things go first until the file is within what a phone holds. */
  const tris = mobileTris(head, E);
  let keptTris = 0;
  for (let e = 0; e < E; e++) if (keep[e]) keptTris += tris[e];
  const before = keptTris;
  if (opt.maxTris && keptTris > opt.maxTris && opt.diag) {
    const order = [];
    for (let e = 0; e < E; e++) if (keep[e] && tris[e]) order.push(e);
    order.sort((a, b) => opt.diag[a] - opt.diag[b]);
    for (const e of order) {
      if (keptTris <= opt.maxTris) break;
      if (opt.protect && opt.protect[e]) continue;   // walls, windows, doors ... always stay
      keep[e] = 0;
      keptTris -= tris[e];
    }
  }
  const usedMesh = new Int32Array(head.meshes.length).fill(-1);
  const newMeshes = [];
  const outPos = [], outIdx = [];
  let nv = 0, ni = 0;
  const take = (mi) => {
    if (usedMesh[mi] >= 0) return usedMesh[mi];
    const [vs, vc, is, ic, m] = head.meshes[mi];
    outPos.push(pos.subarray(vs * 3, (vs + vc) * 3));
    outIdx.push(idx.subarray(is, is + ic));
    newMeshes.push([nv, vc, ni, ic, m]);
    nv += vc; ni += ic;
    return (usedMesh[mi] = newMeshes.length - 1);
  };
  for (let e = 0; e < E; e++) {
    head.el.baked[e] = keep[e] ? head.el.baked[e].map(take) : [];
  }
  head.inst = head.inst.filter((r) => keep[r[0]]);
  const defUsed = new Uint8Array(head.defs.length);
  const markDef = (d, depth = 0) => {
    if (defUsed[d] || depth > 12) return;
    defUsed[d] = 1;
    for (const [k] of head.defs[d].kids) markDef(k, depth + 1);
  };
  for (const r of head.inst) markDef(r[1]);
  head.defs.forEach((d, i) => { d.meshes = defUsed[i] ? d.meshes.map(take) : []; });
  for (const g of head.groups || []) g.elements = g.elements.filter((e) => keep[e]);
  head.meshes = newMeshes;
  const P = new Float32Array(nv * 3), I = new Uint32Array(ni);
  let o = 0;
  for (const a of outPos) { P.set(a, o); o += a.length; }
  o = 0;
  for (const a of outIdx) { I.set(a, o); o += a.length; }
  const M = new Float64Array(mat);
  const pad8 = (n) => (n + 7) & ~7;
  const posOff = 0, idxOff = pad8(P.byteLength), matOff = idxOff + pad8(I.byteLength);
  head.bin = { pos: [posOff, P.length], idx: [idxOff, I.length], mat: [matOff, M.length] };
  head.mobile = { source_sig: sourceSig, made: new Date().toISOString(),
                  triangles: keptTris, source_triangles: before };
  let js = new TextEncoder().encode(JSON.stringify(head));
  const jsLen = pad8(js.length);
  const total = 16 + jsLen + matOff + M.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([76, 87, 75, 77], 0);                      // "LWKM"
  dv.setUint32(4, 1, true);
  dv.setUint32(8, jsLen, true);
  out.set(js, 16);
  for (let k = js.length; k < jsLen; k++) out[16 + k] = 32;
  const base = 16 + jsLen;
  out.set(new Uint8Array(P.buffer), base + posOff);
  out.set(new Uint8Array(I.buffer), base + idxOff);
  out.set(new Uint8Array(M.buffer), base + matOff);
  return out;
}

/* Triangles each element stands for in the file: its own meshes, its
   family copies, and every copy of a typical floor it is part of. */
function mobileTris(head, E) {
  const t = new Float64Array(E);
  const meshT = (mi) => head.meshes[mi][3] / 3;
  const defT = new Float64Array(head.defs.length).fill(-1);
  const dT = (d, depth = 0) => {
    if (defT[d] >= 0) return defT[d];
    if (depth > 12) return 0;
    let s = 0;
    for (const mi of head.defs[d].meshes) s += meshT(mi);
    for (const [k] of head.defs[d].kids) s += dT(k, depth + 1);
    return (defT[d] = s);
  };
  for (let e = 0; e < E; e++) for (const mi of head.el.baked[e] || []) t[e] += meshT(mi);
  for (const r of head.inst) t[r[0]] += dT(r[1]);
  for (const g of head.groups || []) {
    const n = 1 + (g.copies || []).length;
    for (const e of g.elements) t[e] *= n;
  }
  return t;
}
