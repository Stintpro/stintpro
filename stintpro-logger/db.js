// ── StintPro Logger — DB layer (better-sqlite3, disco directo con WAL) ──────
// Migrado desde sql.js (que cargaba toda la BD en RAM y reexportaba el fichero
// entero cada 2 min). better-sqlite3 escribe a disco de forma incremental:
//   · sin el volcado completo periódico → no bloquea el event loop al crecer
//   · cada INSERT es durable al instante → se cierra la ventana de pérdida de
//     hasta 2 min de vueltas en un crash (antes insertLap no tocaba disco)
// El fichero es SQLite estándar → compatible con la BD que escribía sql.js
// (se abre tal cual, sin conversión) y con un rollback a la versión sql.js.
const path = require('path');
const fs   = require('fs');
const Database = require('better-sqlite3');

// Normaliza nombres de piloto: quita tildes/diacríticos y colapsa espacios.
// "Germán Muñoz" y "German Muñoz" → "German Munoz" (misma persona en BD).
function _normalizeName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

let db = null;
// Override de ruta por env (pruebas de paridad / tests); por defecto data/stintpro.db.
const DB_PATH = process.env.STINTPRO_DB_PATH || path.join(__dirname, 'data', 'stintpro.db');

function _migrate() {
  try {
    const names = db.prepare("PRAGMA table_info(sessions)").all().map(r => r.name);
    if (!names.length) return;
    if (names.includes('active') && !names.includes('is_active')) {
      console.log('[DB] Migrando esquema antiguo (active → is_active)...');
      db.exec('ALTER TABLE sessions RENAME COLUMN active TO is_active');
      if (names.includes('circuit') && !names.includes('circuit_name'))
        db.exec('ALTER TABLE sessions ADD COLUMN circuit_name TEXT');
      db.exec("UPDATE sessions SET circuit_name=circuit WHERE circuit_name IS NULL");
      console.log('[DB] Migración sessions completada');
    }
    if (!names.includes('title')) {
      db.exec('ALTER TABLE sessions ADD COLUMN title TEXT');
      console.log('[DB] Columna title añadida a sessions');
    }
  } catch(e) {
    console.warn('[DB] Aviso migración sessions:', e.message);
  }

  try {
    const lapNames = db.prepare("PRAGMA table_info(laps)").all().map(r => r.name);
    if (lapNames.length && !lapNames.includes('category')) {
      db.exec('ALTER TABLE laps ADD COLUMN category TEXT');
      console.log('[DB] Columna category añadida a laps');
    }
    if (lapNames.length && !lapNames.includes('team_name')) {
      db.exec('ALTER TABLE laps ADD COLUMN team_name TEXT');
      console.log('[DB] Columna team_name añadida a laps');
    }
  } catch(e) {
    console.warn('[DB] Aviso migración laps:', e.message);
  }
}

