// == AUTH (Supabase) ==============================================
// v130 a11y: dropped the 5s auto-hide on errors — a slow reader could lose
// the message before reading it, and bad-password errors disappeared while
// the user was mid-correction. The error now clears on next submit attempt
// (showLoginError replaces the text) or on form-switch (resetLoginButtons
// is called by show{Signin,Forgot,Reset}Form). Successes still auto-hide
// because they confirm a transient action.
function showLoginError(msg) {
  const e = document.getElementById('login-error');
  e.textContent = '❌ ' + msg;
  e.style.display = 'block'; e.style.background='#FEE2E2'; e.style.color='#B91C1C';
  e.style.padding='10px'; e.style.borderRadius='8px'; e.style.fontSize='13px';
  e.style.marginBottom='12px'; e.style.textAlign='center';
}

function showLoginSuccess(msg) {
  const e = document.getElementById('login-success');
  e.textContent = '✅ ' + msg;
  e.style.display = 'block';
  setTimeout(function(){ e.style.display = 'none'; }, 6000);
}

// v130: map common Supabase auth error codes to friendlier copy so users
// know what to do, not just that something failed. Falls through to the
// raw message for anything not mapped.
function _friendlyAuthError(raw) {
  var s = String(raw || '').toLowerCase();
  if (s.indexOf('invalid login credentials') !== -1) {
    return 'Wrong email or password — try again, or use Forgot password.';
  }
  if (s.indexOf('email not confirmed') !== -1) {
    return 'This account is not confirmed yet — check your inbox or ask your manager to re-invite you.';
  }
  if (s.indexOf('email rate limit') !== -1 || s.indexOf('too many requests') !== -1) {
    return 'Too many attempts in a short time — wait a minute and try again.';
  }
  if (s.indexOf('user not found') !== -1) {
    return 'No account found for that email — check the spelling or ask your manager to invite you.';
  }
  if (s.indexOf('network') !== -1 || s.indexOf('failed to fetch') !== -1) {
    return 'Network error — check your connection and try again.';
  }
  return raw || 'Sign in failed.';
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
    if (error)               { clearLoginBtnLoading('login-signin-btn'); showLoginError(_friendlyAuthError(error.message)); return; }
    if (!data || !data.user) { clearLoginBtnLoading('login-signin-btn'); showLoginError('Sign in failed.'); return; }

    // If "Remember me" is unchecked, sign out when window closes.
    if (!remember) {
      window.addEventListener('beforeunload', function(){ sb.auth.signOut(); });
    }

    // Keep the button in its loading state — we're transitioning to the app.
    await initAppFromUser(data.user);
  } catch (err) {
    clearLoginBtnLoading('login-signin-btn');
    showLoginError(_friendlyAuthError(err && err.message));
  }
}

