'use strict';

// Cobertura del control de autenticación de LECTURAS (Hallazgo A):
//   - verifySupabaseJwt: verificación ES256 hecha con crypto nativo (JWKS).
//   - readAuth: gate que acepta API key O JWT de Supabase, con enforcement
//     controlado por ENFORCE_READ_AUTH.

const http   = require('http');
const crypto = require('crypto');
const { WebSocket } = require('ws');
const { verifySupabaseJwt, _injectJwksForTest } = require('../server');
const { createTestServer } = require('./helpers/test-server');

const VALID_KEY = 'test-key-abc';
const KID = 'test-kid-1';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

let privateKey;

function makeJwt(payload, { priv = privateKey, kid = KID, alg = 'ES256' } = {}) {
  const header = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const body   = b64url(JSON.stringify(payload));
  const sig    = crypto.sign('sha256', Buffer.from(header + '.' + body), { key: priv, dsaEncoding: 'ieee-p1363' });
  return header + '.' + body + '.' + b64url(sig);
}

const now = () => Math.floor(Date.now() / 1000);

beforeAll(() => {
  // Par EC P-256 que imita la clave de firma de Supabase; publicamos su JWK.
  const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  privateKey = kp.privateKey;
  const jwk = kp.publicKey.export({ format: 'jwk' });
  jwk.kid = KID; jwk.alg = 'ES256'; jwk.use = 'sig';
  _injectJwksForTest([jwk]);
});

// ── verifySupabaseJwt ─────────────────────────────────────────────────────────

describe('verifySupabaseJwt (ES256 / JWKS)', () => {
  test('token válido → devuelve payload', async () => {
    const p = await verifySupabaseJwt(makeJwt({ sub: 'user-123', exp: now() + 3600, aud: 'authenticated' }));
    expect(p).toBeTruthy();
    expect(p.sub).toBe('user-123');
  });

  test('token caducado → null', async () => {
    expect(await verifySupabaseJwt(makeJwt({ sub: 'u', exp: now() - 10 }))).toBeNull();
  });

  test('kid desconocido → null', async () => {
    expect(await verifySupabaseJwt(makeJwt({ sub: 'u', exp: now() + 3600 }, { kid: 'otro-kid' }))).toBeNull();
  });

  test('firmado con otra clave → null', async () => {
    const otra = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    expect(await verifySupabaseJwt(makeJwt({ sub: 'u', exp: now() + 3600 }, { priv: otra }))).toBeNull();
  });

  test('alg:none → null', async () => {
    const tok = b64url(JSON.stringify({ alg: 'none', kid: KID })) + '.' +
                b64url(JSON.stringify({ sub: 'u', exp: now() + 3600 })) + '.';
    expect(await verifySupabaseJwt(tok)).toBeNull();
  });

  test('payload manipulado tras firmar → null', async () => {
    const parts = makeJwt({ sub: 'user-123', exp: now() + 3600 }).split('.');
    parts[1] = b64url(JSON.stringify({ sub: 'ATACANTE', exp: now() + 3600 }));
    expect(await verifySupabaseJwt(parts.join('.'))).toBeNull();
  });

  test('basura / vacío → null', async () => {
    expect(await verifySupabaseJwt('no.es.jwt')).toBeNull();
    expect(await verifySupabaseJwt('')).toBeNull();
    expect(await verifySupabaseJwt(null)).toBeNull();
  });
});

// ── readAuth con ENFORCE_READ_AUTH=true ───────────────────────────────────────

describe('readAuth — enforcement activado', () => {
  let baseUrl, wsUrl, server, prevEnforce;

  beforeAll(async () => {
    prevEnforce = process.env.ENFORCE_READ_AUTH;
    process.env.ENFORCE_READ_AUTH = 'true';
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

  test('lectura con API key → pasa (no 401)', async () => {
    expect((await get('/api/sessions', { 'X-API-Key': VALID_KEY })).status).not.toBe(401);
  });

  test('lectura con JWT de Supabase válido → pasa (no 401)', async () => {
    const jwt = makeJwt({ sub: 'user-123', exp: now() + 3600, aud: 'authenticated' });
    expect((await get('/api/sessions', { Authorization: 'Bearer ' + jwt })).status).not.toBe(401);
  });

  test('lectura con JWT caducado → 401', async () => {
    const jwt = makeJwt({ sub: 'u', exp: now() - 10 });
    expect((await get('/api/sessions', { Authorization: 'Bearer ' + jwt })).status).toBe(401);
  });

  test('/api/status permanece abierto (no exige auth)', async () => {
    // No 401: está fuera de readAuth. (En test da 500 porque el db stub no
    // tiene datos; lo relevante es que NO está bloqueado por autenticación.)
    expect((await get('/api/status')).status).not.toBe(401);
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

  test('WS auth con JWT válido → auth_ok', async () => {
    const jwt = makeJwt({ sub: 'user-123', exp: now() + 3600, aud: 'authenticated' });
    expect(await wsAuth({ token: jwt })).toBe('auth_ok');
  });

  test('WS auth con API key → auth_ok', async () => {
    expect(await wsAuth({ apikey: VALID_KEY })).toBe('auth_ok');
  });

  test('WS auth con JWT inválido y sin key → error', async () => {
    expect(await wsAuth({ token: 'no.es.jwt' })).toBe('error');
  });
});
