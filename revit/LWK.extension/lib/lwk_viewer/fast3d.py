# -*- coding: utf-8 -*-
"""Fast 3D export: the model's geometry read straight from Revit's own
renderer (CustomExporter), written as .lwkm files the viewer loads directly.

Why not IFC. Revit's IFC exporter works out every element's IFC entity,
property sets, spatial containment and quantities, one processor core at a
time: the large tower took hours. The viewer needs none of that - only
triangles, colours, which element each triangle belongs to, and a few
facts about each element. CustomExporter hands over exactly the triangles
Revit draws in a 3D view, and several things make it far lighter still:

  - A family type placed a thousand times (a door, a window, a chair) has
    its geometry read ONCE; every other placement is a transform. Revit
    says which placements share geometry (InstanceNode.GetSymbolGeometryId),
    so the rest are skipped before any triangle is produced.
  - A linked model placed many times (a typical floor) is read once; the
    other placements are transforms.
  - A typical floor made of copied groups (groups.py) is read once; the
    copies are transforms.
  - What the viewer leaves out (furniture, rooms, entourage ...) is hidden
    in the export view, so Revit never draws it at all.

The .lwkm file (little-endian, gzip-compressed):
    "LWKM" | u32 version | u32 json length | json (padded to 4) | binary
  json: materials, elements (columns), meshes (ranges into the binary),
        defs (a family type's geometry: meshes + nested defs), instances,
        groups (shared typical floors), levels, and where each binary
        section starts.
  binary: positions f32 (metres), indices u32 (per mesh, from 0),
          matrices f64 (3x4 row-major, metres, the document's internal
          coordinates).
Baked (non-instanced) positions are relative to "offset" (metres, internal
coordinates) to keep float precision; def positions are in the family's
own frame.

Properties go in a second file, <name>.props.json, read by the viewer only
when someone asks for an element's properties.
"""

__version__ = "2026-10-07a"

import gzip
import io
import json
import math
import os
import time
from array import array

FT = 0.3048                     # feet -> metres
VERSION = 1


# ------------------------------------------------------------- helpers

_B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$"


def ifc_guid(guid):
    """A System.Guid (or its string) as the 22-character IFC GUID - the
    same compression the IFC exporter uses, so issues and BCF keep
    pointing at the same elements."""
    h = str(guid).replace("-", "").replace("{", "").replace("}", "")
    if len(h) != 32:
        return None
    n = int(h, 16)
    out = []
    for _ in range(22):
        out.append(_B64[n % 64])
        n //= 64
    return "".join(reversed(out))


def _plain(o):
    """For json: .NET numbers and strings (System.Byte, Int64, Double ...)
    that IronPython's json does not know how to write."""
    for conv in (int, float):
        try:
            v = conv(o)
            if conv is int and float(o) != v:
                continue
            return v
        except Exception:
            continue
    return str(o)


def _bytes(arr):
    fn = getattr(arr, "tobytes", None)
    return fn() if fn else arr.tostring()


def mat12(t, scale=FT):
    """Revit Transform (feet) -> 3x4 row-major list, metres."""
    o, x, y, z = t.Origin, t.BasisX, t.BasisY, t.BasisZ
    return [x.X, y.X, z.X, o.X * scale,
            x.Y, y.Y, z.Y, o.Y * scale,
            x.Z, y.Z, z.Z, o.Z * scale]


def _safe(fn, default=None):
    try:
        return fn()
    except Exception:
        return default


# ------------------------------------------------------------- writer

