# Login con Firebase Authentication — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sustituir Supabase (proyecto perdido) por Firebase Authentication en la web, las funciones de Vercel y el logger del VPS, con circuitos y modo demo en el código.

**Architecture:** el navegador usa una sola pieza, `window.SPAuth` (`src/firebase-auth.js`), sobre el SDK compat de Firebase; las funciones de Vercel comprueban el pase con `firebase-admin` a través de `api/_firebase.js`; el logger verifica los ID tokens de Firebase (RS256) con las claves públicas de Google, sin secretos. Rol = custom claim `admin: true`.

**Tech Stack:** JS de navegador sin build, Firebase JS SDK compat 10.14.1 (jsDelivr), `firebase-admin` 12.7.0 (Vercel), Node `crypto` (logger), tests Node `assert` (`tests/`) y Jest (`stintpro-logger/__tests__`).

**Spec:** `docs/superpowers/specs/2026-10-26-login-firebase-design.md`

## Global Constraints

- SDK del navegador: `https://cdn.jsdelivr.net/npm/firebase@10.14.1/firebase-app-compat.js` y `https://cdn.jsdelivr.net/npm/firebase@10.14.1/firebase-auth-compat.js` (en este orden, antes de `firebase-config.js` y `firebase-auth.js`).
- Servidor: `firebase-admin` versión exacta `12.7.0`; variable de entorno `FIREBASE_SERVICE_ACCOUNT` (JSON completo). Ninguna clave secreta en el repo.
- Logger: `FIREBASE_PROJECT_ID` por entorno; claves de `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`; `alg === 'RS256'`; `aud === FIREBASE_PROJECT_ID`; `iss === 'https://securetoken.google.com/' + FIREBASE_PROJECT_ID`; `exp > ahora`; `iat` y `auth_time` ≤ ahora + 60 s; `sub` no vacío.
- Rol admin = custom claim `admin: true`; nombre = `displayName`.
- La configuración web de Firebase la da el usuario; hasta entonces `src/firebase-config.js` lleva valores vacíos y el login dice «El login no está configurado todavía».
- Mensajes de error en español; «Error de red. Comprueba la conexión.» solo para `auth/network-request-failed`.
- Sin Firestore ni otra base de datos. Circuitos solo en `_CIRCUIT_CATALOG`.
- **No subir nada (`git push`) ni tocar el VPS sin permiso explícito del usuario.** Commits locales.

## Mapa de ficheros

| Fichero | Qué hace |
|---|---|
| `stintpro-logger/server.js` (mod.) | `verifyFirebaseIdToken` en lugar de `verifySupabaseJwt` |
| `stintpro-logger/__tests__/read-auth.test.js` (reescribir) | tests RS256 + lecturas/WS |
| `api/_firebase.js` (crear) | init de `firebase-admin`, `verifyRequest`, `requireAdmin`, `auth` |
| `api/ai-engineer.js` (mod.) | auth con `verifyRequest` |
| `api/admin.js` (reescribir) | usuarios con Firebase Admin |
| `api/profile.js` (borrar) | lo hace el navegador |
| `tests/api-security.test.js` (mod.) | fakes de `firebase-admin` |
| `tests/api-admin.test.js` (crear) | tests de `api/admin.js` |
| `package.json` (mod.) | fuera supabase-js, dentro firebase-admin 12.7.0 |
| `src/firebase-config.js` (crear) | `window.FIREBASE_CONFIG` (público) |
| `src/firebase-auth.js` (crear) | `window.SPAuth` |
| `tests/firebase-auth.test.js` (crear) | tests de `SPAuth` con firebase falso |
| `src/landing.html`, `src/index.html`, `src/hub.html`, `src/profile.html`, `src/admin.html` (mod.) | usar `SPAuth` |
| `src/logger-connector.js`, `src/en-ai-engineer.js` (mod.) | token con `SPAuth.idToken()` |
| `src/circuits.js`, `src/app.js` (mod.) | fuera Supabase; +7 circuitos |
| `tests/circuit-coords.test.js` (mod.) | rango Europa + lista sin coordenadas |
| `src/supabase.js`, `src/supabase-config.js` (borrar) | código muerto |
| `vercel.json` (mod.) | CSP |
| `tools/firebase-set-admin.js` (crear), `.gitignore` (mod.) | primer admin |

---

### Task 1: Logger — verificar ID tokens de Firebase

**Files:**
- Modify: `stintpro-logger/server.js:16-82` (bloque «Verificación de JWT de Supabase») y sus usos en `:145`, `:975`, `:1153`
- Rewrite: `stintpro-logger/__tests__/read-auth.test.js`

**Interfaces:**
- Produces: `verifyFirebaseIdToken(token) → Promise<payload|null>` (nunca lanza) y `_injectJwksForTest(keys)` exportadas por `server.js`.

- [ ] **Step 1: Reescribir el test** — `stintpro-logger/__tests__/read-auth.test.js` con este contenido completo:

