// == OT CALCULATION ENGINE ========================================
function isWeekend(wd, employee) {
  return KSA_EMP.includes(employee) ? (wd===5||wd===6) : (wd===0||wd===6);
}

// Per-region OT thresholds. KSA office hours run later, so block window
// and Eve band start are pushed 30-60 min later for KSA employees.
function getOTThresholds(employee) {
  if (KSA_EMP.includes(employee)) {
    return { morningBlock: 8.0, eveningBlock: 19.0, eveStart: 19.0,
             morningLabel: '8:00 AM', eveningLabel: '7:00 PM' };
  }
  return   { morningBlock: 7.5, eveningBlock: 18.5, eveStart: 18.5,
             morningLabel: '7:30 AM', eveningLabel: '6:30 PM' };
}

// Returns null if valid, or an error message string.
// Allows partial-credit sessions (e.g. 18:00-19:00 weekday gives 0.5h credit
// for the 18:30-19:00 portion). Rejects only sessions that fall entirely
// inside the regular-hours window (no OT credit at all).
function validateOTStart(dateStr, startStr, employee, endStr) {
  if (!dateStr || !startStr) return null;
  var d = new Date(dateStr); var wd = d.getDay();
  if (isWeekend(wd, employee)) return null;
  var t = getOTThresholds(employee);

  // If we have the end time, check whether ANY portion is OT.
  if (endStr) {
    var res = calcOT(dateStr, startStr, endStr, employee);
    if (res && res.credited > 0) return null; // partial or full credit -> allow
    return 'This session falls entirely within regular working hours ('+t.morningLabel+'-'+t.eveningLabel+' on weekdays). No OT credit applies. Adjust the times so part of the session is before '+t.morningLabel+' or after '+t.eveningLabel+'.';
  }

  // No end given - fall back to start-only check (still allow if start is outside block)
  var sp = startStr.split(':').map(Number);
  var startHour = sp[0] + sp[1]/60;
  if (startHour >= t.morningBlock && startHour < t.eveningBlock) {
    return 'OT start is inside regular working hours ('+t.morningLabel+'-'+t.eveningLabel+'). Make sure the end time extends past '+t.eveningLabel+' so some OT credit applies.';
  }
  return null;
}

function calcOT(dateStr, startStr, endStr, employee) {
  employee = employee || '';
  if (!dateStr||!startStr||!endStr) return null;
  const d = new Date(dateStr); const wd = d.getDay();
  const isWknd = isWeekend(wd, employee);
  const sp=startStr.split(':').map(Number); const sh=sp[0],sm=sp[1];
  const ep=endStr.split(':').map(Number);   const eh=ep[0],em=ep[1];
  const sf=sh+sm/60, ef=eh+em/60;
  const rawDur = ef<sf ? ef+24-sf : ef-sf;
  const t = getOTThresholds(employee);
  const eveStart = t.eveStart;
  const morningBlock = t.morningBlock;
  let band,rate,cred;

  if (isWknd) {
    // Weekend - all hours count, no block window applies
    band='Wknd'; rate='1:1';
    cred=rawDur;
  } else {
    const crossesMidnight = ef<=sf;

    if (crossesMidnight) {
      if (sf >= eveStart) {
        // Eve/Split - starts in eve window, crosses midnight
        band='Eve'; rate='Split';
        cred = Math.min((24-sf) + (ef*2), 8);
      } else {
        // Mid - crosses midnight, started before eve window
        // OT credit = (post-eve portion of today) + (pre-morning-block portion of tomorrow)
        band='Mid'; rate=rawDur>=4?'1:2':'1:1';
        cred = (24 - Math.max(sf, eveStart)) + Math.min(ef, morningBlock);
      }
    } else {
      // Same-day session - sum morning OT + evening OT
      var morningOT = (sf < morningBlock) ? Math.max(0, Math.min(ef, morningBlock) - sf) : 0;
      var eveningOT = (ef > eveStart)     ? Math.max(0, ef - Math.max(sf, eveStart))     : 0;
      cred = morningOT + eveningOT;

      if (cred <= 0) {
        // Entirely within regular working hours - no OT credit
        band='Day'; rate='1:1';
        cred=0;
      } else if (eveningOT > 0 && morningOT === 0) {
        // Pure evening session
        band='Eve'; rate='1:1';
      } else if (morningOT > 0 && eveningOT === 0) {
        // Pure early morning session
        band='Early'; rate='1:1';
      } else {
        // Long shift spanning both - label as Eve (pools with Early/Eve toward CO)
        band='Eve'; rate='1:1';
      }
    }
  }

  return { band, rate, duration:r2(rawDur), credited:r2(cred>0?cred:0),
    dayName:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()] };
}

// Decimal hour 7.5 -> "07:30"
function _fmtHr(h) {
  var hh = Math.floor(h);
  var mm = Math.round((h - hh) * 60);
  return String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0');
}

