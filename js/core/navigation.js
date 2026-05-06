// == NAVIGATION ====================================================
function showOTTab(tab) {
  ['log','sessions','summary','compoff','manager','policy'].forEach(function(t) {
    const el=document.getElementById('ottab-'+t);
    const sub=document.getElementById('otsub-'+t);
    if (!el) return;
    el.style.display=t===tab?'block':'none';
    if (!sub) return;
    // Always keep manager tab hidden for non-managers regardless of cssText changes
    if (t==='manager' && !isManager) { sub.style.display='none'; return; }
    if (t===tab){sub.classList.add('active');sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid var(--teal);color:var(--navy);white-space:nowrap';}
    else{sub.classList.remove('active');sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);white-space:nowrap';}
  });
  if (tab==='log')      populateProjectDropdowns();
  if (tab==='summary')  buildSummaryFilters();
  if (tab==='sessions') renderSessions();
  if (tab==='compoff')  { renderMyCompOffRequests(); }
  if (tab==='manager')  renderManager();
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
  if (tab==='history') renderLeaveHistory();
  if (tab==='team')    renderLeaveTeam();
}

function showApprovalsTab(tab) {
  ['compoff','leave','ot'].forEach(function(t) {
    document.getElementById('apptab-'+t).style.display=t===tab?'block':'none';
    const sub=document.getElementById('appsub-'+t);
    if (t===tab){sub.classList.add('active');sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid var(--teal);color:var(--navy);white-space:nowrap';}
    else{sub.classList.remove('active');sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);white-space:nowrap';}
  });
  if (tab==='compoff') renderCompOffApprovals();
  else if (tab==='leave') renderLeaveApprovals();
  else if (tab==='ot') renderOTApprovals();
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(s){s.classList.remove('active');});
  document.querySelectorAll('.nav-tab').forEach(function(t){t.classList.remove('active');});
  document.getElementById('screen-'+name).classList.add('active');
  document.getElementById('tab-'+name).classList.add('active');
  if (name==='dashboard') renderDashboard();
  if (name==='overtime')  showOTTab('log');
  if (name==='leave')     showLeaveTab('log');
  if (name==='projects')  { initProjectTab(); showProjectTab('uslog'); };
  if (name==='approvals')  showApprovalsTab('compoff');
  if (name==='inventory')  showInventoryTab('devices');
  if (name==='kb')         showKBTab('browse');
}

