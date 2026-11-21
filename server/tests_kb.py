"""The knowledge base: its pages read and indexed section by section, the
search (summaries first, only current APSEC positions), the branch's zip
unpacked safely, a folder synced and built with MkDocs, and /kb/ signed in.

    python3 tests_kb.py
"""
import importlib.util
import io
import os
import shutil
import sys
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import kb  # noqa: E402

FIX = os.path.join(HERE, "testdata", "kb")
HAS_MKDOCS = importlib.util.find_spec("mkdocs") is not None and importlib.util.find_spec("material") is not None


class Who(object):
    def __init__(self, admin=True, uid=1):
        self.site_admin, self.uid, self.name = admin, uid, "Tester" if uid == 1 else "Other"


class Core(object):
    def __init__(self, data):
        self.CFG = {"data": data}
        self.admin = True
        self.uid = 1

    def who(self, request, tok=""):
        if (tok or request.headers.get("x-viewer-token", "")) == "nobody" or request.cookies.get("deny"):
            raise HTTPException(status_code=401, detail="Sign in first")
        return Who(self.admin, self.uid)


class Parse(unittest.TestCase):
    def test_page(self):
        with open(os.path.join(FIX, "docs", "pnap", "app-2.md"), encoding="utf-8") as f:
            page, secs = kb.parse_page(f.read(), "pnap/app-2.md")
        self.assertEqual((page["title"], page["zh"], page["kind"], page["url"]), ("APP-2 Calculation of Gross Floor Area", "總樓面面積的計算", "pnap", "pnap/app-2/"))
        self.assertIn("Car park 停車場", page["tags"])
        self.assertEqual(page["info"]["version summarised"], "November 2025")
        glance = next(s for s in secs if s["heading"].startswith("At a glance"))
        self.assertEqual(glance["anchor"], "at-a-glance")              # as MkDocs makes it
        self.assertIn("underground 100% disregarded", glance["en"])
        self.assertIn("停車場", glance["zh"])
        self.assertNotIn("停車場", glance["en"])
        self.assertNotIn("**", glance["en"])
        dia = next(s for s in secs if s["heading"].startswith("Diagram"))
        self.assertEqual(dia["figures"][0]["src"], "assets/gfa.svg")

    def test_apsec(self):
        with open(os.path.join(FIX, "docs", "apsec", "2019.md"), encoding="utf-8") as f:
            page, secs = kb.parse_page(f.read(), "apsec/2019.md")
        self.assertEqual(len(secs), 1)
        s = secs[0]
        self.assertEqual((s["anchor"], s["date"], s["superseded"], s["newer"]), ("i201901113", "2019-01-11", True, "2020.md#i2020011018"))
        self.assertTrue(s["heading"].startswith("3. Car park ramps"))


