#!/usr/bin/env node
'use strict';
// ── StintPro — ingesta retroactiva de raw logs a la BD ──────────────────────
//
// El .ndjson de cada sesión se escribe SIEMPRE, con independencia de `recording`
// (circuit-monitor abre el fichero en la 1ª vuelta real, antes de mirar el flag).
// Por eso una sesión que nunca llegó a la BD —circuito con la grabación apagada—
// sigue estando en disco entera y se puede reconstruir a posteriori.
//
// La sutileza está en el tiempo: apex-protocol sella cada vuelta con `Date.now()`
// en el momento de parsearla, lo cual es correcto en vivo y falso en un replay.
// Aquí se descarta ese valor y se usa el `t` del frame que lo produjo — el parser
// invoca onLap/onPit de forma síncrona dentro de parse(), así que el frame en curso
// es siempre el que corresponde.

const fs       = require('fs');
const path     = require('path');
const Database = require('better-sqlite3');

const db         = require('./db');
const ApexParser = require('./apex-parser');

// ── Conexión auxiliar ───────────────────────────────────────────────────────
// db.js no expone el handle, y hacen falta dos cosas que su API no cubre: sellar
// started_at/ended_at con la hora real del log (createSession clava Date.now()) y
// consultar solapamientos para no duplicar. Se abre una conexión aparte al mismo
// fichero en vez de tocar db.js, que está desplegado en el VPS. Con WAL conviven
// sin problema; el busy_timeout cubre el caso de que el logger esté escribiendo.
let _aux = null;
function aux() {
  if (_aux) return _aux;
  const dbPath = process.env.STINTPRO_DB_PATH || path.join(__dirname, 'data', 'stintpro.db');
  _aux = new Database(dbPath);
  _aux.pragma('busy_timeout = 5000');
  return _aux;
}

function setSessionTimes(sessionId, startedAt, endedAt) {
  aux().prepare('UPDATE sessions SET started_at=?, ended_at=?, is_active=0 WHERE id=?')
       .run(startedAt, endedAt, sessionId);
}

// ── Deduplicación ───────────────────────────────────────────────────────────
// La clave sale de los propios datos, sin tabla de control ni marcas en disco:
//   1. started_at exacto → este mismo fichero ya se ingirió (el sello es el `t`
//      del primer frame, así que es reproducible bit a bit).
//   2. vueltas dentro de la ventana → alguien ya grabó esa franja, típicamente el
//      logger en vivo. Es la guarda que impide pisar una sesión buena.
// La sesión de ese circuito con más vueltas dentro de la ventana del log.
function findSessionInWindow(slug, startedAt, endedAt) {
  return aux().prepare(`
    SELECT se.id AS id, COUNT(l.id) AS c
      FROM laps l JOIN sessions se ON se.id = l.session_id
     WHERE se.slug = ? AND l.timestamp BETWEEN ? AND ?
     GROUP BY se.id ORDER BY c DESC LIMIT 1
  `).get(slug, startedAt, endedAt) || null;
}

function findConflict(slug, startedAt, endedAt) {
  const exact = aux()
    .prepare('SELECT id FROM sessions WHERE slug=? AND started_at=?')
    .get(slug, startedAt);
  if (exact) return { sessionId: exact.id, reason: `ya ingerido como sesión #${exact.id}` };

  const overlap = findSessionInWindow(slug, startedAt, endedAt);
  if (overlap) {
    return {
      sessionId: overlap.id,
      reason: `solapa con la sesión #${overlap.id}, que ya tiene ${overlap.c} vueltas en esa franja`,
    };
  }
  return null;
}

// ── Lectura del raw log ─────────────────────────────────────────────────────

function readFrames(file) {
  const frames = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; } // línea truncada: ignorar
    if (entry && entry.raw) frames.push(entry);
  }
  return frames;
}

// El nombre del fichero es `<slug>_<titulo>_<ISO>.ndjson`; el slug es lo anterior
// al primer guion bajo.
function slugFromFilename(file) {
  return path.basename(file).split('_')[0];
}

// ── Replay ──────────────────────────────────────────────────────────────────

