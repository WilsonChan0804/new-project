/* The "LWK BIM Workflow" board: the company's BIM workflow, roles, work
 * stages, CDE states, QA/QC and the BIM audit checklist, as ordinary board
 * objects - frames, shapes, stickies, text and arrows - that each project
 * then changes to suit itself.
 *
 * Made when a project first opens its Board page (board.js asks the server
 * once per project) and from New board > LWK BIM Workflow. The reference
 * pictures are kept on the server (server/templates/bim_workflow) and come
 * in as snapshot paths (images).
 *
 * Sources: LWK BIM Meeting Workflow Draft 23-0905, the Revit team roles
 * (2023), the BIM Roadmap, the GBP + BD Area Tool workflow and the
 * Quality Assurance and BIM Audit Checklist.
 */

import { uid } from "./board-util.js";

/* ------------------------------------------------------------ colours */

// one colour per role, used in every flow chart: [name, short, strong, light]
const ROLE = {
  bimm: ["UK/HK BIM Manager", "BIM Mgr", "#3e9e91", "#d6efeb"],
  hkc: ["HK BIM Coordinator", "HK Coord", "#7bb83a", "#e5f3d3"],
  mnls: ["MNL Senior BIM Coordinator", "MNL Sr Coord", "#ee8a5c", "#fde3d6"],
  mnll: ["MNL Task Team Lead", "MNL Lead", "#e8a800", "#fcefc4"],
  mnla: ["MNL BIM Authors (Senior / Junior Modeler)", "MNL Authors", "#e9cf55", "#fdf6d8"],
  pts: ["Project Team (Senior)", "PT Senior", "#2b7bd6", "#d8e7f8"],
  ptj: ["Project Team (Junior)", "PT Junior", "#6fb2ea", "#e5f1fc"],
  des: ["Design Team", "Design", "#2fb24e", "#d9f2df"],
  cad: ["HK CAD Team", "CAD", "#9a7414", "#efe4c6"],
  ext: ["Client / Consultants / Contractor", "External", "#8a8f98", "#e9eaed"],
};
const INK = "#1f2430", LINE = "#5b6472", GRID = "#d3d8df";

/* ------------------------------------------------------------ builder */

function builder() {
  let Z = 0;
  const z = () => ++Z;
  // how tall a block of text wraps to (an estimate: the board measures again when edited)
  const lines = (s, w, fs) => {
    const per = Math.max(6, Math.floor(w / (fs * 0.56)));
    return String(s).split("\n").reduce((n, p) => n + Math.max(1, Math.ceil(p.length / per)), 0);
  };
  const tall = (s, w, fs, pad) => Math.ceil(lines(s, w - 2 * pad, fs) * fs * 1.38 + 2 * pad + 4);
  const B = {
    frame: (x, y, w, h, title, fill) => ({ id: uid(), t: "frame", x, y, w, h, z: z(), text: title, fill: fill || "#ffffff" }),
    text: (x, y, w, s, fs, bold, color) => {
      fs = fs || 14;
      const o = { id: uid(), t: "text", x, y, w, h: tall(s, w, fs, 4), z: z(), text: s, fs, bold: !!bold };
      if (color) o.color = color;
      return o;
    },
    sticky: (x, y, w, s, fill, fs, align, h) => {
      fs = fs || 13;
      const o = { id: uid(), t: "sticky", x, y, w, h: Math.max(h || 0, tall(s, w, fs, 14)), z: z(), text: s, fill: fill || "#fff3a3", fs };
      if (align) o.align = align;
      return o;
    },
    shape: (x, y, w, h, s, opt) => {
      opt = opt || {};
      const fs = opt.fs || 12;
      const inner = opt.kind === "diamond" ? w * 0.62 : w;
      const o = { id: uid(), t: "shape", kind: opt.kind || "round", x, y, w, h: Math.max(h, opt.kind === "diamond" ? h : tall(s, inner, fs, 8)),
                  z: z(), text: s, fill: opt.fill || "#ffffff", stroke: opt.stroke || GRID, sw: opt.sw || 1.5, fs };
      if (opt.color) o.color = opt.color;
      if (opt.align) o.align = opt.align;
      if (opt.bold) o.bold = true;
      return o;
    },
    arrow: (a, b, label, opt) => {
      opt = opt || {};
      const o = { id: uid("c"), t: "conn", a: { o: a.id }, b: { o: b.id }, kind: opt.kind || "elbow", arrow: opt.arrow || "end",
                  sw: 1.5, color: opt.color || LINE, z: z() };
      if (label) { o.text = label; o.fs = 11; }
      if (opt.dash) o.dash = true;
      return o;
    },
    // an arrow that turns where it is told (pts: [x, y] corners), so it can
    // go round the boxes in its way: straight pieces, the last with the head
    path: (a, b, pts, label, opt) => {
      opt = opt || {};
      const ends = [{ o: a.id }, ...pts.map(([x, y]) => ({ x, y })), { o: b.id }];
      const out = [];
      for (let i = 0; i < ends.length - 1; i++) {
        const o = { id: uid("c"), t: "conn", a: { ...ends[i] }, b: { ...ends[i + 1] }, kind: "straight",
                    arrow: i === ends.length - 2 ? "end" : "none", sw: 1.5, color: opt.color || LINE, z: z() };
        if (label && i === (opt.at || 0)) { o.text = label; o.fs = 11; }
        if (opt.dash) o.dash = true;
        out.push(o);
      }
      return out;
    },
    // an arrow to a point (the side of a tall box, level with where it starts)
    toPoint: (a, x, y, opt) => {
      opt = opt || {};
      return { id: uid("c"), t: "conn", a: { o: a.id }, b: { x, y }, kind: "straight", arrow: "end", sw: 1.5, color: opt.color || LINE, z: z() };
    },
    tall,
  };
  return B;
}

// objects made at 0,0 moved to x,y (arrows follow the ends they are tied
// to; their loose ends - the corners of a path - are moved here)
function shift(list, dx, dy) {
  for (const o of list) {
    if (o.t !== "conn") { o.x = Math.round(o.x + dx); o.y = Math.round(o.y + dy); continue; }
    for (const e of [o.a, o.b]) if (e && !e.o) { e.x = Math.round(e.x + dx); e.y = Math.round(e.y + dy); }
  }
  return list;
}

/* A table of shapes: one row per line, the cells left-aligned. */
function table(B, x, y, widths, rows, opt) {
  opt = opt || {};
  const fs = opt.fs || 12, out = [];
  let yy = y;
  rows.forEach((row, r) => {
    const head = opt.head && r === 0;
    const h = Math.max(opt.minH || 34, ...row.map((c, i) => B.tall(typeof c === "string" ? c : c.s, widths[i], fs, 9)));
    let xx = x;
    row.forEach((c, i) => {
      const cell = typeof c === "string" ? { s: c } : c;
      const fill = cell.fill || (head ? (opt.headFill || "#e9edf2") : (opt.fills && opt.fills[r]) || (r % 2 ? "#ffffff" : "#f7f8fa"));
      out.push(B.shape(xx, yy, widths[i], h, cell.s, { kind: "rect", fill, stroke: GRID, sw: 1, fs, align: cell.center ? "" : "left",
                                                     bold: head || cell.bold, color: cell.color }));
      xx += widths[i];
    });
    yy += h;
  });
  return { items: out, h: yy - y };
}

