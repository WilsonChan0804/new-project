# -*- coding: utf-8 -*-
"""Tests of the SBD engine on hand-made sites with known answers.

    python3 -m sbd.tests       (from server/)
"""

import math
import unittest

from . import engine, footprint, streets


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
        self.assertGreaterEqual(mid["P"], 40.0)
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

    def test_only_the_part_within_30m_counts(self):
        # an L-shaped block: one wing 25 m from the centreline, the rest 40 m
        # away - it abuts the street, but only the part within 30 m of the
        # centreline counts (Wilson, report 4): the wing, 15 m
        d = {"site": SITE, "street_axis": [[0, 0], [100, 0]],
             "streets": [{"name": "Main St", "centreline": [[-10, -10], [110, -10]], "opposite": [[-10, -20], [110, -20]]}],
             "masses": [mass("A", box(10, 15, 0, 25, 45, 30), box(25, 30, 0, 70, 45, 30))]}
        b = engine.run(d)["case1"][0]["buildings"][0]
        self.assertAlmostEqual(b["L_m"], 15.0, delta=0.6)
        self.assertAlmostEqual(b["U_m"], 35.0, delta=0.3)
        # Lp: the whole building's notional rectangle, its longer side (Fig
        # B3; Wilson, report 8) - 60 x 30 m
        self.assertAlmostEqual(b["Lp_m"], 60.0, places=2)
        self.assertAlmostEqual(b["short_m"], 30.0, places=2)

    def test_buildings_under_15m_apart_are_one_group(self):
        st = [{"name": "Main St", "centreline": [[-10, -10], [110, -10]], "opposite": [[-10, -20], [110, -20]]}]
        near = {"site": SITE, "street_axis": [[0, 0], [100, 0]], "streets": st,
                "masses": [mass("A", box(10, 5, 0, 30, 25, 30)), mass("B", box(40, 5, 0, 60, 25, 30))]}
        c = engine.run(near)["case1"][0]
        self.assertEqual([b["building"] for b in c["buildings"]], ["B1+B2"])
        self.assertAlmostEqual(c["buildings"][0]["Lp_m"], 50.0, places=2)
        self.assertTrue(c["spacing"][0]["grouped"])
        self.assertAlmostEqual(c["spacing"][0]["d_m"], 10.0, places=3)
        far = dict(near, masses=[mass("A", box(10, 5, 0, 30, 25, 30)), mass("B", box(50, 5, 0, 70, 25, 30))])
        c = engine.run(far)["case1"][0]
        self.assertEqual(sorted(b["building"] for b in c["buildings"]), ["B1", "B2"])
        self.assertFalse(c["spacing"][0]["grouped"])

    def test_two_streets_the_smaller_u_controls(self):
        d = {"site": SITE, "street_axis": [[0, 0], [100, 0]],
             "streets": [{"name": "Main St", "centreline": [[-10, -10], [110, -10]], "opposite": [[-10, -20], [110, -20]]},
                         {"name": "Side St", "centreline": [[105, -10], [105, 70]], "opposite": [[110, -10], [110, 70]]}],
             "masses": [mass("A", box(60, 15, 0, 95, 45, 30))]}
        b = engine.run(d)["case1"][0]["buildings"][0]
        us = {r["street"]: r["U_m"] for r in b["streets"]}
        self.assertEqual(set(us), {"Main St", "Side St"})
        self.assertEqual(b["ctrl_street"], min(us, key=us.get))
        self.assertAlmostEqual(b["Lp_max_m"], 5 * min(us.values()), places=2)
        self.assertAlmostEqual(b["Lp_m"], 35.0, places=2)     # the longer projection (on Main St)

    def test_l_shaped_street(self):
        # one street turning the site's corner: along y = -10, then up x = 110
        cl = [[-10, -10], [110, -10], [110, 70]]
        opp = [[-10, -20], [120, -20], [120, 70]]
        d = {"site": SITE, "street_axis": [cl[0], cl[-1]],          # the export's chord: diagonal
             "streets": [{"name": "Corner Rd", "centreline": cl, "opposite": opp, "width_m": 20}],
             "masses": [mass("A", box(60, 15, 0, 95, 45, 30))]}
        r = engine.run(d)
        # Plane X along the leg fronting the site the longest (the long one, along x)
        ax = r["zones"][0]["axis1"]["axis"]
        self.assertAlmostEqual(abs(ax[0]), 1.0, places=3)
        self.assertEqual([lg["name"] for lg in r["street_legs"]], ["Corner Rd (leg 1)", "Corner Rd (leg 2)"])
        b = r["case1"][0]["buildings"][0]
        legs = {x["street"]: x for x in b["streets"]}
        self.assertEqual(set(legs), {"Corner Rd (leg 1)", "Corner Rd (leg 2)"})
        self.assertAlmostEqual(b["U_m"], min(x["U_m"] for x in b["streets"]), places=3)
        # one Lp for the building on every leg: its notional rectangle 35 x 30
        self.assertAlmostEqual(b["Lp_m"], 35.0, places=2)
        self.assertEqual(len(b["lp_rect"]), 4)

    def test_too_far_is_a_note(self):
        d = {"site": SITE, "street_axis": [[0, 0], [100, 0]],
             "streets": [{"name": "Main St", "centreline": [[-10, -10], [110, -10]], "opposite": [[-10, -20], [110, -20]]}],
             "masses": [mass("A", box(10, 25, 0, 40, 45, 30))]}
        c = engine.run(d)["case1"][0]
        self.assertEqual(c["buildings"], [])
        # its Lp: the longer side of its notional rectangle (Fig B3, report 8)
        self.assertEqual(c["others"][0]["building"], "B1")
        self.assertAlmostEqual(c["others"][0]["Lp_m"], 30.0, places=2)
        self.assertTrue(any("Main St" in n and "not applicable" in n and "35.000" in n for n in c["notes"]))


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

    def test_street_type_names(self):
        for nm in ("SBD Street", "Main Road 150", "Back lane", "Footpath", "ROAD"):
            self.assertTrue(self.S.is_street_type(nm), nm)
        for nm in ("Generic 200", "Podium slab", ""):
            self.assertFalse(self.S.is_street_type(nm), nm)

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


