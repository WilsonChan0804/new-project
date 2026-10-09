# Revit 元件

3D issue 會記住開 issue 嗰個 Revit 元件：<strong>ElementId</strong>、<strong>UniqueId</strong>、IFC GUID、category、family / type 同樓層。由 LWK add-in publish 嘅 model 全部都知；舊啲嘅 model 只有 IFC GUID。

| 想 | 咁做 |
|---|---|
| 而家喺 Revit 揀中佢 | <strong>Copy Revit ID</strong>（或者 <strong>Copy Revit IDs</strong>），然後喺 Revit 用 <strong>Manage &gt; Select by ID</strong> 貼上。今日已經用得，唔使改 add-in |
| 喺 3D 睇佢 | <strong>Show in 3D</strong>：3D 版會揀出嗰啲元件再 zoom 埋去 |
| 叫 Revit 揀佢 | <strong>Show in Revit</strong> 叫 LWK add-in 喺 Revit 揀中佢。Add-in 未支援之前，會改為 copy 啲 id 俾你用 Select by ID |
| 交俾同事 | 喺 3D 版揀元件再撳 <strong>+ Task</strong>：佢哋會放落 task 做 <strong>Elements to change</strong>，有同樣嘅掣 |
| 傳去其他軟件 | <strong>Export BCF</strong>：Revit 嘅 BCF 工具會用 ElementId 揀中個元件 |
