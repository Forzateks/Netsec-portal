// == NAVIGATION ====================================================
// Tracks which screens have already had their data loaders run at least
// once. Used by showScreen() to skip a redundant refetch when the user
// re-expands an accordion they had collapsed — without breaking the
// initial render after login, where the static HTML pre-marks
// #screen-dashboard as `active` even though no loader has fired yet.
var _shownScreens = {};

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
  ['leave','ot'].forEach(function(t) {
    var el = document.getElementById('apptab-'+t);
    if (el) el.style.display = t===tab ? 'block' : 'none';
  });
  if (tab==='leave') renderLeaveApprovals();
  else if (tab==='ot') renderOTApprovals();
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
  employee:   'reports'
  // otpolicy, manage, vendors, otmanager → standalone items
};

// Lookup the sbg-id that should be open for a given projects-screen sub-tab.
// Returns null for standalone tabs.
function _projectGroupForTab(subTab) {
  return PROJECT_TAB_GROUPS[subTab] || null;
}

function showScreen(name) {
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
  if (name==='amc') { if (typeof loadAMCContracts === 'function') loadAMCContracts(); }
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
}
function closeUserMenu() {
  var wrap = document.querySelector('.user-menu-wrap');
  if (wrap) wrap.classList.remove('open');
}

function toggleSidebar(open) {
  var sb = document.getElementById('sidebar');
  var ov = document.getElementById('sidebar-overlay');
  if (!sb) return;
  if (open === undefined) open = !sb.classList.contains('open');
  sb.classList.toggle('open', open);
  if (ov) ov.classList.toggle('show', open);
}

function closeSidebarOnMobile() {
  if (window.innerWidth <= 900) toggleSidebar(false);
}
