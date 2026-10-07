# -*- coding: utf-8 -*-
"""Builds the export manifest: the contract between Revit and the viewer."""

# Printed by the auto-export buttons, so a stale copy is obvious.
__version__ = "2026-09-30j"

import datetime

from Autodesk.Revit.DB import (
    FilteredElementCollector, BuiltInCategory, BuiltInParameter,
    ViewSheet, Viewport, ViewPlan, CategoryType, XYZ, Curve
)

from lwk_viewer import geom
from lwk_viewer.probe import Probe

FT_MM = 304.8

SCHEMA = "lwk.viewer.export/1"


def _param_mm(el, bip):
    p = el.get_Parameter(bip)
    if p is None:
        return None
    return geom.ft_mm(p.AsDouble())


def paper_origin(doc, sheet, probe):
    """Lower-left corner of the titleblock, in Revit sheet feet.

    This, not the sheet origin, is what corresponds to the corner of the
    exported PDF page.
    """
    tbs = list(FilteredElementCollector(doc, sheet.Id)
               .OfCategory(BuiltInCategory.OST_TitleBlocks)
               .WhereElementIsNotElementType())
    if not tbs:
        probe.warn(sheet.SheetNumber, "no titleblock; falling back to sheet origin")
        return XYZ(0, 0, 0), None

    if len(tbs) > 1:
        probe.warn(sheet.SheetNumber, "%d titleblocks, using the largest" % len(tbs))

    best, best_area = None, -1.0
    for tb in tbs:
        bb = tb.get_BoundingBox(sheet)
        if bb is None:
            continue
        area = (bb.Max.X - bb.Min.X) * (bb.Max.Y - bb.Min.Y)
        if area > best_area:
            best, best_area = (tb, bb), area

    if best is None:
        probe.warn(sheet.SheetNumber, "titleblock has no bounding box on sheet")
        return XYZ(0, 0, 0), None

    tb, bb = best
    size = {
        "width_mm": _param_mm(tb, BuiltInParameter.SHEET_WIDTH),
        "height_mm": _param_mm(tb, BuiltInParameter.SHEET_HEIGHT),
        "bbox_width_mm": geom.ft_mm(bb.Max.X - bb.Min.X),
        "bbox_height_mm": geom.ft_mm(bb.Max.Y - bb.Min.Y),
    }
    return XYZ(bb.Min.X, bb.Min.Y, 0.0), size


def view_range_mm(view):
    """Plan view range, so the viewer can tie a 2D sheet to a 3D slice."""
    if not isinstance(view, ViewPlan):
        return None
    try:
        from Autodesk.Revit.DB import PlanViewPlane
        doc = view.Document
        vr = view.GetViewRange()

        def plane(p):
            lvl_id = vr.GetLevelId(p)
            offset = vr.GetOffset(p)
            lvl = doc.GetElement(lvl_id)
            base = lvl.ProjectElevation if lvl is not None else 0.0
            return geom.ft_mm(base + offset)

        return {
            "top_mm": plane(PlanViewPlane.TopClipPlane),
            "cut_mm": plane(PlanViewPlane.CutPlane),
            "bottom_mm": plane(PlanViewPlane.BottomClipPlane),
            "view_depth_mm": plane(PlanViewPlane.ViewDepthPlane),
        }
    except Exception:
        return None


def calibration(doc, view, mapping, rect_mm, limit=8):
    """Grid endpoints projected onto the page.

    These exist so the sign conventions can be checked against the PDF by
    eye, and so a regression harness has something to assert on. If these
    land in the wrong place, the viewport mapping is wrong and nothing
    downstream will save it.
    """
    pts = []
    corners = [(rect_mm[0], rect_mm[1]),
               (rect_mm[0] + rect_mm[2], rect_mm[1]),
               (rect_mm[0], rect_mm[1] + rect_mm[3]),
               (rect_mm[0] + rect_mm[2], rect_mm[1] + rect_mm[3])]
    for i, uv in enumerate(corners):
        o, ex, ey = mapping["origin"], mapping["x_axis"], mapping["y_axis"]
        model = [o[j] + uv[0] * ex[j] + uv[1] * ey[j] for j in range(3)]
        pts.append({"label": "crop_corner_%d" % i,
                    "paper_mm": [uv[0], uv[1]],
                    "model_mm": model})

    try:
        grids = FilteredElementCollector(doc, view.Id) \
            .OfCategory(BuiltInCategory.OST_Grids) \
            .WhereElementIsNotElementType()
        for g in grids:
            if len(pts) >= 4 + limit:
                break
            crv = g.Curve
            if crv is None:
                continue
            for end in (0, 1):
                p = crv.GetEndPoint(end)
                pmm = geom.xyz_mm(p)
                uv = geom.model_to_paper(mapping, pmm)
                if geom.inside(rect_mm, uv, pad=2.0):
                    pts.append({"label": "grid_%s_end%d" % (g.Name, end),
                                "paper_mm": uv,
                                "model_mm": pmm})
                    break
    except Exception:
        pass
    return pts


# View types whose CropBox and ViewDirection actually describe a slice of
# the model. Everything else on a sheet -- legends, schedules, drafting
# views, renderings -- is paper-only: it has a CropBox property, but the
# numbers in it mean nothing in model space, so computing a transform from
# it produces a plausible-looking mapping that is pure noise.
MAPPABLE_VIEW_TYPES = set([
    "FloorPlan", "CeilingPlan", "AreaPlan", "EngineeringPlan",
    "Section", "Elevation", "Detail",
])


def unmappable_reason(view):
    """None if this view can carry a paper_to_model transform, else why not."""
    vt = str(view.ViewType)

    if vt == "ThreeD":
        try:
            if view.IsPerspective:
                return "perspective 3D view (no linear paper mapping exists)"
        except Exception:
            pass
        # Orthographic 3D on a sheet is mappable in principle, but its
        # CropBox convention differs from plans. Left out until tested.
        return "orthographic 3D view (mapping not implemented yet)"

    if vt not in MAPPABLE_VIEW_TYPES:
        return "%s is a paper-only view type" % vt

    if not view.CropBoxActive:
        return ("crop region is not active, so CropBox does not describe "
                "what is shown on the sheet")

    try:
        if int(view.Scale) <= 0:
            return "view scale is not a usable number"
    except Exception:
        return "view has no scale"

    return None


def _param_text(el, bip_name):
    from Autodesk.Revit.DB import BuiltInParameter
    bip = getattr(BuiltInParameter, bip_name, None)
    if bip is None or el is None:
        return ""
    try:
        p = el.get_Parameter(bip)
        return (p.AsString() or p.AsValueString() or "").strip() if p is not None else ""
    except Exception:
        return ""


def _paper_box(view, el, mapping, rect, pad=0.0):
    """Where an element sits on the sheet, as [u0, v0, u1, v1] paper mm,
    clipped to the viewport (grown by pad mm); None if it is not in the
    view or off it."""
    try:
        bb = el.get_BoundingBox(view)
    except Exception:
        bb = None
    if bb is None:
        return None
    us, vs = [], []
    for x in (bb.Min.X, bb.Max.X):
        for y in (bb.Min.Y, bb.Max.Y):
            for z in (bb.Min.Z, bb.Max.Z):
                uv = geom.model_to_paper(mapping, [x * 304.8, y * 304.8, z * 304.8])
                us.append(uv[0]); vs.append(uv[1])
    x, y, w, h = rect
    x, y, w, h = x - pad, y - pad, w + 2 * pad, h + 2 * pad
    u0, u1 = max(min(us), x), min(max(us), x + w)
    v0, v1 = max(min(vs), y), min(max(vs), y + h)
    if u1 < u0 or v1 < v0:
        return None
    return [round(u0, 2), round(v0, 2), round(u1, 2), round(v1, 2)]


