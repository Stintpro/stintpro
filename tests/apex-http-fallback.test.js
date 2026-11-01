// StintPro — respaldo HTTP del modo directo: si el WebSocket a Apex no conecta,
// el conector pasa a consultar live_ajax.php y le da las líneas al mismo parser.
// Ejecutar: node tests/apex-http-fallback.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ApexProtocol = require('../src/apex-protocol');

const SRC = fs.readFileSync(path.join(__dirname, '../src/apex-connector.js'), 'utf8');
const WS_PORT = 8043;

function montar() {
  const timers = [];
  const sockets = [];
  const consultas = [];
  const respuestas = [];
  class FakeWebSocket {
    constructor(url) { this.url = url; this.sent = []; sockets.push(this); }
    send(d) { this.sent.push(d); }
    close() {}
  }
  const fetch = async (url) => {
    if (!String(url).includes('live_ajax.php')) return { json: async () => ({ text: '' }), text: async () => '' };
    consultas.push(String(url));
    const r = respuestas.shift();
    if (r instanceof Error) throw r;
    if (typeof r === 'function') return { text: r };
    return { text: async () => (r === undefined ? '' : r) };
  };
  const sb = {
    console, fetch, WebSocket: FakeWebSocket, ApexProtocol, AbortSignal,
    setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimeout: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  };
  const nodos = {};
  sb.document = {
    getElementById: (id) => nodos[id] || null,
    createElement: () => ({
      style: {},
      remove() { delete nodos[this.id]; },
    }),
    body: { appendChild: (el) => { nodos[el.id] = el; } },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(SRC, sb);
  const estados = [];
  const C = sb.ApexConnector;
  C.connect('misanino-kart', () => {}, (st, label) => estados.push({ st, label }), null, WS_PORT);
  const lineas = [];
  C._parser.parse = (raw) => lineas.push(raw);

  const correrTimers = () => { for (const t of timers.splice(0)) t.fn(); };
  const posar = () => new Promise(r => setImmediate(r));
  const ws = () => sockets[sockets.length - 1];
  // n conexiones seguidas que se cierran sin haber traído ningún dato
  async function fallar(n) {
    for (let i = 0; i < n; i++) { ws().onclose(); correrTimers(); await posar(); }
  }
  const aviso = () => sb.document.getElementById('apex-http-badge');
  return { C, sockets, consultas, respuestas, estados, lineas, ws, fallar, correrTimers, posar, aviso };
}

const ultimo = (a) => a[a.length - 1];
const param = (url, k) => new URL(url).searchParams.get(k);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('con fallos sueltos del WebSocket no se consulta live_ajax', async () => {
  const t = montar();
  await t.fallar(2);
  strictEqual(t.consultas.length, 0);
});

test('tras 3 fallos seguidos pide la sesión al puerto WS+1', async () => {
  const t = montar();
  t.respuestas.push('309@43@init|r|\ntitle1||24H');
  await t.fallar(3);
  strictEqual(t.consultas.length, 1);
  strictEqual(param(t.consultas[0], 'port'), String(WS_PORT + 1));
  strictEqual(param(t.consultas[0], 'init'), '0');
  strictEqual(param(t.consultas[0], 'index'), '0');
  deepStrictEqual(t.lineas, ['init|r|\ntitle1||24H']);
});

test('la consulta siguiente pide solo lo nuevo desde la generación e índice devueltos', async () => {
  const t = montar();
  t.respuestas.push('309@43@init|r|', '309@45@r1c1|lap|\nr2c1|lap|');
  await t.fallar(3);
  t.correrTimers(); await t.posar();
  const u = ultimo(t.consultas);
  strictEqual(param(u, 'init'), '309');
  strictEqual(param(u, 'index'), '43');
  strictEqual(ultimo(t.lineas), 'r1c1|lap|\nr2c1|lap|');
});

test('una respuesta sin líneas nuevas no llega al parser y se sigue consultando', async () => {
  const t = montar();
  t.respuestas.push('309@43@init|r|', '309@43@');
  await t.fallar(3);
  t.correrTimers(); await t.posar();
  strictEqual(t.lineas.length, 1);
  t.correrTimers(); await t.posar();
  strictEqual(t.consultas.length, 3);
  strictEqual(param(ultimo(t.consultas), 'index'), '43');
});

// Medido contra Apex: sin líneas nuevas el cuerpo llega vacío, sin el `G@I@`.
test('un cuerpo vacío tras la parrilla conserva generación e índice', async () => {
  const t = montar();
  t.respuestas.push('309@43@init|r|', '');
  await t.fallar(3);
  t.correrTimers(); await t.posar();
  t.correrTimers(); await t.posar();
  strictEqual(param(ultimo(t.consultas), 'init'), '309');
  strictEqual(param(ultimo(t.consultas), 'index'), '43');
  strictEqual(t.lineas.length, 1);
});

test('un circuito sin sesión (cuerpo vacío) no rompe la consulta', async () => {
  const t = montar();
  t.respuestas.push('');
  await t.fallar(3);
  strictEqual(t.lineas.length, 0);
  t.correrTimers(); await t.posar();
  strictEqual(t.consultas.length, 2);
  strictEqual(param(ultimo(t.consultas), 'init'), '0');
});

test('el panel avisa de que va por el respaldo', async () => {
  const t = montar();
  t.respuestas.push('309@43@init|r|');
  await t.fallar(3);
  const e = ultimo(t.estados);
  strictEqual(e.st, 'connected');
  ok(/respaldo/i.test(e.label), e.label);
});

test('el aviso de respaldo se ve en pantalla', async () => {
  const t = montar();
  t.respuestas.push('309@43@init|r|');
  strictEqual(t.aviso(), null);
  await t.fallar(3);
  ok(/respaldo/i.test(t.aviso().textContent), String(t.aviso()?.textContent));
});

test('sin red el aviso en pantalla lo dice', async () => {
  const t = montar();
  t.respuestas.push(new Error('offline'));
  await t.fallar(3);
  ok(/sin conexión/i.test(t.aviso().textContent), String(t.aviso()?.textContent));
});

test('el aviso desaparece al volver el WebSocket', async () => {
  const t = montar();
  t.respuestas.push('309@43@init|r|');
  await t.fallar(3);
  t.ws().onopen();
  t.ws().onmessage({ data: 'init|r|' });
  strictEqual(t.aviso(), null);
});

test('el aviso desaparece al desconectar', async () => {
  const t = montar();
  t.respuestas.push('309@43@init|r|');
  await t.fallar(3);
  t.C.disconnect();
  strictEqual(t.aviso(), null);
});

test('los reintentos del WebSocket no pisan el aviso de respaldo', async () => {
  const t = montar();
  t.respuestas.push('309@43@init|r|', '309@43@');
  await t.fallar(3);
  const antes = t.estados.length;
  t.ws().onerror(); t.ws().onclose();
  strictEqual(t.estados.length, antes);
});

test('sin red en el respaldo avisa y vuelve a intentarlo', async () => {
  const t = montar();
  t.respuestas.push(new Error('offline'), '309@43@init|r|');
  await t.fallar(3);
  strictEqual(ultimo(t.estados).st, 'error');
  t.correrTimers(); await t.posar();
  strictEqual(ultimo(t.estados).st, 'connected');
  strictEqual(t.lineas.length, 1);
});

test('un WebSocket que abre y se cierra sin datos cuenta como fallo', async () => {
  const t = montar();
  t.respuestas.push('309@43@init|r|');
  for (let i = 0; i < 3; i++) { t.ws().onopen(); await t.fallar(1); }
  strictEqual(t.consultas.length, 1);
});

test('el primer dato del WebSocket apaga el respaldo', async () => {
  const t = montar();
  t.respuestas.push('309@43@init|r|');
  await t.fallar(3);
  t.ws().onopen();
  t.ws().onmessage({ data: 'init|r|' });
  const n = t.consultas.length;
  t.correrTimers(); await t.posar();
  strictEqual(t.consultas.length, n);
  strictEqual(ultimo(t.estados).st, 'connected');
  ok(!/respaldo/i.test(ultimo(t.estados).label));
});

test('una respuesta en vuelo no entra al parser si ya volvió el WebSocket', async () => {
  const t = montar();
  let soltar;
  const retenida = new Promise(r => { soltar = r; });
  t.respuestas.push('309@43@init|r|', () => retenida);
  await t.fallar(3);
  t.correrTimers(); await t.posar();
  t.ws().onopen();
  t.ws().onmessage({ data: 'init|r|' });
  soltar('309@45@r1c1|lap|');
  await t.posar();
  ok(!t.lineas.includes('r1c1|lap|'));
});

test('al desconectar deja de consultar', async () => {
  const t = montar();
  t.respuestas.push('309@43@init|r|');
  await t.fallar(3);
  const n = t.consultas.length;
  t.C.disconnect();
  t.correrTimers(); await t.posar();
  strictEqual(t.consultas.length, n);
});

(async () => {
  let passed = 0, failed = 0;
  console.log('\nRespaldo HTTP del modo directo');
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ✓', name); passed++; }
    catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
  }
  console.log(`\n${passed} pasados, ${failed} fallados`);
  process.exit(failed ? 1 : 0);
})();
