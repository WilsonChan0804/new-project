// The manual's pictures: each page of the demo (seed.py), with numbered
// marks on its panels, buttons and choices. Reads shots.json; writes
// docs/manual/img/<id>.jpg and viewer/help-img/<id>.jpg.
//
//   node shoot.mjs DEMO_DIR [only-id ...]
//
// Needs the demo's server running (see seed.py) and Playwright.
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const require = createRequire(process.env.PW_FROM || "/opt/node-tools/node_modules/");
const { chromium } = require("playwright");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [DEMO, ...only] = process.argv.slice(2);
const st = JSON.parse(fs.readFileSync(path.join(DEMO, "state.json"), "utf8"));
const B = "http://localhost:" + st.port;
const SPEC = JSON.parse(fs.readFileSync(path.join(HERE, "shots.json"), "utf8"));
const OUTS = [path.join(HERE, "..", "img"), path.join(HERE, "..", "..", "..", "viewer", "help-img")];
for (const o of OUTS) fs.mkdirSync(o, { recursive: true });

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
await p.goto(B + "/index.html");
await p.evaluate(([t, pid]) => {
  localStorage.clear();
  localStorage.setItem("lwk-viewer:token", t); localStorage.setItem("lwk-viewer:project", pid);
}, [st.token, st.project]);
// What's new is shown once per version: seen
await p.evaluate(() => { try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/whatsnew/i.test(k)) localStorage.removeItem(k); } localStorage.setItem("lwk-whatsnew-seen", "9999-99-99"); } catch (e) {} });

