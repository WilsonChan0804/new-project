# -*- coding: utf-8 -*-
"""Hybrid 1D/2D permeability and separating-distance engine (PNAP APP-152).

From the SBD panel's sbd_permeability.py. One change: for a gap between two
buildings, S2 is measured between the NEAREST pair of footprint loops on
either side (the add-in took the last loop of the left block and the first
of the right one - not always the two facing each other, e.g. when two
buildings overlap in projection, or a building is several loops from 3D).
run_full_assessment is kept for reference; the server runs each zone with
its own footprints (engine.py)."""

import math
from .xyz import XYZ

from .geom import (
    FEET_TO_METERS, debug_print, polygon_area_2d,
    project_polygon_onto_axis, merge_overlapping_intervals,
    compute_dominant_axis, validate_projection,
)
from .separation import (
    MIN_S1_FT, MIN_S1_M, MIN_S2_FT, rotate_axis_xy,
    subtract_intervals, classify_gap, measure_s2, measure_s3,
    continuity_check, axis_scalar_to_point, loops_overlapping_interval,
    min_vertices_to_edges,
)


def _nearest_pair(gap_lo, gap_hi, merged, building_loops, axis):
    """The two loops facing each other across an internal gap: of the loops
    in the blocks left and right of it, the pair closest together."""
    left = right = None
    for lo, hi in merged:
        if hi <= gap_lo + 1e-6:
            left = (lo, hi)
        elif lo >= gap_hi - 1e-6 and right is None:
            right = (lo, hi)
    if not left or not right:
        return None, None
    la = loops_overlapping_interval(building_loops, left[0], left[1], axis)
    lb = loops_overlapping_interval(building_loops, right[0], right[1], axis)
    best = (None, None, float("inf"))
    for a in la:
        for b in lb:
            d = min_vertices_to_edges(a, b)[0]
            if d < best[2]:
                best = (a, b, d)
    return best[0], best[1]

ZONE_LOW = "LOW"
ZONE_MID = "MIDDLE"
ZONE_HIGH = "HIGH"

ZONE_CONFIG = {
    ZONE_LOW: {"z_min_m": 0.0, "z_max_m": 20.0, "functional": True},
    ZONE_MID: {"z_min_m": 20.0, "z_max_m": 60.0, "functional": False},
    ZONE_HIGH: {"z_min_m": 60.0, "z_max_m": None, "functional": False},
}


def get_required_p(site_area_m2, lp_m):
    """Table 1 (Low Zone) required P percentage."""
    if site_area_m2 >= 20000.0:
        return 25.0
    if lp_m >= 60.0:
        return 20.0
    return None


def orthogonal_axis(axis):
    return XYZ(-axis.Y, axis.X, 0).Normalize()


def site_centroid(site_pts):
    if not site_pts:
        return XYZ(0, 0, 0)
    n = float(len(site_pts))
    return XYZ(sum(p.X for p in site_pts) / n,
               sum(p.Y for p in site_pts) / n,
               sum(p.Z for p in site_pts) / n)


def _blocked_intervals(building_loops, axis):
    intervals = []
    for loop in building_loops:
        if not loop:
            continue
        intervals.append(list(project_polygon_onto_axis(loop, axis)))
    return merge_overlapping_intervals(intervals)


def _verify_gap(gap_lo, gap_hi, gap_type, loop_a, loop_b, site_pts,
                boundary_pts, axis_u, axis_v, building_loops, ref_pt,
                merged_blocked):
    """2D verification for one candidate gap; returns measurement dict or None."""
    width = gap_hi - gap_lo
    if width < 1e-9:
        return None

    # Continuity (full-site ray) applies only to internal air corridors (S2).
    if gap_type == "internal":
        if not continuity_check(gap_lo, gap_hi, axis_u, axis_v, site_pts,
                                building_loops, ref_pt):
            return None

    measurement = None
    if gap_type in ("left_setback", "right_setback"):
        measurement = {
            "type": "S1",
            "distance_ft": width,
            "distance_m": width * FEET_TO_METERS,
            "pass": width >= MIN_S1_FT,
            "threshold_m": MIN_S1_M,
        }
    elif gap_type == "internal" and loop_a and loop_b:
        measurement = measure_s2(loop_a, loop_b)
    elif gap_type == "open":
        measurement = {
            "type": "OPEN", "distance_ft": width, "distance_m": width * FEET_TO_METERS,
            "pass": True, "threshold_m": 0.0,
        }
    else:
        half = width * 0.5
        poly = [
            axis_scalar_to_point(gap_lo, axis_u, ref_pt),
            axis_scalar_to_point(gap_hi, axis_u, ref_pt),
            axis_scalar_to_point(gap_hi, axis_u, ref_pt) + axis_v * half,
            axis_scalar_to_point(gap_lo, axis_u, ref_pt) + axis_v * half,
            axis_scalar_to_point(gap_lo, axis_u, ref_pt),
        ]
        measurement = measure_s3(poly, boundary_pts, axis_u)

    if measurement is None:
        return None

    min_width = MIN_S2_FT if measurement["type"] == "S2" else MIN_S1_FT

    if not measurement.get("pass", False):
        return {
            "gap_lo": gap_lo, "gap_hi": gap_hi, "width_ft": width,
            "qualifies": False, "measurement": measurement,
        }

    if measurement["distance_ft"] < min_width - 1e-6 and measurement["type"] != "OPEN":
        return {
            "gap_lo": gap_lo, "gap_hi": gap_hi, "width_ft": width,
            "qualifies": False, "measurement": measurement,
        }

    return {
        "gap_lo": gap_lo, "gap_hi": gap_hi,
        "width_ft": width, "qualifies": True, "measurement": measurement,
    }


