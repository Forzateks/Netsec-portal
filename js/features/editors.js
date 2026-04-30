// == EDIT OT SESSION ==============================================
var _editEmp = '';
function openEditOT(id,emp,activity,date,start,end,customer,project,actType) {
  _editEmp = emp;
  document.getElementById('edit-ot-id').value      = id;
  document.getElementById('edit-ot-activity').value = activity;
  document.getElementById('edit-ot-date').value     = date;
  document.getElementById('edit-ot-start').value    = start;
  document.getElementById('edit-ot-end').value      = end;
  // Refresh selects in case data has changed
  fillCustomerSelect('edit-ot-customer', false);
  fillActivitySelect('edit-ot-activity-type');
  document.getElementById('edit-ot-customer').value = customer || '';
  fillProjectSelect('edit-ot-project', customer || '', false);
  document.getElementById('edit-ot-project').value = project || '';
  document.getElementById('edit-ot-activity-type').value = actType || '';
  updateEditPreview();
  document.getElementById('edit-ot-modal').classList.add('show');
}
function closeEditOT() { document.getElementById('edit-ot-modal').classList.remove('show'); }
function updateEditPreview() {
  var date=document.getElementById('edit-ot-date').value;
  var start=document.getElementById('edit-ot-start').value;
  var end=document.getElementById('edit-ot-end').value;
  if (date) {
    var d=new Date(date);
    document.getElementById('edit-ot-day').value=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
  }
  if (!date||!start||!end) return;
  var res=calcOT(date,start,end,_editEmp);
  if (!res) return;
  document.getElementById('edit-prev-band').textContent=res.band;
  document.getElementById('edit-prev-dur').textContent=res.duration+'h';
  document.getElementById('edit-prev-rate').textContent=res.rate;
  document.getElementById('edit-prev-cred').textContent=res.credited+'h';
}
async function saveEditOT() {
  var id=document.getElementById('edit-ot-id').value;
  var customer=document.getElementById('edit-ot-customer').value;
  var project=document.getElementById('edit-ot-project').value;
  var actType=document.getElementById('edit-ot-activity-type').value;
  var activity=document.getElementById('edit-ot-activity').value.trim();
  var date=document.getElementById('edit-ot-date').value;
  var start=document.getElementById('edit-ot-start').value;
  var end=document.getElementById('edit-ot-end').value;
  if (!activity||!date||!start||!end){alert('Please fill all required fields.');return;}
  var vErr = validateOTStart(date, start, _editEmp, end);
  if (vErr) { alert(vErr); return; }
  var res=calcOT(date,start,end,_editEmp);
  var {error}=await sb.from('ot_sessions').update({
    activity:activity,ot_date:date,start_time:start,end_time:end,
    day_name:res.dayName,band:res.band,rate:res.rate,
    duration_hours:res.duration,credited_hours:res.credited,
    customer_name:customer||null,project_name:project||null,activity_type:actType||null
  }).eq('id',id);
  if (error){alert('Error: '+error.message);return;}
  closeEditOT(); renderSessions();
}

