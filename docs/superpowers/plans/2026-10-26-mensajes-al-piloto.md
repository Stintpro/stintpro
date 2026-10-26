# Mensajes del panel al piloto en pista — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el panel de StintPro mande mensajes rápidos (BOX, PUSH, BANDERA AZUL…) solo al móvil del piloto que va en pista, con la app StintPro Pilot mostrándolos 10 s sin que el piloto toque nada.

**Architecture:** El panel publica en el VPS la lista de pilotos de su equipo y cuál va en pista (`team_roster`). Cada app elige su piloto de esa lista y se suscribe con su índice. El VPS (módulo nuevo `team-link.js`) entrega cada `team_msg` solo a los móviles cuyo índice es el piloto en pista, acusa cuántos lo recibieron y avisa al panel de qué pilotos tienen móvil conectado (`pilot_presence`).

**Tech Stack:** Node + `ws` + Jest (logger, `stintpro-logger/`); JS de navegador sin build + tests `node` con `assert` (panel, `src/`, `tests/`); Flutter/Dart + `flutter_test` (app, repo aparte `~/stintpro_pilot`).

**Spec:** `docs/superpowers/specs/2026-10-26-mensajes-al-piloto-design.md`

## Global Constraints

- Dos repos: **karting-v10** (`/Users/javiercoy/Documentos Locales/KARTING STRATEGY/karting-v10`, rama `main`) y **stintpro_pilot** (`/Users/javiercoy/stintpro_pilot`, rama `main`, sin remoto). Commits en cada uno; **ningún push** sin permiso.
- **Ningún despliegue sin confirmación explícita del usuario** (VPS: scp + `systemctl restart`, solo sin carreras en vivo; web: push a `main` → Vercel; app: build nuevo).
- Tonos: `red | orange | blue`, por defecto `orange`. Texto libre ≤ **40** caracteres cuando el mensaje va dirigido a un piloto; sin piloto se mantiene el límite actual de 500.
- Lista: 1–**10** pilotos (`MAX_PILOTS` del panel), nombres 1–40 caracteres, `dorsal` ≤ 16, `current` entero en rango o `null`. `id` del mensaje ≤ 64.
- `team_msg` sin `pilot` → a todos los móviles del dorsal (compatibilidad).
- Rate limit actual: 10 `team_msg` / 10 s por conexión.
- El aviso en la app se cierra **solo a los 10 s**, sin toque; uno nuevo sustituye al visible y reinicia los 10 s.
- Sin cola: mensaje a un móvil desconectado = «No entregado».
- Mensajes rápidos (orden y tono exactos): BOX·red, BOX PRÓXIMA·red, NO ENTRES·red, UNA VUELTA MÁS·red, PUSH·orange, MANTÉN RITMO·orange, TRANQUILO·orange, RIVAL DETRÁS·orange, ATACA·orange, BANDERA AZUL·blue, LÍMITES DE PISTA·orange, SANCIÓN·orange, OK·orange.
- Idioma de la UI y comentarios: español.
- Commits terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

**karting-v10**
- Create `stintpro-logger/team-link.js` — estado en memoria de listas de pilotos, móviles por piloto, entrega dirigida, presencia y validación de mensajes. Sin dependencias.
- Create `stintpro-logger/__tests__/team-link.test.js` — unit tests con ws falsos.
- Create `stintpro-logger/__tests__/team-link-ws.test.js` — integración contra el servidor real (`createTestServer`).
- Modify `stintpro-logger/server.js` — handler WS: `pilot` con índice, `team_roster`, `roster_get`, `team_msg` dirigido.
- Modify `stintpro-logger/circuit-monitor.js` — `subscribePilot` sin duplicados al resuscribirse.
- Modify `stintpro-logger/__tests__/circuit-monitor.test.js` — test de resuscripción.
- Modify `stintpro-logger/replay-vps.js` — mismo reparto que el servidor.
- Create `src/en-pilot-link-core.js` — núcleo puro del panel (UMD): mensajes rápidos, lista, mensaje, etiqueta de entrega.
- Create `tests/pilot-link.test.js` — tests del núcleo.
- Create `src/en-pilot-link.js` — conexión WS del panel (`EnPilotLink`) + botón 📻 RADIO y modal.
- Modify `src/index.html` — cargar los dos scripts.
- Modify `src/en-team.js` — botón 📻 RADIO en la tarjeta «Piloto en pista» de Mi equipo.
- Modify `src/styles.css` — estilos del botón y el modal.

**stintpro_pilot**
- Create `lib/team_link.dart` — `MsgTone`, `TeamRoster`, `pilotPrefKey`, `validPilotIndex`, `TeamMessageController`.
- Create `lib/pilot_picker.dart` — widget de selección de piloto.
- Create `lib/vps.dart` — host/puerto del VPS y `fetchRoster()`.
- Modify `lib/main.dart` — setup «¿Quién eres?», suscripción con índice, «📢 TÚ EN PISTA», aviso por tono con cierre a 10 s.
- Replace `test/widget_test.dart` → `test/team_link_test.dart` + `test/pilot_picker_test.dart`.

---

### Task 1: Núcleo `team-link.js` del logger

**Files:**
- Create: `stintpro-logger/team-link.js`
- Test: `stintpro-logger/__tests__/team-link.test.js`

**Interfaces:**
- Produces:
  - `validateRoster(msg) → { error } | { dorsal: string, pilotos: string[], current: number|null }`
  - `validatePilotIndex(v) → { error } | { pilot: number|null }`
  - `validateTeamMsg(msg) → { error } | { dorsal, text, pilot: number|null, tone: 'red'|'orange'|'blue', id: string|null }`
  - `createTeamLink() → { setRoster(ws, slug, roster), getRoster(slug, dorsal) → {pilotos, current}|null, registerPilot(ws, slug, dorsal, pilot), deliver(slug, {dorsal, text, tone, pilot}) → number, drop(ws) }`
  - Mensajes salientes: `{type:'team_roster', pilotos, current}`, `{type:'pilot_presence', dorsal, connected:number[]}`, `{type:'team_msg', text, tone}`.

- [ ] **Step 1: Write the failing test**

`stintpro-logger/__tests__/team-link.test.js`:

```js
'use strict';

// team-link.js — reparto de mensajes del panel al piloto en pista.
const { EventEmitter } = require('events');
const { createTeamLink, validateRoster, validatePilotIndex, validateTeamMsg } = require('../team-link');

function fakeWs() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.sent = [];
  ws.send = (s) => ws.sent.push(JSON.parse(s));
  ws.last = (type) => [...ws.sent].reverse().find(m => m.type === type);
  return ws;
}

describe('validateRoster', () => {
  test('acepta una lista válida y normaliza', () => {
    expect(validateRoster({ dorsal: 17, pilotos: [' Javier ', 'Pablo'], current: 1 }))
      .toEqual({ dorsal: '17', pilotos: ['Javier', 'Pablo'], current: 1 });
  });
  test('current ausente → null', () => {
    expect(validateRoster({ dorsal: '7', pilotos: ['A'] }).current).toBeNull();
  });
  test.each([
    [{ dorsal: '', pilotos: ['A'] }],
    [{ dorsal: '1'.repeat(17), pilotos: ['A'] }],
    [{ dorsal: '7', pilotos: [] }],
    [{ dorsal: '7', pilotos: Array(11).fill('A') }],
    [{ dorsal: '7', pilotos: ['A', ''] }],
    [{ dorsal: '7', pilotos: ['X'.repeat(41)] }],
    [{ dorsal: '7', pilotos: ['A'], current: 1 }],
    [{ dorsal: '7', pilotos: ['A'], current: 0.5 }],
  ])('rechaza %j', (msg) => {
    expect(validateRoster(msg).error).toBeTruthy();
  });
});

describe('validatePilotIndex', () => {
  test('ausente o null → null', () => {
    expect(validatePilotIndex(undefined)).toEqual({ pilot: null });
    expect(validatePilotIndex(null)).toEqual({ pilot: null });
  });
  test('0..9 válido; resto error', () => {
    expect(validatePilotIndex(9)).toEqual({ pilot: 9 });
    expect(validatePilotIndex(10).error).toBeTruthy();
    expect(validatePilotIndex(-1).error).toBeTruthy();
    expect(validatePilotIndex('1').error).toBeTruthy();
  });
});

describe('validateTeamMsg', () => {
  test('sin pilot: compatibilidad (tono naranja, hasta 500)', () => {
    expect(validateTeamMsg({ dorsal: '7', text: 'X'.repeat(500) }))
      .toEqual({ dorsal: '7', text: 'X'.repeat(500), pilot: null, tone: 'orange', id: null });
  });
  test('con pilot: texto ≤40', () => {
    expect(validateTeamMsg({ dorsal: '7', text: 'X'.repeat(41), pilot: 0 }).error).toMatch(/40/);
    expect(validateTeamMsg({ dorsal: '7', text: 'BOX', pilot: 0, tone: 'red', id: 'm-1' }))
      .toEqual({ dorsal: '7', text: 'BOX', pilot: 0, tone: 'red', id: 'm-1' });
  });
  test.each([
    [{ dorsal: '7' }],
    [{ text: 'hola' }],
    [{ dorsal: '7', text: 'X'.repeat(501) }],
    [{ dorsal: '1'.repeat(17), text: 'hola' }],
    [{ dorsal: '7', text: 'hola', tone: 'green' }],
    [{ dorsal: '7', text: 'hola', pilot: 12 }],
    [{ dorsal: '7', text: 'hola', id: 'x'.repeat(65) }],
  ])('rechaza %j', (msg) => {
    expect(validateTeamMsg(msg).error).toBeTruthy();
  });
});

describe('createTeamLink', () => {
  const ROSTER = { dorsal: '7', pilotos: ['Javier', 'Pablo'], current: 0 };

  test('entrega solo al móvil del piloto en pista', () => {
    const tl = createTeamLink();
    const javier = fakeWs(), pablo = fakeWs();
    tl.registerPilot(javier, 's', '7', 0);
    tl.registerPilot(pablo, 's', '7', 1);
    const n = tl.deliver('s', { dorsal: '7', text: 'BOX', tone: 'red', pilot: 0 });
    expect(n).toBe(1);
    expect(javier.last('team_msg')).toEqual({ type: 'team_msg', text: 'BOX', tone: 'red' });
    expect(pablo.last('team_msg')).toBeUndefined();
  });

  test('sin pilot llega a todos los móviles del dorsal, y a ninguno de otro dorsal', () => {
    const tl = createTeamLink();
    const a = fakeWs(), b = fakeWs(), otro = fakeWs();
    tl.registerPilot(a, 's', '7', 0);
    tl.registerPilot(b, 's', '7', null);
    tl.registerPilot(otro, 's', '9', 0);
    expect(tl.deliver('s', { dorsal: '7', text: 'hola', tone: 'orange', pilot: null })).toBe(2);
    expect(otro.last('team_msg')).toBeUndefined();
  });

  test('0 entregados si el piloto no tiene móvil o está cerrado', () => {
    const tl = createTeamLink();
    const a = fakeWs();
    tl.registerPilot(a, 's', '7', 0);
    a.readyState = 3;
    expect(tl.deliver('s', { dorsal: '7', text: 'BOX', tone: 'red', pilot: 0 })).toBe(0);
    expect(tl.deliver('s', { dorsal: '7', text: 'BOX', tone: 'red', pilot: 1 })).toBe(0);
  });

  test('setRoster guarda, reenvía la lista a los móviles y manda presencia al panel', () => {
    const tl = createTeamLink();
    const movil = fakeWs(), panel = fakeWs();
    tl.registerPilot(movil, 's', '7', 1);
    tl.setRoster(panel, 's', ROSTER);
    expect(tl.getRoster('s', '7')).toEqual({ pilotos: ['Javier', 'Pablo'], current: 0 });
    expect(movil.last('team_roster')).toEqual({ type: 'team_roster', pilotos: ['Javier', 'Pablo'], current: 0 });
    expect(panel.last('pilot_presence')).toEqual({ type: 'pilot_presence', dorsal: '7', connected: [1] });
  });

  test('registerPilot manda la lista si existe y avisa al panel', () => {
    const tl = createTeamLink();
    const panel = fakeWs(), movil = fakeWs();
    tl.setRoster(panel, 's', ROSTER);
    tl.registerPilot(movil, 's', '7', 0);
    expect(movil.last('team_roster').pilotos).toEqual(['Javier', 'Pablo']);
    expect(panel.last('pilot_presence').connected).toEqual([0]);
  });

  test('resuscribir la misma conexión sustituye su piloto (sin duplicar)', () => {
    const tl = createTeamLink();
    const panel = fakeWs(), movil = fakeWs();
    tl.setRoster(panel, 's', ROSTER);
    tl.registerPilot(movil, 's', '7', 0);
    tl.registerPilot(movil, 's', '7', 1);
    expect(panel.last('pilot_presence').connected).toEqual([1]);
    expect(tl.deliver('s', { dorsal: '7', text: 'BOX', tone: 'red', pilot: 0 })).toBe(0);
    expect(tl.deliver('s', { dorsal: '7', text: 'BOX', tone: 'red', pilot: 1 })).toBe(1);
  });

  test('al cerrar el móvil el panel ve la presencia actualizada; al cerrar el panel deja de recibirla', () => {
    const tl = createTeamLink();
    const panel = fakeWs(), movil = fakeWs(), movil2 = fakeWs();
    tl.setRoster(panel, 's', ROSTER);
    tl.registerPilot(movil, 's', '7', 0);
    movil.emit('close');
    expect(panel.last('pilot_presence').connected).toEqual([]);
    panel.emit('close');
    const antes = panel.sent.length;
    tl.registerPilot(movil2, 's', '7', 1);
    expect(panel.sent.length).toBe(antes);
    expect(tl.getRoster('s', '7')).toEqual({ pilotos: ['Javier', 'Pablo'], current: 0 }); // la lista sobrevive
  });

  test('getRoster de un dorsal sin lista → null', () => {
    expect(createTeamLink().getRoster('s', '7')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd stintpro-logger && npx jest __tests__/team-link.test.js`
