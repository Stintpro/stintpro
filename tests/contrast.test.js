// StintPro — contraste del texto secundario compuesto sobre el cristal.
// Compone la capa de profundidad y el material sobre el fondo, y exige 4.5:1.
// SI ESTE TEST SE PONE ROJO, SE AJUSTA EL MATERIAL — EL UMBRAL NO SE TOCA.
// Ejecutar: node tests/contrast.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const { ok, strictEqual, deepStrictEqual } = require('assert/strict');
const { rulesOf } = require('../tools/css-extract');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const raiz = path.join(__dirname, '..');
const leer = p => fs.readFileSync(path.join(raiz, p), 'utf8');
const styles = leer('src/styles.css');

// R16: el token se lee del bloque :root, no de "styles" a pelo. `styles.match(...)`
// sin flag global devuelve la PRIMERA aparición del token en TODO el fichero, y
// tanto --text-3 como --bg están declarados dos veces: una en :root y otra en
// body.hc (el tema ☀). Hoy funciona "por accidente de orden" porque :root va
// primero en el fichero — pero si una tarea futura (la del tema ☀) reordena o
// mueve bloques, este test podría empezar a medir los tokens del modo ☀
// creyendo que mide los normales, y lo haría en VERDE. Por eso se aísla primero
// el bloque :root (con el mismo extractor de reglas que usa tests/glass.test.js,
// que empareja llaves de verdad en vez de pararse en el primer "}") y se busca
// el token SOLO ahí dentro.
const reglasStyles = rulesOf(styles);
const bloqueRoot = reglasStyles.find(r => r.selector === ':root');
if (!bloqueRoot) throw new Error('no se encontró el bloque :root en src/styles.css');

function token(nombre) {
  const m = bloqueRoot.body.match(new RegExp(`${nombre}\\s*:\\s*([^;]+);`));
  if (!m) throw new Error(`el token ${nombre} no está declarado en :root`);
  return m[1].trim();
}

