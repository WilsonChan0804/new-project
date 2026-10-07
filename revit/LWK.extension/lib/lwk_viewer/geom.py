# -*- coding: utf-8 -*-
"""Model <-> sheet-paper transforms for the viewer export pipeline.

Revit hands us decimal feet. We emit millimetres, because that is what the
PDF page and the web viewer both work in.

Paper coordinates are measured from the LOWER-LEFT CORNER OF THE TITLEBLOCK,
not from the Revit sheet origin, because the titleblock corner is the only
thing that reliably corresponds to the corner of the exported PDF page.
"""


# Printed by the auto-export buttons, so a stale copy is obvious.
__version__ = "2026-09-27f"

from Autodesk.Revit.DB import XYZ, ViewportRotation

FT_MM = 304.8

# Tolerance when deciding whether a viewport box outline equals the crop
# rectangle. 0.5 mm on paper is well below any real title height.
TOL_MM = 0.5


def ft_mm(v):
    return v * FT_MM


def xyz_mm(p):
    return [p.X * FT_MM, p.Y * FT_MM, p.Z * FT_MM]


def rotation_name(vp):
    """ViewportRotation.None is unusable from Python (None is a keyword),
    so test the two named rotations and treat everything else as unrotated."""
    r = vp.Rotation
    if r == ViewportRotation.Clockwise:
        return "Clockwise"
    if r == ViewportRotation.Counterclockwise:
        return "Counterclockwise"
    return "None"


def crop_paper_size_mm(view):
    """Size the crop region occupies on paper, in mm, before any rotation."""
    cb = view.CropBox
    s = float(view.Scale)
    return (ft_mm(cb.Max.X - cb.Min.X) / s,
            ft_mm(cb.Max.Y - cb.Min.Y) / s)


TOL_FT = 1e-3

# A view title is a thin strip. Slack up to this much is credibly a title;
# beyond it, something structural is going on and the position is a guess.
LABEL_MAX_MM = 25.0


def annotation_rect_local(view):
    """The annotation crop rectangle, in the same coordinates as CropBox.

    A viewport's box on the sheet follows the ANNOTATION crop, but
    view.CropBox is the MODEL crop. On elevations especially, level tags
    and datum text push the annotation crop well outside the model crop,
    which is what produces tens of millimetres of unexplained slack.

    Revit does not document whether GetAnnotationCropShape returns points
    in model space or in crop-local space, so both readings are tested and
    the one that actually contains the crop box is kept -- the annotation
    crop always encloses the model crop, so that test is decisive.
    """
    try:
        mgr = view.GetCropRegionShapeManager()
        if not mgr.CanHaveAnnotationCrop or not mgr.AnnotationCropActive:
            return None
        loop = mgr.GetAnnotationCropShape()
    except Exception:
        return None
    if loop is None:
        return None

    pts = []
    try:
        for crv in loop:
            pts.append(crv.GetEndPoint(0))
    except Exception:
        return None
    if len(pts) < 3:
        return None

    cb = view.CropBox
    inv = cb.Transform.Inverse

    for space, conv in (("crop_local", lambda p: p),
                        ("model", lambda p: inv.OfPoint(p))):
        try:
            xs = [conv(p).X for p in pts]
            ys = [conv(p).Y for p in pts]
        except Exception:
            continue
        r = (min(xs), min(ys), max(xs), max(ys))
        if (r[0] <= cb.Min.X + TOL_FT and r[1] <= cb.Min.Y + TOL_FT and
                r[2] >= cb.Max.X - TOL_FT and r[3] >= cb.Max.Y - TOL_FT):
            return r, space
    return None


