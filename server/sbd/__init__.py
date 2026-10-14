"""SBD (PNAP APP-152) analysis outside Revit.

The calculation modules of the pyRevit SBD panel (sbd_permeability,
sbd_geom_separation, sbd_wind_corridor) run here unchanged in their rules,
on plain points instead of Revit's XYZ, with the buildings taken from the
3D masses exported by the LWK add-in (SBD Export): each height zone's
footprints are cut from the masses, so the Middle and High zones are real
rather than copies of the Low zone.

Internal unit: feet (as in the add-in, so every threshold is the same);
sbd.json and the results are in metres.
"""
