// Cambios de sesión de Apex que el parser no contemplaba — SAMUR-CNP 2026,
// Cabanillas, 2026-11-11. Los fixtures son los raw logs reales de ese día.
//
//   1. Tras la bandera, Apex descarga la sesión (init|n|) y la REENVÍA entera con
//      el resultado final. Se tomaba por sesión nueva: las dos últimas vueltas
//      (que solo venían en esa parrilla) se perdían y la siguiente vuelta suelta
//      abría la sesión de la carrera.
//   2. La parrilla de la carrera ya terminada sembraba sus mejores vueltas y la
//      clasificación siguiente (parrilla vacía, mismas filas) las heredaba.
//   3. Apex manda vueltas de filas que no están en la parrilla recibida al
//      conectar: el dorsal salía del identificador de fila.
const fs   = require('fs');
const path = require('path');
const ApexParser = require('../apex-parser');
const { createParser } = require('../apex-protocol');

const REC = path.join(__dirname, 'fixtures', 'recordings');
const frames = f => fs.readFileSync(path.join(REC, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

// Reproduce los frames con el reloj del sistema puesto a la hora de cada uno.
function replay(list, hasta = Infinity) {
  const ev = { laps: [], nuevas: [] };
  const parser = new ApexParser({
    now: () => Date.now(),
    onLap: (dorsal, name, team, ms) => ev.laps.push({ dorsal, name, ms, t: Date.now() }),
    onNewSession: (saliente) => ev.nuevas.push({ t: Date.now(), saliente }),
  });
  for (const f of list) {
    if (f.t > hasta) break;
    jest.setSystemTime(f.t);
    parser.parse(f.raw);
  }
  return { ev, parser, kart: d => parser.getState().equipos.find(e => e.dorsal === d) };
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('reenvío de una sesión ya terminada (Clasificación 1)', () => {
  const real = frames('cabanillas-clasif1-reenvio.ndjson');
  const reenvio = real.find(f => f.raw.startsWith('init|p'));           // 11:49:27, resultado final
  const carrera = real.find(f => f.raw.startsWith('init|r'));           // 11:50:23, Carrera 1
  // Parrilla de apertura que el logger habría tenido: la del reenvío, sin tiempos.
  const apertura = {
    t: real[0].t - 60000,
    raw: reenvio.raw
      .replace('light|lf|', 'light|lr|')
      .replace(/(<td data-id="r\d+c[1-2]" class=")[^"]*(")/g, '$1in$2')
      .replace(/(<td data-id="r\d+c[6-9]" class=")[^"]*(">)[^<]*</g, '$1in$2<')
      .replace(/(<p data-id="r\d+c3" class="">)\d+</g, '$1<'),
  };
  const todo = [apertura, ...real];

  test('no abre sesión nueva hasta que llega la carrera', () => {
    const { ev } = replay(todo, carrera.t - 1);
    expect(ev.nuevas).toHaveLength(0);
  });

  test('recupera la última vuelta que solo venía en la parrilla reenviada', () => {
    const { ev, kart } = replay(todo, carrera.t - 1);
    const de = d => ev.laps.filter(l => l.dorsal === d).map(l => l.ms);
    expect(de('3')).toEqual([66376, 65338, 65318, 65517, 64680]);       // Urbina: pole en la 5ª
    expect(de('7')[de('7').length - 1]).toBe(67335);                    // Sánchez
    expect(kart('3').bestLap).toBeCloseTo(64.680, 3);
  });

  test('la vuelta que llega tras el reenvío sigue siendo de la clasificación', () => {
    const { ev } = replay(todo, carrera.t - 1);
    expect(ev.laps.some(l => l.dorsal === '6' && l.ms === 68122)).toBe(true);   // Cervera, 11:49:31
  });

  test('la carrera abre UNA sesión nueva y entrega la clasificación final', () => {
    const { ev, parser } = replay(todo);
    expect(ev.nuevas).toHaveLength(1);
    const pole = ev.nuevas[0].saliente.equipos.find(e => e.pos === 1);
    expect(pole.name).toBe('URBINA Rafa');
    expect(pole.bestLap).toBeCloseTo(64.680, 3);
    expect(parser.getState().equipos.every(e => !e.bestLap && !e.lapTotal)).toBe(true);
  });
});

describe('clasificación tras una carrera con los mismos pilotos (Clasificación 2)', () => {
  const real = frames('cabanillas-clasif2-tras-carrera.ndjson');

  test('la mejor vuelta de cada piloto es de ESTA sesión, no de la carrera anterior', () => {
    const { ev, parser } = replay(real);
    for (const e of parser.getState().equipos) {
      const suyas = ev.laps.filter(l => l.dorsal === e.dorsal && l.t > real[2].t).map(l => l.ms / 1000);
      expect(suyas.length).toBeGreaterThan(0);
      expect(e.bestLap).toBeCloseTo(Math.min(...suyas), 3);
    }
  });

  test('Coy: 1:03.647 de la clasificación, no el 1:03.598 de la Carrera 1', () => {
    const { kart } = replay(real);
    expect(kart('3').name).toBe('COY SEGOVIA Javier');
    expect(kart('3').bestLap).toBeCloseTo(63.647, 3);
  });
});

describe('cambio de modo con parrilla sin tiempos', () => {
  const COLS = { colMap: { no: 'c1', dr: 'c2', llp: 'c3', blp: 'c4' }, colByNum: { c1: 'no', c2: 'dr', c3: 'llp', c4: 'blp' } };
  const fila = (i, extra = {}) => ({ rowId: 'r' + (100 + i), dorsal: String(i), name: 'PILOTO ' + i, ...extra });

  // Sin bandera a cuadros (el panel queda en rojo de reposo): la parrilla de la
  // carrera acabada siembra sus tiempos y luego llega la clasificación, vacía.
  test('init|r| con resultados → init|p| vacío: sesión nueva, sin tiempos heredados', () => {
    const nuevas = [];
    const p = createParser({ onNewSession: () => nuevas.push(1) });
    jest.setSystemTime(1_000_000);
    p.parse('init|r|\ngrid|x');
    p.setGrid({ ...COLS, karts: [1, 2, 3, 4].map(i => fila(i, { bestLap: 60 + i, lastLap: 61 + i })) });
    jest.setSystemTime(1_000_000 + 4 * 60000);
    p.parse('init|p|\ngrid|x');
    p.setGrid({ ...COLS, karts: [1, 2, 3, 4].map(i => fila(i)) });
    expect(nuevas).toHaveLength(1);
    expect(p.getState().equipos.map(e => e.bestLap)).toEqual([null, null, null, null]);
  });

  test('misma parrilla reenviada en el MISMO modo no abre sesión', () => {
    const nuevas = [];
    const p = createParser({ onNewSession: () => nuevas.push(1) });
    jest.setSystemTime(1_000_000);
    p.parse('init|r|\ngrid|x');
    p.setGrid({ ...COLS, karts: [1, 2, 3, 4].map(i => fila(i)) });
    jest.setSystemTime(1_000_000 + 4 * 60000);
    p.parse('init|r|\ngrid|x');
    p.setGrid({ ...COLS, karts: [1, 2, 3, 4].map(i => fila(i)) });
    expect(nuevas).toHaveLength(0);
  });

  test('cambio de modo con vueltas ya rodadas desde la parrilla NO borra la sesión', () => {
    const nuevas = [];
    const p = createParser({ onNewSession: () => nuevas.push(1) });
    jest.setSystemTime(1_000_000);
    p.parse('init|p|\ngrid|x');
    p.setGrid({ ...COLS, karts: [1, 2, 3, 4].map(i => fila(i)) });
    jest.setSystemTime(1_000_000 + 70000);
    p.parse('r101|*|65000|');
    jest.setSystemTime(1_000_000 + 80000);
    p.parse('init|r|\ngrid|x');
    p.setGrid({ ...COLS, karts: [1, 2, 3, 4].map(i => fila(i)) });
    expect(nuevas).toHaveLength(0);
  });
});

describe('filas que no están en la parrilla', () => {
  const COLS = { colMap: { no: 'c1', dr: 'c2', llp: 'c3' }, colByNum: { c1: 'no', c2: 'dr', c3: 'llp' } };

  test('avisa una vez por fila desconocida cuando ya hay parrilla', () => {
    const filas = [];
    const p = createParser({ onUnknownRow: r => filas.push(r) });
    p.parse('init|p|\ngrid|x');
    p.setGrid({ ...COLS, karts: [{ rowId: 'r1', dorsal: '1', name: 'UNO' }] });
    p.parse('r2279c2|in|');
    p.parse('r2279c2|sr|\nr2280c2|sr|');
    p.parse('r1|*|65000|');
    expect(filas).toEqual(['r2279', 'r2280']);
  });

  test('sin parrilla todavía no avisa (primera conexión a medias)', () => {
    const filas = [];
    const p = createParser({ onUnknownRow: r => filas.push(r) });
    p.parse('r2279|*|65000|');
    expect(filas).toEqual([]);
  });

  test('la parrilla que trae la fila la da por conocida', () => {
    const filas = [];
    const p = createParser({ onUnknownRow: r => filas.push(r) });
    p.parse('init|p|\ngrid|x');
    p.setGrid({ ...COLS, karts: [{ rowId: 'r1', dorsal: '1', name: 'UNO' }] });
    p.parse('grid|x');
    p.setGrid({ ...COLS, karts: [{ rowId: 'r1', dorsal: '1', name: 'UNO' }, { rowId: 'r2', dorsal: '2', name: 'DOS' }] });
    p.parse('r2|*|65000|');
    expect(filas).toEqual([]);
  });
});
