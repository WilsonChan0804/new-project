# -*- coding: utf-8 -*-
"""Hybrid 1D/2D permeability and separating-distance engine (PNAP APP-152)."""

import math
from Autodesk.Revit.DB import XYZ

from sbd_geom_base import (
    FEET_TO_METERS, debug_print, polygon_area_2d,
    project_polygon_onto_axis, merge_overlapping_intervals,
    compute_dominant_axis, validate_projection,
)
try:
    from sbd_wind_corridor import corridor_between_groups, side_average_width
    _CORRIDOR_ENGINE = True
except Exception as _corr_err:
    _CORRIDOR_ENGINE = False
    _CORRIDOR_ERR = str(_corr_err)

from sbd_geom_separation import (
    MIN_S1_FT, MIN_S1_M, MIN_S2_FT, rotate_axis_xy,
    subtract_intervals, classify_gap, measure_s2, measure_s3,
    continuity_check, axis_scalar_to_point,
)

ZONE_LOW = "LOW"
ZONE_MID = "MIDDLE"
ZONE_HIGH = "HIGH"

ZONE_CONFIG = {
    ZONE_LOW: {"z_min_m": 0.0, "z_max_m": 20.0, "functional": True},
    ZONE_MID: {"z_min_m": 20.0, "z_max_m": 60.0, "functional": False},
    ZONE_HIGH: {"z_min_m": 60.0, "z_max_m": None, "functional": False},
}

# APP-152 §3.2 — angle between projection plane pair may be 75° to 105°.
PLANE_Y_ANGLE_MIN = 75.0
PLANE_Y_ANGLE_MAX = 105.0
PE_MIN_CLEAR_M = 3.0


def get_required_p_planes(site_area_m2, lp_m, tallest_h_m=None):
    """
    APP-152 Table 1 -> (plane1_required, plane2_required) in percent, or
    (None, None) when the requirement is not triggered.

        Site area < 20,000 m2 AND Lp >= 60 m ....... each plane 20%
        Site area >= 20,000 m2, H <= 60 m .......... P1 20%,  P2 25%
        Site area >= 20,000 m2, H  > 60 m .......... P1 20%,  P2 33.3%

    The two planes have DIFFERENT thresholds. The previous single-value
    version returned the Plane 2 figure and it was then applied to both
    planes, so Plane 1 was judged against 25% instead of 20% -- stricter
    than the clause requires, and it can turn a compliant scheme into a
    reported FAIL.
    """
    if site_area_m2 >= 20000.0:
        if tallest_h_m is not None and tallest_h_m > 60.0:
            return 20.0, 33.3
        return 20.0, 25.0
    if lp_m >= 60.0:
        return 20.0, 20.0
    return None, None


def get_required_p(site_area_m2, lp_m, tallest_h_m=None):
    """Back-compatible single value = the PLANE 2 (stricter) threshold.
    Prefer get_required_p_planes() so each plane is judged on its own."""
    _p1, p2 = get_required_p_planes(site_area_m2, lp_m, tallest_h_m)
    return p2


def orthogonal_axis(axis):
    return XYZ(-axis.Y, axis.X, 0).Normalize()


def zone_band_height_m(zone_name, tallest_m=20.0):
    """Vertical height (m) of one assessment zone band."""
    cfg = ZONE_CONFIG.get(zone_name, ZONE_CONFIG[ZONE_LOW])
    zmax = cfg["z_max_m"]
    if zmax is None:
        zmax = float(tallest_m) if tallest_m else 60.0
    return max(zmax - cfg["z_min_m"], 1e-9), zmax


