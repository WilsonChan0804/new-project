# -*- coding: utf-8 -*-
"""Low‑level geometry utilities – no Revit API calls except XYZ/Line."""

import sys
import math
from Autodesk.Revit.DB import XYZ, Line

FEET_TO_METERS = 0.3048
TOLERANCE_FT = 0.5
DOT_THRESHOLD = 0.2
CURVE_SAMPLE_SEGMENTS = 30

def debug_print(msg):
    sys.stdout.write(msg + "\n")
    try:
        sys.stdout.flush()
    except Exception:
        pass

# ----------------------------------------------------------------------
# Tessellation & point conversion
# ----------------------------------------------------------------------

def tessellate_curve_to_points(curve, max_chord_len=None):
    """
    Converts a single Revit Curve (Line, Arc, Spline, etc.) into a dense
    point chain that follows its actual shape, instead of just taking its
    two endpoints. This is the fix for 'building contains a curve, can't
    read it': the old code only ever recorded GetEndPoint(0)/GetEndPoint(1)
    for every curve, which collapses any Arc or other non-straight curve
    into a single straight chord and silently discards its curvature.

    Uses Revit's own Tessellate() (adaptive, respects the curve's actual
    curvature) when available, then optionally densifies further if any
    segment exceeds max_chord_len.
    """
    try:
        pts = list(curve.Tessellate())
    except Exception:
        pts = [curve.GetEndPoint(0), curve.GetEndPoint(1)]

    if not pts:
        pts = [curve.GetEndPoint(0), curve.GetEndPoint(1)]

    # remove near-duplicate consecutive points from Tessellate()
    clean = [pts[0]]
    for p in pts[1:]:
        if p.DistanceTo(clean[-1]) > 1e-6:
            clean.append(p)

    if max_chord_len is None or max_chord_len <= 0:
        return clean

    out = [clean[0]]
    for i in range(len(clean) - 1):
        a, b = clean[i], clean[i + 1]
        seg_len = a.DistanceTo(b)
        if seg_len <= max_chord_len:
            out.append(b)
        else:
            steps = int(math.ceil(seg_len / max_chord_len))
            for k in range(1, steps + 1):
                t = float(k) / steps
                out.append(a + (b - a) * t)
    return out


def curveloop_to_points(curve_loop, max_chord_len=1.0):
    """
    Converts a full CurveLoop (a closed sequence of curves, possibly mixing
    Lines and Arcs) into a single dense, curvature-following point chain,
    using tessellate_curve_to_points on every curve in the loop.
    """
    pts = []
    for curve in curve_loop:
        seg_pts = tessellate_curve_to_points(curve, max_chord_len)
        if not pts:
            pts.extend(seg_pts)
        else:
            if pts[-1].DistanceTo(seg_pts[0]) > 0.01:
                pts.append(seg_pts[0])
            pts.extend(seg_pts[1:])
    if len(pts) > 1 and pts[0].DistanceTo(pts[-1]) < 0.01:
        pts.pop()
    return pts

def signed_area_2d(pts):
    if len(pts) < 3:
        return 0.0
    s = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i].X, pts[i].Y
        x2, y2 = pts[(i + 1) % n].X, pts[(i + 1) % n].Y
        s += x1 * y2 - x2 * y1
    return s * 0.5


def polygon_area_2d(pts):
    """Absolute (unsigned) shoelace area of a closed polygon in the XY plane.

    Thin wrapper over signed_area_2d, used for the site-area check in the
    Permeability (P) assessment. Returns 0.0 for degenerate inputs.
    """
    return abs(signed_area_2d(pts))


# ----------------------------------------------------------------------
# Permeability (P) projection helpers (PNAP APP-152, Design Requirement 2)
# ----------------------------------------------------------------------

def compute_dominant_axis(points):
    """
    Principal Component Analysis on a set of 2D points (XY plane only).

    Returns the first principal component as a unit XYZ vector (Axis 1) -
    the direction of maximum variance of the point cloud. Axis 2 is left to
    the caller as the in-plane orthogonal XYZ(-a.Y, a.X, 0).

    Implemented with a closed-form 2x2 covariance eigen-decomposition (no
    numpy, IronPython-safe). Falls back to the +X axis for degenerate input.
    """
    if not points or len(points) < 2:
        return XYZ(1, 0, 0)

    n = float(len(points))
    mx = sum(p.X for p in points) / n
    my = sum(p.Y for p in points) / n

    sxx = 0.0
    syy = 0.0
    sxy = 0.0
    for p in points:
        dx = p.X - mx
        dy = p.Y - my
        sxx += dx * dx
        syy += dy * dy
        sxy += dx * dy
    sxx /= n
    syy /= n
    sxy /= n

    # Eigenvalues of [[sxx, sxy], [sxy, syy]]
    tr = sxx + syy
    diff = sxx - syy
    disc = math.sqrt((diff * 0.5) * (diff * 0.5) + sxy * sxy)
    lambda_max = tr * 0.5 + disc

    # Eigenvector for the larger eigenvalue.
    if abs(sxy) > 1e-12:
        vx = lambda_max - syy
        vy = sxy
    else:
        # Diagonal covariance: axis is X or Y depending on which variance dominates.
        if sxx >= syy:
            vx, vy = 1.0, 0.0
        else:
            vx, vy = 0.0, 1.0

    length = math.sqrt(vx * vx + vy * vy)
    if length < 1e-12:
        return XYZ(1, 0, 0)
    return XYZ(vx / length, vy / length, 0)


