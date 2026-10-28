# Radio web móvil — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una página `src/radio.html` (solo móvil) desde la que una persona con cuenta StintPro manda mensajes de radio al piloto en pista sin abrir el panel.

**Architecture:** La página habla con el logger del VPS por el mismo WebSocket que el panel. Un mensaje nuevo, `team_watch`, le da la lista de pilotos y la presencia sin publicar. Cuando no hay un panel conectado, la página publica la plantilla de Apex (`request.php` `.INF`) como `team_roster{source:'radio'}`. La lógica pura vive en `src/radio-core.js` (con tests); el DOM, en `src/radio.js`.

**Tech Stack:** Node + Jest + ws (logger), JS de navegador sin build (UMD como el resto de `src/`), tests del cliente con `node tests/*.test.js`, Firebase Auth compat (`SPAuth`).

**Spec:** `docs/superpowers/specs/2026-10-28-radio-web-movil-design.md`

## Global Constraints

- Mensaje al piloto: máximo **40** caracteres; tonos solo `red`, `orange`, `blue`.
- Lista de pilotos: máximo **10** pilotos, nombres de máximo **40** caracteres; dorsal de máximo **16**.
- **El panel siempre gana**: una lista `source:'radio'` se rechaza con `lista del panel activa` mientras un panel que publicó la lista siga conectado.
- Compatibilidad: el panel actual no manda `source` ni `team_watch` y debe seguir funcionando igual; los móviles reciben `team_roster` con la **misma forma de hoy** (`{type, pilotos, current}`).
- Todo texto del servidor o de Apex se pinta con `textContent` o `replaceChildren`; nunca con `innerHTML` en `radio.js`.
- Móvil: todo lo pulsable ≥ **56 px** de alto y ≥ **8 px** de separación; letra del campo de texto ≥ **16 px**; `viewport-fit=cover` + `env(safe-area-inset-*)`.
- Anti-repetición: **2 s** por mensaje; refresco de Apex cada **60 s**; sin respuesta al envío en **5 s** → «Sin confirmación del servidor».
- Sin cola offline: sin WS autenticado, los botones de envío quedan desactivados.
- Sin frameworks, sin service worker, sin cambios en la CSP de `vercel.json`.
- Comentarios y textos de UI en español, con el estilo de los ficheros vecinos.
- Commits terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Sin push ni despliegue** dentro del plan.

---

### Task 1: team-link — `source` en la lista y observadores (`watch`)

**Files:**
- Modify: `stintpro-logger/team-link.js`
- Test: `stintpro-logger/__tests__/team-link.test.js`

**Interfaces:**
- Produces:
  - `validateRoster(msg)` → `{ dorsal, pilotos, current, source }`, donde `source` es `'panel'` (por defecto) o `'radio'`; otro valor → `{ error: 'source inválido' }`.
  - `teamLink.setRoster(ws, slug, roster)` → `{ ok: true }` o `{ error: 'lista del panel activa' }`.
  - `teamLink.watch(ws, slug, dorsal)`: al apuntarse envía `{type:'team_roster', pilotos, current, source, panel}` (con `pilotos:null, current:null, source:null, panel:false` si no hay lista) y `{type:'pilot_presence', dorsal, connected}`.
  - Los observadores reciben ese mismo `team_roster` con `source` y `panel` en cada cambio de lista y cuando se desconecta el último panel, además de cada `pilot_presence`.
  - `panel` es `true` si algún socket que publicó con `source:'panel'` sigue abierto.

- [ ] **Step 1: Escribir los tests que fallan**

En `__tests__/team-link.test.js`, ajustar la expectativa existente de `validateRoster`, que ahora incluye `source`:

```js
  test('acepta una lista válida y normaliza', () => {
    expect(validateRoster({ dorsal: 17, pilotos: [' Javier ', 'Pablo'], current: 1 }))
      .toEqual({ dorsal: '17', pilotos: ['Javier', 'Pablo'], current: 1, source: 'panel' });
  });
  test('source radio se conserva; otro valor se rechaza', () => {
    expect(validateRoster({ dorsal: '7', pilotos: ['A'], source: 'radio' }).source).toBe('radio');
    expect(validateRoster({ dorsal: '7', pilotos: ['A'], source: 'x' }).error).toBe('source inválido');
  });
```

Añadir al final del fichero:

```js
describe('watch (radio web)', () => {
  const R = (over = {}) => ({ dorsal: '7', pilotos: ['Ana', 'Luis'], current: 0, source: 'panel', ...over });

  test('al apuntarse recibe la lista vacía y la presencia', () => {
    const tl = createTeamLink({ heartbeatMs: 0 });
    const w = fakeWs();
    tl.watch(w, 'henakart', '7');
    expect(w.last('team_roster')).toEqual({ type: 'team_roster', pilotos: null, current: null, source: null, panel: false });
    expect(w.last('pilot_presence')).toEqual({ type: 'pilot_presence', dorsal: '7', connected: [] });
  });

  test('recibe la lista del panel con source y panel:true, y los cambios', () => {
    const tl = createTeamLink({ heartbeatMs: 0 });
    const panel = fakeWs(), w = fakeWs();
    tl.watch(w, 'henakart', '7');
    tl.setRoster(panel, 'henakart', R());
    expect(w.last('team_roster')).toEqual({ type: 'team_roster', pilotos: ['Ana', 'Luis'], current: 0, source: 'panel', panel: true });
    tl.setRoster(panel, 'henakart', R({ current: 1 }));
    expect(w.last('team_roster').current).toBe(1);
  });

  test('los móviles siguen recibiendo la forma de siempre (sin source)', () => {
    const tl = createTeamLink({ heartbeatMs: 0 });
    const panel = fakeWs(), movil = fakeWs();
    tl.registerPilot(movil, 'henakart', '7', 0);
    tl.setRoster(panel, 'henakart', R());
    expect(movil.last('team_roster')).toEqual({ type: 'team_roster', pilotos: ['Ana', 'Luis'], current: 0 });
  });

  test('recibe la presencia cuando un móvil se conecta y se va', () => {
    const tl = createTeamLink({ heartbeatMs: 0 });
    const w = fakeWs(), movil = fakeWs();
    tl.watch(w, 'henakart', '7');
    tl.registerPilot(movil, 'henakart', '7', 1);
    expect(w.last('pilot_presence').connected).toEqual([1]);
    movil.emit('close');
    expect(w.last('pilot_presence').connected).toEqual([]);
  });

  test('lista radio rechazada con panel conectado; aceptada cuando el panel se va', () => {
    const tl = createTeamLink({ heartbeatMs: 0 });
    const panel = fakeWs(), radio = fakeWs();
    tl.watch(radio, 'henakart', '7');
    tl.setRoster(panel, 'henakart', R());
    expect(tl.setRoster(radio, 'henakart', R({ pilotos: ['X'], source: 'radio' }))).toEqual({ error: 'lista del panel activa' });
    expect(tl.getRoster('henakart', '7').pilotos).toEqual(['Ana', 'Luis']);
    panel.emit('close');
    expect(radio.last('team_roster')).toMatchObject({ source: 'panel', panel: false });
    expect(tl.setRoster(radio, 'henakart', R({ pilotos: ['X'], source: 'radio' }))).toEqual({ ok: true });
    expect(radio.last('team_roster')).toEqual({ type: 'team_roster', pilotos: ['X'], current: 0, source: 'radio', panel: false });
  });

  test('un panel pisa una lista radio', () => {
    const tl = createTeamLink({ heartbeatMs: 0 });
    const panel = fakeWs(), radio = fakeWs();
    tl.setRoster(radio, 'henakart', R({ source: 'radio' }));
    expect(tl.setRoster(panel, 'henakart', R({ pilotos: ['P'] }))).toEqual({ ok: true });
    expect(tl.getRoster('henakart', '7').pilotos).toEqual(['P']);
  });

  test('un nuevo watch sustituye al anterior y el cierre lo quita', () => {
    const tl = createTeamLink({ heartbeatMs: 0 });
    const w = fakeWs(), movil = fakeWs();
    tl.watch(w, 'henakart', '7');
    tl.watch(w, 'henakart', '8');
    const n = w.sent.length;
    tl.registerPilot(movil, 'henakart', '7', 0);
    expect(w.sent.length).toBe(n);           // ya no observa el 7
    w.emit('close');
    tl.registerPilot(fakeWs(), 'henakart', '8', 0);
    expect(w.sent.length).toBe(n);           // ni el 8 tras cerrar
  });
});
```

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `cd stintpro-logger && npx jest __tests__/team-link.test.js`
Expected: FAIL (`tl.watch is not a function`, falta `source` en `validateRoster`).

