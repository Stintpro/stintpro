// StintPro — tests de tools/css-extract.js (rulesOf / extractInjectedCss)
// Blinda el parser que sostiene la línea base de tests/fixtures/panel-css-baseline.json:
// documenta el comportamiento ACTUAL (conteo de llaves ingenuo, sin distinguir
// strings/comentarios), no uno mejorado — el CSS real de en-state.js/sprint.js no
// tiene url() ni llaves dentro de strings, así que no hace falta endurecerlo.
// Ejecutar: node tests/css-extract.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok, throws } = require('assert/strict');
const { rulesOf, extractInjectedCss } = require('../tools/css-extract');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}
function group(name, fn) { console.log('\n' + name); fn(); }

group('rulesOf — casos base', () => {
  test('selector simple', () => {
    deepStrictEqual(rulesOf('.foo{color:red;background:blue;}'), [
      { selector: '.foo', body: 'color:red;background:blue;' },
    ]);
  });

  test('varios selectores seguidos', () => {
    deepStrictEqual(rulesOf('.a{x:1;}.b{y:2;}.c{z:3;}'), [
      { selector: '.a', body: 'x:1;' },
      { selector: '.b', body: 'y:2;' },
      { selector: '.c', body: 'z:3;' },
    ]);
  });

  test('CSS vacío → array vacío', () => {
    deepStrictEqual(rulesOf(''), []);
  });

  test('solo espacios en blanco → array vacío (no hay ninguna llave)', () => {
    deepStrictEqual(rulesOf('   \n\n  '), []);
  });
});

group('rulesOf — at-rules como UNA sola entrada', () => {
  test('@media con reglas dentro se devuelve como una entrada, sin mirar dentro', () => {
    const css = '@media (max-width:600px){.a{x:1;}.b{y:2;}}';
    deepStrictEqual(rulesOf(css), [
      { selector: '@media (max-width:600px)', body: '.a{x:1;}.b{y:2;}' },
    ]);
  });

  test('@keyframes con varios stops se devuelve como una entrada', () => {
    const css = '@keyframes spin{from{opacity:0;}50%{opacity:.5;}to{opacity:1;}}';
    deepStrictEqual(rulesOf(css), [
      { selector: '@keyframes spin', body: 'from{opacity:0;}50%{opacity:.5;}to{opacity:1;}' },
    ]);
  });

  test('una at-rule no absorbe las reglas que vienen después', () => {
    const css = '@media (max-width:600px){.a{x:1;}}.b{y:2;}';
    deepStrictEqual(rulesOf(css), [
      { selector: '@media (max-width:600px)', body: '.a{x:1;}' },
      { selector: '.b', body: 'y:2;' },
    ]);
  });
});

group('rulesOf — comentarios y espacios', () => {
  test('los comentarios se descartan enteros, no dejan rastro ni generan reglas falsas', () => {
    const css = '/* cabecera */\n.a{color:red;}\n/* pie */';
    deepStrictEqual(rulesOf(css), [
      { selector: '.a', body: 'color:red;' },
    ]);
  });

  test('un comentario dentro del cuerpo desaparece sin dejar hueco raro', () => {
    const css = '.a{color:red;/* nota */background:blue;}';
    deepStrictEqual(rulesOf(css), [
      { selector: '.a', body: 'color:red;background:blue;' },
    ]);
  });

  test('espacios/saltos de línea se normalizan a un único espacio y se recortan', () => {
    const css = '.a,\n  .b\n{\n  color:  red;\n  background:blue;\n}';
    deepStrictEqual(rulesOf(css), [
      { selector: '.a, .b', body: 'color: red; background:blue;' },
    ]);
  });
});

group('extractInjectedCss', () => {
  test('extrae el contenido entre s.textContent=` y `;', () => {
    const js = "function f(){\n  const s=document.createElement('style');\n  s.textContent=`\n  .a{color:red;}\n`;\n  document.head.appendChild(s);\n}";
    strictEqual(extractInjectedCss(js), '\n  .a{color:red;}\n');
  });

  test('solo coge el bloque, no lo que hay antes ni después en el fichero', () => {
    const js = "const x=1;\ns.textContent=`.a{x:1;}`;\nconst y=2;";
    strictEqual(extractInjectedCss(js), '.a{x:1;}');
  });

  test('sin s.textContent=` en el fichero → lanza', () => {
    throws(() => extractInjectedCss('const x = 1;'), /no se encontró el bloque/);
  });

  test('s.textContent=` presente pero sin cerrar con `; → lanza', () => {
    throws(() => extractInjectedCss('s.textContent=`.a{x:1;}'), /no está cerrado/);
  });
});

console.log(`\n${passed} pasados, ${failed} fallados`);
process.exit(failed ? 1 : 0);
