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

const { createParser, parseTime, isGlitchLap } = require('../apex-protocol');

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

// ── Anti-parpadeo del título (no borrar una carrera en vivo) ───────────────────
// Algunos feeds cambian el título y lo revierten en segundos con la carrera en
// marcha (Los Santos: IRONMAN→ENTRENOS→IRONMAN en 14s). Ese parpadeo NO debe
// borrar el estado; solo un fin de sesión real (bandera) o inactividad debe.

describe('anti-parpadeo del título', () => {
  test('cambio de título con vueltas fluyendo (sin bandera) NO borra', () => {
    const onNewSession = jest.fn();
    const p = makeParser({ onNewSession });
    parse(p, 'r1|*|64000|0');                 // vuelta reciente → carrera en marcha
    parse(p, 'title2||ENTRENOS');             // parpadeo del título
    expect(onNewSession).not.toHaveBeenCalled();
    expect(p.getState().equipos).toHaveLength(1);   // el kart sigue ahí
  });

  test('cambio de título TRAS bandera a cuadros SÍ es sesión nueva', () => {
    const onNewSession = jest.fn();
    const p = makeParser({ onNewSession });
    parse(p, 'r1|*|64000|0');
    parse(p, 'light|lf');                     // sesión terminada
    parse(p, 'title2||Sesión 47');            // ahora sí, título nuevo = sesión nueva
    expect(onNewSession).toHaveBeenCalledTimes(1);
    expect(p.getState().equipos).toHaveLength(0);
  });

  test('parpadeo ida y vuelta preserva el estado en ambos saltos', () => {
    const onNewSession = jest.fn();
    const p = makeParser({ onNewSession });
    parse(p, 'r1|*|64000|0');
    parse(p, 'title2||ENTRENOS');             // IRONMAN → ENTRENOS
    parse(p, 'title2||IRONMAN');              // ENTRENOS → IRONMAN (vuelta atrás)
    expect(onNewSession).not.toHaveBeenCalled();
    expect(p.getState().equipos).toHaveLength(1);
  });
});

// ── Columna de nombre (dr) blindada contra tiempos ────────────────────────────
// Un tiempo (con ':') en la columna de nombre —por grid mal etiquetado o inyección—
// no debe registrarse como nombre del equipo/piloto.