```js
'use strict';

// Cobertura del control de autenticación de LECTURAS:
//   - verifyFirebaseIdToken: ID token de Firebase (RS256) verificado con crypto
//     nativo contra las claves públicas de Google (inyectadas en el test).
//   - readAuth y WS: aceptan API key O ID token de Firebase, con enforcement
//     controlado por ENFORCE_READ_AUTH.

const http   = require('http');
const crypto = require('crypto');
const { WebSocket } = require('ws');
const { verifyFirebaseIdToken, _injectJwksForTest } = require('../server');
const { createTestServer } = require('./helpers/test-server');

const VALID_KEY = 'test-key-abc';
const KID = 'test-kid-1';
const PROJECT = 'stintpro-test';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);

let privateKey;

function makeJwt(payload, { priv = privateKey, kid = KID, alg = 'RS256' } = {}) {
  const header = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const body   = b64url(JSON.stringify(payload));
  const sig    = crypto.sign('sha256', Buffer.from(header + '.' + body), priv);
  return header + '.' + body + '.' + b64url(sig);
}

// Payload de un ID token de Firebase válido para PROJECT; `over` lo modifica.
function claims(over = {}) {
  const t = now();
  return Object.assign({
    iss: 'https://securetoken.google.com/' + PROJECT,
    aud: PROJECT, sub: 'user-123', user_id: 'user-123',
    iat: t - 10, auth_time: t - 10, exp: t + 3600,
  }, over);
}

let prevProject;
beforeAll(() => {
  prevProject = process.env.FIREBASE_PROJECT_ID;
  process.env.FIREBASE_PROJECT_ID = PROJECT;
  const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = kp.privateKey;
  const jwk = kp.publicKey.export({ format: 'jwk' });
  jwk.kid = KID; jwk.alg = 'RS256'; jwk.use = 'sig';
  _injectJwksForTest([jwk]);
});
afterAll(() => {
  if (prevProject === undefined) delete process.env.FIREBASE_PROJECT_ID;
  else process.env.FIREBASE_PROJECT_ID = prevProject;
});

// ── verifyFirebaseIdToken ────────────────────────────────────────────────────

describe('verifyFirebaseIdToken (RS256 / claves de Google)', () => {
  test('token válido → devuelve payload', async () => {
    const p = await verifyFirebaseIdToken(makeJwt(claims()));
    expect(p).toBeTruthy();
    expect(p.sub).toBe('user-123');
  });

  test('caducado → null', async () => {
    expect(await verifyFirebaseIdToken(makeJwt(claims({ exp: now() - 10 })))).toBeNull();
  });

  test('aud de otro proyecto → null', async () => {
    expect(await verifyFirebaseIdToken(makeJwt(claims({ aud: 'otro' })))).toBeNull();
  });

  test('iss de otro proyecto → null', async () => {
    expect(await verifyFirebaseIdToken(makeJwt(claims({ iss: 'https://securetoken.google.com/otro' })))).toBeNull();
  });

  test('iat en el futuro (> 60 s) → null', async () => {
    expect(await verifyFirebaseIdToken(makeJwt(claims({ iat: now() + 600 })))).toBeNull();
  });

  test('auth_time en el futuro (> 60 s) → null', async () => {
    expect(await verifyFirebaseIdToken(makeJwt(claims({ auth_time: now() + 600 })))).toBeNull();
  });

  test('sub vacío → null', async () => {
    expect(await verifyFirebaseIdToken(makeJwt(claims({ sub: '' })))).toBeNull();
  });

  test('kid desconocido → null', async () => {
    expect(await verifyFirebaseIdToken(makeJwt(claims(), { kid: 'otro-kid' }))).toBeNull();
  });

  test('firmado con otra clave → null', async () => {
    const otra = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expect(await verifyFirebaseIdToken(makeJwt(claims(), { priv: otra }))).toBeNull();
  });

  test('alg distinto de RS256 (none) → null', async () => {
    const tok = b64url(JSON.stringify({ alg: 'none', kid: KID })) + '.' + b64url(JSON.stringify(claims())) + '.';
    expect(await verifyFirebaseIdToken(tok)).toBeNull();
  });

  test('payload manipulado tras firmar → null', async () => {
    const parts = makeJwt(claims()).split('.');
    parts[1] = b64url(JSON.stringify(claims({ sub: 'ATACANTE' })));
    expect(await verifyFirebaseIdToken(parts.join('.'))).toBeNull();
  });

  test('sin FIREBASE_PROJECT_ID → null', async () => {
    const tok = makeJwt(claims());
    delete process.env.FIREBASE_PROJECT_ID;
    try { expect(await verifyFirebaseIdToken(tok)).toBeNull(); }
    finally { process.env.FIREBASE_PROJECT_ID = PROJECT; }
  });

  test('basura / vacío → null', async () => {
    expect(await verifyFirebaseIdToken('no.es.jwt')).toBeNull();
    expect(await verifyFirebaseIdToken('')).toBeNull();
    expect(await verifyFirebaseIdToken(null)).toBeNull();
  });
});

// ── readAuth y WS con ENFORCE_READ_AUTH=true ─────────────────────────────────

describe('readAuth — enforcement activado', () => {
  let baseUrl, wsUrl, server, prevEnforce;

  beforeAll(async () => {
    prevEnforce = process.env.ENFORCE_READ_AUTH;
    process.env.ENFORCE_READ_AUTH = 'true';
    // BD real (temporal por worker): sin ella las lecturas autenticadas daban 500
    // y los tests "no 401" pasaban igual.
    await require('../db').init();
    const r = await createTestServer({ apiKey: VALID_KEY });
    baseUrl = r.baseUrl; wsUrl = r.wsUrl; server = r.server;
  });

  afterAll(() => new Promise(resolve => {
    if (prevEnforce === undefined) delete process.env.ENFORCE_READ_AUTH;
    else process.env.ENFORCE_READ_AUTH = prevEnforce;
    server.close(resolve);
  }));

  function get(path, headers = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(baseUrl + path);
      const r = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'GET', headers }, res => {
        let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode }));
      });
      r.on('error', reject); r.end();
    });
  }

  test('lectura sin credencial → 401', async () => {
    expect((await get('/api/sessions')).status).toBe(401);
  });

  test('lectura con API key → 200', async () => {
    expect((await get('/api/sessions', { 'X-API-Key': VALID_KEY })).status).toBe(200);
  });

  test('lectura con ID token de Firebase válido → 200', async () => {
    expect((await get('/api/sessions', { Authorization: 'Bearer ' + makeJwt(claims()) })).status).toBe(200);
  });

  test('lectura con token firmado por otra clave → 401', async () => {
    const otra = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expect((await get('/api/sessions', { Authorization: 'Bearer ' + makeJwt(claims(), { priv: otra }) })).status).toBe(401);
  });

  test('lectura con token caducado → 401', async () => {
    expect((await get('/api/sessions', { Authorization: 'Bearer ' + makeJwt(claims({ exp: now() - 10 })) })).status).toBe(401);
  });

  test('relevos de piloto de una sesión: exige auth y responde con API key', async () => {
    expect((await get('/api/drivers/1')).status).toBe(401);
    expect((await get('/api/drivers/1', { 'X-API-Key': VALID_KEY })).status).toBe(200);
    expect((await get('/api/drivers/abc', { 'X-API-Key': VALID_KEY })).status).toBe(400);
  });

  test('/api/status permanece abierto (no exige auth)', async () => {
    expect((await get('/api/status')).status).toBe(200);
  });

  // Autentica por WS y devuelve el type del primer mensaje ('auth_ok' | 'error').
  function wsAuth(authMsg) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => { ws.close(); resolve('timeout'); }, 4000);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', ...authMsg })));
      ws.on('message', (raw) => {
        clearTimeout(timer);
        let m; try { m = JSON.parse(raw.toString()); } catch { m = {}; }
        ws.close();
        resolve(m.type);
      });
      ws.on('error', reject);
    });
  }

  test('WS auth con ID token válido → auth_ok', async () => {
    expect(await wsAuth({ token: makeJwt(claims()) })).toBe('auth_ok');
  });

  test('WS auth con API key → auth_ok', async () => {
    expect(await wsAuth({ apikey: VALID_KEY })).toBe('auth_ok');
  });

  test('WS auth con token inválido y sin key → error', async () => {
    expect(await wsAuth({ token: 'no.es.jwt' })).toBe('error');
  });
});
```

- [ ] **Step 2: Ejecutarlo y ver que falla**

Run: `cd stintpro-logger && npx jest __tests__/read-auth.test.js`
Expected: FAIL (`verifyFirebaseIdToken is not a function`).

- [ ] **Step 3: Implementar** — en `stintpro-logger/server.js`, sustituir desde el comentario `// ── Verificación de JWT de Supabase (ES256, clave pública vía JWKS) ──` hasta la línea `let _jwksCache = { keys: [], at: 0 };` (inclusive) por:

```js
// ── Verificación de ID tokens de Firebase (RS256, claves públicas de Google) ──
// Sin secretos: descarga las claves PÚBLICAS de Google y verifica firma, emisor,
// proyecto y fechas. Usado por readAuth y por el auth del WS (además de la API key).
const _JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let _jwksCache = { keys: [], at: 0 };
```

