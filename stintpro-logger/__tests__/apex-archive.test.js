// Tests para apex-archive.js — copia de la tanda que algunos circuitos archivan
// en request.php (S#) y reparación de vueltas grabadas sin parrilla.
// Fixture: respuesta REAL de `S#62` de Campillos (FP25, 2026-11-13).

const fs = require('fs');
const path = require('path');
const A = require('../apex-archive');

const TEXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'apex-archive-campillos-fp25.txt'), 'utf8');

describe('parseSessionList', () => {
  test('lee id y título de cada tanda archivada', () => {
    expect(A.parseSessionList('64#FP27 - FP27\n63#FP26 - FP26\n\n')).toEqual([
      { id: 64, title: 'FP27 - FP27' },
      { id: 63, title: 'FP26 - FP26' },
    ]);
  });

  test('vacío o error → lista vacía', () => {
    expect(A.parseSessionList('')).toEqual([]);
    expect(A.parseSessionList('error')).toEqual([]);
  });
});

describe('readArchive (formato real de Campillos)', () => {
  const a = A.readArchive(TEXT);

  test('saca el título de la tanda', () => {
    expect(a.title).toBe('FP25 · FP25');
  });

  test('mapea cada fila de Apex a su dorsal y piloto', () => {
    expect(a.rows.size).toBe(38);
    const r = a.rows.get('20228');
    expect(r.dorsal).toBe('7');
    expect(typeof r.name).toBe('string');
    expect(r.name.length).toBeGreaterThan(3);
  });

  test('texto sin parrilla → sin filas', () => {
    expect(A.readArchive('').rows.size).toBe(0);
    expect(A.readArchive('error').rows.size).toBe(0);
  });
});

describe('pickArchive', () => {
  const fp25 = { id: 62, ...A.readArchive(TEXT) };
  const otra = { id: 61, title: 'FP24 · FP24', rows: new Map([['1', { dorsal: '1', name: 'X' }]]) };

  test('elige la tanda archivada que comparte las filas de la sesión', () => {
    const ids = new Set(['20228', '20229', '20230', '99999']);
    expect(A.pickArchive([otra, fp25], ids)).toBe(fp25);
  });

  test('sin solape suficiente no elige ninguna (no es esta sesión)', () => {
    expect(A.pickArchive([otra, fp25], new Set(['20228', '5', '6', '7', '8']))).toBeNull();
    expect(A.pickArchive([otra, fp25], new Set())).toBeNull();
  });
});

describe('planRepair', () => {
  const rows = new Map([['20228', { dorsal: '7', name: 'ANA PEREZ' }], ['20229', { dorsal: '13', name: 'LUIS GIL' }]]);

  test('las vueltas grabadas con la fila y sin nombre pasan a dorsal + piloto', () => {
    const laps = [
      { dorsal: '20228', name: null }, { dorsal: '20228', name: null },
      { dorsal: '20229', name: null },
    ];
    expect(A.planRepair(laps, rows)).toEqual([
      { from: '20228', to: '7', name: 'ANA PEREZ' },
      { from: '20229', to: '13', name: 'LUIS GIL' },
    ]);
  });

  test('no toca vueltas que ya tienen nombre ni filas desconocidas para el archivo', () => {
    const laps = [{ dorsal: '7', name: 'ANA PEREZ' }, { dorsal: '20228', name: 'YA TIENE' }, { dorsal: '55555', name: null }];
    expect(A.planRepair(laps, rows)).toEqual([]);
  });
});
