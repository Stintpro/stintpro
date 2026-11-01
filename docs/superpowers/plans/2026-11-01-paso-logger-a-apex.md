# Paso automático del logger a Apex — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Si cae el logger, el panel lo avisa a los 10 s y pasa solo a Apex directo a los 20 s, sin volver al logger durante esa sesión.

**Architecture:** Sin conector nuevo. `Logger` guarda los argumentos de `connect()` y, al decidir que ha caído, se desconecta, reasigna `window.ApexConnector = _origApex` y conecta el directo. Un helper `window.ConnBadge` pinta los avisos en pantalla.

**Tech Stack:** JS de navegador sin build; tests con Node, `assert` y `vm`, ejecutados con `node tests/<fichero>.test.js`.

**Spec:** `docs/superpowers/specs/2026-11-01-paso-logger-a-apex-design.md`

## Global Constraints

- Aviso a los 10 000 ms y paso a Apex a los 20 000 ms desde el primer fallo de conexión.
- Texto del aviso: «Logger caído · reconectando» y «Logger caído · datos directos de Apex».
- El panel no vuelve solo al logger; `_connMode` no cambia.
- Solo cancela la cuenta atrás un **mensaje** del logger, no `onopen`.
- Sin push ni despliegue sin confirmación explícita del usuario.
- Mensajes de commit en español, terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Fase 1 — aviso de logger caído

**Files:**
- Modify: `src/apex-connector.js`
- Modify: `src/logger-connector.js`
- Test: `tests/logger-failover.test.js` (nuevo)

**Interfaces:**
- Produces: `window.ConnBadge.set(id: string, text: string|null, bottom: number)`, con `text` null para quitar el aviso. `Logger._loggerDown()`, `Logger._loggerAlive()` y `Logger._clearDown()`.

- [ ] **Step 1: Write the failing test**

Crear `tests/logger-failover.test.js`:

```js
// StintPro — si cae el logger: aviso a los 10 s y paso a Apex directo a los 20 s.
// Ejecutar: node tests/logger-failover.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ApexProtocol = require('../src/apex-protocol');

const leer = (f) => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');
const LOGGER_URL = 'wss://vps.test';

function montar() {
  let ahora = 0, sec = 0;
  const timers = [];
  const sockets = [];
  class FakeWebSocket {
    constructor(url) { this.url = url; this.sent = []; sockets.push(this); }
    send(d) { this.sent.push(d); }
    close() {}
  }
  const nodos = {};
  const sb = {
    console, ApexProtocol, AbortSignal, WebSocket: FakeWebSocket,
    fetch: async () => ({ json: async () => ({ text: '' }), text: async () => '' }),
    localStorage: { getItem: () => '' },
    AppState: { loggerUrl: LOGGER_URL },
    setTimeout: (fn, ms) => { const t = { fn, at: ahora + ms, id: ++sec }; timers.push(t); return t; },
    clearTimeout: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    document: {
      getElementById: (id) => nodos[id] || null,
      createElement: () => ({ style: {}, remove() { delete nodos[this.id]; } }),
      body: { appendChild: (el) => { nodos[el.id] = el; } },
    },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(leer('apex-connector.js'), sb);
  vm.runInContext(leer('logger-connector.js') + '\nvar _LoggerGlobal = Logger; var _origApex = window.ApexConnector;', sb);
  const Logger = sb._LoggerGlobal;
  Logger._getToken = async () => 'token';
  sb.ApexConnector = Logger;

  const args = ['misanino-kart', () => {}, () => {}, null, 8043];
  const avanzar = (ms) => {
    const fin = ahora + ms;
    for (;;) {
      const t = timers.filter(x => x.at <= fin).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!t) break;
      timers.splice(timers.indexOf(t), 1);
      ahora = t.at;
      t.fn();
    }
    ahora = fin;
  };
  const ws = () => sockets[sockets.length - 1];
  const aviso = () => { const n = nodos['logger-down-badge']; return n ? n.textContent : null; };
  const conectar = () => Logger.connect(...args);
  return { sb, Logger, args, sockets, ws, avanzar, aviso, conectar, timers };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('sin aviso si el logger vuelve antes de 10 s', () => {
  const t = montar();
  t.conectar();
  t.ws().onclose();
  t.avanzar(9000);
  t.ws().onmessage({ data: '{"type":"live"}' });
  t.avanzar(30000);
  strictEqual(t.aviso(), null);
});

test('a los 10 s sin logger avisa en pantalla', () => {
  const t = montar();
  t.conectar();
  t.ws().onclose();
  t.avanzar(10000);
  strictEqual(t.aviso(), 'Logger caído · reconectando');
});

test('avisa también si el logger nunca llegó a conectar', () => {
  const t = montar();
  t.conectar();
  t.ws().onerror();
  t.avanzar(10000);
  strictEqual(t.aviso(), 'Logger caído · reconectando');
});

test('un socket que abre y se cierra sin datos no cancela la cuenta atrás', () => {
  const t = montar();
  t.conectar();
  t.ws().onclose();
  t.avanzar(5000);        // reintento del logger
  t.ws().onopen();
  t.ws().onclose();
  t.avanzar(5000);
  strictEqual(t.aviso(), 'Logger caído · reconectando');
});

test('el primer mensaje del logger quita el aviso', () => {
  const t = montar();
  t.conectar();
  t.ws().onclose();
  t.avanzar(11000);
  t.ws().onmessage({ data: '{"type":"live"}' });
  strictEqual(t.aviso(), null);
});

test('al desconectar se quita el aviso', () => {
  const t = montar();
  t.conectar();
  t.ws().onclose();
  t.avanzar(11000);
  t.Logger.disconnect();
  strictEqual(t.aviso(), null);
});

test('un error fatal del logger no avisa', () => {
  const t = montar();
  t.conectar();
  t.ws().onmessage({ data: '{"type":"error","fatal":true,"msg":"no autorizado"}' });
  t.ws().onclose();
  t.avanzar(30000);
  strictEqual(t.aviso(), null);
});

(async () => {
  let passed = 0, failed = 0;
  console.log('\nLogger caído');
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ✓', name); passed++; }
    catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
  }
  console.log(`\n${passed} pasados, ${failed} fallados`);
  process.exit(failed ? 1 : 0);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/logger-failover.test.js`
