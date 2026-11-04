# -*- coding: utf-8 -*-
"""What a floor plan's route tool walks around: the plan cut of its walls,
doors, columns, stairs, furniture ... by category, on the sheet.

The viewer's Route tool (viewer/route.js) finds the shortest way between
two points of a plan - for travel distance, a dead end, staircase to
staircase, from the fireman's lift or the TRS. It needs to know where the
walls are and where the doors are, which the PDF cannot say (a door is
lines like any other). So each floor plan on a sheet is cut here at its
own cut plane, as Revit cuts it: every element's solids are triangulated
and the triangles met by the plane give short segments. Those segments,
in paper mm of the sheet and kept by category, go in one small file per
sheet (sheets/<name>.route.json), beside its PDF.

A wall's solid keeps its door openings, so with Doors left passable the
route goes through the doorway; ticked to block, the door leaf closes it.

Linked models are not cut (yet): the log says so when a plan shows one.

The slicing itself (slice_triangle, slice_triangles) is plain Python, so
it is tested without Revit (revit/tests/test_planroute.py).
"""
import time

# (name in the viewer, BuiltInCategory name): what the route can meet
CATEGORIES = (
    ("Walls", "OST_Walls"),
    ("Doors", "OST_Doors"),
    ("Windows", "OST_Windows"),
    ("Columns", "OST_Columns"),
    ("Structural Columns", "OST_StructuralColumns"),
    ("Stairs", "OST_Stairs"),
    ("Railings", "OST_StairsRailing"),
    ("Curtain Panels", "OST_CurtainWallPanels"),
    ("Curtain Mullions", "OST_CurtainWallMullions"),
    ("Furniture", "OST_Furniture"),
    ("Casework", "OST_Casework"),
    ("Plumbing Fixtures", "OST_PlumbingFixtures"),
    ("Specialty Equipment", "OST_SpecialityEquipment"),
    ("Mechanical Equipment", "OST_MechanicalEquipment"),
    ("Generic Models", "OST_GenericModel"),
)
# what blocks a route unless the person says otherwise (the viewer's ticks)
BLOCKING = ("Walls", "Columns", "Structural Columns", "Stairs", "Railings", "Curtain Panels",
            "Curtain Mullions", "Casework", "Plumbing Fixtures", "Specialty Equipment",
            "Mechanical Equipment", "Generic Models", "Windows")

MAX_SEGMENTS = 250000        # per sheet
BUDGET_S = 90.0              # per sheet
ROUND = 2                    # decimals of paper mm (0.01 mm)


def slice_triangle(a, b, c, z):
    """Where the plane at height z meets triangle a b c (points (x, y, z)):
    a segment ((x1, y1), (x2, y2)), or None. A triangle lying in the plane,
    or touching it at one corner, gives nothing; one with an edge on it
    gives that edge."""
    pts = (a, b, c)
    d = [p[2] - z for p in pts]
    eps = 1e-9
    on = [abs(x) <= eps for x in d]
    if all(on):
        return None
    if sum(on) == 2:
        p, q = [pts[i] for i in range(3) if on[i]]
        return ((p[0], p[1]), (q[0], q[1]))
    out = []
    for i in range(3):
        j = (i + 1) % 3
        di, dj = d[i], d[j]
        if on[i]:
            out.append((pts[i][0], pts[i][1]))
        elif not on[j] and (di < 0) != (dj < 0):
            t = di / (di - dj)
            p, q = pts[i], pts[j]
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    # dedupe (a corner on the plane is met by two edges)
    uniq = []
    for p in out:
        if not any(abs(p[0] - u[0]) < 1e-9 and abs(p[1] - u[1]) < 1e-9 for u in uniq):
            uniq.append(p)
    if len(uniq) != 2:
        return None
    return (uniq[0], uniq[1])


def slice_triangles(tris, z, to_paper=None, min_len=0.0):
    """Every segment of a list of triangles at height z, as a flat list
    [x1, y1, x2, y2, ...]; to_paper((x, y, z)) maps each end (default: as is).
    A segment shorter than min_len (after mapping) is dropped."""
    out = []
    for a, b, c in tris:
        s = slice_triangle(a, b, c, z)
        if s is None:
            continue
        p, q = s
        if to_paper:
            p, q = to_paper((p[0], p[1], z)), to_paper((q[0], q[1], z))
        if min_len and abs(p[0] - q[0]) + abs(p[1] - q[1]) < min_len:
            continue
        out.extend((round(p[0], ROUND), round(p[1], ROUND), round(q[0], ROUND), round(q[1], ROUND)))
    return out


def clip_to_rect(flat, rect, pad=2.0):
    """Only the segments with an end inside the viewport (crop) rectangle."""
    x, y, w, h = rect
    x0, y0, x1, y1 = x - pad, y - pad, x + w + pad, y + h + pad
    out = []
    for i in range(0, len(flat) - 3, 4):
        a, b, c, d = flat[i:i + 4]
        if (x0 <= a <= x1 and y0 <= b <= y1) or (x0 <= c <= x1 and y0 <= d <= y1):
            out.extend((a, b, c, d))
    return out


