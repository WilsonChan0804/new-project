# -*- coding: utf-8 -*-
"""Draws the schematic elevation diagrams LVReport (the pyRevit command,
lvreport.py/lvdiagram.py) wrote to lv_report_manifest.json: one page per room
x wall-run, a rectangle per sub-panel at its own real width/height/sill
height, coloured by fixed glazing / openable glazing / not yet confirmed,
dashed boxes for the inferred excluded zones (the leftover gap above and
below the real glazing - the upstand and spandrel), the floor-to-floor
height, and a legend - matching the hand-drawn reference, not a Revit view
export (there is no Revit model geometry here at all, only the numbers the
Light & Vent check already computed).

Plain Python 3, no Revit/pyRevit dependency.

Usage:
    pip install reportlab
    python3 lv_diagram_pdf.py <lv_report_manifest.json>  [-o out.pdf]
"""
from __future__ import print_function

import argparse
import json
import os

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

PAGE_SIZE = landscape(A4)
MARGIN = 18 * mm
DIM_LANE = 16 * mm   # width reserved on the right for the floor-to-floor dimension

COLOR_FIXED = colors.HexColor("#f5e400")
COLOR_OPENABLE = colors.HexColor("#5be8c8")
COLOR_UNCONFIRMED = colors.HexColor("#cfcfcf")


def _fmt(v):
    if v is None:
        return u"-"
    try:
        return u"%.3f" % float(v)
    except Exception:
        return u"%s" % v


def _scale_for(d, avail_w, avail_h):
    span_w = max(d["width_mm"], 1.0)
    span_h = max(d["floor_to_floor_mm"], 1.0)
    return min(avail_w / span_w, avail_h / span_h)


def _tick(c, x, y, size=1.5 * mm):
    c.line(x - size, y - size, x + size, y + size)


def _v_dimension(c, x, y0, y1, label):
    c.setLineWidth(0.5)
    c.line(x, y0, x, y1)
    _tick(c, x, y0)
    _tick(c, x, y1)
    c.saveState()
    c.translate(x + 3 * mm, (y0 + y1) / 2.0)
    c.rotate(90)
    c.setFont("Helvetica", 8)
    c.drawCentredString(0, 0, label)
    c.restoreState()


def _draw_page(c, d):
    w, h = PAGE_SIZE
    c.setFont("Helvetica-Bold", 13)
    title = u"%s %s   %s %s   %s" % (d.get("block", ""), d.get("flat", ""), d.get("level", ""), d.get("number", ""), d.get("name", ""))
    c.drawString(MARGIN, h - MARGIN + 2 * mm, title[:120])

    avail_w = w - 2 * MARGIN - DIM_LANE - 66 * mm   # right-hand room for the dimension lane + legend
    avail_h = h - 2 * MARGIN - 10 * mm
    scale = _scale_for(d, avail_w, avail_h)
    ox, oy = MARGIN, MARGIN

    def X(mm_val):
        return ox + mm_val * scale

    def Y(mm_val):
        return oy + mm_val * scale

    f2f_top = Y(d["floor_to_floor_mm"])
    floor_y = Y(0.0)
    right_x = X(d["width_mm"])

    # floor + floor-above witness lines, dashed, extending past the drawing
    c.setDash(3, 3)
    c.setLineWidth(0.5)
    c.line(ox - 4 * mm, floor_y, right_x + DIM_LANE, floor_y)
    c.line(ox - 4 * mm, f2f_top, right_x + DIM_LANE, f2f_top)
    c.setDash()

    # the two inferred excluded zones - dashed outline, no fill
    c.setLineWidth(0.8)
    for g in d.get("gaps", []):
        c.setDash(2, 2)
        c.rect(ox, Y(g["bottom"]), d["width_mm"] * scale, g["height"] * scale, stroke=1, fill=0)
        c.setDash()

    # each sub-panel
    colour_by_name = {"fixed": COLOR_FIXED, "openable": COLOR_OPENABLE, "unconfirmed": COLOR_UNCONFIRMED}
    for r in d.get("rects", []):
        x0, y0 = X(r["left"]), Y(r["bottom"])
        rw, rh = r["width"] * scale, r["height"] * scale
        c.setFillColor(colour_by_name.get(r["color"], COLOR_UNCONFIRMED))
        c.setStrokeColor(colors.black)
        c.setLineWidth(0.6)
        c.rect(x0, y0, rw, rh, stroke=1, fill=1)
        c.setFillColor(colors.black)
        label = u"%s x %s" % (int(r["width"]), int(r["height"]))
        if rw > 18 * mm and rh > 6 * mm:
            c.setFont("Helvetica", 7)
            c.drawCentredString(x0 + rw / 2.0, y0 + rh / 2.0, label)
        mark = r.get("mark") or r.get("key", "")
        if mark and rh > 10 * mm:
            c.setFont("Helvetica-Oblique", 6)
            c.drawCentredString(x0 + rw / 2.0, y0 + rh / 2.0 - 8, mark[:24])

    # floor-to-floor height dimension
    _v_dimension(c, right_x + 6 * mm, floor_y, f2f_top, u"floor to floor height  %d mm" % int(d["floor_to_floor_mm"]))

    _legend(c, w - 62 * mm, h - MARGIN - 6 * mm)


def _legend(c, x, y):
    rows = [(COLOR_FIXED, u"fixed glazing", False), (COLOR_OPENABLE, u"openable glazing", False),
            (COLOR_UNCONFIRMED, u"not yet confirmed", False), (None, u"excluded from win. area cal.", True)]
    c.setFont("Helvetica", 8)
    for i, (fill, label, dashed) in enumerate(rows):
        ry = y - i * 7 * mm
        c.setStrokeColor(colors.black)
        c.setLineWidth(0.6)
        if dashed:
            c.setDash(2, 2)
            c.setFillColor(colors.white)
            c.rect(x, ry, 5 * mm, 4 * mm, stroke=1, fill=1)
            c.setDash()
        else:
            c.setFillColor(fill)
            c.rect(x, ry, 5 * mm, 4 * mm, stroke=1, fill=1)
        c.setFillColor(colors.black)
        c.drawString(x + 7 * mm, ry + 0.5 * mm, label)


def build_pdf(manifest_path, out_path=None):
    with open(manifest_path, "r") as f:
        data = json.load(f)
    diagrams = data.get("diagrams", [])
    out_path = out_path or os.path.splitext(manifest_path)[0] + ".pdf"
    c = canvas.Canvas(out_path, pagesize=PAGE_SIZE)
    diagrams = sorted(diagrams, key=lambda d: (d.get("block", ""), d.get("level", ""), d.get("flat", ""), d.get("number", "")))
    for d in diagrams:
        _draw_page(c, d)
        c.showPage()
    c.save()
    return out_path, len(diagrams)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("manifest", help="lv_report_manifest.json written by the Light & Vent Diagrams Revit command")
    ap.add_argument("-o", "--out", default=None, help="output PDF path (default: alongside the manifest)")
    args = ap.parse_args()
    out_path, n = build_pdf(args.manifest, args.out)
    print(u"Wrote %s (%d diagram(s))" % (out_path, n))


if __name__ == "__main__":
    main()