function hex(c) {
  const s = c.replace('#', '');
  const n = s.length === 3 ? s.split('').map(x => x + x).join('') : s;
  return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16));
}
function rgba(c) {
  const m = c.match(/rgba?\(([^)]+)\)/);
  const p = m[1].split(',').map(x => parseFloat(x.trim()));
  return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
}
// Composición alfa estándar: `sobre` con opacidad `a` encima de `debajo`.
function componer(debajo, sobre, a) {
  return debajo.map((c, i) => c * (1 - a) + sobre[i] * a);
}
function brillo(rgb, f) { return rgb.map(c => Math.min(255, c * f)); }
function saturar(rgb, f) {
  const L = 0.213 * rgb[0] + 0.715 * rgb[1] + 0.072 * rgb[2];
  return rgb.map(c => Math.max(0, Math.min(255, L + (c - L) * f)));
}
function luminancia(rgb) {
  const l = rgb.map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Ronda de arreglo 1, R1: el cristal NO descansa sobre una única base. Hay dos
// fondos reales detrás del material, cada uno con sus propios consumidores:
//   - var(--panel-bg) — #0e0f11 — en src/panel.css:18 (#screen-dash), donde
//     vive la mayoría del cristal: la cabecera, los KPI, el pie,
//     .en-team-card, .en-strat-card, .en-col-panel y las 11 cajas de modal.
//   - var(--bg) — #07090F — en src/styles.css:117 (#screen-setup .card), el
//     único consumidor que descansa sobre el fondo "normal".
// Un test anclado solo a --bg mide un colchón que no es el real: --panel-bg es
// más claro y, compuesto, deja MENOS margen sobre 4.5:1 (medido: 4,506:1 en
// vez de 4,736:1 — seis milésimas de colchón, no 0,24). El test tiene que
// comprobar el PEOR de los dos casos, no solo uno, para que un futuro retoque
// del material o de --panel-bg no se coma ese margen sin que nada se entere.
const BASES = [
  { token: '--panel-bg', consumidor: '#screen-dash — src/panel.css:18' },
  { token: '--bg', consumidor: '#screen-setup .card — src/styles.css:117' },
];

// LAS DOS SUPERFICIES DEL MATERIAL NORMAL. Desde que .sp-header dejó de llevar
// material (src/glass.css) y pasó a ser mate con fondo opaco var(--panel-bg)
// (src/panel.css), el cristal ya no descansa sobre un único sitio:
//
//   conMancha:true  — el cristal apoyado en el FONDO DE PANTALLA, con la capa
//     de profundidad debajo. Es el peor píxel real de ese caso: el punto más
//     claro de la mancha ámbar, donde el cristal recoge más luz y el texto
//     menos contraste. Lo usan .sp-footer, .en-team-card, .en-strat-card y
//     #screen-setup .card — este último sin nada delante que tape la mancha.
//     Es también el peor caso de los tokens (--text-1/--text-3), que viven en
//     todas esas superficies, y por eso el grupo de tokens lo sigue usando.
//
//   conMancha:false — el cristal apoyado en la CABECERA MATE. Es el caso de
//     .sp-kpi, y aquí NO es una simplificación: la cabecera es opaca, así que
//     nada de la capa de profundidad llega a la baldosa. Es exacto, y es la
//     superficie contra la que se mide el barrido de literales de más abajo.
//
// El material DENSO siempre compone con la mancha: flota sobre la parrilla,
// dentro de #screen-dash.
function superficieDelCristal({ densa, base, conMancha = true }) {
  const fondo = hex(token(base));
  let detras = fondo;
  if (conMancha) {
    const calida = rgba(token('--depth-warm'));
    detras = componer(fondo, calida.rgb, calida.a);
  }

  // backdrop-filter se aplica al FONDO, antes de pintar el velo encima.
  detras = saturar(detras, parseFloat(token('--glass-sat')) / 100);
  if (!densa) detras = brillo(detras, parseFloat(token('--glass-bright')) / 100);

  // El velo: se toma la parada MÁS CLARA del degradado, que es la peor.
  const velo = rgba(token(densa ? '--glass-denso-a' : '--glass-a'));
  return componer(detras, velo.rgb, velo.a);
}

// Compone `colorHex` contra las DOS bases reales y devuelve el peor contraste
// (el más bajo), junto con la base que lo produjo — para que el mensaje de
// fallo diga contra qué fondo, no solo el número.
function peorCasoDelCristal(colorHex, { densa }) {
  let peor = Infinity, peorBase = null;
  for (const b of BASES) {
    const c = contraste(hex(colorHex), superficieDelCristal({ densa, base: b.token }));
    if (c < peor) { peor = c; peorBase = b; }
  }
  return { contraste: peor, base: peorBase };
}

console.log('\ncontraste del texto secundario sobre el material');
for (const densa of [false, true]) {
  const nombre = densa ? 'material denso' : 'material normal';
  test(`--text-3 alcanza 4.5:1 sobre el peor caso del ${nombre} (--panel-bg y --bg)`, () => {
    const { contraste: c, base } = peorCasoDelCristal(token('--text-3'), { densa });
    ok(c >= 4.5,
      `${c.toFixed(3)}:1 sobre el ${nombre}, base ${base.token} (${base.consumidor}) — ajusta el MATERIAL, no el umbral`);
  });
}

console.log('\nel texto principal no puede estar peor que el secundario');
test('--text-1 supera a --text-3', () => {
  // Comparación relativa: usa la base más exigente (--panel-bg) porque es
  // donde vive la inmensa mayoría del cristal, incluidas las 11 cajas de
  // modal — el orden entre --text-1 y --text-3 no depende de la base.
  const s = superficieDelCristal({ densa: false, base: '--panel-bg' });
  const c1 = contraste(hex(token('--text-1')), s);
  const c3 = contraste(hex(token('--text-3')), s);
  ok(c1 > c3, `--text-1 da ${c1.toFixed(2)} y --text-3 da ${c3.toFixed(2)}`);
});

// ─────────────────────────────────────────────────────────────────────────
// R17: los tokens (--text-1, --text-2, --text-3) no son el único texto que
// vive dentro de una caja de cristal. Las 11 cajas .sp-modal escriben colores
// LITERALES directamente en su style="" inline (color:#ef4444, color:#22c55e…)
// y esos jamás pasan por un token — el grupo de arriba, que solo mira
// --text-3, no los vería nunca. Este grupo barre esos literales.
//
// Las 11 cajas de modal son contenido de la pantalla endurance: componen
// sobre --panel-bg (ver BASES arriba), no sobre --bg. Se comprueban contra
// esa base — la real, y también la más exigente de las dos.
//
// ALCANCE de la extracción (documentado a propósito, en vez de fingir que es
// completa):
//   1. Solo mira los 5 ficheros donde viven las 11 cajas de modal (los mismos
//      que usa tests/glass.test.js: app.js, en-advanced.js, en-grid.js,
//      en-team.js, en-strategy.js), y solo dentro del innerHTML de una caja
//      class="sp-modal" — localizado por el `innerHTML=`` más cercano hacia
//      atrás y cerrado con un escáner de plantillas que respeta ${...}
//      anidados (incluidas plantillas DENTRO de un ${...}, como el
//      `${pilotos.map(p=>\`...\`)}` de en-grid.js/en-team.js: un simple
//      "busca el siguiente backtick" corta ahí a mitad de caja y se deja
//      colores reales sin mirar — comprobado: sin el escáner con pila, 4 de
//      las 11 cajas se cortan a mitad y se pierden colores reales, por
//      ejemplo color:#22c55e y color:#F5A623 en en-grid.js:655).
//   2. Solo ve colores hexadecimales LITERALES dentro de un `color:#rrggbb`
//      directo. Dentro de una caja de modal también hay colores que llegan
//      por INTERPOLACIÓN JS (`color:${...}`), y este test NO los barre —
//      pero no todos son igual de imposibles:
//        - una variable opaca calculada antes (`color:${col}`) es invisible
//          de verdad para un test estático: no hay forma de saber qué valor
//          tomará sin ejecutar la app.
//        - un ternario entre dos literales (`color:${excluded?'#333':'#9ca3af'}`,
//          en-advanced.js:422) SÍ sería extraíble en principio con una regex
//          algo más compleja. No barrerlo aquí es una decisión de ALCANCE de
//          esta ronda, no una imposibilidad técnica — queda fuera a
//          propósito (hoy los que caen dentro de una caja de modal son
//          inocuos), no porque no se pueda.
//   3. Si el mismo style="" que declara `color:` también declara un
//      `background` (o `background-color`) OPACO con hex literal de 3 o 6
//      dígitos (ej. background:#F5A623), ese color NO se compara contra el
//      cristal: el texto no se compone con el material, se compone con su
//      propio fondo sólido (ej. el texto oscuro del botón "Comenzar ahora"
//      sobre background:#F5A623 en app.js). Esto es necesario para no acusar
//      en falso a texto oscuro sobre un botón de color vivo. Como
//      contrapartida, un fondo local puesto con var(--algo) o con
//      rgba()/hex de 8 dígitos (translúcido, como background:#ef444418 del
//      botón "Borrar") NO cuenta como opaco y el color SÍ se sigue
//      comprobando contra el cristal — porque a través de un fondo
//      translúcido el cristal se sigue viendo. Hoy ningún color que pasa el
//      umbral depende de esta distinción fina (todos los que tienen fondo
//      var() ya superan 4.5:1 igualmente), pero queda documentado por si deja
//      de ser así. Medir ese texto contra su PROPIO fondo local (en vez de
//      simplemente excluirlo) es cobertura nueva, diferida.
//   4. Solo mide hex de 3 y 6 dígitos: `hex()` no sabe expandir 4 u 8 dígitos
//      (con alfa) y los leería mal en vez de fallar — ver el test dedicado
//      más abajo, que hace que un hex de esa longitud falle RUIDOSAMENTE en
//      vez de colarse sin medir.
const FICHEROS_MODAL = ['app.js', 'en-advanced.js', 'en-grid.js', 'en-team.js', 'en-strategy.js'];

// Encuentra el backtick de cierre de un template literal que empieza en
// origen[inicio] (el backtick de apertura). No basta con buscar "el siguiente
// backtick": una plantilla anidada dentro de un ${...} (p.ej.
// `${pilotos.map(p=>\`<button>...</button>\`).join('')}`) abre y cierra sus
// propios backticks antes de que termine la plantilla exterior. Se sigue con
// una pila: dentro de texto de plantilla ('tpl') un backtick cierra el nivel
// actual; dentro de una expresión ${...} ('expr') una llave abre otro nivel y
// otro backtick abre una plantilla anidada.
function finDePlantilla(origen, inicio) {
  const pila = ['tpl'];
  let i = inicio + 1;
  while (i < origen.length) {
    const c = origen[i];
    const tope = pila[pila.length - 1];
    if (tope === 'tpl') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { pila.pop(); if (pila.length === 0) return i; i++; continue; }
      if (c === '$' && origen[i + 1] === '{') { pila.push('expr'); i += 2; continue; }
      i++;
    } else {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { pila.push('tpl'); i++; continue; }
      if (c === '{') { pila.push('expr'); i++; continue; }
      if (c === '}') { pila.pop(); i++; continue; }
      i++;
    }
  }
  throw new Error(`plantilla sin cerrar desde la posición ${inicio}`);
}

