"""Reading a DXF file (ASCII, any version; the ODA File Converter writes
2018) into what the sheet renderer needs (cad_render.py): the layers,
line types and text styles, the blocks, model space, and each layout with
its paper space and plot settings.

Standard library only. Entities are kept as their group codes (a list of
(code, value) pairs) and read when drawn: a drawing has many kinds of
entity and most of their codes are never needed.
"""

import re

CODEPAGES = {
    "ANSI_950": "cp950", "ANSI_936": "gbk", "ANSI_932": "cp932", "ANSI_949": "cp949",
    "ANSI_1252": "cp1252", "ANSI_1250": "cp1250", "ANSI_1251": "cp1251", "ANSI_874": "cp874",
    "BIG5": "cp950", "GB2312": "gbk", "DOS437": "cp437",
}


class Ent(object):
    """One entity, table entry or object: its type and group codes. ATTRIBs
    after an INSERT and VERTEXes after a POLYLINE are kept in .kids."""
    __slots__ = ("type", "tags", "kids", "_first")

    def __init__(self, type_, tags):
        self.type = type_
        self.tags = tags
        self.kids = []
        self._first = None

    def first(self):
        if self._first is None:
            d = {}
            for c, v in self.tags:
                if c not in d:
                    d[c] = v
            self._first = d
        return self._first

    def get(self, code, default=None):
        return self.first().get(code, default)

    def f(self, code, default=0.0):
        v = self.first().get(code)
        if v is None:
            return default
        try:
            return float(v)
        except ValueError:
            return default

    def i(self, code, default=0):
        v = self.first().get(code)
        if v is None:
            return default
        try:
            return int(float(v))
        except ValueError:
            return default

    def all(self, code):
        return [v for c, v in self.tags if c == code]

    def pt(self, cx, default=(0.0, 0.0)):
        """A point from its x code (10, 11 ...): (x, y)."""
        d = self.first()
        try:
            return (float(d[cx]), float(d.get(cx + 10, 0)))
        except (KeyError, ValueError):
            return default

    def handle(self):
        return self.get(5) or self.get(105) or ""

    def __repr__(self):
        return "<%s %s>" % (self.type, self.handle())


class Block(object):
    def __init__(self, name, base, flags, xref, handle, owner):
        self.name = name
        self.base = base
        self.flags = flags
        self.xref = xref                 # the external file's path, for an xref
        self.handle = handle
        self.owner = owner               # its BLOCK_RECORD
        self.ents = []

    @property
    def is_xref(self):
        return bool(self.flags & 4) or bool(self.flags & 32)


class Layout(object):
    def __init__(self, ent):
        self.name = ""
        self.order = 0
        self.record = ""                 # its paper space BLOCK_RECORD
        self.limmin = None
        self.limmax = None
        self.margins = (0.0, 0.0, 0.0, 0.0)    # left, bottom, right, top (mm)
        self.paper = (0.0, 0.0)                # width, height (mm)
        self.origin = (0.0, 0.0)
        self.units = 1                          # 0 inches, 1 mm
        self.rotation = 0                       # 0, 1 (90), 2 (180), 3 (270)
        self.paper_name = ""
        sub = ""
        for c, v in ent.tags:
            if c == 100:
                sub = v
                continue
            try:
                if sub == "AcDbPlotSettings":
                    if c == 40: self.margins = (float(v),) + self.margins[1:]
                    elif c == 41: self.margins = self.margins[:1] + (float(v),) + self.margins[2:]
                    elif c == 42: self.margins = self.margins[:2] + (float(v),) + self.margins[3:]
                    elif c == 43: self.margins = self.margins[:3] + (float(v),)
                    elif c == 44: self.paper = (float(v), self.paper[1])
                    elif c == 45: self.paper = (self.paper[0], float(v))
                    elif c == 46: self.origin = (float(v), self.origin[1])
                    elif c == 47: self.origin = (self.origin[0], float(v))
                    elif c == 72: self.units = int(v)
                    elif c == 73: self.rotation = int(v)
                    elif c == 4: self.paper_name = v
                elif sub == "AcDbLayout":
                    if c == 1: self.name = v
                    elif c == 71: self.order = int(v)
                    elif c == 10: self.limmin = (float(v), 0.0)
                    elif c == 20 and self.limmin: self.limmin = (self.limmin[0], float(v))
                    elif c == 11: self.limmax = (float(v), 0.0)
                    elif c == 21 and self.limmax: self.limmax = (self.limmax[0], float(v))
                    elif c == 330: self.record = v
            except ValueError:
                pass

    @property
    def is_model(self):
        return self.name.lower() == "model"


