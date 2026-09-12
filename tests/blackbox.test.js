'use strict';
const assert = require('assert');
const bb = require('../src/en-blackbox');

let passed = 0, failed = 0;
async function test(name, fn){ try{ await fn(); console.log(`  ✓ ${name}`); passed++; } catch(e){ console.error(`  ✗ ${name}\n    ${e.message}`); failed++; } }
async function group(name, fn){ console.log(`\n${name}`); await fn(); }

function fakeStore(){
  const m = new Map();
  return {
    _m: m,
    async put(k, v){ m.set(k, JSON.parse(JSON.stringify(v))); },
    async get(k){ return m.has(k) ? m.get(k) : null; },
    async listKeys(){ return [...m.keys()]; },
    async del(k){ m.delete(k); },
  };
}

(async () => {

await group('_makeRing — tope por número de eventos', async () => {
  await test('descarta lo más viejo al superar maxEvents', () => {
    const r = bb._makeRing(3, 10 * 60 * 1000);
    for (let i = 0; i < 5; i++) r.push({ ts: 1000 + i, grifo: 'in', tipo: 't', datos: i });
    const snap = r.snapshot();
    assert.equal(snap.length, 3);
    assert.deepEqual(snap.map(e => e.datos), [2, 3, 4]);
  });
});

await group('_makeRing — tope por ventana temporal', async () => {
  await test('descarta eventos anteriores a (ultimo.ts - maxMs)', () => {
    const r = bb._makeRing(1000, 100);
    r.push({ ts: 0,   grifo: 'in', tipo: 't', datos: 'viejo' });
    r.push({ ts: 50,  grifo: 'in', tipo: 't', datos: 'medio' });
    r.push({ ts: 200, grifo: 'in', tipo: 't', datos: 'nuevo' });
    const snap = r.snapshot();
    assert.deepEqual(snap.map(e => e.datos), ['nuevo']); // 0 y 50 caen (< 200-100)
  });
});

await group('event() — fail-safe', async () => {
  await test('registra un evento con ts, grifo, tipo, datos', () => {
    bb.clear();
    bb.event('user', 'tab', { tab: 'estrategia' });
    const snap = bb._ring().snapshot();
    assert.equal(snap.length, 1);
    assert.equal(snap[0].grifo, 'user');
    assert.equal(snap[0].tipo, 'tab');
    assert.equal(typeof snap[0].ts, 'number');
  });
  await test('no lanza aunque datos sea circular/imposible de clonar', () => {
    const a = {}; a.self = a;
    assert.doesNotThrow(() => bb.event('in', 'x', a));
  });
});

await group('_scrub — secretos y PII', async () => {
  await test('redacta valores bajo claves de secreto', () => {
    const out = bb._scrub({ apiKey: 'sk-123', api_key: 'x', token: 't', ok: 'visible' });
    assert.equal(out.apiKey, '[redactado]');
    assert.equal(out.api_key, '[redactado]');
    assert.equal(out.token, '[redactado]');
    assert.equal(out.ok, 'visible');
  });
  await test('elimina claves de nombre de piloto', () => {
    const out = bb._scrub({ dorsal: 12, nombre: 'Javier Coy', piloto: 'X' });
    assert.equal(out.dorsal, 12);
    assert.ok(!('nombre' in out));
    assert.ok(!('piloto' in out));
  });
  await test('respeta datos de carrera anidados', () => {
    const out = bb._scrub({ karts: [{ dorsal: 7, gap: '1.234', clase: 'A' }] });
    assert.deepEqual(out.karts, [{ dorsal: 7, gap: '1.234', clase: 'A' }]);
  });
  await test('no lanza con estructura circular', () => {
    const a = { x: 1 }; a.self = a;
    assert.doesNotThrow(() => bb._scrub(a));
  });
});

await group('_serialize — cabecera-resumen + eventos', async () => {
  const events = [
    { ts: 100, grifo: 'in',     tipo: 'live',  datos: { karts: 20 } },
    { ts: 200, grifo: 'render', tipo: 'paint', datos: { filas: 20 } },
    { ts: 300, grifo: 'in',     tipo: 'error', datos: { msg: 'parse' } },
    { ts: 400, grifo: 'in',     tipo: 'live',  datos: { karts: 21 } },
  ];
  const out = bb._serialize(events, { app: '1.0.0', circuito: 'lossantos', sesion: 42, estadoConexion: 'connected' });

  await test('cuenta eventos por grifo:tipo', () => {
    assert.equal(out.resumen.porTipo['in:live'], 2);
    assert.equal(out.resumen.porTipo['render:paint'], 1);
    assert.equal(out.resumen.porTipo['in:error'], 1);
  });
  await test('refleja ventana temporal y total', () => {
    assert.equal(out.resumen.desde, 100);
    assert.equal(out.resumen.hasta, 400);
    assert.equal(out.resumen.totalEventos, 4);
  });
  await test('extrae últimos errores', () => {
    assert.equal(out.resumen.ultimosErrores.length, 1);
    assert.equal(out.resumen.ultimosErrores[0].datos.msg, 'parse');
  });
  await test('cuerpo en orden cronológico', () => {
    assert.deepEqual(out.eventos.map(e => e.ts), [100, 200, 300, 400]);
  });
  await test('lista vacía no rompe', () => {
    const o = bb._serialize([], { app: '1.0.0' });
    assert.equal(o.resumen.totalEventos, 0);
    assert.equal(o.resumen.desde, null);
  });
});

await group('persistencia — _flush / recoverLast / clear / export', async () => {
  await test('_flush escribe el serializado bajo la clave de sesión', async () => {
    const store = fakeStore();
    bb.clear(); bb._setStore(store);
    bb.setMeta({ app: '1.0.0', circuito: 'lossantos', sesion: 7 });
    bb.event('in', 'live', { karts: 20 });
    await bb._flush();
    const keys = await store.listKeys();
    assert.equal(keys.length, 1);
    const saved = await store.get(keys[0]);
    assert.equal(saved.resumen.totalEventos, 1);
    assert.equal(saved.eventos[0].datos.karts, 20);
  });

  await test('recoverLast devuelve una sesión previa del mismo día', async () => {
    const store = fakeStore();
    const hoy = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    await store.put(`${hoy}_campillos_1`, { resumen: { totalEventos: 3 }, eventos: [] });
    bb.clear(); bb._setStore(store);
    bb.setMeta({ app: '1.0.0', circuito: 'lossantos', sesion: 2 }); // sesión actual distinta
    const rec = await bb.recoverLast();
    assert.ok(rec);
    assert.equal(rec.resumen.totalEventos, 3);
    assert.ok(rec.key.startsWith(hoy));
  });

  await test('recoverLast ignora sesiones de otros días', async () => {
    const store = fakeStore();
    await store.put(`2000-01-01_x_1`, { resumen: { totalEventos: 9 }, eventos: [] });
    bb.clear(); bb._setStore(store);
    bb.setMeta({ app: '1.0.0', circuito: 'lossantos', sesion: 2 });
    assert.equal(await bb.recoverLast(), null);
  });

  await test('recoverLast elige por actividad (hasta) real, no por orden lexicográfico de la clave', async () => {
    const store = fakeStore();
    const hoy = new Date().toISOString().slice(0, 10);
    // Lexicográficamente "..._x_10" < "..._x_2", pero _2 es la más reciente por `hasta`.
    await store.put(`${hoy}_x_10`, { resumen: { hasta: 100 }, eventos: [] });
    await store.put(`${hoy}_x_2`,  { resumen: { hasta: 200 }, eventos: [] });
    bb.clear(); bb._setStore(store);
    bb.setMeta({ app: '1.0.0', circuito: 'lossantos', sesion: 99 }); // sesión actual distinta de ambas
    const rec = await bb.recoverLast();
    assert.ok(rec);
    assert.equal(rec.key, `${hoy}_x_2`);
    assert.equal(rec.resumen.hasta, 200);
  });

  await test('export devuelve filename + payload y hace _flush', async () => {
    const store = fakeStore();
    bb.clear(); bb._setStore(store);
    bb.setMeta({ app: '1.0.0', circuito: 'lossantos', sesion: 5 });
    bb.event('user', 'tab', { tab: 'equipo' });
    const out = await bb.export();
    assert.ok(/^stintpro-blackbox_lossantos_\d{4}-\d{2}-\d{2}_\d{4}\.json$/.test(out.filename));
    assert.equal(out.payload.resumen.totalEventos, 1);
  });

  await test('clear vacía ring y borra la clave de sesión', async () => {
    const store = fakeStore();
    bb.clear(); bb._setStore(store);
    bb.setMeta({ app: '1.0.0', circuito: 'lossantos', sesion: 8 });
    bb.event('in', 'live', {});
    await bb._flush();
    await bb.clear();
    assert.equal(bb._ring().size, 0);
    assert.equal((await store.listKeys()).length, 0);
  });
});

await group('_scrub — contenido de string (credenciales/URLs)', async () => {
  await test('enmascara token=/key= y credenciales de URL dentro de strings', () => {
    const out = bb._scrub({ raw: 'x token=abc123 y http://user:pass@h/z' });
    assert.ok(!/abc123/.test(out.raw), 'no debe sobrevivir el token');
    assert.ok(!/user:pass/.test(out.raw), 'no deben sobrevivir las credenciales de URL');
    assert.ok(/\[redactado\]/.test(out.raw), 'debe marcar [redactado]');
  });
  await test('enmascara authorization: Bearer ...', () => {
    const out = bb._scrub({ raw: 'authorization: Bearer sk-XYZ789' });
    assert.ok(!/sk-XYZ789/.test(out.raw));
    assert.ok(/\[redactado\]/.test(out.raw));
  });
  await test('no toca telemetría normal (números, tiempos, dorsales)', () => {
    const s = 'dorsal 7 gap 1.234 vuelta 58.021 monkey 5';
    const out = bb._scrub({ raw: s });
    assert.equal(out.raw, s);
  });
  await test('el string escrutado llega hasta ultimosErrores del serializado', () => {
    bb.clear();
    bb.event('in', 'error', { fuente: 'apex', raw: 'boom token=SECRETO123' });
    const ser = bb._serialize(bb._ring().snapshot(), {});
    const errRaw = ser.resumen.ultimosErrores[0].datos.raw;
    assert.ok(!/SECRETO123/.test(errRaw));
    assert.ok(/\[redactado\]/.test(errRaw));
  });
});

await group('_armAutoFlush — flush periódico + ciclo de vida', async () => {
  await test('intervalo y visibilitychange(hidden) disparan _flush', async () => {
    let intervalCb = null;
    const handlers = {};
    const fakeDoc = {
      visibilityState: 'visible',
      addEventListener(ev, fn){ handlers[ev] = fn; },
      removeEventListener(){},
    };
    const store = fakeStore();
    bb.clear(); bb._setStore(store);
    bb.setMeta({ app: '1.0.0', circuito: 'lossantos', sesion: 3 });
    bb.event('in', 'live', { karts: 20 });
    const stop = bb._armAutoFlush({
      intervalMs: 5000,
      setIntervalFn: (fn) => { intervalCb = fn; return 1; },
      clearIntervalFn: () => {},
      doc: fakeDoc,
      win: null,
    });
    assert.equal(typeof intervalCb, 'function', 'debe programar el intervalo');
    assert.equal(typeof handlers.visibilitychange, 'function', 'debe registrar visibilitychange');

    intervalCb();
    await Promise.resolve(); await Promise.resolve();
    assert.equal((await store.listKeys()).length, 1, 'el intervalo debe escribir en el store');

    for (const k of await store.listKeys()) await store.del(k);
    fakeDoc.visibilityState = 'hidden';
    handlers.visibilitychange();
    await Promise.resolve(); await Promise.resolve();
    assert.equal((await store.listKeys()).length, 1, 'visibilitychange(hidden) debe escribir');

    stop();
  });

  await test('visibilitychange(visible) NO dispara flush', async () => {
    let intervalCb = null;
    const handlers = {};
    const fakeDoc = {
      visibilityState: 'hidden',
      addEventListener(ev, fn){ handlers[ev] = fn; },
      removeEventListener(){},
    };
    const store = fakeStore();
    bb.clear(); bb._setStore(store);
    bb.setMeta({ app: '1.0.0', circuito: 'lossantos', sesion: 4 });
    bb.event('in', 'live', {});
    const stop = bb._armAutoFlush({
      setIntervalFn: (fn) => { intervalCb = fn; return 1; },
      clearIntervalFn: () => {},
      doc: fakeDoc,
      win: null,
    });
    fakeDoc.visibilityState = 'visible';
    handlers.visibilitychange();
    await Promise.resolve(); await Promise.resolve();
    assert.equal((await store.listKeys()).length, 0, 'visible no debe escribir');
    stop();
  });

  await test('no lanza aunque _flush falle en el callback', async () => {
    let intervalCb = null;
    const badStore = { async put(){ throw new Error('io'); }, async get(){ return null; }, async listKeys(){ return []; }, async del(){} };
    bb.clear(); bb._setStore(badStore);
    bb.setMeta({ app: '1.0.0', circuito: 'x', sesion: 1 });
    bb.event('in', 'live', {});
    const stop = bb._armAutoFlush({ setIntervalFn: (fn) => { intervalCb = fn; return 1; }, clearIntervalFn: () => {}, doc: null, win: null });
    assert.doesNotThrow(() => intervalCb());
    await Promise.resolve();
    stop();
  });
});

console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

})();
