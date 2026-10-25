'use strict';
// Shopping list & meal plan: read a checklist photo (or pasted text), review it, then shop or plan meals.
// Expected layout per row: date (YYYYMMDD) | dish | ingredient | ingredient | …  Rows without a date are extra items.

// ---------- Grocery words (Hong Kong, Traditional Chinese) for auto-correcting OCR ----------
const GROCERY = {
  veg: ['紅菜頭', '粟米', '車厘茄', '番茄', '蕃茄', '沙律菜', '西蘭花', '西蘭花苗', '椰菜花', '菜心', '白菜', '小棠菜', '芥蘭', '菠菜', '生菜', '唐生菜', '羅馬生菜',
    '油麥菜', '通菜', '豆苗', '芽菜', '韭菜', '韭黃', '蘆筍', '三色椒', '甜椒', '青椒', '紅椒', '黃椒', '洋蔥', '紅洋蔥', '蒜頭', '薑', '蔥', '芫茜', '九層塔',
    '蘑菇', '冬菇', '香菇', '金菇', '秀珍菇', '杏鮑菇', '雞髀菇', '茄子', '青瓜', '節瓜', '冬瓜', '苦瓜', '絲瓜', '翠玉瓜', '南瓜', '蕃薯', '番薯', '薯仔',
    '馬鈴薯', '甘筍', '紅蘿蔔', '白蘿蔔', '蓮藕', '淮山', '芋頭', '椰菜', '紫椰菜', '西芹', '芹菜', '秋葵', '荷蘭豆', '豆角', '四季豆', '毛豆', '牛油果',
    '羽衣甘藍', '椰菜仔', '粟米芯', '竹筍', '馬蹄', '黑木耳', '雲耳', '羅勒', '迷迭香', 'Kale', 'Avocado'],
  fruit: ['香蕉', '蘋果', '橙', '檸檬', '青檸', '士多啤梨', '藍莓', '紅莓', '提子', '葡萄', '奇異果', '芒果', '菠蘿', '西瓜', '蜜瓜', '哈密瓜', '木瓜', '梨',
    '水蜜桃', '布冧', '車厘子', '柚子', '火龍果', '榴槤', '荔枝', '龍眼', '柿', '石榴', '椰子'],
  meat: ['雞', '雞胸', '雞胸肉', '雞髀', '雞翼', '全雞', '豬肉', '豬扒', '免治豬肉', '豬肉碎', '排骨', '豬腩', '五花腩', '牛肉', '牛扒', '免治牛肉', '牛肉碎',
    '牛腩', '牛柳', '羊肉', '羊扒', '煙肉', '火腿', '香腸', '午餐肉', '叉燒', '燒肉', '鴨胸'],
  seafood: ['三文魚', '鱈魚', '煙鱈魚', '吞拿魚', '蝦', '蝦仁', '大蝦', '帶子', '魷魚', '八爪魚', '青口', '蜆', '蠔', '蟹', '龍利魚', '鯖魚', '石斑', '魚柳', '魚蛋', '蟹柳'],
  dairy: ['雞蛋', '鮮奶', '牛奶', '豆奶', '燕麥奶', '乳酪', '希臘乳酪', '芝士', '車打芝士', '莫薩里拉芝士', '巴馬臣芝士', '忌廉', '淡忌廉', '牛油', '豆腐', '滑豆腐',
    'Halloumi', 'Feta', 'Mozzarella', 'Parmesan', 'Burrata'],
  pantry: ['藜麥', '白米', '糙米', '意粉', '通粉', '烏冬', '米粉', '河粉', '麵包', '燕麥', '麥皮', '麵粉', '吞拿魚罐頭', '鷹嘴豆', '紅腰豆', '黑豆', '番茄醬',
    '茄汁', '合桃', '杏仁', '腰果', '提子乾', '蜜糖', '砂糖', '鹽', '黑胡椒', '橄欖油', '麻油', '豉油', '生抽', '老抽', '蠔油', 'XO醬', '醋', '黑醋', '沙律醬',
    '蛋黃醬', '咖哩', '椰奶', '雞湯', '粟粉', 'Quinoa'],
};
const CATEGORIES = [
  ['veg', 'Vegetables · 蔬菜'], ['fruit', 'Fruit · 水果'], ['meat', 'Meat · 肉類'], ['seafood', 'Seafood · 海鮮'],
  ['dairy', 'Dairy, eggs & tofu · 蛋奶豆腐'], ['pantry', 'Pantry & sauces · 乾貨調味'], ['other', 'Other · 其他'],
];
const GROCERY_WORDS = Object.values(GROCERY).flat();
const datalist = h('datalist', { id: 'grocery-words' }, GROCERY_WORDS.map(w => h('option', { value: w })));
document.body.append(datalist);

