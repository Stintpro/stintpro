// StintPro — tests de la meteo (src/en-weather.js). Ejecutar: node tests/weather.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert');
const W = require('../src/en-weather');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 26, 10, 0);            // 10:00Z, inicio de un tramo
// Respuesta sintética: 13 tramos de 15 min desde T0 y 3 horas.
function resp(mm, prob) {
  return {
    minutely_15: { time: mm.map((_, i) => (T0 + i * 15 * MIN) / 1000), precipitation: mm },
    hourly: { time: prob.map((_, i) => (T0 + i * 60 * MIN) / 1000), precipitation_probability: prob },
  };
}
const DRY = new Array(13).fill(0);
const withMm = (i, v) => { const a = DRY.slice(); a[i] = v; return a; };

test('buildUrl pide minutely_15, probabilidad horaria y unixtime', () => {
  const u = W.buildUrl(40.1, -3.2);
  ok(u.startsWith('https://api.open-meteo.com/v1/forecast?latitude=40.1&longitude=-3.2'));
  for (const p of ['minutely_15=precipitation', 'hourly=precipitation_probability',
                   'forecast_minutely_15=12', 'past_minutely_15=1', 'forecast_hours=3', 'timeformat=unixtime'])
    ok(u.includes(p), 'falta ' + p);
});

test('seco → level null, sin ETA', () => {
  const r = W.rainRisk(resp(DRY, [5, 5, 5]), T0 + 5 * MIN);
  strictEqual(r.level, null); strictEqual(r.etaMin, null); strictEqual(r.probNextHour, 5);
});

test('lluvia de 0,3 mm a los 20 min → alto, ETA 20', () => {
  // ahora 10:10; el tramo 10:30 empieza en 20 min
  const r = W.rainRisk(resp(withMm(2, 0.3), [10, 10, 10]), T0 + 10 * MIN);
  strictEqual(r.level, 'high'); strictEqual(r.etaMin, 20);
});

test('lluvia de 0,3 mm a los 50 min → medio', () => {
  // ahora 10:10; el tramo 11:00 empieza en 50 min
  const r = W.rainRisk(resp(withMm(4, 0.3), [10, 10, 10]), T0 + 10 * MIN);
  strictEqual(r.level, 'medium'); strictEqual(r.etaMin, 50);
});

test('0,1 mm en el tramo actual → lloviendo', () => {
  const r = W.rainRisk(resp(withMm(0, 0.1), [10, 10, 10]), T0 + 5 * MIN);
  strictEqual(r.level, 'raining');
});

test('0,1 mm futuro no llega a riesgo (umbral 0,2) pero da ETA', () => {
  const r = W.rainRisk(resp(withMm(2, 0.1), [10, 10, 10]), T0 + 10 * MIN);
  strictEqual(r.level, null); strictEqual(r.etaMin, 20);
});

test('solo probabilidad: 60 % → alto sin ETA; 30 % → medio; 29 % → nada', () => {
  strictEqual(W.rainRisk(resp(DRY, [60, 0, 0]), T0 + 5 * MIN).level, 'high');
  strictEqual(W.rainRisk(resp(DRY, [60, 0, 0]), T0 + 5 * MIN).etaMin, null);
  strictEqual(W.rainRisk(resp(DRY, [30, 0, 0]), T0 + 5 * MIN).level, 'medium');
  strictEqual(W.rainRisk(resp(DRY, [29, 0, 0]), T0 + 5 * MIN).level, null);
});

test('la probabilidad es la de la hora que contiene "ahora"', () => {
  strictEqual(W.rainRisk(resp(DRY, [0, 70, 0]), T0 + 65 * MIN).probNextHour, 70);
});

test('ETA redondeada a 5 min y mínimo 5', () => {
  // ahora 10:13; tramo 10:15 empieza en 2 min → 5
  strictEqual(W.rainRisk(resp(withMm(1, 0.3), [0, 0, 0]), T0 + 13 * MIN).etaMin, 5);
  // ahora 10:02; tramo 10:30 empieza en 28 min → 30 (sigue siendo alto: 28 ≤ 30)
  const r = W.rainRisk(resp(withMm(2, 0.3), [0, 0, 0]), T0 + 2 * MIN);
  strictEqual(r.etaMin, 30); strictEqual(r.level, 'high');
});

test('datos vacíos o malformados → level null sin lanzar', () => {
  for (const bad of [null, undefined, {}, { minutely_15: {} }, { minutely_15: { time: 'x', precipitation: [] } }])
    strictEqual(W.rainRisk(bad, T0).level, null);
});

