// StintPro — escenarios del parser compartido, ejecutados contra LAS DOS copias
// (src/apex-protocol.js de la app y stintpro-logger/apex-protocol.js del VPS).
// Si una copia diverge en comportamiento, falla aquí.
// Ejecutar: node tests/parser-shared.test.js
'use strict';

const { strictEqual, deepStrictEqual, ok } = require('assert');
const path = require('path');

const COPIES = {
  app: require(path.join(__dirname, '..', 'src', 'apex-protocol.js')),
  logger: require(path.join(__dirname, '..', 'stintpro-logger', 'apex-protocol.js')),
};

let passed = 0, failed = 0;
function test(name, fn) {
  for (const [label, AP] of Object.entries(COPIES)) {
    const realNow = Date.now;
    try { fn(AP); console.log(`  ✓ [${label}] ${name}`); passed++; }
    catch (e) { console.log(`  ✗ [${label}] ${name} → ${e.message}`); failed++; }
    finally { Date.now = realNow; }
  }
}

const MIN = 60000;
// Reloj controlado: el parser usa Date.now()
function clock(t0 = 1_800_000_000_000) { let t = t0; Date.now = () => t; return { add: (ms) => { t += ms; }, now: () => t }; }

// Parrilla de prueba: cada `grid|<clave>` de parse() llama a setGrid con GRIDS[clave]
function makeParser(AP, grids, extra = {}) {
  const ev = { newSession: 0, laps: [], pits: [] };
  let p;
  p = AP.createParser({
    onGrid: (key) => p.setGrid(grids[key]),
    onNewSession: () => { ev.newSession++; },
    onLap: (d, n, team, ms) => ev.laps.push([d, ms]),
    onPit: (d, type, sc, ts, dur) => ev.pits.push([d, type]),
    ...extra,
  });
  return { p, ev };
}
const COLS = { colMap: { sta: 'c1', no: 'c2', dr: 'c3', llp: 'c4', gap: 'c5' }, colByNum: { c1: 'sta', c2: 'no', c3: 'dr', c4: 'llp', c5: 'gap' } };
const grid = (rows) => ({ ...COLS, karts: rows.map(([rowId, dorsal, extra]) => ({ rowId, dorsal, name: 'EQ' + dorsal, ...(extra || {}) })) });
const BASE = grid([['r1', '1'], ['r2', '2'], ['r3', '3'], ['r4', '4'], ['r5', '5']]);
const laps = (p, C, n) => { for (let i = 0; i < n; i++) { C.add(65000); for (let r = 1; r <= 5; r++) p.parse(`r${r}c4|tn|1:05.${String(100 + i).slice(-3)}`); } };
const hist = (p, d) => p.getState().equipos.find((e) => e.dorsal === d).lapHistory.length;

console.log('\n▸ PARSER-1: reconexión tras >10 min sin vueltas\n');

test('misma parrilla y mismo modo → NO es sesión nueva y conserva las vueltas', (AP) => {
  const C = clock(); const { p, ev } = makeParser(AP, { a: BASE });
  p.parse('init|r|\ngrid|a'); laps(p, C, 10);
  C.add(11 * MIN);                       // bandera roja larga / feed caído
  p.parse('init|r|\ngrid|a');            // Apex reenvía init+grid al reconectar
  strictEqual(ev.newSession, 0);
  strictEqual(hist(p, '1'), 10);
});

test('tras >10 min, cambio de modo (entreno → carrera) con los mismos inscritos → sesión nueva', (AP) => {
  const C = clock(); const { p, ev } = makeParser(AP, { a: BASE });
  p.parse('init|p|\ngrid|a'); laps(p, C, 5);
  C.add(11 * MIN);
  p.parse('init|r|\ngrid|a');
  strictEqual(ev.newSession, 1);
  strictEqual(hist(p, '1'), 0);
});

test('a los 9 min no pasa nada (sin cambios)', (AP) => {
  const C = clock(); const { p, ev } = makeParser(AP, { a: BASE });
  p.parse('init|r|\ngrid|a'); laps(p, C, 5);
  C.add(9 * MIN);
  p.parse('init|r|\ngrid|a');
  strictEqual(ev.newSession, 0);
});