const norm = s => s.replace(/\s+/g, '').toLowerCase();
const QTY = /^(.*?)\s*((?:[xX×*]\s*\d+(?:\.\d+)?)|(?:\d+(?:\.\d+)?\s*(?:g|kg|ml|L|個|包|盒|隻|條|斤|兩|罐|件|pcs?)))$/;
const splitQty = s => { const m = s.trim().match(QTY); return m && m[1] ? [m[1].trim(), m[2].replace(/\s+/g, '')] : [s.trim(), '']; };

function category(name) {
  const n = norm(name);
  for (const [cat, words] of Object.entries(GROCERY)) if (words.some(w => norm(w) === n)) return cat;
  // Longest dictionary word contained in the name, e.g. "鱈魚 / 煙鱈魚" → seafood.
  let best = null, len = 0;
  for (const [cat, words] of Object.entries(GROCERY)) for (const w of words) if (norm(w).length > len && n.includes(norm(w))) { best = cat; len = norm(w).length; }
  return best || 'other';
}

// Longest common subsequence: how many characters two strings share in order.
function lcs(a, b) {
  const dp = Array(b.length + 1).fill(0);
  for (const ca of a) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = ca === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}
// Snap an OCR'd word to the closest known word (your past corrections first, then the grocery list).
function correctWord(raw, extraWords = []) {
  const [name, qty] = splitQty(raw);
  const parts = name.split(/\s*\/\s*/);
  let changed = false;
  const fixed = parts.map(p => {
    const n = norm(p);
    if (!n) return p;
    let best = null, score = 0;
    for (const w of [...extraWords, ...GROCERY_WORDS]) {
      const wn = norm(w);
      if (wn === n) return p;
      if (Math.abs(wn.length - n.length) > 1) continue;
      const sc = lcs(n, wn) / Math.max(n.length, wn.length);
      if (sc > score) { score = sc; best = w; }
    }
    if (best && score >= 0.5 && n.length >= 2) { changed = true; return best; }
    return p;
  });
  return { text: fixed.join(' / ') + (qty ? ' ' + qty : ''), changed };
}

// ---------- OCR (Tesseract, bundled; runs on this device) ----------
let ocrWorker = null;
function loadScript(src) {
  return new Promise((resolve, reject) => document.head.append(h('script', { src, onload: resolve, onerror: () => reject(new Error('Could not load ' + src)) })));
}
async function getOcr(onProgress) {
  if (!window.Tesseract) await loadScript('vendor/tesseract/tesseract.min.js');
  if (!ocrWorker) {
    const base = new URL('vendor/', location.href).href;
    ocrWorker = await Tesseract.createWorker('chi_tra', 1, {
      workerPath: base + 'tesseract/worker.min.js', corePath: base + 'tesseract/', langPath: base + 'tessdata', gzip: true,
      logger: m => m.status && onProgress?.(m.status.replace('loading ', 'Loading '), m.progress),
    });
  }
  return ocrWorker;
}

