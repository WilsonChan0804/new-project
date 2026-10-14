# -*- coding: utf-8 -*-
"""Higher‑level geometry functions – depends on sbd_geom_base."""

import math
from Autodesk.Revit.DB import XYZ, Line
from sbd_geom_base import (
    debug_print, get_points_from_curves, get_closest_point_on_polyline,
    get_closest_point_on_curves, simplify_polyline_collinear,
    tessellate_curve_to_points, get_polyline_arc_length,
    point_at_arclength_open, project_point_to_centreline
)

# ----------------------------------------------------------------------
# Helper: sort curves by geometric connectivity
# ----------------------------------------------------------------------
def sort_curves_by_connectivity(curves, tolerance=2.0):
    """
    Sort a list of Revit Curve objects so that they form a continuous chain,
    REVERSING curves as needed.

    The previous version only checked current.end vs next.start, so it could
    not handle curves that needed reversing (e.g. a U-shaped boundary where
    two arms meet at a junction — both arms' curves start at the junction,
    but one arm needs to be reversed so the path goes arm1-end → junction →
    arm2-end continuously). This caused the centreline to fold back on itself
    at the junction, corrupting everything downstream.

    This version checks all four endpoint combinations for each candidate
    next-curve and reverses it if needed, matching the approach used in the
    Dynamo join_chunks function.
    """
    if len(curves) < 2:
        return curves[:]

    from Autodesk.Revit.DB import Line as DBLine

    def _curve_start(c):
        return c.GetEndPoint(0)

    def _curve_end(c):
        return c.GetEndPoint(1)

    def _reverse_curve(c):
        """Create a reversed copy of a Revit Curve."""
        try:
            return c.CreateReversed()
        except Exception:
            # Fallback for curve types that don't support CreateReversed:
            # create a new Line from end to start (works for straight lines)
            try:
                return DBLine.CreateBound(c.GetEndPoint(1), c.GetEndPoint(0))
            except Exception:
                return c

    remaining = list(curves)

    # Start with the first curve. Try to find a curve that has no predecessor
    # (i.e., no other curve's end matches its start) to use as the true start.
    best_start = 0
    for i, c in enumerate(remaining):
        has_pred = False
        s = _curve_start(c)
        for j, other in enumerate(remaining):
            if i == j:
                continue
            if s.DistanceTo(_curve_end(other)) < tolerance:
                has_pred = True
                break
            if s.DistanceTo(_curve_start(other)) < tolerance:
                has_pred = True
                break
        if not has_pred:
            best_start = i
            break

    chain = [remaining.pop(best_start)]

    while remaining:
        tail = _curve_end(chain[-1])
        head = _curve_start(chain[0])

        best_idx = -1
        best_dist = float('inf')
        best_mode = None  # 'append', 'append-rev', 'prepend', 'prepend-rev'

        for i, c in enumerate(remaining):
            cs = _curve_start(c)
            ce = _curve_end(c)

            # Append: tail → c.start (no reverse needed)
            d = tail.DistanceTo(cs)
            if d < best_dist:
                best_dist, best_idx, best_mode = d, i, 'append'

            # Append reversed: tail → c.end (reverse the curve)
            d = tail.DistanceTo(ce)
            if d < best_dist:
                best_dist, best_idx, best_mode = d, i, 'append-rev'

            # Prepend: c.end → head (no reverse needed)
            d = ce.DistanceTo(head)
            if d < best_dist:
                best_dist, best_idx, best_mode = d, i, 'prepend'

            # Prepend reversed: c.start → head (reverse the curve)
            d = cs.DistanceTo(head)
            if d < best_dist:
                best_dist, best_idx, best_mode = d, i, 'prepend-rev'

        if best_idx < 0 or best_dist > tolerance:
            # No connectable curve found within tolerance; stop
            debug_print("    [SORT] {} curves remaining but none connect within tolerance {:.2f} ft (best_dist={:.2f})".format(
                len(remaining), tolerance, best_dist))
            break

        picked = remaining.pop(best_idx)

        if best_mode == 'append':
            chain.append(picked)
        elif best_mode == 'append-rev':
            chain.append(_reverse_curve(picked))
        elif best_mode == 'prepend':
            chain.insert(0, picked)
        elif best_mode == 'prepend-rev':
            chain.insert(0, _reverse_curve(picked))

    debug_print("    [SORT] Sorted {} curves into chain of {} (tolerance={:.2f} ft)".format(
        len(curves), len(chain), tolerance))
    if chain:
        debug_print("    [SORT] Chain: ({:.2f},{:.2f}) -> ({:.2f},{:.2f})".format(
            _curve_start(chain[0]).X, _curve_start(chain[0]).Y,
            _curve_end(chain[-1]).X, _curve_end(chain[-1]).Y))

    return chain

