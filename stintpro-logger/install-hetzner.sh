#!/bin/bash
# Deploy StintPro Logger to /opt/stintpro-logger
set -e
DIR=/opt/stintpro-logger
systemctl stop stintpro-logger 2>/dev/null || true
echo "Servicio detenido"

# Backup + reset DB si está vacío
[ -f "$DIR/data/stintpro.db" ] && cp "$DIR/data/stintpro.db" "/tmp/stintpro-$(date +%s).db.bak" && echo "DB backup OK"
COUNT=$(sqlite3 "$DIR/data/stintpro.db" "SELECT COUNT(*) FROM sessions;" 2>/dev/null || echo 0)
[ "$COUNT" = "0" ] && rm -f "$DIR/data/stintpro.db" && echo "DB vacío eliminado"

cat > "$DIR/server.js" << 'ENDDEPLOY_SERVER_JS'
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
ENDDEPLOY_SERVER_JS

cat > "$DIR/db.js" << 'ENDDEPLOY_DB_JS'
// ── StintPro Logger — DB layer (sql.js para compatibilidad ARM) ────────────
const path = require('path');
const fs   = require('fs');

let SQL = null;
let db  = null;
let _saving = false;
const DB_PATH = path.join(__dirname, 'data', 'stintpro.db');

function _migrate() {
  // Detectar esquema antiguo del NAS (columna 'active' en vez de 'is_active')
  try {
    const cols = db.exec("PRAGMA table_info(sessions)");
    if (!cols.length || !cols[0].values.length) return;
    const names = cols[0].values.map(r => r[1]);
    if (names.includes('active') && !names.includes('is_active')) {
      console.log('[DB] Migrando esquema antiguo (active → is_active)...');
      db.run('ALTER TABLE sessions RENAME COLUMN active TO is_active');
      // Mapear columnas antiguas al nuevo nombre si existen
      if (names.includes('circuit') && !names.includes('circuit_name'))
        db.run('ALTER TABLE sessions ADD COLUMN circuit_name TEXT');
      db.run("UPDATE sessions SET circuit_name=circuit WHERE circuit_name IS NULL");
      console.log('[DB] Migración completada');
    }
  } catch(e) {
    console.warn('[DB] Aviso migración:', e.message);
  }
}

