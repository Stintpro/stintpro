// StintPro — tests del motor de tráfico (en-traffic.js): vueltas en tren
// (rebufo), bloqueadas o limpias. Ejecutar: node tests/traffic.test.js
'use strict';

const { strictEqual, ok } = require('assert');
const T = require('../src/en-traffic');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const S = 1000;
// Dos karts que ruedan a 60 s: "9" delante y "12" a `gap` s detrás.
function pair(tr, gaps, t0 = 100 * S) {
  let ts = t0;
  const out = [];
  gaps.forEach(g => {
    tr.onCrossing('9', 60000, ts);
    out.push(tr.onCrossing('12', 60000 + 7, ts + g * S));
    ts += 60 * S;
  });
  return out;
}

console.log('\n▸ etiquetado\n');

test('primera vuelta → clean (sin hueco de inicio)', () => {
  const tr = T.createTraffic();
  const [r] = pair(tr, [0.5]);
  strictEqual(r.tag, 'clean');
  strictEqual(r.aheadDorsal, '9');
  ok(Math.abs(r.gapEnd - 0.5) < 1e-9);
});

test('mismo kart delante a 0,5 s al empezar y al acabar → train', () => {
  const tr = T.createTraffic();
  const r = pair(tr, [0.5, 0.5]);
  strictEqual(r[1].tag, 'train');
  ok(Math.abs(r[1].gapStart - 0.5) < 1e-9);
});

test('cambia el kart de delante → clean', () => {
  const tr = T.createTraffic();
  tr.onCrossing('9', 60000, 100 * S);
  tr.onCrossing('12', 60000, 100.5 * S);
  tr.onCrossing('4', 60000, 160 * S);
  const r = tr.onCrossing('12', 60000, 160.5 * S);
  strictEqual(r.aheadDorsal, '4');
  strictEqual(r.tag, 'clean');
});

test('hueco fuera del tren (1,5 s) → clean', () => {
  const tr = T.createTraffic();
  const r = pair(tr, [1.5, 1.5]);
  strictEqual(r[1].tag, 'clean');
});

test('llega con 2,5 s libres y acaba a 0,4 s → blocked', () => {
  const tr = T.createTraffic();
  const r = pair(tr, [2.5, 0.4]);
  strictEqual(r[1].tag, 'blocked');
});

test('artefacto: hueco < 0,2 s nunca es tren ni bloqueo', () => {
  const tr = T.createTraffic();
  strictEqual(pair(tr, [0.5, 0.1])[1].tag, 'clean');
  const tr2 = T.createTraffic();
  strictEqual(pair(tr2, [2.5, 0.05])[1].tag, 'clean');
});

test('dorsal numérico y string son el mismo kart', () => {
  const tr = T.createTraffic();
  tr.onCrossing(9, 60000, 100 * S);
  tr.onCrossing(12, 60000, 100.5 * S);
  tr.onCrossing(9, 60000, 160 * S);
  strictEqual(tr.onCrossing('12', 60000, 160.5 * S).tag, 'train');
});

console.log('\n▸ consulta por vuelta\n');

test('isTraffic empareja por valor en segundos (±1 ms)', () => {
  const tr = T.createTraffic();
  pair(tr, [0.5, 0.5]); // 2ª vuelta de 12 = 60,007 s en tren
  strictEqual(tr.isTraffic('12', 60.007), 'train');
  strictEqual(tr.isTraffic('12', 60.008), 'train');
  strictEqual(tr.isTraffic('12', 61.5), null);
  strictEqual(tr.isTraffic('99', 60.007), null);
});

test('isTraffic devuelve null para vueltas limpias', () => {
  const tr = T.createTraffic();
  pair(tr, [3, 3]);
  strictEqual(tr.isTraffic('12', 60.007), null);
});

