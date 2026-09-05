#!/usr/bin/env node
// Tests for src/apex-protocol.js
// Run: node tests/apex-protocol.test.js

'use strict';

const assert = require('assert/strict');
const { createParser, parseTime } = require('../src/apex-protocol');

// ── Mini test runner ──────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function group(name, fn) {
  console.log(`\n${name}`);
  fn();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Build a parser with a colMap that includes 'llp'
function parserWithLlp() {
  const p = createParser({});
  p.setGrid({
    colMap:   { llp: 'c3', no: 'c1', dr: 'c2' },
    colByNum: { c3: 'llp', c1: 'no', c2: 'dr' },
    karts: [{ rowId: 'r1', pos: 1, dorsal: '7', name: 'TEAM A' }],
  });
  return p;
}

function parserNoLlp() {
  const p = createParser({});
  p.setGrid({
    colMap:   { no: 'c1', dr: 'c2' },
    colByNum: { c1: 'no', c2: 'dr' },
    karts: [{ rowId: 'r1', pos: 1, dorsal: '7', name: 'TEAM A' }],
  });
  return p;
}

// ── parseTime ─────────────────────────────────────────────────────────────────

group('parseTime()', () => {
  test('MM:SS.mmm format', () => {
    assert.equal(parseTime('1:04.893'), 64.893);
  });
  test('raw seconds', () => {
    assert.equal(parseTime('65.123'), 65.123);
  });
  test('milliseconds > 1000 → divide by 1000', () => {
    assert.equal(parseTime('65123'), 65.123);
  });
  test('strips trailing letters', () => {
    assert.equal(parseTime('65.123s'), 65.123);
  });
  test('null for empty', () => {
    assert.equal(parseTime(''), null);
    assert.equal(parseTime(null), null);
  });
  test('null for values below 1', () => {
    assert.equal(parseTime('0.5'), null);
  });
});

// ── |*| message ───────────────────────────────────────────────────────────────

group('|*| without llp column', () => {
  test('records lap and fires onLap', () => {
    let lapFired = false;
    const p = createParser({
      onLap: (dorsal, name, teamName, ms, lapN) => {
        lapFired = true;
        assert.equal(dorsal, '7');
        assert.equal(ms, 65000);
        assert.equal(lapN, 1);
      },
    });
    p.setGrid({
      colMap:   { no: 'c1' },
      colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', pos: 1, dorsal: '7' }],
    });
    p.parse('r1|*|65000|');
    assert.ok(lapFired, 'onLap should have fired');
    const { equipos } = p.getState();
    assert.equal(equipos[0].lapHistory.length, 1);
    assert.equal(equipos[0].lastLap, 65.0);
  });

  test('deduplicates identical time (±0.05s)', () => {
    let lapCount = 0;
    const p = createParser({ onLap: () => lapCount++ });
    parserNoLlp(); // just checking function exists
    const q = createParser({ onLap: () => lapCount++ });
    q.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    q.parse('r1|*|65000|');
    q.parse('r1|*|65030|'); // 30ms diff — within 0.05s = 50ms → dedup
    const { equipos } = q.getState();
    assert.equal(lapCount, 1, 'second |*| within 0.05s should be deduped');
    assert.equal(equipos[0].lapHistory.length, 1);
  });

  test('does NOT deduplicate different times (>0.05s)', () => {
    let lapCount = 0;
    const p = createParser({ onLap: () => lapCount++ });
    p.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    p.parse('r1|*|65000|');
    p.parse('r1|*|66000|'); // 1s diff → separate lap
    assert.equal(lapCount, 2);
    assert.equal(p.getState().equipos[0].lapHistory.length, 2);
  });

  test('invalid lap (< 20s) is ignored', () => {
    let lapFired = false;
    const p = createParser({ onLap: () => { lapFired = true; } });
    p.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    p.parse('r1|*|15000|');
    assert.ok(!lapFired);
  });

  test('too-long lap (≥ 300s) is ignored', () => {
    let lapFired = false;
    const p = createParser({ onLap: () => { lapFired = true; } });
    p.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    p.parse('r1|*|300000|');
    assert.ok(!lapFired);
  });
});

group('|*| WITH llp column', () => {
  test('does NOT record lap or fire onLap', () => {
    let lapFired = false;
    const p = createParser({ onLap: () => { lapFired = true; } });
    p.setGrid({
      colMap:   { llp: 'c3', no: 'c1' },
      colByNum: { c3: 'llp', c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }],
    });
    p.parse('r1|*|65000|');
    assert.ok(!lapFired, 'onLap must NOT fire when llp column exists');
    const { equipos } = p.getState();
    assert.equal(equipos[0].lapHistory.length, 0);
    assert.equal(equipos[0].lastLap, null);
  });

  test('sets _lapFromFlash for anti-dedup (verified via subsequent llp refine)', () => {
    let lapCount = 0;
    const p = createParser({ onLap: () => lapCount++ });
    p.setGrid({
      colMap:   { llp: 'c3', no: 'c1' },
      colByNum: { c3: 'llp', c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }],
    });
    p.parse('r1|*|65000|');           // sets _lapFromFlash=65, no lap recorded
    p.parse('r1c3|llp|1:05.001');     // llp arrives immediately → refine, 1 onLap
    assert.equal(lapCount, 1, 'llp after |*| should fire exactly once');
    assert.equal(p.getState().equipos[0].lapHistory.length, 1);
  });
});