class StreetSlabMerge(unittest.TestCase):
    """A street drawn as several slabs, or a sloped slab with a top face per
    plane, is one street (SBD Export used to reject every piece)."""

    def setUp(self):
        self.S = _addin()
        self.site = [tuple(p) for p in SITE]

    def slab(self, loop, z=0.0, name="Kwun Chui Road"):
        return {"name": name, "loop": loop, "z": z, "area": abs(self.S.loop_area(loop)), "faces": 1}

    def test_two_slabs_one_street(self):
        a = self.slab([(-10, -20), (50, -20), (50, 0), (-10, 0)], 1.0)
        b = self.slab([(50, -20), (110, -20), (110, 0), (50, 0)], 2.0)
        made, left = self.S.streets_from_slabs([a, b], self.site)
        self.assertEqual(left, [])
        self.assertEqual(len(made), 1)
        g, st = made[0]
        self.assertEqual(g["floors"], 2)
        self.assertAlmostEqual(st["width_m"], 20.0, places=2)
        self.assertAlmostEqual(st["length_m"], 120.0, places=1)
        self.assertAlmostEqual(st["level"], 1.5, places=3)

    def test_sloped_faces_merge(self):
        # one slab, its top cut into 4 planes across and along the street
        faces = [[(-10, -20), (40, -20), (40, -10), (-10, -10)], [(-10, -10), (40, -10), (40, 0), (-10, 0)],
                 [(40, -20), (110, -20), (110, -10), (40, -10)], [(40, -10), (110, -10), (110, 0), (40, 0)]]
        loop = self.S.merge_outlines(faces)
        self.assertEqual(len(loop), 4)
        self.assertAlmostEqual(abs(self.S.loop_area(loop)), 120 * 20, places=3)
        st = self.S.street_from_floor({"name": "R", "loop": loop, "z": 0.0}, self.site)
        self.assertAlmostEqual(st["width_m"], 20.0, places=2)

    def test_partly_shared_edge(self):
        # a piece meets the middle of a longer edge: the shared part goes
        faces = [[(0, 0), (100, 0), (100, 10), (0, 10)], [(30, 10), (60, 10), (60, 12), (30, 12)]]
        loop = self.S.merge_outlines(faces)
        self.assertAlmostEqual(abs(self.S.loop_area(loop)), 1000 + 60, places=3)
        self.assertEqual(len(loop), 8)

    def test_kinked_end_straight_centreline(self):
        # the far end is two edges meeting at a point (a kink): the
        # centreline must not swing across the street at that end
        loop = [(0, 0), (100, 0), (104, 6), (100, 12), (0, 12)]
        for S in (self.S, streets):
            cl, a, b = S.strip_centreline(loop)
            end = max((cl[0], cl[-1]), key=lambda p: p[0])
            self.assertGreater(end[0], 99.0)
            self.assertLess(abs(end[1] - 6.0), 0.6, end)
            self.assertTrue(all(abs(p[1] - 6.0) < 0.6 for p in cl), [p for p in cl if abs(p[1] - 6.0) >= 0.6][:3])

    def test_ramp_faces_with_small_mismatch(self):
        # a shape-edited ramp: 6 triangles, each corner off by up to 1 mm
        import random
        rnd = random.Random(4)
        j = lambda p: (p[0] + rnd.uniform(-0.001, 0.001), p[1] + rnd.uniform(-0.001, 0.001))
        xs = [0, 40, 80, 120]
        faces = []
        for x0, x1 in zip(xs, xs[1:]):
            faces.append([j((x0, 0)), j((x1, 0)), j((x1, 12))])
            faces.append([j((x0, 0)), j((x1, 12)), j((x0, 12))])
        loop = self.S.merge_outlines(faces)
        self.assertAlmostEqual(abs(self.S.loop_area(loop)), 120 * 12, delta=2.0)
        st = self.S.street_from_floor({"name": "R", "loop": loop, "z": 0.0}, self.site)
        self.assertAlmostEqual(st["length_m"], 120.0, delta=0.5)

    def test_overlapping_slabs_chained(self):
        # a ramp Floor and a flat Floor overlapping by 0.2 m: the whole street
        a = self.slab([(-10, -20), (50.2, -20), (50.2, 0), (-10, 0)], 3.0)
        b = self.slab([(50, -20), (110, -20), (110, 0), (50, 0)], 1.0)
        made, left = self.S.streets_from_slabs([a, b], self.site)
        self.assertEqual((len(made), left), (1, []))
        g, st = made[0]
        self.assertEqual(st["name"], "Kwun Chui Road")
        self.assertAlmostEqual(st["length_m"], 120.0, delta=0.5)
        self.assertAlmostEqual(min(p[0] for p in st["centreline"]), -10, delta=0.01)
        self.assertAlmostEqual(max(p[0] for p in st["centreline"]), 110, delta=0.01)
        self.assertTrue(all(abs(p[1] + 10) < 1e-6 for p in st["centreline"]))
        self.assertTrue(all(abs(p[1] + 20) < 1e-6 for p in st["opposite"]))    # the side away from the site

    def test_slabs_with_small_gap(self):
        a = self.slab([(-10, -20), (49.97, -20), (49.97, 0), (-10, 0)])
        b = self.slab([(50, -20), (110, -20), (110, 0), (50, 0)])
        made, left = self.S.streets_from_slabs([a, b], self.site)
        self.assertEqual(len(made), 1)
        self.assertAlmostEqual(made[0][1]["length_m"], 120.0, delta=0.5)

    def test_not_a_strip_left_once(self):
        # a roundabout drawn as two half slabs: not a strip - reported once, not per piece
        ring = [(200 + 20 * math.cos(math.pi * k / 20), 200 + 20 * math.sin(math.pi * k / 20)) for k in range(40)]
        a, b = self.slab(ring[:21]), self.slab(ring[20:] + [ring[0]])
        made, left = self.S.streets_from_slabs([a, b], self.site)
        self.assertEqual(made, [])
        self.assertEqual(len(left), 1)
        g, why = left[0]
        self.assertEqual(g["floors"], 2)
        self.assertIn("2 floors", why)

    def test_other_streets_stay_apart(self):
        a = self.slab([(-10, -20), (110, -20), (110, 0), (-10, 0)], name="A Street")
        b = self.slab([(110, -20), (150, -20), (150, 0), (110, 0)], name="B Road")
        made, left = self.S.streets_from_slabs([a, b], self.site)
        self.assertEqual(sorted(st["name"] for g, st in made), ["A Street", "B Road"])


class GroupSpacing(unittest.TestCase):
    """Every gap between building groups is dimensioned, not only each
    building's nearest neighbour (TMTL496: B4 - B5 was missing)."""

    def test_pairs_apart(self):
        sq = lambda x, y: {"loop": [(x, y), (x + 10, y), (x + 10, y + 10), (x, y + 10)]}
        named = [("B3", [sq(0, 0)]), ("B4", [sq(12, 0)]), ("B5", [sq(42, 0)]), ("B6", [sq(54, 0)])]
        groups, spacing = engine._groups(named)
        self.assertEqual(sorted(g[0] for g in groups), ["B3+B4", "B5+B6"])
        keys = {tuple(sorted((x["a"], x["b"]))): x for x in spacing}
        self.assertIn(("B4", "B5"), keys)
        self.assertAlmostEqual(keys[("B4", "B5")]["d_m"], 20.0, places=3)
        self.assertFalse(keys[("B4", "B5")]["grouped"])
        self.assertEqual(len(spacing), 3)


