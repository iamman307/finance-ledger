/* 家計帳簿 1.13.0 — app shell cache only; ledger data is never cached by the service worker. */
const CACHE = 'finance-ledger-1.13.0';
const ASSETS = ['./', './index.html', './engine.js?v=1.13.0', './store.js?v=1.13.0', './app.js?v=1.13.0', './manifest.webmanifest', './icon.svg', './icon-192.png', './jsQR.js?v=1.13.0'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('finance-ledger-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // GitHub API, fonts, CDN: straight to network
  if (req.mode === 'navigate') { e.respondWith(fetch(req).catch(() => caches.match('./index.html'))); return; }
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