y sustituir la función `verifySupabaseJwt` completa (desde su comentario `// Devuelve el payload si el token es válido (firma ES256 + no caducado); si no, null.`) por:

```js
// Devuelve el payload si el ID token de Firebase es válido; si no, null.
// Nunca lanza: pensado para usarse con `await` sin try/catch en el llamante.
async function verifyFirebaseIdToken(token) {
  try {
    const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
    if (!projectId) return null;                         // sin proyecto configurado ningún token vale
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const header = _b64urlToJson(h);
    if (header.alg !== 'RS256') return null;             // pin de algoritmo (evita alg:none / confusión de tipo)
    const jwk = await _getJwk(header.kid);
    if (!jwk) return null;
    const pubKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const ok = crypto.verify('sha256', Buffer.from(h + '.' + p), pubKey, Buffer.from(s, 'base64url'));
    if (!ok) return null;
    const payload = _b64urlToJson(p);
    const t = Math.floor(Date.now() / 1000), SKEW = 60;
    if (payload.aud !== projectId) return null;
    if (payload.iss !== 'https://securetoken.google.com/' + projectId) return null;
    if (!(payload.exp > t)) return null;
    if (!(payload.iat <= t + SKEW)) return null;
    if (!(payload.auth_time <= t + SKEW)) return null;
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    return payload;
  } catch (e) {
    return null;
  }
}
```

Después, en el mismo fichero:
- en `readAuth`, el comentario `//   (b) JWT de Supabase (Authorization: Bearer …) → usado por la app web/Electron` pasa a `//   (b) ID token de Firebase (Authorization: Bearer …) → usado por la app web`, y `await verifySupabaseJwt(token)` pasa a `await verifyFirebaseIdToken(token)`;
- en el WS, `// Acepta la API key (paneles/admin) O un JWT de Supabase (app con sesión).` pasa a `// Acepta la API key (paneles/admin) O un ID token de Firebase (app con sesión).`, `await verifySupabaseJwt(msg.token)` pasa a `await verifyFirebaseIdToken(msg.token)`, y en el comentario de la carrera de auth (`…terminara el await a verifySupabaseJwt del…`) `verifySupabaseJwt` pasa a `verifyFirebaseIdToken`;
- `module.exports = { createServer, start, verifySupabaseJwt, _injectJwksForTest };` pasa a `module.exports = { createServer, start, verifyFirebaseIdToken, _injectJwksForTest };`.

- [ ] **Step 4: Comprobar que no queda Supabase en el logger y pasar sus tests**

Run: `cd stintpro-logger && grep -n -i "supabase" server.js; npx jest`
Expected: el grep no imprime nada; Jest todo verde (los 9+ suites).

- [ ] **Step 5: Commit**

```bash
git add stintpro-logger/server.js stintpro-logger/__tests__/read-auth.test.js
git commit -m "feat(logger): verificar ID tokens de Firebase en lugar de JWT de Supabase"
```

---

### Task 2: Funciones de Vercel — `_firebase.js` y `ai-engineer.js`

**Files:**
- Create: `api/_firebase.js`
- Modify: `api/ai-engineer.js:1-8` y `:69-85`, `:100`
- Delete: `api/profile.js`
- Modify: `tests/api-security.test.js` (bloque `/api/ai-engineer`), `package.json`

**Interfaces:**
- Produces (`require('./_firebase')`): `verifyRequest(req) → Promise<decodedToken|null>`, `requireAdmin(req, res) → Promise<decodedToken|null>` (ya respondió 500/401/403 si devuelve null), `auth() → firebase-admin Auth | null`, `configured() → boolean`.

- [ ] **Step 1: Test que falla** — en `tests/api-security.test.js`, sustituir desde `  process.env.SUPABASE_URL = 'https://x.supabase.co';` hasta la línea `  const q = (question, type = 'query') => …` (inclusive) por:

```js
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'stintpro-test' });
  process.env.ANTHROPIC_API_KEY = 'k';
  // firebase-admin falso: verifyIdToken acepta solo el token 'valido'.
  function fakeFirebaseAdmin() {
    const auth = { verifyIdToken: async (t) => { if (t !== 'valido') throw new Error('bad'); return { uid: 'u1' }; } };
    return { apps: [], initializeApp: () => ({ auth: () => auth }), credential: { cert: (x) => x } };
  }
  function aiFakes() {
    const st = { anthropicCalls: 0 };
    function Anthropic() { this.messages = { create: async () => { st.anthropicCalls++; return { content: [{ type: 'text', text: 'ok' }] }; } }; }
    return { st, fakes: { 'firebase-admin': fakeFirebaseAdmin(), '@anthropic-ai/sdk': Anthropic } };
  }
  const auth = { authorization: 'Bearer valido' };
  const q = (question, type = 'query', headers = auth) => ({ method: 'POST', headers, body: { type, snapshot: {}, question } });
```

y sustituir el test `'SECURITY-1: usuario sin perfil (no invitado) → 403'` completo por:

```js
  await test('SECURITY-1: token inválido → 401 sin llamar a la IA', async () => {
    const { st, fakes } = aiFakes();
    const h = load('ai-engineer.js', fakes);
    strictEqual((await call(h, q('¿paro?', 'query', { authorization: 'Bearer falso' }))).statusCode, 401);
    strictEqual(st.anthropicCalls, 0);
  });

  await test('SECURITY-1: sin cabecera Authorization → 401', async () => {
    const { st, fakes } = aiFakes();
    const h = load('ai-engineer.js', fakes);
    strictEqual((await call(h, q('¿paro?', 'query', {}))).statusCode, 401);
    strictEqual(st.anthropicCalls, 0);
  });
```

Y cambiar el comentario de `load()` `// con dependencias falsas para @supabase/supabase-js y @anthropic-ai/sdk.` por `// con dependencias falsas para firebase-admin y @anthropic-ai/sdk.`

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `node tests/api-security.test.js`
Expected: fallan los tests de `/api/ai-engineer` (sigue pidiendo `@supabase/supabase-js`/`SUPABASE_URL`).

- [ ] **Step 3: Crear `api/_firebase.js`**

```js
// Firebase Admin compartido por las funciones de Vercel. El "_" del nombre hace
// que Vercel no lo publique como función: solo se importa.
// Variable de entorno: FIREBASE_SERVICE_ACCOUNT = JSON completo de la cuenta de
// servicio (Firebase → Configuración → Cuentas de servicio). NUNCA en el cliente.
const admin = require('firebase-admin');

let _app = null;

function app() {
  if (_app) return _app;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  let cred;
  try { cred = JSON.parse(raw); } catch (e) { return null; }
  _app = (admin.apps && admin.apps.length) ? admin.app() : admin.initializeApp({ credential: admin.credential.cert(cred) });
  return _app;
}

const configured = () => !!app();
const auth = () => { const a = app(); return a ? a.auth() : null; };

function bearer(req) {
  const h = (req.headers && req.headers.authorization) || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

// ID token de Firebase de la cabecera Authorization → token decodificado o null.
async function verifyRequest(req) {
  const t = bearer(req), a = auth();
  if (!t || !a) return null;
  try { return await a.verifyIdToken(t); } catch (e) { return null; }
}

// Exige un admin (custom claim admin:true). Si no, responde y devuelve null.
async function requireAdmin(req, res) {
  if (!configured()) { res.status(500).json({ error: 'Servidor no configurado (FIREBASE_SERVICE_ACCOUNT)' }); return null; }
  const d = await verifyRequest(req);
  if (!d) { res.status(401).json({ error: 'Token inválido' }); return null; }
  if (d.admin !== true) { res.status(403).json({ error: 'Se requiere rol admin' }); return null; }
  return d;
}

module.exports = { verifyRequest, requireAdmin, auth, configured };
```

