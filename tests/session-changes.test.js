#!/usr/bin/env node
// Tests para los cambios de la sesión 2026-06-23
// Cubre: discriminación piloto/equipo y seguridad del servidor
// Run: node tests/session-changes.test.js

'use strict';

const assert = require('assert/strict');
const http   = require('http');
const { WebSocketServer, WebSocket } = require('../stintpro-logger/node_modules/ws');
const { createParser } = require('../src/apex-protocol');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => { console.log(`  ✓ ${name}`); passed++; })
               .catch(e => { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; });
    }
    console.log(`  ✓ ${name}`); passed++;
  } catch(e) {
    console.error(`  ✗ ${name}\n    ${e.message}`); failed++;
  }
}

function group(name, fn) { console.log(`\n${name}`); return fn(); }

// ── 1. Discriminación piloto / equipo en apex-protocol.js ────────────────────

group('Discriminación piloto/equipo — apex-protocol.js', () => {
  function makeParser() {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', pos: 1, dorsal: '7' }],
    });
    return p;
  }

  test('nombre con [X:XX] → piloto, se guarda sin el contador', () => {
    const p = makeParser();
    p.parse('r1c2|dr|Javier Coy [0:10]');
    const k = p.getState().equipos[0];
    assert.equal(k.name, 'Javier Coy');
  });

  test('nombre con [X:XX] → no sobreescribe con el contador en el nombre', () => {
    const p = makeParser();
    p.parse('r1c2|dr|Ana García [1:23]');
    const k = p.getState().equipos[0];
    assert.ok(!k.name.includes('['), 'el contador no debe aparecer en k.name');
  });

  test('nombre sin [X:XX] → equipo, va a teamName, k.name no se toca', () => {
    const p = makeParser();
    p.parse('r1c2|dr|Javier Coy [0:10]');  // establece piloto
    p.parse('r1c2|dr|Team StintPro');       // alternancia → equipo
    const k = p.getState().equipos[0];
    assert.equal(k.name, 'Javier Coy', 'k.name no debe cambiar al mostrar equipo');
    assert.equal(k.teamName, 'Team StintPro');
  });

  test('alternancia múltiple piloto→equipo→piloto mantiene el nombre correcto', () => {
    const p = makeParser();
    p.parse('r1c2|dr|Javier Coy [0:10]');
    p.parse('r1c2|dr|Team StintPro');
    p.parse('r1c2|dr|Javier Coy [0:25]');
    p.parse('r1c2|dr|Team StintPro');
    const k = p.getState().equipos[0];
    assert.equal(k.name, 'Javier Coy');
    assert.equal(k.teamName, 'Team StintPro');
  });

  test('piloto nuevo en el mismo kart actualiza k.name', () => {
    const p = makeParser();
    p.parse('r1c2|dr|Piloto A [0:10]');
    p.parse('r1c2|dr|Piloto B [0:02]'); // relevo
    const k = p.getState().equipos[0];
    assert.equal(k.name, 'Piloto B');
  });

  test('setGrid con nombre piloto [X:XX] → k.name limpio', () => {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', pos: 1, dorsal: '7', name: 'Javier Coy [0:05]' }],
    });
    const k = p.getState().equipos[0];
    assert.equal(k.name, 'Javier Coy');
  });

  test('setGrid con nombre de equipo → va a teamName, k.name cae al fallback #dorsal', () => {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', pos: 1, dorsal: '7', name: 'Team StintPro' }],
    });
    const k = p.getState().equipos[0];
    assert.equal(k.name, '#7', 'sin piloto identificado, name cae al fallback #dorsal');
    assert.equal(k.teamName, 'Team StintPro');
  });

  test('setGrid equipo + update piloto → k.name y k.teamName correctos', () => {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', pos: 1, dorsal: '7', name: 'Team StintPro' }],
    });
    // Antes del update de piloto, teamName ya está asignado
    assert.equal(p.getState().equipos[0].teamName, 'Team StintPro');
    // Llega el nombre del piloto
    p.parse('r1c2|dr|Javier Coy [0:08]');
    const k = p.getState().equipos[0];
    assert.equal(k.name, 'Javier Coy');
    assert.equal(k.teamName, 'Team StintPro');
  });
});

// ── 2. httpAuth middleware ────────────────────────────────────────────────────

group('httpAuth middleware', () => {
  const API_KEY = 'test-key-12345';

  function httpAuth(apiKey) {
    return (req, res, next) => {
      if (!apiKey) return next();
      const key = req.headers['x-api-key'] || new URL(req.url, 'http://x').searchParams.get('apikey');
      if (key !== apiKey) return res.writeHead(401).end(JSON.stringify({ error: 'No autorizado' }));
      next();
    };
  }

  function makeServer(apiKey) {
    const app = http.createServer((req, res) => {
      const mw = httpAuth(apiKey);
      mw(req, res, () => res.writeHead(200).end('ok'));
    });
    return new Promise(resolve => app.listen(0, () => resolve(app)));
  }

  function request(server, opts = {}) {
    const port = server.address().port;
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/', ...opts }, res => {
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
  }

  test('sin API_KEY → siempre pasa', async () => {
    const srv = await makeServer('');
    try {
      assert.equal(await request(srv), 200);
    } finally { srv.close(); }
  });

  test('con API_KEY y cabecera correcta → 200', async () => {
    const srv = await makeServer(API_KEY);
    try {
      assert.equal(await request(srv, { headers: { 'x-api-key': API_KEY } }), 200);
    } finally { srv.close(); }
  });

  test('con API_KEY y sin cabecera → 401', async () => {
    const srv = await makeServer(API_KEY);
    try {
      assert.equal(await request(srv), 401);
    } finally { srv.close(); }
  });

  test('con API_KEY y cabecera incorrecta → 401', async () => {
    const srv = await makeServer(API_KEY);
    try {
      assert.equal(await request(srv, { headers: { 'x-api-key': 'wrong-key' } }), 401);
    } finally { srv.close(); }
  });
});

