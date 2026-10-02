// StintPro — parseo del grid HTML de Apex en la app (modo directo y replay)
// Los dos conectores del navegador deben leer el grid igual que el logger.
// Ejecutar: node tests/apex-grid.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { parse: parseHTML } = require(path.join(ROOT, 'stintpro-logger', 'node_modules', 'node-html-parser'));
const AP = require(path.join(ROOT, 'src', 'apex-protocol.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

// DOMParser del navegador sobre node-html-parser
function wrap(n) {
  if (!n) return null;
  return new Proxy(n, { get(t, p) {
    if (p === 'querySelector') return (s) => wrap(t.querySelector(s));
    if (p === 'querySelectorAll') return (s) => t.querySelectorAll(s).map(wrap);
    if (p === 'textContent') return t.textContent ?? t.text;
    if (p === 'className') return (t.getAttribute && t.getAttribute('class')) || '';
    const v = t[p]; return typeof v === 'function' ? v.bind(t) : v;
  } });
}
class DOMParser { parseFromString(s) { return wrap(parseHTML(s)); } }

function makeCtx() {
  const ctx = {
    console: { log() {}, warn() {}, error: (...a) => console.error(...a) }, Date, Math, JSON,
    DOMParser, ApexProtocol: AP, setTimeout: () => 0, clearTimeout() {},
    WebSocket: function () { this.close = () => {}; },
    fetch: () => new Promise(() => {}),
    AbortSignal: { timeout: () => undefined },
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['apex-grid.js', 'apex-connector.js', 'replay-connector.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'), ctx, { filename: f });
  return ctx;
}

const SEVILLA = fs.readFileSync(path.join(ROOT, 'stintpro-logger', '__tests__', 'fixtures', 'sevilla-categorias.ndjson'), 'utf8')
  .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

function feed(parser) { for (const o of SEVILLA) if (o.raw) { try { parser.parse(o.raw); } catch (e) {} } }
function cats(state) {
  const c = {};
  state.equipos.filter((e) => e.category).forEach((e) => { c[e.category] = (c[e.category] || 0) + 1; });
  return c;
}

const GRID = (headCells, rowCells) => 'grid||<tr data-id="r0">' + headCells + '</tr><tr data-id="r1">' + rowCells + '</tr>\n';

console.log('\n▸ Grid de Apex en la app\n');

test('PARSER-5: el replay rellena la categoría (Sevilla PRO/AMATEUR)', () => {
  const ctx = makeCtx();
  const RC = ctx.ReplayConnector;
  RC._emit = () => {};
  RC._parser = RC._createParser();
  feed(RC._parser);
  deepStrictEqual(cats(RC._parser.getState()), { PRO: 7, AMATEUR: 24 });
});

test('PARSER-5: el modo directo rellena la categoría (Sevilla PRO/AMATEUR)', () => {
  const ctx = makeCtx();
  const AC = ctx.ApexConnector;
  AC.connect('sevilla', () => {}, () => {}, () => {}, 8000);
  AC._emit = () => {};
  feed(AC._parser);
  deepStrictEqual(cats(AC._parser.getState()), { PRO: 7, AMATEUR: 24 });
});

test('PARSER-8: el replay detecta que otr es el crono de pit', () => {
  const ctx = makeCtx();
  const RC = ctx.ReplayConnector;
  RC._emit = () => {};
  RC._parser = RC._createParser();
  RC._parser.parse(GRID('<td data-id="c1" data-type="no"></td><td data-id="c2" data-type="dr"></td><td data-id="c3" data-type="otr">Tiempo en Pit</td>',
    '<td data-id="r1c1" class="no"><div>7</div></td><td data-id="r1c2">EQUIPO</td><td data-id="r1c3"></td>'));
  strictEqual(RC._parser.getState().otrIsPit, true);
});

test('vueltas oficiales: la columna lc vale igual que tlp (como en el logger)', () => {
  const g = makeCtx().ApexGrid.parseGridHtml(
    '<tr data-id="r0"><td data-id="c1" data-type="no"></td><td data-id="c2" data-type="lc"></td></tr>' +
    '<tr data-id="r1"><td data-id="r1c1" class="no"><div>7</div></td><td data-id="r1c2">42</td></tr>');
  strictEqual(g.karts[0].tours, 42);
});

test('nombre: no toma como equipo un código de estado colado en la columna dr', () => {
  const g = makeCtx().ApexGrid.parseGridHtml(
    '<tr data-id="r0"><td data-id="c1" data-type="no"></td><td data-id="c2" data-type="dr"></td></tr>' +
    '<tr data-id="r1"><td data-id="r1c1" class="no"><div>7</div></td><td data-id="r1c2">sr</td></tr>');
  strictEqual(g.karts[0].name, undefined);
});

// ── Historial HTTP del modo directo (request.php vía proxy) ──────────────
function gridOf(n) {
  let h = 'grid||<tr data-id="r0"><td data-id="c1" data-type="no"></td><td data-id="c2" data-type="dr"></td></tr>';
  for (let i = 1; i <= n; i++) h += `<tr data-id="r${i}"><td data-id="r${i}c1" class="no"><div>${i}</div></td><td data-id="r${i}c2">EQUIPO ${i}</td></tr>`;
  return h + '\n';
}
// fetch falso: config tarda configDelay ms; cada history devuelve 3 vueltas
function makeFetch(ctx, configDelay) {
  const asked = [];
  ctx.fetch = (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.action === 'config')
      return new Promise((r) => setTimeout(() => r({ json: async () => ({ text: 'var configPort = 8003;' }) }), configDelay));
    asked.push(body.request.match(/D(\d+)\.L/)[1]);
    const id = body.request.match(/D(\d+)\.L/)[1];
    const text = [1, 2, 3].map((n) => `D${id}.L${n}#x|x|x|6${n}000`).join('\n');
    return Promise.resolve({ json: async () => ({ text }) });
  };
  ctx.setTimeout = setTimeout; ctx.clearTimeout = clearTimeout;
  ctx.AbortController = AbortController;
  return asked;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function asyncTests() {
  async function t(name, fn) {
    try { await fn(); console.log('  ✓', name); passed++; }
    catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
  }
  console.log('\n▸ Historial HTTP (modo directo)\n');

  await t('PARSER-6: si el puerto llega después del grid, el historial se pide igualmente', async () => {
    const ctx = makeCtx();
    const asked = makeFetch(ctx, 30);
    const AC = ctx.ApexConnector;
    AC.connect('lossantos', () => {}, () => {}, () => {}, 8006);
    AC._parser.parse(gridOf(5));          // el grid llega antes que el configPort
    await wait(120);
    strictEqual(asked.length, 5);
    ok(AC._parser.getState().equipos.every((e) => (e.lapHistory || []).length === 3));
  });

  await t('PARSER-6: con más de 30 karts se pide el historial de todos', async () => {
    const ctx = makeCtx();
    const asked = makeFetch(ctx, 0);
    const AC = ctx.ApexConnector;
    AC.connect('campillos', () => {}, () => {}, () => {}, 8006);
    await wait(10);                         // puerto ya resuelto
    AC._parser.parse(gridOf(46));
    await wait(200);
    strictEqual(new Set(asked).size, 46);
  });
}

asyncTests().then(() => {
  console.log(`\n${passed} pasan, ${failed} fallan\n`);
  process.exit(failed ? 1 : 0);
});
