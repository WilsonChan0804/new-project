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
from reportlab.platypus import Table, TableStyle

PAGE_SIZE = landscape(A4)
MARGIN = 18 * mm
DIM_LANE = 16 * mm   # width reserved on the right for the floor-to-floor dimension

COLOR_FIXED = colors.HexColor("#f5e400")
COLOR_OPENABLE = colors.HexColor("#5be8c8")
COLOR_UNCONFIRMED = colors.HexColor("#cfcfcf")
COLOR_FRAME = colors.HexColor("#8a8f98")

STATUS_COLORS = {
    "OK": colors.HexColor("#bdf5c9"),
    "NOT OK": colors.HexColor("#ffc4c4"),
    "NEEDS DATA": colors.HexColor("#ffe6a3"),
    "NO WINDOW": colors.HexColor("#e2e2e2"),
}


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


RIGHT_COL = 82 * mm   # legend + room summary + per-panel table, so nothing needs hand-copying from the diagram


def _draw_page(c, d):
    w, h = PAGE_SIZE
    c.setFont("Helvetica-Bold", 13)
    title = u"%s %s   %s %s   %s" % (d.get("block", ""), d.get("flat", ""), d.get("level", ""), d.get("number", ""), d.get("name", ""))
    c.drawString(MARGIN, h - MARGIN + 2 * mm, title[:120])

    avail_w = w - 2 * MARGIN - DIM_LANE - RIGHT_COL   # right-hand room for the dimension lane + legend/summary/table
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
    colour_by_name = {"fixed": COLOR_FIXED, "openable": COLOR_OPENABLE, "unconfirmed": COLOR_UNCONFIRMED,
                     "frame": COLOR_FRAME}
    for r in d.get("rects", []):
        x0, y0 = X(r["left"]), Y(r["bottom"])
        rw, rh = r["width"] * scale, r["height"] * scale
        c.setFillColor(colour_by_name.get(r["color"], COLOR_UNCONFIRMED))
        c.setStrokeColor(colors.black)
        c.setLineWidth(0.6)
        c.rect(x0, y0, rw, rh, stroke=1, fill=1)
        # the family's own glazing-only size, when its overall structural size is bigger - the
        # margin left around this (still drawn, in "frame" colour, as the outer rect above) is
        # the frame/mullion the glass sits in, not more glazing
        grect = r.get("glaze_rect")
        label_cx, label_cy = x0 + rw / 2.0, y0 + rh / 2.0
        if grect:
            c.setFillColor(colour_by_name.get(r.get("glaze_color"), COLOR_UNCONFIRMED))
            c.setStrokeColor(colors.black)
            c.setLineWidth(0.5)
            gx2, gy2 = x0 + grect["left"] * scale, y0 + grect["bottom"] * scale
            gw2, gh2 = grect["width"] * scale, grect["height"] * scale
            c.rect(gx2, gy2, gw2, gh2, stroke=1, fill=1)
            label_cx, label_cy = gx2 + gw2 / 2.0, gy2 + gh2 / 2.0
            # the outer rect's own (structural) size moves up near its top edge, since the
            # centre now carries the glazing-only size instead
            if rw > 18 * mm and rh > 6 * mm:
                c.setFillColor(colors.black)
                c.setFont("Helvetica", 6)
                c.drawCentredString(x0 + rw / 2.0, y0 + rh - 7,
                                    u"frame %s x %s" % (int(r["width"]), int(r["height"])))
        # the family's own openable sub-size (e.g. one leaf of a two-panel unit) drawn as its own
        # rectangle onto the glazing, rather than colouring the whole panel as openable
        orect = r.get("open_rect")
        if orect:
            c.setFillColor(COLOR_OPENABLE)
            c.setStrokeColor(colors.black)
            c.setLineWidth(0.5)
            ox2, oy2 = x0 + orect["left"] * scale, y0 + orect["bottom"] * scale
            ow2, oh2 = orect["width"] * scale, orect["height"] * scale
            c.rect(ox2, oy2, ow2, oh2, stroke=1, fill=1)
            if ow2 > 12 * mm and oh2 > 5 * mm:
                c.setFillColor(colors.black)
                c.setFont("Helvetica", 6)
                c.drawCentredString(ox2 + ow2 / 2.0, oy2 + oh2 / 2.0,
                                    u"%s x %s" % (int(orect["width"]), int(orect["height"])))
        c.setFillColor(colors.black)
        label = u"%s x %s" % (int(r["width"]), int(r["height"])) if not grect else \
            u"%s x %s" % (int(grect["width"]), int(grect["height"]))
        if rw > 18 * mm and rh > 6 * mm:
            c.setFont("Helvetica", 7)
            c.drawCentredString(label_cx, label_cy, label)
        mark = r.get("mark") or r.get("key", "")
        if mark and rh > 10 * mm:
            c.setFont("Helvetica-Oblique", 6)
            c.drawCentredString(label_cx, label_cy - 8, mark[:24])

    # floor-to-floor height dimension
    _v_dimension(c, right_x + 6 * mm, floor_y, f2f_top, u"floor to floor height  %d mm" % int(d["floor_to_floor_mm"]))

    rx = w - RIGHT_COL + 2 * mm
    ry = h - MARGIN - 6 * mm
    _legend(c, rx, ry)
    ry -= 39 * mm
    ry -= _summary_box(c, rx, ry, RIGHT_COL - 6 * mm, d)
    ry -= 6 * mm
    _panel_table(c, rx, ry, d.get("rects", []))


