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
# ORDER MATTERS. Each insert goes to index 0, so the LAST one inserted is
# searched FIRST. The original order put the button folder at index 0, which
# meant any sbd_*.py sitting in a button folder shadowed Shared.scripts -- the
# trap in section 0 of the handover, and the cause of several rounds of "I
# fixed it but nothing changed". Reversed so Shared.scripts always wins.
for _p in (_BUTTON_DIR, _CASE1_DIR, _SHARED_DIR):
    if _p in sys.path:
        sys.path.remove(_p)
    sys.path.insert(0, _p)

clr.AddReference('RevitAPI')
clr.AddReference('RevitAPIUI')
from Autodesk.Revit.DB import (
    FilteredElementCollector, Level, Transaction, TransactionGroup,
    XYZ, Color,
)
from Autodesk.Revit.UI import (
    TaskDialog, TaskDialogResult, TaskDialogCommonButtons,
    TaskDialogCommandLinkId,
)

from pyrevit import revit
from pyrevit import forms
from pyrevit import script as _pyrevit_script

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
    create_colored_polyline,
    pick_projection_lines, get_selected_curves,
    get_centreline_direction_from_style, pick_single_line_direction,
)
from sbd_purge import purge_app152_outputs
from sbd_geom_topology import validate_or_repair_loop
from sbd_permeability import (
    run_full_assessment, get_required_p, orthogonal_axis,
    filter_buildings_outside_corridor, offset_polyline_both_sides,
    optimize_plane_y, PLANE_Y_ANGLE_MIN, PLANE_Y_ANGLE_MAX,
)
from sbd_audit_draw import (duplicate_zone_views, render_zone_deliverables,
                            draw_corridor_fills_on_view,
                            draw_corridors_and_sides)
try:
    from sbd_wind_corridor import (street_centreline_from_curves,
                                    street_centreline_from_points,
                                    compute_wind_corridors, side_average_width,
                                    compute_side_averages,
                                    corridors_for_group_chain,
                                    MIN_CORRIDOR_M)
    _WIND_OK = True
except Exception as _wind_err:
    _WIND_OK = False
    MIN_CORRIDOR_M = 15.0

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


def _label_buildings_temporarily(doc, view, building_loops, elev):
    """
    Stamp B1..Bn at each building centroid so the user can SEE which tower
    each height prompt refers to. Returns the ids so they can be removed.

    Without this the prompt asked for six numbers with no way to tell which
    tower was which, and every short building landed in the same group by
    accident.
    """
    ids = []
    try:
        from sbd_audit_draw import create_audit_text
        t = Transaction(doc, "SBD Temp Building Numbers")
        t.Start()
        for i, loop in enumerate(building_loops or []):
            if not loop:
                continue
            n = float(len(loop))
            c = XYZ(sum(p.X for p in loop) / n,
                    sum(p.Y for p in loop) / n, elev)
            tn = create_audit_text(doc, view, c, "B{}".format(i + 1), elev)
            if tn is not None:
                ids.append(tn.Id if hasattr(tn, "Id") else tn)
        t.Commit()
    except Exception as e:
        debug_print("  [Case2] could not label buildings ({}).".format(e))
    return ids


def _remove_temp_labels(doc, ids):
    if not ids:
        return
    try:
        t = Transaction(doc, "SBD Remove Temp Numbers")
        t.Start()
        for i in ids:
            try:
                doc.Delete(i)
            except Exception:
                pass
        t.Commit()
    except Exception:
        pass


def _ask_building_heights_m(building_loops, default_m=20.0,
                            doc=None, view=None, elev=0.0):
    """
    Height of EACH building, asked ONE AT A TIME in pick order.

    The deformed elevation draws every building's shadow only to its own
    height, and the sky above a shorter one counts toward IS -- so the
    heights must be matched to the right towers. A single comma-separated
    prompt gave no way to tell which building was which.
    """
    n = len(building_loops or [])
    if n == 0:
        return []
    ids = []
    if doc is not None and view is not None:
        ids = _label_buildings_temporarily(doc, view, building_loops, elev)
    heights = []
    try:
        for i in range(n):
            answer = forms.ask_for_string(
                default=str(default_m),
                prompt=("Height (m) of building B{} of {}\n"
                        "(B numbers are shown on the plan)".format(i + 1, n)),
                title="Case2 - Building B{} Height".format(i + 1))
            if answer is None:
                heights.append(default_m)
                continue
            try:
                heights.append(float(str(answer).strip()))
            except ValueError:
                heights.append(default_m)
    finally:
        _remove_temp_labels(doc, ids)
    return heights


def zone_heights_m(heights_m, zone_name, height_mode="overall",
                   base_level_m=None, tallest_m=None, debug=None):
    """Convert the heights the user typed into the portion of each building
    that lies inside ONE zone band.

    Two things the user has to tell us, because neither is inferable:

    height_mode "overall" -- the figure is the roof level, so the band has
        to be sliced out of it: a 20 m block contributes 20 m to the 0-20 m
        LOW band and nothing to MIDDLE. Entering 20 m and having it drawn
        full height in every zone is why MIDDLE and HIGH looked wrong.
    height_mode "zone" -- the user has already worked out the in-zone
        portion; use it as given.

    base_level_m is the MEAN STREET LEVEL relative to this view's floor.
    APP-152 measures height from the mean level of the street the building
    abuts up to the mean roof level over the highest usable floor, and that
    datum is not necessarily the floor the plan sits on. A floor 1.5 m above
    the street means every building is 1.5 m taller in APP-152 terms, which
    can move a block across a band boundary. None = the two coincide.
    """
    try:
        from sbd_permeability import ZONE_CONFIG, ZONE_LOW
    except Exception:
        return list(heights_m or [])
    if not heights_m:
        return []
    if height_mode == "zone":
        return list(heights_m)
    cfg = ZONE_CONFIG.get(zone_name) or ZONE_CONFIG[ZONE_LOW]
    z_lo = float(cfg.get("z_min_m") or 0.0)
    z_hi = cfg.get("z_max_m")
    if z_hi is None:
        z_hi = float(tallest_m or 0.0) or (z_lo + 20.0)
    offset = float(base_level_m or 0.0)
    out = []
    for h in heights_m:
        try:
            h_street = float(h) - offset      # roof above the street datum
        except Exception:
            h_street = 0.0
        out.append(max(0.0, min(h_street, float(z_hi)) - z_lo))
    if debug:
        debug("  [Zone {}] band {:.0f}-{:.0f} m -> heights {}".format(
            zone_name, z_lo, z_hi,
            ", ".join("{:.1f}".format(v) for v in out)))
    return out


