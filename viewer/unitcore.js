/* Site study, stage 3: residential units drawn as plans - rooms are
 * rectangles on a 50 mm grid (to the wall centrelines), together any stepped
 * outline; the balcony, utility platform, A/C platform, pipe duct and
 * architectural feature outside it. Pure: the sizes and the rules, tested in
 * tests/units.test.mjs.
 *
 * Saleable area: Residential Properties (First-hand Sales) Ordinance s.8 -
 * the floor area enclosed by the walls, measured to the exterior of the
 * enclosing walls, or to the middle of a wall between two units; internal
 * partitions included; the balcony and utility platform stated separately
 * and added; the A/C platform not part of it.
 *
 * GFA concessions:
 *   balcony (JPN 1, para 1(a)(x)-(xii)): at least 2 m2; 50% of its area
 *     exempted, the exempted part per unit at most 1 m2 or 2.5% of the unit's
 *     usable floor space, whichever is greater, up to 3 m2; under the 10% cap.
 *   utility platform (JPN 2, para 1(b)(ii)-(v)): at least 1.5 m2; 50%
 *     exempted, at most 0.75 m2 per unit; under the 10% cap.
 *   A/C platform (PNAP APP-19 para 3(b)/(c)): projecting not over 750 mm, or
 *     complying with the Code of Practice for external maintenance - not
 *     counted, outside the cap (APP-151 item 28); otherwise item 29, under it.
 */
export const M2_FT2 = 10.7639;
export const KINDS = {
  LD: { label: "Living / dining", zh: "客/飯廳", ab: "LIV./DIN.", min: 2.2, hab: true },
  MBR: { label: "Master bedroom", zh: "主人睡房", ab: "M.B.R.", min: 2.0, hab: true },
  BR: { label: "Bedroom", zh: "睡房", ab: "B.R.", min: 1.9, hab: true },
  STUDY: { label: "Study", zh: "書房", ab: "STUDY", min: 1.2 },
  OKIT: { label: "Open kitchen", zh: "開放式廚房", ab: "OPEN KIT.", min: 1.2 },
  KIT: { label: "Kitchen", zh: "廚房", ab: "KIT.", min: 1.4 },
  BATH: { label: "Bathroom", zh: "浴室", ab: "BATH", min: 1.1 },
  ENS: { label: "Ensuite", zh: "浴室", ab: "BATH", min: 1.1 },
  LOBBY: { label: "Lobby / corridor", zh: "", ab: "", min: 0.8 },
  STORE: { label: "Store", zh: "儲物室", ab: "ST", min: 0.5 },
};
export const EXTRAS = {
  bal: { label: "Balcony", zh: "露台", ab: "BAL." },
  up: { label: "Utility platform", zh: "工作平台", ab: "U.P." },
  acp: { label: "A/C platform", zh: "空調機室外機平台", ab: "A/C PLATFORM" },
  pd: { label: "Pipe duct", zh: "管道", ab: "P.D." },
  af: { label: "Architectural feature", zh: "建築裝飾", ab: "A.F." },
  roof: { label: "Flat roof", zh: "私人平台", ab: "FLAT ROOF" },
};
export const RULES = {
  bal: { min: 2, share: 0.5, cap: 1, capPct: 0.025, max: 3, src: "JPN 1 para 1(a)(x)-(xii)" },
  up: { min: 1.5, share: 0.5, max: 0.75, src: "JPN 2 para 1(b)(ii)-(v)" },
  acp: { depth: 0.75, src: "PNAP APP-19 para 3(b), (c); APP-151 items 28, 29" },
};
/* the façade of an external wall: RC with windows, curtain wall, precast (NSPEW) */
export const FACADES = {
  rc: { label: "RC wall with windows", t: null },
  cw: { label: "Curtain wall", t: 0.15, src: "PNAP APP-2 para 6: projecting not more than 200 mm (domestic) from the structure, disregarded from GFA and SC; at least a 300 mm RC dwarf wall" },
  pc: { label: "Precast façade (NSPEW)", t: 0.15, max: 0.15, src: "JPN 2 / APP-151 item 11: non-structural prefabricated external wall, its thickness up to 150 mm exempted, under the 10% cap" },
};
const n = (x, d = 0) => (x === "" || x == null || isNaN(Number(x)) ? d : Number(x));
const EPS = 1e-6;

/* the first form (rows of rooms) as rooms on the plan */
export function fromRows(u) {
  if (!u || !Array.isArray(u.rows)) return u;
  const pt = n(u.part, 0.075), rooms = [];
  const rowW = u.rows.map((r) => (r.rooms || []).reduce((s, q) => s + n(q.w), 0) + Math.max(0, (r.rooms || []).length - 1) * pt);
  const W = Math.max(0, ...rowW);
  let y = 0, k = 0;
  u.rows.forEach((r, ri) => {
    const d = n(r.depth) + (ri < u.rows.length - 1 ? pt : 0);
    let x = 0;
    (r.rooms || []).forEach((q, qi) => {
      let w = n(q.w) + (qi < r.rooms.length - 1 ? pt : 0);
      if (qi === r.rooms.length - 1) w = W - x;
      rooms.push({ id: "r" + ++k, kind: q.kind === "ENTRY" ? "LOBBY" : q.kind, name: q.name || "", x: +x.toFixed(3), y: +y.toFixed(3), w: +w.toFixed(3), h: +d.toFixed(3) });
      x += w;
    });
    y += d;
  });
  let ex = 0;
  const extras = (u.extras || []).map((e) => { const o = { kind: e.kind, x: +ex.toFixed(3), y: +y.toFixed(3), w: n(e.w), h: n(e.d), dfs: !!e.dfs }; ex += n(e.w); return o; });
  const out = Object.assign({}, u, { rooms, extras, doors: [], facade: "s", partySides: ["w", "e"] });
  delete out.rows;
  return out;
}

/* the rooms' grid: the cells between all the rooms' edges, and which are in */
function grid(rooms) {
  const xs = [...new Set(rooms.flatMap((r) => [n(r.x), n(r.x) + n(r.w)]).map((v) => +v.toFixed(4)))].sort((a, b) => a - b);
  const ys = [...new Set(rooms.flatMap((r) => [n(r.y), n(r.y) + n(r.h)]).map((v) => +v.toFixed(4)))].sort((a, b) => a - b);
  const at = (i, j) => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= ys.length - 1) return null;
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    return rooms.find((r) => cx > n(r.x) && cx < n(r.x) + n(r.w) && cy > n(r.y) && cy < n(r.y) + n(r.h)) || null;
  };
  return { xs, ys, at };
}

/* the outline's edges and the partitions: [{x1, y1, x2, y2, kind: ext|party|part, face: n|e|s|w, a, b}];
   an outer wall is party when its side is in partySides, unless walls[key].kind says ext or party for it alone */
/* a door beside a balcony or utility platform: the external wall the extra touches */
export function byOutdoor(u, e) {
  if (!e || e.kind === "part" || e.angled) return false;
  const v = e.x1 === e.x2;
  return expandBays(u.extras || []).some((x) => (x.kind === "bal" || x.kind === "up") && (v
    ? (Math.abs(n(x.x) - e.x1) < 0.35 || Math.abs(n(x.x) + n(x.w) - e.x1) < 0.35) && n(x.y) < Math.max(e.y1, e.y2) - 0.3 && n(x.y) + n(x.h) > Math.min(e.y1, e.y2) + 0.3
    : (Math.abs(n(x.y) - e.y1) < 0.35 || Math.abs(n(x.y) + n(x.h) - e.y1) < 0.35) && n(x.x) < Math.max(e.x1, e.x2) - 0.3 && n(x.x) + n(x.w) > Math.min(e.x1, e.x2) + 0.3));
}
export function edges(u) {
  if (hasPoly(u)) return polyEdges(u);
  const rooms = u.rooms || [], G = grid(rooms), out = [];
  const party = new Set(u.partySides || []);
  const push = (e) => {
    const last = out.find((o) => o.kind === e.kind && o.face === e.face && o.a === e.a && o.b === e.b &&
      ((e.x1 === e.x2 && o.x1 === o.x2 && Math.abs(o.x1 - e.x1) < EPS && Math.abs(o.y2 - e.y1) < EPS) ||
       (e.y1 === e.y2 && o.y1 === o.y2 && Math.abs(o.y1 - e.y1) < EPS && Math.abs(o.x2 - e.x1) < EPS)));
    if (last) { last.x2 = e.x2; last.y2 = e.y2; } else out.push(e);
  };
  for (let i = 0; i < G.xs.length; i++)
    for (let j = 0; j < G.ys.length - 1; j++) {
      const L = G.at(i - 1, j), R = G.at(i, j);
      if (L === R) continue;
      const x = G.xs[i], y1 = G.ys[j], y2 = G.ys[j + 1];
      if (L && R) push({ x1: x, y1, x2: x, y2, kind: "part", face: "", a: L.id, b: R.id });
      else push({ x1: x, y1, x2: x, y2, kind: party.has(L ? "e" : "w") ? "party" : "ext", face: L ? "e" : "w", a: (L || R).id, b: null });
    }
  for (let j = 0; j < G.ys.length; j++)
    for (let i = 0; i < G.xs.length - 1; i++) {
      const T = G.at(i, j - 1), B = G.at(i, j);
      if (T === B) continue;
      const y = G.ys[j], x1 = G.xs[i], x2 = G.xs[i + 1];
      if (T && B) push({ x1, y1: y, x2, y2: y, kind: "part", face: "", a: T.id, b: B.id });
      else push({ x1, y1: y, x2, y2: y, kind: party.has(T ? "s" : "n") ? "party" : "ext", face: T ? "s" : "n", a: (T || B).id, b: null });
    }
  const W = u.walls || {};
  return out.map((e) => {
    const key = e.kind === "part" ? [e.a, e.b].sort().join("|") : e.a + ":" + e.face;
    const o = W[key] || {};
    // a wall's own type (external / party) over its side's setting
    if (e.kind !== "part" && (o.kind === "ext" || o.kind === "party")) e.kind = o.kind;
    return Object.assign(e, { len: Math.hypot(e.x2 - e.x1, e.y2 - e.y1), key, t: o.t != null && o.t !== "" ? Number(o.t) : null, removed: !!o.open });
  });
}

