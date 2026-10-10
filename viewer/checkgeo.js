/* What the model checks (clash.js, headroom.js) read from the models
   loaded on the 3D page: which models there are, their categories, the
   boxes of their elements and the elements' triangles in world metres.
   Both kinds of model answer the same questions: the fast 3D format
   (lwkm.js, the project's Revit models) and fragments (IFC). */

/* IFC classes by the names people use; Revit category names as they are. */
const IFC_NAMES = {
  IFCWALL: "Walls", IFCWALLSTANDARDCASE: "Walls", IFCCURTAINWALL: "Curtain walls", IFCSLAB: "Slabs and floors",
  IFCROOF: "Roofs", IFCBEAM: "Beams", IFCCOLUMN: "Columns", IFCMEMBER: "Members (bracing, mullions)", IFCPLATE: "Plates and panels",
  IFCFOOTING: "Footings", IFCPILE: "Piles", IFCDOOR: "Doors", IFCWINDOW: "Windows", IFCSTAIR: "Stairs",
  IFCSTAIRFLIGHT: "Stair flights", IFCRAMP: "Ramps", IFCRAMPFLIGHT: "Ramp flights", IFCRAILING: "Railings",
  IFCCOVERING: "Coverings (ceilings, finishes)", IFCBUILDINGELEMENTPROXY: "Other elements (proxy)",
  IFCFURNISHINGELEMENT: "Furniture", IFCFURNITURE: "Furniture", IFCCHIMNEY: "Chimneys", IFCSHADINGDEVICE: "Shading devices",
  IFCREINFORCINGBAR: "Reinforcing bars", IFCTRANSPORTELEMENT: "Lifts and escalators",
  IFCFLOWSEGMENT: "Ducts, pipes and trays", IFCDUCTSEGMENT: "Ducts", IFCPIPESEGMENT: "Pipes",
  IFCCABLECARRIERSEGMENT: "Cable trays", IFCCABLESEGMENT: "Cables", IFCFLOWFITTING: "Fittings",
  IFCDUCTFITTING: "Duct fittings", IFCPIPEFITTING: "Pipe fittings", IFCCABLECARRIERFITTING: "Cable tray fittings",
  IFCFLOWTERMINAL: "Terminals", IFCAIRTERMINAL: "Air terminals", IFCSANITARYTERMINAL: "Sanitary fittings",
  IFCLIGHTFIXTURE: "Light fixtures", IFCFIRESUPPRESSIONTERMINAL: "Sprinklers", IFCFLOWCONTROLLER: "Valves and dampers",
  IFCVALVE: "Valves", IFCDAMPER: "Dampers", IFCFLOWMOVINGDEVICE: "Pumps and fans", IFCPUMP: "Pumps", IFCFAN: "Fans",
  IFCENERGYCONVERSIONDEVICE: "Plant", IFCUNITARYEQUIPMENT: "Plant units", IFCFLOWSTORAGEDEVICE: "Tanks",
  IFCDISTRIBUTIONELEMENT: "Distribution elements", IFCDISTRIBUTIONFLOWELEMENT: "Distribution elements",
  IFCDISTRIBUTIONCONTROLELEMENT: "Controls", IFCELECTRICAPPLIANCE: "Electrical appliances", IFCOUTLET: "Outlets",
  IFCSWITCHINGDEVICE: "Switches", IFCELECTRICDISTRIBUTIONBOARD: "Distribution boards", IFCDUCTSILENCER: "Silencers",
};
export function catLabel(k) {
  if (!/^IFC[A-Z]+$/.test(k)) return k;
  const n = IFC_NAMES[k] || (k.charAt(3) + k.slice(4).toLowerCase());
  return n + " (IFC)";
}

