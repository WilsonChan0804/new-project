"""MkDocs hook: link document references and highlight key words.

1. Turns plain mentions such as "APP-2", "JPN 4", "B(P)R 23(3)(b)", "BO s.16",
   "FS Code Clause B8.2", "Cap. 123H" into links to the page on this site.
2. In long paragraphs and list items without much emphasis, marks numbers with
   units (e.g. 1.5 m, 60 days, 10%) and decisive phrases (e.g. "not acceptable",
   "understanding was correct") so they are easy to scan.

Text inside links, headings, code, figure captions and tables of contents is
left untouched. No markdown files are changed; this runs at build time.
"""
import os
import re
from html import escape

_PAGES = set()
_URL = {}
from mkdocs.utils import get_relative_url
_HEAD = re.compile(r'<(a|h[1-6]|code|pre|script|style|figcaption|nav|label|button|svg|title)\b', re.I)

def on_files(files, config):
    _PAGES.clear()
    for f in files:
        if f.src_uri.endswith('.md'):
            _PAGES.add(f.src_uri); _URL[f.src_uri] = f.url
    return files

def _bpr(n):
    m = re.match(r'(\d+)([A-Z]?)', n); x = int(m.group(1))
    if x <= 16: return 'regulations/bpr-parts-1-2.md'
    if n.startswith('18A') or 19 <= x <= 22: return 'regulations/bpr-18a-22.md'
    if x == 23: return 'regulations/bpr-23-23a.md'
    if x <= 38: return 'regulations/bpr-24-37.md'
    if x <= 49: return 'regulations/bpr-39-49e.md'
    if x <= 70: return 'regulations/bpr-50-70.md'
    return 'regulations/bpr-71-73.md'

def _bo(n):
    m = re.match(r'(\d+)([A-Z]*)', n); x = int(m.group(1))
    if x <= 13: return 'regulations/bo-part-1-registration.md'
    if x <= 21: return 'regulations/bo-part-2-building-works.md'
    if x < 30 or (x == 30 and not m.group(2)): return 'regulations/bo-part-2-enforcement.md'
    if x == 30: return 'regulations/bo-part-2a-inspection.md'
    if x <= 39: return 'regulations/bo-part-3-miscellaneous.md'
    return 'regulations/bo-parts-4-9-schedules.md'

_FSC = {'B': 'codes/fsc-part-b-means-of-escape.md', 'C': 'codes/fsc-part-c-fire-resisting-construction.md',
        'D': 'codes/fsc-part-d-means-of-access.md', 'E': 'codes/fsc-parts-e-f-g.md', 'F': 'codes/fsc-parts-e-f-g.md',
        'G': 'codes/fsc-parts-e-f-g.md'}
_CAP = {'123': 'regulations/index.md', '123A': 'regulations/bar-123a.md', '123C': 'regulations/bdwr-123c.md',
        '123F': 'regulations/index.md', '123G': 'regulations/bpsar-123g.md', '123H': 'regulations/brsr-123h.md',
        '123I': 'regulations/bsfpwr-123i.md', '123J': 'regulations/bvsr-123j.md', '123K': 'regulations/bosir-123k.md',
        '123L': 'regulations/bar-123l.md', '123M': 'regulations/beer-123m.md', '123N': 'regulations/bmwr-123n.md',
        '123O': 'regulations/bmwfr-123o.md', '123P': 'regulations/bir-123p.md', '123Q': 'regulations/bcr-123q.md'}

_RULES = [
    (re.compile(r'\b(?:PNAP\s+)?(APP|ADM|ADV)[-–](\d{1,3})\b'), lambda m: f'pnap/{m.group(1).lower()}-{int(m.group(2))}.md'),
    (re.compile(r'\bJPN\s?(?:No\.\s?)?(\d)\b'), lambda m: f'pnap/jpn-{m.group(1)}.md'),
    (re.compile(r'\bB\(P\)R\s?(?:reg(?:ulation)?s?\.?\s?)?(\d{1,2}[A-Z]?)(?:\([0-9a-z]+\))*'), lambda m: _bpr(m.group(1))),
    (re.compile(r'\bB\(A\)R(?:\s?(?:reg\.?\s?)?\d{1,2}[A-Z]?(?:\([0-9a-z]+\))*)?'), lambda m: 'regulations/bar-123a.md'),
    (re.compile(r'\bB\(C\)R(?:\s?(?:reg\.?\s?|s\.)?\d{1,3}[A-Z]?(?:\([0-9a-z]+\))*)?'), lambda m: 'regulations/bcr-123q.md'),
    (re.compile(r'\bB\(MW\)R(?:\s?(?:s\.)?\d{1,3}[A-Z]?(?:\([0-9a-z]+\))*)?'), lambda m: 'regulations/bmwr-123n.md'),
    (re.compile(r'\bBO\s+(?:s\.|section\s)\s?(\d{1,2}[A-Z]{0,2})(?:\([0-9a-z]+\))*'), lambda m: _bo(m.group(1))),
    (re.compile(r'\b(?:FS Code\s+)?(?:Clause|clause)\s([BCDEFG])\d{1,2}(?:\.\d+)*(?:\([a-z0-9]+\))*'), lambda m: _FSC[m.group(1)]),
    (re.compile(r'\bCap\.\s?(123[A-Q]?)\b'), lambda m: _CAP.get(m.group(1))),
]
_UNITS = re.compile(r'(?<![\w.])(\d{1,3}(?:,\d{3})*(?:\.\d+)?\s?(?:mm|m²|m2|m³|m|km|%|kPa|kN|kg|days?|weeks?|months?|years?|hours?|storeys?|lux|ACH|°C?|L/s))(?![\w])')
_PHRASES = re.compile(r'\b(not acceptable|not be accepted|could not be accepted|understanding was (?:in)?correct|was incorrect|was correct|favourably consider(?:ed)?|case[- ]by[- ]case basis|on individual merits|must not|shall not|should not|not required|would not be required|still pertinent|remained unchanged|still applicable|disregarded from GFA calculation|exempted from GFA|subject to)\b', re.I)

