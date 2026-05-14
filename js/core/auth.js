// == AUTH (Supabase) ==============================================
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

// Reset every login button to its idle state. doLogin keeps the Sign In
// button in its loading state on success (screen is swapping to the app),
// so coming back to the login screen — e.g. after logout — has to clear it
// so it doesn't read "Signing in…" forever.
function resetLoginButtons() {
  ['login-signin-btn','login-forgot-btn','login-reset-btn'].forEach(function(id){
    if (typeof clearLoginBtnLoading === 'function') clearLoginBtnLoading(id);
  });
}
function showSigninForm() {
  document.getElementById('login-form-signin').style.display='block';
  document.getElementById('login-form-forgot').style.display='none';
  document.getElementById('login-form-reset').style.display='none';
  document.getElementById('login-sub').textContent = 'Sign in to continue';
  resetLoginButtons();
}
function showForgotForm() {
  document.getElementById('login-form-signin').style.display='none';
  document.getElementById('login-form-forgot').style.display='block';
  document.getElementById('login-form-reset').style.display='none';
  document.getElementById('login-sub').textContent = 'Forgot your password?';
  resetLoginButtons();
}
function showResetForm() {
  document.getElementById('login-form-signin').style.display='none';
  document.getElementById('login-form-forgot').style.display='none';
  document.getElementById('login-form-reset').style.display='block';
  document.getElementById('login-sub').textContent = 'Set a new password';
  resetLoginButtons();
}

// Toggle a login button into a disabled "loading" state with a spinner +
// custom label. Returns the button so callers can clear it on error.
function setLoginBtnLoading(btnId, label) {
  var btn = document.getElementById(btnId);
  if (!btn) return null;
  if (btn.dataset.original == null) btn.dataset.original = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.innerHTML = '<span class="login-btn-spinner" aria-hidden="true"></span><span>'+label+'</span>';
  return btn;
}
function clearLoginBtnLoading(btnId) {
  var btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = false;
  btn.classList.remove('is-loading');
  if (btn.dataset.original != null) {
    btn.innerHTML = btn.dataset.original;
    delete btn.dataset.original;
  }
}

async function doLogin() {
  var btn = document.getElementById('login-signin-btn');
  if (btn && btn.disabled) return; // re-entry guard (e.g. Enter pressed while in flight)
  const email    = (document.getElementById('login-email').value||'').trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const remember = document.getElementById('login-remember').checked;
  if (!email || !password) { showLoginError('Please enter email and password.'); return; }

  setLoginBtnLoading('login-signin-btn', 'Signing in…');
  try {
    const {data, error} = await sb.auth.signInWithPassword({ email: email, password: password });
    if (error)               { clearLoginBtnLoading('login-signin-btn'); showLoginError(error.message || 'Sign in failed.'); return; }
    if (!data || !data.user) { clearLoginBtnLoading('login-signin-btn'); showLoginError('Sign in failed.'); return; }

    // If "Remember me" is unchecked, sign out when window closes.
    if (!remember) {
      window.addEventListener('beforeunload', function(){ sb.auth.signOut(); });
    }

    // Keep the button in its loading state — we're transitioning to the app.
    await initAppFromUser(data.user);
  } catch (err) {
    clearLoginBtnLoading('login-signin-btn');
    showLoginError((err && err.message) || 'Sign in failed.');
  }
}

async function doForgot() {
  const email = (document.getElementById('forgot-email').value||'').trim().toLowerCase();
  if (!email) { showLoginError('Please enter your email.'); return; }
  setLoginBtnLoading('login-forgot-btn', 'Sending…');
  const redirectTo = window.location.origin + window.location.pathname;
  const {error} = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo });
  if (error) { clearLoginBtnLoading('login-forgot-btn'); showLoginError(error.message || 'Could not send reset link.'); return; }
  clearLoginBtnLoading('login-forgot-btn');
  showLoginSuccess('Reset link sent. Check your email inbox.');
  setTimeout(showSigninForm, 1500);
}

async function doResetPassword() {
  const p1 = document.getElementById('reset-password').value;
  const p2 = document.getElementById('reset-password2').value;
  if (p1.length < 8) { showLoginError('Password must be at least 8 characters.'); return; }
  if (p1 !== p2)     { showLoginError('Passwords do not match.'); return; }
  setLoginBtnLoading('login-reset-btn', 'Saving…');
  const {error} = await sb.auth.updateUser({ password: p1 });
  if (error) { clearLoginBtnLoading('login-reset-btn'); showLoginError(error.message || 'Could not update password.'); return; }
  showLoginSuccess('Password set! Signing you in…');
  // After updateUser the session is already active — go straight in.
  const {data} = await sb.auth.getUser();
  if (data && data.user) {
    setTimeout(function(){ initAppFromUser(data.user); }, 800);
  }
}

async function doLogout() {
  // Lock the logout entry to prevent double-clicks and surface progress —
  // the signOut round trip can take a beat on a slow connection.
  var btn = document.querySelector('.sidebar-item-logout');
  var original = btn ? btn.innerHTML : '';
  if (btn) {
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '.7';
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px"></span>Logging out…';
  }
  try {
    await sb.auth.signOut();
  } finally {
    currentUser = ''; currentEmail = ''; isManager = false;
    document.getElementById('app').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    showSigninForm();
    if (btn) {
      btn.innerHTML = original;
      btn.style.pointerEvents = '';
      btn.style.opacity = '';
    }
  }
}