def view_links(doc, view, mapping, rect):
    """Drawing references shown in a view - section marks, callouts,
    elevation markers - with the sheet each one points to, for the viewer to
    turn into links (as ACC and Dalux do). Revit already knows every one of
    these relationships: the sheet and detail number printed in the mark."""
    from Autodesk.Revit.DB import BuiltInCategory, ElementId
    out = []
    try:
        col = FilteredElementCollector(doc, view.Id).OfCategory(BuiltInCategory.OST_Viewers) \
            .WhereElementIsNotElementType()
        for el in col:
            num = _param_text(el, "VIEWER_SHEET_NUMBER")
            if not num or num.strip("-") == "":
                continue                      # not placed on any sheet
            box = _paper_box(view, el, mapping, rect)
            if box is None:
                continue
            out.append({"kind": "mark", "sheet": num,
                        "detail": _param_text(el, "VIEWER_DETAIL_NUMBER"),
                        "view_name": el.Name, "box_mm": box})
    except Exception:
        pass
    try:
        from Autodesk.Revit.DB import ElevationMarker
        for m in FilteredElementCollector(doc, view.Id).OfClass(ElevationMarker):
            box = _paper_box(view, m, mapping, rect)
            if box is None:
                continue
            for i in range(m.MaximumViewCount):
                vid = m.GetViewId(i)
                if vid is None or vid == ElementId.InvalidElementId:
                    continue
                v = doc.GetElement(vid)
                num = _param_text(v, "VIEWPORT_SHEET_NUMBER")
                if not num or num.strip("-") == "":
                    continue
                out.append({"kind": "elevation", "sheet": num,
                            "detail": _param_text(v, "VIEWPORT_DETAIL_NUMBER"),
                            "view_name": v.Name, "box_mm": box})
    except Exception:
        pass
    return out


def _uv(mapping, p):
    uv = geom.model_to_paper(mapping, [p.X * FT_MM, p.Y * FT_MM, p.Z * FT_MM])
    return [round(uv[0], 2), round(uv[1], 2)]


def view_areas(doc, view, mapping, rooms=False, elements=None, rect=None):
    """The areas an area plan shows - or, rooms=True, the rooms a floor plan
    shows - for the viewer to light up when their schedule row is clicked
    (as Revit highlights them): number, name, m2, and each boundary loop as
    paper mm."""
    from Autodesk.Revit.DB import SpatialElementBoundaryOptions
    out = []
    opt = SpatialElementBoundaryOptions()
    # elements: areas of another scheme drawn onto this plan (their own
    # area plan is not on the sheet); rect: the plan's crop on the paper -
    # only those inside it are kept
    col = elements if elements is not None else FilteredElementCollector(doc, view.Id).OfCategory(
        BuiltInCategory.OST_Rooms if rooms else BuiltInCategory.OST_Areas) \
        .WhereElementIsNotElementType()
    for a in col:
        try:
            if a.Area is None or a.Area <= 0:
                continue                      # not placed, or not enclosed
            loops = []
            for loop in a.GetBoundarySegments(opt) or []:
                pts = []
                for seg in loop:
                    c = seg.GetCurve()
                    for p in c.Tessellate():
                        uv = _uv(mapping, p)
                        if not pts or pts[-1] != uv:
                            pts.append(uv)
                if len(pts) > 1 and pts[0] == pts[-1]:
                    pts.pop()
                if len(pts) >= 3:
                    loops.append(pts)
            if not loops:
                continue
            label = None
            try:
                label = _uv(mapping, a.Location.Point)
            except Exception:
                pass
            if rect is not None:
                probe_pt = label or loops[0][0]
                if not geom.inside(rect, probe_pt, pad=2.0):
                    continue
            name = ""
            try:
                name = a.get_Parameter(BuiltInParameter.ROOM_NAME).AsString() or ""
            except Exception:
                pass
            scheme = ""
            try:
                scheme = a.AreaScheme.Name
            except Exception:
                pass
            level = ""
            try:
                level = a.Level.Name if a.Level is not None else ""
            except Exception:
                pass
            scheme_id = None
            try:
                scheme_id = a.AreaScheme.Id.IntegerValue
            except Exception:
                pass
            out.append({
                "uid": a.UniqueId, "id": a.Id.IntegerValue,
                "kind": "room" if rooms else "area",
                "number": a.Number or "", "name": name,
                "area_m2": _area_m2(a),
                "scheme": scheme, "level": level,
                "view_id": view.Id.IntegerValue,
                "loops": loops, "label": label,
                # every parameter with a value, for the viewer's Properties
                "params": _area_params(a),
                # for matching schedule rows only; not written out
                "_keys": _area_keys(a, name, level),
                "_pvals": _area_pvals(a),
                "_scheme_id": scheme_id,
            })
        except Exception:
            continue
    return out


def _cell_norm(t):
    return " ".join((t or "").split()).upper()


def _figure(t):
    """A number or an area figure (12.50, 1,234 m2, 35%) - never a key."""
    import re
    return bool(re.match(r"^[\d.,\s]+(M2|M.|SQM|SQ\.?M|%)?$", t or ""))


def _levels_in(text, levels):
    """The level names that appear in a text as words of their own
    ("1/F" in "TOWER 1 (1/F) - GFA", not in "11/F")."""
    import re
    out = set()
    for lv in levels or ():
        if lv and re.search(r"(?<![A-Z0-9])" + re.escape(lv) + r"(?![A-Z0-9])", text or ""):
            out.add(lv)
    # a range of floors: "(2/F - 12/F)", "2/F TO 12/F" - every floor between
    for m in re.finditer(r"(\d+)\s*/\s*F\s*(?:-|\u2013|TO)\s*(\d+)\s*/\s*F", text or ""):
        lo, hi = sorted((int(m.group(1)), int(m.group(2))))
        for lv in levels or ():
            n = re.match(r"^(\d+)\s*/\s*F$", lv or "")
            if n and lo <= int(n.group(1)) <= hi:
                out.add(lv)
    # a longer name wins over one it contains ("TOWER 1 1/F" over "1/F")
    def inside(l, o):
        return l != o and re.search(r"(?<![A-Z0-9])" + re.escape(l) + r"(?![A-Z0-9])", o) is not None
    return set(l for l in out if not any(inside(l, o) for o in out))


def _area_m2(a):
    """The area in m2 to three decimals as Revit prints it: its own text when
    that is m2 to three places, else rounded half up (0.8575 -> 0.858)."""
    import re
    try:
        p = a.get_Parameter(BuiltInParameter.ROOM_AREA)
        t = (p.AsValueString() or "").strip() if p is not None else ""
        m = re.match(u"^(-?[\\d,]*\\.\\d{3}) ?(m\u00b2|m2)$", t)
        if m:
            return float(m.group(1).replace(",", ""))
    except Exception:
        pass
    return round(a.Area * 0.09290304 + 1e-9, 3)


