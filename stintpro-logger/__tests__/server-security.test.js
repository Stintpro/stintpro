'use strict';

// Tests de seguridad y resiliencia del servidor HTTP/WS
// Cubre: auth, inyección, path traversal, acciones destructivas de usuario,
// comportamiento bajo inputs malformados o extremos.

const http    = require('http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const db      = require('../db');

// ── Setup: arrancamos una instancia del servidor real ─────────────────────────
// Importamos la lógica a través del módulo real para evitar mocks que enmascaren bugs.

let server, baseUrl, wsUrl;
const VALID_KEY = 'test-key-abc123';

// Mini-servidor que replica las rutas críticas con la misma lógica de server.js
// (necesario porque server.js llama a listen() al importar — usamos un helper)
const { createTestServer } = require('./helpers/test-server');

beforeAll(async () => {
  await db.init();
  const result = await createTestServer({ apiKey: VALID_KEY });
  server  = result.server;
  baseUrl = result.baseUrl;
  wsUrl   = result.wsUrl;

  // Seed: una sesión con vueltas para tests destructivos
  const sid = db.createSession('test-slug', 'Test Circuit');
  db.insertLap(sid, '7', 'PILOTO', null, 64000, 1, Date.now());
});

afterAll(() => new Promise(resolve => server.close(resolve)));

// ── Utilidades ────────────────────────────────────────────────────────────────

function req(method, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url      = new URL(baseUrl + path);
    const bodyStr  = opts.body !== undefined ? JSON.stringify(opts.body) : null;
    const options  = {
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...(opts.headers || {}),
      },
    };
    const r = http.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    });
    r.on('error', reject);
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

function authHeaders() {
  return { 'X-API-Key': VALID_KEY };
}

function wsConnect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.once('open',  () => resolve(ws));
    ws.once('error', reject);
  });
}

function wsReceive(ws) {
  return new Promise((resolve, reject) => {
    ws.once('message', msg => {
      try { resolve(JSON.parse(msg.toString())); }
      catch { resolve(msg.toString()); }
    });
    ws.once('error', reject);
  });
}

// ── 1. AUTENTICACIÓN HTTP ─────────────────────────────────────────────────────

describe('HTTP auth — endpoints protegidos', () => {
  const protectedRoutes = [
    ['DELETE', '/api/sessions/1'],
    ['DELETE', '/api/circuit/test-slug/pilots'],
    ['POST',   '/api/circuit/test-slug/pilots/merge'],
    ['POST',   '/api/circuit/test-slug/recording'],
    ['POST',   '/api/circuit/test-slug/raw-log'],
    ['POST',   '/api/cleanup'],
    ['GET',    '/api/recordings'],
    ['GET',    '/api/recordings/test.ndjson'],
  ];

  test.each(protectedRoutes)('%s %s sin key → 401', async (method, path) => {
    const { status } = await req(method, path, {
      body: method !== 'GET' ? { names: ['X'], target: 'Y' } : undefined,
    });
    expect(status).toBe(401);
  });

  test.each(protectedRoutes)('%s %s con key incorrecta → 401', async (method, path) => {
    const { status } = await req(method, path, {
      headers: { 'X-API-Key': 'clave-incorrecta' },
      body: method !== 'GET' ? { names: ['X'], target: 'Y' } : undefined,
    });
    expect(status).toBe(401);
  });

  test.each(protectedRoutes)('%s %s con key válida → no 401', async (method, path) => {
    const { status } = await req(method, path, {
      headers: authHeaders(),
      body: method !== 'GET' ? { names: ['X'], target: 'Y' } : undefined,
    });
    expect(status).not.toBe(401);
  });
});

// ── 2. ENDPOINTS PÚBLICOS ─────────────────────────────────────────────────────

describe('HTTP — endpoints que deben ser públicos', () => {
  test('GET /api/status → 200 sin auth', async () => {
    const { status } = await req('GET', '/api/status');
    expect(status).toBe(200);
  });

  test('GET /api/sessions → 200 sin auth', async () => {
    const { status } = await req('GET', '/api/sessions');
    expect(status).toBe(200);
  });

  test('GET /api/circuit/:slug/pilots → 200 sin auth', async () => {
    const { status } = await req('GET', '/api/circuit/test-slug/pilots');
    expect(status).toBe(200);
  });
});

// ── 3. PATH TRAVERSAL en descarga de grabaciones ──────────────────────────────

