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

var CACHE_VERSION = 'netsec-v4';
// Critical bootstrap files only — pre-caching the full shell on install
// fires 25 parallel fetches that saturate mobile bandwidth and starve
// the Supabase queries that follow. Everything else now caches on demand
// (stale-while-revalidate) as it's actually requested.
var SHELL = [
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon.svg'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
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
    // Stale-while-revalidate for shell. Serves the cached copy immediately
    // (instant load) while fetching a fresh copy in the background and
    // updating the cache, so CSS/JS changes propagate without needing a
    // CACHE_VERSION bump on every deploy.
    e.respondWith(
      caches.open(CACHE_VERSION).then(function(cache) {
        return cache.match(req).then(function(cached) {
          var network = fetch(req).then(function(resp) {
            if (resp && resp.ok && resp.type === 'basic') {
              cache.put(req, resp.clone()).catch(function(){});
            }
            return resp;
          }).catch(function() {
            if (req.mode === 'navigate') return cache.match('/index.html');
            return cached || new Response('', { status: 504, statusText: 'offline' });
          });
          // Return cached immediately if we have it; otherwise wait for network.
          return cached || network;
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