const fill = (s) => s.replace(/\{list\}/g, st.list).replace(/\{project\}/g, st.project);
let bad = 0;
for (const shot of SPEC.shots) {
  if (only.length && !only.includes(shot.id)) continue;
  if (shot.size) await p.setViewportSize({ width: shot.size[0], height: shot.size[1] });
  else await p.setViewportSize({ width: 1440, height: 860 });
  if (shot.storage) await p.evaluate((kv) => { for (const k in kv) localStorage.setItem(k, kv[k]); }, shot.storage);
  await p.goto(B + "/" + fill(shot.url));
  if (shot.ready) await p.waitForSelector(shot.ready, { timeout: 60000 }).catch(() => console.log("  ! not ready:", shot.ready));
  await p.waitForTimeout(shot.wait || 1500);
  for (const step of shot.prep || []) {
    try {
      if (step.click) await p.click(fill(step.click), { timeout: 8000 });
      if (step.dblclick) await p.dblclick(fill(step.dblclick), { timeout: 8000 });
      if (step.hover) await p.hover(fill(step.hover), { timeout: 8000 });
      if (step.fill) await p.fill(step.fill[0], step.fill[1]);
      if (step.eval) await p.evaluate(step.eval);
      if (step.waitFor) await p.waitForSelector(step.waitFor, { timeout: 30000 });
      if (step.wait) await p.waitForTimeout(step.wait);
    } catch (e) { console.log("  ! prep", JSON.stringify(step), e.message.split("\n")[0]); bad++; }
  }
  await p.waitForTimeout(400);
  // the What's new card and toasts out of the way
  await p.evaluate(() => { for (const c of document.querySelectorAll("#wn-card, .wn-card, .toast, #toast")) c.remove(); });
  const res = await p.evaluate(([marks, clip]) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
    const pick = (sel, nth) => { const all = [...document.querySelectorAll(sel)].filter(vis); return all[nth || 0] || null; };
    const layer = document.createElement("div");
    layer.id = "shot-layer";
    layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    document.body.appendChild(layer);
    const W = innerWidth, H = innerHeight, placed = [], missing = [];
    let crop = null;
    if (clip) {
      // a selector, a rect [x, y, w, h], or {sel, top, bottom, pad: [t, r, b, l]}:
      // the element's box, cut from the top of `top` to the bottom of `bottom`
      const c = typeof clip === "string" ? { sel: clip } : Array.isArray(clip) ? null : clip;
      if (c) {
        const e = pick(c.sel), r = e ? e.getBoundingClientRect() : null;
        if (r) {
          let t = r.top, bt = r.bottom;
          if (c.top && pick(c.top)) t = Math.max(t, pick(c.top).getBoundingClientRect().top - 12);
          if (c.bottom && pick(c.bottom)) bt = Math.min(bt, pick(c.bottom).getBoundingClientRect().bottom + 12);
          const pd = c.pad || [0, 0, 0, 0];
          crop = [r.left - pd[3], t - pd[0], r.width + pd[1] + pd[3], bt - t + pd[0] + pd[2]];
        }
      } else crop = clip;
    }
    marks.forEach((m, i) => {
      let r;
      if (m.rect) r = { left: m.rect[0], top: m.rect[1], right: m.rect[0] + m.rect[2], bottom: m.rect[1] + m.rect[3] };
      else {
        const e = pick(m.sel, m.nth);
        if (!e) { missing.push(i + 1 + " " + m.sel); return; }
        r = e.getBoundingClientRect();
      }
      const pad = 3;
      const x0 = Math.max(1, r.left - pad), y0 = Math.max(1, r.top - pad);
      const x1 = Math.min(W - 1, r.right + pad), y1 = Math.min(H - 1, r.bottom + pad);
      if (m.box !== false) {
        const bx = document.createElement("div");
        bx.style.cssText = `position:absolute;left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px;border:2px solid #e11d48;border-radius:5px;box-shadow:0 0 0 1px #fff`;
        layer.appendChild(bx);
      }
      // the number: at the box's corner (m.at: tl, tr, bl, br, l, r), kept in view and off the other numbers
      const at = m.at || "tl", D = 24;
      let cx = at.includes("r") ? x1 : at === "l" ? x0 - D / 2 - 2 : x0, cy = at.includes("b") ? y1 : at === "l" || at === "r" ? (y0 + y1) / 2 : y0;
      if (at === "r") cx = x1 + D / 2 + 2;
      if (at === "below") { cx = (x0 + x1) / 2; cy = y1 + D / 2 + 2; }
      if (at === "above") { cx = (x0 + x1) / 2; cy = y0 - D / 2 - 2; }
      if (crop) { cx = Math.max(crop[0] + D / 2, Math.min(crop[0] + crop[2] - D / 2, cx)); cy = Math.max(crop[1] + D / 2, Math.min(crop[1] + crop[3] - D / 2, cy)); }
      cx = Math.max(D / 2 + 1, Math.min(W - D / 2 - 1, cx)); cy = Math.max(D / 2 + 1, Math.min(H - D / 2 - 1, cy));
      for (let k = 0; k < 12 && placed.some((q) => Math.hypot(q[0] - cx, q[1] - cy) < D + 2); k++) cx += D * 0.8 * (cx > W - 60 ? -1 : 1);
      placed.push([cx, cy]);
      const c = document.createElement("div");
      c.textContent = String(i + 1);
      c.style.cssText = `position:absolute;left:${cx - D / 2}px;top:${cy - D / 2}px;width:${D}px;height:${D}px;border-radius:50%;background:#e11d48;color:#fff;font:700 13px/24px system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff,0 1px 4px rgba(0,0,0,.4)`;
      layer.appendChild(c);
    });
    return { missing, crop };
  }, [shot.marks.map((m) => Object.assign({}, m, { sel: m.sel ? fill(m.sel) : "" })), shot.clip || null]);
  if (res.missing.length) { console.log("  ! " + shot.id + " not found:", res.missing.join(" | ")); bad += res.missing.length; }
  const opts = { type: "jpeg", quality: 84 };
  if (res.crop) opts.clip = { x: Math.max(0, res.crop[0] - 14), y: Math.max(0, res.crop[1] - 14), width: res.crop[2] + 28, height: res.crop[3] + 28 };
  const shotBuf = await p.screenshot(opts);
  for (const o of OUTS) fs.writeFileSync(path.join(o, shot.id + ".jpg"), shotBuf);
  console.log("shot", shot.id, shot.marks.length, "marks");
  await p.evaluate(() => { const l = document.querySelector("#shot-layer"); if (l) l.remove(); });
}
if (errs.length) console.log("page errors:", errs.slice(0, 5).join(" | "));
console.log(bad ? `${bad} problem(s)` : "all marks found");
await b.close();
process.exit(bad ? 1 : 0);