class OverlappingCorridors(unittest.TestCase):
    """Corridors overlapping on plan are one: the one that counts is kept,
    of two that do not the one turned least (TMTL496, three marked cases);
    beside the kept one it merges, apart from it its gap is omitted."""
    site_uv = [(0.0, 0.0), (400.0, 0.0), (400.0, 300.0), (0.0, 300.0)]

    @staticmethod
    def gap(lo, hi, dist, bend, corridor, qualifies=None):
        strip = [[lo, 0], [hi, 0], [hi, 90], [lo, 90]]
        return {"lo_m": lo, "hi_m": hi, "width_m": round(hi - lo, 3), "type": "S2", "distance_m": dist,
                "qualifies": dist >= 15.0 if qualifies is None else qualifies, "bend_deg": bend, "corridor": corridor, "strip": strip}

    def test_report1_neither_counts_least_turned_kept(self):
        a = self.gap(50.0, 52.301, 2.301, 7.9, [[50, 0], [52.3, 0], [56, 90], [53.7, 90]])
        b = self.gap(52.301, 65.334, 13.033, 15.0, [[51, 0], [64, 0], [88, 90], [75, 90]])
        c = self.gap(120.0, 140.0, 20.0, 0.0, [[120, 0], [140, 0], [140, 90], [120, 90]])
        out, dropped = engine._one_corridor([a, b, c], self.site_uv)
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0]["bend_deg"], 7.9)                   # S2 kept, S3 omitted
        self.assertAlmostEqual(out[0]["width_m"], 15.334, places=3)  # one opening along the plane
        self.assertEqual(out[0]["merged_with"]["distance_m"], 13.033)
        self.assertEqual(dropped, 0.0)
        self.assertEqual(out[1]["lo_m"], 120.0)

    def test_p7_the_one_that_counts_kept(self):
        a = self.gap(50.0, 65.188, 15.188, 15.0, [[50, 0], [65, 0], [89, 90], [74, 90]])
        b = self.gap(65.188, 67.518, 2.330, 5.5, [[60, 0], [62.3, 0], [71, 90], [68.7, 90]])
        out, dropped = engine._one_corridor([a, b], self.site_uv)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["distance_m"], 15.188)              # S2 kept, S3 omitted
        self.assertTrue(out[0]["qualifies"])
        self.assertAlmostEqual(out[0]["width_m"], 17.518, places=3)

    def test_p11_apart_omitted_blocked(self):
        # S3 (6.226 m, 15 deg) crosses S4 (15.315 m) on plan, with B3 between them along the plane
        s3 = self.gap(80.0, 86.226, 6.226, 15.0, [[80, 0], [86, 0], [110, 90], [104, 90]])
        s4 = self.gap(115.0, 130.315, 15.315, 9.4, [[115, 0], [130, 0], [115, 90], [100, 90]])
        out, dropped = engine._one_corridor([s3, s4], self.site_uv)
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0]["type"], "OMIT")
        self.assertFalse(out[0]["qualifies"])
        self.assertEqual(out[0]["omitted"]["by_distance_m"], 15.315)
        self.assertTrue(out[1]["qualifies"])

    def test_apart_or_not_overlapping_stay(self):
        a = {"lo_m": 0, "hi_m": 20, "width_m": 20, "distance_m": 20, "qualifies": True, "bend_deg": 0,
             "corridor": [[0, 0], [20, 0], [20, 90], [0, 90]], "strip": []}
        b = dict(a, lo_m=20, hi_m=40, corridor=[[20.5, 0], [40, 0], [40, 90], [20.5, 90]])
        out, dropped = engine._one_corridor([a, b], self.site_uv)
        self.assertEqual((len(out), dropped), (2, 0.0))
        self.assertFalse(any(g.get("omitted") for g in out))

    def test_omitted_gap_gives_no_is(self):
        from . import elevation as E
        masses = [mass("A", box(0, 0, 0, 20, 10, 40)), mass("B", box(26, 0, 0, 46, 10, 40))]
        items = lambda om: [{"kind": "shadow", "label": "A", "lo": 0.0, "hi": 20.0, "members": [[[0, 0], [20, 0], [20, 10], [0, 10]]]},
                            {"kind": "gap", "label": "S2", "s_m": 6.0, "pass": False, "need_m": 15.0, "lo": 20.0, "hi": 26.0, "omitted": om},
                            {"kind": "shadow", "label": "B", "lo": 26.0, "hi": 46.0, "members": [[[26, 0], [46, 0], [46, 10], [26, 10]]]}]
        open_ = E.zone_elevation(masses, 0.0, items(False), 0.0, 40.0, (1.0, 0.0))
        shut = E.zone_elevation(masses, 0.0, items(True), 0.0, 40.0, (1.0, 0.0))
        self.assertGreater(open_["pe_area_m2"] + open_["is_area_m2"], 0.0)
        self.assertEqual(shut["is_area_m2"] + shut["pe_area_m2"], 0.0)


class JunctionCorner(unittest.TestCase):
    """TMTL496: the site's corner is rounded where its street meets another
    at a junction - the street part beyond the round counts too, up to the
    street's centreline (carried on past its slab's end)."""

    def setUp(self):
        import math as m
        from . import sideregion as SR
        self.SR = SR
        # u across the street (east), v along it; the corner at (100, 60)
        # rounded with a 15 radius: from (100, 45) round to (85, 60)
        arc = [(85 + 15 * m.cos(m.radians(a)), 45 + 15 * m.sin(m.radians(a))) for a in range(0, 91, 10)]
        self.site = [(0, 0), (100, 0)] + arc + [(0, 60)]
        self.cl = [(110, -10), (110, 50)]                               # ends at the junction
        self.slab = [(100, -10), (120, -10), (120, 50), (100, 50)]
        # the other street, with the junction box, across the top
        self.other = [(100, 50), (140, 50), (140, 80), (60, 80), (60, 60), (100, 60)]

    def test_round_corner_counts(self):
        alone = self.SR.extension(self.site, self.cl, 13.0, "right", self.slab, 3.0)
        both = self.SR.extension(self.site, self.cl, 13.0, "right", self.slab, 3.0, [self.other])
        top = lambda ext: max(p[1] for e in ext for p in e)
        self.assertLess(top(alone), 53.0)
        self.assertGreater(top(both), 55.0)           # on round the corner
        area = lambda ext: sum(abs(sum(e[i][0] * e[(i + 1) % len(e)][1] - e[(i + 1) % len(e)][0] * e[i][1] for i in range(len(e)))) / 2 for e in ext)
        self.assertGreater(area(both), area(alone) + 30.0)
        # its far side is the street's centreline, carried on
        self.assertTrue(all(abs(p[0] - 110.0) < 1e-6 for e in both for p in e if p[0] > 100.5))


class SideRegionEndInStreet(unittest.TestCase):
    """TMTL496 Plane Y: the street part of a side region ends where the
    region's inner edge meets the site boundary, cut parallel to the plane."""

    def test_cut_at_the_edge_exit(self):
        from . import sideregion as SR
        site = [(0, 0), (100, 0), (85, 60), (0, 60)]           # the frontage slants in
        hull = [[(40, 10), (90, 10), (90, 30), (40, 30)]]       # the edge u = 90 leaves the site at v = 40
        slab = [(100, 0), (120, 0), (105, 60), (85, 60)]
        cl = [(110, -4), (95, 64)]
        r = SR.side_region(site, hull, "right", [(cl, 13.0, slab)])
        self.assertAlmostEqual(max(v for _, v in r["polygon"]), 40.0, places=6)
        top = sorted(u for u, v in r["polygon"] if abs(v - 40.0) < 1e-6)
        self.assertAlmostEqual(top[0], 90.0, places=6)           # from the exit point ...
        self.assertAlmostEqual(top[-1], 110 - 15 * 44 / 68.0, places=6)   # ... parallel to the plane to the centreline
        self.assertAlmostEqual(r["D_ft"], 40.0, places=6)


class OneOffsetPerStreet(unittest.TestCase):
    def test_l_street_one_line(self):
        # an L street round two sides of the site: two legs, ONE 30 m line
        d = {"site": [[0, 0], [100, 0], [100, 80], [0, 80]],
             "streets": [{"name": "So Kwun Wat Road", "centreline": [[-20, -10], [110, -10], [110, 100]],
                          "opposite": [[-20, -20], [120, -20], [120, 100]]}]}
        self.assertEqual(len(engine.street_legs(d)), 2)
        offs = engine.street_offsets(d)
        self.assertEqual(len(offs), 1)
        line = offs[0]["line"]
        # 30 m in from both legs, meeting at the mitre (80, 20)
        self.assertTrue(any(abs(p[0] - 80) < 1e-6 and abs(p[1] - 20) < 1e-6 for p in line), line)
        self.assertTrue(any(abs(p[1] - 20) < 1e-6 and p[0] < 0 for p in line))
        self.assertTrue(any(abs(p[0] - 80) < 1e-6 and p[1] > 90 for p in line))


class AngledGaps(unittest.TestCase):
    """An opening at a turn the straight projection hides (TMTL496 p.11)."""

    def test_band_at_a_turn_found(self):
        # two long blocks whose shadows on the plane (along x) overlap, with a
        # clear band 16 m wide between them at 10 deg
        t = math.radians(10)
        def block(c):
            # 20 x 120 m, its long side along the band's direction
            dx, dy = -math.sin(t), math.cos(t)
            ex, ey = math.cos(t), math.sin(t)
            return [(c[0] + ex * a + dx * b, c[1] + ey * a + dy * b) for a, b in ((-10, -60), (10, -60), (10, 60), (-10, 60))]
        a = block((40, 60))
        b = block((40 + 36 * math.cos(t), 60 + 36 * math.sin(t)))       # 36 between centres: 16 clear
        site = [(-40, -20), (160, -20), (160, 140), (-40, 140)]
        found = engine._angled_gaps(site, [("B1", [a]), ("B2", [b])], (1.0, 0.0), [])
        best = max(found, key=lambda x: x["width_m"])
        self.assertAlmostEqual(best["width_m"], 16.0, delta=0.05)
        self.assertEqual(best["bend_deg"], 10.0)
        self.assertTrue(best["counts"])

    def test_known_gap_not_repeated(self):
        a = [(0, 0), (20, 0), (20, 50), (0, 50)]
        b = [(40, 0), (60, 0), (60, 50), (40, 50)]
        site = [(-10, -10), (70, -10), (70, 60), (-10, 60)]
        known = [{"strip": [[20, -10], [40, -10], [40, 60], [20, 60]]}]
        self.assertEqual(engine._angled_gaps(site, [("B1", [a]), ("B2", [b])], (1.0, 0.0), known), [])


