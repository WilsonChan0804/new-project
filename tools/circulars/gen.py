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
aid=lambda e:'cl-'+re.sub(r'^cl_','',e['id'].lower()).replace('_','-')
byid={e['id']:e for e in L}
def year_of(e): return e['year'] or 'other'
def page_of(e): return f"{year_of(e)}.md"
# ---- recurring annual reminders: latest in each (series, audience) is current ----
SERIES=[('rainy-typhoon-sites',r'flood prevention measures|scaffolding works .*typhoon|scaffolding and tower cranes .*typhoon|prevention measures at construction sites during rainy'),
 ('rodent-mosquito',r'anti-mosquito|rodent-proofing'),
 ('gifts',r'bestowing gifts'),
 ('bamboo',r'safety of bamboo scaffolds'),
 ('rmwc-refresher',r'refresher course for registered minor works'),
 ('rgbc-cpd',r'continuing professional development course'),
 ('public-typhoon',r'precautionary measures for public and building safety during (rainy and )?typhoon season')]
AUD=lambda e:'ind' if 'Industry' in (e['sec'] or '') else 'main'
SER={}
for key,pat in SERIES:
    for a in ('ind','main'):
        g=[e for e in L if re.search(pat,e['title'],re.I) and AUD(e)==a]
        if len(g)<2: continue
        g.sort(key=lambda e:e.get('date') or e['year'] or '',reverse=True)
        for e in g[1:]: SER[e['id']]=g[0]
TOPICS=[('fire','Fire safety 消防安全',r'fire|阻燃|消防'),
 ('weather','Typhoon, rainstorm & flood 颱風、暴雨及水浸',r'typhoon|rainy|flood|tropical storm|mangkhut|ragasa|rainstorm'),
 ('scaffold','Scaffolding, site safety & cranes 棚架、地盤安全及起重機',r'scaffold|crane|site safety|gondola|safety net|fall protection|hoarding|smart site|mobile plant'),
 ('minorworks','Minor works & signboards 小型工程及招牌',r'minor works|signboard|MW0|household'),
 ('mbis','Building & window inspection (MBIS/MWIS) 強制驗樓驗窗',r'mandatory building inspection|mandatory window|MBIS|MWIS|qualified person|registered inspector'),
 ('structural','Structural codes, materials & testing 結構守則、物料及測試',r'concrete|steel|foundation|glass|precast|wind|loads|test report|reinforc|material|piling|pile|cube'),
 ('geotech','Excavation, slopes & geotechnical 挖掘、斜坡及岩土',r'excavation|slope|geotechnical|ground investigation|tied-back|retaining|RGE'),
 ('submission','Submissions, approvals & e-submission 呈交、審批及電子呈交',r'submission|electronic|ESH|approval|consent|form BA|streamlin|occupation permit|plans'),
 ('registration','Registration, CPD & conduct 註冊、持續進修及操守',r'registration|register|course|CPD|gifts|integrity|refresher|card|technically competent|TCP'),
 ('hygiene','Hygiene, seepage & environment 衞生、滲水及環境',r'mosquito|rodent|seepage|drainage|environment|noise|dust|asbestos'),
 ('design','Building design & use 樓宇設計及用途',r'GFA|elderly|industrial building|barrier free|green|sustainab|subdivi|lift|escalator|heritage|ventilation'),
 ('enforcement','Unauthorised works & enforcement 違例建築及執法',r'unauthorised|UBW|prosecution|enforcement|illegal'),
 ('supervision','Site supervision 地盤監督',r'supervision|supervisor')]
def topics(e):
    n=N.get(e['id'],{})
    if n.get('topics'): return n['topics']
    t=e['title']+' '+(e['tc'] or '')
    k=[k for k,_,p in TOPICS if re.search(p,t,re.I)]
    return k[:2] or ['other']
TOPICS.append(('other','Other 其他',''))
TN={k:n for k,n,_ in TOPICS}
def status(e,here):
    n=N.get(e['id'],{})
    if e['id'] in SER:
        new=SER[e['id']]; tgt=(f"{'' if page_of(new)==here else page_of(new)}#{aid(new)}") if new['id'] in N else new['url']
        return ('superseded',f"Superseded by the later reminder of {fdate(new.get('date'))} 已由較新一份取代",f"[{new['title']}]({tgt})")
    st=n.get('status','current')
    lab={'current':'In force 有效','superseded':'Superseded 已被取代','incorporated':'Incorporated 已納入','spent':'Spent (one-off) 一次性／已過時','amended':'Amended 已修訂'}[st]
    lk=' · '.join(x for x in (link(r,here) for r in n.get('status_links',[])) if x)
    return (st,(n.get('status_note') or lab),lk)
BADGE={'current':'🟢','superseded':'⚪','incorporated':'🔵','spent':'⚫','amended':'🟡'}
def badge(e,here):
    st,note,lk=status(e,here)
    return f"{BADGE[st]} **{note}**"+(f" → {lk}" if lk else '')
