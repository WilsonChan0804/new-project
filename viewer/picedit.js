/* Mark up a picture - the same tools as an issue's snapshot (markup.js):
 * rectangle, cloud, arrow, pen, text, callout ... on any picture, anywhere
 * (a query's sheet or 3D view, a photo added to it).
 *
 *   const r = await editPicture(src, markup)
 *   r: null (cancelled) or { image: data URL with the markup drawn in,
 *                            markup: the drawing, to edit again later }
 *
 * The markup is kept apart from the picture it was drawn on, as on issues:
 * open it again later and the drawing can still be moved or changed.
 */

import * as MK from "./markup.js";
import { iconButton } from "./icons.js";

const FONTS = ["Segoe UI", "Arial", "Calibri", "Tahoma", "Verdana", "Times New Roman", "Georgia", "Consolas", "Microsoft JhengHei", "Microsoft YaHei", "PingFang TC"];
let DOM = null;

function build() {
  if (DOM) return DOM;
  const back = document.createElement("div");
  back.id = "pe-back";
  back.hidden = true;
  back.innerHTML = `<div id="pe-dlg"><div id="pe-bar"><div id="pe-tools" class="tools"></div><span class="sep"></span>`
    + `<label class="p">Line<input type="color" id="pe-color" value="#ff3b30"></label>`
    + `<label class="p">Fill<input type="color" id="pe-fill" value="#ff3b30"></label>`
    + `<label class="p" title="Colour of text - separate from the line">Text<input type="color" id="pe-tcolor" value="#ff3b30"></label>`
    + `<label class="p">Opacity<input type="range" id="pe-fillop" min="0" max="100" value="0"></label>`
    + `<label class="p">Weight<input id="pe-width" type="number" value="0.5" min="0.05" max="20" step="0.05" style="width:58px"></label>`
    + `<label class="p">Type<select id="pe-dash"><option value="none">Solid</option><option value="dash">Dashed</option><option value="dot">Dotted</option><option value="dashdot">Dash-dot</option></select></label>`
    + `<label class="p">Font<select id="pe-font">${FONTS.map((f) => `<option>${f}</option>`).join("")}</select></label>`
    + `<label class="p">Size<input id="pe-size" type="number" value="3.5" min="0.5" max="200" step="0.5" style="width:58px"></label>`
    + `<span class="sep"></span><button id="pe-delete" class="ghost" disabled>Delete</button><button id="pe-undo" class="ghost">Undo</button><button id="pe-clear" class="ghost">Clear</button>`
    + `<div class="spacer" style="flex:1"></div><button id="pe-cancel" class="ghost">Cancel</button><button id="pe-ok" class="primary">Done</button></div>`
    + `<div id="pe-stage"><img id="pe-img" alt="picture"><svg id="pe-svg" xmlns="http://www.w3.org/2000/svg"></svg></div></div>`;
  document.body.appendChild(back);
  const st = document.createElement("style");
  st.textContent = `
#pe-back { position: fixed; inset: 0; background: rgba(24,30,40,.52); z-index: 5000; display: flex; align-items: center; justify-content: center; }
#pe-back[hidden] { display: none; }
#pe-dlg { width: 92vw; height: 90vh; background: var(--panel, #fff); color: var(--ink, #222); border: 1px solid var(--line, #ddd); border-radius: 10px; box-shadow: 0 16px 50px rgba(20,26,36,.22); display: flex; flex-direction: column; overflow: hidden; }
#pe-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border-bottom: 1px solid var(--line, #ddd); }
#pe-bar .tools { display: flex; gap: 3px; flex-wrap: wrap; }
#pe-bar .tools button { padding: 3px 7px; font-size: 11px; }
#pe-bar .tools button.active { outline: 2px solid var(--accent, #f28022); }
#pe-bar .p { font-size: 11px; color: var(--muted, #777); display: inline-flex; align-items: center; gap: 4px; }
#pe-bar .sep { width: 1px; height: 22px; background: var(--line, #ddd); }
#pe-stage { flex: 1; min-height: 0; position: relative; display: flex; align-items: center; justify-content: center; background: var(--panel-2, #f4f4f4); padding: 10px; }
#pe-img { max-width: 100%; max-height: 100%; display: block; user-select: none; }
#pe-svg { position: absolute; cursor: crosshair; touch-action: none; }
#pe-svg .handle { cursor: nwse-resize; }
#pe-svg .mk { cursor: move; }
`;
  document.head.appendChild(st);
  const $ = (id) => back.querySelector("#" + id);
  DOM = { back, $, img: $("pe-img"), svg: $("pe-svg"), stage: $("pe-stage") };
  return DOM;
}

