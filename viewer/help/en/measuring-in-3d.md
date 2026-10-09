# Measuring in 3D

Every measured point snaps to a real corner, edge or midpoint, and the label tells you which, so you know whether to trust the figure.

### How to measure

1. Click <strong>Measure</strong> in the top bar (or right-click <strong>Measure</strong>) and choose <strong>Distance</strong>, <strong>Angle</strong> or <strong>Area</strong>.
2. Move the pointer over the model. A coloured dot and label show the snap under it.
3. Click the first point, then the next. The distance updates live as you move, with its <strong>plan</strong> and <strong>height</strong> parts.
4. Press <strong>Esc</strong> to drop a measurement you started by mistake.

| Mode | Points | Result |
|---|---|---|
| <strong>Distance</strong> | 2 | Length (mm under 1 m, otherwise m), plus plan and height parts |
| <strong>Angle</strong> | 3 | Degrees at the middle point |
| <strong>Area</strong> | 3 to 64 | Area in m² of the polygon |

### Snaps

| Colour | Snap | Meaning |
|---|---|---|
| Red | corner | A vertex of the element, or a corner of the cut in a section |
| Purple | midpoint | The middle of an edge |
| Green | perpendicular | The foot of a square line from your last point to an edge |
| Blue | edge | Anywhere along an edge |
| Grey | surface | No feature nearby: the point on the face (less exact) |

- A ring runs out from each new snap (and the phone vibrates) so you know it caught.
- In a floor plan or section, the snaps follow the cut outline, so you can measure wall to wall in plan.
- Curved surfaces are made of small flat faces, so there is no tangent or centre-of-arc snap yet.

### Straight and other buttons

- <strong>Straight</strong> keeps the next point in line with the last one along X, Y or height, for true orthogonal distances. Hold <strong>Shift</strong> to switch it for one point.
- <strong>Undo</strong> removes the last point, <strong>Clear</strong> removes all measurements.
- <strong>Keep</strong> saves a finished distance as a dimension that everyone on the project sees. The <strong>Dimensions</strong> tick box shows or hides kept dimensions, and each one can be removed with <strong>✕</strong>.