/* A flow chart on a grid of cells: steps coloured by who does them. */
function flow(B) {
  const CW = 250, RH = 150, out = [];
  const at = (c, r, w, h) => [c * CW + (CW - w) / 2, r * RH + (RH - h) / 2];
  const names = (roles) => roles.map((k) => ROLE[k][1]).join(" · ");
  const F = {
    out,
    step(c, r, s, roles) {
      const role = ROLE[(roles || [])[0]];
      const label = roles && roles.length ? s + "\n▸ " + names(roles) : s;
      const [x, y] = at(c, r, 212, 100);
      const o = B.shape(x, y, 212, 100, label, { kind: "round", fill: role ? role[3] : "#f1f3f6", stroke: role ? role[2] : "#aab1bb", fs: 12 });
      o.y = Math.round(r * RH + (RH - o.h) / 2);
      out.push(o);
      return o;
    },
    ask(c, r, s) {
      const [x, y] = at(c, r, 176, 124);
      const o = B.shape(x, y, 176, 124, s, { kind: "diamond", fill: "#ffffff", stroke: "#6b7480", fs: 11 });
      out.push(o);
      return o;
    },
    end(c, r, s) {
      const [x, y] = at(c, r, 130, 54);
      const o = B.shape(x, y, 130, 54, s, { kind: "round", fill: "#2b303b", stroke: "#2b303b", color: "#ffffff", fs: 13, bold: true });
      out.push(o);
      return o;
    },
    ref(c, r, s) {
      const [x, y] = at(c, r, 190, 70);
      const o = B.shape(x, y, 190, 70, s, { kind: "round", fill: "#eef0f3", stroke: "#c3c8d0", fs: 12, color: "#4b5563" });
      out.push(o);
      return o;
    },
    go(a, b, label, opt) { out.push(B.arrow(a, b, label, opt)); },
    // corners in grid units: 1.5 is the gap between columns (rows) 1 and 2
    path(a, b, cells, label, opt) { out.push(...B.path(a, b, cells.map(([c, r]) => [c * CW + CW / 2, r * RH + RH / 2]), label, opt)); },
    size(cols, rows) { return [cols * CW, rows * RH]; },
  };
  return F;
}

// the role colours, as a row of chips
function legend(B, x, y, keys) {
  const out = [];
  let xx = x;
  for (const k of keys) {
    const [name, , strong, light] = ROLE[k];
    const w = Math.max(120, Math.round(name.length * 6.6) + 24);
    out.push(B.shape(xx, y, w, 30, name, { kind: "round", fill: light, stroke: strong, fs: 11 }));
    xx += w + 8;
  }
  return out;
}

/* A frame round a block made at 0,0: title above, content inset. */
function boxed(B, title, fill, w, h, items, sub) {
  const P = 28;
  const head = sub ? [B.text(P, P - 6, w - 2 * P, sub, 13, false, "#4b5563")] : [];
  const top = sub ? P + head[0].h + 6 : P;
  shift(items, P, top);
  const f = B.frame(0, 0, w + 2 * P, h + top + P, title, fill);
  return { items: [f, ...head, ...items], w: f.w, h: f.h };
}

/* ------------------------------------------------------------ frames */

function projectCard(B, info) {
  const s = [
    "Project number:  " + (info.number || "________"),
    "Project name:  " + (info.name || "________"),
    "Building / zone:  ________",
    "Model file name(s):  ________",
    "Client:  ________",
    "",
    "Current work stage:  ☐ Inception  ☐ Design brief & feasibility  ☐ Scheme design  ☐ Design development  ☐ Statutory approvals  ☐ Tender documentation  ☐ Construction  ☐ Completion & handover",
    "",
    "Software in use:  ☐ Revit  ☐ ArchiCAD  ☐ AutoCAD  ☐ Rhino / SketchUp  ☐ Navisworks",
    "CDE location (ACC / server folder):  ________",
    "Key dates / milestones:  ________",
    "",
    "On this project in the viewer: Sheets · 3D · Tasks · Folders · Chat (the links at the top of the page)",
  ].join("\n");
  const t = B.sticky(0, 0, 520, s, "#ffffff", 13, "left");
  return boxed(B, "0  Project card - fill in at kick-off", "#fff8f1", 520, t.h, [t]);
}

function howTo(B) {
  const s = [
    "1. Fill in the Project card and the names in Team & roles at kick-off.",
    "2. The flow charts show each step and WHO does it - the colour is the role (see the key in each chart).",
    "3. When a step is given to someone, make it a Task (Tasks page) with a due date.",
    "4. Comments on drawings and the model: raise an Issue on the sheet or in 3D, not by email.",
    "5. Run the QA/QC checks and the BIM audit bi-weekly, before each information exchange and at the end of each work stage.",
    "6. Keep project-specific rules, decisions and open questions in 'Project notes'.",
    "7. This board belongs to the project: move, add, recolour or delete anything to suit it.",
  ].join("\n");
  const t = B.sticky(0, 0, 520, s, "#fff3a3", 13, "left");
  return boxed(B, "1  How to use this board", "#ffffff", 520, t.h, [t]);
}

function roles(B) {
  const rows = [
    ["Role", "Main responsibilities", "Required knowledge in BIM", "Name(s)"],
    ["bimm", "Set up the BIM standard / template; BIM Execution Plan / Project Information Requirement; modelling and calculation solutions; automations and custom tools for Revit; training; check and approve the project setup.",
     "Programming (Dynamo, Python, C#); Rhino.Inside Revit, Grasshopper, Helix; expert in Revit and Navisworks; ISO 19650; basic Rhino, SketchUp, ArchiCAD"],
    ["hkc", "Provide project template, PxP, survey and reference plans, grids & levels masterfile, mark-ups and instructions; modelling, calculation, audit and clash report; audit the graphic / modelling standard and statutory compliance.",
     "Expert in Revit and Navisworks; Rhino.Inside Revit, Grasshopper; ISO 19650"],
    ["mnls", "Link between HK and Manila; Manila team coordination meetings; quality checks; regular progress report to HK BIM team; attend the BIM meeting chaired by HK BIM team.",
     "Revit, Navisworks, ISO 19650; BIM protocol and collaboration procedures"],
    ["mnll", "Assign tasks and make sure they meet deadlines; develop and maintain the BIM protocol / BEP for the project; QA/QC (standards, dataset, interference, methodology, design checks); file management and submission packages; training.",
     "Revit modelling and collaboration tools; family creation; Navisworks"],
    ["mnla", "Translate all information into the Revit model; drawing production (plans, sections, elevations, details); family creation; pre-test models; revise and update drawings; assist the clash report.",
     "Revit modelling, collaboration tools, family creation; basic Navisworks, Rhino, SketchUp, ArchiCAD"],
    ["pts", "Preview the model (Revit / Navisworks / LWK Viewer); mark up; audit statutory compliance; design check.", "Preview and mark-up tools"],
    ["ptj", "Modify the model in Revit; preview; mark up.", "Revit modelling and collaboration tools; preview and mark-up"],
    ["des", "Provide design information to the BIM team; inspect / verify the design in the Revit model; interconvert the Revit model to ArchiCAD, Rhino, SketchUp for further design.",
     "Rhino.Inside Revit, Grasshopper, Helix; tools to preview / export 2D and 3D from Revit"],
    ["cad", "Diagrams, details, built-up sections / elevations (> 1:50) and diagrammatic sections for statutory and tender drawings.", "AutoCAD; LWK CAD standard"],
    ["ext", "E&M / structural advice, design requirements, comments; coordination and reference through shared models and AutoCAD layouts.", "-"],
  ].map((r, i) => (i === 0 ? r : [{ s: ROLE[r[0]][0], fill: ROLE[r[0]][3], bold: true }, r[1], r[2], "________"]));
  const t = table(B, 0, 0, [230, 560, 380, 170], rows, { head: true, fs: 12 });
  return boxed(B, "2  Team & roles", "#ffffff", 1340, t.h, t.items, "The colour of each role is used in all the flow charts. Fill in the names for this project.");
}

