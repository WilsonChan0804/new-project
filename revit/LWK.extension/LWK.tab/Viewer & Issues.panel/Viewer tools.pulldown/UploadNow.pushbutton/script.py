# -*- coding: utf-8 -*-
"""Upload an export to the LWK Viewer server now - only the files that
changed. The nightly export does this by itself; this is for a manual
export, or to send one again."""
__title__ = "Upload\nNow"
__author__ = "LWK BIM"

import os
import sys

from pyrevit import forms, script

# This extension's own lib first, so an older lwk_viewer in another
# extension can never be the one imported.
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
from lwk_viewer import issues as LI
from lwk_viewer import batch

out = script.get_output()
server, token = LI.upload_settings()
if not (server and token):
    forms.alert("Sign in once in LWK Issues first - the upload uses the same sign-in.",
                title="Upload now")
    script.exit()

jobs = [j for j in batch.load_jobs() if j.get("folder")]
choices = ["%s  ->  %s" % (j.get("title") or "?", os.path.basename(os.path.normpath(j["folder"])))
           for j in jobs] + ["Another export folder ..."]
pick = forms.SelectFromList.show(choices, title="Upload which export?", button_name="Upload")
if not pick:
    script.exit()
if pick == choices[-1]:
    folder = forms.pick_folder(title="The export folder (with manifest.json)")
    if not folder:
        script.exit()
    project = os.path.basename(os.path.normpath(folder))
else:
    j = jobs[choices.index(pick)]
    folder = j["folder"]
    project = j.get("upload_project") or os.path.basename(os.path.normpath(folder))

project = forms.ask_for_string(default=project, prompt="Project name on the server:",
                               title="Upload now") or ""
if not project:
    script.exit()

out.print_md("### Uploading **%s** to %s" % (project, server))
try:
    res = LI.upload_export(LI.Client(server, token), folder, project, out.print_md)
    out.print_md("**Done.** Open %s/index.html?project=%s" % (server, project))
except LI.ServerError as ex:
    out.print_md("**Upload failed:** %s" % ex)
    if ex.status == 401:
        out.print_md("Your sign-in has expired - sign in again in LWK Issues.")
    elif ex.status == 403:
        out.print_md("You need to be a Publisher or project admin of this project (or a site admin for a new one).")
