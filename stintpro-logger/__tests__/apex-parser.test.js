// Tests para apex-parser.js — wrapper HTML + integración con apex-protocol
//
// ApexParser parsea el HTML del grid y llama a proto.setGrid() internamente,
// lo que activa el colMap. Tras el grid, las celdas y callbacks funcionan igual
// que en los tests de apex-protocol, pero aquí probamos el parsing HTML mismo.

const ApexParser = require('../apex-parser');

// ── Helpers ───────────────────────────────────────────────────────────────────

// Columnas estándar para los grids de test:
// c1=no, c2=dr, c3=llp, c4=blp — SIN rk en tabla (posición via |#| o gridPos)
const STANDARD_COLS =
  '<td data-id="c1" data-type="no"></td>' +
  '<td data-id="c2" data-type="dr"></td>' +
  '<td data-id="c3" data-type="llp"></td>' +
  '<td data-id="c4" data-type="blp"></td>';

function buildGrid({ colDefs = '', rows = '' } = {}) {
  return (
    'grid|<table><tbody>' +
    `<tr data-id="r0">${colDefs}</tr>` +
    rows +
    '</tbody></table>'
  );
}

// Fila de kart sin posición (la posición se fija después via |#|)
function kartRow(rowId, dorsal, name) {
  return (
    `<tr data-id="${rowId}">` +
    `<td data-id="${rowId}c1"><div>${dorsal}</div></td>` +
    `<td data-id="${rowId}c2"><div>${name}</div></td>` +
    `<td data-id="${rowId}c3"></td>` +
    `<td data-id="${rowId}c4"></td>` +
    '</tr>'
  );
}

// ── parseTime re-exportada ────────────────────────────────────────────────────

describe('parseTime (vía apex-protocol)', () => {
  const { parseTime } = require('../apex-protocol');

  test('exporta parseTime correctamente', () => {
    expect(typeof parseTime).toBe('function');
    expect(parseTime('1:04.500')).toBeCloseTo(64.5, 2);
  });
});

// ── Grid HTML parsing ─────────────────────────────────────────────────────────

describe('_parseGrid', () => {
  test('extrae dorsal y nombre desde el grid HTML', () => {
    const p = new ApexParser();
    p.parse(buildGrid({
      colDefs: STANDARD_COLS,
      rows: kartRow('r1', '7', 'JAVIER'),
    }));
    const kart = p.getState().equipos.find(e => e.dorsal === '7');
    expect(kart).toBeDefined();
    expect(kart.name).toBe('JAVIER');
  });

  test('nombre con sufijo [MM:SS] se limpia', () => {
    const p = new ApexParser();
    p.parse(buildGrid({
      colDefs: STANDARD_COLS,
      rows: kartRow('r1', '7', 'JAVIER COY [1:04]'),
    }));
    const kart = p.getState().equipos.find(e => e.dorsal === '7');
    expect(kart.name).toBe('JAVIER COY');
  });

  // Antes isNaN(parseInt(n)) descartaba nombres que empiezan por dígito
  // ("24H Racing" → parseInt=24 → rechazado) y ese equipo quedaba sin nombre.
  test('nombre que empieza por dígito se conserva ("24H Racing")', () => {
    const p = new ApexParser();
    p.parse(buildGrid({
      colDefs: STANDARD_COLS,
      rows: kartRow('r1', '7', '24H Racing'),
    }));
    const kart = p.getState().equipos.find(e => e.dorsal === '7');
    expect(kart.name).toBe('24H Racing');
  });

  test('múltiples karts con posición fijada via |#|', () => {
    const p = new ApexParser();
    p.parse(buildGrid({
      colDefs: STANDARD_COLS,
      rows:
        kartRow('r1', '10', 'JAVIER') +
        kartRow('r2', '20', 'CARLOS') +
        kartRow('r3', '30', 'MARIA'),
    }));
    // Posiciones vía mensaje de protocolo (independiente del HTML del grid)
    p.parse('r1|#|2\nr2|#|1\nr3|#|3');

    const dorsales = p.getState().equipos.map(e => e.dorsal);
    expect(dorsales).toEqual(['20', '10', '30']);
  });

  test('grid vacío no lanza error', () => {
    const p = new ApexParser();
    expect(() => p.parse('grid|')).not.toThrow();
    expect(() => p.parse('grid|<table></table>')).not.toThrow();
  });

  test('HTML roto no lanza error', () => {
    const p = new ApexParser();
    expect(() => p.parse('grid|<<<bad html>>>')).not.toThrow();
  });
});