function imageToGray(img) {
  const k = Math.min(1, 2400 / img.width);
  const W = Math.round(img.width * k), H = Math.round(img.height * k);
  const c = h('canvas', { width: W, height: H });
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.drawImage(img, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data;
  const g = new Uint8ClampedArray(W * H);
  for (let i = 0; i < W * H; i++) g[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
  return { g, W, H };
}
// Find spreadsheet grid lines: rows/columns that are mostly non-white.
function detectGrid({ g, W, H }) {
  const group = v => v.reduce((out, a) => { if (out.length && a - out.at(-1)[1] <= 2) out.at(-1)[1] = a; else out.push([a, a]); return out; }, []);
  const rowsIdx = [];
  for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) if (g[y * W + x] < 240) n++; if (n > W * 0.6) rowsIdx.push(y); }
  const rows = group(rowsIdx);
  if (rows.length < 2) return null;
  const top = rows[0][0], bot = rows.at(-1)[1];
  const colsIdx = [];
  for (let x = 0; x < W; x++) { let n = 0; for (let y = top; y < bot; y++) if (g[y * W + x] < 240) n++; if (n > (bot - top) * 0.6) colsIdx.push(x); }
  let cols = group(colsIdx);
  if (!cols.length || cols[0][0] > 3) cols = [[-1, -1], ...cols];
  if (cols.at(-1)[1] < W - 4) cols.push([W, W]);
  return cols.length >= 3 ? { rows, cols } : null;
}
// Bounding box of the ink inside a cell, or null when the cell is empty.
function inkBox({ g, W }, x0, y0, x1, y1) {
  let minX = x1, maxX = -1, darkest = 255;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const v = g[y * W + x];
    if (v < darkest) darkest = v;
    if (v < 180) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
  }
  if (darkest > 150 || maxX < 0) return null;
  return [Math.max(x0, minX - 3), y0, Math.min(x1, maxX + 4), y1];
}
// Crop, enlarge and optionally binarise a region so Tesseract can read small text.
function cellCanvas({ g, W }, [x0, y0, x1, y1], k = 3, threshold = 165) {
  const w = x1 - x0, hgt = y1 - y0, pad = 30;
  const src = h('canvas', { width: w, height: hgt });
  const sx = src.getContext('2d');
  const id = sx.createImageData(w, hgt);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    const v = g[(y + y0) * W + x + x0], i = (y * w + x) * 4;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
  }
  sx.putImageData(id, 0, 0);
  const out = h('canvas', { width: w * k + pad * 2, height: hgt * k + pad * 2 });
  const o = out.getContext('2d', { willReadFrequently: true });
  o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height);
  o.imageSmoothingQuality = 'high';
  o.drawImage(src, pad, pad, w * k, hgt * k);
  if (threshold) {
    const od = o.getImageData(0, 0, out.width, out.height);
    for (let i = 0; i < od.data.length; i += 4) { const v = od.data[i] < threshold ? 0 : 255; od.data[i] = od.data[i + 1] = od.data[i + 2] = v; }
    o.putImageData(od, 0, 0);
  }
  return out;
}
const cleanOcr = t => t.trim().replace(/(?<=[^\x00-\x7F])\s+(?=[^\x00-\x7F])/g, '').replace(/^[-_.,'"`]+|[.,'"`]+$/g, '').replace(/\s+/g, ' ');

// How well a reading matches known words (1 = every part is a known word).
function dictScore(raw, words) {
  const parts = splitQty(raw)[0].split(/\s*\/\s*/).map(norm).filter(Boolean);
  if (!parts.length) return 0;
  return parts.reduce((sum, p) => {
    let best = 0;
    for (const w of words) {
      const wn = norm(w);
      if (wn === p) { best = 1; break; }
      if (Math.abs(wn.length - p.length) <= 1) best = Math.max(best, lcs(p, wn) / Math.max(p.length, wn.length));
    }
    return sum + best;
  }, 0) / parts.length;
}

// Several enlargements/thresholds/modes; small CJK text reads very differently under each.
const VARIANTS = [[3, 165, '7'], [3, 0, '7'], [6, 0, '13'], [4, 0, '7'], [4, 165, '13'], [6, 165, '7']];
async function readCell(worker, gray, box, kind) {
  const words = kind === 'dish' ? vocab().dishes : [...vocab().items, ...GROCERY_WORDS];
  let best = null;
  for (const [i, [k, th, psm]] of VARIANTS.entries()) {
    if (kind === 'date' && i > 2) break;
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(cellCanvas(gray, box, k, th));
    const text = cleanOcr(data.text);
    if (!text) continue;
    const score = kind === 'date' ? (parseDate8(text) ? 100 : 0) + data.confidence * 0.1 : dictScore(text, words) * 100 + data.confidence * 0.4;
    if (!best || score > best.score) best = { text, conf: data.confidence, score };
    if (kind === 'date' && parseDate8(text)) break;
    if (kind !== 'date' && dictScore(text, words) === 1 && data.confidence >= 55) break; // confident, known word
  }
  // Drop noise such as icons or arrows read as a stray character.
  if (!best || !/\p{L}{2}|\p{N}/u.test(best.text)) return { text: '', conf: 100 };
  return best;
}

async function readChecklistImage(file, onProgress) {
  const img = await createImageBitmap(file);
  const gray = imageToGray(img);
  const worker = await getOcr(onProgress);
  const grid = detectGrid(gray);
  if (!grid) {
    // No table lines (e.g. a photo of a handwritten list): read the whole image as text.
    onProgress('Reading the list', 0.5);
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    const { data } = await worker.recognize(cellCanvas(gray, [0, 0, gray.W, gray.H], 2, 165));
    return parseChecklistText(data.text, true);
  }
  const { rows, cols } = grid;
  const total = (rows.length - 1) * (cols.length - 1);
  const table = [];
  let done = 0;
  for (let r = 0; r < rows.length - 1; r++) {
    const line = [];
    for (let c = 0; c < cols.length - 1; c++) {
      const box = inkBox(gray, cols[c][1] + 2, rows[r][1] + 1, cols[c + 1][0] - 1, rows[r + 1][0]);
      line.push(box ? await readCell(worker, gray, box, c === 0 ? 'date' : c === 1 ? 'dish' : 'item') : { text: '', conf: 100 });
      onProgress(`Reading cell ${++done} of ${total}`, done / total);
    }
    table.push(line);
  }
  return tableToPlan(table);
}

// ---------- Parsing into a plan: rows (date, dish, items) + extras ----------
function parseDate8(text) {
  const d = text.replace(/[oO]/g, '0').replace(/[lI|]/g, '1').replace(/\D/g, '');
  const m = d.match(/^(20\d{2})(\d{2})(\d{2})$/);
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
const vocab = () => settings.vocab || { items: [], dishes: [] };

function cellFrom(raw, conf = 100, words = vocab().items) {
  const { text, changed } = correctWord(raw, words);
  return { text, was: raw, flag: changed || conf < 70 };
}
function tableToPlan(table) {
  const rows = [], extras = [];
  for (const line of table) {
    const cells = line.map(c => ({ ...c, text: c.text.trim() }));
    if (cells.every(c => !c.text)) continue;
    const date = parseDate8(cells[0]?.text || '');
    const looksDated = date || /^\s*2\d{3}/.test(cells[0]?.text || '');
    if (looksDated && cells.length > 1) {
      const dish = cells[1] || { text: '', conf: 0 };
      const dishFix = correctWord(dish.text, vocab().dishes);
      rows.push({
        date: date || '', dateFlag: !date, dateWas: cells[0].text,
        dish: { text: dishFix.text, was: dish.text, flag: dishFix.changed || dish.conf < 70 },
        items: cells.slice(2).filter(c => c.text).map(c => cellFrom(c.text, c.conf)),
      });
    } else {
      cells.filter(c => c.text).forEach(c => extras.push(cellFrom(c.text, c.conf)));
    }
  }
  inferMissingDates(rows);
  return { rows, extras };
}
function inferMissingDates(rows) {
  rows.forEach((r, i) => {
    if (r.date) return;
    const prev = rows.slice(0, i).reverse().find(x => x.date);
    if (prev) r.date = isoDate(new Date(parseDate(prev.date).getTime() + DAY * (i - rows.indexOf(prev))));
  });
}

// Text from paste (Excel/Numbers copy, iPhone Live Text) or whole-image OCR.
function tokenize(line) {
  const raw = line.includes('\t') ? line.split('\t') : line.split(/\s+/);
  const out = [];
  for (let t of raw.map(x => x.trim()).filter(Boolean)) {
    const prev = out.at(-1);
    if (prev && (t === '/' || t.startsWith('/') || prev.endsWith('/'))) out[out.length - 1] = `${prev} ${t}`.replace(/\s*\/\s*/g, ' / ').trim();
    else if (prev && (/^[xX×*]\s*\d+$/.test(t) || /^\(\d+\)$/.test(t) || /^\d+(g|kg|ml|L|個|包|盒|隻|條|斤|兩|罐|件)$/.test(t))) out[out.length - 1] = `${prev} ${t}`;
    else out.push(t);
  }
  return out;
}
function parseChecklistText(text, fromOcr = false) {
  const rows = [], extras = [];
  let cur = null, curLineHadOnlyDate = false;
  const conf = fromOcr ? 50 : 100;
  for (const line of text.split(/\r?\n/)) {
    const toks = tokenize(line);
    if (!toks.length) { cur = null; continue; }
    const date = parseDate8(toks[0]);
    if (date) {
      const [dish, ...items] = toks.slice(1);
      const dishFix = correctWord(dish || '', vocab().dishes);
      cur = { date, dateFlag: false, dish: { text: dishFix.text, was: dish || '', flag: dishFix.changed || fromOcr }, items: items.map(t => cellFrom(t, conf)) };
      rows.push(cur);
      curLineHadOnlyDate = toks.length === 1;
    } else if (cur && (curLineHadOnlyDate || !cur.dish.text)) {
      // One cell per line (some copy/paste formats): keep filling the current row.
      if (!cur.dish.text) { const [d, ...rest] = toks; cur.dish = { text: d, was: d, flag: fromOcr }; toks.splice(0, toks.length, ...rest); }
      cur.items.push(...toks.map(t => cellFrom(t, conf)));
    } else {
      toks.forEach(t => extras.push(cellFrom(t, conf)));
      cur = null;
    }
  }
  return { rows, extras };
}

// ---------- State ----------
let list = null;      // { id: 'current', created, rows, extras, checked: {key: true} }
let review = null;    // plan being reviewed before saving
let shopMode = 'list';

const itemKey = name => norm(splitQty(name)[0]);
function aggregate(l) {
  const map = new Map();
  const add = (raw, date) => {
    const [name, qty] = splitQty(raw);
    const key = norm(name);
    if (!key) return;
    if (!map.has(key)) map.set(key, { key, name, qtys: [], dates: [], cat: category(name) });
    const it = map.get(key);
    if (qty) it.qtys.push(qty);
    if (date && !it.dates.includes(date)) it.dates.push(date);
  };
  l.rows.forEach(r => r.items.forEach(i => add(i, r.date)));
  l.extras.forEach(i => add(i));
  return [...map.values()];
}

// ---------- UI ----------
const shopPane = $('.us-pane[data-pane=shopping]');
bindSeg($('#shop-seg'), b => { shopMode = b.dataset.m; renderShopping(); });

$('#shop-photo').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const prog = $('#shop-progress');
  prog.hidden = false;
  const setP = (label, p) => { $('#shop-progress-label').textContent = label; $('#shop-progress-bar').style.width = `${Math.round((p || 0) * 100)}%`; };
  try {
    setP('Starting the reader…', 0);
    review = await readChecklistImage(f, setP);
    review.image = URL.createObjectURL(f);
    if (!review.rows.length && !review.extras.length) toast('Could not find any items. Try "Paste text" instead.');
  } catch (err) {
    console.error(err);
    toast('Could not read the photo: ' + err.message);
  } finally {
    prog.hidden = true;
  }
  renderShopping();
});
$('#shop-paste-btn').onclick = () => { $('#shop-paste').hidden = !$('#shop-paste').hidden; $('#shop-paste textarea').focus(); };
$('#shop-paste').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('#shop-paste textarea').value;
  review = parseChecklistText(text);
  if (!review.rows.length && !review.extras.length) { review = null; return toast('No items found in that text'); }
  $('#shop-paste').hidden = true;
  $('#shop-paste textarea').value = '';
  renderShopping();
});