// Devuelve el HTML (el innerHTML entero) de cada caja class="sp-modal" del
// fichero, en el mismo orden en que aparece en el código.
function cajasModalDe(src) {
  const cajas = [];
  const vistos = new Set();
  const anclaRe = /class="sp-modal"/g;
  let ancla;
  while ((ancla = anclaRe.exec(src))) {
    const antes = src.slice(0, ancla.index);
    const idxInner = antes.lastIndexOf('innerHTML');
    if (idxInner === -1) throw new Error('una caja sp-modal no tiene un innerHTML= antes');
    const inicio = src.indexOf('`', idxInner);
    if (vistos.has(inicio)) continue; // misma caja, no la proceses dos veces
    vistos.add(inicio);
    const fin = finDePlantilla(src, inicio);
    cajas.push(src.slice(inicio + 1, fin));
  }
  return cajas;
}

// Comprueba si un style="" declara un fondo local OPACO (hex de 8 dígitos no
// cuenta: lleva alfa y es translúcido).
function tieneFondoLocalOpaco(style) {
  const m = style.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/);
  if (!m) return false;
  const v = m[1].trim();
  return /^#[0-9a-fA-F]{3}$/.test(v) || /^#[0-9a-fA-F]{6}$/.test(v);
}

// Todas las apariciones de `color:#hex` de un style="", SIN filtrar por
// longitud — quien llama decide qué hacer con cada una. Descarta
// background-color/border-color (que no son color de TEXTO), comprobando que
// el carácter previo a "color" no sea una letra ni un guion.
function coloresDeEstilo(style) {
  const out = [];
  const colorRe = /color\s*:\s*#([0-9a-fA-F]{3,8})\b/g;
  let cm;
  while ((cm = colorRe.exec(style))) {
    const previo = style[cm.index - 1];
    if (previo !== undefined && /[a-zA-Z-]/.test(previo)) continue; // background-color, border-color…
    out.push(cm[1]);
  }
  return out;
}

