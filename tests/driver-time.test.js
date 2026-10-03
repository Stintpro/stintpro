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

console.log('\n▸ Adoptar al piloto de Apex cuando no está en el setup\n');

test('setup por defecto (Piloto 1..3): el nombre de Apex ocupa el primer hueco', () => {
  const ps = [{ name: 'Piloto 1', minutos: 90 }, { name: 'Piloto 2', minutos: 90 }, { name: 'Piloto 3', minutos: 90 }];
  strictEqual(D.adoptPilot('ALEJANDRO FLORIDO', ps), 0);
  strictEqual(ps[0].name, 'ALEJANDRO FLORIDO');
  strictEqual(ps[0].minutos, 90);
});

test('si ya encaja con uno del setup no se toca la lista', () => {
  const ps = [{ name: 'Alex' }, { name: 'Piloto 2' }];
  strictEqual(D.adoptPilot('ALEX LOPEZ', ps), 0);
  deepStrictEqual(ps, [{ name: 'Alex' }, { name: 'Piloto 2' }]);
});

test('un hueco de relleno con stints a su nombre no se pisa', () => {
  const ps = [{ name: 'Piloto 1' }, { name: 'Piloto 2' }];
  strictEqual(D.adoptPilot('FRAN RAMÍREZ', ps, new Set([0])), 1);
  strictEqual(ps[0].name, 'Piloto 1');
});

test('sin huecos de relleno se añade al final; lista llena (10) → -1', () => {
  const ps = [{ name: 'Ana', minutos: 60 }];
  strictEqual(D.adoptPilot('FRAN RAMÍREZ', ps), 1);
  deepStrictEqual(ps[1], { name: 'FRAN RAMÍREZ', minutos: 60 });
  const full = Array.from({ length: 10 }, (_, i) => ({ name: 'Nombre' + String.fromCharCode(65 + i) }));
  strictEqual(D.adoptPilot('OTRO MAS', full), -1);
  strictEqual(full.length, 10);
});

test('los tres pilotos de un equipo real acaban cada uno en su hueco', () => {
  const ps = [{ name: 'Piloto 1' }, { name: 'Piloto 2' }, { name: 'Piloto 3' }];
  const idx = ['ALEJANDRO FLORIDO', 'ALEJANDRO RUIZ-CABELLO', 'FRAN RAMÍREZ', 'ALEJANDRO FLORIDO'].map(n => D.adoptPilot(n, ps));
  deepStrictEqual(idx, [0, 1, 2, 0]);
});

test('sin nombre → -1 y lista intacta', () => {
  const ps = [{ name: 'Piloto 1' }];
  strictEqual(D.adoptPilot(null, ps), -1);
  strictEqual(ps[0].name, 'Piloto 1');
});

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
