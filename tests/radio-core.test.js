// StintPro — lógica de la radio web móvil (radio-core.js).
// Ejecutar: node tests/radio-core.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert');
const R = require('../src/radio-core');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const INF = { team: 'EQ', drivers: [{ name: 'ANA', current: false }, { name: 'LUIS', current: true }] };
const APEX = { pilotos: ['ANA', 'LUIS'], current: 1 };
const PANEL = { pilotos: ['Javier', 'Pablo'], current: 0, source: 'panel', panel: true };

console.log('\nPlantilla de Apex');
test('rosterFromInf: nombres y piloto en pista', () => {
  deepStrictEqual(R.rosterFromInf(INF), APEX);
});
test('rosterFromInf: sin pilotos o null → null', () => {
  strictEqual(R.rosterFromInf({ team: 'X', drivers: [] }), null);
  strictEqual(R.rosterFromInf(null), null);
});
test('rosterFromInf: recorta a 10 pilotos y 40 caracteres; sin current → null', () => {
  const r = R.rosterFromInf({ drivers: Array.from({ length: 12 }, (_, i) => ({ name: 'P'.repeat(45) + i, current: false })) });
  strictEqual(r.pilotos.length, 10);
  ok(r.pilotos.every(p => p.length === 40));
  strictEqual(r.current, null);
});

console.log('\nQué lista usa la web');
test('panel conectado → lista del panel, sin publicar', () => {
  deepStrictEqual(R.chooseRoster(PANEL, APEX), { mode: 'panel', pilotos: ['Javier', 'Pablo'], current: 0, publish: false });
});
test('sin lista en el servidor y con Apex → publica la de Apex', () => {
  deepStrictEqual(R.chooseRoster(null, APEX), { mode: 'radio', pilotos: ['ANA', 'LUIS'], current: 1, publish: true });
  deepStrictEqual(R.chooseRoster({ pilotos: null, current: null, source: null, panel: false }, APEX).publish, true);
});
test('lista radio igual a la de Apex → no republica; distinta → sí', () => {
  strictEqual(R.chooseRoster({ ...APEX, source: 'radio', panel: false }, APEX).publish, false);
  strictEqual(R.chooseRoster({ pilotos: ['ANA', 'LUIS'], current: 0, source: 'radio', panel: false }, APEX).publish, true);
});
test('panel desconectado y Apex → se queda con la lista del panel, sin publicar (nunca la reemplaza)', () => {
  deepStrictEqual(R.chooseRoster({ ...PANEL, panel: false }, APEX), { mode: 'panel', pilotos: ['Javier', 'Pablo'], current: 0, publish: false });
});
test('panel desconectado sin Apex → se queda con la del panel, sin publicar', () => {
  deepStrictEqual(R.chooseRoster({ ...PANEL, panel: false }, null), { mode: 'panel', pilotos: ['Javier', 'Pablo'], current: 0, publish: false });
});
test('nada de nada → modo dorsal', () => {
  deepStrictEqual(R.chooseRoster(null, null), { mode: 'dorsal', pilotos: [], current: null, publish: false });
});

console.log('\nDestinatario');
const ROS = { mode: 'radio', pilotos: ['ANA', 'LUIS'], current: 1, publish: false };
test('pickTarget: sin elección → el que va en pista; elección válida → esa', () => {
  strictEqual(R.pickTarget(null, ROS), 1);
  strictEqual(R.pickTarget(0, ROS), 0);
  strictEqual(R.pickTarget(5, ROS), 1);
  strictEqual(R.pickTarget(0, { mode: 'dorsal', pilotos: [], current: null }), null);
});
test('keepPick: se descarta si cambia el piloto en pista o la lista', () => {
  strictEqual(R.keepPick(0, ROS, { ...ROS }), 0);
  strictEqual(R.keepPick(0, ROS, { ...ROS, current: 0 }), null);
  strictEqual(R.keepPick(0, ROS, { ...ROS, pilotos: ['ANA', 'EVA'] }), null);
  strictEqual(R.keepPick(null, ROS, ROS), null);
});

console.log('\nMensajes al servidor');
test('rosterMessage: lista de la radio', () => {
  deepStrictEqual(R.rosterMessage('henakart', 7, ROS),
    { type: 'team_roster', slug: 'henakart', dorsal: '7', pilotos: ['ANA', 'LUIS'], current: 1, source: 'radio' });
});
test('teamMessage: con lista lleva pilot; en modo dorsal, no', () => {
  deepStrictEqual(R.teamMessage({ slug: 'h', dorsal: 7, roster: ROS, target: 1, text: ' BOX ', tone: 'red', id: 'a' }),
    { type: 'team_msg', slug: 'h', dorsal: '7', text: 'BOX', tone: 'red', id: 'a', pilot: 1 });
  deepStrictEqual(R.teamMessage({ slug: 'h', dorsal: '7', roster: { mode: 'dorsal', pilotos: [], current: null }, target: null, text: 'BOX', tone: 'blue', id: 'b' }),
    { type: 'team_msg', slug: 'h', dorsal: '7', text: 'BOX', tone: 'blue', id: 'b' });
});
test('teamMessage: vacío, largo, sin destinatario o tono raro', () => {
  strictEqual(R.teamMessage({ slug: 'h', dorsal: '7', roster: ROS, target: 1, text: '  ', tone: 'red' }).error, 'Mensaje vacío');
  strictEqual(R.teamMessage({ slug: 'h', dorsal: '7', roster: ROS, target: 1, text: 'X'.repeat(41), tone: 'red' }).error, 'Máximo 40 caracteres');
  strictEqual(R.teamMessage({ slug: 'h', dorsal: '7', roster: { ...ROS, current: null }, target: null, text: 'BOX', tone: 'red' }).error, 'Elige a quién va');
  strictEqual(R.teamMessage({ slug: 'h', dorsal: '7', roster: ROS, target: 1, text: 'BOX', tone: 'verde' }).tone, 'orange');
});

console.log('\nResultado, anti-repetición y reconexión');
test('resultLabel', () => {
  deepStrictEqual(R.resultLabel({ delivered: 1 }, 'LUIS', '7'), { ok: true, text: 'Entregado a LUIS ✓' });
  deepStrictEqual(R.resultLabel({ delivered: 0 }, 'LUIS', '7'), { ok: false, text: 'No entregado: LUIS sin móvil conectado' });
  deepStrictEqual(R.resultLabel({ delivered: 2 }, null, '7'), { ok: true, text: 'Entregado a 2 móviles del #7 ✓' });
  deepStrictEqual(R.resultLabel({ delivered: 1 }, null, '7'), { ok: true, text: 'Entregado a 1 móvil del #7 ✓' });
  deepStrictEqual(R.resultLabel({ delivered: 0 }, null, '7'), { ok: false, text: 'No entregado: ningún móvil conectado en el #7' });
});
test('createCooldown: bloquea el mismo mensaje 2 s, no los demás', () => {
  const c = R.createCooldown();
  ok(c.tryFire('BOX', 1000));
  ok(!c.tryFire('BOX', 2999));
  ok(c.tryFire('PUSH', 2999));
  ok(c.tryFire('BOX', 3000));
});
test('reconnectDelay: 1 s, 2 s y luego 5 s', () => {
  deepStrictEqual([0, 1, 2, 3, 9].map(R.reconnectDelay), [1000, 2000, 5000, 5000, 5000]);
});

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
