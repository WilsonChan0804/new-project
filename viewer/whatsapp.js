/* WhatsApp and the Messenger.
 *
 * Out: a message (its words, links and files) sent on to WhatsApp - the
 * phone's share sheet with the real pictures when the browser can, else
 * wa.me with the text (WhatsApp on the phone, WhatsApp Desktop or Web on a
 * computer).
 *
 * In: messages copied from WhatsApp and pasted, an exported chat
 * (WhatsApp > chat > Export chat: _chat.txt, or a .zip with the media),
 * and - on Android, with the viewer installed as an app - WhatsApp's own
 * Share button (manifest share_target, caught by sw.js).
 *
 * There is no link to WhatsApp's servers: that needs Meta's Business API.
 */

const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return u; } };

/* [label](viewer address) -> "label: https://..." for outside the viewer */
export function plainText(body) {
  return String(body || "").replace(/\[([^\]\n]{1,200})\]\(([^\s)]+)\)/g, (m, label, url) => label + ": " + abs(url));
}

export function waText(m, roomTitle) {
  const out = [];
  const c = m.card || {};
  if (c.type === "forward") out.push(`Forwarded from ${c.from} in ${c.room}:`);
  const inner = c.type === "forward" ? c.inner || {} : c;
  if (inner.type === "task") out.push(`Task: ${inner.title}`, abs(`tasks.html?list=${encodeURIComponent(inner.list_id)}&task=${encodeURIComponent(inner.task_id)}`));
  if (inner.type === "issue") {
    out.push(`Issue #${inner.number || "?"} ${inner.title} (${inner.status})`);
    out.push(abs(inner.sheet ? `index.html?project=${encodeURIComponent(inner.project)}&sheet=${encodeURIComponent(inner.sheet)}&select=${encodeURIComponent(inner.id)}`
      : `model.html?project=${encodeURIComponent(inner.project)}&select=${encodeURIComponent(inner.id)}`));
  }
  if (inner.type === "whatsapp") for (const l of (inner.lines || []).slice(-30)) out.push(`[${l.at}] ${l.name}: ${l.text}`);
  if (m.body) out.push(plainText(m.body));
  for (const f of m.files || []) out.push(`${f.name}: ${abs(f.url)}`);
  if (!out.length && roomTitle) out.push(roomTitle);
  return out.join("\n");
}

function token() {
  try { return localStorage.getItem("lwk-viewer:token") || ""; } catch (e) { return ""; }
}

/* Send one message on. On a phone that can share files, its pictures and
   files go as themselves; otherwise the text (with links to the files). */
export async function toWhatsApp(m, roomTitle) {
  const text = waText(m, roomTitle);
  const files = m.files || [];
  if (files.length && navigator.canShare && navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      const got = [];
      for (const f of files.slice(0, 10)) {
        const r = await fetch(f.url, { headers: { "X-Viewer-Token": token() } });
        if (!r.ok) throw new Error("HTTP " + r.status);
        got.push(new File([await r.blob()], f.name, { type: f.mime || "application/octet-stream" }));
      }
      const words = waText(Object.assign({}, m, { files: [] }), roomTitle);
      const data = { files: got, text: words };
      if (navigator.canShare(data)) { await navigator.share(data); return "shared"; }
    } catch (e) {
      if (e && e.name === "AbortError") return "cancelled";
      /* fall through to the text */
    }
  }
  if (navigator.share && matchMedia("(pointer: coarse)").matches && !files.length) {
    try { await navigator.share({ text }); return "shared"; } catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
  }
  window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener");
  return "opened";
}

/* ------------------------------------------------------------ reading WhatsApp's text */

