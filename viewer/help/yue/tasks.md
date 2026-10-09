# Tasks 工作

<strong>Tasks</strong> 係團隊嘅 task list，取代 Lark Tasks，同圖則、model 同 issue 連埋一齊。

### List、group 同睇法

- <strong>Task list</strong> 屬於一個團隊（例如 LWK-MANILA）。List 入面嘅 <strong>group</strong> 通常就係各個 job（SKW、Kai Tak 2A3 ...）。連咗 project 嘅 group 會有 <strong>Project</strong>、<strong>Sheets</strong> 同 <strong>Dashboard</strong> 掣；喺 <strong>...</strong> &gt; <strong>Groups and projects</strong> 連接。
- 左邊嘅<strong>快速存取</strong>：<strong>Owned</strong>（自己未完成嘅 task）、<strong>Subscribed</strong>、<strong>All</strong>、<strong>Created</strong>、<strong>Assigned</strong>（你派俾人嘅）同 <strong>Completed</strong>，跨晒所有你睇得到嘅 list。<strong>People</strong> 按團隊、office 或者公司顯示成個機構，同每個人未完成同過咗期嘅 task。
- <strong>List：</strong> 分組嘅表。直接喺度改；撳 ▸ 打開 sub-task；拖住一行可以排次序或者搬去另一個 group。有連住 issue 嘅 task 會顯示 <strong>#2 open</strong>，全部 issue 解決咗就變 <strong>#✓</strong>。
- <strong>Kanban：</strong> 一行行卡片；拖張卡去另一行。成塊 board 跟視窗咁高，所以左右嘅 scroll bar 永遠喺畫面底，唔使拉到最底先見到；<strong>Shift + 滑鼠轆</strong>、拖 board 嘅空位，或者兩邊嘅 <strong>‹ ›</strong> 掣都可以左右捲。
- <strong>Gantt：</strong> 時間線上面嘅橫條；拖成條，或者拖佢兩頭改日期。每次改之前會彈出 <strong>Change the dates?</strong> 問你：<strong>Save</strong> 先會儲存，<strong>Cancel</strong> 條 bar 就返原位（剔 <strong>Don't ask again today</strong>，呢部機今日就唔再問）。圖例會解釋啲顏色；milestone 係金色。
- <strong>Dashboard：</strong> 總數、完成、未完成同過咗期，按負責人、按 project、平均用幾耐同就快到期。<strong>Activities：</strong> 所有改動，邊個改。
- 可以按負責人同優先次序篩選、排序、<strong>Group by</strong>，同用 <strong>Customize</strong> 揀顯示邊啲欄。每個 list 可以有自己嘅欄（人、選項、文字、日期、數字），例如 Modelers 同 Project Manager。

### 一個 task

- 撳一個 task 打開佢嘅視窗：標題、<strong>Owners</strong>、開始同到期 <strong>Dates</strong>、<strong>Group</strong>、<strong>Priority</strong> 同 list 自己嘅欄。<strong>Mark complete</strong> 就完成。
- <strong>完成方式（Completion method）：</strong> <strong>OR</strong> = 任何一個負責人完成就算完成；<strong>AND</strong> = 每個負責人都要完成自己嗰部分。
- <strong>Sub-task：</strong> 喺 <strong>+ Add sub-task</strong> 打字再按 Enter。好似 Lark 咁，sub-task 下面可以再有 sub-task，最多 5 層：打開個 sub-task 喺佢入面加，或者喺 List 撳行尾出現嘅 <strong>+</strong>。將一個 task 拖去另一個 task 標題嘅右半邊放手，就變成佢嘅 sub-task。刪一個 task 會連佢下面所有嘢一齊刪（<strong>Ctrl+Z</strong> 可以全部攞返）。
- <strong>相連嘅 issue</strong> 會顯示佢而家嘅狀態（Open、In progress、Resolved）。<strong>+ Link an issue</strong> 可以揀 project 嘅一個 issue。
- <strong>檔案、sheet 同 3D 視圖：</strong> 貼 OneDrive、SharePoint 或者 ACC 網址，或者喺 Sheets 或 3D 版撳 <strong>+ Task</strong>，將你睇緊嘅 sheet 或者視圖放落 task。放咗落 task 嘅 Revit 元件會顯示做 <strong>Elements to change</strong>。
- <strong>留言：</strong> @名 可以通知人；可以貼截圖或者夾檔案（每個最大 50 MB）。自己嘅留言有 <strong>edit</strong> 同 <strong>delete</strong>。
- <strong>Follow</strong> 之後 task 有改動會 email 你；<strong>Share</strong> 會傳去一個 chat；連結掣會 copy 佢嘅網址。
- ▲ ▼ 掣，或者 <strong>K</strong> / <strong>J</strong>，去上一個／下一個 task。手機上面撳 <strong>Back</strong> 返去清單。

### List 嘅成員

- <strong>Owner</strong>（改 list 設定同成員）、<strong>Editor</strong>（加同改 task）同 <strong>Viewer</strong>（只可以睇）。Site admin 睇到所有 list。

### 由 Lark import

1. 喺 Lark 打開個 task list，揀 <strong>...</strong> &gt; <strong>Export</strong>（Excel）。
2. 喺 Tasks 用 <strong>+</strong> &gt; <strong>Import a Lark task list (.xlsx)</strong> 開一個新 list，或者用 <strong>...</strong> &gt; <strong>Import from Lark (.xlsx) / CSV</strong> 放入而家打開緊嘅 list。
3. Group、sub-task、負責人、follow 嘅人、日期、完成狀態、優先次序、完成方式、milestone、Modelers 同 Project Manager 全部都會帶入嚟，每個 task 仲有一條連返去 Lark 嘅連結。
4. 再 import 同一個 export 會更新啲 task，唔會重複加。未有 account 嘅人名會照保留；account 開好之後用 <strong>...</strong> &gt; <strong>Match names to accounts</strong>。
