'use strict';
// Tests para _enAutoKartQuality y _enEffectiveQuality
// Run: node tests/kart-quality.test.js

const assert = require('assert');
const { _enCleanLaps, _enFmt } = require('../src/analysis');

// Globals que en-state.js usa como si fueran del browser
global._enCleanLaps = _enCleanLaps;
global._enFmt       = _enFmt;

const { _enAutoKartQuality, _enEffectiveQuality, _enQualityTooltip, EnSession, EnUi, _enPilotRatings, _enCanonName, _enRatingsMap, _enRatingOf } = require('../src/en-state');

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

// ── El score del piloto NO interviene en la calidad del kart ─────────────────
// Prueba neutral (10 carreras, mismo piloto con karts distintos): estrechar el
// umbral por score amplificaba el ritmo del piloto (42 % de acierto en malos,
// azar 33 %). El score se queda para el ranking de pilotos.

group('El score del piloto no cambia la calidad del kart', () => {
  test('Elite (850) con −0,4 s → neutral, igual que sin score', () => {
    reset();
    _enPilotRatings['ELITE'] = { score: 850 };
    const laps = [64.6, 64.6, 64.6, 64.6, 64.6];
    const conScore = _enAutoKartQuality(kart('1', laps, null, 'Elite'), 65);
    reset();
    assert.equal(conScore, _enAutoKartQuality(kart('1', laps, null, 'Elite'), 65));
    assert.equal(conScore, 'neutral');
  });

  test('Novato (150) con −1,5 s → good, igual que sin score', () => {
    reset();
    _enPilotRatings['NOVATO'] = { score: 150 };
    assert.equal(_enAutoKartQuality(kart('1', [63.5, 63.5, 63.5, 63.5, 63.5], null, 'Novato'), 65), 'good');
  });
});

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

// ── B1: la histéresis cuenta VUELTAS nuevas, no llamadas/renders ─────────────
// Añade una vuelta nueva al historial y evalúa (simula el paso real del tiempo)
function appendLap(e, lapTime, trackAvg) {
  e.lapHistory = [...e.lapHistory, lapTime];
  return _enAutoKartQuality(e, trackAvg);
}

