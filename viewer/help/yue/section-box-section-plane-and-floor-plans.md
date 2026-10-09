# Section box、section plane 同 floor plan

用 section box 將棟樓一部分切開，用 section plane 沿住任何一個面切；切到嘅實體會顯示橙色 hatch，好似圖則咁。

### Section 工具

| 掣 | 做乜 |
|---|---|
| <strong>Box</strong>（剔） | 開 section box，圍住成個 project |
| <strong>Plane</strong> | 撳一個面：model 就喺嗰個面切開 |
| <strong>Align</strong> | 撳一幅牆：個 box 會轉到同嗰幅牆對正 |
| <strong>Flip</strong> | 留 section plane 另一邊 |
| <strong>Reset</strong> | 移除所有切面 |
| <strong>Solid fill on the cut</strong> | 切到嘅牆、樓板同柱會顯示橙色 hatch（預設開） |
| <strong>Plan look for floor plans</strong> | 喺 floor plan 入面，表面淡啲，下面嘅樓層會淡出（預設開） |

Floor plan 下拉選單（睇「3D：四圍睇」）就係一層樓現成嘅 section box。

### 移動切面

- Box 每個面都有一粒<strong>有短柄嘅彩色點</strong>：紅色 X、綠色 Y、藍色高度。單一 section plane 係橙色點。
- <strong>滑鼠：</strong> 移到一粒點上面，或者切面嘅邊（個面會變橙色），然後拖。切面只會沿住自己嘅方向郁。
- <strong>iPad / iPhone：</strong> 一隻手指拖粒點。兩隻手指永遠係郁視圖、唔會郁切面，所以開住 section 都可以隨便捏同轉。
- 喺電腦上面，切面停定之後會有啡色線描出切口嘅邊。手機同平板只顯示 hatch。

### 方便嘅快捷

- 右鍵撳一幅牆或者樓板：<strong>Section on this face</strong> 就喺嗰度切；<strong>Square section box to this face</strong> 將個 box 對正佢。
- 右鍵撳空位：<strong>Turn section on/off</strong>。
