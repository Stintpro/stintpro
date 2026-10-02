// Tests para gap-fill.js — relleno de huecos (reinicio del logger o corte con
// Apex) con el historial de request.php de la sesión en curso.
// Fixture: respuesta REAL de .L/.P de un kart de la carrera por equipos de rkc
// (2026-10-02), sin la línea .INF (nombres de pilotos).

const fs = require('fs');
const path = require('path');
const G = require('../gap-fill');

const TEXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'request-php-rkc-equipe.txt'), 'utf8');
const ID = '163138';
const T0 = 1_800_000_000_000; // instante absoluto del paso por meta de la vuelta 1

// Paso por meta absoluto de la vuelta n = T0 + suma de las vueltas 2..n
function crossings(laps) {
  const t = new Map(); let acc = T0;
  for (const n of [...laps.keys()].sort((a, b) => a - b)) { acc += laps.get(n).ms; t.set(n, acc); }
  return t;
}
// Vueltas "grabadas" en BD: las de los números indicados, con su paso real
function dbLaps(laps, nums) {
  const t = crossings(laps);
  return nums.map(n => ({ lap_time_ms: laps.get(n).ms, timestamp: t.get(n) }));
}
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('parseLaps / parsePits (formato real de request.php)', () => {
  test('vueltas por número oficial de Apex, sin la vuelta 1 vacía ni las marcas g', () => {
    const laps = G.parseLaps(TEXT, ID);
    expect(laps.size).toBe(37);              // vueltas 2..38
    expect(laps.has(1)).toBe(false);
    expect(laps.get(38).ms).toBe(74053);     // "g25972|22616|25465|74053"
    expect(laps.get(2).ms).toBe(79134);      // "g31487|g22583|g25064|g79134"
  });

  test('paradas con vuelta, entrada, salida y duración (relativas al inicio)', () => {
    const pits = G.parsePits(TEXT, ID);
    expect(pits).toHaveLength(4);
    expect(pits[0]).toMatchObject({ n: 1, lap: 8, inMs: 616690, outMs: 705543, durMs: 88853 });
  });

  test('respuesta vacía o "error" → nada', () => {
    expect(G.parseLaps('error', ID).size).toBe(0);
    expect(G.parsePits('', ID)).toEqual([]);
  });
});

describe('planLaps — vueltas que faltan dentro del hueco', () => {
  const laps = G.parseLaps(TEXT, ID);
  const pits = G.parsePits(TEXT, ID);
  const t = crossings(laps);
  const win = { from: t.get(20), to: t.get(30) };

  test('rellena las vueltas del hueco con su paso por meta exacto', () => {
    const db = dbLaps(laps, [...range(2, 20), ...range(30, 38)]);
    const plan = G.planLaps({ apexLaps: laps, apexPits: pits, dbLaps: db, window: win });
    expect(plan.map(p => p.lapNumber)).toEqual(range(21, 29));
    expect(plan[0]).toMatchObject({ lapNumber: 21, ms: laps.get(21).ms, timestamp: t.get(21) });
  });

  test('marca como vuelta de parada la que sigue a la vuelta de entrada a boxes', () => {
    const db = dbLaps(laps, [...range(2, 20), ...range(30, 38)]);
    const plan = G.planLaps({ apexLaps: laps, apexPits: pits, dbLaps: db, window: win });
    expect(plan.find(p => p.lapNumber === 28).isPitLap).toBe(true);   // parada 4 en la vuelta 27
    expect(plan.find(p => p.lapNumber === 27).isPitLap).toBe(false);
  });

  test('sin hueco (todo grabado) → nada que rellenar', () => {
    const db = dbLaps(laps, range(2, 38));
    expect(G.planLaps({ apexLaps: laps, apexPits: pits, dbLaps: db, window: win })).toEqual([]);
  });

  test('si la suma de tiempos no cuadra con nuestros timestamps, no se inserta nada', () => {
    const db = dbLaps(laps, [...range(2, 20), ...range(30, 38)]);
    db.slice(19).forEach(l => { l.timestamp += 60000; }); // las de después del hueco, 1 min corridas
    expect(G.planLaps({ apexLaps: laps, apexPits: pits, dbLaps: db, window: win })).toEqual([]);
  });

  test('un hueco fuera de la ventana del corte no se toca (pueden ser vueltas descartadas a propósito)', () => {
    const db = dbLaps(laps, [...range(2, 20), ...range(30, 38)]);
    const lejos = { from: t.get(33), to: t.get(36) };
    expect(G.planLaps({ apexLaps: laps, apexPits: pits, dbLaps: db, window: lejos })).toEqual([]);
  });

  test('kart que aún no ha cruzado tras reconectar: solo las vueltas anteriores a la reconexión', () => {
    const db = dbLaps(laps, range(2, 20));            // nada después del hueco
    const w = { from: t.get(20), to: t.get(25) + 1000 }; // reconectó justo después de la 25
    const plan = G.planLaps({ apexLaps: laps, apexPits: pits, dbLaps: db, window: w });
    expect(plan.map(p => p.lapNumber)).toEqual(range(21, 25));
  });

  test('vueltas fuera de 20–300 s no se insertan (mismo filtro que el parser) pero cuentan para el reloj', () => {
    const l2 = new Map(laps); l2.set(22, { ...laps.get(22), ms: 310000 });
    const db = dbLaps(l2, [...range(2, 20), ...range(30, 38)]);
    const tt = crossings(l2);
    const plan = G.planLaps({ apexLaps: l2, apexPits: pits, dbLaps: db, window: { from: tt.get(20), to: tt.get(30) } });
    expect(plan.map(p => p.lapNumber)).toEqual([21, ...range(23, 29)]);
    expect(plan.find(p => p.lapNumber === 23).timestamp).toBe(tt.get(23));
  });
});

