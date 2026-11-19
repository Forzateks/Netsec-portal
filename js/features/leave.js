// == LEAVE REQUESTS (Annual + Sick) ===============================
// == PUBLIC HOLIDAYS (v193) =======================================
// A public holiday is not a working day, so it is never charged as leave.
// When the holiday's counts_for_ot flag is set, work on it is also credited
// as overtime under weekend rules (see isOnLeave() in overtime.js).
//
// Region: an employee is KSA if they are in KSA_EMP, otherwise UAE. A holiday
// applies to its own region, or to everyone when its region is 'ALL'.
function employeeRegion(employee) {
  return KSA_EMP.includes(employee) ? 'KSA' : 'UAE';
}

// The holiday row that applies to this employee on this 'YYYY-MM-DD', or null.
function getPublicHoliday(employee, iso) {
  if (!iso || typeof PUBLIC_HOLIDAYS === 'undefined' || !PUBLIC_HOLIDAYS.length) return null;
  var region = employeeRegion(employee || '');
  for (var i = 0; i < PUBLIC_HOLIDAYS.length; i++) {
    var h = PUBLIC_HOLIDAYS[i];
    if (h.holiday_date === iso && (h.region === 'ALL' || h.region === region)) return h;
  }
  return null;
}

// Returns true on success. On failure the previous list is kept: a stale
// list miscounts nothing that was right a minute ago, an empty one would
// silently charge every holiday back as leave.
async function loadPublicHolidays() {
  var res = await sb.from('public_holidays')
    .select('id,holiday_date,name,region,counts_for_ot')
    .order('holiday_date', { ascending: true });
  if (res.error) return false;
  PUBLIC_HOLIDAYS = res.data || [];
  return true;
}

function calcWorkingDays(startStr,endStr,employee) {
  return listWorkingDays(startStr,endStr,employee).length;
}

// v202: the working days (ISO strings) between two dates for this employee -
// weekends (region + dated rotations) and public holidays skipped. Comp Off
// uses the list itself (one register row per day); calcWorkingDays is its count.
function listWorkingDays(startStr,endStr,employee) {
  const out=[];
  if (!startStr||!endStr) return out;
  const start=new Date(startStr); const end=new Date(endStr);
  if (end<start) return out;
  const cur=new Date(start);
  while (cur<=end) {
    // v193: UTC getters throughout. new Date('YYYY-MM-DD') is UTC midnight, so
    // local getters read the PREVIOUS day in any timezone west of Greenwich -
    // a holiday (or weekend) was then matched a day early. Gulf browsers were
    // unaffected; this makes the count the same everywhere.
    const wd=cur.getUTCDay();
    // v166: pass the DATE too. isWeekend() only consults WEEKEND_OVERRIDES
    // (dated onsite rotations, e.g. a Thu+Fri weekend) when it is given a
    // date string — without it every leave day was counted against the
    // employee's DEFAULT region weekend, so a rotation's real days off were
    // charged as leave and its real working days were not counted at all.
    const iso = cur.getUTCFullYear()+'-'+String(cur.getUTCMonth()+1).padStart(2,'0')+'-'+String(cur.getUTCDate()).padStart(2,'0');
    // v193: a public holiday for this employee's region is not a working day.
    if (!isWeekend(wd,employee,iso) && !getPublicHoliday(employee,iso)) out.push(iso);
    cur.setUTCDate(cur.getUTCDate()+1);
  }
  return out;
}

// v202: how a comp-off request's date(s) read - one day, or a range with its count.
function coWhen(r) {
  var n = (r.dates && r.dates.length) ? r.dates.length : 1;
  if (n > 1 && r.end_date && r.end_date !== r.request_date) return fmtDateRange(r.request_date, r.end_date);
  return fmtDate(r.request_date);
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
// v172: the calendar range a leave actually covered, as {start,end} ISO
// strings, or null if it covered nothing. Extracted from computeLeaveUsedDays
// so the OT engine can ask "was this person off on that day?" without
// duplicating the cancellation rules below — the subtle part is the same
// either way, and two copies would drift.
function leaveEffectiveRange(leave) {
  if (!leave) return null;
  if (leave.status !== 'approved' && leave.status !== 'cancelled') return null;
  var start = leave.start_date;
  if (!start) return null;

  var effEnd;
  if (leave.status === 'cancelled') {
    // v166 FIX. A cancellation only ever leaves days counted when it happened
    // DURING the leave — which is exactly when cancelLeaveRequest() writes
    // effective_end_date. The old code fell back to end_date when that column
    // was null, which silently re-counted the ENTIRE leave as taken the moment
    // the calendar reached start_date. Because cancelling a future leave never
    // sets effective_end_date, every leave cancelled in advance looked fine at
    // cancel time and then quietly started consuming the balance on its own
    // start date — a time-bomb, not an immediate error.
    //
    // Order of evidence: the explicit column, then the cancellation timestamp
    // (so rows written before effective_end_date existed are still judged on
    // fact, not assumption), then nothing.
    if (leave.effective_end_date) {
      effEnd = leave.effective_end_date;
    } else if (leave.cancelled_at) {
      // A leave that never cleared manager review was never actually taken —
      // cancelLeaveRequest() also accepts 'pending' and 'needs_review', so a
      // withdrawn request lands here with a cancelled_at that must NOT be read
      // as "days off work". reviewed_at is written by the only two paths that
      // set an approve/reject decision, so null means it was never approved.
      if (!leave.reviewed_at) return null;
      var cancelDay = String(leave.cancelled_at).slice(0, 10);
      if (cancelDay <= start) return null;   // cancelled before it ever began
      effEnd = _isoDayBefore(cancelDay);  // cancelling takes effect same-day
      // Never let a late cancellation stretch past the leave itself.
      if (leave.end_date && effEnd > leave.end_date) effEnd = leave.end_date;
    } else {
      return null;                        // no evidence any day was taken
    }
  } else {
    effEnd = leave.end_date;
  }

  if (!effEnd || effEnd < start) return null;
  return { start: start, end: effEnd };
}

// 'YYYY-MM-DD' one calendar day later. Mirrors _isoDayBefore — pure UTC
// arithmetic, never reads the browser timezone.
function _isoDayAfter(iso) {
  var p = String(iso).split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1));
  return d.getUTCFullYear() + '-' +
         String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
         String(d.getUTCDate()).padStart(2, '0');
}

// == LEAVE-DAY LOOKUP FOR THE OT ENGINE (v172) ====================
// Builds LEAVE_DAYS = { 'Employee': { 'YYYY-MM-DD': 'annual' } } from
// approved ANNUAL leave, so calcOT() can credit a session logged on a
// holiday under weekend rules. Covers ALL employees, not just the current
// user — any of them can be a team member on someone else's session.
//
// Annual leave ONLY, by policy decision: sick leave is for recovery and
// comp-off is itself time already paid back out of the OT pool, so neither
// earns overtime. A row whose leave_type is blank counts as annual — the
// column defaults to 'annual' and blanks are a data artefact, not a type.
//
// Cancelled leave is included only for the stretch it actually covered,
// via leaveEffectiveRange(), so cancelling a holiday also withdraws the
// OT treatment for the days that never happened.
//
// Returns true on success. On failure the previous map is left in place
// rather than cleared: a stale map under-credits nobody, an empty one
// silently drops leave-day OT for everyone.
async function loadLeaveDays() {
  // v193: every caller that refreshes the leave map (login, approvals, the
  // Recompute tools) wants current holidays too - calcOT reads both.
  var holidaysOk = await loadPublicHolidays();
  var map = {};
  function mark(emp, iso, type) {
    if (!emp || !iso) return;
    if (!map[emp]) map[emp] = {};
    if (!map[emp][iso]) map[emp][iso] = type;
  }

  var lr = await fetchAllRows(function(){
    return sb.from('leave_requests')
      .select('employee,start_date,end_date,leave_type,status,effective_end_date,cancelled_at,reviewed_at')
      .in('status', ['approved', 'cancelled']);
  });
  if (lr.error) return false;

  (lr.data || []).forEach(function(row){
    if (row.leave_type === 'sick') return;      // annual leave only
    var range = leaveEffectiveRange(row);
    if (!range) return;
    var day = range.start, guard = 0;
    while (day <= range.end && guard++ < 400) {
      mark(row.employee, day, 'annual');
      day = _isoDayAfter(day);
    }
  });

  LEAVE_DAYS = map;
  // False if either half is stale, so the Recompute tools can refuse to run
  // against an out-of-date picture of who was off.
  return holidaysOk;
}

