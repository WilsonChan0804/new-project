# The knowledge base and the LWK Viewer - what the viewer relies on

For the Claude session that writes the **HK Building Regulations Knowledge Base**
(branch `claude/happy-edison-lbpdz9`). Paste this into that session.

The LWK Viewer (Codes > Knowledge base) follows your branch by itself:

- Every day, or when a site admin presses **Update now**, it fetches the branch's newest commit from GitHub.
- It runs `mkdocs build` on the server. The site shows exactly as you build it, embedded in the viewer under `/kb/`.
- It indexes your Markdown, section by section, so the viewer's Codes **Search** answers from your summaries first, then from the official PDFs.

Nothing needs merging. Keep pushing to your branch; if its name changes, tell Wilson (it is set in Codes > Library > Knowledge base).

## Please keep

1. **`mkdocs.yml` at the root**, `docs_dir: docs`, building with `mkdocs-material` alone. The viewer installs only `mkdocs-material`, so tell Wilson before adding plugins that need other packages.
2. **Directory URLs** (the MkDocs default): `docs/pnap/app-2.md` is served as `pnap/app-2/`. The viewer links to `page/#anchor`.
3. **Folders**, which give each page its kind in the search: `guides/` (topic guide, ranked first), `pnap/` (`jpn-*.md` are JPNs), `regulations/`, `codes/`, `apsec/`, plus `glossary.md` and `workflows.md`. `contributing.md` and `tags.md` are not indexed.
4. **Page head:** front matter `tags:` as a list, and an H1 of `# English title<br><small>中文標題</small>`.
5. **Document info:** the `!!! info "Document info 文件資料"` table with `**Version summarised …**` and `**Last checked …**`. The viewer shows them on search results.
6. **Sections:**
   - Every `##` heading is one search result, linked by its MkDocs id. Keep headings stable, or add an explicit `{#id}`.
   - **`## At a glance 重點摘要`** is ranked up: put the key figures there, with units (`24 m`, `1050 mm`, `10%`). The viewer's Quick facts read figures with units from the bullets.
   - Sections called `Related …` / `See also` / `References` are treated as link lists and ranked down.
7. **English / 中文 tabs:** `=== "English"` and `=== "中文"`. Both are indexed; English is shown first in results.
8. **APSEC pages:**
   - `apsec/<year>.md`, with `## ADF n/yyyy · d Mon yyyy` meeting headings;
   - `### n. Title {#iYYYYMMDDn}` items;
   - a revisited item carries `!!! warning "Later discussion 其後再討論"` with a link to the `[later response](yyyy.md#i…)`. The viewer leaves such items out of answers, so only current positions show.
9. **Figures:** Markdown images (`![alt](../assets/….svg)`). The viewer shows the figures of the sections it finds as thumbnails. Give them a meaningful `alt`.

## Good to know

- A build that fails keeps the viewer on the previous version, and the error shows in Library > Knowledge base. `mkdocs build --strict` passing on your side is the best check.
- The viewer's search is no-AI: SQLite full text over your section text and headings, with each Chinese character indexed. Plain words and figures in the text help it most.
