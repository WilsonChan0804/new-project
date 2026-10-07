# -*- coding: utf-8 -*-
"""Fast 3D export of the model open now (fast3d.py): the 3D part of a
project's export, in the new .lwkm format, without IFC.

The sheets and everything else already in the project's manifest.json
are kept; only the 3D models are replaced. Choose to use it for the
project's automatic export too, and every Run Export from then on writes
this format instead of IFC."""
__title__ = "Fast\n3D Export"

import os
import sys
import io
import json
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

from lwk_viewer import batch, exporters, fast3d, jsonio, manifest
from lwk_viewer import issues as LI
from lwk_viewer.probe import Probe

doc = revit.doc
out = script.get_output()


def choose_job():
    jobs = [j for j in batch.load_jobs() if j.get("folder")]
    names = ["%s  ->  %s" % (j.get("title"), j["folder"]) for j in jobs]
    names.append("Choose a folder ...")
    pick = forms.CommandSwitchWindow.show(names, message="Which project's export is '%s'?" % doc.Title)
    if not pick:
        return None, None, jobs
    if pick == names[-1]:
        return forms.pick_folder(title="The project's export folder"), None, jobs
    j = jobs[names.index(pick)]
    return j["folder"], j, jobs


def main():
    if doc.IsFamilyDocument:
        forms.alert("Open the project model, not a family.", exitscript=True)
    folder, job, jobs = choose_job()
    if not folder:
        return
    job = job or {}
    detail = forms.CommandSwitchWindow.show(
        ["Medium detail (recommended)", "Coarse (lightest)", "Fine (most detail)"],
        message="How much detail in the 3D model?") or "Medium"
    detail = detail.split()[0].lower()
    groups = job.get("ifc_exclude")
    exporters.EXCLUDE["groups"] = list(exporters.DEFAULT_EXCLUDE if groups is None else groups)
    spec = exporters.exclude_spec()

    probe = Probe(echo=out.print_md)
    log = batch.live(probe, folder, "export-progress-fast3d.txt")
    awake = batch.keep_awake(True)
    try:
        with batch.DialogLog(HOST_APP.uiapp, probe):
            probe.info("fast3d", "'%s' -> %s (%s detail; left out: %s)"
                       % (doc.Title, folder, detail, ", ".join(spec["labels"]) or "nothing"))
            res = fast3d.export(doc, folder, probe, exclude_bics=spec["revit_bics"], detail=detail,
                                group_share=job.get("group_share", True) is not False,
                                props=job.get("fast3d_props", True) is not False)
        path = os.path.join(folder, "manifest.json")
        data = None
        try:
            with io.open(path, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = None
        if not data:
            data = manifest.build(doc, [], probe, with_elements=False)
        data["models"] = res["models"]
        data["lwk_frame"] = res["lwk_frame"]
        jsonio.write_atomic(path, data)
        out.print_md("**Done in %.1f min.** %d model(s) written to %s\\fragments."
                     % (res["minutes"], len(res["models"]), folder))
    except Exception as ex:
        probe.error("fast3d", "failed: %s" % ex)
        return
    finally:
        log.stop()
        if awake:
            batch.keep_awake(False)

    if job and job.get("model_format") != "lwkm":
        if forms.alert("Use the fast format for this project's automatic export too?\n\n"
                       "(Run Export and the nightly run will then write this instead of IFC. "
                       "Set \"model_format\" back to \"ifc\" in the job to undo.)",
                       yes=True, no=True):
            for j in jobs:
                if j.get("folder") == folder:
                    j["model_format"] = "lwkm"
            batch.save_jobs(jobs)
            out.print_md("The automatic export of this project now uses the fast format.")

    server, token = LI.upload_settings()
    if server and token and forms.alert("Upload the new 3D model to the viewer server now?", yes=True, no=True):
        project = job.get("upload_project") or os.path.basename(os.path.normpath(folder))
        try:
            res = LI.upload_export(LI.Client(server, token), folder, project, out.print_md)
            out.print_md("Uploaded to project **%s**." % project)
        except Exception as ex:
            out.print_md("Upload failed: %s" % ex)


main()