test('bandera a cuadros + parrilla → sesión nueva (sin cambios)', (AP) => {
  const C = clock(); const { p, ev } = makeParser(AP, { a: BASE });
  p.parse('init|r|\ngrid|a'); laps(p, C, 3);
  p.parse('light|lf|');
  C.add(MIN);
  p.parse('init|r|\ngrid|a');
  strictEqual(ev.newSession, 1);
});

console.log('\n▸ PARSER-2: título tardío sin vueltas\n');

test('título nuevo a +180 s del grid sin ninguna vuelta → no borra la parrilla', (AP) => {
  const C = clock(); const { p, ev } = makeParser(AP, { a: BASE });
  p.parse('init|r|\ntitle1||ENTRENOS\ngrid|a');
  C.add(180000);
  p.parse('title1||7H Los Santos');
  strictEqual(ev.newSession, 0);
  deepStrictEqual(p.getState().equipos.map((e) => e.dorsal).sort(), ['1', '2', '3', '4', '5']);
  strictEqual(p.getState().title1, '7H Los Santos');
});

test('con vueltas y >60 s sin rodar, un título nuevo sí abre sesión (sin cambios)', (AP) => {
  const C = clock(); const { p, ev } = makeParser(AP, { a: BASE });
  p.parse('init|r|\ntitle1||CARRERA 1\ngrid|a');
  C.add(3 * MIN); laps(p, C, 3);
  C.add(2 * MIN);
  p.parse('title1||CARRERA 2');
  strictEqual(ev.newSession, 1);
});

console.log('\n▸ LOGGER-4: mismos dorsales, rowIds nuevos\n');

test('tanda siguiente con rowIds nuevos y los mismos dorsales → sesión nueva, sin duplicados', (AP) => {
  const C = clock();
  const next = grid([['r11', '1'], ['r12', '2'], ['r13', '3'], ['r14', '4'], ['r15', '5']]);
  const { p, ev } = makeParser(AP, { a: BASE, b: next });
  p.parse('init|r|\ngrid|a'); laps(p, C, 5);
  C.add(150000);
  p.parse('init|r|\ngrid|b');
  strictEqual(ev.newSession, 1);
  const ds = p.getState().equipos.map((e) => e.dorsal);
  strictEqual(ds.length, new Set(ds).size, 'dorsales duplicados: ' + ds.join(','));
});

test('re-grid a mitad de carrera con los mismos rowIds → no es sesión nueva', (AP) => {
  const C = clock(); const { p, ev } = makeParser(AP, { a: BASE });
  p.parse('init|r|\ngrid|a'); laps(p, C, 5);
  C.add(30000);
  p.parse('grid|a');
  strictEqual(ev.newSession, 0);
  strictEqual(hist(p, '1'), 5);
});

console.log('\n▸ PARSER-4: sd tras la salida de boxes\n');

test('si → so → sd: el kart deja de estar en boxes con el sd', (AP) => {
  clock(); const { p } = makeParser(AP, { a: BASE });
  p.parse('init|r|\ngrid|a');
  p.parse('r1c1|si|'); p.parse('r1c1|so|'); p.parse('r1c1|sd|');
  const e = p.getState().equipos.find((x) => x.dorsal === '1');
  strictEqual(e.pit, false); strictEqual(e.pitState, null);
});

console.log('\n▸ PARSER-3: kart ya en boxes al llegar la parrilla\n');

test('parrilla con estado si → el kart aparece en boxes (sin evento in inventado)', (AP) => {
  clock();
  const g = grid([['r1', '1', { state: 'si' }], ['r2', '2'], ['r3', '3'], ['r4', '4'], ['r5', '5']]);
  const { p, ev } = makeParser(AP, { a: g });
  p.parse('init|r|\ngrid|a');
  const e = p.getState().equipos.find((x) => x.dorsal === '1');
  strictEqual(e.pit, true); strictEqual(e.pitState, 'in');
  strictEqual(ev.pits.length, 0);
  p.parse('r1c1|so|');
  deepStrictEqual(ev.pits, [['1', 'out']]);
});

