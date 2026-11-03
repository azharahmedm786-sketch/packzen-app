/* PackZen service worker — kept deliberately simple so customers never see stale pages.
 * Pages: always fetched from the network; if the phone is offline, the offline page is shown.
 * Nothing else is cached (prices, bookings and payments always come live from the server). */
const OFFLINE_URL = "/Offline.html";
const CACHE = "pz-offline-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(OFFLINE_URL, { cache: "reload" }))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;            // only page loads; everything else goes straight to the network
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE_URL)));
});
