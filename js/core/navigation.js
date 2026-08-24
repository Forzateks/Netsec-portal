// == NAVIGATION ====================================================
// Tracks which screens have already had their data loaders run at least
// once. Used by showScreen() to skip a redundant refetch when the user
// re-expands an accordion they had collapsed — without breaking the
// initial render after login, where the static HTML pre-marks
// #screen-dashboard as `active` even though no loader has fired yet.
var _shownScreens = {};

// == TOP-BAR SCREEN TITLE (v161) ===================================
// The header used to repeat the "NetSec Portal" wordmark, which in the
// installed PWA sat directly under the OS title bar showing the very same
// text. It now names the screen you're on instead.
//
// Wording is copied verbatim from the sidebar so the header and the nav
// always agree. `projects` is the one screen that hosts unrelated sub-tabs
// (Log Session, OT Summary, Customers, Admin Tools …) and has no meaningful
// screen-level name, so it resolves via its sub-tab instead.
var TOP_BAR_LABELS = {
  dashboard:    'Dashboard',
  leave:        'Leave',
  tasks:        'Tasks',
  approvals:    'Approvals',
  tracker:      'Project Tracker',
  amc:          'AMC Contracts',
  psdeals:      'Professional Services',
  rollout:      'Rollout Tracker',
  inventory:    'Inventory',
  certificates: 'Certificates',
  skills:       'Team Skills',
  kb:           'Knowledge Base',
  team:         'Team Portfolio'
};
var TOP_BAR_SUB_LABELS = {
  uslog:      'Log Session',
  ussess:     'My Sessions',
  otsessions: 'OT Sessions',
  otsummary:  'OT Summary',
  engagement: 'Engagement Summary',
  customer:   'Customer Summary',
  employee:   'Employee Summary',
  matrix:     'Activity Matrix',
  custmgr:    'Customers',
  manage:     'Engagements',
  vendors:    'Vendors & Products',
  otmanager:  'Admin Tools',
  otpolicy:   'OT Policy'
};

// screen = screen id without the 'screen-' prefix; subTab is optional and
// only consulted for the multi-purpose `projects` screen.
function _setTopBarScreen(screen, subTab) {
  var el = document.getElementById('top-bar-screen');
  if (!el) return;
  var label;
  if (screen === 'projects') {
    label = TOP_BAR_SUB_LABELS[subTab] || TOP_BAR_SUB_LABELS[_projectsActiveTab()] || 'Sessions';
  } else {
    label = TOP_BAR_LABELS[screen];
  }
  if (label) el.textContent = label;
}

// Best-effort read of which `projects` sub-tab is currently visible, so a
// bare showScreen('projects') (no sub-tab argument) still titles correctly.
function _projectsActiveTab() {
  var keys = Object.keys(TOP_BAR_SUB_LABELS);
  for (var i = 0; i < keys.length; i++) {
    var el = document.getElementById('pjtab-' + keys[i]);
    if (el && el.style.display !== 'none') return keys[i];
  }
  return null;
}