const STAGES = [
  ["Inception", "#f3c9ec", "HK Design Team", "Design concept / massing model (SketchUp / Rhino / ArchiCAD)"],
  ["Design brief and feasibility", "#eaa6dd", "Design Team + Project Team", "Massing, feasibility layouts"],
  ["Scheme design", "#d77ac9", "Design Team → Project Team → BIM", "Scheme model; quick sketches for coordination with consultants"],
  ["Design development", "#c6ecfa", "Project Team ↔ HK BIM Team ↔ Revit Team (Manila); consultants' E&M / structural advice and design requirements",
   "Design-stage Revit model; clash detection; AutoCAD layout for coordination / reference"],
  ["Statutory approvals", "#97dcf6", "HK BIM Team (calculation, audit) + HK CAD Team", "Statutory plans (2D); GBP submission"],
  ["Tender documentation and procurement", "#67c8ef", "HK CAD Team (details, built-up sections / elevations > 1:50) + BIM", "Tender drawings (2D); schedules"],
  ["Construction", "#f9cbaa", "Contractor team + Project Team", "Construction-stage Revit model"],
  ["Completion and handover", "#f2a982", "Project Team + BIM Team", "As-built model; archive"],
  ["(Any stage)", "#eef0f3", "Project Team", "Sales brochure plans / elevations"],
];
function stages(B) {
  const rows = [["Work stage", "Who (main flow)", "Output"]].concat(STAGES.map(([n, c, who, out]) => [{ s: n, fill: c, bold: true }, who, out]));
  const t = table(B, 0, 0, [260, 560, 520], rows, { head: true, fs: 12, minH: 40 });
  return boxed(B, "3  Work stages", "#ffffff", 1340, t.h, t.items, "Which team leads, and what comes out, at each stage (BIM Roadmap in LWK).");
}

/* 4.0 the overall workflow */
function overview(B) {
  const F = flow(B);
  const s1 = F.step(0, 0, "1.0 Project setup"), s2 = F.step(1, 0, "2.0 Modelling\n2.1 Model review\n2.3 SAM"),
        s3 = F.step(2, 0, "3.0 Interdisciplinary coordination"), s4 = F.step(3, 0, "4.0 Documentation\n4.1 GBP"), s5 = F.step(4, 0, "5.0 Archive");
  [s1, s2, s3, s4, s5].forEach((o) => { o.fill = "#eef1f5"; o.stroke = "#8a94a3"; o.fs = 14; o.bold = true; });
  F.go(s1, s2); F.go(s2, s3); F.go(s3, s4); F.go(s4, s5);
  const qa = B.shape(20, 175, 4 * 250 - 40, 56, "6.0 QA/QC - all the way through (see QA/QC checks and the BIM audit checklist)",
                     { kind: "round", fill: "#eef1f5", stroke: "#8a94a3", fs: 14, bold: true });
  F.out.push(qa);
  for (const s of [s1, s2, s3, s4]) F.go(s, qa, "", { kind: "straight", arrow: "both" });
  const note = B.sticky(0, 260, 600, "5.0 Archive: archive the model at each milestone and before major re-modelling (04 Archived), to keep the history for auditing.", "#e5e7eb", 12, "left");
  F.out.push(note);
  return boxed(B, "4.0  BIM workflow - overview", "#ffffff", 1250, 260 + note.h, F.out);
}

const KEY_HK_MNL = ["bimm", "hkc", "mnls", "mnll", "mnla"];

function setup(B) {
  const F = flow(B);
  const NO = { color: "#c2410c" };
  // along the top row, back along the second, down to the checks
  const start = F.end(0, 1, "Start");
  const tpl = F.step(1, 0, "Provide project template and project file location in CDE", ["bimm", "hkc"]);
  const file = F.step(1, 1, "Create / modify project file with project template (01 WIP)", ["mnll", "mnla"]);
  const wsn = F.step(2, 0, "Provide workset naming", ["bimm", "hkc"]);
  const ws = F.step(2, 1, "Create worksets in project file", ["mnll", "mnla"]);
  const name = F.step(3, 1, "Naming conventions of file", ["mnll", "mnla"]);
  const spf = F.step(4, 1, "Create project-specific shared parameter file", ["mnll", "mnla"]);
  const tps = F.step(5, 1, "Transfer project standards (if needed)", ["mnll", "mnla"]);
  const sys = F.step(6, 1, "System settings", ["mnll", "mnla"]);
  const pxp = F.step(7, 0, "Provide PxP / project information", ["bimm", "hkc", "mnls"]);
  const gather = F.step(7, 1, "Gather project information", ["mnll", "mnla"]);
  const survey = F.step(8, 2, "Provide survey plan / reference for site", ["bimm", "hkc"]);
  const link = F.step(7, 2, "Link CAD or RVT file as reference for site", ["mnll", "mnla"]);
  const site = F.step(6, 2, "Set up site information per PxP: survey point and project base point; site boundary; true north and project north", ["mnll", "mnla"]);
  const gl = F.step(5, 3, "Provide grids & levels masterfile", ["bimm", "hkc", "mnls"]);
  const grids = F.step(5, 2, "Set up grids and levels", ["mnll", "mnla"]);
  const browser = F.step(4, 2, "Set up project browser as indicated in the manual", ["mnll", "mnla"]);
  const views = F.step(3, 2, "View list / drawing list scheduling", ["mnls", "mnll"]);
  const q1 = F.ask(2, 2, "Issues found?");
  const ok = F.step(2, 3, "Check and approve project setup", ["bimm", "hkc"]);
  const q2 = F.ask(2, 4, "Issues found?");
  const fin = F.end(3, 4, "Finish");
  const next = F.ref(4, 4, "Proceed to modelling (2.0)");
  const mnlm = F.step(1, 2, "MNL team coordination meeting", ["mnls", "mnll"]);
  const coord = F.step(0, 2, "Coordination meeting (if needed)", ["bimm", "hkc", "mnls"]);
  F.go(start, file); F.go(tpl, file); F.go(file, ws); F.go(wsn, ws); F.go(ws, name); F.go(name, spf); F.go(spf, tps);
  F.go(tps, sys); F.go(sys, gather); F.go(pxp, gather); F.go(gather, link); F.go(survey, link); F.go(link, site);
  F.go(site, grids); F.go(gl, grids); F.go(grids, browser); F.go(browser, views); F.go(views, q1);
  F.go(q1, ok, "NO"); F.go(ok, q2); F.go(q2, fin, "NO"); F.go(fin, next);
  F.go(q1, mnlm, "YES", NO); F.path(q2, mnlm, [[1, 4]], "YES", NO);
  F.go(mnlm, coord); F.path(coord, file, [[0, 1.5], [1, 1.5]]);
  const [w, h] = F.size(9, 5);
  const key = legend(B, 0, h + 10, KEY_HK_MNL);
  return boxed(B, "4.1  Project setup (1.0)", "#ffffff", w, h + 50, F.out.concat(key));
}

function modelling(B) {
  const F = flow(B);
  const NO = { color: "#c2410c" };
  const ps = F.ref(0, 1, "Project setup (1.0)");
  const start = F.end(0, 2, "Start");
  const recv = F.step(1, 2, "Receive reference plans (05 Incoming)", ["mnll", "mnla"]);
  const prov = F.step(1, 3, "Provide reference plans", ["bimm", "hkc"]);
  const back = F.step(1, 0, "Return model to source for re-modelling", ["mnls", "mnll"]);
  const has3d = F.ask(2, 2, "Does the project have a 3D reference?");
  const qv = F.step(2, 1, "Quality check (visual check)", ["mnls", "mnll"]);
  const qa1 = F.ask(2, 0, "Issues found?");
  const sam = F.step(2, 3, "Model development using SAM (01 WIP) - see 4.4", ["mnll", "mnla"]);
  const up = F.step(3, 0, "Upload information model to CDE (01 WIP)", ["mnls", "mnll"]);
  const qd = F.step(3, 2, "Quality check (Drawing Review Checklist)", ["mnls", "mnll"]);
  const qa2 = F.ask(4, 2, "Issues found?");
  const fin = F.end(4, 0, "Finish");
  const rev = F.ref(5, 0, "Model review (WIP → Shared) - 4.3");
  const inside = F.ask(5, 2, "Can the issues be resolved internally?");
  const disc = F.step(5, 3, "Internally discuss issues and update model", ["mnll", "mnla"]);
  const mtg = F.step(6, 2, "MNL team coordination meeting", ["mnls", "mnll"]);
  const q = F.step(6, 3, "Send queries", ["mnls", "mnll"]);
  const p2 = F.step(7, 3, "Provide reference plans", ["bimm", "hkc"]);
  const res = F.step(7, 4, "Receive resolutions", ["mnls", "mnll"]);
  F.go(ps, start); F.go(start, recv); F.go(prov, recv); F.go(recv, has3d);
  F.go(has3d, qv, "YES"); F.go(has3d, sam, "NO"); F.go(qv, qa1); F.go(qa1, back, "YES", NO); F.go(back, recv);
  F.go(qa1, up, "NO"); F.go(up, qd); F.path(sam, qd, [[3, 3]]); F.go(qd, qa2);
  F.go(qa2, fin, "NO"); F.go(fin, rev); F.go(qa2, inside, "YES", NO);
  F.go(inside, disc, "YES"); F.go(inside, mtg, "NO"); F.go(mtg, q); F.go(q, p2); F.go(p2, res);
  F.path(res, disc, [[5, 4]]); F.path(disc, qd, [[3, 3]]);
  const [w, h] = F.size(8, 5);
  const key = legend(B, 0, h + 10, KEY_HK_MNL);
  return boxed(B, "4.2  Modelling (2.0)", "#ffffff", w, h + 50, F.out.concat(key));
}

