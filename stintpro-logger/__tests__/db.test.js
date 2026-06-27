// Tests para db.js — capa SQLite (sql.js)
const db = require('../db');

beforeAll(async () => {
  await db.init();
});

afterEach(() => {
  // Limpiar sesiones de test entre cada test
  db.cleanupEmptySessions();
});

// ── createSession / endSession ────────────────────────────────────────────────

describe('createSession', () => {
  test('devuelve un ID numérico positivo', () => {
    const id = db.createSession('test-circuit', 'Circuito Test');
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  test('IDs son únicos y crecientes', () => {
    const id1 = db.createSession('test-circuit', 'Test');
    const id2 = db.createSession('test-circuit', 'Test');
    expect(id2).toBeGreaterThan(id1);
  });
});

describe('endSession', () => {
  test('marca la sesión como inactiva', () => {
    const id = db.createSession('test-circuit', 'Test');
    db.insertLap(id, '7', 'Javier', null, 64000, 1, Date.now());
    db.endSession(id);

    const sessions = db.getAllSessions();
    const s = sessions.find(s => s.id === id);
    expect(s.is_active).toBe(0);
    expect(s.ended_at).not.toBeNull();
  });
});

// ── insertLap / getLapsBySession ──────────────────────────────────────────────

describe('insertLap / getLapsBySession', () => {
  test('inserta y recupera vueltas correctamente', () => {
    const id = db.createSession('test-circuit', 'Test');
    db.insertLap(id, '7',  'Javier', 64500, 1, 1000);
    db.insertLap(id, '7',  'Javier', 63200, 2, 2000);
    db.insertLap(id, '12', 'Carlos', null, 65000, 1, 1500);

    const laps = db.getLapsBySession(id);
    expect(laps).toHaveLength(3);
    expect(laps.map(l => l.dorsal)).toEqual(expect.arrayContaining(['7', '7', '12']));
  });

  test('laps ordenados por timestamp ASC', () => {
    const id = db.createSession('test-circuit', 'Test');
    db.insertLap(id, '7', 'Javier', null, 64000, 2, 2000);
    db.insertLap(id, '7', 'Javier', null, 65000, 1, 1000);

    const laps = db.getLapsBySession(id);
    expect(laps[0].timestamp).toBeLessThan(laps[1].timestamp);
  });

  test('devuelve array vacío si la sesión no tiene vueltas', () => {
    const id = db.createSession('test-circuit', 'Test');
    expect(db.getLapsBySession(id)).toEqual([]);
  });
});

// ── insertPitEvent / getPitEventsBySession ────────────────────────────────────

describe('pit events', () => {
  test('inserta y recupera eventos de pit', () => {
    const id = db.createSession('test-circuit', 'Test');
    db.insertLap(id, '7', 'Javier', null, 64000, 1, 1000);
    db.insertPitEvent(id, '7', 'in',  0, 5000);
    db.insertPitEvent(id, '7', 'out', 1, 8000);

    const pits = db.getPitEventsBySession(id);
    expect(pits).toHaveLength(2);
    expect(pits[0].event_type).toBe('in');
    expect(pits[1].event_type).toBe('out');
    expect(pits[1].stands_count).toBe(1);
  });
});

// ── getAllSessions ────────────────────────────────────────────────────────────

describe('getAllSessions', () => {
  test('incluye lap_count por sesión', () => {
    const id = db.createSession('test-circuit', 'Test con vueltas');
    db.insertLap(id, '7', 'Javier', null, 64000, 1, Date.now());
    db.insertLap(id, '7', 'Javier', null, 65000, 2, Date.now());

    const sessions = db.getAllSessions();
    const s = sessions.find(s => s.id === id);
    expect(s.lap_count).toBe(2);
  });

  test('devuelve las más recientes primero', () => {
    const id1 = db.createSession('test-circuit', 'Antigua');
    db.insertLap(id1, '7', 'Test', null, 64000, 1, Date.now());
    const id2 = db.createSession('test-circuit', 'Nueva');
    db.insertLap(id2, '7', 'Test', null, 64000, 1, Date.now());

    const sessions = db.getAllSessions();
    const ids = sessions.map(s => s.id);
    expect(ids.indexOf(id2)).toBeLessThan(ids.indexOf(id1));
  });
});

// ── getCircuitSessions ────────────────────────────────────────────────────────

describe('getCircuitSessions', () => {
  test('filtra por slug correctamente', () => {
    const id1 = db.createSession('campillos', 'Campillos');
    db.insertLap(id1, '7', 'Test', null, 64000, 1, Date.now());
    const id2 = db.createSession('cabanillas', 'Cabanillas');
    db.insertLap(id2, '5', 'Test', null, 70000, 1, Date.now());

    const campillos = db.getCircuitSessions('campillos');
    expect(campillos.every(s => s.slug === 'campillos')).toBe(true);
  });
});

// ── cleanupEmptySessions ──────────────────────────────────────────────────────

describe('cleanupEmptySessions', () => {
  test('elimina sesiones sin vueltas finalizadas', () => {
    const id = db.createSession('test-circuit', 'Vacía');
    db.endSession(id);

    db.cleanupEmptySessions();

    const sessions = db.getAllSessions();
    expect(sessions.find(s => s.id === id)).toBeUndefined();
  });

  test('no elimina sesiones con vueltas', () => {
    const id = db.createSession('test-circuit', 'Con vueltas');
    db.insertLap(id, '7', 'Javier', null, 64000, 1, Date.now());
    db.endSession(id);

    db.cleanupEmptySessions();

    const sessions = db.getAllSessions();
    expect(sessions.find(s => s.id === id)).toBeDefined();
  });
});

// ── getBestLapsByCircuit ──────────────────────────────────────────────────────

describe('getBestLapsByCircuit', () => {
  test('devuelve el mejor tiempo por piloto', () => {
    const id = db.createSession('best-test', 'Best Test');
    db.insertLap(id, '7', 'Javier', null, 64000, 1, Date.now());
    db.insertLap(id, '7', 'Javier', null, 62000, 2, Date.now()); // mejor
    db.insertLap(id, '7', 'Javier', null, 65000, 3, Date.now());

    const bests = db.getBestLapsByCircuit('best-test');
    expect(bests).toHaveLength(1);
    expect(bests[0].best_ms).toBe(62000);
  });

  test('filtra tiempos fuera de rango (20s–300s)', () => {
    const id = db.createSession('range-test', 'Range Test');
    db.insertLap(id, '7', 'Javier', null, 5000,   1, Date.now()); // < 20s → ignorado
    db.insertLap(id, '7', 'Javier', null, 400000, 2, Date.now()); // > 300s → ignorado
    db.insertLap(id, '7', 'Javier', null, 64000,  3, Date.now()); // válido

    const bests = db.getBestLapsByCircuit('range-test');
    expect(bests[0].best_ms).toBe(64000);
  });
});

// ── deleteSession ─────────────────────────────────────────────────────────────

describe('deleteSession', () => {
  test('elimina sesión y sus vueltas en cascada', () => {
    const id = db.createSession('test-circuit', 'A borrar');
    db.insertLap(id, '7', 'Javier', null, 64000, 1, Date.now());
    db.deleteSession(id);

    expect(db.getAllSessions().find(s => s.id === id)).toBeUndefined();
    expect(db.getLapsBySession(id)).toEqual([]);
  });
});
