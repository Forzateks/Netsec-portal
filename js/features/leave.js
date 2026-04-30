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

async function getLeaveDaysUsed(employee,year,leaveType) {
  // leaveType: 'annual' or 'sick'
  let q = sb.from('annual_leave').select('working_days,leave_type')
    .eq('employee',employee).gte('start_date',year+'-01-01').lte('start_date',year+'-12-31');
  const {data} = await q;
  return (data||[]).filter(function(r){
    // If leave_type column exists filter by it, otherwise treat all as annual
    if (leaveType) return (r.leave_type||'annual') === leaveType;
    return true;
  }).reduce(function(s,r){return s+parseFloat(r.working_days||0);},0);
}

async function updateLeavePreview() {
  const start  = document.getElementById('lv-start').value;
  const end    = document.getElementById('lv-end').value;
  const ltype  = document.getElementById('lv-type') ? document.getElementById('lv-type').value : 'annual';
  const isSick = ltype === 'sick';
  const allowance = isSick ? SICK_ALLOWANCE : LEAVE_ALLOWANCE;

  document.getElementById('lv-prev-type').textContent = isSick ? 'Sick' : 'Annual';

  if (!start||!end) return;
  const days = calcWorkingDays(start,end,currentUser);
  const year = start.split('-')[0];
  const used = await getLeaveDaysUsed(currentUser,year,ltype);
  const balAfter = allowance - used - days;
  document.getElementById('lv-prev-days').textContent = days+' days';
  document.getElementById('lv-prev-used').textContent = used+' / '+allowance;
  document.getElementById('lv-prev-bal').textContent  = balAfter+' days';
  document.getElementById('lv-prev-bal').style.color  = balAfter<0?'var(--danger)':balAfter<=3?'var(--gold)':'var(--success)';
}

async function submitLeaveRequest() {
  const start  = document.getElementById('lv-start').value;
  const end    = document.getElementById('lv-end').value;
  const reason = document.getElementById('lv-reason').value.trim();
  const ltype  = document.getElementById('lv-type') ? document.getElementById('lv-type').value : 'annual';
  if (!start||!end){showAlert('leave-error');return;}
  const days = calcWorkingDays(start,end,currentUser);
  if (days<=0){showAlert('leave-error');return;}
  const btn=document.getElementById('lv-save-btn');
  btn.disabled=true; btn.textContent='⏳ Submitting...';
  const {error}=await sb.from('leave_requests').insert({
    employee:currentUser,start_date:start,end_date:end,working_days:days,
    reason,status:'pending',leave_type:ltype
  });
  btn.disabled=false; btn.innerHTML='📁¤ Submit Request';
  if (error){alert('Error: '+error.message);return;}
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
  let q=sb.from('leave_requests').select('*').order('created_at',{ascending:false});
  if (filter) q=q.eq('employee',filter);
  const {data}=await q;
  document.getElementById('lv-hist-load').style.display='none';
  if (!data||!data.length){
    document.getElementById('lv-hist-content').innerHTML='<div class="empty-state"><div class="empty-title">No leave requests yet</div></div>';
    return;
  }
  document.getElementById('lv-hist-content').innerHTML=data.map(function(r){
    var ltIcon  = (r.leave_type||'annual')==='sick' ? 'Sick Leave' : 'Annual Leave';
    var ltColor = (r.leave_type||'annual')==='sick' ? '#8B5CF6' : 'var(--teal)';
    return '<div class="request-card '+r.status+'">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">'+
      '<div><strong>'+r.employee+'</strong> <span style="font-size:11px;font-weight:600;color:'+ltColor+'">'+ltIcon+'</span><br>'+
      '<span style="font-family:DM Mono,monospace;font-size:13px">'+fmtDate(r.start_date)+' to '+fmtDate(r.end_date)+'</span><br>'+
      '<span style="font-size:12px;color:var(--muted)">'+r.working_days+' working days'+(r.reason?' | '+r.reason:'')+'</span></div>'+
      '<span class="badge badge-'+r.status+'">'+statusIcon(r.status)+' '+cap(r.status)+'</span></div>'+
      (r.manager_comment?'<div style="font-size:12px;color:var(--muted);margin-top:4px">💬 '+r.manager_comment+'</div>':'')+
      '</div>';
  }).join('');
}

