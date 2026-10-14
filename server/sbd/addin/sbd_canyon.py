# -*- coding: utf-8 -*-
"""Street canyon polygon assembly (Fig B7: facade bottom, ray laterals, curved opp BL top).

Key fixes vs. previous version:
- Centreline-perpendicular laterals (PNAP APP-152: "U measured perpendicular to centreline")
- Edge-type-aware lateral validation (allow back-facing/concave-notch crossings)
- Centreline-span clip as primary top-edge method
- Pin top-edge endpoints to B2/B1 to guarantee loop continuity
"""

import math

from Autodesk.Revit.DB import XYZ, Line, CurveLoop

from sbd_geom_base import (
    DOT_THRESHOLD,
    debug_print,
    simplify_polyline_collinear,
    get_closest_point_on_polyline,
    distance_along_centreline_between_points,
    segment_segment_intersection,
    get_polyline_arc_length,
    project_point_to_centreline,
    centreline_local_perp,
)
from sbd_geom_advanced import (
    get_curved_top_polyline_from_points,
    clip_opposite_by_centreline_span,
    ray_polyline_intersection,
)
from sbd_facade import remove_consecutive_duplicates

REVIT_MIN_SEGMENT_FT = 0.003
LATERAL_START_TOL_FRAC = 0.02
LATERAL_P_TOL_FT = 0.05
# Jagged (saw-tooth) facades: teeth 6-13 ft deep protrude past P, so the
# lateral clips its OWN facade's neighbouring teeth right at its start and
# every fallback direction fails. Street-facing hits within this window of
# the lateral start are treated as start artifacts and ignored; genuine
# "lateral wraps around the building" failures occur much deeper along it.
LATERAL_NEAR_START_IGNORE_FT = 20.0
LATERAL_NEAR_START_IGNORE_FRAC = 0.15


def _rotate_xy(v, deg):
    """Rotate vector v by deg in the XY plane."""
    rad = math.radians(deg)
    cos_a = math.cos(rad)
    sin_a = math.sin(rad)
    return XYZ(v.X * cos_a - v.Y * sin_a, v.X * sin_a + v.Y * cos_a, 0)


def _edge_outward_normal(e1, e2, centroid):
    """Outward normal of facade edge e1->e2, using centroid to determine 'outward'."""
    edge_vec = e2 - e1
    if edge_vec.GetLength() < 1e-9:
        return None
    normal1 = XYZ(-edge_vec.Y, edge_vec.X, 0).Normalize()
    to_center = centroid - (e1 + e2) * 0.5
    if normal1.DotProduct(to_center) < 0:
        return normal1
    return XYZ(edge_vec.Y, -edge_vec.X, 0).Normalize()


def _lateral_intersects_facade(P, B, raw_facade_pts, global_outward_normal,
                               start_tol_frac=LATERAL_START_TOL_FRAC,
                               p_tol=LATERAL_P_TOL_FT):
    """
    Check if segment P->B crosses the raw facade chain.

    Edge-type-aware: only REJECT intersections with STREET-FACING edges
    (outward normal aligned with global_outward_normal). Back-facing edges
    (concave notches) are ALLOWED, so concave buildings can still produce
    a canyon instead of being skipped.

    Returns (True, edge_idx) if the lateral crosses a street-facing edge.
    """
    if not raw_facade_pts or len(raw_facade_pts) < 2:
        return False, None

    lateral_len = P.DistanceTo(B)
    if lateral_len < REVIT_MIN_SEGMENT_FT:
        return False, None

    start_tol = max(start_tol_frac, p_tol / lateral_len)
    near_start_ignore = max(LATERAL_NEAR_START_IGNORE_FT,
                            LATERAL_NEAR_START_IGNORE_FRAC * lateral_len)

    centroid = sum(raw_facade_pts, XYZ.Zero) / float(len(raw_facade_pts))

    for i in range(len(raw_facade_pts) - 1):
        e1 = raw_facade_pts[i]
        e2 = raw_facade_pts[i + 1]
        t, u, pt_int = segment_segment_intersection(P, B, e1, e2)
        if pt_int is None:
            continue
        if pt_int.DistanceTo(P) <= p_tol:
            continue
        # Saw-tooth facades: crossing a tooth of the SAME facade right at
        # the start of the lateral is a start artifact, not the lateral
        # wrapping around the building — ignore street-facing hits inside
        # the near-start window (see constants above).
        if pt_int.DistanceTo(P) <= near_start_ignore:
            continue
        if t is not None and t > start_tol:
            outward = _edge_outward_normal(e1, e2, centroid)
            if outward is None:
                continue
            is_street_facing = outward.DotProduct(global_outward_normal) > DOT_THRESHOLD
            if is_street_facing:
                return True, i
            # Back-facing edge (concave notch) crossing is ALLOWED

    return False, None