Expected: FAIL en los tests de aviso («null !== 'Logger caído · reconectando'»).

- [ ] **Step 3: Extraer `ConnBadge` en `src/apex-connector.js`**

Tras las constantes del principio, añadir:

```js
// Avisos de conexión en pantalla: el panel no pinta `onStatus`. Estilo por JS
// (CSSOM), que la CSP no bloquea.
window.ConnBadge = {
  set(id, text, bottom) {
    const doc = window.document;
    if (!doc) return;
    let el = doc.getElementById(id);
    if (!text) { if (el) el.remove(); return; }
    if (!el) {
      el = doc.createElement('div');
      el.id = id;
      el.style.cssText = `position:fixed;left:12px;bottom:${bottom}px;z-index:9999;padding:5px 10px;` +
        'border-radius:8px;font-size:12px;background:rgba(20,22,28,.9);color:#fbbf24;pointer-events:none';
      doc.body.appendChild(el);
    }
    el.textContent = text;
  },
};
```

Sustituir el cuerpo de `_httpBadge(text)` por:

```js
  _httpBadge(text) { window.ConnBadge.set('apex-http-badge', text, 12); },
```

Borrar el comentario anterior de `_httpBadge`. En `disconnect()` del conector directo, tras `this._stopHttp();`, añadir:

```js
    window.ConnBadge.set('logger-down-badge', null);
```

- [ ] **Step 4: Añadir la detección a `src/logger-connector.js`**

Antes de `const Logger = {`:

```js
const LOGGER_DOWN_NOTICE_MS = 10000;  // un reinicio del VPS tarda ~6 s: no avisa
```

En el objeto, tras `_raceStopped: false,...`:

```js
  _downNoticeTimer: null,
```

En `connect()`, justo después de `this.slug = slug;`:

```js
    this._clearDown();
```

En `_doConnect()`, primera línea de `this.ws.onmessage`:

```js
        this._clearDown();
```

Añadir `this._loggerDown();` como última instrucción de `this.ws.onerror` y primera de `this.ws.onclose`, y también en el `catch` de `_doConnect()`.

En `disconnect()`, tras `this.slug = null;`:

```js
    this._clearDown();
```

Tras `_disarm(ws) { ... },` añadir:

