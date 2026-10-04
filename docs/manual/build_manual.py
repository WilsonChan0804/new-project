"""Builds the LWK Viewer user manual in English and Cantonese.

    python3 build_manual.py

Reads the content (content_en.py, content_yue.py) and the original Word
file (template.docx: its styles, numbering definitions, page set-up and the
workflow picture), and writes
    LWK_Viewer_User_Manual_EN.docx
    LWK_Viewer_User_Manual_YUE.docx
Only word/document.xml and word/numbering.xml are written anew; everything
else is the original's, so both files look like the manual they replace.
"""

import html
import importlib
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
TEMPLATE = os.path.join(HERE, "template.docx")
TABLE_W = 9360          # the text width (Letter, 1" margins), in twentieths of a point


def esc(s):
    return html.escape(s, quote=False)


def runs(text):
    """Text with **bold** parts as Word runs."""
    out = []
    for i, part in enumerate(re.split(r"\*\*", text)):
        if not part:
            continue
        rpr = "<w:rPr><w:b/></w:rPr>" if i % 2 else ""
        out.append('<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>' % (rpr, esc(part)))
    return "".join(out)


def para(text, style=None, num=None):
    ppr = ""
    if style:
        ppr += '<w:pStyle w:val="%s"/>' % style
    if num is not None:
        ppr += '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="%d"/></w:numPr>' % num
    return "<w:p><w:pPr>%s</w:pPr>%s</w:p>" % (ppr, runs(text))


def table(head, rows):
    n = len(head)
    w = TABLE_W // n
    cols = [w] * n
    cols[-1] += TABLE_W - w * n

    def cell(t, width, shade):
        sh = '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' if shade else ""
        return ('<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/>%s</w:tcPr>%s</w:tc>'
                % (width, sh, para(t)))
    x = ('<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/>'
         '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>'
         '<w:tblGrid>%s</w:tblGrid>' % "".join('<w:gridCol w:w="%d"/>' % c for c in cols))
    x += '<w:tr><w:trPr><w:tblHeader/></w:trPr>%s</w:tr>' % "".join(cell(t, cols[i], True) for i, t in enumerate(head))
    for r in rows:
        r = list(r) + [""] * (n - len(r))
        x += "<w:tr>%s</w:tr>" % "".join(cell(t, cols[i], False) for i, t in enumerate(r[:n]))
    return x + "</w:tbl>"


def build(content, out, lang):
    z = zipfile.ZipFile(TEMPLATE)
    doc = z.read("word/document.xml").decode("utf-8")
    head = doc[:doc.index("<w:body>") + len("<w:body>")]
    sect = doc[doc.rindex("<w:sectPr"):doc.index("</w:body>")]
    m = re.search(r"<w:p><w:pPr></w:pPr><w:r><w:drawing>.*?</w:drawing></w:r></w:p>", doc, re.S)
    picture = m.group(0)
    numbering = z.read("word/numbering.xml").decode("utf-8")
    abstracts = numbering[:numbering.index("<w:num ")]          # the two list kinds: 0 bullets, 1 numbers

    body, nums, n = [], [], 0
    for b in content.DOC:
        k = b[0]
        if k in ("H1", "H2", "H3"):
            body.append(para(b[1], "Heading" + k[1]))
        elif k == "P":
            body.append(para(b[1]))
        elif k == "LABEL":
            body.append(para("**" + b[1] + "**"))
        elif k in ("UL", "OL"):
            n += 1
            nums.append('<w:num w:numId="%d"><w:abstractNumId w:val="%d"/></w:num>' % (n, 1 if k == "OL" else 0))
            body.extend(para(t, "ListParagraph", n) for t in b[1])
        elif k == "TABLE":
            body.append(table(b[1], b[2]))
        elif k == "IMG":
            body.append(picture)
        elif k == "BLANK":
            body.append("<w:p><w:pPr></w:pPr></w:p>")
        else:
            raise ValueError("unknown block %r" % (k,))
    document = head + "".join(body) + sect + "</w:body></w:document>"
    numbering_out = abstracts + "".join(nums) + "</w:numbering>"

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as o:
        for item in z.infolist():
            data = z.read(item.filename)
            if item.filename == "word/document.xml":
                data = document.encode("utf-8")
            elif item.filename == "word/numbering.xml":
                data = numbering_out.encode("utf-8")
            elif item.filename == "word/styles.xml" and lang == "yue":
                s = data.decode("utf-8")
                s = s.replace('w:eastAsia="Calibri"', 'w:eastAsia="Microsoft JhengHei"', 1)
                s = s.replace('<w:lang w:val="en-US"/>', '<w:lang w:val="en-US" w:eastAsia="zh-HK"/>', 1)
                data = s.encode("utf-8")
            elif item.filename == "docProps/core.xml":
                s = data.decode("utf-8")
                title = content.TITLE
                if "<dc:title>" in s:
                    s = re.sub(r"<dc:title>.*?</dc:title>", "<dc:title>%s</dc:title>" % esc(title), s)
                data = s.encode("utf-8")
            o.writestr(item, data)
    print("wrote", out, "-", len(content.DOC), "blocks")


if __name__ == "__main__":
    for mod, name, lang in (("content_en", "LWK_Viewer_User_Manual_EN.docx", "en"),
                            ("content_yue", "LWK_Viewer_User_Manual_YUE.docx", "yue")):
        try:
            content = importlib.import_module(mod)
        except ImportError as ex:
            print("skipped", mod, ex)
            continue
        build(content, os.path.join(HERE, name), lang)
