/* =========================================================
   東京行程 10/29（四）– 11/1（日）
   - 時間係日本時間（比香港快 1 小時）。
   - pics：預先揀好嘅 Wikimedia Commons 相（第一次上網時下載，之後離線可睇）
     picCat／picQuery：如果唔夠 3 張，由呢個分類／關鍵字補足。
   - 改咗呢個檔之後將 seedVersion +1，App 會問你要唔要載入新版。
   ========================================================= */
window.SEED_TRIP = (() => {
  let n = 0;
  const I = o => ({ id: 's' + (++n), status: 'planned', ...o });
  const day = (date, o, items) => ({ id: 'd' + date.replace(/-/g, ''), date, country: 'JP', items, ...o });
  const walk = (time, end, from, to, extra = {}) => I({ type: 'walk', time, end, title: `${extra.fromZh || from} → ${extra.toZh || to}`, from, to, ...extra });

  const HOTEL = {
    title: '三井花園飯店 銀座築地',
    titleJa: '三井ガーデンホテル銀座築地',
    place: '三井ガーデンホテル銀座築地',
    address: '〒104-0045 東京都中央区築地4-7-1',
    url: 'https://www.gardenhotels.co.jp/ginza-tsukiji/',
    picQuery: 'Tsukiji Chuo Tokyo street',
  };
  const H = { fromZh: '酒店', toZh: '酒店' };
  const TSUKIJI_PICS_A = ['File:Tsukiji Outer Market -01.jpg', 'File:Tsukiji Outer Market -09.jpg', 'File:Tamagoyaki (3099935773).jpg'];
  const TSUKIJI_PICS_B = ['File:Tsukiji Outside Market.jpg', 'File:Tsukiji Market 2017 (38052266396).jpg', 'File:Alleyway near the Tsukiji fish market in Tokyo, Japan.jpg'];
  const NRT_PICS = ['File:Departure lobby of Tokyo-Narita Airport Terminal 2.JPG', 'File:Narita Airpoert Terminal 2 Check-in Area.JPG', 'File:Narita Airport Terminal 2 exterior.jpg'];
  const SKYLINER_OFFICIAL = 'https://www.keisei.co.jp/keisei/tetudou/skyliner/jp/traffic/skyliner_timetable.php';
  const metro = (slug, zh) => ({ label: `${zh} 站內圖`, url: `https://www.tokyometro.jp/lang_tcn/station/${slug}/index.html` });

  return {
    seedVersion: 3,
    name: '東京 4 日',
    days: [
      /* ================= Day 1 · 10/29（四） ================= */
      day('2026-10-29', { city: '東京', title: '飛東京・銀座晚餐', notes: '07:30（香港時間）由北角出發去機場。日本比香港快 1 小時。' }, [
        I({ type: 'flight', time: '11:00', end: '15:55', title: '香港 → 東京成田 T2', titleJa: '香港 → 成田空港 第2ターミナル', number: '（待填）', from: 'Hong Kong International Airport', fromZh: '香港機場', to: '成田国際空港 第2ターミナル', toZh: '成田機場 T2', pics: NRT_PICS,
          notes: '15:55（日本時間）抵達。起飛時間待填。\n落機前填好 Visit Japan Web，入境 QR code 截圖「加相」。' }),
        I({ type: 'other', time: '15:55', end: '17:15', title: '入境＋取行李＋海關', titleJa: '入国審査・手荷物受取・税関', place: '成田国際空港 第2ターミナル', pics: NRT_PICS, picCat: 'Category:Interior of Narita International Airport Terminal 2', notes: '預留約 80 分鐘，視乎入境人流。' }),
        I({ type: 'other', time: '17:15', end: '17:30', title: '去京成線買 Skyliner 飛', titleJa: '京成線 スカイライナー券売所（空港第2ビル駅）', place: '空港第2ビル駅', picCat: 'Category:Narita Airport Terminal 2-3 Station', notes: 'T2 地庫 B1 京成櫃位買 Skyliner 指定席（約 ¥2,580）。可以預先網上買 e-ticket。', links: [{ label: 'Skyliner 官網', url: 'https://www.keisei.co.jp/keisei/tetudou/skyliner/tc/' }] }),
        I({
          type: 'train', time: '17:30', end: '18:15', title: 'Skyliner：成田機場 → 京成上野', titleJa: 'スカイライナー 空港第2ビル → 京成上野',
          number: 'Skyliner', from: '空港第2ビル駅', fromZh: '成田機場 T2 站', to: '京成上野駅', toZh: '京成上野站',
          pics: ['File:Keisei-Type-AE.jpg'], picCat: 'Category:Skyliner',
          notes: '全車指定席，車程約 41–47 分鐘。\n⚠️ 17:30 冇車：建議搭 17:43（56號）→ 18:24。撳「延遲」+15 分，之後行程會跟住移。',
          timetable: [
            { dep: '17:02', arr: '17:43', name: '152號' },
            { dep: '17:22', arr: '18:07', name: '154號' },
            { dep: '17:43', arr: '18:24', name: '56號', note: '建議' },
            { dep: '18:03', arr: '18:48', name: '58號' },
            { dep: '18:18', arr: '19:10', name: '160號' },
            { dep: '18:43', arr: '19:27', name: '62號' },
          ],
          timetableNote: '平日時刻（10/29 星期四），以京成官網為準。',
          timetableUrl: SKYLINER_OFFICIAL,
        }),
        walk('18:15', '18:35', '京成上野駅', '上野駅', { fromZh: '京成上野站', toZh: '上野站（銀座線）', notes: '跟「東京メトロ 銀座線」指示行，約 5–8 分鐘。', stationLinks: [metro('ueno', '上野站')] }),
        I({ type: 'train', time: '18:35', end: '18:55', title: '銀座線：上野 → 銀座', titleJa: '東京メトロ銀座線 上野 → 銀座', number: '銀座線 G16 → G09', from: '上野駅', fromZh: '上野站', to: '銀座駅', toZh: '銀座站',
          picCat: 'Category:Platforms of Ueno Station (Ginza Line)', picQuery: 'Ginza Station Tokyo Metro platform',
          notes: '約 10 分鐘，每 2–5 分鐘一班，Suica 拍卡（約 ¥180）。', stationLinks: [metro('ueno', '上野站'), metro('ginza', '銀座站')],
          planB: '日比谷線 上野 → 東銀座 直達（約 15 分鐘），6 號出口行 3 分鐘到酒店，唔使拖行李行 15 分鐘。' }),
        walk('18:55', '19:10', '銀座駅', HOTEL.place, { fromZh: '銀座站', toZh: '酒店' }),
        I({ type: 'hotel', time: '19:10', end: '19:30', ...HOTEL, title: 'Check-in：三井花園飯店 銀座築地', notes: 'Check-in 15:00 / Check-out 11:00 · 電話 03-5565-2731\n東銀座站 6 號出口步行 3 分鐘；築地站 2 號出口步行 4 分鐘。' }),
        walk('19:30', '19:45', HOTEL.place, '銀座 篝 本店', { fromZh: '酒店', toZh: '銀座 篝' }),
        I({
          type: 'food', time: '19:45', end: '20:45', title: '晚餐：銀座 篝 本店', titleJa: '銀座 篝 本店', place: '銀座 篝 本店',
          address: '東京都中央区銀座6-4-12 1F（銀座站 B9 出口步行 4 分鐘）', hours: '約 11:00–21:30／22:30',
          picQuery: 'Ginza Kagari ramen', picCat: 'Category:Ramen tori paitan',
          notes: '唔收訂位，晚市通常排 30–60 分鐘；入門口食券機買飛。',
          planB: '築地夜市（TBC）；或 GINZA SIX B2 美食',
          menu: { items: [
            { name: '雞白湯拉麵', ja: '鶏白湯Soba', price: '約 ¥2,000', star: true, desc: '招牌：好似濃湯咁滑嘅雞白湯' },
            { name: '雞白湯醬油拉麵', ja: '鶏白湯醤油Soba', price: '約 ¥2,000' },
            { name: '黑松露雞白湯拉麵', ja: '鶏白湯生トリュフSoba', price: '約 ¥3,000', desc: '季節限定' },
          ], tips: '價錢參考 2025 年資料（含稅）。' },
        }),
        walk('20:45', '21:00', '銀座 篝 本店', HOTEL.place, { fromZh: '銀座 篝', toZh: '酒店' }),
      ]),

      /* ================= Day 2 · 10/30（五） ================= */
      day('2026-10-30', { city: '東京', title: '築地・谷根千・村上春樹・新宿', notes: '10/30–11/1 築地秋祭期間。' }, [
        walk('09:00', '09:10', HOTEL.place, '築地場外市場', { ...H, toZh: '築地場外市場' }),
        I({
          type: 'food', time: '09:10', end: '10:00', title: '築地市場早餐＋逛市場', titleJa: '築地場外市場', place: '築地場外市場', url: 'https://www.tsukiji.or.jp/',
          pics: TSUKIJI_PICS_A, notes: '好多舖頭只收現金。大部分開到中午左右。',
          menu: { items: [
            { name: '丸武 玉子燒', ja: '丸武 玉子焼き', price: '約 ¥150–200', star: true, desc: '一人份，邊行邊食' },
            { name: 'きつねや 牛雜丼', ja: 'きつねや ホルモン丼', price: '約 ¥1,000', star: true, desc: '人氣排隊店 07:00–13:30' },
            { name: '又こい家 海鮮丼', ja: '又こい家 総本店', price: '約 ¥2,000–4,000', desc: '吞拿魚稀有部位' },
            { name: '燒帆立貝／海膽', ja: 'ホタテ焼き・うに', price: '¥500 起' },
          ] },
        }),
        I({ type: 'train', time: '10:00', end: '10:40', title: '築地 → 根津', titleJa: '日比谷線・千代田線 築地 → 根津', number: '日比谷線 → 日比谷站轉千代田線', from: '築地駅', fromZh: '築地站', to: '根津駅', toZh: '根津站', picQuery: 'Nezu Station Tokyo Metro', notes: '約 25 分鐘＋步行。', stationLinks: [metro('tsukiji', '築地站'), metro('nezu', '根津站')] }),
        I({ type: 'sight', time: '10:40', end: '11:30', title: '根津神社', titleJa: '根津神社', place: '根津神社', address: '東京都文京区根津1-28-9',
          pics: ['File:Nezu Shrine 2010.jpg', 'File:Nezu-jinja Torii 10.jpg', 'File:The gate of Nezu shrine - panoramio.jpg'], picCat: 'Category:Nezu-jinja',
          notes: '主殿（國家重要文化財）、乙女稻荷千本鳥居。免費。根津站 1 號出口步行 5 分鐘。' }),
        walk('11:30', '11:50', '根津神社', '谷中銀座商店街', { fromZh: '根津神社', toZh: '谷中銀座' }),
        I({
          type: 'food', time: '11:50', end: '13:20', title: '谷中銀座掃街＋散步', titleJa: '谷中銀座商店街', place: '谷中銀座商店街', url: 'https://www.yanakaginza.com/',
          pics: ['File:Yanaka Ginza shopping street (4041690725).jpg', 'File:Yanaka Ginza.JPG', 'File:Yanaka Ginza by yisris in Tokyo.jpg'], picCat: 'Category:Yanaka Ginza',
          notes: '邊行邊食，唔使正式午餐。「夕やけだんだん」樓梯係影相位。',
          menu: { items: [
            { name: '肉のすずき 炸肉餅', ja: '肉のすずき メンチカツ', price: '約 ¥300', star: true, desc: '牛豬肉黃金比例，好多汁' },
            { name: '肉のサトー 元氣炸肉餅', ja: '肉のサトー 元気メンチ', price: '約 ¥300', star: true, desc: '用 A5 和牛' },
            { name: '貓尾冬甩', ja: 'やなかしっぽや', price: '約 ¥150', desc: '貓尾巴形狀' },
          ] },
        }),
        I({ type: 'train', time: '13:20', end: '14:05', title: '千駄木 → 早稻田', titleJa: '千代田線・東西線 千駄木 → 早稲田', number: '千代田線 → 大手町轉東西線', from: '千駄木駅', fromZh: '千駄木站', to: '早稲田駅', toZh: '早稻田站', picQuery: 'Waseda Station Tozai Line', notes: '約 30 分鐘，留轉車時間。', stationLinks: [metro('sendagi', '千駄木站'), metro('waseda', '早稻田站')] }),
        walk('14:05', '14:15', '早稲田駅', '早稲田大学国際文学館', { fromZh: '早稻田站', toZh: '村上春樹圖書館' }),
        I({ type: 'sight', time: '14:15', end: '16:10', title: '村上春樹圖書館', titleJa: '早稲田大学国際文学館（村上春樹ライブラリー）', place: '早稲田大学国際文学館', address: '東京都新宿区西早稲田1-6-1 早稲田大学4号館', url: 'https://www.waseda.jp/culture/wihl/', hours: '10:00–17:00 · 逢星期三休',
          picCat: 'Category:Waseda International House of Literature', picQuery: 'Haruki Murakami Library Waseda',
          notes: '免費、唔使預約。隈研吾改建，木隧道書架係重點。館內有 café「橙子猫 Orange Cat」。' }),
        I({ type: 'train', time: '16:10', end: '16:40', title: '早稻田 → 新宿', titleJa: '東西線・JR山手線 早稲田 → 新宿', number: '東西線 → 高田馬場轉 JR 山手線', from: '早稲田駅', fromZh: '早稻田站', to: '西武新宿駅', toZh: '西武新宿站', picQuery: 'Seibu-Shinjuku Station' }),
        walk('16:40', '17:00', '西武新宿駅', '牛かつもと村 新宿本店', { fromZh: '西武新宿站', toZh: '牛かつもと村' }),
        I({
          type: 'food', time: '17:00', end: '18:20', title: '晚餐：牛かつもと村 新宿本店', titleJa: '牛かつもと村 新宿本店', place: '牛かつもと村 新宿本店',
          address: '東京都新宿区歌舞伎町1-25-3 WaMall 西武新宿駅前ビル B2', hours: '11:00–22:00（L.O. 21:00）', url: 'https://www.gyukatsu-motomura.com/reservation-1?stt_lang=en', ref: '',
          pics: ['File:Beef at Gyukatsu Ichinisan in Akihabara.jpg'], picCat: 'Category:Gyukatsu',
          notes: '有預約（撳「網站／訂位」）。西武新宿站正面口步行 1 分鐘 · 電話 050-1722-2861',
          menu: { items: [
            { name: '炸牛排定食 130g', ja: '牛かつ定食 130g（麦めし・味噌汁）', price: '約 ¥1,630', star: true, desc: '自己喺小石板燒到想要嘅熟度' },
            { name: '炸牛排定食 260g', ja: '牛かつ定食 ダブル', price: '約 ¥2,600+' },
            { name: '山芋泥', ja: 'とろろ', desc: '配麥飯一流' },
          ], tips: '每件放落石板燒 10–15 秒就夠。' },
        }),
        I({ type: 'sight', time: '18:20', end: '19:30', title: '歌舞伎町散步・Godzilla', titleJa: '歌舞伎町一番街・新宿東宝ビル（ゴジラヘッド）', place: '新宿東宝ビル',
          pics: ['File:Shinjuku toho building kabukicho 2015.jpg', 'File:Central Road Kabukicho-Sinjyuku-Tokyo.jpg'], picCat: 'Category:Shinjuku Toho Building',
          notes: '晚上注意拉客，唔好跟人入舖。' }),
        I({ type: 'train', time: '19:30', end: '20:10', title: '新宿 → 銀座', titleJa: '丸ノ内線 新宿 → 銀座', number: '丸之內線', from: '新宿駅', fromZh: '新宿站', to: '銀座駅', toZh: '銀座站', picQuery: 'Marunouchi Line Shinjuku Station', notes: '約 16 分鐘，之後步行返酒店。', stationLinks: [metro('shinjuku', '新宿站'), metro('ginza', '銀座站')] }),
      ]),

      /* ================= Day 3 · 10/31（六） ================= */
      day('2026-10-31', { city: '東京', title: '根津美術館・表參道建築・代官山・中目黑' }, [
        walk('09:00', '09:10', HOTEL.place, '築地場外市場', { ...H, toZh: '築地場外市場' }),
        I({ type: 'food', time: '09:10', end: '10:00', title: '築地市場早餐', titleJa: '築地場外市場', place: '築地場外市場', pics: TSUKIJI_PICS_B,
          menu: { items: [
            { name: '海鮮丼', ja: '海鮮丼', price: '¥2,000 起', star: true },
            { name: '鯛魚燒', ja: '築地 さのきや たい焼き', price: '約 ¥200' },
            { name: '吞拿魚串', ja: 'まぐろ串', price: '¥500 起' },
          ] } }),
        I({ type: 'train', time: '10:00', end: '10:35', title: '築地 → 表參道', titleJa: '日比谷線・銀座線 築地 → 表参道', number: '日比谷線 → 銀座站轉銀座線', from: '築地駅', fromZh: '築地站', to: '表参道駅', toZh: '表參道站', picQuery: 'Omote-sando Station', notes: 'A5 出口步行約 8 分鐘。', stationLinks: [metro('omote-sando', '表參道站')] }),
        I({ type: 'sight', time: '10:35', end: '11:50', title: '根津美術館', titleJa: '根津美術館', place: '根津美術館', address: '東京都港区南青山6-5-1', url: 'https://www.nezu-muse.or.jp/', hours: '10:00–17:00 · 逢星期一休', ref: '',
          pics: ['File:Nezu museum entrance tokyo 2014.jpg'], picCat: 'Category:Nezu Museum',
          notes: '⚠️ 要網上預約時段！約 ¥1,300–1,500。\n隈研吾設計，竹林入口＋大庭園。' }),
        I({ type: 'sight', time: '11:50', end: '13:15', title: '表參道建築散步', titleJa: '表参道・南青山 建築散歩', place: '表参道',
          pics: ['File:PRADA BOUTIQUE AOYAMA.jpg', 'File:Christian Dior Omotesando Tokyo.JPG', 'File:PRADA AOYAMA 2.jpg'], picCat: 'Category:Prada Aoyama',
          notes: '以外觀為主：\n• Prada 青山（Herzog & de Meuron）\n• Dior 表參道（SANAA）\n• Tod\'s 表參道（伊東豐雄）\n• 表參道之丘（安藤忠雄）',
          links: [{ label: 'Prada 青山 地圖', url: 'https://www.google.com/maps/search/?api=1&query=Prada+Aoyama+Tokyo' }, { label: 'Dior 表參道 地圖', url: 'https://www.google.com/maps/search/?api=1&query=Dior+Omotesando' }, { label: '表參道之丘 地圖', url: 'https://www.google.com/maps/search/?api=1&query=Omotesando+Hills' }] }),
        I({ type: 'train', time: '13:15', end: '13:40', title: '表參道 → 代官山', titleJa: '銀座線・東急東横線 表参道 → 渋谷 → 代官山', number: '澀谷轉東急東橫線', from: '表参道駅', fromZh: '表參道站', to: '代官山駅', toZh: '代官山站', picCat: 'Category:Daikan-yama Station' }),
        I({ type: 'food', time: '13:40', end: '14:40', title: '午餐：IVY PLACE', titleJa: 'IVY PLACE（代官山T-SITE）', place: 'IVY PLACE 代官山', picQuery: 'Ivy Place Daikanyama', picCat: 'Category:Daikanyama',
          notes: '代官山 T-SITE 入面，似森林別墅，有露台。', planB: 'GARDEN HOUSE CRAFTS Daikanyama',
          menu: { items: [
            { name: '經典酪奶班戟', ja: 'クラシックバターミルクパンケーキ', price: '約 ¥1,800', star: true, desc: '店家招牌' },
            { name: '午市意粉／漢堡', ja: 'パスタ・バーガー', price: '約 ¥2,000' },
          ], tips: '週末多人，建議預約。' } }),
        I({ type: 'shop', time: '14:40', end: '16:15', title: '代官山 蔦屋書店', titleJa: '代官山 蔦屋書店（代官山T-SITE）', place: '代官山 蔦屋書店', hours: '09:00–22:00',
          pics: ['File:Daikanyama T-Site Building 3 2018.jpg'], picCat: 'Category:Daikanyama',
          notes: 'T-SITE（Klein Dytham）；附近 Hillside Terrace（槇文彥）。' }),
        walk('16:15', '16:40', '代官山駅', '中目黒駅', { fromZh: '代官山', toZh: '中目黑' }),
        I({ type: 'shop', time: '16:40', end: '17:30', title: '中目黑・目黑川散步', titleJa: '中目黒・目黒川', place: '目黒川 中目黒',
          pics: ['File:Meguro river at night in autumn.jpg'], picCat: 'Category:Meguro River',
          notes: 'Starbucks Reserve Roastery Tokyo（隈研吾）喺河邊。' }),
        I({
          type: 'food', time: '17:30', end: '18:50', title: '晚餐：和牛壽喜燒 そしじ', titleJa: '和牛すき焼 そしじ 中目黒店', place: '和牛すき焼 そしじ 中目黒店',
          address: '東京都目黒区上目黒3-16-1 コットンビル 2F', hours: '星期六 11:30–23:00', url: 'https://yoyaku.toreta.in/nakame-b', ref: '',
          pics: ['File:Sukiyaki (7320145438).jpg', 'File:Sukiyaki 01.jpg', 'File:Sukiyaki by moxups.jpg'],
          notes: '電話 03-3791-2514。A5 黑毛和牛，南部鐵器鍋。',
          links: [{ label: 'Tabelog 食評', url: 'https://tabelog.com/tw/tokyo/A1317/A131701/13318941/dtlrvwlst/' }],
          menu: { items: [
            { name: '壽喜燒「上」（赤身）', ja: 'すき焼セット 上', price: '¥2,980（未連稅）' },
            { name: '壽喜燒「特」（上赤身）', ja: 'すき焼セット 特', price: '¥3,380（未連稅）' },
            { name: '壽喜燒「天」（霜降）', ja: 'すき焼セット 天', price: '¥3,980（未連稅）', star: true, desc: '包野菜＋そしじ蛋' },
            { name: '燒汁牛柳（Chateaubriand）', ja: '特へれステーキたれ焼き', price: '¥18,700／2人', desc: '中目黑店限定' },
          ] },
        }),
        I({ type: 'train', time: '18:50', end: '19:25', title: '中目黑 → 赤羽橋', titleJa: '日比谷線・大江戸線 中目黒 → 赤羽橋', number: '日比谷線 → 六本木轉大江戶線', from: '中目黒駅', fromZh: '中目黑站', to: '赤羽橋駅', toZh: '赤羽橋站', picCat: 'Category:Naka-Meguro Station', stationLinks: [metro('naka-meguro', '中目黑站')] }),
        I({ type: 'sight', time: '19:25', end: '19:50', title: '東京鐵塔夜景', titleJa: '東京タワー（赤羽橋）', place: '東京タワー',
          pics: ['File:Tokyo Tower seen from Akabanebashi intersection.JPG', 'File:Tokyo Tower Night View.jpg', 'File:Tokyo Tower at night (1).jpg'], picCat: 'Category:Views of Tokyo Tower from Sakurada dori at night',
          notes: '唔上塔，出站影相＋睇夜景。' }),
        I({ type: 'train', time: '19:50', end: '20:20', title: '赤羽橋 → 東銀座', titleJa: '大江戸線・浅草線 赤羽橋 → 東銀座', number: '大江戶線 → 大門轉淺草線', from: '赤羽橋駅', fromZh: '赤羽橋站', to: '東銀座駅', toZh: '東銀座站', picCat: 'Category:Higashi-Ginza Station', notes: '6 號出口步行 3 分鐘返酒店。' }),
      ]),

      /* ================= Day 4 · 11/1（日） ================= */
      day('2026-11-01', { city: '東京', title: '築地秋祭・銀座・返香港', notes: '酒店 11:00 前 check-out。' }, [
        I({ type: 'hotel', time: '08:30', end: '09:00', ...HOTEL, title: '起身執行李' }),
        walk('09:00', '09:10', HOTEL.place, '市場橋公園 築地', { ...H, toZh: '市場橋公園' }),
        I({ type: 'food', time: '09:10', end: '10:10', title: '築地美食節 早餐', titleJa: '築地秋まつり 築地フードフェス（市場橋公園）', place: '市場橋公園 築地', url: 'https://www.tsukiji.or.jp/',
          pics: TSUKIJI_PICS_A.slice(0, 2), picCat: 'Category:Tsukiji Outer Market',
          notes: '築地秋祭 2026（10/30–11/1）。往年有「江戸一」、「築地 さのきや」特別菜單。', planB: '築地場外市場（星期日部分舖頭休息）' }),
        walk('10:10', '10:20', '市場橋公園 築地', HOTEL.place, { fromZh: '市場橋公園', toZh: '酒店' }),
        I({ type: 'hotel', time: '10:20', end: '10:50', ...HOTEL, title: 'Check-out＋寄存行李' }),
        walk('10:50', '11:00', HOTEL.place, '銀座ロフト', { ...H, toZh: '銀座 LOFT' }),
        I({ type: 'shop', time: '11:00', end: '12:00', title: '銀座 LOFT', titleJa: '銀座ロフト', place: '銀座ロフト', hours: '星期日 11:00 開', picQuery: 'Ginza Loft Tokyo', picCat: 'Category:Ginza', notes: '文具、生活雜貨、化妝品。' }),
        walk('12:00', '12:10', '銀座ロフト', '銀座三越', { fromZh: '銀座 LOFT', toZh: '銀座三越' }),
        I({ type: 'food', time: '12:10', end: '12:50', title: '銀座三越 食品街＋手信', titleJa: '銀座三越 デパ地下（B2・B3）', place: '銀座三越', address: '東京都中央区銀座4-6-16',
          pics: ['File:2019 Ginza Mitsukoshi.jpg', 'File:Ginza Mitsukoshi at night.jpg', 'File:Mitsukoshi Ginza new-building.JPG'],
          menu: { items: [{ name: '和菓子／洋菓子禮盒', ja: '和菓子・洋菓子', star: true, desc: '手信首選' }, { name: '熟食、便當', ja: '惣菜・弁当' }], tips: '退稅記得帶護照。' } }),
        walk('12:50', '13:05', '銀座三越', HOTEL.place, { fromZh: '銀座三越', toZh: '酒店' }),
        I({ type: 'hotel', time: '13:05', end: '13:25', ...HOTEL, title: '攞行李' }),
        I({
          type: 'train', time: '13:30', end: '14:45', title: '酒店 → 成田機場 T2', titleJa: '東銀座 → 上野 → 京成上野 スカイライナー → 空港第2ビル',
          number: '日比谷線 ＋ Skyliner', from: '京成上野駅', fromZh: '京成上野站', to: '空港第2ビル駅', toZh: '成田機場 T2 站',
          pics: ['File:Keisei-Type-AE.jpg'], picCat: 'Category:Keisei Ueno Station',
          notes: '東銀座（日比谷線）→ 上野 約 15 分鐘 → 步行去京成上野 5–8 分鐘 → Skyliner 約 41 分鐘。建議 14:00（51號）。',
          timetable: [
            { dep: '13:00', arr: '13:41', name: '45號' },
            { dep: '13:17', arr: '14:01', name: '47號' },
            { dep: '13:40', arr: '14:21', name: '49號' },
            { dep: '14:00', arr: '14:41', name: '51號', note: '建議' },
          ],
          timetableNote: '京成上野開出（平日時刻）；星期日可能差 1–2 分鐘。',
          timetableUrl: SKYLINER_OFFICIAL,
        }),
        I({ type: 'other', time: '14:45', end: '15:30', title: 'Check-in＋寄行李', titleJa: '成田空港 第2ターミナル 出発ロビー', place: '成田国際空港 第2ターミナル', pics: NRT_PICS }),
        I({ type: 'other', time: '15:30', end: '16:00', title: '出境安檢', titleJa: '保安検査・出国審査' }),
        I({ type: 'shop', time: '16:00', end: '16:50', title: 'T2 免稅店', titleJa: '免税店', notes: '先確認登機閘口位置。' }),
        I({
          type: 'food', time: '16:50', end: '17:50', title: '晚餐：鰻魚 四代目菊川', titleJa: 'うなぎ四代目菊川 成田空港店', place: 'うなぎ四代目菊川 成田空港店',
          address: '成田空港 第2ターミナル 本館（出境禁區內）', hours: '約 07:30–22:00',
          picCat: 'Category:Hitsumabushi', pics: ['File:Unagi1.jpg'],
          links: [{ label: 'Tabelog', url: 'https://tabelog.com/en/chiba/A1204/A120401/12058270/' }],
          menu: { url: 'https://tabelog.com/en/chiba/A1204/A120401/12058270/dtlmenu/', items: [
            { name: '鰻魚飯三食', ja: 'ひつまぶし', price: '約 ¥4,800–6,000', star: true, desc: '原味 → 加藥味 → 茶泡飯' },
            { name: '燒鰻魚套餐', ja: '焼きうなぎセット', price: '約 ¥5,880' },
          ] },
        }),
        I({ type: 'other', time: '17:50', end: '19:00', title: '免稅店＋去登機閘口', titleJa: '搭乗ゲート', notes: '起飛前最少 35 分鐘到閘口。' }),
        I({ type: 'flight', time: '19:00', end: '22:50', title: '東京成田 → 香港', titleJa: '成田空港 → 香港', number: '（待填）', from: '成田国際空港 第2ターミナル', fromZh: '成田機場 T2', to: 'Hong Kong International Airport', toZh: '香港機場', pics: NRT_PICS.slice(0, 1),
          notes: '22:50 係估計抵港時間（香港時間）。' }),
      ]),
    ],
  };
})();