function showLeaveTab(tab) {
  ['log','history','team'].forEach(function(t) {
    const el=document.getElementById('ltab-'+t);
    const sub=document.getElementById('lsub-'+t);
    if (!el) return;
    el.style.display=t===tab?'block':'none';
    if (!sub) return;
    if (t===tab){sub.classList.add('active');sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid var(--teal);color:var(--navy);white-space:nowrap';}
    else{sub.classList.remove('active');sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);white-space:nowrap';}
  });
  if (tab==='log') {
    // Pre-fill the date pickers with today so users don't have to click the
    // calendar to enter a same-day request. Skip if already filled.
    var todayISO = new Date().toISOString().split('T')[0];
    var lvStart = document.getElementById('lv-start');
    var lvEnd   = document.getElementById('lv-end');
    if (lvStart && !lvStart.value) lvStart.value = todayISO;
    if (lvEnd   && !lvEnd.value)   lvEnd.value   = todayISO;
    onLeaveTypeChange();
  }
  if (tab==='history') renderLeaveHistory();
  if (tab==='team')    renderLeaveTeam();
  setSidebarSubActive('leave', tab);
}

function showApprovalsTab(tab) {
  // v113: 'tasks' sub-tab added for task-completion approvals.
  ['leave','ot','tasks'].forEach(function(t) {
    var el = document.getElementById('apptab-'+t);
    if (el) el.style.display = t===tab ? 'block' : 'none';
  });
  if (tab==='leave') renderLeaveApprovals();
  else if (tab==='ot') renderOTApprovals();
  else if (tab==='tasks' && typeof renderTaskApprovals === 'function') renderTaskApprovals();
  setSidebarSubActive('approvals', tab);
}

// The projects screen used to live under one sidebar accordion. v49 split
// it into Sessions (Log Session, My Sessions), Reports (analytics views),
// plus standalone Manager-section items (Manage Engagements, Vendors &
// Products, Admin Tools) and the System-section OT Policy. This map tells
// the router which accordion to open for each tab. Tabs absent from the
// map are standalone — no accordion to highlight.
var PROJECT_TAB_GROUPS = {
  uslog:      'sessions',
  ussess:     'sessions',
  otsessions: 'reports',
  otsummary:  'reports',
  engagement: 'reports',
  customer:   'reports',
  employee:   'reports',
  matrix:     'reports'   // v109b: Activity Matrix
  // otpolicy, manage, vendors, otmanager → standalone items
};

// Lookup the sbg-id that should be open for a given projects-screen sub-tab.
// Returns null for standalone tabs.
function _projectGroupForTab(subTab) {
  return PROJECT_TAB_GROUPS[subTab] || null;
}

function showScreen(name) {
  // v107: clear sticky #/team hash when switching to a non-team screen.
  // Without this, once a user visited Team Portfolio the URL kept #/team
  // permanently — every later showScreen() updated the visible screen
  // but the URL still said #/team, so the next hard refresh resurrected
  // Team Portfolio via init.js's hash-route check. replaceState is silent
  // (no hashchange, no history entry, no reload). Wrapped in try/catch
  // for private-mode / about:blank edge cases where history is restricted.
  if (name !== 'team' && window.location.hash && window.location.hash.indexOf('#/team') === 0) {
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (e) { /* ignore */ }
  }

  // v161: keep the top-bar title in step with the screen. showProjectTab()
  // re-sets it with the resolved sub-tab for the `projects` screen.
  _setTopBarScreen(name);

  // For the projects screen, the active sub-tab decides which accordion to
  // open. showScreen called bare (no sub-tab) defaults to Sessions.
  var grpId = (name === 'projects') ? 'sbg-sessions' : 'sbg-'+name;
  var grp        = document.getElementById(grpId);
  var screenEl   = document.getElementById('screen-'+name);
  var alreadyOn  = screenEl && screenEl.classList.contains('active');
  var groupOpen  = grp && grp.classList.contains('open');

  // Toggle: clicking the parent of the screen you're already on, while its
  // submenu is open, just collapses the submenu (no navigation, no refetch).
  // Click again to re-expand. Top-level items without a group (Dashboard)
  // skip this because grp is null.
  if (alreadyOn && groupOpen) {
    grp.classList.remove('open');
    return;
  }

  document.querySelectorAll('.screen').forEach(function(s){s.classList.remove('active');});
  document.querySelectorAll('.sidebar-item').forEach(function(t){t.classList.remove('active');});
  if (screenEl) screenEl.classList.add('active');
  // For non-projects screens, the parent tab id matches the screen name.
  // For projects, the parent tab id depends on which sub-group is active
  // and is set by showProjectTab via _setProjectParentActive.
  if (name !== 'projects') {
    var tab = document.getElementById('tab-'+name);
    if (tab) tab.classList.add('active');
  }
  // Accordion: open the matching group, collapse the rest
  document.querySelectorAll('.sidebar-group').forEach(function(g){ g.classList.remove('open'); });
  if (grp) grp.classList.add('open');

  // If the user was already on this screen and we've already initialized
  // it once, this click is just an accordion re-expansion — skip the
  // refetch. On the very first showScreen() per screen we always run the
  // loader, even if `alreadyOn` is true (which happens for #screen-dashboard
  // because the static HTML marks it `active` on initial render).
  if (alreadyOn && _shownScreens[name]) return;
  _shownScreens[name] = true;

  if (name==='dashboard') renderDashboard();
  if (name==='leave')     showLeaveTab('log');
  if (name==='projects')  { initProjectTab(); showProjectTab('uslog'); };
  if (name==='approvals')  showApprovalsTab('leave');
  if (name==='inventory')  showInventoryTab('devices');
  if (name==='kb')         showKBTab('browse');
  if (name==='tracker')    { if (typeof showTrackerTab === 'function') showTrackerTab('all'); if (typeof loadTracker === 'function') loadTracker(); }
  if (name==='certificates') { if (typeof showCertTab === 'function') showCertTab('mine'); }
  if (name==='amc') { if (typeof showAMCTab === 'function') showAMCTab('contracts'); }
  if (name==='psdeals') { if (typeof showPsDealsTab === 'function') showPsDealsTab('deals'); }
  if (name==='rollout') { if (typeof showRolloutTab === 'function') showRolloutTab('overview'); }
  if (name==='skills')  { if (typeof loadSkills === 'function')  loadSkills(); }
  if (name==='tasks')   { if (typeof loadTasks === 'function')   loadTasks(); }
}

// Parent-click handler for the projects accordions (Sessions / Reports).
// Mirrors the showScreen toggle-collapse behaviour: re-clicking the parent
// of an already-open group collapses it. First click opens the group and
// navigates to its default child. Sub-item clicks bypass this and go
// straight through navigateSub.
function toggleProjectGroup(grpKey, defaultTab) {
  var grp = document.getElementById('sbg-'+grpKey);
  var screenEl = document.getElementById('screen-projects');
  var alreadyOn = screenEl && screenEl.classList.contains('active');
  if (alreadyOn && grp && grp.classList.contains('open')) {
    grp.classList.remove('open');
    return;
  }
  navigateSub('projects', defaultTab);
}

// Sidebar drove navigation: jump to a screen + a specific sub-tab. Also
// expands the matching sidebar group — but only when one exists. Standalone
// projects items (otpolicy under System, manage / vendors / otmanager under
// MANAGER) have no parent accordion, so we collapse every group instead of
// defaulting to Sessions.
function navigateSub(screen, subTab) {
  var screenEl = document.getElementById('screen-'+screen);
  if (screenEl && !screenEl.classList.contains('active')) {
    showScreen(screen); // sets default sub-tab; we override below
  }
  // Resolve which sidebar group (if any) should be open for this sub-tab.
  var grpId = null;
  if (screen === 'projects') {
    var key = _projectGroupForTab(subTab);
    grpId = key ? ('sbg-' + key) : null; // null → standalone, collapse all
  } else {
    grpId = 'sbg-'+screen;
  }
  document.querySelectorAll('.sidebar-group').forEach(function(g){
    g.classList.toggle('open', grpId != null && g.id === grpId);
  });
  if (screen==='leave')      showLeaveTab(subTab);
  else if (screen==='projects')  showProjectTab(subTab);
  else if (screen==='approvals') showApprovalsTab(subTab);
  else if (screen==='inventory') showInventoryTab(subTab);
  else if (screen==='kb')        showKBTab(subTab);
  else if (screen==='tracker')   showTrackerTab(subTab);
  else if (screen==='certificates') showCertTab(subTab);
  else if (screen==='amc')       showAMCTab(subTab);
  else if (screen==='psdeals')   showPsDealsTab(subTab);
  else if (screen==='rollout')   showRolloutTab(subTab);
  closeSidebarOnMobile();
}

// Helper: keep one .sidebar-subitem.active under a given screen group.
// Also handles the standalone .sidebar-item entries under MANAGER + System
// (Manage Engagements, Vendors & Products, Admin Tools, OT Policy) — those
// still carry sbi-projects-X IDs so the same prefix sweep works.
function setSidebarSubActive(screen, subTab) {
  var prefix = 'sbi-'+screen+'-';
  document.querySelectorAll('[id^="'+prefix+'"]').forEach(function(el){
    el.classList.toggle('active', el.id === prefix+subTab);
  });
  // For projects, also light up the parent accordion ("Sessions" or
  // "Reports") that owns this sub-tab. Standalone tabs (otpolicy, manage,
  // vendors, otmanager) have no parent — their own item is already lit by
  // the loop above.
  if (screen === 'projects') {
    ['tab-sessions','tab-reports'].forEach(function(id){
      var el = document.getElementById(id); if (el) el.classList.remove('active');
    });
    var grpKey = _projectGroupForTab(subTab);
    if (grpKey) {
      var parent = document.getElementById('tab-'+grpKey);
      if (parent) parent.classList.add('active');
    }
  }
}

// User-chip dropdown — top-right of the unified header. Opens / closes on
// click; init.js binds a document-level handler that closes the menu when
// the user taps outside it.
function toggleUserMenu(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  var wrap = document.querySelector('.user-menu-wrap');
  if (!wrap) return;
  wrap.classList.toggle('open');
  // v124 a11y: sync aria-expanded on the trigger so SRs announce state.
  var chip = wrap.querySelector('.user-chip');
  if (chip) chip.setAttribute('aria-expanded', wrap.classList.contains('open') ? 'true' : 'false');
}
function closeUserMenu() {
  var wrap = document.querySelector('.user-menu-wrap');
  if (wrap) {
    wrap.classList.remove('open');
    var chip = wrap.querySelector('.user-chip');
    if (chip) chip.setAttribute('aria-expanded', 'false');
  }
}

function toggleSidebar(open) {
  var sb = document.getElementById('sidebar');
  var ov = document.getElementById('sidebar-overlay');
  if (!sb) return;
  if (open === undefined) open = !sb.classList.contains('open');
  sb.classList.toggle('open', open);
  if (ov) ov.classList.toggle('show', open);
  // v124 a11y: sync aria-expanded on the hamburger.
  var hb = document.querySelector('.hamburger');
  if (hb) hb.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function closeSidebarOnMobile() {
  if (window.innerWidth <= 900) toggleSidebar(false);
}
