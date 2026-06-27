// Tests para apex-protocol.js — lógica de parseo del protocolo Apex Timing
//
// NOTAS de diseño:
//   - createParser no parsea HTML. Usamos p.setGrid() directamente para
//     inicializar colMap/colByNum y los karts sin depender del wrapper HTML.
//   - Sin llp en colMap, el mensaje |*| es la fuente de verdad de tiempos.
//   - Los códigos de estado (si/so/sr/ss…) se detectan automáticamente
//     cuando la columna no está mapeada (dtype vacío + STATE_CODES).
//   - Hay que enviar un grid| vacío para que _sessionActive=true,
//     lo que permite que el siguiente grid| dispare onNewSession.

const { createParser, parseTime } = require('../apex-protocol');

// ── parseTime ─────────────────────────────────────────────────────────────────

describe('parseTime', () => {
  test('formato MM:SS.mmm', () => {
    expect(parseTime('1:04.893')).toBeCloseTo(64.893, 3);
  });

  test('formato segundos con decimales', () => {
    expect(parseTime('64.893')).toBeCloseTo(64.893, 3);
  });

  test('formato milisegundos (>1000)', () => {
    expect(parseTime('64893')).toBeCloseTo(64.893, 3);
  });

  test('valor vacío → null', () => {
    expect(parseTime('')).toBeNull();
    expect(parseTime(null)).toBeNull();
    expect(parseTime(undefined)).toBeNull();
  });

  test('cadena no numérica → null', () => {
    expect(parseTime('abc')).toBeNull();
    expect(parseTime('0')).toBeNull();
  });

  test('sufijos de letra ignorados', () => {
    expect(parseTime('1:04.893s')).toBeCloseTo(64.893, 3);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// colMap SIN llp → |*| actúa como fuente de verdad de tiempos
function makeParser(callbacks = {}, karts = [{ rowId: 'r1', dorsal: '7', name: 'JAVIER' }]) {
  const p = createParser(callbacks);
  p.setGrid({
    colMap:   { no: 'c1', dr: 'c2', blp: 'c4', rk: 'c5', gap: 'c6', int: 'c7' },
    colByNum: { c1: 'no', c2: 'dr', c4: 'blp', c5: 'rk', c6: 'gap', c7: 'int' },
    karts,
  });
  // grid| activa _sessionActive para que el siguiente grid| dispare onNewSession
  p.parse('grid|');
  return p;
}

// colMap CON llp → llp es la fuente de verdad; |*| solo guarda _lapFromFlash para refinar
function makeParserWithLlp(callbacks = {}) {
  const p = createParser(callbacks);
  p.setGrid({
    colMap:   { no: 'c1', dr: 'c2', llp: 'c3', blp: 'c4' },
    colByNum: { c1: 'no', c2: 'dr', c3: 'llp', c4: 'blp' },
    karts: [{ rowId: 'r1', dorsal: '7', name: 'JAVIER' }],
  });
  p.parse('grid|');
  return p;
}

function parse(p, ...lines) { p.parse(lines.join('\n')); }

// c99 no está en colByNum → dtype='' → isStateCode se activa para si/so/ss/sr…
function stateMsg(rowId, code) { return `${rowId}c99|${code}|`; }

function kart7(p) { return p.getState().equipos.find(e => e.dorsal === '7'); }

// ── Detección de vueltas via |*| ──────────────────────────────────────────────

describe('detección de vueltas via |*|', () => {
  test('registra vuelta válida y llama onLap', () => {
    const onLap = jest.fn();
    const p = makeParser({ onLap });
    parse(p, 'r1|*|64893|0');
    expect(onLap).toHaveBeenCalledTimes(1);
    const [dorsal, , , lapMs] = onLap.mock.calls[0]; // (dorsal, name, teamName, lapMs, ...)
    expect(dorsal).toBe('7');
    expect(lapMs).toBe(64893);
  });

  test('ignora vuelta < 20s', () => {
    const onLap = jest.fn();
    const p = makeParser({ onLap });
    parse(p, 'r1|*|5000|0');
    expect(onLap).not.toHaveBeenCalled();
  });

  test('ignora vuelta > 300s', () => {
    const onLap = jest.fn();
    const p = makeParser({ onLap });
    parse(p, 'r1|*|350000|0');
    expect(onLap).not.toHaveBeenCalled();
  });

  test('acumula lapHistory y calcula bestLap', () => {
    const p = makeParser();
    parse(p, 'r1|*|64000|0', 'r1|*|65000|0', 'r1|*|63500|0');
    const k = kart7(p);
    expect(k.lapHistory).toHaveLength(3);
    expect(k.bestLap).toBeCloseTo(63.5, 2);
    expect(k.lastLap).toBeCloseTo(63.5, 2);
  });

  test('vuelta tras ss (bandera amarilla) es inválida', () => {
    const onLap = jest.fn();
    const p = makeParser({ onLap });
    parse(p, stateMsg('r1', 'ss'), 'r1|*|64000|0');
    expect(onLap).not.toHaveBeenCalled();
  });

  test('vuelta anulada *in|0 bloquea siguiente |*|', () => {
    const onLap = jest.fn();
    const p = makeParser({ onLap });
    parse(p, 'r1|*in|0', 'r1|*|64000|0');
    expect(onLap).not.toHaveBeenCalled();
  });

  test('lapFlash activo justo después de |*|', () => {
    const p = makeParser();
    parse(p, 'r1|*|64000|0');
    expect(kart7(p).lapFlash).toBe(true);
  });

  test('sin llp en colMap, |*| NO empuja vuelta cuando llp está mapeado', () => {
    // Con llp mapeado el |*| no crea la entrada; la crea el llp posterior
    const onLap = jest.fn();
    const p = makeParserWithLlp({ onLap });
    parse(p, 'r1|*|64000|0'); // debería ser silencioso
    expect(onLap).not.toHaveBeenCalled();
  });
});

// ── Detección de vueltas via llp ──────────────────────────────────────────────

describe('detección de vueltas via llp', () => {
  test('llp sin |*| previo crea vuelta nueva', () => {
    const onLap = jest.fn();
    const p = makeParserWithLlp({ onLap });
    parse(p, 'r1c3|llp|1:04.500');
    expect(onLap).toHaveBeenCalledTimes(1);
    expect(onLap.mock.calls[0][3]).toBe(64500); // índice 3 = lapMs (tras teamName)
  });

  test('llp refina vuelta de |*| (anti-dedup: 1 sola entrada en history)', () => {
    const p = makeParserWithLlp();
    parse(p, 'r1|*|64000|0');    // guarda _lapFromFlash, no empuja onLap
    parse(p, 'r1c3|llp|1:04.200'); // refina esa entrada
    const k = kart7(p);
    expect(k.lapHistory).toHaveLength(1);
    expect(k.lastLap).toBeCloseTo(64.2, 1);
  });

  test('dos llp separados generan dos vueltas distintas', () => {
    const onLap = jest.fn();
    const p = makeParserWithLlp({ onLap });
    parse(p, 'r1c3|llp|1:04.500');
    parse(p, 'r1c3|llp|1:03.200');
    expect(onLap).toHaveBeenCalledTimes(2);
    expect(kart7(p).lapHistory).toHaveLength(2);
  });
});

// ── Ciclo de sesión ───────────────────────────────────────────────────────────

describe('ciclo de sesión', () => {
  test('light|lf dispara onSessionEnd y sessionFinished=true', () => {
    const onSessionEnd = jest.fn();
    const p = makeParser({ onSessionEnd });
    parse(p, 'light|lf');
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
    expect(p.sessionFinished).toBe(true);
  });

  test('nuevo grid tras bandera dispara onNewSession', () => {
    const onNewSession = jest.fn();
    const p = makeParser({ onNewSession });
    parse(p, 'light|lf');
    parse(p, 'grid|');
    expect(onNewSession).toHaveBeenCalledTimes(1);
    expect(p.sessionFinished).toBe(false);
  });

  test('onNewSession resetea los karts', () => {
    const p = makeParser();
    parse(p, 'r1|*|64000|0');
    expect(p.getState().equipos).toHaveLength(1);
    parse(p, 'light|lf');
    parse(p, 'grid|');
    expect(p.getState().equipos).toHaveLength(0);
  });

  test('reset() limpia todo el estado', () => {
    const p = makeParser();
    parse(p, 'r1|*|64000|0', 'light|lf');
    p.reset();
    expect(p.getState().equipos).toHaveLength(0);
    expect(p.sessionFinished).toBe(false);
  });
});

// ── Pit events ────────────────────────────────────────────────────────────────

describe('pit in / out', () => {
  // Los códigos de estado van por columna no mapeada (c99) → dtype='' → isStateCode=true

  test('si dispara onPit("in")', () => {
    const onPit = jest.fn();
    const p = makeParser({ onPit });
    parse(p, stateMsg('r1', 'si'));
    expect(onPit).toHaveBeenCalledWith('7', 'in', expect.any(Number), expect.any(Number));
  });

  test('so dispara onPit("out")', () => {
    const onPit = jest.fn();
    const p = makeParser({ onPit });
    parse(p, stateMsg('r1', 'si'), stateMsg('r1', 'so'));
    expect(onPit).toHaveBeenLastCalledWith('7', 'out', expect.any(Number), expect.any(Number));
  });

  test('pit=true y pitState="in" tras si', () => {
    const p = makeParser();
    parse(p, stateMsg('r1', 'si'));
    const k = kart7(p);
    expect(k.pit).toBe(true);
    expect(k.pitState).toBe('in');
  });

  test('pitState="out" tras so', () => {
    const p = makeParser();
    parse(p, stateMsg('r1', 'si'), stateMsg('r1', 'so'));
    expect(kart7(p).pitState).toBe('out');
  });

  test('vuelta tras si (pit in) es inválida', () => {
    const onLap = jest.fn();
    const p = makeParser({ onLap });
    parse(p, stateMsg('r1', 'si'), 'r1|*|64000|0');
    expect(onLap).not.toHaveBeenCalled();
  });
});

// ── Posición ──────────────────────────────────────────────────────────────────

describe('posición', () => {
  test('r1|#|3 actualiza pos', () => {
    const p = makeParser();
    parse(p, 'r1|#|3');
    expect(kart7(p).pos).toBe(3);
  });

  test('celda rk actualiza pos', () => {
    const p = makeParser();
    parse(p, 'r1c5|rk|2');
    expect(kart7(p).pos).toBe(2);
  });

  test('getState ordena equipos por posición', () => {
    const p = makeParser({}, [
      { rowId: 'r1', dorsal: '10' },
      { rowId: 'r2', dorsal: '20' },
      { rowId: 'r3', dorsal: '30' },
    ]);
    parse(p, 'r1|#|2', 'r2|#|1', 'r3|#|3');
    const dorsales = p.getState().equipos.map(e => e.dorsal);
    expect(dorsales).toEqual(['20', '10', '30']);
  });
});

// ── Gap / interval ────────────────────────────────────────────────────────────

describe('gap e interval', () => {
  test('gap numérico formateado como +X.XXX', () => {
    const p = makeParser();
    parse(p, 'r1c6|gap|5.234');
    expect(kart7(p).gap).toBe('+5.234');
  });

  test('gap de vuelta completa formateado como +Nv', () => {
    const p = makeParser();
    parse(p, 'r1c6|gap|1 lap');
    expect(kart7(p).gap).toBe('+1v');
  });

  test('gap cero → string vacío', () => {
    const p = makeParser();
    parse(p, 'r1c6|gap|0');
    expect(kart7(p).gap).toBe('');
  });
});

// ── kartCount ─────────────────────────────────────────────────────────────────

describe('kartCount', () => {
  test('cuenta karts con dorsal asignado', () => {
    const p = makeParser({}, [
      { rowId: 'r1', dorsal: '7' },
      { rowId: 'r2', dorsal: '12' },
      { rowId: 'r3', dorsal: '5' },
    ]);
    expect(p.kartCount).toBe(3);
  });
});
