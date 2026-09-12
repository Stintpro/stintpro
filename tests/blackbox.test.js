'use strict';
const assert = require('assert');
const bb = require('../src/en-blackbox');

let passed = 0, failed = 0;
function test(name, fn){ try{ fn(); console.log(`  ✓ ${name}`); passed++; } catch(e){ console.error(`  ✗ ${name}\n    ${e.message}`); failed++; } }
function group(name, fn){ console.log(`\n${name}`); fn(); }

group('_makeRing — tope por número de eventos', () => {
  test('descarta lo más viejo al superar maxEvents', () => {
    const r = bb._makeRing(3, 10 * 60 * 1000);
    for (let i = 0; i < 5; i++) r.push({ ts: 1000 + i, grifo: 'in', tipo: 't', datos: i });
    const snap = r.snapshot();
    assert.equal(snap.length, 3);
    assert.deepEqual(snap.map(e => e.datos), [2, 3, 4]);
  });
});

group('_makeRing — tope por ventana temporal', () => {
  test('descarta eventos anteriores a (ultimo.ts - maxMs)', () => {
    const r = bb._makeRing(1000, 100);
    r.push({ ts: 0,   grifo: 'in', tipo: 't', datos: 'viejo' });
    r.push({ ts: 50,  grifo: 'in', tipo: 't', datos: 'medio' });
    r.push({ ts: 200, grifo: 'in', tipo: 't', datos: 'nuevo' });
    const snap = r.snapshot();
    assert.deepEqual(snap.map(e => e.datos), ['nuevo']); // 0 y 50 caen (< 200-100)
  });
});

group('event() — fail-safe', () => {
  test('registra un evento con ts, grifo, tipo, datos', () => {
    bb.clear();
    bb.event('user', 'tab', { tab: 'estrategia' });
    const snap = bb._ring().snapshot();
    assert.equal(snap.length, 1);
    assert.equal(snap[0].grifo, 'user');
    assert.equal(snap[0].tipo, 'tab');
    assert.equal(typeof snap[0].ts, 'number');
  });
  test('no lanza aunque datos sea circular/imposible de clonar', () => {
    const a = {}; a.self = a;
    assert.doesNotThrow(() => bb.event('in', 'x', a));
  });
});

console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
