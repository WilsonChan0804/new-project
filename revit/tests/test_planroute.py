# -*- coding: utf-8 -*-
"""The plan cut for the Route tool, without Revit:
    python3 -m unittest discover -s revit/tests -v
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "LWK.extension", "lib"))
from lwk_viewer import planroute as PR  # noqa: E402


def box(x0, y0, x1, y1, z0, z1):
    """The 12 triangles of a box."""
    v = [(x, y, z) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
    q = [(0, 1, 3, 2), (4, 5, 7, 6), (0, 1, 5, 4), (2, 3, 7, 6), (0, 2, 6, 4), (1, 3, 7, 5)]
    out = []
    for a, b, c, d in q:
        out.append((v[a], v[b], v[c]))
        out.append((v[a], v[c], v[d]))
    return out


def segs(flat):
    return [tuple(flat[i:i + 4]) for i in range(0, len(flat), 4)]


class Slice(unittest.TestCase):

    def test_crossing_triangle(self):
        s = PR.slice_triangle((0, 0, 0), (10, 0, 10), (0, 10, 10), 5)
        self.assertIsNotNone(s)
        (a, b) = sorted(s)
        self.assertAlmostEqual(a[0], 0); self.assertAlmostEqual(a[1], 5)
        self.assertAlmostEqual(b[0], 5); self.assertAlmostEqual(b[1], 0)

    def test_missed_and_flat(self):
        self.assertIsNone(PR.slice_triangle((0, 0, 0), (1, 0, 0), (0, 1, 1), 5))
        self.assertIsNone(PR.slice_triangle((0, 0, 5), (1, 0, 5), (0, 1, 5), 5))   # lies in the plane
        self.assertIsNone(PR.slice_triangle((0, 0, 5), (1, 0, 0), (0, 1, 0), 5))   # touches a corner

    def test_edge_on_plane(self):
        s = PR.slice_triangle((0, 0, 5), (4, 0, 5), (0, 1, 0), 5)
        self.assertEqual(sorted(s), [(0, 0), (4, 0)])

    def test_box_cut_is_its_outline(self):
        # a wall 4000 x 200, 3000 high, cut at 1200: its outline, 4 sides
        flat = PR.slice_triangles(box(0, 0, 4000, 200, 0, 3000), 1200)
        total = sum(abs(a - c) + abs(b - d) for a, b, c, d in segs(flat))
        self.assertAlmostEqual(total, 2 * (4000 + 200), places=3)

    def test_wall_with_door_opening_leaves_a_gap(self):
        # two wall pieces with a 900 opening between them (as a wall solid with a door cut)
        tris = box(0, 0, 1500, 200, 0, 3000) + box(2400, 0, 4000, 200, 0, 3000)
        xs = [x for s in segs(PR.slice_triangles(tris, 1200)) for x in (s[0], s[2])]
        self.assertFalse(any(1500 < x < 2400 for x in xs))

    def test_mapping_and_rect(self):
        # model mm -> paper at 1:100, then clipped to a viewport
        flat = PR.slice_triangles(box(0, 0, 1000, 1000, 0, 3000), 1500, to_paper=lambda p: (p[0] / 100.0, p[1] / 100.0))
        self.assertTrue(all(0 <= v <= 10 for v in flat))
        self.assertEqual(PR.clip_to_rect(flat, (50, 50, 10, 10)), [])
        self.assertEqual(len(PR.clip_to_rect(flat, (0, 0, 10, 10))), len(flat))

    def test_doors_are_not_blocking_by_default(self):
        self.assertNotIn("Doors", PR.BLOCKING)
        self.assertIn("Walls", PR.BLOCKING)
        self.assertTrue(set(PR.BLOCKING) <= set(c for c, _ in PR.CATEGORIES))


if __name__ == "__main__":
    unittest.main()