group('B1 — gate de vuelta nueva (histéresis por vueltas, no por render)', () => {
  const G = 63.8, B = 66.2;   // sin score: umbral ±1,0; las malas degradan (> mejor + 2 s)
  test('llamar 20 veces sin vueltas nuevas NO degrada el kart bueno', () => {
    reset();
    const e = kart('1', [G, G, G, G, G]);
    assert.equal(_enAutoKartQuality(e, 65), 'good');
    // La ventana pasa a peor pero SIN vueltas nuevas (misma longitud)
    e.lapHistory = [G, G, G, G, B];
    let result;
    for (let i = 0; i < 20; i++) result = _enAutoKartQuality(e, 65);
    assert.equal(result, 'good'); // gate: mismo length → badCount NO avanza
  });

  test('kart bueno cae a bad tras 5 vueltas malas NUEVAS', () => {
    reset();
    const e = kart('1', [G, G, G, G, G]);
    assert.equal(_enAutoKartQuality(e, 65), 'good');
    e.lapHistory = [G, G, G, G, G, B, B, B, B, B];
    assert.equal(_enAutoKartQuality(e, 65), 'good'); // badCount=1, aguanta
    let result;
    for (let i = 0; i < 4; i++) result = appendLap(e, B, 65);
    assert.equal(result, 'bad');
  });

  test('kart bueno con 4 vueltas malas nuevas → aguanta (badCount=4)', () => {
    reset();
    const e = kart('1', [G, G, G, G, G]);
    _enAutoKartQuality(e, 65);
    e.lapHistory = [G, G, G, G, G, B, B, B, B, B];
    _enAutoKartQuality(e, 65); // badCount=1
    let result;
    for (let i = 0; i < 3; i++) result = appendLap(e, B, 65); // badCount=4
    assert.equal(result, 'good');
  });

  test('reescritura externa de stintStartIdx invalida el caché sin vuelta nueva', () => {
    reset();
    // Kart viejo muy lento + kart nuevo rápido en el mismo historial
    const e = kart('1', [69, 69, 69, 69, 69, 63.5, 63.5, 63.5]);
    const mixed = _enAutoKartQuality(e, 65);
    EnSession.kartAutoState['1'].stintStartIdx = 5;   // reconexión: reindexado sin vuelta nueva
    assert.equal(_enAutoKartQuality(e, 65), 'good');
    assert.notEqual(mixed, 'good');
  });

  test('kart bueno se recupera antes de agotar las 5 vueltas de gracia', () => {
    reset();
    const e = kart('1', [G, G, G, G, G]);
    _enAutoKartQuality(e, 65);
    e.lapHistory = [G, G, G, G, G, B, B, B, B, B];
    assert.equal(_enAutoKartQuality(e, 65), 'good'); // badCount=1
    let r;
    for (let i = 0; i < 4; i++) r = appendLap(e, G, 65);
    assert.equal(r, 'good');
    assert.equal(EnSession.kartAutoState['1'].badCount, 0);
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

  test('B4: override durante una parada no arrastra vueltas del kart viejo al volver a auto', () => {
    reset();
    // Kart viejo malo, evaluado en auto
    const e = kart('1', [66.5, 66.5, 66.5, 66.5, 66.5]);
    assert.equal(_enEffectiveQuality('1', e, 65), 'bad');
    // El usuario fija override manual y el equipo entra a boxes
    EnUi.kartQuality['1'] = 'good';
    e.pitState = 'in';
    assert.equal(_enEffectiveQuality('1', e, 65), 'good');
    // Pit out: kart NUEVO. El tracking debe correr aunque el display sea manual.
    e.pitState = 'out';
    _enEffectiveQuality('1', e, 65); // stintStartIdx debe saltar al final (5)
    // Llegan 4 vueltas rápidas del kart nuevo mientras sigue el override
    e.lapHistory = [66.5, 66.5, 66.5, 66.5, 66.5, 63.5, 63.5, 63.5, 63.5];
    e.pitState = 'sr';
    _enEffectiveQuality('1', e, 65);
    // El usuario vuelve a 'auto': debe evaluar SOLO las vueltas del kart nuevo
    EnUi.kartQuality['1'] = 'auto';
    assert.equal(_enEffectiveQuality('1', e, 65), 'good');
    // Y stintStartIdx quedó anclado tras las 5 vueltas del kart viejo
    assert.equal(EnSession.kartAutoState['1'].stintStartIdx, 5);
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
    // con calentamiento: corregidas = [66, 66, 66, 64.2, 66]
    const laps = [66.36, 66.19, 66.13, 64.28, 66.06];
    assert.equal(_enAutoKartQuality(kart('1', laps), 65), 'neutral');
  });
});


// ── Rebufo: las vueltas con tráfico (en-traffic.js) no cuentan ────────────────

group('Tráfico — vueltas en tren/bloqueadas fuera de la calidad', () => {
  const { _enTrafficFilter } = require('../src/en-state');
  // Motor falso: en el kart '1' toda vuelta < 64 s fue en tren
  const fake = { isTraffic: (d, t) => (String(d) === '1' && t < 64 ? 'train' : null) };

  test('_enTrafficFilter quita las vueltas etiquetadas', () => {
    global.EnTraffic = fake;
    assert.deepEqual(_enTrafficFilter('1', [65, 65.2, 63.5, 65.1, 63.4]), [65, 65.2, 65.1]);
    delete global.EnTraffic;
  });

  test('_enTrafficFilter: si quedarían < 3, devuelve todas (red de seguridad)', () => {
    global.EnTraffic = fake;
    const laps = [65, 63.5, 63.4, 63.6];
    assert.deepEqual(_enTrafficFilter('1', laps), laps);
    delete global.EnTraffic;
  });

  test('_enTrafficFilter sin motor cargado → intacto', () => {
    const laps = [65, 63.5, 63.4];
    assert.deepEqual(_enTrafficFilter('1', laps), laps);
  });

  test('un kart normal que va en tren NO pasa a bueno', () => {
    reset();
    const laps = [65.2, 65.1, 65.3, 65.2, 65.1, 63.5, 63.6, 63.4];
    assert.equal(_enAutoKartQuality(kart('1', laps), 65), 'good', 'sin motor: el tren lo infla');
    reset();
    global.EnTraffic = fake;
    assert.equal(_enAutoKartQuality(kart('1', laps), 65), 'neutral');
    delete global.EnTraffic;
  });
});

group('Historial lleno (tope de 1500 vueltas) — APP-11', () => {
  // Al llegar al tope el parser descarta la más antigua por cada vuelta nueva:
  // la longitud ya no crece y el índice de inicio de stint debe correrse.
  const CAP = 1500;

  function lap(k, t, v) { k.lapHistory = [...k.lapHistory.slice(1), v]; k.lastLapAt = t; }

  test('con el historial lleno, el kart nuevo tras pit out se evalúa y no se congela', () => {
    reset();
    let t = 1000;
    const k = { dorsal: '9', name: 'X', pitState: 'out', lapHistory: Array(CAP).fill(70), lastLapAt: t };
    _enAutoKartQuality(k, 65);          // pit out con el historial ya lleno
    k.pitState = null;
    for (let i = 0; i < 3; i++) { lap(k, t += 65000, 65.0); _enAutoKartQuality(k, 65); }
    assert.equal(_enAutoKartQuality(k, 65), 'neutral', 'las 3 vueltas del kart nuevo cuentan');
    for (let i = 0; i < 5; i++) { lap(k, t += 63000, 63.0); _enAutoKartQuality(k, 65); }
    assert.equal(_enAutoKartQuality(k, 65), 'good', 'las vueltas siguientes siguen evaluándose');
  });

  test('llamadas repetidas sin vuelta nueva no corren el índice', () => {
    reset();
    let t = 1000;
    const k = { dorsal: '9', name: 'X', pitState: 'out', lapHistory: Array(CAP).fill(70), lastLapAt: t };
    _enAutoKartQuality(k, 65);
    k.pitState = null;
    for (let i = 0; i < 3; i++) { lap(k, t += 65000, 65.0); for (let j = 0; j < 8; j++) _enAutoKartQuality(k, 65); }
    assert.equal(EnSession.kartAutoState['9'].stintStartIdx, CAP - 3);
  });
});

// ── Score por nombre normalizado (acentos / mayúsculas / espacios) ───────────
// Apex manda el nombre en vivo con acentos; el logger sirve los ratings sin ellos.

group('Score de piloto por nombre normalizado', () => {
  test('_enCanonName: sin acentos, espacios colapsados, mayúsculas', () => {
    assert.equal(_enCanonName('  Rubén   Conceiçao '), 'RUBEN CONCEICAO');
    assert.equal(_enCanonName('JOEY LÜHRING'), 'JOEY LUHRING');
    assert.equal(_enCanonName(null), '');
  });

  test('_enRatingsMap: lista del logger → claves canónicas', () => {
    const m = _enRatingsMap([{ name: 'Pablo Mir Yanes', score: 700 }, { name: 'RUBEN CONCEICAO', score: 796 }]);
    assert.deepEqual(Object.keys(m).sort(), ['PABLO MIR YANES', 'RUBEN CONCEICAO']);
  });

  test('_enRatingsMap: caché antigua (mapa por nombre) se re-indexa', () => {
    const m = _enRatingsMap({ 'Germán Sánchez Flor': { score: 718 } });
    assert.equal(m['GERMAN SANCHEZ FLOR'].score, 718);
  });

  test('nombre en vivo con acento encuentra el rating sin acento', () => {
    reset();
    Object.assign(_enPilotRatings, _enRatingsMap([{ name: 'RUBEN CONCEICAO', score: 796 }]));
    assert.equal(_enRatingOf('RUBEN CONCEIÇAO').score, 796);
    assert.equal(_enRatingOf('Rubén  Conceiçao').score, 796);
    assert.equal(_enRatingOf('OTRO PILOTO'), null);
  });

});

// ── Regla Alcanede 2026-11: calentamiento + norma del propio equipo ─────────
// Tras cada parada las primeras vueltas van más lentas por calentamiento
// (v1 +0,36 · v2 +0,19 · v3 +0,13 · v4 +0,08 · v5 +0,06) y comparar con la
// media de pista mide sobre todo al equipo. Con ≥2 stints previos del dorsal
// se compara con SU norma (Δ de sus stints anteriores) a ±0,2 s.

const WARM = [0.36, 0.19, 0.13, 0.08, 0.06];
// n vueltas a trackAvg+delta con la curva de calentamiento encima
function stintLaps(n, base, delta) {
  return Array.from({ length: n }, (_, i) => +(base + delta + (WARM[i] || 0)).toFixed(3));
}
// Corre un stint completo: vueltas en pista, pit in y pit out
function runStint(k, laps, avg) {
  for (const v of laps) { k.lapHistory = [...k.lapHistory, v]; k.pitState = null; _enAutoKartQuality(k, avg); }
  k.pitState = 'in'; _enAutoKartQuality(k, avg);
  k.pitState = 'out'; _enAutoKartQuality(k, avg);
}

group('Calentamiento tras la parada', () => {
  test('sin corregir saldría bad; corregido el calentamiento → neutral', () => {
    reset();
    // +0,9 s y la curva encima: media sin corregir +1,13 (> 1,0) → antes bad
    const laps = stintLaps(3, 65, 0.9);
    assert.equal(_enAutoKartQuality(kart('1', laps), 65), 'neutral');
  });
});

group('Norma del propio equipo (±0,2 s)', () => {
  test('equipo lento (+0,6) con kart a +0,3 → good (antes neutral)', () => {
    reset();
    const k = { dorsal: '7', name: 'X', pitState: null, lapHistory: [] };
    runStint(k, stintLaps(12, 65, 0.6), 65);
    runStint(k, stintLaps(12, 65, 0.6), 65);
    for (const v of stintLaps(5, 65, 0.3)) { k.lapHistory = [...k.lapHistory, v]; k.pitState = null; _enAutoKartQuality(k, 65); }
    assert.equal(_enAutoKartQuality(k, 65), 'good');
  });

  test('equipo rápido (−0,6) con kart a −0,3 → bad (antes neutral)', () => {
    reset();
    const k = { dorsal: '8', name: 'X', pitState: null, lapHistory: [] };
    runStint(k, stintLaps(12, 65, -0.6), 65);
    runStint(k, stintLaps(12, 65, -0.6), 65);
    for (const v of stintLaps(5, 65, -0.3)) { k.lapHistory = [...k.lapHistory, v]; k.pitState = null; _enAutoKartQuality(k, 65); }
    assert.equal(_enAutoKartQuality(k, 65), 'bad');
  });

  test('dentro de ±0,2 de su norma → neutral', () => {
    reset();
    const k = { dorsal: '9', name: 'X', pitState: null, lapHistory: [] };
    runStint(k, stintLaps(12, 65, 0.6), 65);
    runStint(k, stintLaps(12, 65, 0.6), 65);
    for (const v of stintLaps(5, 65, 0.7)) { k.lapHistory = [...k.lapHistory, v]; k.pitState = null; _enAutoKartQuality(k, 65); }
    assert.equal(_enAutoKartQuality(k, 65), 'neutral');
  });

  test('stints cortos (<8 vueltas limpias) no cuentan para la norma', () => {
    reset();
    const k = { dorsal: '10', name: 'X', pitState: null, lapHistory: [] };
    runStint(k, stintLaps(12, 65, 0.6), 65);
    runStint(k, stintLaps(4, 65, 0.6), 65);   // rechazo: no es norma
    assert.equal(EnSession.kartAutoState['10'].stintNorms.length, 1);
    // solo 1 stint de norma → sigue la regla de pista (sin score ±1,0): +0,3 → neutral
    for (const v of stintLaps(5, 65, 0.3)) { k.lapHistory = [...k.lapHistory, v]; k.pitState = null; _enAutoKartQuality(k, 65); }
    assert.equal(_enAutoKartQuality(k, 65), 'neutral');
  });

  test('pit in repetido en varios ticks registra el stint una sola vez', () => {
    reset();
    const k = { dorsal: '11', name: 'X', pitState: null, lapHistory: [] };
    for (const v of stintLaps(12, 65, 0.6)) { k.lapHistory = [...k.lapHistory, v]; _enAutoKartQuality(k, 65); }
    k.pitState = 'in';
    for (let i = 0; i < 5; i++) _enAutoKartQuality(k, 65);
    assert.equal(EnSession.kartAutoState['11'].stintNorms.length, 1);
  });

  test('tooltip explica la comparación con la norma del equipo', () => {
    reset();
    const k = { dorsal: '12', name: 'X', pitState: null, lapHistory: [] };
    runStint(k, stintLaps(12, 65, 0.6), 65);
    runStint(k, stintLaps(12, 65, 0.6), 65);
    for (const v of stintLaps(5, 65, 0.3)) { k.lapHistory = [...k.lapHistory, v]; k.pitState = null; _enAutoKartQuality(k, 65); }
    const tip = _enQualityTooltip('12', k, 65);
    assert.ok(/BUENO \(auto\)/.test(tip), tip);
    assert.ok(/norma del equipo/i.test(tip), tip);
    assert.ok(/−0,30|-0\.30/.test(tip), tip);
  });
});

group('Kart rechazado (stint corto sin deuda)', () => {
  test('en boxes, la marca de rechazo no la pisa la calidad neutra de las vueltas', () => {
    reset();
    const k = { dorsal: '20', name: 'X', pitState: null, lapHistory: [] };
    for (const v of stintLaps(4, 65, 0)) { k.lapHistory = [...k.lapHistory, v]; _enAutoKartQuality(k, 65); }
    const st = EnSession.kartAutoState['20'];
    st.prePitQuality = 'bad'; st.rejected = { stintMin: 3, availMin: 40 };   // lo pone el pit in
    k.pitState = 'in';
    for (let i = 0; i < 3; i++) assert.equal(_enAutoKartQuality(k, 65), 'bad');
    assert.ok(/rechazado/i.test(_enQualityTooltip('20', k, 65)));
  });

  test('al salir con kart nuevo se borra la marca de rechazo', () => {
    reset();
    const k = { dorsal: '21', name: 'X', pitState: null, lapHistory: stintLaps(4, 65, 0) };
    _enAutoKartQuality(k, 65);
    const st = EnSession.kartAutoState['21'];
    st.prePitQuality = 'bad'; st.rejected = { stintMin: 3, availMin: 40 };
    k.pitState = 'in'; _enAutoKartQuality(k, 65);
    k.pitState = 'out'; _enAutoKartQuality(k, 65);
    assert.equal(st.rejected, null);
  });

  test('si Apex se salta el out, la marca se borra al volver a pista', () => {
    reset();
    const k = { dorsal: '22', name: 'X', pitState: null, lapHistory: stintLaps(4, 65, 0) };
    _enAutoKartQuality(k, 65);
    const st = EnSession.kartAutoState['22'];
    st.prePitQuality = 'bad'; st.rejected = { stintMin: 3, availMin: 40 };
    k.pitState = 'in'; _enAutoKartQuality(k, 65);
    k.pitState = null; k.pit = false; _enAutoKartQuality(k, 65);
    assert.equal(st.rejected, null);
  });
});

group('Norma por piloto (el mismo piloto en sus stints anteriores)', () => {
  // A rueda 0,5 s más rápido que la pista y B 0,5 s más lento: la norma del
  // equipo (mediana de los dos) queda en 0 y confunde piloto con kart.
  function race(dorsal, cur) {
    const k = { dorsal, name: 'A', pitState: null, lapHistory: [] };
    k.name = 'A'; runStint(k, stintLaps(12, 65, -0.5), 65);
    k.name = 'B'; runStint(k, stintLaps(12, 65, 0.5), 65);
    k.name = cur.name;
    for (const v of stintLaps(5, 65, cur.delta)) { k.lapHistory = [...k.lapHistory, v]; k.pitState = null; _enAutoKartQuality(k, 65); }
    return k;
  }

  test('piloto rápido a −0,2 (0,3 peor que su norma) → bad (frente al equipo saldría neutral)', () => {
    reset();
    const k = race('40', { name: 'A', delta: -0.2 });
    assert.equal(_enAutoKartQuality(k, 65), 'bad');
  });

  test('piloto lento a +0,2 (0,3 mejor que su norma) → good', () => {
    reset();
    const k = race('41', { name: 'B', delta: 0.2 });
    assert.equal(_enAutoKartQuality(k, 65), 'good');
  });

  test('piloto nuevo sin stints propios → norma del equipo', () => {
    reset();
    const k = race('42', { name: 'C', delta: -0.3 });   // equipo en 0 → −0,3 → good
    assert.equal(_enAutoKartQuality(k, 65), 'good');
  });

  test('un solo nombre en todo el dorsal (equipo) → norma del equipo, no por piloto', () => {
    reset();
    const k = { dorsal: '43', name: 'EQUIPO', pitState: null, lapHistory: [] };
    runStint(k, stintLaps(12, 65, 0.6), 65);
    for (const v of stintLaps(5, 65, 0.3)) { k.lapHistory = [...k.lapHistory, v]; k.pitState = null; _enAutoKartQuality(k, 65); }
    // 1 stint previo: sin norma del equipo aún (pide 2) → regla de pista ±1,0 → neutral
    assert.equal(_enAutoKartQuality(k, 65), 'neutral');
  });

  test('mi equipo: usa el piloto elegido en el panel aunque Apex mande el nombre del equipo', () => {
    reset();
    global.window = { AppState: { config: { myDorsal: '44', pilotos: [{ name: 'Ana' }, { name: 'Bea' }] } } };
    try {
      const k = { dorsal: '44', name: 'MI EQUIPO', pitState: null, lapHistory: [] };
      EnSession.currentPilot = 0; runStint(k, stintLaps(12, 65, -0.5), 65);
      EnSession.currentPilot = 1; runStint(k, stintLaps(12, 65, 0.5), 65);
      EnSession.currentPilot = 0;
      for (const v of stintLaps(5, 65, -0.2)) { k.lapHistory = [...k.lapHistory, v]; k.pitState = null; _enAutoKartQuality(k, 65); }
      assert.equal(_enAutoKartQuality(k, 65), 'bad');
      assert.ok(/norma de ANA/i.test(_enQualityTooltip('44', k, 65)), _enQualityTooltip('44', k, 65));
    } finally { delete global.window; EnSession.currentPilot = 0; }
  });
});

// ── Resumen ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
