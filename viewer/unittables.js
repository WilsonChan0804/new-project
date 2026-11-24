/* Unit templates traced from recent sales brochure plans (via Centanet):
 * the room arrangement of each, scaled so that its saleable area matches the
 * brochure's. Rooms are rectangles to the wall centrelines (m, x to the
 * right, y down the page); `facade` is the window side, `partySides` the
 * sides on other units. Adjust them to the project. */
import { scaleTo, fromRows, genWindows, genFixtures, zoneKitchens } from "./unitcore.js";

const base = { wall: 0.1, party: 0.15, part: 0.075 };
const R = (id, kind, name, x, y, w, h) => ({ id, kind, name, x, y, w, h });

const RAW = {
  "1R-B": Object.assign({}, base, {
    name: "1-room (318 ft²)", type: "1R", ft2: 318, src: "after Park Silicon · Palo Springs, Tower 2A unit B, 318 ft²",
    facade: "e", partySides: ["w", "s"],
    rooms: [R("k", "OKIT", "Open kitchen", 0, 0, 1.6, 2.4), R("l", "LD", "Living / dining", 1.6, 0, 3.6, 2.4),
      R("b", "BATH", "Bath", 0.5, 2.4, 1.6, 1.8), R("h", "LOBBY", "", 2.1, 2.4, 0.9, 1.0), R("m", "MBR", "Master bedroom", 3.0, 2.4, 2.2, 2.2)],
    extras: [{ kind: "bay", x: 5.2, y: 0, w: 1.2, h: 3.55, parts: [{ kind: "bal", len: 1.7 }, { kind: "up", len: 1.25 }, { kind: "acp", len: 0.6 }] }, { kind: "pd", x: 5.2, y: 3.55, w: 0.4, h: 0.4 }],
    doors: [{ room: "l", side: "n", at: 0.3, w: 0.9, entry: true }, { room: "b", side: "e", at: 0.2, w: 0.75 }, { room: "m", side: "w", at: 0.1, w: 0.8 }],
  }),
  "1R-E": Object.assign({}, base, {
    name: "1-room (290 ft²)", type: "1R", ft2: 290, src: "after Park Silicon · Palo Springs, Tower 2A unit E",
    facade: "s", partySides: ["w", "e"],
    rooms: [R("b", "BATH", "Bath", 0, 0, 1.5, 1.8), R("h", "LOBBY", "", 1.5, 0, 1.1, 1.8), R("k", "OKIT", "Open kitchen", 2.6, 0, 2.2, 1.8),
      R("m", "MBR", "Master bedroom", 0, 1.8, 2.3, 2.8), R("l", "LD", "Living / dining", 2.3, 1.8, 2.5, 2.8)],
    extras: [{ kind: "acp", x: 0.4, y: 4.6, w: 1.2, h: 0.6 }, { kind: "up", x: 2.6, y: 4.6, w: 1.25, h: 1.2 }],
    doors: [{ room: "h", side: "n", at: 0.1, w: 0.9, entry: true }, { room: "b", side: "s", at: 0.4, w: 0.75 }, { room: "m", side: "n", at: 1.6, w: 0.8 }],
  }),
  "2R-B": Object.assign({}, base, {
    name: "2-room (419 ft²)", type: "2R", ft2: 419, src: "after Emerald Avenue, unit B, 419 ft²",
    facade: "w", partySides: ["n", "s"],
    rooms: [R("m", "MBR", "Master bedroom", 0, 0, 2.6, 2.6), R("b", "BATH", "Bath 1", 2.6, 0, 1.4, 1.9), R("h", "LOBBY", "", 2.6, 1.9, 1.4, 0.7),
      R("e", "LOBBY", "", 4.0, 1.3, 0.9, 1.3), R("l", "LD", "Living / dining", 0, 2.6, 3.0, 2.4), R("k", "OKIT", "Open kitchen", 3.0, 2.6, 1.9, 2.0),
      R("r", "BR", "Bedroom 1", 0, 5.0, 2.6, 2.3)],
    extras: [{ kind: "bay", x: -1.2, y: 2.6, w: 1.2, h: 3.55, parts: [{ kind: "bal", len: 1.7 }, { kind: "up", len: 1.25 }, { kind: "acp", len: 0.6 }] }],
    doors: [{ room: "e", side: "e", at: 0.2, w: 0.9, entry: true }, { room: "m", side: "e", at: 1.9, w: 0.8 }, { room: "b", side: "s", at: 0.3, w: 0.75 }, { room: "r", side: "n", at: 1.7, w: 0.8 }],
  }),
  "3R-A": Object.assign({}, base, {
    name: "3-room (576 ft²)", type: "3R", ft2: 576, src: "after Park Silicon · Palo Springs, Tower 2B unit A, 576 ft²",
    facade: "s", partySides: ["w", "e"],
    rooms: [R("r1", "BR", "Bedroom 1", 0, 0, 2.4, 2.8), R("b", "BATH", "Bath", 2.4, 0, 1.5, 2.0), R("k", "OKIT", "Open kitchen", 3.9, 0, 1.8, 2.0),
      R("e", "LOBBY", "", 5.7, 0, 1.5, 2.0), R("h", "LOBBY", "", 2.4, 2.0, 2.6, 0.8), R("l", "LD", "Living / dining", 5.0, 2.0, 2.2, 3.2),
      R("m", "MBR", "Master bedroom", 0.3, 2.8, 2.6, 2.6), R("r2", "BR", "Bedroom 2", 2.9, 2.8, 2.1, 2.4)],
    extras: [{ kind: "bay", x: 4.4, y: 5.2, w: 2.8, h: 1.4, splay: 0.6, parts: [{ kind: "up", len: 1.2 }, { kind: "bal", len: 1.6 }] }, { kind: "acp", x: 0.6, y: 5.4, w: 2.0, h: 0.6 }, { kind: "pd", x: 4.0, y: 5.2, w: 0.4, h: 0.4 }],
    doors: [{ room: "e", side: "n", at: 0.3, w: 0.9, entry: true }, { room: "r1", side: "e", at: 2.1, w: 0.8 }, { room: "b", side: "s", at: 0.4, w: 0.75 }, { room: "m", side: "n", at: 2.0, w: 0.8 }, { room: "r2", side: "n", at: 0.6, w: 0.8 }],
  }),
  "3R-B": Object.assign({}, base, {
    name: "3-room (524 ft²)", type: "3R", ft2: 524, src: "after Park Silicon · Palo Springs, Tower 2B unit B, 524 ft²",
    facade: "s", partySides: ["w", "e"],
    rooms: [R("k", "OKIT", "Open kitchen", 0, 0, 2.0, 1.8), R("e", "LOBBY", "", 2.0, 0, 1.0, 1.8), R("l", "LD", "Living / dining", 0, 1.8, 3.0, 3.4),
      R("b", "BATH", "Bath", 3.0, 0.4, 1.6, 1.8), R("h", "LOBBY", "", 3.0, 2.2, 4.2, 0.8),
      R("r2", "BR", "Bedroom 2", 3.0, 3.0, 2.1, 2.2), R("r1", "BR", "Bedroom 1", 5.1, 3.0, 2.1, 2.2), R("m", "MBR", "Master bedroom", 7.2, 2.2, 2.5, 3.0)],
    extras: [{ kind: "roof", x: 3.0, y: 5.2, w: 6.7, h: 1.0 }, { kind: "bay", x: 0, y: 5.2, w: 3.0, h: 1.3, parts: [{ kind: "bal", len: 1.6 }, { kind: "up", len: 1.2 }, { kind: "acp", len: 0.6 }] }],
    doors: [{ room: "e", side: "n", at: 0.05, w: 0.9, entry: true }, { room: "b", side: "s", at: 0.4, w: 0.75 }, { room: "r2", side: "n", at: 1.1, w: 0.8 }, { room: "r1", side: "n", at: 1.1, w: 0.8 }, { room: "m", side: "w", at: 0.1, w: 0.8 }],
  }),
  /* the office's typical units (LWK + Partners typical floor plans), from their dimension strings - each scaled to the saleable area printed under it */
  "LWK-1BR": Object.assign({}, base, {
    name: "1-bedroom (262 ft²)", type: "1R", ft2: 262, src: "after the office's typical plan 1BR OPT1 (262 ft²): bath 2025 × 1150, MBR 2025 × 2320, L/D 2350 × 4420",
    facade: "s", partySides: ["w", "e"],
    rooms: [R("b", "BATH", "Bath", 0, 0, 2.1, 1.3), R("h", "LOBBY", "", 2.1, 0, 2.45, 1.3),
      R("m", "MBR", "Master bedroom", 0, 1.3, 2.1, 3.1), R("l", "LD", "Living / dining", 2.1, 1.3, 2.45, 3.1)],
    zones: [{ kind: "OKIT", x: 3.25, y: 0, w: 1.3, h: 1.3 }],
    extras: [{ kind: "bay", x: 1.0, y: 4.4, w: 3.55, h: 1.5, parts: [{ kind: "up", len: 1.1 }, { kind: "bal", len: 2.45 }] }, { kind: "pd", x: 0, y: -0.7, w: 1.2, h: 0.7 }],
    doors: [{ room: "h", side: "n", at: 0.1, w: 0.9, entry: true }, { room: "b", side: "e", at: 0.3, w: 0.75 }, { room: "m", side: "e", at: 0.2, w: 0.82 }],
  }),
  "LWK-2BR": Object.assign({}, base, {
    name: "2-bedroom (360 ft²)", type: "2R", ft2: 360, src: "after the office's typical plan 2BR OPT1 (359.8 ft²): BR 2025 × 2920, L/D 2400 × 4320, BR 2000 × 2195, bath 1250 × 2050",
    facade: "n", partySides: ["w", "e"],
    rooms: [R("r1", "BR", "Bedroom 1", 0, 0, 2.1, 3.6), R("l", "LD", "Living / dining", 2.1, 0, 2.5, 5.2),
      R("r2", "BR", "Bedroom 2", 4.6, 0, 2.1, 2.3), R("b", "BATH", "Bath", 4.6, 2.3, 2.1, 2.9)],
    zones: [{ kind: "OKIT", x: 2.1, y: 4.4, w: 1.9, h: 0.8 }],
    extras: [{ kind: "bay", x: 1.1, y: -1.6, w: 3.5, h: 1.6, parts: [{ kind: "up", len: 1.0 }, { kind: "bal", len: 2.5 }] }],
    doors: [{ room: "l", side: "s", at: 1.55, w: 0.95, entry: true }, { room: "r1", side: "e", at: 2.7, w: 0.82 }, { room: "r2", side: "w", at: 1.4, w: 0.82 }, { room: "b", side: "w", at: 0.5, w: 0.75 }],
  }),
  "LWK-2.5BR": Object.assign({}, base, {
    name: "2-bedroom + study (435 ft²)", type: "2R", ft2: 435, src: "after the office's typical plan 2.5BR OPT1 (434.8 - 443.9 ft²): BR 2025 × 2150, L/D 2450 × 5175, MBR 2000 × 2750",
    facade: "s", partySides: ["w", "e"],
    rooms: [R("b", "BATH", "Bath", 0, 0, 2.1, 1.9), R("s", "STUDY", "Study", 0, 1.9, 2.1, 1.55), R("r1", "BR", "Bedroom 1", 0, 3.45, 2.1, 2.25),
      R("l", "LD", "Living / dining", 2.1, 0, 2.55, 5.7), R("e", "STORE", "Store", 4.65, 0, 2.1, 1.0), R("h", "LOBBY", "", 4.65, 1.0, 2.1, 1.85), R("m", "MBR", "Master bedroom", 4.65, 2.85, 2.1, 2.85)],
    zones: [{ kind: "OKIT", x: 2.1, y: 0, w: 2.0, h: 0.85 }],
    extras: [{ kind: "bay", x: 2.1, y: 5.7, w: 2.6, h: 1.5, parts: [{ kind: "bal", len: 1.6 }, { kind: "up", len: 1.0 }] }],
    doors: [{ room: "h", side: "n", at: 0.05, w: 0.95, entry: true }, { room: "b", side: "e", at: 0.5, w: 0.75 }, { room: "s", side: "e", at: 0.3, w: 0.8 }, { room: "r1", side: "e", at: 0.3, w: 0.82 }, { room: "m", side: "n", at: 0.2, w: 0.82 }, { room: "e", side: "s", at: 0.6, w: 0.7 }],
  }),
  "LWK-3BR": Object.assign({}, base, {
    name: "3-bedroom (3BR-1)", type: "3R", src: "after the office's typical plan 3BR-1 option 1: L/D 2600 × 4050, BR1 / BR2 2050 × 2150, corridor 900, bath 2050 × 1450, MBR 3175 × 2050, curtain wall at the MBR",
    facade: "n", partySides: ["w"],
    rooms: [R("l", "LD", "Living / dining", 0, 0, 2.7, 5.6), R("r1", "BR", "Bedroom 1", 2.7, 0, 2.15, 2.25), R("r2", "BR", "Bedroom 2", 4.85, 0, 2.15, 2.25),
      R("h", "LOBBY", "", 2.7, 2.25, 4.3, 1.0), R("b", "BATH", "Bath 1", 2.7, 3.25, 2.15, 1.55), R("m", "MBR", "Master bedroom", 4.85, 3.25, 3.3, 2.15)],
    zones: [{ kind: "OKIT", x: 0, y: 3.4, w: 0.9, h: 2.2 }],
    walls: { "m:e": { f: "cw" } },
    extras: [{ kind: "bay", x: 0, y: -1.6, w: 2.7, h: 1.6, parts: [{ kind: "bal", len: 1.7 }, { kind: "up", len: 1.0 }] }],
    doors: [{ room: "l", side: "s", at: 1.0, w: 0.95, entry: true }, { room: "r1", side: "s", at: 1.2, w: 0.82 }, { room: "r2", side: "s", at: 0.2, w: 0.82 }, { room: "b", side: "n", at: 0.6, w: 0.75 }, { room: "m", side: "n", at: 0.3, w: 0.82 }],
  }),
};

const STUDIO = fromRows(Object.assign({}, base, {
  name: "Studio", type: "studio", left: "party", right: "party",
  rows: [
    { depth: 1.9, rooms: [{ kind: "BATH", name: "Bath", w: 1.5 }, { kind: "OKIT", name: "Open kitchen", w: 1.8 }] },
    { depth: 3.6, rooms: [{ kind: "LD", name: "Living / bed", w: 3.4 }] },
  ],
  extras: [{ kind: "up", w: 1.5, d: 1.0 }, { kind: "acp", w: 1.0, d: 0.6 }],
}));
STUDIO.doors = [{ room: "r1", side: "n", at: 0.3, w: 0.75 }, { room: "r2", side: "n", at: 0.6, w: 0.9, entry: true }];
STUDIO.src = "a compact studio";

const finish = (t) => { t.windows = genWindows(t); t.fixtures = genFixtures(t); zoneKitchens(t); return t; };
const scaled = (t) => (t.ft2 ? scaleTo(t, t.ft2) : JSON.parse(JSON.stringify(t)));
export const TEMPLATES = Object.assign({ studio: finish(STUDIO) },
  Object.fromEntries(Object.entries(RAW).map(([k, t]) => [k, finish(scaled(t))])));
