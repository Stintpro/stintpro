// StintPro — tiempo oficial por piloto ([h:mm] de Apex) y emparejamiento con
// los pilotos del setup (en-driver-time.js)
// Ejecutar: node tests/driver-time.test.js
'use strict';

const { strictEqual, deepStrictEqual } = require('assert');
const D = require('../src/en-driver-time');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const pilotos = [{ name: 'Alex' }, { name: 'David de la Osa' }, { name: 'Íñigo Peña' }];

console.log('\n▸ Emparejar el nombre de Apex con el piloto del setup\n');

test('nombre idéntico salvo mayúsculas, acentos y espacios', () => {
  strictEqual(D.matchPilot('INIGO  PENA', pilotos), 2);
});

test('el setup lleva solo el nombre de pila y Apex nombre y apellido', () => {
  strictEqual(D.matchPilot('ALEX LOPEZ', pilotos), 0);
});

test('Apex abrevia y el setup lleva el nombre completo', () => {
  strictEqual(D.matchPilot('DAVID OSA', [{ name: 'David Osa Martín' }]), 0);
});

test('ambiguo (dos pilotos encajan) → -1, mejor no adivinar', () => {
  strictEqual(D.matchPilot('ALEX LOPEZ', [{ name: 'Alex' }, { name: 'Lopez' }]), -1);
});

test('nadie encaja → -1', () => {
  strictEqual(D.matchPilot('MARTA RUIZ', pilotos), -1);
});

test('sin nombre de Apex → -1', () => {
  strictEqual(D.matchPilot(null, pilotos), -1);
});

console.log('\n▸ Minutos oficiales por piloto del setup\n');

const kart = {
  driver: 'ALEX LOPEZ', driverMin: 12,
  drivers: [{ name: 'DAVID DE LA OSA', min: 60 }, { name: 'ALEX LOPEZ', min: 12 }, { name: 'PEPE', min: 5 }],
};

test('reparte los minutos de Apex entre los pilotos del setup', () => {
  deepStrictEqual(D.officialByPilot(kart, pilotos).minutes, [12, 60, null]);
});

test('el piloto en pista según Apex', () => {
  strictEqual(D.officialByPilot(kart, pilotos).currentIdx, 0);
});

test('los que Apex conoce pero no están en el setup se devuelven aparte', () => {
  deepStrictEqual(D.officialByPilot(kart, pilotos).unmatched, [{ name: 'PEPE', min: 5 }]);
});

test('kart sin tiempo oficial (sprint, otro cronometraje) → nada', () => {
  deepStrictEqual(D.officialByPilot({ drivers: [] }, pilotos), { minutes: [null, null, null], currentIdx: -1, unmatched: [] });
  deepStrictEqual(D.officialByPilot(null, pilotos), { minutes: [null, null, null], currentIdx: -1, unmatched: [] });
});

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
