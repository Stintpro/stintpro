// StintPro — /api/admin con Firebase Admin falso. Ejecutar: node tests/api-admin.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert');
const path = require('path');
const Module = require('module');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const API = path.join(__dirname, '..', 'api');
function load(fakes) {
  const orig = Module._load;
  Module._load = function (req, ...rest) { return fakes[req] || orig.call(this, req, ...rest); };
  try {
    for (const k of Object.keys(require.cache)) if (k.startsWith(API)) delete require.cache[k];
    return require(path.join(API, 'admin.js'));
  } finally { Module._load = orig; }
}
function call(handler, body, token = 'admin') {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, body: undefined, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve(this); return this; },
      end() { resolve(this); return this; },
    };
    Promise.resolve(handler({ method: 'POST', body, headers: token ? { authorization: 'Bearer ' + token } : {} }, res)).then(() => resolve(res));
  });
}

// Auth falsa: 'admin' → uid a1 con claim; 'user' → uid u1 sin claim.
function rig() {
  const st = { users: [
    { uid: 'a1', email: 'yo@x.com', displayName: 'Yo', customClaims: { admin: true }, metadata: { creationTime: 'Mon, 26 Oct 2026 10:00:00 GMT' } },
    { uid: 'u1', email: 'pepe@x.com', displayName: '', customClaims: null, metadata: { creationTime: 'Mon, 26 Oct 2026 11:00:00 GMT' } },
  ], calls: [] };
  const auth = {
    verifyIdToken: async (t) => {
      if (t === 'admin') return { uid: 'a1', admin: true };
      if (t === 'user') return { uid: 'u1' };
      throw new Error('bad');
    },
    listUsers: async () => ({ users: st.users }),
    createUser: async (p) => {
      st.calls.push(['createUser', p]);
      if (st.users.some(u => u.email === p.email)) { const e = new Error('x'); e.code = 'auth/email-already-exists'; throw e; }
      const u = { uid: 'n' + st.users.length, email: p.email, displayName: p.displayName, customClaims: null, metadata: {} };
      st.users.push(u); return u;
    },
    setCustomUserClaims: async (uid, c) => { st.calls.push(['setCustomUserClaims', uid, c]); },
    deleteUser: async (uid) => { st.calls.push(['deleteUser', uid]); },
  };
  const fa = { apps: [], initializeApp: () => ({ auth: () => auth }), credential: { cert: (x) => x } };
  return { st, h: load({ 'firebase-admin': fa }) };
}

(async () => {
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'stintpro-test' });

  await test('sin token → 401; usuario normal → 403', async () => {
    const { h } = rig();
    strictEqual((await call(h, { action: 'list-users' }, null)).statusCode, 401);
    strictEqual((await call(h, { action: 'list-users' }, 'user')).statusCode, 403);
  });

  await test('list-users devuelve id/email/name/role/created_at', async () => {
    const { h } = rig();
    const r = await call(h, { action: 'list-users' });
    strictEqual(r.statusCode, 200);
    deepStrictEqual(r.body.users[0], { id: 'a1', email: 'yo@x.com', name: 'Yo', role: 'admin', created_at: 'Mon, 26 Oct 2026 10:00:00 GMT' });
    strictEqual(r.body.users[1].role, 'user');
  });

  await test('create-user con rol admin pone el claim', async () => {
    const { h, st } = rig();
    const r = await call(h, { action: 'create-user', email: 'ana@x.com', name: 'Ana', password: 'secreta1', role: 'admin' });
    strictEqual(r.statusCode, 200); ok(r.body.ok);
    deepStrictEqual(st.calls[0], ['createUser', { email: 'ana@x.com', password: 'secreta1', displayName: 'Ana' }]);
    deepStrictEqual(st.calls[1], ['setCustomUserClaims', r.body.userId, { admin: true }]);
  });

  await test('create-user sin contraseña → 400', async () => {
    const { h } = rig();
    strictEqual((await call(h, { action: 'create-user', email: 'ana@x.com' })).statusCode, 400);
  });

  await test('invite-user crea la cuenta sin contraseña', async () => {
    const { h, st } = rig();
    const r = await call(h, { action: 'invite-user', email: 'luis@x.com', name: '' });
    strictEqual(r.statusCode, 200);
    deepStrictEqual(st.calls[0], ['createUser', { email: 'luis@x.com', displayName: 'luis' }]);
  });

  await test('email repetido → 400 con mensaje en español', async () => {
    const { h } = rig();
    const r = await call(h, { action: 'invite-user', email: 'pepe@x.com' });
    strictEqual(r.statusCode, 400);
    strictEqual(r.body.error, 'Ya existe una cuenta con ese email');
  });

  await test('set-role: dar y quitar admin; no a uno mismo', async () => {
    const { h, st } = rig();
    strictEqual((await call(h, { action: 'set-role', userId: 'u1', role: 'admin' })).statusCode, 200);
    deepStrictEqual(st.calls[0], ['setCustomUserClaims', 'u1', { admin: true }]);
    strictEqual((await call(h, { action: 'set-role', userId: 'u1', role: 'user' })).statusCode, 200);
    deepStrictEqual(st.calls[1], ['setCustomUserClaims', 'u1', {}]);
    strictEqual((await call(h, { action: 'set-role', userId: 'a1', role: 'user' })).statusCode, 400);
  });

  await test('delete-user: borra a otro; no a uno mismo', async () => {
    const { h, st } = rig();
    strictEqual((await call(h, { action: 'delete-user', userId: 'u1' })).statusCode, 200);
    deepStrictEqual(st.calls[0], ['deleteUser', 'u1']);
    strictEqual((await call(h, { action: 'delete-user', userId: 'a1' })).statusCode, 400);
  });

  await test('acción desconocida → 400', async () => {
    const { h } = rig();
    strictEqual((await call(h, { action: 'list-requests' })).statusCode, 400);
  });

  await test('sin FIREBASE_SERVICE_ACCOUNT → 500', async () => {
    const saved = process.env.FIREBASE_SERVICE_ACCOUNT;
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    try { const { h } = rig(); strictEqual((await call(h, { action: 'list-users' })).statusCode, 500); }
    finally { process.env.FIREBASE_SERVICE_ACCOUNT = saved; }
  });

  console.log(`\n${passed} pasan, ${failed} fallan\n`);
  process.exit(failed ? 1 : 0);
})();
