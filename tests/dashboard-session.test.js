// StintPro — estado del dashboard endurance entre sesiones, recargas y vuelta al setup.
// Carga el dashboard real en un vm (tests/helpers/dashboard.js).
// Ejecutar: node tests/dashboard-session.test.js
'use strict';

const { strictEqual, ok, notStrictEqual } = require('assert');
const makeDashboard = require('./helpers/dashboard');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const MIN = 60 * 1000, H = 60 * MIN;
const KEY = 'stintpro_racestate_v1';
const cfgBase = () => ({ slug: 'lossantos', myDorsal: '12', pilotos: [{ name: 'Ana' }, { name: 'Luis' }], stintMax: 40, stintMin: 10 });
const kart = (over) => Object.assign({ dorsal: '12', name: 'MI EQUIPO', pos: 3, pit: false, pitState: null, tours: 10, lastLap: 66.1, lapHistory: [] }, over || {});

console.log('\n▸ Fin de sesión y recuperación\n');

test('APP-1: una clasificación terminada no marca la carrera siguiente como terminada', () => {
  const D = makeDashboard();
  D.open(cfgBase());
  D.feed({ equipos: [kart()], sessionFinished: true });   // fin de la qualy (light|lf)
  D.feed({ equipos: [kart()], sessionFinished: false });  // parrilla de la carrera
  D.run('EnSession.stintHistory.push({pilot:"Ana",durationMs:20*60000})');
  D.run('_enSaveRaceState()');
  strictEqual(JSON.parse(D.store[KEY]).finished, false);
});

test('APP-1: una carrera que de verdad termina se guarda como terminada', () => {
  const D = makeDashboard();
  D.open(cfgBase());
  D.feed({ equipos: [kart()], sessionFinished: true });
  D.run('_enSaveRaceState()');
  strictEqual(JSON.parse(D.store[KEY]).finished, true);
});

console.log('\n▸ Volver al setup\n');

test('APP-6: "← Setup" en plena carrera pide confirmación y, si cancelas, no toca nada', () => {
  const D = makeDashboard();
  D.open(cfgBase());
  D.run('EnSession.stintStart=Date.now()-10*60000; EnSession.stintHistory.push({pilot:"Ana",durationMs:20*60000}); _enSaveRaceState()');
  let asked = 0;
  D.ctx.confirm = () => { asked++; return false; };
  D.run('_enGoBack()');
  strictEqual(asked, 1, 'debe preguntar');
  strictEqual(D.run('EnSession.stintHistory.length'), 1, 'no debe borrar el historial');
  ok(D.store[KEY], 'no debe borrar el guardado');
});

test('APP-6: si confirmas, el guardado se conserva para poder reanudar', () => {
  const D = makeDashboard();
  D.open(cfgBase());
  D.run('EnSession.stintStart=Date.now()-10*60000; EnSession.stintHistory.push({pilot:"Ana",durationMs:20*60000}); _enSaveRaceState()');
  D.ctx.confirm = () => true;
  D.run('_enGoBack()');
  ok(D.store[KEY], 'el snapshot sigue ahí → banner "Reanudar carrera"');
  strictEqual(JSON.parse(D.store[KEY]).en.stintHistory.length, 1);
});

test('APP-6: sin carrera en marcha no pregunta', () => {
  const D = makeDashboard();
  D.open(cfgBase());
  let asked = 0;
  D.ctx.confirm = () => { asked++; return true; };
  D.run('_enGoBack()');
  strictEqual(asked, 0);
});

test('APP-5: la carrera siguiente no hereda la salida, bandera ni eventos de la anterior', () => {
  const D = makeDashboard();
  D.open(cfgBase());
  D.feed({ equipos: [kart()], raceStart: { at: D.now() - 3 * H, source: 'com' }, flag: 'red', raceStopped: true, raceEvents: [{ type: 'stopped', time: D.now() }] });
  D.run('_enGoBack()');
  D.open(cfgBase());
  strictEqual(D.run('EnSession.raceStart'), null);
  strictEqual(D.run('EnSession.flag'), null);
  strictEqual(D.run('EnSession.raceStopped'), false);
  strictEqual(D.run('EnSession.raceEvents.length'), 0);
  D.tick();
  strictEqual(D.run('EnSession.stintStart'), null, 'el stint no debe anclarse a la salida de la sesión anterior');
});

console.log('\n▸ Conectar tarde: timer de MI stint\n');

