// == LEAVE REQUESTS (Annual + Sick) ===============================
function calcWorkingDays(startStr,endStr,employee) {
  if (!startStr||!endStr) return 0;
  const start=new Date(startStr); const end=new Date(endStr);
  if (end<start) return 0;
  let count=0; const cur=new Date(start);
  while (cur<=end) {
    const wd=cur.getDay();
    if (!isWeekend(wd,employee)) count++;
    cur.setDate(cur.getDate()+1);
  }
  return count;
}

// Compute how many working days of a leave request have actually been TAKEN
// as of `todayISO`. Replaces the old at-approval-time accounting (which moved
// the full allowance the moment a manager clicked Approve, even for leaves
// months in the future). The new model counts day-by-day:
//   - approved + future start  → 0
//   - approved + in-progress   → working days from start up to min(today,end)
//   - approved + fully past    → full working_days
//   - cancelled + effective_end_date set → working days from start up to
//                                          effective_end_date (past days
//                                          stay counted)
//   - any other status         → 0
// Half-day leaves (working_days===0.5, start===end) → 0.5 once start <= today.
function computeLeaveUsedDays(leave, todayISO) {
  if (!leave) return 0;
  if (leave.status !== 'approved' && leave.status !== 'cancelled') return 0;
  var start = leave.start_date;
  if (!start || start > todayISO) return 0;
  var effEnd = (leave.status === 'cancelled' && leave.effective_end_date)
    ? leave.effective_end_date
    : leave.end_date;
  if (!effEnd || effEnd < start) return 0;
  var lastDay = effEnd < todayISO ? effEnd : todayISO;
  if (parseFloat(leave.working_days) === 0.5 && start === effEnd) return 0.5;
  return calcWorkingDays(start, lastDay, leave.employee);
}

// Approved working days still in the future — total minus already-taken.
// Used by Team Leave Overview to show "+N upcoming" under the used cell.
function computeUpcomingApprovedDays(leave, todayISO) {
  if (!leave || leave.status !== 'approved') return 0;
  if (!leave.start_date || !leave.end_date) return 0;
  if (leave.end_date < todayISO) return 0;
  var taken = computeLeaveUsedDays(leave, todayISO);
  var total = parseFloat(leave.working_days || 0);
  return Math.max(0, total - taken);
}