# ---------------------------------------------------------------- Revit

def _triangles_of(geo, out, limit):
    """The triangles (feet, (x, y, z)) of a GeometryElement, into out."""
    from Autodesk.Revit.DB import Solid, GeometryInstance, Mesh
    for g in geo:
        if len(out) > limit:
            return
        if isinstance(g, GeometryInstance):
            try:
                _triangles_of(g.GetInstanceGeometry(), out, limit)
            except Exception:
                pass
        elif isinstance(g, Solid):
            if g.Volume <= 1e-9:
                continue
            for f in g.Faces:
                try:
                    m = f.Triangulate()
                except Exception:
                    continue
                _mesh_tris(m, out)
        elif isinstance(g, Mesh):
            _mesh_tris(g, out)


def _mesh_tris(m, out):
    for i in range(m.NumTriangles):
        t = m.get_Triangle(i)
        p = [t.get_Vertex(k) for k in range(3)]
        out.append(tuple((v.X, v.Y, v.Z) for v in p))


def _bbox_spans(el, view, z_ft):
    """Does the element reach the cut plane at all? (cheap, before its geometry)"""
    try:
        bb = el.get_BoundingBox(None) or el.get_BoundingBox(view)
    except Exception:
        bb = None
    return bb is None or (bb.Min.Z - 1e-3 <= z_ft <= bb.Max.Z + 1e-3)


def plan_cut(doc, view, mapping, rect, probe=None, deadline=None, budget=MAX_SEGMENTS):
    """{category name: [x1, y1, x2, y2, ...] in paper mm} for one plan
    viewport, cut at its view range's cut plane; and a note for the log."""
    from Autodesk.Revit.DB import FilteredElementCollector, BuiltInCategory, Options, ViewDetailLevel
    from lwk_viewer import geom
    vr = view.GetViewRange()
    from Autodesk.Revit.DB import PlanViewPlane
    lvl = doc.GetElement(vr.GetLevelId(PlanViewPlane.CutPlane))
    z_ft = (lvl.ProjectElevation if lvl is not None else 0.0) + vr.GetOffset(PlanViewPlane.CutPlane)
    opts = Options()
    opts.ComputeReferences = False
    opts.IncludeNonVisibleObjects = False
    try:
        opts.DetailLevel = ViewDetailLevel.Fine
    except Exception:
        pass
    ft = geom.FT_MM

    def to_paper(p):
        return geom.model_to_paper(mapping, (p[0] * ft, p[1] * ft, p[2] * ft))

    out, n_el, n_seg, short = {}, 0, 0, False
    for name, bic_name in CATEGORIES:
        bic = getattr(BuiltInCategory, bic_name, None)
        if bic is None:
            continue
        try:
            els = FilteredElementCollector(doc, view.Id).OfCategory(bic).WhereElementIsNotElementType()
        except Exception:
            continue
        segs = []
        for el in els:
            if deadline and time.time() > deadline or n_seg > budget:
                short = True
                break
            if not _bbox_spans(el, view, z_ft):
                continue
            try:
                geo = el.get_Geometry(opts)
            except Exception:
                geo = None
            if geo is None:
                continue
            tris = []
            _triangles_of(geo, tris, 200000)
            s = slice_triangles(tris, z_ft, to_paper, min_len=0.02)
            if s:
                n_el += 1
                segs.extend(s)
                n_seg += len(s) // 4
        if segs:
            out[name] = clip_to_rect(segs, rect) if rect else segs
        if short:
            break
    note = "%d element(s), %d segment(s)%s" % (n_el, n_seg, " - stopped early (too big / too slow)" if short else "")
    return out, note


def sheet_routes(doc, plans, probe, number):
    """For build_sheet: {viewport element id: {"cut_mm", "cats": {...}}} of
    the floor plans on one sheet. plans: [(vp_element_id, view, mapping, rect)]."""
    out = {}
    t0 = time.time()
    deadline = t0 + BUDGET_S
    left = MAX_SEGMENTS
    for vpid, view, mapping, rect in plans:
        try:
            cats, note = plan_cut(doc, view, mapping, rect, probe, deadline, left)
        except Exception as ex:
            probe.info(number, "route plan of '%s' not cut: %s" % (view.Name, ex))
            continue
        if cats:
            out[str(vpid)] = {"view": view.Name, "cats": cats}
            left -= sum(len(v) // 4 for v in cats.values())
        probe.info(number, "route plan '%s': %s" % (view.Name, note))
        if time.time() > deadline or left <= 0:
            break
    if out:
        probe.info(number, "route plans cut in %.1f s" % (time.time() - t0))
    return out
