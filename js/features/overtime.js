// â•â• OT CALCULATION ENGINE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function isWeekend(wd, employee) {
  return KSA_EMP.includes(employee) ? (wd===5||wd===6) : (wd===0||wd===6);
}

// Returns null if valid, or error message string
function validateOTStart(dateStr, startStr, employee) {
  if (!dateStr || !startStr) return null;
  var d = new Date(dateStr); var wd = d.getDay();
  if (isWeekend(wd, employee)) return null;
  var sp = startStr.split(':').map(Number);
  var startHour = sp[0] + sp[1]/60;
  if (startHour >= 7.5 && startHour < 18.5) {
    return 'OT cannot start between 7:30 AM and 6:30 PM on weekdays â€” these are regular working hours. OT must begin before 7:30 AM or after 6:30 PM.';
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
  let band,rate,cred;
  if (isWknd) {
    band='Wknd'; rate='1:1';
    cred=rawDur;
  } else {
    const crossesMidnight=ef<=sf;
    const isEve=sf>=18.5&&ef>sf; const isEveCross=sf>=18.5&&crossesMidnight;
    const isMid=crossesMidnight&&sf<18.5; const isMidStart=!crossesMidnight&&sf<5;
    const isEarly=sf>=5&&sf<9&&!crossesMidnight;
    if (isEve)       { band='Eve';   rate='1:1'; cred=rawDur; }
    else if (isEveCross) { band='Eve'; rate='Split'; cred=Math.min((24-sf)+(ef*2),8); }
    else if (isMid||isMidStart) { band='Mid'; rate=rawDur>=4?'1:2':'1:1'; cred=rawDur; }
    else if (isEarly) { band='Early'; rate='1:1'; cred=Math.min(ef,9)-sf; }
    else              { band='Day';   rate='1:1'; cred=rawDur; }
  }
  return { band, rate, duration:r2(rawDur), credited:r2(cred>0?cred:rawDur),
    dayName:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()] };
}

// â•â• SUMMARY CALC â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
  // Eve + Early pool together (both 1:1) â€” 8 combined hrs = 1 CO day
  var combined=eveCred+earlyCred;
  var wkTotal=wk11+wk12;
  var coEarlyEve=Math.floor(combined/8),coMid=Math.floor(mid12/8),coWknd=Math.floor(wkTotal/8);
  var totalCO=coEarlyEve+coMid+coWknd;
  var used=0; c.forEach(function(x){ used+=parseFloat(x.days)||0; });
  var remEve=combined===0?8:(combined%8===0?0:8-(combined%8));
  return {sessions:s.length,eveCred,earlyCred,mid11,mid12,wk11,wk12,
          coEarlyEve,coMid,coWknd,totalCO,used,balance:totalCO-used,remEve:r2(remEve)};
}

// â•â• LIVE PREVIEW â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

// â•â• SAVE SESSION â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function saveSession() {
  const customer = document.getElementById('log-customer').value;
  const project  = document.getElementById('log-project').value;
  const actType  = document.getElementById('log-activity-type').value;
  const act=document.getElementById('log-activity').value.trim();
  const date=document.getElementById('log-date').value;
  const start=document.getElementById('log-start').value;
  const end=document.getElementById('log-end').value;
  if (!customer||!project||!actType||!act||!date||!start||!end){ showAlert('log-error'); return; }
  var vErr = validateOTStart(date, start, currentUser);
  if (vErr) { alert(vErr); return; }
  const res=calcOT(date,start,end,currentUser);
  const btn=document.getElementById('save-btn');
  btn.disabled=true; btn.textContent='â³ Saving...';
  const {error}=await sb.from('ot_sessions').insert({
    employee:currentUser,activity:act,ot_date:date,start_time:start,end_time:end,
    day_name:res.dayName,band:res.band,rate:res.rate,duration_hours:res.duration,credited_hours:res.credited,
    customer_name:customer,project_name:project,activity_type:actType,
    status:'pending'
  });
  btn.disabled=false; btn.innerHTML='ðŸ’¾ Save Session';
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
    const el=document.getElementById(id); el.textContent='â€”'; el.className='preview-value';
  });
}

// â•â• RENDER SESSIONS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
    var stBadge='<span class="badge badge-'+st+'" style="font-size:10px">'+statusIcon(st)+' '+cap(st)+'</span>';
    var creditedDisplay = st==='approved' ? '<strong style="font-family:\'DM Mono\',monospace;color:var(--navy)">'+s.credited_hours+'h</strong>' : '<span style="color:var(--muted);font-size:12px">'+s.credited_hours+'h</span>';
    return '<tr style="'+(st==='rejected'?'opacity:0.6':'')+'">'+
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
    '<td style="white-space:nowrap">'+((isManager||s.employee===currentUser)?'<button class="btn btn-sm btn-ghost" onclick="openEditOT('+s.id+',\''+s.employee+'\',\''+esc2(s.activity)+'\',\''+s.ot_date+'\',\''+s.start_time+'\',\''+s.end_time+'\',\''+esc2(s.customer_name||'')+'\',\''+esc2(s.project_name||'')+'\',\''+esc2(s.activity_type||'')+'\')" style="margin-right:4px">âœï¸</button>':'')+(isManager?'<button class="btn btn-sm btn-danger" onclick="deleteSession('+s.id+')">âœ•</button>':'')+'</td></tr>';
  }).join('');
  window._sessionsData=data;
}

