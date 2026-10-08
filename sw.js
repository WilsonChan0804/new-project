// Service worker：令 App 冇網都開到。
// 改咗 App 檔案之後將 VERSION 加一，手機先會攞新版。
const VERSION = 'trip-planner-v9';
const FONT_CACHE = 'trip-planner-fonts';
const ASSETS = ['./', './index.html', './app.js', './trip-data.js', './styles.css', './manifest.webmanifest', './icon.svg', './icon-180.png', './vendor/xlsx.full.min.js', './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css'];

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

  if (url.origin !== self.location.origin) return;

  // 自己嘅檔案：先用 cache（即開），背景再更新
  e.respondWith(
    caches.open(VERSION).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true })
        || (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
      const network = fetch(req)
        .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })
  );
});
