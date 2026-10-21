# -*- coding: utf-8 -*-
"""Tests of the parts of the lighting and ventilation check that need no Revit:
    python3 -m unittest discover -s revit/tests -v
"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "LWK.extension", "lib"))
from lwk_viewer import lvcheck as LV


def room(key, number, name, x0, x1, y0=0, y1=4000, level="5/F", flat="A1", block="T1", level_mm=0.0, area=None):
    return {"id": hash(key) % 100000, "uid": key, "key": key, "number": number, "name": name, "flat": flat, "block": block,
            "area_m2": area or (x1 - x0) * (y1 - y0) / 1e6, "level": level, "level_mm": level_mm,
            "loops": [[(x0, y0), (x1, y0), (x1, y1), (x0, y1)]]}


def item(x, w=1500, y=4000, key="W", cat="Windows", h=1500, n=(0, 1), z=1500, glass=None, glaze_exact=None, open_exact=None,
        bottom_mm=None, top_mm=None, open_w_mm=None, open_h_mm=None, open_left_mm=None, uid=None,
        glaze_w_mm=None, glaze_h_mm=None, glass_diag=None):
    return {"id": 1, "uid": uid or ("u" + key), "cat": cat, "key": key, "mark": "", "pos": (x, y, z), "n": n,
            "w_mm": w, "h_mm": h, "glass_m2": glass, "fraction_override": None,
            "glaze_m2_exact": glaze_exact, "open_m2_exact": open_exact,
            "glaze_w_mm": glaze_w_mm, "glaze_h_mm": glaze_h_mm,
            "open_w_mm": open_w_mm, "open_h_mm": open_h_mm, "open_left_mm": open_left_mm,
            "bottom_mm": z - h / 2.0 if bottom_mm is None else bottom_mm,
            "top_mm": z + h / 2.0 if top_mm is None else top_mm, "glass_diag": glass_diag}


def door(x, y, n, z=1500):
    """A plain door between two rooms, for the adjacency-based compensation tests.
    n is the facing direction across the door (either room is "either side")."""
    return {"id": 9, "uid": "d%s-%s" % (x, y), "pos": (x, y, z), "n": n}


TYPES = {"W": {"operation": "Casement", "fraction": 1.0, "confirmed": True}}


class RoomFlags(unittest.TestCase):
    def test_window_calculation_lets_a_room_in_without_ufa_or_ufs(self):
        # a bathroom/powder/utility room is commonly ticked No for both UFA_Y/N and UFS_Y/N (it
        # isn't counted toward either), but still needs its own L&V checked - a separate
        # "Window Calculation" tick lets it in without having to touch UFA/UFS at all
        self.assertIn("Window Calculation", LV.DEFAULT_RULES["room_flags"])


class UseNames(unittest.TestCase):
    def test_names_of_the_ufa_rooms(self):
        for name, use in [("LIV/DIN", "LIV"), ("O.KIT", "OKIT"), ("OPEN KIT", "OKIT"), ("KIT", "KIT"), ("KIT.", "KIT"),
                          ("BR1", "BED"), ("BR4", "BED"), ("MBR", "BED"), ("STO.", "STO"), ("BATH", "BATH"),
                          ("MBATH", "BATH"), ("M.BATH", "BATH"), ("POWDER ROOM", "BATH"), ("UTI.", "UTI"),
                          ("CLOAK AREA", None)]:
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
        # 3.0 x 2.0 x 70% = 4.2 m2 on the whole, half to each room
        self.assertAlmostEqual(by["A1-1"]["prov_light_bd"], 2.1, places=2)
        self.assertAlmostEqual(by["A1-2"]["prov_light_bd"], 2.1, places=2)
        self.assertEqual(unmatched, [])
        self.assertTrue(any("runs past" in n for n in by["A1-1"]["notes"]))

    def test_flat_and_block_come_from_the_room(self):
        liv = room("liv", "101", "LIV/DIN", 0, 4000, flat="T1-5F-A", block="Tower 1")
        rows, _, _ = LV.build([liv], [item(2000)], TYPES)
        self.assertEqual((rows[0]["block"], rows[0]["flat"]), ("Tower 1", "T1-5F-A"))

    def test_bath_without_window_goes_with_the_room_its_door_leads_to_in_its_own_flat_and_floor_only(self):
        a_liv = room("l5", "A-1", "LIV/DIN", 0, 4000, flat="A", level="5/F")
        a_bath = room("b5", "A-3", "BATH", 4000, 6000, flat="A", level="5/F")
        b_bath = room("b6", "A-3", "BATH", 4000, 6000, flat="A", level="6/F", level_mm=3000.0)
        a_door = door(4000, 2000, (1, 0))
        rows, _, _ = LV.build([a_liv, a_bath, b_bath], [item(2000)], TYPES, doors=[a_door])
        by = dict(((r["level"], r["number"]), r) for r in rows)
        self.assertEqual(by[("5/F", "A-3")]["status"], "WITH A-1")
        self.assertFalse(by[("6/F", "A-3")]["status"].startswith("WITH"))

    def test_a_bath_with_an_insufficient_window_still_relays_through_its_door(self):
        liv = room("liv", "A-1", "LIV/DIN", 0, 4000)
        bath = room("bath", "A-3", "BATH", 4000, 6000, y1=2000)   # 8 m2: needs 0.8 m2 light and open
        a_door = door(4000, 1000, (1, 0))
        rows, _, _ = LV.build([liv, bath], [item(5000, w=400, h=500, y=2000)], TYPES, doors=[a_door])  # 0.2 x 0.25 x 0.7 = 0.035 m2 - not enough
        by = dict((r["number"], r) for r in rows)
        self.assertEqual(by["A-3"]["status"], "WITH A-1")

    def test_relays_into_whichever_room_the_door_actually_leads_to_not_always_liv(self):
        kit = room("kit", "A-2", "O.KIT", 0, 4000)
        bath = room("bath", "A-3", "BATH", 4000, 6000)
        a_door = door(4000, 2000, (1, 0))
        rows, _, _ = LV.build([kit, bath], [item(2000)], TYPES, doors=[a_door])
        by = dict((r["number"], r) for r in rows)
        self.assertEqual(by["A-3"]["status"], "WITH A-2")

    def test_two_equally_valid_neighbours_are_flagged_instead_of_guessed(self):
        liv = room("liv", "A-1", "LIV/DIN", 0, 4000, y0=0, y1=4000)
        kit = room("kit", "A-2", "O.KIT", 4000, 8000, y0=0, y1=4000)
        bath = room("bath", "A-3", "BATH", 0, 8000, y0=4000, y1=6000)
        d1 = door(2000, 4000, (0, 1))
        d2 = door(6000, 4000, (0, 1))
        rows, _, _ = LV.build([liv, kit, bath], [item(4000, y=5000)], TYPES, doors=[d1, d2])
        by = dict((r["number"], r) for r in rows)
        self.assertEqual(by["A-3"]["status"], "NEEDS DATA")
        self.assertTrue(any("more than one room" in n for n in by["A-3"]["notes"]))

    def test_an_open_kitchen_with_no_door_merges_into_the_room_it_touches(self):
        # an open-plan kitchen: no door at all between it and the living room, just a shared
        # boundary (a room-separation line in the model, not a wall) - door_adjacent_rooms finds
        # nothing here since there is no door, so this needs the boundary fallback
        liv = room("liv", "A-1", "LIV/DIN", 0, 4000)
        kit = room("kit", "A-2", "O.KIT", 4000, 8000)
        rows, _, _ = LV.build([liv, kit], [item(2000)], TYPES, doors=[])
        by = dict((r["number"], r) for r in rows)
        self.assertEqual(by["A-2"]["status"], "WITH A-1")

    def test_no_door_found_leaves_the_room_as_is(self):
        bath = room("bath", "A-3", "BATH", 0, 4000)
        rows, _, _ = LV.build([bath], [], TYPES, doors=[])
        self.assertEqual(rows[0]["status"], "NO WINDOW")
        self.assertTrue(any("no door- or boundary-connected room" in n for n in rows[0]["notes"]))

    def test_ok_and_not_ok(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 4000, y1=4000)      # 16 m2: needs 1.6 m2 light, 1 m2 open
        rows, _, _ = LV.build([liv], [item(2000, w=2000, h=1500)], TYPES)   # 2 x 1.5 x 0.7 = 2.1 m2
        self.assertEqual(rows[0]["status"], "OK")
        rows, _, _ = LV.build([liv], [item(2000, w=800, h=1000)], TYPES)    # 0.8 x 1.0 x 0.7 = 0.56 m2
        self.assertEqual(rows[0]["status"], "NOT OK")

    def test_the_glazing_ratio_is_point_seven_not_point_eight(self):
        self.assertEqual(LV.DEFAULT_RULES["glazing_factor"], 0.7)

    def test_a_family_s_own_glazing_and_openable_dimensions_are_used_when_present(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 4000)    # 16 m2: needs 1.6 m2 light, 1 m2 open
        # width x height x 0.7 alone would be 2 x 1.5 x 0.7 = 2.1 m2, openable 2.1 x 1.0 = 2.1 m2 -
        # but the family's own GBP_Glazing_*/GBP_Openable_* say otherwise
        rows, _, _ = LV.build([liv], [item(2000, w=2000, h=1500, glaze_exact=1.65, open_exact=0.4)], TYPES)
        self.assertAlmostEqual(rows[0]["prov_light_bd"], 1.65, places=2)
        self.assertAlmostEqual(rows[0]["prov_open_bd"], 0.4, places=2)
        self.assertEqual(rows[0]["status"], "NOT OK")   # openable 0.4 < 1 m2 required
        self.assertTrue(any("GBP_Glazing" in n for n in rows[0]["notes"]))

    def test_measured_glass_decides_ok_not_ok_over_the_nominal_figure(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 4000)    # needs 1.6 m2 light, 1 m2 open
        # nominal (2 x 1.5 x 0.7 = 2.1 m2) would pass, but the measured glass (the curtain
        # wall's opaque upstand/spandrel excluded) is less than what's required
        rows, _, _ = LV.build([liv], [item(2000, w=2000, h=1500, glass=1.2)], TYPES)
        self.assertAlmostEqual(rows[0]["prov_light_bd"], 2.1, places=2)
        self.assertAlmostEqual(rows[0]["prov_light_meas"], 1.2, places=2)
        self.assertEqual(rows[0]["status"], "NOT OK")


class AssumedFullOpen(unittest.TestCase):
    def test_no_openable_data_at_all_assumes_the_whole_glazing_opens(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 4000)   # 16 m2: needs 1.6 m2 light, 1 m2 open
        # key "UNKNOWN" has no TYPES entry and guess_operation can't classify it from its name,
        # and it has no GBP_Openable_* dims either - nothing at all to go on
        rows, _, _ = LV.build([liv], [item(2000, w=2000, h=1500, key="UNKNOWN")], {})
        w = rows[0]["windows"][0]
        self.assertEqual(w["fraction"], 1.0)
        self.assertTrue(w["confirmed"])
        self.assertAlmostEqual(rows[0]["prov_open_bd"], rows[0]["prov_light_bd"], places=3)
        self.assertTrue(any("assumed the whole glazing opens" in n for n in rows[0]["notes"]))
        self.assertNotEqual(rows[0]["status"], "NEEDS DATA")

    def test_a_guessed_but_unconfirmed_type_is_unaffected(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 4000)
        # "CASEMENT" is guessed (fraction 1.0) but not confirmed - still needs the AP's say-so,
        # the assumed-full-open rule must not quietly wave that through
        rows, _, _ = LV.build([liv], [item(2000, w=2000, h=1500, key="CASEMENT WINDOW")], {})
        w = rows[0]["windows"][0]
        self.assertFalse(w["confirmed"])
        self.assertFalse(w.get("assumed_full_open"))
        self.assertEqual(rows[0]["status"], "NEEDS DATA")


class DoorProbeDepth(unittest.TestCase):
    def test_a_door_does_not_tunnel_through_a_narrow_corridor_into_the_room_beyond(self):
        # BR1 (0-2000) -- door at 2000 -- an unnamed 400mm corridor (2000-2400, never collected
        # as a room at all, since it has no recognised use) -- O.KIT (2400-6400). The door really
        # only opens onto the corridor, not into O.KIT - a probe deep enough to reach past the
        # corridor (900mm, the window probe) would wrongly read it as opening straight into O.KIT
        br1 = room("br1", "A-2", "BR1", 0, 2000)
        kit = room("kit", "A-3", "O.KIT", 2400, 6400)
        a_door = door(2000, 1000, (1, 0))
        rows, _, _ = LV.build([br1, kit], [], TYPES, doors=[a_door])
        by = dict((r["number"], r) for r in rows)
        # O.KIT has no window and no real door- or boundary-connected neighbour within reach -
        # it must NOT merge into BR1 (the old, deeper probe's false reading)
        self.assertNotEqual(by["A-3"]["status"], "WITH A-2")
        self.assertFalse(by["A-3"]["status"].startswith("WITH"))


class KitchenAndUtility(unittest.TestCase):
    def test_an_enclosed_kitchen_never_merges_even_when_not_ok(self):
        # "KIT." (enclosed) has its own door/wall, unlike "O.KIT" - it must always stand on
        # its own, even when its own window is not enough, not be quietly folded into LIV
        liv = room("liv", "A-1", "LIV/DIN", 0, 4000)
        kit = room("kit", "A-2", "KIT.", 4000, 6000, y1=2000)   # 4 m2: needs 0.4 m2 light/open
        a_door = door(4000, 1000, (1, 0))
        rows, _, _ = LV.build([liv, kit], [item(5000, w=400, h=500, y=2000)], TYPES, doors=[a_door])
        by = dict((r["number"], r) for r in rows)
        self.assertEqual(by["A-2"]["status"], "NOT OK")
        self.assertFalse(by["A-2"]["status"].startswith("WITH"))

    def test_a_utility_room_prefers_the_kitchen_over_another_neighbour(self):
        kit = room("kit", "A-2", "KIT.", 0, 4000, y0=0, y1=4000)
        bed = room("bed", "A-3", "BR1", 4000, 8000, y0=0, y1=4000)
        uti = room("uti", "A-4", "UTI.", 0, 8000, y0=4000, y1=6000)
        d_kit = door(2000, 4000, (0, 1))
        d_bed = door(6000, 4000, (0, 1))
        # the windows sit on each room's own OUTER wall (y=0, facing away from uti), not on the
        # wall shared with uti - a window right on a shared wall would read as "between two rooms"
        rows, _, _ = LV.build([kit, bed, uti], [item(2000, y=0, n=(0, -1), w=2000, h=1500),
                                                item(6000, y=0, n=(0, -1), w=2000, h=1500)],
                              TYPES, doors=[d_kit, d_bed])
        by = dict((r["number"], r) for r in rows)
        self.assertEqual(by["A-4"]["status"], "WITH A-2")


class MergedRowDisplay(unittest.TestCase):
    def test_the_merged_away_room_s_own_required_figures_are_not_shown_again(self):
        liv = room("liv", "A-1", "LIV/DIN", 0, 4000)
        kit = room("kit", "A-2", "O.KIT", 4000, 8000)
        rows, _, _ = LV.build([liv, kit], [item(2000)], TYPES, doors=[])
        by = dict((r["number"], r) for r in rows)
        self.assertEqual(by["A-2"]["status"], "WITH A-1")
        self.assertIsNone(by["A-2"]["req_light"])
        self.assertIsNone(by["A-2"]["req_open"])
        self.assertIsNotNone(by["A-1"]["req_light"])

    def test_the_host_room_s_windows_list_also_carries_the_merged_room_s_own_windows(self):
        liv = room("liv", "A-1", "LIV/DIN", 0, 4000)
        kit = room("kit", "A-2", "O.KIT", 4000, 8000)
        liv_window = item(2000, key="LIVWIN")
        kit_window = item(5000, key="KITWIN", glaze_exact=0.2)   # not enough on its own - still merges
        types = dict(TYPES, LIVWIN=TYPES["W"], KITWIN=TYPES["W"])
        rows, _, _ = LV.build([liv, kit], [liv_window, kit_window], types, doors=[])
        by = dict((r["number"], r) for r in rows)
        keys = sorted(w["key"] for w in by["A-1"]["windows"])
        self.assertEqual(keys, ["KITWIN", "LIVWIN"])


class Dedup(unittest.TestCase):
    """collect_items/collect_doors dedupe by (source label, UniqueId) before build() ever sees
    them - this exercises what build() would otherwise do with a not-yet-deduped items list (the
    real collect_items-level dedup itself needs live Revit to verify end to end: a project with
    the same linked model placed twice, or any other way the same element reaches the collector
    more than once, must still only count it once)."""

    def test_a_shared_panel_appearing_twice_still_shares_its_true_single_share_once(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 4000)
        br = room("br", "A1-2", "BR1", 4000, 8000)
        shared = item(4000, w=3000, h=2000, cat="Curtain panels", key="W")
        duplicate = dict(shared)   # the exact same element, collected a second time
        rows, _, _ = LV.build([liv, br], [shared, duplicate], TYPES)
        by = dict((r["number"], r) for r in rows)
        # with the duplicate correctly removed upstream, each room's own window list has one
        # entry, not two, and its provided figure is not doubled
        self.assertEqual(len(by["A1-1"]["windows"]), 1)
        self.assertAlmostEqual(by["A1-1"]["prov_light_bd"], 2.1, places=2)


class GlassDiagnostic(unittest.TestCase):
    def test_materials_seen_but_not_read_as_glass_are_reported_when_nothing_could_be_measured(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 4000)
        w = item(2000, w=2000, h=1500, key="EXT", glass_diag=[u"Kitchen Frame [Metal]"])
        rows, _, _ = LV.build([liv], [w], TYPES)
        self.assertTrue(any("Kitchen Frame" in n for n in rows[0]["notes"]))

    def test_no_note_when_the_family_gives_its_own_exact_glazing_size_anyway(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 4000)
        w = item(2000, w=2000, h=1500, key="EXT", glaze_exact=1.5, glass_diag=[u"Kitchen Frame [Metal]"])
        rows, _, _ = LV.build([liv], [w], TYPES)
        self.assertFalse(any("Kitchen Frame" in n for n in rows[0]["notes"]))


class JsonSafe(unittest.TestCase):
    def test_a_value_the_stock_encoder_rejects_still_serializes(self):
        class WeirdInt(object):
            """stands in for a boxed .NET Int64, which IronPython shows with
            Python 2's long repr but whose json module still rejects"""
            def __int__(self):
                return 544042
            def __repr__(self):
                return "544042L"
        room = {"id": WeirdInt(), "uid": "u", "flat": "A1", "block": "", "level": "5/F", "number": "1",
                "name": "LIV/DIN", "use": "LIV", "area_m2": 10.0, "with": [], "req_light": 1.0, "req_open": 0.5,
                "prov_light_bd": None, "prov_open_bd": None, "prov_light_meas": None, "prov_open_meas": None,
                "status": "NEEDS DATA", "notes": [], "windows": []}
        import tempfile, os as _os
        fd, path = tempfile.mkstemp(suffix=".json")
        _os.close(fd)
        try:
            LV.write_json(path, [room], [], {})
            with open(path) as f:
                data = json.load(f)
            self.assertEqual(data["rooms"][0]["id"], 544042)
        finally:
            _os.remove(path)


