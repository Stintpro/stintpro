'use strict';

const { computePilotRatings } = require('../scoring');

// Fábrica de fila: valores por defecto razonables para un circuito de ~50s
function row(name, session_id, best_ms, opts = {}) {
  const laps = opts.laps ?? 15;
  return {
    name,
    session_id,
    best_ms,
    avg_ms: opts.avg_ms ?? Math.round(best_ms * 1.04),
    laps,
  };
}

// ── Nombres inválidos ─────────────────────────────────────────────────────────

describe('validName — filtra nombres inválidos', () => {
  const invalid = ['', null, undefined, '12', '7', 'kart 3', 'KART3', 'Equipo1', 'team 2', 'Piloto', 'driver', '(sin nombre)'];
  for (const name of invalid) {
    test(`"${name}" → excluido`, () => {
      const result = computePilotRatings([row(name, 1, 50000)]);
      expect(result).toHaveLength(0);
    });
  }

  test('nombre válido → incluido', () => {
    const result = computePilotRatings([row('JAVIER', 1, 50000, { laps: 15 })]);
    expect(result).toHaveLength(1);
  });
});

// ── Pocos datos → score null ──────────────────────────────────────────────────

describe('pilotos con pocos datos', () => {
  test('< 10 vueltas → score null, tier "Sin datos"', () => {
    const rows = [row('JAVIER', 1, 50000, { laps: 9 })];
    const [p] = computePilotRatings(rows);
    expect(p.score).toBeNull();
    expect(p.tier).toBe('Sin datos');
    expect(p.pace_score).toBeNull();
  });

  test('exactamente 10 vueltas → tiene score', () => {
    const rows = [row('JAVIER', 1, 50000, { laps: 10 })];
    const [p] = computePilotRatings(rows);
    expect(p.score).not.toBeNull();
  });
});

// ── Pace score ────────────────────────────────────────────────────────────────

describe('pace_score', () => {
  test('piloto igual al récord → pace_score 500', () => {
    const rows = [row('JAVIER', 1, 50000, { laps: 15 })];
    const [p] = computePilotRatings(rows);
    expect(p.pace_score).toBe(500);
    expect(p.gap_to_record_pct).toBe(0);
  });

  test('piloto al 6% del récord → pace_score ~250 (mitad del rango)', () => {
    // PACE_FLOOR = 12%. Al 6% → 1 - 0.06/0.12 = 0.5 → 250 pts
    const rows = [
      row('RECORD', 1, 50000, { laps: 15 }),
      row('MEDIO',  1, 53000, { laps: 15 }), // +6%
    ];
    const result = computePilotRatings(rows);
    const medio = result.find(p => p.name === 'MEDIO');
    expect(medio.pace_score).toBe(250);
  });

  test('piloto al 12% o más del récord → pace_score 0', () => {
    const rows = [
      row('RECORD', 1, 50000, { laps: 15 }),
      row('LENTO',  1, 56000, { laps: 15 }), // +12%
    ];
    const result = computePilotRatings(rows);
    const lento = result.find(p => p.name === 'LENTO');
    expect(lento.pace_score).toBe(0);
  });
});

// ── Position score ────────────────────────────────────────────────────────────