```js
  // Cuenta atrás de logger caído. Solo un mensaje la cancela: abrir no basta,
  // un socket que abre y se cierra sin datos no demuestra nada.
  _loggerDown() {
    if (!this.slug || this._downNoticeTimer) return;
    this._downNoticeTimer = setTimeout(() => {
      window.ConnBadge?.set('logger-down-badge', 'Logger caído · reconectando', 44);
    }, LOGGER_DOWN_NOTICE_MS);
  },

  _clearDown() {
    if (this._downNoticeTimer) { clearTimeout(this._downNoticeTimer); this._downNoticeTimer = null; }
    window.ConnBadge?.set('logger-down-badge', null);
  },
```

- [ ] **Step 5: Run tests**

Run: `node tests/logger-failover.test.js && node tests/apex-http-fallback.test.js`
Expected: PASS, 7 y 17 tests.

- [ ] **Step 6: Commit**

```bash
git add src/apex-connector.js src/logger-connector.js tests/logger-failover.test.js
git commit -m "Panel: aviso en pantalla cuando se pierde el logger"
```

---

### Task 2: Fase 2 — paso a Apex a los 20 s

**Files:**
- Modify: `src/logger-connector.js`
- Test: `tests/logger-failover.test.js`

**Interfaces:**
- Consumes: `window.ConnBadge.set`, `Logger._loggerDown()`, `Logger._clearDown()` de Task 1; el global `_origApex` de `src/setup.js`.
- Produces: `Logger._connectArgs: any[]`, `Logger._failover()`.

- [ ] **Step 1: Write the failing tests**

Añadir en `tests/logger-failover.test.js`, antes del bloque `(async () => {`:

```js
test('a los 20 s pasa a Apex con los mismos argumentos', () => {
  const t = montar();
  t.conectar();
  t.ws().onclose();
  t.avanzar(20000);
  strictEqual(t.sb.ApexConnector, t.sb._origApex);
  strictEqual(t.sb.ApexConnector.slug, 'misanino-kart');
  strictEqual(t.sb.ApexConnector.port, 8043);
  strictEqual(t.sb.ApexConnector.onData, t.args[1]);
  ok(t.ws().url.includes('live-data.apex-timing.com:8043'), t.ws().url);
  strictEqual(t.aviso(), 'Logger caído · datos directos de Apex');
});

test('tras el cambio no quedan reintentos al logger', () => {
  const t = montar();
  t.conectar();
  t.ws().onclose();
  t.avanzar(18000);
  t.ws().onclose();       // deja un reintento pendiente para los 23 s
  t.avanzar(2000);
  const n = t.sockets.filter(s => s.url === LOGGER_URL).length;
  t.avanzar(60000);
  strictEqual(t.sockets.filter(s => s.url === LOGGER_URL).length, n);
});

test('sin cambio si el logger vuelve antes de 20 s', () => {
  const t = montar();
  t.conectar();
  t.ws().onclose();
  t.avanzar(15000);
  t.ws().onmessage({ data: '{"type":"live"}' });
  t.avanzar(30000);
  strictEqual(t.sb.ApexConnector, t.Logger);
});

test('desconectar anula el cambio', () => {
  const t = montar();
  t.conectar();
  t.ws().onclose();
  t.avanzar(15000);
  t.Logger.disconnect();
  t.avanzar(30000);
  strictEqual(t.sb.ApexConnector, t.Logger);
});

test('un error fatal no provoca el cambio', () => {
  const t = montar();
  t.conectar();
  t.ws().onmessage({ data: '{"type":"error","fatal":true,"msg":"no autorizado"}' });
  t.ws().onclose();
  t.avanzar(30000);
  strictEqual(t.sb.ApexConnector, t.Logger);
});

test('en modo replay no interfiere', () => {
  const t = montar();
  t.conectar();
  t.ws().onclose();
  const replay = {};
  t.sb.ApexConnector = replay;
  t.avanzar(30000);
  strictEqual(t.sb.ApexConnector, replay);
});

test('al acabar la sesión en directo se quita el aviso', () => {
  const t = montar();
  t.conectar();
  t.ws().onclose();
  t.avanzar(20000);
  t.sb.ApexConnector.disconnect();
  strictEqual(t.aviso(), null);
});

test('la sesión siguiente vuelve a empezar por el logger', () => {
  const t = montar();
  t.conectar();
  t.ws().onclose();
  t.avanzar(20000);
  t.sb.ApexConnector.disconnect();
  t.sb.ApexConnector = t.Logger;   // lo que hace selectRaceType con _connMode='logger'
  t.conectar();
  strictEqual(t.ws().url, LOGGER_URL);
  t.ws().onmessage({ data: '{"type":"live"}' });
  t.avanzar(30000);
  strictEqual(t.sb.ApexConnector, t.Logger);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/logger-failover.test.js`
