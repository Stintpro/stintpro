'use strict';
// Tests para _enAutoKartQuality y _enEffectiveQuality
// Run: node tests/kart-quality.test.js

const assert = require('assert');
const { _enCleanLaps, _enFmt } = require('../src/analysis');

// Globals que en-state.js usa como si fueran del browser
global._enCleanLaps = _enCleanLaps;
global._enFmt       = _enFmt;

const { _enAutoKartQuality, _enEffectiveQuality, EnSession, EnUi, _enPilotRatings } = require('../src/en-state');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}
function group(name, fn) { console.log(`\n${name}`); fn(); }

// ── Helpers ───────────────────────────────────────────────────────────────────

function reset() {
  EnSession.kartAutoState = {};
  EnUi.kartQuality = {};
  for (const k of Object.keys(_enPilotRatings)) delete _enPilotRatings[k];
}

// Crea un kart con N vueltas limpias en torno a `lapTime` (segundos)
function kart(dorsal, laps, pitState = null, name = 'Piloto') {
  return { dorsal, name, lapHistory: laps, pitState, bestLap: Math.min(...laps) };
}

// Llama a _enAutoKartQuality varias veces para saturar el badCount
function evalN(n, e, trackAvg) {
  let result;
  for (let i = 0; i < n; i++) result = _enAutoKartQuality(e, trackAvg);
  return result;
}

// ── Casos base ────────────────────────────────────────────────────────────────

group('Precondiciones — devuelve null sin datos suficientes', () => {
  test('sin trackAvg → null', () => {
    reset();
    assert.equal(_enAutoKartQuality(kart('1', [65, 65, 65]), null), null);
  });

  test('sin lapHistory → null', () => {
    reset();
    assert.equal(_enAutoKartQuality({ dorsal: '1', name: 'X', lapHistory: null, pitState: null }, 65), null);
  });

  test('menos de 3 vueltas → null', () => {
    reset();
    assert.equal(_enAutoKartQuality(kart('1', [65, 65]), 65), null);
  });

  test('exactamente 3 vueltas → evalúa (no null por falta de datos)', () => {
    reset();
    const result = _enAutoKartQuality(kart('1', [65, 65, 65]), 65);
    assert.ok(result !== null, 'debería evaluar con 3 vueltas');
  });
});

// ── Calidad auto sin score de piloto ─────────────────────────────────────────

group('Calidad auto — sin score histórico (umbral ±1.0s)', () => {
  test('M5v claramente por debajo de la media → good', () => {
    reset();
    // trackAvg 65s, vueltas a 63.5s → delta -1.5s < -1.0s
    const laps = [63.5, 63.5, 63.5, 63.5, 63.5];
    assert.equal(_enAutoKartQuality(kart('1', laps), 65), 'good');
  });

  test('M5v similar a la media → neutral', () => {
    reset();
    const laps = [65, 65, 65, 65, 65];
    assert.equal(_enAutoKartQuality(kart('1', laps), 65), 'neutral');
  });

  test('M5v claramente por encima de la media → bad', () => {
    reset();
    // trackAvg 65s, vueltas a 66.5s → delta +1.5s > +1.0s
    const laps = [66.5, 66.5, 66.5, 66.5, 66.5];
    assert.equal(_enAutoKartQuality(kart('1', laps), 65), 'bad');
  });

  test('dentro del umbral por arriba (+0.8s) → neutral', () => {
    reset();
    const laps = [65.8, 65.8, 65.8, 65.8, 65.8];
    assert.equal(_enAutoKartQuality(kart('1', laps), 65), 'neutral');
  });

  test('dentro del umbral por abajo (-0.8s) → neutral', () => {
    reset();
    const laps = [64.2, 64.2, 64.2, 64.2, 64.2];
    assert.equal(_enAutoKartQuality(kart('1', laps), 65), 'neutral');
  });
});

// ── Umbral ajustado por score de piloto ───────────────────────────────────────

group('Umbral ajustado por score (piloto Elite ≥800 → ±0.3s)', () => {
  test('Elite: delta -0.4s → good', () => {
    reset();
    _enPilotRatings['Elite'] = { score: 850 };
    const laps = [64.6, 64.6, 64.6, 64.6, 64.6];
    assert.equal(_enAutoKartQuality(kart('1', laps, null, 'Elite'), 65), 'good');
  });

  test('Elite: delta -0.2s → neutral (dentro del umbral ±0.3s)', () => {
    reset();
    _enPilotRatings['Elite'] = { score: 850 };
    const laps = [64.8, 64.8, 64.8, 64.8, 64.8];
    assert.equal(_enAutoKartQuality(kart('1', laps, null, 'Elite'), 65), 'neutral');
  });

  test('Avanzado (score 650 → ±0.5s): delta -0.6s → good', () => {
    reset();
    // score ≥600 → fiable → ref=avg5. delta=64.4-65=-0.6 < -0.5 → good
    _enPilotRatings['Avanzado'] = { score: 650 };
    const laps = [64.4, 64.4, 64.4, 64.4, 64.4];
    assert.equal(_enAutoKartQuality(kart('1', laps, null, 'Avanzado'), 65), 'good');
  });

  test('Intermedio (score 500 → ±0.7s): delta -0.8s → good', () => {
    reset();
    // score 500 < 600 → errático → ref=stintBest=64.2. delta=64.2-65=-0.8 < -0.7 → good
    _enPilotRatings['Inter'] = { score: 500 };
    const laps = [64.2, 64.2, 64.2, 64.2, 64.2];
    assert.equal(_enAutoKartQuality(kart('1', laps, null, 'Inter'), 65), 'good');
  });

  test('score como número directo (no objeto) → funciona igual', () => {
    reset();
    _enPilotRatings['Num'] = 850;
    const laps = [64.6, 64.6, 64.6, 64.6, 64.6];
    assert.equal(_enAutoKartQuality(kart('1', laps, null, 'Num'), 65), 'good');
  });
});

