# -*- coding: utf-8 -*-
"""Lighting and ventilation of a typical floor: for each UFA room, the required
lighting (area x 1/10) and openable (area x 1/16) window area against what its
windows and curtain panels give - the table of the LWK window calculation
sheet, made from the model.

The rooms are the Rooms ticked UFA_Y/N or UFS_Y/N (named LIV/DIN, BR1, MBR,
KIT, O.KIT, STO ...; the flat from BUD-GBP-Common-Premises_ID, the block from
BUD-GBP-Common-Premises_Location). Windows and curtain panels are read from
this model and from the loaded linked models; a panel that runs past two rooms
is shared between them. A project that has no Rooms of that kind can still use
the Areas of an area scheme.

Revit does not know which panel opens, so each window / panel type is
confirmed once (fixed, casement, sliding ...); until it is, the room reads
NEEDS DATA, never OK.

Saves the table (CSV + JSON) and, on request, a window area schedule plus a
program-drawn schematic of every window/curtain-wall run, as one PDF - built
straight after saving, with no separate command to run by hand."""
__title__ = "Light &\nVent"
__author__ = "LWK BIM"

import os
import subprocess
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

# 1. the floors - always asked, never silently skipped: the active view often has no
# level of its own (a 3D view, sheet, schedule, legend - exactly what's likely to be open
# when launching this from a dashboard view), which must not fall through to "every level
# in the project" with no confirmation on a tower that can have 40+ of them
from Autodesk.Revit.DB import FilteredElementCollector, Level

level_elevs, levels = None, None
try:
    lv = doc.ActiveView.GenLevel
except Exception:
    lv = None

all_levels = sorted(FilteredElementCollector(doc).OfClass(Level).WhereElementIsNotElementType().ToElements(),
                    key=lambda l: l.Elevation)

options = []
if lv is not None:
    options.append("This floor only (%s)" % lv.Name)
options.append("Pick floors...")
options.append("All floors (%d)" % len(all_levels))
pick = forms.alert("Check which floors?", title="Light & Vent", options=options)
if not pick:
    script.exit()
if pick.startswith("This"):
    levels = [lv.Name]
    level_elevs = [lv.Elevation * LV.FT_MM]
elif pick.startswith("Pick"):
    chosen = forms.SelectFromList.show([l.Name for l in all_levels], multiselect=True,
                                       title="Which floors?", button_name="Use these floors")
    if not chosen:
        script.exit()
    chosen = set(chosen)
    levels = [l.Name for l in all_levels if l.Name in chosen]
    level_elevs = [l.Elevation * LV.FT_MM for l in all_levels if l.Name in chosen]
    if not levels:
        script.exit()
elif len(all_levels) > 10:
    if not forms.alert("This will scan all %d floors across the whole project - on a model this "
                       "size it can take a long time. Continue?" % len(all_levels),
                       title="Light & Vent", yes=True, no=True):
        script.exit()

use_links = forms.alert("Read the windows and curtain panels from where?", title="Light & Vent",
                        options=["This model and the loaded linked models", "This model only"])
if not use_links:
    script.exit()
use_links = use_links.startswith("This model and")

# 2. the rooms: Rooms ticked UFA / UFS, else the Areas of an area scheme
out.print_md("### Light & Vent - reading the model ...")
areas, skipped = LV.collect_rooms(doc, level_elevs, rules, use_links)
scheme = None
source_label = "Rooms ticked " + " / ".join(rules["room_flags"])
if not areas:
    schemes = LV.area_scheme_names(doc)
    if not schemes:
        forms.alert("No placed Rooms ticked %s with a name the check knows (LIV/DIN, BR, MBR, KIT, STO ...) were found%s, "
                    "and the model has no area scheme." % (" or ".join(rules["room_flags"]), " on " + levels[0] if levels else ""),
                    title="Light & Vent")
        script.exit()
    if not forms.alert("No Rooms ticked %s were found%s.\n\nUse the Areas of an area scheme instead?" % (
            " or ".join(rules["room_flags"]), " on " + levels[0] if levels else ""), title="Light & Vent", yes=True, no=True):
        script.exit()
    default = [x for x in schemes if "UFA" in x.upper()]
    scheme = default[0] if len(default) == 1 else forms.SelectFromList.show(
        schemes, title="Which area scheme is the UFA?", button_name="Use this scheme")
    if not scheme:
        script.exit()
    areas = LV.collect_areas(doc, scheme, levels)
    skipped = []
    source_label = "Areas of " + scheme
    if not areas:
        forms.alert("No placed areas of the scheme '%s' were found%s." % (scheme, " on " + levels[0] if levels else ""), title="Light & Vent")
        script.exit()
