# -*- coding: utf-8 -*-
"""A program-drawn schematic of every window/curtain-wall run the Light & Vent
check used - the same scope (floors, linked models, excluded types) as
LVCheck - a rectangle per sub-panel sized to its own width/height, at its own
real sill height, coloured by fixed glazing / openable glazing / not yet
confirmed, with the floor-to-floor height and the two "excluded" zones (the
leftover gap above and below the real glazing) alongside - so a figure that
looks wrong (like "how is 1940 x 2550 giving 11.3 m2?") can be traced to the
exact panel without waiting on a real Revit view export.

This is deliberately NOT an exported view of the real model - it is drawn
entirely from the numbers the check already computed, which is what makes it
fast across a whole tower. Writes lv_report_manifest.json into a folder you
choose; run lv_diagram_pdf.py (revit/tools/lv_diagram_pdf.py, plain Python 3,
`pip install reportlab` first) on that folder afterwards to get one PDF."""
__title__ = "Light & Vent\nDiagrams"
__author__ = "LWK BIM"

import os
import sys

from pyrevit import forms, revit, script


def _own_lib(start):
    node = os.path.dirname(os.path.abspath(start))
    while not node.lower().endswith(".extension"):
        parent = os.path.dirname(node)
        if parent == node:
            return None
        node = parent
    lib = os.path.join(node, "lib")
    return lib if os.path.isdir(lib) else None


_LIB = _own_lib(__file__)
if _LIB:
    while _LIB in sys.path:
        sys.path.remove(_LIB)
    sys.path.insert(0, _LIB)
for _m in [k for k in list(sys.modules) if k == "lwk_viewer" or k.startswith("lwk_viewer.")]:
    del sys.modules[_m]
from lwk_viewer import lvcheck as LV
from lwk_viewer import lvreport as LR

doc = revit.doc
out = script.get_output()
rules = LV.DEFAULT_RULES

# 1. same scope as LVCheck: which floors, host-only or with linked models
level_elevs, levels = None, None
try:
    lv = doc.ActiveView.GenLevel
except Exception:
    lv = None
if lv is not None:
    pick = forms.alert("Diagrams for which floors?", title="Light & Vent Diagrams",
                       options=["This floor only (%s)" % lv.Name, "All floors"])
    if not pick:
        script.exit()
    if pick.startswith("This"):
        levels = [lv.Name]
        level_elevs = [lv.Elevation * LV.FT_MM]

use_links = forms.alert("Read windows and curtain panels from where?", title="Light & Vent Diagrams",
                        options=["This model and the loaded linked models", "This model only"])
if not use_links:
    script.exit()
use_links = use_links.startswith("This model and")

out.print_md("### Light & Vent Diagrams - reading the model ...")
areas, _skipped = LV.collect_rooms(doc, level_elevs, rules, use_links)
if not areas:
    schemes = LV.area_scheme_names(doc)
    scheme = [x for x in schemes if "UFA" in x.upper()]
    scheme = scheme[0] if len(scheme) == 1 else (forms.SelectFromList.show(
        schemes, title="Which area scheme is the UFA?", button_name="Use this scheme") if schemes else None)
    if not scheme:
        forms.alert("No rooms or areas to diagram were found.", title="Light & Vent Diagrams")
        script.exit()
    areas = LV.collect_areas(doc, scheme, levels)
    if not areas:
        forms.alert("No placed areas of the scheme '%s' were found." % scheme, title="Light & Vent Diagrams")
        script.exit()

bands = LV.level_bands(doc, level_elevs, use_links) if level_elevs else None
items = LV.collect_items(doc, bands, True, use_links)
types = LV.load_types()

excludes = LV.load_excludes()
if excludes:
    items = [it for it in items if it.get("key") not in excludes]

rows, unmatched, counts = LV.build(areas, items, types, rules)

out_path = forms.save_file(file_ext="json", default_name="lv_report_manifest.json",
                           title="Save the diagram data")
if not out_path:
    script.exit()

diagrams, n = LR.export_report(doc, items, rows, level_elevs, use_links, out_path)

out.print_md("### Light & Vent Diagrams")
out.print_md("**%d** diagram(s) (one per room x wall run) saved to **%s**." % (n, out_path))
out.print_md("Next: `pip install reportlab` once, then `python lv_diagram_pdf.py \"%s\"` to get one PDF." % out_path)
