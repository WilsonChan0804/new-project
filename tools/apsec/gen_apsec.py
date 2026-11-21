import json, re, os, collections, glob, html
D = '/home/user/new-project/docs/'
SRC = 'https://www.hkie-st.org/wp-content/uploads/'
urls = {os.path.basename(u.strip()): u.strip() for u in open('urls.txt')}
it = json.load(open('items3.json'))
byid = {i['id']: i for i in it}
MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
def fdate(d): y, m, dd = d.split('-'); return f'{int(dd)} {MON[int(m)]} {y}'

# meeting labels
label = {}
for f in glob.glob('pdf/*.cols.txt'):
    first = open(f).read(400)
    m = re.search(r'(\d)\s*/\s*(\d{4})', first)
    label[os.path.basename(f)[:-9] + '.pdf'] = f'ADF {m.group(1)}/{m.group(2)}' if m else 'ADF'

def clean(t):
    t = re.sub(r'\s+', ' ', t).strip()
    t = t.replace('|', '/').replace('<', '‹').replace('>', '›')
    t = re.sub(r'(?<!\*)\*(?!\*)', '·', t)
    return t
def cut(t, n):
    t = clean(t)
    if len(t) <= n: return t
    k = t.rfind('. ', 0, n)
    return (t[:k + 1] if k > n * 0.5 else t[:n].rsplit(' ', 1)[0]) + ' …'
def anchor(i): return 'i' + i['id'].replace('-', '')
def year_page(i): return f'apsec/{i["date"][:4]}.md'
TITLE = {}
for p in glob.glob(D + '**/*.md', recursive=True):
    m = re.search(r'^# (.+?)(<br>|$)', open(p).read(), re.M)
    if m: TITLE[p[len(D):]] = re.sub(r'<.*?>', '', m.group(1)).strip()
def rel(frm, to):
    return os.path.relpath(D + to, os.path.dirname(D + frm)).replace(os.sep, '/')

def latest_of(i):
    seen = i
    while seen['later']:
        seen = max((byid[x] for x in seen['later']), key=lambda z: (z['date'], z['no']))
    return seen

# ---------- year pages ----------
years = sorted({i['date'][:4] for i in it}, reverse=True)
for y in years:
    P = f'apsec/{y}.md'
    o = ['---', 'tags:', '  - APSEC', '---', '', f'# APSEC discussion items {y}<br><small>{y} 年認可人士及註冊結構工程師委員會討論項目</small>', '',
         '!!! info "About this page 關於本頁"',
         '    Questions raised at the APSEC Discussion Forum (ADF) and **BD\'s responses**, extracted from the summaries published by the HKIE Structural Division. Text is condensed from the English source; check the PDF before relying on an item. Where a later meeting discussed the same question, the item is flagged and **the later response prevails**.',
         '    摘錄自香港工程師學會結構分部發布的會議摘要（只有英文版本）。如其後會議再討論同一問題，以**較新的回覆為準**。', '']
    for d in sorted({i['date'] for i in it if i['date'].startswith(y)}, reverse=True):
        L = [i for i in it if i['date'] == d]
        f = L[0]['file']
        o += [f'## {label.get(f, "ADF")} · {fdate(d)}', '', f'[Original summary (PDF) 原文]({urls.get(f, "")}) · {len(L)} items', '']
        for i in sorted(L, key=lambda z: z['no']):
            o.append(f'### {i["no"]}. {clean(i["title"])} {{#{anchor(i)}}}')
            o.append('')
            meta = []
            if i['by']: meta.append(f'Raised by **{i["by"]}**')
            if i['refs']:
                meta.append('Related 相關: ' + ', '.join(f'[{TITLE.get(r, r).split(" ")[0] if r.startswith("pnap") else TITLE.get(r, r)[:40]}]({rel(P, r)})' for r in i['refs'][:6]))
            if meta: o += [' · '.join(meta), '']
            if i['later']:
                lt = latest_of(i)
                o += [f'!!! warning "Later discussion 其後再討論"', f'    This question was discussed again on **{fdate(lt["date"])}**; use the [later response]({rel(P, year_page(lt))}#{anchor(lt)}) where they differ. 如有不同，以較新回覆為準。', '']
            if i['earlier']:
                o += ['<small>Follows earlier discussion: ' + ', '.join(f'[{fdate(byid[e]["date"])}]({rel(P, year_page(byid[e]))}#{anchor(byid[e])})' for e in i['earlier']) + '</small>', '']
            if i.get('see'):
                o += ['<small>Related discussions 相關討論: ' + ', '.join(f'[{fdate(byid[e]["date"])} item {byid[e]["no"]}]({rel(P, year_page(byid[e]))}#{anchor(byid[e])})' for e in sorted(set(i['see']))[:6]) + '</small>', '']
            o += [f'**Question 問題:** {cut(i["q"], 700)}', '', f'**BD\'s response 屋宇署回覆:** {cut(i["a"], 1600) or "—"}', '']
    o.append('---\n<small>Source: Summary of Items Discussed in APSEC Discussion Forum, published by the HKIE Structural Division. Condensed for reference; the PDF is the authoritative record.</small>\n')
    open(D + P, 'w').write('\n'.join(o))

# ---------- inject into document pages ----------
docs = collections.defaultdict(list)
for i in it:
    for r in i['refs']: docs[r].append(i)
