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
var SW_REGISTRATION_URL = '/sw.js?v=140';

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

    // v114: an SW may already be waiting from a previous visit — surface
    // the icon right away in that case.
    if (reg.waiting && navigator.serviceWorker.controller) {
      showUpdateIcon();
    }
    // Otherwise, watch for one installing now. 'installed' + existing
    // controller = this is an UPDATE (not first install); only then do
    // we prompt the user.
    reg.addEventListener('updatefound', function() {
      var nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', function() {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateIcon();
        }
      });
    });

    // v116: keep long-lived tabs current. Without these, reg.update() only
    // ran once at page load, so users who left the tab open all day never
    // saw the Update pill and had to close + reopen to discover deploys.
    //
    // (a) Periodic check every 5 min. Cheap — /sw.js?v=N is small and
    //     returns 304 when unchanged.
    // (b) When the tab regains visibility (user switches back to it),
    //     trigger an immediate check so they see the pill within seconds
    //     of focusing the tab.
    var SW_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
    setInterval(function() {
      try { reg.update(); } catch (e) { /* update() can throw if SW gone */ }
    }, SW_UPDATE_INTERVAL_MS);
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') {
        try { reg.update(); } catch (e) { /* ignore */ }
      }
    });
  }).catch(function(err) {
    console.warn('SW registration failed:', err);
  });

  // The new SW activates → clients.claim() inside the worker makes it
  // controller of this page → controllerchange fires here → we reload
  // once so the running page tosses its old JS/HTML and picks up the
  // fresh shell. Guarded against reload loops; ignored on first install
  // (when there was no previous controller).
  // v114: with skipWaiting() removed from install, this only fires AFTER
  // the user clicks the Update button (which postMessages SKIP_WAITING).
  var firstControllerSeen = !!navigator.serviceWorker.controller;
  var refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', function() {
    if (!firstControllerSeen) { firstControllerSeen = true; return; }
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

// v114: header pill — hidden by default, revealed by showUpdateIcon() once
// a new SW reaches 'installed'. Clicking the pill calls applyUpdate(),
// which postMessages SKIP_WAITING to the waiting worker → activate →
// controllerchange → reload onto the new version.
function showUpdateIcon() {
  var b = document.getElementById('update-available-btn');
  if (b) b.style.display = 'inline-flex';
}

function applyUpdate() {
  navigator.serviceWorker.getRegistration().then(function(reg) {
    if (reg && reg.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      // Edge case: button clicked but the waiting worker is gone (e.g. it
      // already activated in another tab). Hard reload to pick up whatever
      // is current.
      window.location.reload();
    }
  });
  // v121: the visible "Updating…" affordance now lives on the modal's
  // "Update now" button (set inside _renderUpdateModal). Still update the
  // pill text as a fallback for the empty-notes / direct-apply path.
  var b = document.getElementById('update-available-btn');
  if (b) {
    b.textContent = 'Updating…';
    b.disabled = true;
    b.style.cursor = 'default';
  }
}