def _area_params(a, limit=150):
    """[name, value] for each parameter the area has a value for, as Revit
    shows it (units and all) - the viewer lists them when the area is
    clicked."""
    out = []
    try:
        from lwk_viewer import units
        for p in a.Parameters:
            try:
                v = units.value_text(p)
                if v is None or v == "":
                    continue
                out.append([p.Definition.Name, v])
            except Exception:
                continue
    except Exception:
        pass
    out.sort(key=lambda kv: kv[0].lower())
    return out[:limit]


def _area_pvals(a):
    """{parameter id: text as a schedule prints it} for the text, level and
    whole-number parameters - what a schedule row can be matched on
    exactly, column by column, the way Revit itself links row and area."""
    from Autodesk.Revit.DB import StorageType
    out = {}
    try:
        for p in a.Parameters:
            try:
                st = p.StorageType
                if st == StorageType.String:
                    v = p.AsString()
                elif st == StorageType.ElementId or st == StorageType.Integer:
                    v = p.AsValueString()
                else:
                    continue
                if v:
                    out[p.Id.IntegerValue] = _cell_norm(v)
            except Exception:
                continue
    except Exception:
        pass
    return out


def _area_keys(a, name, level):
    """Every short text an area carries (its number, name, level and its
    text parameters - unit no., flat type, usage ...), for finding the
    schedule rows that list it: a row may list a flat as one line (flat,
    balcony, utility platform) without the areas' own numbers."""
    from Autodesk.Revit.DB import StorageType
    keys = set()
    for t in (a.Number, name, level):
        t = _cell_norm(t)
        if t and not _figure(t):
            keys.add(t)
    try:
        for p in a.Parameters:
            try:
                if p.StorageType != StorageType.String:
                    continue
                t = _cell_norm(p.AsString())
                if t and len(t) <= 60 and not _figure(t):
                    keys.add(t)
            except Exception:
                continue
    except Exception:
        pass
    return sorted(keys)


