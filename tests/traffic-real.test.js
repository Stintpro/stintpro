// StintPro — validación del motor de tráfico con una carrera REAL: 7H Los
// Santos (sesión 2314 del logger), solo [dorsal, lapMs, ts relativo], sin
// nombres. Comprueba que el motor reproduce el spike del 2026-09-29.
// Ejecutar: node tests/traffic-real.test.js
'use strict';

const { ok } = require('assert');
const T = require('../src/en-traffic');
const laps = require('./fixtures/traffic-2314.json');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const tr = T.createTraffic();
const count = { train: 0, blocked: 0, clean: 0 };
laps.forEach(([d, ms, ts]) => { count[tr.onCrossing(d, ms, ts).tag]++; });
const g = tr.giftToday();
const pct = k => 100 * count[k] / laps.length;
console.log(`\n  ${laps.length} vueltas · tren ${pct('train').toFixed(1)}% · bloqueo ${pct('blocked').toFixed(1)}% · regalo ${g.giftSec?.toFixed(3)} s (n ${g.nTrain}/${g.nClean})\n`);

test('hay muestra suficiente para el regalo', () => ok(g.nTrain >= 100 && g.nClean >= 100));
test('rebufo hoy entre −0,15 y −0,05 s', () => ok(g.giftSec >= -0.15 && g.giftSec <= -0.05, `gift ${g.giftSec}`));
test('tren entre 5 % y 40 % de las vueltas', () => ok(pct('train') >= 5 && pct('train') <= 40));
test('bloqueo minoritario (< tren)', () => ok(count.blocked < count.train));

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
