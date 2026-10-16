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
import struct
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


# ---------------------------------------------------------------- the pictures
# SHOT blocks: docs/manual/img/<id>.jpg, made by shots/shoot.mjs, with the
# numbered legend from shots/spec.py.
IMG_DIR = os.path.join(HERE, "img")
TEXT_W, MAX_H = 5943600, 7315200          # EMU: the text width (6.5"), at most 8" high
sys.path.insert(0, os.path.join(HERE, "shots"))
import spec as SHOTS                       # noqa: E402


def jpeg_size(path):
    """(width, height) in pixels from the JPEG's frame header."""
    with open(path, "rb") as f:
        d = f.read()
    i = 2
    while i < len(d):
        if d[i] != 0xFF:
            i += 1
            continue
        mk = d[i + 1]
        if mk in (0xC0, 0xC1, 0xC2):
            return struct.unpack(">H", d[i + 7:i + 9])[0], struct.unpack(">H", d[i + 5:i + 7])[0]
        i += 2 + struct.unpack(">H", d[i + 2:i + 4])[0]
    raise ValueError("no JPEG size in " + path)


def shot_xml(picture, sid, rid, pid, lang):
    w, h = jpeg_size(os.path.join(IMG_DIR, sid + ".jpg"))
    cx = min(TEXT_W, w * 9525)             # 96 dpi, no larger than the page
    cy = cx * h // w
    if cy > MAX_H:
        cy, cx = MAX_H, MAX_H * w // h
    descr = esc(sid)
    x = picture.replace('r:embed="rId3"', 'r:embed="%s"' % rid)
    x = re.sub(r'cx="\d+" cy="\d+"', 'cx="%d" cy="%d"' % (cx, cy), x)
    x = re.sub(r'<wp:docPr id="\d+" name="[^"]*" descr="[^"]*"/>', '<wp:docPr id="%d" name="shot%d" descr="%s"/>' % (pid, pid, descr), x)
    x = re.sub(r'<pic:cNvPr id="\d+" name="[^"]*" descr="[^"]*"/>', '<pic:cNvPr id="%d" name="shot%d" descr="%s"/>' % (pid, pid, descr), x)
    return x.replace("<w:pPr></w:pPr>", '<w:pPr><w:keepNext/><w:spacing w:before="120" w:after="60"/></w:pPr>', 1)


def num_xml(n, numbered):
    """A list instance; numbered lists start again at 1 (Word and LibreOffice
    otherwise carry the count on from the last list of the same kind)."""
    if not numbered:
        return '<w:num w:numId="%d"><w:abstractNumId w:val="0"/></w:num>' % n
    return ('<w:num w:numId="%d"><w:abstractNumId w:val="1"/>'
            '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>' % n)


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
    media = []                                                 # (rId, file id)
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
            nums.append(num_xml(n, k == "OL"))
            body.extend(para(t, "ListParagraph", n) for t in b[1])
        elif k == "TABLE":
            body.append(table(b[1], b[2]))
        elif k == "IMG":
            body.append(picture)
        elif k == "SHOT":
            rid = "rIdShot%d" % (len(media) + 1)
            media.append((rid, b[1]))
            body.append(shot_xml(picture, b[1], rid, 100 + len(media), lang))
            n += 1
            nums.append(num_xml(n, True))
            body.extend(para(t, "ListParagraph", n) for _, t in SHOTS.legend(b[1], lang))
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
            elif item.filename == "word/_rels/document.xml.rels":
                rels = "".join('<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
                               'Target="media/shot-%s.jpg"/>' % (rid, sid) for rid, sid in media)
                data = data.decode("utf-8").replace("</Relationships>", rels + "</Relationships>").encode("utf-8")
            elif item.filename == "[Content_Types].xml":
                t = data.decode("utf-8")
                if 'Extension="jpg"' not in t:
                    t = t.replace('<Default Extension="png"', '<Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png"', 1)
                data = t.encode("utf-8")
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
        for sid in sorted({sid for _, sid in media}):
            o.write(os.path.join(IMG_DIR, sid + ".jpg"), "word/media/shot-%s.jpg" % sid)
    print("wrote", out, "-", len(content.DOC), "blocks")


# ---------------------------------------------------------------- the Help
# The same content becomes the viewer's Help (viewer/help-content.js): one
# section per H2 / H3, searchable. Built with the manual, so every update of
# the manual updates the Help; tests check the file is not stale.
HELP_JS = os.path.join(HERE, "..", "..", "viewer", "help-content.js")


def _inline(t):
    t = html.escape(t, quote=False)
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    return re.sub(r"(?<![\w*])\*([^*\n]+?)\*(?![\w*])", r"<i>\1</i>", t)


def help_sections(content, lang="en"):
    """[{id, ch, h, html}]: id s1, s2 ... in heading order (the same in
    every language), ch the chapter (H2), h the section's own heading."""
    out, cur, ch, n = [], None, "", 0
    for b in content.DOC:
        k = b[0]
        if k in ("H2", "H3"):
            n += 1
            if k == "H2":
                ch = b[1]
            cur = {"id": "s%d" % n, "ch": ch, "h": b[1], "lv": 2 if k == "H2" else 3, "html": ""}
            out.append(cur)
            continue
        if cur is None:
            continue
        if k == "P":
            cur["html"] += "<p>%s</p>" % _inline(b[1])
        elif k == "LABEL":
            cur["html"] += "<p><b>%s</b></p>" % _inline(b[1])
        elif k in ("UL", "OL"):
            tag = "ul" if k == "UL" else "ol"
            cur["html"] += "<%s>%s</%s>" % (tag, "".join("<li>%s</li>" % _inline(i) for i in b[1]), tag)
        elif k == "SHOT":
            cur["html"] += ('<figure class="shot"><img src="help-img/%s.jpg" alt="" loading="lazy"><ol>%s</ol></figure>'
                            % (b[1], "".join("<li>%s</li>" % _inline(t) for _, t in SHOTS.legend(b[1], lang))))
        elif k == "TABLE":
            cur["html"] += "<table><tr>%s</tr>%s</table>" % ("".join("<th>%s</th>" % _inline(h) for h in b[1]),
                                                            "".join("<tr>%s</tr>" % "".join("<td>%s</td>" % _inline(c) for c in r) for r in b[2]))
    return out


def help_js():
    import json
    data = {}
    for mod, lang in (("content_en", "en"), ("content_yue", "yue")):
        data[lang] = help_sections(importlib.import_module(mod), lang)
    return ("// Generated by docs/manual/build_manual.py from the manual - do not edit.\n"
            "export const HELP = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")


if __name__ == "__main__":
    for mod, name, lang in (("content_en", "LWK_Viewer_User_Manual_EN.docx", "en"),
                            ("content_yue", "LWK_Viewer_User_Manual_YUE.docx", "yue")):
        try:
            content = importlib.import_module(mod)
        except ImportError as ex:
            print("skipped", mod, ex)
            continue
        build(content, os.path.join(HERE, name), lang)
    with open(HELP_JS, "w", encoding="utf-8") as f:
        f.write(help_js())
    print("wrote", os.path.normpath(HELP_JS))