/* an open kitchen and the living room share no wall */
/* a partition's solid part: walls[key] = {s, e}, metres from its start
   (its lower x or y) - the rest of the line open; [s, e] in metres */
export function solidPart(u, e) {
  const o = (u.walls || {})[e.key] || {};
  if (e.kind !== "part" || (o.s == null && o.e == null)) return [0, e.len];
  const a = Math.max(0, Math.min(e.len, n(o.s, 0))), b = Math.max(a, Math.min(e.len, n(o.e, e.len)));
  return [a, b];
}
export function solidLen(u, e) { if (isOpen(u, e)) return 0; const [a, b] = solidPart(u, e); return b - a; }

/* the space a room belongs to: rooms joined into one space (an L-shaped living / dining with its foyer) share no wall */
export const spaceOf = (r) => (r && r.space) || (r && r.id);
export function isOpen(u, e) {
  if (e.kind !== "part") return false;
  if (e.removed) return true;
  if (u.walls && u.walls[e.key] && u.walls[e.key].open === false) return false;
  const A = u.rooms.find((r) => r.id === e.a), Bq = u.rooms.find((r) => r.id === e.b);
  if (A && Bq && spaceOf(A) === spaceOf(Bq)) return true;
  const ka = (A || {}).kind, kb = (Bq || {}).kind;
  const k = [ka, kb].sort().join("+");
  return k === "LD+OKIT" || k === "LD+LOBBY" || (u.open || []).includes([e.a, e.b].sort().join("+"));
}

/* the rooms' outline as rings of points, each side moved off the room
   edges: "saleable" - to the outside face of external walls (t/2), the
   middle of party walls (0); "gfa" - the same but a curtain wall at the
   structure (0) and a precast wall at its inside face less what is exempt.
   -> {rings: [[[x, y], ...]], area} */
export function outline(u, mode = "saleable", E0) {
  const rooms = u.rooms || [];
  if (!rooms.length) return { rings: [], area: 0 };
  const E = E0 || edges(u), G = hasPoly(u) ? null : grid(rooms), inn = (i, j) => !!G.at(i, j);
  const wall = n(u.wall, 0.1);
  const facOf = (e) => ((u.walls || {})[e.key] || {}).f || u.facadeType || "rc";
  // the GFA's lines, as the user sets them: external walls to their outer face (default), centre or inner face; party walls to their centre (default) or outer face
  const gExt = mode === "gfa" ? u.gfaExt || "outer" : "outer", gParty = mode === "gfa" ? u.gfaParty || "centre" : "centre";
  const offOf = (e) => {
    if (!e) return 0;
    if (e.kind === "party") return gParty === "outer" ? (e.t != null ? e.t : n(u.party, 0.15)) / 2 : 0;
    const t = e.t != null ? e.t : FACADES[facOf(e)] && FACADES[facOf(e)].t != null ? FACADES[facOf(e)].t : wall, f = facOf(e);
    const base = gExt === "centre" ? 0 : gExt === "inner" ? -t / 2 : t / 2;
    if (mode === "gfa" && f === "cw") return Math.min(0, base);
    if (mode === "gfa" && f === "pc") return gExt === "outer" ? t / 2 - Math.min(t, FACADES.pc.max) : base;
    return base;
  };
  if (hasPoly(u)) return polyOutline(E, offOf);
  // the boundary in unit pieces, each directed with the inside on its left (y down: outward normal = (dy, -dx))
  const segs = [];
  const edgeAt = (face, x1, y1, x2, y2) => E.find((e) => e.kind !== "part" && e.face === face && (face === "e" || face === "w" ? Math.abs(e.x1 - x1) < EPS && e.y1 <= Math.min(y1, y2) + EPS && e.y2 >= Math.max(y1, y2) - EPS : Math.abs(e.y1 - y1) < EPS && e.x1 <= Math.min(x1, x2) + EPS && e.x2 >= Math.max(x1, x2) - EPS));
  for (let i = 0; i < G.xs.length; i++) for (let j = 0; j < G.ys.length - 1; j++) {
    const L = inn(i - 1, j), R = inn(i, j), x = G.xs[i], a = G.ys[j], b = G.ys[j + 1];
    if (L && !R) segs.push({ p: [x, a], q: [x, b], nx: 1, ny: 0, off: offOf(edgeAt("e", x, a, x, b)) });
    if (R && !L) segs.push({ p: [x, b], q: [x, a], nx: -1, ny: 0, off: offOf(edgeAt("w", x, a, x, b)) });
  }
  for (let j = 0; j < G.ys.length; j++) for (let i = 0; i < G.xs.length - 1; i++) {
    const T = inn(i, j - 1), B = inn(i, j), y = G.ys[j], a = G.xs[i], b = G.xs[i + 1];
    if (T && !B) segs.push({ p: [b, y], q: [a, y], nx: 0, ny: 1, off: offOf(edgeAt("s", a, y, b, y)) });
    if (B && !T) segs.push({ p: [a, y], q: [b, y], nx: 0, ny: -1, off: offOf(edgeAt("n", a, y, b, y)) });
  }
  const key = (pt) => pt[0].toFixed(4) + "," + pt[1].toFixed(4);
  const from = new Map();
  for (const sg of segs) { const k = key(sg.p); if (!from.has(k)) from.set(k, []); from.get(k).push(sg); }
  const used = new Set(), rings = [];
  for (const s0 of segs) {
    if (used.has(s0)) continue;
    const chain = [];
    let sg = s0, guard = 0;
    while (sg && !used.has(sg) && guard++ < 10000) {
      used.add(sg); chain.push(sg);
      const nx = (from.get(key(sg.q)) || []).filter((c) => !used.has(c));
      // at a point where two rings touch, turn left first (keeps each ring simple)
      sg = nx.length > 1 ? nx.find((c) => c.nx === -sg.ny && c.ny === sg.nx) || nx[0] : nx[0] || null;
    }
    // merge straight runs with the same offset, then the corners from the meeting offset lines
    const runs = [];
    for (const c of chain) { const l = runs[runs.length - 1]; if (l && l.nx === c.nx && l.ny === c.ny && Math.abs(l.off - c.off) < EPS) l.q = c.q; else runs.push(Object.assign({}, c)); }
    if (runs.length > 1) { const f = runs[0], l = runs[runs.length - 1]; if (f.nx === l.nx && f.ny === l.ny && Math.abs(f.off - l.off) < EPS) { f.p = l.p; runs.pop(); } }
    const pts = [];
    for (let k = 0; k < runs.length; k++) {
      const A = runs[k], Bq = runs[(k + 1) % runs.length];
      const ax = A.p[0] + A.nx * A.off, ay = A.p[1] + A.ny * A.off;      // a point on A's offset line
      const bx = Bq.p[0] + Bq.nx * Bq.off, by = Bq.p[1] + Bq.ny * Bq.off;
      if (A.nx === Bq.nx && A.ny === Bq.ny) {            // straight on, a different offset: a small step
        pts.push(A.nx ? [ax, A.q[1]] : [A.q[0], ay], Bq.nx ? [bx, Bq.p[1]] : [Bq.p[0], by]);
      } else pts.push(A.nx ? [ax, by] : [bx, ay]);
    }
    if (pts.length >= 3) rings.push(pts.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]));
  }
  let a = 0;
  for (const r of rings) { let s2 = 0; for (let k = 0; k < r.length; k++) { const p = r[k], q = r[(k + 1) % r.length]; s2 += p[0] * q[1] - q[0] * p[1]; } a += s2 / 2; }
  return { rings, area: Math.abs(a) };
}

/* the first form of an open kitchen (a room open to the living room) as a
   zone drawn over the living / dining space, which takes in the kitchen's
   floor and the foyer open to it: the areas stay, the kitchen's extent no
   longer moves a wall */
export function zoneKitchens(u) {
  const rooms = u.rooms || [];
  const ld = rooms.find((r) => r.kind === "LD" && !r.space);
  if (!ld) return u;
  const E = edges(u), touch = (a, b) => E.some((e) => e.kind === "part" && ((e.a === a.id && e.b === b.id) || (e.a === b.id && e.b === a.id)) && isOpen(u, e));
  const inSpace = new Set([ld.id]);
  let changed = false;
  for (let k = 0; k < 3; k++) for (const r of rooms) {
    if (inSpace.has(r.id) || !["OKIT", "LOBBY"].includes(r.kind)) continue;
    if (rooms.some((q) => inSpace.has(q.id) && touch(q, r))) inSpace.add(r.id);
  }
  for (const r of rooms) {
    if (!inSpace.has(r.id) || r.id === ld.id) continue;
    if (r.kind === "OKIT") { (u.zones = u.zones || []).push({ kind: "OKIT", x: r.x, y: r.y, w: r.w, h: r.h }); r.kind = "LD"; }
    r.space = ld.id; changed = true;
  }
  if (changed) u.zonesDone = 1;
  return u;
}