// ── Integración completa: grid → vueltas → sesión ────────────────────────────

describe('integración ApexParser', () => {
  // Con llp en colMap (STANDARD_COLS incluye c3=llp), |*| no llama onLap directamente.
  // Usamos llp para disparar onLap, o omitimos llp del grid.

  test('onLap se dispara via llp tras grid con colMap mapeado', () => {
    const onLap = jest.fn();
    const p = new ApexParser({ onLap });

    p.parse(buildGrid({
      colDefs: STANDARD_COLS,
      rows: kartRow('r1', '7', 'JAVIER'),
    }));
    p.parse('r1c3|llp|1:04.500');

    expect(onLap).toHaveBeenCalledTimes(1);
    const [dorsal, name, teamName, lapMs] = onLap.mock.calls[0]; // (dorsal, name, teamName, lapMs, ...)
    expect(dorsal).toBe('7');
    expect(name).toBe('JAVIER');
    expect(teamName).toBeNull(); // carrera individual — sin equipo
    expect(lapMs).toBe(64500);
  });

  test('onLap via |*| cuando llp no está en colMap', () => {
    const onLap = jest.fn();
    const p = new ApexParser({ onLap });

    // Grid sin columna llp
    p.parse(buildGrid({
      colDefs:
        '<td data-id="c1" data-type="no"></td>' +
        '<td data-id="c2" data-type="dr"></td>',
      rows: kartRow('r1', '7', 'JAVIER'),
    }));
    p.parse('r1|*|64500|0');

    expect(onLap).toHaveBeenCalledTimes(1);
    expect(onLap.mock.calls[0][3]).toBe(64500); // índice 3 = lapMs (tras teamName)
  });

  test('onSessionEnd se dispara con light|lf', () => {
    const onSessionEnd = jest.fn();
    const p = new ApexParser({ onSessionEnd });
    p.parse('light|lf');
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
    expect(p.sessionFinished).toBe(true);
  });

  test('onNewSession se dispara en nuevo grid tras bandera', () => {
    const onNewSession = jest.fn();
    const p = new ApexParser({ onNewSession });

    const grid = buildGrid({ colDefs: STANDARD_COLS, rows: kartRow('r1', '7', 'JAVIER') });
    p.parse(grid);        // activa _sessionActive
    p.parse('light|lf'); // sessionFinished = true
    p.parse(grid);        // dispara onNewSession

    expect(onNewSession).toHaveBeenCalledTimes(1);
    expect(p.sessionFinished).toBe(false);
  });

  test('sessionFinished empieza en false', () => {
    const p = new ApexParser();
    expect(p.sessionFinished).toBe(false);
    p.parse('light|lf');
    expect(p.sessionFinished).toBe(true);
  });

  test('kartCount cuenta dorsales válidos del grid', () => {
    const p = new ApexParser();
    p.parse(buildGrid({
      colDefs: STANDARD_COLS,
      rows:
        kartRow('r1', '7',  'JAVIER') +
        kartRow('r2', '12', 'CARLOS') +
        kartRow('r3', '5',  'MARIA'),
    }));
    expect(p.kartCount).toBe(3);
  });

  test('lapHistory y bestLap acumulados correctamente', () => {
    const p = new ApexParser();
    // Sin llp en colMap para que |*| empuje las vueltas
    p.parse(buildGrid({
      colDefs:
        '<td data-id="c1" data-type="no"></td>' +
        '<td data-id="c2" data-type="dr"></td>',
      rows: kartRow('r1', '7', 'JAVIER'),
    }));
    p.parse('r1|*|64000|0\nr1|*|63500|0');

    const kart = p.getState().equipos.find(e => e.dorsal === '7');
    expect(kart.lapHistory).toHaveLength(2);
    expect(kart.bestLap).toBeCloseTo(63.5, 1);
  });

  test('onPit dispara en pit in (columna sin mapear → isStateCode)', () => {
    const onPit = jest.fn();
    const p = new ApexParser({ onPit });
    p.parse(buildGrid({ colDefs: STANDARD_COLS, rows: kartRow('r1', '7', 'JAVIER') }));
    p.parse('r1c99|si|'); // c99 no mapeado → dtype='' → isStateCode=true
    expect(onPit).toHaveBeenCalledWith('7', 'in', expect.any(Number), expect.any(Number));
  });
});