def _is_valid_lateral(P, B, raw_facade_pts, global_outward_normal):
    if B is None:
        return False, "no B point", None
    if P.DistanceTo(B) < REVIT_MIN_SEGMENT_FT:
        return False, "B too close to P", None
    hits, edge_idx = _lateral_intersects_facade(P, B, raw_facade_pts, global_outward_normal)
    if hits:
        return False, "intersects street-facing facade edge {}".format(edge_idx), edge_idx
    return True, None, None


def _b_from_ray(P, direction, opp_pts_dense):
    if direction is None:
        return None
    B, _ = ray_polyline_intersection(P, direction, opp_pts_dense)
    return B


def _b_from_closest(P, opp_pts_dense):
    B, _, _, _, _ = get_closest_point_on_polyline(P, opp_pts_dense)
    return B


def _b_from_centreline(P, centre_points, opp_pts_dense):
    cl_foot, _ = project_point_to_centreline(P, centre_points)
    if cl_foot is None:
        return None
    B, _, _, _, _ = get_closest_point_on_polyline(cl_foot, opp_pts_dense)
    return B


def _resolve_lateral_foot(P, which, global_outward_normal, opp_pts_dense,
                          centre_points, raw_facade_pts):
    """
    Resolve opposite-boundary foot B for lateral P->B with facade validation.

    PERPENDICULAR-TO-OPPOSITE-BOUNDARY is tried FIRST: the closest point on
    the opposite boundary polyline IS the perpendicular foot (the shortest
    segment from a point to a line is by definition perpendicular to it, when
    the foot lands on a segment interior). This matches the requirement that
    the lateral edges be perpendicular to the opposite side of the street,
    not to the centreline/offset line.

    Centreline-perpendicular and other ray methods remain as fallbacks for
    cases where the closest-point foot fails validation (e.g. it would cut
    through the building facade on a concave boundary).

    Returns (B, success, method_or_reason).
    """
    local_perp = centreline_local_perp(P, centre_points)

    attempts = [
        ("opp-perp (closest-point foot)", lambda: _b_from_closest(P, opp_pts_dense)),
        ("cl-perp", lambda: _b_from_ray(P, local_perp, opp_pts_dense)),
        ("cl-perp+5", lambda: _b_from_ray(P, _rotate_xy(local_perp, 5.0), opp_pts_dense)),
        ("cl-perp-5", lambda: _b_from_ray(P, _rotate_xy(local_perp, -5.0), opp_pts_dense)),
        ("ray", lambda: _b_from_ray(P, global_outward_normal, opp_pts_dense)),
        ("ray+5deg", lambda: _b_from_ray(P, _rotate_xy(global_outward_normal, 5.0), opp_pts_dense)),
        ("ray-5deg", lambda: _b_from_ray(P, _rotate_xy(global_outward_normal, -5.0), opp_pts_dense)),
        ("centreline", lambda: _b_from_centreline(P, centre_points, opp_pts_dense)),
    ]

    for method, get_b in attempts:
        B = get_b()
        valid, reason, edge_idx = _is_valid_lateral(P, B, raw_facade_pts, global_outward_normal)
        if valid:
            debug_print(
                "    [LATERAL {}] {}: OK B=({:.2f},{:.2f})".format(
                    which, method, B.X, B.Y))
            return B, True, method
        if reason and "intersects" in reason:
            debug_print(
                "    [LATERAL {}] {}: FAIL {}".format(which, method, reason))
        else:
            debug_print(
                "    [LATERAL {}] {}: FAIL {}".format(which, method, reason or "invalid"))

    return None, False, "all lateral methods failed"


def curve_loop_is_simple(curve_loop):
    pts = []
    for c in curve_loop:
        pts.append(c.GetEndPoint(0))
    if pts[0].DistanceTo(pts[-1]) > 1e-6:
        pts.append(pts[0])
    n = len(pts)
    for i in range(n - 1):
        a1 = pts[i]
        a2 = pts[i + 1]
        for j in range(i + 2, n - 1):
            if i == 0 and j == n - 2:
                continue
            b1 = pts[j]
            b2 = pts[j + 1]
            t, u, _ = segment_segment_intersection(a1, a2, b1, b2)
            if t is not None:
                return False
    return True