test('tagOf devuelve el registro completo', () => {
  const tr = T.createTraffic();
  pair(tr, [0.5, 0.5]);
  const r = tr.tagOf('12', 60007);
  strictEqual(r.tag, 'train');
  strictEqual(r.aheadDorsal, '9');
});

test('reset lo olvida todo', () => {
  const tr = T.createTraffic();
  pair(tr, [0.5, 0.5]);
  tr.reset();
  strictEqual(tr.isTraffic('12', 60.007), null);
  // tras reset la siguiente vuelta vuelve a ser "primera"
  strictEqual(pair(tr, [0.5])[0].tag, 'clean');
});

console.log('\n▸ ingest (desde el estado)\n');

test('ingest alimenta solo cambios de lastLapAt, en orden temporal', () => {
  const tr = T.createTraffic();
  // llegan desordenados en la misma foto: 12 cruzó 0,5 s después de 9
  tr.ingest([{ dorsal: '12', lastLap: 60.007, lastLapAt: 100500 }, { dorsal: '9', lastLap: 60, lastLapAt: 100000 }]);
  tr.ingest([{ dorsal: '12', lastLap: 60.007, lastLapAt: 100500 }, { dorsal: '9', lastLap: 60, lastLapAt: 100000 }]); // repetida: no cuenta
  tr.ingest([{ dorsal: '12', lastLap: 60.007, lastLapAt: 160500 }, { dorsal: '9', lastLap: 60, lastLapAt: 160000 }]);
  strictEqual(tr.isTraffic('12', 60.007), 'train');
  strictEqual(tr.tagOf('12', 60007).aheadDorsal, '9');
});

test('ingest ignora karts sin lastLapAt (logger antiguo) y sin vuelta', () => {
  const tr = T.createTraffic();
  tr.ingest([{ dorsal: '9', lastLap: 60 }, { dorsal: '12', lastLapAt: 5 }, null]);
  strictEqual(tr.tagOf('9', 60000), null);
});

console.log('\n▸ regalo del rebufo\n');

// Simula: 'F' alterna bloques de 10 vueltas en tren tras 'L' (0,5 s, 200 ms
// más rápido) y 10 vueltas en solitario (su referencia limpia). 'S1'/'S2'
// ruedan sueltos. La referencia del regalo son las vueltas LIMPIAS del kart,
// así un tren largo no absorbe su propio rebufo.
function simulate(tr, laps) {
  let ts = 0;
  for (let i = 0; i < laps; i++) {
    const base = 60000 + (i % 3) * 20; // pequeña variación
    const inTrain = Math.floor(i / 10) % 2 === 1;
    tr.onCrossing('L', base, ts);
    if (inTrain) tr.onCrossing('F', base - 200, ts + 500);
    else tr.onCrossing('F', base, ts + 10000);
    tr.onCrossing('S1', base, ts + 20000);
    tr.onCrossing('S2', base + 10, ts + 30000);
    ts += 60000;
  }
}

test('giftToday es null por debajo de 100/100', () => {
  const tr = T.createTraffic();
  simulate(tr, 40);
  const g = tr.giftToday();
  strictEqual(g.giftSec, null);
  ok(g.nTrain > 0 && g.nTrain < 100);
});

test('giftToday negativo cuando el tren va más rápido', () => {
  const tr = T.createTraffic();
  simulate(tr, 260);
  const g = tr.giftToday();
  ok(g.nTrain >= 100 && g.nClean >= 100, `n ${g.nTrain}/${g.nClean}`);
  ok(g.giftSec < -0.05 && g.giftSec > -0.35, `gift ${g.giftSec}`);
});

test('constantes exportadas', () => {
  strictEqual(T.GAP_MIN, 0.2);
  strictEqual(T.TRAIN_MAX, 1.2);
  strictEqual(T.BLOCK_FROM, 1.5);
  strictEqual(T.BLOCK_TO, 0.6);
  strictEqual(T.MIN_GIFT_N, 100);
});

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
