'use strict';

// /stats sirve src/logger-stats.html adaptado al VPS. La puerta de sesión de
// Firebase (scripts del SDK + comprobación de miembro) solo vale en Vercel: en
// el VPS no hay firebase-config.js/firebase-auth.js ni /landing.html, y la
// sesión de Firebase es de otro origen. Si la puerta llegara al VPS, /stats
// redirigiría siempre a una página que no existe.

const http = require('http');
const { createTestServer } = require('./helpers/test-server');

let server, baseUrl;

beforeAll(async () => {
  const r = await createTestServer({ apiKey: 'k' });
  server = r.server; baseUrl = r.baseUrl;
});
afterAll(() => new Promise(resolve => server.close(resolve)));

function getText(path) {
  return new Promise((resolve, reject) => {
    http.get(baseUrl + path, res => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    }).on('error', reject);
  });
}

describe('/stats en el VPS', () => {
  test('responde 200 con la página de stats', async () => {
    const r = await getText('/stats');
    expect(r.status).toBe(200);
    expect(r.body).toContain('<title>StintPro — Logger Stats</title>');
  });

  test('quita la puerta de sesión de Firebase (sin redirección a /landing.html)', async () => {
    const { body } = await getText('/stats');
    expect(body).not.toContain("location.replace('/landing.html')");
    expect(body).not.toContain('SPAuth');
  });

  test('no pide los scripts de Firebase, que en el VPS no existen', async () => {
    const { body } = await getText('/stats');
    expect(body).not.toContain('firebase-config.js');
    expect(body).not.toContain('firebase-auth.js');
    expect(body).not.toContain('firebase-app-compat.js');
  });

  test('sigue adaptando la página al propio servidor', async () => {
    const { body } = await getText('/stats');
    expect(body).toContain('let _url = location.origin;');
    expect(body).toContain('← Inicio');
  });
});
