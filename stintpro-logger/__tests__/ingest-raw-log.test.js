// Tests para ingest-raw-log.js — ingesta retroactiva de raw logs .ndjson a la BD.
//
// El raw log se escribe siempre (independiente de `recording`), así que una sesión
// que no llegó a la BD se puede reconstruir desde su .ndjson. Lo que estos tests
// protegen es que la reconstrucción sea *fiel* y *repetible*:
//   · fiel      → las vueltas llevan la hora a la que ocurrieron, no la de ingesta
//   · repetible → reejecutar no duplica, y no pisa lo que ya se grabó en vivo
const fs   = require('fs');
const os   = require('os');
const path = require('path');

// La BD de test vive en un temporal — hay que fijarlo ANTES de require('../db').
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stintpro-ingest-'));
process.env.STINTPRO_DB_PATH = path.join(TMP_DIR, 'test.db');

const db = require('../db');
const { ingestRawLog, parseArgs, regenerateSnapshot, hasMergedGrid } = require('../ingest-raw-log');

const FIXTURE = path.join(__dirname, 'fixtures', 'recordings', 'ariza-q1.ndjson');

// Ventana temporal real del fixture, leída del propio fichero.
function fixtureWindow(file = FIXTURE) {
  const ts = fs.readFileSync(file, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l).t; } catch { return null; } })
    .filter(Boolean);
  return { first: Math.min(...ts), last: Math.max(...ts) };
}

beforeAll(async () => { await db.init(); });
afterAll(() => { try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {} });

describe('fidelidad temporal', () => {
  test('las vueltas se sellan con la hora del raw log, no con la de la ingesta', () => {
    const { first, last } = fixtureWindow();
    // Precondición del test: la ingesta ocurre FUERA de la ventana del log, así que
    // un Date.now() se delataría solo. Si esto falla, el fixture es de hace un momento.
    expect(Date.now()).toBeGreaterThan(last);

    const res = ingestRawLog(FIXTURE, { write: true });

    const laps = db.getLapsBySession(res.sessionId);
    expect(laps.length).toBeGreaterThan(0);
    for (const lap of laps) {
      expect(lap.timestamp).toBeGreaterThanOrEqual(first);
      expect(lap.timestamp).toBeLessThanOrEqual(last);
    }
  });
});

describe('no duplicar', () => {
  test('reejecutar el mismo fichero no vuelve a insertar la sesión', () => {
    const slug = 'idempotencia-test';

    const primera = ingestRawLog(FIXTURE, { slug, write: true });
    expect(primera.skipped).toBe(false);
    expect(primera.laps).toBeGreaterThan(0);

    const segunda = ingestRawLog(FIXTURE, { slug, write: true });

    expect(segunda.skipped).toBe(true);
    expect(segunda.sessionId).toBeNull();
    // Y en la BD sigue habiendo una sola sesión con esas vueltas.
    const sesiones = db.getAllSessions().filter(s => s.slug === slug);
    expect(sesiones).toHaveLength(1);
  });

  test('no pisa una sesión que ya se grabó en vivo en esa misma franja', () => {
    const slug = 'solape-test';
    const { first, last } = fixtureWindow();

    // El logger en vivo ya grabó esta franja: una sesión con una vuelta dentro.
    const enVivo = db.createSession(slug, 'Circuito Test', 'grabada en vivo');
    db.insertLap(enVivo, '38', 'VICTOR NEVADO', null, 44286, 1,
                 first + Math.floor((last - first) / 2), null);

    const res = ingestRawLog(FIXTURE, { slug, write: true });

    expect(res.skipped).toBe(true);
    expect(res.conflictWith).toBe(enVivo);
    expect(db.getAllSessions().filter(s => s.slug === slug)).toHaveLength(1);
  });

  test('--force permite ingerir a pesar del solape', () => {
    const slug = 'force-test';
    const { first, last } = fixtureWindow();
    const enVivo = db.createSession(slug, 'Circuito Test', 'grabada en vivo');
    db.insertLap(enVivo, '38', 'VICTOR NEVADO', null, 44286, 1,
                 first + Math.floor((last - first) / 2), null);

    const res = ingestRawLog(FIXTURE, { slug, write: true, force: true });

    expect(res.skipped).toBe(false);
    expect(res.sessionId).not.toBeNull();
    expect(db.getAllSessions().filter(s => s.slug === slug)).toHaveLength(2);
  });
});