def _append_segment(curve_loop, p1, p2, z, min_len=REVIT_MIN_SEGMENT_FT):
    if p1.DistanceTo(p2) >= min_len:
        curve_loop.Append(Line.CreateBound(XYZ(p1.X, p1.Y, z), XYZ(p2.X, p2.Y, z)))
        return True
    return False


def _polygon_area_2d(pts):
    area_ft2 = 0.0
    n_poly = len(pts)
    for i in range(n_poly):
        p1 = pts[i]
        p2 = pts[(i + 1) % n_poly]
        area_ft2 += p1.X * p2.Y - p2.X * p1.Y
    return abs(area_ft2) / 2.0


def _point_in_polygon_2d(pt, poly):
    """Ray-casting point-in-polygon test in the XY plane."""
    x, y = pt.X, pt.Y
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i].X, poly[i].Y
        xj, yj = poly[j].X, poly[j].Y
        if (yi > y) != (yj > y):
            x_int = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < x_int:
                inside = not inside
        j = i
    return inside


def centreline_length_inside_polygon(centre_points, poly_pts):
    """
    Length of the portion of the centreline polyline that lies INSIDE the
    given closed polygon (the canyon / projected area).

    This is the correct L for the U calculation: U = projected area /
    length of the centreline within the projected area. The previous
    approach measured the centreline distance between the projections of
    the two offset-line intersection points, which is not the same thing
    when the lateral edges are slanted (perpendicular to the opposite
    boundary rather than to the centreline).

    Implementation: for every centreline segment, find its intersection
    parameters with the polygon boundary, split the segment at those
    parameters, and accumulate the sub-segment lengths whose midpoints
    test inside the polygon.
    """
    if len(centre_points) < 2 or len(poly_pts) < 3:
        return 0.0

    total = 0.0
    n_poly = len(poly_pts)

    for i in range(len(centre_points) - 1):
        a = centre_points[i]
        b = centre_points[i + 1]
        seg_len = a.DistanceTo(b)
        if seg_len < 1e-9:
            continue

        # Parameters where this segment crosses the polygon boundary
        ts = [0.0, 1.0]
        for j in range(n_poly):
            q1 = poly_pts[j]
            q2 = poly_pts[(j + 1) % n_poly]
            t, u, _ = segment_segment_intersection(a, b, q1, q2)
            if t is not None:
                ts.append(t)
        ts = sorted(set(ts))

        # Accumulate sub-segments whose midpoint is inside
        for k in range(len(ts) - 1):
            t_mid = (ts[k] + ts[k + 1]) * 0.5
            mid = a + (b - a) * t_mid
            if _point_in_polygon_2d(mid, poly_pts):
                total += (ts[k + 1] - ts[k]) * seg_len

    return total


def _resolve_canyon_anchors(facade_pts, raw_facade_pts, global_outward_normal,
                            opp_pts_dense, centre_points):
    P1 = facade_pts[0]
    P2 = facade_pts[-1]

    B1, ok1, _ = _resolve_lateral_foot(
        P1, "P1", global_outward_normal, opp_pts_dense, centre_points, raw_facade_pts)
    if not ok1:
        debug_print("    [ANCHORS] P1 lateral validation failed; skipping canyon")
        return None

    B2, ok2, _ = _resolve_lateral_foot(
        P2, "P2", global_outward_normal, opp_pts_dense, centre_points, raw_facade_pts)
    if not ok2:
        debug_print("    [ANCHORS] P2 lateral validation failed; skipping canyon")
        return None

    if B1.DistanceTo(B2) < 0.01:
        cp1, _, _, _, _ = get_closest_point_on_polyline(P1, opp_pts_dense)
        cp2, _, _, _, _ = get_closest_point_on_polyline(P2, opp_pts_dense)
        if cp1 is not None and cp2 is not None and cp1.DistanceTo(cp2) >= 0.01:
            v1, _, _ = _is_valid_lateral(P1, cp1, raw_facade_pts, global_outward_normal)
            v2, _, _ = _is_valid_lateral(P2, cp2, raw_facade_pts, global_outward_normal)
            if v1 and v2:
                B1, B2 = cp1, cp2
                debug_print("    [ANCHORS] B1~=B2; using closest-on-opp feet")
            else:
                debug_print("    [ANCHORS] B1~=B2 dedup feet fail lateral validation")
                return None
        else:
            return None

    _, _, _, _, sOpp1 = get_closest_point_on_polyline(B1, opp_pts_dense)
    _, _, _, _, sOpp2 = get_closest_point_on_polyline(B2, opp_pts_dense)
    opp_total = get_polyline_arc_length(opp_pts_dense)
    cross_span = abs(sOpp2 - sOpp1)

    return {
        "P1": P1, "P2": P2, "B1": B1, "B2": B2,
        "cross_span": cross_span, "opp_total": opp_total,
    }


