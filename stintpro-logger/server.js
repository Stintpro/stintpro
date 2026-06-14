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
    circuits: Array.from(monitors.values()).map(m => ({
      ...m.getInfo(),
      totalLaps: db.getTotalLapsByCircuit(m.slug),
    })),
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

// Borrar pilotos de un circuito (body: { names: ["Piloto A", "Piloto B"] })
app.delete('/api/circuit/:slug/pilots', (req, res) => {
  const names = req.body?.names;
  if (!Array.isArray(names) || !names.length) return res.status(400).json({ error: 'names requerido' });
  for (const name of names) db.deletePilotFromCircuit(req.params.slug, name);
  res.json({ ok: true, deleted: names.length });
});

// Consulta batch de pilotos para la app (normaliza nombres antes de comparar)
app.get('/api/circuit/:slug/pilots/batch', (req, res) => {
  const rawNames = (req.query.names || '').split(',').map(n => n.trim()).filter(Boolean);
  if (!rawNames.length) return res.json({});

  function norm(n) {
    return (n || '').toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\./g, '').replace(/\s+/g, ' ').trim();
  }

  const rows = db.getPilotSessionsByCircuit(req.params.slug);

  // Agrupar por nombre normalizado
  const byNorm = {};
  for (const r of rows) {
    const key = norm(r.name);
    if (!byNorm[key]) byNorm[key] = [];
    byNorm[key].push(r);
  }

  // Para cada nombre solicitado, buscar coincidencia normalizada
  const result = {};
  for (const raw of rawNames) {
    const key = norm(raw);
    const sessions = byNorm[key];
    if (!sessions || !sessions.length) continue;

    // Ordenar sesiones por fecha desc y calcular posición
    const bySession = {};
    for (const r of sessions) {
      if (!bySession[r.session_id]) bySession[r.session_id] = [];
      bySession[r.session_id].push(r);
    }

    const sessionList = Object.values(bySession).map(ss => {
      const best = Math.min(...ss.map(r => r.best_ms));
      const avg  = Math.round(ss.reduce((a, r) => a + r.avg_ms, 0) / ss.length);
      const laps = ss.reduce((a, r) => a + r.laps, 0);
      return { started_at: ss[0].started_at, best_ms: best, avg_ms: avg, laps };
    }).sort((a, b) => b.started_at - a.started_at);

    result[raw] = {
      best_ms:       Math.min(...sessionList.map(s => s.best_ms)),
      avg_ms:        Math.round(sessionList.reduce((a, s) => a + s.avg_ms, 0) / sessionList.length),
      session_count: sessionList.length,
      total_laps:    sessionList.reduce((a, s) => a + s.laps, 0),
      sessions:      sessionList.slice(0, 5),
    };
  }

  res.json(result);
});

// Fichas de pilotos por circuito
app.get('/api/circuit/:slug/pilots', (req, res) => {
  const rows = db.getPilotSessionsByCircuit(req.params.slug);

  // Agrupar por sesión para calcular posiciones
  const bySession = {};
  for (const r of rows) {
    if (!bySession[r.session_id]) bySession[r.session_id] = [];
    bySession[r.session_id].push(r);
  }
  for (const sid of Object.keys(bySession)) {
    bySession[sid].sort((a, b) => a.best_ms - b.best_ms);
  }

  // Filtro de nombres válidos (mismo criterio que el cliente)
  function validName(n) {
    if (!n || typeof n !== 'string') return false;
    const s = n.trim();
    if (s.length < 3) return false;
    if (/^\d+$/.test(s)) return false;
    if (/^kart\s*\d+$/i.test(s)) return false;
    if (/^(equipo|team|piloto|driver)\s*\d*$/i.test(s)) return false;
    if (/^\(sin nombre\)$/i.test(s)) return false;
    return true;
  }

  // Agregar por piloto
  const pilotMap = {};
  for (const r of rows) {
    if (!validName(r.name)) continue;
    const key = r.name.trim();
    if (!pilotMap[key]) pilotMap[key] = { name: key, sessions: [] };
    const rank = bySession[r.session_id];
    const pos = rank.findIndex(x => x.name === r.name) + 1;
    pilotMap[key].sessions.push({
      session_id: r.session_id,
      started_at: r.started_at,
      best_ms:    r.best_ms,
      avg_ms:     r.avg_ms,
      laps:       r.laps,
      position:   pos,
      total:      rank.length,
    });
  }

  const pilots = Object.values(pilotMap)
    .map(p => ({
      name:          p.name,
      session_count: p.sessions.length,
      best_ms:       Math.min(...p.sessions.map(s => s.best_ms)),
      avg_ms:        Math.round(p.sessions.reduce((a, s) => a + s.avg_ms, 0) / p.sessions.length),
      total_laps:    p.sessions.reduce((a, s) => a + s.laps, 0),
      sessions:      p.sessions.sort((a, b) => b.started_at - a.started_at),
    }))
    .sort((a, b) => a.best_ms - b.best_ms);

  res.json(pilots);
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
