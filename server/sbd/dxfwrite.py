# -*- coding: utf-8 -*-
"""A DXF file (AutoCAD 2000, AC1015) from plain entities - the SBD drawings
for CAD and the SBD CAD template. Standard library only.

    d = Dxf()
    d.layer("SBD-SITE", 7)
    d.poly("SBD-SITE", [(0, 0), (10, 0), (10, 5)], closed=True)
    d.text("SBD-TEXT", (5, 2), 1.0, "S1 = 7.500 m", align="c")
    open("x.dxf", "w").write(d.write())

Units are metres ($INSUNITS 6). Colours: an AutoCAD colour index for each
layer; an entity may carry its own RGB (0xRRGGBB). Text that is not ASCII
is written as \\U+XXXX.
"""

ACI_OF = {"red": 1, "yellow": 2, "green": 3, "cyan": 4, "blue": 5, "magenta": 6, "white": 7, "grey": 8, "orange": 30}


def _num(v):
    s = ("%.6f" % float(v)).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _txt(s):
    out = []
    for ch in str(s):
        o = ord(ch)
        if o < 32:
            continue
        out.append(ch if o < 128 else "\\U+%04X" % o)
    return "".join(out)


def _name(s):
    """A layer name AutoCAD takes: no < > / \\ " : ; ? * | = `."""
    bad = '<>/\\":;?*|=`'
    s = "".join("_" if c in bad or ord(c) < 32 else c for c in str(s)).strip()
    return _txt(s)[:255] or "0"