def optimize_plane_y(site_pts, boundary_pts, building_loops, axis_x,
                     angle_min=PLANE_Y_ANGLE_MIN, angle_max=PLANE_Y_ANGLE_MAX,
                     step=5.0, fine_step=1.0, street_cl_extensions=None,
                     required_p=None, confirm_full=True, max_full_confirms=3,
                     progress_label="Plane Y", coarse_step=None):
    """
    Plane Y search (APP-152 Fig B8): SCREEN CHEAPLY, CONFIRM CAREFULLY.

    Stage 1  coarse scan, 5 deg steps, fast=True (projection only).
             Order: 90 deg first, then UP 95..105, then DOWN 85..75.
    Stage 2  fine scan +/-4 deg around the coarse winner, 1 deg, still fast.
    Stage 3  FULL assessment (articulated corridors + side regions) on the
             best few candidates only. The first one that reaches
             `required_p` wins and the search stops.

    Why not full assessment at every angle: that is exact but costs a full
    corridor solve per degree, and inside the MID/HIGH X sweep it is
    multiplied by every X angle -- an hour on a real model. Fast ranking is
    a good proxy for WHERE the good angles are; the full check then decides
    whether one of them actually complies, so bending is still credited
    before anything is reported.

    `coarse_step` is accepted and ignored (older callers passed it).
    """
    tested_fast = {}
    best_full = None
    best_full_deg = 90.0

    def _fast(deg):
        key = round(deg, 4)
        if key in tested_fast:
            return tested_fast[key]
        r = assess_one_axis(site_pts, boundary_pts, building_loops,
                            rotate_axis_xy(axis_x, deg),
                            street_cl_extensions=street_cl_extensions,
                            fast=True)
        tested_fast[key] = r.get("P", 0.0)
        return tested_fast[key]

    def _full(deg):
        r = assess_one_axis(site_pts, boundary_pts, building_loops,
                            rotate_axis_xy(axis_x, deg),
                            street_cl_extensions=street_cl_extensions,
                            fast=False)
        r["plane_y_angle_deg"] = deg
        return r

    # ---- stage 1: coarse, 90 then up then down -------------------------
    order = [90.0]
    d = 90.0 + step
    while d <= angle_max + 1e-9:
        order.append(round(d, 4)); d += step
    d = 90.0 - step
    while d >= angle_min - 1e-9:
        order.append(round(d, 4)); d -= step
    for deg in order:
        _fast(deg)

    # ---- stage 2: fine around the coarse winner ------------------------
    coarse_best = max(tested_fast.items(), key=lambda kv: kv[1])[0]
    d = max(angle_min, coarse_best - 4.0)
    while d <= min(angle_max, coarse_best + 4.0) + 1e-9:
        _fast(round(d, 4)); d += fine_step

    ranked = sorted(tested_fast.items(), key=lambda kv: kv[1], reverse=True)

    if not confirm_full:
        # ranking use (inside the X sweep): no full solves at all
        deg = ranked[0][0]
        r = {"P": ranked[0][1], "plane_y_angle_deg": deg,
             "plane_y_screened_only": True}
        return rotate_axis_xy(axis_x, deg), r

    # ---- stage 3: full confirmation on the best few --------------------
    n_confirm = max(1, int(max_full_confirms))
    for i, (deg, p_fast) in enumerate(ranked[:n_confirm]):
        r = _full(deg)
        p = r.get("P", 0.0)
        if best_full is None or p > best_full.get("P", 0.0) + 1e-9:
            best_full = r
            best_full_deg = deg
        if required_p is not None and p >= required_p - 1e-9:
            debug_print("  [P/S] {} {:.0f} deg -> P={:.1f}% (screened {:.1f}%) "
                        "meets {:.1f}%; stopped after {} screen + {} full."
                        .format(progress_label, deg, p, p_fast, required_p,
                                len(tested_fast), i + 1))
            best_full = r
            best_full_deg = deg
            best_full["plane_y_met_requirement"] = True
            best_full["plane_y_angle_deg"] = deg
            return rotate_axis_xy(axis_x, deg), best_full

    if best_full is None:
        best_full = _full(90.0)
        best_full_deg = 90.0

    best_full["plane_y_angle_deg"] = best_full_deg
    best_full["plane_y_met_requirement"] = False
    debug_print("  [P/S] {} best P={:.1f}% at {:.0f} deg ({} screened, {} "
                "full{}).".format(progress_label, best_full.get("P", 0.0),
                                  best_full_deg, len(tested_fast), n_confirm,
                                  "" if required_p is None
                                  else "; {:.1f}% not met".format(required_p)))
    return rotate_axis_xy(axis_x, best_full_deg), best_full