def sheet_schedules(doc, sheet, origin_ft, areas):
    """Area schedules placed on this sheet: each row's cells, which areas
    it lists (matched by number, and name where there is one), and an
    estimate of where the row sits on the paper. The viewer finds the row
    exactly from the printed words; the estimate is the fallback."""
    from Autodesk.Revit.DB import ScheduleSheetInstance, SectionType
    out = []
    if not areas:
        return out
    by_num = {}
    for a in areas:
        by_num.setdefault(_cell_norm(a["number"]), []).append(a)
    for ssi in FilteredElementCollector(doc, sheet.Id).OfClass(ScheduleSheetInstance):
        try:
            if ssi.IsTitleblockRevisionSchedule:
                continue
            sch = doc.GetElement(ssi.ScheduleId)
            if sch is None:
                continue
            try:
                cat = sch.Definition.CategoryId.IntegerValue
            except Exception:
                cat = None
            if cat == int(BuiltInCategory.OST_Areas):
                kind = "area"
            elif cat == int(BuiltInCategory.OST_Rooms):
                kind = "room"
            else:
                continue
            bb = ssi.get_BoundingBox(sheet)
            if bb is None:
                continue
            x0 = geom.ft_mm(bb.Min.X - origin_ft.X)
            x1 = geom.ft_mm(bb.Max.X - origin_ft.X)
            y0 = geom.ft_mm(bb.Min.Y - origin_ft.Y)
            y1 = geom.ft_mm(bb.Max.Y - origin_ft.Y)
            split = False
            try:
                split = bool(sch.IsSplit())
            except Exception:
                pass
            table = sch.GetTableData()
            # rows go down from the top of the schedule: title (header), then body
            top = y1
            title = [_cell_norm(sch.Name)]
            try:
                head = table.GetSectionData(SectionType.Header)
                for r in range(head.FirstRowNumber, head.LastRowNumber + 1):
                    top -= geom.ft_mm(head.GetRowHeight(r))
                    for c in range(head.FirstColumnNumber, head.LastColumnNumber + 1):
                        try:
                            title.append(_cell_norm(sch.GetCellText(SectionType.Header, r, c)))
                        except Exception:
                            pass
            except Exception:
                pass
            body = table.GetSectionData(SectionType.Body)
            rows = []
            hs = []
            # the column headings, so heading rows are never taken for data
            heads = set()
            col_pid = []                 # the parameter each column shows (None: a formula, a count ...)
            try:
                dfn = sch.Definition
                for i in range(dfn.GetFieldCount()):
                    f = dfn.GetField(i)
                    if not f.IsHidden:
                        heads.add(_cell_norm(f.ColumnHeading))
                        pid = None
                        try:
                            pid = f.ParameterId.IntegerValue
                        except Exception:
                            pid = None
                        col_pid.append(pid)
            except Exception:
                col_pid = []
            # areas of this schedule's scheme only (rooms for a room schedule)
            pool = [a for a in areas if a.get("kind", "area") == kind]
            if not pool:
                continue
            full_pool = pool
            try:
                sid = sch.Definition.AreaSchemeId.IntegerValue
                if sid > 0 and kind == "area":
                    pool = [a for a in pool if a.get("_scheme_id") in (None, sid)]
            except Exception:
                pass
            levels = set(_cell_norm(a.get("level")) for a in pool if a.get("level"))
            # the schedule's own filters ("Level equals 1/F" ...): only those areas
            try:
                dfn = sch.Definition
                for flt in dfn.GetFilters():
                    try:
                        if str(flt.FilterType) != "Equal":
                            continue
                        fpid = dfn.GetField(flt.FieldId).ParameterId.IntegerValue
                        if flt.IsStringValue:
                            want = _cell_norm(flt.GetStringValue())
                        elif flt.IsElementIdValue:
                            e = doc.GetElement(flt.GetElementIdValue())
                            want = _cell_norm(e.Name) if e is not None else ""
                        else:
                            continue
                        if want:
                            kept = [a for a in pool if (a.get("_pvals") or {}).get(fpid, want) == want]
                            if kept:
                                pool = kept
                    except Exception:
                        continue
            except Exception:
                pass
            # a floor named in the schedule's title ("TOWER 1 (1/F) - GFA"):
            # the schedule is of that floor
            in_title = _levels_in(" | ".join(t for t in title if t), levels)
            if in_title:
                on = [a for a in pool if _cell_norm(a.get("level")) in in_title]
                if on:
                    pool = on
            levels = set(_cell_norm(a.get("level")) for a in pool if a.get("level")) or levels
            by_num = {}
            for a in pool:
                by_num.setdefault(_cell_norm(a["number"]), []).append(a)
            context = {}                 # the sub-group heading above (a unit, a zone ...)
            floor_ctx = set()            # the floor a heading above names (Revit puts
                                         # every group level's heading in the first column)
            data_rows, unlinked = 0, []
            body_top = top
            for r in range(body.FirstRowNumber, body.LastRowNumber + 1):
                cells = []
                for c in range(body.FirstColumnNumber, body.LastColumnNumber + 1):
                    try:
                        cells.append(sch.GetCellText(SectionType.Body, r, c) or "")
                    except Exception:
                        cells.append("")
                h = 0.0
                try:
                    h = geom.ft_mm(body.GetRowHeight(r))
                except Exception:
                    pass
                box = None
                if h > 0 and not split:
                    box = [round(x0, 2), round(top - h, 2), round(x1, 2), round(top, 2)]
                top -= h
                if h > 0:
                    hs.append(h)
                normed = [_cell_norm(t) for t in cells]
                filled = [(i, t) for i, t in enumerate(normed) if t]
                if not filled:
                    continue
                # a heading row (the column titles) - part of the title block
                if heads and all(t in heads for _, t in filled):
                    body_top = top
                    continue
                # a group heading (one text across the row): context for the
                # rows under it (3/F, FLAT A ...), never a link itself
                if len(set(t for _, t in filled)) == 1 and not by_num.get(filled[0][1]) \
                        and not _figure(filled[0][1]):
                    txt = filled[0][1]
                    if ":" in txt:
                        txt = txt.split(":", 1)[1].strip() or txt
                    lv = _levels_in(txt, levels)
                    if lv:
                        floor_ctx = lv           # a new floor: its sub-groups start afresh
                        context = {}
                    else:
                        context = {0: txt}
                    continue
                # a footer (a count or a total on its own): not a row of areas
                if all(_figure(t) for _, t in filled):
                    continue
                if filled[0][1].startswith("TOTAL") or filled[0][1].startswith("GRAND TOTAL"):
                    continue
                data_rows += 1
                cellset = set(t for _, t in filled)
                cands = []
                exact = False
                # 1. column by column: every text column of the row must be
                #    the area's own value for that parameter (Number, Name,
                #    Level, unit no. ...) - how Revit ties rows to areas
                checks = []
                if col_pid and len(col_pid) == len(normed):
                    known = set()
                    for a in pool:
                        known.update((a.get("_pvals") or {}).keys())
                    for i, t in filled:
                        pid = col_pid[i]
                        if pid is not None and pid in known:
                            checks.append((pid, t))
                if checks:
                    cands = [a for a in pool
                             if all((a.get("_pvals") or {}).get(pid) == t for pid, t in checks)]
                    exact = bool(cands)
                    if not cands and len(checks) > 1:
                        # all but one column agree (a text formatted differently)
                        def score(a):
                            pv = a.get("_pvals") or {}
                            return sum(1 for pid, t in checks if pv.get(pid) == t)
                        best = max(score(a) for a in pool) if pool else 0
                        if best >= len(checks) - 1 and best >= 1:
                            cands = [a for a in pool if score(a) == best]
                for t in ([] if exact else cellset):
                    for a in by_num.get(t, []):
                        if a not in cands:
                            cands.append(a)
                if not cands:
                    # no column matched: the areas whose texts the row shows
                    words = set(t for t in cellset if not _figure(t))
                    best = 0
                    for a in pool:
                        n = len(words.intersection(a["_keys"]))
                        if n > best:
                            best, cands = n, [a]
                        elif n == best and n > 0:
                            cands.append(a)
                    # a title-like row matching most areas is not a row of them
                    if cands and len(set(a["uid"] for a in cands)) > max(6, 0.4 * len(pool)):
                        cands = []
                # on one floor only, when the row or its heading names the floor
                named = set(t for t in cellset if t in levels) or floor_ctx
                if named and cands:
                    lv = set(named)
                    on_floor = [a for a in cands if _cell_norm(a.get("level")) in lv]
                    if on_floor:
                        cands = on_floor
                # the group heading can narrow it down too (a unit, a zone)
                ctx_texts = set(context.values())
                if ctx_texts and len(cands) > 1:
                    narrowed = [a for a in cands if ctx_texts.intersection(
                        set(a["_keys"]).union((a.get("_pvals") or {}).values()))]
                    if narrowed:
                        cands = narrowed
                uids = []
                for a in cands:
                    if a["uid"] not in uids:
                        uids.append(a["uid"])
                if not uids and pool is not full_pool:
                    # nothing on the floor its title names: try every area of the sheet
                    for a in full_pool:
                        pv = a.get("_pvals") or {}
                        if checks and all(pv.get(pid) == t for pid, t in checks):
                            if a["uid"] not in uids:
                                uids.append(a["uid"])
                if uids:
                    rows.append({"cells": cells, "uids": uids, "box_mm": box,
                                 "i": r - body.FirstRowNumber})
                elif len(unlinked) < 8:
                    unlinked.append(" | ".join(t for t in cells if t))
            hs.sort()
            out.append({
                "name": sch.Name, "id": sch.Id.IntegerValue,
                "rect_mm": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
                "row_h_mm": round(hs[len(hs) // 2], 2) if hs else None,
                "split": split,
                "rows": rows,
                "body_top_mm": round(body_top, 2) if not split else None,
                "title_levels": sorted(in_title),
                "data_rows": data_rows,
                "n_rows": body.LastRowNumber - body.FirstRowNumber + 1,
                "unlinked": unlinked,
            })
        except Exception:
            continue
    return out


def view_mark_boxes(doc, view, mapping, rect):
    """Where every section, callout and elevation mark of a view is on the
    paper - whether or not Revit knows the sheet it points to. The viewer
    turns a sheet number PRINTED by hand in a mark (a mark or comment
    parameter shown in the head) into a link only inside one of these, so a
    grid bubble named like a sheet is left alone."""
    from Autodesk.Revit.DB import ElevationMarker
    out = []
    try:
        for el in FilteredElementCollector(doc, view.Id).OfCategory(BuiltInCategory.OST_Viewers) \
                .WhereElementIsNotElementType():
            b = _paper_box(view, el, mapping, rect, pad=40.0)
            if b is not None:
                out.append(b)
    except Exception:
        pass
    try:
        for m in FilteredElementCollector(doc, view.Id).OfClass(ElevationMarker):
            b = _paper_box(view, m, mapping, rect, pad=40.0)
            if b is not None:
                out.append(b)
    except Exception:
        pass
    return out


def build_sheet(doc, sheet, probe):
    origin_ft, size = paper_origin(doc, sheet, probe)
    rec = {
        "element_id": sheet.Id.IntegerValue,
        "unique_id": sheet.UniqueId,
        "number": sheet.SheetNumber,
        "name": sheet.Name,
        "pdf": None,
        "paper": size or {},
        "paper_origin_source": "titleblock_bbox" if size else "sheet_origin",
        "viewports": [],
    }
    # a room schedule on the sheet: its floor plans' rooms are read too, so
    # its rows light up rooms as an area schedule's light up areas
    want_rooms = False
    try:
        from Autodesk.Revit.DB import ScheduleSheetInstance
        for ssi in FilteredElementCollector(doc, sheet.Id).OfClass(ScheduleSheetInstance):
            sch = doc.GetElement(ssi.ScheduleId)
            if sch is not None and sch.Definition.CategoryId.IntegerValue == int(BuiltInCategory.OST_Rooms):
                want_rooms = True
                break
    except Exception:
        pass

    plan_vps = []                # (view, mapping, rect) of the plans, for other schemes' areas
    for vpid in sheet.GetAllViewports():
        vp = doc.GetElement(vpid)
        view = doc.GetElement(vp.ViewId)
        if view is None:
            continue

        entry = {
            "element_id": vpid.IntegerValue,
            "view_id": view.Id.IntegerValue,
            "view_unique_id": view.UniqueId,
            "view_name": view.Name,
            "view_type": str(view.ViewType),
            "scale": view.Scale,
            "crop_active": bool(view.CropBoxActive),
            "rotation": geom.rotation_name(vp),
            "mappable": False,
            "unmappable_reason": None,
            "paper_rect_mm": None,
            "paper_to_model": None,
            "view_range_mm": None,
            "calibration": [],
            "diagnostics": None,
        }

        reason = unmappable_reason(view)
        spatial = str(view.ViewType) == "AreaPlan" or (want_rooms and str(view.ViewType) == "FloorPlan")
        if reason and spatial:
            # crop off: no 3D mapping, but Revit's own transforms still say
            # where the boundaries are printed
            try:
                ex = geom.exact_mapping(vp, view, origin_ft)
                if ex:
                    if isinstance(view, ViewPlan):
                        plan_vps.append((view, ex[1], None))     # crop off: its crop says nothing
                    if str(view.ViewType) == "AreaPlan":
                        rec.setdefault("areas", []).extend(view_areas(doc, view, ex[1]))
                    if want_rooms:
                        rec.setdefault("areas", []).extend(view_areas(doc, view, ex[1], rooms=True))
            except Exception as ex_:
                probe.info(sheet.SheetNumber, "areas of '%s' not read: %s" % (view.Name, ex_))
        if reason:
            entry["unmappable_reason"] = reason
            probe.info(sheet.SheetNumber,
                       "view '%s' carries no model mapping: %s"
                       % (view.Name, reason))
            rec["viewports"].append(entry)
            continue

        try:
            exact = geom.exact_mapping(vp, view, origin_ft)
            # The old inference is still computed, to report how far off it
            # would have been - evidence that the exact path matters.
            rect_h, diag_h = geom.crop_rect_on_sheet(vp, view, origin_ft)
            if exact:
                rect, mapping, diag = exact
                shift = max(abs(rect[0] - rect_h[0]), abs(rect[1] - rect_h[1]))
                diag["inferred_would_be_off_mm"] = round(shift, 2)
                if shift > 2.0:
                    probe.info(sheet.SheetNumber,
                               "'%s' placed exactly; the old estimate was %.1f mm out"
                               % (view.Name, shift))
            else:
                rect, diag = rect_h, diag_h
                mapping = geom.paper_to_model(vp, view, rect)
        except Exception as ex:
            entry["unmappable_reason"] = "transform failed: %s" % ex
            probe.error(sheet.SheetNumber,
                        "viewport %s failed: %s" % (vpid.IntegerValue, ex))
            rec["viewports"].append(entry)
            continue

        entry["mappable"] = True
        entry["paper_rect_mm"] = list(rect)
        entry["paper_to_model"] = mapping
        entry["view_range_mm"] = view_range_mm(view)
        # the plan's own level: where "stand here" from the sheet puts you
        try:
            if isinstance(view, ViewPlan) and view.GenLevel is not None:
                entry["level_mm"] = round(geom.ft_mm(view.GenLevel.ProjectElevation), 1)
                entry["level_name"] = view.GenLevel.Name
        except Exception:
            pass
        entry["calibration"] = calibration(doc, view, mapping, rect)
        entry["diagnostics"] = diag
        try:
            entry["links"] = view_links(doc, view, mapping, rect)
        except Exception as ex:
            entry["links"] = []
            probe.info(sheet.SheetNumber, "drawing links of '%s' not read: %s" % (view.Name, ex))
        try:
            entry["mark_boxes"] = view_mark_boxes(doc, view, mapping, rect)
        except Exception:
            entry["mark_boxes"] = []
        if isinstance(view, ViewPlan) and str(view.ViewType) in ("AreaPlan", "FloorPlan"):
            plan_vps.append((view, mapping, rect))
        if spatial:
            try:
                if str(view.ViewType) == "AreaPlan":
                    rec.setdefault("areas", []).extend(view_areas(doc, view, mapping))
                if want_rooms:
                    rec.setdefault("areas", []).extend(view_areas(doc, view, mapping, rooms=True))
            except Exception as ex:
                probe.info(sheet.SheetNumber, "areas of '%s' not read: %s" % (view.Name, ex))
        rec["viewports"].append(entry)

    # An area schedule of a scheme with no area plan on this sheet (the
    # concession areas, say, scheduled beside the GFA plan): its areas are
    # drawn onto the sheet's plans of their floor, so its rows still light up.
    try:
        from Autodesk.Revit.DB import ScheduleSheetInstance
        have_schemes = set(a.get("_scheme_id") for a in rec.get("areas") or [] if a.get("kind", "area") == "area")
        wanted = set()
        for ssi in FilteredElementCollector(doc, sheet.Id).OfClass(ScheduleSheetInstance):
            sch = doc.GetElement(ssi.ScheduleId)
            try:
                if sch is None or sch.Definition.CategoryId.IntegerValue != int(BuiltInCategory.OST_Areas):
                    continue
                sid = sch.Definition.AreaSchemeId.IntegerValue
            except Exception:
                continue
            if sid > 0 and sid not in have_schemes:
                wanted.add(sid)
        if wanted and plan_vps:
            all_areas = [a for a in FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Areas)
                         .WhereElementIsNotElementType()]
            added = 0
            for sid in wanted:
                for view, mapping, rect in plan_vps:
                    try:
                        lid = view.GenLevel.Id.IntegerValue
                    except Exception:
                        continue
                    els = []
                    for a in all_areas:
                        try:
                            if a.AreaScheme.Id.IntegerValue == sid and a.LevelId.IntegerValue == lid:
                                els.append(a)
                        except Exception:
                            continue
                    if els:
                        got = view_areas(doc, view, mapping, elements=els, rect=rect)
                        for g in got:
                            g["projected"] = True
                        added += len(got)
                        rec.setdefault("areas", []).extend(got)
            if added:
                probe.info(sheet.SheetNumber, "%d area(s) of a scheme with no plan on this sheet drawn onto its plans "
                                              "of the same floor" % added)
    except Exception as ex:
        probe.info(sheet.SheetNumber, "other schemes' areas not read: %s" % ex)

    if rec.get("areas"):
        try:
            rec["schedules"] = sheet_schedules(doc, sheet, origin_ft, rec["areas"])
        except Exception as ex:
            probe.info(sheet.SheetNumber, "area schedules not read: %s" % ex)
        for a in rec["areas"]:
            a.pop("_keys", None)
            a.pop("_pvals", None)
            a.pop("_scheme_id", None)
        for sc in rec.get("schedules") or []:
            probe.info(sheet.SheetNumber, "schedule '%s'%s: %d of %d row(s) linked to areas%s" % (
                sc.get("name"), (" (floor %s from its title)" % ", ".join(sc["title_levels"])) if sc.get("title_levels") else "",
                len(sc.get("rows") or []), sc.get("data_rows") or 0,
                ("; not linked: " + " / ".join(sc["unlinked"][:4])) if sc.get("unlinked") else ""))
        n_rows = sum(len(s.get("rows") or []) for s in rec.get("schedules") or [])
        probe.info(sheet.SheetNumber, "%d area(s)/room(s) on the plans, %d schedule row(s) linked to them"
                   % (len(rec["areas"]), n_rows))
    n_links = sum(len(v.get("links") or []) for v in rec["viewports"])
    if n_links:
        probe.info(sheet.SheetNumber, "%d drawing reference(s) (sections, callouts, "
                                      "elevations) will be links" % n_links)
    return rec


IFC_CHARS = ("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
             "abcdefghijklmnopqrstuvwxyz_$")


def _guid_to_ifc(g):
    """A .NET Guid as a 22-character IfcGloballyUniqueId.

    System.Guid.ToByteArray() stores the first three fields little-endian,
    so they are reversed back to RFC 4122 order before the 128-bit value is
    re-encoded in base 64 with the IFC alphabet. This produces exactly the
    string Revit's own IFC exporter writes.
    """
    b = list(g.ToByteArray())
    b = b[3::-1] + b[5:3:-1] + b[7:5:-1] + b[8:]

    num = 0
    for byte in b:
        num = num * 256 + (byte & 0xFF)

    out = []
    for _ in range(22):
        out.append(IFC_CHARS[int(num % 64)])
        num //= 64
    out.reverse()
    return "".join(out)


def ifc_guid(doc, el):
    """The IfcGUID this element will carry in the exported IFC.

    ExporterIFCUtils.CreateGUID only works inside an export context, so it
    cannot be used here. ExportUtils.GetExportId is the documented way to
    ask Revit for the identity it uses when exporting, and it works any
    time.
    """
    try:
        from Autodesk.Revit.DB import ExportUtils
        return _guid_to_ifc(ExportUtils.GetExportId(doc, el.Id))
    except Exception:
        return None


def build_elements(doc, probe, categories=None):
    """Revit identity -> IFC identity. BCF references elements by IfcGUID,
    so without this table issues cannot be resolved back to Revit."""
    out = []
    col = FilteredElementCollector(doc) \
        .WhereElementIsNotElementType() \
        .WhereElementIsViewIndependent()

    for el in col:
        cat = el.Category
        if cat is None or cat.CategoryType != CategoryType.Model:
            continue
        if categories and cat.Id.IntegerValue not in categories:
            continue
        try:
            lvl = doc.GetElement(el.LevelId) if el.LevelId is not None else None
        except Exception:
            lvl = None
        out.append({
            "element_id": el.Id.IntegerValue,
            "unique_id": el.UniqueId,
            "ifc_guid": ifc_guid(doc, el),
            "category": cat.Name,
            "level": lvl.Name if lvl is not None else None,
        })

    missing = len([e for e in out if not e["ifc_guid"]])
    if missing:
        probe.warn("elements", "%d of %d elements have no IFC GUID"
                   % (missing, len(out)))
    return out


def project_location(doc, probe):
    """The transform between Revit's internal coordinates and shared ones.

    This model's IFC was exported on shared coordinates, so its numbers are
    Hong Kong grid values. BCF readers place cameras in the project's own
    internal coordinates, and nothing outside Revit knows the difference
    between the two. Recording it here is what lets the viewer convert
    exactly instead of guessing at an offset.

    internal = inverse(this transform) applied to a shared coordinate.
    """
    try:
        t = doc.ActiveProjectLocation.GetTotalTransform()
    except Exception as ex:
        probe.warn("location", "could not read the project location: %s" % ex)
        return None

    o, bx, by, bz = t.Origin, t.BasisX, t.BasisY, t.BasisZ
    rec = {
        "origin_mm": [o.X * FT_MM, o.Y * FT_MM, o.Z * FT_MM],
        "basis_x": [bx.X, bx.Y, bx.Z],
        "basis_y": [by.X, by.Y, by.Z],
        "basis_z": [bz.X, bz.Y, bz.Z],
    }
    try:
        rec["name"] = doc.ActiveProjectLocation.Name
    except Exception:
        pass
    # The site elevation. The IFC exporter adds it to every height when
    # IncludeSiteElevation is on, but GetTotalTransform above carries no
    # vertical shift - so without this, heights converted back from the
    # IFC come out wrong by exactly this amount (33.5 m on STS: choosing
    # 28/F +90.45 cut the model at LMR +123.95).
    try:
        from Autodesk.Revit.DB import XYZ
        pos = doc.ActiveProjectLocation.GetProjectPosition(XYZ(0, 0, 0))
        rec["site_elevation_mm"] = round(pos.Elevation * FT_MM, 1)
        rec["angle_deg"] = round(pos.Angle * 180.0 / 3.141592653589793, 6)
        probe.info("location", "site elevation %+.3f m, true north %.3f deg"
                   % (pos.Elevation * FT_MM / 1000.0, rec["angle_deg"]))
    except Exception as ex:
        probe.warn("location", "could not read the site elevation: %s" % ex)

    # Where the survey point and project base point sit, in both frames.
    # On STS the site elevation was 0 yet heights were 30 m out: the survey
    # point's vertical relation to the internal origin is the next suspect,
    # and Revit states it exactly, so it is recorded rather than guessed.
    try:
        from Autodesk.Revit.DB import BasePoint
        for key, getter in (("survey_point", BasePoint.GetSurveyPoint),
                            ("project_base_point", BasePoint.GetProjectBasePoint)):
            bp = getter(doc)
            p, s = bp.Position, bp.SharedPosition
            rec[key] = {"internal_mm": [round(p.X * FT_MM, 1), round(p.Y * FT_MM, 1), round(p.Z * FT_MM, 1)],
                        "shared_mm": [round(s.X * FT_MM, 1), round(s.Y * FT_MM, 1), round(s.Z * FT_MM, 1)]}
        sp = rec["survey_point"]
        probe.info("location", "survey point: internal Z %+.3f m, shared Z %+.3f m"
                   % (sp["internal_mm"][2] / 1000.0, sp["shared_mm"][2] / 1000.0))
    except Exception as ex:
        probe.warn("location", "could not read the base points: %s" % ex)

    d = max(abs(v) for v in rec["origin_mm"])
    probe.info("location", "project location origin is %.1f m from the "
                           "internal origin" % (d / 1000.0))
    return rec


def scope_diagnostics(doc, probe):
    """Why the export might not contain what you expect.

    An IFC that is too small is almost never a geometry problem. It is
    almost always scope: content that lives in a link, in a workset that is
    not open, or behind a view filter. None of those raise an error, so
    they have to be measured and reported.
    """
    out = {}

    # Linked models. A collector on the host document never sees inside one.
    try:
        from Autodesk.Revit.DB import RevitLinkInstance
        links = []
        for li in (FilteredElementCollector(doc).OfClass(RevitLinkInstance)):
            ld = None
            try:
                ld = li.GetLinkDocument()
            except Exception:
                pass
            links.append({"name": li.Name,
                          "loaded": ld is not None})
        out["links"] = links
        if links:
            probe.warn("scope", "%d linked model(s) present; their elements "
                                "are not in the manifest element table."
                       % len(links))
    except Exception as ex:
        out["links_error"] = str(ex)

    # Closed worksets. Their elements are not even loaded into memory.
    try:
        if doc.IsWorkshared:
            from Autodesk.Revit.DB import FilteredWorksetCollector, WorksetKind
            ws = list(FilteredWorksetCollector(doc)
                      .OfKind(WorksetKind.UserWorkset))
            closed = [w.Name for w in ws if not w.IsOpen]
            out["worksets"] = {"total": len(ws), "closed": closed}
            if closed:
                probe.error("scope",
                            "%d of %d worksets are CLOSED, so their elements "
                            "cannot be exported: %s. Reopen the model with "
                            "all worksets open and export again."
                            % (len(closed), len(ws), ", ".join(closed[:6])))
        else:
            out["worksets"] = {"workshared": False}
    except Exception as ex:
        out["worksets_error"] = str(ex)

    # Design options: only the primary of each set is exported.
    try:
        from Autodesk.Revit.DB import DesignOption
        opts = list(FilteredElementCollector(doc).OfClass(DesignOption))
        if opts:
            out["design_options"] = [
                {"name": o.Name, "primary": o.IsPrimary} for o in opts]
            probe.warn("scope", "%d design option(s); only primaries export."
                       % len(opts))
    except Exception:
        pass

    return out


def category_counts(elements, top=20):
    counts = {}
    for e in elements:
        counts[e["category"]] = counts.get(e["category"], 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])[:top]
    return [{"category": c, "count": n} for c, n in ranked]


