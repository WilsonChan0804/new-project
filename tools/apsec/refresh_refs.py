"""Refresh APSEC reference lines on other pages (title + BD response excerpt)
from the current docs/apsec/*.md content."""
import re,glob,sys
D='/home/user/new-project/docs/'
item={}
for f in glob.glob(D+'apsec/20*.md'):
    y=f[-7:-3]; cur=None
    for line in open(f):
        m=re.match(r'^### \d+\. (.*?) \{#(i\d+)\}$',line)
        if m: cur=m[2]; item[(y,cur)]={'t':m[1],'a':''}; continue
        m=re.match(r"\*\*BD's response 屋宇署回覆:\*\* (.*)",line)
        if m and cur: item[(y,cur)]['a']=m[1].strip()
def ex(a,n=220):
    if len(a)<=n: return a
    c=a[:n]; c=c[:c.rfind(' ')] if ' ' in c else c
    return c.rstrip(',;:')+' …'
pat=re.compile(r"^(\s*- \*\*\[)(.*?)(\]\((?:\.\./)*apsec/(\d{4})\.md#(i\d+)\)\*\* <small>[^<]*</small><br>)(.*)$")
ch=0; files=0
for f in glob.glob(D+'**/*.md',recursive=True):
    if '/apsec/' in f: continue
    L=open(f).read().split('\n'); mod=False
    for i,line in enumerate(L):
        m=pat.match(line)
        if not m: continue
        it=item.get((m[4],m[5]))
        if not it: print('missing',f,m[5]); continue
        new=m[1]+it['t']+m[3]+ex(it['a'])
        if new!=line: L[i]=new; ch+=1; mod=True
    if mod:
        files+=1
        if '--write' in sys.argv: open(f,'w').write('\n'.join(L))
print('lines changed',ch,'files',files)