def optimize_zone_planes(zone_name, site_pts, boundary_pts, building_loops,
                         base_axis, tallest_m=20.0,
                         lock_axis_x=False, street_cl_extensions=None,
                         required_p=None):
    """
    Find (Plane X, Plane Y) for one zone. Low zone: lock X (street), sweep Y.
    Mid/high: fast sweep both X and Y; one full confirm on the winner.
    """
    zone_h, _ = zone_band_height_m(zone_name, tallest_m)
    best_score = -1.0
    best_x_deg = 0.0
    best_y_deg = 90.0

    if lock_axis_x:
        x_angles = [0.0]
    else:
        x_angles = [float(d) for d in range(0, 180, 30)]

    n_x = len(x_angles)
    for xi, x_deg in enumerate(x_angles):
        debug_print("  [P/S] Zone {} X sweep {:+.0f} deg ({}/{})...".format(
            zone_name, x_deg, xi + 1, n_x))
        ax_x = rotate_axis_xy(base_axis, x_deg) if x_deg else base_axis.Normalize()
        r1f = pick_best_plane_side(
            site_pts, boundary_pts, building_loops, ax_x,
            street_cl_extensions=street_cl_extensions, fast=True)
        # RANKING pass only: 5 deg steps keep the X x Y search affordable
        # (a 1 deg full-assessment sweep inside every X angle would be
        # ~31 full assessments per X). The winning pair is re-searched at
        # 1 deg below.
        _, r2f = optimize_plane_y(
            site_pts, boundary_pts, building_loops, ax_x,
            step=5.0, required_p=required_p,
            street_cl_extensions=street_cl_extensions,
            confirm_full=False,
            progress_label="Zone {} Y".format(zone_name))
        score = min(r1f.get("P", 0.0), r2f.get("P", 0.0))
        if score > best_score + 1e-9:
            best_score = score
            best_x_deg = x_deg
            best_y_deg = r2f.get("plane_y_angle_deg", 90.0)

    ax_x = rotate_axis_xy(base_axis, best_x_deg) if best_x_deg else base_axis.Normalize()
    debug_print("  [P/S] Zone {} confirming full assess X={:+.0f} Y={:.0f} "
                "deg...".format(zone_name, best_x_deg, best_y_deg))
    r1 = pick_best_plane_side(
        site_pts, boundary_pts, building_loops, ax_x,
        street_cl_extensions=street_cl_extensions, fast=False)
    axis_y = rotate_axis_xy(ax_x, best_y_deg)
    r2 = assess_one_axis(
        site_pts, boundary_pts, building_loops, axis_y,
        street_cl_extensions=street_cl_extensions, fast=False)
    r2["plane_y_angle_deg"] = best_y_deg

    best_pack = {
        "axis_x": r1.get("axis", ax_x),
        "axis_y": r2.get("axis", axis_y),
        "axis1": r1,
        "axis2": r2,
        "x_angle_deg": best_x_deg,
        "y_angle_deg": best_y_deg,
    }

    debug_print("  [P/S] Zone {} planes: X={:+.0f} deg Y={:.0f} deg from X, "
                "P_x={:.1f}% P_y={:.1f}% (min={:.1f}%)".format(
                    zone_name, best_pack["x_angle_deg"],
                    best_pack["y_angle_deg"],
                    best_pack["axis1"].get("P", 0.0),
                    best_pack["axis2"].get("P", 0.0),
                    min(best_pack["axis1"].get("P", 0.0),
                        best_pack["axis2"].get("P", 0.0))))
    best_pack["zone_h_m"] = zone_h
    return best_pack


def measure_pe_on_plane(pe_loops, axis_u, zone_h_m, min_clear_m=PE_MIN_CLEAR_M):
    """
    Project PE footprints onto axis_u; keep spans with clear width >= 3 m.
    Returns total PE facade area (m2) = sum(width_m * zone_h_m).
    """
    if not pe_loops or zone_h_m <= 1e-9:
        return 0.0, []
    axis_u = axis_u.Normalize()
    total_m2 = 0.0
    spans = []
    min_clear_ft = min_clear_m / FEET_TO_METERS
    for loop in pe_loops:
        if not loop or len(loop) < 3:
            continue
        lo, hi = project_polygon_onto_axis(loop, axis_u)
        width_ft = hi - lo
        if width_ft + 1e-9 < min_clear_ft:
            continue
        width_m = width_ft * FEET_TO_METERS
        area_m2 = width_m * zone_h_m
        total_m2 += area_m2
        spans.append({"lo": lo, "hi": hi, "width_m": width_m, "area_m2": area_m2})
    return total_m2, spans