function computeLeaveUsedDays(leave, todayISO) {
  var range = leaveEffectiveRange(leave);
  if (!range) return 0;
  if (range.start > todayISO) return 0;
  var lastDay = range.end < todayISO ? range.end : todayISO;
  if (parseFloat(leave.working_days) === 0.5 && range.start === range.end) {
    // v193: a half day that lands on a public holiday used no leave at all.
    return getPublicHoliday(leave.employee, range.start) ? 0 : 0.5;
  }
  return calcWorkingDays(range.start, lastDay, leave.employee);
}

// 'YYYY-MM-DD' one calendar day earlier. Pure UTC arithmetic — never reads the
// browser timezone, matching how the rest of this file treats date strings as
// plain calendar values.
function _isoDayBefore(iso) {
  var p = String(iso).split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] - 1));
  return d.getUTCFullYear() + '-' +
         String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
         String(d.getUTCDate()).padStart(2, '0');
}

// == LEAVE YEAR (v195) ============================================
// Annual and sick allowances belong to a calendar year: they start again on
// 1 January and unused days do not carry over. A day of leave is charged to
// the year it FALLS in, so a leave running from December into January is
// split between the two years instead of landing whole on the year it began
// (which is what filtering by start_date did).
//
// todayISO caps the count at "taken so far"; pass null for the whole year
// including days still to come.
function computeLeaveDaysInYear(leave, year, todayISO) {
  var range = leaveEffectiveRange(leave);
  if (!range) return 0;
  var yStart = year + '-01-01', yEnd = year + '-12-31';
  var start = range.start > yStart ? range.start : yStart;
  var end   = range.end   < yEnd   ? range.end   : yEnd;
  if (todayISO && todayISO < end) end = todayISO;
  if (end < start) return 0;
  if (parseFloat(leave.working_days) === 0.5 && range.start === range.end) {
    return getPublicHoliday(leave.employee, range.start) ? 0 : 0.5;
  }
  return calcWorkingDays(start, end, leave.employee);
}

// Approved days of `year` that have not happened yet.
function computeUpcomingDaysInYear(leave, year, todayISO) {
  if (!leave || leave.status !== 'approved') return 0;
  return Math.max(0, computeLeaveDaysInYear(leave, year, null) - computeLeaveDaysInYear(leave, year, todayISO));
}

// Narrows a leave_requests query to rows that touch `year` at all: started on
// or before 31 December AND ended on or after 1 January.
function leaveYearFilter(q, year) {
  return q.lte('start_date', year + '-12-31').gte('end_date', year + '-01-01');
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
  var res = await leaveYearFilter(sb.from('leave_requests')
    .select('start_date,end_date,working_days,leave_type,status,employee,effective_end_date,cancelled_at,reviewed_at')
    .eq('employee', employee), year);
  if (res.error) { console.warn('getLeaveDaysUsed:', res.error.message); return 0; }
  var todayISO = _leaveTodayISO();
  return (res.data||[]).filter(function(r){
    if (leaveType) return (r.leave_type||'annual') === leaveType;
    return true;
  }).reduce(function(s,r){ return s + computeLeaveDaysInYear(r, year, todayISO); }, 0);
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
  // v202: a FULL comp-off day can span several days (one request, many days).
  const singleDay = parsed.isHalfDay || (parsed.category === 'compoff' && ltype !== 'compoff_full');
  const endWrap = document.getElementById('lv-end-wrap');
  const startLabel = document.getElementById('lv-start-label');
  const startWrap = document.getElementById('lv-start-wrap');
  if (endWrap)   endWrap.style.display   = singleDay ? 'none' : '';
  if (startLabel) startLabel.textContent = singleDay ? 'Date *' : (ltype === 'compoff_full' ? 'From *' : 'Start Date *');
  var endLabel = document.getElementById('lv-end-label');
  if (endLabel) endLabel.textContent = ltype === 'compoff_full' ? 'To (leave empty for a single day)' : 'End Date *';
  if (startWrap) startWrap.classList.toggle('full', singleDay);
  updateLeavePreview();
}