function review(B) {
  const F = flow(B);
  const m = F.ref(0, 2, "Modelling (2.0)");
  const start = F.end(1, 2, "Start");
  const share = F.step(2, 2, "Share model for review (WIP)", ["mnll", "mnla"]);
  const recv = F.step(3, 2, "Receive mark-ups / comments / instructions (05 Incoming)", ["mnll", "mnla"]);
  const prov = F.step(3, 0, "Provide mark-ups / comments / new instructions", ["bimm", "hkc"]);
  const iss = F.ask(4, 2, "Are there issues found?");
  const acc = F.ask(5, 2, "Are the plans accepted as deliverable?");
  const wait = F.step(5, 0, "Wait for new information / references", ["mnll", "mnla"]);
  const fin = F.end(6, 2, "Finish");
  const ok = F.ref(6, 3, "Model approved for sharing (02 Shared)");
  const major = F.ask(4, 3, "Does the issue require major re-modelling?");
  const arch = F.step(5, 4, "Archive model (Archive)", ["mnll", "mnla"]);
  const upd = F.step(4, 4, "Update model (WIP)", ["mnll", "mnla"]);
  const qc = F.step(3, 4, "Quality check (Drawing Review Checklist)", ["mnls", "mnll"]);
  F.go(m, start); F.go(start, share); F.go(share, recv); F.go(prov, recv); F.go(recv, iss);
  F.go(iss, acc, "NO"); F.go(acc, fin, "YES"); F.go(fin, ok); F.go(acc, wait, "NO", { color: "#c2410c" }); F.go(wait, prov);
  F.go(iss, major, "YES", { color: "#c2410c" }); F.go(major, arch, "YES"); F.go(major, upd, "NO"); F.go(arch, upd); F.go(upd, qc); F.go(qc, recv);
  const [w, h] = F.size(7, 5);
  const note = B.sticky(0, h + 50, w, "After the model is approved for sharing, the same loop handles DESIGN CHANGES: Share model for collaboration (02 Shared) → receive mark-ups / comments / instructions (05 Incoming) → issues? → update (WIP) or archive → quality check → … → accepted as deliverable.", "#e5e7eb", 12, "left");
  const key = legend(B, 0, h + 10, KEY_HK_MNL);
  return boxed(B, "4.3  Model review (WIP → Shared) / design changes (2.1)", "#ffffff", w, h + 50 + note.h, F.out.concat(key, [note]));
}

const SAM = [
  "Architectural walls\nStructural walls*\nWall openings",
  "Curtain wall system / curtain wall\nCurtain panel, mullion\nCurtain mullion profile",
  "Architectural floor finish\nStructural slab*\nFloor grating",
  "Drainage with building",
  "Doors\nShutter / fire shutter",
  "Windows",
  "Roof\nSkylight\nCeiling",
  "Railing, tactile, sanitary fitment, furniture, water tank, hatch, exit sign, hose reel, fire hydrant, signage, misc. items in domestic flats",
  "Stairs, ramp, cat ladder, escalator, lift",
  "Room",
  "Area (in area plan)",
];
function sam(B) {
  const out = [];
  const W = 300, G = 36;
  const start = B.shape((W - 150) / 2, 0, 150, 50, "Start (after project setup)", { kind: "round", fill: "#2b303b", stroke: "#2b303b", color: "#ffffff", fs: 12, bold: true });
  out.push(start);
  let prev = start, col = 0, y = 80, maxY = 0;
  SAM.forEach((s, i) => {
    const turn = i === 4 || i === 8;
    if (turn) { col++; y = 80; }
    const o = B.shape(col * (W + 60), y, W, 60, (i + 1) + ". " + s + "\nQA (DRC section, BIM manual section)\n▸ MNL Authors",
                      { kind: "round", fill: ROLE.mnla[3], stroke: ROLE.mnla[2], fs: 12 });
    if (turn) {
      // up the gap between the columns and in at the top of the next
      const gx = col * (W + 60) - 30, cy = prev.y + prev.h / 2;
      out.push(o, ...B.path(prev, o, [[gx, cy], [gx, 50], [o.x + W / 2, 50]]));
    } else out.push(o, B.arrow(prev, o, "", { kind: "straight" }));
    prev = o;
    y += o.h + G;
    maxY = Math.max(maxY, y);
  });
  const fin = B.shape(2 * (W + 60), maxY + 10, W, 60, "Finish → proceed to the modelling workflow: Quality check (Drawing Review Checklist)",
                      { kind: "round", fill: "#eef0f3", stroke: "#c3c8d0", fs: 12, color: "#4b5563" });
  out.push(fin, B.arrow(prev, fin));
  return boxed(B, "4.4  Model development using SAM (AR) (2.3)", "#ffffff", 3 * W + 120, maxY + 10 + fin.h, out,
               "The order of modelling. Each step ends with its QA. * structural elements where the architect models them.");
}

function clash(B) {
  const F = flow(B);
  const start = F.end(0, 0, "Start");
  const pkg = F.step(1, 0, "Share plans and create new package for collaboration (02 Shared)", ["hkc", "mnls"]);
  const comb = F.step(2, 0, "Create / update combined model and publish views to ACC for clash detection (02 Shared)", ["hkc", "mnls"]);
  const acc = F.step(3, 0, "Clash detection via ACC Model Coordination", ["hkc", "mnls"]);
  const free = F.ask(4, 0, "Is the model clash-free?");
  const pub = F.end(5, 0, "Publish output deliverable (03 Published)");
  pub.w = 200; pub.h = 64;
  const rep = F.step(4, 1, "Create clash report", ["hkc", "mnls"]);
  const mtg = F.step(4, 2, "BIM coordination meeting", ["bimm", "hkc", "pts"]);
  const res = F.step(3, 2, "Receive clash resolutions", ["mnls", "mnll"]);
  const upd = F.step(2, 2, "Update model", ["mnll", "mnla"]);
  F.go(start, pkg); F.go(pkg, comb); F.go(comb, acc); F.go(acc, free); F.go(free, pub, "YES"); F.go(free, rep, "NO", { color: "#c2410c" });
  F.go(rep, mtg); F.go(mtg, res); F.go(res, upd); F.go(upd, pkg);
  const [w, h] = F.size(6, 3);
  const tip = B.sticky(0, h + 50, w, "Quick checks any time: LWK Viewer 3D > Checks > Clash (rules shared with the project, New / Gone on each run, Make issue, export the report) and Headroom.", "#bfd9ff", 12, "left");
  const key = legend(B, 0, h + 10, ["bimm", "hkc", "mnls", "mnll", "mnla", "pts"]);
  return boxed(B, "4.5  Interdisciplinary coordination - clash detection in ACC (3.0)", "#ffffff", w, h + 50 + tip.h, F.out.concat(key, [tip]));
}

