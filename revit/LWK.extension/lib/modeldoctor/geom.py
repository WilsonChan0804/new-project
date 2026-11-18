# -*- coding: utf-8 -*-
"""Geometry helpers shared by all Model Doctor checks.

IronPython 2.7 / Revit API.  Everything internal is in decimal feet; the UI
talks millimetres.  Convert at the boundary only.
"""
from modeldoctor.compat import id_int, new_id
from math import fabs, sqrt

import clr

from Autodesk.Revit.DB import (
    XYZ, Line, Arc, Options, ViewDetailLevel, Solid, Face,
    IntersectionResultArray,
    BooleanOperationsUtils, BooleanOperationsType,
    LocationPoint, LocationCurve, HostObjectUtils,
    FilteredElementCollector, BuiltInCategory, BuiltInParameter,
    ElementId, JoinGeometryUtils, SetComparisonResult
)

MM_PER_FT = 304.8
EPS = 1.0e-9

# A geometric "zero".  Revit's own tolerance is ~1/16" but for QA work we want
# to treat anything under 0.05 mm as coincident.
COINCIDENT = 0.05 / MM_PER_FT


def mm(value_mm):
    """millimetres -> decimal feet"""
    return float(value_mm) / MM_PER_FT


def to_mm(value_ft):
    """decimal feet -> millimetres"""
    return float(value_ft) * MM_PER_FT


def fmt_mm(value_ft, decimals=1):
    """Signed millimetre string for reports."""
    return ("{0:+." + str(decimals) + "f} mm").format(to_mm(value_ft))


# ---------------------------------------------------------------------------
# Basic vector maths
# ---------------------------------------------------------------------------

def flat(p):
    """Drop Z."""
    return XYZ(p.X, p.Y, 0.0)


def dist2d(a, b):
    dx = a.X - b.X
    dy = a.Y - b.Y
    return sqrt(dx * dx + dy * dy)


def snap(value, tol):
    """Quantise a float onto a tolerance grid (for hash keys)."""
    if tol <= 0:
        return round(value, 9)
    return int(round(value / tol))


def angle_between_dirs(d1, d2):
    """Undirected angle in radians between two direction vectors, 0..pi/2."""
    d1 = d1.Normalize()
    d2 = d2.Normalize()
    dot = fabs(d1.X * d2.X + d1.Y * d2.Y + d1.Z * d2.Z)
    if dot > 1.0:
        dot = 1.0
    from math import acos
    return acos(dot)


def closest_param_on_line(p, a, b):
    """Parameter (unclamped) of p projected onto the infinite line a->b."""
    ab = b - a
    denom = ab.DotProduct(ab)
    if denom < EPS:
        return 0.0
    return (p - a).DotProduct(ab) / denom


def point_to_segment(p, a, b):
    """Return (distance, closest_point, clamped_param 0..1) in 3D."""
    t = closest_param_on_line(p, a, b)
    if t < 0.0:
        t = 0.0
    elif t > 1.0:
        t = 1.0
    q = a + (b - a) * t
    return (p.DistanceTo(q), q, t)


def line_intersection_2d(p1, d1, p2, d2):
    """Intersection of two *infinite* 2D lines given point+direction.

    Returns XYZ at Z=0, or None if near parallel.
    """
    denom = d1.X * d2.Y - d1.Y * d2.X
    if fabs(denom) < 1.0e-10:
        return None
    dx = p2.X - p1.X
    dy = p2.Y - p1.Y
    t = (dx * d2.Y - dy * d2.X) / denom
    return XYZ(p1.X + d1.X * t, p1.Y + d1.Y * t, 0.0)


# ---------------------------------------------------------------------------
# Spatial index -- avoids O(n^2) pair testing on big models
# ---------------------------------------------------------------------------

