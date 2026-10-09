# Performance panel 同設定

3D 版右下角嘅 <strong>Performance</strong> 連結會打開載入時間、frame rate 同記憶體，仲有幾個設定；<strong>Copy</strong> 會將成份報告放入 clipboard，報告問題嗰陣可以貼落 email 或者 Teams。

| 設定 | 選擇 | 做乜 |
|---|---|---|
| <strong>Streaming</strong> | automatic / on / off | 大 model 跟住視圖需要一嚿嚿攞（automatic = 手機同平板開） |
| <strong>Memory budget</strong> | automatic / 150 至 1500 MB | 部機留幾多幾何先放走睇唔到嘅部分 |
| <strong>Drawing with</strong> | WebGL（標準）/ WebGPU（試驗） | 繪圖方法；轉嘅時候會 reload。除非叫你試，否則用 WebGL |
| <strong>While moving</strong> | follow the frame rate / always full quality | 郁嘅時候 frame rate 跌，就畫輕啲嘅郁動畫面；停定嘅畫面永遠係全質素 |

Streaming 同 memory budget 要 reload 個版先生效。狀態列亦會顯示即時 frame rate、畫咗幾多三角形同顯示卡記憶體；「moving step 1 to 4」即係用緊輕啲嘅郁動畫面。

<strong>載入速度</strong>

- Viewer 嘅檔案會壓縮咗先傳（3D library 由 4.8 MB 變 0.7 MB），而且你個瀏覽器會留低：由第二次開始，版面喺你自己部電腦打開，只有資料由 server 嚟。
- 每一版載入嗰陣會一次過攞晒佢要嘅資料。Messenger 同 Projects 版仲會即刻顯示上次見到嘅嘢，然後先更新。
- Viewer 更新之後，改咗嘅檔案會自己重新攞；唔會新舊混埋。
