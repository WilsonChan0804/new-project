# -*- coding: utf-8 -*-
"""SBD Export: the Mass elements and the site boundary of this model go to
the LWK Viewer, which assesses SBD (PNAP APP-152) for the three height zones
from them (Checks > SBD on the 3D page). Model the buildings as Masses."""
__title__ = "SBD\nExport"
__author__ = "LWK BIM"

import os
import sys
import time

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
from lwk_viewer import sbd_export as SE
from lwk_viewer import issues as L
from lwk_viewer import jsonio

from Autodesk.Revit.DB import FilteredElementCollector, Level, CurveElement
from Autodesk.Revit.UI.Selection import ISelectionFilter, ObjectType

doc = revit.doc
uidoc = revit.uidoc
out = script.get_output()


class _Lines(ISelectionFilter):
    def AllowElement(self, e):
        return isinstance(e, CurveElement)

    def AllowReference(self, r, p):
        return False


def pick_lines(prompt):
    try:
        refs = uidoc.Selection.PickObjects(ObjectType.Element, _Lines(), prompt)
    except Exception:
        return []
    return [doc.GetElement(r).GeometryCurve for r in refs]


# 1. the masses
masses = SE.mass_meshes(doc)
if not masses:
    forms.alert("This model has no Mass elements.\n\nModel each building (podium, towers) as a Mass "
                "(Massing & Site > In-Place Mass, or a Mass family) - the SBD check reads the zones from them.",
                title="SBD Export")
    script.exit()

# 2. the site boundary: a Property Line, or lines picked
site = None
plines = SE.property_line_loops(doc)
choices = ["%s (%d points)" % (n, len(l)) for n, l, g in plines] + ["Pick the lines of the site boundary ..."]
pick = forms.SelectFromList.show(choices, title="SBD Export - the subject site boundary", button_name="Use this") if len(choices) > 1 else choices[0]
if not pick:
    script.exit()
if pick in choices[:-1]:
    name, site, gap = plines[choices.index(pick)]
else:
    loop, gap = SE.curves_loop(pick_lines("Select the lines of the SITE BOUNDARY (all of them), then Finish"))
    if not loop:
        forms.alert("Those lines do not make one boundary.", title="SBD Export")
        script.exit()
    site = loop
if gap is not None and gap > SE.CLOSE_TOL_M:
    if not forms.alert("The site boundary does not close: its ends are %.3f m apart.\n\nUse it anyway (closed by a straight line)?" % gap,
                       title="SBD Export", yes=True, no=True):
        script.exit()

# 3. the streets: Floors of a "Street" type (kerb to kerb). Each gives its
# centreline, the opposite site's boundary (its far side) and its level.
street_axis = None
streets = []
slabs = SE.street_floors(doc)
made = []
for f in slabs:
    st = SE.street_from_floor(f, site)
    if st:
        made.append((f, st))
    else:
        out.print_md("- Street slab **%s** is not a strip (two long sides, two ends) - left out; pick its lines instead." % f["name"])
if made:
    labels = ["%s - %.0f m long, %.1f m wide, level %.2f m" % (st["name"], st["length_m"], st["width_m"], st["level"]) for f, st in made]
    try:            # all ticked to start with: untick a street not fronting the site
        items = [forms.TemplateListItem(lab, checked=True) for lab in labels]
    except Exception:
        items = labels
    chosen = forms.SelectFromList.show(items, title="SBD Export - the streets (Floors of a Street / Road / Lane / Path type)", multiselect=True,
                                       button_name="Use the ticked streets")
    if chosen is None:
        script.exit()
    made = [m for m, lab in zip(made, labels) if lab in chosen]
    streets = [st for f, st in made]
