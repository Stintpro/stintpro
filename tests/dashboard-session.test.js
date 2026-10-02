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

console.log('\n▸ Sesión nueva en la misma conexión (STRATEGY-3)\n');

// Clasificación con el panel abierto: todos acaban en boxes; luego Apex abre la carrera.
function qualyThenRace() {
  const D = makeDashboard();
  D.open({ ...cfgBase(), stintMax: 40, stintMin: 10 });
  D.run('EnBox.totalStops=6; EnBox.pitDuration=180; EnBox._pitDurUserSet=true; EnBox.config={type:"battery",positions:6,columns:2}');
  const rivals = (pit) => [1, 2, 3].map((d) => ({ dorsal: String(d), name: 'R' + d, pos: d + 1, pit, pitState: pit ? 'in' : null, tours: 5, lastLap: 66, lapHistory: [66, 66, 66] }));
  D.feed({ equipos: [kart({ tours: 5 }), ...rivals(false)] });
  D.run('EnSession.stintStart=Date.now()-10*60000');
  D.feed({ equipos: [kart({ pit: true, pitState: 'in', tours: 5 }), ...rivals(true)] });   // fin de qualy: todos a boxes
  return D;
}

test('al abrir sesión nueva se reinicia el estado de carrera, no la configuración', () => {
  const D = qualyThenRace();
  strictEqual(D.run('EnSession.stintHistory.length'), 1, 'precondición: el stint de la qualy');
  D.newSession();
  strictEqual(D.run('EnSession.stintHistory.length'), 0);
  strictEqual(D.run('Object.keys(EnSession.pitCounts).length'), 0);
  strictEqual(D.run('Object.keys(EnSession.rivalPitOut).length'), 0);
  strictEqual(D.run('EnSession.stintStart'), null);
  strictEqual(D.run('EnSession.stintFrozen'), null);
  strictEqual(D.run('EnSession.raceStart'), null);
  // La configuración del usuario se queda
  strictEqual(D.run('EnBox.totalStops'), 6);
  strictEqual(D.run('EnBox.pitDuration'), 180);
  strictEqual(D.run('EnBox.config.type'), 'battery');
  strictEqual(D.run('window.AppState.config.stintMax'), 40);
});

test('tras la sesión nueva, la parrilla de la carrera no cuenta como salida de boxes', () => {
  const D = qualyThenRace();
  D.newSession();
  const grid = [1, 2, 3].map((d) => ({ dorsal: String(d), name: 'R' + d, pos: d + 1, pit: false, pitState: null, tours: 0, lastLap: null, lapHistory: [] }));
  D.feed({ equipos: [kart({ tours: 0, lastLap: null }), ...grid] });
  strictEqual(D.run('Object.keys(EnSession.rivalPitOut).length'), 0, JSON.stringify(D.run('EnSession.rivalPitOut')));
  const G = D.now() + 23 * MIN; D.setNow(G);
  D.feed({ equipos: [kart({ tours: 0, lastLap: null }), ...grid], raceStart: { at: G, source: 'com' } });
  strictEqual(D.run('EnSession.stintStart'), G, 'mi stint arranca con la verde de la carrera');
});

test('el historial de la sesión anterior queda archivado y se puede recuperar', () => {
  const D = qualyThenRace();
  D.newSession();
  strictEqual(D.run('EnSession.stintHistory.length'), 0);
  D.run('_enRecoverArchivedStints()');
  strictEqual(D.run('EnSession.stintHistory.length'), 1);
});

console.log('\n▸ Conectar tarde vía logger: calidad de la cola (STRATEGY-4)\n');