// Plain-text explanation of how a session's credit was computed.
// Used in the (i) tooltip on each Sessions row so employees can audit
// their own credit at a glance.
function explainOT(session) {
  if (!session || !session.ot_date || !session.start_time || !session.end_time) return '';
  var emp = session.employee || '';
  var t = getOTThresholds(emp);
  var region = KSA_EMP.includes(emp) ? 'KSA' : 'UAE';
  var d = new Date(session.ot_date);
  var wd = d.getDay();
  var isWknd = isWeekend(wd, emp);
  var sp = session.start_time.split(':').map(Number);
  var ep = session.end_time.split(':').map(Number);
  var sf = sp[0] + sp[1]/60;
  var ef = ep[0] + ep[1]/60;
  var crossesMidnight = ef <= sf;
  var rawDur = crossesMidnight ? ef + 24 - sf : ef - sf;

  var lines = [];
  lines.push('--- How this was calculated ---');
  lines.push('Region: ' + region + (region==='KSA' ? ' (block 8:00 AM - 7:00 PM, Eve from 7:00 PM)' : ' (block 7:30 AM - 6:30 PM, Eve from 6:30 PM)'));
  lines.push('Day: ' + (session.day_name || '') + (isWknd ? ' (weekend - no block)' : ' (weekday)'));
  lines.push('Time: ' + session.start_time + ' to ' + session.end_time + '  (raw: ' + rawDur.toFixed(2) + 'h)');
  lines.push('');

  if (isWknd) {
    lines.push('Weekend rule: 1:1 rate, no cap. All hours count.');
    lines.push('Credited: ' + rawDur.toFixed(2) + 'h');
  } else if (crossesMidnight) {
    if (sf >= t.eveStart) {
      // Eve/Split
      var evePart = 24 - sf;
      var midPart = ef;
      var pre = evePart + midPart * 2;
      var capped = Math.min(pre, 8);
      lines.push('Crosses midnight starting in Eve window -> Eve/Split band.');
      lines.push('Eve portion ' + session.start_time + '-24:00: ' + evePart.toFixed(2) + 'h x 1:1 = ' + evePart.toFixed(2) + 'h');
      lines.push('Post-midnight 00:00-' + session.end_time + ': ' + midPart.toFixed(2) + 'h x 1:2 = ' + (midPart*2).toFixed(2) + 'h');
      lines.push('Subtotal: ' + pre.toFixed(2) + 'h' + (pre > 8 ? ' (capped at 8)' : ''));
      lines.push('Credited: ' + capped.toFixed(2) + 'h');
    } else {
      // Mid
      var preEveLost = Math.max(0, t.eveStart - sf);
      var evePart2 = 24 - Math.max(sf, t.eveStart);
      var postMid = Math.min(ef, t.morningBlock);
      var lostMorning = Math.max(0, ef - t.morningBlock);
      lines.push('Crosses midnight starting before Eve window -> Mid band.');
      if (preEveLost > 0) lines.push('  ' + session.start_time + '-' + _fmtHr(t.eveStart) + ' (' + preEveLost.toFixed(2) + 'h): regular hours, NOT counted');
      lines.push('  ' + _fmtHr(t.eveStart) + '-24:00 (' + evePart2.toFixed(2) + 'h): Eve OT, counted');
      lines.push('  00:00-' + _fmtHr(t.morningBlock) + ' (' + postMid.toFixed(2) + 'h): Mid OT, counted');
      if (lostMorning > 0) lines.push('  ' + _fmtHr(t.morningBlock) + '-' + session.end_time + ' (' + lostMorning.toFixed(2) + 'h): regular hours, NOT counted');
      lines.push('Rate: ' + (rawDur >= 4 ? '1:2 (qualifies for Comp Off)' : '1:1'));
      lines.push('Credited: ' + (evePart2 + postMid).toFixed(2) + 'h');
    }
  } else {
    // Same-day weekday
    var morningOT = (sf < t.morningBlock) ? Math.max(0, Math.min(ef, t.morningBlock) - sf) : 0;
    var eveningOT = (ef > t.eveStart) ? Math.max(0, ef - Math.max(sf, t.eveStart)) : 0;
    var blockHrs = Math.max(0, Math.min(ef, t.eveStart) - Math.max(sf, t.morningBlock));

    if (morningOT > 0) {
      lines.push('Morning OT ' + session.start_time + '-' + _fmtHr(t.morningBlock) + ': ' + morningOT.toFixed(2) + 'h x 1:1');
    }
    if (blockHrs > 0) {
      lines.push('Regular hours ' + _fmtHr(Math.max(sf, t.morningBlock)) + '-' + _fmtHr(Math.min(ef, t.eveStart)) + ': ' + blockHrs.toFixed(2) + 'h NOT counted (in block window)');
    }
    if (eveningOT > 0) {
      lines.push('Evening OT ' + _fmtHr(Math.max(sf, t.eveStart)) + '-' + session.end_time + ': ' + eveningOT.toFixed(2) + 'h x 1:1');
    }
    if (morningOT === 0 && eveningOT === 0) {
      lines.push('Entire session in regular working hours -> 0 OT credit (will be archived).');
    }
    lines.push('Credited: ' + (morningOT + eveningOT).toFixed(2) + 'h');
  }
  return lines.join('\n');
}

// == SUMMARY CALC =================================================
function calcSummary(sessions, compoffs, employee) {
  // Only approved sessions count toward CO
  const s = sessions.filter(function(x){ return x.employee===employee && (x.status==='approved' || x.status===null || x.status===undefined); });
  const c = compoffs.filter(function(x){ return x.employee===employee; });
  var eveCred=0,earlyCred=0,mid11=0,mid12=0,wk11=0,wk12=0;
  s.forEach(function(x){ var cr=parseFloat(x.credited_hours)||0;
    if(x.band==='Eve') eveCred+=cr; else if(x.band==='Early') earlyCred+=cr;
    else if(x.band==='Mid'){if(x.rate==='1:2')mid12+=cr;else mid11+=cr;}
    else if(x.band==='Wknd'){if(x.rate==='1:2')wk12+=cr;else wk11+=cr;}
  });
  // Eve + Early pool together (both 1:1) — 8 combined hrs = 1 CO day
  var combined=eveCred+earlyCred;
  var wkTotal=wk11+wk12;
  var coEarlyEve=Math.floor(combined/8),coMid=Math.floor(mid12/8),coWknd=Math.floor(wkTotal/8);
  var totalCO=coEarlyEve+coMid+coWknd;
  var used=0; c.forEach(function(x){ used+=parseFloat(x.days)||0; });
  var remEve=combined===0?8:(combined%8===0?0:8-(combined%8));
  return {sessions:s.length,eveCred,earlyCred,mid11,mid12,wk11,wk12,
          coEarlyEve,coMid,coWknd,totalCO,used,balance:totalCO-used,remEve:r2(remEve)};
}

