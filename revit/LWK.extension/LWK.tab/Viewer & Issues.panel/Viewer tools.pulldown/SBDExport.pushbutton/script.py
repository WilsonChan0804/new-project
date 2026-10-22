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
# the slabs of one street (its type name) that touch are one street, its
# top faces merged - a sloped or split road is not rejected piece by piece
made, left = SE.streets_from_slabs(slabs, site)
for g, why in left:
    out.print_md("- Street slab **%s** (%s) is not a strip (two long sides, two ends) - left out; pick its lines instead." % (g["name"], why))
if made:
    # what each street was made of, so a slab left out shows here
    parts = lambda g: " (%d floor%s, %d top face%s)" % (g.get("floors", 1), "" if g.get("floors", 1) == 1 else "s",
                                                      g.get("faces", 1), "" if g.get("faces", 1) == 1 else "s")
    labels = ["%s - %.0f m long, %.1f m wide, level %.2f m%s" % (st["name"], st["length_m"], st["width_m"], st["level"], parts(f)) for f, st in made]
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
# a street slab that is not a strip: its lines picked instead, its name kept
to_pick = [g["name"] for g, why in left]
if to_pick:
    ask = "%s %s not a strip, so %s left out.\n\nPick %s centreline and opposite boundary now?" % (
        ", ".join(to_pick), "is" if len(to_pick) == 1 else "are", "it is" if len(to_pick) == 1 else "they are",
        "its" if len(to_pick) == 1 else "each one's")
    if forms.alert(ask, title="SBD Export", options=["Pick lines now", "Leave out"]) != "Pick lines now":
        to_pick = []
elif not streets and forms.alert("No street slabs used.\n\nModel each street as a Floor whose type name has Street, Road, Lane or Path in it "
                                 "(kerb to kerb) - or pick its centreline and the opposite boundary now?",
                                 title="SBD Export", options=["Pick lines now", "No street"]) == "Pick lines now":
    to_pick = [None]
if to_pick:
    while True:
        known = to_pick.pop(0) if to_pick and to_pick[0] else None
        lab = " of %s" % known if known else ""
        cl = SE.curves_polyline(pick_lines("Select the CENTRELINE%s, then Finish" % lab))
        if not cl or len(cl) < 2:
            break
        op = SE.curves_polyline(pick_lines("Select the OPPOSITE site boundary across%s, then Finish" % (" " + known if known else " the street"))) or []
        nm = known or forms.ask_for_string(default="Street %d" % (len(streets) + 1), prompt="Name of the street", title="SBD Export") or ""
        st = {"name": nm, "centreline": [[round(x, 4), round(y, 4)] for x, y in cl],
              "opposite": [[round(x, 4), round(y, 4)] for x, y in op]}
        slab = [g for g, why in left if g["name"] == known]
        if slab:                           # its slab still gives its level
            st["level"] = round(slab[0]["z"], 4)
            made.append((slab[0], st))
        streets.append(st)
        if to_pick and to_pick[0]:
            continue                       # the next street slab left out
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
labels, ids = SE.project_choices(projects, (settings.get("doc_projects") or {}).get(doc.Title))
# always asked: an SBD Export replaces the project's SBD model, so it never
# goes silently to the project LWK Issues last used with this file
lab = forms.SelectFromList.show(labels, title="SBD Export - which viewer project", button_name="Send")
if not lab:
    script.exit()
pid = ids[labels.index(lab)]
pname = [p.get("name") or "" for p in projects if p["id"] == pid][0]

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
    # a large model takes a while to upload: up to 5 minutes, not the usual 20 s
    r = client._request("POST", "/api/sbd/model", data, project=pid, timeout=300)
except Exception as ex:
    forms.alert("Not sent: %s%s" % (ex, "\n\nWhat would have been sent is kept in:\n" + keep if keep else ""), title="SBD Export")
    script.exit()
# the server answers at once and assesses in the background: wait for it
still = False
if r.get("running"):
    t0 = time.time()
    still = True
    with forms.ProgressBar(title="SBD Export - sent; the viewer is assessing the zones ...", cancellable=True) as pb:
        while time.time() - t0 < 300:
            if pb.cancelled:
                break
            pb.update_progress(min(95, int((time.time() - t0) / 3)), 100)
            time.sleep(3)
            try:
                g = client._request("GET", "/api/sbd", project=pid)
            except Exception:
                continue                    # a busy moment: ask again
            st = g.get("status") or {}
            if st.get("state") == "done":
                res = g.get("result") or {}
                r = {"controlling_p": res.get("controlling_p"), "required_p": res.get("required_p"),
                     "pass": res.get("pass"), "warnings": res.get("warnings")}
                still = False
                break
            if st.get("state") == "error":
                forms.alert("Sent, but the check failed on the server:\n\n%s" % st.get("detail", ""), title="SBD Export")
                script.exit()
# remembered for this file: listed first next time (and LWK Issues opens on it)
try:
    settings.setdefault("doc_projects", {})[doc.Title] = pid
    L.save_settings(settings)
except Exception:
    pass

out.print_md("## SBD Export")
out.print_md("**%d mass(es)**, site boundary of %d points, zones from %.2f m (%s), %d street(s) - sent to **%s%s**." %
             (len(masses), len(site), ground, ground_source, len(streets), pid, " - " + pname if pname else ""))
for st in streets:
    if "length_m" in st:
        out.print_md("- Street **%s**: %.1f m long, %.1f m wide, level %.2f m" % (st["name"], st["length_m"], st["width_m"], st["level"]))
if still:
    out.print_md("Sent - **still being assessed** on the viewer. Open the model's **3D** page > **Checks > SBD** in a minute for the result.")
cp, rp = r.get("controlling_p"), r.get("required_p")
if not still:
    out.print_md("Controlling P: **%s** %%   Required: **%s** %%   %s" % (
        "-" if cp is None else "%.2f" % cp, "-" if rp is None else "%.0f" % rp,
        "" if r.get("pass") is None else ("PASS" if r["pass"] else "**FAIL**")))
for w in r.get("warnings") or []:
    out.print_md("- %s" % w)
out.print_md("Open the model's **3D** page on the viewer > **Checks > SBD** for the zones, gaps and corridors.")
if keep:
    out.print_md("A copy of what was sent: `%s`" % keep)