class Dxf(object):
    def __init__(self):
        self.layers = {"0": (7, None)}
        self.ents = []           # [(type, [(code, value)])]
        self._h = 0x100

    def handle(self):
        self._h += 1
        return "%X" % self._h

    def layer(self, name, color=7, rgb=None):
        name = _name(name)
        if name not in self.layers:
            self.layers[name] = (int(color), rgb)
        return name

    def _common(self, kind, layer, rgb=None, alpha=None, extra_entity=None):
        layer = self.layer(layer) if _name(layer) not in self.layers else _name(layer)
        tags = [(100, "AcDbEntity"), (8, layer)]
        if rgb is not None:
            tags.append((420, int(rgb) & 0xFFFFFF))
        if alpha is not None:
            # transparency: 0x02000000 | alpha (255 opaque)
            tags.append((440, 0x02000000 | max(0, min(255, int(round(alpha * 255))))))
        return tags

    def line(self, layer, a, b, rgb=None, z=0.0):
        t = self._common("LINE", layer, rgb)
        t += [(100, "AcDbLine"), (10, a[0]), (20, a[1]), (30, z), (11, b[0]), (21, b[1]), (31, z)]
        self.ents.append(("LINE", t))

    def poly(self, layer, pts, closed=False, rgb=None, elevation=0.0, thickness=0.0, width=None):
        pts = [p for i, p in enumerate(pts) if i == 0 or abs(p[0] - pts[i - 1][0]) + abs(p[1] - pts[i - 1][1]) > 1e-9]
        if len(pts) < 2:
            return
        t = self._common("LWPOLYLINE", layer, rgb)
        t += [(100, "AcDbPolyline"), (90, len(pts)), (70, 1 if closed else 0)]
        if width:
            t.append((43, width))
        if elevation:
            t.append((38, elevation))
        if thickness:
            t.append((39, thickness))
        for p in pts:
            t += [(10, p[0]), (20, p[1])]
        self.ents.append(("LWPOLYLINE", t))

    def circle(self, layer, c, r, rgb=None):
        t = self._common("CIRCLE", layer, rgb)
        t += [(100, "AcDbCircle"), (10, c[0]), (20, c[1]), (30, 0.0), (40, r)]
        self.ents.append(("CIRCLE", t))

    def text(self, layer, p, height, s, rot=0.0, align="l", valign="b", rgb=None):
        """align: l / c / r; valign: b (baseline) / m (middle) / t."""
        h = {"l": 0, "c": 1, "r": 2}.get(align, 0)
        v = {"b": 0, "m": 2, "t": 3}.get(valign, 0)
        t = self._common("TEXT", layer, rgb)
        t += [(100, "AcDbText"), (10, p[0]), (20, p[1]), (30, 0.0), (40, height), (1, _txt(s)), (50, rot % 360.0), (7, "Standard")]
        if h or v:
            t += [(72, h), (11, p[0]), (21, p[1]), (31, 0.0)]
        t += [(100, "AcDbText")]
        if v:
            t += [(73, v)]
        self.ents.append(("TEXT", t))

    def fill(self, layer, pts, rgb=None, alpha=None):
        """A solid hatch over a closed outline."""
        if len(pts) < 3:
            return
        t = self._common("HATCH", layer, rgb, alpha)
        t += [(100, "AcDbHatch"), (10, 0.0), (20, 0.0), (30, 0.0), (210, 0.0), (220, 0.0), (230, 1.0), (2, "SOLID"), (70, 1), (71, 0),
              (91, 1), (92, 3), (72, 0), (73, 1), (93, len(pts))]
        for p in pts:
            t += [(10, p[0]), (20, p[1])]
        t += [(97, 0), (75, 1), (76, 1), (98, 0)]
        self.ents.append(("HATCH", t))

    def face(self, layer, a, b, c, d=None, rgb=None):
        """A 3D face (three or four corners, x y z)."""
        d = d or c
        t = self._common("3DFACE", layer, rgb)
        t += [(100, "AcDbFace")]
        for k, q in enumerate((a, b, c, d)):
            t += [(10 + k, q[0]), (20 + k, q[1]), (30 + k, q[2])]
        self.ents.append(("3DFACE", t))

    # ------------------------------------------------------------ output
    def write(self):
        out = []

        def w(code, val):
            out.append("%3d" % code if code < 1000 else str(code))
            out.append(_num(val) if isinstance(val, float) else str(val))

        def sect(name):
            w(0, "SECTION")
            w(2, name)

        # the handles of the fixed objects
        H = {k: self.handle() for k in ("vport_t", "ltype_t", "layer_t", "style_t", "view_t", "ucs_t", "appid_t", "dimstyle_t",
                                         "brec_t", "vport", "lt_bb", "lt_bl", "lt_cont", "style", "appid", "dimstyle",
                                         "ms_rec", "ps_rec", "ms_blk", "ms_end", "ps_blk", "ps_end", "root", "groups")}
        layer_h = {n: self.handle() for n in self.layers}
        ent_h = [self.handle() for _ in self.ents]
        seed = "%X" % (self._h + 1)

        sect("HEADER")
        for k, code, v in (("$ACADVER", 1, "AC1015"), ("$HANDSEED", 5, seed), ("$INSUNITS", 70, 6), ("$MEASUREMENT", 70, 1),
                           ("$DWGCODEPAGE", 3, "ANSI_1252"), ("$LUNITS", 70, 2), ("$LUPREC", 70, 3)):
            w(9, k)
            w(code, v)
        w(0, "ENDSEC")
        sect("CLASSES")
        w(0, "ENDSEC")

        sect("TABLES")

        def table(name, h, n, sub=None):
            w(0, "TABLE")
            w(2, name)
            w(5, h)
            w(330, 0)
            w(100, "AcDbSymbolTable")
            w(70, n)
            if sub:
                w(100, sub)

        def entry(kind, h, owner, sub):
            w(0, kind)
            w(5, h)
            w(330, owner)
            w(100, "AcDbSymbolTableRecord")
            w(100, sub)

        table("VPORT", H["vport_t"], 1)
        entry("VPORT", H["vport"], H["vport_t"], "AcDbViewportTableRecord")
        w(2, "*ACTIVE")
        w(70, 0)
        for c, v in ((10, 0.0), (20, 0.0), (11, 1.0), (21, 1.0), (12, 0.0), (22, 0.0), (13, 0.0), (23, 0.0), (14, 1.0), (24, 1.0),
                     (15, 1.0), (25, 1.0), (16, 0.0), (26, 0.0), (36, 1.0), (17, 0.0), (27, 0.0), (37, 0.0), (40, 100.0), (41, 1.5),
                     (42, 50.0), (43, 0.0), (44, 0.0), (50, 0.0), (51, 0.0)):
            w(c, v)
        for c, v in ((71, 0), (72, 100), (73, 1), (74, 3), (75, 0), (76, 0), (77, 0), (78, 0), (281, 0), (65, 1), (146, 0.0)):
            w(c, v)
        w(0, "ENDTAB")

        table("LTYPE", H["ltype_t"], 3)
        for h, nm, desc in ((H["lt_bb"], "ByBlock", ""), (H["lt_bl"], "ByLayer", ""), (H["lt_cont"], "Continuous", "Solid line")):
            entry("LTYPE", h, H["ltype_t"], "AcDbLinetypeTableRecord")
            w(2, nm)
            w(70, 0)
            w(3, desc)
            w(72, 65)
            w(73, 0)
            w(40, 0.0)
        w(0, "ENDTAB")

        table("LAYER", H["layer_t"], len(self.layers))
        for nm, (col, rgb) in self.layers.items():
            entry("LAYER", layer_h[nm], H["layer_t"], "AcDbLayerTableRecord")
            w(2, nm)
            w(70, 0)
            w(62, col)
            if rgb is not None:
                w(420, int(rgb) & 0xFFFFFF)
            w(6, "Continuous")
            w(370, -3)
            w(390, 0)
        w(0, "ENDTAB")

        table("STYLE", H["style_t"], 1)
        entry("STYLE", H["style"], H["style_t"], "AcDbTextStyleTableRecord")
        w(2, "Standard")
        w(70, 0)
        w(40, 0.0)
        w(41, 1.0)
        w(50, 0.0)
        w(71, 0)
        w(42, 2.5)
        w(3, "arial.ttf")
        w(4, "")
        w(0, "ENDTAB")

        table("VIEW", H["view_t"], 0)
        w(0, "ENDTAB")
        table("UCS", H["ucs_t"], 0)
        w(0, "ENDTAB")

        table("APPID", H["appid_t"], 1)
        entry("APPID", H["appid"], H["appid_t"], "AcDbRegAppTableRecord")
        w(2, "ACAD")
        w(70, 0)
        w(0, "ENDTAB")

        table("DIMSTYLE", H["dimstyle_t"], 1, "AcDbDimStyleTable")
        w(0, "DIMSTYLE")
        w(105, H["dimstyle"])
        w(330, H["dimstyle_t"])
        w(100, "AcDbSymbolTableRecord")
        w(100, "AcDbDimStyleTableRecord")
        w(2, "Standard")
        w(70, 0)
        w(0, "ENDTAB")

        table("BLOCK_RECORD", H["brec_t"], 2)
        for h, nm in ((H["ms_rec"], "*Model_Space"), (H["ps_rec"], "*Paper_Space")):
            entry("BLOCK_RECORD", h, H["brec_t"], "AcDbBlockTableRecord")
            w(2, nm)
            w(70, 0)
            w(280, 1)
            w(281, 0)
        w(0, "ENDTAB")
        w(0, "ENDSEC")

        sect("BLOCKS")
        for blk, end, rec, nm in ((H["ms_blk"], H["ms_end"], H["ms_rec"], "*Model_Space"), (H["ps_blk"], H["ps_end"], H["ps_rec"], "*Paper_Space")):
            w(0, "BLOCK")
            w(5, blk)
            w(330, rec)
            w(100, "AcDbEntity")
            w(8, "0")
            w(100, "AcDbBlockBegin")
            w(2, nm)
            w(70, 0)
            w(10, 0.0)
            w(20, 0.0)
            w(30, 0.0)
            w(3, nm)
            w(1, "")
            w(0, "ENDBLK")
            w(5, end)
            w(330, rec)
            w(100, "AcDbEntity")
            w(8, "0")
            w(100, "AcDbBlockEnd")
        w(0, "ENDSEC")

        sect("ENTITIES")
        for (kind, tags), h in zip(self.ents, ent_h):
            w(0, kind)
            w(5, h)
            w(330, H["ms_rec"])
            for c, v in tags:
                w(c, v)
        w(0, "ENDSEC")

        sect("OBJECTS")
        w(0, "DICTIONARY")
        w(5, H["root"])
        w(330, 0)
        w(100, "AcDbDictionary")
        w(281, 1)
        w(3, "ACAD_GROUP")
        w(350, H["groups"])
        w(0, "DICTIONARY")
        w(5, H["groups"])
        w(330, H["root"])
        w(100, "AcDbDictionary")
        w(281, 1)
        w(0, "ENDSEC")
        w(0, "EOF")
        return "\r\n".join(out) + "\r\n"