def _apply_plan_results_to_zones(assessment, centre_corridors, side_results,
                                 debug=None, plane_key="axis1",
                                 frame_site_lo=None, frame_site_hi=None,
                                 zones=None):
    """
    Overwrite each zone's Axis-1 gap measurements with the values ACTUALLY
    MEASURED ON PLAN, then recompute IS, P and the controlling P.

    Two assessments were running side by side. run_full_assessment does its
    own automatic gap detection (S1 9.82 / S2 15.65 / S1 12.08), while the
    explicit group pass produced the corridors and side regions that are
    drawn (side 10.95 / corridor 15.39 / side 10.97). The elevation was
    switched to the plan values, but the stepped bar, the audit text block
    and the summary all still read the automatic ones -- so the same drawing
    carried two sets of numbers for the same gaps.

    Rather than patch each consumer, the zone result itself is corrected
    here: gap POSITIONS are kept (the bar still draws in the right place)
    and only the measured distances are replaced, in u order --
    first setback <- side "left", internal gaps <- corridors, last setback
    <- side "right". Everything downstream then follows one source.
    """
    if debug is None:
        def debug(_m):
            pass
    if not (centre_corridors or side_results):
        return

    sides = {}
    for sr in side_results or []:
        if sr and sr.get("avg_width_m"):
            sides[sr.get("side")] = sr["avg_width_m"]
    corridor_w = [c["width_ft"] * FEET_TO_METERS
                  for c in (centre_corridors or [])
                  if c and c.get("width_ft")]

    # zones: restrict the rewrite to these zone names.
    #
    # Plane X is solved ONCE in a frame every zone shares, so it correctly
    # applies to all of them (zones=None). Plane Y is NOT: its angle is
    # optimised per zone (LOW at 95 deg while HIGH lands at 99), so the Y
    # pass runs inside the per-zone loop. Without a filter, LOW's Y
    # corridors were written into MIDDLE's and HIGH's axis2 as well, then
    # MIDDLE's overwrote all three, then HIGH's did -- so every zone ended
    # up carrying HIGH's Y numbers. The per-zone DRAWING was still right
    # (render_zone_deliverables runs before the next zone overwrites), but
    # the summary, the audit text and controlling_p all read the last
    # zone's Y result for every zone.
    _want = set(zones) if zones else None

    for zr in assessment.get("zone_results", []):
        if _want is not None and zr.get("zone") not in _want:
            continue
        # plane_key selects which plane's numbers are being corrected.
        # Plane Y now gets its own plan pass, and its gaps must be replaced
        # with the Y-frame corridors -- writing them into axis1 would
        # overwrite the X result with Y measurements.
        a1 = zr.get(plane_key)
        if not a1:
            continue
        gaps = a1.get("all_gap_results") or []
        if not gaps:
            continue
        gaps = sorted(gaps, key=lambda g: g.get("gap_lo", 0.0))
        setbacks = [g for g in gaps
                    if (g.get("measurement") or {}).get("type") == "S1"]
        internals = [g for g in gaps
                     if (g.get("measurement") or {}).get("type") == "S2"]

        def _set(g, new_m, kind):
            m = g.get("measurement") or {}
            old = m.get("distance_m", 0.0)
            m["distance_m"] = new_m
            m["distance_ft"] = new_m / FEET_TO_METERS
            m["pass"] = new_m >= (15.0 if kind == "S2" else 7.5)
            m["from_plan"] = True
            g["measurement"] = m
            g["qualifies"] = bool(m["pass"])
            g["is_width_ft"] = m["distance_ft"]
            debug("  [Plan] {} {:.2f}m -> {:.2f}m (from plan)".format(
                kind, old, new_m))

        if setbacks:
            if sides.get("left"):
                _set(setbacks[0], sides["left"], "S1")
            if len(setbacks) > 1 and sides.get("right"):
                _set(setbacks[-1], sides["right"], "S1")
        for i, g in enumerate(internals):
            if i < len(corridor_w):
                _set(g, corridor_w[i], "S2")

        IS = 0.0
        verified = []
        for g in gaps:
            if g.get("qualifies"):
                verified.append(g)
                m = g.get("measurement") or {}
                IS += m.get("distance_ft", g.get("width_ft", 0.0))
        a1["IS"] = IS
        a1["gaps"] = verified
        # W MUST COME FROM THE FRAME THE GAPS WERE MEASURED IN.
        # The plan pass measures in the user's plane; MIDDLE and HIGH sweep
        # their own plane by up to 30 deg and carry that frame's W. Writing
        # the measured IS into a zone but leaving its swept W gave
        # "Axis1 angle=+0deg P=(56.10/203.00)" -- an IS from +0 deg over a W
        # from +30 deg. That mismatch made MIDDLE/HIGH the controlling
        # 27.6% and left their elevation describing a different width from
        # the one printed beside it.
        if frame_site_lo is not None and frame_site_hi is not None:
            _w_new = frame_site_hi - frame_site_lo
            if _w_new > 1e-9 and abs(_w_new - a1.get("W", 0.0)) > 1e-6:
                if debug:
                    debug("  [Plan] {} W {:.2f} m -> {:.2f} m (the frame the "
                          "gaps were measured in)".format(
                              "Axis1" if plane_key == "axis1" else "Axis2",
                              a1.get("W", 0.0) * FEET_TO_METERS,
                              _w_new * FEET_TO_METERS))
                a1["W"] = _w_new
                a1["site_lo"] = frame_site_lo
                a1["site_hi"] = frame_site_hi
                a1["sweep_angle"] = 0.0
        W = a1.get("W", 0.0)
        a1["P"] = (IS / W) * 100.0 if W > 1e-9 else 0.0
        debug("  [Plan] {} recomputed from plan: IS={:.2f}m W={:.2f}m "
              "P={:.1f}%".format(
                  "Axis1" if plane_key == "axis1" else "Axis2",
                  IS * FEET_TO_METERS, W * FEET_TO_METERS, a1["P"]))

    all_p = []
    for zr in assessment.get("zone_results", []):
        for k in ("axis1", "axis2"):
            if zr.get(k):
                all_p.append(zr[k].get("P", 0.0))
    if all_p:
        assessment["controlling_p"] = min(all_p)


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
    # FIX 2026-11: an opening up to 2 ft (0.6 m) used to be closed silently
    _gap_m = pts[0].DistanceTo(pts[-1]) * FEET_TO_METERS
    if _gap_m > 0.01:
        _res = TaskDialog.Show(
            "Case2 - Site Boundary",
            "The site boundary does not close: its ends are {:.3f} m apart.\n\n"
            "Use it anyway (closed by a straight line)?".format(_gap_m),
            TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No)
        if _res != TaskDialogResult.Yes:
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
        # FIX 2026-11: a Filled Region holding two separate blocks kept only
        # the largest; every outer loop is a building now (holes left out)
        for pts in _region_outer_loops(r):
            loop = ensure_loop_ccw(pts)
            loop = validate_or_repair_loop(loop) or loop
            loops.append(loop)
    return loops


def _region_outer_loops(r):
    """Every outer loop of a picked Filled Region (a loop inside another
    loop of the same region is a hole, left out)."""
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

    def _inside(pt, poly):
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
        depth = sum(1 for j, b in enumerate(all_pts) if j != i and _inside(a[0], b))
        if depth % 2 == 0:
            out.append(a)
    debug_print("  [Case2] Filled Region with {} loops: {} building(s), {} hole(s)".format(
        len(all_pts), len(out), len(all_pts) - len(out)))
    return out or [r["loop_pts"]]


