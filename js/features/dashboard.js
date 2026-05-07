function exportCSV() {
  const data=window._sessionsData||[];
  if (!data.length) return;
  const rows=[['Employee','Activity','Date','Day','Start','End','Duration','Band','Rate','Credited']];
  data.forEach(function(s){rows.push([s.employee,s.activity,s.ot_date,s.day_name,s.start_time,s.end_time,s.duration_hours,s.band,s.rate,s.credited_hours]);});
  const csv=rows.map(function(r){return r.map(function(v){return '"'+(v||'')+'"';}).join(',');}).join('\n');
  const a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='Gulfit_OT_Sessions.csv'; a.click();
}

// == DASHBOARD HELPERS ============================================
function fmtNum(n) {
  // 1234 -> "1,234". Floats keep up to 2 decimals, no trailing zeros.
  if (n === null || n === undefined || isNaN(n)) return '0';
  var v = Number(n);
  if (Math.abs(v - Math.round(v)) < 0.005) {
    return Math.round(v).toLocaleString('en-US');
  }
  return v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function trendPill(curr, prev, suffix) {
  // Renders a small +/-N pill comparing current vs previous period.
  // Hidden when prev is 0 and curr is 0 to avoid noise on empty months.
  if (curr === 0 && prev === 0) return '';
  var diff = curr - prev;
  if (Math.abs(diff) < 0.01) return '<span class="stat-trend flat">— vs last</span>';
  var sign = diff > 0 ? '+' : '−';
  var cls  = diff > 0 ? 'up' : 'down';
  var arrow = diff > 0 ? '▲' : '▼';
  return '<span class="stat-trend '+cls+'">'+arrow+' '+sign+fmtNum(Math.abs(diff))+(suffix||'')+'</span>';
}

function dashSkeleton() {
  return '<div class="dash-hero"><div class="dash-hero-text">'+
      '<div class="skeleton skel-line lg" style="width:240px"></div>'+
      '<div class="skeleton skel-line short" style="width:180px;margin-top:4px"></div>'+
    '</div></div>'+
    '<div class="dash-stats">'+
      '<div class="skeleton skel-stat"><div class="skeleton skel-line short"></div><div class="skeleton skel-line lg" style="width:60%"></div><div class="skeleton skel-line med"></div></div>'+
      '<div class="skeleton skel-stat"><div class="skeleton skel-line short"></div><div class="skeleton skel-line lg" style="width:60%"></div><div class="skeleton skel-line med"></div></div>'+
      '<div class="skeleton skel-stat"><div class="skeleton skel-line short"></div><div class="skeleton skel-line lg" style="width:60%"></div><div class="skeleton skel-line med"></div></div>'+
      '<div class="skeleton skel-stat"><div class="skeleton skel-line short"></div><div class="skeleton skel-line lg" style="width:60%"></div><div class="skeleton skel-line med"></div></div>'+
    '</div>'+
    '<div class="card"><div class="skeleton skel-line tall" style="width:140px;margin-bottom:14px"></div><div class="skeleton skel-line"></div><div class="skeleton skel-line med"></div></div>';
}

// Render a date relative to today: "today", "yesterday", weekday name for
// other days within ±6 days, or "N days ago" / "in N days" further out.
function relDate(dateStr) {
  if (!dateStr) return '';
  var d = new Date(String(dateStr).split('T')[0] + 'T00:00:00');
  var today = new Date(); today.setHours(0,0,0,0);
  var diff = Math.round((d - today) / 86400000);
  if (diff === 0)  return 'today';
  if (diff === 1)  return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff > 1 && diff < 7)   return 'on ' + d.toLocaleDateString('en-US',{weekday:'long'});
  if (diff < -1 && diff > -7) return 'last ' + d.toLocaleDateString('en-US',{weekday:'long'});
  if (diff >= 7)   return 'in ' + diff + ' days';
  return Math.abs(diff) + ' days ago';
}

// == DASHBOARD ROUTER =============================================
async function renderDashboard() {
  document.getElementById('dash-content').innerHTML = dashSkeleton();
  if (isManager) {
    return renderManagerDashboard();
  }
  return renderEmployeeDashboard();
}

