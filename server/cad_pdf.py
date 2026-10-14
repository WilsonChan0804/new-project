"""A small PDF writer for the CAD sheets (cad_render.py), standard library
only: pages of vector paths in millimetres, Helvetica for Latin text, and
Chinese (any non-Latin) text drawn from a TrueType font installed on the
server - each glyph once, as a form the page reuses - with an invisible
copy of the text underneath so the Sheets search still finds it.

The font: LWK_CAD_FONT (a .ttf / .ttc with TrueType outlines), else the
first of the usual places (WenQuanYi Zen Hei: apt install fonts-wqy-zenhei;
on Windows Microsoft JhengHei / MingLiU). Without one, non-Latin text is
still written (searchable), but most viewers show it as empty boxes.
"""

import os
import struct
import zlib

PT = 72.0 / 25.4      # points in a millimetre

# Helvetica widths (1/1000 em), characters 32-126
_HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
         556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
         1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
         667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
         333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
         556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]

FONT_PLACES = [
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/truetype/arphic/uming.ttc",
    "/usr/share/fonts/truetype/arphic/ukai.ttc",
    "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
    "C:\\Windows\\Fonts\\msjh.ttc",
    "C:\\Windows\\Fonts\\mingliu.ttc",
    "C:\\Windows\\Fonts\\msyh.ttc",
    "C:\\Windows\\Fonts\\simsun.ttc",
]


def latin(s):
    """Whether Helvetica (WinAnsi) can write all of it."""
    for ch in s:
        o = ord(ch)
        if o < 32 or o > 255 or 127 <= o < 160:
            return False
    return True


def helv_width(s):
    """Width in em."""
    w = 0
    for ch in s:
        o = ord(ch)
        w += _HELV[o - 32] if 32 <= o <= 126 else 556
    return w / 1000.0


def _pdf_str(s):
    b = s.encode("latin-1", "replace")
    return b"(" + b.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)").replace(b"\r", b"").replace(b"\n", b" ") + b")"


def num(v):
    """A number, short (0.01 is fine for mm on paper)."""
    if abs(v) < 0.0005:
        return "0"
    s = "%.3f" % v
    s = s.rstrip("0").rstrip(".")
    return s if s not in ("-0", "") else "0"