function gbp(B) {
  const out = [];
  const X = [0, 250, 500, 750, 1000], Y = [0, 110, 220, 330, 440, 550, 660], BH = 56;
  const cx = (c) => X[c] + 100, cy = (r) => Y[r] + BH / 2;
  const box = (c, r, s, fill, stroke, opt) => {
    const o = B.shape(X[c], Y[r], 200, BH, s, Object.assign({ kind: "round", fill, stroke, fs: 12 }, opt || {}));
    o.y = Math.round(Y[r] + (BH - o.h) / 2);
    out.push(o);
    return o;
  };
  const go = (a, b, label, opt) => out.push(B.arrow(a, b, label, opt));
  const via = (a, b, pts, label, opt) => out.push(...B.path(a, b, pts, label, opt));
  const DES = ["#fde2c7", "#f2a65a"], PREP = ["#f6f7f9", "#e2453c"], SMART = ["#e6f5dd", "#d070c8"], OUT = ["#d6ecfb", "#2b7bd6"];
  out.push(B.text(0, Y[1] - 50, 220, "DESIGN STAGE", 15, true, "#6b7480"), B.text(250, Y[1] - 50, 700, "GBP PREPARATION STAGE", 15, true, "#6b7480"),
           B.text(1260, Y[1] - 50, 260, "GBP SUBMISSION STAGE", 15, true, "#6b7480"));
  const info = box(1, 1, "Building information", PREP[0], PREP[1]);
  const lay = box(0, 2, "Layout plan (AutoCAD)", DES[0], DES[1]);
  const model = box(1, 3, "3D model\n(verification on statutory requirement)", PREP[0], PREP[1]);
  const m3 = box(0, 4, "3D model (SketchUp / Rhino / ArchiCAD, etc.)", DES[0], DES[1]);
  const sck = box(2, 1, "SMART CHECK", SMART[0], SMART[1]);
  const sin = box(2, 2, "SMART INPUT", SMART[0], SMART[1]);
  const area = box(2, 3, "Area plan", PREP[0], PREP[1]);
  const bd = box(3, 1, "BD's AREA TOOL", SMART[0], SMART[1]);
  const rf = box(3, 3, "Revit formula", PREP[0], PREP[1]);
  const sch = box(3, 4, "Schedule", PREP[0], PREP[1]);
  const notes = box(3, 6, "Annotation, dimension, properties, general notes, colouring, etc.", "#f3f4f6", "#c3c8d0", { color: "#6b7480" });
  const ass = box(4, 1, "Area Summary Schedule", SMART[0], SMART[1]);
  const simp = box(4, 2, "SMART IMPORT", SMART[0], SMART[1]);
  const calc = box(4, 4, "Calculation sheet", OUT[0], OUT[1]);
  const dwg = box(4, 5, "Drawing sheet", OUT[0], OUT[1]);
  const doc = box(4, 6, "Document", OUT[0], OUT[1]);
  const sub = B.shape(1260, Y[2], 220, Y[6] + BH - Y[2], "GBP SUBMISSION", { kind: "round", fill: "#f7d5ef", stroke: "#2fb24e", sw: 3, fs: 20, bold: true });
  out.push(sub);
  go(info, model, "", { kind: "straight" });
  via(lay, model, [[225, cy(2)], [225, cy(3)]]); via(m3, model, [[225, cy(4)], [225, cy(3)]]);
  go(model, area); go(area, sin); go(sin, sck); go(sck, bd, "OK"); go(bd, ass);
  via(sck, area, [[475, cy(1)], [475, cy(3)]], "Not OK", { color: "#c2410c" });
  go(ass, simp); via(ass, sub, [[cx(4) + 270, cy(1)]]);
  go(simp, calc, "## format", { dash: true, color: "#d070c8", kind: "straight" });
  go(area, rf); go(rf, sch); go(sch, calc);
  via(model, dwg, [[cx(1), cy(5)]]); via(notes, dwg, [[cx(3), cy(5)]]);
  for (const [o, r] of [[calc, 4], [dwg, 5], [doc, 6]]) out.push(B.toPoint(o, 1257, cy(r)));
  const top = Y[6] + BH + 50;
  const n1 = B.sticky(0, top, 700, "## The format of the Area Summary Schedule from BD's Area Tool still needs adjusting to match the existing format of the Calculation Sheet.", "#ffc2c2", 12, "left");
  const n2 = B.sticky(720, top, 760, "Additional information often requested by the BD case officer:\n• AutoCAD file with the area boundary aligned with the Calculation Sheet\n• Excel file with all data consistent with the Calculation Sheet", "#bfd9ff", 12, "left");
  const y3 = top + Math.max(n1.h, n2.h) + 16;
  const n3 = B.sticky(0, y3, 1480, "Before: Xref (layout plan, elevation / section) → Area plan → MANUAL INPUT into an Excel formula → Schedule → MANUAL INSERT into the Calculation Sheet.\nNow: 3D model (+ building information) → Area plan → Revit formula → Schedule → Calculation Sheet - no manual input, no manual insert.", "#e6efae", 12, "left");
  const n4 = B.sticky(0, y3 + n3.h + 16, 1480, "GBP master files in two parts: A - Drawings (sets ① BD, ② FSD / BS&W) and C - Calculations (③ DLO, GFA views).\nLinked models: ① main GBP (BD colours) by linked view → normal title block + views ①;  ② dependent views + override elements by view (FSD colours) → by linked view + filter overriding → overridden title block (Dwg No.) + views ②;  by linked view + filter overriding → normal title block + GFA views (C).\nUse Desktop Connector for linking CAD in ACC.", "#fff3a3", 12, "left");
  out.push(n1, n2, n3, n4);
  shift(out, 0, -Y[1] + 50);
  const h = -Y[1] + 50 + y3 + n3.h + 16 + n4.h;
  return boxed(B, "4.6  Documentation - GBP submission using BIM + BD's Area Tool (4.0 / 4.1)", "#ffffff", 1480, h, out,
               "As done in Kennedy Town (IL9094). Red outline: GBP preparation in Revit; purple: BD's SMART tools; blue: what is submitted.");
}

function cde(B) {
  const out = [];
  const LEAD = "#3e9e91", TASK = "#f6a21a", APPT = "#0c8ce9";
  const col = (x, title, desc, steps, dark) => {
    const head = B.shape(x, 0, 200, 44, title, { kind: "rect", fill: dark ? "#2b303b" : "#eef0f3", stroke: dark ? "#2b303b" : "#c3c8d0",
                                                color: dark ? "#ffffff" : INK, fs: 13, bold: true });
    const d = B.sticky(x, 64, 200, desc, "#f3f4f6", 12);
    out.push(head, d);
    let y = 64 + d.h + 14, last = d;
    for (const [s, c] of steps) {
      last = B.shape(x, y, 200, 36, s, { kind: "rect", fill: c, stroke: c, color: "#ffffff", fs: 13, bold: true });
      out.push(last);
      y += 44;
    }
    head.last = last;
    return head;
  };
  const a = col(0, "05 INCOMING", "Building information received by the Lead Appointed Party and task team, used as reference", [["1. Verify", LEAD]], true);
  const b = col(240, "01 WIP", "Information under development with each task team, not visible to other teams", [["2. Generate", TASK], ["3. Coordinate", TASK]], true);
  const c = col(480, "WIP TO SHARED", "Information undergoes QA check and review. After passing, it is approved for sharing", [["4. Check", TASK], ["5. Review", TASK], ["6. Approve", LEAD]]);
  const d = col(720, "02 SHARED", "Verified read-only information shared with other task teams for coordination, or with the appointing party", [], true);
  const e = col(960, "SHARED TO PUBLISH", "Reviewed by the Lead Appointing Party, then by the Appointing Party", [["7. Review", LEAD], ["8. Authorize", LEAD], ["9. Review", APPT], ["10. Accept", APPT]]);
  const f = col(1200, "03 PUBLISHED", "Authorized read-only information, accepted as a deliverable by the Appointing Party. Published at each information / project milestone", [], true);
  const g = B.shape(520, 420, 200, 44, "04 ARCHIVED", { kind: "rect", fill: "#2b303b", stroke: "#2b303b", color: "#ffffff", fs: 13, bold: true });
  const gd = B.sticky(520, 480, 200, "Archived information, for auditing the development of the information", "#f3f4f6", 12);
  out.push(g, gd);
  [[a, b], [b, c], [c, d], [d, e], [e, f]].forEach(([p, q]) => out.push(B.arrow(p, q, "", { kind: "straight" })));
  // to the archive: below the columns, in at the sides
  out.push(...B.path(b.last, g, [[340, 442]]), ...B.path(d.last, g, [[820, 442]]), ...B.path(f.last, g, [[1300, 442]]));
  for (const o of [b, c, d, e, f]) delete o.last;
  delete a.last;
  const key = [["Appointing Party", APPT], ["Lead Appointed Party", LEAD], ["Task Team", TASK]].map(([s, cl], i) =>
    B.shape(i * 190, 590, 180, 30, s, { kind: "rect", fill: cl, stroke: cl, color: "#ffffff", fs: 12 }));
  const tip = B.sticky(0, 640, 1400, "In the viewer: make the project's folders 05 Incoming / 01 WIP / 02 Shared / 03 Published / 04 Archived with Folders > ⋯ > Lay out folders from a template. Upload a file of the same name as a New version - the earlier ones stay under ⋯ > Versions.", "#bfd9ff", 12, "left");
  out.push(...key, tip);
  return boxed(B, "5  CDE folder states (ISO 19650)", "#ffffff", 1400, 640 + tip.h, out);
}

