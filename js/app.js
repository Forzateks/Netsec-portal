// ══ CONFIG ═══════════════════════════════════════════════════════
const SUPABASE_URL = 'https://rxxcrlobbtlvjgcqgjjm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4eGNybG9iYnRsdmpnY3FnamptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MzczNzEsImV4cCI6MjA5MDUxMzM3MX0.egC7GkqozxJ8IUbsL3RaHcyE4spGVOwmt2t9s082QSE';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// EMPLOYEES list is now derived from user_profiles at login (manager filters etc.)
// Fallback used until profiles load — ordered to match historical data.
let EMPLOYEES = ['Ahmed Ali','Venkatesan','Prasanth','Salman Aziz','Mohammed Afsal','Mohammed Nasif'];
const KSA_EMP   = ['Salman Aziz','Mohammed Afsal'];
const LEAVE_ALLOWANCE = 22;
const SICK_ALLOWANCE  = 15;

let currentUser = '';
let currentEmail = '';
let isManager   = false;
let approveTarget = null;
let USER_PROFILES = []; // [{user_id, email, employee_name, is_manager}]

// ══ AUTH (Supabase) ══════════════════════════════════════════════
function showLoginError(msg) {
  const e = document.getElementById('login-error');
  e.textContent = '❌ ' + msg;
  e.style.display = 'block'; e.style.background='#FEE2E2'; e.style.color='#B91C1C';
  e.style.padding='10px'; e.style.borderRadius='8px'; e.style.fontSize='13px';
  e.style.marginBottom='12px'; e.style.textAlign='center';
  setTimeout(function(){ e.style.display = 'none'; }, 5000);
}

function showLoginSuccess(msg) {
  const e = document.getElementById('login-success');
  e.textContent = '✅ ' + msg;
  e.style.display = 'block';
  setTimeout(function(){ e.style.display = 'none'; }, 6000);
}

function showSigninForm() {
  document.getElementById('login-form-signin').style.display='block';
  document.getElementById('login-form-forgot').style.display='none';
  document.getElementById('login-form-reset').style.display='none';
  document.getElementById('login-sub').textContent = 'Sign in to continue';
}
function showForgotForm() {
  document.getElementById('login-form-signin').style.display='none';
  document.getElementById('login-form-forgot').style.display='block';
  document.getElementById('login-form-reset').style.display='none';
  document.getElementById('login-sub').textContent = 'Forgot your password?';
}
function showResetForm() {
  document.getElementById('login-form-signin').style.display='none';
  document.getElementById('login-form-forgot').style.display='none';
  document.getElementById('login-form-reset').style.display='block';
  document.getElementById('login-sub').textContent = 'Set a new password';
}

async function doLogin() {
  const email    = (document.getElementById('login-email').value||'').trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const remember = document.getElementById('login-remember').checked;
  if (!email || !password) { showLoginError('Please enter email and password.'); return; }

  const {data, error} = await sb.auth.signInWithPassword({ email: email, password: password });
  if (error) { showLoginError(error.message || 'Sign in failed.'); return; }
  if (!data || !data.user) { showLoginError('Sign in failed.'); return; }

  // If "Remember me" is unchecked, sign out when window closes.
  // (Supabase persists by default; this opt-out gives session-scope behavior.)
  if (!remember) {
    window.addEventListener('beforeunload', function(){ sb.auth.signOut(); });
  }

  await initAppFromUser(data.user);
}

async function doForgot() {
  const email = (document.getElementById('forgot-email').value||'').trim().toLowerCase();
  if (!email) { showLoginError('Please enter your email.'); return; }
  const redirectTo = window.location.origin + window.location.pathname;
  const {error} = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo });
  if (error) { showLoginError(error.message || 'Could not send reset link.'); return; }
  showLoginSuccess('Reset link sent. Check your email inbox.');
  setTimeout(showSigninForm, 1500);
}

async function doResetPassword() {
  const p1 = document.getElementById('reset-password').value;
  const p2 = document.getElementById('reset-password2').value;
  if (p1.length < 8) { showLoginError('Password must be at least 8 characters.'); return; }
  if (p1 !== p2)     { showLoginError('Passwords do not match.'); return; }
  const {error} = await sb.auth.updateUser({ password: p1 });
  if (error) { showLoginError(error.message || 'Could not update password.'); return; }
  showLoginSuccess('Password set! Signing you in...');
  // After updateUser the session is already active — go straight in.
  const {data} = await sb.auth.getUser();
  if (data && data.user) {
    setTimeout(function(){ initAppFromUser(data.user); }, 800);
  }
}

async function doLogout() {
  await sb.auth.signOut();
  currentUser = ''; currentEmail = ''; isManager = false;
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
  showSigninForm();
}

// Look up the user_profiles row for the signed-in user
async function fetchUserProfile(authUser) {
  const {data, error} = await sb.from('user_profiles')
    .select('user_id,email,employee_name,is_manager')
    .or('user_id.eq.'+authUser.id+',email.eq.'+authUser.email).limit(1);
  if (error || !data || !data.length) return null;
  return data[0];
}

// Load all profiles for the EMPLOYEES list
async function loadAllProfiles() {
  const {data} = await sb.from('user_profiles').select('user_id,email,employee_name,is_manager').order('employee_name');
  if (data && data.length) {
    USER_PROFILES = data;
    EMPLOYEES = data.map(function(p){ return p.employee_name; });
  }
}

async function initAppFromUser(authUser) {
  const profile = await fetchUserProfile(authUser);
  if (!profile) {
    showLoginError('Your account is not set up yet. Ask the manager to add your profile.');
    await sb.auth.signOut();
    return;
  }
  currentUser  = profile.employee_name;
  currentEmail = profile.email || authUser.email;
  isManager    = !!profile.is_manager;
  await loadAllProfiles();
  initApp(currentUser);
}

function initApp(user) {

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  // Set header
  document.getElementById('header-username').textContent = user;
  const rb = document.getElementById('header-role-badge');
  rb.textContent = isManager ? 'Manager' : 'Employee';
  rb.className = 'role-badge ' + (isManager ? 'manager' : 'employee');

  // Set log-employee field
  document.getElementById('log-employee').value = user;
  document.getElementById('log-date').value = new Date().toISOString().split('T')[0];

  // Show/hide manager elements
  document.getElementById('otsub-manager').style.display = isManager ? '' : 'none';
  document.getElementById('tab-approvals').style.display  = isManager ? '' : 'none';
  // Team overview visible to all employees

  // Manager can filter employees; employees cannot
  document.querySelectorAll('.manager-only-el').forEach(function(el) {
    el.style.display = isManager ? '' : 'none';
  });

  checkConnection();
  updatePreview();
  loadProjects(); // load projects from Supabase into PROJECTS array
  showScreen('dashboard');
  if (isManager) updateNotifBadge();
}

// ══ CONNECTION CHECK ══════════════════════════════════════════════
async function checkConnection() {
  try {
    const { error } = await sb.from('ot_sessions').select('id').limit(1);
    if (error) throw error;
    document.getElementById('db-dot').classList.add('connected');
    document.getElementById('db-status-text').textContent = 'Connected';
  } catch(e) {
    document.getElementById('db-status-text').textContent = 'DB error';
  }
}

// ══ OT CALCULATION ENGINE ════════════════════════════════════════
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
    return 'OT cannot start between 7:30 AM and 6:30 PM on weekdays — these are regular working hours. OT must begin before 7:30 AM or after 6:30 PM.';
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

// ══ SUMMARY CALC ═════════════════════════════════════════════════
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

// ══ LIVE PREVIEW ═════════════════════════════════════════════════
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

// ══ SAVE SESSION ═════════════════════════════════════════════════
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

// ══ RENDER SESSIONS ══════════════════════════════════════════════
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
    '<td style="white-space:nowrap">'+((isManager||s.employee===currentUser)?'<button class="btn btn-sm btn-ghost" onclick="openEditOT('+s.id+',\''+s.employee+'\',\''+esc2(s.activity)+'\',\''+s.ot_date+'\',\''+s.start_time+'\',\''+s.end_time+'\',\''+esc2(s.customer_name||'')+'\',\''+esc2(s.project_name||'')+'\',\''+esc2(s.activity_type||'')+'\')" style="margin-right:4px">✏️</button>':'')+(isManager?'<button class="btn btn-sm btn-danger" onclick="deleteSession('+s.id+')">✕</button>':'')+'</td></tr>';
  }).join('');
  window._sessionsData=data;
}

async function deleteSession(id) {
  if (!confirm('Delete this session?')) return;
  await sb.from('ot_sessions').delete().eq('id',id);
  renderSessions();
}

// ══ RENDER SUMMARY ════════════════════════════════════════════════
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