// Editable review of what was read. Orange fields were auto-corrected or unclear.
function reviewInput(cell, opts = {}) {
  const inp = h('input', { value: cell.text, className: cell.flag ? 'flag' : '', placeholder: opts.placeholder || '', title: cell.flag && cell.was !== cell.text ? `Read as “${cell.was}”` : '' });
  // Size to the text: CJK characters are about twice as wide as Latin ones.
  const fit = () => { if (!opts.placeholder) inp.style.width = `calc(${[...inp.value].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 1.3 : 0.65), 0)}em + 52px)`; };
  fit();
  inp.addEventListener('input', fit);
  inp.setAttribute('list', 'grocery-words');
  inp.addEventListener('input', () => { cell.text = inp.value; inp.classList.remove('flag'); });
  return inp;
}
function renderReview() {
  const r = review;
  return h('div', { className: 'card review' },
    h('div', { className: 'sec-head' }, h('h2', { textContent: 'Check what was read' }),
      h('button', { className: 'link', textContent: 'Cancel', onclick: () => { review = null; renderShopping(); } })),
    h('p', { className: 'sm muted', textContent: 'Orange boxes were auto-corrected or hard to read. Tap to fix; your fixes are remembered next time.' }),
    r.image && h('details', { className: 'src-img' }, h('summary', { textContent: 'Show original photo' }), h('img', { src: r.image, alt: 'Checklist photo' })),
    r.rows.map((row, i) => h('div', { className: 'rv-row' },
      h('div', { className: 'rv-top' },
        h('input', { type: 'date', value: row.date, className: row.dateFlag ? 'flag' : '', oninput: e => { row.date = e.target.value; e.target.classList.remove('flag'); } }),
        reviewInput(row.dish, { placeholder: 'Dish' }),
        roundBtn('trash', 'Remove row', () => { r.rows.splice(i, 1); renderShopping(); })),
      h('div', { className: 'rv-items' },
        row.items.map((c, j) => h('span', { className: 'rv-item' }, reviewInput(c),
          h('button', { type: 'button', ariaLabel: 'Remove', onclick: () => { row.items.splice(j, 1); renderShopping(); } }, icon('x')))),
        h('button', { type: 'button', className: 'pill-btn add', textContent: '+ Item', onclick: () => { row.items.push({ text: '', was: '', flag: false }); renderShopping(); } })))),
    h('div', { className: 'rv-row' },
      h('strong', { className: 'sm', textContent: 'Other items (no date)' }),
      h('div', { className: 'rv-items' },
        r.extras.map((c, j) => h('span', { className: 'rv-item' }, reviewInput(c),
          h('button', { type: 'button', ariaLabel: 'Remove', onclick: () => { r.extras.splice(j, 1); renderShopping(); } }, icon('x')))),
        h('button', { type: 'button', className: 'pill-btn add', textContent: '+ Item', onclick: () => { r.extras.push({ text: '', was: '', flag: false }); renderShopping(); } }))),
    h('button', { className: 'pill-btn', textContent: '+ Add a day', onclick: () => {
      const last = r.rows.at(-1)?.date;
      r.rows.push({ date: last ? isoDate(new Date(parseDate(last).getTime() + DAY)) : today(), dish: { text: '', was: '', flag: false }, items: [] });
      renderShopping();
    } }),
    h('button', { className: 'cta', onclick: saveReview }, icon('heart'), 'Looks good — make my list'),
  );
}