class LengthVsNumberParameter(unittest.TestCase):
    """_param_d needs live Revit, so this exercises the same length-vs-number decision
    through a fake parameter object, the way units.py._spec() is also shaped."""

    class FakeDef(object):
        def __init__(self, is_length):
            self._is_length = is_length

        def GetDataType(self):
            class T(object):
                TypeId = "autodesk.spec.aec:length-2.0.0" if self._is_length else "autodesk.spec:number-2.0.0"
            return T()

    class FakeParam(object):
        def __init__(self, is_length):
            self.Definition = LengthVsNumberParameter.FakeDef(is_length)

    def test_a_length_parameter_is_recognised(self):
        self.assertTrue(LV._is_length_param(self.FakeParam(True)))

    def test_a_number_parameter_is_not(self):
        self.assertFalse(LV._is_length_param(self.FakeParam(False)))


class FuzzyParamName(unittest.TestCase):
    """_param_d_like needs live Revit for the real thing, so this exercises the
    name-matching and the length-vs-number decision through fake Element/
    Parameter objects."""

    class FakeDef(object):
        def __init__(self, name, is_length):
            self.Name = name
            self._is_length = is_length

        def GetDataType(self):
            class T(object):
                TypeId = "autodesk.spec.aec:length-2.0.0" if self._is_length else "autodesk.spec:number-2.0.0"
            return T()

    class FakeParam(object):
        def __init__(self, name, value, is_length=False):
            self.Definition = FuzzyParamName.FakeDef(name, is_length)
            self._value = value
            self.HasValue = True
            self.StorageType = "Double"

        def AsDouble(self):
            return self._value

    class FakeElement(object):
        def __init__(self, params):
            self.Parameters = params

            class Doc(object):
                def GetElement(self_inner, type_id):
                    return None
            self.Document = Doc()

        def GetTypeId(self):
            return None

    def test_finds_a_parameter_by_what_its_name_contains_regardless_of_spelling(self):
        for name in ("GBP_Openable_Width", "GBP Openable Width", "GBP-OpenableWidth", "openable width (mm)"):
            el = self.FakeElement([self.FakeParam(name, 612.5)])
            self.assertAlmostEqual(LV._param_d_like(el, ("openable", "width")), 612.5, places=2)

    def test_a_parameter_missing_one_of_the_keywords_does_not_match(self):
        el = self.FakeElement([self.FakeParam("GBP_Glazing_Width", 2600.0)])
        self.assertIsNone(LV._param_d_like(el, ("openable", "width")))

    def test_a_length_parameter_is_converted_a_number_one_is_not(self):
        el = self.FakeElement([self.FakeParam("GBP_Openable_Width", 2.0, is_length=True)])
        self.assertAlmostEqual(LV._param_d_like(el, ("openable", "width")), 2.0 * LV.FT_MM, places=1)
        el2 = self.FakeElement([self.FakeParam("GBP_Openable_Width", 612.5, is_length=False)])
        self.assertAlmostEqual(LV._param_d_like(el2, ("openable", "width")), 612.5, places=2)

    def test_gbp_dims_mm_finds_all_four_in_one_pass_over_the_parameters(self):
        # a project with thousands of panels made four full parameter scans each when this
        # looked up glazing/openable width/height one at a time - _gbp_dims_mm must find all
        # four from a single list of parameters, not rescan it four times
        seen = []

        class CountingParams(list):
            def __iter__(self):
                seen.append(1)
                return list.__iter__(self)

        el = self.FakeElement(CountingParams([
            self.FakeParam("GBP_Glazing_Width", 2600.0),
            self.FakeParam("GBP_Glazing_Height", 2600.0),
            self.FakeParam("GBP_Openable_Width", 2550.0),
            self.FakeParam("GBP_Openable_Height", 612.5),
        ]))
        gw, gh, ow, oh, o_off, o_left = LV._gbp_dims_mm(el)
        self.assertEqual((gw, gh, ow, oh), (2600.0, 2600.0, 2550.0, 612.5))
        self.assertIsNone(o_off)
        self.assertIsNone(o_left)
        self.assertEqual(len(seen), 1)

    def test_gbp_dims_mm_finds_an_openable_offset_when_the_family_has_one(self):
        el = self.FakeElement([
            self.FakeParam("GBP_Glazing_Width", 1940.0),
            self.FakeParam("GBP_Glazing_Height", 2600.0),
            self.FakeParam("GBP_Openable_Width", 970.0),
            self.FakeParam("GBP_Openable_Height", 2600.0),
            self.FakeParam("GBP_Openable_Offset", 50.0),
        ])
        gw, gh, ow, oh, o_off, o_left = LV._gbp_dims_mm(el)
        self.assertEqual(o_off, 50.0)
        self.assertIsNone(o_left)


