# -*- coding: utf-8 -*-
"""Quick test of the one unproven step: exporting a repeated link on its own.

Does only that - no host IFC, no PDFs, no conversion - so the answer comes
in minutes instead of the half hour a full run takes. The link's load
status is restored afterwards, as in the real run.
"""
__title__ = "Test\nLinks"
__doc__ = "Try exporting each repeated link (a typical floor) on its own. Minutes, not half an hour."

import os
import sys
import time
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

from lwk_viewer import exporters, batch
from lwk_viewer.probe import Probe

out = script.get_output()
doc = revit.doc


def main():
    probe = Probe(echo=out.print_md)
    out.print_md("### Test: exporting repeated links on their own")
    out.print_md("- exporters.py %s (%s)" % (getattr(exporters, "__version__", "?"),
                                            exporters.__file__))
    groups = exporters._repeated_links(doc)
    if not groups:
        out.print_md("No linked model is placed more than once in this model.")
        return

    folder = os.path.join(os.environ.get("TEMP", "C:\\Temp"), "lwk_linktest")
    # Exactly the conditions of the real run - the same warning handling -
    # so a pass here means the real run will pass. The first version of this
    # test left it out, passed, and the real run then failed on it.
    with batch.DialogLog(HOST_APP.uiapp, probe):
        run_groups(groups, folder, probe)

    c = probe.counts()
    out.print_md("---")
    out.print_md("**%s** - %d warnings, %d errors. Check Manage Links: every link "
                 "should still be Loaded." % ("Works" if not c["error"] else "Problem",
                                              c["warn"], c["error"]))


def run_groups(groups, folder, probe):
    for g in groups:
        ld = g["doc"]
        title = ld.Title
        out.print_md("#### %s - placed %d times" % (title, len(g["instances"])))
        started = time.time()
        mp = exporters.cloud_or_file_path(ld, probe)
        out.print_md("- path found: **%s**" % ("yes" if mp is not None else "NO"))
        link_type = doc.GetElement(g["instances"][0].GetTypeId())
        stem = "".join(c if c.isalnum() or c in "-_" else "_" for c in title)[:60]
        path = exporters.export_link_by_opening(doc, link_type, mp, folder, stem,
                                                probe, "IFC2x3")
        out.print_md("- result: **%s** in %.0f s" % (
            ("exported, %.1f MB" % (os.path.getsize(path) / 1048576.0)) if path else "FAILED",
            time.time() - started))



main()