def _projected_lp_m(building_loops, axis):
    """Lp as the length of all the buildings projected on Projection Plane X
    (Axis 1). Printed BESIDE the Lp used (compute_lp_m: the shorter side of
    one building's bounding rectangle) until the APP-152 reading is
    confirmed - the required P is not changed by it."""
    from sbd_geometry import project_polygon_onto_axis, merge_overlapping_intervals
    iv = [list(project_polygon_onto_axis(l, axis)) for l in building_loops if l]
    return sum(hi - lo for lo, hi in merge_overlapping_intervals(iv)) * FEET_TO_METERS


def _pick_building_groups():
    """
    Sequential GROUP picker for the explicit gap method.

    The user selects a building or a GROUP of buildings that forms one side
    of an air gap, then the next group, and so on. The gap assessed is
    between each consecutive pair of groups. Returns a list of groups,
    each a list of loops (or None if cancelled / fewer than 2 groups).
    """
    groups = []
    while True:
        n = len(groups) + 1
        msg = ("Select the building(s) forming GROUP {}.\n\n"
               "One group = one side of an air gap. Pick a single building "
               "or several that act together, then Finish.".format(n))
        if len(groups) >= 2:
            msg += "\n\n(Cancel the selection when you have no more groups.)"
        TaskDialog.Show("Case2 - Gap Group {}".format(n), msg)
        regions = get_selected_filled_regions(
            "Select GROUP {} Filled Region(s), then Finish".format(n))
        if not regions:
            break
        loops = []
        for r in regions:
            for pts in _region_outer_loops(r):      # FIX 2026-11: all blocks of a region
                loop = ensure_loop_ccw(pts)
                loop = validate_or_repair_loop(loop) or loop
                loops.append(loop)
        groups.append(loops)
        debug_print("  [Case2] Gap group {}: {} building(s).".format(n, len(loops)))
        if len(groups) >= 2:
            more = TaskDialog.Show(
                "Case2 - Another Group?",
                "Add another building group (defines the next gap)?",
                TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No)
            if more != TaskDialogResult.Yes:
                break
    if len(groups) < 2:
        debug_print("  [Case2] Need at least 2 groups to define a gap; "
                     "explicit gap method skipped.")
        return None
    return groups


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


def _resolve_axes(site_pts, building_loops, street_axis, street_cl_extensions=None):
    axis1 = street_axis if street_axis else compute_dominant_axis(site_pts)
    from sbd_geometry import validate_projection
    if not validate_projection(site_pts, building_loops, axis1):
        debug_print("  [Case2] PCA axis validation failed — manual axis pick.")
        picked = pick_projection_lines(
            "Pick Projection Axis 1 line only (Plane Y will be auto-optimized "
            "in {:.0f}–{:.0f} deg range)".format(
                PLANE_Y_ANGLE_MIN, PLANE_Y_ANGLE_MAX))
        if picked:
            axis1, _unused = picked
    axis2, y_result = optimize_plane_y(
        site_pts, site_pts, building_loops, axis1,
        street_cl_extensions=street_cl_extensions)
    y_deg = y_result.get("plane_y_angle_deg", 90.0)
    debug_print("  [Case2] Plane Y auto-selected at {:.0f} deg from Plane X "
                "(P={:.1f}%)".format(y_deg, y_result.get("P", 0.0)))
    return axis1, axis2, y_deg


# Computed street centrelines, kept so they can be DRAWN for checking.
# Without a graphic there is no way to tell whether the derived centreline
# is where the architect expects it -- which is exactly how the previous
# typed-width version went unnoticed.
# The picked Projection Plane X line, IN FULL (points, not just a
# direction). The elevation and its bar belong on the side of the site this
# line lies on; Plane Y's line is this one turned about the site centroid by
# the X->Y angle. Empty when the axis came from PCA or the street-direction
# auto mode, and the drawing then keeps its heuristic.
_PLANE_X_LINE = []

_STREET_CENTRELINES = []
_RAW_STREETS = []          # wizard street picks, re-resolved per plane


def street_extensions_for_axis(streets, axis_u, axis_v, site_pts,
                               tag="", debug=None):
    """Resolve the street picks into a left/right extension dict for ONE frame.

    The user may select every street bounding the site -- both legs of an L,
    say. Which leg serves which side region depends on the projection plane,
    so this is called once per plane instead of once per run. A leg that
    faces neither side in this frame simply contributes nothing here.
    """
    if debug is None:
        def debug(_m):
            pass
    if not streets or axis_u is None:
        return None
    ext = {"left": 0.0, "right": 0.0}
    found = []
    for i, s in enumerate(streets):
        try:
            res = street_centreline_from_points(
                s.get("subject_pts"), s.get("opposite_pts"),
                axis_u, axis_v, site_pts)
        except Exception as err:
            debug("  [{}] Street {} centreline failed: {}".format(
                tag, i + 1, err))
            continue
        if not res:
            continue
        sd = res["side"]
        # Widest wins per side: with two legs resolving to the same side in
        # this frame, the one the region actually reaches is the further of
        # the two.
        if res["extension_ft"] > ext.get(sd, 0.0):
            ext[sd] = res["extension_ft"]
            if res.get("centreline_pts"):
                ext[sd + "_cl"] = res["centreline_pts"]
        found.append((i + 1, sd, res["extension_m"]))
    if not found:
        return None
    debug("  [{}] Streets in this frame: {}".format(
        tag, "; ".join("street {} -> {} ({:.2f} m)".format(n, sd, m)
                       for n, sd, m in found)))
    if not (ext.get("left") or ext.get("right")):
        return None
    return ext

try:
    from sbd_wizard2 import run_wizard
    _WIZARD_OK = True
except Exception as _wiz_err:
    _WIZARD_OK = False
    debug_print("  [Case2] Setup window unavailable ({}); prompts will be "
                 "used.".format(_wiz_err))


def _ask_zones():
    """Which assessment zones to run. MIDDLE and HIGH each run their own
    X x Y plane optimisation, so skipping them is the single biggest
    saving when only the low zone is of interest."""
    dlg = TaskDialog("Case2 - Assessment Zones")
    dlg.MainInstruction = "Which zones do you want to assess?"
    dlg.AddCommandLink(TaskDialogCommandLinkId.CommandLink1,
                       "All three zones",
                       "LOW + MIDDLE + HIGH (slowest, full submission set)")
    dlg.AddCommandLink(TaskDialogCommandLinkId.CommandLink2,
                       "Low zone only",
                       "Fastest - skips both plane optimisations")
    dlg.AddCommandLink(TaskDialogCommandLinkId.CommandLink3,
                       "Low + Middle")
    r = dlg.Show()
    if r == TaskDialogResult.CommandLink2:
        z = ("LOW",)
    elif r == TaskDialogResult.CommandLink3:
        z = ("LOW", "MIDDLE")
    else:
        z = ("LOW", "MIDDLE", "HIGH")
    debug_print("  [Case2] Zones to assess: {}".format(", ".join(z)))
    return z


