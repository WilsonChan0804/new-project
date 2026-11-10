# -*- coding: utf-8 -*-
"""A viewport's box on the page (geom.box_on_sheet), without Revit:
    python3 -m unittest discover -s revit/tests -v
"""
import os
import sys
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "LWK.extension", "lib"))


class P(object):
    def __init__(self, x, y, z=0.0):
        self.X, self.Y, self.Z = x, y, z


def _stub_revit():
    """Just enough of Autodesk.Revit.DB for geom to import."""
    if "Autodesk.Revit.DB" in sys.modules:
        return
    db = types.ModuleType("Autodesk.Revit.DB")
    db.XYZ = P
    db.ViewportRotation = types.SimpleNamespace(None_=0, Clockwise=1, Counterclockwise=2)
    for name, mod in (("Autodesk", types.ModuleType("Autodesk")), ("Autodesk.Revit", types.ModuleType("Autodesk.Revit")),
                      ("Autodesk.Revit.DB", db)):
        sys.modules[name] = mod


class Box(unittest.TestCase):
    def test_box_from_paper_origin(self):
        _stub_revit()
        from lwk_viewer import geom
        ft = 304.8
        outline = types.SimpleNamespace(MinimumPoint=P(100 / ft + 1, 50 / ft + 2), MaximumPoint=P(400 / ft + 1, 250 / ft + 2))
        vp = types.SimpleNamespace(GetBoxOutline=lambda: outline)
        x, y, w, h = geom.box_on_sheet(vp, P(1, 2))
        self.assertAlmostEqual(x, 100, places=1)
        self.assertAlmostEqual(y, 50, places=1)
        self.assertAlmostEqual(w, 300, places=1)
        self.assertAlmostEqual(h, 200, places=1)


if __name__ == "__main__":
    unittest.main()