class BdSampleCase(unittest.TestCase):
    """APP-152's sample case (BD): site 80 x 24 m on a 15 m street; a 15 m
    podium (its 7.5 m ends only 6 m high) and a 78 m tower 4 m back, on a
    5 m void (podium garden) 13 m wide at 15-20 m."""

    @classmethod
    def setUpClass(cls):
        d = {"site": [[0, 0], [80, 0], [80, 24], [0, 24]], "ground_z": 0.0, "street_axis": [[0, -7.5], [80, -7.5]],
             "masses": [mass("Podium", box(7.5, 0, 0, 72.5, 24, 15), box(0, 0, 0, 7.5, 24, 6), box(72.5, 0, 0, 80, 24, 6)),
                        mass("Tower", box(30, 4, 20, 62, 16, 78), box(43, 4, 15, 62, 16, 20))],
             "streets": [{"name": "Street", "centreline": [[-10, -7.5], [90, -7.5]], "opposite": [[-10, -15], [90, -15]], "width_m": 15}]}
        cls.r = engine.run(d)
        cls.z = {z["zone"]: z for z in cls.r["zones"]}

    def test_lp_and_required_p(self):
        self.assertAlmostEqual(self.r["lp"]["projected_m"], 80.0, places=2)     # full site coverage
        self.assertEqual(self.r["required_p"], 20.0)
        self.assertIsNone(self.r["required_p_y"])                               # under 2 ha: Plane X only

    def test_low_zone_elevation(self):
        e = self.z["LOW"]["axis1"]["elev"]
        self.assertAlmostEqual(e["exempt_m"], 20 / 3.0, places=2)              # <= 1/3 H disregarded
        self.assertAlmostEqual(e["pe_area_m2"], 65.0, places=1)                 # 13 m x 5 m
        # the two 7.5 m ends (13.33 m high) and the 22.5 m podium garden (5 m)
        # as in the sample; the 10.5 m podium roof right of the tower also
        kinds = sorted((round(q[0], 1), round(q[1], 1), q[4]) for q in e["rects"] if q[4] in ("is", "sky", "pe"))
        self.assertEqual(kinds, [(0.0, 7.5, "is"), (7.5, 30.0, "sky"), (30.0, 43.0, "pe"), (62.0, 72.5, "sky"), (72.5, 80.0, "is")])
        self.assertAlmostEqual(e["P_pe"], 65 / 1600.0 * 100, places=2)

    def test_case1_per_zone(self):
        c = {x["zone"]: x["buildings"][0] for x in self.r["case1"]}
        self.assertAlmostEqual(c["LOW"]["U_m"], 15.0, places=2)                 # U_p
        self.assertAlmostEqual(c["LOW"]["Lp_m"], 65.0, places=2)                # 80 - 7.5 x 2
        self.assertTrue(c["LOW"]["pass"])                                       # 65 < 75
        self.assertAlmostEqual(c["MIDDLE"]["U_m"], 19.0, places=2)              # U_T
        self.assertAlmostEqual(c["MIDDLE"]["Lp_m"], 32.0, places=2)
        self.assertAlmostEqual(c["HIGH"]["Lp_max_m"], 95.0, places=2)
        # the canyon drawn is the canyon measured: its area = U x L
        low = c["LOW"]
        self.assertAlmostEqual(sum(abs(footprint.area(p)) for p in low["canyon"]), low["area_m2"], delta=low["area_m2"] * 0.02)
        self.assertAlmostEqual(math.dist(*low["lp_side"]), 65.0, places=2)
        self.assertTrue(self.r["case1_pass"])


class DeformedElevation(unittest.TestCase):
    """The elevation is laid out from the plan: each gap at its S value,
    each building group at its width on the near edge (the street side)."""

    @classmethod
    def setUpClass(cls):
        # two blocks 14 m apart (S2 < 15 m: not IS); the Low zone keeps
        # Plane X along the street
        d = {"site": SITE, "street_axis": [[0, 0], [100, 0]],
             "streets": [{"name": "Main", "centreline": [[-10, -10], [110, -10]], "opposite": [[-10, -20], [110, -20]], "width_m": 20}],
             "masses": [mass("A", box(15, 20, 0, 43, 40, 30)), mass("B", box(57, 20, 0, 85, 40, 30))]}
        cls.r = engine.run(d)
        cls.z = {z["zone"]: z for z in cls.r["zones"]}

    def test_failed_s2_is_pe_not_is(self):
        e = self.z["LOW"]["axis1"]["elev"]
        s2 = [i for i in e["items"] if i["label"] == "S2"]
        self.assertTrue(s2 and not s2[0]["pass"])
        # 14 m < 15 m: not IS, but a permeable element (>= 3 m wide)
        self.assertTrue(any(q[4] == "pe" and abs((q[1] - q[0]) - s2[0]["s_m"]) < 0.01 for q in e["rects"]))
        self.assertAlmostEqual(e["pe_area_m2"], s2[0]["s_m"] * (e["H_m"] - e["exempt_m"]), delta=0.5)
        # IS = the two side setbacks only, over the zone's height
        sides = sum(i["w_m"] for i in e["items"] if i["kind"] == "gap" and i["pass"])
        self.assertAlmostEqual(e["is_area_m2"], sides * (e["H_m"] - e["exempt_m"]), delta=0.5)

    def test_widths_follow_the_plan(self):
        for zn in ("LOW", "MIDDLE"):
            for k in ("axis1", "axis2"):
                ao = self.z[zn][k]
                e = ao["elev"]
                for it in e["items"]:
                    if it["kind"] == "gap":
                        g = ao["gaps"][it["gap"]]
                        self.assertAlmostEqual(it["w_m"], g["distance_m"] or g["width_m"], places=2)
                    else:
                        self.assertAlmostEqual(it["w_m"], it["hi"] - it["lo"], places=2)
                self.assertAlmostEqual(e["W_m"], sum(i["w_m"] for i in e["items"]), places=2)
        names = [i["label"] for i in self.z["LOW"]["axis1"]["edge"] if i["kind"] == "shadow"]
        self.assertEqual(names, ["B1", "B2"])

    def test_low_zone_along_the_street_others_tried(self):
        self.assertEqual(self.z["LOW"]["plane_x_deg"], 0.0)
        self.assertEqual(len(self.z["LOW"]["tried"]), 1)
        self.assertGreater(len(self.z["MIDDLE"]["tried"]), 1)
        self.assertEqual(sum(1 for t in self.z["MIDDLE"]["tried"] if t.get("chosen")), 1)

    def test_side_edge_turns_once(self):
        # every side region's edge: perpendicular, then at most one turn
        n = 0
        for zn in ("LOW", "MIDDLE"):
            for k in ("axis1", "axis2"):
                for sd in self.z[zn][k]["sides"].values():
                    e = sd.get("edge")
                    if not e:
                        continue
                    n += 1
                    self.assertLessEqual(len(e), 3)
                    self.assertLessEqual(abs(sd["angle_deg"]), 15.0 + 1e-6)
        self.assertGreater(n, 0)

    def test_bands_reach_the_boundary_no_further(self):
        # each band covers its region (the panel's) and runs on to the site
        # boundary - at most a step past where it leaves the site
        for zn in ("LOW", "MIDDLE"):
            for k in ("axis1", "axis2"):
                ao = self.z[zn][k]
                av = (-ao["axis"][1], ao["axis"][0])
                vv = lambda pts: [p[0] * av[0] + p[1] * av[1] for p in pts]
                pairs = [(g["band"], g["corridor"]) for g in ao["gaps"] if g.get("band")] + \
                        [(s["band"], s["polygon"]) for s in ao["sides"].values() if s.get("band")]
                sv = vv(SITE)
                for band, poly in pairs:
                    self.assertLessEqual(min(vv(band)), min(vv(poly)) + 1e-6)
                    self.assertGreaterEqual(max(vv(band)), max(vv(poly)) - 1e-6)
                    self.assertGreater(min(vv(band)), min(sv) - 2.0)
                    self.assertLess(max(vv(band)), max(sv) + 2.0)

