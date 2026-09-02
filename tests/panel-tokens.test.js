// StintPro — los tokens del panel valen EXACTAMENTE lo que valían los hex que
// sustituyen. Este test es lo que garantiza que la entrega 1 no cambia nada.
// Ejecutar: node tests/panel-tokens.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const { strictEqual } = require('assert/strict');
const { rulesOf } = require('../tools/css-extract');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const raiz = path.join(__dirname, '..');
const styles = fs.readFileSync(path.join(raiz, 'src', 'styles.css'), 'utf8');
const panel  = fs.readFileSync(path.join(raiz, 'src', 'panel.css'), 'utf8');

// R16, aplicado por fin también aquí. El ruling se dictó como norma en la
// Tarea 4 y solo llegó a contrast.test.js; su hermano seguía leyendo el token
// con styles.match(...) SIN flag global, que devuelve la PRIMERA aparición en
// TODO el fichero. Y --panel-surface, --panel-inset y --panel-line están
// declarados DOS veces: en :root y en body.hc (el modo ☀), con valores
// distintos a propósito. Hoy acertaba solo por accidente de orden —:root va
// antes en el fichero—: el día que alguien reordene o mueva bloques, este
// test empezaría a comparar los valores del modo ☀ contra los esperados del
// modo normal, y lo haría en VERDE. Se aísla el bloque :root con el mismo
// extractor que emparejan llaves de verdad y se busca el token SOLO ahí.
const bloqueRoot = rulesOf(styles).find(r => r.selector === ':root');
if (!bloqueRoot) throw new Error('no se encontró el bloque :root en src/styles.css');

// Valor exacto que tenía cada superficie ANTES de tokenizar. Si alguno de estos
// cambia, la entrega 1 ha dejado de ser invisible y el test tiene que fallar.
const ESPERADOS = {
  '--panel-bg':        '#0e0f11',
  '--panel-surface':   '#13141a',
  '--panel-inset':     '#0e0f11',
  '--panel-line':      '#252630',
  '--panel-line-soft': '#1e1f25',
  '--panel-line-dim':  '#181920',
  '--panel-btn':       '#1a1b22',
  '--panel-btn-line':  '#2a2b2e',
};

console.log('\nlos tokens del panel conservan su valor original');
for (const [token, valor] of Object.entries(ESPERADOS)) {
  test(`${token} vale ${valor}`, () => {
    const m = bloqueRoot.body.match(new RegExp(`${token}\\s*:\\s*([^;]+);`));
    strictEqual(m !== null, true, `${token} no está declarado en :root`);
    strictEqual(m[1].trim().toLowerCase(), valor);
  });
}

console.log('\nlas superficies usan el token, no el hex');
// El resto de superficies dejó de usar estos tokens al llegar el cristal: su
// fondo lo pone ahora el material (src/glass.css). Aparte de --panel-bg
// (que sigue pintando #screen-dash, comprobado justo debajo), tres siguen
// vivos porque body.hc los usa para apagar el vidrio: --panel-surface,
// --panel-inset y --panel-line — ver el bloque body.hc de styles.css y
// tests/glass.test.js (Tarea 5). Los otros cuatro (--panel-line-soft,
// --panel-line-dim, --panel-btn, --panel-btn-line) quedan sin un solo
// consumidor, a la espera de decidir si se borran; no borrarlos de tapadillo.
// .en-col-panel fue el último en pasarse (Tarea 3 de la entrega 2): ya no
// usa var(--panel-surface), su fondo lo da .sp-glass-denso.
// Y .sp-header VOLVIÓ a usar un token en la ola de arreglo de la revisión
// final: dejó de llevar material —contenía a .sp-kpi y el velo se componía dos
// veces— y ahora pinta su propio fondo opaco con var(--panel-bg), igual que
// #screen-dash. Que use el token y no un hex es lo que hace que body.hc la
// alcance.
const SUPERFICIES = [
  ['panel.css', panel, '#screen-dash',   '--panel-bg'],
  ['panel.css', panel, '.sp-header',     '--panel-bg'],
];
for (const [donde, fuente, selector, token] of SUPERFICIES) {
  test(`${selector} (${donde}) usa var(${token})`, () => {
    const esc = selector.replace('.', '\\.');
    const m = fuente.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`));
    strictEqual(m !== null, true, `no se encuentra la regla ${selector}`);
    strictEqual(m[1].includes(`var(${token})`), true, `${selector} no usa var(${token})`);
  });
}

test('ninguna superficie tokenizada conserva un hex crudo', () => {
  for (const [donde, fuente, selector] of SUPERFICIES) {
    const esc = selector.replace('.', '\\.');
    const m = fuente.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`));
    const hex = m[1].match(/#[0-9a-fA-F]{3,6}/g);
    strictEqual(hex, null, `${selector} (${donde}) todavía tiene ${hex}`);
  }
});

console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
