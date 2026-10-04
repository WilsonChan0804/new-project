/* The message box as Lark has it: what you write shows as it will be sent
 * (bold is bold, a list is a list) instead of showing the marks.
 *
 * Underneath it is still the WhatsApp way of writing (chatfmt.js), so a
 * message is stored, searched, forwarded and pasted to WhatsApp as plain
 * text: box.value reads the box as that text, and setting it draws text
 * written that way.
 *
 *   *bold*  _italic_  ~strike~  ++underline++  `code`  ``` block ```
 *   - bullet   1. numbered   > quote   [label](address)
 *
 * A picked task, issue, sheet or 3D view sits in the box as a chip that is
 * deleted as one piece (data-md holds its [label](address)).
 */

import { esc } from "./tasks-util.js";
import { formatHtml } from "./chatfmt.js";

const LINK = /^\[([^\]\n]{1,200})\]\(([^\s)]+)\)$/;
const VIEWER = /^(?:https?:\/\/[^\s)]+\/)?(?:index|model|tasks|projects|dashboard|messenger)\.html\?/;

/* text written the WhatsApp way -> what the box shows */
function toHtml(md) {
  const render = (t) => {
    const m = LINK.exec(t);
    if (m) return VIEWER.test(m[2]) || m[2].startsWith("/") ? chipHtml(t, m[1])
      : `<a href="${esc(m[2])}">${esc(m[1])}</a>`;
    return esc(t);
  };
  return formatHtml(md || "", render).replace(/<pre class="c-pre">/g, "<pre>")
    .replace(/<(ul|ol|blockquote) class="c-\w+"/g, "<$1");
}
export function chipHtml(md, label) {
  return `<span class="rb-chip" contenteditable="false" data-md="${esc(md)}">${esc(label)}</span>`;
}

/* ------------------------------------------------------------ the box -> text */

const BLOCK = new Set(["DIV", "P", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "H1", "H2", "H3", "H4", "H5", "H6", "TABLE", "TR"]);

function marksOf(el) {
  const t = el.tagName, s = el.style || {};
  const out = [];
  if (t === "B" || t === "STRONG" || Number(s.fontWeight) >= 600 || s.fontWeight === "bold") out.push("*");
  if (t === "I" || t === "EM" || s.fontStyle === "italic") out.push("_");
  const deco = (s.textDecoration || "") + " " + (s.textDecorationLine || "");
  if (t === "S" || t === "STRIKE" || t === "DEL" || /line-through/.test(deco)) out.push("~");
  if (t === "U" || t === "INS" || /underline/.test(deco)) out.push("++");
  return out;
}

/* marks go round the words, never round spaces at either end */
function wrap(mark, inner) {
  if (!inner.trim()) return inner;
  const lead = inner.match(/^\s*/)[0], tail = inner.match(/\s*$/)[0];
  return lead + mark + inner.slice(lead.length, inner.length - tail.length) + mark + tail;
}

