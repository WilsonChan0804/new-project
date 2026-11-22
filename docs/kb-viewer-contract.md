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

## Editing inside the viewer (viewer accounts)

In the viewer, edits are saved on the viewer's own server under each person's **viewer account**: the member list. Every signed-in member may edit, the edit shows at once with their name, and the author or a site admin can undo it. The claude.ai preview runtime is not there, so `kb.js` must use the viewer's API when it is available.

- **`docs/kb-viewer-backend.js`** (in the viewer's repo, branch `claude/amazing-fermi-96v958`) is a drop-in adapter. It gives `kb.js` the same `db` / `user` interface it already uses with `window.claude.use(...)`. Copy it to `docs/javascripts/kb-viewer-backend.js` and load it **before** `kb.js`. Then change three lines of `kb.js`, as described at the end of that file:
  - `PAGE`
  - `db`
  - `state.user`
  
  It has been tested in the viewer: pens, save, "Edited by NAME", other browsers, history, undo.
- Viewer API (same origin, the viewer's sign-in cookie):
  - `GET /api/kb/me` gives `{uid, name, admin, can_edit, viewer: true}`, or 401 when not signed in.
  - `GET /api/kb/edits?page=<source path>` gives the live edits, each with `{id, page, block, anchor, text, note, original, uid, name, at}`.
  - `POST /api/kb/edits {page, block, anchor, text, note, original}` saves an edit; the server sets `uid`, `name` and `at`.
  - `POST /api/kb/edits/<id>/undo` undoes an edit (its author or a site admin); `GET /api/kb/history?page=` lists them all, including undone ones.
- **Page id = the page's source path** (`pnap/app-2.md`). Please write it into every page from the hook (`<meta name="kb-page" content="pnap/app-2.md">`) instead of taking the last two URL segments. Those break under `/kb/` and differ between `.html` and directory URLs, and the viewer matches edits to pages by this path.
- **Block id:** use the anchor of the section above plus the hash (`at-a-glance:3k9x2`), and send `anchor` and the full `original` text. The viewer uses them to put the edited wording into its search and to fold edits back into the source.
- **Undo:** show it beside "Edited by NAME" when `state.me === e.by`, or for admins (`KBViewer.user(...).admin`), calling `KBViewer.undo(e.id)`.
- **Folding edits back into the Markdown:** Wilson downloads them from the viewer (Codes > Library > Knowledge base > Download edits: a Markdown list of page, original → new, who, why, edit id). Apply them to the source and commit. After the next update, the viewer marks an edit "in the source" when its new wording is in the page and its original is gone.

## Links to the GBP workbook

A topic guide can open the viewer's **GBP workbook** at a part, beside the page, for the project the reader has open:

```markdown
[Calculate GFA in the GBP workbook](gbp:gfa)
```

- **Parts:**
  - `site` (site, PR and SC; also `sc`, `pr`);
  - `gfa` (GFA and APP-151 concessions);
  - `moe` (occupancy and exits; also `occupancy`, `exits`);
  - `stairs` (staircase discharge; also `discharge`).
- **Placement:** put the link on its own line, in the section that explains that calculation. The viewer shows it as a button.
- **Back links:** the viewer links back from the workbook ("Why? 依據") to every section holding such a link, by its anchor, so keep those `{#id}` anchors stable.
- **Outside the viewer:** on GitHub or in the claude.ai preview the link does nothing. That is fine; `mkdocs build --strict` accepts it.

## Good to know

- A build that fails keeps the viewer on the previous version, and the error shows in Library > Knowledge base. `mkdocs build --strict` passing on your side is the best check.
- Optional front matter the viewer now reads:
  - `summary:` one line, used as the page's snippet;
  - `keywords:` other names for the search, as a list or a comma line (e.g. `MOE, means of escape, 走火通道`);
  - the tag `Draft`, which shows a "draft" badge on search results.
- Hooks: keep them to the standard library and `mkdocs` (as `hooks/autolink.py` is now). There are no network calls at build time, and the build must finish in a few minutes on the office server.
- The site lives under `/kb/`: relative links and assets only, no absolute `/...` paths in JS or CSS.
- Images: compressed (about 500 KB at most each); do not commit build output or generated folders.
- The viewer's search is no-AI: SQLite full text over your section text and headings, with each Chinese character indexed. Plain words and figures in the text help it most.
