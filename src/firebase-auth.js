// ── firebase-auth.js — sesión de StintPro con Firebase Authentication ──
// Única pieza de login del navegador: landing, index, hub, admin, profile, el
// conector del logger y el ingeniero de IA usan window.SPAuth. Depende del SDK
// compat (firebase-app-compat + firebase-auth-compat) y de window.FIREBASE_CONFIG.
// El ID token (1 h) lo renueva solo el SDK; getIdToken() devuelve uno vigente.
// Funciona en browser (window.SPAuth) y Node.js (tests/firebase-auth.test.js).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SPAuth = api.create(root.firebase, root.FIREBASE_CONFIG, { origin: root.location && root.location.origin });
})(typeof window !== 'undefined' ? window : this, function () {
  const MESSAGES = {
    'sp/not-configured':            'El login no está configurado todavía',
    'auth/invalid-credential':      'Email o contraseña incorrectos',
    'auth/invalid-login-credentials': 'Email o contraseña incorrectos',
    'auth/wrong-password':          'Email o contraseña incorrectos',
    'auth/user-not-found':          'Email o contraseña incorrectos',
    'auth/invalid-email':           'El email no es válido',
    'auth/missing-password':        'Introduce la contraseña',
    'auth/user-disabled':           'Esta cuenta está desactivada',
    'auth/too-many-requests':       'Demasiados intentos. Espera unos minutos.',
    'auth/network-request-failed':  'Error de red. Comprueba la conexión.',
    'auth/requires-recent-login':   'Por seguridad, vuelve a introducir tu contraseña',
    'auth/weak-password':           'La contraseña debe tener al menos 6 caracteres',
    'auth/email-already-in-use':    'Ya existe una cuenta con ese email',
  };
  const errorMessage = (e) => (e && MESSAGES[e.code]) || 'No se ha podido completar. Inténtalo de nuevo.';
  const isConfigured = (c) => !!(c && c.apiKey && c.authDomain && c.projectId && c.appId);

  function create(fb, cfg, opts) {
    const o = opts || {};
    const configured = !!fb && isConfigured(cfg);
    let auth = null;
    if (configured) {
      const app = (fb.apps && fb.apps.length) ? fb.app() : fb.initializeApp(cfg);
      auth = app.auth();
    }
    const notConfigured = () => Promise.reject(Object.assign(new Error('El login no está configurado todavía'), { code: 'sp/not-configured' }));

    let readyP = null;
    function ready() {
      if (!auth) return Promise.resolve(null);
      if (!readyP) readyP = new Promise((resolve) => {
        const off = auth.onAuthStateChanged((u) => { if (typeof off === 'function') off(); resolve(u || null); });
      });
      return readyP;
    }
    const user = () => (auth && auth.currentUser) || null;

    async function signIn(email, password) {
      if (!auth) return notConfigured();
      const cred = await auth.signInWithEmailAndPassword(email, password);
      return cred.user;
    }
    const signOut = () => (auth ? auth.signOut() : Promise.resolve());
    function sendReset(email) {
      if (!auth) return notConfigured();
      return auth.sendPasswordResetEmail(email, { url: (o.origin || '') + '/landing.html' });
    }
    async function idToken(force) {
      const u = user();
      return u ? u.getIdToken(!!force) : '';
    }
    async function isAdmin() {
      const u = user();
      if (!u) return false;
      const r = await u.getIdTokenResult();
      return !!(r && r.claims && r.claims.admin === true);
    }
    function name() {
      const u = user();
      return u ? (u.displayName || u.email || '') : '';
    }
    // Operaciones sensibles (cambiar contraseña/email, borrar cuenta): si Firebase
    // pide un login reciente, se pide la contraseña, se reautentica y se reintenta.
    async function withRecentLogin(fn, askPassword) {
      try { return await fn(); }
      catch (e) {
        if (!e || e.code !== 'auth/requires-recent-login') throw e;
        const u = user();
        const pw = askPassword ? askPassword() : null;
        if (!u || !pw) throw e;
        await u.reauthenticateWithCredential(fb.auth.EmailAuthProvider.credential(u.email, pw));
        return fn();
      }
    }

    return { configured, ready, user, signIn, signOut, sendReset, idToken, isAdmin, name, withRecentLogin, errorMessage };
  }

  return { create, errorMessage, isConfigured };
});
