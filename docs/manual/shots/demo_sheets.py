"""Made-up A3 sheets for the manual's pictures (no real project).

    python3 demo_sheets.py OUT

writes OUT/sheets/*.pdf and OUT/manifest.json in the add-in's export
layout, so seed.py can take OUT as its SHEETS_PROJECT. The drawings are
a plain residential floor: grids, walls, flats, a lift and stair core,
doors, dimensions and a title block - enough to look like a sheet.
"""
import json
import os
import sys

from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

W, H = 420, 297                     # A3 landscape, mm
VP = (24, 40, 300, 236)             # the viewport on the paper: x0, y0, x1, y1 (mm, from the bottom left)
SCALE = 100
BX, BY = 34, 60                     # the building's bottom left on the paper (mm)
GX = [0, 60, 120, 180, 240]         # grid lines along x, mm on paper (6 m bays at 1:100)
GY = [0, 70, 140]                   # grid lines along y
GRID_X = "ABCDE"
GRID_Y = "123"

SHEETS = [
    ("A-101", "Ground floor plan", "plan", "G/F"),
    ("A-102", "Typical floor plan", "plan", "5/F - 37/F"),
    ("A-103", "Roof plan", "roof", "R/F"),
    ("A-201", "North elevation", "elev", ""),
    ("A-301", "Section A-A", "section", ""),
]


def P(x, y):
    return x * mm, y * mm


def line(c, x0, y0, x1, y1, w=0.25, dash=None):
    c.setLineWidth(w)
    c.setDash(*(dash or ([], 0)))
    c.line(*P(x0, y0), *P(x1, y1))
    c.setDash([], 0)


def rect(c, x, y, w, h, lw=0.25, fill=None):
    c.setLineWidth(lw)
    if fill:
        c.setFillGray(fill)
    c.rect(x * mm, y * mm, w * mm, h * mm, stroke=1, fill=1 if fill else 0)
    c.setFillGray(0)


def text(c, x, y, s, size=2.5, font="Helvetica", anchor="l"):
    c.setFont(font, size * 2.835)                  # size in mm
    if anchor == "c":
        c.drawCentredString(x * mm, y * mm, s)
    elif anchor == "r":
        c.drawRightString(x * mm, y * mm, s)
    else:
        c.drawString(x * mm, y * mm, s)


def frame(c, num, name, scale_txt):
    rect(c, 10, 10, W - 20, H - 20, 0.7)
    # title block down the right
    tx = 320
    line(c, tx, 10, tx, H - 10, 0.5)
    text(c, tx + 6, H - 24, "LWK + PARTNERS", 4.2, "Helvetica-Bold")
    text(c, tx + 6, H - 31, "Architecture  Interiors  Planning", 2.2)
    for y in (H - 40, 120, 92, 70, 48, 30):
        line(c, tx, y, W - 10, y, 0.35)
    text(c, tx + 6, H - 48, "PROJECT", 1.8, "Helvetica-Bold")
    text(c, tx + 6, H - 56, "Kai Tak Demo Tower", 3.2, "Helvetica-Bold")
    text(c, tx + 6, H - 63, "Residential development, Kai Tak", 2.2)
    text(c, tx + 6, 112, "DRAWING TITLE", 1.8, "Helvetica-Bold")
    text(c, tx + 6, 102, name.upper(), 3.0, "Helvetica-Bold")
    text(c, tx + 6, 84, "SCALE", 1.8, "Helvetica-Bold")
    text(c, tx + 6, 76, scale_txt + " @ A3", 2.6)
    text(c, tx + 50, 84, "DATE", 1.8, "Helvetica-Bold")
    text(c, tx + 50, 76, "Oct 2026", 2.6)
    text(c, tx + 6, 62, "DRAWING NO.", 1.8, "Helvetica-Bold")
    text(c, tx + 6, 52, "KTD-LWK-ZZ-" + num, 3.4, "Helvetica-Bold")
    text(c, tx + 6, 40, "REV", 1.8, "Helvetica-Bold")
    text(c, tx + 6, 33, "C02  -  For coordination", 2.4)
    text(c, tx + 6, 20, "Demo drawing for the user manual - not a real project.", 1.7)


def grids(c):
    top, right = BY + GY[-1], BX + GX[-1]
    for i, g in enumerate(GX):
        line(c, BX + g, BY - 14, BX + g, top + 14, 0.18, ([4, 1, 1, 1], 0))
        c.circle((BX + g) * mm, (top + 19) * mm, 4 * mm)
        text(c, BX + g, top + 18, GRID_X[i], 3, "Helvetica-Bold", "c")
    for i, g in enumerate(GY):
        line(c, BX - 14, BY + g, right + 14, BY + g, 0.18, ([4, 1, 1, 1], 0))
        c.circle((BX - 19) * mm, (BY + g) * mm, 4 * mm)
        text(c, BX - 19, BY + g - 1, GRID_Y[i], 3, "Helvetica-Bold", "c")


