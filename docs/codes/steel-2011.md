---
tags:
  - Code of Practice
  - Structural 結構
  - Steel 鋼結構
  - Loads 荷載
  - Fire resisting construction 耐火結構
  - Wind 風力
  - Concrete & materials 混凝土及物料
  - Curtain wall & façade 幕牆及外牆
  - Site supervision 地盤監督
summary: "Steel classes, design strengths, load factors and deflection and drift limits."
keywords: steel code, 鋼結構, S355, design strength, deflection limit, 撓度, drift, 位移, composite
---

# Code of Practice for the Structural Use of Steel 2011<br><small>《2011 年鋼結構作業守則》</small>

!!! info "Document info 文件資料"
    | | |
    |---|---|
    | **Edition 版本** | 2011 (2023 Edition); amendment **Apr 2026** 2026 年 4 月修訂 |
    | **Legal basis 法律依據** | Not statutory; compliance is **deemed to satisfy** the BO and [B(C)R](../regulations/bcr-123q.md) 符合即當作符合 |
    | **Companion 配套** | [Explanatory Materials (PDF)](https://www.bd.gov.hk/doc/en/resources/codes-and-references/code-and-design-manuals/EMSUOS2011e.pdf) |
    | **Source 原文** | [English (PDF)](https://www.bd.gov.hk/doc/en/resources/codes-and-references/code-and-design-manuals/SUOS2011.pdf) · [Apr 2026 amendment (PDF)](https://www.bd.gov.hk/doc/en/resources/codes-and-references/code-and-design-manuals/SUOS2011e_Amend202604.pdf) |
    | **Last checked 最後核對** | 2026-11-21 |

## At a glance 重點摘要 {#at-a-glance}

=== "English"

    - **Limit state design** of hot-rolled, cold-formed, high-strength and composite steel structures, plus connections, fire design, fabrication and erection, testing, and **existing structures**.
    - Steel **classes**: **Class 1** (certified to a reference standard, γm1 1.0); **Class 2** (known source, tested, γm1 1.1); **Class 3** (unknown source, py ≤ **170 MPa**, minor elements only); **Class 1H** high strength **460–690 MPa** (γm1 1.0); above 690 MPa only with BA approval.
    - Design strength falls with thickness, e.g. **S355**: 355 MPa (≤ 16 mm) down to 295 MPa (≤ 150 mm).
    - Load factors are as in the Concrete Code: **1.4 D + 1.6 I**, 1.4 D + 1.4 W, 1.2 (D + I + W).
    - **Deflection limits**: beams with brittle finishes **span/360**, other beams **span/200**, cantilevers **length/180**; building drift **H/500**, inter-storey **h/400**.

=== "中文"

    - 以**極限狀態**設計熱軋、冷軋、高強度及組合鋼結構，另含接駁、防火設計、製造安裝、測試及**現有結構**評估。
    - 鋼材**類別**：**第 1 類**（符合參考標準，γm1 1.0）；**第 2 類**（來源已知、經測試，1.1）；**第 3 類**（來源不明，設計強度上限 **170 兆帕**，只限次要構件）；**1H 類**高強度 **460–690 兆帕**（1.0）；超過 690 兆帕須建築事務監督批准。
    - 設計強度隨厚度遞減，例如 **S355**：≤16 毫米 355 兆帕，≤150 毫米 295 兆帕。
    - 荷載系數與混凝土守則相同：**1.4 恒 + 1.6 外加**、1.4 恒 + 1.4 風、1.2（三者）。
    - **撓度限制**：有易碎飾面的樑 **跨度/360**、其他樑 **跨度/200**、懸臂 **長度/180**；建築物頂層位移 **H/500**、層間 **h/400**。

## Contents 內容 {#contents}

| Section 章節 | Topic 主題 |
|---|---|
| 1–2 | General; limit state philosophy, robustness, **key elements** 總則、設計理念 |
| 3 | Materials: classes, grades, bolts, welds, **welding different grades** (2026) 物料 |
| 4 | Load and material factors 荷載及材料系數 |
| 5 | Serviceability: deflection, **wind-induced vibration and acceleration** (revised 2026), durability 使用極限狀態 |
| 6–8 | Analysis, section classification, member design (tension, compression, bending, combined) 分析及構件設計 |
| 9 | Connections: bolts, welds, base plates 接駁 |
| 10 | **Composite construction**: beams, slabs, **composite columns** (revised 2026) 組合結構 |
| 11 | Cold-formed open sections and profiled sheets 冷軋型材 |
| 12 | **Fire resistant design** 防火設計 |
| 13 | Performance-based design for special structures (glass, membranes, space frames) 性能化設計 |
| 14–15 | Fabrication, erection and tolerances 製造、安裝及公差 |
| 16 | Load tests 荷載測試 |
| 17 | Evaluation and **modification of existing structures** 現有結構評估及改動 |

## Material factors 材料系數 (Table 4.1) {#material-factors-table-41}

| Class 類別 | Yield 屈服強度 | γm1 | γm2 |
|---|---|---|---|
| 1 | ≤ 460 MPa | 1.0 | 1.1 |
| 2 | ≤ 460 MPa | 1.1 | 1.2 |
| 3 | py ≤ 170, Us ≤ 300 MPa | — | — |
| 1H | 460–690 MPa | 1.0 | 1.05 |

## Design strength py 設計強度 (Table 3.2, BS EN steels) {#design-strength-py-table-32-bs-en-steels}

| Thickness ≤ (mm) 厚度 | 16 | 40 | 63 | 80 | 100 | 150 |
|---|---|---|---|---|---|---|
| **S235** | 235 | 225 | 215 | 215 | 215 | 205 |
| **S275** | 275 | 265 | 255 | 245 | 235 | 225 |
| **S355** | 355 | 345 | 335 | 325 | 315 | 295 |

## Deflection limits 撓度限制 (Table 5.1) {#deflection-limits-table-51}

| Member 構件 | Limit 限制 |
|---|---|
| Beams with **plaster or brittle finish** (imposed load) 有易碎飾面的樑 | **Span/360** |
| Other beams 其他樑 | Span/200 |
| Cantilevers 懸臂 | Length/180 |
| Composite slab, imposed load 組合樓板 | Span/350 (≤ 20 mm) |
| Profiled sheeting during construction 施工時壓型鋼板 | Span/180 (≤ 20 mm), or /130 with ponding |
| Roof cladding / wall cladding 屋面／牆面覆蓋 | Span/90 / Span/120 (≤ 30 mm) |
| **Building drift at top** 頂層水平位移 | **Height/500** |
| **Inter-storey drift** 層間位移 | **Storey height/400** |
| Crane girders: vertical / horizontal 吊車樑 | Span/600 / Span/500 |
| Trusses 桁架 | Span/200 |

<small>Exceeding a limit needs full justification. Precamber may be deducted. Check long spans for vibration. 超出限制須全面論證。</small>

## April 2026 amendment 2026 年 4 月修訂 {#april-2026-amendment-2026-4}

- Definitions of Ys and Us clarified; welding between **different grades** of steel (cl. 3.4). 釐清定義；不同等級鋼材焊接。
- **Building acceleration limits** revised (cl. 5.3.4). 修訂建築物加速度限制。
- Lap joint and net-area equations corrected (Eq. 9.9, 9.10). 修正方程。
- **Composite columns**: classification, allowed grades, quality control of concrete-filled hollow sections, geometric ratios, design strengths, buckling curves (cl. 10.5, Tables 10.11, 10.13). 組合柱多項修訂。


<!-- CL START -->
## Related circular letters 相關通告函件 {#circular-letters}

- 🟢 [Qualified Supervision for Off-site Fabrication of Simple Structural Steel Elements](../circulars/2023.md#cl-qsofssse2023) <small>15 Dec 2023 · 為場外預製的鋼結構工程提供合格監督</small>
- ⚪ [Code of Practice for the Structural Use of Steel 2011 (2021 Edition)](../circulars/2021.md#cl-copsus2011-2021) <small>3 Sep 2021 · 《2011年鋼結構作業守則 (2021年修訂版)》</small>
- 🔵 [Amendments to Code of Practice for the Structural Use of Steel 2011](../circulars/2021.md#cl-acopsus2011-2021) <small>17 May 2021 · 《2011年鋼結構作業守則》修訂事宜</small>
<!-- CL END -->

## Related 相關文件 {#related}

[Dead & Imposed Loads](dil-2011.md) · [Wind Code](wind-2019.md) · [Concrete Code](concrete-2013.md) · [Glass Code](glass-2018.md) · [FS Code Part C](fsc-part-c-fire-resisting-construction.md)
