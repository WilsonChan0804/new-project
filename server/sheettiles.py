# -*- coding: utf-8 -*-
"""A sheet drawn as a pyramid of picture tiles (see app.py, "sheets as
picture tiles"). Its own module so it can run in its own process
(procjob.py): cutting a big drawing into tiles is minutes of work that
would otherwise compete with the server's answers."""

import json
import math as _math
import os
import re
import struct as _struct
import subprocess
import time
import zlib as _zlib

SHEET_TILE = 512
SHEET_TILE_MAX_PX = 110e6        # the sharpest level, in pixels (an A0 at ~250 dpi)
SHEET_TILE_MAX_DPI = 300
SHEET_TILE_VERSION = 1


def _png(w, h, rows):
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(t, d):
        c = _struct.pack(">I", len(d)) + t + d
        return c + _struct.pack(">I", _zlib.crc32(t + d) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", _struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", _zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def _tile_encoder():
    try:
        from PIL import Image  # noqa
        import io

        def enc(w, h, data):
            buf = io.BytesIO()
            Image.frombytes("RGB", (w, h), data).save(buf, "WEBP", quality=85, method=4)
            return buf.getvalue()
        return "webp", enc
    except Exception:
        return "png", None


def _page_box(src, page):
    out = subprocess.run(["pdfinfo", "-f", str(page), "-l", str(page), "-box", src],
                         capture_output=True, text=True, timeout=120).stdout
    m = re.search(r"Page\s+%d\s+CropBox:\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)" % page, out)
    if not m:
        m = re.search(r"Page\s+%d\s+MediaBox:\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)" % page, out)
    if not m:
        raise RuntimeError("pdfinfo gave no page size")
    x0, y0, x1, y1 = (float(v) for v in m.groups())
    r = re.search(r"Page\s+%d\s+rot:\s+(\d+)" % page, out)
    rot = int(r.group(1)) % 360 if r else 0
    w, h = abs(x1 - x0), abs(y1 - y0)
    if rot in (90, 270):
        w, h = h, w
    return w, h


def make_sheet_tiles(src, page, meta_path, bin_path):
    import tempfile
    t0 = time.time()
    w_pt, h_pt = _page_box(src, page)
    area_in = max(1e-6, (w_pt / 72.0) * (h_pt / 72.0))
    top = min(SHEET_TILE_MAX_DPI, _math.sqrt(SHEET_TILE_MAX_PX / area_in))
    dpis, d = [], top
    while True:
        dpis.append(d)
        if max(w_pt, h_pt) / 72.0 * d <= 1600 or len(dpis) >= 7:
            break
        d /= 2.0
    dpis.reverse()
    fmt, enc = _tile_encoder()
    T = SHEET_TILE
    levels, offset, blanks, count = [], 0, 0, 0
    with tempfile.TemporaryDirectory() as wd, open(bin_path + ".part", "wb") as out:
        for dpi in dpis:
            base = os.path.join(wd, "lv")
            subprocess.run(["pdftoppm", "-f", str(page), "-l", str(page), "-r", "%.4f" % dpi,
                            "-cropbox", "-singlefile", src, base],
                           capture_output=True, timeout=3600, check=True)
            with open(base + ".ppm", "rb") as f:
                head = []
                while len(head) < 4:
                    line = f.readline()
                    if not line:
                        raise RuntimeError("short picture from pdftoppm")
                    if line.startswith(b"#"):
                        continue
                    head += line.split()
                if head[0] != b"P6":
                    raise RuntimeError("unexpected picture from pdftoppm")
                W, H = int(head[1]), int(head[2])
                nx, ny = (W + T - 1) // T, (H + T - 1) // T
                idx = []
                for ty in range(ny):
                    rn = min(T, H - ty * T)
                    strip = f.read(rn * W * 3)
                    for tx in range(nx):
                        cw = min(T, W - tx * T)
                        a = tx * T * 3
                        rows = [strip[r * W * 3 + a: r * W * 3 + a + cw * 3] for r in range(rn)]
                        tile = b"".join(rows)
                        if not tile.strip(b"\xff"):
                            idx.append(0)            # all white: nothing to fetch
                            blanks += 1
                            continue
                        data = enc(cw, rn, tile) if enc else _png(cw, rn, rows)
                        out.write(data)
                        idx.append([offset, len(data)])
                        offset += len(data)
                        count += 1
            os.remove(base + ".ppm")
            levels.append({"dpi": round(dpi, 4), "px": [W, H], "nx": nx, "ny": ny, "tiles": idx})
    os.replace(bin_path + ".part", bin_path)
    meta = {"v": SHEET_TILE_VERSION, "w": w_pt, "h": h_pt, "tile": T, "fmt": fmt,
            "bin": os.path.basename(bin_path), "bytes": offset, "pdf_bytes": os.path.getsize(src),
            "levels": levels, "made_s": round(time.time() - t0, 1)}
    with open(meta_path + ".part", "w", encoding="utf-8") as fm:
        json.dump(meta, fm, separators=(",", ":"))
    os.replace(meta_path + ".part", meta_path)
    # the pictures of earlier versions of this sheet go
    stem = os.path.basename(meta_path).rsplit(".", 4)[0]
    d = os.path.dirname(meta_path)
    for old in os.listdir(d):
        if old.startswith(stem + ".") and ".stiles." in old and old not in (os.path.basename(meta_path), os.path.basename(bin_path)):
            try:
                os.remove(os.path.join(d, old))
            except OSError:
                pass
    return count, blanks, offset, time.time() - t0
