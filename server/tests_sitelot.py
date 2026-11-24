"""Site study: finding a lot by its number (sitelot.py).

    python3 tests_sitelot.py
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import sitelot  # noqa: E402


class LotTests(unittest.TestCase):
    def test_lot_numbers(self):
        for q in ["STTL 121", "TKOTL 137", "IL 152", "KIL 11262", "DD 123 Lot 456", "STTL 12 S.A", "NKIL 6512 RP"]:
            self.assertTrue(sitelot.looks_like_lot(q), q)
        for q in ["Tseung Kwan O", "123 Nathan Road", "", "Area 137"]:
            self.assertFalse(sitelot.looks_like_lot(q), q)

    def test_gml(self):
        with open(os.path.join(HERE, "tests_lot_sample.gml"), "rb") as f:
            feats = sitelot.parse_gml(f.read())
        self.assertEqual(len(feats), 1)
        f = feats[0]
        self.assertEqual(f["id"], "1800260551")
        self.assertEqual(f["name"], "STTL 121")
        self.assertEqual(len(f["rings"][0]), 5)
        self.assertTrue(sitelot.inside(f["rings"][0], 836374.45, 826277.03))
        self.assertFalse(sitelot.inside(f["rings"][0], 836300, 826277))


if __name__ == "__main__":
    unittest.main()