def project_polygon_onto_axis(pts, axis):
    """
    Project every point onto 'axis' via the XY dot product (Z ignored) and
    return the 1D interval (min, max). Returns (0.0, 0.0) for empty input.
    """
    if not pts:
        return 0.0, 0.0
    values = [p.X * axis.X + p.Y * axis.Y for p in pts]
    return min(values), max(values)


def merge_overlapping_intervals(intervals):
    """
    Merge a list of [min, max] intervals into a minimal set of
    non-overlapping intervals. Overlapping OR touching intervals are merged
    (next.min <= current.max). Returns a sorted list of [min, max] lists.
    """
    cleaned = [[lo, hi] for (lo, hi) in intervals if hi >= lo]
    if not cleaned:
        return []
    cleaned.sort(key=lambda iv: iv[0])
    merged = [cleaned[0][:]]
    for lo, hi in cleaned[1:]:
        last = merged[-1]
        if lo <= last[1] + 1e-9:
            if hi > last[1]:
                last[1] = hi
        else:
            merged.append([lo, hi])
    return merged


def validate_projection(site_pts, building_loops, axis, tol=1e-6):
    """
    Validation for the auto-derived PCA projection axis: confirm that every
    building footprint's projected interval on 'axis' fits WITHIN the site
    boundary's projected interval (no negative gaps / clipping). Returns True
    only if all buildings are contained; False otherwise (triggers the manual
    line-pick fallback in the caller).

    building_loops: iterable of point lists (one closed loop per building).
    """
    site_min, site_max = project_polygon_onto_axis(site_pts, axis)
    if site_max - site_min < tol:
        return False
    for loop in building_loops:
        if not loop:
            continue
        b_min, b_max = project_polygon_onto_axis(loop, axis)
        if b_min < site_min - tol or b_max > site_max + tol:
            return False
    return True


def get_points_from_curves(curves, num_samples):
    total_len = sum(c.Length for c in curves)
    points = []
    for i in range(num_samples + 1):
        target_dist = (i / float(num_samples)) * total_len
        accumulated = 0.0
        for curve in curves:
            curve_len = curve.Length
            if target_dist <= accumulated + curve_len:
                t = (target_dist - accumulated) / curve_len
                points.append(curve.Evaluate(t, True))
                break
            accumulated += curve_len
    return points

def simplify_polyline_collinear(pts, angle_tol_deg=1.0, min_seg_len=None):
    """
    Removes points that don't meaningfully change direction (i.e. the
    polyline is locally straight, or locally close to a constant-radius
    arc within tolerance), so a centreline built from many dense samples
    collapses down to a clean, simplified line instead of staying jagged.
    Endpoints are always preserved.
    """
    if len(pts) < 3:
        return pts[:]
    out = [pts[0]]
    i = 1
    while i < len(pts) - 1:
        prev = out[-1]
        cur = pts[i]
        nxt = pts[i + 1]
        v1 = cur - prev
        v2 = nxt - cur
        l1 = v1.GetLength()
        l2 = v2.GetLength()
        if l1 < 1e-6 or l2 < 1e-6:
            i += 1
            continue
        v1n = v1.Normalize()
        v2n = v2.Normalize()
        dot = max(-1.0, min(1.0, v1n.DotProduct(v2n)))
        ang_deg = math.degrees(math.acos(dot))
        if ang_deg > angle_tol_deg:
            out.append(cur)
        i += 1
    out.append(pts[-1])
    return out



# ----------------------------------------------------------------------
# Projection, distance, polyline helpers
# ----------------------------------------------------------------------