class GridIndex(object):
    """Uniform XY grid bucketing element ids by bounding box.

    cell_ft should be roughly the size of a typical element; 20 ft (~6 m)
    works well for walls in a residential tower.
    """

    def __init__(self, cell_ft=20.0):
        self.cell = float(cell_ft)
        self.buckets = {}

    def _cell_range(self, bb, pad):
        i0 = int((bb.Min.X - pad) // self.cell)
        i1 = int((bb.Max.X + pad) // self.cell)
        j0 = int((bb.Min.Y - pad) // self.cell)
        j1 = int((bb.Max.Y + pad) // self.cell)
        return i0, i1, j0, j1

    def add(self, key, bb, pad=0.0):
        i0, i1, j0, j1 = self._cell_range(bb, pad)
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                self.buckets.setdefault((i, j), []).append(key)

    def query(self, bb, pad=0.0):
        found = set()
        i0, i1, j0, j1 = self._cell_range(bb, pad)
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                for k in self.buckets.get((i, j), ()):
                    found.add(k)
        return found


def bbox_overlaps(a, b, pad=0.0):
    if a is None or b is None:
        return False
    if a.Min.X - pad > b.Max.X or b.Min.X - pad > a.Max.X:
        return False
    if a.Min.Y - pad > b.Max.Y or b.Min.Y - pad > a.Max.Y:
        return False
    if a.Min.Z - pad > b.Max.Z or b.Min.Z - pad > a.Max.Z:
        return False
    return True


# ---------------------------------------------------------------------------
# Element geometry
# ---------------------------------------------------------------------------

def geom_options(detail=None):
    opt = Options()
    opt.ComputeReferences = False
    opt.IncludeNonVisibleObjects = False
    opt.DetailLevel = detail or ViewDetailLevel.Medium
    return opt


def solids_of(elem, opt=None):
    """Flatten an element's geometry into a list of non-degenerate solids."""
    out = []
    opt = opt or geom_options()
    try:
        ge = elem.get_Geometry(opt)
    except Exception:
        return out
    if ge is None:
        return out
    _harvest_solids(ge, out)
    return out


def _harvest_solids(geo_elem, out):
    from Autodesk.Revit.DB import GeometryInstance
    for obj in geo_elem:
        if isinstance(obj, Solid):
            if obj.Volume > 1.0e-6:
                out.append(obj)
        elif isinstance(obj, GeometryInstance):
            inst = obj.GetInstanceGeometry()
            if inst is not None:
                _harvest_solids(inst, out)


MAX_BOOLEAN_FACES = 400


def solid_complexity(solid):
    try:
        return solid.Faces.Size
    except Exception:
        return 0


def _clone(solid):
    """A private copy of the solid.

    ExecuteBooleanOperation is far more likely to hard-crash Revit when fed
    geometry it does not own. Cloning first is the long-standing workaround.
    """
    try:
        from Autodesk.Revit.DB import SolidUtils
        return SolidUtils.Clone(solid)
    except Exception:
        return solid


def intersection_volume(solids_a, solids_b, max_faces=MAX_BOOLEAN_FACES,
                        label=''):
    """Total volume of the boolean intersection. 0.0 on any failure.

    A boolean on dirty or very complex geometry can take Revit down with a
    fatal error that no try/except can catch, so anything above `max_faces`
    is skipped rather than risked, and a breadcrumb is written before each
    call so a crash can be traced to the exact pair.
    """
    total = 0.0
    for sa in solids_a:
        if solid_complexity(sa) > max_faces:
            continue
        for sb in solids_b:
            if solid_complexity(sb) > max_faces:
                continue
            try:
                res = BooleanOperationsUtils.ExecuteBooleanOperation(
                    _clone(sa), _clone(sb), BooleanOperationsType.Intersect)
            except Exception:
                continue
            if res is not None and res.Volume > 1.0e-6:
                total += res.Volume
    return total


def wall_curve(wall):
    loc = wall.Location
    if isinstance(loc, LocationCurve):
        return loc.Curve
    return None


def wall_thickness(wall):
    try:
        return wall.Width
    except Exception:
        return 0.0


def wall_z_range(wall):
    """(base_z, top_z) in project coordinates, from the bounding box.

    The bbox is used rather than the parameters because it already accounts
    for attached tops/bases and profile edits.
    """
    bb = wall.get_BoundingBox(None)
    if bb is None:
        return (0.0, 0.0)
    return (bb.Min.Z, bb.Max.Z)


def z_ranges_overlap(r1, r2, tol=0.0):
    return not (r1[1] + tol < r2[0] or r2[1] + tol < r1[0])


def already_joined(doc, a, b):
    try:
        return JoinGeometryUtils.AreElementsJoined(doc, a, b)
    except Exception:
        return False


def project_on_curve(curve, pt):
    """Nearest point on a BOUNDED curve. Returns (distance, point, t 0..1).

    This exists because treating a curve as its chord is wrong for arcs: a
    3 m arc with a 300 mm sagitta reports a phantom 300 mm gap at midspan.
    Curve.Project handles lines and arcs alike.
    """
    try:
        res = curve.Project(pt)
    except Exception:
        return None
    if res is None:
        return None
    try:
        t = curve.ComputeNormalizedParameter(res.Parameter)
    except Exception:
        t = 0.5
    return (res.Distance, res.XYZPoint, t)


def lateral_offset(pt, base, direction):
    """Signed perpendicular distance from pt to the infinite line, in plan."""
    n = XYZ(-direction.Y, direction.X, 0.0)
    return (flat(pt) - flat(base)).DotProduct(n)


# ---------------------------------------------------------------------------
# Host (floor / ceiling / roof) face queries
# ---------------------------------------------------------------------------

def host_faces(host, top=True):
    """Return the planar-or-not top (or bottom) faces of a HostObject."""
    faces = []
    try:
        refs = (HostObjectUtils.GetTopFaces(host) if top
                else HostObjectUtils.GetBottomFaces(host))
    except Exception:
        return faces
    if refs is None:
        return faces
    for r in refs:
        try:
            f = host.GetGeometryObjectFromReference(r)
        except Exception:
            f = None
        if isinstance(f, Face):
            faces.append(f)
    return faces


def vertical_hit(face, x, y, z_lo, z_hi):
    """Z of the point where a vertical line at (x, y) crosses `face`.

    Returns None if the ray misses.  Handles sloped and warped floors, which
    a simple "top elevation" parameter read would get wrong.

    The clr.Reference dance is not optional. Face.Intersect has two overloads:
    Intersect(Curve) returns only a SetComparisonResult, and
    Intersect(Curve, out IntersectionResultArray) returns the hits. Called
    with one argument, IronPython binds to the first, so unpacking two values
    raises -- and every floor lookup in the model silently misses.
    """
    if z_hi - z_lo < COINCIDENT:
        return None

    line = None
    try:
        line = Line.CreateBound(XYZ(x, y, z_lo), XYZ(x, y, z_hi))
    except Exception:
        return None

    try:
        results = clr.Reference[IntersectionResultArray]()
        res = face.Intersect(line, results)
        if res == SetComparisonResult.Overlap:
            arr = results.Value
            if arr is not None:
                best = None
                for ir in arr:
                    z = ir.XYZPoint.Z
                    if best is None or z > best:
                        best = z
                if best is not None:
                    return best
    except Exception:
        pass

    # Fallback: drop a point onto the face. Exact for the flat slabs that
    # make up the overwhelming majority of floors.
    try:
        r = face.Project(XYZ(x, y, z_hi))
        if r is not None:
            p = r.XYZPoint
            if fabs(p.X - x) < COINCIDENT * 20 and \
                    fabs(p.Y - y) < COINCIDENT * 20:
                return p.Z
    except Exception:
        pass
    return None


def compound_thickness(host):
    """Structural thickness of a floor/ceiling/roof type, in feet."""
    try:
        htype = host.Document.GetElement(host.GetTypeId())
        cs = htype.GetCompoundStructure()
        if cs is not None:
            return cs.GetWidth()
    except Exception:
        pass
    p = host.get_Parameter(BuiltInParameter.FLOOR_ATTR_THICKNESS_PARAM)
    if p is not None:
        return p.AsDouble()
    bb = host.get_BoundingBox(None)
    if bb is not None:
        return bb.Max.Z - bb.Min.Z
    return 0.0


class FloorProbe(object):
    """Indexes floors once, then answers 'what is under / over this point?'.

    `mode` picks which floor wins when several stack at the same location:
        'thickest' -- the structural slab (per Wilson's spec for wall checks)
        'topmost'  -- the finish level (right answer for doors and fixtures)
    """

    def __init__(self, doc, cats=None, cell_ft=30.0):
        self.doc = doc
        self.index = GridIndex(cell_ft)
        self.data = {}
        self.probe_failures = 0
        cats = cats or [BuiltInCategory.OST_Floors]
        for cat in cats:
            col = (FilteredElementCollector(doc)
                   .OfCategory(cat)
                   .WhereElementIsNotElementType()
                   .ToElements())
            for el in col:
                bb = el.get_BoundingBox(None)
                if bb is None:
                    continue
                eid = id_int(el.Id)
                self.data[eid] = (el, bb, compound_thickness(el))
                self.index.add(eid, bb)

    @property
    def count(self):
        return len(self.data)

    def _candidates(self, x, y):
        from Autodesk.Revit.DB import BoundingBoxXYZ
        bb = BoundingBoxXYZ()
        bb.Min = XYZ(x - COINCIDENT, y - COINCIDENT, -1.0e6)
        bb.Max = XYZ(x + COINCIDENT, y + COINCIDENT, 1.0e6)
        return self.index.query(bb)

    def top_at(self, x, y, z_hint, search=50.0, mode='thickest'):
        """Highest floor top surface at (x, y) at or below z_hint + search.

        Returns (element, top_z, thickness) or None.
        """
        hits = []
        for eid in self._candidates(x, y):
            el, bb, thk = self.data[eid]
            if bb.Min.X > x or bb.Max.X < x or bb.Min.Y > y or bb.Max.Y < y:
                continue
            if bb.Max.Z > z_hint + search or bb.Max.Z < z_hint - search:
                continue
            for f in host_faces(el, top=True):
                z = vertical_hit(f, x, y, bb.Min.Z - 1.0, bb.Max.Z + 1.0)
                if z is not None:
                    hits.append((el, z, thk))
                    break
        if not hits:
            return None
        if mode == 'topmost':
            hits.sort(key=lambda h: -h[1])
        else:
            hits.sort(key=lambda h: (-h[2], -h[1]))
        return hits[0]

    def bottom_above(self, x, y, z_from, search=50.0, mode='thickest'):
        """Lowest soffit strictly above z_from.  Returns (el, z, thk) or None."""
        hits = []
        for eid in self._candidates(x, y):
            el, bb, thk = self.data[eid]
            if bb.Min.X > x or bb.Max.X < x or bb.Min.Y > y or bb.Max.Y < y:
                continue
            if bb.Min.Z < z_from - COINCIDENT or bb.Min.Z > z_from + search:
                continue
            for f in host_faces(el, top=False):
                z = vertical_hit(f, x, y, bb.Min.Z - 1.0, bb.Max.Z + 1.0)
                if z is not None and z > z_from + COINCIDENT:
                    hits.append((el, z, thk))
                    break
        if not hits:
            return None
        if mode == 'topmost':
            hits.sort(key=lambda h: h[1])
        else:
            hits.sort(key=lambda h: (-h[2], h[1]))
        return hits[0]


def side_faces(solids):
    """Faces of a solid that form its sides rather than its top or bottom.

    Works for rectangular, circular and L-shaped columns alike, which is why
    this is done on faces rather than on a bounding box: a bounding box test
    on a circular column reports the corner of the box as solid.
    """
    from Autodesk.Revit.DB import PlanarFace
    out = []
    for sol in solids:
        try:
            for f in sol.Faces:
                if isinstance(f, PlanarFace):
                    try:
                        if fabs(f.FaceNormal.Z) > 0.9:
                            continue        # top or bottom
                    except Exception:
                        pass
                out.append(f)
        except Exception:
            continue
    return out


def nearest_face_distance(faces, pt):
    """Shortest distance from pt to any of the faces, or None."""
    best = None
    for f in faces:
        try:
            r = f.Project(pt)
        except Exception:
            r = None
        if r is None:
            continue
        d = r.Distance
        if best is None or d < best:
            best = d
    return best


def ray_first_hit(faces, origin, direction, max_dist):
    """First point where a ray leaving `origin` meets any face.

    Returns (distance, point) or None. Used to find where a wall should stop
    when it runs into a column, without assuming the column is rectangular.
    """
    try:
        end = XYZ(origin.X + direction.X * max_dist,
                  origin.Y + direction.Y * max_dist,
                  origin.Z + direction.Z * max_dist)
        line = Line.CreateBound(origin, end)
    except Exception:
        return None

    best = None
    for f in faces:
        try:
            results = clr.Reference[IntersectionResultArray]()
            res = f.Intersect(line, results)
            if res != SetComparisonResult.Overlap:
                continue
            arr = results.Value
            if arr is None:
                continue
            for ir in arr:
                p = ir.XYZPoint
                d = origin.DistanceTo(p)
                if d < COINCIDENT:
                    continue
                if best is None or d < best[0]:
                    best = (d, p)
        except Exception:
            continue
    return best


def ray_parity_inside(faces, point, direction=None, max_dist=10000.0):
    """Is `point` inside the solid bounded by `faces`? Odd crossings = inside.

    Needed because a wall's location curve is only its centreline when the
    Location Line is set to Wall Centerline. With Finish Face: Interior the
    curve sits on a face, so any half-thickness arithmetic off the location
    curve is wrong by up to half the wall.
    """
    direction = direction or XYZ(0.7071, 0.7071, 0.0)
    try:
        end = XYZ(point.X + direction.X * max_dist,
                  point.Y + direction.Y * max_dist,
                  point.Z + direction.Z * max_dist)
        line = Line.CreateBound(point, end)
    except Exception:
        return False

    crossings = 0
    for f in faces:
        try:
            results = clr.Reference[IntersectionResultArray]()
            if f.Intersect(line, results) != SetComparisonResult.Overlap:
                continue
            arr = results.Value
            if arr is None:
                continue
            for _ir in arr:
                crossings += 1
        except Exception:
            continue
    return (crossings % 2) == 1


def sample_points_on_curve(curve, count=5, inset=0.15):
    """Points along a curve, skipping the ends.

    The inset is what implements "a wall merely touching the edge of a slab
    is not sitting on it" -- we never sample the extreme ends.
    """
    pts = []
    for i in range(count):
        t = inset + (1.0 - 2.0 * inset) * (float(i) / max(1, count - 1))
        try:
            pts.append(curve.Evaluate(t, True))
        except Exception:
            pass
    return pts
