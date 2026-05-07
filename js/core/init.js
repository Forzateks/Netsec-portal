// == LOGIN BACKGROUND VIDEO ========================================
function initLoginBgVideo() {
  var v = document.getElementById('login-bg-video');
  if (!v) return;
  // Some browsers' autoplay policies need an explicit play() — even when
  // the video is already muted via the `muted` attribute.
  var p = v.play();
  if (p && p.catch) p.catch(function(){ /* autoplay blocked, video will sit on first frame */ });
}

// == INIT ==========================================================
window.onload = async function() {
  initLoginBgVideo();
  // Supabase puts the link type in the URL hash:
  //   type=recovery            -> forgot-password reset link
  //   type=invite | type=signup -> invitation from manager (first-time login)
  // Both should land on the set-password form, not auto-sign-in.
  const hash = window.location.hash || '';
  const isRecovery = /type=recovery/.test(hash);
  const isInvite   = /type=invite|type=signup/.test(hash);
  const forcePasswordSetup = isRecovery || isInvite;

  sb.auth.onAuthStateChange(function(event){
    if (event === 'PASSWORD_RECOVERY') {
      document.getElementById('login-screen').style.display = 'flex';
      document.getElementById('app').style.display = 'none';
      showResetForm();
    }
  });

  // Restore existing session if present
  const {data} = await sb.auth.getSession();

  if (forcePasswordSetup) {
    // Invite or recovery link — force password setup before entering the app
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    var sub = document.getElementById('login-sub');
    if (isInvite && sub) sub.textContent = 'Welcome - set your password to finish setup';
    showResetForm();
    return;
  }

  if (data && data.session && data.session.user) {
    await initAppFromUser(data.session.user);
    return;
  }
  // No active session — show sign-in form
  showSigninForm();
};