- [ ] **Step 3: Implementación**

En `validateRoster`, sustituir el `return { dorsal, pilotos, current };` final por:

```js
  const source = msg.source ?? 'panel';
  if (source !== 'panel' && source !== 'radio') return { error: 'source inválido' };
  return { dorsal, pilotos, current, source };
```

En `createTeamLink`, añadir el mapa de observadores y las funciones auxiliares, y sustituir `presence`, `setRoster` y `drop` (el resto queda igual). Actualizar también el comentario de cabecera del fichero con un párrafo sobre la radio web:

```js
  const watchers = new Map(); // ws (radio web) → key: observa un dorsal sin publicar

  const dorsalOfKey = key => key.slice(key.indexOf('|') + 1);
  const watchersOf  = key => [...watchers].filter(([, k]) => k === key).map(([w]) => w);
  const panelLive   = r => [...r.panelPubs].some(p => p.readyState === OPEN);

  // A observadores: la lista con su origen y si queda un panel conectado.
  function watcherRoster(key) {
    const r = rosters.get(key);
    return r
      ? { type: 'team_roster', pilotos: r.pilotos, current: r.current, source: r.source, panel: panelLive(r) }
      : { type: 'team_roster', pilotos: null, current: null, source: null, panel: false };
  }

  // A los paneles y observadores del dorsal (o solo a `only`): qué pilotos tienen móvil conectado.
  function presence(key, only) {
    const r = rosters.get(key);
    const msg = { type: 'pilot_presence', dorsal: r ? r.dorsal : dorsalOfKey(key), connected: connectedFor(key) };
    const to = only ? [only] : [...(r ? r.publishers : []), ...watchersOf(key)];
    for (const ws of new Set(to)) send(ws, msg);
  }

  // El panel siempre gana: una lista de la radio web no pisa la de un panel conectado.
  function setRoster(ws, slug, roster) {
    const key = keyOf(slug, roster.dorsal);
    const source = roster.source || 'panel';
    let r = rosters.get(key);
    if (r && source === 'radio' && r.source === 'panel' && panelLive(r)) return { error: 'lista del panel activa' };
    if (!r) { r = { dorsal: roster.dorsal, publishers: new Set(), panelPubs: new Set() }; rosters.set(key, r); }
    r.pilotos = roster.pilotos;
    r.current = roster.current;
    r.source  = source;
    r.publishers.add(ws);
    if (source === 'panel') r.panelPubs.add(ws); else r.panelPubs.delete(ws);
    hook(ws);
    const out = { type: 'team_roster', pilotos: r.pilotos, current: r.current };
    for (const [m, e] of pilots) if (e.key === key) send(m, out);
    const wr = watcherRoster(key);
    for (const w of watchersOf(key)) send(w, wr);
    presence(key, ws);
    return { ok: true };
  }

  function watch(ws, slug, dorsal) {
    const key = keyOf(slug, cleanDorsal(dorsal));
    watchers.set(ws, key);
    hook(ws);
    send(ws, watcherRoster(key));
    send(ws, { type: 'pilot_presence', dorsal: cleanDorsal(dorsal), connected: connectedFor(key) });
  }

  function drop(ws) {
    watchers.delete(ws);
    const e = pilots.get(ws);
    if (e) { pilots.delete(ws); presence(e.key); }
    for (const [key, r] of rosters) {
      r.publishers.delete(ws);
      // Se fue el último panel: los observadores pueden tomar el relevo.
      if (r.panelPubs.delete(ws) && !panelLive(r)) {
        const wr = watcherRoster(key);
        for (const w of watchersOf(key)) send(w, wr);
      }
    }
  }
```

Exportar `watch`: `return { setRoster, getRoster, registerPilot, deliver, drop, watch, stop };`

Nota: el `ws.on('close')` de `hook` se dispara antes de que `readyState` pase a 3 en los fakes. Por eso `drop` quita el socket de `panelPubs` *antes* de calcular `panelLive`.

- [ ] **Step 4: Ejecutar y ver que pasan**

Run: `cd stintpro-logger && npx jest __tests__/team-link.test.js __tests__/team-link-ws.test.js`
Expected: PASS (el test WS de integración no cambia de comportamiento).

- [ ] **Step 5: Commit**

```bash
git add stintpro-logger/team-link.js stintpro-logger/__tests__/team-link.test.js
git commit -m "logger: team-link con origen de la lista y observadores (radio web)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: logger — mensaje `team_watch` y rechazo de lista en server.js y replay

**Files:**
- Modify: `stintpro-logger/server.js` (handlers de equipo, ~líneas 1052-1080)
- Modify: `stintpro-logger/replay-vps.js` (~líneas 90-115)
- Test: `stintpro-logger/__tests__/team-link-ws.test.js`

**Interfaces:**
- Consumes: `teamLink.watch(ws, slug, dorsal)`, `teamLink.setRoster(...) → {ok}|{error}` (Task 1).
- Produces: WS `team_watch {slug, dorsal}`. Los errores llevan `about:'team_watch'`: `Circuito '<slug>' no encontrado`, `dorsal requerido (≤16)`. Un `team_roster` rechazado responde `{type:'error', msg:'lista del panel activa', about:'team_roster'}`.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `__tests__/team-link-ws.test.js` (reutiliza `client`, `waitFor`, `send`, `ROSTER`):

```js
test('team_watch: lista y presencia al apuntarse y lista del panel en vivo', async () => {
  const radio = await client(), panel = await client();
  send(radio, { type: 'team_watch', slug: 'test-slug', dorsal: '81' });
  expect(await waitFor(radio, m => m.type === 'team_roster'))
    .toEqual({ type: 'team_roster', pilotos: null, current: null, source: null, panel: false });
  expect(await waitFor(radio, m => m.type === 'pilot_presence')).toEqual({ type: 'pilot_presence', dorsal: '81', connected: [] });
  send(panel, { ...ROSTER, dorsal: '81' });
  expect(await waitFor(radio, m => m.type === 'team_roster'))
    .toEqual({ type: 'team_roster', pilotos: ['Javier', 'Pablo'], current: 0, source: 'panel', panel: true });
  [radio, panel].forEach(w => w.close());
});

test('lista de la radio rechazada con panel conectado y aceptada al irse', async () => {
  const radio = await client(), panel = await client();
  send(panel, { ...ROSTER, dorsal: '82' });
  await waitFor(panel, m => m.type === 'pilot_presence');
  send(radio, { type: 'team_watch', slug: 'test-slug', dorsal: '82' });
  await waitFor(radio, m => m.type === 'team_roster');
  send(radio, { type: 'team_roster', slug: 'test-slug', dorsal: '82', pilotos: ['Apex'], current: 0, source: 'radio' });
  expect(await waitFor(radio, m => m.type === 'error'))
    .toEqual({ type: 'error', msg: 'lista del panel activa', about: 'team_roster' });
  panel.close();
  await waitFor(radio, m => m.type === 'team_roster' && m.panel === false);
  send(radio, { type: 'team_roster', slug: 'test-slug', dorsal: '82', pilotos: ['Apex'], current: 0, source: 'radio' });
  expect(await waitFor(radio, m => m.type === 'team_roster' && m.source === 'radio'))
    .toMatchObject({ pilotos: ['Apex'], current: 0 });
  radio.close();
});

test.each([
  [{ type: 'team_watch', slug: 'circuito-fantasma', dorsal: '7' }, "Circuito 'circuito-fantasma' no encontrado"],
  [{ type: 'team_watch', slug: 'test-slug', dorsal: '' }, 'dorsal requerido (≤16)'],
])('team_watch inválido %j → error con about', async (msg, text) => {
  const ws = await client();
  send(ws, msg);
  expect(await waitFor(ws, m => m.type === 'error')).toEqual({ type: 'error', msg: text, about: 'team_watch' });
  ws.close();
});
```

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `cd stintpro-logger && npx jest __tests__/team-link-ws.test.js`
Expected: FAIL (`Tipo desconocido: team_watch`; el rechazo no llega).

- [ ] **Step 3: Implementación en server.js**

En el handler `team_roster`, sustituir `teamLink.setRoster(ws, slug, r);` por:

```js
      const res = teamLink.setRoster(ws, slug, r);
      if (res.error) ws.send(JSON.stringify({ type: 'error', msg: res.error, about: 'team_roster' }));