async function saveReview() {
  const clean = c => c.text.trim();
  const rows = review.rows.map(r => ({ date: r.date, dish: clean(r.dish), items: r.items.map(clean).filter(Boolean) })).filter(r => r.dish || r.items.length);
  const extras = review.extras.map(clean).filter(Boolean);
  // Remember the final words so future photos are corrected towards them.
  const v = vocab();
  const remember = (arr, words) => words.forEach(w => { splitQty(w)[0].split(/\s*\/\s*/).forEach(p => { if (p && !arr.includes(p)) arr.unshift(p); }); });
  remember(v.items, [...rows.flatMap(r => r.items), ...extras]);
  remember(v.dishes, rows.map(r => r.dish).filter(Boolean));
  settings.vocab = { items: v.items.slice(0, 600), dishes: v.dishes.slice(0, 300) };
  await db.put('settings', settings);
  list = { id: 'current', created: Date.now(), rows, extras, checked: {} };
  await db.put('lists', list);
  review = null;
  shopMode = 'list';
  pickSeg($('#shop-seg'), 'data-m', 'list');
  toast('Shopping list ready');
  refresh();
}

async function toggleItem(key) {
  list.checked[key] = !list.checked[key];
  await db.put('lists', list);
  renderShopping();
  renderHome();
}

