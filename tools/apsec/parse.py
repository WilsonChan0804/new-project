import re,glob,json,os
MON={m:i for i,m in enumerate('january february march april may june july august september october november december'.split(),1)}
def date_of(fn,txt):
    m=re.search(r'on\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})',txt[:600])
    if m and m.group(2).lower() in MON: return f'{m.group(3)}-{MON[m.group(2).lower()]:02d}-{int(m.group(1)):02d}'
    m=re.search(r'(\d{1,2})[._](\d{1,2})[._](\d{4})',fn)
    if m: return f'{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}'
    m=re.search(r'(\d{1,2})-([A-Za-z]+)-(\d{4})',fn)
    if m:
        k=m.group(2).lower(); k=[x for x in MON if x.startswith(k[:3])][0]; return f'{m.group(3)}-{MON[k]:02d}-{int(m.group(1)):02d}'
    return '?'
items=[]
for f in sorted(glob.glob('pdf/*.cols.txt')):
    raw=open(f,errors='ignore').read()
    date=date_of(os.path.basename(f),raw)
    L,Rr=[],[]
    for line in raw.split('\n'):
        if '\t' not in line: continue
        l,r=line.split('\t',1); l=l.strip(); r=r.strip()
        if re.match(r'^\d+$',l) and not r: continue
        if re.search(r'(ADF|Discussion Forum|APSEC).*\d{4}$',r) and len(r)<70: r=''
        if re.search(r'(ADF|Discussion Forum).*\d{4}$',l) and len(l)<70 and not r: continue
        if not l and not r: continue
        L.append(l); Rr.append(r)
    # merge bare 'N.' lines with following line
    i=0;L2=[];R2=[]
    while i<len(L):
        if re.match(r'^\d{1,2}\.$',L[i]) and i+1<len(L) and L[i+1]:
            L2.append(L[i]+' '+L[i+1]); R2.append((Rr[i]+' '+Rr[i+1]).strip()); i+=2; continue
        L2.append(L[i]); R2.append(Rr[i]); i+=1
    L,Rr=L2,R2
    cur=None; raiser=''
    for l,r in zip(L,Rr):
        mr=re.match(r'^Items?\s+(?:raised|proposed)\s+by\s+(?:the\s+)?([A-Za-z]+)',l)
        if mr and 'Convenor' not in l: raiser=mr.group(1); continue
        mh=re.match(r'^(\d{1,2})\.?\s+([A-Z(\[“"].*)$',l)
        def tc(t):
            w=[x for x in re.findall(r'[A-Za-z][\w\-’\']*',t) if x.lower() not in ('of','and','the','for','in','on','to','a','an','with','by','or','under','at','as','from','between','within','into')]
            return w and sum(x[0].isupper() for x in w)/len(w)>=0.6 and len(t)<110
        if mh and (tc(mh.group(2)) or (cur is not None and cur.get('_f')==f and int(mh.group(1))==cur['no']+1 and len(mh.group(2))<110)) and (cur is None or cur['date']!=date or cur.get('_f')!=f or 0<int(mh.group(1))-cur['no']<=3 or (int(mh.group(1))==1 and cur['no']>3 and False)) :
            cur={'date':date,'file':os.path.basename(f)[:-9]+'.pdf','no':int(mh.group(1)),'title':mh.group(2),'q':[],'a':[],'by':raiser}
            cur['_f']=f; items.append(cur); 
            if r: cur['a'].append(r)
            continue
        if cur is None: continue
        if l and not cur['q'] and not cur.get('_tdone') and len(l)<70 and not re.search(r'[.?:;]$',cur['title']) and re.match(r'^[A-Z(]',l) and sum(w[0].isupper() for w in l.split() if w[0].isalpha())>=max(1,len([w for w in l.split() if w[0].isalpha()])*0.5):
            cur['title']+=' '+l; cur['_tdone']=True; continue
        cur['_tdone']=True
        if l: cur['q'].append(l)
        if r: cur['a'].append(r)
for it in items:
    # title continuation: first q lines in Title Case before a sentence
    it['q']=' '.join(it['q']); it['a']=' '.join(it['a'])
    it['q']=re.sub(r'\s+',' ',it['q']); it['a']=re.sub(r'\s+',' ',it['a'])
json.dump(items,open('items.json','w'),ensure_ascii=False,indent=0)
print(len(items)); import collections; print(collections.Counter(i['date'] for i in items).most_common(50))
