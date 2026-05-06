function exportCSV() {
  const data=window._sessionsData||[];
  if (!data.length) return;
  const rows=[['Employee','Activity','Date','Day','Start','End','Duration','Band','Rate','Credited']];
  data.forEach(function(s){rows.push([s.employee,s.activity,s.ot_date,s.day_name,s.start_time,s.end_time,s.duration_hours,s.band,s.rate,s.credited_hours]);});
  const csv=rows.map(function(r){return r.map(function(v){return '"'+(v||'')+'"';}).join(',');}).join('\n');
  const a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='Gulfit_OT_Sessions.csv'; a.click();
}

// == DASHBOARD ====================================================
async function renderDashboard() {
  document.getElementById('dash-content').innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';
  var year  = new Date().getFullYear().toString();
  var month = new Date().toISOString().slice(0,7);
  var monthName = new Date().toLocaleString('default',{month:'long'});

  var results = await Promise.all([
    sb.from('ot_sessions').select('*').eq('employee',currentUser),
    sb.from('comp_off_register').select('*').eq('employee',currentUser),
    sb.from('comp_off_requests').select('*').eq('employee',currentUser).order('created_at',{ascending:false}),
    sb.from('leave_requests').select('*').eq('employee',currentUser).order('created_at',{ascending:false}),
    sb.from('annual_leave').select('working_days').eq('employee',currentUser).gte('start_date',year+'-01-01').lte('start_date',year+'-12-31'),
    sb.from('project_sessions').select('duration_hours,team_members').gte('session_date',month+'-01').lte('session_date',month+'-31'),
  ]);
  var sessions=results[0].data, compoffs=results[1].data, coReqs=results[2].data;
  var lvReqs=results[3].data, alData=results[4].data, pjSess=results[5].data;

  var s = calcSummary(sessions||[], compoffs||[], currentUser);
  var leaveUsed = (alData||[]).reduce(function(a,r){return a+parseFloat(r.working_days||0);},0);
  var leaveBalance = LEAVE_ALLOWANCE - leaveUsed;
  var otThisMonth = (sessions||[]).filter(function(x){return (x.ot_date||'').startsWith(month) && (x.status==='approved'||!x.status);}).length;
  var pjHrsMonth = 0;
  (pjSess||[]).forEach(function(r){
    var fn = currentUser.split(' ')[0].toLowerCase();
    if((r.team_members||'').toLowerCase().includes(fn)) pjHrsMonth += parseFloat(r.duration_hours||0);
  });

  var recent = (sessions||[]).filter(function(x){return x.status==='approved'||!x.status;}).sort(function(a,b){return a.ot_date>b.ot_date?-1:1;}).slice(0,5);
  var pendingCO = (coReqs||[]).filter(function(r){return r.status==='pending';});
  var pendingLV = (lvReqs||[]).filter(function(r){return r.status==='pending';});
  var pendingOT = (sessions||[]).filter(function(r){return r.status==='pending';});
  var balColor  = s.balance>0?'var(--success)':s.balance<0?'var(--danger)':'var(--navy)';
  var lvColor   = leaveBalance<=5?'var(--danger)':leaveBalance<=10?'var(--gold)':'var(--success)';
  var hr = new Date().getHours();
  var greet = hr<12?'Good morning':hr<17?'Good afternoon':'Good evening';

  var html = '<div style="margin-bottom:20px"><h2 style="font-size:20px;font-weight:700;color:var(--navy)">'+greet+', '+currentUser.split(' ')[0]+'</h2>'+
    '<div style="font-size:13px;color:var(--muted)">Here\'s your overview</div></div>';

  html += '<div class="summary-grid" style="margin-bottom:20px">'+
    '<div class="stat-card green"><div class="stat-label">CO Balance</div><div class="stat-value" style="color:'+balColor+'">'+s.balance+'</div><div class="stat-sub">Earned: '+s.totalCO+' | Used: '+s.used+'</div></div>'+
    '<div class="stat-card teal"><div class="stat-label">Leave Remaining</div><div class="stat-value" style="color:'+lvColor+'">'+leaveBalance+'</div><div class="stat-sub">of '+LEAVE_ALLOWANCE+' days ('+year+')</div></div>'+
    '<div class="stat-card navy"><div class="stat-label">OT Sessions ('+monthName+')</div><div class="stat-value">'+otThisMonth+'</div><div class="stat-sub">sessions this month</div></div>'+
    '<div class="stat-card eve"><div class="stat-label">Project Hrs ('+monthName+')</div><div class="stat-value" style="font-size:20px">'+r2(pjHrsMonth)+'h</div><div class="stat-sub">this month</div></div>'+
    '</div>';

  html += '<div class="card" style="margin-bottom:20px"><div class="card-title">Quick Actions</div>'+
    '<div class="quick-actions-wrap">'+
    '<button class="btn btn-primary" onclick="showScreen(\'projects\');showProjectTab(\'uslog\')">Log Session</button>'+
    '<button class="btn btn-ghost" onclick="showScreen(\'leave\');showLeaveTab(\'log\')">Request Leave</button>'+
    '<button class="btn btn-ghost" onclick="showScreen(\'leave\');showLeaveTab(\'compoff\')">Comp Off</button>'+
    (isManager?'<button id="monthly-report-btn" class="btn btn-ghost" onclick="downloadMonthlyReport()">Monthly OT Report</button>':'')+
    (isManager?'<button class="btn btn-ghost" onclick="showScreen(\'approvals\')">Approvals</button>':'')+
    '</div></div>';

  if (pendingCO.length || pendingLV.length || pendingOT.length) {
    html += '<div class="card" style="margin-bottom:20px;border-left:4px solid var(--gold)"><div class="card-title">My Pending Requests</div>';
    pendingOT.forEach(function(r){ html += '<div class="request-card pending" style="margin-bottom:8px">OT Session - '+r.activity+' on '+fmtDate(r.ot_date)+' ('+r.band+' '+r.duration_hours+'h)<span class="badge badge-pending" style="margin-left:8px">Awaiting Approval</span></div>'; });
    pendingCO.forEach(function(r){ html += '<div class="request-card pending" style="margin-bottom:8px">Comp Off - '+r.type+' on '+fmtDate(r.request_date)+'<span class="badge badge-pending" style="margin-left:8px">Pending</span></div>'; });
    pendingLV.forEach(function(r){ html += '<div class="request-card pending" style="margin-bottom:8px">Leave - '+fmtDate(r.start_date)+' to '+fmtDate(r.end_date)+' ('+r.working_days+' days)<span class="badge badge-pending" style="margin-left:8px">Pending</span></div>'; });
    html += '</div>';
  }

  html += '<div class="card" style="margin-bottom:20px"><div class="flex-between mb-4">'+
    '<div class="card-title" style="margin-bottom:0">Recent OT Sessions</div>'+
    '<button class="btn btn-sm btn-ghost" onclick="showScreen(\'projects\');showProjectTab(\'otsessions\')">View All</button></div>';
  if (recent.length) {
    html += '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Activity</th><th>Band</th><th>Rate</th><th>Credited</th></tr></thead><tbody>';
    recent.forEach(function(r){
      html += '<tr><td style="font-size:12px">'+fmtDate(r.ot_date)+'</td>'+
        '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+r.activity+'</td>'+
        '<td><span class="badge badge-'+r.band+'">'+r.band+'</span></td>'+
        '<td><span class="badge '+(r.rate==='1:2'?'badge-12':'badge-11')+'">'+r.rate+'</span></td>'+
        '<td><strong style="color:var(--teal)">'+r.credited_hours+'h</strong></td></tr>';
    });
    html += '</tbody></table></div>';
  } else { html += '<div class="empty-state" style="padding:16px"><div class="empty-title">No OT sessions yet</div></div>'; }
  html += '</div>';

  if (isManager) {
    var approvalResults = await Promise.all([
      sb.from('comp_off_requests').select('id').eq('status','pending'),
      sb.from('leave_requests').select('id').eq('status','pending')
    ]);
    var total = (approvalResults[0].data||[]).length + (approvalResults[1].data||[]).length;
    if (total>0) {
      html += '<div class="card" style="margin-bottom:20px;border-left:4px solid var(--gold)"><div class="flex-between">'+
        '<div><div class="card-title" style="margin-bottom:4px">'+total+' Pending Approvals</div>'+
        '<div style="font-size:13px;color:var(--muted)">'+(approvalResults[0].data||[]).length+' comp off | '+(approvalResults[1].data||[]).length+' leave requests</div></div>'+
        '<button class="btn btn-primary" onclick="showScreen(\'approvals\')">Review</button></div></div>';
    }

    // Backup card (manager only)
    html += '<div class="card" style="border-left:4px solid var(--teal)">'+
      '<div class="card-title" style="margin-bottom:6px">📦 Data Backup (Excel)</div>'+
      '<div style="font-size:13px;color:var(--muted);margin-bottom:12px">Download a snapshot of any section as .xlsx, or grab a full backup with every table on its own sheet.</div>'+
      '<div style="display:flex;flex-wrap:wrap;gap:8px">'+
      '<button class="btn btn-primary" onclick="backupExcel(\'all\')">⬇ Full Backup (all sheets)</button>'+
      '<button class="btn btn-ghost" onclick="backupExcel(\'ot_sessions\')">OT Sessions</button>'+
      '<button class="btn btn-ghost" onclick="backupExcel(\'project_sessions\')">Project Sessions</button>'+
      '<button class="btn btn-ghost" onclick="backupExcel(\'inventory\')">Inventory</button>'+
      '<button class="btn btn-ghost" onclick="backupExcel(\'leave\')">Leaves</button>'+
      '<button class="btn btn-ghost" onclick="backupExcel(\'comp_off\')">Comp Offs</button>'+
      '<button class="btn btn-ghost" onclick="backupExcel(\'kb_articles\')">Knowledge Base</button>'+
      '<button class="btn btn-ghost" onclick="backupExcel(\'directory\')">Customers + Projects</button>'+
      '</div></div>';
  }

  document.getElementById('dash-content').innerHTML = html;
}