class Report4(unittest.TestCase):
    """Wilson's 4th report: Level 0, side regions to the street centreline,
    IS / PE taken horizontally, one near edge for both side regions."""
    MAIN = {"name": "Main", "centreline": [[-10, -10], [110, -10]], "opposite": [[-10, -20], [110, -20]], "width_m": 20,
            "outline": [[-10, 0], [110, 0], [110, -20], [-10, -20]]}

    def test_level_zero_is_the_lowest_street(self):
        east = {"name": "Main", "centreline": [[110, -10], [110, 70]], "opposite": [[120, -10], [120, 70]], "width_m": 20,
                "outline": [[100, -10], [120, -10], [120, 70], [100, 70]], "level": 0.0}
        far = {"name": "Far", "centreline": [[-200, 0], [-200, 60]], "opposite": [[-210, 0], [-210, 60]], "width_m": 20,
               "outline": [[-210, 0], [-190, 0], [-190, 60], [-210, 60]], "level": -5.0}
        d = {"site": SITE, "ground_z": 0.75, "ground_source": "the street slabs",
             "streets": [dict(self.MAIN, level=0.75), east, far], "masses": [mass("A", box(20, 20, 0, 80, 40, 30))]}
        r = engine.run(d)
        self.assertEqual(r["ground_z"], 0.0)                  # the lower street; the far one is not abutting
        self.assertEqual(r["level0"]["street"], "Main (2)")   # same name: its own street
        self.assertEqual([s["level"] for s in r["streets"]], [0.75, 0.0, -5.0])
        # a Level chosen in the export stays
        r = engine.run(dict(d, ground_source="Level L1"))
        self.assertEqual(r["ground_z"], 0.75)

    def test_side_region_next_to_a_street_runs_to_its_centreline(self):
        base = {"site": SITE, "streets": [self.MAIN], "masses": [mass("A", box(20, 20, 0, 85, 40, 30))]}
        east = {"name": "East", "centreline": [[110, -10], [110, 70]], "opposite": [[120, -10], [120, 70]], "width_m": 20,
                "outline": [[100, -10], [120, -10], [120, 70], [100, 70]]}
        side = lambda r: max(r["zones"][0]["axis1"]["sides"].values(), key=lambda s: s["polygon"][0][0] if s["polygon"] else 0)
        a = side(engine.run(base))
        b = side(engine.run(dict(base, streets=[self.MAIN, east])))
        self.assertFalse(a["to_cl"])
        self.assertTrue(b["to_cl"])
        self.assertAlmostEqual(a["avg_m"], 15.0, delta=0.3)
        self.assertAlmostEqual(b["avg_m"], 25.0, delta=0.3)     # on to x = 110
        self.assertLessEqual(max(p[0] for p in b["polygon"]), 110.0 + 1e-3)

    def test_gap_joined_with_the_sky_beside_it(self):
        # A 0-20 m, B 0-14 m, 5 m apart: the gap is short of 15 m (PE) below
        # 14 m, but over B it opens on to the sky - 5 + 40 + 5 m wide: IS
        d = {"site": SITE, "streets": [self.MAIN],
             "masses": [mass("A", box(5, 20, 0, 50, 40, 20)), mass("B", box(55, 20, 0, 95, 40, 14))]}
        z = engine.run(d)["zones"][0]
        e = z["axis1"]["elev"]
        gap = [i for i in e["items"] if i["kind"] == "gap" and i["label"] == "S2"]
        self.assertTrue(gap, e["items"])
        g = gap[0]
        self.assertAlmostEqual(g["joined"]["z_from"], 14.0, delta=0.01)
        is_ = [q for q in e["rects"] if q[4] == "is" and q[0] >= g["x0"] - 1e-6 and q[1] <= g["x1"] + 1e-6]
        pe = [q for q in e["rects"] if q[4] == "pe" and q[0] >= g["x0"] - 1e-6 and q[1] <= g["x1"] + 1e-6]
        self.assertAlmostEqual(min(q[2] for q in is_), 14.0, delta=0.01)
        self.assertAlmostEqual(max(q[3] for q in pe), 14.0, delta=0.01)

    def test_plan_level_per_zone(self):
        # a podium 0-14 m over the whole block, 14-20 m only its west half:
        # at +17 m the plan sees the half, so a setback opens east of it
        d = {"site": SITE, "streets": [self.MAIN],
             "masses": [mass("P", box(5, 15, 0, 95, 45, 14), box(5, 15, 14, 50, 45, 20))]}
        lv = engine.zone_levels(d)["LOW"]
        self.assertEqual([(q["from"], q["to"]) for q in lv], [(6.667, 14.0), (14.0, 20.0)])
        a = engine.run(d)["zones"][0]
        b = engine.run(d, levels={"LOW": 17.0})["zones"][0]
        self.assertIsNone(a["plan_level"])
        self.assertEqual(b["plan_level"], 17.0)
        wa = max(s["avg_m"] for s in a["axis1"]["sides"].values())
        wb = max(s["avg_m"] for s in b["axis1"]["sides"].values())
        self.assertAlmostEqual(wa, 5.0, delta=0.3)
        self.assertAlmostEqual(wb, 50.0, delta=0.5)

    def test_one_near_edge_for_both_side_regions(self):
        d = {"site": [[10, 0], [75, 0], [75, 160], [0, 160], [2, 115], [-6, 100], [-6, 45]],
             "masses": [mass("A", box(12, 10, 0, 65, 120, 20)), mass("T", box(20, 40, 20, 40, 70, 70))]}
        r = engine.run(d)
        for z in r["zones"]:
            for k in ("axis1", "axis2"):
                if not z.get(k):
                    continue
                nl = set(s.get("near_low") for s in z[k]["sides"].values() if "near_low" in s)
                self.assertLessEqual(len(nl), 1)
                if nl:
                    self.assertEqual(z[k]["near"]["low"], nl.pop())


def _merge_dxf(a, b):
    """The entities of DXF b added to DXF a (both from dxfwrite)."""
    import re
    ents = re.search(r"\nENTITIES\r?\n(.*?)\n  0\r?\nENDSEC", b, re.S).group(1)
    return re.sub(r"(\nENTITIES\r?\n)", lambda m: m.group(1) + ents + "\n", a, count=1)


