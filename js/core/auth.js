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
  okEl.textContent = 'Password updated. Use the new one next time you sign in.'; okEl.style.display='block';
  setTimeout(closeChangePasswordModal, 2000);
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

  // Set log-employee field
  document.getElementById('log-employee').value = user;
  document.getElementById('log-date').value = new Date().toISOString().split('T')[0];

  // Show/hide manager elements
  document.getElementById('otsub-manager').style.display = isManager ? '' : 'none';
  document.getElementById('tab-approvals').style.display  = isManager ? '' : 'none';
  // Leave sub-tab label depends on role
  var lsubLabel = document.getElementById('lsub-team-label');
  if (lsubLabel) lsubLabel.textContent = isManager ? '👔 Team Overview' : '🏖️ My Leave Overview';

  // Manager can filter employees; employees cannot
  document.querySelectorAll('.manager-only-el').forEach(function(el) {
    el.style.display = isManager ? '' : 'none';
  });

  await loadProjects();
  checkConnection();
  updatePreview();
  showScreen('dashboard');
  if (isManager) updateNotifBadge();
}

// == CONNECTION CHECK ==============================================
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