class TTFont(object):
    """Outlines and advances of a TrueType font (.ttf, or the first font
    of a .ttc). Only what drawing needs: cmap, glyf / loca, hmtx."""

    def __init__(self, path, index=0):
        with open(path, "rb") as f:
            self.data = data = f.read()
        off = 0
        if data[:4] == b"ttcf":
            n = struct.unpack(">I", data[8:12])[0]
            off = struct.unpack(">I", data[12 + 4 * min(index, n - 1):16 + 4 * min(index, n - 1)])[0]
        ntab = struct.unpack(">H", data[off + 4:off + 6])[0]
        self.tables = {}
        for k in range(ntab):
            rec = data[off + 12 + 16 * k: off + 28 + 16 * k]
            tag, _, o, ln = struct.unpack(">4sIII", rec)
            self.tables[tag.decode("latin-1")] = (o, ln)
        if "glyf" not in self.tables:
            raise ValueError("no TrueType outlines (glyf) in %s" % path)
        ho = self.tables["head"][0]
        self.upm = struct.unpack(">H", data[ho + 18:ho + 20])[0]
        self.loca_long = struct.unpack(">h", data[ho + 50:ho + 52])[0] == 1
        hh = self.tables["hhea"][0]
        self.nhm = struct.unpack(">H", data[hh + 34:hh + 36])[0]
        mo = self.tables["maxp"][0]
        self.nglyphs = struct.unpack(">H", data[mo + 4:mo + 6])[0]
        self.cmap = self._cmap()
        self._paths = {}
        self.path = path

    def _cmap(self):
        d = self.data
        co = self.tables["cmap"][0]
        n = struct.unpack(">H", d[co + 2:co + 4])[0]
        best = None
        for k in range(n):
            pid, eid, so = struct.unpack(">HHI", d[co + 4 + 8 * k: co + 12 + 8 * k])
            fmt = struct.unpack(">H", d[co + so: co + so + 2])[0]
            if fmt == 12 and pid in (0, 3):
                best = (12, co + so)
                break
            if fmt == 4 and pid in (0, 3) and best is None:
                best = (4, co + so)
        out = {}
        if not best:
            return out
        fmt, o = best
        if fmt == 4:
            segx2 = struct.unpack(">H", d[o + 6:o + 8])[0]
            seg = segx2 // 2
            ends = struct.unpack(">%dH" % seg, d[o + 14: o + 14 + segx2])
            starts = struct.unpack(">%dH" % seg, d[o + 16 + segx2: o + 16 + 2 * segx2])
            deltas = struct.unpack(">%dh" % seg, d[o + 16 + 2 * segx2: o + 16 + 3 * segx2])
            ro = o + 16 + 3 * segx2
            ranges = struct.unpack(">%dH" % seg, d[ro: ro + segx2])
            self._fmt4 = (starts, ends, deltas, ranges, ro)
            return None
        ngroups = struct.unpack(">I", d[o + 12:o + 16])[0]
        groups = []
        for k in range(ngroups):
            s, e, g = struct.unpack(">III", d[o + 16 + 12 * k: o + 28 + 12 * k])
            groups.append((s, e, g))
        self._fmt12 = groups
        return None

    def gid(self, cp):
        d = self.data
        if getattr(self, "_fmt12", None) is not None:
            for s, e, g in self._fmt12:
                if s <= cp <= e:
                    return g + cp - s
            return 0
        f4 = getattr(self, "_fmt4", None)
        if not f4 or cp > 0xFFFF:
            return 0
        starts, ends, deltas, ranges, ro = f4
        lo, hi = 0, len(ends) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if ends[mid] < cp:
                lo = mid + 1
            else:
                hi = mid
        i = lo
        if starts[i] > cp:
            return 0
        if ranges[i] == 0:
            return (cp + deltas[i]) & 0xFFFF
        a = ro + 2 * i + ranges[i] + 2 * (cp - starts[i])
        g = struct.unpack(">H", d[a:a + 2])[0]
        return (g + deltas[i]) & 0xFFFF if g else 0

    def advance(self, g):
        o = self.tables["hmtx"][0]
        k = min(g, self.nhm - 1)
        return struct.unpack(">H", self.data[o + 4 * k: o + 4 * k + 2])[0]

    def _glyf_range(self, g):
        d = self.data
        lo = self.tables["loca"][0]
        if self.loca_long:
            a, b = struct.unpack(">II", d[lo + 4 * g: lo + 4 * g + 8])
        else:
            a, b = struct.unpack(">HH", d[lo + 2 * g: lo + 2 * g + 4])
            a, b = a * 2, b * 2
        return self.tables["glyf"][0] + a, b - a

    def contours(self, g, depth=0):
        """The glyph's contours: lists of (x, y, on_curve)."""
        if g >= self.nglyphs or depth > 6:
            return []
        o, ln = self._glyf_range(g)
        if ln <= 0:
            return []
        d = self.data
        nc = struct.unpack(">h", d[o:o + 2])[0]
        if nc >= 0:
            ends = struct.unpack(">%dH" % nc, d[o + 10:o + 10 + 2 * nc])
            npts = (ends[-1] + 1) if nc else 0
            il = struct.unpack(">H", d[o + 10 + 2 * nc:o + 12 + 2 * nc])[0]
            p = o + 12 + 2 * nc + il
            flags = []
            while len(flags) < npts:
                fl = d[p]; p += 1
                flags.append(fl)
                if fl & 8:
                    r = d[p]; p += 1
                    flags.extend([fl] * r)
            flags = flags[:npts]
            xs, x = [], 0
            for fl in flags:
                if fl & 2:
                    dx = d[p]; p += 1
                    x += dx if fl & 16 else -dx
                elif not fl & 16:
                    x += struct.unpack(">h", d[p:p + 2])[0]; p += 2
                xs.append(x)
            ys, y = [], 0
            for fl in flags:
                if fl & 4:
                    dy = d[p]; p += 1
                    y += dy if fl & 32 else -dy
                elif not fl & 32:
                    y += struct.unpack(">h", d[p:p + 2])[0]; p += 2
                ys.append(y)
            out, s = [], 0
            for e in ends:
                out.append([(xs[k], ys[k], bool(flags[k] & 1)) for k in range(s, e + 1)])
                s = e + 1
            return out
        # composite
        out = []
        p = o + 10
        while True:
            fl, gi = struct.unpack(">HH", d[p:p + 4]); p += 4
            if fl & 1:
                a1, a2 = struct.unpack(">hh", d[p:p + 4]); p += 4
            else:
                a1, a2 = struct.unpack(">bb", d[p:p + 2]); p += 2
            a, b, c, dd = 1.0, 0.0, 0.0, 1.0
            if fl & 8:
                a = dd = struct.unpack(">h", d[p:p + 2])[0] / 16384.0; p += 2
            elif fl & 0x40:
                a, dd = [v / 16384.0 for v in struct.unpack(">hh", d[p:p + 4])]; p += 4
            elif fl & 0x80:
                a, b, c, dd = [v / 16384.0 for v in struct.unpack(">hhhh", d[p:p + 8])]; p += 8
            dx, dy = (a1, a2) if fl & 2 else (0, 0)
            for cont in self.contours(gi, depth + 1):
                out.append([(a * x + c * y + dx, b * x + dd * y + dy, on) for x, y, on in cont])
            if not fl & 0x20:
                break
        return out

    def path_ops(self, g):
        """The glyph as PDF path operators (font units), cubic curves."""
        if g in self._paths:
            return self._paths[g]
        ops = []
        for cont in self.contours(g):
            if len(cont) < 2:
                continue
            pts = list(cont)
            # start on an on-curve point (or the middle of two off-curve ones)
            k = next((i for i, q in enumerate(pts) if q[2]), None)
            if k is None:
                a, b = pts[0], pts[1]
                pts.insert(0, ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0, True))
                k = 0
            pts = pts[k:] + pts[:k]
            start = pts[0]
            ops.append("%s %s m" % (num(start[0]), num(start[1])))
            cur = start
            i = 1
            seq = pts[1:] + [start]
            while i <= len(seq):
                q = seq[i - 1]
                if q[2]:
                    ops.append("%s %s l" % (num(q[0]), num(q[1])))
                    cur = q
                    i += 1
                    continue
                nxt = seq[i] if i < len(seq) else start
                end = nxt if nxt[2] else ((q[0] + nxt[0]) / 2.0, (q[1] + nxt[1]) / 2.0, True)
                c1 = (cur[0] + 2.0 / 3 * (q[0] - cur[0]), cur[1] + 2.0 / 3 * (q[1] - cur[1]))
                c2 = (end[0] + 2.0 / 3 * (q[0] - end[0]), end[1] + 2.0 / 3 * (q[1] - end[1]))
                ops.append("%s %s %s %s %s %s c" % (num(c1[0]), num(c1[1]), num(c2[0]), num(c2[1]), num(end[0]), num(end[1])))
                cur = end
                i += 2 if nxt[2] else 1
            ops.append("h")
        s = " ".join(ops)
        self._paths[g] = s
        return s


