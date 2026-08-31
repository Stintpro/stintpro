// StintPro — tests del detector de CSS muerto (tools/find-dead-css.js)
// Ejecutar: node tests/dead-css.test.js
'use strict';

const { strictEqual, deepStrictEqual } = require('assert/strict');
const { classesInSelector, isUsed } = require('../tools/find-dead-css');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}
function group(name, fn) { console.log('\n' + name); fn(); }

group('classesInSelector', () => {
  test('saca una clase suelta', () => {
    deepStrictEqual(classesInSelector('.perf-cell'), ['perf-cell']);
  });
  test('saca las dos clases de un selector compuesto', () => {
    deepStrictEqual(classesInSelector('.grid2 .field'), ['grid2', 'field']);
  });
  test('ignora la pseudoclase', () => {
    deepStrictEqual(classesInSelector('.timing-row:nth-child(odd)'), ['timing-row']);
  });
  test('ignora id y etiqueta', () => {
    deepStrictEqual(classesInSelector('#screen-dash .card'), ['card']);
  });
  test('separa una lista de selectores', () => {
    deepStrictEqual(classesInSelector('.a, .b'), ['a', 'b']);
  });
});

group('isUsed', () => {
  test('la encuentra en un class= de comillas dobles', () => {
    strictEqual(isUsed('card', '<div class="card">'), true);
  });
  test('la encuentra junto a otras clases', () => {
    strictEqual(isUsed('card', '<div class="box card active">'), true);
  });
  test('la encuentra en classList', () => {
    strictEqual(isUsed('active', "el.classList.add('active')"), true);
  });
  test('la encuentra en una plantilla de string', () => {
    strictEqual(isUsed('kpi', 'html += `<div class="kpi">`'), true);
  });
  test('NO confunde un prefijo con la clase', () => {
    strictEqual(isUsed('card', '<div class="card-body">'), false);
  });
  test('NO confunde un sufijo con la clase', () => {
    strictEqual(isUsed('body', '<div class="card-body">'), false);
  });
  test('devuelve false si no aparece', () => {
    strictEqual(isUsed('perf-cell', '<div class="otra-cosa">'), false);
  });
});

console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