function qaqc(B) {
  const rows = [
    ["Check", "Definition", "Responsible party"],
    ["Modelling methodology", "The model is created according to the modelling guidelines.", "BIM team (HK/UK)"],
    ["Dataset validation", "The datasets are populated with the correct data.", "BIM team (HK/UK)"],
    ["Interference check", "Clashes between building or feature components, detected with clash detection software.", "BIM team (HK/UK)\nBIM team (Manila)"],
    ["Standards check", "The BIM and CAD standards are followed (fonts, dimensions, line styles, levels / layers, naming etc.).", "BIM team (HK/UK)"],
    ["Statutory check", "The layout / design complies with all statutory requirements, imposed conditions, lease and planning requirements.", "BIM team (HK/UK)\nProject team (Senior)"],
    ["Design check", "The design is constructable and the design intent is correctly implemented.", "BIM team (HK/UK)\nProject team (Senior, Junior)\nDesign team"],
  ].map((r, i) => (i ? [{ s: r[0], bold: true }, r[1], r[2]] : r));
  const t = table(B, 0, 0, [210, 470, 240], rows, { head: true, fs: 12 });
  const when = B.sticky(0, t.h + 16, 920, "When: bi-weekly · before each information exchange · at the end of each work stage", "#fff3a3", 13, "left");
  return boxed(B, "6  QA/QC checks", "#ffffff", 920, t.h + 16 + when.h, t.items.concat([when]));
}

/* The BIM audit checklist (LWK + Partners Quality Assurance and BIM Audit
   Checklist): one column per section, one note per sub-section. */
