# Caja negra de diagnóstico — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grabar en segundo plano cómo entran los datos, cómo se pintan y qué hace el usuario, persistirlo en IndexedDB y poder exportarlo a un fichero para analizarlo.

**Architecture:** Un módulo aislado `src/en-blackbox.js` con un ring buffer en memoria (tope doble: nº de eventos y ventana temporal), persistido a IndexedDB mediante un *store* inyectable (lógica pura testeable en Node, adaptador IndexedDB fino verificado en navegador). Tres "grifos" ya existentes (conectores, render de parrilla, controles del panel) llaman a `window.Blackbox?.event(...)`; si el módulo no está, es no-op. La exportación produce un `.json` con cabecera-resumen legible + eventos.

**Tech Stack:** JavaScript vanilla (navegador), IndexedDB, tests Node puros con `assert` (mismo arnés que `tests/*.test.js`), export dual `module.exports` + `window`.

**Spec:** `docs/superpowers/specs/2026-09-12-blackbox-diagnostico-design.md`

## Global Constraints

- **Fail-safe absoluto:** `event()` NUNCA propaga excepciones al llamante. La caja negra no puede romper la carrera. Todo su cuerpo va en try/catch interno.
- **Sin PII ni secretos:** nunca se registran nombres de piloto, ni la API key/URL del logger. La redacción (`_scrub`) es la última barrera.
- **Export dual del repo:** cada módulo nuevo termina con `if(typeof module!=='undefined')module.exports={...}` y además cuelga su API de `window`.
- **Tests en Node puro:** cada suite se ejecuta con `node tests/<archivo>.test.js`, arnés `test`/`group` con `assert`, imprime `N tests — X passed, Y failed` y hace `process.exit(1)` si falla alguno.
- **Commits frecuentes**, mensaje en español, terminados con:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **NO hacer push ni desplegar** en ningún paso. El despliegue lo decide el usuario aparte.

---

## Estructura de ficheros

- **Crear** `src/en-blackbox.js` — todo el módulo (ring buffer, `event`, `_scrub`, `_serialize`, persistencia, `export`, `recoverLast`, `clear`, adaptador IndexedDB). Responsabilidad única: registrar/persistir/exportar diagnóstico. Sin lógica de negocio.
- **Crear** `tests/blackbox.test.js` — tests Node de toda la lógica pura y de la orquestación de persistencia contra un store falso.
- **Modificar** `src/index.html` — cargar `en-blackbox.js` antes de conectores y `en-grid.js`.
- **Modificar** `src/logger-connector.js` — grifo `in` (mensajes, estados, error de parseo).
- **Modificar** `src/apex-connector.js` — grifo `in` (equivalente).
- **Modificar** `src/en-grid.js` — grifo `render` (huella en `_enRender`) y grifo `user` (acciones del panel).
- **Modificar** `src/app.js` — grifo `user` (PIN, demo).
- **Modificar** `src/admin.html` — botón "Exportar caja negra" + aviso de recuperación.

---

## Task 1: Ring buffer + `event()` (fail-safe)

**Files:**
- Create: `src/en-blackbox.js`
- Test: `tests/blackbox.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `_makeRing(maxEvents:number, maxMs:number) -> { push(ev), snapshot():ev[], clear(), size:number }` donde `ev = { ts:number, grifo:string, tipo:string, datos:any }`.
  - `Blackbox.event(grifo:string, tipo:string, datos:any) -> void` (nunca lanza; añade `{ts:Date.now(), grifo, tipo, datos:_scrub(datos)}` al ring). En Task 1 `_scrub` es identidad provisional (se implementa en Task 2).
  - Constantes `MAX_EVENTS = 5000`, `MAX_MS = 1800000`.

- [ ] **Step 1: Escribir el test que falla**

En `tests/blackbox.test.js`:

```js
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
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node tests/blackbox.test.js`
Expected: FAIL — `Cannot find module '../src/en-blackbox'`.

- [ ] **Step 3: Implementación mínima**

En `src/en-blackbox.js`:

```js
'use strict';
// Caja negra de diagnóstico. Aislada, fail-safe: NUNCA puede romper la carrera.

const MAX_EVENTS = 5000;
const MAX_MS = 30 * 60 * 1000;

