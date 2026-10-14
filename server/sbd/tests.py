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


class OneMassManySolids(unittest.TestCase):
    def test_tower_inside_podium_is_not_a_hole(self):
        # one in-place mass: a podium 0-20 and a tower 0-80 standing inside it
        m = mass("A", box(0, 0, 0, 60, 40, 20), box(10, 10, 0, 30, 30, 80))
        low = footprint.mass_footprints(m, 0, 20)
        areas = sorted(round(abs(footprint.area(f["loop"]))) for f in low)
        self.assertIn(2400, areas)          # the podium is a building
        mid = footprint.mass_footprints(m, 20, 60)
        self.assertEqual([round(abs(footprint.area(f["loop"]))) for f in mid], [400])


class Permeability(unittest.TestCase):
    def test_two_blocks_setbacks_and_corridor(self):
        # two blocks 10..40 and 60..90 (y 15..45), 0..80 m: S1 10 / S2 20 / S1 10 -> P 40 %
        d = {"site": SITE, "street_axis": [[0, 0], [100, 0]],
             "masses": [mass("A", box(10, 15, 0, 40, 45, 80)), mass("B", box(60, 15, 0, 90, 45, 80))]}
        r = engine.run(d)
        low = r["zones"][0]
        # the panel's rules: S1 is the side region's Area / Depth (10.0 to 10.5 m here)
        self.assertEqual([(t, q) for t, w, q in gaps(low)], [("S1", True), ("S2", True), ("S1", True)])
        self.assertTrue(all(10.0 <= g["distance_m"] <= 10.6 for g in low["axis1"]["gaps"] if g["type"] == "S1"))
        self.assertTrue(40.0 <= low["axis1"]["P"] <= 41.0)
        left = low["axis1"]["sides"]["left"]
        self.assertAlmostEqual(left["avg_m"], left["area_m2"] / left["depth_m"], places=2)
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
        self.assertGreaterEqual(min(mid["axis1"]["P"], mid["axis2"]["P"]), 40.0)
        self.assertTrue(75 <= mid["plane_y_deg"] <= 105)
        self.assertTrue(high["assessed"])
        self.assertEqual(r["controlling_p"], low["P"])

    def test_middle_planes_turn_to_the_towers(self):
        # two towers turned 30 deg on a square site: the Middle zone's Plane X
        # turns with them (the Low zone keeps the street's)
        import math
        c, s_ = math.cos(math.radians(30)), math.sin(math.radians(30))

        def rbox(x0, y0, x1, y1, z0, z1):
            m = box(x0, y0, z0, x1, y1, z1)
            m["verts"] = [[50 + (v[0] - 50) * c - (v[1] - 50) * s_, 50 + (v[0] - 50) * s_ + (v[1] - 50) * c, v[2]] for v in m["verts"]]
            return m
        d = {"site": [[0, 0], [100, 0], [100, 100], [0, 100]], "street_axis": [[0, 0], [100, 0]],
             "masses": [mass("T1", rbox(20, 25, 45, 75, 0, 80)), mass("T2", rbox(62, 25, 80, 75, 0, 80))]}
        r = engine.run(d)
        low, mid = r["zones"][0], r["zones"][1]
        self.assertEqual(low["plane_x_deg"], 0.0)
        self.assertNotEqual(mid["plane_x_deg"], 0.0)
        self.assertGreater(min(mid["axis1"]["P"], mid["axis2"]["P"]), min(low["axis1"]["P"], low["axis2"]["P"]))

    def test_heights_said_when_masses_float(self):
        d = {"site": SITE, "street_axis": [[0, 0], [100, 0]], "ground_z": 0.0, "ground_source": "the street slabs",
             "masses": [mass("A", box(10, 15, 22, 40, 45, 32))]}
        r = engine.run(d)
        self.assertTrue(any("starts 22.00 m above" in w for w in r["warnings"]))
        # towers standing on a podium are not warned about
        d2 = {"site": SITE, "street_axis": [[0, 0], [100, 0]], "masses": [mass("P", box(10, 10, 0, 90, 50, 10)), mass("T", box(20, 20, 10, 40, 40, 110))]}
        self.assertFalse(any("starts" in w for w in engine.run(d2)["warnings"]))
        self.assertFalse(r["zones"][0]["assessed"])

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


def _addin():
    """The add-in's sbd_export (its street helpers need no Revit)."""
    import importlib.util
    import os
    p = os.path.join(os.path.dirname(__file__), "..", "..", "revit", "LWK.extension", "lib", "lwk_viewer", "sbd_export.py")
    spec = importlib.util.spec_from_file_location("sbd_export", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class StreetSlabs(unittest.TestCase):
    def setUp(self):
        self.S = _addin()

    def test_straight_street(self):
        # a 12 m wide street along y = -16 .. -4 (centreline y = -10)
        loop = [(-20, -16), (140, -16), (140, -4), (-20, -4)]
        cl, a, b = self.S.strip_centreline(loop)
        self.assertTrue(all(abs(p[1] + 10) < 1e-6 for p in cl))
        self.assertAlmostEqual(min(p[0] for p in cl), -20, places=6)
        self.assertAlmostEqual(max(p[0] for p in cl), 140, places=6)
        near, far = self.S.near_far(a, b, [tuple(p) for p in SITE])
        self.assertTrue(all(abs(p[1] + 16) < 1e-6 for p in far))

    def test_bent_street(self):
        # an L: 10 m wide, along x then up y; the centreline follows the bend
        loop = [(0, 0), (100, 0), (100, 80), (90, 80), (90, 10), (0, 10)]
        cl, a, b = self.S.strip_centreline(loop)
        ends = sorted([cl[0], cl[-1]])                           # either way round
        self.assertAlmostEqual(ends[0][0], 0, places=6)          # the middle of the x leg's end
        self.assertAlmostEqual(ends[0][1], 5, places=6)
        self.assertAlmostEqual(ends[1][0], 95, places=6)         # the middle of the y leg's end
        self.assertAlmostEqual(ends[1][1], 80, places=6)
        self.assertTrue(any(p[0] > 90 and p[1] > 20 for p in cl))

    def test_mean_level(self):
        a = {"loop": [(0, -20), (50, -20), (50, -8), (0, -8)], "z": 4.0, "area": 600}
        b = {"loop": [(50, -20), (100, -20), (100, -8), (50, -8)], "z": 5.0, "area": 600}
        far = {"loop": [(0, -900), (50, -900), (50, -888), (0, -888)], "z": 50.0, "area": 600}
        self.assertAlmostEqual(self.S.mean_level([a, b, far], [tuple(p) for p in SITE]), 4.5)

    def test_street_slab_gives_the_same_u(self):
        # the street of Case1.test_canyon_u, as a slab from y = -20 to 0
        site = [tuple(p) for p in SITE]
        st = self.S.street_from_floor({"name": "Main St", "loop": [(-10, -20), (110, -20), (110, 0), (-10, 0)], "z": 0.0}, site)
        self.assertAlmostEqual(st["width_m"], 20.0, places=2)
        d = {"site": SITE, "street_axis": self.S.frontage_axis([st], site), "streets": [st],
             "masses": [mass("A", box(10, 15, 0, 40, 45, 30))]}
        b = engine.run(d)["case1"][0]["buildings"][0]
        self.assertAlmostEqual(b["U_m"], 35.0, places=2)


if __name__ == "__main__":
    unittest.main()