def levels(doc, probe):
    """The building's floors, straight from Revit.

    Only levels with "Building Story" ticked are floors; the rest are
    working levels - a copy made to host a view, a reference for a
    parapet - and would clutter a floor list with dozens of near-duplicates.
    Elevations are ProjectElevation: measured from the internal origin,
    the frame the viewer already converts to and from, so no survey or base
    point offset has to be guessed at.
    """
    from Autodesk.Revit.DB import FilteredElementCollector, Level, BuiltInParameter
    out = []
    skipped = 0
    obsolete = 0
    for lv in FilteredElementCollector(doc).OfClass(Level):
        story = True
        try:
            p = lv.get_Parameter(BuiltInParameter.LEVEL_IS_BUILDING_STORY)
            if p is not None:
                story = p.AsInteger() == 1
        except Exception:
            pass
        if not story:
            skipped += 1
            continue
        # levels kept on a workset named "Obsolete ..." are left over, not floors
        try:
            if doc.IsWorkshared:
                wsn = doc.GetWorksetTable().GetWorkset(lv.WorksetId).Name or ""
                if "obsolete" in wsn.lower():
                    obsolete += 1
                    continue
        except Exception:
            pass
        try:
            z = lv.ProjectElevation * FT_MM
        except Exception:
            z = lv.Elevation * FT_MM
        rec = {"name": _element_name(lv) or lv.Name, "id": lv.Id.IntegerValue,
               "elevation_internal_mm": round(z, 1)}
        try:
            rec["elevation_param_mm"] = round(lv.Elevation * FT_MM, 1)
        except Exception:
            pass
        out.append(rec)
    out.sort(key=lambda r: r["elevation_internal_mm"])
    probe.info("levels", "%d storeys; %d working levels left out (Building "
                         "Story not ticked); %d on an 'Obsolete' workset left out"
               % (len(out), skipped, obsolete))
    if not out:
        probe.warn("levels", "no level has Building Story ticked, so the "
                             "viewer has no floor list")
    return out