// == EDIT PROJECT SESSION =========================================
function openEditPJ(id,proj,date,act,info,start,end,mode,stk,team,customer) {
  document.getElementById('edit-pj-id').value=id;
  document.getElementById('edit-pj-date').value=date;
  document.getElementById('edit-pj-info').value=info||'';
  document.getElementById('edit-pj-start').value=start||'';
  document.getElementById('edit-pj-end').value=end||'';
  document.getElementById('edit-pj-mode').value=mode||'';
  document.getElementById('edit-pj-stakeholders').value=stk||'';
  document.getElementById('edit-pj-team').value=team||'';
  // Customer + project (filtered by customer)
  var custVal = customer || PROJECT_CUSTOMER[proj] || '';
  fillCustomerSelect('edit-pj-customer', false);
  document.getElementById('edit-pj-customer').value = custVal;
  fillProjectSelect('edit-pj-project', custVal, false);
  document.getElementById('edit-pj-project').value = proj;
  // Activity type
  fillActivitySelect('edit-pj-activity');
  document.getElementById('edit-pj-activity').value = act || '';
  calcEditPjDuration();
  document.getElementById('edit-pj-modal').classList.add('show');
}
function closeEditPJ() { document.getElementById('edit-pj-modal').classList.remove('show'); }
function calcEditPjDuration() {
  var s=document.getElementById('edit-pj-start').value;
  var e=document.getElementById('edit-pj-end').value;
  if (!s||!e) return;
  var sp=s.split(':').map(Number);var ep=e.split(':').map(Number);
  var sf=sp[0]+sp[1]/60;var ef=ep[0]+ep[1]/60;
  document.getElementById('edit-pj-duration').value=r2(ef<sf?ef+24-sf:ef-sf)+' hrs';
}
async function saveEditPJ() {
  var id=document.getElementById('edit-pj-id').value;
  var customer=document.getElementById('edit-pj-customer').value;
  var proj=document.getElementById('edit-pj-project').value;
  var date=document.getElementById('edit-pj-date').value;
  var act=document.getElementById('edit-pj-activity').value;
  var info=document.getElementById('edit-pj-info').value.trim();
  var start=document.getElementById('edit-pj-start').value;
  var end=document.getElementById('edit-pj-end').value;
  var mode=document.getElementById('edit-pj-mode').value;
  var stk=document.getElementById('edit-pj-stakeholders').value.trim();
  var team=document.getElementById('edit-pj-team').value.trim();
  var dur=0;
  if (start&&end){var sp=start.split(':').map(Number);var ep=end.split(':').map(Number);var sf=sp[0]+sp[1]/60;var ef=ep[0]+ep[1]/60;dur=r2(ef<sf?ef+24-sf:ef-sf);}
  var {error}=await sb.from('project_sessions').update({
    project_name:proj,customer_name:customer||null,session_date:date,activity_type:act,session_info:info,
    start_time:start||null,end_time:end||null,duration_hours:dur,
    onsite_remote:mode||null,stake_holders:stk||null,team_members:team
  }).eq('id',id);
  if (error){alert('Error: '+error.message);return;}
  closeEditPJ(); renderPjSessions();
}

// == MONTHLY OT REPORT ============================================
async function downloadMonthlyReport() {
  var btn=document.getElementById('monthly-report-btn');
  if (btn){btn.disabled=true;btn.textContent='⏳ Generating...';}
  var now=new Date();
  var reportYear=now.getMonth()===0?now.getFullYear()-1:now.getFullYear();
  var reportMonth=now.getMonth()===0?12:now.getMonth();
  var monthStr=String(reportMonth).padStart(2,'0');
  var MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  var monthName=MONTHS[reportMonth-1];
  var startDate=reportYear+'-'+monthStr+'-01';
  var lastDay=new Date(reportYear,reportMonth,0).getDate();
  var endDate=reportYear+'-'+monthStr+'-'+String(lastDay).padStart(2,'0');
  var [{data:sessions},{data:compoffs}]=await Promise.all([
    sb.from('ot_sessions').select('*').gte('ot_date',startDate).lte('ot_date',endDate).order('employee').order('ot_date'),
    sb.from('comp_off_register').select('*')
  ]);
  var rows=sessions||[];
  var today=new Date().toLocaleDateString('en-GB');
  var csv='NetSec Portal - Monthly OT Report\n';
  csv+='Period: '+monthName+' '+reportYear+'\n';
  csv+='Generated: '+today+'\n\n';
  csv+='=== OT SESSIONS ===\n';
  csv+='"Employee","Date","Day","Activity","Start","End","Duration(h)","Band","Rate","Credited(h)"\n';
  rows.forEach(function(r){
    csv+='"'+r.employee+'","'+fmtDate(r.ot_date)+'","'+(r.day_name||'')+'","'+(r.activity||'').replace(/"/g,"'")+
         '","'+(r.start_time||'')+'","'+(r.end_time||'')+'",'+r.duration_hours+',"'+r.band+'","'+r.rate+'",'+r.credited_hours+'\n';
  });
  csv+='\n=== EMPLOYEE SUMMARY ===\n';
  csv+='"Employee","Sessions","Eve Cred","Early Cred","Mid 1:2","Wknd 1:2","CO Earned","Balance"\n';
  EMPLOYEES.forEach(function(emp){
    var s=calcSummary(rows,compoffs||[],emp);
    if (s.sessions>0) csv+='"'+emp+'",'+s.sessions+','+r2(s.eveCred)+','+r2(s.earlyCred)+','+r2(s.mid12)+','+r2(s.wk12)+','+s.totalCO+','+s.balance+'\n';
  });
  var totalCredited=rows.reduce(function(s,r){return s+parseFloat(r.credited_hours||0);},0);
  csv+='\nTotal Sessions: '+rows.length+'\nTotal Credited Hours: '+r2(totalCredited)+'\n';
  var a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='GulfIT_OT_Report_'+monthName+'_'+reportYear+'.csv'; a.click();
  if (btn){btn.disabled=false;btn.innerHTML='📁„ Monthly OT Report';}
}