function _makeRing(maxEvents, maxMs){
  let buf = [];
  return {
    push(ev){
      buf.push(ev);
      const cutoff = ev.ts - maxMs;
      while (buf.length && buf[0].ts < cutoff) buf.shift();
      if (buf.length > maxEvents) buf = buf.slice(buf.length - maxEvents);
    },
    snapshot(){ return buf.slice(); },
    clear(){ buf = []; },
    get size(){ return buf.length; }
  };
}

// _scrub: en Task 2 redacta secretos/PII. De momento, identidad segura.
function _scrub(v){ return v; }

const _theRing = _makeRing(MAX_EVENTS, MAX_MS);

function event(grifo, tipo, datos){
  try {
    _theRing.push({ ts: Date.now(), grifo, tipo, datos: _scrub(datos) });
  } catch (_) { /* fail-safe: jamás propaga */ }
}

function clear(){ try { _theRing.clear(); } catch(_){} }

const Blackbox = { event, clear, _makeRing, _scrub, _ring: () => _theRing, MAX_EVENTS, MAX_MS };

if (typeof window !== 'undefined') window.Blackbox = Blackbox;
if (typeof module !== 'undefined') module.exports = Blackbox;
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node tests/blackbox.test.js`
Expected: PASS (todos los grupos de Task 1).

- [ ] **Step 5: Commit**

```bash
git add src/en-blackbox.js tests/blackbox.test.js
git commit -m "feat(blackbox): ring buffer con tope doble y event() fail-safe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Redacción de secretos y PII (`_scrub`)

**Files:**
- Modify: `src/en-blackbox.js`
- Test: `tests/blackbox.test.js`

**Interfaces:**
- Consumes: `_makeRing`, `event` (Task 1).
- Produces: `_scrub(v:any) -> any` — copia profunda donde: las claves que parecen secreto (`/api[_-]?key|token|secret|password|bearer|authorization/i`) se sustituyen por `'[redactado]'`; las claves que parecen nombre de persona (`/^(nombre|piloto|driver|name|fullname)$/i`) se eliminan; el resto se conserva. Robusto ante ciclos (devuelve `'[circular]'`).

- [ ] **Step 1: Escribir el test que falla**

Añadir a `tests/blackbox.test.js` (antes de la línea de resumen):

```js
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
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node tests/blackbox.test.js`
Expected: FAIL — `_scrub` es identidad, no redacta ni elimina.

- [ ] **Step 3: Implementación**

Sustituir la función `_scrub` provisional de `src/en-blackbox.js` por:

```js
const _SECRET_RE = /api[_-]?key|token|secret|password|bearer|authorization/i;
const _NAME_RE   = /^(nombre|piloto|driver|name|fullname)$/i;

function _scrub(v, seen){
  seen = seen || new Set();
  if (v === null || typeof v !== 'object') return v;
  if (seen.has(v)) return '[circular]';
  seen.add(v);
  if (Array.isArray(v)) return v.map(x => _scrub(x, seen));
  const out = {};
  for (const k of Object.keys(v)) {
    if (_NAME_RE.test(k)) continue;               // PII: fuera
    if (_SECRET_RE.test(k)) { out[k] = '[redactado]'; continue; }
    out[k] = _scrub(v[k], seen);
  }
  return out;
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node tests/blackbox.test.js`
Expected: PASS (Task 1 + Task 2).

- [ ] **Step 5: Commit**