export function figures(u0) {
  const u = u0 && u0.rows ? fromRows(u0) : u0;
  const rooms = u.rooms || [];
  const wall = n(u.wall, 0.1), party = n(u.party, 0.15), pt = n(u.part, 0.075);
  const area = rooms.reduce((s, r) => s + roomArea(r), 0); // the rooms tile: no overlaps
  const E = edges(u);
  const extL = E.filter((e) => e.kind === "ext").reduce((s, e) => s + e.len, 0);
  const partyL = E.filter((e) => e.kind === "party").reduce((s, e) => s + e.len, 0);
  const partL = E.filter((e) => e.kind === "part" && !isOpen(u, e)).reduce((s, e) => s + solidLen(u, e), 0);
  // to the outside of the external walls (the outline grown by half the wall; the corners add 4 small squares), to the middle of party walls
  // each external wall at its thickness and façade
  const facOf = (e) => ((u.walls || {})[e.key] || {}).f || u.facadeType || "rc";
  const extT = (e) => (e.t != null ? e.t : FACADES[facOf(e)] && FACADES[facOf(e)].t != null ? FACADES[facOf(e)].t : wall);
  for (const e of E) if (e.kind === "ext") { e.facade = facOf(e); if (e.t == null) e.t = extT(e); }
  const extOut = E.filter((e) => e.kind === "ext").reduce((s2, e) => s2 + e.len * e.t / 2, 0);
  // to the outside of the external walls and the middle of party walls: the saleable line's own area (each wall at its thickness)
  const ringS = outline(u, "saleable", E), ringG = outline(u, "gfa", E);
  const enclosed = ringS.rings.length ? ringS.area : area + extOut + 4 * (wall / 2) ** 2 * (extL > 0 ? 1 : 0);
  // façade concessions: a curtain wall's projection beyond the structure is not GFA (outside the cap); a precast wall's thickness up to 150 mm is exempt (under the cap)
  const cwEx = E.filter((e) => e.kind === "ext" && e.facade === "cw").reduce((s2, e) => s2 + e.len * e.t / 2, 0);
  const pcEx = E.filter((e) => e.kind === "ext" && e.facade === "pc").reduce((s2, e) => s2 + e.len * Math.min(e.t, FACADES.pc.max), 0);
  // inside the walls: each wall at its own thickness where it has one
  const tOf = (e) => (e.t != null ? e.t : e.kind === "ext" ? wall : e.kind === "party" ? party : pt);
  const internal = Math.max(0, area - E.filter((e) => e.kind !== "part" || !isOpen(u, e)).reduce((s2, e) => s2 + (e.kind === "part" ? solidLen(u, e) : e.len) * tOf(e) / 2, 0));
  void partL;
  const ex = expandBays(u.extras || []).map((e) => Object.assign({ area: e.splay ? n(e.w) * n(e.h) - n(e.splay) ** 2 / 2 : n(e.w) * n(e.h) }, e));
  const sum = (k) => ex.filter((e) => e.kind === k).reduce((s, e) => s + e.area, 0);
  const bal = sum("bal"), up = sum("up"), acp = sum("acp");
  const balOk = ex.filter((e) => e.kind === "bal" && e.area >= RULES.bal.min - 1e-9).reduce((s, e) => s + e.area, 0);
  const balCap = Math.min(RULES.bal.max, Math.max(RULES.bal.cap, RULES.bal.capPct * internal));
  const balEx = Math.min(balOk * RULES.bal.share, balCap);
  const upOk = ex.filter((e) => e.kind === "up" && e.area >= RULES.up.min - 1e-9).reduce((s, e) => s + e.area, 0);
  const upEx = Math.min(upOk * RULES.up.share, RULES.up.max);
  const acpFree = ex.filter((e) => e.kind === "acp" && (Math.min(n(e.w), n(e.h)) <= RULES.acp.depth + 1e-9 || e.dfs)).reduce((s, e) => s + e.area, 0);
  const acpCapEx = acp - acpFree;
  const saleable = enclosed + bal + up;
  // to the lines chosen for the GFA: the GFA line's own area when they are not the usual ones
  const usual = (u.gfaExt || "outer") === "outer" && (u.gfaParty || "centre") === "centre";
  const gfa = (usual || !ringG.rings.length ? enclosed - cwEx - pcEx : ringG.area) + (bal - balEx) + (up - upEx);
  const warn = [];
  for (const r of rooms) {
    if (r.space && r.space !== r.id) continue;          // a piece of another room's space: that room is checked
    const k = KINDS[r.kind];
    const parts = rooms.filter((q) => spaceOf(q) === r.id);
    const mw = isPoly(r) ? minWidth(ptsOf(r)) : Math.min(n(r.w), n(r.h));
    if (k && parts.length < 2 && mw < k.min - 1e-9) warn.push(`${r.name || k.label}: ${mw.toFixed(2)} m is under ${k.min} m`);
    const hasWin = Array.isArray(u.windows) ? u.windows.some((w) => parts.some((q) => q.id === w.room)) : E.some((e) => e.kind === "ext" && e.a === r.id && e.face === (u.facade || "s")) || (u.extras || []).some((x) => touches(r, x));
    if (k && k.hab && !hasWin)
      warn.push(`${r.name || k.label}: no window on the façade`);
  }
  const has = (...k) => rooms.some((r) => k.includes(r.kind));
  if (!has("BATH", "ENS")) warn.push("No bathroom");
  const kz = (u.zones || []).some((z) => z.kind === "OKIT" || z.kind === "KIT");
  if (!has("KIT", "OKIT") && !kz) warn.push("No kitchen");
  if (has("OKIT") || kz) warn.push("Open kitchen: FS Code requirements apply (sprinklers / the cooking area away from the exit door)");
  for (const e of ex) {
    if (e.kind === "bal" && e.area < RULES.bal.min) warn.push(`Balcony ${e.area.toFixed(2)} m² is under ${RULES.bal.min} m²: no exemption (JPN 1)`);
    if (e.kind === "up" && e.area < RULES.up.min) warn.push(`Utility platform ${e.area.toFixed(2)} m² is under ${RULES.up.min} m²: no exemption (JPN 2)`);
    if (e.kind === "acp" && Math.min(n(e.w), n(e.h)) > RULES.acp.depth && !e.dfs) warn.push(`A/C platform over 750 mm deep: exempt only under the 10% cap unless it meets the external maintenance code (APP-19)`);
  }
  if (bal && balOk * RULES.bal.share > balCap + 1e-9) warn.push(`Balcony exemption capped at ${balCap.toFixed(2)} m² for this unit`);
  if (up && upOk * RULES.up.share > RULES.up.max + 1e-9) warn.push(`Utility platform exemption capped at ${RULES.up.max} m²`);
  const xs = rooms.flatMap((r) => ptsOf(r).map((q) => q[0])), ys = rooms.flatMap((r) => ptsOf(r).map((q) => q[1]));
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return {
    unit: u, edges: E, area: r3(area), internal: r3(internal), enclosed: r3(enclosed), bal: r3(bal), up: r3(up), acp: r3(acp),
    saleable: r3(saleable), saleableFt: Math.round(saleable * M2_FT2), gfa: r3(gfa), balEx: r3(balEx), upEx: r3(upEx), acpFree: r3(acpFree), acpCapEx: r3(acpCapEx),
    cwEx: r3(cwEx), pcEx: r3(pcEx), ringS, ringG, ringArea: r3(ringS.area), gfaRing: r3(ringG.area),
    capped: r3(balEx + upEx + acpCapEx + pcEx), efficiency: gfa ? r3(internal / gfa) : null, warn,
    W: xs.length ? Math.max(...xs) - Math.min(...xs) : 0, D: ys.length ? Math.max(...ys) - Math.min(...ys) : 0,
    box: xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, 0, 0],
  };
}
function touches(r, x) {
  const ax = n(r.x), ay = n(r.y), bx = ax + n(r.w), by = ay + n(r.h), cx = n(x.x), cy = n(x.y), dx = cx + n(x.w), dy = cy + n(x.h);
  const ovx = Math.min(bx, dx) - Math.max(ax, cx), ovy = Math.min(by, dy) - Math.max(ay, cy);
  return (ovx > 0.3 && Math.abs(ovy) < 0.05) || (ovy > 0.3 && Math.abs(ovx) < 0.05);
}

/* move the wall line at x = X (vertical) or y = Y (horizontal) by d: every
   room edge on it within the span moves, so the rooms stay tiled */
