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
  LD: { label: "Living / dining", zh: "客/飯廳", ab: "LIV./DIN.", min: 2.4, hab: true },
  MBR: { label: "Master bedroom", zh: "主人睡房", ab: "M.B.R.", min: 2.3, hab: true },
  BR: { label: "Bedroom", zh: "睡房", ab: "B.R.", min: 2.1, hab: true },
  OKIT: { label: "Open kitchen", zh: "開放式廚房", ab: "OPEN KIT.", min: 1.2 },
  KIT: { label: "Kitchen", zh: "廚房", ab: "KIT.", min: 1.4 },
  BATH: { label: "Bathroom", zh: "浴室", ab: "BATH", min: 1.4 },
  ENS: { label: "Ensuite", zh: "浴室", ab: "BATH", min: 1.4 },
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

/* the outline's edges and the partitions: [{x1, y1, x2, y2, kind: ext|party|part, face: n|e|s|w, a, b}] */
export function edges(u) {
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
    return Object.assign(e, { len: Math.hypot(e.x2 - e.x1, e.y2 - e.y1), key, t: o.t != null && o.t !== "" ? Number(o.t) : null, removed: !!o.open });
  });
}

/* an open kitchen and the living room share no wall */
export function isOpen(u, e) {
  if (e.kind !== "part") return false;
  if (e.removed) return true;
  if (u.walls && u.walls[e.key] && u.walls[e.key].open === false) return false;
  const ka = (u.rooms.find((r) => r.id === e.a) || {}).kind, kb = (u.rooms.find((r) => r.id === e.b) || {}).kind;
  const k = [ka, kb].sort().join("+");
  return k === "LD+OKIT" || k === "LD+LOBBY" || (u.open || []).includes([e.a, e.b].sort().join("+"));
}

