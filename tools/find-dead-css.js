// Lista las reglas de un CSS cuyas clases no usa ningún .js/.html del proyecto.
// Es una AYUDA, no una autoridad: su salida se revisa a mano antes de borrar nada.
// Ejecutar: node tools/find-dead-css.js
'use strict';

const fs = require('fs');
const path = require('path');
const { rulesOf } = require('./css-extract');

// Las clases de un selector, sin pseudoclases, ids ni etiquetas.
function classesInSelector(selector) {
  const out = [];
  const re = /\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g;
  let m;
  while ((m = re.exec(selector)) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

// ¿Aparece la clase como palabra completa dentro de un class=/classList/plantilla?
// El corpus es todo el JS y HTML concatenado. Delimitamos por caracteres que no
// pueden formar parte de un nombre de clase, para que 'card' no case con
// 'card-body'.
function isUsed(className, corpus) {
  const esc = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^-_a-zA-Z0-9])${esc}([^-_a-zA-Z0-9]|$)`).test(corpus);
}

function main() {
  const root = path.join(__dirname, '..');
  const cssPath = path.join(root, 'src', 'styles.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  const dirs = [path.join(root, 'src')];
  let corpus = '';
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(js|html)$/.test(f)) continue;
      corpus += fs.readFileSync(path.join(dir, f), 'utf8') + '\n';
    }
  }

  const muertas = [];
  for (const rule of rulesOf(css)) {
    const clases = classesInSelector(rule.selector);
    if (clases.length === 0) continue;               // @media, html/body, ::-webkit-…
    if (clases.every(c => !isUsed(c, corpus))) muertas.push(rule.selector);
  }

  console.log(`${muertas.length} reglas sin uso en src/styles.css:\n`);
  muertas.forEach(s => console.log('  ' + s));
  console.log('\nRevísalas a mano antes de borrar. El detector no ve nombres construidos');
  console.log("en tiempo de ejecución (p. ej. 'b-' + tipo).");
}

if (require.main === module) main();

module.exports = { classesInSelector, isUsed };
