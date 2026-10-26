// StintPro — núcleo de los mensajes al piloto en pista (en-pilot-link-core.js).
// Ejecutar: node tests/pilot-link.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert');
const C = require('../src/en-pilot-link-core');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const CFG = { slug: 'campillos', myDorsal: 17, pilotos: [{ name: ' Javier ' }, { name: 'Pablo' }] };

console.log('\nMensajes rápidos');
test('13 mensajes en el orden acordado, Box primero y bandera azul en azul', () => {
  strictEqual(C.QUICK_MESSAGES.length, 13);
  deepStrictEqual(C.QUICK_MESSAGES.slice(0, 4).map(m => m.text), ['BOX', 'BOX PRÓXIMA', 'NO ENTRES', 'UNA VUELTA MÁS']);
  ok(C.QUICK_MESSAGES.slice(0, 4).every(m => m.tone === 'red'));
  deepStrictEqual(C.QUICK_MESSAGES.find(m => m.text === 'BANDERA AZUL'), { text: 'BANDERA AZUL', tone: 'blue' });
  ok(C.QUICK_MESSAGES.every(m => m.text.length <= C.MAX_TEXT));
});

console.log('\nLista de pilotos');
test('construye la lista con el piloto en pista', () => {
  deepStrictEqual(C.buildRoster(CFG, { currentPilot: 1 }),
    { type: 'team_roster', slug: 'campillos', dorsal: '17', pilotos: ['Javier', 'Pablo'], current: 1 });
});
test('sin slug, dorsal o pilotos → null', () => {
  strictEqual(C.buildRoster({ ...CFG, slug: '' }, { currentPilot: 0 }), null);
  strictEqual(C.buildRoster({ ...CFG, myDorsal: '' }, { currentPilot: 0 }), null);
  strictEqual(C.buildRoster({ ...CFG, pilotos: [] }, { currentPilot: 0 }), null);
});
test('nombre vacío → «Piloto N»; recorta a 10 pilotos y 40 caracteres', () => {
  const r = C.buildRoster({ ...CFG, pilotos: [{ name: '' }, { name: 'X'.repeat(50) }, ...Array(12).fill({ name: 'Y' })] }, { currentPilot: 0 });
  strictEqual(r.pilotos.length, 10);
  strictEqual(r.pilotos[0], 'Piloto 1');
  strictEqual(r.pilotos[1].length, 40);
});
test('currentPilot fuera de rango → null', () => {
  strictEqual(C.buildRoster(CFG, { currentPilot: 5 }).current, null);
  strictEqual(C.buildRoster(CFG, {}).current, null);
});
test('la firma cambia solo si cambia la lista', () => {
  const a = C.rosterSignature(C.buildRoster(CFG, { currentPilot: 0 }));
  strictEqual(a, C.rosterSignature(C.buildRoster(CFG, { currentPilot: 0 })));
  ok(a !== C.rosterSignature(C.buildRoster(CFG, { currentPilot: 1 })));
  strictEqual(C.rosterSignature(null), '');
});

console.log('\nMensaje');
const R = C.buildRoster(CFG, { currentPilot: 0 });
test('mensaje al piloto en pista', () => {
  deepStrictEqual(C.buildTeamMsg(R, ' BOX ', 'red', 'm-1'),
    { type: 'team_msg', slug: 'campillos', dorsal: '17', text: 'BOX', tone: 'red', pilot: 0, id: 'm-1' });
});
test('tono desconocido → naranja', () => {
  strictEqual(C.buildTeamMsg(R, 'hola', 'verde', 'm').tone, 'orange');
});
test('errores: sin lista, nadie en pista, vacío, >40', () => {
  ok(C.buildTeamMsg(null, 'BOX', 'red', 'm').error);
  ok(/pista/i.test(C.buildTeamMsg({ ...R, current: null }, 'BOX', 'red', 'm').error));
  ok(C.buildTeamMsg(R, '   ', 'red', 'm').error);
  ok(C.buildTeamMsg(R, 'X'.repeat(41), 'red', 'm').error);
});
test('nombre del piloto en pista', () => {
  strictEqual(C.currentPilotName(R), 'Javier');
  strictEqual(C.currentPilotName({ ...R, current: null }), null);
  strictEqual(C.currentPilotName(null), null);
});

console.log('\nEntrega');
test('etiquetas de entregado / no entregado', () => {
  deepStrictEqual(C.deliveryLabel({ delivered: 1 }, 'Javier'), { ok: true, text: 'Entregado a Javier' });
  deepStrictEqual(C.deliveryLabel({ delivered: 0 }, 'Javier'), { ok: false, text: 'No entregado: Javier no tiene el móvil conectado' });
});

console.log('\nErrores del servidor (en-pilot-link.js)');
// Se carga el script del navegador en un contexto aislado con un window mínimo.
function loadLink() {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const ctx = { window: {}, EnPilotLinkCore: C, console, setTimeout, clearTimeout, setInterval: () => 0 };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/en-pilot-link.js'), 'utf8'), ctx);
  return ctx.window.EnPilotLink;
}
test('error con id de un envío pendiente → lo rechaza con el mensaje del servidor', () => {
  const L = loadLink();
  let err = null;
  L._pending.set('m-1', { resolve: () => {}, reject: (e) => { err = e; }, t: setTimeout(() => {}, 0) });
  L._onMsg({ type: 'error', id: 'm-1', msg: 'demasiados mensajes, espera unos segundos' });
  strictEqual(err && err.name, 'Error'); // Error del contexto vm (otro realm)
  strictEqual(err.message, 'demasiados mensajes, espera unos segundos');
  strictEqual(L._pending.has('m-1'), false);
});
test('error de team_roster → guarda rosterError y fuerza republicar; pilot_presence lo limpia', () => {
  const L = loadLink();
  let emitted = 0;
  L.onChange(() => emitted++);
  L._sig = 'algo';
  L._onMsg({ type: 'error', about: 'team_roster', msg: 'pilotos: entre 1 y 10' });
  strictEqual(L.rosterError, 'pilotos: entre 1 y 10');
  strictEqual(L._sig, '');
  ok(emitted > 0);
  L._onMsg({ type: 'pilot_presence', dorsal: '7', connected: [0] });
  strictEqual(L.rosterError, null);
});
test('error sin id ni about no toca los pendientes', () => {
  const L = loadLink();
  let err = null;
  L._pending.set('m-2', { resolve: () => {}, reject: (e) => { err = e; }, t: setTimeout(() => {}, 0) });
  L._onMsg({ type: 'error', msg: 'Tipo desconocido: x' });
  strictEqual(err, null);
  ok(L._pending.has('m-2'));
  clearTimeout(L._pending.get('m-2').t);
});

console.log(`\n${passed + failed} tests — ${passed} pasados, ${failed} fallados\n`);
if (failed > 0) process.exit(1);
