// StintPro — SPAuth (src/firebase-auth.js) con un firebase compat falso.
// Ejecutar: node tests/firebase-auth.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert');
const A = require('../src/firebase-auth');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const CFG = { apiKey: 'k', authDomain: 'p.firebaseapp.com', projectId: 'p', appId: '1:2:web:3' };

function fakeFirebase({ signedIn = null, claims = {} } = {}) {
  const st = { calls: [] };
  const mkUser = (email) => ({
    email, displayName: email === 'yo@x.com' ? 'Yo' : '',
    getIdToken: async (f) => { st.calls.push(['getIdToken', !!f]); return 'tok-' + email; },
    getIdTokenResult: async () => ({ claims }),
    reauthenticateWithCredential: async (c) => { st.calls.push(['reauth', c]); },
  });
  const auth = {
    currentUser: signedIn ? mkUser(signedIn) : null,
    onAuthStateChanged(cb) { setTimeout(() => cb(auth.currentUser), 0); return () => {}; },
    signInWithEmailAndPassword: async (email, pw) => {
      if (pw !== 'bien') { const e = new Error('x'); e.code = 'auth/invalid-credential'; throw e; }
      auth.currentUser = mkUser(email); return { user: auth.currentUser };
    },
    signOut: async () => { auth.currentUser = null; },
    sendPasswordResetEmail: async (email, s) => { st.calls.push(['reset', email, s]); },
  };
  const fb = {
    apps: [], initializeApp: (c) => { st.calls.push(['init', c]); fb.apps.push(1); return { auth: () => auth }; },
    app: () => ({ auth: () => auth }),
    auth: { EmailAuthProvider: { credential: (e, p) => ({ e, p }) } },
  };
  return { fb, st, auth };
}

(async () => {
  await test('sin configuración → configured=false, ready() null y signIn rechaza con mensaje claro', async () => {
    const { fb } = fakeFirebase();
    const S = A.create(fb, { apiKey: '', authDomain: '', projectId: '', appId: '' });
    strictEqual(S.configured, false);
    strictEqual(await S.ready(), null);
    let msg = '';
    try { await S.signIn('a@b.c', 'x'); } catch (e) { msg = S.errorMessage(e); }
    strictEqual(msg, 'El login no está configurado todavía');
    strictEqual(await S.idToken(), '');
  });

  await test('inicializa Firebase una sola vez con la configuración', async () => {
    const { fb, st } = fakeFirebase();
    A.create(fb, CFG); A.create(fb, CFG);
    deepStrictEqual(st.calls.filter(c => c[0] === 'init'), [['init', CFG]]);
  });

  await test('ready() resuelve con el usuario de la sesión guardada', async () => {
    const { fb } = fakeFirebase({ signedIn: 'yo@x.com' });
    const S = A.create(fb, CFG);
    strictEqual((await S.ready()).email, 'yo@x.com');
    strictEqual(S.name(), 'Yo');
  });

  await test('signIn correcto → usuario; incorrecto → mensaje en español', async () => {
    const { fb } = fakeFirebase();
    const S = A.create(fb, CFG);
    strictEqual((await S.signIn('pepe@x.com', 'bien')).email, 'pepe@x.com');
    strictEqual(S.name(), 'pepe@x.com');
    let msg = '';
    try { await S.signIn('pepe@x.com', 'mal'); } catch (e) { msg = S.errorMessage(e); }
    strictEqual(msg, 'Email o contraseña incorrectos');
  });

  await test('idToken: "" sin sesión; token con sesión; force se pasa', async () => {
    const { fb, st } = fakeFirebase();
    const S = A.create(fb, CFG);
    strictEqual(await S.idToken(), '');
    await S.signIn('pepe@x.com', 'bien');
    strictEqual(await S.idToken(true), 'tok-pepe@x.com');
    deepStrictEqual(st.calls.find(c => c[0] === 'getIdToken'), ['getIdToken', true]);
  });

  await test('isAdmin lee el claim admin === true', async () => {
    strictEqual(await A.create(fakeFirebase({ signedIn: 'yo@x.com', claims: { admin: true } }).fb, CFG).isAdmin(), true);
    strictEqual(await A.create(fakeFirebase({ signedIn: 'yo@x.com', claims: { admin: 'si' } }).fb, CFG).isAdmin(), false);
    strictEqual(await A.create(fakeFirebase().fb, CFG).isAdmin(), false);
  });

  await test('sendReset vuelve a /landing.html del origen', async () => {
    const { fb, st } = fakeFirebase();
    const S = A.create(fb, CFG, { origin: 'https://stintpro.vercel.app' });
    await S.sendReset('pepe@x.com');
    deepStrictEqual(st.calls.find(c => c[0] === 'reset'), ['reset', 'pepe@x.com', { url: 'https://stintpro.vercel.app/landing.html' }]);
  });

  await test('withRecentLogin reautentica y reintenta si Firebase lo pide', async () => {
    const { fb, st } = fakeFirebase({ signedIn: 'yo@x.com' });
    const S = A.create(fb, CFG);
    let n = 0;
    const r = await S.withRecentLogin(async () => {
      n++; if (n === 1) { const e = new Error('x'); e.code = 'auth/requires-recent-login'; throw e; }
      return 'hecho';
    }, () => 'clave');
    strictEqual(r, 'hecho'); strictEqual(n, 2);
    deepStrictEqual(st.calls.find(c => c[0] === 'reauth'), ['reauth', { e: 'yo@x.com', p: 'clave' }]);
  });

  await test('withRecentLogin sin contraseña introducida → relanza el error', async () => {
    const { fb } = fakeFirebase({ signedIn: 'yo@x.com' });
    const S = A.create(fb, CFG);
    let code = '';
    try { await S.withRecentLogin(async () => { const e = new Error('x'); e.code = 'auth/requires-recent-login'; throw e; }, () => null); }
    catch (e) { code = e.code; }
    strictEqual(code, 'auth/requires-recent-login');
  });

  await test('errorMessage: red, demasiados intentos y genérico', async () => {
    strictEqual(A.errorMessage({ code: 'auth/network-request-failed' }), 'Error de red. Comprueba la conexión.');
    strictEqual(A.errorMessage({ code: 'auth/too-many-requests' }), 'Demasiados intentos. Espera unos minutos.');
    strictEqual(A.errorMessage({ code: 'auth/otra-cosa' }), 'No se ha podido completar. Inténtalo de nuevo.');
    strictEqual(A.errorMessage(null), 'No se ha podido completar. Inténtalo de nuevo.');
  });

  await test('signOut cierra la sesión', async () => {
    const { fb } = fakeFirebase({ signedIn: 'yo@x.com' });
    const S = A.create(fb, CFG);
    await S.signOut();
    strictEqual(S.user(), null);
  });

  console.log(`\n${passed} OK, ${failed} fallos\n`);
  if (failed) process.exit(1);
})();