def crop_rect_on_sheet(vp, view, origin_ft):
    """Where the crop region sits on the page.

    Returns ((x, y, w, h) in mm from the paper origin, diagnostics dict).

    The viewport box is the annotation crop plus the view title. We anchor
    the largest rectangle we can account for -- the annotation crop if we
    can read it, otherwise the model crop -- inside the box, then step in
    to the model crop by a known offset. Whatever is left over is the
    title, and its size is the worst-case positional error, which is
    recorded rather than hidden.
    """
    box = vp.GetBoxOutline()
    bmin, bmax = box.MinimumPoint, box.MaximumPoint

    bx = ft_mm(bmin.X - origin_ft.X)
    by = ft_mm(bmin.Y - origin_ft.Y)
    bw = ft_mm(bmax.X - bmin.X)
    bh = ft_mm(bmax.Y - bmin.Y)

    cb = view.CropBox
    s = float(view.Scale)
    rot = rotation_name(vp)

    w, h = crop_paper_size_mm(view)
    if rot != "None":
        w, h = h, w

    diag = {
        "box_mm": [bx, by, bw, bh],
        "crop_size_mm": [w, h],
        "slack_mm": [bw - w, bh - h],
        "rotation": rot,
    }

    # Reference rectangle: what we expect the box to contain, and how far
    # the model crop sits inside it.
    ref_w, ref_h, dx, dy = w, h, 0.0, 0.0
    ann = annotation_rect_local(view) if rot == "None" else None
    if ann:
        (amnx, amny, amxx, amxy), space = ann
        ref_w = ft_mm(amxx - amnx) / s
        ref_h = ft_mm(amxy - amny) / s
        dx = ft_mm(cb.Min.X - amnx) / s
        dy = ft_mm(cb.Min.Y - amny) / s
        diag["annotation_crop"] = {
            "space": space,
            "size_mm": [ref_w, ref_h],
            "crop_inset_mm": [dx, dy],
        }
    elif rot != "None":
        diag["annotation_crop"] = "skipped: rotated viewport not handled yet"

    lw = bw - ref_w
    lh = bh - ref_h
    diag["title_slack_mm"] = [lw, lh]

    # Exact: the box is the reference rectangle, nothing else in it.
    if abs(lw) <= TOL_MM and abs(lh) <= TOL_MM:
        diag["anchor"] = "annotation_crop" if ann else "box_equals_crop"
        diag["confidence"] = "exact"
        diag["max_position_error_mm"] = 0.0
        return (bx + dx, by + dy, w, h), diag

    # Otherwise the title extends the box. Anchor the reference rectangle
    # in whichever corner sits furthest from the title.
    try:
        lbl = vp.GetLabelOutline()
        lcx = ft_mm((lbl.MinimumPoint.X + lbl.MaximumPoint.X) / 2.0 - origin_ft.X)
        lcy = ft_mm((lbl.MinimumPoint.Y + lbl.MaximumPoint.Y) / 2.0 - origin_ft.Y)
        diag["label_center_mm"] = [lcx, lcy]
    except Exception as ex:
        lcx, lcy = bx + bw / 2.0, by - 10.0
        diag["label_center_mm"] = None
        diag["label_error"] = str(ex)

    best = None
    for cx, cy in ((bx, by),
                   (bx + bw - ref_w, by),
                   (bx, by + bh - ref_h),
                   (bx + bw - ref_w, by + bh - ref_h)):
        d = (cx + ref_w / 2.0 - lcx) ** 2 + (cy + ref_h / 2.0 - lcy) ** 2
        if best is None or d > best[0]:
            best = (d, cx, cy)

    err = max(abs(lw), abs(lh))
    diag["anchor"] = ("annotation_crop_corner" if ann
                      else "crop_corner_away_from_label")
    diag["max_position_error_mm"] = err
    diag["confidence"] = "bounded" if err <= LABEL_MAX_MM else "guessed"
    return (best[1] + dx, best[2] + dy, w, h), diag


