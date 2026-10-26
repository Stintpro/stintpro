// StintPro — tests de las coordenadas por circuito (src/circuits.js).
// Ejecutar: node tests/circuit-coords.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert');

global.window = {};
global.localStorage = { getItem: () => null, setItem: () => {} };
require('../src/circuits.js');
const DB = global.window.CircuitDB;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

test('coordsOf devuelve [lat, lon] de un circuito con coordenadas', () => {
  deepStrictEqual(DB.coordsOf('henakart'), [40.42828, -3.44353]);
});

test('coordsOf hereda por trackAliases (cronosystem2 → campillos)', () => {
  deepStrictEqual(DB.coordsOf('cronosystem2'), DB.coordsOf('campillos'));
});

test('coordsOf devuelve null para un slug desconocido o vacío', () => {
  strictEqual(DB.coordsOf('no-existe'), null);
  strictEqual(DB.coordsOf(''), null);
  strictEqual(DB.coordsOf(undefined), null);
});

test('todos los circuitos del catálogo embebido tienen coordenadas válidas', () => {
  for (const c of DB.list) {
    const xy = DB.coordsOf(c.slug);
    ok(xy, 'sin coordenadas: ' + c.slug);
    ok(xy[0] > 27 && xy[0] < 50 && xy[1] > -16 && xy[1] < 3, 'fuera de rango: ' + c.slug);
  }
});

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