// ── Columna de categoría (dos cilindradas en la misma tabla) ─────────────────

describe('columna de categoría', () => {
  // Grid con una 5ª columna de categoría. Se prueban las dos formas de
  // declararla: dtype 'class' y texto de cabecera.
  const COLS_CAT_DTYPE = STANDARD_COLS + '<td data-id="c5" data-type="class">Cat.</td>';
  const COLS_CAT_TEXTO = STANDARD_COLS + '<td data-id="c5" data-type="xx">Categoría</td>';

  function kartRowCat(rowId, dorsal, name, cat) {
    return (
      `<tr data-id="${rowId}">` +
      `<td data-id="${rowId}c1"><div>${dorsal}</div></td>` +
      `<td data-id="${rowId}c2"><div>${name}</div></td>` +
      `<td data-id="${rowId}c3"></td>` +
      `<td data-id="${rowId}c4"></td>` +
      `<td data-id="${rowId}c5">${cat}</td>` +
      '</tr>'
    );
  }

  test('captura la categoría declarada por dtype "class"', () => {
    const p = new ApexParser();
    p.parse(buildGrid({
      colDefs: COLS_CAT_DTYPE,
      rows: kartRowCat('r1', '7', 'JAVIER', '270') + kartRowCat('r2', '8', 'ANA', '390'),
    }));
    const eq = p.getState().equipos;
    expect(eq.find(e => e.dorsal === '7').category).toBe('270');
    expect(eq.find(e => e.dorsal === '8').category).toBe('390');
  });

  test('captura la categoría por el texto de la cabecera', () => {
    const p = new ApexParser();
    p.parse(buildGrid({
      colDefs: COLS_CAT_TEXTO,
      rows: kartRowCat('r1', '7', 'JAVIER', '270 cc'),
    }));
    expect(p.getState().equipos.find(e => e.dorsal === '7').category).toBe('270 cc');
  });

  test('la categoría llega actualizada por celda en vivo', () => {
    const p = new ApexParser();
    p.parse(buildGrid({ colDefs: COLS_CAT_DTYPE, rows: kartRowCat('r1', '7', 'JAVIER', '') }));
    p.parse('r1c5||390');
    expect(p.getState().equipos.find(e => e.dorsal === '7').category).toBe('390');
  });

  test('la vuelta grabada lleva la categoría', () => {
    const laps = [];
    const p = new ApexParser({ onLap: (...a) => laps.push(a) });
    p.parse(buildGrid({ colDefs: COLS_CAT_DTYPE, rows: kartRowCat('r1', '7', 'JAVIER', '270') }));
    p.parse('r1c3||1:04.500');
    expect(laps.length).toBeGreaterThan(0);
    expect(laps[0][6]).toBe('270');   // 7º argumento = categoría
  });

  test('sin columna de categoría, nada cambia', () => {
    const p = new ApexParser();
    p.parse(buildGrid({ colDefs: STANDARD_COLS, rows: kartRow('r1', '7', 'JAVIER') }));
    expect(p.getState().equipos.find(e => e.dorsal === '7').category).toBeNull();
  });

  test('no confunde una columna de datos con la de categoría', () => {
    // Cabecera "Clasif." (posición) no debe tomarse por categoría
    const p = new ApexParser();
    p.parse(buildGrid({
      colDefs: '<td data-id="c1" data-type="rk">Clasif.</td>' + STANDARD_COLS,
      rows: kartRow('r1', '7', 'JAVIER'),
    }));
    expect(p.getState().equipos.find(e => e.dorsal === '7').category).toBeNull();
  });
});

