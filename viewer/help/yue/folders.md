# Folders 檔案夾

喺左邊 folder 樹右撳一個 folder（或者用 folder 嘅 ⋯），可以 <strong>New folder here</strong>（喺度開新 folder）、改名、<strong>Move to ...</strong>、加星、Pin、copy 連結同刪除。

<strong>唔使下載都睇到：</strong> 撳 PDF、相、片、文字檔，或者 <strong>Word、Excel、PowerPoint</strong>，就會喺清單隔籬打開。Server 裝咗 LibreOffice（問你嘅 admin）嘅話，Office 檔案會同喺 Office 入面一模一樣；未裝就用簡單啲嘅方式顯示 Word 同 Excel，PowerPoint 要下載。

- <strong>俾文件多啲位：</strong> 清單左上角嘅 <strong>☰</strong> 收埋／打開左邊 folder 欄（會記住）。預覽入面嘅 <strong>⤢</strong> 連 folder 同檔案清單都收埋，文件用晒成個闊度；再撳一次或者 <strong>Esc</strong> 就返嚟。拖預覽嘅左邊邊位可以拉闊。
- <strong>成版睇晒：</strong> 喺網頁度顯示嘅 Word 同 Excel 一開就係 <strong>Fit</strong>：最闊嗰版（橫向都得）啱啱好放得落預覽闊度，電腦同手機都係。<strong>−</strong>、<strong>+</strong> 縮放；<strong>Fit</strong> 返原。PDF 一打開就係頁闊。
- <strong>手機同平板</strong>（打直或者打橫）：文件會全屏打開，PDF 同轉換咗嘅 Office 檔案一頁接一頁，可以向下碌晒全部頁；兩隻手指 pinch 或者用 <strong>−</strong> / <strong>+</strong> 縮放。<strong>☰</strong> 打開 folder 欄，撳旁邊空位就收返。
- <strong>Admin 用 - 喺 server 裝 LibreOffice</strong>（Ubuntu）：`sudo apt-get install -y --no-install-recommends libreoffice-writer libreoffice-calc libreoffice-impress fonts-noto-cjk fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea`，然後重開 viewer service。Writer、Calc、Impress 三個都要裝：淨係得 libreoffice-core 嘅話，網頁會話「cannot read this kind of file」。大文件第一次要等一陣，之後有 cache，即刻開到。

<strong>Folders</strong> 將每個 project 嘅檔案放喺 server 上面一個 folder，好似 ACC Docs 或者共用 drive 咁。喺左上角揀 project。

<strong>00 BIM</strong>（🔒，永遠排第一）放住 viewer 已有嘅嘢，自動更新：<strong>2D Sheets</strong>（由 Revit 出嘅 sheet，用編號同名稱命名，同埋喺 Sheets 頁上載嘅 PDF set）同 <strong>3D Models</strong>（喺 3D 頁打開；IFC 檔案 - IFC project 同顧問 model - 可以下載）。Project 入面所有人都可以打開同下載，但冇人可以加、改名、搬或者刪。有幾個部分嘅 project，每部分一個 folder。

- <strong>瀏覽：</strong> 左邊嘅 folder 樹、頂部嘅路徑，或者 <strong>Search this project's files</strong> 搜尋。雙擊 folder 打開；撳 PDF、相或者片就預覽。
- <strong>上載：</strong> 將檔案，甚至成個 folder 拖落版面（或者拖落清單入面某個 folder），或者撳 <strong>Upload</strong>。<strong>+ Folder</strong> 開新 folder。
- <strong>檔案嘅 ⋯</strong>（或者右撳）：預覽、下載、<strong>Add to the Sheets page</strong>（PDF）、<strong>Star</strong>（加星）、<strong>Pin for everyone</strong>（project admin）、copy 連結、改名、<strong>Move to ...</strong> 同刪除。將檔案拖落 folder 就搬；揀咗檔案可以用 <strong>Delete</strong> 同 <strong>F2</strong>。
- <strong>Pinned</strong> 係 project admin 幫大家 pin 嘅重要文件；<strong>Starred</strong> 係你自己加星嘅。<strong>Recent</strong> 列出最新嘅檔案。
- <strong>刪除：</strong> 上載嗰個人，或者 project admin。刪咗嘅嘢會去 <strong>Recently deleted</strong>，可以放返原位；<strong>Ctrl+Z</strong> 都可以即刻攞返。
- <strong>Folder 範本（project admin）：</strong> 右上 ⋯ &gt; <strong>Save these folders as a template</strong>，將呢個 project 嘅 folder 結構（唔包檔案）用個名儲起。喺另一個 project 用 <strong>Lay out folders from a template</strong>，就會開返佢未有嘅 folder；乜都唔會刪。
- <strong>放去 Sheets 版：</strong> PDF 嘅 ⋯ &gt; <strong>Add to the Sheets page</strong>，每一頁變成一張 sheet，放喺自己一個 set（揀 set 名同 sheet 編號），即刻可以 markup 同開 issue。
- 用其他方法（例如 Windows Explorer）放入 server 上面嗰個 folder 嘅檔案，呢度都會見到。
