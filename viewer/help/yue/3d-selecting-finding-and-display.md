# 3D：揀、搵同顯示

撳任何元件就睇到佢係乜；用 Model browser 可以按名、type、樓層或者 property 搵元件。

### Selection panel

撳一下會顯示元件嘅 <strong>Model</strong>、<strong>Category</strong>、<strong>Family / type</strong>、<strong>Level</strong>、<strong>Revit id</strong>（ElementId）、<strong>UniqueId</strong>、<strong>IFC GUID</strong>、撳中嘅 <strong>Point</strong>（x、y、z，單位米）同 <strong>Shared E,N,Z</strong>（測量座標），跟住係佢所有 Revit parameter，分組可以收埋。

- <strong>Copy Revit ID</strong> copy ElementId；喺 Revit 用 <strong>Manage &gt; Select by ID</strong> 貼上，就會揀中同一個元件。<strong>Show in Revit</strong> 叫 LWK add-in 喺 Revit 揀佢（睇「Revit 元件」）。<strong>+ Task</strong> 將個元件放落一個 task。
- <strong>Isolate</strong> 只顯示揀咗嘅元件。<strong>Hide</strong> 隱藏佢哋。<strong>Show all</strong> 全部返嚟。有個數字顯示隱藏咗幾多個。
- Hide 同 isolate 只會改你自己嘅視圖，乜都冇刪到。

### Elements panel

每個 category 一個剔格（Walls、Floors and slabs、Columns、Windows、Doors、Furniture、Railings...），有數目。唔剔一個 category 就隱藏佢；<strong>Show all</strong> 全部開返。你揀咗乜會記住。

### Model browser

- 一個樹狀清單：<strong>model › category › family / type › 元件</strong>。撳一行打開佢同揀成組；撳一個元件會 highlight 同 zoom 埋去。
- <strong>Search names, types, levels, properties</strong>：普通字會對 name、category、family、type 同 level。用 <strong>property:value</strong> 對一個 parameter，例如 Fire Rating:2 hr 或者 Mark:D101。
- <strong>Select</strong> 將搵到嘅上色，<strong>Isolate</strong> 只顯示佢哋，<strong>Zoom</strong> 放晒入畫面。<strong>Select</strong> 之後，頂部嘅 <strong>+ Task</strong> 會將所有揀咗嘅元件放落 task 做「Elements to change」，<strong>Copy Revit ID</strong> 會 copy 晒佢哋嘅 id。
- Browser 用喺 fast 3D 格式 publish 嘅 model（即係正常 Publish to Viewer 出嚟嘅）。

### Display

| 模式 | 用嚟 |
|---|---|
| <strong>Shaded</strong> | 正常睇，用 model 自己嘅顏色 |
| <strong>White</strong> | 乾淨、冇顏色，啱 review 同截圖 |
| <strong>X-ray</strong> | 透過牆同樓板睇到入面 |

<strong>Display</strong> panel 仲可以設定背景顏色、地面（開關同顏色）同 grid。

### Saved views

- <strong>Save</strong>（或者右鍵 <strong>Save view...</strong>）會連名同縮圖儲存鏡頭、section 同隱藏咗嘅元件。Saved view 成個 project 都睇到。
- 撳一個 saved view 返去嗰度；<strong>✕</strong> 刪除。
- 由 3D 去 Sheets 再返嚟，你上次嘅 3D 視圖會原封不動咁返嚟。
