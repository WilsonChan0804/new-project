# How it fits together

A BIM coordinator publishes sheets and 3D from Revit; the team reviews in the browser; issues go back to the modeller inside Revit.

![How it fits together](../img/workflow.png)

LWK Viewer workflow · publish, review, answer in Revit

1. <strong>Publish.</strong> In Revit, <strong>Publish to Viewer</strong> exports the chosen sheets as PDF and the model (with its links) in a fast 3D format, then uploads only the files that changed. It can repeat every night.
2. <strong>Prepare.</strong> The server makes a lighter copy of each 3D model for phones and tablets, and reads the text on every sheet so it can be searched. This takes a few minutes after each upload.
3. <strong>Review.</strong> The team opens Sheets, 3D or the Dashboard in any browser. Markups and issues save automatically and appear for everyone.
4. <strong>Answer.</strong> The person assigned sees the issue in the viewer, and also in Revit through the <strong>LWK Issues</strong> window, which zooms to it and sends replies and status changes back.
5. <strong>Close.</strong> The author or a project admin marks the issue Resolved and then Closed. The Dashboard tracks what is open, overdue and who holds it.

Around this loop, the work itself is planned in <strong>Tasks</strong> (a task can be made from an issue and closes it when done), discussed in <strong>Messenger</strong> (each project has a channel where task and issue updates appear) and found again with <strong>Search</strong>. The <strong>Projects</strong> page ties each job together.