describe('position_score', () => {
  test('sesión con < 5 pilotos → position_score neutro (150)', () => {
    // Solo 4 pilotos en sesión → no es "comparable"
    const rows = [
      row('A', 1, 50000, { laps: 15 }),
      row('B', 1, 51000, { laps: 15 }),
      row('C', 1, 52000, { laps: 15 }),
      row('D', 1, 53000, { laps: 15 }),
    ];
    const result = computePilotRatings(rows);
    for (const p of result) expect(p.position_score).toBe(150);
  });

  test('1º de 5 → position_score 300', () => {
    // Nombres de ≥3 chars para pasar _validName (P2/P3... se filtran por length<3)
    const rows = [
      row('LIDER', 1, 50000, { laps: 15 }),
      row('PLT2',  1, 51000, { laps: 15 }),
      row('PLT3',  1, 52000, { laps: 15 }),
      row('PLT4',  1, 53000, { laps: 15 }),
      row('PLT5',  1, 54000, { laps: 15 }),
    ];
    const result = computePilotRatings(rows);
    const lider = result.find(p => p.name === 'LIDER');
    expect(lider.position_score).toBe(300);
  });

  test('último de 5 → position_score 0', () => {
    const rows = [
      row('PLT1',  1, 50000, { laps: 15 }),
      row('PLT2',  1, 51000, { laps: 15 }),
      row('PLT3',  1, 52000, { laps: 15 }),
      row('PLT4',  1, 53000, { laps: 15 }),
      row('ULTIMO',1, 54000, { laps: 15 }),
    ];
    const result = computePilotRatings(rows);
    const ultimo = result.find(p => p.name === 'ULTIMO');
    expect(ultimo.position_score).toBe(0);
  });
});

// ── Consistency score ─────────────────────────────────────────────────────────

describe('consistency_score', () => {
  test('1 sesión → consistency_score neutro (100)', () => {
    const rows = [row('JAVIER', 1, 50000, { laps: 15 })];
    const [p] = computePilotRatings(rows);
    expect(p.consistency_score).toBe(100);
  });

  test('2 sesiones idénticas → consistency_score 200 (máximo)', () => {
    const rows = [
      row('JAVIER', 1, 50000, { laps: 15 }),
      row('JAVIER', 2, 50000, { laps: 15 }),
    ];
    const [p] = computePilotRatings(rows);
    expect(p.consistency_score).toBe(200);
  });

  test('sesiones muy irregulares → consistency_score bajo', () => {
    // Con 2 sesiones el algoritmo solo evalúa la 1 mejor → varianza=0 → score=200.
    // Se necesitan ≥4 sesiones para que la "mitad mejor" (2 sesiones) muestre varianza.
    // avg_ms homogéneo en todas para que ninguna se detecte como lluviosa.
    const rows = [
      row('IRREGULAR', 1, 50000, { avg_ms: 53000, laps: 15 }), // pace=0
      row('IRREGULAR', 2, 51000, { avg_ms: 53000, laps: 15 }), // pace=0.02
      row('IRREGULAR', 3, 52000, { avg_ms: 53000, laps: 15 }), // pace=0.04
      row('IRREGULAR', 4, 53000, { avg_ms: 53000, laps: 15 }), // pace=0.06
    ];
    // best half (2 sesiones): paces [0, 0.02] → CV ≈ 0.9 > 0.3 → score = 0
    const [p] = computePilotRatings(rows);
    expect(p.consistency_score).toBeLessThan(50);
  });
});

// ── Shrinkage bayesiano ───────────────────────────────────────────────────────

describe('shrinkage bayesiano', () => {
  // Con K=4, piloto con 1 sesión: w = 1/5 = 0.2 → score = 0.2*raw + 0.8*circuitMean
  // Con 1 solo piloto circuitMean = raw, así que score == raw. Necesitamos varios pilotos.

  test('piloto con pocas sesiones → score se acerca a la media del circuito', () => {
    // Piloto experto (muchas sesiones): raw ~800
    // Piloto nuevo (1 sesión): raw ~800 también, pero el shrinkage lo reduce menos
    // Comprobamos que con K=4 un piloto de 1 sesión queda entre su raw y la media
    const rows = [
      // Piloto experto: 8 sesiones, siempre rápido → raw_score alto
      ...Array.from({ length: 8 }, (_, i) => row('EXPERTO', i + 1, 50000, { laps: 20 })),
      // Piloto nuevo: 1 sesión, también rápido
      row('NUEVO', 9, 50000, { laps: 20 }),
    ];
    const result = computePilotRatings(rows);
    const experto = result.find(p => p.name === 'EXPERTO');
    const nuevo   = result.find(p => p.name === 'NUEVO');
    // Ambos tienen el mismo raw_score, pero el shrinkage del nuevo es mayor (más sesiones = más peso real)
    // Con raw iguales y misma circuitMean, el score también debe ser igual — validamos que no explota
    expect(experto.score).toBeGreaterThan(0);
    expect(nuevo.score).toBeGreaterThan(0);
    // El experto debe tener score >= nuevo cuando tienen mismo raw (más sesiones = w más alto → más fiel)
    expect(experto.score).toBeGreaterThanOrEqual(nuevo.score);
  });

  test('piloto muy lento con muchas sesiones tiene score más bajo que uno rápido con pocas', () => {
    const rows = [
      // Piloto rápido, pocas sesiones
      row('RAPIDO', 1, 50000, { laps: 15 }),
      // Piloto lento, muchas sesiones — su raw_score es bajo
      ...Array.from({ length: 10 }, (_, i) => row('LENTO', i + 2, 59000, { laps: 15 })),
    ];
    const result = computePilotRatings(rows);
    const rapido = result.find(p => p.name === 'RAPIDO');
    const lento  = result.find(p => p.name === 'LENTO');
    expect(rapido.score).toBeGreaterThan(lento.score);
  });
});

