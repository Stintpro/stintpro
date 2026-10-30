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

const SIN_COORDS = ['misanino-kart', 'worldkarts', 'grancanaria-karting'];

test('el catálogo incluye los 22 circuitos que graba el VPS', () => {
  strictEqual(DB.list.length, 22);
  for (const s of ['korridas', 'kartodromo-de-tapia', 'misanino-kart', 'worldkarts', 'firstkartinn', 'grancanaria-karting', 'prestige-karting', 'kartalcanede'])
    ok(DB.list.some(c => c.slug === s), 'falta ' + s);
});

test('coordenadas válidas (Europa) en todos salvo los pendientes', () => {
  const sin = [];
  for (const c of DB.list) {
    const xy = DB.coordsOf(c.slug);
    if (!xy) { sin.push(c.slug); continue; }
    ok(xy[0] > 27 && xy[0] < 56 && xy[1] > -17 && xy[1] < 20, 'fuera de rango: ' + c.slug);
  }
  deepStrictEqual(sin.sort(), SIN_COORDS.slice().sort());
});

test('todos los circuitos del catálogo tienen grupo de país conocido', () => {
  const keys = DB.countries.map(g => g.key);
  for (const c of DB.list) ok(keys.includes(c.country), 'sin país: ' + c.slug);
});

test('grouped: orden de países, alfabético dentro y ninguno perdido', () => {
  const g = DB.grouped();
  deepStrictEqual(g.map(x => x.label), DB.countries.map(c => c.label));
  strictEqual(g[0].circuits[0].slug, 'ariza-racing-circuit');
  for (const x of g) {
    const n = x.circuits.map(c => c.name);
    deepStrictEqual(n, n.slice().sort((a, b) => a.localeCompare(b, 'es')));
  }
  strictEqual(g.reduce((t, x) => t + x.circuits.length, 0), DB.list.length);
});

test('grouped: un circuito propio va al final en Mis circuitos', () => {
  DB.list.push({ id: 'custom_x', name: 'Zzz', slug: 'x', port: 1, _custom: true });
  const g = DB.grouped();
  DB.list.pop();
  strictEqual(g[g.length - 1].label, 'Mis circuitos');
  strictEqual(g[g.length - 1].circuits[0].slug, 'x');
});

test('optionsHtml genera un optgroup por grupo y una opción por circuito', () => {
  const h = DB.optionsHtml();
  strictEqual(h.match(/<optgroup /g).length, DB.countries.length);
  strictEqual(h.match(/<option /g).length, DB.list.length);
});

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
