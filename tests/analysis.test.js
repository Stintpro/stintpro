'use strict';

const {
  _enFmt, _enFmtGap, _enFmtDelta, _enFmtStint,
  _enDeltaColor, _enCleanLaps, _enCons, _enAvg5, _enTrend,
  _enPaceStd, _enDensityTiers, _enResolveGap, _enMergeLapHistory,
} = require('../src/analysis');

const assert = require('assert');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}
function group(name, fn) { console.log(`\n${name}`); fn(); }

// ── _enFmt ────────────────────────────────────────────────────────────────────

group('_enFmt (segundos → string)', () => {
  test('null → —',          () => assert.equal(_enFmt(null), '—'));
  test('undefined → —',     () => assert.equal(_enFmt(undefined), '—'));
  test('0 → "0.000"',       () => assert.equal(_enFmt(0), '00.000'));
  test('47.234s',           () => assert.equal(_enFmt(47.234), '47.234'));
  test('67s → "1:07.000"',  () => assert.equal(_enFmt(67), '1:07.000'));
  test('rellena ceros',     () => assert.equal(_enFmt(61.005), '1:01.005'));
});

// ── _enFmtGap ─────────────────────────────────────────────────────────────────

group('_enFmtGap (ms → string con +)', () => {
  test('null → —',            () => assert.equal(_enFmtGap(null), '—'));
  test('0 → —',               () => assert.equal(_enFmtGap(0), '—'));
  test('negativo → —',        () => assert.equal(_enFmtGap(-100), '—'));
  test('1500ms → "+1.500"',   () => assert.equal(_enFmtGap(1500), '+1.500'));
  test('65000ms → "+1:05.000"', () => assert.equal(_enFmtGap(65000), '+1:05.000'));
});

// ── _enFmtDelta ───────────────────────────────────────────────────────────────

group('_enFmtDelta (delta vs pista)', () => {
  test('null → —',           () => assert.equal(_enFmtDelta(null), '—'));
  test('NaN → —',            () => assert.equal(_enFmtDelta(NaN), '—'));
  test('positivo lleva +',   () => assert.equal(_enFmtDelta(0.5), '+0.500'));
  test('negativo lleva -',   () => assert.equal(_enFmtDelta(-0.3), '-0.300'));
  test('cero lleva +',       () => assert.equal(_enFmtDelta(0), '+0.000'));
});

// ── _enFmtStint ───────────────────────────────────────────────────────────────

group('_enFmtStint (ms → "M:SS")', () => {
  test('null → "0:00"',       () => assert.equal(_enFmtStint(null), '0:00'));
  test('negativo → "0:00"',   () => assert.equal(_enFmtStint(-1), '0:00'));
  test('90000ms → "1:30"',    () => assert.equal(_enFmtStint(90000), '1:30'));
  test('rellena segundos',    () => assert.equal(_enFmtStint(65000), '1:05'));
  test('solo segundos',       () => assert.equal(_enFmtStint(45000), '0:45'));
});

// ── _enDeltaColor ─────────────────────────────────────────────────────────────

group('_enDeltaColor', () => {
  test('null → gris',        () => assert.equal(_enDeltaColor(null), '#2d2f38'));
  test('NaN → gris',        () => assert.equal(_enDeltaColor(NaN), '#2d2f38'));
  test('< -0.5 → violeta',   () => assert.equal(_enDeltaColor(-0.6), '#c084fc'));
  test('-0.5..-0.2 → verde', () => assert.equal(_enDeltaColor(-0.3), '#22c55e'));
  test('-0.2..0.2 → gris',   () => assert.equal(_enDeltaColor(0), '#9ca3af'));
  test('0.2..0.5 → amarillo',() => assert.equal(_enDeltaColor(0.3), '#fbbf24'));
  test('> 0.5 → rojo',       () => assert.equal(_enDeltaColor(0.6), '#ef4444'));
  test('límite -0.5 exacto → verde',  () => assert.equal(_enDeltaColor(-0.5), '#22c55e'));
  test('límite 0.5 exacto → rojo (condición estricta <)',() => assert.equal(_enDeltaColor(0.5), '#ef4444'));
});

// ── _enCleanLaps ──────────────────────────────────────────────────────────────

