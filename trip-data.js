/* =========================================================
   行程資料 (Seed itinerary)
   - App 第一次開會用呢份資料；之後你喺 App 改嘅嘢會存喺手機。
   - 改咗呢個檔之後將 seedVersion +1，App 會問你要唔要載入新版。
   - 時間一律用當地時間（香港 / 日本）。
   ========================================================= */
window.SEED_TRIP = (() => {
  let n = 0;
  const I = o => ({ id: 's' + (++n), status: 'planned', ...o });
  const day = (date, o, items = []) => ({ id: 'd' + date.replace(/-/g, ''), date, items, ...o });

  const HK_HOME = {
    title: '北角住所',
    titleJa: '英皇道425號',
    place: "425 King's Road, North Point, Hong Kong",
    address: '香港北角英皇道425號 · 425 King\'s Road, North Point',
  };
  const HOTEL_TYO = {
    title: '三井花園飯店 銀座築地',
    titleJa: '三井ガーデンホテル銀座築地',
    place: '三井ガーデンホテル銀座築地',
    address: '〒104-0045 東京都中央区築地4-7-1',
    url: 'https://www.gardenhotels.co.jp/ginza-tsukiji/',
    wiki: 'ja:築地',
  };
  const A11 = (o) => I({
    type: 'bus', number: '城巴 Cityflyer A11',
    notes: 'A11：機場 ↔ 北角碼頭，經英皇道（炮台山站／新都城大廈一帶有站）。全程約 60–80 分鐘，車費約 HK$42（八達通／信用卡）。\n機場開出：約 06:10–00:30，每 20–25 分鐘一班；北角開出：約 05:10–22:30，每 15–30 分鐘一班。\n趕時間可改搭的士（約 HK$300–350）或 機場快綫 香港站 + 的士。',
    timetableUrl: 'https://hkbus.app/en/route/a11-1-north-point-ferry-pier-airport-(via-hzmb-hong-kong-port)',
    links: [{ label: 'Citybus 城巴', url: 'https://www.citybus.com.hk/' }],
    ...o,
  });
  const walk = (time, end, title, from, to, extra = {}) =>
    I({ type: 'walk', time, end, title, from, to, ...extra });

  const SKYLINER_URL_JA_IN = 'https://www.navitime.co.jp/diagram/timetable?node=00001948&displayLine=00000066';
  const SKYLINER_URL_JA_OUT = 'https://www.navitime.co.jp/diagram/timetable?node=00001740&displayLine=00000066';
  const SKYLINER_OFFICIAL = 'https://www.keisei.co.jp/keisei/tetudou/skyliner/jp/traffic/skyliner_timetable.php';

  return {
    seedVersion: 1,
    name: '香港 · 日本 2026',
    days: [
      /* ---------------- 英國 → 香港 ---------------- */
      day('2026-10-20', { city: '倫敦', cityJa: 'London', country: 'UK', title: '飛香港' }, [
        I({ type: 'flight', title: '倫敦 → 香港 航班', number: '（待填）', from: 'London Heathrow Airport', fromZh: '倫敦希斯路機場', to: 'Hong Kong International Airport', toZh: '香港國際機場', wiki: 'en:Heathrow Airport', notes: '航班號、時間、訂位號碼未填 —— 撳「改」補返。' }),
      ]),
      day('2026-10-21', { city: '香港', cityJa: 'Hong Kong', country: 'HK', title: '抵達香港' }, [
        I({ type: 'other', title: '抵達香港國際機場', titleJa: 'Hong Kong International Airport', place: 'Hong Kong International Airport', wiki: 'zh:香港國際機場', notes: '抵達時間待填。' }),
        A11({ title: '機場 → 北角（A11 巴士）', from: 'Hong Kong International Airport', fromZh: '香港國際機場', to: "425 King's Road, North Point", toZh: '北角英皇道425號' }),
        I({ type: 'hotel', ...HK_HOME, wiki: 'zh:北角' }),
      ]),
      ...['22', '23', '24', '25', '26', '27', '28'].map(d => day(`2026-10-${d}`, { city: '香港', cityJa: 'Hong Kong', country: 'HK', title: '香港自由活動' })),

      /* ---------------- 東京自由行 Day 1 ---------------- */
      day('2026-10-29', { city: '東京', cityJa: '東京', country: 'JP', title: 'Day 1 · 飛東京、銀座晚餐', notes: '日本比香港快 1 小時。上午兩項係香港時間，之後係日本時間。' }, [
        A11({ time: '07:30', end: '08:45', title: '北角 → 香港機場（香港時間）', from: "425 King's Road, North Point", fromZh: '北角', to: 'Hong Kong International Airport', toZh: '香港國際機場', planB: '的士直去機場（約 45 分鐘）' }),
        I({ type: 'flight', time: '11:00', end: '15:55', title: '香港 → 東京成田 T2', number: '（待填）', from: 'Hong Kong International Airport', fromZh: '香港國際機場', to: '成田国際空港 第2ターミナル', toZh: '成田機場 第2航廈', wiki: 'ja:成田国際空港', notes: '15:55（日本時間）抵達成田 T2。起飛時間待填。\n落機前填好 Visit Japan Web，入境 QR code 截圖放「附件」。' }),
        I({ type: 'other', time: '15:55', end: '17:15', title: '入境＋取行李＋海關', titleJa: '入国審査・手荷物受取・税関', place: '成田国際空港 第2ターミナル', notes: '預留約 80 分鐘；實際視乎入境人流。', wiki: 'ja:成田国際空港' }),
        I({ type: 'other', time: '17:15', end: '17:30', title: '前往京成線＋買 Skyliner 飛／等車', titleJa: '京成線 スカイライナー券売所', place: '空港第2ビル駅', notes: 'T2 地庫 B1 京成櫃位買 Skyliner 指定席（約 ¥2,580）。可以預先喺網上買 e-ticket。', links: [{ label: 'Skyliner 官網', url: 'https://www.keisei.co.jp/keisei/tetudou/skyliner/tc/' }] }),
        I({
          type: 'train', time: '17:30', end: '18:15', title: 'Skyliner：成田機場 → 京成上野', titleJa: 'スカイライナー 成田空港 → 京成上野',
          number: 'Skyliner スカイライナー', from: '空港第2ビル駅', fromZh: '成田機場 T2 站', to: '京成上野駅', toZh: '京成上野站', wiki: 'ja:スカイライナー',
          notes: '車程約 41–47 分鐘，全車指定席。\n⚠️ 時刻表上 17:30 冇車：建議搭 17:43（56號）→ 18:24，或者早啲 17:22。可以撳「延遲」+10 分鐘自動推後之後嘅行程。',
          timetable: [
            { dep: '17:02', arr: '17:43', name: '152號' },
            { dep: '17:22', arr: '18:07', name: '154號' },
            { dep: '17:43', arr: '18:24', name: '56號', note: '最貼合行程' },
            { dep: '18:03', arr: '18:48', name: '58號' },
            { dep: '18:18', arr: '19:10', name: '160號' },
            { dep: '18:43', arr: '19:27', name: '62號' },
          ],
          timetableNote: '平日（10/29 星期四）時刻；以京成官網為準。',
          timetableUrl: SKYLINER_URL_JA_IN,
          links: [{ label: '京成官方時刻表', url: SKYLINER_OFFICIAL }],
          ref: '',
        }),
        walk('18:15', '18:35', '京成上野 → 上野站（轉東京 Metro）', '京成上野駅', '上野駅', { fromZh: '京成上野站', toZh: '上野站', notes: '包括步行轉站約 5–8 分鐘，跟「東京メトロ 銀座線」指示行。', stationLinks: [{ label: '上野站 站內圖 (Metro)', url: 'https://www.tokyometro.jp/lang_en/station/ueno/index.html' }] }),
        I({ type: 'train', time: '18:35', end: '18:55', title: '上野 → 銀座（銀座線）', titleJa: '東京メトロ銀座線 上野 → 銀座', number: '銀座線 G16 → G09', from: '上野駅', fromZh: '上野站', to: '銀座駅', toZh: '銀座站', notes: '約 10 分鐘，每 2–5 分鐘一班，約 ¥180（Suica 直接拍卡）。', timetableNote: '銀座線繁忙時段每 2–3 分鐘一班，唔使睇時刻表。', planB: '日比谷線 上野 → 東銀座 直達（約 15 分鐘），6 號出口行 3 分鐘就到酒店，唔使拖行李行 15 分鐘。', stationLinks: [{ label: '銀座站 站內圖 (Metro)', url: 'https://www.tokyometro.jp/lang_en/station/ginza/index.html' }] }),
        walk('18:55', '19:10', '銀座站 → 酒店', '銀座駅', HOTEL_TYO.place, { fromZh: '銀座站', toZh: '酒店' }),
        I({ type: 'hotel', time: '19:10', end: '19:30', ...HOTEL_TYO, title: 'Check-in：三井花園飯店 銀座築地', notes: 'Check-in 15:00 / Check-out 11:00。電話 03-5565-2731。\n最近車站：東銀座站 6 號出口步行 3 分鐘；築地站 2 號出口步行 4 分鐘。', ref: '' }),
        walk('19:30', '19:45', '酒店 → 銀座 篝 本店', HOTEL_TYO.place, '銀座 篝 本店', { fromZh: '酒店', toZh: '銀座 篝' }),
        I({
          type: 'food', time: '19:45', end: '20:45', title: '晚餐：銀座 篝 本店', titleJa: '銀座 篝 本店', place: '銀座 篝 本店',
          address: '東京都中央区銀座6-4-12 1F（銀座站 B9 出口步行 4 分鐘）',
          hours: '約 11:00–21:30／22:30（各網站資料唔同，以當日為準）',
          notes: '唔收訂位：晚市通常排 30–60 分鐘，入門口食券機買飛。',
          planB: '築地夜市（TBC）；或者 銀座 GINZA SIX B2 美食。',
          menu: {
            items: [
              { name: '雞白湯拉麵', ja: '鶏白湯Soba', price: '約 ¥2,000', star: true, desc: '招牌：好似濃湯咁滑嘅雞白湯' },
              { name: '雞白湯醬油拉麵', ja: '鶏白湯醤油Soba', price: '約 ¥2,000' },
              { name: '黑松露雞白湯拉麵', ja: '鶏白湯生トリュフSoba', price: '約 ¥3,000', desc: '季節限定，有就試' },
              { name: '沾麵', ja: 'つけSOBA', price: '' },
            ],
            tips: '價錢參考 2025 年資料（已含稅），可能有調整。',
          },
        }),
        walk('20:45', '21:00', '返酒店', '銀座 篝 本店', HOTEL_TYO.place, { fromZh: '銀座 篝', toZh: '酒店' }),
        I({ type: 'hotel', time: '21:00', ...HOTEL_TYO, title: '回到酒店休息' }),
      ]),

      /* ---------------- Day 2 ---------------- */
      day('2026-10-30', { city: '東京', cityJa: '東京', country: 'JP', title: 'Day 2 · 築地、谷根千、村上春樹、新宿', notes: '10/30–11/1 築地秋祭 2026 期間。' }, [
        walk('09:00', '09:10', '酒店 → 築地場外市場', HOTEL_TYO.place, '築地場外市場', { fromZh: '酒店', toZh: '築地場外市場' }),
        I({
          type: 'food', time: '09:10', end: '10:00', title: '築地市場早餐＋逛市場', titleJa: '築地場外市場', place: '築地場外市場', wiki: 'ja:築地場外市場',
          url: 'https://www.tsukiji.or.jp/',
          notes: '大部分舖頭朝早開到中午左右，星期日及假期有啲休息。',
          menu: {
            url: 'https://www.tsukiji.or.jp/',
            items: [
              { name: '丸武 玉子燒', ja: '丸武 玉子焼き', price: '約 ¥150–200', star: true, desc: '新鮮燒起嘅一人份，邊行邊食' },
              { name: 'きつねや 牛雜丼', ja: 'きつねや ホルモン丼', price: '約 ¥1,000', star: true, desc: '人氣排隊店，07:00–13:30，週日休' },
              { name: '又こい家 海鮮丼', ja: '又こい家 総本店', price: '約 ¥2,000–4,000', desc: '吞拿魚稀有部位；無休' },
              { name: '鮮蠔／海膽／燒帆立貝', ja: '牡蠣・うに・ホタテ焼き', price: '¥500 起', desc: '市場街邊攤' },
            ],
            tips: '現金同 Suica 都準備好；好多小店淨係收現金。',
          },
        }),
        I({ type: 'train', time: '10:00', end: '10:40', title: '築地 → 根津', titleJa: '日比谷線 → 千代田線', number: '日比谷線 → 日比谷站轉千代田線', from: '築地駅', fromZh: '築地站', to: '根津駅', toZh: '根津站', notes: '日比谷線 築地 → 日比谷（轉千代田線）→ 根津，約 25 分鐘＋步行。', stationLinks: [{ label: '築地站 (Metro)', url: 'https://www.tokyometro.jp/lang_en/station/tsukiji/index.html' }, { label: '根津站 (Metro)', url: 'https://www.tokyometro.jp/lang_en/station/nezu/index.html' }] }),
        I({ type: 'sight', time: '10:40', end: '11:30', title: '根津神社', titleJa: '根津神社', place: '根津神社', address: '東京都文京区根津1-28-9', wiki: 'ja:根津神社', notes: '主殿（國家重要文化財）、乙女稻荷千本鳥居、境內散步。免費參拜。\n根津站 1 號出口步行約 5 分鐘。', hours: '境內約 06:00–17:00' }),
        walk('11:30', '11:50', '根津神社 → 谷中銀座', '根津神社', '谷中銀座商店街', { fromZh: '根津神社', toZh: '谷中銀座', notes: '建議沿谷中一帶慢慢行。' }),
        I({
          type: 'food', time: '11:50', end: '13:20', title: '谷中銀座掃街午餐＋散步', titleJa: '谷中銀座商店街', place: '谷中銀座商店街', wiki: 'ja:谷中銀座商店街',
          notes: '邊行邊食，唔使另外安排正式午餐。「夕やけだんだん」樓梯係影相位。',
          url: 'https://www.yanakaginza.com/',
          menu: {
            items: [
              { name: '肉のすずき 炸肉餅', ja: '肉のすずき メンチカツ', price: '約 ¥300', star: true, desc: '牛豬肉黃金比例，好多汁' },
              { name: '肉のサトー 元氣炸肉餅', ja: '肉のサトー 元気メンチ', price: '約 ¥300', star: true, desc: '用 A5 和牛；同上面兩間比較下' },
              { name: '貓尾冬甩', ja: 'やなかしっぽや', price: '約 ¥150', desc: '貓尾巴形狀，打卡手信' },
              { name: '炸可樂餅', ja: 'コロッケ', price: '約 ¥100–200' },
            ],
          },
        }),
        I({ type: 'train', time: '13:20', end: '14:05', title: '谷中銀座 → 早稻田', titleJa: '千代田線 → 東西線', number: '千代田線 → 大手町轉東西線', from: '千駄木駅', fromZh: '千駄木站', to: '早稲田駅', toZh: '早稻田站', notes: '千駄木 → 大手町（轉東西線）→ 早稻田，約 30 分鐘；預留轉車 buffer。', stationLinks: [{ label: '早稻田站 (Metro)', url: 'https://www.tokyometro.jp/lang_en/station/waseda/index.html' }] }),
        walk('14:05', '14:15', '早稻田站 → 村上春樹圖書館', '早稲田駅', '早稲田大学国際文学館', { fromZh: '早稻田站', toZh: '村上春樹圖書館' }),
        I({ type: 'sight', time: '14:15', end: '16:10', title: '村上春樹圖書館（早稻田大學國際文學館）', titleJa: '早稲田大学国際文学館（村上春樹ライブラリー）', place: '早稲田大学国際文学館', address: '東京都新宿区西早稲田1-6-1 早稲田大学4号館', wiki: 'ja:早稲田大学国際文学館', url: 'https://www.waseda.jp/culture/wihl/', hours: '10:00–17:00 · 逢星期三休館', notes: '免費、唔使預約。隈研吾改建，木隧道書架係重點。館內有學生營運嘅 café「橙子猫 Orange Cat」。' }),
        I({ type: 'train', time: '16:10', end: '16:40', title: '村上春樹圖書館 → 新宿', titleJa: '東西線 → JR山手線', number: '東西線 早稻田 → 高田馬場 → JR 山手線', from: '早稲田駅', fromZh: '早稻田站', to: '西武新宿駅', toZh: '新宿（西武新宿站）', notes: '地鐵＋步行。' }),
        walk('16:40', '17:00', '新宿休息／去牛かつもと村', '西武新宿駅', '牛かつもと村 新宿本店', { fromZh: '西武新宿站', toZh: '牛かつもと村' }),
        I({
          type: 'food', time: '17:00', end: '18:20', title: '晚餐：牛かつもと村 新宿本店', titleJa: '牛かつもと村 新宿本店', place: '牛かつもと村 新宿本店',
          address: '東京都新宿区歌舞伎町1-25-3 WaMall 西武新宿駅前ビル B2', hours: '11:00–22:00（L.O. 21:00）',
          url: 'https://www.gyukatsu-motomura.com/reservation-1?stt_lang=en', ref: '',
          notes: '已有預約連結（撳「網站」）。西武新宿站正面口步行 1 分鐘。電話 050-1722-2861。',
          menu: {
            url: 'https://www.gyukatsu-motomura.com/',
            items: [
              { name: '炸牛排定食 130g', ja: '牛かつ定食 130g（麦めし・味噌汁）', price: '約 ¥1,630', star: true, desc: '自己喺小石板燒到想要嘅熟度' },
              { name: '炸牛排定食 260g（大份）', ja: '牛かつ定食 ダブル', price: '約 ¥2,600+' },
              { name: '山芋泥', ja: 'とろろ', price: '+¥', desc: '配麥飯一流' },
            ],
            tips: '每件放落石板燒 10–15 秒就夠；醬汁有山葵醬油／特製醬。價錢以店內為準。',
          },
        }),
        I({ type: 'sight', time: '18:20', end: '19:30', title: '歌舞伎町散步', titleJa: '歌舞伎町一番街・ゴジラヘッド', place: '新宿東宝ビル', wiki: 'ja:新宿東宝ビル', notes: '歌舞伎町一番街、Godzilla 頭（新宿東寶大廈 8 樓露台）一帶。夜晚注意拉客，唔好跟人入舖。' }),
        I({ type: 'train', time: '19:30', end: '20:10', title: '新宿 → 銀座／酒店', titleJa: '丸ノ内線 新宿 → 銀座', number: '丸之內線 新宿 → 銀座', from: '新宿駅', fromZh: '新宿站', to: '銀座駅', toZh: '銀座站', notes: '約 16 分鐘，之後步行返酒店。' }),
        I({ type: 'hotel', time: '20:10', ...HOTEL_TYO, title: '回到酒店' }),
      ]),

      /* ---------------- Day 3 ---------------- */
      day('2026-10-31', { city: '東京', cityJa: '東京', country: 'JP', title: 'Day 3 · 根津美術館、表參道建築、代官山、中目黑' }, [
        walk('09:00', '09:10', '酒店 → 築地場外市場', HOTEL_TYO.place, '築地場外市場', { fromZh: '酒店', toZh: '築地場外市場' }),
        I({
          type: 'food', time: '09:10', end: '10:00', title: '築地市場早餐', titleJa: '築地場外市場', place: '築地場外市場', wiki: 'ja:築地場外市場',
          menu: {
            items: [
              { name: '海鮮丼', ja: '海鮮丼', price: '¥2,000 起', star: true, desc: '昨日未試嘅就今日試' },
              { name: '鯛魚燒', ja: '築地 さのきや たい焼き', price: '約 ¥200' },
              { name: '吞拿魚串燒／刺身', ja: 'まぐろ串', price: '¥500 起' },
            ],
          },
        }),
        I({ type: 'train', time: '10:00', end: '10:35', title: '築地 → 根津美術館', titleJa: '日比谷線 → 銀座線 表参道', number: '日比谷線 → 銀座站轉銀座線', from: '築地駅', fromZh: '築地站', to: '表参道駅', toZh: '表參道站', notes: '表參道站 A5 出口步行約 8 分鐘。', stationLinks: [{ label: '表參道站 (Metro)', url: 'https://www.tokyometro.jp/lang_en/station/omote-sando/index.html' }] }),
        I({ type: 'sight', time: '10:35', end: '11:50', title: '根津美術館', titleJa: '根津美術館', place: '根津美術館', address: '東京都港区南青山6-5-1', wiki: 'ja:根津美術館', url: 'https://www.nezu-muse.or.jp/', hours: '10:00–17:00（16:30 最後入場）· 逢星期一休', notes: '⚠️ 要網上預約時段！企劃展約 ¥1,300、特別展約 ¥1,500（網上價）。\n隈研吾設計，竹林入口步道＋大庭園一定要行。', ref: '' }),
        I({ type: 'sight', time: '11:50', end: '13:15', title: '南青山／表參道建築散步', titleJa: '表参道 建築散歩', place: '表参道', wiki: 'ja:表参道',
          notes: '以外觀為主，唔使逐間入：\n• 根津美術館（隈研吾）\n• Prada 青山（Herzog & de Meuron）\n• Dior 表參道（SANAA）\n• Tod\'s 表參道（伊東豐雄）\n• 表參道之丘（安藤忠雄）',
          links: [{ label: 'Prada 青山 地圖', url: 'https://www.google.com/maps/search/?api=1&query=Prada+Aoyama+Tokyo' }, { label: 'Dior 表參道 地圖', url: 'https://www.google.com/maps/search/?api=1&query=Dior+Omotesando' }, { label: '表參道之丘 地圖', url: 'https://www.google.com/maps/search/?api=1&query=Omotesando+Hills' }] }),
        I({ type: 'train', time: '13:15', end: '13:40', title: '表參道 → 代官山', titleJa: '表参道 → 渋谷 → 東急東横線 代官山', number: '銀座線／半藏門線 → 澀谷轉東急東橫線', from: '表参道駅', fromZh: '表參道站', to: '代官山駅', toZh: '代官山站', notes: '電車＋步行。' }),
        I({
          type: 'food', time: '13:40', end: '14:40', title: '代官山 Café 午餐', titleJa: 'IVY PLACE（代官山T-SITE）', place: 'IVY PLACE 代官山', wiki: 'ja:代官山T-SITE',
          notes: '建議 IVY PLACE：喺代官山 T-SITE 入面，似森林別墅，有露台。',
          planB: 'GARDEN HOUSE CRAFTS Daikanyama（國產小麥麵包，有露台）',
          menu: {
            items: [
              { name: '經典酪奶班戟', ja: 'クラシックバターミルクパンケーキ', price: '約 ¥1,800', star: true, desc: '店家招牌' },
              { name: '午市意粉／漢堡', ja: 'ランチ パスタ・バーガー', price: '約 ¥2,000' },
            ],
            tips: '週末午市多人，可以喺 Tabelog／官網預約。',
          },
        }),
        I({ type: 'shop', time: '14:40', end: '16:15', title: '代官山購物＋蔦屋書店', titleJa: '代官山 蔦屋書店（代官山T-SITE）', place: '代官山 蔦屋書店', wiki: 'ja:代官山T-SITE', hours: '蔦屋書店 09:00–22:00', notes: 'T-SITE（Klein Dytham 設計）一帶好啱慢慢逛。附近 Hillside Terrace（槇文彥）都值得睇。' }),
        walk('16:15', '16:40', '代官山 → 中目黑', '代官山駅', '中目黒駅', { fromZh: '代官山', toZh: '中目黑', notes: '建議直接步行，沿街慢慢行。' }),
        I({ type: 'shop', time: '16:40', end: '17:30', title: '中目黑購物＋目黑川散步', titleJa: '中目黒・目黒川', place: '目黒川 中目黒', wiki: 'ja:目黒川', notes: 'Starbucks Reserve Roastery Tokyo（隈研吾設計）喺目黑川邊。' }),
        I({
          type: 'food', time: '17:30', end: '18:50', title: '晚餐：和牛壽喜燒 そしじ 中目黑店', titleJa: '和牛すき焼 そしじ 中目黒店', place: '和牛すき焼 そしじ 中目黒店',
          address: '東京都目黒区上目黒3-16-1 コットンビル 2F', hours: '星期六 11:30–23:00（L.O. 22:00）',
          url: 'https://yoyaku.toreta.in/nakame-b', ref: '',
          notes: '電話 03-3791-2514。A5 黑毛和牛，南部鐵器特製鍋。',
          links: [{ label: 'Tabelog 食評', url: 'https://tabelog.com/tw/tokyo/A1317/A131701/13318941/dtlrvwlst/' }],
          menu: {
            url: 'https://tabelog.com/tw/tokyo/A1317/A131701/13318941/',
            items: [
              { name: '壽喜燒套餐「上」（赤身）', ja: 'すき焼セット 上', price: '¥2,980（未連稅）' },
              { name: '壽喜燒套餐「特」（上赤身）', ja: 'すき焼セット 特', price: '¥3,380（未連稅）' },
              { name: '壽喜燒套餐「天」（霜降）', ja: 'すき焼セット 天', price: '¥3,980（未連稅）', star: true, desc: '包野菜＋そしじ蛋' },
              { name: '燒汁免治牛柳（Chateaubriand）', ja: '特へれステーキたれ焼き', price: '¥18,700／2人', desc: '中目黑店限定，最少 2 人份' },
              { name: '馬刺身', ja: '馬刺し', price: '¥1,250（未連稅）' },
            ],
            tips: '2026 年 3 月新開，價錢參考開幕資料。',
          },
        }),
        I({ type: 'train', time: '18:50', end: '19:25', title: '中目黑 → 赤羽橋', titleJa: '日比谷線 → 都営大江戸線', number: '日比谷線 → 六本木轉大江戶線', from: '中目黒駅', fromZh: '中目黑站', to: '赤羽橋駅', toZh: '赤羽橋站', notes: '地下鐵＋轉車。' }),
        I({ type: 'sight', time: '19:25', end: '19:50', title: '赤羽橋遠眺東京鐵塔', titleJa: '東京タワー（赤羽橋口）', place: '東京タワー', wiki: 'ja:東京タワー', notes: '唔上塔；出站影相＋睇夜景。' }),
        I({ type: 'train', time: '19:50', end: '20:20', title: '赤羽橋 → 酒店', titleJa: '大江戸線 → 浅草線 東銀座', number: '大江戶線 → 大門轉淺草線 → 東銀座', from: '赤羽橋駅', fromZh: '赤羽橋站', to: '東銀座駅', toZh: '東銀座站', notes: '東銀座 6 號出口步行 3 分鐘返酒店。' }),
        I({ type: 'hotel', time: '20:20', ...HOTEL_TYO, title: '回到酒店' }),
      ]),

      /* ---------------- Day 4 ---------------- */
      day('2026-11-01', { city: '東京', cityJa: '東京', country: 'JP', title: 'Day 4 · 築地秋祭、銀座、返香港', notes: '酒店 11:00 前 check-out。' }, [
        I({ type: 'other', time: '08:30', end: '09:00', title: '起身執行李', notes: '今日酒店 Check-out 係 11:00，先執好行李。' }),
        walk('09:00', '09:10', '酒店 → 市場橋公園', HOTEL_TYO.place, '市場橋公園 築地', { fromZh: '酒店', toZh: '市場橋公園' }),
        I({ type: 'food', time: '09:10', end: '10:10', title: '市場橋公園 築地美食節 早餐', titleJa: '築地秋まつり 築地フードフェス（中央区立市場橋公園）', place: '市場橋公園 築地', url: 'https://www.tsukiji.or.jp/', wiki: 'ja:築地場外市場',
          notes: '築地秋祭 2026（10/30–11/1）。往年有「江戸一」、「築地 さのきや」等老店特別菜單。開放時間以官網公布為準。',
          planB: '直接去築地場外市場（星期日部分舖頭休息）' }),
        walk('10:10', '10:20', '市場橋公園 → 酒店', '市場橋公園 築地', HOTEL_TYO.place, { fromZh: '市場橋公園', toZh: '酒店' }),
        I({ type: 'hotel', time: '10:20', end: '10:50', ...HOTEL_TYO, title: 'Check-out＋寄存行李', notes: '酒店官方 Check-out 11:00。' }),
        walk('10:50', '11:00', '酒店 → 銀座 LOFT', HOTEL_TYO.place, '銀座ロフト', { fromZh: '酒店', toZh: '銀座 LOFT' }),
        I({ type: 'shop', time: '11:00', end: '12:00', title: '銀座 LOFT 購物', titleJa: '銀座ロフト', place: '銀座ロフト', hours: '星期日 11:00 開門', notes: '文具、生活雜貨、化妝品。' }),
        walk('12:00', '12:10', '步行去銀座三越', '銀座ロフト', '銀座三越', { fromZh: '銀座 LOFT', toZh: '銀座三越' }),
        I({ type: 'food', time: '12:10', end: '12:50', title: '銀座三越 B2/B3 食品街小食＋買手信', titleJa: '銀座三越 デパ地下', place: '銀座三越', address: '東京都中央区銀座4-6-16', wiki: 'ja:銀座三越',
          menu: { items: [{ name: '和菓子／洋菓子禮盒', ja: '和菓子・洋菓子', star: true, desc: '手信首選，有得包裝' }, { name: '即食熟食、便當', ja: '惣菜・弁当', desc: '當午餐小食' }], tips: '退稅記得帶護照。' } }),
        walk('12:50', '13:05', '步行返酒店', '銀座三越', HOTEL_TYO.place, { fromZh: '銀座三越', toZh: '酒店' }),
        I({ type: 'hotel', time: '13:05', end: '13:25', ...HOTEL_TYO, title: '取寄存行李＋洗手間＋整理' }),
        I({
          type: 'train', time: '13:30', end: '14:45', title: '酒店 → 成田機場 T2', titleJa: '東銀座 → 上野 → 京成上野 スカイライナー → 空港第2ビル',
          number: '日比谷線 東銀座 → 上野 ＋ Skyliner', from: '京成上野駅', fromZh: '京成上野站', to: '空港第2ビル駅', toZh: '成田機場 T2 站', wiki: 'ja:スカイライナー',
          notes: '東銀座（日比谷線）→ 上野 約 15 分鐘 → 步行去京成上野 5–8 分鐘 → Skyliner 約 41 分鐘。\n建議搭 14:00（51號）→ 14:41。預留轉車 buffer。',
          timetable: [
            { dep: '13:00', arr: '13:41', name: '45號' },
            { dep: '13:17', arr: '14:01', name: '47號' },
            { dep: '13:40', arr: '14:21', name: '49號' },
            { dep: '14:00', arr: '14:41', name: '51號', note: '最貼合行程' },
          ],
          timetableNote: '京成上野開出（平日時刻）；11/1 係星期日，可能差 1–2 分鐘，以京成官網為準。',
          timetableUrl: SKYLINER_URL_JA_OUT,
          links: [{ label: '京成官方時刻表', url: SKYLINER_OFFICIAL }],
        }),
        I({ type: 'other', time: '14:45', end: '15:30', title: '航空公司 Check-in＋寄行李', place: '成田国際空港 第2ターミナル', titleJa: '成田空港 第2ターミナル 出発ロビー' }),
        I({ type: 'other', time: '15:30', end: '16:00', title: '出境安檢＋證照查驗', notes: '實際按當日人流。' }),
        I({ type: 'shop', time: '16:00', end: '16:50', title: 'T2 免稅店／最後購物', notes: '先確認登機閘口位置、餐廳取票。' }),
        I({
          type: 'food', time: '16:50', end: '17:50', title: '晚餐：鰻魚 四代目菊川（成田機場店）', titleJa: 'うなぎ四代目菊川 成田空港店', place: 'うなぎ四代目菊川 成田空港店',
          address: '成田国際空港 第2ターミナル 本館（出境禁區內 food hall）', hours: '約 07:30–22:00',
          notes: '喺 T2 國際線安檢後。',
          links: [{ label: 'Tabelog', url: 'https://tabelog.com/en/chiba/A1204/A120401/12058270/' }],
          menu: {
            url: 'https://tabelog.com/en/chiba/A1204/A120401/12058270/dtlmenu/',
            items: [
              { name: '鰻魚飯三食', ja: 'ひつまぶし', price: '約 ¥4,800–6,000', star: true, desc: '原味→加藥味→加茶泡飯，三種食法' },
              { name: '燒鰻魚套餐', ja: '焼きうなぎセット（肝吸い・漬物）', price: '約 ¥5,880' },
            ],
          },
        }),
        I({ type: 'shop', time: '17:50', end: '18:25', title: '免稅店＋前往登機閘口', notes: '保留最後購物時間。' }),
        I({ type: 'other', time: '18:25', end: '19:00', title: '到達登機閘口', notes: '建議起飛前最少 35 分鐘已經喺閘口附近。' }),
        I({ type: 'flight', time: '19:00', end: '22:50', title: '東京成田 → 香港', number: '（待填）', from: '成田国際空港 第2ターミナル', fromZh: '成田機場 T2', to: 'Hong Kong International Airport', toZh: '香港國際機場', notes: '抵港時間係估算（香港時間），請按機票更正。' }),
        A11({ time: '22:50', end: '23:59', title: '香港機場 → 北角', from: 'Hong Kong International Airport', fromZh: '香港機場', to: "425 King's Road, North Point", toZh: '北角', planB: '夜晚的士直接返北角（約 45 分鐘）' }),
      ]),

      ...['02', '03', '04'].map(d => day(`2026-11-${d}`, { city: '香港', cityJa: 'Hong Kong', country: 'HK', title: '香港自由活動' })),

      /* ---------------- 跟團：日本本州白川鄉 6 天（日期待確認） ---------------- */
      day('2026-11-05', { city: '東京', cityJa: '東京', country: 'JP', group: 'tour', title: '跟團 D1 · 香港 → 東京成田／羽田',
        notes: '⚠️ 跟團日期未確認，暫時放 11/5–11/10。改其中一日嘅日期時揀「整團一齊改」。\n世界通 Go World 團號 BCXB6-A（香港直航 6 天 HB/HX）。\n費用：$2,899 + 稅 $1,550 + 服務費 $960 ≈ $5,409／人（單房差 $2,200）；保險自己買。\n聯絡：世界通 銅鑼灣分店 WhatsApp 6850 7393／電話 3698 2029。' }, [
        A11({ time: '11:30', end: '12:30', title: '北角 → 香港機場（集合）', from: "425 King's Road, North Point", fromZh: '北角', to: 'Hong Kong International Airport', toZh: '香港國際機場', notes: '集合時間會喺出發前 3 日通知（通常起飛前 3 小時）。' }),
        I({ type: 'flight', time: '15:00', end: '19:55', title: '香港 → 東京成田／羽田（下午機）', number: 'HX／HB', from: 'Hong Kong International Airport', fromZh: '香港國際機場', to: '成田国際空港', toZh: '成田／羽田機場', notes: '參考航班：約 15:00–19:55（亦可能 08:15–12:55 或 13:40–18:15），以機票為準。' }),
        I({ type: 'hotel', title: '東京成田 AIC 酒店或同級', titleJa: '成田エリアのホテル', place: '成田 ホテル', notes: '三星標準，以旅行社安排為準。' }),
      ]),
      day('2026-11-06', { city: '東京 → 富士山', cityJa: '東京・富士山', country: 'JP', group: 'tour', title: '跟團 D2 · 銀座、秋葉原、淺草寺 → 富士山' }, [
        I({ type: 'sight', title: '銀座（約 60 分鐘）', titleJa: '銀座', place: '銀座', wiki: 'ja:銀座' }),
        I({ type: 'sight', title: '秋葉原', titleJa: '秋葉原', place: '秋葉原', wiki: 'ja:秋葉原' }),
        I({ type: 'sight', title: '淺草寺（紅葉限定）', titleJa: '浅草寺', place: '浅草寺', wiki: 'ja:浅草寺' }),
        I({ type: 'food', title: '午餐：東京燒肉料理', notes: '團餐。' }),
        I({ type: 'hotel', title: '富士河口湖大橋酒店或同級', titleJa: '富士河口湖エリアのホテル', place: '河口湖', wiki: 'ja:河口湖', notes: '溫泉晚餐（團餐）。' }),
      ]),
      day('2026-11-07', { city: '富士山 → 長野', cityJa: '富士山・長野', country: 'JP', group: 'tour', title: '跟團 D3 · 忍野八海、山中湖、河口湖紅葉 → 長野' }, [
        I({ type: 'sight', title: '忍野八海（紅葉限定）', titleJa: '忍野八海', place: '忍野八海', wiki: 'ja:忍野八海' }),
        I({ type: 'sight', title: '山中湖 白鳥之湖 遠眺富士山', titleJa: '山中湖', place: '山中湖', wiki: 'ja:山中湖' }),
        I({ type: 'sight', title: '河口湖紅葉回廊', titleJa: '河口湖 もみじ回廊', place: '河口湖 もみじ回廊', wiki: 'ja:河口湖' }),
        I({ type: 'sight', title: '天空驛站（富士山全景）', titleJa: '天空の駅', place: '天空の駅 富士山' }),
        I({ type: 'food', title: '午餐：富士料理；晚餐：日式定食', notes: '團餐。' }),
        I({ type: 'hotel', title: '松本花月酒店或同級', titleJa: '松本 ホテル花月', place: 'ホテル花月 松本', notes: '長野地區三星標準。' }),
      ]),
      day('2026-11-08', { city: '長野 → 岐阜', cityJa: '長野・岐阜', country: 'JP', group: 'tour', title: '跟團 D4 · 高山陣屋、上三之町、白川鄉' }, [
        I({ type: 'sight', title: '高山陣屋', titleJa: '高山陣屋', place: '高山陣屋', wiki: 'ja:高山陣屋', notes: '日本唯一現存江戶幕府郡代／代官官署遺址。' }),
        I({ type: 'sight', title: '上三之町（飛驒高山小京都）', titleJa: '上三之町', place: '上三之町 高山', wiki: 'ja:三町伝統的建造物群保存地区' }),
        I({ type: 'sight', title: '白川鄉合掌村＋出會橋', titleJa: '白川郷 合掌造り集落・であい橋', place: '白川郷', wiki: 'ja:白川郷', notes: '世界文化遺產，60 度人字形茅草屋頂。' }),
        I({ type: 'food', title: '午餐：京都料理；晚餐：鄉土料理', notes: '團餐。' }),
        I({ type: 'hotel', title: '都岐阜酒店或同級', titleJa: '都ホテル 岐阜長良川', place: '都ホテル 岐阜長良川', notes: '岐阜地區三星標準。' }),
      ]),
      day('2026-11-09', { city: '京都 → 奈良 → 大阪', cityJa: '京都・奈良・大阪', country: 'JP', group: 'tour', title: '跟團 D5 · 清水寺、抹茶體驗、奈良公園、道頓堀' }, [
        I({ type: 'shop', title: '綜合免稅店（約 60 分鐘）' }),
        I({ type: 'sight', title: '清水寺＋二三年坂（紅葉限定）', titleJa: '清水寺・二年坂・三年坂', place: '清水寺', wiki: 'ja:清水寺', notes: '已包門票。' }),
        I({ type: 'other', title: '抹茶體驗', titleJa: '抹茶体験' }),
        I({ type: 'sight', title: '奈良公園＋春日大社（紅葉＋小鹿）', titleJa: '奈良公園・春日大社', place: '奈良公園', wiki: 'ja:奈良公園' }),
        I({ type: 'shop', title: '心齋橋＋道頓堀（約 60 分鐘）', titleJa: '心斎橋・道頓堀', place: '道頓堀', wiki: 'ja:道頓堀' }),
        I({ type: 'food', title: '午餐：炙櫻手作；晚餐：日式料理', notes: '團餐。' }),
        I({ type: 'hotel', title: '關西未來酒店或同級', titleJa: '関西エリアのホテル', place: '大阪 ホテル', notes: '關西地區三星標準。' }),
      ]),
      day('2026-11-10', { city: '大阪 → 香港', cityJa: '大阪', country: 'JP', group: 'tour', title: '跟團 D6 · 關西機場 → 香港' }, [
        I({ type: 'bus', title: '酒店 → 關西國際機場（團車）', from: '大阪', to: '関西国際空港', toZh: '關西機場', wiki: 'ja:関西国際空港' }),
        I({ type: 'flight', time: '15:10', end: '19:50', title: '大阪關西 → 香港（晚機）', number: 'HX／HB', from: '関西国際空港', fromZh: '關西機場', to: 'Hong Kong International Airport', toZh: '香港國際機場', notes: '參考航班：約 15:10–19:50（亦可能 09:30–13:30 或 14:05–17:35），以機票為準。' }),
        A11({ time: '19:50', end: '21:00', title: '香港機場 → 北角', from: 'Hong Kong International Airport', fromZh: '香港機場', to: "425 King's Road, North Point", toZh: '北角' }),
      ]),

      day('2026-11-11', { city: '香港', cityJa: 'Hong Kong', country: 'HK', title: '香港自由活動／執行李' }),
      day('2026-11-12', { city: '香港 → 倫敦', cityJa: 'Hong Kong', country: 'HK', title: '飛返英國' }, [
        A11({ title: '北角 → 香港機場', from: "425 King's Road, North Point", fromZh: '北角', to: 'Hong Kong International Airport', toZh: '香港國際機場', notes: '起飛前最少 3 小時到機場。' }),
        I({ type: 'flight', title: '香港 → 倫敦 航班', number: '（待填）', from: 'Hong Kong International Airport', fromZh: '香港國際機場', to: 'London Heathrow Airport', toZh: '倫敦希斯路機場', notes: '航班號、時間、訂位號碼未填。' }),
      ]),
    ],
    ideas: [
      I({ type: 'sight', title: 'Starbucks Reserve Roastery Tokyo', titleJa: 'スターバックス リザーブ ロースタリー 東京', place: 'Starbucks Reserve Roastery Tokyo', country: 'JP', notes: '隈研吾設計，目黑川邊。' }),
      I({ type: 'sight', title: '表參道之丘', titleJa: '表参道ヒルズ', place: '表参道ヒルズ', wiki: 'ja:表参道ヒルズ', country: 'JP', notes: '安藤忠雄。' }),
      I({ type: 'food', title: '築地夜市（TBC）', titleJa: '築地', place: '築地', country: 'JP' }),
    ],
  };
})();