export function moveLine(u, axis, at, d, lo, hi, seed, exact) {
  // a drag: to the 50 mm grid; a figure typed (exact): to the half millimetre (a 75 mm partition's half is 37.5)
  const v = JSON.parse(JSON.stringify(u)), step = exact ? Math.round(d * 2000) / 2000 : Math.round(d * 20) / 20;
  if (!step) return v;
  const on = (a, b) => Math.abs(a - b) < 0.01;
  let inSpan = (a0, a1) => lo == null || (a1 > lo + 0.01 && a0 < hi - 0.01);
  // only the rooms of the dragged piece: the seed, and every room on the line whose side overlaps one already moving
  let only = null;
  if (seed && seed.length) {
    const onLine = v.rooms.filter((r) => (axis === "x" ? on(r.x, at) || on(r.x + r.w, at) : on(r.y, at) || on(r.y + r.h, at)));
    const span = (r) => (axis === "x" ? [r.y, r.y + r.h] : [r.x, r.x + r.w]);
    only = new Set(onLine.filter((r) => seed.includes(r.id)).map((r) => r.id));
    for (let grew = true; grew;) {
      grew = false;
      for (const r of onLine) {
        if (only.has(r.id)) continue;
        const [a0, a1] = span(r);
        if (onLine.some((q) => only.has(q.id) && Math.min(a1, span(q)[1]) - Math.max(a0, span(q)[0]) > 0.01)) { only.add(r.id); grew = true; }
      }
    }
    const spans = onLine.filter((r) => only.has(r.id)).map(span);
    inSpan = (a0, a1) => spans.some(([p, q]) => Math.min(a1, q) - Math.max(a0, p) > 0.01);
  }
  const started = new Set();   // the rooms whose start corner moves: their doors and windows along the other way keep their place
  for (const r of v.rooms) {
    if (only && !only.has(r.id)) continue;
    if (axis === "x" && inSpan(r.y, r.y + r.h)) {
      if (on(r.x, at)) { r.x += step; r.w -= step; started.add(r.id); }
      else if (on(r.x + r.w, at)) r.w += step;
    }
    if (axis === "y" && inSpan(r.x, r.x + r.w)) {
      if (on(r.y, at)) { r.y += step; r.h -= step; started.add(r.id); }
      else if (on(r.y + r.h, at)) r.h += step;
    }
  }
  for (const x of v.extras || []) {
    if (axis === "x" && on(x.x, at) && inSpan(x.y, x.y + x.h)) x.x += step;
    if (axis === "y" && on(x.y, at) && inSpan(x.x, x.x + x.w)) x.y += step;
  }
  if (v.rooms.some((r) => r.w < 0.5 || r.h < 0.5)) return u;
  // a door or window on a side along the moved line's other way is measured from the room's start: held where it stands
  // (kept on its side when the wall comes past it)
  const rm = new Map(v.rooms.map((r) => [r.id, r]));
  for (const o of [...(v.doors || []), ...(v.windows || [])]) {
    if (!started.has(o.room)) continue;
    const r = rm.get(o.room), along = axis === "x" ? o.side === "n" || o.side === "s" : o.side === "e" || o.side === "w";
    if (!along) continue;
    const len = axis === "x" ? r.w : r.h, w = n(o.w || 0.8);
    o.at = +Math.max(0, Math.min(Math.max(0, len - w), n(o.at) - step)).toFixed(3);
  }
  for (const r of v.rooms) for (const k of ["x", "y", "w", "h"]) r[k] = +r[k].toFixed(3);
  return v;
}

/* scale a plan so that its saleable area is `ft2` (for the templates) */
export function scaleTo(u, ft2) {
  let lo = 0.6, hi = 1.6;
  const at = (k) => {
    const v = JSON.parse(JSON.stringify(u));
    const sx = (x) => Math.round(x * k * 20) / 20;
    v.rooms = u.rooms.map((r) => (isPoly(r) ? setPts({ ...r }, r.pts.map(([x, y]) => [sx(x), sx(y)])) : { ...r, x: sx(r.x), y: sx(r.y), w: +(sx(r.x + r.w) - sx(r.x)).toFixed(3), h: +(sx(r.y + r.h) - sx(r.y)).toFixed(3) }));
    v.extras = (u.extras || []).map((e) => ({ ...e, x: sx(e.x), y: sx(e.y) }));
    if (u.zones) v.zones = u.zones.map((z) => ({ ...z, x: sx(z.x), y: sx(z.y), w: +(sx(z.x + z.w) - sx(z.x)).toFixed(3), h: +(sx(z.y + z.h) - sx(z.y)).toFixed(3) }));
    return v;
  };
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (figures(at(m)).saleableFt < ft2) lo = m; else hi = m; }
  return at((lo + hi) / 2);
}

/* a combined bay (BAL / UP / ACP in one outline) as its parts, each a
   rectangle along the bay's long side, the splay on the last part */
export function expandBays(extras) {
  const out = [];
  for (const e of extras || []) {
    if (e.kind !== "bay") { out.push(e); continue; }
    const vert = n(e.h) >= n(e.w);
    let at = 0;
    const parts = e.parts || [];
    parts.forEach((p, i) => {
      const L = n(p.len);
      const r = vert ? { x: n(e.x), y: n(e.y) + at, w: n(e.w), h: L } : { x: n(e.x) + at, y: n(e.y), w: L, h: n(e.h) };
      out.push(Object.assign({ kind: p.kind, dfs: !!p.dfs, splay: i === parts.length - 1 ? n(e.splay) : 0, bay: true }, r));
      at += L;
    });
  }
  return out;
}

/* split a room in two with a new partition: axis "x" a vertical wall at x = at
   from the room's left, "y" a horizontal one */
export function splitRoom(u, id, axis, at) {
  const v = JSON.parse(JSON.stringify(u)), i = v.rooms.findIndex((r) => r.id === id);
  if (i < 0) return u;
  const r = v.rooms[i], a = Math.round(at * 20) / 20;
  const span = axis === "x" ? r.w : r.h;
  if (a < 0.5 || a > span - 0.5) return u;
  const id2 = id + "s" + Date.now().toString(36).slice(-3);
  const r2 = Object.assign({}, r, { id: id2, name: (r.name || "") + " 2" });
  if (axis === "x") { r2.x = +(r.x + a).toFixed(3); r2.w = +(r.w - a).toFixed(3); r.w = a; }
  else { r2.y = +(r.y + a).toFixed(3); r2.h = +(r.h - a).toFixed(3); r.h = a; }
  v.rooms.splice(i + 1, 0, r2);
  return v;
}
/* join two rooms that together make a rectangle (the wall between goes) */
export function joinRooms(u, a, b) {
  const v = JSON.parse(JSON.stringify(u)), A = v.rooms.find((r) => r.id === a), B = v.rooms.find((r) => r.id === b);
  if (!A || !B) return null;
  const eq = (p, q) => Math.abs(p - q) < 0.01;
  let R = null;
  if (eq(A.y, B.y) && eq(A.h, B.h) && (eq(A.x + A.w, B.x) || eq(B.x + B.w, A.x))) R = { x: Math.min(A.x, B.x), y: A.y, w: A.w + B.w, h: A.h };
  if (eq(A.x, B.x) && eq(A.w, B.w) && (eq(A.y + A.h, B.y) || eq(B.y + B.h, A.y))) R = { x: A.x, y: Math.min(A.y, B.y), w: A.w, h: A.h + B.h };
  if (!R) return null;
  Object.assign(A, R);
  v.rooms = v.rooms.filter((r) => r.id !== b);
  for (const d of v.doors || []) if (d.room === b) d.room = a;
  for (const w of v.windows || []) if (w.room === b) w.room = a;
  return v;
}

/* add a room: a rectangle {x, y, w, h} on the 50 mm grid; null when it
   overlaps a room already there or is under 0.6 m either way */
export function addRoom(u, rect, kind = "BR", name) {
  const q = (a) => Math.round(a * 20) / 20;
  const R = { x: q(rect.x), y: q(rect.y), w: q(rect.w), h: q(rect.h) };
  if (R.w < 0.6 || R.h < 0.6) return null;
  for (const r of u.rooms || []) {
    const ox = Math.min(R.x + R.w, n(r.x) + n(r.w)) - Math.max(R.x, n(r.x));
    const oy = Math.min(R.y + R.h, n(r.y) + n(r.h)) - Math.max(R.y, n(r.y));
    if (ox > 0.01 && oy > 0.01) return null;
  }
  const v = JSON.parse(JSON.stringify(u));
  let i = 1; const ids = new Set(v.rooms.map((r) => r.id));
  while (ids.has("n" + i)) i++;
  v.rooms.push(Object.assign({ id: "n" + i, kind, name: name || (KINDS[kind] || {}).label || kind }, R));
  return v;
}

/* the unit mirrored left to right (a handed unit: the same layout, flipped) */
export function mirrorUnit(u) {
  const v = JSON.parse(JSON.stringify(u));
  const xs = [...(v.rooms || []).flatMap((r) => [n(r.x), n(r.x) + n(r.w)]), ...(v.extras || []).flatMap((e) => [n(e.x), n(e.x) + n(e.w)])];
  const S = Math.min(...xs) + Math.max(...xs), fx = (o) => { o.x = +(S - n(o.x) - n(o.w)).toFixed(3); };
  // a polygon room: its points flipped and their order reversed (edge i becomes edge N - 2 - i, run the other way)
  const PN = new Map();
  for (const r of v.rooms || []) if (isPoly(r)) { PN.set(r.id, { N: r.pts.length, lens: r.pts.map((_, i) => edgeOf(r, i).len) }); r.pts = r.pts.map(([x, y]) => [r4(S - x), y]).reverse(); }
  for (const o of [...(v.doors || []), ...(v.windows || [])]) {
    const pn = PN.get(o.room); if (!pn || o.edge == null) continue;
    const L = pn.lens[o.edge] || 0, k = ((pn.N - 2 - o.edge) % pn.N + pn.N) % pn.N;
    o.edge = k; o.at = r4(L - n(o.at) - n(o.w || 0.8)); o._pm = 1;
  }
  if (v.walls) {
    const w2 = {};
    for (const [k, o] of Object.entries(v.walls)) {
      const c = k.lastIndexOf(":e"), id = c > 0 ? k.slice(0, c) : null, pn = id && PN.get(id), i = pn ? Number(k.slice(c + 2)) : NaN;
      if (pn && Number.isInteger(i)) w2[id + ":e" + (((pn.N - 2 - i) % pn.N) + pn.N) % pn.N] = o; else w2[k] = o;
    }
    v.walls = w2;
  }
  const ew = { e: "w", w: "e", n: "n", s: "s" };
  const rooms = new Map((v.rooms || []).map((r) => [r.id, r]));
  for (const o of [...(v.doors || []), ...(v.windows || [])]) {
    const r = rooms.get(o.room); if (!r) continue;
    if (o._pm) { delete o._pm; if ("hinge" in o || o.swing) o.hinge = o.hinge === "end" ? "start" : "end"; continue; }
    if (o.side === "n" || o.side === "s") o.at = +(n(r.w) - n(o.at) - n(o.w || 0.8)).toFixed(3);
    else o.side = ew[o.side];
    if ("hinge" in o || o.swing) o.hinge = o.hinge === "end" ? "start" : "end";
  }
  for (const r of v.rooms || []) fx(r);
  for (const e of v.extras || []) { fx(e); if (e.splay) e.splayL = !e.splayL; }
  for (const x of v.fixtures || []) { fx(x); if (x.rot === 90) x.rot = 270; else if (x.rot === 270) x.rot = 90; }
  for (const z of v.zones || []) fx(z);
  v.partySides = (v.partySides || []).map((s) => ew[s]);
  if (v.facade) v.facade = ew[v.facade];
  if (v.walls) {
    const w2 = {};
    for (const [k, o] of Object.entries(v.walls)) { const m = /^(.*):([nsew])$/.exec(k); w2[m ? m[1] + ":" + ew[m[2]] : k] = o; }
    v.walls = w2;
  }
  v.name = /\(mirrored\)$/.test(v.name || "") ? v.name.replace(/ \(mirrored\)$/, "") : (v.name || "Unit") + " (mirrored)";
  return v;
}

