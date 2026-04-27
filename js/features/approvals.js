// â•â• OT APPROVALS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function renderOTApprovals() {
  document.getElementById('ot-approvals-load').style.display='flex';
  document.getElementById('ot-approvals-content').innerHTML='';
  const {data,error}=await sb.from('ot_sessions').select('*').order('ot_date',{ascending:false});
  document.getElementById('ot-approvals-load').style.display='none';
  if (error||!data||!data.length){
    document.getElementById('ot-approvals-content').innerHTML='<div class="empty-state"><div class="empty-icon">â±</div><div class="empty-title">No OT sessions</div></div>';
    return;
  }
  const pending=data.filter(function(r){return r.status==='pending';});
  const others =data.filter(function(r){return r.status!=='pending';});
  let html='';
  if (pending.length){
    html+='<h3 style="font-size:14px;font-weight:600;color:var(--navy);margin-bottom:12px">ðŸŸ¡ Pending Approval ('+pending.length+')</h3>';
    html+=pending.map(function(r){return otApprovalCard(r);}).join('');
  }
  if (others.length){
    html+='<h3 style="font-size:14px;font-weight:600;color:var(--muted);margin:20px 0 12px">History</h3>';
    html+=others.map(function(r){return otApprovalCard(r);}).join('');
  }
  document.getElementById('ot-approvals-content').innerHTML=html;
}

function otApprovalCard(r) {
  var isPending=r.status==='pending';
  var st=r.status||'approved';
  var info='<strong>'+r.employee+'</strong> â€” '+esc2(r.activity)+'<br>'+
    '<span style="font-size:12px;color:var(--muted)">'+fmtDate(r.ot_date)+' ('+r.day_name+') &nbsp;Â·&nbsp; '+
    r.start_time+'â€“'+r.end_time+' &nbsp;Â·&nbsp; '+r.duration_hours+'h &nbsp;Â·&nbsp; '+
    '<span class="badge badge-'+r.band+'">'+r.band+'</span> &nbsp; '+r.rate+' &nbsp;Â·&nbsp; Credited: <strong>'+r.credited_hours+'h</strong></span>';
  return '<div class="request-card '+st+'" style="margin-bottom:10px">'+
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">'+
    '<div style="font-size:13px;line-height:1.6">'+info+
    '<br><span style="font-size:11px;color:var(--muted)">Submitted: '+fmtDate(r.created_at)+'</span></div>'+
    '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">'+
    '<span class="badge badge-'+st+'">'+statusIcon(st)+' '+cap(st)+'</span>'+
    (isPending?'<button class="btn btn-sm btn-primary" onclick="openApproveModal(\'ot\','+r.id+',\''+r.employee+'\')">Review</button>':'')+
    '</div></div>'+
    (r.manager_comment?'<div style="font-size:12px;color:var(--muted);margin-top:8px">ðŸ’¬ '+esc2(r.manager_comment)+'</div>':'')+
    '</div>';
}

