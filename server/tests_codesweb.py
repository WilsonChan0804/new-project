"""The Codes library and the web: the BD catalogue read from its index pages
(saved slices of the real pages, no network), a document's details
recognised, and the addresses a fetch refuses.

    python3 tests_codesweb.py
"""
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import codesweb as W  # noqa: E402

DATA = os.path.join(HERE, "testdata")


def page(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return f.read()


class Catalogue(unittest.TestCase):
    def test_codes_page(self):
        src = W.SOURCES[0]
        docs = W.parse_index(page("bd_codes.html"), src[3], src)
        fs = next(d for d in docs if d["url"].endswith("/fs_code2011.pdf"))
        self.assertEqual(fs["title"], "Code of Practice for Fire Safety in Buildings 2011 (2024 Edition)")
        self.assertEqual(fs["edition"], "2011 (2024 Edition)")
        self.assertEqual(fs["kind"], "code")
        self.assertTrue(fs["url"].startswith("https://www.bd.gov.hk/doc/en/"))
        self.assertTrue(fs["obsolete"].endswith(".zip"))

    def test_pnap_page(self):
        src = W.SOURCES[1]
        docs = W.parse_index(page("bd_pnap.html"), src[3], src)
        a = next(d for d in docs if d["number"] == "APP-151")
        self.assertEqual(a["title"], "Building Design to Foster a Quality and Sustainable Built Environment")
        self.assertRegex(a["date"], r"^[A-Z][a-z]{2} \d{4}$")
        self.assertTrue(a["url"].endswith("/pnap/APP/APP151.pdf"))
        self.assertFalse(any("signed" in d["url"].lower() for d in docs))     # the signed copy is not a second entry
        self.assertNotIn("More detail", a["title"])

    def test_joint_page(self):
        src = W.SOURCES[2]
        docs = W.parse_index(page("bd_joint.html"), src[3], src)
        j = next(d for d in docs if d["number"] == "JPN 1")
        self.assertEqual(j["title"], "Green and Innovative Buildings")

    def test_catalogue_cached_and_partial(self):
        tmp = tempfile.mkdtemp()
        try:
            calls = []

            def getter(url):
                calls.append(url)
                if "index_pnap" in url:
                    return page("bd_pnap.html")
                if "codes-and-design-manuals" in url:
                    return page("bd_codes.html")
                raise OSError("unreachable")
            c = W.catalogue(tmp, refresh=True, getter=getter)
            ok = dict((s["id"], s["ok"]) for s in c["sources"])
            self.assertTrue(ok["codes"] and ok["pnap"] and not ok["jpn"] and ok["laws"])
            self.assertTrue(any(d["number"] == "Cap. 123F" and d["open_only"] for d in c["docs"]))
            n = len(calls)
            W.catalogue(tmp, getter=getter)                   # kept a day: not read again
            self.assertEqual(len(calls), n)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class Guess(unittest.TestCase):
    def setUp(self):
        docs = []
        for i, name in ((0, "bd_codes.html"), (1, "bd_pnap.html"), (2, "bd_joint.html")):
            s = W.SOURCES[i]
            docs += W.parse_index(page(name), s[3], s)
        self.cat = {"docs": docs}

    def test_from_catalogue(self):
        g = W.guess_details("https://www.bd.gov.hk/doc/en/resources/codes-and-references/practice-notes-and-circular-letters/pnap/APP/APP151.pdf", cat=self.cat)
        self.assertEqual(g["title"], "PNAP APP-151 Building Design to Foster a Quality and Sustainable Built Environment")
        self.assertEqual((g["kind"], g["number"], g["from"]), ("pnap", "APP-151", "the BD catalogue"))
        g = W.guess_details("https://www.bd.gov.hk/doc/en/resources/codes-and-references/code-and-design-manuals/fs_code2011.pdf", cat=self.cat)
        self.assertEqual((g["kind"], g["edition"]), ("code", "2011 (2024 Edition)"))

    def test_from_address_and_text(self):
        text = "Practice Note for Authorized Persons ...\nPNAP APP-99\nSome Topic\nFirst issue June 2000\nLast revision August 2024\nThis revision July 2025 (AD/NB1)"
        g = W.guess_details("https://example.org/notes/APP099.pdf", {"title": "Microsoft Word - APP099.docx"}, text)
        self.assertEqual((g["kind"], g["number"]), ("pnap", "APP-99"))
        self.assertEqual(g["edition"], "rev. July 2025")
        self.assertEqual(g["title"], "")                      # "Microsoft Word - ..." is no title
        g = W.guess_details("https://www.bd.gov.hk/doc/en/x/pnap/ADV/ADV034.pdf")
        self.assertEqual(g["number"], "ADV-34")

    def test_code_of_practice_text(self):
        g = W.guess_details("https://example.org/a.pdf", {}, "Code of Practice for Fire Safety in Buildings 2011 (2024 Edition)\nBuildings Department")
        self.assertEqual(g["title"], "Code of Practice for Fire Safety in Buildings 2011 (2024 Edition)")
        self.assertEqual((g["kind"], g["edition"]), ("code", "2011 (2024 Edition)"))

    def test_elegislation(self):
        g = W.guess_details("https://www.elegislation.gov.hk/hk/cap123F")
        self.assertEqual((g["kind"], g["number"]), ("regulation", "Cap. 123F"))
        self.assertIn("Building (Planning) Regulations", g["title"])


class Refuse(unittest.TestCase):
    def test_addresses(self):
        for bad in ("file:///etc/passwd", "ftp://example.org/a.pdf", "http://localhost/x.pdf", "http://127.0.0.1/x",
                    "http://10.0.0.1/x.pdf", "http://192.168.1.2/x", "http://169.254.169.254/latest/meta-data", "notaurl"):
            with self.assertRaises(W.Refused, msg=bad):
                W.check_url(bad)

    def test_size_and_type(self):
        class Resp(object):
            def __init__(self, body, ctype, url="https://example.org/a.pdf"):
                self.body, self.ctype, self.url = body, ctype, url
                self.headers = {"Content-Type": ctype}

            def geturl(self):
                return self.url

            def read(self, n):
                b, self.body = self.body[:n], self.body[n:]
                return b

        class Opener(object):
            def __init__(self, r):
                self.r = r

            def open(self, req, timeout=None):
                return self.r
        tmp = tempfile.mkdtemp()
        try:
            out = os.path.join(tmp, "f")
            orig = W.check_url
            W.check_url = lambda u, resolve=True: None          # no DNS in a test
            try:
                got = W.fetch("https://example.org/a.pdf", out, opener=Opener(Resp(b"%PDF-1.4 hello", "application/pdf")))
                self.assertEqual((got["ext"], got["size"]), ("pdf", 14))
                with self.assertRaises(W.Refused):
                    W.fetch("https://example.org/a.pdf", out, limit=5, opener=Opener(Resp(b"%PDF-1.4 hello", "application/pdf")))
                with self.assertRaises(W.Refused) as e:
                    W.fetch("https://example.org/", out, opener=Opener(Resp(b"<html></html>", "text/html")))
                self.assertIn("web page", str(e.exception))
                self.assertFalse(os.path.exists(out))
            finally:
                W.check_url = orig
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
