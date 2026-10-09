# 俾 BIM coordinator：由 Revit publish

一個掣 <strong>Publish to Viewer</strong> 就會 export sheet 同 3D model 再 upload；其他掣係俾你逐步自己做，或者夜晚自動做。

### 設定（每部電腦一次）

- 安裝 LWK pyRevit extension。佢會加一個 <strong>LWK</strong> tab，有 <strong>Viewer &amp; Issues</strong> panel：<strong>Publish to Viewer</strong>、<strong>LWK Issues</strong> 同 <strong>Viewer tools</strong> 下拉選單。
- Sign in 一次（喺 <strong>LWK Issues</strong> 或者 <strong>Publish</strong>）。登入會保留一年，夜晚 upload 都照做得。
- Upload 去現有 project 你要係佢嘅 <strong>project admin</strong>；新 project 名要 <strong>site admin</strong>。

### Publish to Viewer

1. 喺 Revit 打開 model，撳 <strong>Publish to Viewer</strong>。
2. <strong>Where：</strong> 揀 <strong>Viewer project</strong>（或者打個新名：英文字母、數字、- 同 _），檢查 <strong>Server</strong> 顯示「signed in」，同埋 <strong>Export folder</strong>。
3. <strong>What：</strong> 剔 <strong>3D model (fast format, with its linked models)</strong>，揀細節：<strong>Coarse (lightest)</strong>、<strong>Medium (recommended)</strong> 或者 <strong>Fine (most detail)</strong>。剔 <strong>Sheets</strong>，揀 <strong>All sheets</strong>、<strong>A Revit sheet set</strong> 或者 <strong>These sheets</strong>。<strong>Keep sheets published before</strong> 會保留之前 publish 過、但唔喺今次選擇入面嘅 sheet。
4. <strong>Then：</strong> <strong>Send to the viewer server (only what changed)</strong>、<strong>Open it in the browser when done</strong>，可以揀 <strong>Publish this model again every night at</strong> 01:00（想嘅話只限星期一至五；只限 ACC model）。
5. 撳 <strong>Publish</strong>。你揀嘅嘢會為呢個 model 記住。Revit model 唔會被改或者儲存。

Upload 完之後 server 要幾分鐘整手機版同讀 sheet 嘅字。Server 會保留每張 sheet PDF 最近 12 個版本（俾 <strong>Compare</strong> 用），同每個 3D model 最近 2 個（俾 <strong>Compare with previous export</strong> 用）。

### Viewer tools 下拉選單

| 掣 | 用嚟 |
|---|---|
| <strong>Fast 3D Export</strong> | 只 export 3D model（同 link），用 fast 格式；sheet 保留 |
| <strong>Export Viewer</strong> | 自己 export sheet 同 manifest（舊 IFC 方法） |
| <strong>Upload Now</strong> | 再將上次 export 傳去 server |
| <strong>Add Model</strong> | 登記一個 ACC model 做自動 export：sheet、IFC schema、唔要嘅 category、標準層組 |
| <strong>Run Export</strong> | 即刻 export 同 upload 所有登記咗嘅 model（Shift-click：只做打開緊嗰個） |
| <strong>Night Export</strong> | 排每晚或者平日夜晚做、取消排程，或者睇狀態同 log |
| <strong>Export Link</strong> | Export 一個自動 export 開唔到嘅 link（例如舊版本嘅 cloud model） |
| <strong>Link Places</strong> | 將每個 link instance 嘅位置寫入 export folder |
| <strong>Test Links</strong> | 快速檢查放咗多過一次嘅 link |

<strong>夜晚 export 需要：</strong> 部電腦開住同登入咗（鎖咗 screen 冇問題）、排咗嘅時間 Revit 要閂咗、Revit 登入咗 Autodesk。每個 model 預大約 15 分鐘。Log 喺 %APPDATA%\LWK\nightly。

- Model 嘅每個 workset 都會逐個名打開，冇 load 嘅 link 會 load 返。如果仲有 workset 閂住，或者 3D model 出咗嚟係空嘅，viewer 會<strong>保留上次好嘅 3D model</strong>（sheet 照傳），log 最尾寫 <strong>result FAILED</strong> 同原因。
- 已知嘅對話框會自動答，唔會令夜晚 export 停住：DWG 嘅 paper space 冇嘢（Yes）、DWG <strong>extents greater than 1E9</strong>（OK：照樣 import，只係切走好遠嗰部分）、DWG import 嘅通知例如 <strong>Elements Lost on Import</strong>（Close）、<strong>External Tools - Add-in Assembly Not Found</strong> 同其他 add-in 嘅 <strong>搵唔到 xxx.dll</strong> 訊息（Close），同埋所有得一個掣嘅訊息。LWK 工具未載入之前、或者開 model 期間彈出嘅對話框，由 launcher 嘅 watcher 處理，佢會搵晒嗰個 Revit 嘅所有視窗。每個對話框都會寫入 nightly\dialogs.log。更新之後，下次你自己開 Revit 時，launcher 同 watcher 會自動更新。最好係喺嗰部電腦修好或者移除壞咗嘅 add-in。
- <strong>夜晚只發佈有改動嘅 model：</strong> 開咗 model 之後，夜晚 run 會讀 model 同每個 link model 嘅版本（Revit 每次儲存都有編號）。如果上次發佈之後一個都冇再儲存過、job 設定又一樣，就唔會 export，夜晚 log 會寫 <strong>UNCHANGED</strong>。Test run、自己撳 Run Export、改咗設定或者更新咗工具，都一定會發佈。仍然要先開 model 先讀到版本。
- <strong>時間：</strong> 每個 Revit 版本最多可以行 3 個鐘（nightly_schedule.json 嘅 limit_hours）；版本會一個跟一個咁行（2023、2024、2025），嗰部電腦已經開咗嘅 Revit 版本，當晚會跳過。夜晚 run 最好早啲開始（例如 01:00），等所有版本喺朝早有人開 Revit 之前做完。

### Revit 入面嘅 LWK Issues 視窗

- 列出一個 project 喺 viewer 嘅 issue：<strong>Show</strong> 未完成同做緊、派俾我嘅，或者全部；可以搜尋；欄有 #、Title、Type、Status、Priority、Assigned to、Due、Where。
- <strong>Go to issue</strong>（或者 double-click）會打開一個私人 3D 視圖「LWK Issue - 你個名」，有 section box 圍住個 issue，或者 zoom 去 sheet。隔籬有 <strong>Open its plan view</strong> 同 <strong>Open in web viewer</strong>。
- <strong>Place pins for the list</strong> / <strong>Remove pins</strong> 喺 workset「LWK Issues」加「LWK #n」標記。<strong>Clouds on sheets</strong> 喺 revision「LWK Viewer issues」下面加 revision cloud。
- 揀個狀態及／或打個 comment，然後 <strong>Send to viewer</strong>：會用你個名出現喺網上 viewer。

### Revit 元件同 LWK add-in

- 喺 publish 咗嘅 model 3D 入面開嘅每個 issue 都帶住元件嘅 ElementId 同 UniqueId。Review 嘅人可以 copy 啲 id 用 <strong>Manage &gt; Select by ID</strong>，BCF export 會當 AuthoringToolId 帶埋佢哋。
- Viewer 入面嘅 <strong>Show in Revit</strong> 會喺 server 留低一個要求俾 add-in 攞；add-in 亦可以將 Revit 入面揀咗嘅嘢傳去 viewer。Add-in 要做乜寫咗喺 <strong>server/REVIT_ADDIN_API.md</strong>，俾負責維護佢嘅人睇。
