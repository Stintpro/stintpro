// StintPro — plantilla y stints oficiales de mi equipo desde request.php de Apex
// (en-apex-team.js). Respuesta con el formato real (.L/.P/.INF), nombres inventados.
// Ejecutar: node tests/apex-team.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert');
const A = require('../src/en-apex-team');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

// Equipo 70: 3 inscritos (uno sin rodar), 2 paradas cerradas y una en curso.
const RESP = [
  'D70.L0007#27000|35000|22000|84000',
  'D70.L0006#27100|35100|22100|p83500',
  'D70.L0005#|||230000',                 // vuelta de salida del box (lleva la parada dentro)
  'D70.L0004#27000|35000|22000|84200',
  'D70.L0003#27000|35000|22000|g83900',
  'D70.L0002#|||231000',                 // vuelta de salida del box
  'D70.L0001#27000|35000|22000|85000',
  '',
  'D70.P03#3|7|900000|||200000|2|12|480000',
  'D70.P02#2|4|600000|750000|150000|170000|2|11|170000',
  'D70.P01#1|1|280000|430000|150000|280000|1|12|280000',
  '',
  'D70.INF#<driver  id="70" member="0" center="5" num="7" name="EQUIPO UNO " nat="ESP"><driver  id="10" member="0" num="1" name="RESERVA SIN RODAR" nat="" color="#000000"/><driver  id="11" member="0" num="2" name="ANA  LÓPEZ" nat="" color="#000000" current="1"/><driver  id="12" member="0" num="3" name="LUIS PÉREZ" nat="" color="#000000"/></driver>',
].join('\n');

console.log('\n▸ Leer la respuesta de Apex\n');

test('petición encadenada: una sola D inicial', () => {
  strictEqual(A.requestFor('70'), 'D#-999#D70.L#-999#D70.P#1#D70.INF');
});

test('.INF: equipo, plantilla completa y piloto en pista', () => {
  const inf = A.parseInf(RESP);
  strictEqual(inf.team, 'EQUIPO UNO');
  deepStrictEqual(inf.drivers.map(d => d.name), ['RESERVA SIN RODAR', 'ANA LÓPEZ', 'LUIS PÉREZ']);
  deepStrictEqual(inf.drivers.filter(d => d.current).map(d => d.id), ['11']);
});

test('.P: paradas en orden, con la que sigue abierta sin salida', () => {
  const p = A.parsePits(RESP);
  deepStrictEqual(p.map(x => x.n), [1, 2, 3]);
  deepStrictEqual([p[1].inMs, p[1].outMs, p[1].durMs, p[1].stintMs, p[1].stintLaps, p[1].driverId, p[1].driverTotalMs],
    [600000, 750000, 150000, 170000, 2, '11', 170000]);
  strictEqual(p[2].outMs, null);
});

test('.L: vueltas por número, sin las marcas de mejor vuelta', () => {
  const l = A.parseLaps(RESP);
  deepStrictEqual(l.map(x => x.n), [1, 2, 3, 4, 5, 6, 7]);
  deepStrictEqual([l[2].ms, l[5].ms], [83900, 83500]);
});

console.log('\n▸ Lo que usa «Mi equipo»\n');

const d = A.build(RESP);

test('plantilla con el que no ha rodado y piloto en pista', () => {
  deepStrictEqual(d.drivers, ['RESERVA SIN RODAR', 'ANA LÓPEZ', 'LUIS PÉREZ']);
  strictEqual(d.current, 'ANA LÓPEZ');
  strictEqual(d.stops, 3);
});

test('un stint cerrado por parada, con su piloto, duración y parada', () => {
  deepStrictEqual(d.stints.map(s => [s.pilot, s.durationMs, s.laps, s.pitStopMs]),
    [['LUIS PÉREZ', 280000, 1, 150000], ['ANA LÓPEZ', 170000, 2, 150000], ['LUIS PÉREZ', 200000, 2, null]]);
});

test('las vueltas de cada stint no incluyen la de salida del box', () => {
  deepStrictEqual(d.stints[0].lapTimes, [85]);
  deepStrictEqual(d.stints[1].lapTimes, [83.9, 84.2]);
  deepStrictEqual(d.stints[2].lapTimes, [83.5, 84]);
  strictEqual(d.stints[1].best, 83.9);
});

test('tiempo acumulado exacto por piloto = el de su último stint cerrado', () => {
  deepStrictEqual(d.totals, { 'LUIS PÉREZ': 480000, 'ANA LÓPEZ': 170000 });
  ok(!('RESERVA SIN RODAR' in d.totals));
});

test('respuesta vacía o de error → nada, sin romper', () => {
  const e = A.build('error');
  deepStrictEqual([e.drivers, e.stints, e.totals, e.stops, e.current], [[], [], {}, 0, null]);
});

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
