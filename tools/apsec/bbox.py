import re,glob,os,collections,subprocess,html
for f in sorted(glob.glob('pdf/*.pdf')):
    out='pdf/'+os.path.basename(f)[:-4]+'.cols.txt'
    subprocess.run(['pdftotext','-bbox',f,'tmp.html'],stderr=subprocess.DEVNULL)
    s=open('tmp.html',errors='ignore').read()
    res=[]
    for pg in re.finditer(r'<page width="([\d.]+)" height="([\d.]+)">(.*?)</page>',s,re.S):
        pw=float(pg.group(1)); W=[(float(a),float(b),float(c),html.unescape(t)) for a,b,c,t in re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="[\d.]+">(.*?)</word>',pg.group(3))]
        if not W: continue
        # line starts: words whose left neighbour on the same line is far away or none
        W.sort(key=lambda w:(round(w[1]),w[0]))
        starts=collections.Counter()
        lines=collections.defaultdict(list)
        W.sort(key=lambda w:w[1]); key=None; ly=-99
        for w in W:
            if w[1]-ly>3.0: key=w[1]; 
            ly=w[1] if w[1]-ly>3.0 else ly
            lines[key].append(w)
        for k,ws in lines.items():
            ws.sort()
            for i,w in enumerate(ws):
                if i==0 or w[0]-ws[i-1][2]>8: starts[round(w[0])]+=1
        cand=[(c,x) for x,c in starts.items() if 0.38*pw<x<0.75*pw]
        thr=max(cand)[1]-4 if cand else pw
        for k in sorted(lines):
            ws=sorted(lines[k]); L=' '.join(w[3] for w in ws if w[0]<thr); R=' '.join(w[3] for w in ws if w[0]>=thr)
            res.append(L+'\t'+R)
    open(out,'w').write('\n'.join(res))
print('ok')
