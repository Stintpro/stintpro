// StintPro — invariantes del refactor del CSS del panel
// Ejecutar: node tests/panel-css.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const { strictEqual, deepStrictEqual } = require('assert/strict');
const { rulesOf, extractInjectedCss } = require('../tools/css-extract');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}
function group(name, fn) { console.log('\n' + name); fn(); }

const raiz = path.join(__dirname, '..');
const leer = p => fs.readFileSync(path.join(raiz, p), 'utf8');

const base     = JSON.parse(leer('tests/fixtures/panel-css-baseline.json'));
const panel    = rulesOf(leer('src/panel.css'));
const endur    = rulesOf(extractInjectedCss(leer('src/en-state.js')));
const sprint   = rulesOf(extractInjectedCss(leer('src/sprint.js')));

const sel = rs => rs.map(r => r.selector);
const dups = xs => xs.filter((x, i) => xs.indexOf(x) !== i);

group('nada se ha perdido', () => {
  test('endurance conserva todos sus selectores (panel.css + su bloque)', () => {
    deepStrictEqual(
      [...sel(panel), ...sel(endur)].sort(),
      sel(base.endurance).sort()
    );
  });
  test('sprint conserva todos sus selectores (panel.css + su bloque)', () => {
    deepStrictEqual(
      [...sel(panel), ...sel(sprint)].sort(),
      sel(base.sprint).sort()
    );
  });
});

group('nada está duplicado', () => {
  test('ningún selector está a la vez en panel.css y en el bloque de endurance', () => {
    const cruce = sel(panel).filter(s => sel(endur).includes(s));
    deepStrictEqual(cruce, []);
  });
  test('ningún selector está a la vez en panel.css y en el bloque de sprint', () => {
    const cruce = sel(panel).filter(s => sel(sprint).includes(s));
    deepStrictEqual(cruce, []);
  });
  test('panel.css no repite ningún selector', () => {
    deepStrictEqual(dups(sel(panel)), []);
  });
});

group('lo compartido es lo que se ha extraído', () => {
  test('panel.css contiene exactamente las reglas compartidas por los dos bloques', () => {
    // Compartida = mismo selector Y mismo cuerpo en los dos modos. Intersecar
    // solo por selector fallaría: .sp-body, .sp-vtas y .sp-pitc existen en ambos
    // con cuerpos distintos y se quedan, a propósito, en su bloque de origen.
    const compartidos = base.endurance
      .filter(r => base.sprint.some(s => s.selector === r.selector && s.body === r.body))
      .map(r => r.selector);
    deepStrictEqual(sel(panel).sort(), compartidos.sort());
  });
  test('cada regla de panel.css conserva su cuerpo original', () => {
    for (const regla of panel) {
      const orig = base.endurance.find(r => r.selector === regla.selector);
      strictEqual(regla.body, orig.body, `cambió el cuerpo de ${regla.selector}`);
    }
  });
});

group('el orden de carga es el correcto', () => {
  test('index.html carga styles.css y luego panel.css', () => {
    const html = leer('src/index.html');
    const iStyles = html.indexOf('href="styles.css"');
    const iPanel  = html.indexOf('href="panel.css"');
    strictEqual(iStyles > -1, true, 'no se encuentra el link a styles.css');
    strictEqual(iPanel > -1, true, 'no se encuentra el link a panel.css');
    strictEqual(iStyles < iPanel, true, 'panel.css debe ir DESPUÉS de styles.css');
  });
});

console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