async function doForgot() {
  const email = (document.getElementById('forgot-email').value||'').trim().toLowerCase();
  if (!email) { showLoginError('Please enter your email.'); return; }
  setLoginBtnLoading('login-forgot-btn', 'Sending…');
  const redirectTo = window.location.origin + window.location.pathname;
  const {error} = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo });
  if (error) { clearLoginBtnLoading('login-forgot-btn'); showLoginError(_friendlyAuthError(error.message)); return; }
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
  if (error) { clearLoginBtnLoading('login-reset-btn'); showLoginError(_friendlyAuthError(error.message)); return; }
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
  // v130: prefer the user-menu logout button (current live location);
  // fall back to the legacy sidebar logout for back-compat.
  var btn = document.querySelector('.user-menu-item-danger') || document.querySelector('.sidebar-item-logout');
  var original = btn ? btn.innerHTML : '';
  if (btn) {
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '.7';
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px"></span>Logging out…';
  }
  try {
    await sb.auth.signOut();
  } finally {
    currentUser = ''; currentEmail = ''; isManager = false; isBackupResponsible = false;
    if (typeof Sentry !== 'undefined') { try { Sentry.setUser(null); } catch (e) {} }
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
    .select('user_id,email,employee_name,is_manager,is_backup_responsible')
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
  isBackupResponsible = !!profile.is_backup_responsible;
  // v97: attribute Sentry errors to the logged-in employee. Username +
  // email only — never any token. Region is derived from KSA_EMP since
  // it's not a column on the profile.
  if (typeof Sentry !== 'undefined') {
    try {
      var region = (typeof KSA_EMP !== 'undefined' && KSA_EMP.indexOf(currentUser) !== -1) ? 'KSA' : 'UAE';
      Sentry.setUser({ username: currentUser, id: currentEmail });
      Sentry.setTag('region', region);
      Sentry.setTag('role', isManager ? 'manager' : 'employee');
    } catch (e) { /* never block login on Sentry */ }
  }
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
  // CUSTOMERS & DEALS group: whole wrap hides for employees so the section
  // header doesn't render against an empty list.
  var custDealsWrap = document.getElementById('sidebar-customers-deals-wrap');
  if (custDealsWrap) custDealsWrap.style.display = isManager ? '' : 'none';
  // Per-item gates for manager-only items that live inside otherwise
  // shared groups (Catalog has employee-visible Inventory + Certificates
  // alongside manager-only Vendors + Skills; Settings has employee-visible
  // KB + OT Policy alongside manager-only Admin Tools).
  ['sbi-projects-custmgr','sbi-projects-manage','sbi-projects-vendors','sbi-projects-otmanager','tab-amc','tab-psdeals','tab-skills'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.style.display = isManager ? '' : 'none';
  });
  var sbiCertAll = document.getElementById('sbi-certificates-all');
  if (sbiCertAll) sbiCertAll.style.display = isManager ? '' : 'none';
  // Approvals sits at the top of the sidebar as a manager-only group
  // (no section label in the new layout).
  document.getElementById('tab-approvals').style.display  = isManager ? '' : 'none';
  var sbgApprovals = document.getElementById('sbg-approvals');
  if (sbgApprovals) sbgApprovals.style.display = isManager ? '' : 'none';
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
  if (typeof updateTasksBadge === 'function') updateTasksBadge();
}

// == AUTH-STATE VALIDATION (v82) ==================================
// Defensive pre-flight for mutations. Network blips can kill the Supabase
// auth session while frontend state (currentUser, isManager) stays populated
// from initial login. The app *looks* logged in, but the JWT no longer
// carries an email — so any INSERT/UPDATE/DELETE that depends on RLS via
// current_employee_name()/is_manager_user() fails with a generic 42501
// "row-level security policy violation". That error reads as a permission
// bug; the actual cause is "session died silently."
//
// ensureAuthValid() reads the cached session from local storage (no network
// round trip) and verifies it has a user with an email AND isn't expired.
// Callers either consume {valid, reason} directly or use requireAuth() —
// which surfaces the modal and returns a boolean — so a save handler can
// bail with a clean message instead of a cryptic RLS error.
async function ensureAuthValid() {
  try {
    const { data } = await sb.auth.getSession();
    const session = data && data.session;
    if (!session || !session.user || !session.user.email) {
      return { valid: false, reason: 'no_session' };
    }
    if (session.expires_at && session.expires_at * 1000 < Date.now()) {
      return { valid: false, reason: 'expired' };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, reason: 'check_failed', error: err };
  }
}

// Convenience wrapper for mutation entry points. Returns true if the caller
// may proceed; if false, the modal is already shown and the caller bails.
// Usage:  if (!await requireAuth()) return;
async function requireAuth() {
  var res = await ensureAuthValid();
  if (!res.valid) {
    showSessionExpiredModal();
    return false;
  }
  return true;
}

function showSessionExpiredModal() {
  var modal = document.getElementById('session-expired-modal');
  if (modal) modal.classList.add('show');
}

// Non-dismissable recovery path: sign out cleanly (clears stale local
// session data), clear our app-state mirrors, then full reload so we land
// on the login screen with no leftover UI state. signOut() itself can fail
// on a dead connection — we still want to clear local state and reload.
async function handleSessionExpiredLogout() {
  try { await sb.auth.signOut(); } catch(e) { /* network already down */ }
  currentUser = ''; currentEmail = ''; isManager = false;
  location.reload();
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

