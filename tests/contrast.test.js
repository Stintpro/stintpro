// StintPro — contraste del texto sobre el cristal, EN LOS DOS MODOS.
// En modo normal compone la capa de profundidad y el material sobre el fondo;
// en modo ☀ (body.hc) el material está apagado y la superficie es un color
// opaco. Los dos exigen 4.5:1.
// SI ESTE TEST SE PONE ROJO, SE AJUSTA EL MATERIAL O EL TOKEN DEL COLOR —
// EL UMBRAL NO SE TOCA.
// Ejecutar: node tests/contrast.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const { ok, strictEqual, deepStrictEqual } = require('assert/strict');
const { rulesOf, extractInjectedCss } = require('../tools/css-extract');

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

// R16, segundo juego. El modo ☀ (body.hc) redeclara sus propios valores para
// varios de estos tokens, así que medirlo exige LEER ESE BLOQUE — pero sin
// relajar el anclaje de :root, que es justo lo que R16 prohíbe: se aísla
// body.hc con su PROPIO anclaje explícito, con el mismo extractor de reglas, y
// cada modo lee solo de su bloque. Un token que body.hc no redeclara (p. ej.
// --panel-bg) lo HEREDA de :root, igual que hace la cascada de verdad.
const bloqueHc = reglasStyles.find(r => r.selector === 'body.hc');
if (!bloqueHc) throw new Error('no se encontró el bloque body.hc en src/styles.css');

// La ÚLTIMA declaración del token dentro del bloque, no la primera. Es la
// última esquina viva de R16, y el modo de fallo que el ruling nombra: dentro
// de un mismo bloque, un token declarado dos veces lo resuelve la cascada con
// el ÚLTIMO valor, y `match()` sin flag global devuelve el PRIMERO. Con la
// versión anterior bastaba con añadir un segundo `--state-alert: #ef4444;` al
// final de body.hc para dejar el modo ☀ realmente roto con el test en verde —
// ni el guardián de "el modo normal no se mueve" se enteraba. Con matchAll y
// la última coincidencia, el test mide lo que el navegador pinta.
function declaracion(bloque, nombre) {
  const todas = [...bloque.body.matchAll(new RegExp(`${nombre}\\s*:\\s*([^;]+);`, 'g'))];
  return todas.length ? todas[todas.length - 1][1].trim() : null;
}
function token(nombre) {
  const v = declaracion(bloqueRoot, nombre);
  if (v === null) throw new Error(`el token ${nombre} no está declarado en :root`);
  return v;
}
function tokenHc(nombre) {
  const v = declaracion(bloqueHc, nombre);
  return v !== null ? v : token(nombre);
}
// Los dos modos, como pareja de lectores. `nombre` identifica el modo en los
// mensajes de fallo; `leer` es el lector de tokens de ese modo.
const MODOS = [
  { nombre: 'normal', leer: token },
  { nombre: '☀ contraste', leer: tokenHc },
];

// Sigue las cadenas var(--x) dentro de UN modo, hasta llegar a un valor que ya
// no es una redirección. En body.hc el material se apaga apuntando --glass-a a
// var(--panel-surface), así que sin esto no se llegaría al color real.
function resolverToken(nombre, leer, saltos = 0) {
  if (saltos > 10) throw new Error(`cadena de var() sin fin resolviendo ${nombre}`);
  const v = leer(nombre);
  const m = v.match(/^var\((--[\w-]+)\)$/);
  return m ? resolverToken(m[1], leer, saltos + 1) : v;
}
// Un valor de color escrito en el marcado: o un #hex tal cual, o un var(--x)
// que hay que resolver en el modo que toque.
function resolverValor(valor, leer) {
  const m = valor.match(/^var\((--[\w-]+)\)$/);
  return m ? resolverToken(m[1], leer) : valor;
}
const HEX_OPACO = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

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

// ─────────────────────────────────────────────────────────────────────────
// LA SUPERFICIE DEL MODO ☀. Hasta esta ronda, TODO este fichero medía solo el
// juego de :root: el modo contraste —el refugio para sol directo en el
// circuito, que es donde MÁS falta hace el suelo de 4,5:1— no lo comprobaba
// nadie. Este es el segundo juego.
//
// Su modelo es mucho más simple que el del modo normal, y no por simplificar:
// en body.hc el material se APAGA entero. El velo pasa a ser un hex opaco
// (--glass-a → var(--panel-surface) para las baldosas, --glass-denso-a →
// var(--panel-inset) para lo denso), el desenfoque va a 0, saturación y brillo
// a 100% y la capa de profundidad a transparent. No queda nada que componer:
// la superficie ES ese hex. Las tres premisas las comprueba el test de más
// abajo, para que el día que alguna deje de ser cierta este modelo no siga
// midiendo en verde un fondo que ya no existe.
function superficieHc({ densa }) {
  const velo = resolverToken(densa ? '--glass-denso-a' : '--glass-a', tokenHc);
  if (!HEX_OPACO.test(velo))
    throw new Error(`en ☀ el velo ${densa ? 'denso' : 'normal'} resuelve a "${velo}", que no es un hex opaco`);
  return hex(velo);
}

