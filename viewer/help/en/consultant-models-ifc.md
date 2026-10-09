# Consultant models (IFC)

Models from other companies (structure, MEP, interior, facade) can be shown with the project's own. Ask them for <strong>IFC</strong> (IFC 2x3 or IFC4): SketchUp, Revit, Tekla, ArchiCAD and Rhino all export it, and it keeps the elements, their properties and their real coordinates. ("WebGL" is how a browser draws; it is not a file to exchange.)

| Use | How |
|---|---|
| Add to this project's 3D | <strong>Models</strong> panel &gt; <strong>+ Consultant model (IFC)</strong>: choose the .ifc, give its name, company and discipline, <strong>Upload and convert</strong>. The server converts it (a bar shows the progress); it then appears under <strong>Consultant models</strong> |
| Overlay another project's model | <strong>+ Overlay another project</strong>: pick a project you can open and one of its models. It is shown here on the shared coordinates both use |
| A 3D page of its own | An admin makes it with <strong>New 3D project from IFC</strong> (Admin). For a model whose coordinates match nothing: a standalone reference, which can still be overlaid later |

- Each consultant model has a tick box (on / off for you) and a slider to make it see-through.
- <strong>One colour, to compare:</strong> the small circle beside a consultant model (and beside each model in the <strong>Models</strong> list) shows the whole model in one colour - red, orange, yellow, green, cyan, blue, purple, grey or any colour - for example the project grey and the structure red. <strong>↺ Original colour</strong> (in the colours, or the <strong>↺</strong> beside a coloured model) puts it back; <strong>↺ Reset colours</strong> at the top of the Models panel puts every model back. It is remembered on this device, works with the see-through slider, and stays in <strong>White</strong> mode.
- A model set <strong>in the middle</strong> (no coordinates) keeps that spot for everyone, phones included - phones load fewer linked models, so it is no longer worked out again on each device.
- <strong>Place</strong> (the person who added it, or a project admin) sets where it sits for everyone: <strong>Shared coordinates</strong> (what a coordinated consultant exports), <strong>This model's origin</strong>, or <strong>No coordinates: set in the middle</strong>; then <strong>East / North / Up</strong> (mm) and <strong>Turn</strong> (°) move it by hand while you watch. <strong>Save for everyone</strong> keeps it; <strong>Cancel</strong> puts it back.
- Its elements can be clicked and issues raised on them like the project's own.
- <strong>×</strong> removes it from the project (who added it, or a project admin).