Expected: FAIL en los tests de cambio, que siguen en `Logger`.

- [ ] **Step 3: Implementar el paso**

En `src/logger-connector.js`, junto a la constante anterior:

```js
const LOGGER_DOWN_SWITCH_MS = 20000;
```

En el objeto, tras `_downNoticeTimer: null,`:

```js
  _downSwitchTimer: null,
  _connectArgs: null,
```

En `connect()`, tras `this._clearDown();`:

```js
    this._connectArgs = [slug, onData, onStatus, onComment, port, onTitle, onMessage, onNewSession];
```

En `_loggerDown()`, tras programar el aviso:

```js
    this._downSwitchTimer = setTimeout(() => this._failover(), LOGGER_DOWN_SWITCH_MS);
```

En `_clearDown()`, antes de quitar el aviso:

```js
    if (this._downSwitchTimer) { clearTimeout(this._downSwitchTimer); this._downSwitchTimer = null; }
```

Tras `_clearDown()`:

```js
  // Sin vuelta automática: un segundo cambio de fuente en carrera arriesga más
  // que seguir en Apex, y la radio tiene su propia conexión al VPS.
  _failover() {
    if (window.ApexConnector !== this) return;
    const args = this._connectArgs;
    this.disconnect();
    window.ApexConnector = _origApex;
    _origApex.connect(...args);
    window.ConnBadge?.set('logger-down-badge', 'Logger caído · datos directos de Apex', 44);
  },
```

- [ ] **Step 4: Run all client tests**

Run: `for t in tests/*.test.js; do node "$t" >/dev/null 2>&1 || echo "FALLA $t"; done; node tests/logger-failover.test.js | tail -n 1`
Expected: ninguna línea `FALLA`; 15 pasados, 0 fallados.

- [ ] **Step 5: Commit**

```bash
git add src/logger-connector.js tests/logger-failover.test.js
git commit -m "Panel: paso automático a Apex directo si cae el logger"
```

---

### Task 3: Validación en vivo con dos paneles

Requiere una sesión real y el panel con login, así que la ejecuta el usuario con Claude guiando. Antes hay que publicar en Vercel, con confirmación explícita. Usa la web pública porque el logger exige login.

**Files:**
- Modify: `docs/superpowers/specs/2026-11-01-paso-logger-a-apex-design.md`, añadiendo el resultado

- [ ] **Step 1: Abrir dos pestañas**

Con una resistencia en curso, abrir el panel en dos pestañas en modo logger, con el mismo circuito y dorsal.

- [ ] **Step 2: Simular la caída en la pestaña B**

En la consola de la pestaña B:

```js
Logger._serverUrl = 'wss://invalid.invalid'; Logger.ws.close();
```

Expected: aviso a los 10 s, cambio de texto a los 20 s y `ApexConnector === _origApex` en consola.

- [ ] **Step 3: Comparar tras 20 min**

Ejecutar en las dos pestañas y comparar:

```js
JSON.stringify({
  vueltas: Object.fromEntries(EnSession.data.equipos.map(e => [e.dorsal, (e.lapHistory || []).length])),
  posiciones: Object.fromEntries(EnSession.data.equipos.map(e => [e.dorsal, e.pos])),
  cola: (EnBox.queue || []).map(k => k.dorsal ?? k.id ?? null),
  stint: EnSession.stintStart,
})
```

Expected: mismas vueltas por kart, posiciones y stint. Sin duplicados. Toda diferencia de cola se atribuye a una parada ocurrida durante el corte; si no, se abre un bug.

- [ ] **Step 4: Registrar el resultado**

Añadir a la spec una sección `## Validación` con fecha, carrera, diferencias y decisión.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-11-01-paso-logger-a-apex-design.md
git commit -m "Spec: resultado de la validación del paso a Apex"
```
