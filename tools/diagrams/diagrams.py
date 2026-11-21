# name: (page, caption EN / ZH, mermaid source)
D = {}

D['statutory-timeline'] = ('regulations/bo-part-2-building-works.md',
 'Statutory periods from plan submission to occupation (BO s.14–21, B(A)R 30–33). 由呈交圖則至佔用的法定期限。',
'''flowchart TD
  A["Submit plans<br/>呈交圖則"] -->|"≤ 60 days first / major revision<br/>首次或重大修訂 60 天"| B{"Approved?<br/>批准？"}
  B -->|"No 拒批"| R["Resubmit<br/>再呈交"]
  R -->|"≤ 30 days<br/>其他再呈交 30 天"| B
  B -->|"Yes 批准"| C["Apply for consent<br/>申請動工同意<br/>(within 2 years 兩年內)"]
  C -->|"≤ 28 days<br/>28 天"| D["Consent given<br/>獲同意"]
  D -->|"start within 3 months<br/>3 個月內動工"| E["Works on site<br/>施工"]
  E --> F["Completion certificates<br/>完工證明書 BA12 / BA13"]
  F -->|"OP decided ≤ 14 days<br/>14 天內決定"| G["Occupation permit<br/>佔用許可證"]''')

D['adm2-day45-60'] = ('pnap/adm-2.md',
 'Centralised processing: what happens by day 45 and day 60. 中央處理：第 45 及 60 天。',
'''flowchart TD
  A["Day 0<br/>GBP submitted<br/>呈交圖則"] --> B["Circulation to<br/>departments<br/>傳閱各部門"]
  B --> C["Day 45<br/>Ask whether basically<br/>acceptable<br/>查詢是否基本可接受"]
  C --> D["Day 60<br/>Statutory decision<br/>法定決定"]
  D -->|"Disapproved 拒批"| E["Resubmit: normally<br/>no NEW disapproval items<br/>再呈交一般不加新拒批項目"]
  D -->|"Approved 批准"| F["Approval<br/>批准"]''')

D['adm19-process'] = ('pnap/adm-19.md',
 'Overview of the building approval process. 建築圖則批准程序概覽。',
'''flowchart TD
  P["Pre-submission enquiry<br/>呈交前查詢<br/>letter of assurance ≈ 45 days"] --> G["GBP submission<br/>一般建築圖則<br/>≤ 60 days"]
  G --> S["Structural, site formation,<br/>drainage plans<br/>結構／地盤平整／排水圖則"]
  S --> C["Consent to commence<br/>動工同意 ≤ 28 days"]
  C --> W["Construction and supervision<br/>施工及監督<br/>enquiries answered ≈ 4 weeks"]
  W --> O["Completion and OP<br/>完工及佔用許可證 ≤ 14 days"]
  F["Fast track ≈ 30 days<br/>快速處理：簡單 A&A、<br/>兩層貨倉、幕牆維修"] -.-> C''')

D['app13-completion'] = ('pnap/app-13.md',
 'Completion submissions and BD reply periods. 完工呈交及屋宇署回覆期限。',
'''flowchart TD
  W["Works complete<br/>工程完成"] --> Q{"New building?<br/>新建築物？"}
  Q -->|"Yes 是"| N["BA12 / BA13<br/>+ record plans 紀錄圖則"]
  N --> OP["OP decision ≤ 14 days<br/>佔用許可證 14 天內"]
  Q -->|"No 否"| X["BA14 / 14A<br/>reply ≈ 28 days"]
  Q -->|"No 否"| Y["BA14B / 14C<br/>14 days (non-audit)<br/>28 days (audit)"]
  A["Amendment plans approved first<br/>先批准修訂圖則"] -.-> N''')

D['app78-op'] = ('pnap/app-78.md',
 'Occupation permit inspection workflow. 佔用許可證巡查流程。',
'''flowchart TD
  A["Submit documents early via ESH<br/>及早經電子平台呈交文件"] --> B["Form BA13 application<br/>申請佔用許可證"]
  B --> C["Joint OP inspection<br/>聯合巡查"]
  C -->|"Works obviously incomplete<br/>明顯未完成"| D["Summary refusal<br/>即時拒絕 → new BA13"]
  C -->|"Minor items 輕微項目"| E["Rectify, confirm in writing<br/>with photos within the 14 days<br/>14 天內以照片確認"]
  C -->|"Satisfactory 滿意"| F["OP issued<br/>發出佔用許可證"]
  E --> F
  D --> G["Re-inspection ≤ 14 days<br/>14 天內再巡查"] --> F''')

