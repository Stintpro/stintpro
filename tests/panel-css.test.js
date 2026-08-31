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

// Un selector puede venir en grupo ("`.a,.b{…}`"): lo partimos para comparar
// selector individual contra selector individual.
const selectoresIndividuales = rs => rs.flatMap(r => r.selector.split(',').map(s => s.trim()));

// Las at-rules (@media, @keyframes) se cuentan como UNA regla cuyo body es su
// bloque entero (ver tools/css-extract.js): para mirar dentro basta con volver
// a pasar ese body por rulesOf.
const selectoresDentroDeMedia = rs => rs
  .filter(r => r.selector.trim().startsWith('@'))
  .flatMap(r => selectoresIndividuales(rulesOf(r.body)));

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

group('un @media vive en el mismo fichero que su selector base', () => {
  test('ningún selector declarado dentro de un @media de los bloques inyectados está en panel.css', () => {
    // Trampa real (C1): un selector movido a panel.css, que carga ANTES que
    // los <style> inyectados, invierte su orden respecto a un @media que lo
    // siga redeclarando aquí — ese @media pasa de perder a ganar. El @media y
    // el selector base tienen que vivir siempre en el mismo fichero.
    const panelIndividual = selectoresIndividuales(panel);
    const dentroDeMedia = [...selectoresDentroDeMedia(endur), ...selectoresDentroDeMedia(sprint)];
    const fuga = dentroDeMedia.filter(s => panelIndividual.includes(s));
    deepStrictEqual(fuga, []);
  });
});

group('los bloques inyectados no se han desviado de la línea base', () => {
  // panel-css.test.js hasta ahora solo comparaba CONJUNTOS de selectores entre
  // ficheros; nada comprobaba que el CUERPO de una regla que se queda en un
  // bloque inyectado (56 en endurance, 13 en sprint) siga siendo el mismo. Una
  // mutación como cambiar el column-gap de .en-row pasaba desapercibida.
  test('cada regla del bloque de endurance conserva el cuerpo de la línea base', () => {
    for (const regla of endur) {
      const orig = base.endurance.find(r => r.selector === regla.selector);
      strictEqual(regla.body, orig.body, `cambió el cuerpo de ${regla.selector}`);
    }
  });
  test('cada regla del bloque de sprint conserva el cuerpo de la línea base', () => {
    for (const regla of sprint) {
      const orig = base.sprint.find(r => r.selector === regla.selector);
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
