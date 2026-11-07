// StintPro — tests del ANCLA de salida oficial (createRaceStartTracker._clockToEpoch).
// Foco: una verde `com|` anunciada unos segundos ANTES de su minoto (el director
// arma "Start 11:23" cuando el reloj de pared aún marca 11:22) NO debe anclarse a
// AYER. El bug real (Henakart 3H, 2026-09-06): diffMin = 11:22 − 11:23 = −1 → el
// código sumaba 24h → ancla a ayer 11:23 → el KPI "Tiempo de stint" mostraba una
// cantidad de horas absurda. Ver [[project-stintpro-stint-timer]].
// Ejecutar: node tests/race-start-anchor.test.js
'use strict';

const { strictEqual, ok } = require('assert');
const { createRaceStartTracker, timeZoneFor, correctRaceStart } = require('../src/apex-protocol');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

// El tracker usa Date.now()/new Date() del sistema. Para fijar "ahora" en un
// instante conocido (Madrid) parcheamos el reloj global durante cada caso.
const RealDate = Date;
function withClock(nowMs, fn) {
  global.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(nowMs); else super(...a); }
    static now() { return nowMs; }
  };
  try { return fn(); } finally { global.Date = RealDate; }
}

// Genera el HTML del cronograma com| (más reciente primero).
const G = (...hhmm) => hhmm.map(t => `<p><b>${t}</b><span data-flag="green"></span>Start</p>`).join('');

const H = 3600 * 1000, MIN = 60 * 1000;
// 2026-09-06 09:22:00 UTC = 11:22:00 Europe/Madrid (CEST, UTC+2).
const NOW_1122 = RealDate.UTC(2026, 8, 6, 9, 22, 0);

console.log('\n▸ Ancla de salida oficial (com|)\n');

// ── El bug que motivó todo esto ─────────────────────────────────────────────
test('verde "11:23" ingerida a las 11:22 (1 min antes) NO se ancla a ayer', () => {
  withClock(NOW_1122, () => {
    const tr = createRaceStartTracker();
    tr.ingest(G('10:47'));            // prime con una verde anterior (rama history)
    const rs = tr.ingest(G('11:23', '10:47')); // verde de carrera anunciada 1 min antes
    ok(rs && rs.at, 'debe devolver un ancla');
    const ago = NOW_1122 - rs.at;
    ok(ago < 2 * H, `ancla a ${(ago / H).toFixed(2)}h atrás — no debe ser ~24h (bug -24h)`);
  });
});

test('verde en el minuto exacto (11:22 @ 11:22) ancla a ahora', () => {
  withClock(NOW_1122, () => {
    const tr = createRaceStartTracker();
    tr.ingest(G('10:47'));
    const rs = tr.ingest(G('11:22', '10:47'));
    ok(rs && rs.at, 'debe devolver un ancla');
    strictEqual(Math.round((NOW_1122 - rs.at) / MIN), 0);
  });
});

// ── No romper el caso legítimo: una verde de HACE HORAS sí es del pasado ─────
test('verde real de hace 40 min ancla 40 min atrás (no futuro)', () => {
  withClock(NOW_1122, () => {
    const tr = createRaceStartTracker();
    // primera ingesta (history): 10:42 = hace 40 min, <8h → válida
    const rs = tr.ingest(G('10:42'));
    ok(rs && rs.at, 'debe devolver un ancla');
    strictEqual(Math.round((NOW_1122 - rs.at) / MIN), 40);
  });
});

// ── Huso del circuito (26H Alcanede, 2026-11-07) ────────────────────────────
// El tablón trae la hora LOCAL del circuito. Portugal va en UTC+0 y el código
// la leía como hora de Madrid (UTC+1): la verde "11:16" quedaba anclada a las
// 10:16 UTC y el KPI de stint marcaba 100 min con 42 de carrera.
// 2026-11-07 11:16:58 UTC = 11:16 en Lisboa (WET, UTC+0) = 12:16 en Madrid.
const ALC_GREEN = RealDate.UTC(2026, 10, 7, 11, 16, 58);
const GA = t => `<p><b>${t}</b><span data-flag="green"></span>Partida</p>`;

test('huso por circuito: Portugal y Canarias en su hora, el resto en Madrid', () => {
  strictEqual(timeZoneFor('kartalcanede'), 'Europe/Lisbon');
  strictEqual(timeZoneFor('kip-palmela'), 'Europe/Lisbon');
  strictEqual(timeZoneFor('grancanaria-karting'), 'Atlantic/Canary');
  strictEqual(timeZoneFor('campillos'), 'Europe/Madrid');
  strictEqual(timeZoneFor(undefined), 'Europe/Madrid');
});

test('Alcanede: verde "11:16" en vivo se ancla a las 11:16 UTC, no una hora antes', () => {
  const tr = createRaceStartTracker({ timeZone: timeZoneFor('kartalcanede') });
  withClock(ALC_GREEN - 30 * MIN, () => tr.ingest('<p><b>10:40</b><span data-flag="red"></span>Fim</p>'));
  const rs = withClock(ALC_GREEN, () => tr.ingest(GA('11:16')));
  ok(rs && rs.at, 'debe devolver un ancla');
  ok(Math.abs(rs.at - ALC_GREEN) < 2 * MIN, `ancla desplazada ${((ALC_GREEN - rs.at) / MIN).toFixed(0)} min`);
});

test('Alcanede: panel abierto a mitad de carrera (rama history) ancla bien', () => {
  const now = ALC_GREEN + 41 * MIN;
  const rs = withClock(now, () => createRaceStartTracker({ timeZone: 'Europe/Lisbon' }).ingest(GA('11:16')));
  ok(rs && rs.at, 'debe devolver un ancla');
  strictEqual(Math.round((now - rs.at) / MIN), 41);
});

test('corregir un ancla del logger viejo desplazada una hora por el huso', () => {
  const now = ALC_GREEN + 41 * MIN;
  const bad = { at: ALC_GREEN - 60 * MIN, clock: '11:16', source: 'live' };
  const fixed = withClock(now, () => correctRaceStart(bad, 'Europe/Lisbon', now));
  strictEqual(fixed.at, ALC_GREEN);   // una hora justa, con sus segundos
});

test('un ancla correcta no se toca (precisión de segundos intacta)', () => {
  const now = ALC_GREEN + 41 * MIN;
  const good = { at: ALC_GREEN, clock: '11:16', source: 'live' };
  strictEqual(withClock(now, () => correctRaceStart(good, 'Europe/Lisbon', now)), good);
});

test('carrera de más de 24h: la verde de AYER con la misma hora no se "corrige" a hoy', () => {
  const now = ALC_GREEN + 25 * H;
  const good = { at: ALC_GREEN, clock: '11:16', source: 'live' };
  strictEqual(withClock(now, () => correctRaceStart(good, 'Europe/Lisbon', now)), good);
});

console.log(`\n${passed} pasan, ${failed} fallan\n`);
process.exit(failed ? 1 : 0);