def _link_text(text, here_dir, here):
    out = text
    fs_ctx = bool(re.search(r'FS Code|Fire Safety|fire safety|消防', text)) or here.startswith('codes/fsc') or 'fire-safety' in here
    for rx, fn in _RULES:
        if 'Clause|clause' in rx.pattern and not fs_ctx:
            continue
        def rep(m):
            tgt = fn(m)
            if not tgt or tgt not in _PAGES or tgt == here:
                return m.group(0)
            return '\x00A' + tgt + '\x01' + m.group(0) + '\x00/A'
        # only operate outside already-inserted links
        parts = re.split(r'(\x00A.*?\x00/A)', out)
        out = ''.join(p if p.startswith('\x00A') else rx.sub(rep, p) for p in parts)
    return out

def _highlight(text):
    parts = re.split(r'(\x00A.*?\x00/A)', text)
    res = []
    for p in parts:
        if p.startswith('\x00A'):
            res.append(p); continue
        p = _UNITS.sub(lambda m: '\x00M' + m.group(1) + '\x00/M', p)
        p = _PHRASES.sub(lambda m: '\x00K' + m.group(1) + '\x00/K', p)
        res.append(p)
    return ''.join(res)

def on_page_content(html, page, config, files):
    here = page.file.src_uri
    here_dir = os.path.dirname(here)
    use_dir = config.get('use_directory_urls', True)
    tokens = re.split(r'(<[^>]+>)', html)
    stack = []          # protected elements currently open
    block = None        # index of current <p>/<li> opening
    out = []
    # first pass: link text nodes, remember paragraph boundaries
    for t in tokens:
        if t.startswith('<'):
            m = re.match(r'<(/?)([a-zA-Z0-9]+)', t)
            if m:
                name = m.group(2).lower(); closing = bool(m.group(1))
                if _HEAD.match('<' + name) and not t.endswith('/>'):
                    if closing:
                        if name in stack:
                            while stack and stack.pop() != name: pass
                    else:
                        stack.append(name)
            out.append(t)
        else:
            if not stack and t.strip():
                t = _link_text(t, here_dir, here)
            out.append(t)
    html = ''.join(out)
    # second pass: highlight inside long paragraphs / list items with little emphasis
    def hl(m):
        inner = m.group(2)
        plain = re.sub(r'<[^>]+>|\x00/?[AMK]', '', inner)
        if len(plain) < 260 or inner.count('<strong>') >= 2 or '<mark' in inner:
            return m.group(0)
        segs = re.split(r'(<[^>]+>)', inner)
        st = []; res = []
        for s in segs:
            if s.startswith('<'):
                n = re.match(r'<(/?)([a-zA-Z0-9]+)', s)
                if n and n.group(2).lower() in ('a', 'code', 'strong', 'b', 'em'):
                    if n.group(1):
                        if st: st.pop()
                    elif not s.endswith('/>'):
                        st.append(n.group(2))
                res.append(s)
            else:
                res.append(s if st else _highlight(s))
        return m.group(1) + ''.join(res) + m.group(3)
    html = re.sub(r'(<(?:p|li)(?:\s[^>]*)?>)(.*?)(</(?:p|li)>)', hl, html, flags=re.S)
    # materialise markers
    def mk_link(m):
        href = get_relative_url(_URL[m.group(1)], page.url)
        return f'<a class="autolink" href="{href}">{m.group(2)}</a>'
    html = re.sub(r'\x00A(.*?)\x01(.*?)\x00/A', mk_link, html)
    html = re.sub(r'\x00M(.*?)\x00/M', r'<strong class="kw-num">\1</strong>', html)
    html = re.sub(r'\x00K(.*?)\x00/K', r'<mark class="kw">\1</mark>', html)
    return html
