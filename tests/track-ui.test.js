'use strict';
// Tests de la pestaña 🗺️ Pista (en-track.js): HTML de la tira de huecos, de la
// columna "En box", de la etiqueta honesta y de la ficha; y el reloj del mapa.
// Run: node tests/track-ui.test.js

const assert = require('assert');
const U = require('../src/en-track');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

console.log('\nformato');

test('huecos con coma decimal y signo', () => {
  assert.strictEqual(U._enTrackFmtGap(1.84), '+1,8 s');
  assert.strictEqual(U._enTrackFmtGap(-3.36), '−3,4 s');
});
test('reloj m:ss y vuelta m:ss.sss', () => {
  assert.strictEqual(U._enTrackClock(95.4), '1:35');
  assert.strictEqual(U._enTrackClock(-3), '0:00');
  assert.strictEqual(U._enTrackFmtLap(66321), '1:06.321');
  assert.strictEqual(U._enTrackFmtLap(null), '—');
});
test('escapa HTML de los nombres de Apex', () => {
  assert.strictEqual(U._enTrackEsc('<b>"A&B"</b>'), '&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;');
});

console.log('\ntira de huecos');

test('sin dorsal configurado → aviso', () => {
  assert.ok(U._enTrackGapStripHtml(null, '').includes('Configura tu dorsal'));
});
test('delante + y detrás −, con dorsal y equipo', () => {
  const h = U._enTrackGapStripHtml({
    ahead: { dorsal: '12', name: 'Equipo X', gapS: 1.8 },
    behind: { dorsal: '7', name: 'Equipo Y', gapS: 3.4 },
  }, '5');
  assert.ok(h.includes('▲') && h.includes('#12') && h.includes('Equipo X') && h.includes('+1,8 s'));
  assert.ok(h.includes('▼') && h.includes('#7') && h.includes('−3,4 s'));
  assert.ok(h.includes('MI KART'));
});
test('sin rival por un lado → guion', () => {
  const h = U._enTrackGapStripHtml({ ahead: null, behind: null }, '5');
  assert.ok(h.includes('▲ —') && h.includes('▼ —'));
});

console.log('\ncolumna En box');

test('vacía → "Nadie en box"', () => {
  assert.ok(U._enTrackPitListHtml([]).includes('Nadie en box'));
});
test('cuenta atrás y exceso en rojo, en el orden recibido', () => {
  const h = U._enTrackPitListHtml([
    { dorsal: '9', name: 'Rojo', pitS: 150, remainingS: -30 },
    { dorsal: '3', name: 'Azul', pitS: 40, remainingS: 80 },
  ]);
  assert.ok(h.includes('+0:30') && h.includes('#ef4444'));
  assert.ok(h.includes('Sale en 1:20'));
  assert.ok(h.indexOf('Rojo') < h.indexOf('Azul'));
  assert.ok(h.includes('En box · 2'));
});

console.log('\netiqueta y ficha');

test('óvalo → posición aproximada', () => {
  assert.ok(U._enTrackNoteHtml({ generic: true }, { n: 0 }).includes('Trazado genérico · posición aproximada'));
});
test('GPS → midiendo… hasta 20 pases, luego error medio', () => {
  assert.ok(U._enTrackNoteHtml({ generic: false, name: 'Henakart' }, { n: 5, medianS: 0.2 }).includes('midiendo'));
  assert.ok(U._enTrackNoteHtml({ generic: false, name: 'Henakart' }, { n: 40, medianS: 0.214 }).includes('±0,21 s'));
  assert.ok(U._enTrackNoteHtml({ generic: false, approxProfile: true, name: 'H' }, { n: 0 }).includes('aproximado'));
});
test('ficha del kart: última vuelta y ritmo en m:ss.sss', () => {
  const h = U._enTrackSelHtml({ dorsal: '7', name: 'Equipo 7', refMs: 60123, lastLapMs: 61234 });
  assert.ok(h.includes('#7') && h.includes('1:01.234') && h.includes('1:00.123'));
  assert.strictEqual(U._enTrackSelHtml(null), '');
});

console.log('\nreloj del mapa');

test('sin replay → reloj del sistema', () => {
  global.window = {};
  assert.ok(Math.abs(U._enTrackNow() - Date.now()) < 50);
});
test('replay en marcha → reloj de la grabación a su velocidad', () => {
  const wall = Date.now() - 2000;
  global.window = { ReplayConnector: { _lines: [{ t: 5000 }], _currentIdx: 0, _playing: true, _paused: false, speed: 4, _mediaStart: 1000000, _wallStart: wall } };
  const t = U._enTrackNow();
  assert.ok(Math.abs(t - (1000000 + (Date.now() - wall) * 4)) < 200, `t ${t}`);
});
test('replay en pausa → instante de la línea actual', () => {
  global.window = { ReplayConnector: { _lines: [{ t: 5000 }, { t: 7000 }], _currentIdx: 1, _playing: true, _paused: true, speed: 4, _mediaStart: 0, _wallStart: 0 } };
  assert.strictEqual(U._enTrackNow(), 7000);
  delete global.window;
});

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