Expected: FAIL — `Cannot find module '../team-link'`.

- [ ] **Step 3: Write minimal implementation**

`stintpro-logger/team-link.js`:

```js
'use strict';
// Mensajes del panel al piloto en pista.
// En resistencia cada piloto lleva su móvil y todos se suscriben al mismo dorsal.
// El panel publica la lista de pilotos y cuál va en pista (team_roster); cada
// móvil se suscribe con su índice en esa lista; un team_msg con `pilot` solo
// llega a los móviles de ese índice. Todo en memoria: tras un reinicio el
// panel republica la lista al reconectar.

const TONES       = new Set(['red', 'orange', 'blue']);
const MAX_PILOTS  = 10;   // = MAX_PILOTS del panel (src/en-race-config.js)
const MAX_NAME    = 40;
const MAX_DORSAL  = 16;
const MAX_TEXT    = 500;  // team_msg sin piloto (compatibilidad)
const MAX_TEXT_TO = 40;   // team_msg dirigido: se lee de un vistazo en el kart
const MAX_ID      = 64;
const OPEN        = 1;

function send(ws, obj) {
  if (ws.readyState === OPEN) try { ws.send(JSON.stringify(obj)); } catch (e) {}
}

function cleanDorsal(v) { return String(v ?? '').trim(); }

function validateRoster(msg) {
  const dorsal = cleanDorsal(msg.dorsal);
  if (!dorsal || dorsal.length > MAX_DORSAL) return { error: 'dorsal requerido (≤16)' };
  if (!Array.isArray(msg.pilotos) || msg.pilotos.length < 1 || msg.pilotos.length > MAX_PILOTS) {
    return { error: 'pilotos: entre 1 y 10' };
  }
  const pilotos = msg.pilotos.map(p => String(p ?? '').trim());
  if (pilotos.some(p => !p || p.length > MAX_NAME)) return { error: 'nombre de piloto vacío o de más de 40' };
  const current = msg.current ?? null;
  if (current !== null && !(Number.isInteger(current) && current >= 0 && current < pilotos.length)) {
    return { error: 'current fuera de rango' };
  }
  return { dorsal, pilotos, current };
}

function validatePilotIndex(v) {
  if (v === undefined || v === null) return { pilot: null };
  if (!Number.isInteger(v) || v < 0 || v >= MAX_PILOTS) return { error: 'pilot inválido' };
  return { pilot: v };
}

function validateTeamMsg(msg) {
  const dorsal = cleanDorsal(msg.dorsal);
  const text   = String(msg.text ?? '').trim();
  if (!dorsal || !text) return { error: 'slug, dorsal y text requeridos' };
  if (dorsal.length > MAX_DORSAL || text.length > MAX_TEXT) {
    return { error: 'dorsal (≤16) o text (≤500) demasiado largos' };
  }
  const p = validatePilotIndex(msg.pilot);
  if (p.error) return p;
  if (p.pilot !== null && text.length > MAX_TEXT_TO) return { error: 'text (≤40) demasiado largo para el piloto' };
  const tone = msg.tone ?? 'orange';
  if (!TONES.has(tone)) return { error: 'tone inválido' };
  const id = msg.id ?? null;
  if (id !== null && (typeof id !== 'string' || id.length > MAX_ID)) return { error: 'id inválido' };
  return { dorsal, text, pilot: p.pilot, tone, id };
}

function createTeamLink() {
  const rosters = new Map();  // `${slug}|${dorsal}` → { dorsal, pilotos, current, publishers:Set<ws> }
  const pilots  = new Map();  // ws (móvil) → { key, pilot:number|null }
  const keyOf   = (slug, dorsal) => `${slug}|${dorsal}`;

  function hook(ws) {
    if (ws._teamLinkHooked) return;
    ws._teamLinkHooked = true;
    ws.on('close', () => drop(ws));
  }

  function connectedFor(key) {
    const s = new Set();
    for (const e of pilots.values()) if (e.key === key && e.pilot !== null) s.add(e.pilot);
    return [...s].sort((a, b) => a - b);
  }

  // A los paneles del dorsal (o solo a `only`): qué pilotos tienen móvil conectado.
  function presence(key, only) {
    const r = rosters.get(key);
    if (!r) return;
    const msg = { type: 'pilot_presence', dorsal: r.dorsal, connected: connectedFor(key) };
    for (const ws of (only ? [only] : r.publishers)) send(ws, msg);
  }

  function setRoster(ws, slug, roster) {
    const key = keyOf(slug, roster.dorsal);
    let r = rosters.get(key);
    if (!r) { r = { dorsal: roster.dorsal, publishers: new Set() }; rosters.set(key, r); }
    r.pilotos = roster.pilotos;
    r.current = roster.current;
    r.publishers.add(ws);
    hook(ws);
    const out = { type: 'team_roster', pilotos: r.pilotos, current: r.current };
    for (const [m, e] of pilots) if (e.key === key) send(m, out);
    presence(key, ws);
  }

  function getRoster(slug, dorsal) {
    const r = rosters.get(keyOf(slug, cleanDorsal(dorsal)));
    return r ? { pilotos: r.pilotos, current: r.current } : null;
  }

  function registerPilot(ws, slug, dorsal, pilot) {
    const key  = keyOf(slug, cleanDorsal(dorsal));
    const prev = pilots.get(ws);
    pilots.set(ws, { key, pilot: Number.isInteger(pilot) ? pilot : null });
    hook(ws);
    if (prev && prev.key !== key) presence(prev.key);
    presence(key);
    const r = rosters.get(key);
    if (r) send(ws, { type: 'team_roster', pilotos: r.pilotos, current: r.current });
  }

  function deliver(slug, { dorsal, text, tone, pilot }) {
    const key = keyOf(slug, dorsal);
    const out = { type: 'team_msg', text, tone };
    let n = 0;
    for (const [m, e] of pilots) {
      if (e.key !== key || m.readyState !== OPEN) continue;
      if (pilot !== null && e.pilot !== pilot) continue;
      send(m, out);
      n++;
    }
    return n;
  }

  function drop(ws) {
    const e = pilots.get(ws);
    if (e) { pilots.delete(ws); presence(e.key); }
    for (const r of rosters.values()) r.publishers.delete(ws);
  }

  return { setRoster, getRoster, registerPilot, deliver, drop };
}

module.exports = { createTeamLink, validateRoster, validatePilotIndex, validateTeamMsg, TONES };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd stintpro-logger && npx jest __tests__/team-link.test.js`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add stintpro-logger/team-link.js stintpro-logger/__tests__/team-link.test.js
git commit -m "logger: team-link, reparto de mensajes al piloto en pista

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Cablear `team-link` en el WebSocket del servidor

**Files:**
- Modify: `stintpro-logger/server.js` (imports ~l.14; dentro de `createServer`, antes de `wss.on('connection'`; bloques `pilot` y `team_msg` ~l.1022-1076)
- Modify: `stintpro-logger/circuit-monitor.js:920-928` (`subscribePilot`)
- Modify: `stintpro-logger/__tests__/circuit-monitor.test.js` (añadir test)
- Test: `stintpro-logger/__tests__/team-link-ws.test.js`

