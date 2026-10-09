# 3D：四圍睇

3D 版嘅滑鼠用法同大部分 BIM viewer 一樣：右掣轉、中間掣 pan、轆 zoom、左掣揀。

### 滑鼠、觸控同鍵盤

| 動作 | 滑鼠 | iPad / iPhone |
|---|---|---|
| Orbit（轉） | 㩒住右掣拖 | 一隻手指 |
| Pan | 㩒住中間掣（轆）拖 | 兩隻手指 |
| Zoom | 碌滑鼠轆（向住游標） | 兩隻手指捏 |
| 對準一個面 | Double-click 佢 | Double tap |
| 揀一個元件 | 左掣撳 | Tap |
| 設定轉嘅中心 | 右鍵撳唔好拖，或者右鍵選單 <strong>Set orbit centre here</strong> | - |
| 動作選單 | 撳右鍵 | - |
| 喺一個位開新 issue | <strong>Add issue</strong>，然後撳 | 㩒住（0.6 秒） |
| 上一層／下一層 | Page Up / Page Down | Floor plan 清單 |
| 取消量度或者行 | Esc | Stop 掣 |

用滑鼠嘅話，你一放手畫面就停喺嗰度；用手指會滑多少少，同其他平板 app 一樣。

### 右鍵選單

喺元件上面：<strong>Set orbit centre here</strong>、<strong>Zoom to this element</strong>、<strong>Isolate</strong>、<strong>Hide</strong>、<strong>Show all</strong>、<strong>Walk from here</strong>、<strong>Add issue here</strong>、<strong>Section on this face</strong>、<strong>Square section box to this face</strong>、<strong>Turn section on/off</strong>、<strong>Measure</strong>、<strong>Save view...</strong>、<strong>Fit model</strong>。喺空位：Show all、Turn section on/off、Measure、Save view...、Fit model。

### View cube 同鏡頭

- 撳 cube 嘅一個<strong>面</strong>睇嗰個方向，撳一條<strong>邊</strong>睇兩個面之間，撳一個<strong>角</strong>睇 isometric。拖個 cube 可以轉。下面個圈顯示北面。
- 屋仔掣返去 3D 全景。<strong>Fit</strong> 將所有載入咗嘅 model 放晒入畫面。
- <strong>Perspective / Parallel</strong> 轉投影方式（plan 永遠係 parallel）。
- <strong>Set front：</strong> 撳一幅牆話俾 cube 知呢棟樓邊面係「Front」；<strong>World</strong> 返去世界軸。

### 樓層

- <strong>Floor plan</strong> 下拉選單列出 <strong>Whole building</strong> 同由上至下每一層。
- 揀一層就會由嗰層樓面以下 0.5 m 切到以上 1.2 m，再由上面直望落去，好似 Revit 嘅 plan 咁。
- <strong>Page Up / Page Down</strong> 上落一層；<strong>Whole building</strong> 返去成個 3D model。
- <strong>Drawing</strong> 將嗰層嘅 plan sheet 鋪喺 model 上面，等你對比圖同 model。

### Models panel

- 每個 model（主 model 同每個 link）一個剔格。唔剔就會隱藏個 model，慳返記憶體；<strong>All on / All off</strong> 一齊開關，視圖唔會變。
- Model 隔籬嘅 <strong>▸</strong> 顯示佢嘅大細同副本數目，仲有 <strong>Compare with previous export</strong>，睇上次 publish 之後加咗、改咗或者刪咗乜。
- <strong>Apply link transforms</strong>（開咗）會將 link 放喺 Revit 入面嘅位置。
- <strong>Light mode (phones, tablets)</strong> 只會喺你望緊嘅附近載入重複嘅標準層。手機同平板預設開咗。
- 每個 panel 嘅標題（Models、Section、Measure 等等）撳一下就收埋，下次都會保持收埋。
