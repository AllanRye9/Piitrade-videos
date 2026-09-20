// Minimal app-shell service worker. Deliberately narrow in scope:
// it exists to make the feed *open* on a flaky or offline connection
// (the target market is explicitly low/intermittent-bandwidth) and to
// make the app installable — not to cache video content, which is
// large, per-user, and constantly changing, and belongs to whatever
// caching strategy /uploads already has server-side (see index.ts's
// `maxAge: '7d', immutable`), not this service worker.

const CACHE_NAME = 'piitrade-shell-v1';
const SHELL_URLS = ['/', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept API calls or uploaded media — those need to hit
  // the network for correctness (fresh data) or are already
  // efficiently cached by the browser's HTTP cache via the server's
  // own Cache-Control headers.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached || caches.match('/'));
      // Stale-while-revalidate: serve the cached shell instantly if
      // we have one, refresh it in the background either way.
      return cached || network;
    })
  );
});