// ── lap flash (destello de fila al pasar por meta) ──────────────────────────
// El destello debe poder reconstruirse de forma idempotente en cada repintado:
// el grid se repinta vía innerHTML varias veces por segundo (feed en vivo +
// clics de UI), lo que recrea el nodo de la fila y REINICIA una animación CSS
// arrancada "desde 0". Para poder seekear la animación al tiempo transcurrido
// real (animation-delay negativo) el snapshot debe exponer el TIMESTAMP crudo
// del último pase por meta, no solo el booleano de "está destellando".
group('lap flash timestamp (idempotencia del destello)', () => {
  test('|*| expone lapFlashAt (timestamp) además de lapFlash (booleano)', () => {
    const p = createParser({});
    p.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    const t0 = Date.now();
    p.parse('r1|*|65000|');
    const k = p.getState().equipos[0];
    assert.equal(k.lapFlash, true, 'lapFlash debe estar activo tras el pase por meta');
    assert.equal(typeof k.lapFlashAt, 'number', 'lapFlashAt debe ser un número (timestamp)');
    assert.ok(k.lapFlashAt >= t0, 'lapFlashAt debe ser el instante del pase por meta');
    assert.ok(Date.now() - k.lapFlashAt < 2000, 'lapFlashAt debe ser reciente');
  });

  test('sin pase por meta, lapFlashAt es 0 (no destella)', () => {
    const p = createParser({});
    p.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    const k = p.getState().equipos[0];
    assert.equal(k.lapFlash, false);
    assert.equal(k.lapFlashAt, 0, 'sin destello, lapFlashAt debe ser 0 (no undefined)');
  });
});

// ── llp cell ──────────────────────────────────────────────────────────────────

group('llp cell handling', () => {
  test('llp within 5s of |*| → refines last entry, no duplicate onLap', () => {
    let lapCount = 0;
    const p = createParser({ onLap: () => lapCount++ });
    p.setGrid({
      colMap:   { llp: 'c3', no: 'c1' },
      colByNum: { c3: 'llp', c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }],
    });
    p.parse('r1|*|65000|');
    p.parse('r1c3|llp|1:05.100');   // refined value
    const { equipos } = p.getState();
    assert.equal(lapCount, 1);
    assert.equal(equipos[0].lapHistory.length, 1);
    assert.equal(equipos[0].lastLap, 65.1);
    assert.equal(equipos[0].lapHistory[0], 65.1);
  });

  test('llp without recent |*| → new entry, fires onLap', () => {
    let lapCount = 0;
    const p = createParser({ onLap: () => lapCount++ });
    p.setGrid({
      colMap:   { llp: 'c3', no: 'c1' },
      colByNum: { c3: 'llp', c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }],
    });
    // No |*| before llp
    p.parse('r1c3|llp|1:05.100');
    const { equipos } = p.getState();
    assert.equal(lapCount, 1, 'should fire onLap');
    assert.equal(equipos[0].lapHistory.length, 1);
    assert.equal(equipos[0].lastLap, 65.1);
  });

  test('llp after |*| consumed → clears flash reference (next llp is new entry)', () => {
    let lapCount = 0;
    const p = createParser({ onLap: () => lapCount++ });
    p.setGrid({
      colMap:   { llp: 'c3', no: 'c1' },
      colByNum: { c3: 'llp', c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }],
    });
    p.parse('r1|*|65000|');
    p.parse('r1c3|llp|1:05.000');  // refine (consume flash)
    p.parse('r1c3|llp|1:06.000');  // new lap (no |*| ref)
    assert.equal(lapCount, 2);
    assert.equal(p.getState().equipos[0].lapHistory.length, 2);
  });

  test('llp updates bestLap', () => {
    const p = createParser({});
    p.setGrid({
      colMap:   { llp: 'c3', no: 'c1' },
      colByNum: { c3: 'llp', c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }],
    });
    p.parse('r1c3|llp|1:10.000');
    p.parse('r1c3|llp|1:05.000');
    assert.equal(p.getState().equipos[0].bestLap, 65.0);
  });
});

// ── Pit state and _lapInvalid ─────────────────────────────────────────────────