_FONT = []


def cjk_font():
    """The outline font for non-Latin text (cached), or None."""
    if _FONT:
        return _FONT[0]
    cand = [os.environ.get("LWK_CAD_FONT", "")] + FONT_PLACES
    font = None
    for p in cand:
        if p and os.path.isfile(p):
            try:
                font = TTFont(p)
                break
            except Exception:
                continue
    _FONT.append(font)
    return font


class Pdf(object):
    """Pages of drawing operators (in mm, origin bottom left)."""

    def __init__(self):
        self.pages = []           # (w_mm, h_mm, content str)
        self.glyphs = {}          # gid -> name

    def glyph_name(self, g):
        n = self.glyphs.get(g)
        if not n:
            n = "G%d" % g
            self.glyphs[g] = n
        return n

    def add_page(self, w_mm, h_mm, content):
        self.pages.append((w_mm, h_mm, content))

    def bytes(self):
        objs = []

        def add(b):
            objs.append(b)
            return len(objs)

        def stream(dic, data):
            z = zlib.compress(data, 6)
            return add(b"<< " + dic + b" /Filter /FlateDecode /Length %d >>\nstream\n" % len(z) + z + b"\nendstream")

        catalog = add(b"")
        pages_id = add(b"")
        f1 = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
        tu = (b"/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def "
              b"/CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange "
              b"1 beginbfrange <0000> <FFFF> <0000> endbfrange endcmap CMapName currentdict /CMap defineresource pop end end")
        tu_id = stream(b"", tu)
        fd = add(b"<< /Type /FontDescriptor /FontName /LWKText /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>")
        cid = add(b"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /LWKText /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor %d 0 R /DW 1000 /CIDToGIDMap /Identity >>" % fd)
        f2 = add(b"<< /Type /Font /Subtype /Type0 /BaseFont /LWKText /Encoding /Identity-H /DescendantFonts [%d 0 R] /ToUnicode %d 0 R >>" % (cid, tu_id))
        font = cjk_font()
        xo = []
        for g, name in sorted(self.glyphs.items()):
            ops = font.path_ops(g).encode("ascii") if font else b""
            u = font.upm if font else 1000
            gid = stream(b"/Type /XObject /Subtype /Form /BBox [%d %d %d %d]" % (-u, -u, 2 * u, 2 * u), ops + b" f")
            xo.append(b"/%s %d 0 R" % (name.encode("ascii"), gid))
        res = add(b"<< /Font << /F1 %d 0 R /F2 %d 0 R >> /XObject << %s >> /ExtGState << /GS0 << /LC 1 /LJ 1 >> >> >>" % (f1, f2, b" ".join(xo)))
        kids = []
        for w, h, content in self.pages:
            body = ("q %s 0 0 %s 0 0 cm /GS0 gs 1 J 1 j\n" % (num(PT), num(PT)) + content + "\nQ").encode("latin-1", "replace")
            c = stream(b"", body)
            kids.append(add(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %s %s] /Resources %d 0 R /Contents %d 0 R >>"
                            % (pages_id, num(w * PT).encode(), num(h * PT).encode(), res, c)))
        objs[catalog - 1] = b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id
        objs[pages_id - 1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % k for k in kids), len(kids))
        out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
        offs = []
        for i, o in enumerate(objs, 1):
            offs.append(len(out))
            out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
        x = len(out)
        out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
        out += b"".join(b"%010d 00000 n \n" % o for o in offs)
        out += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, catalog, x)
        return bytes(out)


