// == INIT ==========================================================
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