def _orient_top_slice_to_anchors(top_pts, B2, B1):
    if not top_pts or len(top_pts) < 2:
        return top_pts
    if top_pts[0].DistanceTo(B1) < top_pts[0].DistanceTo(B2):
        top_pts = list(reversed(top_pts))
        debug_print("    [TOPEDGE] reversed slice orientation to run B2 -> B1")
    return top_pts


def _get_top_edge_points(B2, B1, P1, P2, opp_pts_dense, centre_points,
                         use_centreline_clip=True, cross_span=None, opp_total=None):
    """
    Build the top edge (opposite BL slice between B1 and B2).

    Centreline-span clip is now PRIMARY (not just retry). This ensures
    the top edge corresponds to the same centreline span as the facade,
    preventing the top from meandering outside the facade's footprint.
    """
    opp_for_slice = opp_pts_dense
    if use_centreline_clip:
        clipped = clip_opposite_by_centreline_span(
            opp_pts_dense, centre_points, P1, P2, margin_frac=0.1)
        if clipped and len(clipped) >= 2:
            opp_for_slice = clipped
            debug_print("    [TOPEDGE] centreline-span clip applied ({} pts)".format(len(opp_for_slice)))
        else:
            debug_print("    [TOPEDGE] centreline-span clip returned <2 pts; using full opp BL")

    top_pts_raw = get_curved_top_polyline_from_points(
        opp_for_slice, B2, B1, return_points=True)
    if not top_pts_raw or len(top_pts_raw) < 2:
        return None

    top_pts = simplify_polyline_collinear(top_pts_raw, angle_tol_deg=0.5)
    top_pts = remove_consecutive_duplicates(top_pts, tol=1e-5)
    top_pts = _orient_top_slice_to_anchors(top_pts, B2, B1)

    # ----- FIX: PIN top-edge endpoints to anchors -----
    if top_pts and len(top_pts) >= 2:
        top_pts[0] = B2
        top_pts[-1] = B1

    return top_pts if len(top_pts) >= 2 else None


def _build_curve_loop_monolithic(bottom_pts, P1, P2, B1, B2, top_pts, view_elevation):
    """Assemble loop: bottom -> P2->B2 -> top -> B1->P1."""
    curve_loop = CurveLoop()
    n_seg = 0

    clipped = simplify_polyline_collinear(list(bottom_pts), angle_tol_deg=0.5)
    if len(clipped) >= 2:
        clipped[0] = P1
        clipped[-1] = P2
    clipped = remove_consecutive_duplicates(clipped, tol=1e-5)

    for i in range(len(clipped) - 1):
        if _append_segment(curve_loop, clipped[i], clipped[i + 1], view_elevation):
            n_seg += 1

    if _append_segment(curve_loop, P2, B2, view_elevation):
        n_seg += 1

    # Pin top endpoints again (safety)
    if top_pts and len(top_pts) >= 2:
        top_pts[0] = B2
        top_pts[-1] = B1

    for i in range(len(top_pts) - 1):
        if _append_segment(curve_loop, top_pts[i], top_pts[i + 1], view_elevation):
            n_seg += 1

    if _append_segment(curve_loop, B1, P1, view_elevation):
        n_seg += 1

    if n_seg < 3:
        return None, clipped
    return curve_loop, clipped


