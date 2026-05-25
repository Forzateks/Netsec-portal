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
// fmtNum is a thin compatibility wrapper around fmtNumber (helpers.js).
// Kept so any external callers using fmtNum() keep working; new code
// should call fmtNumber/fmtHours/fmtDays/fmtPct/fmtCount directly.
function fmtNum(n) {
  return fmtNumber(n, 1);
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

// == HOURS-BY-X DASHBOARD CARDS (v79) =============================
// Two side-by-side pie cards on Dashboard: Top 8 Engagements and Top 8
// Customers by hours for the current calendar year. Aggregation matches
// the Reports → Engagement Summary semantics (session-level total_hours,
// no per-member fan-out), so the two views never disagree.

var DASH_TOP_N = 8;
var DASH_PIE_COLORS = ['#0A1F5C','#00A0D2','#C8A832','#3B82F6','#10B981','#8B5CF6','#F59E0B','#EF4444','#6B7280'];

// Group rows by keyField, sum total_hours, return top-N + "Other (rest)"
// bucket. Rows with empty/null key are skipped (per spec).
function _dashAggregateTopHours(rows, keyField, n) {
  var totals = {};
  (rows||[]).forEach(function(r){
    var key = (r[keyField] || '').trim();
    if (!key) return;
    totals[key] = (totals[key] || 0) + parseFloat(r.total_hours || 0);
  });
  var sortedKeys = Object.keys(totals).sort(function(a,b){ return totals[b] - totals[a]; });
  var top = sortedKeys.slice(0, n);
  var rest = sortedKeys.slice(n);
  var result = top.map(function(k){ return { label: k, value: totals[k] }; });
  if (rest.length) {
    var otherSum = rest.reduce(function(s,k){ return s + totals[k]; }, 0);
    if (otherSum > 0) result.push({ label: 'Other ('+rest.length+')', value: otherSum });
  }
  return result;
}

// Build one Hours-by-X card. Empty branch keeps the card visible so users
// see the layout consistently even before any data exists for the year.
function _dashBuildHoursCard(title, year, data, navOnClick) {
  var total = data.reduce(function(s,d){ return s + d.value; }, 0);
  if (!data.length || total === 0) {
    return '<div class="card dash-hours-card">'+
      '<div class="card-title" style="margin-bottom:6px">'+esc2(title)+'</div>'+
      '<div class="dash-empty" style="padding:24px 12px">'+
        '<i data-lucide="pie-chart" class="empty-icon-svg"></i>'+
        '<div class="dash-empty-title">No data yet for '+year+'</div>'+
        '<div class="dash-empty-sub">Log some sessions and totals will appear here.</div>'+
      '</div>'+
    '</div>';
  }
  var colored = data.map(function(d,i){
    return { label: d.label, value: d.value, color: DASH_PIE_COLORS[i%DASH_PIE_COLORS.length] };
  });
  return '<div class="card dash-hours-card" role="button" tabindex="0" '+
         'onclick="'+navOnClick+'" '+
         'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();this.click();}" '+
         'style="cursor:pointer">'+
    '<div class="card-title" style="margin-bottom:6px">'+esc2(title)+'</div>'+
    buildPieChart(colored, 'h')+
  '</div>';
}

// Navigate Dashboard → Reports (Engagement Summary) with the year filter
// pre-set. Engagement Summary lazy-populates its year dropdown inside the
// render, so we stash the desired year on window and the render picks it
// up before reading the dropdown value.
function dashOpenEngagementSummary(year) {
  window._engSumPrefilterYear = String(year);
  if (typeof showScreen === 'function') showScreen('projects');
  if (typeof showProjectTab === 'function') showProjectTab('engagement');
}

// == WHAT'S NEW CARD (v92) ========================================
// Curated, JSON-driven rotating tips. Visit-based shuffle persisted
// in localStorage: refreshing the dashboard shows the SAME tip until
// the user clicks Next or Got it. Adding a new tip to whats-new.json
// triggers an automatic reshuffle on every existing user's next load
// (detected via last_shuffle_size).
//
// Storage keys:
//   whatsnew_shuffle_order     — array of tip IDs in shuffled order
//   whatsnew_current_index     — int, position in the shuffle
//   whatsnew_dismissed_ids     — array of tip IDs the user clicked Got it on
//   whatsnew_last_shuffle_size — int, count of active items at last shuffle

var WHATS_NEW_DATA = null;     // cached after first fetch

// Route dispatcher — JSON tip.link is a route key, not a URL. The hash-
// based /#team path is reserved for the public Team Portfolio route;
// every other navigation goes through showScreen()/navigateSub() which
// don't use hash routing. Keep this list aligned with whats-new.json.
var WHATS_NEW_ROUTES = {
  'customer-summary':  function(){ if (typeof navigateSub === 'function') navigateSub('projects','customer'); },
  'engagement-summary':function(){ if (typeof navigateSub === 'function') navigateSub('projects','engagement'); },
  'employee-summary':  function(){ if (typeof navigateSub === 'function') navigateSub('projects','employee'); },
  'team-skills':       function(){ if (typeof showScreen === 'function') showScreen('skills'); },
  'team':              function(){ if (typeof navigateToTeamRoute === 'function') navigateToTeamRoute('meet'); else if (typeof showScreen === 'function') showScreen('team'); },
  'leave':             function(){ if (typeof showScreen === 'function') showScreen('leave'); },
  'certificates':      function(){ if (typeof showScreen === 'function') showScreen('certificates'); },
  'knowledge-base':    function(){ if (typeof showScreen === 'function') showScreen('kb'); },
  'my-sessions':       function(){ if (typeof navigateSub === 'function') navigateSub('projects','ussess'); },
  'approvals':         function(){ if (typeof showScreen === 'function') showScreen('approvals'); },
  'log-session':       function(){ if (typeof navigateSub === 'function') navigateSub('projects','uslog'); }
};

var WHATS_NEW_CATEGORY_META = {
  'new': { label: '🆕 New', cls: 'wn-cat-new' },
  'tip': { label: '💡 Tip', cls: 'wn-cat-tip' },
  'app': { label: '📱 App', cls: 'wn-cat-app' }
};

async function _whatsNewLoad() {
  if (WHATS_NEW_DATA) return WHATS_NEW_DATA;
  try {
    var res = await fetch('data/whats-new.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var json = await res.json();
    WHATS_NEW_DATA = (json && Array.isArray(json.items)) ? json.items : [];
  } catch (e) {
    console.warn('whats-new.json load failed:', e);
    WHATS_NEW_DATA = [];   // empty → card hides itself
  }
  return WHATS_NEW_DATA;
}

// Defensive localStorage helpers — wraps the get/set so a private-mode
// SecurityError doesn't break the dashboard. Reads default to '[]' /
// '0'. Writes silently fail (acceptable degraded mode — shuffle still
// works, just doesn't persist across refreshes).
function _wnLsGet(key, dflt) {
  try { var v = localStorage.getItem(key); return v == null ? dflt : v; }
  catch (e) { return dflt; }
}
function _wnLsSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* private mode etc. */ }
}
function _wnParseArr(s) { try { var a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function _wnShuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// Pick the tip to show on this render. Returns null when:
//   - JSON failed to load
//   - items array empty
//   - user has dismissed every tip
function _whatsNewPickTip(allItems) {
  if (!allItems || !allItems.length) return null;
  var dismissed = _wnParseArr(_wnLsGet('whatsnew_dismissed_ids', '[]'));
  var dismissedSet = {};
  dismissed.forEach(function(id){ dismissedSet[id] = 1; });

  var active = allItems.filter(function(it){ return !dismissedSet[it.id]; });
  if (!active.length) return null;

  var order = _wnParseArr(_wnLsGet('whatsnew_shuffle_order', '[]'));
  var lastSize = parseInt(_wnLsGet('whatsnew_last_shuffle_size', '0'), 10) || 0;
  var idx = parseInt(_wnLsGet('whatsnew_current_index', '0'), 10) || 0;

  // Reshuffle conditions: never shuffled, JSON grew (new tip added since
  // last shuffle — most common reshuffle trigger), or the existing order
  // contains an id that was just dismissed (would otherwise show a
  // dismissed tip until end-of-shuffle).
  var hasStaleDismissed = order.some(function(id){ return dismissedSet[id]; });
  var needsReshuffle = !order.length || active.length > lastSize || hasStaleDismissed;
  if (needsReshuffle) {
    order = _wnShuffle(active.map(function(it){ return it.id; }));
    idx = 0;
    _wnLsSet('whatsnew_shuffle_order', JSON.stringify(order));
    _wnLsSet('whatsnew_last_shuffle_size', String(active.length));
    _wnLsSet('whatsnew_current_index', '0');
  }
  // End-of-cycle: reshuffle for a fresh round.
  if (idx >= order.length) {
    order = _wnShuffle(active.map(function(it){ return it.id; }));
    idx = 0;
    _wnLsSet('whatsnew_shuffle_order', JSON.stringify(order));
    _wnLsSet('whatsnew_current_index', '0');
  }

  var currentId = order[idx];
  var tip = allItems.find(function(it){ return it.id === currentId; });
  // If currentId got purged from JSON (rare) fall through to the next index.
  if (!tip) {
    _wnLsSet('whatsnew_current_index', String(idx + 1));
    return _whatsNewPickTip(allItems);
  }
  return tip;
}

function _whatsNewCardHtml(tip) {
  var meta = WHATS_NEW_CATEGORY_META[tip.category] || WHATS_NEW_CATEGORY_META['tip'];
  var linkBtn = '';
  if (tip.link && tip.link_text && WHATS_NEW_ROUTES[tip.link]) {
    linkBtn = '<button class="btn btn-sm btn-primary wn-link-btn" onclick="whatsNewFollowLink(\''+esc2(tip.link)+'\')">'+esc2(tip.link_text)+' <span class="wn-link-arrow">→</span></button>';
  }
  return '<div class="card wn-card">'+
    '<div class="wn-head">'+
      '<div class="wn-head-label">💡 What\'s New</div>'+
      '<span class="wn-cat-badge '+meta.cls+'">'+meta.label+'</span>'+
    '</div>'+
    '<div class="wn-title">'+esc2(tip.title)+'</div>'+
    '<div class="wn-body">'+esc2(tip.body)+'</div>'+
    '<div class="wn-actions">'+
      linkBtn+
      '<div class="wn-actions-right">'+
        '<button class="btn btn-sm btn-ghost wn-got-it-btn" onclick="whatsNewDismiss(\''+esc2(tip.id)+'\')">Got it</button>'+
        '<button class="btn btn-sm btn-ghost wn-next-btn" title="Next tip" onclick="whatsNewNext()">→</button>'+
      '</div>'+
    '</div>'+
  '</div>';
}

// Returns the HTML string to inject between greeting and the rest of
// the dashboard. Empty string when there's no tip to show — caller
// concatenates so we don't need a separate "hide if empty" branch.
async function whatsNewRenderHtml() {
  var items = await _whatsNewLoad();
  var tip = _whatsNewPickTip(items);
  if (!tip) {
    // All-caught-up state: brief inline confirmation that fades. Only
    // surface when the user has actively dismissed everything (not when
    // the JSON itself is empty / failed to load — that gets hidden).
    var dismissed = _wnParseArr(_wnLsGet('whatsnew_dismissed_ids', '[]'));
    if (items.length && dismissed.length >= items.length) {
      return '<div class="card wn-card wn-card-empty">'+
        '<div class="wn-head"><div class="wn-head-label">💡 What\'s New</div></div>'+
        '<div class="wn-empty">You\'re all caught up 🎉 New tips will appear here as the app evolves.</div>'+
      '</div>';
    }
    return '';
  }
  return _whatsNewCardHtml(tip);
}

// Click handlers — global so onclick="..." can find them.
function whatsNewNext() {
  var idx = parseInt(_wnLsGet('whatsnew_current_index', '0'), 10) || 0;
  _wnLsSet('whatsnew_current_index', String(idx + 1));
  _whatsNewRerender();
}
function whatsNewDismiss(tipId) {
  var dismissed = _wnParseArr(_wnLsGet('whatsnew_dismissed_ids', '[]'));
  if (dismissed.indexOf(tipId) === -1) dismissed.push(tipId);
  _wnLsSet('whatsnew_dismissed_ids', JSON.stringify(dismissed));
  whatsNewNext();   // advance to next + re-render
}
function whatsNewFollowLink(routeKey) {
  var fn = WHATS_NEW_ROUTES[routeKey];
  if (typeof fn === 'function') fn();
}

// Re-render JUST the What's New card in place. Cheap path so Next/Got
// It don't trigger a full dashboard re-fetch. If the card host element
// isn't present (e.g. user navigated away mid-click), bail silently.
async function _whatsNewRerender() {
  var host = document.getElementById('whats-new-mount');
  if (!host) return;
  host.innerHTML = await whatsNewRenderHtml();
  if (typeof renderIcons === 'function') renderIcons();
}

// == DASHBOARD ROUTER =============================================
async function renderDashboard() {
  var host = document.getElementById('dash-content');
  // Reset the rendered flag at the start of each render so the watchdog
  // can correctly detect a hang in this run (not match the previous one).
  delete host.dataset.rendered;
  host.innerHTML = dashSkeleton();
  // Watchdog: if the dashboard hasn't painted real content in 12s the
  // user gets a visible "Network slow — tap to retry" panel. We track
  // success with a positive flag set by the inner render functions
  // (renderManagerDashboard / renderEmployeeDashboard) when they finish
  // writing real content; otherwise we'd false-positive on the skeleton.
  var watchdog = setTimeout(function(){
    if (!host || host.dataset.rendered === 'true') return;
    host.innerHTML =
      '<div class="card" style="text-align:center;padding:32px 18px">'+
        '<div style="font-size:14px;color:var(--navy);font-weight:600;margin-bottom:6px">Network is slow.</div>'+
        '<div style="font-size:12px;color:var(--muted);margin-bottom:18px">Some queries are taking longer than expected.</div>'+
        '<button class="btn btn-primary" onclick="renderDashboard()">↻ Retry</button>'+
      '</div>';
  }, 12000);
  try {
    if (isManager) await renderManagerDashboard();
    else            await renderEmployeeDashboard();
    host.dataset.rendered = 'true';
    // v95: prepend the backup-staleness banner after the dashboard
    // body has rendered. No-op for users without is_backup_responsible.
    renderBackupReminderBanner();
  } catch (err) {
    console.error('Dashboard render failed:', err);
    host.innerHTML =
      '<div class="card" style="text-align:center;padding:32px 18px">'+
        '<div style="font-size:14px;color:var(--danger);font-weight:600;margin-bottom:6px">Dashboard error</div>'+
        '<div style="font-size:12px;color:var(--muted);margin-bottom:18px;word-break:break-word">'+
          esc2(String(err && err.message || err))+
        '</div>'+
        '<button class="btn btn-primary" onclick="renderDashboard()">↻ Retry</button>'+
      '</div>';
    host.dataset.rendered = 'true';
  } finally {
    clearTimeout(watchdog);
  }
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
    // Switched from annual_leave to leave_requests in v81 — used days are
    // now computed day-by-day via computeLeaveUsedDays (in leave.js).
    sb.from('leave_requests')
      .select('start_date,end_date,working_days,leave_type,status,employee,effective_end_date')
      .eq('employee',currentUser)
      .gte('start_date',year+'-01-01').lte('start_date',year+'-12-31'),
    sb.from('unified_sessions').select('total_hours,team_members,employee,session_date').gte('session_date',prevMonth+'-01').lte('session_date',month+'-31'),
    // Year-wide aggregate for the Top-8 Engagement / Customer cards.
    // Paginated via fetchAllRows so totals aren't silently capped at 1000.
    fetchAllRows(function(){
      return sb.from('unified_sessions')
        .select('total_hours,engagement_name,customer_name,session_date')
        .gte('session_date', year+'-01-01').lte('session_date', year+'-12-31');
    }),
  ]);
  var sessions=results[0].data, compoffs=results[1].data, coReqs=results[2].data;
  var lvReqs=results[3].data, alData=results[4].data, pjSess=results[5].data;
  var yearSessions = (results[6] && results[6].data) || [];

  var s = calcSummary(sessions||[], compoffs||[], currentUser);
  // alData rows are now from leave_requests; we apply the day-by-day rule via
  // computeLeaveUsedDays so future-dated approvals don't pre-spend the balance.
  var _todayISO = (typeof _leaveTodayISO === 'function') ? _leaveTodayISO() : new Date().toISOString().slice(0,10);
  var leaveUsed = (alData||[])
    .filter(function(r){ return (r.leave_type||'annual') === 'annual'; })
    .reduce(function(a,r){ return a + (typeof computeLeaveUsedDays === 'function' ? computeLeaveUsedDays(r, _todayISO) : parseFloat(r.working_days||0)); }, 0);
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
  // v90: static "Good day" — replaced the time-aware morning/afternoon/
  // evening ternary at Venkat's request. Less noise; ambiguous time
  // windows (e.g. 11:59 → "morning", 12:01 → "afternoon") felt fiddly.
  var greet = 'Good day';
  var today = new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  var firstName = (currentUser||'').split(' ')[0] || '';

  // === GREETING ===
  var html = '<div class="dash-hero">'+
    '<div class="dash-hero-text">'+
      '<h2>'+greet+', '+firstName+'</h2>'+
      '<div class="dash-hero-date">'+today+'</div>'+
    '</div></div>';

  // === WHAT'S NEW (v92) ===
  // Mount point — content injected after the main fetch resolves so the
  // stats query isn't blocked on JSON fetch latency. Empty until then.
  html += '<div id="whats-new-mount"></div>';

  // === STATS GRID === (no 160h target progress bar — that was aspirational)
  html += '<div class="dash-stats">'+
    '<div class="stat-card green"><div class="stat-label">CO Balance</div>'+
      '<div class="stat-value" style="color:'+balColor+'"><span data-counter="'+s.balance+'">'+fmtNumber(s.balance,1)+'</span></div>'+
      '<div class="stat-sub">Earned '+fmtNumber(s.totalCO,1)+' &middot; Used '+fmtNumber(s.used,1)+'</div></div>'+
    '<div class="stat-card teal"><div class="stat-label">Annual Leave</div>'+
      '<div class="stat-value" style="color:'+lvColor+'"><span data-counter="'+leaveBalance+'">'+fmtNumber(leaveBalance,1)+'</span></div>'+
      '<div class="stat-sub">of '+fmtDays(LEAVE_ALLOWANCE)+' &middot; '+year+'</div></div>'+
    '<div class="stat-card navy"><div class="stat-label">OT &mdash; '+monthName+'</div>'+
      '<div class="stat-value"><span data-counter="'+otThisMonth+'">'+fmtCount(otThisMonth)+'</span>'+trendPill(otThisMonth, otLastMonth, '')+'</div>'+
      '<div class="stat-sub">'+fmtHours(otHrsThisMonth)+' credited</div></div>'+
    '<div class="stat-card eve"><div class="stat-label">Project Hours &mdash; '+monthName+'</div>'+
      '<div class="stat-value"><span data-counter="'+pjHrsMonth+'" data-counter-decimals="1">'+fmtNumber(pjHrsMonth,1)+'</span><span class="stat-unit">h</span>'+trendPill(pjHrsMonth, pjHrsPrev, 'h')+'</div>'+
      '<div class="stat-sub">vs '+fmtHours(pjHrsPrev)+' last month</div></div>'+
    '</div>';

  // === HOURS BY ENGAGEMENT / CUSTOMER (Top 8, current year) ===
  var engTop = _dashAggregateTopHours(yearSessions, 'engagement_name', DASH_TOP_N);
  var custTop = _dashAggregateTopHours(yearSessions, 'customer_name', DASH_TOP_N);
  var navCall = 'dashOpenEngagementSummary('+year+')';
  html += '<div class="dash-hours-row">'+
    _dashBuildHoursCard('Hours by Engagement (Top 8 · '+year+')', year, engTop, navCall)+
    _dashBuildHoursCard('Hours by Customer (Top 8 · '+year+')',  year, custTop, navCall)+
  '</div>';

  // === MY PENDING REQUESTS ===
  if (pendingCO.length || pendingLV.length || pendingOT.length) {
    html += '<div class="card"><div class="card-title">My Pending Requests</div>';
    pendingOT.forEach(function(r){ html += '<div class="request-card pending" style="margin-bottom:8px">OT Session &middot; '+r.activity+' &middot; '+fmtDate(r.ot_date)+' ('+r.band+' '+fmtHours(r.duration_hours)+')<span class="badge badge-pending" style="margin-left:8px">Awaiting approval</span></div>'; });
    pendingCO.forEach(function(r){ html += '<div class="request-card pending" style="margin-bottom:8px">Comp Off &middot; '+r.type+' &middot; '+fmtDate(r.request_date)+'<span class="badge badge-pending" style="margin-left:8px">Pending</span></div>'; });
    pendingLV.forEach(function(r){ html += '<div class="request-card pending" style="margin-bottom:8px">Leave &middot; '+fmtDateRange(r.start_date, r.end_date)+' &middot; '+fmtDays(r.working_days)+'<span class="badge badge-pending" style="margin-left:8px">Pending</span></div>'; });
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
        '<td><strong style="color:var(--teal)">'+fmtHours(r.credited_hours)+'</strong>'+creditDriftMarker(r)+'</td></tr>';
    });
    html += '</tbody></table></div>';
  } else {
    html += '<div class="dash-empty">'+
      '<i data-lucide="timer" class="empty-icon-svg"></i>'+
      '<div class="dash-empty-title">No OT logged yet</div>'+
      '<div class="dash-empty-sub">When you put in extra hours, log them here so they count toward your comp off.</div>'+
      '<button class="btn btn-primary" onclick="showScreen(\'projects\');showProjectTab(\'uslog\')"><i data-lucide="plus" class="btn-icon"></i>Log OT session</button>'+
      '</div>';
  }
  html += '</div>';

  document.getElementById('dash-content').innerHTML = html;
  if (typeof renderIcons === 'function') renderIcons();
  // Run counter animations on every freshly-inserted [data-counter] span.
  // _counterAnimated flag inside animateCountersIn skips elements that have
  // already animated, so this is safe to call multiple times.
  if (typeof animateCountersIn === 'function') {
    animateCountersIn(document.getElementById('dash-content'));
  }
  // v92: populate the What's New mount AFTER the main render. Async, but
  // we don't await — the JSON fetch is cheap and the rest of the
  // dashboard renders immediately regardless of whether it succeeds.
  _whatsNewRerender();
}

