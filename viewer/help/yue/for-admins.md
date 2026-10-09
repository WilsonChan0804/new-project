# 俾 admin 嘅

Project admin 喺 <strong>Admin</strong> 版管理自己 project 嘅人同設定；site admin 仲管理 account、所有 project、回收站同裝置報告。

### 角色

| 角色 | 可以 |
|---|---|
| <strong>Viewer</strong> | 乜都睇得；唔可以加或者改 issue 同 comment |
| <strong>Member</strong> | 開同改 issue 同 comment；只可以刪自己嘅 |
| <strong>Project admin</strong> | Member 做得嘅全部，加上管理 project 成員、改或者刪任何嘢、無視 layer 鎖、upload model |
| <strong>Site admin</strong> | 所有 project；加、停用同 reset account；開、刪同還原 project |

每個 project 一定要留最少一個 project admin。

### Project 同成員

- <strong>Add people to this project：</strong> 搜尋，用 <strong>team</strong>、<strong>office</strong> 或者 <strong>company</strong> 篩選，剔幾個人（或者 <strong>Select all shown</strong>），揀 Role 再撳 <strong>Add N people</strong>；或者填 <strong>Someone without an account yet</strong>（Email、Name、Office、Company、Role）再撳 <strong>Create and add</strong>。臨時密碼只會顯示<strong>一次</strong>。
- 用 <strong>Email invitation</strong>（打開你自己嘅 Outlook）或者 <strong>Copy invitation</strong> 傳俾佢。佢第一次 sign in 要揀自己嘅密碼。
- 喺成員表改角色，或者 <strong>Remove</strong> 一個人（佢嘅 issue 同 comment 會留低）。
- <strong>Teams channel：</strong> 貼 Teams Workflow webhook 網址，<strong>Save</strong>，<strong>Send a test</strong>，再揀每週總結嘅日子同鐘數（香港時間）。
- <strong>Markup layers：</strong> 每個 layer 設定邊個改得（所有成員、只限 project admin，或者指定嘅人）、邊個睇得到，同埋開頭係咪隱藏。
- <strong>Phones and tablets：</strong> 如果手機話冇手機版，<strong>Prepare this project now</strong> 會重新整；<strong>Show progress</strong>（site admin）顯示 server 背後做緊嘅嘢。

### Projects（Admin &gt; Projects and members）

- <strong>+ New project</strong>：<strong>Project name</strong>（例如 HKA-P-01681-ARC - SKW；code 會由佢攞）、<strong>Code</strong>、<strong>Status</strong>、<strong>Group / team</strong>、<strong>Owners</strong>，同 <strong>Folders and files</strong>（OneDrive、SharePoint 或者 ACC 連結）。<strong>Import</strong> 讀由 Lark Base 或者 Excel export 嘅 project 表。
- <strong>Models and sheets：</strong> 顯示呢個 job 嘅 viewer project（export folder）。一個 job 有幾個 Revit model 同 sheet set（例如 Site 1 同 Site 2），就 Ctrl+click 揀幾個。揀一個其他地方用緊嘅會搬嚟呢度；server 單獨為佢整嘅項目會移除，佢嘅 task group 會跟住搬過嚟。
- 成員屬於每一個部分（係佢哋令人可以打開嗰個 model）。有幾個部分嘅話，成員表上面會出 <strong>Part</strong> 選擇。
- <strong>Remove from Projects</strong> 將一個 job 拎走出 Projects 版；佢嘅 task、issue、model 同檔案都會留低。

### 只限 site admin

- <strong>People：</strong> 加 account、<strong>Reset password</strong>、<strong>Make / Remove site admin</strong>、<strong>Deactivate / Reactivate</strong>（會喺所有地方 sign out 嗰個人）、<strong>Edit</strong>、<strong>Delete</strong>（整錯咗嘅 account 用）。
- <strong>Delete project ...：</strong> 打個 project 名確認。Model、sheet、issue、markup 同成員會搬去 server 嘅回收站；喺回收站清單撳 <strong>Restore</strong> 會全部放返，只要個名未被再用。
- <strong>Devices：</strong> 3D 版由每部裝置傳嚟嘅報告：載入咗乜、最高記憶體、frame rate、卡頓同 crash。篩選 crash 或者手機同平板，就知 viewer 喺邊度辛苦。
- <strong>Server：</strong> email 要 server 設定好 LWK_SMTP_。如果 server 前面嘅 proxy 處理唔到壓縮咗、瀏覽器保留嘅檔案，用 --plain-assets 開 server（或者喺 run.bat 設 PLAIN_ASSETS=1）。
