// StintPro — repintado del panel del ingeniero IA sin perder la pregunta (en-ai-engineer.js)
// Ejecutar: node tests/ai-panel.test.js
'use strict';

const { strictEqual, ok } = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

// DOM falso: al asignar innerHTML se crea un <input> nuevo, como hace el navegador.
function makeInput() {
  return { id: 'en-adv-ai-question', value: '', selectionStart: 0, selectionEnd: 0, focused: false,
    focus() { this.focused = true; ctx.document.activeElement = this; },
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; } };
}
function makeContainer() {
  const c = { _input: makeInput(), repaints: 0,
    querySelector(sel) { return sel === '#en-adv-ai-question' ? this._input : null; } };
  Object.defineProperty(c, 'innerHTML', { set() { this._input = makeInput(); this.repaints++; }, get() { return ''; } });
  return c;
}

const ctx = { console, Date, Math, JSON, document: { activeElement: null } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'en-ai-engineer.js'), 'utf8'), ctx);
vm.runInContext('_enRenderAiEngineerPanel = function(){ return ""; };', ctx);

console.log('\n▸ Panel del ingeniero IA\n');

test('APP-7: el refresco periódico no repinta mientras escribes la pregunta', () => {
  const c = makeContainer();
  c._input.value = '¿Apuro este stint';
  ctx.document.activeElement = c._input;
  ctx._enRefreshAiPanel(c);
  strictEqual(c.repaints, 0);
  strictEqual(c._input.value, '¿Apuro este stint');
});

test('APP-7: el refresco periódico sí repinta si no estás escribiendo', () => {
  const c = makeContainer();
  ctx.document.activeElement = null;
  ctx._enRefreshAiPanel(c);
  strictEqual(c.repaints, 1);
});

test('APP-7: un repintado forzado (boletín/alerta) conserva texto, foco y cursor', () => {
  const c = makeContainer();
  c._input.value = '¿Apuro este stint';
  c._input.selectionStart = c._input.selectionEnd = 5;
  ctx.document.activeElement = c._input;
  ctx._enRepaintAiPanel(c);
  strictEqual(c._input.value, '¿Apuro este stint');
  ok(c._input.focused, 'debe recuperar el foco');
  strictEqual(c._input.selectionStart, 5);
});

console.log(`\n${passed} pasan, ${failed} fallan\n`);
process.exit(failed ? 1 : 0);
