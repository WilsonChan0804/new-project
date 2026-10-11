/* =========================================================
   河童仔場景：每個場景有自己嘅動作、道具、表情同對白（對白同動作配合）
   道具全部係 SVG（冇外部圖片）。座標同 kappa.js 個河童一樣（0–200 × 0–230）。
   slots：back（身後）、front（最前）、head（跟個頭）、hL／hR（拎喺手）
   ========================================================= */
(() => {
  const OL = '#3B1E0E';
  const g = (x, y, s, inner, cls = '', delay = 0) => `<g transform="translate(${x} ${y}) scale(${s})"><g class="fx ${cls}" style="animation-delay:${delay}s">${inner}</g></g>`;
  const HEART = (c = '#FF6B8A') => `<path d="M0 4 C0 -2 -9 -3 -9 4 C-9 10 0 14 0 17 C0 14 9 10 9 4 C9 -3 0 -2 0 4Z" fill="${c}" stroke="${OL}" stroke-width="2"/>`;
  const STAR = (c = '#FFD84D') => `<path d="M0 -10 Q2 -2 10 0 Q2 2 0 10 Q-2 2 -10 0 Q-2 -2 0 -10Z" fill="${c}" stroke="none"/>`;
  const NOTE = (c = '#F2A900') => `<ellipse cx="0" cy="10" rx="6" ry="4.5" fill="${c}"/><path d="M5 10 V-8 q7 2 9 9" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
  const DROP = (c = '#5BC0F8') => `<path d="M0 -8 Q7 2 0 8 Q-7 2 0 -8Z" fill="${c}" stroke="none"/>`;
  const hearts = (n = 3) => [[30, 40, 1.1], [168, 60, .9], [178, 120, .7], [22, 110, .8]].slice(0, n).map(([x, y, s], i) => g(x, y, s, HEART(), 'fx-float', i * .5)).join('');
  const stars = (pts) => pts.map(([x, y, s], i) => g(x, y, s, STAR(), 'fx-twinkle', i * .35)).join('');

  const P = {
    cucumberMouth: g(100, 118, 1, `<g transform="rotate(-18)"><rect x="-34" y="-8" width="58" height="16" rx="8" fill="#3E8E2E" stroke="${OL}" stroke-width="3"/><rect x="22" y="-4" width="8" height="8" rx="2" fill="#2E6B2A" stroke="${OL}" stroke-width="2"/><g fill="#1F5A18"><circle cx="-22" cy="-2" r="1.6"/><circle cx="-10" cy="3" r="1.6"/><circle cx="2" cy="-3" r="1.6"/><circle cx="12" cy="2" r="1.6"/></g></g>`, 'fx-munch'),
    watermelonMouth: g(100, 124, 1, `<path d="M-28 -6 A28 28 0 0 0 28 -6 Z" fill="#FF5A5F" stroke="${OL}" stroke-width="3"/><path d="M-28 -6 A28 28 0 0 0 28 -6" fill="none" stroke="#3E8E2E" stroke-width="6"/><g fill="${OL}"><ellipse cx="-10" cy="2" rx="1.6" ry="2.6"/><ellipse cx="4" cy="6" rx="1.6" ry="2.6"/><ellipse cx="14" cy="0" rx="1.6" ry="2.6"/></g>`, 'fx-munch'),
    bulb: g(36, 8, 1, `<g class="fx fx-pulse"><circle cx="0" cy="0" r="14" fill="#FFE36E" stroke="${OL}" stroke-width="3"/><rect x="-7" y="12" width="14" height="10" rx="3" fill="#BDBDBD" stroke="${OL}" stroke-width="3"/><path d="M-4 -2 q4 -6 8 0" fill="none" stroke="#F2A900" stroke-width="2.5"/></g><path d="M-26 -2 h-8 M26 -2 h8 M-18 -20 l-6 -6 M18 -20 l6 -6 M0 -26 v-9" stroke="#F2A900" stroke-width="3.5" stroke-linecap="round"/>`),
    question: g(170, 14, 1, `<text x="0" y="0" font-size="46" font-weight="900" fill="#3FB6F5" stroke="${OL}" stroke-width="2" text-anchor="middle" font-family="system-ui, sans-serif">?</text>`, 'fx-bob'),
    tears: `<g class="fx fx-tears"><path d="M60 98 q-10 18 -18 46 q14 4 22 -2 q-2 -24 4 -44z" fill="#8FD8FF" stroke="${OL}" stroke-width="2.5"/><path d="M140 98 q10 18 18 46 q-14 4 -22 -2 q2 -24 -4 -44z" fill="#8FD8FF" stroke="${OL}" stroke-width="2.5"/></g>${g(30, 70, 1, DROP(), 'fx-fly', 0)}${g(172, 74, 1, DROP(), 'fx-fly', .3)}`,
    anger: [[34, 56], [168, 60]].map(([x, y], i) => g(x, y, 1, `<path d="M-9 -3 q4 -6 9 -1 M9 -3 q-4 -6 -9 -1 M-9 3 q4 6 9 1 M9 3 q-4 6 -9 1" stroke="#E53935" stroke-width="3.5" fill="none" stroke-linecap="round"/>`, 'fx-pulse', i * .2)).join('')
      + g(150, 196, 1, `<text font-size="18" font-weight="900" fill="#E53935" font-family="system-ui, sans-serif">ぐぅ〜</text>`, 'fx-bob'),
    zzz: g(150, 20, 1, `<text font-size="22" font-weight="900" fill="#3F8FE5" font-family="system-ui, sans-serif">Z</text>`, 'fx-zzz', 0) + g(168, 0, .8, `<text font-size="22" font-weight="900" fill="#3F8FE5" font-family="system-ui, sans-serif">z</text>`, 'fx-zzz', .6) + g(182, -14, .6, `<text font-size="22" font-weight="900" fill="#3F8FE5" font-family="system-ui, sans-serif">z</text>`, 'fx-zzz', 1.2),
    nightcap: `<path d="M64 38 Q100 -6 150 16 Q160 30 136 34 Q100 26 64 38Z" fill="#3F6FD8" stroke="${OL}" stroke-width="3.5"/><circle cx="156" cy="20" r="8" fill="#FFF" stroke="${OL}" stroke-width="3"/>`,
    onsenFront: `<g stroke="${OL}" stroke-width="3"><ellipse cx="100" cy="196" rx="96" ry="26" fill="#8ED8F8"/><path d="M30 196 q14 6 30 0 M120 200 q16 6 34 0" stroke="#3AA3DC" fill="none" stroke-linecap="round"/>
      ${[[8, 196], [30, 214], [60, 222], [100, 224], [140, 222], [170, 214], [192, 196]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="15" ry="10" fill="#9E9E9E"/>`).join('')}</g>`
      + [[46, 120], [154, 116], [100, 4]].map(([x, y], i) => g(x, y, 1, `<path d="M0 0 q-8 -8 0 -16 q8 -8 0 -16" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" opacity=".9"/>`, 'fx-steam', i * .5)).join(''),
    wall: `<g stroke="${OL}" stroke-width="3.5"><rect x="-30" y="0" width="98" height="232" rx="4" fill="#C8A272"/><path d="M60 0 V232" stroke="#8D6E4A"/><circle cx="48" cy="120" r="4" fill="#8D6E4A"/></g>`,
    umbrella: `<g stroke="${OL}" stroke-width="3.5" stroke-linecap="round"><path d="M178 134 L118 -6" fill="none" stroke-width="5"/><path d="M178 134 q2 10 -8 10" fill="none" stroke-width="5"/>
      <path d="M10 26 Q30 -60 118 -6 Q200 -40 214 40 Q188 22 166 40 Q140 18 116 34 Q88 16 64 34 Q40 16 10 26Z" fill="#3F8FE5"/><path d="M118 -6 Q90 6 64 34 M118 -6 Q140 6 166 40" fill="none" stroke-width="2.5"/></g>`,
    rain: Array.from({ length: 12 }, (_, i) => g(-10 + i * 19, -40 + (i % 3) * 14, 1, `<path d="M0 0 l-3 12" stroke="#3F8FE5" stroke-width="3" stroke-linecap="round"/>`, 'fx-rain', (i % 5) * .22)).join(''),
    puddle: `<ellipse cx="100" cy="214" rx="78" ry="10" fill="#8ED8F8" stroke="${OL}" stroke-width="3"/>`,
    notes: [[28, 60, '#F2A900'], [172, 40, '#FF6B8A'], [186, 110, '#3FB6F5'], [16, 120, '#6DB84B']].map(([x, y, c], i) => g(x, y, 1, NOTE(c), 'fx-float', i * .4)).join(''),
    bagL: `<g transform="translate(-4 4)"><path d="M-10 0 q10 -14 20 0" fill="none" stroke="${OL}" stroke-width="3"/><rect x="-20" y="0" width="40" height="40" rx="5" fill="#FF8FA3" stroke="${OL}" stroke-width="3"/></g>`,
    bagR: `<g transform="translate(4 4)"><path d="M-10 0 q10 -14 20 0" fill="none" stroke="${OL}" stroke-width="3"/><rect x="-20" y="0" width="40" height="44" rx="5" fill="#5BC0F8" stroke="${OL}" stroke-width="3"/><text x="0" y="28" font-size="14" font-weight="900" text-anchor="middle" fill="#fff" font-family="system-ui">♡</text></g>`,
    sunglasses: `<g stroke="${OL}" stroke-width="3"><rect x="52" y="80" width="38" height="22" rx="9" fill="#1E1E1E"/><rect x="110" y="80" width="38" height="22" rx="9" fill="#1E1E1E"/><path d="M90 88 h20 M52 86 l-14 -4 M148 86 l14 -4" fill="none"/><path d="M60 86 l10 0" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M118 86 l10 0" stroke="#fff" stroke-width="3" stroke-linecap="round"/></g>`,
    speed: [[0, 120], [-6, 150], [4, 180]].map(([x, y], i) => g(x, y, 1, `<path d="M0 0 h-34" stroke="#7A8CA0" stroke-width="4" stroke-linecap="round"/>`, 'fx-speed', i * .15)).join('') + g(160, 50, 1, DROP(), 'fx-fly', .2),
    pompom: c => `<g>${Array.from({ length: 10 }, (_, i) => { const a = i * 36 * Math.PI / 180; return `<circle cx="${(Math.cos(a) * 11).toFixed(1)}" cy="${(Math.sin(a) * 11).toFixed(1)}" r="9" fill="${c}" stroke="${OL}" stroke-width="2"/>`; }).join('')}<circle r="10" fill="${c}"/></g>`,
    bouquet: `<g transform="rotate(10)"><path d="M-8 6 L0 40 L8 6Z" fill="#FFFFFF" stroke="${OL}" stroke-width="3"/>${[[-10, -4, '#FF6B8A'], [8, -6, '#FFD84D'], [0, -16, '#FF8FA3'], [-14, -18, '#FFB74D'], [14, -18, '#E57373']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="8" fill="${c}" stroke="${OL}" stroke-width="2.5"/>`).join('')}</g>`,
    popper: `<g transform="rotate(-30)"><path d="M-8 30 L0 -6 L8 30Z" fill="#FFD84D" stroke="${OL}" stroke-width="3"/><path d="M-6 18 l12 -4 M-4 8 l9 -3" stroke="#E53935" stroke-width="3"/></g>`,
    confetti: Array.from({ length: 14 }, (_, i) => g(150 + Math.cos(i) * 10, 40 + Math.sin(i * 2) * 10, 1, `<rect x="-3" y="-5" width="6" height="10" rx="1.5" fill="${['#FF6B8A', '#FFD84D', '#3FB6F5', '#6DB84B', '#FF9F3D'][i % 5]}" transform="rotate(${i * 37})"/>`, `fx-burst fx-b${i % 7}`, 0)).join(''),
    chefHat: `<g stroke="${OL}" stroke-width="3.5" fill="#FFFFFF"><path d="M64 36 h72 v-14 h-72z"/><path d="M64 24 q-18 -20 4 -30 q8 -18 30 -10 q20 -14 34 4 q22 2 4 36z"/></g>`,
    pan: `<g transform="rotate(25)"><rect x="-4" y="0" width="8" height="34" rx="3" fill="#5D4037" stroke="${OL}" stroke-width="3"/><ellipse cx="0" cy="-16" rx="30" ry="12" fill="#424242" stroke="${OL}" stroke-width="3"/><g class="fx fx-flip"><ellipse cx="0" cy="-24" rx="12" ry="6" fill="#FFFFFF" stroke="${OL}" stroke-width="2"/><circle cx="0" cy="-25" r="4.5" fill="#FFC107"/></g></g>`,
    beer: `<g><rect x="-14" y="-30" width="28" height="36" rx="4" fill="#FFC93C" stroke="${OL}" stroke-width="3"/><path d="M14 -22 q12 0 12 10 q0 10 -12 10" fill="none" stroke="${OL}" stroke-width="4"/><path d="M-16 -30 q4 -10 12 -6 q6 -8 14 -2 q8 -4 8 8z" fill="#FFFFFF" stroke="${OL}" stroke-width="3"/><path d="M-6 -18 v18 M4 -18 v18" stroke="#F2A900" stroke-width="2"/></g>`,
    gift: `<g stroke="${OL}" stroke-width="3.5"><rect x="22" y="150" width="156" height="78" rx="6" fill="#FFE36E"/><rect x="14" y="132" width="172" height="26" rx="6" fill="#FFF09A"/><rect x="88" y="132" width="24" height="96" fill="#E53935"/><path d="M100 132 q-36 -26 -40 -6 q8 12 40 6 q32 6 40 -6 q-4 -20 -40 6z" fill="#E53935"/></g>`,
    camera: `<g stroke="${OL}" stroke-width="3"><rect x="-26" y="-18" width="52" height="34" rx="7" fill="#546E7A"/><rect x="-10" y="-25" width="18" height="9" rx="3" fill="#546E7A"/><circle cx="0" cy="-1" r="11" fill="#263238"/><circle cx="-3" cy="-4" r="3.5" fill="#B0BEC5" stroke="none"/></g>`,
    flash: g(150, 70, 1, `<path d="M0 -26 L7 -7 L26 0 L7 7 L0 26 L-7 7 L-26 0 L-7 -7Z" fill="#FFFDE7" stroke="#FFD84D" stroke-width="3"/>`, 'fx-flash'),
    dumbbell: `<g><rect x="-22" y="-3" width="44" height="6" rx="3" fill="#757575" stroke="${OL}" stroke-width="2.5"/><rect x="-30" y="-12" width="10" height="24" rx="3" fill="#424242" stroke="${OL}" stroke-width="2.5"/><rect x="20" y="-12" width="10" height="24" rx="3" fill="#424242" stroke="${OL}" stroke-width="2.5"/></g>`,
    headband: `<path d="M34 72 Q100 52 166 72 L166 82 Q100 62 34 82Z" fill="#3F8FE5" stroke="${OL}" stroke-width="3"/>`,
    map: `<g stroke="${OL}" stroke-width="3"><path d="M50 150 L80 140 L120 150 L150 140 L150 196 L120 206 L80 196 L50 206Z" fill="#FFFDF0"/><path d="M80 140 V196 M120 150 V206" fill="none"/><path d="M58 186 q20 -24 40 -10 q14 10 44 -22" fill="none" stroke="#E53935" stroke-width="3" stroke-dasharray="5 5"/><circle cx="140" cy="156" r="5" fill="#E53935"/></g>`,
    bottle: `<g><rect x="-10" y="-34" width="20" height="40" rx="6" fill="#B3E5FC" stroke="${OL}" stroke-width="3"/><rect x="-6" y="-42" width="12" height="9" rx="2" fill="#3F8FE5" stroke="${OL}" stroke-width="3"/><path d="M-6 -16 h12" stroke="#fff" stroke-width="3"/></g>`,
    sun: g(30, 14, 1, `<circle r="13" fill="#FFD84D" stroke="${OL}" stroke-width="3"/>${Array.from({ length: 8 }, (_, i) => `<path d="M0 -19 v-7" transform="rotate(${i * 45})" stroke="#F2A900" stroke-width="3.5" stroke-linecap="round"/>`).join('')}`, 'fx-spin'),
    bigHeart: g(100, 160, 1.9, HEART('#FF5A7A'), 'fx-pulse'),
  };

  /** 每個場景：move＝基本動作、anim＝額外動畫、aL／aR＝手嘅角度、slots、face、lines［日文, 假名, 中文］、w＝出現機會 */
  const SCENES = [
    { id: 'wave', move: 'wave', face: 'dot', lines: [['こんにちは！', 'こんにちは', '你好呀！'], ['今日もよろしくね！', 'きょうもよろしくね', '今日都多多指教！']] },
    { id: 'morning', tall: true, move: 'wave', face: 'happy', front: P.sun, when: h => h >= 5 && h < 11 ? 4 : 0, lines: [['おはよう！今日も楽しもう！', 'おはよう！きょうもたのしもう', '早晨！今日都玩得開心啲！']] },
    { id: 'love', face: 'happy', aL: -20, aR: 20, anim: 'sway', front: P.bigHeart + hearts(3), lines: [['旅行、大好き！', 'りょこう、だいすき', '我好鍾意去旅行！'], ['一緒に来てくれてありがとう！', 'いっしょにきてくれてありがとう', '多謝你陪我嚟！']] },
    { id: 'cucumber', face: 'happy', aL: 40, aR: -40, anim: 'munch', front: P.cucumberMouth + stars([[30, 60, 1], [172, 52, .8]]), meal: true, lines: [['きゅうり、うまい！', 'きゅうり、うまい', '青瓜好好食！'], ['ポリポリ…', 'ぽりぽり', '咔嚓咔嚓…']] },
    { id: 'idea', tall: true, face: 'squint', aL: 62, front: P.bulb, lines: [['いいこと思いついた！', 'いいことおもいついた', '諗到個好主意！'], ['写真を撮るなら今だ！', 'しゃしんをとるならいまだ', '而家影相最靚！']] },
    { id: 'question', tall: true, face: 'dot', aR: -25, anim: 'tilt', front: P.question, lines: [['次はどこへ行く？', 'つぎはどこへいく', '下一站去邊？'], ['どっちの道かな？', 'どっちのみちかな', '行邊條路好呢？']] },
    { id: 'cry', face: 'squint', aL: 50, aR: -50, anim: 'shake', front: P.tears, w: .7, lines: [['迷子になっちゃった〜', 'まいごになっちゃった', '蕩失路喇～'], ['もう帰る日なの？', 'もうかえるひなの', '咁快就要返屋企？']] },
    { id: 'hungry', face: 'angry', aL: -15, aR: 15, anim: 'shake', front: P.anger, meal: true, lines: [['お腹すいた！', 'おなかすいた', '肚餓喇！'], ['早くごはん！', 'はやくごはん', '快啲開餐！']] },
    { id: 'sleep', tall: true, face: 'sleep', aL: -10, aR: 10, anim: 'breathe', head: P.nightcap, front: P.zzz, night: true, lines: [['おやすみなさい…', 'おやすみなさい', '早唞…'], ['明日も早いよ〜', 'あしたもはやいよ', '聽日都要早起～']] },
    { id: 'onsen', face: 'happy', aL: 70, aR: -70, anim: 'sink', hideFeet: true, front: P.onsenFront, night: true, lines: [['温泉、最高〜', 'おんせん、さいこう', '浸溫泉，正！'], ['あ〜、極楽極楽', 'あ〜、ごくらくごくらく', '好舒服呀～']] },
    { id: 'peek', face: 'dot', anim: 'peek', front: P.wall, lines: [['じーっ…', 'じーっ', '偷偷望住你…'], ['何見てるの？', 'なにみてるの', '睇緊乜呀？']] },
    { id: 'umbrella', tall: true, face: 'happy', aR: -50, back: P.puddle, front: P.umbrella + P.rain, rain: true, lines: [['雨でも大丈夫！', 'あめでもだいじょうぶ', '落雨都唔怕！'], ['傘を忘れないでね', 'かさをわすれないでね', '記得帶遮呀！']] },
    { id: 'music', move: 'dance', face: 'squint', front: P.notes, lines: [['ルンルン♪', 'るんるん', '心情好好♪'], ['踊ろう！', 'おどろう', '一齊跳舞！']] },
    { id: 'shopping', face: 'happy', aL: -8, aR: 8, anim: 'sway', hL: P.bagL, hR: P.bagR, front: stars([[24, 70, .9], [176, 64, .8]]), lines: [['お買い物、楽しい！', 'おかいもの、たのしい', '行街買嘢好開心！'], ['免税できますか？', 'めんぜいできますか', '可唔可以退稅？']] },
    { id: 'cool', face: 'dot', aR: -30, head: P.sunglasses, front: stars([[176, 40, 1.1], [24, 50, .8]]), lines: [['かっこいいでしょ？', 'かっこいいでしょ', '型唔型？'], ['東京ボーイ参上！', 'とうきょうぼーいさんじょう', '東京型仔登場！']] },
    { id: 'run', face: 'squint', anim: 'run', front: P.speed, lines: [['急げ！電車が来る！', 'いそげ！でんしゃがくる', '快啲！班車嚟喇！'], ['乗り遅れちゃう〜', 'のりおくれちゃう', '就嚟趕唔切喇～']] },
    { id: 'cheer', face: 'happy', aL: 60, aR: -60, anim: 'jump', hL: P.pompom('#FFD84D'), hR: P.pompom('#FF8FA3'), lines: [['がんばれ！', 'がんばれ', '加油！'], ['あと少し！', 'あとすこし', '就快到喇！']] },
    { id: 'flowers', face: 'happy', aR: -45, hR: P.bouquet, front: hearts(2), lines: [['ありがとう！', 'ありがとう', '多謝你！'], ['素敵な一日を！', 'すてきないちにちを', '祝你有美好嘅一日！']] },
    { id: 'party', tall: true, face: 'squint', aR: -50, anim: 'jump', hR: P.popper, front: P.confetti, lines: [['おめでとう！', 'おめでとう', '恭喜晒！'], ['やったー！', 'やったー', '好嘢！']] },
    { id: 'chef', tall: true, face: 'squint', aL: 35, anim: 'sway', head: P.chefHat, hL: P.pan, meal: true, lines: [['いただきます！', 'いただきます', '開餐喇！'], ['今日は何を食べよう？', 'きょうはなにをたべよう', '今日食乜好？']] },
    { id: 'watermelon', face: 'happy', aL: 40, aR: -40, anim: 'munch', front: P.watermelonMouth, meal: true, lines: [['すいか、甘い！', 'すいか、あまい', '西瓜好甜！']] },
    { id: 'beer', tall: true, face: 'happy', aR: -58, hR: P.beer, front: stars([[176, 20, 1], [150, 4, .7]]), evening: true, lines: [['かんぱい！', 'かんぱい', '乾杯！'], ['今日もお疲れさま！', 'きょうもおつかれさま', '今日辛苦晒！']] },
    { id: 'gift', face: 'squint', aL: 62, aR: -62, anim: 'popup', front: P.gift, lines: [['おみやげ買った？', 'おみやげかった', '買咗手信未？'], ['サプライズ！', 'さぷらいず', '驚喜！']] },
    { id: 'camera', face: 'squint', aR: -35, hR: P.camera, front: P.flash, lines: [['はい、チーズ！', 'はい、ちーず', '影相喇，笑！'], ['いい写真が撮れた！', 'いいしゃしんがとれた', '影到張靚相！']] },
    { id: 'workout', face: 'squint', anim: 'pump', head: P.headband, hL: P.dumbbell, hR: P.dumbbell, front: g(160, 54, 1, DROP(), 'fx-fly'), lines: [['もう一駅歩こう！', 'もういちえきあるこう', '行多個站當運動！'], ['いっぱい歩いたね！', 'いっぱいあるいたね', '今日行咗好多路！']] },
    { id: 'map', face: 'dot', aL: -18, aR: 18, anim: 'nod', front: P.map, lines: [['地図を確認中…', 'ちずをかくにんちゅう', '睇緊地圖…'], ['駅はあっちだ！', 'えきはあっちだ', '車站喺嗰邊！']] },
    { id: 'water', face: 'happy', aR: -48, hR: P.bottle, lines: [['水分補給を忘れずに！', 'すいぶんほきゅうをわすれずに', '記得飲水呀！']] },
    { id: 'splash', move: 'splash', face: 'squint', lines: [['水遊び、気持ちいい！', 'みずあそび、きもちいい', '玩水好爽！']] },
    { id: 'hop', move: 'hop', face: 'happy', lines: [['ぴょんぴょん！', 'ぴょんぴょん', '跳跳紮！'], ['さあ、出発！', 'さあ、しゅっぱつ', '出發喇！']] },
  ];

  /** 按時間、天氣、下一站揀場景 */
  function pickScene(ctx = {}, avoid = '') {
    const h = new Date().getHours();
    const mealTime = (h >= 11 && h < 14) || (h >= 17 && h < 21);
    const night = h >= 21 || h < 5;
    const pool = SCENES.filter(s => s.id !== avoid).map(s => {
      let w = s.w ?? 1;
      if (s.when) w = s.when(h);
      if (s.meal && mealTime) w *= 3;
      if (s.night) w *= night ? 4 : .4;
      if (s.evening) w *= h >= 17 ? 3 : .3;
      if (s.rain) w *= ctx.rain ? 5 : .6;
      if (s.id === 'question' && ctx.next) w *= 2;
      return [s, w];
    }).filter(([, w]) => w > 0);
    let r = Math.random() * pool.reduce((a, [, w]) => a + w, 0);
    for (const [s, w] of pool) { if ((r -= w) <= 0) return s; }
    return pool[0][0];
  }
  function pickLine(s, ctx = {}) {
    if (s.id === 'question' && ctx.next && Math.random() < .6) return ['次はここだよ！', 'つぎはここだよ', `下一站：${ctx.next}`];
    return s.lines[Math.floor(Math.random() * s.lines.length)];
  }
  window.KAPPA_SCENES = { SCENES, pickScene, pickLine };
})();
