// StintPro — datos de Apex (dorsal, equipo) que acaban en innerHTML
// Ejecutar: node tests/xss-sinks.test.js
'use strict';

const { strictEqual, ok } = require('assert');
const makeDashboard = require('./helpers/dashboard');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const PAYLOAD = '<img src=x onerror=alert(1)>';
const D = makeDashboard();
D.open({ slug: 'lossantos', myDorsal: '12', pilotos: [] });

console.log('\n▸ Dorsal saneado al entrar\n');

test('_safeDorsal: se queda con el dorsal real y tira lo demás', () => {
  const f = D.ctx._safeDorsal;
  strictEqual(f('7' + PAYLOAD), '7');
  strictEqual(f("12');alert(1);//"), '12');
  strictEqual(f(' 12A '), '12A');
  strictEqual(f(7), '7');
  strictEqual(f(null), '');
});

test('el handler del dashboard sanea el dorsal de los equipos y de las paradas', () => {
  D.feed({ _isHistory: true, equipos: [{ dorsal: '7' + PAYLOAD, name: 'X', pos: 1, lapHistory: [] }],
    pitEvents: [{ dorsal: "7'><b>", event: 'in', time: D.now() - 60000 }] });
  strictEqual(D.run('EnSession.data.equipos[0].dorsal'), '7');
  ok(D.run('EnBox.queue').every((k) => !/[<>'"]/.test(String(k.dorsal))), JSON.stringify(D.run('EnBox.queue')));
});

console.log('\n▸ Tarjetas que pintan nombres de Apex\n');

test('STRATEGY-6: la tarjeta de Olas escapa el nombre del equipo y el dorsal', () => {
  const html = D.ctx._enWaveRivalCard({ dorsal: '7"' + PAYLOAD, quality: 'good', minLeft: 3, elapsedMs: 60000 },
    { teamName: PAYLOAD, name: PAYLOAD });
  ok(!html.includes('<img'), html);
});

test('STRATEGY-6: el chip de la cola del box escapa el dorsal (contenido y onclick)', () => {
  D.run(`EnBox.queue=[{id:'a',quality:'good',dorsal:"7');alert(1);//",name:'X'},{id:'b',quality:'bad',dorsal:'${PAYLOAD}',name:'Y'}]`);
  const html = D.run('_enRenderStrategy(EnSession.data.equipos, 65)');
  ok(!html.includes('<img'), 'dorsal sin escapar en el contenido');
  ok(!html.includes("_enToggleQuality('7')"), 'onclick roto por la comilla');
  ok(!/_enToggleQuality\('7&#39;\)/.test(html), 'entidad &#39; dentro de una cadena JS en onclick');
});

console.log('\n▸ logger-stats.html (panel de estadísticas)\n');

const STATS = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'logger-stats.html'), 'utf8');

test('SECURITY-3: esc() escapa también la comilla simple', () => {
  const src = STATS.match(/function esc\(s\) \{[\s\S]*?\n\}/)[0];
  const esc = new Function(src + '; return esc;')();
  ok(!esc("a'b").includes("'"), esc("a'b"));
});

test('SECURITY-3: el botón ℹ no mete el nombre del piloto dentro de código JS', () => {
  ok(!/showPilotPopup\('\$\{/.test(STATS), 'showPilotPopup(\'${…}\') sigue en el HTML');
});

test('SECURITY-6: "Unificar" no serializa los nombres en un atributo onclick', () => {
  ok(!/onclick='confirmMerge\(\$\{JSON\.stringify/.test(STATS));
});

console.log(`\n${passed} pasan, ${failed} fallan\n`);
process.exit(failed ? 1 : 0);