def door(c, x, y, w=9, up=True):
    """A door leaf and its swing in a horizontal wall at (x, y)."""
    s = 1 if up else -1
    line(c, x, y, x, y + s * w, 0.3)
    c.setLineWidth(0.18)
    c.arc((x - w) * mm, (y - w) * mm, (x + w) * mm, (y + w) * mm, 0 if up else 270, 90)


def plan(c, ground):
    grids(c)
    x0, y0, x1, y1 = BX, BY, BX + GX[-1], BY + GY[-1]
    # outer walls (thick) and the corridor
    for (a, b, cc, d) in [(x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)]:
        line(c, a, b, cc, d, 1.1)
    cy0, cy1 = y0 + 62, y0 + 78
    line(c, x0, cy0, x1, cy0, 0.7)
    line(c, x0, cy1, x1, cy1, 0.7)
    # the core: lifts and a stair in the middle bay
    cx0, cx1 = x0 + 100, x0 + 140
    rect(c, cx0, cy1, 40, 40, 0.7)
    for i in range(3):
        rect(c, cx0 + 3 + i * 12, cy1 + 26, 10, 11, 0.4)
        line(c, cx0 + 3 + i * 12, cy1 + 26, cx0 + 13 + i * 12, cy1 + 37, 0.15)
        line(c, cx0 + 13 + i * 12, cy1 + 26, cx0 + 3 + i * 12, cy1 + 37, 0.15)
    text(c, cx0 + 20, cy1 + 20, "LIFT LOBBY", 2.0, "Helvetica", "c")
    sx = cx0 + 4
    for i in range(12):
        line(c, sx + i * 2.6, cy1 + 3, sx + i * 2.6, cy1 + 14, 0.15)
    text(c, cx0 + 20, cy1 + 16, "STAIR", 1.8, "Helvetica", "c")
    # flats either side of the corridor
    rooms = ["LIVING / DINING", "BEDROOM 1", "BEDROOM 2", "KITCHEN", "BATH"]
    for k, (fx, fy, fh, up) in enumerate([(x0, y0, 62, True), (x0 + 120, y0, 62, True),
                                         (x0, cy1, 62, False), (x0 + 140, cy1, 62, False)]):
        fw = 100 if k in (2,) else (100 if k == 3 else 120)
        if k == 2:
            fw = 100
        if k == 3:
            fx, fw = x0 + 140, 100
        rect(c, fx, fy, fw, fh, 0.5)
        line(c, fx + fw * 0.55, fy, fx + fw * 0.55, fy + fh, 0.5)
        line(c, fx + fw * 0.55, fy + fh * 0.5, fx + fw, fy + fh * 0.5, 0.5)
        line(c, fx + fw * 0.30, fy + (fh - 20 if up else 0), fx + fw * 0.30, fy + (fh if up else 20), 0.5)
        tag = "FLAT %s" % "ABCD"[k]
        text(c, fx + fw * 0.27, fy + fh * 0.45, rooms[0], 2.0, "Helvetica", "c")
        text(c, fx + fw * 0.27, fy + fh * 0.45 - 4, tag + "  -  %d m²" % (52 + k * 3), 1.7, "Helvetica", "c")
        text(c, fx + fw * 0.78, fy + fh * 0.75, rooms[1], 1.9, "Helvetica", "c")
        text(c, fx + fw * 0.78, fy + fh * 0.25, rooms[2], 1.9, "Helvetica", "c")
        text(c, fx + fw * 0.15, fy + (fh - 10 if up else 10), rooms[3], 1.7, "Helvetica", "c")
        door(c, fx + fw * 0.40, fy + (fh if up else 0), 8, not up)
        door(c, fx + fw * 0.62, fy + fh * 0.5, 6, True)
        # windows on the outer face
        wy = fy if up else fy + fh
        for wx in (0.12, 0.42, 0.68, 0.88):
            rect(c, fx + fw * wx - 6, wy - 1, 12, 2, 0.3, fill=1)
    text(c, x0 + 60, cy0 + 6.5, "CORRIDOR", 2.0, "Helvetica", "c")
    text(c, x0 + 180, cy0 + 6.5, "CORRIDOR", 2.0, "Helvetica", "c")
    if ground:
        rect(c, x0 + 104, y0 - 1.5, 32, 3, 0.4, fill=1)
        text(c, x0 + 120, y0 - 9, "MAIN ENTRANCE", 2.2, "Helvetica-Bold", "c")
    # an overall dimension string
    dy = y0 - 22
    line(c, x0, dy, x1, dy, 0.2)
    for g in GX:
        line(c, x0 + g - 1.5, dy - 1.5, x0 + g + 1.5, dy + 1.5, 0.3)
        line(c, x0 + g, dy - 3, x0 + g, dy + 3, 0.15)
    for a, b in zip(GX, GX[1:]):
        text(c, x0 + (a + b) / 2, dy + 1.5, "6000", 1.9, "Helvetica", "c")


