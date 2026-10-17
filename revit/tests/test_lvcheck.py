# -*- coding: utf-8 -*-
"""Tests of the parts of the lighting and ventilation check that need no Revit:
    python3 -m unittest discover -s revit/tests -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "LWK.extension", "lib"))
from lwk_viewer import lvcheck as LV


def room(key, number, name, x0, x1, y0=0, y1=4000, level="5/F", flat="A1", block="T1", level_mm=0.0, area=None):
    return {"id": hash(key) % 100000, "uid": key, "key": key, "number": number, "name": name, "flat": flat, "block": block,
            "area_m2": area or (x1 - x0) * (y1 - y0) / 1e6, "level": level, "level_mm": level_mm,
            "loops": [[(x0, y0), (x1, y0), (x1, y1), (x0, y1)]]}


def item(x, w=1500, y=4000, key="W", cat="Windows", h=1500, n=(0, 1), z=1500, glass=None):
    return {"id": 1, "uid": "u" + key, "cat": cat, "key": key, "mark": "", "pos": (x, y, z), "n": n,
            "w_mm": w, "h_mm": h, "glass_m2": glass, "fraction_override": None}


TYPES = {"W": {"operation": "Casement", "fraction": 1.0, "confirmed": True}}


class UseNames(unittest.TestCase):
    def test_names_of_the_ufa_rooms(self):
        for name, use in [("LIV/DIN", "LIV"), ("O.KIT", "KIT"), ("KIT", "KIT"), ("BR1", "BED"), ("BR4", "BED"),
                          ("MBR", "BED"), ("STO.", "STO"), ("BATH", "BATH"), ("UTI", None), ("CLOAK AREA", None)]:
            self.assertEqual(LV.use_of(name), use, name)


class Sharing(unittest.TestCase):
    def setUp(self):
        # two rooms side by side along a wall at y = 4000 (the window faces +y, out of the building)
        self.liv = room("liv", "A1-1", "LIV/DIN", 0, 4000)
        self.br = room("br", "A1-2", "BR1", 4000, 8000)

    def test_a_window_in_one_room(self):
        hits, note = LV.serving_rooms(item(2000), [self.liv, self.br], [200, 500, 900])
        self.assertEqual([(a["number"], s) for a, s in hits], [("A1-1", 1.0)])
        self.assertEqual(note, "")

    def test_a_curtain_wall_across_two_rooms_is_shared(self):
        hits, note = LV.serving_rooms(item(4000, w=3000, cat="Curtain panels"), [self.liv, self.br], [200, 500, 900])
        shares = dict((a["number"], s) for a, s in hits)
        self.assertAlmostEqual(shares["A1-1"], 0.5, places=2)
        self.assertAlmostEqual(shares["A1-2"], 0.5, places=2)

    def test_part_of_a_panel_facing_no_room(self):
        hits, note = LV.serving_rooms(item(8300, w=1500, cat="Curtain panels"), [self.liv, self.br], [200, 500, 900])
        self.assertEqual(len(hits), 1)
        self.assertLess(hits[0][1], 1.0)
        self.assertIn("part", note)

    def test_nothing_beside_it(self):
        hits, note = LV.serving_rooms(item(20000), [self.liv, self.br], [200, 500, 900])
        self.assertEqual(hits, [])
        self.assertEqual(note, "no room beside it")

    def test_two_floors_of_the_same_plan_do_not_mix(self):
        up = room("liv-up", "A1-1", "LIV/DIN", 0, 4000, level="6/F", level_mm=3000.0)
        up_item = item(2000, z=4500)
        hits, _ = LV.serving_rooms(up_item, [self.liv, up], [200, 500, 900])
        self.assertEqual([a["level"] for a, s in hits], ["6/F"])


class Table(unittest.TestCase):
    def test_a_shared_panel_counts_in_both_rooms(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 4000)
        br = room("br", "A1-2", "BR1", 4000, 8000)
        rows, unmatched, _ = LV.build([liv, br], [item(4000, w=3000, h=2000, cat="Curtain panels", key="W")], TYPES)
        by = dict((r["number"], r) for r in rows)
        # 3.0 x 2.0 x 80% = 4.8 m2 on the whole, half to each room
        self.assertAlmostEqual(by["A1-1"]["prov_light_bd"], 2.4, places=2)
        self.assertAlmostEqual(by["A1-2"]["prov_light_bd"], 2.4, places=2)
        self.assertEqual(unmatched, [])
        self.assertTrue(any("runs past" in n for n in by["A1-1"]["notes"]))

    def test_flat_and_block_come_from_the_room(self):
        liv = room("liv", "101", "LIV/DIN", 0, 4000, flat="T1-5F-A", block="Tower 1")
        rows, _, _ = LV.build([liv], [item(2000)], TYPES)
        self.assertEqual((rows[0]["block"], rows[0]["flat"]), ("Tower 1", "T1-5F-A"))

    def test_bath_without_window_goes_with_the_living_room_of_its_own_flat_and_floor_only(self):
        a_liv = room("l5", "A-1", "LIV/DIN", 0, 4000, flat="A", level="5/F")
        a_bath = room("b5", "A-3", "BATH", 4000, 6000, flat="A", level="5/F")
        b_bath = room("b6", "A-3", "BATH", 4000, 6000, flat="A", level="6/F", level_mm=3000.0)
        rows, _, _ = LV.build([a_liv, a_bath, b_bath], [item(2000)], TYPES)
        by = dict(((r["level"], r["number"]), r) for r in rows)
        self.assertTrue(by[("5/F", "A-3")]["status"].startswith("WITH"))
        self.assertFalse(by[("6/F", "A-3")]["status"].startswith("WITH"))

    def test_ok_and_not_ok(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 4000, y1=4000)      # 16 m2: needs 1.6 m2 light, 1 m2 open
        rows, _, _ = LV.build([liv], [item(2000, w=2000, h=1500)], TYPES)   # 2 x 1.5 x 0.8 = 2.4 m2
        self.assertEqual(rows[0]["status"], "OK")
        rows, _, _ = LV.build([liv], [item(2000, w=800, h=1000)], TYPES)    # 0.64 m2
        self.assertEqual(rows[0]["status"], "NOT OK")


if __name__ == "__main__":
    unittest.main()