// == LIVE PREVIEW =================================================
function updatePreview() {
  const date=document.getElementById('log-date').value;
  const start=document.getElementById('log-start').value;
  const end=document.getElementById('log-end').value;
  if (date) {
    const d=new Date(date);
    document.getElementById('log-day').value=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
  }
  if (!date||!start||!end) return;
  const res=calcOT(date,start,end,currentUser);
  if (!res) return;
  const bEl=document.getElementById('prev-band');
  bEl.textContent=res.band; bEl.className='preview-value '+res.band;
  document.getElementById('prev-dur').textContent=res.duration+'h';
  const rEl=document.getElementById('prev-rate');
  rEl.textContent=res.rate; rEl.className='preview-value'+(res.rate==='1:2'?' r12':'');
  document.getElementById('prev-cred').textContent=res.credited+'h';
}

// == SAVE SESSION =================================================
async function saveSession() {
  const customer = document.getElementById('log-customer').value;
  const project  = document.getElementById('log-project').value;
  const actType  = document.getElementById('log-activity-type').value;
  const act=document.getElementById('log-activity').value.trim();
  const date=document.getElementById('log-date').value;
  const start=document.getElementById('log-start').value;
  const end=document.getElementById('log-end').value;
  if (!customer||!project||!actType||!act||!date||!start||!end){ showAlert('log-error'); return; }
  var vErr = validateOTStart(date, start, currentUser, end);
  if (vErr) { alert(vErr); return; }
  const res=calcOT(date,start,end,currentUser);
  const btn=document.getElementById('save-btn');
  btn.disabled=true; btn.textContent='⏳ Saving...';
  const {error}=await sb.from('ot_sessions').insert({
    employee:currentUser,activity:act,ot_date:date,start_time:start,end_time:end,
    day_name:res.dayName,band:res.band,rate:res.rate,duration_hours:res.duration,credited_hours:res.credited,
    customer_name:customer,project_name:project,activity_type:actType,
    status:'pending'
  });
  btn.disabled=false; btn.innerHTML='💾 Save Session';
  if (error){alert('Save failed: '+error.message);return;}
  showAlert('log-success'); clearForm();
}

function clearForm() {
  ['log-activity','log-start','log-end','log-customer','log-project','log-activity-type'].forEach(function(id){
    var el=document.getElementById(id); if (el) el.value='';
  });
  document.getElementById('log-day').value='';
  // Reset project dropdown back to full list
  fillProjectSelect('log-project', '', false);
  ['prev-band','prev-dur','prev-rate','prev-cred'].forEach(function(id){
    const el=document.getElementById(id); el.textContent='—'; el.className='preview-value';
  });
}

