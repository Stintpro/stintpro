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
    if (!names.includes('title')) {
      db.run('ALTER TABLE sessions ADD COLUMN title TEXT');
      console.log('[DB] Columna title añadida a sessions');
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

function createSession(slug, circuitName, title) {
  const stmt = db.prepare(
    'INSERT INTO sessions (slug, circuit_name, title, started_at, is_active) VALUES (?, ?, ?, ?, 1)'
  );
  stmt.run([slug, circuitName || slug, title || null, Date.now()]);
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
  for (const sql of [
    'DELETE FROM laps       WHERE session_id=?',
    'DELETE FROM pit_events WHERE session_id=?',
    'DELETE FROM snapshots  WHERE session_id=?',
    'DELETE FROM sessions   WHERE id=?',
  ]) { const s = db.prepare(sql); s.run([sessionId]); s.free(); }
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
  return _query(
    'SELECT dorsal,name,lap_time_ms,lap_number,timestamp FROM laps WHERE session_id=? ORDER BY timestamp ASC',
    [sessionId]
  );
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
  return _query(
    'SELECT dorsal,event_type,stands_count,timestamp FROM pit_events WHERE session_id=? ORDER BY timestamp ASC',
    [sessionId]
  );
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
    SELECT s.id, s.slug, s.circuit_name, s.title, s.started_at, s.ended_at, s.is_active,
           COUNT(l.id) as lap_count
    FROM sessions s LEFT JOIN laps l ON l.session_id=s.id
    GROUP BY s.id ORDER BY s.id DESC LIMIT 200
  `);
  return _rows(r);
}

function getCircuitSessions(slug, limit = 50) {
  return _query(
    `SELECT s.id, s.slug, s.circuit_name, s.title, s.started_at, s.ended_at, s.is_active,
            COUNT(l.id) as lap_count
     FROM sessions s LEFT JOIN laps l ON l.session_id=s.id
     WHERE s.slug=?
     GROUP BY s.id ORDER BY s.id DESC LIMIT ?`,
    [slug, limit]
  );
}

function deletePilotFromCircuit(slug, name) {
  const stmt = db.prepare(
    'DELETE FROM laps WHERE name=? AND session_id IN (SELECT id FROM sessions WHERE slug=?)'
  );
  stmt.run([name || '', slug]);
  stmt.free();
  _save();
}

function mergePilotsInCircuit(slug, names, target) {
  const others = (names || []).filter(n => n !== target);
  if (!others.length) return;
  const stmt = db.prepare(
    'UPDATE laps SET name=? WHERE name=? AND session_id IN (SELECT id FROM sessions WHERE slug=?)'
  );
  for (const name of others) { stmt.run([target, name, slug]); }
  stmt.free();
  _save();
}

function searchPilotsGlobal(query) {
  return _query(`
    SELECT s.slug, s.circuit_name, l.name,
           MIN(l.lap_time_ms) as best_ms,
           CAST(AVG(l.lap_time_ms) AS INTEGER) as avg_ms,
           COUNT(*) as total_laps,
           COUNT(DISTINCT l.session_id) as session_count
    FROM laps l JOIN sessions s ON s.id=l.session_id
    WHERE l.lap_time_ms BETWEEN 20000 AND 300000
      AND UPPER(l.name) LIKE UPPER(?)
    GROUP BY s.slug, l.name
    ORDER BY s.slug, best_ms ASC
  `, [`%${query}%`]);
}

function getTotalLapsByCircuit(slug) {
  const rows = _query(
    'SELECT COUNT(*) as n FROM laps l JOIN sessions s ON s.id=l.session_id WHERE s.slug=?',
    [slug]
  );
  return rows.length ? (rows[0].n || 0) : 0;
}

function getPilotSessionsByCircuit(slug) {
  return _query(`
    SELECT l.name, l.session_id, s.started_at,
           MIN(l.lap_time_ms) as best_ms,
           CAST(AVG(l.lap_time_ms) AS INTEGER) as avg_ms,
           COUNT(*) as laps
    FROM laps l JOIN sessions s ON s.id=l.session_id
    WHERE s.slug=? AND l.lap_time_ms BETWEEN 20000 AND 300000
    GROUP BY l.name, l.session_id
    ORDER BY s.started_at DESC
  `, [slug]);
}

function getBestLapsByCircuit(slug) {
  return _query(`
    SELECT l.dorsal, l.name, MIN(l.lap_time_ms) as best_ms, COUNT(*) as total_laps,
           s.circuit_name, s.started_at
    FROM laps l JOIN sessions s ON s.id=l.session_id
    WHERE s.slug=? AND l.lap_time_ms BETWEEN 20000 AND 300000
    GROUP BY l.dorsal, l.name ORDER BY best_ms ASC LIMIT 100
  `, [slug]);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function _rows(result) {
  if (!result.length) return [];
  const cols = result[0].columns;
  return result[0].values.map(row =>
    Object.fromEntries(cols.map((c, i) => [c, row[i]]))
  );
}

function _query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

module.exports = {
  init,
  createSession, endSession, cleanupEmptySessions, deleteSession,
  insertLap, getLapsBySession,
  insertPitEvent, getPitEventsBySession,
  saveSnapshot,
  getAllSessions, getCircuitSessions, getBestLapsByCircuit, getPilotSessionsByCircuit, deletePilotFromCircuit, mergePilotsInCircuit, getTotalLapsByCircuit, searchPilotsGlobal,
};
