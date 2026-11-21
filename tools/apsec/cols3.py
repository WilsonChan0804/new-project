# Column split from `pdftotext -layout`: per page, the gutter is the character
# column that is blank in the most two-column lines.
import glob,os,subprocess,sys,re
outdir=sys.argv[1]
for f in sorted(glob.glob('pdf/*.pdf')):
    t=subprocess.run(['pdftotext','-layout',f,'-'],capture_output=True,text=True).stdout
    res=[]
    for page in t.split('\f'):
        L=[l.rstrip() for l in page.split('\n')]
        width=max((len(l) for l in L),default=0)
        if not width: continue
        two=[l for l in L if re.search(r'\S {2,}\S',l.strip()) and len(l)>0.6*width]
        best,bc=None,-1
        for c in range(int(0.35*width),int(0.7*width)):
            n=sum(1 for l in two if len(l)>c+2 and l[c]==' ' and l[c-1]==' ')
            if n>bc: best,bc=c,n
        for l in L:
            if not l.strip(): continue
            if best is None or len(l)<=best or not (l[best]==' '):
                # full-width line or a word crossing the gutter: keep it whole on the left
                if best and len(l)>best and re.search(r' {2,}',l[best-15:best+15] or ''):
                    m=re.search(r' {2,}',l[best-15:]); cut=best-15+m.start()
                    res.append(l[:cut].strip()+'\t'+l[cut:].strip()); continue
                res.append(l.strip()+'\t'); continue
            res.append(l[:best].strip()+'\t'+l[best:].strip())
    open(os.path.join(outdir,os.path.basename(f)[:-4]+'.cols.txt'),'w').write('\n'.join(res))
print('ok')
