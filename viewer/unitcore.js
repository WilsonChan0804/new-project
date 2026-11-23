/* Site study, stage 3: residential units - a unit is rows of rooms (from the
 * corridor to the façade), each row one depth, its rooms side by side; plus
 * the balcony, utility platform and A/C platform outside it. Pure: the sizes
 * and the rules, tested in tests/units.test.mjs.
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
 *     exempted, at most 0.75 m2 per unit; at least 1.5 m from a balcony;
 *     under the 10% cap.
 *   A/C platform (PNAP APP-19 para 3(b)/(c)): projecting not over 750 mm, or
 *     complying with the Code of Practice for external maintenance - not
 *     counted, outside the cap (APP-151 item 28); otherwise item 29, under it.
 */
export const M2_FT2 = 10.7639;
export const KINDS = {
  LD: { label: "Living / dining", min: 2.4, color: "#fbe9b7" },
  BR: { label: "Bedroom", min: 2.1, color: "#d9e8f8" },
  MBR: { label: "Master bedroom", min: 2.4, color: "#cfe0f5" },
  KIT: { label: "Kitchen", min: 1.4, color: "#e6f2d9" },
  OKIT: { label: "Open kitchen", min: 1.4, color: "#eef6e4" },
  BATH: { label: "Bathroom", min: 1.4, color: "#dff1f1" },
  ENS: { label: "Ensuite", min: 1.4, color: "#dff1f1" },
  STORE: { label: "Store / wardrobe", min: 0.6, color: "#eceef1" },
  ENTRY: { label: "Entrance / corridor", min: 0.9, color: "#f5f1ea" },
};
export const EXTRAS = {
  bal: { label: "Balcony", color: "#cfe9d6" },
  up: { label: "Utility platform", color: "#e0eadc" },
  acp: { label: "A/C platform", color: "#e3e6ea" },
};
export const RULES = {
  bal: { min: 2, share: 0.5, cap: 1, capPct: 0.025, max: 3, src: "JPN 1 para 1(a)(x)-(xii)" },
  up: { min: 1.5, share: 0.5, max: 0.75, src: "JPN 2 para 1(b)(ii)-(v)" },
  acp: { depth: 0.75, src: "PNAP APP-19 para 3(b), (c); APP-151 items 28, 29" },
};

const n = (x, d = 0) => (x === "" || x == null || isNaN(Number(x)) ? d : Number(x));

/* the unit laid out: each room's rectangle (m, x across from the left, y
   down from the corridor), the unit's inner and outer sizes */
export function layout(u) {
  const pt = n(u.part, 0.1), rows = u.rows || [];
  const rowW = rows.map((r) => (r.rooms || []).reduce((s, q) => s + n(q.w), 0) + Math.max(0, (r.rooms || []).length - 1) * pt);
  const W = Math.max(0, ...rowW);
  const rooms = [];
  let y = 0;
  rows.forEach((r, ri) => {
    const d = n(r.depth);
    let x = 0;
    (r.rooms || []).forEach((q, qi) => {
      let w = n(q.w);
      // the last room of a narrower row takes up the rest of the width
      if (qi === r.rooms.length - 1 && rowW[ri] < W - 1e-9) w += W - rowW[ri];
      rooms.push({ ri, qi, name: q.name || (KINDS[q.kind] || {}).label || q.kind, kind: q.kind, x, y, w, d, area: w * d });
      x += w + pt;
    });
    y += d + (ri < rows.length - 1 ? pt : 0);
  });
  const D = y;
  const wall = n(u.wall, 0.2), party = n(u.party, 0.2);
  // the sides: to the middle of a party wall, or the outside of an external wall
  const side = (k) => (u[k] === "ext" ? wall : party / 2);
  const outW = W + side("left") + side("right"), outD = D + wall /* façade */ + (u.corridor === "party" ? party / 2 : wall) /* corridor side */;
  return { rooms, W, D, outW, outD, rowW };
}

