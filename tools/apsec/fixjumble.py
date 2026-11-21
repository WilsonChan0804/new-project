import json,collections,re,glob,subprocess,sys
old=json.load(open('items3.json')); new={(i['file'],i['no']):i for i in json.load(open('re3/items.json'))}
W=lambda s:re.findall(r"[\w’'()./-]+",s.lower())
BG={}
def bigrams(fname):
    if fname not in BG:
        t=subprocess.run(['pdftotext','-layout','pdf/'+fname.replace('.cols.txt','.pdf'),'-'],capture_output=True,text=True).stdout
        s=set()
        for line in t.split('\n'):
            for seg in re.split(r' {2,}',line.strip()):
                w=W(seg); s.update(zip(w,w[1:]))
        BG[fname]=s
    return BG[fname]
def score(text,bg):
    w=W(text); b=list(zip(w,w[1:]))
    return sum(1 for x in b if x in bg)/max(1,len(b))
D='/home/user/new-project/docs/apsec/'
md={f:open(f).read() for f in glob.glob(D+'20*.md')}
st=collections.Counter(); rep=[]
for it in old:
    n=new.get((it['file'],it['no']))
    if not n: continue
    fn=it['file'] if it['file'].endswith('.cols.txt') else it['file'][:-4]+'.cols.txt' if it['file'].endswith('.pdf') else it['file']
    try: bg=bigrams(fn)
    except Exception as e: st['nopdf']+=1; continue
    o2=(it['q'].strip(),it['a'].strip()); n2=(n['q'].strip(),n['a'].strip())
    if o2==n2: continue
    so,sn=score(' '.join(o2),bg),score(' '.join(n2),bg)
    A,B=collections.Counter(W(' '.join(o2))),collections.Counter(W(' '.join(n2)))
    sim=sum((A&B).values())/max(sum(A.values()),sum(B.values()))
    okl=all(len(y)>=0.6*len(x) for x,y in zip(o2,n2))
    lost=sum((A-B).values())
    if sim<0.95 or sn<so+0.02 or not okl or lost>max(3,0.02*sum(A.values())): st['keep']+=1; continue
    for k,o,nw in (('q',o2[0],n2[0]),('a',o2[1],n2[1])):
        if not o or o==nw: continue
        f=[f for f in md if o in md[f]]
        if not f: st['notfound']+=1; continue
        if '--dry' not in sys.argv: md[f[0]]=md[f[0]].replace(o,nw,1)
        st['fixed']+=1; rep.append((it['id'],k,round(so,2),round(sn,2)))
print(st, rep[:5])
json.dump(rep,open('fixrep2.json','w'))
if '--dry' not in sys.argv:
    for f,s in md.items(): open(f,'w').write(s)
