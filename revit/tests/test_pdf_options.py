# -*- coding: utf-8 -*-
"""Which PDF settings the sheets are exported with (exporters._build_options),
without Revit:  python3 -m unittest discover -s revit/tests -v
"""
import os
import sys
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "LWK.extension", "lib"))


class Opts(object):
    """PDFExportOptions: every property it has, set or not."""
    FIELDS = ("Combine", "FileName", "PaperFormat", "ZoomType", "ZoomPercentage", "PaperPlacement", "ColorDepth",
              "HideCropBoundaries", "HideScopeBoxes", "HideReferencePlane", "HideUnreferencedViewTags", "StopOnError",
              "AlwaysUseRaster", "RasterQuality", "MaskCoincidentLines", "ViewLinksInBlue", "ReplaceHalftoneWithThinLines")

    def __init__(self, **kw):
        for f in self.FIELDS:
            setattr(self, f, None)
        for k, v in kw.items():
            setattr(self, k, v)


class Enum(object):
    def __getattr__(self, name):
        return name


SAVED = {}


class Settings(object):
    def __init__(self, name, opts):
        self.Name, self._o = name, opts

    def GetOptions(self):
        return self._o

    @staticmethod
    def FindByName(doc, name):
        return SAVED.get(name)


STUBBED = ("Autodesk", "Autodesk.Revit", "Autodesk.Revit.DB", "System", "System.Collections", "System.Collections.Generic",
           "lwk_viewer.exporters", "lwk_viewer.groups", "lwk_viewer.compat")


def _install():
    """Stand-ins for the Revit API and .NET, just enough to import exporters.
    Any other name asked of them is a dummy class. Put back afterwards, so
    the tests that skip without Revit still skip."""
    saved = dict((k, sys.modules.get(k)) for k in STUBBED)
    for k in STUBBED[-3:]:
        sys.modules.pop(k, None)

    def mod(name, **attrs):
        m = types.ModuleType(name)
        m.__getattr__ = lambda n: type(n, (), {})
        for k, v in attrs.items():
            setattr(m, k, v)
        sys.modules[name] = m
        return m
    ad = mod("Autodesk"); rv = mod("Autodesk.Revit")
    db = mod("Autodesk.Revit.DB", PDFExportOptions=Opts, ExportPDFSettings=Settings)
    ad.Revit, rv.DB = rv, db
    for e in ("ExportPaperFormat", "ZoomType", "PaperPlacementType", "ColorDepthType", "RasterQualityType"):
        setattr(db, e, Enum())
    mod("System", Int64=int); mod("System.Collections"); mod("System.Collections.Generic")
    from lwk_viewer import exporters
    return saved, exporters


def _restore(saved):
    for k, v in saved.items():
        if v is None:
            sys.modules.pop(k, None)
        else:
            sys.modules[k] = v


class Probe(object):
    def __init__(self):
        self.lines = []

    def info(self, scope, msg):
        self.lines.append(("info", msg))

    def warn(self, scope, msg):
        self.lines.append(("warn", msg))

    error = warn


class PdfOptions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.saved, cls.E = _install()

    @classmethod
    def tearDownClass(cls):
        _restore(cls.saved)

    def setUp(self):
        exporters = self.E
        exporters._REPORTED.clear()
        exporters._SHOWN.clear()
        SAVED.clear()

    def forced(self, o):
        self.assertTrue(o.Combine)
        self.assertEqual(o.ZoomPercentage, 100)
        self.assertEqual(o.ZoomType, "Zoom")
        self.assertEqual(o.PaperPlacement, "Center")
        self.assertEqual(o.FileName, "A-101")

    def test_named_setup(self):
        team = Opts(MaskCoincidentLines=False, AlwaysUseRaster=True, ZoomPercentage=50, ColorDepth="BlackLine")
        SAVED["Team"] = Settings("Team", team)
        p = Probe()
        o = self.E._build_options(p, "A-101", doc=object(), setup="Team")
        self.assertIs(o, team)
        self.forced(o)
        self.assertTrue(o.AlwaysUseRaster)             # the setup's own choice is kept
        self.assertEqual(o.ColorDepth, "BlackLine")
        self.assertTrue(any("'Team'" in m for _, m in p.lines))

    def test_lwk_viewer_setup_when_none_named(self):
        mine = Opts()
        SAVED["LWK Viewer"] = Settings("LWK Viewer", mine)
        o = self.E._build_options(Probe(), "A-101", doc=object(), setup=None)
        self.assertIs(o, mine)
        self.forced(o)

    def test_dialog_defaults(self):
        p = Probe()
        o = self.E._build_options(p, "A-101", doc=object(), setup=None)
        self.forced(o)
        self.assertTrue(o.MaskCoincidentLines)
        self.assertFalse(o.AlwaysUseRaster)
        self.assertEqual(o.RasterQuality, "High")
        self.assertEqual(o.ColorDepth, "Color")
        self.assertTrue(any("Revit's Export PDF defaults" in m for _, m in p.lines))

    def test_unknown_setup_warns(self):
        p = Probe()
        o = self.E._build_options(p, "A-101", doc=object(), setup="Gone")
        self.assertTrue(o.MaskCoincidentLines)
        self.assertTrue(any(k == "warn" and "'Gone'" in m for k, m in p.lines))


if __name__ == "__main__":
    unittest.main()
