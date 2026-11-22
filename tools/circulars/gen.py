"""Generate docs/circulars/*.md from letters.json (BD index) and notes/<year>.json (summaries)."""
import json,os,re,glob,datetime
H=os.path.dirname(os.path.abspath(__file__)); D=os.path.join(H,'../../docs/circulars')
L=json.load(open(os.path.join(H,'letters.json')))
N={}
for f in glob.glob(os.path.join(H,'notes/*.json')):
    for k,v in json.load(open(f)).items(): N[k]=v
MON='Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split()
def fdate(d):
    if not d: return '—'
    p=d.split('-')
    return f'{int(p[2])} {MON[int(p[1])-1]} {p[0]}' if len(p)==3 else f'{MON[int(p[1])-1]} {p[0]}'
aid=lambda e:'cl-'+e['id'].lower().replace('_','-')
byid={e['id']:e for e in L}
def year_of(e): return e['year'] or 'other'
def page_of(e): return f"{year_of(e)}.md"
done_years=sorted({year_of(byid[k]) for k in N if k in byid},reverse=True)
def zhpdf(e): return e['tcurl'] if e.get('tcurl','').endswith('c.pdf') else ''
def link(ref,here):
    t,lab=ref.split('|',1)
    if t.startswith('#cl-'):
        k=[e for e in L if aid(e)==t[1:]]
        if not k: return None
        e=k[0]
        if e['id'] in N: return f"[{lab}]({'' if page_of(e)==here else page_of(e)}#{aid(e)})"
        return f"[{lab}]({e['url']})"
    return f'[{lab}]({t})'
SEC=lambda e:'Industry' if 'Industry' in (e['sec'] or '') else ('Guidelines' if 'Guidelines' in (e['sec'] or '') else 'Main')
def entry(e,here):
    n=N[e['id']]; o=[]
    o.append(f"### {e['title']}<br><small>{e['tc'] or ''}</small> {{#{aid(e)}}}\n")
    pdfs=f"[English PDF]({e['url']})"+(f" · [中文 PDF]({zhpdf(e)})" if zhpdf(e) else '')
    o.append(f"<small>**{fdate(e.get('date'))}** · To 致: {n['to']} · Issued by 發出: {n['by']} · {pdfs}</small>\n")
    for en,zh in n['points']: o.append(f"- {en}<br>{zh}")
    rel=[x for x in (link(r,here) for r in n.get('related',[])) if x]
    if rel: o.append(f"\n<small>Related 相關: {' · '.join(rel)}</small>")
    o.append('\n')
    return '\n'.join(o)
for y in done_years:
    here=f'{y}.md'
    es=[e for e in L if year_of(e)==y and e['id'] in N]
    es.sort(key=lambda e:e.get('date') or '',reverse=True)
    pend=[e for e in L if year_of(e)==y and e['id'] not in N]
    out=[f"---\ntags:\n  - Circular letter 通告函件\nsummary: \"BD circular letters issued in {y}: key points, dates and links to the original PDFs.\"\nkeywords: circular letter, 通告函件, Buildings Department, 屋宇署, {y}\n---\n",
         f"# Circular letters {y}<br><small>{y} 年通告函件</small>\n",
         f"!!! info \"About this page 關於本頁\"\n    Summaries of the Buildings Department circular letters issued in {y}, newest first. Each entry gives the date, addressees, the key requirements in English and Chinese, and links to the original PDFs. Always read the original letter. 本頁按日期（新至舊）摘錄 {y} 年屋宇署通告函件重點，請以原文為準。\n\n    Source 原文: [BD circular letters index](https://www.bd.gov.hk/en/resources/codes-and-references/practice-notes-and-circular-letters/index_circulars.html) · Last checked 最後核對: {datetime.date.today()}\n",
         "## At a glance 一覽 {#at-a-glance}\n","| Date 日期 | Circular letter 通告 | To 致 |","|---|---|---|"]
    for e in es: out.append(f"| {fdate(e.get('date'))} | [{e['title']}](#{aid(e)})<br><small>{e['tc']}</small> | {N[e['id']]['to']} |")
    out.append('')
    main=[e for e in es if SEC(e)!='Industry']; ind=[e for e in es if SEC(e)=='Industry']
    if main: out.append('## Letters to registered building professionals and contractors 致註冊建築專業人士及承建商 {#professionals}\n'); out+= [entry(e,here) for e in main]
    if ind: out.append('## Letters to industry stakeholders 致業界持份者 {#industry}\n'); out+= [entry(e,here) for e in ind]
    if pend: out.append('## Not yet summarised 尚未摘錄\n'); out+= [f"- [{e['title']}]({e['url']}) {e['tc']}" for e in pend]
    out.append('\n## Related 相關文件 {#related}\n\n[All circular letters 所有通告](index.md) · [PNAP index](../pnap/index.md) · [Minor works guide](../guides/minor-works.md)\n')
    open(os.path.join(D,here),'w').write('\n'.join(out))
# index
years=sorted({year_of(e) for e in L if year_of(e)!='other'},reverse=True)
out=["---\ntags:\n  - Circular letter 通告函件\nsummary: \"Index of all Buildings Department circular letters, by year, with links to summaries and the original PDFs.\"\nkeywords: circular letter, 通告函件, Buildings Department, 屋宇署, index\n---\n",
     "# Circular letters<br><small>通告函件</small>\n",
     f"!!! info \"About 關於\"\n    Buildings Department circular letters to Authorized Persons, Registered Structural and Geotechnical Engineers, Registered Inspectors, registered contractors and industry stakeholders. They announce new arrangements, remind of statutory duties and give interim guidance before Practice Notes or Codes are revised. {len(L)} letters are listed on the BD index; years with summaries are linked below. 屋宇署向認可人士、註冊結構及岩土工程師、註冊檢驗人員、註冊承建商及業界發出的通告函件，用以公布新安排、提醒法定責任或於作業備考／守則修訂前提供指引。\n\n    Source 原文: [BD index (English)](https://www.bd.gov.hk/en/resources/codes-and-references/practice-notes-and-circular-letters/index_circulars.html) · [屋宇署索引（中文）](https://www.bd.gov.hk/tc/resources/codes-and-references/practice-notes-and-circular-letters/index_circulars.html) · Last checked 最後核對: {datetime.date.today()}\n",
     "## By year 按年份 {#by-year}\n","| Year 年份 | Letters 數目 | Summaries 摘要 |","|---|---|---|"]
for y in years:
    es=[e for e in L if year_of(e)==y]; s=sum(e['id'] in N for e in es)
    out.append(f"| {y} | {len(es)} | {f'[{s} summarised 已摘錄]({y}.md)' if s else 'Pending 待補'} |")
out.append("\n## All letters 全部通告 {#all}\n")
for y in years+(['other'] if any(year_of(e)=='other' for e in L) else []):
    es=sorted([e for e in L if year_of(e)==y],key=lambda e:e.get('date') or '',reverse=True)
    out.append(f"### {y if y!='other' else 'Guidelines 指引'} {{#y{y}}}\n\n| Date 日期 | Title 標題 | Original 原文 |\n|---|---|---|")
    for e in es:
        t=f"[{e['title']}]({y}.md#{aid(e)})" if e['id'] in N else e['title']
        z=f" · [中]({zhpdf(e)})" if zhpdf(e) else ''
        out.append(f"| {fdate(e.get('date'))} | {t}<br><small>{e['tc']}</small> | [EN]({e['url']}){z} |")
    out.append('')
open(os.path.join(D,'index.md'),'w').write('\n'.join(out))
print('years',done_years,'summarised',len(N))
