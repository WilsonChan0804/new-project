/* Unit templates, after the sales brochure plans of recent Tseung Kwan O
 * flats (studio about 240 ft², 1-room about 285 ft², 2-room about 440 ft²,
 * 3-room about 700 ft²). Rows run from the corridor (first) to the façade
 * (last); widths and depths in metres. Adjust them to the project. */
export const TEMPLATES = {
  studio: {
    name: "Studio", type: "studio", wall: 0.2, party: 0.2, part: 0.1, left: "party", right: "party",
    rows: [
      { depth: 1.9, rooms: [{ kind: "BATH", name: "Bath", w: 1.5 }, { kind: "OKIT", name: "Open kitchen", w: 1.8 }] },
      { depth: 3.6, rooms: [{ kind: "LD", name: "Living / bed", w: 3.4 }] },
    ],
    extras: [{ kind: "up", w: 1.5, d: 1.0 }, { kind: "acp", w: 1.0, d: 0.6 }],
  },
  "1R": {
    name: "1-room", type: "1R", wall: 0.2, party: 0.2, part: 0.1, left: "party", right: "party",
    rows: [
      { depth: 1.6, rooms: [{ kind: "BATH", name: "Bath", w: 1.4 }, { kind: "KIT", name: "Kitchen", w: 1.6 }] },
      { depth: 2.6, rooms: [{ kind: "LD", name: "Living / dining", w: 3.1 }] },
      { depth: 2.4, rooms: [{ kind: "BR", name: "Bedroom", w: 2.4 }, { kind: "STORE", name: "Wardrobe", w: 0.6 }] },
    ],
    extras: [{ kind: "bal", w: 1.6, d: 1.25 }, { kind: "up", w: 1.5, d: 1.0 }, { kind: "acp", w: 1.0, d: 0.6 }],
  },
  "2R": {
    name: "2-room", type: "2R", wall: 0.2, party: 0.2, part: 0.1, left: "party", right: "party",
    rows: [
      { depth: 1.8, rooms: [{ kind: "KIT", name: "Kitchen", w: 1.8 }, { kind: "BATH", name: "Bath", w: 1.5 }, { kind: "ENTRY", name: "Entrance", w: 1.5 }] },
      { depth: 2.6, rooms: [{ kind: "LD", name: "Living / dining", w: 5.0 }] },
      { depth: 2.6, rooms: [{ kind: "MBR", name: "Bedroom 1", w: 2.7 }, { kind: "BR", name: "Bedroom 2", w: 2.2 }] },
    ],
    extras: [{ kind: "bal", w: 2.0, d: 1.2 }, { kind: "up", w: 1.5, d: 1.0 }, { kind: "acp", w: 1.2, d: 0.6 }],
  },
  "3R": {
    name: "3-room", type: "3R", wall: 0.2, party: 0.2, part: 0.1, left: "party", right: "party",
    rows: [
      { depth: 2.0, rooms: [{ kind: "KIT", name: "Kitchen", w: 2.0 }, { kind: "BATH", name: "Bath", w: 1.5 }, { kind: "ENTRY", name: "Entrance", w: 1.3 }, { kind: "STORE", name: "Store", w: 0.9 }] },
      { depth: 2.9, rooms: [{ kind: "LD", name: "Living / dining", w: 6.0 }] },
      { depth: 2.6, rooms: [{ kind: "MBR", name: "Master bedroom", w: 2.8 }, { kind: "BR", name: "Bedroom 2", w: 3.1 }] },
      { depth: 2.3, rooms: [{ kind: "BR", name: "Bedroom 3", w: 2.4 }, { kind: "ENS", name: "Ensuite", w: 1.5 }, { kind: "STORE", name: "Wardrobe", w: 1.9 }] },
    ],
    extras: [{ kind: "bal", w: 2.4, d: 1.3 }, { kind: "up", w: 1.5, d: 1.0 }, { kind: "acp", w: 1.2, d: 0.6 }, { kind: "acp", w: 1.2, d: 0.6 }],
  },
};
