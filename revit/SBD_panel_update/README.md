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

## The main fix: Shared.scripts\sbd_geom_separation.py

The continuity check rejected EVERY gap between two buildings (its rays ran along the buildings' corners), so P came out
too low on any site with two or more buildings: on two blocks 20 m apart, P = 20 % instead of 40 %.

The file here is YOUR backup copy (31/07/2026, 9,298 bytes) with only `continuity_check` changed.

1. Open `Check & Comply.panel\Shared.scripts\` and look at `sbd_geom_separation.py`:
   - **9,298 bytes** (Properties > Size) - it is the same file as your backup: rename it
     `sbd_geom_separation.py.bak` and copy this one in.
   - **any other size** - it has changed since: don't copy; send that file and the fix is put into it.
2. Reload pyRevit and run Case2 again: a gap of 15 m or more between two buildings now counts (S2).

## Do NOT install

`Case2_Permeability.pushbutton\sbd_permeability.py` here is from the older SBD_panel zip (August); your script needs
`optimize_plane_y`, which only your newer copy has - it would break Case2.
