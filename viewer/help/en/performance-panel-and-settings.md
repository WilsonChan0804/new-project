# Performance panel and settings

The <strong>Performance</strong> link at the bottom right of the 3D page opens load times, frame rate and memory, plus a few settings; <strong>Copy</strong> puts the whole report on the clipboard to paste into an email or Teams message when you report a problem.

| Setting | Choices | What it does |
|---|---|---|
| <strong>Streaming</strong> | automatic / on / off | Fetch big models in pieces as the view needs them (automatic = on for phones and tablets) |
| <strong>Memory budget</strong> | automatic / 150 to 1500 MB | How much geometry the device keeps before letting go of what is out of sight |
| <strong>Drawing with</strong> | WebGL (standard) / WebGPU (trial) | The graphics method; the page reloads to switch. Keep WebGL unless asked to test |
| <strong>While moving</strong> | follow the frame rate / always full quality | When the frame rate drops while you move, draw a lighter moving picture; the still view is always full quality |

Streaming and memory budget apply after reloading the page. The status bar also shows the live frame rate, triangles drawn and graphics memory; "moving step 1 to 4" means the lighter moving picture is in use.

<strong>Loading speed</strong>

- The viewer's files are sent compressed (the 3D library drops from 4.8 MB to 0.7 MB) and are kept by your browser: from the second visit on, a page opens from your own computer and only its data comes from the server.
- Each page asks for all its data at once while it loads. The Messenger and the Projects page also show what they showed last time straight away, then update.
- After an update of the viewer, changed files are fetched again by themselves; you never get a mix of old and new.
