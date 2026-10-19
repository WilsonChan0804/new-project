# -*- coding: utf-8 -*-
"""The Revit-side half of the elevation report (see lv_diagram_pdf.py for the
offline PDF it feeds): collects the one Revit-only fact the schematic diagram
needs beyond what the Light & Vent check already gathers - the floor-to-floor
height of each level being checked - and hands everything else to
lvdiagram.build_diagrams, which is pure data and needs no Revit at all.

There is deliberately no view, dimension or image-export code here: an
earlier version of this tool created a disposable Revit section view per
element, which was slow across a whole tower and could not be exercised
without a real Revit session to debug. The program-drawn schematic needs
none of that - it is built entirely from collect_items/build()'s own output.
"""


def export_report(doc, items, rows, level_elevs, include_links, out_path):
    """items: collect_items() output. rows: build()'s rows. level_elevs: the
    floor elevations (mm) the check was run for, or None for "every level a
    room in rows belongs to" (then this falls back to each room's own level_mm).
    Writes the diagrams (see lvdiagram.build_diagrams) as JSON to out_path.
    -> (diagrams, count)"""
    from lwk_viewer import lvcheck as LV
    from lwk_viewer import lvdiagram as LD

    elevs = level_elevs
    if not elevs:
        elevs = sorted(set(r.get("level_mm", 0.0) for r in rows))
    heights = LV.floor_to_floor_mm(doc, elevs, include_links)
    by_level_mm = dict(zip(elevs, heights))
    floor_to_floor = {}
    for r in rows:
        key = (r.get("block", ""), r["level"])
        if key not in floor_to_floor:
            floor_to_floor[key] = by_level_mm.get(r.get("level_mm", 0.0), 3000.0)

    diagrams = LD.build_diagrams(rows, items, floor_to_floor)
    _write(out_path, diagrams)
    return diagrams, len(diagrams)


def _write(out_path, diagrams):
    import io
    import json
    txt = json.dumps({"schema": "lwk.lv.diagram/1", "diagrams": diagrams}, ensure_ascii=True, indent=1)
    with io.open(out_path, "w", encoding="utf-8") as f:
        f.write(txt if isinstance(txt, type(u"")) else txt.decode("ascii"))
