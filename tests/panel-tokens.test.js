// StintPro — los tokens del panel valen EXACTAMENTE lo que valían los hex que
// sustituyen. Este test es lo que garantiza que la entrega 1 no cambia nada.
// Ejecutar: node tests/panel-tokens.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const { strictEqual } = require('assert/strict');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const raiz = path.join(__dirname, '..');
const styles = fs.readFileSync(path.join(raiz, 'src', 'styles.css'), 'utf8');
const panel  = fs.readFileSync(path.join(raiz, 'src', 'panel.css'), 'utf8');
const enSt   = fs.readFileSync(path.join(raiz, 'src', 'en-state.js'), 'utf8');

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
    const m = styles.match(new RegExp(`${token}\\s*:\\s*([^;]+);`));
    strictEqual(m !== null, true, `${token} no está declarado en :root`);
    strictEqual(m[1].trim().toLowerCase(), valor);
  });
}

console.log('\nlas superficies usan el token, no el hex');
// El resto de superficies dejó de usar estos tokens al llegar el cristal: su
// fondo lo pone ahora el material (src/glass.css). Los tokens siguen vivos
// porque body.hc los usa para apagar el vidrio — ver el bloque body.hc de
// styles.css y tests/glass.test.js.
const SUPERFICIES = [
  ['panel.css', panel, '#screen-dash',   '--panel-bg'],
  ['en-state.js', enSt, '.en-col-panel',  '--panel-surface'],
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
