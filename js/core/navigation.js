// == NAVIGATION ====================================================
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
  if (tab==='log')     onLeaveTypeChange();
  if (tab==='history') renderLeaveHistory();
  if (tab==='team')    renderLeaveTeam();
}

function showApprovalsTab(tab) {
  ['leave','ot'].forEach(function(t) {
    document.getElementById('apptab-'+t).style.display=t===tab?'block':'none';
    const sub=document.getElementById('appsub-'+t);
    if (t===tab){sub.classList.add('active');sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid var(--teal);color:var(--navy);white-space:nowrap';}
    else{sub.classList.remove('active');sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);white-space:nowrap';}
  });
  if (tab==='leave') renderLeaveApprovals();
  else if (tab==='ot') renderOTApprovals();
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(s){s.classList.remove('active');});
  document.querySelectorAll('.sidebar-item').forEach(function(t){t.classList.remove('active');});
  document.getElementById('screen-'+name).classList.add('active');
  var tab = document.getElementById('tab-'+name);
  if (tab) tab.classList.add('active');
  if (name==='dashboard') renderDashboard();
  if (name==='leave')     showLeaveTab('log');
  if (name==='projects')  { initProjectTab(); showProjectTab('uslog'); };
  if (name==='approvals')  showApprovalsTab('leave');
  if (name==='inventory')  showInventoryTab('devices');
  if (name==='kb')         showKBTab('browse');
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
