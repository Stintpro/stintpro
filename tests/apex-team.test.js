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

test('historial de varios karts en una petición: una sola D inicial', () => {
  strictEqual(A.lapsRequest(['70', '71', '72']), 'D#-999#D70.L#-999#D71.L#-999#D72.L');
});

test('historial por kart: en orden de vuelta, solo válidas y sin marcas', () => {
  const by = A.parseLapsById(RESP + '\nD71.L0002#|||p61500\nD71.L0001#|||15000\nD71.L0003#|||62000');
  deepStrictEqual(by['70'], [85, 231, 83.9, 84.2, 230, 83.5, 84]);
  deepStrictEqual(by['71'], [61.5, 62]);          // la de 15 s no es una vuelta
  deepStrictEqual(A.parseLapsById('error'), {});
});

test('respuesta vacía o de error → nada, sin romper', () => {
  const e = A.build('error');
  deepStrictEqual([e.drivers, e.stints, e.totals, e.stops, e.current], [[], [], {}, 0, null]);
});

console.log('\n▸ Stint en curso oficial (ancla del KPI «Tiempo de stint»)\n');

// Equipo 71: 2 paradas cerradas; salió del box en el ms 750000 de la sesión.
const RESP_PISTA = [
  'D71.L0007#|||84000',
  'D71.L0006#|||83500',
  'D71.L0005#|||230000',                 // vuelta de salida del box (150 s de parada dentro)
  'D71.L0004#|||84200',
  'D71.L0003#|||83900',
  'D71.L0002#|||231000',
  'D71.L0001#|||85000',
  '',
  'D71.P02#2|4|600000|750000|150000|170000|2|11|170000',
  'D71.P01#1|1|280000|430000|150000|280000|1|12|280000',
].join('\n');
const H = 3600000, NOW = 1790000000000;
const reloj = rem => ({ synced: true, countUp: false, remainingMs: rem });

test('build: stint en curso = salida de la última parada + vueltas desde entonces', () => {
  const cur = A.build(RESP_PISTA).cur;
  strictEqual(cur.outMs, 750000);
  strictEqual(cur.durMs, 150000);
  deepStrictEqual(cur.laps, [230000, 83500, 84000]);
});

test('build: con el kart aún en el box (parada sin salida) no hay stint en curso', () => {
  strictEqual(A.build(RESP).cur, null);
  strictEqual(A.build('').cur, null);
});

test('con la duración configurada: arranque = salida oficial del box', () => {
  // Carrera de 2 h; van 1.000.000 ms de sesión → el stint lleva 250 s.
  const cur = A.build(RESP_PISTA).cur;
  strictEqual(A.currentStintStart(cur, reloj(2 * H - 1000000), 2 * H, NOW), NOW - 250000);
});

test('sin duración configurada: la deduce del reloj y de las vueltas del stint', () => {
  // Mismo instante, sin decir que la carrera dura 2 h.
  const cur = A.build(RESP_PISTA).cur;
  strictEqual(A.currentStintStart(cur, reloj(2 * H - 1000000), 0, NOW), NOW - 250000);
  // Carrera de 30 h (dato real de Campillos: la cuenta atrás cuadra a 0,4 s).
  strictEqual(A.currentStintStart(cur, reloj(30 * H - 1000000 - 400), 0, NOW), NOW - 250400);
});

test('recién salido del box (sin vueltas aún) también se ancla', () => {
  const cur = { outMs: 750000, durMs: 150000, laps: [], refLapMs: 84000 };
  strictEqual(A.currentStintStart(cur, reloj(2 * H - 790000), 0, NOW), NOW - 40000);
});

test('un reloj que no cuadra con las vueltas del stint → null (no se toca el KPI)', () => {
  const cur = A.build(RESP_PISTA).cur;
  // Según este reloj el stint llevaría solo 100 s, pero ya hay 167,5 s de vueltas completas.
  strictEqual(A.currentStintStart(cur, reloj(2 * H - 850000), 2 * H, NOW), null);
  // Sin duración: ningún múltiplo de 5 min encaja con las vueltas (el reloj es de otra cosa).
  strictEqual(A.currentStintStart(cur, reloj(2 * H - 1000000 - 150000), 0, NOW), null);
});

test('reloj ascendente, sin sincronizar o a cero → null', () => {
  const cur = A.build(RESP_PISTA).cur;
  strictEqual(A.currentStintStart(cur, { synced: true, countUp: true, remainingMs: 1000000 }, 0, NOW), null);
  strictEqual(A.currentStintStart(cur, { synced: false, countUp: false, remainingMs: null }, 2 * H, NOW), null);
  strictEqual(A.currentStintStart(cur, reloj(0), 2 * H, NOW), null);
  strictEqual(A.currentStintStart(cur, null, 2 * H, NOW), null);
  strictEqual(A.currentStintStart(null, reloj(2 * H - 1000000), 2 * H, NOW), null);
});

test('vueltas muy largas (ventana ≥ 5 min): duración ambigua → null si no está configurada', () => {
  const cur = { outMs: 750000, durMs: 150000, laps: [400000, 240000], refLapMs: 240000 };
  strictEqual(A.currentStintStart(cur, reloj(2 * H - 1300000), 0, NOW), null);
  strictEqual(A.currentStintStart(cur, reloj(2 * H - 1300000), 2 * H, NOW), NOW - 550000);
});

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
