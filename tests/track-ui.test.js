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
  global.window = { ReplayConnector: { _lines: [{ t: 1000000 }], _currentIdx: 0, _playing: true, _paused: false, speed: 2, _mediaStart: 1000000, _wallStart: wall } };
  const t = U._enTrackNow();
  assert.ok(Math.abs(t - (1000000 + (Date.now() - wall) * 2)) < 200, `t ${t}`);
});
test('reloj cambiado por fuera → se queda en la línea actual', () => {
  global.window = { ReplayConnector: { _lines: [{ t: 5000000 }], _currentIdx: 0, _playing: true, _paused: false, speed: 1, _mediaStart: 0, _wallStart: Date.now() } };
  assert.strictEqual(U._enTrackNow(), 5000000);
});
test('replay en pausa → instante de la línea actual', () => {
  global.window = { ReplayConnector: { _lines: [{ t: 5000 }, { t: 7000 }], _currentIdx: 1, _playing: true, _paused: true, speed: 4, _mediaStart: 0, _wallStart: 0 } };
  assert.strictEqual(U._enTrackNow(), 7000);
  delete global.window;
});


console.log('\nmotor en todas las pestañas');

const PTP = require('../src/en-track-pos');
const S = 1000;
const kartUi = (d, lastLapAt, extra = {}) => ({
  dorsal: d, teamName: 'Equipo ' + d, lastLap: 60, lastLapAt,
  lapHistory: [60, 60, 60, 60, 60], pit: false, pitS: 0, ...extra,
});

test('_enTrackUpdate alimenta el motor sin la pestaña abierta (sin DOM)', () => {
  global.window = { EnTrackPos: PTP, AppState: { config: {} } };
  U.EnTrack.engine = null; U.EnTrack.key = null; U.EnTrack.track = null;
  const now = Date.now();
  U._enTrackUpdate([kartUi('7', now - 30000)]);
  const p = U.EnTrack.engine.positions(now);
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].dorsal, '7');
  delete global.window;
});
test('_enRenderTrack ya no llama a update (lo hace _enTrackUpdate)', () => {
  global.window = { EnTrackPos: PTP, AppState: { config: {} } };
  const body = { innerHTML: '', querySelector: () => null };
  global.document = { getElementById: id => id === 'en-track-body' ? body : null };
  U._enTrackUpdate([kartUi('7', Date.now() - 30000)]);
  let calls = 0;
  const orig = U.EnTrack.engine.update;
  U.EnTrack.engine.update = (...a) => { calls++; return orig(...a); };
  U._enRenderTrack([kartUi('7', Date.now() - 30000)]);
  assert.strictEqual(calls, 0);
  assert.ok(body.innerHTML.includes('en-trk-karts'));
  U.EnTrack.engine.update = orig;
  delete global.window; delete global.document;
});
test('en-grid llama a _enTrackUpdate en cada render, antes del bloque de la pestaña Pista', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/en-grid.js'), 'utf8');
  const iu = src.indexOf("if(typeof _enTrackUpdate==='function')_enTrackUpdate(eq);");
  const ir = src.indexOf("if(EnUi.tab==='track'&&typeof _enRenderTrack==='function')_enRenderTrack(eq);");
  assert.ok(iu > 0 && ir > iu, `update ${iu} render ${ir}`);
});

console.log('\nmenores (revisión final)');

test('vuelta: redondea antes de partir (59999,6 ms → 1:00.000)', () => {
  assert.strictEqual(U._enTrackFmtLap(59999.6), '1:00.000');
});
test('hueco: no finito → guion; casi cero → +0,0 s', () => {
  assert.strictEqual(U._enTrackFmtGap(NaN), '—');
  assert.strictEqual(U._enTrackFmtGap(Infinity), '—');
  assert.strictEqual(U._enTrackFmtGap(-0.01), '+0,0 s');
});

const tick = () => new Promise(r => setTimeout(r, 0));
async function atest(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}
const resetUi = () => { U.EnTrack.engine = null; U.EnTrack.key = null; U.EnTrack.track = null; U.EnTrack.cache = {}; };

(async () => {
  await atest('cambiar de circuito/sentido resetea el motor', async () => {
    resetUi();
    global.fetch = () => Promise.resolve({ ok: false, status: 404 });
    global.window = { EnTrackPos: PTP, AppState: { config: { slug: 'a', trackDirection: 'normal' } } };
    let at = Date.now() - 400000;
    for (let i = 0; i < 6; i++) { U._enTrackUpdate([kartUi('7', at)]); at += 60300; }
    await tick();
    let resets = 0;
    const orig = U.EnTrack.engine.reset;
    U.EnTrack.engine.reset = () => { resets++; return orig(); };
    U._enTrackUpdate([kartUi('7', at)]);
    assert.strictEqual(resets, 0, 'misma clave no resetea');
    window.AppState.config.trackDirection = 'inverso';
    U._enTrackEnsure();
    assert.strictEqual(resets, 1);
    assert.deepStrictEqual(U.EnTrack.engine.positions(Date.now()), []);
    U.EnTrack.engine.reset = orig;
  });
  await atest('trazado: cachea JSON y 404; un fallo de red o 500 se reintenta', async () => {
    let calls = 0, mode = 'net';
    global.fetch = () => { calls++;
      if (mode === 'net') return Promise.reject(new Error('offline'));
      if (mode === '500') return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({ ok: false, status: 404 }); };
    resetUi();
    global.window = { EnTrackPos: PTP, AppState: { config: { slug: 'x', trackDirection: 'normal' } } };
    U._enTrackEnsure(); await tick(); await tick();
    assert.ok(!('x' in U.EnTrack.cache), 'fallo de red no se cachea');
    mode = '500'; U.EnTrack.key = null;
    U._enTrackEnsure(); await tick(); await tick();
    assert.ok(!('x' in U.EnTrack.cache), '500 no se cachea');
    mode = '404'; U.EnTrack.key = null;
    U._enTrackEnsure(); await tick(); await tick();
    assert.ok('x' in U.EnTrack.cache && U.EnTrack.cache.x === null, '404 se cachea como null');
    assert.strictEqual(calls, 3);
    U.EnTrack.key = null; U._enTrackEnsure(); await tick();
    assert.strictEqual(calls, 3, 'tras el 404 no se vuelve a pedir');
  });
  await atest('fotograma con el trazado nuevo sin su SVG → no pinta hasta reconstruir', async () => {
    let raf = 0, posCalls = 0;
    global.requestAnimationFrame = () => ++raf;
    global.document = { getElementById: () => ({ appendChild() {}, insertBefore() {}, firstChild: null }) };
    U.EnTrack.engine.positions = () => { posCalls++; return []; };
    U.EnTrack.shellFor = { otro: true };
    U.EnTrack.lastFrame = 0;
    U._enTrackFrame();
    assert.strictEqual(raf, 1, 'sigue programando');
    assert.strictEqual(posCalls, 0, 'no pinta');
    delete global.requestAnimationFrame;
    U.EnTrack.raf = null;
  });
  delete global.window; delete global.document; delete global.fetch;
  console.log(`\n${passed} OK, ${failed} fallos\n`);
  if (failed) process.exit(1);
})();
