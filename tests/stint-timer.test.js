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

// ── Flancos y hooks en VARIOS ticks (TESTS-3) ────────────────────────────────
// Apex mantiene pitState 'in'/'out' durante muchos snapshots: la máquina debe
// reaccionar UNA vez por transición, no en cada tick.
console.log('\n▸ Flancos en varios ticks\n');

function hooksSpy() {
  const h = { pitIn: 0, pitOut: 0, save: 0 };
  return { h, hooks: { onPitIn: () => h.pitIn++, onPitOut: () => h.pitOut++, onSave: () => h.save++ } };
}

test("3 ticks seguidos en 'in': onPitIn una sola vez y el congelado no cambia", () => {
  const S = newSession({ stintStart: 1000 });
  const { h, hooks } = hooksSpy();
  updateMyStintState(myKart({ pit: true, pitState: 'in' }), S, 41000, hooks);
  const frozen = S.stintFrozen;
  updateMyStintState(myKart({ pit: true, pitState: 'in' }), S, 43000, hooks);
  updateMyStintState(myKart({ pit: true, pitState: 'in' }), S, 45000, hooks);
  strictEqual(h.pitIn, 1);
  strictEqual(S.stintFrozen, frozen);
  strictEqual(frozen, 40000);
});

test("3 ticks seguidos en 'out': el stint arranca en el PRIMERO y onPitOut una sola vez", () => {
  const S = newSession({ stintStart: 1000, stintFrozen: 40000, _myPitInDetected: true });
  S.data._myWasIn = true;
  const { h, hooks } = hooksSpy();
  updateMyStintState(myKart({ pit: true, pitState: 'out', tours: 30 }), S, 200000, hooks);
  updateMyStintState(myKart({ pit: true, pitState: 'out', tours: 30 }), S, 202000, hooks);
  updateMyStintState(myKart({ pit: true, pitState: 'out', tours: 30 }), S, 204000, hooks);
  strictEqual(S.stintStart, 200000);
  strictEqual(S.stintFrozen, null);
  strictEqual(h.pitOut, 1);
  ok(h.save >= 1, 'debe guardar el estado');
});

test("tras el 'out' se reinician las vueltas, la mejor vuelta y la base del contador", () => {
  const S = newSession({ stintStart: 1000, stintFrozen: 40000, _myPitInDetected: true,
    stintBestLap: 64.1, stintLapTimes: [65, 64.1] });
  S.data._lastMyLap = 64.1;
  updateMyStintState(myKart({ pit: true, pitState: 'out', tours: 30, pos: 4 }), S, 200000);
  strictEqual(S.data._stintStartTours, 30);
  strictEqual(S.stintBestLap, null);
  strictEqual(S.stintLapTimes.length, 0);
  strictEqual(S.data._lastMyLap, null);
  strictEqual(S.posIn, 4);
});

test("fallback in→null: también reinicia mejor vuelta y vueltas del stint", () => {
  const S = newSession({ stintStart: 1000, stintFrozen: 40000, _myPitInDetected: true,
    stintBestLap: 64.1, stintLapTimes: [65, 64.1] });
  S.data._lastMyLap = 64.1;
  updateMyStintState(myKart({ pit: false, pitState: null }), S, 200000);
  strictEqual(S.stintStart, 200000);
  strictEqual(S.stintBestLap, null);
  strictEqual(S.stintLapTimes.length, 0);
  strictEqual(S.data._lastMyLap, null);
});

test("in → sr → in: la segunda parada vuelve a disparar onPitIn (el flanco se rearma)", () => {
  const S = newSession({ stintStart: 1000 });
  const { h, hooks } = hooksSpy();
  updateMyStintState(myKart({ pit: true, pitState: 'in' }), S, 41000, hooks);
  updateMyStintState(myKart({ pit: true, pitState: 'out' }), S, 221000, hooks);
  updateMyStintState(myKart({ pit: false, pitState: null }), S, 230000, hooks);
  updateMyStintState(myKart({ pit: true, pitState: 'in' }), S, 2600000, hooks);
  strictEqual(h.pitIn, 2);
});

console.log(`\n${failed === 0 ? '✅' : '❌'}  ${passed} pasados, ${failed} fallados\n`);
process.exit(failed === 0 ? 0 : 1);