```bash
git add src/en-blackbox.js tests/blackbox.test.js
git commit -m "feat(blackbox): _scrub redacta secretos y elimina nombres de piloto

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Serialización del export (`_serialize`)

**Files:**
- Modify: `src/en-blackbox.js`
- Test: `tests/blackbox.test.js`

**Interfaces:**
- Consumes: el shape de evento `{ts,grifo,tipo,datos}` (Task 1).
- Produces: `_serialize(events:ev[], meta:object) -> { resumen, eventos }` donde
  `resumen = { app, circuito, sesion, desde, hasta, totalEventos, porTipo:{[grifo:tipo]:n}, ultimosErrores:ev[], estadoConexion }`
  y `eventos` es `events` en orden cronológico (tal cual llegan del ring).
  `meta = { app, circuito, sesion, estadoConexion }`. `ultimosErrores` = últimos 10 eventos con `tipo === 'error'`.

- [ ] **Step 1: Escribir el test que falla**

Añadir a `tests/blackbox.test.js`:

```js
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
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node tests/blackbox.test.js`
Expected: FAIL — `bb._serialize is not a function`.

- [ ] **Step 3: Implementación**

Añadir a `src/en-blackbox.js` (y a la exportación):

```js
function _serialize(events, meta){
  meta = meta || {};
  const porTipo = {};
  for (const e of events) {
    const k = e.grifo + ':' + e.tipo;
    porTipo[k] = (porTipo[k] || 0) + 1;
  }
  const ultimosErrores = events.filter(e => e.tipo === 'error').slice(-10);
  return {
    resumen: {
      app: meta.app || null,
      circuito: meta.circuito || null,
      sesion: meta.sesion != null ? meta.sesion : null,
      desde: events.length ? events[0].ts : null,
      hasta: events.length ? events[events.length - 1].ts : null,
      totalEventos: events.length,
      porTipo,
      ultimosErrores,
      estadoConexion: meta.estadoConexion || null,
    },
    eventos: events,
  };
}
```

Añadir `_serialize` al objeto `Blackbox`.

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node tests/blackbox.test.js`
Expected: PASS (Tasks 1–3).

- [ ] **Step 5: Commit**

```bash
git add src/en-blackbox.js tests/blackbox.test.js
git commit -m "feat(blackbox): _serialize produce cabecera-resumen + eventos

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Persistencia (store inyectable) — `_flush`, `recoverLast`, `clear`, `export`

**Files:**
- Modify: `src/en-blackbox.js`
- Test: `tests/blackbox.test.js`

**Interfaces:**
- Consumes: ring (Task 1), `_serialize` (Task 3).
- Produces:
  - Contrato de *store* (async): `{ put(key,payload), get(key), listKeys(), del(key) }`, cada uno devuelve Promise.
  - `Blackbox._setStore(store)` — inyecta un store (para tests y para el adaptador IndexedDB real).
  - `Blackbox.setMeta(meta)` — fija `{app, circuito, sesion, estadoConexion}` que usará el resumen y la clave de sesión (`sesionKey = <YYYY-MM-DD>_<circuito>_<sesion>`).
  - `Blackbox._flush() -> Promise` — escribe `_serialize(ring.snapshot(), meta)` bajo `sesionKey` (sobrescribe).
  - `Blackbox.recoverLast() -> Promise<{ key, resumen }|null>` — busca la clave más reciente **del día de hoy**, distinta de la sesión actual; devuelve su `{key, resumen}` o `null`.
  - `Blackbox.export() -> Promise<{ filename, payload }>` — hace `_flush`, arma `{ filename, payload }` (payload = objeto serializado; filename = `stintpro-blackbox_<circuito>_<YYYY-MM-DD_HHMM>.json`) y, si `typeof document !== 'undefined'`, dispara la descarga (Blob + `<a download>`). En Node no descarga, solo devuelve el objeto.
  - `Blackbox.clear()` (ampliada) — vacía el ring y borra `sesionKey` del store.

- [ ] **Step 1: Escribir el test que falla**

Añadir a `tests/blackbox.test.js` un store falco en memoria y los tests:

```js
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

