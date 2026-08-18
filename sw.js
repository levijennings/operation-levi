// Levi's Projects — service worker (Aug 2026).
// Previously registered but missing from the repo, so registration 404'd on
// every load and the PWA had no offline behavior. This version:
//   - precaches the app shell + icons on install
//   - network-first for navigations and same-origin GETs (fresh app, cached fallback)
//   - never touches /api/* or cross-origin requests
//   - carries a push handler so web-push briefs can ship next (needs VAPID setup)
var CACHE = 'lp-shell-v1';
var SHELL = ['/', '/index.html', '/manifest.json', '/favicon.svg', '/favicon.png', '/icon192.png', '/icon512.png', '/apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;           // CDN/fonts/Supabase: browser default
  if (url.pathname.indexOf('/api/') === 0) return;           // never cache API calls
  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        return hit || (e.request.mode === 'navigate' ? caches.match('/index.html') : Response.error());
      });
    })
  );
});

// Web-push scaffold: fires when a push subscription + VAPID keys are configured
// (the daily-brief pipeline in the next phase). Safe no-op until then.
self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil(self.registration.showNotification(data.title || "Levi's Projects", {
    body: data.body || 'Wingman has something for you.',
    icon: '/icon192.png', badge: '/icon192.png', data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ('focus' in list[i]) { list[i].navigate(url); return list[i].focus(); } }
    return clients.openWindow(url);
  }));
});