def _ask_street_cl_extensions(site_pts, axis_u=None, axis_v=None):
    """
    APP-152 Fig B12/B14: where the site abuts a STREET, S1 may be measured
    to the street CENTRELINE.

    Asks for the SAME TWO INPUTS AS CASE 1 -- the site boundary edge that
    faces the street, and the opposite side of the street -- and then uses
    Case 1's own centreline builder. Two earlier attempts were wrong:
      * typing a street WIDTH: one number cannot describe a street that
        varies in width or a non-parallel opposite boundary;
      * deriving the street-facing edge automatically from the whole site
        polygon: on an irregular site it picked the wrong points, giving a
        0.26 m minimum and a 15.37 m maximum on one street.
    Selecting the subject edge explicitly is what Case 1 does, and its
    builder additionally trims endpoint-clamped samples and rejects
    width outliers.

    Returns {"left": ft, "right": ft} or None.
    """
    dlg = TaskDialog("Case2 - Street Centreline Extension")
    dlg.MainInstruction = (
        "Extend side separation (S1) to the street centreline?\n\n"
        "You will select, for each street:\n"
        "  1. the SITE boundary edge facing that street\n"
        "  2. the OPPOSITE side of the street\n\n"
        "The centreline is then built the same way as Case 1.\n"
        "No = measure only to the site boundary (common BL).")
    dlg.CommonButtons = TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No
    if dlg.Show() != TaskDialogResult.Yes:
        return None
    if axis_u is None or axis_v is None:
        debug_print("  [Case2] Street CL extension needs the projection "
                     "axes; skipped.")
        return None

    ext = {"left": 0.0, "right": 0.0}
    picked = 0
    while True:
        n = picked + 1
        TaskDialog.Show(
            "Case2 - Street {} : SITE edge".format(n),
            "Select the SITE boundary line(s) that face street {}, then "
            "Finish.\n\nCancel when there are no more streets.".format(n))
        try:
            subj = get_selected_curves(
                "Select the SITE boundary facing the street, then Finish")
        except Exception:
            subj = None
        if not subj:
            break

        TaskDialog.Show(
            "Case2 - Street {} : OPPOSITE side".format(n),
            "Now select the boundary line(s) on the OPPOSITE side of "
            "street {}, then Finish.".format(n))
        try:
            opp = get_selected_curves(
                "Select the OPPOSITE side of the street, then Finish")
        except Exception:
            opp = None
        if not opp:
            break

        try:
            res = street_centreline_from_curves(subj, opp, axis_u, axis_v,
                                                site_pts)
        except Exception as exc:
            debug_print("  [Case2] Street CL failed: {}".format(exc))
            res = None
        if res is None:
            break

        side = res["side"]
        ext[side] = max(ext[side], res["extension_ft"])
        if res.get("centreline_pts"):
            _STREET_CENTRELINES.append(res["centreline_pts"])
            # hand the centreline itself downstream so the side region's
            # outer edge follows the real street, not a mean offset
            ext[side + "_cl"] = res["centreline_pts"]
        picked += 1
        debug_print("  [Case2] Street {}: street on the {}; extension "
                     "{:.2f} m (Case 1 centreline builder)."
                     .format(picked, side, res["extension_m"]))

        more = TaskDialog.Show(
            "Case2 - Another Street?",
            "Does the site abut a street on another side as well?",
            TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No)
        if more != TaskDialogResult.Yes:
            break

    if not picked:
        return None
    debug_print("  [Case2] Street CL extension: left={:.2f} m right={:.2f} m"
                .format(ext["left"] * FEET_TO_METERS,
                        ext["right"] * FEET_TO_METERS))
    return ext

def _pick_pe_loops_optional():
    """Optional PE (Permeable Element) filled regions — refuge floors, sky gardens."""
    dlg = TaskDialog("Case2 — Permeable Elements (PE)")
    dlg.MainInstruction = (
        "Select filled regions representing Permeable Elements?\n"
        "(refuge floors, sky gardens — min 3 m clear width/height)\n\n"
        "No = skip PE assessment.")
    dlg.CommonButtons = TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No
    if dlg.Show() != TaskDialogResult.Yes:
        return []
    TaskDialog.Show(
        "Case2 — PE Regions",
        "Select PE footprint Filled Region(s), then Finish.")
    regions = get_selected_filled_regions(
        "Select PE Filled Region(s), then Finish")
    loops = []
    for r in regions or []:
        loop = ensure_loop_ccw(r["loop_pts"])
        loop = validate_or_repair_loop(loop) or loop
        loops.append(loop)
    debug_print("  [Case2] {} PE region(s) selected.".format(len(loops)))
    return loops


def _print_summary(assessment, req_p, lp_m, corridor_info=None):
    debug_print("\n===== Case2 Permeability Summary =====")
    debug_print("Formulas (APP-152):")
    debug_print("  W  = site projection width on Axis 1")
    debug_print("  IS = sum of qualifying gap widths on Axis 1")
    debug_print("  P  = (IS / W) x 100%")
    debug_print("  S1 >= 7.5 m | S2 >= 15 m | S3 = A/D >= 7.5 m")
    debug_print("  Plane Y auto-optimized in {:.0f}–{:.0f} deg from Plane X".format(
        PLANE_Y_ANGLE_MIN, PLANE_Y_ANGLE_MAX))
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
        y_note = ""
        if zr.get("plane_y_angle_deg") is not None:
            y_note = " Y={:.0f}deg from X".format(zr["plane_y_angle_deg"])
        if zr.get("plane_x_angle_deg") not in (None, 0.0):
            y_note += " X={:+.0f}deg".format(zr["plane_x_angle_deg"])
        w_m = a1.get("W", 0) * FEET_TO_METERS
        is_m = a1.get("IS", 0) * FEET_TO_METERS
        p_val = a1.get("P", 0)
        debug_print("  Zone {}{}:{}".format(zr["zone"], stub, y_note))
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
        if zr.get("combined_p") is not None:
            debug_print("    IS area P={:.1f}% + PE={:.1f}% -> combined {:.1f}%".format(
                zr.get("is_area_pct", 0.0), zr.get("pe_area_pct", 0.0),
                zr.get("combined_p", 0.0)))
    if req_p is not None:
        verdict = "PASS" if assessment["controlling_p"] >= req_p else "FAIL"
        debug_print("Overall: {} (controlling P {:.1f}% vs req {:.0f}%)".format(
            verdict, assessment["controlling_p"], req_p))


