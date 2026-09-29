'use strict';
// Tests del glifo ≋/▮ y del tooltip de rebufo (_enTrafficMark) y de la línea
// "Rebufo hoy" del popup de Media pista (_enTrafficGiftLine).
// Run: node tests/traffic-ui.test.js

const assert = require('assert');
const { _enCleanLaps, _enFmt } = require('../src/analysis');
global._enCleanLaps = _enCleanLaps;
global._enFmt = _enFmt;

const { _enTrafficMark, _enTrafficGiftLine } = require('../src/en-state');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

// Motor falso con un registro por (dorsal, lapMs) y un regalo configurable
function fakeTraffic(recs, gift) {
  return {
    tagOf: (d, ms) => recs[`${d}|${Math.round(ms)}`] || null,
    isTraffic: (d, t) => { const r = recs[`${d}|${Math.round(t * 1000)}`]; return r && r.tag !== 'clean' ? r.tag : null; },
    giftToday: () => gift,
  };
}
const MIDIENDO = { giftSec: null, nTrain: 40, nClean: 300 };
const HOY = { giftSec: -0.21, nTrain: 180, nClean: 900 };
const kart = (lastLap, hist) => ({ dorsal: '12', lastLap, lapHistory: hist || [66.5, 66.6, 66.4, lastLap] });

console.log('\n_enTrafficMark');

test('sin motor o sin vuelta → null', () => {
  delete global.EnTraffic;
  assert.equal(_enTrafficMark(kart(66.214)), null);
  global.EnTraffic = fakeTraffic({}, MIDIENDO);
  assert.equal(_enTrafficMark({ dorsal: '12', lastLap: null }), null);
});

test('vuelta limpia → null', () => {
  global.EnTraffic = fakeTraffic({ '12|66214': { tag: 'clean' } }, HOY);
  assert.equal(_enTrafficMark(kart(66.214)), null);
});

test('tren sin regalo aún → ≋ + "midiendo…"', () => {
  global.EnTraffic = fakeTraffic({ '12|66214': { tag: 'train', aheadDorsal: '9', gapStart: 0.5, gapEnd: 0.4 } }, MIDIENDO);
  const m = _enTrafficMark(kart(66.214));
  assert.equal(m.glyph, '≋');
  assert.equal(m.tip, 'En tren tras #9 a 0,4 s · Rebufo hoy: midiendo… (fuera de calidad y media)');
});

test('tren con regalo → vuelta limpia estimada en m:ss.sss', () => {
  global.EnTraffic = fakeTraffic({ '12|66214': { tag: 'train', aheadDorsal: '9', gapStart: 0.5, gapEnd: 0.4 } }, HOY);
  const m = _enTrafficMark(kart(66.214));
  assert.equal(m.tip, 'En tren tras #9 a 0,4 s · Rebufo hoy: −0,21 s/vuelta · Vuelta limpia est.: ~1:06.424 (fuera de calidad y media)');
});

test('bloqueo → ▮ con huecos de/a', () => {
  global.EnTraffic = fakeTraffic({ '12|67105': { tag: 'blocked', aheadDorsal: '9', gapStart: 2.1, gapEnd: 0.3 } }, HOY);
  const m = _enTrafficMark(kart(67.105));
  assert.equal(m.glyph, '▮');
  assert.equal(m.tip, 'Bloqueado: alcanzó a #9 (de 2,1 s a 0,3 s) (fuera de calidad y media)');
});

test('red de seguridad activa (< 3 limpias) → sin coletilla', () => {
  const recs = {
    '12|66214': { tag: 'train', aheadDorsal: '9', gapStart: 0.5, gapEnd: 0.4 },
    '12|66300': { tag: 'train', aheadDorsal: '9', gapStart: 0.5, gapEnd: 0.5 },
  };
  global.EnTraffic = fakeTraffic(recs, MIDIENDO);
  const m = _enTrafficMark(kart(66.214, [66.5, 66.3, 66.214]));
  assert.equal(m.tip, 'En tren tras #9 a 0,4 s · Rebufo hoy: midiendo…');
});

console.log('\n_enTrafficGiftLine');

test('midiendo → cuenta vueltas en tren hacia 100', () => {
  global.EnTraffic = fakeTraffic({}, MIDIENDO);
  assert.equal(_enTrafficGiftLine(), 'Rebufo hoy: midiendo… (40/100 vueltas en tren)');
});

test('con regalo → valor y respaldo', () => {
  global.EnTraffic = fakeTraffic({}, HOY);
  assert.equal(_enTrafficGiftLine(), 'Rebufo hoy: −0,21 s/vuelta (180 en tren · 900 limpias)');
});

test('sin motor → cadena vacía', () => {
  delete global.EnTraffic;
  assert.equal(_enTrafficGiftLine(), '');
});

console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