class CadModel(unittest.TestCase):
    """The SBD model drawn in CAD (the template's layers) and the drawings
    written back as DXF."""

    def _read(self, text, frame=None):
        import os
        import tempfile
        import cad_dxf
        from . import cadmodel
        fd, path = tempfile.mkstemp(suffix=".dxf")
        os.close(fd)
        try:
            with open(path, "w", newline="") as f:
                f.write(text)
            return cadmodel.read_model(cad_dxf.read(path), frame=frame)
        finally:
            os.remove(path)

    def test_template_at_shared_coordinates(self):
        # the project's site and streets at shared coordinates (HK1980-like:
        # turned 30 deg, 836 km E, 818 km N, +4.5 mPD) - and back on import
        import math
        from . import cadmodel
        c, s_ = math.cos(math.radians(30)), math.sin(math.radians(30))
        man = {"lwk_frame": {"internal_to_shared_mm": [c, -s_, 0, 836000000.0, s_, c, 0, 818000000.0, 0, 0, 1, 4500.0]}}
        fr = cadmodel.frame_of(man)
        st = [{"name": "Main Street", "centreline": [[-10, -10], [110, -10]], "opposite": [[-10, -20], [110, -20]],
               "outline": [[-10, -20], [110, -20], [110, 0], [-10, 0]], "level": 0.5}]
        model = {"site": SITE, "streets": st, "masses": [], "source": "revit"}
        dxf = cadmodel.template_dxf(model, fr, "P1")
        self.assertIn(cadmodel.SHARED_MARK, dxf)
        x, y, _ = fr[0](SITE[1][0], SITE[1][1])
        self.assertIn("%.4f" % x, dxf.replace(" ", ""))
        # a mass drawn at shared coordinates beside the site
        d = cadmodel.Dxf()
        d.layer(cadmodel.MASS, 30)
        loop = [fr[0](px, py)[:2] for px, py in [(20, 10), (60, 10), (60, 40), (20, 40)]]
        d.poly(cadmodel.MASS, loop, closed=True, elevation=4.5 + 0.0, thickness=30.0)
        got, probs = self._read(_merge_dxf(dxf, d.write()), fr)
        self.assertEqual(got["frame"], "internal")
        for (a, b), (p, q) in zip(got["site"], SITE):
            self.assertAlmostEqual(a, p, places=3)
            self.assertAlmostEqual(b, q, places=3)
        zs = [v[2] for v in got["masses"][0]["verts"]]
        self.assertAlmostEqual(min(zs), 0.0, places=3)
        self.assertAlmostEqual(got["streets"][0]["level"], 0.5, places=3)
        xs = [v[0] for v in got["masses"][0]["verts"]]
        self.assertAlmostEqual(min(xs), 20.0, places=3)
        # no frame known: kept as drawn, with a note
        got2, probs2 = self._read(dxf)
        self.assertNotIn("frame", got2)
        self.assertTrue(any("shared coordinates" in p for p in probs2))

    def test_template_reads_back(self):
        from . import cadmodel
        d, probs = self._read(cadmodel.template_dxf())
        self.assertEqual(probs, [])
        self.assertEqual(len(d["masses"]), 2)
        self.assertEqual(sorted(s["name"] for s in d["streets"]), ["Main Street", "Side Street"])
        self.assertEqual(d["ground_z"], 0.0)                      # the lower street
        r = engine.run(d)
        self.assertTrue(r["ok"])
        self.assertEqual([z["assessed"] for z in r["zones"]], [True, True, True])

    def test_same_result_as_from_revit(self):
        # the two-block site of DeformedElevation: extrusions on SBD-MASS, the
        # second block as 3D faces on its own layer, in millimetres
        from .dxfwrite import Dxf
        K = 1000.0
        d = Dxf()
        d.poly("SBD-SITE", [(x * K, y * K) for x, y in SITE], closed=True)
        d.poly("SBD-STREET-Main", [(-10 * K, 0), (110 * K, 0), (110 * K, -20 * K), (-10 * K, -20 * K)], closed=True)
        d.poly("SBD-MASS", [(15 * K, 20 * K), (43 * K, 20 * K), (43 * K, 40 * K), (15 * K, 40 * K)], closed=True, thickness=30 * K)
        m = box(57, 20, 0, 85, 40, 30)
        v = [[c * K for c in p] for p in m["verts"]]
        for a, b, c in m["tris"]:
            d.face("SBD-MASS-B", v[a], v[b], v[c])
        text = d.write().replace("$INSUNITS\r\n 70\r\n6", "$INSUNITS\r\n 70\r\n4")
        model, probs = self._read(text)
        self.assertEqual(probs, [])
        ref = engine.run({"site": SITE, "streets": [{"name": "Main", "centreline": [[-10, -10], [110, -10]], "opposite": [[-10, -20], [110, -20]], "width_m": 20}],
                          "masses": [mass("A", box(15, 20, 0, 43, 40, 30)), mass("B", box(57, 20, 0, 85, 40, 30))]})
        got = engine.run(model)
        self.assertEqual([z.get("P") for z in got["zones"]], [z.get("P") for z in ref["zones"]])
        self.assertEqual(len(got["case1"]), len(ref["case1"]))
        self.assertEqual(got["ground_z"], 0.0)

    def test_problems_are_said(self):
        from .dxfwrite import Dxf
        d = Dxf()
        d.poly("SBD-MASS", [(0, 0), (5, 0), (5, 5)], closed=True)
        model, probs = self._read(d.write())
        self.assertIsNone(model)
        self.assertTrue(any("SBD-SITE" in p for p in probs))
        d.poly("SBD-SITE", [(0, 0), (50, 0), (50, 50), (0, 50)], closed=True)
        model, probs = self._read(d.write())
        self.assertTrue(any("Thickness" in p for p in probs))

    def test_drawings_as_dxf(self):
        import os
        import tempfile
        import cad_dxf
        import sbd_api
        text = sbd_api.cad_file([{"t": "pl", "l": "SBD-SITE", "p": [[0, 0], [10, 0], [10, 5]], "closed": True},
                                 {"t": "fill", "l": "SBD-IS", "c": 0x16a34a, "a": 0.3, "p": [[0, 0], [5, 0], [5, 5]]},
                                 {"t": "text", "l": "SBD-TEXT", "p": [1, 1], "h": 1, "s": "S1 = 7.500 m²", "r": 30, "a": "c", "v": "m"},
                                 {"t": "line", "l": "SBD-DIM", "p": [[0, 0], [1, 1]]}, {"t": "circle", "l": "SBD-DIM", "p": [0, 0], "r": 1},
                                 {"t": "bogus"}, {"t": "line", "l": "SBD-DIM", "p": [[0, 0]]}])
        fd, path = tempfile.mkstemp(suffix=".dxf")
        os.close(fd)
        try:
            with open(path, "w", newline="") as f:
                f.write(text)
            doc = cad_dxf.read(path)
        finally:
            os.remove(path)
        self.assertEqual(doc.version, "AC1015")
        self.assertEqual(sorted(e.type for e in doc.model_ents()), ["CIRCLE", "HATCH", "LINE", "LWPOLYLINE", "TEXT"])
        self.assertIn("SBD-IS", doc.layers)
        self.assertIn("\\U+00B2", text)

