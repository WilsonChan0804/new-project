# -*- coding: utf-8 -*-
"""The Programme as a PDF for the client: a title block, the chosen columns,
a timescale, bars (critical in red), summary brackets, milestones, baseline
bars, progress, the links and the status line, a legend and the remarks -
vector, one page wide, as many pages down as the rows need.

The page (viewer/programme.js) works the schedule out (viewer/progcore.js)
and sends what to draw; this only draws it:

  {cover: {title, project, client, rev, date, prepared, status_date, office},
   paper: "A3"|"A4"|"A1", orient: "landscape"|"portrait",
   columns: [{key, label, w (mm), align}],
   rows: [{name, level, summary, milestone, critical, start, finish, pct,
           bstart, bfinish, cells: {key: text}}],
   links: [{from, to, type, critical}]   (row indexes)
   range: {from, to}, show: {links, baseline, progress, status, critical},
   remarks: [..]}
"""
import datetime
import io
import os
import re

from reportlab.lib import colors
from reportlab.lib.pagesizes import A1, A3, A4, landscape, portrait
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

PAPER = {"A4": A4, "A3": A3, "A1": A1}
INK = colors.HexColor("#1f2328")
MUTED = colors.HexColor("#5f6670")
LINE = colors.HexColor("#c9ced6")
GRID = colors.HexColor("#e6e9ee")
BAND = colors.HexColor("#f6f7f9")
HEAD = colors.HexColor("#2f3a48")
BAR = colors.HexColor("#4a78a8")
BAR_DONE = colors.HexColor("#22476d")
CRIT = colors.HexColor("#c62828")
CRIT_DONE = colors.HexColor("#7f1414")
BASE = colors.HexColor("#9aa3ad")
SUMMARY = colors.HexColor("#2b2f36")
MILE = colors.HexColor("#2b2f36")
STATUS = colors.HexColor("#d9480f")
LINK = colors.HexColor("#6c7c90")
ACCENT = colors.HexColor("#c8682c")

FONT_PLACES = [
    os.environ.get("LWK_CAD_FONT", ""),
    "C:\\Windows\\Fonts\\msjh.ttc", "C:\\Windows\\Fonts\\mingliu.ttc", "C:\\Windows\\Fonts\\msyh.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", "/usr/share/fonts/truetype/arphic/uming.ttc",
    "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf", "/System/Library/Fonts/PingFang.ttc",
]
_CJK = []


def cjk():
    """A font for Chinese text: one on the server (embedded), else
    reportlab's Traditional Chinese CID font (the reader supplies it)."""
    if _CJK:
        return _CJK[0]
    name = None
    from reportlab.pdfbase.ttfonts import TTFont
    for p in FONT_PLACES:
        if p and os.path.isfile(p):
            try:
                pdfmetrics.registerFont(TTFont("LwkCJK", p, subfontIndex=0) if p.lower().endswith(".ttc") else TTFont("LwkCJK", p))
                name = "LwkCJK"
                break
            except Exception:
                continue
    if not name:
        try:
            from reportlab.pdfbase.cidfonts import UnicodeCIDFont
            pdfmetrics.registerFont(UnicodeCIDFont("MSung-Light"))
            name = "MSung-Light"
        except Exception:
            name = "Helvetica"
    _CJK.append(name)
    return name


def font(text, bold=False):
    if re.search(r"[^\x00-\u024f\u2010-\u2027\u2030-\u205e]", text or ""):
        return cjk()
    return "Helvetica-Bold" if bold else "Helvetica"


def fit(text, f, size, width):
    text = str(text or "")
    if pdfmetrics.stringWidth(text, f, size) <= width:
        return text
    while text and pdfmetrics.stringWidth(text + "…", f, size) > width:
        text = text[:-1]
    return (text + "…") if text else ""


def put(c, x, y, text, size=7, bold=False, color=INK, width=None, align="left"):
    text = str(text or "")
    f = font(text, bold)
    if width:
        text = fit(text, f, size, width)
    c.setFont(f, size)
    c.setFillColor(color)
    if align == "right":
        c.drawRightString(x, y, text)
    elif align == "center":
        c.drawCentredString(x, y, text)
    else:
        c.drawString(x, y, text)


