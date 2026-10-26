// StintPro — tests de la instancia de meteo (sondeo, datos viejos, línea).
// Ejecutar: node tests/weather-instance.test.js
'use strict';

const { strictEqual, ok } = require('assert');
const W = require('../src/en-weather');
const { resp, T0, MIN, withMm } = require('./weather.test.js');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

function rig(over) {
  const s = { now: T0, live: true, calls: [], body: resp(withMm(2, 0.3), [10, 10, 10]), fail: false };
  const w = W.createWeather(Object.assign({
    now: () => s.now,
    isLive: () => s.live,
    coordsOf: slug => (slug === 'henakart' ? [40.4, -3.4] : null),
    fetch: url => { s.calls.push(url); return s.fail ? Promise.reject(new Error('red caída'))
      : Promise.resolve({ ok: true, json: () => Promise.resolve(s.body) }); },
  }, over || {}));
  return { s, w };
}

(async () => {
  await test('primer tick consulta Open-Meteo con las coordenadas', async () => {
    const { s, w } = rig();
    await w.tick('henakart', 66);
    strictEqual(s.calls.length, 1);
    ok(s.calls[0].includes('latitude=40.4&longitude=-3.4'));
    strictEqual(w.current().risk.level, 'high');
  });

  await test('no vuelve a consultar antes de 10 min; sí después', async () => {
    const { s, w } = rig();
    await w.tick('henakart', 66);
    s.now += 9 * MIN; strictEqual(w.tick('henakart', 66), null);
    s.now += 2 * MIN; await w.tick('henakart', 66);
    strictEqual(s.calls.length, 2);
  });

  await test('sin coordenadas o en repetición no consulta', async () => {
    const a = rig(); strictEqual(a.w.tick('sevilla-falso', 66), null); strictEqual(a.s.calls.length, 0);
    const b = rig(); b.s.live = false; strictEqual(b.w.tick('henakart', 66), null); strictEqual(b.s.calls.length, 0);
  });

  await test('sin datos buenos en 30 min → stale y "meteo sin datos"', async () => {
    const { s, w } = rig(); s.fail = true;
    await w.tick('henakart', 66);
    ok(w.current().error);
    strictEqual(w.current().stale, false);          // recién empezado
    s.now += 31 * MIN;
    strictEqual(w.current().stale, true);
    ok(w.kpiLineHtml().includes('meteo sin datos'));
  });

  await test('datos de hace > 30 min no cuentan como riesgo', async () => {
    const { s, w } = rig();
    await w.tick('henakart', 66);
    s.fail = true; s.now += 31 * MIN;
    strictEqual(w.current().risk, null);
  });

  await test('kpiLineHtml: vacío con seco; línea con title de Open-Meteo con riesgo', async () => {
    const dry = rig({}); dry.s.body = resp(new Array(13).fill(0), [0, 0, 0]);
    await dry.w.tick('henakart', 66);
    strictEqual(dry.w.kpiLineHtml(), '');
    const { w } = rig();
    await w.tick('henakart', 66);
    const html = w.kpiLineHtml();
    ok(html.includes('🌧 Riesgo alto · ~30 min'), html);
    ok(html.includes('Open-Meteo'));
  });

  await test('subida de tiempos funciona también sin previsión (repetición)', async () => {
    const { s, w } = rig(); s.live = false;
    w.tick('henakart', 66.0);
    s.now += 10 * MIN; w.tick('henakart', 67.9);
    ok(w.kpiLineHtml().includes('🌧 Lloviendo · tiempos +1,9 s'));
  });

  await test('cambiar de circuito reinicia el estado', async () => {
    const { s, w } = rig();
    await w.tick('henakart', 66);
    w.tick('otro', 66);
    strictEqual(w.current().risk, null);
    strictEqual(s.calls.length, 1);
  });

  console.log(`\n${passed} OK, ${failed} fallos\n`);
  if (failed) process.exit(1);
})();
