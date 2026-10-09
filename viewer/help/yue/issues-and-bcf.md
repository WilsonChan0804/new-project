# Issue 同 BCF

Issue 係一個 markup 或者 3D 嘅一點，有標題、類型、負責人、到期日同對話；server 會幫佢編號（#N），同一個 issue 會喺 Sheets、3D、Dashboard 同 Revit 出現。

### 開 issue

| 喺邊 | 點做 |
|---|---|
| 喺 sheet 上面 | 將頂部轉做 <strong>Issue</strong> 再畫 markup；或者揀一個 markup 撳 <strong>Issue</strong>；或者右鍵撳佢揀 <strong>Raise issue</strong>。會自動夾一張清晰嘅圖則截圖：直接由 PDF 用大約 200 dpi 畫出嚟，唔受你放大幾多或者電腦嘅速度設定影響。 |
| 喺 3D | 撳 <strong>Add issue</strong>，然後撳個位（iPad：㩒住）。鏡頭、section 同隱藏咗嘅元件會一齊儲存，仲會夾一張截圖。<strong>Mark up snapshot</strong> 俾你喺張相上面畫嘢（cloud、箭咀、文字等等）。 |

填好 issue 視窗，然後撳 <strong>Save issue</strong>：

| 欄 | 備註 |
|---|---|
| <strong>Title</strong> | 一定要填，最多 120 個字。寫清楚咩問題、喺邊，例如「L12 corridor: fire door swing clashes with riser」 |
| <strong>Type</strong> | General、Design、Coordination、Clash、Fire safety、Statutory / BD、Structure、MEP、Facade、Drawing error、Query / RFI |
| <strong>Description</strong> | 咩問題、你預期係點、有咩參考 |
| <strong>Assign to</strong> | 揀一個 project 成員（或者打個名） |
| <strong>Due</strong> | 幾時要有答覆 |
| <strong>Status</strong> | Open、In progress、Resolved、Closed |
| <strong>Priority</strong> | Low、Normal（預設）、High、Critical |
| <strong>Template</strong> | 載入一套儲存咗嘅欄位；<strong>Save as template</strong> 將而家嘅分享俾成個 project |

### 跟進 issue

- 喺清單撳一個 issue（或者 3D 入面佢支 pin）打開佢。喺 3D，視圖會返去開 issue 嗰個人見到嘅樣：同一個眼位同方向、section box 連佢嘅角度（或者 section plane）、隱藏咗嘅元件、平行定透視，同 floor plan。<strong>Show in view</strong> 同 issue 連結都一樣。
- <strong>喺 Revit</strong>（LWK Issues &gt; <strong>Go to</strong>）：用 viewer 普通鏡頭、或者行緊（walk）時開嘅 issue，會喺一個透視鏡頭視圖 <strong>LWK Issue - &lt;你&gt; (camera)</strong> 由同一個眼位打開，連埋同一個 section box，唔再係由外面睇成棟樓。
- 喺 issue 視窗：改標題同欄位、<strong>Add photo</strong>（地盤相，可以一次加幾張），喺 <strong>Add a comment</strong> 寫低再撳 <strong>Comment</strong>。打 <strong>@</strong> 可以 mention project 成員。
- <strong>Show in view</strong> 返去嗰個位；<strong>Show in 3D</strong> 喺嗰度打開 3D 版。
- <strong>Not an issue</strong> 會連一個人人睇到嘅原因閂咗佢；同一個掣可以重開。
- <strong>Delete</strong> 會幫所有人刪除。Member 只可以刪自己嘅 issue；project admin 刪得任何一個。
- <strong>Revit element</strong>（3D issue）：開 issue 嗰個元件，有 <strong>Copy Revit IDs</strong>、<strong>Show in 3D</strong> 同 <strong>Show in Revit</strong>。
- <strong>Tasks：</strong> 連住呢個 issue 嘅 task，有負責人同到期日。<strong>+ New task from this issue</strong> 開一個（睇「Issue 同 task 連埋一齊」）；<strong>Send to chat</strong> 將 issue 貼去一個 chat。
- 將狀態改做 <strong>Resolved</strong> 或者 <strong>Closed</strong> 再撳 <strong>Save</strong>：如果 issue 嘅 task 仲未完成，viewer 會問你要唔要順手剔佢哋做完成。

### 狀態：邊個做乜（團隊做法）

| 狀態 | 邊個改 | 意思 |
|---|---|---|
| Open | 開 issue 嘅人 | 開咗，等負責人跟 |
| In progress | 負責人 | 做緊 |
| Resolved | 負責人 | 改好或者答咗；等開 issue 嘅人檢查 |
| Closed | 開 issue 嘅人或者 project admin | 檢查過，搞掂 |

### 搵 issue

- <strong>Sheets：</strong> 右邊 panel 列出 <strong>All / Issues / Comments</strong>，可以按 Sheet、Status、Assigned to、Raised by、View、Issue type 或者 Markup type 分組，有 <strong>Search</strong> 格。右鍵撳一項可以打開、喺 sheet 或者 3D 顯示，或者改狀態。
- <strong>3D：</strong> <strong>Issues in 3D</strong> 按 Status、Floor、Issue type、Assigned to、Raised by 或者 Model 分組。<strong>Sheet issues</strong> 會將喺 sheet 開嘅 issue 用菱形顯示喺 model 入面。<strong>Hide issues</strong> 隱藏啲 pin（乜都冇刪）。
- <strong>Dashboard：</strong> 篩選、過咗期清單同責任表（睇「Dashboard 同 project」）。

### BCF：同 Revit、Navisworks 等等交換 issue

- <strong>Export BCF</strong>（3D 版）同 <strong>BCF</strong>（Sheets 版）會下載一個 BCF 2.1 檔，入面有每個 issue 嘅標題、狀態、優先次序、日期、作者、負責人、描述、鏡頭、揀咗嘅元件同截圖。冇 issue 嘅普通 comment 唔會包括，issue 類型、comment 對話同加咗嘅相都唔會包括。
- 揀咗嘅元件會連佢嘅 IFC GUID <strong>同 Revit ElementId</strong>（AuthoringToolId）一齊寫入，所以 Autodesk BCF Manager、BCFier 同 Revizto 呢啲 Revit BCF 工具會喺 Revit 揀中佢。
- <strong>Import BCF</strong>（只限 3D 版）讀 Revit、Navisworks、Solibri 或者 ACC 嘅 BCF 2.0、2.1 同 3.0。佢會先問個檔用邊套座標：除非你知，否則揀 <strong>Work it out (recommended)</strong>。已經 import 過（同一個 ID）嘅 issue 會跳過。
