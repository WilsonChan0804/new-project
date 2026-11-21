import json, re, os, difflib, collections
D = '/home/user/new-project/docs/'
it = json.load(open('items2.json'))
meta = json.load(open('../b10/meta.json'))
old2new = {}
for k, v in meta.items():
    if v.get('old') and v['old'].startswith('PNAP'):
        n = v['old'].split()[1]
        old2new[n] = (k if '-' in k else f'APP-{k}')
exists = lambda p: os.path.exists(D + p)

def bpr_page(n):
    m = re.match(r'(\d+)([A-Z]?)', n); x = int(m.group(1))
    if x <= 16: return 'regulations/bpr-parts-1-2.md'
    if n.startswith('18A') or 19 <= x <= 22: return 'regulations/bpr-18a-22.md'
    if x == 23: return 'regulations/bpr-23-23a.md'
    if 24 <= x <= 38: return 'regulations/bpr-24-37.md'
    if 39 <= x <= 49: return 'regulations/bpr-39-49e.md'
    if 50 <= x <= 70: return 'regulations/bpr-50-70.md'
    return 'regulations/bpr-71-73.md'

def bo_page(n):
    m = re.match(r'(\d+)([A-Z]*)', n); x = int(m.group(1))
    if x <= 13: return 'regulations/bo-part-1-registration.md'
    if x <= 21: return 'regulations/bo-part-2-building-works.md'
    if x <= 30 and not (x == 30 and m.group(2)): return 'regulations/bo-part-2-enforcement.md'
    if x == 30: return 'regulations/bo-part-2a-inspection.md'
    if x <= 39: return 'regulations/bo-part-3-miscellaneous.md'
    return 'regulations/bo-parts-4-9-schedules.md'

CODES = [
 (r'Fire Safety Code|FS Code|Code of Practice for Fire Safety', None),
 (r'Barrier Free Access|BFA 2008|Design Manual:? Barrier|DM 2008', 'codes/bfa-2008.md'),
 (r'Universal Accessibility|DMUA', 'pnap/app-176.md'),
 (r'Wind Code|Wind Effects', 'pnap/app-139.md'),
 (r'Foundation Code|Code of Practice for Foundations', 'pnap/app-18.md'),
 (r'Concrete Code|Structural Use of Concrete', 'pnap/app-142.md'),
 (r'Steel Code|Structural Use of Steel', 'pnap/app-168.md'),
 (r'Glass Code|Structural Use of Glass', 'pnap/app-171.md'),
 (r'Precast Concrete Code|Precast Concrete Construction', 'pnap/app-174.md'),
 (r'Supervision Code|Code of Practice for Site Supervision|Technical Memorandum for Supervision', 'pnap/app-157.md'),
 (r'Demolition Code|Demolition of Buildings', 'pnap/app-170.md'),
 (r'B\(MW\)R|Minor Works Regulation|minor works item', 'regulations/bmwr-123n.md'),
 (r'B\(A\)R|Building \(Administration\)', 'regulations/bar-123a.md'),
 (r'B\(C\)R|Building \(Construction\) Regulation', 'regulations/bcr-123q.md'),
 (r'Drainage Regulations|B\(SSFPDWL\)R|B\(SSF', 'regulations/bsfpwr-123i.md'),
 (r'refuse storage|RSMRC|RSMRR|refuse chute', 'regulations/brsr-123h.md'),
 (r'MBIS|MWIS|Mandatory (Building|Window) Inspection', 'regulations/bir-123p.md'),
 (r'Energy Efficiency\) Regulation|OTTV', 'regulations/beer-123m.md'),
 (r'Private Streets and Access Roads', 'regulations/bpsar-123g.md'),
 (r'Demolition Works\) Regulations', 'regulations/bdwr-123c.md'),
 (r'Ventilating Systems', 'regulations/bvsr-123j.md'),
]
FSC = {'B': 'codes/fsc-part-b-means-of-escape.md', 'C': 'codes/fsc-part-c-fire-resisting-construction.md',
       'D': 'codes/fsc-part-d-means-of-access.md', 'E': 'codes/fsc-parts-e-f-g.md', 'F': 'codes/fsc-parts-e-f-g.md', 'G': 'codes/fsc-parts-e-f-g.md'}

