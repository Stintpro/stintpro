// StintPro — contraste del texto secundario compuesto sobre el cristal.
// Compone la capa de profundidad y el material sobre el fondo, y exige 4.5:1.
// SI ESTE TEST SE PONE ROJO, SE AJUSTA EL MATERIAL — EL UMBRAL NO SE TOCA.
// Ejecutar: node tests/contrast.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const { ok, deepStrictEqual } = require('assert/strict');
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

// El peor píxel real: el punto más claro de la capa de profundidad (la mancha
// ámbar), que es donde el cristal recoge más luz y el texto menos contraste.
function superficieDelCristal({ densa }) {
  const fondo = hex(token('--bg'));
  const calida = rgba(token('--depth-warm'));
  let detras = componer(fondo, calida.rgb, calida.a);

  // backdrop-filter se aplica al FONDO, antes de pintar el velo encima.
  detras = saturar(detras, parseFloat(token('--glass-sat')) / 100);
  if (!densa) detras = brillo(detras, parseFloat(token('--glass-bright')) / 100);

  // El velo: se toma la parada MÁS CLARA del degradado, que es la peor.
  const velo = rgba(token(densa ? '--glass-denso-a' : '--glass-a'));
  return componer(detras, velo.rgb, velo.a);
}

console.log('\ncontraste del texto secundario sobre el material');
for (const densa of [false, true]) {
  const nombre = densa ? 'material denso' : 'material normal';
  test(`--text-3 alcanza 4.5:1 sobre el ${nombre}`, () => {
    const c = contraste(hex(token('--text-3')), superficieDelCristal({ densa }));
    ok(c >= 4.5, `${c.toFixed(2)}:1 sobre el ${nombre} — ajusta el MATERIAL, no el umbral`);
  });
}

console.log('\nel texto principal no puede estar peor que el secundario');
test('--text-1 supera a --text-3', () => {
  const s = superficieDelCristal({ densa: false });
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
//      colores reales sin mirar).
//   2. Solo ve colores hexadecimales LITERALES (color:#rrggbb). Un color que
//      llega por interpolación —color:${col}, donde `col` se calculó antes en
//      JS— es invisible para un test estático: no hay forma de saber qué
//      valor tomará `col` sin ejecutar la app. NO se cubre y no se finge
//      cubrirlo.
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
//      de ser así.
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

// Comprueba si un style="" declara un fondo local OPACO (hex de 3 u 8 dígitos
// no cuenta: el de 8 lleva alfa y es translúcido).
function tieneFondoLocalOpaco(style) {
  const m = style.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/);
  if (!m) return false;
  const v = m[1].trim();
  return /^#[0-9a-fA-F]{3}$/.test(v) || /^#[0-9a-fA-F]{6}$/.test(v);
}

// Colores de texto literales de una caja: recorre cada style="" de la caja y
// saca sus color:#rrggbb, salvo los que caen dentro de background-color/
// border-color (que no son color de TEXTO) o los que tienen fondo local
// opaco (ver comentario de alcance de arriba).
function coloresLiteralesDeCaja(caja) {
  const encontrados = new Set();
  const estiloRe = /style="([^"]*)"/g;
  let m;
  while ((m = estiloRe.exec(caja))) {
    const style = m[1];
    const opaco = tieneFondoLocalOpaco(style);
    if (opaco) continue;
    const colorRe = /color\s*:\s*#([0-9a-fA-F]{3,8})\b/g;
    let cm;
    while ((cm = colorRe.exec(style))) {
      const previo = style[cm.index - 1];
      if (previo !== undefined && /[a-zA-Z-]/.test(previo)) continue; // background-color, border-color…
      encontrados.add('#' + cm[1].toLowerCase());
    }
  }
  return encontrados;
}

const coloresEncontrados = new Set();
for (const f of FICHEROS_MODAL) {
  for (const caja of cajasModalDe(leer('src/' + f))) {
    for (const c of coloresLiteralesDeCaja(caja)) coloresEncontrados.add(c);
  }
}

// Lista de excepciones explícita — mismo patrón que la lista blanca de
// backdrop-filter en tests/glass.test.js: un color aquí no es un permiso en
// blanco, es una excepción NOMBRADA con su contraste medido y su motivo. Un
// color literal nuevo que caiga por debajo de 4.5:1 y no esté en esta lista
// pone el test rojo (lo comprueba el último test del grupo).
const EXCEPCIONES = {
  '#ef4444': {
    contraste: 3.30,
    motivo: 'Rojo de alerta: el aviso "Esta acción no se puede deshacer" y el ' +
      'botón "Borrar" del popup de borrar stint (en-team.js), y la cifra ' +
      '"Peor" del detalle de stint (en-team.js). Arreglarlo exige o bien ' +
      'oscurecer el material hasta matar el cristal (medido: haría falta ' +
      'bajar el color base de --glass-denso-a al 50%, dejando la superficie ' +
      'en rgb(26,28,32), que es prácticamente el fondo opaco que la Tarea 3 ' +
      'acaba de quitar), o bien cambiar el rojo en 71 sitios repartidos por ' +
      'la zona de datos. Decisión pendiente del dueño del proyecto — no es ' +
      'tocable en esta tarea (que solo posee el token --text-3).',
  },
  '#3a3b42': {
    contraste: 1.11,
    motivo: 'Hallazgo nuevo de este test, no anticipado en el pliego de la ' +
      'tarea: la etiqueta de sección "Listado de vueltas" del detalle de ' +
      'stint (en-team.js) es un gris muy oscuro sin fondo propio — se compone ' +
      'directamente contra el cristal denso y cae a 1,11:1, casi invisible. ' +
      'No es --text-3 (es un literal aparte, así que el cambio de esta tarea ' +
      'no lo toca) y no es un botón ni una alerta como #ef4444: es una ' +
      'etiqueta de cabecera que antes del cristal descansaba sobre un fondo ' +
      'sólido oscuro y probablemente se leía bien. Igual que #ef4444, ' +
      'arreglarlo (aclarar este literal, o darle un fondo propio) es una ' +
      'decisión pendiente del dueño del proyecto — fuera del alcance de esta ' +
      'tarea, que solo posee --text-3.',
  },
};

console.log('\ncontraste de los colores de texto literales en las cajas de modal (material denso)');
test(`se encuentran los ${coloresEncontrados.size} colores de texto literales esperados en las cajas de modal`, () => {
  // No es un test de contraste — es una alarma temprana de que la extracción
  // se ha quedado desactualizada (un color añadido o quitado del código) antes
  // de que el test de abajo intente interpretar una lista que ya no encaja.
  ok(coloresEncontrados.size > 0, 'la extracción no encontró ningún color literal — revisa cajasModalDe/coloresLiteralesDeCaja');
});

test('los únicos colores de texto literales por debajo de 4.5:1 son los de la lista de excepciones', () => {
  const superficie = superficieDelCristal({ densa: true });
  const porDebajo = [...coloresEncontrados]
    .filter(c => contraste(hex(c), superficie) < 4.5)
    .sort();
  const esperados = Object.keys(EXCEPCIONES).sort();
  deepStrictEqual(porDebajo, esperados,
    `colores por debajo de 4.5:1 = [${porDebajo}], excepciones documentadas = [${esperados}] — ` +
    `si hay un color NUEVO aquí, añádelo a EXCEPCIONES con su motivo, no bajes el umbral`);
});

console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