def get_closest_point_on_polyline_windowed(pt, polyline_pts, hint_arc_len=None, window=None):
    """
    Same as get_closest_point_on_polyline, but optionally restricts the
    search to a local arc-length WINDOW around hint_arc_len (if given).
    This fixes a real bug: a pure global closest-point search can latch
    onto a distant, unrelated part of a concave/zigzag boundary that
    happens to be slightly closer in raw Euclidean distance than the
    point actually 'across the street' from pt - producing a wild,
    geometrically wrong projection line. Restricting to a window around
    a known-reasonable arc-length neighbourhood avoids this.
    """
    if hint_arc_len is None or window is None:
        return get_closest_point_on_polyline(pt, polyline_pts)

    total = get_polyline_arc_length(polyline_pts)
    lo = hint_arc_len - window
    hi = hint_arc_len + window

    best_pt = None
    best_dist = float('inf')
    best_seg_i = -1
    best_t = 0.0
    best_arc_len = 0.0
    arc_len_accum = 0.0

    n = len(polyline_pts)
    for i in range(n - 1):
        a = polyline_pts[i]
        b = polyline_pts[i + 1]
        seg_len = a.DistanceTo(b)
        seg_s0 = arc_len_accum
        seg_s1 = arc_len_accum + seg_len
        arc_len_accum = seg_s1

        # skip segments entirely outside the window
        if seg_s1 < lo or seg_s0 > hi:
            continue

        seg_vec = b - a
        seg_len_sq = seg_vec.X * seg_vec.X + seg_vec.Y * seg_vec.Y
        if seg_len_sq < 1e-9:
            t_clamped = 0.0
            proj = a
        else:
            to_pt = pt - a
            t = (to_pt.X * seg_vec.X + to_pt.Y * seg_vec.Y) / seg_len_sq
            t_clamped = max(0.0, min(1.0, t))
            proj = a + seg_vec * t_clamped

        dist = pt.DistanceTo(proj)
        if dist < best_dist:
            best_dist = dist
            best_pt = proj
            best_seg_i = i
            best_t = t_clamped
            best_arc_len = seg_s0 + seg_len * t_clamped

    if best_pt is None:
        # window found nothing (e.g. hint was bad) - fall back to global search
        return get_closest_point_on_polyline(pt, polyline_pts)

    return best_pt, best_dist, best_seg_i, best_t, best_arc_len


def get_closest_point_on_polyline(pt, polyline_pts):
    """
    Robust closest-point-to-polyline projection (point-to-segment, clamped,
    global minimum over all segments). This replaces 'cast a ray in a fixed
    perpendicular direction' with 'find the true nearest point on the target
    curve', which is correct regardless of how the target curve bends.

    Returns (closest_point, distance, segment_index, t_on_segment, arc_length_to_point)
    or (None, inf, -1, 0.0, 0.0) if polyline_pts has fewer than 2 points.
    """
    best_pt = None
    best_dist = float('inf')
    best_seg_i = -1
    best_t = 0.0
    best_arc_len = 0.0
    arc_len_accum = 0.0

    n = len(polyline_pts)
    if n < 2:
        return None, float('inf'), -1, 0.0, 0.0

    for i in range(n - 1):
        a = polyline_pts[i]
        b = polyline_pts[i + 1]
        seg_vec = b - a
        seg_len_sq = seg_vec.X * seg_vec.X + seg_vec.Y * seg_vec.Y
        seg_len = math.sqrt(seg_len_sq) if seg_len_sq > 0 else 0.0

        if seg_len_sq < 1e-9:
            t = 0.0
            proj = a
        else:
            to_pt = pt - a
            t = (to_pt.X * seg_vec.X + to_pt.Y * seg_vec.Y) / seg_len_sq
            t_clamped = max(0.0, min(1.0, t))
            proj = a + seg_vec * t_clamped
            t = t_clamped

        dist = pt.DistanceTo(proj)
        if dist < best_dist:
            best_dist = dist
            best_pt = proj
            best_seg_i = i
            best_t = t
            best_arc_len = arc_len_accum + seg_len * t

        arc_len_accum += seg_len

    return best_pt, best_dist, best_seg_i, best_t, best_arc_len


def point_at_arclength_closed(path, s, total=None):
    """
    Point on a CLOSED polyline path at forward arc-length distance s from
    path[0], wrapping around the loop. Ported from the Dynamo
    point_at_s_closed helper.
    """
    n = len(path)
    if total is None:
        total = sum(path[i].DistanceTo(path[(i + 1) % n]) for i in range(n))
    if total < 1e-9:
        return path[0]
    s = s % total
    acc = 0.0
    for i in range(n):
        a = path[i]
        b = path[(i + 1) % n]
        seg_l = a.DistanceTo(b)
        if acc + seg_l >= s - 1e-9:
            t = (s - acc) / seg_l if seg_l > 1e-9 else 0.0
            t = max(0.0, min(1.0, t))
            return a + (b - a) * t
        acc += seg_l
    return path[-1]


def point_at_arclength_open(polyline_pts, s):
    """Point on an open polyline at arc-length s from polyline_pts[0]."""
    if len(polyline_pts) < 2:
        return polyline_pts[0] if polyline_pts else XYZ.Zero
    total = get_polyline_arc_length(polyline_pts)
    if total < 1e-9:
        return polyline_pts[0]
    s = max(0.0, min(s, total))
    acc = 0.0
    for i in range(len(polyline_pts) - 1):
        a = polyline_pts[i]
        b = polyline_pts[i + 1]
        seg_l = a.DistanceTo(b)
        if acc + seg_l >= s - 1e-9:
            t = (s - acc) / seg_l if seg_l > 1e-9 else 0.0
            t = max(0.0, min(1.0, t))
            return a + (b - a) * t
        acc += seg_l
    return polyline_pts[-1]