if not streets and forms.alert("No street slabs used.\n\nModel each street as a Floor whose type name has Street, Road, Lane or Path in it "
                               "(kerb to kerb) - or pick its centreline and the opposite boundary now?",
                               title="SBD Export", options=["Pick lines now", "No street"]) == "Pick lines now":
    while True:
        cl = SE.curves_polyline(pick_lines("Select the street CENTRELINE, then Finish"))
        if not cl or len(cl) < 2:
            break
        op = SE.curves_polyline(pick_lines("Select the OPPOSITE site boundary across the street, then Finish")) or []
        nm = forms.ask_for_string(default="Street %d" % (len(streets) + 1), prompt="Name of the street", title="SBD Export") or ""
        streets.append({"name": nm, "centreline": [[round(x, 4), round(y, 4)] for x, y in cl],
                        "opposite": [[round(x, 4), round(y, 4)] for x, y in op]})
        if not forms.alert("Add another street?", title="SBD Export", yes=True, no=True):
            break
# Axis 1 (Projection Plane X): along the street fronting the site the longest
if streets:
    street_axis = SE.frontage_axis(streets, site) or [streets[0]["centreline"][0], streets[0]["centreline"][-1]]

# 4. the zones' ground (Level 0) - not asked: the viewer takes the mean
# level of each street and uses the lowest street abutting the site (B(P)R
# Level Zero). Without streets, the masses' base.
mass_base = min(v[2] for m in masses for v in m["mesh"].verts) if masses else None
street_level = SE.mean_level([f for f, st in made], site) if made else None
if street_level is not None:
    ground, ground_source = street_level, "the street slabs"
elif mass_base is not None:
    ground, ground_source = mass_base, "the masses' base"
else:
    ground, ground_source = 0.0, "0.00"

# 5. the project on the viewer, then send
settings = L.load_settings()
client = L.Client(settings.get("server", ""), settings.get("token", ""))
try:
    projects = client.projects()
except Exception as ex:
    forms.alert("Cannot reach the viewer server: %s\n\nSign in with LWK Issues first." % ex, title="SBD Export")
    script.exit()
want = (settings.get("doc_projects") or {}).get(doc.Title)
labels = ["%s - %s" % (p["id"], p.get("name") or "") for p in projects]
pre = [x for x in labels if want and x.startswith(want + " - ")]
lab = pre[0] if pre else forms.SelectFromList.show(labels, title="SBD Export - which viewer project", button_name="Send")
if not lab:
    script.exit()
pid = projects[labels.index(lab)]["id"]

me = ""
try:
    me = client.me().get("user", {}).get("name", "")
except Exception:
    pass
data = SE.build(site, masses, ground, street_axis, streets, project=pid, model=doc.Title, by=me,
                at=time.strftime("%Y-%m-%dT%H:%M:%S"), ground_source=ground_source)
# a copy beside the model's temp files, to send to a colleague if needed
keep = os.path.join(os.environ.get("TEMP", os.path.expanduser("~")), "sbd-%s.json" % pid)
try:
    jsonio.write_atomic(keep, data)
except Exception:
    keep = ""
try:
    r = client._request("POST", "/api/sbd/model", data, project=pid)
except Exception as ex:
    forms.alert("Not sent: %s" % ex, title="SBD Export")
    script.exit()

out.print_md("## SBD Export")
out.print_md("**%d mass(es)**, site boundary of %d points, zones from %.2f m (%s), %d street(s) - sent to **%s**." %
             (len(masses), len(site), ground, ground_source, len(streets), pid))
for st in streets:
    if "length_m" in st:
        out.print_md("- Street **%s**: %.1f m long, %.1f m wide, level %.2f m" % (st["name"], st["length_m"], st["width_m"], st["level"]))
cp, rp = r.get("controlling_p"), r.get("required_p")
out.print_md("Controlling P: **%s** %%   Required: **%s** %%   %s" % (
    "-" if cp is None else "%.2f" % cp, "-" if rp is None else "%.0f" % rp,
    "" if r.get("pass") is None else ("PASS" if r["pass"] else "**FAIL**")))
for w in r.get("warnings") or []:
    out.print_md("- %s" % w)
out.print_md("Open the model's **3D** page on the viewer > **Checks > SBD** for the zones, gaps and corridors.")
if keep:
    out.print_md("A copy of what was sent: `%s`" % keep)
