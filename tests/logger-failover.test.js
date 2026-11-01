// StintPro — si cae el logger: aviso a los 10 s y paso a Apex directo a los 20 s.
// Ejecutar: node tests/logger-failover.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ApexProtocol = require('../src/apex-protocol');

const leer = (f) => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');
const LOGGER_URL = 'wss://vps.test';

function montar() {
  let ahora = 0, sec = 0;
  const timers = [];
  const sockets = [];
  class FakeWebSocket {
    constructor(url) { this.url = url; this.sent = []; sockets.push(this); }
    send(d) { this.sent.push(d); }
    close() {}
  }
  const nodos = {};
  const sb = {
    console, ApexProtocol, AbortSignal, WebSocket: FakeWebSocket,
    fetch: async () => ({ json: async () => ({ text: '' }), text: async () => '' }),
    localStorage: { getItem: () => '' },
    AppState: { loggerUrl: LOGGER_URL },
    setTimeout: (fn, ms) => { const t = { fn, at: ahora + ms, id: ++sec }; timers.push(t); return t; },
    clearTimeout: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    document: {
      getElementById: (id) => nodos[id] || null,
      createElement: () => ({ style: {}, remove() { delete nodos[this.id]; } }),
      body: { appendChild: (el) => { nodos[el.id] = el; } },
    },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(leer('apex-connector.js'), sb);
  vm.runInContext(leer('logger-connector.js') + '\nvar _LoggerGlobal = Logger; var _origApex = window.ApexConnector;', sb);
  const Logger = sb._LoggerGlobal;
  Logger._getToken = async () => 'token';
  sb.ApexConnector = Logger;

  const args = ['misanino-kart', () => {}, () => {}, null, 8043];
  const avanzar = (ms) => {
    const fin = ahora + ms;
    for (;;) {
      const t = timers.filter(x => x.at <= fin).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!t) break;
      timers.splice(timers.indexOf(t), 1);
      ahora = t.at;
      t.fn();
    }
    ahora = fin;
  };
  const ws = () => sockets[sockets.length - 1];
  const aviso = () => { const n = nodos['logger-down-badge']; return n ? n.textContent : null; };
  const conectar = () => Logger.connect(...args);
  return { sb, Logger, args, sockets, ws, avanzar, aviso, conectar, timers };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('sin aviso si el logger vuelve antes de 10 s', () => {
  const t = montar();
  t.conectar();
  t.ws().onclose();
  t.avanzar(9000);
  t.ws().onmessage({ data: '{"type":"live"}' });
  t.avanzar(30000);
  strictEqual(t.aviso(), null);
});

test('a los 10 s sin logger avisa en pantalla', () => {
  const t = montar();
  t.conectar();
  t.ws().onclose();
  t.avanzar(10000);
  strictEqual(t.aviso(), 'Logger caído · reconectando');
});

test('avisa también si el logger nunca llegó a conectar', () => {
  const t = montar();
  t.conectar();
  t.ws().onerror();
  t.avanzar(10000);
  strictEqual(t.aviso(), 'Logger caído · reconectando');
});

test('un socket que abre y se cierra sin datos no cancela la cuenta atrás', () => {
  const t = montar();
  t.conectar();
  t.ws().onclose();
  t.avanzar(5000);        // reintento del logger
  t.ws().onopen();
  t.ws().onclose();
  t.avanzar(5000);
  strictEqual(t.aviso(), 'Logger caído · reconectando');
});

test('el primer mensaje del logger quita el aviso', () => {
  const t = montar();
  t.conectar();
  t.ws().onclose();
  t.avanzar(11000);
  t.ws().onmessage({ data: '{"type":"live"}' });
  strictEqual(t.aviso(), null);
});

test('al desconectar se quita el aviso', () => {
  const t = montar();
  t.conectar();
  t.ws().onclose();
  t.avanzar(11000);
  t.Logger.disconnect();
  strictEqual(t.aviso(), null);
});

test('un error fatal del logger no avisa', () => {
  const t = montar();
  t.conectar();
  t.ws().onmessage({ data: '{"type":"error","fatal":true,"msg":"no autorizado"}' });
  t.ws().onclose();
  t.avanzar(30000);
  strictEqual(t.aviso(), null);
});

(async () => {
  let passed = 0, failed = 0;
  console.log('\nLogger caído');
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ✓', name); passed++; }
    catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
  }
  console.log(`\n${passed} pasados, ${failed} fallados`);
  process.exit(failed ? 1 : 0);
})();
