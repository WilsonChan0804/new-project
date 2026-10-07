# -*- coding: utf-8 -*-
"""MyTools.extension start-up.

LWK Viewer nightly export: does nothing unless the nightly scheduled task
started this Revit. If this extension already had a startup.py, keep it and
add the lines below the marker to the end of it instead.
"""
# ---- LWK Viewer nightly export ------------------------------------------
import os as _os
import sys as _sys
# the extension's lib: next to this file, one folder up (when this runs
# from a combined LWK.extension's startups folder), or on pyRevit's path -
# whichever holds lwk_viewer
_cands = []
try:
    _here = _os.path.dirname(_os.path.abspath(__file__))
    _cands += [_os.path.join(_here, "lib"), _os.path.join(_os.path.dirname(_here), "lib")]
except NameError:
    pass
_cands += [p for p in _sys.path if p and _os.path.basename(p.rstrip("\\/")).lower() == "lib"]
_lib = next((p for p in _cands if _os.path.isdir(_os.path.join(p, "lwk_viewer"))), "")
if _lib and _lib not in _sys.path:
    _sys.path.insert(0, _lib)
try:
    from lwk_viewer import nightly as _nightly
    try:
        from pyrevit import HOST_APP as _host
        _uiapp = _host.uiapp or __revit__
    except Exception:
        _uiapp = __revit__
    _nightly.on_revit_start(_uiapp)
except Exception as _ex:
    try:
        from lwk_viewer import nightly as _n
        _n.NightLog()("start-up hook failed: %s" % _ex)
    except Exception:
        pass
# -------------------------------------------------------------------------