// ── EXCEL BACKUP ─────────────────────────────────────────────────────────
async function backupExcel(scope) {
  if (typeof XLSX === 'undefined') { alert('Excel library not loaded. Refresh the page and try again.'); return; }
  var stamp = new Date().toISOString().split('T')[0];
  var wb = XLSX.utils.book_new();

  async function addSheet(name, table, orderBy) {
    var q = sb.from(table).select('*');
    if (orderBy) q = q.order(orderBy, {ascending: false});
    var {data, error} = await q;
    if (error) { console.error('Backup error for '+table+':', error); return; }
    var rows = data || [];
    var ws;
    if (rows.length) {
      ws = XLSX.utils.json_to_sheet(rows);
    } else {
      ws = XLSX.utils.aoa_to_sheet([['(no rows)']]);
    }
    XLSX.utils.book_append_sheet(wb, ws, name.substring(0, 31)); // sheet name max 31 chars
  }

  var jobs = [];
  if (scope === 'all' || scope === 'ot_sessions')      jobs.push(addSheet('OT Sessions',      'ot_sessions',      'ot_date'));
  if (scope === 'all' || scope === 'project_sessions') jobs.push(addSheet('Project Sessions', 'project_sessions', 'session_date'));
  if (scope === 'all' || scope === 'inventory')        jobs.push(addSheet('Inventory',        'inventory',        'serial_number'));
  if (scope === 'all' || scope === 'inventory')        jobs.push(addSheet('Inventory Activity Log', 'inventory_activity_log', 'changed_at'));
  if (scope === 'all' || scope === 'leave')            jobs.push(addSheet('Leave Requests',   'leave_requests',   'created_at'));
  if (scope === 'all' || scope === 'leave')            jobs.push(addSheet('Annual Leave',     'annual_leave',     'start_date'));
  if (scope === 'all' || scope === 'comp_off')         jobs.push(addSheet('Comp Off Requests','comp_off_requests','created_at'));
  if (scope === 'all' || scope === 'comp_off')         jobs.push(addSheet('Comp Off Register','comp_off_register','date_taken'));
  if (scope === 'all' || scope === 'kb_articles')      jobs.push(addSheet('Knowledge Base',   'kb_articles',      'created_at'));
  if (scope === 'all' || scope === 'directory')        jobs.push(addSheet('Customers',        'customers',        'name'));
  if (scope === 'all' || scope === 'directory')        jobs.push(addSheet('Projects',         'projects',         'name'));
  if (scope === 'all')                                 jobs.push(addSheet('User Profiles',    'user_profiles',    'employee_name'));

  await Promise.all(jobs);

  var filename = scope === 'all'
    ? 'netsec-backup-'+stamp+'.xlsx'
    : 'netsec-'+scope+'-'+stamp+'.xlsx';
  XLSX.writeFile(wb, filename);
}
