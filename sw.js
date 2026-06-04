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

var CACHE_VERSION = 'netsec-v114';
// Critical bootstrap files only — pre-caching the full shell on install
// fires 25 parallel fetches that saturate mobile bandwidth and starve
// the Supabase queries that follow. Everything else now caches on demand
// (stale-while-revalidate) as it's actually requested.
var SHELL = [
  '/manifest.webmanifest',
  '/favicon.ico',
  '/favicon-96x96.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/logo.jpg'
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
  // v114: skipWaiting() removed from install. The worker now stays in the
  // 'waiting' state until the page postMessages SKIP_WAITING (triggered by
  // the user clicking the "Update" button in the header). Previously the
  // silent auto-activation could yank the page out from under a user
  // mid-form, losing unsaved input.
});

// v114: explicit handoff so the user controls when the update lands.
self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
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

  // Content files under /data/ change between deploys without code changes
  // (team.json roster edits, role corrections, product list updates). Stale-
  // while-revalidate would serve last-deploy's JSON for one cycle after an
  // edit, which is jarring for a content-driven module. Skip the SW for
  // these so the browser always hits the network for the latest copy.
  if (sameOrigin && url.pathname.indexOf('/data/') === 0) return;

  // ── Navigations (HTML documents): NETWORK-FIRST ──
  // Every online PWA launch pulls a fresh /index.html so the user sees new
  // deploys immediately. Only when the network is down do we fall back to
  // the cached copy. Without this, iOS PWA standalone gets pinned to a
  // stale HTML even after the SW updates underneath it.
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req).then(function(resp) {
        if (resp && resp.ok) {
          var copy = resp.clone();
          caches.open(CACHE_VERSION).then(function(c){ c.put(req, copy).catch(function(){}); });
        }
        return resp;
      }).catch(function() {
        return caches.match(req).then(function(c){ return c || caches.match('/index.html'); });
      })
    );
    return;
  }

  // ── Same-origin static assets (JS/CSS/images): STALE-WHILE-REVALIDATE ──
  // Serves the cached copy instantly for fast paint while a background
  // fetch refreshes the cache. Pairs with the network-first HTML above:
  // the fresh HTML may briefly load with one-deploy-old JS, but the page
  // reload triggered by the controllerchange listener fixes that.
  if (sameOrigin) {
    e.respondWith(
      caches.open(CACHE_VERSION).then(function(cache) {
        return cache.match(req).then(function(cached) {
          var network = fetch(req).then(function(resp) {
            if (resp && resp.ok && resp.type === 'basic') {
              cache.put(req, resp.clone()).catch(function(){});
            }
            return resp;
          }).catch(function() {
            return cached || new Response('', { status: 504, statusText: 'offline' });
          });
          return cached || network;
        });
      })
    );
    return;
  }

  // ── Cross-origin (CDN libs): NETWORK-FIRST, cache fallback ──
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