def forward_arc_len(s0, s1, total):
    """Forward (wrap-aware) distance from s0 to s1 along a closed loop of length total."""
    if s1 >= s0:
        return s1 - s0
    return (total - s0) + s1




def subpath_closed_arclength(path, s0, s1, total=None):
    """
    Extracts the portion of a CLOSED polyline path between arc-length
    positions s0 and s1, walking FORWARD (wrapping if needed). Ported from
    the Dynamo subpath_closed helper. Returns a list of XYZ points
    starting at the point for s0 and ending at the point for s1.
    """
    n = len(path)
    if total is None:
        total = sum(path[i].DistanceTo(path[(i + 1) % n]) for i in range(n))
    if total < 1e-9:
        return []
    s0 = s0 % total
    s1 = s1 % total
    if s1 < s0:
        s1 += total

    pts = [point_at_arclength_closed(path, s0, total)]
    acc = 0.0
    for i in range(n):
        a = path[i]
        b = path[(i + 1) % n]
        seg_l = a.DistanceTo(b)
        seg_end = acc + seg_l
        if seg_end > s0 + 1e-9 and acc < s1 - 1e-9:
            if seg_end <= s1 + 1e-9:
                pts.append(b)
            else:
                t = (s1 - acc) / seg_l if seg_l > 1e-9 else 0.0
                pts.append(a + (b - a) * max(0.0, min(1.0, t)))
                break
        acc += seg_l

    out = [pts[0]]
    for p in pts[1:]:
        if p.DistanceTo(out[-1]) > 0.01:
            out.append(p)
    return out


def is_s_on_forward_arc(s, s0, s1, total):
    """True if arc-length position s lies on the forward (wrap-aware) arc from s0 to s1."""
    rel = forward_arc_len(s0, s, total)
    span = forward_arc_len(s0, s1, total)
    return rel <= span + 0.01  # 0.01 ft (~3mm) tolerance for accumulated float error



def get_polyline_arc_length(pts):
    """Total length of an open polyline (list of XYZ points)."""
    total = 0.0
    for i in range(len(pts) - 1):
        total += pts[i].DistanceTo(pts[i + 1])
    return total


def project_point_to_centreline(pt, centre_points):
    best_pt = None
    best_dist = float('inf')
    for i in range(len(centre_points)-1):
        seg_start = centre_points[i]
        seg_end = centre_points[i+1]
        seg_vec = seg_end - seg_start
        seg_len_sq = seg_vec.X*seg_vec.X + seg_vec.Y*seg_vec.Y
        if seg_len_sq < 1e-9:
            continue
        to_pt = pt - seg_start
        t = (to_pt.X*seg_vec.X + to_pt.Y*seg_vec.Y) / seg_len_sq
        if t < 0:
            proj = seg_start
        elif t > 1:
            proj = seg_end
        else:
            proj = seg_start + seg_vec * t
        dist = pt.DistanceTo(proj)
        if dist < best_dist:
            best_dist = dist
            best_pt = proj
    return best_pt, best_dist




def distance_along_centreline_between_points(p1, p2, centre_points):
    proj1, _ = project_point_to_centreline(p1, centre_points)
    proj2, _ = project_point_to_centreline(p2, centre_points)
    if proj1 is None or proj2 is None:
        debug_print("      distance_along: projection failed")
        return 0.0
    if proj1.DistanceTo(proj2) < 0.01:
        debug_print("      distance_along: projected points coincide")
        return 0.0
    def get_segment_and_t(pt, centre_points):
        for i in range(len(centre_points)-1):
            seg_start = centre_points[i]
            seg_end = centre_points[i+1]
            seg_vec = seg_end - seg_start
            seg_len = seg_vec.GetLength()
            if seg_len < 1e-6:
                continue
            to_pt = pt - seg_start
            t = to_pt.DotProduct(seg_vec) / (seg_len * seg_len)
            t_clamped = max(0.0, min(1.0, t))
            proj_on_seg = seg_start + seg_vec * t_clamped
            if proj_on_seg.DistanceTo(pt) < 0.01:
                return i, t_clamped, seg_len
        return None, 0.0, 0.0
    idx1, t1, _ = get_segment_and_t(proj1, centre_points)
    idx2, t2, _ = get_segment_and_t(proj2, centre_points)
    if idx1 is None or idx2 is None:
        debug_print("      distance_along: could not locate segment for projected point")
        return 0.0
    if idx1 > idx2:
        idx1, idx2 = idx2, idx1
        t1, t2 = t2, t1
    total = 0.0
    seg_start1 = centre_points[idx1]
    seg_end1 = centre_points[idx1+1]
    seg_len1 = seg_start1.DistanceTo(seg_end1)
    total += (1.0 - t1) * seg_len1
    for i in range(idx1+1, idx2):
        total += centre_points[i].DistanceTo(centre_points[i+1])
    if idx2 > idx1:
        seg_start2 = centre_points[idx2]
        seg_end2 = centre_points[idx2+1]
        seg_len2 = seg_start2.DistanceTo(seg_end2)
        total += t2 * seg_len2
    else:
        total = abs(t2 - t1) * seg_len1
    debug_print("      distance_along: total = {:.3f} ft".format(total))
    return total





