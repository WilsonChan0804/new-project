'use strict';
// Sticker studio: place a photo, cut out the subject (AI + brushes + magic wand), add a die-cut outline and caption.
// The AI cut-out runs U²-Net (small) with ONNX Runtime on this device; nothing is uploaded.

const cv = $('#st-canvas');
const ctx = cv.getContext('2d', { willReadFrequently: true });
const S = 512;
const st = {
  img: null, x: 0, y: 0, shape: 'cutout', tool: 'move',
  mask: null,      // Uint8ClampedArray(S*S) alpha for cut-out; null = keep everything
  history: [],     // previous masks for undo
  outlineColor: '#FFFFFF',
  cursor: null,    // brush cursor position while hovering
};
let stickerFilter = 'All';
const ctrl = id => $('#st-' + id);

// ---------- Loading a photo ----------
async function loadStickerPhoto(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const img = new Image();
  img.src = await readImage(f, 1600);
  await img.decode();
  Object.assign(st, { img, x: 0, y: 0, mask: null, history: [] });
  ctrl('zoom').value = 1;
  drawSticker();
  if (st.shape === 'cutout') toast('Tap ✨ Select subject to cut it out');
}
ctrl('file').addEventListener('change', loadStickerPhoto);
ctrl('camera').addEventListener('change', loadStickerPhoto);

// ---------- Controls ----------
ctrl('shape').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  ctrl('shape').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  st.shape = b.dataset.v;
  ctrl('cut-tools').hidden = st.shape !== 'cutout';
  if (st.shape !== 'cutout') setTool('move');
  updateHint();
  drawSticker();
}));
function setTool(t) {
  st.tool = t;
  ctrl('tool').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.t === t));
  ctrl('brush-wrap').hidden = !(t === 'erase' || t === 'restore');
  ctrl('tol-wrap').hidden = t !== 'wand';
  cv.style.cursor = t === 'move' ? 'grab' : 'crosshair';
  updateHint();
}
ctrl('tool').querySelectorAll('button').forEach(b => b.addEventListener('click', () => setTool(b.dataset.t)));
function updateHint() {
  ctrl('hint').textContent = st.shape !== 'cutout' ? 'Drag the photo to position it.' : {
    move: 'Drag to position the photo first, then tap ✨ Select subject.',
    erase: 'Paint over anything you want to remove.',
    restore: 'Paint over parts of the subject to bring them back.',
    wand: 'Tap a background colour to remove it.',
  }[st.tool];
}
['zoom', 'outline', 'caption', 'tol', 'feather'].forEach(id => ctrl(id).addEventListener('input', () => {
  if (id === 'zoom' && st.mask) { pushHistory(); st.mask = null; toast('Cut-out reset because the photo moved'); }
  drawSticker();
}));
ctrl('outline-color').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  ctrl('outline-color').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  st.outlineColor = b.dataset.c;
  drawSticker();
}));
function pushHistory() { st.history.push(st.mask && new Uint8ClampedArray(st.mask)); if (st.history.length > 30) st.history.shift(); }
ctrl('undo').onclick = () => { if (st.history.length) { st.mask = st.history.pop(); drawSticker(); } };