def _element_name(el):
    """An element's name, the way that works under pyRevit's IronPython.
    Reading .Name directly on some element types - link types among them -
    raises AttributeError('Name') there, because Name is declared on the
    base Element class and IronPython fails to resolve it on the subclass."""
    from Autodesk.Revit.DB import Element, BuiltInParameter
    for get in (lambda: Element.Name.GetValue(el),
                lambda: Element.Name.__get__(el),
                lambda: el.get_Parameter(BuiltInParameter.SYMBOL_NAME_PARAM).AsString(),
                lambda: el.Name):
        try:
            v = get()
            if v:
                return v
        except Exception:
            pass
    return ""


def _placement_key(inst, ld):
    """Which linked model, placed where: two instances with the same key
    are the same geometry on top of itself. Millimetre / 1e-4 rounding so
    a copy nudged by float noise still counts as the same place."""
    tr = inst.GetTotalTransform()
    o = tr.Origin
    try:
        title = (ld.Title or "").lower()
    except Exception:
        title = ""
    if not title:
        title = "type:%d" % inst.GetTypeId().IntegerValue
    return (title,
            round(o.X * FT_MM), round(o.Y * FT_MM), round(o.Z * FT_MM),
            round(tr.BasisX.X, 4), round(tr.BasisX.Y, 4), round(tr.BasisX.Z, 4),
            round(tr.BasisY.X, 4), round(tr.BasisY.Y, 4), round(tr.BasisY.Z, 4),
            bool(tr.HasReflection))