bands = LV.level_bands(doc, level_elevs, use_links) if level_elevs else None
items = LV.collect_items(doc, bands, True, use_links)
doors = LV.collect_doors(doc, bands, use_links)
types = LV.load_types()

# 2b. leave out a whole TYPE that shouldn't count as a window/door of a room (a
# balcony grille, a service door ...) - a project can have thousands of elements
# but only a handful of distinct families/types, and a type like that is normally
# used the same way everywhere it occurs. The AP's own call, remembered for next
# time; works even where the model can't be edited to tick LWK_LV_Exclude on an
# element (a linked, not-editable element)
excludes = LV.load_excludes()
all_items = items + doors
by_type = {}
for it in all_items:
    t = by_type.setdefault(it.get("key") or "(no type)", {"mark": it.get("mark", ""), "cat": it.get("cat", "Doors"), "count": 0})
    t["count"] += 1


def _type_label(key):
    t = by_type[key]
    return "%s   [%s, %d]   %s" % (key, t["cat"], t["count"], ("mark " + t["mark"]) if t["mark"] else "")


if forms.alert("Leave any whole window/door/panel TYPE out of this check (e.g. a balcony grille "
               "door type that is not really a window)?", title="Light & Vent", yes=True, no=True):
    excluded_now = sorted(k for k in by_type if k in excludes)
    if excluded_now and forms.alert("%d type(s) are currently left out. Put any of them back in?" % len(excluded_now),
                                    title="Light & Vent", yes=True, no=True):
        back_in = forms.SelectFromList.show([_type_label(k) for k in excluded_now], multiselect=True,
                                            title="Put these types back into the check", button_name="Put back in")
        if back_in:
            excludes -= set(k for k in excluded_now if _type_label(k) in back_in)
    available = sorted(k for k in by_type if k not in excludes)
    pick = forms.SelectFromList.show([_type_label(k) for k in available], multiselect=True,
                                     title="Tick any TYPES to leave out of this check", button_name="Leave these types out")
    if pick:
        excludes |= set(k for k in available if _type_label(k) in pick)
    LV.save_excludes(excludes)

if excludes:
    items = [it for it in items if it.get("key") not in excludes]
    doors = [d for d in doors if d.get("key") not in excludes]

rows, unmatched, counts = LV.build(areas, items, types, rules, doors)

# 3. the types still to confirm
todo = sorted(k for k in counts if not LV.type_info(k, types)["confirmed"])
if todo:
    labels = []
    for k in todo:
        i = LV.type_info(k, types)
        labels.append("%s   [%s, %d]   %s" % (k, counts[k]["cat"], counts[k]["count"],
                                              ("guess: %s" % i["operation"]) if i["fraction"] is not None else "not known"))
    # answered batch by batch - a mixed set of types may need different answers (some 50%,
    # some 100% ...), so this keeps asking for whatever is still unconfirmed until none is left
    remaining = list(todo)
    rem_labels = list(labels)
    OTHER = "Other fraction ..."
    op_labels = ["%d%% open  (%s)" % (int(f * 100), o) for o, f in LV.OPERATIONS]
    while remaining:
        chosen = forms.SelectFromList.show(
            rem_labels, multiselect=True, title="Confirm how these types open (tick the ones that open the same way; "
            "pick more than one batch if types need different answers)", button_name="Set how they open")
        if not chosen:
            break
        op = forms.SelectFromList.show(op_labels + [OTHER], title="How do these %d types open?" % len(chosen), button_name="Confirm")
        if not op:
            continue
        if op == OTHER:
            txt = forms.ask_for_string(default="0.5", prompt="Openable part of the glazing area (0 to 1):", title="Light & Vent")
            try:
                name, frac = "Other", min(1.0, max(0.0, float(txt)))
            except Exception:
                continue
        else:
            name, frac = LV.OPERATIONS[op_labels.index(op)]
        for lab in chosen:
            types[remaining[rem_labels.index(lab)]] = {"operation": name, "fraction": frac, "confirmed": True}
        LV.save_types(types)
        remaining = [k for k, lab in zip(remaining, rem_labels) if lab not in chosen]
        rem_labels = [lab for lab in rem_labels if lab not in chosen]
    rows, unmatched, counts = LV.build(areas, items, types, rules, doors)

# 4. show it
out.print_md("### Lighting and ventilation - %s%s" % (source_label, (", " + levels[0]) if levels else ""))
out.print_md("%d rooms, %d windows / panels read (%s)." % (len(areas), len(items), ", ".join(sorted(set(i["source"] for i in items))) or "none"))
if skipped:
    out.print_md("Ticked rooms the check does not assess (no lighting / ventilation use in the name): " + ", ".join("%s x%d" % kv for kv in skipped))
