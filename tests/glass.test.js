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
  test('ni .sp-glass ni .sp-glass-denso ni ninguna regla con backdrop-filter declaran border', () => {
    // Ronda de arreglo 1, R11b: unión de los dos conjuntos, no sustitución.
    // Antes esto solo miraba el selector (empieza por ".sp-glass"), así que
    // .sp-modal —una regla de borde APARTE, sin material, añadida en la
    // Tarea 3— quedaba fuera con razón, pero una futura regla de MATERIAL
    // con un nombre que no empezara por ".sp-glass" se habría colado sin que
    // este test la viera. Ahora se cazan las dos vías: por selector Y por
    // llevar backdrop-filter en el cuerpo, sea cual sea su nombre.
    for (const r of rulesOf(glass)) {
      const porSelector = r.selector.startsWith('.sp-glass');
      const porMaterial = /backdrop-filter/.test(r.body);
      if (!porSelector && !porMaterial) continue;
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

group('lo que flota sobre datos lleva el material denso', () => {
  const FICHEROS_MODAL = ['app.js', 'en-advanced.js', 'en-grid.js', 'en-team.js', 'en-strategy.js'];

  test('las 11 cajas de modal llevan class="sp-modal"', () => {
    let cajas = 0;
    for (const f of FICHEROS_MODAL) cajas += (leer('src/' + f).match(/class="sp-modal"/g) || []).length;
    strictEqual(cajas, 11, `esperaba 11 cajas con sp-modal, encontré ${cajas}`);
  });

  test('ninguna caja de modal conserva un fondo, borde o sombra sólidos inline', () => {
    // No asume que class= va antes que style= en la etiqueta —el orden real de
    // atributos varía en este repo (R3).
    //
    // R13 (ronda de arreglo 1): la primera versión de este test cortaba la
    // etiqueta con /<div\b[^>]*>/, que se para en el PRIMER `>` del texto. El
    // idioma dominante de este repo mete ternarios dentro del style
    // (`background:${excluded?'#0e0f11':'#13141a'}`, `score>=800?...`); si
    // alguno lleva un `>` suelto ANTES del cierre real de la etiqueta, el
    // regex se para ahí, el style queda sin cerrar, el match de style
    // devuelve null, `style` cae a `''` y las tres aserciones de abajo pasan
    // SIN HABER COMPROBADO NADA —el test falla en abierto—. Hoy ninguna de
    // las 11 cajas tiene ese patrón, pero el test tiene que seguir cazándolo
    // si aparece mañana.
    //
    // Arreglo: en vez de cortar por el primer `>`, se reconstruye la
    // etiqueta emparejando pares atributo="valor" (cada uno cerrado por su
    // propia comilla, ajena a cualquier `>` que haya dentro del valor) hasta
    // el `>` que de verdad cierra la etiqueta. Y, sobre todo, se AFIRMA
    // primero que la extracción tuvo éxito para cada caja sp-modal —si no,
    // el test FALLA en vez de seguir con un style vacío— y solo después se
    // examina el contenido.
    const ATRIBUTOS = /(?:\s+[a-zA-Z-]+="[^"]*")*/.source;
    for (const f of FICHEROS_MODAL) {
      const src = leer('src/' + f);
      const anclaRe = /class="sp-modal"/g;
      let ancla;
      while ((ancla = anclaRe.exec(src))) {
        const inicioDiv = src.lastIndexOf('<div', ancla.index);
        strictEqual(inicioDiv !== -1, true,
          `${f}: no se encontró el <div de apertura antes de una caja sp-modal (posición ${ancla.index})`);
        const tagMatch = new RegExp(`^<div\\b${ATRIBUTOS}\\s*>`).exec(src.slice(inicioDiv));
        strictEqual(tagMatch !== null, true,
          `${f}: no se pudo reconstruir la etiqueta <div> de una caja sp-modal (posición ${inicioDiv}) — ` +
          `¿un \`>\` suelto dentro de un ternario del style rompe el emparejado de atributos?`);
        const tag = tagMatch[0];
        const styleMatch = tag.match(/style="([^"]*)"/);
        strictEqual(styleMatch !== null, true,
          `${f}: una caja sp-modal no tiene un style extraíble: ${tag}`);
        const style = styleMatch[1];

        // Rechaza CUALQUIER valor de background, no solo la forma hexadecimal
        // #rrggbb —un background:var(--panel-surface) es igual de opaco y es
        // justo el fondo sólido que ya se coló dos veces en esta entrega (R9).
        // Solo se toleran transparent/none.
        const bg = style.match(/\bbackground\s*:\s*([^;]+)/);
        if (bg) {
          const valor = bg[1].trim().toLowerCase();
          strictEqual(valor === 'transparent' || valor === 'none', true,
            `${f} tiene una caja sp-modal con background inline no tolerado: ${bg[0]}`);
        }
        strictEqual(/\bborder\s*:/.test(style), false,
          `${f} tiene una caja sp-modal con border inline: ${style}`);
        strictEqual(/\bbox-shadow\s*:/.test(style), false,
          `${f} tiene una caja sp-modal con box-shadow inline: ${style}`);
      }
    }
  });

  test('.sp-glass-denso lo componen el selector de columnas y las cajas de modal', () => {
    const regla = rulesOf(glass).find(r => r.selector.includes('.sp-glass-denso'));
    strictEqual(/\.en-col-panel/.test(regla.selector), true);
    strictEqual(/\.sp-modal/.test(regla.selector), true);
  });

  test('.en-col-panel (panel del selector de columnas) no conserva fondo ni sombra propios', () => {
    // R10: .en-col-panel vive en el <style> inyectado de en-state.js, que carga
    // DESPUÉS de glass.css —si conservara su background/box-shadow de antes,
    // ganaría por cargar más tarde y el material quedaría inútil detrás.
    const inyectado = extractInjectedCss(leer('src/en-state.js'));
    const regla = rulesOf(inyectado).find(r => r.selector === '.en-col-panel');
    strictEqual(!!regla, true, 'no se encontró la regla .en-col-panel en el <style> inyectado de en-state.js');
    strictEqual(/\bbackground\s*:/.test(regla.body), false,
      `.en-col-panel declara background propio: ${regla.body}`);
    strictEqual(/\bbox-shadow\s*:/.test(regla.body), false,
      `.en-col-panel declara box-shadow propio: ${regla.body}`);
  });
});

group('el modo ☀ apaga el cristal', () => {
  const hc = (styles.match(/body\.hc\s*\{([^}]*)\}/) || [])[1] || '';
  test('body.hc pone el desenfoque a 0', () => {
    strictEqual(/--glass-blur\s*:\s*0/.test(hc), true, 'body.hc no anula --glass-blur');
  });
  test('body.hc apunta las cuatro paradas del material a un color sólido', () => {
    // En hc el material se apaga apuntando sus paradas a los tokens --panel-*,
    // que son hex opacos. Así el modo contraste reutiliza el trabajo de la
    // entrega 1 en vez de traer colores nuevos.
    for (const t of ['--glass-a', '--glass-b', '--glass-denso-a', '--glass-denso-b']) {
      const m = hc.match(new RegExp(`${t}\\s*:\\s*([^;]+);`));
      strictEqual(m !== null, true, `body.hc no redefine ${t}`);
      strictEqual(/var\(--panel-/.test(m[1]), true,
        `${t} en hc vale ${m[1]}, debería apuntar a un token --panel-*`);
    }
  });
  test('los tokens --panel-* que usa hc son hex opacos en el propio bloque hc', () => {
    for (const t of ['--panel-surface', '--panel-inset', '--panel-line']) {
      strictEqual(new RegExp(`${t}\\s*:\\s*#[0-9a-fA-F]{3,6}`).test(hc), true,
        `body.hc no redefine ${t} con un hex opaco`);
    }
  });
  test('body.hc apaga también la capa de profundidad', () => {
    for (const t of ['--depth-warm', '--depth-cool']) {
      strictEqual(new RegExp(`${t}\\s*:\\s*transparent`).test(hc), true,
        `body.hc no apaga ${t}`);
    }
  });
});

console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
