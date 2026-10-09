/* =========================================================
   河童仔：撳按鈕會走出嚟郁下；讀日文時佢會跟住讀音開合個嘴
   全部用 SVG 畫（冇外部圖片），離線都得。
   ========================================================= */
(() => {
  const OL = '#3B1E0E';
  const SVG = `<svg class="kp-svg" viewBox="0 0 200 230" aria-hidden="true">
    <g class="kp-water"><ellipse cx="100" cy="212" rx="96" ry="16" fill="#3FB6F5"/>
      <path d="M40 212 q12 6 26 0 M120 214 q14 6 30 0 M80 220 q12 4 26 0" stroke="#0A84D6" stroke-width="3" fill="none" stroke-linecap="round"/>
      <g class="kp-drops" fill="#3FB6F5" stroke="none"><path d="M18 170 q-8 14 2 18 q10 -2 -2 -18z"/><path d="M182 168 q8 14 -2 18 q-10 -2 2 -18z"/><path d="M34 150 q-6 10 1 13 q8 -2 -1 -13z"/><path d="M166 150 q6 10 -1 13 q-8 -2 1 -13z"/></g></g>
    <g class="kp-all" stroke="${OL}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
      <!-- 手：喺身體後面伸出嚟，膊頭位藏喺身體入面，轉動時好自然 -->
      <g class="kp-arm kp-armL"><path d="M74 146 Q52 158 32 178" fill="none" stroke-width="23"/><path d="M74 146 Q52 158 32 178" fill="none" stroke="#6DB84B" stroke-width="15"/>
        <path d="M26 176 l-3 5 M31 182 l-2 6" stroke-width="3"/></g>
      <g class="kp-arm kp-armR"><path d="M126 146 Q148 158 168 178" fill="none" stroke-width="23"/><path d="M126 146 Q148 158 168 178" fill="none" stroke="#6DB84B" stroke-width="15"/>
        <path d="M174 176 l3 5 M169 182 l2 6" stroke-width="3"/></g>
      <g class="kp-feet" fill="#6DB84B"><path d="M70 196 q-4 12 6 14 l14 0 q4 -8 -2 -14z"/><path d="M130 196 q4 12 -6 14 l-14 0 q-4 -8 2 -14z"/></g>
      <path class="kp-bodyshape" d="M60 126 C50 160 54 202 100 204 C146 202 150 160 140 126 Z" fill="#6DB84B"/>
      <circle class="kp-belly" cx="100" cy="170" r="24" fill="#FFF4A6" stroke="none"/>
      <g class="kp-head">
        <path d="M28 98 C28 54 60 36 100 36 C140 36 172 54 172 98 C172 130 142 144 100 144 C58 144 28 130 28 98 Z" fill="#6DB84B"/>
        <g fill="#2E7D32"><path d="M66 44 L42 16 L80 38 Z"/><path d="M134 44 L158 16 L120 38 Z"/><path d="M66 42 L16 50 L66 60 Z"/><path d="M134 42 L184 50 L134 60 Z"/><path d="M68 48 L76 72 L92 50 Z"/><path d="M90 50 L100 74 L110 50 Z"/><path d="M108 50 L124 72 L132 48 Z"/></g>
        <g class="kp-plate"><ellipse cx="100" cy="40" rx="40" ry="14" fill="#FFF4A6"/><ellipse cx="86" cy="35" rx="7" ry="3.5" fill="#fff" stroke="none"/></g>
        <g class="kp-cheeks" fill="#FF9AA2" stroke="none"><ellipse cx="54" cy="108" rx="10" ry="7"/><ellipse cx="146" cy="108" rx="10" ry="7"/></g>
        <g class="kp-eyes kp-eyes-dot" fill="${OL}" stroke="none"><circle cx="70" cy="90" r="6.5"/><circle cx="130" cy="90" r="6.5"/></g>
        <g class="kp-eyes kp-eyes-happy" fill="none"><path d="M60 92 q10 -12 20 0"/><path d="M120 92 q10 -12 20 0"/></g>
        <g class="kp-eyes kp-eyes-squint" fill="none"><path d="M62 82 l14 8 l-14 8"/><path d="M138 82 l-14 8 l14 8"/></g>
        <g class="kp-beak">
          <ellipse class="kp-mouth" cx="100" cy="112" rx="22" ry="13" fill="#FF7F86"/>
          <path class="kp-lower" d="M68 112 L100 112 L132 112 L100 127 Z" fill="#FFF4A6"/>
          <path class="kp-upper" d="M68 112 L100 97 L132 112 Z" fill="#FFF4A6"/>
        </g>
      </g>
    </g>
  </svg>`;

  // 假名 → 母音（決定個嘴嘅形狀）
  const V = {};
  [['a', 'あかさたなはまやらわがざだばぱゃぁゎ'], ['i', 'いきしちにひみりぎじぢびぴぃ'], ['u', 'うくすつぬふむゆるぐずづぶぷゔゅぅ'],
    ['e', 'えけせてねへめれげぜでべぺぇ'], ['o', 'おこそとのほもよろをごぞどぼぽょぉ']].forEach(([v, s]) => [...s].forEach(c => { V[c] = v; }));
  const SHAPE = { a: [1, 1], i: [0.32, 1.15], u: [0.38, 0.62], e: [0.62, 1.1], o: [0.78, 0.72], n: [0.06, 0.9], _: [0, 1] };
  const kata2hira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

  /** 讀音 → 每個音節（拗音、促音、長音、撥音都計） */
  function morae(kana) {
    const out = [];
    for (const ch of kata2hira(kana)) {
      if ('ゃゅょぁぃぅぇぉゎ'.includes(ch) && out.length) { out[out.length - 1].k += ch; out[out.length - 1].v = V[ch]; continue; }
      if (ch === 'ー' && out.length) { out.push({ k: ch, v: out[out.length - 1].v }); continue; }
      if (ch === 'っ') { out.push({ k: ch, v: '_' }); continue; }
      if (ch === 'ん') { out.push({ k: ch, v: 'n' }); continue; }
      if (V[ch]) { out.push({ k: ch, v: V[ch] }); continue; }
      if (/[㐀-鿿々]/.test(ch)) { out.push({ k: ch, v: 'a' }, { k: '', v: 'i' }); continue; } // 未知讀音嘅漢字：大約兩拍
      if (/[A-Za-z0-9]/.test(ch)) { out.push({ k: ch, v: 'aeiou'.includes(ch.toLowerCase()) ? ch.toLowerCase() : 'e' }); continue; }
      if (/[、。！？!?,.\s／]/.test(ch) && out.length && out[out.length - 1].v !== '_') out.push({ k: ' ', v: '_', pause: true });
    }
    return out;
  }

  const LINES = ['こんにちは！一緒に東京を楽しもう！|你好！一齊玩轉東京！', 'きゅうりが大好き！|我最鍾意青瓜！', '水分補給を忘れずに！|記得飲水呀！', 'さあ、出発！|出發喇！',
    '迷ったら僕に聞いてね！|蕩失路就問我啦！', '雨でも大丈夫！|落雨都唔怕！', 'いただきます！|開動喇！'];
  const MOVES = ['dance', 'wave', 'splash', 'cheer', 'hop'];

  let el, stage, bubble, timer = null, hideTimer = null, seqTimer = null, lastMove = '';
  function build() {
    if (el) return;
    stage = document.createElement('div');
    stage.className = 'kp-stage';
    stage.innerHTML = `<div class="kp-bubble" hidden></div><button type="button" class="kp" aria-label="河童仔">${SVG}</button>`;
    document.body.appendChild(stage);
    el = stage.querySelector('.kp');
    bubble = stage.querySelector('.kp-bubble');
    el.addEventListener('click', e => { e.stopPropagation(); if (!stage.classList.contains('talking')) play(); });
    stage.addEventListener('click', e => { if (e.target === stage) hide(); });
    // 眨眼
    setInterval(() => { if (!stage.classList.contains('on')) return; el.classList.add('blink'); setTimeout(() => el.classList.remove('blink'), 160); }, 3200);
  }
  function setMouth(v) {
    const [open, w] = SHAPE[v] || SHAPE._;
    el.style.setProperty('--open', open);
    el.style.setProperty('--w', w);
  }
  function face(f) { el.dataset.face = f; }
  function show() {
    build();
    // 詳情視窗開咗嘅話，要放入視窗入面先會喺最上面
    const host = document.querySelector('dialog[open]') || document.body;
    if (stage.parentNode !== host) host.appendChild(stage);
    clearTimeout(hideTimer);
    stage.classList.add('on');
  }
  function hide(delay = 0) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!stage) return; stage.classList.remove('on', 'talking'); bubble.hidden = true; el.dataset.move = ''; }, delay);
  }
  /** 撳按鈕：走出嚟做隨機動作同講句嘢 */
  function play(move) {
    show();
    stopTalk();
    const pool = MOVES.filter(m => m !== lastMove);
    move = move || pool[Math.floor(Math.random() * pool.length)];
    lastMove = move;
    el.dataset.move = '';
    void el.offsetWidth; // 重新開始動畫
    el.dataset.move = move;
    face(move === 'wave' ? 'dot' : move === 'dance' || move === 'splash' ? 'squint' : 'happy');
    const [ja, zh] = LINES[Math.floor(Math.random() * LINES.length)].split('|');
    talkAnim(ja, null, 2600);
    bubble.innerHTML = `<b lang="ja">${ja}</b><span>${zh}</span>`;
    bubble.hidden = false;
    hide(5200);
  }
  function stopTalk() { clearTimeout(seqTimer); setMouth('_'); stage?.classList.remove('talking'); }
  /** 跟住音節開合個嘴；ms＝預計總長度 */
  function talkAnim(kana, highlight, ms) {
    const ms_ = morae(kana);
    if (!ms_.length) return;
    const step = Math.max(90, Math.min(220, ms / ms_.length));
    let i = 0;
    const tick = () => {
      if (i >= ms_.length) { setMouth('_'); return; }
      const m = ms_[i];
      setMouth(m.v);
      if (highlight) highlight(i);
      i++;
      // 開口之後一半時間稍為合返少少，睇落更似講嘢
      seqTimer = setTimeout(() => { if (m.v !== '_' && m.v !== 'n') el.style.setProperty('--open', (SHAPE[m.v][0] * 0.45).toFixed(2)); seqTimer = setTimeout(tick, step * 0.4); }, step * 0.6);
    };
    tick();
    return { morae: ms_, jump: n => { i = Math.max(i, Math.min(n, ms_.length - 1)); } };
  }
  /** 讀日文：顯示句子、平假名逐個音節亮起，嘴跟住郁 */
  function say(text, kana, rubyHtml, romaji) {
    show();
    clearTimeout(hideTimer);
    stopTalk();
    stage.classList.add('talking');
    el.dataset.move = 'talk';
    face('dot');
    const list = morae(kana || text);
    bubble.innerHTML = `<b lang="ja">${rubyHtml || text}</b>
      <span class="kp-kana" lang="ja">${list.map((m, i) => `<i data-i="${i}">${m.k}</i>`).join('')}</span>${romaji ? `<span>${romaji}</span>` : ''}`;
    bubble.hidden = false;
    const hl = i => { bubble.querySelectorAll('.kp-kana i').forEach((x, j) => x.classList.toggle('on', j === i)); };
    let anim = null;
    const startAnim = () => { if (!anim) anim = talkAnim(kana || text, hl, list.length * 150); };
    const fallback = setTimeout(startAnim, 700); // 冇聲／未開始讀都照郁
    return {
      start: () => { clearTimeout(fallback); startAnim(); },
      boundary: frac => { if (anim) anim.jump(Math.floor(frac * anim.morae.length)); },
      end: () => { clearTimeout(fallback); stopTalk(); hl(-1); face('happy'); el.dataset.move = 'wave'; hide(2600); },
      // 冇日文聲：照樣用預計時間郁個嘴
      fail() { clearTimeout(fallback); startAnim(); clearTimeout(this._t); this._t = setTimeout(this.end, list.length * 150 + 400); },
    };
  }
  /* ---------- 行程表上面嘅小河童：捲到邊個項目，就跳去嗰個項目嘅時間下面 ---------- */
  let buddy = null, buddyId = null, buddyRaf = 0;
  function attachBuddy(list) {
    if (!list) return;
    buddy = document.createElement('div');
    buddy.className = 'kp-buddy';
    buddy.innerHTML = `<div class="kp kp-mini" data-face="dot">${SVG}</div>`;
    buddy.title = '撳我';
    buddy.addEventListener('click', () => { const k = buddy.firstElementChild; k.dataset.move = ''; void k.offsetWidth; k.dataset.move = 'hop'; k.dataset.face = 'squint'; setTimeout(() => { k.dataset.move = ''; k.dataset.face = 'dot'; }, 1600); });
    list.appendChild(buddy);
    placeBuddy(true);
  }
  function placeBuddy(instant) {
    if (!buddy?.isConnected) return;
    const items = [...buddy.parentElement.querySelectorAll(':scope > .item')];
    if (!items.length) return;
    const line = innerHeight * 0.42;
    let target = items[0];
    for (const it of items) { if (it.getBoundingClientRect().top <= line) target = it; else break; }
    const when = target.querySelector('.when');
    const lr = buddy.parentElement.getBoundingClientRect(), wr = (when || target).getBoundingClientRect(), tr = target.getBoundingClientRect();
    // 時間已經捲咗上去：河童仔留喺畫面頂（頂欄下面），但唔會走出呢個項目
    const minY = Math.max(0, ...[...document.querySelectorAll('.topbar, .daytabs')].map(e => e.getBoundingClientRect().bottom)) + 8;
    const yVp = Math.min(Math.max((when ? wr.bottom : wr.top + 60) + 6, minY), tr.bottom - 58);
    const top = yVp - lr.top, left = wr.left - lr.left + (when ? (wr.width - 46) / 2 : 0);
    const k = buddy.firstElementChild;
    k.dataset.face = target.classList.contains('done') ? 'happy' : 'dot';
    const same = target.id === buddyId && !instant;
    const first = buddyId == null || instant;
    buddyId = target.id;
    buddy.style.transition = first ? 'none' : same ? 'transform .12s linear' : '';
    buddy.style.transform = `translate(${left}px, ${top}px)`;
    if (same) return;
    if (!first) { k.classList.remove('jumping'); void k.offsetWidth; k.classList.add('jumping'); }
  }
  addEventListener('scroll', () => { cancelAnimationFrame(buddyRaf); buddyRaf = requestAnimationFrame(() => placeBuddy(false)); }, { passive: true });
  addEventListener('resize', () => placeBuddy(true));

  /* ---------- 完成項目：大河童頭＋抽獎中獎效果 ---------- */
  function chime() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      [523, 659, 784, 1047, 1319].forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        const t = ac.currentTime + i * 0.09;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.65);
      });
      setTimeout(() => ac.close(), 1500);
    } catch { /* 冇聲都冇所謂 */ }
  }
  function celebrate(title) {
    document.querySelector('.kp-party')?.remove();
    const host = document.querySelector('dialog[open]') || document.body;
    const o = document.createElement('div');
    o.className = 'kp-party';
    const colors = ['#FFD84D', '#FF7F86', '#6DB84B', '#3FB6F5', '#FFF4A6', '#FF9F3D'];
    const bits = Array.from({ length: 70 }, (_, i) => {
      const c = colors[i % colors.length], l = Math.random() * 100, d = (Math.random() * 0.8).toFixed(2), dur = (1.6 + Math.random() * 1.4).toFixed(2), r = Math.round(Math.random() * 360);
      const shape = i % 5 === 0 ? 'coin' : i % 3 === 0 ? 'star' : 'paper';
      return `<i class="${shape}" style="left:${l}%;--c:${c};--r:${r}deg;animation-delay:${d}s;animation-duration:${dur}s"></i>`;
    }).join('');
    const head = SVG.replace('viewBox="0 0 200 230"', 'viewBox="14 8 172 138"');
    o.innerHTML = `<div class="kp-rays"></div><div class="kp-glow"></div><div class="kp-confetti">${bits}</div>
      <div class="kp-win"><div class="kp kp-bighead" data-face="squint" style="--open:.55;--w:1.05">${head}</div>
        <p class="kp-win-t">🎉 完成！🎉</p>${title ? `<p class="kp-win-s">${title}</p>` : ''}<p class="kp-win-j" lang="ja">やったね！よくできました！</p></div>`;
    o.addEventListener('click', () => o.remove());
    host.appendChild(o);
    chime();
    setTimeout(() => o.classList.add('bye'), 2900);
    setTimeout(() => o.remove(), 3400);
  }

  window.Kappa = { play, say, hide, morae, attachBuddy, placeBuddy, celebrate };
})();