- [ ] **Step 4: Adaptar `api/ai-engineer.js`**
  - Cabecera: sustituir las líneas
    ```js
    //   SUPABASE_URL         → igual que en supabase-config.js
    //   SUPABASE_SERVICE_KEY → Settings → API → service_role (NUNCA en el cliente)
    ```
    por `//   FIREBASE_SERVICE_ACCOUNT → JSON de la cuenta de servicio de Firebase (NUNCA en el cliente)`, y `const { createClient } = require('@supabase/supabase-js');` por `const { verifyRequest, configured } = require('./_firebase');`.
  - Sustituir el bloque desde `  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();` hasta `  if (!profile) return res.status(403).json({ error: 'Usuario sin acceso' });` (inclusive) por:
    ```js
      const { ANTHROPIC_API_KEY } = process.env;
      if (!configured() || !ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: 'Servidor no configurado (variables de entorno faltantes)' });
      }

      // Solo cuentas creadas por un admin: el alta pública no existe en StintPro.
      const user = await verifyRequest(req);
      if (!user) return res.status(401).json({ error: 'Token inválido' });
    ```
  - `(type === 'alert' ? allowAlert : allowManual)(user.id)` pasa a `…(user.uid)`.

- [ ] **Step 5: Borrar `api/profile.js` y actualizar `package.json`**

```bash
git rm -q api/profile.js
```

`package.json` → `dependencies`:
```json
    "@anthropic-ai/sdk": "latest",
    "firebase-admin": "12.7.0"
```
(fuera `"@supabase/supabase-js"`). Hacerlo con npm para que se actualice también `package-lock.json` (`--ignore-scripts` evita que intente descargar el binario de Electron, que ya no se usa):

```bash
npm uninstall @supabase/supabase-js --ignore-scripts
npm install firebase-admin@12.7.0 --save-exact --ignore-scripts
```

- [ ] **Step 6: Pasar los tests**

Run: `node tests/api-security.test.js && grep -n -i supabase api/*.js`
Expected: `N pasan, 0 fallan`; el grep solo encuentra `api/admin.js` (se reescribe en la Task 3).

- [ ] **Step 7: Commit**

```bash
git add api/_firebase.js api/ai-engineer.js tests/api-security.test.js package.json package-lock.json
git commit -m "feat(api): comprobar el pase con Firebase Admin (_firebase.js) en ai-engineer; fuera profile.js"
```

---

### Task 3: `api/admin.js` con Firebase Admin

**Files:**
- Rewrite: `api/admin.js`
- Create: `tests/api-admin.test.js`

**Interfaces:**
- Consumes: `requireAdmin`, `auth` de `api/_firebase.js` (Task 2).
- Produces: `POST /api/admin` con `action` ∈ `list-users` → `{users:[{id,email,name,role:'admin'|'user',created_at}]}`; `create-user {email,name,password,role}`; `invite-user {email,name}`; `set-role {userId,role}`; `delete-user {userId}` → `{ok:true}` o `{error}`.

- [ ] **Step 1: Test que falla** — `tests/api-admin.test.js`:

```js
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
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `node tests/api-admin.test.js`
Expected: FAIL (admin.js aún requiere `@supabase/supabase-js`).

- [ ] **Step 3: Reescribir `api/admin.js`** completo:

```js
// Vercel Serverless Function — gestión de usuarios con Firebase Authentication.
// Variable de entorno en Vercel: FIREBASE_SERVICE_ACCOUNT (ver api/_firebase.js).
// Rol admin = custom claim { admin: true }; nombre = displayName.

const { requireAdmin, auth } = require('./_firebase');

// Errores de Firebase Admin → mensaje en español (nunca el mensaje interno).
const MESSAGES = {
  'auth/email-already-exists': 'Ya existe una cuenta con ese email',
  'auth/invalid-email':        'El email no es válido',
  'auth/invalid-password':     'La contraseña debe tener al menos 6 caracteres',
  'auth/user-not-found':       'Ese usuario no existe',
};
const messageOf = (e) => (e && MESSAGES[e.code]) || 'No se ha podido completar la operación';
const nameOr = (name, email) => (name && String(name).trim()) || String(email).split('@')[0];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const me = await requireAdmin(req, res);
  if (!me) return;

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch (e) { return res.status(400).json({ error: 'JSON inválido' }); }

  const fa = auth();
  const { action } = body;
  try {
    if (action === 'list-users') {
      const { users } = await fa.listUsers(1000);
      return res.json({ users: users.map(u => ({
        id:         u.uid,
        email:      u.email || '',
        name:       u.displayName || '',
        role:       u.customClaims && u.customClaims.admin === true ? 'admin' : 'user',
        created_at: (u.metadata && u.metadata.creationTime) || null,
      })) });
    }

    if (action === 'create-user') {
      const { email, password, name, role = 'user' } = body;
      if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
      const u = await fa.createUser({ email, password, displayName: nameOr(name, email) });
      if (role === 'admin') await fa.setCustomUserClaims(u.uid, { admin: true });
      return res.json({ ok: true, userId: u.uid });
    }

    // Cuenta sin contraseña: el navegador del admin pide después a Firebase el
    // correo de "restablecer contraseña" (SPAuth.sendReset), que es la invitación.
    if (action === 'invite-user') {
      const { email, name } = body;
      if (!email) return res.status(400).json({ error: 'email requerido' });
      const u = await fa.createUser({ email, displayName: nameOr(name, email) });
      return res.json({ ok: true, userId: u.uid });
    }

    if (action === 'set-role') {
      const { userId, role } = body;
      if (!userId) return res.status(400).json({ error: 'userId requerido' });
      if (userId === me.uid && role !== 'admin') return res.status(400).json({ error: 'No puedes quitarte el rol admin a ti mismo' });
      await fa.setCustomUserClaims(userId, role === 'admin' ? { admin: true } : {});
      return res.json({ ok: true });
    }

    if (action === 'delete-user') {
      const { userId } = body;
      if (!userId) return res.status(400).json({ error: 'userId requerido' });
      if (userId === me.uid) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
      await fa.deleteUser(userId);
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Acción desconocida: ' + action });
  } catch (e) {
    return res.status(400).json({ error: messageOf(e) });
  }
};
```

- [ ] **Step 4: Pasar los tests**

Run: `node tests/api-admin.test.js && node tests/api-security.test.js && grep -rn -i supabase api/`
Expected: `10 pasan, 0 fallan`; api-security verde; el grep no imprime nada.

- [ ] **Step 5: Commit**

```bash
git add api/admin.js tests/api-admin.test.js
git commit -m "feat(api): gestión de usuarios con Firebase Admin (roles por custom claim)"
```

---

### Task 4: `window.SPAuth` en el navegador

**Files:**
- Create: `src/firebase-config.js`, `src/firebase-auth.js`
- Create: `tests/firebase-auth.test.js`

**Interfaces:**
- Produces: `window.SPAuth` con `configured: boolean`, `ready() → Promise<User|null>`, `signIn(email, pw) → Promise<User>`, `signOut() → Promise`, `sendReset(email) → Promise`, `idToken(force?) → Promise<string>` (`''` sin sesión), `isAdmin() → Promise<boolean>`, `user() → User|null`, `name() → string`, `withRecentLogin(fn, askPassword) → Promise`, `errorMessage(err) → string`. En Node: `require('../src/firebase-auth')` → `{ create(fb, cfg, opts), errorMessage, isConfigured }`.

- [ ] **Step 1: Test que falla** — `tests/firebase-auth.test.js`:

```js
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
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `node tests/firebase-auth.test.js`
Expected: FAIL (`Cannot find module '../src/firebase-auth'`).