group('_enCleanLaps', () => {
  test('null → []',             () => assert.deepEqual(_enCleanLaps(null), []));
  test('1 vuelta → []',         () => assert.deepEqual(_enCleanLaps([50]), []));
  test('vueltas normales pasan',() => {
    const r = _enCleanLaps([50, 50.5, 51, 50.2]);
    assert.ok(r.length === 4, `esperaba 4, got ${r.length}`);
  });
  test('≥180s filtradas (pit)', () => {
    const r = _enCleanLaps([50, 50.5, 180, 200]);
    assert.ok(!r.includes(180) && !r.includes(200));
  });
  test('> mediana+2s filtradas', () => {
    // mediana ~50.5, así que 53.5 (>50.5+2) debe ser filtrada
    const r = _enCleanLaps([50, 51, 50, 51, 53.5]);
    assert.ok(!r.includes(53.5), `53.5 debería ser filtrada`);
  });
  test('parcial box→meta filtrada (< mediana×0.7)', () => {
    // mediana ~50, vuelta de 30 (< 50×0.7=35) es parcial
    const r = _enCleanLaps([50, 51, 50, 51, 30]);
    assert.ok(!r.includes(30), `30 debería ser filtrada como parcial`);
  });
  test('todas <180 y dentro de rango pasan', () => {
    const laps = [50, 50.3, 50.1, 50.4, 50.2];
    assert.deepEqual(_enCleanLaps(laps), laps);
  });
});

// ── _enCons ───────────────────────────────────────────────────────────────────

group('_enCons (consistencia)', () => {
  test('<2 vueltas limpias → null', () => assert.equal(_enCons([50]), null));
  test('rango < 0.3 → Muy regular', () => {
    const r = _enCons([50, 50.1, 50.2, 50.15, 50.05]);
    assert.equal(r.label, 'Muy regular');
    assert.equal(r.color, '#22c55e');
  });
  test('rango 0.3..0.5 → Regular', () => {
    const r = _enCons([50, 50.4, 50, 50.3, 50.1]);
    assert.equal(r.label, 'Regular');
  });
  test('rango 0.5..1.0 → Irregular', () => {
    const r = _enCons([50, 50.8, 50, 50.6, 50.1]);
    assert.equal(r.label, 'Irregular');
  });
  test('rango ≥ 1.0 → Errático', () => {
    const r = _enCons([50, 51.5, 50, 51.2, 50.1]);
    assert.equal(r.label, 'Errático');
    assert.equal(r.color, '#ef4444');
  });
  test('solo evalúa últimas 5 vueltas', () => {
    // primeras vueltas muy erráticas, últimas 5 muy regulares
    const r = _enCons([45, 60, 45, 60, 50, 50.1, 50.05, 50.2, 50.1]);
    assert.equal(r.label, 'Muy regular');
  });
  test('filtra outliers antes de evaluar', () => {
    // vuelta de 200s (pit) no debe contaminar
    const r = _enCons([50, 50.1, 200, 50.2, 50.05, 50.15]);
    assert.equal(r.label, 'Muy regular');
  });
});

// ── _enAvg5 ───────────────────────────────────────────────────────────────────

group('_enAvg5 (media últimas 5 vueltas limpias)', () => {
  test('null → null',        () => assert.equal(_enAvg5(null), null));
  test('1 vuelta → null',    () => assert.equal(_enAvg5([50]), null));
  test('media correcta',     () => {
    const r = _enAvg5([50, 51, 50, 51, 50]);
    assert.ok(Math.abs(r - 50.4) < 0.001, `esperaba ~50.4, got ${r}`);
  });
  test('solo últimas 5',     () => {
    // 10 vueltas: primeras 5 lentas (60s), últimas 5 rápidas (50s)
    const r = _enAvg5([60, 60, 60, 60, 60, 50, 50, 50, 50, 50]);
    assert.ok(r < 55, `esperaba ~50, got ${r}`);
  });
  test('excluye outliers',   () => {
    // vuelta de 200s (pit) no debe entrar en la media
    const r = _enAvg5([50, 50, 50, 200, 50, 50]);
    assert.ok(r < 55, `pit no debe contaminar la media, got ${r}`);
  });
});