function shareText(items) {
  const lines = ['🛒 Shopping list'];
  CATEGORIES.forEach(([cat, label]) => {
    const its = items.filter(i => i.cat === cat && !list.checked[i.key]);
    if (its.length) lines.push('', label, ...its.map(i => `• ${i.name}${i.qtys.length ? ' ' + i.qtys.join(' + ') : ''}`));
  });
  return lines.join('\n');
}

async function saveMealsToCalendar() {
  const existing = await db.all('meals');
  let n = 0;
  for (const r of list.rows.filter(r => r.date)) {
    const id = `meal-${r.date}-${norm(r.dish)}`;
    await db.put('meals', { id, date: r.date, dish: r.dish, items: r.items, created: existing.find(m => m.id === id)?.created || Date.now() });
    n++;
  }
  list.savedToCalendar = true;
  await db.put('lists', list);
  toast(`Added ${plural(n, 'meal')} to the calendar`);
  refresh();
}

async function renderShopping() {
  list = (await db.get('lists', 'current')) || null;
  const body = $('#shop-body');
  if (review) return fill(body, renderReview());
  if (!list) return fill(body, h('p', { className: 'empty', textContent: 'No list yet. Scan the checklist photo or paste its text above.' }));
  const items = aggregate(list);
  const left = items.filter(i => !list.checked[i.key]).length;

  if (shopMode === 'list') {
    fill(body,
      h('div', { className: 'shop-head' },
        h('div', {}, h('h2', { textContent: left ? `${plural(left, 'item')} to buy` : 'All done! 🎉' }),
          h('span', { className: 'sm muted', textContent: `${items.length - left} of ${items.length} in the basket` })),
        h('div', { className: 'row' },
          roundBtn('share', 'Share list', () => nativeShare({ text: shareText(items) }), 'outline'),
          roundBtn('trash', 'Clear list', async () => {
            if (!confirm('Clear this shopping list?')) return;
            await db.del('lists', 'current'); refresh();
          }, 'outline'))),
      h('div', { className: 'progress' }, h('i', { style: `width:${items.length ? (items.length - left) / items.length * 100 : 0}%` })),
      h('div', { className: 'shop-cols' }, CATEGORIES.map(([cat, label]) => {
        const its = items.filter(i => i.cat === cat);
        if (!its.length) return null;
        return h('section', { className: 'shop-cat' }, h('h3', { textContent: label }),
          its.map(i => h('label', { className: 'shop-item' + (list.checked[i.key] ? ' done' : '') },
            h('input', { type: 'checkbox', checked: !!list.checked[i.key], onchange: () => toggleItem(i.key) }),
            h('span', { className: 'nm' }, i.name, i.qtys.length ? h('b', { textContent: ' ' + i.qtys.join(' + ') }) : null),
            i.dates.length ? h('span', { className: 'when', textContent: i.dates.map(d => fmtDate(d, { day: 'numeric', month: 'short' })).join(', ') }) : null)));
      })),
    );
  } else {
    const rows = [...list.rows].sort((a, b) => a.date.localeCompare(b.date));
    fill(body,
      h('div', { className: 'shop-head' },
        h('div', {}, h('h2', { textContent: plural(rows.length, 'meal') }),
          h('span', { className: 'sm muted', textContent: list.savedToCalendar ? 'Saved to your calendar' : 'Save them to see each day’s ingredients in the calendar' })),
        h('button', { className: 'pill-btn', onclick: saveMealsToCalendar }, icon('plus'), list.savedToCalendar ? 'Update calendar' : 'Add to calendar')),
      rows.map(r => h('article', { className: 'card meal' },
        h('button', { className: 'meal-date', onclick: () => r.date && openCalendarOn(r.date) },
          h('b', { textContent: r.date ? fmtDate(r.date, { day: 'numeric' }) : '?' }),
          h('span', { textContent: r.date ? fmtDate(r.date, { month: 'short', weekday: 'short' }) : 'No date' })),
        h('div', { className: 'meal-body' },
          h('strong', { className: 'display', textContent: r.dish || 'Meal' }),
          h('div', { className: 'ing' }, r.items.map(i => h('span', { className: list.checked[itemKey(i)] ? 'done' : '', textContent: i })))))),
      list.extras.length ? h('p', { className: 'sm muted', textContent: `Also buying: ${list.extras.join(', ')}` }) : null,
    );
  }
}