// == EMPLOYEE DASHBOARD ===========================================
async function renderEmployeeDashboard() {
  var year  = new Date().getFullYear().toString();
  var month = new Date().toISOString().slice(0,7);
  var monthName = new Date().toLocaleString('default',{month:'long'});

  // Previous month's YYYY-MM for trend deltas
  var prevDate = new Date(); prevDate.setDate(1); prevDate.setMonth(prevDate.getMonth()-1);
  var prevMonth = prevDate.toISOString().slice(0,7);

  var results = await Promise.all([
    sb.from('ot_sessions').select('*').eq('employee',currentUser),
    sb.from('comp_off_register').select('*').eq('employee',currentUser),
    sb.from('comp_off_requests').select('*').eq('employee',currentUser).order('created_at',{ascending:false}),
    sb.from('leave_requests').select('*').eq('employee',currentUser).order('created_at',{ascending:false}),
    sb.from('annual_leave').select('working_days').eq('employee',currentUser).gte('start_date',year+'-01-01').lte('start_date',year+'-12-31'),
    sb.from('unified_sessions').select('total_hours,team_members,employee,session_date').gte('session_date',prevMonth+'-01').lte('session_date',month+'-31'),
  ]);
  var sessions=results[0].data, compoffs=results[1].data, coReqs=results[2].data;
  var lvReqs=results[3].data, alData=results[4].data, pjSess=results[5].data;

  var s = calcSummary(sessions||[], compoffs||[], currentUser);
  var leaveUsed = (alData||[]).reduce(function(a,r){return a+parseFloat(r.working_days||0);},0);
  var leaveBalance = LEAVE_ALLOWANCE - leaveUsed;
  var monthApproved = (sessions||[]).filter(function(x){return (x.ot_date||'').startsWith(month) && (x.status==='approved'||!x.status);});
  var prevMonthApproved = (sessions||[]).filter(function(x){return (x.ot_date||'').startsWith(prevMonth) && (x.status==='approved'||!x.status);});
  var otThisMonth = monthApproved.length;
  var otLastMonth = prevMonthApproved.length;
  var otHrsThisMonth = monthApproved.reduce(function(a,x){return a+parseFloat(x.credited_hours||0);},0);
  var fn = (currentUser||'').split(' ')[0].toLowerCase();
  var pjHrsMonth = 0, pjHrsPrev = 0;
  (pjSess||[]).forEach(function(r){
    var team = (r.team_members||r.employee||'').toLowerCase();
    if(!team.includes(fn)) return;
    var hrs = parseFloat(r.total_hours||0);
    var d = (r.session_date||'');
    if (d.startsWith(month))      pjHrsMonth += hrs;
    else if (d.startsWith(prevMonth)) pjHrsPrev += hrs;
  });

  var recent = (sessions||[]).filter(function(x){return x.status==='approved'||!x.status;}).sort(function(a,b){return a.ot_date>b.ot_date?-1:1;}).slice(0,5);
  var pendingCO = (coReqs||[]).filter(function(r){return r.status==='pending';});
  var pendingLV = (lvReqs||[]).filter(function(r){return r.status==='pending';});
  var pendingOT = (sessions||[]).filter(function(r){return r.status==='pending';});
  var balColor  = s.balance>0?'var(--success)':s.balance<0?'var(--danger)':'var(--navy)';
  var lvColor   = leaveBalance<=5?'var(--danger)':leaveBalance<=10?'var(--gold)':'var(--success)';
  var hr = new Date().getHours();
  var greet = hr<12?'Good morning':hr<17?'Good afternoon':'Good evening';
  var today = new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  var firstName = (currentUser||'').split(' ')[0] || '';

  // === GREETING ===
  var html = '<div class="dash-hero">'+
    '<div class="dash-hero-text">'+
      '<h2>'+greet+', '+firstName+'</h2>'+
      '<div class="dash-hero-date">'+today+'</div>'+
    '</div></div>';

  // === STATS GRID === (no 160h target progress bar — that was aspirational)
  html += '<div class="dash-stats">'+
    '<div class="stat-card green"><div class="stat-label">CO Balance</div>'+
      '<div class="stat-value" style="color:'+balColor+'">'+fmtNum(s.balance)+'</div>'+
      '<div class="stat-sub">Earned '+fmtNum(s.totalCO)+' &middot; Used '+fmtNum(s.used)+'</div></div>'+
    '<div class="stat-card teal"><div class="stat-label">Annual Leave</div>'+
      '<div class="stat-value" style="color:'+lvColor+'">'+fmtNum(leaveBalance)+'</div>'+
      '<div class="stat-sub">of '+LEAVE_ALLOWANCE+' days &middot; '+year+'</div></div>'+
    '<div class="stat-card navy"><div class="stat-label">OT &mdash; '+monthName+'</div>'+
      '<div class="stat-value">'+fmtNum(otThisMonth)+trendPill(otThisMonth, otLastMonth, '')+'</div>'+
      '<div class="stat-sub">'+fmtNum(otHrsThisMonth)+'h credited</div></div>'+
    '<div class="stat-card eve"><div class="stat-label">Project Hours &mdash; '+monthName+'</div>'+
      '<div class="stat-value">'+fmtNum(pjHrsMonth)+'<span class="stat-unit">h</span>'+trendPill(pjHrsMonth, pjHrsPrev, 'h')+'</div>'+
      '<div class="stat-sub">vs '+fmtNum(pjHrsPrev)+'h last month</div></div>'+
    '</div>';

  // === QUICK ACTIONS ===
  html += '<div class="card"><div class="card-title">Quick Actions</div>'+
    '<div class="quick-actions-wrap">'+
    '<button class="btn btn-primary" onclick="showScreen(\'projects\');showProjectTab(\'uslog\')">Log Session</button>'+
    '<button class="btn btn-ghost" onclick="showScreen(\'leave\');showLeaveTab(\'log\')">Request Leave</button>'+
    '<button class="btn btn-ghost" onclick="showScreen(\'leave\');showLeaveTab(\'log\');document.getElementById(\'lv-type\').value=\'compoff_full\';onLeaveTypeChange()">Comp Off</button>'+
    '</div></div>';

  // === MY PENDING REQUESTS ===
  if (pendingCO.length || pendingLV.length || pendingOT.length) {
    html += '<div class="card"><div class="card-title">My Pending Requests</div>';
    pendingOT.forEach(function(r){ html += '<div class="request-card pending" style="margin-bottom:8px">OT Session &middot; '+r.activity+' &middot; '+fmtDate(r.ot_date)+' ('+r.band+' '+r.duration_hours+'h)<span class="badge badge-pending" style="margin-left:8px">Awaiting approval</span></div>'; });
    pendingCO.forEach(function(r){ html += '<div class="request-card pending" style="margin-bottom:8px">Comp Off &middot; '+r.type+' &middot; '+fmtDate(r.request_date)+'<span class="badge badge-pending" style="margin-left:8px">Pending</span></div>'; });
    pendingLV.forEach(function(r){ html += '<div class="request-card pending" style="margin-bottom:8px">Leave &middot; '+fmtDate(r.start_date)+' to '+fmtDate(r.end_date)+' &middot; '+r.working_days+' days<span class="badge badge-pending" style="margin-left:8px">Pending</span></div>'; });
    html += '</div>';
  }

  // === RECENT OT SESSIONS ===
  html += '<div class="card"><div class="flex-between mb-4">'+
    '<div class="card-title" style="margin-bottom:0">Recent OT Sessions</div>'+
    '<button class="btn btn-sm btn-ghost" onclick="showScreen(\'projects\');showProjectTab(\'otsessions\')">View All</button></div>';
  if (recent.length) {
    html += '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Activity</th><th>Band</th><th>Rate</th><th>Credited</th></tr></thead><tbody>';
    recent.forEach(function(r){
      html += '<tr><td style="font-size:12px">'+fmtDate(r.ot_date)+'</td>'+
        '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+r.activity+'</td>'+
        '<td>'+bandBadge(r)+'</td>'+
        '<td><span class="badge '+(r.rate==='1:2'?'badge-12':'badge-11')+'">'+r.rate+'</span></td>'+
        '<td><strong style="color:var(--teal)">'+r.credited_hours+'h</strong>'+creditDriftMarker(r)+'</td></tr>';
    });
    html += '</tbody></table></div>';
  } else {
    html += '<div class="dash-empty">'+
      '<i data-lucide="clock" class="empty-icon-svg"></i>'+
      '<div class="dash-empty-title">No OT logged yet</div>'+
      '<div class="dash-empty-sub">When you put in extra hours, log them here so they count toward your comp off.</div>'+
      '<button class="btn btn-primary" onclick="showScreen(\'projects\');showProjectTab(\'uslog\')">Log a session</button>'+
      '</div>';
  }
  html += '</div>';

  document.getElementById('dash-content').innerHTML = html;
  if (typeof renderIcons === 'function') renderIcons();
}