// Recorre una caja y separa sus colores de texto en dos cubos: los que
// hex() sabe leer (3 o 6 dígitos) y los que no (4 u 8, con alfa) — estos
// últimos no se miden aquí, los caza el test dedicado de más abajo.
// `ocurrencias` lleva CADA aparición sin deduplicar (para poder contar
// "3 veces", no solo "existe") — `medibles` es el Set deduplicado que usan
// los tests de "qué colores hay".
function extraeColoresDeCaja(caja) {
  const medibles = new Set();
  const ocurrencias = [];
  const noMedibles = [];
  const estiloRe = /style="([^"]*)"/g;
  let m;
  while ((m = estiloRe.exec(caja))) {
    const style = m[1];
    if (tieneFondoLocalOpaco(style)) continue; // punto 3 del alcance: fondo propio, no compone con el cristal
    for (const raw of coloresDeEstilo(style)) {
      if (raw.length === 3 || raw.length === 6) {
        const c = '#' + raw.toLowerCase();
        medibles.add(c);
        ocurrencias.push(c);
      } else {
        noMedibles.push('#' + raw.toLowerCase());
      }
    }
  }
  return { medibles, ocurrencias, noMedibles };
}

// R1 (ronda de arreglo 1): antes, "se encuentran los N colores esperados"
// interpolaba N del propio resultado — la única aserción real era size > 0,
// así que si la extracción se quedaba corta (el modo de fallo que YA
// documentamos arriba: el escáner ingenuo cortaba 4 de las 11 cajas), el
// test seguía en verde con menos colores. Ahora la lista esperada es una
// constante fija, comparada con deepStrictEqual: si mañana se añade o se
// quita un color legítimo, hay que tocar esta lista A PROPÓSITO.
// Tarea 4b: '#3a3b42' salió de esta lista A PROPÓSITO — la etiqueta
// "Listado de vueltas" (en-team.js) pasó a color:var(--text-3), así que ya
// no existe como literal y ahora lo vigila el grupo de --text-3 de arriba.
const COLORES_ESPERADOS = [
  '#22c55e', '#60a5fa', '#e4e6ed',
  '#ef4444', '#f2f2f6', '#f5a623', '#fbbf24', '#fff',
];
const CAJAS_ESPERADAS = 11; // mismo número que vigila tests/glass.test.js

const coloresEncontrados = new Set();
const noMediblesEncontrados = [];
// Cuenta apariciones por color Y por fichero — no solo si el color existe en
// alguna parte. Lo usa el test de la lista de excepciones (R4, más abajo)
// para que un color exceptuado reutilizado en un sitio NUEVO, o una vez de
// más en el mismo sitio, también ponga el test en rojo.
const contadorPorColorYFichero = {}; // { '#hex': { 'fichero.js': n } }
let totalCajas = 0;

