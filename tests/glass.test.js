// StintPro — invariantes del material de cristal.
// Ejecutar: node tests/glass.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const { strictEqual, deepStrictEqual } = require('assert/strict');
const { rulesOf, stripComments } = require('../tools/css-extract');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}
function group(name, fn) { console.log('\n' + name); fn(); }

const raiz = path.join(__dirname, '..');
const leer = p => fs.readFileSync(path.join(raiz, p), 'utf8');

const glass  = leer('src/glass.css');
const styles = leer('src/styles.css');
const panel  = leer('src/panel.css');
const index  = leer('src/index.html');

group('el material vive en un solo sitio', () => {
  test('glass.css declara backdrop-filter', () => {
    strictEqual(/backdrop-filter/.test(glass), true);
  });
  test('ningún otro fichero servido declara backdrop-filter (salvo lista blanca)', () => {
    // Lista blanca: tres usos preexistentes a esta rama, de un desenfoque
    // decorativo puntual (un velo de demo y dos carteles), no del material de
    // cristal. La restricción real es que EL MATERIAL —.sp-glass/.sp-glass-denso—
    // viva solo en glass.css, no que nadie pueda usar backdrop-filter para un
    // efecto suelto. Quitamos los comentarios antes de buscar, porque si no el
    // propio comentario de panel.css que MENCIONA la palabra "backdrop-filter"
    // cuenta como un falso positivo. Cualquier fichero NUEVO que declare
    // backdrop-filter sigue cazado aquí: hay que añadirlo a esta lista a mano,
    // a propósito, para que no pase desapercibido.
    const LISTA_BLANCA = ['app.js', 'en-persist.js'];
    const otros = fs.readdirSync(path.join(raiz, 'src'))
      .filter(f => /\.(css|js)$/.test(f) && f !== 'glass.css')
      .filter(f => /backdrop-filter/.test(stripComments(leer('src/' + f))));
    deepStrictEqual(otros.sort(), LISTA_BLANCA.sort());
  });
  test('glass.css declara el material exactamente dos veces', () => {
    const conMaterial = rulesOf(glass).filter(r => /backdrop-filter/.test(r.body));
    strictEqual(conMaterial.length, 2,
      `el material se declara ${conMaterial.length} veces; debe declararse 2 (normal y denso)`);
  });
  test('una declaración es la normal y la otra la densa', () => {
    const sel = rulesOf(glass).filter(r => /backdrop-filter/.test(r.body)).map(r => r.selector);
    strictEqual(sel.some(s => /(^|,\s*)\.sp-glass(,|\s|$)/.test(s)), true, 'falta .sp-glass');
    strictEqual(sel.some(s => /\.sp-glass-denso/.test(s)), true, 'falta .sp-glass-denso');
  });
});

group('el material no declara borde', () => {
  test('ni .sp-glass ni .sp-glass-denso declaran border', () => {
    for (const r of rulesOf(glass)) {
      if (!r.selector.startsWith('.sp-glass')) continue;
      strictEqual(/(^|;)\s*border\s*:/.test(r.body), false,
        `${r.selector} declara border y competiría con cada superficie`);
    }
  });
});

group('la capa de profundidad va una sola vez por pantalla', () => {
  test('solo #screen-dash y #screen-setup la declaran', () => {
    const conProfundidad = [...rulesOf(panel), ...rulesOf(glass), ...rulesOf(styles)]
      .filter(r => /var\(--depth-(warm|cool)\)/.test(r.body))
      .map(r => r.selector);
    deepStrictEqual(conProfundidad.sort(), ['#screen-dash', '#screen-setup']);
  });
});

group('el orden de carga', () => {
  test('index.html carga styles.css → panel.css → glass.css', () => {
    const i1 = index.indexOf('href="styles.css"');
    const i2 = index.indexOf('href="panel.css"');
    const i3 = index.indexOf('href="glass.css"');
    strictEqual(i1 > -1 && i2 > -1 && i3 > -1, true, 'falta algún <link>');
    strictEqual(i1 < i2 && i2 < i3, true, 'el orden de carga es incorrecto');
  });
});

group('la zona de datos sigue mate', () => {
  const PROHIBIDAS = ['.en-row', '.en-thead', '.en-kart', '.en-myrow', '.sp-lapbar'];
  test('ninguna regla de datos compone el material', () => {
    const todo = glass + panel + leer('src/en-state.js') + leer('src/sprint.js');
    for (const sel of PROHIBIDAS) {
      const esc = sel.replace('.', '\\.');
      const m = todo.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`, 'g')) || [];
      for (const regla of m) {
        strictEqual(/backdrop-filter/.test(regla), false, `${sel} lleva material y debe seguir mate`);
      }
    }
  });
});

console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
