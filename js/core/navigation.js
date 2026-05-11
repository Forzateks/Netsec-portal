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

function showScreen(name) {
  var grp        = document.getElementById('sbg-'+name);
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
  var tab = document.getElementById('tab-'+name);
  if (tab) tab.classList.add('active');
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
}

// Sidebar drove navigation: jump to a screen + a specific sub-tab.
function navigateSub(screen, subTab) {
  var screenEl = document.getElementById('screen-'+screen);
  if (screenEl && !screenEl.classList.contains('active')) {
    showScreen(screen); // sets default sub-tab; we override below
  } else {
    // Already on the screen — still ensure group is expanded
    var grp = document.getElementById('sbg-'+screen);
    if (grp) grp.classList.add('open');
  }
  if (screen==='leave')      showLeaveTab(subTab);
  else if (screen==='projects')  showProjectTab(subTab);
  else if (screen==='approvals') showApprovalsTab(subTab);
  else if (screen==='inventory') showInventoryTab(subTab);
  else if (screen==='kb')        showKBTab(subTab);
  else if (screen==='tracker')   showTrackerTab(subTab);
  closeSidebarOnMobile();
}

// Helper: keep one .sidebar-subitem.active under a given screen group.
function setSidebarSubActive(screen, subTab) {
  var prefix = 'sbi-'+screen+'-';
  document.querySelectorAll('.sidebar-subitem[id^="'+prefix+'"]').forEach(function(el){
    el.classList.toggle('active', el.id === prefix+subTab);
  });
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