**Interfaces:**
- Consumes: `createTeamLink`, `validateRoster`, `validatePilotIndex`, `validateTeamMsg` (Task 1).
- Produces (protocolo WS, lo usan Task 3, 5 y 7):
  - `pilot {slug, dorsal, pilot?}` → `pilot_ack` + (si hay lista) `team_roster`.
  - `team_roster {slug, dorsal, pilotos, current}` → `pilot_presence` al emisor; `team_roster` a los móviles.
  - `roster_get {slug, dorsal}` → `{type:'team_roster', pilotos|null, current|null}`.
  - `team_msg {slug, dorsal, text, tone?, pilot?, id?}` → móviles `{type:'team_msg', text, tone}`; emisor `{type:'team_msg_sent', id, dorsal, pilot, text, delivered}`.

- [ ] **Step 1: Write the failing tests**

Añadir al final de `__tests__/circuit-monitor.test.js` (usa `createMonitor` y `fakeClientWs` ya definidos en el fichero):

```js
describe('subscribePilot — resuscripción', () => {
  test('la misma conexión cambia de dorsal sin seguir en el anterior ni duplicar listeners', () => {
    const m  = createMonitor();
    const ws = fakeClientWs();
    m.subscribePilot(ws, '7');
    m.subscribePilot(ws, '9');
    m.subscribePilot(ws, '9');
    expect(m.pilotSubscribers.get('7').has(ws)).toBe(false);
    expect(m.pilotSubscribers.get('9').size).toBe(1);
    expect(ws.listenerCount('close')).toBe(1);
    ws.emit('close');
    expect(m.pilotSubscribers.get('9').size).toBe(0);
  });
});
```

Crear `__tests__/team-link-ws.test.js`:

```js
'use strict';

// Integración: mensajes al piloto en pista a través del handler WS real.
const { WebSocket } = require('ws');
const db = require('../db');
const { createTestServer } = require('./helpers/test-server');

const KEY = 'test-key-teamlink';
let server, wsUrl;

beforeAll(async () => {
  await db.init();
  ({ server, wsUrl } = await createTestServer({ apiKey: KEY }));
});
afterAll(() => new Promise(r => server.close(r)));

// Cliente autenticado que acumula todo lo que recibe.
async function client() {
  const ws = new WebSocket(wsUrl);
  ws.inbox = [];
  ws.on('message', m => ws.inbox.push(JSON.parse(m.toString())));
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  ws.send(JSON.stringify({ type: 'auth', apikey: KEY }));
  await waitFor(ws, m => m.type === 'auth_ok');
  return ws;
}
function waitFor(ws, pred, ms = 2000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      const i = ws.inbox.findIndex(pred);
      if (i >= 0) return resolve(ws.inbox.splice(i, 1)[0]);
      if (Date.now() - t0 > ms) return reject(new Error('timeout esperando mensaje'));
      setTimeout(poll, 10);
    })();
  });
}
const send = (ws, o) => ws.send(JSON.stringify(o));
const ROSTER = { type: 'team_roster', slug: 'test-slug', dorsal: '7', pilotos: ['Javier', 'Pablo'], current: 0 };

test('BOX solo llega al móvil del piloto en pista y el panel recibe delivered=1', async () => {
  const panel = await client(), javier = await client(), pablo = await client();
  send(panel, ROSTER);
  await waitFor(panel, m => m.type === 'pilot_presence');
  send(javier, { type: 'pilot', slug: 'test-slug', dorsal: '7', pilot: 0 });
  send(pablo,  { type: 'pilot', slug: 'test-slug', dorsal: '7', pilot: 1 });
  await waitFor(panel, m => m.type === 'pilot_presence' && m.connected.length === 2);
  await waitFor(javier, m => m.type === 'team_roster');

  send(panel, { type: 'team_msg', slug: 'test-slug', dorsal: '7', text: 'BOX', tone: 'red', pilot: 0, id: 'm-1' });
  const ack = await waitFor(panel, m => m.type === 'team_msg_sent');
  expect(ack).toMatchObject({ id: 'm-1', dorsal: '7', pilot: 0, delivered: 1 });
  expect(await waitFor(javier, m => m.type === 'team_msg')).toEqual({ type: 'team_msg', text: 'BOX', tone: 'red' });
  await new Promise(r => setTimeout(r, 100));
  expect(pablo.inbox.find(m => m.type === 'team_msg')).toBeUndefined();
  [panel, javier, pablo].forEach(w => w.close());
});

test('roster_get devuelve la lista publicada, o null si no hay', async () => {
  const panel = await client(), movil = await client();
  send(movil, { type: 'roster_get', slug: 'test-slug', dorsal: '55' });
  expect(await waitFor(movil, m => m.type === 'team_roster')).toEqual({ type: 'team_roster', pilotos: null, current: null });
  send(panel, { ...ROSTER, dorsal: '55' });
  await waitFor(panel, m => m.type === 'pilot_presence');
  send(movil, { type: 'roster_get', slug: 'test-slug', dorsal: '55' });
  expect(await waitFor(movil, m => m.type === 'team_roster')).toEqual({ type: 'team_roster', pilotos: ['Javier', 'Pablo'], current: 0 });
  [panel, movil].forEach(w => w.close());
});

test('delivered=0 si el piloto en pista no tiene móvil', async () => {
  const panel = await client();
  send(panel, { ...ROSTER, dorsal: '66' });
  send(panel, { type: 'team_msg', slug: 'test-slug', dorsal: '66', text: 'BOX', tone: 'red', pilot: 1, id: 'm-2' });
  expect(await waitFor(panel, m => m.type === 'team_msg_sent')).toMatchObject({ id: 'm-2', delivered: 0 });
  panel.close();
});

test.each([
  [{ type: 'team_roster', slug: 'test-slug', dorsal: '7', pilotos: [] }],
  [{ type: 'team_roster', slug: 'circuito-fantasma', dorsal: '7', pilotos: ['A'] }],
  [{ type: 'roster_get', slug: 'circuito-fantasma', dorsal: '7' }],
  [{ type: 'pilot', slug: 'test-slug', dorsal: '7', pilot: 42 }],
  [{ type: 'team_msg', slug: 'test-slug', dorsal: '7', text: 'X'.repeat(41), pilot: 0 }],
  [{ type: 'team_msg', slug: 'test-slug', dorsal: '7', text: 'hola', tone: 'verde' }],
])('error de forma: %j', async (msg) => {
  const ws = await client();
  send(ws, msg);
  expect((await waitFor(ws, m => m.type === 'error')).type).toBe('error');
  ws.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd stintpro-logger && npx jest __tests__/team-link-ws.test.js __tests__/circuit-monitor.test.js`
Expected: FAIL — `team_roster`/`roster_get` responden «Tipo desconocido», no hay `delivered`, y el test de resuscripción ve el ws aún en el dorsal 7.

- [ ] **Step 3: Implement**

3a. `circuit-monitor.js` — sustituir `subscribePilot` entero por:

```js
  subscribePilot(ws, dorsal) {
    const key = String(dorsal);
    // Resuscripción desde la misma conexión (la app cambia de dorsal o de piloto):
    // fuera de cualquier otro dorsal para no recibir datos de dos karts.
    for (const [d, set] of this.pilotSubscribers) if (d !== key) set.delete(ws);
    if (!this.pilotSubscribers.has(key)) this.pilotSubscribers.set(key, new Set());
    this.pilotSubscribers.get(key).add(ws);
    if (!this._pilotHooked) this._pilotHooked = new WeakSet();
    if (!this._pilotHooked.has(ws)) {
      this._pilotHooked.add(ws);
      const off = () => { for (const set of this.pilotSubscribers.values()) set.delete(ws); };
      ws.on('close', off);
      ws.on('error', off);
    }
    ws.send(JSON.stringify({ type: 'pilot_ack', slug: this.slug, dorsal: key }));
  }
```

3b. `server.js` — import junto a los demás (tras `const { computePilotRatings } = require('./scoring');`):

```js
const { createTeamLink, validateRoster, validatePilotIndex, validateTeamMsg } = require('./team-link');
```

3c. `server.js` — justo antes de `wss.on('connection', (ws) => {` (dentro de `createServer`):

```js
// Mensajes del panel al piloto en pista (listas de pilotos y móviles por piloto).
const teamLink = createTeamLink();
```

3d. `server.js` — sustituir el bloque `// pilot — subscripción filtrada por dorsal …` (desde `if (msg.type === 'pilot') {` hasta su `return; }`) por:

```js
    // pilot — subscripción filtrada por dorsal para la app del piloto.
    // `pilot` (opcional) = índice del piloto en la lista que publica el panel.
    if (msg.type === 'pilot') {
      const slug   = (msg.slug   || '').trim();
      const dorsal = (msg.dorsal || '').toString().trim();
      const mon    = monitors.get(slug);
      if (!mon) {
        ws.send(JSON.stringify({ type: 'error', msg: `Circuito '${slug}' no encontrado` }));
        return;
      }
      if (!dorsal) {
        ws.send(JSON.stringify({ type: 'error', msg: 'dorsal requerido' }));
        return;
      }
      const p = validatePilotIndex(msg.pilot);
      if (p.error) {
        ws.send(JSON.stringify({ type: 'error', msg: p.error }));
        return;
      }
      mon.subscribePilot(ws, dorsal);
      teamLink.registerPilot(ws, slug, dorsal, p.pilot);
      return;
    }

    // team_roster — el panel publica sus pilotos y cuál va en pista
    if (msg.type === 'team_roster') {
      const slug = (msg.slug || '').trim();
      if (!monitors.get(slug)) {
        ws.send(JSON.stringify({ type: 'error', msg: `Circuito '${slug}' no encontrado` }));
        return;
      }
      const r = validateRoster(msg);
      if (r.error) {
        ws.send(JSON.stringify({ type: 'error', msg: r.error }));
        return;
      }
      teamLink.setRoster(ws, slug, r);
      return;
    }

    // roster_get — la app pide la lista para «¿Quién eres?»
    if (msg.type === 'roster_get') {
      const slug = (msg.slug || '').trim();
      if (!monitors.get(slug)) {
        ws.send(JSON.stringify({ type: 'error', msg: `Circuito '${slug}' no encontrado` }));
        return;
      }
      const r = teamLink.getRoster(slug, msg.dorsal);
      ws.send(JSON.stringify({ type: 'team_roster', pilotos: r ? r.pilotos : null, current: r ? r.current : null }));
      return;
    }
```

3e. `server.js` — en el bloque `if (msg.type === 'team_msg') {`:
- sustituir las líneas desde `const slug   = (msg.slug   || '').trim();` hasta el cierre del `if (dorsal.length > 16 || text.length > 500) {…}` por:

```js
      const slug = (msg.slug || '').trim();
      const mon  = monitors.get(slug);
      const v    = mon ? validateTeamMsg(msg) : { error: 'slug, dorsal y text requeridos' };
      if (v.error) {
        ws.send(JSON.stringify({ type: 'error', msg: v.error }));
        return;
      }
```

- conservar intactos el comentario `TODO(pertenencia)` y el rate limit (`ws._teamMsgTimes…`);
- sustituir desde `const clients = mon.pilotSubscribers.get(dorsal);` hasta `ws.send(JSON.stringify({ type: 'team_msg_sent', dorsal, text }));` por:

```js
      const delivered = teamLink.deliver(slug, v);
      ws.send(JSON.stringify({ type: 'team_msg_sent', id: v.id, dorsal: v.dorsal, pilot: v.pilot, text: v.text, delivered }));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd stintpro-logger && npx jest`
Expected: PASS toda la suite (402 previos + los nuevos). Los tests antiguos de `team_msg` en `server-security.test.js` siguen pasando (sin `pilot` = compatibilidad).

- [ ] **Step 5: Commit**

```bash
git add stintpro-logger/server.js stintpro-logger/circuit-monitor.js stintpro-logger/__tests__/team-link-ws.test.js stintpro-logger/__tests__/circuit-monitor.test.js
git commit -m "logger: team_roster, roster_get y team_msg dirigido al piloto en pista

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Mismo reparto en el replay local

**Files:**
- Modify: `stintpro-logger/replay-vps.js` (handler `wss.on('connection'…)`, ~l.82-110)

**Interfaces:**
- Consumes: `createTeamLink`, `validateRoster`, `validatePilotIndex`, `validateTeamMsg` (Task 1); protocolo de Task 2.

- [ ] **Step 1: Implement**

Tras `const db = require('./db');` añadir:

```js
const { createTeamLink, validateRoster, validatePilotIndex, validateTeamMsg } = require('./team-link');
const teamLink = createTeamLink();
```

Sustituir el cuerpo del `try { … }` de `ws.on('message', …)` por:

```js
      const msg = JSON.parse(raw.toString());
      const err = (m) => ws.send(JSON.stringify({ type: 'error', msg: m }));
      // La app manda { type:'auth', token|apikey } primero y espera auth_ok
      // para suscribirse; en el replay local no se verifica.
      if (msg.type === 'auth') {
        ws.send(JSON.stringify({ type: 'auth_ok' }));
      } else if (msg.type === 'pilot') {
        const p = validatePilotIndex(msg.pilot);
        if (p.error) return err(p.error);
        mon.subscribePilot(ws, msg.dorsal);
        teamLink.registerPilot(ws, slug, msg.dorsal, p.pilot);
      } else if (msg.type === 'subscribe') {
        mon.subscribe(ws);
      } else if (msg.type === 'team_roster') {
        const r = validateRoster(msg);
        if (r.error) return err(r.error);
        teamLink.setRoster(ws, slug, r);
      } else if (msg.type === 'roster_get') {
        const r = teamLink.getRoster(slug, msg.dorsal);
        ws.send(JSON.stringify({ type: 'team_roster', pilotos: r ? r.pilotos : null, current: r ? r.current : null }));
      } else if (msg.type === 'team_msg') {
        const v = validateTeamMsg(msg);
        if (v.error) return err(v.error);
        const delivered = teamLink.deliver(slug, v);
        ws.send(JSON.stringify({ type: 'team_msg_sent', id: v.id, dorsal: v.dorsal, pilot: v.pilot, text: v.text, delivered }));
      }
```

- [ ] **Step 2: Verify by hand**

```bash
cd stintpro-logger
node replay-vps.js "/Users/javiercoy/Downloads/karting-lossantos_2026-06-27T18-32-03.ndjson" karting-lossantos --speed 5 &
sleep 2
node -e "
const WS=require('ws');const mk=()=>new Promise(r=>{const w=new WS('ws://127.0.0.1:3001');w.in=[];w.on('message',m=>w.in.push(JSON.parse(m)));w.on('open',()=>r(w));});
(async()=>{const panel=await mk(),a=await mk(),b=await mk();const s=(w,o)=>w.send(JSON.stringify(o));
s(panel,{type:'team_roster',slug:'karting-lossantos',dorsal:'17',pilotos:['A','B'],current:0});
s(a,{type:'pilot',slug:'karting-lossantos',dorsal:'17',pilot:0});s(b,{type:'pilot',slug:'karting-lossantos',dorsal:'17',pilot:1});
await new Promise(r=>setTimeout(r,300));s(panel,{type:'team_msg',slug:'karting-lossantos',dorsal:'17',text:'BOX',tone:'red',pilot:0,id:'x'});
await new Promise(r=>setTimeout(r,300));
console.log('ack',JSON.stringify(panel.in.find(m=>m.type==='team_msg_sent')));
console.log('A',!!a.in.find(m=>m.type==='team_msg'),'B',!!b.in.find(m=>m.type==='team_msg'));process.exit();})();"
kill %1
```

Expected: `ack {...,"delivered":1}` y `A true B false`.

- [ ] **Step 3: Commit**

```bash
git add stintpro-logger/replay-vps.js
git commit -m "replay-vps: mismo reparto de mensajes al piloto que el servidor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Núcleo puro del panel (`en-pilot-link-core.js`)

**Files:**
- Create: `src/en-pilot-link-core.js`
- Test: `tests/pilot-link.test.js`

**Interfaces:**
- Produces (global `window.EnPilotLinkCore` en navegador; `module.exports` en Node):
  - `QUICK_MESSAGES: {text, tone}[]` (13, orden de Global Constraints)
  - `MAX_TEXT = 40`
  - `buildRoster(cfg, session) → {type:'team_roster', slug, dorsal, pilotos, current} | null`
  - `rosterSignature(roster) → string`
  - `buildTeamMsg(roster, text, tone, id) → {error} | {type:'team_msg', slug, dorsal, text, tone, pilot, id}`
  - `currentPilotName(roster) → string|null`
  - `deliveryLabel(ack, name) → {ok:boolean, text:string}`

- [ ] **Step 1: Write the failing test**

`tests/pilot-link.test.js`:

```js
// StintPro — núcleo de los mensajes al piloto en pista (en-pilot-link-core.js).
// Ejecutar: node tests/pilot-link.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert');
const C = require('../src/en-pilot-link-core');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const CFG = { slug: 'campillos', myDorsal: 17, pilotos: [{ name: ' Javier ' }, { name: 'Pablo' }] };

console.log('\nMensajes rápidos');
test('13 mensajes en el orden acordado, Box primero y bandera azul en azul', () => {
  strictEqual(C.QUICK_MESSAGES.length, 13);
  deepStrictEqual(C.QUICK_MESSAGES.slice(0, 4).map(m => m.text), ['BOX', 'BOX PRÓXIMA', 'NO ENTRES', 'UNA VUELTA MÁS']);
  ok(C.QUICK_MESSAGES.slice(0, 4).every(m => m.tone === 'red'));
  deepStrictEqual(C.QUICK_MESSAGES.find(m => m.text === 'BANDERA AZUL'), { text: 'BANDERA AZUL', tone: 'blue' });
  ok(C.QUICK_MESSAGES.every(m => m.text.length <= C.MAX_TEXT));
});

console.log('\nLista de pilotos');
test('construye la lista con el piloto en pista', () => {
  deepStrictEqual(C.buildRoster(CFG, { currentPilot: 1 }),
    { type: 'team_roster', slug: 'campillos', dorsal: '17', pilotos: ['Javier', 'Pablo'], current: 1 });
});
test('sin slug, dorsal o pilotos → null', () => {
  strictEqual(C.buildRoster({ ...CFG, slug: '' }, { currentPilot: 0 }), null);
  strictEqual(C.buildRoster({ ...CFG, myDorsal: '' }, { currentPilot: 0 }), null);
  strictEqual(C.buildRoster({ ...CFG, pilotos: [] }, { currentPilot: 0 }), null);
});
test('nombre vacío → «Piloto N»; recorta a 10 pilotos y 40 caracteres', () => {
  const r = C.buildRoster({ ...CFG, pilotos: [{ name: '' }, { name: 'X'.repeat(50) }, ...Array(12).fill({ name: 'Y' })] }, { currentPilot: 0 });
  strictEqual(r.pilotos.length, 10);
  strictEqual(r.pilotos[0], 'Piloto 1');
  strictEqual(r.pilotos[1].length, 40);
});
test('currentPilot fuera de rango → null', () => {
  strictEqual(C.buildRoster(CFG, { currentPilot: 5 }).current, null);
  strictEqual(C.buildRoster(CFG, {}).current, null);
});
test('la firma cambia solo si cambia la lista', () => {
  const a = C.rosterSignature(C.buildRoster(CFG, { currentPilot: 0 }));
  strictEqual(a, C.rosterSignature(C.buildRoster(CFG, { currentPilot: 0 })));
  ok(a !== C.rosterSignature(C.buildRoster(CFG, { currentPilot: 1 })));
  strictEqual(C.rosterSignature(null), '');
});

console.log('\nMensaje');
const R = C.buildRoster(CFG, { currentPilot: 0 });
test('mensaje al piloto en pista', () => {
  deepStrictEqual(C.buildTeamMsg(R, ' BOX ', 'red', 'm-1'),
    { type: 'team_msg', slug: 'campillos', dorsal: '17', text: 'BOX', tone: 'red', pilot: 0, id: 'm-1' });
});
test('tono desconocido → naranja', () => {
  strictEqual(C.buildTeamMsg(R, 'hola', 'verde', 'm').tone, 'orange');
});
test('errores: sin lista, nadie en pista, vacío, >40', () => {
  ok(C.buildTeamMsg(null, 'BOX', 'red', 'm').error);
  ok(/pista/i.test(C.buildTeamMsg({ ...R, current: null }, 'BOX', 'red', 'm').error));
  ok(C.buildTeamMsg(R, '   ', 'red', 'm').error);
  ok(C.buildTeamMsg(R, 'X'.repeat(41), 'red', 'm').error);
});
test('nombre del piloto en pista', () => {
  strictEqual(C.currentPilotName(R), 'Javier');
  strictEqual(C.currentPilotName({ ...R, current: null }), null);
  strictEqual(C.currentPilotName(null), null);
});

console.log('\nEntrega');
test('etiquetas de entregado / no entregado', () => {
  deepStrictEqual(C.deliveryLabel({ delivered: 1 }, 'Javier'), { ok: true, text: 'Entregado a Javier' });
  deepStrictEqual(C.deliveryLabel({ delivered: 0 }, 'Javier'), { ok: false, text: 'No entregado: Javier no tiene el móvil conectado' });
});

console.log(`\n${passed + failed} tests — ${passed} pasados, ${failed} fallados\n`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/pilot-link.test.js`
Expected: FAIL — `Cannot find module '../src/en-pilot-link-core'`.

