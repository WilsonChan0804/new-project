import pymupdf, json, os, re, sys, collections
OUT = '/tmp/claude-0/-home-user-new-project/71589f80-8c33-5535-a176-27ac1c9151af/scratchpad/apsec/out4/'
os.makedirs(OUT, exist_ok=True)
it = json.load(open('items3.json'))
byfile = collections.defaultdict(list)
for i in it: byfile[i['file']].append(i)
res = collections.defaultdict(list)
only = sys.argv[1] if len(sys.argv) > 1 else None

def merge(rects, gap=12):
    rects = [pymupdf.Rect(r) for r in rects]
    changed = True
    while changed:
        changed = False
        out = []
        while rects:
            r = rects.pop()
            for k, o in enumerate(out):
                if (r + (-gap, -gap, gap, gap)).intersects(o):
                    out[k] = o | r; changed = True; break
            else:
                out.append(r)
        rects = out
    return rects

for f, items in byfile.items():
    if only and only not in f: continue
    doc = pymupdf.open('pdf/' + f)
    # heading anchors: (page, y) of each item heading
    anchors = []
    for i in sorted(items, key=lambda z: z['no']):
        key = re.sub(r'\s+', ' ', i['title'])[:28]
        found = None
        for pno in range(len(doc)):
            for r in doc[pno].search_for(key):
                r = r * doc[pno].rotation_matrix
                if r.x0 < doc[pno].rect.width * 0.4:
                    found = (pno, r.y0); break
            if found: break
        if found: anchors.append((found, i))
    anchors.sort(key=lambda a: a[0])
    for pno in range(len(doc)):
        pg = doc[pno]; W, H = pg.rect.width, pg.rect.height
        RM = pg.rotation_matrix
        cand = [(pymupdf.Rect(x['bbox']) * RM) & pg.rect for x in pg.get_image_info() if pymupdf.Rect(x['bbox']).width > 6 and pymupdf.Rect(x['bbox']).height > 6]
        cand = [r for r in merge(cand, 3) if r.width > 40 and r.height > 30]
        dr = [d['rect'] * RM for d in pg.get_drawings()]
        vx = collections.Counter(round(r.x0) for r in dr if r.width < 2.5 and r.height > 8)
        cols = {x for x, c in vx.items() if c >= 3}
        vec = [r for r in dr if not ((r.width < 2.5 and any(abs(r.x0 - x) <= 3 for x in cols)) or (r.height < 2.5 and r.width > W * 0.25) or (r.width > W * 0.8 and r.height > H * 0.5))]
        for cl in merge(vec, 6):
            n = sum(1 for r in vec if cl.contains(r))
            words = len(pg.get_text('words', clip=cl))
            if n >= 30 and n >= 1.5 * words and cl.width < W * 0.85: cand.append(cl)
        regs = [r for r in merge(cand) if r.width > 60 and r.height > 45 and r.width * r.height > 6000]
        for r in regs:
            # include text inside the drawing area (labels): expand slightly
            r = (r + (-6, -6, 6, 6)) & pg.rect
            # owner item: last anchor at or before (pno, r.y0)
            own = None
            for (ap, ay), i in anchors:
                if (ap, ay) <= (pno, r.y1): own = i
            if not own: continue
            n = len(res[own['id']]) + 1
            name = f"{own['id']}-{n}.png"
            if len(res[own['id']]) >= 6: continue
            try:
                pix = pg.get_pixmap(clip=r, dpi=150, colorspace=pymupdf.csGRAY)
            except Exception: continue
            sm = pix.samples; dark = sum(1 for b in sm[::7] if b < 200) / max(1, len(sm[::7]))
            if dark < 0.015: continue
            pix.save(OUT + name)
            res[own['id']].append({'img': name, 'w': int(r.width * 1.35)})
json.dump(res, open('figs.json', 'w'))
print(len(res), 'items with figures;', sum(len(v) for v in res.values()), 'figures')