- [ ] **Step 3: Crear `src/firebase-config.js`**

```js
// Configuración WEB de Firebase (pública por diseño: identifica el proyecto, no
// da acceso; la seguridad la ponen las cuentas y los dominios autorizados).
// Firebase → Configuración del proyecto → Tus apps → app web → firebaseConfig.
// Con los valores vacíos el login muestra "El login no está configurado todavía".
window.FIREBASE_CONFIG = {
  apiKey:     '',
  authDomain: '',
  projectId:  '',
  appId:      '',
};
```

- [ ] **Step 4: Crear `src/firebase-auth.js`**

```js
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
```

- [ ] **Step 5: Pasar los tests**

Run: `node tests/firebase-auth.test.js`
Expected: `11 OK, 0 fallos`.

- [ ] **Step 6: Commit**

```bash
git add src/firebase-config.js src/firebase-auth.js tests/firebase-auth.test.js
git commit -m "feat(auth): SPAuth sobre Firebase Authentication (navegador)"
```

---

### Task 5: Login, app, hub y perfil con `SPAuth`

**Files:**
- Modify: `src/landing.html` (bloque `<script>` final y tarjeta de invitación), `src/index.html:50-70`, `src/hub.html:50-67` y `signOut`, `src/profile.html:367-470`, `src/logger-connector.js:36-58,176-200`, `src/en-ai-engineer.js:121-126`, `src/app.js:5-18`

**Interfaces:**
- Consumes: `window.SPAuth` (Task 4).

Las cuatro páginas cargan, en este orden y en el sitio del antiguo `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>`:

```html
<script src="https://cdn.jsdelivr.net/npm/firebase@10.14.1/firebase-app-compat.js"></script>
<script src="https://cdn.jsdelivr.net/npm/firebase@10.14.1/firebase-auth-compat.js"></script>
<script src="firebase-config.js"></script>
<script src="firebase-auth.js"></script>
```

(En `landing.html`, que no tenía script de Supabase, este bloque va justo antes de su `<script>` final.)

- [ ] **Step 1: `src/landing.html`**
  - Borrar la tarjeta `<!-- Activar cuenta (flujo de invitación) -->` … `</form>` (`#card-invite`) completa.
  - Justo antes de `<p class="note">Acceso solo por invitación</p>` añadir:
    ```html
      <p class="note"><a href="#" id="reset-link" onclick="handleReset(); return false;" style="color:#8A9AAE">¿Has olvidado la contraseña?</a></p>
    ```
  - Sustituir el `<script>` final completo (desde `<script>` hasta `</script>`, con `SUPA_URL`, `handleLogin`, `detectInvite` y `handleActivate`) por:
    ```html
    <script>
      async function handleLogin() {
        var email = (document.getElementById('login-email').value || '').trim();
        var pw    = document.getElementById('login-pw').value || '';
        var errEl = document.getElementById('login-err');
        var btn   = document.getElementById('login-btn');
        if (!email || !pw) { errEl.textContent = 'Introduce email y contraseña'; return; }
        errEl.textContent = '';
        btn.disabled = true; btn.textContent = 'Accediendo…';
        try {
          await SPAuth.signIn(email, pw);
          window.location.href = (await SPAuth.isAdmin()) ? '/hub.html' : '/index.html';
        } catch (e) {
          errEl.textContent = SPAuth.errorMessage(e);
          btn.disabled = false; btn.textContent = 'Entrar';
        }
      }

      async function handleReset() {
        var email = (document.getElementById('login-email').value || '').trim();
        var errEl = document.getElementById('login-err');
        if (!email) { errEl.textContent = 'Escribe tu email y vuelve a pulsar «¿Has olvidado la contraseña?»'; return; }
        try {
          await SPAuth.sendReset(email);
          errEl.textContent = 'Si la cuenta existe, te hemos enviado un correo para poner una contraseña nueva.';
        } catch (e) {
          errEl.textContent = SPAuth.errorMessage(e);
        }
      }

      // Con sesión ya abierta, no se queda en el login.
      SPAuth.ready().then(async function (u) {
        if (u) window.location.replace((await SPAuth.isAdmin()) ? '/hub.html' : '/index.html');
      });
    </script>
    ```

- [ ] **Step 2: `src/index.html`** — sustituir desde `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>` hasta la línea `async function signOutSP(){ … }` (inclusive) por el bloque de 4 scripts de arriba seguido de:

```html
  <script>
    window._spRolePromise = SPAuth.ready().then(async function (u) {
      if (!u) { window.location.replace('/landing.html'); return 'user'; }
      document.getElementById('sp-nav-user').textContent = SPAuth.name();
      var role = (await SPAuth.isAdmin()) ? 'admin' : 'user';
      if (role === 'admin' && !new URLSearchParams(location.search).has('hub')) { window.location.replace('/hub.html'); }
      return role;
    });
    async function signOutSP(){ await SPAuth.signOut(); window.location.replace('/landing.html'); }
```

(Se conserva el `</script>` que cerraba ese bloque. Fuera el reenvío de `#type=invite` a la landing y la excepción de Electron.)

- [ ] **Step 3: `src/hub.html`** — sustituir desde `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>` hasta el cierre del `_sb.auth.getSession().then(…);` por el bloque de 4 scripts seguido de:

```html
<script>
  SPAuth.ready().then(async function (u) {
    if (!u) { window.location.replace('/landing.html'); return; }
    if (!(await SPAuth.isAdmin())) { window.location.replace('/index.html'); return; }
    document.getElementById('nav-user').textContent = SPAuth.name();
    renderCards('admin');
  });
```

En `renderCards`, la descripción `'Usuarios, circuitos y configuración'` pasa a `'Usuarios y diagnóstico'`. En `signOut()`, `await _sb.auth.signOut();` pasa a `await SPAuth.signOut();`.

- [ ] **Step 4: `src/profile.html`** — sustituir desde `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>` hasta el cierre del `_sb.auth.getSession().then(…);` por el bloque de 4 scripts seguido de:

```html
<script>
  var _askPw = function () { return window.prompt('Por seguridad, vuelve a escribir tu contraseña actual:'); };

  SPAuth.ready().then(function (u) {
    if (!u) { window.location.replace('/landing.html'); return; }
    document.getElementById('profile-name').textContent = SPAuth.name();
    document.getElementById('profile-email').textContent = u.email;
  });
```

Y en las tres funciones:
- `submitPw`: `var { error } = await _sb.auth.updateUser({ password: pw });` y el `if (error) {…} else {…}` que le sigue pasan a:
  ```js
      try {
        await SPAuth.withRecentLogin(function () { return SPAuth.user().updatePassword(pw); }, _askPw);
        setMsg(msg, 'Contraseña actualizada correctamente', 'ok');
        btn.textContent = 'Actualizar contraseña';
        setTimeout(function() { document.getElementById('overlay').style.display = 'none'; }, 1500);
      } catch (e) {
        setMsg(msg, SPAuth.errorMessage(e), 'err');
        btn.disabled = false; btn.textContent = 'Actualizar contraseña';
      }
  ```
- `submitEmail`: `var { error } = await _sb.auth.updateUser({ email: email });` y su `if/else` pasan a:
  ```js
      try {
        await SPAuth.withRecentLogin(function () { return SPAuth.user().verifyBeforeUpdateEmail(email); }, _askPw);
        setMsg(msg, 'Revisa tu bandeja: te hemos enviado un enlace de confirmación', 'ok');
        btn.textContent = 'Actualizar email';
      } catch (e) {
        setMsg(msg, SPAuth.errorMessage(e), 'err');
        btn.disabled = false; btn.textContent = 'Actualizar email';
      }
  ```
- `submitDelete`: el `try { … }` (sesión + `fetch('/api/profile', …)` + `signOut`) pasa a:
  ```js
      try {
        await SPAuth.withRecentLogin(function () { return SPAuth.user().delete(); }, _askPw);
        window.location.replace('/landing.html');
      } catch(e) {
        setMsg(msg, SPAuth.errorMessage(e), 'err');
        btn.disabled = false; btn.textContent = 'Eliminar mi cuenta';
      }
  ```

- [ ] **Step 5: `src/logger-connector.js`**
  - `_getToken()` completo (con su comentario `// Token de sesión de Supabase …`) pasa a:
    ```js
      // ID token de Firebase (para autenticar lecturas y WS por usuario). El SDK
      // lo renueva si ha caducado o está a punto (p.ej. tras suspender la pestaña).
      async _getToken() {
        try { return window.SPAuth ? await window.SPAuth.idToken() : ''; }
        catch(e) { return ''; }
      },
    ```
  - Comentarios: `// Auth: se prefiere el JWT de Supabase (por usuario).` → `// Auth: se prefiere el ID token de Firebase (por usuario).`; `// Auth como primer mensaje: JWT de Supabase preferente; API key de reserva.` → `// Auth como primer mensaje: ID token de Firebase preferente; API key de reserva.`; `// Cabeceras de auth para las lecturas: JWT de Supabase preferente; API key de` → `// Cabeceras de auth para las lecturas: ID token de Firebase preferente; API key de`.

- [ ] **Step 6: `src/en-ai-engineer.js`** — sustituir
  ```js
  // Mismo patrón que src/supabase.js: JWT de la sesión Supabase del cliente
  ```
  por `// ID token de Firebase (SPAuth) del cliente`, y
  ```js
    const token=(await window.supabaseClient?.auth?.getSession())?.data?.session?.access_token;
    if(!token)throw new Error('Sin sesión de Supabase');
  ```
  por
  ```js
    const token=window.SPAuth?await window.SPAuth.idToken():'';
    if(!token)throw new Error('Sin sesión');
  ```

- [ ] **Step 7: `src/app.js`** — sustituir el `document.addEventListener('DOMContentLoaded', …)` del principio por:

```js
document.addEventListener('DOMContentLoaded', async () => {
  const role = await window._spRolePromise;
  window._spUserRole = role;
  renderSetup();
});
```

(El modo demo `_launchDemoMode` se conserva, sin llamarse: la app es solo para el equipo.)

- [ ] **Step 8: Comprobar**

Run:
```bash
grep -n -i -E "supabase|_sb\.|/api/profile" src/landing.html src/index.html src/hub.html src/profile.html src/logger-connector.js src/en-ai-engineer.js src/app.js
for f in src/logger-connector.js src/en-ai-engineer.js src/app.js src/firebase-auth.js; do node -e "new Function(require('fs').readFileSync('$f','utf8'));console.log('OK $f')"; done
for f in tests/*.test.js; do node "$f" >/dev/null 2>&1 || echo "FALLA $f"; done; node tests.js | tail -1; node tests-connector.js | tail -1
```
Expected: el grep no imprime nada; 4 × `OK`; ninguna `FALLA`; `38 pasados, 0 fallados`; `25 pasados, 0 fallados`.

- [ ] **Step 9: Commit**

```bash
git add src/landing.html src/index.html src/hub.html src/profile.html src/logger-connector.js src/en-ai-engineer.js src/app.js
git commit -m "feat(auth): login, app, hub y perfil con SPAuth (Firebase)"
```

---

### Task 6: Admin con `SPAuth`, invitación por correo de Firebase y fuera Circuitos/Modo Demo

**Files:**
- Modify: `src/admin.html`

**Interfaces:**
- Consumes: `window.SPAuth` (Task 4); `POST /api/admin` (Task 3): `list-users`, `create-user`, `invite-user`, `set-role {userId, role}`, `delete-user {userId}`.

- [ ] **Step 1: Cabecera** — sustituir las líneas 9-14
  ```html
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script>
      const _SBURL = 'https://nyybrybnvflwbdwdqpwa.supabase.co';
      const _SBKEY = 'sb_publishable_sXd5RxPkUkDlopEW4Rah9g_WpocEK5H';
      const _sb = supabase.createClient(_SBURL, _SBKEY);
    </script>
  ```
  por
  ```html
    <script src="https://cdn.jsdelivr.net/npm/firebase@10.14.1/firebase-app-compat.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/firebase@10.14.1/firebase-auth-compat.js"></script>
    <script src="firebase-config.js"></script>
    <script src="firebase-auth.js"></script>
  ```

- [ ] **Step 2: Quitar Circuitos y Modo Demo** con este script (desde la raíz del repo):

