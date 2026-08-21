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
const { ingestRawLog, parseArgs } = require('../ingest-raw-log');

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

  test('una simulación no toca la BD', () => {
    const slug = 'dryrun-test';
    const res = ingestRawLog(FIXTURE, { slug, write: false });

    expect(res.laps).toBeGreaterThan(0);   // sí informa de lo que haría
    expect(res.sessionId).toBeNull();      // pero no crea nada
    expect(db.getAllSessions().filter(s => s.slug === slug)).toHaveLength(0);
  });
});
