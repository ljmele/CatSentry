// Marie Sentry Service Worker
const APP_SHELL_CACHE = "catsentry-shell-v3.1";
const DATA_CACHE = "catsentry-data-v3.1";
const OFFLINE_URL = "./offline.html";

const APP_SHELL_URLS = [
  "./",
  "./index.html",
  "./offline.html",
  "./css/main.css",
  "./js/weather.js",
  "./js/analytics.js",
  "./js/storage.js",
  "./js/app.js",
  "./js/ble.js",
  "./js/ui.js",
  "./js/predictions.js",
  "./js/insights.js",
  "./manifest.json",
  "./tests/test.html",
  "images/marie/avatar-192.jpg",
  "images/marie/avatar-512.jpg",
  "images/marie/hero.png",
  "https://cdn.jsdelivr.net/npm/chart.js"
];

function isApiRequest(url) {
  return url.hostname.includes("open-meteo.com") || url.hostname.includes("api.github.com");
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response.ok && request.method === "GET") {
    const cache = await caches.open(APP_SHELL_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstForApi(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    return new Response("{}", {
      headers: { "Content-Type": "application/json" },
      status: 503
    });
  }
}

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== APP_SHELL_CACHE && key !== DATA_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);

  if (isApiRequest(url)) {
    event.respondWith(networkFirstForApi(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(APP_SHELL_CACHE).then(cache => cache.put("./index.html", clone));
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(event.request);
          if (cachedPage) return cachedPage;
          return caches.match(OFFLINE_URL);
        })
    );
    return;
  }

  event.respondWith(cacheFirst(event.request));
});
