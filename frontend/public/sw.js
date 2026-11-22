// Minimal app-shell service worker. Deliberately narrow in scope:
// it exists to make the feed *open* on a flaky or offline connection
// (the target market is explicitly low/intermittent-bandwidth) and to
// make the app installable — not to cache video content, which is
// large, per-user, and constantly changing, and belongs to whatever
// caching strategy /uploads already has server-side (see index.ts's
// `maxAge: '7d', immutable`), not this service worker.

const CACHE_NAME = 'piitrade-shell-v3';
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
  const request = event.request;
  const url = new URL(request.url);

  // This worker only ever handles the app shell: same-origin GETs.
  //  - Cross-origin requests (R2 video/poster files on r2.dev or a media
  //    domain, fonts, analytics…) are left to the browser. Re-fetching
  //    them from here turned plain media loads into CORS-checked fetches
  //    that the bucket doesn't answer, and broke playback.
  //  - Range requests (how <video> streams) get 206 partial responses,
  //    which the Cache API refuses to store — and must reach the network
  //    untouched anyway.
  //  - API calls and /uploads media always need the network.
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (request.headers.has('range')) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          // Only complete, successful, same-origin responses are cacheable.
          if (response.ok && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, clone))
              .catch(() => {});
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
