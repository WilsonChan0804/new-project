OUT = '/home/user/new-project/docs/assets/figures/diagrams/'
OR, TINT, BR, DK, GR, LG = '#F08020', '#FFF1E6', '#B34A22', '#3B2A1F', '#78716C', '#E7E5E4'
FONT = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,PingFang TC,Microsoft JhengHei,Noto Sans CJK TC,sans-serif"

def svg(name, w, h, body):
    s = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" font-family="{FONT}" font-size="13" fill="{DK}">'
         f'<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="{BR}"/></marker></defs>'
         f'<rect width="{w}" height="{h}" fill="#fff"/>{body}</svg>')
    open(OUT + name + '.svg', 'w').write(s)

def T(x, y, t, size=13, anchor='middle', weight='normal', fill=DK):
    return f'<text x="{x}" y="{y}" font-size="{size}" text-anchor="{anchor}" font-weight="{weight}" fill="{fill}">{t}</text>'
def R(x, y, w, h, fill=TINT, stroke=OR, sw=1.5, extra=''):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" {extra}/>'
def L(x1, y1, x2, y2, c=BR, sw=1.5, dash=''):
    d = f' stroke-dasharray="{dash}"' if dash else ''
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{c}" stroke-width="{sw}"{d}/>'
def DIM(x1, y1, x2, y2, label, off=0, above=True):
    # dimension line with arrows both ends
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    ty = my - 6 if above else my + 16
    return (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{BR}" stroke-width="1.2" marker-start="url(#ar)" marker-end="url(#ar)"/>'
            + T(mx, ty, label, 12, weight='bold', fill=BR))

# 1 Street cross-section (B(PSAR) regs 5, 19-21)
b = ''
gy = 200
b += f'<path d="M40,{gy} L170,{gy+4} L170,{gy-14} L195,{gy-14}" fill="none" stroke="{GR}" stroke-width="2"/>'
b += R(40, gy - 14, 130, 18, fill=LG, stroke=GR, sw=1)
b += f'<path d="M195,{gy+6} Q365,{gy-14} 535,{gy+6}" fill="{TINT}" stroke="{OR}" stroke-width="2"/>'
b += R(560, gy - 14, 130, 18, fill=LG, stroke=GR, sw=1)
b += R(170, gy - 14, 25, 20, fill='#D6D3D1', stroke=GR, sw=1) + R(535, gy - 14, 25, 20, fill='#D6D3D1', stroke=GR, sw=1)
b += T(105, gy + 32, 'Footpath 行人路') + T(365, gy + 32, 'Carriageway 車路') + T(625, gy + 32, 'Footpath 行人路')
b += DIM(40, 120, 182, 120, '≥ 3.7 m') + DIM(182, 120, 547, 120, '≥ 7.3 m (major, residential)') + DIM(547, 120, 690, 120, '≥ 3.7 m')
b += T(365, 165, 'camber 路拱 1 : 40', 12, fill=GR) + T(105, 180, 'crossfall 橫坡 1 : 48 →', 12, fill=GR) + T(625, 180, '← crossfall 1 : 48', 12, fill=GR)
b += T(182, 245, 'granite kerb 150 × 300 mm', 11, fill=GR) + T(182, 260, 'upstand 高出 75–175 mm', 11, fill=GR)
b += T(365, 285, 'Concrete ≥ 150 mm on ≥ 75 mm hardcore (or bitumen macadam 75 + 25 mm on 200 mm) 混凝土 ≥150 毫米', 11, fill=GR)
b += T(365, 30, 'Residential major private street — minimum widths 住宅區主要私家街道最小闊度', 15, weight='bold')
b += T(365, 52, 'Minor: 5.5 m + 2.75 m · Industrial / mixed: 10.5 m (major), 7.3 m (minor) · Access road: 5 m + 1.6 m', 12, fill=GR)
svg('street-section', 730, 300, b)

# 2 Site classification A/B/C (B(P)R 18A)
b = T(390, 26, 'Site classes by abutting specified streets ≥ 4.5 m 按毗連指明街道劃分的地盤類別', 15, weight='bold')
def site(ox, label, streets, note):
    s = R(ox + 40, 70, 140, 110, fill=TINT, stroke=OR, sw=2) + T(ox + 110, 130, 'SITE 地盤', 13, weight='bold', fill=BR)
    if 'S' in streets: s += R(ox + 20, 186, 180, 26, fill=LG, stroke=GR, sw=1) + T(ox + 110, 204, 'street 街道', 11, fill=GR)
    if 'E' in streets: s += R(ox + 186, 50, 26, 162, fill=LG, stroke=GR, sw=1)
    if 'N' in streets: s += R(ox + 20, 38, 192, 26, fill=LG, stroke=GR, sw=1) + T(ox + 110, 56, 'street 街道', 11, fill=GR)
    s += T(ox + 110, 240, label, 15, weight='bold', fill=BR) + T(ox + 110, 260, note, 11, fill=GR)
    return s
b += site(10, 'Class A 甲類', 'S', 'one street 一條街道')
b += site(270, 'Class B 乙類', 'SE', 'corner, 2 streets, ≥ 40% of boundary')
b += site(530, 'Class C 丙類', 'NSE', '3 streets, ≥ 60% of boundary')
b += T(390, 292, 'Example (domestic, building > 61 m): SC 33.33% / 37.5% / 40% · PR 8 / 9 / 10 — First Schedule, B(P)R 20–21', 12)
svg('site-class', 780, 310, b)

# 3 Dead-end vs two-direction travel (FS Code B / APP-92)
b = T(380, 26, 'Means of escape: dead end vs two directions 盡頭路與雙向逃生', 15, weight='bold')
b += R(30, 60, 330, 200, fill='#fff', stroke=GR, sw=1) + T(195, 50, 'Dead end 盡頭路', 13, weight='bold', fill=BR)
b += R(50, 80, 110, 80) + T(105, 125, 'Room 房間')
b += R(50, 175, 290, 30, fill=LG, stroke=GR, sw=1) + T(250, 195, 'corridor 走廊', 11, fill=GR)
b += R(300, 215, 40, 40, fill='#FDE3CC', stroke=BR) + T(320, 240, 'Exit', 11)
b += f'<polyline points="105,160 105,190 320,190 320,215" fill="none" stroke="{BR}" stroke-width="2" stroke-dasharray="6 4" marker-end="url(#ar)"/>'
b += T(195, 280, 'one direction only: ≤ 18 m to exit or to the point', 12, fill=BR) + T(195, 296, 'where two directions are available 單向 ≤ 18 米', 12, fill=BR)
b += R(400, 60, 330, 200, fill='#fff', stroke=GR, sw=1) + T(565, 50, 'Two directions 雙向', 13, weight='bold', fill=BR)
b += R(420, 175, 290, 30, fill=LG, stroke=GR, sw=1)
b += R(510, 80, 110, 80) + T(565, 125, 'Room 房間')
b += R(410, 215, 40, 40, fill='#FDE3CC', stroke=BR) + T(430, 240, 'Exit', 11) + R(670, 215, 40, 40, fill='#FDE3CC', stroke=BR) + T(690, 240, 'Exit', 11)
b += f'<polyline points="565,160 565,190 430,190 430,215" fill="none" stroke="{BR}" stroke-width="2" stroke-dasharray="6 4" marker-end="url(#ar)"/>'
b += f'<polyline points="565,190 690,190 690,215" fill="none" stroke="{BR}" stroke-width="2" stroke-dasharray="6 4" marker-end="url(#ar)"/>'
b += T(565, 280, 'normal direct / travel distance limits', 12, fill=BR) + T(565, 296, 'of Table B (FS Code B11) 一般距離限制', 12, fill=BR)
svg('moe-deadend', 760, 310, b)

# 4 Spandrel / projection (FS Code C / APP-123)
b = T(380, 26, 'Vertical fire separation between floors 樓層之間的垂直防火分隔', 15, weight='bold')
def facade(ox, title, mode):
    s = T(ox + 110, 54, title, 13, weight='bold', fill=BR)
    s += L(ox + 60, 70, ox + 60, 300, GR, 2)
    for fy in (120, 230):
        s += R(ox + 60, fy, 150, 12, fill='#D6D3D1', stroke=GR, sw=1)
    s += R(ox + 40, 80, 20, 40, fill='#DBEAFE', stroke=GR, sw=1) + R(ox + 40, 190, 20, 40, fill='#DBEAFE', stroke=GR, sw=1)
    if mode == 'spandrel':
        s += R(ox + 44, 120, 16, 70, fill='#FDE3CC', stroke=BR) + DIM(ox + 25, 120, ox + 25, 190, '', 0)
        s += T(ox + 125, 165, '≥ 900 mm spandrel', 12, weight='bold', fill=BR) + T(ox + 125, 181, '窗間牆 (wall, FRR)', 11, fill=GR)
    else:
        s += R(ox + 60 - 0, 120, 1, 1) + R(ox - 0, 128, 60, 10, fill='#FDE3CC', stroke=BR)
        s += DIM(ox, 150, ox + 60, 150, '', 0)
        s += T(ox + 175, 158, '≥ 500 mm projection', 12, weight='bold', fill=BR) + T(ox + 175, 174, '(FS Code) 伸建物', 11, fill=GR)
        s += T(ox + 175, 196, '1996 FRC Code: 900 mm apron', 11, fill=GR) + T(ox + 175, 211, '(APP-123) 舊守則 900 毫米簷板', 11, fill=GR)
    return s
b += facade(60, 'Option 1: spandrel 窗間牆', 'spandrel') + facade(420, 'Option 2: projection 水平伸建物', 'proj')
b += T(380, 320, 'Not needed where the building is sprinklered (FS Code C11); check Part C for FRR and balcony exceptions. 設花灑者毋須設置。', 12, fill=GR)
svg('spandrel', 760, 335, b)

# 5 EVA plan (FS Code D)
b = T(380, 26, 'Emergency vehicular access (EVA), plan 緊急車輛通道平面', 15, weight='bold')
b += R(260, 70, 240, 150, fill=TINT, stroke=OR, sw=2) + T(380, 150, 'BUILDING 建築物', 14, weight='bold', fill=BR)
b += R(150, 250, 460, 50, fill=LG, stroke=GR, sw=1) + T(380, 280, 'EVA ≥ 7.3 m carriageway (or ≥ 6 m hard-paved) 車路', 12, weight='bold')
b += DIM(560, 220, 560, 250, '') + T(600, 240, '≤ 10 m', 12, weight='bold', fill=BR)
b += f'<line x1="260" y1="226" x2="500" y2="226" stroke="{OR}" stroke-width="5"/>' + T(380, 244, 'serves ≥ ¼ of building perimeter 服務 ≥ ¼ 周界', 11, fill=BR)
b += T(380, 330, 'Headroom ≥ 4.5 m · gradient ≤ 1 : 10 · design vehicle 30 t, 12 m, 26 m turning circle 淨空 4.5 米、坡度 1:10', 12, fill=GR)
b += T(380, 348, 'Industrial buildings: EVA to two opposite façades 工業建築物須兩個相對立面 (FS Code Part D)', 12, fill=GR)
svg('eva-plan', 760, 365, b)

# 6 Hoarding / covered walkway section (APP-23)
b = T(380, 26, 'Covered walkway on pavement, section 行人路上的有蓋行人道剖面', 15, weight='bold')
b += R(40, 240, 280, 20, fill=LG, stroke=GR, sw=1) + T(180, 280, 'SITE 地盤', 12, fill=GR)
b += L(320, 60, 320, 240, BR, 3) + T(310, 55, 'hoarding 圍板', 11, anchor='end', fill=BR)
b += R(320, 240, 260, 20, fill='#D6D3D1', stroke=GR, sw=1) + T(450, 280, 'pavement 行人路', 12, fill=GR)
b += R(580, 250, 140, 10, fill=LG, stroke=GR, sw=1) + T(650, 280, 'carriageway 車路', 12, fill=GR)
b += R(320, 90, 250, 12, fill='#FDE3CC', stroke=BR) + L(565, 102, 565, 240, BR, 2) + T(445, 84, 'roof / catch platform 上蓋', 11, fill=BR)
b += DIM(330, 215, 560, 215, 'clear width 淨闊 (see table)') + DIM(500, 102, 500, 240, '') + T(470, 170, '≥ 2.3 m', 12, weight='bold', fill=BR)
b += T(380, 315, 'Pavement ≤ 2.5 m: normally ≥ 1.5 m (≥ 1.1 m min.) · 2.5–3 m: width − 1 m · > 3 m: ≥ 2 m · on carriageway: ≥ 1.1 m', 12, fill=GR)
b += T(380, 333, 'Lighting 35–50 lux; keep utility pits accessible (APP-23) 照明 35–50 勒克斯', 12, fill=GR)
svg('hoarding-section', 760, 350, b)

# 7 ELS 45-degree zone (APP-57)
b = T(380, 26, 'ELS plans: the 45° zone of influence 挖掘及側向承托：45° 影響範圍', 15, weight='bold')
gy = 90
b += L(30, gy, 730, gy, GR, 2)
b += f'<path d="M260,{gy} L260,250 L500,250 L500,{gy}" fill="#FFF8F1" stroke="{OR}" stroke-width="2"/>' + T(380, 180, 'Excavation 挖掘', 13, weight='bold', fill=BR)
b += DIM(240, gy, 240, 250, '') + T(205, 175, '> 2.5 m', 12, weight='bold', fill=BR)
b += DIM(260, 270, 500, 270, '> 5 m long 長', above=False)
b += f'<line x1="500" y1="250" x2="660" y2="{gy}" stroke="{BR}" stroke-width="1.5" stroke-dasharray="6 4"/>' + T(615, 185, '45°', 13, weight='bold', fill=BR)
b += f'<line x1="260" y1="250" x2="100" y2="{gy}" stroke="{BR}" stroke-width="1.5" stroke-dasharray="6 4"/>'
b += f'<polygon points="500,{gy} 660,{gy} 500,250" fill="{OR}" fill-opacity="0.12"/>' + f'<polygon points="260,{gy} 100,{gy} 260,250" fill="{OR}" fill-opacity="0.12"/>'
b += R(560, 40, 80, 50, fill=LG, stroke=GR, sw=1) + T(600, 70, 'building', 11)
b += R(110, 74, 110, 16, fill='#D6D3D1', stroke=GR, sw=1) + T(165, 68, 'road 道路', 11)
b += f'<circle cx="560" cy="115" r="7" fill="#DBEAFE" stroke="{GR}"/>' + T(640, 120, 'water main ≥ 75 mm', 11, anchor='start')
b += T(380, 305, 'If a road, building, structure, slope > 30° or water main ≥ 75 mm lies within the 45° zone → ELS plans (RSE); > 4.5 m deep → RGE too', 12, fill=GR)
svg('els-45', 760, 320, b)
print('svgs ok')
