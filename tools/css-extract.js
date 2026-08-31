// Extrae y normaliza reglas CSS. Lo usan los tests del refactor del panel y el
// detector de CSS muerto. Sin dependencias: este repo no tiene build.
'use strict';

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function squash(s) {
  return s.replace(/\s+/g, ' ').trim();
}

// Devuelve [{selector, body}] en orden de aparición. Las at-rules (@media,
// @keyframes) se devuelven como UNA entrada cuyo body es su bloque entero: no
// necesitamos mirar dentro, solo saber que no se pierde ni se duplica.
function rulesOf(cssSource) {
  const css = stripComments(cssSource);
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    const prelude = squash(css.slice(i, open));
    let depth = 1, j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const body = squash(css.slice(open + 1, j - 1));
    if (prelude) out.push({ selector: prelude, body });
    i = j;
  }
  return out;
}

// Saca el contenido de `s.textContent=\`...\`;` de en-state.js / sprint.js.
function extractInjectedCss(jsSource) {
  const start = jsSource.indexOf('s.textContent=`');
  if (start === -1) throw new Error('no se encontró el bloque s.textContent=`…`');
  const from = start + 's.textContent=`'.length;
  const end = jsSource.indexOf('`;', from);
  if (end === -1) throw new Error('el bloque s.textContent=`…` no está cerrado');
  return jsSource.slice(from, end);
}

module.exports = { rulesOf, extractInjectedCss, squash, stripComments };
