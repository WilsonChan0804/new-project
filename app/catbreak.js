'use strict';
// Cat break: your own cat clips take over the screen for a short break.
// Triggers: on demand, every N minutes while the app is open, or after the computer has been idle (screensaver).
// A web app can only cover its own window; "Pop out" floats the cat above other apps where the browser allows it.

const CB_DEFAULT = { media: [], length: 5, every: 0, idle: 0 };
const cbSettings = () => ({ ...CB_DEFAULT, ...settings.catBreak });
let cbEndAt = 0, cbTimer = null, cbMode = null, cbLastBreak = Date.now(), cbIdle = null, cbClip = 0;

async function saveCb(patch) {
  settings.catBreak = { ...cbSettings(), ...patch };
  await db.put('settings', settings);
  renderCatBreakCard();
  scheduleIdle();
}

// ---------- Settings card (Us → Cat) ----------
async function renderCatBreakCard() {
  const c = cbSettings();
  const clips = (await Promise.all(c.media.map(id => db.get('media', id)))).filter(Boolean);
  const pick = h('input', { type: 'file', accept: 'video/*,image/*', multiple: true, hidden: true, onchange: async e => {
    const ids = [...c.media];
    for (const f of e.target.files) {
      if (f.size > 200 * 1048576) { toast(`${f.name} is over 200 MB`); continue; }
      ids.push(await putMedia(f, { kind: 'break', poster: isVideoFile(f) ? await videoPoster(f) : await readImage(f, 600) }));
    }
    e.target.value = '';
    saveCb({ media: ids });
  } });
  const sel = (label, key, options) => h('label', { className: 'field' }, h('span', { textContent: label }),
    h('select', { onchange: e => saveCb({ [key]: +e.target.value }) }, options.map(([v, t]) => h('option', { value: v, textContent: t, selected: c[key] === v }))));
  fill($('#catbreak-card'),
    h('div', { className: 'sec-head' }, h('h2', { textContent: '🐱 Cat break' }),
      h('button', { className: 'inv-btn', textContent: 'Call the cat', onclick: () => startBreak('manual') })),
    h('p', { className: 'sm muted', textContent: 'Your cat takes over the screen so you rest your eyes. Use your own videos or photos.' }),
    h('div', { className: 'cb-clips' },
      clips.map(m => h('figure', {},
        h('img', { src: m.poster || '', alt: '' }),
        m.type.startsWith('video') ? h('span', { className: 'play-badge' }, icon('play')) : null,
        h('button', { type: 'button', ariaLabel: 'Remove clip', onclick: async () => { await db.del('media', m.id); saveCb({ media: c.media.filter(id => id !== m.id) }); } }, icon('x')))),
      h('label', { className: 'cb-add' }, pick, icon('plus'), h('span', { textContent: 'Add clip' }))),
    h('div', { className: 'cb-grid' },
      sel('Break length', 'length', [[1, '1 min'], [2, '2 min'], [5, '5 min'], [10, '10 min'], [15, '15 min']]),
      sel('Remind me every', 'every', [[0, 'Off'], [20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1½ hours']]),
      sel('When idle for (screensaver)', 'idle', [[0, 'Off'], [1, '1 min'], [3, '3 min'], [5, '5 min'], [10, '10 min'], [15, '15 min']])),
    h('p', { className: 'sm muted', textContent: 'Works while Twofold is open. Shortcut: Alt + C. On a computer, allow notifications so the cat can call you from another window.' }),
  );
}

// ---------- The break screen ----------
async function startBreak(mode) {
  const c = cbSettings();
  cbMode = mode;
  cbEndAt = Date.now() + c.length * 60000;
  const clips = (await Promise.all(c.media.map(id => db.get('media', id)))).filter(Boolean);
  const box = $('#cb-media');
  if (clips.length) {
    const m = clips[cbClip++ % clips.length];
    const url = await mediaURL(m.id);
    fill(box, m.type.startsWith('video') ? h('video', { src: url, autoplay: true, loop: true, muted: true, playsInline: true }) : h('img', { src: url, alt: '' }));
    box.querySelector('video')?.play().catch(() => {});
  } else {
    // No clips yet: the cat's picture (or a big cat) gently bobbing.
    const pet = (await db.all('pets'))[0];
    fill(box, h('div', { className: 'cb-fallback' }, pet?.avatar?.photo ? h('img', { src: pet.avatar.photo, alt: '' }) : h('span', { textContent: pet?.avatar?.emoji || '🐈' })));
  }
  const pet = (await db.all('pets'))[0];
  $('#cb-msg').textContent = mode === 'idle' ? `${pet?.name || 'The cat'} is keeping your seat warm` : `${pet?.name || 'The cat'} says: time for a break. Stretch, blink, drink some water.`;
  $('#cb-more').hidden = $('#cb-end').hidden = mode === 'idle';
  $('#cb-time').hidden = mode === 'idle';
  $('#catbreak').hidden = false;
  $('#catbreak').classList.toggle('screensaver', mode === 'idle');
  if (mode === 'manual') $('#catbreak').requestFullscreen?.().catch(() => {});
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(T(mode === 'idle' ? '🐱 Purr…' : '🐱 Cat break!'), { body: $('#cb-msg').textContent, tag: 'catbreak' });
    n.onclick = () => { window.focus(); n.close(); };
  }
  clearInterval(cbTimer);
  cbTimer = setInterval(tickBreak, 250);
  tickBreak();
}
function tickBreak() {
  const left = Math.max(0, cbEndAt - Date.now());
  const s = Math.ceil(left / 1000);
  $('#cb-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  if (cbMode !== 'idle' && !left) endBreak();
}
function endBreak() {
  clearInterval(cbTimer);
  cbMode = null;
  cbLastBreak = Date.now();
  $('#catbreak').hidden = true;
  $('#cb-media video')?.pause();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (pipWin) { pipWin.close(); pipWin = null; }
}
$('#cb-more').onclick = () => { cbEndAt += 60000; tickBreak(); };
// Ending early takes a deliberate 1.5 s press, so the break isn't skipped by reflex.
let holdTimer = null;
$('#cb-end').addEventListener('pointerdown', () => { $('#cb-end').classList.add('holding'); holdTimer = setTimeout(endBreak, 1500); });
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => $('#cb-end').addEventListener(ev, () => { $('#cb-end').classList.remove('holding'); clearTimeout(holdTimer); }));
// A screensaver ends as soon as you're back.
['pointermove', 'keydown', 'pointerdown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { if (cbMode === 'idle') endBreak(); }, { passive: true }));
document.addEventListener('keydown', e => { if (e.altKey && e.code === 'KeyC') { e.preventDefault(); cbMode ? (cbMode === 'manual' && endBreak()) : startBreak('manual'); } });

// Pop out: float the break above other windows (Document Picture-in-Picture in Chrome/Edge, video PiP elsewhere).
let pipWin = null;
$('#cb-pip').onclick = async () => {
  const video = $('#cb-media video');
  if (window.documentPictureInPicture) {
    pipWin = await documentPictureInPicture.requestWindow({ width: 420, height: 520 });
    [...document.styleSheets].forEach(ss => { try { pipWin.document.head.append(h('style', { textContent: [...ss.cssRules].map(r => r.cssText).join('\n') })); } catch {} });
    pipWin.document.documentElement.dataset.theme = document.documentElement.dataset.theme;
    const panel = $('#catbreak');
    pipWin.document.body.append(panel);
    panel.classList.add('in-pip');
    pipWin.addEventListener('pagehide', () => { panel.classList.remove('in-pip'); document.body.append(panel); pipWin = null; });
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } else if (video?.requestPictureInPicture) {
    video.muted = true;
    await video.requestPictureInPicture().catch(() => toast('Pop-out is not available here'));
  } else toast('Pop-out is not available in this browser');
};

// ---------- Triggers ----------
// Every N minutes since the last break, while the app is open.
setInterval(() => {
  const c = cbSettings();
  if (!cbMode && c.every && Date.now() - cbLastBreak >= c.every * 60000) startBreak('timer');
}, 15000);

// Idle: system-wide on Chrome/Edge (Idle Detection API, asks permission), otherwise activity inside this window.
let lastActive = Date.now();
['pointermove', 'keydown', 'pointerdown', 'scroll', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true, capture: true }));
setInterval(() => {
  const c = cbSettings();
  if (!cbMode && c.idle && !cbIdle && !document.hidden && Date.now() - lastActive >= c.idle * 60000) startBreak('idle');
}, 10000);
async function scheduleIdle() {
  const c = cbSettings();
  cbIdle?.abort?.abort();
  cbIdle = null;
  if (!c.idle || !('IdleDetector' in window)) return;
  try {
    if (await IdleDetector.requestPermission() !== 'granted') return;
    const ctrl = new AbortController();
    const det = new IdleDetector();
    det.addEventListener('change', () => { if (det.userState === 'idle' && !cbMode) startBreak('idle'); });
    await det.start({ threshold: Math.max(60000, c.idle * 60000), signal: ctrl.signal });
    cbIdle = { abort: ctrl };
  } catch {}
}
// Notification permission is requested once, when you first turn on a timer.
document.addEventListener('change', e => {
  if (e.target.closest('#catbreak-card select') && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
});

renderers.push(renderCatBreakCard);
