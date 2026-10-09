# Folders

Right-click a folder in the tree on the left (or use ⋯ on a folder) for <strong>New folder here</strong>, <strong>Rename</strong>, <strong>Move to ...</strong>, <strong>Star</strong>, <strong>Pin</strong>, <strong>Copy link</strong> and <strong>Delete</strong>.

<strong>Reading documents without downloading:</strong> click a PDF, picture, video, text file, or a <strong>Word, Excel or PowerPoint</strong> file and it opens beside the list. Office files look exactly as in Office when LibreOffice is installed on the server (ask your admin); without it, Word and Excel are shown in a simpler way and PowerPoint has to be downloaded.

- <strong>More room for the document:</strong> <strong>☰</strong> (top left of the list) hides or shows the folder column, and is remembered. <strong>⤢</strong> in the preview hides the folders and the file list too, so the document gets the whole width; press it again, or <strong>Esc</strong>, to bring them back. Drag the preview's left edge to make it wider.
- <strong>Whole page:</strong> Word and Excel files shown in the page start at <strong>Fit</strong>: the widest page, landscape pages too, fits the width of the preview, on a computer and on a phone. <strong>−</strong> and <strong>+</strong> zoom; <strong>Fit</strong> goes back. PDFs open at the page width.
- <strong>On a phone or tablet</strong> (upright or on its side) a document opens full screen: PDFs and converted Office files show every page, one under the other, to scroll through; pinch with two fingers or use <strong>−</strong> / <strong>+</strong> to zoom. <strong>☰</strong> opens the folders; tap beside them to close.
- <strong>For the admin - installing LibreOffice</strong> on the server (Ubuntu): `sudo apt-get install -y --no-install-recommends libreoffice-writer libreoffice-calc libreoffice-impress fonts-noto-cjk fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea`, then restart the viewer service. All three of Writer, Calc and Impress are needed: with only libreoffice-core the page says "cannot read this kind of file". A big document takes a while the first time; it is kept, so it opens at once after that.

<strong>Folders</strong> holds each project's files in a folder on the server, like ACC Docs or a shared drive. Pick the project at the top left.

<strong>00 BIM</strong> (🔒, always first) holds what the viewer has for the project, always up to date: <strong>2D Sheets</strong> (the sheets exported from Revit, named by number and name, and the PDF sets uploaded on the Sheets page) and <strong>3D Models</strong> (opened on the 3D page; IFC files - IFC projects and consultant models - can be downloaded). Everyone in the project can open and download there; nobody can add, rename, move or delete. A project with several parts has a folder per part.

- <strong>Browse:</strong> the folder tree on the left, the path at the top, or <strong>Search this project's files</strong>. Double-click a folder to open it; click a PDF, picture or video to preview it.
- <strong>Upload:</strong> drop files, or whole folders, onto the page (or onto a folder in the list), or press <strong>Upload</strong>. <strong>+ Folder</strong> makes a folder.
- <strong>⋯ on a file</strong> (or right-click): Preview, Download, <strong>Add to the Sheets page</strong> (PDFs), <strong>Star</strong>, <strong>Pin for everyone</strong> (project admins), Copy link, Rename, <strong>Move to ...</strong> and Delete. Drag files onto a folder to move them; <strong>Delete</strong> and <strong>F2</strong> work on the selected file.
- <strong>Pinned</strong> shows the documents a project admin pinned for everyone; <strong>Starred</strong> shows your own. <strong>Recent</strong> lists the newest files.
- <strong>Deleting:</strong> the person who uploaded a file, or a project admin. Deleted things go to <strong>Recently deleted</strong>, from where they can be put back; <strong>Ctrl+Z</strong> also brings them back at once.
- <strong>Folder templates (project admins):</strong> ⋯ (top right) &gt; <strong>Save these folders as a template</strong> keeps this project's folders (no files) by name. In another project, <strong>Lay out folders from a template</strong> makes the folders it is missing; nothing is deleted.
- <strong>To the Sheets page:</strong> a PDF's ⋯ &gt; <strong>Add to the Sheets page</strong> turns its pages into sheets in a set of their own (choose the set and the sheet number), ready for markups and issues.
- Files put into the project's folder on the server some other way (for example from Windows Explorer) show up here too.