export function figures(u0) {
  const u = u0 && u0.rows ? fromRows(u0) : u0;
  const rooms = u.rooms || [];
  const wall = n(u.wall, 0.1), party = n(u.party, 0.15), pt = n(u.part, 0.075);
  const area = rooms.reduce((s, r) => s + n(r.w) * n(r.h), 0); // the rooms tile: no overlaps
  const E = edges(u);
  const extL = E.filter((e) => e.kind === "ext").reduce((s, e) => s + e.len, 0);
  const partyL = E.filter((e) => e.kind === "party").reduce((s, e) => s + e.len, 0);
  const partL = E.filter((e) => e.kind === "part" && !isOpen(u, e)).reduce((s, e) => s + e.len, 0);
  // to the outside of the external walls (the outline grown by half the wall; the corners add 4 small squares), to the middle of party walls
  // each external wall at its thickness and façade
  const facOf = (e) => ((u.walls || {})[e.key] || {}).f || u.facadeType || "rc";
  const extT = (e) => (e.t != null ? e.t : FACADES[facOf(e)] && FACADES[facOf(e)].t != null ? FACADES[facOf(e)].t : wall);
  for (const e of E) if (e.kind === "ext") { e.facade = facOf(e); if (e.t == null) e.t = extT(e); }
  const extOut = E.filter((e) => e.kind === "ext").reduce((s2, e) => s2 + e.len * e.t / 2, 0);
  const enclosed = area + extOut + 4 * (wall / 2) ** 2 * (extL > 0 ? 1 : 0);
  // façade concessions: a curtain wall's projection beyond the structure is not GFA (outside the cap); a precast wall's thickness up to 150 mm is exempt (under the cap)
  const cwEx = E.filter((e) => e.kind === "ext" && e.facade === "cw").reduce((s2, e) => s2 + e.len * e.t / 2, 0);
  const pcEx = E.filter((e) => e.kind === "ext" && e.facade === "pc").reduce((s2, e) => s2 + e.len * Math.min(e.t, FACADES.pc.max), 0);
  // inside the walls: each wall at its own thickness where it has one
  const tOf = (e) => (e.t != null ? e.t : e.kind === "ext" ? wall : e.kind === "party" ? party : pt);
  const internal = Math.max(0, area - E.filter((e) => e.kind !== "part" || !isOpen(u, e)).reduce((s2, e) => s2 + e.len * tOf(e) / 2 * (e.kind === "part" ? 1 : 1), 0));
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
  const gfa = enclosed - cwEx - pcEx + (bal - balEx) + (up - upEx);
  const warn = [];
  for (const r of rooms) {
    const k = KINDS[r.kind];
    if (k && Math.min(n(r.w), n(r.h)) < k.min - 1e-9) warn.push(`${r.name || k.label}: ${Math.min(n(r.w), n(r.h)).toFixed(2)} m is under ${k.min} m`);
    const hasWin = Array.isArray(u.windows) ? u.windows.some((w) => w.room === r.id) : E.some((e) => e.kind === "ext" && e.a === r.id && e.face === (u.facade || "s")) || (u.extras || []).some((x) => touches(r, x));
    if (k && k.hab && !hasWin)
      warn.push(`${r.name || k.label}: no window on the façade`);
  }
  const has = (...k) => rooms.some((r) => k.includes(r.kind));
  if (!has("BATH", "ENS")) warn.push("No bathroom");
  if (!has("KIT", "OKIT")) warn.push("No kitchen");
  if (has("OKIT")) warn.push("Open kitchen: FS Code requirements apply (sprinklers / the cooking area away from the exit door)");
  for (const e of ex) {
    if (e.kind === "bal" && e.area < RULES.bal.min) warn.push(`Balcony ${e.area.toFixed(2)} m² is under ${RULES.bal.min} m²: no exemption (JPN 1)`);
    if (e.kind === "up" && e.area < RULES.up.min) warn.push(`Utility platform ${e.area.toFixed(2)} m² is under ${RULES.up.min} m²: no exemption (JPN 2)`);
    if (e.kind === "acp" && Math.min(n(e.w), n(e.h)) > RULES.acp.depth && !e.dfs) warn.push(`A/C platform over 750 mm deep: exempt only under the 10% cap unless it meets the external maintenance code (APP-19)`);
  }
  if (bal && balOk * RULES.bal.share > balCap + 1e-9) warn.push(`Balcony exemption capped at ${balCap.toFixed(2)} m² for this unit`);
  if (up && upOk * RULES.up.share > RULES.up.max + 1e-9) warn.push(`Utility platform exemption capped at ${RULES.up.max} m²`);
  const xs = rooms.flatMap((r) => [n(r.x), n(r.x) + n(r.w)]), ys = rooms.flatMap((r) => [n(r.y), n(r.y) + n(r.h)]);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return {
    unit: u, edges: E, area: r3(area), internal: r3(internal), enclosed: r3(enclosed), bal: r3(bal), up: r3(up), acp: r3(acp),
    saleable: r3(saleable), saleableFt: Math.round(saleable * M2_FT2), gfa: r3(gfa), balEx: r3(balEx), upEx: r3(upEx), acpFree: r3(acpFree), acpCapEx: r3(acpCapEx),
    cwEx: r3(cwEx), pcEx: r3(pcEx),
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
export function moveLine(u, axis, at, d, lo, hi) {
  const v = JSON.parse(JSON.stringify(u)), step = Math.round(d * 20) / 20;
  if (!step) return v;
  const on = (a, b) => Math.abs(a - b) < 0.01;
  const inSpan = (a0, a1) => lo == null || (a1 > lo + 0.01 && a0 < hi - 0.01);
  for (const r of v.rooms) {
    if (axis === "x" && inSpan(r.y, r.y + r.h)) {
      if (on(r.x, at)) { r.x += step; r.w -= step; }
      else if (on(r.x + r.w, at)) r.w += step;
    }
    if (axis === "y" && inSpan(r.x, r.x + r.w)) {
      if (on(r.y, at)) { r.y += step; r.h -= step; }
      else if (on(r.y + r.h, at)) r.h += step;
    }
  }
  for (const x of v.extras || []) {
    if (axis === "x" && on(x.x, at)) x.x += step;
    if (axis === "y" && on(x.y, at)) x.y += step;
  }
  if (v.rooms.some((r) => r.w < 0.5 || r.h < 0.5)) return u;
  for (const r of v.rooms) for (const k of ["x", "y", "w", "h"]) r[k] = +r[k].toFixed(3);
  return v;
}

/* scale a plan so that its saleable area is `ft2` (for the templates) */
export function scaleTo(u, ft2) {
  let lo = 0.6, hi = 1.6;
  const at = (k) => {
    const v = JSON.parse(JSON.stringify(u));
    const sx = (x) => Math.round(x * k * 20) / 20;
    v.rooms = u.rooms.map((r) => ({ ...r, x: sx(r.x), y: sx(r.y), w: +(sx(r.x + r.w) - sx(r.x)).toFixed(3), h: +(sx(r.y + r.h) - sx(r.y)).toFixed(3) }));
    v.extras = (u.extras || []).map((e) => ({ ...e, x: sx(e.x), y: sx(e.y) }));
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
  const ew = { e: "w", w: "e", n: "n", s: "s" };
  const rooms = new Map((v.rooms || []).map((r) => [r.id, r]));
  for (const o of [...(v.doors || []), ...(v.windows || [])]) {
    const r = rooms.get(o.room); if (!r) continue;
    if (o.side === "n" || o.side === "s") o.at = +(n(r.w) - n(o.at) - n(o.w || 0.8)).toFixed(3);
    else o.side = ew[o.side];
    if ("hinge" in o || o.swing) o.hinge = o.hinge === "end" ? "start" : "end";
  }
  for (const r of v.rooms || []) fx(r);
  for (const e of v.extras || []) { fx(e); if (e.splay) e.splayL = !e.splayL; }
  for (const x of v.fixtures || []) { fx(x); if (x.rot === 90) x.rot = 270; else if (x.rot === 270) x.rot = 90; }
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
    const x = n(r.x), y = n(r.y), w = n(r.w), h = n(r.h), long = w >= h;
    if (r.kind === "BATH" || r.kind === "ENS") {
      if (Math.max(w, h) >= 2.0) out.push(long ? { kind: "bath", x: x + 0.1, y: y + 0.1, w: 1.5, h: 0.7, rot: 0 } : { kind: "bath", x: x + 0.1, y: y + 0.1, w: 0.7, h: 1.5, rot: 0 });
      else out.push({ kind: "shower", x: x + 0.1, y: y + 0.1, w: 0.9, h: 0.9, rot: 0 });
      out.push({ kind: "wc", x: x + w - 0.55, y: y + h - 0.75, w: 0.4, h: 0.65, rot: 0 });
      out.push({ kind: "basin", x: x + w - 0.6, y: y + 0.1, w: 0.5, h: 0.4, rot: 0 });
    }
    if (r.kind === "OKIT" || r.kind === "KIT")
      out.push(long ? { kind: "counter", x: x + 0.05, y: y + 0.05, w: Math.max(1, w - 0.1), h: 0.6, rot: 0 } : { kind: "counter", x: x + 0.05, y: y + 0.05, w: 0.6, h: Math.max(1, h - 0.1), rot: 0 });
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