async function renderLeaveTeam() {
  document.getElementById('lv-team-load').style.display='flex';
  document.getElementById('lv-team-content').innerHTML='';
  const year=new Date().getFullYear().toString();
  const {data}=await sb.from('annual_leave').select('*').gte('start_date',year+'-01-01').lte('start_date',year+'-12-31');
  document.getElementById('lv-team-load').style.display='none';
  const records=data||[];

  // Employees only see their own row; manager sees all
  const visibleEmps = isManager ? EMPLOYEES : [currentUser];

  const rows=visibleEmps.map(function(emp){
    const empRecs = records.filter(function(r){return r.employee===emp;});
    const annualUsed = empRecs.filter(function(r){return (r.leave_type||'annual')==='annual';})
                              .reduce(function(s,r){return s+parseFloat(r.working_days||0);},0);
    const sickUsed   = empRecs.filter(function(r){return r.leave_type==='sick';})
                              .reduce(function(s,r){return s+parseFloat(r.working_days||0);},0);
    const annualRem  = LEAVE_ALLOWANCE - annualUsed;
    const sickRem    = SICK_ALLOWANCE  - sickUsed;
    const aColor = annualRem<=0?'var(--danger)':annualRem<=5?'var(--gold)':'var(--success)';
    const sColor = sickRem<=0?'var(--danger)':sickRem<=3?'var(--gold)':'var(--success)';
    const aPct   = Math.min((annualUsed/LEAVE_ALLOWANCE)*100,100);
    const aBadge = annualRem<=0?'<span class="badge badge-rejected">No balance</span>':annualRem<=5?'<span class="badge badge-pending">Low</span>':'<span class="badge badge-approved">OK</span>';
    const sBadge = sickRem<=0?'<span class="badge badge-rejected">No balance</span>':sickRem<=3?'<span class="badge badge-pending">Low</span>':'<span class="badge badge-approved">OK</span>';
    return '<tr>'+
      '<td><strong>'+emp+'</strong><br><span style="font-size:11px;color:var(--muted)">'+(KSA_EMP.includes(emp)?'KSA — Fri/Sat':'UAE — Sat/Sun')+'</span></td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal)">'+annualUsed+' / '+LEAVE_ALLOWANCE+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:'+aColor+'">'+annualRem+'</td>'+
      '<td><div style="height:8px;background:#f3f4f6;border-radius:4px;overflow:hidden"><div style="height:100%;width:'+aPct+'%;background:'+aColor+';border-radius:4px"></div></div><div style="font-size:11px;color:var(--muted);margin-top:3px">'+Math.round(aPct)+'% used</div></td>'+
      '<td>'+aBadge+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal)">'+sickUsed+' / '+SICK_ALLOWANCE+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:'+sColor+'">'+sickRem+'</td>'+
      '<td>'+sBadge+'</td>'+
      '</tr>';
  }).join('');

  document.getElementById('lv-team-content').innerHTML=
    '<div class="card"><div class="card-title">'+(isManager?'Team':'My')+' Leave Overview '+year+'</div>'+
    '<div class="table-wrap"><table><thead><tr>'+
    '<th>Employee</th>'+
    '<th>Annual Used</th><th>Annual Rem.</th><th>Usage</th><th>Status</th>'+
    '<th>Sick Used</th><th>Sick Rem.</th><th>Status</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div style="margin-top:10px;font-size:12px;color:var(--muted)">Annual: '+LEAVE_ALLOWANCE+' days/yr &nbsp;|&nbsp; Sick: '+SICK_ALLOWANCE+' days/yr</div>'+
    '</div>';
}

