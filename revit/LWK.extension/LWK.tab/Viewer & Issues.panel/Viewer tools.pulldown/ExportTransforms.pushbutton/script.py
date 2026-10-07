# -*- coding: utf-8 -*-
"""Write every linked model's placement transform to transforms.json.

This reads the master file and nothing else. No export, no transaction, no
document is opened or modified, so it finishes in seconds.

Why it is needed. The links in this project are placed with Shared Site set
to <Not Shared>, meaning each link file models its content near its own
origin and the master file holds the real position in the link instance
transform. Exporting a link to IFC therefore produces geometry at Z = 0:
correct in its own terms, and flat when several floors are viewed together.
The missing half of the information lives here.
"""

__title__ = "Link\nPlaces"
__author__ = "Wilson Chan"

import os
import sys
import json
import datetime

from pyrevit import revit, forms, script

out = script.get_output()

EXT_ROOT = None
_node = os.path.dirname(__file__)
while True:
    if _node.lower().endswith(".extension"):
        EXT_ROOT = _node
        break
    _parent = os.path.dirname(_node)
    if _parent == _node:
        break
    _node = _parent
if EXT_ROOT:
    _lib = os.path.join(EXT_ROOT, "lib")
    if os.path.isdir(_lib) and _lib not in sys.path:
        sys.path.insert(0, _lib)

from Autodesk.Revit.DB import FilteredElementCollector, RevitLinkInstance

FT_MM = 304.8
doc = revit.doc


def xform(t):
    """A Revit Transform as plain numbers.

    host_mm = origin + x * basis_x + y * basis_y + z * basis_z

    Origin is in millimetres; the basis vectors are unitless, so a rotated
    or mirrored link survives the trip intact rather than being reduced to
    an offset.
    """
    o, bx, by, bz = t.Origin, t.BasisX, t.BasisY, t.BasisZ
    return {
        "origin": [o.X * FT_MM, o.Y * FT_MM, o.Z * FT_MM],
        "basis_x": [bx.X, bx.Y, bx.Z],
        "basis_y": [by.X, by.Y, by.Z],
        "basis_z": [bz.X, bz.Y, bz.Z],
    }


def is_identity(x):
    """Flag placements that carry no position. If every link reports this,
    the position is not in the master file either and the problem is
    somewhere else entirely."""
    o = x["origin"]
    if max(abs(v) for v in o) > 1.0:          # more than a millimetre
        return False
    ident = ([1, 0, 0], [0, 1, 0], [0, 0, 1])
    for key, ref in zip(("basis_x", "basis_y", "basis_z"), ident):
        for a, b in zip(x[key], ref):
            if abs(a - b) > 1e-9:
                return False
    return True


def main():
    if doc.IsFamilyDocument:
        forms.alert("Run this in the master project.", exitscript=True)

    instances = list(FilteredElementCollector(doc)
                     .OfClass(RevitLinkInstance))
    if not instances:
        forms.alert("This document has no linked models.", exitscript=True)

    folder = forms.pick_folder(
        title="Export folder (the one holding manifest.json)")
    if not folder:
        return

    by_doc = {}
    unloaded = []

    for li in instances:
        try:
            ld = li.GetLinkDocument()
        except Exception:
            ld = None

        # An unloaded link still has a type name, which is enough to report
        # it as missing rather than silently dropping it.
        if ld is None:
            unloaded.append(li.Name)
            continue

        title = ld.Title
        rec = by_doc.setdefault(title, {"name": title, "instances": []})
        try:
            x = xform(li.GetTotalTransform())
        except Exception as ex:
            out.print_md("- could not read transform for `%s`: %s"
                         % (li.Name, ex))
            continue

        rec["instances"].append({
            "instance_id": li.Id.IntegerValue,
            "name": li.Name,
            "identity": is_identity(x),
            "transform": x,
        })

    models = sorted(by_doc.values(), key=lambda m: m["name"])
    data = {
        "schema": "lwk.viewer.transforms/1",
        "exported_at": datetime.datetime.utcnow().isoformat() + "Z",
        "units": {"origin": "mm"},
        "source": {"title": doc.Title, "path": doc.PathName},
        "models": models,
        "unloaded_links": unloaded,
    }

    path = os.path.join(folder, "transforms.json")
    from lwk_viewer import jsonio
    jsonio.write_atomic(path, data)

    total = sum(len(m["instances"]) for m in models)
    ident = sum(1 for m in models for i in m["instances"] if i["identity"])

    out.print_md("### Transforms exported")
    out.print_md("- %d link document(s), %d instance(s)" % (len(models), total))
    out.print_md("- written to `%s`" % path)
    if unloaded:
        out.print_md("- **%d unloaded link(s) skipped:** %s"
                     % (len(unloaded), ", ".join(unloaded[:6])))

    if ident == total:
        out.print_md("- **Every transform is the identity.** The master file "
                     "is not where the position lives, so applying these "
                     "will change nothing. Tell Claude this result before "
                     "going further.")
    elif ident:
        out.print_md("- %d of %d instances have an identity transform; those "
                     "links sit at the model origin." % (ident, total))

    out.print_md("")
    out.print_md("| link | instances | first Z offset (m) |")
    out.print_md("|---|---|---|")
    for m in models:
        first = m["instances"][0]["transform"]["origin"][2] / 1000.0 \
            if m["instances"] else 0.0
        out.print_md("| %s | %d | %.2f |"
                     % (m["name"], len(m["instances"]), first))


main()