// Reproduce el log entero y devuelve lo que salió: vueltas y pits ya con su hora
// real, el título y el parser (cuyo estado final ES la clasificación de la sesión).
function replayLog(file) {
  const frames = readFrames(file);
  if (!frames.length) return null;

  const laps = [];
  const pits = [];
  let title  = null;
  let frameTs = frames[0].t;

  const parser = new ApexParser({
    // El `timestamp` que llega en el argumento es el Date.now() del replay: se ignora
    // a propósito y se sustituye por el del frame en curso.
    onLap: (dorsal, name, teamName, lapMs, lapNumber, _ts, category) => {
      if (title === null) {
        const st = parser.getState();
        title = [st.title1, st.title2].filter(Boolean).join(' · ') || null;
      }
      laps.push({ dorsal, name, teamName, lapMs, lapNumber, ts: frameTs, category });
    },
    onPit: (dorsal, eventType, standsCount) => {
      pits.push({ dorsal, eventType, standsCount, ts: frameTs });
    },
  });

  for (const frame of frames) {
    frameTs = frame.t;
    parser.parse(frame.raw);
  }

  return {
    parser, laps, pits, title,
    startedAt: laps.length ? laps[0].ts : frames[0].t,
    endedAt:   frames[frames.length - 1].t,
  };
}

// Snapshot con la misma forma que escribe circuit-monitor en vivo: estado final del
// parser + los pit events. Es lo que sirve /api/snapshot/:id al informe de carrera.
// Quedan fuera raceStart/raceEvents/raceStopped, que viven en trackers del monitor
// y no en el parser — el informe usa la clasificación, no esos campos.
function buildSnapshot(replay) {
  return {
    ...replay.parser.getState(),
    pitEvents: replay.pits.map(p => ({ dorsal: p.dorsal, event: p.eventType, time: p.ts, standsCount: p.standsCount })),
  };
}

// ── Ingesta ─────────────────────────────────────────────────────────────────

function ingestRawLog(file, opts = {}) {
  const slug        = opts.slug || slugFromFilename(file);
  const circuitName = opts.circuitName || slug;
  const write       = opts.write === true;

  const replay = replayLog(file);
  if (!replay) {
    return { file, slug, laps: 0, pits: 0, sessionId: null, skipped: true, reason: 'fichero vacío' };
  }
  const { laps, pits, title } = replay;

  const { startedAt, endedAt } = replay;

  const summary = {
    file: path.basename(file),
    slug, title,
    laps: laps.length,
    pits: pits.length,
    karts: new Set(laps.map(l => l.dorsal)).size,
    startedAt, endedAt,
    sessionId: null,
    skipped: false,
    reason: null,
  };

  if (!laps.length) {
    summary.skipped = true;
    summary.reason  = 'sin vueltas';
    return summary;
  }

  // Se evalúa también en dry-run: el informe previo debe decir ya qué se saltaría.
  const conflict = findConflict(slug, startedAt, endedAt);
  if (conflict && opts.force !== true) {
    summary.skipped   = true;
    summary.reason    = conflict.reason;
    summary.conflictWith = conflict.sessionId;
    return summary;
  }

  if (!write) return summary;

  const sessionId = db.createSession(slug, circuitName, title);
  setSessionTimes(sessionId, startedAt, endedAt);
  for (const l of laps) {
    db.insertLap(sessionId, l.dorsal, l.name, l.teamName, l.lapMs, l.lapNumber, l.ts, l.category);
  }
  for (const p of pits) {
    db.insertPitEvent(sessionId, p.dorsal, p.eventType, p.standsCount, p.ts);
  }

  db.saveSnapshot(sessionId, buildSnapshot(replay));

  summary.sessionId = sessionId;
  return summary;
}

// Dos parrillas mezcladas en un mismo estado: pasa cuando un raw log contiene dos
// sesiones que el parser no llegó a separar. Se delata porque la clasificación
// repite posiciones — en una carrera real cada posición es única.
function hasMergedGrid(snapshot) {
  const pos = (snapshot.equipos || []).filter(Boolean).map(k => k.pos).filter(p => p > 0);
  return pos.length !== new Set(pos).size;
}

