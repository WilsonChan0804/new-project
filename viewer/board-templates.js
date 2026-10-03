/* What a new board starts with.
 *
 * Each template is just a list of ordinary objects, made here and sent
 * with the request that creates the board - there is nothing special about
 * a "Kanban board" once it exists; it is frames and stickies anyone can
 * move, recolour or delete.
 */

import { uid, STICKY_COLORS, BRANCH_COLORS } from "./board-util.js";

let Z = 0;
const z = () => ++Z;

const sticky = (x, y, text, fill, w, h) => ({ id: uid(), t: "sticky", x, y, w: w || 150, h: h || 150, z: z(),
                                               text: text || "", fill: fill || STICKY_COLORS[0] });
const text = (x, y, s, fs, w, bold) => ({ id: uid(), t: "text", x, y, w: w || 420, h: Math.round((fs || 16) * 1.5),
                                          z: z(), text: s, fs: fs || 16, bold: !!bold });
const frame = (x, y, w, h, title, fill) => ({ id: uid(), t: "frame", x, y, w, h, z: z(), text: title,
                                              fill: fill || "#ffffff" });

function node(parent, s, extra) {
  return Object.assign({ id: uid("n"), t: "node", parent: parent ? parent.id : null, text: s, z: z() }, extra || {});
}

function mindmap() {
  const root = node(null, "Central topic", { x: -70, y: -22 });
  const out = [root];
  const main = [
    ["Goals", "r", ["What must be true at the end", "How we will know"]],
    ["People", "r", ["Who decides", "Who needs to be told"]],
    ["Risks", "l", ["What could stop it", "What we do not know yet"]],
    ["Next steps", "l", ["This week", "Later"]],
  ];
  main.forEach(([label, side, subs], i) => {
    const b = node(root, label, { side, ord: i + 1, bc: BRANCH_COLORS[i] });
    out.push(b);
    subs.forEach((s, k) => out.push(node(b, s, { ord: k + 1 })));
  });
  return out;
}

function brainstorm() {
  const out = [text(-330, -330, "Brainstorm", 28, 400, true),
               text(-330, -286, "One idea per note. Write first, sort afterwards. Use the reactions to vote.", 14, 640)];
  const cols = 4, rows = 3, gap = 16, size = 150;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push(sticky(-330 + c * (size + gap), -240 + r * (size + gap), "", STICKY_COLORS[(r * cols + c) % 8]));
    }
  }
  return out;
}

function swot() {
  const W = 420, H = 320, G = 20;
  const q = [["Strengths", "#eaf7e9", "#c3efc0", ["What we do well"]],
             ["Weaknesses", "#fdeeee", "#ffc2c2", ["Where we lose time"]],
             ["Opportunities", "#eaf2ff", "#bfd9ff", ["What we could start"]],
             ["Threats", "#fff6e5", "#ffd6a5", ["What could go wrong"]]];
  const out = [];
  q.forEach(([title, fill, note, hints], i) => {
    const x = -W - G / 2 + (i % 2) * (W + G), y = -H - G / 2 + Math.floor(i / 2) * (H + G);
    out.push(frame(x, y, W, H, title, fill));
    hints.forEach((h, k) => out.push(sticky(x + 20 + k * 166, y + 24, h, note)));
  });
  return out;
}

function kanban() {
  const W = 300, H = 620, G = 20;
  const cols = [["To do", ["First task", "Second task", "Third task"], STICKY_COLORS[0]],
                ["Doing", ["In hand"], STICKY_COLORS[5]],
                ["Done", ["Finished"], STICKY_COLORS[7]]];
  const out = [];
  cols.forEach(([title, notes, fill], i) => {
    const x = -1.5 * W - G + i * (W + G), y = -H / 2;
    out.push(frame(x, y, W, H, title, "#f7f8fa"));
    notes.forEach((n, k) => out.push(sticky(x + 20, y + 20 + k * 126, n, fill, 260, 110)));
  });
  return out;
}

function notes() {
  const W = 400, G = 20;
  const d = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const out = [text(-W - G / 2, -400, "Meeting notes", 28, 500, true),
               text(-W - G / 2, -356, d + "  -  who was there:", 14, 600)];
  const boxes = [["Agenda", "1. \n2. \n3. ", 0, 0, 240],
                 ["Rules and settings we agreed", "- \n- \n- ", 1, 0, 240],
                 ["Notes", "", 0, 1, 280],
                 ["Actions (who, by when)", "- \n- ", 1, 1, 280]];
  let y = -310;
  for (let row = 0; row < 2; row++) {
    const h = boxes[row * 2][4];
    for (let c = 0; c < 2; c++) {
      const [title, body] = boxes[row * 2 + c];
      const x = -W - G / 2 + c * (W + G);
      out.push(frame(x, y, W, h, title, c === 1 && row === 0 ? "#fff8f1" : "#ffffff"));
      const tx = text(x + 16, y + 16, body, 15, W - 32);
      tx.h = h - 32;
      out.push(tx);
    }
    y += h + G + 26;
  }
  return out;
}

