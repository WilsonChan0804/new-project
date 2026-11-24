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
        self.assertEqual((f["number"], f["code"], f["type"], f["updated"]), ("121", "7320", "NNG", "2023-12-12"))
        self.assertEqual(len(f["rings"][0]), 5)
        self.assertTrue(sitelot.inside(f["rings"][0], 836374.45, 826277.03))
        self.assertFalse(sitelot.inside(f["rings"][0], 836300, 826277))


    def test_host_fallback(self):
        good = b'{"candidates": [{"address": "STTL 121, Tai Wai", "location": {"x": 836374.4, "y": 826277.0}, "score": 100, "attributes": {"Ref_ID": "1800260551", "PlaceName": "STTL 121", "City": "Tai Wai"}, "extent": {"xmin": 1, "ymin": 2, "xmax": 3, "ymax": 4}}]}'
        seen = []

        def fake(url, timeout):
            seen.append(url)
            if "hkmapservice" in url:
                return b"<html>Service unavailable</html>"
            return good if "/lus/lot/" in url else b'{"candidates": []}'
        r = sitelot.search("STTL 121", fetch=fake)
        self.assertEqual([x["name"] for x in r], ["STTL 121"])
        self.assertTrue(any("hkmapservice" in u for u in seen) and any("geodata" in u for u in seen))

    def test_place_search_hosts(self):
        import gbp
        rows = b'[{"nameEN": "SHA TIN TOWN HALL", "nameZH": "x", "addressEN": "1 TAM KON PO STREET", "x": 837591.0, "y": 826841.0}]'

        def fake(url):
            if "www.map.gov.hk" in url:
                return b'{ "statusCode": 404, "message": "Resource not found" }'
            return rows
        r = gbp.run_search("Sha Tin Town Hall", fetch=fake)
        self.assertEqual(r[0]["name"], "SHA TIN TOWN HALL")
        self.assertEqual(gbp.run_search("x", fetch=lambda u: b'{"results": ' + rows + b'}')[0]["x"], 837591.0)


if __name__ == "__main__":
    unittest.main()