class DocWriter(object):
    """Everything read from one document (the host, or one linked model)."""

    def __init__(self, doc, stem, offset=(0.0, 0.0, 0.0)):
        self.doc = doc
        self.stem = stem
        self.title = _safe(lambda: doc.Title, stem)
        self.offset = tuple(offset)
        self.pos = array("f")
        self.idx = array("I")
        self.meshes = []                 # [vstart, vcount, istart, icount, mat]
        self.materials = []              # [r, g, b, opacity]
        self._mat = {}
        self.el = []                     # element records (dicts)
        self._el = {}                    # element id -> index
        self.defs = []                   # {"key", "meshes": [], "kids": [[def, m12]]}
        self._def = {}                   # symbol geometry key -> def index
        self.inst = []                   # [element index, def index, m12 (doc frame)]
        self.groups = []                 # {"name", "elements": [], "copies": [m12]}
        self.group_of = {}               # member element id -> group index
        self.skip = set()                # element ids of shared group copies
        self.levels = []
        self._open = None                # (target, mat) of the mesh being appended to
        self.bounds = [[None, None, None], [None, None, None]]   # baked, offset frame
        self.stats = {"polymeshes": 0, "triangles": 0, "inst_skipped": 0,
                      "elements_skipped": 0}

    # materials ----------------------------------------------------------
    def material(self, rgb, opacity):
        # plain Python numbers: Revit hands colours over as System.Byte,
        # which json cannot write ("127 is not JSON serializable")
        key = (int(rgb[0]), int(rgb[1]), int(rgb[2]), round(float(opacity), 2))
        i = self._mat.get(key)
        if i is None:
            i = len(self.materials)
            self._mat[key] = i
            self.materials.append(list(key))
        return i

    # elements -----------------------------------------------------------
    def element(self, eid):
        i = self._el.get(eid)
        if i is not None:
            return i
        i = len(self.el)
        self._el[eid] = i
        rec = {"id": eid, "baked": []}
        self.el.append(rec)
        g = self.group_of.get(eid)
        if g is not None:
            self.groups[g]["elements"].append(i)
        return i

    # geometry -----------------------------------------------------------
    def add_polymesh(self, target, mat, pts, facets, in_def):
        """target: ("el", element index) or ("def", def index). Points are
        Revit XYZ (feet) in the frame of the innermost instance (a def) or
        of the document (baked)."""
        pos, idx = self.pos, self.idx
        if self._open is not None and self._open[0] == target and self._open[1] == mat:
            m = self.meshes[self._open[2]]
        else:
            m = [len(pos) // 3, 0, len(idx), 0, mat]
            self.meshes.append(m)
            mi = len(self.meshes) - 1
            self._open = (target, mat, mi)
            if target[0] == "el":
                self.el[target[1]]["baked"].append(mi)
            else:
                self.defs[target[1]]["meshes"].append(mi)
        base = m[1]                      # vertices already in this mesh
        if in_def:
            ox = oy = oz = 0.0
        else:
            ox, oy, oz = self.offset
        ap = pos.append
        s0 = len(pos)
        n = 0
        for p in pts:
            ap(p.X * FT - ox)
            ap(p.Y * FT - oy)
            ap(p.Z * FT - oz)
            n += 1
        ai = idx.append
        t = 0
        for f in facets:
            ai(f.V1 + base)
            ai(f.V2 + base)
            ai(f.V3 + base)
            t += 1
        m[1] += n
        m[3] += 3 * t
        if not in_def and n:
            # the extent of what is drawn in place (the viewer loads the
            # linked models near the view first, by these boxes)
            b = self.bounds
            for k in range(3):
                seg = pos[s0 + k::3]
                lo, hi = min(seg), max(seg)
                if b[0][k] is None or lo < b[0][k]:
                    b[0][k] = lo
                if b[1][k] is None or hi > b[1][k]:
                    b[1][k] = hi
        self.stats["polymeshes"] += 1
        self.stats["triangles"] += t

    def close_mesh(self):
        self._open = None

    def box_m(self):
        """The model's extent, metres, its own internal coordinates:
        what is drawn in place, the family placements, and every copy of
        a typical floor. None if nothing was drawn."""
        b = self.bounds
        if b[0][0] is None and not self.inst:
            return None
        o = self.offset
        if b[0][0] is None:
            lo = [float("inf")] * 3
            hi = [float("-inf")] * 3
        else:
            lo = [b[0][k] + o[k] for k in range(3)]
            hi = [b[1][k] + o[k] for k in range(3)]
        for e, d, m in self.inst:
            t = (m[3], m[7], m[11])
            for k in range(3):
                lo[k] = min(lo[k], t[k])
                hi[k] = max(hi[k], t[k])
        base_lo, base_hi = list(lo), list(hi)
        for g in self.groups:
            for m in g["copies"]:
                # a copy moves the whole floor; its box is the first one's, moved
                for k, ti in ((0, 3), (1, 7), (2, 11)):
                    lo[k] = min(lo[k], base_lo[k] + m[ti] - 0)
                    hi[k] = max(hi[k], base_hi[k] + m[ti])
        return [lo, hi]

    # output -------------------------------------------------------------
    def write(self, folder):
        """<stem>.lwkm (gzip) in folder; returns (path, bytes, summary)."""
        if not os.path.isdir(folder):
            os.makedirs(folder)
        bin_parts = []
        at = [0]

        def section(raw):
            off = at[0]
            bin_parts.append(raw)
            at[0] += len(raw)
            pad = (-len(raw)) % 8
            if pad:
                bin_parts.append(b"\0" * pad)
                at[0] += pad
            return off

        pos_off = section(_bytes(self.pos))
        idx_off = section(_bytes(self.idx))
        mats = array("d")
        inst_rows = []
        for e, d, m in self.inst:
            inst_rows.append([e, d, len(mats) // 12])
            mats.extend(m)
        kid_rows = []
        for d in self.defs:
            rows = []
            for k, m in d["kids"]:
                rows.append([k, len(mats) // 12])
                mats.extend(m)
            kid_rows.append(rows)
        grp_rows = []
        for g in self.groups:
            rows = []
            for m in g["copies"]:
                rows.append(len(mats) // 12)
                mats.extend(m)
            grp_rows.append(rows)
        mat_off = section(_bytes(mats))

        cats, cat_ix = [], {}

        def cat(name):
            name = name or "Other"
            if name not in cat_ix:
                cat_ix[name] = len(cats)
                cats.append(name)
            return cat_ix[name]

        head = {
            "v": VERSION, "doc": self.title, "units": "m",
            "offset": list(self.offset),
            "materials": self.materials,
            "cats": cats,
            "el": {
                "id": [e["id"] for e in self.el],
                "cat": [cat(e.get("cat")) for e in self.el],
                "name": [e.get("name") or "" for e in self.el],
                "type": [e.get("type") or "" for e in self.el],
                "family": [e.get("family") or "" for e in self.el],
                "level": [e.get("level") or "" for e in self.el],
                "guid": [e.get("guid") or "" for e in self.el],
                "uid": [e.get("uid") or "" for e in self.el],
                "baked": [e["baked"] for e in self.el],
            },
            "meshes": self.meshes,
            "defs": [{"meshes": d["meshes"], "kids": kid_rows[i]} for i, d in enumerate(self.defs)],
            "inst": inst_rows,
            "groups": [{"name": g["name"], "elements": g["elements"], "copies": grp_rows[i]}
                       for i, g in enumerate(self.groups)],
            "levels": self.levels,
            "bbox_m": self.box_m(),
            "bin": {"pos": [pos_off, len(self.pos)], "idx": [idx_off, len(self.idx)],
                    "mat": [mat_off, len(mats)]},
            "stats": self.stats,
        }
        js = json.dumps(head, separators=(",", ":"), default=_plain).encode("utf-8")
        js += b" " * ((-len(js)) % 8)
        import struct
        path = os.path.join(folder, self.stem + ".lwkm")
        tmp = path + ".part"
        head_bytes = b"LWKM" + struct.pack("<II", VERSION, len(js)) + b"\0" * 4
        try:
            with open(tmp, "wb") as raw:
                gz = gzip.GzipFile(fileobj=raw, mode="wb", compresslevel=5)
                gz.write(head_bytes)
                gz.write(js)
                for part in bin_parts:
                    gz.write(part)
                gz.close()
        except Exception:
            # no working gzip in this Python: the viewer reads it plain too
            with open(tmp, "wb") as raw:
                raw.write(head_bytes)
                raw.write(js)
                for part in bin_parts:
                    raw.write(part)
        if os.path.exists(path):
            os.remove(path)
        os.rename(tmp, path)
        tris = len(self.idx) // 3
        return path, os.path.getsize(path), {
            "elements": len(self.el), "triangles": tris, "defs": len(self.defs),
            "instances": len(self.inst), "groups": len(self.groups),
            "materials": len(self.materials)}


# ------------------------------------------------------------ metadata

def describe(doc, el, rec):
    """Category, names, level and GUIDs of one element, into rec."""
    c = _safe(lambda: el.Category)
    rec["cat"] = _safe(lambda: c.Name, "Other") if c is not None else "Other"
    rec["name"] = _safe(lambda: el.Name, "")
    tid = _safe(lambda: el.GetTypeId())
    t = _safe(lambda: doc.GetElement(tid)) if tid is not None else None
    if t is not None:
        rec["type"] = _safe(lambda: t.Name, "")
        rec["family"] = _safe(lambda: t.FamilyName, "")
        rec["type_id"] = _safe(lambda: t.Id.IntegerValue)
    lid = _safe(lambda: el.LevelId)
    lv = _safe(lambda: doc.GetElement(lid)) if lid is not None else None
    if lv is not None:
        rec["level"] = _safe(lambda: lv.Name, "")
    rec["uid"] = _safe(lambda: el.UniqueId, "")
    try:
        from Autodesk.Revit.DB import ExportUtils
        rec["guid"] = ifc_guid(ExportUtils.GetExportId(doc, el.Id))
    except Exception:
        pass


def _param_group(p):
    try:
        from Autodesk.Revit.DB import LabelUtils
        return LabelUtils.GetLabelForGroup(p.Definition.GetGroupTypeId())
    except Exception:
        pass
    try:
        from Autodesk.Revit.DB import LabelUtils
        return LabelUtils.GetLabelFor(p.Definition.ParameterGroup)
    except Exception:
        return "Other"


def _param_value(p):
    # areas, lengths and volumes in metres to three decimals (units.py)
    from lwk_viewer import units
    return units.value_text(p)


def params_of(el):
    out = {}
    try:
        for p in el.Parameters:
            v = _param_value(p)
            if v is None:
                continue
            g = _param_group(p)
            out.setdefault(g, {})[_safe(lambda: p.Definition.Name, "?")] = v
    except Exception:
        pass
    return out


def write_props(writer, folder, probe=None, limit_s=900):
    """<stem>.props.json: every element's instance parameters, and each
    type's parameters once. Stops (and says so) after limit_s seconds."""
    t0 = time.time()
    doc = writer.doc
    types, elems = {}, []
    cut = False
    for i, rec in enumerate(writer.el):
        if time.time() - t0 > limit_s:
            cut = True
            break
        from Autodesk.Revit.DB import ElementId
        el = _safe(lambda: doc.GetElement(ElementId(rec["id"])))
        elems.append(params_of(el) if el is not None else {})
        tid = rec.get("type_id")
        if tid is not None and str(tid) not in types:
            t = _safe(lambda: doc.GetElement(ElementId(tid)))
            types[str(tid)] = params_of(t) if t is not None else {}
    data = {"el": elems, "type_id": [r.get("type_id") for r in writer.el], "types": types,
            "complete": not cut}
    path = os.path.join(folder, writer.stem + ".props.json")
    with io.open(path, "w", encoding="utf-8") as f:
        txt = json.dumps(data, ensure_ascii=False, separators=(",", ":"), default=_plain)
        if not isinstance(txt, type(u"")):
            txt = txt.decode("utf-8")
        f.write(txt)
    if probe is not None:
        probe.info("fast3d", "'%s': properties of %d element(s) in %.1f min%s"
                   % (writer.title, len(elems), (time.time() - t0) / 60.0,
                      " (stopped at the time limit)" if cut else ""))
    return path


def levels_of(doc):
    from Autodesk.Revit.DB import FilteredElementCollector, Level
    out = []
    for lv in FilteredElementCollector(doc).OfClass(Level):
        out.append({"name": _safe(lambda: lv.Name, ""), "elev_m": round(lv.Elevation * FT, 4)})
    out.sort(key=lambda l: l["elev_m"])
    return out


def base_point(doc, survey):
    """(internal xyz, shared xyz) of the project base point or survey
    point, feet, or None."""
    try:
        from Autodesk.Revit.DB import FilteredElementCollector, BasePoint
        for bp in FilteredElementCollector(doc).OfClass(BasePoint):
            if bool(bp.IsShared) == bool(survey):
                p, s = bp.Position, bp.SharedPosition
                return (p.X, p.Y, p.Z), (s.X, s.Y, s.Z)
    except Exception:
        pass
    return None


def internal_to_shared(doc, probe=None):
    """The exact transform from internal to shared coordinates, from the
    two base points Revit states in both frames (Position and
    SharedPosition), as a 3x4 row-major matrix in millimetres. Two points
    fix the rotation about the vertical and the shift; the heights differ
    by a constant. Returns (matrix, note)."""
    pb, sp = base_point(doc, False), base_point(doc, True)
    pts = [p for p in (pb, sp) if p]
    if not pts:
        return None, "no base points readable"
    (p0, s0) = pts[0]
    ang, note = None, ""
    if len(pts) == 2:
        (p1, s1) = pts[1]
        dp = (p1[0] - p0[0], p1[1] - p0[1])
        ds = (s1[0] - s0[0], s1[1] - s0[1])
        if math.hypot(*dp) > 3.0 and math.hypot(*ds) > 3.0:
            ang = math.atan2(ds[1], ds[0]) - math.atan2(dp[1], dp[0])
            note = "from the project base point and survey point"
    if ang is None:
        try:
            from Autodesk.Revit.DB import XYZ
            pos = doc.ActiveProjectLocation.GetProjectPosition(XYZ(0, 0, 0))
            ang = pos.Angle
            note = "rotation from the project position (base points coincide)"
        except Exception:
            ang = 0.0
            note = "no rotation known"
    c, s = math.cos(ang), math.sin(ang)
    tx = s0[0] - (c * p0[0] - s * p0[1])
    ty = s0[1] - (s * p0[0] + c * p0[1])
    tz = s0[2] - p0[2]
    k = FT * 1000.0
    m = [c, -s, 0.0, tx * k, s, c, 0.0, ty * k, 0.0, 0.0, 1.0, tz * k]
    return m, note


# ------------------------------------------------------------- traversal

class Run(object):
    """The state CustomExporter's callbacks work on."""

    def __init__(self, host, stem_of, probe, group_share=True, cancel_after_s=None):
        self.probe = probe
        self.stem_of = stem_of
        self.group_share = group_share
        self.writers = []
        self.by_doc = {}
        self.wstack = []                 # writers, innermost last
        self.link_flags = []             # did OnLinkBegin push a writer?
        self.link_inst = []              # (writer index, m12 in host frame) per link placement
        self._seen_links = set()
        self.dup_links = 0
        self.tstack = []                 # link transforms (Revit), innermost last
        self.el = None                   # current element index
        self.dstack = []                 # defs being defined: (def, key, origin) innermost last
        self.skip_depth = 0
        self.mat = 0
        self.cancel = False
        self.t0 = time.time()
        self.cancel_after_s = cancel_after_s
        self.last_note = time.time()
        self.n_el = 0
        self.writer_for(host, None)

    # documents ----------------------------------------------------------
    def writer_for(self, doc, parent_key):
        key = _safe(lambda: doc.PathName) or _safe(lambda: doc.Title) or str(len(self.writers))
        w = self.by_doc.get(key)
        if w is not None:
            return w, False
        stem = self.stem_of(doc, len(self.writers))
        off = (0.0, 0.0, 0.0)
        pb = base_point(doc, False)
        if pb:
            off = tuple(round(v * FT) for v in pb[0])
        w = DocWriter(doc, stem, off)
        w.levels = _safe(lambda: levels_of(doc), [])
        if self.group_share:
            self._share_groups(w)
        self.writers.append(w)
        self.by_doc[key] = w
        return w, True

    def _share_groups(self, w):
        """Typical floors made of copied groups: the first copy is read,
        the others are skipped and placed by transform."""
        try:
            from lwk_viewer import groups as G
            shared = G.find_shared(w.doc, self.probe)
        except Exception as ex:
            self.probe.warn("fast3d", "'%s': group sharing not possible (%s)" % (w.title, ex))
            return
        n_copies = 0
        for s in shared:
            gi = len(w.groups)
            w.groups.append({"name": s["name"], "elements": [],
                             "copies": [mat12(rel) for _, rel in s["copies"]]})
            for m in s["members"]:
                w.group_of[m] = gi
            for g, _ in s["copies"]:
                for m in G.all_members(w.doc, g):
                    w.skip.add(m)
                w.skip.add(g.Id.IntegerValue)
            n_copies += len(s["copies"])
        if shared:
            self.probe.info("fast3d", "'%s': %d typical group(s), %d copies placed by transform (%s)"
                            % (w.title, len(shared), n_copies, G.why_text()))

    @property
    def w(self):
        return self.wstack[-1]

    # callbacks ----------------------------------------------------------
    def start(self):
        self.wstack.append(self.writers[0])
        return True

    def element_begin(self, eid):
        from Autodesk.Revit.DB import RenderNodeAction
        w = self.w
        i = eid.IntegerValue
        if i in w.skip:
            w.stats["elements_skipped"] += 1
            self.el = None
            return RenderNodeAction.Skip
        self.dstack = []
        self.el = w.element(i)
        rec = w.el[self.el]
        if "cat" not in rec:
            el = _safe(lambda: w.doc.GetElement(eid))
            if el is not None:
                describe(w.doc, el, rec)
        w.close_mesh()
        self.n_el += 1
        if time.time() - self.last_note > 60:
            self.last_note = time.time()
            self.probe.info("fast3d", "%d elements read, %d triangles so far (%.1f min)"
                            % (self.n_el, sum(x.stats["triangles"] for x in self.writers),
                               (time.time() - self.t0) / 60.0))
        if self.cancel_after_s and time.time() - self.t0 > self.cancel_after_s:
            self.cancel = True
        return RenderNodeAction.Proceed

    def element_end(self, eid):
        self.el = None
        self.dstack = []                 # placements never outlive their element
        self.w.close_mesh()

    # Revit calls OnInstanceEnd for a placement whose OnInstanceBegin
    # returned Skip too - or may not; nothing is pushed for a skipped one,
    # and an end is matched to the stack by its symbol and origin, so
    # either way the stack stays right.
    @staticmethod
    def _sig(node, tf=None):
        try:
            key = node.GetSymbolGeometryId().AsUniqueIdentifier()
        except Exception:
            key = None
        tf = tf or node.GetTransform()
        o = tf.Origin
        return key, (round(o.X, 6), round(o.Y, 6), round(o.Z, 6))

    def instance_begin(self, node):
        from Autodesk.Revit.DB import RenderNodeAction
        w = self.w
        tf = node.GetTransform()
        key, org = self._sig(node, tf)
        parent = self.dstack[-1][0] if self.dstack else None
        if key is not None and key in w._def:
            d = w._def[key]
            if parent is not None:
                w.defs[parent]["kids"].append([d, mat12(tf)])
            elif self.el is not None:
                w.inst.append([self.el, d, mat12(tf)])
            w.stats["inst_skipped"] += 1
            return RenderNodeAction.Skip
        d = len(w.defs)
        w.defs.append({"key": key, "meshes": [], "kids": []})
        if key is not None:
            w._def[key] = d
        if parent is not None:
            w.defs[parent]["kids"].append([d, mat12(tf)])
        elif self.el is not None:
            w.inst.append([self.el, d, mat12(tf)])
        self.dstack.append((d, key, org))
        w.close_mesh()
        return RenderNodeAction.Proceed

    def instance_end(self, node):
        if self.dstack:
            key, org = self._sig(node)
            top = self.dstack[-1]
            if top[1] == key and top[2] == org:
                self.dstack.pop()
        self.w.close_mesh()

    def link_begin(self, node):
        from Autodesk.Revit.DB import RenderNodeAction
        doc = _safe(lambda: node.GetDocument())
        tf = node.GetTransform()
        total = tf
        for t in reversed(self.tstack):
            total = t.Multiply(total)
        if doc is None:
            return RenderNodeAction.Skip
        w, new = self.writer_for(doc, None)
        m = mat12(total)
        key = (self.writers.index(w), tuple(round(v, 3) for v in m))
        if key not in self._seen_links:
            # a link placed twice on the same spot is drawn once
            self._seen_links.add(key)
            self.link_inst.append((key[0], m))
        else:
            self.dup_links += 1
        if not new:
            return RenderNodeAction.Skip
        self.probe.info("fast3d", "reading linked model '%s' ..." % w.title)
        o = tf.Origin
        # the host's element state is put aside while inside the link
        self.link_flags.append((w, (round(o.X, 6), round(o.Y, 6), round(o.Z, 6)),
                                self.el, self.dstack))
        self.wstack.append(w)
        self.tstack.append(tf)
        self.el, self.dstack = None, []
        return RenderNodeAction.Proceed

    def link_end(self, node):
        if not self.link_flags:
            return
        w, org, el, dstack = self.link_flags[-1]
        o = _safe(lambda: node.GetTransform().Origin)
        same_doc = _safe(lambda: node.GetDocument().PathName == w.doc.PathName, True)
        if o is not None and (round(o.X, 6), round(o.Y, 6), round(o.Z, 6)) != org:
            return                       # the end of a skipped placement
        if not same_doc:
            return
        self.link_flags.pop()
        self.w.close_mesh()
        self.wstack.pop()
        self.tstack.pop()
        self.el, self.dstack = el, dstack

    def material(self, node):
        w = self.w
        try:
            c = node.Color
            if c.IsValid:
                # System.Byte values: plain ints, or json cannot write them
                rgb = (int(c.Red), int(c.Green), int(c.Blue))
            else:
                rgb = (180, 180, 180)
        except Exception:
            rgb = (180, 180, 180)
        op = 1.0 - (_safe(lambda: float(node.Transparency), 0.0) or 0.0)
        self.mat = w.material(rgb, max(0.05, min(1.0, op)))

    def polymesh(self, node):
        w = self.w
        if self.dstack:
            d = self.dstack[-1][0]
            w.add_polymesh(("def", d), self.mat, node.GetPoints(), node.GetFacets(), True)
            return
        if self.el is None:
            return
        w.add_polymesh(("el", self.el), self.mat, node.GetPoints(), node.GetFacets(), False)


def make_context(run):
    """The IExportContext Revit calls; each callback hands over to run."""
    from Autodesk.Revit.DB import IExportContext, RenderNodeAction

    class Ctx(IExportContext):
        def Start(self):
            return run.start()

        def Finish(self):
            pass

        def IsCanceled(self):
            return run.cancel

        def OnViewBegin(self, node):
            return RenderNodeAction.Proceed

        def OnViewEnd(self, eid):
            pass

        def OnElementBegin(self, eid):
            return run.element_begin(eid)

        def OnElementEnd(self, eid):
            run.element_end(eid)

        def OnInstanceBegin(self, node):
            return run.instance_begin(node)

        def OnInstanceEnd(self, node):
            run.instance_end(node)

        def OnLinkBegin(self, node):
            return run.link_begin(node)

        def OnLinkEnd(self, node):
            run.link_end(node)

        def OnFaceBegin(self, node):
            return RenderNodeAction.Proceed

        def OnFaceEnd(self, node):
            pass

        def OnRPC(self, node):
            pass

        def OnLight(self, node):
            pass

        def OnMaterial(self, node):
            run.material(node)

        def OnPolymesh(self, node):
            run.polymesh(node)

    return Ctx()


# ---------------------------------------------------------------- the view

def export_view(doc, exclude_bics, detail="medium"):
    """A temporary 3D view: everything the viewer shows, nothing it leaves
    out, at the detail level asked for. Committed (CustomExporter will not
    run inside an open transaction); delete it with drop_view()."""
    from Autodesk.Revit.DB import (Transaction, FilteredElementCollector, ViewFamilyType,
                                   ViewFamily, View3D, ViewDetailLevel, Category,
                                   BuiltInCategory, ElementId)
    t = Transaction(doc, "LWK fast export view")
    t.Start()
    try:
        vft = [x for x in FilteredElementCollector(doc).OfClass(ViewFamilyType)
               if x.ViewFamily == ViewFamily.ThreeDimensional][0]
        v = View3D.CreateIsometric(doc, vft.Id)
        _safe(lambda: setattr(v, "ViewTemplateId", ElementId.InvalidElementId))
        try:
            v.Name = "LWK fast export %d" % int(time.time())
        except Exception:
            pass
        lvl = {"coarse": ViewDetailLevel.Coarse, "fine": ViewDetailLevel.Fine}.get(
            detail, ViewDetailLevel.Medium)
        _safe(lambda: setattr(v, "DetailLevel", lvl))
        _safe(lambda: setattr(v, "IsSectionBoxActive", False))
        hidden = []
        for name in exclude_bics:
            try:
                cat = Category.GetCategory(doc, getattr(BuiltInCategory, name))
                if cat is not None and v.CanCategoryBeHidden(cat.Id):
                    v.SetCategoryHidden(cat.Id, True)
                    hidden.append(name)
            except Exception:
                continue
        t.Commit()
        return v, hidden
    except Exception:
        if t.HasStarted() and not t.HasEnded():
            t.RollBack()
        raise


def drop_view(doc, view):
    from Autodesk.Revit.DB import Transaction
    try:
        t = Transaction(doc, "LWK fast export view (remove)")
        t.Start()
        doc.Delete(view.Id)
        t.Commit()
    except Exception:
        pass


# ------------------------------------------------------------------ export

def placed_box_mm(m, box):
    """A box (metres, a link's own frame) moved by a placement (3x4,
    metres), as an axis-aligned box in the host's internal millimetres."""
    lo, hi = box
    xs, ys, zs = [], [], []
    for x in (lo[0], hi[0]):
        for y in (lo[1], hi[1]):
            for z in (lo[2], hi[2]):
                xs.append(m[0] * x + m[1] * y + m[2] * z + m[3])
                ys.append(m[4] * x + m[5] * y + m[6] * z + m[7])
                zs.append(m[8] * x + m[9] * y + m[10] * z + m[11])
    return [[min(xs) * 1000.0, min(ys) * 1000.0, min(zs) * 1000.0],
            [max(xs) * 1000.0, max(ys) * 1000.0, max(zs) * 1000.0]]


def stem_for(doc, i):
    title = _safe(lambda: doc.Title, "model%d" % i)
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in title)[:60]
    return ("host_" if i == 0 else "link_") + safe


def export(doc, folder, probe, exclude_bics=(), detail="medium", group_share=True,
           props=True, props_limit_s=600):
    """Export the open model and every link it shows. Writes
    <folder>/fragments/*.lwkm (+ .props.json) and returns
    {"models": [manifest entries], "lwk_frame": {...}, "minutes": m}."""
    from Autodesk.Revit.DB import CustomExporter
    t0 = time.time()
    out_dir = os.path.join(folder, "fragments")
    probe.info("fast3d", "fast3d.py version %s" % __version__)
    view, hidden = export_view(doc, list(exclude_bics), detail)
    probe.info("fast3d", "export view ready (%s detail; hidden: %s)"
               % (detail, ", ".join(hidden) or "nothing"))
    run = Run(doc, stem_for, probe, group_share=group_share)
    try:
        ex = CustomExporter(doc, make_context(run))
        _safe(lambda: setattr(ex, "IncludeGeometricObjects", False))
        _safe(lambda: setattr(ex, "ShouldStopOnError", False))
        ex.Export(view)
    finally:
        drop_view(doc, view)
    t1 = time.time()
    if run.dup_links:
        probe.warn("fast3d", "%d link placement(s) sit exactly on another placement of the same "
                             "model (a duplicate link instance in Revit): drawn once"
                   % run.dup_links)
    probe.info("fast3d", "geometry read in %.1f min: %d model(s), %d triangles, %d family "
                         "placements reused, %d group-copy elements skipped"
               % ((t1 - t0) / 60.0, len(run.writers),
                  sum(w.stats["triangles"] for w in run.writers),
                  sum(w.stats["inst_skipped"] for w in run.writers),
                  sum(w.stats["elements_skipped"] for w in run.writers)))

    models = []
    t_props = time.time()
    for wi, w in enumerate(run.writers):
        try:
            path, size, summ = w.write(out_dir)
        except Exception as ex:
            probe.error("fast3d", "'%s' could not be written: %s" % (w.title, ex))
            continue
        probe.info("fast3d", "'%s': %s - %d elements, %d triangles, %d family types, "
                             "%d groups (%.1f MB)"
                   % (w.title, os.path.basename(path), summ["elements"], summ["triangles"],
                      summ["defs"], summ["groups"], size / 1048576.0))
        entry = {
            "name": w.title, "format": "lwkm",
            "fragments": "fragments/" + os.path.basename(path),
            "fragments_mb": round(size / 1048576.0, 2),
            "role": "host" if wi == 0 else "link",
            "coordinates": "lwk-host" if wi == 0 else "lwk-link",
            "instances": [],
        }
        if props:
            try:
                # one time budget for all the models together
                left = props_limit_s - (time.time() - t_props)
                pp = write_props(w, out_dir, probe, max(30, left))
                entry["props"] = "fragments/" + os.path.basename(pp)
            except Exception as ex:
                probe.warn("fast3d", "'%s': properties not written (%s)" % (w.title, ex))
        bx = w.box_m()
        if wi == 0 and bx:
            entry["bbox_mm"] = [[v * 1000.0 for v in bx[0]], [v * 1000.0 for v in bx[1]]]
        if wi > 0:
            for (k, m) in run.link_inst:
                if k == wi:
                    inst = {"transform_m": m}
                    if bx:
                        inst["bbox_mm"] = placed_box_mm(m, bx)
                    entry["instances"].append(inst)
            if not entry["instances"]:
                continue
        models.append(entry)
    frame_m, note = internal_to_shared(doc, probe)
    probe.info("fast3d", "internal -> shared coordinates: %s" % note)
    frame = {"internal_to_shared_mm": frame_m, "note": note,
             "center_internal_m": list(run.writers[0].offset) if run.writers else [0, 0, 0]}
    mins = (time.time() - t0) / 60.0
    probe.info("fast3d", "fast 3D export done in %.1f min" % mins)
    return {"models": models, "lwk_frame": frame, "minutes": round(mins, 2),
            "triangles": sum(w.stats["triangles"] for w in run.writers)}