export function figures(u) {
  const L = layout(u);
  const enclosed = L.outW * L.outD, internal = L.W * L.D;
  const ex = (u.extras || []).map((e) => Object.assign({ area: n(e.w) * n(e.d) }, e));
  const sum = (k) => ex.filter((e) => e.kind === k).reduce((s, e) => s + e.area, 0);
  const bal = sum("bal"), up = sum("up"), acp = sum("acp");
  // balconies: each at least 2 m2 to count; 50%, up to max(1, 2.5% UFS) <= 3 per unit
  const balOk = ex.filter((e) => e.kind === "bal" && e.area >= RULES.bal.min - 1e-9).reduce((s, e) => s + e.area, 0);
  const balCap = Math.min(RULES.bal.max, Math.max(RULES.bal.cap, RULES.bal.capPct * internal));
  const balEx = Math.min(balOk * RULES.bal.share, balCap);
  const upOk = ex.filter((e) => e.kind === "up" && e.area >= RULES.up.min - 1e-9).reduce((s, e) => s + e.area, 0);
  const upEx = Math.min(upOk * RULES.up.share, RULES.up.max);
  const acpFree = ex.filter((e) => e.kind === "acp" && (n(e.d) <= RULES.acp.depth + 1e-9 || e.dfs)).reduce((s, e) => s + e.area, 0);
  const acpCapEx = acp - acpFree; // a deeper platform: exempt only under the 10% cap (item 29)
  const saleable = enclosed + bal + up;
  const gfa = enclosed + (bal - balEx) + (up - upEx);
  const capped = balEx + upEx + acpCapEx;
  const warn = [];
  for (const r of L.rooms) {
    const k = KINDS[r.kind];
    if (k && Math.min(r.w, r.d) < k.min - 1e-9) warn.push(`${r.name}: ${Math.min(r.w, r.d).toFixed(2)} m is under ${k.min} m`);
  }
  const has = (...k) => L.rooms.some((r) => k.includes(r.kind));
  if (!has("BATH", "ENS")) warn.push("No bathroom");
  if (!has("KIT", "OKIT")) warn.push("No kitchen");
  if (has("OKIT")) warn.push("Open kitchen: FS Code requirements apply (sprinklers / the cooking area away from the exit door)");
  for (const e of ex) {
    if (e.kind === "bal" && e.area < RULES.bal.min) warn.push(`Balcony ${e.area.toFixed(2)} m² is under ${RULES.bal.min} m²: no exemption (JPN 1)`);
    if (e.kind === "up" && e.area < RULES.up.min) warn.push(`Utility platform ${e.area.toFixed(2)} m² is under ${RULES.up.min} m²: no exemption (JPN 2)`);
    if (e.kind === "acp" && n(e.d) > RULES.acp.depth && !e.dfs) warn.push(`A/C platform ${n(e.d).toFixed(2)} m deep: over 750 mm, exempt only under the 10% cap unless it meets the external maintenance code (APP-19)`);
  }
  if (bal && balOk * RULES.bal.share > balCap + 1e-9) warn.push(`Balcony exemption capped at ${balCap.toFixed(2)} m² for this unit`);
  if (up && upOk * RULES.up.share > RULES.up.max + 1e-9) warn.push(`Utility platform exemption capped at ${RULES.up.max} m²`);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return {
    layout: L, internal: r3(internal), enclosed: r3(enclosed), bal: r3(bal), up: r3(up), acp: r3(acp),
    saleable: r3(saleable), saleableFt: Math.round(saleable * M2_FT2), gfa: r3(gfa), balEx: r3(balEx), upEx: r3(upEx), acpFree: r3(acpFree), acpCapEx: r3(acpCapEx),
    capped: r3(capped), efficiency: gfa ? r3(internal / gfa) : null, warn,
  };
}

/* change one room's width and keep the rest (the unit grows or shrinks) */
export function setWidth(u, ri, qi, w) {
  const v = JSON.parse(JSON.stringify(u));
  v.rows[ri].rooms[qi].w = Math.max(0.3, Math.round(w * 20) / 20);
  return v;
}
/* move the partition after room qi of row ri by dx m: the rooms on its two sides trade width */
export function movePartition(u, ri, qi, dx) {
  const v = JSON.parse(JSON.stringify(u)), r = v.rows[ri].rooms;
  if (!r[qi] || !r[qi + 1]) return v;
  const step = Math.round(dx * 20) / 20, a = n(r[qi].w) + step, b = n(r[qi + 1].w) - step;
  if (a < 0.3 || b < 0.3) return v;
  r[qi].w = +a.toFixed(2); r[qi + 1].w = +b.toFixed(2);
  return v;
}
