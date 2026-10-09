# Sheets：2D 圖則

Sheets 版顯示每張 publish 咗嘅 sheet，係真正嘅 PDF，搜尋得到，即刻可以 markup；markup 自己會儲存，冇 Save 掣。

### 搵 sheet

- 左邊嘅 <strong>Sheets</strong> 清單顯示 sheet 編號同名。「x/y mapped」即係張 sheet 上面有幾多個 view 連咗去 3D model。
- 撳一張 sheet 就打開。Viewer 會記住你上次打開嘅 sheet。
- <strong>Search all sheets</strong> 搵 sheet 編號、名，同埋圖上面印住嘅任何字（房名、note、grid 編號）。搵到嘅會喺 sheet 上面 highlight。一個 project 第一次搜尋可能要等一陣，因為要讀晒啲圖。
- <strong>Page Down / Page Up</strong> 去下一張或者上一張 sheet。
- 要加外面嘅 PDF（顧問嘅圖、草圖），用 <strong>PDF</strong> upload 掣，再改個 <strong>set</strong> 名（例如「Uploaded PDFs」或者「Consultant 2026-10」）。每個 set 喺頂部 drop-down 入面、project 標題下面自己一項，同 Revit 嘅 sheet 分開。佢啲 sheet 會顯示「Imported 2D only」，撳 <strong>✕</strong> 就可以移除。

### 喺 sheet 上面移動

| 動作 | 滑鼠 | iPad / 觸控 |
|---|---|---|
| Zoom | 碌滑鼠轆（圍住游標 zoom） | 兩隻手指捏 |
| Pan | 㩒住中間掣，或者用 <strong>Pan</strong> 工具（H） | 兩隻手指；用過 Apple Pencil 之後，一隻手指就 pan |
| 成張 sheet | <strong>Fit</strong> | <strong>Fit</strong> |
| 轉張紙 | 工具列嘅 Rotate 掣 | 一樣 |
| 選單 | 撳右鍵 | 㩒住 |
| Undo / redo | Ctrl+Z / Ctrl+Y | 兩隻手指 tap / 三隻手指 tap |

### Sheet 有用嘅工具

- <strong>Split</strong> 喺隔籬打開第二張 sheet，有自己嘅 zoom。
- <strong>Links</strong> 將 section 標記、callout 同 elevation 標記變成連去佢哋 sheet 嘅連結；<strong>← back</strong> 返去。
- <strong>Compare</strong> 顯示同一張 sheet 之前 upload 嘅版本、另一張 sheet，或者你電腦入面一個 PDF 有乜唔同：紅色 = 刪咗，綠色 = 加咗。<strong>N / Shift+N</strong> 喺改動之間跳。
- <strong>2D + 3D</strong> 喺 sheet 隔籬打開 3D model。揀 <strong>Stand there</strong> 或者 <strong>Look at</strong>，然後撳 plan：3D 視圖就會去嗰個位。Plan 上面有個「你喺度」標記跟住 3D 鏡頭；剔 <strong>Follow</strong> 就會一直睇住佢，你喺唔同樓層之間行嘅時候會自動轉 plan。只有 plan view 有用，section 同 elevation 唔得。

### Markup 工具

| 類別 | 工具 |
|---|---|
| 形狀 | Rect、Circle、Line、Arrow、Cloud、Polyline、Polygon |
| 手寫 | Pen（一筆畫完之後停定唔郁，就會變成直線、圓或者長方形）、Highlighter |
| 文字 | Text、Text box、Callout |
| 印章 | APPROVED、APPROVED AS NOTED、REVISE &amp; RESUBMIT、REJECTED、REVIEWED、FOR INFORMATION、VOID（會簽上你個名同時間） |
| 量度 | Measure、Dimension、Area、Angle（用 <strong>1:</strong> 格入面嘅比例；空白就用 view 自己嘅比例） |
| 其他 | Snip（將一個範圍 copy 做圖片；亦可以貼圖入嚟）、Select text、Eraser、Match properties、Select、Pan |

- <strong>Polyline / Polygon：</strong> 撳啲點，然後按 Enter、double-click 或者 <strong>✓ Finish</strong>。Backspace 刪最後一點。
- <strong>Style bar：</strong> Layer、線／填色／文字顏色、Opacity、Weight（紙上 mm）、線 Type、Font、Size（字高 mm）、Align。
- <strong>改 markup：</strong> 揀一個 markup 就可以搬、改大細或者改樣式；R / Shift+R 轉 90°；Ctrl+C / Ctrl+V copy 同貼（貼去另一張 sheet 會喺同一個位置）；Delete 刪除。
- <strong>Comment 定 Issue：</strong> 頂部嘅 <strong>Comment / Issue</strong> 掣決定畫完 markup 之後做乜。喺 <strong>Issue</strong> 模式會即刻彈出 <strong>Raise issue</strong> 視窗。Comment 之後都可以用 <strong>Issue</strong> 或者右鍵 <strong>Raise issue</strong> 變成 issue。
- <strong>Layer：</strong> markup 放喺 layer 上面（預設「General」）。Admin 可以鎖 layer 或者唔俾某啲人睇到。眼仔掣會隱藏所有 markup。

### Export

- <strong>PDF</strong>（download）export 呢張 sheet、所有有 markup 嘅 sheet，或者全部 sheet；markup 可以係 <strong>Editable</strong>（Bluebeam、Acrobat 或 PDF-XChange 用嘅真 PDF comment）或者 <strong>Flattened</strong>，100、150 或 200 dpi，可以喺最尾加 issue 報告。
- <strong>JSON</strong>（download / upload）儲存或者載入所有 comment 同 issue，用嚟 backup 或者搬去另一個 project。
- <strong>BCF</strong> export sheet 嘅 issue 俾 Revit 或 Navisworks（睇「Issue 同 BCF」）。