export function editPicture(src, initial) {
  const { back, $, img, svg, stage } = build();
  const items = (initial || []).map((x) => JSON.parse(JSON.stringify(x)));
  let ctl = null;
  return new Promise((resolve) => {
    img.crossOrigin = "anonymous";
    img.src = src;
    back.hidden = false;
    const size = () => { const r = img.getBoundingClientRect(); return [Math.max(1, r.width), Math.max(1, r.height)]; };
    const paint = () => {
      const [w, h] = size();
      svg.setAttribute("width", w);
      svg.setAttribute("height", h);
      const ir = img.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      svg.style.left = (ir.left - sr.left) + "px";
      svg.style.top = (ir.top - sr.top) + "px";
      MK.redraw(svg, items, w, h, ctl && ctl.getDraft(), ctl && ctl.selectedId());
      $("pe-delete").disabled = !(ctl && ctl.selected());
    };
    const style = () => ({
      color: $("pe-color").value, tcolor: $("pe-tcolor").value, fill: $("pe-fill").value,
      fillop: Number($("pe-fillop").value), width: (Number($("pe-width").value) || 0.5) * 0.008,
      dash: $("pe-dash").value, font: $("pe-font").value, size: (Number($("pe-size").value) || 3.5) * 0.01, align: "start",
    });
    ctl = MK.attach(svg, items, {
      getStyle: style, onChange: paint, onSelect: () => paint(),
      onText: () => { const v = prompt("Text"); return v === null ? null : v; },
    });
    const tw = $("pe-tools");
    tw.innerHTML = "";
    for (const t of MK.TOOLS) {
      const b = iconButton(t.id, t.label, t.label);
      if (t.id === "select") b.classList.add("active");
      b.onclick = () => { tw.querySelectorAll("button").forEach((x) => x.classList.remove("active")); b.classList.add("active"); ctl.setTool(t.id); paint(); };
      tw.appendChild(b);
    }
    // start with the cloud: what a picture is usually marked up with
    const first = Array.from(tw.querySelectorAll("button"))[MK.TOOLS.findIndex((t) => t.id === "cloud")];
    if (first && !items.length) first.click();
    for (const id of ["pe-color", "pe-fill", "pe-tcolor", "pe-fillop", "pe-width", "pe-dash", "pe-font", "pe-size"]) $(id).oninput = () => { ctl.applyStyle(style()); paint(); };
    $("pe-delete").onclick = () => { ctl.deleteSelected(); paint(); };
    $("pe-undo").onclick = () => { items.pop(); paint(); };
    $("pe-clear").onclick = () => { items.length = 0; paint(); };
    const onKey = (ev) => {
      if (back.hidden) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) && ev.key !== "Escape") return;
      if (ev.key === "Delete" || ev.key === "Backspace") { ctl.deleteSelected(); paint(); }
      else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); ctl.cancel(); paint(); finish(false); }
    };
    const finish = async (keep) => {
      back.hidden = true;
      removeEventListener("resize", paint);
      removeEventListener("keydown", onKey, true);
      try { ctl.detach(); } catch (e) {}
      if (!keep) { resolve(null); return; }
      try { resolve({ image: await flatten(img, items), markup: items.slice() }); }
      catch (e) { alert("Could not keep the markup: " + e.message); resolve(null); }
    };
    $("pe-cancel").onclick = () => finish(false);
    $("pe-ok").onclick = () => finish(true);
    addEventListener("resize", paint);
    addEventListener("keydown", onKey, true);
    img.onload = paint;
    if (img.complete) paint();
  });
}

/* The picture with its markup drawn in, as a JPEG (at most 2400 px). */
function flatten(img, markup) {
  return new Promise((resolve, reject) => {
    const k = Math.min(1, 2400 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round((img.naturalWidth || 1) * k));
    c.height = Math.max(1, Math.round((img.naturalHeight || 1) * k));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (!markup.length) { resolve(c.toDataURL("image/jpeg", 0.88)); return; }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", c.width);
    svg.setAttribute("height", c.height);
    MK.redraw(svg, markup, c.width, c.height, null, null);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" }));
    const over = new Image();
    over.onload = () => { ctx.drawImage(over, 0, 0); URL.revokeObjectURL(url); resolve(c.toDataURL("image/jpeg", 0.88)); };
    over.onerror = () => { URL.revokeObjectURL(url); reject(new Error("the drawing could not be put on the picture")); };
    over.src = url;
  });
}
