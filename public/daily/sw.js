/* Heartland Daily. Network first, same reasoning as the patient app: a stale
   file that looks fine is worse than a slow one that is right. */
var CACHE = "hmh-daily-v1";
var SHELL = ["./", "index.html", "styles.css", "daily.js", "manifest.webmanifest",
             "icons/icon-192.png", "img/mark.png", "img/backdrop.webp"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })
    .then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (k) {
    return Promise.all(k.map(function (x) { return x === CACHE ? null : caches.delete(x); }));
  }).then(function () { return self.clients.claim(); }));
});

/* Nothing clinical ever reaches this app, so unlike the patient one the
   notification can say exactly what it is. */
self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  e.waitUntil(self.registration.showNotification(d.title || "Heartland", {
    body: d.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png",
    tag: d.tag || "hmh-daily", renotify: false, data: { url: d.url || "/daily/" }
  }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || "/daily/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (l) {
    for (var i = 0; i < l.length; i++) {
      if (l[i].url.indexOf("/daily/") !== -1 && "focus" in l[i]) return l[i].focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var u = new URL(req.url);
  if (u.pathname.indexOf("/api/") === 0) return;
  if (u.origin !== location.origin) return;
  e.respondWith(fetch(req).then(function (r) {
    if (r && r.status === 200 && r.type === "basic") {
      var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return r;
  }).catch(function () {
    return caches.match(req).then(function (h) {
      return h || (req.mode === "navigate" ? caches.match("index.html") : undefined);
    });
  }));
});