test('isStateCode: reconoce los códigos de estado y rechaza la marca de grupo', (AP) => {
  ok(AP.isStateCode('si') && AP.isStateCode('sr'));
  ok(!AP.isStateCode('in') && !AP.isStateCode('sl') && !AP.isStateCode(''));
});

console.log('\n▸ LOGGER-1: la misma vuelta reenviada (recoloreo / corrección)\n');

test('ti y luego tb con el mismo tiempo → una sola vuelta', (AP) => {
  const C = clock(); const { p, ev } = makeParser(AP, { a: BASE });
  p.parse('init|r|\ngrid|a');
  p.parse('r1c4|tn|1:08.500'); C.add(68769);
  p.parse('r1c4|ti|1:08.769'); C.add(200);
  p.parse('r1c4|tb|1:08.769');
  strictEqual(ev.laps.filter((l) => l[0] === '1').length, 2);
  strictEqual(hist(p, '1'), 2);
  strictEqual(p.getState().equipos.find((e) => e.dorsal === '1').lastLapKind, 'purple');
});

test('corrección del tiempo a 200 ms → reemplaza la última vuelta, no añade otra', (AP) => {
  const C = clock(); const { p, ev } = makeParser(AP, { a: BASE });
  p.parse('init|r|\ngrid|a');
  p.parse('r1c4|tn|1:07.906'); C.add(201);
  p.parse('r1c4|tn|1:07.816');
  const e = p.getState().equipos.find((x) => x.dorsal === '1');
  deepStrictEqual(e.lapHistory, [67.816]);
  strictEqual(e.lastLap, 67.816); strictEqual(e.bestLap, 67.816);
  strictEqual(ev.laps.length, 1);
});

test('vuelta de parada (3:18) justo tras una vuelta normal → no la sustituye (rkc)', (AP) => {
  const C = clock(); const { p, ev } = makeParser(AP, { a: BASE });
  p.parse('init|r|\ngrid|a');
  p.parse('r1c4|tn|1:09.718'); C.add(1412);
  p.parse('r1c4|tn|3:18.831');
  ok(p.getState().equipos.find((e) => e.dorsal === '1').lapHistory.includes(69.718));
});

test('dos vueltas reales con el mismo tiempo (~68 s entre ellas) → dos vueltas', (AP) => {
  const C = clock(); const { p, ev } = makeParser(AP, { a: BASE });
  p.parse('init|r|\ngrid|a');
  p.parse('r1c4|tn|1:08.000'); C.add(68000);
  p.parse('r1c4|tn|1:08.000');
  strictEqual(hist(p, '1'), 2); strictEqual(ev.laps.length, 2);
});

test('feed a ráfagas (rkc): dos pases distintos a 609 ms son dos vueltas reales', (AP) => {
  // Caso real (rkc, dorsal 22): el circuito entrega con retraso pases acumulados.
  // El llp llega en el mismo lote que su |*| y ANTES que él.
  const C = clock(); const { p, ev } = makeParser(AP, { a: BASE });
  p.parse('init|r|\ngrid|a');
  p.parse('r1c4|tn|1:07.799\nr1|*|67313|24234');
  C.add(609);
  p.parse('r1c4|tn|1:08.266\nr1|*|67558|24271');
  strictEqual(ev.laps.filter((l) => l[0] === '1').length, 2);
  strictEqual(hist(p, '1'), 2);
});

test('pase por meta reenviado con el mismo tiempo + llp reenviado → sigue siendo una vuelta', (AP) => {
  const C = clock(); const { p, ev } = makeParser(AP, { a: BASE });
  p.parse('init|r|\ngrid|a');
  p.parse('r1c4|tn|1:07.730\nr1|*|67674|24463');
  C.add(600);
  p.parse('r1c4|ti|1:07.730\nr1|*|67674|24463');
  strictEqual(ev.laps.length, 1);
});

console.log('\n▸ PARSER-10: la vuelta de salida de boxes va marcada\n');

function lapEvents(AP) {
  const ev = [];
  let p;
  p = AP.createParser({
    onGrid: () => p.setGrid(BASE),
    onLap: (d, n, team, ms, lapN, ts, category, isPitLap) => ev.push({ d, ms, isPitLap }),
  });
  return { p, ev };
}

