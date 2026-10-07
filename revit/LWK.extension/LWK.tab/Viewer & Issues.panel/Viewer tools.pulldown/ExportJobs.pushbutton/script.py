# -*- coding: utf-8 -*-
"""Review and change the export jobs on this PC (Publish and Add Model
register them; the night export runs the enabled ones)."""
__title__ = "Export\nJobs"

import os
import sys
import io
from pyrevit import forms, script


def _extension_root(start):
    node = os.path.dirname(start)
    while not node.lower().endswith(".extension"):
        parent = os.path.dirname(node)
        if parent == node:
            return None
        node = parent
    return node


EXT_ROOT = _extension_root(__file__)
LIB = os.path.join(EXT_ROOT, "lib") if EXT_ROOT else None
if LIB and os.path.isdir(LIB):
    while LIB in sys.path:
        sys.path.remove(LIB)
    sys.path.insert(0, LIB)
for _m in [k for k in list(sys.modules) if k == "lwk_viewer" or k.startswith("lwk_viewer.")]:
    del sys.modules[_m]

from lwk_viewer import batch, nightly

out = script.get_output()


def last_run(job):
    """(when, errors, warnings, last lines) from the job's export-log.txt."""
    p = os.path.join(job.get("folder") or "", "export-log.txt")
    if not os.path.isfile(p):
        return None
    try:
        with io.open(p, encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
    except Exception:
        return None
    fin = [l for l in lines if l.startswith("finished")]
    errs = [l for l in lines if l.startswith("error")]
    warns = [l for l in lines if l.startswith("warn")]
    return (fin[0][8:].strip() if fin else "?", errs, warns, lines[-6:])


def report(jobs):
    exists, st = nightly.status()
    out.print_md("## Export jobs on this PC")
    out.print_md("Night export: **%s**%s" % ("scheduled" if exists else "not scheduled",
                                             "  \n" + st.replace("\n", "  \n") if exists else ""))
    if not jobs:
        out.print_md("No models registered. Use **Publish** (or Add Model) in the model first.")
        return
    for i, j in enumerate(jobs):
        s = batch.job_summary(j)
        out.print_md("### %d. %s" % (i + 1, j.get("title") or "?"))
        out.print_md("- Night export: **%s**" % ("on" if j.get("enabled") else "off"))
        out.print_md("- Sheets: %s" % s["sheets"])
        out.print_md("- 3D model: %s" % s["model_3d"])
        out.print_md("- Viewer project: `%s`%s" % (s["server_project"],
                     " (adds its sheets to it)" if s["adds_to_project"] else ""))
        out.print_md("- Export folder: `%s`" % (j.get("folder") or ""))
        out.print_md("- ACC model: %s" % ("yes" if j.get("model") else "no (cannot run at night)"))
        if j.get("model"):
            out.print_md("- Revit version: %s" % (("**%s**" % j["revit"]) if j.get("revit") else
                                                  "not recorded - Revit %s is tried" % (s.get("revit") or "?")))
        lr = last_run(j)
        if lr:
            when, errs, warns, tail = lr
            out.print_md("- Last run: %s - %d error(s), %d warning(s)" % (when, len(errs), len(warns)))
            for e in errs[:5]:
                out.print_md("    - %s" % e)
        else:
            out.print_md("- Last run: none on record")


def edit(jobs, j):
    while True:
        s = batch.job_summary(j)
        opts = [
            "Night export: %s -> turn %s" % ("ON" if j.get("enabled") else "OFF", "off" if j.get("enabled") else "on"),
            "Sheets: %s -> change" % s["sheets"],
            "3D model: %s -> change" % s["model_3d"],
            "Revit version: %s -> change" % (j.get("revit") or "not recorded"),
            "Open the export folder",
            "Open the last log",
            "Remove this job",
            "Done",
        ]
        c = forms.CommandSwitchWindow.show(opts, message=j.get("title") or "?")
        if not c or c == "Done":
            return
        if c.startswith("Night export"):
            j["enabled"] = not j.get("enabled")
            if j["enabled"] and not j.get("model"):
                forms.alert("This model is not on ACC, so it cannot be opened at night. "
                            "It stays registered for Publish.")
                j["enabled"] = False
        elif c.startswith("Sheets"):
            k = forms.CommandSwitchWindow.show(["All sheets", "A Revit sheet set (by name)", "No sheets"],
                                               message="Sheets for %s" % j.get("title"))
            if k == "All sheets":
                j["publish_sheets"] = True
                j["sheet_mode"] = "all"
            elif k and k.startswith("A Revit"):
                name = forms.ask_for_string(default=j.get("sheet_set") or "",
                                            prompt="Name of the Revit sheet set (View/Sheet Set, as in Print):",
                                            title="Sheet set")
                if name:
                    j["publish_sheets"] = True
                    j["sheet_mode"] = "set"
                    j["sheet_set"] = name.strip()
            elif k == "No sheets":
                j["publish_sheets"] = False
        elif c.startswith("3D model"):
            k = forms.CommandSwitchWindow.show(["Coarse (lightest)", "Medium (recommended)", "Fine (most detail)",
                                                "No 3D model"], message="3D model for %s" % j.get("title"))
            if k == "No 3D model":
                j["publish_3d"] = False
            elif k:
                j["publish_3d"] = True
                j["model_format"] = "lwkm"
                j["fast3d_detail"] = k.split(" ")[0].lower()
        elif c.startswith("Revit version"):
            # the Revit that publishes it at night: a cloud model opens only
            # in the version it is saved in
            years = sorted(nightly.installed_revits())
            k = forms.CommandSwitchWindow.show(["Revit %s" % y for y in years],
                                               message="Which Revit version is %s saved in?" % j.get("title")) \
                if years else None
            if k:
                j["revit"] = k.split(" ")[1]
        elif c.startswith("Open the export folder"):
            if os.path.isdir(j.get("folder") or ""):
                os.startfile(j["folder"])
            continue
        elif c.startswith("Open the last log"):
            p = os.path.join(j.get("folder") or "", "export-log.txt")
            if os.path.isfile(p):
                os.startfile(p)
            else:
                forms.alert("No log yet in %s" % (j.get("folder") or "?"))
            continue
        elif c.startswith("Remove"):
            if forms.alert("Remove '%s' from the export jobs? Nothing on the server is deleted."
                           % j.get("title"), yes=True, no=True):
                jobs.remove(j)
                batch.save_jobs(jobs)
                return
            continue
        batch.save_jobs(jobs)


def main():
    jobs = batch.load_jobs()
    report(jobs)
    while jobs:
        names = ["%s  [%s]" % (j.get("title") or "?", "night ON" if j.get("enabled") else "night off") for j in jobs]
        pick = forms.SelectFromList.show(names, title="Export jobs - pick one to change (Cancel to finish)",
                                         multiselect=False, button_name="Change")
        if not pick:
            break
        edit(jobs, jobs[names.index(pick)])
    report(batch.load_jobs())


main()