def ensure_loop_ccw(loop_pts):
    """
    Reverse a closed building loop if it is clockwise, so that it is
    consistently counter-clockwise when viewed from above (+Z normal).
    Revit API guarantees outer Face edge loops are CCW, but linked-model
    or FilledRegion extraction can yield CW loops, which swaps the
    forward/alternate arc and breaks downstream geometry. Uses the
    signed-area (shoelace) test.
    """
    n = len(loop_pts)
    if n < 3:
        return list(loop_pts)
    s = 0.0
    for i in range(n):
        x1, y1 = loop_pts[i].X, loop_pts[i].Y
        x2, y2 = loop_pts[(i + 1) % n].X, loop_pts[(i + 1) % n].Y
        s += (x2 - x1) * (y2 + y1)
    # s > 0 => clockwise in this formulation; reverse to get CCW
    if s > 0:
        return list(reversed(loop_pts))
    return list(loop_pts)


def centreline_local_perp(P, centre_points):
    """
    Perpendicular to the centreline at the segment closest to P, oriented
    to point from P through the centreline toward the opposite BL side.

    This implements the PNAP APP-152 requirement that U is 'measured
    perpendicular to the centreline of the street'. The global outward
    normal does not follow the centreline's curvature; this local
    perpendicular does.

    Returns an XYZ direction (normalized), or None if no valid centreline
    segment is found.
    """
    best_seg = -1
    best_t = 0.0
    best_dist = float('inf')
    for i in range(len(centre_points) - 1):
        seg_start = centre_points[i]
        seg_end = centre_points[i + 1]
        seg_vec = seg_end - seg_start
        seg_len_sq = seg_vec.X * seg_vec.X + seg_vec.Y * seg_vec.Y
        if seg_len_sq < 1e-9:
            continue
        to_pt = P - seg_start
        t = (to_pt.X * seg_vec.X + to_pt.Y * seg_vec.Y) / seg_len_sq
        t_clamped = max(0.0, min(1.0, t))
        foot = seg_start + seg_vec * t_clamped
        dist = P.DistanceTo(foot)
        if dist < best_dist:
            best_dist = dist
            best_seg = i
            best_t = t_clamped

    if best_seg == -1:
        return None

    seg_start = centre_points[best_seg]
    seg_end = centre_points[best_seg + 1]
    tangent = seg_end - seg_start
    tan_len = tangent.GetLength()
    if tan_len < 1e-9:
        return None
    tangent = tangent / tan_len
    perp = XYZ(-tangent.Y, tangent.X, 0)

    # Flip so perp points from P toward the centreline (and beyond to opposite BL)
    foot = seg_start + (seg_end - seg_start) * best_t
    if perp.DotProduct(foot - P) < 0:
        perp = XYZ(tangent.Y, -tangent.X, 0)

    return perp


def signed_distance_to_offset_side(pt, offset_path, street_sign):
    """
    Signed distance from pt to the offset polyline: positive means pt is
    on the street_sign side of the offset line (i.e. INSIDE the 30m zone,
    between the centreline and the offset line), negative means it is
    beyond the offset line. Ported from the Dynamo signed_dist_to_offset
    helper - this is the validation step missing from the current API
    script's facade selection, which currently builds a canyon from
    whatever the single largest contiguous street-facing edge block
    happens to be, without ever confirming that block actually falls
    inside the 30m zone.
    """
    best_d = float('inf')
    best_signed = 0.0
    for i in range(len(offset_path) - 1):
        a = offset_path[i]
        b = offset_path[i + 1]
        seg_vec = b - a
        seg_len_sq = seg_vec.X * seg_vec.X + seg_vec.Y * seg_vec.Y
        if seg_len_sq < 1e-9:
            continue
        t = max(0.0, min(1.0, (pt - a).DotProduct(seg_vec) / seg_len_sq))
        q = a + seg_vec * t
        d = pt.DistanceTo(q)
        if d < best_d:
            tangent = seg_vec.Normalize()
            left = XYZ(-tangent.Y, tangent.X, 0)
            perp = pt - q
            side = 1 if left.DotProduct(perp) >= 0 else -1
            best_signed = d * side * street_sign
            best_d = d
    return best_signed