// ── Blindaje de la captura de categoría ──────────────────────────────────────

describe('isValidCategory — filtra ruido del feed', () => {
  const { isValidCategory } = require('../apex-protocol');

  test('acepta categorías reales', () => {
    for (const v of ['PRO', 'AMATEUR', '270', '390', '270cc', 'SENIOR', 'GR 2', 'GOLD']) {
      expect(isValidCategory(v)).toBe(true);
    }
  });

  test('rechaza nombres de tipo de columna (fuga al reordenar el grid)', () => {
    for (const v of ['dr', 'no', 'gap', 'class', 'rku', 'blp']) {
      expect(isValidCategory(v)).toBe(false);
    }
  });

  test('rechaza tiempos, gaps e intervalos', () => {
    for (const v of ['29.415', '1:04.500', '+1,2', '30.111', '0.052']) {
      expect(isValidCategory(v)).toBe(false);
    }
  });

  test('rechaza vacíos y nombres de piloto', () => {
    for (const v of ['', '   ', null, undefined, 'Moises Morales Gonzalez']) {
      expect(isValidCategory(v)).toBe(false);
    }
  });
});

describe('categoría — persistencia frente a parpadeos', () => {
  const COLS_CAT = STANDARD_COLS + '<td data-id="c5" data-type="class">Clase</td>';
  function rowCat(rowId, dorsal, name, cat) {
    return (
      `<tr data-id="${rowId}">` +
      `<td data-id="${rowId}c1"><div>${dorsal}</div></td>` +
      `<td data-id="${rowId}c2"><div>${name}</div></td>` +
      `<td data-id="${rowId}c3"></td><td data-id="${rowId}c4"></td>` +
      `<td data-id="${rowId}c5">${cat}</td>` +
      '</tr>'
    );
  }

  test('un valor basura no sobrescribe una categoría ya fijada', () => {
    const p = new ApexParser();
    p.parse(buildGrid({ colDefs: COLS_CAT, rows: rowCat('r1', '7', 'JAVIER', 'PRO') }));
    // Al reordenar el grid llega por esa columna el token 'dr' y un tiempo
    p.parse('r1c5|dr');
    p.parse('r1c5||29.415');
    expect(p.getState().equipos.find(e => e.dorsal === '7').category).toBe('PRO');
  });

  test('el grid inicial no captura basura como categoría', () => {
    const p = new ApexParser();
    // La celda de categoría llega con el token de tipo 'dr' en vez de un valor
    p.parse(buildGrid({ colDefs: COLS_CAT, rows: rowCat('r1', '7', 'JAVIER', 'dr') }));
    expect(p.getState().equipos.find(e => e.dorsal === '7').category).toBeNull();
  });
});

// ── Regresión con log real de Sevilla (dos clases, grid reordenado) ──────────

describe('categoría — log real de Sevilla 2026-08-07', () => {
  const fs   = require('fs');
  const path = require('path');
  const fixture = path.join(__dirname, 'fixtures', 'sevilla-categorias.ndjson');

  test('captura PRO/AMATEUR sin ensuciarse con la reordenación de columnas', () => {
    const lapCats = {};
    const p = new ApexParser({ onLap: (d, n, t, ms, ln, ts, cat) => {
      lapCats[cat || '(sin)'] = (lapCats[cat || '(sin)'] || 0) + 1;
    }});
    for (const line of fs.readFileSync(fixture, 'utf8').split('\n')) {
      if (!line) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.raw) { try { p.parse(o.raw); } catch (e) { /* robustez */ } }
    }
    const conCat = p.getState().equipos.filter(e => e.category);
    const cats = {};
    for (const e of conCat) cats[e.category] = (cats[e.category] || 0) + 1;

    // 31 karts, exactamente dos clases, sin 'dr' ni tiempos colados
    expect(cats).toEqual({ PRO: 7, AMATEUR: 24 });
    // Y las vueltas grabadas solo llevan categorías reales
    for (const c of Object.keys(lapCats)) {
      if (c === '(sin)') continue;
      expect(['PRO', 'AMATEUR']).toContain(c);
    }
  });
});
