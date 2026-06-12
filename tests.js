// StintPro — tests funciones puras de analysis.js
// Ejecutar: node tests.js

const { strictEqual, deepEqual, ok } = require('assert');
const fs = require('fs');

eval(fs.readFileSync('src/analysis.js', 'utf8'));

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch(e) { console.log('  ✗', name, '→', e.message); failed++; }
}

// ── _enFmt ────────────────────────────────────────────────────────────────
console.log('\n_enFmt');
test('null → —',           () => strictEqual(_enFmt(null), '—'));
test('undefined → —',      () => strictEqual(_enFmt(undefined), '—'));
test('47.234 → "47.234"',  () => strictEqual(_enFmt(47.234), '47.234'));
test('67.234 → "1:07.234"',() => strictEqual(_enFmt(67.234), '1:07.234'));
test('0 → "00.000"',       () => strictEqual(_enFmt(0), '00.000'));

// ── _enFmtDelta ───────────────────────────────────────────────────────────
console.log('\n_enFmtDelta');
test('null → —',           () => strictEqual(_enFmtDelta(null), '—'));
test('NaN → —',            () => strictEqual(_enFmtDelta(NaN), '—'));
test('positivo lleva +',   () => strictEqual(_enFmtDelta(0.5), '+0.500'));
test('negativo lleva -',   () => strictEqual(_enFmtDelta(-0.3), '-0.300'));

// ── _enFmtStint ───────────────────────────────────────────────────────────
console.log('\n_enFmtStint');
test('null → "0:00"',      () => strictEqual(_enFmtStint(null), '0:00'));
test('90000ms → "1:30"',   () => strictEqual(_enFmtStint(90000), '1:30'));
test('600000ms → "10:00"', () => strictEqual(_enFmtStint(600000), '10:00'));

// ── _enDeltaColor ─────────────────────────────────────────────────────────
console.log('\n_enDeltaColor');
test('null → color neutro oscuro', () => strictEqual(_enDeltaColor(null), '#2d2f38'));
test('d < -0.5 → púrpura (muy rápido)', () => strictEqual(_enDeltaColor(-0.6), '#c084fc'));
test('d < -0.2 → verde',               () => strictEqual(_enDeltaColor(-0.3), '#22c55e'));
test('d < 0.2 → gris (neutral)',        () => strictEqual(_enDeltaColor(0.1), '#9ca3af'));
test('d < 0.5 → amarillo',             () => strictEqual(_enDeltaColor(0.3), '#fbbf24'));
test('d >= 0.5 → rojo (muy lento)',    () => strictEqual(_enDeltaColor(0.5), '#ef4444'));

// ── _enCleanLaps ──────────────────────────────────────────────────────────
console.log('\n_enCleanLaps');
test('null → []',                      () => deepEqual(_enCleanLaps(null), []));
test('menos de 2 → []',                () => deepEqual(_enCleanLaps([62.1]), []));
test('filtra vueltas ≥ 180s',          () => deepEqual(_enCleanLaps([62, 180, 63, 200]), [62, 63]));
test('filtra outliers > mediana + 2s', () => deepEqual(_enCleanLaps([62, 63, 62.5, 120]), [62, 63, 62.5]));
test('vueltas normales no se tocan',   () => deepEqual(_enCleanLaps([62, 63, 62.5, 61.8]), [62, 63, 62.5, 61.8]));

// ── _enCons ───────────────────────────────────────────────────────────────
console.log('\n_enCons');
test('menos de 2 vueltas limpias → null', () => strictEqual(_enCons([62.1]), null));
test('devuelve objeto con label y color',  () => {
  const r = _enCons([62, 62.1, 62.2, 62.05, 62.15]);
  ok(typeof r === 'object' && r !== null, 'debe ser objeto');
  ok('label' in r, 'debe tener .label');
  ok('color' in r, 'debe tener .color');
});
test('NO devuelve número (bug histórico)',  () => ok(typeof _enCons([62, 62.1, 62.2]) !== 'number'));
test('rango < 0.3 → Muy regular',          () => strictEqual(_enCons([62.1, 62.2, 62.15, 62.25, 62.1]).label, 'Muy regular'));
test('rango 0.3-0.5 → Regular',            () => strictEqual(_enCons([62.0, 62.4, 62.2, 62.35, 62.1]).label, 'Regular'));
test('rango 0.5-1.0 → Irregular',          () => strictEqual(_enCons([62.0, 62.7, 62.3, 62.8, 62.1]).label, 'Irregular'));
test('rango > 1.0 → Errático',             () => strictEqual(_enCons([60, 62, 59, 63, 61]).label, 'Errático'));

// ── _enAvg5 ───────────────────────────────────────────────────────────────
console.log('\n_enAvg5');
test('null → null',               () => strictEqual(_enAvg5(null), null));
test('menos de 2 vueltas → null', () => strictEqual(_enAvg5([62.1]), null));
test('calcula media de últimas 5', () => {
  const hist = [60, 62, 63, 62, 61, 62]; // last 5 clean: [62,63,62,61,62] → avg=62
  strictEqual(_enAvg5(hist), 62);
});
test('excluye outliers antes de calcular', () => {
  const hist = [62, 62.1, 62.2, 62.0, 200, 62.3]; // 200 se filtra
  ok(_enAvg5(hist) < 63, 'no debe incluir la vuelta de 200s');
});

// ── _enTrend ──────────────────────────────────────────────────────────────
console.log('\n_enTrend');
test('menos de 6 vueltas → flecha vacía', () => strictEqual(_enTrend([62, 63, 62]).arrow, ''));
test('mejorando → ↑ verde',               () => {
  const r = _enTrend([63, 63.2, 63.1, 62.5, 62.3, 62.4]); // recientes más rápidas
  strictEqual(r.arrow, '↑');
  strictEqual(r.color, '#22c55e');
});
test('empeorando → ↓ rojo', () => {
  const r = _enTrend([62.3, 62.4, 62.5, 63.1, 63.2, 63]);
  strictEqual(r.arrow, '↓');
  strictEqual(r.color, '#ef4444');
});
test('estable → →', () => {
  const r = _enTrend([62.1, 62.2, 62.0, 62.1, 62.2, 62.0]);
  strictEqual(r.arrow, '→');
});

// ── Resultado ─────────────────────────────────────────────────────────────
console.log(`\n${passed} pasados, ${failed} fallados`);
if (failed) process.exit(1);