// v121: parse a version-ish string into a comparable integer. Accepts the
// canonical 'vNNN', the Sentry 'netsec-portal@vNNN', or the SW URL '?v=NNN'.
// Returns 0 on no match — items without a version field cleanly fall out
// of the update modal's "newer than current" filter.
function _verNum(v) {
  var m = String(v||'').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// v121: pill click handler. Fetches whats-new.json fresh (no-store — the
// SW already bypasses /data/ but the explicit hint makes intent obvious),
// filters items whose version is strictly greater than the running version,
// and renders the modal. Empty list → skip the modal and apply directly so
// test-only synced-trio bumps don't impose ceremony on users.
async function showUpdateNotes() {
  var current = _verNum(SW_REGISTRATION_URL);
  var items = [];
  try {
    var resp = await fetch('data/whats-new.json', { cache: 'no-store' });
    var all  = await resp.json();
    var pool = (all && Array.isArray(all.items)) ? all.items : [];
    items = pool
      .filter(function(it){ return it.version && _verNum(it.version) > current; })
      .sort(function(a,b){ return _verNum(b.version) - _verNum(a.version); });
  } catch (e) {
    items = [];
  }
  if (!items.length) { applyUpdate(); return; }

  // Cap to the most recent 5 distinct versions to keep the modal short
  // when a user has been offline across many ships. Sorted desc already.
  var versionsSeen = [];
  items.forEach(function(it){
    var v = _verNum(it.version);
    if (versionsSeen.indexOf(v) === -1) versionsSeen.push(v);
  });
  var keep = versionsSeen.slice(0, 5);
  var shown = items.filter(function(it){ return keep.indexOf(_verNum(it.version)) !== -1; });
  var hiddenOlder = items.length > shown.length;

  _renderUpdateModal(shown, hiddenOlder);
}

function _categoryTag(cat) {
  if (cat === 'fixed') return '<span style="background:#FEF3C7;color:#92400E;font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;letter-spacing:.4px">FIXED</span>';
  if (cat === 'new')   return '<span style="background:rgba(0,160,210,0.12);color:#0073A0;font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;letter-spacing:.4px">NEW</span>';
  return '<span style="background:#EEF2FF;color:#0A1F5C;font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;letter-spacing:.4px">UPDATE</span>';
}

function _renderUpdateModal(items, hiddenOlder) {
  // esc2 is defined in helpers.js — text-only fields below.
  var rows = items.map(function(it){
    var v = it.version ? '<span style="font-family:DM Mono,monospace;font-size:11px;color:var(--muted);margin-left:6px">'+esc2(it.version)+'</span>' : '';
    return '<div style="padding:10px 0;border-bottom:1px solid #F1F5F9">'+
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">'+
        _categoryTag(it.category)+
        '<strong style="font-size:13.5px;color:var(--navy);line-height:1.3">'+esc2(it.title||'')+'</strong>'+
        v+
      '</div>'+
      (it.body ? '<div style="font-size:12.5px;color:#475569;line-height:1.5">'+esc2(it.body)+'</div>' : '')+
    '</div>';
  }).join('');
  var more = hiddenOlder
    ? '<div style="font-size:11px;color:var(--muted);margin-top:8px;text-align:center">…and earlier updates.</div>'
    : '';

  var html =
    '<div class="modal-overlay show" id="update-notes-overlay" onclick="if(event.target===this)closeUpdateNotesModal()">'+
      '<div class="modal" style="max-width:520px">'+
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;gap:12px">'+
          '<div class="modal-title">What\'s new</div>'+
          '<button class="btn btn-ghost" onclick="closeUpdateNotesModal()" style="font-size:18px;padding:4px 10px" title="Close">×</button>'+
        '</div>'+
        '<div style="max-height:52vh;overflow-y:auto;border-top:1px solid #F1F5F9">'+rows+'</div>'+
        more+
        '<div class="modal-actions">'+
          '<button class="btn btn-ghost" onclick="closeUpdateNotesModal()">Later</button>'+
          '<button class="btn btn-primary" id="update-notes-apply-btn" onclick="_updateNotesConfirm()">Update now</button>'+
        '</div>'+
      '</div>'+
    '</div>';

  var wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap.firstChild);
  if (typeof renderIcons === 'function') renderIcons();
}

function closeUpdateNotesModal() {
  var el = document.getElementById('update-notes-overlay');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function _updateNotesConfirm() {
  // Flip the modal's primary button to the same "Updating…" affordance
  // applyUpdate sets on the pill, so the user sees something happening
  // before the reload swaps the page out.
  var btn = document.getElementById('update-notes-apply-btn');
  if (btn) {
    btn.textContent = 'Updating…';
    btn.disabled = true;
    btn.style.cursor = 'default';
  }
  applyUpdate();
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

// v116: populate the user-menu version label from SW_REGISTRATION_URL so
// the trio (sw.js / init.js / index.html Sentry release) stays the single
// source of truth — no 4th place to keep in sync.
function initAppVersionLabel() {
  var el = document.getElementById('user-menu-version');
  if (!el) return;
  var m = String(SW_REGISTRATION_URL || '').match(/v=(\d+)/);
  el.textContent = m ? ('v' + m[1]) : '—';
}

// v124 a11y: make sidebar navigation keyboard-reachable. The nav items are
// <div onclick> rather than <button> — historically for tighter visual
// control. This retrofit gives them button semantics + Enter/Space activation
// + aria-expanded sync on accordion parents, without changing the markup.
function initSidebarKeyboard() {
  var items = document.querySelectorAll('.sidebar-item, .sidebar-subitem');
  items.forEach(function(el) {
    if (!el.hasAttribute('role'))     el.setAttribute('role', 'button');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    if (el.classList.contains('has-children') && !el.hasAttribute('aria-expanded')) {
      // Accordion parents reflect their .sidebar-group.open state.
      var group = el.closest('.sidebar-group');
      el.setAttribute('aria-expanded', (group && group.classList.contains('open')) ? 'true' : 'false');
    }
  });
  // Delegated keydown — Enter/Space activates, just like a real button.
  document.addEventListener('keydown', function(ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var t = ev.target;
    if (!t || !t.classList) return;
    if (!t.classList.contains('sidebar-item') && !t.classList.contains('sidebar-subitem')) return;
    ev.preventDefault();
    t.click();
  });
  // Keep aria-expanded on accordion parents in sync when sidebar-group open
  // class flips. One MutationObserver, watches the parent groups.
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.attributeName !== 'class') return;
      var group = m.target;
      if (!group.classList || !group.classList.contains('sidebar-group')) return;
      var head = group.querySelector('.sidebar-item.has-children');
      if (head) head.setAttribute('aria-expanded', group.classList.contains('open') ? 'true' : 'false');
    });
  });
  document.querySelectorAll('.sidebar-group').forEach(function(g) {
    observer.observe(g, { attributes: true, attributeFilter: ['class'] });
  });
}