// In-app change password (user is already signed in)
function openChangePasswordModal() {
  document.getElementById('cp-new').value = '';
  document.getElementById('cp-confirm').value = '';
  document.getElementById('change-password-error').style.display = 'none';
  document.getElementById('change-password-success').style.display = 'none';
  document.getElementById('change-password-modal').classList.add('show');
}
function closeChangePasswordModal() {
  document.getElementById('change-password-modal').classList.remove('show');
}
async function doChangePassword() {
  var p1 = document.getElementById('cp-new').value;
  var p2 = document.getElementById('cp-confirm').value;
  var errEl = document.getElementById('change-password-error');
  var okEl  = document.getElementById('change-password-success');
  errEl.style.display = 'none'; okEl.style.display = 'none';
  if (p1.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; errEl.style.display='block'; return; }
  if (p1 !== p2)     { errEl.textContent = 'Passwords do not match.'; errEl.style.display='block'; return; }
  var {error} = await sb.auth.updateUser({ password: p1 });
  if (error) { errEl.textContent = error.message || 'Could not update password.'; errEl.style.display='block'; return; }
  closeChangePasswordModal();
  showToast('Password updated ✓');
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
  // fetchUserProfile + loadAllProfiles don't depend on each other — fire
  // them together so we wait once instead of twice on slow networks.
  const [profile] = await Promise.all([
    fetchUserProfile(authUser),
    loadAllProfiles()
  ]);
  if (!profile) {
    showLoginError('Your account is not set up yet. Ask the manager to add your profile.');
    await sb.auth.signOut();
    return;
  }
  currentUser  = profile.employee_name;
  currentEmail = profile.email || authUser.email;
  isManager    = !!profile.is_manager;
  await initApp(currentUser);
}

async function initApp(user) {

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  // Set header
  document.getElementById('header-username').textContent = user;
  const rb = document.getElementById('header-role-badge');
  rb.textContent = isManager ? 'Manager' : 'Employee';
  rb.className = 'role-badge ' + (isManager ? 'manager' : 'employee');
  // Initials avatar — first letter of first two name tokens, uppercased.
  var av = document.getElementById('user-avatar');
  if (av) {
    var parts = (user||'').split(/\s+/).filter(Boolean).slice(0,2);
    av.textContent = parts.map(function(p){return p.charAt(0).toUpperCase();}).join('') || '·';
  }

  // Show/hide manager elements
  var sbiOTManager = document.getElementById('sbi-projects-otmanager');
  if (sbiOTManager) sbiOTManager.style.display = isManager ? '' : 'none';
  var sbiManage = document.getElementById('sbi-projects-manage');
  if (sbiManage) sbiManage.style.display = isManager ? '' : 'none';
  var sbiVendors = document.getElementById('sbi-projects-vendors');
  if (sbiVendors) sbiVendors.style.display = isManager ? '' : 'none';
  var sbiCertAll = document.getElementById('sbi-certificates-all');
  if (sbiCertAll) sbiCertAll.style.display = isManager ? '' : 'none';
  document.getElementById('tab-approvals').style.display  = isManager ? '' : 'none';
  var sbgApprovals = document.getElementById('sbg-approvals');
  if (sbgApprovals) sbgApprovals.style.display = isManager ? '' : 'none';
  var apprLabel = document.getElementById('sidebar-approvals-label');
  if (apprLabel) apprLabel.style.display = isManager ? '' : 'none';
  // Leave sub-tab labels depend on role (icons render separately via Lucide)
  var teamLabel = document.getElementById('sbi-leave-team-label');
  if (teamLabel) teamLabel.textContent = isManager ? 'Team Overview' : 'My Leave Overview';
  var histLabel = document.getElementById('sbi-leave-history-label');
  if (histLabel) histLabel.textContent = isManager ? 'All Requests' : 'My Requests';

  // Manager can filter employees; employees cannot
  document.querySelectorAll('.manager-only-el').forEach(function(el) {
    el.style.display = isManager ? '' : 'none';
  });

  // Render the dashboard immediately. loadProjects (customers + engagements)
  // is needed for session-log dropdowns and Manage Engagements, but the
  // dashboard fetches its own data — no need to block on it. checkConnection
  // is also a fire-and-forget status ping.
  showScreen('dashboard');
  checkConnection();
  loadProjects().then(function(){
    if (typeof populateProjectDropdowns === 'function') populateProjectDropdowns();
  });
  if (isManager) updateNotifBadge();
  if (typeof startNotifPolling === 'function') startNotifPolling();
}

// == CONNECTION CHECK ==============================================
async function checkConnection() {
  var topbarDot = document.getElementById('db-dot');
  var menuDot   = document.getElementById('user-menu-dot');
  var menuText  = document.getElementById('user-menu-status-text');
  try {
    const { error } = await sb.from('ot_sessions').select('id').limit(1);
    if (error) throw error;
    if (topbarDot) topbarDot.classList.add('connected');
    if (menuDot)   menuDot.classList.add('connected');
    if (menuText)  menuText.textContent = 'Connected to database';
  } catch(e) {
    if (menuText) menuText.textContent = 'Database unreachable';
  }
}

