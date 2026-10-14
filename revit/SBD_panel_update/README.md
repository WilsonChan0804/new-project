# SBD panel - fixes of 2026-11 (for MyTools.extension, version of 1/9/2026)

Your installed SBD is in
`04 RESOURCE\01 Add-in\01 Revit\MyTools.extension\LWK.tab\Check & Comply.panel\`.

## Install now

| Copy | Over |
|---|---|
| `Case2_Permeability.pushbutton\script.py` | `Check & Comply.panel\Case2_Permeability.pushbutton\script.py` |

It is YOUR script of 1/9/2026 (72 KB) with three small additions - nothing else changed:

- The site boundary must close within 10 mm (it was closed silently with an opening up to 0.6 m) - it asks.
- A Filled Region holding two separate blocks gives two buildings (only the largest was kept; holes are still left out).
  Both the building pick and the gap-group pick.
- Lp: the console prints, beside the Lp used (shorter side of one building), the length of all buildings projected
  on Axis 1 and the required P each gives. The required P itself is NOT changed until you confirm APP-152's reading.

Keep a copy of your old script.py first (rename it script_old.py.bak - not .py, or pyRevit may load it).

## Do NOT install yet

`Shared.scripts\sbd_geom_separation.py` and `Case2_Permeability.pushbutton\sbd_permeability.py` here are made from the
older SBD_panel zip (August). Your `Check & Comply.panel\Shared.scripts\` has newer versions (your script imports
`optimize_plane_y` from sbd_permeability, which the old one does not have) - copying these would break it.

The fix they carry (the continuity check rejecting every gap between two buildings, and S2 measured between the
buildings facing each other) must be checked against YOUR Shared.scripts copies: send
`Check & Comply.panel\Shared.scripts\sbd_geom_separation.py` and `sbd_permeability.py` and it will be patched in them.
