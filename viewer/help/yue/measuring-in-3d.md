# 喺 3D 量度

每個量度點都會 snap 去真實嘅角、邊或者中點，個 label 會話你知係邊種，你就知個數信唔信得過。

### 點樣量

1. 撳頂部嘅 <strong>Measure</strong>（或者右鍵 <strong>Measure</strong>），揀 <strong>Distance</strong>、<strong>Angle</strong> 或者 <strong>Area</strong>。
2. 將游標移過 model。彩色點同 label 會顯示下面 snap 到乜。
3. 撳第一點，再撳下一點。距離會跟住你郁即時更新，仲有佢嘅 <strong>plan</strong> 同 <strong>height</strong> 部分。
4. 按 <strong>Esc</strong> 放棄一個唔小心開始咗嘅量度。

| 模式 | 點數 | 結果 |
|---|---|---|
| <strong>Distance</strong> | 2 | 長度（1 m 以下用 mm，否則用 m），仲有 plan 同 height 部分 |
| <strong>Angle</strong> | 3 | 中間嗰點嘅角度 |
| <strong>Area</strong> | 3 至 64 | 多邊形面積（m²） |

### Snap

| 顏色 | Snap | 意思 |
|---|---|---|
| 紅色 | corner | 元件嘅一個頂點，或者 section 入面切口嘅角 |
| 紫色 | midpoint | 一條邊嘅中間 |
| 綠色 | perpendicular | 由你上一點到一條邊嘅垂直線落腳點 |
| 藍色 | edge | 一條邊上面任何一點 |
| 灰色 | surface | 附近冇特徵：面上面嘅點（冇咁準） |

- 每次 snap 到新嘢都會有個圈散開（手機會震），等你知捉到咗。
- 喺 floor plan 或者 section 入面，snap 會跟住切口輪廓，所以喺 plan 可以量牆到牆。
- 曲面係由好多細平面組成，所以暫時未有切線或者弧心 snap。

### Straight 同其他掣

- <strong>Straight</strong> 令下一點同上一點沿 X、Y 或者高度成一直線，量真正正交嘅距離。㩒住 <strong>Shift</strong> 就只係下一點轉換。
- <strong>Undo</strong> 刪最後一點，<strong>Clear</strong> 刪晒所有量度。
- <strong>Keep</strong> 將量好嘅距離儲存做 dimension，project 所有人都睇到。<strong>Dimensions</strong> 剔格顯示或者隱藏 keep 咗嘅 dimension，每個都可以撳 <strong>✕</strong> 刪除。
