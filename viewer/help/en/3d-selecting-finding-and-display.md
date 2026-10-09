# 3D: selecting, finding and display

Click any element to see what it is; use the Model browser to find elements by name, type, level or property.

### The Selection panel

A click shows the element's <strong>Model</strong>, <strong>Category</strong>, <strong>Family / type</strong>, <strong>Level</strong>, <strong>Revit id</strong> (ElementId), <strong>UniqueId</strong>, <strong>IFC GUID</strong>, the clicked <strong>Point</strong> (x, y, z in metres) and <strong>Shared E,N,Z</strong> (survey coordinates), followed by all its Revit parameters in folding groups.

- <strong>Copy Revit ID</strong> copies the ElementId; in Revit use <strong>Manage &gt; Select by ID</strong> and paste it to select the same element there. <strong>Show in Revit</strong> asks the LWK add-in to select it (see Revit elements). <strong>+ Task</strong> keeps the element on a task.
- <strong>Isolate</strong> shows only the selected element(s). <strong>Hide</strong> hides them. <strong>Show all</strong> brings everything back. A counter shows how many are hidden.
- Hiding and isolating only change your own view. Nothing is deleted.

### Elements panel

One tick box per category (Walls, Floors and slabs, Columns, Windows, Doors, Furniture, Railings...) with a count. Untick a category to hide it; <strong>Show all</strong> turns them all back on. Your choice is remembered.

### Model browser

- A tree of <strong>model › category › family / type › elements</strong>. Click a row to open it and pick that group; click an element to highlight and zoom to it.
- <strong>Search names, types, levels, properties</strong>: plain words match name, category, family, type and level. Use <strong>property:value</strong> to match a parameter, for example Fire Rating:2 hr or Mark:D101.
- <strong>Select</strong> colours what you found, <strong>Isolate</strong> shows only that, <strong>Zoom</strong> frames it. After <strong>Select</strong>, <strong>+ Task</strong> at the top keeps all the selected elements on a task as "Elements to change", and <strong>Copy Revit ID</strong> copies all their ids.
- The browser works with models published in the fast 3D format (the normal Publish to Viewer output).

### Display

| Mode | Use it for |
|---|---|
| <strong>Shaded</strong> | Normal viewing with the model's own colours |
| <strong>White</strong> | A clean, colour-free look for reviews and screenshots |
| <strong>X-ray</strong> | See through walls and floors to what is inside |

The <strong>Display</strong> panel also sets the background colour, the ground (on/off and colour) and the grid.

### Saved views

- <strong>Save</strong> (or right-click <strong>Save view...</strong>) stores the camera, section and hidden elements with a name and a thumbnail. Saved views are shared with the whole project.
- Click a saved view to return to it; <strong>✕</strong> deletes it.
- When you go from 3D to Sheets and back, your last 3D view comes back as you left it.
