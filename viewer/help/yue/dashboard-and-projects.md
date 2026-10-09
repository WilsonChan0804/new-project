# Dashboard 同 project

Dashboard 係 project 嘅 issue 計分板：幾多個未完成、幾多個過咗期、喺邊個手上，同埋今個星期有乜改變。

<strong>四圍行</strong>

- 每一版頂部都係同一排、同一個位置嘅頁面：<strong>Projects</strong>、<strong>Sheets</strong>、<strong>3D</strong>、<strong>Board</strong>、<strong>Tasks</strong>、<strong>Chat</strong>（有未讀訊息數目）同 <strong>Dashboard</strong>。右邊有：<strong>Search</strong> 放大鏡、<strong>+ Task</strong>（喺 Sheets 同 3D：將而家呢張 sheet 或者 3D 視圖放落 task）、<strong>Admin</strong>（只有 admin 見到）、<strong>Account</strong> 同 <strong>Sign out</strong>。手機上面呢排可以打橫碌。
- <strong>Project 下拉選單</strong>（Sheets、3D、Board、Dashboard）會列出 Projects 版嘅 project 名，例如「SKW · HKA-P-01681-ARC」。由幾個 model 組成嘅 project，例如 MOS Site 1 同 Site 2，會變成一組，下面列出佢嘅各部分。
- 連線標籤會顯示 <strong>online - 你個名</strong>、<strong>N waiting to save</strong>（斷咗線；你嘅改動排緊隊，有返線就會送出）或者 <strong>offline</strong>。有改動等緊儲存嘅時候唔好 reload：排緊隊嘅嘢只會保留到你離開嗰版為止。

<strong>Dashboard 顯示乜</strong>

| 部分 | 話俾你知 |
|---|---|
| 篩選 | <strong>Closed within</strong>（Any time 至 Last 12 months）、<strong>Type</strong>、<strong>Assigned to</strong>、<strong>Office</strong>、<strong>Only mine</strong>、<strong>Include "not an issue"</strong> |
| 今個星期 | 今個星期開咗、關咗、未完成同過咗期嘅 issue，同埋每個人手上未完成嘅 issue；<strong>Send to Teams</strong> 會貼去 project channel |
| 總結數字 | Issues、Open、In progress、Resolved、Closed、Overdue、7 日內到期、未指派、平均開咗幾多日、平均幾多日關 |
| 圖表 | 每星期開同關嘅數目（最近 12 個星期），按狀態、類型、優先次序、喺邊度開（sheet 或者 3D）同 office 分 |
| 責任表 | 每個負責人手上未完成、進行中、過咗期同就快到期嘅數目，最舊嘅未完成 issue 同最後活動；撳一行就會篩選 |
| 清單 | <strong>Overdue</strong>、<strong>Due in the next 14 days</strong>、<strong>Recently changed</strong>、<strong>Going quiet</strong>（14 日或以上冇郁過） |

- <strong>Export CSV</strong> 會下載篩選咗嘅 issue 俾 Excel 用。<strong>Report</strong> 會打開一份有相、可以列印嘅 issue 報告。
- 呢版每 2 分鐘自動更新；撳 <strong>Refresh</strong> 即刻更新。
- <strong>呢個 project 嘅 task：</strong> 如果呢個 project 喺 Projects 版上面，Dashboard 亦會顯示佢喺每個團隊 list 入面嘅 task：未完成、過咗期，同埋做咗幾多個 sub-task。

<strong>通知</strong>

- <strong>Email</strong>（server 設定好 email 嘅話）：有人將你設做 task 負責人、喺 task 或者 chat @mention 你、或者你 follow 緊嘅 task 有新留言或者完成咗，都會 email 你；每日仲會收到一封，列出聽日到期同已經過咗期嘅 task。
- <strong>Teams：</strong> 如果 admin 已經連接咗 project 嘅 Teams channel，issue 開咗、指派咗、改狀態或者限期、或者有新留言，都會貼去嗰度。留言入面嘅 @mention 會變成 Teams 嘅 mention。
- 每星期嘅總結可以貼去同一個 Teams channel（預設係星期一）。
- <strong>Messenger：</strong> project 嘅 channel 會用卡片顯示新 task、指派、完成同留言，同埋新開或者改咗嘅 issue。