# ----------------------------------------------------------------------
# Intersection & clipping
# ----------------------------------------------------------------------
def segment_segment_intersection(a1, a2, b1, b2):
    """
    Bounded segment-vs-segment intersection (not ray-vs-segment).
    Returns (t, u, point) where t,u are in [0,1] along (a1->a2) and (b1->b2)
    respectively, or (None, None, None) if the segments do not cross within
    their bounds.
    """
    r = a2 - a1
    s = b2 - b1
    denom = r.X * s.Y - r.Y * s.X
    if abs(denom) < 1e-9:
        return None, None, None
    diff = b1 - a1
    t = (diff.X * s.Y - diff.Y * s.X) / denom
    u = (diff.X * r.Y - diff.Y * r.X) / denom
    if -1e-9 <= t <= 1.0 + 1e-9 and -1e-9 <= u <= 1.0 + 1e-9:
        t_c = max(0.0, min(1.0, t))
        point = a1 + r * t_c
        return t_c, u, point
    return None, None, None


def find_polyline_intersections(path_a, path_b, closed_a=True):
    """
    Find all crossing points between polyline path_a (e.g. building footprint,
    optionally treated as a CLOSED loop) and path_b (e.g. the 30m offset line,
    treated as OPEN). For each crossing, also records the arc-length position
    of the hit along path_a (sA) measured from path_a[0], walking forward,
    wrapping around if closed_a=True.

    This is the fix for Problem 1: a building edge that crosses the 30m offset
    line mid-span produces a genuine new vertex here, instead of only ever
    using the building's existing corner points.

    Returns a list of dicts: {"pt": XYZ, "sA": float, "type": "intersection"}
    sorted by sA ascending (deduplicated against near-coincident hits).
    """
    hits = []
    n_a = len(path_a)
    edge_count_a = n_a if closed_a else n_a - 1

    sA_accum = 0.0
    for i in range(edge_count_a):
        a1 = path_a[i]
        a2 = path_a[(i + 1) % n_a]
        edge_len_a = a1.DistanceTo(a2)

        for j in range(len(path_b) - 1):
            b1 = path_b[j]
            b2 = path_b[j + 1]
            t, u, pt_int = segment_segment_intersection(a1, a2, b1, b2)
            if pt_int is not None:
                sA = sA_accum + edge_len_a * t
                hits.append({"pt": pt_int, "sA": sA, "type": "intersection"})

        sA_accum += edge_len_a

    hits.sort(key=lambda h: h["sA"])
    deduped = []
    for h in hits:
        if not deduped or h["pt"].DistanceTo(deduped[-1]["pt"]) > 0.01:
            deduped.append(h)
        else:
            deduped[-1] = h
    return deduped


def _subpath_open_arclength(polyline_pts, s0, s1):
    """
    Extract the portion of an OPEN polyline between arc-length positions s0
    and s1 (measured from polyline_pts[0]). Returns points from s0 to s1
    inclusive, walking forward along the chain.
    """
    if len(polyline_pts) < 2:
        return []

    total = get_polyline_arc_length(polyline_pts)
    if total < 1e-9:
        return []

    s0 = max(0.0, min(s0, total))
    s1 = max(0.0, min(s1, total))
    if s1 < s0:
        s0, s1 = s1, s0

    pts = [point_at_arclength_open(polyline_pts, s0)]
    acc = 0.0
    for i in range(len(polyline_pts) - 1):
        a = polyline_pts[i]
        b = polyline_pts[i + 1]
        seg_l = a.DistanceTo(b)
        seg_end = acc + seg_l
        if seg_end > s0 + 1e-9 and acc < s1 - 1e-9:
            if seg_end <= s1 + 1e-9:
                pts.append(b)
            else:
                t = (s1 - acc) / seg_l if seg_l > 1e-9 else 0.0
                pts.append(a + (b - a) * max(0.0, min(1.0, t)))
                break
        acc += seg_l

    out = [pts[0]]
    for p in pts[1:]:
        if p.DistanceTo(out[-1]) > 0.01:
            out.append(p)
    return out


def clip_polyline_by_other(polyline, clip_polyline, tol=1e-6):
    """
    Clip an open polyline by its crossings with another open polyline.

    Computes segment-segment intersections between polyline (e.g. the selected
    facade chain) and clip_polyline (e.g. the 30 m offset line). When there
    are at least two distinct crossings, returns the sub-chain between the
    first and last crossing (by arc-length along polyline) and the exact
    intersection points P1/P2 for lateral origins.

    Returns (clipped_pts, P1, P2) on success, or (None, None, None).
    """
    if not polyline or len(polyline) < 2:
        return None, None, None
    if not clip_polyline or len(clip_polyline) < 2:
        return None, None, None

    hits = find_polyline_intersections(polyline, clip_polyline, closed_a=False)
    if len(hits) < 2:
        return None, None, None

    s0 = hits[0]["sA"]
    s1 = hits[-1]["sA"]
    P1 = hits[0]["pt"]
    P2 = hits[-1]["pt"]

    if len(hits) > 2:
        debug_print("    [CLIP] More than 2 hits ({}). Using outermost crossings "
                     "s0={:.3f}, s1={:.3f}".format(len(hits), s0, s1))

    clipped = _subpath_open_arclength(polyline, s0, s1)
    if not clipped or len(clipped) < 2:
        return None, None, None

    clipped[0] = P1
    clipped[-1] = P2

    debug_print("    [CLIP] Facade trimmed to offset: {} pts, "
                 "P1=({:.2f},{:.2f}) P2=({:.2f},{:.2f})".format(
                     len(clipped), P1.X, P1.Y, P2.X, P2.Y))
    return clipped, P1, P2