def roof(c):
    grids(c)
    x0, y0, x1, y1 = BX, BY, BX + GX[-1], BY + GY[-1]
    rect(c, x0, y0, x1 - x0, y1 - y0, 1.1)
    rect(c, x0 + 100, y0 + 78, 40, 40, 0.7, fill=0.92)
    text(c, x0 + 120, y0 + 96, "LIFT MOTOR ROOM", 2.0, "Helvetica", "c")
    for i, (px, py) in enumerate([(x0 + 30, y0 + 30), (x0 + 200, y0 + 30), (x0 + 30, y0 + 110)]):
        rect(c, px, py, 22, 14, 0.4)
        text(c, px + 11, py + 5.5, "AHU-%d" % (i + 1), 1.8, "Helvetica", "c")
    for t in range(0, 240, 20):
        line(c, x0 + t, y0 + 70, x0 + t + 10, y0 + 66, 0.15)
    text(c, x0 + 180, y0 + 110, "FALL 1:100  →", 2.0)


def elevation(c):
    x0, y0 = BX, 46
    fl = 6.2
    line(c, x0 - 10, y0, x0 + 250, y0, 0.9)
    for i in range(30):
        y = y0 + 6 + i * fl
        if y > 230:
            break
        line(c, x0, y, x0 + 240, y, 0.12)
        for b in range(8):
            rect(c, x0 + 6 + b * 29.5, y + 1.2, 18, 3.6, 0.25)
        if i % 5 == 0:
            text(c, x0 + 246, y + 1, "%d/F" % (i + 1), 1.8)
    rect(c, x0, y0, 240, 230 - y0, 0.9)
    text(c, x0 + 120, y0 - 8, "GROUND", 2.0, "Helvetica", "c")


def section(c):
    x0, y0 = BX + 30, 46
    line(c, x0 - 40, y0, x0 + 220, y0, 0.9)
    for i in range(28):
        y = y0 + 6 + i * 6.2
        if y > 228:
            break
        rect(c, x0, y - 0.6, 180, 1.2, 0.2, fill=0.35)
        text(c, x0 + 186, y - 0.8, "+%.2f" % (i * 3.15 + 0.15), 1.6)
    for g in (0, 60, 120, 180):
        line(c, x0 + g, y0, x0 + g, 228, 0.6)
    rect(c, x0 + 60, y0, 60, 182, 0.5)
    text(c, x0 + 90, y0 - 8, "CORE", 2.0, "Helvetica", "c")


def main(out):
    os.makedirs(os.path.join(out, "sheets"), exist_ok=True)
    sheets = []
    for i, (num, name, kind, lvl) in enumerate(SHEETS):
        f = os.path.join(out, "sheets", num + ".pdf")
        c = canvas.Canvas(f, pagesize=(W * mm, H * mm))
        c.setTitle(num + " " + name)
        scale_txt = "1:%d" % SCALE if kind != "elev" else "1:200"
        frame(c, num, name, scale_txt)
        {"plan": lambda: plan(c, num == "A-101"), "roof": lambda: roof(c), "elev": lambda: elevation(c),
         "section": lambda: section(c)}[kind]()
        text(c, VP[0], 22, "%s %s   %s" % (name.upper(), ("(" + lvl + ")") if lvl else "", "SCALE " + scale_txt), 2.6, "Helvetica-Bold")
        c.showPage()
        c.save()
        vp = {"element_id": 9000 + i, "view_id": 100 + i, "view_name": name, "scale": SCALE if kind != "elev" else 200,
              "view_type": {"plan": "FloorPlan", "roof": "FloorPlan", "elev": "Elevation", "section": "Section"}[kind],
              "mappable": kind in ("plan", "roof"), "paper_rect_mm": [VP[0], H - VP[3], VP[2], H - VP[1]]}
        if kind in ("plan", "roof"):
            vp["paper_to_model"] = {"origin": [-BX * SCALE, (297 - BY) * SCALE, 3150 * (i * 4)], "x_axis": [SCALE, 0, 0],
                                    "y_axis": [0, -SCALE, 0], "normal": [0, 0, 1]}
        sheets.append({"element_id": 1 + i, "unique_id": "demo-" + num.lower(), "number": num, "name": name,
                       "pdf": "sheets/%s.pdf" % num, "paper": {"width_mm": W, "height_mm": H},
                       "exported_at": "2026-10-20T08:00:00Z", "viewports": [vp]})
    json.dump({"source": {"title": "Kai Tak Demo Tower"}, "sheets": sheets, "models": []},
              open(os.path.join(out, "manifest.json"), "w"), indent=1)
    print("wrote %d sheets to %s" % (len(sheets), out))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