def assess_one_axis(site_pts, boundary_pts, building_loops, axis_u,
                    sweep_angle=0.0):
    """
    Run hybrid 1D/2D assessment on one projection axis.
    Returns dict with P, IS, W, gaps, sweep_angle, axis.
    """
    axis_u = rotate_axis_xy(axis_u, sweep_angle)
    axis_v = orthogonal_axis(axis_u)
    ref_pt = site_centroid(site_pts)

    site_lo, site_hi = project_polygon_onto_axis(site_pts, axis_u)
    W = site_hi - site_lo
    if W < 1e-9:
        return {"P": 0.0, "W": 0.0, "IS": 0.0, "gaps": [], "all_gap_results": [],
                "axis": axis_u, "sweep_angle": sweep_angle, "merged": [],
                "site_lo": site_lo, "site_hi": site_hi}

    merged = _blocked_intervals(building_loops, axis_u)
    candidates = subtract_intervals(site_lo, site_hi, merged)

    verified = []
    all_gap_results = []
    IS = 0.0
    for gap_lo, gap_hi in candidates:
        gap_type, la, lb = classify_gap(
            gap_lo, gap_hi, site_lo, site_hi, merged, building_loops, axis_u)
        if gap_type == "internal":
            na, nb = _nearest_pair(gap_lo, gap_hi, merged, building_loops, axis_u)
            if na is not None:
                la, lb = na, nb
        result = _verify_gap(
            gap_lo, gap_hi, gap_type, la, lb, site_pts, boundary_pts,
            axis_u, axis_v, building_loops, ref_pt, merged)
        if result is not None:
            all_gap_results.append(result)
        else:
            all_gap_results.append({
                "gap_lo": gap_lo, "gap_hi": gap_hi,
                "width_ft": gap_hi - gap_lo,
                "qualifies": False,
                "measurement": {
                    "type": "FAIL",
                    "distance_m": (gap_hi - gap_lo) * FEET_TO_METERS,
                },
            })
        if result and result["qualifies"]:
            verified.append(result)
            IS += result["width_ft"]

    P = (IS / W) * 100.0 if W > 1e-9 else 0.0
    return {
        "P": P, "W": W, "IS": IS, "gaps": verified,
        "all_gap_results": all_gap_results,
        "axis": axis_u, "sweep_angle": sweep_angle, "merged": merged,
        "site_lo": site_lo, "site_hi": site_hi,
    }


def sweep_optimal_angle(site_pts, boundary_pts, building_loops, base_axis,
                        angle_min=-15, angle_max=15):
    """Coarse 2-degree sweep, then 1-degree refinement around the best angle."""
    best = None
    best_deg = 0
    tested = set()

    coarse_degs = list(range(-14, 15, 2))
    if angle_min not in coarse_degs:
        coarse_degs.insert(0, angle_min)
    if angle_max not in coarse_degs:
        coarse_degs.append(angle_max)

    for deg in coarse_degs:
        if deg < angle_min or deg > angle_max or deg in tested:
            continue
        tested.add(deg)
        result = assess_one_axis(site_pts, boundary_pts, building_loops,
                                 base_axis, sweep_angle=deg)
        if best is None or result["IS"] > best["IS"] + 1e-9:
            best = result
            best_deg = deg

    for deg in range(max(angle_min, best_deg - 2),
                     min(angle_max, best_deg + 2) + 1):
        if deg in tested:
            continue
        tested.add(deg)
        result = assess_one_axis(site_pts, boundary_pts, building_loops,
                                 base_axis, sweep_angle=deg)
        if result["IS"] > best["IS"] + 1e-9:
            best = result
            best_deg = deg

    return best


def pick_best_plane_side(site_pts, boundary_pts, building_loops, base_axis):
    """
    Fig B14 — evaluate axis and its reverse; keep the side that maximises IS.
    """
    r1 = sweep_optimal_angle(site_pts, boundary_pts, building_loops, base_axis)
    r2 = sweep_optimal_angle(site_pts, boundary_pts, building_loops,
                             XYZ(-base_axis.X, -base_axis.Y, 0))
    if r2["IS"] > r1["IS"] + 1e-9:
        return r2
    return r1