test('STRATEGY-2: con paradas oficiales y mi pit-out conocido, el stint arranca en mi pit-out', () => {
  const D = makeDashboard();
  D.open(cfgBase());
  const out = D.now() - 25 * MIN;
  D.feed({ _isHistory: true, equipos: [kart({ standsCount: 2 })], raceStart: { at: D.now() - 3 * H, source: 'com' },
    pitEvents: [{ dorsal: '12', event: 'in', time: D.now() - 90 * MIN }, { dorsal: '12', event: 'out', time: D.now() - 88 * MIN },
      { dorsal: '12', event: 'in', time: out - 2 * MIN }, { dorsal: '12', event: 'out', time: out }] });
  D.tick();
  strictEqual(D.run('EnSession.stintStart'), out);
});

test('STRATEGY-2: con paradas oficiales y sin pit-out conocido, no se ancla a la salida de carrera', () => {
  const D = makeDashboard();
  D.open(cfgBase());
  const raceAt = D.now() - 3 * H;
  D.feed({ equipos: [kart({ standsCount: 2 })], raceStart: { at: raceAt, source: 'com' } });
  D.tick();
  notStrictEqual(D.run('EnSession.stintStart'), raceAt);
});

test('STRATEGY-2: sin paradas (primer stint) sí se ancla a la salida oficial', () => {
  const D = makeDashboard();
  D.open(cfgBase());
  const raceAt = D.now() - 30 * MIN;
  D.feed({ equipos: [kart({ standsCount: 0 })], raceStart: { at: raceAt, source: 'com' } });
  strictEqual(D.run('EnSession.stintStart'), raceAt);
});

console.log('\n▸ Recarga con el kart en boxes\n');

test('TESTS-2: reanudar con mi kart parado no duplica el stint', () => {
  const D = makeDashboard();
  D.open(cfgBase());
  D.feed({ equipos: [kart({ pitState: null })] });
  D.run('EnSession.stintStart=Date.now()-40*60000');
  D.feed({ equipos: [kart({ pit: true, pitState: 'in', standsCount: 1 })] });   // pit in → guarda el stint
  strictEqual(D.run('EnSession.stintHistory.length'), 1);
  const frozen = D.run('EnSession.stintFrozen');
  D.run('_enSaveRaceState()');
  const snap = JSON.parse(D.store[KEY]);
  // Recarga: otra pestaña, mismo localStorage
  const D2 = makeDashboard({ now: D.now() + 90 * 1000 });
  Object.assign(D2.store, D.store);
  D2.ctx.AppState.config = snap.cfg;
  D2.run('_enApplyRaceState(' + JSON.stringify(snap) + ')');
  D2.feed({ equipos: [kart({ pit: true, pitState: 'in', standsCount: 1 })] });
  strictEqual(D2.run('EnSession.stintHistory.length'), 1, 'no debe volver a disparar el pit in');
  strictEqual(D2.run('EnSession.stintFrozen'), frozen, 'el reloj congelado no debe crecer');
});

console.log('\n▸ Vueltas del stint\n');

test('APP-13: el primer stint cuenta todas las vueltas desde la salida', () => {
  const D = makeDashboard();
  D.open(cfgBase());
  D.run('EnSession.stintStart=Date.now()-10*60000');
  strictEqual(D.run('_enStintLaps(' + JSON.stringify(kart({ tours: 1 })) + ')'), 1);
  strictEqual(D.run('_enStintLaps(' + JSON.stringify(kart({ tours: 9 })) + ')'), 9);
});

test('APP-13: tras una parada cuenta desde las vueltas del pit-out', () => {
  const D = makeDashboard();
  D.open(cfgBase());
  D.run('EnSession.stintStart=Date.now(); EnSession.data._stintStartTours=20');
  strictEqual(D.run('_enStintLaps(' + JSON.stringify(kart({ tours: 26, standsCount: 1 })) + ')'), 6);
});

console.log('\n▸ Configuración\n');

test('STRATEGY-11: el dorsal de la barra de Estrategia se guarda sin espacios', () => {
  const D = makeDashboard();
  D.open(cfgBase());
  D.run('_enUpdateCfg("myDorsal", " 12 ")');
  strictEqual(D.run('window.AppState.config.myDorsal'), '12');
});

console.log(`\n${passed} pasan, ${failed} fallan\n`);
process.exit(failed ? 1 : 0);
