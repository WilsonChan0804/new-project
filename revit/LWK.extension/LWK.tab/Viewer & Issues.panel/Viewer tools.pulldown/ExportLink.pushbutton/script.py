# -*- coding: utf-8 -*-
"""Export the model open now as one linked model of a project, for the
master model's export to pick up.

For a linked model the automatic export cannot open itself - above all a
cloud model saved in an older Revit version, which Revit only upgrades when
a person opens it. Open that link here, click this, choose the project; the
next Run Export of the master model uses this file instead of exporting the
link again (for 14 days, or until this is run again).

Typical floors made of copied groups are exported once each, as in the
automatic export (see groups.py).

A big model can be exported in parts, in several Revit windows at once:
Revit's IFC export uses one processor core, so three windows export about
three times as fast. Open the same model in each window, click this in
each, and choose part 1, 2, 3 ... of the same count."""
__title__ = "Export\nLink"
__doc__ = ("Export the model open now as a linked model of a registered project "
           "(for links the automatic export cannot open, e.g. older-version cloud models).")

import os
import sys
import time

from pyrevit import revit, forms, script, HOST_APP


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

from lwk_viewer import batch, exporters
from lwk_viewer import groups as GROUPS
from lwk_viewer.probe import Probe

doc = revit.doc
out = script.get_output()


def choose_folder():
    jobs = [j for j in batch.load_jobs() if j.get("folder")]
    names = ["%s  ->  %s" % (j.get("title"), j["folder"]) for j in jobs]
    names.append("Choose a folder ...")
    pick = forms.CommandSwitchWindow.show(
        names, message="Which project is '%s' a link of? (its export folder)" % doc.Title)
    if not pick:
        return None, None
    if pick == names[-1]:
        f = forms.pick_folder(title="The project's export folder (the one with manifest.json)")
        return f, None
    job = jobs[names.index(pick)]
    return job["folder"], job


PART_CHOICES = ["Whole model in this window"] + [
    "Part %d of %d  (open the model in %d Revit windows)" % (k, n, n)
    for n in (2, 3, 4) for k in range(1, n + 1)]


def choose_part():
    pick = forms.CommandSwitchWindow.show(
        PART_CHOICES,
        message="Split the export over several Revit windows? Revit exports on one "
                "processor core; 3 windows on the same model export about 3x faster.")
    if not pick:
        return None
    if pick == PART_CHOICES[0]:
        return (1, 1)
    bits = pick.split()
    return (int(bits[1]), int(bits[3]))


def main():
    if doc.IsFamilyDocument:
        forms.alert("Open the linked model (a project), not a family.", exitscript=True)
    folder, job = choose_folder()
    if not folder:
        return
    part = choose_part()
    if not part:
        return
    part, parts = part
    links_dir = os.path.join(folder, "links")
    stem = exporters.link_stem(doc.Title)
    job = job or {}
    schema = job.get("schema", "IFC2x3")
    exporters.LIGHT["on"] = (job.get("ifc_detail") or "light") != "full"
    groups = job.get("ifc_exclude")
    exporters.EXCLUDE["groups"] = list(exporters.DEFAULT_EXCLUDE if groups is None else groups)
    share = job.get("group_share", True) is not False

    probe = Probe(echo=out.print_md)
    # each window its own log, so parts running side by side do not mix
    log = batch.live(probe, folder, "export-progress-link.txt" if parts == 1
                     else "export-progress-link-part%d.txt" % part)
    awake = batch.keep_awake(True)
    t0 = time.time()
    try:
        with batch.DialogLog(HOST_APP.uiapp, probe):
            probe.info("link", "exporting '%s' as a link of %s (%s, groups %s%s)"
                       % (doc.Title, folder, schema, "shared" if share else "exported in full",
                          (", part %d of %d" % (part, parts)) if parts > 1 else ""))
            fn = lambda f, s, prep: exporters._export_open_document(doc, f, s, probe, schema, prep)
            if parts > 1:
                done, msg = GROUPS.export_part(doc, links_dir, stem, probe, fn, part, parts, share)
                probe.info("parts", "'%s': %s" % (stem, msg))
                if done:
                    out.print_md("**All %d parts done.** Now run the master model's export: "
                                 "it will use them." % parts)
                else:
                    out.print_md("**Part %d done** - %s. When the other window(s) finish, "
                                 "the last one joins the parts." % (part, msg))
                return
            if share:
                path, recs = GROUPS.export_shared(doc, links_dir, stem, probe, fn)
            else:
                path, recs = fn(links_dir, stem, None), []
        if path:
            exporters._mark_done(path, "own", recs, manual=True)
            probe.info("link", "done in %.1f min: %s%s" % (
                (time.time() - t0) / 60.0, os.path.basename(path),
                (" + %d group file(s)" % len(recs)) if recs else ""))
            out.print_md("**Done.** Now open the master model and run the export "
                         "(Shift-click Run Export if the master is open): it will use this file.")
        else:
            probe.error("link", "no IFC was written")
    except Exception as ex:
        probe.error("link", "failed: %s" % ex)
    finally:
        log.stop()
        if awake:
            batch.keep_awake(False)


main()
