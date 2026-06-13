// ── StintPro Logger Server ────────────────────────────────────────────────
// Express + WebSocket. Graba sesiones Apex 24/7 y sirve historial al cliente.
'use strict';

const express        = require('express');
const http           = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const fs             = require('fs');
const path           = require('path');
const db             = require('./db');
const CircuitMonitor = require('./circuit-monitor');

const config  = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const API_KEY = (process.env.STINTPRO_API_KEY || config.apiKey || '').trim();
const PORT    = parseInt(process.env.PORT || config.port || config.server?.httpPort || 3000);

// ── App Express ───────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// ── Monitores por circuito ────────────────────────────────────────────────

const monitors = new Map(); // slug → CircuitMonitor

function startMonitors() {
  for (const cfg of (config.circuits || [])) {
    if (!cfg.slug) continue;
    const mon = new CircuitMonitor(cfg);
    monitors.set(cfg.slug, mon);
    mon.start();
  }
  console.log(`[Logger] ${monitors.size} circuitos monitorizados`);
}

// ── REST API ──────────────────────────────────────────────────────────────

// Estado general
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    version: '1.0.0',
    uptime: Math.round(process.uptime()),
    circuits: Array.from(monitors.values()).map(m => m.getInfo()),
  });
});

// Todas las sesiones
app.get('/api/sessions', (req, res) => {
  res.json(db.getAllSessions());
});

// Sesiones de un circuito
app.get('/api/sessions/:slug', (req, res) => {
  res.json(db.getCircuitSessions(req.params.slug));
});

// Vueltas de una sesión
app.get('/api/laps/:sessionId', (req, res) => {
  const id = parseInt(req.params.sessionId);
  if (isNaN(id)) return res.status(400).json({ error: 'id inválido' });
  res.json(db.getLapsBySession(id));
});

// Eventos de pit de una sesión
app.get('/api/pits/:sessionId', (req, res) => {
  const id = parseInt(req.params.sessionId);
  if (isNaN(id)) return res.status(400).json({ error: 'id inválido' });
  res.json(db.getPitEventsBySession(id));
});

// Mejores vueltas históricas por circuito
app.get('/api/best/:slug', (req, res) => {
  res.json(db.getBestLapsByCircuit(req.params.slug));
});

// Alias rutas usadas por el dashboard
app.get('/api/circuit/:slug/history', (req, res) => {
  res.json(db.getBestLapsByCircuit(req.params.slug));
});
app.get('/api/session/:sessionId/laps', (req, res) => {
  const id = parseInt(req.params.sessionId);
  if (isNaN(id)) return res.status(400).json({ error: 'id inválido' });
  res.json(db.getLapsBySession(id));
});

// Borrar una sesión y todos sus datos
app.delete('/api/sessions/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'id inválido' });
  db.deleteSession(id);
  res.json({ ok: true });
});

// Limpiar sesiones vacías
app.get('/api/cleanup', (req, res) => {
  db.cleanupEmptySessions();
  res.json({ ok: true });
});

// ── WebSocket server ──────────────────────────────────────────────────────

const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

function checkAuth(req) {
  if (!API_KEY) return true;
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.get('apikey') === API_KEY;
}

wss.on('connection', (ws, req) => {
  if (!checkAuth(req)) {
    ws.send(JSON.stringify({ type: 'error', msg: 'auth_failed', fatal: true }));
    ws.close();
    return;
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch(e) { ws.send(JSON.stringify({ type: 'error', msg: 'json_invalido' })); return; }

    // list — estado de todos los circuitos
    if (msg.type === 'list') {
      ws.send(JSON.stringify({
        type: 'circuits',
        circuits: Array.from(monitors.values()).map(m => m.getInfo()),
      }));
      return;
    }

    // subscribe — conectarse a un circuito
    if (msg.type === 'subscribe') {
      const slug = (msg.slug || '').trim();
      const mon  = monitors.get(slug);
      if (!mon) {
        ws.send(JSON.stringify({
          type: 'error',
          msg:  `Circuito '${slug}' no encontrado. Disponibles: ${[...monitors.keys()].join(', ')}`,
        }));
        return;
      }
      mon.subscribe(ws);
      return;
    }

    ws.send(JSON.stringify({ type: 'error', msg: `Tipo desconocido: ${msg.type}` }));
  });
});

// ── Bootstrap ─────────────────────────────────────────────────────────────

(async () => {
  try {
    await db.init();
    startMonitors();
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[Logger] Escuchando en :${PORT}`);
      console.log(`[Logger] API Key: ${API_KEY ? API_KEY.substring(0, 8) + '...' : '(ninguna)'}`);
    });
  } catch(e) {
    console.error('[Logger] Error de arranque:', e);
    process.exit(1);
  }
})();
