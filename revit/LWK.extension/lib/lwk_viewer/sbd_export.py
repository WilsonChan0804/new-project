# -*- coding: utf-8 -*-
"""SBD Export: the masses and the site of a model, for the SBD (PNAP APP-152)
check of the LWK Viewer (server/sbd). Revit only collects the shapes; the
assessment runs on the server, for all three height zones, from the 3D
masses - no Filled Regions to draw, no 2D picks per zone.

Writes sbd.json (metres, the model's internal coordinates):
  ground_z    the zones' ground: the chosen level's elevation
  site        the subject site boundary (a Property Line, or lines picked)
  masses      each Mass element as a triangle mesh (closed, shared points)
  street_axis a line along the street - Projection Plane X (optional)
  streets     for Case 1 (street canyon U): each street's centreline and the
              opposite site's boundary (optional)

Everything that needs Revit is imported inside the function that uses it, so
the rest (and its tests) runs without Revit.
"""

__version__ = "2026-11-03"

import math

FT_M = 0.3048
POINT_KEY_M = 1e-4         # vertices closer than 0.1 mm are one
CLOSE_TOL_M = 0.01         # a site boundary must close within 10 mm


# ----------------------------------------------------------- pure helpers

class Mesh(object):
    """Triangles with shared points (so the server can follow the edges)."""

    def __init__(self):
        self.verts = []
        self.tris = []
        self._idx = {}

    def new_part(self):
        """Points are shared within a solid only: two forms of one mass that
        touch (a tower on a podium) stay separate solids for the server."""
        self._idx = {}

    def point(self, x, y, z):
        k = (int(round(x / POINT_KEY_M)), int(round(y / POINT_KEY_M)), int(round(z / POINT_KEY_M)))
        i = self._idx.get(k)
        if i is None:
            i = len(self.verts)
            self._idx[k] = i
            self.verts.append([round(x, 4), round(y, 4), round(z, 4)])
        return i

    def tri(self, a, b, c):
        i, j, k = self.point(*a), self.point(*b), self.point(*c)
        if i != j and j != k and i != k:
            self.tris.append([i, j, k])


def chain(segments, tol=CLOSE_TOL_M):
    """Order line segments [((x, y), (x, y))] into one closed loop of points.
    -> (points, gap): gap is how far the chain is from closing (metres);
    None when the segments do not make one chain."""
    segs = [list(s) for s in segments if s and math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) > 1e-9]
    if not segs:
        return None, None
    loop = [segs[0][0], segs[0][1]]
    rest = segs[1:]
    while rest:
        end = loop[-1]
        best = None
        for n, s in enumerate(rest):
            for flip in (0, 1):
                p = s[flip]
                d = math.hypot(p[0] - end[0], p[1] - end[1])
                if best is None or d < best[0]:
                    best = (d, n, flip)
        d, n, flip = best
        if d > max(tol * 50, 0.5):
            return None, None              # a piece not joined to the rest
        s = rest.pop(n)
        loop.append(s[1 - flip])
    gap = math.hypot(loop[0][0] - loop[-1][0], loop[0][1] - loop[-1][1])
    if gap <= tol:
        loop.pop()
    return loop, gap


# ------------------------------------------------- streets from Floor slabs
# A street is a Floor of a type named "... Street ...", drawn from street
# boundary to street boundary. Its outline is a strip: two long sides and
# two short ends. The centreline is half-way between the long sides; the
# side away from the site is the opposite site's boundary (Case 1 U).

def _len(a, b):
    return math.hypot(b[0] - a[0], b[1] - a[1])