/* the fittings a room of each kind gets at first: bath / shower, WC, basin;
   kitchen counter with sink and hob; [{kind, x, y, w, h, rot}] */
export function genFixtures(u) {
  const out = [];
  for (const r of u.rooms || []) {
    if (isPoly(r)) continue;
    const x = n(r.x), y = n(r.y), w = n(r.w), h = n(r.h), long = w >= h;
    if (r.kind === "BATH" || r.kind === "ENS") {
      if (Math.max(w, h) >= 2.0) out.push(long ? { kind: "bath", x: x + 0.1, y: y + 0.1, w: 1.5, h: 0.7, rot: 0 } : { kind: "bath", x: x + 0.1, y: y + 0.1, w: 0.7, h: 1.5, rot: 0 });
      else out.push({ kind: "shower", x: x + 0.1, y: y + 0.1, w: 0.9, h: 0.9, rot: 0 });
      out.push({ kind: "wc", x: x + w - 0.55, y: y + h - 0.75, w: 0.4, h: 0.65, rot: 0 });
      out.push({ kind: "basin", x: x + w - 0.6, y: y + 0.1, w: 0.5, h: 0.4, rot: 0 });
    }
    if (r.kind === "OKIT" || r.kind === "KIT")
      out.push(long ? { kind: "counter", x: x + 0.05, y: y + 0.05, w: Math.max(1, w - 0.1), h: 0.6, rot: 0 } : { kind: "counter", x: x + 0.05, y: y + 0.05, w: 0.6, h: Math.max(1, h - 0.1), rot: 0 });
    // furniture, for the sales-plan look: a bed and wardrobe in a bedroom, a sofa and dining set in the living room
    if ((r.kind === "MBR" || r.kind === "BR") && w >= 1.8 && h >= 1.8) {
      const bw = r.kind === "MBR" ? 1.5 : 0.9, bl = 1.9;
      if (long) { out.push({ kind: "bed", x: x + 0.1, y: y + Math.max(0.1, (h - bw) / 2), w: bl, h: bw, rot: 270 }); if (w - bl > 0.8) out.push({ kind: "wardrobe", x: x + w - 0.65, y: y + 0.1, w: 0.6, h: Math.min(1.5, h - 0.2), rot: 90 }); }
      else { out.push({ kind: "bed", x: x + Math.max(0.1, (w - bw) / 2), y: y + 0.1, w: bw, h: bl, rot: 0 }); if (h - bl > 0.8) out.push({ kind: "wardrobe", x: x + 0.1, y: y + h - 0.65, w: Math.min(1.5, w - 0.2), h: 0.6, rot: 0 }); }
    }
    if (r.kind === "LD" && !r.space && w >= 2.2 && h >= 2.2) {
      if (long) { out.push({ kind: "sofa", x: x + 0.15, y: y + h - 0.95, w: Math.min(2.0, w * 0.5), h: 0.85, rot: 180 }); out.push({ kind: "dining", x: x + w - 1.45, y: y + 0.35, w: 1.2, h: 0.8, rot: 0 }); }
      else { out.push({ kind: "sofa", x: x + w - 0.95, y: y + h - 2.15, w: 0.85, h: Math.min(2.0, h * 0.45), rot: 90 }); out.push({ kind: "dining", x: x + 0.3, y: y + 0.4, w: 0.8, h: 1.2, rot: 90 }); }
    }
  }
  // an open kitchen drawn as a zone: its counter with sink and hob along its longer side
  for (const z of u.zones || []) {
    if (z.kind !== "OKIT" && z.kind !== "KIT") continue;
    const x = n(z.x), y = n(z.y), w = n(z.w), h = n(z.h);
    out.push(w >= h ? { kind: "counter", x: x + 0.05, y: y + 0.05, w: Math.max(1, w - 0.1), h: 0.6, rot: 0 } : { kind: "counter", x: x + 0.05, y: y + 0.05, w: 0.6, h: Math.max(1, h - 0.1), rot: 0 });
  }
  return out;
}
/* rotate a fitting 90° about its centre */
export function rotateFixture(f) {
  const cx = n(f.x) + n(f.w) / 2, cy = n(f.y) + n(f.h) / 2;
  return Object.assign({}, f, { w: n(f.h), h: n(f.w), x: +(cx - n(f.h) / 2).toFixed(3), y: +(cy - n(f.w) / 2).toFixed(3), rot: ((n(f.rot) + 90) % 360) });
}
/* windows on each habitable room's façade wall, at first */
export function genWindows(u) {
  const E = edges(u), out = [];
  for (const r of u.rooms || []) {
    const k = KINDS[r.kind]; if (!k || !k.hab) continue;
    const e = E.find((q) => q.kind === "ext" && q.a === r.id && q.face === (u.facade || "s")) || E.find((q) => q.kind === "ext" && q.a === r.id && q.len >= 1.2 && !(u.partySides || []).includes(q.face));
    if (!e) continue;
    const side = { n: "n", s: "s", e: "e", w: "w" }[e.face], L = side === "n" || side === "s" ? n(r.w) : n(r.h);
    const ww = Math.min(1.8, Math.max(0.6, e.len - 0.6));
    const start = side === "n" || side === "s" ? Math.min(e.x1, e.x2) - n(r.x) : Math.min(e.y1, e.y2) - n(r.y);
    out.push({ room: r.id, side, at: +Math.max(0, Math.min(L - ww, start + (e.len - ww) / 2)).toFixed(2), w: +ww.toFixed(2) });
  }
  return out;
}

/* an external wall's thickness: its own, else its façade's, else the unit's */
export function extWallT(u, e) {
  if (e.t != null) return e.t;
  const f = ((u.walls || {})[e.key] || {}).f || u.facadeType || "rc";
  return FACADES[f] && FACADES[f].t != null ? FACADES[f].t : n(u.wall, 0.15);
}
/* the balcony, UP and A/C platform from the external wall's outer face, not its centre line: those made before moved out by
   half the wall, once (u.xFace); their areas as they were */
const rr3 = (x) => Math.round(x * 1000) / 1000;
export function extrasToFace(u) {
  if (u.xFace) return false;
  const E = edges(u).filter((e) => (e.kind === "ext" || e.kind === "party") && !e.angled);
  let moved = false;
  for (const x of u.extras || []) {
    const X0 = n(x.x), Y0 = n(x.y), X1 = X0 + n(x.w), Y1 = Y0 + n(x.h);
    for (const e of E) {
      const t = e.kind === "ext" ? extWallT(u, e) : n(u.party, 0.15), v = e.x1 === e.x2;
      const lo = v ? e.y1 : e.x1, hi = v ? e.y2 : e.x2, a = v ? Y0 : X0, b = v ? Y1 : X1;
      if (Math.min(hi, b) - Math.max(lo, a) < 0.05) continue;
      // its inner edge on the wall's centre line, or off it by up to a wall (a template drawn for a thicker wall): onto the outer face
      const near = (d) => d > -EPS && d < Math.max(t, 0.2) + EPS;
      if (v && e.face === "e" && near(X0 - e.x1)) { x.x = rr3(e.x1 + t / 2); moved = true; break; }
      if (v && e.face === "w" && near(e.x1 - X1)) { x.x = rr3(e.x1 - t / 2 - n(x.w)); moved = true; break; }
      if (!v && e.face === "s" && near(Y0 - e.y1)) { x.y = rr3(e.y1 + t / 2); moved = true; break; }
      if (!v && e.face === "n" && near(e.y1 - Y1)) { x.y = rr3(e.y1 - t / 2 - n(x.h)); moved = true; break; }
    }
  }
  u.xFace = 1;
  return moved;
}

/* a wall's thickness, as the plan draws it */
export const tOfU = (u, e) => { const wall = +(u.wall ?? 0.15), pt = +(u.part ?? 0.075), party = +(u.party ?? 0.15); return e.t != null ? e.t : e.kind === "ext" ? (FACADES[e.facade] && FACADES[e.facade].t != null ? FACADES[e.facade].t : wall) : e.kind === "party" ? party : pt; };
/* where a door on a room's side may stand flush with a wall meeting that side (the room's own corners, a partition
   on either side of it): its start just past a wall's face, or its end just short of one -> the "at" values (from the
   room's edge line), each {at, end: "start" | "end"} */
