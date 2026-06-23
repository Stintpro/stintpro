// StintPro — tests unitarios de apex-connector (portado a ApexProtocol API actual)
// Foco: registro correcto de última vuelta (lastLap / lapHistory)
// Ejecutar: node tests-connector.js

'use strict';

const { strictEqual, deepEqual, ok } = require('assert');
const { createParser } = require('./src/apex-protocol');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch(e) { console.log('  ✗', name, '→', e.message); failed++; }
}

// Helper: crea parser limpio con colMap opcional
function setup(colMap = {}) {
  const colByNum = {};
  Object.entries(colMap).forEach(([dtype, col]) => { colByNum[col] = dtype; });
  const parser = createParser({});
  if (Object.keys(colMap).length) {
    parser.setGrid({ colMap, colByNum, karts: [] });
  }
  return parser;
}

// Helper: obtiene kart por rowId desde el estado del parser
function kart(parser, rowId = 'r1') {
  return parser.getState().equipos.find(e => e._rowId === rowId || e.dorsal === rowId)
    || parser.getState()._kartsRaw?.[rowId]
    || (() => { parser.parse(`r1|no|1|\n`); return parser.getState().equipos[0]; })();
}

// Helper alternativo más directo: acceso interno al mapa de karts
function k(parser, rowId = 'r1') {
  // Exponer estado interno mediante getState y buscar por dorsal/rowId
  const state = parser.getState();
  return state.equipos.find(e => e._rowId === rowId) ?? null;
}

// Helper que parsea y devuelve el kart del estado
function parse(parser, msg) {
  parser.parse(msg);
  const state = parser.getState();
  return state.equipos[0] ?? null;
}

// ── Registro desde |*| ────────────────────────────────────────────────────────
console.log('\n|*| sin columna llp');

test('registra lastLap y lapHistory', () => {
  const p = setup();
  parse(p, 'r1|*|62000|\n');
  const e = parse(p, '');
  strictEqual(e.lastLap, 62.0);
  ok((e.lapHistory || []).includes(62.0));
});

test('registra bestLap si es la primera vuelta', () => {
  const p = setup();
  parse(p, 'r1|*|62000|\n');
  strictEqual(parse(p, '').bestLap, 62.0);
});

test('actualiza bestLap si la vuelta es mejor', () => {
  const p = setup();
  parse(p, 'r1|*|63000|\n');
  parse(p, 'r1|*|61500|\n');
  strictEqual(parse(p, '').bestLap, 61.5);
});

test('NO actualiza bestLap si la vuelta es peor', () => {
  const p = setup();
  parse(p, 'r1|*|61500|\n');
  parse(p, 'r1|*|63000|\n');
  strictEqual(parse(p, '').bestLap, 61.5);
});

test('no registra vueltas < 20s (inválidas)', () => {
  const p = setup();
  parse(p, 'r1|*|15000|\n');
  const e = parse(p, '');
  ok(!e || !e.lastLap, 'no debe haber lastLap para vuelta de 15s');
});

test('no registra vueltas >= 300s (inválidas)', () => {
  const p = setup();
  parse(p, 'r1|*|300000|\n');
  const e = parse(p, '');
  ok(!e || !e.lastLap, 'no debe haber lastLap para vuelta de 300s');
});

test('no registra vuelta si hay pit in activo', () => {
  const colMap = { grp: 'c1' };
  const p = setup(colMap);
  parse(p, 'r1c1|si||\n');   // pit IN
  parse(p, 'r1|*|62000|\n'); // parcial tras pit — debe ignorarse
  const e = parse(p, '');
  ok(!e || !e.lastLap, 'vuelta tras pit in no debe registrar lastLap');
});

// ── Comportamiento |*| con columna llp ───────────────────────────────────────
console.log('\n|*| con columna llp: deja registro a llp');

test('|*| con llp: NO registra lastLap directamente (lo hace llp después)', () => {
  const p = setup({ llp: 'c9' });
  parse(p, 'r1|*|62000|\n');
  const e = parse(p, '');
  ok(!e || !e.lastLap, '|*| con llp configurado no registra vuelta — la registra llp');
});

test('|*| con llp: llp posterior sí registra (anti-dedup, 1 sola entrada)', () => {
  const p = setup({ llp: 'c9' });
  parse(p, 'r1|*|62000|\n');
  parse(p, 'r1c9|sr|1:02.200|\n');
  const e = parse(p, '');
  strictEqual(e.lastLap, 62.2);
  strictEqual((e.lapHistory || []).length, 1, 'una sola entrada — no duplicado');
});

// ── Registro desde celda llp ──────────────────────────────────────────────────
console.log('\ncelda llp registra última vuelta');

test('registra lastLap desde celda llp (formato M:SS.mmm)', () => {
  const p = setup({ llp: 'c9' });
  parse(p, 'r1c9|sr|1:02.000|\n');
  strictEqual(parse(p, '').lastLap, 62.0);
});

test('registra lastLap desde celda llp (formato SS.mmm)', () => {
  const p = setup({ llp: 'c9' });
  parse(p, 'r1c9|sr|47.234|\n');
  strictEqual(parse(p, '').lastLap, 47.234);
});

test('registra en lapHistory al llegar llp', () => {
  const p = setup({ llp: 'c9' });
  parse(p, 'r1c9|sr|1:02.000|\n');
  ok((parse(p, '').lapHistory || []).includes(62.0));
});