def ray_segment_intersection(p, v, a, b):
    w = b - a
    denom = v.X * w.Y - v.Y * w.X
    if abs(denom) < 1e-9:
        return None, None, None
    diff = a - p
    t = (diff.X * w.Y - diff.Y * w.X) / denom
    u = (diff.X * v.Y - diff.Y * v.X) / denom
    if t > 1e-6 and 0.0 <= u <= 1.0:
        point = p + v * t
        return t, u, point
    return None, None, None


def get_closest_point_on_curves(pt, curves):
    best_dist = float('inf')
    best_pt = None
    for curve in curves:
        if isinstance(curve, Line):
            start = curve.GetEndPoint(0)
            end = curve.GetEndPoint(1)
            seg_vec = end - start
            seg_len = seg_vec.GetLength()
            if seg_len < 1e-6:
                continue
            to_pt = pt - start
            t = to_pt.DotProduct(seg_vec) / (seg_len * seg_len)
            if t < 0:
                closest = start
            elif t > 1:
                closest = end
            else:
                closest = start + seg_vec * t
            dist = pt.DistanceTo(closest)
            if dist < best_dist:
                best_dist = dist
                best_pt = closest
        else:
            length = curve.Length
            num = max(20, int(length / 0.5))
            for i in range(num+1):
                t_curve = i / float(num)
                pt_curve = curve.Evaluate(t_curve, True)
                dist = pt.DistanceTo(pt_curve)
                if dist < best_dist:
                    best_dist = dist
                    best_pt = pt_curve
    return best_pt



def closest_point_on_segment_to_ray(p, v, a, b):
    w = b - a
    w_len_sq = w.X*w.X + w.Y*w.Y
    if w_len_sq < 1e-9:
        d1 = (p - a).GetLength()
        d2 = (p - b).GetLength()
        return (a, d1, 0.0) if d1 < d2 else (b, d2, 0.0)
    diff = p - a
    u = (diff.X * w.X + diff.Y * w.Y) / w_len_sq
    u_clamped = max(0.0, min(1.0, u))
    closest_on_seg = a + w * u_clamped
    to_point = closest_on_seg - p
    v_len_sq = v.X*v.X + v.Y*v.Y
    if v_len_sq < 1e-9:
        return closest_on_seg, to_point.GetLength(), 0.0
    t_on_ray = (to_point.X * v.X + to_point.Y * v.Y) / v_len_sq
    point_on_ray = p + v * t_on_ray
    distance = point_on_ray.DistanceTo(closest_on_seg)
    return closest_on_seg, distance, t_on_ray

def get_intersection_robust(pt, direction, target_curves, tolerance=TOLERANCE_FT, debug_label=""):
    best_point = None
    best_distance = float('inf')
    source = None
    for curve in target_curves:
        if isinstance(curve, Line):
            a = curve.GetEndPoint(0)
            b = curve.GetEndPoint(1)
            t, u, pt_int = ray_segment_intersection(pt, direction, a, b)
            if pt_int is not None:
                dist = pt.DistanceTo(pt_int)
                if dist < best_distance:
                    best_distance = dist
                    best_point = pt_int
                    source = "intersection"
                    debug_print("    {} Stage1 hit: t={:.1f} point=({:.1f},{:.1f})".format(debug_label, t, pt_int.X, pt_int.Y))
                continue
            closest_pt, dist, _ = closest_point_on_segment_to_ray(pt, direction, a, b)
            if dist < tolerance and dist < best_distance:
                best_distance = dist
                best_point = closest_pt
                source = "clamped"
                debug_print("    {} Stage2 clamped: dist={:.3f} point=({:.1f},{:.1f})".format(debug_label, dist, closest_pt.X, closest_pt.Y))
        else:
            length = curve.Length
            num = max(20, int(length / 0.5))
            for i in range(num+1):
                t_curve = i / float(num)
                pt_on_curve = curve.Evaluate(t_curve, True)
                vec = pt_on_curve - pt
                cross = direction.X * vec.Y - direction.Y * vec.X
                if abs(cross) > tolerance:
                    continue
                t_param = vec.DotProduct(direction)
                if t_param > 0:
                    dist = pt.DistanceTo(pt_on_curve)
                    if dist < best_distance:
                        best_distance = dist
                        best_point = pt_on_curve
                        source = "sampled"
                        debug_print("    {} Sampled: t={:.1f} point=({:.1f},{:.1f})".format(debug_label, t_param, pt_on_curve.X, pt_on_curve.Y))
    if best_point is None:
        debug_print("    {} No intersection found".format(debug_label))
    return best_point, source




