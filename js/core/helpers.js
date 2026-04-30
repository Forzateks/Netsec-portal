// == HELPERS =======================================================
function showAlert(id){
  const el=document.getElementById(id);
  if(!el) return false;
  el.classList.add('show');
  setTimeout(function(){el.classList.remove('show');},3500);
  return true;
}
function fmtDate(str){if(!str)return '';const s=str.split('T')[0].split('-');return s[2]+'/'+s[1]+'/'+s[0];}
function r2(n){return Math.round((n||0)*100)/100;}
function cap(s){return s?s.charAt(0).toUpperCase()+s.slice(1):'';}
function statusIcon(s){return s==='approved'?'✅':s==='rejected'?'❌':'🟡';}
function esc2(s){return (s||'').replace(/'/g,"\\'").replace(/"/g,'&quot;');}



// == WEEKLY BACKUP ================================================
function checkBackupReminder() {
  if (!isManager) return;
  const last = parseInt(localStorage.getItem('gulfit_last_backup')||'0');
  const sevenDays = 7*24*60*60*1000;
  if (Date.now() - last > sevenDays) {
    const banner = document.getElementById('backup-banner');
    if (banner) banner.style.display='flex';
  }
}

function dismissBackup() {
  const banner = document.getElementById('backup-banner');
  if (banner) banner.style.display='none';
  localStorage.setItem('gulfit_last_backup_dismissed', Date.now().toString());
}

async function downloadBackup(btnEl) {
  const btn = btnEl || document.querySelector('#backup-banner button');
  if (!btn) return;
  btn.textContent = '⏳ Preparing...';
  btn.disabled = true;

  try {
    // Fetch all data
    const [
      {data:otSessions},
      {data:compoffReg},
      {data:compoffReqs},
      {data:leaveReg},
      {data:leaveReqs},
      {data:projSessions}
    ] = await Promise.all([
      sb.from('ot_sessions').select('*').order('ot_date',{ascending:false}),
      sb.from('comp_off_register').select('*').order('date_taken',{ascending:false}),
      sb.from('comp_off_requests').select('*').order('created_at',{ascending:false}),
      sb.from('annual_leave').select('*').order('start_date',{ascending:false}),
      sb.from('leave_requests').select('*').order('created_at',{ascending:false}),
      sb.from('project_sessions').select('*').order('session_date',{ascending:false})
    ]);

    // Build CSV sections
    function toCSV(headers, rows) {
      const all = [headers].concat(rows);
      return all.map(function(r){ return r.map(function(v){ return '"'+(v==null?'':v)+'"'; }).join(','); }).join('\n');
    }

    const sections = [
      { name:'OT_Sessions', csv: toCSV(
        ['Employee','Activity','Date','Day','Start','End','Duration(h)','Band','Rate','Credited(h)'],
        (otSessions||[]).map(function(r){return [r.employee,r.activity,r.ot_date,r.day_name,r.start_time,r.end_time,r.duration_hours,r.band,r.rate,r.credited_hours];})
      )},
      { name:'CompOff_Register', csv: toCSV(
        ['Employee','Date Taken','Type','Days','Approved By','Remarks'],
        (compoffReg||[]).map(function(r){return [r.employee,r.date_taken,r.type,r.days,r.approved_by,r.remarks];})
      )},
      { name:'CompOff_Requests', csv: toCSV(
        ['Employee','Request Date','Type','Days','Status','Manager Comment','Reviewed By'],
        (compoffReqs||[]).map(function(r){return [r.employee,r.request_date,r.type,r.days,r.status,r.manager_comment,r.reviewed_by];})
      )},
      { name:'Annual_Leave', csv: toCSV(
        ['Employee','Start Date','End Date','Working Days','Reason','Approved By'],
        (leaveReg||[]).map(function(r){return [r.employee,r.start_date,r.end_date,r.working_days,r.reason,r.approved_by];})
      )},
      { name:'Leave_Requests', csv: toCSV(
        ['Employee','Start Date','End Date','Days','Status','Manager Comment','Reviewed By'],
        (leaveReqs||[]).map(function(r){return [r.employee,r.start_date,r.end_date,r.working_days,r.status,r.manager_comment,r.reviewed_by];})
      )},
      { name:'Project_Sessions', csv: toCSV(
        ['Project','Date','Activity','Session Info','Start','End','Duration(h)','Mode','Team','Stake Holders','Remarks','Logged By'],
        (projSessions||[]).map(function(r){return [r.project_name,r.session_date,r.activity_type,r.session_info,r.start_time,r.end_time,r.duration_hours,r.onsite_remote,r.team_members,r.stake_holders,r.remarks,r.logged_by];})
      )}
    ];

    // Combine all sections into one CSV with headers
    const today = new Date().toLocaleDateString('en-GB').replace(/\//g,'-');
    let fullCsv = 'NetSec Portal — Full Data Backup — ' + today + '\n\n';
    sections.forEach(function(s) {
      fullCsv += '=== ' + s.name + ' ===\n' + s.csv + '\n\n';
    });

    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(fullCsv);
    a.download = 'GulfIT_Portal_Backup_' + today + '.csv';
    a.click();

    // Save backup timestamp
    localStorage.setItem('gulfit_last_backup', Date.now().toString());
    const banner = document.getElementById('backup-banner');
    if (banner) banner.style.display='none';
    btn.textContent = '✅ Downloaded!';
    setTimeout(function(){ btn.textContent='💾 Download Backup Now'; btn.disabled=false; }, 2000);

  } catch(e) {
    btn.textContent = '❌ Error';
    btn.disabled = false;
    alert('Backup failed: ' + e.message);
  }
}