// == MANAGER DASHBOARD ============================================
// ── NEEDS YOUR ATTENTION ────────────────────────────────────────────
// Exception-based feed surfaced on the manager dashboard. Each item is a
// single clickable row. Severity sort within each category; spec priority
// order across categories.
//
// Builders are pure functions: pass in the precomputed ctx, get back the
// items array. Render is separate so the empty-state branch is simple.

function _attnDaysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
function _attnDaysUntil(iso) {
  if (!iso) return null;
  // iso is YYYY-MM-DD — compare at midnight to avoid TZ drift.
  return Math.ceil((new Date(iso + 'T00:00:00').getTime() - new Date(new Date().toISOString().slice(0,10) + 'T00:00:00').getTime()) / 86400000);
}

function _buildAttentionItems(ctx) {
  var items = [];

  // 1. Approvals aging — count + oldest age across OT / Leave / CO.
  // Each oldestPendingX is the single row with status=pending older than 48h.
  var agingApprovals = [ctx.oldestPendingOT, ctx.oldestPendingLV, ctx.oldestPendingCO].filter(Boolean);
  if (agingApprovals.length) {
    var oldestDays = Math.max.apply(null, agingApprovals.map(function(a){ return _attnDaysSince(a.created_at) || 0; }));
    var body = agingApprovals.length === 1
      ? '1 approval pending > 48h'
      : agingApprovals.length + ' approvals pending > 48h (oldest: ' + oldestDays + ' day' + (oldestDays===1?'':'s') + ')';
    items.push({ icon:'⏰', subject:'Approvals aging', body:body, severity:oldestDays, onClick:"showScreen('approvals')" });
  }

  // 2. Stalled active engagements — type=project, status=active, no session in 14 days.
  var activeProjectEngagements = (ctx.allEngagements||[]).filter(function(e){
    return e.type === 'project' && e.status === 'active';
  });
  var sessionEngIds = {};
  (ctx.sessions14d||[]).forEach(function(s){ if (s.engagement_id) sessionEngIds[s.engagement_id] = 1; });
  var stalled = activeProjectEngagements
    .filter(function(e){ return !sessionEngIds[e.id]; })
    .map(function(e){
      // No reliable "last session" for these — use 14+ as the threshold.
      // Use tracker_updated_at as a tiebreaker for sort, but display copy is generic.
      return { eng:e, days:_attnDaysSince(e.tracker_updated_at) || 14 };
    })
    .sort(function(a,b){ return b.days - a.days; });
  stalled.forEach(function(s){
    var custName = ctx.custMap[s.eng.customer_id] || '';
    items.push({
      icon: '⏸',
      subject: (custName ? custName + ' — ' : '') + s.eng.name,
      body: 'no activity in 14+ days (status: Active)',
      severity: s.days,
      onClick: "openEngagementInTracker(" + s.eng.id + ")",
      snoozeType: 'stale_engagement',
      snoozeRefId: s.eng.id
    });
  });

  // 3. Sign-off aging — status=sign-off + tracker_updated_at > 30 days ago.
  //    tracker_updated_at is our best proxy for "status changed at" — see the
  //    fetch comment in renderManagerDashboard for the why.
  var signoffAging = (ctx.allEngagements||[])
    .filter(function(e){
      var d = _attnDaysSince(e.tracker_updated_at);
      return e.status === 'sign-off' && d != null && d > 30;
    })
    .sort(function(a,b){ return _attnDaysSince(b.tracker_updated_at) - _attnDaysSince(a.tracker_updated_at); });
  signoffAging.forEach(function(e){
    var custName = ctx.custMap[e.customer_id] || '';
    var d = _attnDaysSince(e.tracker_updated_at);
    items.push({
      icon: '✍️',
      subject: (custName ? custName + ' — ' : '') + e.name,
      body: 'sign-off pending ' + d + ' day' + (d===1?'':'s'),
      severity: d,
      onClick: "openEngagementInTracker(" + e.id + ")"
    });
  });

  // 4. Payment aging — status=payment-pending + tracker_updated_at > 60 days ago.
  var paymentAging = (ctx.allEngagements||[])
    .filter(function(e){
      var d = _attnDaysSince(e.tracker_updated_at);
      return e.status === 'payment-pending' && d != null && d > 60;
    })
    .sort(function(a,b){ return _attnDaysSince(b.tracker_updated_at) - _attnDaysSince(a.tracker_updated_at); });
  paymentAging.forEach(function(e){
    var custName = ctx.custMap[e.customer_id] || '';
    var d = _attnDaysSince(e.tracker_updated_at);
    items.push({
      icon: '💰',
      subject: (custName ? custName + ' — ' : '') + e.name,
      body: 'payment pending ' + d + ' day' + (d===1?'':'s'),
      severity: d,
      onClick: "openEngagementInTracker(" + e.id + ")"
    });
  });

  // 5. Certificate expiry — within next 30 days, closest first.
  (ctx.certs30d||[]).forEach(function(c){
    var d = _attnDaysUntil(c.expiry_date);
    if (d == null) return;
    items.push({
      icon: '🟡',
      subject: c.name + ' — ' + c.employee,
      body: d <= 0 ? 'expires today' : 'expires in ' + d + ' day' + (d===1?'':'s'),
      severity: -d, // sort ascending by days → most urgent first
      onClick: "showScreen('certificates')",
      snoozeType: 'cert_expiring',
      snoozeRefId: c.id
    });
  });

  // 6. AMC renewal — within next 60 days. amc_end_date = renewal point.
  (ctx.amc60d||[]).forEach(function(a){
    var d = _attnDaysUntil(a.amc_end_date);
    if (d == null) return;
    items.push({
      icon: '📅',
      subject: a.customer_name + ' AMC',
      body: d <= 0 ? 'renews today' : 'renews in ' + d + ' day' + (d===1?'':'s'),
      severity: -d,
      onClick: "showScreen('amc');setTimeout(function(){openAMCContractDetail(" + a.id + ");},250)",
      snoozeType: 'amc_renewing',
      snoozeRefId: a.id
    });
  });

  // 7. Leave coverage gap — KSA workday (Sun-Thu) with BOTH KSA engineers on
  //    approved leave, OR UAE workday (Mon-Fri) with 3+ of [Ahmed, Nasif,
  //    Prasanth, Venkatesan] on approved leave. Scan next 14 calendar days.
  var KSA_TEAM = ['Salman Aziz','Mohammed Afsal'];
  var UAE_TEAM = ['Ahmed Ali','Mohammed Nasif','Prasanth','Venkatesan'];
  var approvedLeaves = (ctx.leavesWindow||[]); // annual_leave rows = already approved per schema
  function _onLeave(emp, isoDate) {
    return approvedLeaves.some(function(r){
      return r.employee === emp && r.start_date <= isoDate && r.end_date >= isoDate;
    });
  }
  var today0 = new Date(); today0.setHours(0,0,0,0);
  for (var i = 0; i < 14; i++) {
    var d = new Date(today0.getTime() + i*86400000);
    var iso = d.toISOString().slice(0,10);
    var wd  = d.getDay();
    // KSA workday = Sun(0)..Thu(4). UAE workday = Mon(1)..Fri(5).
    var isKsaWorkday = (wd >= 0 && wd <= 4);
    var isUaeWorkday = (wd >= 1 && wd <= 5);
    if (isKsaWorkday) {
      var ksaOff = KSA_TEAM.filter(function(e){ return _onLeave(e, iso); });
      if (ksaOff.length >= 2) {
        items.push({
          icon: '🏖',
          subject: 'KSA — no engineers available ' + fmtDate(iso),
          body: 'both ' + KSA_TEAM.map(function(e){return e.split(' ')[0];}).join(' & ') + ' on leave',
          severity: 14 - i, // sooner = more severe
          onClick: "showScreen('leave')"
        });
      }
    }
    if (isUaeWorkday) {
      var uaeOff = UAE_TEAM.filter(function(e){ return _onLeave(e, iso); });
      if (uaeOff.length >= 3) {
        items.push({
          icon: '🏖',
          subject: 'UAE — ' + uaeOff.length + ' engineers on leave ' + fmtDate(iso),
          body: uaeOff.map(function(e){return e.split(' ')[0];}).join(', ') + ' on leave',
          severity: 14 - i,
          onClick: "showScreen('leave')"
        });
      }
    }
  }

  // 8. Idle — employees with zero sessions in last 7 calendar days, NOT on
  //    approved leave during that window, NOT the viewer.
  var sevenAgoIso = new Date(today0.getTime() - 6*86400000).toISOString().slice(0,10);
  var sessionCountByEmp = {};
  (ctx.weekSessions||[]).forEach(function(s){
    // Credit each team member listed on the session (not just the logger).
    var loggers = (s.team_members && s.team_members.trim())
      ? s.team_members.split(',').map(function(n){return n.trim();}).filter(Boolean)
      : [s.employee];
    loggers.forEach(function(n){ sessionCountByEmp[n] = (sessionCountByEmp[n]||0) + 1; });
  });
  function _onAnyLeaveLast7(emp) {
    return approvedLeaves.some(function(r){
      return r.employee === emp && r.start_date <= ctx.todayISO && r.end_date >= sevenAgoIso;
    });
  }
  (EMPLOYEES||[]).forEach(function(emp){
    if (emp === ctx.viewer) return;            // pointless to flag yourself
    if (sessionCountByEmp[emp]) return;        // had at least one session
    if (_onAnyLeaveLast7(emp)) return;          // on leave — not idle
    items.push({
      icon: '💤',
      subject: emp,
      body: 'no sessions logged in 7 days',
      severity: 1,
      onClick: "navigateSub('projects','ussess');setTimeout(function(){var f=document.getElementById('us-flt-mem');if(f){f.value='" + emp.replace(/'/g,"\\'") + "';renderUSSessions();}},250)"
    });
  });

  // 9. Overworked — top 1-2 employees with > 50h logged in last 7 days. Skip viewer.
  var hoursByEmp = {};
  (ctx.weekSessions||[]).forEach(function(s){
    var loggers = (s.team_members && s.team_members.trim())
      ? s.team_members.split(',').map(function(n){return n.trim();}).filter(Boolean)
      : [s.employee];
    // Each member credited the full session hours per the existing
    // Employee Summary semantics.
    loggers.forEach(function(n){ hoursByEmp[n] = (hoursByEmp[n]||0) + parseFloat(s.total_hours||0); });
  });
  var overworked = Object.keys(hoursByEmp)
    .filter(function(emp){ return emp !== ctx.viewer && hoursByEmp[emp] > 50; })
    .sort(function(a,b){ return hoursByEmp[b] - hoursByEmp[a]; })
    .slice(0, 2);
  overworked.forEach(function(emp){
    items.push({
      icon: '🔥',
      subject: emp,
      body: fmtHours(hoursByEmp[emp]) + ' logged in last 7 days',
      severity: hoursByEmp[emp],
      onClick: "navigateSub('projects','ussess');setTimeout(function(){var f=document.getElementById('us-flt-mem');if(f){f.value='" + emp.replace(/'/g,"\\'") + "';renderUSSessions();}},250)"
    });
  });

  return items;
}

function _renderAttentionCard(items, snoozedCount) {
  var snoozedHint = (snoozedCount && snoozedCount > 0)
    ? ' <span class="attn-snooze-count">('+snoozedCount+' snoozed)</span>'
    : '';
  var head = '<div class="attn-head">'+
    '<div class="card-title" style="margin-bottom:2px">Needs Your Attention</div>'+
    '<div class="attn-sub">Items worth a look this week'+snoozedHint+'</div>'+
  '</div>';
  if (!items.length) {
    return '<div class="card attn-card">' + head +
      '<div class="attn-empty">✅ All clear — nothing needs your attention right now</div>'+
    '</div>';
  }
  var visibleCap = 8;
  var visible = items.slice(0, visibleCap);
  var hidden  = items.slice(visibleCap);
  var rows = visible.map(_attnRowHtml).join('');
  var hiddenHtml = hidden.length
    ? '<div id="attn-hidden" style="display:none">' + hidden.map(_attnRowHtml).join('') + '</div>'+
      '<button class="attn-more" type="button" onclick="document.getElementById(\'attn-hidden\').style.display=\'\';this.style.display=\'none\';">See all ('+items.length+')</button>'
    : '';
  return '<div class="card attn-card">' + head +
    '<div class="attn-list">' + rows + hiddenHtml + '</div>'+
  '</div>';
}

function _attnRowHtml(it) {
  // onClick is a string of JS (escaping owned by the builder above). Wrap in
  // a div with role=button so it's tappable as a single touch target. Snooze
  // button is rendered only for alert types that have a refId in the schema;
  // event.stopPropagation prevents the row's main onclick from also firing.
  var snoozeBtn = '';
  if (it.snoozeType && it.snoozeRefId != null) {
    snoozeBtn =
      '<button class="attn-snooze-btn" type="button" title="Snooze for 7 days" '+
      'onclick="event.stopPropagation();snoozeAlert(\''+it.snoozeType+'\','+it.snoozeRefId+',this)">'+
        '<i data-lucide="bell-off" class="attn-snooze-ico"></i>'+
      '</button>';
  }
  return '<div class="attn-row" role="button" tabindex="0" onclick="'+it.onClick+'" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();this.click();}">'+
    '<span class="attn-icon">'+it.icon+'</span>'+
    '<div class="attn-text">'+
      '<div class="attn-subject">'+esc2(it.subject)+'</div>'+
      '<div class="attn-body">'+esc2(it.body)+'</div>'+
    '</div>'+
    snoozeBtn+
    '<i data-lucide="chevron-right" class="attn-chevron"></i>'+
  '</div>';
}

// Per-user 7-day snooze for "Needs Your Attention" alerts. UPSERT so a
// re-snooze after expiry updates the existing row instead of conflicting
// with the UNIQUE(user_email, alert_type, alert_ref_id) constraint.
// On success, fade the row out and remove it client-side — no full re-render
// needed for the immediate feedback. Next renderDashboard() picks up the
// snooze via the active-snoozes query.
async function snoozeAlert(alertType, refId, triggerBtn) {
  if (!currentEmail) { showError('Not signed in.'); return; }
  if (!await requireAuth()) return;
  var ok = await confirmAction({
    title: 'Snooze for 7 days?',
    body: 'This alert will hide for 7 days. It will reappear automatically if the underlying issue still exists.',
    confirmText: 'Snooze',
    danger: false
  });
  if (!ok) return;

  var now = new Date();
  var until = new Date(now.getTime() + 7*24*60*60*1000);
  var row = {
    user_email:    currentEmail,
    alert_type:    alertType,
    alert_ref_id:  refId,
    snoozed_at:    now.toISOString(),
    snoozed_until: until.toISOString()
  };
  var res = await sb.from('dashboard_alert_snoozes')
    .upsert(row, { onConflict: 'user_email,alert_type,alert_ref_id' });
  if (res.error) {
    console.error('Snooze failed:', res.error);
    showError('Could not snooze — ' + (res.error.message || 'please try again.'));
    return;
  }
  // Fade out the row that contained the snooze button. The button can be in
  // either the visible list or the hidden "See all" overflow — its parent
  // .attn-row is the element to dismiss either way.
  var rowEl = triggerBtn && triggerBtn.closest ? triggerBtn.closest('.attn-row') : null;
  if (rowEl) {
    rowEl.style.transition = 'opacity .25s, transform .25s';
    rowEl.style.opacity = '0';
    rowEl.style.transform = 'translateX(8px)';
    setTimeout(function(){ if (rowEl && rowEl.parentNode) rowEl.parentNode.removeChild(rowEl); }, 260);
  }
  showToast('Snoozed for 7 days — will reappear if still an issue');
}

async function renderManagerDashboard() {
  var now = new Date();
  var monthName = now.toLocaleString('default',{month:'long'});
  var monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  var todayISO   = now.toISOString().slice(0,10);
  var sevenAgo   = new Date(now.getTime() - 7*86400000).toISOString().slice(0,10);
  var thirtyAhead= new Date(now.getTime() + 30*86400000).toISOString().slice(0,10);

  var hr = now.getHours();
  // v90: static "Good day" — replaced the time-aware morning/afternoon/
  // evening ternary at Venkat's request. Less noise; ambiguous time
  // windows (e.g. 11:59 → "morning", 12:01 → "afternoon") felt fiddly.
  var greet = 'Good day';
  var todayLabel = now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  var firstName = (currentUser||'').split(' ')[0] || '';

  // Each query is wrapped in a 10-second timeout so a single slow/stuck
  // request can't hold the entire dashboard hostage. On timeout the fallback
  // shape ({data:[], count:0}) is returned and the affected card simply
  // renders empty — better than an infinite spinner.
  var Q_TIMEOUT = 10000;
  var emptyData = { data: [], count: 0, error: null };
  var T = function(p, label) { return withTimeout(p, Q_TIMEOUT, emptyData, label); };

  // Needs-Your-Attention exceptions need a wider window than the KPI cards.
  var fourteenAhead = new Date(now.getTime() + 14*86400000).toISOString().slice(0,10);
  var sixtyAhead    = new Date(now.getTime() + 60*86400000).toISOString().slice(0,10);
  var fourteenAgo   = new Date(now.getTime() - 14*86400000).toISOString().slice(0,10);
  var fortyEightHrAgo = new Date(now.getTime() - 48*3600*1000).toISOString();
  var thirtyDaysAgo   = new Date(now.getTime() - 30*86400000).toISOString();
  var sixtyDaysAgo    = new Date(now.getTime() - 60*86400000).toISOString();

  var results = await Promise.all([
    T(sb.from('comp_off_requests').select('id', {count:'exact', head:true}).eq('status','pending'), 'comp_off_requests pending'),
    T(sb.from('leave_requests').select('id', {count:'exact', head:true}).eq('status','pending'), 'leave_requests pending'),
    T(sb.from('ot_sessions').select('id', {count:'exact', head:true}).eq('status','pending'), 'ot_sessions pending'),
    T(sb.from('ot_sessions').select('credited_hours').eq('status','approved').gte('ot_date', monthStart), 'ot_sessions month'),
    // Approved leaves overlapping today→30d ahead (KPI count + coverage gap).
    // Switched from annual_leave to leave_requests in v81 so cancellations
    // and re-reviews automatically drop out — we no longer plan around
    // leave that has been withdrawn.
    T(sb.from('leave_requests')
        .select('employee,start_date,end_date,working_days,reason,status,effective_end_date')
        .eq('status','approved')
        .lte('start_date', thirtyAhead).gte('end_date', todayISO),
      'approved leaves window'),
    // tracker_updated_at is the best available proxy for status-change time —
    // no dedicated status_changed_at / updated_at column on engagements.
    T(sb.from('engagements').select('id,name,type,status,tracker_status,partner,country,tracker_updated_at,customer_id,converted_to_project').neq('status','archived').eq('is_archived', false), 'engagements all'),
    T(sb.from('unified_sessions').select('id,employee,team_members,session_date,total_hours,engagement_name,engagement_id').gte('session_date', fourteenAgo), 'unified_sessions 14d'),
    T(sb.from('engagements').select('id,name,type,license_expiry,customer_id').eq('is_archived', false).not('license_expiry','is',null).lte('license_expiry', thirtyAhead).order('license_expiry',{ascending:true}), 'engagements license'),
    T(sb.from('customers').select('id,name'), 'customers'),
    // Oldest pending approval per type — for the "Approvals aging" exception.
    // Each returns at most 1 row (the oldest still-pending entry > 48h old).
    T(sb.from('ot_sessions').select('id,created_at').eq('status','pending').lt('created_at', fortyEightHrAgo).order('created_at',{ascending:true}).limit(1), 'oldest pending OT'),
    T(sb.from('leave_requests').select('id,created_at').eq('status','pending').lt('created_at', fortyEightHrAgo).order('created_at',{ascending:true}).limit(1), 'oldest pending leave'),
    T(sb.from('comp_off_requests').select('id,created_at').eq('status','pending').lt('created_at', fortyEightHrAgo).order('created_at',{ascending:true}).limit(1), 'oldest pending CO'),
    // Certificates expiring within 30 days (future-only — past expiries handled by their own list).
    T(sb.from('certificates').select('id,name,employee,expiry_date').gte('expiry_date', todayISO).lte('expiry_date', thirtyAhead).order('expiry_date',{ascending:true}), 'certs expiring 30d'),
    // AMC contracts renewing within 60 days (amc_end_date = renewal point).
    T(sb.from('amc_contracts').select('id,customer_name,amc_end_date,vendor').eq('is_archived', false).gte('amc_end_date', todayISO).lte('amc_end_date', sixtyAhead).order('amc_end_date',{ascending:true}), 'amc renewing 60d'),
    // Year-wide unified_sessions aggregate for Hours-by-X dashboard cards.
    // Paginated so totals aren't capped at 1000 rows. Single round trip.
    fetchAllRows(function(){
      var yStart = now.getFullYear() + '-01-01';
      var yEnd   = now.getFullYear() + '-12-31';
      return sb.from('unified_sessions')
        .select('total_hours,engagement_name,customer_name,session_date')
        .gte('session_date', yStart).lte('session_date', yEnd);
    }),
    // Active snoozes for the current user — used to filter the "Needs Your
    // Attention" feed. Hits the (user_email, snoozed_until) index. RLS
    // already restricts to own rows, the LOWER(...) eq is belt-and-braces.
    T(sb.from('dashboard_alert_snoozes')
        .select('alert_type,alert_ref_id')
        .gt('snoozed_until', now.toISOString()), 'snoozes active')
  ]);
  var coPending = results[0].count || 0;
  var lvPending = results[1].count || 0;
  var otPending = results[2].count || 0;
  var teamPending = coPending + lvPending + otPending;

  var teamOTHrs = (results[3].data||[]).reduce(function(a,r){return a+parseFloat(r.credited_hours||0);},0);
  var leavesWindow      = results[4].data || []; // 14-day overlap window (for coverage gap)
  var upcomingLeaves    = leavesWindow.filter(function(r){ return r.start_date >= todayISO && r.start_date <= thirtyAhead; });
  var upcomingLeaveDays = upcomingLeaves.reduce(function(a,r){return a+parseFloat(r.working_days||0);},0);
  var allEngagements = results[5].data || [];
  var activeProjects = allEngagements.filter(function(e){return e.type==='project' && e.status==='active';});
  var activePocs     = allEngagements.filter(function(e){return e.type==='poc'     && e.status==='active';});
  var sessions14d  = results[6].data || [];
  // Last 7 days subset — reused for KPI "Sessions this week" + idle/overworked rollup.
  var weekSessions = sessions14d.filter(function(r){ return r.session_date >= sevenAgo; });
  var expiringEngagements = results[7].data || [];
  var custMap = {};
  (results[8].data||[]).forEach(function(c){ custMap[c.id] = c.name; });
  // Needs-Your-Attention raw data
  var oldestPendingOT = (results[9].data ||[])[0] || null;
  var oldestPendingLV = (results[10].data||[])[0] || null;
  var oldestPendingCO = (results[11].data||[])[0] || null;
  var certs30d        = results[12].data || [];
  var amc60d          = results[13].data || [];
  var yearSessions    = (results[14] && results[14].data) || [];
  var activeSnoozes   = (results[15] && results[15].data) || [];

  var shortName = function(emp) {
    return (typeof empShortName === 'function') ? empShortName(emp) : (emp||'').split(' ')[0];
  };

  // === GREETING ===
  var html = '<div class="dash-hero">'+
    '<div class="dash-hero-text">'+
      '<h2>'+greet+', '+firstName+'</h2>'+
      '<div class="dash-hero-date">'+todayLabel+'</div>'+
    '</div></div>';

  // === WHAT'S NEW (v92) ===
  html += '<div id="whats-new-mount"></div>';

  // === LICENSE EXPIRY BANNER ===
  if (expiringEngagements.length) {
    var nExpired = 0, nSoon = 0;
    var rowsHtml = expiringEngagements.map(function(e){
      var d = Math.floor((new Date(e.license_expiry) - new Date(todayISO+'T00:00:00')) / 86400000);
      var customer = custMap[e.customer_id] || '';
      var dayLabel, severity;
      if (d < 0)        { dayLabel = 'expired ' + Math.abs(d) + ' day' + (Math.abs(d)===1?'':'s') + ' ago'; severity='expired'; nExpired++; }
      else if (d === 0) { dayLabel = 'expires today'; severity='expired'; nExpired++; }
      else              { dayLabel = 'expires in ' + d + ' day' + (d===1?'':'s'); severity='soon'; nSoon++; }
      var typeBadge = (e.type==='poc')?'<span class="lic-type lic-type-poc">POC</span>':'<span class="lic-type lic-type-project">Project</span>';
      return '<div class="lic-row lic-'+severity+'" onclick="openEngagementInTracker('+e.id+')">'+
        '<div class="lic-row-main">'+
          typeBadge+
          '<div class="lic-row-text">'+
            '<div class="lic-row-name">'+esc2(e.name)+'</div>'+
            (customer ? '<div class="lic-row-cust">'+esc2(customer)+'</div>' : '')+
          '</div>'+
        '</div>'+
        '<div class="lic-row-meta">'+
          '<div class="lic-row-days">'+dayLabel+'</div>'+
          '<div class="lic-row-date num">'+fmtDate(e.license_expiry)+'</div>'+
        '</div>'+
      '</div>';
    }).join('');

    var headerCls = nExpired ? 'lic-banner-expired' : 'lic-banner-soon';
    var headline = nExpired
      ? (nExpired+' license'+(nExpired===1?'':'s')+' expired'+(nSoon?' · '+nSoon+' more expiring soon':''))
      : (nSoon+' license'+(nSoon===1?'':'s')+' expiring within 30 days');
    var icon = nExpired ? 'alert-triangle' : 'alarm-clock';

    html += '<div class="lic-banner '+headerCls+'">'+
      '<div class="lic-banner-head">'+
        '<i data-lucide="'+icon+'" class="lic-banner-icon"></i>'+
        '<div class="lic-banner-text">'+
          '<div class="lic-banner-title">License Renewal Required</div>'+
          '<div class="lic-banner-sub">'+headline+'</div>'+
        '</div>'+
        '<button class="btn btn-sm btn-ghost" onclick="showScreen(\'tracker\')" style="margin-left:auto"><i data-lucide="external-link" class="btn-icon"></i>Open Tracker</button>'+
      '</div>'+
      '<div class="lic-rows">'+rowsHtml+'</div>'+
    '</div>';
  }

  // === PENDING APPROVALS HERO CARD ===
  if (teamPending > 0) {
    html += '<div class="card" style="background:linear-gradient(135deg,#0A1F5C 0%,#1E3A8A 100%);color:#fff;margin-bottom:16px">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">'+
        '<div>'+
          '<div style="font-size:13px;opacity:.85;text-transform:uppercase;letter-spacing:.5px;font-weight:600">Pending Approvals</div>'+
          '<div style="font-size:36px;font-weight:700;font-family:DM Mono,monospace;line-height:1.1;margin-top:4px"><span data-counter="'+teamPending+'">'+teamPending+'</span></div>'+
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
    // Glow-pill active state — celebratory confirmation when the queue is
    // empty. Static (non-clickable) since there's nothing to do.
    html += '<div class="card" style="margin-bottom:16px;text-align:center;padding:20px">'+
      '<div class="glow-button active glow-button-static" style="padding:14px 22px">'+
        '<span class="dot"></span>'+
        '<span>All caught up</span>'+
        '<span class="glow-subtle">0 pending</span>'+
      '</div>'+
    '</div>';
  }

  // === TEAM STATS GRID ===
  html += '<div class="dash-stats">'+
    '<div class="stat-card navy"><div class="stat-label">Team OT &mdash; '+monthName+'</div>'+
      '<div class="stat-value"><span data-counter="'+teamOTHrs+'" data-counter-decimals="1">'+fmtNumber(teamOTHrs,1)+'</span><span class="stat-unit">h</span></div>'+
      '<div class="stat-sub">credited across the team</div></div>'+
    '<div class="stat-card teal"><div class="stat-label">Leave next 30 days</div>'+
      '<div class="stat-value"><span data-counter="'+upcomingLeaveDays+'">'+fmtNumber(upcomingLeaveDays,1)+'</span></div>'+
      '<div class="stat-sub">'+fmtCount(upcomingLeaves.length)+' approved request'+(upcomingLeaves.length===1?'':'s')+'</div></div>'+
    '<div class="stat-card green" style="cursor:pointer" onclick="showScreen(\'tracker\');showTrackerTab(\'projects\')"><div class="stat-label">Active Projects</div>'+
      '<div class="stat-value"><span data-counter="'+activeProjects.length+'">'+fmtCount(activeProjects.length)+'</span></div>'+
      '<div class="stat-sub">in flight</div></div>'+
    '<div class="stat-card mid" style="cursor:pointer" onclick="showScreen(\'tracker\');showTrackerTab(\'pocs\')"><div class="stat-label">Active POCs</div>'+
      '<div class="stat-value"><span data-counter="'+activePocs.length+'">'+fmtCount(activePocs.length)+'</span></div>'+
      '<div class="stat-sub">in flight</div></div>'+
    '<div class="stat-card eve"><div class="stat-label">Sessions this week</div>'+
      '<div class="stat-value"><span data-counter="'+weekSessions.length+'">'+fmtCount(weekSessions.length)+'</span></div>'+
      '<div class="stat-sub">logged in last 7 days</div></div>'+
    '</div>';

  // === HOURS BY ENGAGEMENT / CUSTOMER (Top 8, current year) ===
  var _curYear = now.getFullYear();
  var engTop  = _dashAggregateTopHours(yearSessions, 'engagement_name', DASH_TOP_N);
  var custTop = _dashAggregateTopHours(yearSessions, 'customer_name',  DASH_TOP_N);
  var _navCall = 'dashOpenEngagementSummary('+_curYear+')';
  html += '<div class="dash-hours-row">'+
    _dashBuildHoursCard('Hours by Engagement (Top 8 · '+_curYear+')', _curYear, engTop,  _navCall)+
    _dashBuildHoursCard('Hours by Customer (Top 8 · '+_curYear+')',   _curYear, custTop, _navCall)+
  '</div>';

  // === NEEDS YOUR ATTENTION ===
  // Exception-based feed that surfaces only items the manager should look at
  // this week. Replaces the chronological "What's happening this week" log,
  // which was high-volume / low-signal.
  var attnItems = _buildAttentionItems({
    oldestPendingOT: oldestPendingOT,
    oldestPendingLV: oldestPendingLV,
    oldestPendingCO: oldestPendingCO,
    allEngagements:  allEngagements,
    sessions14d:     sessions14d,
    weekSessions:    weekSessions,
    leavesWindow:    leavesWindow,
    certs30d:        certs30d,
    amc60d:          amc60d,
    custMap:         custMap,
    now:             now,
    todayISO:        todayISO,
    viewer:          currentUser
  });
  // Drop alerts the current user has actively snoozed. Build a Set keyed by
  // "type:refId" for O(1) lookup. Alerts without snooze metadata (idle,
  // overworked, coverage gap, etc.) pass through unfiltered — those types
  // aren't snoozable in v1.
  var snoozedKeys = new Set();
  activeSnoozes.forEach(function(s){ snoozedKeys.add(s.alert_type + ':' + s.alert_ref_id); });
  var snoozedCount = 0;
  attnItems = attnItems.filter(function(it){
    if (!it.snoozeType || it.snoozeRefId == null) return true;
    if (snoozedKeys.has(it.snoozeType + ':' + it.snoozeRefId)) { snoozedCount++; return false; }
    return true;
  });
  html += _renderAttentionCard(attnItems, snoozedCount);

  document.getElementById('dash-content').innerHTML = html;
  if (typeof renderIcons === 'function') renderIcons();
  // Run counter animations on every freshly-inserted [data-counter] span.
  // _counterAnimated flag inside animateCountersIn skips elements that have
  // already animated, so this is safe to call multiple times.
  if (typeof animateCountersIn === 'function') {
    animateCountersIn(document.getElementById('dash-content'));
  }
  // v92: populate the What's New mount AFTER the main render. Same
  // fire-and-forget pattern as the employee dashboard.
  _whatsNewRerender();
}

// Lazy-load the XLSX library from the CDN on demand. Keeps the ~700KB
// payload out of every page load — mobile users on slow networks no
// longer wait for it during login. Returns a promise that resolves once
// XLSX is on window.
function ensureXlsxLoaded() {
  if (typeof XLSX !== 'undefined') return Promise.resolve();
  if (window._xlsxLoadingPromise) return window._xlsxLoadingPromise;
  window._xlsxLoadingPromise = new Promise(function(resolve, reject){
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = function(){ resolve(); };
    s.onerror = function(){ reject(new Error('Failed to load XLSX library')); };
    document.head.appendChild(s);
  });
  return window._xlsxLoadingPromise;
}

// Lazy-load JSZip on demand, mirroring ensureXlsxLoaded. Only used by the
// Full Backup pipeline to bundle the .xlsx + .sql into a single .zip — so
// the ~95KB library doesn't load on every page. Resolves with the JSZip
// constructor on window.
function ensureJszipLoaded() {
  if (typeof JSZip !== 'undefined') return Promise.resolve();
  if (window._jszipLoadingPromise) return window._jszipLoadingPromise;
  window._jszipLoadingPromise = new Promise(function(resolve, reject){
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    s.onload = function(){ resolve(); };
    s.onerror = function(){ reject(new Error('Failed to load JSZip library')); };
    document.head.appendChild(s);
  });
  return window._jszipLoadingPromise;
}

// == DISASTER-RECOVERY BACKUP ====================================
// BACKUP_TABLES is the canonical list of user-data tables in this database,
// ordered to satisfy foreign-key dependencies when restoring (parents
// before children). Add new tables to the right slot when extending the
// schema. The list drives both:
//   - the multi-sheet Excel export (one sheet per table, in this order)
//   - the SQL data dump (INSERT statements in this order so an empty
//     target DB accepts them without FK violations)
// {table, sheet, idCol} — idCol is set when the table has a generated
// identity column we need to bump the sequence for after restore.
var BACKUP_TABLES = [
  { table:'user_profiles',           sheet:'User Profiles',            idCol:null },
  { table:'customers',               sheet:'Customers',                idCol:'id' },
  { table:'vendors',                 sheet:'Vendors',                  idCol:'id' },
  { table:'product_lines',           sheet:'Product Lines',            idCol:'id' },
  { table:'engagements',             sheet:'Engagements',              idCol:'id' },
  { table:'engagement_milestones',   sheet:'Engagement Milestones',    idCol:'id' },
  { table:'amc_contracts',           sheet:'AMC Contracts',            idCol:'id' },
  { table:'amc_contract_engagements',sheet:'AMC Contract Links',       idCol:'id' },
  { table:'ps_deals',                sheet:'PS Deals',                 idCol:'id' },
  { table:'ps_milestones',           sheet:'PS Milestones',            idCol:'id' },
  { table:'unified_sessions',        sheet:'Unified Sessions',         idCol:'id' },
  { table:'ot_sessions',             sheet:'OT Sessions',              idCol:'id' },
  { table:'annual_leave',            sheet:'Annual Leave',             idCol:'id' },
  { table:'leave_requests',          sheet:'Leave Requests',           idCol:'id' },
  { table:'comp_off_register',       sheet:'Comp Off Register',        idCol:'id' },
  { table:'comp_off_requests',       sheet:'Comp Off Requests',        idCol:'id' },
  { table:'inventory',               sheet:'Inventory',                idCol:'id' },
  { table:'inventory_activity_log',  sheet:'Inventory Activity Log',   idCol:'id' },
  { table:'certificates',            sheet:'Certificates',             idCol:'id' },
  { table:'employee_skills',         sheet:'Employee Skills',          idCol:'id' },
  { table:'kb_articles',             sheet:'Knowledge Base',           idCol:'id' },
  { table:'notifications',           sheet:'Notifications',            idCol:'id' },
  { table:'dashboard_alert_snoozes', sheet:'Dashboard Alert Snoozes',  idCol:'id' }
];

// Escape a JS value into a SQL literal safe for an INSERT VALUES clause.
// Trusts the PostgREST type coercion for the column: text/uuid/date/
// timestamptz all arrive as strings; numeric/integer as numbers; boolean
// as booleans; jsonb as plain objects/arrays. Standard SQL single-quoted
// strings — `'` is doubled. Newlines, backslashes, etc. pass through
// unchanged (PostgreSQL accepts them in standard strings by default).
function _sqlEscape(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!isFinite(v)) return 'NULL';
    return String(v);
  }
  if (typeof v === 'object') {
    // jsonb column — only inventory_activity_log.field_changes in the
    // current schema. JSON-stringify then escape as text; PG auto-casts
    // on INSERT into a jsonb column.
    return "'" + JSON.stringify(v).replace(/'/g, "''") + "'";
  }
  return "'" + String(v).replace(/'/g, "''") + "'";
}

// Build a SQL data-only dump for the entire BACKUP_TABLES set. Wrapped in
// BEGIN/COMMIT so a syntax error anywhere rolls the whole thing back
// rather than leaving the target DB in a half-restored state. Uses
// OVERRIDING SYSTEM VALUE on tables with identity columns so original
// ids are preserved (FK references need them); after each table, bumps
// the sequence past max(id) so the next auto-id insert won't collide.
function _generateSqlDump(dataByTable) {
  var lines = [];
  lines.push('-- NetSec Portal — full data dump');
  lines.push('-- Generated: ' + new Date().toISOString());
  lines.push('-- Tables: ' + BACKUP_TABLES.length);
  lines.push('--');
  lines.push('-- RESTORATION:');
  lines.push('--   1. Provision an empty Supabase project (or empty schema).');
  lines.push('--   2. Apply schema.sql first (CREATE TABLEs, RLS, etc.) — see docs/disaster-recovery.md.');
  lines.push('--   3. Apply THIS file: psql $DATABASE_URL -f backup.sql');
  lines.push('--      or paste into Supabase Studio → SQL Editor (run as the project owner / service_role).');
  lines.push('--');
  lines.push('-- IMPORTANT: this must be run with a role that bypasses RLS (service_role or db owner).');
  lines.push('--            The anon and authenticated roles will be blocked by RLS policies.');
  lines.push('');
  lines.push('BEGIN;');
  lines.push('');

  BACKUP_TABLES.forEach(function(entry) {
    var table = entry.table;
    var rows  = dataByTable[table] || [];
    lines.push('-- ────────────────────────────────────────────────────────────────');
    lines.push('-- ' + table + ' — ' + rows.length + ' row' + (rows.length===1?'':'s'));
    lines.push('-- ────────────────────────────────────────────────────────────────');
    if (!rows.length) {
      lines.push('-- (no rows)');
      lines.push('');
      return;
    }
    // Column set drawn from the first row. PostgREST returns every column
    // in every row in a consistent order, so the first row's keys are the
    // authoritative ordered column list.
    var cols = Object.keys(rows[0]);
    var quotedCols = cols.map(function(c){ return '"' + c + '"'; }).join(', ');
    var overriding = (entry.idCol && cols.indexOf(entry.idCol) !== -1) ? ' OVERRIDING SYSTEM VALUE' : '';

    // Chunked multi-row INSERT — 100 rows per statement keeps individual
    // statements digestible if a human ever has to read or edit the file.
    var CHUNK = 100;
    for (var i = 0; i < rows.length; i += CHUNK) {
      var chunk = rows.slice(i, i + CHUNK);
      lines.push('INSERT INTO "' + table + '" (' + quotedCols + ')' + overriding + ' VALUES');
      var valueLines = chunk.map(function(row){
        return '  (' + cols.map(function(c){ return _sqlEscape(row[c]); }).join(', ') + ')';
      });
      lines.push(valueLines.join(',\n') + ';');
    }

    // Bump the identity sequence past max(id) so subsequent app inserts
    // don't collide. pg_get_serial_sequence works for both SERIAL and
    // GENERATED-AS-IDENTITY columns since PG 10. Wrapped in a SELECT so
    // it doesn't produce extraneous result rows on restore.
    if (entry.idCol && cols.indexOf(entry.idCol) !== -1) {
      lines.push("SELECT setval(pg_get_serial_sequence('public.\"" + table + "\"', '" + entry.idCol +
                 "'), (SELECT COALESCE(MAX(\"" + entry.idCol + "\"), 1) FROM \"" + table + "\"), true);");
    }
    lines.push('');
  });

  lines.push('COMMIT;');
  lines.push('');
  lines.push('-- End of dump.');
  return lines.join('\n');
}

// Fetch every backup table in parallel and return a {table: rows[]} map.
// Each fetch is paginated through fetchAllRows so tables larger than the
// Supabase 1000-row cap (unified_sessions in particular) export in full.
async function _fetchAllBackupData() {
  var jobs = BACKUP_TABLES.map(function(entry){
    return fetchAllRows(function(){ return sb.from(entry.table).select('*'); })
      .then(function(res){
        if (res.error) {
          console.error('Backup fetch failed for ' + entry.table + ':', res.error);
          return { table: entry.table, rows: [], error: res.error };
        }
        return { table: entry.table, rows: res.data || [] };
      });
  });
  var results = await Promise.all(jobs);
  var byTable = {};
  var errors = [];
  results.forEach(function(r){
    byTable[r.table] = r.rows;
    if (r.error) errors.push(r.table + ': ' + r.error.message);
  });
  return { byTable: byTable, errors: errors };
}

// == BACKUP — Full disaster-recovery + single-table exports =====
// scope === 'all'      → full disaster recovery .zip containing:
//                          netsec-backup-<DATE>.xlsx  (every table as a sheet)
//                          netsec-backup-<DATE>.sql   (data-only INSERT dump)
//                          README.txt                 (link to runbook)
// scope === any table  → just that table as a .xlsx for ad-hoc inspection.
//                        Kept for the "Export a specific section" UI in
//                        Admin Tools.
async function backupExcel(scope) {
  try { await ensureXlsxLoaded(); }
  catch (e) { showError('Could not load the Excel library. Check your connection and try again.'); return; }
  if (typeof XLSX === 'undefined') { showError('Excel library not available.'); return; }
  var stamp = new Date().toISOString().split('T')[0];

  if (scope === 'all') {
    return _backupFullZip(stamp);
  }
  return _backupSingleTable(scope, stamp);
}

// Single-table .xlsx export. Maps the legacy scope names (e.g. 'leave',
// 'comp_off', 'directory') to the underlying table set; new code paths
// can just pass the bare table name directly.
async function _backupSingleTable(scope, stamp) {
  var SCOPE_MAP = {
    'ot_sessions':      [{ table:'ot_sessions',           sheet:'OT Sessions' }],
    'project_sessions': [{ table:'unified_sessions',      sheet:'Unified Sessions' }],
    'inventory':        [
      { table:'inventory',                sheet:'Inventory' },
      { table:'inventory_activity_log',   sheet:'Inventory Activity Log' }
    ],
    'leave':            [
      { table:'leave_requests',  sheet:'Leave Requests' },
      { table:'annual_leave',    sheet:'Annual Leave' }
    ],
    'comp_off':         [
      { table:'comp_off_requests', sheet:'Comp Off Requests' },
      { table:'comp_off_register', sheet:'Comp Off Register' }
    ],
    'kb_articles':      [{ table:'kb_articles',           sheet:'Knowledge Base' }],
    'directory':        [
      { table:'customers',             sheet:'Customers' },
      { table:'engagements',           sheet:'Engagements' },
      { table:'engagement_milestones', sheet:'Engagement Milestones' }
    ]
  };
  var entries = SCOPE_MAP[scope] || [{ table: scope, sheet: scope }];
  var wb = XLSX.utils.book_new();

  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var res = await fetchAllRows(function(){ return sb.from(e.table).select('*'); });
    if (res.error) { console.error('Backup error for ' + e.table + ':', res.error); continue; }
    var rows = res.data || [];
    var ws = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([['(no rows)']]);
    XLSX.utils.book_append_sheet(wb, ws, e.sheet.substring(0, 31));
  }

  XLSX.writeFile(wb, 'netsec-' + scope + '-' + stamp + '.xlsx');
  showToast('Backup ready — check downloads ✓');
}

// Full disaster-recovery backup: every table → multi-sheet .xlsx + a
// SQL data dump, bundled into a single .zip download. The .zip means the
// user has BOTH files in one place, named together, so a restoration
// runbook can refer to a single timestamped artifact.
async function _backupFullZip(stamp) {
  try { await ensureJszipLoaded(); }
  catch (e) { showError('Could not load the zip library. Check your connection and try again.'); return; }
  if (typeof JSZip === 'undefined') { showError('Zip library not available.'); return; }

  showToast('Generating full backup — this may take a moment for large tables…');

  // Fetch every backup table in parallel. Any per-table failures are
  // collected and surfaced after — the rest of the backup still ships.
  var fetched = await _fetchAllBackupData();
  var byTable = fetched.byTable;
  var errors  = fetched.errors;

  // 1. Build the .xlsx workbook — one sheet per backup table, in
  //    BACKUP_TABLES order so the file reads top-down in a sensible
  //    sequence.
  var wb = XLSX.utils.book_new();
  BACKUP_TABLES.forEach(function(entry){
    var rows = byTable[entry.table] || [];
    var ws = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([['(no rows)']]);
    XLSX.utils.book_append_sheet(wb, ws, entry.sheet.substring(0, 31));
  });
  var xlsxArrayBuffer = XLSX.write(wb, { bookType:'xlsx', type:'array' });

  // 2. Build the SQL data dump.
  var sqlText = _generateSqlDump(byTable);

  // 3. Build a small README so the recipient knows what these files are
  //    without having to open them or hunt for the runbook.
  var totalRows = BACKUP_TABLES.reduce(function(s,e){ return s + (byTable[e.table]||[]).length; }, 0);
  var readme = [
    'NetSec Portal — Full Backup',
    '===========================',
    '',
    'Generated: ' + new Date().toISOString(),
    'Tables:    ' + BACKUP_TABLES.length,
    'Rows:      ' + totalRows + ' (across all tables)',
    '',
    'Files in this archive:',
    '  netsec-backup-' + stamp + '.xlsx   — every table as a sheet (human-readable)',
    '  netsec-backup-' + stamp + '.sql    — INSERT-statement data dump (machine-restorable)',
    '',
    'To restore from disaster:',
    '  See docs/disaster-recovery.md in the netsec-portal GitHub repo for the',
    '  full step-by-step runbook. Short version: provision an empty Supabase',
    '  project, apply schema.sql (from supabase db dump --schema-only), then',
    '  apply this .sql file as the project owner / service_role.',
    '',
    (errors.length
      ? 'WARNING: ' + errors.length + ' table(s) failed to fetch during backup:\n  - ' + errors.join('\n  - ')
      : 'All tables exported cleanly.')
  ].join('\n');

  // 4. Pack everything into one .zip.
  var zip = new JSZip();
  zip.file('netsec-backup-' + stamp + '.xlsx', xlsxArrayBuffer);
  zip.file('netsec-backup-' + stamp + '.sql',  sqlText);
  zip.file('README.txt', readme);
  var blob = await zip.generateAsync({ type:'blob', compression:'DEFLATE', compressionOptions:{ level:6 } });

  // 5. Trigger download.
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'netsec-backup-' + stamp + '.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);

  if (errors.length) {
    showError('Backup ready, but ' + errors.length + ' table(s) had errors — see README.txt inside the .zip.');
  } else {
    showToast('Full backup ready (' + BACKUP_TABLES.length + ' tables · ' + totalRows + ' rows) ✓');
  }

  // v95: append to backup_log so the dashboard staleness banner can
  // clear + the Admin Tools "Last backup" pill refreshes. Best-effort:
  // a failed INSERT (e.g. user isn't backup-responsible) only logs a
  // warning — the .zip has already downloaded by this point.
  try {
    await logBackup(blob ? blob.size : 0, BACKUP_TABLES.length, totalRows,
      errors.length ? ('Errors on ' + errors.length + ' table(s): ' + errors.join(', ')) : null);
  } catch (e) {
    console.warn('logBackup failed:', e);
  }
}

// == BACKUP LOG (v95) =============================================
// Append-only audit row written after a successful Full Backup .zip
// build. RLS gates INSERT to is_backup_responsible profiles, so a
// non-flagged user attempting this gets a polite warning + nothing
// lands. SELECT is broad-authenticated — Admin Tools shows the pill
// to everyone for awareness.
async function logBackup(fileSize, tableCount, rowCount, notes) {
  var payload = {
    taken_by:        currentUser || 'Unknown',
    taken_by_email:  currentEmail || 'unknown',
    file_size_bytes: fileSize || null,
    table_count:     tableCount || null,
    row_count:       rowCount  || null,
    notes:           notes     || null
  };
  var res = await sb.from('backup_log').insert(payload).select('id,taken_at').single();
  if (res.error) {
    console.warn('backup_log insert failed:', res.error.message);
    return null;
  }
  // Refresh the dashboard banner + Admin Tools pill in-place so the
  // user sees their backup register immediately.
  if (typeof renderBackupReminderBanner === 'function') renderBackupReminderBanner();
  if (typeof renderLastBackupPill === 'function') renderLastBackupPill();
  return res.data;
}

// Fetch the most recent backup_log row. Returns null on miss, the row
// otherwise. Shared by the dashboard banner + Admin Tools pill so we
// only ever issue one query per dashboard render (the second call hits
// the in-flight cache via _lastBackupPromise).
var _lastBackupCache = { row: null, fetchedAt: 0 };
var _lastBackupPromise = null;
async function _fetchLastBackup() {
  // 30-second client cache — enough to avoid double-querying when both
  // the banner and the Admin Tools pill render on the same dashboard
  // load. Cleared on logBackup() success so a fresh backup invalidates.
  if (_lastBackupCache.row !== null && (Date.now() - _lastBackupCache.fetchedAt) < 30000) {
    return _lastBackupCache.row;
  }
  if (_lastBackupPromise) return _lastBackupPromise;
  _lastBackupPromise = (async function(){
    var res = await sb.from('backup_log')
      .select('id,taken_by,taken_by_email,taken_at,file_size_bytes,table_count,row_count')
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    _lastBackupCache = { row: (res.error ? null : (res.data || null)), fetchedAt: Date.now() };
    _lastBackupPromise = null;
    return _lastBackupCache.row;
  })();
  return _lastBackupPromise;
}
function _invalidateLastBackupCache() {
  _lastBackupCache = { row: null, fetchedAt: 0 };
  _lastBackupPromise = null;
}

// == BACKUP REMINDER BANNER (v95) ================================
// Gated on isBackupResponsible. Reads latest backup_log row and
// renders an amber (3-7 days) or red (>7 days OR never) card at
// the top of the dashboard. Idempotent: removes any previous banner
// before deciding whether to draw a new one.
async function renderBackupReminderBanner() {
  // Wipe existing banner first so re-renders don't stack.
  var existing = document.getElementById('backup-reminder-banner');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  if (!isBackupResponsible) return;

  var host = document.getElementById('dash-content');
  if (!host) return;

  _invalidateLastBackupCache(); // banner is always authoritative
  var last = await _fetchLastBackup();

  var daysSince = null;
  if (last && last.taken_at) {
    var ms = Date.now() - new Date(last.taken_at).getTime();
    daysSince = Math.floor(ms / 86400000);
    if (daysSince < 3) return; // fresh enough, no banner
  }

  var tone, icon, title, sub;
  if (!last) {
    tone  = 'danger';
    icon  = '🚨';
    title = 'No backups recorded yet.';
    sub   = 'Take your first full backup now to start the disaster-recovery clock.';
  } else if (daysSince > 7) {
    tone  = 'danger';
    icon  = '🚨';
    title = 'Last backup: ' + daysSince + ' days ago — overdue.';
    sub   = 'Data loss risk is climbing. Take a fresh backup now.';
  } else {
    tone  = 'warn';
    icon  = '⚠️';
    title = 'Last backup: ' + daysSince + ' days ago' + (last.taken_by ? ' (taken by ' + esc2(last.taken_by) + ')' : '') + '.';
    sub   = 'Time to take a fresh one.';
  }

  var banner = document.createElement('div');
  banner.id = 'backup-reminder-banner';
  banner.className = 'backup-banner backup-banner-' + tone;
  banner.innerHTML =
    '<div class="backup-banner-ico">'+icon+'</div>'+
    '<div class="backup-banner-body">'+
      '<div class="backup-banner-title">'+esc2(title)+'</div>'+
      '<div class="backup-banner-sub">'+esc2(sub)+'</div>'+
    '</div>'+
    '<button class="btn btn-primary backup-banner-cta" onclick="goToFullBackup()"><i data-lucide="download" class="btn-icon"></i>Take Backup</button>';
  host.insertBefore(banner, host.firstChild);
  if (typeof renderIcons === 'function') renderIcons();
}

// Navigate the user to the Full Backup button. Managers land on the
// Admin Tools tab (where the button lives). Non-managers theoretically
// can't see the button — but we navigate anyway so a backup-responsible
// employee gets a clear destination instead of a dead-end click.
function goToFullBackup() {
  if (typeof navigateSub === 'function') {
    navigateSub('projects', 'otmanager');
  } else if (typeof showScreen === 'function') {
    showScreen('projects');
    if (typeof showProjectTab === 'function') showProjectTab('otmanager');
  }
  // Scroll the Reports & Backup card into view after the screen swap.
  setTimeout(function(){
    var card = document.querySelector('.dash-backup');
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior:'smooth', block:'start' });
  }, 200);
}

