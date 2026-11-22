"""Extract APSEC/ADF summary items from the PDF table cells (pdfplumber).
Title = leading bold text of the discussion cell. Output cells.json:
{file: [{no, title, q, a}]} (q/a with paragraphs joined by spaces)."""
import pdfplumber,glob,json,os,re,sys
def join(t):
    t=(t or '').replace('­','')
    t=re.sub(r'(\w)-\n(\w)',r'\1-\2',t)
    return re.sub(r'\s+',' ',t).strip()
TF=set(); MED={}; NEST={}
def bold(c): return bool(re.search(r'Bold|Black|Heavy|,B\b|-B\b',c.get('fontname',''))) or c.get('fontname') in TF
def chars(pg,c):
    if not c: return []
    x0,t0,x1,b1=c
    if pg not in MED:
        sz=sorted(round(x['size'],1) for x in pg.chars if x['text'].strip())
        MED[pg]=sz[len(sz)//2] if sz else 0
    inner=[b for b in NEST.get(pg,[]) if b[0]>=x0-1 and b[2]<=x1+1 and b[1]>=t0-1 and b[3]<=b1+1 and (b[2]-b[0])*(b[3]-b[1])<0.9*(x1-x0)*(b1-t0)]
    inb=lambda x:any(b[0]-1<=x['x0'] and x['x1']<=b[2]+1 and b[1]-1<=x['top'] and x['bottom']<=b[3]+1 for b in inner)
    ch=[x for x in pg.chars if not inb(x) and x.get('upright',True) and x0-0.5<=(x['x0']+x['x1'])/2<=x1+0.5 and t0-0.5<=(x['top']+x['bottom'])/2<=b1+0.5]
    ch.sort(key=lambda x:(round(x['top']/3),x['x0']))
    # group into lines by top
    L=[];cur=[];ly=None
    for x in sorted(ch,key=lambda x:x['top']):
        if ly is None or abs(x['top']-ly)>2.5: cur=[];L.append(cur);ly=x['top']
        cur.append(x)
    out=[]
    L=[ln for ln in L if any(x['size']>=0.85*MED[pg] for x in ln if x['text'].strip())]
    for ln in L:
        ln.sort(key=lambda x:x['x0'])
        for i,x in enumerate(ln):
            if i and x['x0']-ln[i-1]['x1']>0.2*x['size'] and x['text']!=' ' and ln[i-1]['text']!=' ': out.append(dict(x,text=' ',fontname=x['fontname']))
            out.append(x)
        out.append(dict(ln[-1],text='\n'))
    return out
def render(ch): return ''.join(x['text'] for x in ch)
HEAD=re.compile(r'^(Item|Items|Discussion|Response|BD.?s? [Rr]esponse|Items? discussed)\b')
out={}
def run(f):
    items=[]; cur=None; ff=__import__('collections').Counter()
    pdf=pdfplumber.open(f)
    for pg in pdf.pages:
        TBS=pg.find_tables(); NEST[pg]=[t.bbox for t in TBS if max((len(r.cells) for r in t.rows),default=0)>=2]
        for tb in TBS:
            for row in tb.rows:
                cells=[c for c in row.cells]
                live=[c for c in cells if c]
                if len(cells)<3 or len(live)<2: continue
                y0=min(c[1] for c in live); y1=max(c[3] for c in live)
                first=cells[0] or live[0]; last=cells[-1] or live[-1]
                cells=[first,(first[2],y0,last[0],y1),(last[0],y0,last[2],y1)]
                CH=[chars(pg,c) for c in cells]
                txt=[render(x) for x in CH]
                if HEAD.match(txt[-2].strip()) and HEAD.match(txt[-1].strip()): continue
                n=re.match(r'^\s*(\d{1,2})\.?\s*$',txt[0])
                if n and items and not (0<int(n[1])-items[-1]['no']<=2): n=None
                if n:
                    ch=CH[-2]; k=0
                    if ch: ff[next((x['fontname'] for x in ch if x['text'].strip()),'')]+=1
                    lt=None
                    while k<len(ch) and (bold(ch[k]) or not ch[k]['text'].strip()):
                        if ch[k]['text'].strip():
                            if lt is not None and ch[k]['top']-lt>1.9*ch[k]['size']: break
                            lt=ch[k]['top']
                        k+=1
                    cur={'no':int(n[1]),'title':join(render(ch[:k])),'c1':[],'c2':[]}; items.append(cur)
                    cur['c1'].append(render(ch[k:])); cur['c2'].append(txt[-1]); continue
                if cur is None: continue
                cur['c1'].append(txt[-2]); cur['c2'].append(txt[-1])
    return items,ff
for f in sorted(glob.glob(sys.argv[1]+'/*.pdf')):
    TF.clear(); items,first=run(f)
    if items and not any(i['title'].strip() for i in items) and first:
        TF.add(first.most_common(1)[0][0]); items,first=run(f)
    for it in items:
        c1=join('\n'.join(it.pop('c1'))); it['a']=join('\n'.join(it.pop('c2')))
        it['q']=c1
    out[os.path.basename(f)]=items
json.dump(out,open('cells.json','w'),ensure_ascii=False,indent=0)
allit=[i for v in out.values() for i in v]
print(len(out),'files',len(allit),'items; empty title',sum(not i['title'] for i in allit),'empty q',sum(not i['q'] for i in allit),'empty a',sum(not i['a'] for i in allit))
