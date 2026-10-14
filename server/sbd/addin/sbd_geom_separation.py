# -*- coding: utf-8 -*-
"""S1 / S2 / S3 separating-distance geometry (PNAP APP-152, Fig B12/B14)."""

import math
from Autodesk.Revit.DB import XYZ, Line

from sbd_geom_base import (
    FEET_TO_METERS, polygon_area_2d, project_polygon_onto_axis,
    segment_segment_intersection,
)

MIN_S1_M = 7.5
MIN_S2_M = 15.0
MIN_ENCROACH_M = 3.0
MIN_S1_FT = MIN_S1_M / FEET_TO_METERS
MIN_S2_FT = MIN_S2_M / FEET_TO_METERS
MIN_ENCROACH_FT = MIN_ENCROACH_M / FEET_TO_METERS


def rotate_axis_xy(axis, degrees):
    """Rotate a unit axis vector in the XY plane."""
    rad = math.radians(degrees)
    c = math.cos(rad)
    s = math.sin(rad)
    return XYZ(axis.X * c - axis.Y * s, axis.X * s + axis.Y * c, 0).Normalize()


def axis_scalar_to_point(scalar, axis, ref_pt):
    """Convert a scalar projection on axis to an XYZ point."""
    ref_s = ref_pt.X * axis.X + ref_pt.Y * axis.Y
    delta = scalar - ref_s
    return XYZ(ref_pt.X + axis.X * delta, ref_pt.Y + axis.Y * delta, ref_pt.Z)


def point_to_segment_distance(pt, a, b):
    """Minimum distance from pt to segment ab."""
    ab = b - a
    len_sq = ab.X * ab.X + ab.Y * ab.Y
    if len_sq < 1e-12:
        return pt.DistanceTo(a), a
    t = ((pt.X - a.X) * ab.X + (pt.Y - a.Y) * ab.Y) / len_sq
    t = max(0.0, min(1.0, t))
    foot = XYZ(a.X + ab.X * t, a.Y + ab.Y * t, pt.Z)
    return pt.DistanceTo(foot), foot


def min_vertex_to_polyline(vertex, polyline_pts):
    """Min distance from one vertex to all edges of an open/closed polyline."""
    if not polyline_pts or len(polyline_pts) < 2:
        return float('inf'), None, None
    best = float('inf')
    best_v = None
    best_foot = None
    n = len(polyline_pts)
    closed = polyline_pts[0].DistanceTo(polyline_pts[-1]) < 0.01
    seg_count = n if closed else n - 1
    for i in range(seg_count):
        a = polyline_pts[i]
        b = polyline_pts[(i + 1) % n]
        d, foot = point_to_segment_distance(vertex, a, b)
        if d < best:
            best = d
            best_v = vertex
            best_foot = foot
    return best, best_v, best_foot


def min_vertices_to_edges(loop_a, loop_b):
    """
    Bidirectional vertex-to-edge minimum distance (S2 pinch point).
    Returns (distance_ft, vertex_a, vertex_b_or_foot).
    """
    best = float('inf')
    best_va = None
    best_vb = None
    for va in loop_a[:-1] if loop_a[0].DistanceTo(loop_a[-1]) < 0.01 else loop_a:
        d, v, foot = min_vertex_to_polyline(va, loop_b)
        if d < best:
            best = d
            best_va = v
            best_vb = foot
    for vb in loop_b[:-1] if loop_b[0].DistanceTo(loop_b[-1]) < 0.01 else loop_b:
        d, v, foot = min_vertex_to_polyline(vb, loop_a)
        if d < best:
            best = d
            best_va = foot
            best_vb = v
    return best, best_va, best_vb


def measure_s1(building_loop, boundary_pts):
    """
    S1 — setback from building vertices to site/street boundary.
    Returns dict with distance_ft, pass_bool, worst_vertex, foot_point.
    """
    best = float('inf')
    worst_v = None
    foot_pt = None
    verts = building_loop
    if verts and verts[0].DistanceTo(verts[-1]) < 0.01:
        verts = verts[:-1]
    for v in verts:
        d, _, f = min_vertex_to_polyline(v, boundary_pts)
        if d < best:
            best = d
            worst_v = v
            foot_pt = f
    encroach = best < MIN_ENCROACH_FT
    passed = best >= MIN_S1_FT and not encroach
    return {
        "type": "S1",
        "distance_ft": best,
        "distance_m": best * FEET_TO_METERS,
        "pass": passed,
        "worst_vertex": worst_v,
        "foot_point": foot_pt,
        "encroach_ft": best if encroach else None,
        "threshold_m": MIN_S1_M,
    }


def measure_s2(loop_a, loop_b):
    """S2 — internal air corridor between two buildings."""
    d, va, vb = min_vertices_to_edges(loop_a, loop_b)
    passed = d >= MIN_S2_FT
    return {
        "type": "S2",
        "distance_ft": d,
        "distance_m": d * FEET_TO_METERS,
        "pass": passed,
        "vertex_a": va,
        "vertex_b": vb,
        "threshold_m": MIN_S2_M,
    }