function inlineOf(node, on) {
  let out = "";
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out += n.data.replace(/ /g, " ").replace(/​/g, ""); continue; }
    if (n.nodeType !== 1) continue;
    if (n.dataset && n.dataset.md) { out += n.dataset.md; continue; }
    if (n.tagName === "BR") { out += "\n"; continue; }
    if (n.tagName === "IMG") continue;
    if (BLOCK.has(n.tagName)) { out += (out && !out.endsWith("\n") ? "\n" : "") + blockOf(n, on) + "\n"; continue; }
    if (n.tagName === "CODE") { const t = n.textContent.replace(/`/g, "'"); out += t.trim() ? "`" + t + "`" : t; continue; }
    if (n.tagName === "A" && n.getAttribute("href")) {
      const label = n.textContent.trim(), href = n.getAttribute("href");
      out += label && label !== href ? `[${label.replace(/[[\]]/g, " ")}](${href})` : href;
      continue;
    }
    // one mark a tag (a span both bold and italic: bold); a mark already
    // round it (bold in bold) is not repeated
    const mk = marksOf(n).find((x) => !on.has(x));
    if (!mk) { out += inlineOf(n, on); continue; }
    on.add(mk);
    out += wrap(mk, inlineOf(n, on));
    on.delete(mk);
  }
  return out;
}

function blockOf(el, on) {
  const t = el.tagName;
  if (t === "PRE") return "```\n" + el.textContent.replace(/\n$/, "") + "\n```";
  if (t === "UL" || t === "OL") {
    let i = Number(el.getAttribute("start")) || 1;
    const lines = [];
    for (const li of el.children) {
      if (li.tagName !== "LI") continue;
      // a list inside an item: its lines follow, flattened
      const own = document.createElement("div");
      for (const c of li.childNodes) if (!(c.tagName === "UL" || c.tagName === "OL")) own.appendChild(c.cloneNode(true));
      lines.push((t === "OL" ? `${i++}. ` : "- ") + inlineOf(own, on).replace(/\n+/g, " ").trim());
      for (const c of li.children) if (c.tagName === "UL" || c.tagName === "OL") lines.push(blockOf(c, on));
    }
    return lines.join("\n");
  }
  if (t === "BLOCKQUOTE") return inlineOf(el, on).replace(/\n+$/, "").split("\n").map((l) => "> " + l).join("\n");
  return inlineOf(el, on).replace(/\n$/, "");
}

export function toText(el) {
  return inlineOf(el, new Set()).replace(/\n{3,}/g, "\n\n").replace(/^\n+|\s+$/g, "");
}

/* ------------------------------------------------------------ RichBox */

export class RichBox {
  /* opts.onPaste(text): true when it took the pasted text itself */
  constructor(el, opts) {
    this.el = el;
    this.opts = opts || {};
    el.contentEditable = "true";
    el.classList.add("rb");
    el.setAttribute("role", "textbox");
    el.setAttribute("aria-multiline", "true");
    el._rb = this;
    try { document.execCommand("defaultParagraphSeparator", false, "div"); } catch (e) {}
    el.addEventListener("input", () => this.paintEmpty());
    el.addEventListener("paste", (ev) => {
      if (ev.defaultPrevented) return;                   // files: catchFiles took them
      const t = ev.clipboardData && ev.clipboardData.getData("text/plain");
      ev.preventDefault();
      if (!t) return;
      if (this.opts.onPaste && this.opts.onPaste(t)) return;
      this.insertText(t);
    });
    el.addEventListener("drop", (ev) => {
      const t = ev.dataTransfer && !ev.dataTransfer.files.length && ev.dataTransfer.getData("text/plain");
      if (t) { ev.preventDefault(); this.insertText(t); }
    });
    // a chip: Backspace takes it in one go (some browsers stop at it)
    el.addEventListener("keydown", (ev) => {
      if (ev.key !== "Backspace") return;
      const r = this.range();
      if (!r || !r.collapsed) return;
      let n = r.startContainer, o = r.startOffset;
      let prev = null;
      if (n.nodeType === 3 && o === 0) prev = n.previousSibling;
      else if (n.nodeType === 1 && o > 0) prev = n.childNodes[o - 1];
      if (prev && prev.classList && prev.classList.contains("rb-chip")) { ev.preventDefault(); prev.remove(); this.changed(); }
    });
    this.paintEmpty();
  }

  get value() { return toText(this.el); }
  set value(md) {
    this.el.innerHTML = md ? toHtml(md) : "";
    this.paintEmpty();
  }
  clear() { this.value = ""; }
  focus() { this.el.focus(); }
  paintEmpty() {
    const empty = !this.el.textContent.trim() && !this.el.querySelector(".rb-chip, li, img");
    this.el.classList.toggle("rb-empty", empty);
  }
  changed() { this.el.dispatchEvent(new Event("input", { bubbles: true })); }

  range() {
    const s = getSelection();
    if (!s.rangeCount) return null;
    const r = s.getRangeAt(0);
    return this.el.contains(r.startContainer) ? r : null;
  }
  saveRange() { const r = this.range(); this.saved = r ? r.cloneRange() : null; return this.saved; }
  restoreRange() {
    this.el.focus();
    const s = getSelection();
    if (this.saved && this.el.contains(this.saved.startContainer)) { s.removeAllRanges(); s.addRange(this.saved.cloneRange()); }
    else this.caretToEnd();
  }
  caretToEnd() {
    const r = document.createRange();
    r.selectNodeContents(this.el);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }

  /* the words before the caret on its line (for @ # ! $ %) */
  textBefore() {
    const r = this.range();
    if (!r || !r.collapsed) return "";
    let line = r.startContainer;
    while (line !== this.el && !(line.nodeType === 1 && BLOCK.has(line.tagName))) line = line.parentNode;
    const upto = document.createRange();
    upto.setStart(line, 0);
    upto.setEnd(r.startContainer, r.startOffset);
    return upto.toString().split("\n").pop().replace(/\u00a0/g, " ");
  }

  /* take the last n characters before the caret away and put text there */
  replaceBefore(n, text, html) {
    if (!this.range()) this.caretToEnd();
    const s = getSelection();
    s.collapseToEnd();
    for (let i = 0; i < n; i++) s.modify("extend", "backward", "character");
    this.insert(text, html);
  }

  insert(text, html) {
    this.el.focus();
    if (html) document.execCommand("insertHTML", false, html);
    else if (text) document.execCommand("insertText", false, text);
    else if (!getSelection().isCollapsed) document.execCommand("delete");
    this.paintEmpty();
  }
  insertText(t) { if (!this.range()) this.caretToEnd(); this.insert(t); }
  insertChip(md, label) {
    this.el.focus();
    if (!this.range()) this.caretToEnd();
    // by hand: insertHTML moves a non-editable piece out of the line it is in
    const r = this.range();
    r.deleteContents();
    const t = document.createElement("template");
    t.innerHTML = chipHtml(md, label);
    const chip = t.content.firstChild;
    const gap = document.createTextNode("\u00a0");
    r.insertNode(gap);
    r.insertNode(chip);
    const after = document.createRange();
    after.setStart(gap, 1);
    after.collapse(true);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(after);
    this.changed();
  }

  /* ------------------------------------------------ formatting */

  inside(tag) {
    const r = this.range();
    let n = r && r.startContainer;
    for (; n && n !== this.el; n = n.parentNode) if (n.nodeType === 1 && n.tagName === tag) return n;
    return null;
  }

  format(k) {
    this.el.focus();
    if (!this.range()) this.caretToEnd();
    try { document.execCommand("styleWithCSS", false, false); } catch (e) {}
    const cmd = { b: "bold", i: "italic", s: "strikeThrough", u: "underline", ul: "insertUnorderedList", ol: "insertOrderedList" }[k];
    if (cmd) document.execCommand(cmd);
    else if (k === "quote") document.execCommand("formatBlock", false, this.inside("BLOCKQUOTE") ? "div" : "blockquote");
    else if (k === "pre") document.execCommand("formatBlock", false, this.inside("PRE") ? "div" : "pre");
    else if (k === "code") this.code();
    else if (k === "clear") document.execCommand("removeFormat");
    this.changed();
  }

  /* `code` round the selection; inside code: out of it */
  code() {
    const c = this.inside("CODE");
    if (c) { c.replaceWith(document.createTextNode(c.textContent)); return; }
    const r = this.range();
    if (!r) return;
    const t = r.collapsed ? "" : r.toString();
    document.execCommand("insertHTML", false, `<code>${esc(t || "code")}</code>​`);
  }

  /* which of B I S U ... the caret is in (to light the buttons up) */
  states() {
    const q = (c) => { try { return document.queryCommandState(c); } catch (e) { return false; } };
    if (!this.range()) return {};
    return { b: q("bold"), i: q("italic"), s: q("strikeThrough"), u: q("underline"),
      ul: q("insertUnorderedList"), ol: q("insertOrderedList"),
      quote: !!this.inside("BLOCKQUOTE"), pre: !!this.inside("PRE"), code: !!this.inside("CODE") };
  }

  /* a link round the selection (or the words given) */
  link(url, label) {
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    this.restoreRange();
    const r = this.range();
    const sel = r && !r.collapsed ? r.toString() : "";
    document.execCommand("insertHTML", false, `<a href="${esc(url)}">${esc(label || sel || url)}</a> `);
    this.changed();
  }
}
