// StintPro — tests del ANCLA de salida oficial (createRaceStartTracker._clockToEpoch).
// Foco: una verde `com|` anunciada unos segundos ANTES de su minoto (el director
// arma "Start 11:23" cuando el reloj de pared aún marca 11:22) NO debe anclarse a
// AYER. El bug real (Henakart 3H, 2026-09-06): diffMin = 11:22 − 11:23 = −1 → el
// código sumaba 24h → ancla a ayer 11:23 → el KPI "Tiempo de stint" mostraba una
// cantidad de horas absurda. Ver [[project-stintpro-stint-timer]].
// Ejecutar: node tests/race-start-anchor.test.js
'use strict';

const { strictEqual, ok } = require('assert');
const { createRaceStartTracker } = require('../src/apex-protocol');

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

console.log(`\n${passed} pasan, ${failed} fallan\n`);
process.exit(failed ? 1 : 0);
