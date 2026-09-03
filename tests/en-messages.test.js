// StintPro — tests de la ingesta de mensajes de dirección de carrera (en-messages.js)
// Foco: atribución por dorsal (la luz roja) y anti-duplicado (Apex reenvía el
// mismo aviso: 10 veces el mismo "N°7 : Avertissement" en las 24H de RKC).
// Ejecutar: node tests/en-messages.test.js
'use strict';

const { strictEqual, ok } = require('assert');
const { ingestMessage, clearUnread, DEDUPE_MS } = require('../src/en-messages');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const nueva = () => ({ messages: [], msgUnread: { mias: false, otras: false } });
const sancion = (dorsal, text) => ({ kind: 'penalty', dorsal, team: 'X', reason: 'r', penalty: '1 Tour', text });

console.log('\nAtribución por dorsal');

test('sanción de mi dorsal → mine y luz roja', () => {
  const s = nueva();
  ingestMessage(s, sancion('14', 'a'), '14', 1000);
  strictEqual(s.messages[0].mine, true);
  strictEqual(s.msgUnread.mias, true);
  strictEqual(s.msgUnread.otras, false);
});

test('sanción de un rival → luz ámbar, no roja', () => {
  const s = nueva();
  ingestMessage(s, sancion('9', 'a'), '14', 1000);
  strictEqual(s.messages[0].mine, false);
  strictEqual(s.msgUnread.mias, false);
  strictEqual(s.msgUnread.otras, true);
});

test('compara dorsales como texto (config numérica vs feed en cadena)', () => {
  const s = nueva();
  ingestMessage(s, sancion('14', 'a'), 14, 1000);
  strictEqual(s.messages[0].mine, true);
});

test('sin mi dorsal configurado, nada es mío', () => {
  const s = nueva();
  ingestMessage(s, sancion('14', 'a'), null, 1000);
  strictEqual(s.messages[0].mine, false);
  strictEqual(s.msgUnread.mias, false);
});

test('mensaje sin dorsal → se guarda pero solo enciende el ámbar', () => {
  const s = nueva();
  ingestMessage(s, sancion(null, 'a'), '14', 1000);
  strictEqual(s.messages.length, 1);
  strictEqual(s.msgUnread.mias, false);
  strictEqual(s.msgUnread.otras, true);
});

console.log('\nAnti-duplicado');

test('el mismo texto reenviado no se duplica', () => {
  const s = nueva();
  ingestMessage(s, sancion('14', 'mismo'), '14', 1000);
  const r = ingestMessage(s, sancion('14', 'mismo'), '14', 2000);
  strictEqual(s.messages.length, 1);
  strictEqual(r, null);
});

test('un duplicado no vuelve a encender la luz ya apagada', () => {
  const s = nueva();
  ingestMessage(s, sancion('14', 'mismo'), '14', 1000);
  clearUnread(s);
  ingestMessage(s, sancion('14', 'mismo'), '14', 2000);
  strictEqual(s.msgUnread.mias, false);
});

test('el mismo texto pasada la ventana SÍ entra (reincidencia real)', () => {
  const s = nueva();
  ingestMessage(s, sancion('14', 'mismo'), '14', 1000);
  ingestMessage(s, sancion('14', 'mismo'), '14', 1000 + DEDUPE_MS + 1);
  strictEqual(s.messages.length, 2);
});

console.log('\nOrden y tope');

test('el más reciente va primero', () => {
  const s = nueva();
  ingestMessage(s, sancion('1', 'viejo'), '14', 1000);
  ingestMessage(s, sancion('2', 'nuevo'), '14', 2000);
  strictEqual(s.messages[0].text, 'nuevo');
});

test('el anillo se queda en 60', () => {
  const s = nueva();
  for (let i = 0; i < 80; i++) ingestMessage(s, sancion('1', 'm' + i), '14', 1000 + i);
  strictEqual(s.messages.length, 60);
  strictEqual(s.messages[0].text, 'm79');
});

console.log('\nApagar la luz');

test('clearUnread apaga las dos luces y no borra el historial', () => {
  const s = nueva();
  ingestMessage(s, sancion('14', 'a'), '14', 1000);
  ingestMessage(s, sancion('9', 'b'), '14', 2000);
  clearUnread(s);
  strictEqual(s.msgUnread.mias, false);
  strictEqual(s.msgUnread.otras, false);
  strictEqual(s.messages.length, 2);
});

console.log(`\n${passed + failed} tests — ${passed} pasados, ${failed} fallados\n`);
if (failed > 0) process.exit(1);