def text_ops(pdf, s, m, color_op):
    """Text at the matrix m (text space: 1 unit = the text height, the
    baseline at y = 0) -> operators. Helvetica when it can; otherwise the
    outline font's glyphs, with the text again, invisible, for search."""
    a, b, c, d, e, f = m
    k = 1.0 / 0.72                      # the em for a cap height of 1
    if latin(s):
        return "BT 0 Tr %s /F1 1 Tf %s %s %s %s %s %s Tm %s Tj ET" % (
            color_op, num(a * k), num(b * k), num(c * k), num(d * k), num(e), num(f), _pdf_str(s).decode("latin-1"))
    font = cjk_font()
    out = []
    hexs = "".join("%04X" % (ord(ch) if ord(ch) <= 0xFFFF else 0xFFFD) for ch in s)
    if font is None:
        return "BT %s /F2 1 Tf %s %s %s %s %s %s Tm <%s> Tj ET" % (color_op, num(a * k), num(b * k), num(c * k), num(d * k), num(e), num(f), hexs)
    out.append("q BT 3 Tr /F2 1 Tf %s %s %s %s %s %s Tm <%s> Tj ET Q" % (num(a * k), num(b * k), num(c * k), num(d * k), num(e), num(f), hexs))
    out.append("q " + color_op)
    sc = k / font.upm
    x = 0.0
    for ch in s:
        o = ord(ch)
        if 32 <= o <= 126 and font.gid(o) == 0:
            x += _HELV[o - 32] / 1000.0 * k
            continue
        g = font.gid(o)
        if g and not ch.isspace():
            n = pdf.glyph_name(g)
            # m * translate(x) * scale(sc)
            out.append("q %s %s %s %s %s %s cm /%s Do Q" % (num(a * sc), num(b * sc), num(c * sc), num(d * sc),
                                                         num(e + a * x), num(f + b * x), n))
        x += (font.advance(g) if g else font.upm * 0.6) * sc
    out.append("Q")
    return " ".join(out)


def text_width(s):
    """Width in text heights (cap height 1)."""
    k = 1.0 / 0.72
    if latin(s):
        return helv_width(s) * k
    font = cjk_font()
    if font is None:
        return len(s) * 0.9 * k
    w = 0
    for ch in s:
        o = ord(ch)
        g = font.gid(o)
        if 32 <= o <= 126 and g == 0:
            w += _HELV[o - 32] / 1000.0
        else:
            w += (font.advance(g) if g else font.upm * 0.6) / float(font.upm)
    return w * k