group('persistencia — _flush / recoverLast / clear / export', () => {
  test('_flush escribe el serializado bajo la clave de sesión', async () => {
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

  test('recoverLast devuelve una sesión previa del mismo día', async () => {
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

  test('recoverLast ignora sesiones de otros días', async () => {
    const store = fakeStore();
    await store.put(`2000-01-01_x_1`, { resumen: { totalEventos: 9 }, eventos: [] });
    bb.clear(); bb._setStore(store);
    bb.setMeta({ app: '1.0.0', circuito: 'lossantos', sesion: 2 });
    assert.equal(await bb.recoverLast(), null);
  });

  test('export devuelve filename + payload y hace _flush', async () => {
    const store = fakeStore();
    bb.clear(); bb._setStore(store);
    bb.setMeta({ app: '1.0.0', circuito: 'lossantos', sesion: 5 });
    bb.event('user', 'tab', { tab: 'equipo' });
    const out = await bb.export();
    assert.ok(/^stintpro-blackbox_lossantos_\d{4}-\d{2}-\d{2}_\d{4}\.json$/.test(out.filename));
    assert.equal(out.payload.resumen.totalEventos, 1);
  });

  test('clear vacía ring y borra la clave de sesión', async () => {
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
```

Nota: convertir `test(...)` a soportar funciones async — sustituir el helper `test` al principio del archivo por:

```js
async function test(name, fn){ try{ await fn(); console.log(`  ✓ ${name}`); passed++; } catch(e){ console.error(`  ✗ ${name}\n    ${e.message}`); failed++; } }
```

y envolver el archivo en `(async () => { ... console.log(resumen); if(failed>0) process.exit(1); })();` para poder `await` los grupos, **o** hacer que cada `group` con tests async encadene promesas. Implementación recomendada: envolver todo el cuerpo tras los helpers en una IIFE async y `await` cada `test(...)`.

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `node tests/blackbox.test.js`
Expected: FAIL — `bb._setStore is not a function`.

- [ ] **Step 3: Implementación**

Añadir a `src/en-blackbox.js`:

```js
let _store = null;               // se inyecta (_setStore) o se crea el IDB real en el navegador
const _meta = { app: null, circuito: null, sesion: null, estadoConexion: null };

function setMeta(m){ Object.assign(_meta, m || {}); }
function _setStore(s){ _store = s; }

function _sesionKey(){
  const d = new Date().toISOString().slice(0, 10);
  return `${d}_${_meta.circuito || 'sin-circuito'}_${_meta.sesion != null ? _meta.sesion : 0}`;
}

async function _flush(){
  if (!_store) return;
  const payload = _serialize(_theRing.snapshot(), _meta);
  await _store.put(_sesionKey(), payload);
}

async function recoverLast(){
  if (!_store) return null;
  const hoy = new Date().toISOString().slice(0, 10);
  const actual = _sesionKey();
  const keys = (await _store.listKeys())
    .filter(k => k.startsWith(hoy) && k !== actual)
    .sort();
  if (!keys.length) return null;
  const key = keys[keys.length - 1];
  const payload = await _store.get(key);
  return payload ? { key, resumen: payload.resumen } : null;
}

function _filename(){
  const n = new Date();
  const p = x => String(x).padStart(2, '0');
  const stamp = `${n.getFullYear()}-${p(n.getMonth()+1)}-${p(n.getDate())}_${p(n.getHours())}${p(n.getMinutes())}`;
  return `stintpro-blackbox_${_meta.circuito || 'sesion'}_${stamp}.json`;
}

async function exportLog(){
  await _flush();
  const payload = _serialize(_theRing.snapshot(), _meta);
  const filename = _filename();
  if (typeof document !== 'undefined' && typeof Blob !== 'undefined') {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { filename, payload };
}

async function clear(){
  try { _theRing.clear(); } catch(_){}
  try { if (_store) await _store.del(_sesionKey()); } catch(_){}
}
```

Reemplazar la `clear` de Task 1 por esta versión async. Ampliar el objeto `Blackbox` con: `setMeta, _setStore, _flush, recoverLast, export: exportLog, clear`.

Añadir el **adaptador IndexedDB real** (usado solo en navegador; los tests inyectan el falso):

```js
function _idbStore(dbName, storeName){
  function open(){
    return new Promise((res, rej) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(storeName);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  function tx(mode, fn){
    return open().then(db => new Promise((res, rej) => {
      const t = db.transaction(storeName, mode);
      const s = t.objectStore(storeName);
      const out = fn(s);
      t.oncomplete = () => res(out._result);
      t.onerror = () => rej(t.error);
    }));
  }
  return {
    put(k, v){ return tx('readwrite', s => { s.put(v, k); return {}; }); },
    get(k){ return tx('readonly', s => { const r = s.get(k); const o = {}; r.onsuccess = () => o._result = r.result || null; return o; }); },
    listKeys(){ return tx('readonly', s => { const r = s.getAllKeys(); const o = {}; r.onsuccess = () => o._result = r.result || []; return o; }); },
    del(k){ return tx('readwrite', s => { s.delete(k); return {}; }); },
  };
}
```

Y al final, en el arranque de navegador, inyectar el store real por defecto (sin romper Node):

```js
if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
  try { _setStore(_idbStore('stintpro', 'blackbox')); } catch(_){}
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `node tests/blackbox.test.js`
Expected: PASS (Tasks 1–4).

- [ ] **Step 5: Commit**

```bash
git add src/en-blackbox.js tests/blackbox.test.js
git commit -m "feat(blackbox): persistencia con store inyectable + adaptador IndexedDB + export

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Carga del módulo + instrumentación de los tres grifos

**Files:**
- Modify: `src/index.html` (añadir `<script>` antes de conectores/grid)
- Modify: `src/logger-connector.js` (grifo `in`)
- Modify: `src/apex-connector.js` (grifo `in`)
- Modify: `src/en-grid.js` (grifo `render` y `user`)
- Modify: `src/app.js` (grifo `user`)

**Interfaces:**
- Consumes: `window.Blackbox.event(grifo,tipo,datos)`, `window.Blackbox.setMeta(...)` (Tasks 1–4).
- Produces: eventos reales fluyendo al ring durante una sesión.

Esta tarea es de cableado en navegador (no unit-testable en Node); se verifica con el preview del navegador leyendo el estado del ring.

- [ ] **Step 1: Cargar el script**

En `src/index.html`, tras la línea `<script src="clock.js"></script>` (línea ~64) y **antes** de `apex-connector.js`, añadir:

```html
  <script src="en-blackbox.js"></script>
```

- [ ] **Step 2: Grifo `in` en logger-connector.js**

En `src/logger-connector.js`, dentro de `ws.onmessage` tras `const msg = JSON.parse(evt.data);` (línea ~65):

```js
      window.Blackbox?.event('in', msg.type || 'msg', { bytes: evt.data.length, karts: msg?.data?.length ?? msg?.snapshot?.length });
```

En el `catch` del parseo de ese `onmessage` (el que engloba el `JSON.parse`):

```js
      window.Blackbox?.event('in', 'error', { fuente: 'logger', raw: String(evt.data).slice(0, 2000) });
```

En cada llamada a `this.onStatus(estado, ...)` de `onopen`/`onclose`/`onerror` añadir junto a ellas:

```js
      window.Blackbox?.event('in', 'status', { conn: '<estado>' }); // 'connected'|'disconnected'|'error'
```

(usar el literal del estado correspondiente a cada punto).

- [ ] **Step 3: Grifo `in` en apex-connector.js**

En `src/apex-connector.js`, en el `catch` de `this._parser.parse(e.data)` (línea ~103):

```js
        window.Blackbox?.event('in', 'error', { fuente: 'apex', raw: String(e.data).slice(0, 2000) });
```

En el `onData(state)` (línea ~345) y en las transiciones de `onStatus` (líneas ~64, 99, 105, 108):

```js
    window.Blackbox?.event('in', 'live', { karts: state?.length });        // junto a onData
    window.Blackbox?.event('in', 'status', { conn: '<estado>' });          // junto a cada onStatus
```

- [ ] **Step 4: Grifo `render` en en-grid.js**

En `src/en-grid.js`, al final de `_enRender()` (empieza en línea ~87), justo antes de que la función retorne, añadir la huella. Usar solo variables ya disponibles en ese ámbito (nº de filas pintadas, líder, banderas, mi stint); si alguna no está en ámbito, leerla de las globales que ya usa el render (p. ej. `EnState`/`window`). Ejemplo:

```js
  try {
    window.Blackbox?.event('render', 'paint', {
      filas: (document.querySelectorAll('#en-grid-body .en-row')||[]).length,
      lider: (window.EnState?.leaderDorsal ?? null),
      banderas: (window.EnState?.flag ?? null),
    });
  } catch(_){}
```

(ajustar los selectores/globales a los nombres reales que use `_enRender`; el objetivo es una huella barata, no exactitud absoluta).

- [ ] **Step 5: Grifo `user` en en-grid.js y app.js**

En `src/en-grid.js`:
- En `_enSetTab(tab)` (línea ~549): `window.Blackbox?.event('user', 'tab', { tab });`
- En `_enPin(dorsal)` (línea ~543): `window.Blackbox?.event('user', 'pin', { dorsal });`
- En `_enShowPilotSelect(auto)` (línea ~605): `window.Blackbox?.event('user', 'pilotSelect', { auto: !!auto });`

En `src/app.js`:
- En `_pinSubmit()` (línea ~179), tras validar: `window.Blackbox?.event('user', 'pin-ok', {});` (rama correcta) y `window.Blackbox?.event('user', 'pin-fail', {});` (rama incorrecta) — **nunca** el valor del PIN.
- En `_startDemoNow()` y `_exitDemo()`: `window.Blackbox?.event('user', 'demo', { on: true/false });`

- [ ] **Step 6: Fijar meta al arrancar la sesión**

Donde la app conoce el circuito y la sesión (tras conectar; buscar en `src/app.js`/`setup.js` dónde se resuelve el slug/circuito), llamar una vez:

```js
  window.Blackbox?.setMeta({ app: '1.0.0', circuito: <slug>, sesion: <idSesion|Date.now()>, estadoConexion: 'connected' });
```

- [ ] **Step 7: Verificar en el navegador**

Arrancar el preview (modo demo/replay es suficiente):

Run: preview_start del cliente web y abrir la app en modo demo.
Comprobar en la consola del navegador:

```js
window.Blackbox._ring().size            // > 0 tras unos segundos
window.Blackbox._ring().snapshot().slice(-5)   // eventos in/render/user recientes
await window.Blackbox.export()          // descarga el .json y su payload.resumen.porTipo tiene claves in:*/render:*/user:*
```

Expected: el ring se llena, hay eventos de los tres grifos, y `export()` descarga un fichero con resumen coherente.

- [ ] **Step 8: Commit**

```bash
git add src/index.html src/logger-connector.js src/apex-connector.js src/en-grid.js src/app.js
git commit -m "feat(blackbox): instrumenta grifos de entrada, pintado y acciones de usuario

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Botón de exportar + aviso de recuperación en el panel de admin

**Files:**
- Modify: `src/admin.html`

**Interfaces:**
- Consumes: `window.Blackbox.export()`, `window.Blackbox.recoverLast()`, `window.Blackbox.clear()` (Tasks 4–5).
- Produces: UI para exportar/recuperar/limpiar la caja negra.

- [ ] **Step 1: Añadir el bloque de UI**

En `src/admin.html`, dentro de una sección de diagnóstico (crearla si no existe), añadir:

```html
<section class="bb-diag">
  <h3>Caja negra de diagnóstico</h3>
  <p id="bb-recover" hidden></p>
  <button id="bb-export">Exportar caja negra</button>
  <button id="bb-clear">Borrar log actual</button>
</section>
<script src="en-blackbox.js"></script>
<script>
  (async () => {
    const rec = await window.Blackbox?.recoverLast?.();
    if (rec) {
      const p = document.getElementById('bb-recover');
      p.hidden = false;
      p.textContent = `Hay un log previo de hoy (${rec.key}, ${rec.resumen.totalEventos} eventos). Exporta la caja negra para incluirlo.`;
    }
    document.getElementById('bb-export')?.addEventListener('click', () => window.Blackbox?.export());
    document.getElementById('bb-clear')?.addEventListener('click', () => window.Blackbox?.clear());
  })();
</script>
```

(Ajustar clases/estilo al patrón visual de `admin.html`; si ya carga `en-blackbox.js`, no duplicar el `<script src>`.)

- [ ] **Step 2: Verificar en el navegador**

Run: abrir `admin.html` en el preview.
Comprobar:
- El botón "Exportar caja negra" descarga un `.json` con `resumen` + `eventos`.
- Si hay un log previo del día, aparece el aviso de recuperación.
- "Borrar log actual" vacía el ring (`window.Blackbox._ring().size === 0`).

Expected: los tres comportamientos funcionan; el `.json` abre correctamente y es legible.

- [ ] **Step 3: Commit**

```bash
git add src/admin.html
git commit -m "feat(blackbox): botón de exportar y aviso de recuperación en admin

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Verificación final (tras todas las tareas)

- [ ] `node tests/blackbox.test.js` → todos verdes.
- [ ] Ejecutar el resto de la suite para descartar regresiones: correr cada `tests/*.test.js` (o el runner que uses) y confirmar 0 fallos.
- [ ] Preview en modo demo: ring se llena con los tres grifos; `export()` descarga un `.json` legible; recuperación tras recargar funciona (IndexedDB).
- [ ] Revisar que ningún evento del log contiene nombres de piloto ni la API key/URL del logger.
- [ ] **NO** hacer push/deploy; avisar al usuario de que está listo para revisar y desplegar cuando él quiera.
