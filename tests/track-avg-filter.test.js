'use strict';
// Tests para el filtro de la media de pista (_enTrackAvgLive):
//   · exclusión por dorsal (ya existía)
//   · exclusión por categoría (nuevo)
// Run: node tests/track-avg-filter.test.js

const assert = require('assert');
const { _enCleanLaps, _enAvg5 } = require('../src/analysis');

// Globals que en-state.js usa como si fueran del browser
global._enCleanLaps = _enCleanLaps;
global._enAvg5      = _enAvg5;

const { _enTrackAvgLive, EnUi } = require('../src/en-state');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}
function group(name, fn) { console.log(`\n${name}`); fn(); }

function reset() {
  EnUi.excludedFromAvg   = {};
  EnUi.excludedCategories = {};
}

// Kart con 3 vueltas idénticas → _enAvg5 = lap exacto (independiente del recorte)
function kart(dorsal, lap, category = null) {
  return { dorsal, name: 'P' + dorsal, lapHistory: [lap, lap, lap], pit: false, pitState: null, category };
}

group('Exclusión por categoría', () => {
  test('sin exclusión: mezcla ambas clases', () => {
    reset();
    // A@60 ×2, B@70 ×2 → recorte 10% deja [60,70] → media 65
    const eq = [kart('1', 60, 'A'), kart('2', 60, 'A'), kart('3', 70, 'B'), kart('4', 70, 'B')];
    assert.strictEqual(_enTrackAvgLive(eq), 65);
  });

  test('excluir categoría B → solo cuenta A', () => {
    reset();
    EnUi.excludedCategories = { B: true };
    const eq = [kart('1', 60, 'A'), kart('2', 60, 'A'), kart('3', 70, 'B'), kart('4', 70, 'B')];
    assert.strictEqual(_enTrackAvgLive(eq), 60);
  });

  test('kart SIN categoría no se excluye al excluir una clase', () => {
    reset();
    EnUi.excludedCategories = { A: true };
    // Excluida A; los sin categoría (80) deben seguir contando
    const eq = [kart('1', 60, 'A'), kart('2', 60, 'A'), kart('3', 80, null), kart('4', 80, null)];
    assert.strictEqual(_enTrackAvgLive(eq), 80);
  });
});

group('Exclusión por dorsal (regresión)', () => {
  test('excluir un dorsal lo deja fuera', () => {
    reset();
    EnUi.excludedFromAvg = { '3': true };
    // Fuera el #3 (70) → quedan [60,60,70] → recorte deja [60] media 60
    const eq = [kart('1', 60, 'A'), kart('2', 60, 'A'), kart('3', 70, 'B')];
    assert.strictEqual(_enTrackAvgLive(eq), 60);
  });

  test('dorsal y categoría se combinan', () => {
    reset();
    EnUi.excludedCategories = { B: true };
    EnUi.excludedFromAvg   = { '2': true };
    // Fuera clase B (#3,#4) y dorsal #2 → queda solo #1 (60) → N<2 → null
    const eq = [kart('1', 60, 'A'), kart('2', 60, 'A'), kart('3', 70, 'B'), kart('4', 70, 'B')];
    assert.strictEqual(_enTrackAvgLive(eq), null);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
