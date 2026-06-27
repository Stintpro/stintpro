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