class Report5(unittest.TestCase):
    """Wilson's 5th report: exact side regions (the street part between the
    frontage's corners, parallel to the plane; the piece nearest the plane),
    constant-width corridors, DR(1) canyons in parts, short-side Lp."""

    def test_extension_from_the_frontage_corners(self):
        from . import sideregion as SR
        # the site's east boundary faces a street only from v = 20 to 50
        site = [(0, 0), (100, 0), (100, 20), (100, 50), (90, 50), (90, 60), (0, 60)]
        cl = [(110, -10), (110, 70)]
        ext = SR.extension(site, cl, 10.0 + 3.0, "right")
        self.assertEqual(len(ext), 1)
        vs = sorted(set(round(p[1], 6) for p in ext[0]))
        self.assertEqual((vs[0], vs[-1]), (0.0, 50.0) if vs[0] == 0.0 else (20.0, 50.0))
        # the ends are lines of constant v through the corners
        for v in (vs[0], vs[-1]):
            us = sorted(p[0] for p in ext[0] if abs(p[1] - v) < 1e-9)
            self.assertAlmostEqual(us[-1], 110.0, places=6)

    def test_region_corners_on_the_boundary(self):
        from . import sideregion as SR
        site = [(0, 0), (100, 0), (100, 60), (0, 60)]
        hull = [[(40, 10), (70, 10), (80, 50), (40, 50)]]          # a sloping east face
        r = SR.side_region(site, hull, "right")
        self.assertIsNotNone(r)
        for u, v in r["polygon"]:
            on = abs(u - 100) < 1e-6 or abs(v) < 1e-6 or abs(v - 60) < 1e-6 or \
                any(abs(u - ue) < 1e-6 for ue in [r["edge"][0] if v <= r["edge"][1] else r["edge"][0] + r["edge"][2] * (v - r["edge"][1])])
            self.assertTrue(on, (u, v))
        self.assertAlmostEqual(r["S_ft"], r["area_ft2"] / r["D_ft"], places=9)

    def test_the_piece_nearest_the_plane(self):
        from . import sideregion as SR
        # a notch splits the east strip: a small piece near the plane (v 0-10)
        # and a larger one beyond (v 20-60) - the near one is the region
        site = [(0, 0), (100, 0), (100, 10), (60, 10), (60, 20), (100, 20), (100, 60), (0, 60)]
        hull = [[(30, 25), (75, 25), (75, 60), (30, 60)]]
        r = SR.side_region(site, hull, "right")
        self.assertLess(max(v for _, v in r["polygon"]), 10.0 + 1e-6)

    def test_corridor_width_constant(self):
        from . import nearedge as N
        ue, uf, ms = N.corridor_edges((0.0, 10.0, 40.0, 0.2, 15.0, None, None))
        import math
        n = (1 / math.sqrt(1.04), -0.2 / math.sqrt(1.04))   # the angled leg's normal
        for v in (0.0, 5.0, 45.0, 60.0):
            self.assertAlmostEqual(uf(v) - ue(v), 15.0, places=6)          # perpendicular legs
        for v in (15.0, 25.0, 35.0):
            # the distance from a point on the near edge to the far edge's line
            p = (ue(v), v)
            q = (uf(v + 1), v + 1)
            self.assertAlmostEqual((q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1], 15.0, places=6)

    def test_recessed_facade_two_canyons(self):
        # one block whose middle is set back beyond 30 m: two canyon parts
        st = [{"name": "Main St", "centreline": [[-10, -10], [110, -10]], "opposite": [[-10, -20], [110, -20]]}]
        m = mass("A", box(10, 15, 0, 30, 45, 30), box(30, 25, 0, 50, 45, 30), box(50, 15, 0, 70, 45, 30))
        c = engine.run({"site": SITE, "streets": st, "masses": [m]})["case1"][0]
        b = c["buildings"][0]
        parts = b["streets"][0]["parts"]
        self.assertEqual([p["tag"] for p in parts], ["a", "b"])
        self.assertAlmostEqual(sum(p["L_m"] for p in parts), 40.0, delta=0.6)
        self.assertAlmostEqual(b["U_m"], 35.0, delta=0.3)                    # (Aa + Ab) / (La + Lb)
        self.assertAlmostEqual(b["Lp_m"], 60.0, places=2)                    # the block's notional rectangle (Fig B3)

    def test_not_abutting_lp_is_the_notional_long_side(self):
        st = [{"name": "Main St", "centreline": [[-10, -10], [110, -10]], "opposite": [[-10, -20], [110, -20]]}]
        import math
        c_, s_ = math.cos(math.radians(20)), math.sin(math.radians(20))
        m = box(30, 30, 0, 60, 45, 30)
        m["verts"] = [[45 + (v[0] - 45) * c_ - (v[1] - 37.5) * s_, 37.5 + (v[0] - 45) * s_ + (v[1] - 37.5) * c_, v[2]] for v in m["verts"]]
        c = engine.run({"site": SITE, "streets": st, "masses": [mass("A", m)]})["case1"][0]
        # turned 20 deg: the rectangle turns with it - 30 x 15, Lp 30 (report 8)
        self.assertAlmostEqual(c["others"][0]["Lp_m"], 30.0, places=2)
        self.assertAlmostEqual(c["others"][0]["short_m"], 15.0, places=2)

    def test_plan_levels_for_every_zone(self):
        d = {"site": SITE, "masses": [mass("T", box(20, 20, 0, 80, 40, 100))]}
        r = engine.run(d)
        self.assertTrue(all(len(z["levels"]) >= 1 for z in r["zones"] if z["assessed"]))

class Report6(unittest.TestCase):
    """Wilson's 6th report: side region edges square to the plane first, the
    street part found from the slab, the recess on a skewed street, the
    straight corridor."""

    def test_edge_starts_square_to_the_plane(self):
        from . import sideregion as SR
        for e in SR.candidates([[(40, 10), (70, 10), (80, 50), (40, 50)]], "right", 0.0):
            u1, v1, t = e
            # any turn is at a building corner, never from the plane on
            self.assertTrue(t == 0.0 or v1 > 0.0, e)

    def test_street_found_by_its_slab(self):
        from . import sideregion as SR
        site = [(0, 0), (100, 0), (100, 60), (0, 60)]
        # the slab starts 2 m off the boundary; the centreline is 22 m away -
        # more than half the width + 3 m, but the slab is there
        cl = [(122, -10), (122, 70)]
        slab = [(102, -10), (142, -10), (142, 70), (102, 70)]
        # (a centreline-only test with a 10 m reach misses it)
        self.assertEqual(SR.extension(site, cl, 10.0, "right"), [])
        ext = SR.extension(site, cl, 20.0 + 3.0, "right", slab, 3.0)
        self.assertEqual(len(ext), 1)
        self.assertAlmostEqual(max(p[0] for p in ext[0]), 122.0, places=6)

    def test_recess_on_a_skewed_street(self):
        # the centreline slopes 4 m over its length; the facade's middle is set
        # back beyond 30 m: still two canyon parts, not one cut at "30 m"
        st = [{"name": "Main St", "centreline": [[-10, -10], [110, -14]], "opposite": [[-10, -20], [110, -24]]}]
        m = mass("A", box(10, 15, 0, 30, 45, 30), box(30, 28, 0, 50, 45, 30), box(50, 15, 0, 70, 45, 30))
        c = engine.run({"site": SITE, "streets": st, "masses": [m]})["case1"][0]
        parts = c["buildings"][0]["streets"][0]["parts"]
        self.assertEqual([p["tag"] for p in parts], ["a", "b"])

    def test_corridor_is_one_straight_band(self):
        import math
        c, s_ = math.cos(math.radians(8)), math.sin(math.radians(8))

        def rbox(x0, y0, x1, y1):
            m = box(x0, y0, 0, x1, y1, 80)
            m["verts"] = [[50 + (v[0] - 50) * c - (v[1] - 30) * s_, 30 + (v[0] - 50) * s_ + (v[1] - 30) * c, v[2]] for v in m["verts"]]
            return m
        d = {"site": SITE, "masses": [mass("A", rbox(10, 10, 35, 50)), mass("B", rbox(55, 10, 85, 50))]}
        z = engine.run(d)["zones"][1]
        cor = [g for k in ("axis1", "axis2") for g in z[k]["gaps"] if g.get("ring")]
        self.assertTrue(cor)
        for g in cor:
            ring = g["ring"]
            # a straight band: its two long sides each lie on one line
            n = len(ring) // 2
            for side in (ring[:n], ring[n:]):
                a, b = side[0], side[-1]
                for p in side:
                    cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
                    self.assertLess(abs(cr) / max(1e-9, math.hypot(b[0] - a[0], b[1] - a[1])), 0.05)


