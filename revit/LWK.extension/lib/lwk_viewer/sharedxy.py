# -*- coding: utf-8 -*-
"""Shared coordinates, for drawing one model's rooms on another model's plans.

The Light & Vent check runs in the Calculation model; the plan sheets come
from the Layout model. Both sit on the same shared coordinates, so:
  - the check sends each room's outline, label point and floor level, and
    each window's position, in shared mm (add_shared);
  - the sheet export gives each plan viewport a shared -> paper transform
    (shared_to_paper);
and the viewer draws the Calculation model's rooms on the Layout model's
plans without matching rooms one by one.

A transform here is a dict {"o": [x, y, z], "bx": [...], "by": [...],
"bz": [...]} in mm: shared = o + x*bx + y*by + z*bz for an internal point
(x, y, z). Everything but from_doc runs without Revit (and is tested)."""

FT_MM = 304.8


def apply(m, p):
    """A point (mm) through the transform."""
    x, y, z = p[0], p[1], (p[2] if len(p) > 2 else 0.0)
    return [m["o"][i] + x * m["bx"][i] + y * m["by"][i] + z * m["bz"][i] for i in range(3)]


def invert(m):
    """The inverse transform."""
    a = [[m["bx"][r], m["by"][r], m["bz"][r]] for r in range(3)]     # columns are the bases
    det = (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
           - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
           + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]))
    if abs(det) < 1e-12:
        raise ValueError("the transform cannot be inverted")
    inv = [[0.0] * 3 for _ in range(3)]
    for r in range(3):
        for c in range(3):
            r1, r2 = [i for i in range(3) if i != c]
            c1, c2 = [i for i in range(3) if i != r]
            minor = a[r1][c1] * a[r2][c2] - a[r1][c2] * a[r2][c1]
            inv[r][c] = (-1) ** (r + c) * minor / det
    o = [-sum(inv[r][k] * m["o"][k] for k in range(3)) for r in range(3)]
    return {"o": o, "bx": [inv[r][0] for r in range(3)], "by": [inv[r][1] for r in range(3)],
            "bz": [inv[r][2] for r in range(3)]}


def choose(fwd, internal_pt, shared_pt, tol_mm=1.0):
    """Revit's location transform, or its inverse: the one taking a known
    point's internal position to its shared one (the survey point). None
    when neither does."""
    for m in (fwd, invert(fwd)):
        q = apply(m, internal_pt)
        if all(abs(q[i] - shared_pt[i]) <= tol_mm for i in range(3)):
            return m
    return None


def _from_revit(t):
    o = t.Origin
    return {"o": [o.X * FT_MM, o.Y * FT_MM, o.Z * FT_MM],
            "bx": [t.BasisX.X, t.BasisX.Y, t.BasisX.Z],
            "by": [t.BasisY.X, t.BasisY.Y, t.BasisY.Z],
            "bz": [t.BasisZ.X, t.BasisZ.Y, t.BasisZ.Z]}


def from_doc(doc):
    """This model's internal -> shared transform (mm), and how it was
    decided ("survey point" or "assumed")."""
    t = _from_revit(doc.ActiveProjectLocation.GetTotalTransform())
    try:
        from Autodesk.Revit.DB import BasePoint
        sp = BasePoint.GetSurveyPoint(doc)
        pos, sh = sp.Position, sp.SharedPosition
        got = choose(t, [pos.X * FT_MM, pos.Y * FT_MM, pos.Z * FT_MM], [sh.X * FT_MM, sh.Y * FT_MM, sh.Z * FT_MM])
        if got is not None:
            return got, "survey point"
    except Exception:
        pass
    # Revit before 2020 (no SharedPosition): the location transform takes
    # shared to internal, so internal -> shared is its inverse
    return invert(t), "assumed"


def _r(v, nd=1):
    return round(v, nd)


def add_shared(rows, m):
    """The Light & Vent rows with their places in shared mm: loops_sh,
    label_sh, level_sh_mm, and each window's pos_sh."""
    for r in rows:
        z = r.get("z_mm") or 0.0
        r["loops_sh"] = [[[_r(q[0]), _r(q[1])] for q in (apply(m, (p[0], p[1], z)) for p in lp)]
                         for lp in r.get("loops_mm") or []]
        lab = r.get("label_mm")
        r["label_sh"] = [_r(c) for c in apply(m, (lab[0], lab[1], z))[:2]] if lab else None
        r["level_sh_mm"] = None if r.get("z_mm") is None else _r(apply(m, (lab or [0, 0])[:2] + [z])[2])
        for w in r.get("windows") or []:
            p = w.get("pos")
            w["pos_sh"] = [_r(c) for c in apply(m, p)] if p else None
    return rows


def shared_to_paper(m, model_to_paper, z_mm=0.0, near=(0.0, 0.0)):
    """A plan viewport's shared -> paper transform, as a 2 x 3 affine
    [[a, b, c], [d, e, f]] (u = a x + b y + c, v = d x + e y + f, shared mm
    to paper mm). m: the model's internal -> shared transform;
    model_to_paper(point_mm) -> [u, v]: the viewport's own mapping of this
    model's points; near: an internal point in the view (the numbers stay
    small around it)."""
    inv = invert(m)
    s0 = apply(m, (near[0], near[1], z_mm))
    pts = [s0, [s0[0] + 1000.0, s0[1], s0[2]], [s0[0], s0[1] + 1000.0, s0[2]]]
    uv = [model_to_paper(apply(inv, s)) for s in pts]
    a, d = (uv[1][0] - uv[0][0]) / 1000.0, (uv[1][1] - uv[0][1]) / 1000.0
    b, e = (uv[2][0] - uv[0][0]) / 1000.0, (uv[2][1] - uv[0][1]) / 1000.0
    c, f = uv[0][0] - a * s0[0] - b * s0[1], uv[0][1] - d * s0[0] - e * s0[1]
    return [[a, b, c], [d, e, f]]