def duplicate_link_placements(doc):
    """Link instances that sit exactly on top of an earlier instance of
    the same linked model, as {duplicate id: kept id}.

    Found on TP14: P1 was linked twice at the same place and one typical
    floor copy was placed twice at +0.00 m. Merged, the duplicate doubles
    that model in the IFC (P1 went into the 892 MB file twice); instanced,
    the viewer loads a second full copy. Either way the two copies fight
    over the same faces and flicker. The lowest instance id is kept, so
    the choice is the same every night."""
    from Autodesk.Revit.DB import FilteredElementCollector, RevitLinkInstance
    insts = []
    for inst in FilteredElementCollector(doc).OfClass(RevitLinkInstance):
        try:
            ld = inst.GetLinkDocument()
        except Exception:
            ld = None
        if ld is None:
            continue
        insts.append((inst.Id.IntegerValue, inst, ld))
    insts.sort(key=lambda r: r[0])
    seen, dups = {}, {}
    for iid, inst, ld in insts:
        try:
            key = _placement_key(inst, ld)
        except Exception:
            continue
        if key in seen:
            dups[iid] = seen[key]
        else:
            seen[key] = iid
    return dups


def link_instances(doc, probe):
    """Every placed link, with the placement Revit itself holds for it.

    The IFC exporter places a linked model's elements by the storey they
    belong to in the linked file. A typical floor linked once per floor -
    7/F to 43/F - therefore comes out with every copy on the same storey:
    the vertical part of each placement is lost, the horizontal part kept.
    The dialog export does the same (the first merged export topped out at
    60 m on a tower that reaches +120 m).

    Revit's own placement is exact, so it is recorded here, in millimetres
    in the host's internal frame - the frame the viewer already converts
    from. It is both the evidence for that loss and the data to undo it.
    """
    from Autodesk.Revit.DB import FilteredElementCollector, RevitLinkInstance
    out = []
    try:
        dups = duplicate_link_placements(doc)
    except Exception as ex:
        probe.warn("links", "could not check for duplicate placements: %s" % ex)
        dups = {}
    for inst in FilteredElementCollector(doc).OfClass(RevitLinkInstance):
        try:
            ld = inst.GetLinkDocument()
            tr = inst.GetTotalTransform()
        except Exception:
            continue
        o, bx, by, bz = tr.Origin, tr.BasisX, tr.BasisY, tr.BasisZ
        typ = doc.GetElement(inst.GetTypeId())
        name = (_element_name(typ) if typ is not None else "")
        if not name and ld is not None:
            try:
                name = ld.Title
            except Exception:
                name = ""
        out.append({
            "instance_id": inst.Id.IntegerValue,
            "link": name or ("link %d" % inst.Id.IntegerValue),
            "loaded": ld is not None,
            "origin_mm": [round(o.X * FT_MM, 1), round(o.Y * FT_MM, 1), round(o.Z * FT_MM, 1)],
            "basis_x": [bx.X, bx.Y, bx.Z],
            "basis_y": [by.X, by.Y, by.Z],
            "basis_z": [bz.X, bz.Y, bz.Z],
            "mirrored": bool(tr.HasReflection),
        })
        if inst.Id.IntegerValue in dups:
            # Kept in the table (it IS in the Revit model) but marked, and
            # left out of the IFC and the viewer's placements.
            out[-1]["duplicate_of"] = dups[inst.Id.IntegerValue]

    # Say, per linked model, how many times it is placed and over what
    # heights: a repeated typical floor shows up here at a glance.
    groups = {}
    for r in out:
        groups.setdefault(r["link"], []).append(r)
    for name in sorted(groups, key=lambda k: -len(groups[k])):
        rs = groups[name]
        extra = [r for r in rs if "duplicate_of" in r]
        rs = [r for r in rs if "duplicate_of" not in r] or rs
        zs = sorted(r["origin_mm"][2] for r in rs)
        # "%+.2f" of -0.004 prints "-0.00"; heights are shown to the cm.
        lo, hi = round(zs[0] / 1000.0, 2) + 0.0, round(zs[-1] / 1000.0, 2) + 0.0
        if len(rs) > 1:
            probe.info("links", "'%s' placed %d times, heights %+.2f m to %+.2f m"
                       % (name, len(rs), lo, hi))
        else:
            probe.info("links", "'%s' placed once, at %+.2f m" % (name, lo))
        for r in extra:
            probe.warn("links", "'%s' instance %d sits exactly on instance %d "
                                "(same model, same place): left out of the export. "
                                "Delete it in Manage Links if it is not intended."
                       % (name, r["instance_id"], r["duplicate_of"]))
    return out


