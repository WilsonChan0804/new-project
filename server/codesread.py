# -*- coding: utf-8 -*-
"""Making the Codes library's clauses easier to read, with no AI:

  reflow(text)        the printed line breaks of a PDF joined back into
                      paragraphs; list items (a) (i), headings and table
                      rows keep their lines
  quick_facts(...)    the answer at a glance: from the clauses found, those
                      about what was asked, their figures (24m, 1050mm,
                      120 minutes, 25%) with the lead line and the (a)/(i)
                      conditions above each - as the clause states them
  captions(pages)     the diagrams a document has: "Diagram B2 : Internal
                      Corridor Access" -> (label, page, caption)
  diagram_refs(text)  the diagrams a clause points to: "See Diagrams B2, B3
                      and B4" -> ["B2", "B3", "B4"]
"""
import re

MARK = re.compile(r"^\s*(\((?:[a-z]{1,2}|[ivx]{1,5}|\d{1,2})\)|[a-z]\)|[ivx]{1,5}\)|[•▪●\-–]\s|\d{1,2}\.\s)", re.I)
# a heading line: "Clause B11.2" on its own, "Table B2: ...", "Notes:" - not a
# sentence that wraps onto a line starting "Clause B10.6, 24m to ..."
HEAD = re.compile(r"^\s*(?:(?:Clause|Subsection|Section|Part|Appendix|Annex|Regulation)\s+[\w.()–-]{1,14}(?:\s*[–-]\s.*)?$"
                  r"|(?:Table|Diagram)\s+[A-Z]{0,2}\d{1,3}[a-z]?\s*[:：–—-]|(?:Notes?|Commentary)\s*:?\s*$)", re.I)
ROMAN = set("i ii iii iv v vi vii viii ix x xi xii xiii xiv xv".split())

FIG = re.compile(
    r"(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*"
    r"(mm|m²|m2|sq\.?\s?m|m³|m3|cu\.?\s?m|metres?|meters?|m|minutes?|mins?|hours?|%|per\s?cent|persons?|people|storeys?|floors?|kpa|pa|lux|°c|degrees?|seats?)(?![a-z])"
    r"|\b1\s*(?:in|:)\s*\d{1,3}\b", re.I)


def norm(s):
    return re.sub(r"[\s\-‐–_/]+", "", (s or "").lower())


def reflow(text):
    """Join a PDF's broken lines into paragraphs; keep list items, headings,
    table-like rows and blank-line breaks."""
    out = []
    bare = False          # the last line is a list marker on its own: "(i)"
    after_head = False    # the last line is a heading: "Clause B11.2"
    for raw in (text or "").split("\n"):
        line = raw.rstrip()
        s = line.strip()
        if not s:
            if out and out[-1] != "" and not bare:
                out.append("")
            continue
        if bare:              # "(i)" + "24m from ..." -> "(i) 24m from ..."
            out[-1] = out[-1] + " " + s
            bare = bool(re.fullmatch(MARK.pattern.replace("^\\s*", "^") + r"\s*", out[-1], re.I))
            after_head = False
            continue
        new = (not out or out[-1] == "" or after_head or MARK.match(s) or HEAD.match(s)
               or re.match(r'^[“"‘][A-Z][^”"’]{1,80}[”"’]\s+(means|includes|has the|refers)\b', s)   # a definition
               or re.search(r"\S\s{3,}\S", line)                  # columns of a table
               or out[-1].endswith(":") or len(out[-1]) < 3
               or re.match(r"^[A-Z0-9][A-Z0-9 ,&()'/-]{6,}$", s))   # a heading in capitals
        if new:
            if MARK.match(s) and len(out) >= 2 and out[-1] == "" and (MARK.match(out[-2]) or out[-2].endswith(":")):
                out.pop()             # a list's items: no blank line between them
            out.append(s)
            bare = bool(MARK.match(s)) and len(MARK.match(s).group(0).strip()) == len(s)
            after_head = bool(HEAD.match(s)) and not bare
        else:
            prev = out[-1]
            out[-1] = (prev[:-1] + s) if prev.endswith("-") and not prev.endswith(" -") else prev + " " + s
    while out and out[-1] == "":
        out.pop()
    return "\n".join(out)


def _level(marker, seen_letter):
    m = re.match(r"\(?([a-z]{1,5}|\d{1,2})\)?", marker.strip().lower())
    if not m:
        return 3
    t = m.group(1)
    if t.isdigit():
        return 1
    if t in ROMAN and (seen_letter or len(t) > 1):
        return 2
    return 1


def _short(s, n):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s if len(s) <= n else s[:n - 1].rsplit(" ", 1)[0] + " …"