async function init() {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();

  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  _migrate();
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      slug         TEXT    NOT NULL,
      circuit_name TEXT,
      started_at   INTEGER,
      ended_at     INTEGER,
      is_active    INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS laps (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   INTEGER NOT NULL,
      dorsal       TEXT,
      name         TEXT,
      lap_time_ms  INTEGER,
      lap_number   INTEGER,
      timestamp    INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE TABLE IF NOT EXISTS pit_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   INTEGER NOT NULL,
      dorsal       TEXT,
      event_type   TEXT,
      stands_count INTEGER DEFAULT 0,
      timestamp    INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      session_id   INTEGER PRIMARY KEY,
      snapshot_json TEXT,
      updated_at   INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_laps_session ON laps(session_id);
    CREATE INDEX IF NOT EXISTS idx_pit_session  ON pit_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_slug ON sessions(slug);
  `);

  _save();
  setInterval(_save, 120000); // cada 2 min — menos bloqueos del event loop
  console.log('[DB] Inicializada:', DB_PATH);
}

function _save() {
  if (!db || _saving) return;
  _saving = true;
  setImmediate(() => {
    try {
      const data = db.export();
      fs.writeFile(DB_PATH, Buffer.from(data), err => {
        _saving = false;
        if (err) console.error('[DB] Error guardando:', err.message);
      });
    } catch(e) { _saving = false; console.error('[DB] Error exportando:', e.message); }
  });
}

// ── Sessions ──────────────────────────────────────────────────────────────

function createSession(slug, circuitName) {
  const stmt = db.prepare(
    'INSERT INTO sessions (slug, circuit_name, started_at, is_active) VALUES (?, ?, ?, 1)'
  );
  stmt.run([slug, circuitName || slug, Date.now()]);
  stmt.free();
  const r = db.exec('SELECT last_insert_rowid() as id');
  const id = r[0].values[0][0];
  _save();
  console.log(`[DB] Sesión creada #${id} para ${slug}`);
  return id;
}

function endSession(sessionId) {
  const stmt = db.prepare('UPDATE sessions SET ended_at=?, is_active=0 WHERE id=?');
  stmt.run([Date.now(), sessionId]);
  stmt.free();
  _save();
}

function cleanupEmptySessions() {
  db.run(`DELETE FROM sessions WHERE is_active=0
          AND id NOT IN (SELECT DISTINCT session_id FROM laps)`);
  _save();
}

function deleteSession(sessionId) {
  db.run(`DELETE FROM laps        WHERE session_id=${sessionId}`);
  db.run(`DELETE FROM pit_events  WHERE session_id=${sessionId}`);
  db.run(`DELETE FROM snapshots   WHERE session_id=${sessionId}`);
  db.run(`DELETE FROM sessions    WHERE id=${sessionId}`);
  _save();
}

// ── Laps ──────────────────────────────────────────────────────────────────

function insertLap(sessionId, dorsal, name, lapTimeMs, lapNumber, timestamp) {
  const stmt = db.prepare(
    'INSERT INTO laps (session_id,dorsal,name,lap_time_ms,lap_number,timestamp) VALUES (?,?,?,?,?,?)'
  );
  stmt.run([sessionId, dorsal, name || '', lapTimeMs, lapNumber, timestamp || Date.now()]);
  stmt.free();
}

function getLapsBySession(sessionId) {
  const r = db.exec(
    `SELECT dorsal,name,lap_time_ms,lap_number,timestamp FROM laps WHERE session_id=${sessionId} ORDER BY timestamp ASC`
  );
  return _rows(r);
}

// ── Pit events ────────────────────────────────────────────────────────────

function insertPitEvent(sessionId, dorsal, eventType, standsCount, timestamp) {
  const stmt = db.prepare(
    'INSERT INTO pit_events (session_id,dorsal,event_type,stands_count,timestamp) VALUES (?,?,?,?,?)'
  );
  stmt.run([sessionId, dorsal, eventType, standsCount || 0, timestamp || Date.now()]);
  stmt.free();
}

function getPitEventsBySession(sessionId) {
  const r = db.exec(
    `SELECT dorsal,event_type,stands_count,timestamp FROM pit_events WHERE session_id=${sessionId} ORDER BY timestamp ASC`
  );
  return _rows(r);
}

// ── Snapshots ─────────────────────────────────────────────────────────────

function saveSnapshot(sessionId, obj) {
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO snapshots (session_id,snapshot_json,updated_at) VALUES (?,?,?)'
  );
  stmt.run([sessionId, JSON.stringify(obj), Date.now()]);
  stmt.free();
}

// ── Queries / stats ───────────────────────────────────────────────────────

function getAllSessions() {
  const r = db.exec(`
    SELECT s.id, s.slug, s.circuit_name, s.started_at, s.ended_at, s.is_active,
           COUNT(l.id) as lap_count
    FROM sessions s LEFT JOIN laps l ON l.session_id=s.id
    GROUP BY s.id ORDER BY s.id DESC LIMIT 200
  `);
  return _rows(r);
}

