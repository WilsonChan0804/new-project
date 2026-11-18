# -*- coding: utf-8 -*-
"""What Model Doctor in Revit and Model Doctor in the viewer share.

Plain Python (no Revit API), so it is tested without Revit
(revit/tests/test_modeldoctor.py) and runs in both IronPython and CPython.

  signature     a finding's identity, the same in both: the check, the problem
                and the elements' UniqueIds, sorted - not the measured value,
                so a gap that drifts from 2.9 mm to 3.1 mm stays the same
                finding (viewer/doctorcore.js signature()).
  accepted      "Not an error", for the whole project: one viewer item per
                finding, placement "doctoraccept".
  fix queue     findings the viewer asked Revit to fix: placement
                "doctorfix", status queued -> fixed | skipped (with why).
"""
import io
from datetime import datetime

try:
    unicode
except NameError:                       # CPython 3
    unicode = str


def signature(check_id, problem, uids):
    ids = sorted(u for u in (uids or []) if u)
    return u"{0}|{1}|{2}".format(check_id, problem, u",".join(ids))


def hash_text(s):
    """The viewer's short key for an item id (doctorcore.js hashText):
    FNV-1a over the UTF-16 code units, then the length in base 36."""
    h = 0x811c9dc5
    for ch in _utf16_units(s):
        h ^= ch
        h = (h * 0x01000193) & 0xffffffff
    return "{0:08x}{1}".format(h, _base36(len(list(_utf16_units(s)))))


def _utf16_units(s):
    for ch in unicode(s):
        c = ord(ch)
        if c > 0xffff:
            c -= 0x10000
            yield 0xd800 + (c >> 10)
            yield 0xdc00 + (c & 0x3ff)
        else:
            yield c


def _base36(n):
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    if n == 0:
        return "0"
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = digits[r] + out
    return out


def now_iso():
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")


# ------------------------------------------------------------- accepted

def accept_item(sig, check_id, problem, uids, text, by):
    return {"id": "doctoraccept-" + hash_text(sig), "placement": "doctoraccept", "signature": sig,
            "check": check_id, "problem": problem, "uids": list(uids or []), "text": text or "",
            "by": by or "", "at": now_iso(), "deleted": False, "from": "revit"}


def accepted_from(items):
    """signature -> item, for the accepted findings among the project's items"""
    out = {}
    for it in items or []:
        if it.get("placement") == "doctoraccept" and not it.get("deleted") and it.get("signature"):
            out[it["signature"]] = it
    return out


# ------------------------------------------------------------ fix queue

def queue_from(items, statuses=("queued",)):
    """The fix queue's items still waiting (oldest first)."""
    out = [it for it in items or [] if it.get("placement") == "doctorfix" and not it.get("deleted")
           and (it.get("status") or "queued") in statuses]
    out.sort(key=lambda it: it.get("at") or "")
    return out


def queue_for_doc(queue, uid_exists):
    """Split the queue into what is in this model (any of its elements is
    here) and what is not (another model's, or already deleted)."""
    here, elsewhere = [], []
    for it in queue:
        uids = it.get("uids") or []
        (here if any(uid_exists(u) for u in uids) else elsewhere).append(it)
    return here, elsewhere


def match_queue(queue, findings):
    """Queue items -> the findings of this run with the same signature.
    findings: iterable of (signature, finding). Returns (matched, missing):
    matched [(item, finding)], missing [item] (no such finding now - fixed
    already, or the model changed)."""
    by = {}
    for sig, f in findings:
        by.setdefault(sig, f)
    matched, missing = [], []
    for it in queue:
        f = by.get(it.get("signature"))
        if f is None:
            missing.append(it)
        else:
            matched.append((it, f))
    return matched, missing


def done_item(item, status, reason, by):
    """The queue item, answered: status "fixed" or "skipped" (with why)."""
    out = dict(item)
    out["status"] = status
    out["reason"] = reason or ""
    out["done_by"] = by or ""
    out["done_at"] = now_iso()
    return out


# ------------------------------------------------------------------ CSV

CSV_HEAD = ["Check", "Severity", "Problem type", "Status", "Category", "Type", "Level",
            "Element IDs", "Issue", "Value (mm)"]


def write_csv(path, rows):
    """A CSV Excel opens with the right characters (UTF-8 with its mark),
    from IronPython or CPython alike - the old writer ("wb" + encode) was
    IronPython-only and failed under pyRevit's CPython engine."""
    with io.open(path, "w", encoding="utf-8-sig", newline="") as fh:
        w = _Writer(fh)
        w.row(CSV_HEAD)
        for r in rows:
            w.row(r)


class _Writer(object):
    """csv quoting by hand: Python 2's csv module cannot write unicode."""

    def __init__(self, fh):
        self.fh = fh

    def row(self, cells):
        out = []
        for c in cells:
            t = u"" if c is None else unicode(c)
            if any(ch in t for ch in u',"\r\n'):
                t = u'"' + t.replace(u'"', u'""') + u'"'
            out.append(t)
        self.fh.write(u",".join(out) + u"\r\n")
