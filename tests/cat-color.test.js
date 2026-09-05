'use strict';
// Tests para el color de dorsal por categoría (señal `notc` de Apex).
// Apex codifica la categoría de cada kart como el color de la celda del dorsal
// (clase `notcNNN`, NNN = color BGR empaquetado). StintPro lo decodifica a hex,
// lo propaga por el snapshot y lo convierte en un acento sobre el chip oscuro.
// Run: node tests/cat-color.test.js

const assert = require('assert/strict');

const { createParser, notcToHex } = require('../src/apex-protocol');

// Globals que en-state.js espera del browser
const { _enCleanLaps, _enFmt } = require('../src/analysis');
global._enCleanLaps = _enCleanLaps;
global._enFmt       = _enFmt;
const { _enKartColor } = require('../src/en-state');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}
function group(name, fn) { console.log(`\n${name}`); fn(); }

// ── notcToHex: el número de la clase notc es un color BGR empaquetado ──────────
// Verificado contra las defs CSS reales del init de prestige (24H du LUC 2026):
//   css|notc255|border-bottom-color:#FF0000  → rojo
//   css|notc16711680|border-bottom-color:#0000FF → azul
group('notcToHex (decode BGR)', () => {
  test('255 → #FF0000 (rojo)',        () => assert.equal(notcToHex('255'), '#FF0000'));
  test('16711680 → #0000FF (azul)',   () => assert.equal(notcToHex('16711680'), '#0000FF'));
  test('65535 → #FFFF00 (amarillo)',  () => assert.equal(notcToHex('65535'), '#FFFF00'));
  test('33023 → #FF8000 (naranja)',   () => assert.equal(notcToHex('33023'), '#FF8000'));
  test('4227327 → #FF8040',           () => assert.equal(notcToHex('4227327'), '#FF8040'));
  test('acepta número, no solo string', () => assert.equal(notcToHex(255), '#FF0000'));
  test('inválido → null',             () => assert.equal(notcToHex('abc'), null));
  test('fuera de rango → null',       () => assert.equal(notcToHex('99999999'), null));
});

// ── Propagación por el parser: gridKart.catColor → getState().equipos[].catColor
group('catColor viaja del grid al snapshot', () => {
  test('un kart con catColor lo expone en getState', () => {
    const p = createParser({});
    p.setGrid({
      colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7', catColor: '#FF0000' }],
    });
    const k = p.getState().equipos.find(e => e.dorsal === '7');
    assert.equal(k.catColor, '#FF0000');
  });

  test('un kart sin catColor lo expone como null (monoclase)', () => {
    const p = createParser({});
    p.setGrid({
      colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '9' }],
    });
    const k = p.getState().equipos.find(e => e.dorsal === '9');
    assert.equal(k.catColor, null);
  });
});

// ── _enKartColor: acento de categoría vs paleta decorativa ────────────────────
group('_enKartColor (acento sobre chip oscuro)', () => {
  test('con catColor devuelve bg/text/border', () => {
    const c = _enKartColor('7', '#FF0000');
    assert.ok(c && c.bg && c.text && c.border, 'debe tener bg, text y border');
  });

  test('misma categoría → mismo acento aunque cambie el dorsal (color PURO de categoría)', () => {
    const a = _enKartColor('7',  '#FF0000');
    const b = _enKartColor('21', '#FF0000');
    assert.deepEqual(a, b);
  });

  test('categorías distintas → acentos distintos', () => {
    const rojo = _enKartColor('7', '#FF0000');
    const azul = _enKartColor('7', '#0000FF');
    assert.notDeepEqual(rojo, azul);
  });

  test('el texto conserva el tono de la categoría (rojo → hue 0)', () => {
    const c = _enKartColor('7', '#FF0000');
    assert.match(c.text, /^hsl\(0,/);
  });

  test('sin catColor → paleta decorativa por dorsal (retrocompatible)', () => {
    // El dorsal 7 debe seguir dando exactamente el color de siempre.
    const legacy = _enKartColor('7');
    assert.ok(legacy && legacy.bg && legacy.text && legacy.border);
    // Y NO debe ser un hsl() (el acento de categoría); la paleta es hex fijo.
    assert.doesNotMatch(legacy.text, /^hsl\(/);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
