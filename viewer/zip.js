/* A minimal ZIP writer.
 *
 * BCF is a zip container, and this viewer cannot pull a zip library from a
 * CDN. Entries are STORED rather than deflated: the payload is already
 * compressed (PNG snapshots) or tiny (XML), so deflate would buy almost
 * nothing while adding a compressor's worth of code to get wrong.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = (s) => new TextEncoder().encode(s);

/* MS-DOS date/time, which is what the zip format stores. */
function dosDateTime(d) {
  const time = ((d.getHours() & 31) << 11)
    | ((d.getMinutes() & 63) << 5)
    | ((Math.floor(d.getSeconds() / 2)) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9)
    | (((d.getMonth() + 1) & 15) << 5)
    | (d.getDate() & 31);
  return { time, date };
}

class Writer {
  constructor(size) {
    this.buf = new Uint8Array(size);
    this.pos = 0;
  }
  u16(v) {
    this.buf[this.pos++] = v & 0xff;
    this.buf[this.pos++] = (v >>> 8) & 0xff;
  }
  u32(v) {
    this.buf[this.pos++] = v & 0xff;
    this.buf[this.pos++] = (v >>> 8) & 0xff;
    this.buf[this.pos++] = (v >>> 16) & 0xff;
    this.buf[this.pos++] = (v >>> 24) & 0xff;
  }
  bytes(b) {
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }
}

/* files: [{ name, data }] where data is a Uint8Array or a string. */
export function zip(files, when) {
  const when_ = when || new Date();
  const { time, date } = dosDateTime(when_);

  const entries = files.map((f) => {
    const name = utf8(f.name);
    const data = typeof f.data === "string" ? utf8(f.data) : f.data;
    return { name, data, crc: crc32(data) };
  });

  let total = 0;
  for (const e of entries) {
    total += 30 + e.name.length + e.data.length;   // local header + payload
    total += 46 + e.name.length;                   // central directory
  }
  total += 22;                                     // end of central directory

  const w = new Writer(total);
  const offsets = [];

  for (const e of entries) {
    offsets.push(w.pos);
    w.u32(0x04034b50);
    w.u16(20);            // version needed
    w.u16(0x0800);        // UTF-8 names
    w.u16(0);             // stored
    w.u16(time); w.u16(date);
    w.u32(e.crc);
    w.u32(e.data.length);
    w.u32(e.data.length);
    w.u16(e.name.length);
    w.u16(0);
    w.bytes(e.name);
    w.bytes(e.data);
  }

  const dirStart = w.pos;
  entries.forEach((e, i) => {
    w.u32(0x02014b50);
    w.u16(20); w.u16(20);
    w.u16(0x0800);
    w.u16(0);
    w.u16(time); w.u16(date);
    w.u32(e.crc);
    w.u32(e.data.length);
    w.u32(e.data.length);
    w.u16(e.name.length);
    w.u16(0); w.u16(0); w.u16(0); w.u16(0);
    w.u32(0);
    w.u32(offsets[i]);
    w.bytes(e.name);
  });

  const dirSize = w.pos - dirStart;
  w.u32(0x06054b50);
  w.u16(0); w.u16(0);
  w.u16(entries.length); w.u16(entries.length);
  w.u32(dirSize);
  w.u32(dirStart);
  w.u16(0);

  return new Blob([w.buf], { type: "application/zip" });
}