export function createGeo(ctx) {
  const { THREE } = ctx;

  // every model here, by a name that stays the same: a consultant's model by
  // its name and company, so what refers to it follows its next version
  // (uploaded afresh, with a new id)
  function models() {
    const out = [];
    for (const rec of ctx.recs()) {
      if (!rec.parts || !rec.parts.length) continue;
      const key = (rec.ref ? "ref:" + (rec.ref.name || "") + "/" + (rec.ref.company || "") : rec.entry.name).replace(/[|~]/g, "-");
      out.push({ key, label: ctx.modelLabel(rec), rec, lwk: !!rec.lwk });
    }
    return out;
  }
  const modelByKey = (k) => models().find((m) => m.key === k) || null;

  // a model's categories (Revit names for the fast 3D, IFC classes
  // otherwise): category -> [{ part, lids }]
  async function catsOf(m) {
    if (m.rec._clashCats) return m.rec._clashCats;
    const out = new Map();
    for (const part of m.rec.parts) {
      let by = {};
      try {
        if (part.model.getItemsOfRevitCategories) by = await part.model.getItemsOfRevitCategories();
        else {
          // an IFC: only the classes that are drawn (not units, properties ...)
          let geo = null;
          try { geo = new Set(await part.model.getItemsWithGeometryCategories()); } catch (e) { geo = null; }
          const all = await part.model.getItemsOfCategories([/.*/]);
          for (const [k, lids] of Object.entries(all || {})) if (!geo || geo.has(k)) by[k] = lids;
        }
      } catch (e) { by = {}; }
      for (const [k, lids] of Object.entries(by || {})) {
        if (!lids || !lids.length || /^IFC(SPACE|OPENINGELEMENT|ANNOTATION|GRID|SITE|BUILDING|BUILDINGSTOREY|PROJECT)$/.test(k)
          || k === "Rooms" || k === "Areas") continue;
        if (!out.has(k)) out.set(k, []);
        out.get(k).push({ part, lids });
      }
    }
    m.rec._clashCats = out;
    return out;
  }

  /* The elements of these categories of model m, with their boxes
     ([minX, minY, minZ, maxX, maxY, maxZ], world metres), kept when keep(box)
     says so. each(el) gets { part, lid, cat, box, model }. */
  async function elementsOf(m, cats, keep, each, stop, say) {
    const all = await catsOf(m);
    for (const k of cats) {
      for (const { part, lids } of all.get(k) || []) {
        for (let i = 0; i < lids.length; i += 4000) {
          if (stop && stop()) return;
          const ids = lids.slice(i, i + 4000);
          let bx = [];
          try { bx = await part.model.getBoxes(ids); } catch (e) { bx = []; }
          ids.forEach((lid, j) => {
            const b = bx[j];
            if (!b || b.isEmpty()) return;
            const a = [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z];
            if (keep && !keep(a)) return;
            each({ part, lid, cat: k, box: a, model: m });
          });
          if (say) say(`Reading ${m.label}: ${catLabel(k)} ...`);
        }
      }
    }
  }

  /* World triangles of elements (9 numbers each): an array in the same
     order, null where an element has none here. A fragments model may hand
     back the element's own placement only: its object's placement is put on
     top when the triangles would otherwise sit away from the element's box
     (worked out once per model part). */
  async function trisOf(els) {
    const byPart = new Map();
    els.forEach((e, i) => {
      if (!byPart.has(e.part)) byPart.set(e.part, []);
      byPart.get(e.part).push(i);
    });
    const out = new Array(els.length).fill(null);
    const M = new THREE.Matrix4();
    for (const [part, idx] of byPart) {
      const lids = idx.map((i) => els[i].lid);
      try { if (part.model.ensureGeometry) await part.model.ensureGeometry(lids); } catch (e) {}
      let geo = [];
      try { geo = await part.model.getItemsGeometry(lids); } catch (e) { geo = []; }
      idx.forEach((i, n) => {
        const g = geo[n] || [];
        let cnt = 0;
        for (const md of g) if (md && md.positions) cnt += md.indices ? md.indices.length : md.positions.length / 3;
        if (!cnt) return;
        const build = (pre) => {
          const t = new Float32Array(cnt * 3);
          let o = 0;
          for (const md of g) {
            if (!md || !md.positions) continue;
            M.copy(md.transform || new THREE.Matrix4());
            if (pre) M.premultiply(pre);
            const e = M.elements, P = md.positions, I = md.indices;
            const c = I ? I.length : P.length / 3;
            for (let q = 0; q < c; q++) {
              const v = (I ? I[q] : q) * 3, x = P[v], y = P[v + 1], z = P[v + 2];
              t[o++] = e[0] * x + e[4] * y + e[8] * z + e[12];
              t[o++] = e[1] * x + e[5] * y + e[9] * z + e[13];
              t[o++] = e[2] * x + e[6] * y + e[10] * z + e[14];
            }
          }
          return t;
        };
        const box = els[i].box;
        if (part._clashPre === undefined) {
          // which of the two lands on the element's box
          const off = (t) => {
            const mx = [Infinity, Infinity, Infinity], Mx = [-Infinity, -Infinity, -Infinity];
            for (let q = 0; q < t.length; q += 3) for (let d = 0; d < 3; d++) { mx[d] = Math.min(mx[d], t[q + d]); Mx[d] = Math.max(Mx[d], t[q + d]); }
            return Math.abs(mx[0] - box[0]) + Math.abs(mx[1] - box[1]) + Math.abs(mx[2] - box[2])
              + Math.abs(Mx[0] - box[3]) + Math.abs(Mx[1] - box[4]) + Math.abs(Mx[2] - box[5]);
          };
          if (part.model.head) part._clashPre = null;
          else {
            part.object.updateMatrixWorld(true);
            const W = part.object.matrixWorld.clone();
            part._clashPre = off(build(null)) <= off(build(W)) ? null : W;
          }
        }
        out[i] = build(part._clashPre);
      });
    }
    return out;
  }

  /* Names for elements, all at once (one question per model): sets e.id
     (model|Revit id or GUID[@copy][#placement] - the same from one run to
     the next), e.info and e.label. */
  async function nameAll(els) {
    const byPart = new Map();
    for (const e of els) {
      if (e.id) continue;
      if (!byPart.has(e.part)) byPart.set(e.part, []);
      byPart.get(e.part).push(e);
    }
    for (const [part, list] of byPart) {
      const lids = list.map((e) => e.lid);
      let guids = [], data = [];
      if (!part.model.head) {
        try { guids = await part.model.getGuidsByLocalIds(lids); } catch (err) { guids = []; }
        try { data = await part.model.getItemsData(lids, { attributesDefault: true }); } catch (err) { data = []; }
      }
      const cnt = part.model.elementCountForId;
      list.forEach((e, i) => {
        const guid = guids[i] || null;
        const info = ctx.elementInfo(part, e.lid, guid) || {};
        const d = data[i] || {};
        const copy = cnt != null && e.lid >= cnt ? "@" + e.lid : "";
        e.info = info;
        e.guid = guid;
        e.id = e.model.key + "|" + (info.revit_id || guid || "l" + e.lid) + copy + (part.idx ? "#" + part.idx : "");
        const name = info.name || info.family || (d.Name && d.Name.value) || (d.ObjectType && d.ObjectType.value) || "";
        e.label = { model: e.model.label, cat: catLabel(e.cat), name, id: info.revit_id || guid || "", type: info.type || "" };
      });
    }
  }

  /* An element id as nameAll makes it, back to { part, lid } as loaded now. */
  async function find(id) {
    const [mk, rest] = id.split("|");
    const m = modelByKey(mk);
    if (!m || !rest) return null;
    const bare = rest.replace(/#\d+$/, "").replace(/@\d+$/, "");
    const pidx = /#(\d+)$/.test(rest) ? Number(rest.match(/#(\d+)$/)[1]) : 0;
    const copy = /@(\d+)/.test(rest) ? Number(rest.match(/@(\d+)/)[1]) : null;
    const part = m.rec.parts[pidx] || m.rec.parts[0];
    if (copy != null) return { part, lid: copy };
    if (part.model.head && /^\d+$/.test(bare)) {
      const ids = part.model.head.el.id;
      for (let e = 0; e < ids.length; e++) if (String(ids[e]) === bare) {
        const lids = part.model.lidsOfElements([e]);
        if (lids.length) return { part, lid: lids[0] };
      }
      return null;
    }
    if (/^l\d+$/.test(bare)) return { part, lid: Number(bare.slice(1)) };
    try { const l = (await part.model.getLocalIdsByGuids([bare]))[0]; if (l != null) return { part, lid: l }; } catch (e) {}
    return null;
  }

  return { models, modelByKey, catsOf, elementsOf, trisOf, nameAll, find };
}

/* Where a check looks: the whole model, floors from ... to ..., or inside
   the section box. sel: the kind select; from, to: the floor selects (their
   row shown only for floors). get() -> { err } or { label, test(box) or
   null, floors: [{ name, lo, hi }] (each floor's band, from its level to the
   next one's), planes } */
export function scopePicker(ctx, THREE, sel, from, to, row) {
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function fill() {
    const rows = ctx.floorRows();
    const keepF = from.value, keepT = to.value;
    const opts = rows.map((r, i) => `<option value="${i}">${esc(r.name)}</option>`).reverse().join("");
    from.innerHTML = opts; to.innerHTML = opts;
    const cur = ctx.floorIndex() != null && rows[ctx.floorIndex()] ? String(ctx.floorIndex()) : (rows.length ? "0" : "");
    from.value = [...from.options].some((o) => o.value === keepF) ? keepF : cur;
    to.value = [...to.options].some((o) => o.value === keepT) ? keepT : from.value;
    sel.querySelector('option[value="floors"]').disabled = !rows.length;
    if (!rows.length && sel.value === "floors") sel.value = "all";
    row.hidden = sel.value !== "floors";
  }
  sel.addEventListener("change", fill);
  sel.addEventListener("focus", fill);
  from.addEventListener("change", () => { if (Number(to.value) < Number(from.value)) to.value = from.value; });
  to.addEventListener("change", () => { if (Number(to.value) < Number(from.value)) from.value = to.value; });
  function get() {
    const v = sel.value;
    if (v === "box") {
      const planes = ctx.sectionPlanes();
      if (!planes) return { err: "Turn the section box on first (Section > Box), or check floors or the whole model." };
      const c = new THREE.Vector3();
      return { label: "inside the section box", planes, floors: null, test: (b) => planes.every((p) => {
        for (let i = 0; i < 8; i++) {
          c.set(i & 1 ? b[3] : b[0], i & 2 ? b[4] : b[1], i & 4 ? b[5] : b[2]);
          if (p.distanceToPoint(c) >= 0) return true;
        }
        return false;
      }) };
    }
    if (v === "floors") {
      const rows = ctx.floorRows();
      let i = Number(from.value), j = Number(to.value);
      if (!rows[i] || !rows[j]) return { err: "Those floors are not known any more." };
      if (j < i) [i, j] = [j, i];
      const floors = [];
      for (let k = i; k <= j; k++) floors.push({ name: rows[k].name, lo: rows[k].y, hi: k + 1 < rows.length ? rows[k + 1].y : rows[k].y + 6 });
      const lo = rows[i].y - 0.05, hi = j + 1 < rows.length ? rows[j + 1].y + 0.05 : Infinity;
      return { label: i === j ? "on " + rows[i].name : `on ${rows[i].name} to ${rows[j].name}`, floors, lo, hi,
               test: (b) => b[4] >= lo && b[1] <= hi };
    }
    return { label: "in the whole model", test: null, floors: null };
  }
  return { fill, get };
}
