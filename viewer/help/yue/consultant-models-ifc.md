# 顧問嘅 model（IFC）

其他公司（結構、MEP、室內、幕牆）嘅 model 可以同 project 自己嘅一齊睇。叫佢哋俾 <strong>IFC</strong>（IFC 2x3 或者 IFC4）：SketchUp、Revit、Tekla、ArchiCAD 同 Rhino 全部都出得，而且保留晒元件、屬性同真實座標。（「WebGL」係瀏覽器畫圖嘅方法，唔係用嚟交換嘅檔案格式。）

| 用法 | 點做 |
|---|---|
| 加入呢個 project 嘅 3D | <strong>Models</strong> panel &gt; <strong>+ Consultant model (IFC)</strong>：揀 .ifc，填名、公司同專業，撳 <strong>Upload and convert</strong>。Server 會轉換（有進度條），完成後就喺 <strong>Consultant models</strong> 出現 |
| 疊另一個 project 嘅 model | <strong>+ Overlay another project</strong>：揀一個你開得嘅 project 同佢其中一個 model。會用兩個 project 共用嘅 shared coordinates 擺位 |
| 自己一版 3D | Admin 用 <strong>New 3D project from IFC</strong>（Admin 版）開。座標同乜都對唔上嘅 model 用：做一個獨立參考，之後一樣可以疊落其他 project |

- 每個顧問 model 有剔格（你自己開／關）同一條可以調透明嘅 slider。
- <strong>整體上色，方便比較：</strong> 顧問 model 隔籬（同 <strong>Models</strong> 清單每個 model 隔籬）嘅小圓圈，可以將成個 model 變一隻顏色 - 紅、橙、黃、綠、青、藍、紫、灰或者任揀 - 例如自己 project 灰色、結構紅色。<strong>↺ Original colour</strong>（顏色選單入面，或者上咗色嘅 model 隔籬個 <strong>↺</strong>）變返原色；Models panel 頂部嘅 <strong>↺ Reset colours</strong> 一次過將所有 model 變返原色。會記喺呢部機，可以同透明 slider 一齊用，<strong>White</strong> 模式都保留顏色。
- 用 <strong>No coordinates: set in the middle</strong> 擺位嘅 model，位置會為所有人記住，手機都一樣 - 手機載入嘅 link model 少啲，以前會因此計錯位置。
- <strong>Place</strong>（加佢嗰個人或者 project admin）幫所有人設定擺喺邊：<strong>Shared coordinates</strong>（有協調座標嘅顧問就係呢個）、<strong>This model's origin</strong>，或者 <strong>No coordinates: set in the middle</strong>；再用 <strong>East / North / Up</strong>（mm）同 <strong>Turn</strong>（°）一路睇一路手動移。<strong>Save for everyone</strong> 儲存；<strong>Cancel</strong> 放返原位。
- 佢嘅元件一樣撳得，一樣可以開 issue。
- <strong>×</strong> 由 project 移除（加佢嗰個人或者 project admin）。
