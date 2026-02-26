// Marie Sentry Service Worker 
const CACHE_NAME = 'catsentry-v2.1';

// Files to cache for offline use
const PRECACHE_URLS = [
  './',
  './index.html',
  './js/analytics.js',
  './js/storage.js',
  './manifest.json',
  'images/marie/avatar-192.jpg',
  'images/marie/avatar-512.jpg',
  'images/marie/hero.png',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// Install: pre-cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for API calls, cache-first for static assets
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Weather API calls: network-only (don't cache dynamic data)
  if (url.hostname.includes('open-meteo.com') || url.hostname.includes('api.github.com')) {
    event.respondWith(
      fetch(event.request).catch(() => new Response('{}', { 
        headers: { 'Content-Type': 'application/json' } 
      }))
    );
    return;
  }

  // Static assets: cache-first, fallback to network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // Return cache hit, but also update cache in background
        const fetchPromise = fetch(event.request).then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response));
          }
          return response.clone();
        }).catch(() => {});
        
        return cached;
      }

      // Not in cache: fetch from network and cache it
      return fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return response;
      });
    })
  );
});
