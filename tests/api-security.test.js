// StintPro — funciones de Vercel (api/): límites, validación y caché
// Ejecutar: node tests/api-security.test.js
'use strict';

const { strictEqual, ok } = require('assert');
const path = require('path');
const Module = require('module');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const API = path.join(__dirname, '..', 'api');

// Carga un módulo de api/ desde cero (su estado en memoria —límites— empieza vacío)
// con dependencias falsas para @supabase/supabase-js y @anthropic-ai/sdk.
function load(file, fakes = {}) {
  const orig = Module._load;
  Module._load = function (req, ...rest) {
    if (fakes[req]) return fakes[req];
    return orig.call(this, req, ...rest);
  };
  try {
    for (const k of Object.keys(require.cache)) if (k.startsWith(API)) delete require.cache[k];
    return require(path.join(API, file));
  } finally { Module._load = orig; }
}

function call(handler, { method = 'GET', query = {}, body, headers = {}, ip = '1.2.3.4' } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {}, body: undefined,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve(this); return this; },
      end() { resolve(this); return this; },
    };
    Promise.resolve(handler({ method, query, body, headers: { 'x-forwarded-for': ip, ...headers }, socket: {} }, res))
      .then(() => resolve(res));
  });
}

// fetch falso del logger: cuenta las llamadas por ruta
function fakeLogger(opts = {}) {
  const calls = {};
  global.fetch = async (url) => {
    const p = new URL(url).pathname;
    calls[p] = (calls[p] || 0) + 1;
    if (opts.fail) return { ok: false, status: 500, json: async () => ({}) };
    if (p === '/api/sessions') return { ok: true, json: async () => [{ id: 7, title: 'T', slug: 'x', lap_count: 3, started_at: 1 }] };
    if (p.startsWith('/api/laps/')) return { ok: true, json: async () => [{ dorsal: '5', lap_time_ms: 65000, timestamp: 1000 }] };
    return { ok: true, json: async () => [] };
  };
  return calls;
}

(async () => {
  console.log('\n▸ /api/report (público)\n');

  await test('SECURITY-2: límite de peticiones por IP (429)', async () => {
    fakeLogger();
    const h = load('report.js');
    let last;
    for (let i = 0; i < 61; i++) last = await call(h, { query: { list: '1' } });
    strictEqual(last.statusCode, 429);
    strictEqual((await call(h, { query: { list: '1' }, ip: '9.9.9.9' })).statusCode, 200, 'otra IP no se ve afectada');
  });

  await test('SECURITY-2: las respuestas buenas se cachean en la CDN', async () => {
    fakeLogger();
    const h = load('report.js');
    const r = await call(h, { query: { list: '1' } });
    ok(/s-maxage=\d+/.test(r.headers['cache-control'] || ''), r.headers['cache-control']);
  });

  await test('SECURITY-2: el catálogo de sesiones del logger no se pide en cada petición', async () => {
    const calls = fakeLogger();
    const h = load('report.js');
    await call(h, { query: { session: '7' } });
    await call(h, { query: { session: '7' } });
    strictEqual(calls['/api/sessions'], 1);
  });

  await test('SECURITY-2: un error del logger no se filtra al cliente', async () => {
    fakeLogger({ fail: true });
    const h = load('report.js');
    const r = await call(h, { query: { session: '7' } });
    strictEqual(r.statusCode, 502);
    strictEqual(r.body.detail, undefined);
  });

  console.log('\n▸ /api/ai-engineer\n');

  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'svc';
  process.env.ANTHROPIC_API_KEY = 'k';
  function aiFakes({ profile = true } = {}) {
    const st = { anthropicCalls: 0 };
    const supa = { createClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile ? { id: 'u1' } : null, error: null }) }) }) }),
    }) };
    function Anthropic() { this.messages = { create: async () => { st.anthropicCalls++; return { content: [{ type: 'text', text: 'ok' }] }; } }; }
    return { st, fakes: { '@supabase/supabase-js': supa, '@anthropic-ai/sdk': Anthropic } };
  }
  const auth = { authorization: 'Bearer t' };
  const q = (question, type = 'query') => ({ method: 'POST', headers: auth, body: { type, snapshot: {}, question } });

  await test('SECURITY-5: pregunta demasiado larga → rechazada sin llamar a la IA', async () => {
    const { st, fakes } = aiFakes();
    const h = load('ai-engineer.js', fakes);
    const r = await call(h, q('A'.repeat(700000)));
    ok(r.statusCode === 413 || r.statusCode === 400, String(r.statusCode));
    strictEqual(st.anthropicCalls, 0);
  });

  await test('SECURITY-5: pregunta que no es texto → 400', async () => {
    const { st, fakes } = aiFakes();
    const h = load('ai-engineer.js', fakes);
    strictEqual((await call(h, q({ a: 1 }))).statusCode, 400);
    strictEqual(st.anthropicCalls, 0);
  });

  await test('SECURITY-5: type heredado (constructor) → 400', async () => {
    const { fakes } = aiFakes();
    const h = load('ai-engineer.js', fakes);
    strictEqual((await call(h, q('x', 'constructor'))).statusCode, 400);
  });

  await test('SECURITY-1: usuario sin perfil (no invitado) → 403', async () => {
    const { st, fakes } = aiFakes({ profile: false });
    const h = load('ai-engineer.js', fakes);
    strictEqual((await call(h, q('¿paro?'))).statusCode, 403);
    strictEqual(st.anthropicCalls, 0);
  });

  await test('SECURITY-5: límite de consultas por usuario (429)', async () => {
    const { st, fakes } = aiFakes();
    const h = load('ai-engineer.js', fakes);
    let last;
    for (let i = 0; i < 31; i++) last = await call(h, q('¿paro?'));
    strictEqual(last.statusCode, 429);
    strictEqual(st.anthropicCalls, 30);
  });

  await test('una consulta normal sigue funcionando', async () => {
    const { st, fakes } = aiFakes();
    const h = load('ai-engineer.js', fakes);
    const r = await call(h, q('¿Apuro este stint o paro ya?'));
    strictEqual(r.statusCode, 200);
    strictEqual(r.body.message, 'ok');
    strictEqual(st.anthropicCalls, 1);
  });

  console.log('\n▸ /api/apex-proxy\n');

  await test('SECURITY-8: límite de peticiones por IP (429)', async () => {
    global.fetch = async () => ({ text: async () => 'var configPort = 8003;' });
    const h = load('apex-proxy.js');
    const body = { action: 'config', slug: 'lossantos' };
    let last;
    for (let i = 0; i < 401; i++) last = await call(h, { method: 'POST', body });
    strictEqual(last.statusCode, 429);
  });

  console.log(`\n${passed} pasan, ${failed} fallan\n`);
  process.exit(failed ? 1 : 0);
})();
