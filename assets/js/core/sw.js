// Service Worker boilerplate to handle asset caching and versioning
const CACHE_NAME = 'analyser-v' + 191; // <<< UPDATED VERSION HERE
const VERSION = 191; // Manually bumped from app.js/COMMIT_COUNT

self.addEventListener('install', event => {
  console.log('[Service Worker] Installing cache:', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll([
        '/',
        '/index.html',
        '/assets/css/analyser.css',
        '/assets/js/core/app.js',
        '/assets/js/core/formats.js',
        // Add other critical static assets here
      ]))
  );
});

self.addEventListener('activate', event => {
  console.log('[Service Worker] Activating new cache:', CACHE_NAME);
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.open(cacheWhitelist)
      .then(cache => cache.delete(CACHE_NAME + '')) // Clear old caches
  );
});

self.addEventListener('fetch', event => {
  // Simple cache-first strategy for all requests
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
