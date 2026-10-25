// Offline cache for the app shell. User data lives in IndexedDB, not here.
const CACHE = 'twofold-v3';
const SHELL = ['./', './index.html', './styles.css', './i18n.js', './app.js', './chat.js', './stickers.js', './shopping.js', './pets.js', './catbreak.js', './manifest.webmanifest', './icon.svg', './fonts/bricolage-grotesque-latin.woff2', './fonts/inter-latin.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // The OCR engine (vendor/) is large, so it's cached the first time it's used rather than at install.
  if (new URL(e.request.url).pathname.includes('/vendor/')) {
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
