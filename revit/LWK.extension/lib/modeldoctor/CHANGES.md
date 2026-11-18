# LWK Model Doctor: changes in 0.13.0 (in the LWK extension)

Model Doctor now lives in the LWK extension (`lib/modeldoctor`, button
`LWK.tab/Viewer & Issues.panel/ModelDoctor.pushbutton`), next to the viewer
tools. It shares the LWK Issues sign-in.

## Fixed

1. **Checks ran outside Revit's API context.** `on_run` called each check
   straight from a WPF click in a modeless window. Revit does not support
   that, and it was the likely cause of the "unrecoverable error" crashes that
   `_pump`, `guarded` and `probe.log` were working around.
   - Each check now runs in its own ExternalEvent (`core.Dispatcher`).
   - Between checks the window repaints through the WPF dispatcher.
   - `PushFrame` is gone.
   - The confirmation is pyRevit's WPF dialog, not a TaskDialog shown from
     outside the API context.
2. **Revit 2026.** About 80 uses of `ElementId.IntegerValue` and
   `ElementId(int)` broke the tool on 2026, which removed both. They now go
   through `compat.id_int` / `compat.new_id`, so it runs on Revit 2022 to 2026.
3. **"Fix selected" with nothing selected fixed everything shown.** It now
   needs a selection. Copy IDs and Select still fall back to everything shown.
4. **Stale results after a fix.** Fixed rows stayed in the list and could be
   "fixed" again. The fixed checks now run again straight after the
   transaction.
5. **One transaction, no SubTransaction.** A check that failed halfway left
   its partial edits in the model. Each check's fix now runs in its own
   SubTransaction (`core.in_sub`) and rolls back on its own.
6. **The accepted list was keyed by `doc.Title` in APPDATA.**
   - A local copy is titled "Model_user", so everyone had their own list.
   - The store was also bound to the document open when the window opened,
     so after switching models a run saved into the wrong file.
   - It is now keyed by the central model's path (`core.model_key`), rebuilt
     when the model changes, and shared through the viewer.
   - The old file and its ElementId signatures are still read.
7. **Signatures used ElementIds.** They now use UniqueIds
   (`core.uid_signature`, `shared.signature`), which are stable and are what
   the viewer has. A finding means the same in Revit and in the viewer.
8. **The CSV export was IronPython-only** (`'wb'` + `unicode().encode`). It is
   now `shared.write_csv`: UTF-8 with a BOM, which Excel reads, and it works
   under CPython too.
9. **Settings were only saved on Run or Close.** They are now saved on every
   change.
10. **Duplicates ignored design options and phases.** An element in Option A
    and its copy in Option B were "duplicates", and the fix deleted one of
    them. The option and the phases are now part of the duplicate signature.
11. **Smaller fixes:**
    - "Fix all in this check" follows the Check filter.
    - The combo-box saver is guarded like every other handler.
    - The package reloads with each run, so no pyRevit Reload is needed after
      an update.

## New

- **Not an error for the whole project:** viewer items with placement
  `doctoraccept`, one per finding. The viewer's Model Doctor (3D > Checks >
  Doctor) reads and writes the same list.
- **Fix queue (N):** the findings the viewer asked Revit to fix (placement
  `doctorfix`).
  - Clicking it runs those checks and selects the queued findings that are
    still in the model.
  - After Fix selected, each one is answered "fixed", or "skipped" with the
    reason.
  - Findings no longer in the model are answered "not found".
- `shared.py` is plain Python: signature, item ids (the same hash as the
  viewer), queue matching and CSV. It is tested without Revit in
  `revit/tests/test_modeldoctor.py`.

## Still worth doing

- **Speed.** `geom.solids_of` and the Boolean intersections are built again
  for every pair. Cache each element's solids for the whole run, as
  `LinkedRec` already does; `WallRec` and `ColumnRec` should too. Put an
  `ElementIntersectsSolidFilter` or `BoundingBoxIntersectsFilter` in front of
  the Booleans.
- **Phase and option rules.** `context.coexist` gates the wall and column
  pairs but not the link checks. Link elements have their own phases, so the
  rule needs the link's phase map.
- **Fixing by itself.** The ExternalEvent queue could run "Fix queue" without
  anyone at the computer, for example in the nightly AutoPublish. Fixes still
  need a person to confirm today.