export const TEMPLATES = [
  { id: "blank", name: "Blank", hint: "An empty canvas", make: () => [] },
  { id: "mindmap", name: "Mind map", hint: "A central topic and its branches", make: mindmap },
  { id: "brainstorm", name: "Brainstorm", hint: "A grid of sticky notes", make: brainstorm },
  { id: "swot", name: "SWOT", hint: "Strengths, weaknesses, opportunities, threats", make: swot },
  { id: "kanban", name: "Kanban", hint: "To do / Doing / Done", make: kanban },
  { id: "notes", name: "Meeting notes", hint: "Agenda, rules, notes, actions", make: notes },
];

export function makeTemplate(id) {
  Z = 0;
  const t = TEMPLATES.find((x) => x.id === id) || TEMPLATES[0];
  return t.make();
}

/* A little picture of each template for the "new board" cards. */
export function templateThumb(id) {
  const R = (x, y, w, h, f, extra) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${f}" ${extra || ""}/>`;
  const line = 'stroke="#c9d0da" fill="none"';
  const art = {
    blank: `<circle cx="40" cy="26" r="1.2" fill="#c9d0da"/><circle cx="28" cy="26" r="1.2" fill="#c9d0da"/>`
      + `<circle cx="52" cy="26" r="1.2" fill="#c9d0da"/><circle cx="40" cy="14" r="1.2" fill="#c9d0da"/>`
      + `<circle cx="40" cy="38" r="1.2" fill="#c9d0da"/>`,
    mindmap: `<path d="M34 26C24 26 26 12 16 12M34 26C24 26 26 40 16 40" stroke="#3b82f6" fill="none" stroke-width="1.5"/>`
      + `<path d="M46 26C56 26 54 12 64 12M46 26C56 26 54 40 64 40" stroke="#f28022" fill="none" stroke-width="1.5"/>`
      + R(30, 21, 20, 10, "#1f2430") + R(4, 8, 12, 7, "#dbe8ff") + R(4, 36, 12, 7, "#dbe8ff")
      + R(64, 8, 12, 7, "#ffe2c7") + R(64, 36, 12, 7, "#ffe2c7"),
    brainstorm: [0, 1, 2, 3].map((c) => [0, 1, 2].map((r) =>
      R(10 + c * 16, 6 + r * 14, 13, 11, STICKY_COLORS[(r * 4 + c) % 8])).join("")).join(""),
    swot: R(8, 5, 31, 20, "#eaf7e9", line) + R(41, 5, 31, 20, "#fdeeee", line)
      + R(8, 27, 31, 20, "#eaf2ff", line) + R(41, 27, 31, 20, "#fff6e5", line)
      + R(11, 9, 8, 8, "#c3efc0") + R(44, 9, 8, 8, "#ffc2c2") + R(11, 31, 8, 8, "#bfd9ff") + R(44, 31, 8, 8, "#ffd6a5"),
    kanban: R(7, 5, 20, 42, "#f7f8fa", line) + R(30, 5, 20, 42, "#f7f8fa", line) + R(53, 5, 20, 42, "#f7f8fa", line)
      + R(9, 8, 16, 8, STICKY_COLORS[0]) + R(9, 18, 16, 8, STICKY_COLORS[0]) + R(9, 28, 16, 8, STICKY_COLORS[0])
      + R(32, 8, 16, 8, STICKY_COLORS[5]) + R(55, 8, 16, 8, STICKY_COLORS[7]),
    notes: R(8, 4, 26, 3, "#1f2430") + R(8, 11, 30, 16, "#fff", line) + R(42, 11, 30, 16, "#fff8f1", line)
      + R(8, 30, 30, 17, "#fff", line) + R(42, 30, 30, 17, "#fff", line)
      + `<path d="M11 16h18M11 20h14M45 16h18M45 20h12M11 36h20M45 36h16" stroke="#9aa3af" stroke-width="1"/>`,
  };
  return `<svg viewBox="0 0 80 52" width="80" height="52" aria-hidden="true">${art[id] || ""}</svg>`;
}
