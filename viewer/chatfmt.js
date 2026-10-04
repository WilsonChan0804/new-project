/* Message formatting, as WhatsApp writes it (so a message forwarded to or
 * pasted from WhatsApp keeps its look):
 *
 *   *bold*  _italic_  ~strike~  ++underline++  `code`
 *   ``` a block of code ```
 *   - a bullet        1. a numbered line        > a quote
 *
 * The text is stored as typed; formatHtml() draws it. Everything that is
 * not a mark goes through the page's own renderer (escaping, links,
 * @mentions, # ! $ % chips), so no HTML can come in through the marks.
 *
 * The message box (richbox.js) shows the formatting itself and writes it
 * this way when the message is sent.
 */

import { esc } from "./tasks-util.js";

// kept whole: code spans, [label](address) links and plain addresses
const ATOM = /`[^`\n]+`|\[[^\]\n]{1,200}\]\([^\s)]+\)|https?:\/\/[^\s<>"']+/g;
// a mark: not inside a word, not round spaces
const MARK = /(^|[^\w*_~`+\u0000])(\+\+|[*_~])(?=[^\s])([^\n]*?[^\s])\2(?![\w*_~`+])/;
const TAG = { "*": "b", "_": "i", "~": "s", "++": "u" };

/* One line (or several) of running text: marks, atoms and the rest. */
function inline(text, render) {
  const atoms = [];
  const s = text.replace(ATOM, (a) => { atoms.push(a); return "\u0000" + (atoms.length - 1) + "\u0000"; });
  const plain = (t) => t.split(/\u0000(\d+)\u0000/).map((p, i) => {
    if (!(i % 2)) return p ? render(p) : "";
    const a = atoms[Number(p)];
    return a.startsWith("`") ? `<code>${esc(a.slice(1, -1))}</code>` : render(a);
  }).join("");
  const walk = (t, depth) => {
    const m = depth < 4 && MARK.exec(t);
    if (!m) return plain(t);
    const at = m.index + m[1].length;
    const tag = TAG[m[2]];
    return plain(t.slice(0, at)) + `<${tag}>` + walk(m[3], depth + 1) + `</${tag}>` + walk(t.slice(at + m[3].length + 2 * m[2].length), depth);
  };
  return walk(s, 0);
}

const BULLET = /^\s{0,3}[-*•]\s+/;
const NUMBER = /^\s{0,3}(\d{1,3})[.)]\s+/;
const QUOTE = /^\s{0,3}>\s?/;

/* The whole message. render(text) -> HTML for plain text (escaped). */
export function formatHtml(text, render) {
  const lines = String(text || "").split("\n");
  const out = [];       // pieces; "\n" only between running lines
  let i = 0;
  const run = [];
  const flush = () => { if (run.length) { out.push({ t: "run", h: run.map((l) => inline(l, render)).join("\n") }); run.length = 0; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*```/.test(l)) {
      // a code block: up to the closing ```, or the end
      flush();
      const body = [];
      const first = l.replace(/^\s*```\w*\s?/, "");
      let j = i + 1, closed = false;
      if (first.includes("```")) { body.push(first.slice(0, first.indexOf("```"))); closed = true; j = i + 1; }
      else {
        if (first) body.push(first);
        for (; j < lines.length; j++) {
          const k = lines[j].indexOf("```");
          if (k >= 0) { if (lines[j].slice(0, k)) body.push(lines[j].slice(0, k)); closed = true; j++; break; }
          body.push(lines[j]);
        }
      }
      if (!closed && j >= lines.length && !body.length) { run.push(l); i++; continue; }
      out.push({ t: "blk", h: `<pre class="c-pre">${esc(body.join("\n"))}</pre>` });
      i = j;
      continue;
    }
    if (BULLET.test(l) || NUMBER.test(l)) {
      flush();
      const num = NUMBER.test(l);
      const re = num ? NUMBER : BULLET;
      const items = [];
      const start = num ? Number(NUMBER.exec(l)[1]) : 1;
      while (i < lines.length && re.test(lines[i])) {
        items.push(inline(lines[i].replace(re, ""), render));
        i++;
      }
      out.push({ t: "blk", h: num ? `<ol class="c-ol"${start !== 1 ? ` start="${start}"` : ""}>${items.map((x) => `<li>${x}</li>`).join("")}</ol>`
        : `<ul class="c-ul">${items.map((x) => `<li>${x}</li>`).join("")}</ul>` });
      continue;
    }
    if (QUOTE.test(l)) {
      flush();
      const q = [];
      while (i < lines.length && QUOTE.test(lines[i])) { q.push(inline(lines[i].replace(QUOTE, ""), render)); i++; }
      out.push({ t: "blk", h: `<blockquote class="c-bq">${q.join("\n")}</blockquote>` });
      continue;
    }
    run.push(l);
    i++;
  }
  flush();
  // running text keeps its line breaks (white-space: pre-wrap); a block
  // stands on its own, so the breaks round it go
  return out.map((p, k) => (k && p.t === "run" && out[k - 1].t === "run" ? "\n" : "") + p.h).join("");
}

/* The words without the marks (previews, quotes of a reply). */
export function plainText(text) {
  let t = String(text || "").replace(/^\s*```\w*\s*$/gm, "").replace(/```/g, "").replace(/`([^`\n]+)`/g, "$1");
  for (let k = 0; k < 3; k++) t = t.replace(new RegExp(MARK.source, "g"), "$1$3");
  return t;
}

/* Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+Shift+X: which format, or "". */
export function formatKey(ev) {
  if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return "";
  const k = ev.key.toLowerCase();
  if (k === "b" && !ev.shiftKey) return "b";
  if (k === "i" && !ev.shiftKey) return "i";
  if (k === "x" && ev.shiftKey) return "s";
  if (k === "u" && !ev.shiftKey) return "u";
  return "";
}
