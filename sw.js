// Service worker：令 App 冇網都開到。
// 改咗 App 檔案之後將 VERSION 加一，手機先會攞新版。
const VERSION = 'trip-planner-v15';
const FONT_CACHE = 'trip-planner-fonts';
const ASSETS = ['./', './index.html', './app.js', './trip-data.js', './readings.js', './styles.css', './kappa.css', './kappa.js', './manifest.webmanifest', './icon.svg', './icon-180.png', './vendor/xlsx.full.min.js', './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== FONT_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts：用過一次就存起，離線照用
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONT_CACHE).then(async cache => {
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      } catch {
        return new Response('', { status: 504 });
      }
    }));
    return;
  }

  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  // 圖示、vendor：先用 cache
  if (/\/vendor\/|\.png$/.test(url.pathname)) {
    e.respondWith(caches.open(VERSION).then(async cache => (await cache.match(req, { ignoreSearch: true })) || fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; })));
    return;
  }
  // App 檔案：有網就攞最新（4 秒內），冇網／太慢就用 cache —— 改完 App 手機即刻見到
  e.respondWith(caches.open(VERSION).then(async cache => {
    const cached = () => cache.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? cache.match('./index.html') : undefined));
    const net = fetch(req, { cache: 'no-cache' }).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
    const timeout = new Promise(res => setTimeout(res, 4000));
    try {
      const r = await Promise.race([net, timeout]);
      if (r) return r;
    } catch { /* 離線 */ }
    return (await cached()) || net.catch(() => new Response('離線', { status: 504 }));
  }));
});
