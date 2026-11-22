"""Rebuild APSEC item titles, questions and BD responses in docs/apsec/*.md from the
PDF table cells (cells.json), keeping all other page content (related links, figures,
notes). Dry run by default; --write to save. Report in rebuild6.json."""
import json,re,sys,glob,collections
D='/home/user/new-project/docs/apsec/'
items=json.load(open('items3.json')); f_of={}
for i in items: f_of.setdefault(i['date'],i['file'])
C=json.load(open('cells.json'))
voc=collections.Counter(w.lower() for v in C.values() for i in v for t in (i['title'],i['q'],i['a']) for w in re.findall(r"[A-Za-z]+",t))
def fix(t):
    t=re.sub(r'[\uf06c\uf09f\uf0a7\uf0b7\uf0d8\uf0fc]','•',t)
    w=t.split(' '); o=[]; i=0
    while i<len(w):
        if i+1<len(w):
            ma=re.fullmatch(r'([“"(\[]?)([A-Za-z]+)',w[i]); mb=re.fullmatch(r'([a-z]+)([”"’),.;:?]*)',w[i+1])
            if ma and mb:
                a_,b_=ma[2].lower(),mb[1]; j=voc[a_+b_]
                if j>=2 and min(voc[a_],voc[b_])<0.3*j and min(voc[a_],voc[b_])<20:
                    o.append(w[i]+w[i+1]); i+=2; continue
        o.append(w[i]); i+=1
    t=' '.join(o).replace(' ,',',')
    t=re.sub(r'\s*\b(Items? (raised|proposed) by (the )?[A-Za-z]+\.?|AOB Items?)\s*$','',t).strip()
    for mk in MANUAL:
        i=t.find(mk)
        if i>=0 and len(t)>i+len(mk)+20:
            keep=mk.replace(' NON-DOMESTIC','')
            t=t[:i]+keep+' '+TABLE; CUT.append('manual: '+keep[:60])
    return detable(t)
def detable(t):
    w=t.split(' '); out=[]; run=[]
    def flush():
        tab=[x for x in run if re.search(r'\d|[()/+]',x) or (x.isupper() and len(x)>1)]
        if len(run)>=30 and len(tab)>=0.36*len(run): out.append(TABLE); CUT.append(' '.join(run)[:120])
        else: out.extend(run)
        run.clear()
    for x in w:
        run.append(x)
        if re.search(r'[.?!;:]["”’)]*$',x) and not re.fullmatch(r'[\d.()]+',x): flush()
    flush()
    r=' '.join(out)
    return re.sub(r'(?:\s*'+re.escape(TABLE)+r')+',' '+TABLE,r).strip()
MANUAL=['would notify the members of their institutes/association of the arrangements accordingly.',
 'tower crane will normally cease operation during adverse weather condition.',
 'is appended below for reference.',
 'Members noted and supported. NON-DOMESTIC',
 'minimum supervision requirements for both individual works and combined works were fulfilled.',
 'Below is an example to illustrate our understanding: RSE Stream T5 (no significant geotechnical content):']
TABLE='[Table – see the original summary 表格見原文]'; CUT=[]
nw=lambda s:re.findall(r"\w+",s.lower())
rep=[]; st=collections.Counter()
for f in sorted(glob.glob(D+'20*.md')):
    L=open(f).read().split('\n'); cell=None
    for ln,line in enumerate(L):
        m=re.match(r'^(### (\d+)\. )(.*?)( \{#i(\d{4})(\d{2})(\d{2})(\d+)\})$',line)
        if m:
            d=f'{m[5]}-{m[6]}-{m[7]}'; cs=[c for c in C.get(f_of.get(d),[]) if c['no']==int(m[8])]
            cell=cs[0] if cs else None
            if not cell: st['nocell']+=1; continue
            t=fix(cell['title'])
            if t.replace(' ','')==m[3].replace(' ',''): t=fix(m[3])
            if t and nw(t)!=nw(m[3]): rep.append(dict(f=f[-7:],ln=ln+1,k='title',old=m[3],new=t)); st['title']+=1; L[ln]=m[1]+t+m[4]
            continue
        m=re.match(r"(\*\*(Question 問題|BD's response 屋宇署回覆):\*\* )(.*)",line)
        if not (m and cell): continue
        k='q' if m[2][0]=='Q' else 'a'; new=fix(cell[k])
        if k=='q' and not cell['title'].strip(): st['skip_q_notitle']+=1; continue
        if not new: st['empty_'+k]+=1; continue
        old=m[3]
        if new.replace(' ','')==old.replace(' ',''): new=fix(old)
        if nw(new)==nw(old): st['same_'+k]+=1; continue
        r=len(nw(new))/max(1,len(nw(old)))
        rep.append(dict(f=f[-7:],ln=ln+1,k=k,r=round(r,2),trunc=old.endswith('…'),old=old,new=new)); st['chg_'+k]+=1
        L[ln]=m[1]+new
    if '--write' in sys.argv: open(f,'w').write('\n'.join(L))
print(st); print('table cuts',len(CUT)); [print('  CUT:',c) for c in CUT]
json.dump(rep,open('rebuild6.json','w'),ensure_ascii=False,indent=0)
