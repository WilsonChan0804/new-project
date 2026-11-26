/* The flat mix (5 · Mix): the table of flat types by band and the
 * diagrammatic elevation of each tower, floor by floor. Pure; tested in
 * tests/mix.test.mjs.
 *
 * A floor group of the massing lays out one typical floor (Floors page,
 * FC.layoutLegs); its flats are repeated on each of its storeys.
 */
import { unitType } from "./floorcore.js";

export const M2_FT2 = 10.7639;
export const BANDS = [
  { k: "0", label: "Studio", short: "STUDIO" },
  { k: "1", label: "1-BR", short: "1-BR" },
  { k: "2", label: "2-BR", short: "2-BR" },
  { k: "3", label: "3-BR", short: "3-BR" },
  { k: "sp", label: "Special unit", short: "SPECIAL" },
];
/* a unit's band: set on the unit (Units page, "Mix band"), else by its bedrooms */
export function band(u) {
  const b = u && u.band;
  return b && BANDS.some((x) => x.k === b) ? b : unitType(u);
}

/* the colours: a family of hues per band, a shade for each type in it (lighter to deeper); an override per unit name */
const FAM = {
  "0": [[275, 55, 82], [275, 50, 72], [280, 45, 64]],
  "1": [[185, 70, 78], [195, 75, 68], [205, 75, 60], [215, 70, 54], [225, 65, 48]],
  "2": [[95, 55, 72], [110, 50, 60], [125, 50, 50], [140, 50, 42], [155, 50, 36]],
  "3": [[52, 85, 68], [42, 85, 62], [30, 85, 60], [18, 80, 58], [8, 75, 56], [350, 60, 55]],
  sp: [[320, 70, 85], [320, 60, 76]],
};
const hsl = ([h, s, l]) => { s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join(""); };
export function shade(bk, i, n) {
  const fam = FAM[bk] || FAM["2"];
  const j = n <= 1 ? 0 : Math.round(i * (fam.length - 1) / Math.max(1, n - 1));
  return hsl(fam[Math.min(fam.length - 1, j)]);
}
/* a text colour that reads on a fill */
export function ink(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return "#111";
  const v = parseInt(m[1], 16), r = v >> 16, g = (v >> 8) & 255, b = v & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 140 ? "#111" : "#fff";
}

/* the flats of one typical floor in ring order: the north side left to right (along the corridor), then the south side
   right to left, as walked round the corridor; the core where it sits on the north run -> [{name, sa, kind}] */
export function ring(r) {
  if (!r) return [];
  const legs = r.multi && Array.isArray(r.legs) && r.legs.length ? [...r.legs].sort((a, b) => a.k - b.k) : [{ k: 0, r }];
  const off = new Map(); let s = 0;
  for (const l of legs) { off.set(l.k, s); s += Number(l.r.L) || Math.max(0, ...(l.r.placed || []).map((q) => q.x + q.w), ...(l.r.core || []).map((c) => c.x + c.w)); }
  const at = (l, x) => off.get(l.k) + x;
  const N = [], S = [];
  for (const l of legs) for (const q of l.r.placed || []) {
    const c = { kind: "unit", name: q.name, sa: q.fig ? Number(q.fig.saleable) || 0 : 0, key: at(l, q.x + q.w / 2), band: q.band };
    (q.band === "n" ? N : S).push(c);
  }
  N.sort((a, b) => a.key - b.key); S.sort((a, b) => b.key - a.key);
  // the core: its pieces (not the passages) together, at their middle along the corridor
  const cs = legs.flatMap((l) => (l.r.core || []).filter((c) => c.kind !== "passage").map((c) => ({ a: at(l, c.x), b: at(l, c.x + c.w) })));
  const out = [...N];
  if (cs.length) {
    const mid = (Math.min(...cs.map((c) => c.a)) + Math.max(...cs.map((c) => c.b))) / 2;
    let i = out.findIndex((c) => c.key > mid); if (i < 0) i = out.length;
    out.splice(i, 0, { kind: "core", name: "Core", sa: 0, key: mid });
  }
  return out.concat(S).map(({ kind, name, sa }) => ({ kind, name, sa }));
}

/* the table: rows [{name, sa (m2), n (flats in all)}] with the library (for each unit's band) ->
   {bands: [{k, label, rows: [{no, name, sa, n, tot, color}], n, tot, pn, pa}], total: {n, tot}} */