for (const f of FICHEROS_MODAL) {
  const cajas = cajasModalDe(leer('src/' + f));
  totalCajas += cajas.length;
  for (const caja of cajas) {
    const { medibles, ocurrencias, noMedibles } = extraeColoresDeCaja(caja);
    for (const c of medibles) coloresEncontrados.add(c);
    for (const c of ocurrencias) {
      if (!contadorPorColorYFichero[c]) contadorPorColorYFichero[c] = {};
      contadorPorColorYFichero[c][f] = (contadorPorColorYFichero[c][f] || 0) + 1;
    }
    noMediblesEncontrados.push(...noMedibles);
  }
}

// Lista de excepciones explícita — mismo patrón que la lista blanca de
// backdrop-filter en tests/glass.test.js: una entrada aquí no es un permiso
// en blanco, es una excepción NOMBRADA con su contraste medido, sus
// apariciones fijadas por fichero ({ 'fichero.js': n }) y su motivo.
//
// VACÍA A PROPÓSITO desde la Tarea 4b, y eso es lo normal: las dos entradas
// que la ocupaban se cerraron ahumando el material denso (#ef4444 pasó a
// cumplir 4,5:1) y apuntando la etiqueta "Listado de vueltas" a var(--text-3)
// (#3a3b42 dejó de existir como literal). Si algún día vuelve a tener
// entradas, es que alguien metió un color que no cumple y decidió
// documentarlo en vez de arreglarlo — eso es una decisión del dueño del
// proyecto, no un atajo.
const EXCEPCIONES = {};

console.log('\ncontraste de los colores de texto literales en las cajas de modal (--panel-bg denso)');

test(`se encuentran las ${CAJAS_ESPERADAS} cajas de modal esperadas`, () => {
  strictEqual(totalCajas, CAJAS_ESPERADAS,
    `se han encontrado ${totalCajas} cajas sp-modal, se esperaban ${CAJAS_ESPERADAS} — ` +
    `si es una caja NUEVA legítima, actualiza CAJAS_ESPERADAS a propósito`);
});

test('los colores de texto literales encontrados son exactamente los esperados', () => {
  deepStrictEqual([...coloresEncontrados].sort(), [...COLORES_ESPERADOS].sort(),
    'la lista de colores literales encontrados cambió respecto a COLORES_ESPERADOS — ' +
    'si es un color NUEVO legítimo, añádelo a la constante a propósito (y decide si necesita entrar también en EXCEPCIONES)');
});

test('ningún color de texto usa un hex de 4 u 8 dígitos que hex() no sepa leer', () => {
  ok(noMediblesEncontrados.length === 0,
    `color(es) con hex de longitud no soportada: ${noMediblesEncontrados.join(', ')} — ` +
    `hex() solo lee 3 o 6 dígitos; conviértelos a 6 dígitos o extiende hex() antes de que este test pueda fiarse de ellos`);
});

// Con EXCEPCIONES vacía este test NO pasa "por vacío": la extracción que
// alimenta coloresEncontrados está vigilada por los dos tests de arriba (11
// cajas, 8 colores exactos), y aquí se mide CADA color contra la superficie
// densa real. Lo que se afirma es que ninguno baja de 4,5:1; si alguno baja,
// el mensaje dice cuál, cuánto da y en qué fichero(s) vive.
test('ningún color de texto literal baja de 4.5:1 sobre el cristal denso (salvo excepción documentada)', () => {
  const superficie = superficieDelCristal({ densa: true, base: '--panel-bg' });
  const porDebajo = [...coloresEncontrados]
    .map(c => ({ color: c, contraste: contraste(hex(c), superficie) }))
    .filter(x => x.contraste < 4.5)
    .sort((a, b) => (a.color < b.color ? -1 : 1));
  const esperados = Object.keys(EXCEPCIONES).sort();
  const detalle = porDebajo.map(x =>
    `${x.color} da ${x.contraste.toFixed(3)}:1 (vive en ${Object.keys(contadorPorColorYFichero[x.color] || {}).join(', ') || 'fichero no localizado'})`
  ).join('; ');
  deepStrictEqual(porDebajo.map(x => x.color), esperados,
    `color(es) por debajo de 4.5:1 sobre el cristal denso: ${detalle} — ` +
    `se ajusta el MATERIAL o el color del texto, nunca el umbral; ` +
    `documentarlo en EXCEPCIONES es el último recurso y lo decide el dueño del proyecto`);
});

