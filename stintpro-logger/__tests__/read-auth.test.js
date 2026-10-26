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
    iat: t - 10, auth_time: t - 10, exp: t + 3600, member: true,
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

  test('sin claim member ni admin (alta pública) → null', async () => {
    expect(await verifyFirebaseIdToken(makeJwt(claims({ member: undefined })))).toBeNull();
    expect(await verifyFirebaseIdToken(makeJwt(claims({ member: 'true' })))).toBeNull();
  });

  test('solo admin (sin member) → válido', async () => {
    expect(await verifyFirebaseIdToken(makeJwt(claims({ member: undefined, admin: true })))).toBeTruthy();
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

  test('lectura con token válido sin claim member → 401', async () => {
    expect((await get('/api/sessions', { Authorization: 'Bearer ' + makeJwt(claims({ member: undefined })) })).status).toBe(401);
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