// ── _enTrend ──────────────────────────────────────────────────────────────────

group('_enTrend (tendencia de ritmo)', () => {
  test('< 6 vueltas → sin flecha', () => {
    const r = _enTrend([50, 50, 50, 50, 50]);
    assert.equal(r.arrow, '');
  });
  test('mejora > 0.15s → ↑ verde', () => {
    // últimas 3: 50s, anteriores 3: 51s → diff = -1 < -0.15
    const r = _enTrend([51, 51, 51, 50, 50, 50]);
    assert.equal(r.arrow, '↑');
    assert.equal(r.color, '#22c55e');
  });
  test('empeora > 0.15s → ↓ rojo', () => {
    // últimas 3: 51s, anteriores 3: 50s → diff = +1 > 0.15
    const r = _enTrend([50, 50, 50, 51, 51, 51]);
    assert.equal(r.arrow, '↓');
    assert.equal(r.color, '#ef4444');
  });
  test('estable (diff ≤ 0.15s) → → gris', () => {
    const r = _enTrend([50, 50, 50, 50.1, 50.1, 50.1]);
    assert.equal(r.arrow, '→');
  });
  test('< 6 vueltas limpias → sin flecha aunque hay más en hist', () => {
    // 8 vueltas pero 3 de pit → solo 5 limpias
    const r = _enTrend([50, 50, 200, 50, 200, 50, 200, 50]);
    assert.equal(r.arrow, '');
  });
});

// ── _enPaceStd ────────────────────────────────────────────────────────────────

group('_enPaceStd (ruido de ritmo)', () => {
  const arr=(n,base,jit)=>Array.from({length:n},(_,i)=>base+(i%2?jit:-jit));
  test('sin datos → 0.4 por defecto', () => assert.equal(_enPaceStd([]), 0.4));
  test('pocas vueltas → 0.4 por defecto', () => assert.equal(_enPaceStd([44,44]), 0.4));
  test('ritmo muy regular → std pequeña', () => {
    const s=_enPaceStd([44.0,44.05,43.98,44.02,44.01,43.99]);
    assert.ok(s<0.1, `esperaba <0.1, fue ${s}`);
  });
  test('ritmo errático → std mayor', () => {
    const regular=_enPaceStd(arr(8,44,0.05));
    const erratico=_enPaceStd(arr(8,44,0.8));
    assert.ok(erratico>regular, 'errático debe tener más ruido que regular');
  });
});

// ── _enDensityTiers ─────────────────────────────────────────────────────────────

group('_enDensityTiers (agrupación por confianza)', () => {
  const reg=Array.from({length:8},(_,i)=>44+(i%2?0.4:-0.4)); // ritmo realista σ≈0.4
  const mk=(gap)=>({estimatedGap:gap, lapHistory:reg});

  test('a falta de 0 vueltas, todo se separa (tiers distintos)', () => {
    const t=_enDensityTiers([mk(0),mk(2),mk(5)], 0);
    assert.deepEqual(t, [0,1,2]);
  });
  test('muchas vueltas restantes → huecos pequeños colapsan en un tier', () => {
    const t=_enDensityTiers([mk(0),mk(1),mk(2)], 100);
    assert.equal(t[0], t[1], 'juntos con 100 vueltas por delante = mismo tier');
    assert.equal(t[1], t[2]);
  });
  test('un hueco grande separa tiers aunque queden vueltas', () => {
    const t=_enDensityTiers([mk(0),mk(0.5),mk(40)], 20);
    assert.equal(t[0], t[1], 'los dos primeros van juntos');
    assert.ok(t[2]>t[1], 'el tercero (a 40s) queda en otro tier');
  });
  test('el swing se estrecha al acabar la carrera (mismo hueco, menos vueltas)', () => {
    const gaps=[mk(0),mk(3)];
    const pronto=_enDensityTiers(gaps, 60); // muchas vueltas
    const tarde=_enDensityTiers(gaps, 2);   // casi acabando
    assert.equal(pronto[0], pronto[1], 'pronto: 3s es indistinguible');
    assert.ok(tarde[1]>tarde[0], 'tarde: 3s ya es separable');
  });
});

// ── _enResolveGap (saneo del gap en paradas) ────────────────────────────────

