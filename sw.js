// NetSec Portal — Service Worker
// Strategy:
//   - Pre-cache the app shell (HTML, CSS, JS, icons) on install.
//   - Same-origin GETs: cache-first, fall back to network, opportunistically
//     cache new responses so navigation works offline once visited.
//   - Supabase API + auth calls: bypass the SW entirely (always live data).
//   - Third-party CDNs (Lucide, SheetJS, Supabase JS): network-first, fall
//     back to cache for offline resilience.
//
// Bump CACHE_VERSION whenever the shell changes meaningfully so old clients
// drop stale assets on activate.

var CACHE_VERSION = 'netsec-v1';
var SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-maskable.svg',
  '/css/styles.css',
  '/js/core/state.js',
  '/js/core/auth.js',
  '/js/core/helpers.js',
  '/js/core/navigation.js',
  '/js/core/init.js',
  '/js/features/overtime.js',
  '/js/features/leave.js',
  '/js/features/dashboard.js',
  '/js/features/editors.js',
  '/js/features/projects.js',
  '/js/features/unified-sessions.js',
  '/js/features/notifications.js',
  '/js/features/inventory.js',
  '/js/features/approvals.js',
  '/js/features/knowledge-base.js',
  '/js/features/tracker.js'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      // addAll fails the whole install if any single resource 404s, so use
      // individual puts that tolerate misses (e.g. a renamed JS file).
      return Promise.all(SHELL.map(function(url) {
        return fetch(url, { cache: 'reload' }).then(function(resp) {
          if (resp && resp.ok) return cache.put(url, resp);
        }).catch(function() { /* skip on miss */ });
      }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE_VERSION; })
        .map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Never intercept Supabase API or auth — always network.
  if (url.hostname.indexOf('supabase.co') !== -1) return;

  var sameOrigin = (url.origin === self.location.origin);

  if (sameOrigin) {
    // Cache-first for shell. Falls back to index.html for navigations
    // (e.g. a deep-linked URL that wasn't precached) so the SPA still loads.
    e.respondWith(
      caches.match(req).then(function(cached) {
        if (cached) return cached;
        return fetch(req).then(function(resp) {
          if (resp && resp.ok && resp.type === 'basic') {
            var copy = resp.clone();
            caches.open(CACHE_VERSION).then(function(c) { c.put(req, copy); });
          }
          return resp;
        }).catch(function() {
          if (req.mode === 'navigate') return caches.match('/index.html');
          return new Response('', { status: 504, statusText: 'offline' });
        });
      })
    );
    return;
  }

  // Cross-origin (CDN libs): network-first, cache fallback. Fresh CDN payloads
  // overwrite the cache so version bumps reach users on next online load.
  e.respondWith(
    fetch(req).then(function(resp) {
      if (resp && resp.ok) {
        var copy = resp.clone();
        caches.open(CACHE_VERSION).then(function(c) { c.put(req, copy); }).catch(function(){});
      }
      return resp;
    }).catch(function() {
      return caches.match(req).then(function(cached) {
        return cached || new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});
