// StintPro — bucle requestAnimationFrame del túnel de Avanzado (en-advanced.js)
// Ejecutar: node tests/advanced-raf.test.js
'use strict';

const { strictEqual, ok } = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

// Contexto mínimo: el túnel existe, rAF se apunta en una cola que avanzamos a mano.
function makeCtx({ throwInBody = false } = {}) {
  let wall = 1_000_000;
  const frames = [];
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Date: { now: () => wall },
    Math, JSON,
    requestAnimationFrame: (f) => { frames.push(f); return frames.length; },
    cancelAnimationFrame() {},
    document: { getElementById: (id) => (id === 'en-adv-tunnel' ? { innerHTML: '' } : null), querySelector: () => null },
    calls: 0,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext('let _enAdvRafId=null;', ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'en-advanced.js'), 'utf8'), ctx);
  // _enTrackAvgLive es lo primero caro del tick: contamos cuántas veces se calcula.
  // EnSession sin pitOutCalibration hace que el cuerpo lance justo después.
  vm.runInContext(`
    var EnSession = { data: { equipos: [] }, pitOutCalibration: ${throwInBody ? 'null' : '[]'}, linePasses: {} };
    var EnBox = {}; var _enTrackAvgLive = function(){ calls++; return null; };
  `, ctx);
  return {
    ctx,
    start: () => vm.runInContext('_enStartAdvRaf()', ctx),
    // Avanza un frame de ~16 ms
    frame: () => { wall += 16; const f = frames.shift(); if (f) f(wall); },
    pending: () => frames.length,
  };
}

console.log('\n▸ Túnel de Avanzado — bucle rAF\n');

test('APP-2: a 60 fps recalcula como mucho 4 veces por segundo', () => {
  const T = makeCtx();
  T.start();
  for (let i = 0; i < 60; i++) T.frame();   // ~1 s
  ok(T.ctx.calls >= 1 && T.ctx.calls <= 4, `recalculó ${T.ctx.calls} veces en 1 s`);
});

test('APP-3: una excepción en el cálculo no mata el bucle', () => {
  const T = makeCtx({ throwInBody: true });
  T.start();
  for (let i = 0; i < 60; i++) T.frame();
  strictEqual(T.pending(), 1, 'debe quedar el siguiente frame pedido');
  ok(T.ctx.calls >= 2, `tras el primer error debe seguir recalculando (${T.ctx.calls})`);
});

console.log(`\n${passed} pasan, ${failed} fallan\n`);
process.exit(failed ? 1 : 0);
