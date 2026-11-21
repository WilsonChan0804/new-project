import re, glob, collections
D = '/home/user/new-project/docs/'
T = [
 ('GFA 總樓面面積', r'\bGFA\b|gross floor area|總樓面面積', 3),
 ('GFA concession 樓面面積寬免', r'GFA concession|disregarded from (the )?GFA|exempt(ed|ion)? from (the )?GFA|樓面面積寬免|10% cap', 2),
 ('Site coverage 上蓋面積', r'site coverage|上蓋面積', 3),
 ('Plot ratio 地積比率', r'plot ratio|地積比率', 3),
 ('Site area & classification 地盤面積及分類', r'site area|site classification|specified street|Class [ABC] site|地盤分類', 2),
 ('Building height 建築物高度', r'building height|height restriction|建築物高度', 2),
 ('Open space 休憩用地', r'open space|空地', 3),
 ('Fire safety 消防安全', r'FS Code|fire safety|消防安全|fire service', 3),
 ('Means of escape 逃生途徑', r'means of escape|\bMOE\b|exit route|travel distance|逃生', 2),
 ('Fire resisting construction 耐火結構', r'\bFRR\b|fire resisting|compartment|耐火', 3),
 ('Means of access 救援通道', r'\bEVA\b|fireman|firefighting and rescue|救援', 2),
 ('Refuge floor 庇護層', r'refuge floor|庇護層', 1),
 ('Staircase 樓梯', r'staircase|樓梯', 4),
 ('Lift 升降機', r'\blifts?\b|升降機', 4),
 ('Barrier free access 無障礙', r'barrier free|\bBFA\b|universal accessib|accessible|無障礙|暢道', 3),
 ('Lighting & ventilation 照明及通風', r'lighting and ventilation|natural lighting|ventilation|prescribed window|照明|通風', 3),
 ('Drainage 排水', r'drainage|drain|sewer|排水', 3),
 ('Plumbing & sanitary 衞生設備', r'sanitary|plumbing|water closet|衞生', 3),
 ('Structural 結構', r'structural|\bRSE\b|結構', 4),
 ('Foundation 地基', r'foundation|pile|地基|樁', 3),
 ('Geotechnical 岩土', r'geotechnical|slope|\bRGE\b|retaining wall|岩土|斜坡', 3),
 ('Excavation & ELS 挖掘', r'excavation|\bELS\b|lateral support|挖掘', 2),
 ('Concrete & materials 混凝土及物料', r'concrete|reinforcement|rebar|materials testing|混凝土|鋼筋', 3),
 ('Wind 風力', r'wind load|wind code|wind effect|風力', 2),
 ('Curtain wall & façade 幕牆及外牆', r'curtain wall|cladding|fa[cç]ade|window wall|幕牆', 2),
 ('Protective barrier 防護欄障', r'protective barrier|balustrade|欄障', 2),
 ('Balcony & utility platform 露台及工作平台', r'balcon|utility platform|工作平台|露台', 2),
 ('Green & amenity features 環保及適意設施', r'green feature|amenity feature|sky garden|greenery|環保設施|適意設施|綠化', 2),
 ('Sustainable building design 可持續建築設計', r'\bSBD\b|sustainable building design|building separation|setback|可持續建築設計', 2),
 ('Plant rooms 機房', r'plant room|E&M|機房', 2),
 ('Car park 停車場', r'car ?park|停車場', 2),
 ('Energy efficiency 能源效率', r'energy efficien|OTTV|能源效率', 2),
 ('Maintenance access 維修通道', r'maintenance access|external maintenance|gondola|M&R|維修', 2),
 ('Plan submission & approval 呈交及審批', r'approval|consent|submission|disapprov|批准|同意|呈交', 5),
 ('Occupation permit 佔用許可證', r'occupation permit|\bOP\b|佔用許可證', 2),
 ('Site supervision 地盤監督', r'supervision|\bTCP\b|監督', 3),
 ('Site safety 地盤安全', r'site safety|hoarding|scaffold|地盤安全|圍板', 2),
 ('Minor works 小型工程', r'minor works|小型工程', 2),
 ('Registration 註冊', r'registration|register of|名冊|註冊', 4),
 ('Demolition 拆卸', r'demolition|拆卸', 2),
 ('A&A works 改動及加建工程', r'A&A|alteration and addition|改動及加建', 2),
 ('Domestic 住用', r'domestic|residential|住用|住宅', 4),
 ('Hotel 酒店', r'\bhotel|酒店|旅館', 2),
 ('Industrial building 工業大廈', r'industrial building|工業大廈|工廈', 2),
 ('Elderly-friendly 長者友善', r'elderly|長者', 2),
 ('Heritage 文物', r'heritage|historic|文物|歷史建築', 2),
 ('Signboard 招牌', r'signboard|招牌', 2),
 ('Refuse 垃圾', r'refuse|垃圾', 2),
 ('Statutory period 法定期限', r'within \*?\*?\d+ days|\d+ days|statutory period|天內', 3),
]
added = collections.Counter(); pages = 0
for p in glob.glob(D + '**/*.md', recursive=True):
    s = open(p).read()
    m = re.match(r'---\ntags:\n((?:  - .*\n)*)((?:[a-z_]+:.*\n)*)---\n', s)
    body = s[m.end():] if m else s
    body_main = re.sub(r'<!-- APSEC START -->.*?<!-- APSEC END -->', '', body, flags=re.S)
    title = (re.search(r'^# (.*)$', body, re.M) or [None, ''])[1]
    old = re.findall(r'  - (.*)', m.group(1)) if m else []
    K = lambda t: re.sub(r'[^\x00-\x7f].*', '', t).strip().lower()
    oldl = {K(o) for o in old}
    new = []
    for tag, pat, th in T:
        n = len(re.findall(pat, body_main, re.I))
        if (re.search(pat, title, re.I) or n >= th) and K(tag) not in oldl and tag not in old:
            new.append((n + (50 if re.search(pat, title, re.I) else 0), tag))
    new = [t for _, t in sorted(new, reverse=True)[:7]]
    if not new: continue
    tags = old + new
    fm = '---\ntags:\n' + ''.join(f'  - {t}\n' for t in tags) + (m.group(2) if m else '') + '---\n'
    s = fm + body
    open(p, 'w').write(s); pages += 1; added.update(new)
print('pages', pages); print(added.most_common(50))