// ── Detección de sesiones lluviosas ──────────────────────────────────────────

describe('detección de sesiones lluviosas', () => {
  test('sesión lluviosa (>12% más lenta) no contamina el récord del circuito', () => {
    // 5 sesiones secas + 1 lluviosa (todos van 20% más lentos)
    const DRY_RECORD = 50000;
    const dryRows = Array.from({ length: 5 }, (_, i) =>
      row('JAVIER', i + 1, DRY_RECORD, { avg_ms: 52000, laps: 10 })
    );
    // Sesión lluviosa: ritmo medio +20% → avg_ms muy alto
    const wetRow = { name: 'JAVIER', session_id: 99, best_ms: 56000, avg_ms: 62000, laps: 10 };

    const result = computePilotRatings([...dryRows, wetRow]);
    const [p] = result;
    // El récord de circuito debe ser el seco (50000), no el húmedo
    expect(p.circuit_record_ms).toBe(DRY_RECORD);
    // La vuelta lluviosa no debe contaminar la mejor del piloto
    expect(p.pilot_best_ms).toBe(DRY_RECORD);
  });
});

// ── Output sin datos ──────────────────────────────────────────────────────────

describe('casos borde', () => {
  test('sin filas → array vacío', () => {
    expect(computePilotRatings([])).toEqual([]);
  });

  test('solo nombres inválidos → array vacío', () => {
    expect(computePilotRatings([row('7', 1, 50000), row('kart 3', 1, 51000)])).toEqual([]);
  });

  test('resultado ordenado por score desc, nulls al final', () => {
    const rows = [
      row('RAPIDO', 1, 50000, { laps: 15 }),   // score alto
      row('LENTO',  1, 58000, { laps: 15 }),   // score bajo
      row('POCOS',  1, 50000, { laps: 5 }),    // score null
    ];
    const result = computePilotRatings(rows);
    const scores = result.map(p => p.score);
    // Nulls al final
    const nullIdx  = scores.indexOf(null);
    const lastNonNull = scores.slice(0, nullIdx === -1 ? scores.length : nullIdx);
    for (let i = 1; i < lastNonNull.length; i++) {
      expect(lastNonNull[i]).toBeLessThanOrEqual(lastNonNull[i - 1]);
    }
    if (nullIdx !== -1) {
      scores.slice(nullIdx).forEach(s => expect(s).toBeNull());
    }
  });

  test('devuelve los campos esperados por la app', () => {
    const [p] = computePilotRatings([row('JAVIER', 1, 50000, { laps: 15 })]);
    expect(p).toMatchObject({
      name:               expect.any(String),
      score:              expect.any(Number),
      pace_score:         expect.any(Number),
      position_score:     expect.any(Number),
      consistency_score:  expect.any(Number),
      pilot_best_ms:      expect.any(Number),
      circuit_record_ms:  expect.any(Number),
      gap_to_record_pct:  expect.any(Number),
      session_count:      expect.any(Number),
      total_laps:         expect.any(Number),
    });
  });
});
