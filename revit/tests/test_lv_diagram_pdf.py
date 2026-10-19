# -*- coding: utf-8 -*-
"""The schematic diagram PDF composer needs no Revit - this builds a fake
lv_report_manifest.json and confirms it produces a readable multi-page PDF.
    python3 -m unittest discover -s revit/tests -v
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "LWK.extension", "lib", "lwk_viewer"))

try:
    import lv_diagram_pdf as DP
    _HAVE_REPORTLAB = True
except ImportError:
    _HAVE_REPORTLAB = False


def _diagram(number, name=u"LIV"):
    return {
        "block": "TWR1", "level": "4/F", "flat": "A1", "number": number, "name": name,
        "floor_to_floor_mm": 3000.0, "width_mm": 3400.0,
        "area_m2": 10.522, "status": "OK", "req_light": 1.052, "req_open": 0.658,
        "prov_light_bd": 11.31, "prov_light_meas": 4.116, "prov_open_bd": 2.378, "prov_open_meas": 4.116,
        "rects": [
            {"left": 0.0, "width": 1940.0, "bottom": 400.0, "height": 2150.0, "color": "fixed",
             "mark": "28", "key": "CTP-SLD-ARC-Parametric Array_Type2 : 2-Panels",
             "light_bd": 11.31, "light_meas": 4.116, "open_bd": 2.378, "open_meas": 4.116, "share": 1.0, "exact_dims": True},
            {"left": 2000.0, "width": 1350.0, "bottom": 0.0, "height": 1325.0, "color": "openable",
             "mark": "1", "key": "ARC-DOR-LWK-BAL : ARC-DOR-LWK-BAL",
             "light_bd": 0.501, "light_meas": 0.588, "open_bd": None, "open_meas": None, "share": 0.4, "exact_dims": False},
        ],
        "gaps": [{"bottom": 2550.0, "height": 450.0}],
    }


@unittest.skipUnless(_HAVE_REPORTLAB, "reportlab is not installed (pip install reportlab)")
class BuildPdf(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.manifest_path = os.path.join(self.folder, "lv_report_manifest.json")
        with open(self.manifest_path, "w") as f:
            json.dump({"schema": "lwk.lv.diagram/1", "diagrams": [_diagram("2"), _diagram("10")]}, f)

    def tearDown(self):
        shutil.rmtree(self.folder, ignore_errors=True)

    def test_one_page_per_diagram(self):
        out_path, n = DP.build_pdf(self.manifest_path)
        self.assertEqual(n, 2)
        self.assertTrue(os.path.isfile(out_path))
        with open(out_path, "rb") as f:
            head = f.read(5)
        self.assertEqual(head, b"%PDF-")
        self.assertGreater(os.path.getsize(out_path), 1000)

    def test_a_schedule_page_is_added_when_rooms_are_given(self):
        rooms = [{"block": "TWR1", "level": "4/F", "flat": "A1", "number": "2", "name": "LIV", "use": "LIV",
                 "area_m2": 10.522, "req_light": 1.052, "req_open": 0.658, "prov_light_meas": 4.116,
                 "prov_open_meas": 4.116, "status": "OK"},
                {"block": "TWR1", "level": "4/F", "flat": "A1", "number": "200", "name": "O.KIT", "use": "KIT",
                 "area_m2": 3.513, "req_light": 0.351, "req_open": 0.22, "prov_light_meas": 0.0,
                 "prov_open_meas": 0.0, "status": "NO WINDOW"}]
        with open(self.manifest_path, "w") as f:
            json.dump({"schema": "lwk.lv.diagram/1", "diagrams": [_diagram("2")], "rooms": rooms}, f)
        out_path, n = DP.build_pdf(self.manifest_path)
        self.assertEqual(n, 1)
        self.assertTrue(os.path.isfile(out_path))
        self.assertGreater(os.path.getsize(out_path), 1000)

    def test_an_unconfirmed_rect_and_no_gaps_do_not_crash(self):
        d = _diagram("3")
        d["rects"][0]["color"] = "unconfirmed"
        d["gaps"] = []
        with open(self.manifest_path, "w") as f:
            json.dump({"schema": "lwk.lv.diagram/1", "diagrams": [d]}, f)
        out_path, n = DP.build_pdf(self.manifest_path)
        self.assertEqual(n, 1)
        self.assertTrue(os.path.isfile(out_path))


if __name__ == "__main__":
    unittest.main()
