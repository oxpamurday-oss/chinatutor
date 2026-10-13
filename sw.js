// Offline cache. Bump VERSION when any file changes so phones pick up the update.
var VERSION = "v3";
var FILES = ["./", "index.html", "style.css", "data.js", "app.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png",
  "vendor/hanzi-writer.min.js", "strokes.json"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  // Cache first; anything fetched later (such as extra stroke files) is kept for offline use.
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
    return hit || fetch(e.request).then(function (resp) {
      if (resp.ok && new URL(e.request.url).origin === location.origin) {
        var copy = resp.clone();
        caches.open(VERSION).then(function (c) { c.put(e.request, copy); });
      }
      return resp;
    });
  }));
});
