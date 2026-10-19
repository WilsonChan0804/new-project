# -*- coding: utf-8 -*-
"""The schematic elevation diagram: for each room's own windows/doors/curtain
panels (build()'s rows - already the real, share-adjusted per-room list), a
program-drawn, to-scale picture of each wall "run" - a rectangle per element,
sized to its own width/height and positioned at its real sill height and real
relative offset along the wall, coloured by whether it is fixed glazing,
openable glazing, or a type not yet confirmed - plus the two "excluded" gaps
(an upstand below, a spandrel above) inferred as whatever height is left
between the floor, the lowest item, the highest item, and the floor above.

This is deliberately not a real Revit view: it needs nothing beyond what the
check already collects (collect_items' pos/n/w_mm/h_mm/bottom_mm/top_mm, and
build()'s rows), so it is fully Revit-free, fast, and unit tested like
lvcheck.py itself - see lvreport.py for the one Revit-side step this still
needs (the floor-to-floor height of each level, lvcheck.floor_to_floor_mm).

A run only ever covers one room's own share of a shared panel (the same
sharing already in the table): a wide curtain wall running past two rooms
gets a separate diagram in each room, each showing only its own portion.
"""

GAP_MM = 600.0   # along a wall, consecutive items more than this apart are a separate run


def _tangent(n):
    nx, ny = n
    return (-ny, nx)


def _along(pos, n):
    """Signed offset of pos along n's own tangent direction (an arbitrary,
    per-direction origin - only differences between items in the same group
    are meaningful)."""
    tx, ty = _tangent(n)
    x, y, _z = pos
    return x * tx + y * ty


def _n_key(n, tol=0.05):
    """Rounds a facing direction so float noise does not split one wall into
    two groups."""
    nx, ny = n
    return (round(nx / tol) * tol, round(ny / tol) * tol)


def _color_for(w):
    frac = w.get("fraction")
    if frac is None:
        return "unconfirmed"
    return "fixed" if frac == 0 else "openable"


def _run_direction(group):
    """One shared facing direction for a whole run, instead of trusting each
    item's own n individually: two items of the same physical wall can read
    very slightly different FacingOrientation values (a family that reports
    the direction its sash swings open, say, rather than the frame's true
    outward normal, next to a plain panel that falls back to its host wall's
    own orientation) - using each item's own n to project its position along
    the wall then disagrees between items on the very same wall, which is
    exactly what misplaces one of them sideways. Averaging and renormalising
    settles everything in the run onto one consistent direction."""
    sx = sum(it["n"][0] for _w, it in group)
    sy = sum(it["n"][1] for _w, it in group)
    m = (sx * sx + sy * sy) ** 0.5
    return (sx / m, sy / m) if m > 1e-9 else group[0][1]["n"]


def _group_runs(geo_ws):
    """geo_ws: [(window_dict, item_dict), ...], all from the same room. ->
    [(n_ref, [(window_dict, item_dict), ...]), ...], one per wall run, each
    with the one facing direction every item in it is laid out against."""
    by_dir = {}
    for w, it in geo_ws:
        by_dir.setdefault(_n_key(it["n"]), []).append((w, it))
    runs = []
    for group in by_dir.values():
        n_ref = _run_direction(group)
        group.sort(key=lambda wi: _along(wi[1]["pos"], n_ref))
        current = [group[0]]
        for i in range(1, len(group)):
            _prev_w, prev_it = group[i - 1]
            _cur_w, cur_it = group[i]
            prev_edge = _along(prev_it["pos"], n_ref) + (prev_it.get("w_mm") or 0.0) / 2.0
            cur_edge = _along(cur_it["pos"], n_ref) - (cur_it.get("w_mm") or 0.0) / 2.0
            if cur_edge - prev_edge > GAP_MM:
                runs.append((n_ref, current))
                current = []
            current.append(group[i])
        runs.append((n_ref, current))
    return runs