const DATE = String.raw`\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}`;
const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?\s?[Mm]\.?)?`;
const FORMS = [
  // iPhone export / copy:   [04/10/2026, 10:32:15] Wing Lee: text
  new RegExp(String.raw`^‎?\[(${DATE}),?\s+(${TIME})\]\s(.+?):\s?([\s\S]*)$`),
  // Android export:         04/10/2026, 10:32 - Wing Lee: text
  new RegExp(String.raw`^‎?(${DATE}),?\s+(${TIME})\s[-–]\s(.+?):\s?([\s\S]*)$`),
  // WhatsApp Desktop copy:  [10:32, 04/10/2026] Wing Lee: text
  new RegExp(String.raw`^‎?\[(${TIME}),\s(${DATE})\]\s(.+?):\s?([\s\S]*)$`),
];
// a line of its own that is WhatsApp talking ("Messages are end-to-end encrypted")
const SYSTEM = new RegExp(String.raw`^‎?(\[?${DATE},?\s+${TIME}\]?\s[-–]?\s?|\[${TIME},\s${DATE}\]\s)`);

function fileOf(text) {
  const a = /<(?:attached|添付|附件|anexo)?:?\s*([^<>]+\.\w{2,5})>/i.exec(text);
  if (a) return a[1].trim();
  const b = /^‎?(.+\.\w{2,5}) \((?:file attached|檔案已附加|文件已附加)\)$/i.exec(text.trim());
  return b ? b[1].trim() : "";
}

/* WhatsApp's lines -> [{at, name, text, file}], or [] when it is not that. */
export function parseWhatsApp(raw) {
  const out = [];
  for (const line of String(raw || "").replace(/\r/g, "").split("\n")) {
    let hit = null;
    for (let i = 0; i < FORMS.length; i++) {
      const m = FORMS[i].exec(line);
      if (m && m[3].length <= 80) { hit = i === 2 ? { at: m[2] + " " + m[1], name: m[3], text: m[4] } : { at: m[1] + " " + m[2], name: m[3], text: m[4] }; break; }
    }
    if (hit) {
      hit.name = hit.name.replace(/^‎|‎$/g, "").replace(/^~\s?/, "").trim();
      hit.text = hit.text.replace(/‎/g, "");
      hit.file = fileOf(hit.text);
      if (hit.file) hit.text = hit.text.replace(/<[^<>]*>/, "").replace(/\(file attached\)/i, "").replace(hit.file, "").trim();
      out.push(hit);
    } else if (SYSTEM.test(line)) {
      continue;
    } else if (out.length) {
      out[out.length - 1].text += "\n" + line;       // a message over several lines
    }
  }
  return out;
}

/* ------------------------------------------------------------ an exported chat (.txt or .zip) */

/* The files in a .zip, read by the browser itself (DecompressionStream):
   [{name, blob}]. Only "stored" and "deflate", which is what phones write. */
export async function readZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a zip file");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith("/")) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = buf.subarray(start, start + csize);
    let blob;
    if (method === 0) blob = new Blob([raw]);
    else if (method === 8 && typeof DecompressionStream !== "undefined") {
      blob = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
    } else continue;
    out.push({ name: name.split("/").pop(), blob });
  }
  return out;
}

const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", mp4: "video/mp4",
  mov: "video/quicktime", opus: "audio/ogg", ogg: "audio/ogg", m4a: "audio/mp4", mp3: "audio/mpeg", pdf: "application/pdf",
  vcf: "text/vcard", txt: "text/plain", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };

/* WhatsApp's "Export chat": {title, lines, media: [File]} */
export async function readExport(file) {
  let text = "", media = [];
  if (/\.zip$/i.test(file.name) || file.type === "application/zip") {
    const all = await readZip(file);
    const chat = all.find((x) => /\.txt$/i.test(x.name));
    if (!chat) throw new Error("No chat text (.txt) in that zip - export the chat from WhatsApp again");
    text = await chat.blob.text();
    media = all.filter((x) => x !== chat).map((x) => new File([x.blob], x.name,
      { type: MIME[(x.name.split(".").pop() || "").toLowerCase()] || "application/octet-stream" }));
  } else {
    text = await file.text();
  }
  const lines = parseWhatsApp(text);
  if (!lines.length) throw new Error("That does not look like a WhatsApp chat export");
  const used = new Set(lines.map((l) => l.file).filter(Boolean));
  media = media.filter((f) => used.has(f.name));
  const title = (/WhatsApp Chat (?:with|-)\s*(.+?)(?:\.zip|\.txt)?$/i.exec(file.name) || [])[1] || "";
  return { title: title ? "WhatsApp chat - " + title : "WhatsApp chat", lines, media };
}