// ── Piloto errático (usa mejor vuelta del stint, no M5v) ─────────────────────

group('Piloto errático — rango ≥0.5s → referencia = stintBest', () => {
  test('vueltas erráticas con una rápida clara → good por stintBest', () => {
    reset();
    // Sin score, rango=1.5s > 0.5 → errático → ref=stintBest=63.0
    // delta=63.0-65=-2.0 < -1.0 → good
    // avg5=64.2, stintBest=63.0: 64.2 < 63.0+2.0=65.0 → sin degradación
    const laps = [63.0, 64.5, 64.5, 64.5, 64.5];
    assert.equal(_enAutoKartQuality(kart('1', laps), 65), 'good');
  });

  test('vueltas erráticas sin vuelta rápida → no good', () => {
    reset();
    // Sin score, rango > 0.5s → errático → stintBest 64.5s, delta -0.5s → neutral (umbral 1.0)
    const laps = [64.5, 65.0, 65.5, 65.0, 65.5];
    const result = _enAutoKartQuality(kart('1', laps), 65);
    assert.ok(result !== 'good', `no debería ser good, fue ${result}`);
  });
});

// ── Sticky: kart bueno aguanta 5 evaluaciones malas ──────────────────────────

group('Sticky — kart bueno aguanta badCount < 5', () => {
  test('kart bueno, 1 evaluación mala → sigue good', () => {
    reset();
    const good = [63.5, 63.5, 63.5, 63.5, 63.5];
    const bad  = [66.5, 66.5, 66.5, 66.5, 66.5];
    const e = kart('1', good);
    _enAutoKartQuality(e, 65); // establece good
    e.lapHistory = bad;
    assert.equal(_enAutoKartQuality(e, 65), 'good'); // badCount=1, aguanta
  });

  test('kart bueno, 4 evaluaciones malas → sigue good (badCount=4)', () => {
    reset();
    const good = [63.5, 63.5, 63.5, 63.5, 63.5];
    const bad  = [66.5, 66.5, 66.5, 66.5, 66.5];
    const e = kart('1', good);
    _enAutoKartQuality(e, 65);
    e.lapHistory = bad;
    assert.equal(evalN(4, e, 65), 'good'); // badCount=4, todavía aguanta
  });

  test('kart bueno, 5 evaluaciones malas → cae a bad (badCount=5)', () => {
    reset();
    const good = [63.5, 63.5, 63.5, 63.5, 63.5];
    const bad  = [66.5, 66.5, 66.5, 66.5, 66.5];
    const e = kart('1', good);
    _enAutoKartQuality(e, 65);
    e.lapHistory = bad;
    assert.equal(evalN(5, e, 65), 'bad'); // badCount=5, cae
  });

  test('kart bueno recupera → badCount se resetea a 0', () => {
    reset();
    const good = [63.5, 63.5, 63.5, 63.5, 63.5];
    const bad  = [66.5, 66.5, 66.5, 66.5, 66.5];
    const e = kart('1', good);
    _enAutoKartQuality(e, 65); // good
    e.lapHistory = bad;
    evalN(3, e, 65);           // badCount=3, sigue good
    e.lapHistory = good;
    assert.equal(_enAutoKartQuality(e, 65), 'good'); // badCount reseteado
    e.lapHistory = bad;
    assert.equal(_enAutoKartQuality(e, 65), 'good'); // empieza de nuevo desde badCount=1
  });
});

// ── Degradación mecánica ──────────────────────────────────────────────────────

group('Degradación — avg5 > stintBest + 2.0s → bad', () => {
  test('avg5 2.5s por encima de stintBest → bad por degradación', () => {
    reset();
    // stintBest=63s, últimas 5 vueltas a 65.5s → delta avg5-stintBest = 2.5s > 2.0s
    const laps = [63.0, 65.5, 65.5, 65.5, 65.5, 65.5];
    assert.equal(_enAutoKartQuality(kart('1', laps), 65), 'bad');
  });

  test('avg5 exactamente 2.0s por encima de stintBest → no es degradación (condición estricta >)', () => {
    reset();
    const laps = [63.0, 65.0, 65.0, 65.0, 65.0, 65.0];
    const result = _enAutoKartQuality(kart('1', laps), 65);
    assert.ok(result !== 'bad', `no debería ser bad por degradación, fue ${result}`);
  });
});