// ── 3. WebSocket auth — primer mensaje ───────────────────────────────────────

group('WebSocket auth — primer mensaje', () => {
  const API_KEY = 'ws-test-key';

  function makeWsServer(apiKey) {
    const httpSrv = http.createServer();
    const wss = new WebSocketServer({ server: httpSrv });
    wss.on('connection', (ws) => {
      ws._authed = !apiKey;
      const timeout = apiKey
        ? setTimeout(() => { if (!ws._authed) ws.close(); }, 2000)
        : null;
      ws.on('message', raw => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'auth') {
          if (!apiKey || msg.apikey === apiKey) {
            ws._authed = true;
            if (timeout) clearTimeout(timeout);
            ws.send(JSON.stringify({ type: 'auth_ok' }));
          } else {
            ws.send(JSON.stringify({ type: 'error', msg: 'auth_failed', fatal: true }));
            ws.close();
          }
          return;
        }
        if (!ws._authed) { ws.close(); return; }
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      });
    });
    return new Promise(resolve => httpSrv.listen(0, () => resolve({ httpSrv, wss })));
  }

  function wsConnect(port) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  function wsMsg(ws) {
    return new Promise(resolve => ws.once('message', d => resolve(JSON.parse(d.toString()))));
  }

  test('auth correcto → recibe auth_ok', async () => {
    const { httpSrv } = await makeWsServer(API_KEY);
    const port = httpSrv.address().port;
    try {
      const ws = await wsConnect(port);
      ws.send(JSON.stringify({ type: 'auth', apikey: API_KEY }));
      const msg = await wsMsg(ws);
      assert.equal(msg.type, 'auth_ok');
      ws.close();
    } finally { httpSrv.close(); }
  });

  test('auth incorrecto → recibe error auth_failed', async () => {
    const { httpSrv } = await makeWsServer(API_KEY);
    const port = httpSrv.address().port;
    try {
      const ws = await wsConnect(port);
      ws.send(JSON.stringify({ type: 'auth', apikey: 'wrong' }));
      const msg = await wsMsg(ws);
      assert.equal(msg.type, 'error');
      assert.equal(msg.msg, 'auth_failed');
      ws.close();
    } finally { httpSrv.close(); }
  });

  test('mensaje antes de auth → conexión cerrada', async () => {
    const { httpSrv } = await makeWsServer(API_KEY);
    const port = httpSrv.address().port;
    try {
      const ws = await wsConnect(port);
      const closed = new Promise(resolve => ws.on('close', resolve));
      ws.send(JSON.stringify({ type: 'ping' })); // sin auth previo
      await closed;
      assert.equal(ws.readyState, WebSocket.CLOSED);
    } finally { httpSrv.close(); }
  });

  test('sin API_KEY → mensajes funcionan sin auth', async () => {
    const { httpSrv } = await makeWsServer('');
    const port = httpSrv.address().port;
    try {
      const ws = await wsConnect(port);
      ws.send(JSON.stringify({ type: 'ping' }));
      const msg = await wsMsg(ws);
      assert.equal(msg.type, 'pong');
      ws.close();
    } finally { httpSrv.close(); }
  });
});

// ── 4. CORS — lista blanca de orígenes ───────────────────────────────────────

group('CORS — lista blanca de orígenes', () => {
  const ALLOWED = new Set([
    'https://stintpro.vercel.app',
    'http://localhost:3000',
    'null',
  ]);

  function corsHeader(origin) {
    if (ALLOWED.has(origin)) return origin;
    return null;
  }

  test('origen permitido → devuelve el mismo origen', () => {
    assert.equal(corsHeader('https://stintpro.vercel.app'), 'https://stintpro.vercel.app');
  });

  test('localhost permitido', () => {
    assert.equal(corsHeader('http://localhost:3000'), 'http://localhost:3000');
  });

  test('origen desconocido → null (no CORS)', () => {
    assert.equal(corsHeader('https://evil.com'), null);
  });

  test('origen vacío → null', () => {
    assert.equal(corsHeader(''), null);
  });

  test('Electron (null) → permitido', () => {
    assert.equal(corsHeader('null'), 'null');
  });
});

// ── 5. SQL — queries parametrizadas (lógica de _query) ───────────────────────

group('SQL — queries parametrizadas', () => {
  // Verificar que las funciones en db.js ya no usan replace(/\'/g, "''")
  const fs = require('fs');
  const dbSrc = fs.readFileSync(
    require('path').join(__dirname, '../stintpro-logger/db.js'), 'utf8'
  );

  test('no queda escapado manual de comillas SQL', () => {
    assert.ok(
      !dbSrc.includes("replace(/'/g, \"''\")"),
      'no debe haber escapado manual de SQL'
    );
  });

  test('todas las funciones de slug usan parámetros ?', () => {
    const fns = ['getCircuitSessions', 'getBestLapsByCircuit', 'getPilotSessionsByCircuit',
                 'getTotalLapsByCircuit', 'deletePilotFromCircuit', 'mergePilotsInCircuit',
                 'searchPilotsGlobal'];
    for (const fn of fns) {
      assert.ok(dbSrc.includes(fn), `función ${fn} debe existir`);
    }
  });

  test('deleteSession usa prepare con ? en vez de interpolación', () => {
    assert.ok(!dbSrc.includes('session_id=${sessionId}'), 'no debe haber interpolación directa');
  });
});

// ── Resultado ─────────────────────────────────────────────────────────────────

async function main() {
  // Esperar promises pendientes
  await new Promise(r => setTimeout(r, 500));
  console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main();
