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


def build(site, masses, ground_z, street_axis=None, streets=None, project="", model="", by="", at=""):
    return {
        "version": 1, "units": "m", "project": project, "model": model, "by": by, "at": at,
        "ground_z": round(ground_z, 4),
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