// ---------- AI: select subject ----------
let ortSession = null;
async function getSession() {
  if (ortSession) return ortSession;
  if (!window.ort) await loadScript('vendor/onnx/ort.wasm.min.js');
  ort.env.wasm.wasmPaths = new URL('vendor/onnx/', location.href).href;
  ort.env.wasm.numThreads = 1;
  ortSession = await ort.InferenceSession.create(new URL('vendor/onnx/u2netp.onnx', location.href).href, { executionProviders: ['wasm'] });
  return ortSession;
}
ctrl('ai').onclick = async () => {
  if (!st.img) return toast('Choose a photo first');
  if (location.protocol === 'file:') return toast('The AI cut-out needs the app to be started with “Start Twofold”');
  ctrl('busy').hidden = false;
  try {
    ctrl('busy-label').textContent = 'Loading the cut-out model…';
    const session = await getSession();
    ctrl('busy-label').textContent = 'Finding the subject…';
    await new Promise(r => setTimeout(r, 30));
    // Model input: the placed photo at 320×320, normalised like ImageNet.
    const N = 320;
    const small = h('canvas', { width: N, height: N });
    const sc = small.getContext('2d', { willReadFrequently: true });
    sc.drawImage(placedPhoto(), 0, 0, N, N);
    const px = sc.getImageData(0, 0, N, N).data;
    const input = new Float32Array(3 * N * N);
    const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    for (let i = 0; i < N * N; i++) for (let c = 0; c < 3; c++) input[c * N * N + i] = (px[i * 4 + c] / 255 - mean[c]) / std[c];
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, N, N]) });
    const pred = out[session.outputNames[0]].data;
    let lo = Infinity, hi = -Infinity;
    for (const v of pred) { if (v < lo) lo = v; if (v > hi) hi = v; }
    // Scale the 320² probability map up to 512² and sharpen it into a clean edge.
    const maskSmall = sc.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      const p = (pred[i] - lo) / (hi - lo || 1);
      maskSmall.data[i * 4 + 3] = Math.max(0, Math.min(255, (p - 0.35) / 0.3 * 255));
    }
    sc.clearRect(0, 0, N, N);
    sc.putImageData(maskSmall, 0, 0);
    const big = h('canvas', { width: S, height: S });
    const bc = big.getContext('2d', { willReadFrequently: true });
    bc.imageSmoothingQuality = 'high';
    bc.drawImage(small, 0, 0, S, S);
    const a = bc.getImageData(0, 0, S, S).data;
    pushHistory();
    st.mask = new Uint8ClampedArray(S * S);
    for (let i = 0; i < S * S; i++) st.mask[i] = a[i * 4 + 3];
    setTool('erase');
    toast('Done! Use Erase / Restore to touch up the edges');
  } catch (err) {
    console.error(err);
    toast('Could not run the cut-out: ' + err.message);
  } finally {
    ctrl('busy').hidden = true;
    drawSticker();
  }
};

// ---------- Pointer: move, brush, wand ----------
let drag = null;
const toCanvas = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * S / r.width, (e.clientY - r.top) * S / r.height]; };
const brushR = () => +ctrl('brush').value;
function paint(x, y, value) {
  if (!st.mask) st.mask = new Uint8ClampedArray(S * S).fill(255);
  const r = brushR(), r2 = r * r;
  for (let j = Math.max(0, Math.floor(y - r)); j < Math.min(S, y + r); j++)
    for (let i = Math.max(0, Math.floor(x - r)); i < Math.min(S, x + r); i++) {
      const d2 = (i - x) ** 2 + (j - y) ** 2;
      if (d2 > r2) continue;
      const k = Math.min(1, (1 - Math.sqrt(d2) / r) * 3); // soft brush edge
      const idx = j * S + i;
      st.mask[idx] = value ? Math.max(st.mask[idx], 255 * k) : Math.min(st.mask[idx], 255 * (1 - k));
    }
}
function paintLine(a, b, value) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (brushR() / 3)));
  for (let s = 1; s <= steps; s++) paint(a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps, value);
}
cv.addEventListener('pointerdown', e => {
  if (!st.img) return;
  cv.setPointerCapture(e.pointerId);
  const p = toCanvas(e);
  const tool = st.shape === 'cutout' ? st.tool : 'move';
  if (tool === 'wand') { pushHistory(); wand(...p.map(Math.floor)); drawSticker(); return; }
  if (tool === 'erase' || tool === 'restore') { pushHistory(); paint(...p, tool === 'restore'); drawSticker(); }
  drag = { tool, start: p, last: p, sx: st.x, sy: st.y, client: [e.clientX, e.clientY] };
});
cv.addEventListener('pointermove', e => {
  const p = toCanvas(e);
  st.cursor = (st.shape === 'cutout' && (st.tool === 'erase' || st.tool === 'restore')) ? p : null;
  if (!drag) { if (st.cursor) drawSticker(); return; }
  if (drag.tool === 'move') {
    const k = S / cv.getBoundingClientRect().width;
    st.x = drag.sx + (e.clientX - drag.client[0]) * k;
    st.y = drag.sy + (e.clientY - drag.client[1]) * k;
    if (st.mask) { pushHistory(); st.mask = null; toast('Cut-out reset because the photo moved'); }
  } else paintLine(drag.last, p, drag.tool === 'restore');
  drag.last = p;
  drawSticker();
});
cv.addEventListener('pointerup', () => { drag = null; });
cv.addEventListener('pointerleave', () => { st.cursor = null; drawSticker(); });

