# SBD - the complete Check & Comply.panel set (2026-11)

Copy the three folders in `Check & Comply.panel\` into your
`MyTools.extension\LWK.tab\Check & Comply.panel\` (merge; replace the files when asked), then reload pyRevit.

| Folder | What it is |
|---|---|
| `Shared.scripts\` (14 files) | From SBD_Automation.extension (27/08/2026), **unchanged**. These are the files that went missing (sbd_revit_helpers, sbd_geometry, sbd_permeability, sbd_wind_corridor, sbd_audit_draw ...). Every import of your Case1 / Case2 scripts and wizards is found in them (checked). |
| `Case2_Permeability.pushbutton\` | Your newest script.py (01/09/2026) with 3 small additions (below); wizard2 .py / .xaml as installed. |
| `Case1_Profile.pushbutton\` | As installed (identical in both copies you sent). |

Left out: `test_corridor_context.py` (a developer test), docs, tools and the handover note.

## The 3 additions in Case2 script.py
- The site boundary must close within 10 mm (it was closed silently with an opening up to 0.6 m) - it asks.
- A Filled Region holding two separate blocks gives two buildings (only the largest was kept; holes still left out) -
  in the building pick and in the gap-group pick.
- Lp: the console prints, beside the Lp used (the shorter side of one building), the length of all the buildings
  projected on Axis 1 and the required P each gives. The required P itself is not changed.

## The continuity check
In these 27/08 files the straight continuity check still blocks every gap between two buildings, but the newer
permeability engine then tries a corridor through the gap and keeps it ("a 20.00 m corridor bends through ... kept"),
so the result is right (two blocks 20 m apart: P = 40 %). No change was made there.
Do not use the older sbd_geom_separation.py / sbd_permeability.py sent earlier.