class Excludes(unittest.TestCase):
    """load_excludes/save_excludes: a hand-picked list of element UniqueIds left
    out of the check (a balcony grille, a service door ...), independent of any
    Revit parameter - so it works even on an element in a non-editable link."""

    def test_round_trips_and_defaults_to_empty(self):
        import tempfile, os as _os
        fd, path = tempfile.mkstemp(suffix=".json")
        _os.close(fd)
        _os.remove(path)
        try:
            self.assertEqual(LV.load_excludes(path), set())
            LV.save_excludes({"uid-a", "uid-b"}, path)
            self.assertEqual(LV.load_excludes(path), {"uid-a", "uid-b"})
        finally:
            if _os.path.exists(path):
                _os.remove(path)


class CsvWindowsColumn(unittest.TestCase):
    """A window's own Type Mark (e.g. "28") must never read like a count of
    how many of that window there are - write_csv labels it "mark 28: ...",
    not "28 ..." (which one physical window with mark "28" made 1940 x 2550
    look like "28 of them" - a real cause of confusion, not a modelling bug)."""

    def test_a_numeric_mark_is_not_mistaken_for_a_count(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 4000)
        rows, _, _ = LV.build([liv], [item(2000, w=1940, h=2550, key="K")], TYPES)
        rows[0]["windows"][0]["mark"] = "28"
        import tempfile, os as _os
        fd, path = tempfile.mkstemp(suffix=".csv")
        _os.close(fd)
        try:
            LV.write_csv(path, rows)
            with open(path, "rb") as f:
                text = f.read().decode("utf-8-sig")
            self.assertIn(u"mark 28: 1940 x 2550 mm", text)
            self.assertNotIn(u",28 1940", text)
        finally:
            _os.remove(path)


class ImplausibleOpening(unittest.TestCase):
    def test_a_window_far_too_big_for_one_opening_forces_needs_data(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 4000)
        rows, _, _ = LV.build([liv], [item(2000, w=12000, h=12000)], TYPES)   # 12 x 12 x 0.8 = 115.2 m2
        self.assertEqual(rows[0]["status"], "NEEDS DATA")
        self.assertTrue(any("too large for one window" in n for n in rows[0]["notes"]))

    def test_an_ordinary_window_is_unaffected(self):
        liv = room("liv", "A1-1", "LIV/DIN", 0, 4000)
        rows, _, _ = LV.build([liv], [item(2000, w=2000, h=1500)], TYPES)
        self.assertFalse(any("too large" in n for n in rows[0]["notes"]))


if __name__ == "__main__":
    unittest.main()
