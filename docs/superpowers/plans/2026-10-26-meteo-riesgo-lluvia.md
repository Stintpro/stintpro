# Riesgo de lluvia en el panel (Open-Meteo) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mostrar en el KPI «Media pista» del panel endurance una línea de riesgo de lluvia (previsión Open-Meteo + confirmación por subida de tiempos), solo cuando hay algo que decir.

**Architecture:** coordenadas por slug en `src/circuits.js`; un módulo dual navegador/CommonJS `src/en-weather.js` con el cálculo puro (`rainRisk`, `rainByLapTimes`, `lineFor`) y una instancia con estado que sondea Open-Meteo cada 10 min solo en directo (`createWeather` → `window.EnWeather`); `en-grid.js` llama a `EnWeather.tick()` en cada render y pinta `EnWeather.kpiLineHtml()`; `en-ai-alerts.js` reutiliza `rainByLapTimes`.

**Tech Stack:** JavaScript de navegador sin build (scripts en `src/index.html`), tests en Node con `assert` (`node tests/<x>.test.js`), Vercel para la web.

**Spec:** `docs/superpowers/specs/2026-10-26-meteo-riesgo-lluvia-design.md`

## Global Constraints

- Fuente única: `https://api.open-meteo.com/v1/forecast`, sin clave. Solo se envían las coordenadas del circuito.
- Umbrales: `MM_RAIN_NOW = 0.1` mm, `MM_RISK = 0.2` mm, `PROB_HIGH = 60` %, `PROB_MED = 30` %.
- Sondeo cada **10 min**, timeout **10 s**, datos viejos a los **30 min**; **solo en directo** (`window.ApexConnector !== window.ReplayConnector`).
- Confirmación por tiempos: media de pista > **1,5 s** por encima de una muestra de hace **9-15 min**.
- Textos exactos de la línea: `🌦 Riesgo medio · 30-60 min`, `🌧 Riesgo alto · ~N min` (sin ETA: `🌧 Riesgo alto · próx. 30 min`), `🌧 Lloviendo`, `🌧 Lloviendo · tiempos +1,8 s`, `meteo sin datos`.
- Sin sonido. Todos los circuitos son al aire libre (no hay marca de cubierto).
- Tiempos de vuelta en la UI siempre `m:ss.sss`; aquí solo se muestran deltas en segundos con coma decimal.
- **No subir nada (`git push`) sin permiso explícito del usuario.** Los commits son locales.

## Mapa de ficheros

| Fichero | Qué hace |
|---|---|
| `src/circuits.js` (modificar) | tabla `CircuitDB.coords` + `CircuitDB.coordsOf(slug)` |
| `tests/circuit-coords.test.js` (crear) | tests de `coordsOf` |
| `tools/track-from-gps.js` (modificar) | `lapCenter()` exportada + imprime el centro de la vuelta |
| `tests/track-from-gps.test.js` (modificar) | test de `lapCenter` |
| `src/en-weather.js` (crear) | cálculo puro + instancia con sondeo y pintado de la línea |
| `tests/weather.test.js` (crear) | tests del cálculo, de la línea y de la instancia (fetch falso) |
| `src/en-ai-alerts.js` (modificar) | la alerta de lluvia usa `EnWeatherCore.rainByLapTimes` |
| `src/en-grid.js` (modificar) | `EnWeather.tick()` en `_enRender` + línea en el KPI Media pista |
| `src/index.html` (modificar) | `<script src="en-weather.js">` |
| `vercel.json` (modificar) | `https://api.open-meteo.com` en `connect-src` |

---

### Task 1: Coordenadas por circuito

**Files:**
- Modify: `src/circuits.js` (después del bloque `trackAliases`/`trackSlug`, línea ~127)
- Create: `tests/circuit-coords.test.js`

**Interfaces:**
- Produces: `window.CircuitDB.coords` (objeto `slug → [lat, lon]`) y `window.CircuitDB.coordsOf(slug) → [lat, lon] | null`.

Coordenadas (confirmar con el usuario antes del commit; las 3 marcadas «GPS» salen del centro de la vuelta de su CSV, el resto de OpenStreetMap):

| slug | lat | lon | origen |
|---|---|---|---|
| ariza-racing-circuit | 40.06576 | -4.19387 | GPS (OSM da 40.06599, -4.19380) |
| cabanillas | 40.62894 | -3.24569 | OSM |
| campillos | 37.03822 | -4.91438 | OSM |
| henakart | 40.42828 | -3.44353 | GPS |
| karting-lossantos | 40.49458 | -3.25061 | GPS |
| rivas | 40.34716 | -3.53535 | OSM |
| sevilla | 37.55845 | -5.93243 | OSM (Alcalá del Río) |
| rkc | 49.10388 | 2.03663 | OSM (Cormeilles-en-Vexin) |
| rkc2 | 49.10388 | 2.03663 | mismo recinto que rkc |
| kartodromo-lucas-guerrero | 39.50822 | -0.74679 | OSM (Chiva) |
| circuitosona | 41.95034 | 2.28088 | OSM (Vic) |
| kip-palmela | 38.57828 | -8.82769 | OSM |
| lemans-karting2 | 47.94232 | 0.21241 | OSM (Karting des 24h) |
| cronosystem2 | — | — | hereda de `campillos` por `trackAliases` |

- [ ] **Step 1: Escribir el test que falla** — `tests/circuit-coords.test.js`:

```js
// StintPro — tests de las coordenadas por circuito (src/circuits.js).
// Ejecutar: node tests/circuit-coords.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert');

global.window = {};
global.localStorage = { getItem: () => null, setItem: () => {} };
require('../src/circuits.js');
const DB = global.window.CircuitDB;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

test('coordsOf devuelve [lat, lon] de un circuito con coordenadas', () => {
  deepStrictEqual(DB.coordsOf('henakart'), [40.42828, -3.44353]);
});

test('coordsOf hereda por trackAliases (cronosystem2 → campillos)', () => {
  deepStrictEqual(DB.coordsOf('cronosystem2'), DB.coordsOf('campillos'));
});

test('coordsOf devuelve null para un slug desconocido o vacío', () => {
  strictEqual(DB.coordsOf('no-existe'), null);
  strictEqual(DB.coordsOf(''), null);
  strictEqual(DB.coordsOf(undefined), null);
});

test('todos los circuitos del catálogo embebido tienen coordenadas válidas', () => {
  for (const c of DB.list) {
    const xy = DB.coordsOf(c.slug);
    ok(xy, 'sin coordenadas: ' + c.slug);
    ok(xy[0] > 27 && xy[0] < 50 && xy[1] > -16 && xy[1] < 3, 'fuera de rango: ' + c.slug);
  }
});

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
```

- [ ] **Step 2: Ejecutarlo y ver que falla**

Run: `node tests/circuit-coords.test.js`
Expected: FAIL con `DB.coordsOf is not a function`.

- [ ] **Step 3: Implementar** — en `src/circuits.js`, justo después de `window.CircuitDB.trackSlug = function(slug) {…};`:

```js
// Coordenadas [lat, lon] de cada circuito, para la meteo (en-weather.js). Van por
// slug, aparte de `list`, para que sobrevivan a loadFromSupabase(). Las de
// ariza/henakart/los santos son el centro de la vuelta GPS de su trazado; el resto,
// OpenStreetMap. Un canal itinerante (cronosystem2) hereda las de su pista por
// trackAliases.
window.CircuitDB.coords = {
  'ariza-racing-circuit':      [40.06576, -4.19387],
  'cabanillas':                [40.62894, -3.24569],
  'campillos':                 [37.03822, -4.91438],
  'henakart':                  [40.42828, -3.44353],
  'karting-lossantos':         [40.49458, -3.25061],
  'rivas':                     [40.34716, -3.53535],
  'sevilla':                   [37.55845, -5.93243],
  'rkc':                       [49.10388,  2.03663],
  'rkc2':                      [49.10388,  2.03663],
  'kartodromo-lucas-guerrero': [39.50822, -0.74679],
  'circuitosona':              [41.95034,  2.28088],
  'kip-palmela':               [38.57828, -8.82769],
  'lemans-karting2':           [47.94232,  0.21241],
};
window.CircuitDB.coordsOf = function(slug) {
  if (!slug) return null;
  return this.coords[slug] || this.coords[this.trackSlug(slug)] || null;
};
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `node tests/circuit-coords.test.js`
Expected: `4 OK, 0 fallos`.

- [ ] **Step 5: Commit**

```bash
git add src/circuits.js tests/circuit-coords.test.js
git commit -m "feat(meteo): coordenadas por circuito (CircuitDB.coordsOf)"
```

---

### Task 2: Centro de la vuelta en `track-from-gps.js`

**Files:**
- Modify: `tools/track-from-gps.js` (nueva función antes de `buildTrack`, `main()` y `module.exports`)
- Modify: `tests/track-from-gps.test.js` (añadir un test antes del resumen final)

**Interfaces:**
- Produces: `lapCenter(samples, lapInfo) → [lat, lon]` (5 decimales), exportada.

- [ ] **Step 1: Test que falla** — añadir en `tests/track-from-gps.test.js`, antes de `console.log(\`\n${passed} OK…`:

```js
test('lapCenter: media de lat/lon de la vuelta, redondeada a 5 decimales', () => {
  const samples = [
    { t: 0, lat: 99, lon: 99, lap: 0 },          // fuera de la vuelta
    { t: 1, lat: 40.000001, lon: -3.000001, lap: 1 },
    { t: 2, lat: 40.000003, lon: -3.000003, lap: 1 },
    { t: 3, lat: 40.000005, lon: -3.000005, lap: 2 },
    { t: 4, lat: 99, lon: 99, lap: 2 },          // fuera de la vuelta
  ];
  deepStrictEqual(G.lapCenter(samples, { start: 1, end: 3 }), [40, -3]);
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `node tests/track-from-gps.test.js`
Expected: el nuevo test falla con `G.lapCenter is not a function`.

- [ ] **Step 3: Implementar** — en `tools/track-from-gps.js`, antes de `function buildTrack`:

```js
// Centro geográfico [lat, lon] de una vuelta: para CircuitDB.coords (meteo).
function lapCenter(samples, lapInfo) {
  const seg = samples.slice(lapInfo.start, lapInfo.end + 1);
  const r5 = v => Math.round(v * 1e5) / 1e5;
  return [r5(seg.reduce((s, p) => s + p.lat, 0) / seg.length),
          r5(seg.reduce((s, p) => s + p.lon, 0) / seg.length)];
}
```

En `main()`, después del `console.log(\`✓ ${outFile}…\`)` existente:

```js
  const [clat, clon] = lapCenter(samples, pick);
  console.log(`  coordenadas para CircuitDB.coords: '${a.slug}': [${clat}, ${clon}],`);
```

Y el export:

```js
module.exports = { parseGpsCsv, splitLaps, buildTrack, previewSvg, fmtLap, lapCenter };
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `node tests/track-from-gps.test.js`
Expected: todos OK, 0 fallos.

- [ ] **Step 5: Commit**

```bash
git add tools/track-from-gps.js tests/track-from-gps.test.js
git commit -m "feat(track-from-gps): imprimir el centro de la vuelta para la meteo"
```

---

### Task 3: Cálculo puro del riesgo (`rainRisk`, `rainByLapTimes`, `lineFor`)

**Files:**
- Create: `src/en-weather.js` (esta tarea crea solo la parte pura; la Task 4 añade la instancia)
- Create: `tests/weather.test.js`

**Interfaces:**
- Produces (módulo `require('../src/en-weather')` / `window.EnWeatherCore`):
  - `buildUrl(lat, lon) → string`
  - `rainRisk(data, nowMs) → { level: 'raining'|'high'|'medium'|null, etaMin: number|null, slots: [{t, mm}], probNextHour: number|null }`
  - `rainByLapTimes(history, nowMs, trackAvgS) → { rising: boolean, deltaS: number|null, baselineAvg: number|null, baselineTs: number|null }` (`history = [{ts, avg}]`, segundos)
  - `lineFor({ risk, lap, stale }) → { text, color, kind } | null`
  - constantes `MM_RAIN_NOW, MM_RISK, PROB_HIGH, PROB_MED, SLOT_MS, POLL_MS, STALE_MS, TIMEOUT_MS`

`data` es la respuesta de Open-Meteo con `timeformat=unixtime`: `minutely_15.time[]` y `hourly.time[]` en **segundos**.

- [ ] **Step 1: Tests que fallan** — `tests/weather.test.js`:

```js
// StintPro — tests de la meteo (src/en-weather.js). Ejecutar: node tests/weather.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert');
const W = require('../src/en-weather');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 26, 10, 0);            // 10:00Z, inicio de un tramo
// Respuesta sintética: 13 tramos de 15 min desde T0 y 3 horas.
function resp(mm, prob) {
  return {
    minutely_15: { time: mm.map((_, i) => (T0 + i * 15 * MIN) / 1000), precipitation: mm },
    hourly: { time: prob.map((_, i) => (T0 + i * 60 * MIN) / 1000), precipitation_probability: prob },
  };
}
const DRY = new Array(13).fill(0);
const withMm = (i, v) => { const a = DRY.slice(); a[i] = v; return a; };

test('buildUrl pide minutely_15, probabilidad horaria y unixtime', () => {
  const u = W.buildUrl(40.1, -3.2);
  ok(u.startsWith('https://api.open-meteo.com/v1/forecast?latitude=40.1&longitude=-3.2'));
  for (const p of ['minutely_15=precipitation', 'hourly=precipitation_probability',
                   'forecast_minutely_15=12', 'past_minutely_15=1', 'forecast_hours=3', 'timeformat=unixtime'])
    ok(u.includes(p), 'falta ' + p);
});

test('seco → level null, sin ETA', () => {
  const r = W.rainRisk(resp(DRY, [5, 5, 5]), T0 + 5 * MIN);
  strictEqual(r.level, null); strictEqual(r.etaMin, null); strictEqual(r.probNextHour, 5);
});

test('lluvia de 0,3 mm a los 20 min → alto, ETA 20', () => {
  // ahora 10:10; el tramo 10:30 empieza en 20 min
  const r = W.rainRisk(resp(withMm(2, 0.3), [10, 10, 10]), T0 + 10 * MIN);
  strictEqual(r.level, 'high'); strictEqual(r.etaMin, 20);
});

test('lluvia de 0,3 mm a los 50 min → medio', () => {
  // ahora 10:10; el tramo 11:00 empieza en 50 min
  const r = W.rainRisk(resp(withMm(4, 0.3), [10, 10, 10]), T0 + 10 * MIN);
  strictEqual(r.level, 'medium'); strictEqual(r.etaMin, 50);
});

test('0,1 mm en el tramo actual → lloviendo', () => {
  const r = W.rainRisk(resp(withMm(0, 0.1), [10, 10, 10]), T0 + 5 * MIN);
  strictEqual(r.level, 'raining');
});

test('0,1 mm futuro no llega a riesgo (umbral 0,2) pero da ETA', () => {
  const r = W.rainRisk(resp(withMm(2, 0.1), [10, 10, 10]), T0 + 10 * MIN);
  strictEqual(r.level, null); strictEqual(r.etaMin, 20);
});

test('solo probabilidad: 60 % → alto sin ETA; 30 % → medio; 29 % → nada', () => {
  strictEqual(W.rainRisk(resp(DRY, [60, 0, 0]), T0 + 5 * MIN).level, 'high');
  strictEqual(W.rainRisk(resp(DRY, [60, 0, 0]), T0 + 5 * MIN).etaMin, null);
  strictEqual(W.rainRisk(resp(DRY, [30, 0, 0]), T0 + 5 * MIN).level, 'medium');
  strictEqual(W.rainRisk(resp(DRY, [29, 0, 0]), T0 + 5 * MIN).level, null);
});

test('la probabilidad es la de la hora que contiene "ahora"', () => {
  strictEqual(W.rainRisk(resp(DRY, [0, 70, 0]), T0 + 65 * MIN).probNextHour, 70);
});

test('ETA redondeada a 5 min y mínimo 5', () => {
  // ahora 10:13; tramo 10:15 empieza en 2 min → 5
  strictEqual(W.rainRisk(resp(withMm(1, 0.3), [0, 0, 0]), T0 + 13 * MIN).etaMin, 5);
  // ahora 10:02; tramo 10:30 empieza en 28 min → 30 (sigue siendo alto: 28 ≤ 30)
  const r = W.rainRisk(resp(withMm(2, 0.3), [0, 0, 0]), T0 + 2 * MIN);
  strictEqual(r.etaMin, 30); strictEqual(r.level, 'high');
});

test('datos vacíos o malformados → level null sin lanzar', () => {
  for (const bad of [null, undefined, {}, { minutely_15: {} }, { minutely_15: { time: 'x', precipitation: [] } }])
    strictEqual(W.rainRisk(bad, T0).level, null);
});

test('Ariza 2026-10-04 (previsión histórica real): medio a las 17:00, lloviendo a las 17:15', () => {
  // 15:00–18:45 hora local (UTC+2) → 13:00Z; horas 14:00–19:00 local → 12:00Z
  const s0 = Date.UTC(2026, 9, 4, 13, 0), h0 = Date.UTC(2026, 9, 4, 12, 0);
  const mm = [0.4, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.1, 0.1, 0.1, 0, 0, 0];
  const prob = [63, 58, 28, 35, 10, 15];
  const data = {
    minutely_15: { time: mm.map((_, i) => (s0 + i * 15 * MIN) / 1000), precipitation: mm },
    hourly: { time: prob.map((_, i) => (h0 + i * 60 * MIN) / 1000), precipitation_probability: prob },
  };
  const at = (h, m) => Date.UTC(2026, 9, 4, h - 2, m);
  strictEqual(W.rainRisk(data, at(16, 50)).level, null);       // prob 28 %, 0,1 mm < 0,2
  strictEqual(W.rainRisk(data, at(16, 50)).etaMin, 25);
  strictEqual(W.rainRisk(data, at(17, 0)).level, 'medium');    // prob 35 %
  strictEqual(W.rainRisk(data, at(17, 20)).level, 'raining');  // tramo 17:15 con 0,1 mm
});

test('rainByLapTimes: sin muestra de hace ≥ 9 min → no', () => {
  const now = T0 + 20 * MIN;
  deepStrictEqual(W.rainByLapTimes([{ ts: now - 5 * MIN, avg: 60 }], now, 70).rising, false);
});

test('rainByLapTimes: +1,2 s → no; +1,8 s → sí, con delta y muestra base', () => {
  const now = T0 + 20 * MIN, hist = [{ ts: now - 12 * MIN, avg: 66.0 }, { ts: now - 5 * MIN, avg: 66.5 }];
  strictEqual(W.rainByLapTimes(hist, now, 67.2).rising, false);
  const r = W.rainByLapTimes(hist, now, 67.8);
  strictEqual(r.rising, true);
  strictEqual(Math.round(r.deltaS * 10) / 10, 1.8);
  strictEqual(r.baselineAvg, 66.0); strictEqual(r.baselineTs, now - 12 * MIN);
});

test('rainByLapTimes: sin media actual → no', () => {
  strictEqual(W.rainByLapTimes([{ ts: T0, avg: 60 }], T0 + 10 * MIN, null).rising, false);
});

test('lineFor: textos y prioridades', () => {
  const none = { rising: false, deltaS: null };
  strictEqual(W.lineFor({ risk: null, lap: none, stale: false }), null);
  strictEqual(W.lineFor({ risk: { level: null }, lap: none, stale: false }), null);
  strictEqual(W.lineFor({ risk: { level: 'medium' }, lap: none }).text, '🌦 Riesgo medio · 30-60 min');
  strictEqual(W.lineFor({ risk: { level: 'high', etaMin: 20 }, lap: none }).text, '🌧 Riesgo alto · ~20 min');
  strictEqual(W.lineFor({ risk: { level: 'high', etaMin: null }, lap: none }).text, '🌧 Riesgo alto · próx. 30 min');
  strictEqual(W.lineFor({ risk: { level: 'raining' }, lap: none }).text, '🌧 Lloviendo');
  strictEqual(W.lineFor({ risk: null, lap: { rising: true, deltaS: 1.84 } }).text, '🌧 Lloviendo · tiempos +1,8 s');
  strictEqual(W.lineFor({ risk: { level: 'medium' }, lap: { rising: true, deltaS: 2 } }).kind, 'raining');
  strictEqual(W.lineFor({ risk: null, lap: none, stale: true }).text, 'meteo sin datos');
  strictEqual(W.lineFor({ risk: { level: 'high', etaMin: 10 }, lap: none, stale: true }).kind, 'high');
});

module.exports = { resp, T0, MIN, DRY, withMm };
if (require.main === module) {
  console.log(`\n${passed} OK, ${failed} fallos\n`);
  if (failed) process.exit(1);
}
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `node tests/weather.test.js`
Expected: FAIL con `Cannot find module '../src/en-weather'`.

- [ ] **Step 3: Implementar** — `src/en-weather.js`:

```js
// ── en-weather.js — riesgo de lluvia (Open-Meteo) para el KPI «Media pista» ──
// Apex no manda meteo (wth1-3 vacías), así que se pide a Open-Meteo por las
// coordenadas del circuito (CircuitDB.coordsOf). La lluvia de chubasco falla por
// km y por 30-60 min: se muestra como RIESGO en una ventana, nunca como minuto
// exacto, y se confirma con la subida de tiempos del pelotón (rainByLapTimes, la
// misma regla que la alerta de lluvia de en-ai-alerts.js).
// Parte pura (tests/weather.test.js) + instancia con estado (createWeather).
// Funciona en browser (window.EnWeatherCore / window.EnWeather) y Node.js.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EnWeatherCore = api; root.EnWeather = api.createWeather(); }
})(typeof window !== 'undefined' ? window : this, function () {
  const MM_RAIN_NOW = 0.1;   // mm en el tramo actual → "lloviendo"
  const MM_RISK = 0.2;       // mm en un tramo futuro → riesgo
  const PROB_HIGH = 60;      // % de la hora en curso → riesgo alto
  const PROB_MED = 30;       // % de la hora en curso → riesgo medio
  const SLOT_MS = 15 * 60 * 1000;
  const POLL_MS = 10 * 60 * 1000;
  const STALE_MS = 30 * 60 * 1000;
  const TIMEOUT_MS = 10 * 1000;
  const LAP_RISE_S = 1.5, LAP_BASE_MIN_MS = 9 * 60 * 1000, LAP_KEEP_MS = 15 * 60 * 1000;
  const API = 'https://api.open-meteo.com/v1/forecast';
  const COLOR = { rain: '#60a5fa', medium: '#fbbf24', stale: 'var(--text-3)' };

  function buildUrl(lat, lon) {
    return API + '?latitude=' + lat + '&longitude=' + lon +
      '&minutely_15=precipitation&hourly=precipitation_probability' +
      '&forecast_minutely_15=12&past_minutely_15=1&forecast_hours=3' +
      '&timeformat=unixtime&timezone=UTC';
  }

  function rainRisk(data, nowMs) {
    const out = { level: null, etaMin: null, slots: [], probNextHour: null };
    const m = data && data.minutely_15, h = data && data.hourly;
    if (!m || !Array.isArray(m.time) || !Array.isArray(m.precipitation)) return out;
    for (let i = 0; i < m.time.length; i++) {
      const t = m.time[i] * 1000, mm = m.precipitation[i];
      if (typeof mm !== 'number' || t + SLOT_MS <= nowMs || t > nowMs + 60 * 60 * 1000) continue;
      out.slots.push({ t, mm });
    }
    if (h && Array.isArray(h.time) && Array.isArray(h.precipitation_probability)) {
      for (let i = 0; i < h.time.length; i++) {
        const t = h.time[i] * 1000, p = h.precipitation_probability[i];
        if (t <= nowMs && nowMs < t + 60 * 60 * 1000 && typeof p === 'number') out.probNextHour = p;
      }
    }
    const cur = out.slots.find(s => s.t <= nowMs);
    const first = out.slots.find(s => s.t > nowMs && s.mm >= MM_RAIN_NOW);
    if (first) out.etaMin = Math.max(5, Math.round((first.t - nowMs) / 60000 / 5) * 5);
    const risky = (fromMin, toMin) => out.slots.some(s => {
      const dt = (s.t - nowMs) / 60000;
      return s.mm >= MM_RISK && dt > fromMin && dt <= toMin;
    });
    const p = out.probNextHour;
    if (cur && cur.mm >= MM_RAIN_NOW) out.level = 'raining';
    else if (risky(0, 30) || (p != null && p >= PROB_HIGH)) out.level = 'high';
    else if (risky(30, 60) || (p != null && p >= PROB_MED)) out.level = 'medium';
    return out;
  }

  // Subida colectiva de tiempos: media de pista actual > 1,5 s por encima de la
  // muestra más antigua que tenga ≥ 9 min (quien llama guarda solo 15 min).
  function rainByLapTimes(history, nowMs, trackAvgS) {
    const no = { rising: false, deltaS: null, baselineAvg: null, baselineTs: null };
    if (!trackAvgS || !Array.isArray(history)) return no;
    const base = history.find(s => nowMs - s.ts >= LAP_BASE_MIN_MS);
    if (!base) return no;
    const deltaS = trackAvgS - base.avg;
    return { rising: deltaS > LAP_RISE_S, deltaS, baselineAvg: base.avg, baselineTs: base.ts };
  }

  const fmtS = v => v.toFixed(1).replace('.', ',');

  // Línea del KPI. Prioridad: tiempos subiendo > previsión > sin datos.
  function lineFor(cur) {
    const lap = cur && cur.lap, r = cur && cur.risk;
    if (lap && lap.rising) return { text: '🌧 Lloviendo · tiempos +' + fmtS(lap.deltaS) + ' s', color: COLOR.rain, kind: 'raining' };
    if (r && r.level === 'raining') return { text: '🌧 Lloviendo', color: COLOR.rain, kind: 'raining' };
    if (r && r.level === 'high') return { text: '🌧 Riesgo alto · ' + (r.etaMin != null ? '~' + r.etaMin + ' min' : 'próx. 30 min'), color: COLOR.rain, kind: 'high' };
    if (r && r.level === 'medium') return { text: '🌦 Riesgo medio · 30-60 min', color: COLOR.medium, kind: 'medium' };
    if (cur && cur.stale) return { text: 'meteo sin datos', color: COLOR.stale, kind: 'stale' };
    return null;
  }

  function createWeather() { return null; }   // la implementa la Task 4

  return {
    buildUrl, rainRisk, rainByLapTimes, lineFor, createWeather,
    MM_RAIN_NOW, MM_RISK, PROB_HIGH, PROB_MED, SLOT_MS, POLL_MS, STALE_MS, TIMEOUT_MS,
  };
});
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `node tests/weather.test.js`
Expected: `15 OK, 0 fallos`.

- [ ] **Step 5: Commit**

```bash
git add src/en-weather.js tests/weather.test.js
git commit -m "feat(meteo): cálculo puro del riesgo de lluvia (en-weather.js)"
```

---

### Task 4: Instancia con sondeo y línea del KPI

**Files:**
- Modify: `src/en-weather.js` (sustituir el `createWeather` provisional)
- Create: `tests/weather-instance.test.js`

**Interfaces:**
- Consumes: `buildUrl`, `rainRisk`, `rainByLapTimes`, `lineFor`, constantes (Task 3); `window.CircuitDB.coordsOf` (Task 1).
- Produces: `createWeather(deps?) → { tick(slug, trackAvgS) → Promise|null, current() → { enabled, risk, lap, stale, fetchedAt, error }, kpiLineHtml() → string, _state }`. `deps` opcional: `{ fetch, now, isLive, coordsOf }`. `window.EnWeather` = instancia por defecto.

- [ ] **Step 1: Tests que fallan** — `tests/weather-instance.test.js`:

```js
// StintPro — tests de la instancia de meteo (sondeo, datos viejos, línea).
// Ejecutar: node tests/weather-instance.test.js
'use strict';

const { strictEqual, ok } = require('assert');
const W = require('../src/en-weather');
const { resp, T0, MIN, withMm } = require('./weather.test.js');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

function rig(over) {
  const s = { now: T0, live: true, calls: [], body: resp(withMm(2, 0.3), [10, 10, 10]), fail: false };
  const w = W.createWeather(Object.assign({
    now: () => s.now,
    isLive: () => s.live,
    coordsOf: slug => (slug === 'henakart' ? [40.4, -3.4] : null),
    fetch: url => { s.calls.push(url); return s.fail ? Promise.reject(new Error('red caída'))
      : Promise.resolve({ ok: true, json: () => Promise.resolve(s.body) }); },
  }, over || {}));
  return { s, w };
}

(async () => {
  await test('primer tick consulta Open-Meteo con las coordenadas', async () => {
    const { s, w } = rig();
    await w.tick('henakart', 66);
    strictEqual(s.calls.length, 1);
    ok(s.calls[0].includes('latitude=40.4&longitude=-3.4'));
    strictEqual(w.current().risk.level, 'high');
  });

  await test('no vuelve a consultar antes de 10 min; sí después', async () => {
    const { s, w } = rig();
    await w.tick('henakart', 66);
    s.now += 9 * MIN; strictEqual(w.tick('henakart', 66), null);
    s.now += 2 * MIN; await w.tick('henakart', 66);
    strictEqual(s.calls.length, 2);
  });

  await test('sin coordenadas o en repetición no consulta', async () => {
    const a = rig(); strictEqual(a.w.tick('sevilla-falso', 66), null); strictEqual(a.s.calls.length, 0);
    const b = rig(); b.s.live = false; strictEqual(b.w.tick('henakart', 66), null); strictEqual(b.s.calls.length, 0);
  });

  await test('sin datos buenos en 30 min → stale y "meteo sin datos"', async () => {
    const { s, w } = rig(); s.fail = true;
    await w.tick('henakart', 66);
    ok(w.current().error);
    strictEqual(w.current().stale, false);          // recién empezado
    s.now += 31 * MIN;
    strictEqual(w.current().stale, true);
    ok(w.kpiLineHtml().includes('meteo sin datos'));
  });

  await test('datos de hace > 30 min no cuentan como riesgo', async () => {
    const { s, w } = rig();
    await w.tick('henakart', 66);
    s.fail = true; s.now += 31 * MIN;
    strictEqual(w.current().risk, null);
  });

  await test('kpiLineHtml: vacío con seco; línea con title de Open-Meteo con riesgo', async () => {
    const dry = rig({}); dry.s.body = resp(new Array(13).fill(0), [0, 0, 0]);
    await dry.w.tick('henakart', 66);
    strictEqual(dry.w.kpiLineHtml(), '');
    const { w } = rig();
    await w.tick('henakart', 66);
    const html = w.kpiLineHtml();
    ok(html.includes('🌧 Riesgo alto · ~30 min'), html);
    ok(html.includes('Open-Meteo'));
  });

  await test('subida de tiempos funciona también sin previsión (repetición)', async () => {
    const { s, w } = rig(); s.live = false;
    w.tick('henakart', 66.0);
    s.now += 10 * MIN; w.tick('henakart', 67.9);
    ok(w.kpiLineHtml().includes('🌧 Lloviendo · tiempos +1,9 s'));
  });

  await test('cambiar de circuito reinicia el estado', async () => {
    const { s, w } = rig();
    await w.tick('henakart', 66);
    w.tick('otro', 66);
    strictEqual(w.current().risk, null);
    strictEqual(s.calls.length, 1);
  });

  console.log(`\n${passed} OK, ${failed} fallos\n`);
  if (failed) process.exit(1);
})();
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `node tests/weather-instance.test.js`
Expected: FAIL (`createWeather` devuelve `null` → `Cannot read properties of null (reading 'tick')`).

- [ ] **Step 3: Implementar** — en `src/en-weather.js`, sustituir `function createWeather() { return null; }   // la implementa la Task 4` por:

```js
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const hhmm = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

  // Instancia con estado: un circuito a la vez. tick() se llama en cada render del
  // panel (en-grid.js): guarda la media de pista y, si toca, lanza la consulta.
  // Como _enRender solo corre con el panel abierto, no hace falta start/stop.
  function createWeather(deps) {
    const d = Object.assign({
      fetch: typeof fetch === 'function' ? (u, o) => fetch(u, o) : null,
      now: () => Date.now(),
      isLive: () => typeof window !== 'undefined' && !!window.ApexConnector && window.ApexConnector !== window.ReplayConnector,
      coordsOf: slug => (typeof window !== 'undefined' && window.CircuitDB && window.CircuitDB.coordsOf) ? window.CircuitDB.coordsOf(slug) : null,
    }, deps || {});
    const st = { slug: null, since: 0, data: null, fetchedAt: 0, lastTryAt: 0, inFlight: false, error: null, avgHist: [] };

    function tick(slug, trackAvgS) {
      const now = d.now();
      if (slug !== st.slug) Object.assign(st, { slug, since: now, data: null, fetchedAt: 0, lastTryAt: 0, inFlight: false, error: null, avgHist: [] });
      if (trackAvgS) {
        st.avgHist.push({ ts: now, avg: trackAvgS });
        while (st.avgHist.length && now - st.avgHist[0].ts > LAP_KEEP_MS) st.avgHist.shift();
      }
      const c = d.coordsOf(slug);
      if (!c || !d.isLive() || !d.fetch || st.inFlight || (st.lastTryAt && now - st.lastTryAt < POLL_MS)) return null;
      st.inFlight = true; st.lastTryAt = now;
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
      return Promise.resolve()
        .then(() => d.fetch(buildUrl(c[0], c[1]), ctrl ? { signal: ctrl.signal } : undefined))
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(j => { if (slug === st.slug) { st.data = j; st.fetchedAt = d.now(); st.error = null; } })
        .catch(e => { if (slug === st.slug) st.error = (e && e.message) || String(e); })
        .then(() => { if (slug === st.slug) st.inFlight = false; if (timer) clearTimeout(timer); });
    }

    function current() {
      const now = d.now();
      const enabled = !!d.coordsOf(st.slug) && d.isLive();
      const fresh = !!st.data && now - st.fetchedAt <= STALE_MS;
      const lastAvg = st.avgHist.length ? st.avgHist[st.avgHist.length - 1].avg : null;
      return {
        enabled,
        risk: fresh ? rainRisk(st.data, now) : null,
        lap: rainByLapTimes(st.avgHist, now, lastAvg),
        stale: enabled && !fresh && now - Math.max(st.since, st.fetchedAt) > STALE_MS,
        fetchedAt: st.fetchedAt,
        error: st.error,
      };
    }

    function kpiLineHtml() {
      const cur = current();
      const line = lineFor(cur);
      if (!line) return '';
      const parts = [];
      if (cur.risk) {
        parts.push(cur.risk.slots.map(s => hhmm(s.t) + ' ' + fmtS(s.mm) + ' mm').join(' · '));
        if (cur.risk.probNextHour != null) parts.push('Probabilidad esta hora: ' + cur.risk.probNextHour + ' %');
      }
      if (cur.lap && cur.lap.deltaS != null) parts.push('Media de pista ' + (cur.lap.deltaS >= 0 ? '+' : '') + fmtS(cur.lap.deltaS) + ' s frente a hace ' + Math.round((d.now() - cur.lap.baselineTs) / 60000) + ' min');
      parts.push(cur.fetchedAt ? 'Actualizado ' + hhmm(cur.fetchedAt) : 'Sin previsión todavía');
      parts.push('Open-Meteo, cuadrícula ~1,5-9 km');
      return '<div class="sp-kpi-sub" style="color:' + line.color + ';margin-top:2px" title="' + esc(parts.join('\n')) + '">' + esc(line.text) + '</div>';
    }

    return { tick, current, kpiLineHtml, _state: st };
  }
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `node tests/weather-instance.test.js && node tests/weather.test.js`
Expected: `8 OK, 0 fallos` y `15 OK, 0 fallos`.

- [ ] **Step 5: Commit**

```bash
git add src/en-weather.js tests/weather-instance.test.js
git commit -m "feat(meteo): sondeo cada 10 min solo en directo y línea del KPI"
```

---

### Task 5: La alerta de lluvia de la IA usa `rainByLapTimes`

**Files:**
- Modify: `src/en-ai-alerts.js:59-75` (bloque `// 1) Subida colectiva de tiempos…`)

**Interfaces:**
- Consumes: `window.EnWeatherCore.rainByLapTimes(history, nowMs, trackAvgS)` (Task 3).

- [ ] **Step 1: Sustituir el bloque** — el cálculo actual

```js
  if(!onCooldown('rain')){
    const baseline=_enAiAlerts.trackAvgHistory.find(s=>now-s.ts>=9*60*1000);
    if(baseline&&trackAvg-baseline.avg>1.5){
      _enFireAlert('rain', {
        trackAvgNowS:    Math.round(trackAvg*100)/100,
        trackAvgBeforeS: Math.round(baseline.avg*100)/100,
        minutesAgo:      Math.round((now-baseline.ts)/60000),
      });
      return;
    }
  }
```

por

```js
  if(!onCooldown('rain')&&window.EnWeatherCore){
    // Misma regla que la línea de lluvia del KPI Media pista (en-weather.js).
    const r=window.EnWeatherCore.rainByLapTimes(_enAiAlerts.trackAvgHistory, now, trackAvg);
    if(r.rising){
      _enFireAlert('rain', {
        trackAvgNowS:    Math.round(trackAvg*100)/100,
        trackAvgBeforeS: Math.round(r.baselineAvg*100)/100,
        minutesAgo:      Math.round((now-r.baselineTs)/60000),
      });
      return;
    }
  }
```

- [ ] **Step 2: Comprobar sintaxis y que nada más usa la lógica vieja**

Run: `node -e "new Function(require('fs').readFileSync('src/en-ai-alerts.js','utf8'));console.log('OK')" && grep -n "baseline.avg" src/en-ai-alerts.js`
Expected: `OK` y la búsqueda de `baseline.avg` no encuentra nada (el bloque 3 usa `baseline.gap`, que no cambia).

- [ ] **Step 3: Commit**

```bash
git add src/en-ai-alerts.js
git commit -m "refactor(alertas): la alerta de lluvia usa EnWeatherCore.rainByLapTimes"
```

---

### Task 6: Enganchar en el panel, script y CSP

**Files:**
- Modify: `src/index.html:91` (después de `<script src="en-pit-windows.js"></script>`)
- Modify: `src/en-grid.js` (`_enRender`, tras calcular `trackAvg`; `_enKpisHtml`, KPI Media pista)
- Modify: `vercel.json` (`Content-Security-Policy` → `connect-src`)

**Interfaces:**
- Consumes: `window.EnWeather.tick(slug, trackAvgS)` y `window.EnWeather.kpiLineHtml()` (Task 4).

- [ ] **Step 1: Cargar el script** — en `src/index.html`, tras la línea `<script src="en-pit-windows.js"></script>`:

```html
  <script src="en-weather.js"></script>
```

- [ ] **Step 2: Llamar a `tick` en cada render** — en `src/en-grid.js`, en `_enRender`, justo después de la línea `const inPit=eq.filter(e=>e.pit).length;`:

```js
  // Meteo: guarda la media de pista y, cada 10 min y solo en directo, pide la
  // previsión (en-weather.js). Un fallo aquí nunca para el panel.
  try{ if(window.EnWeather)window.EnWeather.tick(window.AppState?.config?.slug, trackAvg); }
  catch(err){console.error('[StintPro] Error meteo:',err);}
```

- [ ] **Step 3: Pintar la línea** — en `_enKpisHtml`, sustituir

```js
    <div class="sp-kpi-sub">click para filtrar equipos</div>
  </div>
```

por

```js
    <div class="sp-kpi-sub">click para filtrar equipos</div>
    ${window.EnWeather?window.EnWeather.kpiLineHtml():''}
  </div>
```

- [ ] **Step 4: CSP** — en `vercel.json`, dentro de `connect-src`, añadir ` https://api.open-meteo.com` justo después de `'self'`:

```
connect-src 'self' https://api.open-meteo.com https://nyybrybnvflwbdwdqpwa.supabase.co …
```

- [ ] **Step 5: Sintaxis y tests de todo el cliente**

Run:
```bash
node -e "new Function(require('fs').readFileSync('src/en-grid.js','utf8'));console.log('OK')"
node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'));console.log('JSON OK')"
for f in tests/*.test.js; do node "$f" >/dev/null 2>&1 || echo "FALLA $f"; done; node tests.js | tail -1; node tests-connector.js | tail -1
```
Expected: `OK`, `JSON OK`, ninguna línea `FALLA`, `38 pasados, 0 fallados`, `25 pasados, 0 fallados`.

- [ ] **Step 6: Verificar en el navegador** — `preview_start` con `stintpro-banco` (sirve la raíz del repo en :8765; la CSP de Vercel NO se aplica en local):
  1. Abrir `http://localhost:8765/src/index.html`, entrar en modo demo (repetición) y comprobar en la pestaña de red que **no** hay peticiones a `api.open-meteo.com`.
  2. En la consola de la página, forzar una instancia en directo sobre un circuito con coordenadas:
     ```js
     window.EnWeather = EnWeatherCore.createWeather({ isLive: () => true, coordsOf: () => CircuitDB.coordsOf('henakart') });
     ```
     y esperar al siguiente render: hay **una** petición a `api.open-meteo.com/v1/forecast?latitude=40.42828&longitude=-3.44353…` con 200.
  3. Si la previsión es seca, comprobar que la línea no aparece; forzar riesgo con
     ```js
     EnWeather._state.data = { minutely_15: { time: [Date.now()/1000+600], precipitation: [0.5] }, hourly: { time: [], precipitation_probability: [] } }; EnWeather._state.fetchedAt = Date.now();
     ```
     y ver `🌧 Riesgo alto · ~10 min` en el KPI Media pista, con el tooltip. El clic en el KPI sigue abriendo el filtro de media.
  4. `read_console_messages` sin errores `[StintPro] Error meteo`. Captura del KPI.

- [ ] **Step 7: Commit**

```bash
git add src/index.html src/en-grid.js vercel.json
git commit -m "feat(meteo): riesgo de lluvia en el KPI Media pista"
```

---

### Task 7: Cierre — validación con Ariza y nota en la spec

**Files:**
- Modify: `docs/superpowers/specs/2026-10-26-meteo-riesgo-lluvia-design.md` (sección Pruebas)

- [ ] **Step 1: Anotar el resultado de la validación** (el test de Ariza de la Task 3 ya lo fija) — añadir al final de la sección «Pruebas» de la spec:

```md
**Resultado de la validación (2026-10-26):** con la previsión histórica de Open-Meteo para Ariza el 2026-10-04 (15 min: 0,1 mm de 17:15 a 18:00; probabilidad 28 % a las 16 h y 35 % a las 17 h) y los umbrales de esta spec, el panel habría mostrado «Riesgo medio» desde las 17:00 y «Lloviendo» desde las 17:15; la subida de tiempos empezó hacia las 17:32 → ~30 min de margen. Con `MM_RISK = 0.1` habría salido «Riesgo alto · ~30 min» ya a las 16:45. Se mantienen los umbrales de la spec salvo que el usuario decida bajar `MM_RISK`. Límite: la API histórica junta los primeros pasos de cada pasada del modelo; no es exactamente lo que se veía en vivo.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-10-26-meteo-riesgo-lluvia-design.md
git commit -m "docs(meteo): resultado de la validación con Ariza 2026-10-04"
```

- [ ] **Step 3: Parar y preguntar al usuario** si sube a `origin/main` (Vercel despliega). Tras el despliegue: comprobar en `https://stintpro.vercel.app` que la CSP deja pasar `api.open-meteo.com` (consola sin `Refused to connect`).