def loop_area(loop):
    s = 0.0
    n = len(loop)
    for i in range(n):
        x1, y1 = loop[i]
        x2, y2 = loop[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return s * 0.5


def _chain_len(ch):
    return sum(_len(ch[i], ch[i + 1]) for i in range(len(ch) - 1))


def _at(ch, s):
    """The point at arc length s along a polyline."""
    acc = 0.0
    for i in range(len(ch) - 1):
        d = _len(ch[i], ch[i + 1])
        if acc + d >= s or i == len(ch) - 2:
            t = 0.0 if d < 1e-12 else max(0.0, min(1.0, (s - acc) / d))
            return (ch[i][0] + (ch[i + 1][0] - ch[i][0]) * t, ch[i][1] + (ch[i + 1][1] - ch[i][1]) * t)
        acc += d
    return ch[-1]


def strip_sides(loop):
    """The two long sides of a strip outline -> (side_a, side_b), both
    running from the same end to the other; None when it is not a strip.
    The ends are the two short edges whose middles are farthest apart."""
    n = len(loop)
    if n < 4:
        return None
    per = sum(_len(loop[i], loop[(i + 1) % n]) for i in range(n))
    width = 2.0 * abs(loop_area(loop)) / max(per, 1e-9)          # about the street's width
    # an end is about as long as the street is wide (not a short piece of a
    # curved side)
    short = [i for i in range(n) if 0.4 * width <= _len(loop[i], loop[(i + 1) % n]) <= max(3.0 * width, 1e-6)]
    best = None
    for a in short:
        for b in short:
            if b <= a or (b - a) % n in (1, n - 1):
                continue
            ma = ((loop[a][0] + loop[(a + 1) % n][0]) / 2, (loop[a][1] + loop[(a + 1) % n][1]) / 2)
            mb = ((loop[b][0] + loop[(b + 1) % n][0]) / 2, (loop[b][1] + loop[(b + 1) % n][1]) / 2)
            d = _len(ma, mb)
            if best is None or d > best[0]:
                best = (d, a, b)
    if best is None:
        return None
    _, a, b = best
    # side A: after end a up to end b; side B: after end b back to end a, reversed
    side_a = [loop[(a + 1 + k) % n] for k in range((b - a) % n)]
    side_b = [loop[(b + 1 + k) % n] for k in range((a - b) % n)]
    side_b.reverse()
    if len(side_a) < 2 or len(side_b) < 2:
        return None
    return side_a, side_b


def strip_centreline(loop, step=1.0):
    """The centreline of a street outline: half-way between its long sides,
    every `step` metres -> (centreline, side_a, side_b) or None."""
    sides = strip_sides(loop)
    if not sides:
        return None
    a, b = sides
    la, lb = _chain_len(a), _chain_len(b)
    n = max(2, int(math.ceil(max(la, lb) / step)) + 1)
    cl = []
    for i in range(n):
        t = i / float(n - 1)
        p, q = _at(a, t * la), _at(b, t * lb)
        cl.append(((p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0))
    return cl, a, b


def near_far(side_a, side_b, site):
    """Which long side faces the site -> (near, far)."""
    def dist(ch):
        return sum(min(_len(p, s) for s in site) for p in ch) / float(len(ch))
    return (side_a, side_b) if dist(side_a) <= dist(side_b) else (side_b, side_a)


def _seg_dist(p, a, b):
    ab = (b[0] - a[0], b[1] - a[1])
    L = ab[0] * ab[0] + ab[1] * ab[1]
    t = 0.0 if L < 1e-12 else max(0.0, min(1.0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / L))
    return _len(p, (a[0] + ab[0] * t, a[1] + ab[1] * t))


def loop_gap(a, b):
    """The smallest distance between two outlines (their points to the
    other's edges)."""
    best = float("inf")
    for P, Q in ((a, b), (b, a)):
        for p in P:
            for i in range(len(Q)):
                best = min(best, _seg_dist(p, Q[i], Q[(i + 1) % len(Q)]))
    return best


def mean_level(floors, site, reach=30.0):
    """The street level: the area-weighted mean top level of the street
    slabs within 30 m of the site (all of them when none is that near).
    floors: [{"loop", "z", "area"}] -> metres, or None."""
    near = [f for f in floors if loop_gap(f["loop"], site) <= reach] or list(floors)
    tot = sum(f["area"] for f in near)
    if not near or tot <= 0:
        return None
    return sum(f["z"] * f["area"] for f in near) / tot


def street_from_floor(f, site):
    """A street for the export from a street slab: its centreline, its side
    away from the site (the opposite boundary) and its outline."""
    r = strip_centreline(f["loop"])
    if not r:
        return None
    cl, a, b = r
    near, far = near_far(a, b, site)
    rnd = lambda pts: [[round(x, 4), round(y, 4)] for x, y in pts]
    return {"name": f.get("name") or "Street", "centreline": rnd(cl), "opposite": rnd(far),
            "outline": rnd(f["loop"]), "level": round(f["z"], 4),
            "length_m": round(_chain_len(cl), 2), "width_m": round(abs(loop_area(f["loop"])) / max(_chain_len(cl), 1e-9), 2)}


def frontage_axis(streets, site, reach=30.0):
    """Axis 1: along the street that fronts the site the longest (the length
    of its centreline within 30 m of the site) -> [[x, y], [x, y]] or None."""
    best = None
    for s in streets:
        cl = s["centreline"]
        front = sum(_len(cl[i], cl[i + 1]) for i in range(len(cl) - 1)
                    if min(_seg_dist(cl[i], site[k], site[(k + 1) % len(site)]) for k in range(len(site))) <= reach)
        if best is None or front > best[0]:
            best = (front, s)
    if not best or best[0] <= 0:
        return None
    cl = best[1]["centreline"]
    return [cl[0], cl[-1]]


def build(site, masses, ground_z, street_axis=None, streets=None, project="", model="", by="", at="",
          ground_source=""):
    return {
        "version": 1, "units": "m", "project": project, "model": model, "by": by, "at": at,
        "ground_z": round(ground_z, 4), "ground_source": ground_source,
        "site": [[round(x, 4), round(y, 4)] for x, y in site],
        "masses": [{"id": m["id"], "name": m["name"], "verts": m["mesh"].verts, "tris": m["mesh"].tris} for m in masses],
        "street_axis": street_axis, "streets": streets or [], "corridor": None,
    }


# ----------------------------------------------------------------- Revit

def _xy(p):
    return (p.X * FT_M, p.Y * FT_M)


def mass_meshes(doc):
    """[{"id", "name", "mesh"}] of the model's Mass elements (in-place masses
    and Mass family instances), from their solids."""
    from Autodesk.Revit.DB import (FilteredElementCollector, BuiltInCategory, Options, ViewDetailLevel,
                                   Solid, GeometryInstance)
    opts = Options()
    opts.DetailLevel = ViewDetailLevel.Fine
    out = []
    els = FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Mass).WhereElementIsNotElementType().ToElements()
    for el in els:
        mesh = Mesh()

        def take(geo):
            for g in geo:
                if isinstance(g, Solid):
                    if g.Volume <= 1e-9:
                        continue
                    mesh.new_part()
                    for face in g.Faces:
                        m = face.Triangulate()
                        for i in range(m.NumTriangles):
                            t = m.get_Triangle(i)
                            pts = [t.get_Vertex(k) for k in range(3)]
                            mesh.tri(*[(p.X * FT_M, p.Y * FT_M, p.Z * FT_M) for p in pts])
                elif isinstance(g, GeometryInstance):
                    take(g.GetInstanceGeometry())
        geo = el.get_Geometry(opts)
        if geo is not None:
            take(geo)
        if mesh.tris:
            name = el.Name or ""
            try:
                name = (el.Symbol.FamilyName + " : " + el.Name) if hasattr(el, "Symbol") and el.Symbol else name
            except Exception:
                pass
            out.append({"id": str(el.Id.IntegerValue if hasattr(el.Id, "IntegerValue") else el.Id.Value),
                        "name": name, "mesh": mesh})
    return out


def _type_name(doc, el):
    t = doc.GetElement(el.GetTypeId())
    if t is None:
        return ""
    try:
        from Autodesk.Revit.DB import Element
        return Element.Name.__get__(t) or ""
    except Exception:
        try:
            return t.Name or ""
        except Exception:
            return ""


def street_floors(doc, word="street"):
    """[{"id", "name", "loop", "z", "area"}] of the Floors whose type name has
    "street" in it: the outline of each top face (metres), its mean level
    and its area."""
    from Autodesk.Revit.DB import FilteredElementCollector, Floor, HostObjectUtils
    out = []
    for fl in FilteredElementCollector(doc).OfClass(Floor).WhereElementIsNotElementType():
        tn = _type_name(doc, fl)
        if word not in tn.lower():
            continue
        try:
            refs = HostObjectUtils.GetTopFaces(fl)
        except Exception:
            refs = []
        for ref in refs:
            face = fl.GetGeometryObjectFromReference(ref)
            if face is None:
                continue
            best = None
            for cl in face.GetEdgesAsCurveLoops():
                pts, zs = [], []
                for c in cl:
                    for p in c.Tessellate():
                        q = (p.X * FT_M, p.Y * FT_M)
                        if not pts or _len(pts[-1], q) > 1e-4:
                            pts.append(q)
                            zs.append(p.Z * FT_M)
                if len(pts) > 2 and _len(pts[0], pts[-1]) < 1e-4:
                    pts.pop()
                    zs.pop()
                if len(pts) >= 3 and (best is None or abs(loop_area(pts)) > abs(loop_area(best[0]))):
                    best = (pts, zs)
            if best:
                name = tn
                try:
                    mark = fl.LookupParameter("Mark")
                    if mark and mark.AsString():
                        name = mark.AsString()
                except Exception:
                    pass
                out.append({"id": str(fl.Id.IntegerValue if hasattr(fl.Id, "IntegerValue") else fl.Id.Value),
                            "name": name, "loop": best[0], "z": sum(best[1]) / len(best[1]),
                            "area": abs(loop_area(best[0]))})
    return out


def property_line_loops(doc):
    """[(name, [(x, y)], gap)] of the model's Property Lines."""
    from Autodesk.Revit.DB import FilteredElementCollector, BuiltInCategory, Options, Curve
    out = []
    for el in FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_SiteProperty).WhereElementIsNotElementType():
        geo = el.get_Geometry(Options())
        segs = []
        if geo is None:
            continue
        for g in geo:
            if isinstance(g, Curve):
                pts = [_xy(p) for p in g.Tessellate()]
                segs += [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
        loop, gap = chain(segs)
        if loop and len(loop) >= 3:
            out.append((el.Name or "Property Line", loop, gap))
    return out


def curves_loop(curves):
    segs = []
    for c in curves:
        pts = [_xy(p) for p in c.Tessellate()]
        segs += [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    return chain(segs)


def curves_polyline(curves):
    """Picked lines in order, as one polyline (not closed)."""
    segs = []
    for c in curves:
        pts = [_xy(p) for p in c.Tessellate()]
        segs += [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    loop, gap = chain(segs, tol=-1)
    return loop
