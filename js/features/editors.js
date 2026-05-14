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
  document.getElementById('edit-prev-dur').textContent=fmtHours(res.duration);
  document.getElementById('edit-prev-rate').textContent=res.rate;
  document.getElementById('edit-prev-cred').textContent=fmtHours(res.credited);
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
  if (!activity||!date||!start||!end){showError('Please fill all required fields.');return;}
  var vErr = validateOTStart(date, start, _editEmp, end);
  if (vErr) { showError(vErr); return; }
  var res=calcOT(date,start,end,_editEmp);
  var {error}=await sb.from('ot_sessions').update({
    activity:activity,ot_date:date,start_time:start,end_time:end,
    day_name:res.dayName,band:res.band,rate:res.rate,
    duration_hours:res.duration,credited_hours:res.credited,
    customer_name:customer||null,project_name:project||null,activity_type:actType||null
  }).eq('id',id);
  if (error){showError('Error: '+error.message);return;}
  closeEditOT();
  showToast('OT session updated ✓');
  renderSessions();
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
  if (btn){btn.disabled=false;btn.innerHTML='<i data-lucide="file-text" class="btn-icon"></i>Monthly OT Report'; if (typeof renderIcons === 'function') renderIcons();}
}

