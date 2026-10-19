# -*- coding: utf-8 -*-
"""lvdiagram.build_diagrams: the schematic elevation layout, no Revit needed.
    python3 -m unittest discover -s revit/tests -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "LWK.extension", "lib"))
from lwk_viewer import lvcheck as LV
from lwk_viewer import lvdiagram as LD
from test_lvcheck import room, item

TYPES = {"FIX": {"operation": "Fixed", "fraction": 0.0, "confirmed": True},
         "OPEN": {"operation": "Casement / top hung / projecting (opens fully)", "fraction": 1.0, "confirmed": True}}


class Grouping(unittest.TestCase):
    def test_two_side_by_side_windows_on_the_same_wall_are_one_run(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 8000)
        a = item(1000, w=1500, key="A")
        b = item(2800, w=1500, key="B")   # 2800-750=2050, right edge of a is 1000+750=1750: gap 300mm < 600mm
        rows, _, _ = LV.build([liv], [a, b], TYPES)
        diagrams = LD.build_diagrams(rows, [a, b], {("", "5/F"): 3000.0})
        self.assertEqual(len(diagrams), 1)
        self.assertEqual(len(diagrams[0]["rects"]), 2)

    def test_a_big_gap_along_the_same_wall_splits_into_two_runs(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 8000)
        a = item(1000, w=1500, key="A")
        b = item(5000, w=1500, key="B")   # far apart: separate runs
        rows, _, _ = LV.build([liv], [a, b], TYPES)
        diagrams = LD.build_diagrams(rows, [a, b], {("", "5/F"): 3000.0})
        self.assertEqual(len(diagrams), 2)

    def test_different_facing_walls_are_never_the_same_run(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 4000, y1=4000)
        a = item(2000, y=4000, n=(0, 1), key="A")       # north wall
        b = item(2000, y=0, n=(0, -1), key="B")         # south wall, same room
        rows, _, _ = LV.build([liv], [a, b], TYPES)
        diagrams = LD.build_diagrams(rows, [a, b], {("", "5/F"): 3000.0})
        self.assertEqual(len(diagrams), 2)


class Layout(unittest.TestCase):
    def test_a_slightly_different_facing_direction_on_one_item_does_not_misplace_it(self):
        # same physical wall, but one item's own facing reads very slightly off the others'
        # (an operable family reporting the direction its sash swings, say, instead of the
        # frame's true outward normal) - a real case that put a window outside its own run's
        # width in the rendered diagram
        liv = room("liv", "A1-1", "LIV/DIN", 0, 8000, level_mm=0.0)
        a = item(500, w=1000, n=(0.0, 1.0), key="A")
        b = item(1500, w=1000, n=(0.0, 1.0), key="B")
        c = item(2500, w=1000, n=(0.01, 0.9999), key="C")   # fractionally different n, same wall
        rows, _, _ = LV.build([liv], [a, b, c], TYPES)
        diagrams = LD.build_diagrams(rows, [a, b, c], {("", "5/F"): 3000.0})
        self.assertEqual(len(diagrams), 1)
        by_key = dict((r["key"], r) for r in diagrams[0]["rects"])
        # evenly spaced 1000mm apart in the model - must stay evenly spaced in the drawing too
        self.assertAlmostEqual(abs(by_key["B"]["left"] - by_key["A"]["left"]), 1000.0, places=1)
        self.assertAlmostEqual(abs(by_key["C"]["left"] - by_key["B"]["left"]), 1000.0, places=1)
        self.assertLessEqual(by_key["C"]["left"] + by_key["C"]["width"], diagrams[0]["width_mm"] + 0.01)


    def test_rectangles_are_at_their_real_relative_position_and_height_above_the_floor(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 8000, level_mm=10000.0)
        a = item(1000, w=1000, h=2000, z=1000 + 10000.0, key="A")   # bottom at floor + 0mm (sill on the floor)
        b = item(2200, w=1000, h=1000, z=2700 + 10000.0, key="B")   # bottom at floor + 2200mm
        rows, _, _ = LV.build([liv], [a, b], TYPES)
        diagrams = LD.build_diagrams(rows, [a, b], {("", "5/F"): 3000.0})
        self.assertEqual(len(diagrams), 1)
        by_key = dict((r["key"], r) for r in diagrams[0]["rects"])
        self.assertAlmostEqual(by_key["A"]["bottom"], 0.0, places=3)
        self.assertAlmostEqual(by_key["B"]["bottom"], 2200.0, places=3)
        # the two real left edges (500 and 1700, from each item's own centre x its width) stay 1200mm apart
        self.assertAlmostEqual(abs(by_key["B"]["left"] - by_key["A"]["left"]), 1200.0, places=3)

    def test_gaps_are_inferred_above_and_below_the_real_items(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 8000, level_mm=0.0)
        a = item(1000, w=1000, h=1500, z=750 + 400.0, key="A")   # bottom at 400mm above floor
        rows, _, _ = LV.build([liv], [a], TYPES)
        diagrams = LD.build_diagrams(rows, [a], {("", "5/F"): 3000.0})
        d = diagrams[0]
        self.assertEqual(len(d["gaps"]), 2)
        lower, upper = sorted(d["gaps"], key=lambda g: g["bottom"])
        self.assertAlmostEqual(lower["bottom"], 0.0, places=3)
        self.assertAlmostEqual(lower["height"], 400.0, places=3)
        self.assertAlmostEqual(upper["bottom"], 1900.0, places=3)   # 400 + 1500
        self.assertAlmostEqual(upper["height"], 1100.0, places=3)   # 3000 - 1900

    def test_draws_the_elements_own_height_parameter_not_its_bounding_box_span(self):
        # a family whose bounding box (top_mm - bottom_mm) disagrees with its own Height
        # parameter (h_mm) - draw h_mm, the number the room's own light/open figures are
        # computed from, not a second, independently-derived figure that could disagree with it
        liv = room("liv", "A1-1", "LIV/DIN", 0, 8000, level_mm=0.0)
        a = item(1000, w=550, h=1455, z=1094.0 + 1455.0 / 2.0, key="A", bottom_mm=1094.0, top_mm=1094.0 + 1975.0)
        rows, _, _ = LV.build([liv], [a], TYPES)
        diagrams = LD.build_diagrams(rows, [a], {("", "5/F"): 3000.0})
        self.assertAlmostEqual(diagrams[0]["rects"][0]["height"], 1455.0, places=3)

    def test_no_gap_drawn_when_the_item_fills_the_whole_height(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 8000, level_mm=0.0)
        a = item(1000, w=1000, h=3000, z=1500.0, key="A")
        rows, _, _ = LV.build([liv], [a], TYPES)
        diagrams = LD.build_diagrams(rows, [a], {("", "5/F"): 3000.0})
        self.assertEqual(diagrams[0]["gaps"], [])


class Colour(unittest.TestCase):
    def test_fixed_openable_and_unconfirmed_are_told_apart(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 8000)
        fixed = item(1000, w=1000, key="FIX")
        openable = item(2200, w=1000, key="OPEN")
        unknown = item(3400, w=1000, key="UNK")
        rows, _, _ = LV.build([liv], [fixed, openable, unknown], TYPES)
        diagrams = LD.build_diagrams(rows, [fixed, openable, unknown], {("", "5/F"): 3000.0})
        colours = dict((r["mark"] or r["key"], r["color"]) for r in diagrams[0]["rects"])
        self.assertEqual(colours["FIX"], "fixed")
        self.assertEqual(colours["OPEN"], "openable")
        self.assertEqual(colours["UNK"], "unconfirmed")


class RoomSummary(unittest.TestCase):
    def test_the_room_s_own_numbers_are_carried_onto_the_diagram(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 4000)   # 16 m2
        a = item(2000, w=2000, h=1500, key="FIX")
        rows, _, _ = LV.build([liv], [a], TYPES)
        diagrams = LD.build_diagrams(rows, [a], {("", "5/F"): 3000.0})
        d = diagrams[0]
        self.assertAlmostEqual(d["area_m2"], 16.0, places=2)
        self.assertEqual(d["status"], rows[0]["status"])
        self.assertAlmostEqual(d["req_light"], rows[0]["req_light"], places=3)
        self.assertAlmostEqual(d["prov_light_bd"], rows[0]["prov_light_bd"], places=3)


class SharedPanel(unittest.TestCase):
    def test_a_panel_shared_between_two_rooms_gets_its_own_diagram_in_each(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 4000)
        br = room("br", "A1-2", "BR1", 4000, 8000)
        shared = item(4000, w=3000, h=2000, cat="Curtain panels", key="W")
        rows, _, _ = LV.build([liv, br], [shared], TYPES)
        diagrams = LD.build_diagrams(rows, [shared], {("", "5/F"): 3000.0})
        self.assertEqual(len(diagrams), 2)
        self.assertEqual(sorted(d["number"] for d in diagrams), ["A1-1", "A1-2"])


if __name__ == "__main__":
    unittest.main()
