"""Score each Question / BD response paragraph in docs/apsec/*.md against the
pdftotext -layout segments of its source PDF (share of word bigrams found)."""
import json,re,glob,subprocess,collections,sys
D='/home/user/new-project/docs/apsec/'
items=json.load(open('items3.json'))
f_of={}
for i in items: f_of.setdefault(i['date'],i['file'])
W=lambda s:re.findall(r"[\w’'()./-]+",s.lower())
BG={}
def bigrams(fn):
    if fn not in BG:
        t=subprocess.run(['pdftotext','-layout','pdf/'+fn,'-'],capture_output=True,text=True).stdout
        s=set()
        for line in t.split('\n'):
            for seg in re.split(r' {2,}',line.strip()):
                w=W(seg); s.update(zip(w,w[1:]))
        for col in (0,1):
            for src in ('re4/',):
                try: L=[l.split('\t')[col] if '\t' in l else (l if col==0 else '') for l in open(src+fn[:-4]+'.cols.txt',errors='ignore').read().split('\n')]
                except FileNotFoundError: continue
                w=W(' '.join(L)); s.update(zip(w,w[1:]))
        BG[fn]=s
    return BG[fn]
def plain(t): return re.sub(r'\[([^\]]+)\]\([^)]*\)',r'\1',t)
out=[]
for f in sorted(glob.glob(D+'20*.md')):
    cur=None
    for ln,line in enumerate(open(f),1):
        m=re.search(r'\{#i(\d{4})(\d{2})(\d{2})(\d+)\}',line)
        if m: cur=(f'{m[1]}-{m[2]}-{m[3]}',int(m[4])); continue
        m=re.match(r"\*\*(Question 問題|BD's response 屋宇署回覆):\*\* (.*)",line)
        if m and cur and cur[0] in f_of:
            txt=plain(m[2]); w=W(txt); b=list(zip(w,w[1:])); bg=bigrams(f_of[cur[0]])
            bad=[x for x in b if x not in bg]
            out.append(dict(f=f.split('/')[-1],ln=ln,date=cur[0],no=cur[1],k='q' if m[1][0]=='Q' else 'a',score=round(1-len(bad)/max(1,len(b)),3),n=len(b),bad=[' '.join(x) for x in bad[:8]]))
json.dump(out,open(sys.argv[1] if len(sys.argv)>1 else 'mdscore.json','w'),ensure_ascii=False,indent=0)
c=collections.Counter()
for o in out: c['<0.90' if o['score']<0.9 else '<0.95' if o['score']<0.95 else '<0.98' if o['score']<0.98 else 'ok']+=1
print(len(out),c)
