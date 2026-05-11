// == PWA SERVICE WORKER ============================================
// Register the service worker and wire up its update lifecycle. iOS PWA
// standalone is the hardest case — without an explicit reload trigger
// it serves stale HTML for many launches after a deploy, even with
// skipWaiting + clients.claim in the worker. The pieces below force the
// browser to actually check for new versions on every launch and reload
// the page once the new SW takes control.
//
// SW_REGISTRATION_URL carries a ?v= cache-buster so a previously stuck
// HTTP-cached copy of /sw.js can't be served when this file ships. The
// version number tracks CACHE_VERSION inside sw.js. Bump them together.
var SW_REGISTRATION_URL = '/sw.js?v=10';

function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;

  // updateViaCache:'none' tells the browser to bypass the HTTP cache when
  // checking /sw.js for changes. Without this iOS can pin the SW script
  // itself in cache and never see new versions.
  var opts = { updateViaCache: 'none' };
  navigator.serviceWorker.register(SW_REGISTRATION_URL, opts).then(function(reg) {
    // Belt-and-braces: explicitly ask for an update on every page load.
    // Without this iOS PWA only re-checks on the browser's own schedule
    // (which can be rare), so a deployed v9 might never reach users.
    try { reg.update(); } catch (e) { /* update() can throw if SW gone */ }
  }).catch(function(err) {
    console.warn('SW registration failed:', err);
  });

  // The new SW activates → clients.claim() inside the worker makes it
  // controller of this page → controllerchange fires here → we reload
  // once so the running page tosses its old JS/HTML and picks up the
  // fresh shell. Guarded against reload loops; ignored on first install
  // (when there was no previous controller).
  var firstControllerSeen = !!navigator.serviceWorker.controller;
  var refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', function() {
    if (!firstControllerSeen) { firstControllerSeen = true; return; }
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

// == LOGIN BACKGROUND VIDEO ========================================
function initLoginBgVideo() {
  var v = document.getElementById('login-bg-video');
  if (!v) return;
  // Some browsers' autoplay policies need an explicit play() — even when
  // the video is already muted via the `muted` attribute.
  var p = v.play();
  if (p && p.catch) p.catch(function(){ /* autoplay blocked, video will sit on first frame */ });
}

// Render all <i data-lucide="..."> icons currently in the DOM.
function renderIcons() {
  if (window.lucide && typeof lucide.createIcons === 'function') {
    try { lucide.createIcons(); } catch(e) { /* lucide not ready yet */ }
  }
}

// Edge-hover auto-scroll on the sidebar. The native scrollbar is hidden;
// when the mouse hovers near the top or bottom edge of the sidebar,
// content scrolls in that direction at a speed proportional to how
// close the cursor is to the edge. Wheel + touch scroll still work.
function initSidebarEdgeScroll() {
  var sb = document.getElementById('sidebar');
  if (!sb) return;
  var ZONE = 70;       // px from top/bottom edge that triggers auto-scroll
  var MAX_PX_PER_FRAME = 14;
  var direction = 0;   // -1 up, 0 none, 1 down
  var speed = 0;
  var rafId = null;

  function step() {
    if (!direction) { rafId = null; return; }
    sb.scrollTop += direction * speed;
    rafId = requestAnimationFrame(step);
  }

  sb.addEventListener('mousemove', function(e) {
    // Only treat real mouse hovers (not synthesised touch events)
    if (e.pointerType === 'touch') return;
    var rect = sb.getBoundingClientRect();
    var y = e.clientY;
    var fromTop = y - rect.top;
    var fromBot = rect.bottom - y;
    if (fromTop < ZONE && sb.scrollTop > 0) {
      direction = -1;
      speed = MAX_PX_PER_FRAME * (1 - Math.max(fromTop, 0) / ZONE);
    } else if (fromBot < ZONE && sb.scrollTop + sb.clientHeight < sb.scrollHeight) {
      direction = 1;
      speed = MAX_PX_PER_FRAME * (1 - Math.max(fromBot, 0) / ZONE);
    } else {
      direction = 0;
      speed = 0;
    }
    if (direction && rafId == null) rafId = requestAnimationFrame(step);
  });

  sb.addEventListener('mouseleave', function(){
    direction = 0;
    speed = 0;
  });
}

// == INIT ==========================================================
window.onload = async function() {
  initServiceWorker();
  initLoginBgVideo();
  renderIcons();
  initSidebarEdgeScroll();
  // Supabase puts the link type in the URL hash:
  //   type=recovery            -> forgot-password reset link
  //   type=invite | type=signup -> invitation from manager (first-time login)
  // Both should land on the set-password form, not auto-sign-in.
  const hash = window.location.hash || '';
  const isRecovery = /type=recovery/.test(hash);
  const isInvite   = /type=invite|type=signup/.test(hash);
  const forcePasswordSetup = isRecovery || isInvite;

  sb.auth.onAuthStateChange(function(event){
    if (event === 'PASSWORD_RECOVERY') {
      document.getElementById('login-screen').style.display = 'flex';
      document.getElementById('app').style.display = 'none';
      showResetForm();
    }
  });

  // Restore existing session if present
  const {data} = await sb.auth.getSession();

  if (forcePasswordSetup) {
    // Invite or recovery link — force password setup before entering the app
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    var sub = document.getElementById('login-sub');
    if (isInvite && sub) sub.textContent = 'Welcome - set your password to finish setup';
    showResetForm();
    return;
  }

  if (data && data.session && data.session.user) {
    await initAppFromUser(data.session.user);
    return;
  }
  // No active session — show sign-in form
  showSigninForm();
};
