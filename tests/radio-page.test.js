// StintPro — radio.html: requisitos estáticos (seguridad y móvil).
// Ejecutar: node tests/radio-page.test.js
'use strict';

const { ok } = require('assert');
const fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const HTML = read('radio.html'), JS = read('radio.js'), CSS = read('radio.css');
const MAN = JSON.parse(read('radio.webmanifest'));

console.log('\nradio.html');
test('radio.js nunca pinta con innerHTML/outerHTML/insertAdjacentHTML', () => {
  ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(JS));
});
test('viewport con viewport-fit=cover y manifest enlazado', () => {
  ok(/name="viewport"[^>]*viewport-fit=cover/.test(HTML));
  ok(/rel="manifest" href="radio.webmanifest"/.test(HTML));
  ok(/rel="apple-touch-icon"/.test(HTML));
});
test('carga los módulos en orden: auth, circuitos, Apex, núcleos y radio.js al final', () => {
  const order = ['firebase-auth.js', 'circuits.js', 'apex-protocol.js', 'apex-grid.js', 'en-apex-team.js', 'en-pilot-link-core.js', 'radio-core.js', 'radio.js'];
  const idx = order.map(f => HTML.indexOf(`src="${f}"`));
  ok(idx.every(i => i > 0), 'falta algún script');
  ok(idx.every((v, i) => i === 0 || v > idx[i - 1]), 'orden incorrecto');
});
test('CSS: pulsables ≥ 56 px, safe-area y campo ≥ 16 px', () => {
  ok(/--tap:\s*56px/.test(CSS));
  ok(/safe-area-inset-bottom/.test(CSS));
  ok(/font-size:\s*(1[6-9]|[2-9]\d)px/.test(CSS));
});
test('CSS: ningún min-height en px por debajo de 56', () => {
  const bad = [...CSS.matchAll(/min-height:\s*(\d+(?:\.\d+)?)px/g)].filter(m => parseFloat(m[1]) < 56);
  ok(bad.length === 0, 'min-height < 56px: ' + bad.map(m => m[0]).join(', '));
});
test('manifest standalone con iconos 192 y 512', () => {
  ok(MAN.display === 'standalone' && MAN.start_url === '/radio.html');
  ok(['192x192', '512x512'].every(s => MAN.icons.some(i => i.sizes === s)));
  ok(['radio-icon-192.png', 'radio-icon-512.png'].every(f => fs.existsSync(path.join(__dirname, '..', 'src', f))));
});

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
