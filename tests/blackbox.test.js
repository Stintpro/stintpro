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

group('_scrub — secretos y PII', () => {
  test('redacta valores bajo claves de secreto', () => {
    const out = bb._scrub({ apiKey: 'sk-123', api_key: 'x', token: 't', ok: 'visible' });
    assert.equal(out.apiKey, '[redactado]');
    assert.equal(out.api_key, '[redactado]');
    assert.equal(out.token, '[redactado]');
    assert.equal(out.ok, 'visible');
  });
  test('elimina claves de nombre de piloto', () => {
    const out = bb._scrub({ dorsal: 12, nombre: 'Javier Coy', piloto: 'X' });
    assert.equal(out.dorsal, 12);
    assert.ok(!('nombre' in out));
    assert.ok(!('piloto' in out));
  });
  test('respeta datos de carrera anidados', () => {
    const out = bb._scrub({ karts: [{ dorsal: 7, gap: '1.234', clase: 'A' }] });
    assert.deepEqual(out.karts, [{ dorsal: 7, gap: '1.234', clase: 'A' }]);
  });
  test('no lanza con estructura circular', () => {
    const a = { x: 1 }; a.self = a;
    assert.doesNotThrow(() => bb._scrub(a));
  });
});

group('_serialize — cabecera-resumen + eventos', () => {
  const events = [
    { ts: 100, grifo: 'in',     tipo: 'live',  datos: { karts: 20 } },
    { ts: 200, grifo: 'render', tipo: 'paint', datos: { filas: 20 } },
    { ts: 300, grifo: 'in',     tipo: 'error', datos: { msg: 'parse' } },
    { ts: 400, grifo: 'in',     tipo: 'live',  datos: { karts: 21 } },
  ];
  const out = bb._serialize(events, { app: '1.0.0', circuito: 'lossantos', sesion: 42, estadoConexion: 'connected' });

  test('cuenta eventos por grifo:tipo', () => {
    assert.equal(out.resumen.porTipo['in:live'], 2);
    assert.equal(out.resumen.porTipo['render:paint'], 1);
    assert.equal(out.resumen.porTipo['in:error'], 1);
  });
  test('refleja ventana temporal y total', () => {
    assert.equal(out.resumen.desde, 100);
    assert.equal(out.resumen.hasta, 400);
    assert.equal(out.resumen.totalEventos, 4);
  });
  test('extrae últimos errores', () => {
    assert.equal(out.resumen.ultimosErrores.length, 1);
    assert.equal(out.resumen.ultimosErrores[0].datos.msg, 'parse');
  });
  test('cuerpo en orden cronológico', () => {
    assert.deepEqual(out.eventos.map(e => e.ts), [100, 200, 300, 400]);
  });
  test('lista vacía no rompe', () => {
    const o = bb._serialize([], { app: '1.0.0' });
    assert.equal(o.resumen.totalEventos, 0);
    assert.equal(o.resumen.desde, null);
  });
});

console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
