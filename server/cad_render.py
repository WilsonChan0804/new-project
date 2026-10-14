"""CAD layouts to PDF sheets (server/cad.py runs it after the ODA File
Converter has made DXF of the DWG).

Each layout (paper space) becomes a page of its paper size: its own lines
and text, and in each viewport the model at the viewport's scale, clipped
to it, with the layers frozen in that viewport left out. Blocks, xrefs
(drawn from their own DXF), dimensions (their blocks), hatches, text and
MTEXT are drawn; line weights, line types and colours (or black, the
usual plot) as the drawing gives them.

What it leaves out or simplifies, as the page says: 3D views, solids and
regions, images, OLE objects and proxy entities are not drawn; fonts are
Helvetica (Latin) and the server's Chinese font, not the drawing's SHX /
TTF fonts; complex line types are plain dashes; MTEXT keeps its words,
not its inline formatting.
"""

import math
import os

import cad_dxf as D
import cad_pdf as P

DEFAULT_LW = 0.18            # mm, for "default" line weight
MIN_LW = 0.05
MAX_HATCH_LINES = 4000
MAX_DEPTH = 12


# ------------------------------------------------------------- matrices
# (a, b, c, d, e, f): x' = a x + c y + e, y' = b x + d y + f

I = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def mul(m, n):
    """m after n (apply n first)."""
    a, b, c, d, e, f = m
    A, B, C, Dd, E, F = n
    return (a * A + c * B, b * A + d * B, a * C + c * Dd, b * C + d * Dd, a * E + c * F + e, b * E + d * F + f)


def tr(x, y):
    return (1.0, 0.0, 0.0, 1.0, x, y)


def rot(r):
    c, s = math.cos(r), math.sin(r)
    return (c, s, -s, c, 0.0, 0.0)


def sc(x, y=None):
    return (x, 0.0, 0.0, x if y is None else y, 0.0, 0.0)


def ap(m, p):
    return (m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5])


def inv(m):
    a, b, c, d, e, f = m
    det = a * d - b * c
    if abs(det) < 1e-18:
        return I
    ia, ib, ic, id_ = d / det, -b / det, -c / det, a / det
    return (ia, ib, ic, id_, -(ia * e + ic * f), -(ib * e + id_ * f))


def mscale(m):
    return math.sqrt(abs(m[0] * m[3] - m[1] * m[2])) or 1.0


def ocs(e):
    """An entity in a mirrored plane (extrusion 0,0,-1): x flips."""
    try:
        return sc(-1.0, 1.0) if float(e.get(230, "1")) < 0 else I
    except ValueError:
        return I


# ------------------------------------------------------------- colours

