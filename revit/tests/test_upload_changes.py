# -*- coding: utf-8 -*-
"""The nightly upload sends only what really changed:
    python3 -m unittest discover -s revit/tests -v
"""
import gzip
import io
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "LWK.extension", "lib"))
from lwk_viewer import pdffp  # noqa: E402

PDF = (b"%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n"
       b"2 0 obj << /Producer (Revit) /CreationDate (D:20261023010203+08'00') /ModDate (D:20261023010203+08'00') >> endobj\n"
       b"3 0 obj << /Length 20 >> stream\nBT /F1 12 Tf (A-101) Tj ET\nendstream endobj\n"
       b"xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \ntrailer << /ID [<aaa><bbb>] >>\nstartxref\n123\n%%EOF")


class PdfFingerprint(unittest.TestCase):

    def test_same_drawing_other_dates(self):
        again = (PDF.replace(b"20261023010203", b"20261024020304").replace(b"<aaa><bbb>", b"<ccc><ddd>")
                 .replace(b"startxref\n123", b"startxref\n456"))
        self.assertNotEqual(PDF, again)
        self.assertEqual(pdffp.fingerprint(PDF), pdffp.fingerprint(again))

    def test_changed_drawing(self):
        self.assertNotEqual(pdffp.fingerprint(PDF), pdffp.fingerprint(PDF.replace(b"(A-101)", b"(A-102)")))

    def test_server_has_the_same_code(self):
        a = open(os.path.join(HERE, "..", "LWK.extension", "lib", "lwk_viewer", "pdffp.py"), "rb").read()
        b = open(os.path.join(HERE, "..", "..", "server", "pdffp.py"), "rb").read()
        self.assertEqual(a, b, "server/pdffp.py and the add-in's pdffp.py must be the same file")


class ModelBytes(unittest.TestCase):

    def test_gzip_without_time_is_repeatable(self):
        # as fast3d writes a model: gzip with mtime=0 - two exports of an
        # unchanged model give the same bytes (the same SHA-1), not sent again
        def write():
            raw = io.BytesIO()
            gz = gzip.GzipFile(fileobj=raw, mode="wb", compresslevel=5, mtime=0)
            gz.write(b"LWKM" + b"\0" * 12 + b'{"v":3}' + b"\1" * 1000)
            gz.close()
            return raw.getvalue()
        a = write()
        import time
        time.sleep(1.1)
        self.assertEqual(a, write())

    def test_fast3d_writes_without_time(self):
        src = open(os.path.join(HERE, "..", "LWK.extension", "lib", "lwk_viewer", "fast3d.py")).read()
        self.assertIn("mtime=0", src)


if __name__ == "__main__":
    unittest.main()