group('_enResolveGap (gap saneado del artefacto de pit)', () => {
  test('normal: prefiere el gap de Apex (más fino) con suelo en vueltas', () => {
    assert.equal(_enResolveGap({apexGap:12, lapsGap:8, pitCost:150}), 12);
  });
  test('en boxes: ignora Apex, usa gap por vueltas', () => {
    assert.equal(_enResolveGap({apexGap:152, lapsGap:2, inPit:true, pitCost:150}), 2);
  });
  test('spike de rejoin tras parada: usa gap por vueltas', () => {
    // apexGap +152 (ciclo de pit) muy por encima de la posición por vueltas (~1s)
    assert.equal(_enResolveGap({apexGap:152, lapsGap:1, inPit:false, pitCost:150}), 1);
  });
  test('gap grande pero legítimo (doblado) NO se sanea', () => {
    // 2 vueltas abajo: apexGap≈88 y lapsGap≈88 → coherentes → se mantiene Apex
    assert.equal(_enResolveGap({apexGap:90, lapsGap:88, pitCost:150}), 90);
  });
  test('sin gap de Apex (0): devuelve el de vueltas', () => {
    assert.equal(_enResolveGap({apexGap:0, lapsGap:44, pitCost:150}), 44);
  });
});

// ── _enMergeLapHistory (merge por contador, modo logger) ────────────────────

group('_enMergeLapHistory (historial acumulado + ventana live)', () => {
  test('sin contadores → null (el llamante aplica el fallback)', () => {
    assert.equal(_enMergeLapHistory([60,61], undefined, [61,62], undefined), null);
    assert.equal(_enMergeLapHistory([60,61], 2, [61,62], undefined), null);
    assert.equal(_enMergeLapHistory([60,61], undefined, [61,62], 3), null);
  });
  test('una vuelta nueva: añade la última de la ventana', () => {
    const merged=_enMergeLapHistory([60,61,62], 3, [61,62,63], 4);
    assert.deepEqual(merged, [60,61,62,63]);
  });
  test('CASO DEL BUG: vuelta nueva con tiempo repetido NO se descarta', () => {
    // El kart repite exactamente 67.0 (ya presente en el historial): con el
    // dedup por valor esta vuelta se perdía; por contador se añade siempre.
    const merged=_enMergeLapHistory([67.0,66.8,67.1], 3, [66.8,67.1,67.0], 4);
    assert.deepEqual(merged, [67.0,66.8,67.1,67.0]);
  });
  test('varias vueltas nuevas: añade la cola exacta de la ventana', () => {
    const merged=_enMergeLapHistory([60,61], 2, [60,61,62,63,64], 5);
    assert.deepEqual(merged, [60,61,62,63,64]);
  });
  test('sin vueltas nuevas (mismo contador): conserva el acumulado tal cual', () => {
    const prev=[60,61,62];
    assert.deepEqual(_enMergeLapHistory(prev, 3, [61,62], 3), prev);
  });
  test('contador hacia atrás (reinicio del servidor): conserva el acumulado', () => {
    const prev=Array.from({length:80},(_,i)=>60+i*0.01);
    assert.deepEqual(_enMergeLapHistory(prev, 80, [60.1,60.2], 2), prev);
  });
  test('hueco mayor que la ventana: añade toda la ventana (mejor esfuerzo)', () => {
    // 15 vueltas nuevas pero la ventana solo trae 10 → se añaden esas 10
    const win=Array.from({length:10},(_,i)=>70+i);
    const merged=_enMergeLapHistory([60,61], 2, win, 17);
    assert.deepEqual(merged, [60,61,...win]);
  });
  test('tope de 1500: recorta por el principio', () => {
    const prev=Array.from({length:1499},(_,i)=>60+(i%30)*0.1);
    const merged=_enMergeLapHistory(prev, 1499, [65,66,67], 1502);
    assert.equal(merged.length, 1500);
    assert.equal(merged[merged.length-1], 67);
    assert.equal(merged[0], prev[2]); // se descartaron las 2 más antiguas
  });
  test('historiales vacíos: primera ventana entra entera', () => {
    assert.deepEqual(_enMergeLapHistory([], 0, [60,61], 2), [60,61]);
  });
});

// ── Resumen ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