def hexc(v, default):
    v = str(v or "")
    if re.match(r"^#[0-9a-fA-F]{6}$", v):
        return colors.HexColor(v)
    return default


def darker(col, k=0.55):
    return colors.Color(col.red * k, col.green * k, col.blue * k)


def day(s):
    try:
        return datetime.date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None


def nice(d):
    return d.strftime("%d %b %Y").lstrip("0") if d else ""


MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def build(spec):
    """-> PDF bytes"""
    cover = spec.get("cover") or {}
    size = PAPER.get(str(spec.get("paper") or "A3").upper(), A3)
    size = portrait(size) if spec.get("orient") == "portrait" else landscape(size)
    W, H = size
    show = dict({"links": True, "baseline": False, "progress": True, "status": True, "critical": True}, **(spec.get("show") or {}))
    rows = list(spec.get("rows") or [])[:5000]
    cols = [x for x in (spec.get("columns") or []) if x.get("key")][:14]
    if not any(x["key"] == "name" for x in cols):
        cols.insert(0, {"key": "name", "label": "Task name", "w": 70})
    links = spec.get("links") or []
    remarks = [str(r) for r in (spec.get("remarks") or []) if str(r).strip()][:12]

    m = 10 * mm
    small = W < 620                       # A4 portrait
    rh = (4.6 if small else 5.2) * mm
    fs = 6.2 if small else 7
    title_h = 22 * mm
    head_h = 10 * mm
    legend_h = ((15 + 3.6 * len(remarks)) * mm if remarks else 10 * mm) + (4 * mm if spec.get("categories") else 0)
    body_top = H - m - title_h - 3 * mm
    body_h = body_top - head_h - (m + legend_h + 3 * mm)
    if rows and body_h < len(rows) * rh <= body_h * 1.2:   # a few rows over: tighter, to keep one page
        rh = body_h / len(rows)
        fs = max(5.6, fs * rh / ((4.6 if small else 5.2) * mm))
    elif rows and len(rows) * rh < body_h:          # few rows: roomier, up to 7.5 mm
        rh = min(7.5 * mm, body_h / len(rows))
        fs = min(fs + 1, 8) if rh > 6.2 * mm else fs
    per = max(1, int(body_h / rh + 1e-6))
    pages = max(1, (len(rows) + per - 1) // per)

    # the whole time range
    ds = [day(r.get(k2)) for r in rows for k2 in ("start", "finish", "bstart", "bfinish")]
    ds = [d for d in ds if d]
    D0 = day((spec.get("range") or {}).get("from")) or (min(ds) if ds else datetime.date.today())
    D1 = day((spec.get("range") or {}).get("to")) or (max(ds) if ds else D0 + datetime.timedelta(days=30))
    if D1 <= D0:
        D1 = D0 + datetime.timedelta(days=7)
    D0 = D0 - datetime.timedelta(days=D0.weekday())                     # a Monday
    D1 = D1 + datetime.timedelta(days=max(7, (D1 - D0).days // 22))     # room for a last label
    # pages wide: the range cut in equal slices; later slices repeat the ID and the name
    nw = spec.get("pages_wide") or 1
    if nw == "auto":
        nw = max(1, min(6, int(round((D1 - D0).days / (122 if W > 1000 else 92 if W > 700 else 61)))))
    nw = max(1, min(6, int(nw)))
    repeat = spec.get("repeat_names", True)
    ALL_COLS = cols
    slices = []
    step = ((D1 - D0).days + 1) / float(nw)
    for s_i in range(nw):
        a_ = D0 + datetime.timedelta(days=int(round(step * s_i)))
        b_ = D0 + datetime.timedelta(days=int(round(step * (s_i + 1))) - 1)
        slices.append((a_, b_))

    def layout(s_i):
        """the columns and the time scale of slice s_i (rebinds build's own names)"""
        out = [dict(x) for x in ALL_COLS] if s_i == 0 or not repeat else \
            [dict(x) for x in ALL_COLS if x["key"] in ("id", "name")] if repeat else []
        tw = sum(float(x.get("w") or 20) for x in out) * mm
        room = (W - 2 * m) * ((0.62 if small else 0.55) if s_i == 0 else 0.3)
        k = min(1.0, room / tw) if tw else 1.0
        for x in out:
            x["_w"] = float(x.get("w") or 20) * mm * k
        return out

    pno = [0]
    ptotal = pages * nw
    def X(d, end=False):
        return gx0 + ((d - d0).days + (1 if end else 0)) * per_day

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=size, pageCompression=0 if spec.get("_plain") else 1)
    arrow = arrow_factory(c)
    c.setTitle(cover.get("title") or "Programme")
    c.setAuthor(cover.get("office") or "LWK + PARTNERS")
    c.setSubject(cover.get("project") or "")
    status = day(cover.get("status_date"))

    def title_block(pg):
        y0 = H - m - title_h
        c.setStrokeColor(INK)
        c.setLineWidth(0.8)
        c.rect(m, y0, W - 2 * m, title_h)
        # the office
        bw = (30 if small else 42) * mm
        c.setFillColor(ACCENT)
        c.rect(m, y0, 3 * mm, title_h, stroke=0, fill=1)
        # the office's name fitted to its box (it ran into the title on narrow pages)
        office, ow = cover.get("office") or "LWK + PARTNERS", bw - 9 * mm
        osz = 10
        while osz > 6.5 and pdfmetrics.stringWidth(office, font(office, True), osz) > ow:
            osz -= 0.5
        put(c, m + 6 * mm, y0 + title_h - 8.5 * mm, office, osz, True, INK, width=ow)
        put(c, m + 6 * mm, y0 + title_h - 13 * mm, "Architecture", 6.5, False, MUTED, width=ow)
        c.setStrokeColor(LINE)
        c.setLineWidth(0.4)
        c.line(m + bw, y0, m + bw, y0 + title_h)
        # the title
        tx = m + bw + 5 * mm
        right_w = 100 * mm if not small else 72 * mm
        tt = cover.get("title") or "Programme"
        tw_ = W - 2 * m - bw - right_w - 10 * mm
        ts = 14 if not small else 12
        while ts > 8 and pdfmetrics.stringWidth(tt, font(tt, True), ts) > tw_:
            ts -= 0.5
        put(c, tx, y0 + title_h - 9 * mm, tt, ts, True, INK, width=tw_)
        sub = " · ".join(x for x in (cover.get("project"), ("Client: " + cover["client"]) if cover.get("client") else "") if x)
        put(c, tx, y0 + title_h - 15 * mm, sub, 8, False, MUTED, width=W - 2 * m - bw - right_w - 10 * mm)
        if cover.get("note"):
            put(c, tx, y0 + 3.2 * mm, cover["note"], 6.5, False, MUTED, width=W - 2 * m - bw - right_w - 10 * mm)
        # the details
        rx = W - m - right_w
        c.line(rx, y0, rx, y0 + title_h)
        cells = [("Revision", cover.get("rev") or "-"), ("Date", nice(day(cover.get("date"))) or cover.get("date") or nice(datetime.date.today())),
                 ("Status date", nice(status) or "-"), ("Prepared by", cover.get("prepared") or "-"),
                 ("Project start", nice(day(spec.get("start"))) or "-"), ("Project finish", nice(day(spec.get("finish"))) or "-")]
        cw, ch = right_w / 2, title_h / 3
        for i, (lab, val) in enumerate(cells):
            cx, cy = rx + (i % 2) * cw, y0 + title_h - (i // 2 + 1) * ch
            if i % 2:
                c.line(cx, cy, cx, cy + ch)
            if i // 2:
                c.line(rx, cy + ch, W - m, cy + ch)
            put(c, cx + 2 * mm, cy + ch - 3.2 * mm, lab, 5.5, False, MUTED)
            put(c, cx + 2 * mm, cy + 1.6 * mm, val, 7.5, True, INK, width=cw - 4 * mm)

    def timescale(y):
        # the band behind the column heads and the scale
        c.setFillColor(HEAD)
        c.rect(m, y, W - 2 * m, head_h, stroke=0, fill=1)
        x = m
        for col in cols:
            put(c, x + 1.5 * mm, y + 3.5 * mm, col.get("label") or "", 6.5, True, colors.white, width=col["_w"] - 3 * mm)
            x += col["_w"]
        # upper tier: years (or months for a weekly scale); lower: the unit
        mid = y + head_h / 2
        c.setStrokeColor(colors.HexColor("#56657a"))
        c.setLineWidth(0.3)
        c.line(gx0, mid, gx1, mid)
        ups = []
        d = d0
        while d <= d1:
            if unit == "week":
                key = (d.year, d.month)
                nxt = (datetime.date(d.year + (d.month == 12), d.month % 12 + 1, 1))
                lab = "%s %d" % (MONTHS[d.month - 1], d.year)
            else:
                key = d.year
                nxt = datetime.date(d.year + 1, 1, 1)
                lab = str(d.year)
            ups.append((max(d, d0), min(nxt - datetime.timedelta(days=1), d1), lab))
            d = nxt
        for a, b, lab in ups:
            xa, xb = X(a), X(b, True)
            c.line(xa, mid, xa, y + head_h)
            if xb - xa > 8 * mm:
                put(c, xa + 1.2 * mm, mid + 1.4 * mm, lab, 6.5, True, colors.white, width=xb - xa - 2 * mm)
        lows = []
        d = d0
        while d <= d1:
            if unit == "week":
                nxt = d + datetime.timedelta(days=7)
                lab = "%d/%d" % (d.day, d.month)
            elif unit == "month":
                nxt = datetime.date(d.year + (d.month == 12), d.month % 12 + 1, 1)
                lab = MONTHS[d.month - 1]
            else:
                q0 = (d.month - 1) // 3
                nxt = datetime.date(d.year + (q0 == 3), (q0 + 1) % 4 * 3 + 1, 1)
                lab = "Q%d" % (q0 + 1)
            lows.append((max(d, d0), min(nxt - datetime.timedelta(days=1), d1), lab))
            d = nxt
        for a, b, lab in lows:
            xa, xb = X(a), X(b, True)
            c.line(xa, y, xa, mid)
            if xb - xa > 4.5 * mm:
                put(c, (xa + xb) / 2, y + 1.6 * mm, lab, 5.6, False, colors.white, align="center")
        return lows

    def legend(pg):
        y = m
        c.setStrokeColor(LINE)
        c.setLineWidth(0.4)
        c.rect(m, y, W - 2 * m, legend_h)
        ly = y + legend_h - 5.5 * mm
        x = m + 3 * mm
        items = [("bar", "Task"), ("crit", "Critical task"), ("done", "Progress"), ("sum", "Summary"), ("mile", "Milestone")]
        if any(l.get("drive") is False for l in links):
            items.append(("rel", "Related link (not scheduled)"))
        if show.get("baseline"):
            items.append(("base", "Baseline"))
        for cat in (spec.get("categories") or [])[:10]:
            items.append(("cat:" + str(cat.get("color") or ""), str(cat.get("name") or "")[:30]))
        if show.get("status") and status:
            items.append(("status", "Status date"))
        for kind, lab in items:
            need = 10 * mm + pdfmetrics.stringWidth(lab, font(lab), 6.5) + 4 * mm
            if x + need > W - m - 3 * mm:            # the next line
                x = m + 3 * mm
                ly -= 4 * mm
            if kind.startswith("cat:"):
                c.setFillColor(hexc(kind[4:], BAR))
                c.rect(x, ly, 8 * mm, 2.2 * mm, stroke=0, fill=1)
            elif kind == "rel":
                c.setStrokeColor(LINK)
                c.setDash(2.2, 1.4)
                c.line(x, ly + 1.1 * mm, x + 8 * mm, ly + 1.1 * mm)
                c.setDash()
            elif kind in ("bar", "crit", "done"):
                c.setFillColor({"bar": BAR, "crit": CRIT, "done": BAR_DONE}[kind])
                c.rect(x, ly, 8 * mm, 2.2 * mm, stroke=0, fill=1)
            elif kind == "sum":
                summary_bar(x, x + 8 * mm, ly + 1.1 * mm, rh)
            elif kind == "mile":
                diamond(x + 4 * mm, ly + 1.1 * mm, 1.8 * mm, MILE)
            elif kind == "base":
                c.setFillColor(BASE)
                c.rect(x, ly + 0.6 * mm, 8 * mm, 1 * mm, stroke=0, fill=1)
            elif kind == "status":
                c.setStrokeColor(STATUS)
                c.setDash(2, 1.5)
                c.line(x + 4 * mm, ly - 1 * mm, x + 4 * mm, ly + 3.2 * mm)
                c.setDash()
            put(c, x + 10 * mm, ly + 0.3 * mm, lab, 6.5, False, INK)
            x += 10 * mm + pdfmetrics.stringWidth(lab, "Helvetica", 6.5) + (7 if not small else 4) * mm
        where = []
        if pages > 1:
            where.append("rows %d-%d" % (pg * per + 1, min(len(rows), (pg + 1) * per)))
        if nw > 1:
            where.append("%s - %s" % (nice(d0), nice(d1)))
        put(c, W - m, m - 4 * mm, "Page %d of %d%s" % (pno[0], ptotal, (" · " + " · ".join(where)) if where else ""), 6.5, False, MUTED, align="right")
        put(c, m, m - 4 * mm, "Printed %s" % nice(datetime.date.today()), 6.5, False, MUTED)
        if remarks:
            put(c, m + 3 * mm, ly - 5 * mm, "Remarks", 6.5, True, INK)
            for i, r in enumerate(remarks):
                put(c, m + 3 * mm, ly - (8.6 + 3.6 * i) * mm, "%d. %s" % (i + 1, r), 6.5, False, INK, width=W - 2 * m - 6 * mm)

    def diamond(cx, cy, r, col):
        p = c.beginPath()
        p.moveTo(cx, cy + r)
        p.lineTo(cx + r, cy)
        p.lineTo(cx, cy - r)
        p.lineTo(cx - r, cy)
        p.close()
        c.setFillColor(col)
        c.setStrokeColor(col)
        c.drawPath(p, stroke=0, fill=1)

    def summary_bar(xa, xb, cy, h):
        t = h * 0.16
        c.setFillColor(SUMMARY)
        c.rect(xa, cy, max(xb - xa, 0.5), t, stroke=0, fill=1)
        for xx, sgn in ((xa, 1), (xb, -1)):
            p = c.beginPath()
            p.moveTo(xx, cy + t)
            p.lineTo(xx, cy - h * 0.2)
            p.lineTo(xx + sgn * h * 0.22, cy)
            p.close()
            c.drawPath(p, stroke=0, fill=1)

    for s_i, (d0, d1) in enumerate(slices):
      cols = layout(s_i)
      tw = sum(x["_w"] for x in cols)
      gx0, gx1 = m + tw, W - m
      gw = gx1 - gx0
      span = (d1 - d0).days + 1
      per_day = gw / span
      unit = "week" if per_day * 7 >= 7 * mm else "month" if per_day * 30 >= 6 * mm else "quarter"
      hy0 = body_top - head_h
      y_bot0 = hy0 - per * rh

      def pos_of(ri):
          """where a row's bar is, whatever page it is on: (x start, x end, y middle, page) - as the bars are drawn"""
          r = rows[ri]
          a, b = day(r.get("start")), day(r.get("finish"))
          if not a:
              return None
          b = b or a
          i = ri % per
          cy = hy0 - (i + 1) * rh + rh / 2 + (rh * 0.07 if show.get("baseline") else 0)
          if r.get("milestone") and not r.get("summary"):
              cx = X(a) + (per_day if r.get("ms_end") else 0)
              return (cx, cx, cy, ri // per)
          return (X(a), X(b, True), cy, ri // per)

      for pg in range(pages):
        geo = {}
        if pno[0]:
            c.showPage()
        pno[0] += 1
        title_block(pg)
        hy = body_top - head_h
        lows = timescale(hy)
        part = rows[pg * per:(pg + 1) * per]
        y_bottom = hy - per * rh          # the frame runs to the foot of the page, as a form does
        # banding and grid
        for i in range(per):
            y = hy - (i + 1) * rh
            if i % 2:
                c.setFillColor(BAND)
                c.rect(m, y, W - 2 * m, rh, stroke=0, fill=1)
        c.setStrokeColor(GRID)
        c.setLineWidth(0.25)
        for a, b, lab in lows:
            c.line(X(a), y_bottom, X(a), hy)
        for i in range(per + 1):
            c.line(m, hy - i * rh, W - m, hy - i * rh)
        c.setStrokeColor(LINE)
        x = m
        for col in cols:
            x += col["_w"]
            c.line(x, y_bottom, x, hy)
        c.rect(m, y_bottom, W - 2 * m, hy - y_bottom + head_h, stroke=1, fill=0)
        # the table and the bars
        for i, r in enumerate(part):
            ri = pg * per + i
            y = hy - (i + 1) * rh
            ty = y + rh * 0.32
            x = m
            bold = bool(r.get("summary"))
            for col in cols:
                key = col["key"]
                val = r.get("name") if key == "name" else (r.get("cells") or {}).get(key, "")
                ind = (float(r.get("level") or 0) * 3 * mm) if key == "name" else 0
                al = col.get("align") or "left"
                colr = CRIT if (key == "name" and r.get("critical") and show.get("critical") and not r.get("summary") and spec.get("red_names")) else INK
                if al == "right":
                    put(c, x + col["_w"] - 1.5 * mm, ty, val, fs, bold, colr, width=col["_w"] - 3 * mm, align="right")
                elif al == "center":
                    put(c, x + col["_w"] / 2, ty, val, fs, bold, colr, width=col["_w"] - 3 * mm, align="center")
                else:
                    put(c, x + 1.5 * mm + ind, ty, val, fs, bold, colr, width=col["_w"] - 3 * mm - ind)
                x += col["_w"]
        # the chart, clipped to its own area (a slice of the time range)
        c.saveState()
        cp = c.beginPath()
        cp.rect(gx0, y_bottom, gw, hy - y_bottom)
        c.clipPath(cp, stroke=0, fill=0)
        for i, r in enumerate(part):
            ri = pg * per + i
            y = hy - (i + 1) * rh
            a, b = day(r.get("start")), day(r.get("finish"))
            if not a:
                continue
            b = b or a
            cy = y + rh / 2 + (rh * 0.07 if show.get("baseline") else 0)
            crit = r.get("critical") and show.get("critical")
            if show.get("baseline") and day(r.get("bstart")):
                ba, bb = day(r.get("bstart")), day(r.get("bfinish")) or day(r.get("bstart"))
                c.setFillColor(BASE)
                if r.get("milestone"):
                    diamond(X(ba) + per_day / 2, y + rh * 0.2, rh * 0.14, BASE)
                else:
                    c.rect(X(ba), y + rh * 0.1, max(X(bb, True) - X(ba), 0.4), rh * 0.1, stroke=0, fill=1)
            if r.get("summary"):
                xa, xb = X(a), X(b, True)
                summary_bar(xa, xb, cy + rh * 0.02, rh)
                geo[ri] = (xa, xb, cy, pg)
            elif r.get("milestone"):
                cx = X(a) + (per_day if r.get("ms_end") else 0)
                diamond(cx, cy, rh * 0.28, CRIT if crit and (spec.get("solid_red") or not r.get("fill")) else hexc(r.get("fill"), MILE))
                if crit and r.get("fill") and not spec.get("solid_red"):
                    c.setStrokeColor(CRIT)
                    c.setLineWidth(0.9)
                    q = c.beginPath()
                    rr = rh * 0.28
                    q.moveTo(cx, cy + rr); q.lineTo(cx + rr, cy); q.lineTo(cx, cy - rr); q.lineTo(cx - rr, cy); q.close()
                    c.drawPath(q, stroke=1, fill=0)
                put(c, cx + rh * 0.4, cy - 1 * mm, nice(a)[:-5] if a else "", 5.8, True, INK)
                geo[ri] = (cx, cx, cy, pg)
            else:
                xa, xb = X(a), X(b, True)
                bh = rh * 0.46
                fill = hexc(r.get("fill"), BAR)
                solid = crit and (spec.get("solid_red") or not r.get("fill"))
                c.setFillColor(CRIT if solid else fill)
                if crit and not solid:
                    c.setStrokeColor(CRIT)
                    c.setLineWidth(0.9)
                c.rect(xa, cy - bh / 2, max(xb - xa, 0.6), bh, stroke=1 if crit and not solid else 0, fill=1)
                pct = max(0, min(100, float(r.get("pct") or 0)))
                if show.get("progress") and pct:
                    c.setFillColor(CRIT_DONE if solid else darker(CRIT if solid else fill))
                    c.rect(xa, cy - bh * 0.18, (xb - xa) * pct / 100, bh * 0.36, stroke=0, fill=1)
                if r.get("label"):
                    put(c, xb + 1.2 * mm, cy - 1 * mm, r["label"], 5.6, False, MUTED, width=max(0, gx1 - xb - 2 * mm))
                geo[ri] = (xa, xb, cy, pg)
        # the links on this page
        if show.get("links"):
            c.setLineWidth(0.45)
            for ln in links:
                try:
                    f, t = int(ln.get("from")), int(ln.get("to"))
                except (TypeError, ValueError):
                    continue
                typ = str(ln.get("type") or "FS")
                if f < 0 or t < 0 or f >= len(rows) or t >= len(rows):
                    continue
                if not (f in geo and t in geo and geo[f][3] == pg and geo[t][3] == pg):
                    # one end on another page: the line runs to the chart's edge here, and on from the same x there
                    F, T = pos_of(f), pos_of(t)
                    if not F or not T or F[3] == T[3] or pg not in (F[3], T[3]):
                        continue
                    col = CRIT if ln.get("critical") and show.get("critical") else hexc(ln.get("color"), LINK)
                    c.setStrokeColor(col)
                    c.setFillColor(col)
                    sty = ln.get("style") or ("dashed" if ln.get("drive") is False else "solid")
                    st = 1.2 * mm
                    xs = F[0] if typ[0] == "S" else F[1]
                    xt = T[0] if typ[1] == "S" else T[1]
                    out = xs + st if typ[0] == "F" else xs - st
                    elbow = (typ[1] == "S" and out <= xt - 0.6 * mm) or (typ[1] == "F" and out >= xt + 0.6 * mm)
                    tx = (max(out, xt + 0.8 * mm) if typ[1] == "S" else min(out, xt - 0.8 * mm)) if elbow else out
                    fwd = T[3] > F[3]                       # on a later page: down the page, off its foot
                    here = pg == F[3]
                    edge = (y_bottom if fwd else hy) if here else (hy if fwd else y_bottom)
                    other = (s_i * pages + (T[3] if here else F[3]) + 1)
                    c.setDash(*({"dashed": (2.2, 1.4), "dotted": (0.5, 1.2)}.get(sty, ())))
                    p = c.beginPath()
                    if here:
                        p.moveTo(xs, F[2])
                        p.lineTo(tx, F[2])
                        p.lineTo(tx, edge)
                        c.drawPath(p, stroke=1, fill=0)
                        c.setDash()
                    else:
                        ty2 = T[2]
                        d = -1 if fwd else 1
                        bh = rh * 0.25
                        if elbow:
                            y_to = ty2 + (bh if d < 0 else -bh)
                            p.moveTo(tx, edge)
                            p.lineTo(tx, y_to)
                            c.drawPath(p, stroke=1, fill=0)
                            c.setDash()
                            arrow(tx, y_to, 0, d)
                        else:
                            yb = ty2 - (rh / 2) * d
                            xin = xt - st if typ[1] == "S" else xt + st
                            p.moveTo(tx, edge)
                            p.lineTo(tx, yb)
                            p.lineTo(xin, yb)
                            p.lineTo(xin, ty2)
                            p.lineTo(xt, ty2)
                            c.drawPath(p, stroke=1, fill=0)
                            c.setDash()
                            arrow(xt, ty2, 1 if typ[1] == "S" else -1, 0)
                    # where it goes on (or comes from)
                    put(c, tx + 0.8 * mm, edge + (1.2 * mm if edge == y_bottom else -2.6 * mm), ("to p.%d" if here else "from p.%d") % other, 4.8, False, col)
                    continue
                fa, fb, fy, _ = geo[f]
                ta, tb, ty2, _ = geo[t]
                xs = fa if typ[0] == "S" else fb
                xt = ta if typ[1] == "S" else tb
                col = CRIT if ln.get("critical") and show.get("critical") else hexc(ln.get("color"), LINK)
                c.setStrokeColor(col)
                c.setFillColor(col)
                sty = ln.get("style") or ("dashed" if ln.get("drive") is False else "solid")
                c.setDash(*({"dashed": (2.2, 1.4), "dotted": (0.5, 1.2)}.get(sty, ())))
                st = 1.2 * mm
                out = xs + st if typ[0] == "F" else xs - st
                down = -1 if ty2 < fy else 1
                bh = rh * 0.25
                y_from = fy
                y_to = ty2 + (bh if down < 0 else -bh)
                p = c.beginPath()
                p.moveTo(xs, y_from)
                if (typ[1] == "S" and out <= xt - 0.6 * mm) or (typ[1] == "F" and out >= xt + 0.6 * mm):
                    # an elbow down into the bar
                    tx = max(out, xt + 0.8 * mm) if typ[1] == "S" else min(out, xt - 0.8 * mm)
                    p.lineTo(tx, y_from)
                    p.lineTo(tx, y_to)
                    c.drawPath(p, stroke=1, fill=0)
                    c.setDash()
                    arrow(tx, y_to, 0, down)
                else:
                    yb = fy + (rh / 2) * down          # along the row line between them
                    xin = xt - st if typ[1] == "S" else xt + st
                    p.lineTo(out, y_from)
                    p.lineTo(out, yb)
                    p.lineTo(xin, yb)
                    p.lineTo(xin, ty2)
                    p.lineTo(xt, ty2)
                    c.drawPath(p, stroke=1, fill=0)
                    c.setDash()
                    arrow(xt, ty2, 1 if typ[1] == "S" else -1, 0)
        # the status line
        if show.get("status") and status and d0 <= status <= d1:
            sx = X(status, True)
            c.setStrokeColor(STATUS)
            c.setLineWidth(0.6)
            c.setDash(2.2, 1.6)
            c.line(sx, y_bottom, sx, hy)
            c.setDash()
        c.restoreState()
        legend(pg)
    c.save()
    return buf.getvalue()


def arrow_factory(c):
    def arrow(x, y, dx, dy):
        s = 1.1 * mm
        p = c.beginPath()
        if dx:
            p.moveTo(x, y)
            p.lineTo(x - dx * s, y + s * 0.55)
            p.lineTo(x - dx * s, y - s * 0.55)
        else:
            # dy: +1 pointing up, -1 pointing down
            p.moveTo(x, y)
            p.lineTo(x - s * 0.55, y - dy * s)
            p.lineTo(x + s * 0.55, y - dy * s)
        p.close()
        c.drawPath(p, stroke=0, fill=1)
    return arrow
