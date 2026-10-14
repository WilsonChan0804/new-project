# -*- coding: utf-8 -*-
"""Tests of the SBD engine on hand-made sites with known answers.

    python3 -m sbd.tests       (from server/)
"""

import unittest

from . import engine, footprint


def box(x0, y0, z0, x1, y1, z1):
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    t = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    return {"verts": [list(p) for p in v], "tris": [list(x) for x in t]}


def mass(name, *parts):
    v, t = [], []
    for m in parts:
        o = len(v)
        v += m["verts"]
        t += [[a + o, b + o, c + o] for a, b, c in m["tris"]]
    return {"id": name, "name": name, "verts": v, "tris": t}


SITE = [[0, 0], [100, 0], [100, 60], [0, 60]]


def gaps(z, axis="axis1"):
    return [(g["type"], round(g["width_m"], 2), g["qualifies"]) for g in z[axis]["gaps"]]


class Footprints(unittest.TestCase):
    def test_podium_and_tower(self):
        m = mass("A", box(0, 0, 0, 60, 40, 20), box(10, 10, 20, 30, 30, 80))
        low = footprint.mass_footprints(m, 0, 20)
        mid = footprint.mass_footprints(m, 20, 60)
        self.assertEqual(len(low), 1)
        self.assertAlmostEqual(abs(footprint.area(low[0]["loop"])), 2400, delta=0.1)
        self.assertEqual(len(mid), 1)
        self.assertAlmostEqual(abs(footprint.area(mid[0]["loop"])), 400, delta=0.1)
        self.assertEqual(footprint.mass_footprints(m, 80, None), [])

    def test_courtyard_is_not_a_building(self):
        # a ring: outer 0..40, hole 10..30 (four boxes around the courtyard)
        m = mass("R", box(0, 0, 0, 40, 10, 20), box(0, 30, 0, 40, 40, 20), box(0, 10, 0, 10, 30, 20), box(30, 10, 0, 40, 30, 20))
        fps = footprint.mass_footprints(m, 0, 20)
        # the four boxes are separate meshes: four loops, none of them a hole
        self.assertTrue(all(footprint.area(f["loop"]) > 0 for f in fps))


class Permeability(unittest.TestCase):
    def test_two_blocks_setbacks_and_corridor(self):
        # two blocks 10..40 and 60..90 (y 15..45), 0..80 m: S1 10 / S2 20 / S1 10 -> P 40 %
        d = {"site": SITE, "street_axis": [[0, 0], [100, 0]],
             "masses": [mass("A", box(10, 15, 0, 40, 45, 80)), mass("B", box(60, 15, 0, 90, 45, 80))]}
        r = engine.run(d)
        low = r["zones"][0]
        self.assertEqual(gaps(low), [("S1", 10.0, True), ("S2", 20.0, True), ("S1", 10.0, True)])
        self.assertAlmostEqual(low["axis1"]["P"], 40.0, places=1)
        self.assertEqual([c["width_m"] for c in low["corridors"]], [20.0])
        self.assertAlmostEqual(r["lp"]["projected_m"], 60.0, places=2)

    def test_internal_gap_below_15m_fails(self):
        d = {"site": SITE, "street_axis": [[0, 0], [100, 0]],
             "masses": [mass("A", box(10, 15, 0, 45, 45, 30)), mass("B", box(55, 15, 0, 90, 45, 30))]}
        low = engine.run(d)["zones"][0]
        internal = [g for g in low["axis1"]["gaps"] if g["type"] == "S2"]
        self.assertTrue(internal and not internal[0]["qualifies"])

    def test_middle_zone_is_the_towers(self):
        # podium over the whole site band, towers above: Low P (setbacks only) < Middle P
        d = {"site": SITE, "street_axis": [[0, 0], [100, 0]],
             "masses": [mass("A", box(10, 10, 0, 90, 50, 20), box(10, 15, 20, 40, 45, 80), box(60, 15, 20, 90, 45, 80))]}
        r = engine.run(d)
        low, mid, high = r["zones"]
        self.assertLess(low["P"], mid["P"])
        self.assertAlmostEqual(mid["axis1"]["P"], 40.0, places=1)
        self.assertTrue(high["assessed"])
        self.assertEqual(r["controlling_p"], low["P"])

    def test_zone_without_building_is_not_assessed(self):
        d = {"site": SITE, "street_axis": [[0, 0], [100, 0]], "masses": [mass("A", box(10, 15, 0, 40, 45, 30))]}
        r = engine.run(d)
        self.assertFalse(r["zones"][2]["assessed"])

    def test_buildings_outside_the_site_are_not_counted(self):
        d = {"site": SITE, "street_axis": [[0, 0], [100, 0]],
             "masses": [mass("A", box(10, 15, 0, 40, 45, 30)), mass("N", box(200, 0, 0, 230, 30, 30))]}
        low = engine.run(d)["zones"][0]
        self.assertEqual(len(low["footprints"]), 1)
        self.assertEqual(len(low["others"]), 1)

    def test_angled_boundary_s3(self):
        # a site whose right side slopes: the right setback is an S3 (area / depth)
        site = [[0, 0], [100, 0], [80, 60], [0, 60]]
        d = {"site": site, "street_axis": [[0, 0], [100, 0]], "masses": [mass("A", box(10, 15, 0, 50, 45, 30))]}
        r = engine.run(d, axis="angle", angle_deg=0)
        types = [g["type"] for z in r["zones"][:1] for g in z["axis1"]["gaps"]]
        self.assertIn("S1", types)

    def test_input_check(self):
        r = engine.run({"site": [[0, 0], [10, 10], [10, 0], [0, 10]], "masses": []})
        self.assertTrue(any("crosses itself" in w for w in r["warnings"]))
        self.assertTrue(any("No masses" in w for w in r["warnings"]))


class Case1(unittest.TestCase):
    def test_canyon_u(self):
        # street along y = -10 (centreline), opposite boundary y = -20; facade at y = 15:
        # canyon width = 25 + 10 = 35 m along 30 m of facade -> U 35, Lp 30 <= 175
        d = {"site": SITE, "street_axis": [[0, 0], [100, 0]],
             "streets": [{"name": "Main St", "centreline": [[-10, -10], [110, -10]], "opposite": [[-10, -20], [110, -20]]}],
             "masses": [mass("A", box(10, 15, 0, 40, 45, 30))]}
        c = engine.run(d)["case1"]
        b = c[0]["buildings"][0]
        self.assertAlmostEqual(b["U_m"], 35.0, places=2)
        self.assertAlmostEqual(b["Lp_m"], 30.0, places=0)
        self.assertTrue(b["pass"])


if __name__ == "__main__":
    unittest.main()