export function table(rows, lib, over) {
  const by = new Map();
  for (const r of rows || []) {
    if (!r || !r.name) continue;
    const o = by.get(r.name) || { name: r.name, sa: Number(r.sa) || 0, n: 0 };
    o.n += Number(r.n) || 0;
    by.set(r.name, o);
  }
  const find = (nm) => (lib || []).find((u) => u.name === nm);
  const all = [...by.values()].filter((r) => r.n > 0).map((r) => Object.assign(r, { band: band(find(r.name) || {}), tot: r.sa * r.n }));
  const N = all.reduce((s, r) => s + r.n, 0), T = all.reduce((s, r) => s + r.tot, 0);
  const bands = [];
  let no = 0;
  for (const B of BANDS) {
    const rs = all.filter((r) => r.band === B.k).sort((a, b) => a.sa - b.sa || a.name.localeCompare(b.name));
    if (!rs.length) continue;
    rs.forEach((r, i) => { r.no = ++no; r.color = (over && over[r.name]) || shade(B.k, i, rs.length); });
    const n = rs.reduce((s, r) => s + r.n, 0), tot = rs.reduce((s, r) => s + r.tot, 0);
    bands.push({ k: B.k, label: B.label, short: B.short, rows: rs, n, tot, pn: N ? n / N * 100 : 0, pa: T ? tot / T * 100 : 0 });
  }
  // the percentages to two places, adding up to 100.00 (largest remainder)
  for (const key of ["pn", "pa"]) {
    const v = bands.map((b) => b[key] * 100), f = v.map(Math.floor);
    let left = (N && T ? 10000 : 0) - f.reduce((s, x) => s + x, 0);
    for (const i of v.map((x, i) => i).sort((a, b) => (v[b] - f[b]) - (v[a] - f[a]))) { if (left <= 0) break; f[i]++; left--; }
    bands.forEach((b, i) => { b[key] = f[i] / 100; });
  }
  return { bands, total: { n: N, tot: T, types: all.length }, colors: Object.fromEntries(bands.flatMap((b) => b.rows.map((r) => [r.name, r.color]))) };
}

/* the rows of the table from the floor groups: [{x (group), r (layout) | null, mix: [{u (unit), n}]}] -> [{name, sa, n}] */
export function rowsOf(groups, saOf) {
  const out = [];
  for (const G of groups || []) {
    const floors = Math.max(0, Math.round(Number(G.floors) || 0));
    if (!floors) continue;
    if (G.r) for (const q of G.r.placed || []) out.push({ name: q.name, sa: saOf ? saOf(q.u || q.name, q) : (q.fig ? q.fig.saleable : 0), n: floors });
    else for (const m of G.mix || []) if (m.u) out.push({ name: m.u.name, sa: saOf ? saOf(m.u) : 0, n: floors * (Number(m.n) || 0) });
  }
  return out;
}

/* the elevation: for each building (M.buildings), its storeys bottom up, merged by floor:
   [{name, mpd, top, rows: [{no, z0, h, use, gi, block, cells?: [...], bar?: [{use, share, area}], plain?}], runs: [{from, to, n, label, use}]}]
   cellsOf(block id, gi) -> ring cells of that domestic group, or null */
export function elevation(blds, cellsOf, figs, uses) {
  const U = uses || {};
  return (blds || []).map((B, bi) => {
    const byZ = new Map();
    for (const s of B.storeys || []) {
      const k = s.block + "|" + s.gi + "|" + s.z0.toFixed(3);
      const o = byZ.get(k) || { no: s.no, z0: s.z0, h: s.h, block: s.block, gi: s.gi, storey: s.storey !== false, parts: [] };
      o.parts.push({ use: s.use, area: s.area });
      byZ.set(k, o);
    }
    const rows = [...byZ.values()].sort((a, b) => a.z0 - b.z0).map((o) => {
      const tot = o.parts.reduce((s, p) => s + p.area, 0) || 1;
      const dom = o.parts.find((p) => p.use === "dom");
      const cells = dom ? cellsOf(o.block, o.gi) : null;
      const row = { no: o.no, z0: o.z0, h: o.h, block: o.block, gi: o.gi, storey: o.storey, use: dom ? "dom" : o.parts[0].use };
      if (dom && cells && cells.length) {
        row.cells = cells;
        const others = o.parts.filter((p) => p.use !== "dom");
        if (others.length) row.bar = others.map((p) => ({ use: p.use, label: (U[p.use] || {}).label || p.use, share: p.area / tot, area: p.area }));
        row.domShare = dom.area / tot;
      } else row.bar = o.parts.map((p) => ({ use: p.use, label: (U[p.use] || {}).label || p.use, share: p.area / tot, area: p.area, empty: p.use === "dom" }));
      return row;
    });
    // the runs of floors for the side labels: each group of the same block; a single floor of the same use on top of a run is "n+1"
    const runs = [];
    for (const r of rows) {
      const last = runs[runs.length - 1];
      if (last && last.block === r.block && last.gi === r.gi) { last.to = rows.indexOf(r); last.n++; continue; }
      runs.push({ block: r.block, gi: r.gi, use: r.use, from: rows.indexOf(r), to: rows.indexOf(r), n: 1 });
    }
    const merged = [];
    for (const g of runs) {
      const last = merged[merged.length - 1];
      if (last && g.use === "dom" && last.use === "dom" && g.n === 1 && !last.plus && last.block === g.block) { last.to = g.to; last.plus = 1; continue; }
      merged.push(Object.assign({}, g));
    }
    for (const g of merged) g.label = g.plus ? `${g.n}+${g.plus} FLOOR` : `${g.n} FLOOR`;
    const f = figs && figs[bi];
    const top = rows.length ? rows[rows.length - 1].z0 + rows[rows.length - 1].h : 0;
    return { name: (B.top && B.top.name) || `Tower ${bi + 1}`, id: B.top && B.top.id, blocks: B.blocks, mpd: f ? f.mpd : null, top, rows, runs: merged.filter((g) => g.use === "dom") };
  });
}

/* the widest floor of a building, in cells (for the drawing's column width) */
export function widthOf(b) { return Math.max(1, ...b.rows.map((r) => (r.cells ? r.cells.length : 0))); }