def measure_s3(gap_polygon_pts, boundary_pts, axis):
    """
    S3 — angled/irregular boundary: S3 = Area / Depth.
  Also enforces 3 m encroachment rule on boundary.
    """
    area = polygon_area_2d(gap_polygon_pts)
    # EXTENT, not the max coordinate. project_polygon_onto_axis returns
    # (min, max); unpacking as `_, depth` took the absolute position of the
    # far edge in project coordinates, so S3 = Area/Depth was divided by a
    # number that depends on where the site sits relative to the project
    # origin -- huge (S3 -> 0, automatic FAIL) on a site far from origin,
    # negative if the site straddles the origin on this axis. Every other
    # caller in the codebase does hi - lo.
    _d_lo, _d_hi = project_polygon_onto_axis(gap_polygon_pts, axis)
    depth = _d_hi - _d_lo
    if depth < 1e-9:
        return {
            "type": "S3", "distance_ft": 0.0, "distance_m": 0.0,
            "pass": False, "area_m2": 0.0, "depth_m": 0.0,
            "threshold_m": MIN_S1_M,
        }
    s3_ft = area / depth
    encroach = False
    min_boundary = float('inf')
    verts = gap_polygon_pts
    if verts and verts[0].DistanceTo(verts[-1]) < 0.01:
        verts = verts[:-1]
    for v in verts:
        d, _, _ = min_vertex_to_polyline(v, boundary_pts)
        if d < min_boundary:
            min_boundary = d
        if d < MIN_ENCROACH_FT:
            encroach = True
    passed = s3_ft >= MIN_S1_FT and not encroach
    return {
        "type": "S3",
        "distance_ft": s3_ft,
        "distance_m": s3_ft * FEET_TO_METERS,
        "pass": passed,
        "area_m2": area * FEET_TO_METERS * FEET_TO_METERS,
        "depth_m": depth * FEET_TO_METERS,
        "encroach_ft": min_boundary if encroach else None,
        "threshold_m": MIN_S1_M,
        "gap_polygon": gap_polygon_pts,
    }


def subtract_intervals(site_lo, site_hi, blocked_intervals):
    """Return open gap intervals within [site_lo, site_hi]."""
    gaps = []
    cursor = site_lo
    for lo, hi in blocked_intervals:
        if lo > cursor + 1e-9:
            gaps.append([cursor, lo])
        cursor = max(cursor, hi)
    if site_hi > cursor + 1e-9:
        gaps.append([cursor, site_hi])
    return gaps


def loop_interval_on_axis(loop_pts, axis):
    return project_polygon_onto_axis(loop_pts, axis)


def loops_overlapping_interval(building_loops, lo, hi, axis, tol=1e-6):
    """Return building loops whose axis projection overlaps [lo, hi]."""
    result = []
    for loop in building_loops:
        if not loop:
            continue
        b_lo, b_hi = loop_interval_on_axis(loop, axis)
        if b_hi >= lo - tol and b_lo <= hi + tol:
            result.append(loop)
    return result


def segment_hits_any_loop(seg_a, seg_b, loops):
    """True if segment ab intersects any edge of any building loop."""
    for loop in loops:
        n = len(loop)
        if n < 2:
            continue
        closed = loop[0].DistanceTo(loop[-1]) < 0.01
        count = n if closed else n - 1
        for i in range(count):
            a = loop[i]
            b = loop[(i + 1) % n]
            t, u, _ = segment_segment_intersection(seg_a, seg_b, a, b)
            if t is not None:
                return True
    return False


def continuity_check(gap_lo, gap_hi, axis_u, axis_v, site_pts, building_loops,
                     ref_pt, n_samples=10):
    """
    Cast rays along axis_v across the gap strip; fail if any sample is
    blocked by a building (dead-end detection).
    """
    v_lo, v_hi = project_polygon_onto_axis(site_pts, axis_v)
    if v_hi - v_lo < 1e-9:
        return True

    loops_in_gap = loops_overlapping_interval(building_loops, gap_lo, gap_hi, axis_u)
    if not loops_in_gap:
        return True

    for i in range(max(n_samples, 2)):
        t = gap_lo + (gap_hi - gap_lo) * i / float(max(n_samples - 1, 1))
        origin = axis_scalar_to_point(t, axis_u, ref_pt)
        seg_lo = axis_scalar_to_point(v_lo, axis_v, origin)
        seg_hi = axis_scalar_to_point(v_hi, axis_v, origin)
        if segment_hits_any_loop(seg_lo, seg_hi, loops_in_gap):
            return False
    return True


def classify_gap(gap_lo, gap_hi, site_lo, site_hi, merged_blocked, building_loops, axis):
    """
    Classify a 1D gap as left_setback, right_setback, or internal.
    Returns (gap_type, loop_a, loop_b) where loop_b may be None.
    """
    tol = 1e-6
    if not merged_blocked:
        return "open", None, None
    if gap_hi <= merged_blocked[0][0] + tol:
        loops = loops_overlapping_interval(building_loops, gap_lo, gap_hi, axis)
        return "left_setback", loops[0] if loops else None, None
    if gap_lo >= merged_blocked[-1][1] - tol:
        loops = loops_overlapping_interval(building_loops, gap_lo, gap_hi, axis)
        return "right_setback", loops[-1] if loops else None, None
    for i in range(len(merged_blocked) - 1):
        if gap_lo >= merged_blocked[i][1] - tol and gap_hi <= merged_blocked[i + 1][0] + tol:
            left_loops = loops_overlapping_interval(
                building_loops, merged_blocked[i][0], merged_blocked[i][1], axis)
            right_loops = loops_overlapping_interval(
                building_loops, merged_blocked[i + 1][0], merged_blocked[i + 1][1], axis)
            la = left_loops[-1] if left_loops else None
            rb = right_loops[0] if right_loops else None
            return "internal", la, rb
    return "internal", None, None
