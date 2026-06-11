document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await window.supabaseClient.auth.getSession();
  if (session) {
    await _onAuthSuccess(session.user);
  } else {
    renderLoginScreen();
  }

  // Mantener sesión sincronizada si el usuario cierra desde otra pestaña
  window.supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' && window._currentUser) {
      window._currentUser = null;
      window._currentUserRole = null;
      const bar = document.getElementById('sp-topbar');
      if (bar) bar.style.display = 'none';
      renderLoginScreen();
    }
  });
});