// == ADMIN TOOLS "LAST BACKUP" PILL (v95) =========================
// Renders into #last-backup-pill (placed beside the Full Backup button
// in the Admin Tools card). Visible to ALL authenticated users —
// informational; not gated on backup-responsibility.
async function renderLastBackupPill() {
  var host = document.getElementById('last-backup-pill');
  if (!host) return;
  var last = await _fetchLastBackup();
  if (!last) {
    host.innerHTML = '<span class="last-backup-pill-empty">No backups recorded yet.</span>';
    return;
  }
  var ms = Date.now() - new Date(last.taken_at).getTime();
  var days = Math.floor(ms / 86400000);
  var hoursOnly = days === 0;
  var label;
  if (hoursOnly) {
    var hrs = Math.floor(ms / 3600000);
    if (hrs < 1) label = 'minutes ago';
    else         label = hrs + ' hr ago';
  } else if (days === 1) {
    label = '1 day ago';
  } else {
    label = days + ' days ago';
  }
  var sizeMb = last.file_size_bytes ? (last.file_size_bytes / (1024*1024)).toFixed(1) + ' MB · ' : '';
  var meta = sizeMb + (last.table_count||0) + ' tables · ' + (last.row_count||0).toLocaleString() + ' rows';
  host.innerHTML =
    '<div class="last-backup-pill-head">Last backup: ' + esc2(label) +
      (last.taken_by ? ' by ' + esc2(last.taken_by) : '') + '</div>'+
    '<div class="last-backup-pill-meta">' + esc2(meta) + '</div>';
}
