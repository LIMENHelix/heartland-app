/* Offline support for the patient app.

   NETWORK FIRST for the app's own files. The previous cache-first version kept
   serving a stale stylesheet and stale JavaScript after a deploy, so shipped
   changes appeared not to have shipped at all. What the patient sees being
   correct matters more than shaving milliseconds, and the cache is still there
   as a fallback when the phone is offline. */

var CACHE = "heartland-v16";

var SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "img/mark.png",
  "img/backdrop.webp",
  "img/hero-900.webp",
  "img/hero-1600.webp"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* ==========================================================================
   Push. The payload is deliberately vague: a lock screen is not a private
   place, so nothing about treatment travels in the notification itself.
   ========================================================================== */

self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }

  var options = {
    body: data.body || "A message from your care team",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: data.tag || "hmh",
    renotify: false,
    data: { url: data.url || "/app/" }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "Heartland", options).then(function () {
      return self.clients.matchAll({ type: "window", includeUncontrolled: true })
        .then(function (list) { list.forEach(function (c) { c.postMessage({ type: "refresh" }); }); });
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || "/app/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.indexOf("/app/") !== -1 && "focus" in c) {
          c.postMessage({ type: "refresh" });
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

/* ==========================================================================
   Fetch
   ========================================================================== */

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);

  // Patient data is never cached.
  if (url.pathname.indexOf("/api/") === 0) return;

  // Fonts change rarely and are expensive: cache first, refresh behind.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(
      caches.open(CACHE).then(function (c) {
        return c.match(req).then(function (hit) {
          var net = fetch(req).then(function (res) {
            if (res && res.status === 200) c.put(req, res.clone());
            return res;
          }).catch(function () { return hit; });
          return hit || net;
        });
      })
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // Everything else: go to the network, fall back to cache only when offline.
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === "basic") {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || (req.mode === "navigate" ? caches.match("index.html") : undefined);
      });
    })
  );
});
