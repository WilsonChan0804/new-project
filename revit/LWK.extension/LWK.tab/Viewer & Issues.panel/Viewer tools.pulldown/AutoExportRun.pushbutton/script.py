# -*- coding: utf-8 -*-
"""Export every registered ACC model to the viewer, one after another."""
__title__ = "Run\nExport"
__doc__ = ("Open each registered ACC model, export merged IFC, sheet PDFs "
           "and manifest, convert for the viewer, close. Shift-click to test on "
           "the model that is open now, without opening anything.")

import os
import sys
import datetime
from pyrevit import revit, forms, script, HOST_APP

def _extension_root(start):
    node = os.path.dirname(start)
    while not node.lower().endswith(".extension"):
        parent = os.path.dirname(node)
        if parent == node:          # reached the drive root
            return None
        node = parent
    return node


EXT_ROOT = _extension_root(__file__)
if EXT_ROOT:
    LIB = os.path.join(EXT_ROOT, "lib")
    if os.path.isdir(LIB) and LIB not in sys.path:
        sys.path.insert(0, LIB)

# pyRevit adds EVERY extension's lib folder to sys.path. If another
# extension also carries a lwk_viewer package - an older copy of this one -
# whichever comes first wins, silently. This button always uses the copy
# that sits beside it: its own lib goes first, and any lwk_viewer already
# imported this session is dropped so it is loaded again from here.
if os.path.isdir(LIB):
    while LIB in sys.path:
        sys.path.remove(LIB)
    sys.path.insert(0, LIB)
for _m in [k for k in list(sys.modules) if k == "lwk_viewer" or k.startswith("lwk_viewer.")]:
    del sys.modules[_m]

from lwk_viewer import batch, manifest, exporters, geom, nightly, jsonio
from lwk_viewer.probe import Probe

out = script.get_output()
uiapp = HOST_APP.uiapp
app = uiapp.Application


def run_one(job, doc=None):
    # The routine itself is in the library, shared with the nightly run.
    # A full run opens models itself and is usually left to run: known
    # dialogs are answered. The Shift test uses the open model and opens
    # nothing, so there is nothing to answer.
    return batch.run_job(uiapp, job, out.print_md, doc=doc, unattended=doc is None)


def show_versions():
    """Say exactly which files are running, and stop if any of them is not
    this extension's own copy (an older lwk_viewer in another extension
    once ran instead, and nothing on screen said so). The versions differ
    from file to file - each carries the date it last changed."""
    stale = False
    from lwk_viewer import groups
    for mod in (exporters, batch, manifest, geom, nightly, jsonio, groups):
        v = getattr(mod, "__version__", "none")
        path = getattr(mod, "__file__", "?")
        here = os.path.normcase(os.path.abspath(path)).startswith(os.path.normcase(os.path.abspath(LIB)))
        flag = "" if here else "  **<- NOT this extension's copy**"
        stale = stale or bool(flag)
        out.print_md("- %s  (version %s)%s" % (path, v, flag))
    if stale:
        out.print_md("**Stopped: a copy of the tool from another folder is being loaded. Remove the other "
                     "LWK extension folder, restart Revit, try again.**")
    return not stale


def main():
    out.print_md("### Files in use")
    if not show_versions():
        return
    # Shift-click: test the whole export on the model already open, so the
    # first try is quick and changes nothing about any other model.
    if __shiftclick__:
        doc = revit.doc
        ids = batch.cloud_ids(doc) or {}
        job = next((j for j in batch.load_jobs() if j.get("model") == ids.get("model")), None)
        if not job:
            folder = forms.pick_folder(title="Test export: destination folder")
            if not folder:
                return
            job = {"title": doc.Title, "folder": folder, "schema": "IFC2x3",
                   "sheet_prefix": "", "tools": batch.DEFAULT_TOOLS}
        out.print_md("## Test export of the open model: %s" % doc.Title)
        ok, c = run_one(job, doc=doc)
        out.print_md("**%s** - %d warnings, %d errors. Log: `%s`"
                     % ("Done" if ok else "Failed", c["warn"], c["error"],
                        os.path.join(job["folder"], "export-log.txt")))
        return

    # A cloud model opens only in the Revit version it is saved in, so this
    # run takes the models of THIS Revit (and those that do not say their
    # version, as before); the others are named and left alone.
    here = nightly.revit_year(uiapp)
    jobs, left = [], []
    for j in batch.load_jobs():
        if not j.get("enabled", True):
            continue
        year = nightly.job_year(j, here, nightly.local_index())[0]
        if year == here or not year or not j.get("model"):
            jobs.append(j)
        else:
            left.append((j, year))
    for j, year in left:
        out.print_md("- **%s** belongs to Revit %s - not exported from this Revit %s (run this button in Revit %s, "
                     "or let the night export do it)" % (j.get("title"), year, here, year))
    if not jobs:
        forms.alert("No models registered for this Revit yet. Open a model from ACC and use "
                    "Add to Auto-export first.", exitscript=True)
    if not forms.alert("Export %d model(s) now? Each is opened from ACC, "
                       "exported and closed without syncing. This can take hours; "
                       "Revit is busy until it finishes." % len(jobs),
                       yes=True, no=True):
        return

    summary = []
    for i, job in enumerate(jobs):
        out.print_md("## %d of %d: %s" % (i + 1, len(jobs), job["title"]))
        ok, c = run_one(job)
        summary.append((job["title"], ok, c))

    out.print_md("## Auto-export finished")
    for title, ok, c in summary:
        out.print_md("- %s **%s** - %d warnings, %d errors"
                     % (title, "OK" if ok else "FAILED", c["warn"], c["error"]))


main()
