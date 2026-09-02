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

group('la cabecera es mate y sostiene las baldosas', () => {
  // El fallo crítico de la entrega: .sp-header y .sp-kpi compartían la regla
  // de material, y como la cabecera CONTIENE a las baldosas, el velo se
  // componía dos veces sobre el mismo píxel. La baldosa acababa siendo la
  // superficie más clara de la app —más clara que la cabecera que la
  // contiene— y los siete colores de los KPI caían por debajo de 4,5:1
  // (#ef4444, la llamada a boxes, en 2,41 sobre píxeles reales). Estos dos
  // tests son lo que impide
  // que vuelva: uno prohíbe el material en la cabecera, el otro exige que
  // tenga fondo propio para no quedarse transparente al quitárselo.
  test('.sp-header NO lleva material: contiene a .sp-kpi y el velo se compondría dos veces', () => {
    const conMaterial = [...rulesOf(glass), ...rulesOf(panel)].filter(r => /backdrop-filter/.test(r.body));
    for (const r of conMaterial) {
      const individuales = r.selector.split(',').map(x => x.trim());
      strictEqual(individuales.includes('.sp-header'), false,
        `.sp-header está en la lista de "${r.selector}" y lleva material; como .sp-kpi cuelga ` +
        `de ella, el velo se compone dos veces y la baldosa se dispara de brillo`);
    }
  });

  test('.sp-header tiene fondo opaco propio en panel.css', () => {
    const regla = rulesOf(panel).find(r => r.selector === '.sp-header');
    strictEqual(!!regla, true, 'no se encuentra la regla .sp-header en panel.css');
    const bg = regla.body.match(/(?:^|;)\s*background\s*:\s*([^;]+)/);
    strictEqual(bg !== null, true,
      '.sp-header no declara background: sin material y sin fondo propio quedaría transparente ' +
      'sobre #screen-dash y las baldosas volverían a flotar sobre la capa de profundidad');
    strictEqual(/^var\(--panel-/.test(bg[1].trim()), true,
      `.sp-header pinta su fondo con "${bg[1].trim()}"; debe usar un token --panel-* para que body.hc lo alcance`);
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
    // El "0" tiene que ser el valor ENTERO, no su primer dígito: el regex de
    // antes (/--glass-blur\s*:\s*0/) daba por bueno un "0.5px", que no es
    // apagar nada, en un test que se llama justo "pone el desenfoque a 0".
    strictEqual(/--glass-blur\s*:\s*0(?:px)?\s*;/.test(hc), true, 'body.hc no anula --glass-blur');
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
    // OPACO = 3 o 6 dígitos exactos. {3,6} daba por bueno un #1a2b (4 dígitos),
    // que es RGBA con alfa —translúcido— porque casaba sus tres primeros
    // dígitos y se paraba ahí. La alternativa larga va primero y el
    // (?![0-9a-fA-F]) impide que un hex de 4 u 8 cuele por la rama de 3.
    const HEX_OPACO = '#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])';
    for (const t of ['--panel-surface', '--panel-inset', '--panel-line']) {
      strictEqual(new RegExp(`${t}\\s*:\\s*${HEX_OPACO}`).test(hc), true,
        `body.hc no redefine ${t} con un hex opaco (3 o 6 dígitos)`);
    }
  });
  test('en ☀ la cabecera y las baldosas NO resuelven al mismo color (I2)', () => {
    // En ☀ el material se apaga: --glass-a/-b pasan a ser un color plano, así
    // que la baldosa pinta EXACTAMENTE ese token. Mientras .sp-kpi compartía
    // regla con .sp-header, ambas pintaban el mismo plano y la franja de KPIs
    // desaparecía dentro de la cabecera — y ☀ es precisamente el modo para sol
    // directo, donde la separación de bloques es lo primero que se pierde.
    // Antes del cristal tenían separación tonal (#13141a contra #0e0f11).
    const raiz = (styles.match(/:root\s*\{([^}]*)\}/) || [])[1] || '';
    const valorEn = (bloque, t) => {
      const m = bloque.match(new RegExp(`${t}\\s*:\\s*([^;]+);`));
      return m ? m[1].trim() : null;
    };
    // Resuelve un token en el modo ☀: primero body.hc, si no el :root base, y
    // sigue las cadenas var(--x) hasta llegar a un color.
    const resolverHc = (t, saltos = 0) => {
      strictEqual(saltos < 10, true, `cadena de var() sin fin resolviendo ${t}`);
      const v = valorEn(hc, t) || valorEn(raiz, t);
      strictEqual(v !== null, true, `el token ${t} no está declarado ni en body.hc ni en :root`);
      const m = v.match(/^var\((--[\w-]+)\)$/);
      return m ? resolverHc(m[1], saltos + 1) : v.toLowerCase();
    };

    const reglaHeader = rulesOf(panel).find(r => r.selector === '.sp-header');
    const bgHeader = reglaHeader.body.match(/(?:^|;)\s*background\s*:\s*var\((--[\w-]+)\)/);
    strictEqual(bgHeader !== null, true, '.sp-header no pinta su fondo con un token');
    const cabecera = resolverHc(bgHeader[1]);
    const baldosa = resolverHc('--glass-a');
    strictEqual(cabecera !== baldosa, true,
      `en body.hc la cabecera y las baldosas resuelven las dos a ${cabecera}: en ☀ la franja de ` +
      `KPIs se funde con la cabecera. Dale a una de las dos su propio token --panel-*`);
  });

  test('body.hc apaga también la capa de profundidad', () => {
    for (const t of ['--depth-warm', '--depth-cool']) {
      strictEqual(new RegExp(`${t}\\s*:\\s*transparent`).test(hc), true,
        `body.hc no apaga ${t}`);
    }
  });
  test('body.hc pone a 0 el blur DENSO y a 100% saturación/brillo (R22)', () => {
    // --glass-denso-blur hereda el valor COMPUTADO de --glass-blur declarado
    // en :root (28px ya sustituidos), no la fórmula var(...) — así que el
    // --glass-blur:0px de arriba no le llega y el material denso seguiría
    // pagando blur(28px) en ☀ detrás de un fondo opaco. El test de arriba
    // ('body.hc pone el desenfoque a 0') usa el regex /--glass-blur\s*:\s*0/,
    // que NO casa con "--glass-denso-blur" —el prefijo "denso-" rompe el
    // literal—, así que hace falta esta aserción aparte para --glass-denso-blur,
    // --glass-sat y --glass-bright.
    strictEqual(/--glass-denso-blur\s*:\s*0(?:px)?\s*;/.test(hc), true, 'body.hc no anula --glass-denso-blur');
    strictEqual(/--glass-sat\s*:\s*100%/.test(hc), true, 'body.hc no anula --glass-sat');
    strictEqual(/--glass-bright\s*:\s*100%/.test(hc), true, 'body.hc no anula --glass-bright');
  });
});

