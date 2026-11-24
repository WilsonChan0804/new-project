# -*- coding: utf-8 -*-
"""python3 server/tests_ozpgov.py - the zoning of a site from the Town Planning Board's data (no network)"""
import io
import json
import os
import shutil
import sys
import tempfile
import types
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ozpgov  # noqa: E402
from fastapi import HTTPException  # noqa: E402

X0, Y0 = 836000.0, 826000.0


def sq(x, y, w, h):
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]


def pack_zip():
    """a plan's package as the Board gives it: Esri JSON layers in HK80"""
    zone = {"geometryType": "esriGeometryPolygon", "spatialReference": {"wkid": 102140, "latestWkid": 2326}, "features": [
        {"attributes": {"PLAN_NO": "S/XX/1", "ZONE_LABEL": "R(A)", "DESC_ENG": "Residential (Group A)", "DESC_CHT": "住宅(甲類)", "SPUSE_ENG": " "}, "geometry": {"rings": [sq(X0, Y0, 30, 100)]}},
        {"attributes": {"PLAN_NO": "S/XX/1", "ZONE_LABEL": "G/IC", "DESC_ENG": "Government, Institution or Community", "DESC_CHT": "政府、機構或社區", "SPUSE_ENG": " "}, "geometry": {"rings": [sq(X0 + 30, Y0, 70, 100)]}},
        {"attributes": {"PLAN_NO": "S/XX/1", "ZONE_LABEL": "O", "DESC_ENG": "Open Space"}, "geometry": {"rings": [sq(X0 + 500, Y0, 10, 10)]}},
    ]}
    bhc = {"features": [{"attributes": {"PLAN_NO": "S/XX/1", "BHC_TYPE": "BHCB", "BHC_VALUE": "120"}, "geometry": {"rings": [sq(X0, Y0, 50, 100)]}},
                        {"attributes": {"PLAN_NO": "S/XX/1", "BHC_TYPE": "BHCS", "BHC_VALUE": "8"}, "geometry": {"rings": [sq(X0 + 50, Y0, 50, 100)]}}]}
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("S_XX_1/Plan GIS Data GeoJSON/ZONE.json", json.dumps(zone))
        z.writestr("S_XX_1/Plan GIS Data GeoJSON/BHC.json", json.dumps(bhc))
        z.writestr("S_XX_1/Notes Explanatory Statement/s_xx_1_e.pdf", b"%PDF-1.4 notes")
    return b.getvalue()


def fetcher(calls, fail=False):
    def f(url, timeout):
        calls.append(url)
        if fail:
            raise OSError("refused")
        if "FeatureServer" in url:
            return json.dumps({"features": [{"attributes": {"PLAN_NO": "S/XX/1", "NAME_ENG": "Test", "NAME_CHT": "測試", "PUB_DATE": 1784217600000, "APRV_DATE": None, "GEOJSON_LINK": "https://www.ozp.tpb.gov.hk/api/plan/Spatial?planNo=S%2FXX%2F1&type=geo"}}]}).encode()
        return pack_zip()
    return f


class Zoning(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.core = types.SimpleNamespace(CFG={"data": self.tmp})

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_package(self):
        P = ozpgov.read_package(pack_zip(), lambda pdf: {"R(A)": {"values": {"pr": 7.5}}} if pdf.startswith(b"%PDF") else {})
        self.assertEqual(len(P["zones"]), 3)
        self.assertEqual(P["zones"][0]["a"]["ZONE_LABEL"], "R(A)")
        self.assertEqual(len(P["bhc"]), 2)
        self.assertEqual(P["notes"]["R(A)"]["values"]["pr"], 7.5)

    def test_zoning_shares(self):
        calls = []
        site = [sq(X0, Y0, 100, 100)[:-1]]       # the site: 30 m in R(A), 70 m in G/IC
        r = ozpgov.zoning(self.core, site, "L1", fetch=fetcher(calls), pack=lambda plan, link: ozpgov.read_package(fetcher([])(link, 1), lambda pdf: {"R(A)": {"values": {"pr": 7.5}}, "C": {"values": {}}}))
        self.assertEqual(r["plans"][0]["plan"], "S/XX/1")
        self.assertEqual(r["plans"][0]["published"], "2026-07-16")
        z = {q["zone"]: q for q in r["zones"]}
        self.assertEqual(list(z), ["G/IC", "R(A)"])                  # the largest share first
        self.assertAlmostEqual(z["R(A)"]["share"], 0.3, delta=0.01)
        self.assertAlmostEqual(z["G/IC"]["share"], 0.7, delta=0.01)
        self.assertAlmostEqual(sum(q["share"] for q in r["zones"]), 1, delta=0.01)
        self.assertNotIn("O", z)                                     # far away: not there
        self.assertEqual(r["area"], 10000)
        bh = {(b["kind"], b["value"]): b["share"] for b in r["bh"]}
        self.assertAlmostEqual(bh[("mPD", 120.0)], 0.5, delta=0.01)
        self.assertAlmostEqual(bh[("storeys", 8.0)], 0.5, delta=0.01)
        self.assertEqual(r["notes"], {"S/XX/1": {"R(A)": {"values": {"pr": 7.5}}}})   # only the zones on the site
        # kept: asked again, no fetch
        n = len(calls)
        ozpgov.zoning(self.core, site, "L1", fetch=fetcher(calls))
        self.assertEqual(len(calls), n)

    def test_package_kept_a_week(self):
        calls = []
        ozpgov.package(self.core, "S/XX/1", "https://x/zip", fetch=fetcher(calls))
        ozpgov.package(self.core, "S/XX/1", "https://x/zip", fetch=fetcher(calls))
        self.assertEqual(len(calls), 1)

    def test_down(self):
        with self.assertRaises(HTTPException) as e:
            ozpgov.zoning(self.core, [sq(X0, Y0, 10, 10)[:-1]], "", fetch=fetcher([], fail=True))
        self.assertEqual(e.exception.status_code, 502)
        self.assertIn("Town Planning Board", e.exception.detail)

    def test_bad_site(self):
        with self.assertRaises(HTTPException):
            ozpgov.zoning(self.core, [], "")

    def test_holes(self):
        # an Esri polygon with a hole: a point in the hole is outside
        rings = [sq(0, 0, 10, 10), sq(4, 4, 2, 2)]
        self.assertTrue(ozpgov.in_rings(rings, 1, 1))
        self.assertFalse(ozpgov.in_rings(rings, 5, 5))


if __name__ == "__main__":
    unittest.main()
