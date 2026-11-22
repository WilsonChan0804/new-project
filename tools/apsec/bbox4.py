"""Two-column split for APSEC/ADF summaries using a document-wide gutter.
Per-page thresholds are only used when the page has enough right-column line starts
close to the document gutter; otherwise the document gutter is used (fixes continuation
pages whose right column is empty, where justified gaps were mistaken for the gutter)."""
import re,glob,os,collections,subprocess,html,sys
src,dst=sys.argv[1],sys.argv[2]
os.makedirs(dst,exist_ok=True)
def pages(f):
    t=os.path.join(dst,'tmp.html')
    subprocess.run(['pdftotext','-bbox',f,t],stderr=subprocess.DEVNULL)
    s=open(t,errors='ignore').read()
    for pg in re.finditer(r'<page width="([\d.]+)" height="([\d.]+)">(.*?)</page>',s,re.S):
        W=[(float(a),float(b),float(c),html.unescape(t)) for a,b,c,t in re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="[\d.]+">(.*?)</word>',pg.group(3))]
        lines=collections.defaultdict(list); key=None; ly=-99
        for w in sorted(W,key=lambda w:w[1]):
            if w[1]-ly>3.0: key=w[1]; ly=w[1]
            lines[key].append(w)
        yield float(pg.group(1)),{k:sorted(v) for k,v in lines.items()}
def starts(pw,lines):
    c=collections.Counter()
    for ws in lines.values():
        for i,w in enumerate(ws):
            if i>0 and w[0]-ws[i-1][2]>8 and 0.38*pw<w[0]<0.75*pw: c[round(w[0]/2)*2]+=1
    return c
for f in sorted(glob.glob(src+'/*.pdf')):
    P=list(pages(f))
    tot=collections.Counter()
    for pw,lines in P:
        for x,n in starts(pw,lines).items(): tot[(round(pw),x)]+=n
    res=[]
    for pw,lines in P:
        cand=[(n,x) for (w,x),n in tot.items() if w==round(pw)]
        thr_f=max(cand)[1] if cand else pw
        pc=starts(pw,lines); near=[(n,x) for x,n in pc.items() if abs(x-thr_f)<=12]
        thr=(max(near)[1] if near and max(near)[0]>=3 else thr_f)-4
        for k in sorted(lines):
            ws=lines[k]; cut=len(ws)
            for i,w in enumerate(ws):
                if w[0]>=thr and (i==0 or w[0]-ws[i-1][2]>6 or ws[i-1][0]>=thr): cut=i; break
            res.append(' '.join(w[3] for w in ws[:cut])+'\t'+' '.join(w[3] for w in ws[cut:]))
    open(os.path.join(dst,os.path.basename(f)[:-4]+'.cols.txt'),'w').write('\n'.join(res))
print('ok')