describe('sessionOffset / planPits — paradas del hueco', () => {
  const pits = G.parsePits(TEXT, ID);
  const O = T0 - 50_000; // inicio de sesión absoluto (desconocido para el logger)
  const abs = (p, k) => O + p[k];

  test('estima el inicio de sesión con paradas ya grabadas (al menos 2 coincidencias)', () => {
    const dbPits = [
      { dorsal: '10', event_type: 'in', timestamp: abs(pits[0], 'inMs') + 400 },
      { dorsal: '10', event_type: 'in', timestamp: abs(pits[1], 'inMs') - 300 },
    ];
    const off = G.sessionOffset({ '10': pits }, dbPits);
    expect(Math.abs(off - O)).toBeLessThan(1000);
  });

  test('con una sola parada grabada no hay evidencia suficiente → null', () => {
    const dbPits = [{ dorsal: '10', event_type: 'in', timestamp: abs(pits[0], 'inMs') }];
    expect(G.sessionOffset({ '10': pits }, dbPits)).toBeNull();
  });

  test('inserta entrada y salida de las paradas del hueco, con su duración oficial', () => {
    const dbPits = [
      { dorsal: '10', event_type: 'in', timestamp: abs(pits[0], 'inMs') },
      { dorsal: '10', event_type: 'out', timestamp: abs(pits[0], 'outMs') },
      { dorsal: '10', event_type: 'in', timestamp: abs(pits[1], 'inMs') },
      { dorsal: '10', event_type: 'out', timestamp: abs(pits[1], 'outMs') },
    ];
    const win = { from: abs(pits[1], 'outMs') + 1000, to: abs(pits[3], 'outMs') + 1000 };
    const plan = G.planPits({ apexPits: pits, dbPits, offset: O, window: win });
    expect(plan).toEqual([
      { eventType: 'in', standsCount: 3, timestamp: abs(pits[2], 'inMs'), durationMs: null },
      { eventType: 'out', standsCount: 3, timestamp: abs(pits[2], 'outMs'), durationMs: 91214 },
      { eventType: 'in', standsCount: 4, timestamp: abs(pits[3], 'inMs'), durationMs: null },
      { eventType: 'out', standsCount: 4, timestamp: abs(pits[3], 'outMs'), durationMs: 113034 },
    ]);
  });

  test('una parada ya grabada (±30 s) no se duplica', () => {
    const dbPits = [{ dorsal: '10', event_type: 'in', timestamp: abs(pits[3], 'inMs') + 5000 }];
    const win = { from: abs(pits[3], 'inMs') - 1000, to: abs(pits[3], 'outMs') + 1000 };
    const plan = G.planPits({ apexPits: pits, dbPits, offset: O, window: win });
    expect(plan.map(p => p.eventType)).toEqual(['out']);
  });
});

describe('historyRequest — petición encadenada a request.php', () => {
  // Formato verificado contra Apex (Campillos 2026-10-02): UNA sola "D" inicial
  // y luego pares (cantidad, elemento). Repetir la "D" por kart devuelve vacío.
  test('una D inicial y pares -999/elemento para vueltas y paradas de cada kart', () => {
    expect(G.historyRequest(['70', '71'])).toBe('D%23-999%23D70.L%23-999%23D70.P%23-999%23D71.L%23-999%23D71.P');
  });
});
