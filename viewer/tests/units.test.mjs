/* node viewer/tests/units.test.mjs - unit plans: areas and concessions */
import * as U from "../unitcore.js";
import { TEMPLATES } from "../unittables.js";
import { wallGeom, outlineOf } from "../unitwalls.js";

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("PASS " + m); };
const near = (a, b, e) => Math.abs(a - b) <= e;
const R = (id, kind, x, y, w, h) => ({ id, kind, name: id, x, y, w, h });

// an L of two rooms: 4 x 3 and 2 x 2 below its left part
const L = { wall: 0.2, party: 0.2, part: 0.1, facade: "s", partySides: [], rooms: [R("a", "LD", 0, 0, 4, 3), R("b", "BR", 0, 3, 2, 2.4)], extras: [] };
const fL = U.figures(L);
ok(near(fL.area, 12 + 4.8, 1e-9), "an L of 4 × 3 and 2 × 2.4: 16.8 m² to the centrelines");
const ext = fL.edges.filter((e) => e.kind === "ext").reduce((s, e) => s + e.len, 0);
ok(near(ext, 2 * (4 + 5.4), 1e-9) && fL.edges.filter((e) => e.kind === "part").length === 1, "its outline 18.8 m, one partition 2 m");
ok(near(fL.enclosed, 16.8 + 18.8 * 0.1 + 4 * 0.01, 1e-9), "enclosed to the outside of the external walls: + 18.8 × 0.1 + corners");
const P = Object.assign({}, L, { partySides: ["w"] });
ok(near(U.figures(P).enclosed, 16.8 + (18.8 - 5.4) * 0.1 + 0.02, 1e-9), "a party wall on the west: measured to its middle, no half-wall added (and no corner squares on that side)");
// moving the shared wall line keeps the total when both sides move
const two = { wall: 0.2, party: 0.2, part: 0.1, partySides: [], rooms: [R("a", "LD", 0, 0, 3, 3), R("b", "BR", 3, 0, 2.5, 3)], extras: [] };
const mv = U.moveLine(two, "x", 3, 0.3);
ok(near(U.figures(mv).area, U.figures(two).area, 1e-9) && near(mv.rooms[0].w, 3.3, 1e-9) && near(mv.rooms[1].w, 2.2, 1e-9), "the wall between moved 0.3 m: 3.3 + 2.2, the total kept");
const mvOut = U.moveLine(two, "x", 5.5, 0.5);
ok(near(U.figures(mvOut).area, 16.5 + 1.5, 1e-9), "the outer wall moved 0.5 m: 1.5 m² more");
// templates against their brochures
for (const [k, t] of Object.entries(TEMPLATES)) if (t.ft2) { const f = U.figures(t); ok(Math.abs(f.saleableFt - t.ft2) / t.ft2 <= 0.03, `${k}: ${f.saleableFt} ft² against ${t.ft2} ft² (${t.src})`); }
// concessions (the 1-room B: balcony 2.04, UP 1.5)
const f1 = U.figures(TEMPLATES["1R-B"]);
ok(near(f1.bal, 2.04, 1e-6) && near(f1.balEx, 1, 1e-9) && near(f1.upEx, 0.75, 1e-9), "balcony 2.04 m² exempt 1 m² (capped), UP exempt 0.75 m²");
ok(near(f1.saleable, f1.enclosed + f1.bal + f1.up, 1e-9) && near(f1.gfa, f1.enclosed + f1.bal - 1 + f1.up - 0.75, 1e-9), "saleable adds the balcony and UP; the GFA adds what is not exempt");
// the first form (rows) converts with the same areas
const old = { wall: 0.2, party: 0.2, part: 0.1, rows: [{ depth: 2.4, rooms: [{ kind: "BR", w: 2.4 }, { kind: "BATH", w: 1.5 }] }, { depth: 3, rooms: [{ kind: "LD", w: 4.0 }] }], extras: [] };
const conv = U.fromRows(old);
ok(conv.rooms.length === 3 && near(U.figures(conv).area, 4.0 * (2.5 + 3), 1e-9), "a row unit converts: 4.0 × 5.5 m to the centrelines");
// warnings
const narrow = U.moveLine(TEMPLATES["2R-B"], "x", TEMPLATES["2R-B"].rooms.find((r) => r.id === "r").w, -1.0, TEMPLATES["2R-B"].rooms.find((r) => r.id === "r").y, 99);
ok(U.figures(narrow).warn.some((w) => /Bedroom 1: .* under 1\.9/.test(w)), "a bedroom narrowed under 1.9 m warns");
// round 2: deleted walls, split / join, own thickness, the bay, defaults, windows
{
  const T = JSON.parse(JSON.stringify(TEMPLATES["2R-B"]));
  ok(T.wall === 0.1 && T.part === 0.075, "templates: external 100 mm, partitions 75 mm");
  const f0 = U.figures(T), e = f0.edges.find((q) => q.kind === "part" && !U.isOpen(T, q));
  T.walls = { [e.key]: { open: true } };
  const f1 = U.figures(T);
  ok(near(f1.area, f0.area, 1e-9) && f1.internal > f0.internal && U.isOpen(T, f1.edges.find((q) => q.key === e.key)), "a deleted partition: same area, more usable floor");
  T.walls = { [e.key]: { t: 0.2 } };
  ok(U.figures(T).internal < f0.internal, "a thicker partition: less usable floor");
  const sp = U.splitRoom(TEMPLATES["2R-B"], "l", "x", 1.5);
  const fs = U.figures(sp);
  ok(sp.rooms.length === TEMPLATES["2R-B"].rooms.length + 1 && near(fs.area, f0.area, 1e-9) && fs.edges.filter((q) => q.kind === "part").length > f0.edges.filter((q) => q.kind === "part").length, "split the living room: one more room and partition, the same area");
  const jn = U.joinRooms(sp, "l", sp.rooms.find((r) => r.id.startsWith("ls")).id);
  ok(jn && jn.rooms.length === TEMPLATES["2R-B"].rooms.length && near(U.figures(jn).area, f0.area, 1e-9), "join them back");
  const bayU = { wall: 0.15, part: 0.075, party: 0.15, rooms: [R("a", "LD", 0, 0, 4, 3)], extras: [{ kind: "bay", x: 4, y: 0, w: 1.2, h: 3.55, parts: [{ kind: "bal", len: 1.7 }, { kind: "up", len: 1.25 }, { kind: "acp", len: 0.6 }] }] };
  const sepU = Object.assign({}, bayU, { extras: [{ kind: "bal", x: 4, y: 0, w: 1.2, h: 1.7 }, { kind: "up", x: 4, y: 1.7, w: 1.2, h: 1.25 }, { kind: "acp", x: 4, y: 2.95, w: 1.2, h: 0.6 }] });
  const fb = U.figures(bayU), fsep = U.figures(sepU);
  ok(near(fb.saleable, fsep.saleable, 1e-9) && near(fb.gfa, fsep.gfa, 1e-9) && near(fb.acpFree, fsep.acpFree, 1e-9), "a combined bay counts as its parts would");
  const nw = JSON.parse(JSON.stringify(TEMPLATES["2R-B"])); nw.windows = nw.windows.filter((w) => w.room !== "r");
  ok(U.figures(nw).warn.some((w) => /Bedroom 1: no window/.test(w)), "a bedroom without its window warns");
  const fx = U.rotateFixture({ kind: "counter", x: 0, y: 0, w: 2, h: 0.6, rot: 0 });
  ok(near(fx.w, 0.6, 1e-9) && near(fx.h, 2, 1e-9) && fx.rot === 90 && near(fx.x + fx.w / 2, 1, 1e-9), "rotating a counter 90° about its centre");
}
// façades: a curtain wall's projection is not GFA; a precast wall's thickness up to 150 mm exempt under the cap
{
  const T = JSON.parse(JSON.stringify(TEMPLATES["2R-B"])), f0 = U.figures(T);
  const e = f0.edges.find((q) => q.kind === "ext" && q.a === "m" && q.face === "w");
  T.walls = { [e.key]: { f: "cw" } };
  const fc = U.figures(T);
  ok(near(fc.cwEx, e.len * 0.15 / 2, 1e-3) && near(fc.gfa, U.figures(Object.assign({}, T, { walls: { [e.key]: { t: 0.15 } } })).gfa - e.len * 0.075, 2e-3), "a curtain wall 150 mm: its outer half not GFA, outside the cap");
  T.walls = { [e.key]: { f: "pc" } };
  const fp = U.figures(T);
  ok(near(fp.pcEx, e.len * 0.15, 1e-3) && fp.capped > f0.capped, "a precast wall 150 mm: its thickness exempt, under the cap");
}
// round 3: add a room, mirror a unit
{
  const T = JSON.parse(JSON.stringify(TEMPLATES["2R-B"])), f0 = U.figures(T);
  const [x0, y0, x1, y1] = f0.box;
  const v = U.addRoom(T, { x: x1, y: y0, w: 2.42, h: 2.6 }, "STORE");
  ok(v && v.rooms.length === T.rooms.length + 1 && near(v.rooms.at(-1).w, 2.4, 1e-9) && near(U.figures(v).area, f0.area + 2.4 * 2.6, 1e-6), "add a 2.4 × 2.6 m room beside the unit (50 mm grid): the area grows by 6.24 m²");
  ok(U.addRoom(T, { x: x0 + 0.5, y: y0 + 0.5, w: 2, h: 2 }, "BR") === null, "a room over another is refused");
  ok(U.addRoom(T, { x: x1, y: y0, w: 0.4, h: 2 }, "BR") === null, "a room under 0.6 m is refused");
  const M = U.mirrorUnit(T), fm = U.figures(M);
  ok(near(fm.area, f0.area, 1e-6) && near(fm.saleable, f0.saleable, 1e-6) && near(fm.gfa, f0.gfa, 1e-6), "mirrored: the same areas, saleable and GFA");
  const r0 = T.rooms[0], rm = M.rooms[0];
  const ex = [x0, x1, ...(T.extras || []).flatMap((e) => [e.x, e.x + e.w])], Sx = Math.min(...ex) + Math.max(...ex);
  ok(near(rm.x, Sx - r0.x - r0.w, 1e-6) && near(rm.y, r0.y, 1e-9), "mirrored: rooms flipped about the unit's middle (with its bay)");
  const dW = T.doors.findIndex((d) => d.side === "e" || d.side === "w");
  ok(dW < 0 || M.doors[dW].side === { e: "w", w: "e" }[T.doors[dW].side], "a door on an east / west side moves to the other side");
  const MM = U.mirrorUnit(M);
  ok(MM.rooms.every((r, i) => near(r.x, T.rooms[i].x, 1e-6)) && MM.name === T.name && JSON.stringify(MM.doors) === JSON.stringify(T.doors.map((d) => Object.assign({}, d, { at: +(+d.at).toFixed(3) }, ("hinge" in d || d.swing) ? { hinge: d.hinge === "end" ? "end" : "start" } : {}))), "mirrored twice: back to the start");
}
// a shortened partition: the open part is floor
{
  const T = JSON.parse(JSON.stringify(TEMPLATES["2R-B"])), f0 = U.figures(T);
  const e = f0.edges.find((q) => q.kind === "part" && !U.isOpen(T, q) && q.len > 1.5);
  T.walls = { [e.key]: { s: 0, e: e.len / 2 } };
  const f1 = U.figures(T);
  ok(near(U.solidLen(T, e), e.len / 2, 1e-9) && near(f1.internal - f0.internal, e.len / 2 * T.part / 2, 2e-3) && near(f1.area, f0.area, 1e-9), "a partition shortened to half: half its length × t/2 more usable floor, the same area");
}
// a wall dragged on its own: the open kitchen's line aligned with the MBR's wall
{
  const T = { wall: 0.1, part: 0.075, party: 0.15, partySides: [], extras: [], rooms: [R("m", "MBR", 0, 0, 3, 3), R("k", "OKIT", 0, 3, 3, 2), R("l", "LD", 3, 0, 3.5, 5)] };
  const one = U.moveLine(T, "x", 3, 0.4, null, null, ["k", "l"]);
  const m1 = one.rooms.find((r) => r.id === "m"), k1 = one.rooms.find((r) => r.id === "k"), l1 = one.rooms.find((r) => r.id === "l");
  // the living room spans the whole line, so the MBR moves with it; a living room only beside the kitchen leaves it
  ok(near(k1.w, 3.4, 1e-9) && near(l1.x, 3.4, 1e-9), "the kitchen's wall moved 0.4 m with the room across it");
  const T2 = { wall: 0.1, part: 0.075, party: 0.15, partySides: [], extras: [], rooms: [R("m", "MBR", 0, 0, 3, 3), R("b", "BATH", 3, 0, 2, 3), R("k", "OKIT", 0, 3, 3, 2), R("l", "LD", 3, 3, 2, 2)] };
  const two = U.moveLine(T2, "x", 3, 0.4, null, null, ["k", "l"]);
  ok(near(two.rooms.find((r) => r.id === "k").w, 3.4, 1e-9) && near(two.rooms.find((r) => r.id === "m").w, 3, 1e-9) && near(two.rooms.find((r) => r.id === "b").x, 3, 1e-9), "the MBR and bathroom above, on the same line: they stay");
  const all = U.moveLine(T2, "x", 3, 0.4);
  ok(near(all.rooms.find((r) => r.id === "m").w, 3.4, 1e-9), "Alt (the whole line): the MBR moves too");
  void m1;
}
// the open kitchen as a zone, the living room one space with its foyer
{
  const T = { wall: 0.1, part: 0.075, party: 0.15, partySides: [], extras: [], rooms: [R("k", "OKIT", 0, 0, 2, 1.5), R("h", "LOBBY", 2, 0, 1.2, 1.5), R("l", "LD", 0, 1.5, 3.2, 3), R("m", "MBR", 3.2, 0, 2.5, 4.5)] };
  const f0 = U.figures(T), Z = U.zoneKitchens(JSON.parse(JSON.stringify(T))), f1 = U.figures(Z);
  ok(Z.zones.length === 1 && Z.rooms.filter((r) => r.space === "l").length === 2 && near(f1.saleable, f0.saleable, 1e-9) && near(f1.gfa, f0.gfa, 1e-9) && near(f1.area, f0.area, 1e-9), "an open kitchen and foyer join the living room's space, the kitchen a zone: the areas the same");
  const E = f1.edges.filter((e) => e.kind === "part" && !U.isOpen(Z, e));
  ok(E.every((e) => !["k", "h"].includes(e.a) || ["m"].includes(e.b) || ["m"].includes(e.a)), "no wall inside the living room's space");
  const Z2 = JSON.parse(JSON.stringify(Z)); Z2.zones[0].w = 1.2;
  ok(JSON.stringify(Z2.rooms) === JSON.stringify(Z.rooms), "the kitchen zone resized: no room moved");
  const t3 = TEMPLATES["LWK-3BR"], r3 = U.outline(t3);
  ok(r3.rings.length === 1 && near(r3.area, U.figures(t3).enclosed, 1e-3), "the saleable line's own area is the table's enclosed area");
  const cw = U.figures(t3);
  ok(cw.cwEx > 0 && cw.gfaRing < cw.ringArea, "with a curtain wall the GFA line lies inside the saleable line");
}
// walls drawn as one: a bath standing above the bedroom; its west wall (external, 0.2) runs on down as the partition (0.1)
{
  const u = { wall: 0.2, party: 0.2, part: 0.1, partySides: [], rooms: [R("m", "MBR", 0, 1, 3, 3), R("b", "BATH", 3, 0, 1.5, 2.5), R("l", "LD", 3, 2.5, 1.5, 1.5)], extras: [], walls: {} };
  const f = U.figures(u), tOf = (e) => (e.kind === "part" ? 0.1 : 0.2);
  const opt = { tOf, isOpen: (e) => U.isOpen(u, e), solid: (e) => U.solidPart(u, e), openings: [] };
  const G = wallGeom(u, f.edges, opt);
  const pe = f.edges.find((e) => e.key === "b|m");
  ok(near(G.off.get(pe), 0.05, 1e-9), "edge: the partition under the bath's external wall moves 50 mm into the bath, flush with its inside face");
  const pr = G.rects.find((r) => r.key === "b|m");
  ok(near(pr.x1, 3.1, 1e-9), "its bath face at x 3.10, as the external wall's inside face");
  u.join = "centre";
  ok(wallGeom(u, f.edges, opt).off.get(pe) === 0, "centre to centre: on its line");
  u.join = "edge"; u.walls["b|m"] = { align: "flip" };
  ok(near(wallGeom(u, f.edges, opt).off.get(pe), -0.05, 1e-9), "flipped: flush with the other face");
  delete u.walls["b|m"];
  // the outline closes at every corner: no line ends loose
  const ends = new Map();
  for (const l of G.lines.filter((q) => q.k !== "join")) for (const k of [l.x1.toFixed(4) + "," + l.y1.toFixed(4), l.x2.toFixed(4) + "," + l.y2.toFixed(4)]) ends.set(k, (ends.get(k) || 0) + 1);
  ok([...ends.values()].every((n) => n % 2 === 0), "the walls' outline is closed: every corner meets an even number of lines");
  // an opening cuts the wall
  const G2 = wallGeom(u, f.edges, Object.assign({}, opt, { openings: [{ x1: 0, y1: 2, x2: 0, y2: 3 }] }));
  ok(G2.rects.filter((r) => r.key === "m:w").length === 2, "a window cuts its wall in two");
  ok(outlineOf([{ x0: 0, y0: 0, x1: 1, y1: 0.1, m: "rc" }, { x0: 0, y0: 0, x1: 0.1, y1: 1, m: "rc" }]).length === 6, "two overlapping bands: one L outline of six lines");
}
{
  // the GFA's measure lines: external walls to their centre take off half the wall all round (and the corners); party walls to their outer face add half of it
  const g0 = { wall: 0.2, party: 0.2, part: 0.1, partySides: ["w"], rooms: [R("a", "LD", 0, 0, 4, 3)], extras: [] };
  const base = U.figures(g0).gfa;
  const cen = U.figures(Object.assign({}, g0, { gfaExt: "centre" })).gfa;
  ok(near(base - cen, (3 + 4 + 4) * 0.1 + 2 * 0.01, 1e-6), "GFA to the external walls' centre: half the wall less on the three external sides (" + (base - cen).toFixed(3) + " m²)");
  const po = U.figures(Object.assign({}, g0, { gfaParty: "outer" })).gfa;
  ok(near(po - base, 3 * 0.1 + 2 * 0.01, 1e-6), "GFA to the party wall's outer face: half of it more (" + (po - base).toFixed(3) + " m²)");
  ok(U.figures(Object.assign({}, g0, { gfaExt: "inner" })).gfa < cen, "to the inner face: less again");
}
{
  // a balcony made on the external wall's centre line: moved out to its outer face, its area the same
  const u = { wall: 0.2, party: 0.2, part: 0.1, partySides: [], rooms: [R("a", "LD", 0, 0, 4, 3)], extras: [{ kind: "bal", x: 4, y: 0.5, w: 1.2, h: 1.7 }] };
  const a0 = U.figures(u).saleable;
  U.extrasToFace(u);
  ok(Math.abs(u.extras[0].x - 4.1) < 1e-9 && u.xFace === 1, "the balcony off the wall: from x 4.0 (the wall's centre) to 4.1 (its outer face)");
  ok(Math.abs(U.figures(u).saleable - a0) < 1e-9, "its area, and the saleable area, the same");
  U.extrasToFace(u);
  ok(Math.abs(u.extras[0].x - 4.1) < 1e-9, "once only");
}
// one wall's own type over its side's
{
  const W1 = Object.assign({}, L, { walls: { "b:w": { kind: "party" } } });
  const eW = U.edges(W1).filter((e) => e.face === "w");
  ok(eW.find((e) => e.key === "b:w").kind === "party" && eW.find((e) => e.key === "a:w").kind === "ext", "b's west wall alone is party, a's stays external");
  const d = U.figures(L).enclosed - U.figures(W1).enclosed;
  ok(d > 2.4 * 0.1 - 0.03 && d < 2.4 * 0.1 + 0.03, "the saleable line goes to its middle there: about 2.4 × 0.1 less (" + d.toFixed(3) + ")");
  const W2 = Object.assign({}, P, { walls: { "a:w": { kind: "ext" } } });
  ok(U.edges(W2).find((e) => e.key === "a:w").kind === "ext" && U.edges(W2).find((e) => e.key === "b:w").kind === "party", "a party side with one wall set back to external");
  // a balcony against a's south face: a door there is by the outdoors
  const B = Object.assign({}, two, { extras: [{ kind: "bal", x: 0.5, y: 3, w: 2, h: 1.2 }] });
  const es = U.edges(B).find((e) => e.key === "a:s"), en = U.edges(B).find((e) => e.key === "a:n");
  ok(U.byOutdoor(B, es) && !U.byOutdoor(B, en), "the wall the balcony touches is by the outdoors (a sliding door there)");
}
// a door pushed to a wall: its jamb on the face of the wall meeting its side
{
  const u = JSON.parse(JSON.stringify(TEMPLATES["2R-B"])), d = u.doors.find((q) => q.room === "b");
  const st = U.doorStops(u, d);
  ok(st.some((q) => q.end === "start" && Math.abs(q.at - 0.0375) < 0.002) && st.some((q) => q.end === "end" && Math.abs(q.at - (1.55 - 0.0375 - d.w)) < 0.002), "a door's stops: just past the 75 mm partition's face, and its end on the far one");
  ok(Math.abs(U.snapDoorAt(u, d, 0.12) - 0.0375) < 0.002 && U.snapDoorAt(u, d, 0.4) == null, "dragged near the wall it snaps to its face; away from it, it does not");
  u.doorNib = 0.1;
  ok(U.doorStops(u, d).some((q) => q.end === "start" && Math.abs(q.at - 0.1375) < 0.002), "with a 100 mm nib it stands 100 mm off the face");
}
// a wall moved: a door in a wall along the other way stays where it stands; one on the moved wall goes with it
{
  const u2 = { wall: 0.2, party: 0.2, part: 0.1, partySides: [], rooms: [R("a", "LD", 0, 0, 3, 3), R("b", "BR", 3, 0, 2.5, 3)], extras: [],
    doors: [{ room: "b", side: "s", at: 1.0, w: 0.8 }, { room: "b", side: "w", at: 1.0, w: 0.8 }], windows: [{ room: "b", side: "n", at: 0.5, w: 1.2 }] };
  const m2 = U.moveLine(u2, "x", 3, -0.4);
  ok(near(m2.rooms[1].x + m2.doors[0].at, 4.0, 1e-9) && near(m2.rooms[1].x + m2.windows[0].at, 3.5, 1e-9), "the wall between moved: the door and window in the south / north walls keep their places (x 4.0, 3.5)");
  ok(near(m2.doors[1].at, 1.0, 1e-9) && near(m2.rooms[1].x, 2.6, 1e-9), "the door in the moved wall goes with it");
  const m3 = U.moveLine(u2, "x", 3, 0.6);
  ok(near(m3.doors[0].at, 0.4, 1e-9) && near(m3.windows[0].at, 0, 1e-9), "a wall moved past a door: it is kept on its side (at 0.4; the window at 0)");
}
// a figure typed: the shared line moves to the millimetre, both rooms with it (no gap)
{
  const u = { name: "t", wall: 0.15, part: 0.075, rooms: [{ id: "a", kind: "BATH", x: 0, y: 0, w: 1.65, h: 2 }, { id: "b", kind: "OKIT", x: 1.65, y: 0, w: 1.8, h: 2 }, { id: "c", kind: "LD", x: 0, y: 2, w: 3.45, h: 3.5 }], doors: [], windows: [], extras: [] };
  const m = U.moveLine(u, "x", 1.65, -0.137, null, null, ["a"], true);
  const A = m.rooms.find((r) => r.id === "a"), B = m.rooms.find((r) => r.id === "b"), Cc = m.rooms.find((r) => r.id === "c");
  ok(near(A.w, 1.513, 1e-9) && near(B.x, 1.513, 1e-9) && near(B.w, 1.937, 1e-9) && near(A.x + A.w, B.x, 1e-9), `exact: the bath 1.513 wide, the kitchen from 1.513 (they still share the partition)`);
  ok(near(Cc.w, 3.45, 1e-9), "the living room below, not on that piece of line, stays");
  ok(near(U.moveLine(u, "x", 1.65, -0.137, null, null, ["a"]).rooms[0].w, 1.5, 1e-9), "a drag still goes to the 50 mm grid");
}
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
