// StintPro — tests del registro de columnas (src/en-columns.js)
// Ejecutar: node tests/columns.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert/strict');
const { COLUMNS, isAvailable } = require('../src/en-columns');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}
function group(name, fn) { console.log('\n' + name); fn(); }

function col(id) {
  const c = COLUMNS.find(x => x.id === id);
  if (!c) throw new Error(`columna '${id}' no existe en el catálogo`);
  return c;
}

group('catálogo', () => {
  test('tiene 15 columnas (las 14 de hoy + Clase)', () => {
    strictEqual(COLUMNS.length, 15);
  });

  test('los ids son únicos', () => {
    strictEqual(new Set(COLUMNS.map(c => c.id)).size, COLUMNS.length);
  });

  test('el orden reproduce el de la tabla actual, con Clase tras Equipo', () => {
    deepStrictEqual(COLUMNS.map(c => c.id), [
      'dot', 'pos', 'kart', 'driver', 'team', 'class', 'tours',
      'last', 'best', 'm5v', 'delta', 'gap', 'int', 'score', 'pit',
    ]);
  });

  test('toda columna tiene ancho en los dos breakpoints', () => {
    COLUMNS.forEach(c => {
      ok(c.width, `${c.id} sin width`);
      ok(c.widthNarrow, `${c.id} sin widthNarrow`);
    });
  });

  test('toda columna sabe pintarse', () => {
    COLUMNS.forEach(c => strictEqual(typeof c.cell, 'function', `${c.id} sin cell`));
  });

  test('dot, pos, kart y driver son fijas', () => {
    deepStrictEqual(COLUMNS.filter(c => c.fixed).map(c => c.id),
      ['dot', 'pos', 'kart', 'driver']);
  });

  test('Clase es la única que no entra por defecto', () => {
    deepStrictEqual(COLUMNS.filter(c => c.default === false).map(c => c.id), ['class']);
  });
});

group('isAvailable', () => {
  test('sin requires, siempre disponible (aunque colMap esté vacío)', () => {
    strictEqual(isAvailable(col('m5v'), {}), true);
    strictEqual(isAvailable(col('team'), {}), true);
    strictEqual(isAvailable(col('score'), {}), true);
  });

  test('Vueltas necesita la columna oficial de Apex: lc', () => {
    strictEqual(isAvailable(col('tours'), { lc: 'c6' }), true);
  });

  test('Vueltas también vale con tlp', () => {
    strictEqual(isAvailable(col('tours'), { tlp: 'c6' }), true);
  });

  test('Vueltas NO está disponible sin lc ni tlp — el bug del dato inventado', () => {
    strictEqual(isAvailable(col('tours'), { rk: 'c1', no: 'c2', dr: 'c3' }), false);
  });

  test('Gap, Int, Mejor, Última y Pit dependen de su dtype', () => {
    strictEqual(isAvailable(col('gap'),  { gap: 'c9' }), true);
    strictEqual(isAvailable(col('gap'),  {}), false);
    strictEqual(isAvailable(col('int'),  { int: 'c10' }), true);
    strictEqual(isAvailable(col('int'),  {}), false);
    strictEqual(isAvailable(col('best'), { blp: 'c8' }), true);
    strictEqual(isAvailable(col('best'), {}), false);
    strictEqual(isAvailable(col('last'), { llp: 'c7' }), true);
    strictEqual(isAvailable(col('last'), {}), false);
    strictEqual(isAvailable(col('pit'),  { pit: 'c11' }), true);
    strictEqual(isAvailable(col('pit'),  {}), false);
  });

  test('Clase depende del dtype class', () => {
    strictEqual(isAvailable(col('class'), { class: 'c4' }), true);
    strictEqual(isAvailable(col('class'), {}), false);
  });

  test('el punto de estado no depende de grp/sta (el parser deduce el estado sin ellas)', () => {
    strictEqual(isAvailable(col('dot'), {}), true);
  });

  test('colMap undefined no revienta', () => {
    strictEqual(isAvailable(col('tours'), undefined), false);
    strictEqual(isAvailable(col('m5v'), undefined), true);
  });
});

console.log(`\n${passed} pasados, ${failed} fallados`);
process.exit(failed ? 1 : 0);
