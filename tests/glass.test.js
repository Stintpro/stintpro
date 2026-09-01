// StintPro — invariantes del material de cristal.
// Ejecutar: node tests/glass.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const { strictEqual, deepStrictEqual } = require('assert/strict');
const { rulesOf, stripComments, extractInjectedCss } = require('../tools/css-extract');

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
    // Lista blanca: usos preexistentes a esta rama, de un desenfoque decorativo
    // puntual —un velo de demo, dos carteles y dos overlays de modal en
    // admin.html/logger-stats.html—, no del material de cristal. La
    // restricción real es que EL MATERIAL —.sp-glass/.sp-glass-denso— viva
    // solo en glass.css, no que nadie pueda usar backdrop-filter para un
    // efecto suelto. Quitamos los comentarios antes de buscar, porque si no el
    // propio comentario de panel.css que MENCIONA la palabra "backdrop-filter"
    // cuenta como un falso positivo.
    //
    // Cubre también los .html de src/ y tools/panel-preview.html: son
    // ficheros servidos igual que los .css/.js, y panel-preview.html en
    // concreto es justo donde trabajará la Tarea 3 (el <style> de
    // #sp-topnav). Sin esto, escribir el material dentro de un <style>
    // embebido en un .html se colaba sin que este test se enterara. Cualquier
    // fichero NUEVO que declare backdrop-filter sigue cazado aquí, .html
    // incluidos: hay que añadirlo a esta lista a mano, a propósito, para que
    // no pase desapercibido.
    const LISTA_BLANCA = ['app.js', 'en-persist.js', 'admin.html', 'logger-stats.html'];
    const candidatos = [
      ...fs.readdirSync(path.join(raiz, 'src'))
        .filter(f => /\.(css|js|html)$/.test(f) && f !== 'glass.css')
        .map(f => ({ nombre: f, contenido: leer('src/' + f) })),
      { nombre: 'panel-preview.html', contenido: leer('tools/panel-preview.html') },
    ];
    const otros = candidatos
      .filter(c => /backdrop-filter/.test(stripComments(c.contenido)))
      .map(c => c.nombre);
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
    // Incluye también los <style> inyectados de en-state.js y sprint.js: una
    // capa de profundidad repetida POR COMPONENTE ahí dentro es justo lo que
    // prohíbe la restricción global ("va una sola vez por pantalla, nunca
    // repetida por componente") y antes se colaba sin que este test la viera.
    const conProfundidad = [
      ...rulesOf(panel), ...rulesOf(glass), ...rulesOf(styles),
      ...rulesOf(extractInjectedCss(leer('src/en-state.js'))),
      ...rulesOf(extractInjectedCss(leer('src/sprint.js'))),
    ]
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
  test('ningún selector con material es una regla de datos', () => {
    // Antes esto buscaba literalmente ".en-row {" en el CSS crudo, y ese
    // patrón NO casa con el vector real que abre esta tarea: el material se
    // compone con UNA declaración que lleva una LISTA de selectores delante
    // (".sp-glass, .sp-header, ..., #screen-setup .card { ... }"). Si alguien
    // colara ".en-row" en esa lista, el selector completo ya no es
    // exactamente ".en-row" y el regex antiguo se quedaba en verde sin
    // haberlo visto. Por eso ahora se mira al revés: se cogen TODAS las
    // reglas que declaran backdrop-filter (en glass.css, panel.css y los dos
    // bloques inyectados) y se comprueba que ninguna PROHIBIDA aparece como
    // uno de los selectores individuales (separados por coma) de esa regla.
    const fuentes = [
      ...rulesOf(glass),
      ...rulesOf(panel),
      ...rulesOf(extractInjectedCss(leer('src/en-state.js'))),
      ...rulesOf(extractInjectedCss(leer('src/sprint.js'))),
    ];
    const conMaterial = fuentes.filter(r => /backdrop-filter/.test(r.body));
    for (const r of conMaterial) {
      const selectoresIndividuales = r.selector.split(',').map(s => s.trim());
      for (const prohibida of PROHIBIDAS) {
        strictEqual(selectoresIndividuales.includes(prohibida), false,
          `${prohibida} está en la lista de selectores de "${r.selector}" y lleva material; debe seguir mate`);
      }
    }
  });
});

console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
