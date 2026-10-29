// RideRecord Service Worker – network-first with offline shell caching.
// User records live in IndexedDB, not here. This just ensures the app shell opens without a network.
const CACHE = 'riderecord-shell-v2';

// Pre-cache the app shell on install
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll([
        './',
        './index.html',
        './manifest.json',
        './icon-192.png',
        './icon-512.png',
        './apple-touch-icon.png',
      ]).catch(() => { /* best-effort: some assets may not exist yet during dev */ })
    ).then(() => self.skipWaiting())
  );
});

// Clean up old caches on activate
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first strategy for same-origin GET requests
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  
  e.respondWith(
    fetch(req)
      .then(res => {
        // Cache successful responses
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      })
      .catch(() =>
        // Offline: try cache, fall back to app shell
        caches.match(req).then(r => r || caches.match('./index.html'))
      )
  );
});