// async por compatibilidad: server.js hace `await db.init()` (antes sql.js
// necesitaba await para cargar el WASM; better-sqlite3 es síncrono).
async function init() {
  if (db) return; // idempotente

  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  db = new Database(DB_PATH);
  // WAL: escrituras rápidas y durables sin reescribir el fichero entero.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  _migrate();
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      slug         TEXT    NOT NULL,
      circuit_name TEXT,
      title        TEXT,
      started_at   INTEGER,
      ended_at     INTEGER,
      is_active    INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS laps (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   INTEGER NOT NULL,
      dorsal       TEXT,
      name         TEXT,
      team_name    TEXT,
      category     TEXT,
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

  console.log('[DB] Inicializada (better-sqlite3):', DB_PATH);
}

// ── Sessions ──────────────────────────────────────────────────────────────

function createSession(slug, circuitName, title) {
  const info = db.prepare(
    'INSERT INTO sessions (slug, circuit_name, title, started_at, is_active) VALUES (?, ?, ?, ?, 1)'
  ).run(slug, circuitName || slug, title || null, Date.now());
  const id = Number(info.lastInsertRowid);
  console.log(`[DB] Sesión creada #${id} para ${slug}`);
  return id;
}

// `endedAt` permite cerrar con la hora REAL de la última actividad en vez de la de
// ahora. Importa al limpiar sesiones que quedaron colgadas por un reinicio: sellarlas
// con Date.now() diría que una carrera de hace semanas terminó hoy.
function endSession(sessionId, endedAt) {
  const at = Number.isFinite(endedAt) ? endedAt : Date.now();
  db.prepare('UPDATE sessions SET ended_at=?, is_active=0 WHERE id=?').run(at, sessionId);
}

function updateSessionTitle(sessionId, title) {
  db.prepare('UPDATE sessions SET title=? WHERE id=?').run(title ?? null, sessionId);
}

function cleanupEmptySessions() {
  db.exec(`DELETE FROM sessions WHERE is_active=0
           AND id NOT IN (SELECT DISTINCT session_id FROM laps)`);
}

function deleteSession(sessionId) {
  for (const sql of [
    'DELETE FROM laps       WHERE session_id=?',
    'DELETE FROM pit_events WHERE session_id=?',
    'DELETE FROM snapshots  WHERE session_id=?',
    'DELETE FROM sessions   WHERE id=?',
  ]) { db.prepare(sql).run(sessionId); }
}

// ── Laps ──────────────────────────────────────────────────────────────────

function insertLap(sessionId, dorsal, name, teamName, lapTimeMs, lapNumber, timestamp, category) {
  db.prepare(
    'INSERT INTO laps (session_id,dorsal,name,team_name,category,lap_time_ms,lap_number,timestamp) VALUES (?,?,?,?,?,?,?,?)'
  ).run(sessionId, dorsal ?? null, _normalizeName(name), teamName ? _normalizeName(teamName) : null,
        category || null, lapTimeMs ?? null, lapNumber ?? null, timestamp || Date.now());
}

function getLapsBySession(sessionId) {
  return db.prepare(
    'SELECT dorsal,name,team_name,lap_time_ms,lap_number,timestamp FROM laps WHERE session_id=? ORDER BY timestamp ASC'
  ).all(sessionId);
}

// ── Pit events ────────────────────────────────────────────────────────────

function insertPitEvent(sessionId, dorsal, eventType, standsCount, timestamp) {
  db.prepare(
    'INSERT INTO pit_events (session_id,dorsal,event_type,stands_count,timestamp) VALUES (?,?,?,?,?)'
  ).run(sessionId, dorsal ?? null, eventType ?? null, standsCount || 0, timestamp || Date.now());
}

function getPitEventsBySession(sessionId) {
  return db.prepare(
    'SELECT dorsal,event_type,stands_count,timestamp FROM pit_events WHERE session_id=? ORDER BY timestamp ASC'
  ).all(sessionId);
}

// ── Snapshots ─────────────────────────────────────────────────────────────

function saveSnapshot(sessionId, obj) {
  db.prepare(
    'INSERT OR REPLACE INTO snapshots (session_id,snapshot_json,updated_at) VALUES (?,?,?)'
  ).run(sessionId, JSON.stringify(obj), Date.now());
}

// Último snapshot guardado de una sesión (clasificación oficial de Apex).
function getSnapshot(sessionId) {
  const r = db.prepare('SELECT snapshot_json FROM snapshots WHERE session_id=?').get(sessionId);
  if (!r || !r.snapshot_json) return null;
  try { return JSON.parse(r.snapshot_json); } catch (e) { return null; }
}

// ── Queries / stats ───────────────────────────────────────────────────────

function getAllSessions() {
  return db.prepare(`
    SELECT s.id, s.slug, s.circuit_name, s.title, s.started_at, s.ended_at, s.is_active,
           COUNT(l.id) as lap_count
    FROM sessions s LEFT JOIN laps l ON l.session_id=s.id
    GROUP BY s.id ORDER BY s.id DESC LIMIT 200
  `).all();
}

// Sesión de este circuito que quedó ABIERTA (is_active=1). Tras un reinicio del
// logger es la candidata a reanudar — quién decide si de verdad lo es está en
// CircuitMonitor.canResumeSession, que exige evidencia de que la carrera es la
// misma. Se devuelve con su nº de vueltas para restaurar el contador en memoria.
function getResumableSession(slug) {
  return db.prepare(
    `SELECT s.id, s.slug, s.title, s.started_at, COUNT(l.id) AS lap_count,
            MAX(l.timestamp) AS last_lap_at
     FROM sessions s LEFT JOIN laps l ON l.session_id=s.id
     WHERE s.slug=? AND s.is_active=1
     GROUP BY s.id ORDER BY s.id DESC LIMIT 1`
  ).get(slug) || null;
}

function getCircuitSessions(slug, limit = 50) {
  return db.prepare(
    `SELECT s.id, s.slug, s.circuit_name, s.title, s.started_at, s.ended_at, s.is_active,
            COUNT(l.id) as lap_count
     FROM sessions s LEFT JOIN laps l ON l.session_id=s.id
     WHERE s.slug=?
     GROUP BY s.id ORDER BY s.id DESC LIMIT ?`
  ).all(slug, limit);
}

function deletePilotFromCircuit(slug, name) {
  db.prepare(
    'DELETE FROM laps WHERE name=? AND session_id IN (SELECT id FROM sessions WHERE slug=?)'
  ).run(_normalizeName(name), slug);
}

function mergePilotsInCircuit(slug, names, target) {
  const normTarget = _normalizeName(target);
  const others = (names || []).map(_normalizeName).filter(n => n !== normTarget);
  if (!others.length) return;
  const stmt = db.prepare(
    'UPDATE laps SET name=? WHERE name=? AND session_id IN (SELECT id FROM sessions WHERE slug=?)'
  );
  for (const name of others) { stmt.run(normTarget, name, slug); }
}

function searchPilotsGlobal(query) {
  const q = `%${_normalizeName(query)}%`;
  return db.prepare(`
    SELECT s.slug, s.circuit_name, l.name, l.team_name,
           MIN(l.lap_time_ms) as best_ms,
           CAST(AVG(l.lap_time_ms) AS INTEGER) as avg_ms,
           COUNT(*) as total_laps,
           COUNT(DISTINCT l.session_id) as session_count
    FROM laps l JOIN sessions s ON s.id=l.session_id
    WHERE l.lap_time_ms BETWEEN 20000 AND 300000
      AND (UPPER(l.name) LIKE UPPER(?) OR UPPER(l.team_name) LIKE UPPER(?))
    GROUP BY s.slug, l.name
    ORDER BY s.slug, best_ms ASC
  `).all(q, q);
}

function getTotalLapsByCircuit(slug) {
  const row = db.prepare(
    'SELECT COUNT(*) as n FROM laps l JOIN sessions s ON s.id=l.session_id WHERE s.slug=?'
  ).get(slug);
  return row ? (row.n || 0) : 0;
}

function getPilotSessionsByCircuit(slug) {
  return db.prepare(`
    SELECT l.name, l.team_name, l.session_id, s.started_at,
           MAX(l.category) as category,
           MIN(l.lap_time_ms) as best_ms,
           CAST(AVG(l.lap_time_ms) AS INTEGER) as avg_ms,
           COUNT(*) as laps
    FROM laps l JOIN sessions s ON s.id=l.session_id
    WHERE s.slug=? AND l.lap_time_ms BETWEEN 20000 AND 300000
    GROUP BY l.name, l.session_id
    ORDER BY s.started_at DESC
  `).all(slug);
}

function getBestLapsByCircuit(slug) {
  return db.prepare(`
    SELECT l.dorsal, l.name, l.team_name, MIN(l.lap_time_ms) as best_ms, COUNT(*) as total_laps,
           s.circuit_name, s.started_at
    FROM laps l JOIN sessions s ON s.id=l.session_id
    WHERE s.slug=? AND l.lap_time_ms BETWEEN 20000 AND 300000
    GROUP BY l.dorsal, l.name ORDER BY best_ms ASC LIMIT 100
  `).all(slug);
}

module.exports = {
  init,
  createSession, endSession, updateSessionTitle, cleanupEmptySessions, deleteSession,
  getResumableSession,
  insertLap, getLapsBySession,
  insertPitEvent, getPitEventsBySession,
  saveSnapshot, getSnapshot,
  getAllSessions, getCircuitSessions, getBestLapsByCircuit, getPilotSessionsByCircuit,
  deletePilotFromCircuit, mergePilotsInCircuit, getTotalLapsByCircuit, searchPilotsGlobal,
};
