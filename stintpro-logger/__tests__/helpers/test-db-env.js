'use strict';
// Cada worker de jest con su propia BD temporal (setupFiles, antes de cualquier
// require('../db')). Antes todos escribían en data/stintpro.db —la BD local de
// desarrollo— y operaciones globales como closeStaleSessions(-1) o
// cleanupEmptySessions() se pisaban entre suites. Un test puede fijar su propia
// ruta (ingest-raw-log.test.js) y se respeta.
const os   = require('os');
const path = require('path');
const fs   = require('fs');

if (!process.env.STINTPRO_DB_PATH || process.env.STINTPRO_DB_PATH.endsWith(path.join('data', 'stintpro.db'))) {
  const file = path.join(os.tmpdir(), `stintpro-test-${process.pid}-${process.env.JEST_WORKER_ID || 0}.db`);
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(file + ext, { force: true });
  process.env.STINTPRO_DB_PATH = file;
}