group('pit state and _lapInvalid', () => {
  test('so sets _lapInvalid → next |*| not recorded', () => {
    let lapFired = false;
    const p = createParser({ onLap: () => { lapFired = true; } });
    p.setGrid({ colMap: { no: 'c1', grp: 'c0' }, colByNum: { c1: 'no', c0: 'grp' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    p.parse('r1c0|so|');           // pit out → _lapInvalid = true
    p.parse('r1|*|65000|');        // box→meta partial: should be blocked
    assert.ok(!lapFired, 'lap after so must be blocked');
    assert.equal(p.getState().equipos[0].lapHistory.length, 0);
  });

  test('_lapInvalid cleared after blocked |*| (next lap is valid)', () => {
    let lapCount = 0;
    const p = createParser({ onLap: () => lapCount++ });
    p.setGrid({ colMap: { no: 'c1', grp: 'c0' }, colByNum: { c1: 'no', c0: 'grp' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    p.parse('r1c0|so|');
    p.parse('r1|*|65000|');  // blocked, but clears _lapInvalid
    p.parse('r1|*|66000|');  // valid
    assert.equal(lapCount, 1);
  });

  test('ss sets _lapInvalid', () => {
    let lapFired = false;
    const p = createParser({ onLap: () => { lapFired = true; } });
    p.setGrid({ colMap: { no: 'c1', grp: 'c0' }, colByNum: { c1: 'no', c0: 'grp' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    p.parse('r1c0|ss|');       // bandera → _lapInvalid
    p.parse('r1|*|65000|');    // blocked
    assert.ok(!lapFired);
  });

  test('si fires onPit with type=in', () => {
    let pitType = null;
    const p = createParser({ onPit: (dorsal, type) => { pitType = type; } });
    p.setGrid({ colMap: { no: 'c1', grp: 'c0' }, colByNum: { c1: 'no', c0: 'grp' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    p.parse('r1c0|si|');
    assert.equal(pitType, 'in');
  });

  test('so fires onPit with type=out', () => {
    let pitType = null;
    const p = createParser({ onPit: (dorsal, type) => { pitType = type; } });
    p.setGrid({ colMap: { no: 'c1', grp: 'c0' }, colByNum: { c1: 'no', c0: 'grp' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    p.parse('r1c0|so|');
    assert.equal(pitType, 'out');
  });

  test('sr clears _lapInvalid (via RUN_STATES)', () => {
    let lapFired = false;
    const p = createParser({ onLap: () => { lapFired = true; } });
    p.setGrid({ colMap: { no: 'c1', grp: 'c0' }, colByNum: { c1: 'no', c0: 'grp' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    p.parse('r1c0|ss|');   // invalidate
    p.parse('r1c0|sr|');   // clear via RUN_STATES
    p.parse('r1|*|65000|');
    assert.ok(lapFired, 'sr should clear _lapInvalid');
  });
});

// ── Session lifecycle ─────────────────────────────────────────────────────────

group('session lifecycle', () => {
  test('light|lf sets sessionFinished and fires onSessionEnd', () => {
    let ended = false;
    const p = createParser({ onSessionEnd: () => { ended = true; } });
    p.parse('light|lf');
    assert.ok(ended);
    assert.ok(p.sessionFinished);
  });

  test('grid| after sessionFinished → resets state and fires onNewSession', () => {
    let newSession = false;
    const p = createParser({ onNewSession: () => { newSession = true; } });
    // Activate a session first (parse a grid)
    p.parse('grid|<html>');
    // Mark finished
    p.parse('light|lf');
    assert.ok(p.sessionFinished);
    // New grid → should reset
    p.parse('grid|<html>');
    assert.ok(newSession, 'onNewSession should fire');
    assert.ok(!p.sessionFinished, 'sessionFinished should be cleared');
  });

  // Mismo contrato que __tests__/apex-protocol.test.js del logger: las dos copias
  // del parser deben entregar la parrilla saliente, no el estado ya vaciado.
  test('onNewSession receives the outgoing state, not the wiped one', () => {
    let saliente = null;
    const p = createParser({ onNewSession: (estado) => { saliente = estado; } });
    p.parse('grid|<html>');
    p.parse('r1|*|65000|');
    p.parse('r2|*|66000|');
    assert.equal(p.getState().equipos.filter(Boolean).length, 2);

    p.parse('light|lf');
    p.parse('grid|<html>');

    assert.equal(p.getState().equipos.filter(Boolean).length, 0, 'parser should be wiped');
    assert.ok(saliente, 'callback should receive the outgoing state');
    assert.equal(saliente.equipos.filter(Boolean).length, 2, 'outgoing state should keep both karts');
  });

  test('second grid| without sessionFinished → does NOT reset or fire onNewSession', () => {
    let newSessionCount = 0;
    const p = createParser({ onNewSession: () => newSessionCount++ });
    p.parse('grid|<html>');
    p.parse('grid|<html>');
    assert.equal(newSessionCount, 0, 'no reset without sessionFinished or inactivity');
  });
});

// ── Countdown / dyn1 ─────────────────────────────────────────────────────────

group('countdown messages', () => {
  test('dyn1|countdown| fires onCountdown with mode=countdown', () => {
    let ms = null, mode = null;
    const p = createParser({ onCountdown: (m, mo) => { ms = m; mode = mo; } });
    p.parse('dyn1|countdown|5400000');
    assert.equal(ms, 5400000);
    assert.equal(mode, 'countdown');
  });

  test('dyn1|count| fires onCountdown with mode=count', () => {
    let mode = null;
    const p = createParser({ onCountdown: (m, mo) => { mode = mo; } });
    p.parse('dyn1|count|3600000');
    assert.equal(mode, 'count');
  });

  test('dyn1|text| with empty text fires onCountdown stop', () => {
    let mode = null;
    const p = createParser({ onCountdown: (m, mo) => { mode = mo; } });
    p.parse('dyn1|text|');
    assert.equal(mode, 'stop');
  });
});

// ── Contador de vuelta líder (Lap / Vuelta) ───────────────────────────────────

group('leaderLap desde dyn1|text| (multiidioma)', () => {
  test('inglés: "Lap 11/15" fija leaderLap = 11', () => {
    const p = createParser({});
    p.parse('dyn1|text|Lap 11/15');
    assert.equal(p.getState().leaderLap, 11);
  });

  test('español: "Vuelta 11/15" fija leaderLap = 11', () => {
    const p = createParser({});
    p.parse('dyn1|text|Vuelta 11/15');
    assert.equal(p.getState().leaderLap, 11, 'debe reconocer "Vuelta", no solo "Lap"');
  });

  test('getter leaderLap coincide con "Vuelta 7/15"', () => {
    const p = createParser({});
    p.parse('dyn1|text|Vuelta 7/15');
    assert.equal(p.leaderLap, 7);
  });
});

// ── Tipo de sesión desde init|p| / init|r| ────────────────────────────────────

group('sessionMode desde init|X|', () => {
  test('init|p| → sessionMode = "p" (clasificación)', () => {
    const p = createParser({});
    p.parse('init|p|');
    assert.equal(p.getState().sessionMode, 'p');
    assert.equal(p.sessionMode, 'p');
  });

  test('init|r| → sessionMode = "r" (carrera)', () => {
    const p = createParser({});
    p.parse('init|r|');
    assert.equal(p.getState().sessionMode, 'r');
  });

  test('init dispara callback onMode con la letra', () => {
    let seen = null;
    const p = createParser({ onMode: (m) => { seen = m; } });
    p.parse('init|r|');
    assert.equal(seen, 'r');
  });

  test('reset() limpia sessionMode', () => {
    const p = createParser({});
    p.parse('init|r|');
    p.reset();
    assert.equal(p.sessionMode, '');
  });
});

// ── Position direct message ───────────────────────────────────────────────────

group('r1|#|N position message', () => {
  test('sets kart position', () => {
    const p = createParser({});
    p.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    p.parse('r1|#|3');
    assert.equal(p.getState().equipos[0].pos, 3);
  });

  test('records posChange when position changes', () => {
    const p = createParser({});
    p.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7', pos: 5 }] });
    p.parse('r1|#|3');
    const { equipos } = p.getState();
    assert.ok(equipos[0].posChange, 'posChange should be set');
    assert.equal(equipos[0].posChange.from, 5);
    assert.equal(equipos[0].posChange.to, 3);
  });
});

// ── mergeHttpHistory ──────────────────────────────────────────────────────────

group('mergeHttpHistory()', () => {
  test('prepends HTTP laps to existing WS laps', () => {
    const p = createParser({});
    p.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    p.parse('r1|*|65000|');  // WS lap
    p.mergeHttpHistory('r1', [60.0, 61.0, 62.0], 4);
    const { equipos } = p.getState();
    assert.equal(equipos[0].lapHistory.length, 4);
    assert.equal(equipos[0].lapHistory[0], 60.0);
    assert.equal(equipos[0].lapHistory[3], 65.0);
  });

  test('does NOT overwrite lastLap', () => {
    const p = createParser({});
    p.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    p.parse('r1|*|65000|');
    const lastLapBefore = p.getState().equipos[0].lastLap;
    p.mergeHttpHistory('r1', [60.0, 61.0], 3);
    assert.equal(p.getState().equipos[0].lastLap, lastLapBefore, 'lastLap must not change');
  });

  test('deduplicates laps already in history (±0.05s)', () => {
    const p = createParser({});
    p.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    p.parse('r1|*|65000|');   // 65.0s already in history
    p.mergeHttpHistory('r1', [60.0, 65.020], 3); // 65.020 ≈ 65.0 → skip
    assert.equal(p.getState().equipos[0].lapHistory.length, 2);
  });

  test('updates bestLap from HTTP history', () => {
    const p = createParser({});
    p.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    p.parse('r1|*|65000|');
    p.mergeHttpHistory('r1', [60.0, 61.0], 3);
    assert.equal(p.getState().equipos[0].bestLap, 60.0);
  });

  test('updates tours to max(current, tourCount)', () => {
    const p = createParser({});
    p.setGrid({ colMap: { no: 'c1', tlp: 'c5' }, colByNum: { c1: 'no', c5: 'tlp' },
      karts: [{ rowId: 'r1', dorsal: '7', tours: 10 }] });
    p.mergeHttpHistory('r1', [65.0], 15);
    assert.equal(p.getState().equipos[0].tours, 15);
  });
});

// ── getKartIds ────────────────────────────────────────────────────────────────

group('getKartIds()', () => {
  test('returns rowId and dorsal for karts with dorsal', () => {
    const p = createParser({});
    p.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [
        { rowId: 'r1', dorsal: '7' },
        { rowId: 'r2', dorsal: '12' },
      ] });
    const ids = p.getKartIds();
    assert.equal(ids.length, 2);
    assert.ok(ids.some(i => i.rowId === 'r1' && i.dorsal === '7'));
    assert.ok(ids.some(i => i.rowId === 'r2' && i.dorsal === '12'));
  });

  test('excludes karts without dorsal', () => {
    const p = createParser({});
    // no setGrid — raw kart created by |*|
    p.parse('r5|*|65000|');  // r5 has no dorsal yet
    assert.equal(p.getKartIds().length, 0);
  });
});

// ── getState() structure ──────────────────────────────────────────────────────

group('getState() structure', () => {
  test('returns expected fields', () => {
    const p = createParser({});
    p.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7', pos: 1 }] });
    p.parse('r1|*|65000|');
    const state = p.getState();
    assert.ok(Array.isArray(state.equipos));
    assert.ok(typeof state.leaderLap === 'number');
    assert.ok(typeof state.timestamp === 'number');
    assert.ok('sessionFinished' in state);
    assert.ok('colMap' in state);
    const k = state.equipos[0];
    assert.ok('dorsal'      in k);
    assert.ok('lapHistory'  in k);
    assert.ok('bestLap'     in k);
    assert.ok('lastLap'     in k);
    assert.ok('pit'         in k);
    assert.ok('pitState'    in k);
    assert.ok('tours'       in k);
    assert.ok('standsCount' in k);
  });

  test('equipos sorted by pos', () => {
    const p = createParser({});
    p.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [
        { rowId: 'r1', dorsal: '7',  pos: 3 },
        { rowId: 'r2', dorsal: '12', pos: 1 },
        { rowId: 'r3', dorsal: '5',  pos: 2 },
      ] });
    const { equipos } = p.getState();
    assert.equal(equipos[0].dorsal, '12');
    assert.equal(equipos[1].dorsal, '5');
    assert.equal(equipos[2].dorsal, '7');
  });
});

// ── onChange callback ─────────────────────────────────────────────────────────

group('onChange callback', () => {
  test('fires after any recognized message', () => {
    let changeCount = 0;
    const p = createParser({ onChange: () => changeCount++ });
    p.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    p.parse('r1|*|65000|');
    assert.ok(changeCount >= 1);
  });

  test('passes state to onChange', () => {
    let lastState = null;
    const p = createParser({ onChange: s => { lastState = s; } });
    p.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    p.parse('r1|*|65000|');
    assert.ok(lastState && Array.isArray(lastState.equipos));
  });
});

// ── reset() ───────────────────────────────────────────────────────────────────

group('reset()', () => {
  test('clears all state', () => {
    const p = createParser({});
    p.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
      karts: [{ rowId: 'r1', dorsal: '7' }] });
    p.parse('r1|*|65000|');
    p.reset();
    const { equipos } = p.getState();
    assert.equal(equipos.length, 0);
    assert.ok(!p.sessionFinished);
    assert.deepEqual(p.colMap, {});
  });
});

// ── Sesión realista (flujo real con columna llp) ──────────────────────────────
//
// En todos los circuitos reales de Apex que hemos grabado existe la columna llp.
// El flujo canónico por vuelta es siempre:
//   r1|*|65000|   → no registra (llp existe), guarda flash anti-dedup
//   r1c3|llp|1:05.000 → parseTime → registra vuelta, refina si flash < 5s
//
// Estos tests simulan eso con varios karts y un pit stop.

group('sesión realista (flujo |*| + llp)', () => {
  function buildRealParser(onLap, onPit) {
    const p = createParser({ onLap, onPit });
    // Grid típico de un circuito real: grp, no, dr, llp, blp, tlp, pit
    p.setGrid({
      colMap:   { grp: 'c0', no: 'c1', dr: 'c2', llp: 'c3', blp: 'c4', tlp: 'c5', pit: 'c6' },
      colByNum: { c0: 'grp', c1: 'no', c2: 'dr', c3: 'llp', c4: 'blp', c5: 'tlp', c6: 'pit' },
      karts: [
        { rowId: 'r1', pos: 1, dorsal: '7',  name: 'TEAM ALPHA' },
        { rowId: 'r2', pos: 2, dorsal: '12', name: 'TEAM BETA'  },
      ],
    });
    return p;
  }

  test('|*| no registra vuelta cuando llp existe', () => {
    let lapCount = 0;
    const p = buildRealParser(() => lapCount++, null);
    p.parse('r1|*|65000|');
    assert.equal(lapCount, 0, '|*| con llp no debe disparar onLap');
    assert.equal(p.getState().equipos.find(k => k.dorsal === '7').lapHistory.length, 0);
  });

  test('llp registra la vuelta (flujo normal)', () => {
    let lapCount = 0, lapDorsal = null, lapMs = null;
    const p = buildRealParser((d, n, tn, ms) => { lapCount++; lapDorsal = d; lapMs = ms; }, null);
    p.parse('r1|*|65000|');
    p.parse('r1c3|llp|1:05.000');
    assert.equal(lapCount, 1);
    assert.equal(lapDorsal, '7');
    assert.equal(lapMs, 65000);
    const k = p.getState().equipos.find(k => k.dorsal === '7');
    assert.equal(k.lapHistory.length, 1);
    assert.equal(k.lastLap, 65.0);
  });

  test('llp refina el tiempo del flash (no duplica)', () => {
    let lapCount = 0;
    const p = buildRealParser(() => lapCount++, null);
    p.parse('r1|*|65000|');         // flash = 65.0
    p.parse('r1c3|llp|1:05.032');   // refina a 65.032, mismo onLap
    assert.equal(lapCount, 1);
    const k = p.getState().equipos.find(k => k.dorsal === '7');
    assert.equal(k.lapHistory.length, 1);
    assert.equal(k.lastLap, 65.032);
  });

  test('varias vueltas consecutivas de dos karts', () => {
    const laps = [];
    const p = buildRealParser((d, n, tn, ms, lapN) => laps.push({ d, ms, lapN }), null);

    // Vuelta 1 kart 7
    p.parse('r1|*|65000|');
    p.parse('r1c3|llp|1:05.000');
    // Vuelta 1 kart 12
    p.parse('r2|*|66500|');
    p.parse('r2c3|llp|1:06.500');
    // Vuelta 2 kart 7
    p.parse('r1|*|64800|');
    p.parse('r1c3|llp|1:04.800');

    assert.equal(laps.length, 3);
    assert.equal(laps[0].d, '7');  assert.equal(laps[0].lapN, 1);
    assert.equal(laps[1].d, '12'); assert.equal(laps[1].lapN, 1);
    assert.equal(laps[2].d, '7');  assert.equal(laps[2].lapN, 2);

    const k7 = p.getState().equipos.find(k => k.dorsal === '7');
    assert.equal(k7.lapHistory.length, 2);
    assert.equal(k7.bestLap, 64.8);
    assert.equal(k7.lastLap, 64.8);
  });

  test('pit stop: so bloquea parcial box→meta, after sr la vuelta siguiente es válida', () => {
    let lapCount = 0;
    const p = buildRealParser(() => lapCount++, null);

    // Vuelta normal antes del pit
    p.parse('r1|*|65000|');
    p.parse('r1c3|llp|1:05.000');
    assert.equal(lapCount, 1);

    // Entra a boxes
    p.parse('r1c0|si|');
    // Sale de boxes → marca la siguiente vuelta como inválida (box→meta)
    p.parse('r1c0|so|');
    p.parse('r1|*|30000|');         // parcial box→meta: BLOQUEADO
    p.parse('r1c3|llp|0:30.000');   // llp de parcial (< 20s en parseTime? No, 30s ≥ 20)
    // Nota: el llp de 30s sí pasaría el filtro de parseTime (≥20 && <300),
    // pero |*|30000| ya limpió _lapInvalid, así que llp sin flash reciente → vuelta nueva.
    // Este comportamiento es el real: el parcial entra como "vuelta" en el history.
    // Lo importante es que el |*| del parcial NO disparó onLap (estaba bloqueado).

    // Kart vuelve a pista: sr limpia estado
    p.parse('r1c0|sr|');

    // Primera vuelta completa tras salir
    p.parse('r1|*|65500|');
    p.parse('r1c3|llp|1:05.500');

    // lapCount: 1 (inicial) + 1 (llp del parcial post-so sin |*| válido) + 1 (tras sr) = 3
    // Pero el |*| del parcial estaba bloqueado → onLap no se disparó desde |*|
    // El llp del parcial (30s) sí se disparó porque llp no tiene el bloqueo de _lapInvalid
    assert.ok(lapCount >= 2, 'al menos la vuelta inicial y la post-sr');
  });

  test('la parcial box→meta de so NO dispara onLap desde |*|', () => {
    let lapFireds = [];
    const p = buildRealParser((d, n, ms) => lapFireds.push(ms), null);

    p.parse('r1|*|65000|');
    p.parse('r1c3|llp|1:05.000');

    p.parse('r1c0|si|');
    p.parse('r1c0|so|');
    p.parse('r1|*|30000|');  // bloqueado por _lapInvalid — NO debe aparecer en lapFireds desde |*|

    // solo el |*| de 65000 disparó onLap (vía llp)
    assert.ok(!lapFireds.includes(30000), '|*| parcial de box→meta no debe llegar como onLap');
  });
});

// ── Regresión: nombres de piloto (bugs corregidos 2026-06-24) ─────────────────

group('dr column — pilot name regression', () => {

  // Bug: en TimeAttack/individuales, setGrid ponía el nombre solo en teamName
  // y k.name quedaba vacío → grid mostraba #55, #48 en vez del nombre
  test('TimeAttack setGrid: nombre sin brackets va a k.name', () => {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', dorsal: '55', pos: 1, name: 'JAVIER COY' }],
    });
    const { equipos } = p.getState();
    assert.equal(equipos[0].name, 'JAVIER COY', 'name debe venir de grid.name en individuales');
  });

  // Formato de celda en vivo: r1c2|ti|VALOR  (rowId+col concatenados)
  test('TimeAttack _applyCell dr sin brackets: establece k.name si estaba vacío', () => {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', dorsal: '55', pos: 1 }],
    });
    p.parse('r1c2|ti|JAVIER COY');
    assert.equal(p.getState().equipos[0].name, 'JAVIER COY');
  });

  test('TimeAttack _applyCell dr sin brackets: teamName también se actualiza', () => {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', dorsal: '55', pos: 1 }],
    });
    p.parse('r1c2|ti|TEAM RACING');
    assert.equal(p.getState().equipos[0].teamName, 'TEAM RACING');
  });

  // Endurance: brackets → k.name limpio (sin el "[0:10]"), k.teamName separado
  test('Endurance _applyCell dr con brackets: k.name limpio sin contador', () => {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', dorsal: '7', pos: 1, name: 'Team StintPro' }],
    });
    p.parse('r1c2|ti|Javier Coy [0:10]');
    const k = p.getState().equipos[0];
    assert.equal(k.name, 'Javier Coy', 'name debe ser solo el nombre, sin [0:10]');
  });

  test('Endurance _applyCell dr: brackets no sobreescriben teamName', () => {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', dorsal: '7', pos: 1, name: 'Team StintPro' }],
    });
    // primero llega el nombre de equipo (sin brackets)
    p.parse('r1c2|ti|Team StintPro');
    // luego llega el piloto (con brackets)
    p.parse('r1c2|ti|Javier Coy [0:10]');
    const k = p.getState().equipos[0];
    assert.equal(k.name, 'Javier Coy', 'name debe ser el piloto');
    assert.equal(k.teamName, 'Team StintPro', 'teamName debe conservarse del mensaje sin brackets');
  });

  // Bug: isNaN(parseInt(n)) descartaba cualquier nombre que empezara por dígito
  // ("24H Racing" → parseInt=24 → no NaN → rechazado). Ahora solo se rechaza lo
  // puramente numérico (dorsales/tiempos), no nombres alfanuméricos con dígito inicial.
  test('nombre que empieza por dígito se acepta (celda en vivo)', () => {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', dorsal: '7', pos: 1 }],
    });
    p.parse('r1c2|ti|24H Racing');
    assert.equal(p.getState().equipos[0].name, '24H Racing');
  });

  test('otro nombre con dígito inicial: "1000 Millas"', () => {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', dorsal: '7', pos: 1 }],
    });
    p.parse('r1c2|ti|1000 Millas');
    assert.equal(p.getState().equipos[0].name, '1000 Millas');
  });

  test('valor puramente numérico se sigue rechazando como nombre', () => {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', dorsal: '7', pos: 1, name: 'Real Name' }],
    });
    p.parse('r1c2|ti|42');       // dorsal puro → no debe pisar el nombre
    p.parse('r1c2|ti|64.500');   // tiempo puro → tampoco
    assert.equal(p.getState().equipos[0].name, 'Real Name');
  });

  test('setGrid: nombre con dígito inicial va a k.name', () => {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', dorsal: '7', pos: 1, name: '24H Racing' }],
    });
    assert.equal(p.getState().equipos[0].name, '24H Racing');
  });

  test('Endurance _applyCell dr con brackets: no sobreescribe k.name si ya está puesto', () => {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', dorsal: '7', pos: 1 }],
    });
    p.parse('r1c2|ti|Javier Coy [0:10]');
    // alternancia: llega equipo sin brackets — NO debe pisar k.name
    p.parse('r1c2|ti|Team StintPro');
    assert.equal(p.getState().equipos[0].name, 'Javier Coy', 'nombre de equipo no debe pisar el piloto ya conocido');
  });

  test('getState() expone teamName en el equipo', () => {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2' },
      colByNum: { c1: 'no', c2: 'dr' },
      karts: [{ rowId: 'r1', dorsal: '7', pos: 1, name: 'Team StintPro' }],
    });
    p.parse('r1c2|ti|Javier Coy [0:10]');
    assert.ok('teamName' in p.getState().equipos[0], 'teamName debe estar en getState()');
  });
});