def clip_polyline_to_interval(vertices, axis, t_min, t_max):
    """
    Clip a polyline (list of XYZ points) to the interval [t_min, t_max] along 'axis'.
    Returns a list of XYZ points of the clipped polyline.
    """
    if not vertices or len(vertices) < 2:
        debug_print("  clip_polyline: empty or insufficient vertices")
        return []
    output = []
    n = len(vertices)
    debug_print("  Clipping interval: t_min={:.3f}, t_max={:.3f} along axis ({:.4f},{:.4f})".format(t_min, t_max, axis.X, axis.Y))
    for i in range(n-1):
        v_i = vertices[i]
        v_next = vertices[i+1]
        t_i = v_i.DotProduct(axis)
        t_next = v_next.DotProduct(axis)
        inside_i = (t_i >= t_min - 0.001) and (t_i <= t_max + 0.001)
        inside_next = (t_next >= t_min - 0.001) and (t_next <= t_max + 0.001)
        debug_print("    Edge {}: t_i={:.3f} (inside={}), t_next={:.3f} (inside={})".format(i, t_i, inside_i, t_next, inside_next))

        def intersect_at_boundary(v1, v2, t_boundary):
            t1 = v1.DotProduct(axis)
            t2 = v2.DotProduct(axis)
            if abs(t2 - t1) < 1e-9:
                return v1
            s = (t_boundary - t1) / (t2 - t1)
            s = max(0.0, min(1.0, s))
            pt = v1 + (v2 - v1) * s
            debug_print("      Intersect at t={:.3f}: point=({:.2f},{:.2f})".format(t_boundary, pt.X, pt.Y))
            return pt

        if inside_i and inside_next:
            if not output:
                output.append(v_i)
                debug_print("      Added first point: ({:.2f},{:.2f})".format(v_i.X, v_i.Y))
            output.append(v_next)
            debug_print("      Added inside point: ({:.2f},{:.2f})".format(v_next.X, v_next.Y))
        elif inside_i and not inside_next:
            # leaving the interval
            if t_next > t_max:
                pt = intersect_at_boundary(v_i, v_next, t_max)
            else:
                pt = intersect_at_boundary(v_i, v_next, t_min)
            if not output:
                output.append(v_i)
                debug_print("      Added first point: ({:.2f},{:.2f})".format(v_i.X, v_i.Y))
            output.append(pt)
            debug_print("      Added exit intersection: ({:.2f},{:.2f})".format(pt.X, pt.Y))
        elif not inside_i and inside_next:
            # entering the interval
            if t_i < t_min:
                pt = intersect_at_boundary(v_i, v_next, t_min)
            else:  # t_i > t_max
                pt = intersect_at_boundary(v_i, v_next, t_max)
            if not output:
                output.append(pt)
                debug_print("      Added entry intersection as first: ({:.2f},{:.2f})".format(pt.X, pt.Y))
            else:
                output.append(pt)
                debug_print("      Added entry intersection: ({:.2f},{:.2f})".format(pt.X, pt.Y))
            output.append(v_next)
            debug_print("      Added inside point: ({:.2f},{:.2f})".format(v_next.X, v_next.Y))
        else:
            # both outside – check if they span the whole interval
            if (t_i < t_min and t_next > t_max) or (t_i > t_max and t_next < t_min):
                debug_print("      Edge spans the whole interval (both outside, opposite sides)")
                if t_i < t_min:
                    pt1 = intersect_at_boundary(v_i, v_next, t_min)
                    pt2 = intersect_at_boundary(v_i, v_next, t_max)
                else:
                    pt1 = intersect_at_boundary(v_i, v_next, t_max)
                    pt2 = intersect_at_boundary(v_i, v_next, t_min)
                if not output:
                    output.append(pt1)
                    debug_print("      Added entry pt1: ({:.2f},{:.2f})".format(pt1.X, pt1.Y))
                output.append(pt2)
                debug_print("      Added exit pt2: ({:.2f},{:.2f})".format(pt2.X, pt2.Y))
            else:
                debug_print("      Both outside on same side, skipping edge")

    # Remove duplicate consecutive points
    if output and len(output) > 1:
        unique = []
        for p in output:
            if not unique or p.DistanceTo(unique[-1]) > 0.01:
                unique.append(p)
        debug_print("  Final unique clipped vertices: {}".format(len(unique)))
        for idx, p in enumerate(unique):
            debug_print("    {}. ({:.2f},{:.2f})".format(idx, p.X, p.Y))
        return unique
    return output
