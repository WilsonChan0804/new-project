# Revit elements

A 3D issue keeps the Revit element it was raised on: <strong>ElementId</strong>, <strong>UniqueId</strong>, IFC GUID, category, family / type and level. Models published by the LWK add-in know all of these; older ones only the IFC GUID.

| To | Do this |
|---|---|
| Select it in Revit now | <strong>Copy Revit ID</strong> (or <strong>Copy Revit IDs</strong>), then in Revit <strong>Manage &gt; Select by ID</strong> and paste. Works today, no add-in change needed |
| See it in 3D | <strong>Show in 3D</strong>: the 3D page picks the element(s) out and zooms to them |
| Have Revit select it | <strong>Show in Revit</strong> asks the LWK add-in to select it in Revit. Until the add-in supports this, the ids are copied for Select by ID instead |
| Hand it to a colleague | Select elements on the 3D page and press <strong>+ Task</strong>: they go on the task as <strong>Elements to change</strong>, with the same buttons |
| Send it to another tool | <strong>Export BCF</strong>: Revit BCF tools select the element from its ElementId |
