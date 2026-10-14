# -*- coding: utf-8 -*-
"""
Facade utilities.

The automatic arc picker (pick_excursion_arc, collect_arc_vertices,
extract_facade_chain_local) has been REMOVED. Street-facing facade
selection is now manual: the architect picks the facade edges directly
in Revit (see select_facade_curves in sbd_revit_helpers.py). Supports
FilledRegion boundary edges (ObjectType.Edge), point-on-outline snap, or
overlay detail/model lines.

This module retains only shared utilities used by other modules.
"""

from Autodesk.Revit.DB import XYZ

from sbd_geom_base import (
    DOT_THRESHOLD,
    debug_print,
)

from sbd_geom_advanced import (
    get_building_edges_and_normals,
    group_contiguous_edges_with_cyclic_wrap,
)


def remove_consecutive_duplicates(pts, tol=1e-6):
    if not pts:
        return pts
    clean = [pts[0]]
    for p in pts[1:]:
        if p.DistanceTo(clean[-1]) > tol:
            clean.append(p)
    return clean


def build_street_edge_blocks(loop_pts, global_outward_normal):
    """
    Index street-facing edge blocks on the closed building loop (debug only).
    Returns (street_edge_set, blocks) where blocks are lists of edge indices.
    """
    n = len(loop_pts)
    if n < 3:
        return set(), []

    centroid = sum(loop_pts, XYZ.Zero) / float(n)
    edges = get_building_edges_and_normals(loop_pts, centroid)
    total_edges = len(edges)

    street_indices = []
    for i, (_, _, outward) in enumerate(edges):
        if outward.DotProduct(global_outward_normal) > DOT_THRESHOLD:
            street_indices.append(i)

    blocks = group_contiguous_edges_with_cyclic_wrap(street_indices, total_edges)
    street_edge_set = set(street_indices)

    debug_print("  Street-facing edges: {} in {} block(s) (debug only)".format(
        len(street_indices), len(blocks)))
    return street_edge_set, blocks
