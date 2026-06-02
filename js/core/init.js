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
var SW_REGISTRATION_URL = '/sw.js?v=105';

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

// Close the user-menu dropdown when the user taps anywhere outside it.
// The chip itself stops propagation in toggleUserMenu, so opening doesn't
// immediately fire this close.
function initUserMenuOutsideClose() {
  document.addEventListener('click', function(e) {
    var wrap = document.querySelector('.user-menu-wrap');
    if (!wrap || !wrap.classList.contains('open')) return;
    if (wrap.contains(e.target)) return;
    wrap.classList.remove('open');
  });
}

// Fallback touch handler for the hamburger menu. On iOS PWA, the inline
// onclick=toggleSidebar(true) can occasionally be eaten by the OS when
// the user is reaching toward the safe-area boundary; binding a
// touchstart listener fires earlier in the gesture and guarantees the
// sidebar opens. preventDefault stops the synthesized click that would
// otherwise also fire toggleSidebar (double-toggle).
function initHamburgerTouch() {
  var hb = document.querySelector('.hamburger');
  if (!hb) return;
  hb.addEventListener('touchstart', function(e) {
    e.preventDefault();
    if (typeof toggleSidebar === 'function') toggleSidebar(true);
  }, { passive: false });
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

// == PULL-TO-REFRESH (mobile only) =================================
// Drag down at the top of the page to refresh the current screen's
// data. Threshold ~ 80px of damped pull (real drag distance ~133px).
// Desktops never see the indicator (CSS @media min-width:769px).
//
// Screen → refresh-handler mapping is intentionally narrow: only the
// five "live data" screens listed in the spec respond to pull. Other
// screens (Log Session form, Inventory, KB, Certificates) don't have a
// natural "refresh this view's data" action, so we no-op.
function _ptrCurrentHandler() {
  var active = document.querySelector('.screen.active');
  if (!active) return null;
  switch (active.id) {
    case 'screen-dashboard':
      return (typeof renderDashboard === 'function') ? renderDashboard : null;
    case 'screen-tracker':
      return (typeof loadTracker === 'function') ? loadTracker : null;
    case 'screen-projects':
      // Only refresh on the My Sessions sub-tab (the live list). Other
      // sub-tabs (Log form, summaries) aren't list views worth pulling.
      var ussess = document.getElementById('pjtab-ussess');
      if (ussess && ussess.style.display !== 'none' && typeof renderUSSessions === 'function') {
        return renderUSSessions;
      }
      return null;
    case 'screen-leave':
      var hist = document.getElementById('ltab-history');
      if (hist && hist.style.display !== 'none' && typeof renderLeaveHistory === 'function') return renderLeaveHistory;
      var team = document.getElementById('ltab-team');
      if (team && team.style.display !== 'none' && typeof renderLeaveTeam === 'function') return renderLeaveTeam;
      return null;
    case 'screen-approvals':
      var ot = document.getElementById('apptab-ot');
      if (ot && ot.style.display !== 'none' && typeof renderOTApprovals === 'function') return renderOTApprovals;
      if (typeof renderLeaveApprovals === 'function') return renderLeaveApprovals;
      return null;
    default:
      return null;
  }
}

function initPullToRefresh() {
  // Bail on non-touch devices so we don't waste listener slots
  if (!('ontouchstart' in window) && !(navigator.maxTouchPoints > 0)) return;

  var ind = document.createElement('div');
  ind.className = 'ptr-indicator';
  ind.innerHTML =
    '<svg class="ptr-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>' +
    '<svg class="ptr-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9" stroke-opacity=".25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>';
  document.body.appendChild(ind);

  var THRESHOLD = 80;     // px of damped travel required to trigger
  var MAX_VISUAL = 120;   // cap so the indicator doesn't fly off
  var startY = 0, dy = 0;
  var pulling = false, armed = false, refreshing = false;

  function reset(animate) {
    ind.classList.remove('ptr-ready');
    ind.style.transition = animate === false ? 'none' : '';
    ind.style.transform = 'translate(-50%, -60px)';
    ind.style.opacity = 0;
    armed = false;
  }

  document.addEventListener('touchstart', function(e) {
    if (refreshing) return;
    if (window.scrollY > 5) return;
    if (e.touches.length !== 1) return;
    if (!_ptrCurrentHandler()) return;
    startY = e.touches[0].clientY;
    dy = 0;
    pulling = true;
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!pulling || refreshing) return;
    dy = e.touches[0].clientY - startY;
    if (dy <= 0) {
      pulling = false;
      reset(true);
      return;
    }
    // Damp the visual pull so it feels rubbery — real-finger 133px maps
    // to threshold; further travel still nudges the indicator but slowly.
    var visual = Math.min(dy * 0.6, MAX_VISUAL);
    ind.style.transition = 'none';
    ind.style.transform = 'translate(-50%, ' + (visual - 50) + 'px)';
    ind.style.opacity = Math.min(visual / THRESHOLD, 1);
    armed = visual >= THRESHOLD;
    ind.classList.toggle('ptr-ready', armed);
  }, { passive: true });

  document.addEventListener('touchend', function() {
    if (!pulling) return;
    pulling = false;
    if (!armed) { reset(true); return; }
    // Snap to "refreshing" position (~50px), spin the icon, fire the handler
    refreshing = true;
    ind.classList.add('ptr-refreshing');
    ind.style.transition = '';
    ind.style.transform = 'translate(-50%, 26px)';
    ind.style.opacity = 1;
    var handler = _ptrCurrentHandler();
    var done = function() {
      refreshing = false;
      ind.classList.remove('ptr-refreshing');
      reset(true);
    };
    try {
      Promise.resolve(handler ? handler() : null).then(done, done);
    } catch (e) { done(); }
  });
}