def assess_zone(zone_name, site_pts, boundary_pts, building_loops,
                axis_primary, axis_secondary, stub_warning=False):
    """Assess one zone on both axes (with sweep on primary)."""
    if stub_warning:
        debug_print("  [Zone {}] STUB — using plan footprints; 3D slice pending.".format(
            zone_name))

    r1 = pick_best_plane_side(site_pts, boundary_pts, building_loops, axis_primary)
    r2 = assess_one_axis(site_pts, boundary_pts, building_loops, axis_secondary)

    return {
        "zone": zone_name,
        "axis1": r1,
        "axis2": r2,
        "stub": stub_warning,
    }


def run_full_assessment(site_pts, boundary_pts, building_loops,
                        axis_primary=None, axis_secondary=None,
                        street_axis=None):
    """
    Six-pass assessment: 3 zones x 2 axes (axes paired per zone).
    Returns controlling P = min P across all zone/axis results.
    """
    if axis_primary is None:
        axis_primary = compute_dominant_axis(site_pts)
    if street_axis is not None:
        axis_primary = street_axis.Normalize()
    if axis_secondary is None:
        axis_secondary = orthogonal_axis(axis_primary)

    if not validate_projection(site_pts, building_loops, axis_primary):
        debug_print("  [P/S] Primary axis validation failed — caller should "
                    "provide manual axes.")

    zone_results = []
    all_p = []

    debug_print("  [Case2] Assessing zone LOW...")
    low_zr = assess_zone(ZONE_LOW, site_pts, boundary_pts, building_loops,
                         axis_primary, axis_secondary, stub_warning=False)
    zone_results.append(low_zr)
    all_p.append(low_zr["axis1"]["P"])
    all_p.append(low_zr["axis2"]["P"])

    for zname in (ZONE_MID, ZONE_HIGH):
        debug_print("  [Case2] Reusing LOW results for zone {} (stub)...".format(zname))
        stub_zr = {
            "zone": zname,
            "axis1": low_zr["axis1"],
            "axis2": low_zr["axis2"],
            "stub": True,
        }
        zone_results.append(stub_zr)
        all_p.append(stub_zr["axis1"]["P"])
        all_p.append(stub_zr["axis2"]["P"])

    controlling_p = min(all_p) if all_p else 0.0

    return {
        "zone_results": zone_results,
        "controlling_p": controlling_p,
        "axis_primary": axis_primary,
        "axis_secondary": axis_secondary,
        "site_area_m2": polygon_area_2d(site_pts) * FEET_TO_METERS * FEET_TO_METERS,
    }


def filter_buildings_outside_corridor(building_loops, corridor_polygon):
    """Remove buildings whose centroid lies inside the notional corridor."""
    if not corridor_polygon:
        return building_loops
    kept = []
    for loop in building_loops:
        n = len(loop)
        if n < 3:
            continue
        cx = sum(p.X for p in loop) / n
        cy = sum(p.Y for p in loop) / n
        if not _point_in_polygon_xy(cx, cy, corridor_polygon):
            kept.append(loop)
    return kept


def _point_in_polygon_xy(x, y, polygon):
    """Ray-casting point-in-polygon test."""
    inside = False
    n = len(polygon)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i].X, polygon[i].Y
        xj, yj = polygon[j].X, polygon[j].Y
        if ((yi > y) != (yj > y)) and (
                x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def offset_polyline_both_sides(centerline_pts, offset_ft):
    """Rough ±offset corridor polygon from a centreline (7.5 m each side)."""
    if len(centerline_pts) < 2:
        return None
    left = []
    right = []
    for i in range(len(centerline_pts) - 1):
        a = centerline_pts[i]
        b = centerline_pts[i + 1]
        d = b - a
        ln = math.sqrt(d.X * d.X + d.Y * d.Y)
        if ln < 1e-9:
            continue
        nx = -d.Y / ln * offset_ft
        ny = d.X / ln * offset_ft
        left.append(XYZ(a.X + nx, a.Y + ny, a.Z))
        right.append(XYZ(a.X - nx, a.Y - ny, a.Z))
    if not left:
        return None
    b = centerline_pts[-1]
    a = centerline_pts[-2]
    d = b - a
    ln = math.sqrt(d.X * d.X + d.Y * d.Y)
    if ln > 1e-9:
        nx = -d.Y / ln * offset_ft
        ny = d.X / ln * offset_ft
        left.append(XYZ(b.X + nx, b.Y + ny, b.Z))
        right.append(XYZ(b.X - nx, b.Y - ny, b.Z))
    return left + list(reversed(right)) + [left[0]]