// == MANAGER VIEW =================================================
async function renderManager() {
  document.getElementById('manager-loading').style.display='flex';
  document.getElementById('manager-content').innerHTML='';
  const [{data:sessions},{data:compoffs}]=await Promise.all([
    sb.from('ot_sessions').select('*'),
    sb.from('comp_off_register').select('*')
  ]);
  document.getElementById('manager-loading').style.display='none';
  const rows=EMPLOYEES.map(function(emp){
    const s=calcSummary(sessions||[],compoffs||[],emp);
    const bc=s.balance>0?'var(--success)':s.balance<0?'var(--danger)':'var(--navy)';
    return '<tr><td><strong>'+emp+'</strong></td>'+
      '<td style="font-family:\'DM Mono\',monospace">'+s.sessions+'</td>'+
      '<td style="font-family:\'DM Mono\',monospace">'+r2(s.eveCred)+'</td>'+
      '<td style="font-family:\'DM Mono\',monospace">'+r2(s.earlyCred)+'</td>'+
      '<td style="font-family:\'DM Mono\',monospace">'+r2(s.mid12)+'</td>'+
      '<td style="font-family:\'DM Mono\',monospace">'+r2(s.wk12)+'</td>'+
      '<td><strong style="font-family:\'DM Mono\',monospace;color:var(--navy)">'+s.totalCO+'</strong></td>'+
      '<td style="font-family:\'DM Mono\',monospace">'+s.used+'</td>'+
      '<td><strong style="font-family:\'DM Mono\',monospace;color:'+bc+'">'+s.balance+'</strong></td></tr>';
  }).join('');
  document.getElementById('manager-content').innerHTML=
    '<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Sessions</th><th>Eve Cred</th><th>Early Cred</th><th>Mid 1:2</th><th>Wknd 1:2</th><th>CO Earned</th><th>CO Used</th><th>Balance</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

// == APPROVALS (MANAGER) ==========================================
async function updateNotifBadge() {
  const [{data:coReqs},{data:lvReqs},{data:otReqs}]=await Promise.all([
    sb.from('comp_off_requests').select('id').eq('status','pending'),
    sb.from('leave_requests').select('id').eq('status','pending'),
    sb.from('ot_sessions').select('id').eq('status','pending')
  ]);
  const total=(coReqs||[]).length+(lvReqs||[]).length+(otReqs||[]).length;
  const badge=document.getElementById('notif-badge');
  if (total>0){badge.textContent=total;badge.style.display='inline-block';}
  else {badge.style.display='none';}
}

async function renderCompOffApprovals() {
  document.getElementById('co-approvals-load').style.display='flex';
  document.getElementById('co-approvals-content').innerHTML='';
  const {data}=await sb.from('comp_off_requests').select('*').order('created_at',{ascending:false});
  document.getElementById('co-approvals-load').style.display='none';
  if (!data||!data.length){
    document.getElementById('co-approvals-content').innerHTML='<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">No comp off requests</div></div>';
    return;
  }
  const pending=data.filter(function(r){return r.status==='pending';});
  const others=data.filter(function(r){return r.status!=='pending';});
  let html='';
  if (pending.length){
    html+='<h3 style="font-size:14px;font-weight:600;color:var(--navy);margin-bottom:12px">🟡 Pending ('+pending.length+')</h3>';
    html+=pending.map(function(r){return approvalCard(r,'compoff');}).join('');
  }
  if (others.length){
    html+='<h3 style="font-size:14px;font-weight:600;color:var(--muted);margin:20px 0 12px">History</h3>';
    html+=others.map(function(r){return approvalCard(r,'compoff');}).join('');
  }
  document.getElementById('co-approvals-content').innerHTML=html;
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

  var q = sb.from('leave_requests').select('*').order('created_at',{ascending:false});
  if (fEmp)    q = q.eq('employee', fEmp);
  if (fType)   q = q.eq('leave_type', fType);
  if (fStatus) q = q.eq('status', fStatus);
  if (fFrom)   q = q.gte('start_date', fFrom);
  if (fTo)     q = q.lte('end_date', fTo);

  const {data}=await q;
  document.getElementById('lv-approvals-load').style.display='none';
  if (!data||!data.length){
    document.getElementById('lv-approvals-content').innerHTML='<div class="empty-state"><div class="empty-icon">🏖️</div><div class="empty-title">No leave requests match the filters</div></div>';
    return;
  }
  const pending=data.filter(function(r){return r.status==='pending';});
  const others=data.filter(function(r){return r.status!=='pending';});
  let html='';
  if (pending.length){
    html+='<h3 style="font-size:14px;font-weight:600;color:var(--navy);margin-bottom:12px">🟡 Pending ('+pending.length+')</h3>';
    html+=pending.map(function(r){return approvalCard(r,'leave');}).join('');
  }
  if (others.length){
    html+='<h3 style="font-size:14px;font-weight:600;color:var(--muted);margin:20px 0 12px">History ('+others.length+')</h3>';
    html+=others.map(function(r){return approvalCard(r,'leave');}).join('');
  }
  document.getElementById('lv-approvals-content').innerHTML=html;
}

// === EDIT LEAVE REQUEST (manager only) ============================
function openEditLeaveModal(id) {
  sb.from('leave_requests').select('*').eq('id', id).single().then(function(res){
    if (res.error || !res.data) { alert('Could not load leave request.'); return; }
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
  renderLeaveApprovals();
}

function approvalCard(r,type) {
  const isPending=r.status==='pending';
  let info='';
  if (type==='compoff') info='<strong>'+r.employee+'</strong> — '+r.type+' on '+fmtDate(r.request_date)+(r.related_activity?' ('+r.related_activity+')':'');
  else info='<strong>'+r.employee+'</strong> — '+fmtDate(r.start_date)+' to '+fmtDate(r.end_date)+' ('+r.working_days+' days)'+(r.reason?' | '+r.reason:'');
  return '<div class="request-card '+r.status+'" style="margin-bottom:10px">'+
    '<div style="display:flex;justify-content:space-between;align-items:flex-start">'+
    '<div style="font-size:13px">'+info+'<br><span style="font-size:11px;color:var(--muted)">Submitted: '+fmtDate(r.created_at)+'</span></div>'+
    '<div style="display:flex;align-items:center;gap:8px">'+
    '<span class="badge badge-'+r.status+'">'+statusIcon(r.status)+' '+cap(r.status)+'</span>'+
    (isPending?'<button class="btn btn-sm btn-primary" onclick="openApproveModal(\''+type+'\','+r.id+',\''+r.employee+'\')">Review</button>':'')+
    (type==='leave'?'<button class="btn btn-sm btn-ghost" onclick="openEditLeaveModal('+r.id+')" title="Edit request">✏️</button>':'')+
    '<button class="btn btn-sm btn-danger" onclick="deleteRequest(\''+type+'\','+r.id+')" title="Delete request">✕</button>'+
    '</div></div>'+
    (r.manager_comment?'<div style="font-size:12px;color:var(--muted);margin-top:8px">💬 '+r.manager_comment+'</div>':'')+
    '</div>';
}

function openApproveModal(type,id,employee) {
  approveTarget={type,id,employee};
  document.getElementById('approve-modal-title').textContent='Review '+cap(type==='compoff'?'Comp Off':'Leave')+' Request';
  document.getElementById('approve-modal-info').textContent='Employee: '+employee;
  document.getElementById('approve-comment').value='';
  document.getElementById('approve-modal').classList.add('show');
}

function closeApproveModal() {
  document.getElementById('approve-modal').classList.remove('show');
  approveTarget=null;
}

async function deleteRequest(type, id) {
  if (!confirm('Delete this request permanently? This cannot be undone.')) return;
  const table = type==='compoff' ? 'comp_off_requests' : 'leave_requests';
  const {error} = await sb.from(table).delete().eq('id', id);
  if (error) { alert('Error: '+error.message); return; }
  if (type==='compoff') renderCompOffApprovals();
  else renderLeaveApprovals();
}

async function processRequest(decision) {
  if (!approveTarget) return;
  const {type,id,employee}=approveTarget;
  const comment=document.getElementById('approve-comment').value.trim();

  // OT sessions live in their own table — just update status
  if (type==='ot') {
    const {error}=await sb.from('ot_sessions').update({
      status:decision,manager_comment:comment,reviewed_by:currentUser,reviewed_at:new Date().toISOString()
    }).eq('id',id);
    if (error){alert('Error: '+error.message);return;}
    closeApproveModal(); updateNotifBadge(); renderOTApprovals(); return;
  }

  const table=type==='compoff'?'comp_off_requests':'leave_requests';
  const {error}=await sb.from(table).update({
    status:decision,manager_comment:comment,reviewed_by:currentUser,reviewed_at:new Date().toISOString()
  }).eq('id',id);
  if (error){alert('Error: '+error.message);return;}

  // If approved, insert into actual records table
  if (decision==='approved') {
    if (type==='compoff') {
      const {data}=await sb.from('comp_off_requests').select('*').eq('id',id).single();
      if (data) await sb.from('comp_off_register').insert({
        employee:data.employee,date_taken:data.request_date,type:data.type,
        days:data.days,approved_by:currentUser,remarks:data.remarks||''
      });
    } else {
      const {data}=await sb.from('leave_requests').select('*').eq('id',id).single();
      if (data) await sb.from('annual_leave').insert({
        employee:data.employee,start_date:data.start_date,end_date:data.end_date,
        working_days:data.working_days,reason:data.reason||'',approved_by:currentUser,leave_type:data.leave_type||'annual'
      });
    }
  }

  closeApproveModal();
  updateNotifBadge();
  if (type==='compoff') renderCompOffApprovals();
  else renderLeaveApprovals();
}

// == EXPORT CSV ====================================================