const AUDIT = [
  {"n": "1", "title": "Project Setup", "subs": [{"n": "1.1", "title": "File Naming and Organization", "items": [["1.1.1", "Naming", "Are file names clear and descriptive?", "S"], ["1.1.2", "Folder structure", "Is the project folder organized and well-structured?", "S"], ["1.1.3", "File location", "Is the Model File placed in the correct location?", "S"]]}, {"n": "1.2", "title": "Project Template", "items": [["1.2.1", "Template Version", "Is the correct project template applied?", "S"], ["1.2.2", "Transfer Project Standards", "Does the template include necessary view templates, families, and settings?", "S"]]}, {"n": "1.3", "title": "Units", "items": [["1.3.1", "Setting", "Are units set correctly for the project?", "S"]]}, {"n": "1.4", "title": "Project Browser Setup", "items": [["1.4.1", "Organization", "Is the Project Browser organized with logical categories and subcategories?", "S"], ["1.4.2", "Grouping, Sorting and Naming", "Are views appropriately grouped, sorted and named?", "S"]]}, {"n": "1.5", "title": "Workset", "items": [["1.5.1", "Naming", "Is workset naming consistent and follow BEP?", "S"], ["1.5.2", "Assignment", "Are the Grids and Levels placed on the 'Shared Views, Level, Grids' Workset?", "S"]]}, {"n": "1.6", "title": "Linked Models and CAD", "items": [["1.6.1", "Position and scale", "Is the linked CAD file correctly positioned and scaled?", "S"], ["1.6.2", "No Import", "Is the CAD linked instead of Imported", "S"], ["1.6.3", "File location", "Is the linked CAD file placed in the correct location in local folder or cloud folder", "S"], ["1.6.4", "Purge CAD file", "Is the CAD file properly purged before inserting.", "S"], ["1.6.5", "Lock linked file", "Is the CAD file locked", "S"]]}, {"n": "1.7", "title": "Property Line and Site Information", "items": [["1.7.1", "Survey Point", "Is survey point properly placed and follow BEP?", "S"], ["1.7.2", "Project Base Point", "Is Project Base point properly placed and follow BEP?", "S"], ["1.7.3", "Property Line", "Is the property line accurately defined?", "S"]]}, {"n": "1.8", "title": "Levels and Grids", "items": [["1.8.1", "Naming and organization", "Are levels and grids properly named and organized?", "S"], ["1.8.2", "Alignment", "Do they align correctly with the architectural/ reference drawings?", "S"], ["1.8.3", "Symbol family type", "Are levels and grids symbol properly assigned", "S"], ["1.8.4", "Copy and monitor", "Are the Grids and Levels copied and monitored from the Masterfile?", "S"], ["1.8.5", "Dimensions", "Is the dimensions in close number (check up to 3 decimal places)?", "S"]]}]},
  {"n": "2", "title": "Dataset Validation", "subs": [{"n": "2.1", "title": "Warning Review", "items": [["2.1.1", "Review & Address", "Are warnings regularly reviewed and addressed?", "D"], ["2.1.2", "Resolution", "Are critical warnings prioritized and resolved promptly?", "D"]]}, {"n": "2.2", "title": "Periodical File Purge", "items": [["2.2.1", "purge unused elements", "Is there a routine for purging unused elements from the model?", "D"], ["2.2.2", "Remove unnecessary elements", "Are unnecessary elements (e.g., views, families) regularly removed to optimize file size?", "D"]]}, {"n": "2.3", "title": "Periodical File Audit", "items": [["2.3.1", "Schedule", "Is there a schedule for conducting comprehensive file audits?", "D"], ["2.3.2", "Revision and status", "Is the status and revision history of files reviewed to ensure the latest versions are being used?", "D"], ["2.3.3", "File size", "Does the file size align with the requirement in BEP", "D"]]}]},
  {"n": "3", "title": "Standard Approach of Modelling - Architectural", "subs": [{"n": "3.1", "title": "Level of Development (LOD)", "items": [["3.1.1", "Appropriate LOD-G", "Is the appropriate LOD-G addressed as specified in the BEP for each stage of the project?", "D"], ["3.1.2", "LOD-I Determination", "Has the LOD-I been determined to meet the intended usage, without being over-specified?", "D"], ["3.1.3", "Documentation", "Is the appropriate documentation addressed for each stage of the project ?", "D"], ["3.1.4", "Avoid Over-Modeling", "Is the model kept within the actual Level of Information Need (LOIN) to prevent system overload?", "D"]]}, {"n": "3.2", "title": "Naming Convention", "items": [["3.2.1", "Family Naming", "Are Families named in compliance with BEP or LWK's standard.", "S"], ["3.2.2", "Parameter / Data Naming", "Are parameters/ Data named in compliance with BEP or LWK's standard.", "S"], ["3.2.3", "Component  Naming", "Are components named accurately and in accordance with naming conventions?", "S"]]}, {"n": "3.3", "title": "Visibility", "items": [["3.3.1", "Hidden Elements in View", "Are there any hidden elements in views that should be visible for clarity?", "S"], ["3.3.2", "Filtering", "Are filters applied consistently across views and disciplines?", "S"], ["3.3.3", "Override Graphics in view", "Is override graphics in view applied? It is not recommend to use", "S"], ["3.3.4", "View Template/ Proper Use of Overriding Graphics", "Is view template applied? If not, are Visibility/graphic overrides used appropriately to highlight specific elements or information?", "S"]]}, {"n": "3.4", "title": "Workset", "items": [["3.4.1", "Workset Assignment", "Have elements been assigned to the correct workset for effective collaboration?", "S"], ["3.4.2", "Workset Assignment", "Is workset assignment consistent with project standards and requirements?", "S"]]}, {"n": "3.5", "title": "Project Browser", "items": [["3.5.1", "Project browser assignment", "Are the Views, Legends, Schedules properly assigned to the specified project browser?", "S"]]}]},
  {"n": "4", "title": "Model Geometry", "subs": [{"n": "4.1", "title": "Wall", "items": [["4.1.1", "Wall alignment", "Are walls accurately modeled to represent the design intent?", "S"], ["4.1.2", "Height/ thickness", "Do walls have correct height, width, and thickness as per specifications?", "S"], ["4.1.3", "Joint", "Are wall joins and intersections properly managed?", "S"], ["4.1.4", "Opening", "Is the placement and alignment of wall openings (e.g., doors, windows) precise?", "S"], ["4.1.5", "Wall Type", "Is the wall type properly assigned", "S"]]}, {"n": "4.2", "title": "Floors", "items": [["4.2.1", "Design intent", "Are floors correctly modeled to match the design requirements?", "S"], ["4.2.2", "Thickness/ materials", "Are floor thicknesses and materials accurate according to project specifications?", "S"], ["4.2.3", "Opening", "Have openings (e.g., stairs, elevators) been accurately cut through floors?", "S"], ["4.2.4", "floor edges and junctions", "Are floor edges and junctions properly defined and detailed?", "S"], ["4.2.5", "floor type", "Is the floor type properly assigned", "S"]]}, {"n": "4.3", "title": "Staircase", "items": [["4.3.1", "Design intent", "Are staircases modeled accurately to meet design specifications?", "S"], ["4.3.2", "Building Codes", "Do staircases comply with building codes and accessibility standards?", "S"], ["4.3.3", "Dimensions", "Are tread and riser dimensions, as well as railing heights, correct?", "S"], ["4.3.4", "Level", "Are base level and top level properly assigned", "S"]]}, {"n": "4.4", "title": "Curtain Walls", "items": [["4.4.1", "Design intent", "Are curtain wall systems accurately modeled based on design specifications?", "S"], ["4.4.2", "Mullion and Transom", "Are mullion and transom spacing, as well as profiles, correctly represented?", "S"], ["4.4.3", "Panels and glazing elements", "Are panels and glazing elements placed accurately within the curtain wall?", "S"]]}, {"n": "4.5", "title": "Windows", "items": [["4.5.1", "Design intent", "Are window openings accurately placed and aligned with the design?", "S"], ["4.5.2", "Dimensions", "Do windows have the correct dimensions and are they positioned accurately?", "S"], ["4.5.3", "Families and Types", "Are window families and types properly chosen", "S"], ["4.5.4", "Building Codes", "Do windows comply with building codes and lighting and ventilation requirement?", "S"]]}, {"n": "4.6", "title": "Doors", "items": [["4.6.1", "Opening", "Are door openings correctly placed and aligned in the model?", "S"], ["4.6.2", "Dimensions and directions", "Do doors have the correct dimensions and swing directions?", "S"], ["4.6.3", "Families and Types", "Are door families and types properly chosen", "S"], ["4.6.4", "Building Codes", "Do door comply with FS codes requirement?", "S"]]}, {"n": "4.7", "title": "Railings", "items": [["4.7.1", "Design intent", "Are railings accurately modeled to align with design specifications?", "S"], ["4.7.2", "Building Codes", "Do railings comply with safety and building code requirements?", "S"], ["4.7.3", "Project standards", "Are railing heights, spacings, and profiles consistent with project standards?", "S"]]}, {"n": "4.8", "title": "Model lines", "items": [["4.8.1", "Design intent", "Are model lines used appropriately to represent design intent?", "S"], ["4.8.2", "Line Type", "Is suitable line type chosen", "S"]]}, {"n": "4.9", "title": "Components", "items": [["4.9.1", "Design intent", "Are components (e.g., Sanitary fixtures, furniture) accurately placed and aligned with design intent?", "S"], ["4.9.2", "Dimensions, type, placement", "Do components have correct dimensions, type, and placement in the model?", "S"], ["4.9.3", "Design intent", "Have \"Model In Place\" components been properly created and documented?", "S"], ["4.9.4", "Proper Segmentation", "Are \"Model In Place\" components separated by different materials for accurate representation?", "S"]]}, {"n": "4.10", "title": "Columns", "items": [["4.10.1", "Design intent", "Are columns modeled accurately to meet design specifications?", "S"], ["4.10.2", "Dimensions,  placement", "Are column dimensions and placement in alignment with Structural model/ drawing?", "S"]]}, {"n": "4.11", "title": "Roofs", "items": [["4.11.1", "Design intent", "Are roofs modeled to accurately represent design intent?", "S"], ["4.11.2", "Building Codes", "Are roof slopes and pitches consistent with project requirements?", "S"], ["4.11.3", "Project standards", "Are roof materials specified correctly?", "S"]]}]},
  {"n": "5", "title": "Documentation", "subs": [{"n": "5.1", "title": "Annotation", "items": [["5.1.1", "Check quantity", "Are annotations (e.g., dimensions, text, symbols) appropriately added to enhance clarity?", "S"], ["5.1.2", "Check quality", "Do annotations comply with project standards and are they legible and correctly placed?", "S"]]}, {"n": "5.2", "title": "Drawing Sheet", "items": [["5.2.1", "Standard Title Block", "Is the standard title block used for documentation?", "S"], ["5.2.2", "Sheet Numbering System", "Is there a standardized sheet numbering system in place?", "S"], ["5.2.3", "Sheet Versioning", "Is there a clear system for versioning sheets?", "S"]]}]},
  {"n": "6", "title": "Interference check", "subs": [{"n": "6.1", "title": "Coordination and Clash Detection", "items": [["6.1.1", "Clash Matrix Availability", "Is a clash matrix available and maintained in the project documentation?", "I"], ["6.1.2", "Clash detection", "Have clash detection been run to identify both hard and soft clashes?", "I"], ["6.1.3", "Clash Report Validation", "Have clash reports been internally reviewed, verified, and endorsed for accuracy?", "I"], ["6.1.4", "Coordination Meeting", "Are regular coordination meetings scheduled to address identified clashes and conflicts in the model?", "I"], ["6.1.5", "Clash Resolutions Agreement", "Are clash resolutions discussed and agreed upon during the coordination meetings?", "I"], ["6.1.6", "Effective Communication", "Are clash reports and coordination updates effectively communicated to all relevant project teams?", "I"], ["6.1.7", "Model update", "Have clash resolutions been appropriately integrated into the model?", "I"], ["6.1.8", "Comprehensive Clash Resolution", "Have all identified clashes been thoroughly addressed and completely resolved in the model?", "I"]]}]}
];
const AUDIT_COLOURS = [["#7aa6d8", "#dbe7f5"], ["#c8961a", "#f6e7bd"], ["#8fbf63", "#e0eed2"], ["#e8915d", "#fbe0cf"], ["#8d9fd6", "#e1e6f6"], ["#8a8f98", "#e5e7eb"]];
function audit(B) {
  const out = [];
  const W = 420, G = 24;
  const head = B.sticky(0, 0, 2 * W + G, [
    "Project number: ________      Project name: ________",
    "Building / zone: ________      File name: ________",
    "Date of audit: ________      Auditor 1: ________      Auditor 2: ________",
  ].join("\n"), "#ffffff", 13, "left");
  const key = B.sticky(2 * W + 2 * G, 0, 2 * W + G, [
    "Audit type:  I = Interference check · S = Standard check · D = Model data integrity check",
    "Result per audit date:  P = No comment (Pass) · F = With comment (Fail) · Remarks / status",
    "The formal record: the Excel 'LWK BIM Audit Checklist' in Folders > BIM QA (a blank copy is put there for this project).",
  ].join("\n"), "#fff3a3", 13, "left");
  out.push(head, key);
  const top = Math.max(head.h, key.h) + 30;
  let maxH = 0;
  AUDIT.forEach((sec, i) => {
    const x = i * (W + G);
    const [strong, light] = AUDIT_COLOURS[i] || AUDIT_COLOURS[5];
    const h = B.shape(x, top, W, 44, sec.n + "  " + sec.title, { kind: "rect", fill: strong, stroke: strong, color: "#ffffff", fs: 14, bold: true });
    out.push(h);
    let y = top + h.h + 12;
    for (const sub of sec.subs) {
      const s = sub.n + "  " + sub.title + "\n" + sub.items.map(([n, item, q, t]) => `☐ ${n} ${item} (${t}) - ${q}`).join("\n");
      const o = B.sticky(x, y, W, s, light, 12, "left");
      out.push(o);
      y += o.h + 12;
    }
    maxH = Math.max(maxH, y);
  });
  return boxed(B, "7  BIM audit checklist", "#ffffff", AUDIT.length * (W + G) - G, maxH, out,
               "LWK + Partners Quality Assurance and BIM Audit Checklist - " + AUDIT.reduce((n, s) => n + s.subs.reduce((m, u) => m + u.items.length, 0), 0) + " items.");
}

