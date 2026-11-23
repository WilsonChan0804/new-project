---
tags:
  - Code of Practice
  - Structural 結構
  - Concrete & materials 混凝土及物料
  - Loads 荷載
  - Fire resisting construction 耐火結構
  - Site supervision 地盤監督
  - Curtain wall & façade 幕牆及外牆
summary: "Load and material factors, exposure and cover, span/depth ratios and high-strength concrete rules."
keywords: concrete code, 混凝土, cover, 保護層, exposure, grade, C30, reinforcement, 鋼筋, span depth ratio
---

# Code of Practice for Structural Use of Concrete 2013<br><small>《2013 年混凝土結構作業守則》</small>

!!! info "Document info 文件資料"
    | | |
    |---|---|
    | **Edition 版本** | 2013 (2020 Edition); amendments **Feb 2022**, **Jun 2023**, **Apr 2024** 已發出三次修訂 |
    | **Legal basis 法律依據** | Not statutory, but compliance is **deemed to satisfy** the BO and [B(C)R](../regulations/bcr-123q.md) 符合即當作符合 |
    | **Source 原文** | [English (PDF)](https://www.bd.gov.hk/doc/en/resources/codes-and-references/code-and-design-manuals/CoP_SUC2013e.pdf) · [Apr 2024 amendment](https://www.bd.gov.hk/doc/en/resources/codes-and-references/code-and-design-manuals/CoP_SUC2013e_amendment202404.pdf) · [Jun 2023](https://www.bd.gov.hk/doc/en/resources/codes-and-references/code-and-design-manuals/CoP_SUC2013e_amendment202306.pdf) · [Feb 2022](https://www.bd.gov.hk/doc/en/resources/codes-and-references/code-and-design-manuals/CoP_SUC2013e_amendment202202.pdf) |
    | **Last checked 最後核對** | 2026-11-21 against the 2020 Edition and the 2024 amendment |


!!! tip "Latest amendments 最新修訂"
    Amendments promulgated through [APP-142](../pnap/app-142.md#paragraph-detail): Feb 2022, Jun 2023 and Apr 2024 (Table 10.2 cube criteria, maturity method, strut-and-tie, nominal mixes). Check them with this page. 最新修訂見 APP-142。

## At a glance 重點摘要 {#at-a-glance}

=== "English"

    - **Limit state design** of reinforced and prestressed concrete with normal-weight aggregate, grades **C20 to C100**. Lowest grade for RC is **C20**; prestressed **above C30**.
    - **ULS load factors**: 1.4 Dead + 1.6 Imposed; 1.4 Dead + 1.4 Wind; 1.2 (D + I + W). Material factors γm: steel **1.15**, concrete **1.5**.
    - **Cover** depends on the **exposure condition** (1 mild to 5 abrasive) and grade. For example, mild exposure with C30 needs 30 mm; moderate exposure (fair-faced, curtain wall) with C35 needs 35 mm. Also check the [FS Code](fsc-part-c-fire-resisting-construction.md) cover for fire.
    - **High strength concrete** (> C60) needs **anti-spalling measures**: a mesh, ≥ **1.5 kg/m³** PP fibres, a protective layer or a proven mix. Above **C80**, a fire test is required.
    - **Ductility** detailing for beams, columns and walls (Section 9.9), **transfer structures**, and quality control of each stage of construction (Section 11).

=== "中文"

    - 以**極限狀態設計**鋼筋及預應力混凝土（一般骨料），強度等級 **C20 至 C100**；鋼筋混凝土最低 **C20**，預應力須**高於 C30**。
    - **極限狀態荷載系數**：1.4 恒載 + 1.6 外加荷載；1.4 恒載 + 1.4 風載；1.2（恒＋外加＋風）。材料系數：鋼筋 **1.15**、混凝土 **1.5**。
    - **保護層**按**暴露情況**（1 輕微至 5 磨損）及等級決定，例如輕微暴露 C30 為 30 毫米；中度（清水混凝土、幕牆）C35 為 35 毫米；另須符合[消防守則](fsc-part-c-fire-resisting-construction.md)的耐火保護層。
    - **高強度混凝土**（> C60）須有**防爆裂措施**：鋼絲網、每立方米 **1.5 公斤**以上聚丙烯纖維、保護層或經驗證配比；**C80 以上**須進行耐火測試。
    - 樑、柱、牆的**延性**構造（第 9.9 節）、**轉換結構**，以及施工各階段的質量控制（第 11 節）。

## Contents 內容 {#contents}

| Section 章節 | Topic 主題 |
|---|---|
| 1 | General, glossary, symbols 總則 |
| 2 | Basis of design: limit states, **robustness**, **ductility**, design working life, load factors 設計基礎 |
| 3 | Materials: concrete grades, elastic modulus, creep, shrinkage; reinforcement (Grade 500B/500C), **mechanical couplers** 物料 |
| 4 | Durability and fire resistance: **exposure**, **cover**, mix limits, chloride, anti-spalling 耐久性及耐火 |
| 5 | Structural analysis, including **transfer structures** 結構分析 |
| 6 | Ultimate limit states: beams, slabs, **flat slabs**, columns, walls, **beam-column joints**, **strut-and-tie** (2024) 極限狀態 |
| 7 | Serviceability: deflection (span/depth), cracking 使用極限狀態 |
| 8 | Reinforcement: spacing, anchorage, laps, bundled bars 鋼筋一般規定 |
| 9 | Detailing of members, ductility rules 構件詳細設計 |
| 10 | Specification, construction and workmanship 施工及工藝 |
| 11 | Quality assurance and quality control 品質保證 |
| 12 | Prestressed concrete 預應力混凝土 |
| 13 | Load tests 荷載測試 |

## Load and material factors 荷載及材料系數 (Tables 2.1–2.3) {#load-and-material-factors-tables-2123}

| Combination 組合 | Dead (adverse / beneficial) | Imposed | Earth & water | Wind |
|---|---|---|---|---|
| 1. Dead + imposed 恒載＋外加 | **1.4** / 1.0 | **1.6** / 0 | 1.4 | — |
| 2. Dead + wind 恒載＋風 | 1.4 / 1.0 | — | 1.4 | **1.4** |
| 3. Dead + imposed + wind 三者 | 1.2 / 1.0 | 1.2 / 0 | 1.2 | 1.2 |

| Fire limit state 火災極限狀態 | γf |
|---|---|
| Dead; permanent imposed (plant, storage); imposed in **escape stairs and lobbies** 恒載、永久外加、逃生樓梯 | 1.00 |
| Other imposed loads 其他外加荷載 | 0.80 (0.50 if justified) |
| Wind 風載 | 0.33 |

| γm | ULS 極限 | Fire 火災 |
|---|---|---|
| Reinforcement 鋼筋 | **1.15** | 1.00 |
| Concrete in flexure or axial load 混凝土受彎／軸力 | **1.50** | 1.10 |
| Shear without links 無箍筋抗剪 | 1.25 | 1.10 |
| Bond 黏結 | 1.40 | 1.10 |

<small>Accidental loads and localised damage: γf = 1.05. Vehicle impact on vertical elements: γf = 1.25. 意外荷載 1.05；車輛撞擊 1.25。</small>

## Exposure and cover 暴露情況及保護層 (Tables 4.1–4.2) {#exposure-and-cover-tables-4142}

| Exposure 暴露 | Examples 例子 |
|---|---|
| **1 Mild** 輕微 | Internal surfaces; external surfaces protected by tiles, paint or render; non-aggressive soil 室內、有飾面外牆 |
| **2 Moderate** 中度 | Bathrooms, kitchens; **fair-faced** concrete; concrete behind **dry-fixed cladding or curtain walls** 浴室、清水混凝土、幕牆後 |
| **3 Severe** 嚴重 | Sea spray near the coast; corrosive fumes 近海、腐蝕性氣體 |
| **4 Very severe** 非常嚴重 | Frequently in sea water, pH ≤ 4.5; tidal zone 海水、潮汐區 |
| **5 Abrasive** 磨損 | Machinery, metal tyres, water carrying solids 機械磨損 |

| Nominal cover (mm) 保護層 | C20/25 | C30 | C35 | C40 | C45 | C50 | ≥ C55 |
|---|---|---|---|---|---|---|---|
| 1 — slabs 樓板 | 30 | 30 | 25 | 25 | 25 | 25 | 25 |
| 1 — other members 其他 | 35 | 30 | 30 | 30 | 25 | 25 | 25 |
| 2 | — | 40 | 35 | 35 | 30 | 30 | 30 |
| 3 | — | — | — | 50 | 45 | 45 | 45 |
| 4 | — | — | — | — | — | 55 | 50 |
| Max. w/c ratio 水灰比 | 0.65 | 0.65 | 0.60 | 0.55 | 0.45 | 0.40 | 0.35 |
| Min. cementitious (kg/m³) | 290 | 310 | 330 | 350 | 375 | 400 | 400 |

- Actual cover ≥ nominal **− 5 mm**; cover ≥ main bar diameter and ≥ aggregate size. 實際保護層不少於標稱值減 5 毫米。
- Cast against earth: **75 mm**; against blinding: **40 mm**. 直接澆向泥土 75 毫米；墊層上 40 毫米。

## Deflection: basic span / effective depth 跨深比 (Table 7.3) {#deflection-basic-span-effective-depth-table-73}

| Support 支承 | Rectangular beam / slab 矩形樑／實心板 | Flanged beam (bw/b ≤ 0.3) 翼緣樑 |
|---|---|---|
| Cantilever 懸臂 | **7** | 5.5 |
| Simply supported 簡支 | **20** | 16 |
| Continuous 連續 | **26** | 21 |
| End span 端跨 | 23 | 18.5 |

<small>Then modify for tension and compression steel; spans over 10 m need a further check. 再按鋼筋修正；跨度超過 10 米另須驗算。</small>

## Amendments since the 2020 Edition 修訂 {#amendments-since-the-2020-edition}

- **Apr 2024**: maximum permanent elongation for couplers longer than **100 mm**; new **strut-and-tie** provisions (cl. 6.9); new column link details (Fig. 9.5 g–i); mix proportions for **≤ 20 MPa** concrete for minor structural and non-structural works (cl. 11.7.1); BS 8500 and BS EN 206 references updated. 機械接駁器、壓桿拉桿模型、柱箍筋、小型工程低強度混凝土。
- **Jun 2023** and **Feb 2022**: other clarifications; see the BD amendment PDFs. 其他修訂見原文。





<!-- CL START -->
## Related circular letters 相關通告函件 {#circular-letters}

- 🔵 [Amendments to Code of Practice for Structural Use of Concrete 2013 (2020 Edition)](../circulars/2022.md#cl-acopsus2013-2022) <small>23 Feb 2022 · 《混凝土結構作業守則2013年（2020年修訂版）》修訂事宜</small>
- 🔵 [Code of Practice for Structural Use of Concrete 2013 (2020 Edition)](../circulars/2020.md#cl-copsuc2013-2020) <small>29 Dec 2020 · 《混凝土結構作業守則2013年（2020年修訂版）》</small>
- 🔵 [Amendments to Code of Practice for Structural Use of Concrete 2013](../circulars/2020.md#cl-acpsuc2013-2020) <small>24 Nov 2020 · 《混凝土結構作業守則2013年》修訂事宜</small>
- 🔵 [Code of Practice for Structural Use of Concrete 2013 Construction Standard CS2:2012 – Steel Reinforcing Bars for the Reinforcement of Concrete](../circulars/2018.md#cl-srbrc) <small>31 Oct 2018 · 《2013年混凝土結構作業守則》建築標準CS2:2012–用於混凝土的鋼筋</small>
- 🔵 [Amendments to Code of Practice for Structural Use of Concrete 2013](../circulars/2017.md#cl-acopsuc2013-2017) <small>13 Jun 2017 · 《混凝土結構作業守則2013年》修訂</small>
- ⚫ [Code of Practice for Structural Use of Concrete 2013 Construction Standard CS2:2012 – Steel Reinforcing Bars for the Reinforcement of Concrete](../circulars/2016.md#cl-copsuc2013cs-a) <small>28 Nov 2016 · 2013年混凝土結構作業守則建築標準CS2:2012–用於混凝土的鋼筋</small>
- 🔵 [Code of Practice for Structural Use of Concrete 2013 Construction Standard CS2:2012 – Steel Reinforcing Bars for the Reinforcement of Concrete](../circulars/2016.md#cl-copsuc2013cs) <small>22 Sep 2016 · 2013年混凝土結構作業守則建築標準CS2:2012 –用於混凝土的鋼筋</small>
- 🔵 [Code of Practice for Structural Use of Concrete 2013 Construction Standard CS2:2012 – Steel Reinforcing Bars for the Reinforcement of Concrete](../circulars/2016.md#cl-srbrc2016) <small>26 Aug 2016 · 2013年混凝土結構作業守則建築標準CS2:2012 – 用於混凝土的鋼筋</small>
- 🟢 [Use of Off-site Prefabricated Steel Reinforcing Bar Products](../circulars/2016.md#cl-uopsrbp2016) <small>14 Apr 2016 · 使用工地外預製鋼筋組件</small>
- 🟢 [Quality Scheme for the Production and Supply of Concrete 2014](../circulars/2015.md#cl-qspsc2014) <small>25 Mar 2015 · 2014 年混凝土生產和供應質量規範</small>
<!-- CL END -->

## Related 相關文件 {#related}

[Dead & Imposed Loads](dil-2011.md) · [Wind Code](wind-2019.md) · [Precast Concrete Code](precast-2016.md) · [Foundations Code](foundations-2017.md) · [FS Code Part C](fsc-part-c-fire-resisting-construction.md) · [Site Supervision Code](site-supervision-2009.md) · [B(C)R](../regulations/bcr-123q.md)
