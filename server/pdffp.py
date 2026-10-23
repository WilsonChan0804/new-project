# -*- coding: utf-8 -*-
"""A PDF's fingerprint: the SHA-1 of the file without the parts that change
on every export even when the drawing does not - dates, document ids and
the byte offsets that follow from them. Revit stamps each PDF with the time
it was made, so a plain hash calls every nightly export a new drawing.

The same file is in the server (server/pdffp.py) and the Revit add-in
(revit/LWK.extension/lib/lwk_viewer/pdffp.py): the add-in sends it with an
upload's file list, the server compares it with what it has (and keeps
versions by it). A test checks the two copies are the same."""

import hashlib
import re

_VOLATILE = [
    re.compile(br"/CreationDate\s*\([^)]*\)"),
    re.compile(br"/ModDate\s*\([^)]*\)"),
    re.compile(br"/ID\s*\[[^\]]*\]"),
    re.compile(br"<xmp:[A-Za-z]*Date>[^<]*</xmp:[A-Za-z]*Date>"),
    re.compile(br"<xmpMM:(?:Document|Instance)ID>[^<]*</xmpMM:(?:Document|Instance)ID>"),
    re.compile(br"xref\s[\s\S]*?trailer"),
    re.compile(br"startxref\s+\d+"),
]


def fingerprint(data):
    for rx in _VOLATILE:
        data = rx.sub(b"", data)
    return hashlib.sha1(data).hexdigest()


def fingerprint_file(path):
    with open(path, "rb") as f:
        return fingerprint(f.read())