describe('reconstrucción fiel de la sesión', () => {
  // El fixture es la Q1 real de Ariza del 21-08-2026. Los valores esperados salen
  // de reproducir ese log con el parser: Víctor Nevado, dorsal 38, P2, 44.286.
  test('guarda el snapshot con la clasificación final que consume el informe', () => {
    const res = ingestRawLog(FIXTURE, { slug: 'snapshot-test', write: true });

    const snap = db.getSnapshot(res.sessionId);
    expect(snap).toBeTruthy();

    const nevado = (snap.equipos || []).find(k => k && k.name === 'VICTOR NEVADO');
    expect(nevado).toBeDefined();
    expect(nevado.dorsal).toBe('38');
    expect(nevado.pos).toBe(2);
    expect(nevado.bestLap).toBeCloseTo(44.286, 3);
  });

  test('recupera las vueltas de Víctor Nevado con sus tiempos reales', () => {
    const res = ingestRawLog(FIXTURE, { slug: 'vueltas-test', write: true });

    const suyas = db.getLapsBySession(res.sessionId)
      .filter(l => l.name === 'VICTOR NEVADO')
      .sort((a, b) => a.lap_number - b.lap_number);

    expect(suyas.map(l => l.lap_time_ms)).toEqual([45332, 45105, 44286]);
    expect(suyas.every(l => l.dorsal === '38')).toBe(true);
  });
});

describe('CLI', () => {
  test('sin --write la ingesta es simulada: es el valor por defecto', () => {
    expect(parseArgs(['fichero.ndjson']).write).toBe(false);
    expect(parseArgs(['fichero.ndjson', '--write']).write).toBe(true);
  });

  test('--snapshot selecciona el modo de solo regenerar snapshot', () => {
    expect(parseArgs(['f.ndjson']).onlySnapshot).toBe(false);
    expect(parseArgs(['f.ndjson', '--snapshot']).onlySnapshot).toBe(true);
  });

  test('una simulación no toca la BD', () => {
    const slug = 'dryrun-test';
    const res = ingestRawLog(FIXTURE, { slug, write: false });

    expect(res.laps).toBeGreaterThan(0);   // sí informa de lo que haría
    expect(res.sessionId).toBeNull();      // pero no crea nada
    expect(db.getAllSessions().filter(s => s.slug === slug)).toHaveLength(0);
  });
});

// Un bug del logger en vivo dejó ~1.000 sesiones con el snapshot vacío: el parser
// limpiaba la parrilla antes de avisar, así que se persistía un estado sin karts.
// Para las que conservan su raw log, la clasificación se puede recalcular.
describe('regenerar snapshot de una sesión existente', () => {
  test('rellena el snapshot vacío de una sesión ya grabada, sin crear otra', () => {
    const slug = 'regen-test';
    const { first, last } = fixtureWindow();

    // Sesión ya en BD, con vueltas y el snapshot vacío que dejó el bug.
    const id = db.createSession(slug, 'Circuito Test', 'R1');
    db.insertLap(id, '38', 'VICTOR NEVADO', null, 44286, 1,
                 first + Math.floor((last - first) / 2), null);
    db.saveSnapshot(id, { equipos: [], sessionFinished: false });

    const res = regenerateSnapshot(FIXTURE, { slug, write: true });

    expect(res.sessionId).toBe(id);
    expect(res.skipped).toBe(false);
    expect(db.getAllSessions().filter(s => s.slug === slug)).toHaveLength(1); // no crea sesión
    const snap = db.getSnapshot(id);
    expect((snap.equipos || []).filter(Boolean)).toHaveLength(25);
    expect(snap.equipos.find(k => k && k.name === 'VICTOR NEVADO').pos).toBe(2);
  });

  test('no machaca un snapshot que ya tiene clasificación', () => {
    const slug = 'regen-bueno-test';
    const { first, last } = fixtureWindow();
    const id = db.createSession(slug, 'Circuito Test', 'R1');
    db.insertLap(id, '38', 'VICTOR NEVADO', null, 44286, 1,
                 first + Math.floor((last - first) / 2), null);
    db.saveSnapshot(id, { equipos: [{ dorsal: '99', name: 'YA ESTABA' }] });

    const res = regenerateSnapshot(FIXTURE, { slug, write: true });

    expect(res.skipped).toBe(true);
    expect(db.getSnapshot(id).equipos[0].name).toBe('YA ESTABA');
  });
});

// Algunos raw logs contienen DOS sesiones sin que el parser las separase: su estado
// final mezcla las dos parrillas y la clasificación sale con cada posición repetida
// (P1 dos veces, P2 dos veces...). Medido en los logs de Lucas Guerrero del 15-ago:
// 80 karts, 40 posiciones duplicadas, posición máxima 40. Guardar eso es peor que
// dejar el snapshot vacío, porque el informe se lo creería.
describe('parrilla fusionada', () => {
  test('una clasificación normal no se marca como fusionada', () => {
    expect(hasMergedGrid({ equipos: [{ pos: 1 }, { pos: 2 }, { pos: 3 }] })).toBe(false);
  });

  test('posiciones repetidas delatan dos parrillas mezcladas', () => {
    expect(hasMergedGrid({ equipos: [{ pos: 1 }, { pos: 2 }, { pos: 1 }, { pos: 2 }] })).toBe(true);
  });

  test('los karts sin posición asignada no cuentan como duplicado', () => {
    expect(hasMergedGrid({ equipos: [{ pos: 1 }, { pos: 0 }, { pos: null }, { pos: 2 }] })).toBe(false);
  });
});