describe('columna dr blindada contra tiempos', () => {
  test('un tiempo NO sobrescribe el nombre real', () => {
    const p = makeParser();                   // r1 arranca con nombre 'JAVIER'
    parse(p, 'r1c2|tb|2:32.382');             // tiempo colado en la columna dr (c2)
    expect(kart7(p).name).toBe('JAVIER');
    expect(kart7(p).teamName).not.toBe('2:32.382');
  });

  test('un nombre real sí actualiza', () => {
    const p = makeParser();
    parse(p, 'r1c2|dr|SCUDERIA X');
    expect(kart7(p).teamName).toBe('SCUDERIA X');
  });

  test('nombre que empieza por número se conserva (24H Racing)', () => {
    const p = makeParser();
    parse(p, 'r1c2|dr|24H Racing');
    expect(kart7(p).teamName).toBe('24H Racing');
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
    // 5º arg = duración oficial de parada (crono otr); null sin columna otr de pit.
    expect(onPit).toHaveBeenLastCalledWith('7', 'out', expect.any(Number), expect.any(Number), null);
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

// ── Vuelta imposible por glitch de baliza (entrada a pit) ──────────────────────
// Una entrada a boxes puede hacer que la baliza cuente un trozo de vuelta como
// vuelta entera: un tiempo anormalmente corto que, al ser el más bajo, falsearía
// la vuelta rápida. Debe descartarse sin tocar vueltas reales.

describe('isGlitchLap (helper)', () => {
  const pace = [70, 71, 70, 72, 70]; // ritmo del kart ~70s (mejor = 70)

  test('descarta un trozo de vuelta (23s en pista de 70s)', () => {
    expect(isGlitchLap(pace, 23)).toBe(true);
  });

  test('conserva una vuelta rápida real (68s, 3% mejor)', () => {
    expect(isGlitchLap(pace, 68)).toBe(false);
  });

  test('conserva una vuelta de calentamiento lenta (85s)', () => {
    expect(isGlitchLap(pace, 85)).toBe(false);
  });

  test('sin ritmo propio (<3 vueltas) no filtra sin referencia de pista', () => {
    expect(isGlitchLap([70], 23)).toBe(false);
  });

  test('sin ritmo propio usa el ritmo de PISTA para glitches groseros', () => {
    // 1ª vuelta del kart (hist vacío) pero la pista rueda a ~70s → 23s es imposible
    expect(isGlitchLap([], 23, 70)).toBe(true);
    // un kart rápido real (55s) en pista de 70s NO se filtra
    expect(isGlitchLap([], 55, 70)).toBe(false);
  });

  test('la mejor vuelta no se contamina con vueltas lentas del historial', () => {
    // historial con vueltas de parada (250s) no infla la referencia: 88s es real
    expect(isGlitchLap([88, 250, 249, 90, 251], 88)).toBe(false);
  });
});

describe('glitch de pit no falsea la vuelta rápida', () => {
  test('un trozo de vuelta corto NO entra como mejor vuelta', () => {
    const p = makeParser();
    parse(p, 'r1|*|70000|0', 'r1|*|71000|0', 'r1|*|70500|0'); // ritmo ~70s
    parse(p, 'r1|*|23000|0'); // glitch de baliza al entrar a pit
    const k = kart7(p);
    expect(k.bestLap).toBeCloseTo(70, 1);        // sigue siendo la real, no 23
    expect(k.lapHistory).not.toContain(23);      // el glitch no se registró
  });
});

// ── Tokens de estado desconocidos ─────────────────────────────────────────────
// Apex mete en la columna sta tokens que NO son estado de carrera (visto 'sl',
// kart lento/doblado, en Sevilla). Antes se asignaban a k.state igualmente y,
// como la salida de boxes solo se limpia con 'sr'/'su', el kart se quedaba
// marcado en pit para siempre.

describe('tokens no catalogados en la columna de estado', () => {
  function makeParserWithSta(callbacks = {}) {
    const p = createParser(callbacks);
    p.setGrid({
      colMap:   { no: 'c1', sta: 'c2', pit: 'c3' },
      colByNum: { c1: 'no', c2: 'sta', c3: 'pit' },
      karts: [{ rowId: 'r1', dorsal: '7', name: 'JAVIER' }],
    });
    p.parse('grid|');
    return p;
  }

  test("'sl' no pisa el estado de carrera", () => {
    const p = makeParserWithSta();
    parse(p, 'r1c2|sr|', 'r1c2|sl|');
    expect(kart7(p).state).toBe('sr');
  });

  test("'sl' no deja al kart marcado en boxes", () => {
    const p = makeParserWithSta();
    parse(p, 'r1c3|to|45');            // crono de pit corriendo → pit=true
    parse(p, 'r1c2|sr|', 'r1c2|sl|');  // vuelve a pista y luego llega el 'sl'
    parse(p, 'r1c3|in|3');             // fin del crono: debe limpiar el pit
    expect(kart7(p).pit).toBe(false);
  });

  test('un token inventado tampoco cambia el estado', () => {
    const p = makeParserWithSta();
    parse(p, 'r1c2|si|', 'r1c2|zz|');
    expect(kart7(p).state).toBe('si');
  });
});

// ── Dorsal: no contaminar con el rowId (transponder) sin colMap ────────────────
describe('dorsal: fallback rowId solo con columna "no" mapeada', () => {
  // Reproduce la corrupción de la COPA PISTON (sesión 1075): las celdas de vuelta
  // llegan sin colMap (grid perdido en una reconexión). El data-id de fila de Apex
  // es el nº de TRANSPONDER (r8676), NO el dorsal; el dorsal real (6) solo viaja en
  // la columna 'no' del grid. Sin esa columna mapeada, el fallback NO debe usar el
  // rowId, o grabaría un dorsal falso de 4 cifras (8676).
  test('sin colMap con "no", no emite vueltas con el rowId como dorsal', () => {
    const onLap = jest.fn();
    // onChange presente = flujo real: el monitor llama getState() tras cada parse,
    // que es donde el fallback muta k.dorsal ← rowId.
    const p = createParser({ onLap, onChange: () => {} });
    // NO se procesa el grid → colMap vacío (sin 'no')
    p.parse('r8676|*|36181|0');
    p.parse('r8676|*|36087|0');
    p.parse('r8676|*|36200|0');
    const dorsalesEmitidos = onLap.mock.calls.map(c => c[0]);
    expect(dorsalesEmitidos).not.toContain('8676');
  });

  // Regresión: con la capa 1, un grid que llega DESPUÉS de las primeras vueltas
  // re-etiqueta el kart existente (rowId→dorsal real) SIN disparar "nueva sesión".
  // Esto es lo que hace innecesaria una "capa 2": la carrera no se parte en dos
  // (como pasó con la COPA PISTON 1075/1084) y el kart conserva sus vueltas.
  test('el grid re-etiqueta el kart existente sin partir la sesión', () => {
    const onNewSession = jest.fn();
    const p = createParser({ onLap: () => {}, onChange: () => {}, onNewSession });
    p.parse('r8676|*|36181|0');   // vueltas antes del grid → kart sin dorsal (capa 1)
    p.parse('r8676|*|36087|0');
    p.setGrid({
      colMap:   { no: 'c3', dr: 'c4' },
      colByNum: { c3: 'no', c4: 'dr' },
      karts: [{ rowId: 'r8676', dorsal: '6', name: 'JAVIER ICOY' }],
    });
    expect(onNewSession).not.toHaveBeenCalled();               // no se partió la sesión
    const eq = p.getState().equipos.find(e => e.dorsal === '6');
    expect(eq).toBeDefined();                                   // re-etiquetado al dorsal real
    expect(eq.lapHistory.length).toBe(2);                      // conservó las vueltas
  });
});
