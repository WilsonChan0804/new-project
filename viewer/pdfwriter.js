/* A minimal PDF writer.
 *
 * Just enough of the format to put one JPEG on each page at the page's
 * true paper size. There is no PDF library available offline, and pulling
 * one in for this would be a far larger dependency than the job needs: a
 * JPEG can go into a PDF as-is (the DCTDecode filter is JPEG), so the file
 * is a catalogue, a page tree, and per page an image, a one-line drawing
 * instruction and a cross-reference table of byte offsets.
 *
 * The page size is given in PDF points, separately from the image's pixel
 * size, so an A1 sheet prints as A1 at whatever resolution was rendered.
 */

const enc = new TextEncoder();

/* pages: [{ jpeg: Uint8Array, px: [w, h], pt: [w, h] }], meta: { title, author } */
export function buildPdf(pages, meta) {
  const parts = [];
  let length = 0;
  const offsets = [];          // byte offset of each object, by object number

  const push = (bytes) => { parts.push(bytes); length += bytes.length; };
  const text = (s) => push(enc.encode(s));

  // Object numbers: 1 catalog, 2 pages, 3 info, then 3 per page.
  const pageObj = (i) => 4 + i * 3;
  const contentObj = (i) => 5 + i * 3;
  const imageObj = (i) => 6 + i * 3;
  const total = 3 + pages.length * 3;

  const open = (n) => { offsets[n] = length; text(`${n} 0 obj\n`); };
  const close = () => text("endobj\n");

  // The binary comment line tells transfer programs this is not text.
  text("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");

  open(1);
  text("<< /Type /Catalog /Pages 2 0 R >>\n");
  close();

  open(2);
  const kids = pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ");
  text(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\n`);
  close();

  open(3);
  const esc = (s) => String(s || "").replace(/[\\()]/g, (c) => "\\" + c);
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `D:${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    + `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  text(`<< /Title (${esc(meta && meta.title)}) /Author (${esc(meta && meta.author)})`
    + ` /Producer (LWK Viewer) /CreationDate (${stamp}) >>\n`);
  close();

  pages.forEach((pg, i) => {
    const [pw, ph] = pg.pt;
    open(pageObj(i));
    text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}]`
      + ` /Resources << /XObject << /Im0 ${imageObj(i)} 0 R >> >>`
      + ` /Contents ${contentObj(i)} 0 R >>\n`);
    close();

    // Stretch the unit-square image to the page: the "cm" matrix scales it.
    const draw = `q ${pw.toFixed(2)} 0 0 ${ph.toFixed(2)} 0 0 cm /Im0 Do Q\n`;
    const drawBytes = enc.encode(draw);
    open(contentObj(i));
    text(`<< /Length ${drawBytes.length} >>\nstream\n`);
    push(drawBytes);
    text("endstream\n");
    close();

    open(imageObj(i));
    text(`<< /Type /XObject /Subtype /Image /Width ${pg.px[0]} /Height ${pg.px[1]}`
      + ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`
      + ` /Length ${pg.jpeg.length} >>\nstream\n`);
    push(pg.jpeg);
    text("\nendstream\n");
    close();
  });

  // Cross-reference: every offset exactly ten digits, every line exactly
  // twenty bytes including its two-byte end-of-line - the format insists.
  const xref = length;
  text(`xref\n0 ${total + 1}\n`);
  text("0000000000 65535 f \n");
  for (let n = 1; n <= total; n++) {
    text(String(offsets[n]).padStart(10, "0") + " 00000 n \n");
  }
  text(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 3 0 R >>\n`);
  text(`startxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return new Blob([out], { type: "application/pdf" });
}