// == MANAGER DASHBOARD ============================================
async function renderManagerDashboard() {
  var now = new Date();
  var monthName = now.toLocaleString('default',{month:'long'});
  var monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  var todayISO   = now.toISOString().slice(0,10);
  var sevenAgo   = new Date(now.getTime() - 7*86400000).toISOString().slice(0,10);
  var thirtyAhead= new Date(now.getTime() + 30*86400000).toISOString().slice(0,10);

  var hr = now.getHours();
  var greet = hr<12?'Good morning':hr<17?'Good afternoon':'Good evening';
  var todayLabel = now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  var firstName = (currentUser||'').split(' ')[0] || '';

  var results = await Promise.all([
    // Pending approval queues (3 sources)
    sb.from('comp_off_requests').select('id').eq('status','pending'),
    sb.from('leave_requests').select('id').eq('status','pending'),
    sb.from('ot_sessions').select('id').eq('status','pending'),
    // Team OT this month (approved only)
    sb.from('ot_sessions').select('credited_hours,employee').eq('status','approved').gte('ot_date', monthStart),
    // Upcoming approved leave in next 30 days
    sb.from('annual_leave').select('employee,start_date,end_date,working_days,reason').gte('start_date', todayISO).lte('start_date', thirtyAhead),
    // Active engagements
    sb.from('engagements').select('id,name,status').eq('status','active'),
    // Sessions this week (last 7 days)
    sb.from('unified_sessions').select('id,employee,team_members,session_date,total_hours,engagement_name').gte('session_date', sevenAgo),
    // Recent OT submissions for activity feed (last 7 days)
    sb.from('ot_sessions').select('id,employee,ot_date,credited_hours,band,activity,status,created_at').gte('created_at', sevenAgo+'T00:00:00').order('created_at',{ascending:false})
  ]);
  var coPending = (results[0].data||[]).length;
  var lvPending = (results[1].data||[]).length;
  var otPending = (results[2].data||[]).length;
  var teamPending = coPending + lvPending + otPending;

  var teamOTHrs = (results[3].data||[]).reduce(function(a,r){return a+parseFloat(r.credited_hours||0);},0);
  var upcomingLeaves = results[4].data || [];
  var upcomingLeaveDays = upcomingLeaves.reduce(function(a,r){return a+parseFloat(r.working_days||0);},0);
  var activeProjects = results[5].data || [];
  var weekSessions = results[6].data || [];
  var recentOT = results[7].data || [];

  var shortName = function(emp) {
    return (typeof empShortName === 'function') ? empShortName(emp) : (emp||'').split(' ')[0];
  };

  // === GREETING ===
  var html = '<div class="dash-hero">'+
    '<div class="dash-hero-text">'+
      '<h2>'+greet+', '+firstName+'</h2>'+
      '<div class="dash-hero-date">'+todayLabel+'</div>'+
    '</div></div>';

  // === PENDING APPROVALS HERO CARD ===
  if (teamPending > 0) {
    html += '<div class="card" style="background:linear-gradient(135deg,#0A1F5C 0%,#1E3A8A 100%);color:#fff;margin-bottom:16px">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">'+
        '<div>'+
          '<div style="font-size:13px;opacity:.85;text-transform:uppercase;letter-spacing:.5px;font-weight:600">Pending Approvals</div>'+
          '<div style="font-size:36px;font-weight:700;font-family:DM Mono,monospace;line-height:1.1;margin-top:4px">'+teamPending+'</div>'+
          '<div style="font-size:13px;opacity:.85;margin-top:4px">'+
            (otPending>0?otPending+' OT &middot; ':'')+
            (coPending>0?coPending+' Comp Off &middot; ':'')+
            (lvPending>0?lvPending+' Leave':'')+
          '</div>'+
        '</div>'+
        '<button class="btn" style="background:#fff;color:var(--navy);font-weight:600" onclick="showScreen(\'approvals\')">Review Approvals &rarr;</button>'+
      '</div>'+
    '</div>';
  } else {
    html += '<div class="card" style="margin-bottom:16px;text-align:center;padding:20px">'+
      '<div style="font-size:14px;color:var(--muted)">'+
        '<span style="color:var(--success);font-size:18px;margin-right:6px">✓</span>'+
        'All caught up — no pending approvals'+
      '</div>'+
    '</div>';
  }

  // === TEAM STATS GRID ===
  html += '<div class="dash-stats">'+
    '<div class="stat-card navy"><div class="stat-label">Team OT &mdash; '+monthName+'</div>'+
      '<div class="stat-value">'+fmtNum(teamOTHrs)+'<span class="stat-unit">h</span></div>'+
      '<div class="stat-sub">credited across the team</div></div>'+
    '<div class="stat-card teal"><div class="stat-label">Leave next 30 days</div>'+
      '<div class="stat-value">'+fmtNum(upcomingLeaveDays)+'</div>'+
      '<div class="stat-sub">'+upcomingLeaves.length+' approved request'+(upcomingLeaves.length===1?'':'s')+'</div></div>'+
    '<div class="stat-card green"><div class="stat-label">Active Projects</div>'+
      '<div class="stat-value">'+fmtNum(activeProjects.length)+'</div>'+
      '<div class="stat-sub">engagements in flight</div></div>'+
    '<div class="stat-card eve"><div class="stat-label">Sessions this week</div>'+
      '<div class="stat-value">'+fmtNum(weekSessions.length)+'</div>'+
      '<div class="stat-sub">logged in last 7 days</div></div>'+
    '</div>';

  // === MANAGER QUICK ACTIONS ===
  html += '<div class="card"><div class="card-title">Quick Actions</div>'+
    '<div class="quick-actions-wrap">'+
    '<button class="btn btn-primary" onclick="showScreen(\'approvals\')">Review Approvals'+(teamPending>0?' <span class="badge badge-pending" style="margin-left:6px">'+teamPending+'</span>':'')+'</button>'+
    '<button class="btn btn-ghost" onclick="backupExcel(\'all\')"><i data-lucide="download" class="btn-icon"></i>Run Backup</button>'+
    '<button class="btn btn-ghost" onclick="showScreen(\'projects\');showProjectTab(\'manage\')">Manage Projects</button>'+
    '</div></div>';

  // === ACTIVITY FEED — last 7 days ===
  // Merge three sources into one chronological feed:
  //   - OT submissions (created_at)
  //   - Upcoming approved leave (start_date)
  //   - Project / unified sessions logged (session_date)
  var feed = [];

  recentOT.forEach(function(r){
    var statusBit = r.status === 'pending' ? '<span class="badge badge-pending" style="margin-left:6px">pending</span>' :
                    r.status === 'approved' ? '<span class="badge badge-approved" style="margin-left:6px">approved</span>' :
                    r.status === 'rejected' ? '<span class="badge badge-rejected" style="margin-left:6px">rejected</span>' : '';
    var when = relDate(r.ot_date);
    feed.push({
      ts: r.created_at || r.ot_date,
      html: '<div class="request-card" style="margin-bottom:8px;cursor:pointer" onclick="showScreen(\'approvals\')">'+
        '<strong>'+esc2(shortName(r.employee))+'</strong> submitted '+
        fmtNum(r.credited_hours||0)+'h '+bandBadge(r)+' OT '+when+
        statusBit+
      '</div>'
    });
  });

  upcomingLeaves.forEach(function(r){
    var when = relDate(r.start_date);
    var days = parseFloat(r.working_days||0);
    feed.push({
      ts: r.start_date,
      html: '<div class="request-card" style="margin-bottom:8px">'+
        '<strong>'+esc2(shortName(r.employee))+'</strong> starts annual leave '+when+' ('+fmtNum(days)+' day'+(days===1?'':'s')+')'+
      '</div>'
    });
  });

  weekSessions.forEach(function(r){
    var loggers = (r.team_members && r.team_members.trim()) ? r.team_members.split(',').map(function(s){return s.trim();}).filter(Boolean) : [r.employee];
    var primary = loggers[0] || r.employee;
    var others = loggers.length > 1 ? ' +'+(loggers.length-1) : '';
    var when = relDate(r.session_date);
    feed.push({
      ts: r.session_date,
      html: '<div class="request-card" style="margin-bottom:8px">'+
        '<strong>'+esc2(shortName(primary))+others+'</strong> logged '+
        fmtNum(r.total_hours||0)+'h on <strong>'+esc2(r.engagement_name||'(unspecified)')+'</strong> '+when+
      '</div>'
    });
  });

  feed.sort(function(a,b){ return (b.ts||'') > (a.ts||'') ? 1 : -1; });
  var topFeed = feed.slice(0, 8);

  html += '<div class="card"><div class="card-title">What\'s happening this week</div>';
  if (topFeed.length === 0) {
    html += '<div class="dash-empty">'+
      '<i data-lucide="coffee" class="empty-icon-svg"></i>'+
      '<div class="dash-empty-title">Quiet week</div>'+
      '<div class="dash-empty-sub">No OT submissions, leave starts, or session logs in the last 7 days.</div>'+
    '</div>';
  } else {
    html += topFeed.map(function(it){ return it.html; }).join('');
  }
  html += '</div>';

  // === REPORTS & BACKUP (manager-only) ===
  html += '<div class="card dash-backup">'+
    '<div class="card-title">Reports &amp; Backup</div>'+
    '<div style="font-size:13px;color:var(--muted);margin-bottom:14px">Download the full database snapshot, the monthly OT report, or a single-table export.</div>'+
    '<div class="dash-backup-row">'+
      '<button class="btn btn-primary" onclick="backupExcel(\'all\')"><i data-lucide="download" class="btn-icon"></i>Full Backup (all sheets)</button>'+
      '<button class="btn btn-ghost" id="monthly-report-btn" onclick="downloadMonthlyReport()"><i data-lucide="file-text" class="btn-icon"></i>Monthly OT Report</button>'+
    '</div>'+
    '<details class="dash-backup-details">'+
      '<summary>Export a specific section</summary>'+
      '<div class="dash-backup-grid">'+
        '<button class="btn btn-ghost btn-sm" onclick="backupExcel(\'ot_sessions\')">OT Sessions</button>'+
        '<button class="btn btn-ghost btn-sm" onclick="backupExcel(\'project_sessions\')">Project Sessions</button>'+
        '<button class="btn btn-ghost btn-sm" onclick="backupExcel(\'inventory\')">Inventory</button>'+
        '<button class="btn btn-ghost btn-sm" onclick="backupExcel(\'leave\')">Leaves</button>'+
        '<button class="btn btn-ghost btn-sm" onclick="backupExcel(\'comp_off\')">Comp Offs</button>'+
        '<button class="btn btn-ghost btn-sm" onclick="backupExcel(\'kb_articles\')">Knowledge Base</button>'+
        '<button class="btn btn-ghost btn-sm" onclick="backupExcel(\'directory\')">Customers + Projects</button>'+
      '</div>'+
    '</details>'+
    '</div>';

  document.getElementById('dash-content').innerHTML = html;
  if (typeof renderIcons === 'function') renderIcons();
}

// == EXCEL BACKUP =================================================
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