async function deleteSession(id) {
  if (!confirm('Delete this session?')) return;
  await sb.from('ot_sessions').delete().eq('id',id);
  renderSessions();
}

// â•â• RENDER SUMMARY â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
    '<div class="stat-card early"><div class="stat-label">Early Morning</div><div class="stat-value">'+r2(s.earlyCred)+'</div><div class="stat-sub">hrs â†’ '+s.coEarlyEve+' CO days (combined)</div></div>'+
    '<div class="stat-card mid"><div class="stat-label">Midnight 1:1</div><div class="stat-value">'+r2(s.mid11)+'</div><div class="stat-sub">hrs</div></div>'+
    '<div class="stat-card mid"><div class="stat-label">Midnight 1:2</div><div class="stat-value">'+r2(s.mid12)+'</div><div class="stat-sub">hrs â†’ '+s.coMid+' CO days</div></div>'+
    '<div class="stat-card wknd"><div class="stat-label">Weekend 1:1</div><div class="stat-value">'+r2(s.wk11)+'</div><div class="stat-sub">hrs</div></div>'+
    '<div class="stat-card wknd"><div class="stat-label">Weekend 1:2</div><div class="stat-value">'+r2(s.wk12)+'</div><div class="stat-sub">hrs â†’ '+s.coWknd+' CO days</div></div>'+
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

// â•â• COMP OFF REQUESTS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function submitCompOffRequest() {
  const date=document.getElementById('co-date').value;
  const type=document.getElementById('co-type').value;
  const activity=document.getElementById('co-activity').value.trim();
  const remarks=document.getElementById('co-remarks').value.trim();
  if (!date||!type){
    if (!showAlert('co-error')) alert('Please select the date and type for the comp off request.');
    return;
  }

  const {error}=await sb.from('comp_off_requests').insert({
    employee:currentUser,request_date:date,type:parseFloat(type)===1?'Full Day':'Half Day',
    days:parseFloat(type),related_activity:activity,remarks,status:'pending'
  });
  if (error){alert('Error: '+error.message);return;}
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
    document.getElementById('co-req-content').innerHTML='<div class="empty-state"><div class="empty-icon">ðŸ“‹</div><div class="empty-title">No requests yet</div></div>';
    return;
  }
  document.getElementById('co-req-content').innerHTML=data.map(function(r){
    return '<div class="request-card '+r.status+'">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">'+
      '<div><strong>'+r.employee+'</strong> â€” '+r.type+' ('+r.days+' day)<br>'+
      '<span style="font-size:12px;color:var(--muted)">ðŸ“… '+fmtDate(r.request_date)+(r.related_activity?' | '+r.related_activity:'')+'</span></div>'+
      '<span class="badge badge-'+r.status+'">'+statusIcon(r.status)+' '+cap(r.status)+'</span></div>'+
      (r.manager_comment?'<div style="font-size:12px;color:var(--muted);margin-top:4px">ðŸ’¬ '+r.manager_comment+'</div>':'')+
      '</div>';
  }).join('');
}

// â•â• RECOMPUTE ALL OT (one-time policy migration) â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
      resultEl.innerHTML = '<div style="color:var(--success);padding:10px;background:#ECFDF5;border-radius:8px">âœ… All sessions already match the current policy. Nothing to change.</div>';
      applyBtn.disabled = true;
      return;
    }
    var byEmp = {};
    diffs.forEach(function(d){ byEmp[d.employee] = (byEmp[d.employee]||0) + 1; });
    var summary = Object.keys(byEmp).map(function(e){ return e+': '+byEmp[e]; }).join(' | ');
    var rowsHtml = diffs.slice(0, 50).map(function(d){
      var fieldList = Object.keys(d.fields).map(function(k){
        return '<span style="font-size:11px"><strong>'+k+'</strong>: '+d.fields[k].from+' â†’ '+d.fields[k].to+'</span>';
      }).join(' &nbsp;|&nbsp; ');
      return '<tr><td style="font-size:12px">'+d.employee+'</td><td style="font-size:12px;font-family:DM Mono,monospace">'+d.date+'</td><td style="font-size:12px;font-family:DM Mono,monospace">'+d.start+'â€“'+d.end+'</td><td>'+fieldList+'</td></tr>';
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

