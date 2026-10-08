/* =========================================================
   東京行程 10/29（四）– 11/1（日）· 根據 1007_Tokyo_Itinerary.xlsx
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
  const gmap = url => ({ label: '你嘅 Google Maps 連結', url });

  const HOTEL = {
    title: '三井花園飯店 銀座築地',
    titleJa: '三井ガーデンホテル銀座築地',
    place: '三井ガーデンホテル銀座築地',
    address: '〒104-0045 東京都中央区築地4-7-1',
    url: 'https://www.gardenhotels.co.jp/ginza-tsukiji/',
  };
  const H = { fromZh: '酒店', toZh: '酒店' };
  const TSUKIJI_PICS_A = ['File:Tsukiji Outer Market -01.jpg', 'File:Tsukiji Outer Market -09.jpg', 'File:Tamagoyaki (3099935773).jpg'];
  const TSUKIJI_PICS_B = ['File:Tsukiji Outside Market.jpg', 'File:Tsukiji Market 2017 (38052266396).jpg', 'File:Alleyway near the Tsukiji fish market in Tokyo, Japan.jpg'];
  const NRT_PICS = ['File:Departure lobby of Tokyo-Narita Airport Terminal 2.JPG', 'File:Narita Airpoert Terminal 2 Check-in Area.JPG', 'File:Narita Airport Terminal 2 exterior.jpg'];
  const KABUKI_PICS = ['File:Shinjuku toho building kabukicho 2015.jpg', 'File:Central Road Kabukicho-Sinjyuku-Tokyo.jpg'];
  const SKYLINER_OFFICIAL = 'https://www.keisei.co.jp/keisei/tetudou/skyliner/jp/traffic/skyliner_timetable.php';
  const metro = (slug, zh) => ({ label: `${zh} 站內圖`, url: `https://www.tokyometro.jp/lang_tcn/station/${slug}/index.html` });
  const MOTOMURA_MENU = { items: [
    { name: '炸牛排定食 130g', ja: '牛かつ定食 130g（麦めし・味噌汁）', price: '約 ¥1,630', star: true, desc: '自己喺小石板燒到想要嘅熟度' },
    { name: '炸牛排定食 260g', ja: '牛かつ定食 ダブル', price: '約 ¥2,600+' },
    { name: '山芋泥', ja: 'とろろ', desc: '配麥飯一流' },
  ], tips: '每件放落石板燒 10–15 秒就夠。價錢以店內為準。' };

  const trip = {
    seedVersion: 5,
    name: '東京 4 日',
    days: [
      /* ================= Day 1 · 10/29（四） ================= */
      day('2026-10-29', { city: '東京', title: '抵達東京・築地蠔湯拉麵', notes: '早上由北角出發去香港機場。日本比香港快 1 小時。' }, [
        I({ extra: true, type: 'flight', time: '11:00', end: '15:55', title: '香港 → 東京成田 T2', titleJa: '香港 → 成田空港 第2ターミナル', number: '（待填）', from: 'Hong Kong International Airport', fromZh: '香港機場', to: '成田国際空港 第2ターミナル', toZh: '成田機場 T2', pics: NRT_PICS,
          notes: '15:55（日本時間）抵達。起飛時間待填。\n落機前填好 Visit Japan Web，入境 QR code 截圖「加相」。' }),
        I({ type: 'other', time: '15:55', end: '17:10', title: '抵達成田 T2＋入境＋取行李', titleJa: '成田空港 第2ターミナル 到着・入国審査', place: '成田国際空港 第2ターミナル', pics: NRT_PICS, picCat: 'Category:Interior of Narita International Airport Terminal 2',
          notes: '落機 → 入境審查 → 行李提取 → 海關 → B1 京成電鐵站。預留入境及行李時間。' }),
        I({ type: 'other', time: '17:10', end: '17:30', title: '買／領 Skyliner 車票＋候車', titleJa: 'スカイライナー 乗車券（空港第2ビル駅）', place: '空港第2ビル駅', ref: '', picCat: 'Category:Narita Airport Terminal 2-3 Station',
          url: 'https://www.keisei.co.jp/keisei/tetudou/skyliner/e-ticket/zht/',
          notes: '成田空港第2・第3航廈站 → Skyliner 月台。全車指定席，建議預先網上買 e-ticket（撳「官網」）。' }),
        I({
          type: 'train', time: '17:30', end: '18:15', title: 'Skyliner：成田機場 → 京成上野', titleJa: 'スカイライナー 空港第2ビル → 京成上野',
          number: 'Skyliner', from: '空港第2ビル駅', fromZh: '成田機場 T2 站', to: '京成上野駅', toZh: '京成上野站',
          pics: ['File:Keisei-Type-AE.jpg'], picCat: 'Category:Skyliner',
          notes: '全車指定席，車程約 41–47 分鐘。\n⚠️ 17:30 冇班次：最近係 17:43（56號）→ 18:24。如果搭 17:43，撳「延遲」+15 分，之後行程會跟住移。',
          timetable: [
            { dep: '17:02', arr: '17:43', name: '152號' },
            { dep: '17:22', arr: '18:07', name: '154號' },
            { dep: '17:43', arr: '18:24', name: '56號', note: '建議' },
            { dep: '18:03', arr: '18:48', name: '58號' },
            { dep: '18:18', arr: '19:10', name: '160號' },
          ],
          timetableNote: '平日時刻（10/29 星期四），以京成官網為準。',
          timetableUrl: 'https://keisei.ekitan.com/naritaacs-i-tc/timetable/station/682-6/d1?dw=3&date=20261029',
          links: [{ label: '京成官方時刻表', url: SKYLINER_OFFICIAL }],
        }),
        walk('18:15', '18:25', '京成上野駅', '上野駅', { fromZh: '京成上野站', toZh: '上野站（日比谷線）', notes: '京成上野站出站 → 步行至東京 Metro 上野站。', stationLinks: [metro('ueno', '上野站')] }),
        I({ type: 'train', time: '18:25', end: '18:45', title: '日比谷線：上野 → 築地（直達）', titleJa: '東京メトロ日比谷線 上野 → 築地', number: '日比谷線 H18 → H11', from: '上野駅', fromZh: '上野站', to: '築地駅', toZh: '築地站',
          picCat: 'Category:Ueno Station (Tokyo Metro)', picQuery: 'Tsukiji Station Hibiya Line',
          notes: '直達唔使轉車，Suica 拍卡。', stationLinks: [metro('ueno', '上野站'), metro('tsukiji', '築地站')] }),
        walk('18:45', '19:00', '築地駅', HOTEL.place, { fromZh: '築地站', toZh: '酒店', notes: '築地站 2 號出口 → 步行約 4 分鐘。' }),
        I({ type: 'hotel', time: '19:00', end: '19:20', ...HOTEL, title: 'Check-in：三井花園飯店 銀座築地', ref: '',
          notes: 'Check-in 15:00 / Check-out 11:00 · 電話 03-5565-2731\n築地站 2 號出口步行 4 分鐘；東銀座站 6 號出口步行 3 分鐘。' }),
        walk('19:20', '19:30', HOTEL.place, 'らぁ麺 牡蠣と貝 築地本店', { fromZh: '酒店', toZh: '牡蠣と貝（築地3丁目）' }),
        I({
          type: 'food', time: '19:30', end: '20:20', title: '晚餐：らぁ麺 牡蠣と貝', titleJa: 'らぁ麺 牡蠣と貝 築地本店', place: 'らぁ麺 牡蠣と貝 築地本店',
          address: '東京都中央区築地3-16-9 アーバンメイツビル 1F', hours: '官方 X：06:00–翌日 05:00，年中無休（舊資料寫 10:00–22:00）',
          picQuery: 'oyster ramen Japan', picCat: 'Category:Ramen',
          notes: '牡蠣及貝類湯底拉麵。築地站步行 2 分鐘 · 電話 03-3546-6899\n入門口食券機買飛，可能淨係收現金。經常排隊。',
          planB: '銀座 篝 本店（雞白湯拉麵，銀座6-4-12）',
          menu: { items: [
            { name: '濃厚生蠔拉麵', ja: '濃厚牡蠣らぁ麺', price: '約 ¥1,080 起', star: true, desc: '招牌：電視介紹過嘅濃郁蠔湯' },
            { name: '濃厚生蠔拉麵（特上）', ja: '濃厚牡蠣らぁ麺 特上', price: '約 ¥1,730', desc: '加蠔、貝味玉子、肩肉叉燒、筍、紫菜' },
            { name: '生蠔沾麵', ja: '牡蠣つけ麺', price: '約 ¥1,150' },
            { name: '鹽味貝湯拉麵', ja: '塩の貝出汁らぁ麺', price: '約 ¥1,080', desc: '清啲嘅選擇' },
            { name: '生蠔飯', ja: '牡蠣飯', desc: '配拉麵嘅小飯' },
          ], tips: '價錢參考網上資料，以店內食券機為準。' },
        }),
        walk('20:20', '20:30', 'らぁ麺 牡蠣と貝 築地本店', HOTEL.place, { fromZh: '牡蠣と貝', toZh: '酒店' }),
        I({ type: 'hotel', time: '20:30', end: '21:00', ...HOTEL, title: '酒店休息' }),
      ]),

      /* ================= Day 2 · 10/30（五） ================= */
      day('2026-10-30', { city: '東京', title: '築地・根津・谷中・村上春樹・新宿', notes: '10/30–11/1 築地秋祭期間。' }, [
        walk('09:00', '09:05', HOTEL.place, 'まぐろのみやこ 築地', { ...H, toZh: '築地場外市場' }),
        I({
          type: 'food', time: '09:05', end: '09:45', title: '早餐：まぐろのみやこ', titleJa: 'まぐろのみやこ（築地場外市場）', place: 'まぐろのみやこ 築地',
          address: '東京都中央区築地4-13-13（築地場外市場）', hours: '06:30–16:00 · 星期日、假期、休市日休息',
          pics: TSUKIJI_PICS_A,
          notes: '熟海鮮及鮪魚料理，貝殼上即場燒。唔收信用卡（可用 PayPay），帶現金 · 電話 03-3547-6622',
          menu: { items: [
            { name: '海鮮燒', ja: '海鮮焼き', price: '約 ¥800', star: true, desc: '喺貝殼上即場燒' },
            { name: '燒帆立貝', ja: 'ホタテ焼き', price: '¥500 起', star: true },
            { name: '本鮪拖羅粒', ja: '本マグロトロブツ' },
            { name: '鮪魚眼後肉', ja: '目のウラ肉', desc: '稀有部位' },
          ], tips: '價錢參考網上資料，以店頭為準。' },
        }),
        I({ type: 'train', time: '09:45', end: '10:20', title: '築地 → 根津', titleJa: '日比谷線・千代田線 築地 → 根津', number: '日比谷線 → 日比谷站轉千代田線', from: '築地駅', fromZh: '築地站', to: '根津駅', toZh: '根津站',
          picQuery: 'Nezu Station Tokyo Metro', stationLinks: [metro('tsukiji', '築地站'), metro('nezu', '根津站')] }),
        walk('10:20', '10:30', '根津駅', '根津神社', { fromZh: '根津站', toZh: '根津神社', notes: '根津站 1 號出口步行約 10 分鐘。' }),
        I({ type: 'sight', time: '10:30', end: '11:10', title: '根津神社', titleJa: '根津神社', place: '根津神社', address: '東京都文京区根津1-28-9',
          pics: ['File:Nezu Shrine 2010.jpg', 'File:Nezu-jinja Torii 10.jpg', 'File:The gate of Nezu shrine - panoramio.jpg'], picCat: 'Category:Nezu-jinja',
          notes: '千本鳥居（乙女稻荷）及江戶神社建築（主殿係國家重要文化財）。免費。' }),
        walk('11:10', '11:20', '根津神社', 'へび道 谷中', { fromZh: '根津神社', toZh: 'へび道', notes: '步行往千駄木／谷中方向。' }),
        I({ type: 'sight', time: '11:20', end: '11:50', title: 'へび道（蛇道）散步', titleJa: 'へび道', place: 'へび道 谷中',
          picCat: 'Category:Yanesen', picQuery: 'Yanaka Tokyo street',
          notes: '下町住宅街景。沿彎彎曲曲嘅舊河道（藍染川暗渠）步行，兩邊係小店同民居。',
          links: [gmap('https://maps.app.goo.gl/MVfeDKywwRQWXbpL8')] }),
        walk('11:50', '12:00', 'へび道 谷中', '鰻 吉里 谷中総本店', { fromZh: 'へび道', toZh: '吉里' }),
        I({
          type: 'food', time: '12:00', end: '13:10', title: '午餐：鰻魚 吉里 谷中總本店', titleJa: '鰻（うなぎ） 吉里 谷中総本店', place: '鰻 吉里 谷中総本店',
          address: '東京都台東区谷中3-2-6', hours: '11:30–21:30（星期三、日、假期至 21:00）· 不定休',
          url: 'https://gabg600.gorp.jp/', ref: '',
          pics: ['File:Unagi1.jpg'], picQuery: 'unaju eel rice box',
          notes: '日式老宅＋鰻魚料理。千駄木站步行 3 分鐘 · 電話 03-5834-2081\n建議預約（撳「網站／訂位」）；電話預約時可以先點菜，唔使等咁耐。',
          menu: { items: [
            { name: '鰻魚重', ja: 'うな重', price: '午市約 ¥2,500 起', star: true, desc: '先蒸後燒，入口即溶' },
            { name: '鰻魚鍋', ja: 'う鍋', star: true, desc: '店家推介' },
            { name: '白燒鰻魚', ja: '鰻白焼き', desc: '唔落醬汁，食鰻魚原味' },
          ], tips: '人均午市約 ¥2,500，價錢以店內為準。' },
        }),
        I({ type: 'train', time: '13:10', end: '13:50', title: '谷中 → 早稻田', titleJa: '千代田線・東西線 千駄木 → 早稲田', number: '千代田線 → 大手町轉東西線', from: '千駄木駅', fromZh: '千駄木站', to: '早稲田駅', toZh: '早稻田站',
          picQuery: 'Waseda Station Tozai Line', notes: '大手町轉線要行比較長。', stationLinks: [metro('sendagi', '千駄木站'), metro('waseda', '早稻田站')] }),
        walk('13:50', '14:00', '早稲田駅', '早稲田大学国際文学館', { fromZh: '早稻田站', toZh: '村上春樹圖書館', notes: '步行約 7–10 分鐘。' }),
        I({ type: 'sight', time: '14:00', end: '15:30', title: '村上春樹圖書館', titleJa: '早稲田大学国際文学館（村上春樹ライブラリー）', place: '早稲田大学国際文学館', address: '東京都新宿区西早稲田1-6-1 早稲田大学4号館', url: 'https://www.waseda.jp/culture/wihl/', hours: '10:00–17:00 · 逢星期三休',
          picCat: 'Category:Waseda International House of Literature', picQuery: 'Haruki Murakami Library Waseda',
          notes: '隈研吾改建；書籍、唱片及展覽。免費、唔使預約。館內有 café「橙子猫 Orange Cat」。' }),
        I({ type: 'train', time: '15:30', end: '16:00', title: '早稻田 → 新宿', titleJa: '東西線・JR山手線 早稲田 → 新宿', number: '東西線 → 高田馬場轉 JR 山手線', from: '早稲田駅', fromZh: '早稻田站', to: '新宿駅', toZh: '新宿站（南口）', picQuery: 'Shinjuku Station south exit' }),
        I({ type: 'shop', time: '16:00', end: '17:00', title: 'LUMINE 2', titleJa: 'ルミネ新宿 ルミネ2', place: 'ルミネ新宿 ルミネ2', address: '東京都新宿区新宿3-38-2', hours: '11:00–21:00',
          picQuery: 'Lumine Shinjuku',
          notes: '女裝：COCO DEAL、Mila Owen、Arpege story。新宿站南口步行即到。',
          links: [gmap('https://maps.app.goo.gl/eYTRyBynHFw9TkQo9')] }),
        walk('17:00', '17:15', 'ルミネ新宿 ルミネ2', 'ビームス ジャパン 新宿', { fromZh: 'LUMINE 2', toZh: 'BEAMS JAPAN', notes: '步行往新宿三丁目方向。' }),
        I({ type: 'shop', time: '17:15', end: '18:00', title: 'BEAMS JAPAN', titleJa: 'ビームス ジャパン（新宿）', place: 'ビームス ジャパン 新宿', address: '東京都新宿区新宿3-32-6（B1F–5F）', hours: '11:00–20:00 · 不定休',
          picCat: 'Category:Beams (shop)',
          notes: '日本服飾、工藝及選物（日本製手信好多選擇）。1F 有猿田彥咖啡。' }),
        walk('18:00', '18:15', 'ビームス ジャパン 新宿', '歌舞伎町一番街', { fromZh: 'BEAMS JAPAN', toZh: '歌舞伎町一番街', notes: '經靖國通步行。' }),
        I({ type: 'sight', time: '18:15', end: '18:40', title: '歌舞伎町一番街散步', titleJa: '歌舞伎町一番街', place: '歌舞伎町一番街',
          pics: KABUKI_PICS, picCat: 'Category:Shinjuku Toho Building',
          notes: '霓虹街景：一番街牌坊、Godzilla 頭（新宿東寶大廈）。晚上注意拉客，唔好跟人入舖。' }),
        walk('18:40', '18:50', '歌舞伎町一番街', '牛かつもと村 新宿アルタ裏店', { fromZh: '歌舞伎町', toZh: '牛かつもと村', notes: '向新宿東口方向步行。' }),
        I({
          type: 'food', time: '18:50', end: '19:55', title: '晚餐：牛かつもと村 新宿アルタ裏店', titleJa: '牛かつもと村 新宿アルタ裏店', place: '牛かつもと村 新宿アルタ裏店',
          address: '東京都新宿区新宿3-22-7 指田ビル B1F', hours: '11:00–22:00（L.O. 21:30）· 無休', url: 'https://www.gyukatsu-motomura.com/reservation-1?stt_lang=en', ref: '',
          pics: ['File:Beef at Gyukatsu Ichinisan in Akihabara.jpg'], picCat: 'Category:Gyukatsu',
          notes: '牛炸扒＋石爐自行加熱。⚠️ 係「アルタ裏店」（新宿3丁目），唔係歌舞伎町本店。預約撳「網站／訂位」· 電話 050-1722-3625',
          menu: MOTOMURA_MENU,
        }),
        walk('19:55', '20:05', '牛かつもと村 新宿アルタ裏店', '新宿駅', { fromZh: '餐廳', toZh: '新宿站（丸之內線）', notes: '步行往新宿站東口／丸之內線。' }),
        I({ type: 'train', time: '20:05', end: '20:35', title: '新宿 → 東銀座', titleJa: '丸ノ内線・日比谷線 新宿 → 東銀座', number: '丸之內線 → 銀座轉日比谷線', from: '新宿駅', fromZh: '新宿站', to: '東銀座駅', toZh: '東銀座站',
          picCat: 'Category:Higashi-Ginza Station', notes: '東銀座 6 號出口步行 3 分鐘返酒店。', stationLinks: [metro('shinjuku', '新宿站'), metro('ginza', '銀座站'), metro('higashi-ginza', '東銀座站')] }),
        I({ type: 'hotel', time: '20:35', end: '21:00', ...HOTEL, title: '酒店休息' }),
      ]),

      /* ================= Day 3 · 10/31（六） ================= */
      day('2026-10-31', { city: '東京', title: '根津美術館・表參道建築・代官山・中目黑' }, [
        walk('09:00', '09:05', HOTEL.place, '築地場外市場', { ...H, toZh: '築地場外市場' }),
        I({
          type: 'food', time: '09:05', end: '09:50', title: '早餐：まるきた2號＋斉藤水產', titleJa: '海鮮丼まるきた 2号店・斉藤水産', place: '海鮮丼まるきた 2号店',
          address: 'まるきた2號：東京都中央区築地4-13-18', hours: 'まるきた 約 05:00–16:00（週末）；斉藤水產 06:00–17:00，年中無休',
          pics: TSUKIJI_PICS_B,
          notes: '海鮮丼＋即開生蠔。兩間都喺場外市場內，步行即到。\nまるきた 電話 03-3543-5228 · 斉藤水產 電話 03-3541-2314',
          menu: { items: [
            { name: '招牌丼（まるきた）', ja: 'まるきた丼', star: true, desc: '店名丼，最多款海鮮' },
            { name: '本鮪中拖羅丼', ja: '本マグロ中トロ丼' },
            { name: '海膽丼', ja: 'うに丼' },
            { name: '即開生蠔（斉藤水產）', ja: '生牡蠣', price: '約 ¥600–800／隻', star: true, desc: '按大細計價' },
          ], tips: '想平啲：築地魚河岸「キタニ水産」生蠔約 ¥380–480。' },
        }),
        I({ type: 'train', time: '09:50', end: '10:25', title: '築地 → 表參道', titleJa: '日比谷線・銀座線 築地 → 表参道', number: '日比谷線 → 銀座站轉銀座線', from: '築地駅', fromZh: '築地站', to: '表参道駅', toZh: '表參道站',
          picQuery: 'Omote-sando Station', stationLinks: [metro('tsukiji', '築地站'), metro('omote-sando', '表參道站')] }),
        walk('10:25', '10:35', '表参道駅', '根津美術館', { fromZh: '表參道站', toZh: '根津美術館', notes: 'A5 出口 → 步行約 8–10 分鐘。' }),
        I({ type: 'sight', time: '10:35', end: '11:45', title: '根津美術館', titleJa: '根津美術館', place: '根津美術館', address: '東京都港区南青山6-5-1', url: 'https://www.nezu-muse.or.jp/', hours: '10:00–17:00 · 逢星期一休', ref: '',
          pics: ['File:Nezu museum entrance tokyo 2014.jpg'], picCat: 'Category:Nezu Museum',
          notes: '⚠️ 要網上預約時段！約 ¥1,300–1,500。\n隈研吾建築＋日本古美術，竹林入口＋大庭園。' }),
        I({ type: 'sight', time: '11:45', end: '13:20', title: '南青山／表參道建築散步', titleJa: '南青山・表参道 建築散歩', place: '表参道',
          pics: ['File:PRADA BOUTIQUE AOYAMA.jpg', 'File:Christian Dior Omotesando Tokyo.JPG', 'File:PRADA AOYAMA 2.jpg'], picCat: 'Category:Prada Aoyama',
          notes: '全段以建築外觀及拍照為主，全程步行：\n1. PRADA 青山（Herzog & de Meuron）\n2. SunnyHills 南青山（隈研吾）\n3. Tod\'s 表參道（伊東豐雄）\n4. HUGO BOSS\n5. Louis Vuitton 表參道（青木淳）\n6. 表參道 Hills（安藤忠雄）\n7. Dior 表參道（SANAA）\n8. GYRE（MVRDV）',
          links: [gmap('https://maps.app.goo.gl/p86NnKfAEhwoQzWB8'), { label: 'SunnyHills 地圖', url: 'https://www.google.com/maps/search/?api=1&query=SunnyHills+Minami-Aoyama' }, { label: 'GYRE 地圖', url: 'https://www.google.com/maps/search/?api=1&query=GYRE+Omotesando' }] }),
        I({ type: 'train', time: '13:20', end: '13:45', title: 'GYRE → 代官山', titleJa: '副都心線・東急東横線 明治神宮前 → 代官山', number: '副都心線／東橫線', from: '明治神宮前駅', fromZh: '明治神宮前站', to: '代官山駅', toZh: '代官山站',
          picCat: 'Category:Daikan-yama Station', notes: '只有部分班次直通東橫線；唔直通就喺澀谷轉車。' }),
        walk('13:45', '13:50', '代官山駅', '松之助 N.Y. 代官山', { fromZh: '代官山站', toZh: '松之助 N.Y.', notes: '步行約 5 分鐘。' }),
        I({
          type: 'food', time: '13:50', end: '14:40', title: '午餐：松之助 N.Y.', titleJa: '松之助 N.Y. 東京・代官山店', place: '松之助 N.Y. 代官山',
          address: '東京都渋谷区猿楽町29-9 ヒルサイドテラス D-11', hours: '週末約 09:00–19:00 · Pancake 10:00–16:00（數量限定）· 逢星期一休',
          url: 'https://matsunosukepie.com/', picQuery: 'Hillside Terrace Daikanyama',
          notes: 'Apple Pie、蛋糕及 Pancake。店內唔接受預約 · 電話 03-5728-3868',
          menu: { items: [
            { name: '酸忌廉蘋果批', ja: 'サワークリームアップルパイ', star: true, desc: '招牌：成個蘋果包住焗' },
            { name: '大蘋果批', ja: 'ビッグアップルパイ', star: true, desc: '10–3 月限定，10 月尾啱啱開賣' },
            { name: '紐約芝士蛋糕', ja: 'ニューヨーク・チーズケーキ', desc: '濃厚但入口即溶' },
            { name: '班戟', ja: 'パンケーキ', desc: '10:00–16:00，數量限定' },
          ], tips: '網上價錢資料唔一致，以店內為準。' },
        }),
        walk('14:40', '14:45', '松之助 N.Y. 代官山', '代官山 蔦屋書店', { fromZh: '松之助', toZh: '蔦屋書店', notes: '沿舊山手通步行。' }),
        I({ type: 'shop', time: '14:45', end: '15:25', title: '代官山 蔦屋書店／T-SITE', titleJa: '代官山 蔦屋書店（代官山T-SITE）', place: '代官山 蔦屋書店', hours: '09:00–22:00',
          pics: ['File:Daikanyama T-Site Building 3 2018.jpg'], picCat: 'Category:Daikanyama',
          notes: '書店、設計及生活選物。T-SITE 由 Klein Dytham 設計。',
          links: [gmap('https://maps.app.goo.gl/6FBtQqPM4MUm7kAD7')] }),
        walk('15:25', '15:30', '代官山 蔦屋書店', 'B.C STOCK 代官山店', { fromZh: '蔦屋書店', toZh: 'B.C STOCK' }),
        I({ type: 'shop', time: '15:30', end: '15:50', title: 'B.C STOCK 代官山', titleJa: 'B.C STOCK 代官山店', place: 'B.C STOCK 代官山店', hours: '約 11:00–20:00',
          picCat: 'Category:Daikanyama', picQuery: 'Daikanyama street shops',
          notes: 'Outlet／折扣選物（BAYCREW\'S 旗下品牌）。代官山有幾間 B.C STOCK，出發前用地圖確認係邊間。' }),
        walk('15:50', '16:00', 'B.C STOCK 代官山店', 'ZAPADY-DOO 代官山店', { fromZh: 'B.C STOCK', toZh: 'ZAPADY-DOO' }),
        I({ type: 'shop', time: '16:00', end: '16:30', title: 'ZAPADY-DOO', titleJa: 'ザパディドゥ 代官山店', place: 'ZAPADY-DOO 代官山店', address: '東京都渋谷区恵比寿西1-33-15 EN代官山 1F', hours: '11:00–20:00（星期五、六至 21:00）',
          picQuery: 'Daikanyama Ebisu-nishi street',
          notes: '家品及生活雜貨，開咗 25 年以上嘅懷舊雜貨店 · 電話 03-5458-4050' }),
        walk('16:30', '16:45', 'ZAPADY-DOO 代官山店', 'カインドオル 中目黒店', { fromZh: 'ZAPADY-DOO', toZh: 'Kindal 中目黑', notes: '步行往中目黑方向。' }),
        I({ type: 'shop', time: '16:45', end: '17:05', title: 'Kindal 中目黑', titleJa: 'カインドオル 中目黒店', place: 'カインドオル 中目黒店', address: '東京都目黒区青葉台1-16-12 中目黒サクレピエス 1F', hours: '12:00–20:00 · 無休',
          pics: ['File:Meguro river at night in autumn.jpg'], picCat: 'Category:Meguro River',
          notes: '二手設計師品牌，喺目黑川邊。可以碌卡 · 電話 03-6455-0139' }),
        walk('17:05', '17:20', 'カインドオル 中目黒店', 'スターバックス リザーブ ロースタリー 東京', { fromZh: 'Kindal', toZh: 'Starbucks Reserve Roastery', notes: '沿目黑川步行。' }),
        I({ type: 'sight', time: '17:20', end: '17:50', title: 'Starbucks Reserve Roastery Tokyo', titleJa: 'スターバックス リザーブ ロースタリー 東京', place: 'スターバックス リザーブ ロースタリー 東京', address: '東京都目黒区青葉台2-19-23', hours: '約 07:00–22:00',
          pics: ['File:Starbucks-Reserve-Roastery-Tokyo-2019-07-18.jpg'], picCat: 'Category:Starbucks Reserve Roastery Tokyo',
          notes: '隈研吾設計嘅 4 層大型烘焙工坊。週末可能要排隊入場。' }),
        walk('17:50', '18:05', 'スターバックス リザーブ ロースタリー 東京', '中目黒駅', { fromZh: 'Starbucks', toZh: '中目黑一帶', notes: '沿目黑川往餐廳方向步行。' }),
        I({ type: 'other', time: '18:05', end: '18:20', title: '中目黑散步／Buffer', titleJa: '中目黒・目黒川', place: '目黒川 中目黒',
          notes: '預留排隊、洗手間或行程延誤嘅時間。' }),
        walk('18:20', '18:30', '中目黒駅', '和牛すき焼 そしじ 中目黒店', { fromZh: '中目黑', toZh: 'そしじ' }),
        I({
          type: 'food', time: '18:30', end: '19:40', title: '晚餐：和牛壽喜燒 そしじ', titleJa: '和牛すき焼 そしじ 中目黒店', place: '和牛すき焼 そしじ 中目黒店',
          address: '東京都目黒区上目黒3-16-1 コットンビル 2F', hours: '星期六 11:30–23:00', url: 'https://tabelog.com/tw/tokyo/A1317/A131701/13318941/dtlrvwlst/', ref: '',
          pics: ['File:Sukiyaki (7320145438).jpg', 'File:Sukiyaki 01.jpg', 'File:Sukiyaki by moxups.jpg'],
          notes: '和牛壽喜燒。A5 黑毛和牛，南部鐵器鍋 · 電話 03-3791-2514\n預約：Tabelog（撳「網站／訂位」）或 Toreta。',
          links: [{ label: 'Toreta 預約', url: 'https://yoyaku.toreta.in/nakame-b' }],
          menu: { items: [
            { name: '壽喜燒「上」（赤身）', ja: 'すき焼セット 上', price: '¥2,980（未連稅）' },
            { name: '壽喜燒「特」（上赤身）', ja: 'すき焼セット 特', price: '¥3,380（未連稅）' },
            { name: '壽喜燒「天」（霜降）', ja: 'すき焼セット 天', price: '¥3,980（未連稅）', star: true, desc: '包野菜＋そしじ蛋' },
            { name: '燒汁牛柳（Chateaubriand）', ja: '特へれステーキたれ焼き', price: '¥18,700／2人', desc: '中目黑店限定' },
          ] },
        }),
        I({ type: 'train', time: '19:40', end: '20:10', title: '中目黑 → 赤羽橋', titleJa: '日比谷線・大江戸線 中目黒 → 赤羽橋', number: '日比谷線 → 六本木轉大江戶線', from: '中目黒駅', fromZh: '中目黑站', to: '赤羽橋駅', toZh: '赤羽橋站',
          picCat: 'Category:Naka-Meguro Station', stationLinks: [metro('naka-meguro', '中目黑站')] }),
        I({ type: 'sight', time: '20:10', end: '20:30', title: '赤羽橋遠眺東京鐵塔', titleJa: '東京タワー（赤羽橋）', place: '東京タワー',
          pics: ['File:Tokyo Tower seen from Akabanebashi intersection.JPG', 'File:Tokyo Tower Night View.jpg', 'File:Tokyo Tower at night (1).jpg'], picCat: 'Category:Views of Tokyo Tower from Sakurada dori at night',
          notes: '出站睇東京鐵塔夜景，唔上塔。' }),
        I({ type: 'train', time: '20:30', end: '21:00', title: '赤羽橋 → 築地市場 → 酒店', titleJa: '都営大江戸線 赤羽橋 → 築地市場', number: '大江戶線（直達）', from: '赤羽橋駅', fromZh: '赤羽橋站', to: '築地市場駅', toZh: '築地市場站',
          picQuery: 'Tsukijishijo Station Oedo Line', notes: '約 21:00 到酒店。築地市場站步行返酒店。' }),
      ]),

      /* ================= Day 4 · 11/1（日） ================= */
      day('2026-11-01', { city: '東京', title: '築地早餐・銀座・返香港', notes: '朝早 check-out，下晝取行李去機場。' }, [
        I({ type: 'hotel', time: '09:00', end: '09:15', ...HOTEL, title: 'Check-out＋寄存行李', notes: '酒店前台辦理退房及寄存行李。' }),
        walk('09:15', '09:20', HOTEL.place, '北海番屋 築地', { ...H, toZh: '北海番屋' }),
        I({
          type: 'food', time: '09:20', end: '10:00', title: '早餐：北海番屋', titleJa: '北海番屋 築地店', place: '北海番屋 築地',
          address: '東京都中央区築地4-14-16', hours: '星期日 09:00–15:00（L.O. 14:00）', pics: TSUKIJI_PICS_A.slice(0, 2), picQuery: 'kaisendon uni ikura',
          notes: '北海道系海鮮丼 · 電話 03-5148-0788',
          menu: { items: [
            { name: '北海丼', ja: '北海丼', price: '約 ¥3,200（未連稅）', star: true, desc: '海膽、三文魚子、蟹、牡丹蝦，人氣第一' },
            { name: '五色丼', ja: '五色丼', price: '約 ¥3,200（未連稅）' },
            { name: '海膽吞拿魚丼', ja: 'うにマグロ丼', price: '約 ¥3,600（未連稅）' },
            { name: '帆立貝三文魚子丼', ja: '帆立いくら丼', price: '約 ¥2,900（未連稅）' },
            { name: '三文魚三文魚子丼', ja: 'サーモンいくら丼', price: '約 ¥2,200（未連稅）', desc: '預算之選' },
          ], tips: '全部附味噌湯。價錢參考網上資料，可能有調整。' },
        }),
        walk('10:00', '10:20', '北海番屋 築地', '銀座 伊東屋 本店', { fromZh: '北海番屋', toZh: '銀座 伊東屋', notes: '由築地步行經銀座四丁目 → 銀座二丁目。' }),
        I({ type: 'shop', time: '10:20', end: '11:00', title: '銀座 伊東屋（G.Itoya）', titleJa: '銀座 伊東屋 本店', place: '銀座 伊東屋 本店', address: '東京都中央区銀座2-7-15', hours: '星期日 10:00–19:00',
          url: 'https://www.ito-ya.co.jp/ext/store/ginza/ginza/index.html',
          pics: ['File:Ginza Itoya (34207621235).jpg'], picCat: 'Category:Ito-ya',
          notes: '老字號文具專門店（1904 年創立），12 層逐層逛。' }),
        walk('11:00', '11:10', '銀座 伊東屋 本店', '銀座ロフト', { fromZh: '伊東屋', toZh: '銀座 LOFT', notes: '銀座二丁目內步行。' }),
        I({ type: 'shop', time: '11:10', end: '12:00', title: '銀座 LOFT', titleJa: '銀座ロフト', place: '銀座ロフト', hours: '星期日 11:00 開', picQuery: 'Ginza Loft Tokyo', picCat: 'Category:Ginza', notes: '文具、美妝及生活雜貨。' }),
        walk('12:00', '12:10', '銀座ロフト', '銀座三越', { fromZh: '銀座 LOFT', toZh: '銀座三越', notes: '沿中央通步行往銀座四丁目。' }),
        I({ type: 'food', time: '12:10', end: '12:50', title: '銀座三越 B2／B3', titleJa: '銀座三越 デパ地下', place: '銀座三越', address: '東京都中央区銀座4-6-16',
          pics: ['File:2019 Ginza Mitsukoshi.jpg', 'File:Ginza Mitsukoshi at night.jpg', 'File:Mitsukoshi Ginza new-building.JPG'],
          notes: '食品、甜點及手信。',
          menu: { items: [{ name: '和菓子／洋菓子禮盒', ja: '和菓子・洋菓子', star: true, desc: '手信首選' }, { name: '熟食、便當', ja: '惣菜・弁当' }], tips: '退稅記得帶護照。' } }),
        walk('12:50', '13:00', '銀座三越', HOTEL.place, { fromZh: '銀座三越', toZh: '酒店', notes: '步行經東銀座返回酒店。' }),
        I({ type: 'hotel', time: '13:00', end: '13:20', ...HOTEL, title: '酒店取行李＋整理', notes: '前台領取寄存行李。' }),
        walk('13:20', '13:30', HOTEL.place, '築地駅', { fromZh: '酒店', toZh: '築地站', notes: '步行至築地站 2 號出口一帶（約 4 分鐘）。' }),
        I({ type: 'train', time: '13:30', end: '13:50', title: '日比谷線：築地 → 上野', titleJa: '東京メトロ日比谷線 築地 → 上野', number: '日比谷線（直達）', from: '築地駅', fromZh: '築地站', to: '上野駅', toZh: '上野站',
          picCat: 'Category:Ueno Station (Tokyo Metro)', stationLinks: [metro('tsukiji', '築地站'), metro('ueno', '上野站')] }),
        walk('13:50', '14:00', '上野駅', '京成上野駅', { fromZh: '上野站', toZh: '京成上野站', notes: '有行李，預留 10 分鐘。' }),
        I({ type: 'other', time: '14:00', end: '14:20', title: '買 Skyliner 票＋候車', titleJa: 'スカイライナー 乗車券（京成上野駅）', place: '京成上野駅', picCat: 'Category:Keisei Ueno Station',
          url: 'https://www.keisei.co.jp/keisei/tetudou/skyliner/e-ticket/zht/', notes: '京成上野站 Skyliner 售票處／月台。全車指定席，建議預先網上買。' }),
        I({
          type: 'train', time: '14:20', end: '15:01', title: 'Skyliner：京成上野 → 成田機場 T2', titleJa: 'スカイライナー 京成上野 → 空港第2ビル',
          number: 'Skyliner 53號', from: '京成上野駅', fromZh: '京成上野站', to: '空港第2ビル駅', toZh: '成田機場 T2 站',
          pics: ['File:Keisei-Type-AE.jpg'], picCat: 'Category:Skyliner',
          notes: '14:20 開出（53號），15:01 到 T2。',
          timetable: [
            { dep: '14:00', arr: '14:41', name: '51號', note: '早一班' },
            { dep: '14:20', arr: '15:01', name: '53號', note: '行程班次' },
            { dep: '14:35', arr: '15:21', name: '155號', note: '停站較多' },
          ],
          timetableNote: '土休日時刻（11/1 星期日），以京成官網為準。',
          timetableUrl: SKYLINER_OFFICIAL,
        }),
        walk('15:01', '15:15', '空港第2ビル駅', '成田国際空港 第2ターミナル', { fromZh: 'T2 站', toZh: 'T2 出發層', notes: '空港第2ビル站 → 國際線出發層。' }),
        I({ type: 'other', time: '15:15', end: '16:00', title: 'Check-in＋寄艙', titleJa: '成田空港 第2ターミナル 出発ロビー', place: '成田国際空港 第2ターミナル', pics: NRT_PICS, notes: '19:00 航班，航空公司櫃位。' }),
        I({ type: 'other', time: '16:00', end: '16:30', title: '保安檢查＋出境', titleJa: '保安検査・出国審査', notes: 'International Departures → Security → Immigration' }),
        I({ type: 'shop', time: '16:30', end: '17:10', title: '免稅店', titleJa: '免税店', notes: '先買必買品（Fa-So-La 手信）＋去鰻魚店攞飛。' }),
        I({
          type: 'food', time: '17:10', end: '18:00', title: '晚餐：鰻魚 四代目菊川', titleJa: 'うなぎ四代目菊川 成田空港店', place: 'うなぎ四代目菊川 成田空港店',
          address: '成田空港 第2ターミナル 本館（出境禁區內）', hours: '約 07:30–22:00',
          picCat: 'Category:Hitsumabushi', pics: ['File:Unagi1.jpg'],
          links: [{ label: 'Tabelog', url: 'https://tabelog.com/en/chiba/A1204/A120401/12058270/' }],
          menu: { url: 'https://tabelog.com/en/chiba/A1204/A120401/12058270/dtlmenu/', items: [
            { name: '鰻魚飯三食', ja: 'ひつまぶし', price: '約 ¥4,800–6,000', star: true, desc: '原味 → 加藥味 → 茶泡飯' },
            { name: '燒鰻魚套餐', ja: '焼きうなぎセット', price: '約 ¥5,880' },
          ] },
        }),
        I({ type: 'shop', time: '18:00', end: '18:25', title: '最後免稅購物', titleJa: '免税店', notes: '沿登機閘口方向購物。' }),
        I({ type: 'other', time: '18:25', end: '19:00', title: '到達登機閘口', titleJa: '搭乗ゲート', notes: '建議起飛前最少 35 分鐘已經喺閘口附近。' }),
        I({ type: 'flight', time: '19:00', end: '22:50', title: '東京成田 → 香港', titleJa: '成田空港 → 香港', number: '（待填）', from: '成田国際空港 第2ターミナル', fromZh: '成田機場 T2', to: 'Hong Kong International Airport', toZh: '香港機場', pics: NRT_PICS.slice(0, 1),
          notes: '22:50 係估計抵港時間（香港時間）。' }),
      ]),
    ],
  };

  /* ---------- Excel 原文（1007_Tokyo_Itinerary.xlsx）：活動、備註、交通、預約/地圖 URL ---------- */
  const XL = {"2026-10-29": [["15:55","17:10","抵達成田機場 T2＋入境＋取行李","預留入境及行李時間","落機 → 入境審查 → 行李提取 → 海關 → B1 京成電鐵站","https://keisei.ekitan.com/naritaacs-i-tc/timetable/station/682-6/d1?dw=3&date=20261029"],["17:10","17:30","買／領 Skyliner 車票＋候車","Skyliner 全車指定席，或需預訂","成田空港第2・第3航廈站 → Skyliner 月台","Skyliner 購票：https://www.keisei.co.jp/keisei/tetudou/skyliner/e-ticket/zht/"],["17:30","18:15","成田機場 → 京成上野","","Skyliner：空港第2ビル → 京成上野",""],["18:15","18:25","京成上野 → 上野站","","京成上野站出站 → 步行至東京Metro上野站",""],["18:25","18:45","上野 → 築地","","東京Metro日比谷線：上野 → 築地直達",""],["18:45","19:00","築地站 → 酒店","Mitsui Garden Hotel Ginza Tsukiji","築地站2號出口 → 步行約4分鐘",""],["19:00","19:20","酒店 Check-in＋放行李","","",""],["19:20","19:30","酒店 → 晚餐","","步行往築地3丁目",""],["19:30","20:20","晚餐：Ramen Oyster And Shell らぁ麺 牡蠣と貝","牡蠣及貝類湯底拉麵","",""],["20:20","20:30","返回酒店","","步行約10分鐘",""],["20:30","21:00","酒店休息","","",""]],"2026-10-30": [["09:00","09:05","酒店 → 築地早餐","","步行往築地場外市場",""],["09:05","09:45","早餐：まぐろのみやこ","熟海鮮及鮪魚料理","",""],["09:45","10:20","築地 → 根津站","","築地站 → 日比谷線至日比谷 → 轉千代田線至根津",""],["10:20","10:30","根津站 → 根津神社","","根津站 → 步行約10分鐘",""],["10:30","11:10","根津神社","千本鳥居及江戶神社建築","",""],["11:10","11:20","根津神社 → へび道","","步行往千駄木／谷中方向","https://maps.app.goo.gl/MVfeDKywwRQWXbpL8"],["11:20","11:50","へび道散步","下町住宅街景","沿彎曲舊河道路線步行",""],["11:50","12:00","へび道 → 吉里 谷中総本店","","步行往谷中餐廳",""],["12:00","13:10","午餐：吉里 谷中総本店","日式老宅＋鰻魚料理","","預約：https://gabg600.gorp.jp/"],["13:10","13:50","谷中 → 早稻田","大手町轉線步行較長","千駄木站 → 千代田線至大手町 → 轉東西線至早稻田",""],["13:50","14:00","早稻田站 → 村上春樹圖書館","","早稻田站 → 步行約7–10分鐘",""],["14:00","15:30","村上春樹圖書館","隈研吾改建；書籍、唱片及展覽","",""],["15:30","16:00","早稻田 → 新宿","","早稻田站 → 東西線至高田馬場 → 轉JR山手線至新宿",""],["16:00","17:00","LUMINE 2","女裝（COCO DEAL、Mila Owen、Arpege story）","新宿站南口步行前往","https://maps.app.goo.gl/eYTRyBynHFw9TkQo9"],["17:00","17:15","LUMINE 2 → BEAMS JAPAN","","步行往新宿三丁目方向",""],["17:15","18:00","BEAMS JAPAN","日本服飾、工藝及選物","",""],["18:00","18:15","BEAMS JAPAN → 歌舞伎町一番街","","步行經靖國通往歌舞伎町",""],["18:15","18:40","歌舞伎町一番街散步","霓虹街景","一番街牌坊及附近街道",""],["18:40","18:50","歌舞伎町 → 牛かつもと村 新宿アルタ裏店","","向新宿東口方向步行",""],["18:50","19:55","晚餐：牛かつもと村 新宿アルタ裏店","牛炸扒＋石爐自行加熱","","預約：https://www.gyukatsu-motomura.com/reservation-1?stt_lang=en"],["19:55","20:05","餐廳 → 新宿站","","步行往新宿站東口／丸之內線",""],["20:05","20:35","新宿 → 東銀座","","丸之內線：新宿 → 銀座 → 轉日比谷線至東銀座",""],["20:35","21:00","酒店休息","","",""]],"2026-10-31": [["09:00","09:05","酒店 → 築地場外市場","","步行約5分鐘",""],["09:05","09:50","早餐：まるきた2號＋齋藤水產","海鮮丼＋即開生蠔","築地場外市場內步行",""],["09:50","10:25","築地 → 表參道","","築地站 → 日比谷線至銀座 → 轉銀座線至表參道",""],["10:25","10:35","表參道站 → 根津美術館","","A5出口 → 步行約8–10分鐘",""],["10:35","11:45","根津美術館","隈研吾建築＋日本古美術","",""],["11:45","13:20","南青山／表參道建築散步","全段以建築外觀及拍照為主","PRADA → SunnyHills → Tod's → HUGO BOSS → Louis Vuitton → 表參道 Hills → Dior → GYRE，全程步行","https://maps.app.goo.gl/p86NnKfAEhwoQzWB8"],["13:20","13:45","GYRE → 代官山","只有部分班次可直通","明治神宮前站 → 副都心線／東橫線 → 代官山",""],["13:45","13:50","代官山站 → Matsunosuke","","代官山站 → 步行約5分鐘",""],["13:50","14:40","午餐：Matsunosuke N.Y.","Apple Pie、蛋糕及 Pancake","",""],["14:40","14:45","Matsunosuke → 代官山蔦屋書店","","沿舊山手通步行","https://maps.app.goo.gl/6FBtQqPM4MUm7kAD7"],["14:45","15:25","代官山蔦屋書店／T-SITE","書店、設計及生活選物","",""],["15:25","15:30","蔦屋書店 → B.C STOCK","","步行約5分鐘",""],["15:30","15:50","B.C STOCK","Outlet／折扣選物","",""],["15:50","16:00","B.C STOCK → ZAPADY-DOO","","步行",""],["16:00","16:30","ZAPADY-DOO","家品及生活雜貨","",""],["16:30","16:45","ZAPADY-DOO → Kindal 中目黑","","步行往中目黑方向",""],["16:45","17:05","Kindal 中目黑","二手設計師品牌","",""],["17:05","17:20","Kindal → Starbucks Reserve Roastery Tokyo","","沿目黑川步行",""],["17:20","17:50","Starbucks Reserve Roastery Tokyo","隈研吾設計大型烘焙工坊","",""],["17:50","18:05","Starbucks → 中目黑一帶","","沿目黑川往餐廳方向步行",""],["18:05","18:20","中目黑散步／Buffer","預留排隊、洗手間或行程延誤","餐廳附近自由散步",""],["18:20","18:30","前往餐廳和牛すき焼 そしじ 中目黒店","","步行往和牛すき焼 そしじ",""],["18:30","19:40","晚餐：和牛すき焼 そしじ 中目黒店","和牛壽喜燒","","預約：https://tabelog.com/tw/tokyo/A1317/A131701/13318941/dtlrvwlst/"],["19:40","20:10","中目黑 → 赤羽橋","","日比谷線：中目黑 → 六本木 → 轉大江戶線至赤羽橋",""],["20:10","20:30","赤羽橋遠眺東京鐵塔","出一出站看東京鐵塔夜景","赤羽橋站附近步行",""],["20:30","21:00","赤羽橋 → 酒店","約21:00到酒店","大江戶線：赤羽橋 → 築地市場 → 步行回酒店",""]],"2026-11-01": [["09:00","09:15","酒店 Check-out＋寄存行李","","酒店前台辦理退房及寄存行李",""],["09:15","09:20","酒店 → 北海番屋","","步行往築地場外市場",""],["09:20","10:00","早餐：北海番屋","北海道系海鮮丼","",""],["10:00","10:20","北海番屋 → Ginza Itoya","","由築地步行經銀座四丁目 → 銀座二丁目",""],["10:20","11:00","Ginza Itoya","老字號文具專門店","",""],["11:00","11:10","Itoya → Ginza Loft","","銀座二丁目內步行",""],["11:10","12:00","Ginza Loft","文具、美妝及生活雜貨","",""],["12:00","12:10","Ginza Loft → 銀座三越","","沿中央通步行往銀座四丁目",""],["12:10","12:50","銀座三越 B2／B3","食品、甜點及手信","",""],["12:50","13:00","銀座三越 → 酒店","","步行經東銀座返回酒店",""],["13:00","13:20","酒店取行李＋整理","","前台領取寄存行李",""],["13:20","13:30","酒店 → 築地站","酒店距築地站約4分鐘","步行至築地站2號出口一帶",""],["13:30","13:50","築地 → 上野","","東京Metro日比谷線：築地 → 上野",""],["13:50","14:00","上野站 → 京成上野站","有行李預留10分鐘","由東京Metro上野站步行往京成上野站",""],["14:00","14:20","買票＋候車","Skyliner 全車指定席，或需預訂","京成上野站 Skyliner 售票處／月台",""],["14:20","15:01","京成上野 → 成田機場 T2","","Skyliner：京成上野 → 空港第2ビル",""],["15:01","15:15","車站 → T2 出發層","","空港第2ビル站 → 國際線出發層",""],["15:15","16:00","Check-in＋寄艙","19:00航班","航空公司櫃位",""],["16:00","16:30","保安檢查＋出境","","International Departures → Security → Immigration",""],["16:30","17:10","免稅店","先買必買品(Fa-So-La Souvenir) & 攞飛","出境後購物區",""],["17:10","18:00","晚餐：うなぎ四代目菊川","鰻魚料理","Terminal 2 出境後區域",""],["18:00","18:25","最後免稅購物","","沿登機閘口方向購物",""],["18:25","","到達登機Gate","","建議至少起飛前35分鐘已在Gate附近",""],["19:00","","航班起飛","","",""]]};


  /* ---------- Tabelog 摘要（2026/10 整理，評分會變） ---------- */
  const TABELOG = {
    'らぁ麺 牡蠣と貝 築地本店': { url: 'https://tabelog.com/tw/tokyo/A1313/A131301/13292429/', rating: '3.68', reviews: '約 2,000', budget: '¥1,000–1,999',
      summary: ['「鴨to葱」姊妹店，用廣島蠔煮成忌廉般濃湯，加貝油提香', '食評最多讚湯底夠濃；可以加枱面檸檬汁轉味', '午市同週末多遊客，要預排隊時間'] },
    'まぐろのみやこ 築地': { url: 'https://tabelog.com/tw/tokyo/A1313/A131301/13145358/', rating: '3.29', reviews: '約 80', budget: '¥1,000–1,999',
      summary: ['店頭用火槍即場燒海鮮（浜焼き），好有睇頭', '名物「みやこにぎり」：三文魚包住拖羅', '戶外座位有時坐滿'] },
    '鰻 吉里 谷中総本店': { url: 'https://tabelog.com/tw/tokyo/A1311/A131106/13117215/', rating: '3.45', reviews: '—', budget: '午市約 ¥2,500；晚市 ¥6,000–7,999',
      summary: ['古民家改裝，環境舒服', '收尾可以揀鰻重或者鰻魚飯三食', '千駄木站步行約 1–3 分鐘'] },
    '海鮮丼まるきた 2号店': { url: 'https://tabelog.com/tw/tokyo/A1313/A131301/13164063/', rating: '3.41', reviews: '200+', budget: '¥2,000–2,999',
      summary: ['款式好多，CP 值高', '有限定「カマトロ丼」（吞拿魚鮫位拖羅）', '唔收信用卡／電子支付，帶現金'] },
    '斉藤水産 築地': { url: 'https://tabelog.com/tw/tokyo/A1313/A131301/13147413/', rating: '3.18', reviews: '約 186', budget: '生蠔 ¥500–800／隻',
      summary: ['店頭揀殻付生蠔，即開加柚子醋', '食評：蠔肉濃、夠厚，但有「觀光區價錢」', '平啲可以去築地魚河岸 キタニ水産'] },
    '牛かつもと村 新宿アルタ裏店': { url: 'https://tabelog.com/tw/tokyo/A1304/A130401/13195827/', rating: '3.07', reviews: '約 105', budget: '¥1,000–1,999',
      summary: ['自己用石板燒到想要嘅熟度', '食評評價分歧；新宿南口店 3.14 分'] },
    '松之助 N.Y. 代官山': { url: 'https://tabelog.com/tw/tokyo/A1303/A130303/13005179/', rating: '3.7+', reviews: '百名店', budget: '¥1,000–1,999',
      summary: ['招牌蘋果批，秋冬有 Big Apple Pie', '芝士蛋糕焗得好軟滑', '週末下晝約等 15 分鐘；有食評話逗留上限 40 分鐘'] },
    '和牛すき焼 そしじ 中目黒店': { url: 'https://tabelog.com/tw/tokyo/A1317/A131701/13318941/', rating: '3.20', reviews: '約 58', budget: '晚市 ¥6,000–7,999',
      summary: ['嚴選和牛＋專用米＋雞蛋＋特製鍋', '有座敷（榻榻米）位', '評價分歧：有人讚牛柳，有人覺得貴'] },
    '北海番屋 築地': { url: 'https://tabelog.com/tw/tokyo/A1313/A131301/13108642/', rating: '3.39', reviews: '約 140', budget: '午市 ¥3,000–3,999',
      summary: ['北海道系海鮮丼，招牌北海丼（海膽、三文魚子、蟹、牡丹蝦）', '有焼き台枱可以燒浜焼き', 'Tabelog 寫星期一、三休息（星期日有開）'] },
    'うなぎ四代目菊川 成田空港店': { url: 'https://tabelog.com/tw/chiba/A1204/A120401/12058270/', rating: '3.03', reviews: '約 16', budget: '¥3,000–3,999',
      summary: ['T2 本館 2 樓，07:30–22:00，唔接受預約', '鰻魚飯三食約 ¥3,900 起', '食評：味道好，以專門店嚟講價錢合理'] },
  };
  /* ---------- 地圖搜尋（Google Maps 用嘅準確名稱／地址） ---------- */
  const MAPQ = {
    'ビームス ジャパン 新宿': 'Beams Japan, B1F 5F 3 Chome-32-6 Shinjuku, Shinjuku City, Tokyo 160-0022, Japan',
    'ルミネ新宿 ルミネ2': 'LUMINE 2, 3 Chome-38-2 Shinjuku, Shinjuku City, Tokyo 160-0022, Japan',
    'らぁ麺 牡蠣と貝 築地本店': 'らぁ麺 牡蠣と貝 築地本店, 3 Chome-16-9 Tsukiji, Chuo City, Tokyo',
    'まぐろのみやこ 築地': 'まぐろのみやこ, 4 Chome-13-13 Tsukiji, Chuo City, Tokyo',
    '鰻 吉里 谷中総本店': '鰻 吉里 谷中総本店, 3 Chome-2-6 Yanaka, Taito City, Tokyo',
    '海鮮丼まるきた 2号店': '海鮮丼まるきた 2号店, 4 Chome-13-18 Tsukiji, Chuo City, Tokyo',
    '牛かつもと村 新宿アルタ裏店': '牛かつもと村 新宿アルタ裏店, 3 Chome-22-7 Shinjuku, Shinjuku City, Tokyo',
    '松之助 N.Y. 代官山': 'Matsunosuke N.Y., 29-9 Sarugakucho, Shibuya City, Tokyo',
    'ZAPADY-DOO 代官山店': 'ZAPADY-DOO, 1 Chome-33-15 Ebisunishi, Shibuya City, Tokyo',
    'カインドオル 中目黒店': 'Kindal Nakameguro, 1 Chome-16-12 Aobadai, Meguro City, Tokyo',
    'スターバックス リザーブ ロースタリー 東京': 'Starbucks Reserve Roastery Tokyo, 2 Chome-19-23 Aobadai, Meguro City, Tokyo',
    '和牛すき焼 そしじ 中目黒店': '和牛すき焼 そしじ 中目黒店, 3 Chome-16-1 Kamimeguro, Meguro City, Tokyo',
    '北海番屋 築地': '北海番屋, 4 Chome-14-16 Tsukiji, Chuo City, Tokyo',
    '銀座 伊東屋 本店': 'Ginza Itoya, 2 Chome-7-15 Ginza, Chuo City, Tokyo',
    '三井ガーデンホテル銀座築地': 'Mitsui Garden Hotel Ginza Tsukiji, 4 Chome-7-1 Tsukiji, Chuo City, Tokyo',
    '根津神社': '根津神社, 1 Chome-28-9 Nezu, Bunkyo City, Tokyo',
    '根津美術館': 'Nezu Museum, 6 Chome-5-1 Minamiaoyama, Minato City, Tokyo',
  };

  // 將 Excel 原文併入每一項（同 Excel 行一一對應；extra 係 Excel 冇嘅項目）
  trip.days.forEach(d => {
    const rows = XL[d.date] || [];
    d.items.filter(i => !i.extra).forEach((it, k) => {
      const r = rows[k];
      if (!r) return;
      const [st, en, act, note, tr, url] = r;
      if (st) it.time = st;
      if (en) it.end = en;
      it.title = act;
      it.xNote = note;
      it.xTransport = tr;
      it.xUrl = url;
    });
    d.items.forEach(it => {
      if (it.place && TABELOG[it.place]) it.tabelog = [{ name: it.place.replace(/ (築地|代官山)$/, ''), ...TABELOG[it.place] }];
      if (it.place === '海鮮丼まるきた 2号店') it.tabelog.push({ name: '築地 斉藤水産', ...TABELOG['斉藤水産 築地'] });
      if (it.place && MAPQ[it.place]) it.mapQuery = MAPQ[it.place];
    });
  });
  trip.mapq = MAPQ;
  return trip;
})();