D['app97-consent'] = ('pnap/app-97.md',
 'Normal or fast-track consent? 一般程序還是快速處理？',
'''flowchart TD
  A["Works for consent<br/>申請同意的工程"] --> Q{"First consent already given<br/>and only an amendment?<br/>已獲首次同意且只屬修訂？"}
  Q -->|"No, or major revision<br/>否或重大修訂"| T1["Type I 第 I 類<br/>Normal procedure 一般程序:<br/>approval, then consent"]
  Q -->|"Yes 是"| T2["Type II 第 II 類"]
  T2 --> O{"Mark Type II statement<br/>on plans? 加註聲明？"}
  O -->|"Yes 是"| FT["Fast track 快速處理:<br/>approval + consent together<br/>works continue"]
  O -->|"No 否"| T1''')

D['minor-works'] = ('pnap/app-147.md',
 'Minor works: who does what, and when. 小型工程：負責人及時限。',
'''flowchart TB
  subgraph C1["Class I 第 I 級"]
    direction LR
    a1["Appoint PBP + PRC<br/>委任專業人士及承建商"] --> a2["Notice + plans<br/>≥ 7 days before<br/>7 天前通知"] --> a3["Works<br/>施工"] --> a4["Certificate<br/>≤ 14 days after<br/>14 天內證明書"]
  end
  subgraph C2["Class II 第 II 級"]
    direction LR
    b1["Appoint PRC<br/>委任承建商"] --> b2["Notice<br/>≥ 7 days before"] --> b3["Works"] --> b4["Certificate<br/>≤ 14 days after"]
  end
  subgraph C3["Class III 第 III 級"]
    direction LR
    c1["Appoint PRC"] --> c3["Works"] --> c4["One submission<br/>≤ 14 days after<br/>14 天內一次呈交"]
  end
  C1 ~~~ C2 ~~~ C3''')

D['mbis-workflow'] = ('regulations/bir-123p.md',
 'MBIS / MWIS: inspection and repair timeline. 強制驗樓／驗窗時間表。',
'''flowchart TD
  A["Statutory notice<br/>法定通知"] --> B["Appoint RI / QP<br/>委任檢驗人員"]
  B -->|"notify ≤ 7 days<br/>7 天內通知"| C["Prescribed inspection<br/>訂明檢驗"]
  C -->|"report ≤ 7 days<br/>7 天內報告"| D{"Repair needed?<br/>須修葺？"}
  D -->|"Unknown cause:<br/>proposal, BD replies ≤ 28 days<br/>屋宇署 28 天內回覆"| C
  D -->|"Yes 是"| E["Prescribed repair<br/>訂明修葺"]
  E -->|"completion report ≤ 14 days<br/>14 天內完工報告"| F["Done 完成"]
  D -->|"No 否"| F''')

D['bar-deadlines'] = ('regulations/bar-123a.md',
 'B(A)R deadlines at a glance. 《建築物（管理）規例》期限一覽。',
'''flowchart TD
  R["B(A)R deadlines<br/>期限"] --> a["48 hours 小時<br/>certify emergency works<br/>緊急工程證明"]
  R --> b["7 days 天<br/>notify change of AP / RSE / RGE /<br/>contractor / TCP 更換人員"]
  R --> c["14 days 天<br/>change of business address<br/>業務地址"]
  R --> d["28 days 天<br/>consent; amendments after consent<br/>同意及同意後修訂"]
  R --> e["30 / 60 days 天<br/>plan approval 圖則批准"]
  R --> f["12 months 個月<br/>keep site records after completion<br/>保存地盤紀錄"]''')

D['adm22-wr'] = ('pnap/adm-22.md',
 'Withdrawal and resubmission restarts the clock, at most twice. 撤回並重新提交最多兩次。',
'''flowchart LR
  A["Application<br/>申請"] --> B["Statutory period<br/>法定期限"]
  B -->|"Letter with reasons<br/>附理由信件"| C["W&R #1<br/>clock restarts 重新計算"]
  C -->|"Letter with reasons"| D["W&R #2<br/>clock restarts"]
  D --> E["Decision<br/>決定<br/>(no 3rd W&R normally)"]''')

D['adm16-gi'] = ('pnap/adm-16.md',
 'Concurrent approval and consent for GI in scheduled areas. 附表地區土地勘測同時處理。',
'''flowchart LR
  A["Day 0<br/>GI plans + supervision plan<br/>土地勘測圖則及監工計劃書"] --> B["Covering letter: opt for<br/>concurrent processing<br/>附函選擇同時處理"]
  B --> C["After day 32<br/>apply for consent<br/>第 32 天後申請同意"]
  C --> D["Approval + consent<br/>批准及同意"]''')

D['app58-drain-test'] = ('pnap/app-58.md',
 'Drainage testing procedure. 排水工程測試程序。',
'''flowchart TD
  A["RC arranges test with AP<br/>承建商與認可人士安排"] --> B["RC applies to BD<br/>(copy AP) 向屋宇署申請"]
  B --> C["Test witnessed by AP<br/>認可人士見證"]
  C --> D["AP endorses results<br/>簽署結果"]
  D -->|"≤ 7 days<br/>7 天內"| E["Completion-of-testing<br/>certificate to BD<br/>提交證明書"]''')