async function updateLeavePreview() {
  const start = document.getElementById('lv-start').value;
  const end   = document.getElementById('lv-end').value;
  const ltype = document.getElementById('lv-type') ? document.getElementById('lv-type').value : 'annual_full';

  if (isCompOffType(ltype)) {
    // v202: Full comp-off may cover a date range - count only its working days.
    var coList = (ltype==='compoff_full') ? _coRequestDates(start, end) : (start ? [start] : []);
    const reqDays = ltype==='compoff_full' ? coList.length : 0.5;
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
    document.getElementById('lv-prev-days').textContent = reqDays ? fmtDays(reqDays) : 'No working days';
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
  var days = isHalfDay ? (getPublicHoliday(currentUser,start) ? 0 : 0.5) : calcWorkingDays(start,end,currentUser);
  const year = start.split('-')[0];
  // v135 fix: pass the DB category ('annual'/'sick'), NOT the raw dropdown
  // value ('annual_full'). leave_requests.leave_type stores the category
  // (see submit path), so getLeaveDaysUsed's `r.leave_type === leaveType`
  // match returned false for every row since v104 introduced the _full/_half
  // dropdown variants — making "Used This Year" always read 0 and overstating
  // "Balance After".
  const used = await getLeaveDaysUsed(currentUser,year,parsed.category);
  // v195: a request running past 31 December only spends this year's
  // allowance for the days up to the year end; the rest belongs to next year.
  const yearEnd = year + '-12-31';
  const daysThisYear = (isHalfDay || end <= yearEnd) ? days : calcWorkingDays(start, yearEnd, currentUser);
  const balAfter = allowance - used - daysThisYear;
  // v195: a request crossing 31 December says how it splits, so "6 days"
  // beside a 4-day deduction from this year's balance is not a puzzle.
  document.getElementById('lv-prev-days').textContent = (daysThisYear !== days)
    ? fmtDays(days) + ' (' + fmtNumber(daysThisYear, 1) + ' in ' + year + ', ' + fmtNumber(days - daysThisYear, 1) + ' in ' + (Number(year) + 1) + ')'
    : fmtDays(days);
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
  // v193: put the default text back first. Specific messages (overlap,
  // half-day, public holiday) overwrite this element, and it was never
  // reset - so a later, unrelated mistake re-showed the old message.
  if (errEl) {
    if (!errEl.dataset.defaultText) errEl.dataset.defaultText = errEl.textContent;
    errEl.textContent = errEl.dataset.defaultText;
  }
  if (!start||!end){showAlert('leave-error');return;}
  var isHalfDay = parseLtype(ltype).isHalfDay;
  // Half-day → 0.5 working day. Otherwise the standard working-day count
  // (excludes weekends per region).
  var days = isHalfDay ? (getPublicHoliday(currentUser,start) ? 0 : 0.5) : calcWorkingDays(start,end,currentUser);
  if (days<=0){
    // v193: say why, instead of the generic "fill the dates" alert.
    var onlyHol = getPublicHoliday(currentUser,start);
    if (errEl) {
      errEl.textContent = (onlyHol && start === end)
        ? '\u26a0\ufe0f ' + fmtDate(start) + ' is a public holiday (' + onlyHol.name + ') - no leave is needed.'
        : '\u26a0\ufe0f Those dates contain no working days - weekends and public holidays are not charged as leave.';
    }
    showAlert('leave-error');return;
  }
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

// v202: the dates a comp-off request covers. Full Day with an end date = every
// working day in the range; with no end (or the same day) = just that date, as before.
var CO_MAX_DAYS = 31;
function _coRequestDates(start, end) {
  if (!start) return [];
  if (!end || end === start) return [start];
  return listWorkingDays(start, end, currentUser);
}

var _coSubmitting = false;
async function submitCompOffViaLeaveForm(ltype) {
  if (_coSubmitting) return;
  _coSubmitting = true;
  try { await _submitCompOff(ltype); } finally { _coSubmitting = false; }
}

async function _submitCompOff(ltype) {
  if (!await requireAuth()) return;
  const date   = document.getElementById('lv-start').value;
  const endRaw = document.getElementById('lv-end').value;
  const reason = document.getElementById('lv-reason').value.trim();
  const errEl  = document.getElementById('leave-error');
  if (!date) { showAlert('leave-error'); return; }
  const isFull = ltype==='compoff_full';
  const end = isFull ? endRaw : '';
  if (end && end < date) {
    if (errEl) errEl.textContent = '\u26a0\ufe0f The end date is before the start date.';
    showAlert('leave-error'); return;
  }
  const dates = _coRequestDates(date, end);
  if (!dates.length) {
    if (errEl) errEl.textContent = '\u26a0\ufe0f No working days in that range (weekends and public holidays are skipped).';
    showAlert('leave-error'); return;
  }
  if (dates.length > CO_MAX_DAYS) {
    if (errEl) errEl.textContent = '\u26a0\ufe0f A request can cover up to ' + CO_MAX_DAYS + ' days. Please split it.';
    showAlert('leave-error'); return;
  }
  const first = dates[0], last = dates[dates.length-1];
  const days     = isFull ? dates.length : 0.5;
  const typeLabel = isFull ? 'Full Day' : 'Half Day';
  const multi = dates.length > 1;
  const whenText = multi ? fmtDateRange(first, last) + ' (' + dates.length + ' working days)' : first;

  // Block requesting comp off on any date that already has a non-rejected
  // request OR an already-redeemed register entry for this user.
  var conflictRes = await Promise.all([
    sb.from('comp_off_requests')
      .select('id,status,request_date,end_date,dates').eq('employee', currentUser)
      .neq('status','rejected').lte('request_date', last),
    sb.from('comp_off_register')
      .select('id,date_taken').eq('employee', currentUser).in('date_taken', dates)
  ]);
  var clash = null;
  (conflictRes[0].data || []).forEach(function(q){
    var qd = (q.dates && q.dates.length) ? q.dates : [q.request_date];
    qd.forEach(function(d){ if (!clash && dates.indexOf(d) !== -1) clash = d; });
  });
  if (!clash && conflictRes[1].data && conflictRes[1].data[0]) clash = conflictRes[1].data[0].date_taken;
  if (clash) {
    if (errEl) errEl.textContent = '\u26a0\ufe0f You already have a comp off record for ' + fmtDate(clash) + '. Cancel that one or pick different dates.';
    showAlert('leave-error'); return;
  }

  // Ask before going past the balance (the preview already shows it in red).
  try {
    const [{data:ses},{data:regs}] = await Promise.all([
      sb.from('ot_sessions').select('*').eq('employee',currentUser),
      sb.from('comp_off_register').select('*').eq('employee',currentUser)
    ]);
    const bal = calcSummary(ses||[], regs||[], currentUser).balance;
    if (days > bal) {
      if (!await confirmAction({
        title: 'Not enough comp-off balance',
        body: 'You are asking for ' + fmtDays(days) + ' but your balance is ' + fmtDays(bal) + '. Send the request anyway?',
        confirmText: 'Send anyway'
      })) return;
    }
  } catch(e) { /* the balance check is advisory - never block the request on it */ }

  var emailWindow = window.open('about:blank', '_blank');

  const btn=document.getElementById('lv-save-btn');
  btn.disabled=true; btn.textContent='⏳ Submitting...';
  const {error}=await sb.from('comp_off_requests').insert({
    employee:currentUser, request_date:first, end_date:last, dates:dates, type:typeLabel,
    days, related_activity:'', remarks:reason, status:'pending'
  });
  btn.disabled=false; btn.innerHTML='<i data-lucide="send" class="btn-icon"></i>Submit Request'; if (typeof renderIcons === 'function') renderIcons();
  if (error){
    if (emailWindow) try { emailWindow.close(); } catch(e){}
    showError('Error: '+error.message); return;
  }

  var subject = 'Comp Off Request - ' + currentUser + ' - ' + typeLabel + ' on ' + whenText;
  var body =
    'Hi Venkat,\n\n' +
    'I have submitted a comp off request through the NetSec Portal:\n\n' +
    'Type: ' + typeLabel + ' (' + days + (days === 1 ? ' day' : ' days') + ')\n' +
    (multi ? 'Dates: ' : 'Date: ') + whenText + '\n' +
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

// == LEAVE REQUESTS LIST (v200) ===================================
// One compact line per request instead of a large card. Type chips (All /
// Annual / Sick / Comp Off, with counts) and a status filter narrow it; the
// manager's employee filter re-fetches. Requests are fetched once per
// employee choice and filtered in the browser, so switching chips is instant.
var _lvHistRows = [];     // every request for the chosen employee, newest first
var _lvHistType = '';     // '' = all | 'annual' | 'sick' | 'compoff'
var _lvHistSeq = 0;       // a slow earlier fetch must not overwrite a newer one

var LV_TYPES = [
  { key: 'annual',  label: 'Annual' },
  { key: 'sick',    label: 'Sick' },
  { key: 'compoff', label: 'Comp Off' }
];

function _lvHistTypeOf(r) {
  if (r._kind === 'compoff') return 'compoff';
  var t = r.leave_type || 'annual';       // blank means annual
  return (t === 'sick' || t === 'compoff') ? t : 'annual';
}

function setLeaveHistType(t) {
  _lvHistType = t || '';
  renderLeaveHistoryView();
}

function clearLeaveHistFilters() {
  _lvHistType = '';
  var st = document.getElementById('lv-hist-status'); if (st) st.value = '';
  renderLeaveHistoryView();
}

async function renderLeaveHistory() {
  var mySeq = ++_lvHistSeq;
  document.getElementById('lv-hist-load').style.display='flex';
  document.getElementById('lv-hist-content').innerHTML='';
  var filter=isManager?document.getElementById('lv-hist-filter').value:currentUser;
  var both = await Promise.all([
    fetchAllRows(function(){
      var q=sb.from('leave_requests').select('*').order('created_at',{ascending:false});
      return filter ? q.eq('employee',filter) : q;
    }),
    fetchAllRows(function(){
      var q=sb.from('comp_off_requests').select('*').order('created_at',{ascending:false});
      return filter ? q.eq('employee',filter) : q;
    })
  ]);
  if (mySeq !== _lvHistSeq) return;
  document.getElementById('lv-hist-load').style.display='none';
  var lr = both[0], cr = both[1];
  if (lr.error || cr.error) {
    // An empty list here would read as "no leave requests yet".
    _lvHistRows = [];
    document.getElementById('lv-hist-chips').innerHTML = '';
    document.getElementById('lv-hist-summary').textContent = '';
    document.getElementById('lv-hist-content').innerHTML =
      '<div class="alert alert-error show">Could not load leave requests. Check your connection and try again.</div>';
    return;
  }
  var leaveRows = (lr.data||[]).map(function(r){ return Object.assign({_kind:'leave'}, r); });
  var coRows    = (cr.data||[]).map(function(r){ return Object.assign({_kind:'compoff'}, r); });
  _lvHistRows = leaveRows.concat(coRows).sort(function(a,b){
    return new Date(b.created_at||0) - new Date(a.created_at||0);
  });
  renderLeaveHistoryView();
}

// Draws the list from the cached rows and the current type / status filters.
function renderLeaveHistoryView() {
  var content = document.getElementById('lv-hist-content');
  if (!content) return;
  var status = (document.getElementById('lv-hist-status')||{}).value || '';
  var all = _lvHistRows;

  // Chip counts follow the status filter, so each chip shows what it would give.
  var byStatus = status ? all.filter(function(r){ return r.status === status; }) : all;
  var counts = { annual: 0, sick: 0, compoff: 0 };
  byStatus.forEach(function(r){ counts[_lvHistTypeOf(r)]++; });
  var chip = function(key, label, n) {
    var active = (_lvHistType === key);
    return '<button type="button" class="amc-chip'+(active?' amc-chip-active':'')+'" onclick="setLeaveHistType(\''+key+'\')">'+
      label+' <span class="amc-chip-count">'+fmtCount(n)+'</span></button>';
  };
  document.getElementById('lv-hist-chips').innerHTML =
    chip('', 'All', byStatus.length) +
    LV_TYPES.map(function(t){ return chip(t.key, t.label, counts[t.key]); }).join('');

  var rows = _lvHistType ? byStatus.filter(function(r){ return _lvHistTypeOf(r) === _lvHistType; }) : byStatus;
  var summary = document.getElementById('lv-hist-summary');

  if (!all.length) {
    summary.textContent = '';
    content.innerHTML = renderEmptyState({
      icon: 'palmtree',
      heading: 'No leave requests yet',
      sub: 'Submit annual or sick leave requests here. Manager reviews and approves.',
      btnText: 'Request time off',
      btnOnclick: "navigateSub('leave','log')"
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }
  if (!rows.length) {
    summary.textContent = '';
    content.innerHTML = renderEmptyState({
      icon: 'search-x',
      heading: 'No requests match these filters',
      sub: 'Try another type or status.',
      btnText: 'Clear filters',
      btnIcon: 'x',
      btnOnclick: 'clearLeaveHistFilters()'
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }

  summary.textContent = (rows.length === all.length)
    ? fmtCount(rows.length) + ' request' + (rows.length === 1 ? '' : 's')
    : 'Showing ' + fmtCount(rows.length) + ' of ' + fmtCount(all.length) + ' requests';

  var showEmp = !!isManager;
  var todayISO = (typeof _leaveTodayISO === 'function') ? _leaveTodayISO() : '';
  content.innerHTML =
    '<div class="lv-req-list' + (showEmp ? '' : ' lv-noemp') + '">' +
      '<div class="lv-req lv-req-head" aria-hidden="true">' +
        (showEmp ? '<div class="c-who">Employee</div>' : '') +
        '<div class="c-type">Type</div><div class="c-when">Dates</div><div class="c-note">Note</div><div class="c-status">Status</div>' +
      '</div>' +
      rows.map(function(r){ return _lvHistRowHtml(r, showEmp, todayISO); }).join('') +
    '</div>';
}

function _lvHistRowHtml(r, showEmp, todayISO) {
  var type = _lvHistTypeOf(r);
  var typeLabel = type === 'sick' ? 'Sick' : type === 'compoff' ? 'Comp Off' : 'Annual';
  var statusLabel = cap((r.status || '').replace('_', ' '));
  var date, days, half, reason, note = '', noteTone = '';

  if (r._kind === 'compoff') {
    date = coWhen(r);
    days = fmtDays(r.days);
    half = /half/i.test(r.type || '');
    reason = r.remarks || r.related_activity || '';
    if (r.manager_comment) note = 'Manager: ' + r.manager_comment;
  } else {
    date = (r.start_date === r.end_date) ? fmtDate(r.start_date) : fmtDateRange(r.start_date, r.end_date);
    days = fmtDays(r.working_days);
    half = (parseFloat(r.working_days) === 0.5);
    reason = r.reason || '';
    if (r.status === 'needs_review') { note = 'Discussion pending: ' + (r.manager_comment || 'no comment'); noteTone = 'warn'; }
    else if (r.status === 'rejected' && r.manager_comment) { note = 'Rejected: ' + r.manager_comment; noteTone = 'bad'; }
    else if (r.status === 'cancelled') {
      var who = r.cancelled_by ? (r.cancelled_by === r.employee ? 'the employee' : r.cancelled_by) : '';
      note = 'Cancelled' + (r.cancelled_at ? ' ' + relativeTime(r.cancelled_at) : '') + (who ? ' by ' + who : '') +
        (r.effective_end_date ? ' \u00b7 counted through ' + fmtDate(r.effective_end_date) : '') +
        (r.manager_comment ? ' \u00b7 ' + r.manager_comment : '');
      noteTone = 'muted';
    }
    else if (r.manager_comment) note = 'Manager: ' + r.manager_comment;
  }

  // Cancel mirrors cancelLeaveRequest(): pending / needs_review any time,
  // approved while the leave has not fully passed. Comp-off has no cancel.
  var canCancel = false;
  if (r._kind === 'leave') {
    if (r.status === 'pending' || r.status === 'needs_review') canCancel = true;
    else if (r.status === 'approved' && r.end_date && r.end_date >= todayISO) canCancel = true;
  }

  return '<div class="lv-req lv-req-' + _phEsc(r.status) + '">' +
    (showEmp ? '<div class="c-who">' + _phEsc(r.employee) + '</div>' : '') +
    '<div class="c-type"><span class="lv-type lv-type-' + type + '">' + typeLabel + '</span></div>' +
    '<div class="c-when"><span class="lv-when-date">' + _phEsc(date) + '</span>' +
      '<span class="lv-when-days">' + _phEsc(days) + (half ? ' \u00b7 half day' : '') + '</span></div>' +
    '<div class="c-note">' +
      (reason ? '<div class="lv-reason" title="' + _phEsc(reason) + '">' + _phEsc(reason) + '</div>' : '') +
      (note ? '<div class="lv-msg' + (noteTone ? ' lv-msg-' + noteTone : '') + '">' + _phEsc(note) + '</div>' : '') +
    '</div>' +
    '<div class="c-status"><span class="badge badge-' + _phEsc(r.status) + '">' + _phEsc(statusLabel) + '</span>' +
      (canCancel ? '<button class="btn btn-sm btn-ghost" onclick="cancelLeaveRequest(' + Number(r.id) + ')" title="Cancel this leave">Cancel</button>' : '') +
    '</div>' +
  '</div>';
}

// v195: which year the overview shows. null = the current year.
var _lvTeamYear = null;
var _lvTeamSeq = 0;   // a quick second year change must win over the first
function setLeaveTeamYear(y) {
  var n = Number(y);
  _lvTeamYear = (/^\d{4}$/.test(String(y)) && n >= 2000 && n <= 2100) ? String(y) : null;
  renderLeaveTeam();
}

async function renderLeaveTeam() {
  document.getElementById('lv-team-load').style.display='flex';
  document.getElementById('lv-team-content').innerHTML='';
  const thisYear=_leaveTodayISO().slice(0,4);
  const year=_lvTeamYear || thisYear;
  const mySeq=++_lvTeamSeq;
  // Switched from annual_leave (at-approval-time) to leave_requests so the
  // day-by-day rule applies.
  // v164: comp-off joins annual + sick in this table, so pull the two CO
  // sources alongside the leave requests. ot_sessions can exceed the 1000-row
  // Supabase cap, so it goes through fetchAllRows; leave_requests (one year)
  // and comp_off_register are far below it.
  // v195: every year's requests come back, not just the selected one - the
  // list of years in the filter is built from what actually exists, and the
  // per-year split is done here so a leave crossing New Year is counted in
  // both. The table is small (a few dozen rows a year); fetchAllRows keeps it
  // correct if that ever stops being true.
  const [lvRes, otRes, coRes] = await Promise.all([
    fetchAllRows(function(){ return sb.from('leave_requests')
      .select('employee,start_date,end_date,working_days,leave_type,status,effective_end_date,cancelled_at,reviewed_at'); }),
    fetchAllRows(function(){ return sb.from('ot_sessions').select('employee,status,band,rate,credited_hours'); }),
    sb.from('comp_off_register').select('employee,days')
  ]);
  if (mySeq!==_lvTeamSeq) return;
  document.getElementById('lv-team-load').style.display='none';
  if (lvRes.error) {
    // An empty table here would read as "nobody has taken any leave".
    document.getElementById('lv-team-content').innerHTML =
      '<div class="alert alert-error show">Could not load leave records. Check your connection and try again.</div>';
    return;
  }
  const allRecords=lvRes.data||[];
  const yStart=year+'-01-01', yEnd=year+'-12-31';
  const records=allRecords.filter(function(r){ return r.start_date && r.end_date && r.start_date<=yEnd && r.end_date>=yStart; });
  // Years on offer: from the earliest leave on record to next year (leave is
  // booked ahead), or further if something is already booked beyond that.
  var minY=Number(thisYear), maxY=Number(thisYear)+1;
  allRecords.forEach(function(r){
    var a=Number(String(r.start_date||'').slice(0,4)), b=Number(String(r.end_date||'').slice(0,4));
    if (a && a<minY) minY=a;
    if (b && b>maxY) maxY=b;
  });
  if (Number(year)<minY) minY=Number(year);
  if (Number(year)>maxY) maxY=Number(year);
  var yearOpts='';
  for (var yy=maxY; yy>=minY; yy--) {
    yearOpts+='<option value="'+yy+'"'+(String(yy)===year?' selected':'')+'>'+yy+(String(yy)===thisYear?' (current)':'')+'</option>';
  }
  const otRows=(otRes&&otRes.data)||[];
  const coRows=(coRes&&coRes.data)||[];
  const todayISO = _leaveTodayISO();

  // Employees only see their own row; manager sees all
  const visibleEmps = isManager ? EMPLOYEES : [currentUser];

  const rows=visibleEmps.map(function(emp){
    const empRecs = records.filter(function(r){return r.employee===emp;});
    function sumUsed(typeKey) {
      return empRecs
        .filter(function(r){ return (r.leave_type||'annual')===typeKey; })
        .reduce(function(s,r){ return s + computeLeaveDaysInYear(r, year, todayISO); }, 0);
    }
    function sumUpcoming(typeKey) {
      return empRecs
        .filter(function(r){ return (r.leave_type||'annual')===typeKey; })
        .reduce(function(s,r){ return s + computeUpcomingDaysInYear(r, year, todayISO); }, 0);
    }
    const annualUsed    = sumUsed('annual');
    const annualUpcoming= sumUpcoming('annual');
    const sickUsed      = sumUsed('sick');
    const sickUpcoming  = sumUpcoming('sick');
    const annualRem  = LEAVE_ALLOWANCE - annualUsed;
    const sickRem    = SICK_ALLOWANCE  - sickUsed;
    const aColor = annualRem<=0?'var(--danger)':annualRem<=5?'var(--gold)':'var(--success)';
    const sColor = sickRem<=0?'var(--danger)':sickRem<=3?'var(--gold)':'var(--success)';
    // v164: comp-off. Unlike annual/sick there's no fixed allowance — the
    // balance is earned OT credit minus days taken, so calcSummary() is the
    // single source of truth (same call the manager OT summary card uses).
    const co       = calcSummary(otRows, coRows, emp);
    const coColor  = co.balance>0?'var(--success)':co.balance<0?'var(--danger)':'var(--muted)';
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
      '<td style="font-variant-numeric:tabular-nums">'+approvedCell+'</td>'+
      '<td style="font-variant-numeric:tabular-nums;font-weight:700;color:var(--teal)">'+fmtNumber(annualUsed,1)+' / '+LEAVE_ALLOWANCE+aUpcomingHint+'</td>'+
      '<td style="font-variant-numeric:tabular-nums;font-weight:700;color:'+aColor+'">'+fmtNumber(annualRem,1)+'</td>'+
      '<td><div style="height:8px;background:var(--nx-canvas);border-radius:4px;overflow:hidden"><div style="height:100%;width:'+aPct+'%;background:'+aColor+';border-radius:4px"></div></div><div style="font-size:11px;color:var(--muted);margin-top:3px">'+fmtPct(aPct)+' used</div></td>'+
      '<td>'+aBadge+'</td>'+
      '<td style="font-variant-numeric:tabular-nums;font-weight:700;color:var(--teal)">'+fmtNumber(sickUsed,1)+' / '+SICK_ALLOWANCE+sUpcomingHint+'</td>'+
      '<td style="font-variant-numeric:tabular-nums;font-weight:700;color:'+sColor+'">'+fmtNumber(sickRem,1)+'</td>'+
      '<td>'+sBadge+'</td>'+
      '<td class="hide-mobile" style="font-variant-numeric:tabular-nums;font-weight:700;color:var(--teal)">'+fmtNumber(co.totalCO,2)+'</td>'+
      '<td class="hide-mobile" style="font-variant-numeric:tabular-nums;font-weight:700;color:var(--teal)">'+fmtNumber(co.used,2)+'</td>'+
      '<td style="font-variant-numeric:tabular-nums;font-weight:700;color:'+coColor+'">'+fmtNumber(co.balance,2)+'</td>'+
      '</tr>';
  }).join('');

  document.getElementById('lv-team-content').innerHTML=
    '<div class="card">'+
    '<div class="flex-between" style="gap:12px;flex-wrap:wrap;margin-bottom:14px">'+
      '<div class="card-title" style="margin-bottom:0">'+(isManager?'Team':'My')+' Leave Overview '+year+'</div>'+
      '<label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--muted)">Year'+
        '<select id="lv-team-year" onchange="setLeaveTeamYear(this.value)" style="width:auto;padding:7px 10px;font-size:13px">'+yearOpts+'</select>'+
      '</label>'+
    '</div>'+
    // v181: lv-overview-table tints the Annual / Sick / Comp-off column groups
    // (by position, see css/styles.css) so the three allowances read apart.
    '<div class="table-wrap"><table class="lv-overview-table"><thead><tr>'+
    '<th>Employee</th>'+
    '<th>Upcoming Leave (dates)</th>'+
    '<th>Annual Used</th><th>Annual Rem.</th><th>Usage</th><th>Status</th>'+
    '<th>Sick Used</th><th>Sick Rem.</th><th>Status</th>'+
    '<th class="hide-mobile">CO Earned</th><th class="hide-mobile">CO Used</th><th>CO Balance</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div style="margin-top:10px;font-size:12px;color:var(--muted)">Annual: '+fmtDays(LEAVE_ALLOWANCE)+'/yr &nbsp;|&nbsp; Sick: '+fmtDays(SICK_ALLOWANCE)+'/yr &nbsp;|&nbsp; Comp off: earned from approved OT (8 credited hours = 1 day), no yearly cap</div>'+
    '<div style="margin-top:4px;font-size:12px;color:var(--muted)">Annual and sick leave start again on 1 January and unused days do not carry over. Comp Off is a running balance, so those three columns are the same whichever year is selected.</div>'+
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
      '<td style="font-variant-numeric:tabular-nums">'+s.sessions+'</td>'+
      '<td class="hide-mobile" style="font-variant-numeric:tabular-nums">'+r2(s.eveCred)+'</td>'+
      '<td class="hide-mobile" style="font-variant-numeric:tabular-nums">'+r2(s.earlyCred)+'</td>'+
      '<td class="hide-mobile" style="font-variant-numeric:tabular-nums;color:var(--nx-ink-faint)" title="Mid 1:1 (<4h) — tracked but does not earn CO">'+r2(s.mid11)+'</td>'+
      '<td class="hide-mobile" style="font-variant-numeric:tabular-nums">'+r2(s.mid12)+'</td>'+
      '<td class="hide-mobile" style="font-variant-numeric:tabular-nums" title="Weekend 1:1 — earns CO at 8h = 1 day">'+r2(s.wk11)+'</td>'+
      '<td class="hide-mobile" style="font-variant-numeric:tabular-nums">'+r2(s.wk12)+'</td>'+
      '<td><strong style="font-variant-numeric:tabular-nums;color:var(--navy)">'+fmtNumber(s.totalCO,2)+'</strong></td>'+
      '<td style="font-variant-numeric:tabular-nums">'+fmtNumber(s.used,2)+'</td>'+
      '<td><strong style="font-variant-numeric:tabular-nums;color:'+bc+'">'+fmtNumber(s.balance,2)+'</strong></td></tr>';
  }).join('');
  document.getElementById('team-ot-content').innerHTML=
    '<div class="table-wrap"><table><thead><tr>'+
      '<th>Employee</th>'+
      '<th>Sessions</th>'+
      '<th class="hide-mobile">Eve Cred</th>'+
      '<th class="hide-mobile">Early Cred</th>'+
      '<th class="hide-mobile" style="color:var(--nx-ink-faint)">Mid 1:1</th>'+
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
    html += '<div style="padding:14px;background:var(--nx-canvas);border-radius:8px;color:var(--muted);font-size:13px;margin-bottom:14px">No requests match the filters.</div>';
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
    '<div style="background:var(--nx-canvas);color:var(--nx-ink-2);border-left:3px solid var(--nx-ink-faint);padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:10px;line-height:1.5">'+
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
        '<td><span class="badge" style="background:var(--nx-canvas);color:var(--navy)">'+esc2(r.leave_type||'')+'</span></td>'+
        '<td style="font-variant-numeric:tabular-nums">'+fmtDate(r.start_date)+'</td>'+
        '<td style="font-variant-numeric:tabular-nums">'+fmtDate(r.end_date)+'</td>'+
        '<td style="font-variant-numeric:tabular-nums;font-weight:700">'+r.working_days+'</td>'+
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
  if (type==='compoff') info='<strong>'+r.employee+'</strong> — '+r.type+(r.dates&&r.dates.length>1?' ('+fmtDays(r.days)+')':'')+' on '+coWhen(r)+(r.related_activity?' ('+r.related_activity+')':'');
  else {
    var isHalf = (parseFloat(r.working_days) === 0.5);
    var halfBadge = isHalf ? ' <span class="badge" style="background:var(--pill-purple-bg);color:var(--pill-purple-fg);font-size:10px">Half day</span>' : '';
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
    overlapHtml = '<div style="background:var(--pill-warn-bg);color:var(--nx-orange-deep);border-left:3px solid var(--nx-orange);padding:8px 10px;border-radius:6px;font-size:12px;margin-top:8px;line-height:1.4">'+
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
      // v202: register rows carry request_id (one per day of the request). Older
      // approvals have no link - match those on employee + date.
      await sb.from('comp_off_register').delete().eq('request_id', id);
      var coDates = (existing.dates && existing.dates.length) ? existing.dates : [existing.request_date];
      await sb.from('comp_off_register').delete()
        .eq('employee', existing.employee).is('request_id', null).in('date_taken', coDates);
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

var _coApproving = false;
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

  // v202: approving a comp-off goes through ONE database function that writes
  // the request status and one register row per day together (all or nothing),
  // and answers 'already approved' to a double-click instead of adding rows twice.
  // Leave approval no longer writes to annual_leave - the day-by-day rule reads
  // leave_requests directly.
  if (decision==='approved' && type==='compoff') {
    if (_coApproving) return;
    _coApproving = true;
    try {
      const rpcRes = await sb.rpc('approve_comp_off_request', { p_id: id, p_comment: comment || null });
      if (rpcRes.error){showError('Error: '+rpcRes.error.message);return;}
    } finally { _coApproving = false; }
  } else {
    const {error}=await sb.from(table).update(payload).eq('id',id);
    if (error){showError('Error: '+error.message);return;}
  }

  if (decision === 'approved') await _approveSuccessGlow();
  closeApproveModal();
  updateNotifBadge();
  var toastMsg = decision === 'approved' ? 'Request approved ✓'
              : decision === 'rejected'  ? 'Request rejected ✓'
              : decision === 'needs_review' ? 'Marked for re-review ✓'
              : 'Updated ✓';
  showToast(toastMsg);
  // v172: the OT engine credits sessions logged on days off, so the
  // leave-day map has to follow every approval decision immediately.
  if (typeof loadLeaveDays === 'function') loadLeaveDays();
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
  // v172: cancelling withdraws the leave-day OT treatment for the days
  // that never happened.
  if (typeof loadLeaveDays === 'function') loadLeaveDays();
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


// == PUBLIC HOLIDAYS - MANAGER ADMIN (v193) =======================
// Settings -> Admin Tools -> Public Holidays. Adding or removing a holiday
// re-counts the stored working_days of every live leave request that covers
// the date, so the cards and the balance never disagree.

function _phEsc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Re-count stored working_days for live leave requests covering `iso`.
// Call AFTER PUBLIC_HOLIDAYS has been reloaded. Half-day rows keep their 0.5
// label (computeLeaveUsedDays already charges them 0 on a holiday), and
// cancelled / rejected rows are history, not a live count.
// Returns { changed, failed }.
async function _recountLeaveForHoliday(iso, region) {
  var res = await sb.from('leave_requests')
    .select('id,employee,start_date,end_date,working_days,status')
    .in('status', ['pending', 'needs_review', 'approved'])
    .lte('start_date', iso).gte('end_date', iso);
  if (res.error) return { changed: 0, failed: 1 };
  var changed = 0, failed = 0;
  for (var i = 0; i < (res.data || []).length; i++) {
    var r = res.data[i];
    if (region !== 'ALL' && employeeRegion(r.employee) !== region) continue;
    if (parseFloat(r.working_days) === 0.5 && r.start_date === r.end_date) continue;
    var days = calcWorkingDays(r.start_date, r.end_date, r.employee);
    if (days === parseFloat(r.working_days)) continue;
    var up = await sb.from('leave_requests').update({ working_days: days }).eq('id', r.id).select('id');
    if (up.error || !up.data || !up.data.length) failed++; else changed++;
  }
  return { changed: changed, failed: failed };
}

// == PUBLIC HOLIDAYS PICKER (v205) ==========================================
// Leave -> Public Holidays (managers). UAE and KSA each get their own list of
// holidays to tick; a ticked day is not a working day for that country only
// (calcWorkingDays / isOnLeave read PUBLIC_HOLIDAYS through getPublicHoliday).
// Dates of the moon-based holidays are expected dates (Umm al-Qura calendar) -
// editable until ticked, because the real day is announced shortly before.
var _phYear = null;
var _phBusy = false;
var _phRows = { UAE: [], KSA: [] };

// h: [hijri month, hijri day]; f: [month, day] on the Gregorian calendar.
var PH_CATALOG = {
  UAE: [
    { n: "New Year's Day", f: [1, 1] },
    { n: 'Eid Al Fitr - Day 1', h: [10, 1] }, { n: 'Eid Al Fitr - Day 2', h: [10, 2] }, { n: 'Eid Al Fitr - Day 3', h: [10, 3] },
    { n: 'Arafat Day', h: [12, 9] },
    { n: 'Eid Al Adha - Day 1', h: [12, 10] }, { n: 'Eid Al Adha - Day 2', h: [12, 11] }, { n: 'Eid Al Adha - Day 3', h: [12, 12] },
    { n: 'Islamic New Year', h: [1, 1] },
    { n: "Prophet's Birthday", h: [3, 12] },
    { n: 'National Day', f: [12, 2] }, { n: 'National Day - Day 2', f: [12, 3] }
  ],
  KSA: [
    { n: 'Founding Day', f: [2, 22] },
    { n: 'Eid Al Fitr - Day 1', h: [10, 1] }, { n: 'Eid Al Fitr - Day 2', h: [10, 2] }, { n: 'Eid Al Fitr - Day 3', h: [10, 3] }, { n: 'Eid Al Fitr - Day 4', h: [10, 4] },
    { n: 'Arafat Day', h: [12, 9] },
    { n: 'Eid Al Adha - Day 1', h: [12, 10] }, { n: 'Eid Al Adha - Day 2', h: [12, 11] }, { n: 'Eid Al Adha - Day 3', h: [12, 12] }, { n: 'Eid Al Adha - Day 4', h: [12, 13] },
    { n: 'National Day', f: [9, 23] }
  ]
};

function _phIso(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }

// Gregorian ISO dates in `year` for each Hijri month-day, by scanning the year.
function _phHijriMap(year) {
  var map = {};
  try {
    var fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { timeZone: 'UTC', month: 'numeric', day: 'numeric' });
    for (var t = Date.UTC(year, 0, 1); t <= Date.UTC(year, 11, 31); t += 86400000) {
      var parts = fmt.formatToParts(new Date(t)), m = 0, d = 0;
      parts.forEach(function(p){ if (p.type === 'month') m = parseInt(p.value, 10); if (p.type === 'day') d = parseInt(p.value, 10); });
      var iso = new Date(t).toISOString().slice(0, 10);
      (map[m + '-' + d] = map[m + '-' + d] || []).push(iso);
    }
  } catch (e) { return null; }
  return map;
}

function _phCatalogRows(region, year, hmap) {
  var out = [];
  PH_CATALOG[region].forEach(function(c){
    if (c.f) { out.push({ name: c.n, iso: _phIso(year, c.f[0], c.f[1]), moon: false }); return; }
    var dates = hmap && hmap[c.h[0] + '-' + c.h[1]];
    (dates || []).forEach(function(iso){ out.push({ name: c.n, iso: iso, moon: true }); });
  });
  out.sort(function(x, y){ return x.iso < y.iso ? -1 : x.iso > y.iso ? 1 : 0; });
  return out;
}

function _phFor(region, iso) {
  return PUBLIC_HOLIDAYS.find(function(h){ return h.holiday_date === iso && (h.region === region || h.region === 'ALL'); }) || null;
}

async function renderPublicHolidays() {
  var host = document.getElementById('ph-tab-content');
  if (!host) return;
  if (!isManager) { host.innerHTML = '<div class="card"><div class="empty-state">Public holidays are managed by managers.</div></div>'; return; }
  var openYear = _phYear || new Date().getFullYear();
  // Read what the manager typed before the spinner replaces the page.
  host.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';
  var ok = await loadPublicHolidays();
  if (!ok) { host.innerHTML = '<div class="alert alert-error show">Could not load public holidays. Check your connection and try again.</div>'; return; }
  _phYear = openYear;
  var hmap = _phHijriMap(openYear);
  var thisYear = new Date().getFullYear();
  var yearOpts = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map(function(y){ return '<option value="' + y + '"' + (y === openYear ? ' selected' : '') + '>' + y + '</option>'; }).join('');

  var cards = ['UAE', 'KSA'].map(function(region){
    var rows = _phCatalogRows(region, openYear, hmap);
    _phRows[region] = rows;
    var matchedIds = {};
    var list = rows.map(function(r, i){
      var h = _phFor(region, r.iso);
      if (h) matchedIds[h.id] = 1;
      var id = 'ph-' + region + '-' + i;
      return '<div class="ph-row' + (h ? ' ph-on' : '') + '">' +
        '<label class="ph-check"><input type="checkbox" id="' + id + '"' + (h ? ' checked' : '') + ' onchange="phToggle(\'' + region + '\',' + i + ',this)"> <span class="ph-name">' + _phEsc(r.name) + '</span></label>' +
        (h ? '<span class="ph-date">' + fmtDate(r.iso) + (h.region === 'ALL' ? ' <span class="ph-both">UAE + KSA</span>' : '') + '</span>'
           : '<input type="date" class="ph-date-in" id="' + id + '-d" value="' + r.iso + '" aria-label="Date of ' + _phEsc(r.name) + '">' + (r.moon ? '<span class="ph-moon" title="Expected date - confirm when the moon sighting is announced">expected</span>' : '')) +
      '</div>';
    }).join('');
    // Anything else recorded for this country and year (typed by hand, or moved from the list).
    var others = PUBLIC_HOLIDAYS.filter(function(h){
      return (h.region === region || h.region === 'ALL') && h.holiday_date.slice(0, 4) === String(openYear) && !matchedIds[h.id];
    });
    var otherHtml = others.length
      ? '<div class="ph-sub">Added by hand</div>' + others.map(function(h){
          return '<div class="ph-row ph-on"><span class="ph-name">' + _phEsc(h.name) + '</span><span class="ph-date">' + fmtDate(h.holiday_date) + (h.region === 'ALL' ? ' <span class="ph-both">UAE + KSA</span>' : '') + '</span>' +
            '<button type="button" class="btn btn-sm btn-ghost btn-icon-only" onclick="deletePublicHoliday(' + Number(h.id) + ')" title="Remove" aria-label="Remove ' + _phEsc(h.name) + '"><i data-lucide="trash-2"></i></button></div>';
        }).join('')
      : '';
    var count = PUBLIC_HOLIDAYS.filter(function(h){ return (h.region === region || h.region === 'ALL') && h.holiday_date.slice(0, 4) === String(openYear); }).length;
    return '<div class="card ph-card">' +
      '<div class="ph-head"><div class="card-title" style="margin:0">' + region + ' team</div><span class="ph-count">' + count + ' selected</span></div>' +
      (list || '<div class="ph-none">Could not work out the Islamic holiday dates in this browser - add them below.</div>') +
      otherHtml +
      '<div class="ph-sub">Add your own</div>' +
      '<div class="ph-own"><input type="date" id="ph-own-d-' + region + '" aria-label="Date"><input type="text" id="ph-own-n-' + region + '" maxlength="80" placeholder="Holiday name" aria-label="Holiday name">' +
        '<button type="button" class="btn btn-sm btn-primary" onclick="phAddOwn(\'' + region + '\')">Add</button></div>' +
      '<div id="ph-err-' + region + '" class="alert alert-error" style="display:none;margin-top:8px"></div>' +
    '</div>';
  }).join('');

  host.innerHTML =
    '<div class="card ph-bar">' +
      '<label class="ph-year">Year <select id="ph-year" onchange="phSetYear(this.value)">' + yearOpts + '</select></label>' +
      '<label class="ph-ot"><input type="checkbox" id="ph-ot" checked> Work on a ticked day counts as overtime</label>' +
      '<div class="ph-help">Tick the days your team is off. A ticked day is not charged as leave and does not count as a working day — for that country only. ' +
        'Islamic holiday dates are expected dates: change the date before ticking if the announced day is different. ' +
        'Ticking or unticking re-counts any leave request that covers the date.</div>' +
    '</div>' +
    '<div class="ph-grid">' + cards + '</div>';
  if (typeof renderIcons === 'function') renderIcons();
}

function phSetYear(y) {
  var n = Number(y);
  _phYear = (n >= 2000 && n <= 2100) ? n : null;
  renderPublicHolidays();
}

function _phAfterChange() {
  // Everything that reads holidays: the OT map, and whichever leave view is open.
  if (typeof loadLeaveDays === 'function') loadLeaveDays();
  renderPublicHolidays();
}

function _phToday() {
  var c = (typeof officeClock === 'function') ? officeClock(currentUser) : null;
  if (c && c.iso) return c.iso;
  var now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

// Insert one holiday for one country. Returns '' on success, or the problem.
async function _phInsert(region, iso, name, ot) {
  var clash = _phFor(region, iso);
  if (clash) return fmtDate(iso) + ' is already recorded as ' + clash.name + '.';
  // A past date with OT on reaches back: sessions already logged that day
  // would gain weekend credit the next time Policy Recompute is run.
  if (ot && iso < _phToday() && !await confirmAction({
    title: fmtDate(iso) + ' is in the past',
    body: '"Work counts as overtime" is on, so sessions already logged on that day will be credited as overtime the next time Policy Recompute is run.\n\nContinue with it on?',
    confirmText: 'Keep it on'
  })) return 'cancelled';
  var ins = await sb.from('public_holidays').insert({ holiday_date: iso, name: name, region: region, counts_for_ot: !!ot, created_by: currentUser });
  if (ins.error) return ins.error.code === '23505' ? 'That date is already recorded for this country.' : 'Error: ' + ins.error.message;
  return '';
}

async function _phReport(isos, region, verb) {
  await loadPublicHolidays();
  var changed = 0, failed = 0;
  for (var i = 0; i < isos.length; i++) {
    var rc = await _recountLeaveForHoliday(isos[i], region);
    changed += rc.changed; failed += rc.failed;
  }
  if (failed) showError('Holiday ' + verb + ', but ' + failed + ' leave request(s) could not be re-counted. Open them and save again.');
  else showToast('Holiday ' + verb + (changed ? ' - ' + changed + ' leave request' + (changed === 1 ? '' : 's') + ' re-counted' : '') + ' ✓');
}

async function phToggle(region, idx, box) {
  if (!isManager) { showError('Manager access only.'); box.checked = !box.checked; return; }
  if (_phBusy) { box.checked = !box.checked; return; }
  _phBusy = true;
  var wantOn = box.checked;
  try {
    if (!await requireAuth()) { box.checked = !wantOn; return; }
    var row = _phRows[region][idx];
    if (!row) return;
    var otherRegion = region === 'UAE' ? 'KSA' : 'UAE';
    if (wantOn) {
      var dEl = document.getElementById('ph-' + region + '-' + idx + '-d');
      var iso = (dEl && dEl.value) || row.iso;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) { showError('Pick a valid date.'); box.checked = false; return; }
      var otOn = !!(document.getElementById('ph-ot') || {}).checked;
      var err = await _phInsert(region, iso, row.name, otOn);
      if (err) { box.checked = false; if (err !== 'cancelled') showError(err); return; }
      await _phReport([iso], region, 'added');
    } else {
      var h = _phFor(region, row.iso);
      if (!h) return;
      if (!await confirmAction({
        title: 'Untick ' + h.name + ' (' + fmtDate(h.holiday_date) + ') for ' + region + '?',
        body: 'Leave that covers this date will be charged for it again for ' + region + ' staff.' + (h.region === 'ALL' ? '\n\nIt stays a holiday for ' + otherRegion + '.' : ''),
        confirmText: 'Untick'
      })) { box.checked = true; return; }
      var del = await sb.from('public_holidays').delete().eq('id', h.id).select('id');
      if (del.error || !del.data || !del.data.length) { box.checked = true; showError('Could not remove the holiday' + (del.error ? ': ' + del.error.message : '.')); return; }
      if (h.region === 'ALL') {
        // The old "UAE + KSA" row covered both: keep the other country.
        var keep = await sb.from('public_holidays').insert({ holiday_date: h.holiday_date, name: h.name, region: otherRegion, counts_for_ot: !!h.counts_for_ot, created_by: currentUser });
        if (keep.error) showError('Removed for ' + region + ', but could not keep it for ' + otherRegion + ': ' + keep.error.message);
      }
      await _phReport([h.holiday_date], region, 'removed');
    }
  } finally {
    _phBusy = false;
    _phAfterChange();
  }
}

async function phAddOwn(region) {
  if (!isManager) { showError('Manager access only.'); return; }
  if (_phBusy) return;
  var dEl = document.getElementById('ph-own-d-' + region), nEl = document.getElementById('ph-own-n-' + region);
  var errEl = document.getElementById('ph-err-' + region);
  var iso = dEl.value, name = (nEl.value || '').trim();
  errEl.style.display = 'none';
  function fail(msg) { errEl.textContent = msg; errEl.style.display = 'block'; }
  if (!iso) return fail('Pick the holiday date.');
  if (!name) return fail('Give the holiday a name.');
  if (name.length > 80) return fail('Keep the name under 80 characters.');
  _phBusy = true;
  var changed = false;
  try {
    if (!await requireAuth()) return;
    var otOn = !!(document.getElementById('ph-ot') || {}).checked;
    var err = await _phInsert(region, iso, name, otOn);
    if (err) { if (err !== 'cancelled') fail(err); return; }   // keep the page as is so the message stays visible
    changed = true;
    await _phReport([iso], region, 'added');
  } finally {
    _phBusy = false;
    if (changed) _phAfterChange();
  }
}

async function deletePublicHoliday(id) {
  if (!isManager) { showError('Manager access only.'); return; }
  if (_phBusy) return;
  var h = PUBLIC_HOLIDAYS.find(function(x){ return x.id === id; });
  if (!h) return;
  if (!await confirmAction({
    title: 'Remove ' + h.name + ' (' + fmtDate(h.holiday_date) + ')?',
    body: 'Leave that covers this date will be charged for it again.',
    confirmText: 'Remove', danger: true
  })) return;
  _phBusy = true;
  try {
    if (!await requireAuth()) return;
    var del = await sb.from('public_holidays').delete().eq('id', id).select('id');
    if (del.error) { showError('Could not remove the holiday: ' + del.error.message); return; }
    if (!del.data || !del.data.length) { showError('The holiday was not removed - it may already be gone.'); return; }
    await _phReport([h.holiday_date], h.region, 'removed');
  } finally {
    _phBusy = false;
    _phAfterChange();
  }
}