// Rival 5: primer stint con un kart NEUTRO (10 vueltas a 66.0), para, y ahora lleva
// un kart RÁPIDO (10 vueltas a 63.0). El kart que dejó en el box es el neutro.
function lateJoin({ withLapIdx, leftLaps = 66.0, nowLaps = 63.0, stintLapCount = 10 }) {
  const D = makeDashboard();
  D.open({ ...cfgBase(), stintMax: 40, stintMin: 10 });
  D.run('EnBox.config={type:"line",positions:4,columns:2}');
  const t0 = D.now() - 60 * MIN;
  const field = ['1', '2', '3'].map((d) => ({ dorsal: d, name: 'R' + d, pos: +d, pit: false, pitState: null, tours: 20, lastLap: 66, lapHistory: Array(20).fill(66.0) }));
  const r5 = { dorsal: '5', name: 'R5', pos: 4, pit: false, pitState: null, tours: 20, lastLap: nowLaps,
    lapHistory: [...Array(10).fill(leftLaps), ...Array(stintLapCount).fill(nowLaps)], stintLapCount };
  const ev = (event, time) => ({ dorsal: '5', event, time, ...(withLapIdx ? { lapIdx: 10 } : {}) });
  D.feed({ _isHistory: true, equipos: [kart({ tours: 20 }), ...field, r5],
    pitEvents: [ev('in', t0 + 11 * MIN), ev('out', t0 + 14 * MIN)] });
  return D;
}
const qOf5 = (D) => D.run('EnBox.queue').find((k) => k.dorsal === '5');

test('el kart que dejó el rival en el box lleva la calidad de SU stint, no la del kart actual', () => {
  const D = lateJoin({ withLapIdx: true });
  strictEqual(qOf5(D).quality, 'neutral');
});

test('sin el dato de la vuelta de cada parada (logger antiguo) queda "sin info", no se inventa', () => {
  const D = lateJoin({ withLapIdx: false });
  strictEqual(qOf5(D).quality, 'unknown');
});

test('la calidad del kart actual del rival no hereda una siembra del historial entero', () => {
  // Dejó un kart rápido y lleva uno neutro: su kart actual NO debe salir bueno.
  const D = lateJoin({ withLapIdx: true, leftLaps: 63.0, nowLaps: 66.0, stintLapCount: 3 });
  const e5 = JSON.stringify(D.run('EnSession.data.equipos').find((e) => e.dorsal === '5'));
  strictEqual(D.run(`_enEffectiveQuality("5", ${e5}, _enTrackAvgLive(EnSession.data.equipos))`), 'neutral');
});

console.log('\n▸ Paradas del rival en Olas y Previsión (TESTS-4)\n');

// Circuito sin columna de paradas (standsCount 0). 11 paradas, stint máx 75', mín 10',
// parada 2', quedan 120' de cuenta atrás. El rival 7 lleva 4 paradas contadas por la
// app y 20' de stint → con su deuda le quedan 36 min (sin ella, 55).
function rivalScenario({ seenFromStart }) {
  const D = makeDashboard();
  D.open({ slug: 'lemans', myDorsal: '12', pilotos: [], stintMax: 75, stintMin: 10 });
  D.run('EnBox.totalStops=11; EnBox.pitDuration=120');
  const e7 = { dorsal: '7', name: 'RIVAL', pos: 2, pit: false, pitState: null, tours: 0, lastLap: seenFromStart ? null : 66.1, lapHistory: [], standsCount: 0 };
  D.feed({ equipos: [kart({ lastLap: seenFromStart ? null : 66.1 }), e7] });   // primer dato: ¿ya rodaban?
  D.run('ApexClock.sync(120*60000, "countdown")');
  D.run(`EnSession.pitCounts["7"]=4; EnSession.rivalPitOut["7"]=Date.now()-20*60000`);
  return D;
}

test('TESTS-4: Olas cuenta las paradas que vio la app si no hay columna oficial', () => {
  const D = rivalScenario({ seenFromStart: true });
  const w = D.run('_enComputeWaves(EnSession.data.equipos, 66).windows').find((x) => x.dorsal === '7');
  strictEqual(w.minLeft, 36); strictEqual(w.debtLimited, true);
});

test('TESTS-4: conectando tarde (paradas contadas incompletas) no usa ese conteo corto', () => {
  const D = rivalScenario({ seenFromStart: false });
  const w = D.run('_enComputeWaves(EnSession.data.equipos, 66).windows').find((x) => x.dorsal === '7');
  strictEqual(w.minLeft, 55);
});

test('TESTS-4: la Previsión de box usa el mismo conteo que Olas', () => {
  const D = rivalScenario({ seenFromStart: true });
  strictEqual(D.run('_enRivalStops(EnSession.data.equipos.find(e=>e.dorsal==="7"))'), 4);
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
