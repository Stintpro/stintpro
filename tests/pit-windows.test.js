// StintPro — tests del motor de ventanas de parada y detección de olas
// (en-pit-windows.js). Ejecutar: node tests/pit-windows.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert');
const W = require('../src/en-pit-windows');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const MIN = 60 * 1000;
const NO_MAX = 999 * MIN;

// Contexto base: stint máx 40', mín 15', parada 120s, 5 paradas totales, 60' restantes.
const baseCtx = () => ({
  stintMaxMs: 40 * MIN,
  stintMinMs: 15 * MIN,
  pitDurationMs: 120 * 1000,
  totalStops: 5,
  remainingMs: 60 * MIN,
  nowMs: 0,
});

// ── computeWindow: ventana de parada por rival ────────────────────────────
console.log('\n▸ computeWindow\n');

test('rival que ya cumplió el stint mínimo → canPitNow true, minUntilCanPit null', () => {
  const w = W.computeWindow({ dorsal: '7', quality: 'good', elapsedMs: 20 * MIN, standsCount: 2 }, baseCtx());
  strictEqual(w.canPitNow, true);
  strictEqual(w.minUntilCanPit, null);
});

test('rival que aún no cumple el mínimo → canPitNow false + minUntilCanPit', () => {
  const w = W.computeWindow({ dorsal: '7', quality: 'bad', elapsedMs: 10 * MIN, standsCount: 2 }, baseCtx());
  strictEqual(w.canPitNow, false);
  strictEqual(w.minUntilCanPit, 5); // faltan 5 min para los 15
});

test('sin stint máximo configurado → remaining Infinity, minLeft null', () => {
  const ctx = { ...baseCtx(), stintMaxMs: NO_MAX };
  const w = W.computeWindow({ dorsal: '7', quality: 'neutral', elapsedMs: 20 * MIN, standsCount: 2 }, ctx);
  strictEqual(w.remainingMs, Infinity);
  strictEqual(w.minLeft, null);
});

test('sin deuda de paradas (standsCount 0) → techo = stint máximo', () => {
  const w = W.computeWindow({ dorsal: '7', quality: 'good', elapsedMs: 10 * MIN, standsCount: 0 }, baseCtx());
  strictEqual(w.capMs, 40 * MIN);
  strictEqual(w.remainingMs, 30 * MIN); // 40 - 10
  strictEqual(w.minLeft, 30);
});

test('la deuda de paradas recorta el techo por debajo del máximo (debtLimited)', () => {
  // stopsLeft = 5-1 = 4; cap = 10' + 60' - 4*(2'+15') = 70' - 68' = 2'
  const w = W.computeWindow({ dorsal: '7', quality: 'good', elapsedMs: 10 * MIN, standsCount: 1 }, baseCtx());
  strictEqual(w.capMs, 2 * MIN);
  strictEqual(w.debtLimited, true);
  strictEqual(w.minLeft, 0); // max(0, 2'-10') = 0
});

// ── detectWaves: agrupar rivales en olas ──────────────────────────────────
console.log('\n▸ detectWaves\n');

const mkWin = (dorsal, minLeft, quality = 'neutral') => ({ dorsal, quality, minLeft, remainingMs: minLeft * MIN, inPit: false });

test('dos grupos de 3 separados forman dos olas (umbral por defecto 3)', () => {
  const wins = [mkWin('1', 2), mkWin('2', 3), mkWin('3', 4), mkWin('4', 12), mkWin('5', 13), mkWin('6', 14)];
  const { waves } = W.detectWaves(wins, { bandwidthMin: 5 });
  strictEqual(waves.length, 2);
  strictEqual(waves[0].count, 3);
  strictEqual(waves[0].earliestMin, 2);
  strictEqual(waves[1].earliestMin, 12);
});

test('cluster de 2 NO forma ola con el umbral por defecto (min 3) → singletons', () => {
  const wins = [mkWin('1', 2), mkWin('2', 3)];
  const { waves, singletons } = W.detectWaves(wins, { bandwidthMin: 5 });
  strictEqual(waves.length, 0);
  strictEqual(singletons.length, 2);
});

test('minSize:2 permite olas de 2 (parámetro configurable)', () => {
  const wins = [mkWin('1', 2), mkWin('2', 3)];
  const { waves } = W.detectWaves(wins, { bandwidthMin: 5, minSize: 2 });
  strictEqual(waves.length, 1);
  strictEqual(waves[0].count, 2);
});

test('karts demasiado separados no forman ola → singletons', () => {
  const wins = [mkWin('1', 2), mkWin('2', 20)];
  const { waves, singletons } = W.detectWaves(wins, { bandwidthMin: 5 });
  strictEqual(waves.length, 0);
  strictEqual(singletons.length, 2);
});

test('la composición cuenta la calidad de los karts de la ola', () => {
  const wins = [mkWin('1', 2, 'good'), mkWin('2', 3, 'good'), mkWin('3', 4, 'bad')];
  const { waves } = W.detectWaves(wins, { bandwidthMin: 5 });
  strictEqual(waves.length, 1);
  strictEqual(waves[0].count, 3);
  deepStrictEqual(waves[0].composition, { good: 2, neutral: 0, bad: 1, unknown: 0 });
});

test('excluye a los que están en boxes (ya están parando)', () => {
  const wins = [mkWin('1', 2), { ...mkWin('2', 3), inPit: true }, mkWin('3', 4), mkWin('5', 5)];
  const { waves } = W.detectWaves(wins, { bandwidthMin: 5 });
  strictEqual(waves[0].count, 3);
  ok(!waves[0].karts.some(k => k.dorsal === '2'), 'el kart en boxes no debe estar en la ola');
});

test('ignora ventanas sin minLeft (sin stint máximo)', () => {
  const wins = [mkWin('1', 2), { dorsal: '9', quality: 'neutral', minLeft: null, inPit: false }, mkWin('3', 3), mkWin('4', 4)];
  const { waves } = W.detectWaves(wins, { bandwidthMin: 5 });
  strictEqual(waves[0].count, 3);
});

// ── nextWave: para el KPI de cabecera ─────────────────────────────────────
console.log('\n▸ nextWave\n');

test('nextWave devuelve la ola más inminente', () => {
  const wins = [mkWin('1', 12), mkWin('2', 13), mkWin('3', 14), mkWin('4', 2), mkWin('5', 3), mkWin('6', 4)];
  const { waves } = W.detectWaves(wins, { bandwidthMin: 5 });
  const nx = W.nextWave(waves);
  strictEqual(nx.earliestMin, 2);
  strictEqual(nx.count, 3);
});

test('sin olas → nextWave null', () => {
  const { waves } = W.detectWaves([mkWin('1', 2)], { bandwidthMin: 5 });
  strictEqual(W.nextWave(waves), null);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