def _aci():
    t = [(0, 0, 0)] * 256
    base = {1: (255, 0, 0), 2: (255, 255, 0), 3: (0, 255, 0), 4: (0, 255, 255), 5: (0, 0, 255),
            6: (255, 0, 255), 7: (0, 0, 0), 8: (128, 128, 128), 9: (192, 192, 192)}
    for k, v in base.items():
        t[k] = v
    for i in range(10, 250):
        h = ((i // 10) - 1) * 15.0
        v = [255, 204, 153, 127, 76][(i % 10) // 2]
        lo = v / 2.0 if i % 2 else 0.0
        hh = h / 60.0
        x = 1 - abs(hh % 2 - 1)
        r, g, b = [(1, x, 0), (x, 1, 0), (0, 1, x), (0, x, 1), (x, 0, 1), (1, 0, x)][int(hh) % 6]
        t[i] = tuple(int(round(lo + (v - lo) * c)) for c in (r, g, b))
    for k, v in zip(range(250, 256), (51, 91, 132, 173, 214, 255)):
        t[k] = (v, v, v)
    return t


ACI = _aci()
GREYS = {8, 9, 250, 251, 252, 253, 254}


def rgb_of(aci, true):
    if true is not None:
        return ((true >> 16) & 255, (true >> 8) & 255, true & 255)
    return ACI[aci] if 0 < aci < 256 else (0, 0, 0)


# ------------------------------------------------------------- the display list

class Prim(object):
    """One thing to draw. kind: 'S' strokes (polylines), 'F' fill, 'T' text,
    'H' hatch lines clipped to a boundary, 'W' wipeout."""
    __slots__ = ("kind", "layer", "rgb", "aci", "lw", "lw_units", "dash", "paths", "text", "m", "box", "clip", "evenodd")

    def __init__(self, kind, layer, rgb, aci, paths=None):
        self.kind = kind
        self.layer = layer
        self.rgb = rgb
        self.aci = aci
        self.lw = DEFAULT_LW
        self.lw_units = 0.0
        self.dash = None
        self.paths = paths or []
        self.text = None
        self.m = None
        self.box = None
        self.clip = None
        self.evenodd = True

    def bbox(self):
        if self.box is None:
            xs, ys = [], []
            for pl in (self.paths or []) + (self.clip or []):
                for x, y in pl:
                    xs.append(x); ys.append(y)
            self.box = (min(xs), min(ys), max(xs), max(ys)) if xs else (0, 0, 0, 0)
        return self.box


class Style(object):
    """What a block's contents inherit (ByBlock) from the INSERT."""
    __slots__ = ("layer", "aci", "true", "lw", "ltype")

    def __init__(self, layer="0", aci=7, true=None, lw=-3, ltype="CONTINUOUS"):
        self.layer, self.aci, self.true, self.lw, self.ltype = layer, aci, true, lw, ltype


class Builder(object):
    """Turns one drawing's entities into Prims (in the space they are in,
    model or paper). xref(path) gives the Doc of an external reference."""

    def __init__(self, doc, xref=None, notes=None):
        self.doc = doc
        self.xref = xref or (lambda p: None)
        self.notes = notes if notes is not None else {}
        self.ltscale = doc.hf("$LTSCALE", 1.0) or 1.0
        self.out = []

    def note(self, what):
        self.notes[what] = self.notes.get(what, 0) + 1

    # -- layers, colours, weights, line types
    def layer(self, doc, name):
        return doc.layers.get((name or "0").upper())

    def visible_layer(self, doc, name, prefix):
        if (name or "").upper() == "DEFPOINTS":
            return False
        L = None
        if prefix:
            L = self.doc.layers.get((prefix + "|" + name).upper())
        if L is None:
            L = self.layer(doc, name)
        if L is None:
            return True
        if L.i(70) & 1 or L.i(62, 7) < 0 or L.get(290) == "0":
            return False
        return True

    def resolve(self, e, doc, st, prefix):
        """(layer name shown, aci, true colour, lw (1/100 mm), line type)"""
        lname = e.get(8) or "0"
        if lname == "0" and st is not None and st.layer:
            lname_eff = st.layer
            ldoc, lprefix = self.doc, ""
        else:
            lname_eff = (prefix + "|" + lname) if prefix else lname
            ldoc, lprefix = doc, prefix
        L = self.doc.layers.get(lname_eff.upper())
        if L is None and lprefix:
            L = self.layer(ldoc, lname)
        aci = e.i(62, 256)
        true = e.get(420)
        true = int(true) if true not in (None, "") else None
        if aci == 256 and true is None:
            if L is not None:
                aci = abs(L.i(62, 7)) or 7
                t2 = L.get(420)
                true = int(t2) if t2 not in (None, "") else None
            else:
                aci = 7
        elif aci == 0:
            aci, true = (st.aci, st.true) if st else (7, None)
        lw = e.i(370, -1)
        if lw == -1:
            lw = L.i(370, -3) if L is not None else -3
        elif lw == -2:
            lw = st.lw if st else -3
        lt = (e.get(6) or "BYLAYER").upper()
        if lt == "BYLAYER":
            lt = (L.get(6) or "CONTINUOUS").upper() if L is not None else "CONTINUOUS"
        elif lt == "BYBLOCK":
            lt = st.ltype if st else "CONTINUOUS"
        return lname_eff, aci, true, lw, lt

    def dash_of(self, doc, lt, e):
        if lt in ("CONTINUOUS", "", None):
            return None
        L = doc.ltypes.get(lt) or self.doc.ltypes.get(lt)
        if L is None:
            return None
        els = []
        for v in L.all(49):
            try:
                els.append(float(v))
            except ValueError:
                pass
        if not els or all(x >= 0 for x in els):
            return None
        k = self.ltscale * (e.f(48, 1.0) or 1.0)
        return [x * k for x in els]

    # -- making prims
    def stroke(self, e, doc, st, prefix, m, paths, closed=False, width_units=0.0):
        lname, aci, true, lw, lt = self.resolve(e, doc, st, prefix)
        out = []
        for pl in paths:
            if len(pl) < 2:
                continue
            q = [ap(m, p) for p in pl]
            if closed and q[0] != q[-1]:
                q.append(q[0])
            out.append(q)
        if not out:
            return
        p = Prim("S", lname, rgb_of(aci, true), aci, out)
        p.lw = DEFAULT_LW if lw < 0 else max(MIN_LW, lw / 100.0)
        if width_units > 0:
            p.lw_units = width_units * mscale(m)
        d = self.dash_of(doc, lt, e)
        if d:
            p.dash = [x * mscale(m) for x in d]
        self.out.append(p)

    def fill(self, e, doc, st, prefix, m, paths, kind="F"):
        lname, aci, true, lw, lt = self.resolve(e, doc, st, prefix)
        q = [[ap(m, p) for p in pl] for pl in paths if len(pl) >= 3]
        if not q:
            return
        self.out.append(Prim(kind, lname, rgb_of(aci, true), aci, q))

    def text(self, e, doc, st, prefix, m, s, tm):
        if not s or not s.strip():
            return
        lname, aci, true, lw, lt = self.resolve(e, doc, st, prefix)
        p = Prim("T", lname, rgb_of(aci, true), aci)
        p.text = s
        p.m = mul(m, tm)
        w = P.text_width(s)
        corners = [ap(p.m, c) for c in ((0, -0.3), (w, -0.3), (w, 1.1), (0, 1.1))]
        p.box = (min(c[0] for c in corners), min(c[1] for c in corners), max(c[0] for c in corners), max(c[1] for c in corners))
        self.out.append(p)

    # -- entities
    def draw(self, ents, doc, m=I, st=None, prefix="", depth=0):
        for e in ents:
            try:
                self.entity(e, doc, m, st, prefix, depth)
            except Exception:
                self.note("could not draw a " + e.type)

    def entity(self, e, doc, m, st, prefix, depth):
        t = e.type
        if e.get(60) == "1":
            return
        lname = e.get(8) or "0"
        if lname == "0" and st is not None:
            if not self.visible_layer(self.doc, st.layer, ""):
                return
        elif not self.visible_layer(doc, lname, prefix):
            return
        h = getattr(self, "e_" + t.replace("_", ""), None)
        if h is None:
            if t not in ("POINT", "ATTDEF", "VIEWPORT", "XLINE", "RAY", "SEQEND", "LIGHT", "SUN"):
                self.note(t)
            return
        h(e, doc, m, st, prefix, depth)

    def e_LINE(self, e, doc, m, st, prefix, depth):
        self.stroke(e, doc, st, prefix, m, [[e.pt(10), e.pt(11)]])

    def e_CIRCLE(self, e, doc, m, st, prefix, depth):
        c, r = e.pt(10), e.f(40)
        self.stroke(e, doc, st, prefix, mul(m, ocs(e)), [arc(c, r, 0, 2 * math.pi)])

    def e_ARC(self, e, doc, m, st, prefix, depth):
        c, r = e.pt(10), e.f(40)
        a0, a1 = math.radians(e.f(50)), math.radians(e.f(51))
        if a1 <= a0:
            a1 += 2 * math.pi
        self.stroke(e, doc, st, prefix, mul(m, ocs(e)), [arc(c, r, a0, a1)])

    def e_ELLIPSE(self, e, doc, m, st, prefix, depth):
        c, mj = e.pt(10), e.pt(11)
        ratio = e.f(40, 1.0)
        t0, t1 = e.f(41, 0.0), e.f(42, 2 * math.pi)
        nz = -1.0 if e.f(230, 1.0) < 0 else 1.0
        mn = (-nz * mj[1] * ratio, nz * mj[0] * ratio)
        if t1 <= t0:
            t1 += 2 * math.pi
        n = max(8, int((t1 - t0) / (math.pi / 36)) + 1)
        pts = []
        for k in range(n + 1):
            t = t0 + (t1 - t0) * k / n
            pts.append((c[0] + mj[0] * math.cos(t) + mn[0] * math.sin(t), c[1] + mj[1] * math.cos(t) + mn[1] * math.sin(t)))
        self.stroke(e, doc, st, prefix, m, [pts])

    def e_LWPOLYLINE(self, e, doc, m, st, prefix, depth):
        verts = []
        cur = None
        for c, v in e.tags:
            if c == 10:
                cur = [float(v), 0.0, 0.0]
                verts.append(cur)
            elif c == 20 and cur is not None:
                cur[1] = float(v)
            elif c == 42 and cur is not None:
                cur[2] = float(v)
        closed = bool(e.i(70) & 1)
        pts = bulge_path(verts, closed)
        self.stroke(e, doc, st, prefix, mul(m, ocs(e)), [pts], width_units=e.f(43, 0.0))

    def e_POLYLINE(self, e, doc, m, st, prefix, depth):
        fl = e.i(70)
        if fl & 16 or fl & 64:
            self.note("POLYFACE / MESH")
            return
        verts = [[v.f(10), v.f(20), v.f(42)] for v in e.kids if v.type == "VERTEX" and not v.i(70) & 16]
        pts = bulge_path(verts, bool(fl & 1))
        mm = m if fl & 8 else mul(m, ocs(e))
        self.stroke(e, doc, st, prefix, mm, [pts], width_units=e.f(40, 0.0))

    def e_SPLINE(self, e, doc, m, st, prefix, depth):
        pts = spline_points(e)
        if pts:
            self.stroke(e, doc, st, prefix, m, [pts])

    def e_SOLID(self, e, doc, m, st, prefix, depth):
        q = [e.pt(10), e.pt(11), e.pt(13, e.pt(12)), e.pt(12)]
        self.fill(e, doc, st, prefix, mul(m, ocs(e)), [q])

    e_TRACE = e_SOLID

    def e_3DFACE(self, e, doc, m, st, prefix, depth):
        q = [e.pt(10), e.pt(11), e.pt(12), e.pt(13, e.pt(12))]
        self.stroke(e, doc, st, prefix, m, [q], closed=True)

    def e_WIPEOUT(self, e, doc, m, st, prefix, depth):
        ins, u, v = e.pt(10), e.pt(11), e.pt(12)
        cl = []
        xs = e.all(14)
        ys = e.all(24)
        for x, y in zip(xs, ys):
            x, y = float(x), float(y)
            cl.append((ins[0] + u[0] * (x + 0.5) + v[0] * (0.5 - y), ins[1] + u[1] * (x + 0.5) + v[1] * (0.5 - y)))
        if len(cl) == 2:      # a rectangle given by two corners
            a, b = cl
            cl = [a, (b[0], a[1]), b, (a[0], b[1])]
        if len(cl) >= 3:
            self.fill(e, doc, st, prefix, m, [cl], kind="W")

    def text_style(self, doc, e):
        S = doc.styles.get((e.get(7) or "STANDARD").upper())
        return S

    def e_TEXT(self, e, doc, m, st, prefix, depth):
        s = D.plain_text(e.get(1) or "")
        h = e.f(40) or 2.5
        S = self.text_style(doc, e)
        wf = e.f(41, 0.0) or (S.f(41, 1.0) if S is not None else 1.0) or 1.0
        rotr = math.radians(e.f(50))
        obl = math.radians(e.f(51, 0.0))
        h72, v73 = e.i(72), e.i(73)
        p10 = e.pt(10)
        w = P.text_width(s) * wf
        gen = e.i(71)
        if h72 in (3, 5) and e.get(11) is not None:
            # aligned (3): the height changes to fit; fit (5): the width does
            p11 = e.pt(11)
            L = math.hypot(p11[0] - p10[0], p11[1] - p10[1])
            wn = P.text_width(s)
            if L > 1e-9 and wn > 0:
                rotr = math.atan2(p11[1] - p10[1], p11[0] - p10[0])
                if h72 == 3:
                    h = L / (wn * wf)
                else:
                    wf = L / (wn * h)
                w = wn * wf
            ref, dx, dy = p10, 0.0, 0.0
        else:
            ref = e.pt(11) if (h72 or v73) and e.get(11) is not None else p10
            dx = {0: 0.0, 1: -w / 2, 2: -w, 4: -w / 2}.get(h72, 0.0)
            dy = {0: 0.0, 1: 0.25, 2: -0.5, 3: -1.0}.get(v73, 0.0)
            if h72 == 4:
                dy = -0.5
        tm = mul(tr(ref[0], ref[1]), mul(rot(rotr), mul((1, 0, math.tan(obl), 1, 0, 0), mul(sc(h * wf, h), tr(dx / wf if wf else dx, dy)))))
        if gen & 2:
            tm = mul(tm, mul(tr(w / wf if wf else w, 0), sc(-1, 1)))
        if gen & 4:
            tm = mul(tm, mul(tr(0, 1), sc(1, -1)))
        self.text(e, doc, st, prefix, mul(m, ocs(e)), s, tm)

    def e_ATTRIB(self, e, doc, m, st, prefix, depth):
        if e.i(70) & 1:
            return
        self.e_TEXT(e, doc, m, st, prefix, depth)

    def e_MTEXT(self, e, doc, m, st, prefix, depth):
        raw = "".join(e.all(3)) + (e.get(1) or "")
        lines = D.mtext_lines(raw)
        h = e.f(40) or 2.5
        width = e.f(41, 0.0)
        att = e.i(71, 1) or 1
        if e.get(11) is not None:
            d = e.pt(11)
            rotr = math.atan2(d[1], d[0])
        else:
            rotr = e.f(50, 0.0)
            if abs(rotr) > 2 * math.pi + 0.01:
                rotr = math.radians(rotr)
        ins = e.pt(10)
        spacing = 5.0 / 3 * (e.f(44, 1.0) or 1.0)
        # word wrap at the box width
        if width > 0:
            wrapped = []
            for ln in lines:
                wrapped += wrap(ln, width / h)
            lines = wrapped
        n = len(lines)
        row, col = (att - 1) // 3, (att - 1) % 3
        total = 1.0 + (n - 1) * spacing
        y0 = {0: -1.0, 1: total / 2 - 1.0, 2: (n - 1) * spacing}[row]
        base = mul(tr(ins[0], ins[1]), mul(rot(rotr), sc(h, h)))
        for k, ln in enumerate(lines):
            if not ln.strip():
                continue
            w = P.text_width(ln)
            dx = {0: 0.0, 1: -w / 2, 2: -w}[col]
            self.text(e, doc, st, prefix, m, ln, mul(base, tr(dx, y0 - k * spacing)))

    def insert_matrix(self, e, block, off=(0.0, 0.0)):
        ins = e.pt(10)
        ins = (ins[0] + off[0], ins[1] + off[1])
        sx, sy = e.f(41, 1.0) or 1.0, e.f(42, 1.0) or 1.0
        r = math.radians(e.f(50))
        base = block.base if block is not None else (0.0, 0.0)
        return mul(ocs(e), mul(tr(ins[0], ins[1]), mul(rot(r), mul(sc(sx, sy), tr(-base[0], -base[1])))))

    def e_INSERT(self, e, doc, m, st, prefix, depth):
        name = e.get(2) or ""
        if depth > MAX_DEPTH:
            return
        lname, aci, true, lw, lt = self.resolve(e, doc, st, prefix)
        child = Style(lname, aci, true, lw, lt)
        block = doc.blocks.get(name.upper())
        if block is None:
            self.note("missing block " + name)
        else:
            cols, rows = max(1, e.i(70, 1)), max(1, e.i(71, 1))
            dc, dr = e.f(44), e.f(45)
            r = math.radians(e.f(50))
            for i in range(cols):
                for j in range(rows):
                    # m * ocs * move(insert point + the array step, turned) * turn * scale * move(-base)
                    off = ap(rot(r), (i * dc, j * dr))
                    mm = mul(m, self.insert_matrix(e, block, off))
                    if block.is_xref:
                        self.draw_xref(block, mm, child, prefix, depth)
                    else:
                        self.draw(block.ents, doc, mm, child, prefix, depth + 1)
        for a in e.kids:
            if a.type == "ATTRIB":
                try:
                    self.e_ATTRIB(a, doc, m, st, prefix, depth)
                except Exception:
                    self.note("could not draw an ATTRIB")

    def draw_xref(self, block, m, child, prefix, depth):
        x = self.xref(block.xref or block.name)
        if x is None:
            self.notes.setdefault("_missing_xrefs", set()).add(os.path.basename((block.xref or block.name).replace("\\", "/")))
            return
        pre = block.name if not prefix else prefix + "|" + block.name
        self.draw(x.model_ents(), x, m, None, pre, depth + 1)

    def e_ACADTABLE(self, e, doc, m, st, prefix, depth):
        self.e_INSERT(e, doc, m, st, prefix, depth)

    def e_DIMENSION(self, e, doc, m, st, prefix, depth):
        name = e.get(2) or ""
        block = doc.blocks.get(name.upper())
        if block is None:
            self.note("DIMENSION without its block")
            return
        lname, aci, true, lw, lt = self.resolve(e, doc, st, prefix)
        off = e.pt(12, (0.0, 0.0))
        self.draw(block.ents, doc, mul(m, tr(off[0], off[1])), Style(lname, aci, true, lw, lt), prefix, depth + 1)

    e_ARCDIMENSION = e_DIMENSION
    e_LARGERADIALDIMENSION = e_DIMENSION

    def e_LEADER(self, e, doc, m, st, prefix, depth):
        xs, ys = e.all(10), e.all(20)
        pts = [(float(x), float(y)) for x, y in zip(xs, ys)]
        if len(pts) < 2:
            return
        self.stroke(e, doc, st, prefix, m, [pts])
        if e.i(71, 1):
            size = (self.doc.hf("$DIMASZ", 2.5) or 2.5) * (self.doc.hf("$DIMSCALE", 1.0) or 1.0)
            self.fill(e, doc, st, prefix, m, [arrowhead(pts[1], pts[0], size)])

    def e_MULTILEADER(self, e, doc, m, st, prefix, depth):
        """Its text (304, at 12, height 41), and each leader: the lines'
        vertices (LEADER_LINE{ 10 }) to the landing point (LEADER{ 10 }),
        the dogleg (11 x 40) and an arrowhead (140) at the first vertex."""
        text = at = None
        h = arrow = None
        leaders = []                     # [landing, dogleg vector, length, [lines]]
        where = ""
        for c, v in e.tags:
            if c == 302 and v.startswith("LEADER{"):
                leaders.append([None, None, 0.0, []]); where = "leader"; continue
            if c == 304 and v.startswith("LEADER_LINE{"):
                if leaders:
                    leaders[-1][3].append([])
                where = "line"; continue
            if c == 305:
                where = "leader"; continue
            if c == 303:
                where = ""; continue
            if c == 301:
                where = "end"; continue
            try:
                if where == "line":
                    if c == 10: leaders[-1][3][-1].append([float(v), 0.0])
                    elif c == 20 and leaders[-1][3][-1]: leaders[-1][3][-1][-1][1] = float(v)
                elif where == "leader":
                    L = leaders[-1]
                    if c == 10: L[0] = [float(v), 0.0]
                    elif c == 20 and L[0]: L[0][1] = float(v)
                    elif c == 11: L[1] = [float(v), 0.0]
                    elif c == 21 and L[1]: L[1][1] = float(v)
                    elif c == 40: L[2] = float(v)
                elif where == "":
                    if c == 304 and text is None: text = v
                    elif c == 12 and at is None: at = [float(v), 0.0]
                    elif c == 22 and at is not None and at[1] == 0.0: at[1] = float(v)
                    elif c == 41 and h is None: h = float(v)
                    elif c == 140 and arrow is None: arrow = float(v)
            except (ValueError, IndexError):
                continue
        for land, dog, dl, lines in leaders:
            for ln in lines:
                pts = [tuple(p) for p in ln] + ([tuple(land)] if land else [])
                if len(pts) >= 2:
                    self.stroke(e, doc, st, prefix, m, [pts])
                    if arrow:
                        self.fill(e, doc, st, prefix, m, [arrowhead(pts[1], pts[0], arrow)])
            if land and dog and dl:
                self.stroke(e, doc, st, prefix, m, [[tuple(land), (land[0] + dog[0] * dl, land[1] + dog[1] * dl)]])
        if text and at:
            hh = h or 2.5
            for k, ln in enumerate(D.mtext_lines(text)):
                if ln.strip():
                    self.text(e, doc, st, prefix, m, ln, mul(tr(at[0], at[1]), mul(sc(hh, hh), tr(0, -1 - k * 5.0 / 3))))

    def e_MLINE(self, e, doc, m, st, prefix, depth):
        # each vertex: 11 point, 12 direction, 13 miter, then per element
        # 74 n + 41 params (the first is its offset along the miter)
        verts = []
        cur = None
        for c, v in e.tags:
            if c == 11:
                cur = {"p": [float(v), 0.0], "miter": [0.0, 0.0], "els": []}
                verts.append(cur)
            elif c == 21 and cur:
                cur["p"][1] = float(v)
            elif c == 13 and cur:
                cur["miter"][0] = float(v)
            elif c == 23 and cur:
                cur["miter"][1] = float(v)
            elif c == 74 and cur:
                cur["els"].append([])
            elif c == 41 and cur and cur["els"]:
                cur["els"][-1].append(float(v))
        if not verts:
            return
        n_el = max(len(vv["els"]) for vv in verts)
        for k in range(n_el):
            pts = []
            for vv in verts:
                el = vv["els"][k] if k < len(vv["els"]) else []
                off = el[0] if el else 0.0
                pts.append((vv["p"][0] + vv["miter"][0] * off, vv["p"][1] + vv["miter"][1] * off))
            self.stroke(e, doc, st, prefix, m, [pts], closed=bool(e.i(71) & 2))

    def e_HATCH(self, e, doc, m, st, prefix, depth):
        loops, pattern, solid = hatch_data(e)
        if not loops:
            return
        mm = mul(m, ocs(e))
        lname, aci, true, lw, lt = self.resolve(e, doc, st, prefix)
        rgb = rgb_of(aci, true)
        if solid or e.get(450) == "1":
            q = [[ap(mm, p) for p in pl] for pl in loops if len(pl) >= 3]
            if q:
                self.out.append(Prim("F", lname, rgb, aci, q))
            return
        # pattern lines inside the boundary
        xs = [p[0] for pl in loops for p in pl]
        ys = [p[1] for pl in loops for p in pl]
        box = (min(xs), min(ys), max(xs), max(ys))
        segs = []
        for (ang, bx, by, ox, oy, dashes) in pattern:
            segs += pattern_lines(box, math.radians(ang), (bx, by), (ox, oy), dashes, MAX_HATCH_LINES - len(segs))
            if len(segs) >= MAX_HATCH_LINES:
                break
        if len(segs) >= MAX_HATCH_LINES or not segs:
            # too fine to draw line by line: a light tone instead
            q = [[ap(mm, p) for p in pl] for pl in loops if len(pl) >= 3]
            if q:
                pr = Prim("F", lname, tuple(int(255 - (255 - c) * 0.25) for c in rgb), aci, q)
                self.out.append(pr)
            return
        pr = Prim("H", lname, rgb, aci, [[ap(mm, a), ap(mm, b)] for a, b in segs])
        pr.clip = [[ap(mm, p) for p in pl] for pl in loops if len(pl) >= 3]
        pr.lw = max(MIN_LW, lw / 100.0) if lw >= 0 else 0.09
        self.out.append(pr)


# ------------------------------------------------------------- geometry

def arc(c, r, a0, a1):
    n = max(4, min(180, int(abs(a1 - a0) / (math.pi / 36)) + 1))
    return [(c[0] + r * math.cos(a0 + (a1 - a0) * k / n), c[1] + r * math.sin(a0 + (a1 - a0) * k / n)) for k in range(n + 1)]


def bulge_path(verts, closed):
    """Vertices [x, y, bulge] (bulge on the segment that starts there) -> points."""
    if not verts:
        return []
    pts = [(verts[0][0], verts[0][1])]
    n = len(verts)
    last = n if closed else n - 1
    for i in range(last):
        x0, y0, b = verts[i]
        x1, y1 = verts[(i + 1) % n][0], verts[(i + 1) % n][1]
        if abs(b) > 1e-9:
            pts += bulge_arc((x0, y0), (x1, y1), b)[1:]
        else:
            pts.append((x1, y1))
    return pts


def bulge_arc(p0, p1, b):
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    chord = math.hypot(dx, dy)
    if chord < 1e-12:
        return [p0, p1]
    theta = 4 * math.atan(b)
    r = chord / (2 * math.sin(theta / 2))
    mx, my = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
    h = r * math.cos(theta / 2)
    nx, ny = -dy / chord, dx / chord
    cx, cy = mx + nx * h, my + ny * h
    a0 = math.atan2(p0[1] - cy, p0[0] - cx)
    a1 = a0 + theta
    return arc((cx, cy), abs(r), a0, a1) if r > 0 else arc((cx, cy), abs(r), a0, a1)


def arrowhead(tip_from, tip, size):
    dx, dy = tip[0] - tip_from[0], tip[1] - tip_from[1]
    L = math.hypot(dx, dy) or 1.0
    ux, uy = dx / L, dy / L
    bx, by = tip[0] - ux * size, tip[1] - uy * size
    w = size / 6.0
    return [tip, (bx - uy * w, by + ux * w), (bx + uy * w, by - ux * w)]


def wrap(line, width_h):
    """Words (or CJK characters) on lines no wider than width_h heights."""
    if P.text_width(line) <= width_h * 1.02 or width_h <= 0:
        return [line]
    out, cur = [], ""
    tokens = []
    word = ""
    for ch in line:
        if ord(ch) > 0x2E80:
            if word:
                tokens.append(word); word = ""
            tokens.append(ch)
        elif ch == " ":
            word += ch
            tokens.append(word); word = ""
        else:
            word += ch
    if word:
        tokens.append(word)
    for tk in tokens:
        if cur and P.text_width(cur + tk.rstrip()) > width_h * 1.02:
            out.append(cur.rstrip())
            cur = tk.lstrip()
        else:
            cur += tk
    if cur:
        out.append(cur.rstrip())
    return out or [line]


def spline_points(e):
    deg = e.i(71, 3)
    knots = [float(v) for v in e.all(40)]
    ws = [float(v) for v in e.all(41)]
    xs, ys = e.all(10), e.all(20)
    ctrl = [(float(x), float(y)) for x, y in zip(xs, ys)]
    if len(ctrl) < 2:
        fx, fy = e.all(11), e.all(21)
        fit = [(float(x), float(y)) for x, y in zip(fx, fy)]
        return fit if len(fit) >= 2 else []
    n = len(ctrl)
    if len(knots) != n + deg + 1:
        return ctrl
    if len(ws) != n:
        ws = [1.0] * n
    t0, t1 = knots[deg], knots[n]
    steps = max(16, n * 8)
    pts = []
    for k in range(steps + 1):
        t = t0 + (t1 - t0) * k / steps
        if k == steps:
            t -= 1e-9 * (t1 - t0 or 1)
        # span
        s = deg
        while s < n - 1 and knots[s + 1] <= t:
            s += 1
        d = [(ctrl[j][0] * ws[j], ctrl[j][1] * ws[j], ws[j]) for j in range(s - deg, s + 1)]
        for r in range(1, deg + 1):
            for j in range(deg, r - 1, -1):
                i = j + s - deg
                den = knots[i + deg - r + 1] - knots[i]
                a = 0.0 if den == 0 else (t - knots[i]) / den
                d[j] = tuple((1 - a) * d[j - 1][q] + a * d[j][q] for q in range(3))
        x, y, w = d[deg]
        pts.append((x / w, y / w) if w else (x, y))
    return pts


def hatch_data(e):
    """(boundary loops as point lists, pattern lines, solid?)"""
    tags = e.tags
    n = len(tags)
    i = 0
    loops = []
    solid = False
    pattern = []
    # find the boundary data: after 91 (number of loops)
    while i < n and tags[i][0] != 91:
        if tags[i][0] == 70:
            solid = tags[i][1].strip() == "1"
        i += 1
    if i >= n:
        return [], [], solid
    nloops = int(float(tags[i][1]))
    i += 1

    def val(code):
        nonlocal i
        while i < n and tags[i][0] != code:
            i += 1
        if i >= n:
            raise ValueError("hatch ended early")
        v = tags[i][1]
        i += 1
        return v

    for _ in range(nloops):
        typ = int(float(val(92)))
        pts = []
        if typ & 2:
            has_b = int(float(val(72)))
            closed = int(float(val(73)))
            nv = int(float(val(93)))
            verts = []
            for _k in range(nv):
                x = float(val(10)); y = float(val(20))
                bl = 0.0
                if has_b:
                    # a bulge (42) follows its vertex, when there is one
                    if i < n and tags[i][0] == 42:
                        bl = float(tags[i][1]); i += 1
                verts.append([x, y, bl])
            pts = bulge_path(verts, True)
        else:
            ne = int(float(val(93)))
            for _k in range(ne):
                et = int(float(val(72)))
                if et == 1:
                    a = (float(val(10)), float(val(20))); b = (float(val(11)), float(val(21)))
                    seg = [a, b]
                elif et == 2:
                    c = (float(val(10)), float(val(20))); r = float(val(40))
                    a0 = math.radians(float(val(50))); a1 = math.radians(float(val(51))); ccw = int(float(val(73)))
                    if ccw:
                        if a1 < a0:
                            a1 += 2 * math.pi
                        seg = arc(c, r, a0, a1)
                    else:
                        a0, a1 = -a0, -a1
                        if a1 > a0:
                            a1 -= 2 * math.pi
                        seg = arc(c, r, a0, a1)
                elif et == 3:
                    c = (float(val(10)), float(val(20))); mj = (float(val(11)), float(val(21)))
                    ratio = float(val(40)); a0 = math.radians(float(val(50))); a1 = math.radians(float(val(51))); ccw = int(float(val(73)))
                    mn = (-mj[1] * ratio, mj[0] * ratio)
                    if not ccw:
                        a0, a1 = -a0, -a1
                        if a1 > a0:
                            a1 -= 2 * math.pi
                    elif a1 < a0:
                        a1 += 2 * math.pi
                    k = max(8, int(abs(a1 - a0) / (math.pi / 36)))
                    seg = [(c[0] + mj[0] * math.cos(a0 + (a1 - a0) * j / k) + mn[0] * math.sin(a0 + (a1 - a0) * j / k),
                            c[1] + mj[1] * math.cos(a0 + (a1 - a0) * j / k) + mn[1] * math.sin(a0 + (a1 - a0) * j / k)) for j in range(k + 1)]
                elif et == 4:
                    deg = int(float(val(94)))
                    val(73); val(74)
                    nk = int(float(val(95))); nc = int(float(val(96)))
                    knots = [float(val(40)) for _q in range(nk)]
                    ctrl = []
                    for _q in range(nc):
                        x = float(val(10)); y = float(val(20))
                        if i < n and tags[i][0] == 42:
                            i += 1
                        ctrl.append((x, y))

                    fake = D.Ent("SPLINE", [(71, str(deg))] + [(40, str(k)) for k in knots] + [p for c in ctrl for p in ((10, str(c[0])), (20, str(c[1])))])
                    seg = spline_points(fake) or ctrl
                    # fit data may follow (97 count, 11/21, 12/22, 13/23): skipped by the next val()
                else:
                    seg = []
                if seg:
                    if pts and math.hypot(pts[-1][0] - seg[0][0], pts[-1][1] - seg[0][1]) < 1e-6:
                        pts += seg[1:]
                    else:
                        pts += seg
        # source objects (97 count, 330 handles)
        if i < n and tags[i][0] == 97:
            cnt = int(float(tags[i][1])); i += 1
            for _q in range(cnt):
                if i < n and tags[i][0] == 330:
                    i += 1
        if len(pts) >= 3:
            loops.append(pts)
    # pattern
    while i < n and tags[i][0] != 78:
        if tags[i][0] == 70:
            solid = tags[i][1].strip() == "1" or solid
        i += 1
    if i < n:
        nl = int(float(tags[i][1])); i += 1
        for _ in range(nl):
            try:
                ang = float(val(53)); bx = float(val(43)); by = float(val(44)); ox = float(val(45)); oy = float(val(46))
                nd = int(float(val(79)))
                dashes = [float(val(49)) for _q in range(nd)]
                pattern.append((ang, bx, by, ox, oy, dashes))
            except ValueError:
                break
    return loops, pattern, solid


def pattern_lines(box, ang, base, off, dashes, budget):
    """The segments of one hatch pattern line family covering box."""
    if budget <= 0:
        return []
    ux, uy = math.cos(ang), math.sin(ang)
    nx, ny = -uy, ux
    s = off[0] * nx + off[1] * ny             # spacing across the lines
    t_shift = off[0] * ux + off[1] * uy       # shift along, line to line
    if abs(s) < 1e-9:
        return []
    corners = [(box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3])]
    ds = [((x - base[0]) * nx + (y - base[1]) * ny) / s for x, y in corners]
    ts = [(x - base[0]) * ux + (y - base[1]) * uy for x, y in corners]
    k0, k1 = int(math.floor(min(ds))), int(math.ceil(max(ds)))
    if k1 - k0 > budget:
        return [None] * (budget + 1)
    tmin, tmax = min(ts), max(ts)
    plen = sum(abs(d) for d in dashes)
    out = []
    for k in range(k0, k1 + 1):
        ox, oy = base[0] + k * s * nx, base[1] + k * s * ny
        if not dashes or plen < 1e-9:
            out.append(((ox + tmin * ux, oy + tmin * uy), (ox + tmax * ux, oy + tmax * uy)))
            continue
        phase = k * t_shift
        start = tmin - ((tmin - phase) % plen)
        t = start
        while t < tmax:
            for d in dashes:
                L = abs(d)
                if d > 0:
                    a, b = max(t, tmin), min(t + L, tmax)
                    if b > a:
                        out.append(((ox + a * ux, oy + a * uy), (ox + b * ux, oy + b * uy)))
                elif d == 0:
                    if tmin <= t <= tmax:
                        out.append(((ox + t * ux, oy + t * uy), (ox + (t + plen * 0.002) * ux, oy + (t + plen * 0.002) * uy)))
                t += L
                if len(out) > budget:
                    return out
            if plen <= 0:
                break
    return out


# ------------------------------------------------------------- pages

def color_ops(p, mono, fill):
    r, g, b = p.rgb
    if mono:
        if p.aci in GREYS or (p.aci == 256 and r == g == b):
            v = r / 255.0
        elif p.kind == "F":
            lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255.0
            v = 0.0 if lum < 0.15 else min(0.85, lum)
        else:
            v = 0.0
        if p.aci == 7:
            v = 0.0
        return ("%s g" if fill else "%s G") % P.num(v)
    if p.aci == 7 or (r, g, b) == (255, 255, 255) and p.kind != "W":
        r = g = b = 0
    return ("%s %s %s rg" if fill else "%s %s %s RG") % (P.num(r / 255.0), P.num(g / 255.0), P.num(b / 255.0))


def emit(pdf, prims, T, out, mono, frozen=None, view=None, dash_k=None):
    """Prims through T (to page mm) -> operators. view: the model box to
    keep (a viewport's), frozen: layer names left out. dash_k: how dashes
    scale (None: with T)."""
    s = mscale(T)
    for p in prims:
        if frozen and p.layer.upper() in frozen:
            continue
        if view is not None:
            b = p.bbox()
            if b[2] < view[0] or b[0] > view[2] or b[3] < view[1] or b[1] > view[3]:
                continue
        if p.kind == "S":
            lw = p.lw_units * s if p.lw_units else p.lw
            ops = [color_ops(p, mono, False), "%s w" % P.num(max(MIN_LW, lw))]
            if p.dash:
                k = s if dash_k is None else dash_k
                arr = []
                for d in p.dash:
                    arr.append(max(0.15, abs(d) * k) if d != 0 else 0.15)
                ops.append("[%s] 0 d" % " ".join(P.num(x) for x in arr))
            else:
                ops.append("[] 0 d")
            for pl in p.paths:
                q = [ap(T, v) for v in pl]
                ops.append("%s %s m " % (P.num(q[0][0]), P.num(q[0][1])) + " ".join("%s %s l" % (P.num(x), P.num(y)) for x, y in q[1:]) + " S")
            out.append("\n".join(ops))
        elif p.kind in ("F", "W"):
            col = "1 g" if p.kind == "W" else color_ops(p, mono, True)
            sub = []
            for pl in p.paths:
                q = [ap(T, v) for v in pl]
                sub.append("%s %s m " % (P.num(q[0][0]), P.num(q[0][1])) + " ".join("%s %s l" % (P.num(x), P.num(y)) for x, y in q[1:]) + " h")
            out.append(col + " " + " ".join(sub) + (" f*" if p.evenodd else " f"))
        elif p.kind == "H":
            sub = []
            for pl in p.clip:
                q = [ap(T, v) for v in pl]
                sub.append("%s %s m " % (P.num(q[0][0]), P.num(q[0][1])) + " ".join("%s %s l" % (P.num(x), P.num(y)) for x, y in q[1:]) + " h")
            ln = []
            for a, b in p.paths:
                qa, qb = ap(T, a), ap(T, b)
                ln.append("%s %s m %s %s l" % (P.num(qa[0]), P.num(qa[1]), P.num(qb[0]), P.num(qb[1])))
            out.append("q " + " ".join(sub) + " W* n " + color_ops(p, mono, False) + " %s w [] 0 d " % P.num(p.lw) + " ".join(ln) + " S Q")
        elif p.kind == "T":
            m = mul(T, p.m)
            out.append(P.text_ops(pdf, p.text, m, color_ops(p, mono, True)))


class Sheet(object):
    def __init__(self, name, w, h, content):
        self.name, self.w, self.h, self.content = name, w, h, content


def render(doc, xref=None, mono=True, notes=None):
    """The drawing's layouts as Sheets (name, paper size mm, operators) and
    a PDF writer holding their glyphs. A drawing without layouts gives
    its model."""
    notes = notes if notes is not None else {}
    pdf = P.Pdf()
    model_b = Builder(doc, xref, notes)
    model_b.draw(doc.model_ents(), doc)
    model = model_b.out
    psl = doc.hv("$PSLTSCALE", default="1") != "0"
    sheets = []
    for L in doc.layouts:
        if L.is_model:
            continue
        ents = doc.paper_ents(L)
        allv = [e for e in ents if e.type == "VIEWPORT"]
        vps = [e for k, e in enumerate(allv) if not is_paper_vp(e, k == 0)]
        others = [e for e in ents if e.type != "VIEWPORT"]
        if not vps and not others:
            continue
        uf = 25.4 if L.units == 0 else 1.0
        pb = Builder(doc, xref, notes)
        pb.draw(ents, doc)
        paper = pb.out
        # paper space -> page (mm)
        W, H = L.paper
        if L.rotation in (1, 3):
            W, H = H, W
        if L.limmin and L.limmax:
            lw_, lh_ = (L.limmax[0] - L.limmin[0]) * uf, (L.limmax[1] - L.limmin[1]) * uf
            if W <= 0 or H <= 0:
                W, H = lw_, lh_
            PT_ = mul(sc(uf), tr(-L.limmin[0], -L.limmin[1])) if abs(lw_ - W) < 5 and abs(lh_ - H) < 5 else mul(tr(L.margins[0] + L.origin[0], L.margins[1] + L.origin[1]), sc(uf))
        else:
            PT_ = mul(tr(L.margins[0] + L.origin[0], L.margins[1] + L.origin[1]), sc(uf))
        # what is on the paper: if it does not sit on the page, the page is fitted round it
        boxes = [p.bbox() for p in paper]
        for v in vps:
            c, w, h = v.pt(10), v.f(40), v.f(41)
            boxes.append((c[0] - w / 2, c[1] - h / 2, c[0] + w / 2, c[1] + h / 2))
        if boxes:
            x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
            x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)

            def on_page(b):
                a, c = ap(PT_, (b[0], b[1])), ap(PT_, (b[2], b[3]))
                return a[0] > -0.05 * W and a[1] > -0.05 * H and c[0] < 1.05 * W and c[1] < 1.05 * H
            # the paper is kept when most of what is drawn is on it (a stray
            # object off the sheet is not plotted either)
            if W <= 0 or H <= 0 or sum(1 for b in boxes if on_page(b)) < 0.5 * len(boxes):
                W, H = (x1 - x0) * uf + 20, (y1 - y0) * uf + 20
                PT_ = mul(tr(10, 10), mul(sc(uf), tr(-x0, -y0)))
        if W <= 0 or H <= 0:
            continue
        out = []
        # paper space in its order; each viewport's model where it stands
        for e in vps:
            viewport(pdf, doc, e, model, PT_, out, mono, psl, uf, notes)
        emit(pdf, paper, PT_, out, mono)
        sheets.append(Sheet(L.name, W, H, "\n".join(out)))
    if not sheets and model:
        # no layouts: the model, fitted on an A1
        xs = [p.bbox() for p in model]
        x0 = min(b[0] for b in xs); y0 = min(b[1] for b in xs); x1 = max(b[2] for b in xs); y1 = max(b[3] for b in xs)
        W, H = 841.0, 594.0
        k = min((W - 20) / max(1e-9, x1 - x0), (H - 20) / max(1e-9, y1 - y0))
        T = mul(tr(10 + ((W - 20) - (x1 - x0) * k) / 2, 10 + ((H - 20) - (y1 - y0) * k) / 2), mul(sc(k), tr(-x0, -y0)))
        out = []
        emit(pdf, model, T, out, mono)
        sheets.append(Sheet("Model", W, H, "\n".join(out)))
    return pdf, sheets


def is_paper_vp(v, first):
    """The layout's own (whole paper) viewport: id 1, or the first one,
    showing paper space at 1:1 (inactive layouts write id 0 for all)."""
    if v.i(69, 2) == 1:
        return True
    if first:
        c, vc = v.pt(10), v.pt(12)
        return abs(v.f(45) - v.f(41)) < 1e-6 and abs(c[0] - vc[0]) < 1e-6 and abs(c[1] - vc[1]) < 1e-6
    return False


def viewport(pdf, doc, v, model, PT_, out, mono, psl, uf, notes):
    if v.i(90) & 0x20000:          # switched off
        return
    d = (v.f(16), v.f(26), v.f(36, 1.0))
    if abs(d[0]) > 1e-6 or abs(d[1]) > 1e-6:
        notes["a 3D view in a viewport (not drawn)"] = notes.get("a 3D view in a viewport (not drawn)", 0) + 1
        return
    c, w, h = v.pt(10), v.f(40), v.f(41)
    vc, vh = v.pt(12), v.f(45)
    if w <= 0 or h <= 0 or vh <= 0:
        return
    tgt = v.pt(17)
    twist = math.radians(v.f(51))
    k = h / vh
    # model -> paper: (p - target), turned by the view twist, then about the view centre
    M = mul(tr(c[0], c[1]), mul(sc(k), mul(tr(-vc[0], -vc[1]), mul(rot(-twist), tr(-tgt[0], -tgt[1])))))
    T = mul(PT_, M)
    # the model area it shows (for leaving out what is outside)
    im = inv(M)
    corners = [ap(im, p) for p in ((c[0] - w / 2, c[1] - h / 2), (c[0] + w / 2, c[1] - h / 2), (c[0] + w / 2, c[1] + h / 2), (c[0] - w / 2, c[1] + h / 2))]
    view = (min(p[0] for p in corners), min(p[1] for p in corners), max(p[0] for p in corners), max(p[1] for p in corners))
    frozen = set()
    for code in (331, 341):
        for hnd in v.all(code):
            n = doc.layer_by_handle.get(hnd)
            if n:
                frozen.add(n.upper())
    # the clip: the viewport's own boundary, or the polyline given for it
    clip = None
    if v.i(90) & 0x10000 and v.get(340):
        ent = _find(doc, v.get(340))
        if ent is not None and ent.type == "LWPOLYLINE":
            verts = []
            for cc, val in ent.tags:
                if cc == 10:
                    verts.append([float(val), 0.0, 0.0])
                elif cc == 20 and verts:
                    verts[-1][1] = float(val)
                elif cc == 42 and verts:
                    verts[-1][2] = float(val)
            clip = bulge_path(verts, True)
    if clip is None:
        clip = [(c[0] - w / 2, c[1] - h / 2), (c[0] + w / 2, c[1] - h / 2), (c[0] + w / 2, c[1] + h / 2), (c[0] - w / 2, c[1] + h / 2)]
    q = [ap(PT_, p) for p in clip]
    ops = ["q %s %s m " % (P.num(q[0][0]), P.num(q[0][1])) + " ".join("%s %s l" % (P.num(x), P.num(y)) for x, y in q[1:]) + " h W n"]
    # dashes: at paper scale with PSLTSCALE (the usual), else with the view
    emit(pdf, model, T, ops, mono, frozen=frozen, view=view, dash_k=(uf if psl else None))
    ops.append("Q")
    out.append("\n".join(ops))


def _find(doc, handle):
    for e in doc.entities:
        if e.get(5) == handle:
            return e
    for b in doc.blocks.values():
        for e in b.ents:
            if e.get(5) == handle:
                return e
    return None
