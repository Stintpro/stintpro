'use strict';

const {
  _enFmt, _enFmtGap, _enFmtDelta, _enFmtStint,
  _enDeltaColor, _enCleanLaps, _enCons, _enAvg5, _enTrend,
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

// ── Resumen ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