def _try_build_canyon(bottom_pts, path_name, P1, P2, B1, B2, opp_pts_dense,
                      centre_points, use_centreline_clip, cross_span, opp_total,
                      view_elevation):
    top_pts = _get_top_edge_points(
        B2, B1, P1, P2, opp_pts_dense, centre_points,
        use_centreline_clip=use_centreline_clip,
        cross_span=cross_span, opp_total=opp_total)
    if not top_pts:
        return None, None, path_name

    # Quick validation: top endpoints should be close to B2/B1
    if top_pts[0].DistanceTo(B2) > 1.0 or top_pts[-1].DistanceTo(B1) > 1.0:
        debug_print("    [{}] Top edge endpoints far from anchors (dist: {:.2f}, {:.2f}); skipping.".format(
            path_name, top_pts[0].DistanceTo(B2), top_pts[-1].DistanceTo(B1)))
        return None, None, path_name

    lateral_p2_b2 = P2.DistanceTo(B2)
    lateral_b1_p1 = B1.DistanceTo(P1)
    debug_print("    [{}] bottom {} pts, lateral P2-B2={:.1f}ft, top {} pts, lateral B1-P1={:.1f}ft".format(
        path_name, len(bottom_pts), lateral_p2_b2, len(top_pts), lateral_b1_p1))

    curve_loop, clipped = _build_curve_loop_monolithic(
        bottom_pts, P1, P2, B1, B2, top_pts, view_elevation)
    if curve_loop is None:
        return None, None, path_name

    if not curve_loop_is_simple(curve_loop):
        debug_print("    [{}] self-intersecting ({} curves)".format(
            path_name, curve_loop.NumberOfCurves()))
        return None, None, path_name

    return curve_loop, clipped, path_name