class Doc(object):
    def __init__(self):
        self.header = {}
        self.layers = {}                 # upper name -> Ent
        self.layer_by_handle = {}
        self.ltypes = {}                 # upper name -> Ent
        self.styles = {}                 # upper name -> Ent
        self.records = {}                # BLOCK_RECORD handle -> name
        self.blocks = {}                 # upper name -> Block
        self.entities = []               # the ENTITIES section
        self.objects = {}                # handle -> Ent (OBJECTS)
        self.layouts = []
        self.path = ""

    def hv(self, name, code=None, default=None):
        """A header variable ($LTSCALE ...): its first value."""
        tags = self.header.get(name)
        if not tags:
            return default
        if code is None:
            return tags[0][1]
        for c, v in tags:
            if c == code:
                return v
        return default

    def hf(self, name, default=0.0):
        try:
            return float(self.hv(name, default=default))
        except (TypeError, ValueError):
            return default

    @property
    def version(self):
        return self.hv("$ACADVER") or "AC1009"

    def model_record(self):
        for h, n in self.records.items():
            if n.upper() == "*MODEL_SPACE":
                return h
        return None

    def model_ents(self):
        """Model space: the ENTITIES section's entities that are not in
        paper space (and *Model_Space's, when a writer puts them there)."""
        mh = self.model_record()
        out = [e for e in self.entities if e.get(67) != "1" and (not mh or e.get(330) in (None, mh))]
        b = self.blocks.get("*MODEL_SPACE")
        if b and b.ents:
            out += b.ents
        return out

    def paper_ents(self, layout):
        """A layout's paper space: the active one is in the ENTITIES section
        (67 = 1), the others in their *Paper_Space<n> block."""
        name = self.records.get(layout.record, "")
        if name.upper() == "*PAPER_SPACE":
            ents = [e for e in self.entities if e.get(67) == "1"]
            b = self.blocks.get("*PAPER_SPACE")
            return ents + (b.ents if b else [])
        b = self.blocks.get(name.upper())
        return list(b.ents) if b else []


def _decode(raw):
    head = raw[:20000].decode("latin-1", "replace")
    m = re.search(r"\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d+)", head)
    ver = m.group(1) if m else "AC1009"
    if ver >= "AC1021":
        return raw.decode("utf-8", "replace")
    m = re.search(r"\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)", head)
    cp = CODEPAGES.get((m.group(1) if m else "ANSI_1252").upper(), "cp1252")
    try:
        return raw.decode(cp, "replace")
    except LookupError:
        return raw.decode("cp1252", "replace")


def _pairs(text):
    lines = text.splitlines()
    n = len(lines) - 1
    i = 0
    while i < n:
        try:
            code = int(lines[i].strip())
        except ValueError:
            i += 1
            continue
        val = lines[i + 1]
        # strings keep their spaces; numbers do not need them
        yield code, (val.strip() if code not in (1, 3) else val.rstrip("\r"))
        i += 2


def _group(pairs):
    """Records: (type, tags) for each code 0."""
    cur = None
    tags = []
    for c, v in pairs:
        if c == 0:
            if cur is not None:
                yield cur, tags
            cur, tags = v, []
        else:
            tags.append((c, v))
    if cur is not None:
        yield cur, tags


def _attach(records):
    """ATTRIBs (after INSERT, 66 = 1) and VERTEXes (after POLYLINE) go into
    their parent's .kids; SEQEND closes them."""
    out = []
    parent = None
    for t, tags in records:
        e = Ent(t, tags)
        if parent is not None and t in ("ATTRIB", "VERTEX"):
            parent.kids.append(e)
            continue
        if t == "SEQEND":
            parent = None
            continue
        parent = None
        if t == "POLYLINE" or (t == "INSERT" and e.get(66) == "1"):
            parent = e
        out.append(e)
    return out