// v124 a11y: make every modal a proper dialog — role/aria-modal on the
// inner .modal, initial focus on the first interactive element when opened,
// and a Tab/Shift-Tab trap so focus stays inside while .show is active. Esc
// closes via the existing close button (we just synthesise its click).
function initModalA11y() {
  // 1. Static markup pass — all modals get role+aria-modal once.
  document.querySelectorAll('.modal-overlay > .modal').forEach(function(m) {
    if (!m.hasAttribute('role'))       m.setAttribute('role', 'dialog');
    if (!m.hasAttribute('aria-modal')) m.setAttribute('aria-modal', 'true');
    if (!m.hasAttribute('tabindex'))   m.setAttribute('tabindex', '-1');
  });

  function focusables(modal) {
    return Array.from(modal.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function(el) { return el.offsetParent !== null; });
  }

  function activeOverlay() {
    var overlays = document.querySelectorAll('.modal-overlay.show');
    // The topmost shown overlay is the one to trap into (rare nesting case).
    return overlays.length ? overlays[overlays.length - 1] : null;
  }

  // 2. Tab/Shift-Tab + Esc trap — single delegated listener.
  document.addEventListener('keydown', function(ev) {
    if (ev.key !== 'Tab' && ev.key !== 'Escape') return;
    var ov = activeOverlay();
    if (!ov) return;
    var modal = ov.querySelector('.modal');
    if (!modal) return;
    if (ev.key === 'Escape') {
      // Click the modal's × close button if present, else just hide the overlay.
      var closeBtn = modal.querySelector('button[onclick*="close"], button[title="Close"]');
      if (closeBtn) { ev.preventDefault(); closeBtn.click(); }
      else { ev.preventDefault(); ov.classList.remove('show'); }
      return;
    }
    var f = focusables(modal);
    if (!f.length) { ev.preventDefault(); return; }
    var first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault(); last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault(); first.focus();
    }
  });

  // 3. Initial focus — one MutationObserver on document.body watching for
  // .modal-overlay nodes flipping into .show. The check runs cheaply (class
  // attribute filter); when an overlay enters .show, focus the first
  // interactive element so keyboard users land inside the dialog.
  var openObserver = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.attributeName !== 'class') return;
      var t = m.target;
      if (!t.classList || !t.classList.contains('modal-overlay')) return;
      if (!t.classList.contains('show')) return;
      var modal = t.querySelector('.modal');
      if (!modal) return;
      var f = focusables(modal);
      // setTimeout(0) yields to any onclick handlers that mutate the modal
      // contents on open (e.g. seeding inputs).
      setTimeout(function() {
        if (f.length) f[0].focus();
        else modal.focus();
      }, 0);
    });
  });
  document.querySelectorAll('.modal-overlay').forEach(function(ov) {
    openObserver.observe(ov, { attributes: true, attributeFilter: ['class'] });
  });
  // Also observe new overlays added later (e.g. the Update-notes modal
  // injected dynamically in v121).
  new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (node.nodeType !== 1) return;
        if (node.classList && node.classList.contains('modal-overlay')) {
          openObserver.observe(node, { attributes: true, attributeFilter: ['class'] });
          var inner = node.querySelector('.modal');
          if (inner) {
            if (!inner.hasAttribute('role'))       inner.setAttribute('role', 'dialog');
            if (!inner.hasAttribute('aria-modal')) inner.setAttribute('aria-modal', 'true');
          }
        }
      });
    });
  }).observe(document.body, { childList: true });
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
  initAppVersionLabel();
  initSidebarKeyboard();
  initModalA11y();
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
