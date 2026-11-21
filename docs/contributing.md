---
tags:
  - GFA concession 樓面面積寬免
---
# Contributing 編寫指引

## Adding a new entry 新增條目 {#adding-a-new-entry}

1. Copy `templates/entry-template.md` into the right folder: `docs/pnap/`, `docs/regulations/` or `docs/codes/`.
   Name it by document number in lower case, e.g. `docs/pnap/app-2.md`.
2. Fill in **every** section in **both** English and 中文.
3. Add the page to `nav:` in `mkdocs.yml` and to the table on the section index page.
4. Get a colleague to check it against the official text, then fill in *Checked by*.

## Writing rules 編寫規則 {#writing-rules}

| Rule | 規則 |
|---|---|
| Quote **short** extracts only. Link to the official PDF for the full text. | 只節錄**簡短**原文，全文請連結官方檔案。 |
| Always state the **version** you summarised and the date you checked it. | 必須註明所摘要的**版本**及核對日期。 |
| For legislation, copy the **official Chinese text** from eLegislation. | 法例請引用電子版香港法例的**官方中文本**。 |
| For English-only PNAPs, label Chinese as **中譯（非官方）**. | 只有英文版的備考，中文須標明**非官方翻譯**。 |
| Put key numbers (%, m, m²) in **bold**, so they stand out in search results. | 關鍵數字以**粗體**標示。 |
| Use terms from the [Glossary 詞彙](glossary.md), and add new ones there. | 使用[詞彙表](glossary.md)用語，新詞請補充。 |
| Add **tags** in both languages, e.g. `GFA concession 樓面面積寬免`. | 標籤須中英並列。 |

## Figures and tables 圖表 {#figures-and-tables}

- **Tables with numbers** (e.g. First Schedule, Table C1): type them as Markdown tables so they can be **searched**, and add the original page as an image below for checking. 數字表格請以 Markdown 表格輸入以便搜尋，並附原文圖片供核對。
- **Diagrams**: crop the page from the official PDF and save it under `docs/assets/figures/<document>/`, e.g. `docs/assets/figures/app-152/fig-c1-c2-setback.jpg`. Always add a caption with the figure number and "Source: … Buildings Department". 圖則存放於 `docs/assets/figures/`，並註明出處。
- Use `??? abstract "…"` for long tables, so they are collapsed by default. 較長的表格可用摺疊方塊。

## When BD revises a document 文件修訂時 {#when-bd-revises-a-document}

1. Update the *Version summarised* and *Last checked* rows.
2. Review every section and note what changed under the info box, e.g. `!!! note "Changes in Jul 2025"`.

## Previewing locally 本機預覽 {#previewing-locally}

```bash
pip install -r requirements.txt
mkdocs serve
```

Then open <http://127.0.0.1:8000>.
