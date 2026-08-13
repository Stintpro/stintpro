// StintPro — tests de la máquina del timer de MI stint (en-stint-machine.js)
// Foco: la congelación del timer cuando Apex salta pitState 'in'→null sin muestrear 'out'.
// Ejecutar: node tests/stint-timer.test.js
'use strict';

const { strictEqual, ok } = require('assert');
const { updateMyStintState } = require('../src/en-stint-machine');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

// EnSession mínimo con los campos que toca la máquina
function newSession(over) {
  return Object.assign({
    stintStart: null,
    stintFrozen: null,
    _myPitInDetected: false,
    posIn: null,
    stintBestLap: null,
    stintLapTimes: [],
    stintHistory: [],
    currentPilot: 0,
    data: { equipos: [], _myWasIn: false, _myWasOut: false, _stintStartTours: 0, _lastMyLap: null },
  }, over || {});
}

// Kart de MI dorsal en un estado dado. pit = booleano "en boxes"; pitState = código discreto.
function myKart(over) {
  return Object.assign({ dorsal: '7', pit: false, pitState: null, pos: 5, tours: 10 }, over || {});
}

console.log('\n▸ Timer de mi stint — máquina de estados\n');

test('arranque limpio: sin pit no toca el timer', () => {
  const S = newSession({ stintStart: 1000 });
  updateMyStintState(myKart({ pitState: 'sr' }), S, 5000);
  strictEqual(S.stintFrozen, null, 'no debe congelar rodando');
  strictEqual(S._myPitInDetected, false);
});

test('pit IN real → congela el timer y marca _myPitInDetected', () => {
  const S = newSession({ stintStart: 1000 });
  updateMyStintState(myKart({ pit: true, pitState: 'in' }), S, 61000);
  strictEqual(S.stintFrozen, 60000, 'congela los 60s transcurridos');
  strictEqual(S._myPitInDetected, true, 'el freeze viene de un pit-in real');
});

test('pit OUT normal → descongela y reinicia el stint', () => {
  const S = newSession({ stintStart: 1000, stintFrozen: 60000, _myPitInDetected: true });
  S.data._myWasIn = true;
  updateMyStintState(myKart({ pitState: 'out', pos: 3, tours: 12 }), S, 200000);
  strictEqual(S.stintFrozen, null, 'pit out descongela');
  strictEqual(S.stintStart, 200000, 'reinicia el reloj del stint');
  strictEqual(S._myPitInDetected, false);
  strictEqual(S.posIn, 3);
});

// ── EL BUG ──────────────────────────────────────────────────────────────────
// Secuencia real: pit IN (congela) → siguiente snapshot el kart ya rueda con
// pitState=null (Apex no muestreó el 'out' transitorio). El timer debe reanudarse.
test('REGRESIÓN: pit IN → vuelve a pista SIN out (pitState null) → descongela', () => {
  const S = newSession({ stintStart: 1000 });

  // Tick 1: pit IN → congela
  updateMyStintState(myKart({ pit: true, pitState: 'in' }), S, 61000);
  strictEqual(S.stintFrozen, 60000, 'precondición: quedó congelado');

  // Tick 2: kart de vuelta en pista, Apex saltó directo a null (nunca vimos 'out')
  updateMyStintState(myKart({ pit: false, pitState: null }), S, 90000);

  strictEqual(S.stintFrozen, null, 'DEBE descongelar: el kart ya rueda otra vez');
  strictEqual(S.stintStart, 90000, 'arranca stint nuevo en el momento de reanudar');
  strictEqual(S._myPitInDetected, false, 'consume el flag para no re-disparar');
});

// ── EL CASO QUE NO DEBE TOCAR ────────────────────────────────────────────────
// Freeze de fin de sesión (countdown=0): stintFrozen puesto SIN _myPitInDetected.
// El fallback NO debe descongelarlo aunque el kart esté fuera de boxes.
test('fin de sesión (freeze sin _myPitInDetected) NO se descongela', () => {
  const S = newSession({ stintStart: 1000, stintFrozen: 120000, _myPitInDetected: false });
  updateMyStintState(myKart({ pit: false, pitState: 'sr' }), S, 500000);
  strictEqual(S.stintFrozen, 120000, 'el freeze legítimo de fin de sesión se mantiene');
});

console.log(`\n${failed === 0 ? '✅' : '❌'}  ${passed} pasados, ${failed} fallados\n`);
process.exit(failed === 0 ? 0 : 1);
