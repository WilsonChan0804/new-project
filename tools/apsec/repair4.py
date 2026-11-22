"""Repair APSEC Q/A paragraphs whose text was garbled by the old column split.
For each low-scoring paragraph (mdscore.json), align it with the matching column
stream of the re-split PDF (re4/*.cols.txt) and take the aligned span verbatim."""
import json,re,sys,difflib,collections
D='/home/user/new-project/docs/apsec/'
items=json.load(open('items3.json')); f_of={}
for i in items: f_of.setdefault(i['date'],i['file'])
sc=json.load(open('mdscore.json')); TH=float(sys.argv[1]) if len(sys.argv)>1 and sys.argv[1][0]!='-' else 0.98
norm=lambda w:re.sub(r"[^\w]","",w.lower())
HDR=re.compile(r"^(\d+|\d/\d{4} (ADF|APSEC).*|.*(Discussion Forum|ADF) on \d+ \w+ \d{4})$")
ST={}
def streams(fn):
    if fn not in ST:
        L,R=[],[]
        for l in open('re4/'+fn[:-4]+'.cols.txt',errors='ignore').read().split('\n'):
            a,b=(l.split('\t',1)+[''])[:2]
            for col,t in ((L,a.strip()),(R,b.strip())):
                if t and not HDR.match(t): col.extend(t.split())
        ST[fn]=(L,R)
    return ST[fn]
md={}; rep=[]; st=collections.Counter()
for o in sc:
    if o['score']>=TH: continue
    f=D+o['f']; md.setdefault(f,open(f).read().split('\n'))
    line=md[f][o['ln']-1]; m=re.match(r"(\*\*[^*]+:\*\* )(.*)",line); pre,T=m[1],m[2]
    tw=T.split(); tn=[norm(w) for w in tw]
    best=None
    for ci,S in enumerate(streams(f_of[o['date']])):
        sn=[norm(w) for w in S]
        sm=difflib.SequenceMatcher(None,tn,sn,autojunk=False)
        bl=[b for b in sm.get_matching_blocks() if b.size>=3]
        if not bl: continue
        # cluster blocks around the largest one
        big=max(bl,key=lambda b:b.size); keep=[b for b in bl if abs(b.b-big.b)<len(tw)*1.6+40]
        s0=min(b.b-b.a for b in keep[:1]) ; 
        a0=min(keep,key=lambda b:b.a); a1=max(keep,key=lambda b:b.a+b.size)
        start=max(0,a0.b-a0.a); end=a1.b+a1.size+(len(tw)-(a1.a+a1.size))
        cov=sum(b.size for b in keep)/len(tw)
        if not best or cov>best[0]: best=(cov,ci,start,end,S)
    if not best: st['nomatch']+=1; continue
    cov,ci,start,end,S=best
    cand=' '.join(S[start:end])
    # trim to sentence-like ends matching original first/last tokens
    r=len(cand.split())/len(tw)
    if cov<0.75 or not 0.7<r<1.4: st['skip']+=1; rep.append(dict(o,why='skip',cov=round(cov,2),r=round(r,2))); continue
    if cand==T: st['same']+=1; continue
    rep.append(dict(f=o['f'],ln=o['ln'],k=o['k'],cov=round(cov,2),old=T,new=cand)); st['fix']+=1
    md[f][o['ln']-1]=pre+cand
print(st)
json.dump(rep,open('repair4.json','w'),ensure_ascii=False,indent=0)
if '--write' in sys.argv:
    for f,L in md.items(): open(f,'w').write('\n'.join(L))