def _build_one(room, n_ref, run, floor_to_floor_mm):
    level_mm = room.get("level_mm", 0.0)
    rects = []
    for w, it in run:
        width = it.get("w_mm") or 0.0
        # the element's own Height parameter (h_mm) is what the table's own light/open figures
        # are computed from - draw that, not the bounding box's own top-bottom span, which can
        # disagree with it (a sash that reads larger than its Height parameter in the model, a
        # frame that extends past the glazed height, ...) and would draw a rectangle whose own
        # numbers do not match the row it belongs to
        height = it.get("h_mm")
        if height is None and it.get("top_mm") is not None and it.get("bottom_mm") is not None:
            height = it["top_mm"] - it["bottom_mm"]
        height = height or 0.0
        center = _along(it["pos"], n_ref)
        # a family can give its own openable sub-size (GBP_Openable_Width/Height) smaller than
        # its overall glazing - a "2-panels" unit where only one leaf opens, say. Drawn as its own
        # rectangle, centred within the glazing, rather than colouring the whole panel as openable
        # when only part of it is - the base rectangle is the glazing colour in that case, and the
        # inset carries the openable colour instead
        open_w, open_h = w.get("open_w_mm"), w.get("open_h_mm")
        open_rect = None
        if open_w and open_h:
            open_rect = {"left": max(0.0, (width - open_w) / 2.0), "bottom": max(0.0, (height - open_h) / 2.0),
                        "width": min(open_w, width), "height": min(open_h, height)}
        rects.append({
            "left": center - width / 2.0, "width": width,
            "bottom": it["bottom_mm"] - level_mm, "height": height,
            "color": "fixed" if open_rect else _color_for(w), "mark": w.get("mark") or "", "key": w.get("key", ""),
            "light_bd": w.get("light_bd"), "light_meas": w.get("light_meas"),
            "open_bd": w.get("open_bd"), "open_meas": w.get("open_meas"),
            "share": w.get("share"), "exact_dims": w.get("exact_dims", False),
            "open_rect": open_rect,
        })
    base = min(r["left"] for r in rects)
    for r in rects:
        r["left"] -= base
    lowest_bottom = min(r["bottom"] for r in rects)
    highest_top = max(r["bottom"] + r["height"] for r in rects)
    gaps = []
    if lowest_bottom > 1.0:
        gaps.append({"bottom": 0.0, "height": lowest_bottom})
    if floor_to_floor_mm - highest_top > 1.0:
        gaps.append({"bottom": highest_top, "height": floor_to_floor_mm - highest_top})
    width_total = max(r["left"] + r["width"] for r in rects)
    return {
        "block": room.get("block", ""), "level": room.get("level", ""), "flat": room.get("flat", ""),
        "number": room.get("number", ""), "name": room.get("name", ""),
        "floor_to_floor_mm": floor_to_floor_mm, "width_mm": width_total,
        # the room's own summary, straight from build()'s row - so the page carries the same
        # required/provided numbers as the table, with nothing to hand-copy or re-derive
        "area_m2": room.get("area_m2"), "status": room.get("status", ""),
        "req_light": room.get("req_light"), "req_open": room.get("req_open"),
        "prov_light_bd": room.get("prov_light_bd"), "prov_light_meas": room.get("prov_light_meas"),
        "prov_open_bd": room.get("prov_open_bd"), "prov_open_meas": room.get("prov_open_meas"),
        "rects": rects, "gaps": gaps,
    }


def build_diagrams(rows, items, floor_to_floor_mm):
    """rows: build()'s rows. items: collect_items() output (for pos/n/
    bottom_mm/top_mm, which a row's own window entries do not carry).
    floor_to_floor_mm: {(block, level): height_mm} for every level a room in
    rows belongs to (fall back to 3000.0 when a level is missing). -> one
    diagram dict per room x wall-run (see _build_one), JSON-safe."""
    by_uid = dict((it["uid"], it) for it in items if it.get("w_mm") and it.get("bottom_mm") is not None)
    diagrams = []
    for r in rows:
        geo_ws = []
        for w in (r.get("windows") or []):
            it = by_uid.get(w.get("uid"))
            if it is not None:
                geo_ws.append((w, it))
        if not geo_ws:
            continue
        f2f = floor_to_floor_mm.get((r.get("block", ""), r["level"]), 3000.0)
        for n_ref, run in _group_runs(geo_ws):
            diagrams.append(_build_one(r, n_ref, run, f2f))
    return diagrams