out.print_md("Required: lighting = area x 1/10, openable = area x 1/16 (the sheet's ratios - the AP confirms them against B(P)R 30 / APP-130). "
             "Provided: the measured glass (the actual glazing/openable area found in the model). "
             "A bath or kitchen with no window of its own, or one that isn't enough, is counted with whichever room its door leads to.")
table = []
for r in rows:
    nm = r["name"] + ("".join(" + " + w["name"] for w in r["with"]))
    f = lambda v: "" if v is None else "%.3f" % v
    table.append([r["block"], r["flat"], r["number"], nm, f(r["area_m2"]), f(r["req_light"]), f(r["prov_light_meas"]),
                  f(r["req_open"]), f(r["prov_open_meas"]), r["status"], "; ".join(r["notes"])])
out.print_table(table_data=table, title="Rooms",
                columns=["Block", "Flat", "Room", "Name", "Area m2", "Req. lighting", "Prov. lighting (measured)",
                         "Req. openable", "Prov. openable (measured)", "Status", "Notes"])
bad = [r for r in rows if r["status"] in ("NOT OK", "NEEDS DATA", "NO WINDOW")]
out.print_md("**%d rooms: %d OK, %d not OK, %d need data, %d without a window.** %d windows / panels were not given to a room."
             % (len(rows), len([r for r in rows if r["status"] == "OK"]), len([r for r in rows if r["status"] == "NOT OK"]),
                len([r for r in rows if r["status"] == "NEEDS DATA"]), len([r for r in rows if r["status"] == "NO WINDOW"]), len(unmatched)))
if unmatched:
    out.print_md("Not given to a room: " + ", ".join("%s%s (%s)" % (u["id"], (" in " + u["source"]) if u.get("source") and "link" in u["source"] else "", u["why"]) for u in unmatched[:30]) + (" ..." if len(unmatched) > 30 else ""))

# 5. keep it
path = forms.save_file(file_ext="csv", default_name="light_and_ventilation.csv", title="Save the table")
if path:
    LV.write_csv(path, rows)
    LV.write_json(os.path.splitext(path)[0] + ".json", rows, unmatched, counts)
    out.print_md("Saved **%s** (and the same as .json)." % path)

    # 5b. the window area schedule + a program-drawn schematic of every window/curtain-wall
    # run, as one PDF - built right away, no separate step to run by hand
    if forms.alert("Also create the window area schedule and schematic diagrams (PDF)?",
                   title="Light & Vent", yes=True, no=True):
        manifest_path = os.path.splitext(path)[0] + "_diagrams.json"
        diagrams, n = LR.export_report(doc, items, rows, level_elevs, use_links, manifest_path)
        out.print_md("%d diagram(s) (one per room x wall run) saved to **%s**." % (n, manifest_path))
        pdf_script = os.path.join(_LIB, "lwk_viewer", "lv_diagram_pdf.py") if _LIB else None
        pdf_path = None
        if pdf_script and os.path.isfile(pdf_script):
            for py in ("python", "python3", "py"):
                try:
                    proc = subprocess.Popen([py, pdf_script, manifest_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                    out_bytes, err_bytes = proc.communicate()
                    if proc.returncode == 0:
                        pdf_path = os.path.splitext(manifest_path)[0] + ".pdf"
                        break
                except Exception:
                    continue
        if pdf_path and os.path.isfile(pdf_path):
            out.print_md("**Saved %s.**" % pdf_path)
        else:
            out.print_md("Could not build the PDF automatically (Python and `pip install reportlab` are needed on this "
                         "machine, once). The diagram data is saved - once Python/reportlab are set up, run:\n\n"
                         "```\npython \"%s\" \"%s\"\n```" % (pdf_script or "lv_diagram_pdf.py", manifest_path))

if rows and forms.alert("Write each window's room, glazing and openable area into its parameters?\n\n"
                        "Needs the shared parameters LWK_LV_Room, LWK_LV_Room_Name, LWK_LV_Flat, LWK_LV_Glazing_m2, "
                        "LWK_LV_Openable_m2 on Windows, Doors and Curtain Panels. This changes the model; elements of linked models are left alone.",
                        title="Light & Vent", yes=True, no=True):
    n, missing = LV.write_back(doc, rows)
    out.print_md("Written for **%d** windows / panels." % n + (("  Missing parameters: " + ", ".join(missing)) if missing else ""))
