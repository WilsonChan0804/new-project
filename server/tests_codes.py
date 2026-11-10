"""The Codes library: clauses split and found, and Ask sending Claude only
the clauses found (a stand-in model here - no key, no network).

    python3 tests_codes.py
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import codes  # noqa: E402

FS_TEXT = """Code of Practice for Fire Safety in Buildings 2011

B5 Travel distance

B5.1 The travel distance from any point within a room to the nearest exit door shall not exceed the limits in Table B2.

B5.2 Where a dead end exists, the travel distance within the dead end shall not exceed 24 m for a sprinklered floor.

B6 Width of exit routes

B6.1 The minimum width of an exit route serving more than 30 persons shall be 1050 mm.

C3 Fire resistance rating

C3.1 Every compartment wall shall have an FRR of not less than that of the elements of construction.

第41條 每一座建築物須設有足夠的走火通道。
"""


def tiny_pdf(pages):
    """A PDF of one line of text a page (Helvetica)."""
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", None, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    kids = []
    for t in pages:
        stream = "BT /F1 12 Tf 72 700 Td (%s) Tj ET" % t.replace("(", "\\(").replace(")", "\\)")
        objs.append("<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream))
        objs.append("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>" % (len(objs)))
        kids.append(len(objs))
    objs[1] = "<< /Type /Pages /Kids [%s] /Count %d >>" % (" ".join("%d 0 R" % k for k in kids), len(kids))
    out, offs = b"%PDF-1.4\n", []
    for i, o in enumerate(objs):
        offs.append(len(out))
        out += ("%d 0 obj\n%s\nendobj\n" % (i + 1, o)).encode("latin-1")
    xref = len(out)
    out += ("xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)).encode()
    out += "".join("%010d 00000 n \n" % o for o in offs).encode()
    out += ("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)).encode()
    return out


class Who(object):
    def __init__(self, admin=True, uid=1):
        self.site_admin, self.uid, self.name = admin, uid, "Tester"


class Core(object):
    def __init__(self, data):
        self.CFG = {"data": data}
        self.admin = True

    def who(self, request, tok=""):
        if tok == "nobody":
            raise HTTPException(status_code=401, detail="Sign in first")
        return Who(self.admin)

    def require_request(self, request, tok=""):
        return self.who(request, tok)


class CodesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.core = Core(cls.tmp)
        app = FastAPI()
        codes.READY.clear()
        codes.register(app, cls.core)
        cls.c = TestClient(app)
        r = cls.c.post("/api/codes/sources?file=fs2011.txt&kind=code&edition=2011 (Apr 2015)&title=FS Code 2011",
                       content=FS_TEXT.encode("utf-8"))
        assert r.status_code == 200, r.text
        cls.sid = r.json()["source"]["id"]

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        self.core.admin = True
        codes.CALL["fn"] = codes.claude_stream
        os.environ.pop("ANTHROPIC_API_KEY", None)

    def test_split_keeps_clause_numbers(self):
        cl = codes.split_clauses([(1, FS_TEXT.split("\n"))])
        refs = [r for r, _, _ in cl]
        for want in ("B5.1", "B5.2", "B6.1", "C3.1", "第41條"):
            self.assertIn(want, refs)

    def test_search_dead_end(self):
        r = self.c.get("/api/codes/search", params={"q": "dead end travel distance sprinklered"}).json()
        self.assertTrue(r["items"])
        self.assertEqual(r["items"][0]["ref"], "B5.2")
        self.assertIn("24 m", r["items"][0]["text"])
        self.assertEqual(r["items"][0]["edition"], "2011 (Apr 2015)")

    def test_search_synonym_and_clause_number(self):
        r = self.c.get("/api/codes/search", params={"q": "fire resistance rating of compartment walls"}).json()
        self.assertIn("C3.1", [i["ref"] for i in r["items"]])
        r = self.c.get("/api/codes/search", params={"q": "B6.1"}).json()
        self.assertEqual(r["items"][0]["ref"], "B6.1")

    def test_search_chinese(self):
        r = self.c.get("/api/codes/search", params={"q": "走火通道"}).json()
        self.assertTrue(r["items"])
        self.assertEqual(r["items"][0]["ref"], "第41條")

    def test_ask_off_without_key_still_gives_clauses(self):
        lines = [json.loads(x) for x in self.c.post("/api/codes/ask", json={"q": "dead end distance"}).text.splitlines()]
        self.assertEqual(lines[0]["type"], "sources")
        self.assertTrue(lines[0]["items"])
        self.assertEqual(lines[-1]["type"], "off")

    def test_ask_sends_only_found_clauses(self):
        os.environ["ANTHROPIC_API_KEY"] = "sk-ant-test-" + "x" * 30
        seen = {}

        def fake(key, model, system, messages):
            seen["messages"], seen["model"] = messages, model
            yield "text", "Within a dead end: not more than 24 m [S1]. See also [S9]."
            yield "done", {"stop": "end_turn", "in": 1000, "out": 50, "model": model}
        codes.CALL["fn"] = fake
        out = [json.loads(x) for x in self.c.post("/api/codes/ask", json={"q": "How long may a dead end be?", "project": "P1"}).text.splitlines()]
        src = out[0]["items"]
        self.assertEqual(src[0]["ref"], "B5.2")
        body = seen["messages"][-1]["content"]
        self.assertIn('<source id="S1" ref="FS Code 2011 · B5.2"', body)
        self.assertEqual(body.count("<source "), len(src))
        self.assertEqual(seen["model"], codes.DEFAULT_MODEL)
        done = out[-1]
        self.assertEqual(done["type"], "done")
        self.assertEqual(done["cited"], [1] if len(src) < 9 else [1, 9])   # a citation of a clause not sent is dropped
        h = self.c.get("/api/codes/history").json()["items"]
        self.assertEqual(h[0]["q"], "How long may a dead end be?")
        s = self.c.get("/api/codes/settings").json()
        self.assertEqual(s["key_from"], "env")
        self.assertGreater(s["month"]["questions"], 0)

    def test_ask_reports_error(self):
        os.environ["ANTHROPIC_API_KEY"] = "sk-ant-test-" + "x" * 30

        def bad(key, model, system, messages):
            raise RuntimeError("boom")
            yield
        codes.CALL["fn"] = bad
        out = [json.loads(x) for x in self.c.post("/api/codes/ask", json={"q": "dead end"}).text.splitlines()]
        self.assertEqual(out[-1]["type"], "error")

    def test_superseded_left_out(self):
        r = self.c.post("/api/codes/notes", json={"title": "Old note", "text": "B9.9 Dead end corridors in the 1996 code were 15 m.", "kind": "internal"}).json()
        nid = r["source"]["id"]
        q = {"q": "dead end corridors 1996"}
        self.assertIn(nid, [i["source"] for i in self.c.get("/api/codes/search", params=q).json()["items"]])
        self.c.patch("/api/codes/sources/" + nid, json={"status": "superseded"})
        self.assertNotIn(nid, [i["source"] for i in self.c.get("/api/codes/search", params=q).json()["items"]])
        self.assertEqual(self.c.delete("/api/codes/sources/" + nid).status_code, 200)

    def test_only_admin_changes(self):
        self.core.admin = False
        r = self.c.post("/api/codes/notes", json={"title": "x", "text": "some text long enough"})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.c.post("/api/codes/settings", json={"model": "off"}).status_code, 403)
        self.assertEqual(self.c.get("/api/codes/search", params={"q": "exit"}).status_code, 200)

    def test_settings_key_and_model(self):
        r = self.c.post("/api/codes/settings", json={"key": "not-a-key"})
        self.assertEqual(r.status_code, 400)
        r = self.c.post("/api/codes/settings", json={"key": "sk-ant-api03-" + "a" * 40, "model": "claude-haiku-5-5"}).json()
        self.assertTrue(r["key_set"])
        self.assertEqual(r["key_from"], "saved")
        self.assertEqual(r["model"], "claude-haiku-5-5")
        self.assertNotIn("a" * 40, json.dumps(r))          # the key itself never comes back
        self.c.post("/api/codes/settings", json={"clear_key": True, "model": codes.DEFAULT_MODEL})

    @unittest.skipUnless(shutil.which("pdftotext"), "needs poppler")
    def test_pdf_pages(self):
        p = os.path.join(self.tmp, "t.pdf")
        with open(p, "wb") as f:
            f.write(tiny_pdf(["PNAP APP-152 Sustainable Building Design",
                              "8. Building separation shall be provided where the frontage exceeds 60 m."]))
        with open(p, "rb") as f:
            r = self.c.post("/api/codes/sources?file=app152.pdf&kind=pnap&title=PNAP APP-152", content=f.read()).json()
        self.assertEqual(r["source"]["pages"], 2)
        it = self.c.get("/api/codes/search", params={"q": "building separation frontage"}).json()["items"][0]
        self.assertEqual(it["page"], 2)
        self.assertTrue(it["pdf"])
        self.assertEqual(self.c.get("/api/codes/sources/%s/file" % it["source"]).headers["content-type"], "application/pdf")


if __name__ == "__main__":
    unittest.main()