def run():
    # Force the pyRevit output console open so debug_print() is visible.
    try:
        _out = _pyrevit_script.get_output()
        _out.show()
        debug_print("=== SBD Case 2 Permeability — run start ===")
    except Exception:
        pass
    view = doc.ActiveView
    if view is None:
        TaskDialog.Show("Case2", "No active view.")
        return

    view_elev = getattr(view, "GenLevel", None)
    elev = view_elev.Elevation if view_elev else 0.0

    # ------------------------------------------------------------------
    # INPUTS: single setup window, with the prompt chain as a fallback.
    # The wizard shows a schematic of everything picked so far, so group
    # membership and the street boundaries can be SEEN rather than
    # remembered from the order they were clicked.
    # ------------------------------------------------------------------
    wiz = None
    if _WIZARD_OK:
        try:
            _use = TaskDialog.Show(
                "Case2 - Setup",
                "Use the setup window?\n\n"
                "Yes = one window with a plan preview (recommended)\n"
                "No  = step through the prompts one at a time",
                TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No)
            if _use == TaskDialogResult.Yes:
                wiz = run_wizard(uidoc)
                if wiz is None:
                    debug_print("  [Case2] Setup window cancelled.")
                    return
        except Exception as _we:
            import traceback as _tb
            debug_print("  [Case2] Setup window FAILED -- falling back to "
                         "prompts. Reason: {}".format(_we))
            debug_print(_tb.format_exc())
            wiz = None

    _gap_groups = None
    _gap_groups_y = None
    _height_mode = "overall"
    _base_level_m = None
    building_heights_m = None

    if wiz is not None:
        # ---- inputs from the wizard ----
        site_pts = wiz.site_pts
        building_loops = [b["loop_pts"] for b in wiz.buildings
                          if b.get("loop_pts")]
        _gap_groups = wiz.group_loops() or None
        try:
            _gap_groups_y = wiz.group_loops_y() or None
        except Exception:
            _gap_groups_y = None
        try:
            _height_mode = wiz.get_height_mode()
            _base_level_m = wiz.get_base_level_m()
        except Exception:
            _height_mode, _base_level_m = "overall", None
        debug_print(
            "  [Case2] Heights read as {}; mean street level {}.".format(
                "the OVERALL building height above street level"
                if _height_mode == "overall"
                else "the portion inside the selected zone",
                "{:+.2f} m relative to this floor".format(_base_level_m)
                if _base_level_m is not None
                else "not given -- assumed to be this floor level"))
        street_axis = None
        if wiz.axis_mode in ("pick", "2pt") and wiz.axis_curve_pts \
                and len(wiz.axis_curve_pts) >= 2:
            # KEEP THE LINE, NOT JUST ITS ANGLE.
            # Only the direction used to survive this step, so nothing
            # downstream knew which SIDE of the site the plane was on and
            # the elevation could be drawn against the far boundary. The
            # position is what decides that, and it is free here.
            global _PLANE_X_LINE
            _PLANE_X_LINE = list(wiz.axis_curve_pts)
            a, b = wiz.axis_curve_pts[0], wiz.axis_curve_pts[-1]
            try:
                street_axis = XYZ(b.X - a.X, b.Y - a.Y, 0).Normalize()
            except Exception:
                street_axis = None
        tallest_m = wiz.height_m
        zones_wanted = wiz.zones
        pe_loops = list(wiz.pe_loops or [])
        _wiz_streets = list(wiz.streets or [])
        if not site_pts or not building_loops:
            TaskDialog.Show("Case2", "Setup window returned no site or "
                                      "buildings.")
            return
        debug_print("  [Case2] Setup window: {} building(s), {} gap group(s), "
                     "{} street(s), zones {}.".format(
                         len(building_loops), len(_gap_groups or []),
                         len(_wiz_streets), ", ".join(zones_wanted)))
        # per-building heights typed in the panel
        building_heights_m = wiz.heights_list()
        if building_heights_m:
            debug_print("  [Case2] Heights from the setup window: {}".format(
                ", ".join("{:.1f}".format(h) for h in building_heights_m)))
        elif wiz.per_building_heights:
            building_heights_m = _ask_building_heights_m(
                building_loops, tallest_m, doc=doc, view=view, elev=elev)
    else:
        # ---- original prompt chain ----
        _wiz_streets = []
        zones_wanted = None
        pe_loops = None
        site_pts = _pick_site_boundary()
        if not site_pts:
            return
        building_loops = _pick_building_loops()
        try:
            _use = TaskDialog.Show(
                "Case2 - Define Air Gaps",
                "Define the air gaps explicitly by selecting the building "
                "group on each side?\n\n"
                "Yes = pick groups (recommended, most accurate)\n"
                "No  = automatic gap detection",
                TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No)
            if _use == TaskDialogResult.Yes:
                _gap_groups = _pick_building_groups()
        except Exception as _ge:
            debug_print("  [Case2] Gap group selection skipped: {}".format(_ge))
        if not building_loops:
            return
        street_axis = _pick_axis1_source(site_pts)
        if street_axis is AXIS1_CANCEL:
            debug_print("  [Case2] Cancelled by user.")
            return
        _ask_level_zero(elev)
        tallest_m = _ask_height_m(20.0)
        debug_print("  [Case2] Tallest building height: {:.1f} m".format(tallest_m))
        building_heights_m = _ask_building_heights_m(
            building_loops, tallest_m, doc=doc, view=view, elev=elev)

    if building_heights_m:
        tallest_m = max(tallest_m, max(building_heights_m))
        debug_print("  [Case2] Building heights (m): {}".format(
            ", ".join("{:.1f}".format(h) for h in building_heights_m)))
        debug_print("  [Case2] H (tallest, drives the elevation): "
                    "{:.1f} m".format(tallest_m))

    # Notional air-corridor prompt REMOVED — corridors are now detected
    # automatically by the articulated wind-corridor engine (see the
    # compute_wind_corridors pass below). These stay defined as the
    # "no manual corridor" state so downstream calls are unchanged.
    corridor_poly = None
    corridor_filtered_count = 0

    # Preliminary frame for the street-centreline pick. _resolve_axes runs
    # after this (it consumes the extensions), so use the projection plane
    # the user already chose; falling back to the site's dominant axis.
    _pre_u = street_axis if street_axis is not None else compute_dominant_axis(site_pts)
    try:
        _pre_u = _pre_u.Normalize()
        _pre_v = orthogonal_axis(_pre_u)
    except Exception:
        _pre_u = _pre_v = None
    if wiz is not None:
        # Streets came from the wizard: build each centreline from the two
        # boundaries it captured, using Case 1's builder.
        street_cl_extensions = None
        # Keep the raw picks. The side a street falls on ("left"/"right") is
        # a property of the FRAME, not of the street, so an L-shaped street
        # resolves differently for Plane X than for Plane Y. Storing only the
        # X-frame answer meant the Y side regions extended toward whichever
        # leg happened to be "right" in X -- or toward none at all.
        global _RAW_STREETS
        _RAW_STREETS = list(_wiz_streets or [])
        if _wiz_streets and _pre_u is not None:
            _ext = {"left": 0.0, "right": 0.0}
            for _i, _s in enumerate(_wiz_streets):
                try:
                    _res = street_centreline_from_points(
                        _s.get("subject_pts"), _s.get("opposite_pts"),
                        _pre_u, _pre_v, site_pts)
                except Exception as _serr:
                    debug_print("  [Case2] Street {} centreline failed: "
                                 "{}".format(_i + 1, _serr))
                    _res = None
                if not _res:
                    continue
                _sd = _res["side"]
                _ext[_sd] = max(_ext[_sd], _res["extension_ft"])
                if _res.get("centreline_pts"):
                    _STREET_CENTRELINES.append(_res["centreline_pts"])
                    _ext[_sd + "_cl"] = _res["centreline_pts"]
                debug_print("  [Case2] Street {}: on the {}; extension "
                             "{:.2f} m.".format(_i + 1, _sd,
                                                _res["extension_m"]))
            if _ext.get("left") or _ext.get("right"):
                street_cl_extensions = _ext
    else:
        street_cl_extensions = _ask_street_cl_extensions(site_pts, _pre_u, _pre_v)
        pe_loops = _pick_pe_loops_optional()
        zones_wanted = _ask_zones()

    axis1, axis2, plane_y_deg = _resolve_axes(
        site_pts, building_loops, street_axis, street_cl_extensions)
    lp_m = _max_lp_across_buildings(building_loops)
    site_area_m2 = polygon_area_2d(site_pts) * FEET_TO_METERS * FEET_TO_METERS
    req_p = get_required_p(site_area_m2, lp_m)
    try:
        _lp_proj = _projected_lp_m(building_loops, axis1)
        _req_proj = get_required_p(site_area_m2, _lp_proj)
        debug_print("  [Case2] Lp check: used {:.2f} m (shorter side of one building) -> required P {}; "
                    "all buildings projected on Axis 1 = {:.2f} m -> {}. Confirm which APP-152 means.".format(
                        lp_m, "none" if req_p is None else "%.0f%%" % req_p,
                        _lp_proj, "none" if _req_proj is None else "%.0f%%" % _req_proj))
    except Exception as _lp_err:
        debug_print("  [Case2] Lp check skipped: {}".format(_lp_err))

    tg = TransactionGroup(doc, "SBD Case2 Permeability")
    tg.Start()
    try:
        purge_app152_outputs(doc, debug_print)

        assessment = run_full_assessment(
            site_pts, site_pts, building_loops,
            axis_primary=axis1, axis_secondary=axis2,
            street_axis=street_axis,
            street_cl_extensions=street_cl_extensions,
            pe_loops=pe_loops or None,
            req_p=req_p, tallest_m=tallest_m,
            plane_y_angle_deg=plane_y_deg,
            zones=zones_wanted)

        zone_views = {}
        _elev_corridors = []
        _elev_sides = []
        # Bound by the def below, which sits inside "if low_zr and
        # building_loops". The Plane Y block runs at an outer indent level,
        # so it must not assume the def executed.
        _corridor_side_pass = None
        _y_views_early = None      # same reason: bound in that block only
        with Transaction(doc, "SBD Case2 Draw") as t:
            t.Start()
            # Plan corridors / side regions are drawn once, from LOW when it
            # was assessed. If the user asked for MIDDLE or HIGH only, LOW
            # does not exist -- fall back to the first zone that ran, or the
            # plan would come back empty for a perfectly valid run.
            low_zr = None
            for zr in assessment["zone_results"]:
                if zr.get("zone") == "LOW":
                    low_zr = zr
                    break
            if low_zr is None and assessment["zone_results"]:
                low_zr = assessment["zone_results"][0]
                debug_print("  [Case2] LOW not assessed -> drawing the plan "
                             "from zone {}.".format(low_zr.get("zone")))
            if low_zr and building_loops:
                a1 = low_zr.get("axis1", {})
                # When the user has defined the gaps explicitly, DON'T also
                # draw the automatic straight slabs -- they overlapped the
                # corner-driven corridors, giving two fills per gap.
                if _gap_groups:
                    debug_print("  [Case2] Explicit gaps defined -> skipping "
                                 "automatic straight corridor fills (avoids "
                                 "duplicate overlapping regions).")
                else:
                    draw_corridor_fills_on_view(
                        doc, view, elev, site_pts, building_loops,
                        a1.get("axis"),
                        a1.get("all_gap_results", a1.get("gaps", [])))

                # --- ARTICULATED (<=15 deg bend-and-return) WIND CORRIDORS ---
                # PASS FUNCTION. The corridor + side-region solve is frame
                # dependent: it takes a plane direction and returns the
                # corridors and side regions measured against THAT plane.
                # It used to be inline and hard-wired to axis1, so Plane Y
                # got an elevation and a P number but no plan graphics at
                # all. Wrapping it lets the same solve run a second time in
                # the Plane Y frame and draw into the _Y views.
                def _corridor_side_pass(pass_axis_u, target_view, tag,
                                        plane_key="axis1", groups=None,
                                        zones=None):
                    """Solve and draw corridors + side regions for ONE plane.

                    Frame-dependent: everything below is measured against
                    pass_axis_u, so calling it again with Plane Y produces
                    that plane's own corridors and side regions rather than
                    re-drawing the Plane X ones at a different angle.

                    Returns (centre_corridors, side_results, n_drawn).
                    """
                    axis_u = pass_axis_u
                    axis_v = XYZ(-axis_u.Y, axis_u.X, 0).Normalize()
                    debug_print(
                        "  [{}] Corridor frame: plane=({:.3f},{:.3f}) "
                        "perp=({:.3f},{:.3f}) dot={:.4f} (must be ~0)".format(
                            tag, axis_u.X, axis_u.Y, axis_v.X, axis_v.Y,
                            axis_u.X * axis_v.X + axis_u.Y * axis_v.Y))
                    # EXPLICIT GAP METHOD (preferred): the user has defined
                    # each gap by selecting the two building groups either
                    # side of it. Falls back to automatic detection when no
                    # groups were given.
                    centre_corridors = []
                    _grp = groups if groups is not None else _gap_groups
                    if _grp:
                        centre_corridors = corridors_for_group_chain(
                            _grp, site_pts, axis_u, axis_v, elev,
                            building_loops=building_loops)
                        debug_print(
                            "  [{}] Explicit gap method: {} group(s) "
                            "-> {} gap(s) assessed.".format(
                                tag, len(_grp), len(centre_corridors)))
                    # THE GROUPS ARE PLANE-SPECIFIC.
                    # The wizard's groups pair the buildings either side of a
                    # gap AS SEEN FROM PLANE X. Rotate the frame ~90 deg for
                    # Plane Y and that pairing no longer describes a gap at
                    # all: the same two groups sit end-to-end rather than
                    # side-by-side, and the band collapses (0.55 m on the
                    # reference run, so the centre corridor vanished from the
                    # Y plan).
                    #
                    # The old fallback only fired when the group method
                    # returned NOTHING, and a collapsed 0.55 m band is not
                    # nothing. Fall back on a DEGENERATE result too, and keep
                    # whichever method gives the wider corridor.
                    _grp_best = max([c.get("width_m", 0.0)
                                     for c in centre_corridors] or [0.0])
                    if not centre_corridors or _grp_best < MIN_CORRIDOR_M:
                        if centre_corridors:
                            debug_print(
                                "  [{}] Group corridors collapse in this "
                                "frame (widest {:.2f} m < {:.0f} m) -- the "
                                "groups were defined for the other plane. "
                                "Retrying with automatic detection.".format(
                                    tag, _grp_best, MIN_CORRIDOR_M))
                        _auto = []
                        try:
                            _auto = compute_wind_corridors(
                                site_pts, building_loops, axis_u, axis_v,
                                elev=elev) or []
                        except Exception as _aerr:
                            debug_print("  [{}] Automatic corridor detection "
                                         "failed: {}".format(tag, _aerr))
                        _auto_best = max([c.get("width_m", 0.0)
                                          for c in _auto] or [0.0])
                        if _auto and _auto_best > _grp_best:
                            debug_print(
                                "  [{}] Automatic detection found {} "
                                "corridor(s), widest {:.2f} m -- using "
                                "those.".format(tag, len(_auto), _auto_best))
                            centre_corridors = _auto
                        elif not centre_corridors:
                            centre_corridors = _auto
                    qualifying = [c for c in centre_corridors
                                  if c.get("qualifies")]
                    debug_print(
                        "  [{}] Articulated corridors: {} found, "
                        "{} qualify (>= 15 m).".format(
                            tag, len(centre_corridors), len(qualifying)))
                    for _ci, _c in enumerate(centre_corridors):
                        debug_print(
                            "      corridor {}: width={:.1f} m, "
                            "angle={:.1f} deg, qualifies={}".format(
                                _ci + 1, _c.get("width_m", 0),
                                _c.get("angle_deg", 0),
                                _c.get("qualifies")))
                    # Re-resolve the streets IN THIS FRAME (see
                    # street_extensions_for_axis). Falls back to the run-wide
                    # dict when no raw picks were kept, e.g. the prompt-chain
                    # path where the user typed an extension instead.
                    _ext_here = street_extensions_for_axis(
                        _RAW_STREETS, axis_u, axis_v, site_pts,
                        tag=tag, debug=debug_print) or street_cl_extensions
                    side_results = compute_side_averages(
                        site_pts, building_loops, axis_u, axis_v, elev,
                        street_cl_extensions=_ext_here,
                        # Corridors are solved first on purpose: where one
                        # reaches the site boundary it opens a mouth, and the
                        # side region's street extension has to stop there
                        # rather than run across the corridor's frontage.
                        corridor_polygons=centre_corridors)
                    debug_print(
                        "  [{}] Side regions: {} computed "
                        "(Area/D averages).".format(tag, len(side_results)))
                    for _si, _s in enumerate(side_results):
                        if not _s:
                            continue
                        debug_print(
                            "      side {} ({}): area={:.1f} m2, "
                            "D={:.1f} m, avg={:.2f} m, rotation={:+.1f} "
                            "deg".format(
                                _si + 1, _s.get("side", "?"),
                                _s.get("area_m2", 0), _s.get("D_m", 0),
                                _s.get("avg_width_m", 0),
                                _s.get("angle_deg", 0)))
                    n_drawn = draw_corridors_and_sides(
                        doc, target_view, elev,
                        centre_corridors=centre_corridors,
                        side_results=side_results)
                    # One source of truth: push the plan values into the
                    # zone results so the bar, the audit text and the
                    # summary all agree with what was drawn -- for whichever
                    # plane this pass ran on.
                    _us = [p.X * axis_u.X + p.Y * axis_u.Y
                           for p in (site_pts or [])]
                    _fs_lo = min(_us) if _us else None
                    _fs_hi = max(_us) if _us else None
                    _apply_plan_results_to_zones(
                        assessment, centre_corridors, side_results,
                        debug_print, plane_key=plane_key,
                        frame_site_lo=_fs_lo, frame_site_hi=_fs_hi,
                        zones=zones)
                    debug_print(
                        "  [{}] Drew {} corridor/side hatch(es) with "
                        "calculations.".format(tag, n_drawn))
                    return centre_corridors, side_results, n_drawn

                # TAKE THE PLANE Y VIEWS FROM THE CLEAN PLAN, BEFORE PLANE X
                # DRAWS ANYTHING INTO IT.
                # They were duplicated further down, AFTER the X pass had
                # already drawn its corridors, side regions and elevation
                # into `view` -- so every _Y view opened carrying Plane X's
                # graphics as well as its own. The rotation stamps give it
                # away: the Y view showed SIDE AREA at -4.4 and -15.0 deg
                # (X's) beside -7.1 and -4.2 (Y's), and two DEFORMED
                # ELEVATION strips on top of each other. That is why the Y
                # side areas and the Y group/building widths read wrong --
                # half the numbers on the sheet belonged to Plane X.
                _y_views_early = None
                try:
                    _y_views_early = duplicate_zone_views(
                        doc, view, suffix="_Y")
                    debug_print("  [Case2] Plane Y views duplicated from the "
                                 "clean plan ({} view(s)).".format(
                                     len(_y_views_early or {})))
                except Exception as _yv:
                    debug_print("  [Case2] Could not pre-duplicate the Plane "
                                 "Y views: {}".format(_yv))

                if _WIND_OK and building_loops:
                    try:
                        # PLANE X uses the USER'S projection plane, not the
                        # optimiser's swept axis. Two bugs came from that:
                        #  (1) the swept axis is rotated up to 15 deg, so
                        #      corridor edges were 15 deg off the plane the
                        #      architect selected;
                        #  (2) axis2 is perpendicular to the UNROTATED axis1,
                        #      so pairing it with the swept axis gave a
                        #      75-degree (skewed) frame -- every uv->world
                        #      conversion landed in the wrong place.
                        _cc, _sr, _n = _corridor_side_pass(
                            axis1, view, "Case2 X", plane_key="axis1")
                        _elev_corridors = list(_cc or [])
                        _elev_sides = list(_sr or [])
                    except Exception as _wc_err:
                        debug_print("  [Case2] Articulated corridor pass "
                                     "failed: {}".format(_wc_err))

            # ---- draw the derived STREET CENTRELINE(S) for checking ----
            # These are what the S1 extension is measured to. Drawing them
            # is the only way to confirm the derivation is right; the old
            # typed-width version produced a number with nothing to check.
            if _STREET_CENTRELINES:
                for _ci, _cl in enumerate(_STREET_CENTRELINES):
                    if not _cl or len(_cl) < 2:
                        continue
                    try:
                        create_colored_polyline(
                            view, _cl, Color(255, 0, 255), 5, elev,
                            "SBD_Audit_StreetCL")
                        debug_print("  [Case2] Street centreline {} drawn "
                                     "({} pts) - magenta, check against the "
                                     "actual street.".format(_ci + 1, len(_cl)))
                    except Exception as _clerr:
                        debug_print("  [Case2] Could not draw street "
                                     "centreline {}: {}".format(_ci + 1, _clerr))

            zone_views = duplicate_zone_views(doc, view)
            for zr in assessment["zone_results"]:
                v = zone_views.get(zr["zone"])
                if v:
                    render_zone_deliverables(
                        doc, v, elev, zr, site_pts, req_p,
                        building_loops=building_loops,
                        corridor_poly=corridor_poly,
                        corridor_filtered_count=corridor_filtered_count,
                        draw_corridor_fills=False,
                        building_heights_m=zone_heights_m(
                            building_heights_m, zr.get("zone"),
                            _height_mode, _base_level_m, tallest_m,
                            debug_print),
                        h_max_m=tallest_m,
                        base_level_m=_base_level_m,
                        # The elevation must describe WHAT WAS DRAWN ON PLAN.
                        # It used to be built from the automatic assessment's
                        # all_gap_results while the plan showed the explicit
                        # group corridors, so the two disagreed (11.45 m in
                        # the elevation vs 14.65 m on the plan).
                        gap_groups=_gap_groups,
                        centre_corridors=_elev_corridors,
                        side_results=_elev_sides,
                        # axis1 is the frame the corridors were solved in.
                        elev_axis_u=axis1,
                        plane_key="axis1", plane_label="Plane X",
                        plane_line_pts=_PLANE_X_LINE or None,
                        plane_ref_axis=axis1)



            # ---- PLANE Y on its OWN views (APP152_*_Y) ----------------
            # Drawing Plane Y into the Plane X view put two elevations and
            # two stepped bars on top of each other. Separate views keep
            # each plane readable, and Y is often the controlling plane.
            try:
                # Reuse the copies taken before Plane X drew (see above).
                y_views = _y_views_early
                if not y_views:
                    y_views = duplicate_zone_views(doc, view, suffix="_Y")
                # PLAN GRAPHICS FOR PLANE Y.
                # The _Y views used to receive only the elevation, the bar
                # and the stamp: the corridors and side regions were solved
                # once, in the Plane X frame, and drawn on the working view.
                # So Plane Y had a P number with no plan to check it against
                # -- and since Y is often the CONTROLLING plane, that is the
                # plane the checker most needs to see.
                #
                # Each zone carries its own Y direction (Y is optimised per
                # zone, e.g. LOW at 95 deg while HIGH lands at 99), so the
                # solve runs per zone in that zone's own Y frame. Results are
                # cached by angle because side_average_width is the expensive
                # part and zones frequently share a Y angle.
                _y_cache = {}
                for zr in assessment["zone_results"]:
                    vy = y_views.get(zr["zone"])
                    if not (vy and zr.get("axis2")):
                        continue
                    _zone_axis_y = (zr["axis2"].get("axis")
                                    or zr.get("axis_secondary") or axis2)
                    _y_cc, _y_sr = [], []
                    if _WIND_OK and building_loops and _corridor_side_pass:
                        _key = (round(_zone_axis_y.X, 4),
                                round(_zone_axis_y.Y, 4))
                        try:
                            if _key in _y_cache:
                                _y_cc, _y_sr = _y_cache[_key]
                                # Same frame, different view: the solve is
                                # reused but the graphics still have to be
                                # drawn into THIS zone's view.
                                draw_corridors_and_sides(
                                    doc, vy, elev,
                                    centre_corridors=_y_cc,
                                    side_results=_y_sr)
                                # SAME FRAME EXTENTS AS THE UNCACHED PATH.
                                # This branch used to omit frame_site_lo/hi,
                                # so a zone served from the cache kept the
                                # swept W from its own optimiser run while
                                # its IS came from the measured Y frame --
                                # the exact IS-over-mismatched-W defect the
                                # frame arguments were added to fix. P is
                                # IS/W and controlling_p is min(P), so a
                                # cached zone could become the controlling
                                # one purely by not having been solved
                                # first.
                                _us_y = [p.X * _zone_axis_y.X +
                                         p.Y * _zone_axis_y.Y
                                         for p in (site_pts or [])]
                                _apply_plan_results_to_zones(
                                    assessment, _y_cc, _y_sr, debug_print,
                                    plane_key="axis2",
                                    frame_site_lo=(min(_us_y) if _us_y
                                                   else None),
                                    frame_site_hi=(max(_us_y) if _us_y
                                                   else None),
                                    zones=[zr.get("zone")])
                            else:
                                # Plane Y uses ITS OWN groups when the user
                                # supplied them in the setup window. Falling
                                # back to the X pairing is what collapsed the
                                # Y corridor to 0.55 m.
                                if _gap_groups_y:
                                    debug_print(
                                        "  [Case2 Y/{}] Using the Plane Y "
                                        "groups from the setup window ({} "
                                        "group(s)).".format(
                                            zr.get("zone"),
                                            len(_gap_groups_y)))
                                # zones=[this zone] -- Plane Y is optimised
                                # per zone, so its numbers must not be
                                # written into the other zones' axis2.
                                _y_cc, _y_sr, _ = _corridor_side_pass(
                                    _zone_axis_y, vy,
                                    "Case2 Y/{}".format(zr.get("zone")),
                                    plane_key="axis2",
                                    groups=_gap_groups_y,
                                    zones=[zr.get("zone")])
                                _y_cache[_key] = (_y_cc, _y_sr)
                        except Exception as _ycerr:
                            debug_print("  [Case2] Plane Y corridor pass "
                                         "failed for {}: {}".format(
                                             zr.get("zone"), _ycerr))
                        # The street centreline is what the S1 extension is
                        # measured to, so it has to appear on the Y plan too
                        # or the extension there cannot be checked.
                        for _cl in _STREET_CENTRELINES or []:
                            if not _cl or len(_cl) < 2:
                                continue
                            try:
                                create_colored_polyline(
                                    vy, _cl, Color(255, 0, 255), 5, elev,
                                    "SBD_Audit_StreetCL")
                            except Exception:
                                pass
                    render_zone_deliverables(
                        doc, vy, elev, zr, site_pts, req_p,
                        building_loops=building_loops,
                        draw_corridor_fills=False,
                        building_heights_m=zone_heights_m(
                            building_heights_m, zr.get("zone"),
                            _height_mode, _base_level_m, tallest_m,
                            debug_print),
                        h_max_m=tallest_m,
                        base_level_m=_base_level_m,
                        # THE Y ELEVATION NEEDS THE Y GROUPS.
                        # The corridor pass above was already using them, but
                        # this call still handed over the X pairing, so the Y
                        # elevation split the buildings 3+3 while the corridor
                        # had correctly solved 4+2.
                        gap_groups=(_gap_groups_y or _gap_groups),
                        # Feed the Y elevation the Y PLAN results, exactly as
                        # the X view does. Without these it fell back to the
                        # automatic straight-slab gaps, so the Y elevation
                        # described geometry that was not the one drawn.
                        centre_corridors=_y_cc,
                        side_results=_y_sr,
                        elev_axis_u=_zone_axis_y,
                        plane_key="axis2", plane_label="Plane Y",
                        # plane_ref_axis stays axis1: it is the frame the
                        # line was picked in, and the drawing turns the line
                        # by the axis1 -> axis2 angle itself.
                        plane_line_pts=_PLANE_X_LINE or None,
                        plane_ref_axis=axis1)
                    debug_print(
                        "  [Case2] Plane Y graphics -> {}_Y ({} corridor(s), "
                        "{} side region(s) on plan)".format(
                            zr.get("zone"), len(_y_cc or []),
                            len(_y_sr or [])))
            except Exception as _yerr:
                debug_print("  [Case2] Plane Y view pass failed: {}"
                             .format(_yerr))

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
            "Plane Y = {:.0f} deg from Plane X\n\n"
            "Corridor fills: {} (current view)\n"
            "Audit graphics: APP152_LOW / APP152_MID / APP152_HIGH".format(
                assessment["controlling_p"], plane_y_deg, active_view_name))
    except Exception as ex:
        debug_print("  [Case2] ERROR: {}".format(ex))
        tg.RollBack()
        TaskDialog.Show("Case2 Error", str(ex))


if __name__ == "__main__":
    run()
