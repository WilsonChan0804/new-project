"""The user manual as the viewer's Help pages (viewer/help/, shown with docsify).

    python3 build_markdown.py          (build_manual.py runs it too)

Reads the same content as the Word manuals (content_en.py, content_yue.py)
and writes, for each language, one Markdown page per chapter (H2) plus a
sidebar:
    viewer/help/en/README.md, en/<chapter>.md, en/_sidebar.md
    viewer/help/yue/...
    viewer/help/img/workflow.png       (the picture of the original manual)
A chapter's page has the same name in both languages - taken from the
English title, e.g. "folders" - so a link from the viewer works in either.
"""

import importlib
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "viewer", "help"))
TEMPLATE = os.path.join(HERE, "template.docx")


def slug(title):
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return s or "chapter"


def inline(text):
    """Source text (with **bold**) as Markdown: the bold kept, anything
    Markdown or HTML would read as markup left as it is."""
    parts = re.split(r"(\*\*|`[^`]*`)", text)
    out = []
    bold = False
    for p in parts:
        if p == "**":
            # as HTML: Markdown does not close a bold that ends in punctuation
            # right before a Chinese character ("**Move to ...**、")
            out.append("</strong>" if bold else "<strong>")
            bold = not bold
            continue
        if p.startswith("`") and p.endswith("`") and len(p) > 1:
            out.append(p)          # code as it is
            continue
        p = p.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        p = p.replace("*", "\\*")
        out.append(p)
    if bold:
        out.append("</strong>")
    return "".join(out)


def cell(text):
    return inline(text).replace("|", "\\|").replace("\n", "<br>")


def blocks_md(blocks):
    out = []
    for b in blocks:
        k = b[0]
        if k == "H3":
            out.append("### " + inline(b[1]))
        elif k == "P":
            out.append(inline(b[1]))
        elif k == "LABEL":
            out.append("<strong>" + inline(b[1]) + "</strong>")
        elif k == "UL":
            out.append("\n".join("- " + inline(t) for t in b[1]))
        elif k == "OL":
            out.append("\n".join("%d. %s" % (i + 1, inline(t)) for i, t in enumerate(b[1])))
        elif k == "TABLE":
            head, rows = b[1], b[2]
            n = len(head)
            lines = ["| " + " | ".join(cell(h) for h in head) + " |", "|" + "---|" * n]
            for r in rows:
                r = list(r) + [""] * (n - len(r))
                lines.append("| " + " | ".join(cell(t) for t in r[:n]) + " |")
            out.append("\n".join(lines))
        elif k == "IMG":
            out.append("![How it fits together](../img/workflow.png)")
        elif k in ("BLANK", "H1"):
            continue
        else:
            raise ValueError("unknown block %r" % (k,))
    return "\n\n".join(out) + "\n"


def chapters(doc):
    """[(title, blocks)] - what comes before the first chapter is the home page."""
    out = [("", [])]
    for b in doc:
        if b[0] == "H2":
            out.append((b[1], []))
        else:
            out[-1][1].append(b)
    return out


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def build():
    en = importlib.import_module("content_en")
    yue = importlib.import_module("content_yue")
    names = [slug(t) for t, _ in chapters(en.DOC)[1:]]
    labels = {"en": ("Home", "Chapters"), "yue": ("首頁", "章節")}
    for lang, content in (("en", en), ("yue", yue)):
        chs = chapters(content.DOC)
        if len(chs) - 1 != len(names):
            raise ValueError("%s has %d chapters, English %d" % (lang, len(chs) - 1, len(names)))
        home, chs = chs[0], chs[1:]
        toc = "\n".join("- [%s](%s/%s)" % (inline(t), lang, names[i]) for i, (t, _) in enumerate(chs))
        write(os.path.join(OUT, lang, "README.md"),
              "# %s\n\n%s\n## %s\n\n%s\n" % (inline(content.TITLE), blocks_md(home[1]), labels[lang][1], toc))
        for i, (t, bl) in enumerate(chs):
            write(os.path.join(OUT, lang, names[i] + ".md"), "# %s\n\n%s" % (inline(t), blocks_md(bl)))
        write(os.path.join(OUT, lang, "_sidebar.md"),
              "- [%s](%s/)\n" % (labels[lang][0], lang)
              + "\n".join("- [%s](%s/%s)" % (inline(t), lang, names[i]) for i, (t, _) in enumerate(chs)) + "\n")
    # the workflow picture of the original manual
    with zipfile.ZipFile(TEMPLATE) as z:
        write_bytes(os.path.join(OUT, "img", "workflow.png"), z.read("word/media/image1.png"))
    print("wrote", OUT, "-", len(names), "chapters in English and Cantonese")


def write_bytes(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


if __name__ == "__main__":
    build()