def exact_mapping(vp, view, origin_ft):
    """Where the crop sits on the sheet, as Revit states it - no inference.

    crop_rect_on_sheet works it out from the viewport's outer box, which
    also holds grid bubbles, dimensions and the title, and then guesses the
    corner the crop sits in. Checked against grid bubbles in the PDFs of
    STS, that guess put some plans 1-26 mm off on paper - 2.6 m in the
    model on TRF +130.60.

    Revit 2022+ gives the transforms directly: model -> the view's
    projection (View.GetModelToProjectionTransforms) and projection ->
    sheet (Viewport.GetProjectionToSheetTransform). Three corners of the
    crop are carried through them to the sheet, and the paper-to-model map
    is solved from those three pairs, so no transform ever has to be
    inverted. Returns (rect_mm, mapping, diag), or None to fall back:
    older Revit, or a crop split into several regions, which has one
    transform per region.
    """
    try:
        tws = view.GetModelToProjectionTransforms()
        p2s = vp.GetProjectionToSheetTransform()
    except Exception:
        return None
    if tws is None or tws.Count != 1:
        return None
    m2p = tws[0].GetModelToProjectionTransform()

    cb = view.CropBox
    t = cb.Transform
    corners_local = (XYZ(cb.Min.X, cb.Min.Y, 0.0), XYZ(cb.Max.X, cb.Min.Y, 0.0),
                     XYZ(cb.Min.X, cb.Max.Y, 0.0), XYZ(cb.Max.X, cb.Max.Y, 0.0))
    model = [t.OfPoint(p) for p in corners_local]
    sheet = [p2s.OfPoint(m2p.OfPoint(p)) for p in model]
    paper = [(ft_mm(s.X - origin_ft.X), ft_mm(s.Y - origin_ft.Y)) for s in sheet]

    # model = origin + u * ex + v * ey, from corners 0, 1, 2
    (u0, v0), (u1, v1), (u2, v2) = paper[0], paper[1], paper[2]
    m0, m1, m2 = [xyz_mm(p) for p in model[:3]]
    det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)
    if abs(det) < 1e-9:
        return None
    ex, ey = [], []
    for i in range(3):
        a, b = m1[i] - m0[i], m2[i] - m0[i]
        # solve [du1 du2; dv1 dv2] [ex; ey] = [a; b]
        ex.append(((v2 - v0) * a - (v1 - v0) * b) / det)
        ey.append((-(u2 - u0) * a + (u1 - u0) * b) / det)
    origin = [m0[i] - u0 * ex[i] - v0 * ey[i] for i in range(3)]

    # the fourth corner is not used to solve, so it checks the result
    u3, v3 = paper[3]
    m3 = xyz_mm(model[3])
    pred = [origin[i] + u3 * ex[i] + v3 * ey[i] for i in range(3)]
    check = max(abs(pred[i] - m3[i]) for i in range(3))

    us = [p[0] for p in paper]
    vs = [p[1] for p in paper]
    rect = (min(us), min(vs), max(us) - min(us), max(vs) - min(vs))
    d = view.ViewDirection
    mapping = {
        "origin": origin, "x_axis": ex, "y_axis": ey,
        "normal": [d.X, d.Y, d.Z],
        "scale_check": [sum(c * c for c in ex) ** 0.5, sum(c * c for c in ey) ** 0.5],
    }
    diag = {"anchor": "revit_transforms", "confidence": "exact",
            "max_position_error_mm": 0.0, "fourth_corner_check_mm": round(check, 3),
            "rotation": rotation_name(vp)}
    return rect, mapping, diag


def paper_to_model(vp, view, rect_mm):
    """The affine map the web viewer consumes.

    model_mm = origin + u * x_axis + v * y_axis

    where u, v are paper millimetres from the paper origin. |x_axis| and
    |y_axis| both equal the view scale, which is a cheap sanity check.
    """
    cb = view.CropBox
    t = cb.Transform
    s = float(view.Scale)

    # Model feet travelled per millimetre of paper.
    k = s / FT_MM
    bx, by = t.BasisX, t.BasisY

    rot = rotation_name(vp)
    if rot == "Clockwise":
        ex, ey = by.Multiply(k), bx.Multiply(-k)
    elif rot == "Counterclockwise":
        ex, ey = by.Multiply(-k), bx.Multiply(k)
    else:
        ex, ey = bx.Multiply(k), by.Multiply(k)

    centre_local = XYZ((cb.Min.X + cb.Max.X) / 2.0,
                       (cb.Min.Y + cb.Max.Y) / 2.0,
                       0.0)
    centre_model = t.OfPoint(centre_local)

    x, y, w, h = rect_mm
    ux, uy = x + w / 2.0, y + h / 2.0
    origin = centre_model.Subtract(ex.Multiply(ux)).Subtract(ey.Multiply(uy))

    d = view.ViewDirection
    return {
        "origin": xyz_mm(origin),
        "x_axis": xyz_mm(ex),
        "y_axis": xyz_mm(ey),
        "normal": [d.X, d.Y, d.Z],
        "scale_check": [
            (sum(c * c for c in xyz_mm(ex))) ** 0.5,
            (sum(c * c for c in xyz_mm(ey))) ** 0.5,
        ],
    }


def model_to_paper(mapping, point_mm):
    """Inverse of the above, on plain lists. x_axis and y_axis are
    orthogonal, so the projection is a scaled dot product."""
    o = mapping["origin"]
    ex, ey = mapping["x_axis"], mapping["y_axis"]
    d = [point_mm[i] - o[i] for i in range(3)]
    ex2 = sum(c * c for c in ex)
    ey2 = sum(c * c for c in ey)
    u = sum(d[i] * ex[i] for i in range(3)) / ex2
    v = sum(d[i] * ey[i] for i in range(3)) / ey2
    return [u, v]


def inside(rect_mm, uv, pad=0.0):
    x, y, w, h = rect_mm
    return (x - pad <= uv[0] <= x + w + pad and
            y - pad <= uv[1] <= y + h + pad)
