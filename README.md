# HK Building Regulations Knowledge Base 香港建築法規知識庫

A searchable, bilingual (English / 中文) knowledge base of the Hong Kong Buildings Ordinance, regulations,
Codes of Practice and PNAPs. Each entry has a summary, key clauses, a plain-language explanation and practical notes.

Built with [MkDocs Material](https://squidfunk.github.io/mkdocs-material/). Chinese text is indexed character by character, so any Chinese phrase can be searched.

## Quick start

```bash
pip install -r requirements.txt
mkdocs serve        # preview at http://127.0.0.1:8000
mkdocs build        # static site in ./site
```

## Structure

```
docs/
  pnap/          PNAP entries (APP / ADM / ADV)
  regulations/   Buildings Ordinance and regulations
  codes/         Codes of Practice
  glossary.md    English ⇄ 中文 terms
templates/
  entry-template.md   copy this for every new entry
```

See [docs/contributing.md](docs/contributing.md) for the writing rules.

## Publishing

`.github/workflows/deploy.yml` publishes the site to GitHub Pages on every push to `main`
(enable Pages → Source: *GitHub Actions* in the repository settings).

> Internal study notes only. Not the official text. Always check the latest version on the Buildings Department website.
