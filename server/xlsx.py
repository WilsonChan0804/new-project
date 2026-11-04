# -*- coding: utf-8 -*-
"""A small .xlsx writer: what a well-set-out schedule needs, nothing more.

No outside package (the server runs on what Python has): an .xlsx is a zip
of XML parts. This writes text, numbers and dates with styles (font, fill,
border, alignment, wrapping), column widths, row heights, merged cells,
frozen panes, an autofilter, and the print set-up (paper, orientation,
fit to width, rows repeated on every page, header and footer).

    wb = Workbook()
    st = wb.style(bold=True, fill="1F3864", color="FFFFFF", border=True)
    ws = wb.sheet("Schedule", widths=[8, 40])
    ws.row(["No.", "Comment"], style=st, height=20)
    ws.row([1, "Fire door to be FRR 60"])
    data = wb.save()            # bytes
"""
import datetime
import io
import re
import zipfile
from xml.sax.saxutils import escape

_BAD = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _x(s):
    return escape(_BAD.sub("", str(s)), {'"': "&quot;"})


def col_name(i):
    """0 -> A, 25 -> Z, 26 -> AA."""
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def ref(r, c):
    return "%s%d" % (col_name(c), r + 1)


class Workbook(object):
    def __init__(self):
        self.sheets = []
        self._fonts = ['<font><sz val="10"/><name val="Arial"/><family val="2"/></font>']
        self._fills = ['<fill><patternFill patternType="none"/></fill>',
                       '<fill><patternFill patternType="gray125"/></fill>']
        self._borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>']
        self._xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']
        self._numfmts = {}
        self._styles = {}
        self.date_style = self.style(numfmt="dd mmm yyyy")

    def _idx(self, lst, xml):
        if xml in lst:
            return lst.index(xml)
        lst.append(xml)
        return len(lst) - 1

    def style(self, bold=False, italic=False, size=10, color=None, fill=None, border=None,
              h=None, v="top", wrap=False, numfmt=None, indent=0, border_color="BFBFBF", underline=False):
        """A cell style's number. border: True (thin all round), or a string of
        the sides ("b", "tb", "lrtb"): lower case thin, upper case medium
        ("lrtB": thin, with a medium rule below)."""
        key = (bold, italic, size, color, fill, border, h, v, wrap, numfmt, indent, border_color, underline)
        if key in self._styles:
            return self._styles[key]
        font = "<font>%s%s%s<sz val=\"%s\"/>%s<name val=\"Arial\"/><family val=\"2\"/></font>" % (
            "<b/>" if bold else "", "<i/>" if italic else "", "<u/>" if underline else "", size,
            '<color rgb="FF%s"/>' % color if color else "")
        fi = self._idx(self._fonts, font)
        fl = 0
        if fill:
            fl = self._idx(self._fills, '<fill><patternFill patternType="solid"><fgColor rgb="FF%s"/>'
                                        '<bgColor indexed="64"/></patternFill></fill>' % fill)
        bo = 0
        if border:
            sides = "lrtb" if border is True else border

            def side(tag, k):
                if k.upper() in sides:
                    return '<%s style="medium"><color rgb="FF404040"/></%s>' % (tag, tag)
                if k in sides:
                    return '<%s style="thin"><color rgb="FF%s"/></%s>' % (tag, border_color, tag)
                return "<%s/>" % tag
            bo = self._idx(self._borders, "<border>%s%s%s%s<diagonal/></border>" % (
                side("left", "l"), side("right", "r"), side("top", "t"), side("bottom", "b")))
        nf = 0
        if numfmt:
            if numfmt not in self._numfmts:
                self._numfmts[numfmt] = 164 + len(self._numfmts)
            nf = self._numfmts[numfmt]
        al = ""
        if h or v or wrap or indent:
            al = "<alignment%s%s%s%s/>" % (
                ' horizontal="%s"' % h if h else "", ' vertical="%s"' % v if v else "",
                ' wrapText="1"' if wrap else "", ' indent="%d"' % indent if indent else "")
        xf = '<xf numFmtId="%d" fontId="%d" fillId="%d" borderId="%d" xfId="0"%s%s%s%s%s>%s</xf>' % (
            nf, fi, fl, bo, ' applyNumberFormat="1"' if nf else "", ' applyFont="1"' if fi else "",
            ' applyFill="1"' if fl else "", ' applyBorder="1"' if bo else "", ' applyAlignment="1"' if al else "", al)
        self._xfs.append(xf)
        n = len(self._xfs) - 1
        self._styles[key] = n
        return n

    def sheet(self, name, widths=None):
        ws = Sheet(self, name[:31], widths or [])
        self.sheets.append(ws)
        return ws

    # ------------------------------------------------------------ output

    def _styles_xml(self):
        nf = "".join('<numFmt numFmtId="%d" formatCode="%s"/>' % (i, _x(f)) for f, i in self._numfmts.items())
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                + ('<numFmts count="%d">%s</numFmts>' % (len(self._numfmts), nf) if nf else "")
                + '<fonts count="%d">%s</fonts>' % (len(self._fonts), "".join(self._fonts))
                + '<fills count="%d">%s</fills>' % (len(self._fills), "".join(self._fills))
                + '<borders count="%d">%s</borders>' % (len(self._borders), "".join(self._borders))
                + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
                + '<cellXfs count="%d">%s</cellXfs>' % (len(self._xfs), "".join(self._xfs))
                + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
                + '</styleSheet>')

    def save(self):
        strings, sidx = [], {}

        def si(s):
            if s not in sidx:
                sidx[s] = len(strings)
                strings.append(s)
            return sidx[s]

        parts = [ws._xml(si) for ws in self.sheets]
        buf = io.BytesIO()
        z = zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED)
        n = len(self.sheets)
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   + "".join('<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % (i + 1) for i in range(n))
                   + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                   '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
                   '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
                   '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
                   '</Types>')
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                   '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
                   '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
                   '</Relationships>')
        now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        z.writestr("docProps/core.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
                   'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
                   'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
                   '<dc:creator>LWK Viewer</dc:creator>'
                   '<dcterms:created xsi:type="dcterms:W3CDTF">%s</dcterms:created>'
                   '<dcterms:modified xsi:type="dcterms:W3CDTF">%s</dcterms:modified>'
                   '</cp:coreProperties>' % (now, now))
        z.writestr("docProps/app.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
                   '<Application>LWK Viewer</Application></Properties>')
        names = "".join('<definedName name="_xlnm.Print_Titles" localSheetId="%d">%s</definedName>' % (i, _x(ws._titles()))
                        for i, ws in enumerate(self.sheets) if ws.repeat_rows)
        names += "".join('<definedName name="_xlnm._FilterDatabase" localSheetId="%d" hidden="1">%s</definedName>' % (i, _x(ws._filter_ref()))
                         for i, ws in enumerate(self.sheets) if ws.filter)
        z.writestr("xl/workbook.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                   '<bookViews><workbookView activeTab="0"/></bookViews><sheets>'
                   + "".join('<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (_x(ws.name), i + 1, i + 1) for i, ws in enumerate(self.sheets))
                   + '</sheets>' + ('<definedNames>%s</definedNames>' % names if names else "") + '</workbook>')
        z.writestr("xl/_rels/workbook.xml.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   + "".join('<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>' % (i + 1, i + 1) for i in range(n))
                   + '<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' % (n + 1)
                   + '<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' % (n + 2)
                   + '</Relationships>')
        for i, p in enumerate(parts):
            z.writestr("xl/worksheets/sheet%d.xml" % (i + 1), p)
        z.writestr("xl/styles.xml", self._styles_xml())
        z.writestr("xl/sharedStrings.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="%d" uniqueCount="%d">%s</sst>'
                   % (len(strings), len(strings), "".join('<si><t xml:space="preserve">%s</t></si>' % _x(s) for s in strings)))
        z.close()
        return buf.getvalue()


_EPOCH = datetime.date(1899, 12, 30)


class Sheet(object):
    def __init__(self, wb, name, widths):
        self.wb = wb
        self.name = name
        self.widths = list(widths)
        self.rows = []              # [(cells, height)]; cell = (value, style)
        self.merges = []
        self.freeze = None          # (rows, cols) kept still
        self.filter = None          # (row, first col, last col): the header row of the filter
        self.repeat_rows = None     # (first, last), 0-based
        self.landscape = True
        self.paper = 8              # 8 = A3, 9 = A4
        self.fit_width = True
        self.header = ""
        self.footer = ""
        self.gridlines = False
        self.tab_color = None

    @property
    def n(self):
        return len(self.rows)

    def row(self, values, style=0, height=None, styles=None):
        """Add a row: values (str, int, float, date, None, [(text, bold)] for
        rich text, or (value, style)),
        with one style for all or styles[i] for each."""
        cells = []
        for i, v in enumerate(values):
            st = styles[i] if styles and i < len(styles) and styles[i] is not None else style
            if isinstance(v, tuple):
                v, st = v
            cells.append((v, st))
        self.rows.append((cells, height))
        return len(self.rows) - 1

    def merge(self, r0, c0, r1, c1):
        self.merges.append("%s:%s" % (ref(r0, c0), ref(r1, c1)))

    def _titles(self):
        a, b = self.repeat_rows
        return "'%s'!$%d:$%d" % (self.name.replace("'", "''"), a + 1, b + 1)

    def _filter_ref(self):
        r, c0, c1 = self.filter
        last = max(r, self.n - 1)
        return "'%s'!$%s$%d:$%s$%d" % (self.name.replace("'", "''"), col_name(c0), r + 1, col_name(c1), last + 1)

    def _xml(self, si):
        out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
               '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
               'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">']
        out.append('<sheetPr>%s<pageSetUpPr fitToPage="1"/></sheetPr>'
                   % ('<tabColor rgb="FF%s"/>' % self.tab_color if self.tab_color else ""))
        ncol = max([len(c) for c, _ in self.rows] + [len(self.widths), 1])
        out.append('<dimension ref="A1:%s"/>' % ref(max(self.n - 1, 0), ncol - 1))
        sv = '<sheetView workbookViewId="0"%s%s>' % (' showGridLines="0"' if not self.gridlines else "",
                                                     ' tabSelected="1"' if self is self.wb.sheets[0] else "")
        if self.freeze:
            fr, fc = self.freeze
            pane = "bottomRight" if fr and fc else ("bottomLeft" if fr else "topRight")
            sv += '<pane%s%s topLeftCell="%s" activePane="%s" state="frozen"/>' % (
                ' xSplit="%d"' % fc if fc else "", ' ySplit="%d"' % fr if fr else "", ref(fr, fc), pane)
            sv += '<selection pane="%s" activeCell="%s" sqref="%s"/>' % (pane, ref(fr, fc), ref(fr, fc))
        out.append('<sheetViews>%s</sheetView></sheetViews>' % sv)
        out.append('<sheetFormatPr defaultRowHeight="13.2"/>')
        if self.widths:
            out.append("<cols>%s</cols>" % "".join(
                '<col min="%d" max="%d" width="%s" customWidth="1"/>' % (i + 1, i + 1, w) for i, w in enumerate(self.widths)))
        out.append("<sheetData>")
        for r, (cells, height) in enumerate(self.rows):
            out.append('<row r="%d"%s>' % (r + 1, ' ht="%s" customHeight="1"' % height if height else ""))
            for c, (v, st) in enumerate(cells):
                a = ref(r, c)
                s = ' s="%d"' % st if st else ""
                if v is None or v == "":
                    if st:
                        out.append('<c r="%s"%s/>' % (a, s))
                elif isinstance(v, list):
                    # rich text: [(text, bold)], as an inline string
                    runs = "".join(
                        '<r><rPr>%s<sz val="10"/><rFont val="Arial"/><family val="2"/></rPr><t xml:space="preserve">%s</t></r>'
                        % ("<b/>" if b else "", _x(t)) for t, b in v if t)
                    out.append('<c r="%s"%s t="inlineStr"><is>%s</is></c>' % (a, s, runs or "<t></t>"))
                elif isinstance(v, bool):
                    out.append('<c r="%s"%s t="b"><v>%d</v></c>' % (a, s, 1 if v else 0))
                elif isinstance(v, (int, float)):
                    out.append('<c r="%s"%s><v>%s</v></c>' % (a, s, repr(v) if isinstance(v, float) else v))
                elif isinstance(v, datetime.date):
                    if not st:
                        s = ' s="%d"' % self.wb.date_style
                    out.append('<c r="%s"%s><v>%d</v></c>' % (a, s, (v - _EPOCH).days if not isinstance(v, datetime.datetime) else (v.date() - _EPOCH).days))
                else:
                    out.append('<c r="%s"%s t="s"><v>%d</v></c>' % (a, s, si(str(v))))
            out.append("</row>")
        out.append("</sheetData>")
        if self.filter:
            r, c0, c1 = self.filter
            out.append('<autoFilter ref="%s:%s"/>' % (ref(r, c0), ref(max(r, self.n - 1), c1)))
        if self.merges:
            out.append('<mergeCells count="%d">%s</mergeCells>' % (len(self.merges), "".join('<mergeCell ref="%s"/>' % m for m in self.merges)))
        out.append('<printOptions horizontalCentered="1"/>')
        out.append('<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.25" footer="0.25"/>')
        out.append('<pageSetup paperSize="%d" orientation="%s"%s/>' % (
            self.paper, "landscape" if self.landscape else "portrait", ' fitToWidth="1" fitToHeight="0"' if self.fit_width else ""))
        if self.header or self.footer:
            out.append("<headerFooter>%s%s</headerFooter>" % (
                "<oddHeader>%s</oddHeader>" % _x(self.header) if self.header else "",
                "<oddFooter>%s</oddFooter>" % _x(self.footer) if self.footer else ""))
        out.append("</worksheet>")
        return "".join(out)
