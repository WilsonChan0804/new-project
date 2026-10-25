# -*- coding: utf-8 -*-
"""Light & Vent rooms of one model drawn on another model's plans, through
shared coordinates (sharedxy.py):
    python3 -m unittest discover -s revit/tests -v
"""
import math
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "LWK.extension", "lib"))
from lwk_viewer import sharedxy as SX  # noqa: E402


def location(deg, ox, oy, oz):
    """internal -> shared: turned deg about Z, then moved (mm)."""
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return {"o": [ox, oy, oz], "bx": [c, s, 0.0], "by": [-s, c, 0.0], "bz": [0.0, 0.0, 1.0]}


def plan_mapping(origin, scale=100.0, deg=0.0):
    """A plan viewport: paper mm from model mm (geom.model_to_paper's form)."""
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return {"origin": origin, "x_axis": [c * scale, s * scale, 0.0], "y_axis": [-s * scale, c * scale, 0.0]}


def model_to_paper(m, p):
    o, ex, ey = m["origin"], m["x_axis"], m["y_axis"]
    d = [p[i] - o[i] for i in range(3)]
    return [sum(d[i] * ex[i] for i in range(3)) / sum(c * c for c in ex),
            sum(d[i] * ey[i] for i in range(3)) / sum(c * c for c in ey)]


def affine(t, x, y):
    return [t[0][0] * x + t[0][1] * y + t[0][2], t[1][0] * x + t[1][1] * y + t[1][2]]


class Transform(unittest.TestCase):

    def test_invert(self):
        m = location(23.5, 835123456.0, 815987654.0, 4500.0)
        p = [12345.0, -6789.0, 3200.0]
        back = SX.apply(SX.invert(m), SX.apply(m, p))
        for a, b in zip(back, p):
            self.assertAlmostEqual(a, b, places=4)

    def test_direction_from_the_survey_point(self):
        to_shared = location(12.0, 835000000.0, 815000000.0, 0.0)
        survey_internal = [1000.0, 2000.0, 0.0]
        survey_shared = SX.apply(to_shared, survey_internal)
        # Revit may hand either direction: the survey point decides
        for given in (to_shared, SX.invert(to_shared)):
            got = SX.choose(given, survey_internal, survey_shared)
            self.assertIsNotNone(got)
            q = SX.apply(got, survey_internal)
            for a, b in zip(q, survey_shared):
                self.assertAlmostEqual(a, b, places=3)

    def test_no_match(self):
        self.assertIsNone(SX.choose(location(0, 0, 0, 0), [0, 0, 0], [5000.0, 0, 0]))


class CalcRoomOnLayoutPlan(unittest.TestCase):
    """A room of the Calculation model lands where the Layout model's plan
    draws the same place, though the two models' internal origins differ."""

    def setUp(self):
        self.calc = location(30.0, 835200000.0, 815300000.0, 5000.0)       # calculation model
        self.layout = location(-15.0, 835150000.0, 815250000.0, 3500.0)    # layout model
        self.map = plan_mapping([40000.0, 25000.0, 31950.0], 100.0, 0.0)
        self.z_layout = 31950.0

    def test_room_corner(self):
        # a room corner, in the calculation model's internal mm
        corner_calc = [52000.0, -18000.0, 33450.0]
        shared = SX.apply(self.calc, corner_calc)
        # the same place in the layout model, and where its plan prints it
        corner_layout = SX.apply(SX.invert(self.layout), shared)
        want = model_to_paper(self.map, corner_layout)
        t = SX.shared_to_paper(self.layout, lambda p: model_to_paper(self.map, p), self.z_layout,
                               (self.map["origin"][0], self.map["origin"][1]))
        got = affine(t, shared[0], shared[1])
        self.assertAlmostEqual(got[0], want[0], places=2)
        self.assertAlmostEqual(got[1], want[1], places=2)

    def test_add_shared_rows(self):
        rows = [{"loops_mm": [[[0, 0], [5000, 0], [5000, 4000], [0, 4000]]], "label_mm": [2500, 2000], "z_mm": 33450.0,
                 "windows": [{"pos": [5000.0, 2000.0, 34500.0]}, {"pos": None}]}]
        SX.add_shared(rows, self.calc)
        r = rows[0]
        self.assertEqual(len(r["loops_sh"][0]), 4)
        s = SX.apply(self.calc, [5000, 4000, 33450.0])
        self.assertAlmostEqual(r["loops_sh"][0][2][0], round(s[0], 1), places=1)
        self.assertAlmostEqual(r["level_sh_mm"], 33450.0 + 5000.0, places=1)
        self.assertEqual(len(r["windows"][0]["pos_sh"]), 3)
        self.assertIsNone(r["windows"][1]["pos_sh"])
        # the layout plan prints the label inside the room's printed outline
        t = SX.shared_to_paper(self.layout, lambda p: model_to_paper(self.map, p), self.z_layout,
                               (self.map["origin"][0], self.map["origin"][1]))
        u = [affine(t, x, y) for x, y in r["loops_sh"][0]]
        lab = affine(t, *r["label_sh"])
        self.assertTrue(min(p[0] for p in u) < lab[0] < max(p[0] for p in u))
        self.assertTrue(min(p[1] for p in u) < lab[1] < max(p[1] for p in u))


class DiagramsOnTheServer(unittest.TestCase):
    def test_server_has_the_same_code(self):
        a = open(os.path.join(HERE, "..", "LWK.extension", "lib", "lwk_viewer", "lv_diagram_pdf.py"), "rb").read()
        b = open(os.path.join(HERE, "..", "..", "server", "lv_diagram_pdf.py"), "rb").read()
        self.assertEqual(a, b, "server/lv_diagram_pdf.py and the add-in's must be the same file")


if __name__ == "__main__":
    unittest.main()