function getCircuitSessions(slug, limit = 50) {
  const s = slug.replace(/'/g, "''");
  const r = db.exec(
    `SELECT id,slug,circuit_name,started_at,ended_at,is_active FROM sessions
     WHERE slug='${s}' ORDER BY id DESC LIMIT ${limit}`
  );
  return _rows(r);
}

function getBestLapsByCircuit(slug) {
  const s = slug.replace(/'/g, "''");
  const r = db.exec(`
    SELECT l.dorsal, l.name, MIN(l.lap_time_ms) as best_ms, COUNT(*) as total_laps,
           s.circuit_name, s.started_at
    FROM laps l JOIN sessions s ON s.id=l.session_id
    WHERE s.slug='${s}' AND l.lap_time_ms BETWEEN 20000 AND 300000
    GROUP BY l.dorsal, l.name ORDER BY best_ms ASC LIMIT 100
  `);
  return _rows(r);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function _rows(result) {
  if (!result.length) return [];
  const cols = result[0].columns;
  return result[0].values.map(row =>
    Object.fromEntries(cols.map((c, i) => [c, row[i]]))
  );
}

module.exports = {
  init,
  createSession, endSession, cleanupEmptySessions, deleteSession,
  insertLap, getLapsBySession,
  insertPitEvent, getPitEventsBySession,
  saveSnapshot,
  getAllSessions, getCircuitSessions, getBestLapsByCircuit,
};
ENDDEPLOY_DB_JS

cat > "$DIR/apex-parser.js" << 'ENDDEPLOY_APEX_PARSER_JS'
// ── ApexParser — port de apex-connector.js sin DOM ────────────────────────
// Mismo protocolo, mismas reglas. Callbacks en lugar de window.ApexClock.
// Grid parsing con regex (sin DOMParser).

class ApexParser {
  constructor({ onLap, onPit, onState, onSessionEnd, onNewSession } = {}) {
    this._karts          = {};
    this._colMap         = {};
    this._colByNum       = {};
    this._sessionActive  = false;
    this._sessionFinished = false;
    this._leaderLap      = 0;
    this._countdown      = null;

    // callbacks
    this.onLap        = onLap;        // (dorsal, name, lapMs, lapNumber, ts)
    this.onPit        = onPit;        // (dorsal, eventType, standsCount, ts)
    this.onState      = onState;      // (stateObj)
    this.onSessionEnd = onSessionEnd;
    this.onNewSession = onNewSession;
  }

  reset() {
    this._karts = {}; this._colMap = {}; this._colByNum = {};
    this._sessionActive = false; this._sessionFinished = false;
    this._leaderLap = 0; this._countdown = null;
  }

  parse(raw) {
    const lines = raw.split('\n');
    let changed = false;

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      // ── VUELTA COMPLETA ──────────────────────────────────────────
      const lapM = line.match(/^(r\d+)\|\*\|(\d+)\|(\d*)$/);
      if (lapM) {
        const k = this._kart(lapM[1]);
        const ms = parseInt(lapM[2]);
        if (ms >= 20000 && ms < 300000 && !k._lapInvalid) {
          k._lapFlash = Date.now();
          if (!this._colMap.llp) {
            const t = parseFloat((ms / 1000).toFixed(3));
            const lastH = k.lapHistory[k.lapHistory.length - 1];
            if (lastH === undefined || Math.abs(lastH - t) > 0.05) {
              k.lastLap = t;
              k.lapHistory.push(t);
              if (k.lapHistory.length > 1500) k.lapHistory.shift();
              if (!k.bestLap || t < k.bestLap) k.bestLap = t;
              k._lapFromFlash = t;
              if (this.onLap && k.dorsal)
                this.onLap(k.dorsal, k.name, ms, k.lapHistory.length, Date.now());
            }
          }
          k._lapInvalid = false;
        }
        changed = true; continue;
      }

      // ── VUELTA ANULADA ───────────────────────────────────────────
      if (line.match(/^r\d+\|\*in\|0$/) || line.match(/^r\d+\|\*out\|0$/)) {
        this._kart(line.split('|')[0])._lapInvalid = true;
        changed = true; continue;
      }

      // ── SECTOR PARCIAL ───────────────────────────────────────────
      if (line.match(/^r\d+\|\*i\d+\|/)) { changed = true; continue; }

      // ── POSICIÓN DIRECTA ─────────────────────────────────────────
      const posM = line.match(/^(r\d+)\|#\|(\d+)$/);
      if (posM) {
        const p = parseInt(posM[2]);
        if (p > 0) this._kart(posM[1]).pos = p;
        changed = true; continue;
      }

      // ── GRID INICIAL ─────────────────────────────────────────────
      if (line.startsWith('grid|')) {
        if (this._sessionActive && this._sessionFinished) {
          this._karts = {}; this._leaderLap = 0; this._sessionFinished = false;
          if (this.onNewSession) this.onNewSession();
        }
        this._sessionActive = true;
        this._parseGrid(line.substring(5));
        changed = true; continue;
      }

      // ── COUNTDOWN / COUNT ────────────────────────────────────────
      if (line.startsWith('dyn1|countdown|')) {
        this._countdown = parseInt(line.split('|')[2]) || null;
        changed = true; continue;
      }
      if (line.startsWith('dyn1|count|')) {
        this._countdown = parseInt(line.split('|')[2]) || null;
        changed = true; continue;
      }

      // ── TEXTO DYN1 (vuelta del líder) ────────────────────────────
      if (line.startsWith('dyn1|text|')) {
        const txt = line.substring(10).trim();
        const lm = txt.match(/Lap\s+(\d+)\/(\d+)/i);
        if (lm) this._leaderLap = parseInt(lm[1]);
        changed = true; continue;
      }

      // ── BANDERA A CUADROS ─────────────────────────────────────────
      if (line === 'light|lf|') {
        this._sessionFinished = true;
        if (this.onSessionEnd) this.onSessionEnd();
        changed = true; continue;
      }

      // ── CELDA CON VALOR ──────────────────────────────────────────
      const cellM = line.match(/^(r\d+)(c\d+)\|([^|]*)\|(.*)/);
      if (cellM) {
        this._applyCell(this._kart(cellM[1]), cellM[2], cellM[3], cellM[4]);
        changed = true; continue;
      }

      // ── CELDA SIN VALOR ──────────────────────────────────────────
      const cellM2 = line.match(/^(r\d+)(c\d+)\|([^|]*)$/);
      if (cellM2) {
        this._applyCell(this._kart(cellM2[1]), cellM2[2], cellM2[3], '');
        changed = true;
      }
    }

    if (changed) this._emit();
  }

  // ── Aplicar celda ─────────────────────────────────────────────────────

  _kart(rowId) {
    if (!this._karts[rowId]) this._karts[rowId] = {
      _rowId: rowId, lapHistory: [], state: 'sr', tours: 0,
      pit: false, pitS: 0, pitDuration: 0, standsCount: 0,
      _lapInvalid: false, checkered: false,
    };
    return this._karts[rowId];
  }

  _applyCell(k, col, type, val) {
    const dtype = this._colByNum[col] || '';
    const v = (val !== undefined && val !== '') ? val : type;

    const STATE_CODES = ['si','so','sr','su','sd','ss','sf','gs','gf','gl','gm'];
    const isStateCol  = dtype === 'grp' || dtype === 'sta' ||
                        (col === 'c1' && !this._colMap.grp) ||
                        (col === 'c2' && !this._colByNum['c2']);
    const isStateCode = STATE_CODES.includes(type) && !dtype;

    if (isStateCol || isStateCode) {
      if (type === 'in') return;
      k.state = type;
      if (type === 'ss') k._lapInvalid = true;
      else if (['sr','su','sd','gs','gf','gl','gm'].includes(type)) k._lapInvalid = false;
      if (type === 'si') {
        k.pit = true; k.pitState = 'in'; k._pitInTime = Date.now();
        if (this.onPit && k.dorsal) this.onPit(k.dorsal, 'in', k.standsCount, Date.now());
      } else if (type === 'so') {
        k.pit = true; k.pitState = 'out'; k.pitS = 0; k._pitTimerActive = false; k._pitInTime = null;
        if (this.onPit && k.dorsal) this.onPit(k.dorsal, 'out', k.standsCount, Date.now());
      } else if (type === 'sr' || type === 'su') {
        if (!k._pitTimerActive) k.pit = false;
        k.pitState = null; k._pitInTime = null;
      }
      if (type === 'sf') k.checkered = true;
      return;
    }

    if (dtype === 'rk') {
      const p = parseInt(v);
      if (!isNaN(p) && p > 0) k.pos = p;
      return;
    }
    if (dtype === 'no') {
      const d = (v || '').trim();
      if (d && !isNaN(parseInt(d))) k.dorsal = d;
      return;
    }
    if (dtype === 'dr') {
      const n = (v || '').trim();
      const skip = ['in','tn','ti','tb','ib','sr','sd','su','si','ss','sf','gf','gl','gm','gs','to','so'];
      if (n && n.length > 1 && isNaN(parseInt(n)) && !skip.includes(n)) k.name = n;
      return;
    }
    if (dtype === 's1') { const x = parseFloat(v); if (!isNaN(x) && x > 0 && x < 120) k.s1 = x; return; }
    if (dtype === 's2') { const x = parseFloat(v); if (!isNaN(x) && x > 0 && x < 120) k.s2 = x; return; }
    if (dtype === 's3') { const x = parseFloat(v); if (!isNaN(x) && x > 0 && x < 120) k.s3 = x; return; }

    if (dtype === 'llp') {
      const t = this._pt(v);
      if (t && t >= 20 && t < 300) {
        if (k._lapFromFlash !== undefined && Math.abs(k._lapFromFlash - t) <= 0.05 && k.lapHistory.length) {
          // Refinar la vuelta ya registrada por |*|
          k.lapHistory[k.lapHistory.length - 1] = t;
          k.lastLap = t;
          k._lapFromFlash = undefined;
        } else {
          k.lastLap = t;
          k.lapHistory.push(t);
          if (k.lapHistory.length > 1500) k.lapHistory.shift();
          k._lapFromFlash = undefined;
          if (!k.bestLap || t < k.bestLap) k.bestLap = t;
          if (this.onLap && k.dorsal)
            this.onLap(k.dorsal, k.name, Math.round(t * 1000), k.lapHistory.length, Date.now());
        }
      }
      return;
    }

    if (dtype === 'blp') {
      const t = this._pt(v);
      if (t && t >= 20 && t < 300 && (!k.bestLap || t < k.bestLap)) k.bestLap = t;
      return;
    }

    if (dtype === 'gap') {
      const vRaw = v || '';
      if (/tour|lap|tr\b/i.test(vRaw)) {
        const n = parseInt(vRaw.replace(/[^\d]/g, ''));
        k.gap = !isNaN(n) && n > 0 ? '+' + n + 'v' : '';
        return;
      }
      const raw = vRaw.replace(/[a-zA-Z]/g, '').trim();
      if (!raw) { k.gap = ''; return; }
      let t;
      if (raw.includes(':')) { const p = raw.split(':'); t = parseFloat(p[0]) * 60 + parseFloat(p[1]); }
      else t = parseFloat(raw);
      if (!isNaN(t) && t >= 0) k.gap = t > 0 ? '+' + t.toFixed(3) : '';
      return;
    }

    if (dtype === 'tlp' || dtype === 'lc') {
      const n = parseInt(v); if (!isNaN(n) && n > 0) k.tours = n; return;
    }

    if (dtype === 'pit') {
      if (type === 'to') {
        const s = this._parsePitTimer(v);
        if (s !== null) { k.pitS = s; k.pit = true; k._pitTimerActive = true; }
      } else if (type === 'in') {
        k._pitTimerActive = false;
        if (k.state === 'sr' || k.state === 'su') k.pit = false;
        const n = parseInt(v); if (!isNaN(n) && n > 0) k.standsCount = n;
      }
      return;
    }

    if (dtype === 'int') {
      const raw = (v || '').replace(/[a-zA-Z]/g, '').trim();
      if (!raw) { k.interval = ''; return; }
      let t;
      if (raw.includes(':')) { const p = raw.split(':'); t = parseFloat(p[0]) * 60 + parseFloat(p[1]); }
      else t = parseFloat(raw);
      if (!isNaN(t) && t >= 0) k.interval = t > 0 ? '+' + t.toFixed(3) : '';
      return;
    }

    if (dtype === 'otr') return;

    if (type === 'to') {
      const s = this._parsePitTimer((val !== undefined && val !== '') ? val : type);
      if (s !== null) { k.pitS = s; k.pit = true; k._pitTimerActive = true; }
      return;
    }
    if (type === 'sf') k.checkered = true;
  }

  _parsePitTimer(v) {
    if (!v) return null;
    v = v.replace(/\.$/, '').trim();
    if (v.includes(':')) {
      const p = v.split(':');
      const s = parseInt(p[0]) * 60 + parseFloat(p[1]);
      return isNaN(s) ? null : Math.round(s);
    }
    const s = parseFloat(v);
    return isNaN(s) ? null : Math.round(s);
  }

  _pt(str) {
    if (!str) return null;
    str = str.replace(/[a-zA-Z]/g, '').replace(/\.$/, '').trim();
    if (!str || str.length < 2) return null;
    if (str.includes(':')) {
      const p = str.split(':');
      const v = parseFloat(p[0]) * 60 + parseFloat(p[1]);
      return isNaN(v) ? null : parseFloat(v.toFixed(3));
    }
    const n = parseFloat(str);
    if (isNaN(n) || n < 1) return null;
    return n > 1000 ? parseFloat((n / 1000).toFixed(3)) : n;
  }

  // ── Grid parsing (regex, sin DOMParser) ───────────────────────────────

  _parseGrid(html) {
    if (!html || html.length < 10) return;
    try {
      // colMap desde r0
      const r0m = html.match(/<tr[^>]*data-id=["']r0["'][^>]*>([\s\S]*?)<\/tr>/i);
      if (r0m) {
        this._colMap = {}; this._colByNum = {};
        const r0h = r0m[1];
        // Probar ambos órdenes de atributos
        const re1 = /data-id=["'](c\d+)["'][^>]*data-type=["']([^"']+)["']/gi;
        const re2 = /data-type=["']([^"']+)["'][^>]*data-id=["'](c\d+)["']/gi;
        let m;
        while ((m = re1.exec(r0h)) !== null) {
          if (!this._colByNum[m[1]]) { this._colMap[m[2].trim()] = m[1]; this._colByNum[m[1]] = m[2].trim(); }
        }
        while ((m = re2.exec(r0h)) !== null) {
          const dtype = m[1].trim(), cid = m[2];
          if (!this._colByNum[cid]) { this._colMap[dtype] = cid; this._colByNum[cid] = dtype; }
        }
      }

      // Filas de karts
      const rowRe = /<tr[^>]*data-id=["'](r\d+)["'][^>]*>([\s\S]*?)<\/tr>/gi;
      let rowM; let gridPos = 0;
      while ((rowM = rowRe.exec(html)) !== null) {
        const rowId = rowM[1];
        if (rowId === 'r0') continue;
        gridPos++;
        const rowH = rowM[2];
        const k = this._kart(rowId);

        // Estado
        const stCol = this._colMap.grp || this._colMap.sta || 'c1';
        const stm = rowH.match(new RegExp(`data-id=["']${stCol}["'][^>]*class=["']([^"']+)["']`));
        if (stm) {
          const cls = stm[1].trim().split(/\s+/)[0];
          if (cls && cls !== 'in') { k.state = cls; if (cls === 'sf') k.checkered = true; }
        }

        // Posición
        k.pos = k.pos || gridPos;
        const rkm = rowH.match(/class=["'][^"']*\brk\b[^"']*["'][^>]*>.*?<p[^>]*>(\d+)<\/p>/i);
        if (rkm) k.pos = parseInt(rkm[1]);

        // Dorsal
        const noCol = this._colMap.no;
        if (noCol) {
          const nom = rowH.match(new RegExp(`data-id=["']${noCol}["'][^>]*>[^<]*<(?:div|p)[^>]*>\\s*(\\d+)\\s*<`));
          if (nom) k.dorsal = nom[1];
        }

        // Nombre
        const drCol = this._colMap.dr;
        if (drCol) {
          const drm = rowH.match(new RegExp(`data-id=["']${drCol}["'][^>]*>\\s*<[^>]+>([^<]{2,})<`));
          if (!drm) {
            const drm2 = rowH.match(new RegExp(`data-id=["']${drCol}["'][^>]*>([^<]{2,})<`));
            if (drm2) { const n = drm2[1].trim(); if (n && isNaN(parseInt(n))) k.name = n; }
          } else {
            const n = drm[1].trim(); if (n && isNaN(parseInt(n))) k.name = n;
          }
        }

        // Best lap
        const blpCol = this._colMap.blp;
        if (blpCol) {
          const bm = rowH.match(new RegExp(`data-id=["']${blpCol}["'][^>]*>([^<]+)<`));
          if (bm) { const t = this._pt(bm[1]); if (t && t >= 20 && t < 300) k.bestLap = t; }
        }

        // Last lap (solo si no hay valor en vivo)
        const llpCol = this._colMap.llp;
        if (llpCol && !k.lastLap) {
          const lm = rowH.match(new RegExp(`data-id=["']${llpCol}["'][^>]*>([^<]+)<`));
          if (lm) { const t = this._pt(lm[1]); if (t && t >= 20 && t < 300) k.lastLap = t; }
        }

        // Vueltas
        const tlpCol = this._colMap.tlp || this._colMap.lc;
        if (tlpCol) {
          const tm = rowH.match(new RegExp(`data-id=["']${tlpCol}["'][^>]*>(\\d+)<`));
          if (tm) k.tours = parseInt(tm[1]);
        }

        // Stands count
        const pitCol = this._colMap.pit;
        if (pitCol) {
          const pm = rowH.match(new RegExp(`data-id=["']${pitCol}["'][^>]*>(\\d+)<`));
          if (pm) k.standsCount = parseInt(pm[1]);
        }

        k.tours = k.tours || 0;
      }
    } catch (e) {
      console.error('[ApexParser] parseGrid:', e.message);
    }
  }

  // ── Estado para broadcast ─────────────────────────────────────────────

  getState() {
    const now = Date.now();
    const equipos = Object.values(this._karts)
      .filter(k => k.dorsal || k._rowId)
      .map(k => { if (!k.dorsal) k.dorsal = k._rowId.replace('r', ''); return k; })
      .map(k => ({
        dorsal: k.dorsal, name: k.name || `#${k.dorsal}`,
        pos: k.pos || 99, lastLap: k.lastLap || null, bestLap: k.bestLap || null,
        lapHistory: k.lapHistory || [], gap: k.gap || '', interval: k.interval || '',
        pit: !!k.pit, pitState: k.pitState || null,
        pitS: k._pitTimerActive ? k.pitS : (k.pit && k._pitInTime ? Math.round((now - k._pitInTime) / 1000) : k.pitS || 0),
        pitDuration: k.pitDuration || 0,
        state: k.state || 'sr', s1: k.s1, s2: k.s2, s3: k.s3,
        tours: k.tours || 0, standsCount: k.standsCount || 0, stops: k.stops || 0,
        checkered: !!k.checkered, gapMs: k.gapMs || 0,
        lapFlash: false, posChange: null,
        sessionFinished: this._sessionFinished,
      }))
      .sort((a, b) => a.pos === 99 && b.pos === 99
        ? parseInt(a.dorsal) - parseInt(b.dorsal)
        : a.pos - b.pos);

    return {
      equipos,
      leaderLap: this._leaderLap,
      timestamp: now,
      sessionFinished: this._sessionFinished,
      colMap: this._colMap,
      countdown: this._countdown,
    };
  }

  _emit() {
    if (this.onState) this.onState(this.getState());
  }
}

module.exports = ApexParser;
ENDDEPLOY_APEX_PARSER_JS

cat > "$DIR/circuit-monitor.js" << 'ENDDEPLOY_CIRCUIT_MONITOR_JS'
// ── CircuitMonitor — gestiona una conexión Apex + sesión + subscriptores ──
const WebSocket  = require('ws');
const ApexParser = require('./apex-parser');
const db         = require('./db');

const BROADCAST_INTERVAL_MS = 200; // throttle live updates a 5 fps

class CircuitMonitor {
  constructor(cfg) {
    this.slug      = cfg.slug;
    this.port      = cfg.port || 7913;
    this.name      = cfg.name || cfg.slug;

    this.ws              = null;
    this.connected       = false;
    this._reconnectTimer = null;
    this._saveTimer      = null;
    this._lastBroadcast  = 0;

    // Subscriptores WebSocket del dashboard
    this.subscribers = new Set();

    // Estado de sesión
    this.sessionId  = null;
    this.pitEvents  = [];   // eventos de pit de la sesión actual (para snapshot)
    this._lapCount  = 0;

    this.parser = new ApexParser({
      onLap:        this._onLap.bind(this),
      onPit:        this._onPit.bind(this),
      onState:      this._onState.bind(this),
      onSessionEnd: this._onSessionEnd.bind(this),
      onNewSession: this._onNewSession.bind(this),
    });
  }

  start() {
    console.log(`[${this.slug}] Iniciando monitor (${this.name}, port ${this.port})`);
    this._connect();
  }

  stop() {
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._saveTimer)      { clearInterval(this._saveTimer);     this._saveTimer = null;      }
    if (this.ws)              { try { this.ws.close(); } catch(e) {}  this.ws = null;             }
    this.connected = false;
  }

  // ── Conexión Apex ─────────────────────────────────────────────────────

  _connect() {
    try {
      this.ws = new WebSocket(`wss://live-data.apex-timing.com:${this.port}/`, {
        headers: {
          Origin:     'https://live.apex-timing.com',
          Referer:    'https://live.apex-timing.com/rkc/',
          'User-Agent': 'Mozilla/5.0 StintPro-Logger/1.0',
        },
      });

      this.ws.on('open', () => {
        this.connected = true;
        console.log(`[${this.slug}] Apex conectado`);
        this.ws.send(this.slug);
        this._broadcastStatus('connected');
      });

      this.ws.on('message', (data) => {
        try { this.parser.parse(data.toString()); }
        catch(e) { console.error(`[${this.slug}] parse error:`, e.message); }
      });

      this.ws.on('error', (err) => {
        this.connected = false;
        console.error(`[${this.slug}] WS error:`, err.message);
      });

      this.ws.on('close', () => {
        this.connected = false;
        console.log(`[${this.slug}] Desconectado, reconectando en 5s...`);
        this._broadcastStatus('disconnected');
        this._reconnectTimer = setTimeout(() => this._connect(), 5000);
      });
    } catch(e) {
      console.error(`[${this.slug}] connect error:`, e.message);
      this._reconnectTimer = setTimeout(() => this._connect(), 5000);
    }
  }

  // ── Callbacks del parser ──────────────────────────────────────────────

  _onLap(dorsal, name, lapMs, lapNumber, timestamp) {
    if (!this.sessionId) {
      // Primera vuelta real → crear sesión
      this.sessionId = db.createSession(this.slug, this.name);
      this.pitEvents = [];
      this._lapCount = 0;
      // Auto-guardar snapshot cada 10s
      if (this._saveTimer) clearInterval(this._saveTimer);
      this._saveTimer = setInterval(() => this._saveSnapshot(), 10000);
    }
    this._lapCount++;
    db.insertLap(this.sessionId, dorsal, name, lapMs, lapNumber, timestamp);
  }

  _onPit(dorsal, eventType, standsCount, timestamp) {
    if (!this.sessionId) return;
    db.insertPitEvent(this.sessionId, dorsal, eventType, standsCount, timestamp);
    this.pitEvents.push({ dorsal, event: eventType, time: timestamp, standsCount });
  }

  _onState(state) {
    // Throttle broadcast
    const now = Date.now();
    if (now - this._lastBroadcast < BROADCAST_INTERVAL_MS) return;
    this._lastBroadcast = now;
    this._broadcast({ type: 'live', data: state });
  }

  _onSessionEnd() {
    console.log(`[${this.slug}] Sesión #${this.sessionId} finalizada (bandera)`);
    if (this.sessionId) {
      this._saveSnapshot();
      db.endSession(this.sessionId);
    }
  }

  _onNewSession() {
    console.log(`[${this.slug}] Nueva sesión detectada`);
    if (this.sessionId) {
      this._saveSnapshot();
      db.endSession(this.sessionId);
    }
    this.sessionId = null;
    this.pitEvents = [];
    this._lapCount = 0;
    if (this._saveTimer) { clearInterval(this._saveTimer); this._saveTimer = null; }
  }

  // ── Subscriptores WebSocket ───────────────────────────────────────────

  subscribe(ws) {
    this.subscribers.add(ws);
    ws.on('close', () => this.subscribers.delete(ws));
    ws.on('error', () => this.subscribers.delete(ws));
    // Enviar snapshot histórico completo de inmediato
    this._sendHistoryTo(ws);
  }

  _sendHistoryTo(ws) {
    if (ws.readyState !== WebSocket.OPEN) return;
    const state = this.parser.getState();
    // pitEvents permite al cliente reconstruir la cola FIFO del box
    const snapshot = { ...state, pitEvents: [...this.pitEvents] };
    try { ws.send(JSON.stringify({ type: 'history', snapshot })); } catch(e) {}
  }

  _broadcast(msg) {
    const json = JSON.stringify(msg);
    this.subscribers.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) try { ws.send(json); } catch(e) {}
    });
  }

  _broadcastStatus(status) {
    this._broadcast({ type: 'status', slug: this.slug, status });
  }

  _saveSnapshot() {
    if (!this.sessionId) return;
    const state = this.parser.getState();
    db.saveSnapshot(this.sessionId, { ...state, pitEvents: this.pitEvents });
  }

  // ── Info pública ──────────────────────────────────────────────────────

  getInfo() {
    return {
      slug:          this.slug,
      name:          this.name,
      port:          this.port,
      connected:     this.connected,
      sessionActive: !!this.sessionId && !this.parser._sessionFinished,
      sessionId:     this.sessionId,
      lapCount:      this._lapCount,
      kartCount:     Object.values(this.parser._karts).filter(k => k.dorsal).length,
      subscribers:   this.subscribers.size,
    };
  }
}

module.exports = CircuitMonitor;
ENDDEPLOY_CIRCUIT_MONITOR_JS

echo "Archivos copiados"
cd $DIR && npm install --quiet 2>/dev/null || true
systemctl start stintpro-logger
sleep 3
echo "=== Logs ==="
journalctl -u stintpro-logger --no-pager -n 30