def height_samples(doc, probe, limit=80):
    """True Revit heights of a sample of host elements, for the viewer to
    measure its own height offset against.

    The IFC comes into the viewer about 31 m lower than Revit on STS, for a
    reason inside the IFC-to-viewer path rather than in Revit's coordinates
    (survey point, base point and site elevation are all zero). A click to
    calibrate fixed it until the model load order changed what that click
    meant. So the offset is now measured on every open: the viewer finds
    these same elements by IFC GUID and compares their bottom and top.

    Only the vertical is used, and it is exact: the model turns about the
    vertical axis only, so an element's lowest and highest points have the
    same height in both frames whatever the rotation.
    """
    from Autodesk.Revit.DB import FilteredElementCollector, BuiltInCategory
    cats = (BuiltInCategory.OST_Floors, BuiltInCategory.OST_Walls,
            BuiltInCategory.OST_Columns, BuiltInCategory.OST_StructuralColumns,
            BuiltInCategory.OST_StructuralFraming, BuiltInCategory.OST_Roofs,
            BuiltInCategory.OST_GenericModel, BuiltInCategory.OST_Stairs,
            BuiltInCategory.OST_Doors, BuiltInCategory.OST_Windows)
    found = []
    for cat in cats:
        try:
            els = FilteredElementCollector(doc).OfCategory(cat).WhereElementIsNotElementType()
        except Exception:
            continue
        for el in els:
            try:
                bb = el.get_BoundingBox(None)
                if bb is None:
                    continue
                zmin, zmax = bb.Min.Z * FT_MM, bb.Max.Z * FT_MM
                if zmax - zmin > 200000:       # a site or massing element: skip
                    continue
                found.append({"ifc_guid": ifc_guid(doc, el),
                              "zmin_mm": round(zmin, 1), "zmax_mm": round(zmax, 1)})
            except Exception:
                pass
        if len(found) >= limit * 3:
            break
    # spread over the heights rather than all from one floor
    found.sort(key=lambda r: r["zmin_mm"])
    step = max(1, len(found) // limit)
    sample = found[::step][:limit]
    probe.info("heights", "%d elements recorded for the viewer to measure heights"
               % len(sample))
    if not sample:
        # Since 2026-09-24 the viewer places floors from the coordinates
        # alone and uses these samples only as a cross-check.
        probe.info("heights", "no host elements with geometry (a layout model "
                              "holding links): nothing to cross-check floor "
                              "heights against, which is fine")
    return sample


def _optional(fn, doc, probe, default):
    """Run a part of the manifest that only informs: link placements,
    levels. If it fails, say so in the log and carry on. The IFC and the
    PDFs must never be lost to a problem in a diagnostic - the last test
    run exported nothing because reading one link's name failed."""
    try:
        return fn(doc, probe)
    except Exception as ex:
        probe.warn(fn.__name__, "skipped: %s" % ex)
        return default


def build(doc, sheets, probe, with_elements=True):
    elements = build_elements(doc, probe) if with_elements else []
    if with_elements and len(elements) < 5000:
        probe.warn("scope", "only %d model elements found in this document. "
                            "For a whole building that usually means the "
                            "content is in links or closed worksets."
                   % len(elements))

    return {
        "schema": SCHEMA,
        "exported_at": datetime.datetime.utcnow().isoformat() + "Z",
        "units": {"length": "mm", "paper": "mm", "origin": "titleblock_lower_left"},
        "source": {
            "title": doc.Title,
            "path": doc.PathName,
            "revit_build": doc.Application.VersionBuild,
            "revit_version": doc.Application.VersionNumber,
            "workshared": bool(doc.IsWorkshared),
        },
        "model": {"ifc": None, "ifc_schema": None},
        "scope": scope_diagnostics(doc, probe),
        "project_location": _optional(project_location, doc, probe, None),
        "levels": _optional(levels, doc, probe, []),
        "link_instances": _optional(link_instances, doc, probe, []),
        "height_samples": _optional(height_samples, doc, probe, []),
        "element_categories": category_counts(elements),
        "elements": elements,
        "sheets": [build_sheet(doc, s, probe) for s in sheets],
        "probe": probe.records,
    }



# ------------------------------------------------------------ one manifest
#
# A project's manifest.json is written by several tools - the sheets, the
# fast 3D model, the automatic export - each producing only its own part.
# Each used to write the whole file from what IT had made, so exporting the
# sheets after the 3D model wiped the models out (and the other way round
# the sheets). merge_old() takes whatever this run did not make from the
# manifest already in the folder.

MODEL_KEYS = ("models", "lwk_frame", "ifc_exclude")


def _sheet_key(s):
    return (s.get("number") or "", s.get("page") or 1)


def merge_old(folder, data, made_models, made_sheets, keep_other_sheets=True):
    """data: the manifest this run built. made_models / made_sheets: what it
    exported. keep_other_sheets: sheets published before and not in this
    run stay (their PDF must still be in the folder)."""
    import io
    import json
    import os
    old = {}
    try:
        with io.open(os.path.join(folder, "manifest.json"), encoding="utf-8") as f:
            old = json.load(f) or {}
    except Exception:
        old = {}
    if not made_models:
        for k in MODEL_KEYS:
            if k in old:
                data[k] = old[k]
        if old.get("model"):
            data["model"] = old["model"]
        data.setdefault("models", [])
    if not made_sheets:
        data["sheets"] = old.get("sheets") or data.get("sheets") or []
    elif keep_other_sheets and old.get("sheets"):
        have = set(_sheet_key(s) for s in data.get("sheets") or [])
        for s in old["sheets"]:
            pdf = s.get("pdf")
            if _sheet_key(s) in have or not pdf:
                continue
            if os.path.isfile(os.path.join(folder, *pdf.split("/"))):
                data.setdefault("sheets", []).append(s)
        data["sheets"] = sorted(data.get("sheets") or [], key=lambda s: s.get("number") or "")
    # a run that did not read the elements keeps the table it had
    if not data.get("elements") and old.get("elements"):
        data["elements"] = old["elements"]
        data["element_categories"] = old.get("element_categories") or []
    return data