# ----------------------------------------------------------------------
# Legacy offset construction (kept for compatibility)
# ----------------------------------------------------------------------
def _left_normal_xyz(tangent):
    return XYZ(-tangent.Y, tangent.X, 0)

def _signed_delta_angle(a0, a1):
    d = a1 - a0
    while d <= -math.pi:
        d += 2.0 * math.pi
    while d > math.pi:
        d -= 2.0 * math.pi
    return d

def _line_intersect_2d(p1, d1, p2, d2):
    denom = d1.X * d2.Y - d1.Y * d2.X
    if abs(denom) < 1e-9:
        return None
    diff = p2 - p1
    t = (diff.X * d2.Y - diff.Y * d2.X) / denom
    return p1 + d1 * t

def build_offset_pieces_continuous(verts, side_sign, offset_dist):
    if len(verts) < 2:
        return []

    off_segs = []
    seg_tans = []
    for i in range(len(verts) - 1):
        a, b = verts[i], verts[i + 1]
        seg_vec = b - a
        if seg_vec.GetLength() < 1e-9:
            continue
        t = seg_vec.Normalize()
        n = _left_normal_xyz(t) * side_sign
        off_segs.append((a + n * offset_dist, b + n * offset_dist))
        seg_tans.append(t)

    if not off_segs:
        return []

    pieces = []
    current_pt = off_segs[0][0]

    for i in range(len(off_segs) - 1):
        oa, ob = off_segs[i]
        na, nb = off_segs[i + 1]
        t0, t1 = seg_tans[i], seg_tans[i + 1]
        cross_z = t0.X * t1.Y - t0.Y * t1.X
        dot_c = max(-1.0, min(1.0, t0.DotProduct(t1)))
        ang_deg = math.degrees(math.acos(dot_c))

        if ang_deg < 2.0:
            ix = _line_intersect_2d(oa, ob - oa, na, nb - na)
            if ix is None:
                ix = (ob + na) * 0.5
            if current_pt.DistanceTo(ix) > 1e-6:
                pieces.append(("line", current_pt, ix))
            current_pt = ix
            continue

        convex = (cross_z * side_sign) < 0

        if convex:
            if current_pt.DistanceTo(ob) > 1e-6:
                pieces.append(("line", current_pt, ob))
            pivot = verts[i + 1]
            pieces.append(("arc", pivot, ob, na))
            current_pt = na
        else:
            ix = _line_intersect_2d(oa, ob - oa, na, nb - na)
            if ix is None:
                ix = (ob + na) * 0.5
            if current_pt.DistanceTo(ix) > 1e-6:
                pieces.append(("line", current_pt, ix))
            current_pt = ix

    last_end = off_segs[-1][1]
    if current_pt.DistanceTo(last_end) > 1e-6:
        pieces.append(("line", current_pt, last_end))

    return pieces

def sample_offset_arc(center, p_start, p_end, steps=24):
    r = center.DistanceTo(p_start)
    if r < 1e-9:
        return [p_start, p_end]
    a0 = math.atan2(p_start.Y - center.Y, p_start.X - center.X)
    a1 = math.atan2(p_end.Y - center.Y, p_end.X - center.X)
    da = _signed_delta_angle(a0, a1)
    pts = []
    for k in range(steps + 1):
        a = a0 + da * (float(k) / float(steps))
        pts.append(XYZ(center.X + r * math.cos(a), center.Y + r * math.sin(a), p_start.Z))
    return pts

def offset_pieces_to_points(pieces, arc_steps=24):
    pts = []
    for piece in pieces:
        if piece[0] == "line":
            _, a, b = piece
            local = [a, b]
        else:
            _, c, a, b = piece
            local = sample_offset_arc(c, a, b, arc_steps)
        if not pts:
            pts.extend(local)
        else:
            if pts[-1].DistanceTo(local[0]) < 1e-6:
                pts.extend(local[1:])
            else:
                pts.extend(local)
    out = []
    for p in pts:
        if not out or p.DistanceTo(out[-1]) > 1e-6:
            out.append(p)
    return out