- [ ] **Step 3: Write minimal implementation**

`src/en-pilot-link-core.js`:

```js
// ── en-pilot-link-core.js — mensajes al piloto en pista (núcleo puro) ───────
// Construye lo que el panel manda al VPS: la lista de pilotos de mi equipo con
// el que va en pista (team_roster) y los mensajes (team_msg) dirigidos a él.
// Sin DOM ni WebSocket: la conexión y la UI viven en en-pilot-link.js.
// Tests: tests/pilot-link.test.js.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EnPilotLinkCore = api;
})(typeof window !== 'undefined' ? window : this, function () {

  const MAX_TEXT = 40;    // se lee de un vistazo en el kart
  const MAX_PILOTS = 10;  // = MAX_PILOTS de en-race-config.js
  const MAX_NAME = 40;
  const TONES = ['red', 'orange', 'blue'];

  // Orden = orden del modal (primera fila, Box). Box en rojo; bandera azul en azul.
  const QUICK_MESSAGES = [
    { text: 'BOX', tone: 'red' }, { text: 'BOX PRÓXIMA', tone: 'red' },
    { text: 'NO ENTRES', tone: 'red' }, { text: 'UNA VUELTA MÁS', tone: 'red' },
    { text: 'PUSH', tone: 'orange' }, { text: 'MANTÉN RITMO', tone: 'orange' }, { text: 'TRANQUILO', tone: 'orange' },
    { text: 'RIVAL DETRÁS', tone: 'orange' }, { text: 'ATACA', tone: 'orange' },
    { text: 'BANDERA AZUL', tone: 'blue' }, { text: 'LÍMITES DE PISTA', tone: 'orange' }, { text: 'SANCIÓN', tone: 'orange' },
    { text: 'OK', tone: 'orange' },
  ];

  function buildRoster(cfg, session) {
    const slug = String(cfg?.slug || '').trim();
    const dorsal = String(cfg?.myDorsal ?? '').trim();
    const list = Array.isArray(cfg?.pilotos) ? cfg.pilotos.slice(0, MAX_PILOTS) : [];
    if (!slug || !dorsal || !list.length) return null;
    const pilotos = list.map((p, i) => (String(p?.name || '').trim() || `Piloto ${i + 1}`).slice(0, MAX_NAME));
    const c = session?.currentPilot;
    const current = Number.isInteger(c) && c >= 0 && c < pilotos.length ? c : null;
    return { type: 'team_roster', slug, dorsal, pilotos, current };
  }

  function rosterSignature(roster) { return roster ? JSON.stringify(roster) : ''; }

  function buildTeamMsg(roster, text, tone, id) {
    if (!roster) return { error: 'Configura tu dorsal y tus pilotos' };
    if (roster.current === null) return { error: 'Marca quién va en pista' };
    const t = String(text || '').trim();
    if (!t) return { error: 'Mensaje vacío' };
    if (t.length > MAX_TEXT) return { error: `Máximo ${MAX_TEXT} caracteres` };
    return { type: 'team_msg', slug: roster.slug, dorsal: roster.dorsal, text: t,
             tone: TONES.includes(tone) ? tone : 'orange', pilot: roster.current, id };
  }

  function currentPilotName(roster) {
    return roster && roster.current !== null ? roster.pilotos[roster.current] : null;
  }

  function deliveryLabel(ack, name) {
    return ack && ack.delivered > 0
      ? { ok: true, text: `Entregado a ${name}` }
      : { ok: false, text: `No entregado: ${name} no tiene el móvil conectado` };
  }

  return { QUICK_MESSAGES, MAX_TEXT, buildRoster, rosterSignature, buildTeamMsg, currentPilotName, deliveryLabel };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/pilot-link.test.js`
Expected: `… 0 fallados`, salida 0.

- [ ] **Step 5: Commit**

```bash
git add src/en-pilot-link-core.js tests/pilot-link.test.js
git commit -m "panel: núcleo de los mensajes al piloto en pista

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Conexión, botón 📻 RADIO y modal del panel

**Files:**
- Create: `src/en-pilot-link.js`
- Modify: `src/index.html` (tras `<script src="en-messages.js"></script>`, l.96)
- Modify: `src/en-team.js` (`_enRenderTeam`, tarjeta «Piloto en pista», junto al botón `🔄 Cambio`)
- Modify: `src/styles.css` (tras el bloque `.en-msg-btn.mine`, ~l.244)

**Interfaces:**
- Consumes: `EnPilotLinkCore` (Task 4); protocolo WS (Task 2); globales existentes `AppState.config`, `AppState.loggerUrl`, `AppState.loggerApiKey`, `EnSession.currentPilot`, `SPAuth.idToken()`, `_esc()`, `_enDismissOverlay()`.
- Produces: `window.EnPilotLink { start(), authed, presence:number[], lastStatus:{ok,text}|null, roster(), send(text, tone) → Promise<ack>, onChange(fn) → unsubscribe }`; globales `_enRadioBtnHtml()`, `_enShowPilotMsg()`, `_enSendQuick(i)`, `_enSendFree()`.

- [ ] **Step 1: Implement `src/en-pilot-link.js`**

```js
// ── en-pilot-link.js — mensajes al piloto en pista (conexión + UI) ──────────
// Conexión propia al WS del VPS, independiente del modo de datos (Logger,
// directo a Apex o replay): los mensajes funcionan aunque los datos vengan de
// Apex. Publica la lista de pilotos y cuál va en pista (EnSession.currentPilot,
// que Apex actualiza solo en el relevo) y manda los team_msg dirigidos.
// Núcleo puro en en-pilot-link-core.js.

window.EnPilotLink = {
  ws: null, authed: false, presence: [], lastStatus: null,
  _started: false, _timer: null, _sig: '', _pending: new Map(), _listeners: new Set(),

  start() {
    if (this._started) return;
    this._started = true;
    this._connect();
    // La lista cambia desde muchos sitios (setup, relevo por Apex, selección
    // manual): se compara cada 2 s en vez de enganchar cada punto de cambio.
    setInterval(() => this._syncRoster(), 2000);
  },

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); },
  _emit() { this._listeners.forEach(fn => { try { fn(); } catch (e) { console.error('[StintPro] pilot-link', e); } }); },

  // EnSession es un `const` global (en-state.js): accesible por nombre, no como window.EnSession.
  roster() { return EnPilotLinkCore.buildRoster(window.AppState?.config, typeof EnSession !== 'undefined' ? EnSession : null); },

  _url() {
    const u = window.AppState?.loggerUrl || localStorage.getItem('stintpro_logger_url') || '';
    return u ? u.replace(/\/$/, '').replace('http://', 'ws://').replace('https://', 'wss://') : '';
  },

  _retry() { clearTimeout(this._timer); this._timer = setTimeout(() => this._connect(), 5000); },

  _connect() {
    const url = this._url();
    if (!url) return this._retry();
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return this._retry(); }
    this.ws = ws;
    ws.onopen = async () => {
      let token = '';
      try { token = window.SPAuth ? await window.SPAuth.idToken() : ''; } catch (e) {}
      const apikey = window.AppState?.loggerApiKey || localStorage.getItem('stintpro_logger_apikey') || '';
      if (token) ws.send(JSON.stringify({ type: 'auth', token }));
      else if (apikey) ws.send(JSON.stringify({ type: 'auth', apikey }));
    };
    ws.onmessage = (evt) => {
      let m; try { m = JSON.parse(evt.data); } catch (e) { return; }
      this._onMsg(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null; this.authed = false; this.presence = []; this._sig = '';
      for (const p of this._pending.values()) { clearTimeout(p.t); p.reject(new Error('sin conexión')); }
      this._pending.clear();
      this._emit();
      this._retry();
    };
  },

  _onMsg(m) {
    if (m.type === 'auth_ok') {
      this.authed = true; this._sig = '';
      this._syncRoster(); this._emit();
    } else if (m.type === 'pilot_presence') {
      this.presence = Array.isArray(m.connected) ? m.connected : [];
      this._emit();
    } else if (m.type === 'team_msg_sent' && m.id && this._pending.has(m.id)) {
      const p = this._pending.get(m.id);
      this._pending.delete(m.id); clearTimeout(p.t); p.resolve(m);
    }
  },

  _syncRoster() {
    if (!this.authed || !this.ws) return;
    const r = this.roster();
    const sig = EnPilotLinkCore.rosterSignature(r);
    if (!r || sig === this._sig) return;
    this._sig = sig;
    this.ws.send(JSON.stringify(r));
    this._emit();
  },

  send(text, tone) {
    return new Promise((resolve, reject) => {
      if (!this.authed || !this.ws) return reject(new Error('Sin conexión con el servidor'));
      this._syncRoster(); // que el VPS tenga el piloto en pista actual antes del mensaje
      const id = 'm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      const msg = EnPilotLinkCore.buildTeamMsg(this.roster(), text, tone, id);
      if (msg.error) return reject(new Error(msg.error));
      const t = setTimeout(() => { this._pending.delete(id); reject(new Error('Sin respuesta del servidor')); }, 5000);
      this._pending.set(id, { resolve, reject, t });
      this.ws.send(JSON.stringify(msg));
    });
  },
};

// ── UI: botón 📻 RADIO en Mi equipo (tarjeta «Piloto en pista») + modal ─────

function _enRadioBtnHtml(){
  EnPilotLink.start();
  const ok=EnPilotLink.authed;
  const title=ok?'Mensaje al piloto en pista':'Radio: sin conexión con el servidor';
  return `<button class="en-change-btn en-radio-btn" title="${title}" ${ok?'':'disabled'} onclick="event.stopPropagation();_enShowPilotMsg()">📻 RADIO</button>`;
}

function _enShowPilotMsg(){
  let overlay=document.getElementById('en-pilot-overlay');
  if(overlay)overlay.remove();
  overlay=document.createElement('div');
  overlay.id='en-pilot-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:999;';
  overlay.onclick=(e)=>{ if(e.target===overlay)_enDismissOverlay(); };
  const box=document.createElement('div');
  box.className='sp-modal en-pmsg';
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const render=()=>{
    if(!document.body.contains(box)){ off(); return; }
    _enRenderPilotMsg(box);
  };
  const off=EnPilotLink.onChange(render);
  render();
}

