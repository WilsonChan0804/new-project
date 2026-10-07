# -*- coding: utf-8 -*-
"""JSON out of IronPython, safely.

IronPython 2.7's json module breaks on any text outside plain ASCII: its
encoder "decodes" every str as if it were bytes, and IronPython's str is
already Unicode, so a name like 'Cafe Kitchen' with an accented e fails with
"'unknown' codec can't decode byte 0xe9". Revit sample and real projects are
full of such names (Chinese sheet titles, degree signs, accented words).

This writer never decodes anything: every character outside printable ASCII
is written as a \\uXXXX escape, which every JSON reader - the viewer, Node,
Python - turns back into the same character. The output is pure ASCII, so
the file's own encoding can never be wrong either.

write_atomic() writes to a temporary file and renames it into place, so a
failure part-way leaves the previous file untouched. Opening the real file
for writing first is what left Snowdon's manifest.json empty (0 bytes) when
the encoding failed.
"""
import io
import os

__version__ = "2026-09-27f"

try:                                   # IronPython 2.7 / CPython 2
    _TEXT = (unicode, str)             # noqa: F821
    _INTS = (int, long)                # noqa: F821
except NameError:                      # CPython 3 (tests)
    _TEXT = (str,)
    _INTS = (int,)

_ESC = {u'"': u'\\"', u'\\': u'\\\\', u'\n': u'\\n', u'\r': u'\\r',
        u'\t': u'\\t', u'\b': u'\\b', u'\f': u'\\f'}


def _string(s):
    out = [u'"']
    for ch in s:
        e = _ESC.get(ch)
        if e is not None:
            out.append(e)
            continue
        o = ord(ch)
        if 0x20 <= o < 0x7f:
            out.append(ch)
        elif o > 0xFFFF:               # CPython 3 only: split into a surrogate pair
            o -= 0x10000
            out.append(u'\\u%04x\\u%04x' % (0xD800 + (o >> 10), 0xDC00 + (o & 0x3FF)))
        else:
            out.append(u'\\u%04x' % o)
    out.append(u'"')
    return u"".join(out)


def _text(v):
    """Anything as text, never raising: a byte string with an odd byte is
    read as Latin-1 rather than failing the whole export."""
    if isinstance(v, _TEXT):
        return v
    try:
        return u"%s" % (v,)
    except Exception:
        try:
            return bytes(v).decode("latin-1")
        except Exception:
            return u"?"


def _number(v):
    if v != v or v in (float("inf"), float("-inf")):
        return u"null"                 # JSON has no NaN or infinity
    r = repr(float(v))
    if r.endswith(".0"):
        r = r[:-2]
    return _text(r)


def dumps(obj, indent=2, sort_keys=True):
    parts = []
    pad = (lambda n: u"\n" + u" " * (indent * n)) if indent else (lambda n: u"")
    sep = u": " if indent else u":"

    def walk(v, depth):
        if v is None:
            parts.append(u"null")
        elif v is True:
            parts.append(u"true")
        elif v is False:
            parts.append(u"false")
        elif isinstance(v, _INTS):
            parts.append(_text(int(v)))
        elif isinstance(v, float):
            parts.append(_number(v))
        elif isinstance(v, _TEXT):
            parts.append(_string(v))
        elif isinstance(v, dict):
            if not v:
                parts.append(u"{}")
                return
            keys = sorted(v.keys(), key=_text) if sort_keys else list(v.keys())
            parts.append(u"{")
            for i, k in enumerate(keys):
                if i:
                    parts.append(u",")
                parts.append(pad(depth + 1))
                parts.append(_string(_text(k)))
                parts.append(sep)
                walk(v[k], depth + 1)
            parts.append(pad(depth))
            parts.append(u"}")
        elif isinstance(v, (list, tuple)):
            if not v:
                parts.append(u"[]")
                return
            parts.append(u"[")
            for i, x in enumerate(v):
                if i:
                    parts.append(u",")
                parts.append(pad(depth + 1))
                walk(x, depth + 1)
            parts.append(pad(depth))
            parts.append(u"]")
        else:
            # A Revit or .NET value that slipped in: its text, not a crash.
            parts.append(_string(_text(v)))

    walk(obj, 0)
    return u"".join(parts)


def write_atomic(path, obj, indent=2, sort_keys=True):
    text = dumps(obj, indent=indent, sort_keys=sort_keys)
    tmp = path + ".tmp"
    with io.open(tmp, "w", encoding="ascii", newline="\n") as f:
        f.write(text)
    if os.path.exists(path):
        os.remove(path)
    os.rename(tmp, path)