test('Ariza 2026-10-04 (previsión histórica real): medio a las 17:00, lloviendo a las 17:15', () => {
  // 15:00–18:45 hora local (UTC+2) → 13:00Z; horas 14:00–19:00 local → 12:00Z
  const s0 = Date.UTC(2026, 9, 4, 13, 0), h0 = Date.UTC(2026, 9, 4, 12, 0);
  const mm = [0.4, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.1, 0.1, 0.1, 0, 0, 0];
  const prob = [63, 58, 28, 35, 10, 15];
  const data = {
    minutely_15: { time: mm.map((_, i) => (s0 + i * 15 * MIN) / 1000), precipitation: mm },
    hourly: { time: prob.map((_, i) => (h0 + i * 60 * MIN) / 1000), precipitation_probability: prob },
  };
  const at = (h, m) => Date.UTC(2026, 9, 4, h - 2, m);
  strictEqual(W.rainRisk(data, at(16, 50)).level, null);       // prob 28 %, 0,1 mm < 0,2
  strictEqual(W.rainRisk(data, at(16, 50)).etaMin, 25);
  strictEqual(W.rainRisk(data, at(17, 0)).level, 'medium');    // prob 35 %
  strictEqual(W.rainRisk(data, at(17, 20)).level, 'raining');  // tramo 17:15 con 0,1 mm
});

test('rainByLapTimes: sin muestra de hace ≥ 9 min → no', () => {
  const now = T0 + 20 * MIN;
  deepStrictEqual(W.rainByLapTimes([{ ts: now - 5 * MIN, avg: 60 }], now, 70).rising, false);
});

test('rainByLapTimes: +1,2 s → no; +1,8 s → sí, con delta y muestra base', () => {
  const now = T0 + 20 * MIN, hist = [{ ts: now - 12 * MIN, avg: 66.0 }, { ts: now - 5 * MIN, avg: 66.5 }];
  strictEqual(W.rainByLapTimes(hist, now, 67.2).rising, false);
  const r = W.rainByLapTimes(hist, now, 67.8);
  strictEqual(r.rising, true);
  strictEqual(Math.round(r.deltaS * 10) / 10, 1.8);
  strictEqual(r.baselineAvg, 66.0); strictEqual(r.baselineTs, now - 12 * MIN);
});

test('rainByLapTimes: sin media actual → no', () => {
  strictEqual(W.rainByLapTimes([{ ts: T0, avg: 60 }], T0 + 10 * MIN, null).rising, false);
});

test('lineFor: textos y prioridades', () => {
  const none = { rising: false, deltaS: null };
  strictEqual(W.lineFor({ risk: null, lap: none, stale: false }), null);
  strictEqual(W.lineFor({ risk: { level: null }, lap: none, stale: false }), null);
  strictEqual(W.lineFor({ risk: { level: 'medium' }, lap: none }).text, '🌦 Riesgo medio · 30-60 min');
  strictEqual(W.lineFor({ risk: { level: 'high', etaMin: 20 }, lap: none }).text, '🌧 Riesgo alto · ~20 min');
  strictEqual(W.lineFor({ risk: { level: 'high', etaMin: null }, lap: none }).text, '🌧 Riesgo alto · próx. 30 min');
  strictEqual(W.lineFor({ risk: { level: 'raining' }, lap: none }).text, '🌧 Lloviendo');
  strictEqual(W.lineFor({ risk: null, lap: { rising: true, deltaS: 1.84 } }).text, '🌧 Lloviendo · tiempos +1,8 s');
  strictEqual(W.lineFor({ risk: { level: 'medium' }, lap: { rising: true, deltaS: 2 } }).kind, 'raining');
  strictEqual(W.lineFor({ risk: null, lap: none, stale: true }).text, 'meteo sin datos');
  strictEqual(W.lineFor({ risk: { level: 'high', etaMin: 10 }, lap: none, stale: true }).kind, 'high');
});

test('rainRisk ignora huecos con hora no numérica', () => {
  const r = W.rainRisk({ minutely_15: { time: [undefined, NaN, T0 / 1000], precipitation: [5, 5, 0] } }, T0 + 1000);
  strictEqual(r.slots.length, 1);
  strictEqual(r.level, null);
});

module.exports = { resp, T0, MIN, DRY, withMm };
if (require.main === module) {
  console.log(`\n${passed} OK, ${failed} fallos\n`);
  if (failed) process.exit(1);
}
