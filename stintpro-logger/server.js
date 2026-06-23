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
const ALLOWED_ORIGINS = new Set([
  'https://stintpro.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8080',
  'null', // Electron (file:// origin)
]);

app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
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

// ── Página principal ─────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>StintPro Logger</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #08090a; color: #c9d1d9; font-family: 'DM Mono', 'Fira Mono', monospace; font-size: 13px; padding: 28px 24px; max-width: 720px; }
  h1 { color: #5b8dee; font-size: 20px; font-weight: 500; margin-bottom: 2px; }
  .subtitle { color: #444; font-size: 11px; margin-bottom: 32px; }
  .nav { display: flex; gap: 10px; margin-bottom: 36px; flex-wrap: wrap; }
  .nav a { display: flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 500; transition: background .15s; }
  .nav a.primary { background: #1e3a6e; color: #5b8dee; border: 1px solid #253f7a; }
  .nav a.primary:hover { background: #253f7a; }
  .nav a.secondary { background: #0e0f11; color: #888; border: 1px solid #1e2030; }
  .nav a.secondary:hover { background: #13141a; color: #c9d1d9; }
  .icon { font-size: 15px; }
  h2 { font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 12px; }
  .circuits { display: flex; flex-direction: column; gap: 8px; }
  .card { background: #0e0f11; border: 1px solid #1e2030; border-radius: 6px; padding: 12px 16px; display: flex; align-items: center; gap: 12px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .dot.green { background: #22c55e; box-shadow: 0 0 6px #22c55e88; }
  .dot.red   { background: #ef4444; }
  .card-info { flex: 1; }
  .card-name { color: #e6edf3; font-weight: 500; margin-bottom: 3px; }
  .card-meta { color: #555; font-size: 11px; }
  .card-stats { text-align: right; font-size: 11px; color: #666; line-height: 1.6; }
  .tag { display: inline-block; padding: 2px 7px; border-radius: 3px; font-size: 10px; font-weight: 500; }
  .tag-on  { background: #14532d; color: #22c55e; }
  .tag-off { background: #1a1b1f; color: #333; }
  .uptime { color: #333; font-size: 11px; margin-top: 36px; }
</style>
</head>
<body>
<h1>StintPro Logger</h1>
<div class="subtitle" id="host-line">Cargando...</div>

<nav class="nav">
  <a class="primary" href="/stats"><span class="icon">📊</span> Stats</a>
  <a class="primary" href="/recordings"><span class="icon">⏺</span> Grabaciones</a>
  <a class="secondary" href="/api/status" target="_blank"><span class="icon">⚡</span> API Status</a>
  <a class="secondary" href="/api/sessions" target="_blank"><span class="icon">📋</span> Sesiones</a>
</nav>

<h2>Circuitos</h2>
<div class="circuits" id="circuits"></div>
<div class="uptime" id="uptime"></div>

<script>
async function load() {
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    document.getElementById('host-line').textContent = location.host + '  ·  v' + (d.version || '1.0');
    const up = d.uptime || 0;
    const h  = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60);
    document.getElementById('uptime').textContent = 'Uptime: ' + h + 'h ' + m + 'm';
    const el = document.getElementById('circuits');
    if (!d.circuits?.length) { el.innerHTML = '<div style="color:#333;padding:12px 0">Sin circuitos configurados</div>'; return; }
    el.innerHTML = d.circuits.map(c => \`
      <div class="card">
        <div class="dot \${c.connected ? 'green' : 'red'}"></div>
        <div class="card-info">
          <div class="card-name">\${c.name}</div>
          <div class="card-meta">\${c.slug} · puerto \${c.port}</div>
        </div>
        <div class="card-stats">
          \${c.lapCount || 0} vueltas · \${c.kartCount || 0} karts<br>
          \${c.subscribers || 0} clientes
          <span class="tag \${c.rawLog ? 'tag-on' : 'tag-off'}" style="margin-left:6px">\${c.rawLog ? '⏺ REC' : 'REC'}</span>
        </div>
      </div>
    \`).join('');
  } catch(e) {
    document.getElementById('circuits').innerHTML = '<div style="color:#ef4444">Error conectando con el logger</div>';
  }
}
load();
setInterval(load, 8000);
</script>
</body>
</html>`);
});

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
app.delete('/api/sessions/:id', httpAuth, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'id inválido' });
  db.deleteSession(id);
  res.json({ ok: true });
});

// Toggle grabación de un circuito
app.post('/api/circuit/:slug/recording', httpAuth, (req, res) => {
  const mon = monitors.get(req.params.slug);
  if (!mon) return res.status(404).json({ error: 'Circuito no encontrado' });
  const enabled = req.body?.enabled !== false;
  mon.setRecording(enabled);
  const idx = config.circuits.findIndex(c => c.slug === req.params.slug);
  if (idx >= 0) {
    config.circuits[idx].recording = enabled;
    try { fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2)); } catch(e) {}
  }
  res.json({ ok: true, slug: req.params.slug, recording: enabled });
});

// Búsqueda global de pilotos entre todos los circuitos
app.get('/api/pilots/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const rows = db.searchPilotsGlobal(q);
  const bySlug = {};
  for (const r of rows) {
    if (!bySlug[r.slug]) bySlug[r.slug] = { slug: r.slug, circuit_name: r.circuit_name, pilots: [] };
    bySlug[r.slug].pilots.push({ name: r.name, best_ms: r.best_ms, avg_ms: r.avg_ms, total_laps: r.total_laps, session_count: r.session_count });
  }
  res.json(Object.values(bySlug));
});

// Borrar pilotos de un circuito (body: { names: ["Piloto A", "Piloto B"] })
app.delete('/api/circuit/:slug/pilots', httpAuth, (req, res) => {
  const names = req.body?.names;
  if (!Array.isArray(names) || !names.length) return res.status(400).json({ error: 'names requerido' });
  for (const name of names) db.deletePilotFromCircuit(req.params.slug, name);
  res.json({ ok: true, deleted: names.length });
});

// Unificar pilotos duplicados (body: { names: ["Variante A", "Variante B"], target: "Nombre final" })
app.post('/api/circuit/:slug/pilots/merge', httpAuth, (req, res) => {
  const names  = req.body?.names;
  const target = (req.body?.target || '').trim();
  if (!Array.isArray(names) || names.length < 2) return res.status(400).json({ error: 'names requiere 2+ nombres' });
  if (!target) return res.status(400).json({ error: 'target requerido' });
  db.mergePilotsInCircuit(req.params.slug, names, target);
  res.json({ ok: true, merged: names.length, target });
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

// Rating de pilotos por circuito (puntuación 0-1000)
function _computePilotRatings(slug) {
  const rows = db.getPilotSessionsByCircuit(slug);

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

  const validRows = rows.filter(r => validName(r.name));
  if (!validRows.length) return [];

  // ── Detección automática de sesiones lluviosas ────────────────────────────
  // Ritmo medio ponderado por sesión (media de avg_ms ponderada por vueltas)
  const sessionPace = {};
  for (const r of validRows) {
    if (!sessionPace[r.session_id]) sessionPace[r.session_id] = { sum: 0, laps: 0 };
    sessionPace[r.session_id].sum  += r.avg_ms * r.laps;
    sessionPace[r.session_id].laps += r.laps;
  }
  const sessionAvgs = Object.entries(sessionPace)
    .filter(([, d]) => d.laps >= 5)
    .map(([sid, d]) => ({ session_id: parseInt(sid), avg: d.sum / d.laps }))
    .sort((a, b) => a.avg - b.avg);

  // Referencia seca = P25 de ritmos de sesión (sesiones rápidas → probablemente secas)
  const dryRef = sessionAvgs.length
    ? sessionAvgs[Math.floor(sessionAvgs.length * 0.25)].avg
    : null;

  // Sesión lluviosa: ritmo medio >8% sobre la referencia seca
  const WET_THRESHOLD = 1.12;
  const wetSessions = new Set(
    dryRef
      ? sessionAvgs.filter(s => s.avg / dryRef > WET_THRESHOLD).map(s => s.session_id)
      : []
  );

  // Récord absoluto del circuito = mejor vuelta histórica en sesiones NO lluviosas
  const dryRows = validRows.filter(r => !wetSessions.has(r.session_id));
  const circuitRecord = Math.min(...(dryRows.length ? dryRows : validRows).map(r => r.best_ms));

  // Agrupar por sesión para calcular posiciones relativas (solo sesiones secas)
  const bySession = {};
  for (const r of dryRows) {
    if (!bySession[r.session_id]) bySession[r.session_id] = [];
    bySession[r.session_id].push(r);
  }
  for (const sid of Object.keys(bySession)) {
    bySession[sid].sort((a, b) => a.best_ms - b.best_ms);
  }

  // Agregar por piloto usando solo sesiones secas
  const pilotMap = {};
  for (const r of dryRows) {
    const key = r.name.trim();
    if (!pilotMap[key]) pilotMap[key] = { name: key, sessions: [], total_laps: 0 };
    const rank = bySession[r.session_id];
    const pos  = rank.findIndex(x => x.name === r.name) + 1;
    pilotMap[key].sessions.push({ best_ms: r.best_ms, laps: r.laps, position: pos, total: rank.length });
    pilotMap[key].total_laps += r.laps;
  }

  // 12% sobre el récord = 0 puntos de pace (calibrable según circuito)
  const PACE_FLOOR = 0.12;
  const MIN_LAPS   = 10;

  const results = [];

  for (const p of Object.values(pilotMap)) {
    const pilot_best = Math.min(...p.sessions.map(s => s.best_ms));
    const n_sessions = p.sessions.length;
    const total_laps = p.total_laps;

    if (total_laps < MIN_LAPS) {
      results.push({
        name: p.name, score: null, tier: 'Sin datos',
        pace_score: null, position_score: null, consistency_score: null,
        pilot_best_ms: pilot_best, circuit_record_ms: circuitRecord,
        gap_to_record_pct: null, session_count: n_sessions, total_laps,
      });
      continue;
    }

    // ── Componente 1: Pace (0-500) ────────────────────────────────────────
    // Qué tan cerca está la mejor vuelta del piloto del récord del circuito
    const pace_raw   = (pilot_best - circuitRecord) / circuitRecord;
    const pace_score = Math.round(Math.max(0, 1 - pace_raw / PACE_FLOOR) * 500);

    // ── Componente 2: Posición (0-300) ────────────────────────────────────
    // Percentil medio de posición en sesiones con ≥3 pilotos
    const compSessions = p.sessions.filter(s => s.total >= 5);
    let position_score = 150; // neutro si no hay sesiones comparables
    if (compSessions.length > 0) {
      const avgPct = compSessions.reduce((sum, s) =>
        sum + (1 - (s.position - 1) / Math.max(1, s.total - 1)), 0
      ) / compSessions.length;
      position_score = Math.round(avgPct * 300);
    }

    // ── Componente 3: Consistencia (0-200) ───────────────────────────────
    // Baja varianza del pace entre sesiones = piloto estable
    let consistency_score = 100; // neutro si solo 1 sesión
    if (n_sessions >= 2) {
      const paces  = p.sessions.map(s => (s.best_ms - circuitRecord) / circuitRecord);
      const mean   = paces.reduce((a, b) => a + b, 0) / paces.length;
      const stddev = Math.sqrt(paces.reduce((a, b) => a + (b - mean) ** 2, 0) / paces.length);
      const cv     = stddev / (mean + 0.001);
      consistency_score = Math.round(Math.max(0, 1 - cv / 0.3) * 200);
    }

    const score = pace_score + position_score + consistency_score;
    results.push({
      name: p.name,
      score,
      pace_score,
      position_score,
      consistency_score,
      pilot_best_ms:     pilot_best,
      circuit_record_ms: circuitRecord,
      gap_to_record_pct: Math.round(pace_raw * 1000) / 10,
      session_count:     n_sessions,
      total_laps,
    });
  }

  return results.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

app.get('/api/circuit/:slug/pilot-ratings', (req, res) => {
  try {
    res.json(_computePilotRatings(req.params.slug));
  } catch(e) {
    console.error('[Logger] Error calculando ratings:', e.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Limpiar sesiones vacías
app.post('/api/cleanup', httpAuth, (req, res) => {
  db.cleanupEmptySessions();
  res.json({ ok: true });
});

// ── Stats (logger-stats.html servido desde src/) ─────────────────────────

app.get('/stats', (req, res) => {
  try {
    let html = fs.readFileSync(path.join(__dirname, '../src/logger-stats.html'), 'utf8');

    // Auto-conectar al propio servidor si no hay URL guardada en localStorage
    html = html.replace(
      `localStorage.getItem(LS_URL) || 'https://stintpro.duckdns.org'`,
      `localStorage.getItem(LS_URL) || location.origin`,
    );
    // Cargar aunque no haya API key (la key es opcional si no está configurada)
    html = html.replace(
      `if (savedUrl && savedKey) load();`,
      `if (savedUrl) load(); else { document.getElementById('cfg-url').value = location.origin; load(); }`,
    );
    // Inyectar nav de vuelta al inicio
    html = html.replace(
      `<div class="header">`,
      `<div style="background:#08090a;padding:10px 20px;border-bottom:1px solid #1a1b1e;display:flex;gap:10px">
  <a href="/" style="color:#555;text-decoration:none;font-size:12px;padding:4px 10px;border:1px solid #1e2030;border-radius:4px">← Inicio</a>
  <a href="/recordings" style="color:#5b8dee;text-decoration:none;font-size:12px;padding:4px 10px;border:1px solid #1e3a6e;border-radius:4px">⏺ Grabaciones</a>
</div>
<div class="header">`,
    );

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch(e) {
    console.error('[Logger] Error cargando logger-stats.html:', e.message);
    res.status(500).send('<pre>Error interno del servidor</pre>');
  }
});

// ── Panel de grabaciones (UI) ─────────────────────────────────────────────

app.get('/recordings', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>StintPro Logger — Grabaciones</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #08090a; color: #c9d1d9; font-family: 'DM Mono', 'Fira Mono', monospace; font-size: 13px; padding: 24px; }
  h1 { color: #5b8dee; font-size: 18px; font-weight: 500; margin-bottom: 4px; }
  .subtitle { color: #555; margin-bottom: 28px; font-size: 11px; }
  h2 { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: .08em; margin: 28px 0 10px; }
  .circuits { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 4px; }
  .circuit-card { background: #0e0f11; border: 1px solid #1e2030; border-radius: 6px; padding: 12px 16px; min-width: 200px; }
  .circuit-card .cname { font-weight: 500; color: #e6edf3; margin-bottom: 6px; }
  .circuit-card .cmeta { color: #555; font-size: 11px; margin-bottom: 10px; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; }
  .dot.green  { background: #22c55e; }
  .dot.red    { background: #ef4444; }
  .dot.yellow { background: #fbbf24; }
  .btn { display: inline-block; padding: 5px 12px; border-radius: 4px; border: none; cursor: pointer; font-family: inherit; font-size: 11px; font-weight: 500; }
  .btn-blue   { background: #1e3a6e; color: #5b8dee; }
  .btn-blue:hover { background: #253f7a; }
  .btn-green  { background: #14532d; color: #22c55e; }
  .btn-green:hover { background: #166534; }
  .btn-red    { background: #450a0a; color: #ef4444; }
  .btn-red:hover  { background: #5a0e0e; }
  .btn-sm { padding: 3px 8px; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { color: #555; font-weight: 400; text-align: left; padding: 6px 10px; border-bottom: 1px solid #1e2030; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
  td { padding: 7px 10px; border-bottom: 1px solid #12141a; color: #c9d1d9; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #0e0f11; }
  .file-name { color: #8b949e; font-size: 11px; }
  .size { color: #555; }
  .empty { color: #333; font-style: italic; padding: 20px 10px; text-align: center; }
  .tag { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; }
  .tag-on  { background: #14532d; color: #22c55e; }
  .tag-off { background: #1a1b1f; color: #444; }
  #toast { position: fixed; bottom: 20px; right: 20px; background: #1e2030; border: 1px solid #2d3250; padding: 10px 16px; border-radius: 6px; color: #c9d1d9; font-size: 12px; opacity: 0; transition: opacity .2s; pointer-events: none; }
  #toast.show { opacity: 1; }
</style>
</head>
<body>
<div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">
  <a href="/" style="color:#555;text-decoration:none;font-size:12px;padding:5px 10px;border:1px solid #1e2030;border-radius:4px">← Inicio</a>
  <a href="/stats" style="color:#5b8dee;text-decoration:none;font-size:12px;padding:5px 10px;border:1px solid #1e3a6e;border-radius:4px">📊 Stats</a>
</div>
<h1>StintPro Logger</h1>
<div class="subtitle">Panel de grabaciones raw — <span id="server-url"></span></div>

<h2>Circuitos</h2>
<div class="circuits" id="circuits-list">
  <div class="empty">Cargando...</div>
</div>

<h2>Grabaciones</h2>
<table>
  <thead><tr><th>Circuito</th><th>Fichero</th><th>Tamaño</th><th>Fecha</th><th></th></tr></thead>
  <tbody id="recordings-body"><tr><td colspan="5" class="empty">Cargando...</td></tr></tbody>
</table>

<div id="toast"></div>

<script>
const $ = id => document.getElementById(id);
const API_KEY = '${API_KEY}';
const AUTH_HEADERS = API_KEY ? { 'Content-Type': 'application/json', 'X-API-Key': API_KEY } : { 'Content-Type': 'application/json' };
document.getElementById('server-url').textContent = location.host;

function toast(msg, ok = true) {
  const t = $('toast');
  t.textContent = msg;
  t.style.borderColor = ok ? '#22c55e44' : '#ef444444';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

async function loadCircuits() {
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    const el = $('circuits-list');
    if (!d.circuits?.length) { el.innerHTML = '<div class="empty">Sin circuitos configurados</div>'; return; }
    el.innerHTML = d.circuits.map(c => \`
      <div class="circuit-card">
        <div class="cname">
          <span class="dot \${c.connected ? 'green' : 'red'}"></span>\${c.name}
        </div>
        <div class="cmeta">
          \${c.connected ? '● Conectado' : '○ Desconectado'}
          · \${c.lapCount || 0} vueltas
          · \${c.subscribers || 0} clientes
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="tag \${c.rawLog ? 'tag-on' : 'tag-off'}" id="tag-\${c.slug}">
            \${c.rawLog ? 'REC ●' : 'REC ○'}
          </span>
          <button class="btn btn-sm \${c.rawLog ? 'btn-red' : 'btn-green'}"
            id="btn-\${c.slug}"
            onclick="toggleRawLog('\${c.slug}', \${!c.rawLog})">
            \${c.rawLog ? 'Detener' : 'Grabar'}
          </button>
        </div>
      </div>
    \`).join('');
  } catch(e) { $('circuits-list').innerHTML = '<div class="empty">Error cargando circuitos</div>'; }
}

async function toggleRawLog(slug, enable) {
  try {
    const r = await fetch(\`/api/circuit/\${slug}/raw-log\`, {
      method: 'POST', headers: AUTH_HEADERS,
      body: JSON.stringify({ enabled: enable }),
    });
    if (r.ok) {
      toast(enable ? \`Grabando \${slug}\` : \`Grabación \${slug} detenida\`);
      await loadCircuits();
    }
  } catch(e) { toast('Error', false); }
}

async function loadRecordings() {
  try {
    const r = await fetch('/api/recordings');
    const files = await r.json();
    const tbody = $('recordings-body');
    if (!files.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">No hay grabaciones todavía.<br>Activa la grabación en un circuito para empezar.</td></tr>';
      return;
    }
    tbody.innerHTML = files.map(f => {
      const slug = f.name.split('_')[0];
      const kb   = f.size < 1024 * 1024
        ? (f.size / 1024).toFixed(1) + ' KB'
        : (f.size / 1024 / 1024).toFixed(1) + ' MB';
      const date = new Date(f.mtime).toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
      return \`<tr>
        <td><b>\${slug}</b></td>
        <td class="file-name">\${f.name}</td>
        <td class="size">\${kb}</td>
        <td>\${date}</td>
        <td><a href="/api/recordings/\${f.name}" download class="btn btn-blue btn-sm">Descargar</a></td>
      </tr>\`;
    }).join('');
  } catch(e) {
    $('recordings-body').innerHTML = '<tr><td colspan="5" class="empty">Error cargando grabaciones</td></tr>';
  }
}

loadCircuits();
loadRecordings();
setInterval(loadCircuits, 10000);
setInterval(loadRecordings, 15000);
</script>
</body>
</html>`);
});

// ── Raw log / recordings ──────────────────────────────────────────────────

// Listar grabaciones
app.get('/api/recordings', (req, res) => {
  const dir = path.join(__dirname, 'recordings');
  if (!fs.existsSync(dir)) return res.json([]);
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.ndjson'))
      .map(f => {
        const stat = fs.statSync(path.join(dir, f));
        return { name: f, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json(files);
  } catch(e) { console.error('[Logger] Error listando grabaciones:', e.message); res.status(500).json({ error: 'Error interno del servidor' }); }
});

// Descargar una grabación
app.get('/api/recordings/:file', (req, res) => {
  const name = path.basename(req.params.file);
  if (!name.endsWith('.ndjson')) return res.status(400).json({ error: 'Tipo inválido' });
  const filePath = path.join(__dirname, 'recordings', name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'No encontrado' });
  res.download(filePath);
});

// Activar/desactivar raw log de un circuito
app.post('/api/circuit/:slug/raw-log', httpAuth, (req, res) => {
  const mon = monitors.get(req.params.slug);
  if (!mon) return res.status(404).json({ error: 'Circuito no encontrado' });
  const enabled = req.body?.enabled !== false;
  mon.setRawLog(enabled);
  res.json({ ok: true, slug: req.params.slug, rawLog: enabled });
});

// ── WebSocket server ──────────────────────────────────────────────────────

const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws._authed = !API_KEY; // si no hay key configurada, auto-autenticado

  // Timeout: si no llega auth en 10s, cerrar
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

    // auth — primer mensaje obligatorio cuando hay API_KEY
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

    // pilot — subscripción filtrada por dorsal para la app del piloto
    if (msg.type === 'pilot') {
      const slug   = (msg.slug   || '').trim();
      const dorsal = (msg.dorsal || '').toString().trim();
      const mon    = monitors.get(slug);
      if (!mon) {
        ws.send(JSON.stringify({ type: 'error', msg: `Circuito '${slug}' no encontrado` }));
        return;
      }
      if (!dorsal) {
        ws.send(JSON.stringify({ type: 'error', msg: 'dorsal requerido' }));
        return;
      }
      mon.subscribePilot(ws, dorsal);
      return;
    }

    // team_msg — mensaje del equipo al piloto
    if (msg.type === 'team_msg') {
      const slug   = (msg.slug   || '').trim();
      const dorsal = (msg.dorsal || '').toString().trim();
      const text   = (msg.text   || '').trim();
      const mon    = monitors.get(slug);
      if (!mon || !dorsal || !text) {
        ws.send(JSON.stringify({ type: 'error', msg: 'slug, dorsal y text requeridos' }));
        return;
      }
      const clients = mon.pilotSubscribers.get(dorsal);
      if (clients) {
        const payload = JSON.stringify({ type: 'team_msg', text });
        for (const c of clients) {
          if (c.readyState === 1) try { c.send(payload); } catch(e) {}
        }
      }
      ws.send(JSON.stringify({ type: 'team_msg_sent', dorsal, text }));
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