function _enRenderPilotMsg(box){
  const C=EnPilotLinkCore;
  const r=EnPilotLink.roster();
  const name=C.currentPilotName(r);
  const conectado=r&&r.current!==null&&EnPilotLink.presence.includes(r.current);
  const enabled=EnPilotLink.authed&&!!name;
  let head;
  if(!EnPilotLink.authed) head='<span class="en-pmsg-warn">Sin conexión con el servidor</span>';
  else if(!r) head='<span class="en-pmsg-warn">Configura tu dorsal y tus pilotos</span>';
  else if(!name) head='<span class="en-pmsg-warn">Marca quién va en pista</span>';
  else head=`Para: <b>${_esc(name)}</b> (en pista) · <span class="${conectado?'en-pmsg-on':'en-pmsg-off'}">📱 ${conectado?'conectado':'sin móvil'}</span>`;
  const st=EnPilotLink.lastStatus;
  // Conservar lo escrito en el campo libre entre re-renders (presencia, acuses).
  const prev=box.querySelector('#en-pmsg-free')?.value||'';
  box.innerHTML=`
    <div class="en-pmsg-title">📻 Radio al piloto</div>
    <div class="en-pmsg-head">${head}</div>
    <div class="en-pmsg-grid">
      ${C.QUICK_MESSAGES.map((m,i)=>`<button class="en-pmsg-q ${m.tone}" ${enabled?'':'disabled'} onclick="_enSendQuick(${i})">${_esc(m.text)}</button>`).join('')}
    </div>
    <div class="en-pmsg-free">
      <input id="en-pmsg-free" maxlength="${C.MAX_TEXT}" placeholder="Texto libre (máx. ${C.MAX_TEXT})" ${enabled?'':'disabled'}
             onkeydown="if(event.key==='Enter')_enSendFree()">
      <button class="en-pmsg-send" ${enabled?'':'disabled'} onclick="_enSendFree()">Enviar</button>
    </div>
    <div class="en-pmsg-status ${st?(st.ok?'ok':'ko'):''}">${st?_esc(st.text):''}</div>
    <button class="en-pmsg-close" onclick="_enDismissOverlay()">Cerrar</button>`;
  const inp=box.querySelector('#en-pmsg-free');
  if(inp)inp.value=prev;
}

async function _enSendPilotMsg(text,tone){
  const name=EnPilotLinkCore.currentPilotName(EnPilotLink.roster())||'el piloto';
  EnPilotLink.lastStatus={ok:true,text:'Enviando…'};
  EnPilotLink._emit();
  try{
    const ack=await EnPilotLink.send(text,tone);
    EnPilotLink.lastStatus=EnPilotLinkCore.deliveryLabel(ack,name);
    return true;
  }catch(e){
    EnPilotLink.lastStatus={ok:false,text:'No enviado: '+e.message};
    return false;
  }finally{
    EnPilotLink._emit();
  }
}

function _enSendQuick(i){
  const m=EnPilotLinkCore.QUICK_MESSAGES[i];
  if(m)_enSendPilotMsg(m.text,m.tone);
}

async function _enSendFree(){
  const inp=document.getElementById('en-pmsg-free');
  if(!inp||!inp.value.trim())return;
  const text=inp.value;
  inp.value='';
  if(!(await _enSendPilotMsg(text,'orange'))){
    const again=document.getElementById('en-pmsg-free');
    if(again&&!again.value)again.value=text;
  }
}
```

- [ ] **Step 2: Load the scripts** — en `src/index.html`, justo después de `<script src="en-messages.js"></script>`:

```html
  <script src="en-pilot-link-core.js"></script>
  <script src="en-pilot-link.js"></script>
```

- [ ] **Step 3: Botón RADIO en Mi equipo** — en `src/en-team.js`, `_enRenderTeam`, tarjeta «Piloto en pista»: cambiar

```js
      <button class="en-change-btn" style="background:#F5A623;color:#fff" onclick="_enChangePilot()">🔄 Cambio</button>
```

por

```js
      <span style="display:flex;gap:6px">${_enRadioBtnHtml()}<button class="en-change-btn" style="background:#F5A623;color:#fff" onclick="_enChangePilot()">🔄 Cambio</button></span>