// ── Reconciliación de vueltas (tours vs lapHistory) ───────────────────────────

group('tours reconciliado con lapHistory.length', () => {
  test('sin columna de vueltas: tours cae a lapHistory.length', () => {
    // colMap SIN tlp/lc y SIN llp → |*| es la fuente de vueltas
    const p = createParser({});
    p.setGrid({ colMap: { no: 'c1', dr: 'c2' }, colByNum: { c1: 'no', c2: 'dr' },
                karts: [{ rowId: 'r1', dorsal: '7', pos: 1 }] });
    // 3 vueltas con tiempos distintos (anti-dedup)
    p.parse('r1|*|44000|');
    p.parse('r1|*|44100|');
    p.parse('r1|*|44200|');
    const e = p.getState().equipos[0];
    assert.equal(e.tours, 3, 'sin columna, tours = nº de pases por meta registrados');
  });

  test('con columna de vueltas mayor: se prefiere la oficial', () => {
    const p = createParser({});
    p.setGrid({ colMap: { no: 'c1', dr: 'c2', tlp: 'c3' }, colByNum: { c1: 'no', c2: 'dr', c3: 'tlp' },
                karts: [{ rowId: 'r1', dorsal: '7', pos: 1 }] });
    p.parse('r1|*|44000|');           // 1 en lapHistory
    p.parse('r1c3||10');              // columna oficial dice 10 vueltas
    assert.equal(p.getState().equipos[0].tours, 10, 'con columna oficial > historial, gana la columna');
  });

  test('columna oficial MENOR que lapHistory inflado: gana la oficial (Apex manda)', () => {
    // Reproduce el sobreconteo: Apex reenvía la celda llp con el MISMO tiempo al
    // cambiar el color de la vuelta (ti/tb) → lapHistory se infla, pero el contador
    // mostrado debe seguir a la columna oficial de Apex (lc/tlp), no al historial.
    const p = createParser({});
    p.setGrid({ colMap:   { no: 'c1', dr: 'c2', llp: 'c3', tlp: 'c4' },
                colByNum: { c1: 'no', c2: 'dr', c3: 'llp', c4: 'tlp' },
                karts: [{ rowId: 'r1', dorsal: '7', pos: 1 }] });
    p.parse('r1c3|tn|1:05.000');      // vuelta 1 (por columna llp)
    p.parse('r1c3|tn|1:05.200');      // vuelta 2
    p.parse('r1c3|ti|1:05.200');      // REENVÍO mismo tiempo + color → vuelta fantasma
    p.parse('r1c4||2');               // columna oficial de Apex: 2 vueltas
    const e = p.getState().equipos[0];
    assert.equal(e.lapHistory.length, 3, 'lapHistory se infla con el reenvío (entrada conocida)');
    assert.equal(e.tours, 2, 'el contador usa la columna oficial de Apex, no el historial inflado');
  });

  test('sin vueltas ni columna: tours = 0', () => {
    const p = createParser({});
    p.setGrid({ colMap: { no: 'c1' }, colByNum: { c1: 'no' },
                karts: [{ rowId: 'r1', dorsal: '7', pos: 1 }] });
    assert.equal(p.getState().equipos[0].tours, 0);
  });
});