// ── Pit states ────────────────────────────────────────────────────────────────

group('Pit IN — devuelve calidad previa mientras está en boxes', () => {
  test('pit in tras ser good → devuelve good', () => {
    reset();
    const e = kart('1', [63.5, 63.5, 63.5, 63.5, 63.5]);
    _enAutoKartQuality(e, 65); // establece good
    e.pitState = 'in';
    assert.equal(_enAutoKartQuality(e, 65), 'good');
  });

  test('pit in sin calidad previa → null', () => {
    reset();
    const e = kart('1', [63.5, 63.5], 'in'); // < 3 vueltas, sin calidad previa
    assert.equal(_enAutoKartQuality(e, 65), null);
  });
});

group('Pit OUT — reset total solo en la transición', () => {
  test('primera vez en out → stintStartIdx apunta al final (vueltas anteriores ignoradas)', () => {
    reset();
    // 5 vueltas lentas (kart viejo), luego pit out
    const e = kart('1', [66.5, 66.5, 66.5, 66.5, 66.5], 'out');
    const result = _enAutoKartQuality(e, 65);
    // < 3 vueltas del nuevo stint → null
    assert.equal(result, null);
  });

  test('out persistente (mismo estado) → no resetea de nuevo', () => {
    reset();
    const e = kart('1', [63.5, 63.5, 63.5, 63.5, 63.5], 'out');
    _enAutoKartQuality(e, 65); // primera llamada: reset + stintStartIdx=5
    // Añadimos 3 vueltas nuevas del kart nuevo
    e.lapHistory = [63.5, 63.5, 63.5, 63.5, 63.5, 63.5, 63.5, 63.5];
    const result = _enAutoKartQuality(e, 65); // no debe resetear stintStartIdx
    assert.ok(result !== null, 'debería evaluar las vueltas nuevas del kart');
  });
});

// ── Override manual ───────────────────────────────────────────────────────────

group('_enEffectiveQuality — override manual prevalece sobre auto', () => {
  test('override good → siempre good aunque kart sea malo', () => {
    reset();
    EnUi.kartQuality['1'] = 'good';
    const e = kart('1', [66.5, 66.5, 66.5, 66.5, 66.5]);
    assert.equal(_enEffectiveQuality('1', e, 65), 'good');
  });

  test('override bad → siempre bad aunque kart sea bueno', () => {
    reset();
    EnUi.kartQuality['1'] = 'bad';
    const e = kart('1', [63.5, 63.5, 63.5, 63.5, 63.5]);
    assert.equal(_enEffectiveQuality('1', e, 65), 'bad');
  });

  test('override neutral → siempre neutral', () => {
    reset();
    EnUi.kartQuality['1'] = 'neutral';
    const e = kart('1', [63.5, 63.5, 63.5, 63.5, 63.5]);
    assert.equal(_enEffectiveQuality('1', e, 65), 'neutral');
  });

  test('override auto → delega a _enAutoKartQuality', () => {
    reset();
    EnUi.kartQuality['1'] = 'auto';
    const e = kart('1', [63.5, 63.5, 63.5, 63.5, 63.5]);
    assert.equal(_enEffectiveQuality('1', e, 65), 'good');
  });

  test('sin override → delega a _enAutoKartQuality', () => {
    reset();
    const e = kart('1', [63.5, 63.5, 63.5, 63.5, 63.5]);
    assert.equal(_enEffectiveQuality('1', e, 65), 'good');
  });
});

// ── Bloqueo avg5 > trackAvg ───────────────────────────────────────────────────

group('Bloqueo — comportamiento del guard avg5 > trackAvg', () => {
  test('errático rápido con avg5 muy > stintBest → degradación pesa más que bloqueo → bad', () => {
    reset();
    // avg5=(63+66.5*4)/5=65.8 > stintBest(63)+2.0=65.0 → degradación → bad
    const laps = [63.0, 66.5, 66.5, 66.5, 66.5];
    assert.equal(_enAutoKartQuality(kart('1', laps), 65), 'bad');
  });

  test('errático rápido con avg5 sin degradación → good aunque avg5 > trackAvg', () => {
    reset();
    // avg5=64.2 < stintBest(63)+2.0=65 → sin degradación → good
    const laps = [63.0, 64.5, 64.5, 64.5, 64.5];
    assert.equal(_enAutoKartQuality(kart('1', laps), 65), 'good');
  });

  test('errático con stintBest moderado → neutral (delta insuficiente para good)', () => {
    reset();
    // stintBest=64.2, delta=64.2-65=-0.8. threshold=1.0. -0.8 > -1.0 → neutral
    const laps = [64.2, 66.0, 66.0, 66.0, 66.0];
    assert.equal(_enAutoKartQuality(kart('1', laps), 65), 'neutral');
  });
});

// ── Resumen ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
