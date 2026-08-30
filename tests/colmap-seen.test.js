// StintPro — tests de mergeColMap: colMap vacío conserva, colMap completo sustituye
// Ejecutar: node tests/colmap-seen.test.js
'use strict';

const { deepStrictEqual } = require('assert/strict');
const { mergeColMap } = require('../src/en-columns');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

console.log('\nmergeColMap');

test('sin previo, devuelve el nuevo', () => {
  deepStrictEqual(mergeColMap(null, { rk: 'c1' }), { rk: 'c1' });
});

test('un colMap vacío NO borra lo ya visto (reconexión a mitad de carrera)', () => {
  deepStrictEqual(mergeColMap({ rk: 'c1', lc: 'c6' }, {}), { rk: 'c1', lc: 'c6' });
});

test('colMap undefined tampoco borra nada', () => {
  deepStrictEqual(mergeColMap({ lc: 'c6' }, undefined), { lc: 'c6' });
});

test('un colMap no vacío sustituye entero, no se mezcla con el anterior', () => {
  deepStrictEqual(mergeColMap({ rk: 'c1' }, { lc: 'c6' }), { lc: 'c6' });
});

test('si Apex reordena el grid, gana la posición nueva', () => {
  deepStrictEqual(mergeColMap({ lc: 'c6' }, { lc: 'c9' }), { lc: 'c9' });
});

test('cambio de sesión con menos dtypes deja SOLO los nuevos (no arrastra los de la sesión anterior)', () => {
  deepStrictEqual(
    mergeColMap({ rk: 'c1', no: 'c2', dr: 'c3', llp: 'c4', blp: 'c5', gap: 'c6', int: 'c7', lc: 'c8', pit: 'c9' }, { rk: 'c1', no: 'c2', dr: 'c3' }),
    { rk: 'c1', no: 'c2', dr: 'c3' }
  );
});

console.log(`\n${passed} pasados, ${failed} fallados`);
process.exit(failed ? 1 : 0);