```

Justo después del bloque `roster_get`, añadir:

```js
    // team_watch — la radio web observa un dorsal sin publicar: recibe la
    // lista (con su origen y si hay panel conectado) y la presencia de móviles.
    if (msg.type === 'team_watch') {
      const slug   = (msg.slug || '').trim();
      const dorsal = (msg.dorsal ?? '').toString().trim();
      if (!monitors.get(slug)) {
        ws.send(JSON.stringify({ type: 'error', msg: `Circuito '${slug}' no encontrado`, about: 'team_watch' }));
        return;
      }
      if (!dorsal || dorsal.length > 16) {
        ws.send(JSON.stringify({ type: 'error', msg: 'dorsal requerido (≤16)', about: 'team_watch' }));
        return;
      }
      teamLink.watch(ws, slug, dorsal);
      return;
    }
```

- [ ] **Step 4: Lo mismo en replay-vps.js** (para probar en local)

En la rama `team_roster`, sustituir `teamLink.setRoster(ws, slug, r);` por:

```js
        const res = teamLink.setRoster(ws, slug, r);
        if (res.error) return err(res.error, { about: 'team_roster' });
```

Añadir una rama antes del `team_msg`:

```js
      } else if (msg.type === 'team_watch') {
        const dorsal = (msg.dorsal ?? '').toString().trim();
        if (!dorsal || dorsal.length > 16) return err('dorsal requerido (≤16)', { about: 'team_watch' });
        teamLink.watch(ws, slug, dorsal);
```

(Ver la firma real de `err` y de la variable `slug` en el fichero; mantener el estilo de las ramas vecinas.)

- [ ] **Step 5: Ejecutar toda la suite del logger**

Run: `cd stintpro-logger && npx jest`
Expected: PASS en todos.

- [ ] **Step 6: Commit**

```bash
git add stintpro-logger/server.js stintpro-logger/replay-vps.js stintpro-logger/__tests__/team-link-ws.test.js
git commit -m "logger: team_watch para la radio web y rechazo de lista con panel activo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: EnApexTeam — `rowIdFor`, `infRequest` y `fetchInf` reutilizables

**Files:**
- Modify: `src/en-apex-team.js` (núcleo de la factoría y `_apexRowIdOf` del bloque de navegador)
- Test: `tests/apex-team.test.js`

**Interfaces:**
- Produces (en `EnApexTeam`):
  - `infRequest(id: string) → string` = `` `D#1#D${id}.INF` ``.
  - `rowIdFor(slug, port, dorsal, { WebSocket, parseGrid, timeoutMs = 12000 }) → Promise<string|null>`. `parseGrid(html)` devuelve un array de `{ dorsal, rowId }`. Se conecta a `wss://live-data.apex-timing.com:${port}/`, envía `slug` y lee la primera línea `grid|`.
  - `fetchInf(httpPort, rowId, fetchFn, timeoutMs = 12000) → Promise<{team, drivers:[{id,num,name,current}]}|null>`. `rowId` puede venir con o sin `r`; `null` si hay fallo de red, respuesta `error` o vacía.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir antes del resumen final de `tests/apex-team.test.js` (el fichero ya tiene la constante con la línea `.INF` real de ejemplo; reutilizar esa respuesta si su nombre es accesible, o esta copia):

```js
console.log('\nRadio web: fila del dorsal y plantilla');
const INF_70 = 'D70.INF#<driver  id="70" member="0" center="5" num="7" name="EQUIPO UNO " nat="ESP"><driver  id="10" member="0" num="1" name="RESERVA SIN RODAR" nat="" color="#000000"/><driver  id="11" member="0" num="2" name="ANA  LÓPEZ" nat="" color="#000000" current="1"/></driver>';

test('infRequest pide solo la plantilla', () => {
  strictEqual(A.infRequest('70'), 'D#1#D70.INF');
});

// WebSocket falso: al abrir manda `lines`; registra lo enviado y si se cerró.
function fakeWsClass(lines, log) {
  return class {
    constructor(url) { log.url = url; this.closed = false; setTimeout(() => { this.onopen && this.onopen(); lines.forEach(l => this.onmessage && this.onmessage({ data: l })); }, 0); }
    send(s) { log.sent = s; }
    close() { log.closed = true; }
  };
}
const asyncTests = [];
function testAsync(name, fn) { asyncTests.push([name, fn]); }

testAsync('rowIdFor: lee la parrilla y devuelve la fila del dorsal', async () => {
  const log = {};
  const id = await A.rowIdFor('henakart', 9983, ' 7 ', {
    WebSocket: fakeWsClass(['init|r|', 'grid|<tr>…</tr>'], log),
    parseGrid: html => [{ dorsal: '3', rowId: 'r100' }, { dorsal: '7', rowId: 'r70' }],
  });
  strictEqual(id, 'r70');
  strictEqual(log.url, 'wss://live-data.apex-timing.com:9983/');
  strictEqual(log.sent, 'henakart');
  ok(log.closed);
});
testAsync('rowIdFor: dorsal ausente → null; sin dependencias → null', async () => {
  const id = await A.rowIdFor('henakart', 9983, '99', { WebSocket: fakeWsClass(['grid|x'], {}), parseGrid: () => [{ dorsal: '7', rowId: 'r70' }] });
  strictEqual(id, null);
  strictEqual(await A.rowIdFor('henakart', 9983, '7', {}), null);
});
testAsync('rowIdFor: sin parrilla → null al vencer el plazo', async () => {
  const id = await A.rowIdFor('henakart', 9983, '7', { WebSocket: fakeWsClass([], {}), parseGrid: () => [], timeoutMs: 20 });
  strictEqual(id, null);
});
testAsync('fetchInf: POST al puerto http con la petición .INF y plantilla parseada', async () => {
  let call;
  const fetchFn = async (url, opts) => { call = { url, opts }; return { ok: true, text: async () => INF_70 + '\n' }; };
  const inf = await A.fetchInf(9980, 'r70', fetchFn);
  strictEqual(call.url, A.REQUEST_URL);
  strictEqual(call.opts.body, 'port=9980&request=' + encodeURIComponent('D#1#D70.INF'));
  deepStrictEqual(inf.drivers.map(d => [d.name, d.current]), [['RESERVA SIN RODAR', false], ['ANA LÓPEZ', true]]);
});
testAsync('fetchInf: error, vacío o red caída → null', async () => {
  strictEqual(await A.fetchInf(9980, 'r70', async () => ({ ok: true, text: async () => 'error' })), null);
  strictEqual(await A.fetchInf(9980, 'r70', async () => ({ ok: true, text: async () => '' })), null);
  strictEqual(await A.fetchInf(9980, 'r70', async () => { throw new Error('red'); }), null);
  strictEqual(await A.fetchInf(0, 'r70', async () => ({})), null);
});
```

Sustituir el cierre del fichero (las dos últimas líneas) por:

```js
(async () => {
  for (const [name, fn] of asyncTests) {
    try { await fn(); console.log('  ✓', name); passed++; }
    catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
  }
  console.log(`\n${passed} OK, ${failed} fallos\n`);
  if (failed) process.exit(1);
})();
```

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `node tests/apex-team.test.js`
Expected: FAIL (`A.infRequest is not a function`, …).

- [ ] **Step 3: Implementación en el núcleo de `en-apex-team.js`**

Dentro de la factoría, tras `requestFor`:

```js
  // Solo la plantilla (la radio web la repite cada minuto: sin vueltas ni paradas).
  const infRequest = id => `D#1#D${id}.INF`;
```

Antes del `return` de la factoría:

```js
  // Fila rNNN de un dorsal: conexión WS puntual a Apex que se cierra en cuanto
  // llega la parrilla. WebSocket y parseGrid se inyectan (navegador o tests).
  function rowIdFor(slug, port, dorsal, deps) {
    const { WebSocket: WS, parseGrid, timeoutMs = 12000 } = deps || {};
    const my = String(dorsal ?? '').trim();
    if (!slug || !port || !my || !WS || !parseGrid) return Promise.resolve(null);
    return new Promise(resolve => {
      let done = false, ws = null;
      const end = v => {
        if (done) return; done = true; clearTimeout(timer);
        try { ws.onmessage = ws.onerror = ws.onclose = null; ws.close(); } catch (e) {}
        resolve(v);
      };
      const timer = setTimeout(() => end(null), timeoutMs);
      try {
        ws = new WS(`wss://live-data.apex-timing.com:${port}/`);
        ws.onopen = () => { try { ws.send(slug); } catch (e) {} };
        ws.onmessage = ev => {
          const line = String(ev.data).split('\n').find(l => l.startsWith('grid|'));
          if (!line) return;
          try {
            const k = (parseGrid(line.substring(5)) || []).find(x => String(x.dorsal).trim() === my);
            end(k ? k.rowId : null);
          } catch (e) { end(null); }
        };
        ws.onerror = () => end(null);
        ws.onclose = () => end(null);
      } catch (e) { end(null); }
    });
  }

  // Plantilla del equipo (.INF) por request.php; null si Apex no la da.
  async function fetchInf(httpPort, rowId, fetchFn, timeoutMs = 12000) {
    const id = String(rowId || '').replace(/^r/, '');
    if (!httpPort || httpPort < 1 || !id || !fetchFn) return null;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetchFn(REQUEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'port=' + httpPort + '&request=' + encodeURIComponent(infRequest(id)),
        signal: ctrl ? ctrl.signal : undefined,
      });
      const text = (await res.text()).trim();
      if (!res.ok || !text || text === 'error') return null;
      return parseInf(text);
    } catch (e) { return null; }
    finally { if (t) clearTimeout(t); }
  }
