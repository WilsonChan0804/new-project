# ARC Tools – pyRevit shared parameter tools

Adds an **ARC Tools** tab with three buttons:

| Button | What it does |
|---|---|
| **Add Shared Params** | Adds chosen shared parameters to the *current* model as project parameters. |
| **Batch Add Shared Params** | Does the same for many `.rvt` files (opens in background, saves / syncs, closes). |
| **Vary By Group** | Turns on *Values can vary by group instance* for instance parameters already in the model. |
| **Check Conflicts** | Reports parameters whose GUID/type or name clash with the shared parameter file (read-only). |

## Why "vary by group instance" matters
Instance parameters on elements inside a **model group** are locked to the group
unless the project parameter has *Values can vary by group instance* turned on.
With it on, you can edit values on grouped elements without entering the group, and
DiRoots ProSheets / schedules can write to them as well.

## Install
1. Copy the `pyRevit` folder (the one containing `ARCTools.extension`) to e.g. `C:\pyRevitExtensions\`.
2. In Revit: **pyRevit tab → Settings → Custom Extension Directories → Add folder** → pick that folder → Save & Reload.
3. The **ARC Tools** tab appears.

## Use
1. Click a button, pick your shared parameter file (e.g. `ARC_Share_V2.2.txt`; it is remembered).
2. Pick parameters (switch the shared-parameter group in the dropdown at the top), categories,
   Instance/Type, and the Properties group.
3. Answer **Yes** to *vary by group instance*.

Notes:
- Parameters already in a file keep their group; the chosen categories are **added** to them.
- A parameter with the same name but a different GUID is skipped and reported (no duplicates).
- Batch: back up first; files from older Revit versions get upgraded; close the files in Revit first;
  cloud (BIM 360 / ACC) models are skipped.

## "Cannot be added ... conflicts with the existing name ... and type ..."
A GUID can only have ONE data type in a model. If an old version of the shared parameter
file defined e.g. `LOD-G` as Text and V2.2 defines the same GUID as Number, a group/family
carrying one version cannot be loaded into a model carrying the other.
Run **Check Conflicts** to see which files/families hold the other version. The add tools now
skip such parameters instead of creating the clash.