test('actualiza bestLap desde llp', () => {
  const p = setup({ llp: 'c9' });
  parse(p, 'r1c9|sr|1:02.000|\n');
  strictEqual(parse(p, '').bestLap, 62.0);
});

test('ignora llp con valor < 20s', () => {
  const p = setup({ llp: 'c9' });
  parse(p, 'r1c9|sr|15.000|\n');
  const e = parse(p, '');
  ok(!e || !e.lastLap);
});

// ── Anti-duplicado llp / |*| ──────────────────────────────────────────────────
console.log('\nanti-duplicado |*| + llp');

test('llp refina vuelta previa de |*| aunque la diferencia sea > 0.05s', () => {
  const p = setup({ llp: 'c9' });
  parse(p, 'r1|*|62000|\n');
  parse(p, 'r1c9|sr|1:02.200|\n');
  const e = parse(p, '');
  strictEqual(e.lastLap, 62.2, 'llp debe refinar el valor de |*|');
  strictEqual((e.lapHistory || []).length, 1, 'no debe duplicar en lapHistory');
});

test('BUG ORIGINAL: diferencia ~1s no generaba duplicado (regresión)', () => {
  const p = setup({ llp: 'c9' });
  parse(p, 'r1|*|62000|\n');
  parse(p, 'r1c9|sr|1:02.800|\n');
  const e = parse(p, '');
  strictEqual((e.lapHistory || []).length, 1, 'una sola vuelta — el duplicado es el bug');
  strictEqual(e.lastLap, 62.8, 'debe quedar el valor oficial de apex (llp)');
});

test('llp refina vuelta previa de |*| con diferencia pequeña', () => {
  const p = setup({ llp: 'c9' });
  parse(p, 'r1|*|62000|\n');
  parse(p, 'r1c9|sr|1:02.020|\n');
  const e = parse(p, '');
  strictEqual(e.lastLap, 62.02);
  strictEqual((e.lapHistory || []).length, 1);
});

test('llp añade entrada nueva si NO hubo |*| previo', () => {
  const p = setup({ llp: 'c9' });
  parse(p, 'r1c9|sr|1:02.000|\n');
  const e = parse(p, '');
  strictEqual((e.lapHistory || []).length, 1);
  strictEqual(e.lastLap, 62.0);
});

// ── Múltiples vueltas ─────────────────────────────────────────────────────────
console.log('\nmúltiples vueltas');

test('acumula varias vueltas en lapHistory', () => {
  const p = setup();
  parse(p, 'r1|*|62000|\n');
  parse(p, 'r1|*|63000|\n');
  parse(p, 'r1|*|61500|\n');
  const hist = parse(p, '').lapHistory || [];
  deepEqual(hist, [62.0, 63.0, 61.5]);
});

test('lastLap es siempre la más reciente', () => {
  const p = setup();
  parse(p, 'r1|*|62000|\n');
  parse(p, 'r1|*|65000|\n');
  strictEqual(parse(p, '').lastLap, 65.0);
});

// ── Pit IN / OUT ──────────────────────────────────────────────────────────────
console.log('\npit in / out');

test('pit IN activa pit=true', () => {
  const p = setup({ grp: 'c1' });
  parse(p, 'r1c1|si||\n');
  ok(parse(p, '').pit === true);
});

test('pit OUT pone pitState=out (pit sigue true hasta sr)', () => {
  const p = setup({ grp: 'c1' });
  parse(p, 'r1c1|si||\n');
  parse(p, 'r1c1|so||\n');
  strictEqual(parse(p, '').pitState, 'out');
});

// ── Vuelta ficticia tras pit ───────────────────────────────────────────────────
console.log('\nvuelta ficticia tras pit (sin |*in|0 / |*out|0)');

test('si sin |*in|0: parcial tras pit IN no se registra', () => {
  const p = setup({ grp: 'c1' });
  parse(p, 'r1|*|62000|\n');
  parse(p, 'r1c1|si||\n');
  parse(p, 'r1|*|25000|\n');
  const e = parse(p, '');
  strictEqual((e.lapHistory || []).length, 1, 'solo debe existir la vuelta previa al pit');
  strictEqual(e.lastLap, 62.0, 'lastLap no debe cambiar a 25s');
});

test('so sin |*out|0: parcial tras pit OUT no se registra', () => {
  const p = setup({ grp: 'c1' });
  parse(p, 'r1|*|62000|\n');
  parse(p, 'r1c1|si||\n');
  parse(p, 'r1c1|so||\n');
  parse(p, 'r1|*|25000|\n');
  const e = parse(p, '');
  strictEqual((e.lapHistory || []).length, 1, 'el parcial post-pit no debe registrarse');
});

test('tras el parcial bloqueado, siguiente vuelta completa sí se registra', () => {
  const p = setup({ grp: 'c1' });
  parse(p, 'r1|*|62000|\n');
  parse(p, 'r1c1|si||\n');
  parse(p, 'r1c1|so||\n');
  parse(p, 'r1|*|25000|\n');
  parse(p, 'r1|*|63000|\n');
  const e = parse(p, '');
  strictEqual((e.lapHistory || []).length, 2);
  strictEqual(e.lastLap, 63.0);
});

// ── Resultado ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} pasados, ${failed} fallados`);
if (failed) process.exit(1);