// Meals on the calendar, and a reminder card on Home.
calendarSources.push(async () => (await db.all('meals')).map(m => ({
  date: m.date, color: '#5E8C4A', sort: '1',
  render: () => h('div', { className: 'item' },
    h('i', { className: 'k', style: 'background:#5E8C4A' }),
    h('div', { className: 't' }, h('span', { textContent: `🍳 ${m.dish}` }), h('span', { className: 's', textContent: m.items.join(' · ') })),
    roundBtn('trash', 'Remove meal', async () => { await db.del('meals', m.id); renderCalendar(); })),
})));
async function renderShopCard() {
  const l = await db.get('lists', 'current');
  const card = $('#shop-card');
  if (!l) { card.hidden = true; return; }
  const items = aggregate(l);
  const left = items.filter(i => !l.checked[i.key]).length;
  card.hidden = !left;
  fill(card,
    h('span', { className: 'emoji-badge', textContent: '🛒' }),
    h('div', { className: 't' }, h('strong', { textContent: `${plural(left, 'item')} to buy` }),
      h('span', { textContent: items.filter(i => !l.checked[i.key]).slice(0, 5).map(i => i.name).join(' · ') })),
    roundBtn('next', 'Open shopping list', () => openUs('shopping'), 'tint'));
}
renderers.push(renderShopping, renderShopCard);