console.log('\nel modelo del modo ☀ sigue siendo válido');
test('en ☀ el material está apagado: velo opaco, sin desenfoque ni filtros ni profundidad', () => {
  for (const densa of [false, true]) {
    const velo = resolverToken(densa ? '--glass-denso-a' : '--glass-a', tokenHc);
    ok(HEX_OPACO.test(velo),
      `el velo ${densa ? 'denso' : 'normal'} de ☀ vale "${velo}": deja de ser opaco, así que ya no basta con medir contra él — hay que componerlo`);
  }
  strictEqual(parseFloat(tokenHc('--glass-sat')), 100, '--glass-sat ya no es 100% en ☀: el fondo se satura y el modelo simple deja de valer');
  strictEqual(parseFloat(tokenHc('--glass-bright')), 100, '--glass-bright ya no es 100% en ☀');
  for (const t of ['--depth-warm', '--depth-cool'])
    strictEqual(tokenHc(t), 'transparent', `${t} ya no es transparent en ☀: la capa de profundidad vuelve a llegar al material`);
});

console.log('\ncontraste del texto secundario sobre el material');
for (const densa of [false, true]) {
  const nombre = densa ? 'material denso' : 'material normal';
  test(`--text-3 alcanza 4.5:1 sobre el peor caso del ${nombre} (--panel-bg y --bg)`, () => {
    const { contraste: c, base } = peorCasoDelCristal(token('--text-3'), { densa });
    ok(c >= 4.5,
      `${c.toFixed(3)}:1 sobre el ${nombre}, base ${base.token} (${base.consumidor}) — ajusta el MATERIAL, no el umbral`);
  });
  test(`--text-3 alcanza 4.5:1 sobre el ${nombre} en ☀`, () => {
    const c = contraste(hex(tokenHc('--text-3')), superficieHc({ densa }));
    ok(c >= 4.5,
      `${tokenHc('--text-3')} da ${c.toFixed(3)}:1 sobre el ${nombre} de ☀ — la palanca es el token de body.hc, nunca el umbral`);
  });
}

console.log('\nel texto principal no puede estar peor que el secundario');
test('--text-1 supera a --text-3 en ☀', () => {
  const s = superficieHc({ densa: false });
  const c1 = contraste(hex(tokenHc('--text-1')), s);
  const c3 = contraste(hex(tokenHc('--text-3')), s);
  ok(c1 > c3, `en ☀ --text-1 da ${c1.toFixed(2)} y --text-3 da ${c3.toFixed(2)}`);
});
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

