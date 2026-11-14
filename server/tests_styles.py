"""Saved markup styles: only the expected keys and colours are kept.

    python3 tests_styles.py
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import app  # noqa: E402


class CleanStyles(unittest.TestCase):
    def test_keeps_known_keys_only(self):
        r = app.clean_styles({"styles": [{"name": "Red cloud", "type": "cloud", "style": {
            "color": "#FF0000", "width": 0.5, "dash": "dashed", "evil": "x", "font": "<script>", "size": True}}]})
        self.assertEqual(len(r["styles"]), 1)
        s = r["styles"][0]
        self.assertEqual(s["name"], "Red cloud")
        self.assertEqual(s["type"], "cloud")
        self.assertEqual(s["style"], {"color": "#ff0000", "width": 0.5, "dash": "dashed"})
        self.assertTrue(s["id"])

    def test_drops_nameless_empty_and_duplicates(self):
        r = app.clean_styles({"styles": [
            {"name": "", "style": {"color": "#000000"}},
            {"name": "Nothing", "style": {"bad": 1}},
            {"id": "a1", "name": "One", "style": {"color": "#000000"}},
            {"id": "a1", "name": "Again", "style": {"color": "#111111"}},
        ]})
        self.assertEqual([s["name"] for s in r["styles"]], ["One"])

    def test_colours(self):
        r = app.clean_styles({"colours": ["#ABCDEF", "red", "#abcdef", "#12345", 5, "#00ff00"]})
        self.assertEqual(r["colours"], ["#abcdef", "#00ff00"])

    def test_limits_and_junk(self):
        self.assertEqual(app.clean_styles(None), {"styles": [], "colours": [], "hidden": []})
        self.assertEqual(app.clean_styles({"hidden": ["std-red", "../x", "std-red"]})["hidden"], ["std-red", "x"])
        many = {"styles": [{"name": "s%d" % i, "style": {"width": 1}} for i in range(150)],
                "colours": ["#%06x" % i for i in range(100)]}
        r = app.clean_styles(many)
        self.assertEqual(len(r["styles"]), 100)
        self.assertEqual(len(r["colours"]), 60)
        r = app.clean_styles({"styles": [{"name": "x" * 99, "id": "../../etc", "style": {"width": 5000}}]})
        self.assertEqual(r["styles"], [])


if __name__ == "__main__":
    unittest.main()