// Today / yesterday as YYYY-MM-DD in the browser's local timezone. UAE/KSA
// users see their local midnight rollover, which is what HR-level day
// counting cares about. Yesterday is used as effective_end_date when a
// leave is cancelled mid-leave (cancellation takes effect immediately;
// employee is back at work today, so today is NOT a taken day).
function _leaveTodayISO() {
  var d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function _leaveYesterdayISO() {
  var d = new Date(); d.setDate(d.getDate()-1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

async function getLeaveDaysUsed(employee, year, leaveType) {
  // New model: read from leave_requests and sum computeLeaveUsedDays. The
  // legacy annual_leave table is no longer the source of truth — its
  // existing rows stay in place but are not read for computation.
  var res = await sb.from('leave_requests')
    .select('start_date,end_date,working_days,leave_type,status,employee,effective_end_date')
    .eq('employee', employee)
    .gte('start_date', year+'-01-01').lte('start_date', year+'-12-31');
  if (res.error) { console.warn('getLeaveDaysUsed:', res.error.message); return 0; }
  var todayISO = _leaveTodayISO();
  return (res.data||[]).filter(function(r){
    if (leaveType) return (r.leave_type||'annual') === leaveType;
    return true;
  }).reduce(function(s,r){ return s + computeLeaveUsedDays(r, todayISO); }, 0);
}

function isCompOffType(t) { return t==='compoff_full' || t==='compoff_half'; }

// v104: Parses dropdown ltype into (DB category, isHalfDay). Annual/Sick
// now use _full/_half variants for UI; the underlying DB leave_type column
// still stores just the category ('annual'/'sick'). Comp Off ltypes unchanged.
function parseLtype(ltype) {
  if (ltype === 'annual_half' || ltype === 'annual_full') {
    return { category: 'annual', isHalfDay: ltype === 'annual_half' };
  }
  if (ltype === 'sick_half' || ltype === 'sick_full') {
    return { category: 'sick', isHalfDay: ltype === 'sick_half' };
  }
  if (ltype === 'compoff_half' || ltype === 'compoff_full') {
    return { category: 'compoff', isHalfDay: ltype === 'compoff_half' };
  }
  return { category: ltype, isHalfDay: false };
}

function onLeaveTypeChange() {
  const ltype = document.getElementById('lv-type').value;
  // v104: half-day variants (any category) and comp-off all use single-date layout.
  const parsed = parseLtype(ltype);
  const singleDay = parsed.isHalfDay || parsed.category === 'compoff';
  const endWrap = document.getElementById('lv-end-wrap');
  const startLabel = document.getElementById('lv-start-label');
  const startWrap = document.getElementById('lv-start-wrap');
  if (endWrap)   endWrap.style.display   = singleDay ? 'none' : '';
  if (startLabel) startLabel.textContent = singleDay ? 'Date *' : 'Start Date *';
  if (startWrap) startWrap.classList.toggle('full', singleDay);
  updateLeavePreview();
}

async function updateLeavePreview() {
  const start = document.getElementById('lv-start').value;
  const end   = document.getElementById('lv-end').value;
  const ltype = document.getElementById('lv-type') ? document.getElementById('lv-type').value : 'annual_full';

  if (isCompOffType(ltype)) {
    const reqDays = ltype==='compoff_full' ? 1 : 0.5;
    document.getElementById('lv-prev-type').textContent = ltype==='compoff_full' ? 'Comp Off (Full)' : 'Comp Off (Half)';
    if (!start) {
      document.getElementById('lv-prev-days').textContent = '—';
      document.getElementById('lv-prev-used').textContent = '—';
      document.getElementById('lv-prev-bal').textContent  = '—';
      return;
    }
    const [{data:sessions},{data:coRegs}] = await Promise.all([
      sb.from('ot_sessions').select('*').eq('employee',currentUser),
      sb.from('comp_off_register').select('*').eq('employee',currentUser)
    ]);
    const s = calcSummary(sessions||[], coRegs||[], currentUser);
    const balAfter = s.balance - reqDays;
    document.getElementById('lv-prev-days').textContent = fmtDays(reqDays);
    document.getElementById('lv-prev-used').textContent = fmtNumber(s.used,2)+' / '+fmtNumber(s.totalCO,2);
    document.getElementById('lv-prev-bal').textContent  = fmtDays(balAfter);
    document.getElementById('lv-prev-bal').style.color  = balAfter<0?'var(--danger)':balAfter<=1?'var(--gold)':'var(--success)';
    return;
  }

  // v104: category and half-day derived from new dropdown variants.
  const parsed = parseLtype(ltype);
  const isSick = parsed.category === 'sick';
  const allowance = isSick ? SICK_ALLOWANCE : LEAVE_ALLOWANCE;
  document.getElementById('lv-prev-type').textContent = isSick ? 'Sick' : 'Annual';
  var isHalfDay = parsed.isHalfDay;

  if (!start||!end) {
    document.getElementById('lv-prev-days').textContent = '—';
    document.getElementById('lv-prev-used').textContent = '—';
    document.getElementById('lv-prev-bal').textContent  = '—';
    return;
  }
  var days = isHalfDay ? 0.5 : calcWorkingDays(start,end,currentUser);
  const year = start.split('-')[0];
  // v135 fix: pass the DB category ('annual'/'sick'), NOT the raw dropdown
  // value ('annual_full'). leave_requests.leave_type stores the category
  // (see submit path), so getLeaveDaysUsed's `r.leave_type === leaveType`
  // match returned false for every row since v104 introduced the _full/_half
  // dropdown variants — making "Used This Year" always read 0 and overstating
  // "Balance After".
  const used = await getLeaveDaysUsed(currentUser,year,parsed.category);
  const balAfter = allowance - used - days;
  document.getElementById('lv-prev-days').textContent = fmtDays(days);
  document.getElementById('lv-prev-used').textContent = fmtNumber(used,1)+' / '+allowance;
  document.getElementById('lv-prev-bal').textContent  = fmtDays(balAfter);
  document.getElementById('lv-prev-bal').style.color  = balAfter<0?'var(--danger)':balAfter<=3?'var(--gold)':'var(--success)';
}

async function submitLeaveRequest() {
  if (!await requireAuth()) return;
  const ltype  = document.getElementById('lv-type') ? document.getElementById('lv-type').value : 'annual_full';
  if (isCompOffType(ltype)) { return submitCompOffViaLeaveForm(ltype); }
  const start  = document.getElementById('lv-start').value;
  const end    = document.getElementById('lv-end').value;
  const reason = document.getElementById('lv-reason').value.trim();
  const errEl  = document.getElementById('leave-error');
  if (!start||!end){showAlert('leave-error');return;}
  var isHalfDay = parseLtype(ltype).isHalfDay;
  // Half-day → 0.5 working day. Otherwise the standard working-day count
  // (excludes weekends per region).
  var days = isHalfDay ? 0.5 : calcWorkingDays(start,end,currentUser);
  if (days<=0){showAlert('leave-error');return;}
  // Defensive: if user manipulated the DOM to check half-day on a
  // multi-day range, force-collapse to single-day.
  if (isHalfDay && start !== end) {
    if (errEl) errEl.textContent = '⚠️ Half-day applies to single-day requests only.';
    showAlert('leave-error'); return;
  }

  // Block self-overlap with any existing live leave request (pending,
  // needs_review, or approved). Rejected and cancelled requests don't
  // represent real absences so they're allowed to overlap. Two ranges
  // overlap when start_a <= end_b AND end_a >= start_b.
  // (annual_leave is no longer consulted — leave_requests is the single
  // source of truth as of v81. Legacy annual_leave rows have matching
  // leave_requests rows, so we don't lose any overlap signal.)
  var conflictRes = await sb.from('leave_requests')
    .select('id,leave_type,start_date,end_date,status')
    .eq('employee', currentUser)
    .neq('status', 'rejected')
    .neq('status', 'cancelled')
    .lte('start_date', end)
    .gte('end_date', start);
  var conflict = (conflictRes.data && conflictRes.data[0]);
  if (conflict) {
    if (errEl) errEl.textContent = '⚠️ You already have a ' + (conflict.leave_type || 'leave') +
      ' record from ' + conflict.start_date + ' to ' + conflict.end_date +
      ' (' + (conflict.status || 'approved') + '). Cancel or wait for that one before requesting overlapping dates.';
    showAlert('leave-error'); return;
  }

  // Open a blank tab SYNCHRONOUSLY so the browser's user-gesture rule
  // is satisfied. We'll navigate it to Outlook Web after the save returns.
  // If the popup blocker rejects, emailWindow is null and we fall back to
  // the clickable links inside the success toast.
  var emailWindow = window.open('about:blank', '_blank');

  const btn=document.getElementById('lv-save-btn');
  btn.disabled=true; btn.textContent='⏳ Submitting...';
  const {error}=await sb.from('leave_requests').insert({
    employee:currentUser,start_date:start,end_date:end,working_days:days,
    reason,status:'pending',leave_type:parseLtype(ltype).category
  });
  btn.disabled=false; btn.innerHTML='<i data-lucide="send" class="btn-icon"></i>Submit Request'; if (typeof renderIcons === 'function') renderIcons();
  if (error){
    if (emailWindow) try { emailWindow.close(); } catch(e){}
    showError('Error: '+error.message); return;
  }
  // Build email draft links and show them inside the success alert.
  // Letting the user click preserves the browser's user-gesture rule
  // (which mailto: triggered after an async await usually fails).
  var ltypeLabel = ltype.charAt(0).toUpperCase() + ltype.slice(1);
  var subject = 'Leave Request - ' + currentUser + ' - ' + ltypeLabel + ' (' + days + ' day' + (days===1?'':'s') + ')';
  var body =
    'Hi Venkat,\n\n' +
    'I have submitted a leave request through the NetSec Portal:\n\n' +
    'Type: ' + ltypeLabel + ' Leave\n' +
    'From: ' + start + '\n' +
    'To: ' + end + '\n' +
    'Working days: ' + days + '\n' +
    'Reason: ' + (reason || '(none)') + '\n\n' +
    'Please review and approve at https://netsec-portal.pages.dev/\n\n' +
    'Thanks,\n' + currentUser;
  var enc = encodeURIComponent;
  var mailto    = 'mailto:venkat@gulfitd.com?subject=' + enc(subject) + '&body=' + enc(body);
  var outlookWb = 'https://outlook.office.com/mail/deeplink/compose?to=venkat@gulfitd.com&subject=' + enc(subject) + '&body=' + enc(body);

  // Hand the pre-opened blank tab to mailto: — the OS picks up the
  // default mail handler (Outlook desktop on Windows). After ~1.2s
  // we close the now-empty tab. Outlook Web stays in the success
  // toast as a fallback if Outlook desktop isn't registered.
  if (emailWindow) {
    try {
      emailWindow.location.href = mailto;
      setTimeout(function(){ try { emailWindow.close(); } catch(e){} }, 1200);
    } catch(e) {
      try { emailWindow.close(); } catch(e2){}
      emailWindow = null;
    }
  }
  showToast('Leave request sent for approval ✓');
  // Keep the inline element for the Outlook deep-links — those are
  // actionable follow-ups, not a duplicate "Saved!" message. Toast
  // confirms the save; this row hands off email so the manager hears
  // about it via Outlook too.
  var successEl = document.getElementById('leave-success');
  if (successEl) {
    var note = emailWindow ? 'Outlook should have opened.' : '(Outlook auto-launch was blocked.)';
    successEl.innerHTML = note + ' Or open manually: '
      + '<a href="' + mailto + '" style="color:var(--teal);font-weight:600;text-decoration:underline;margin-left:6px">📧 Outlook (desktop)</a>'
      + '<a href="' + outlookWb + '" target="_blank" rel="noopener" style="color:var(--teal);font-weight:600;text-decoration:underline;margin-left:6px">🌐 Outlook (web)</a>';
  }
  showAlert('leave-success');

  ['lv-start','lv-end','lv-reason'].forEach(function(id){document.getElementById(id).value='';});
  document.getElementById('lv-prev-days').textContent='—';
  document.getElementById('lv-prev-used').textContent='—';
  document.getElementById('lv-prev-bal').textContent='—';
}

async function submitCompOffViaLeaveForm(ltype) {
  if (!await requireAuth()) return;
  const date   = document.getElementById('lv-start').value;
  const reason = document.getElementById('lv-reason').value.trim();
  const errEl  = document.getElementById('leave-error');
  if (!date) { showAlert('leave-error'); return; }
  const days     = ltype==='compoff_full' ? 1 : 0.5;
  const typeLabel = days===1 ? 'Full Day' : 'Half Day';

  // Block requesting comp off on a date that already has a non-rejected
  // request OR an already-redeemed register entry for this user.
  var conflictRes = await Promise.all([
    sb.from('comp_off_requests')
      .select('id,status,request_date').eq('employee', currentUser)
      .neq('status','rejected').eq('request_date', date),
    sb.from('comp_off_register')
      .select('id,date_taken').eq('employee', currentUser).eq('date_taken', date)
  ]);
  var conflict = (conflictRes[0].data && conflictRes[0].data[0]) ||
                 (conflictRes[1].data && conflictRes[1].data[0]);
  if (conflict) {
    if (errEl) errEl.textContent = '⚠️ You already have a comp off record for ' + date + '. Cancel that one or pick a different date.';
    showAlert('leave-error'); return;
  }

  var emailWindow = window.open('about:blank', '_blank');

  const btn=document.getElementById('lv-save-btn');
  btn.disabled=true; btn.textContent='⏳ Submitting...';
  const {error}=await sb.from('comp_off_requests').insert({
    employee:currentUser, request_date:date, type:typeLabel,
    days, related_activity:'', remarks:reason, status:'pending'
  });
  btn.disabled=false; btn.innerHTML='<i data-lucide="send" class="btn-icon"></i>Submit Request'; if (typeof renderIcons === 'function') renderIcons();
  if (error){
    if (emailWindow) try { emailWindow.close(); } catch(e){}
    showError('Error: '+error.message); return;
  }

  var subject = 'Comp Off Request - ' + currentUser + ' - ' + typeLabel + ' on ' + date;
  var body =
    'Hi Venkat,\n\n' +
    'I have submitted a comp off request through the NetSec Portal:\n\n' +
    'Type: ' + typeLabel + ' (' + days + ' day)\n' +
    'Date: ' + date + '\n' +
    'Reason: ' + (reason || '(none)') + '\n\n' +
    'Please review and approve at https://netsec-portal.pages.dev/\n\n' +
    'Thanks,\n' + currentUser;
  var enc = encodeURIComponent;
  var mailto    = 'mailto:venkat@gulfitd.com?subject=' + enc(subject) + '&body=' + enc(body);
  var outlookWb = 'https://outlook.office.com/mail/deeplink/compose?to=venkat@gulfitd.com&subject=' + enc(subject) + '&body=' + enc(body);

  if (emailWindow) {
    try {
      emailWindow.location.href = mailto;
      setTimeout(function(){ try { emailWindow.close(); } catch(e){} }, 1200);
    } catch(e) {
      try { emailWindow.close(); } catch(e2){}
      emailWindow = null;
    }
  }
  showToast('Comp off request sent for approval ✓');
  var successEl = document.getElementById('leave-success');
  if (successEl) {
    var note = emailWindow ? 'Outlook should have opened.' : '(Outlook auto-launch was blocked.)';
    successEl.innerHTML = note + ' Or open manually: '
      + '<a href="' + mailto + '" style="color:var(--teal);font-weight:600;text-decoration:underline;margin-left:6px">📧 Outlook (desktop)</a>'
      + '<a href="' + outlookWb + '" target="_blank" rel="noopener" style="color:var(--teal);font-weight:600;text-decoration:underline;margin-left:6px">🌐 Outlook (web)</a>';
  }
  showAlert('leave-success');

  ['lv-start','lv-end','lv-reason'].forEach(function(id){document.getElementById(id).value='';});
  document.getElementById('lv-prev-days').textContent='—';
  document.getElementById('lv-prev-used').textContent='—';
  document.getElementById('lv-prev-bal').textContent='—';
}

async function renderLeaveHistory() {
  document.getElementById('lv-hist-load').style.display='flex';
  document.getElementById('lv-hist-content').innerHTML='';
  const filter=isManager?document.getElementById('lv-hist-filter').value:currentUser;
  let lq=sb.from('leave_requests').select('*').order('created_at',{ascending:false});
  let cq=sb.from('comp_off_requests').select('*').order('created_at',{ascending:false});
  if (filter) { lq=lq.eq('employee',filter); cq=cq.eq('employee',filter); }
  const [lr, cr] = await Promise.all([lq, cq]);
  document.getElementById('lv-hist-load').style.display='none';

  const leaveRows = (lr.data||[]).map(function(r){ return Object.assign({_kind:'leave'}, r); });
  const coRows    = (cr.data||[]).map(function(r){ return Object.assign({_kind:'compoff'}, r); });
  const all = leaveRows.concat(coRows).sort(function(a,b){
    return new Date(b.created_at||0) - new Date(a.created_at||0);
  });

  if (!all.length){
    document.getElementById('lv-hist-content').innerHTML = renderEmptyState({
      icon: 'palmtree',
      heading: 'No leave requests yet',
      sub: 'Submit annual or sick leave requests here. Manager reviews and approves.',
      btnText: 'Request time off',
      btnOnclick: "navigateSub('leave','log')"
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }
  document.getElementById('lv-hist-content').innerHTML=all.map(function(r){
    if (r._kind==='compoff') {
      return '<div class="request-card '+r.status+'">'+
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">'+
        '<div><strong>'+r.employee+'</strong> <span style="font-size:11px;font-weight:600;color:var(--gold)">Comp Off ('+r.type+')</span><br>'+
        '<span style="font-family:DM Mono,monospace;font-size:13px">'+fmtDate(r.request_date)+'</span><br>'+
        '<span style="font-size:12px;color:var(--muted)">'+fmtDays(r.days)+(r.remarks?' | '+r.remarks:(r.related_activity?' | '+r.related_activity:''))+'</span></div>'+
        '<span class="badge badge-'+r.status+'">'+statusIcon(r.status)+' '+cap(r.status)+'</span></div>'+
        (r.manager_comment?'<div style="font-size:12px;color:var(--muted);margin-top:4px">💬 '+r.manager_comment+'</div>':'')+
        '</div>';
    }
    var ltIcon  = (r.leave_type||'annual')==='sick' ? 'Sick Leave' : 'Annual Leave';
    var ltColor = (r.leave_type||'annual')==='sick' ? '#8B5CF6' : 'var(--teal)';
    // Half-day flag: working_days === 0.5 on a single-date row. The string
    // shows "(half day)" inline next to the date range to stay compact.
    var isHalf = (parseFloat(r.working_days) === 0.5);
    var halfTag = isHalf ? ' <span style="font-size:11px;color:#8B5CF6;font-weight:600">(half day)</span>' : '';

    // Determine if the employee can still cancel this request. Mirrors the
    // server-side rule applied by cancelLeaveRequest: pending / needs_review
    // are cancellable at any time; approved is cancellable while end_date is
    // today-or-later (past-only leaves are locked).
    var todayISO = (typeof _leaveTodayISO === 'function') ? _leaveTodayISO() : '';
    var canCancel = false;
    if (r.status === 'pending' || r.status === 'needs_review') canCancel = true;
    else if (r.status === 'approved' && r.end_date && r.end_date >= todayISO) canCancel = true;
    var cancelBtn = canCancel
      ? '<button class="btn btn-sm btn-ghost" style="margin-left:8px" onclick="cancelLeaveRequest('+r.id+')" title="Cancel this leave">✕ Cancel</button>'
      : '';

    // Status banner — gives the employee the manager's context at a glance.
    // needs_review (yellow): "the manager wants to talk before approving"
    // rejected     (red):    "rejection reason"
    // cancelled    (grey):   "cancellation details"
    var banner = '';
    if (r.status === 'needs_review') {
      banner = '<div style="background:#FFFBEB;color:#92400E;border-left:3px solid var(--gold);padding:8px 10px;border-radius:6px;font-size:12px;margin-top:8px;line-height:1.4">'+
        '💬 <strong>Pending discussion with manager:</strong> ' + esc2(r.manager_comment || '(no comment)') +
        '</div>';
    } else if (r.status === 'rejected' && r.manager_comment) {
      banner = '<div style="background:#FEF2F2;color:#991B1B;border-left:3px solid var(--danger);padding:8px 10px;border-radius:6px;font-size:12px;margin-top:8px;line-height:1.4">'+
        '🚫 <strong>Rejection reason:</strong> ' + esc2(r.manager_comment) +
        '</div>';
    } else if (r.status === 'cancelled') {
      var who = r.cancelled_by ? (r.cancelled_by === r.employee ? 'you' : esc2(r.cancelled_by)) : 'someone';
      banner = '<div style="background:#F1F5F9;color:#475569;border-left:3px solid #94A3B8;padding:8px 10px;border-radius:6px;font-size:12px;margin-top:8px;line-height:1.4">'+
        '🚫 Cancelled ' + (r.cancelled_at ? relativeTime(r.cancelled_at) : '') + ' by ' + who +
        (r.effective_end_date ? ' · counted through ' + fmtDate(r.effective_end_date) : '') +
        (r.manager_comment ? ' · ' + esc2(r.manager_comment) : '') +
        '</div>';
    }

    var statusLabel = cap((r.status||'').replace('_',' '));
    return '<div class="request-card '+r.status+'">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:8px;flex-wrap:wrap">'+
      '<div><strong>'+r.employee+'</strong> <span style="font-size:11px;font-weight:600;color:'+ltColor+'">'+ltIcon+'</span><br>'+
      '<span style="font-family:DM Mono,monospace;font-size:13px">'+fmtDate(r.start_date)+(r.start_date===r.end_date?'':' to '+fmtDate(r.end_date))+halfTag+'</span><br>'+
      '<span style="font-size:12px;color:var(--muted)">'+r.working_days+' working day'+(parseFloat(r.working_days)===1?'':'s')+(r.reason?' | '+r.reason:'')+'</span></div>'+
      '<div style="display:flex;align-items:center;flex-wrap:wrap"><span class="badge badge-'+r.status+'">'+statusIcon(r.status)+' '+statusLabel+'</span>'+cancelBtn+'</div></div>'+
      // Show manager_comment inline only for rejected/needs_review where we
      // didn't already emit a richer banner. For approved leaves it stays
      // as the historical-context line.
      (r.status === 'approved' && r.manager_comment ? '<div style="font-size:12px;color:var(--muted);margin-top:4px">💬 '+esc2(r.manager_comment)+'</div>':'')+
      banner+
      '</div>';
  }).join('');
}

async function renderLeaveTeam() {
  document.getElementById('lv-team-load').style.display='flex';
  document.getElementById('lv-team-content').innerHTML='';
  const year=new Date().getFullYear().toString();
  // Switched from annual_leave (at-approval-time) to leave_requests so the
  // day-by-day rule applies. Pull every leave_request that started in the
  // year — computeLeaveUsedDays decides which days actually count today.
  const {data}=await sb.from('leave_requests')
    .select('employee,start_date,end_date,working_days,leave_type,status,effective_end_date')
    .gte('start_date',year+'-01-01').lte('start_date',year+'-12-31');
  document.getElementById('lv-team-load').style.display='none';
  const records=data||[];
  const todayISO = _leaveTodayISO();

  // Employees only see their own row; manager sees all
  const visibleEmps = isManager ? EMPLOYEES : [currentUser];

  const rows=visibleEmps.map(function(emp){
    const empRecs = records.filter(function(r){return r.employee===emp;});
    function sumUsed(typeKey) {
      return empRecs
        .filter(function(r){ return (r.leave_type||'annual')===typeKey; })
        .reduce(function(s,r){ return s + computeLeaveUsedDays(r, todayISO); }, 0);
    }
    function sumUpcoming(typeKey) {
      return empRecs
        .filter(function(r){ return (r.leave_type||'annual')===typeKey; })
        .reduce(function(s,r){ return s + computeUpcomingApprovedDays(r, todayISO); }, 0);
    }
    const annualUsed    = sumUsed('annual');
    const annualUpcoming= sumUpcoming('annual');
    const sickUsed      = sumUsed('sick');
    const sickUpcoming  = sumUpcoming('sick');
    const annualRem  = LEAVE_ALLOWANCE - annualUsed;
    const sickRem    = SICK_ALLOWANCE  - sickUsed;
    const aColor = annualRem<=0?'var(--danger)':annualRem<=5?'var(--gold)':'var(--success)';
    const sColor = sickRem<=0?'var(--danger)':sickRem<=3?'var(--gold)':'var(--success)';
    const aPct   = Math.min((annualUsed/LEAVE_ALLOWANCE)*100,100);
    const aBadge = annualRem<=0?'<span class="badge badge-rejected">No balance</span>':annualRem<=5?'<span class="badge badge-pending">Low</span>':'<span class="badge badge-approved">OK</span>';
    const sBadge = sickRem<=0?'<span class="badge badge-rejected">No balance</span>':sickRem<=3?'<span class="badge badge-pending">Low</span>':'<span class="badge badge-approved">OK</span>';
    // "+N upcoming" hint shows approved-but-not-yet-taken days — gives the
    // manager the full mental model: this is what's been TAKEN; here's what's
    // APPROVED but still in the future.
    var aUpcomingHint = annualUpcoming>0
      ? '<div style="font-size:11px;color:var(--muted);margin-top:2px">+'+fmtNumber(annualUpcoming,1)+' approved upcoming</div>' : '';
    var sUpcomingHint = sickUpcoming>0
      ? '<div style="font-size:11px;color:var(--muted);margin-top:2px">+'+fmtNumber(sickUpcoming,1)+' approved upcoming</div>' : '';
    // v145/v146: list this person's UPCOMING approved leave date ranges
    // (end date today or later), so the manager sees exactly when each person
    // is going to be off (from → to). Past leaves are not shown. Sick tagged.
    var approvedRanges = empRecs
      .filter(function(r){ return r.status === 'approved' && r.start_date && r.end_date && r.end_date >= todayISO; })
      .sort(function(a,b){ return (a.start_date||'').localeCompare(b.start_date||''); })
      .map(function(r){
        var rng = (r.start_date === r.end_date)
          ? fmtDate(r.start_date)
          : fmtDateRange(r.start_date, r.end_date);
        var tag = ((r.leave_type||'annual') === 'sick') ? ' <span style="color:var(--gold)">(Sick)</span>' : '';
        return '<div style="white-space:nowrap;font-size:11.5px;color:var(--navy)">'+esc2(rng)+tag+'</div>';
      });
    var approvedCell = approvedRanges.length ? approvedRanges.join('') : '<span class="dim">—</span>';
    return '<tr>'+
      '<td><strong>'+emp+'</strong><br><span style="font-size:11px;color:var(--muted)">'+(KSA_EMP.includes(emp)?'KSA — Fri/Sat':'UAE — Sat/Sun')+'</span></td>'+
      '<td style="font-family:DM Mono,monospace">'+approvedCell+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal)">'+fmtNumber(annualUsed,1)+' / '+LEAVE_ALLOWANCE+aUpcomingHint+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:'+aColor+'">'+fmtNumber(annualRem,1)+'</td>'+
      '<td><div style="height:8px;background:#f3f4f6;border-radius:4px;overflow:hidden"><div style="height:100%;width:'+aPct+'%;background:'+aColor+';border-radius:4px"></div></div><div style="font-size:11px;color:var(--muted);margin-top:3px">'+fmtPct(aPct)+' used</div></td>'+
      '<td>'+aBadge+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal)">'+fmtNumber(sickUsed,1)+' / '+SICK_ALLOWANCE+sUpcomingHint+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:'+sColor+'">'+fmtNumber(sickRem,1)+'</td>'+
      '<td>'+sBadge+'</td>'+
      '</tr>';
  }).join('');

  document.getElementById('lv-team-content').innerHTML=
    '<div class="card"><div class="card-title">'+(isManager?'Team':'My')+' Leave Overview '+year+'</div>'+
    '<div class="table-wrap"><table><thead><tr>'+
    '<th>Employee</th>'+
    '<th>Upcoming Leave (dates)</th>'+
    '<th>Annual Used</th><th>Annual Rem.</th><th>Usage</th><th>Status</th>'+
    '<th>Sick Used</th><th>Sick Rem.</th><th>Status</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div style="margin-top:10px;font-size:12px;color:var(--muted)">Annual: '+fmtDays(LEAVE_ALLOWANCE)+'/yr &nbsp;|&nbsp; Sick: '+fmtDays(SICK_ALLOWANCE)+'/yr</div>'+
    '</div>';

  // v102: manager-only OT/Comp Off summary card sits alongside the leave
  // table. The team-ot-section wrapper stays hidden for employees, so
  // "My Leave Overview" remains leave-only.
  var otSection = document.getElementById('team-ot-section');
  if (otSection) otSection.style.display = isManager ? '' : 'none';
  if (isManager && typeof renderTeamOTSummary === 'function') {
    renderTeamOTSummary();
  }
}

// == TEAM OT/COMP-OFF SUMMARY (v102) ==============================
// v102: relocated from Projects → Manager to Leave → Team Overview.
// Called by renderLeaveTeam() when isManager.
async function renderTeamOTSummary() {
  document.getElementById('team-ot-loading').style.display='flex';
  document.getElementById('team-ot-content').innerHTML='';
  const [{data:sessions},{data:compoffs}]=await Promise.all([
    sb.from('ot_sessions').select('*'),
    sb.from('comp_off_register').select('*')
  ]);
  document.getElementById('team-ot-loading').style.display='none';
  const rows=EMPLOYEES.map(function(emp){
    const s=calcSummary(sessions||[],compoffs||[],emp);
    const bc=s.balance>0?'var(--success)':s.balance<0?'var(--danger)':'var(--navy)';
    // Mid 1:1 hours are tracked but don't earn CO (Mid <4h is 1:1 by policy).
    // Render them in a muted color so the manager can see the hours exist
    // without being misled into thinking they contribute to comp-off.
    return '<tr><td><strong>'+emp+'</strong></td>'+
      '<td style="font-family:\'DM Mono\',monospace">'+s.sessions+'</td>'+
      '<td class="hide-mobile" style="font-family:\'DM Mono\',monospace">'+r2(s.eveCred)+'</td>'+
      '<td class="hide-mobile" style="font-family:\'DM Mono\',monospace">'+r2(s.earlyCred)+'</td>'+
      '<td class="hide-mobile" style="font-family:\'DM Mono\',monospace;color:#9CA3AF" title="Mid 1:1 (<4h) — tracked but does not earn CO">'+r2(s.mid11)+'</td>'+
      '<td class="hide-mobile" style="font-family:\'DM Mono\',monospace">'+r2(s.mid12)+'</td>'+
      '<td class="hide-mobile" style="font-family:\'DM Mono\',monospace" title="Weekend 1:1 — earns CO at 8h = 1 day">'+r2(s.wk11)+'</td>'+
      '<td class="hide-mobile" style="font-family:\'DM Mono\',monospace">'+r2(s.wk12)+'</td>'+
      '<td><strong style="font-family:\'DM Mono\',monospace;color:var(--navy)">'+fmtNumber(s.totalCO,2)+'</strong></td>'+
      '<td style="font-family:\'DM Mono\',monospace">'+fmtNumber(s.used,2)+'</td>'+
      '<td><strong style="font-family:\'DM Mono\',monospace;color:'+bc+'">'+fmtNumber(s.balance,2)+'</strong></td></tr>';
  }).join('');
  document.getElementById('team-ot-content').innerHTML=
    '<div class="table-wrap"><table><thead><tr>'+
      '<th>Employee</th>'+
      '<th>Sessions</th>'+
      '<th class="hide-mobile">Eve Cred</th>'+
      '<th class="hide-mobile">Early Cred</th>'+
      '<th class="hide-mobile" style="color:#9CA3AF">Mid 1:1</th>'+
      '<th class="hide-mobile">Mid 1:2</th>'+
      '<th class="hide-mobile">Wknd 1:1</th>'+
      '<th class="hide-mobile">Wknd 1:2</th>'+
      '<th>CO Earned</th>'+
      '<th>CO Used</th>'+
      '<th>Balance</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div>';
}

// == APPROVALS (MANAGER) ==========================================
async function updateNotifBadge() {
  // v113: tasks query added — counts rows in the new 'pending_approval'
  // state introduced in v112. Excludes archived rows so completed-and-
  // archived noise doesn't inflate the badge.
  const [coRes,lvRes,otRes,tsRes]=await Promise.all([
    sb.from('comp_off_requests').select('id').eq('status','pending'),
    sb.from('leave_requests').select('id').eq('status','pending'),
    sb.from('ot_sessions').select('id').eq('status','pending'),
    sb.from('tasks').select('id').eq('status','pending_approval').eq('is_archived', false)
  ]);
  // If any of the four count queries errored (network blip, RLS hiccup),
  // bail out silently — better to leave the badge in its previous state
  // than to display a misleading total. Console-warn for diagnostics.
  if (coRes.error || lvRes.error || otRes.error || tsRes.error) {
    console.warn('updateNotifBadge: fetch error, skipping update', {
      co: coRes.error && coRes.error.message,
      lv: lvRes.error && lvRes.error.message,
      ot: otRes.error && otRes.error.message,
      ts: tsRes.error && tsRes.error.message
    });
    return;
  }
  const total=(coRes.data||[]).length+(lvRes.data||[]).length+(otRes.data||[]).length+(tsRes.data||[]).length;
  const badge=document.getElementById('notif-badge');
  if (!badge) return;
  if (total>0) {
    badge.style.display='inline-block';
    // Animate count-up on the FIRST reveal of the badge (e.g. on login).
    // Subsequent updates (after the manager approves a request and the
    // count decrements) write instantly so the change feels responsive.
    if (!badge._counterAnimated && typeof animateCounter === 'function') {
      badge._counterAnimated = true;
      animateCounter(badge, total, { duration: 600 });
    } else {
      // Cancel any in-flight initial-reveal RAF before writing instantly —
      // otherwise the still-running tick would overwrite the new total back
      // to its eased intermediate and settle on the OLD value.
      if (badge._counterRAF)   { cancelAnimationFrame(badge._counterRAF); badge._counterRAF = null; }
      if (badge._counterTimer) { clearTimeout(badge._counterTimer); badge._counterTimer = null; }
      badge.textContent = total;
    }
  } else {
    badge.style.display='none';
    badge._counterAnimated = false;  // reset so next reveal animates again
  }
}

function clearLeaveApprovalFilters() {
  ['lv-app-emp','lv-app-type','lv-app-status','lv-app-from','lv-app-to'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.value='';
  });
  renderLeaveApprovals();
}

function populateLeaveApprovalEmpFilter() {
  var sel = document.getElementById('lv-app-emp');
  if (!sel || sel.options.length > 1) return;
  EMPLOYEES.forEach(function(e){
    var o=document.createElement('option'); o.value=o.textContent=e; sel.appendChild(o);
  });
}

async function renderLeaveApprovals() {
  populateLeaveApprovalEmpFilter();
  document.getElementById('lv-approvals-load').style.display='flex';
  document.getElementById('lv-approvals-content').innerHTML='';

  var fEmp    = (document.getElementById('lv-app-emp')||{}).value || '';
  var fType   = (document.getElementById('lv-app-type')||{}).value || '';
  var fStatus = (document.getElementById('lv-app-status')||{}).value || '';
  var fFrom   = (document.getElementById('lv-app-from')||{}).value || '';
  var fTo     = (document.getElementById('lv-app-to')||{}).value || '';

  // Type filter routes which tables to query:
  //   ''               -> both tables
  //   'annual'/'sick'  -> leave_requests only (with leave_type filter)
  //   'compoff_full'   -> comp_off_requests with type='Full Day'
  //   'compoff_half'   -> comp_off_requests with type='Half Day'
  var wantLeave   = fType==='' || fType==='annual' || fType==='sick';
  var wantCompOff = fType==='' || fType==='compoff_full' || fType==='compoff_half';

  var leaveQ = null, coQ = null;
  if (wantLeave) {
    leaveQ = sb.from('leave_requests').select('*').order('created_at',{ascending:false});
    if (fEmp)    leaveQ = leaveQ.eq('employee', fEmp);
    if (fType==='annual' || fType==='sick') leaveQ = leaveQ.eq('leave_type', fType);
    if (fStatus) leaveQ = leaveQ.eq('status', fStatus);
    if (fFrom)   leaveQ = leaveQ.gte('start_date', fFrom);
    if (fTo)     leaveQ = leaveQ.lte('end_date', fTo);
  }
  if (wantCompOff) {
    coQ = sb.from('comp_off_requests').select('*').order('created_at',{ascending:false});
    if (fEmp)    coQ = coQ.eq('employee', fEmp);
    if (fType==='compoff_full') coQ = coQ.eq('type', 'Full Day');
    if (fType==='compoff_half') coQ = coQ.eq('type', 'Half Day');
    if (fStatus) coQ = coQ.eq('status', fStatus);
    if (fFrom)   coQ = coQ.gte('request_date', fFrom);
    if (fTo)     coQ = coQ.lte('request_date', fTo);
  }

  const [lr, cr] = await Promise.all([
    leaveQ ? leaveQ : Promise.resolve({data:[]}),
    coQ    ? coQ    : Promise.resolve({data:[]})
  ]);
  document.getElementById('lv-approvals-load').style.display='none';

  const leaveRows = (lr.data||[]).map(function(r){ return Object.assign({_kind:'leave'}, r); });
  const coRows    = (cr.data||[]).map(function(r){ return Object.assign({_kind:'compoff'}, r); });

  // Overlap detection only meaningful for date-range leave; skip comp-off.
  // Exclude rejected AND cancelled — neither represents a real future absence,
  // so they shouldn't generate overlap warnings against a live request.
  leaveRows.forEach(function(r){
    r._overlaps = leaveRows.filter(function(o){
      return o.id !== r.id
          && o.employee !== r.employee
          && o.status !== 'rejected'
          && o.status !== 'cancelled'
          && o.start_date <= r.end_date
          && o.end_date   >= r.start_date;
    });
  });

  const rows = leaveRows.concat(coRows).sort(function(a,b){
    return new Date(b.created_at||0) - new Date(a.created_at||0);
  });

  const pending = rows.filter(function(r){return r.status==='pending';});
  const others  = rows.filter(function(r){return r.status!=='pending';});
  let html='';
  if (!rows.length) {
    html += '<div style="padding:14px;background:#f8fafc;border-radius:8px;color:var(--muted);font-size:13px;margin-bottom:14px">No requests match the filters.</div>';
  }
  if (pending.length){
    html+='<h3 style="font-size:14px;font-weight:600;color:var(--navy);margin-bottom:12px">🟡 Pending ('+pending.length+')</h3>';
    html+=pending.map(function(r){return approvalCard(r, r._kind);}).join('');
  }
  if (others.length){
    html+='<h3 style="font-size:14px;font-weight:600;color:var(--muted);margin:20px 0 12px">History ('+others.length+')</h3>';
    html+=others.map(function(r){return approvalCard(r, r._kind);}).join('');
  }

  // Always show the approved-balance source-of-truth section (annual_leave).
  // Only relevant when annual/sick selected or no type filter.
  if (wantLeave) {
    html += await buildApprovedLeavesSection();
  }

  document.getElementById('lv-approvals-content').innerHTML=html;
  if (typeof renderIcons === 'function') renderIcons();
}

// === APPROVED LEAVE RECORDS (annual_leave table) ==================
async function buildApprovedLeavesSection() {
  // Reuse the same filter inputs so manager can drill in
  var fEmp    = (document.getElementById('lv-app-emp')||{}).value || '';
  var fType   = (document.getElementById('lv-app-type')||{}).value || '';
  var fFrom   = (document.getElementById('lv-app-from')||{}).value || '';
  var fTo     = (document.getElementById('lv-app-to')||{}).value || '';

  var q = sb.from('annual_leave').select('*').order('start_date',{ascending:false});
  if (fEmp)  q = q.eq('employee', fEmp);
  if (fType) q = q.eq('leave_type', fType);
  if (fFrom) q = q.gte('start_date', fFrom);
  if (fTo)   q = q.lte('end_date', fTo);

  var {data, error} = await q;
  if (error) {
    return '<h3 style="font-size:14px;font-weight:600;color:var(--danger);margin:24px 0 8px">Approved Leave Records</h3>'+
      '<div style="color:var(--danger)">Could not load: '+error.message+'</div>';
  }
  var rows = data || [];
  var html = '<h3 style="font-size:14px;font-weight:600;color:var(--navy);margin:28px 0 8px">📒 Approved Leave Records — Legacy ('+rows.length+')</h3>'+
    '<div style="background:#F1F5F9;color:#475569;border-left:3px solid #94A3B8;padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:10px;line-height:1.5">'+
      'ℹ️ <strong>Legacy ledger.</strong> As of v81, leave balances are computed day-by-day directly from <code>leave_requests</code>. ' +
      'These rows are kept for historical reference but no longer drive the balance. Edits here have no effect on what an employee has &quot;used&quot;.'+
    '</div>';
  if (!rows.length) {
    html += renderEmptyState({
      icon: 'clipboard-x',
      heading: 'No approved leave records',
      sub: 'When the manager approves leave requests, they show up here.',
      padding: '14px'
    });
    return html;
  }
  // v127: dropped the per-row Edit/Delete buttons. The banner above already
  // says "edits have no effect on what an employee has 'used'"; the buttons
  // contradicted that and mutated rows that don't drive any balance.
  // History rows are read-only now. openEditALModal/deleteAL remain in the
  // codebase for any back-office use but are unreachable from the UI.
  html += '<div class="table-wrap"><table style="width:100%;font-size:12px"><thead><tr>'+
    '<th>Employee</th><th>Type</th><th>Start</th><th>End</th><th>Working Days</th><th>Created</th>'+
    '</tr></thead><tbody>'+
    rows.map(function(r){
      return '<tr>'+
        '<td><strong>'+esc2(r.employee||'')+'</strong></td>'+
        '<td><span class="badge" style="background:#f0f4ff;color:var(--navy)">'+esc2(r.leave_type||'')+'</span></td>'+
        '<td style="font-family:DM Mono,monospace">'+fmtDate(r.start_date)+'</td>'+
        '<td style="font-family:DM Mono,monospace">'+fmtDate(r.end_date)+'</td>'+
        '<td style="font-family:DM Mono,monospace;font-weight:700">'+r.working_days+'</td>'+
        '<td style="font-size:11px;color:var(--muted)"'+(r.created_at?' title="'+relativeTimeTitle(r.created_at)+'"':'')+'>'+(r.created_at?relativeTime(r.created_at):'')+'</td>'+
        '</tr>';
    }).join('')+
    '</tbody></table></div>';
  return html;
}

async function openEditALModal(id) {
  var {data, error} = await sb.from('annual_leave').select('*').eq('id', id).single();
  if (error || !data) { showError('Could not load record.'); return; }
  document.getElementById('edit-al-id').value = data.id;
  document.getElementById('edit-al-emp').value = data.employee || '';
  document.getElementById('edit-al-type').value = data.leave_type || 'Annual';
  document.getElementById('edit-al-start').value = data.start_date || '';
  document.getElementById('edit-al-end').value = data.end_date || '';
  document.getElementById('edit-al-days').value = data.working_days || '';
  document.getElementById('edit-al-error').style.display = 'none';
  document.getElementById('edit-al-modal').classList.add('show');
}
function closeEditALModal() {
  document.getElementById('edit-al-modal').classList.remove('show');
}
async function saveEditAL() {
  if (!await requireAuth()) return;
  var id = document.getElementById('edit-al-id').value;
  var emp = document.getElementById('edit-al-emp').value;
  var type = document.getElementById('edit-al-type').value;
  var start = document.getElementById('edit-al-start').value;
  var end = document.getElementById('edit-al-end').value;
  var days = parseFloat(document.getElementById('edit-al-days').value);
  var errEl = document.getElementById('edit-al-error');
  errEl.style.display = 'none';
  if (!start || !end) { errEl.textContent='Start and end dates are required.'; errEl.style.display='block'; return; }
  if (start > end)    { errEl.textContent='Start date must be before end date.'; errEl.style.display='block'; return; }
  // Recalc days unless manager overrode
  if (isNaN(days) || days <= 0) days = calcWorkingDays(start, end, emp);
  var {error} = await sb.from('annual_leave').update({
    leave_type: type, start_date: start, end_date: end, working_days: days
  }).eq('id', id);
  if (error) { errEl.textContent='Error: '+error.message; errEl.style.display='block'; return; }
  closeEditALModal();
  showToast('Leave record updated ✓');
  renderLeaveApprovals();
}
async function deleteAL(id, employee) {
  if (!await requireAuth()) return;
  if (!await confirmAction({
    title: 'Delete this approved leave record?',
    body: 'Employee: '+employee+'\n\nThis will permanently remove the leave record. The employee\'s used-days balance will decrease.\n\nThis cannot be undone.',
    requireTyping: 'DELETE',
    confirmText: 'Delete leave record'
  })) return;
  var {error} = await sb.from('annual_leave').delete().eq('id', id);
  if (error) { showError('Error: '+error.message); return; }
  showToast('Leave record deleted ✓');
  renderLeaveApprovals();
}

// === EDIT LEAVE REQUEST (manager only) ============================
function openEditLeaveModal(id) {
  sb.from('leave_requests').select('*').eq('id', id).single().then(function(res){
    if (res.error || !res.data) { showError('Could not load leave request.'); return; }
    var r = res.data;
    document.getElementById('edit-lv-id').value = r.id;
    document.getElementById('edit-lv-emp').value = r.employee || '';
    document.getElementById('edit-lv-type').value = r.leave_type || 'Annual';
    document.getElementById('edit-lv-start').value = r.start_date || '';
    document.getElementById('edit-lv-end').value = r.end_date || '';
    document.getElementById('edit-lv-status').value = r.status || 'pending';
    document.getElementById('edit-lv-reason').value = r.reason || '';
    document.getElementById('edit-lv-comment').value = r.manager_comment || '';
    document.getElementById('edit-leave-error').style.display = 'none';
    document.getElementById('edit-leave-modal').classList.add('show');
  });
}
function closeEditLeaveModal() {
  document.getElementById('edit-leave-modal').classList.remove('show');
}
async function saveEditLeave() {
  if (!await requireAuth()) return;
  var id = document.getElementById('edit-lv-id').value;
  var emp = document.getElementById('edit-lv-emp').value;
  var type = document.getElementById('edit-lv-type').value;
  var start = document.getElementById('edit-lv-start').value;
  var end   = document.getElementById('edit-lv-end').value;
  var status = document.getElementById('edit-lv-status').value;
  var reason = document.getElementById('edit-lv-reason').value;
  var comment = document.getElementById('edit-lv-comment').value;
  var errEl = document.getElementById('edit-leave-error');
  errEl.style.display = 'none';
  if (!start || !end) { errEl.textContent='Start and end dates are required.'; errEl.style.display='block'; return; }
  if (start > end)    { errEl.textContent='Start date must be before end date.'; errEl.style.display='block'; return; }

  var days = calcWorkingDays(start, end, emp);
  var payload = {
    leave_type: type,
    start_date: start, end_date: end,
    working_days: days,
    reason: reason || null,
    status: status,
    manager_comment: comment || null
  };
  var {error} = await sb.from('leave_requests').update(payload).eq('id', id);
  if (error) { errEl.textContent='Error: '+error.message; errEl.style.display='block'; return; }
  closeEditLeaveModal();
  showToast('Leave request updated ✓');
  renderLeaveApprovals();
}

function approvalCard(r,type) {
  const isPending = r.status==='pending';
  const isNeedsReview = r.status==='needs_review';
  let info='';
  if (type==='compoff') info='<strong>'+r.employee+'</strong> — '+r.type+' on '+fmtDate(r.request_date)+(r.related_activity?' ('+r.related_activity+')':'');
  else {
    var isHalf = (parseFloat(r.working_days) === 0.5);
    var halfBadge = isHalf ? ' <span class="badge" style="background:#EDE9FE;color:#5B21B6;font-size:10px">Half day</span>' : '';
    var dateLabel = r.start_date===r.end_date ? fmtDate(r.start_date) : fmtDateRange(r.start_date, r.end_date);
    info='<strong>'+r.employee+'</strong> — '+dateLabel+halfBadge+' ('+fmtDays(r.working_days)+')'+(r.reason?' | '+r.reason:'');
  }

  // Overlap warning for leave requests where another employee has a
  // pending/approved leave covering any of the same dates.
  var overlapHtml = '';
  if (type==='leave' && r._overlaps && r._overlaps.length) {
    var detail = r._overlaps.map(function(o){
      return o.employee + ' (' + (o.status||'?') + ', ' + fmtDate(o.start_date) + '–' + fmtDate(o.end_date) + ')';
    }).join('; ');
    overlapHtml = '<div style="background:#FEF3C7;color:#92400E;border-left:3px solid #F59E0B;padding:8px 10px;border-radius:6px;font-size:12px;margin-top:8px;line-height:1.4">'+
      '⚠️ <strong>Overlap caution:</strong> '+r._overlaps.length+' other request'+(r._overlaps.length===1?'':'s')+' on these dates — '+detail+
      '</div>';
  }

  // For approved leaves, decide which actions are still valid based on whether
  // the leave is fully past (terminal), in-progress (can cancel with warning,
  // or rebrand to rejected), or future (can cancel cleanly).
  var actionsHtml = '';
  var todayISO = (typeof _leaveTodayISO === 'function') ? _leaveTodayISO() : '';
  if (type === 'leave') {
    if (isPending) {
      actionsHtml += '<button class="btn btn-sm btn-primary" onclick="openApproveModal(\'leave\','+r.id+',\''+r.employee+'\')">Review</button>';
      actionsHtml += '<button class="btn btn-sm btn-ghost" onclick="cancelLeaveRequest('+r.id+')" title="Cancel this request">✕ Cancel</button>';
    } else if (isNeedsReview) {
      actionsHtml += '<button class="btn btn-sm btn-primary" onclick="openApproveModal(\'leave\','+r.id+',\''+r.employee+'\')">Review</button>';
      actionsHtml += '<button class="btn btn-sm btn-ghost" onclick="resetLeaveToPending('+r.id+')" title="Move back to Pending">↩ Pending</button>';
    } else if (r.status === 'approved') {
      var fullyPast = r.end_date && todayISO && r.end_date < todayISO;
      if (!fullyPast) {
        // future or in-progress — cancel is allowed (cancelLeaveRequest warns
        // when mid-leave). Reject path needs the full review modal so manager
        // can record a required reason; pass fromApproved so the modal locks
        // the comment requirement.
        actionsHtml += '<button class="btn btn-sm btn-ghost" onclick="cancelLeaveRequest('+r.id+')" title="Cancel approved leave">✕ Cancel</button>';
        actionsHtml += '<button class="btn btn-sm btn-ghost" onclick=\'openApproveModal("leave",'+r.id+',"'+(r.employee||'').replace(/"/g,'\\"')+'",{fromApproved:true,leaveRow:'+JSON.stringify({start_date:r.start_date,end_date:r.end_date})+'})\' title="Change to rejected">↺ Reject</button>';
      }
      // fullyPast → no actions, terminal display.
    }
    // rejected / cancelled → terminal, no action buttons.
    actionsHtml += '<button class="btn btn-sm btn-ghost" onclick="openEditLeaveModal('+r.id+')" title="Edit request">✏️</button>';
  } else {
    // comp-off — original behaviour kept (no cancel/needs_review for v1)
    if (isPending) {
      actionsHtml += '<button class="btn btn-sm btn-primary" onclick="openApproveModal(\'compoff\','+r.id+',\''+r.employee+'\')">Review</button>';
    } else if (isNeedsReview) {
      actionsHtml += '<button class="btn btn-sm btn-primary" onclick="openApproveModal(\'compoff\','+r.id+',\''+r.employee+'\')">Review</button>';
      actionsHtml += '<button class="btn btn-sm btn-ghost" onclick="resetLeaveToPending('+r.id+')" title="Move back to Pending">↩ Pending</button>';
    }
  }
  actionsHtml += '<button class="btn btn-sm btn-danger" onclick="deleteRequest(\''+type+'\','+r.id+')" title="Delete request">✕</button>';

  // Cancellation footer — when status is cancelled, show who/when. For
  // rejected and needs_review the existing manager_comment row below is
  // already in place to surface the reason / discussion prompt.
  var cancelFoot = '';
  if (r.status === 'cancelled' && r.cancelled_at) {
    cancelFoot = '<div style="font-size:12px;color:var(--muted);margin-top:6px">' +
      '🚫 Cancelled ' + relativeTime(r.cancelled_at) +
      (r.cancelled_by ? ' by ' + esc2(r.cancelled_by) : '') +
      (r.effective_end_date ? ' · Days counted through ' + fmtDate(r.effective_end_date) : '') +
      '</div>';
  }

  return '<div class="request-card '+r.status+'" style="margin-bottom:10px">'+
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">'+
    '<div style="font-size:13px">'+info+'<br><span style="font-size:11px;color:var(--muted)" title="'+relativeTimeTitle(r.created_at)+'">Submitted '+relativeTime(r.created_at)+'</span></div>'+
    '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">'+
    '<span class="badge badge-'+r.status+'">'+statusIcon(r.status)+' '+cap(r.status.replace('_',' '))+'</span>'+
    actionsHtml+
    '</div></div>'+
    overlapHtml+
    (r.manager_comment?'<div style="font-size:12px;color:var(--muted);margin-top:8px">💬 '+esc2(r.manager_comment)+'</div>':'')+
    cancelFoot+
    '</div>';
}

function openApproveModal(type,id,employee,opts) {
  opts = opts || {};
  approveTarget = {
    type:type, id:id, employee:employee,
    // Set when the row was already approved and the manager is changing it
    // to rejected. Triggers the required-comment guard + the in-progress
    // effective_end_date logic in processRequest.
    fromApproved: !!opts.fromApproved,
    leaveRow: opts.leaveRow || null
  };
  // Pick a title that matches the source. The same modal is reused by OT
  // sessions, leave requests and comp-off requests, so the title has to
  // adapt or managers see 'Review Leave Request' on an OT session.
  var title = type==='ot'      ? 'Review OT Session'
            : type==='compoff' ? 'Review Comp Off Request'
            : opts.fromApproved? 'Reject approved leave?'
            :                    'Review Leave Request';
  document.getElementById('approve-modal-title').textContent=title;
  document.getElementById('approve-modal-info').textContent='Employee: '+employee;
  document.getElementById('approve-comment').value='';
  // Comment label switches between optional/required based on the action.
  var lbl = document.getElementById('approve-comment-label');
  if (lbl) {
    lbl.textContent = opts.fromApproved
      ? 'Rejection reason (required)'
      : 'Comment (optional — required for Needs Re-Review)';
  }
  // Needs Re-Review button: only for the standard review of a leave or
  // comp-off request, not for OT and not for the post-approval rejection
  // flow (where the only outcomes are "go through with rejection" or cancel).
  var reviewBtn = document.getElementById('approve-review-btn');
  if (reviewBtn) {
    var showReview = (type === 'leave' || type === 'compoff') && !opts.fromApproved;
    reviewBtn.style.display = showReview ? '' : 'none';
  }
  document.getElementById('approve-modal').classList.add('show');
}

function closeApproveModal() {
  document.getElementById('approve-modal').classList.remove('show');
  approveTarget=null;
  // Reset the glow-button to its default state so the next open is clean.
  var btn = document.getElementById('approve-action-btn');
  if (btn) {
    btn.classList.remove('active');
    btn.innerHTML = '<span class="dot"></span>Approve';
  }
}

// Quick success-glow transition before the modal closes on an approved
// decision. The button flips to its active state (solid green + white
// glowing dot) for 800ms so the manager gets a satisfying confirmation
// before the row dismisses. Rejections skip this — no celebration on
// negative outcomes.
function _approveSuccessGlow() {
  var btn = document.getElementById('approve-action-btn');
  if (!btn) return Promise.resolve();
  btn.classList.add('active');
  btn.innerHTML = '<span class="dot"></span>Approved <i data-lucide="check" style="width:14px;height:14px;stroke-width:3"></i>';
  if (typeof renderIcons === 'function') renderIcons();
  return new Promise(function(r){ setTimeout(r, 800); });
}

async function deleteRequest(type, id) {
  if (!await requireAuth()) return;
  // If the request is approved, also clean the corresponding balance row so
  // we don't leave orphan annual_leave / comp_off_register rows behind.
  const table = type==='compoff' ? 'comp_off_requests' : 'leave_requests';
  const {data: existing} = await sb.from(table).select('*').eq('id', id).single();
  var isApproved = existing && existing.status === 'approved';

  var dOpts;
  if (isApproved) {
    dOpts = {
      title: 'Delete this approved request?',
      body: 'This request is APPROVED. Deleting will also remove the matching balance record (the employee\'s used days will decrease).\n\nThis cannot be undone.',
      requireTyping: 'DELETE',
      confirmText: 'Delete approved'
    };
  } else {
    dOpts = { title: 'Delete this request?', body: 'This cannot be undone.', confirmText: 'Delete' };
  }
  if (!await confirmAction(dOpts)) return;

  if (isApproved && existing) {
    if (type === 'compoff') {
      await sb.from('comp_off_register').delete().eq('related_request', id);
    } else {
      // annual_leave doesn't have related_request FK - match on emp + dates + type
      await sb.from('annual_leave').delete()
        .eq('employee', existing.employee)
        .eq('start_date', existing.start_date)
        .eq('end_date', existing.end_date)
        .eq('leave_type', existing.leave_type);
    }
  }
  const {error} = await sb.from(table).delete().eq('id', id);
  if (error) { showError('Error: '+error.message); return; }
  showToast('Request deleted ✓');
  renderLeaveApprovals();
}

async function processRequest(decision) {
  if (!approveTarget) return;
  if (!await requireAuth()) return;
  const {type,id,employee}=approveTarget;
  const comment=document.getElementById('approve-comment').value.trim();

  // Comment is REQUIRED for needs_review (the discussion prompt for the
  // employee) and for rejecting a previously approved leave (the rejection
  // reason). For plain pending→approved/rejected the field stays optional
  // — matches the prior behaviour.
  if (decision === 'needs_review' && !comment) {
    showError('A comment is required when marking for re-review.');
    return;
  }
  if (decision === 'rejected' && type === 'leave' && approveTarget.fromApproved && !comment) {
    showError('A rejection reason is required when rejecting an approved leave.');
    return;
  }

  var nowISO = new Date().toISOString();

  // OT sessions live in their own table — just update status
  if (type==='ot') {
    const {error}=await sb.from('ot_sessions').update({
      status:decision,manager_comment:comment,reviewed_by:currentUser,reviewed_at:nowISO
    }).eq('id',id);
    if (error){showError('Error: '+error.message);return;}
    if (decision === 'approved') await _approveSuccessGlow();
    closeApproveModal(); updateNotifBadge(); renderOTApprovals();
    showToast(decision === 'approved' ? 'Request approved ✓' : 'Request rejected ✓');
    return;
  }

  const table=type==='compoff'?'comp_off_requests':'leave_requests';

  // Build the update payload. For leave, also set status_changed_at and (if
  // we're rejecting a leave that's already in progress) effective_end_date
  // = yesterday so past days stay counted.
  var payload = {
    status: decision,
    manager_comment: comment || null,
    reviewed_by: currentUser,
    reviewed_at: nowISO
  };
  if (type === 'leave') {
    payload.status_changed_at = nowISO;
    if (decision === 'rejected' && approveTarget.fromApproved) {
      // Was previously approved and now being rejected. If the leave is
      // mid-flight, freeze the count at yesterday.
      var todayISO = _leaveTodayISO();
      var orig = approveTarget.leaveRow || {};
      if (orig.start_date && orig.start_date <= todayISO &&
          orig.end_date   && orig.end_date   >= todayISO) {
        payload.effective_end_date = _leaveYesterdayISO();
      }
    }
  }

  const {error}=await sb.from(table).update(payload).eq('id',id);
  if (error){showError('Error: '+error.message);return;}

  // Comp-off approval still mirrors into comp_off_register (its balance
  // model is unchanged). Leave approval no longer writes to annual_leave —
  // the day-by-day rule reads leave_requests directly, so the snapshot row
  // would be dead data.
  if (decision==='approved' && type==='compoff') {
    const {data}=await sb.from('comp_off_requests').select('*').eq('id',id).single();
    if (data) await sb.from('comp_off_register').insert({
      employee:data.employee,date_taken:data.request_date,type:data.type,
      days:data.days,approved_by:currentUser,remarks:data.remarks||''
    });
  }

  if (decision === 'approved') await _approveSuccessGlow();
  closeApproveModal();
  updateNotifBadge();
  var toastMsg = decision === 'approved' ? 'Request approved ✓'
              : decision === 'rejected'  ? 'Request rejected ✓'
              : decision === 'needs_review' ? 'Marked for re-review ✓'
              : 'Updated ✓';
  showToast(toastMsg);
  renderLeaveApprovals();
}

// Move a needs_review leave back to pending (per spec — manager can park
// the discussion and resume the normal approval flow later). No comment
// required; current manager_comment stays as historical context.
async function resetLeaveToPending(id) {
  if (!await requireAuth()) return;
  if (!await confirmAction({
    title: 'Move back to Pending?',
    body: 'This will clear the re-review state. The manager comment stays as history; you can review the request again from the Pending list.',
    confirmText: 'Move to Pending',
    danger: false
  })) return;
  var nowISO = new Date().toISOString();
  var res = await sb.from('leave_requests').update({
    status: 'pending', status_changed_at: nowISO
  }).eq('id', id);
  if (res.error) { showError('Error: '+res.error.message); return; }
  showToast('Moved back to Pending ✓');
  updateNotifBadge();
  renderLeaveApprovals();
}

// Cancel a leave request — employee can cancel their own; manager can
// cancel any. Past-only leaves are blocked. Mid-leave cancellations set
// effective_end_date = yesterday so past days stay counted as used.
async function cancelLeaveRequest(id) {
  if (!await requireAuth()) return;
  var res = await sb.from('leave_requests').select('*').eq('id', id).single();
  if (res.error || !res.data) { showError('Could not load request.'); return; }
  var r = res.data;
  var canManage = isManager || r.employee === currentUser;
  if (!canManage) { showError('You can only cancel your own leave.'); return; }
  if (r.status !== 'pending' && r.status !== 'needs_review' && r.status !== 'approved') {
    showError('Only pending or approved leaves can be cancelled.');
    return;
  }
  var todayISO = _leaveTodayISO();
  if (r.status === 'approved' && r.end_date < todayISO) {
    showError('Cannot cancel a leave that has already been taken.');
    return;
  }
  // Confirm modal — copy depends on whether we're mid-leave or not.
  var midLeave = r.status === 'approved' && r.start_date <= todayISO && r.end_date >= todayISO;
  var bodyText = midLeave
    ? 'This leave is currently in progress. Days from ' + r.start_date + ' through yesterday will remain counted as used. Future days will not count.'
    : (r.status === 'approved'
        ? 'This approved leave is in the future. Cancelling will un-count all its days.'
        : 'Cancel this ' + r.status + ' request?');
  if (!await confirmAction({
    title: midLeave ? 'Cancel in-progress leave?' : 'Cancel this request?',
    body: bodyText,
    confirmText: 'Cancel leave',
    danger: true
  })) return;

  var payload = {
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
    cancelled_by: currentUser,
    status_changed_at: new Date().toISOString()
  };
  if (midLeave) payload.effective_end_date = _leaveYesterdayISO();

  var up = await sb.from('leave_requests').update(payload).eq('id', id);
  if (up.error) { showError('Error: '+up.error.message); return; }
  showToast('Leave cancelled ✓');
  updateNotifBadge();
  // Re-render whichever list the user is looking at.
  if (typeof renderLeaveApprovals === 'function' && document.getElementById('lv-approvals-content')) {
    renderLeaveApprovals();
  }
  if (typeof renderLeaveHistory === 'function' && document.getElementById('lv-hist-content')) {
    renderLeaveHistory();
  }
}

// == EXPORT CSV ====================================================
