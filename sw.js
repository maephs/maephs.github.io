// ── Service Worker — Basketball Rotation Planner ─────────────────────────────
// AUTO_VERSION is replaced by the GitHub Actions deploy workflow on every push.
// Changing it busts the cache and triggers the update notification banner.
const CACHE_VERSION = 'AUTO_VERSION';
const CACHE_NAME    = 'rotation-planner-' + CACHE_VERSION;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
  './teams.json',
  './fixtures.json',
];

// ── Install: pre-cache app shell ─────────────────────────────────────────────
// skipWaiting() is NOT called here — we wait for the page to confirm the
// update before activating, so we can show the "Update available" banner first.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // addAll with individual error handling so a missing optional file
        // (e.g. fixtures.json not yet generated) doesn't block the install
        return Promise.allSettled(
          APP_SHELL.map(url => cache.add(url).catch(() => {}))
        );
      })
  );
});

// ── Activate: delete old caches ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Message: allow page to trigger skipWaiting ───────────────────────────────
// When the user taps "Update", the page sends this message and we activate.
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ── Fetch: cache-first for app shell, network-first for fonts ────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Google Fonts — network first, fall back to cache
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // App shell — cache first, fall back to network then cache unconditionally
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request)
        .then(response => {
          if (url.origin === self.location.origin && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
      )
  );
});
