'use strict';

// Helper: arranca una instancia del servidor REAL (server.js → createServer)
// inyectando un monitor stub, un directorio de grabaciones de fixtures y un
// config aislado. Así los tests ejercen las rutas y el handler WS reales, sin
// conectar a circuitos ni a Apex Timing.
// Devuelve { server, baseUrl, wsUrl } listo para tests.

const path = require('path');
const fs   = require('fs');
const { createServer } = require('../../server');

async function createTestServer({ apiKey = '' } = {}) {
  // Directorio de grabaciones de test + un fixture .ndjson para la descarga
  const recordingsDir = path.join(__dirname, '../fixtures/recordings');
  if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });
  fs.writeFileSync(path.join(recordingsDir, 'test-fixture.ndjson'), '');

  // config.json aislado: las rutas de escritura no tocan el config real
  const configPath = path.join(__dirname, '../fixtures/test-config.json');

  // Monitor stub — representa un circuito de test sin conexión real
  const testMonitor = {
    slug: 'test-slug',
    getInfo: () => ({ name: 'Test Circuit', slug: 'test-slug', port: 9999, connected: false, lapCount: 0, kartCount: 0, subscribers: 0, rawLog: false }),
    subscribe:        () => {},
    subscribePilot:   () => {},
    pilotSubscribers: new Map(),
    setRecording:     () => {},
    setRawLog:        () => {},
    stop:             () => {},
  };

  const monitors = new Map([['test-slug', testMonitor]]);
  const config   = { circuits: [] };

  const { server } = createServer({ apiKey, monitors, config, recordingsDir, configPath });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl:   `ws://127.0.0.1:${port}`,
  };
}

module.exports = { createTestServer };
