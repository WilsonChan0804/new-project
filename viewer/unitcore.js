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
const n = (x, d = 0) => (x === "" || x == null || isNaN(Number(x)) ? d : Number(x));
const EPS = 1e-6;

/* the first form (rows of rooms) as rooms on the plan */
export function fromRows(u) {
  if (!u || !Array.isArray(u.rows)) return u;
  const pt = n(u.part, 0.1), rooms = [];
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
  return out.map((e) => Object.assign(e, { len: Math.hypot(e.x2 - e.x1, e.y2 - e.y1) }));
}

/* an open kitchen and the living room share no wall */
export function isOpen(u, e) {
  if (e.kind !== "part") return false;
  const ka = (u.rooms.find((r) => r.id === e.a) || {}).kind, kb = (u.rooms.find((r) => r.id === e.b) || {}).kind;
  const k = [ka, kb].sort().join("+");
  return k === "LD+OKIT" || k === "LD+LOBBY" || (u.open || []).includes([e.a, e.b].sort().join("+"));
}

export function figures(u0) {
  const u = u0 && u0.rows ? fromRows(u0) : u0;
  const rooms = u.rooms || [];
  const wall = n(u.wall, 0.2), party = n(u.party, 0.2), pt = n(u.part, 0.1);
  const area = rooms.reduce((s, r) => s + n(r.w) * n(r.h), 0); // the rooms tile: no overlaps
  const E = edges(u);
  const extL = E.filter((e) => e.kind === "ext").reduce((s, e) => s + e.len, 0);
  const partyL = E.filter((e) => e.kind === "party").reduce((s, e) => s + e.len, 0);
  const partL = E.filter((e) => e.kind === "part" && !isOpen(u, e)).reduce((s, e) => s + e.len, 0);
  // to the outside of the external walls (the outline grown by half the wall; the corners add 4 small squares), to the middle of party walls
  const enclosed = area + extL * wall / 2 + 4 * (wall / 2) ** 2 * (extL > 0 ? 1 : 0);
  const internal = Math.max(0, area - extL * wall / 2 - partyL * party / 2 - partL * pt / 2);
  const ex = (u.extras || []).map((e) => Object.assign({ area: e.splay ? n(e.w) * n(e.h) - n(e.splay) ** 2 / 2 : n(e.w) * n(e.h) }, e));
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
  const gfa = enclosed + (bal - balEx) + (up - upEx);
  const warn = [];
  for (const r of rooms) {
    const k = KINDS[r.kind];
    if (k && Math.min(n(r.w), n(r.h)) < k.min - 1e-9) warn.push(`${r.name || k.label}: ${Math.min(n(r.w), n(r.h)).toFixed(2)} m is under ${k.min} m`);
    if (k && k.hab && !E.some((e) => e.kind === "ext" && e.a === r.id && e.face === (u.facade || "s")) && !(u.extras || []).some((x) => touches(r, x)))
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
    capped: r3(balEx + upEx + acpCapEx), efficiency: gfa ? r3(internal / gfa) : null, warn,
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