def _seg_intersection_xyz(p1, p2, q1, q2, eps=1e-9):
    r = p2 - p1
    s = q2 - q1
    den = r.X * s.Y - r.Y * s.X
    if abs(den) < eps:
        return None
    qp = q1 - p1
    t = (qp.X * s.Y - qp.Y * s.X) / den
    u = (qp.X * r.Y - qp.Y * r.X) / den
    if eps < t < 1.0 - eps and eps < u < 1.0 - eps:
        return p1 + r * t
    return None

def remove_offset_self_intersections(pts):
    if len(pts) < 4:
        return pts[:]

    out = pts[:]
    changed = True
    safety_iterations = 0
    while changed and safety_iterations < 50:
        changed = False
        safety_iterations += 1
        n = len(out)
        for i in range(n - 1):
            for j in range(i + 2, n - 1):
                if i == 0 and j == n - 2:
                    continue
                ip = _seg_intersection_xyz(out[i], out[i + 1], out[j], out[j + 1])
                if ip is not None:
                    out = out[:i + 1] + [ip] + out[j + 1:]
                    changed = True
                    break
            if changed:
                break

    cleaned = []
    for p in out:
        if not cleaned or p.DistanceTo(cleaned[-1]) > 1e-6:
            cleaned.append(p)
    return cleaned

def build_clean_offset_polyline(centre_pts, side_sign, offset_dist, arc_steps=24):
    pieces = build_offset_pieces_continuous(centre_pts, side_sign, offset_dist)
    if not pieces:
        return []
    sampled = offset_pieces_to_points(pieces, arc_steps)
    cleaned = remove_offset_self_intersections(sampled)
    cleaned = simplify_polyline_collinear(cleaned, angle_tol_deg=0.5)
    return cleaned

# ----------------------------------------------------------------------
# NEW: Facade‑Driven Ray Casting Centreline & Offset
# ----------------------------------------------------------------------
def extend_polyline_linearly(pts, forward_distance=500.0, backward_distance=500.0):
    if len(pts) < 2:
        return pts[:]
    first_vec = pts[1] - pts[0]
    first_len = first_vec.GetLength()
    if first_len > 1e-9:
        first_dir = first_vec / first_len
    else:
        first_dir = XYZ(1, 0, 0)
    last_vec = pts[-1] - pts[-2]
    last_len = last_vec.GetLength()
    if last_len > 1e-9:
        last_dir = last_vec / last_len
    else:
        last_dir = XYZ(1, 0, 0)
    ext_start = pts[0] - first_dir * backward_distance
    ext_end = pts[-1] + last_dir * forward_distance
    return [ext_start] + pts[:] + [ext_end]

def ray_polyline_intersection(origin, direction, polyline_pts):
    best_pt = None
    best_seg_i = -1
    best_t = float('inf')
    for i in range(len(polyline_pts) - 1):
        a = polyline_pts[i]
        b = polyline_pts[i + 1]
        r = direction
        s = b - a
        denom = r.X * s.Y - r.Y * s.X
        if abs(denom) < 1e-12:
            continue
        diff = a - origin
        t = (diff.X * s.Y - diff.Y * s.X) / denom
        u = (diff.X * r.Y - diff.Y * r.X) / denom
        if t > -1e-9 and 0.0 <= u <= 1.0:
            if t < best_t:
                best_t = t
                best_pt = origin + r * t
                best_seg_i = i
    if best_pt is None:
        return None, -1
    return best_pt, best_seg_i

def resample_polyline_by_length(pts, num_samples):
    if len(pts) < 2:
        return pts[:]
    total = get_polyline_arc_length(pts)
    if total < 1e-9:
        return [pts[0]] * num_samples
    out = []
    acc = 0.0
    idx = 0
    for i in range(num_samples):
        target = (i / float(num_samples)) * total
        while idx < len(pts) - 1 and acc + pts[idx].DistanceTo(pts[idx+1]) < target - 1e-9:
            acc += pts[idx].DistanceTo(pts[idx+1])
            idx += 1
        if idx >= len(pts) - 1:
            out.append(pts[-1])
            continue
        seg_len = pts[idx].DistanceTo(pts[idx+1])
        t = (target - acc) / seg_len if seg_len > 1e-9 else 0.0
        out.append(pts[idx] + (pts[idx+1] - pts[idx]) * t)
    return out

