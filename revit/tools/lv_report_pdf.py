# -*- coding: utf-8 -*-
"""Stage 2 of the Light & Vent elevation report: turns the manifest + images
that LVReport (the Revit-side pyRevit command, lvreport.py) exported into one
PDF, one page per element - its elevation image, and beside it the same
numbers already in the Light & Vent table (nominal, measured, GBP dimensions
if the family provided them, which room(s) it serves and its share there, and
that room's status). The PDF never derives a number on its own: everything on
the page is read straight from the manifest, so it can never disagree with
the CSV/JSON the main check produces.

Plain Python 3, no Revit/pyRevit dependency - runs standalone, in Revit's own
host machine or anywhere else the exported folder is copied to.

Usage:
    pip install reportlab
    python3 lv_report_pdf.py <folder with lv_report_manifest.json and the images>  [-o out.pdf]
"""
from __future__ import print_function

import argparse
import json
import os

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

PAGE_SIZE = landscape(A4)
MARGIN = 12 * mm


def _fmt(v, suffix=u""):
    if v is None:
        return u"-"
    try:
        return u"%.3f%s" % (float(v), suffix)
    except Exception:
        return u"%s%s" % (v, suffix)


def _sort_key(entry):
    r = (entry.get("rooms") or [{}])[0]
    return (r.get("block", ""), r.get("level", ""), r.get("flat", ""), r.get("number", ""))


def _draw_page(c, entry, img_dir):
    w, h = PAGE_SIZE
    c.setFont("Helvetica-Bold", 14)
    title = u"%s   %s" % (entry.get("key", ""), (u"mark " + entry["mark"]) if entry.get("mark") else u"")
    c.drawString(MARGIN, h - MARGIN - 4 * mm, title[:120])
    c.setFont("Helvetica", 9)
    c.drawString(MARGIN, h - MARGIN - 9 * mm, u"id %s   uid %s   %s" % (entry.get("id", ""), entry.get("uid", ""), entry.get("source", "")))

    img_w = w * 0.56
    img_area = (MARGIN, MARGIN, img_w, h - 2 * MARGIN - 12 * mm)
    img_name = entry.get("image")
    img_path = os.path.join(img_dir, img_name) if img_name else None
    if img_path and os.path.isfile(img_path):
        try:
            ir = ImageReader(img_path)
            iw, ih = ir.getSize()
            scale = min(img_area[2] / float(iw), img_area[3] / float(ih))
            dw, dh = iw * scale, ih * scale
            x = img_area[0] + (img_area[2] - dw) / 2.0
            y = img_area[1] + (img_area[3] - dh) / 2.0
            c.drawImage(ir, x, y, width=dw, height=dh, preserveAspectRatio=True)
        except Exception as ex:
            c.setFillColor(colors.red)
            c.drawString(img_area[0], img_area[1] + img_area[3] / 2.0, u"(could not load image: %s)" % ex)
            c.setFillColor(colors.black)
    else:
        c.setStrokeColor(colors.grey)
        c.rect(*img_area)
        c.setFillColor(colors.grey)
        c.drawCentredString(img_area[0] + img_area[2] / 2.0, img_area[1] + img_area[3] / 2.0, u"(no image)")
        c.setFillColor(colors.black)

    x0 = MARGIN + img_w + 10 * mm
    y = h - MARGIN - 18 * mm
    line_h = 5.2 * mm

    c.setFont("Helvetica-Bold", 11)
    c.drawString(x0, y, u"Overall size")
    y -= line_h
    c.setFont("Helvetica", 10)
    c.drawString(x0, y, u"%s x %s mm" % (entry.get("w_mm") or u"-", entry.get("h_mm") or u"-"))
    y -= line_h * 1.4

    if entry.get("glaze_m2_exact") is not None or entry.get("open_m2_exact") is not None:
        c.setFont("Helvetica-Bold", 11)
        c.drawString(x0, y, u"Family's own GBP_Glazing_*/GBP_Openable_* dimensions")
        y -= line_h
        c.setFont("Helvetica", 10)
        c.drawString(x0, y, u"glazing %s m2   openable %s m2" % (_fmt(entry.get("glaze_m2_exact")), _fmt(entry.get("open_m2_exact"))))
        y -= line_h * 1.4

    c.setFont("Helvetica-Bold", 11)
    c.drawString(x0, y, u"Room(s) this element serves")
    y -= line_h
    c.setFont("Helvetica", 9)
    for r in entry.get("rooms", []):
        share = r.get("share")
        share_txt = (u" (%d%% share)" % round(share * 100)) if share is not None and share < 0.999 else u""
        c.drawString(x0, y, u"%s %s  %s  %s%s" % (r.get("block", ""), r.get("flat", ""), r.get("number", ""), r.get("name", ""), share_txt))
        y -= line_h
        c.setFillColor(colors.HexColor("#444444"))
        c.drawString(x0 + 4 * mm, y,
                     u"light: measured %s m2 / nominal %s m2    open: measured %s m2 / nominal %s m2    status %s" % (
                         _fmt(r.get("light_meas")), _fmt(r.get("light_bd")), _fmt(r.get("open_meas")), _fmt(r.get("open_bd")),
                         r.get("status", "")))
        c.setFillColor(colors.black)
        y -= line_h * 1.3
        if y < MARGIN:
            break


def build_pdf(folder, out_path=None, manifest_name="lv_report_manifest.json"):
    manifest_path = os.path.join(folder, manifest_name)
    with open(manifest_path, "r") as f:
        data = json.load(f)
    entries = sorted(data.get("elements", []), key=_sort_key)
    out_path = out_path or os.path.join(folder, "light_and_ventilation_report.pdf")
    c = canvas.Canvas(out_path, pagesize=PAGE_SIZE)
    for entry in entries:
        _draw_page(c, entry, folder)
        c.showPage()
    c.save()
    return out_path, len(entries)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("folder", help="folder holding lv_report_manifest.json and the exported images")
    ap.add_argument("-o", "--out", default=None, help="output PDF path (default: <folder>/light_and_ventilation_report.pdf)")
    args = ap.parse_args()
    out_path, n = build_pdf(args.folder, args.out)
    print(u"Wrote %s (%d element(s))" % (out_path, n))


if __name__ == "__main__":
    main()
