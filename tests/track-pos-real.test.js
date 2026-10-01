// StintPro — validación del mapa de pista con una carrera REAL: 7H Los Santos
// (sesión 2314 del logger, [dorsal, lapMs, ts], sin nombres). Mide cuánto se
// equivoca el motor al prever cada pase por meta con el ritmo del kart.
// Medido el 2026-10-01: mediana 0,20 s · p90 0,66 s.
// Ejecutar: node tests/track-pos-real.test.js
'use strict';

const { ok } = require('assert');
const P = require('../src/en-track-pos');
const laps = require('./fixtures/traffic-2314.json');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const T0 = 1790000000000;           // origen arbitrario: el motor solo usa diferencias
const engine = P.createTrackPos({ errRing: Infinity });
const state = new Map();            // dorsal → entrada de getState().equipos
laps.forEach(([d, ms, ts]) => {
  let e = state.get(d);
  if (!e) { e = { dorsal: d, teamName: '#' + d, lapHistory: [], lastLapAt: 0, lastLap: null, pit: false, pitS: 0 }; state.set(d, e); }
  e.lapHistory.push(ms / 1000);
  e.lastLap = ms / 1000;
  e.lastLapAt = T0 + ts;
  engine.update([...state.values()], T0 + ts);
});
const st = engine.errorStats();
console.log(`\n  ${laps.length} pases · ${st.n} medidos · mediana ${st.medianS.toFixed(3)} s · p90 ${st.p90S.toFixed(3)} s\n`);

test('hay muestra (> 5.000 pases medidos)', () => ok(st.n > 5000, `n ${st.n}`));
test('mediana del error ≤ 0,35 s', () => ok(st.medianS <= 0.35, `mediana ${st.medianS}`));
test('p90 del error ≤ 1,0 s', () => ok(st.p90S <= 1.0, `p90 ${st.p90S}`));

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