def compute_centreline_and_offset_from_subject(curves_subj, curves_opp, num_samples=200, offset_dist_ft=30.0/0.3048):
    """
    Computes centreline and 30m offset.

    FIX: the previous version computed ONE global normal direction from the
    subject boundary's first-to-last direction, then used that single
    direction for every ray-cast. On a curved or U-shaped street, the
    across-street direction varies along the length, so a single global
    normal only works for perfectly straight streets — on anything curved,
    the endpoints of the centreline go wildly wrong.

    This version uses per-point closest-point projection: for each sample
    point on the subject boundary, find the closest point on the opposite
    boundary (continuous clamped point-to-segment, not fixed-direction
    ray-cast), then take the midpoint. This is the same approach used in
    the original compute_centreline_points and handles any street shape.
    """
    def tessellate_curves_local(curves):
        pts = []
        for curve in curves:
            seg_pts = tessellate_curve_to_points(curve, max_chord_len=None)
            if not pts:
                pts.extend(seg_pts)
            else:
                if pts[-1].DistanceTo(seg_pts[0]) > 0.001:
                    pts.append(seg_pts[0])
                pts.extend(seg_pts[1:])
        clean = []
        for p in pts:
            if not clean or p.DistanceTo(clean[-1]) > 1e-6:
                clean.append(p)
        return clean

    # Sort curves by connectivity (now with reversal support)
    curves_subj_sorted = sort_curves_by_connectivity(curves_subj, tolerance=2.0)
    curves_opp_sorted = sort_curves_by_connectivity(curves_opp, tolerance=2.0)

    debug_print("    [CL] Subject curves sorted ({} curves):".format(len(curves_subj_sorted)))
    for i, c in enumerate(curves_subj_sorted):
        s, e = c.GetEndPoint(0), c.GetEndPoint(1)
        debug_print("        curve {}: ({:.2f},{:.2f}) -> ({:.2f},{:.2f})".format(i, s.X, s.Y, e.X, e.Y))

    debug_print("    [CL] Opposite curves sorted ({} curves):".format(len(curves_opp_sorted)))
    for i, c in enumerate(curves_opp_sorted):
        s, e = c.GetEndPoint(0), c.GetEndPoint(1)
        debug_print("        curve {}: ({:.2f},{:.2f}) -> ({:.2f},{:.2f})".format(i, s.X, s.Y, e.X, e.Y))

    subj_pts_raw = tessellate_curves_local(curves_subj_sorted)
    opp_pts_raw = tessellate_curves_local(curves_opp_sorted)

    debug_print("    [CL] Subject tessellated: {} pts".format(len(subj_pts_raw)))
    debug_print("    [CL] Opposite tessellated: {} pts".format(len(opp_pts_raw)))

    if len(subj_pts_raw) < 2 or len(opp_pts_raw) < 2:
        debug_print("    [CL] ERROR: not enough boundary points.")
        return [], []

    # Resample subject to num_samples evenly-spaced points
    subj_pts = resample_polyline_by_length(subj_pts_raw, num_samples)
    debug_print("    [CL] Resampled subject to {} points".format(len(subj_pts)))

    # Densely sample the opposite boundary for accurate closest-point projection
    opp_dense = resample_polyline_by_length(opp_pts_raw, max(num_samples * 4, 400))
    debug_print("    [CL] Dense opposite: {} points".format(len(opp_dense)))

    # Build centreline: for each subject sample, find closest point on
    # opposite boundary (per-point, handles any street curvature), midpoint.
    #
    # ENDPOINT-CLAMP FIX: when a subject sample sits BEYOND the end of the
    # opposite boundary (the two boundaries don't start/end at matching
    # positions along the street), its closest point CLAMPS to the opposite
    # boundary's endpoint. Many consecutive samples then all project to
    # that same fixed endpoint, and their midpoints sweep an arc around it
    # - producing the hook/curl at the centreline ends, which then makes
    # the offset spiral. The fix: detect clamped projections (arc-length
    # position at the very start/end of the opposite boundary) and drop
    # those samples, trimming the centreline to the genuine overlap region.
    opp_total_len = get_polyline_arc_length(opp_dense)
    end_tol = max(1.0, opp_total_len * 0.005)  # ~0.5% of boundary length

    raw_projections = []
    for i, pt in enumerate(subj_pts):
        closest_pt, dist, seg_i, t_seg, arc_len = get_closest_point_on_polyline(pt, opp_dense)
        if closest_pt is None:
            continue
        clamped = (arc_len < end_tol) or (arc_len > opp_total_len - end_tol)
        raw_projections.append({
            "i": i, "pt": pt, "closest": closest_pt,
            "dist": dist, "arc_len": arc_len, "clamped": clamped
        })

    # Median street width from the NON-clamped projections; used to reject
    # any residual outliers (samples that are far from the parallel-overlap
    # zone project at distances much larger than the true street width).
    unclamped_dists = sorted(p["dist"] for p in raw_projections if not p["clamped"])
    if unclamped_dists:
        median_width = unclamped_dists[len(unclamped_dists) // 2]
    else:
        median_width = None

    n_clamped = sum(1 for p in raw_projections if p["clamped"])
    debug_print("    [CL] Projections: {} total, {} clamped to opp endpoints (dropped), median width={:.1f} ft".format(
        len(raw_projections), n_clamped,
        median_width if median_width is not None else -1.0))

    centre_pts = []
    n_outliers = 0
    for p in raw_projections:
        if p["clamped"]:
            continue
        if median_width is not None and p["dist"] > 2.5 * median_width:
            n_outliers += 1
            continue
        mid = (p["pt"] + p["closest"]) / 2.0
        centre_pts.append(mid)

        if p["i"] % 20 == 0:
            debug_print("    [CL] pt{}: subj ({:.2f},{:.2f}) -> opp ({:.2f},{:.2f}) -> mid ({:.2f},{:.2f}) d={:.1f}".format(
                p["i"], p["pt"].X, p["pt"].Y, p["closest"].X, p["closest"].Y, mid.X, mid.Y, p["dist"]))

    if n_outliers:
        debug_print("    [CL] Dropped {} distance-outlier sample(s) (> 2.5x median width)".format(n_outliers))
    debug_print("    [CL] Centreline points after trim: {}".format(len(centre_pts)))

    centre_pts_simplified = simplify_polyline_collinear(centre_pts, angle_tol_deg=0.5)
    if len(centre_pts_simplified) < 2:
        return centre_pts_simplified, []

    # Vote which side of the centreline faces the subject boundary (majority rule).
    n = len(centre_pts_simplified)
    vote = 0
    vote_count = 0
    for i in range(n):
        if i == 0:
            tangent = centre_pts_simplified[1] - centre_pts_simplified[0]
        elif i == n - 1:
            tangent = centre_pts_simplified[-1] - centre_pts_simplified[-2]
        else:
            tangent = centre_pts_simplified[i + 1] - centre_pts_simplified[i - 1]
        if tangent.GetLength() < 1e-6:
            continue
        tangent = tangent.Normalize()
        perp = XYZ(-tangent.Y, tangent.X, 0)
        closest_subj = get_closest_point_on_curves(centre_pts_simplified[i], curves_subj_sorted)
        if closest_subj is None:
            continue
        vec = closest_subj - centre_pts_simplified[i]
        if vec.GetLength() < 1e-6:
            continue
        vec = vec.Normalize()
        vote += 1 if perp.DotProduct(vec) > 0 else -1
        vote_count += 1

    side_sign = 1 if vote >= 0 else -1
    debug_print("    [RAY] Offset side_sign toward subject: {} (votes={}/{})".format(
        side_sign, vote, vote_count))

    offset_pts_simplified = build_clean_offset_polyline(
        centre_pts_simplified, side_sign, offset_dist_ft, arc_steps=24)
    if len(offset_pts_simplified) < 2:
        debug_print("    [RAY] WARNING: continuous offset produced too few points; per-point fallback.")
        offset_pts_simplified = []
        for i in range(n):
            if i == 0:
                tangent = centre_pts_simplified[1] - centre_pts_simplified[0]
            elif i == n - 1:
                tangent = centre_pts_simplified[-1] - centre_pts_simplified[-2]
            else:
                tangent = centre_pts_simplified[i + 1] - centre_pts_simplified[i - 1]
            if tangent.GetLength() < 1e-6:
                tangent = XYZ(1, 0, 0)
            tangent = tangent.Normalize()
            perp = XYZ(-tangent.Y, tangent.X, 0) * side_sign
            offset_pts_simplified.append(centre_pts_simplified[i] + perp * offset_dist_ft)

    debug_print("    [RAY] Simplified centreline: {}".format(len(centre_pts_simplified)))
    debug_print("    [RAY] Offset points: {}".format(len(offset_pts_simplified)))
    if len(centre_pts_simplified) > 0:
        debug_print("    [RAY] Centreline first: ({:.2f},{:.2f}) last: ({:.2f},{:.2f})".format(
            centre_pts_simplified[0].X, centre_pts_simplified[0].Y,
            centre_pts_simplified[-1].X, centre_pts_simplified[-1].Y))
    if len(offset_pts_simplified) > 0:
        debug_print("    [RAY] Offset first: ({:.2f},{:.2f}) last: ({:.2f},{:.2f})".format(
            offset_pts_simplified[0].X, offset_pts_simplified[0].Y,
            offset_pts_simplified[-1].X, offset_pts_simplified[-1].Y))

    return centre_pts_simplified, offset_pts_simplified

# ----------------------------------------------------------------------
# Legacy centreline and boundary helpers (kept for compatibility)
# ----------------------------------------------------------------------
def compute_centreline_points(curves_ref, curves_other, num_samples=100):
    ref_points = get_points_from_curves(curves_ref, num_samples)
    other_dense_pts = get_points_from_curves(curves_other, max(num_samples * 4, 400))
    mid_points = []
    for pt in ref_points:
        closest_pt, dist, seg_i, t_seg, arc_len = get_closest_point_on_polyline(pt, other_dense_pts)
        if closest_pt is None:
            continue
        mid = (pt + closest_pt) / 2.0
        mid_points.append(mid)
    mid_points = simplify_polyline_collinear(mid_points, angle_tol_deg=1.0)
    return mid_points

def compute_outward_side_sign(building_path, opp_curves, num_samples=8):
    opp_pts = get_points_from_curves(opp_curves, max(20, num_samples * 4))
    n = len(building_path)
    if n < 2 or len(opp_pts) < 2:
        return 1
    step = max(1, n // num_samples)
    votes = 0
    for i in range(0, n, step):
        p = building_path[i]
        closest, dist, seg_i, t, _ = get_closest_point_on_polyline(p, opp_pts)
        if closest is None or seg_i < 0:
            continue
        a = opp_pts[seg_i]
        b = opp_pts[seg_i + 1]
        tangent = (b - a)
        if tangent.GetLength() < 1e-9:
            continue
        tangent = tangent.Normalize()
        left = XYZ(-tangent.Y, tangent.X, 0)
        to_p = p - closest
        side = 1 if left.DotProduct(to_p) >= 0 else -1
        votes += side
    return 1 if votes >= 0 else -1

def get_building_edges_and_normals(loop_pts, building_centroid):
    edges = []
    n = len(loop_pts)
    for i in range(n):
        p1 = loop_pts[i]
        p2 = loop_pts[(i+1) % n]
        edge_vec = p2 - p1
        if edge_vec.GetLength() < 1e-6:
            continue
        normal1 = XYZ(-edge_vec.Y, edge_vec.X, 0).Normalize()
        normal2 = XYZ(edge_vec.Y, -edge_vec.X, 0).Normalize()
        mid = (p1 + p2) / 2
        to_center = building_centroid - mid
        outward = normal1 if normal1.DotProduct(to_center) < 0 else normal2
        edges.append((p1, p2, outward))
    return edges

def group_contiguous_edges_with_cyclic_wrap(candidate_indices, total_edges):
    if not candidate_indices:
        return []
    sorted_indices = sorted(candidate_indices)
    blocks = []
    current = [sorted_indices[0]]
    for idx in sorted_indices[1:]:
        if idx == current[-1] + 1:
            current.append(idx)
        else:
            blocks.append(current)
            current = [idx]
    blocks.append(current)
    if len(blocks) > 1:
        first_block = blocks[0]
        last_block = blocks[-1]
        if (last_block[-1] + 1) % total_edges == first_block[0]:
            merged = last_block + first_block
            blocks = [merged] + blocks[1:-1]
    debug_print("  Candidate indices: {}".format(candidate_indices))
    debug_print("  Sorted indices: {}".format(sorted_indices))
    debug_print("  Blocks after grouping: {}".format(blocks))
    return blocks



def clip_opposite_by_centreline_span(opp_dense_pts, centre_points, P1, P2, margin_frac=0.1):
    """
    Keep opposite-BL dense points whose centreline arc-length falls within
    the span of P1/P2 (with margin). Falls back to full polyline if too few.
    """

    def s_on_centreline(pt):
        cl_foot, _ = project_point_to_centreline(pt, centre_points)
        if cl_foot is None:
            return None
        _, _, _, _, s = get_closest_point_on_polyline(cl_foot, centre_points)
        return s

    s1 = s_on_centreline(P1)
    s2 = s_on_centreline(P2)
    if s1 is None or s2 is None:
        return opp_dense_pts[:]

    s_min = min(s1, s2)
    s_max = max(s1, s2)
    margin = margin_frac * max(s_max - s_min, 1.0)
    s_lo = s_min - margin
    s_hi = s_max + margin

    clipped = []
    for pt in opp_dense_pts:
        s_pt = s_on_centreline(pt)
        if s_pt is not None and s_lo - 1e-6 <= s_pt <= s_hi + 1e-6:
            clipped.append(pt)

    if len(clipped) < 2:
        debug_print("    [TOPEDGE] centreline clip yielded {} pts; using full opp polyline".format(
            len(clipped)))
        return opp_dense_pts[:]

    debug_print("    [TOPEDGE] centreline clip: {} -> {} opp points".format(
        len(opp_dense_pts), len(clipped)))
    return clipped


def get_curved_top_polyline_from_points(opp_dense_pts, pt_start, pt_end, return_points=False):
    """
    Slice the dense opposite-boundary polyline between pt_start and pt_end
    by arc-length. Endpoints are interpolated exactly on the polyline.
    """
    _, _, _, _, s_start = get_closest_point_on_polyline(pt_start, opp_dense_pts)
    _, _, _, _, s_end = get_closest_point_on_polyline(pt_end, opp_dense_pts)

    total_opp = get_polyline_arc_length(opp_dense_pts)
    if total_opp > 1e-9:
        s_start = max(0.0, min(s_start, total_opp))
        s_end = max(0.0, min(s_end, total_opp))

    s_lo, s_hi = min(s_start, s_end), max(s_start, s_end)
    reverse = s_start > s_end

    start_exact = point_at_arclength_open(opp_dense_pts, s_start)
    end_exact = point_at_arclength_open(opp_dense_pts, s_end)

    slice_pts = [start_exact if not reverse else end_exact]
    arc_accum = 0.0
    for i in range(len(opp_dense_pts) - 1):
        a = opp_dense_pts[i]
        b = opp_dense_pts[i + 1]
        seg_len = a.DistanceTo(b)
        seg_s0 = arc_accum
        seg_s1 = arc_accum + seg_len
        if seg_s1 > s_lo + 1e-6 and seg_s0 < s_hi - 1e-6:
            if seg_s0 >= s_lo - 1e-6 and seg_s0 <= s_hi + 1e-6:
                if slice_pts[-1].DistanceTo(a) > 0.01:
                    slice_pts.append(a)
            if seg_s1 >= s_lo - 1e-6 and seg_s1 <= s_hi + 1e-6:
                if slice_pts[-1].DistanceTo(b) > 0.01:
                    slice_pts.append(b)
        arc_accum = seg_s1

    end_pt = end_exact if not reverse else start_exact
    if slice_pts[-1].DistanceTo(end_pt) > 0.01:
        slice_pts.append(end_pt)

    if reverse:
        slice_pts.reverse()

    clean_pts = []
    for p in slice_pts:
        if not clean_pts or p.DistanceTo(clean_pts[-1]) > 1e-6:
            clean_pts.append(p)

    debug_print("    [TOPEDGE] slice from ({:.2f},{:.2f}) to ({:.2f},{:.2f}), {} pts".format(
        clean_pts[0].X if clean_pts else 0, clean_pts[0].Y if clean_pts else 0,
        clean_pts[-1].X if clean_pts else 0, clean_pts[-1].Y if clean_pts else 0,
        len(clean_pts)))

    if return_points:
        return clean_pts

    lines = []
    for i in range(len(clean_pts) - 1):
        if clean_pts[i].DistanceTo(clean_pts[i + 1]) > 1e-6:
            lines.append(Line.CreateBound(clean_pts[i], clean_pts[i + 1]))
    return lines