// El mismo barrido, en ☀. Los literales de las cajas de modal no cambian con el
// modo (son literales: por definición no pasan por ningún token), pero la
// superficie SÍ: en ☀ el denso deja de ser un velo compuesto y pasa a ser
// --panel-inset opaco. Medirlo aquí es lo que cierra el agujero: hasta ahora
// este fichero solo comprobaba el modo normal.
test('ningún color de texto literal baja de 4.5:1 sobre el cristal denso de ☀', () => {
  const superficie = superficieHc({ densa: true });
  const porDebajo = [...coloresEncontrados]
    .map(c => ({ color: c, contraste: contraste(hex(c), superficie) }))
    .filter(x => x.contraste < 4.5)
    .sort((a, b) => (a.color < b.color ? -1 : 1));
  const detalle = porDebajo.map(x =>
    `${x.color} da ${x.contraste.toFixed(3)}:1 (vive en ${Object.keys(contadorPorColorYFichero[x.color] || {}).join(', ') || 'fichero no localizado'})`
  ).join('; ');
  deepStrictEqual(porDebajo.map(x => x.color), Object.keys(EXCEPCIONES).sort(),
    `color(es) por debajo de 4.5:1 sobre el cristal denso en ☀: ${detalle} — ` +
    `en ☀ la palanca es --panel-inset (body.hc) o tokenizar ese color, nunca el umbral`);
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
// BARRIDO DE LOS COLORES DEL MATERIAL NORMAL — las baldosas .sp-kpi.
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
// Y lo mide en LOS DOS MODOS. El barrido nació midiendo solo el juego de
// :root, así que el modo ☀ —el refugio para sol directo, donde el suelo de
// 4,5:1 más falta hace— no lo comprobaba nadie: ahí #ef4444 daba 4,397:1 sobre
// la baldosa opaca y era el único color del panel por debajo del suelo. Ese
// color ya no es un literal: pasa por --state-alert, que body.hc aclara.
//
// En modo normal las baldosas se miden contra la superficie SIN mancha
// (conMancha:false), que para ellas es exacta: cuelgan de .sp-header, que
// ahora es opaco. En ☀ se miden contra superficieHc(), donde no hay nada que
// componer porque el material está apagado.
//
// LAS TRES VÍAS por las que llega un color, y las tres están cubiertas:
//   a) literal directo:      style="color:#c084fc"
//   b) token:                style="color:var(--state-ok)" — se resuelve en el
//      bloque del modo que se está midiendo (:root o body.hc), siguiendo las
//      cadenas var(--x) hasta el color.
//   c) interpolación JS:     style="color:${...}"
//      - ternario entre valores escrito ahí mismo
//        (`${inPit>0?'#f87171':'var(--state-ok)'}`), y
//      - ternario entre valores asignado antes a una const del MISMO fichero y
//        usado después (`const stintColor=stintPct>85?'var(--state-alert)':…`
//        en src/en-grid.js, usado como `color:${stintColor}` en la baldosa del
//        stint). Esta segunda vía es la que el ledger tenía diferida —"el
//        barrido no mira dentro de ternarios"— y es donde vive el color que
//        fallaba, así que ya no es opcional.
//
// LO QUE SIGUE FUERA, a propósito y con su guardián:
//   - Una interpolación que NO resuelve a literales (`${myTrend.color}`: viene
//     de _enTrend, en otro fichero, y hay que ejecutar la app para saber su
//     valor) es invisible para un test estático. No se mide — pero tampoco se
//     ignora en silencio: la lista INTERPOLACIONES_OPACAS de abajo fija cuáles
//     son, así que una interpolación NUEVA que no resuelva pone el test en rojo
//     en vez de colarse sin medir.
//   - Las tarjetas .en-strat-card / .en-team-card no entran en ESTE barrido:
//     tienen el suyo al final del fichero (R39), que afirma otra cosa —que sus
//     colores de ESTADO van por token— por dos motivos que siguen vigentes.
//     (1) Su fondo real SÍ incluye la capa de profundidad —medido en el banco:
//     la mancha fría llega al 0,092 de 0,10 bajo los literales rojos de la
//     esquina inferior derecha— y ahí este mismo modelo da #ef4444 = 4,14:1
//     (4,04 con la mancha ámbar a tope, frente a 2,99-3,49 antes de ahumar el
//     material): en modo NORMAL siguen por debajo del suelo, y eso es anterior
//     a la tokenización y no lo cambia (en :root el token vale el literal de
//     siempre). (2) Su contenido mezcla colores deliberadamente apagados
//     (#555, #333, #9ca3af, #2a2b2e) que son separadores y marcadores de "sin
//     dato", no texto, y que ningún material arregla. Auditarlas entera exige
//     triar esos apagados y una decisión sobre la capa de profundidad que NO
//     es del test. Queda reportado con sus números, no exceptuado: EXCEPCIONES
//     sigue vacía.
const FICHEROS_BALDOSA = ['en-grid.js', 'sprint.js'];
const BALDOSAS_ESPERADAS = { 'en-grid.js': 5, 'sprint.js': 4 };

// Recorta el <div class="LA-CLASE"> … </div> completo emparejando <div>/</div>.
// No vale "hasta el siguiente </div>": cada baldosa lleva tres divs dentro
// (etiqueta, valor y subtítulo) y ese corte se quedaría con la primera línea;
// las tarjetas llevan muchos más.
// Devuelve {inicio, texto} y no solo el texto porque quien resuelve una
// interpolación necesita saber DÓNDE se usa: una variable puede estar
// declarada varias veces en el mismo fichero y la que vale es la última antes
// del uso, no la primera del fichero.
function cajasPorClase(src, clase) {
  const cajas = [];
  const anclaRe = new RegExp(`class="${clase}"`, 'g');
  let ancla;
  while ((ancla = anclaRe.exec(src))) {
    const inicio = src.lastIndexOf('<div', ancla.index);
    if (inicio === -1) throw new Error(`una caja ${clase} no tiene un <div de apertura antes`);
    const tagRe = /<div\b|<\/div>/g;
    tagRe.lastIndex = inicio;
    let prof = 0, fin = -1, t;
    while ((t = tagRe.exec(src))) {
      if (t[0] === '</div>') { prof--; if (prof === 0) { fin = t.index + '</div>'.length; break; } }
      else prof++;
    }
    if (fin === -1) throw new Error(`la caja ${clase} que empieza en ${inicio} no cierra su <div>`);
    const texto = src.slice(inicio, fin);
    // Una caja no contiene otra de su misma clase: si el emparejado se
    // descontrolara y se tragara varias, este test lo dice en vez de medir de más.
    if ((texto.match(new RegExp(`class="${clase}"`, 'g')) || []).length !== 1)
      throw new Error(`el recorte de una caja ${clase} se ha tragado otra: ${texto.slice(0, 120)}…`);
    cajas.push({ inicio, texto });
  }
  return cajas;
}

// Valores de color entrecomillados dentro de una expresión JS: '#ef4444',
// "#22c55e"… y también 'var(--state-alert)', desde que los colores de estado
// dejaron de ser literales para que el modo ☀ pueda aclararlos.
function literalesDeExpresion(expr) {
  return [...expr.matchAll(/['"](#[0-9a-fA-F]{3,8}|var\(--[\w-]+\))['"]/g)].map(m => m[1].toLowerCase());
}

// Resuelve `${…}`: primero los literales escritos en la propia expresión; si
// no hay ninguno y la expresión es un identificador simple, se busca su
// declaración y se miran SUS literales. Si sigue sin resolver, se devuelve
// como opaca (y la caza la lista de documentadas).
//
// Dos precisiones que las tarjetas obligaron a añadir, porque sin ellas el
// barrido se creía resuelto y no lo estaba:
//   - La declaración es la ÚLTIMA ANTES DEL USO, no la primera del fichero.
//     src/en-team.js declara `col` tres veces con significados distintos (un
//     color de dato, y dos veces el color de identidad del piloto): coger la
//     primera es medir otra variable.
//   - Cuentan también las REASIGNACIONES entre esa declaración y el uso. El
//     patrón más común en estos ficheros es `let probColor='#9ca3af';` seguido
//     de una escalera de `else if(...){probColor='#ef4444';}`: mirando solo la
//     declaración, el barrido veía un gris inocuo y no veía ninguno de los
//     colores de estado que esa variable acaba pintando.
function resolverInterpolacion(expr, src, pos = src.length) {
  const directos = literalesDeExpresion(expr);
  if (directos.length) return { colores: directos, opaca: null };
  const id = expr.trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(id)) return { colores: [], opaca: id };
  const declRe = new RegExp(`\\b(?:const|let|var)\\s+${id}\\s*=\\s*([^;]+);`, 'g');
  let decl = null, m;
  while ((m = declRe.exec(src)) !== null && m.index < pos) decl = m;
  if (!decl) return { colores: [], opaca: id };
  const colores = [...literalesDeExpresion(decl[1])];
  // El guardia [^.\w$] delante del nombre evita confundir `t.evColor=` (otra
  // cosa) con `evColor=`; el [^;=] del valor evita tragarse un `==`/`===`.
  const asigRe = new RegExp(`(?:^|[^.\\w$])${id}\\s*=\\s*([^;=][^;]*);`, 'gm');
  asigRe.lastIndex = decl.index + decl[0].length;
  while ((m = asigRe.exec(src)) !== null && m.index < pos) colores.push(...literalesDeExpresion(m[1]));
  const unicos = [...new Set(colores)];
  return unicos.length ? { colores: unicos, opaca: null } : { colores: [], opaca: id };
}

// Valores de `color:` de un style="", tal cual: un #hex, un var(--x) o un ${…}.
// Mismo guardia que coloresDeEstilo() para no confundir background-color ni
// border-color con el color del TEXTO (y de paso, tampoco el color-mix() del
// relleno del degradado de .sp-kpi-sub: ahí "color" va seguido de "-", no de
// ":", así que no entra por este embudo — y no debe, porque es un fondo).
function valoresDeColorDeEstilo(style) {
  const out = [];
  const re = /color\s*:\s*(#[0-9a-fA-F]{3,8}|var\(--[\w-]+\)|\$\{[^}]*\})/g;
  let m;
  while ((m = re.exec(style))) {
    const previo = style[m.index - 1];
    if (previo !== undefined && /[a-zA-Z-]/.test(previo)) continue;
    out.push(m[1]);
  }
  return out;
}

// Cada valor de color TAL CUAL está escrito en el marcado: '#f97316',
// 'var(--state-ok)'… Se guarda SIN resolver a propósito, porque un var() vale
// una cosa en modo normal y otra en ☀, y este barrido mide los dos modos.
const valoresBaldosa = new Set();
const interpolacionesOpacas = {}; // { 'fichero.js': ['expr', …] }
const baldosasPorFichero = {};

// Recorre las cajas de una clase y reparte cada valor de `color:` en el
// destino que le toque: los que resuelven, al Set; los que no, a la lista de
// opacas de su fichero. Lo comparten el barrido de las baldosas y el de las
// tarjetas, que solo se diferencian en QUÉ afirman después.
function recogerColoresDeCajas(f, clase, destino, opacas) {
  const src = leer('src/' + f);
  const cajas = cajasPorClase(src, clase);
  for (const { inicio, texto } of cajas) {
    const estiloRe = /style="([^"]*)"/g;
    let m;
    while ((m = estiloRe.exec(texto))) {
      const style = m[1];
      if (tieneFondoLocalOpaco(style)) continue; // fondo propio: no compone con el cristal
      for (const valor of valoresDeColorDeEstilo(style)) {
        if (valor.startsWith('${')) {
          const { colores, opaca } = resolverInterpolacion(valor.slice(2, -1), src, inicio + m.index);
          if (opaca !== null) { (opacas[f] = opacas[f] || []).push(opaca); continue; }
          for (const c of colores) destino.add(c);
        } else {
          destino.add(valor.toLowerCase());
        }
      }
    }
  }
  return cajas.length;
}

for (const f of FICHEROS_BALDOSA) {
  baldosasPorFichero[f] = recogerColoresDeCajas(f, 'sp-kpi', valoresBaldosa, interpolacionesOpacas);
}

// Resuelve el juego entero de valores DENTRO DE UN MODO y separa lo medible de
// lo que hex() no sabe leer: un hex de 4 u 8 dígitos (lleva alfa) o un token
// que no acaba resolviendo a un color. Nada se descarta en silencio.
function coloresDeBaldosaEn(leerToken) {
  const medibles = [], raros = [];
  for (const valor of valoresBaldosa) {
    const resuelto = resolverValor(valor, leerToken).toLowerCase();
    const dig = resuelto.startsWith('#') ? resuelto.slice(1) : '';
    if (dig.length === 3 || dig.length === 6) medibles.push({ valor, color: resuelto });
    else raros.push(valor === resuelto ? valor : `${valor} → ${resuelto}`);
  }
  return { medibles, raros };
}
// Etiqueta para los mensajes de fallo: si el color llegó por token, se nombran
// el token Y el color al que resolvió. Sin esto, un fallo en ☀ diría
// "var(--state-alert)" sin decir qué color se está midiendo.
const etiquetaDeColor = x => (x.valor === x.color ? x.color : `${x.valor} → ${x.color}`);

// Mide un juego de colores contra una superficie y devuelve los que no llegan
// al suelo, ordenados. Lo comparten el modo normal y el ☀.
function pordebajoDe45(medibles, superficie) {
  return medibles
    .map(x => ({ ...x, contraste: contraste(hex(x.color), superficie) }))
    .filter(x => x.contraste < 4.5)
    .sort((a, b) => (a.color < b.color ? -1 : 1));
}

// Lista fija, igual que COLORES_ESPERADOS del grupo denso: si mañana aparece o
// desaparece un valor de color en una baldosa, hay que tocar esta constante A
// PROPÓSITO. Los tres 'var(--state-*)' sustituyen a los literales '#ef4444',
// '#fbbf24' y '#22c55e' que estaban aquí antes de tokenizar los estados.
const VALORES_BALDOSA_ESPERADOS = [
  '#60a5fa', '#c084fc', '#f5a623', '#f87171', '#f97316', '#fff',
  'var(--state-alert)', 'var(--state-ok)', 'var(--state-warn)',
];
// Interpolaciones que no resuelven a literales, por fichero. Ver el bloque de
// alcance de arriba.
const INTERPOLACIONES_OPACAS = { 'en-grid.js': ['myTrend.color'] };
// Tokenizar NO puede mover el modo normal ni un píxel: en :root los tres
// tokens de estado valen EXACTAMENTE los literales que sustituyeron. Es el
// mismo papel que cumple tests/panel-tokens.test.js con las superficies del
// panel, y es lo que convierte "no cambia nada" en algo comprobable.
const ESTADO_EN_NORMAL = {
  '--state-alert': '#ef4444',
  '--state-warn':  '#fbbf24',
  '--state-ok':    '#22c55e',
};

console.log('\ncolores de las baldosas .sp-kpi — modo normal (velo sobre la cabecera mate) y modo ☀ (superficie opaca)');

test('se encuentran las baldosas .sp-kpi esperadas en cada fichero', () => {
  deepStrictEqual(baldosasPorFichero, BALDOSAS_ESPERADAS,
    'el número de baldosas sp-kpi cambió — si es una baldosa NUEVA legítima, ' +
    'actualiza BALDOSAS_ESPERADAS a propósito');
});

test('los valores de color de las baldosas son exactamente los esperados', () => {
  deepStrictEqual([...valoresBaldosa].sort(), [...VALORES_BALDOSA_ESPERADOS].sort(),
    'la lista de valores de color de las baldosas cambió respecto a VALORES_BALDOSA_ESPERADOS — ' +
    'si es un color NUEVO legítimo, añádelo a la constante a propósito');
});

test('los tokens de estado valen en :root los literales que sustituyeron (el modo normal no se mueve)', () => {
  for (const [t, valor] of Object.entries(ESTADO_EN_NORMAL))
    strictEqual(token(t).toLowerCase(), valor,
      `${t} vale ${token(t)} en :root y debería valer ${valor} — tokenizar los estados NO puede cambiar el modo normal; ` +
      `si quieres cambiar el color del modo ☀, el sitio es body.hc`);
});

test('las tres ramas de stintColor entran en el barrido (es donde vivía el fallo)', () => {
  // Aserción explícita, no confiada al recuento: si un refactor rompiera la
  // resolución de consts, la lista de arriba fallaría por otro motivo y este
  // test dice exactamente cuál es la vía que se ha perdido.
  for (const v of ['var(--state-alert)', 'var(--state-warn)', 'var(--state-ok)']) {
    ok(valoresBaldosa.has(v),
      `${v} es una de las ramas de stintColor (src/en-grid.js) y el barrido no lo ha visto — ` +
      `¿ha dejado de resolver los ternarios asignados a una const, o ha vuelto a escribirse como literal?`);
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

for (const { nombre, leer } of MODOS) {
  test(`en modo ${nombre} todos los valores de las baldosas resuelven a un hex que hex() sabe leer`, () => {
    const { raros } = coloresDeBaldosaEn(leer);
    ok(raros.length === 0,
      `valor(es) que no resuelven a un hex de 3 o 6 dígitos en modo ${nombre}: ${raros.join(', ')} — ` +
      `hex() solo lee 3 o 6 dígitos; un token que resuelve a rgba() o a un hex con alfa se leería MAL en vez de fallar`);
  });
}

test('ningún color de las baldosas baja de 4.5:1 sobre el material normal', () => {
  const superficie = superficieDelCristal({ densa: false, base: '--panel-bg', conMancha: false });
  const porDebajo = pordebajoDe45(coloresDeBaldosaEn(token).medibles, superficie);
  const detalle = porDebajo.map(x => `${etiquetaDeColor(x)} da ${x.contraste.toFixed(3)}:1`).join('; ');
  deepStrictEqual(porDebajo.map(x => x.color), Object.keys(EXCEPCIONES).sort(),
    `color(es) por debajo de 4.5:1 sobre el material normal: ${detalle} — ` +
    `la palanca es el COLOR BASE del material (--glass-a/--glass-b en src/styles.css) o el token ` +
    `de estado en :root, nunca el umbral, ni la lista de excepciones`);
});

// EL GUARDIÁN QUE FALTABA. El modo ☀ es el refugio para sol directo en el
// circuito y hasta esta ronda no lo medía nadie: por eso #ef4444 —la llamada a
// boxes, el color más urgente del panel— llevaba 4,397:1 sobre la baldosa de ☀
// sin que ningún test lo dijera. Aquí la superficie es --panel-surface opaco,
// así que la palanca ya no es el material (en ☀ no hay material): es el token
// de estado de body.hc.
test('ningún color de las baldosas baja de 4.5:1 sobre la baldosa de ☀', () => {
  const superficie = superficieHc({ densa: false });
  const porDebajo = pordebajoDe45(coloresDeBaldosaEn(tokenHc).medibles, superficie);
  const detalle = porDebajo.map(x => `${etiquetaDeColor(x)} da ${x.contraste.toFixed(3)}:1`).join('; ');
  deepStrictEqual(porDebajo.map(x => x.color), Object.keys(EXCEPCIONES).sort(),
    `color(es) por debajo de 4.5:1 sobre la baldosa del modo ☀ (${superficie.map(Math.round)}): ${detalle} — ` +
    `la palanca es el token de estado en body.hc (src/styles.css), o --panel-surface; ` +
    `nunca el umbral ni la lista de excepciones`);
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


// ─────────────────────────────────────────────────────────────────────────
// BARRIDO DE LAS TARJETAS .en-strat-card / .en-team-card (R39).
//
// Por qué existe: el mismo fallo que se arregló en las baldosas seguía vivo
// dos pestañas más allá. Las tarjetas llevan el MISMO material normal, así que
// en ☀ su fondo también resuelve a --panel-surface (#1A1E2E), y ahí los tres
// literales de estado daban 4,397:1 (#ef4444), 9,912:1 (#fbbf24) y 7,262:1
// (#22c55e) — el rojo, que es el que dice "esto va mal", por debajo del suelo,
// en decenas de elementos de texto de la pestaña 🎯 Estrategia. Arreglar la
// llamada a boxes en la cabecera y dejarla rota en las tarjetas era entregar
// el arreglo a medias.
//
// LO QUE ESTE BARRIDO AFIRMA, Y SOLO ESO: que dentro de una tarjeta ningún
// color de TEXTO es un literal de estado. Tienen que ir por --state-*, que es
// lo que le da al modo ☀ la palanca para aclararlos.
//
// LO QUE NO AFIRMA, A PROPÓSITO: no audita todos los colores de las tarjetas.
// Su contenido mezcla apagados deliberados —#555 (2,220:1 en ☀), #333 (1,310),
// #2a2b2e (1,169), #6b7280 (3,423)— que son separadores y marcadores de "sin
// dato", no texto, y que ningún material arregla. Triarlos es un frente aparte
// y no se abre aquí. Al afirmar solo lo de los estados, esos apagados quedan
// fuera SIN necesidad de una excepción: EXCEPCIONES sigue vacía.
//
// LO QUE EL BARRIDO NO PUEDE VER (documentado, no ignorado):
//   - Un color que llega a la tarjeta a través de una función auxiliar
//     definida FUERA del recorte (kartRow en src/en-strategy.js, que pinta
//     `color:${minCol}` con el minCol que recibe). Se ha tokenizado igualmente
//     —los píxeles son lo que importa— pero el recorte por tarjeta no alcanza
//     a comprobarlo. Cubierto aparte, más abajo: un test nominal lee el texto
//     crudo de las declaraciones de minCol y stintWindowInfo (la otra función
//     que vive antes del <div class="en-strat-card"> y de la que minCol
//     cuelga) y exige que sus ramas de estado sean var(--state-*). Sin ese
//     test, re-literalizar minCol Y stintWindowInfo a la vez deja hasta 24
//     elementos de texto de "Karts en pista" (3 columnas × hasta 8 karts) rotos
//     en ☀ sin que ningún test lo diga.
//   - Una expresión que mezcla un literal con algo que no resuelve
//     (`${t.evColor||'#555'}`): se queda con el '#555' y da la expresión por
//     resuelta. El origen de t.evColor también se ha tokenizado a mano.
//   - Las interpolaciones que no resuelven a nada, que sí quedan fijadas en
//     INTERPOLACIONES_OPACAS_TARJETA: una nueva pone el test en rojo.
const FICHEROS_TARJETA = { 'en-strategy.js': 'en-strat-card', 'en-team.js': 'en-team-card' };
const TARJETAS_ESPERADAS = { 'en-strategy.js': 7, 'en-team.js': 6 };
const INTERPOLACIONES_OPACAS_TARJETA = {
  'en-strategy.js': ['kc.text'], // el color del dorsal, que sale de _enKartColor (otro fichero)
  'en-team.js': ['col'],         // la paleta de identidad del piloto: colors[idx%colors.length]
};

const valoresTarjeta = new Set();
const opacasTarjeta = {};
const tarjetasPorFichero = {};
for (const [f, clase] of Object.entries(FICHEROS_TARJETA)) {
  tarjetasPorFichero[f] = recogerColoresDeCajas(f, clase, valoresTarjeta, opacasTarjeta);
}

console.log('\ncolores de estado de las tarjetas .en-strat-card / .en-team-card (R39)');

test('se encuentran las tarjetas esperadas en cada fichero', () => {
  deepStrictEqual(tarjetasPorFichero, TARJETAS_ESPERADAS,
    'el número de tarjetas cambió — si es una tarjeta NUEVA legítima, actualiza ' +
    'TARJETAS_ESPERADAS a propósito (y comprueba que sus colores de estado van por token)');
});

test('las interpolaciones de las tarjetas que no resuelven son exactamente las documentadas', () => {
  const real = {};
  for (const [f, xs] of Object.entries(opacasTarjeta)) real[f] = [...new Set(xs)].sort();
  deepStrictEqual(real, INTERPOLACIONES_OPACAS_TARJETA,
    'ha aparecido (o desaparecido) una interpolación de color en una tarjeta que el barrido no ' +
    'sabe resolver — decide a propósito si se documenta aquí o se reescribe para que resuelva');
});

test('las tarjetas pintan los tres estados por token (el barrido no está vacío)', () => {
  // Sin esto, el test de abajo pasaría igual de verde con las tarjetas
  // vacías o con el recorte roto: afirma que NO hay literales de estado, y
  // "no hay ninguno" es cierto también cuando no se ha mirado nada.
  for (const v of ['var(--state-alert)', 'var(--state-warn)', 'var(--state-ok)']) {
    ok(valoresTarjeta.has(v),
      `${v} no aparece como color de texto en ninguna tarjeta — o el barrido ha dejado de ver ` +
      `dentro de ellas, o alguien ha quitado el token de un estado que sí se pinta ahí`);
  }
});

test('ningún color de texto de las tarjetas es un literal de estado (van por token)', () => {
  const superficie = superficieHc({ densa: false });
  const literalesDeEstado = Object.values(ESTADO_EN_NORMAL);
  const crudos = [...valoresTarjeta]
    .filter(v => literalesDeEstado.includes(v.toLowerCase()))
    .sort();
  const detalle = crudos.map(v =>
    `${v} (da ${contraste(hex(v), superficie).toFixed(3)}:1 sobre la tarjeta en ☀)`
  ).join('; ');
  deepStrictEqual(crudos, [],
    `las tarjetas pintan texto con literal(es) de estado: ${detalle} — ` +
    `un literal no pasa por ningún token y el modo ☀ no lo puede aclarar; ` +
    `escríbelo como var(--state-alert) / var(--state-warn) / var(--state-ok)`);
});

test('los colores de estado de las tarjetas llegan a 4.5:1 sobre la tarjeta de ☀', () => {
  // El token ya resuelto, medido contra la superficie real de la tarjeta en ☀.
  // Es la misma afirmación que en las baldosas: si mañana alguien recalibra
  // --state-* en body.hc, esto lo dice también aquí.
  //
  // SOLO ☀, y no es un descuido. En modo NORMAL las tarjetas componen con la
  // capa de profundidad (flotan sobre #screen-dash, no cuelgan de la cabecera
  // mate) y ahí este mismo modelo da --state-alert = 4,036:1 con la mancha
  // ámbar a tope. Ese 4,036:1 es el modelo, y el modelo es pesimista AQUÍ: supone
  // la mancha ámbar de profundidad al máximo, pero el centro de esa mancha cae
  // siempre bajo la cabecera —que es opaca— y además blur(28px) arrastra hacia
  // la tarjeta el entorno oscuro que la rodea. Medido sobre píxeles renderizados
  // en el banco, esas mismas tarjetas dan 4,54-4,82:1: por ENCIMA del suelo. El
  // número del modelo no se toca —sigue siendo el peor caso teórico y sigue
  // sirviendo de cota superior—, pero que quede escrito para que no se lea como
  // si el modo normal estuviera hoy por debajo de 4,5:1, porque en píxeles no lo
  // está.
  // Eso es ANTERIOR a esta ronda y sigue exactamente igual: en
  // :root el token vale el literal de siempre, así que no se ha movido ni un
  // píxel. Ya estaba reportado con sus números en el bloque de alcance del
  // barrido de baldosas —reportado, no exceptuado: EXCEPCIONES sigue vacía—, y
  // arreglarlo exige una decisión sobre el material o sobre la capa de
  // profundidad que no es de esta ronda. Afirmarlo aquí sería poner en rojo un
  // frente que nadie ha abierto; callarlo sería peor, y por eso está escrito.
  const usados = ['--state-alert', '--state-warn', '--state-ok']
    .filter(t => valoresTarjeta.has(`var(${t})`));
  strictEqual(usados.length, 3, 'las tarjetas deberían usar los tres estados');
  const superficie = superficieHc({ densa: false });
  for (const t of usados) {
    const color = resolverToken(t, tokenHc);
    const c = contraste(hex(color), superficie);
    ok(c >= 4.5,
      `${t} vale ${color} en ☀ y da ${c.toFixed(3)}:1 sobre la tarjeta — ` +
      `la palanca es el token de body.hc, nunca el umbral`);
  }
});

test('minCol y stintWindowInfo (fuera del recorte de tarjetas) pintan sus estados por token', () => {
  // El agujero que este test cierra: kartRow (que pinta `color:${minCol}` en su
  // propia plantilla) y stintWindowInfo están definidas ANTES de que se abra el
  // <div class="en-strat-card"> de "Karts en pista" — cajasPorClase() empieza a
  // emparejar llaves desde ahí, así que ninguna de las dos entra JAMÁS en el
  // recorte de la tarjeta: ni para verlas como token, ni para pillarlas si
  // volvieran a ser literal. Demostrado: re-literalizar a la vez la rama
  // "atrapado" de stintWindowInfo y las dos ramas coloreadas de minCol deja la
  // suite en 28/28 verde con unos 24 elementos de texto rotos en ☀ (3 columnas
  // × hasta 8 karts). Mismo patrón que el guardián de stintColor de arriba:
  // aserción nominal sobre las ramas conocidas, leyendo el texto crudo del
  // fichero — no confiada a un recorte por caja que aquí no llega.
  const srcEstrategia = leer('src/en-strategy.js');
  const literalesDeEstado = Object.values(ESTADO_EN_NORMAL);

  const declStintWindowInfo = srcEstrategia.match(/const stintWindowInfo=\(e\)=>\{[\s\S]*?\n  \};/);
  ok(declStintWindowInfo,
    'no se encuentra la declaración de stintWindowInfo en src/en-strategy.js — ¿cambió de forma? ' +
    'ajusta el regex de este test para que la siga viendo');
  const coloresStintWindowInfo = literalesDeExpresion(declStintWindowInfo[0]);
  ok(coloresStintWindowInfo.includes('var(--state-alert)'),
    'stintWindowInfo debería seguir marcando el caso "atrapado por deuda de paradas" con var(--state-alert)');
  for (const lit of literalesDeEstado)
    ok(!coloresStintWindowInfo.includes(lit),
      `stintWindowInfo pinta un estado con el literal ${lit} en vez de var(--state-*) — ` +
      `vive fuera del recorte de la tarjeta (antes del <div class="en-strat-card">), así que ` +
      `ningún barrido de arriba lo pilla; el modo ☀ tampoco podría aclararlo`);

  const declMinCol = srcEstrategia.match(/const minCol=info\.color\|\|[^\n]+;/);
  ok(declMinCol,
    'no se encuentra la declaración de minCol (columna "Buenos") en src/en-strategy.js — ¿cambió de forma? ' +
    'ajusta el regex de este test para que la siga viendo');
  const coloresMinCol = literalesDeExpresion(declMinCol[0]);
  for (const v of ['var(--state-ok)', 'var(--state-warn)'])
    ok(coloresMinCol.includes(v),
      `minCol debería tener la rama ${v} (según el tiempo restante hasta el mínimo) — ` +
      `¿ha dejado de resolver el ternario, o ha vuelto a escribirse como literal?`);
  for (const lit of literalesDeEstado)
    ok(!coloresMinCol.includes(lit),
      `minCol pinta un estado con el literal ${lit} en vez de var(--state-*) — ` +
      `kartRow, que usa minCol en \`color:\${minCol}\`, vive fuera del recorte de la tarjeta, así ` +
      `que ningún barrido de arriba lo pilla; el modo ☀ tampoco podría aclararlo`);
});

// ─────────────────────────────────────────────────────────────────────────
// LA PASTILLA DE LA PESTAÑA ACTIVA (.en-tab.active) — cristal para la barra
// de pestañas del panel endurance.
//
// Superficie NUEVA de material NORMAL (entra en la lista de .sp-glass de
// src/glass.css). .en-tabs es HERMANA de .sp-header —cuelga de #screen-dash,
// no de la cabecera, a diferencia de .sp-kpi—, así que el cristal se apoya en
// el FONDO DE PANTALLA con la capa de profundidad debajo: el mismo caso que
// .sp-footer, .en-team-card, .en-strat-card y #screen-setup .card. Se mide
// con peorCasoDelCristal, que ya barre las DOS bases (--panel-bg y --bg) con
// la mancha de profundidad a tope — el peor píxel real, no el más favorable.
//
// El único color de texto que audita este barrido es el ámbar literal de la
// pestaña activa: las inactivas NO llevan material (siguen con
// var(--text-3), sin cristal, sin superficie nueva) y quedan fuera a
// propósito.
console.log('\ncontraste de la pastilla .en-tab.active (pestaña activa)');

const inyectadoTabs = extractInjectedCss(leer('src/en-state.js'));
const reglaTabActive = rulesOf(inyectadoTabs).find(r => r.selector === '.en-tab.active');

test('.en-tab.active existe en el <style> inyectado y pinta su texto con un hex literal', () => {
  strictEqual(!!reglaTabActive, true,
    'no se encuentra la regla .en-tab.active en el <style> inyectado de en-state.js');
  const m = reglaTabActive.body.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-fA-F]{3,6})\s*(?:;|$)/);
  strictEqual(m !== null, true, '.en-tab.active no pinta su texto con un color hex literal');
});

// Leído del propio fichero, no clavado: si el ámbar cambiara de valor,
// este barrido mide el que de verdad se pinta, no uno desactualizado.
const AMBAR_PESTANA = (() => {
  const m = reglaTabActive && reglaTabActive.body.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-fA-F]{3,6})\s*(?:;|$)/);
  return m ? m[1] : '#F5A623'; // el test de arriba ya exige que exista; esto es solo defensivo
})();

test('el ámbar de la pestaña activa alcanza 4.5:1 sobre el peor caso del material normal', () => {
  const { contraste: c, base } = peorCasoDelCristal(AMBAR_PESTANA, { densa: false });
  ok(c >= 4.5,
    `${AMBAR_PESTANA} da ${c.toFixed(3)}:1 sobre la pastilla, base ${base.token} (${base.consumidor}) — ` +
    `ajusta el MATERIAL o el color del texto, nunca el umbral`);
});

test('el ámbar de la pestaña activa alcanza 4.5:1 sobre la pastilla de ☀', () => {
  const superficie = superficieHc({ densa: false });
  const c = contraste(hex(AMBAR_PESTANA), superficie);
  ok(c >= 4.5,
    `${AMBAR_PESTANA} da ${c.toFixed(3)}:1 sobre la pastilla en ☀ — ` +
    `la palanca es --panel-surface (body.hc) o el color del texto, nunca el umbral`);
});

console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