group('la palanca de rendimiento', () => {
  // El corte NO está clavado en un número: se lee del propio fichero y se
  // comprueba contra el caso de uso que el comentario de glass.css declara —el
  // iPad en apaisado—. Con 900px la palanca no se disparaba en ninguno (mini
  // 1024, 10.2" 1080, Air 1180, Pro 12.9" 1366): existía y estaba apagada.
  // El ancho de referencia es el del iPad Air, el mayor de los tres que de
  // verdad se llevan al muro; el Pro 12.9" queda fuera a propósito (ver el
  // comentario de src/glass.css).
  const ANCHO_IPAD_APAISADO = 1180; // iPad Air
  const mMedia = glass.match(/@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)\}\s*\}/);

  test('glass.css baja el desenfoque en pantallas pequeñas', () => {
    strictEqual(mMedia !== null, true, 'no hay @media (max-width:Npx) en glass.css');
    strictEqual(/--glass-blur\s*:/.test(mMedia[2]), true, 'el @media no toca --glass-blur');
  });

  test('el corte alcanza al iPad en apaisado, que es el caso de uso declarado', () => {
    strictEqual(mMedia !== null, true, 'no hay @media (max-width:Npx) en glass.css');
    const corte = Number(mMedia[1]);
    strictEqual(corte >= ANCHO_IPAD_APAISADO, true,
      `el @media corta en ${corte}px y un iPad Air en apaisado mide ${ANCHO_IPAD_APAISADO}px: ` +
      `la palanca existe pero no se dispara donde su propio comentario dice`);
  });

  test('el valor del @media es MENOR que el de :root, no un número mágico (R25)', () => {
    // Ronda de arreglo 1: el test de arriba solo comprobaba que el TOKEN
    // --glass-blur aparecía dentro del @media, no que el VALOR bajara — un
    // "--glass-blur: 40px" ahí dentro lo habría dejado en verde mientras el
    // desenfoque SUBE, justo lo contrario de lo que promete el nombre del
    // test. Aquí se comparan los dos valores numéricamente contra el
    // --glass-blur base de :root en styles.css, sin clavar "14px": así la
    // aserción vigila la intención real (bajar el desenfoque) y sigue
    // valiendo si el número se recalibra mañana.
    strictEqual(mMedia !== null, true, 'no hay @media (max-width:Npx) en glass.css');

    // :root en styles.css no anida reglas (solo custom properties), así que
    // cortar en el primer "}" basta para aislar el bloque base —el mismo
    // patrón que ya usa este fichero para aislar body.hc más abajo—.
    const raizRoot = styles.match(/:root\s*\{([^}]*)\}/);
    strictEqual(raizRoot !== null, true, 'no se encontró el :root base en styles.css');

    // El regex exige ":" pegado a "--glass-blur" y "px" pegado al número: así
    // no cuela un valor ausente/no numérico como NaN silencioso, y no se
    // cruza con "--glass-denso-blur" (no contiene la subcadena literal
    // "--glass-blur": es "--glass-DENSO-blur") ni con el "var(--glass-blur)"
    // de la propia declaración de --glass-denso-blur (ahí "--glass-blur" va
    // seguido de ")", no de ":").
    const baseMatch = raizRoot[1].match(/--glass-blur\s*:\s*(-?\d+(?:\.\d+)?)px/);
    strictEqual(baseMatch !== null, true,
      '--glass-blur no tiene un valor numérico en px en el :root base de styles.css');
    const mediaMatch = mMedia[2].match(/--glass-blur\s*:\s*(-?\d+(?:\.\d+)?)px/);
    strictEqual(mediaMatch !== null, true,
      '--glass-blur dentro del @media no tiene un valor numérico en px');

    const base = Number(baseMatch[1]);
    const media = Number(mediaMatch[1]);
    // Number.isFinite(NaN) es false: si algún valor no numérico se colara
    // pese a los regex de arriba, esto falla en vez de degradar a
    // "NaN < 28" → false, que sería un falso verde silencioso.
    strictEqual(Number.isFinite(base) && Number.isFinite(media), true,
      `algún valor de --glass-blur no es numérico (base="${baseMatch[1]}", media="${mediaMatch[1]}")`);
    strictEqual(media < base, true,
      `el @media (${media}px) debería bajar el desenfoque respecto a :root (${base}px)`);
  });
});

console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
