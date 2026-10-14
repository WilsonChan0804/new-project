# -*- coding: utf-8 -*-
"""Lighting and ventilation of a typical floor: for each area of the UFA
scheme, the required lighting (area x 1/10) and openable (area x 1/16)
window area against what its windows and curtain panels give - the table of
the LWK window calculation sheet, made from the model.

Revit does not know which panel opens, so each window / panel type is
confirmed once (fixed, casement, sliding ...); until it is, the room reads
NEEDS DATA, never OK."""
__title__ = "Light &\nVent"
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

doc = revit.doc
out = script.get_output()

# 1. the area scheme and the floors
schemes = LV.area_scheme_names(doc)
if not schemes:
    forms.alert("This model has no area scheme. The check reads the Areas of the UFA scheme.", title="Light & Vent")
    script.exit()
default = [s for s in schemes if "UFA" in s.upper()]
scheme = default[0] if len(default) == 1 else forms.SelectFromList.show(
    schemes, title="Which area scheme is the UFA?", button_name="Use this scheme")
if not scheme:
    script.exit()

levels = None
try:
    lv = doc.ActiveView.GenLevel
except Exception:
    lv = None
if lv is not None:
    pick = forms.alert("Check which floors?", title="Light & Vent",
                       options=["This floor only (%s)" % lv.Name, "All floors"])
    if not pick:
        script.exit()
    if pick.startswith("This"):
        levels = [lv.Name]

# 2. read the model
out.print_md("### Light & Vent - reading the model ...")
areas = LV.collect_areas(doc, scheme, levels)
if not areas:
    forms.alert("No placed areas of the scheme '%s' were found%s." % (scheme, " on " + levels[0] if levels else ""),
                title="Light & Vent")
    script.exit()
items = LV.collect_items(doc, levels)
types = LV.load_types()
rules = LV.DEFAULT_RULES

rows, unmatched, counts = LV.build(areas, items, types, rules)

# 3. the types still to confirm
todo = sorted(k for k in counts if not LV.type_info(k, types)["confirmed"])
if todo:
    labels = []
    for k in todo:
        i = LV.type_info(k, types)
        labels.append("%s   [%s, %d]   %s" % (k, counts[k]["cat"], counts[k]["count"],
                                              ("guess: %s" % i["operation"]) if i["fraction"] is not None else "not known"))
    chosen = forms.SelectFromList.show(
        labels, multiselect=True, title="Confirm how these types open (tick the ones that open the same way)",
        button_name="Set how they open")
    while chosen:
        ops = ["%s  (%d%%)" % (o, int(f * 100)) for o, f in LV.OPERATIONS] + ["Other fraction ..."]
        op = forms.SelectFromList.show(ops, title="How do these %d types open?" % len(chosen), button_name="Confirm")
        if op:
            if op.startswith("Other"):
                txt = forms.ask_for_string(default="0.5", prompt="Openable part of the glazing area (0 to 1):", title="Light & Vent")
                try:
                    name, frac = "Other", min(1.0, max(0.0, float(txt)))
                except Exception:
                    break
            else:
                name, frac = [(o, f) for o, f in LV.OPERATIONS if op.startswith(o)][0]
            for lab in chosen:
                types[todo[labels.index(lab)]] = {"operation": name, "fraction": frac, "confirmed": True}
            LV.save_types(types)
        break
    rows, unmatched, counts = LV.build(areas, items, types, rules)

# 4. show it
out.print_md("### Lighting and ventilation - %s%s" % (scheme, (", " + levels[0]) if levels else ""))
out.print_md("Required: lighting = area x 1/10, openable = area x 1/16 (the sheet's ratios - the AP confirms them against B(P)R 30 / APP-130). "
             "Provided: width x height x 80%, the measured glass beside it. A bath or kitchen with no window of its own is counted with its living room.")
table = []
for r in rows:
    nm = r["name"] + ("".join(" + " + w["name"] for w in r["with"]))
    f = lambda v: "" if v is None else "%.3f" % v
    table.append([r["flat"], r["number"], nm, f(r["area_m2"]), f(r["req_light"]), f(r["prov_light_bd"]), f(r["prov_light_meas"]),
                  f(r["req_open"]), f(r["prov_open_bd"]), r["status"], "; ".join(r["notes"])])
out.print_table(table_data=table, title="Rooms",
                columns=["Flat", "Room", "Name", "Area m2", "Req. lighting", "Prov. lighting (W x H x 80%)", "Prov. lighting (measured)",
                         "Req. openable", "Prov. openable", "Status", "Notes"])
bad = [r for r in rows if r["status"] in ("NOT OK", "NEEDS DATA", "NO WINDOW")]
out.print_md("**%d rooms: %d OK, %d not OK, %d need data, %d without a window.** %d windows / panels were not given to a room."
             % (len(rows), len([r for r in rows if r["status"] == "OK"]), len([r for r in rows if r["status"] == "NOT OK"]),
                len([r for r in rows if r["status"] == "NEEDS DATA"]), len([r for r in rows if r["status"] == "NO WINDOW"]), len(unmatched)))
if unmatched:
    out.print_md("Not given to a room: " + ", ".join("%s (%s)" % (u["id"], u["why"]) for u in unmatched[:30]) + (" ..." if len(unmatched) > 30 else ""))

# 5. keep it
path = forms.save_file(file_ext="csv", default_name="light_and_ventilation.csv", title="Save the table")
if path:
    LV.write_csv(path, rows)
    LV.write_json(os.path.splitext(path)[0] + ".json", rows, unmatched, counts)
    out.print_md("Saved **%s** (and the same as .json)." % path)

if rows and forms.alert("Write each window's room, glazing and openable area into its parameters?\n\n"
                        "Needs the shared parameters LWK_LV_Room, LWK_LV_Room_Name, LWK_LV_Flat, LWK_LV_Glazing_m2, "
                        "LWK_LV_Openable_m2 on Windows, Doors and Curtain Panels. This changes the model.",
                        title="Light & Vent", yes=True, no=True):
    n, missing = LV.write_back(doc, rows)
    out.print_md("Written for **%d** windows / panels." % n + (("  Missing parameters: " + ", ".join(missing)) if missing else ""))