class Index(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        kb.CFG["data"] = self.tmp
        os.makedirs(os.path.join(self.tmp, "kb"))
        self.n = kb.index(os.path.join(FIX, "docs"), os.path.join(self.tmp, "kb", "kb.db"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_counts(self):
        self.assertEqual(self.n[0], 5)

    def test_search_summaries_first(self):
        rows, terms = kb.search("car park GFA concession", 6)
        kinds = [r["kind"] for r in rows]
        self.assertEqual(kinds[0], "guide")
        self.assertIn("pnap", kinds)
        self.assertNotIn("Related 相關文件", [r["heading"] for r in rows[:2]])     # a list of links is not an answer
        ap = [r for r in rows if r["kind"] == "apsec"]
        self.assertEqual([r["anchor"] for r in ap], ["i2020011018"])               # only the current position
        rows, _ = kb.search("car park ramps", 6, include_old=True)
        self.assertIn("i201901113", [r["anchor"] for r in rows])

    def test_chinese(self):
        rows, _ = kb.search("停車場", 5)
        self.assertTrue(rows and rows[0]["title"].startswith(("APP-2", "GFA")))


def make_zip(entries):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        for name, data in entries:
            z.writestr(name, data)
    return b.getvalue()


class Unpack(unittest.TestCase):
    def test_safe(self):
        tmp = tempfile.mkdtemp()
        try:
            kb.safe_extract(make_zip([("o-r-sha/mkdocs.yml", "site_name: x"), ("o-r-sha/docs/index.md", "# Hi")]), tmp)
            self.assertTrue(os.path.isfile(os.path.join(tmp, "docs", "index.md")))
            for bad in ("o-r-sha/../evil.txt", "o-r-sha//etc/passwd", "o-r-sha/C:/x"):
                with self.assertRaises(ValueError, msg=bad):
                    kb.safe_extract(make_zip([(bad, "x")]), tmp)
            self.assertFalse(os.path.exists(os.path.join(os.path.dirname(tmp), "evil.txt")))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class Endpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.core = Core(cls.tmp)
        app = FastAPI()
        kb.CFG["data"] = ""
        kb.register(app, cls.core)
        cls.c = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        self.core.admin = True
        kb.CFG["data"] = self.tmp

    def test_settings_and_token(self):
        r = self.c.post("/api/kb/settings", json={"source": "github", "repo": "Acme/kb", "branch": "claude/kb-1", "token": "ghp_" + "a" * 36})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()["token_set"])
        st = self.c.get("/api/kb/status").json()
        self.assertEqual(st["settings"]["branch"], "claude/kb-1")
        self.assertNotIn("a" * 36, str(st))                                    # the token never comes back
        self.assertEqual(oct(os.stat(os.path.join(self.tmp, "kb", "token")).st_mode & 0o777), "0o600")
        self.assertEqual(self.c.post("/api/kb/settings", json={"repo": "no slash"}).status_code, 400)
        self.assertEqual(self.c.post("/api/kb/settings", json={"branch": "../x"}).status_code, 400)
        self.core.admin = False
        self.assertEqual(self.c.post("/api/kb/settings", json={"repo": "a/b"}).status_code, 403)
        self.assertNotIn("settings", self.c.get("/api/kb/status").json())
        self.core.admin = True
        self.c.post("/api/kb/settings", json={"repo": "WilsonChan0804/new-project", "branch": "claude/happy-edison-lbpdz9", "token": ""})

    @unittest.skipUnless(HAS_MKDOCS, "needs mkdocs-material")
    def test_folder_build_search_serve(self):
        folder = os.path.join(self.tmp, "kbsrc")
        shutil.copytree(FIX, folder)
        self.assertEqual(self.c.post("/api/kb/settings", json={"source": "folder", "folder": folder}).status_code, 200)
        r = self.c.post("/api/kb/update?wait=1&force=1").json()
        self.assertEqual(r["error"], "", r)
        st = self.c.get("/api/kb/status").json()
        self.assertTrue(st["on"] and st["pages"] == 5, st)
        s = self.c.get("/api/kb/search", params={"q": "car park GFA"}).json()
        self.assertEqual(s["items"][0]["kind_label"], "Guide")
        self.assertTrue(any(f["facts"] and "100%" in f["facts"][0]["figure"] for f in s["facts"]), s["facts"])
        fig = next(i for i in s["items"] if i["figures"])
        self.assertEqual(fig["figures"][0]["url"], "/kb/assets/gfa.svg")
        page = self.c.get("/kb/pnap/app-2/")
        self.assertEqual(page.status_code, 200)
        self.assertIn("Calculation of Gross Floor Area", page.text)
        self.assertEqual(page.headers["x-frame-options"], "SAMEORIGIN")
        self.assertEqual(self.c.get("/kb/pnap/app-2", follow_redirects=False).status_code, 307)
        self.assertEqual(self.c.get("/kb/../kb.db").status_code in (400, 404), True)
        self.assertEqual(self.c.get("/kb/", cookies={"deny": "1"}).status_code, 401)
        # nothing new: no rebuild
        built = st["built"]
        self.c.post("/api/kb/update?wait=1")
        self.assertEqual(self.c.get("/api/kb/status").json()["built"], built)

    def test_edits(self):
        kb.CFG["data"] = self.tmp
        os.makedirs(os.path.join(self.tmp, "kb"), exist_ok=True)
        kb.index(os.path.join(FIX, "docs"), os.path.join(self.tmp, "kb", "kb.db"))
        me = self.c.get("/api/kb/me").json()
        self.assertTrue(me["can_edit"] and me["viewer"])
        self.assertEqual(self.c.get("/api/kb/me", headers={"x-viewer-token": "nobody"}).status_code, 401)
        orig = "Underground car parks are disregarded from GFA in full; above-ground car parks 100% for two floors, then 50%."
        r = self.c.post("/api/kb/edits", json={"page": "guides/gfa.md", "block": "car-parks:abc", "anchor": "car-parks",
                                                "text": "Underground car parks: disregarded in full (zebrawording).", "note": "clearer", "original": orig})
        self.assertEqual(r.status_code, 200, r.text)
        e = r.json()
        self.assertEqual((e["name"], e["uid"], e["undone"]), ("Tester", 1, False))
        self.assertEqual(self.c.post("/api/kb/edits", json={"page": "guides/gfa.md", "block": "", "text": "x"}).status_code, 400)
        self.assertEqual(self.c.post("/api/kb/edits", json={"page": "../x", "block": "b", "text": "x"}).status_code, 400)
        items = self.c.get("/api/kb/edits", params={"page": "guides/gfa.md"}).json()["items"]
        self.assertEqual([i["id"] for i in items], [e["id"]])
        # the edited wording is searched, and the card says who edited it
        s = self.c.get("/api/kb/search", params={"q": "zebrawording"}).json()["items"]
        self.assertTrue(s and s[0]["edited_by"] == "Tester" and s[0]["title"].startswith("GFA"), s)
        # undo: someone else cannot, an admin can
        self.core.uid = 2
        self.core.admin = False
        self.assertEqual(self.c.post("/api/kb/edits/%d/undo" % e["id"]).status_code, 403)
        self.assertEqual(self.c.get("/api/kb/edits/all").status_code, 403)
        self.core.admin = True
        self.assertTrue(self.c.post("/api/kb/edits/%d/undo" % e["id"]).json()["undone"])
        self.core.uid = 1
        self.assertEqual(self.c.get("/api/kb/edits", params={"page": "guides/gfa.md"}).json()["items"], [])
        self.assertEqual(len(self.c.get("/api/kb/history", params={"page": "guides/gfa.md"}).json()["items"]), 1)
        self.assertEqual(self.c.get("/api/kb/search", params={"q": "zebrawording"}).json()["items"], [])
        # export, as JSON and as Markdown for the knowledge base's author
        r2 = self.c.post("/api/kb/edits", json={"page": "pnap/app-2.md", "block": "b1", "text": "New words", "original": "Old words"}).json()
        js = self.c.get("/api/kb/edits/all").json()
        self.assertEqual([x["id"] for x in js["edits"]], [r2["id"]])
        md = self.c.get("/api/kb/edits/all", params={"format": "md"}).text
        self.assertIn("pnap/app-2.md", md)
        self.assertIn("> New words", md)
        rec = self.c.get("/api/kb/edits/recent").json()
        self.assertEqual((rec["live"], rec["not_merged"]), (1, 1))
        self.c.post("/api/kb/edits/merged", json={"ids": [r2["id"]]})
        self.assertEqual(self.c.get("/api/kb/edits/recent").json()["not_merged"], 0)

    def test_thin_pages(self):
        kb.CFG["data"] = self.tmp
        os.makedirs(os.path.join(self.tmp, "kb"), exist_ok=True)
        kb.index(os.path.join(FIX, "docs"), os.path.join(self.tmp, "kb", "kb.db"))
        r = self.c.get("/api/kb/thin").json()
        app2 = next(x for x in r["items"] if x["path"] == "pnap/app-2.md")
        self.assertEqual(app2["tier"], "A")                                  # a key document
        self.assertTrue(app2["thin"] and any("short for a key document" in w for w in app2["why"]))
        self.assertTrue(app2["has"]["glance"] and not app2["has"]["clauses"])
        self.assertNotIn("apsec/2019.md", [x["path"] for x in r["items"]])  # the forum pages are not measured
        self.assertEqual(r["counts"]["A"]["pages"], 1)
        md = self.c.get("/api/kb/thin", params={"format": "md"}).text
        self.assertIn("## Tier A: 1 of 1 pages", md)
        self.assertTrue(self.c.get("/api/kb/thin", params={"format": "csv"}).text.startswith("\ufeffTier,Page"))
        self.assertTrue(kb.PLACEHOLDER.search("later paras. cover structural loads") and kb.PLACEHOLDER.search("其後各段涵蓋結構荷載"))

    def test_front_matter_extras(self):
        page, _ = kb.parse_page("---\ntags:\n  - PNAP\n  - Draft\nsummary: How GFA is measured.\nkeywords: MOE, means of escape, 走火通道\n---\n# APP-9 Test\n\n## At a glance\n\nSome text that is long enough to keep here.\n", "pnap/app-9.md")
        self.assertEqual(page["info"]["summary"], "How GFA is measured.")
        self.assertEqual(page["info"]["keywords"], ["MOE", "means of escape", "走火通道"])
        self.assertTrue(page["info"]["draft"])

    def test_not_set_up(self):
        kb.CFG["data"] = tempfile.mkdtemp()
        try:
            self.assertEqual(self.c.get("/kb/").status_code, 404)
            self.assertEqual(self.c.get("/api/kb/search", params={"q": "gfa"}).json()["items"], [])
        finally:
            shutil.rmtree(kb.CFG["data"], ignore_errors=True)
            kb.CFG["data"] = self.tmp


if __name__ == "__main__":
    unittest.main()