function meetings(B) {
  const s = [
    "BIM coordination meeting - chaired by the HK BIM team, regular (bi-weekly): progress, clash resolutions, decisions.",
    "MNL team coordination meeting - when issues cannot be resolved internally; queries go to HK, resolutions come back.",
    "Coordination meeting (project setup) - if the setup needs agreeing with the HK BIM team.",
    "Progress report - the Manila team lead reports regularly to the HK BIM team.",
    "",
    "In the viewer: meetings are made in the project's Chat (+ Event) and show in Calendar and Outlook.",
  ].join("\n");
  const t = B.sticky(0, 0, 520, s, "#d9c8ff", 13, "left");
  return boxed(B, "8  Meetings", "#ffffff", 520, t.h, [t]);
}

function viewerHelp(B) {
  const rows = [
    ["Workflow step", "In the LWK Viewer"],
    ["Mark-ups / comments / instructions", "Sheets: draw a markup, make it an Issue and assign it; 3D: Add issue"],
    ["Preview the model", "3D page; Sheets > View > 2D + 3D"],
    ["Clash / headroom check", "3D > Checks: shared clash rules, headroom scan, Make issue, export the report"],
    ["Assign work and deadlines", "Tasks (a list per project; Gantt)"],
    ["Queries and resolutions", "The project's Chat channel; comments on issues"],
    ["CDE folders, versions", "Folders: folder template, upload as New version, ⋯ > Versions"],
    ["Progress", "Dashboard; weekly summary to Teams; Export > Report / Spreadsheet / BCF"],
  ];
  const t = table(B, 0, 0, [250, 470], rows, { head: true, fs: 12 });
  return boxed(B, "9  How the viewer supports each step", "#ffffff", 720, t.h, t.items);
}

function notes(B) {
  const a = B.sticky(0, 0, 320, "Special requirements / client standards\n\n- \n- \n- ", "#fff3a3", 13, "left", 260);
  const b = B.sticky(340, 0, 320, "Decisions log\n(date · decision · by whom)\n\n- \n- \n- ", "#c3efc0", 13, "left", 260);
  const c = B.sticky(680, 0, 320, "Open questions\n\n- \n- \n- ", "#ffd6a5", 13, "left", 260);
  return boxed(B, "10  Project notes", "#ffffff", 1000, 260, [a, b, c]);
}

const PICS = [
  ["bim_roadmap", "BIM Roadmap in LWK - BIM workflow at different work stages"],
  ["gbp_area_tool", "Workflow of the GBP submission using BIM + BD's Area Tool (Kennedy Town, IL9094)"],
  ["gbp_old_vs_new", "GBP preparation: before (Xref + Excel) and now (3D model + Revit formula)"],
  ["workflow_draft_p01", "Proposed workflow - overall"],
  ["workflow_draft_p02", "Proposed workflow - 1.0 Project setup"],
  ["workflow_draft_p03", "Proposed workflow - 2.0 Modelling"],
  ["workflow_draft_p04", "Proposed workflow - 2.1 Model review (WIP to Shared)"],
  ["workflow_draft_p05", "Proposed workflow - 2.3 Model development using SAM (AR)"],
  ["workflow_draft_p06", "Proposed workflow - Model review / design changes"],
  ["workflow_draft_p07", "Proposed workflow - Foldering structure (CDE)"],
  ["workflow_draft_p08", "Proposed workflow - 3.0a Clash detection (ACC)"],
  ["workflow_draft_p10", "Proposed workflow - 4.1 GBP presentation"],
];
function pictures(B, images) {
  const out = [];
  const W = 640, G = 30;
  let x = 0, y = 0, rowH = 0, n = 0;
  for (const [key, cap] of PICS) {
    const im = images && images[key];
    if (!im || !im.src) continue;
    const h = Math.round(W * (im.h / im.w));
    out.push(B.text(x, y, W, cap, 13, true));
    out.push({ id: uid("i"), t: "image", src: im.src, x, y: y + 30, w: W, h, z: 0 });
    rowH = Math.max(rowH, h + 30);
    n++;
    if (n % 3 === 0) { x = 0; y += rowH + G; rowH = 0; } else x += W + G;
  }
  if (!out.length) {
    out.push(B.sticky(0, 0, 600, "The reference diagrams could not be loaded.", "#e5e7eb", 13));
    return boxed(B, "11  Reference diagrams", "#ffffff", 600, out[0].h, out);
  }
  const h = (n % 3 === 0 ? y - G : y + rowH);
  return boxed(B, "11  Reference diagrams", "#ffffff", 3 * W + 2 * G, h, out, "The original diagrams the flow charts on this board are drawn from.");
}

/* ------------------------------------------------------------ the board */

/* info: { number, name } of the project; images: { key: { src, w, h } } */
export function lwkBimWorkflow(info, images) {
  const B = builder();
  info = info || {};
  const title = B.text(0, -170, 2400, "LWK BIM Workflow" + (info.name ? "  -  " + info.name : ""), 44, true);
  const sub = B.text(0, -100, 2400, "How this project is set up, modelled, checked, coordinated and submitted - who does what, at each stage. The project's own copy: change it to suit.", 18, false, "#4b5563");
  const G = 120;
  const rows = [
    [projectCard(B, info), howTo(B), roles(B), meetings(B), viewerHelp(B)],
    [stages(B), qaqc(B), cde(B)],
    [overview(B), clash(B)],
    [setup(B), modelling(B)],
    [review(B), sam(B)],
    [gbp(B), notes(B)],
    [audit(B)],
    [pictures(B, images)],
  ];
  const out = [title, sub];
  let y = 0;
  for (const row of rows) {
    let x = 0, h = 0;
    for (const f of row) {
      shift(f.items, x, y);
      out.push(...f.items);
      x += f.w + G;
      h = Math.max(h, f.h);
    }
    y += h + G;
  }
  // stacking: frames at the back, then pictures, shapes, notes, arrows on top
  const rank = { frame: 0, image: 1, shape: 2, sticky: 3, text: 3, conn: 4 };
  out.sort((a, b) => (rank[a.t] - rank[b.t]) || (a.z - b.z));
  out.forEach((o, i) => { o.z = i + 1; });
  return out;
}

export const WORKFLOW_PICTURES = PICS.map(([k]) => k);