START, END = '<!-- APSEC START -->', '<!-- APSEC END -->'
for p in glob.glob(D + '**/*.md', recursive=True):
    s = open(p).read()
    if START in s:
        s = re.sub(re.escape(START) + '.*?' + re.escape(END) + r'\n*', '', s, flags=re.S); open(p, 'w').write(s)
for r, L in docs.items():
    P = r; s = open(D + P).read()
    # keep only the latest item of each group
    groups = {}
    for i in L:
        lt = latest_of(i)
        key = lt['id'] if lt['primary'] == i['primary'] else i['id']
        groups.setdefault(key, set()).add(i['id'])
    show = []
    for key, ids in groups.items():
        top = byid[key] if key in byid else byid[sorted(ids)[-1]]
        if r not in top['refs']: top = max((byid[x] for x in ids), key=lambda z: z['date'])
        older = sorted((byid[x] for x in ids if x != top['id']), key=lambda z: z['date'], reverse=True)
        show.append((top, older))
    show.sort(key=lambda t: (t[0]['date'], t[0]['no']), reverse=True)
    def row(top, older):
        t = f'- **[{clean(top["title"])}]({rel(P, year_page(top))}#{anchor(top)})** <small>{label.get(top["file"], "ADF")}, {fdate(top["date"])}</small><br>{cut(top["a"], 330)}'
        if older:
            t += '<br><small>Latest position; replaces earlier discussion on ' + ', '.join(f'[{fdate(o["date"])}]({rel(P, year_page(o))}#{anchor(o)})' for o in older) + ' 以此為最新立場</small>'
        return t
    blk = [START, '## APSEC clarifications 認可人士及註冊結構工程師委員會討論 {#apsec-clarifications}', '',
           f'BD\'s responses at the APSEC Discussion Forum that clarify this document, **newest first**. Where the same question came up more than once, only the **latest position** is listed. See [all APSEC items]({rel(P, "apsec/index.md")}). 屋宇署在討論會上就本文件作出的澄清，新者在前；同一問題只列最新立場。', '']
    rows = [row(*x) for x in show]
    blk += rows[:8]
    if len(rows) > 8:
        blk += ['', f'??? note "{len(rows) - 8} more APSEC items 更多項目"', ''] + ['    ' + x for x in rows[8:]]
    blk += ['', END, '']
    b = '\n'.join(blk) + '\n'
    k = s.find('## Related')
    if k == -1: k = s.find('---\n<small>Prepared')
    if k == -1: k = len(s)
    s = s[:k] + b + s[k:]
    open(D + P, 'w').write(s)

# ---------- index ----------
o = ['---', 'tags:', '  - APSEC', '---', '', '# APSEC Discussion Forum<br><small>認可人士及註冊結構工程師委員會討論會</small>', '',
     '!!! info "What this is 簡介"',
     '    At the **APSEC Discussion Forum (ADF)**, the professional bodies (HKIA, HKIE, AAP, ACEHK, HKIS, PBSCA, AREC) raise questions on the Buildings Ordinance, regulations, codes and PNAPs, and the **Buildings Department responds**. The summaries are published by the [HKIE Structural Division](https://www.hkie-st.org/library/summary-of-items-discussed-in-apsec/). They clarify how BD applies the documents in practice.',
     '    各專業團體在討論會上就條例、規例、守則及作業備考提出問題，由屋宇署回覆；會議摘要由香港工程師學會結構分部發布。', '',
     '!!! warning "Latest position prevails 以最新立場為準"',
     '    Meetings continue and some replies change over time. On every page, when the same question was discussed more than once, the **latest response is shown and marked as the latest position**; earlier replies are linked for reference. An earlier reply is treated as replaced only where a later item expressly follows it up (e.g. cites "item X of ADF n/yyyy") or asks the same question on the same document; a later "under review" reply does not replace an earlier answer. Loosely related items are shown as "related discussions". The summaries are English only; the text here is condensed from them.',
     '    會議持續舉行，部分回覆會隨時間改變。同一問題如曾多次討論，本網站以**最新回覆**為準，舊回覆只供參考。配對以自動方式進行，重要事項請核對原文。', '',
     f'**{len(it)} items** from **{len({i["date"] for i in it})} meetings** ({fdate(min(i["date"] for i in it))} to {fdate(max(i["date"] for i in it))}). Each item is also listed on the related regulation, code or PNAP page under **APSEC clarifications**.', '',
     '## By document 按文件', '', '| Document 文件 | Items 項目 | Latest 最新 |', '|---|---|---|']
for r, L in sorted(docs.items(), key=lambda kv: -len(kv[1])):
    lt = max(L, key=lambda z: z['date'])
    o.append(f'| [{TITLE.get(r, r)}]({rel("apsec/index.md", r)}#apsec-clarifications) | {len(L)} | {fdate(lt["date"])} |')
o += ['', '## By meeting 按會議', '', '| Meeting 會議 | Date 日期 | Items 項目 | Source 原文 |', '|---|---|---|---|']
for d in sorted({i['date'] for i in it}, reverse=True):
    L = [i for i in it if i['date'] == d]; f = L[0]['file']
    o.append(f'| [{label.get(f, "ADF")}]({d[:4]}.md) | {fdate(d)} | {len(L)} | [PDF]({urls.get(f, "")}) |')
o += ['', '## Items not linked to a specific document 未連結文件的項目', '',
      f'{sum(1 for i in it if not i["refs"])} items (e.g. general procedures, site safety, liaison) are listed only on the yearly pages.', '']
open(D + 'apsec/index.md', 'w').write('\n'.join(o))
print('docs', len(docs), 'years', years)