def _summary_box(c, x, y_top, box_w, d):
    """The room's own required/provided numbers, straight from the table (the
    same figures that would otherwise have to be copied in by hand) - returns
    the box height used, so the caller can stack the panel table below it."""
    lines = []
    if d.get("area_m2") is not None:
        lines.append(u"Room area = %s m2" % _fmt(d["area_m2"]))
    lines.append(u"Required lighting = %s m2" % _fmt(d.get("req_light")))
    lines.append(u"Provided lighting = %s m2 (measured glass)" % _fmt(d.get("prov_light_meas")))
    lines.append(u"Required openable = %s m2" % _fmt(d.get("req_open")))
    lines.append(u"Provided openable = %s m2 (measured glass)" % _fmt(d.get("prov_open_meas")))
    lines.append(u"Status: %s" % d.get("status", ""))
    line_h = 4.6 * mm
    box_h = line_h * len(lines) + 5 * mm
    c.setStrokeColor(colors.HexColor("#1a3fb0"))
    c.setLineWidth(1.1)
    c.rect(x, y_top - box_h, box_w, box_h, stroke=1, fill=0)
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 7.5)
    ty = y_top - 4.5 * mm
    for ln in lines:
        c.drawString(x + 3 * mm, ty, ln)
        ty -= line_h
    return box_h


def _panel_table(c, x, y_top, rects):
    c.setFont("Helvetica-Bold", 7.5)
    c.drawString(x, y_top, u"Panels in this run")
    y = y_top - 4.5 * mm
    c.setFont("Courier", 6)
    c.drawString(x, y, u"mark      W x H mm   light(ms/nom)  open(ms/nom)")
    y -= 3.4 * mm
    for r in sorted(rects, key=lambda r: r["left"]):
        label = (r.get("mark") or r.get("key", ""))[:9]
        line = u"%-9s %4d x %-4d %5s/%-5s %5s/%-5s" % (
            label, int(r["width"]), int(r["height"]),
            _fmt(r.get("light_meas")), _fmt(r.get("light_bd")),
            _fmt(r.get("open_meas")), _fmt(r.get("open_bd")))
        c.drawString(x, y, line)
        y -= 3.2 * mm
        if y < MARGIN:
            break


def _legend(c, x, y):
    rows = [(COLOR_FIXED, u"fixed glazing", False), (COLOR_OPENABLE, u"openable glazing", False),
            (COLOR_UNCONFIRMED, u"not yet confirmed", False), (COLOR_FRAME, u"frame / mullion cover (not glazing)", False),
            (None, u"excluded from win. area cal.", True)]
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


SCHEDULE_HEADER = [u"Block", u"Flat", u"Level", u"Room", u"Name", u"Use", u"U.F.A.\nm2", u"Req.\nLight m2",
                   u"Prov.\nLight m2", u"Req.\nOpen m2", u"Prov.\nOpen m2", u"Status"]
SCHEDULE_COLS_MM = [14, 14, 12, 12, 26, 12, 16, 16, 18, 16, 18, 20]
ROWS_PER_PAGE = 34


def _schedule_pages(c, rooms):
    """The window area schedule, one row per room, grouped/sorted the same way
    as the table - a summary page up front so a reviewer never has to open the
    CSV just to see which rooms pass. Coloured by status, like the firm's own
    reference sheet highlights its own key columns."""
    if not rooms:
        return
    rooms = sorted(rooms, key=lambda r: (r.get("block", ""), r.get("level", ""), r.get("flat", ""), r.get("number", "")))
    w, h = PAGE_SIZE
    avail_w = w - 2 * MARGIN
    col_widths = [x * mm for x in SCHEDULE_COLS_MM]
    for start in range(0, len(rooms), ROWS_PER_PAGE):
        chunk = rooms[start:start + ROWS_PER_PAGE]
        c.setFont("Helvetica-Bold", 13)
        c.drawString(MARGIN, h - MARGIN + 4 * mm, u"Window area schedule" + (u" (cont'd)" if start else u""))
        data = [SCHEDULE_HEADER]
        style = [
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7.5),
            ("FONT", (0, 1), (-1, -1), "Helvetica", 7),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a3fb0")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (6, 0), (-1, -1), "CENTER"),
        ]
        for i, r in enumerate(chunk, start=1):
            data.append([
                r.get("block", ""), r.get("flat", ""), r.get("level", ""), r.get("number", ""), r.get("name", ""), r.get("use", ""),
                _fmt(r.get("area_m2")), _fmt(r.get("req_light")), _fmt(r.get("prov_light_meas")),
                _fmt(r.get("req_open")), _fmt(r.get("prov_open_meas")), r.get("status", ""),
            ])
            style.append(("BACKGROUND", (11, i), (11, i), STATUS_COLORS.get(r.get("status"), colors.white)))
            if r.get("merged_into"):
                style.append(("TEXTCOLOR", (0, i), (-1, i), colors.HexColor("#666666")))
        t = Table(data, colWidths=col_widths, repeatRows=1)
        t.setStyle(TableStyle(style))
        tw, th = t.wrapOn(c, avail_w, h - 2 * MARGIN)
        t.drawOn(c, MARGIN, h - MARGIN - th)
        c.showPage()


def build_pdf(manifest_path, out_path=None):
    with open(manifest_path, "r") as f:
        data = json.load(f)
    diagrams = data.get("diagrams", [])
    out_path = out_path or os.path.splitext(manifest_path)[0] + ".pdf"
    c = canvas.Canvas(out_path, pagesize=PAGE_SIZE)
    _schedule_pages(c, data.get("rooms", []))
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
