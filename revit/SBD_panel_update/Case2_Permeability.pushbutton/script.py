# -*- coding: utf-8 -*-
"""SBD Case2 — Permeability (P) and Separating Distance (S) — PNAP APP-152 Fig B14."""

import os
import sys
import math
import clr

# ---------------------------------------------------------------------------
# Import path: reuse Case1 geometry + Shared.scripts modules
# ---------------------------------------------------------------------------
_BUTTON_DIR = os.path.dirname(__file__)
_PANEL_DIR = os.path.dirname(_BUTTON_DIR)
_CASE1_DIR = os.path.join(_PANEL_DIR, "Case1_Profile.pushbutton")
_SHARED_DIR = os.path.join(_PANEL_DIR, "Shared.scripts")
for _p in (_SHARED_DIR, _CASE1_DIR, _BUTTON_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

clr.AddReference('RevitAPI')
clr.AddReference('RevitAPIUI')
from Autodesk.Revit.DB import (
    FilteredElementCollector, Level, Transaction, TransactionGroup,
    XYZ,
)
from Autodesk.Revit.UI import (
    TaskDialog, TaskDialogResult, TaskDialogCommonButtons,
    TaskDialogCommandLinkId,
)

from pyrevit import revit
from pyrevit import forms

import sbd_revit_helpers as revit_helpers

revit_helpers.doc = revit.doc
revit_helpers.uidoc = revit.uidoc

doc = revit.doc
uidoc = revit.uidoc

from sbd_geometry import (
    FEET_TO_METERS, debug_print, get_points_from_curves,
    sort_curves_by_connectivity, compute_dominant_axis,
    ensure_loop_ccw, polygon_area_2d,
)
from sbd_facade import remove_consecutive_duplicates
from sbd_revit_helpers import (
    pick_boundary_with_auto_choice, get_selected_filled_regions,
    pick_projection_lines, get_selected_curves,
    get_centreline_direction_from_style, pick_single_line_direction,
)
from sbd_purge import purge_app152_outputs
from sbd_geom_topology import validate_or_repair_loop
from sbd_permeability import (
    run_full_assessment, get_required_p, orthogonal_axis,
    filter_buildings_outside_corridor, offset_polyline_both_sides,
)
from sbd_audit_draw import duplicate_zone_views, render_zone_deliverables, draw_corridor_fills_on_view

CORRIDOR_HALF_M = 7.5
AXIS1_CANCEL = object()


def _convex_hull_2d(points):
    pts = sorted(set((round(p.X, 6), round(p.Y, 6)) for p in points))
    if len(pts) <= 2:
        return [XYZ(x, y, 0) for x, y in pts]

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    return [XYZ(x, y, 0) for x, y in hull]


def compute_lp_m(loop_pts, z=0.0):
    """Lp = shorter side of minimum-length bounding rectangle (metres)."""
    hull = _convex_hull_2d(loop_pts)
    if len(hull) < 2:
        return 0.0
    angles = set()
    n = len(hull)
    for i in range(n):
        a = hull[i]
        b = hull[(i + 1) % n]
        angles.add(math.atan2(b.Y - a.Y, b.X - a.X) % math.pi)
    step = math.radians(0.5)
    k = 0.0
    while k < math.pi:
        angles.add(k)
        k += step
    best_len = None
    best_width = None
    for ang in angles:
        c = math.cos(ang)
        s = math.sin(ang)
        us = [p.X * c + p.Y * s for p in hull]
        vs = [-p.X * s + p.Y * c for p in hull]
        w = max(us) - min(us)
        h = max(vs) - min(vs)
        length = max(w, h)
        width = min(w, h)
        if best_len is None or length < best_len - 1e-9:
            best_len = length
            best_width = width
    return (best_width or 0.0) * FEET_TO_METERS


def _max_lp_across_buildings(building_loops):
    lp_vals = []
    for loop in building_loops:
        lp_vals.append(compute_lp_m(loop))
    return max(lp_vals) if lp_vals else 0.0


def _get_levels_sorted():
    levels = list(FilteredElementCollector(doc).OfClass(Level).ToElements())
    levels.sort(key=lambda lv: lv.Elevation)
    return levels


def _ask_level_zero(default_elev_ft):
    levels = _get_levels_sorted()
    names = [lv.Name for lv in levels]
    if not names:
        return default_elev_ft
    try:
        picked = forms.SelectFromList.show(
            names, title="Level Zero", button_name="Select",
            message="Select Level Zero (mean street level):")
        if picked:
            for lv in levels:
                if lv.Name == picked:
                    return lv.Elevation
    except Exception:
        pass
    return default_elev_ft


def _ask_height_m(default_m=20.0):
    try:
        answer = forms.ask_for_string(
            default=str(default_m),
            prompt="Height (m) of tallest building on site:",
            title="Case2 — Tallest Building Height")
        if answer is None:
            return default_m
        return float(str(answer).strip())
    except Exception:
        return default_m


def _pick_site_boundary():
    TaskDialog.Show(
        "Case2 — Site Boundary",
        "Select ONE segment of the closed SUBJECT SITE BOUNDARY.")
    curves = pick_boundary_with_auto_choice(
        "Select SUBJECT SITE BOUNDARY", allow_auto=False)
    if not curves:
        return None
    sorted_curves = sort_curves_by_connectivity(curves, tolerance=2.0) or curves
    pts = get_points_from_curves(sorted_curves, 500)
    pts = remove_consecutive_duplicates(pts, tol=0.01)
    if len(pts) < 3:
        TaskDialog.Show("Case2", "Site boundary invalid.")
        return None
    if pts[0].DistanceTo(pts[-1]) > 2.0:
        TaskDialog.Show("Case2", "Site boundary is not closed.")
        return None
    # FIX 2026-11: a gap up to 2 ft (0.6 m) used to be closed silently
    gap_m = pts[0].DistanceTo(pts[-1]) * FEET_TO_METERS
    if gap_m > 0.01:
        res = TaskDialog.Show(
            "Case2 - Site Boundary",
            "The site boundary does not close: its ends are {:.3f} m apart.\n\n"
            "Use it anyway (closed by a straight line)?".format(gap_m),
            TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No)
        if res != TaskDialogResult.Yes:
            return None
    if pts[0].DistanceTo(pts[-1]) < 0.01:
        pts = pts[:-1]
    return validate_or_repair_loop(pts) or pts


def _pick_building_loops():
    TaskDialog.Show(
        "Case2 — Buildings",
        "Select all building footprint Filled Regions on the subject site.")
    regions = get_selected_filled_regions(
        "Select building Filled Regions (Finish when done)")
    if not regions:
        return None
    loops = []
    for r in regions:
        # FIX 2026-11: a Filled Region holding two separate blocks used to
        # keep only the largest; now every loop that is not a hole (a loop
        # inside another loop of the same region) is a building.
        for pts in _region_outer_loops(r):
            loop = ensure_loop_ccw(pts)
            loop = validate_or_repair_loop(loop) or loop
            loops.append(loop)
    return loops


def _region_outer_loops(r):
    """Every outer loop of a Filled Region (holes left out)."""
    elem = r.get("element")
    try:
        bounds = list(elem.GetBoundaries()) if elem is not None else []
    except Exception:
        bounds = []
    all_pts = []
    for cl in bounds:
        pts = []
        for c in cl:
            for p in c.Tessellate():
                if not pts or pts[-1].DistanceTo(p) > 1e-6:
                    pts.append(p)
        if len(pts) > 1 and pts[0].DistanceTo(pts[-1]) < 1e-6:
            pts = pts[:-1]
        if len(pts) >= 3:
            all_pts.append(pts)
    if len(all_pts) <= 1:
        return [r["loop_pts"]]

    def inside(pt, poly):
        res = False
        j = len(poly) - 1
        for i in range(len(poly)):
            xi, yi, xj, yj = poly[i].X, poly[i].Y, poly[j].X, poly[j].Y
            if (yi > pt.Y) != (yj > pt.Y) and pt.X < (xj - xi) * (pt.Y - yi) / ((yj - yi) or 1e-12) + xi:
                res = not res
            j = i
        return res
    out = []
    for i, a in enumerate(all_pts):
        depth = sum(1 for j, b in enumerate(all_pts) if j != i and inside(a[0], b))
        if depth % 2 == 0:
            out.append(a)
    debug_print("  [Case2] Filled Region with {} loops: {} building(s), {} hole(s)".format(
        len(all_pts), len(out), len(all_pts) - len(out)))
    return out or [r["loop_pts"]]


def _projected_lp_m(building_loops, axis):
    """FIX 2026-11: Lp as the length of all the buildings projected on
    Projection Plane X (Axis 1) - compute_lp_m takes the SHORTER side of one
    building's bounding rectangle. Both are printed until the reading of
    APP-152 is confirmed; the required P uses this one."""
    from sbd_geometry import project_polygon_onto_axis, merge_overlapping_intervals
    iv = [list(project_polygon_onto_axis(l, axis)) for l in building_loops if l]
    return sum(hi - lo for lo, hi in merge_overlapping_intervals(iv)) * FEET_TO_METERS


def _pick_axis1_source(site_pts):
    """
    Let user choose Projection Axis 1 via CommandLinks.
    Returns XYZ axis, None (site PCA), or AXIS1_CANCEL sentinel.
    """
    dlg = TaskDialog("Case2 — Projection Axis 1")
    dlg.MainInstruction = "Choose how to define Projection Axis 1 (Fig B14)."
    dlg.AddCommandLink(
        TaskDialogCommandLinkId.CommandLink1,
        "Street centreline (auto)",
        "Case1 SBD_Centreline_DarkBlue near site")
    dlg.AddCommandLink(
        TaskDialogCommandLinkId.CommandLink2,
        "Pick one straight line",
        "Line parallel to street; angle only")
    dlg.AddCommandLink(
        TaskDialogCommandLinkId.CommandLink3,
        "Site PCA",
        "Dominant axis from site boundary")
    dlg.CommonButtons = TaskDialogCommonButtons.Cancel
    dlg.AllowCancellation = True
    result = dlg.Show()

    if result == TaskDialogResult.Cancel:
        return AXIS1_CANCEL

    if result == TaskDialogResult.CommandLink1:
        axis, status = get_centreline_direction_from_style(site_pts)
        if status == "ok" and axis is not None:
            return axis
        if status == "multi":
            TaskDialog.Show(
                "Case2 — Street Axis",
                "Multiple street directions detected near this site.\n"
                "Pick one straight line parallel to the street for Axis 1.")
        else:
            debug_print("  [Case2] Centreline PCA unavailable — pick a reference line.")
        return pick_single_line_direction(
            "Pick ONE straight line parallel to the street (angle only)")

    if result == TaskDialogResult.CommandLink2:
        return pick_single_line_direction(
            "Pick ONE straight line for Projection Axis 1 (angle only)")

    if result == TaskDialogResult.CommandLink3:
        return None

    return AXIS1_CANCEL


def _pick_notional_corridor_optional():
    dlg = TaskDialog("Case2 — Notional Air Corridor")
    dlg.MainInstruction = (
        "Draw / pick a notional air corridor centreline (Fig B13–B14)?\n"
        "Cancel = skip.")
    dlg.CommonButtons = TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No
    if dlg.Show() != TaskDialogResult.Yes:
        return None
    curves = get_selected_curves("Select NOTIONAL AIR CORRIDOR centreline")
    if not curves:
        return None
    return get_points_from_curves(curves, 100)


def _resolve_axes(site_pts, building_loops, street_axis):
    axis1 = street_axis if street_axis else compute_dominant_axis(site_pts)
    axis2 = orthogonal_axis(axis1)
    from sbd_geometry import validate_projection
    if not validate_projection(site_pts, building_loops, axis1):
        debug_print("  [Case2] PCA axis validation failed — manual axis pick.")
        picked = pick_projection_lines(
            "Pick two perpendicular projection lines (Axis 1, then Axis 2)")
        if picked:
            axis1, axis2 = picked
    return axis1, axis2


def _print_summary(assessment, req_p, lp_m, corridor_info=None):
    debug_print("\n===== Case2 Permeability Summary =====")
    debug_print("Formulas (APP-152):")
    debug_print("  W  = site projection width on Axis 1")
    debug_print("  IS = sum of qualifying gap widths on Axis 1")
    debug_print("  P  = (IS / W) x 100%")
    debug_print("  S1 >= 7.5 m | S2 >= 15 m | S3 = A/D >= 7.5 m")
    debug_print("  Controlling P = min P across 6 passes (3 zones x 2 axes)")
    debug_print("Site area: {:.1f} m2".format(assessment["site_area_m2"]))
    debug_print("Triggering Lp: {:.2f} m".format(lp_m))
    if req_p is not None:
        debug_print("Required P (Table 1): {:.0f}%".format(req_p))
    else:
        debug_print("Required P: NOT REQUIRED")
    debug_print("Controlling P (min across 6 passes): {:.1f}%".format(
        assessment["controlling_p"]))
    if corridor_info:
        debug_print(
            "Notional corridor: half-width={:.1f}m; "
            "{} building(s) excluded; {} remain".format(
                CORRIDOR_HALF_M,
                corridor_info.get("filtered", 0),
                corridor_info.get("remaining", 0)))
        if corridor_info.get("drawn"):
            debug_print(
                "  Slab visual on APP152_LOW: UV rectangle ∩ site "
                "(boolean Intersect); schematic only — does not change P")
    for zr in assessment["zone_results"]:
        a1 = zr["axis1"]
        a2 = zr["axis2"]
        stub = " [STUB]" if zr.get("stub") else ""
        w_m = a1.get("W", 0) * FEET_TO_METERS
        is_m = a1.get("IS", 0) * FEET_TO_METERS
        p_val = a1.get("P", 0)
        debug_print("  Zone {}{}:".format(zr["zone"], stub))
        if w_m > 1e-9:
            debug_print(
                "    Axis1 angle={:+d}deg  P=({:.2f}/{:.2f})x100%={:.1f}%  "
                "IS={:.2f}m  W={:.2f}m".format(
                    int(a1.get("sweep_angle", 0)), is_m, w_m, p_val, is_m, w_m))
        else:
            debug_print("    Axis1 angle={:+d}deg P={:.1f}% IS={:.2f}m".format(
                int(a1.get("sweep_angle", 0)), p_val, is_m))
        gap_parts = []
        for gap in a1.get("all_gap_results", []):
            m = gap.get("measurement", {})
            stype = m.get("type", "?")
            dist = m.get("distance_m", gap.get("width_ft", 0) * FEET_TO_METERS)
            thr = m.get("threshold_m", 0.0)
            status = "PASS" if gap.get("qualifies") else "FAIL"
            gap_parts.append("{} {} {:.2f}m (>= {:.1f}m)".format(
                stype, status, dist, thr))
        if gap_parts:
            debug_print("    Gaps: {}".format(" | ".join(gap_parts)))
        debug_print("    Axis2 P={:.1f}% IS={:.2f}m".format(
            a2.get("P", 0), a2.get("IS", 0) * FEET_TO_METERS))
    if req_p is not None:
        verdict = "PASS" if assessment["controlling_p"] >= req_p else "FAIL"
        debug_print("Overall: {} (controlling P {:.1f}% vs req {:.0f}%)".format(
            verdict, assessment["controlling_p"], req_p))


def run():
    view = doc.ActiveView
    if view is None:
        TaskDialog.Show("Case2", "No active view.")
        return

    view_elev = getattr(view, "GenLevel", None)
    elev = view_elev.Elevation if view_elev else 0.0

    site_pts = _pick_site_boundary()
    if not site_pts:
        return

    building_loops = _pick_building_loops()
    if not building_loops:
        return

    street_axis = _pick_axis1_source(site_pts)
    if street_axis is AXIS1_CANCEL:
        debug_print("  [Case2] Cancelled by user.")
        return
    corridor_pts = _pick_notional_corridor_optional()
    _ask_level_zero(elev)
    tallest_m = _ask_height_m(20.0)
    debug_print("  [Case2] Tallest building height: {:.1f} m".format(tallest_m))

    corridor_poly = None
    corridor_filtered_count = 0
    n_buildings_before = len(building_loops)
    if corridor_pts:
        half_ft = CORRIDOR_HALF_M / FEET_TO_METERS
        corridor_poly = offset_polyline_both_sides(corridor_pts, half_ft)
        building_loops = filter_buildings_outside_corridor(
            building_loops, corridor_poly)
        corridor_filtered_count = n_buildings_before - len(building_loops)
        debug_print(
            "  [Case2] Notional corridor applied; "
            "{} excluded, {} building(s) remain.".format(
                corridor_filtered_count, len(building_loops)))

    axis1, axis2 = _resolve_axes(site_pts, building_loops, street_axis)
    lp_old_m = _max_lp_across_buildings(building_loops)
    lp_m = _projected_lp_m(building_loops, axis1)
    site_area_m2 = polygon_area_2d(site_pts) * FEET_TO_METERS * FEET_TO_METERS
    req_p = get_required_p(site_area_m2, lp_m)
    req_p_old = get_required_p(site_area_m2, lp_old_m)
    debug_print("  [Case2] Lp projected on Axis 1 (all buildings) = {:.2f} m -> required P {}; "
                "Lp of the earlier version (shorter side of one building) = {:.2f} m -> {}".format(
                    lp_m, "none" if req_p is None else "%.0f%%" % req_p,
                    lp_old_m, "none" if req_p_old is None else "%.0f%%" % req_p_old))

    tg = TransactionGroup(doc, "SBD Case2 Permeability")
    tg.Start()
    try:
        purge_app152_outputs(doc, debug_print)

        assessment = run_full_assessment(
            site_pts, site_pts, building_loops,
            axis_primary=axis1, axis_secondary=axis2,
            street_axis=street_axis)

        zone_views = {}
        with Transaction(doc, "SBD Case2 Draw") as t:
            t.Start()
            low_zr = None
            for zr in assessment["zone_results"]:
                if zr.get("zone") == "LOW":
                    low_zr = zr
                    break
            if low_zr and building_loops:
                a1 = low_zr.get("axis1", {})
                draw_corridor_fills_on_view(
                    doc, view, elev, site_pts, building_loops,
                    a1.get("axis"),
                    a1.get("all_gap_results", a1.get("gaps", [])))

            zone_views = duplicate_zone_views(doc, view)
            for zr in assessment["zone_results"]:
                v = zone_views.get(zr["zone"])
                if v:
                    render_zone_deliverables(
                        doc, v, elev, zr, site_pts, req_p,
                        building_loops=building_loops,
                        corridor_poly=corridor_poly,
                        corridor_filtered_count=corridor_filtered_count,
                        draw_corridor_fills=False)
            t.Commit()

        corridor_info = None
        if corridor_poly is not None:
            corridor_info = {
                "filtered": corridor_filtered_count,
                "remaining": len(building_loops),
                "drawn": True,
            }
        _print_summary(assessment, req_p, lp_m, corridor_info=corridor_info)
        tg.Assimilate()
        try:
            active_view_name = view.Name
        except Exception:
            active_view_name = "active view"
        TaskDialog.Show(
            "Case2 Complete",
            "Permeability assessment complete.\n"
            "Controlling P = {:.1f}%\n"
            "Required P = {} (Lp {:.1f} m projected on Axis 1; earlier version: Lp {:.1f} m, {})\n\n"
            "NOTE: the Middle (20-60 m) and High (60 m+) zones use the SAME 2D footprints "
            "as the Low zone here. For a podium + tower scheme use LWK > SBD Export: the "
            "viewer cuts each zone from the 3D masses.\n\n"
            "Corridor fills: {} (current view)\n"
            "Audit graphics: APP152_LOW / APP152_MID / APP152_HIGH".format(
                assessment["controlling_p"],
                "none" if req_p is None else "%.0f%%" % req_p, lp_m, lp_old_m,
                "none" if req_p_old is None else "%.0f%%" % req_p_old,
                active_view_name))
    except Exception as ex:
        debug_print("  [Case2] ERROR: {}".format(ex))
        tg.RollBack()
        TaskDialog.Show("Case2 Error", str(ex))


if __name__ == "__main__":
    run()