def read(path):
    with open(path, "rb") as f:
        raw = f.read()
    if raw.startswith(b"AutoCAD Binary DXF"):
        raise ValueError("A binary DXF - save it as an ASCII DXF (or send the DWG)")
    doc = Doc()
    doc.path = path
    recs = list(_group(_pairs(_decode(raw))))
    i = 0
    n = len(recs)
    while i < n:
        t, tags = recs[i]
        if t != "SECTION":
            i += 1
            continue
        name = tags[0][1] if tags else ""
        j = i + 1
        body = []
        while j < n and recs[j][0] != "ENDSEC":
            body.append(recs[j])
            j += 1
        if name == "HEADER":
            _header(doc, tags, body)
        elif name == "TABLES":
            _tables(doc, body)
        elif name == "BLOCKS":
            _blocks(doc, body)
        elif name == "ENTITIES":
            doc.entities = _attach(body)
        elif name == "OBJECTS":
            for t2, tags2 in body:
                e = Ent(t2, tags2)
                h = e.get(5)
                if h:
                    doc.objects[h] = e
                if t2 == "LAYOUT":
                    doc.layouts.append(Layout(e))
        i = j + 1
    doc.layouts.sort(key=lambda l: l.order)
    return doc


def _header(doc, first_tags, body):
    # The header is one record: "SECTION" then 2 HEADER, then 9 $NAME / values ...
    tags = list(first_tags[1:])
    for t, tg in body:
        tags += tg
    cur = None
    for c, v in tags:
        if c == 9:
            cur = v
            doc.header[cur] = []
        elif cur:
            doc.header[cur].append((c, v))


def _tables(doc, body):
    table = None
    for t, tags in body:
        if t == "TABLE":
            table = tags[0][1] if tags else None
            continue
        if t == "ENDTAB":
            table = None
            continue
        e = Ent(t, tags)
        name = (e.get(2) or "")
        if t == "LAYER":
            doc.layers[name.upper()] = e
            h = e.get(5)
            if h:
                doc.layer_by_handle[h] = name
        elif t == "LTYPE":
            doc.ltypes[name.upper()] = e
        elif t == "STYLE":
            doc.styles[name.upper()] = e
        elif t == "BLOCK_RECORD":
            h = e.get(5)
            if h:
                doc.records[h] = name


def _blocks(doc, body):
    cur = None
    ents = []
    for t, tags in body:
        if t == "BLOCK":
            e = Ent(t, tags)
            cur = Block(e.get(2) or e.get(3) or "", e.pt(10), e.i(70), e.get(1) or "", e.get(5) or "", e.get(330) or "")
            ents = []
            continue
        if t == "ENDBLK":
            if cur is not None:
                cur.ents = _attach(ents)
                doc.blocks[cur.name.upper()] = cur
            cur = None
            continue
        if cur is not None:
            ents.append((t, tags))


# ------------------------------------------------------------- text

_SPECIAL = {"c": u"\u00d8", "d": u"\u00b0", "p": u"\u00b1", "%": "%"}


def plain_text(s):
    """TEXT / ATTRIB: %%c %%d %%p, \\U+XXXX, and %%u / %%o (underline,
    overline) dropped."""
    s = re.sub(r"\\U\+([0-9A-Fa-f]{4})", lambda m: chr(int(m.group(1), 16)), s or "")
    s = s.replace("^I", "    ").replace("^J", " ").replace("^M", "").replace("^ ", "^")
    s = re.sub(r"\\M\+[0-9A-Fa-f]{5}", "?", s)
    s = re.sub(r"%%(\d{3})", lambda m: chr(int(m.group(1))), s)
    s = re.sub(r"%%([cdpCDP%])", lambda m: _SPECIAL[m.group(1).lower()], s)
    s = re.sub(r"%%[uoUOkK]", "", s)
    return s


def mtext_lines(s):
    """MTEXT: its paragraphs as plain lines (formatting codes dropped,
    stacked fractions as a/b)."""
    s = re.sub(r"\\U\+([0-9A-Fa-f]{4})", lambda m: chr(int(m.group(1), 16)), s or "")
    out, i, n = [], 0, len(s)
    buf = []
    while i < n:
        ch = s[i]
        if ch == "\\" and i + 1 < n:
            k = s[i + 1]
            if k == "P":
                out.append("".join(buf)); buf = []; i += 2; continue
            if k == "~":
                buf.append(u"\u00a0"); i += 2; continue
            if k in "\\{}":
                buf.append(k); i += 2; continue
            if k == "S":
                j = s.find(";", i)
                if j < 0:
                    j = n
                body = s[i + 2:j]
                buf.append(re.sub(r"[\^#]", "/", body).replace("/ ", "/"))
                i = j + 1
                continue
            if k in "LlOoKkNn":
                i += 2; continue
            if k in "fFHhWwQqTtAaCcp":
                j = s.find(";", i)
                i = (j + 1) if j >= 0 else n
                continue
            buf.append(k); i += 2; continue
        if ch in "{}":
            i += 1; continue
        buf.append(ch)
        i += 1
    out.append("".join(buf))
    return [plain_text(x) for x in out]
