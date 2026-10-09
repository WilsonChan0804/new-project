# 解決問題同常見問題

大部分問題都係舊嘅 cache 版面、網絡慢或者部機記憶體唔夠；下面個表寫咗第一樣要試嘅嘢。

| 問題 | 試吓咁 |
|---|---|
| 啲嘢好似舊咗，或者冇咗新功能 | 睇左上角「LWK Viewer」隔籬嘅版本；按 Ctrl+F5（Windows）或者 Cmd+Shift+R（Mac）。iPad 就閂咗個 tab 再開過 |
| 「Wrong email or password」 | 檢查 email；叫 admin <strong>Reset password</strong>。試咗 10 次之後要等 15 分鐘 |
| 「You are not a member of this project」 | 叫 project admin 加你 |
| 我加唔到或者改唔到 issue | 你喺呢個 project 係 <strong>Viewer</strong>；叫 project admin 俾你做 Member |
| 「N waiting to save」 | 你個網絡斷咗。留住個版唔好閂；網絡返嚟就會儲存 |
| 最新嘅 sheet 或者 model 唔見 | Publish 可能仲做緊，或者 server 準備緊；等幾分鐘再 reload |
| 電腦上面 3D 好慢或者一頓頓 | 唔剔唔使用嘅 model、用 floor plan、檢查 <strong>While moving</strong> 係「follow the frame rate」 |
| iPad 或者 iPhone 自己 reload 個版 | 記憶體唔夠：開少啲 model、留喺一層、開住 <strong>Light mode</strong>；傳 Performance 報告 |
| 喺 section 入面撳唔到一個元件 | 只有切面睇得到嗰邊揀得；郁吓切面或者用 Model browser |
| 量度 snap 錯嘢 | Zoom 近啲；停定等 label 顯示 <strong>corner</strong>、<strong>midpoint</strong> 或者 <strong>edge</strong> |
| Revit link 唔見咗或者放錯位 | 檢查 <strong>Apply link transforms</strong> 開咗；話俾 BIM coordinator 知 |
| 轉咗 WebGPU 之後版面唔同咗 | 喺 Performance 撳 <strong>Drawing with</strong> 轉返 WebGL（或者喺網址加一次 &amp;gpu=webgl） |
| 經 VPN 或者喺屋企開版面好慢 | 第二次會快好多（啲檔案會留喺你個瀏覽器）。如果第一次開一直都慢，叫 IT 喺 server 嘅 proxy 開 HTTP/2 |
| 搜尋乜都搵唔到 | 最少打 2 個字；每個字都要對到。你只會見到你係成員嘅 project、list 同 chat |
| 「Revit's LWK add-in is not listening」 | 已經改為 copy 咗啲 id：喺 Revit 用 <strong>Manage &gt; Select by ID</strong> 貼上 |
| WhatsApp import：「does not look like a WhatsApp chat export」 | 用 WhatsApp 嘅 <strong>Export chat</strong> 檔（.txt 或者 .zip），唔好用截圖或者轉發嘅訊息 |
| Task 或者訊息連結打開唔到嘢 | 你可能唔係嗰個 list、chat 或者 project 嘅成員；問佢嘅 owner |
| 訊息或者 chat 冇 Delete | 訊息只有發嘅人刪得。Group 由佢嘅 admin 刪，project channel 同 topic 由 project 嘅 admin 刪 |

<strong>報告問題嗰陣</strong>請傳：project、版面（Sheets 定 3D）、你部機同瀏覽器、你做咗乜、截圖，3D 版就加埋 <strong>Performance → Copy</strong> 報告。

<strong>常見問題</strong>

- <strong>會唔會改到 Revit model？</strong> 唔會。Publish 只係讀個 model。只有 LWK Issues 視窗會加 pin 或者 cloud，而且係你叫佢先會做。
- <strong>邊個睇到我嘅 markup？</strong> Project 所有人，除非個 markup 喺 admin 限制咗嘅 layer 上面。
- <strong>會唔會發 email？</strong> 會，只要 server 設定好 mail：派 task、@mention、你 follow 緊嘅 task 有 comment 同完成，仲有每日到期 task 清單。Teams 照舊會 post。
- <strong>可唔可以離線用？</strong> 可以，用下載咗落部機嘅 project（睇「離線工作」）。短暫斷線都冇問題：改動會等住，網絡返嚟就儲存。
- <strong>Messenger 係咪取代 WhatsApp？</strong> 佢係用嚟做 project 嘢，就喺圖則同 task 隔籬。訊息可以傳去 WhatsApp，亦可以由 WhatsApp 帶入嚟，但兩邊唔會自動同步。
- <strong>顧問用唔用得？</strong> 用得，用佢哋自己嘅 account，通常只係嗰個 project 嘅 <strong>Viewer</strong> 或者 <strong>Member</strong>。
