// Offline cache for the app shell. User data lives in IndexedDB, not here.
const CACHE = 'twofold-v5';
// The page is cached as './' only: Cloudflare redirects /index.html to /, and iOS refuses
// to open a page whose cached response came through a redirect.
const SHELL = ['./', './styles.css', './i18n.js', './app.js', './chat.js', './stickers.js', './shopping.js', './pets.js', './catbreak.js', './sync.js', './manifest.webmanifest', './icon.svg', './fonts/bricolage-grotesque-latin.woff2', './fonts/inter-latin.woff2'];

// A response that came through a redirect can't be handed to a page navigation on iOS, so copy it.
const clean = res => res && res.redirected
  ? res.blob().then(body => new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers }))
  : res;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(url =>
    fetch(url, { cache: 'reload' }).then(clean).then(res => { if (res.ok) return c.put(url, res); })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).pathname.startsWith('/api/')) return;
  // Opening the app (also from the Home Screen or a share): fresh page when online, cached page when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then(clean).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put('./', res.clone()));
      return res;
    }).catch(() => caches.match('./')));
    return;
  }
  // The OCR engine (vendor/) is large, so it's cached the first time it's used rather than at install.
  if (new URL(e.request.url).pathname.includes('/vendor/')) {
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)).then(clean));
});
