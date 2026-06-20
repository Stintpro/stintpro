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
      onLap: (dorsal, name, ms, lapN) => {
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

// ── Results ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