def items_of(text):
    """The clause as (lead, [(path, item)]): path = the texts of the (a) / (i)
    items above it."""
    paras = [p for p in reflow(text).split("\n") if p.strip()]
    lead = ""
    out = []
    stack = []            # [(level, text)]
    seen_letter = False
    for p in paras:
        m = MARK.match(p)
        if not m:
            if HEAD.match(p) and not lead:
                continue        # "Clause B11.2" itself
            if not stack and not lead:
                lead = p
            else:
                out.append((list(t for _, t in stack), p))
            continue
        lv = _level(m.group(1), seen_letter)
        if lv == 1:
            seen_letter = True
        body = p[m.end():].strip()
        while stack and stack[-1][0] >= lv:
            stack.pop()
        out.append((list(t for _, t in stack), body))
        stack.append((lv, body))
    return lead, out


def figures(s):
    return [m.group(0).strip() for m in FIG.finditer(s or "")]


def quick_facts(rows, terms, n_clauses=3, n_rows=8):
    """rows: the clauses found, best first ({text, ref, page, title, ...});
    terms: the words searched for (with their other names). -> [{k (1-based
    row), ref, lead, facts: [{figure, when, text}]}]"""
    want = [norm(t) for t in terms or [] if len(norm(t)) >= 3]
    if not want:
        return []
    picked, total = [], 0
    scored = []
    for k, r in enumerate(rows or []):
        text = r.get("text", "")
        body = norm(text)
        hits = sum(1 for t in set(want) if t in body)
        if not hits:
            continue
        lead, items = items_of(text)
        n_fig = sum(1 for _, it in items if figures(it))
        # about it: named in its lead line; useful: figures in its items;
        # a clause rather than a diagram's legend (R1, d1 ...); then the
        # search's own order
        score = hits + (3 if any(t in norm(lead) for t in want) else 0) + min(n_fig, 4) * 0.5 \
            + (1 if re.match(r"^(clause|regulation|table|para|section)\b|^[a-z]{0,2}\d+(\.\d+)+", (r.get("ref") or "").lower()) else 0) - k * 0.15
        scored.append((-score, k, r))
    scored.sort(key=lambda x: (x[0], x[1]))
    for _, k, r in scored:
        if len(picked) >= n_clauses or total >= n_rows:
            break
        lead, items = items_of(r.get("text", ""))
        about_lead = any(t in norm(lead) for t in want)
        facts = []
        for path, item in items:
            f = figures(item)
            if not f:
                continue
            # a figure about what was asked: the term in the item, the
            # conditions above it, or the clause's lead line ("The deadend
            # travel distance is limited to:") - not a figure of a
            # neighbouring definition in the same text
            if not about_lead and not any(t in norm(" ".join(path) + " " + item) for t in want):
                continue
            when = " › ".join(_short(re.sub(r":\s*$", "", x), 70) for x in path if x)
            facts.append({"figure": f[0], "when": when, "text": _short(item, 220)})
            if total + len(facts) >= n_rows:
                break
        if not facts and figures(lead) and about_lead:
            facts.append({"figure": figures(lead)[0], "when": "", "text": _short(lead, 220)})
            lead = ""
        if facts:
            picked.append({"k": k + 1, "ref": r.get("ref") or "", "page": r.get("page") or 0, "title": r.get("title") or "",
                           "lead": _short(lead, 160), "facts": facts})
            total += len(facts)
    return picked


# ---------------------------------------------------------------- diagrams

CAPTION = re.compile(r"^\s*Diagrams?\s+([A-Z]{1,2}\d{1,3}[a-z]?)\s*(?:[:：–—-]\s*|\s{2,})(.{3,})$")


def captions(pages):
    """[(label, page (1-based), caption)] - each diagram once, on the page
    its caption is."""
    seen, out = set(), []
    for i, text in enumerate(pages or []):
        for line in (text or "").split("\n"):
            m = CAPTION.match(line)
            if not m:
                continue
            label, cap = m.group(1).upper(), re.sub(r"\s+", " ", m.group(2)).strip()
            if label in seen or re.match(r"^(shows|illustrates|and|or|for|see)\b", cap, re.I):
                continue
            seen.add(label)
            out.append((label, i + 1, cap[:160]))
    return out


REF = re.compile(r"\bDiagrams?\s+([A-Z]{1,2}\d{1,3}[a-z]?(?:\s*(?:,|and|&|to|-|–)\s*(?:[A-Z]{1,2})?\d{1,3}[a-z]?)*)", re.I)


def diagram_refs(text):
    out = []
    for m in REF.finditer(text or ""):
        letter = ""
        span = m.group(1)
        rng = re.search(r"([A-Z]{1,2})(\d{1,3})\s*(?:to|-|–)\s*(?:[A-Z]{1,2})?(\d{1,3})", span, re.I)
        for tok in re.findall(r"([A-Z]{1,2})?(\d{1,3}[a-z]?)", span, re.I):
            if tok[0]:
                letter = tok[0].upper()
            if letter:
                lab = letter + tok[1]
                if lab not in out:
                    out.append(lab)
        if rng:                     # "Diagrams B2 to B4"
            L, a, b = rng.group(1).upper(), int(rng.group(2)), int(rng.group(3))
            for x in range(a, min(b, a + 12) + 1):
                if L + str(x) not in out:
                    out.append(L + str(x))
    return out