// ── Regeneración de snapshot ────────────────────────────────────────────────
// Para sesiones YA grabadas cuyo snapshot quedó vacío: el parser limpiaba la
// parrilla antes de disparar onNewSession, así que circuit-monitor persistía un
// estado sin karts y el informe de carrera perdía la clasificación oficial.
// Aquí no se crea ni se toca ninguna sesión: solo se recalcula su snapshot.
function regenerateSnapshot(file, opts = {}) {
  const slug  = opts.slug || slugFromFilename(file);
  const write = opts.write === true;

  const base = { file: path.basename(file), slug, sessionId: null, karts: 0, skipped: true, reason: null };

  const replay = replayLog(file);
  if (!replay) return { ...base, reason: 'fichero vacío' };

  const target = findSessionInWindow(slug, replay.startedAt, replay.endedAt);
  if (!target) return { ...base, reason: 'sin sesión en BD para esa franja' };

  const snap  = buildSnapshot(replay);
  const karts = (snap.equipos || []).filter(Boolean).length;
  const out   = { ...base, sessionId: target.id, karts, title: replay.title };
  if (!karts) return { ...out, reason: 'el replay no produce clasificación' };
  if (hasMergedGrid(snap)) {
    return { ...out, reason: `parrilla fusionada (${karts} karts con posiciones repetidas): el log trae más de una sesión` };
  }

  // Nunca degradar: si ya hay clasificación guardada, no se toca.
  const actual = db.getSnapshot(target.id);
  const yaTiene = actual && Array.isArray(actual.equipos) ? actual.equipos.filter(Boolean).length : 0;
  if (yaTiene > 0 && opts.force !== true) {
    return { ...out, reason: `la sesión #${target.id} ya tiene clasificación (${yaTiene} karts)` };
  }

  if (!write) return { ...out, skipped: false, reason: 'simulación' };

  db.saveSnapshot(target.id, snap);
  return { ...out, skipped: false };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

// `write` arranca en false a propósito: escribir en la BD de producción tiene que
// costar un flag explícito, y lo normal es mirar el informe antes.
function parseArgs(argv) {
  const opts = { files: [], write: false, force: false, onlySnapshot: false, slug: null, circuitName: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write')         opts.write = true;
    else if (a === '--force')    opts.force = true;
    else if (a === '--snapshot') opts.onlySnapshot = true;
    else if (a === '--slug')  opts.slug = argv[++i];
    else if (a === '--name')  opts.circuitName = argv[++i];
    else if (!a.startsWith('--')) opts.files.push(a);
  }
  return opts;
}

function formatSummary(s) {
  const hora = t => new Date(t).toISOString().slice(11, 16);
  const cab  = `${s.file}\n  ${s.title || '(sin título)'} · ${s.slug}`;
  if (s.skipped) return `${cab}\n  ↷ SALTADO: ${s.reason}`;
  if (s.startedAt === undefined) {   // modo --snapshot
    return `${cab}\n  snapshot de la sesión #${s.sessionId} regenerado con ${s.karts} karts`;
  }
  const destino = s.sessionId ? `sesión #${s.sessionId}` : 'simulación (usa --write)';
  return `${cab}\n  ${s.laps} vueltas · ${s.karts} karts · ${s.pits} pit events` +
         `\n  ${hora(s.startedAt)}–${hora(s.endedAt)} UTC → ${destino}`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.files.length) {
    console.log([
      'Uso: node ingest-raw-log.js <fichero.ndjson> [...] [opciones]',
      '',
      '  --write     escribe en la BD (por defecto solo simula)',
      '  --force     ingiere aunque solape / pisa un snapshot que ya tiene clasificación',
      '  --snapshot  NO crea sesión: solo regenera el snapshot de la sesión ya existente',
      '  --slug X  fuerza el slug del circuito (por defecto, del nombre del fichero)',
      '  --name X  nombre legible del circuito',
    ].join('\n'));
    process.exit(1);
  }

  await db.init();
  if (!opts.write) console.log('— SIMULACIÓN — no se escribe nada. Añade --write para ejecutar.\n');

  let escritas = 0, saltadas = 0, vueltas = 0;
  for (const file of opts.files) {
    const s = opts.onlySnapshot ? regenerateSnapshot(file, opts) : ingestRawLog(file, opts);
    console.log(formatSummary(s));
    console.log('');
    if (s.skipped) saltadas++;
    else if (s.sessionId) { escritas++; vueltas += (s.laps || 0); }
  }
  console.log(opts.onlySnapshot
    ? `Total: ${escritas} snapshots regenerados, ${saltadas} saltados.`
    : `Total: ${escritas} sesiones escritas (${vueltas} vueltas), ${saltadas} saltadas.`);
}

if (require.main === module) {
  main().catch(err => { console.error('Error:', err.message); process.exit(1); });
}

module.exports = { ingestRawLog, regenerateSnapshot, hasMergedGrid, readFrames, slugFromFilename, parseArgs, formatSummary };