export function doorStops(u, d, nib) {
  const r = (u.rooms || []).find((q) => q.id === d.room); if (!r) return [];
  const f = figures(u), w = +d.w || 0.8, nb = nib != null ? nib : +(u.doorNib || 0), out = [];
  if (d.edge != null && isPoly(r)) {
    // the walls meeting the edge (an end on its line, across it): each face's place along the edge, through its angle
    const E = edgeOf(r, d.edge);
    for (const e of f.edges) {
      for (const [P, Q] of [[[e.x1, e.y1], [e.x2, e.y2]], [[e.x2, e.y2], [e.x1, e.y1]]]) {
        const off = (P[0] - E.p[0]) * E.nrm[0] + (P[1] - E.p[1]) * E.nrm[1]; if (Math.abs(off) > 1e-3) continue;
        const s = (P[0] - E.p[0]) * E.d[0] + (P[1] - E.p[1]) * E.d[1]; if (s < -1e-3 || s > E.len + 1e-3) continue;
        const L = Math.hypot(Q[0] - P[0], Q[1] - P[1]) || 1, sn = Math.abs(((Q[0] - P[0]) * E.nrm[0] + (Q[1] - P[1]) * E.nrm[1]) / L);
        if (sn < 0.3) continue;                            // along the edge: not across it
        const half = tOfU(u, e) / 2 / sn;
        out.push({ at: +(s + half + nb).toFixed(3), end: "start" }, { at: +(s - half - nb - w).toFixed(3), end: "end" });
      }
    }
    return out.filter((q) => q.at >= -1e-6 && q.at <= E.len - w + 1e-6);
  }
  const horiz = d.side === "n" || d.side === "s", line = d.side === "n" ? r.y : d.side === "s" ? r.y + r.h : d.side === "w" ? r.x : r.x + r.w;
  const s0 = horiz ? r.x : r.y, L = horiz ? r.w : r.h;
  for (const e of f.edges) {
    const v = Math.abs(e.x1 - e.x2) < 1e-6;
    if (v !== horiz) continue;                         // a wall square to the side
    const p = horiz ? e.x1 : e.y1, a = horiz ? Math.min(e.y1, e.y2) : Math.min(e.x1, e.x2), b = horiz ? Math.max(e.y1, e.y2) : Math.max(e.x1, e.x2);
    if (p < s0 - 1e-6 || p > s0 + L + 1e-6 || line < a - 1e-6 || line > b + 1e-6) continue;
    const t = tOfU(u, e), rel = p - s0;
    out.push({ at: +(rel + t / 2 + nb).toFixed(3), end: "start" }, { at: +(rel - t / 2 - nb - w).toFixed(3), end: "end" });
  }
  return out.filter((q) => q.at >= -1e-6 && q.at <= L - w + 1e-6);
}
/* a door's place along its side snapped to a wall's face near it (within tol), else null */
export function snapDoorAt(u, d, at, tol = 0.15) {
  let best = null;
  for (const q of doorStops(u, d)) if (Math.abs(q.at - at) <= tol && (!best || Math.abs(q.at - at) < Math.abs(best.at - at))) best = q;
  return best ? best.at : null;
}

/* ---------- polygon rooms ----------
   a room may be a polygon: pts [[x, y], ...] in plan metres, in the rectangle's order (y down: positive shoelace area,
   the outward normal of an edge p -> q is (dy, -dx)); x, y, w, h stay its bounding box. A room without pts is the
   rectangle it always was. A door or window on a polygon room is {room, edge: i, at, w}: at metres from the edge's
   start (pts[i]) towards pts[i + 1]. */
