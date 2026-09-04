// StintPro — tests del arranque del PRIMER stint de carrera (raceStintStart).
// Foco: el stint NO debe arrancar con el reloj de warmup (ascendente) ni con un
// reloj rancio; solo con la cuenta atrás REGRESIVA en marcha o la salida oficial
// (verde com|). Contrastado con raw logs del VPS: las prácticas mandan
// `dyn1|count|` ascendente desde antes de la verde (inflaba el stint 2-10 min),
// las resistencias mandan `dyn1|countdown|` regresivo justo al dar la salida.
// Ejecutar: node tests/race-stint-start.test.js
'use strict';

const { strictEqual, ok } = require('assert');
const { raceStintStart } = require('../src/en-stint-machine');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const NOW = 1_700_000_000_000;
const H = 3600 * 1000;

console.log('\n▸ Arranque del primer stint de carrera\n');

// ── El bug que motivó todo esto ────────────────────────────────────────────
test('reloj ASCENDENTE de warmup (count) sin verde → NO arranca el stint', () => {
  // Patrón campillos_10: dyn1|count| ascendente desde antes de la salida.
  const clock = { synced: true, countUp: true, remainingMs: 212027 };
  strictEqual(raceStintStart(clock, null, 0, NOW), null);
});

test('reloj ascendente con duración configurada tampoco arranca', () => {
  const clock = { synced: true, countUp: true, remainingMs: 212027 };
  strictEqual(raceStintStart(clock, null, 9 * H, NOW), null);
});

// ── Cuenta atrás regresiva = la carrera arrancó ─────────────────────────────
test('countdown REGRESIVO en marcha con duración → ancla al inicio real', () => {
  // Quedan 8h30 de una carrera de 9h → arrancó hace 30 min.
  const rem = 8.5 * H;
  const clock = { synced: true, countUp: false, remainingMs: rem };
  strictEqual(raceStintStart(clock, null, 9 * H, NOW), NOW - 0.5 * H);
});

test('countdown regresivo sin duración configurada → arranca ahora', () => {
  const clock = { synced: true, countUp: false, remainingMs: 45 * 60 * 1000 };
  strictEqual(raceStintStart(clock, null, 0, NOW), NOW);
});

test('countdown regresivo recién arrancado (queda ~toda la carrera) → ancla ≈ ahora', () => {
  const clock = { synced: true, countUp: false, remainingMs: 3_599_884 };
  strictEqual(raceStintStart(clock, null, 3_600_000, NOW), NOW - 116);
});

// ── Salida oficial (verde com|): prioridad y salvaguarda ────────────────────
test('verde com| presente → arranca en el instante de la verde, aunque el reloj sea ascendente', () => {
  const clock = { synced: true, countUp: true, remainingMs: 212027 };
  const raceStart = { at: NOW - 3 * 60 * 1000 };
  strictEqual(raceStintStart(clock, raceStart, 0, NOW), NOW - 3 * 60 * 1000);
});

test('verde com| tiene prioridad sobre el cálculo del countdown', () => {
  const clock = { synced: true, countUp: false, remainingMs: 8.5 * H };
  const raceStart = { at: NOW - 12 * 60 * 1000 };
  strictEqual(raceStintStart(clock, raceStart, 9 * H, NOW), NOW - 12 * 60 * 1000);
});

// ── Countdown de PRE-CARRERA (no es el reloj de carrera) ────────────────────
// circuitosona ENDURANCE-4H: manda un countdown regresivo de 4 min que decrece a
// 0 ANTES de rodar (misma sesión, verde=0, 1ª vuelta a los 881s). No es la salida.
test('pre-carrera: countdown corto (4min) sobre carrera larga (4H) configurada → NO arranca', () => {
  const clock = { synced: true, countUp: false, remainingMs: 240789 };
  strictEqual(raceStintStart(clock, null, 4 * H, NOW), null);
});

test('pre-carrera: countdown corto (4min) SIN duración configurada → NO arranca (magnitud < 15min)', () => {
  const clock = { synced: true, countUp: false, remainingMs: 240789 };
  strictEqual(raceStintStart(clock, null, 0, NOW), null);
});

test('sprint de 10min sin duración configurada → NO arranca por reloj (arranca con la 1ª vuelta)', () => {
  // Los Santos Sesion-10: el countdown de 9.8min ES el reloj, pero sin duración
  // no se distingue de un timer de pre-carrera → se defiere a la 1ª vuelta.
  const clock = { synced: true, countUp: false, remainingMs: 9.8 * 60 * 1000 };
  strictEqual(raceStintStart(clock, null, 0, NOW), null);
});

test('conexión a mitad de carrera (rem < 50% de la duración) → NO arranca por reloj (salvaguarda 1ª vuelta)', () => {
  const clock = { synced: true, countUp: false, remainingMs: 25 * 60 * 1000 };
  strictEqual(raceStintStart(clock, null, 2 * H, NOW), null);
});

test('resistencia real, reloj cerca de la duración (rem >= 50%) → SÍ arranca', () => {
  // 55 min restantes de una carrera de 1h → 91% → reloj de carrera legítimo.
  const clock = { synced: true, countUp: false, remainingMs: 55 * 60 * 1000 };
  strictEqual(raceStintStart(clock, null, 1 * H, NOW), NOW - 5 * 60 * 1000);
});

// ── Estados en los que NO se arranca ────────────────────────────────────────
test('reloj sin sincronizar y sin verde → null (esperando salida)', () => {
  strictEqual(raceStintStart({ synced: false, countUp: false, remainingMs: null }, null, 9 * H, NOW), null);
});

test('countdown regresivo agotado (rem<=0, fin de sesión) sin verde → null', () => {
  const clock = { synced: true, countUp: false, remainingMs: 0 };
  strictEqual(raceStintStart(clock, null, 9 * H, NOW), null);
});

test('verde con timestamp absurdo (futuro) → se ignora, cae al reloj', () => {
  const clock = { synced: false, countUp: false, remainingMs: null };
  const raceStart = { at: NOW + 60 * 1000 }; // en el futuro
  strictEqual(raceStintStart(clock, raceStart, 0, NOW), null);
});

test('verde demasiado vieja (>24h) → se ignora', () => {
  const clock = { synced: false, countUp: false, remainingMs: null };
  const raceStart = { at: NOW - 25 * H };
  strictEqual(raceStintStart(clock, raceStart, 0, NOW), null);
});

test('clock null (aún no hay ApexClock) sin verde → null', () => {
  strictEqual(raceStintStart(null, null, 0, NOW), null);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