```bash
python3 - <<'EOF'
p = 'src/admin.html'; s = open(p, encoding='utf-8').read()
def cut(a, b):
    global s
    i = s.index(a); j = s.index(b, i); s = s[:i] + s[j:]
cut('      <button class="sb-link" id="sb-circuits"', '      <button class="sb-link" id="sb-blackbox"')
cut('    <!-- ── DEMO ── -->', '    <!-- ── CIRCUITOS ── -->')
cut('    <!-- ── CIRCUITOS ── -->', '    <!-- ── DIAGNÓSTICO (CAJA NEGRA) ── -->')
cut('<!-- MODAL CREAR CIRCUITO -->', '<!-- TOAST -->')
# JS: desde la línea de guiones que precede a "// CIRCUITOS" (incluye la sección
# DEMO MODE, que va detrás) hasta la sección de la caja negra.
i = s.index('\n// CIRCUITOS'); i = s.rindex('\n', 0, i) + 1
j = s.index('// ── CAJA NEGRA (DIAGNÓSTICO)', i); s = s[:i] + s[j:]
s = s.replace('let _circuits = [];\n', '', 1)
s = s.replace('  loadCircuits();\n', '', 1).replace('  loadDemoMode();\n', '', 1)
open(p, 'w', encoding='utf-8').write(s)
EOF
grep -n -E "sb-circuits|sb-demo|page-circuits|page-demo|modalCircuit|loadCircuits|loadDemoMode|toggleDemoMode|_circuits" src/admin.html
```

Expected: el grep final no imprime nada. Si un `cut` lanza `ValueError` (marcador no encontrado), abrir `src/admin.html`, localizar el bloque equivalente y ajustar el marcador; no borrar nada más que esas secciones.

- [ ] **Step 3: Control de acceso y llamadas** — sustituir el bloque `// ── AUTH CHECK ──` (la IIFE) y `doSignOut` por:

```js
// ── AUTH CHECK ────────────────────────────────────────────────
(async () => {
  const u = await SPAuth.ready();
  if (!u) { window.location.replace('landing.html'); return; }
  if (!(await SPAuth.isAdmin())) { window.location.replace('index.html'); return; }

  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appNav').style.display = '';
  document.getElementById('appLayout').style.display = '';
  document.getElementById('navUser').textContent = SPAuth.name();

  loadUsers();
  loadBlackboxDiag();
})();

// ── SIGN OUT ──────────────────────────────────────────────────
async function doSignOut() {
  await SPAuth.signOut();
  window.location.replace('landing.html');
}
```

y quitar la declaración `let _session = null;`. En `adminAPI`, sustituir
```js
  const { data: { session } } = await _sb.auth.getSession();
```
por `  const token = await SPAuth.idToken();` y `` 'Authorization': `Bearer ${session.access_token}` `` por `` 'Authorization': `Bearer ${token}` ``.

- [ ] **Step 4: Invitar = crear cuenta + correo de Firebase** — en `inviteUser()`, sustituir
```js
  if (res.error) { errEl.textContent = res.error; return; }
  closeModal('modalInvite');
  toast(`Invitación enviada a ${email}`);
  loadUsers();
```
por
```js
  if (res.error) { errEl.textContent = res.error; return; }
  try {
    await SPAuth.sendReset(email);
    toast(`Invitación enviada a ${email}`);
  } catch (e) {
    toast(`Cuenta creada, pero no se pudo enviar el correo: ${SPAuth.errorMessage(e)}`, 'err');
  }
  closeModal('modalInvite');
  loadUsers();
```
Y en el modal de invitar, el texto `Le llegará un enlace para poner su nombre y su contraseña.` pasa a `Le llegará un correo de Firebase para poner su contraseña.`

- [ ] **Step 5: Cambiar rol** — en `renderUsers()`, sustituir
```js
        <button class="btn btn-d btn-sm" onclick="deleteUser('${u.id}')">Eliminar</button>
```
por
```js
        <button class="btn btn-g btn-sm" onclick="setRole('${u.id}','${u.role === 'admin' ? 'user' : 'admin'}')">${u.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button>
        <button class="btn btn-d btn-sm" onclick="deleteUser('${u.id}')">Eliminar</button>
```
y añadir antes de `async function deleteUser(id) {`:
```js
async function setRole(id, role) {
  const u = _users.find(x => x.id === id);
  if (!confirm(`¿${role === 'admin' ? 'Dar' : 'Quitar'} el rol admin a ${u?.email || id}?`)) return;
  const res = await adminAPI('set-role', { userId: id, role });
  if (res.error) { toast(res.error, 'err'); return; }
  toast('Rol actualizado (se aplica en su próximo inicio de sesión)');
  loadUsers();
}
```

- [ ] **Step 6: Comprobar**

Run:
```bash
grep -n -i -E "supabase|_sb\.|_SBURL|session\.access_token" src/admin.html
python3 -c "import re,sys;s=open('src/admin.html',encoding='utf-8').read();b=re.findall(r'<script>(.*?)</script>',s,re.S);open('/tmp/admin-inline.js','w').write('\n'.join(b))" && node -e "new Function(require('fs').readFileSync('/tmp/admin-inline.js','utf8'));console.log('OK')"
```
Expected: el grep no imprime nada; `OK`.

- [ ] **Step 7: Commit**

```bash
git add src/admin.html
git commit -m "feat(admin): usuarios con Firebase (invitar, rol, borrar); fuera Circuitos y Modo Demo"
```

---

### Task 7: Circuitos en el código y limpieza de Supabase

**Files:**
- Modify: `src/circuits.js` (catálogo, coordenadas, fuera `loadFromSupabase` y los comentarios que lo citan)
- Modify: `tests/circuit-coords.test.js`
- Delete: `src/supabase.js`, `src/supabase-config.js`

**Interfaces:**
- Produces: `_CIRCUIT_CATALOG` con 21 entradas; `CircuitDB.coords` con 4 entradas nuevas.

- [ ] **Step 1: Test que falla** — en `tests/circuit-coords.test.js` sustituir el test `'todos los circuitos del catálogo embebido tienen coordenadas válidas'` completo por:

```js
const SIN_COORDS = ['misanino-kart', 'worldkarts', 'grancanaria-karting'];

test('el catálogo incluye los 21 circuitos que graba el VPS', () => {
  strictEqual(DB.list.length, 21);
  for (const s of ['korridas', 'kartodromo-de-tapia', 'misanino-kart', 'worldkarts', 'firstkartinn', 'grancanaria-karting', 'prestige-karting'])
    ok(DB.list.some(c => c.slug === s), 'falta ' + s);
});

test('coordenadas válidas (Europa) en todos salvo los pendientes', () => {
  const sin = [];
  for (const c of DB.list) {
    const xy = DB.coordsOf(c.slug);
    if (!xy) { sin.push(c.slug); continue; }
    ok(xy[0] > 27 && xy[0] < 56 && xy[1] > -17 && xy[1] < 20, 'fuera de rango: ' + c.slug);
  }
  deepStrictEqual(sin.sort(), SIN_COORDS.slice().sort());
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `node tests/circuit-coords.test.js`
Expected: FAIL (`14 !== 21`).

- [ ] **Step 3: Catálogo** — en `src/circuits.js`, justo antes del comentario `// Cronosystem = canal del CRONOMETRADOR…` dentro de `_CIRCUIT_CATALOG`, añadir:

```js
  // Circuitos que graba el logger del VPS (puertos de /api/status, 2026-10-26).
  { id: 'cat_korridas',     name: 'Korridas',                  slug: 'korridas',                  port: 7633  }, // Portugal (Matosinhos)
  { id: 'cat_tapia',        name: 'Kartódromo de Tapia',       slug: 'kartodromo-de-tapia',       port: 8443  },
  { id: 'cat_misanino',     name: 'Misanino Kart (IT)',        slug: 'misanino-kart',             port: 8043  },
  { id: 'cat_worldkarts',   name: 'WorldKarts (BE)',           slug: 'worldkarts',                port: 8143  },
  { id: 'cat_firstkartinn', name: 'First Kart Inn (BE)',       slug: 'firstkartinn',              port: 8113  },
  { id: 'cat_grancanaria',  name: 'Gran Canaria Karting',      slug: 'grancanaria-karting',       port: 9183  },
  { id: 'cat_prestige',     name: 'Prestige Karting',          slug: 'prestige-karting',          port: 9613  }, // Francia (Le Luc)
```

En `window.CircuitDB.coords`, después de `'lemans-karting2': …,`, añadir:

```js
  'korridas':                  [41.17568, -8.68299],
  'kartodromo-de-tapia':       [43.54655, -6.90399],
  'firstkartinn':              [50.90603,  4.41669],
  'prestige-karting':          [43.34890,  6.33847],
  // Sin coordenadas aún (no se muestra el aviso de lluvia): misanino-kart,
  // worldkarts (OSM da dos sedes) y grancanaria-karting.
```

- [ ] **Step 4: Fuera Supabase de `circuits.js`**
  - Borrar la función `window.CircuitDB.loadFromSupabase = async function() { … };` completa y su comentario `// Carga async desde Supabase — …`.
  - El comentario de `knownOffsets` `// que sobreviva a loadFromSupabase() (que reemplaza \`list\` pero no toca esto).` pasa a `// que no dependa del orden de carga de \`list\`.`; el de `coords` `// slug, aparte de \`list\`, para que sobrevivan a loadFromSupabase(). Las de` pasa a `// slug, aparte de \`list\`. Las de`.

```bash
git rm -q src/supabase.js src/supabase-config.js
```

- [ ] **Step 5: Pasar los tests y comprobar que no queda Supabase en el cliente**

Run:
```bash
node tests/circuit-coords.test.js
grep -rn -i "supabase" src api | grep -v "^src/supabase" ; echo "--- fin grep"
for f in tests/*.test.js; do node "$f" >/dev/null 2>&1 || echo "FALLA $f"; done
```
Expected: `5 OK, 0 fallos`; el grep no imprime ninguna línea antes de `--- fin grep`; ninguna `FALLA`.

- [ ] **Step 6: Commit**

```bash
git add src/circuits.js tests/circuit-coords.test.js
git commit -m "feat(circuitos): catálogo completo en el código (+7 del VPS); fuera Supabase del cliente"
```

---

### Task 8: CSP, herramienta del primer admin y verificación

**Files:**
- Modify: `vercel.json`, `.gitignore`
- Create: `tools/firebase-set-admin.js`

- [ ] **Step 1: CSP** — en `vercel.json`, dentro de `connect-src`, sustituir
`https://nyybrybnvflwbdwdqpwa.supabase.co wss://nyybrybnvflwbdwdqpwa.supabase.co`
por
`https://identitytoolkit.googleapis.com https://securetoken.googleapis.com`.

Run: `node -e "const v=JSON.parse(require('fs').readFileSync('vercel.json','utf8'));const c=v.headers[0].headers.find(h=>h.key==='Content-Security-Policy').value;console.log(/supabase/.test(c)?'QUEDA SUPABASE':'OK', /identitytoolkit\.googleapis\.com/.test(c)&&/securetoken\.googleapis\.com/.test(c)?'GOOGLE OK':'FALTA GOOGLE')"`
Expected: `OK GOOGLE OK`.

- [ ] **Step 2: `tools/firebase-set-admin.js`**

```js
#!/usr/bin/env node
// tools/firebase-set-admin.js — marca una cuenta de Firebase como admin de StintPro
// (custom claim { admin: true }). Se ejecuta UNA vez, en tu Mac, con la clave de
// la cuenta de servicio (que nunca se sube al repo).
//
// Uso: node tools/firebase-set-admin.js <ruta-cuenta-servicio.json> <email>
'use strict';

const fs = require('fs');
const admin = require('firebase-admin');

async function main() {
  const [keyPath, email] = process.argv.slice(2);
  if (!keyPath || !email) {
    console.error('uso: node tools/firebase-set-admin.js <ruta-cuenta-servicio.json> <email>');
    process.exit(2);
  }
  const cred = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(cred) });
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, Object.assign({}, user.customClaims, { admin: true }));
  console.log(`✓ ${email} (${user.uid}) es admin. Cierra sesión y vuelve a entrar para que se aplique.`);
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
```

- [ ] **Step 3: `.gitignore`** — añadir al final:

```
# Claves de cuenta de servicio de Firebase (secretas: nunca al repo)
*service-account*.json
*firebase-adminsdk*.json
```

- [ ] **Step 4: Verificación completa**

Run:
```bash
node -e "new Function(require('fs').readFileSync('tools/firebase-set-admin.js','utf8').replace(/^#!.*\n/,''));console.log('OK')"
for f in tests/*.test.js; do node "$f" >/dev/null 2>&1 || echo "FALLA $f"; done; node tests.js | tail -1; node tests-connector.js | tail -1
(cd stintpro-logger && npx jest 2>&1 | grep -E "^Tests:|^Test Suites:")
grep -rn -i "supabase" src api stintpro-logger/server.js vercel.json package.json; echo "--- fin grep"
```
Expected: `OK`; ninguna `FALLA`; `38 pasados…`, `25 pasados…`; Jest todo verde; el grep no imprime nada antes de `--- fin grep`.

- [ ] **Step 5: Verificación en el navegador (la hace el controlador)** — `preview_start` con `stintpro-banco` (:8765):
  1. `http://localhost:8765/src/landing.html`: la tarjeta de login y el enlace «¿Has olvidado la contraseña?» se ven; al pulsar Entrar con campos vacíos sale «Introduce email y contraseña»; en la consola, `SPAuth.configured` es `false` (config vacía) y `await SPAuth.signIn('a@b.c','x').catch(e=>SPAuth.errorMessage(e))` devuelve «El login no está configurado todavía» (no se escribe ninguna credencial en el formulario).
  2. `http://localhost:8765/src/index.html` y `/src/hub.html`, `/src/admin.html`, `/src/profile.html`: sin sesión redirigen a `/landing.html` (en local esa ruta da 404 porque se sirve la raíz del repo; basta con ver que intentan ir a `/landing.html`) y la consola no tiene errores de JavaScript.
  3. Las 2 peticiones a `cdn.jsdelivr.net/npm/firebase@10.14.1/…` responden 200.

- [ ] **Step 6: Commit**

```bash
git add vercel.json .gitignore tools/firebase-set-admin.js
git commit -m "feat(auth): CSP para Firebase y herramienta para el primer admin"
```

- [ ] **Step 7: Parar.** Lo siguiente lo hace o lo autoriza el usuario (ver «Lo que hace el usuario» en la spec): configuración web en `src/firebase-config.js`, variables de Vercel, `FIREBASE_PROJECT_ID` en el VPS, push y reinicio del logger, primer admin y prueba real de login.