```

Ampliar el `return` de la factoría con `infRequest, rowIdFor, fetchInf`.

En el bloque de navegador, sustituir el `return new Promise(...)` de `_apexRowIdOf` (desde `if (!cfg.port || ...` hasta el final de la función) por:

```js
    if (!window.ApexGrid || typeof WebSocket === 'undefined') return Promise.resolve(null);
    return EnApexTeam.rowIdFor(cfg.slug, cfg.port, my, {
      WebSocket, parseGrid: html => window.ApexGrid.parseGridHtml(html).karts,
    });
```

Si `pick` deja de usarse, mantenerlo solo para la rama del conector directo, que ya lo usa.

- [ ] **Step 4: Ejecutar y ver que pasan**

Run: `node tests/apex-team.test.js`
Expected: PASS (los tests anteriores siguen verdes).

- [ ] **Step 5: Commit**

```bash
git add src/en-apex-team.js tests/apex-team.test.js
git commit -m "EnApexTeam: fila del dorsal y plantilla .INF reutilizables (radio web)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `radio-core.js` — lógica pura de la radio web

**Files:**
- Create: `src/radio-core.js`
- Test: `tests/radio-core.test.js`

**Interfaces:**
- Consumes: forma de `team_roster` del observador `{pilotos, current, source, panel}` (Task 1); `{drivers:[{name,current}]}` de `fetchInf` (Task 3).
- Produces (`window.RadioCore` / `module.exports`):
  - `MAX_TEXT = 40`, `COOLDOWN_MS = 2000`
  - `rosterFromInf(inf) → {pilotos, current}|null`
  - `chooseRoster(server, apex) → {mode:'panel'|'radio'|'dorsal', pilotos:string[], current:number|null, publish:boolean}`
  - `keepPick(picked, prev, next) → number|null`: la elección manual se descarta si cambia la lista o el piloto en pista.
  - `pickTarget(picked, roster) → number|null`
  - `rosterMessage(slug, dorsal, roster) → {type:'team_roster', slug, dorsal, pilotos, current, source:'radio'}`
  - `teamMessage({slug, dorsal, roster, target, text, tone, id}) → team_msg | {error}`
  - `resultLabel(ack, name, dorsal) → {ok:boolean, text:string}`, con `name = null` en modo dorsal.
  - `createCooldown(ms?) → { tryFire(key, now) → boolean }`
  - `reconnectDelay(attempt) → ms` (1000, 2000, 5000, 5000…)

- [ ] **Step 1: Escribir los tests que fallan** — `tests/radio-core.test.js`:

```js
// StintPro — lógica de la radio web móvil (radio-core.js).
// Ejecutar: node tests/radio-core.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert');
const R = require('../src/radio-core');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const INF = { team: 'EQ', drivers: [{ name: 'ANA', current: false }, { name: 'LUIS', current: true }] };
const APEX = { pilotos: ['ANA', 'LUIS'], current: 1 };
const PANEL = { pilotos: ['Javier', 'Pablo'], current: 0, source: 'panel', panel: true };

console.log('\nPlantilla de Apex');
test('rosterFromInf: nombres y piloto en pista', () => {
  deepStrictEqual(R.rosterFromInf(INF), APEX);
});
test('rosterFromInf: sin pilotos o null → null', () => {
  strictEqual(R.rosterFromInf({ team: 'X', drivers: [] }), null);
  strictEqual(R.rosterFromInf(null), null);
});
test('rosterFromInf: recorta a 10 pilotos y 40 caracteres; sin current → null', () => {
  const r = R.rosterFromInf({ drivers: Array.from({ length: 12 }, (_, i) => ({ name: 'P'.repeat(45) + i, current: false })) });
  strictEqual(r.pilotos.length, 10);
  ok(r.pilotos.every(p => p.length === 40));
  strictEqual(r.current, null);
});

console.log('\nQué lista usa la web');
test('panel conectado → lista del panel, sin publicar', () => {
  deepStrictEqual(R.chooseRoster(PANEL, APEX), { mode: 'panel', pilotos: ['Javier', 'Pablo'], current: 0, publish: false });
});
test('sin lista en el servidor y con Apex → publica la de Apex', () => {
  deepStrictEqual(R.chooseRoster(null, APEX), { mode: 'radio', pilotos: ['ANA', 'LUIS'], current: 1, publish: true });
  deepStrictEqual(R.chooseRoster({ pilotos: null, current: null, source: null, panel: false }, APEX).publish, true);
});
test('lista radio igual a la de Apex → no republica; distinta → sí', () => {
  strictEqual(R.chooseRoster({ ...APEX, source: 'radio', panel: false }, APEX).publish, false);
  strictEqual(R.chooseRoster({ pilotos: ['ANA', 'LUIS'], current: 0, source: 'radio', panel: false }, APEX).publish, true);
});
test('panel desconectado y Apex → la web toma el relevo', () => {
  deepStrictEqual(R.chooseRoster({ ...PANEL, panel: false }, APEX), { mode: 'radio', pilotos: ['ANA', 'LUIS'], current: 1, publish: true });
});
test('panel desconectado sin Apex → se queda con la del panel, sin publicar', () => {
  deepStrictEqual(R.chooseRoster({ ...PANEL, panel: false }, null), { mode: 'panel', pilotos: ['Javier', 'Pablo'], current: 0, publish: false });
});
test('nada de nada → modo dorsal', () => {
  deepStrictEqual(R.chooseRoster(null, null), { mode: 'dorsal', pilotos: [], current: null, publish: false });
});

console.log('\nDestinatario');
const ROS = { mode: 'radio', pilotos: ['ANA', 'LUIS'], current: 1, publish: false };
test('pickTarget: sin elección → el que va en pista; elección válida → esa', () => {
  strictEqual(R.pickTarget(null, ROS), 1);
  strictEqual(R.pickTarget(0, ROS), 0);
  strictEqual(R.pickTarget(5, ROS), 1);
  strictEqual(R.pickTarget(0, { mode: 'dorsal', pilotos: [], current: null }), null);
});
test('keepPick: se descarta si cambia el piloto en pista o la lista', () => {
  strictEqual(R.keepPick(0, ROS, { ...ROS }), 0);
  strictEqual(R.keepPick(0, ROS, { ...ROS, current: 0 }), null);
  strictEqual(R.keepPick(0, ROS, { ...ROS, pilotos: ['ANA', 'EVA'] }), null);
  strictEqual(R.keepPick(null, ROS, ROS), null);
});

console.log('\nMensajes al servidor');
test('rosterMessage: lista de la radio', () => {
  deepStrictEqual(R.rosterMessage('henakart', 7, ROS),
    { type: 'team_roster', slug: 'henakart', dorsal: '7', pilotos: ['ANA', 'LUIS'], current: 1, source: 'radio' });
});
test('teamMessage: con lista lleva pilot; en modo dorsal, no', () => {
  deepStrictEqual(R.teamMessage({ slug: 'h', dorsal: 7, roster: ROS, target: 1, text: ' BOX ', tone: 'red', id: 'a' }),
    { type: 'team_msg', slug: 'h', dorsal: '7', text: 'BOX', tone: 'red', id: 'a', pilot: 1 });
  deepStrictEqual(R.teamMessage({ slug: 'h', dorsal: '7', roster: { mode: 'dorsal', pilotos: [], current: null }, target: null, text: 'BOX', tone: 'blue', id: 'b' }),
    { type: 'team_msg', slug: 'h', dorsal: '7', text: 'BOX', tone: 'blue', id: 'b' });
});
test('teamMessage: vacío, largo, sin destinatario o tono raro', () => {
  strictEqual(R.teamMessage({ slug: 'h', dorsal: '7', roster: ROS, target: 1, text: '  ', tone: 'red' }).error, 'Mensaje vacío');
  strictEqual(R.teamMessage({ slug: 'h', dorsal: '7', roster: ROS, target: 1, text: 'X'.repeat(41), tone: 'red' }).error, 'Máximo 40 caracteres');
  strictEqual(R.teamMessage({ slug: 'h', dorsal: '7', roster: { ...ROS, current: null }, target: null, text: 'BOX', tone: 'red' }).error, 'Elige a quién va');
  strictEqual(R.teamMessage({ slug: 'h', dorsal: '7', roster: ROS, target: 1, text: 'BOX', tone: 'verde' }).tone, 'orange');
});

console.log('\nResultado, anti-repetición y reconexión');
test('resultLabel', () => {
  deepStrictEqual(R.resultLabel({ delivered: 1 }, 'LUIS', '7'), { ok: true, text: 'Entregado a LUIS ✓' });
  deepStrictEqual(R.resultLabel({ delivered: 0 }, 'LUIS', '7'), { ok: false, text: 'No entregado: LUIS sin móvil conectado' });
  deepStrictEqual(R.resultLabel({ delivered: 2 }, null, '7'), { ok: true, text: 'Entregado a 2 móviles del #7 ✓' });
  deepStrictEqual(R.resultLabel({ delivered: 1 }, null, '7'), { ok: true, text: 'Entregado a 1 móvil del #7 ✓' });
  deepStrictEqual(R.resultLabel({ delivered: 0 }, null, '7'), { ok: false, text: 'No entregado: ningún móvil conectado en el #7' });
});
test('createCooldown: bloquea el mismo mensaje 2 s, no los demás', () => {
  const c = R.createCooldown();
  ok(c.tryFire('BOX', 1000));
  ok(!c.tryFire('BOX', 2999));
  ok(c.tryFire('PUSH', 2999));
  ok(c.tryFire('BOX', 3000));
});
test('reconnectDelay: 1 s, 2 s y luego 5 s', () => {
  deepStrictEqual([0, 1, 2, 3, 9].map(R.reconnectDelay), [1000, 2000, 5000, 5000, 5000]);
});

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
```

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `node tests/radio-core.test.js`
Expected: FAIL (`Cannot find module '../src/radio-core'`).

- [ ] **Step 3: Implementación** — `src/radio-core.js`:

```js
// ── radio-core.js — lógica pura de la radio web móvil (radio.html) ─────────
// Qué lista de pilotos usar (la del panel si hay uno conectado; si no, la
// plantilla de Apex publicada como source:'radio'), a quién va cada mensaje y
// qué se manda al logger. Sin DOM: va con tests (tests/radio-core.test.js).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RadioCore = api;
})(typeof window !== 'undefined' ? window : this, function () {

  const MAX_PILOTS = 10, MAX_NAME = 40, MAX_TEXT = 40;  // = team-link.js del logger
  const TONES = ['red', 'orange', 'blue'];
  const COOLDOWN_MS = 2000;

  const same = (a, b) => JSON.stringify([a.pilotos, a.current]) === JSON.stringify([b.pilotos, b.current]);

  // .INF de Apex → { pilotos, current } o null si no hay plantilla.
  function rosterFromInf(inf) {
    const ds = (inf && Array.isArray(inf.drivers) ? inf.drivers : []).slice(0, MAX_PILOTS);
    const pilotos = ds.map(d => String(d.name || '').trim().slice(0, MAX_NAME));
    if (!pilotos.length || pilotos.some(p => !p)) return null;
    const i = ds.findIndex(d => d.current);
    return { pilotos, current: i >= 0 ? i : null };
  }

  // server: último team_roster recibido como observador; apex: rosterFromInf o null.
  function chooseRoster(server, apex) {
    const srv = server && Array.isArray(server.pilotos) ? server : null;
    if (srv && srv.source === 'panel' && srv.panel) {
      return { mode: 'panel', pilotos: srv.pilotos, current: srv.current, publish: false };
    }
    if (apex) {
      const publish = !srv || srv.source !== 'radio' || !same(srv, apex);
      return { mode: 'radio', pilotos: apex.pilotos, current: apex.current, publish };
    }
    if (srv) return { mode: srv.source === 'radio' ? 'radio' : 'panel', pilotos: srv.pilotos, current: srv.current, publish: false };
    return { mode: 'dorsal', pilotos: [], current: null, publish: false };
  }

  // Si cambia el piloto en pista (o la lista), la elección manual caduca: un BOX
  // no puede acabar en el móvil del piloto que acaba de bajarse.
  function keepPick(picked, prev, next) {
    if (picked === null || picked === undefined || !prev || !next) return null;
    return same(prev, next) ? picked : null;
  }

  function pickTarget(picked, roster) {
    if (!roster || roster.mode === 'dorsal') return null;
    if (Number.isInteger(picked) && picked >= 0 && picked < roster.pilotos.length) return picked;
    return roster.current;
  }

  function rosterMessage(slug, dorsal, roster) {
    return { type: 'team_roster', slug, dorsal: String(dorsal), pilotos: roster.pilotos, current: roster.current, source: 'radio' };
  }

  function teamMessage({ slug, dorsal, roster, target, text, tone, id }) {
    const t = String(text || '').trim();
    if (!t) return { error: 'Mensaje vacío' };
    if (t.length > MAX_TEXT) return { error: `Máximo ${MAX_TEXT} caracteres` };
    const msg = { type: 'team_msg', slug, dorsal: String(dorsal), text: t, tone: TONES.includes(tone) ? tone : 'orange', id };
    if (roster && roster.mode !== 'dorsal') {
      if (!Number.isInteger(target)) return { error: 'Elige a quién va' };
      msg.pilot = target;
    }
    return msg;
  }

  // name = null en modo dorsal (el mensaje fue a todos los móviles del dorsal).
  function resultLabel(ack, name, dorsal) {
    const n = (ack && ack.delivered) || 0;
    if (name) return n > 0 ? { ok: true, text: `Entregado a ${name} ✓` } : { ok: false, text: `No entregado: ${name} sin móvil conectado` };
    return n > 0
      ? { ok: true, text: `Entregado a ${n} ${n === 1 ? 'móvil' : 'móviles'} del #${dorsal} ✓` }
      : { ok: false, text: `No entregado: ningún móvil conectado en el #${dorsal}` };
  }

  function createCooldown(ms = COOLDOWN_MS) {
    const last = new Map();
    return {
      tryFire(key, now) {
        const t = last.get(key);
        if (t !== undefined && now - t < ms) return false;
        last.set(key, now);
        return true;
      },
    };
  }

  const reconnectDelay = attempt => [1000, 2000, 5000][Math.min(attempt, 2)];

  return { MAX_TEXT, COOLDOWN_MS, rosterFromInf, chooseRoster, keepPick, pickTarget,
           rosterMessage, teamMessage, resultLabel, createCooldown, reconnectDelay };
});
```

- [ ] **Step 4: Ejecutar y ver que pasan**

Run: `node tests/radio-core.test.js`
Expected: PASS (todos ✓, `0 fallos`).

- [ ] **Step 5: Commit**

```bash
git add src/radio-core.js tests/radio-core.test.js
git commit -m "radio web: núcleo puro (lista, destinatario, mensajes) con tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Página `radio.html` — interfaz móvil, conexión y envío