// == RENDER SESSIONS ==============================================
async function renderSessions() {
  document.getElementById('sessions-loading').style.display='flex';
  document.getElementById('sessions-table').style.display='none';
  document.getElementById('sessions-empty').style.display='none';
  const filter=isManager?document.getElementById('sessions-emp-filter').value:currentUser;
  let q=sb.from('ot_sessions').select('*').order('ot_date',{ascending:false});
  if (filter) q=q.eq('employee',filter);
  const {data}=await q;
  document.getElementById('sessions-loading').style.display='none';
  if (!data||!data.length){document.getElementById('sessions-empty').style.display='block';return;}
  document.getElementById('sessions-table').style.display='block';
  document.getElementById('sessions-tbody').innerHTML=data.map(function(s,i){
    var st=s.status||'approved';
    var icon = st==='archived' ? '📦' : statusIcon(st);
    var label = st==='archived' ? 'Archived' : cap(st);
    var badgeClass = st==='archived' ? 'badge-rejected' : 'badge-'+st; // reuse muted badge styling
    var stBadge='<span class="badge '+badgeClass+'" style="font-size:10px" title="'+(esc2(s.manager_comment||'')||'')+'">'+icon+' '+label+'</span>';
    var explainTxt = explainOT(s).replace(/"/g, '&quot;');
    var infoIcon = '<span title="'+explainTxt+'" style="cursor:help;color:var(--teal);font-size:11px;margin-left:4px;border:1px solid var(--teal);border-radius:50%;width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;line-height:1">i</span>';
    var creditedDisplay = (st==='approved' ? '<strong style="font-family:\'DM Mono\',monospace;color:var(--navy)">'+s.credited_hours+'h</strong>' : '<span style="color:var(--muted);font-size:12px;text-decoration:line-through">'+s.credited_hours+'h</span>') + infoIcon;
    var rowOpacity = (st==='rejected'||st==='archived') ? 'opacity:0.55' : '';
    return '<tr style="'+rowOpacity+'" title="'+(st==='archived'||st==='rejected'?(esc2(s.manager_comment||'')):'')+'">'+
    '<td style="color:var(--muted);font-family:\'DM Mono\',monospace">'+(i+1)+'</td>'+
    '<td><strong>'+s.employee+'</strong></td>'+
    '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+s.activity+'">'+s.activity+'</td>'+
    '<td style="font-family:\'DM Mono\',monospace;font-size:12px">'+fmtDate(s.ot_date)+'<br><span style="font-size:11px;color:var(--muted)">'+(s.day_name||'')+'</span></td>'+
    '<td class="hide-mobile" style="font-family:\'DM Mono\',monospace">'+s.start_time+'</td>'+
    '<td class="hide-mobile" style="font-family:\'DM Mono\',monospace">'+s.end_time+'</td>'+
    '<td style="font-family:\'DM Mono\',monospace">'+s.duration_hours+'h</td>'+
    '<td><span class="badge badge-'+s.band+'">'+s.band+'</span></td>'+
    '<td><span class="badge '+(s.rate==='1:2'?'badge-12':'badge-11')+'">'+s.rate+'</span></td>'+
    '<td>'+creditedDisplay+'</td>'+
    '<td>'+stBadge+'</td>'+
    '<td style="white-space:nowrap">'+((isManager||s.employee===currentUser)?'<button class="btn btn-sm btn-ghost" onclick="openEditOT('+s.id+',\''+s.employee+'\',\''+esc2(s.activity)+'\',\''+s.ot_date+'\',\''+s.start_time+'\',\''+s.end_time+'\',\''+esc2(s.customer_name||'')+'\',\''+esc2(s.project_name||'')+'\',\''+esc2(s.activity_type||'')+'\')" style="margin-right:4px">✏️</button>':'')+(isManager?'<button class="btn btn-sm btn-danger" onclick="deleteSession('+s.id+')">✕</button>':'')+'</td></tr>';
  }).join('');
  window._sessionsData=data;
}

async function deleteSession(id) {
  if (!confirm('Delete this session?')) return;
  await sb.from('ot_sessions').delete().eq('id',id);
  renderSessions();
}

// == RENDER SUMMARY ================================================
async function renderSummary(emp) {
  document.getElementById('summary-loading').style.display='flex';
  document.getElementById('summary-content').innerHTML='';
  const [{data:sessions},{data:compoffs}]=await Promise.all([
    sb.from('ot_sessions').select('*'),
    sb.from('comp_off_register').select('*')
  ]);
  document.getElementById('summary-loading').style.display='none';
  const s=calcSummary(sessions||[],compoffs||[],emp);
  const bc=s.balance>0?'green':s.balance<0?'red':'navy';
  document.getElementById('summary-content').innerHTML=
    '<div class="summary-grid">'+
    '<div class="stat-card navy"><div class="stat-label">Total Sessions</div><div class="stat-value">'+s.sessions+'</div></div>'+
    '<div class="stat-card '+bc+'"><div class="stat-label">CO Balance</div><div class="stat-value" style="color:'+(s.balance<0?'var(--danger)':s.balance>0?'var(--success)':'var(--navy)')+'">'+s.balance+'</div><div class="stat-sub">Earned: '+s.totalCO+' | Used: '+s.used+'</div></div>'+
    '<div class="stat-card teal"><div class="stat-label">Rem. to Next CO</div><div class="stat-value">'+s.remEve+'</div><div class="stat-sub">Eve+Early hrs needed</div></div>'+
    '</div><div class="summary-grid">'+
    '<div class="stat-card eve"><div class="stat-label">Eve Credited</div><div class="stat-value">'+r2(s.eveCred)+'</div><div class="stat-sub">hrs (pools with Early)</div></div>'+
    '<div class="stat-card early"><div class="stat-label">Early Morning</div><div class="stat-value">'+r2(s.earlyCred)+'</div><div class="stat-sub">hrs → '+s.coEarlyEve+' CO days (combined)</div></div>'+
    '<div class="stat-card mid"><div class="stat-label">Midnight 1:1</div><div class="stat-value">'+r2(s.mid11)+'</div><div class="stat-sub">hrs</div></div>'+
    '<div class="stat-card mid"><div class="stat-label">Midnight 1:2</div><div class="stat-value">'+r2(s.mid12)+'</div><div class="stat-sub">hrs → '+s.coMid+' CO days</div></div>'+
    '<div class="stat-card wknd"><div class="stat-label">Weekend 1:1</div><div class="stat-value">'+r2(s.wk11)+'</div><div class="stat-sub">hrs</div></div>'+
    '<div class="stat-card wknd"><div class="stat-label">Weekend 1:2</div><div class="stat-value">'+r2(s.wk12)+'</div><div class="stat-sub">hrs → '+s.coWknd+' CO days</div></div>'+
    '</div>';
}

function buildSummaryFilters() {
  const active=currentUser||EMPLOYEES[0];
  const emps=isManager?EMPLOYEES:[currentUser];
  document.getElementById('summary-emp-filter').innerHTML=emps.map(function(e){
    return '<div class="emp-chip '+(e===active?'active':'')+'" onclick="selectSummaryEmp(this,\''+e+'\')">'+e+'</div>';
  }).join('');
  renderSummary(active);
}

function selectSummaryEmp(el,emp) {
  document.querySelectorAll('#summary-emp-filter .emp-chip').forEach(function(c){c.classList.remove('active');});
  el.classList.add('active'); renderSummary(emp);
}

// == COMP OFF REQUESTS ============================================
async function submitCompOffRequest() {
  const date=document.getElementById('co-date').value;
  const type=document.getElementById('co-type').value;
  const activity=document.getElementById('co-activity').value.trim();
  const remarks=document.getElementById('co-remarks').value.trim();
  if (!date||!type){
    if (!showAlert('co-error')) alert('Please select the date and type for the comp off request.');
    return;
  }

  const typeLabel = parseFloat(type)===1 ? 'Full Day' : 'Half Day';
  const {error}=await sb.from('comp_off_requests').insert({
    employee:currentUser,request_date:date,type:typeLabel,
    days:parseFloat(type),related_activity:activity,remarks,status:'pending'
  });
  if (error){alert('Error: '+error.message);return;}

  // Build email draft links for the manager
  var subject = 'Comp Off Request - ' + currentUser + ' - ' + typeLabel + ' on ' + date;
  var body =
    'Hi Venkat,\n\n' +
    'I have submitted a comp off request through the NetSec Portal:\n\n' +
    'Type: ' + typeLabel + ' (' + parseFloat(type) + ' day)\n' +
    'Date: ' + date + '\n' +
    'Related activity: ' + (activity || '(none)') + '\n' +
    'Remarks: ' + (remarks || '(none)') + '\n\n' +
    'Please review and approve at https://netsec-portal.pages.dev/\n\n' +
    'Thanks,\n' + currentUser;
  var enc = encodeURIComponent;
  var mailto    = 'mailto:venkat@gulfitd.com?subject=' + enc(subject) + '&body=' + enc(body);
  var outlookWb = 'https://outlook.office.com/mail/deeplink/compose?to=venkat@gulfitd.com&subject=' + enc(subject) + '&body=' + enc(body);
  var successEl = document.getElementById('co-success');
  if (successEl) {
    successEl.innerHTML = '✅ Comp off request submitted. Notify manager: '
      + '<a href="' + mailto + '" style="color:var(--teal);font-weight:600;text-decoration:underline;margin-left:6px">📧 Outlook (desktop)</a> '
      + '<a href="' + outlookWb + '" target="_blank" rel="noopener" style="color:var(--teal);font-weight:600;text-decoration:underline;margin-left:6px">🌐 Outlook (web)</a>';
  }
  showAlert('co-success');

  ['co-date','co-type','co-activity','co-remarks'].forEach(function(id){document.getElementById(id).value='';});
  renderMyCompOffRequests();
}

async function renderMyCompOffRequests() {
  document.getElementById('co-req-loading').style.display='flex';
  document.getElementById('co-req-content').innerHTML='';
  const q=isManager
    ? sb.from('comp_off_requests').select('*').order('created_at',{ascending:false})
    : sb.from('comp_off_requests').select('*').eq('employee',currentUser).order('created_at',{ascending:false});
  const {data}=await q;
  document.getElementById('co-req-loading').style.display='none';
  if (!data||!data.length){
    document.getElementById('co-req-content').innerHTML='<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No requests yet</div></div>';
    return;
  }
  document.getElementById('co-req-content').innerHTML=data.map(function(r){
    return '<div class="request-card '+r.status+'">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">'+
      '<div><strong>'+r.employee+'</strong> — '+r.type+' ('+r.days+' day)<br>'+
      '<span style="font-size:12px;color:var(--muted)">📅 '+fmtDate(r.request_date)+(r.related_activity?' | '+r.related_activity:'')+'</span></div>'+
      '<span class="badge badge-'+r.status+'">'+statusIcon(r.status)+' '+cap(r.status)+'</span></div>'+
      (r.manager_comment?'<div style="font-size:12px;color:var(--muted);margin-top:4px">💬 '+r.manager_comment+'</div>':'')+
      '</div>';
  }).join('');
}

// == RECOMPUTE ALL OT (one-time policy migration) ===========================
let _recomputeDiff = null;

async function recomputeAllOT(mode) {
  if (!isManager) { alert('Manager only.'); return; }
  var resultEl = document.getElementById('recompute-result');
  var applyBtn = document.getElementById('recompute-apply-btn');
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div class="loading"><div class="spinner"></div>Loading sessions...</div>';

  if (mode === 'preview') {
    var {data, error} = await sb.from('ot_sessions').select('*').order('ot_date',{ascending:false});
    if (error) { resultEl.innerHTML = '<div style="color:var(--danger)">Error loading: '+error.message+'</div>'; return; }
    var diffs = [];
    (data||[]).forEach(function(s){
      var res = calcOT(s.ot_date, s.start_time, s.end_time, s.employee);
      if (!res) return;
      var changed = false; var fields = {};
      if (s.band !== res.band)              { fields.band = {from: s.band, to: res.band}; changed = true; }
      if (s.rate !== res.rate)              { fields.rate = {from: s.rate, to: res.rate}; changed = true; }
      if (parseFloat(s.duration_hours||0) !== res.duration) { fields.duration = {from: s.duration_hours, to: res.duration}; changed = true; }
      if (parseFloat(s.credited_hours||0) !== res.credited) { fields.credited = {from: s.credited_hours, to: res.credited}; changed = true; }
      if (changed) diffs.push({ id: s.id, employee: s.employee, date: s.ot_date, start: s.start_time, end: s.end_time, fields: fields, newRes: res });
    });
    _recomputeDiff = diffs;
    if (!diffs.length) {
      resultEl.innerHTML = '<div style="color:var(--success);padding:10px;background:#ECFDF5;border-radius:8px">✅ All sessions already match the current policy. Nothing to change.</div>';
      applyBtn.disabled = true;
      return;
    }
    var byEmp = {};
    diffs.forEach(function(d){ byEmp[d.employee] = (byEmp[d.employee]||0) + 1; });
    var summary = Object.keys(byEmp).map(function(e){ return e+': '+byEmp[e]; }).join(' | ');
    var rowsHtml = diffs.slice(0, 50).map(function(d){
      var fieldList = Object.keys(d.fields).map(function(k){
        return '<span style="font-size:11px"><strong>'+k+'</strong>: '+d.fields[k].from+' → '+d.fields[k].to+'</span>';
      }).join(' &nbsp;|&nbsp; ');
      return '<tr><td style="font-size:12px">'+d.employee+'</td><td style="font-size:12px;font-family:DM Mono,monospace">'+d.date+'</td><td style="font-size:12px;font-family:DM Mono,monospace">'+d.start+'–'+d.end+'</td><td>'+fieldList+'</td></tr>';
    }).join('');
    resultEl.innerHTML =
      '<div style="padding:10px;background:#FEF3C7;border-radius:8px;margin-bottom:10px"><strong>'+diffs.length+' sessions will change.</strong> '+summary+(diffs.length>50?' &nbsp;(showing first 50)':'')+'</div>'+
      '<div class="table-wrap" style="max-height:400px;overflow:auto"><table style="width:100%"><thead><tr><th style="font-size:11px">Employee</th><th style="font-size:11px">Date</th><th style="font-size:11px">Time</th><th style="font-size:11px">Changes</th></tr></thead><tbody>'+rowsHtml+'</tbody></table></div>';
    applyBtn.disabled = false;
    return;
  }

  // mode === 'apply'
  if (!_recomputeDiff || !_recomputeDiff.length) {
    alert('Run Preview first.');
    return;
  }
  if (!confirm('Apply policy recompute to '+_recomputeDiff.length+' sessions? This updates band, rate, duration, and credited hours. Cannot be undone.')) return;
  applyBtn.disabled = true;
  resultEl.innerHTML = '<div class="loading"><div class="spinner"></div>Updating '+_recomputeDiff.length+' sessions...</div>';
  var ok = 0, fail = 0;
  for (var i = 0; i < _recomputeDiff.length; i++) {
    var d = _recomputeDiff[i];
    var r = d.newRes;
    var {error} = await sb.from('ot_sessions').update({
      band: r.band, rate: r.rate, duration_hours: r.duration, credited_hours: r.credited, day_name: r.dayName
    }).eq('id', d.id);
    if (error) fail++; else ok++;
  }
  _recomputeDiff = null;
  resultEl.innerHTML = '<div style="padding:10px;background:'+(fail?'#FEE2E2':'#ECFDF5')+';border-radius:8px"><strong>Done.</strong> '+ok+' updated'+(fail?', '+fail+' failed':'')+'. CO balances will reflect new credit on next reload.</div>';
  applyBtn.disabled = true;
}

// ══ POLICY VIOLATION CLEANUP (one-time) ═══════════════════════════════════
// Hard-delete OT sessions whose start time falls in the now-blocked weekday
// window (UAE 7:30-18:30 / KSA 8:00-19:00). To avoid making any employee's
// CO balance go negative, we keep the oldest violators up to the amount
// needed to cover already-used CO (Option B: don't claw back used CO).
let _violationPlan = null;

async function findPolicyViolators(fromDate) {
  // fromDate: 'YYYY-MM-DD' string. Sessions before this date are exempt
  // (kept untouched, even if they violate). Their credit still counts
  // toward valid_credit so the cap-at-used logic stays accurate.
  var sessRes = await sb.from('ot_sessions').select('*').order('ot_date', {ascending: true});
  var coRes   = await sb.from('comp_off_register').select('*');
  if (sessRes.error) throw sessRes.error;
  if (coRes.error)   throw coRes.error;

  var byEmp = {};
  function ensureEmp(name) {
    if (!byEmp[name]) byEmp[name] = { violators: [], valid_credit: 0, used_days: 0, used_hours: 0 };
    return byEmp[name];
  }

  (sessRes.data||[]).forEach(function(s){
    var emp = ensureEmp(s.employee);
    var vErr = validateOTStart(s.ot_date, s.start_time, s.employee);
    var isApproved = (s.status === 'approved' || s.status == null);
    var inScope = !fromDate || (s.ot_date && s.ot_date >= fromDate);
    if (vErr && inScope) {
      // Eligible for cleanup
      emp.violators.push(s);
    } else if (isApproved) {
      // Either valid, or violator out of scope — keep contributing to credit
      emp.valid_credit += parseFloat(s.credited_hours||0);
    }
  });

  (coRes.data||[]).forEach(function(c){
    var emp = ensureEmp(c.employee);
    emp.used_days += parseFloat(c.days||0);
  });

  Object.keys(byEmp).forEach(function(name){
    var d = byEmp[name];
    d.used_hours = d.used_days * 8;
    var deficit  = Math.max(0, d.used_hours - d.valid_credit);
    var keep = [], del = [], keptHours = 0;
    // Oldest first — those are likely already "spent" CO
    d.violators.forEach(function(v){
      var ch = parseFloat(v.credited_hours||0);
      var isApproved = (v.status === 'approved' || v.status == null);
      if (isApproved && deficit > 0 && keptHours < deficit) {
        keep.push(v);
        keptHours += ch;
      } else {
        del.push(v);
      }
    });
    d.recommendation = { keep: keep, del: del, kept_hours: keptHours, deficit_hours: deficit };
  });

  return byEmp;
}

async function previewViolations() {
  if (!isManager) { alert('Manager only.'); return; }
  var resultEl = document.getElementById('violations-result');
  var applyBtn = document.getElementById('violations-apply-btn');
  var fromEl   = document.getElementById('violations-from');
  var fromDate = fromEl ? fromEl.value : '';
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div class="loading"><div class="spinner"></div>Scanning'+(fromDate?' (from '+fromDate+')':'')+'...</div>';

  try {
    _violationPlan = await findPolicyViolators(fromDate || null);
  } catch (e) {
    resultEl.innerHTML = '<div style="color:var(--danger)">Error: '+(e.message||e)+'</div>';
    return;
  }

  var totalDel = 0, totalKeep = 0, affectedEmps = 0;
  var rowsHtml = '';
  Object.keys(_violationPlan).sort().forEach(function(emp){
    var d = _violationPlan[emp];
    if (!d.violators.length) return;
    affectedEmps++;
    totalDel  += d.recommendation.del.length;
    totalKeep += d.recommendation.keep.length;
    var newBalance = ((d.valid_credit + d.recommendation.kept_hours) / 8) - d.used_days;
    rowsHtml +=
      '<tr>'+
      '<td style="font-weight:600">'+emp+'</td>'+
      '<td style="font-family:DM Mono,monospace">'+d.violators.length+'</td>'+
      '<td style="font-family:DM Mono,monospace;color:var(--danger);font-weight:700">'+d.recommendation.del.length+'</td>'+
      '<td style="font-family:DM Mono,monospace;color:var(--gold)">'+d.recommendation.keep.length+'</td>'+
      '<td style="font-family:DM Mono,monospace">'+r2(d.used_days)+' days</td>'+
      '<td style="font-family:DM Mono,monospace">'+r2(d.valid_credit)+'h</td>'+
      '<td style="font-family:DM Mono,monospace;color:'+(newBalance<0?'var(--danger)':'var(--success)')+'">'+r2(newBalance)+' days</td>'+
      '</tr>';
  });

  if (!totalDel && !totalKeep) {
    resultEl.innerHTML = '<div style="color:var(--success);padding:10px;background:#ECFDF5;border-radius:8px">✅ No policy violations found. All sessions match the current weekday block window.</div>';
    applyBtn.disabled = true;
    return;
  }

  resultEl.innerHTML =
    '<div style="padding:10px;background:#FEE2E2;border-radius:8px;margin-bottom:10px">'+
    '<strong>'+affectedEmps+' employee(s) affected — '+totalDel+' session(s) will be DELETED</strong>'+
    (totalKeep ? ', '+totalKeep+' kept to preserve already-used CO balance.' : '.')+
    '</div>'+
    '<div class="table-wrap"><table style="width:100%;font-size:12px"><thead><tr>'+
    '<th>Employee</th><th>Violators</th><th>Delete</th><th>Keep</th>'+
    '<th>CO Used</th><th>Valid Credit</th><th>Balance After</th>'+
    '</tr></thead><tbody>'+rowsHtml+'</tbody></table></div>'+
    '<div style="margin-top:10px;font-size:12px;color:var(--muted)">"Keep" rows are oldest violators retained to keep an employee\'s balance from going negative. They stay in the database with their current credit.</div>';
  applyBtn.disabled = false;
}

async function applyViolationCleanup() {
  if (!isManager) return;
  if (!_violationPlan) { alert('Run Preview Violations first.'); return; }

  var allDel = [];
  Object.keys(_violationPlan).forEach(function(emp){
    allDel = allDel.concat(_violationPlan[emp].recommendation.del);
  });
  if (!allDel.length) { alert('Nothing to archive.'); return; }

  if (!confirm('Archive '+allDel.length+' OT session(s)?\n\nThey will be marked as archived (no longer count toward CO) but stay visible to manager and the affected employee for reference. Reason will be auto-recorded.')) return;

  var resultEl = document.getElementById('violations-result');
  var applyBtn = document.getElementById('violations-apply-btn');
  applyBtn.disabled = true;
  resultEl.innerHTML = '<div class="loading"><div class="spinner"></div>Archiving '+allDel.length+' sessions...</div>';

  var reason = 'Auto-archived: violates current weekday OT block window (UAE 7:30 AM-6:30 PM / KSA 8:00 AM-7:00 PM). Sessions starting in regular working hours no longer count as overtime under the updated policy.';
  var nowIso = new Date().toISOString();
  var ok = 0, fail = 0;
  for (var i = 0; i < allDel.length; i++) {
    var {error} = await sb.from('ot_sessions').update({
      status: 'archived',
      manager_comment: reason,
      reviewed_by: currentUser,
      reviewed_at: nowIso
    }).eq('id', allDel[i].id);
    if (error) fail++; else ok++;
  }

  _violationPlan = null;
  resultEl.innerHTML = '<div style="padding:10px;background:'+(fail?'#FEE2E2':'#ECFDF5')+';border-radius:8px"><strong>Archive done.</strong> '+ok+' marked archived'+(fail?', '+fail+' failed':'')+'. Sessions still visible (dimmed) in employee history. Reload to see updated CO balances.</div>';
}

// Re-evaluate every archived session under the current calcOT logic.
// Sessions that now qualify for partial credit (e.g. 18:00-19:00 weekday
// gives 0.5h post-eve-threshold) get un-archived (status=approved) and
// their band/rate/credit updated. Sessions still entirely in the block
// remain archived.
let _reevalPlan = null;

async function previewReevalArchived() {
  if (!isManager) { alert('Manager only.'); return; }
  var resultEl = document.getElementById('reeval-result');
  var applyBtn = document.getElementById('reeval-apply-btn');
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div class="loading"><div class="spinner"></div>Scanning archived sessions...</div>';

  var {data, error} = await sb.from('ot_sessions').select('*').eq('status', 'archived').order('ot_date',{ascending:false});
  if (error) { resultEl.innerHTML = '<div style="color:var(--danger)">Error: '+error.message+'</div>'; return; }

  var changes = [];
  (data||[]).forEach(function(s){
    var res = calcOT(s.ot_date, s.start_time, s.end_time, s.employee);
    if (!res) return;
    if (res.credited > 0) {
      changes.push({ row: s, newRes: res });
    }
  });
  _reevalPlan = changes;

  if (!changes.length) {
    resultEl.innerHTML = '<div style="padding:10px;background:#ECFDF5;border-radius:8px;color:var(--success)">No archived sessions need re-evaluation. They are all entirely within regular working hours.</div>';
    applyBtn.disabled = true;
    return;
  }

  var rowsHtml = changes.slice(0, 50).map(function(c){
    var s = c.row, r = c.newRes;
    return '<tr><td>'+s.employee+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+s.ot_date+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+s.start_time+' to '+s.end_time+'</td>'+
      '<td style="font-family:DM Mono,monospace">'+s.credited_hours+'h -> <strong>'+r.credited+'h</strong></td>'+
      '<td><span class="badge badge-'+r.band+'">'+r.band+'</span></td>'+
      '</tr>';
  }).join('');

  resultEl.innerHTML =
    '<div style="padding:10px;background:#FEF3C7;border-radius:8px;margin-bottom:10px"><strong>'+changes.length+' archived session(s)</strong> qualify for partial credit and will be UN-ARCHIVED (status set to approved) with updated band/rate/credit.'+(changes.length>50?' Showing first 50.':'')+'</div>'+
    '<div class="table-wrap" style="max-height:400px;overflow:auto"><table style="width:100%;font-size:12px"><thead><tr>'+
    '<th>Employee</th><th>Date</th><th>Time</th><th>Credit Δ</th><th>New Band</th>'+
    '</tr></thead><tbody>'+rowsHtml+'</tbody></table></div>';
  applyBtn.disabled = false;
}

async function applyReevalArchived() {
  if (!isManager) return;
  if (!_reevalPlan || !_reevalPlan.length) { alert('Run Preview first.'); return; }
  if (!confirm('Re-evaluate '+_reevalPlan.length+' archived session(s)?\n\nThey will be marked APPROVED with updated credit. Their CO contribution will resume.')) return;

  var resultEl = document.getElementById('reeval-result');
  var applyBtn = document.getElementById('reeval-apply-btn');
  applyBtn.disabled = true;
  resultEl.innerHTML = '<div class="loading"><div class="spinner"></div>Updating '+_reevalPlan.length+'...</div>';

  var nowIso = new Date().toISOString();
  var ok = 0, fail = 0;
  for (var i = 0; i < _reevalPlan.length; i++) {
    var c = _reevalPlan[i];
    var r = c.newRes;
    var {error} = await sb.from('ot_sessions').update({
      status: 'approved',
      band: r.band, rate: r.rate,
      duration_hours: r.duration, credited_hours: r.credited, day_name: r.dayName,
      manager_comment: 'Re-evaluated under updated policy: only the off-hours portion is credited.',
      reviewed_by: currentUser, reviewed_at: nowIso
    }).eq('id', c.row.id);
    if (error) fail++; else ok++;
  }
  _reevalPlan = null;
  resultEl.innerHTML = '<div style="padding:10px;background:'+(fail?'#FEE2E2':'#ECFDF5')+';border-radius:8px"><strong>Re-evaluation done.</strong> '+ok+' un-archived'+(fail?', '+fail+' failed':'')+'. Reload to see updated CO balances.</div>';
}

// Purge archived/rejected OT sessions older than 1 year. Manager-only,
// double-confirm. Hard-delete is irreversible.
async function purgeOldArchived() {
  if (!isManager) { alert('Manager only.'); return; }
  var resultEl = document.getElementById('purge-result');
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div class="loading"><div class="spinner"></div>Scanning...</div>';

  var cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1);
  var cutoffIso = cutoff.toISOString();

  var {data, error} = await sb.from('ot_sessions')
    .select('id,employee,ot_date,activity,status,reviewed_at,created_at')
    .in('status', ['archived','rejected']);
  if (error) { resultEl.innerHTML = '<div style="color:var(--danger)">Error: '+error.message+'</div>'; return; }

  // Filter to those older than 1 year (use reviewed_at if present, else created_at)
  var stale = (data||[]).filter(function(r){
    var ts = r.reviewed_at || r.created_at;
    return ts && ts < cutoffIso;
  });

  if (!stale.length) {
    resultEl.innerHTML = '<div style="padding:10px;background:#ECFDF5;border-radius:8px;color:var(--success)">Nothing to purge — no archived/rejected sessions older than 1 year.</div>';
    return;
  }

  if (!confirm('PERMANENTLY DELETE '+stale.length+' archived/rejected session(s) older than 1 year ('+cutoff.toISOString().split('T')[0]+')?\n\nThis cannot be undone.')) return;
  if (!confirm('Final confirmation — hard-delete '+stale.length+' rows?')) return;

  resultEl.innerHTML = '<div class="loading"><div class="spinner"></div>Purging '+stale.length+'...</div>';
  var ok = 0, fail = 0;
  for (var i = 0; i < stale.length; i++) {
    var res = await sb.from('ot_sessions').delete().eq('id', stale[i].id);
    if (res.error) fail++; else ok++;
  }
  resultEl.innerHTML = '<div style="padding:10px;background:'+(fail?'#FEE2E2':'#ECFDF5')+';border-radius:8px"><strong>Purge done.</strong> '+ok+' deleted'+(fail?', '+fail+' failed':'')+'.</div>';
}