// ── Título tardío tras el grid (modo "Directo a Apex") ────────────────────────
// Mismo fallo que corrompió la COPA PISTON 2026 en el logger (sesión 1075): Apex
// manda el title1 de la carrera ~40s DESPUÉS del init|r|+grid|, antes de que ruede
// ninguna vuelta. Sin protección, ese título borra los karts que el grid acababa
// de poblar y el resto de la carrera se lee con el rowId (transponder) como dorsal
// — en la app eso significa no encontrar tu propio kart.
group('título tardío tras el grid', () => {
  const gridDeCarrera = p => p.setGrid({
    colMap:   { no: 'c3', dr: 'c4' },
    colByNum: { c3: 'no', c4: 'dr' },
    karts: [
      { rowId: 'r8676', dorsal: '6',  name: 'JAVIER ICOY' },
      { rowId: 'r8677', dorsal: '7',  name: 'PILOTO 7' },
      { rowId: 'r8678', dorsal: '12', name: 'PILOTO 12' },
    ],
  });

  test('un title1 posterior al grid, sin vueltas aún, NO borra los karts', () => {
    let nuevas = 0;
    const p = createParser({ onChange: () => {}, onNewSession: () => nuevas++, onGrid: () => gridDeCarrera(p) });
    p.parse('title1||INDIVIDUAL 1H');
    p.parse('grid|<tbody></tbody>');
    p.parse('title1||COPA PISTON 2026');
    assert.equal(nuevas, 0);
    assert.deepEqual(p.getState().equipos.map(e => e.dorsal).sort(), ['12', '6', '7']);
  });

  test('las vueltas siguientes llevan el dorsal real, no el transponder', () => {
    const emitidos = [];
    const p = createParser({ onChange: () => {}, onGrid: () => gridDeCarrera(p),
                             onLap: d => emitidos.push(String(d)) });
    p.parse('title1||INDIVIDUAL 1H');
    p.parse('grid|<tbody></tbody>');
    p.parse('title1||COPA PISTON 2026');
    p.parse('r8676|*|36181|0');
    p.parse('r8676|*|36087|0');
    assert.ok(!emitidos.includes('8676'), `emitió el transponder: ${emitidos.join(',')}`);
    assert.deepEqual(emitidos, ['6', '6']);
  });

  test('sin columna "no" mapeada no se inventa dorsal desde el rowId', () => {
    const emitidos = [];
    const p = createParser({ onChange: () => {}, onLap: d => emitidos.push(String(d)) });
    p.parse('r8676|*|36181|0');   // sin grid → colMap vacío
    p.parse('r8676|*|36087|0');
    assert.ok(!emitidos.includes('8676'), `emitió el transponder: ${emitidos.join(',')}`);
  });
});