def refs(text):
    out = []
    for s, n in re.findall(r'\b(APP|ADM|ADV)[-–\s]?(\d{1,3})\b', text):
        p = f'pnap/{s.lower()}-{int(n)}.md'
        if exists(p): out.append(p)
    for n in re.findall(r'\bJPN\s?(\d)\b', text):
        p = f'pnap/jpn-{n}.md'
        if exists(p): out.append(p)
    for n in re.findall(r'\bPNAP\s(\d{1,3})\b', text):
        if n in old2new:
            p = 'pnap/' + old2new[n].lower() + '.md'
            if exists(p): out.append(p)
    for n in re.findall(r'B\(P\)R\s?(?:regulation\s)?(\d{1,2}[A-Z]?)', text):
        out.append(bpr_page(n))
    for n in re.findall(r'regulation\s(\d{1,2}[A-Z]?)(?:\([^)]*\))*\s+of\s+the\s+(?:Building \(Planning\)|B\(P\)R)', text):
        out.append(bpr_page(n))
    for n in re.findall(r'(?:section|s\.)\s?(\d{1,2}[A-Z]?)(?:\([^)]*\))*\s+of\s+the\s+(?:BO|Buildings Ordinance)', text):
        out.append(bo_page(n))
    for n in re.findall(r'\bBO\s+s(?:ection)?\.?\s?(\d{1,2}[A-Z]?)', text):
        out.append(bo_page(n))
    for pat, p in CODES:
        if re.search(pat, text, re.I):
            if p is None:
                cl = re.findall(r'(?:Clause|clause|Subsection|Section|Table|Part)\s([BCDEFG])\d', text)
                out += [FSC[c] for c in cl] or ['codes/fire-safety-code-2011.md']
                if 'FSC' in text or True: pass
            else:
                out.append(p)
    # FS code clause references like "Clause B8.2" even without code name
    if re.search(r'FS Code|Fire Safety', text):
        out += [FSC[c] for c in re.findall(r'\b(?:Clause|Table|Subsection)\s([BCDEFG])\d', text)]
    seen = []
    for p in out:
        if p not in seen and exists(p): seen.append(p)
    return seen

for i in it:
    i['refs'] = refs(i['title'] + ' ' + i['q'] + ' ' + i['a'])
    i['primary'] = refs(i['title'])[:1] or i['refs'][:1]
    i['id'] = f"{i['date']}-{i['no']}"

# group same question: same primary ref and similar normalised title
def norm(t):
    t = re.sub(r'\(.*?\)', ' ', t.lower())
    t = re.sub(r'\b(pnap|app|adm|adv|jpn|clause|para(graph)?|b\(p\)r|regulation|item|follow[- ]?up|on|of|the|and|for|in|under|to|a|an|by|with|requirement[s]?)\b', ' ', t)
    return re.sub(r'[^a-z ]', ' ', re.sub(r'\d+', ' ', t)).split()
items_sorted = sorted(it, key=lambda x: (x['date'], x['no']))
import glob
lab={}
for f in glob.glob('pdf/*.cols.txt'):
    m=re.search(r'(\d)\s*/\s*(\d{4})', open(f).read(400))
    if m: lab[(m.group(1),m.group(2))]=os.path.basename(f)[:-9]+'.pdf'
byfile_no={(x['file'],x['no']):x for x in items_sorted}
for x in items_sorted: x['later']=[]; x['earlier']=[]; x['see']=[]
NS=re.compile(r'under review|in due course|Members noted|would be advised|under deliberation|withdrawn|still in progress|conveyed to|would review|being reviewed|being studied',re.I)
def link(a,b):
    if a['date']==b['date']: return
    if NS.search(b['a'][:200]) and len(b['a'])<400:
        if b['id'] not in a['see']: a['see'].append(b['id']); b['see'].append(a['id'])
        return
    if b['id'] not in a['later']: a['later'].append(b['id'])
    if a['id'] not in b['earlier']: b['earlier'].append(a['id'])
for b in items_sorted:
    txt=b['title']+' '+b['q']+' '+b['a']
    for no,n,y in re.findall(r'[Ii]tem\s*(\d+)(?:\s*\([a-z0-9]+\))?\s*(?:of|in|under)\s*(?:the\s*)?(?:ADF|APSEC\s*Discussion\s*Forum|APSEC\s*DF|DF)\s*(?:No\.\s*)?(\d)\s*/\s*(\d{4})',txt):
        f=lab.get((n,y)); a=byfile_no.get((f,int(no))) if f else None
        if a and a['date']<b['date']: link(a,b)
for ai,a in enumerate(items_sorted):
    na=' '.join(norm(a['title']))
    for b in items_sorted[ai+1:]:
        if not a['primary'] or a['primary']!=b['primary']: continue
        r=difflib.SequenceMatcher(None,na,' '.join(norm(b['title']))).ratio()
        if r>=0.86 and len(na)>8: link(a,b)
        elif r>=0.6: a['see'].append(b['id']); b['see'].append(a['id'])
json.dump(items_sorted, open('items3.json', 'w'), ensure_ascii=False)
print(len(it), 'superseded', sum(1 for i in it if i['later']), 'see', sum(1 for i in it if i['see']))