def apply_pe_to_zone_result(zone_result, pe_area_m2, req_p, zone_h_m, W_ft):
    """
    APP-152: PE may contribute at most 1/3 of required P; IS at least 2/3.
    Adds pe_area_m2, pe_pct, is_area_pct, combined_p to zone_result.
    """
    W_m = W_ft * FEET_TO_METERS
    zone_area_m2 = W_m * zone_h_m if W_m > 1e-9 and zone_h_m > 1e-9 else 0.0
    a1 = zone_result.get("axis1") or {}
    is_width_m = a1.get("IS", 0.0) * FEET_TO_METERS
    is_area_m2 = is_width_m * zone_h_m if zone_h_m > 1e-9 else 0.0

    pe_cap_m2 = 0.0
    if req_p is not None and zone_area_m2 > 1e-9:
        pe_cap_m2 = (req_p / 100.0) * zone_area_m2 * (1.0 / 3.0)
    pe_used_m2 = min(pe_area_m2, pe_cap_m2) if pe_cap_m2 > 0 else pe_area_m2

    is_area_pct = (is_area_m2 / zone_area_m2 * 100.0) if zone_area_m2 > 1e-9 else 0.0
    pe_area_pct = (pe_used_m2 / zone_area_m2 * 100.0) if zone_area_m2 > 1e-9 else 0.0
    combined_p = is_area_pct + pe_area_pct

    zone_result["pe_area_m2"] = pe_area_m2
    zone_result["pe_used_m2"] = pe_used_m2
    zone_result["pe_cap_m2"] = pe_cap_m2
    zone_result["is_area_m2"] = is_area_m2
    zone_result["zone_area_m2"] = zone_area_m2
    zone_result["zone_h_m"] = zone_h_m
    zone_result["is_area_pct"] = is_area_pct
    zone_result["pe_area_pct"] = pe_area_pct
    zone_result["combined_p"] = combined_p
    return zone_result


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
                merged_blocked, side_widths_ft=None, fast=False):
    """2D verification for one candidate gap; returns measurement dict or None."""
    width = gap_hi - gap_lo
    if width < 1e-9:
        return None

    _artic = None
    if (not fast) and gap_type == "internal" and loop_a and loop_b and _CORRIDOR_ENGINE:
        try:
            _artic = corridor_between_groups(
                [loop_a], [loop_b], site_pts, axis_u, axis_v,
                context_loops=building_loops)
        except Exception as _e:
            debug_print("  [P/S] articulated corridor failed for gap "
                        "({:.1f}..{:.1f}): {}".format(gap_lo, gap_hi, _e))
            _artic = None

    if gap_type == "internal" and not fast:
        if not continuity_check(gap_lo, gap_hi, axis_u, axis_v, site_pts,
                                building_loops, ref_pt):
            if not (_artic and _artic.get("width_ft")):
                return None
            debug_print("  [P/S] gap {:.1f}..{:.1f}: straight ray blocked, "
                        "but a {:.2f} m corridor bends through at {:+.1f} deg "
                        "-- kept.".format(
                            gap_lo, gap_hi,
                            _artic["width_ft"] * FEET_TO_METERS,
                            _artic.get("angle_deg", 0.0)))

    measurement = None
    if gap_type in ("left_setback", "right_setback"):
        s1_ft = width
        if (not fast) and side_widths_ft:
            key = "left" if gap_type == "left_setback" else "right"
            if side_widths_ft.get(key):
                s1_ft = side_widths_ft[key]
        measurement = {
            "type": "S1",
            "distance_ft": s1_ft,
            "distance_m": s1_ft * FEET_TO_METERS,
            "pass": s1_ft >= MIN_S1_FT,
            "threshold_m": MIN_S1_M,
            "from_side_region": bool(side_widths_ft) and not fast,
        }
    elif gap_type == "internal" and loop_a and loop_b:
        if fast:
            measurement = {
                "type": "S2",
                "distance_ft": width,
                "distance_m": width * FEET_TO_METERS,
                "pass": width >= MIN_S2_FT,
                "threshold_m": 15.0,
            }
        elif _artic and _artic.get("width_ft"):
            measurement = {
                "type": "S2",
                "distance_ft": 0.0, "distance_m": 0.0,
                "pass": False, "threshold_m": 15.0,
            }
        else:
            measurement = measure_s2(loop_a, loop_b)
        if (not fast) and _CORRIDOR_ENGINE:
            try:
                _c = _artic
                if _c and _c.get("width_ft"):
                    articulated_ft = _c["width_ft"]
                    measurement["articulated_ft"] = articulated_ft
                    measurement["articulated_deg"] = _c.get("angle_deg", 0.0)
                    measurement["corridor_polygon"] = _c.get("polygon")
                    measurement["distance_ft"] = articulated_ft
                    measurement["distance_m"] = articulated_ft * FEET_TO_METERS
                    measurement["pass"] = articulated_ft >= MIN_S2_FT
            except Exception as _e:
                debug_print("  [P/S] articulated corridor failed for gap "
                            "({:.1f}..{:.1f}): {} -- straight S2 used.".format(
                                gap_lo, gap_hi, _e))
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
                    sweep_angle=0.0, street_cl_extensions=None, fast=False):
    """
    Run hybrid 1D/2D assessment on one projection axis.
    Returns dict with P, IS, W, gaps, sweep_angle, axis.

    fast=True: projection-only ranking for plane sweeps (no side regions,
    no articulated corridors). Submission numbers use fast=False.
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

    # One side-region solve per axis, reused for every setback gap.
    side_widths_ft = {}
    if (not fast) and _CORRIDOR_ENGINE and building_loops:
        for _side in ("left", "right"):
            try:
                _ex = street_cl_extensions or {}
                _sr = side_average_width(
                    site_pts, building_loops, axis_u, axis_v, _side,
                    street_cl_extension_ft=_ex.get(_side),
                    street_cl_points=(_ex.get(_side + "_cl")
                                      or _ex.get("centreline_" + _side)))
                if _sr and _sr.get("avg_width_m"):
                    side_widths_ft[_side] = _sr["avg_width_m"] / FEET_TO_METERS
            except Exception as _e:
                debug_print("  [P/S] side '{}' failed ({}); using the "
                            "projected gap width.".format(_side, _e))
    if side_widths_ft and not fast:
        debug_print("  [P/S] S1 from side regions: {}".format(
            ", ".join("{}={:.2f}m".format(k, v * FEET_TO_METERS)
                      for k, v in sorted(side_widths_ft.items()))))

    verified = []
    all_gap_results = []
    IS = 0.0
    for gap_lo, gap_hi in candidates:
        gap_type, la, lb = classify_gap(
            gap_lo, gap_hi, site_lo, site_hi, merged, building_loops, axis_u)
        result = _verify_gap(
            gap_lo, gap_hi, gap_type, la, lb, site_pts, boundary_pts,
            axis_u, axis_v, building_loops, ref_pt, merged,
            side_widths_ft=side_widths_ft, fast=fast)
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
            # IS is the sum of the S widths measured on plan (bend included),
            # not the sum of the gaps' projections onto the plane. Those are
            # the openings that appear in the deformed elevation.
            _m = result.get("measurement") or {}
            _s_ft = _m.get("articulated_ft")
            if _s_ft is None:
                _s_ft = _m.get("distance_ft")
            if _s_ft is None or _s_ft <= 0.0:
                _s_ft = result["width_ft"]
            result["is_width_ft"] = _s_ft
            IS += _s_ft

    P = (IS / W) * 100.0 if W > 1e-9 else 0.0
    return {
        "P": P, "W": W, "IS": IS, "gaps": verified,
        "all_gap_results": all_gap_results,
        "axis": axis_u, "sweep_angle": sweep_angle, "merged": merged,
        "site_lo": site_lo, "site_hi": site_hi,
    }


def sweep_optimal_angle(site_pts, boundary_pts, building_loops, base_axis,
                        angle_min=0, angle_max=0, street_cl_extensions=None,
                        fast=False):
    """
    Projection plane orientation -- NO LONGER SWEPT.

    This used to rotate the projection plane through +/-15 degrees looking for
    the orientation that maximised IS, and reported that rotated axis as
    "Axis1 angle=-15deg". That was a misreading of APP-152.

    The +/-15 degree allowance belongs to the AIR CORRIDOR, not to the plane.
    The plane is fixed (aligned to the street in the low zone); the corridor
    is what may deviate and return. Because a bent corridor can be wider than
    the straight gap projected onto the plane, the openings in the deformed
    elevation grow and the obstruction shrinks -- which is precisely what the
    clause is demonstrating: air that can change direction is obstructed less.

    Rotating the plane instead produced two inconsistent frames on one
    drawing (P quoted on a rotated axis, corridors drawn on the real one) and
    credited the bend to the wrong object. The bend is now applied where it
    belongs, in _verify_gap via the articulated corridor engine.

    Kept as a function so callers do not change; it now evaluates the plane
    as given.
    """
    best = None
    best_deg = 0
    tested = set()

    coarse_degs = [0]
    _unused_full_sweep = list(range(-14, 15, 2))
    if angle_min not in coarse_degs:
        coarse_degs.insert(0, angle_min)
    if angle_max not in coarse_degs:
        coarse_degs.append(angle_max)

    for deg in coarse_degs:
        if deg < angle_min or deg > angle_max or deg in tested:
            continue
        tested.add(deg)
        result = assess_one_axis(site_pts, boundary_pts, building_loops,
                                 base_axis, sweep_angle=deg,
                                 street_cl_extensions=street_cl_extensions,
                                 fast=fast)
        if best is None or result["IS"] > best["IS"] + 1e-9:
            best = result
            best_deg = deg

    for deg in range(max(angle_min, best_deg - 2),
                     min(angle_max, best_deg + 2) + 1):
        if deg in tested:
            continue
        tested.add(deg)
        result = assess_one_axis(site_pts, boundary_pts, building_loops,
                                 base_axis, sweep_angle=deg,
                                 street_cl_extensions=street_cl_extensions,
                                 fast=fast)
        if result["IS"] > best["IS"] + 1e-9:
            best = result
            best_deg = deg

    return best


def pick_best_plane_side(site_pts, boundary_pts, building_loops, base_axis,
                         street_cl_extensions=None, fast=False):
    """
    Fig B14 — evaluate axis and its reverse; keep the side that maximises IS.
    """
    r1 = sweep_optimal_angle(site_pts, boundary_pts, building_loops, base_axis,
                             street_cl_extensions=street_cl_extensions,
                             fast=fast)
    r2 = sweep_optimal_angle(site_pts, boundary_pts, building_loops,
                             XYZ(-base_axis.X, -base_axis.Y, 0),
                             street_cl_extensions=street_cl_extensions,
                             fast=fast)
    if r2["IS"] > r1["IS"] + 1e-9:
        return r2
    return r1


def assess_zone(zone_name, site_pts, boundary_pts, building_loops,
                axis_primary, axis_secondary=None, stub_warning=False,
                street_cl_extensions=None, lock_axis_x=False,
                pe_loops=None, req_p=None, tallest_m=20.0,
                plane_y_angle_deg=None):
    """Assess one zone on both axes; optimize Plane Y (and X for mid/high)."""
    if stub_warning:
        debug_print("  [Zone {}] STUB — using plan footprints; 3D slice pending.".format(
            zone_name))

    if lock_axis_x or zone_name == ZONE_LOW:
        r1 = pick_best_plane_side(
            site_pts, boundary_pts, building_loops, axis_primary,
            street_cl_extensions=street_cl_extensions, fast=False)
        if axis_secondary is not None:
            r2 = assess_one_axis(
                site_pts, boundary_pts, building_loops, axis_secondary,
                street_cl_extensions=street_cl_extensions, fast=False)
            axis_y = axis_secondary
            y_deg = plane_y_angle_deg
        else:
            axis_y, r2 = optimize_plane_y(
                site_pts, boundary_pts, building_loops, axis_primary,
                required_p=req_p,
                street_cl_extensions=street_cl_extensions,
                confirm_full=True)
            y_deg = r2.get("plane_y_angle_deg")
        x_deg = 0.0
    else:
        pack = optimize_zone_planes(
            zone_name, site_pts, boundary_pts, building_loops,
            axis_primary, tallest_m=tallest_m, lock_axis_x=False,
            street_cl_extensions=street_cl_extensions,
            required_p=req_p)
        r1 = pack["axis1"]
        r2 = pack["axis2"]
        axis_y = pack["axis_y"]
        x_deg = pack.get("x_angle_deg", 0.0)
        y_deg = pack.get("y_angle_deg")

    zone_h, _ = zone_band_height_m(zone_name, tallest_m)
    zr = {
        "zone": zone_name,
        "axis1": r1,
        "axis2": r2,
        "stub": stub_warning,
        "axis_secondary": axis_y if axis_secondary is None else axis_secondary,
        "plane_x_angle_deg": x_deg,
        "plane_y_angle_deg": y_deg,
        "zone_h_m": zone_h,
    }
    if pe_loops:
        pe_area, pe_spans = measure_pe_on_plane(pe_loops, r1.get("axis"), zone_h)
        zr["pe_spans"] = pe_spans
        apply_pe_to_zone_result(zr, pe_area, req_p, zone_h, r1.get("W", 0.0))
    return zr


def run_full_assessment(site_pts, boundary_pts, building_loops,
                        axis_primary=None, axis_secondary=None,
                        street_axis=None, street_cl_extensions=None,
                        pe_loops=None, req_p=None, tallest_m=20.0,
                        plane_y_angle_deg=None, zones=None):
    """
    Assessment over the requested zones x 2 planes.

    zones : iterable of zone names to assess, e.g. ("LOW",) or
            ("LOW", "MIDDLE"). None (default) = all three.
            MIDDLE and HIGH each run their own X x Y plane optimisation,
            so skipping them when only the low zone is of interest removes
            the bulk of the runtime.

    Returns controlling P = min P across the zone/axis results actually run.
    """
    want = None
    if zones:
        want = set(str(z).strip().upper() for z in zones)
        debug_print("  [P/S] Zones requested: {}".format(
            ", ".join(sorted(want))))
    if axis_primary is None:
        axis_primary = compute_dominant_axis(site_pts)
    if street_axis is not None and axis_primary is None:
        axis_primary = street_axis.Normalize()

    if not validate_projection(site_pts, building_loops, axis_primary):
        debug_print("  [P/S] Primary axis validation failed — caller should "
                    "provide manual axes.")

    zone_results = []
    all_p = []

    # low_zr must exist even when the LOW zone is skipped: the return dict
    # below reads axis_secondary / plane_y_angle_deg off it, and a HIGH-only
    # or MIDDLE-only run used to die with
    #   "Local variable 'low_zr' referenced before assignment"
    # after the whole (slow) assessment had already been computed.
    low_zr = None

    if want is None or ZONE_LOW in want:
        debug_print("  [Case2] Assessing zone LOW...")
        low_zr = assess_zone(
            ZONE_LOW, site_pts, boundary_pts, building_loops,
            axis_primary, axis_secondary=axis_secondary,
            street_cl_extensions=street_cl_extensions,
            lock_axis_x=True, pe_loops=pe_loops, req_p=req_p,
            tallest_m=tallest_m, plane_y_angle_deg=plane_y_angle_deg)
        zone_results.append(low_zr)
        all_p.append(low_zr["axis1"]["P"])
        all_p.append(low_zr["axis2"]["P"])
        if low_zr.get("combined_p") is not None:
            all_p.append(low_zr["combined_p"])
    else:
        debug_print("  [P/S] Zone LOW skipped by request "
                     "(not computed at all).")

    for zname in (ZONE_MID, ZONE_HIGH):
        if want is not None and zname not in want:
            debug_print("  [P/S] Zone {} skipped by request.".format(zname))
            continue
        debug_print("  [Case2] Assessing zone {} (optimized planes)...".format(zname))
        zr = assess_zone(
            zname, site_pts, boundary_pts, building_loops,
            axis_primary, axis_secondary=None,
            street_cl_extensions=street_cl_extensions,
            lock_axis_x=False, pe_loops=pe_loops, req_p=req_p,
            tallest_m=tallest_m)
        zone_results.append(zr)
        all_p.append(zr["axis1"]["P"])
        all_p.append(zr["axis2"]["P"])
        if zr.get("combined_p") is not None:
            all_p.append(zr["combined_p"])

    controlling_p = min(all_p) if all_p else 0.0

    # Reference zone for the reported axes: LOW when it was assessed (its
    # Plane X is the user's, unswept, so its Y is the meaningful one),
    # otherwise the first zone that did run.
    ref_zr = low_zr if low_zr is not None else (
        zone_results[0] if zone_results else None)
    if ref_zr is None:
        debug_print("  [P/S] No zones were assessed — check the zone "
                    "selection in the setup window.")
        ref_axis_secondary = axis_secondary
        ref_plane_y_deg = plane_y_angle_deg
    else:
        ref_axis_secondary = ref_zr.get("axis_secondary", axis_secondary)
        ref_plane_y_deg = ref_zr.get("plane_y_angle_deg")
        if low_zr is None:
            debug_print("  [P/S] LOW not assessed — reporting axes from "
                        "zone {}.".format(ref_zr.get("zone")))

    return {
        "zone_results": zone_results,
        "controlling_p": controlling_p,
        "axis_primary": axis_primary,
        "axis_secondary": ref_axis_secondary,
        "site_area_m2": polygon_area_2d(site_pts) * FEET_TO_METERS * FEET_TO_METERS,
        "plane_y_angle_deg": ref_plane_y_deg,
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
