# -*- coding: utf-8 -*-
"""An annotated elevation image of every window, door and curtain panel the
Light & Vent check used - the same scope (floors, linked models, excluded
types) as LVCheck - labelled with the exact numbers its row in the table
already reports (nominal, measured, GBP_Glazing_*/GBP_Openable_* dimensions
if the family has them, which room(s) it serves and its share there), so a
figure that looks wrong (like "how is 1940 x 2550 giving 11.3 m2?") can be
traced straight to the element in Revit.

Exports one PNG per element plus lv_report_manifest.json into a folder you
choose. Run lv_report_pdf.py (revit/tools/lv_report_pdf.py, plain Python 3,
`pip install reportlab` first) on that folder afterwards to get one PDF."""
__title__ = "Light & Vent\nElevations"
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
    pick = forms.alert("Elevations for which floors?", title="Light & Vent Elevations",
                       options=["This floor only (%s)" % lv.Name, "All floors"])
    if not pick:
        script.exit()
    if pick.startswith("This"):
        levels = [lv.Name]
        level_elevs = [lv.Elevation * LV.FT_MM]

use_links = forms.alert("Read windows and curtain panels from where?", title="Light & Vent Elevations",
                        options=["This model and the loaded linked models", "This model only"])
if not use_links:
    script.exit()
use_links = use_links.startswith("This model and")

out.print_md("### Light & Vent Elevations - reading the model ...")
areas, _skipped = LV.collect_rooms(doc, level_elevs, rules, use_links)
if not areas:
    schemes = LV.area_scheme_names(doc)
    scheme = [x for x in schemes if "UFA" in x.upper()]
    scheme = scheme[0] if len(scheme) == 1 else (forms.SelectFromList.show(
        schemes, title="Which area scheme is the UFA?", button_name="Use this scheme") if schemes else None)
    if not scheme:
        forms.alert("No rooms or areas to report on were found.", title="Light & Vent Elevations")
        script.exit()
    areas = LV.collect_areas(doc, scheme, levels)
    if not areas:
        forms.alert("No placed areas of the scheme '%s' were found." % scheme, title="Light & Vent Elevations")
        script.exit()

bands = LV.level_bands(doc, level_elevs, use_links) if level_elevs else None
items = LV.collect_items(doc, bands, True, use_links)
types = LV.load_types()

excludes = LV.load_excludes()
if excludes:
    items = [it for it in items if it.get("key") not in excludes]

rows, unmatched, counts = LV.build(areas, items, types, rules)

# 2. how many elements, and where to put the images - this can be slow (a
# disposable view + image export per element), so confirm with a real count first
n_with_rows = len(set(w["uid"] for r in rows for w in r.get("windows", [])))
if n_with_rows == 0:
    forms.alert("No window, door or curtain panel ended up in the Light & Vent table for this scope.",
               title="Light & Vent Elevations")
    script.exit()
if not forms.alert("%d element(s) will each get a disposable view, a label and an exported image. "
                   "This can take a while for a whole tower - consider running it one floor at a time.\n\n"
                   "Continue?" % n_with_rows, title="Light & Vent Elevations", yes=True, no=True):
    script.exit()

out_dir = forms.pick_folder(title="Folder to export the images and manifest into")
if not out_dir:
    script.exit()

with forms.ProgressBar(title="Exporting elevations") as pb:
    manifest, exported = LR.export_report(doc, items, rows, out_dir, progress=pb.update_progress)

out.print_md("### Light & Vent Elevations")
out.print_md("**%d** of **%d** element(s) exported to **%s**." % (exported, len(manifest), out_dir))
if exported < len(manifest):
    out.print_md("%d element(s) could not be exported (see the Revit journal for details) - "
                 "the manifest still lists them, just without an image." % (len(manifest) - exported))
out.print_md("Next: `pip install reportlab` once, then `python lv_report_pdf.py \"%s\"` to get one PDF." % out_dir)