test('la primera vuelta tras el so llega con isPitLap=true; la siguiente no', (AP) => {
  const C = clock(); const { p, ev } = lapEvents(AP);
  p.parse('init|r|\ngrid|a');
  p.parse('r1c4|tn|1:05.000'); C.add(40000);
  p.parse('r1c1|si|'); C.add(180000);
  p.parse('r1c1|so|'); p.parse('r1c1|sr|'); C.add(30000);
  p.parse('r1c4|tn|4:03.946'); C.add(65000);
  p.parse('r1c4|tn|1:05.100');
  deepStrictEqual(ev.map((e) => [e.ms, !!e.isPitLap]), [[65000, false], [243946, true], [65100, false]]);
});

test('feed donde la vuelta tras la salida es normal (Le Mans) → no se marca', (AP) => {
  const C = clock(); const { p, ev } = lapEvents(AP);
  p.parse('init|r|\ngrid|a');
  for (let i = 0; i < 4; i++) { p.parse('r1c4|tn|1:07.' + (100 + i)); C.add(67000); }
  p.parse('r1c1|si|'); C.add(120000); p.parse('r1c1|so|'); p.parse('r1c1|sr|'); C.add(30000);
  p.parse('r1c4|tn|1:07.500');
  strictEqual(ev[ev.length - 1].ms, 67500, 'la vuelta se registra');
  strictEqual(ev[ev.length - 1].isPitLap, false);
});

test('sin parada, ninguna vuelta va marcada', (AP) => {
  const C = clock(); const { p, ev } = lapEvents(AP);
  p.parse('init|r|\ngrid|a');
  p.parse('r1c4|tn|1:05.000'); C.add(65000); p.parse('r1c4|tn|1:05.100');
  ok(ev.every((e) => !e.isPitLap));
});

console.log('\n▸ PARSER-9: gap del líder "Vuelta N"\n');

test('"Vuelta N" en el gap es el contador del líder, no N vueltas de retraso', (AP) => {
  clock(); const { p } = makeParser(AP, { a: BASE });
  p.parse('init|r|\ngrid|a');
  const g = (v) => { p.parse(`r1c5|in|${v}`); return p.getState().equipos.find((e) => e.dorsal === '1').gap; };
  strictEqual(g('Vuelta 105'), '');
  strictEqual(g('Lap 12'), '');
  strictEqual(g('Tour 5'), '');
  strictEqual(g('2 Vueltas'), '+2v');
  strictEqual(g('1 Lap'), '+1v');
  strictEqual(g('3 tours'), '+3v');
  strictEqual(g('12.345'), '+12.345');
});

console.log('\n▸ PARSER-11: paridad del estado\n');

test('getState expone lapFlashAt (destello de vuelta sin reiniciarse)', (AP) => {
  const C = clock(); const { p } = makeParser(AP, { a: BASE });
  p.parse('init|r|\ngrid|a');
  p.parse('r1|*|65000|');
  strictEqual(p.getState().equipos.find((e) => e.dorsal === '1').lapFlashAt, C.now());
});

console.log('\n▸ SECURITY-7: dorsal validado en el parser\n');

test('celda no con HTML/JS → solo el dorsal real', (AP) => {
  clock(); const { p } = makeParser(AP, { a: BASE });
  p.parse('init|r|\ngrid|a');
  p.parse('r9c2||7<img src=x onerror=alert(1)>');
  p.parse("r8c2||12');alert(1);//");
  const ds = p.getState().equipos.map((e) => e.dorsal);
  ok(ds.includes('7') && ds.includes('12'), ds.join(','));
  ok(ds.every((d) => /^[0-9A-Za-z_-]+$/.test(d)), ds.join(','));
});

test('dorsal de la parrilla con HTML → solo el dorsal real', (AP) => {
  clock();
  const { p } = makeParser(AP, { a: grid([['r1', '7"><b>'], ['r2', '2'], ['r3', '3']]) });
  p.parse('init|r|\ngrid|a');
  ok(p.getState().equipos.some((e) => e.dorsal === '7'));
});

console.log(`\n${passed} pasan, ${failed} fallan\n`);
process.exit(failed ? 1 : 0);
