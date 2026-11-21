import json, re, os
D = '/home/user/new-project/docs/'
it = json.load(open('items3.json'))
MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
fd = lambda d: f'{int(d[8:])} {MON[int(d[5:7])]} {d[:4]}'
def cut(t, n):
    t = re.sub(r'\s+', ' ', t).replace('|', '/').strip()
    if len(t) <= n: return t
    k = t.rfind('. ', 0, n); return (t[:k + 1] if k > n * 0.5 else t[:n].rsplit(' ', 1)[0]) + ' …'
G = {
 'guides/gfa.md': ({'pnap/app-2.md', 'pnap/app-151.md', 'regulations/bpr-23-23a.md', 'pnap/jpn-1.md', 'pnap/jpn-2.md', 'pnap/app-42.md', 'pnap/app-104.md', 'pnap/app-89.md', 'pnap/app-19.md', 'pnap/jpn-4.md'}, r'\bGFA\b|gross floor area|concession|disregard', 16),
 'guides/site-coverage-plot-ratio.md': ({'regulations/bpr-18a-22.md', 'pnap/app-132.md', 'pnap/app-124.md', 'pnap/app-108.md', 'pnap/app-19.md', 'pnap/jpn-7.md', 'pnap/jpn-4.md', 'pnap/jpn-5.md', 'regulations/bpr-23-23a.md'}, r'site coverage|\bSC\b|plot ratio|\bPR\b|site area|open space|site class|height', 14),
}
for page, (refs, kw, n) in G.items():
    sel = [i for i in it if set(i['refs']) & refs and not i['later'] and re.search(kw, i['title'] + ' ' + i['a'], re.I)]
    sel.sort(key=lambda z: (z['date'], z['no']), reverse=True)
    rows = []
    for i in sel[:n]:
        a = f"../apsec/{i['date'][:4]}.md#i{i['id'].replace('-', '')}"
        rows.append(f"- **[{cut(i['title'], 90)}]({a})** <small>{fd(i['date'])}</small><br>{cut(i['a'], 300)}")
    blk = ['<!-- GUIDE APSEC START -->', '## Latest APSEC positions 最新 APSEC 立場 {#apsec-positions}', '',
           f'BD\'s most recent clarifications on this topic from the [APSEC Discussion Forum](../apsec/index.md), newest first. Items later revisited are left out; only the **current position** is shown ({len(sel)} relevant items in total). 屋宇署最新澄清，只列現行立場。', ''] + rows + ['', '<!-- GUIDE APSEC END -->']
    s = open(D + page).read()
    s = re.sub(r'<!-- GUIDE APSEC START -->.*?<!-- GUIDE APSEC END -->', '\n'.join(blk), s, flags=re.S)
    open(D + page, 'w').write(s); print(page, len(sel))