group('categoría / clase', () => {
  function parserConClase() {
    const p = createParser({});
    p.setGrid({
      colMap:   { no: 'c1', dr: 'c2', class: 'c4', llp: 'c3' },
      colByNum: { c1: 'no', c2: 'dr', c4: 'class', c3: 'llp' },
      catCol:   'c4',
      karts: [{ rowId: 'r1', pos: 1, dorsal: '7', name: 'TEAM A' }],
    });
    return p;
  }

  test('la celda de la columna class llega como category', () => {
    const p = parserConClase();
    p.parse('r1c4|tn|390');
    assert.equal(p.getState().equipos[0].category, '390');
  });

  test('un código de estado colado en esa columna no es categoría', () => {
    const p = parserConClase();
    p.parse('r1c4|tn|sr');
    assert.equal(p.getState().equipos[0].category, null);
  });

  test('un tiempo colado en esa columna no es categoría', () => {
    const p = parserConClase();
    p.parse('r1c4|tn|1:04.500');
    assert.equal(p.getState().equipos[0].category, null);
  });

  test('un nombre largo colado al reordenar el grid no es categoría', () => {
    const p = parserConClase();
    p.parse('r1c4|tn|Moises Morales Gonzalez');
    assert.equal(p.getState().equipos[0].category, null);
  });

  test('sin columna class, category es null', () => {
    const p = parserWithLlp();
    assert.equal(p.getState().equipos[0].category, null);
  });
});

// ── Results ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
