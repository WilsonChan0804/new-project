import json,re,collections,subprocess,statistics
old={(i['file'],i['no']):i for i in json.load(open('items2.json'))}
new={(i['file'],i['no']):i for i in json.load(open('re3/items.json'))}
W=lambda s:re.findall(r"[\w’'()./-]+",s.lower())
BG={}
def bg(f):
    if f not in BG:
        t=subprocess.run(['pdftotext','-layout','pdf/'+f,'-'],capture_output=True,text=True).stdout
        s=set()
        for line in t.split('\n'):
            for seg in re.split(r' {2,}',line.strip()):
                w=W(seg); s.update(zip(w,w[1:]))
        BG[f]=s
    return BG[f]
def sc(t,b):
    w=W(t); p=list(zip(w,w[1:])); return sum(x in b for x in p)/max(1,len(p))
res=[]
for k,o in old.items():
    n=new.get(k)
    if not n: continue
    b=bg(o['file'])
    so=sc(o['q']+' '+o['a'],b); sn=sc(n['q']+' '+n['a'],b)
    A,B=collections.Counter(W(o['q']+' '+o['a'])),collections.Counter(W(n['q']+' '+n['a']))
    lost=sum((A-B).values()); gain=sum((B-A).values())
    res.append((k,so,sn,lost,gain,sum(A.values())))
print('items',len(res),'old mean',round(statistics.mean(r[1] for r in res),3),'new mean',round(statistics.mean(r[2] for r in res),3))
print('new better',sum(r[2]>r[1]+0.01 for r in res),'worse',sum(r[2]<r[1]-0.01 for r in res))
print('lost>5%',sum(r[3]>0.05*r[5] for r in res),'gain>5%',sum(r[4]>0.05*r[5] for r in res))
json.dump([[list(r[0])]+list(r[1:]) for r in res],open('evalsplit.json','w'))
