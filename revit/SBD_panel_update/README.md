# SBD panel - fixes of 2026-11

Copy these three files over the ones in the SBD extension
(`SBD_Automation.extension/SBD_Automation.tab/Analysis.panel/`):

| File | Fix |
|---|---|
| `Shared.scripts/sbd_geom_separation.py` | **Every gap between two buildings (S2) failed.** The continuity check cast rays on the gap's edges, which are the buildings' corners, so they always hit a building. P came out too low on any site with two or more buildings. |
| `Case2_Permeability.pushbutton/sbd_permeability.py` | S2 is measured between the two building loops that face each other across the gap (the nearest pair), not the last / first loop of each side. |
| `Case2_Permeability.pushbutton/script.py` | The site boundary must close within 10 mm (it was 0.6 m, closed silently) - it asks. A Filled Region with two blocks gives two buildings (the largest only before; holes still left out). Lp is the length of all buildings projected on Axis 1; the earlier Lp (shorter side of one building) is printed beside it until APP-152's reading is confirmed. The result says that the Middle / High zones are the Low-zone footprints here. |

The same rules run on the LWK Viewer from the 3D masses (LWK > SBD Export,
then Checks > SBD on the 3D page), with real Middle and High zones.
