"""Compare every APSEC Q/A paragraph with its PDF table cell (cells.json) and,
where they differ, replace the paragraph with the aligned span of the cell text."""
import json,re,sys,difflib,collections,glob
D='/home/user/new-project/docs/apsec/'
items=json.load(open('items3.json')); f_of={}
for i in items: f_of.setdefault(i['date'],i['file'])
C=json.load(open('cells.json'))
norm=lambda w:re.sub(r"[^\w]","",w.lower())
rep=[]; st=collections.Counter(); md={}
for f in sorted(glob.glob(D+'20*.md')):
    L=open(f).read().split('\n'); md[f]=L; cur=None
    for ln,line in enumerate(L):
        m=re.search(r'\{#i(\d{4})(\d{2})(\d{2})(\d+)\}',line)
        if m: cur=(f'{m[1]}-{m[2]}-{m[3]}',int(m[4])); continue
        m=re.match(r"(\*\*(Question 問題|BD's response 屋宇署回覆):\*\* )(.*)",line)
        if not (m and cur): continue
        fn=f_of.get(cur[0]); cells=[c for c in C.get(fn,[]) if c['no']==cur[1]]
        if not cells: st['nocell']+=1; continue
        cell=cells[0]['c1' if m[2][0]=='Q' else 'c2']; S=cell.split(); T=m[3]; tw=T.split()
        sm=difflib.SequenceMatcher(None,[norm(w) for w in tw],[norm(w) for w in S],autojunk=False)
        bl=[b for b in sm.get_matching_blocks() if b.size>=2]
        if not bl: st['nomatch']+=1; rep.append(dict(f=f[-7:],ln=ln+1,why='nomatch',old=T[:120],cell=cell[:200])); continue
        a0=min(bl,key=lambda b:b.b); a1=max(bl,key=lambda b:b.b+b.size)
        start=max(0,a0.b-a0.a); end=min(len(S),a1.b+a1.size+(len(tw)-(a1.a+a1.size)))
        cand=' '.join(S[start:end])
        if [norm(w) for w in cand.split()]==[norm(w) for w in tw]: st['same']+=1; continue
        cov=sum(b.size for b in bl)/len(tw); r=len(cand.split())/len(tw)
        rep.append(dict(f=f[-7:],ln=ln+1,cov=round(cov,2),r=round(r,2),old=T,new=cand))
        st['diff']+=1
        if '--write' in sys.argv and cov>=float(sys.argv[2]): L[ln]=m[1]+cand; st['written']+=1
print(st)
json.dump(rep,open('repair5.json','w'),ensure_ascii=False,indent=0)
if '--write' in sys.argv:
    for f,L in md.items(): open(f,'w').write('\n'.join(L))
