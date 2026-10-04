#!/usr/bin/env node
// Tests del tablón de dirección de carrera (canal com| de Apex): avisos de la
// organización que NO llegan por msg|. Todas las cadenas son REALES, de los raw
// logs del VPS (30H Campillos 2026-10-03, Ariza, Misanino). Se prueban las dos
// copias del parser (app y logger).
// Run: node tests/apex-com-board.test.js

'use strict';

const assert = require('assert/strict');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}`); console.error(`    ${e.message}`); failed++; }
}
function group(name, fn) { console.log(`\n${name}`); fn(); }

const P = (clock, flag, body) => `<p><b>${clock}</b><span data-flag="${flag}"></span>${body}</p>`;
const NO = n => `<span class="com_no">${n}</span>`;

const E_PIT45   = P('18:13', 'warning', NO(45) + 'Advertencia - Tiempo Pit : 02:29 (Vuelta 335) NEXT PIT 3:01');
const E_SPLIT   = P('18:00', 'msg_error', 'Theam #14 and # 22 no more push next stint,need to split NOW');
const E_SPLIT_OK= P('18:00', 'msg_error', 'Team #14 and # 22 no more push next stint,need to split NOW');
const E_VISOR   = P('18:32', 'msg_warning', 'CLEAR VISOR MANDATORY FROM 19:30');
const E_PUSH    = P('18:53', 'warning', NO(30) + 'Advertencia - push and pass on #23 NEXT PIT 2:40');
const E_GREEN   = P('10:00', 'green', 'Start');

for (const [copia, ruta] of [['app', '../src/apex-protocol'], ['logger', '../stintpro-logger/apex-protocol']]) {
  const { parseComBoard, classifyComEntry, classifyApexMessage, createComBoardTracker } = require(ruta);
  const cls = html => classifyComEntry(parseComBoard(html)[0]);

  group(`[${copia}] Leer el tablón`, () => {
    test('una entrada por <p>, la más reciente primero, con dorsal si lo lleva', () => {
      const b = parseComBoard(E_PIT45 + E_SPLIT + E_GREEN);
      assert.equal(b.length, 3);
      assert.deepEqual(b[0], { clock: '18:13', flag: 'warning', dorsal: '45', text: 'Advertencia - Tiempo Pit : 02:29 (Vuelta 335) NEXT PIT 3:01' });
      assert.deepEqual(b[1], { clock: '18:00', flag: 'msg_error', dorsal: null, text: 'Theam #14 and # 22 no more push next stint,need to split NOW' });
      assert.equal(b[2].flag, 'green');
    });
    test('dorsal con clase extra (com_no no2) y etiqueta con cifras (penalty219202)', () => {
      const b = parseComBoard(P('11:55', 'penalty', '<span class="com_no no2">51</span>Penalización - AJUSTE CRONO NO ES PENALIZACION - 1 Posición')
                            + P('11:17', 'penalty219202', '10 SECONDI ADD TIME N° 3 ENTRATA PERICOLOSA BOX'));
      assert.equal(b[0].dorsal, '51');
      assert.equal(b[1].flag, 'penalty219202');
    });
    test('vacío o basura → []', () => {
      assert.deepEqual(parseComBoard(''), []);
      assert.deepEqual(parseComBoard('<p></p>'), []);
      assert.deepEqual(parseComBoard(null), []);
    });
  });

  group(`[${copia}] Clasificar cada entrada`, () => {
    test('aviso a un dorsal: tipo, dorsal y motivo sin la palabra "Advertencia"', () => {
      const m = cls(E_PIT45);
      assert.equal(m.kind, 'warning');
      assert.equal(m.dorsal, '45');
      assert.deepEqual(m.dorsals, ['45']);
      assert.equal(m.reason, 'Tiempo Pit : 02:29 (Vuelta 335) NEXT PIT 3:01');
      assert.equal(m.clock, '18:13');
      assert.equal(m.source, 'com');
    });
    test('aviso general de la organización: sin dorsales', () => {
      const m = cls(E_VISOR);
      assert.equal(m.kind, 'warning');
      assert.equal(m.dorsal, null);
      assert.deepEqual(m.dorsals, []);
      assert.equal(m.reason, 'CLEAR VISOR MANDATORY FROM 19:30');
    });
    test('texto libre que nombra a varios equipos → todos los dorsales', () => {
      const m = cls(E_SPLIT);
      assert.deepEqual(m.dorsals, ['14', '22']);
      assert.equal(m.dorsal, null);
      assert.deepEqual(cls(P('20:42', 'msg_error', 'Team #15 #8  #15no more Push for Next Stint')).dorsals, ['15', '8']);
    });
    test('con dorsal propio en la entrada, los que nombra el texto no cuentan', () => {
      assert.deepEqual(cls(E_PUSH).dorsals, ['30']);
    });
    test('sanción con castigo', () => {
      const m = cls(P('11:55', 'penalty', '<span class="com_no no2">51</span>Penalización - AJUSTE CRONO NO ES PENALIZACION - 1 Posición'));
      assert.equal(m.kind, 'penalty');
      assert.equal(m.reason, 'AJUSTE CRONO NO ES PENALIZACION');
      assert.equal(m.penalty, '1 Posición');
    });
    test('sanción en texto libre con "N° 3" → ese dorsal', () => {
      const m = cls(P('11:17', 'penalty219202', '10 SECONDI ADD TIME N° 3 ENTRATA PERICOLOSA BOX'));
      assert.equal(m.kind, 'penalty');
      assert.equal(m.dorsal, '3');
      assert.deepEqual(m.dorsals, ['3']);
    });
    test('las horas y vueltas del texto no son dorsales', () => {
      assert.deepEqual(cls(P('14:02', 'msg_warning', 'REMINDER: Pit Close at 0:30h Remaining.')).dorsals, []);
      assert.deepEqual(cls(P('08:03', 'msg_warning', 'Important message: 10:00h change of direction back to clockwise. 06:00h remaining, pit close  06:15h remaining')).dorsals, []);
    });
    test('mensaje sin etiqueta de gravedad (msg) → other', () => {
      assert.equal(cls(P('12:00', 'msg', 'TEAM #11 and #17  Need to split Now')).kind, 'other');
    });
    test('banderas del cronograma (salida, llegada) y entradas vacías → null', () => {
      assert.equal(cls(E_GREEN), null);
      assert.equal(cls(P('11:53', 'chequered', 'Llegada')), null);
      assert.equal(cls(P('11:53', 'warning', '')), null);
      assert.equal(classifyComEntry(null), null);
    });
  });

  group(`[${copia}] msg| sin prefijo de dorsal (antes se tiraba)`, () => {
    test('msgp sin prefijo → sanción, con los dorsales que nombra', () => {
      const m = classifyApexMessage('Theam #29 and # 20 no more push next stint', 'msgp');
      assert.equal(m.kind, 'penalty');
      assert.deepEqual(m.dorsals, ['29', '20']);
      assert.equal(m.dorsal, null);
    });
    test('con prefijo: dorsals = [dorsal]', () => {
      assert.deepEqual(classifyApexMessage('N°14 RED RACING : Avertissement - LIGNE DE COURSE', '').dorsals, ['14']);
    });
    test('mejor vuelta sigue siendo best aunque el subtipo diga otra cosa', () => {
      assert.equal(classifyApexMessage('Mejor vuelta : WARM UP PRO  - 1:22.236 (69.17 Km/h)', 'msgp').kind, 'best');
    });
  });

  group(`[${copia}] Seguimiento del tablón (Apex lo reenvía entero cada vez)`, () => {
    test('primer tablón tras conectar = historial, del más antiguo al más reciente', () => {
      const t = createComBoardTracker();
      const out = t.ingest(E_PIT45 + E_SPLIT + E_GREEN);
      assert.equal(out.length, 2);                       // la verde no es mensaje
      assert.deepEqual(out.map(m => m.clock), ['18:00', '18:13']);
      assert.ok(out.every(m => m.history === true));
    });
    test('entrada nueva en cabeza → solo esa, en vivo', () => {
      const t = createComBoardTracker();
      t.ingest(E_PIT45 + E_SPLIT);
      const out = t.ingest(E_VISOR + E_PIT45 + E_SPLIT);
      assert.equal(out.length, 1);
      assert.equal(out[0].reason, 'CLEAR VISOR MANDATORY FROM 19:30');
      assert.equal(out[0].history, false);
    });
    test('reenvío idéntico → nada', () => {
      const t = createComBoardTracker();
      t.ingest(E_PIT45 + E_SPLIT);
      assert.deepEqual(t.ingest(E_PIT45 + E_SPLIT), []);
    });
    test('la organización corrige una errata (Theam→Team) → no es un aviso nuevo', () => {
      const t = createComBoardTracker();
      t.ingest(E_SPLIT);
      assert.equal(t.ingest(E_PIT45 + E_SPLIT).length, 1);
      assert.deepEqual(t.ingest(E_PIT45 + E_SPLIT_OK), []);
    });
    test('dos avisos distintos en el mismo minuto → entran los dos', () => {
      const t = createComBoardTracker();
      t.ingest(E_SPLIT);
      const otro = P('18:00', 'msg_error', 'Team #29 and # 20 no more push next stint');
      const out = t.ingest(otro + E_SPLIT);
      assert.equal(out.length, 1);
      assert.deepEqual(out[0].dorsals, ['29', '20']);
    });
    test('tablón vacío al conectar: lo siguiente ya es en vivo', () => {
      const t = createComBoardTracker();
      assert.deepEqual(t.ingest('<p></p>'), []);
      assert.equal(t.ingest(E_VISOR)[0].history, false);
    });
    test('reset (sesión nueva o reconexión) → vuelve a tratar el tablón como historial', () => {
      const t = createComBoardTracker();
      t.ingest(E_SPLIT);
      t.reset();
      assert.equal(t.ingest(E_SPLIT)[0].history, true);
    });
  });
}

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