class Report8(unittest.TestCase):
    """Wilson's 8th report: the hatch on to the site's corner beyond the
    edge's exit, a Y-shaped tower kept in the elevation, the buildings'
    marks, Lp = the notional rectangle's longer side (Fig B3)."""

    def test_region_runs_on_to_the_corner(self):
        from . import sideregion as SR
        # the far boundary v = 80 + u/5: the edge u = 60 leaves the site at
        # v = 92, but the site goes on to its corner (100, 100) outward of it
        site = [(0, 0), (100, 0), (100, 100), (0, 80)]
        r = SR.side_region(site, [[(40, 10), (60, 10), (60, 50), (40, 50)]], "right")
        self.assertAlmostEqual(r["area_ft2"], 40 * 92 + 160.0, places=6)
        self.assertAlmostEqual(r["D_ft"], 100.0, places=6)
        self.assertTrue(any(abs(p[0] - 100) < 1e-6 and abs(p[1] - 100) < 1e-6 for p in r["polygon"]))

    def test_inner_point_of_a_u_shape(self):
        from . import elevation as E
        u = [(0, 0), (30, 0), (30, 30), (20, 30), (20, 10), (10, 10), (10, 30), (0, 30)]
        x, y = E._inner_point(u)
        self.assertTrue(footprint.point_in(x, y, u))
        # the corners' average lies in the notch, outside
        self.assertFalse(footprint.point_in(sum(p[0] for p in u) / 8.0, sum(p[1] for p in u) / 8.0, u))

    def test_u_shaped_tower_in_the_elevation(self):
        # a U-shaped tower: still drawn (its cut kept by a point inside it)
        u = [(30, 20), (70, 20), (70, 50), (60, 50), (60, 30), (40, 30), (40, 50), (30, 50)]
        verts = [[x, y, 0] for x, y in u] + [[x, y, 100] for x, y in u]
        n = len(u)
        tris = []
        for i in range(1, n - 1):
            tris.append([0, i + 1, i]); tris.append([n, n + i, n + i + 1])
        for i in range(n):
            j = (i + 1) % n
            tris.append([i, j, n + j]); tris.append([i, n + j, n + i])
        r = engine.run({"site": SITE, "masses": [{"id": "U", "name": "U", "verts": verts, "tris": tris}]})
        hi = [z for z in r["zones"] if z["zone"] == "HIGH"][0]
        for k in ("axis1", "axis2"):
            kinds = set(q[4] for q in hi[k]["elev"]["rects"])
            self.assertIn("bldg", kinds, k)

    def test_marks_on_the_shadows(self):
        st = [{"name": "Main St", "centreline": [[-10, -10], [110, -10]], "opposite": [[-10, -20], [110, -20]]}]
        d = {"site": SITE, "streets": st, "masses": [mass("A", box(10, 20, 0, 40, 40, 30)), mass("B", box(45, 20, 0, 75, 40, 30))]}
        z = engine.run(d)["zones"][0]
        marks = [m["label"] for it in z["axis1"]["elev"]["items"] for m in it.get("marks") or []]
        self.assertEqual(sorted(marks), ["B1", "B2"])
        self.assertNotIn("names", z["axis1"]["edge"][0])

    def test_lp_notional(self):
        rect, lp, short, ang, side = engine._lp_notional([(0, 0), (75, 0), (75, 20), (0, 20)])
        self.assertAlmostEqual(lp, 75.0, places=6)              # a long block: its length, never turned 45 deg
        self.assertAlmostEqual(short, 20.0, places=6)
        self.assertAlmostEqual(math.dist(*side), 75.0, places=3)
        # Fig B2: a block with two corners cut away - still its 75 m rectangle
        lp2 = engine._lp_notional([(0, 0), (50, 0), (50, 10), (75, 10), (75, 30), (20, 30), (20, 25), (0, 25)])[1]
        self.assertAlmostEqual(lp2, 75.0, places=6)
        # Fig B3: two parts, one turned - the flush rectangle with the
        # smaller longer side is taken
        c, s_ = math.cos(math.radians(40)), math.sin(math.radians(40))
        oval = [(30 + 30 * c * math.cos(t) - 12 * s_ * math.sin(t), 60 + 30 * s_ * math.cos(t) + 12 * c * math.sin(t))
                for t in [k * math.pi / 18 for k in range(36)]]
        chev = [(0, 0), (25, 12), (50, 0), (50, 10), (25, 22), (0, 10)]
        rect3, lp3, short3, ang3, side3 = engine._lp_notional(oval + chev)
        xs, ys = [p[0] for p in oval + chev], [p[1] for p in oval + chev]
        self.assertLessEqual(lp3, max(max(xs) - min(xs), max(ys) - min(ys)) + 1e-6)
        self.assertAlmostEqual(lp3, max(math.dist(rect3[0], rect3[1]), math.dist(rect3[1], rect3[2])), places=3)


class Report8b(unittest.TestCase):
    """TKO, page 3: at a shadow's ends, columns whose building is all within
    the disregarded <= 1/3 H are the open space beside the setback - IS
    with it (horizontally), not 'open'."""

    def test_end_columns_join_the_setback(self):
        from . import elevation as E
        m = mass("A", box(10, 0, 0, 16, 30, 5), box(16, 0, 0, 22, 30, 10), box(22, 0, 0, 78, 30, 20),
                 box(78, 0, 0, 84, 30, 10), box(84, 0, 0, 90, 30, 5))
        sq = [[10, 0], [90, 0], [90, 30], [10, 30]]
        items = [{"kind": "gap", "label": "S1", "s_m": 10.0, "pass": True, "need_m": 7.5, "lo": 0, "hi": 10},
                 {"kind": "shadow", "label": "B1", "lo": 10, "hi": 90, "members": [sq], "names": [["B1", [sq]]]},
                 {"kind": "gap", "label": "S2", "s_m": 2.0, "pass": False, "need_m": 7.5, "lo": 90, "hi": 92}]
        e = E.zone_elevation([m], 0.0, items, 0.0, 20.0, (1.0, 0.0), 20.0, 20 / 3.0)
        kinds = {(round(q[0], 3), round(q[1], 3), round(q[2], 3)): q[4] for q in e["rects"]}
        self.assertEqual(kinds[(10.0, 16.0, 6.667)], "sky")      # beside S1, above the disregarded part
        self.assertEqual(kinds[(16.0, 22.0, 10.0)], "sky")       # over the 10 m step
        self.assertEqual(kinds[(84.0, 90.0, 6.667)], "sky")      # with S2 (2 m): 14 m >= 7.5 m
        self.assertEqual(kinds[(90.0, 92.0, 6.667)], "is")
        self.assertNotIn("open", set(kinds.values()))


class Report7(unittest.TestCase):
    """Wilson's 7th report: the hatch's corners on the site boundary (a
    region tapering to a point is not cut short), a small jog of the
    boundary next to a street passed over."""

    def test_region_tapers_to_the_boundary(self):
        from . import sideregion as SR
        # the left boundary u = v/2 meets the edge u = 40 at v = 80: the
        # region is the whole triangle-ended piece, area = 40*80 - 80*80/4
        site = [(0, 0), (100, 0), (100, 100), (50, 100)]
        r = SR.side_region(site, [[(40, 30), (60, 30), (60, 60), (40, 60)]], "left")
        self.assertAlmostEqual(r["area_ft2"], 1600.0, places=6)
        self.assertAlmostEqual(r["D_ft"], 80.0, places=6)
        tip = max(r["polygon"], key=lambda p: p[1])
        self.assertAlmostEqual(tip[0], 40.0, places=6)
        self.assertAlmostEqual(tip[1], 80.0, places=6)

    def test_small_jog_is_one_frontage(self):
        from . import sideregion as SR
        # a 1 ft step in the boundary facing the street: one extension
        site = [(0, 0), (100, 0), (100, 40), (101, 40), (101, 60), (0, 60)]
        cl = [(120, -10), (120, 70)]
        slab = [(101, -10), (140, -10), (140, 70), (101, 70)]
        ext = SR.extension(site, cl, 25.0, "right", slab, 3.0)
        self.assertEqual(len(ext), 1)
        self.assertAlmostEqual(min(p[1] for p in ext[0]), 0.0, places=6)
        self.assertAlmostEqual(max(p[1] for p in ext[0]), 60.0, places=6)

    def test_corridor_ring_ends_exactly_on_the_boundary(self):
        from . import nearedge as NE

        class B(object):
            band = (40.0, 0.0, 100.0, 0.1, 20.0, None, None, True)
        keep = NE._vrange
        NE._vrange = lambda poly, au, av: (0.0, 100.0)
        try:
            site = [(0, 0), (100, 0), (100, 100), (0, 80)]
            ring = NE.corridor_ring(B(), site)
        finally:
            NE._vrange = keep
        import math
        # every point inside or on the site (the top edge v = 80 + u/5)
        for u, v in ring:
            self.assertTrue(-1e-6 <= u <= 100 + 1e-6 and -1e-6 <= v <= 80 + u * 0.2 + 1e-6, (u, v))
        # each edge line's far end exactly on the slanted top edge
        for off in (0.0, 20.0 * math.sqrt(1.01)):
            on = [p for p in ring if abs(p[0] - (40 + 0.1 * p[1] + off)) < 1e-6]
            u, v = max(on, key=lambda p: p[1])
            self.assertAlmostEqual(v, 80 + u * 0.2, places=6)

if __name__ == "__main__":
    unittest.main()