D['roles-ap-rse-rge'] = ('pnap/app-141.md',
 'Who is responsible for what. 各方職責關係。',
'''flowchart TD
  O["Owner / developer<br/>業主／發展商"] --> AP["AP 認可人士<br/>co-ordinator 統籌"]
  O --> RSE["RSE 註冊結構工程師<br/>structural elements 結構"]
  O --> RGE["RGE 註冊岩土工程師<br/>geotechnical elements 岩土"]
  O --> RC["RC 註冊承建商<br/>continuous supervision 持續監督"]
  AP <--> RSE
  AP <--> RGE
  RSE <--> RGE
  AP -.-> BD["Buildings Department 屋宇署<br/>approval, consent, audit<br/>批准、同意、抽查"]
  RC -.-> BD''')

D['pnap-family'] = ('pnap/adm-1.md',
 'How the practice note series fit together. 作業備考系列關係。',
'''flowchart TD
  BO["Buildings Ordinance Cap. 123<br/>建築物條例"] --> RG["Regulations 規例<br/>B(A)R, B(P)R, B(C)R…"]
  RG --> CP["Codes of practice 作業守則<br/>FS Code, Concrete, Wind…"]
  BO --> PN["PNAPs 作業備考"]
  PN --> ADM["ADM 行政<br/>procedures 程序"]
  PN --> APP["APP 應用<br/>how the law is applied 法例應用"]
  PN --> ADV["ADV 諮詢<br/>good practice 良好作業"]
  PN --> JPN["JPN 聯合作業備考<br/>BD + LandsD + PlanD"]
  APP -.-> CP''')

D['app57-els'] = ('pnap/app-57.md',
 'Do I need ELS plans? 是否須呈交挖掘及側向承托圖則？',
'''flowchart TD
  A{"Excavation ＞ 2.5 m deep<br/>AND ＞ 5 m long?<br/>深 ＞ 2.5 米及長 ＞ 5 米？"} -->|"No 否"| N["ELS plans not required<br/>(still take precautions)<br/>毋須圖則"]
  A -->|"Yes 是"| B{"Within 45° line: road, building,<br/>slope ＞ 30°, water main ≥ 75 mm?<br/>45° 線內有受影響設施？"}
  B -->|"No 否"| N
  B -->|"Yes 是"| Y["ELS plans required<br/>須呈交圖則 (RSE)"]
  Y --> C{"Deeper than 4.5 m?<br/>深 ＞ 4.5 米？"}
  C -->|"Yes 是"| G["RGE signs geotechnical<br/>documents 岩土工程師簽署"]''')

D['app162-s17'] = ('pnap/app-162.md',
 'Smart site safety conditions under s.17. 智慧工地安全條件。',
'''flowchart TD
  A["First consent application<br/>首次申請同意"] --> B["AP declares estimated cost<br/>認可人士申報造價 (B(A)R 10)"]
  B --> C{"＞ $30 million?<br/>超過 3,000 萬元？"}
  C -->|"Yes 是"| D["Conditions: Mobile Plant +<br/>Tower Crane Alert Systems<br/>流動機械及塔式起重機警報系統"]
  C -->|"No 否"| E["Normal conditions<br/>一般條件"]
  B -.->|"No declaration 未申報"| F["Consent may be refused<br/>s.16(3)(b) 可拒絕"]''')

D['app21-demolition'] = ('pnap/app-21.md',
 'Demolition workflow. 拆卸工程流程。',
'''flowchart TD
  A["Demolition plans<br/>B(A)R 8(3),(4)<br/>拆卸圖則"] --> B["Approval<br/>批准"]
  B --> C["Supervision plan +<br/>consent application<br/>監工計劃書及申請同意"]
  P["Screens, nets, scaffolds,<br/>hoardings, shoring<br/>(no consent needed)<br/>保護措施毋須同意"] -.-> D
  C --> D["Demolition by RSC<br/>site engineer if complex<br/>video ≥ 1 camera, keep ≥ 14 days"]
  D --> E["Completion certificate<br/>完工證明書"]''')

D['regs-map'] = ('regulations/index.md',
 'Map of the Buildings Ordinance and its subsidiary legislation. 條例及附屬法例關係圖。',
'''flowchart TD
  BO["Buildings Ordinance Cap. 123<br/>建築物條例"] --> A["123A B(A)R<br/>administration 管理"]
  BO --> F["123F B(P)R<br/>planning 規劃"]
  BO --> Q["123Q B(C)R<br/>construction 建造"]
  BO --> I["123I B(SSF,P,D&L)R<br/>drainage 排水"]
  BO --> H["123H refuse rooms 垃圾房"]
  BO --> N["123N B(MW)R<br/>minor works 小型工程"]
  BO --> P["123P B(I&R)R<br/>inspection 檢驗及修葺"]
  F --> FS["FS Code 2011<br/>消防安全守則"]
  F --> UA["Design Manual: Universal<br/>Accessibility 2026 暢通易達"]
  Q --> CD["Structural codes 結構守則"]''')