```

(El botón RADIO va junto al del cambio de piloto: es la tarjeta del piloto al que se le habla.)

- [ ] **Step 4: Estilos** — en `src/styles.css`, tras la regla `.en-msg-btn.mine { … }`:

```css
/* Radio al piloto en pista (en-pilot-link.js) */
.en-radio-btn { background:color-mix(in srgb, #f97316 13%, transparent); color:#f97316; border:1px solid #f97316; font-weight:700; letter-spacing:0.5px; }
.en-radio-btn:disabled { opacity:0.35; cursor:not-allowed; }
.en-pmsg { border-radius:12px; padding:20px; width:min(560px, 92vw); font-family:sans-serif; }
.en-pmsg-title { font-size:14.5px; font-weight:500; color:var(--text-1); margin-bottom:6px; }
.en-pmsg-head { font-size:12.5px; color:var(--text-2); margin-bottom:14px; }
.en-pmsg-head b { color:var(--text-1); }
.en-pmsg-on { color:var(--state-ok, #22c55e); }
.en-pmsg-off, .en-pmsg-warn { color:var(--state-warn); }
.en-pmsg-grid { display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; margin-bottom:12px; }
.en-pmsg-q { padding:10px 4px; border-radius:6px; font-size:12px; font-weight:700; letter-spacing:0.3px;
             cursor:pointer; background:transparent; font-family:inherit; }
.en-pmsg-q.red    { color:#ef4444; border:1px solid #ef4444; }
.en-pmsg-q.orange { color:#f97316; border:1px solid #f97316; }
.en-pmsg-q.blue   { color:#fff; background:#2563eb; border:1px solid #2563eb; }
.en-pmsg-q:disabled, .en-pmsg-send:disabled { opacity:0.35; cursor:not-allowed; }
.en-pmsg-free { display:flex; gap:6px; margin-bottom:10px; }
.en-pmsg-free input { flex:1; background:#0e0f11; border:0.5px solid #2a2b2e; color:var(--text-1);
                      padding:8px; border-radius:6px; font-size:12.5px; }
.en-pmsg-send, .en-pmsg-close { padding:8px 14px; border-radius:6px; font-size:12px; cursor:pointer; font-family:inherit; }
.en-pmsg-send { border:0.5px solid #f97316; background:color-mix(in srgb, #f97316 13%, transparent); color:#f97316; }
.en-pmsg-close { width:100%; border:0.5px solid #2a2b2e; background:transparent; color:var(--text-3); }
.en-pmsg-status { min-height:18px; font-size:12px; margin-bottom:10px; }
.en-pmsg-status.ok { color:var(--state-ok, #22c55e); }
.en-pmsg-status.ko { color:var(--state-alert); }
```

- [ ] **Step 5: Verify**

Run (desde la raíz de karting-v10):

```bash
node -e "const fs=require('fs');for(const f of ['src/en-pilot-link.js','src/en-pilot-link-core.js','src/en-team.js']){try{new Function(fs.readFileSync(f,'utf8'));console.log('OK',f)}catch(e){console.log('ERROR',f,e.message)}}"
for f in tests/*.test.js; do node "$f" >/dev/null 2>&1 || echo "FALLA $f"; done
```

Expected: tres `OK` y ninguna línea `FALLA` (si `dead-css`, `panel-tokens`, `contrast` o `glass` fallan por las clases/colores nuevos, ajustar el CSS a lo que pidan esos tests — p.ej. usar tokens `var(--…)` en vez de hex si `panel-tokens` lo exige — y volver a ejecutar).

La prueba en navegador de esta UI es la Task 8 (necesita el logger desplegado).

- [ ] **Step 6: Commit**

```bash
git add src/en-pilot-link.js src/index.html src/en-team.js src/styles.css
git commit -m "panel: botón 📻 RADIO en Mi equipo y modal de mensajes al piloto en pista

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: App — modelo, aviso con cierre a 10 s y selector de piloto

Repo: `/Users/javiercoy/stintpro_pilot`. Flutter en `$HOME/Flutter/flutter/bin`.

**Files:**
- Create: `lib/team_link.dart`
- Create: `lib/pilot_picker.dart`
- Delete: `test/widget_test.dart`
- Test: `test/team_link_test.dart`, `test/pilot_picker_test.dart`

**Interfaces:**
- Produces:
  - `enum MsgTone { red, orange, blue }`; `MsgTone toneFrom(dynamic v)`
  - `class TeamRoster { final List<String> pilotos; final int? current; static TeamRoster? fromJson(Map<String, dynamic> m); bool isOnTrack(int? me); String? nameOf(int? i); }`
  - `String pilotPrefKey(String slug, String dorsal)`
  - `int? validPilotIndex(int? saved, TeamRoster? roster)`
  - `class TeamMessageController extends ChangeNotifier { static const visibleFor = Duration(seconds: 10); String? text; MsgTone tone; void show(String text, MsgTone tone); void hide(); }`
  - `class PilotPicker extends StatelessWidget { PilotPicker({required List<String> pilotos, required int? selected, required ValueChanged<int> onSelect}) }`

- [ ] **Step 1: Add dev dependency**

```bash
cd /Users/javiercoy/stintpro_pilot && export PATH="$HOME/Flutter/flutter/bin:$PATH" && flutter pub add --dev fake_async
git rm test/widget_test.dart
```

- [ ] **Step 2: Write the failing tests**

`test/team_link_test.dart`:

```dart
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stintpro_pilot/team_link.dart';

void main() {
  group('TeamRoster', () {
    test('lee lista y piloto en pista', () {
      final r = TeamRoster.fromJson({'pilotos': ['Javier', 'Pablo'], 'current': 1})!;
      expect(r.pilotos, ['Javier', 'Pablo']);
      expect(r.current, 1);
      expect(r.isOnTrack(1), isTrue);
      expect(r.isOnTrack(0), isFalse);
      expect(r.isOnTrack(null), isFalse);
      expect(r.nameOf(0), 'Javier');
      expect(r.nameOf(5), isNull);
    });
    test('pilotos null → sin lista; current fuera de rango → null', () {
      expect(TeamRoster.fromJson({'pilotos': null}), isNull);
      expect(TeamRoster.fromJson({'pilotos': ['A'], 'current': 3})!.current, isNull);
    });
  });

  test('toneFrom', () {
    expect(toneFrom('red'), MsgTone.red);
    expect(toneFrom('blue'), MsgTone.blue);
    expect(toneFrom(null), MsgTone.orange);
    expect(toneFrom('verde'), MsgTone.orange);
  });

  test('validPilotIndex descarta índices fuera de la lista', () {
    final r = TeamRoster.fromJson({'pilotos': ['A', 'B'], 'current': 0});
    expect(validPilotIndex(1, r), 1);
    expect(validPilotIndex(2, r), isNull);
    expect(validPilotIndex(null, r), isNull);
    expect(validPilotIndex(4, null), 4); // sin lista no se puede comprobar: se conserva
  });

  test('pilotPrefKey', () {
    expect(pilotPrefKey('campillos', '17'), 'pilot_campillos_17');
  });

  group('TeamMessageController', () {
    test('se cierra solo a los 10 s', () {
      fakeAsync((async) {
        final c = TeamMessageController();
        c.show('box', MsgTone.red);
        expect(c.text, 'BOX');
        expect(c.tone, MsgTone.red);
        async.elapse(const Duration(seconds: 9));
        expect(c.text, 'BOX');
        async.elapse(const Duration(seconds: 1));
        expect(c.text, isNull);
      });
    });
    test('uno nuevo sustituye al visible y reinicia los 10 s', () {
      fakeAsync((async) {
        final c = TeamMessageController();
        c.show('push', MsgTone.orange);
        async.elapse(const Duration(seconds: 8));
        c.show('bandera azul', MsgTone.blue);
        async.elapse(const Duration(seconds: 8));
        expect(c.text, 'BANDERA AZUL');
        expect(c.tone, MsgTone.blue);
        async.elapse(const Duration(seconds: 2));
        expect(c.text, isNull);
      });
    });
  });
}
```

`test/pilot_picker_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stintpro_pilot/pilot_picker.dart';

void main() {
  testWidgets('tocar un nombre devuelve su índice y marca el elegido', (tester) async {
    int? picked;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: PilotPicker(pilotos: const ['Javier', 'Pablo'], selected: 0, onSelect: (i) => picked = i),
      ),
    ));
    expect(find.text('Javier'), findsOneWidget);
    expect(find.byIcon(Icons.check), findsOneWidget); // el seleccionado
    await tester.tap(find.text('Pablo'));
    expect(picked, 1);
  });
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/javiercoy/stintpro_pilot && flutter test`
Expected: FAIL — no existen `team_link.dart` ni `pilot_picker.dart`.

- [ ] **Step 4: Implement**

`lib/team_link.dart`:

```dart
import 'dart:async';
import 'package:flutter/foundation.dart';

// Mensajes del panel al piloto en pista. El panel publica la lista de pilotos
// del equipo y cuál va en pista; el móvil se identifica por su índice en ella
// y solo recibe los mensajes cuando es el piloto en pista.

enum MsgTone { red, orange, blue }

MsgTone toneFrom(dynamic v) => switch (v) {
      'red' => MsgTone.red,
      'blue' => MsgTone.blue,
      _ => MsgTone.orange,
    };

class TeamRoster {
  final List<String> pilotos;
  final int? current;
  const TeamRoster(this.pilotos, this.current);

  static TeamRoster? fromJson(Map<String, dynamic> m) {
    final p = m['pilotos'];
    if (p is! List || p.isEmpty) return null;
    final pilotos = p.map((e) => e.toString()).toList();
    final c = m['current'];
    return TeamRoster(pilotos, c is int && c >= 0 && c < pilotos.length ? c : null);
  }

  bool isOnTrack(int? me) => me != null && current == me;
  String? nameOf(int? i) => i != null && i >= 0 && i < pilotos.length ? pilotos[i] : null;
}

String pilotPrefKey(String slug, String dorsal) => 'pilot_${slug}_$dorsal';

// Índice guardado en el móvil, comprobado contra la lista actual. Sin lista
// (el panel aún no la ha publicado) no se puede comprobar y se conserva.
int? validPilotIndex(int? saved, TeamRoster? roster) {
  if (roster == null) return saved;
  return saved != null && saved >= 0 && saved < roster.pilotos.length ? saved : null;
}

// Aviso a pantalla completa: se cierra solo a los 10 s (el piloto lleva las
// manos en el volante); uno nuevo sustituye al visible y reinicia la cuenta.
class TeamMessageController extends ChangeNotifier {
  static const visibleFor = Duration(seconds: 10);
  String? text;
  MsgTone tone = MsgTone.orange;
  Timer? _timer;

  void show(String t, MsgTone tn) {
    text = t.toUpperCase();
    tone = tn;
    _timer?.cancel();
    _timer = Timer(visibleFor, hide);
    notifyListeners();
  }

  void hide() {
    _timer?.cancel();
    _timer = null;
    if (text == null) return;
    text = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
```

`lib/pilot_picker.dart`:

```dart
import 'package:flutter/material.dart';

// «¿Quién eres?»: los pilotos de la lista que publica el panel del equipo.
class PilotPicker extends StatelessWidget {
  final List<String> pilotos;
  final int? selected;
  final ValueChanged<int> onSelect;

  const PilotPicker({super.key, required this.pilotos, required this.selected, required this.onSelect});

  static const _green = Color(0xFF44CC88);
  static const _bgCell = Color(0xFF141414);
  static const _border = Color(0xFF222222);

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (var i = 0; i < pilotos.length; i++)
          GestureDetector(
            onTap: () => onSelect(i),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: i == selected ? _green.withValues(alpha: 0.15) : _bgCell,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: i == selected ? _green : _border, width: i == selected ? 1.5 : 0.5),
              ),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                if (i == selected) ...[
                  const Icon(Icons.check, size: 14, color: _green),
                  const SizedBox(width: 6),
                ],
                Text(pilotos[i],
                    style: TextStyle(fontSize: 14, color: i == selected ? _green : Colors.white)),
              ]),
            ),
          ),
      ],
    );
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `flutter test && flutter analyze`
Expected: todos los tests PASS; `No issues found!`.

- [ ] **Step 6: Commit**

```bash
git add lib/team_link.dart lib/pilot_picker.dart test/ pubspec.yaml pubspec.lock
git commit -m "Modelo de mensajes al piloto: lista, tono, aviso de 10 s y selector

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: App — integrar «¿Quién eres?», suscripción por piloto y aviso por tono

Repo: `/Users/javiercoy/stintpro_pilot`.

**Files:**
- Create: `lib/vps.dart`
- Modify: `lib/main.dart`

**Interfaces:**
- Consumes: Task 6 (`TeamRoster`, `MsgTone`, `toneFrom`, `pilotPrefKey`, `validPilotIndex`, `TeamMessageController`, `PilotPicker`); `AuthService.instance.idToken()` (existente); protocolo WS de Task 2.
- Produces: `Uri vpsUri()`; `Future<RosterResult> fetchRoster(String slug, String dorsal)`; `PilotScreen({required slug, required dorsal, int? pilot})`.

- [ ] **Step 1: `lib/vps.dart`** (mueve el host del VPS fuera de `main.dart` y añade la consulta de la lista):

```dart
import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'auth_service.dart';
import 'team_link.dart';

// Para probar contra el replay local (replay-vps.js):
//   --dart-define=VPS_HOST=10.0.2.2 --dart-define=VPS_PORT=3001  (emulador)
const vpsHost = String.fromEnvironment('VPS_HOST', defaultValue: 'stintpro.duckdns.org');
const vpsPort = int.fromEnvironment('VPS_PORT', defaultValue: 443);

Uri vpsUri() => Uri.parse(vpsPort == 443 ? 'wss://$vpsHost' : 'ws://$vpsHost:$vpsPort');

enum RosterStatus { ok, none, noSession, error }

class RosterResult {
  final RosterStatus status;
  final TeamRoster? roster;
  const RosterResult(this.status, [this.roster]);
}

// Conexión de un solo uso para la pantalla de configuración: auth → roster_get.
Future<RosterResult> fetchRoster(String slug, String dorsal) async {
  final String? token;
  try {
    token = await AuthService.instance.idToken();
  } on AuthException {
    return const RosterResult(RosterStatus.error);
  }
  if (token == null) return const RosterResult(RosterStatus.noSession);
  final ch = WebSocketChannel.connect(vpsUri());
  try {
    ch.sink.add(jsonEncode({'type': 'auth', 'token': token}));
    await for (final raw in ch.stream.timeout(const Duration(seconds: 8))) {
      final m = jsonDecode(raw as String) as Map<String, dynamic>;
      if (m['type'] == 'auth_ok') {
        ch.sink.add(jsonEncode({'type': 'roster_get', 'slug': slug, 'dorsal': dorsal}));
      } else if (m['type'] == 'team_roster') {
        final r = TeamRoster.fromJson(m);
        return RosterResult(r == null ? RosterStatus.none : RosterStatus.ok, r);
      } else if (m['type'] == 'error') {
        return const RosterResult(RosterStatus.error);
      }
    }
    return const RosterResult(RosterStatus.error);
  } catch (_) {
    return const RosterResult(RosterStatus.error);
  } finally {
    ch.sink.close();
  }
}
```

- [ ] **Step 2: `main.dart` — imports y host**
  - Añadir `import 'pilot_picker.dart';`, `import 'team_link.dart';`, `import 'vps.dart';`.
  - Borrar el bloque de comentario + `const _vpsHost …` + `const _vpsPort …`.
  - En `_connectVps` cambiar `final uri = Uri.parse(_vpsPort == 443 ? 'wss://$_vpsHost' : 'ws://$_vpsHost:$_vpsPort');` por `final uri = vpsUri();`.

- [ ] **Step 3: `main.dart` — Setup «¿Quién eres?»** en `_SetupScreenState`:

Campos nuevos junto a `_hasFinishLine`:

```dart
  RosterResult? _roster;
  bool _loadingRoster = false;
  int? _pilot;
  Timer? _rosterDebounce;
```

Métodos nuevos (antes de `_start`):

```dart
  // La lista depende de circuito + dorsal: se pide al cambiar cualquiera.
  void _scheduleRoster() {
    _rosterDebounce?.cancel();
    _rosterDebounce = Timer(const Duration(milliseconds: 600), _loadRoster);
  }

  Future<void> _loadRoster() async {
    final slug = _selectedSlug, dorsal = _dorsalController.text.trim();
    if (slug == null || dorsal.isEmpty) return;
    setState(() => _loadingRoster = true);
    final res = await fetchRoster(slug, dorsal);
    final prefs = await SharedPreferences.getInstance();
    if (!mounted || slug != _selectedSlug || dorsal != _dorsalController.text.trim()) return;
    final saved = prefs.getInt(pilotPrefKey(slug, dorsal));
    setState(() {
      _roster = res;
      _loadingRoster = false;
      _pilot = validPilotIndex(saved, res.roster);
    });
  }

  Future<void> _pickPilot(int i) async {
    final slug = _selectedSlug, dorsal = _dorsalController.text.trim();
    if (slug == null || dorsal.isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(pilotPrefKey(slug, dorsal), i);
    setState(() => _pilot = i);
  }

  Widget _whoAmI() {
    if (_loadingRoster) {
      return const Text('Buscando pilotos del equipo…', style: TextStyle(fontSize: 11, color: _muted));
    }
    final r = _roster;
    if (r == null) return const SizedBox.shrink();
    switch (r.status) {
      case RosterStatus.ok:
        return PilotPicker(pilotos: r.roster!.pilotos, selected: _pilot, onSelect: _pickPilot);
      case RosterStatus.none:
        return const Text('El panel del equipo no ha publicado los pilotos todavía',
            style: TextStyle(fontSize: 11, color: _orange));
      case RosterStatus.noSession:
      case RosterStatus.error:
        return const Text('No se pudo consultar la lista de pilotos',
            style: TextStyle(fontSize: 11, color: _orange));
    }
  }

  @override
  void dispose() {
    _rosterDebounce?.cancel();
    _dorsalController.dispose();
    super.dispose();
  }
```

Llamadas a `_scheduleRoster()`:
- al final de `_loadSaved()` (tras `_checkFinishLine`): `_scheduleRoster();`
- en el `onChanged` del Dropdown, junto a `_checkFinishLine(v)`: `_scheduleRoster();`
- en el `onChanged` del TextField del dorsal: `onChanged: (_) { setState(() {}); _scheduleRoster(); },`
- en los `onTap` de `−` y `+`, tras el `setState`: `_scheduleRoster();`

En `build`, entre el bloque del dorsal y `const SizedBox(height: 32),` del botón ENTRAR:

```dart
              const SizedBox(height: 20),
              const Text('¿QUIÉN ERES?', style: TextStyle(fontSize: 10, color: Color(0xFF555555), letterSpacing: 1)),
              const SizedBox(height: 8),
              _whoAmI(),
```

En `_start`, pasar el piloto: `builder: (_) => PilotScreen(slug: slug, dorsal: dorsal, pilot: _pilot),`.

Envolver el `Column` del `build` del setup en `SingleChildScrollView` (la sección nueva no cabe en horizontal en móviles pequeños).

- [ ] **Step 4: `main.dart` — PilotScreen**

Constructor y campos:

```dart
class PilotScreen extends StatefulWidget {
  final String slug;
  final String dorsal;
  final int? pilot;
  const PilotScreen({super.key, required this.slug, required this.dorsal, this.pilot});
```

En `_PilotScreenState`, sustituir `bool _showMessage = false;` y `String _teamMessage = '';` por:

```dart
  final _msg = TeamMessageController();
  TeamRoster? _roster;
  int? _pilot;
```

En `initState`, antes de `_connectVps();`: `_pilot = widget.pilot;`. En `dispose`: `_msg.dispose();`.

En `_onVpsMessage`:
- en `case 'auth_ok':` el `pilot` pasa a ser `_subscribePilot();` y se añade el método:

```dart
  void _subscribePilot() {
    _channel?.sink.add(jsonEncode({
      'type': 'pilot',
      'slug': widget.slug,
      'dorsal': widget.dorsal,
      if (_pilot != null) 'pilot': _pilot,
    }));
  }
```

- sustituir `case 'team_msg':` por:

```dart
        case 'team_msg':
          final text = (msg['text'] ?? '').toString();
          if (text.isNotEmpty) _msg.show(text, toneFrom(msg['tone']));
          break;
        case 'team_roster':
          final r = TeamRoster.fromJson(msg);
          setState(() {
            _roster = r;
            final valid = validPilotIndex(_pilot, r);
            if (valid != _pilot) {
              _pilot = valid;
              SharedPreferences.getInstance().then(
                  (p) => p.remove(pilotPrefKey(widget.slug, widget.dorsal)));
            }
          });
          break;
```

Selector desde la pantalla del piloto:

```dart
  Future<void> _choosePilot() async {
    final r = _roster;
    if (r == null) return;
    final picked = await showModalBottomSheet<int>(
      context: context,
      backgroundColor: const Color(0xFF111111),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('¿QUIÉN ERES?', style: TextStyle(fontSize: 10, color: _muted, letterSpacing: 1)),
          const SizedBox(height: 12),
          PilotPicker(pilotos: r.pilotos, selected: _pilot, onSelect: (i) => Navigator.of(ctx).pop(i)),
        ]),
      ),
    );
    if (picked == null) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(pilotPrefKey(widget.slug, widget.dorsal), picked);
    setState(() => _pilot = picked);
    _subscribePilot();
  }
```

En `_topBar`, en la fila izquierda, envolver nombre de circuito y dorsal en un `GestureDetector(onTap: _choosePilot, child: Row(...))` y añadir tras el dorsal:

```dart
          const SizedBox(width: 8),
          Text(_roster?.nameOf(_pilot) ?? (_roster != null ? '· ¿quién eres?' : ''),
              style: TextStyle(fontSize: 11, color: _pilot == null && _roster != null ? _orange : _muted)),
```

y en la fila derecha, antes del punto de BLE:

```dart
          if (_roster?.isOnTrack(_pilot) ?? false) ...[
            const Text('📢 TÚ EN PISTA',
                style: TextStyle(fontSize: 10, color: _orange, fontWeight: FontWeight.w600, letterSpacing: 0.5)),
            const SizedBox(width: 10),
          ],
```

Aviso: en `build`, sustituir `if (_showMessage) _messageOverlay(),` por:

```dart
          AnimatedBuilder(
            animation: _msg,
            builder: (_, __) => _msg.text == null ? const SizedBox.shrink() : _messageOverlay(),
          ),
```

y sustituir `_messageOverlay()` entero por:

```dart
  // Sin toque: se cierra solo a los 10 s (TeamMessageController).
  Widget _messageOverlay() {
    final (Color fg, Color bg, Color label) = switch (_msg.tone) {
      MsgTone.red => (_red, const Color(0xFF1A0000), const Color(0xFF662222)),
      MsgTone.blue => (const Color(0xFF4D8DFF), const Color(0xFF000A1F), const Color(0xFF223A66)),
      MsgTone.orange => (_orange, const Color(0xFF1A0800), const Color(0xFF664400)),
    };
    return IgnorePointer(
      child: Container(
        color: Colors.black.withValues(alpha: 0.75),
        child: Center(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 24),
            decoration: BoxDecoration(
              color: bg,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: fg, width: 2),
            ),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text('MENSAJE DEL EQUIPO', style: TextStyle(fontSize: 11, color: label, letterSpacing: 1.5)),
              const SizedBox(height: 10),
              Text(_msg.text!, textAlign: TextAlign.center, style: _mono.copyWith(fontSize: 34, color: fg)),
            ]),
          ),
        ),
      ),
    );
  }
```

- [ ] **Step 5: Verify**

```bash
cd /Users/javiercoy/stintpro_pilot && export PATH="$HOME/Flutter/flutter/bin:$PATH"
grep -n "_showMessage\|_teamMessage\|_vpsHost\|_vpsPort" lib/main.dart   # debe salir vacío
flutter analyze && flutter test && flutter build apk --debug
```

Expected: grep vacío, `No issues found!`, tests PASS, APK construido.

- [ ] **Step 6: Commit**

```bash
git add lib/vps.dart lib/main.dart
git commit -m "¿Quién eres?, suscripción por piloto, «tú en pista» y aviso por tono de 10 s

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Prueba de extremo a extremo y despliegue (con permiso)

**Files:** ninguno nuevo (solo verificación); actualizar la memoria del proyecto al terminar.

- [ ] **Step 1: E2E contra el replay local** (sin desplegar nada)

```bash
cd "/Users/javiercoy/Documentos Locales/KARTING STRATEGY/karting-v10/stintpro-logger"
node replay-vps.js "/Users/javiercoy/Downloads/karting-lossantos_2026-06-27T18-32-03.ndjson" karting-lossantos --speed 5   # en segundo plano
```

1. Panel simulado + móvil de box simulado (node), dejando la conexión abierta: publicar `team_roster` de `karting-lossantos`/`17` con `['Javier','Pablo']`, `current: 0`; un cliente `pilot` con `pilot: 1` (Pablo, en el box).
2. App en el emulador compilada contra el replay (`flutter build apk --debug --dart-define=VPS_HOST=10.0.2.2 --dart-define=VPS_PORT=3001`, `adb install -r …`). En setup: Karting Club Los Santos, dorsal 17 → aparece «¿QUIÉN ERES?» con Javier y Pablo → elegir Javier → ENTRAR.
3. Comprobar con captura: «📢 TÚ EN PISTA» visible.
4. Desde el panel simulado mandar `BOX` (`red`, `pilot: 0`): captura con el aviso rojo; el cliente de Pablo no recibe nada; acuse `delivered: 1`; a los 10 s otra captura sin aviso.
5. Mandar `BANDERA AZUL` (`blue`): aviso azul.
6. Publicar `current: 1`: desaparece «📢 TÚ EN PISTA»; mandar `BOX` con `pilot: 1` → solo le llega al cliente de Pablo.
7. Parar el replay y reinstalar la APK de producción (`flutter build apk --debug` sin defines).

- [ ] **Step 2: STOP — pedir permiso para desplegar el logger al VPS.** Antes: comprobar que no hay ninguna carrera en vivo (`curl -s https://stintpro.duckdns.org/api/status` → todos `sessionActive: false`) y mirar los raw logs vivos. Solo con un «sí» explícito: scp de `server.js`, `circuit-monitor.js`, `team-link.js` y `replay-vps.js` + `systemctl restart` + md5 de los ficheros en el VPS (comandos en la memoria `project_stintpro_vps.md`).

- [ ] **Step 3: Panel en navegador contra el VPS ya desplegado.** Servir `src/` en `localhost` (Firebase admite `localhost` como dominio autorizado), iniciar sesión, abrir el panel en un circuito con dorsal y pilotos configurados y con la app del emulador (versión de producción) como piloto en pista. Comprobar: botón 📻 RADIO activo en Mi equipo; modal con «Para: … · 📱 conectado»; BOX → «Entregado a …» y aviso en el emulador; cambiar el piloto en pista en el panel → la cabecera cambia y la app pierde «📢 TÚ EN PISTA» en ≤ 2 s; móvil cerrado → «No entregado: … no tiene el móvil conectado».

- [ ] **Step 4: STOP — pedir permiso para el push a `main` (Vercel).** Solo con un «sí» explícito.

- [ ] **Step 5: Memoria.** Actualizar `project_stintpro_pilot.md` (estado de mensajes al piloto: implementado / desplegado / qué falta) y su línea en `MEMORY.md`.