**Files:**
- Create: `src/radio.html`, `src/radio.css`, `src/radio.js`, `src/radio.webmanifest`, `src/radio-icon-192.png`, `src/radio-icon-512.png`
- Test: `tests/radio-page.test.js` (comprobaciones estáticas: sin `innerHTML`, scripts y metas presentes)

**Interfaces:**
- Consumes:
  - `SPAuth` (`ready`, `signIn`, `signOut`, `isMember`, `idToken(force)`, `errorMessage`);
  - `CircuitDB.list` (`{name, slug, port}`);
  - `ApexGrid.parseGridHtml(html).karts`;
  - `EnApexTeam.rowIdFor` y `fetchInf` (Task 3);
  - `EnPilotLinkCore.QUICK_MESSAGES`;
  - todo `RadioCore` (Task 4);
  - el protocolo WS de la Task 2.
- Produces: la página. Para probar en local: `?logger=ws://localhost:3001`, que solo se acepta si la página está en `localhost` o `127.0.0.1`.

Antes de escribir el CSS, cargar la skill `frontend-design` (preferencia del usuario para toda UI). La dirección estética está fijada por la spec: tema oscuro StintPro de alto contraste, a pleno sol, para una mano. El CSS de abajo es la base mínima obligatoria; se puede pulir sin romper los requisitos de la sección Global Constraints.

