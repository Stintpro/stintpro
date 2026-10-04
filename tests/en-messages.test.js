// StintPro — tests de la ingesta de mensajes de dirección de carrera (en-messages.js)
// Foco: atribución por dorsal (la luz roja) y anti-duplicado (Apex reenvía el
// mismo aviso: 10 veces el mismo "N°7 : Avertissement" en las 24H de RKC).
// Ejecutar: node tests/en-messages.test.js
'use strict';

const { strictEqual, ok } = require('assert');
const { ingestMessage, clearUnread, bannerMessages, dismissBanner, DEDUPE_MS } = require('../src/en-messages');

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

test('mensaje sin dorsal → es para todos: luz de aviso general, ni roja ni ámbar', () => {
  const s = nueva();
  ingestMessage(s, sancion(null, 'a'), '14', 1000);
  strictEqual(s.messages.length, 1);
  strictEqual(s.msgUnread.mias, false);
  strictEqual(s.msgUnread.otras, false);
  strictEqual(s.msgUnread.general, true);
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

console.log('\nAvisos de la organización (tablón com|)');

const general = (text, extra) => ({ kind: 'warning', dorsal: null, dorsals: [], team: null, reason: text, penalty: null, text, source: 'com', clock: '18:32', history: false, ...extra });

test('aviso general (sin dorsales) → general, su luz y a la franja', () => {
  const s = nueva();
  const e = ingestMessage(s, general('CLEAR VISOR MANDATORY FROM 19:30'), '14', 1000);
  strictEqual(e.general, true);
  strictEqual(e.mine, false);
  strictEqual(s.msgUnread.general, true);
  strictEqual(s.msgUnread.mias, false);
  strictEqual(s.msgUnread.otras, false);
  strictEqual(bannerMessages(s).length, 1);
});

test('texto libre que nombra mi dorsal entre varios → mío (luz roja), no general', () => {
  const s = nueva();
  const e = ingestMessage(s, general('Team #14 and # 22 need to split NOW', { dorsals: ['14', '22'] }), 22, 1000);
  strictEqual(e.mine, true);
  strictEqual(e.general, false);
  strictEqual(s.msgUnread.mias, true);
  strictEqual(bannerMessages(s).length, 0);
});

test('texto libre que nombra a otros → rival (ámbar), sin franja', () => {
  const s = nueva();
  const e = ingestMessage(s, general('Team #14 and # 22 need to split NOW', { dorsals: ['14', '22'] }), '7', 1000);
  strictEqual(e.mine, false);
  strictEqual(e.general, false);
  strictEqual(s.msgUnread.otras, true);
  strictEqual(bannerMessages(s).length, 0);
});

test('historial del tablón al conectar: se lista, sin luces ni franja, con su hora', () => {
  const s = nueva();
  const now = new Date(2026, 9, 4, 19, 0, 0).getTime();
  const e = ingestMessage(s, general('CLEAR VISOR MANDATORY FROM 19:30', { history: true }), '14', now);
  ok(e);
  strictEqual(s.msgUnread.general, false);
  strictEqual(bannerMessages(s).length, 0);
  strictEqual(e.ts, new Date(2026, 9, 4, 18, 32, 0).getTime());
});

test('historial con hora "posterior" a la actual → es de ayer', () => {
  const s = nueva();
  const now = new Date(2026, 9, 4, 9, 0, 0).getTime();
  const e = ingestMessage(s, general('x', { history: true, clock: '23:10' }), '14', now);
  strictEqual(e.ts, new Date(2026, 9, 3, 23, 10, 0).getTime());
});

test('la misma sanción por msg| y por com| → una sola', () => {
  const s = nueva();
  ingestMessage(s, { kind: 'penalty', dorsal: '51', dorsals: ['51'], team: 'EDUARDO MANCEBO A 105', reason: 'AJUSTE CRONO NO ES PENALIZACION', penalty: '1 Posición',
    text: 'Nº.51 EDUARDO MANCEBO A 105 : Penalización - AJUSTE CRONO NO ES PENALIZACION - 1 Posición' }, '7', 1000);
  const dup = ingestMessage(s, { kind: 'penalty', dorsal: '51', dorsals: ['51'], team: null, reason: 'AJUSTE CRONO NO ES PENALIZACION', penalty: '1 Posición',
    text: 'Penalización - AJUSTE CRONO NO ES PENALIZACION - 1 Posición', source: 'com', clock: '11:55', history: false }, '7', 3000);
  strictEqual(dup, null);
  strictEqual(s.messages.length, 1);
});

test('el mismo texto libre por los dos canales → uno solo, aunque cambie el tipo', () => {
  const s = nueva();
  const t = 'Theam #29 and # 20 no more push next stint';
  ingestMessage(s, { kind: 'penalty', dorsal: null, dorsals: ['29', '20'], team: null, reason: t, penalty: null, text: t }, '7', 1000);
  strictEqual(ingestMessage(s, general(t, { dorsals: ['29', '20'] }), '7', 2000), null);
});

test('abrir el buzón apaga las tres luces y retira la franja', () => {
  const s = nueva();
  ingestMessage(s, general('PIT CLOSE'), '14', 1000);
  clearUnread(s);
  strictEqual(s.msgUnread.general, false);
  strictEqual(bannerMessages(s).length, 0);
  strictEqual(s.messages.length, 1);
});

test('cerrar la franja (✕) da por leídos los generales y no toca la luz roja', () => {
  const s = nueva();
  ingestMessage(s, general('PIT CLOSE'), '14', 1000);
  ingestMessage(s, sancion('14', 'mía'), '14', 2000);
  dismissBanner(s);
  strictEqual(bannerMessages(s).length, 0);
  strictEqual(s.msgUnread.general, false);
  strictEqual(s.msgUnread.mias, true);
});

test('la franja muestra primero el aviso general más reciente', () => {
  const s = nueva();
  ingestMessage(s, general('UNO'), '14', 1000);
  ingestMessage(s, general('DOS'), '14', 2000);
  strictEqual(bannerMessages(s)[0].text, 'DOS');
  strictEqual(bannerMessages(s).length, 2);
});

test('mensaje antiguo sin lista de dorsales (logger sin actualizar) sigue atribuyéndose por dorsal', () => {
  const s = nueva();
  ingestMessage(s, sancion('14', 'viejo'), '14', 1000);
  strictEqual(s.messages[0].mine, true);
  strictEqual(s.messages[0].general, false);
});

console.log(`\n${passed + failed} tests — ${passed} pasados, ${failed} fallados\n`);
if (failed > 0) process.exit(1);
