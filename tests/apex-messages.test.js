#!/usr/bin/env node
// Tests del clasificador de mensajes msg| de Apex (src/apex-protocol.js).
// Todas las cadenas son REALES, sacadas de los raw logs del VPS (corpus
// 2026-08-22 → 2026-09-02, 749 sesiones, 12 circuitos, 4 idiomas).
// Run: node tests/apex-messages.test.js

'use strict';

const assert = require('assert/strict');
const { classifyApexMessage, createParser } = require('../src/apex-protocol');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}`); console.error(`    ${e.message}`); failed++; }
}
function group(name, fn) { console.log(`\n${name}`); fn(); }

// ── Extracción de dorsal: 4 idiomas, 4 formatos de prefijo ───────────────────
// El número del mensaje es el DORSAL de la parrilla, no el rowId: verificado
// contra el corpus (115/115 dorsales existían en su parrilla).

group('Dorsal — formatos por idioma', () => {
  test('francés N°14', () => {
    const m = classifyApexMessage('N°14 KARTMANS II : Pénalité - Passage au stand en 01:58 (Tour 82) - 1 Tour');
    assert.equal(m.dorsal, '14');
    assert.equal(m.team, 'KARTMANS II');
  });

  test('español Nº.49 con paréntesis en el nombre', () => {
    const m = classifyApexMessage('Nº.49 OSCAR PEREZ (LLEVA ACOMPAÑANTE A LA COMIDA) : Penalización - 3.000');
    assert.equal(m.dorsal, '49');
    assert.equal(m.team, 'OSCAR PEREZ (LLEVA ACOMPAÑANTE A LA COMIDA)');
  });

  test('neerlandés Nr.7', () => {
    assert.equal(classifyApexMessage('Nr.7 KARTJE KILO. : Straf - kartwissel te laat - 30.000').dorsal, '7');
  });

  test('italiano Nr19 sin punto', () => {
    assert.equal(classifyApexMessage('Nr19 ZENIT RACING : Penalità - + 10 secondi (velocità ai box) - ').dorsal, '19');
  });
});

// ── Tipo de mensaje ──────────────────────────────────────────────────────────

group('Clasificación', () => {
  test('Pénalité → penalty', () => {
    assert.equal(classifyApexMessage('N°24 KILOUTOU : Pénalité - Conduite Dangereuse - 1 Tour').kind, 'penalty');
  });

  test('Avertissement → warning (aviso, no sanción)', () => {
    assert.equal(classifyApexMessage('N°43 FONTENAY ENERGIES : Avertissement - Conduite Dangereuse').kind, 'warning');
  });

  test('Straf → penalty', () => {
    assert.equal(classifyApexMessage('Nr.7 KARTJE KILO. : Straf - kartwissel te laat - 30.000').kind, 'penalty');
  });

  test('Penalización → penalty', () => {
    assert.equal(classifyApexMessage('Nº.11 ROBERT JOHNSON : Penalización - PIT CON BOX CERRADO - 1 Vuelta').kind, 'penalty');
  });

  test('supresión del mejor crono → penalty (te borran la vuelta)', () => {
    // Séptimo tipo, sin la palabra "Pénalité" delante: aparece en Le Mans y RKC.
    const m = classifyApexMessage("N°30 KART'HELL EXPRESS : SUPPRESSION DU MEILLEUR CHRONO - SORTIE DE STAND DANGEREUSE");
    assert.equal(m.kind, 'penalty');
    assert.equal(m.dorsal, '30');
    assert.equal(m.reason, 'SORTIE DE STAND DANGEREUSE');
  });

  test('mejor vuelta del evento → best, sin dorsal', () => {
    const m = classifyApexMessage('Meilleur Tour : KJC RACING  - 1:00.095 (58.71 km/h)');
    assert.equal(m.kind, 'best');
    assert.equal(m.dorsal, null);
  });

  test('mejor vuelta en español → best', () => {
    assert.equal(classifyApexMessage('Mejor vuelta : KART 11 - 1:11.066 (72.34 Km/h)').kind, 'best');
  });

  test('texto desconocido → other', () => {
    assert.equal(classifyApexMessage('Cualquier cosa que no reconocemos').kind, 'other');
  });
});

// ── Respaldo por subtipo ─────────────────────────────────────────────────────
// La línea es `msg|<subtipo>|<texto>` y el subtipo codifica el tipo: msgp=sanción,
// msgw=aviso, vacío=genérico. Sirve de red para un idioma que no reconozcamos.

group('Subtipo como respaldo', () => {
  test('texto no reconocido + subtipo msgp → penalty', () => {
    const m = classifyApexMessage('N°9 EQUIPO : Kara desconocida en idioma nuevo', 'msgp');
    assert.equal(m.kind, 'penalty');
  });

  test('texto no reconocido + subtipo msgw → warning', () => {
    assert.equal(classifyApexMessage('N°9 EQUIPO : Kara desconocida', 'msgw').kind, 'warning');
  });

  test('el subtipo no pisa lo que el texto ya dice', () => {
    const m = classifyApexMessage('N°43 FONTENAY : Avertissement - Conduite Dangereuse', 'msgp');
    assert.equal(m.kind, 'warning');
  });

  test('mejor vuelta con subtipo vacío sigue siendo best', () => {
    assert.equal(classifyApexMessage('Mejor vuelta : KART 11 - 1:11.066', '').kind, 'best');
  });
});

// ── Motivo y castigo ─────────────────────────────────────────────────────────
// El motivo es la parte que da valor: de ahí sale el reglamento del evento.

group('Motivo y castigo', () => {
  test('separa motivo y castigo', () => {
    const m = classifyApexMessage('N°14 KARTMANS II : Pénalité - Passage au stand en 01:58 (Tour 82) - 1 Tour');
    assert.equal(m.reason, 'Passage au stand en 01:58 (Tour 82)');
    assert.equal(m.penalty, '1 Tour');
  });

  test('aviso sin castigo → penalty null', () => {
    const m = classifyApexMessage('N°43 FONTENAY ENERGIES : Avertissement - Conduite Dangereuse');
    assert.equal(m.reason, 'Conduite Dangereuse');
    assert.equal(m.penalty, null);
  });

  test('castigo vacío tras el guión final → penalty null', () => {
    assert.equal(classifyApexMessage('Nr19 ZENIT RACING : Penalità - + 10 secondi (velocità ai box) - ').penalty, null);
  });

  test('segundo ":" dentro del motivo no rompe el corte', () => {
    // Caso real de misanino: el motivo lleva su propio ":".
    const m = classifyApexMessage('Nr9 SVK BLACK : Penalità - Tempo staffetta : 04:48 (Giro 287) - 10.000');
    assert.equal(m.dorsal, '9');
    assert.equal(m.team, 'SVK BLACK');
    assert.equal(m.reason, 'Tempo staffetta : 04:48 (Giro 287)');
    assert.equal(m.penalty, '10.000');
  });
});

// ── Integración con el parser ────────────────────────────────────────────────

group('Parser — línea msg|', () => {
  test('msg| con subtipo vacío emite onMessage con el texto tras el 2º pipe', () => {
    const seen = [];
    const p = createParser({ onMessage: (m) => seen.push(m) });
    p.parse('msg||N°24 KILOUTOU : Pénalité - Conduite Dangereuse - 1 Tour');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].dorsal, '24');
    assert.equal(seen[0].kind, 'penalty');
  });

  test('msg|msgp| (subtipo poblado) también se emite', () => {
    const seen = [];
    const p = createParser({ onMessage: (m) => seen.push(m) });
    p.parse('msg|msgp|Nr.5 KARTJE KILO. : Straf - kartwissel te laat - 30.000');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].dorsal, '5');
  });

  test('msg| vacío no emite nada', () => {
    const seen = [];
    const p = createParser({ onMessage: (m) => seen.push(m) });
    p.parse('msg||');
    assert.equal(seen.length, 0);
  });
});

console.log(`\n${passed + failed} tests — ${passed} pasados, ${failed} fallados\n`);
if (failed > 0) process.exit(1);