// Passive auth check on tab refocus. Catches the "came back from coffee"
// case where the session died while the tab was backgrounded — surfacing
// the modal proactively before the user clicks anything that would otherwise
// fail with the cryptic RLS error. Only fires when the app *thinks* a user
// is signed in (currentUser populated); avoids false positives on the login
// screen. Throttled to once every 30s so rapid tab-switching doesn't hammer
// getSession().
var _lastFocusAuthCheck = 0;
function initFocusAuthCheck() {
  window.addEventListener('focus', async function() {
    if (!currentUser) return;
    if (Date.now() - _lastFocusAuthCheck < 30000) return;
    _lastFocusAuthCheck = Date.now();
    if (typeof ensureAuthValid !== 'function') return;
    var res = await ensureAuthValid();
    if (!res.valid && currentUser) {
      showSessionExpiredModal();
    }
  });
}

// == INIT ==========================================================
window.onload = async function() {
  initServiceWorker();
  initLoginBgVideo();
  renderIcons();
  initSidebarEdgeScroll();
  initHamburgerTouch();
  initUserMenuOutsideClose();
  initPullToRefresh();
  initFocusAuthCheck();
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

  // Hash-routed Team Portfolio (v83). /#team is the one app route that
  // works without authentication. We special-case it here so a public
  // visitor lands directly on the team module instead of being bounced
  // to the login screen. The hashchange listener below handles tab
  // navigation within the team module once the page is open.
  const isTeamRoute = hash.startsWith('#/team');

  if (data && data.session && data.session.user) {
    await initAppFromUser(data.session.user);
    if (isTeamRoute && typeof renderTeamScreen === 'function') {
      // Authenticated user deep-linked into /#team — render in internal mode.
      if (typeof TEAM_PUBLIC_MODE !== 'undefined') TEAM_PUBLIC_MODE = false;
      renderTeamScreen();
    }
    return;
  }
  // No active session. If the visitor is here for the public team page,
  // skip the login screen and render the team module in public mode.
  if (isTeamRoute && typeof renderTeamScreen === 'function') {
    showPublicTeamMode();
    return;
  }
  // Default: show sign-in form
  showSigninForm();
};

// Listen for hash changes WITHIN the team route so tab clicks (and direct
// hash edits) re-render without a full reload. Other hash changes are
// ignored — the rest of the app uses showScreen() not URL hashes.
window.addEventListener('hashchange', function() {
  var h = window.location.hash || '';
  if (!h.startsWith('#/team')) return;
  if (typeof renderTeamScreen === 'function') renderTeamScreen();
});

// Public-mode layout for /#team. The app shell, sidebar and login screen
// all stay hidden; only the team screen is shown, full-width. Used by
// unauthenticated visitors who landed on the route directly. The "Sign
// in" link inside the team header lets them switch into the normal
// login flow when they want internal access.
function showPublicTeamMode() {
  if (typeof TEAM_PUBLIC_MODE !== 'undefined') TEAM_PUBLIC_MODE = true;
  document.getElementById('login-screen').style.display = 'none';
  var app = document.getElementById('app');
  if (app) {
    app.style.display = 'block';
    app.classList.add('public-team-mode');
  }
  // Hide the sidebar in public mode — there's nothing else to navigate to.
  var sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.style.display = 'none';
  var hamb = document.querySelector('.hamburger');
  if (hamb) hamb.style.display = 'none';
  // Show only the team screen. Other screens stay display:none from their
  // default (only screen-dashboard has .active and that's still hidden via
  // the parent app's special class).
  Array.prototype.forEach.call(document.querySelectorAll('.screen'), function(s){
    s.classList.remove('active');
    s.style.display = 'none';
  });
  var teamScreen = document.getElementById('screen-team');
  if (teamScreen) {
    teamScreen.classList.add('active');
    teamScreen.style.display = 'block';
  }
  if (typeof renderTeamScreen === 'function') renderTeamScreen();
}