def build_canyon_polygon(facade_pts, raw_facade_pts, label, centre_points, opp_pts_dense,
                         global_outward_normal, subj_dir, view_elevation,
                         create_filled_region_fn, create_detail_line_fn):
    """
    Fig B7 canyon: facade bottom, centreline-perp laterals to dense opp BL,
    centreline-span-clipped opp BL top.
    Two-attempt recovery: facade bottom with clip, then chord bottom with clip.
    Returns (success, area_ft2, L_ft, Lp_proj_ft).
    """
    debug_print("    [{}] Building canyon polygon.".format(label))

    if len(facade_pts) < 3:
        debug_print("    [{}] Facade has {} vertices (< 3); chord fallback may apply.".format(
            label, len(facade_pts)))

    raw_chain = raw_facade_pts if raw_facade_pts else facade_pts
    anchors = _resolve_canyon_anchors(
        facade_pts, raw_chain, global_outward_normal, opp_pts_dense, centre_points)
    if anchors is None:
        debug_print("    [{}] Cannot resolve lateral feet; skipping.".format(label))
        return False, 0.0, 0.0, 0.0

    P1 = anchors["P1"]
    P2 = anchors["P2"]
    B1 = anchors["B1"]
    B2 = anchors["B2"]
    cross_span = anchors["cross_span"]
    opp_total = anchors["opp_total"]

    debug_print("    [{}] P1=({:.2f},{:.2f}) B1=({:.2f},{:.2f}) | P2=({:.2f},{:.2f}) B2=({:.2f},{:.2f})".format(
        label, P1.X, P1.Y, B1.X, B1.Y, P2.X, P2.Y, B2.X, B2.Y))

    facade_bottom = list(facade_pts)
    chord_bottom = [P1, P2]

    # Primary: facade bottom with FULL opposite-boundary slice between the
    # lateral feet (no centreline-span clip), so the top edge covers every
    # opposite-side segment between B1 and B2.
    # Fallbacks: centreline-span clip (recovers self-intersection cases
    # where the full slice meanders), then END-TRIMMED chains (see below),
    # then chord bottoms as the last resort.
    attempts = [
        (facade_bottom, False, "A-full"),
        (facade_bottom, True, "A-clip"),
    ]

    curve_loop = None
    clipped = None
    path_used = None

    for bottom_pts, use_clip, path_name in attempts:
        curve_loop, clipped, path_used = _try_build_canyon(
            bottom_pts, path_name, P1, P2, B1, B2, opp_pts_dense,
            centre_points, use_clip, cross_span, opp_total, view_elevation)
        if curve_loop is not None:
            break

    # ------------------------------------------------------------------
    # END-TRIM RECOVERY. When the offset crossing point (P1/P2) lands
    # "behind" a protruding facade corner, the lateral from it crosses the
    # facade's own tail and both A attempts self-intersect. Previously
    # this fell straight through to the CHORD paths, whose straight P1-P2
    # bottom cuts across the building — the projected area then no longer
    # follows the building edges (tester issue). Instead, drop trailing /
    # leading chain vertices one at a time (snapping the interval end to
    # the FARTHEST true facade vertex), re-resolve the lateral feet, and
    # retry. Only if every trim also fails do we fall back to the chord.
    # ------------------------------------------------------------------
    if curve_loop is None and len(facade_bottom) > 2:
        trim_variants = []
        for drop in (1, 2, 3):
            if len(facade_bottom) - drop >= 2:
                trim_variants.append(
                    (facade_bottom[:-drop], "A-trimEnd{}".format(drop)))
        for drop in (1, 2, 3):
            if len(facade_bottom) - drop >= 2:
                trim_variants.append(
                    (facade_bottom[drop:], "A-trimStart{}".format(drop)))
        for trimmed, tname in trim_variants:
            anc2 = _resolve_canyon_anchors(
                trimmed, raw_chain, global_outward_normal, opp_pts_dense,
                centre_points)
            if anc2 is None:
                continue
            for use_clip in (False, True):
                curve_loop, clipped, path_used = _try_build_canyon(
                    trimmed, "{}-{}".format(tname, "clip" if use_clip else "full"),
                    anc2["P1"], anc2["P2"], anc2["B1"], anc2["B2"],
                    opp_pts_dense, centre_points, use_clip,
                    anc2["cross_span"], anc2["opp_total"], view_elevation)
                if curve_loop is not None:
                    break
            if curve_loop is not None:
                debug_print("    [{}] End-trim recovery succeeded via {} "
                             "(interval end snapped to the farthest true "
                             "facade vertex).".format(label, path_used))
                break

    if curve_loop is None:
        for bottom_pts, use_clip, path_name in (
                (chord_bottom, False, "CHORD-full"),
                (chord_bottom, True, "CHORD-clip")):
            curve_loop, clipped, path_used = _try_build_canyon(
                bottom_pts, path_name, P1, P2, B1, B2, opp_pts_dense,
                centre_points, use_clip, cross_span, opp_total, view_elevation)
            if curve_loop is not None:
                break

    if curve_loop is None:
        debug_print("    [{}] All canyon attempts failed; skipping.".format(label))
        return False, 0.0, 0.0, 0.0

    try:
        fr = create_filled_region_fn(curve_loop)
        if fr is None:
            debug_print("    [{}] create_filled_region returned None.".format(label))
            return False, 0.0, 0.0, 0.0

        for curve in curve_loop:
            p1 = curve.GetEndPoint(0)
            p2 = curve.GetEndPoint(1)
            create_detail_line_fn(p1, p2)

        loop_points = [curve.GetEndPoint(0) for curve in curve_loop]
        last_c = None
        for c in curve_loop:
            last_c = c
        if last_c:
            loop_points.append(last_c.GetEndPoint(1))
        area_ft2 = _polygon_area_2d(loop_points)

        # L = length of the CENTRELINE portion inside the projected area
        # (canyon polygon), per the correct U definition. Falls back to the
        # P1-P2 centreline distance only if the polygon clip yields nothing
        # (degenerate geometry).
        L_ft = centreline_length_inside_polygon(centre_points, loop_points)
        if L_ft < 1e-6:
            L_ft = distance_along_centreline_between_points(P1, P2, centre_points)
            debug_print("    [{}] Centreline-inside-polygon clip empty; "
                         "fell back to P1-P2 centreline distance.".format(label))
        else:
            L_p1p2 = distance_along_centreline_between_points(P1, P2, centre_points)
            debug_print("    [{}] L inside polygon = {:.2f} ft "
                         "(old P1-P2 method would give {:.2f} ft)".format(
                             label, L_ft, L_p1p2))

        Lp_proj_ft = 0.0
        for i in range(len(clipped) - 1):
            seg = clipped[i + 1] - clipped[i]
            Lp_proj_ft += abs(seg.DotProduct(subj_dir))

        debug_print("    [{}] Path {} OK: area={:.2f} ft², L={:.2f} ft, Lp_proj={:.2f} ft".format(
            label, path_used, area_ft2, L_ft, Lp_proj_ft))
        return True, area_ft2, L_ft, Lp_proj_ft
    except Exception as e:
        debug_print("    [{}] Path {} failed: {}".format(label, path_used, str(e)))
        return False, 0.0, 0.0, 0.0