// ══ COMP OFF REQUESTS ════════════════════════════════════════════
async function submitCompOffRequest() {
  const date=document.getElementById('co-date').value;
  const type=document.getElementById('co-type').value;
  const activity=document.getElementById('co-activity').value.trim();
  const remarks=document.getElementById('co-remarks').value.trim();
  if (!date||!type){showAlert('co-error');return;}

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

// ══ LEAVE REQUESTS (Annual + Sick) ═══════════════════════════════
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

  document.getElementById('lv-prev-type').textContent = isSick ? '🤒 Sick' : '🏖️ Annual';

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
  btn.disabled=false; btn.innerHTML='📤 Submit Request';
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
    document.getElementById('lv-hist-content').innerHTML='<div class="empty-state"><div class="empty-icon">🏖️</div><div class="empty-title">No leave requests yet</div></div>';
    return;
  }
  document.getElementById('lv-hist-content').innerHTML=data.map(function(r){
    var ltIcon  = (r.leave_type||'annual')==='sick' ? '🤒 Sick Leave' : '🏖️ Annual Leave';
    var ltColor = (r.leave_type||'annual')==='sick' ? '#8B5CF6' : 'var(--teal)';
    return '<div class="request-card '+r.status+'">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">'+
      '<div><strong>'+r.employee+'</strong> <span style="font-size:11px;font-weight:600;color:'+ltColor+'">'+ltIcon+'</span><br>'+
      '<span style="font-family:DM Mono,monospace;font-size:13px">'+fmtDate(r.start_date)+' → '+fmtDate(r.end_date)+'</span><br>'+
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

// ══ MANAGER VIEW ═════════════════════════════════════════════════
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

// ══ APPROVALS (MANAGER) ══════════════════════════════════════════
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

async function renderLeaveApprovals() {
  document.getElementById('lv-approvals-load').style.display='flex';
  document.getElementById('lv-approvals-content').innerHTML='';
  const {data}=await sb.from('leave_requests').select('*').order('created_at',{ascending:false});
  document.getElementById('lv-approvals-load').style.display='none';
  if (!data||!data.length){
    document.getElementById('lv-approvals-content').innerHTML='<div class="empty-state"><div class="empty-icon">🏖️</div><div class="empty-title">No leave requests</div></div>';
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
    html+='<h3 style="font-size:14px;font-weight:600;color:var(--muted);margin:20px 0 12px">History</h3>';
    html+=others.map(function(r){return approvalCard(r,'leave');}).join('');
  }
  document.getElementById('lv-approvals-content').innerHTML=html;
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

// ══ EXPORT CSV ════════════════════════════════════════════════════
function exportCSV() {
  const data=window._sessionsData||[];
  if (!data.length) return;
  const rows=[['Employee','Activity','Date','Day','Start','End','Duration','Band','Rate','Credited']];
  data.forEach(function(s){rows.push([s.employee,s.activity,s.ot_date,s.day_name,s.start_time,s.end_time,s.duration_hours,s.band,s.rate,s.credited_hours]);});
  const csv=rows.map(function(r){return r.map(function(v){return '"'+(v||'')+'"';}).join(',');}).join('\n');
  const a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='Gulfit_OT_Sessions.csv'; a.click();
}

// ══ DASHBOARD ════════════════════════════════════════════════════
async function renderDashboard() {
  document.getElementById('dash-content').innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';
  var year  = new Date().getFullYear().toString();
  var month = new Date().toISOString().slice(0,7);
  var monthName = new Date().toLocaleString('default',{month:'long'});

  var results = await Promise.all([
    sb.from('ot_sessions').select('*').eq('employee',currentUser),
    sb.from('comp_off_register').select('*').eq('employee',currentUser),
    sb.from('comp_off_requests').select('*').eq('employee',currentUser).order('created_at',{ascending:false}),
    sb.from('leave_requests').select('*').eq('employee',currentUser).order('created_at',{ascending:false}),
    sb.from('annual_leave').select('working_days').eq('employee',currentUser).gte('start_date',year+'-01-01').lte('start_date',year+'-12-31'),
    sb.from('project_sessions').select('duration_hours,team_members').gte('session_date',month+'-01').lte('session_date',month+'-31'),
  ]);
  var sessions=results[0].data, compoffs=results[1].data, coReqs=results[2].data;
  var lvReqs=results[3].data, alData=results[4].data, pjSess=results[5].data;

  var s = calcSummary(sessions||[], compoffs||[], currentUser);
  var leaveUsed = (alData||[]).reduce(function(a,r){return a+parseFloat(r.working_days||0);},0);
  var leaveBalance = LEAVE_ALLOWANCE - leaveUsed;
  var otThisMonth = (sessions||[]).filter(function(x){return (x.ot_date||'').startsWith(month) && (x.status==='approved'||!x.status);}).length;
  var pjHrsMonth = 0;
  (pjSess||[]).forEach(function(r){
    var fn = currentUser.split(' ')[0].toLowerCase();
    if((r.team_members||'').toLowerCase().includes(fn)) pjHrsMonth += parseFloat(r.duration_hours||0);
  });

  var recent = (sessions||[]).filter(function(x){return x.status==='approved'||!x.status;}).sort(function(a,b){return a.ot_date>b.ot_date?-1:1;}).slice(0,5);
  var pendingCO = (coReqs||[]).filter(function(r){return r.status==='pending';});
  var pendingLV = (lvReqs||[]).filter(function(r){return r.status==='pending';});
  var pendingOT = (sessions||[]).filter(function(r){return r.status==='pending';});
  var balColor  = s.balance>0?'var(--success)':s.balance<0?'var(--danger)':'var(--navy)';
  var lvColor   = leaveBalance<=5?'var(--danger)':leaveBalance<=10?'var(--gold)':'var(--success)';
  var hr = new Date().getHours();
  var greet = hr<12?'Good morning':hr<17?'Good afternoon':'Good evening';

  var html = '<div style="margin-bottom:20px"><h2 style="font-size:20px;font-weight:700;color:var(--navy)">'+greet+', '+currentUser.split(' ')[0]+' 👋</h2>'+
    '<div style="font-size:13px;color:var(--muted)">Here\'s your overview</div></div>';

  html += '<div class="summary-grid" style="margin-bottom:20px">'+
    '<div class="stat-card green"><div class="stat-label">CO Balance</div><div class="stat-value" style="color:'+balColor+'">'+s.balance+'</div><div class="stat-sub">Earned: '+s.totalCO+' | Used: '+s.used+'</div></div>'+
    '<div class="stat-card teal"><div class="stat-label">Leave Remaining</div><div class="stat-value" style="color:'+lvColor+'">'+leaveBalance+'</div><div class="stat-sub">of '+LEAVE_ALLOWANCE+' days ('+year+')</div></div>'+
    '<div class="stat-card navy"><div class="stat-label">OT Sessions ('+monthName+')</div><div class="stat-value">'+otThisMonth+'</div><div class="stat-sub">sessions this month</div></div>'+
    '<div class="stat-card eve"><div class="stat-label">Project Hrs ('+monthName+')</div><div class="stat-value" style="font-size:20px">'+r2(pjHrsMonth)+'h</div><div class="stat-sub">this month</div></div>'+
    '</div>';

  html += '<div class="card" style="margin-bottom:20px"><div class="card-title">Quick Actions</div>'+
    '<div class="quick-actions-wrap">'+
    '<button class="btn btn-primary" onclick="showScreen(\'overtime\');showOTTab(\'log\')">➕ Log OT</button>'+
    '<button class="btn btn-ghost" onclick="showScreen(\'leave\');showLeaveTab(\'log\')">🏖️ Request Leave</button>'+
    '<button class="btn btn-ghost" onclick="showScreen(\'overtime\');showOTTab(\'compoff\')">🗓 Comp Off</button>'+
    '<button class="btn btn-ghost" onclick="showScreen(\'projects\');showProjectTab(\'log\')">📁 Log Project Session</button>'+
    (isManager?'<button id="monthly-report-btn" class="btn btn-ghost" onclick="downloadMonthlyReport()">📄 Monthly OT Report</button>':'')+
    (isManager?'<button class="btn btn-ghost" onclick="showScreen(\'approvals\')">🔔 Approvals</button>':'')+
    '</div></div>';

  if (pendingCO.length || pendingLV.length || pendingOT.length) {
    html += '<div class="card" style="margin-bottom:20px;border-left:4px solid var(--gold)"><div class="card-title">⏳ My Pending Requests</div>';
    pendingOT.forEach(function(r){ html += '<div class="request-card pending" style="margin-bottom:8px">⏱ OT Session — '+r.activity+' on '+fmtDate(r.ot_date)+' ('+r.band+' '+r.duration_hours+'h)<span class="badge badge-pending" style="margin-left:8px">Awaiting Approval</span></div>'; });
    pendingCO.forEach(function(r){ html += '<div class="request-card pending" style="margin-bottom:8px">🗓 Comp Off — '+r.type+' on '+fmtDate(r.request_date)+'<span class="badge badge-pending" style="margin-left:8px">Pending</span></div>'; });
    pendingLV.forEach(function(r){ html += '<div class="request-card pending" style="margin-bottom:8px">🏖️ Leave — '+fmtDate(r.start_date)+' → '+fmtDate(r.end_date)+' ('+r.working_days+' days)<span class="badge badge-pending" style="margin-left:8px">Pending</span></div>'; });
    html += '</div>';
  }

  html += '<div class="card" style="margin-bottom:20px"><div class="flex-between mb-4">'+
    '<div class="card-title" style="margin-bottom:0">Recent OT Sessions</div>'+
    '<button class="btn btn-sm btn-ghost" onclick="showScreen(\'overtime\');showOTTab(\'sessions\')">View All →</button></div>';
  if (recent.length) {
    html += '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Activity</th><th>Band</th><th>Rate</th><th>Credited</th></tr></thead><tbody>';
    recent.forEach(function(r){
      html += '<tr><td style="font-size:12px">'+fmtDate(r.ot_date)+'</td>'+
        '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+r.activity+'</td>'+
        '<td><span class="badge badge-'+r.band+'">'+r.band+'</span></td>'+
        '<td><span class="badge '+(r.rate==='1:2'?'badge-12':'badge-11')+'">'+r.rate+'</span></td>'+
        '<td><strong style="color:var(--teal)">'+r.credited_hours+'h</strong></td></tr>';
    });
    html += '</tbody></table></div>';
  } else { html += '<div class="empty-state" style="padding:16px"><div class="empty-icon">📭</div><div class="empty-title">No OT sessions yet</div></div>'; }
  html += '</div>';

  if (isManager) {
    var approvalResults = await Promise.all([
      sb.from('comp_off_requests').select('id').eq('status','pending'),
      sb.from('leave_requests').select('id').eq('status','pending')
    ]);
    var total = (approvalResults[0].data||[]).length + (approvalResults[1].data||[]).length;
    if (total>0) {
      html += '<div class="card" style="border-left:4px solid var(--gold)"><div class="flex-between">'+
        '<div><div class="card-title" style="margin-bottom:4px">🔔 '+total+' Pending Approvals</div>'+
        '<div style="font-size:13px;color:var(--muted)">'+(approvalResults[0].data||[]).length+' comp off · '+(approvalResults[1].data||[]).length+' leave requests</div></div>'+
        '<button class="btn btn-primary" onclick="showScreen(\'approvals\')">Review →</button></div></div>';
    }
  }

  document.getElementById('dash-content').innerHTML = html;
}

// ══ EDIT OT SESSION ══════════════════════════════════════════════
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
  var vErr = validateOTStart(date, start, _editEmp);
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

// ══ EDIT PROJECT SESSION ═════════════════════════════════════════
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

// ══ MONTHLY OT REPORT ════════════════════════════════════════════
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
  if (btn){btn.disabled=false;btn.innerHTML='📄 Monthly OT Report';}
}

// ══ NAVIGATION ════════════════════════════════════════════════════
function showOTTab(tab) {
  ['log','sessions','summary','compoff','manager','policy'].forEach(function(t) {
    const el=document.getElementById('ottab-'+t);
    const sub=document.getElementById('otsub-'+t);
    if (!el) return;
    el.style.display=t===tab?'block':'none';
    if (!sub) return;
    // Always keep manager tab hidden for non-managers regardless of cssText changes
    if (t==='manager' && !isManager) { sub.style.display='none'; return; }
    if (t===tab){sub.classList.add('active');sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid var(--teal);color:var(--navy);white-space:nowrap';}
    else{sub.classList.remove('active');sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);white-space:nowrap';}
  });
  if (tab==='log')      populateProjectDropdowns();
  if (tab==='summary')  buildSummaryFilters();
  if (tab==='sessions') renderSessions();
  if (tab==='compoff')  { renderMyCompOffRequests(); }
  if (tab==='manager')  renderManager();
}

function showLeaveTab(tab) {
  ['log','history','team'].forEach(function(t) {
    const el=document.getElementById('ltab-'+t);
    const sub=document.getElementById('lsub-'+t);
    if (!el) return;
    el.style.display=t===tab?'block':'none';
    if (!sub) return;
    if (t===tab){sub.classList.add('active');sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid var(--teal);color:var(--navy);white-space:nowrap';}
    else{sub.classList.remove('active');sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);white-space:nowrap';}
  });
  if (tab==='history') renderLeaveHistory();
  if (tab==='team')    renderLeaveTeam();
}

function showApprovalsTab(tab) {
  ['compoff','leave','ot'].forEach(function(t) {
    document.getElementById('apptab-'+t).style.display=t===tab?'block':'none';
    const sub=document.getElementById('appsub-'+t);
    if (t===tab){sub.classList.add('active');sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid var(--teal);color:var(--navy);white-space:nowrap';}
    else{sub.classList.remove('active');sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);white-space:nowrap';}
  });
  if (tab==='compoff') renderCompOffApprovals();
  else if (tab==='leave') renderLeaveApprovals();
  else if (tab==='ot') renderOTApprovals();
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(s){s.classList.remove('active');});
  document.querySelectorAll('.nav-tab').forEach(function(t){t.classList.remove('active');});
  document.getElementById('screen-'+name).classList.add('active');
  document.getElementById('tab-'+name).classList.add('active');
  if (name==='dashboard') renderDashboard();
  if (name==='overtime')  showOTTab('log');
  if (name==='leave')     showLeaveTab('log');
  if (name==='projects')  { initProjectTab(); showProjectTab('log'); };
  if (name==='approvals')  showApprovalsTab('compoff');
  if (name==='inventory')  showInventoryTab('devices');
  if (name==='kb')         showKBTab('browse');
}

// ══ HELPERS ═══════════════════════════════════════════════════════
function showAlert(id){const el=document.getElementById(id);el.classList.add('show');setTimeout(function(){el.classList.remove('show');},3500);}
function fmtDate(str){if(!str)return '';const s=str.split('T')[0].split('-');return s[2]+'/'+s[1]+'/'+s[0];}
function r2(n){return Math.round((n||0)*100)/100;}
function cap(s){return s?s.charAt(0).toUpperCase()+s.slice(1):'';}
function statusIcon(s){return s==='approved'?'✅':s==='rejected'?'❌':'🟡';}
function esc2(s){return (s||'').replace(/'/g,"\\'").replace(/"/g,'&quot;');}



// ══ WEEKLY BACKUP ════════════════════════════════════════════════
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

async function downloadBackup() {
  const btn = event.target;
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

// ══ PROJECTS MODULE ══════════════════════════════════════════════
// Projects loaded dynamically from Supabase (not hardcoded)
let PROJECTS = [
  'ABK','QDSBG','DH-NONCORP','MASHREQ-DCDR','MASHREQ-IBG','ADAA','NBO-MSOT',
  'ASIC','ARO-KSA','ENBD-OCI-KSA','ENBD-MIGRATION','ATMC-ASIC','QIDDIYA',
  'ENBD-MEYDAN','DUBAI-PETROLEUM','DUBAI-HOLDING','FAB-MISR','LANDMARK','RTA',
  'ASTER-OMAN','ASTER-DUBAI','FAB','MAGNATI-FISERV','ARO-DRILLING',
  'TAAGEER-FINANCE','DFM','NAIVAS','NAIVAS-PHASE2','ARABIAN-SHIELD',
  'DERAYA-FINANCE','MOH','QASSIM-UNIVERSITY','OLD-DUBAI-HOLDING',
  'OLD-MASHREQ','MASHREQ-IBG-OLD'
]; // fallback — overwritten by loadProjects()

let _projectsLoaded = false;

// Customer & project lookup
let CUSTOMERS = []; // [{id, name}]
let PROJECT_CUSTOMER = {}; // { projectName: customerName }

async function loadProjects() {
  const cRes = await sb.from('customers').select('id,name,status').order('name');
  if (!cRes.error && cRes.data) {
    CUSTOMERS = cRes.data.filter(function(c){ return c.status !== 'archived'; });
  }
  const {data, error} = await sb.from('projects').select('name,status,customer_id').order('name');
  if (!error && data && data.length) {
    PROJECTS = data.filter(function(p){ return p.status !== 'archived'; })
                   .map(function(p){ return p.name; });
    PROJECT_CUSTOMER = {};
    var byId = {}; CUSTOMERS.forEach(function(c){ byId[c.id] = c.name; });
    data.forEach(function(p){ if (p.customer_id) PROJECT_CUSTOMER[p.name] = byId[p.customer_id]; });
    _projectsLoaded = true;
  }
}

// Get projects under a given customer (by name). Empty customer -> all.
function projectsForCustomer(customerName) {
  if (!customerName) return PROJECTS.slice();
  return PROJECTS.filter(function(p){ return PROJECT_CUSTOMER[p] === customerName; });
}

// Populate a customer <select> by id
function fillCustomerSelect(selectId, includeAll) {
  var el = document.getElementById(selectId); if (!el) return;
  var cur = el.value;
  el.innerHTML = (includeAll ? '<option value="">All Customers</option>' : '<option value="">-- Select Customer --</option>')
    + CUSTOMERS.map(function(c){ return '<option>'+c.name+'</option>'; }).join('');
  if (cur) el.value = cur;
}

// Populate a project <select> filtered by a customer name
function fillProjectSelect(selectId, customerName, includeAll) {
  var el = document.getElementById(selectId); if (!el) return;
  var cur = el.value;
  var list = projectsForCustomer(customerName);
  el.innerHTML = (includeAll ? '<option value="">All Projects</option>' : '<option value="">-- Select Project --</option>')
    + list.map(function(p){ return '<option>'+p+'</option>'; }).join('');
  if (cur && list.indexOf(cur) >= 0) el.value = cur;
}

// ── ADD PROJECT ──────────────────────────────────────────────────
async function addProject() {
  const customer = document.getElementById('pj-new-customer').value;
  const name   = (document.getElementById('pj-new-name').value||'').trim().toUpperCase();
  const status = document.getElementById('pj-new-status').value;
  if (!customer) {
    document.getElementById('pj-manage-error').textContent = '⚠️ Please select a customer.';
    showAlert('pj-manage-error'); return;
  }
  if (!name) {
    document.getElementById('pj-manage-error').textContent = '⚠️ Please enter a project name.';
    showAlert('pj-manage-error'); return;
  }

  // Check duplicate
  if (PROJECTS.includes(name)) {
    document.getElementById('pj-manage-error').textContent = '⚠️ Project "'+name+'" already exists.';
    showAlert('pj-manage-error'); return;
  }

  // Look up customer id
  var custRow = CUSTOMERS.find(function(c){ return c.name === customer; });
  var customer_id = custRow ? custRow.id : null;

  const {error} = await sb.from('projects').insert({name:name, status:status, customer_id:customer_id});
  if (error) { alert('Error: '+error.message); return; }

  document.getElementById('pj-new-name').value = '';
  document.getElementById('pj-new-status').value = 'active';
  document.getElementById('pj-new-customer').value = '';
  showAlert('pj-manage-success');
  // Refresh dropdowns and list
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  renderManageProjects();
}

// ── UPDATE PROJECT STATUS ────────────────────────────────────────
async function updateProjectStatus(name, newStatus) {
  const {error} = await sb.from('projects').update({status: newStatus}).eq('name', name);
  if (error) { alert('Error: '+error.message); return; }
  _projectsLoaded = false;
  await loadProjects();
  populateProjectDropdowns();
  renderManageProjects();
}

// ── RENDER MANAGE PROJECTS LIST ──────────────────────────────────
async function renderManageProjects() {
  document.getElementById('pj-manage-loading').style.display = 'flex';
  document.getElementById('pj-manage-content').innerHTML = '';
  const filter = document.getElementById('pj-manage-filter').value;

  let q = sb.from('projects').select('*').order('name');
  if (filter) q = q.eq('status', filter);
  const {data} = await q;
  document.getElementById('pj-manage-loading').style.display = 'none';

  const rows = data || [];
  if (!rows.length) {
    document.getElementById('pj-manage-content').innerHTML =
      '<div class="empty-state"><div class="empty-icon">📁</div><div class="empty-title">No projects found</div></div>';
    return;
  }

  const STATUS_COLORS = {
    'active':    {bg:'#ECFDF5',color:'#059669',label:'🟢 Active'},
    'completed': {bg:'#EFF6FF',color:'#2563EB',label:'✅ Completed'},
    'on-hold':   {bg:'#FEF9C3',color:'#B45309',label:'⏸️ On Hold'},
    'archived':  {bg:'#F3F4F6',color:'#6B7280',label:'🗃️ Archived'},
  };

  document.getElementById('pj-manage-content').innerHTML =
    '<div class="table-wrap"><table>'+
    '<thead><tr><th>#</th><th>Project Name</th><th>Status</th><th>Change Status</th></tr></thead>'+
    '<tbody>'+
    rows.map(function(p,i){
      var sc = STATUS_COLORS[p.status] || STATUS_COLORS['active'];
      var opts = Object.keys(STATUS_COLORS)
        .filter(function(s){ return s !== p.status; })
        .map(function(s){
          return '<option value="'+s+'">'+STATUS_COLORS[s].label+'</option>';
        }).join('');
      return '<tr>'+
        '<td style="color:var(--muted);font-size:12px">'+(i+1)+'</td>'+
        '<td><strong>'+p.name+'</strong></td>'+
        '<td><span style="background:'+sc.bg+';color:'+sc.color+';padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600">'+sc.label+'</span></td>'+
        '<td>'+
          '<select onchange="updateProjectStatus(\''+p.name+'\',this.value)" style="width:auto;padding:5px 10px;font-size:12px">'+
          '<option value="">-- Change --</option>'+opts+
          '</select>'+
        '</td>'+
        '</tr>';
    }).join('')+
    '</tbody></table></div>';
}

// ── POPULATE ALL PROJECT DROPDOWNS ───────────────────────────────
function populateProjectDropdowns() {
  // Customer selects (forms + filters)
  fillCustomerSelect('pj-customer', false);
  fillCustomerSelect('pj-new-customer', false);
  fillCustomerSelect('log-customer', false);
  fillCustomerSelect('edit-ot-customer', false);
  fillCustomerSelect('edit-pj-customer', false);
  fillCustomerSelect('pj-filter-customer', true);

  // Project selects — log/OT forms start unfiltered (until user picks customer)
  fillProjectSelect('pj-project', '', false);
  fillProjectSelect('log-project', '', false);
  fillProjectSelect('edit-ot-project', '', false);
  fillProjectSelect('edit-pj-project', '', false);
  fillProjectSelect('pj-filter-project', '', true);

  // Activity type selects
  fillActivitySelect('pj-activity');
  fillActivitySelect('log-activity-type');
  fillActivitySelect('edit-pj-activity');
  fillActivitySelect('edit-ot-activity-type');
}

// Customer-change handlers — re-filter project dropdown to only that customer
function onPjCustomerChange() {
  fillProjectSelect('pj-project', document.getElementById('pj-customer').value, false);
}
function onLogCustomerChange() {
  fillProjectSelect('log-project', document.getElementById('log-customer').value, false);
}
function onEditOTCustomerChange() {
  fillProjectSelect('edit-ot-project', document.getElementById('edit-ot-customer').value, false);
}
function onEditPjCustomerChange() {
  fillProjectSelect('edit-pj-project', document.getElementById('edit-pj-customer').value, false);
}
function onPjFilterCustomerChange() {
  fillProjectSelect('pj-filter-project', document.getElementById('pj-filter-customer').value, true);
  renderPjSessions();
}

const ACTIVITY_TYPES = [
  'HLD Discussion','HLD Documentation','LLD Discussion','LLD Documentation',
  'Pilot Sites Rollout','As-Built Documentation','KT / Training','Migration',
  'Troubleshooting','Initial Configuration'
];

const DEVICE_MODELS = ['EC-XS','EC-SP','EC-M','EC-10104','EC-10106'];

function fillActivitySelect(selectId) {
  var el = document.getElementById(selectId); if (!el) return;
  var cur = el.value;
  el.innerHTML = '<option value="">-- Select --</option>'
    + ACTIVITY_TYPES.map(function(a){ return '<option>'+a+'</option>'; }).join('');
  if (cur) el.value = cur;
}

function initProjectTab() {
  // Show Manage Projects tab for manager only
  const manageTab = document.getElementById('pjsub-manage');
  if (manageTab) manageTab.style.display = isManager ? '' : 'none';

  // Populate project dropdowns
  populateProjectDropdowns();

  // Build team checkboxes
  const box = document.getElementById('pj-team-checkboxes');
  if (box && !box.children.length) {
    EMPLOYEES.forEach(function(emp) {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;font-weight:500;cursor:pointer;padding:6px 12px;border:1.5px solid var(--border);border-radius:20px;background:white;transition:all .15s';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = emp; cb.name = 'pj-team';
      cb.style.accentColor = 'var(--teal)';
      cb.onchange = function() {
        label.style.background = cb.checked ? '#E0F7FF' : 'white';
        label.style.borderColor = cb.checked ? 'var(--teal)' : 'var(--border)';
      };
      // Auto-check current user
      if (emp === currentUser) {
        cb.checked = true;
        label.style.background = '#E0F7FF';
        label.style.borderColor = 'var(--teal)';
      }
      label.appendChild(cb);
      // Show distinct short names — avoid two "Mohammed" labels
      const _shortNames = {
        'Ahmed Ali':'AHMED','Venkatesan':'VENKAT','Prasanth':'PRASANTH',
        'Salman Aziz':'SALMAN','Mohammed Afsal':'AFSAL','Mohammed Nasif':'NASIF'
      };
      const label_text = _shortNames[emp] || emp.split(' ')[0].toUpperCase();
      label.appendChild(document.createTextNode(label_text));
      box.appendChild(label);
    });
  }

  // Populate year selectors
  const currentYear = new Date().getFullYear();
  ['pj-sum-year','pj-emp-year'].forEach(function(id) {
    const el = document.getElementById(id);
    if (!el || el.options.length) return;
    // Add "All Years" as first option (default)
    const allOpt = document.createElement('option');
    allOpt.value = 'all'; allOpt.textContent = 'All Years'; allOpt.selected = true;
    el.appendChild(allOpt);
    for (let y = currentYear; y >= 2023; y--) {
      const o = document.createElement('option');
      o.value = y; o.textContent = y;
      el.appendChild(o);
    }
  });

  // Set today's date
  const dateEl = document.getElementById('pj-date');
  if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];
}

function calcPjDuration() {
  const start = document.getElementById('pj-start').value;
  const end   = document.getElementById('pj-end').value;
  if (!start || !end) return;
  const [sh,sm] = start.split(':').map(Number);
  const [eh,em] = end.split(':').map(Number);
  const sf = sh + sm/60, ef = eh + em/60;
  const dur = ef < sf ? ef + 24 - sf : ef - sf;
  document.getElementById('pj-duration').value = r2(dur) + ' hrs';
}

async function savePjSession() {
  const customer = document.getElementById('pj-customer').value;
  const proj     = document.getElementById('pj-project').value;
  const date     = document.getElementById('pj-date').value;
  const activity = document.getElementById('pj-activity').value;
  const info     = document.getElementById('pj-info').value.trim();
  const start    = document.getElementById('pj-start').value;
  const end      = document.getElementById('pj-end').value;
  const mode     = document.getElementById('pj-mode').value;
  const stakeH   = document.getElementById('pj-stakeholders').value.trim();
  const remarks  = document.getElementById('pj-remarks').value.trim();

  const teamChecks = document.querySelectorAll('#pj-team-checkboxes input[type=checkbox]:checked');
  const teamMembers = Array.from(teamChecks).map(function(c){return c.value;}).join(', ');

  if (!customer || !proj || !date || !activity || !info || !teamMembers) {
    showAlert('pj-error'); return;
  }

  // Calculate duration
  let duration = 0;
  if (start && end) {
    const [sh,sm] = start.split(':').map(Number);
    const [eh,em] = end.split(':').map(Number);
    const sf = sh+sm/60, ef = eh+em/60;
    duration = r2(ef < sf ? ef+24-sf : ef-sf);
  }

  const btn = document.getElementById('pj-save-btn');
  btn.disabled = true; btn.textContent = '⏳ Saving...';

  const {error} = await sb.from('project_sessions').insert({
    project_name: proj,
    customer_name: customer,
    session_date: date,
    activity_type: activity,
    session_info: info,
    start_time: start || null,
    end_time: end || null,
    duration_hours: duration,
    onsite_remote: mode || null,
    stake_holders: stakeH || null,
    team_members: teamMembers,
    remarks: remarks || null,
    logged_by: currentUser
  });

  btn.disabled = false; btn.innerHTML = '💾 Save Session';
  if (error) { alert('Error: ' + error.message); return; }
  showAlert('pj-success');

  // Reset form
  ['pj-customer','pj-project','pj-activity','pj-mode'].forEach(function(id){document.getElementById(id).value='';});
  ['pj-info','pj-start','pj-end','pj-duration','pj-stakeholders','pj-remarks'].forEach(function(id){document.getElementById(id).value='';});
  fillProjectSelect('pj-project', '', false);
  document.querySelectorAll('#pj-team-checkboxes input').forEach(function(cb){
    cb.checked = cb.value===currentUser;
    const lbl = cb.parentElement;
    lbl.style.background = cb.checked ? '#E0F7FF' : 'white';
    lbl.style.borderColor = cb.checked ? 'var(--teal)' : 'var(--border)';
  });
}

async function renderPjSessions() {
  document.getElementById('pj-sessions-loading').style.display='flex';
  document.getElementById('pj-sessions-table').style.display='none';
  document.getElementById('pj-sessions-empty').style.display='none';
  var topScroll = document.getElementById('pj-scroll-top');
  if (topScroll) topScroll.style.display='none';

  const custFilter   = document.getElementById('pj-filter-customer').value;
  const projFilter   = document.getElementById('pj-filter-project').value;
  const memberFilter = document.getElementById('pj-filter-member').value;
  const fromDate     = document.getElementById('pj-filter-from').value;
  const toDate       = document.getElementById('pj-filter-to').value;

  let q = sb.from('project_sessions').select('*').order('session_date',{ascending:false});
  if (projFilter) q = q.eq('project_name', projFilter);
  if (fromDate)   q = q.gte('session_date', fromDate);
  if (toDate)     q = q.lte('session_date', toDate);

  const {data} = await q;
  document.getElementById('pj-sessions-loading').style.display='none';

  let rows = data || [];
  // Customer filter (client-side: matches customer_name OR by mapped project_name)
  if (custFilter) {
    rows = rows.filter(function(r){
      if (r.customer_name) return r.customer_name === custFilter;
      return PROJECT_CUSTOMER[r.project_name] === custFilter;
    });
  }
  // Filter by team member (client-side since it's free text)
  if (memberFilter) {
    const firstName = memberFilter.split(' ')[0].toLowerCase();
    rows = rows.filter(function(r){ return (r.team_members||'').toLowerCase().includes(firstName); });
  }

  if (!rows.length) { document.getElementById('pj-sessions-empty').style.display='block'; return; }
  document.getElementById('pj-sessions-table').style.display='block';
  window._pjData = rows;

  document.getElementById('pj-sessions-tbody').innerHTML = rows.map(function(r,i){
    const canEdit = isManager || (r.logged_by===currentUser);
    var custDisplay = r.customer_name || PROJECT_CUSTOMER[r.project_name] || '—';
    return '<tr>' +
      '<td style="color:var(--muted)">'+(i+1)+'</td>'+
      '<td style="font-size:12px;color:var(--navy);font-weight:600">'+esc2(custDisplay)+'</td>'+
      '<td><strong style="color:var(--navy)">'+r.project_name+'</strong></td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px">'+fmtDate(r.session_date)+'</td>'+
      '<td><span class="badge" style="background:#f0f4ff;color:var(--navy)">'+(r.activity_type||'—')+'</span></td>'+
      '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px" title="'+(r.session_info||'')+'">'+( r.session_info||'—')+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:600;color:var(--teal)">'+( r.duration_hours||0)+'h</td>'+
      '<td style="font-size:12px;color:var(--muted)">'+(r.onsite_remote||'—')+'</td>'+
      '<td style="font-size:12px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+(r.team_members||'')+'">'+( r.team_members||'—')+'</td>'+
      '<td style="font-size:11px;color:var(--muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+( r.stake_holders||'—')+'</td>'+
      '<td>'+(canEdit ? '<button class="btn btn-sm btn-ghost" onclick="openEditPJ('+r.id+',\''+esc2(r.project_name)+'\',\''+r.session_date+'\',\''+esc2(r.activity_type)+'\',\''+esc2(r.session_info)+'\',\''+(r.start_time||'')+'\',\''+(r.end_time||'')+'\',\''+esc2(r.onsite_remote||'')+'\',\''+esc2(r.stake_holders||'')+'\',\''+esc2(r.team_members||'')+'\',\''+esc2(custDisplay==='—'?'':custDisplay)+'\')" style="margin-right:4px">✏️</button><button class="btn btn-sm btn-danger" onclick="deletePjSession('+r.id+')">✕</button>' : '')+'</td>'+
    '</tr>';
  }).join('');

  // Wire up top scroll mirror
  setTimeout(syncPjTopScroll, 50);
}

function syncPjTopScroll() {
  var top = document.getElementById('pj-scroll-top');
  var topInner = document.getElementById('pj-scroll-top-inner');
  var bottomWrap = document.querySelector('#pj-sessions-table');
  if (!top || !topInner || !bottomWrap) return;
  var table = bottomWrap.querySelector('table');
  if (!table) return;
  // Mirror the table width into the top scroller's inner div
  topInner.style.width = table.scrollWidth + 'px';
  top.style.display = 'block';
  // Two-way scroll sync (set up once)
  if (!top._wired) {
    top.addEventListener('scroll', function(){ bottomWrap.scrollLeft = top.scrollLeft; });
    bottomWrap.addEventListener('scroll', function(){ top.scrollLeft = bottomWrap.scrollLeft; });
    top._wired = true;
  }
}

function clearPjFilters() {
  ['pj-filter-customer','pj-filter-project','pj-filter-member','pj-filter-from','pj-filter-to'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  fillProjectSelect('pj-filter-project', '', true);
  renderPjSessions();
}

async function deletePjSession(id) {
  if (!confirm('Delete this session?')) return;
  await sb.from('project_sessions').delete().eq('id', id);
  renderPjSessions();
}

async function renderPjProjectSummary() {
  document.getElementById('pj-project-loading').style.display='flex';
  document.getElementById('pj-project-content').innerHTML='';
  const year = document.getElementById('pj-sum-year').value || 'all';

  let q = sb.from('project_sessions').select('*');
  if (year !== 'all') {
    q = q.gte('session_date', year+'-01-01').lte('session_date', year+'-12-31');
  }
  const {data} = await q;
  document.getElementById('pj-project-loading').style.display='none';

  const rows = data || [];
  if (!rows.length) {
    document.getElementById('pj-project-content').innerHTML='<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">No sessions for '+year+'</div></div>';
    return;
  }

  // Group by project
  const byProject = {};
  rows.forEach(function(r) {
    if (!byProject[r.project_name]) byProject[r.project_name] = {sessions:0, hours:0, members:{}};
    byProject[r.project_name].sessions++;
    byProject[r.project_name].hours += parseFloat(r.duration_hours||0);
    // Split team members
    (r.team_members||'').split(',').forEach(function(m) {
      const name = m.trim();
      if (name) byProject[r.project_name].members[name] = (byProject[r.project_name].members[name]||0) + parseFloat(r.duration_hours||0);
    });
  });

  // Sort by hours desc
  const sorted = Object.keys(byProject).sort(function(a,b){ return byProject[b].hours - byProject[a].hours; });

  const tableRows = sorted.map(function(proj) {
    const d = byProject[proj];
    const memberBreakdown = Object.keys(d.members).map(function(m){
      return '<span class="badge" style="background:#f0f4ff;color:var(--navy);margin:1px">'+m.split(' ')[0]+': '+r2(d.members[m])+'h</span>';
    }).join(' ');
    return '<tr>'+
      '<td><strong>'+proj+'</strong></td>'+
      '<td style="font-family:DM Mono,monospace;font-size:13px">'+d.sessions+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal);font-size:15px">'+r2(d.hours)+'h</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:12px;color:var(--muted)">'+r2(d.hours/8)+' days</td>'+
      '<td style="font-size:12px">'+memberBreakdown+'</td>'+
    '</tr>';
  }).join('');

  // Build pie chart data — top 8 projects by hours
  var PIE_COLORS = ['#0A1F5C','#00A0D2','#C8A832','#3B82F6','#10B981','#8B5CF6','#F59E0B','#EF4444'];
  var pieData = sorted.slice(0,8).map(function(proj,i) {
    return {label:proj, value:byProject[proj].hours, color:PIE_COLORS[i%PIE_COLORS.length]};
  });

  document.getElementById('pj-project-content').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">'+
    '<div class="card" style="margin-bottom:0"><div class="card-title">Hours by Project (Top 8)</div>'+
    buildPieChart(pieData,'h')+
    '</div>'+
    '<div class="card" style="margin-bottom:0"><div class="card-title">Quick Stats</div>'+
    '<div class="summary-grid">'+
    '<div class="stat-card navy"><div class="stat-label">Total Projects</div><div class="stat-value">'+sorted.length+'</div></div>'+
    '<div class="stat-card teal"><div class="stat-label">Total Hours</div><div class="stat-value" style="font-size:20px">'+r2(sorted.reduce(function(s,p){return s+byProject[p].hours;},0))+'h</div></div>'+
    '<div class="stat-card eve"><div class="stat-label">Total Sessions</div><div class="stat-value">'+sorted.reduce(function(s,p){return s+byProject[p].sessions;},0)+'</div></div>'+
    '</div></div></div>'+
    '<div class="table-wrap"><table>'+
    '<thead><tr><th>Project</th><th>Sessions</th><th>Total Hours</th><th>Working Days</th><th>Team Breakdown</th></tr></thead>'+
    '<tbody>'+tableRows+'</tbody></table></div>'+
    '<div style="margin-top:12px;font-size:12px;color:var(--muted)">Year: '+(year==='all'?'All Years':year)+' | * Working days = hours ÷ 8</div>';
}

async function renderPjEmployeeSummary() {
  document.getElementById('pj-employee-loading').style.display='flex';
  document.getElementById('pj-employee-content').innerHTML='';
  const year = document.getElementById('pj-emp-year').value || 'all';

  let q = sb.from('project_sessions').select('*');
  if (year !== 'all') {
    q = q.gte('session_date', year+'-01-01').lte('session_date', year+'-12-31');
  }
  const {data} = await q;
  document.getElementById('pj-employee-loading').style.display='none';

  const rows = data || [];

  // Build per-employee totals
  const empData = {};
  EMPLOYEES.forEach(function(e){ empData[e] = {hours:0, sessions:0, projects:{}}; });

  rows.forEach(function(r) {
    (r.team_members||'').split(',').forEach(function(m) {
      const name = m.trim();
      // Match against known employees — exact match first, then first-name fallback
      EMPLOYEES.forEach(function(emp) {
        const firstName = emp.split(' ')[0].toLowerCase();
        const nameLower = name.toLowerCase();
        // Exact full name match OR first name match
        if (nameLower === emp.toLowerCase() || nameLower === firstName) {
          empData[emp].hours += parseFloat(r.duration_hours||0);
          empData[emp].sessions++;
          empData[emp].projects[r.project_name] = (empData[emp].projects[r.project_name]||0) + parseFloat(r.duration_hours||0);
        }
      });
    });
  });

  const tableRows = EMPLOYEES.map(function(emp) {
    const d = empData[emp];
    const projCount = Object.keys(d.projects).length;
    const topProjects = Object.keys(d.projects)
      .sort(function(a,b){ return d.projects[b]-d.projects[a]; })
      .slice(0,3)
      .map(function(p){ return p+' ('+r2(d.projects[p])+'h)'; })
      .join(', ');
    return '<tr>'+
      '<td><strong>'+emp+'</strong></td>'+
      '<td style="font-family:DM Mono,monospace;font-size:13px">'+d.sessions+'</td>'+
      '<td style="font-family:DM Mono,monospace;font-weight:700;color:var(--teal);font-size:16px">'+r2(d.hours)+'h</td>'+
      '<td style="font-family:DM Mono,monospace;font-size:13px;color:var(--muted)">'+r2(d.hours/8)+' days</td>'+
      '<td style="font-size:12px;color:var(--muted)">'+projCount+' projects</td>'+
      '<td style="font-size:11px;color:var(--muted)">'+( topProjects||'—')+'</td>'+
    '</tr>';
  }).join('');

  // Total row
  const totalHours = EMPLOYEES.reduce(function(s,e){ return s+empData[e].hours; },0);

  document.getElementById('pj-employee-content').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">'+
    '<div class="card" style="margin-bottom:0"><div class="card-title">Hours Distribution</div>'+
    buildPieChart(EMPLOYEES.map(function(e){ return {label:empShortName(e),value:empData[e].hours,color:empColor(e)}; }).filter(function(d){return d.value>0;}),'h')+
    '</div>'+
    '<div class="card" style="margin-bottom:0"><div class="card-title">Sessions Distribution</div>'+
    buildPieChart(EMPLOYEES.map(function(e){ return {label:empShortName(e),value:empData[e].sessions,color:empColor(e)}; }).filter(function(d){return d.value>0;}),'')+
    '</div></div>'+
    '<div class="table-wrap"><table>'+
    '<thead><tr><th>Employee</th><th>Sessions</th><th>Total Hours</th><th>Working Days</th><th>Projects</th><th>Top Projects</th></tr></thead>'+
    '<tbody>'+tableRows+
    '<tr style="background:#f8fafc;font-weight:600"><td>TOTAL</td><td>—</td>'+
    '<td style="font-family:DM Mono,monospace;color:var(--navy);font-size:16px">'+r2(totalHours)+'h</td>'+
    '<td style="font-family:DM Mono,monospace;color:var(--muted)">'+r2(totalHours/8)+'</td><td>—</td><td>—</td></tr>'+
    '</tbody></table></div>'+
    '<div style="margin-top:12px;font-size:12px;color:var(--muted)">Year: '+(year==='all'?'All Years':year)+' | Working days = hours ÷ 8</div>';
}

// ── PIE CHART HELPERS ────────────────────────────────────────────
function empShortName(emp) {
  var parts = emp.split(' ');
  if (parts.length > 2) return parts[parts.length-1]; // Last name for Mohammed X
  return parts[0]; // First name for others
}

function empColor(emp) {
  var colors = {
    'Ahmed Ali':      '#3B82F6',
    'Venkatesan':     '#0A1F5C',
    'Prasanth':       '#10B981',
    'Salman Aziz':    '#F59E0B',
    'Mohammed Afsal': '#8B5CF6',
    'Mohammed Nasif': '#00A0D2',
  };
  return colors[emp] || '#6B7280';
}

function buildPieChart(data, unit) {
  if (!data.length) return '<div style="text-align:center;color:var(--muted);padding:20px">No data</div>';
  var total = data.reduce(function(s,d){ return s+d.value; }, 0);
  if (total === 0) return '<div style="text-align:center;color:var(--muted);padding:20px">No data</div>';

  var cx=120, cy=120, r=100, html='';
  var startAngle = -Math.PI/2; // Start from top

  // SVG slices
  html += '<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">';
  html += '<svg viewBox="0 0 240 240" style="width:200px;height:200px;flex-shrink:0">';

  data.forEach(function(d) {
    var slice = (d.value / total) * 2 * Math.PI;
    var endAngle = startAngle + slice;
    var x1 = cx + r * Math.cos(startAngle);
    var y1 = cy + r * Math.sin(startAngle);
    var x2 = cx + r * Math.cos(endAngle);
    var y2 = cy + r * Math.sin(endAngle);
    var largeArc = slice > Math.PI ? 1 : 0;

    if (data.length === 1) {
      // Full circle
      html += '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="'+d.color+'"/>';
    } else {
      html += '<path d="M'+cx+','+cy+' L'+x1.toFixed(2)+','+y1.toFixed(2)+
              ' A'+r+','+r+' 0 '+largeArc+',1 '+x2.toFixed(2)+','+y2.toFixed(2)+
              ' Z" fill="'+d.color+'" stroke="white" stroke-width="2"/>';
    }

    // Percentage label inside slice
    var midAngle = startAngle + slice/2;
    var lx = cx + (r*0.65) * Math.cos(midAngle);
    var ly = cy + (r*0.65) * Math.sin(midAngle);
    var pct = Math.round(d.value/total*100);
    if (pct >= 5) {
      html += '<text x="'+lx.toFixed(1)+'" y="'+ly.toFixed(1)+'" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="11" font-weight="bold" font-family="DM Sans,Arial">'+pct+'%</text>';
    }
    startAngle = endAngle;
  });

  html += '</svg>';

  // Legend
  html += '<div style="display:flex;flex-direction:column;gap:8px">';
  data.forEach(function(d) {
    var pct = Math.round(d.value/total*100);
    html += '<div style="display:flex;align-items:center;gap:8px">'+
      '<div style="width:12px;height:12px;border-radius:3px;background:'+d.color+';flex-shrink:0"></div>'+
      '<div style="font-size:12px"><span style="font-weight:600">'+d.label+'</span> '+
      '<span style="color:var(--muted)">'+r2(d.value)+(unit||'')+' ('+pct+'%)</span></div>'+
      '</div>';
  });
  html += '</div></div>';
  return html;
}

function exportPjCSV() {
  const data = window._pjData||[];
  if (!data.length) return;
  const rows=[['Project','Date','Activity','Session Info','Start','End','Duration(h)','Mode','Team Members','Stake Holders','Remarks','Logged By']];
  data.forEach(function(r){ rows.push([r.project_name,r.session_date,r.activity_type,r.session_info,r.start_time,r.end_time,r.duration_hours,r.onsite_remote,r.team_members,r.stake_holders,r.remarks,r.logged_by]); });
  const csv=rows.map(function(r){return r.map(function(v){return '"'+(v||'')+'"';}).join(',');}).join('\n');
  const a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='GulfIT_Project_Sessions.csv'; a.click();
}

function showProjectTab(tab) {
  ['log','sessions','project','employee','manage'].forEach(function(t) {
    const el  = document.getElementById('pjtab-'+t);
    const sub = document.getElementById('pjsub-'+t);
    if (!el) return;
    el.style.display = t===tab ? 'block' : 'none';
    if (!sub) return;
    if (t===tab) {
      sub.classList.add('active');
      sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid var(--teal);color:var(--navy);white-space:nowrap';
    } else {
      sub.classList.remove('active');
      sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);white-space:nowrap';
    }
  });
  if (tab==='log')      initProjectTab();
  if (tab==='sessions') { initProjectTab(); renderPjSessions(); }
  if (tab==='project')  { initProjectTab(); renderPjProjectSummary(); }
  if (tab==='employee') { initProjectTab(); renderPjEmployeeSummary(); }
  if (tab==='manage')   { populateProjectDropdowns(); renderManageProjects(); }
}

// ══ INVENTORY MODULE ══════════════════════════════════════════════

var _invData   = [];
var _invEditId = null;

function showInventoryTab(tab) {
  ['devices','add','log'].forEach(function(t) {
    var el  = document.getElementById('invtab-'+t);
    var sub = document.getElementById('invsub-'+t);
    if (!el) return;
    el.style.display = (t === tab) ? 'block' : 'none';
    if (!sub) return;
    if (t === tab) { sub.classList.add('active'); }
    else           { sub.classList.remove('active'); }
  });
  if (tab === 'devices') loadInventory();
  if (tab === 'add')     resetAddDeviceForm();
  if (tab === 'log')     loadActivityLog();
}

async function loadInventory() {
  var wrap = document.getElementById('inv-table-wrap');
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div>Loading inventory...</div>';
  var res = await sb.from('inventory').select('*').order('id');
  if (res.error) {
    wrap.innerHTML = '<div class="alert alert-error show">Error: '+res.error.message+'</div>';
    return;
  }
  _invData = res.data || [];
  renderInventoryStats(_invData);
  renderInventoryTable(_invData);
}

function renderInventoryStats(data) {
  var el       = document.getElementById('inv-stats');
  var total    = data.length;
  var available = data.filter(function(d) {
    var s = (d.availability_status||'').toLowerCase();
    return s.includes('available') && !s.includes('locked');
  }).length;
  var locked   = data.filter(function(d) {
    return (d.availability_status||'').toLowerCase().includes('locked');
  }).length;
  var ids      = data.filter(function(d) { return d.ids_ps === 'IDS Capable'; }).length;
  var locs     = new Set(data.map(function(d) { return d.current_location; }).filter(Boolean));

  el.innerHTML =
    '<div class="stat-card teal"><div class="stat-label">Total Devices</div><div class="stat-value">'+total+'</div></div>'+
    '<div class="stat-card early"><div class="stat-label">Available</div><div class="stat-value">'+available+'</div></div>'+
    '<div class="stat-card wknd"><div class="stat-label">Locked</div><div class="stat-value">'+locked+'</div></div>'+
    '<div class="stat-card eve"><div class="stat-label">IDS Capable</div><div class="stat-value">'+ids+'</div></div>'+
    '<div class="stat-card navy"><div class="stat-label">Countries</div><div class="stat-value">'+locs.size+'</div></div>';
}

function invStatusClass(status) {
  var s = (status||'').toLowerCase();
  if (s.includes('locked'))    return 'inv-status-locked';
  if (s.includes('available')) return 'inv-status-available';
  if (s === '' || s === '—')   return 'inv-status-default';
  return 'inv-status-unavailable';
}

function applyInventoryFilters() {
  var search  = (document.getElementById('inv-search').value||'').toLowerCase();
  var modelF  = document.getElementById('inv-filter-model').value;
  var locF    = document.getElementById('inv-filter-location').value;
  var statusF = document.getElementById('inv-filter-status').value;

  var filtered = _invData.filter(function(d) {
    var matchSearch = !search ||
      (d.serial_number||'').toLowerCase().includes(search) ||
      (d.current_location||'').toLowerCase().includes(search) ||
      (d.current_partner||'').toLowerCase().includes(search) ||
      (d.current_end_user||'').toLowerCase().includes(search) ||
      (d.remarks||'').toLowerCase().includes(search);
    var matchModel  = !modelF  || d.model_no === modelF;
    var matchLoc    = !locF    || d.current_location === locF;
    var matchStatus = !statusF || (d.availability_status||'').toLowerCase().includes(statusF);
    return matchSearch && matchModel && matchLoc && matchStatus;
  });
  renderInventoryTable(filtered);
}

function renderInventoryTable(data) {
  var wrap = document.getElementById('inv-table-wrap');
  if (!data.length) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-title">No devices found</div><div>Try adjusting your filters</div></div>';
    return;
  }
  var rows = '';
  data.forEach(function(d, i) {
    var sc = invStatusClass(d.availability_status);
    rows += '<tr>'+
      '<td style="font-size:11px;color:var(--muted);font-weight:600">'+(i+1)+'</td>'+
      '<td style="font-family:\'DM Mono\',monospace;font-size:12px;font-weight:600">'+esc2(d.serial_number||'')+'</td>'+
      '<td>'+esc2(d.model_no||'—')+'</td>'+
      '<td><span class="badge '+sc+'">'+esc2(d.availability_status||'—')+'</span></td>'+
      '<td class="hide-mobile">'+esc2(d.current_location||'—')+'</td>'+
      '<td class="hide-mobile">'+esc2(d.current_partner||'—')+'</td>'+
      '<td class="hide-mobile">'+esc2(d.current_end_user||'—')+'</td>'+
      '<td class="hide-mobile">'+esc2(d.ids_ps||'—')+'</td>'+
      '<td class="hide-mobile" style="font-size:11px;color:var(--muted);line-height:1.3">'+esc2(d.last_updated_by||'—')+'<br><span style="font-size:10px">'+(d.updated_at?new Date(d.updated_at).toLocaleDateString():'')+'</span></td>'+
      '<td>'+
        '<div style="display:flex;gap:6px">'+
        '<button class="btn btn-sm btn-ghost" onclick="openEditDeviceModal('+d.id+')">✏️ Edit</button>'+
        (isManager ? '<button class="btn btn-sm btn-danger" onclick="deleteDevice('+d.id+',\''+esc2(d.serial_number||'')+'\')">🗑</button>' : '')+
        '</div>'+
      '</td>'+
    '</tr>';
  });

  wrap.innerHTML =
    '<div class="table-wrap"><table>'+
    '<thead><tr>'+
    '<th>#</th><th>Serial No.</th><th>Model</th><th>Status</th>'+
    '<th class="hide-mobile">Location</th><th class="hide-mobile">Partner</th>'+
    '<th class="hide-mobile">End User</th><th class="hide-mobile">IDS/PS</th>'+
    '<th class="hide-mobile">Last Updated</th><th>Actions</th>'+
    '</tr></thead>'+
    '<tbody>'+rows+'</tbody>'+
    '</table></div>';
}

function resetAddDeviceForm() {
  ['inv-add-serial','inv-add-model','inv-add-status','inv-add-rail','inv-add-ids',
   'inv-add-location','inv-add-partner','inv-add-enduser','inv-add-prevlocation',
   'inv-add-auditloc','inv-add-version','inv-add-remarks','inv-add-auditdate'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
}

async function saveNewDevice() {
  var serial = document.getElementById('inv-add-serial').value.trim();
  if (!serial) { alert('Serial number is required.'); return; }

  // Pre-check: serial already in our loaded inventory?
  var dupe = (_invData||[]).find(function(x){ return (x.serial_number||'').toLowerCase() === serial.toLowerCase(); });
  if (dupe) {
    alert('Serial number "'+serial+'" is already in inventory.\n\nExisting device:\n  Model: '+(dupe.model_no||'—')+'\n  Location: '+(dupe.current_location||'—')+'\n  Partner: '+(dupe.current_partner||'—')+'\n\nUse the Edit button on that device instead of adding a duplicate.');
    return;
  }

  var btn = document.getElementById('inv-add-save-btn');
  btn.disabled = true; btn.textContent = '⏳ Saving...';

  var payload = {
    serial_number:       serial,
    model_no:            document.getElementById('inv-add-model').value,
    availability_status: document.getElementById('inv-add-status').value,
    rail_kit:            document.getElementById('inv-add-rail').value,
    ids_ps:              document.getElementById('inv-add-ids').value,
    current_location:    document.getElementById('inv-add-location').value,
    current_partner:     document.getElementById('inv-add-partner').value,
    current_end_user:    document.getElementById('inv-add-enduser').value,
    previous_location:   document.getElementById('inv-add-prevlocation').value,
    audit_location:      document.getElementById('inv-add-auditloc').value,
    version:             document.getElementById('inv-add-version').value,
    remarks:             document.getElementById('inv-add-remarks').value,
    audit_date:          document.getElementById('inv-add-auditdate').value || null,
    last_updated_by:     currentUser,
  };

  var res = await sb.from('inventory').insert(payload).select().single();
  if (res.error) {
    // Friendly message for unique-violation (race condition fallback)
    if (res.error.code === '23505' || /duplicate key|unique/i.test(res.error.message)) {
      alert('Serial number "'+serial+'" is already in inventory. Please check the device list — it may have been added by someone else.');
    } else {
      alert('Error saving device: ' + res.error.message);
    }
    btn.disabled = false; btn.textContent = '💾 Save Device'; return;
  }

  await sb.from('inventory_activity_log').insert({
    device_id:     res.data.id,
    serial_number: serial,
    changed_by:    currentUser,
    action:        'created',
    field_changes: payload,
  });

  btn.disabled = false; btn.textContent = '💾 Save Device';
  showInventoryTab('devices');
  showAlert('inv-add-success');
}

function openEditDeviceModal(id) {
  var d = _invData.find(function(x) { return x.id === id; });
  if (!d) return;
  _invEditId = id;
  document.getElementById('inv-edit-serial').textContent     = d.serial_number;
  document.getElementById('inv-edit-model').value            = d.model_no || '';
  document.getElementById('inv-edit-status').value           = d.availability_status || '';
  document.getElementById('inv-edit-rail').value             = d.rail_kit || 'N/A';
  document.getElementById('inv-edit-ids').value              = d.ids_ps || 'N/A';
  document.getElementById('inv-edit-location').value         = d.current_location || '';
  document.getElementById('inv-edit-partner').value          = d.current_partner || '';
  document.getElementById('inv-edit-enduser').value          = d.current_end_user || '';
  document.getElementById('inv-edit-prevlocation').value     = d.previous_location || '';
  document.getElementById('inv-edit-auditloc').value         = d.audit_location || '';
  document.getElementById('inv-edit-version').value          = d.version || '';
  document.getElementById('inv-edit-remarks').value          = d.remarks || '';
  document.getElementById('inv-edit-auditdate').value        = d.audit_date ? d.audit_date.split('T')[0] : '';
  // Last updated info — read-only display
  var lu = document.getElementById('inv-edit-lastupdated');
  if (lu) {
    var by = d.last_updated_by || '—';
    var when = d.updated_at ? new Date(d.updated_at).toLocaleString() : (d.created_at ? new Date(d.created_at).toLocaleString() : '—');
    lu.value = by + '  •  ' + when;
  }
  document.getElementById('inv-edit-modal').classList.add('show');
}

function closeEditDeviceModal() {
  document.getElementById('inv-edit-modal').classList.remove('show');
  _invEditId = null;
}

async function saveEditDevice() {
  if (!_invEditId) return;
  var btn = document.getElementById('inv-edit-save-btn');
  btn.disabled = true; btn.textContent = '⏳ Saving...';

  var old = _invData.find(function(x) { return x.id === _invEditId; });
  var newData = {
    model_no:            document.getElementById('inv-edit-model').value,
    availability_status: document.getElementById('inv-edit-status').value,
    rail_kit:            document.getElementById('inv-edit-rail').value,
    ids_ps:              document.getElementById('inv-edit-ids').value,
    current_location:    document.getElementById('inv-edit-location').value,
    current_partner:     document.getElementById('inv-edit-partner').value,
    current_end_user:    document.getElementById('inv-edit-enduser').value,
    previous_location:   document.getElementById('inv-edit-prevlocation').value,
    audit_location:      document.getElementById('inv-edit-auditloc').value,
    version:             document.getElementById('inv-edit-version').value,
    remarks:             document.getElementById('inv-edit-remarks').value,
    audit_date:          document.getElementById('inv-edit-auditdate').value || null,
    last_updated_by:     currentUser,
    updated_at:          new Date().toISOString(),
  };

  // Build change diff for log
  var fieldLabels = {
    model_no:'Model', availability_status:'Status', rail_kit:'Rail Kit', ids_ps:'IDS/PS',
    current_location:'Location', current_partner:'Partner', current_end_user:'End User',
    previous_location:'Prev Location', audit_location:'Audit Location',
    version:'Version', remarks:'Remarks', audit_date:'Audit Date'
  };
  var changes = {};
  Object.keys(fieldLabels).forEach(function(k) {
    var oldVal = (old[k] || '');
    var newVal = (newData[k] || '');
    if (String(oldVal) !== String(newVal)) {
      changes[fieldLabels[k]] = { from: oldVal, to: newVal };
    }
  });

  var res = await sb.from('inventory').update(newData).eq('id', _invEditId);
  if (res.error) {
    alert('Error updating device: ' + res.error.message);
    btn.disabled = false; btn.textContent = '💾 Save Changes'; return;
  }

  if (Object.keys(changes).length > 0) {
    await sb.from('inventory_activity_log').insert({
      device_id:     _invEditId,
      serial_number: old.serial_number,
      changed_by:    currentUser,
      action:        'updated',
      field_changes: changes,
    });
  }

  btn.disabled = false; btn.textContent = '💾 Save Changes';
  closeEditDeviceModal();
  loadInventory();
}

async function deleteDevice(id, serial) {
  if (!isManager) return;
  if (!confirm('Delete device ' + serial + '? This cannot be undone.')) return;

  await sb.from('inventory_activity_log').insert({
    device_id:     id,
    serial_number: serial,
    changed_by:    currentUser,
    action:        'deleted',
    field_changes: {},
  });

  var res = await sb.from('inventory').delete().eq('id', id);
  if (res.error) { alert('Error deleting: ' + res.error.message); return; }
  loadInventory();
}

async function loadActivityLog() {
  var container = document.getElementById('inv-log-content');
  container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';

  var res = await sb.from('inventory_activity_log')
    .select('*').order('changed_at', {ascending:false}).limit(200);
  if (res.error) {
    container.innerHTML = '<div class="alert alert-error show">Error: '+res.error.message+'</div>';
    return;
  }
  var data = res.data || [];
  if (!data.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📜</div><div class="empty-title">No activity yet</div></div>';
    return;
  }

  var rows = '';
  data.forEach(function(log) {
    var icon  = log.action==='created'?'✅':log.action==='deleted'?'🗑️':'✏️';
    var color = log.action==='created'?'var(--success)':log.action==='deleted'?'var(--danger)':'var(--teal)';
    var changesHtml = '—';
    if (log.action === 'updated' && log.field_changes && typeof log.field_changes === 'object') {
      var parts = [];
      Object.keys(log.field_changes).forEach(function(f) {
        var c = log.field_changes[f];
        parts.push('<span style="color:var(--muted)">'+f+':</span> '+
          '<span style="color:var(--danger);text-decoration:line-through">'+esc2(c.from||'—')+'</span>'+
          ' → <span style="color:var(--success)">'+esc2(c.to||'—')+'</span>');
      });
      changesHtml = parts.join('<br>');
    }
    rows +=
      '<tr>'+
      '<td style="white-space:nowrap;font-size:12px;color:var(--muted)">'+fmtDate(log.changed_at)+'</td>'+
      '<td style="font-family:\'DM Mono\',monospace;font-size:12px;font-weight:600">'+esc2(log.serial_number||'')+'</td>'+
      '<td><span style="color:'+color+';font-weight:600">'+icon+' '+cap(log.action)+'</span></td>'+
      '<td>'+esc2(log.changed_by||'')+'</td>'+
      '<td style="font-size:12px;line-height:1.7">'+changesHtml+'</td>'+
      '</tr>';
  });

  container.innerHTML =
    '<div class="table-wrap"><table>'+
    '<thead><tr><th>Date</th><th>Serial No.</th><th>Action</th><th>Changed By</th><th>Changes</th></tr></thead>'+
    '<tbody>'+rows+'</tbody>'+
    '</table></div>';
}

function exportInventoryCSV() {
  if (!_invData.length) { alert('No data to export.'); return; }
  var headers = ['Serial Number','Model','Status','Rail Kit','IDS/PS','Location',
                 'Partner','End User','Previous Location','Audit Location','Version',
                 'Remarks','Audit Date','Last Updated By'];
  var rows = [headers];
  _invData.forEach(function(d) {
    rows.push([d.serial_number,d.model_no,d.availability_status,d.rail_kit,d.ids_ps,
               d.current_location,d.current_partner,d.current_end_user,d.previous_location,
               d.audit_location,d.version,d.remarks,d.audit_date,d.last_updated_by]);
  });
  var csv = rows.map(function(r) {
    return r.map(function(v) { return '"'+(v||'')+'"'; }).join(',');
  }).join('\n');
  var a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download = 'GulfIT_Inventory_'+new Date().toLocaleDateString('en-GB').replace(/\//g,'-')+'.csv';
  a.click();
}

// ══ OT APPROVALS ══════════════════════════════════════════════════

async function renderOTApprovals() {
  document.getElementById('ot-approvals-load').style.display='flex';
  document.getElementById('ot-approvals-content').innerHTML='';
  const {data,error}=await sb.from('ot_sessions').select('*').order('ot_date',{ascending:false});
  document.getElementById('ot-approvals-load').style.display='none';
  if (error||!data||!data.length){
    document.getElementById('ot-approvals-content').innerHTML='<div class="empty-state"><div class="empty-icon">⏱</div><div class="empty-title">No OT sessions</div></div>';
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
    html+='<h3 style="font-size:14px;font-weight:600;color:var(--muted);margin:20px 0 12px">History</h3>';
    html+=others.map(function(r){return otApprovalCard(r);}).join('');
  }
  document.getElementById('ot-approvals-content').innerHTML=html;
}

function otApprovalCard(r) {
  var isPending=r.status==='pending';
  var st=r.status||'approved';
  var info='<strong>'+r.employee+'</strong> — '+esc2(r.activity)+'<br>'+
    '<span style="font-size:12px;color:var(--muted)">'+fmtDate(r.ot_date)+' ('+r.day_name+') &nbsp;·&nbsp; '+
    r.start_time+'–'+r.end_time+' &nbsp;·&nbsp; '+r.duration_hours+'h &nbsp;·&nbsp; '+
    '<span class="badge badge-'+r.band+'">'+r.band+'</span> &nbsp; '+r.rate+' &nbsp;·&nbsp; Credited: <strong>'+r.credited_hours+'h</strong></span>';
  return '<div class="request-card '+st+'" style="margin-bottom:10px">'+
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">'+
    '<div style="font-size:13px;line-height:1.6">'+info+
    '<br><span style="font-size:11px;color:var(--muted)">Submitted: '+fmtDate(r.created_at)+'</span></div>'+
    '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">'+
    '<span class="badge badge-'+st+'">'+statusIcon(st)+' '+cap(st)+'</span>'+
    (isPending?'<button class="btn btn-sm btn-primary" onclick="openApproveModal(\'ot\','+r.id+',\''+r.employee+'\')">Review</button>':'')+
    '</div></div>'+
    (r.manager_comment?'<div style="font-size:12px;color:var(--muted);margin-top:8px">💬 '+esc2(r.manager_comment)+'</div>':'')+
    '</div>';
}

// ══ KNOWLEDGE BASE MODULE ══════════════════════════════════════════

var _kbData = [];
var _kbViewId = null;

function showKBTab(tab) {
  ['browse','submit','mine'].forEach(function(t) {
    var el  = document.getElementById('kbtab-'+t);
    var sub = document.getElementById('kbsub-'+t);
    if (!el) return;
    el.style.display = t===tab ? 'block' : 'none';
    if (!sub) return;
    if (t===tab) { sub.classList.add('active'); sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid var(--teal);color:var(--navy);white-space:nowrap'; }
    else         { sub.classList.remove('active'); sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);white-space:nowrap'; }
  });
  if (tab==='browse') loadKBArticles();
  if (tab==='submit') resetKBForm();
  if (tab==='mine')   loadMyKBArticles();
}

async function loadKBArticles() {
  var wrap = document.getElementById('kb-articles-wrap');
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div>Loading articles...</div>';
  var {data,error} = await sb.from('kb_articles').select('*').order('created_at',{ascending:false});
  if (error) { wrap.innerHTML='<div class="alert alert-error show">Error: '+error.message+'</div>'; return; }
  _kbData = data || [];
  renderKBArticles(_kbData);
}

function applyKBFilters() {
  var search = (document.getElementById('kb-search').value||'').toLowerCase();
  var catF   = document.getElementById('kb-filter-cat').value;
  var filtered = _kbData.filter(function(a) {
    var matchSearch = !search ||
      (a.title||'').toLowerCase().includes(search) ||
      (a.content||'').toLowerCase().includes(search) ||
      (a.tags||'').toLowerCase().includes(search) ||
      (a.submitted_by||'').toLowerCase().includes(search);
    var matchCat = !catF || a.category===catF;
    return matchSearch && matchCat;
  });
  renderKBArticles(filtered);
}

function kbCatClass(cat) {
  var map={'Network':'kb-cat-Network','Security':'kb-cat-Security','Configuration':'kb-cat-Configuration','Troubleshooting':'kb-cat-Troubleshooting','General':'kb-cat-General'};
  return map[cat]||'kb-cat-General';
}

function renderKBArticles(data) {
  var wrap = document.getElementById('kb-articles-wrap');
  if (!data.length) {
    wrap.innerHTML='<div class="empty-state"><div class="empty-icon">📚</div><div class="empty-title">No articles found</div><div>Be the first to submit one!</div></div>';
    return;
  }
  var cards = data.map(function(a) {
    var tags = (a.tags||'').split(',').map(function(t){return t.trim();}).filter(Boolean);
    var tagHtml = tags.map(function(t){return '<span class="kb-tag">'+esc2(t)+'</span>';}).join('');
    var excerpt = (a.content||'').slice(0,180).trim() + ((a.content||'').length>180?'…':'');
    return '<div class="kb-card">'+
      '<div class="kb-card-meta">'+
      '<span class="badge '+kbCatClass(a.category)+'">'+esc2(a.category||'General')+'</span>'+
      '<span class="kb-author">by <strong>'+esc2(a.submitted_by)+'</strong> · '+fmtDate(a.created_at)+'</span>'+
      '</div>'+
      '<div class="kb-title">'+esc2(a.title)+'</div>'+
      '<div class="kb-excerpt">'+esc2(excerpt)+'</div>'+
      (tagHtml?'<div class="kb-tags">'+tagHtml+'</div>':'')+
      '<div style="display:flex;gap:8px;margin-top:4px">'+
      '<button class="btn btn-sm btn-primary" onclick="openKBArticle('+a.id+')">Read More</button>'+
      (a.file_url?'<a href="'+esc2(a.file_url)+'" target="_blank" class="btn btn-sm btn-ghost">🔗 Reference</a>':'')+
      '</div>'+
      '</div>';
  }).join('');
  wrap.innerHTML = '<div class="kb-grid">'+cards+'</div>';
}

function openKBArticle(id) {
  var a = _kbData.find(function(x){return x.id===id;});
  if (!a) return;
  _kbViewId = id;
  var tags = (a.tags||'').split(',').map(function(t){return t.trim();}).filter(Boolean);
  document.getElementById('kb-view-cat').innerHTML='<span class="badge '+kbCatClass(a.category)+'">'+esc2(a.category||'General')+'</span>';
  document.getElementById('kb-view-title').textContent=a.title;
  document.getElementById('kb-view-meta').innerHTML='Submitted by <strong>'+esc2(a.submitted_by)+'</strong> &nbsp;·&nbsp; '+fmtDate(a.created_at);
  document.getElementById('kb-view-tags').innerHTML=tags.map(function(t){return '<span class="kb-tag">'+esc2(t)+'</span>';}).join('');
  document.getElementById('kb-view-body').textContent=a.content;
  var urlEl=document.getElementById('kb-view-url');
  if (a.file_url){urlEl.style.display='block';document.getElementById('kb-view-url-link').href=a.file_url;}
  else{urlEl.style.display='none';}
  // show edit/delete for own articles or manager
  var editBtns=document.getElementById('kb-view-edit-btns');
  if (a.submitted_by===currentUser||isManager){
    editBtns.innerHTML='<button class="btn btn-ghost" onclick="openKBEditModal('+id+')">✏️ Edit</button>'+
      (isManager||a.submitted_by===currentUser?'<button class="btn btn-danger" onclick="deleteKBArticle('+id+')" style="margin-left:8px">🗑 Delete</button>':'');
  } else { editBtns.innerHTML=''; }
  document.getElementById('kb-view-modal').classList.add('show');
}

function closeKBModal() {
  document.getElementById('kb-view-modal').classList.remove('show');
  _kbViewId=null;
}

function resetKBForm() {
  ['kb-title','kb-category','kb-tags','kb-content','kb-url'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.value='';
  });
}

async function submitKBArticle() {
  var title   = (document.getElementById('kb-title').value||'').trim();
  var category= document.getElementById('kb-category').value;
  var content = (document.getElementById('kb-content').value||'').trim();
  if (!title||!category||!content){alert('Title, Category and Content are required.');return;}
  var btn=document.getElementById('kb-submit-btn');
  btn.disabled=true; btn.textContent='⏳ Publishing...';
  var {error}=await sb.from('kb_articles').insert({
    title:title, category:category,
    tags:document.getElementById('kb-tags').value.trim(),
    content:content,
    file_url:document.getElementById('kb-url').value.trim()||null,
    submitted_by:currentUser
  });
  btn.disabled=false; btn.textContent='📤 Publish Article';
  if (error){alert('Error: '+error.message);return;}
  showAlert('kb-submit-success');
  resetKBForm();
  showKBTab('browse');
}

async function loadMyKBArticles() {
  var wrap=document.getElementById('kb-mine-wrap');
  wrap.innerHTML='<div class="loading"><div class="spinner"></div>Loading...</div>';
  var {data,error}=await sb.from('kb_articles').select('*').eq('submitted_by',currentUser).order('created_at',{ascending:false});
  if (error){wrap.innerHTML='<div class="alert alert-error show">Error: '+error.message+'</div>';return;}
  if (!data||!data.length){
    wrap.innerHTML='<div class="empty-state"><div class="empty-icon">📝</div><div class="empty-title">No articles yet</div><div>Submit your first article!</div></div>';
    return;
  }
  // Update _kbData so openKBArticle works from My Articles tab
  data.forEach(function(a){if(!_kbData.find(function(x){return x.id===a.id;}))_kbData.push(a);});
  var rows=data.map(function(a){
    return '<tr>'+
      '<td style="font-weight:600">'+esc2(a.title)+'</td>'+
      '<td><span class="badge '+kbCatClass(a.category)+'">'+esc2(a.category||'—')+'</span></td>'+
      '<td style="font-size:12px;color:var(--muted)">'+fmtDate(a.created_at)+'</td>'+
      '<td style="white-space:nowrap">'+
        '<button class="btn btn-sm btn-ghost" onclick="openKBArticle('+a.id+')" style="margin-right:6px">👁 View</button>'+
        '<button class="btn btn-sm btn-ghost" onclick="openKBEditModal('+a.id+')" style="margin-right:6px">✏️ Edit</button>'+
        '<button class="btn btn-sm btn-danger" onclick="deleteKBArticle('+a.id+')">🗑</button>'+
      '</td>'+
    '</tr>';
  }).join('');
  wrap.innerHTML='<div class="table-wrap"><table><thead><tr><th>Title</th><th>Category</th><th>Date</th><th>Actions</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

function openKBEditModal(id) {
  var a=_kbData.find(function(x){return x.id===id;});
  if (!a) return;
  if (a.submitted_by!==currentUser && !isManager){alert('You can only edit your own articles.');return;}
  document.getElementById('kb-edit-id').value=id;
  document.getElementById('kb-edit-title').value=a.title||'';
  document.getElementById('kb-edit-category').value=a.category||'';
  document.getElementById('kb-edit-tags').value=a.tags||'';
  document.getElementById('kb-edit-content').value=a.content||'';
  document.getElementById('kb-edit-url').value=a.file_url||'';
  closeKBModal();
  document.getElementById('kb-edit-modal').classList.add('show');
}

function closeKBEditModal() {
  document.getElementById('kb-edit-modal').classList.remove('show');
}

async function saveKBEdit() {
  var id=parseInt(document.getElementById('kb-edit-id').value);
  var title=(document.getElementById('kb-edit-title').value||'').trim();
  var content=(document.getElementById('kb-edit-content').value||'').trim();
  if (!title||!content){alert('Title and Content are required.');return;}
  var btn=document.getElementById('kb-edit-save-btn');
  btn.disabled=true; btn.textContent='⏳ Saving...';
  var {error}=await sb.from('kb_articles').update({
    title:title,
    category:document.getElementById('kb-edit-category').value,
    tags:document.getElementById('kb-edit-tags').value.trim(),
    content:content,
    file_url:document.getElementById('kb-edit-url').value.trim()||null,
    updated_at:new Date().toISOString()
  }).eq('id',id);
  btn.disabled=false; btn.textContent='💾 Save';
  if (error){alert('Error: '+error.message);return;}
  closeKBEditModal();
  loadKBArticles();
}

async function deleteKBArticle(id) {
  var a=_kbData.find(function(x){return x.id===id;});
  if (!a) return;
  if (a.submitted_by!==currentUser && !isManager){alert('You can only delete your own articles.');return;}
  if (!confirm('Delete "'+a.title+'"? This cannot be undone.')) return;
  closeKBModal();
  var {error}=await sb.from('kb_articles').delete().eq('id',id);
  if (error){alert('Error: '+error.message);return;}
  loadKBArticles();
}

// ══ INIT ══════════════════════════════════════════════════════════
window.onload = async function() {
  // Detect password-recovery flow first — Supabase puts type=recovery in the URL hash
  // when the user clicks the email reset link. We listen for the auth event.
  sb.auth.onAuthStateChange(function(event){
    if (event === 'PASSWORD_RECOVERY') {
      document.getElementById('login-screen').style.display = 'flex';
      document.getElementById('app').style.display = 'none';
      showResetForm();
    }
  });

  // Restore existing session if present
  const {data} = await sb.auth.getSession();
  if (data && data.session && data.session.user) {
    // If the URL is a recovery link, the auth event above will switch to reset form.
    // Otherwise sign the user straight in.
    if (!/type=recovery/.test(window.location.hash)) {
      await initAppFromUser(data.session.user);
      return;
    }
  }
  // No active session — show sign-in form
  showSigninForm();
};
