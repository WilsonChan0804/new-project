# -*- coding: utf-8 -*-
"""Stage 2 (the PDF composer) needs no Revit - this builds a fake manifest and
placeholder images and confirms it produces a readable multi-page PDF.
    python3 -m unittest discover -s revit/tests -v
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))

try:
    import lv_report_pdf as RP
    _HAVE_REPORTLAB = True
except ImportError:
    _HAVE_REPORTLAB = False


@unittest.skipUnless(_HAVE_REPORTLAB, "reportlab is not installed (pip install reportlab)")
class BuildPdf(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp()
        from PIL import Image
        Image.new("RGB", (400, 300), (200, 200, 200)).save(os.path.join(self.folder, "544685.png"))
        manifest = {
            "schema": "lwk.lv.report/1", "version": "test", "elements": [
                {"id": 544685, "uid": "u1", "cat": "Doors", "key": "ARC-DOR-LWK-BAL : ARC-DOR-LWK-BAL", "mark": "1",
                 "source": "host", "w_mm": 1350.0, "h_mm": 1325.0, "glaze_m2_exact": None, "open_m2_exact": None,
                 "image": "544685.png",
                 "rooms": [{"block": "TWR1", "flat": "A1", "level": "4/F", "number": "2", "name": "LIV",
                           "status": "OK", "share": 0.4, "light_bd": 0.501, "light_meas": 0.588,
                           "open_bd": None, "open_meas": None, "exact_dims": False}]},
                {"id": 579669, "uid": "u2", "cat": "Curtain panels", "key": "ARC-CUR-LWK-PAN : OPENING RIGHT-GLS",
                 "mark": "S.H.", "source": "host", "w_mm": 550.0, "h_mm": 1455.0,
                 "glaze_m2_exact": 0.404, "open_m2_exact": 0.28, "image": "missing.png",
                 "rooms": [{"block": "TWR1", "flat": "A1", "level": "4/F", "number": "2", "name": "LIV",
                           "status": "OK", "share": 1.0, "light_bd": 0.28, "light_meas": None,
                           "open_bd": 0.28, "open_meas": None, "exact_dims": True}]},
            ],
        }
        with open(os.path.join(self.folder, "lv_report_manifest.json"), "w") as f:
            json.dump(manifest, f)

    def tearDown(self):
        shutil.rmtree(self.folder, ignore_errors=True)

    def test_one_page_per_element_and_a_missing_image_does_not_crash(self):
        out_path, n = RP.build_pdf(self.folder)
        self.assertEqual(n, 2)
        self.assertTrue(os.path.isfile(out_path))
        with open(out_path, "rb") as f:
            head = f.read(5)
        self.assertEqual(head, b"%PDF-")
        self.assertGreater(os.path.getsize(out_path), 1000)

    def test_pages_are_sorted_by_block_level_flat_room(self):
        data = json.load(open(os.path.join(self.folder, "lv_report_manifest.json")))
        entries = data["elements"]
        ordered = sorted(entries, key=RP._sort_key)
        self.assertEqual([e["id"] for e in ordered], [e["id"] for e in entries])


if __name__ == "__main__":
    unittest.main()