- [ ] **Step 1: Test estático que falla** — `tests/radio-page.test.js`:

```js
// StintPro — radio.html: requisitos estáticos (seguridad y móvil).
// Ejecutar: node tests/radio-page.test.js
'use strict';

const { ok } = require('assert');
const fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const HTML = read('radio.html'), JS = read('radio.js'), CSS = read('radio.css');
const MAN = JSON.parse(read('radio.webmanifest'));

console.log('\nradio.html');
test('radio.js nunca pinta con innerHTML/outerHTML/insertAdjacentHTML', () => {
  ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(JS));
});
test('viewport con viewport-fit=cover y manifest enlazado', () => {
  ok(/name="viewport"[^>]*viewport-fit=cover/.test(HTML));
  ok(/rel="manifest" href="radio.webmanifest"/.test(HTML));
  ok(/rel="apple-touch-icon"/.test(HTML));
});
test('carga los módulos en orden: auth, circuitos, Apex, núcleos y radio.js al final', () => {
  const order = ['firebase-auth.js', 'circuits.js', 'apex-protocol.js', 'apex-grid.js', 'en-apex-team.js', 'en-pilot-link-core.js', 'radio-core.js', 'radio.js'];
  const idx = order.map(f => HTML.indexOf(`src="${f}"`));
  ok(idx.every(i => i > 0), 'falta algún script');
  ok(idx.every((v, i) => i === 0 || v > idx[i - 1]), 'orden incorrecto');
});
test('CSS: pulsables ≥ 56 px, safe-area y campo ≥ 16 px', () => {
  ok(/--tap:\s*56px/.test(CSS));
  ok(/safe-area-inset-bottom/.test(CSS));
  ok(/font-size:\s*(1[6-9]|[2-9]\d)px/.test(CSS));
});
test('manifest standalone con iconos 192 y 512', () => {
  ok(MAN.display === 'standalone' && MAN.start_url === '/radio.html');
  ok(['192x192', '512x512'].every(s => MAN.icons.some(i => i.sizes === s)));
  ok(['radio-icon-192.png', 'radio-icon-512.png'].every(f => fs.existsSync(path.join(__dirname, '..', 'src', f))));
});

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
```

Run: `node tests/radio-page.test.js` → Expected: FAIL (`ENOENT radio.html`).

- [ ] **Step 2: `src/radio.html`**

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#08090a">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Radio">
<title>StintPro Radio</title>
<link rel="manifest" href="radio.webmanifest">
<link rel="apple-touch-icon" href="radio-icon-192.png">
<link rel="stylesheet" href="radio.css">
</head>
<body>
<main id="app">
  <section id="v-login" class="view" hidden>
    <h1>📻 StintPro Radio</h1>
    <p class="muted">Entra con tu cuenta de StintPro</p>
    <form id="login-form" class="form">
      <label>Correo<input id="login-email" type="email" autocomplete="username" required></label>
      <label>Contraseña<input id="login-pass" type="password" autocomplete="current-password" required></label>
      <p id="login-error" class="err" role="alert"></p>
      <button class="btn-primary" type="submit">Entrar</button>
    </form>
  </section>

  <section id="v-setup" class="view" hidden>
    <h1>¿A qué kart?</h1>
    <form id="setup-form" class="form">
      <label>Circuito<select id="setup-circuit" required></select></label>
      <label>Dorsal<input id="setup-dorsal" inputmode="numeric" maxlength="16" autocomplete="off" required></label>
      <button class="btn-primary" type="submit">Abrir radio</button>
    </form>
    <button id="logout" class="btn-link" type="button">Cerrar sesión</button>
  </section>

  <section id="v-radio" class="view" hidden>
    <header class="bar">
      <span id="bar-where" class="where"></span>
      <span id="bar-conn" class="conn" data-state="off"></span>
      <button id="bar-change" class="btn-link" type="button">Cambiar</button>
    </header>
    <p id="roster-note" class="muted note"></p>
    <div id="pilots" class="grid pilots"></div>
    <div class="bottom">
      <p id="result" class="result" role="status" aria-live="polite"></p>
      <div id="quick" class="grid quick"></div>
      <form id="free" class="free">
        <input id="free-text" maxlength="40" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="send" placeholder="Mensaje libre">
        <span id="free-count" class="count">0/40</span>
        <button id="free-send" class="btn-primary" type="submit">Enviar</button>
      </form>
    </div>
  </section>
</main>
<script src="https://cdn.jsdelivr.net/npm/firebase@10.14.1/firebase-app-compat.js"></script>
<script src="https://cdn.jsdelivr.net/npm/firebase@10.14.1/firebase-auth-compat.js"></script>
<script src="firebase-config.js"></script>
<script src="firebase-auth.js"></script>
<script src="circuits.js"></script>
<script src="apex-protocol.js"></script>
<script src="apex-grid.js"></script>
<script src="en-apex-team.js"></script>
<script src="en-pilot-link-core.js"></script>
<script src="radio-core.js"></script>
<script src="radio.js"></script>
</body>
</html>
```

- [ ] **Step 3: `src/radio.css`** (base obligatoria)

```css
/* radio.css — radio web móvil. Una mano, a pleno sol: alto contraste, todo lo
   pulsable ≥ 56 px y en la mitad de abajo. */
:root {
  --bg: #08090a; --cell: #141518; --line: #2a2c31; --text: #ffffff; --muted: #a3a7b0;
  --red: #d32f2f; --orange: #ff8a00; --blue: #1e5bff; --green: #22c55e; --amber: #fbbf24;
  --tap: 56px; --gap: 8px;
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text);
  font: 16px/1.3 -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif; }
#app { max-width: 430px; margin: 0 auto; min-height: 100%;
  padding: calc(env(safe-area-inset-top) + 12px) 16px calc(env(safe-area-inset-bottom) + 12px); }
.view { display: flex; flex-direction: column; gap: 12px; min-height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px); }
.view[hidden] { display: none; }
h1 { font-size: 24px; margin: 8px 0 0; }
.muted { color: var(--muted); margin: 0; }
.form { display: flex; flex-direction: column; gap: 12px; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--muted); letter-spacing: .5px; }
input, select { min-height: var(--tap); font-size: 18px; color: var(--text); background: var(--cell);
  border: 1px solid var(--line); border-radius: 12px; padding: 0 14px; }