export const isPoly = (r) => !!(r && Array.isArray(r.pts) && r.pts.length >= 3);
export const hasPoly = (u) => !!(u && (u.rooms || []).some(isPoly));
export function ptsOf(r) {
  if (isPoly(r)) return r.pts.map(([x, y]) => [n(x), n(y)]);
  const x = n(r.x), y = n(r.y), w = n(r.w), h = n(r.h);
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}
export function polyArea(p) { let s = 0; for (let k = 0; k < p.length; k++) { const a = p[k], b = p[(k + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
export function polyCentroid(p) {
  let a = 0, cx = 0, cy = 0;
  for (let k = 0; k < p.length; k++) { const P = p[k], Q = p[(k + 1) % p.length], c = P[0] * Q[1] - Q[0] * P[1]; a += c; cx += (P[0] + Q[0]) * c; cy += (P[1] + Q[1]) * c; }
  if (Math.abs(a) < 1e-12) return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
  return [cx / (3 * a), cy / (3 * a)];
}
export const roomArea = (r) => (isPoly(r) ? Math.abs(polyArea(ptsOf(r))) : n(r.w) * n(r.h));
/* the least width across a room: the narrowest of its hull's widths (each hull edge to its farthest point) */
export function minWidth(p) {
  const H = hull(p); if (H.length < 3) return 0;
  let best = Infinity;
  for (let k = 0; k < H.length; k++) {
    const a = H[k], b = H[(k + 1) % H.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-9) continue;
    let far = 0; for (const q of H) far = Math.max(far, Math.abs((q[0] - a[0]) * (b[1] - a[1]) - (q[1] - a[1]) * (b[0] - a[0])) / L);
    best = Math.min(best, far);
  }
  return isFinite(best) ? best : 0;
}
function hull(p) {
  const P = p.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (P.length < 3) return P;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const q of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of P.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
const r4 = (v) => +(+v).toFixed(4);
/* a room's polygon set: tidied (no repeated or straight-on points), turned to the rectangle's order, its box kept */
export function setPts(r, pts0) {
  let p = pts0.map(([x, y]) => [r4(x), r4(y)]).filter((q, k, a) => k === 0 || Math.hypot(q[0] - a[k - 1][0], q[1] - a[k - 1][1]) > 1e-4);
  if (p.length > 1 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 1e-4) p.pop();
  if (polyArea(p) < 0) p.reverse();
  r.pts = p;
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  r.x = r4(Math.min(...xs)); r.y = r4(Math.min(...ys)); r.w = r4(Math.max(...xs) - r.x); r.h = r4(Math.max(...ys) - r.y);
  return r;
}
/* edge i of a room: {p, q, len, d (along), nrm (outward)} */
export function edgeOf(r, i) {
  const P = ptsOf(r), k = ((i % P.length) + P.length) % P.length, p = P[k], q = P[(k + 1) % P.length];
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1e-9, d = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
  return { p, q, len, d, nrm: [d[1], -d[0]], i: k };
}
/* a door or window's two ends in plan metres and the normal into its room: [a, b, inward] */
export function openSeg(r, o, w0) {
  const at = n(o.at), w = n(o.w, w0 || 0.8);
  if (o.edge != null && isPoly(r)) { const E = edgeOf(r, o.edge); return [[E.p[0] + E.d[0] * at, E.p[1] + E.d[1] * at], [E.p[0] + E.d[0] * (at + w), E.p[1] + E.d[1] * (at + w)], [-E.nrm[0], -E.nrm[1]]]; }
  const side = o.side;
  if (side === "n") return [[r.x + at, r.y], [r.x + at + w, r.y], [0, 1]];
  if (side === "s") return [[r.x + at, r.y + r.h], [r.x + at + w, r.y + r.h], [0, -1]];
  if (side === "w") return [[r.x, r.y + at], [r.x, r.y + at + w], [1, 0]];
  return [[r.x + r.w, r.y + at], [r.x + r.w, r.y + at + w], [-1, 0]];
}
/* a rectangle room made a polygon: its doors and windows put on its edges (n 0, e 1, s 2, w 3; s and w run backwards) */
export function toPoly(u, rid) {
  const r = (u.rooms || []).find((q) => q.id === rid); if (!r || isPoly(r)) return u;
  const w = n(r.w), h = n(r.h);
  for (const o of [...(u.doors || []), ...(u.windows || [])]) {
    if (o.room !== rid || o.edge != null) continue;
    const ow = n(o.w, 0.8), at = n(o.at);
    if (o.side === "n") { o.edge = 0; o.at = r4(at); }
    else if (o.side === "e") { o.edge = 1; o.at = r4(at); }
    else if (o.side === "s") { o.edge = 2; o.at = r4(w - at - ow); flipHinge(o); }
    else if (o.side === "w") { o.edge = 3; o.at = r4(h - at - ow); flipHinge(o); }
    delete o.side;
  }
  const W = u.walls || {};
  const map = { n: 0, e: 1, s: 2, w: 3 };
  for (const k of Object.keys(W)) { const m = /^(.*):([nsew])$/.exec(k); if (m && m[1] === rid) { W[rid + ":e" + map[m[2]]] = W[k]; } }
  setPts(r, ptsOf(r));
  return u;
}
function flipHinge(o) { if ("hinge" in o || o.swing) o.hinge = o.hinge === "end" ? "start" : "end"; }
const near2 = (a, b, tol = 1e-3) => Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol;
/* every room's corners at point P (within 1 mm) moved to Q - so the rooms meeting there still meet. A rectangle room
   whose corner moves becomes a polygon unless it stays a rectangle. -> a new unit, or null when a room would fold */
export function moveVertex(u, P, Q) { return moveVertices(u, [[P, Q]]); }
export function moveVertices(u, moves) {
  const v = JSON.parse(JSON.stringify(u));
  for (const r of v.rooms || []) {
    const pts = ptsOf(r);
    let hit = false;
    const out = pts.map((q) => { const m = moves.find(([P]) => near2(q, P)); if (m) { hit = true; return [m[1][0], m[1][1]]; } return q; });
    if (!hit) continue;
    if (polyArea(out) <= 0.05 || selfCrosses(out)) return null;
    const rect = out.length === 4 && !isPoly(r) && isAxisRect(out);
    if (rect) { const xs = out.map((q) => q[0]), ys = out.map((q) => q[1]); const x0 = Math.min(...xs), y0 = Math.min(...ys); shiftRectOpenings(v, r, x0, y0); r.x = r4(x0); r.y = r4(y0); r.w = r4(Math.max(...xs) - x0); r.h = r4(Math.max(...ys) - y0); continue; }
    if (!isPoly(r)) toPoly(v, r.id);
    // keep the order of the points (the edges' numbers: the doors on them)
    r.pts = out.map(([x, y]) => [r4(x), r4(y)]);
    const xs = r.pts.map((q) => q[0]), ys = r.pts.map((q) => q[1]);
    r.x = r4(Math.min(...xs)); r.y = r4(Math.min(...ys)); r.w = r4(Math.max(...xs) - r.x); r.h = r4(Math.max(...ys) - r.y);
  }
  return v;
}
function isAxisRect(p) {
  const xs = [...new Set(p.map((q) => r4(q[0])))], ys = [...new Set(p.map((q) => r4(q[1])))];
  return xs.length === 2 && ys.length === 2 && p.every((q, k) => { const a = p[(k + 1) % 4]; return Math.abs(a[0] - q[0]) < 1e-6 || Math.abs(a[1] - q[1]) < 1e-6; });
}
/* a rectangle's start corner moved: its doors and windows on the sides along that way keep their place in plan */
function shiftRectOpenings(v, r, x0, y0) {
  const dx = x0 - n(r.x), dy = y0 - n(r.y);
  for (const o of [...(v.doors || []), ...(v.windows || [])]) {
    if (o.room !== r.id || o.edge != null) continue;
    if ((o.side === "n" || o.side === "s") && dx) o.at = r4(Math.max(0, n(o.at) - dx));
    if ((o.side === "e" || o.side === "w") && dy) o.at = r4(Math.max(0, n(o.at) - dy));
  }
}
export function selfCrosses(p) {
  const N = p.length, X = (a, b, c, d) => { const o = (P, Q, R) => (Q[0] - P[0]) * (R[1] - P[1]) - (Q[1] - P[1]) * (R[0] - P[0]); const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b); return d1 * d2 < -1e-12 && d3 * d4 < -1e-12; };
  for (let i = 0; i < N; i++) for (let j = i + 2; j < N; j++) { if (i === 0 && j === N - 1) continue; if (X(p[i], p[(i + 1) % N], p[j], p[(j + 1) % N])) return true; }
  return false;
}
/* a corner added on edge i of room rid at point P (on it): on the room, and on the room across that edge (its edge there
   too), so the two still meet when the corner moves; the doors on the edges after it renumbered */
export function insertVertex(u, rid, i, P) {
  let v = JSON.parse(JSON.stringify(u));
  const r = v.rooms.find((q) => q.id === rid); if (!r) return u;
  const add = (room, k) => {
    if (!isPoly(room)) toPoly(v, room.id);
    const E = edgeOf(room, k), s = (P[0] - E.p[0]) * E.d[0] + (P[1] - E.p[1]) * E.d[1];
    if (s < 0.05 || s > E.len - 0.05) return false;
    room.pts.splice(E.i + 1, 0, [r4(P[0]), r4(P[1])]);
    for (const o of [...(v.doors || []), ...(v.windows || [])]) {
      if (o.room !== room.id || o.edge == null) continue;
      if (o.edge > E.i) o.edge++;
      else if (o.edge === E.i && n(o.at) >= s - 1e-6) { o.edge++; o.at = r4(n(o.at) - s); }
    }
    return true;
  };
  if (!add(r, i)) return u;
  // the room across: an edge through P running the other way
  for (const q of v.rooms) {
    if (q.id === rid) continue;
    const Q = ptsOf(q);
    for (let k = 0; k < Q.length; k++) {
      const a = Q[k], b = Q[(k + 1) % Q.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
      const cr = ((P[0] - a[0]) * (b[1] - a[1]) - (P[1] - a[1]) * (b[0] - a[0])) / L, t = ((P[0] - a[0]) * (b[0] - a[0]) + (P[1] - a[1]) * (b[1] - a[1])) / L;
      if (Math.abs(cr) < 1e-3 && t > 1e-3 && t < L - 1e-3) { add(q, k); break; }
    }
  }
  return v;
}
/* corner i of a room taken out (at least 3 left); the doors on its two edges onto the one edge */
export function removeVertex(u, rid, i) {
  const v = JSON.parse(JSON.stringify(u)), r = v.rooms.find((q) => q.id === rid); if (!r) return u;
  if (!isPoly(r)) toPoly(v, rid);
  const N = r.pts.length; if (N <= 3) return u;
  const k = ((i % N) + N) % N, prev = (k - 1 + N) % N, Lp = edgeOf(r, prev).len;
  const pts = r.pts.filter((_, j) => j !== k);
  if (polyArea(pts) <= 0.05 || selfCrosses(pts)) return u;
  for (const o of [...(v.doors || []), ...(v.windows || [])]) {
    if (o.room !== rid || o.edge == null) continue;
    if (o.edge === k) { o.edge = prev; o.at = r4(n(o.at) + Lp); }
    if (o.edge > k) o.edge--;
    if (k === 0 && o.edge === N - 1) o.edge = N - 2;
  }
  r.pts = pts;
  setBox(r);
  return v;
}
function setBox(r) { const xs = r.pts.map((q) => q[0]), ys = r.pts.map((q) => q[1]); r.x = r4(Math.min(...xs)); r.y = r4(Math.min(...ys)); r.w = r4(Math.max(...xs) - r.x); r.h = r4(Math.max(...ys) - r.y); }
/* edge i of a room moved out along its normal by d: its ends slide along the edges before and after it (they keep their
   angle), the rooms meeting at those corners with them */
export function moveEdge(u, rid, i, d, exact) {
  const r = (u.rooms || []).find((q) => q.id === rid); if (!r) return u;
  const step = exact ? Math.round(d * 2000) / 2000 : Math.round(d * 200) / 200; if (!step) return u;
  const P = ptsOf(r), N = P.length, k = ((i % N) + N) % N, E = edgeOf(r, k);
  const off = (p) => [p[0] + E.nrm[0] * step, p[1] + E.nrm[1] * step];
  const slide = (corner, other) => {   // where the moved line meets the line through corner and other
    const a = off(E.p), dir = E.d, b = corner, e2 = [other[0] - corner[0], other[1] - corner[1]];
    const den = dir[0] * e2[1] - dir[1] * e2[0];
    if (Math.abs(den) < 1e-9) return off(corner);
    const t = ((b[0] - a[0]) * e2[1] - (b[1] - a[1]) * e2[0]) / den;
    return [a[0] + dir[0] * t, a[1] + dir[1] * t];
  };
  const p0 = P[k], p1 = P[(k + 1) % N];
  const n0 = slide(p0, P[(k - 1 + N) % N]), n1 = slide(p1, P[(k + 2) % N]);
  // the other rooms' corners along the edge (a room beside part of it) move straight out with it
  const moves = [[p0, n0], [p1, n1]];
  for (const q of u.rooms || []) for (const c of ptsOf(q)) {
    const s2 = (c[0] - p0[0]) * E.d[0] + (c[1] - p0[1]) * E.d[1], o = (c[0] - p0[0]) * E.nrm[0] + (c[1] - p0[1]) * E.nrm[1];
    if (Math.abs(o) < 1e-3 && s2 > 1e-3 && s2 < E.len - 1e-3 && !moves.some(([A]) => near2(A, c))) moves.push([c, off(c)]);
  }
  return moveVertices(u, moves) || u;
}
/* edge i of a room to length L: its far end moved along it */
export function setEdgeLen(u, rid, i, L) {
  const r = (u.rooms || []).find((q) => q.id === rid); if (!r || !(L > 0.1)) return u;
  const E = edgeOf(r, i);
  return moveVertex(u, E.q, [E.p[0] + E.d[0] * L, E.p[1] + E.d[1] * L]) || u;
}
/* a polygon room drawn: added when it overlaps no room (by more than a sliver) */
export function addPolyRoom(u, pts, kind = "BR", name) {
  const v = JSON.parse(JSON.stringify(u)), R = setPts({}, pts);
  if (R.pts.length < 3 || polyArea(R.pts) < 0.36 || selfCrosses(R.pts)) return null;
  for (const r of v.rooms || []) if (overlapArea(ptsOf(r), R.pts) > 0.02) return null;
  let i = 1; const ids = new Set(v.rooms.map((r) => r.id)); while (ids.has("n" + i)) i++;
  v.rooms.push(Object.assign({ id: "n" + i, kind, name: name || (KINDS[kind] || {}).label || kind }, R));
  return v;
}
/* the area two polygons share: one clipped by the other's convex pieces (the clipper triangulated by its fan when convex,
   else by ear clipping) */
export function overlapArea(A, B) {
  let s = 0;
  for (const tri of convexParts(B)) { const c = clipConvex(A, tri); if (c.length >= 3) s += Math.abs(polyArea(c)); }
  return s;
}
export function convexParts(p) {
  const q = polyArea(p) < 0 ? p.slice().reverse() : p.slice();
  if (isConvex(q)) return [q];
  const out = [], idx = q.map((_, k) => k);
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let guard = 0;
  while (idx.length > 3 && guard++ < 500) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const a = q[idx[(k - 1 + idx.length) % idx.length]], b = q[idx[k]], c = q[idx[(k + 1) % idx.length]];
      if (cr(a, b, c) <= 1e-12) continue;
      if (idx.some((j) => { const P = q[j]; if (P === a || P === b || P === c) return false; return cr(a, b, P) > 0 && cr(b, c, P) > 0 && cr(c, a, P) > 0; })) continue;
      out.push([a, b, c]); idx.splice(k, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx.map((j) => q[j]));
  return out;
}
function isConvex(p) { let sg = 0; for (let k = 0; k < p.length; k++) { const a = p[k], b = p[(k + 1) % p.length], c = p[(k + 2) % p.length], z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); if (Math.abs(z) < 1e-12) continue; if (!sg) sg = Math.sign(z); else if (Math.sign(z) !== sg) return false; } return true; }
/* Sutherland-Hodgman: subject (any) clipped by a convex polygon (positive area) */
export function clipConvex(subj, clip) {
  let out = subj.slice();
  for (let k = 0; k < clip.length && out.length; k++) {
    const a = clip[k], b = clip[(k + 1) % clip.length], inside = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-12;
    const inp = out; out = [];
    for (let j = 0; j < inp.length; j++) {
      const P = inp[j], Q = inp[(j + 1) % inp.length], pi = inside(P), qi = inside(Q);
      if (pi) out.push(P);
      if (pi !== qi) { const d1 = (b[0] - a[0]) * (P[1] - a[1]) - (b[1] - a[1]) * (P[0] - a[0]), d2 = (b[0] - a[0]) * (Q[1] - a[1]) - (b[1] - a[1]) * (Q[0] - a[0]), t = d1 / (d1 - d2); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
    }
  }
  return out;
}

/* the edges of a unit with polygon rooms: each room's edges against every other's - where two run along each other the
   other way (within 1 mm) a partition, the rest outside walls; the same form as edges() for rectangles (an edge square
   to the axes keeps its face n / e / s / w and its key), an angled one keyed "room:e<i>", angled: true */
function polyEdges(u) {
  const rooms = u.rooms || [], party = new Set(u.partySides || []), out = [], TOL = 1e-3;
  const S = rooms.map((r) => { const P = ptsOf(r); return P.map((p, i) => { const q = P[(i + 1) % P.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); return L < 1e-6 ? null : { p, q, L, dx: (q[0] - p[0]) / L, dy: (q[1] - p[1]) / L, i }; }).filter(Boolean); });
  const faceOf = (nx, ny) => (Math.abs(ny) < 1e-9 ? (nx > 0 ? "e" : "w") : Math.abs(nx) < 1e-9 ? (ny > 0 ? "s" : "n") : "");
  const emit = (k, s, lo, hi, kind, j) => {
    const A = [s.p[0] + s.dx * lo, s.p[1] + s.dy * lo], B = [s.p[0] + s.dx * hi, s.p[1] + s.dy * hi];
    const nx = s.dy, ny = -s.dx, face = faceOf(nx, ny), axis = !!face;
    let x1 = A[0], y1 = A[1], x2 = B[0], y2 = B[1];
    if (axis && (x1 > x2 + 1e-9 || y1 > y2 + 1e-9)) [x1, y1, x2, y2] = [x2, y2, x1, y1];
    const e = { x1: r4(x1), y1: r4(y1), x2: r4(x2), y2: r4(y2), nx, ny, ei: s.i, ri: rooms[k].id };
    if (kind === "part") {
      // a = the room left of / above a square partition (as with rectangles); an angled one: the room it was found from
      let a = rooms[k].id, b = rooms[j].id;
      if (axis && (face === "w" || face === "n")) [a, b] = [b, a];
      Object.assign(e, { kind: "part", face: "", a, b, angled: !axis });
    } else Object.assign(e, { kind: face && party.has(face) ? "party" : "ext", face, a: rooms[k].id, b: null, angled: !axis });
    out.push(e);
  };
  for (let k = 0; k < rooms.length; k++) for (const s of S[k]) {
    const sh = [];
    for (let j = 0; j < rooms.length; j++) {
      if (j === k) continue;
      for (const t of S[j]) {
        if (s.dx * t.dx + s.dy * t.dy > -0.99999) continue;
        const d = (t.p[0] - s.p[0]) * s.dy - (t.p[1] - s.p[1]) * s.dx;
        if (Math.abs(d) > TOL) continue;
        const a = (t.q[0] - s.p[0]) * s.dx + (t.q[1] - s.p[1]) * s.dy, b = (t.p[0] - s.p[0]) * s.dx + (t.p[1] - s.p[1]) * s.dy;
        const lo = Math.max(0, Math.min(a, b)), hi = Math.min(s.L, Math.max(a, b));
        if (hi - lo > TOL) sh.push({ lo, hi, j });
      }
    }
    sh.sort((p, q) => p.lo - q.lo);
    for (const q of sh) if (k < q.j) emit(k, s, q.lo, q.hi, "part", q.j);
    let at = 0;
    for (const q of sh) { if (q.lo > at + TOL) emit(k, s, at, q.lo, "ext"); at = Math.max(at, q.hi); }
    if (s.L > at + TOL) emit(k, s, at, s.L, "ext");
  }
  const W = u.walls || {}, seen = new Map();
  return out.map((e) => {
    let key = e.kind === "part" ? [e.a, e.b].sort().join("|") : e.angled ? e.a + ":e" + e.ei : e.a + ":" + e.face;
    if (e.kind === "part" && e.angled) { const c = seen.get(key) || 0; seen.set(key, c + 1); if (c) key += "#" + c; }
    const o = W[key] || {};
    if (e.kind !== "part" && (o.kind === "ext" || o.kind === "party")) e.kind = o.kind;
    return Object.assign(e, { len: Math.hypot(e.x2 - e.x1, e.y2 - e.y1), key, t: o.t != null && o.t !== "" ? Number(o.t) : null, removed: !!o.open });
  });
}
/* the outline of a unit with polygon rooms: the outer edges, each along its room's boundary (outward normal (dy, -dx)),
   chained into rings, each moved out by its own offset, the corners where the moved lines meet */
function polyOutline(E, offOf) {
  const segs = [];
  for (const e of E) {
    if (e.kind === "part") continue;
    const nx = e.nx != null ? e.nx : e.face === "e" ? 1 : e.face === "w" ? -1 : 0, ny = e.ny != null ? e.ny : e.face === "s" ? 1 : e.face === "n" ? -1 : 0;
    const d = [-ny, nx];
    let p = [e.x1, e.y1], q = [e.x2, e.y2];
    if ((q[0] - p[0]) * d[0] + (q[1] - p[1]) * d[1] < 0) [p, q] = [q, p];
    segs.push({ p, q, nx, ny, off: offOf(e) });
  }
  const key = (pt) => pt[0].toFixed(3) + "," + pt[1].toFixed(3);
  const from = new Map();
  for (const sg of segs) { const k = key(sg.p); if (!from.has(k)) from.set(k, []); from.get(k).push(sg); }
  const used = new Set(), rings = [];
  for (const s0 of segs) {
    if (used.has(s0)) continue;
    const chain = [];
    let sg = s0, guard = 0;
    while (sg && !used.has(sg) && guard++ < 10000) {
      used.add(sg); chain.push(sg);
      const nx = (from.get(key(sg.q)) || []).filter((c) => !used.has(c));
      // where two rings touch, turn left first
      sg = nx.length > 1 ? nx.slice().sort((a, b) => turn(sg, b) - turn(sg, a))[0] : nx[0] || null;
    }
    const runs = [];
    for (const c of chain) { const l = runs[runs.length - 1]; if (l && Math.abs(l.nx - c.nx) < 1e-6 && Math.abs(l.ny - c.ny) < 1e-6 && Math.abs(l.off - c.off) < EPS) l.q = c.q; else runs.push(Object.assign({}, c)); }
    if (runs.length > 1) { const f = runs[0], l = runs[runs.length - 1]; if (Math.abs(f.nx - l.nx) < 1e-6 && Math.abs(f.ny - l.ny) < 1e-6 && Math.abs(f.off - l.off) < EPS) { f.p = l.p; runs.pop(); } }
    const pts = [];
    for (let k = 0; k < runs.length; k++) {
      const A = runs[k], B = runs[(k + 1) % runs.length];
      const a0 = [A.p[0] + A.nx * A.off, A.p[1] + A.ny * A.off], dA = [-A.ny, A.nx];
      const b0 = [B.p[0] + B.nx * B.off, B.p[1] + B.ny * B.off], dB = [-B.ny, B.nx];
      const den = dA[0] * dB[1] - dA[1] * dB[0];
      if (Math.abs(den) < 1e-9) pts.push([A.q[0] + A.nx * A.off, A.q[1] + A.ny * A.off], [B.p[0] + B.nx * B.off, B.p[1] + B.ny * B.off]);
      else { const t = ((b0[0] - a0[0]) * dB[1] - (b0[1] - a0[1]) * dB[0]) / den; pts.push([a0[0] + dA[0] * t, a0[1] + dA[1] * t]); }
    }
    if (pts.length >= 3) rings.push(pts.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]));
  }
  let a = 0;
  for (const r of rings) a += polyArea(r);
  return { rings, area: Math.abs(a) };
}
/* how far left the next segment turns from this one (radians, -pi..pi) */
function turn(a, b) { const d1 = [-a.ny, a.nx], d2 = [-b.ny, b.nx]; return Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]); }
