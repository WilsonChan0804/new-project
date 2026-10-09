# Sheets (2D)

The Sheets page shows every published sheet as the real PDF, searchable and ready for markup; markups save by themselves, there is no Save button.

### Finding a sheet

- The <strong>Sheets</strong> list on the left shows number and name. "x/y mapped" means that many views on the sheet are linked to the 3D model.
- Click a sheet to open it. The viewer remembers the last sheet you had open.
- <strong>Search all sheets</strong> finds sheet numbers, names and any words printed on the drawings (room names, notes, grid labels). Matches are highlighted on the sheet. The first search on a project can take a moment while the drawings are read.
- <strong>Page Down / Page Up</strong> go to the next or previous sheet.
- To add an outside PDF (a consultant drawing, a sketch), use the <strong>PDF</strong> upload button and name its <strong>set</strong> (e.g. "Uploaded PDFs" or "Consultant 2026-10"). Each set is its own entry in the drop-down at the top, under the project's title, apart from the sheets from Revit. Its sheets show "Imported 2D only" and can be removed with their <strong>✕</strong>.

### Moving around a sheet

| Action | Mouse | iPad / touch |
|---|---|---|
| Zoom | Scroll wheel (zooms round the pointer) | Pinch |
| Pan | Hold the middle button, or the <strong>Pan</strong> tool (H) | Two fingers; after you use an Apple Pencil, one finger pans |
| Whole sheet | <strong>Fit</strong> | <strong>Fit</strong> |
| Rotate the page | Rotate button in the toolbar | Same |
| Menu | Right-click | Long press |
| Undo / redo | Ctrl+Z / Ctrl+Y | Two-finger tap / three-finger tap |

### Useful sheet tools

- <strong>Split</strong> opens a second sheet beside the first, with its own zoom.
- <strong>Links</strong> turns section marks, callouts and elevation markers into links to their sheets; <strong>← back</strong> returns.
- <strong>Compare</strong> shows what changed against an earlier upload of the same sheet, another sheet, or a PDF from your computer: red = removed, green = added. <strong>N / Shift+N</strong> jump between changes.
- <strong>2D + 3D</strong> opens the 3D model beside the sheet. Choose <strong>Stand there</strong> or <strong>Look at</strong>, then click a plan: the 3D view goes to that spot. A "you are here" marker on the plan follows the 3D camera; tick <strong>Follow</strong> to keep it in view and switch plans as you walk between floors. Only plan views take part, not sections or elevations.

### Markup tools

| Group | Tools |
|---|---|
| Shapes | Rect, Circle, Line, Arrow, Cloud, Polyline, Polygon |
| Freehand | Pen (hold still at the end of a stroke to snap it to a line, circle or rectangle), Highlighter |
| Text | Text, Text box, Callout |
| Stamps | APPROVED, APPROVED AS NOTED, REVISE &amp; RESUBMIT, REJECTED, REVIEWED, FOR INFORMATION, VOID (signed with your name and time) |
| Measuring | Measure, Dimension, Area, Angle (use the scale in the <strong>1:</strong> box, or the view's own scale when it is empty) |
| Other | Snip (copies a region as an image; you can also paste an image), Select text, Eraser, Match properties, Select, Pan |

- <strong>Polyline / Polygon:</strong> click the points, then press Enter, double-click or <strong>✓ Finish</strong>. Backspace removes the last point.
- <strong>Style bar:</strong> Layer, Line / Fill / Text colour, Opacity, Weight (paper mm), line Type, Font, Size (text height in mm), Align.
- <strong>Editing:</strong> select a markup to move, resize or restyle it; R / Shift+R rotate it 90°; Ctrl+C / Ctrl+V copy and paste (paste on another sheet lands at the same spot); Delete removes it.
- <strong>Comment or Issue:</strong> the <strong>Comment / Issue</strong> switch in the top bar decides what happens when you finish a markup. In <strong>Issue</strong> mode the <strong>Raise issue</strong> window opens straight away. A comment can be turned into an issue later with <strong>Issue</strong> or right-click <strong>Raise issue</strong>.
- <strong>Layers:</strong> markups sit on layers (default "General"). Admins can lock a layer or hide it from some people. The eye button hides all markups.

### Exporting

- <strong>PDF</strong> (download) exports this sheet, every sheet with markups, or all sheets, with markups either <strong>Editable</strong> (real PDF comments for Bluebeam, Acrobat or PDF-XChange) or <strong>Flattened</strong>, at 100, 150 or 200 dpi, optionally with an issue report at the end.
- <strong>JSON</strong> (download / upload) saves or loads all comments and issues, for backup or moving between projects.
- <strong>BCF</strong> exports the sheet issues for Revit or Navisworks (see Issues and BCF).