button { min-height: var(--tap); font: inherit; font-weight: 700; border-radius: 12px; border: 0; cursor: pointer; }
button:disabled { opacity: .35; }
.btn-primary { background: var(--green); color: #000; font-size: 17px; letter-spacing: 1px; }
.btn-link { background: none; color: var(--muted); min-height: 44px; }
.err { color: #ff6b6b; min-height: 1.3em; margin: 0; }
.bar { display: flex; align-items: center; gap: 10px; }
.where { flex: 1; font-weight: 700; font-size: 17px; }
.conn::before { content: '●'; margin-right: 4px; }
.conn[data-state="ok"] { color: var(--green); }
.conn[data-state="connecting"] { color: var(--amber); }
.conn[data-state="off"] { color: #ff6b6b; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gap); }
.pilot { background: var(--cell); color: var(--text); border: 2px solid var(--line); display: flex;
  flex-direction: column; align-items: flex-start; justify-content: center; padding: 8px 12px; text-align: left; }
.pilot.sel { border-color: var(--text); background: #23252b; }
.pilot .name { font-size: 18px; display: flex; align-items: center; gap: 8px; }
.pilot .dot { width: 10px; height: 10px; border-radius: 50%; background: #555; display: inline-block; }
.pilot .dot.on { background: var(--green); }
.pilot .tag { font-size: 11px; letter-spacing: 1px; color: var(--amber); }
.bottom { margin-top: auto; display: flex; flex-direction: column; gap: 10px; }
.result { min-height: 1.4em; font-size: 18px; font-weight: 700; margin: 0; }
.result.ok { color: var(--green); } .result.bad { color: #ff6b6b; }
.q { color: #fff; font-size: 17px; letter-spacing: .5px; }
.q.tone-red { background: var(--red); } .q.tone-blue { background: var(--blue); }
.q.tone-orange { background: var(--orange); color: #000; }
.q.cooling { outline: 3px solid #fff; }
.free { display: grid; grid-template-columns: 1fr auto; gap: var(--gap); align-items: center; }
.free input { grid-column: 1 / -1; text-transform: uppercase; }
.count { color: var(--muted); font-size: 13px; }
```

- [ ] **Step 4: `src/radio.js`**

```js
// ── radio.js — radio web móvil: mensajes al piloto sin el panel ─────────────
// Login (SPAuth) → circuito + dorsal → WS al logger: auth + team_watch.
// Lista de pilotos: la del panel si hay uno conectado; si no, la plantilla de
// Apex (.INF) publicada como source:'radio' y refrescada cada minuto (así la
// app del piloto sabe quién va en pista). Sin cola offline: sin conexión no se
// envía nada. Todo texto del servidor o de Apex se pinta con textContent.
(function () {
  'use strict';
  const LOGGER_WS = 'wss://stintpro.duckdns.org';
  const APEX_EVERY_MS = 60000;
  const ACK_TIMEOUT_MS = 5000;
  const LS_KEY = 'stintpro_radio_last';
  const $ = id => document.getElementById(id);

  const st = {
    slug: null, dorsal: null, port: null, name: '',
    ws: null, authed: false, attempt: 0, reconnectTimer: null, authFailed: 0,
    server: null, apex: null, rowId: null, apexNote: '',
    roster: RadioCore.chooseRoster(null, null), picked: null, presence: [],
    pending: new Map(), apexTimer: null, wakeLock: null, seq: 0,
  };
  const cooldown = RadioCore.createCooldown();

  // ?logger=ws://localhost:3001 solo en local (pruebas con replay-vps.js).
  function loggerUrl() {
    const q = new URLSearchParams(location.search).get('logger');
    return q && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? q : LOGGER_WS;
  }
  function show(view) { ['v-login', 'v-setup', 'v-radio'].forEach(v => { $(v).hidden = v !== view; }); }
  const NO_ACCESS = 'Esta cuenta no tiene acceso a StintPro. Pide una invitación.';

  // ── Login ──
  async function start() {
    try {
      const u = await SPAuth.ready();
      if (!u) return showLogin();
      if (!(await SPAuth.isMember())) return showLogin(NO_ACCESS);
      showSetup();
    } catch (e) { showLogin(SPAuth.errorMessage(e)); }
  }
  function showLogin(msg) { $('login-error').textContent = msg || ''; show('v-login'); }
  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('login-error').textContent = '';
    try {
      await SPAuth.signIn($('login-email').value.trim(), $('login-pass').value);
      $('login-pass').value = '';
      if (!(await SPAuth.isMember())) { await SPAuth.signOut(); return showLogin(NO_ACCESS); }
      showSetup();
    } catch (err) { $('login-error').textContent = SPAuth.errorMessage(err); }
  });

  // ── Circuito y dorsal ──
  const circuits = () => (window.CircuitDB && CircuitDB.list) || [];
  function showSetup() {
    $('setup-circuit').replaceChildren(...circuits().map(c => {
      const o = document.createElement('option'); o.value = c.slug; o.textContent = c.name; return o;
    }));
    let last = null;
    try { last = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) {}
    if (last) { $('setup-circuit').value = last.slug; $('setup-dorsal').value = last.dorsal; }
    show('v-setup');
  }
  $('setup-form').addEventListener('submit', e => {
    e.preventDefault();
    const c = circuits().find(x => x.slug === $('setup-circuit').value);
    const dorsal = $('setup-dorsal').value.trim();
    if (!c || !dorsal) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify({ slug: c.slug, dorsal })); } catch (e2) {}
    openRadio(c, dorsal);
  });
  $('logout').addEventListener('click', async () => { await SPAuth.signOut(); showLogin(); });
  $('bar-change').addEventListener('click', () => { closeRadio(); showSetup(); });

  // ── Radio ──
  function openRadio(c, dorsal) {
    Object.assign(st, { slug: c.slug, port: parseInt(c.port, 10), name: c.name, dorsal,
      server: null, apex: null, rowId: null, apexNote: '', picked: null, presence: [], attempt: 0, authFailed: 0 });
    st.roster = RadioCore.chooseRoster(null, null);
    $('bar-where').textContent = `${c.name} · #${dorsal}`;
    showResult(null, '');
    renderQuick(); render(); show('v-radio');
    connect(); refreshApex();
    st.apexTimer = setInterval(refreshApex, APEX_EVERY_MS);
    keepAwake();
  }
  function closeRadio() {
    clearInterval(st.apexTimer); clearTimeout(st.reconnectTimer);
    if (st.ws) { st.ws.onclose = null; try { st.ws.close(); } catch (e) {} }
    st.ws = null; st.authed = false; st.slug = null;
    failPending('Envío cancelado');
    if (st.wakeLock) { st.wakeLock.release().catch(() => {}); st.wakeLock = null; }
  }

  // ── Conexión al logger ──
  function setConn(state) {
    const el = $('bar-conn');
    el.dataset.state = state;
    el.textContent = state === 'ok' ? 'Conectado' : state === 'connecting' ? 'Reconectando' : 'Sin conexión';
  }
  function send(obj) { if (st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify(obj)); }

  function connect() {
    setConn('connecting');
    let ws;
    try { ws = new WebSocket(loggerUrl()); } catch (e) { return scheduleReconnect(); }
    st.ws = ws; st.authed = false;
    ws.onopen = async () => {
      let token = '';
      try { token = await SPAuth.idToken(st.authFailed > 0); } catch (e) {}
      if (st.ws === ws) ws.send(JSON.stringify({ type: 'auth', token }));
    };
    ws.onmessage = ev => {
      if (st.ws !== ws) return;
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'auth_ok') {
        st.authed = true; st.attempt = 0; st.authFailed = 0; setConn('ok');
        send({ type: 'team_watch', slug: st.slug, dorsal: st.dorsal });
        render();
      } else if (m.type === 'team_roster') {
        st.server = m; updateRoster();
      } else if (m.type === 'pilot_presence') {
        st.presence = m.connected || []; render();
      } else if (m.type === 'team_msg_sent') {
        settle(m.id, m);
      } else if (m.type === 'error') {
        if (m.msg === 'auth_failed') { st.authFailed++; return; }
        if (m.id) return settle(m.id, null, m.msg);
        // «lista del panel activa»: llegará el team_roster del panel; nada que mostrar.
        if (m.about === 'team_roster' && m.msg === 'lista del panel activa') return;
        if (m.about) showResult(false, m.msg);
      }
    };
    ws.onclose = () => {
      if (st.ws !== ws) return;
      st.authed = false; st.ws = null;
      failPending('Conexión perdida: no se sabe si llegó');
      if (st.authFailed >= 2) { closeRadio(); return showLogin('Sesión caducada. Vuelve a entrar.'); }
      setConn('off'); render(); scheduleReconnect();
    };
  }
  function scheduleReconnect() {
    clearTimeout(st.reconnectTimer);
    st.reconnectTimer = setTimeout(() => { if (st.slug) connect(); }, RadioCore.reconnectDelay(st.attempt++));
  }

  // ── Lista de pilotos ──
  function updateRoster() {
    const prev = st.roster;
    st.roster = RadioCore.chooseRoster(st.server, st.apex);
    st.picked = RadioCore.keepPick(st.picked, prev, st.roster);
    if (st.roster.publish && st.authed) send(RadioCore.rosterMessage(st.slug, st.dorsal, st.roster));
    render();
  }
  async function refreshApex() {
    const slug = st.slug, dorsal = st.dorsal, port = st.port;
    if (!slug) return;
    if (!st.rowId) {
      st.rowId = await EnApexTeam.rowIdFor(slug, port, dorsal, {
        WebSocket, parseGrid: html => ApexGrid.parseGridHtml(html).karts,
      });
      if (slug !== st.slug || dorsal !== st.dorsal) return;
      if (!st.rowId) { st.apexNote = `Dorsal ${dorsal} no aparece en Apex`; return render(); }
    }
    const inf = await EnApexTeam.fetchInf(port - 3, st.rowId, (u, o) => fetch(u, o));
    if (slug !== st.slug || dorsal !== st.dorsal) return;
    if (inf) { st.apex = RadioCore.rosterFromInf(inf); st.apexNote = ''; }  // fallo → se queda la anterior
    updateRoster();
  }

  // ── Pintado ──
  function render() {
    const r = st.roster, target = RadioCore.pickTarget(st.picked, r);
    const base = r.mode === 'panel' ? 'Lista del panel StintPro'
      : r.mode === 'radio' ? 'Pilotos de Apex'
      : `Sin plantilla: el mensaje va a todos los móviles del #${st.dorsal || ''}`;
    $('roster-note').textContent = st.apexNote ? `${base} · ${st.apexNote}` : base;
    $('pilots').replaceChildren(...r.pilotos.map((name, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pilot' + (i === target ? ' sel' : '');
      b.setAttribute('aria-pressed', String(i === target));
      const row = document.createElement('span'); row.className = 'name';
      const dot = document.createElement('span'); dot.className = 'dot' + (st.presence.includes(i) ? ' on' : '');
      const nm = document.createElement('span'); nm.textContent = name;
      row.append(dot, nm); b.append(row);
      if (i === r.current) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'EN PISTA'; b.append(t); }
      b.addEventListener('click', () => { st.picked = i; render(); });
      return b;
    }));
    const can = st.authed && (r.mode === 'dorsal' || Number.isInteger(target));
    document.querySelectorAll('#quick button, #free-send').forEach(b => { if (!b.classList.contains('cooling')) b.disabled = !can; });
    if (!st.authed && st.slug) showResult(false, 'Sin conexión — no se puede enviar');
    else if (st.authed && $('result').dataset.offline === '1') showResult(null, '');
  }
  function showResult(okFlag, text) {
    const el = $('result');
    el.textContent = text;
    el.className = 'result' + (okFlag === true ? ' ok' : okFlag === false ? ' bad' : '');
    el.dataset.offline = text === 'Sin conexión — no se puede enviar' ? '1' : '';
  }
  function renderQuick() {
    $('quick').replaceChildren(...EnPilotLinkCore.QUICK_MESSAGES.map(q => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'q tone-' + q.tone; b.textContent = q.text;
      b.addEventListener('click', () => sendMsg(q.text, q.tone, b));
      return b;
    }));
  }
  $('free-text').addEventListener('input', () => { $('free-count').textContent = `${$('free-text').value.length}/40`; });
  $('free').addEventListener('submit', e => {
    e.preventDefault();
    if (sendMsg($('free-text').value.toUpperCase(), 'orange', $('free-send'))) {
      $('free-text').value = ''; $('free-count').textContent = '0/40';
    }
  });

  // ── Envío ──
  function sendMsg(text, tone, btn) {
    const r = st.roster, target = RadioCore.pickTarget(st.picked, r);
    if (!st.authed) { showResult(false, 'Sin conexión — no se puede enviar'); return false; }
    const id = `radio-${Date.now()}-${++st.seq}`;
    const msg = RadioCore.teamMessage({ slug: st.slug, dorsal: st.dorsal, roster: r, target, text, tone, id });
    if (msg.error) { showResult(false, msg.error); return false; }
    if (!cooldown.tryFire(msg.text, Date.now())) return false;
    send(msg);
    const name = r.mode === 'dorsal' ? null : r.pilotos[target];
    st.pending.set(id, { name, timer: setTimeout(() => settle(id, null, 'Sin confirmación del servidor'), ACK_TIMEOUT_MS) });
    cool(btn);
    if (navigator.vibrate) navigator.vibrate(30);
    return true;
  }
  function cool(btn) {
    const label = btn.textContent;
    btn.classList.add('cooling'); btn.disabled = true; btn.textContent = 'Enviado ✓';
    setTimeout(() => { btn.classList.remove('cooling'); btn.textContent = label; render(); }, RadioCore.COOLDOWN_MS);
  }
  function settle(id, ack, err) {
    const p = st.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer); st.pending.delete(id);
    const res = err ? { ok: false, text: err } : RadioCore.resultLabel(ack, p.name, st.dorsal);
    showResult(res.ok, res.text);
  }
  function failPending(text) { for (const id of [...st.pending.keys()]) settle(id, null, text); }

  // ── Pantalla encendida ──
  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !st.wakeLock && st.slug) {
        st.wakeLock = await navigator.wakeLock.request('screen');
        st.wakeLock.addEventListener('release', () => { st.wakeLock = null; });
      }
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => { if (!$('v-radio').hidden) keepAwake(); });

  start();
})();
```

- [ ] **Step 5: Manifest e iconos**

`src/radio.webmanifest`:

```json
{
  "name": "StintPro Radio",
  "short_name": "Radio",
  "start_url": "/radio.html",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#08090a",
  "theme_color": "#08090a",
  "icons": [
    { "src": "radio-icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "radio-icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Iconos a partir del logo existente:

```bash
sips -z 192 192 src/logo.png --out src/radio-icon-192.png
sips -z 512 512 src/logo.png --out src/radio-icon-512.png
```

(Si `logo.png` no es cuadrado, primero `sips -c <lado> <lado>` para recortarlo centrado.)

- [ ] **Step 6: Ejecutar los tests del cliente**

Run: `node tests/radio-page.test.js && node tests/radio-core.test.js && node tests/apex-team.test.js && node tests/pilot-link.test.js && node tests/xss-sinks.test.js`
Expected: PASS en todos.

- [ ] **Step 7: Commit**

```bash
git add src/radio.html src/radio.css src/radio.js src/radio.webmanifest src/radio-icon-192.png src/radio-icon-512.png tests/radio-page.test.js
git commit -m "radio web: página móvil para mandar mensajes al piloto sin el panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Verificación de punta a punta en local

**Files:** ninguno nuevo (solo arreglos si aparece algo, con su test y su commit).

**Interfaces:**
- Consumes: todo lo anterior; `stintpro-logger/replay-vps.js` en `:3001`; la app StintPro Pilot (emulador Android `android_pilot` con `--dart-define=VPS_HOST=10.0.2.2 --dart-define=VPS_PORT=3001`).

- [ ] **Step 1: Arrancar el replay en segundo plano**

Run (en segundo plano): `cd stintpro-logger && node replay-vps.js <grabación habitual>`. Mirar en la cabecera del fichero los argumentos que admite. Comprobar en su salida `[Replay] Servidor WebSocket en :3001`.

- [ ] **Step 2: Servir `src/` en local y abrir la radio con tamaño de iPhone**

Añadir a `.claude/launch.json` (o reutilizar) una configuración `radio-local` que sirva `src/` en el puerto 5173 (por ejemplo `npx http-server src -p 5173 -c-1`). Abrirla con preview_start, `resize_window` 375×812 y navegar a `http://localhost:5173/radio.html?logger=ws://localhost:3001`.

Comprobar con read_page y capturas:
1. Login con la cuenta del usuario (la mete el usuario) → «¿A qué kart?».
2. Elegir el circuito del replay y un dorsal → barra «Conectado».
3. Sin panel: «Pilotos de Apex» o «Sin plantilla…» según el replay. En un replay, Apex no tiene la sesión: lo esperado es modo dorsal y el aviso «Dorsal N no aparece en Apex».
4. Con la app del piloto conectada al mismo dorsal: «BOX» → «Entregado a 1 móvil del #N ✓» y mensaje a pantalla completa en la app.
5. Abrir el panel en local (`index.html`) con una lista para ese dorsal → la radio pasa a «Lista del panel StintPro» con los nombres del panel; elegir piloto; «BANDERA AZUL» → solo llega a ese móvil.
6. Cerrar el panel → la radio sigue con esa lista (sin Apex) o publica la de Apex.
7. Parar el replay → «Sin conexión — no se puede enviar» y botones desactivados. Rearrancar → reconecta sola.
8. Repetir el mismo botón antes de 2 s → no se envía dos veces.
9. Ningún error en la consola.

- [ ] **Step 3: Si la verificación obligó a cambiar algo, reflejarlo en la spec y commitear** (`docs/superpowers/specs/2026-10-28-radio-web-movil-design.md`).

**Fuera del plan (requiere confirmación explícita del usuario):**
1. Desplegar el logger en el VPS (copia de seguridad, `scp` de `team-link.js` + `server.js`, mirar raw logs vivos, restart, md5).
2. Después, push de `main` para publicar en Vercel.
3. Prueba con el iPhone real: abrir `stintpro.vercel.app/radio.html` y añadirla a la pantalla de inicio.
