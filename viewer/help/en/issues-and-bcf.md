# Issues and BCF

An issue is a markup or a 3D point with a title, type, owner, due date and a conversation; it is numbered by the server (#N) and the same issue appears on Sheets, in 3D, on the Dashboard and in Revit.

### Raising an issue

| Where | How |
|---|---|
| On a sheet | Switch the top bar to <strong>Issue</strong> and draw a markup; or select a markup and press <strong>Issue</strong>; or right-click it and choose <strong>Raise issue</strong>. A sharp picture of the drawing is attached automatically: it is drawn from the PDF itself at about 200 dpi, whatever the zoom or the speed settings of your computer. |
| In 3D | Click <strong>Add issue</strong>, then click the spot (on iPad: long press). The camera, section and hidden elements are saved with it, and a snapshot is attached. <strong>Mark up snapshot</strong> lets you draw on the picture (clouds, arrows, text and more). |

Fill in the issue window, then <strong>Save issue</strong>:

| Field | Notes |
|---|---|
| <strong>Title</strong> | Required, up to 120 characters. Say what is wrong and where, for example "L12 corridor: fire door swing clashes with riser" |
| <strong>Type</strong> | General, Design, Coordination, Clash, Fire safety, Statutory / BD, Structure, MEP, Facade, Drawing error, Query / RFI |
| <strong>Description</strong> | What is wrong, what you expect, any reference |
| <strong>Assign to</strong> | Pick a project member (or type a name) |
| <strong>Due</strong> | The date an answer is needed |
| <strong>Status</strong> | Open, In progress, Resolved, Closed |
| <strong>Priority</strong> | Low, Normal (default), High, Critical |
| <strong>Template</strong> | Load a saved set of fields; <strong>Save as template</strong> shares the current one with the project |

### Working an issue

- Click an issue in the list (or its pin in 3D) to open it. In 3D the view goes back to exactly what the author saw: the same eye and direction, the section box with its turn (or the section plane), hidden elements, parallel or perspective view and the floor plan. <strong>Show in view</strong> and links to the issue do the same.
- <strong>In Revit</strong> (LWK Issues &gt; <strong>Go to</strong>): an issue seen through the viewer's normal camera, or raised while walking, opens in a perspective camera view <strong>LWK Issue - &lt;you&gt; (camera)</strong> from the same eye, with the same section box, not a view of the whole building from outside.
- In the issue window: edit the title and fields, <strong>Add photo</strong> (site photos, several at once), and write in <strong>Add a comment</strong> then press <strong>Comment</strong>. Type <strong>@</strong> to mention a project member.
- <strong>Show in view</strong> returns to the spot; <strong>Show in 3D</strong> opens the 3D page there.
- <strong>Not an issue</strong> closes it with a reason that everyone can read; the same button reopens it.
- <strong>Delete</strong> removes it for everyone. Members can delete only their own issues; project admins can delete any.
- <strong>Revit element</strong> (3D issues): the element it was raised on, with <strong>Copy Revit IDs</strong>, <strong>Show in 3D</strong> and <strong>Show in Revit</strong>.
- <strong>Tasks:</strong> the tasks that point at this issue, with their owner and due date. <strong>+ New task from this issue</strong> makes one (see Issues and tasks together); <strong>Send to chat</strong> posts the issue into a chat.
- Setting the status to <strong>Resolved</strong> or <strong>Closed</strong> and pressing <strong>Save</strong>: if tasks on the issue are still open, the viewer offers to mark them done.

### Status: who does what (team practice)

| Status | Set by | Meaning |
|---|---|---|
| Open | Author | Raised, waiting for the assignee |
| In progress | Assignee | Being worked on |
| Resolved | Assignee | Fixed or answered; waiting for the author to check |
| Closed | Author or project admin | Checked and done |

### Finding issues

- <strong>Sheets:</strong> the right panel lists <strong>All / Issues / Comments</strong>, grouped by Sheet, Status, Assigned to, Raised by, View, Issue type or Markup type, with a <strong>Search</strong> box. Right-click an entry to open it, show it on the sheet or in 3D, or change its status.
- <strong>3D:</strong> <strong>Issues in 3D</strong> groups by Status, Floor, Issue type, Assigned to, Raised by or Model. <strong>Sheet issues</strong> also shows issues raised on sheets as diamonds in the model. <strong>Hide issues</strong> hides the pins (nothing is deleted).
- <strong>Dashboard:</strong> filters, overdue lists and the responsibility table (see Dashboard and projects).

### BCF: issues with Revit, Navisworks and others

- <strong>Export BCF</strong> (3D page) and <strong>BCF</strong> (Sheets page) download a BCF 2.1 file with each issue's title, status, priority, dates, author, assignee, description, camera, selected element and snapshot. Plain comments without an issue are left out, as are the issue type, the comment thread and added photos.
- The selected element is written with its IFC GUID <strong>and its Revit ElementId</strong> (AuthoringToolId), so Revit BCF tools such as Autodesk BCF Manager, BCFier and Revizto select it in Revit.
- <strong>Import BCF</strong> (3D page only) reads BCF 2.0, 2.1 and 3.0 from Revit, Navisworks, Solibri or ACC. It first asks which coordinates the file uses: choose <strong>Work it out (recommended)</strong> unless you know. Issues already imported (same ID) are skipped.
