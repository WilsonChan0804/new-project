/* Message formatting, as WhatsApp writes it (so a message forwarded to or
 * pasted from WhatsApp keeps its look):
 *
 *   *bold*  _italic_  ~strike~  `code`
 *   ``` a block of code ```
 *   - a bullet        1. a numbered line        > a quote
 *
 * The text is stored as typed; formatHtml() draws it. Everything that is
 * not a mark goes through the page's own renderer (escaping, links,
 * @mentions, # ! $ % chips), so no HTML can come in through the marks.
 *
 * The format bar (Aa in the message box) and Ctrl+B / Ctrl+I / Ctrl+Shift+X
 * put the marks round the selection; Enter on a list line starts the next.
 */

import { esc } from "./tasks-util.js";

// kept whole: code spans, [label](address) links and plain addresses
const ATOM = /`[^`\n]+`|\[[^\]\n]{1,200}\]\([^\s)]+\)|https?:\/\/[^\s<>"']+/g;
// a mark: not inside a word, not round spaces
const MARK = /(^|[^\w*_~`\u0000])([*_~])(?=[^\s])([^\n]*?[^\s])\2(?![\w*_~`])/;
const TAG = { "*": "b", "_": "i", "~": "s" };

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
    return plain(t.slice(0, at)) + `<${tag}>` + walk(m[3], depth + 1) + `</${tag}>` + walk(t.slice(at + m[3].length + 2), depth);
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

/* ------------------------------------------------------------ the box */

/* Marks round the selection (or round the word at the caret); again
   takes them off. */
export function wrap(ta, mark) {
  let a = ta.selectionStart, b = ta.selectionEnd;
  const v = ta.value;
  if (a === b) {
    // the word at the caret
    while (a > 0 && /\S/.test(v[a - 1])) a--;
    while (b < v.length && /\S/.test(v[b])) b++;
  }
  const sel = v.slice(a, b);
  const m = mark.length;
  let text, s0, s1;
  if (sel.length >= 2 * m && sel.startsWith(mark) && sel.endsWith(mark)) {
    text = sel.slice(m, -m); s0 = a; s1 = a + text.length;
  } else if (v.slice(a - m, a) === mark && v.slice(b, b + m) === mark) {
    a -= m; b += m; text = sel; s0 = a; s1 = a + sel.length;
  } else {
    // marks go round the words, not round spaces at either end
    const lead = sel.match(/^\s*/)[0], tail = sel.match(/\s*$/)[0];
    const core = sel.slice(lead.length, sel.length - tail.length);
    text = lead + mark + core + mark + tail; s0 = a + lead.length + m; s1 = s0 + core.length;
  }
  ta.setRangeText(text, a, b, "end");
  ta.setSelectionRange(s0, s1);
  ta.focus();
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

/* A ``` block round the selected lines. */
export function codeBlock(ta) {
  const v = ta.value;
  let a = ta.selectionStart, b = ta.selectionEnd;
  a = v.lastIndexOf("\n", a - 1) + 1;
  const e = v.indexOf("\n", b);
  b = e < 0 ? v.length : e;
  const sel = v.slice(a, b);
  const text = "```\n" + sel + "\n```";
  ta.setRangeText(text, a, b, "end");
  ta.setSelectionRange(a + 4, a + 4 + sel.length);
  ta.focus();
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

/* "- ", "1. " or "> " in front of each selected line; again takes it off. */
export function linePrefix(ta, kind) {
  const v = ta.value;
  let a = v.lastIndexOf("\n", ta.selectionStart - 1) + 1;
  let e = v.indexOf("\n", ta.selectionEnd);
  if (e < 0) e = v.length;
  const lines = v.slice(a, e).split("\n");
  const re = kind === "ol" ? NUMBER : kind === "ul" ? BULLET : QUOTE;
  const all = lines.every((l) => re.test(l));
  const out = lines.map((l, i) => all ? l.replace(re, "")
    : (kind === "ol" ? `${i + 1}. ` : kind === "ul" ? "- " : "> ") + l.replace(BULLET, "").replace(NUMBER, "").replace(QUOTE, ""));
  const text = out.join("\n");
  ta.setRangeText(text, a, e, "end");
  ta.setSelectionRange(a + text.length, a + text.length);
  ta.focus();
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

/* Enter at the end of a list line: the next bullet or number. An empty
   item ends the list. True when it did something. */
export function continueList(ta) {
  const v = ta.value, at = ta.selectionStart;
  if (at !== ta.selectionEnd) return false;
  const a = v.lastIndexOf("\n", at - 1) + 1;
  const line = v.slice(a, at);
  if (v.slice(at).split("\n")[0].trim()) return false;
  let m = NUMBER.exec(line), next = "";
  if (m) next = line.match(/^\s*/)[0] + (Number(m[1]) + 1) + ". ";
  else if ((m = BULLET.exec(line))) next = m[0];
  else if ((m = QUOTE.exec(line))) next = "> ";
  else return false;
  if (!line.slice(m[0].length).trim()) {
    ta.setRangeText("", a, at, "end");          // an empty item: the list ends
  } else {
    ta.setRangeText("\n" + next, at, at, "end");
  }
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

export const FORMAT_BAR = [
  ["b", "*", "<b>B</b>", "Bold (Ctrl+B)"],
  ["i", "_", "<i>I</i>", "Italic (Ctrl+I)"],
  ["s", "~", "<s>S</s>", "Strikethrough (Ctrl+Shift+X)"],
  ["code", "`", "<code>&lt;/&gt;</code>", "Code"],
  ["ul", "", "&#8226; List", "Bulleted list"],
  ["ol", "", "1. List", "Numbered list"],
  ["quote", "", "&#10077; Quote", "Quote"],
  ["pre", "", "```", "Block of code"],
];

/* A click on the bar, or a shortcut. */
export function applyFormat(ta, k) {
  const f = FORMAT_BAR.find((x) => x[0] === k);
  if (!f) return;
  if (f[1]) return wrap(ta, f[1]);
  if (k === "pre") return codeBlock(ta);
  return linePrefix(ta, k === "quote" ? "quote" : k);
}

export function formatKey(ev) {
  if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return "";
  const k = ev.key.toLowerCase();
  if (k === "b" && !ev.shiftKey) return "b";
  if (k === "i" && !ev.shiftKey) return "i";
  if (k === "x" && ev.shiftKey) return "s";
  return "";
}