done_years=sorted({year_of(byid[k]) for k in N if k in byid},reverse=True)
def zhpdf(e): return e['tcurl'] if e.get('tcurl','').endswith('c.pdf') else ''
def link(ref,here):
    t,lab=ref.split('|',1)
    if t.startswith('#cl-'):
        k=[e for e in L if aid(e)==t[1:].replace('_','-')]
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
    o.append(f"Status 狀態: {badge(e,here)} · Topic 主題: "+', '.join(f"[{TN[t]}](topics.md#{t})" for t in topics(e))+"\n")
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
    out[-2]='| Date 日期 | Circular letter 通告 | To 致 | Status 狀態 |'; out[-1]='|---|---|---|---|'
    for e in es: out.append(f"| {fdate(e.get('date'))} | [{e['title']}](#{aid(e)})<br><small>{e['tc']}</small> | {N[e['id']]['to']} | {BADGE[status(e,here)[0]]} |")
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
     "!!! tip \"Status 狀態\"\n    🟢 In force 有效 · ⚪ Superseded by a later letter 已由較新通告取代 · 🔵 Incorporated into a Code, PNAP or guideline 已納入守則／作業備考／指引 · 🟡 Amended 已修訂 · ⚫ One-off or spent 一次性／已過時. Annual reminders (typhoon, rainy season, bamboo scaffolds, mosquito and rodent, gifts, CPD) are marked superseded by the latest issue. Status of letters not yet summarised is provisional. 每年重發的提示以最新一份為準；尚未摘錄的通告狀態僅供參考。\n\n    See also 另見: [Letters by topic 按主題](topics.md)\n",
     "## By year 按年份 {#by-year}\n","| Year 年份 | Letters 數目 | Summaries 摘要 |","|---|---|---|"]
for y in years:
    es=[e for e in L if year_of(e)==y]; s=sum(e['id'] in N for e in es)
    out.append(f"| {y} | {len(es)} | {f'[{s} summarised 已摘錄]({y}.md)' if s else 'Pending 待補'} |")
out.append("\n## All letters 全部通告 {#all}\n")
for y in years+(['other'] if any(year_of(e)=='other' for e in L) else []):
    es=sorted([e for e in L if year_of(e)==y],key=lambda e:e.get('date') or '',reverse=True)
    out.append(f"### {y if y!='other' else 'Guidelines 指引'} {{#y{y}}}\n\n| Date 日期 | Title 標題 | Status 狀態 | Original 原文 |\n|---|---|---|---|")
    for e in es:
        t=f"[{e['title']}]({y}.md#{aid(e)})" if e['id'] in N else e['title']
        z=f" · [中]({zhpdf(e)})" if zhpdf(e) else ''
        out.append(f"| {fdate(e.get('date'))} | {t}<br><small>{e['tc']}</small> | {badge(e,'index.md')} | [EN]({e['url']}){z} |")
    out.append('')
open(os.path.join(D,'index.md'),'w').write('\n'.join(out))
# topics page
out=["---\ntags:\n  - Circular letter 通告函件\nsummary: \"BD circular letters grouped by topic, with status and links to the related Codes and PNAPs.\"\nkeywords: circular letter, 通告函件, topic, 主題\n---\n","# Circular letters by topic<br><small>通告函件（按主題）</small>\n",
 "!!! info \"How to read 使用說明\"\n    Letters are grouped by topic, newest first; a letter can appear under two topics. 🟢 In force · ⚪ Superseded · 🔵 Incorporated · 🟡 Amended · ⚫ One-off. 按主題分組（新至舊），一份通告可屬兩個主題。\n\n    [Index by year 按年份](index.md)\n"]
for k,name,_ in TOPICS:
    es=sorted([e for e in L if k in topics(e)],key=lambda e:e.get('date') or e['year'] or '',reverse=True)
    if not es: continue
    cur=sum(status(e,'topics.md')[0]=='current' for e in es)
    out.append(f"## {name} {{#{k}}}\n\n<small>{len(es)} letters 份 · {cur} in force 有效</small>\n\n| Date 日期 | Circular letter 通告 | Status 狀態 |\n|---|---|---|")
    for e in es:
        y=year_of(e); t=f"[{e['title']}]({y}.md#{aid(e)})" if e['id'] in N else f"[{e['title']}]({e['url']})"
        out.append(f"| {fdate(e.get('date'))} | {t}<br><small>{e['tc']}</small> | {badge(e,'topics.md')} |")
    out.append('')
open(os.path.join(D,'topics.md'),'w').write('\n'.join(out))
print('years',done_years,'summarised',len(N))
# ---- back-links on Code / PNAP / regulation / guide pages ----
import collections
BL=collections.defaultdict(list)
for e in L:
    n=N.get(e['id'])
    if not n: continue
    for r in n.get('related',[])+n.get('status_links',[]):
        t=r.split('|')[0]
        if t.startswith('../') and t.endswith('.md'): BL[t[3:]].append(e)
DOCS=os.path.join(H,'../../docs/')
for f in glob.glob(DOCS+'**/*.md',recursive=True):
    rel=os.path.relpath(f,DOCS)
    if rel.startswith('circulars/'): continue
    s=open(f).read()
    s2=re.sub(r'\n<!-- CL START -->.*?<!-- CL END -->\n','\n',s,flags=re.S)
    es=BL.get(rel)
    if es:
        up='../'*rel.count('/')
        es=sorted({e['id']:e for e in es}.values(),key=lambda e:e.get('date') or '',reverse=True)
        blk=["\n<!-- CL START -->","## Related circular letters 相關通告函件 {#circular-letters}\n"]
        for e in es:
            st=status(e,'x')[0]
            blk.append(f"- {BADGE[st]} [{e['title']}]({up}circulars/{year_of(e)}.md#{aid(e)}) <small>{fdate(e.get('date'))} · {e['tc']}</small>")
        blk.append("<!-- CL END -->\n")
        m=re.search(r'\n## Related[^\n]*\{#related\}',s2)
        s2=(s2[:m.start()]+'\n'.join(blk)+s2[m.start():]) if m else s2.rstrip('\n')+'\n'+'\n'.join(blk)
    if s2!=s: open(f,'w').write(s2)
print('back-linked pages',len(BL))
