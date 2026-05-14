// == OT APPROVALS ==================================================

function clearOTApprovalFilters() {
  ['ot-app-emp','ot-app-from','ot-app-to','ot-app-status'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  renderOTApprovals();
}

function populateOTApprovalEmpFilter() {
  var sel = document.getElementById('ot-app-emp');
  if (!sel || sel.options.length > 1) return;
  EMPLOYEES.forEach(function(e){
    var o = document.createElement('option'); o.value = o.textContent = e; sel.appendChild(o);
  });
}

async function renderOTApprovals() {
  populateOTApprovalEmpFilter();
  document.getElementById('ot-approvals-load').style.display='flex';
  document.getElementById('ot-approvals-content').innerHTML='';

  var fEmp    = (document.getElementById('ot-app-emp')||{}).value || '';
  var fFrom   = (document.getElementById('ot-app-from')||{}).value || '';
  var fTo     = (document.getElementById('ot-app-to')||{}).value || '';
  var fStatus = (document.getElementById('ot-app-status')||{}).value || '';

  var q = sb.from('ot_sessions').select('*').order('ot_date',{ascending:false});
  if (fEmp)    q = q.eq('employee', fEmp);
  if (fFrom)   q = q.gte('ot_date', fFrom);
  if (fTo)     q = q.lte('ot_date', fTo);
  if (fStatus) q = q.eq('status', fStatus);

  const {data,error}=await q;
  document.getElementById('ot-approvals-load').style.display='none';
  if (error||!data||!data.length){
    document.getElementById('ot-approvals-content').innerHTML = renderEmptyState({
      icon: 'clock',
      heading: 'No OT sessions match the filters',
      sub: 'Adjust the filters above, or check back when the team submits new OT requests.'
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }
  const pending=data.filter(function(r){return r.status==='pending';});
  const others =data.filter(function(r){return r.status!=='pending';});
  let html='';
  if (pending.length){
    html+='<h3 style="font-size:14px;font-weight:600;color:var(--navy);margin-bottom:12px">🟡 Pending Approval ('+pending.length+')</h3>';
    html+=pending.map(function(r){return otApprovalCard(r);}).join('');
  }
  if (others.length){
    html+='<h3 style="font-size:14px;font-weight:600;color:var(--muted);margin:20px 0 12px">History ('+others.length+')</h3>';
    html+=others.map(function(r){return otApprovalCard(r);}).join('');
  }
  document.getElementById('ot-approvals-content').innerHTML=html;
}

function otApprovalCard(r) {
  var isPending=r.status==='pending';
  var st=r.status||'approved';
  var info='<strong>'+r.employee+'</strong> — '+esc2(r.activity)+'<br>'+
    '<span style="font-size:12px;color:var(--muted)">'+fmtDate(r.ot_date)+' ('+r.day_name+') &nbsp;·&nbsp; '+
    fmtTime(r.start_time)+'–'+fmtTime(r.end_time)+' &nbsp;·&nbsp; '+fmtHours(r.duration_hours)+' &nbsp;·&nbsp; '+
    bandBadge(r)+' &nbsp; '+r.rate+' &nbsp;·&nbsp; Credited: <strong>'+fmtHours(r.credited_hours)+'</strong>'+creditDriftMarker(r)+'</span>';
  return '<div class="request-card '+st+'" style="margin-bottom:10px">'+
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">'+
    '<div style="font-size:13px;line-height:1.6">'+info+
    '<br><span style="font-size:11px;color:var(--muted)" title="'+relativeTimeTitle(r.created_at)+'">Submitted '+relativeTime(r.created_at)+'</span></div>'+
    '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">'+
    '<span class="badge badge-'+st+'">'+statusIcon(st)+' '+cap(st)+'</span>'+
    (isPending?'<button class="btn btn-sm btn-primary" onclick="openApproveModal(\'ot\','+r.id+',\''+r.employee+'\')">Review</button>':'')+
    '</div></div>'+
    (r.manager_comment?'<div style="font-size:12px;color:var(--muted);margin-top:8px">💬 '+esc2(r.manager_comment)+'</div>':'')+
    '</div>';
}