// Magic wand: remove the connected area of similar colour.
function wand(sx, sy) {
  const base = placedPhoto().getContext('2d').getImageData(0, 0, S, S).data;
  if (!st.mask) st.mask = new Uint8ClampedArray(S * S).fill(255);
  const tol = +ctrl('tol').value * 3;
  const p0 = (sy * S + sx) * 4;
  const [r0, g0, b0] = [base[p0], base[p0 + 1], base[p0 + 2]];
  const seen = new Uint8Array(S * S);
  const stack = [sy * S + sx];
  while (stack.length) {
    const i = stack.pop();
    if (seen[i]) continue;
    seen[i] = 1;
    const p = i * 4;
    if (Math.abs(base[p] - r0) + Math.abs(base[p + 1] - g0) + Math.abs(base[p + 2] - b0) > tol) continue;
    st.mask[i] = 0;
    const x = i % S;
    if (x > 0) stack.push(i - 1);
    if (x < S - 1) stack.push(i + 1);
    if (i >= S) stack.push(i - S);
    if (i < S * S - S) stack.push(i + S);
  }
}

// ---------- Rendering ----------
function placedPhoto() {
  const c = h('canvas', { width: S, height: S });
  const x = c.getContext('2d', { willReadFrequently: true });
  const k = Math.max(S / st.img.width, S / st.img.height) * +ctrl('zoom').value;
  x.drawImage(st.img, (S - st.img.width * k) / 2 + st.x, (S - st.img.height * k) / 2 + st.y, st.img.width * k, st.img.height * k);
  return c;
}
function shapePath(c, shape, pad) {
  const w = S - pad * 2;
  c.beginPath();
  if (shape === 'circle') c.arc(S / 2, S / 2, w / 2, 0, Math.PI * 2);
  else if (shape === 'rounded') c.roundRect(pad, pad, w, w, w * 0.18);
  else if (shape === 'heart') {
    const x = S / 2, top = pad + w * 0.28, bot = pad + w;
    c.moveTo(x, bot);
    c.bezierCurveTo(pad - w * 0.05, pad + w * 0.6, pad, pad - w * 0.05, x, top);
    c.bezierCurveTo(S - pad, pad - w * 0.05, S - pad + w * 0.05, pad + w * 0.6, x, bot);
  } else c.rect(pad, pad, w, w);
}
// Separable box blur on the mask for soft edges.
function blurMask(m, r) {
  if (!r) return m;
  const tmp = new Float32Array(S * S), out = new Uint8ClampedArray(S * S), n = 2 * r + 1;
  for (let y = 0; y < S; y++) { let acc = 0; for (let x = -r; x <= r; x++) acc += m[y * S + Math.min(S - 1, Math.max(0, x))];
    for (let x = 0; x < S; x++) { tmp[y * S + x] = acc / n; acc += m[y * S + Math.min(S - 1, x + r + 1)] - m[y * S + Math.max(0, x - r)]; } }
  for (let x = 0; x < S; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += tmp[Math.min(S - 1, Math.max(0, y)) * S + x];
    for (let y = 0; y < S; y++) { out[y * S + x] = acc / n; acc += tmp[Math.min(S - 1, y + r + 1) * S + x] - tmp[Math.max(0, y - r) * S + x]; } }
  return out;
}

function renderSticker(withCursor = true) {
  ctx.clearRect(0, 0, S, S);
  ctrl('undo').hidden = !st.history.length;
  ctrl('empty').hidden = !!st.img;
  ctrl('stage').classList.toggle('loaded', !!st.img);
  if (!st.img) return;
  const outline = +ctrl('outline').value;
  const text = ctrl('caption').value.trim();
  const pad = outline + 8;

  // 1. Photo, then shape clip or cut-out mask.
  const body = placedPhoto();
  const b = body.getContext('2d', { willReadFrequently: true });
  if (st.shape !== 'cutout') {
    b.globalCompositeOperation = 'destination-in';
    shapePath(b, st.shape, pad);
    b.fill();
  } else if (st.mask) {
    const m = blurMask(st.mask, +ctrl('feather').value);
    const id = b.getImageData(0, 0, S, S);
    for (let i = 0; i < S * S; i++) id.data[i * 4 + 3] = id.data[i * 4 + 3] * m[i] / 255;
    b.putImageData(id, 0, 0);
  }

  // 2. Die-cut outline: a crisp silhouette stamped in a ring around the subject.
  if (outline > 0 && (st.shape !== 'cutout' || st.mask)) {
    const sil = h('canvas', { width: S, height: S });
    const sc = sil.getContext('2d', { willReadFrequently: true });
    sc.drawImage(body, 0, 0);
    const sd = sc.getImageData(0, 0, S, S);
    for (let i = 0; i < S * S; i++) { const on = sd.data[i * 4 + 3] > 110; sd.data.set(on ? [255, 255, 255, 255] : [0, 0, 0, 0], i * 4); }
    sc.putImageData(sd, 0, 0);
    sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = st.outlineColor;
    sc.fillRect(0, 0, S, S);
    const steps = Math.max(16, outline * 3);
    for (let a = 0; a < steps; a++) {
      const t = a / steps * Math.PI * 2;
      ctx.drawImage(sil, Math.cos(t) * outline, Math.sin(t) * outline);
    }
    ctx.drawImage(sil, 0, 0); // fill pinholes
  }
  ctx.drawImage(body, 0, 0);

  // 3. Caption.
  if (text) {
    ctx.font = '700 64px "Bricolage Grotesque", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#2A1E22';
    ctx.fillStyle = '#fff';
    ctx.strokeText(text, S / 2, S - 30, S - 40);
    ctx.fillText(text, S / 2, S - 30, S - 40);
  }

  // While editing, show the removed parts faintly and the brush outline.
  if (withCursor && st.shape === 'cutout' && st.mask && st.tool !== 'move') {
    ctx.save(); ctx.globalAlpha = 0.18; ctx.globalCompositeOperation = 'destination-over'; ctx.drawImage(placedPhoto(), 0, 0); ctx.restore();
  }
  if (withCursor && st.cursor) {
    ctx.beginPath(); ctx.arc(st.cursor[0], st.cursor[1], brushR(), 0, Math.PI * 2);
    ctx.lineWidth = 2; ctx.strokeStyle = st.tool === 'erase' ? '#D2384F' : '#2F7A50'; ctx.stroke();
  }
}
let drawQueued = false;
function drawSticker() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; renderSticker(); });
}

