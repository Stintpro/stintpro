#!/usr/bin/env node
// Tests para los cambios de la sesión 2026-06-23
// Cubre: discriminación piloto/equipo y seguridad del servidor
// Run: node tests/session-changes.test.js

'use strict';

const assert = require('assert/strict');
const { createParser } = require('../src/apex-protocol');

let passed = 0, failed = 0;
const pending = [];   // tests asíncronos: el resumen espera a TODOS (antes, 500 ms fijos)

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 10 s')), 10000).unref());
      const p = Promise.race([r, timeout])
        .then(() => { console.log(`  ✓ ${name}`); passed++; })
        .catch(e => { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; });
      pending.push(p);
      return p;
    }
    console.log(`  ✓ ${name}`); passed++;
  } catch(e) {
    console.error(`  ✗ ${name}\n    ${e.message}`); failed++;
  }
}

function group(name, fn) { console.log(`\n${name}`); return fn(); }

// ── 1. Discriminación piloto / equipo en apex-protocol.js ────────────────────

group('Discriminación piloto/equipo — apex-protocol.js', () => {
  function makeParser() {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', pos: 1, dorsal: '7' }],
    });
    return p;
  }

  test('nombre con [X:XX] → piloto, se guarda sin el contador', () => {
    const p = makeParser();
    p.parse('r1c2|dr|Javier Coy [0:10]');
    const k = p.getState().equipos[0];
    assert.equal(k.name, 'Javier Coy');
  });

  test('nombre con [X:XX] → no sobreescribe con el contador en el nombre', () => {
    const p = makeParser();
    p.parse('r1c2|dr|Ana García [1:23]');
    const k = p.getState().equipos[0];
    assert.ok(!k.name.includes('['), 'el contador no debe aparecer en k.name');
  });

  test('nombre sin [X:XX] → equipo, va a teamName, k.name no se toca', () => {
    const p = makeParser();
    p.parse('r1c2|dr|Javier Coy [0:10]');  // establece piloto
    p.parse('r1c2|dr|Team StintPro');       // alternancia → equipo
    const k = p.getState().equipos[0];
    assert.equal(k.name, 'Javier Coy', 'k.name no debe cambiar al mostrar equipo');
    assert.equal(k.teamName, 'Team StintPro');
  });

  test('alternancia múltiple piloto→equipo→piloto mantiene el nombre correcto', () => {
    const p = makeParser();
    p.parse('r1c2|dr|Javier Coy [0:10]');
    p.parse('r1c2|dr|Team StintPro');
    p.parse('r1c2|dr|Javier Coy [0:25]');
    p.parse('r1c2|dr|Team StintPro');
    const k = p.getState().equipos[0];
    assert.equal(k.name, 'Javier Coy');
    assert.equal(k.teamName, 'Team StintPro');
  });

  test('piloto nuevo en el mismo kart actualiza k.name', () => {
    const p = makeParser();
    p.parse('r1c2|dr|Piloto A [0:10]');
    p.parse('r1c2|dr|Piloto B [0:02]'); // relevo
    const k = p.getState().equipos[0];
    assert.equal(k.name, 'Piloto B');
  });

  test('setGrid con nombre piloto [X:XX] → k.name limpio', () => {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', pos: 1, dorsal: '7', name: 'Javier Coy [0:05]' }],
    });
    const k = p.getState().equipos[0];
    assert.equal(k.name, 'Javier Coy');
  });

  test('setGrid con nombre de equipo → va a teamName y también a name (muestra equipo hasta que llegue piloto)', () => {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', pos: 1, dorsal: '7', name: 'Team StintPro' }],
    });
    const k = p.getState().equipos[0];
    assert.equal(k.name, 'Team StintPro', 'nombre de equipo visible hasta que llega el piloto');
    assert.equal(k.teamName, 'Team StintPro');
  });

  test('setGrid equipo + update piloto → k.name y k.teamName correctos', () => {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', pos: 1, dorsal: '7', name: 'Team StintPro' }],
    });
    // Antes del update de piloto, teamName ya está asignado
    assert.equal(p.getState().equipos[0].teamName, 'Team StintPro');
    // Llega el nombre del piloto
    p.parse('r1c2|dr|Javier Coy [0:08]');
    const k = p.getState().equipos[0];
    assert.equal(k.name, 'Javier Coy');
    assert.equal(k.teamName, 'Team StintPro');
  });
});

// (Las antiguas secciones 2-4 —httpAuth, auth del WebSocket y CORS— probaban
// COPIAS de la lógica escritas dentro de este fichero, que ya divergían del
// servidor real. Ese terreno lo cubre stintpro-logger/__tests__/server-security
// y read-auth, que arrancan el server.js de verdad.)

// ── 5. SQL — queries parametrizadas (lógica de _query) ───────────────────────

group('SQL — queries parametrizadas', () => {
  // Verificar que las funciones en db.js ya no usan replace(/\'/g, "''")
  const fs = require('fs');
  const dbSrc = fs.readFileSync(
    require('path').join(__dirname, '../stintpro-logger/db.js'), 'utf8'
  );

  test('no queda escapado manual de comillas SQL', () => {
    assert.ok(
      !dbSrc.includes("replace(/'/g, \"''\")"),
      'no debe haber escapado manual de SQL'
    );
  });

  test('un slug malicioso no inyecta SQL: las consultas por slug no devuelven nada', async () => {
    // BD temporal real, no la de desarrollo
    const os = require('os'), path = require('path');
    process.env.STINTPRO_DB_PATH = path.join(os.tmpdir(), `session-changes-${process.pid}.db`);
    const db = require('../stintpro-logger/db');
    await db.init();
    const id = db.createSession('campillos', 'Campillos');
    db.insertLap(id, '7', 'PEPE', null, 64000, 1, Date.now());
    const MALO = "x' OR '1'='1";
    assert.equal(db.getCircuitSessions(MALO).length, 0);
    assert.equal(db.getBestLapsByCircuit(MALO).length, 0);
    assert.equal(db.getPilotSessionsByCircuit(MALO).length, 0);
    assert.equal(db.getTotalLapsByCircuit(MALO), 0);
    assert.equal(db.searchPilotsGlobal(MALO).length, 0);
    db.deletePilotFromCircuit(MALO, MALO);
    assert.equal(db.getLapsBySession(id).length, 1, 'el borrado con slug malicioso no tocó nada');
    require('fs').rmSync(process.env.STINTPRO_DB_PATH, { force: true });
  });

  test('deleteSession usa prepare con ? en vez de interpolación', () => {
    assert.ok(!dbSrc.includes('session_id=${sessionId}'), 'no debe haber interpolación directa');
  });
});

// ── Resultado ─────────────────────────────────────────────────────────────────

async function main() {
  await Promise.allSettled(pending);
  console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
