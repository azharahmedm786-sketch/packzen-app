/* ============================================
   PackZen Service Worker
   Offline support + smart caching strategy
   ============================================ */

// 🔒 PERMANENT FIX: bumped v4 -> v5 so every previously-installed
// service worker evicts its old cache on next activate (see the
// 'activate' handler below, which deletes any cache whose name
// doesn't match the CURRENT STATIC_CACHE/DYNAMIC_CACHE). Without this
// bump, browsers that already cached a broken index.html/script.js
// under v4 would keep serving that stale copy forever, regardless of
// what gets deployed — which is almost certainly why the same auth
// bug kept reappearing through multiple rounds of fixes.
const CACHE_VERSION = 'packzen-v5';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;

// Core assets cached on install (app shell).
// 🔒 PERMANENT FIX: '/index.html' and '/script.js' (and the other
// frequently-updated app files) were REMOVED from this list. They used
// to get cache-first treatment via the STATIC_ASSETS check in the
// fetch handler below, which runs BEFORE the "network first" HTML
// branch — meaning navigations to '/' and '/index.html' were being
// served from a permanently pinned cache, never re-fetched from
// network, no matter how many times the live site was updated. Only
// assets that are genuinely safe to pin forever (logos, manifest
// files, the offline fallback page) belong in this list now.
// index.html now falls through to the networkFirstHTML() branch
// further down (always fetches fresh, only falls back to cache if
// offline). script.js/style.css/etc. now fall through to
// staleWhileRevalidate() at the bottom (serves cache instantly if
// present, but ALWAYS also fetches network in the background and
// updates the cache for next time — self-healing instead of
// permanently stuck).
const STATIC_ASSETS = [
  '/Offline.html',
  '/manifest.json',
  '/driver-manifest.json',
  '/assets/logo/packzen-logo.png',
  '/assets/logo/packzen-og.png',
  '/assets/logo/newllogo1.png',
  '/assets/logo/newllogo.png',
  '/assets/logo/icon-192.png',
  '/assets/logo/icon-512-maskable.png',
];
// NOTE: firebase-config.js and env-config.js are deliberately NOT
// precached here. firebase.json already serves env-config.js with
// no-cache headers, and firebase-config.js reads window.ENV at parse
// time — precaching either risks the SW serving stale config after a
// key rotation. They're still fetched fine via the default
// stale-while-revalidate path below on every load.
const OFFLINE_PAGE = '/Offline.html';

// ── Install: cache static shell ──────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('SW: Some assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('packzen-') && key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: smart cache strategy ──────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and third-party API calls (Firebase, Maps, Razorpay)
  if (request.method !== 'GET') return;
  if (url.hostname.includes('firebaseio.com')) return;
  if (url.hostname.includes('googleapis.com') && url.pathname.includes('/maps/api/')) return;
  if (url.hostname.includes('checkout.razorpay.com')) return;

  // Google Fonts — cache first
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Static assets — cache first
  if (STATIC_ASSETS.some(asset => request.url.includes(asset))) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // HTML pages — network first, fall back to cache, then offline page
  if (request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(networkFirstHTML(request));
    return;
  }

  // Everything else — stale while revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// ── Cache strategies ──────────────────────────────

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirstHTML(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_PAGE);
    return offline || new Response('<h1>You are offline</h1>', {
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache  = await caches.open(DYNAMIC_CACHE);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || await fetchPromise || new Response('Offline', { status: 503 });
}
