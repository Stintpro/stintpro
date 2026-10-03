// StintPro — «Configuración de carrera» (en-race-config.js): leer el estado,
// validar lo tecleado, avisos de coherencia y filas de la confirmación.
// Ejecutar: node tests/race-config.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert');
const C = require('../src/en-race-config');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const cfg = { stintMin: 10, stintMax: 60, duration: 30, myDorsal: ' 2 ', pilotos: [{ name: 'Ana', minutos: 90 }, { name: 'Luis', minutos: 90 }] };
const box = { totalStops: 29, pitDuration: 150, pilotMinTime: 240, config: { type: 'line', positions: 4, columns: 2 } };
const cur = C.read(cfg, box);

console.log('\n▸ Leer el estado actual\n');

test('junta lo de AppState.config y lo de EnBox', () => {
  deepStrictEqual(cur, { stintMin: 10, stintMax: 60, totalStops: 29, pitDuration: 150, pilotMinTime: 240, duration: 30,
    boxType: 'line', boxPositions: 4, boxColumns: 2, myDorsal: '2', pilotos: ['Ana', 'Luis'] });
});

test('estado vacío → valores de respaldo, sin romper', () => {
  const v = C.read(null, null);
  deepStrictEqual([v.pitDuration, v.boxType, v.boxPositions, v.pilotos], [120, 'line', 4, []]);
});

console.log('\n▸ Validar lo tecleado\n');

test('números como texto, coma decimal y límites', () => {
  const v = C.normalize({ stintMin: '15', stintMax: '70', totalStops: '31', pitDuration: '5', pilotMinTime: '', duration: '7,5',
    boxType: 'columns', boxPositions: '99', boxColumns: '3', myDorsal: ' 12 ', pilotos: ['Ana', 'Luis'] }, cur);
  deepStrictEqual([v.stintMin, v.stintMax, v.totalStops, v.pitDuration, v.pilotMinTime, v.duration], [15, 70, 31, 30, 240, 7.5]);
  deepStrictEqual([v.boxType, v.boxPositions, v.boxColumns, v.myDorsal], ['columns', 20, 3, '12']);
});

test('campo vacío o ilegible conserva el valor actual', () => {
  const v = C.normalize({ stintMin: 'abc', myDorsal: '', boxType: 'otro', pilotos: ['Ana', 'Luis'] }, cur);
  deepStrictEqual([v.stintMin, v.stintMax, v.myDorsal, v.boxType], [10, 60, '2', 'line']);
});

test('pilotos: renombrar conserva la posición; vacío mantiene el nombre', () => {
  const v = C.normalize({ pilotos: ['  Ana   María ', ''] }, cur);
  deepStrictEqual(v.pilotos, ['Ana María', 'Luis']);
});

test('pilotos: se añaden al final, los vacíos nuevos se descartan y hay tope de 10', () => {
  deepStrictEqual(C.normalize({ pilotos: ['Ana', 'Luis', 'Eva', ''] }, cur).pilotos, ['Ana', 'Luis', 'Eva']);
  const many = Array.from({ length: 14 }, (_, i) => 'P' + i);
  strictEqual(C.normalize({ pilotos: many }, cur).pilotos.length, 10);
});

console.log('\n▸ Avisos y confirmación\n');

test('stint mínimo mayor que el máximo → aviso', () => {
  ok(C.warnings({ ...cur, stintMin: 65 }).some(w => /mínimo es mayor/.test(w)));
  strictEqual(C.warnings(cur).length, 0);
});

test('paradas insuficientes para cubrir la carrera → aviso', () => {
  ok(C.warnings({ ...cur, totalStops: 10 }).some(w => /no se cubre/.test(w)));
  strictEqual(C.warnings({ ...cur, stintMax: 999, totalStops: 1 }).length, 0);   // sin límite de stint
});

test('la confirmación lista todos los datos y marca solo los que cambian', () => {
  const next = C.normalize({ stintMax: '75', pilotos: ['Ana', 'Luis', 'Eva'] }, cur);
  const rows = C.review(cur, next);
  deepStrictEqual(rows.filter(r => r.changed).map(r => r.key), ['stintMax', 'pilotos']);
  const sm = rows.find(r => r.key === 'stintMax');
  deepStrictEqual([sm.from, sm.to], ['60 min', '75 min']);
  ok(!rows.some(r => r.key === 'boxColumns'));          // box en línea: las columnas no cuentan
  ok(C.review(cur, { ...next, boxType: 'columns' }).some(r => r.key === 'boxColumns'));
});

test('sin cambios → ninguna fila marcada', () => {
  strictEqual(C.review(cur, C.normalize({ pilotos: ['Ana', 'Luis'] }, cur)).filter(r => r.changed).length, 0);
});

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