// Mientras EXCEPCIONES está vacía este bucle da cero vueltas y no afirma
// nada — la vigilancia real la lleva el test de arriba. Se conserva porque se
// re-arma solo: en cuanto alguien documente una excepción, vuelve a fijar en
// qué fichero y cuántas veces aparece, para que no sea un permiso en blanco.
test('los colores exceptuados aparecen solo donde y las veces documentadas — no es una puerta abierta', () => {
  for (const [color, datos] of Object.entries(EXCEPCIONES)) {
    const real = contadorPorColorYFichero[color] || {};
    deepStrictEqual(real, datos.apariciones,
      `${color} aparece hoy en ${JSON.stringify(real)}, pero la excepción documenta ${JSON.stringify(datos.apariciones)} — ` +
      `si es un sitio o una cantidad NUEVA, decide a propósito si sigue justificado y actualiza "apariciones", no dejes que se cuele solo`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// BARRIDO DE LOS LITERALES DEL MATERIAL NORMAL — las baldosas .sp-kpi.
//
// Por qué existe: hasta la revisión final este fichero barría literales SOLO
// dentro de las 11 cajas .sp-modal y SOLO contra el material denso. El
// material normal no tenía barrido de literales ninguno, y ahí es justo donde
// vivía el fallo crítico de la entrega: .sp-header y .sp-kpi compartían la
// regla de material, el velo se componía DOS VECES sobre el mismo píxel y los
// siete colores de la cabecera caían por debajo del suelo (#ef4444 —la llamada
// a boxes— en 2,41:1 sobre píxeles reales). Ningún test lo vio. Este grupo
// cierra ese agujero.
//
// Las baldosas se miden contra la superficie SIN mancha (conMancha:false), que
// para ellas es exacta: cuelgan de .sp-header, que ahora es opaco.
//
// LAS DOS VÍAS por las que llega un color, y las dos están cubiertas:
//   a) literal directo:      style="color:#c084fc"
//   b) interpolación JS:     style="color:${...}"
//      - ternario entre literales escrito ahí mismo
//        (`${inPit>0?'#f87171':'#22c55e'}`), y
//      - ternario entre literales asignado antes a una const del MISMO fichero
//        y usado después (`const stintColor=stintPct>85?'#ef4444':…` en
//        en-grid.js:279, usado como `color:${stintColor}` en :325).
//        Esta segunda vía es la que el ledger tenía diferida —"el barrido no
//        mira dentro de ternarios"— y es donde vive el color que fallaba, así
//        que ya no es opcional.
//
// LO QUE SIGUE FUERA, a propósito y con su guardián:
//   - Una interpolación que NO resuelve a literales (`${myTrend.color}`: viene
//     de _enTrend, en otro fichero, y hay que ejecutar la app para saber su
//     valor) es invisible para un test estático. No se mide — pero tampoco se
//     ignora en silencio: la lista INTERPOLACIONES_OPACAS de abajo fija cuáles
//     son, así que una interpolación NUEVA que no resuelva pone el test en rojo
//     en vez de colarse sin medir.
//   - Las tarjetas .en-strat-card / .en-team-card NO entran en este barrido.
//     Llevan el mismo material normal, pero (1) su fondo real SÍ incluye la
//     capa de profundidad —medido en el banco: la mancha fría llega al 0,092
//     de 0,10 bajo los literales rojos de la esquina inferior derecha— y ahí
//     este mismo modelo da #ef4444 = 4,14:1 (4,04 con la mancha ámbar a tope,
//     frente a 2,99-3,49 antes de ahumar el material), y (2) su contenido
//     mezcla colores deliberadamente apagados (#555, #333, #9ca3af, #2a2b2e)
//     que son separadores y marcadores de "sin dato", no texto, y que ningún
//     material arregla. Barrerlas exige
//     antes triar esos apagados y una decisión sobre la capa de profundidad
//     que NO es del test. Queda reportado con sus números, no exceptuado:
//     EXCEPCIONES sigue vacía.
const FICHEROS_BALDOSA = ['en-grid.js', 'sprint.js'];
const BALDOSAS_ESPERADAS = { 'en-grid.js': 5, 'sprint.js': 4 };

// Recorta el <div class="sp-kpi"> … </div> completo emparejando <div>/</div>.
// No vale "hasta el siguiente </div>": cada baldosa lleva tres divs dentro
// (etiqueta, valor y subtítulo) y ese corte se quedaría con la primera línea.
function baldosasKpiDe(src) {
  const cajas = [];
  const anclaRe = /class="sp-kpi"/g;
  let ancla;
  while ((ancla = anclaRe.exec(src))) {
    const inicio = src.lastIndexOf('<div', ancla.index);
    if (inicio === -1) throw new Error('una baldosa sp-kpi no tiene un <div de apertura antes');
    const tagRe = /<div\b|<\/div>/g;
    tagRe.lastIndex = inicio;
    let prof = 0, fin = -1, t;
    while ((t = tagRe.exec(src))) {
      if (t[0] === '</div>') { prof--; if (prof === 0) { fin = t.index + '</div>'.length; break; } }
      else prof++;
    }
    if (fin === -1) throw new Error(`la baldosa sp-kpi que empieza en ${inicio} no cierra su <div>`);
    const caja = src.slice(inicio, fin);
    // Una baldosa no contiene otra: si el emparejado se descontrolara y se
    // tragara varias, este test lo dice en vez de medir de más.
    if ((caja.match(/class="sp-kpi"/g) || []).length !== 1)
      throw new Error(`el recorte de una baldosa sp-kpi se ha tragado otra: ${caja.slice(0, 120)}…`);
    cajas.push(caja);
  }
  return cajas;
}

// Hex entrecomillados dentro de una expresión JS: '#ef4444', "#22c55e"…
function literalesDeExpresion(expr) {
  return [...expr.matchAll(/['"](#[0-9a-fA-F]{3,8})['"]/g)].map(m => m[1].toLowerCase());
}

// Resuelve `${…}`: primero los literales escritos en la propia expresión; si
// no hay ninguno y la expresión es un identificador simple, se busca su
// declaración en el mismo fichero y se miran SUS literales. Si sigue sin
// resolver, se devuelve como opaca (y la caza la lista de abajo).
function resolverInterpolacion(expr, src) {
  const directos = literalesDeExpresion(expr);
  if (directos.length) return { colores: directos, opaca: null };
  const id = expr.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(id)) {
    const decl = src.match(new RegExp(`\\b(?:const|let|var)\\s+${id}\\s*=\\s*([^;]+);`));
    if (decl) {
      const colores = literalesDeExpresion(decl[1]);
      if (colores.length) return { colores, opaca: null };
    }
  }
  return { colores: [], opaca: id };
}

// Valores de `color:` de un style="", tal cual: o un #hex, o un ${…}.
// Mismo guardia que coloresDeEstilo() para no confundir background-color ni
// border-color con el color del TEXTO.
function valoresDeColorDeEstilo(style) {
  const out = [];
  const re = /color\s*:\s*(#[0-9a-fA-F]{3,8}|\$\{[^}]*\})/g;
  let m;
  while ((m = re.exec(style))) {
    const previo = style[m.index - 1];
    if (previo !== undefined && /[a-zA-Z-]/.test(previo)) continue;
    out.push(m[1]);
  }
  return out;
}

const coloresBaldosa = new Set();
const noMediblesBaldosa = [];
const interpolacionesOpacas = {}; // { 'fichero.js': ['expr', …] }
const baldosasPorFichero = {};

for (const f of FICHEROS_BALDOSA) {
  const src = leer('src/' + f);
  const baldosas = baldosasKpiDe(src);
  baldosasPorFichero[f] = baldosas.length;
  for (const caja of baldosas) {
    const estiloRe = /style="([^"]*)"/g;
    let m;
    while ((m = estiloRe.exec(caja))) {
      const style = m[1];
      if (tieneFondoLocalOpaco(style)) continue; // fondo propio: no compone con el cristal
      for (const valor of valoresDeColorDeEstilo(style)) {
        const crudos = [];
        if (valor.startsWith('${')) {
          const { colores, opaca } = resolverInterpolacion(valor.slice(2, -1), src);
          if (opaca !== null) {
            (interpolacionesOpacas[f] = interpolacionesOpacas[f] || []).push(opaca);
            continue;
          }
          crudos.push(...colores);
        } else {
          crudos.push(valor.toLowerCase());
        }
        for (const c of crudos) {
          const dig = c.slice(1);
          if (dig.length === 3 || dig.length === 6) coloresBaldosa.add(c);
          else noMediblesBaldosa.push(c);
        }
      }
    }
  }
}

// Lista fija, igual que COLORES_ESPERADOS del grupo denso: si mañana aparece o
// desaparece un color en una baldosa, hay que tocar esta constante A PROPÓSITO.
const COLORES_BALDOSA_ESPERADOS = [
  '#22c55e', '#60a5fa', '#c084fc', '#ef4444',
  '#f5a623', '#f87171', '#f97316', '#fbbf24', '#fff',
];
// Interpolaciones que no resuelven a literales, por fichero. Ver el bloque de
// alcance de arriba.
const INTERPOLACIONES_OPACAS = { 'en-grid.js': ['myTrend.color'] };

console.log('\ncontraste de los colores de texto literales de las baldosas .sp-kpi (velo normal sobre la cabecera mate)');

test('se encuentran las baldosas .sp-kpi esperadas en cada fichero', () => {
  deepStrictEqual(baldosasPorFichero, BALDOSAS_ESPERADAS,
    'el número de baldosas sp-kpi cambió — si es una baldosa NUEVA legítima, ' +
    'actualiza BALDOSAS_ESPERADAS a propósito');
});

test('los colores literales de las baldosas son exactamente los esperados', () => {
  deepStrictEqual([...coloresBaldosa].sort(), [...COLORES_BALDOSA_ESPERADOS].sort(),
    'la lista de colores de las baldosas cambió respecto a COLORES_BALDOSA_ESPERADOS — ' +
    'si es un color NUEVO legítimo, añádelo a la constante a propósito');
});

test('el ternario de stintColor entra en el barrido (es donde vivía el fallo)', () => {
  // Aserción explícita, no confiada al recuento: si un refactor rompiera la
  // resolución de consts, la lista de arriba fallaría por otro motivo y este
  // test dice exactamente cuál es la vía que se ha perdido.
  for (const c of ['#ef4444', '#fbbf24', '#22c55e']) {
    ok(coloresBaldosa.has(c),
      `${c} es una de las ramas de stintColor (src/en-grid.js) y el barrido no lo ha visto — ` +
      `¿ha dejado de resolver los ternarios asignados a una const?`);
  }
});

test('las interpolaciones que no resuelven a literales son exactamente las documentadas', () => {
  const real = {};
  for (const [f, xs] of Object.entries(interpolacionesOpacas)) real[f] = [...new Set(xs)].sort();
  deepStrictEqual(real, INTERPOLACIONES_OPACAS,
    'ha aparecido (o desaparecido) una interpolación de color que el barrido no sabe resolver — ' +
    'no se puede medir sin ejecutar la app, así que decide a propósito si se documenta aquí o ' +
    'se reescribe como ternario entre literales');
});

test('ningún color de las baldosas usa un hex de 4 u 8 dígitos que hex() no sepa leer', () => {
  ok(noMediblesBaldosa.length === 0,
    `color(es) con hex de longitud no soportada: ${noMediblesBaldosa.join(', ')}`);
});

test('ningún color literal de las baldosas baja de 4.5:1 sobre el material normal', () => {
  const superficie = superficieDelCristal({ densa: false, base: '--panel-bg', conMancha: false });
  const porDebajo = [...coloresBaldosa]
    .map(c => ({ color: c, contraste: contraste(hex(c), superficie) }))
    .filter(x => x.contraste < 4.5)
    .sort((a, b) => (a.color < b.color ? -1 : 1));
  const detalle = porDebajo.map(x => `${x.color} da ${x.contraste.toFixed(3)}:1`).join('; ');
  deepStrictEqual(porDebajo.map(x => x.color), Object.keys(EXCEPCIONES).sort(),
    `color(es) por debajo de 4.5:1 sobre el material normal: ${detalle} — ` +
    `la palanca es el COLOR BASE del material (--glass-a/--glass-b en src/styles.css), ` +
    `nunca el umbral, ni la lista de excepciones, ni el color de marca`);
});

test('la cabecera mate es más oscura que la baldosa que sostiene (no hay doble velo)', () => {
  // Quien caza el doble velo es el guardián por SELECTOR de glass.test.js
  // ('.sp-header no lleva material'). Esto vigila lo otro: que ahumar el
  // material no llegue tan lejos que la baldosa se funda con la cabecera y
  // desaparezca la separación de bloques —el mismo defecto que la revisión
  // encontró en modo ☀ (I2), aquí en modo normal—. Es la cota INFERIOR del
  // ahumado, igual que el test de 4,5:1 de arriba es la superior: entre las
  // dos queda el rango donde el material puede calibrarse.
  const cabecera = hex(token('--panel-bg'));
  const baldosa = superficieDelCristal({ densa: false, base: '--panel-bg', conMancha: false });
  ok(luminancia(baldosa) > luminancia(cabecera),
    `la baldosa (${baldosa.map(Math.round)}) no destaca sobre la cabecera (${cabecera})`);
});


console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
