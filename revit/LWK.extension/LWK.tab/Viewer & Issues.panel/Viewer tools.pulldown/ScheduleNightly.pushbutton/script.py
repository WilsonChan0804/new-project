# -*- coding: utf-8 -*-
"""Schedule the auto-export to run by itself at night."""
__title__ = "Night\nExport"
__doc__ = ("Run Auto-export every night (or weeknights) without anyone at the PC: "
           "Windows starts Revit - each Revit version that has a model, one after another - "
           "every registered model is exported, Revit closes.")

import os
import sys
import re
from pyrevit import forms, script

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

from lwk_viewer import nightly, batch

out = script.get_output()


def versions_text(jobs):
    """'Revit 2023 (1 model), then Revit 2024 (2 models)' - what the
    launcher starts, in its order."""
    p = nightly.plan(jobs, nightly.schedule_year() or nightly.revit_year(), nightly.local_index())
    return ", then ".join("Revit %s (%d model%s)" % (y, len(p[y]), "" if len(p[y]) == 1 else "s")
                          for y in sorted(k for k in p if k))


def show_logs():
    exists, st = nightly.status()
    out.print_md("### Nightly export")
    out.print_md("**%s**" % ("Scheduled" if exists else "Not scheduled"))
    for line in st.splitlines():
        out.print_md("- %s" % line)
    out.print_md("- Launcher: `%s`%s" % (nightly.BAT, "" if nightly.bat_is_current() or not os.path.isfile(nightly.BAT)
                                         else " - **an older kind: choose a schedule again to renew it**"))
    out.print_md("- It starts: %s" % (versions_text(batch.load_jobs()) or "nothing (no model has its night export on)"))
    out.print_md("- Logs: `%s` (one file per night, plus scheduler.log)" % nightly.LOG_DIR)
    for line in nightly.log_tail(6):
        out.print_md("  - `%s`" % line)
    if os.path.isdir(nightly.LOG_DIR):
        logs = sorted(f for f in os.listdir(nightly.LOG_DIR) if f.endswith(".log"))
        for f in logs[-5:]:
            out.print_md("  - %s" % f)


def main():
    jobs = [j for j in batch.load_jobs() if j.get("enabled", True)]
    exists, _ = nightly.status()
    choice = forms.CommandSwitchWindow.show(
        ["Every night", "Weeknights (Mon-Fri)", "Remove the schedule", "Status and logs"],
        message="Nightly export is %s. %d model(s) registered for export."
                % ("ON" if exists else "OFF", len(jobs)))
    if not choice:
        return
    if choice == "Status and logs":
        show_logs()
        return
    if choice == "Remove the schedule":
        ok, msg = nightly.unschedule()
        out.print_md("**%s** %s" % ("Removed." if ok else "Could not remove:", msg))
        return

    if not jobs:
        forms.alert("No models are registered yet. Open each model from ACC and use "
                    "Add to Auto-export first, then schedule.", exitscript=True)
    t = forms.ask_for_string(default="01:00", title="Nightly export",
                             prompt="Start time, 24-hour (HH:MM). Allow about 15 minutes per model:")
    if not t:
        return
    t = t.strip()
    if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", t):
        forms.alert("Please give the time as HH:MM, for example 01:00.", exitscript=True)
    ok, msg = nightly.schedule(t, weekdays_only=choice.startswith("Week"))
    if not ok:
        out.print_md("**Could not create the scheduled task.** Windows said:")
        out.print_md("```\n%s\n```" % msg)
        return
    out.print_md("### Nightly export scheduled: %s at %s" % (choice.lower(), t))
    out.print_md("%d model(s) will be exported: %s"
                 % (len(jobs), ", ".join(j.get("title", "?") for j in jobs)))
    out.print_md("The launcher starts %s - one after the other." % (versions_text(batch.load_jobs()) or "nothing yet"))
    out.print_md("**Before the first night**")
    out.print_md("- Leave the PC switched on and yourself logged in to Windows "
                 "(locking the screen is fine). The task asks Windows to wake the PC.")
    out.print_md("- Leave Revit **closed**. A Revit version that is open at that time is "
                 "skipped (its models are not exported that night), so open work is never "
                 "disturbed; the other versions still run.")
    out.print_md("- Revit must stay signed in to Autodesk, and pyRevit must be attached to "
                 "every Revit version used.")
    out.print_md("**To check and test it:** open **Auto Publish** on the LWK tab - *Check setup* lists "
                 "what is wrong, *Test night run* does the real thing now. (Or close Revit and "
                 "double-click `%s`.) The logs are in `%s`."
                 % (nightly.BAT, nightly.LOG_DIR))


main()