// ---------- Save & library ----------
ctrl('save').onclick = async () => {
  if (!st.img) return toast('Choose a photo first');
  renderSticker(false);
  // Trim empty space around the sticker.
  const d = ctx.getImageData(0, 0, S, S).data;
  let x0 = S, y0 = S, x1 = 0, y1 = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (d[(y * S + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (x1 <= x0) return toast('The sticker is empty — try Undo');
  const side = Math.max(x1 - x0, y1 - y0) + 8;
  const out = h('canvas', { width: side, height: side });
  out.getContext('2d').drawImage(cv, x0 - (side - (x1 - x0)) / 2, y0 - (side - (y1 - y0)) / 2, side, side, 0, 0, side, side);
  const group = ctrl('group').value.trim() || 'Stickers';
  await db.put('stickers', { id: uid(), src: out.toDataURL('image/png'), created: Date.now(), group });
  stickerFilter = group;
  toast(`Sticker saved to “${group}”`);
  drawSticker();
  renderStickers();
};

async function renderStickers() {
  const all = (await db.all('stickers')).sort((a, b) => b.created - a.created);
  const groups = [...new Set(all.map(s => s.group || 'Stickers'))];
  fill(ctrl('groups'), groups.map(g => h('option', { value: g })));
  if (stickerFilter !== 'All' && !groups.includes(stickerFilter)) stickerFilter = 'All';
  fill(ctrl('filter'), all.length ? ['All', ...groups].map(g => h('button', { className: 'chip' + (g === stickerFilter ? ' on' : ''), textContent: g === 'All' ? `All (${all.length})` : g, onclick: () => { stickerFilter = g; renderStickers(); } })) : null);
  const list = stickerFilter === 'All' ? all : all.filter(s => (s.group || 'Stickers') === stickerFilter);
  fill(ctrl('library'), list.length ? list.map(s => h('figure', {},
    h('img', { src: s.src, alt: 'Sticker' }),
    h('figcaption', { className: 'sm muted', textContent: s.group || 'Stickers' }),
    h('div', { className: 'row' },
      roundBtn('share', 'Share (e.g. to WhatsApp)', () => nativeShare({ images: [s.src] })),
      roundBtn('download', 'Download PNG', () => download('sticker.png', s.src)),
      roundBtn('pen', 'Move to group', async () => {
        const g = prompt(T(`Move to which group? (${groups.join(', ')})`), s.group || 'Stickers');
        if (g?.trim()) { await db.put('stickers', { ...s, group: g.trim() }); renderStickers(); }
      }),
      roundBtn('trash', 'Delete', async () => {
        await db.del('stickers', s.id);
        toast('Sticker deleted', { label: 'Undo', run: async () => { await db.put('stickers', s); renderStickers(); } });
        renderStickers();
      })))) :
    [h('p', { className: 'sm muted', textContent: 'Stickers you make will appear here, ready to use in Chat.' })]);
}

setTool('move');
updateHint();
drawSticker();
renderers.push(renderStickers);
