'use strict';

// Helper: arranca una instancia real de Express+WS con las mismas rutas que server.js
// pero sin conectar a circuitos reales ni a Apex Timing.
// Devuelve { server, baseUrl, wsUrl } listo para tests.

const http    = require('http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const path    = require('path');
const fs      = require('fs');
const db      = require('../../db');
const { computePilotRatings } = require('../../scoring');

async function createTestServer({ apiKey = '' } = {}) {
  const API_KEY = apiKey;
  const app     = express();
  app.use(express.json());

  // CORS permisivo en tests
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
  });

  function httpAuth(req, res, next) {
    if (!API_KEY) return next();
    const key = req.headers['x-api-key'] || req.query.apikey;
    if (key !== API_KEY) return res.status(401).json({ error: 'No autorizado' });
    next();
  }

  // Monitor stub — representa un circuito de test sin conexión real
  const testMonitor = {
    slug: 'test-slug',
    getInfo: () => ({ name: 'Test Circuit', slug: 'test-slug', port: 9999, connected: false, lapCount: 0, kartCount: 0, subscribers: 0, rawLog: false }),
    subscribe:       (ws) => {},
    subscribePilot:  (ws, dorsal) => {},
    pilotSubscribers: new Map(),
    setRecording:    () => {},
    setRawLog:       () => {},
  };

  const monitors = new Map([['test-slug', testMonitor]]);

  function _computePilotRatings(slug) {
    return computePilotRatings(db.getPilotSessionsByCircuit(slug));
  }

  // ── Rutas (copia exacta de server.js) ──────────────────────────────────────

  app.get('/api/status', (req, res) => {
    res.json({ ok: true, version: '1.0.0-test', uptime: 0, circuits: [] });
  });

  app.get('/api/sessions', (req, res) => {
    res.json(db.getAllSessions());
  });

  app.get('/api/sessions/:slug', (req, res) => {
    res.json(db.getCircuitSessions(req.params.slug));
  });

  app.get('/api/laps/:sessionId', (req, res) => {
    const id = parseInt(req.params.sessionId);
    if (isNaN(id) || String(id) !== req.params.sessionId) return res.status(400).json({ error: 'id inválido' });
    res.json(db.getLapsBySession(id));
  });

  app.get('/api/pits/:sessionId', (req, res) => {
    const id = parseInt(req.params.sessionId);
    if (isNaN(id) || String(id) !== req.params.sessionId) return res.status(400).json({ error: 'id inválido' });
    res.json(db.getPitEventsBySession(id));
  });

  app.get('/api/best/:slug', (req, res) => res.json(db.getBestLapsByCircuit(req.params.slug)));
  app.get('/api/circuit/:slug/history', (req, res) => res.json(db.getBestLapsByCircuit(req.params.slug)));

  app.get('/api/session/:sessionId/laps', (req, res) => {
    const id = parseInt(req.params.sessionId);
    if (isNaN(id)) return res.status(400).json({ error: 'id inválido' });
    res.json(db.getLapsBySession(id));
  });

  app.delete('/api/sessions/:id', httpAuth, (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'id inválido' });
    db.deleteSession(id);
    res.json({ ok: true });
  });

  app.post('/api/circuit/:slug/recording', httpAuth, (req, res) => {
    const mon = monitors.get(req.params.slug);
    if (!mon) return res.status(404).json({ error: 'Circuito no encontrado' });
    res.json({ ok: true });
  });

  app.get('/api/pilots/search', (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    res.json(db.searchPilotsGlobal(q));
  });

  app.delete('/api/circuit/:slug/pilots', httpAuth, (req, res) => {
    const names = req.body?.names;
    if (!Array.isArray(names) || !names.length) return res.status(400).json({ error: 'names requerido' });
    for (const name of names) db.deletePilotFromCircuit(req.params.slug, name);
    res.json({ ok: true, deleted: names.length });
  });

  app.post('/api/circuit/:slug/pilots/merge', httpAuth, (req, res) => {
    const names  = req.body?.names;
    const target = (req.body?.target || '').trim();
    if (!Array.isArray(names) || names.length < 2) return res.status(400).json({ error: 'names requiere 2+ nombres' });
    if (!target) return res.status(400).json({ error: 'target requerido' });
    const mon = monitors.get(req.params.slug);
    if (!mon) return res.status(404).json({ error: 'Circuito no encontrado' });
    db.mergePilotsInCircuit(req.params.slug, names, target);
    res.json({ ok: true });
  });

  app.get('/api/circuit/:slug/pilots/batch', (req, res) => {
    const rawNames = (req.query.names || '').split(',').map(n => n.trim()).filter(Boolean);
    if (!rawNames.length) return res.json({});
    res.json({});
  });

  app.get('/api/circuit/:slug/pilots', (req, res) => {
    res.json(db.getPilotSessionsByCircuit(req.params.slug));
  });

  app.get('/api/circuit/:slug/pilot-ratings', (req, res) => {
    try { res.json(_computePilotRatings(req.params.slug)); }
    catch(e) { res.status(500).json({ error: 'Error interno' }); }
  });

  app.post('/api/cleanup', httpAuth, (req, res) => {
    db.cleanupEmptySessions();
    res.json({ ok: true });
  });

  // Grabaciones: directorio temporal de test
  const recordingsDir = path.join(__dirname, '../fixtures/recordings');
  if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });
  // Fixture: un fichero .ndjson vacío para tests de descarga
  fs.writeFileSync(path.join(recordingsDir, 'test-fixture.ndjson'), '');

  app.get('/api/recordings', httpAuth, (req, res) => {
    try {
      const files = fs.readdirSync(recordingsDir)
        .filter(f => f.endsWith('.ndjson'))
        .map(f => {
          const stat = fs.statSync(path.join(recordingsDir, f));
          return { name: f, size: stat.size, mtime: stat.mtimeMs };
        });
      res.json(files);
    } catch(e) { res.status(500).json({ error: 'Error interno' }); }
  });

  app.get('/api/recordings/:file', httpAuth, (req, res) => {
    const name = path.basename(req.params.file);
    if (!name.endsWith('.ndjson')) return res.status(400).json({ error: 'Tipo inválido' });
    const filePath = path.join(recordingsDir, name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'No encontrado' });
    res.download(filePath);
  });

  app.post('/api/circuit/:slug/raw-log', httpAuth, (req, res) => {
    const mon = monitors.get(req.params.slug);
    if (!mon) return res.status(404).json({ error: 'Circuito no encontrado' });
    res.json({ ok: true });
  });

  // ── WebSocket ──────────────────────────────────────────────────────────────

  const server = http.createServer(app);
  const wss    = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    ws._authed = !API_KEY;

    const authTimeout = API_KEY
      ? setTimeout(() => {
          if (!ws._authed) {
            ws.send(JSON.stringify({ type: 'error', msg: 'auth_timeout', fatal: true }));
            ws.close();
          }
        }, 10000)
      : null;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch(e) { ws.send(JSON.stringify({ type: 'error', msg: 'json_invalido' })); return; }

      if (msg.type === 'auth') {
        if (!API_KEY || msg.apikey === API_KEY) {
          ws._authed = true;
          if (authTimeout) clearTimeout(authTimeout);
          ws.send(JSON.stringify({ type: 'auth_ok' }));
        } else {
          ws.send(JSON.stringify({ type: 'error', msg: 'auth_failed', fatal: true }));
          ws.close();
        }
        return;
      }

      if (!ws._authed) {
        ws.send(JSON.stringify({ type: 'error', msg: 'auth_required', fatal: true }));
        ws.close();
        return;
      }

      if (msg.type === 'list') {
        ws.send(JSON.stringify({ type: 'circuits', circuits: [] }));
        return;
      }

      if (msg.type === 'subscribe') {
        const mon = monitors.get((msg.slug || '').trim());
        if (!mon) {
          ws.send(JSON.stringify({ type: 'error', msg: `Circuito '${msg.slug}' no encontrado` }));
          return;
        }
        ws.send(JSON.stringify({ type: 'subscribed', slug: msg.slug }));
        return;
      }

      if (msg.type === 'pilot') {
        const slug   = (msg.slug   || '').trim();
        const dorsal = (msg.dorsal || '').toString().trim();
        const mon    = monitors.get(slug);
        if (!mon) { ws.send(JSON.stringify({ type: 'error', msg: `Circuito '${slug}' no encontrado` })); return; }
        if (!dorsal) { ws.send(JSON.stringify({ type: 'error', msg: 'dorsal requerido' })); return; }
        ws.send(JSON.stringify({ type: 'pilot_ok' }));
        return;
      }

      if (msg.type === 'team_msg') {
        const slug   = (msg.slug   || '').trim();
        const dorsal = (msg.dorsal || '').toString().trim();
        const text   = (msg.text   || '').trim();
        if (!monitors.get(slug) || !dorsal || !text) {
          ws.send(JSON.stringify({ type: 'error', msg: 'slug, dorsal y text requeridos' }));
          return;
        }
        ws.send(JSON.stringify({ type: 'team_msg_sent' }));
        return;
      }

      ws.send(JSON.stringify({ type: 'error', msg: `Tipo desconocido: ${msg.type}` }));
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl:   `ws://127.0.0.1:${port}`,
  };
}

module.exports = { createTestServer };