describe('path traversal — /api/recordings/:file', () => {
  const traversals = [
    '../server.js',
    '../../etc/passwd',
    '%2e%2e%2fserver.js',
    '..%2fserver.js',
    'foo/../../server.js',
  ];

  test.each(traversals)('intento de traversal "%s" → 400 o 404', async (payload) => {
    const { status } = await req('GET', `/api/recordings/${encodeURIComponent(payload)}`, {
      headers: authHeaders(),
    });
    expect([400, 404]).toContain(status);
  });

  test('fichero sin extensión .ndjson → 400', async () => {
    const { status } = await req('GET', '/api/recordings/server.js', {
      headers: authHeaders(),
    });
    expect(status).toBe(400);
  });

  test('fichero .ndjson inexistente → 404', async () => {
    const { status } = await req('GET', '/api/recordings/no-existe.ndjson', {
      headers: authHeaders(),
    });
    expect(status).toBe(404);
  });
});

// ── 4. INPUTS MALFORMADOS / EXTREMOS ─────────────────────────────────────────

describe('inputs malformados', () => {
  test('DELETE /api/sessions/:id con id no numérico → 400', async () => {
    const { status } = await req('DELETE', '/api/sessions/abc', { headers: authHeaders() });
    expect(status).toBe(400);
  });

  test('DELETE /api/sessions/:id con id negativo → no explota (200 o 400)', async () => {
    const { status } = await req('DELETE', '/api/sessions/-1', { headers: authHeaders() });
    expect([200, 400, 404]).toContain(status);
  });

  test('DELETE /api/circuit/:slug/pilots sin body → 400', async () => {
    const { status } = await req('DELETE', '/api/circuit/test-slug/pilots', {
      headers: authHeaders(),
      body: {},
    });
    expect(status).toBe(400);
  });

  test('DELETE /api/circuit/:slug/pilots con names vacío → 400', async () => {
    const { status } = await req('DELETE', '/api/circuit/test-slug/pilots', {
      headers: authHeaders(),
      body: { names: [] },
    });
    expect(status).toBe(400);
  });

  test('POST merge sin target → 400', async () => {
    const { status } = await req('POST', '/api/circuit/test-slug/pilots/merge', {
      headers: authHeaders(),
      body: { names: ['A', 'B'] },
    });
    expect(status).toBe(400);
  });

  test('POST merge con un solo nombre → 400', async () => {
    const { status } = await req('POST', '/api/circuit/test-slug/pilots/merge', {
      headers: authHeaders(),
      body: { names: ['Solo'], target: 'Solo' },
    });
    expect(status).toBe(400);
  });

  // merge opera sobre datos históricos de la BD por slug, no sobre un monitor
  // vivo (igual que DELETE/GET .../pilots), así que un slug sin monitor no da
  // 404: es un no-op idempotente que devuelve 200.
  test('POST merge con slug sin monitor → 200 (no-op sobre histórico)', async () => {
    const { status } = await req('POST', '/api/circuit/circuito-fantasma/pilots/merge', {
      headers: authHeaders(),
      body: { names: ['A', 'B'], target: 'A' },
    });
    expect(status).toBe(200);
  });

  test('GET /api/pilots/search con q de 1 char → array vacío (no error)', async () => {
    const { status, body } = await req('GET', '/api/pilots/search?q=a');
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  test('GET /api/pilots/search con q muy largo (10000 chars) → no explota', async () => {
    const q = 'A'.repeat(10000);
    const { status } = await req('GET', `/api/pilots/search?q=${q}`);
    expect([200, 400]).toContain(status);
  });

  test('GET /api/laps/:sessionId con id flotante → 400', async () => {
    const { status } = await req('GET', '/api/laps/1.5');
    expect(status).toBe(400);
  });
});

// ── 5. ACCIONES DESTRUCTIVAS — usuario con key válida ─────────────────────────

describe('acciones destructivas con key válida', () => {
  test('DELETE sesión existente la elimina de la BD', async () => {
    const sid = db.createSession('destr-test', 'Destructivo');
    db.insertLap(sid, '7', 'PILOTO', null, 64000, 1, Date.now());

    const { status } = await req('DELETE', `/api/sessions/${sid}`, { headers: authHeaders() });
    expect(status).toBe(200);
    expect(db.getAllSessions().find(s => s.id === sid)).toBeUndefined();
    expect(db.getLapsBySession(sid)).toEqual([]);
  });

  test('DELETE sesión inexistente → 200 sin error (idempotente)', async () => {
    const { status } = await req('DELETE', '/api/sessions/999999', { headers: authHeaders() });
    expect(status).toBe(200);
  });

  test('POST cleanup elimina sesiones vacías', async () => {
    const sid = db.createSession('cleanup-test', 'Vacía');
    db.endSession(sid);

    const { status } = await req('POST', '/api/cleanup', { headers: authHeaders() });
    expect(status).toBe(200);
    expect(db.getAllSessions().find(s => s.id === sid)).toBeUndefined();
  });

  test('POST cleanup NO elimina sesiones con vueltas', async () => {
    const sid = db.createSession('cleanup-safe', 'Con vueltas');
    db.insertLap(sid, '7', 'PILOTO', null, 64000, 1, Date.now());
    db.endSession(sid);

    await req('POST', '/api/cleanup', { headers: authHeaders() });
    expect(db.getAllSessions().find(s => s.id === sid)).toBeDefined();
  });

  test('DELETE pilotos de circuito — elimina solo los especificados', async () => {
    const sid = db.createSession('pilot-del', 'Borrado pilotos');
    db.insertLap(sid, '7', 'JAVIER', null, 64000, 1, Date.now());
    db.insertLap(sid, '8', 'CARLOS', null, 65000, 1, Date.now());

    const { status } = await req('DELETE', '/api/circuit/pilot-del/pilots', {
      headers: authHeaders(),
      body: { names: ['JAVIER'] },
    });
    expect(status).toBe(200);

    const pilotos = db.getPilotSessionsByCircuit('pilot-del');
    const nombres = pilotos.map(p => p.name);
    expect(nombres).not.toContain('JAVIER');
    expect(nombres).toContain('CARLOS');
  });
});

// ── 6. AUTENTICACIÓN WEBSOCKET ────────────────────────────────────────────────

describe('WebSocket auth', () => {
  test('conexión sin auth → cierre por timeout (≤11s)', async () => {
    const ws = await wsConnect();
    await new Promise((resolve, reject) => {
      ws.once('close', resolve);
      ws.once('error', reject);
      setTimeout(() => reject(new Error('No cerró en 11s')), 11000);
    });
  }, 12000);

  test('auth con key incorrecta → error fatal y cierre', async () => {
    const ws  = await wsConnect();
    ws.send(JSON.stringify({ type: 'auth', apikey: 'clave-mala' }));
    const msg = await wsReceive(ws);
    expect(msg.type).toBe('error');
    expect(msg.fatal).toBe(true);
    await new Promise(r => ws.once('close', r));
  });

  test('auth con key correcta → auth_ok', async () => {
    const ws  = await wsConnect();
    ws.send(JSON.stringify({ type: 'auth', apikey: VALID_KEY }));
    const msg = await wsReceive(ws);
    expect(msg.type).toBe('auth_ok');
    ws.close();
  });

  test('mensaje antes de auth → error auth_required y cierre', async () => {
    const ws = await wsConnect();
    ws.send(JSON.stringify({ type: 'subscribe', slug: 'test-slug' }));
    const msg = await wsReceive(ws);
    expect(msg.type).toBe('error');
    expect(msg.msg).toBe('auth_required');
    await new Promise(r => ws.once('close', r));
  });

  test('JSON malformado → error sin cerrar la conexión', async () => {
    const ws = await wsConnect();
    ws.send(JSON.stringify({ type: 'auth', apikey: VALID_KEY }));
    await wsReceive(ws); // auth_ok

    ws.send('esto no es json {{{');
    const msg = await wsReceive(ws);
    expect(msg.type).toBe('error');
    expect(msg.msg).toContain('json');

    // La conexión sigue abierta (no es error fatal)
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  test('tipo de mensaje desconocido → error sin cerrar', async () => {
    const ws = await wsConnect();
    ws.send(JSON.stringify({ type: 'auth', apikey: VALID_KEY }));
    await wsReceive(ws);

    ws.send(JSON.stringify({ type: 'tipo-inventado' }));
    const msg = await wsReceive(ws);
    expect(msg.type).toBe('error');
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  test('subscribe a circuito inexistente → error descriptivo', async () => {
    const ws = await wsConnect();
    ws.send(JSON.stringify({ type: 'auth', apikey: VALID_KEY }));
    await wsReceive(ws);

    ws.send(JSON.stringify({ type: 'subscribe', slug: 'circuito-fantasma' }));
    const msg = await wsReceive(ws);
    expect(msg.type).toBe('error');
    expect(msg.msg).toMatch(/circuito-fantasma/i);
    ws.close();
  });

  test('pilot sin dorsal → error', async () => {
    const ws = await wsConnect();
    ws.send(JSON.stringify({ type: 'auth', apikey: VALID_KEY }));
    await wsReceive(ws);

    ws.send(JSON.stringify({ type: 'pilot', slug: 'test-slug' }));
    const msg = await wsReceive(ws);
    expect(msg.type).toBe('error');
    ws.close();
  });

  test('team_msg sin text → error', async () => {
    const ws = await wsConnect();
    ws.send(JSON.stringify({ type: 'auth', apikey: VALID_KEY }));
    await wsReceive(ws);

    ws.send(JSON.stringify({ type: 'team_msg', slug: 'test-slug', dorsal: '7' }));
    const msg = await wsReceive(ws);
    expect(msg.type).toBe('error');
    ws.close();
  });

  test('mensaje WS vacío → error sin crash', async () => {
    const ws = await wsConnect();
    ws.send(JSON.stringify({ type: 'auth', apikey: VALID_KEY }));
    await wsReceive(ws);

    ws.send('');
    const msg = await wsReceive(ws);
    expect(msg.type).toBe('error');
    ws.close();
  });

  test('mensaje WS muy largo (1MB) → no crash', async () => {
    const ws = await wsConnect();
    ws.send(JSON.stringify({ type: 'auth', apikey: VALID_KEY }));
    await wsReceive(ws);

    ws.send('X'.repeat(1024 * 1024));
    const msg = await wsReceive(ws);
    expect(msg.type).toBe('error');
    ws.close();
  });
});

// ── 7. INYECCIÓN SQL en parámetros de ruta ────────────────────────────────────

describe('inyección SQL en parámetros de URL', () => {
  const sqlPayloads = [
    "'; DROP TABLE sessions; --",
    "1 OR 1=1",
    "1; SELECT * FROM sessions",
    "' UNION SELECT * FROM sessions --",
  ];

  test.each(sqlPayloads)('GET /api/sessions/:slug con payload "%s" → no crash', async (payload) => {
    const { status } = await req('GET', `/api/sessions/${encodeURIComponent(payload)}`);
    expect([200, 400, 404]).toContain(status);
  });

  test.each(sqlPayloads)('GET /api/circuit/:slug/pilots con payload SQL → no crash', async (payload) => {
    const { status } = await req('GET', `/api/circuit/${encodeURIComponent(payload)}/pilots`);
    expect([200, 400, 404]).toContain(status);
  });

  test.each(sqlPayloads)('GET /api/pilots/search?q= con payload SQL → no crash', async (payload) => {
    const { status } = await req('GET', `/api/pilots/search?q=${encodeURIComponent(payload)}`);
    expect([200, 400]).toContain(status);
  });
});

// ── 8. CONCURRENCIA — peticiones simultáneas ──────────────────────────────────

describe('concurrencia', () => {
  test('50 peticiones simultáneas a /api/status → todas 200', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => req('GET', '/api/status'))
    );
    expect(results.every(r => r.status === 200)).toBe(true);
  });

  test('10 DELETE simultáneos de la misma sesión → no crash (idempotente)', async () => {
    const sid = db.createSession('concurrent-del', 'Concurrente');
    db.insertLap(sid, '7', 'PILOTO', null, 64000, 1, Date.now());

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        req('DELETE', `/api/sessions/${sid}`, { headers: authHeaders() })
      )
    );
    expect(results.every(r => [200, 404].includes(r.status))).toBe(true);
    expect(db.getAllSessions().find(s => s.id === sid)).toBeUndefined();
  });
});

// ── 9. API KEY por query param (fallback) ─────────────────────────────────────

describe('API key vía query param', () => {
  test('DELETE con ?apikey válida en URL → 200', async () => {
    const sid = db.createSession('queryparam-test', 'Query Param');
    db.insertLap(sid, '7', 'PILOTO', null, 64000, 1, Date.now());

    const { status } = await req('DELETE', `/api/sessions/${sid}?apikey=${VALID_KEY}`);
    expect(status).toBe(200);
  });

  test('DELETE con ?apikey incorrecta en URL → 401', async () => {
    const { status } = await req('DELETE', '/api/sessions/1?apikey=mala-clave');
    expect(status).toBe(401);
  });
});
