// StintPro — tests del modelo de la pestaña Estrategia (en-box-model.js)
// Ejecutar: node tests/box-model.test.js
'use strict';

const { strictEqual, ok } = require('assert');
const M = require('../src/en-box-model');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

const MIN = 60 * 1000;

// ── #1 Recomendación táctica sin datos de box ─────────────────────────────
console.log('\n▸ Recomendación táctica\n');

const baseTactic = {
  canPit: true, stintMinLeft: 0, myQuality: 'bad', strategic: 1, totalStops: 5,
  stintPct: 50, raceRemMin: 120, stintMaxMin: 40, probAcceso: 30,
  bestFutureProb: 30, bestFutureMin: '', worstFutureProb: 30, worstFutureMin: '',
};

test('kart malo + pool 30% + paradas libres → oportunidad de caza', () => {
  const a = M.tacticalAdvice(baseTactic);
  ok(a.html.includes('Oportunidad de caza'), a.html);
});

test('sin datos de box (probAcceso null) nunca muestra un porcentaje negativo', () => {
  const a = M.tacticalAdvice({ ...baseTactic, probAcceso: null, bestFutureProb: 0, worstFutureProb: 0 });
  ok(!a.html.includes('-1'), a.html);
  ok(!/\d+%/.test(a.html), 'no debe citar % de pool: ' + a.html);
  ok(/sin datos de box/i.test(a.html), a.html);
});

test('sin datos de box: no recomienda caza ni espera basada en el pool', () => {
  const a = M.tacticalAdvice({ ...baseTactic, probAcceso: null, bestFutureProb: 0, worstFutureProb: 0 });
  ok(!a.html.includes('caza') && !a.html.includes('Espera'), a.html);
});

test('sin datos de box con kart bueno → sigue diciendo apurar el stint', () => {
  const a = M.tacticalAdvice({ ...baseTactic, myQuality: 'good', probAcceso: null, bestFutureProb: 0, worstFutureProb: 0 });
  ok(a.html.includes('Apura stint'), a.html);
});

test('stint mínimo sin cumplir manda sobre todo lo demás', () => {
  const a = M.tacticalAdvice({ ...baseTactic, canPit: false, stintMinLeft: 7 });
  ok(a.html.includes('faltan 7 min'), a.html);
});

test('los colores de la recomendación son tokens de estado o los acentos no-estado conocidos', () => {
  const PERMITIDOS = ['var(--state-ok)', 'var(--state-warn)', 'var(--state-alert)', '#c084fc', '#60a5fa', '#9ca3af'];
  const casos = [];
  for (const myQuality of ['good', 'neutral', 'bad', null])
    for (const probAcceso of [null, 0, 20, 30, 45, 80])
      for (const canPit of [true, false])
        for (const strategic of [0, 1])
          casos.push({ ...baseTactic, myQuality, probAcceso, canPit, strategic, bestFutureProb: 50, worstFutureProb: 0 });
  for (const c of casos) {
    const a = M.tacticalAdvice(c);
    ok(PERMITIDOS.includes(a.color), `color no permitido ${a.color} para ${JSON.stringify(c)}`);
  }
});

test('el pie de la tarjeta dice "sin datos" en vez de -1%', () => {
  strictEqual(M.poolLabel(null), 'sin datos');
  strictEqual(M.poolLabel(45), '45%');
});

// ── #2 Inicio del stint de los rivales ────────────────────────────────────
console.log('\n▸ Inicio del stint de los rivales\n');

test('ancla de carrera: la salida oficial (com|) manda', () => {
  const now = 10 * 3600 * 1000;
  strictEqual(M.raceAnchor(null, { at: now - 30 * MIN }, 0, now), now - 30 * MIN);
});

test('ancla de carrera: sin com| pero con reloj y duración → now − transcurrido', () => {
  const now = 10 * 3600 * 1000;
  const clock = { synced: true, countUp: false, remainingMs: 150 * MIN };
  strictEqual(M.raceAnchor(clock, null, 180 * MIN, now), now - 30 * MIN);
});

test('ancla de carrera: reloj ascendente o sin duración → desconocida', () => {
  const now = 10 * 3600 * 1000;
  strictEqual(M.raceAnchor({ synced: true, countUp: true, remainingMs: 5 * MIN }, null, 180 * MIN, now), null);
  strictEqual(M.raceAnchor({ synced: true, countUp: false, remainingMs: 150 * MIN }, null, 0, now), null);
});

test('ancla de carrera: reloj mayor que la duración (mal configurada) → desconocida', () => {
  const now = 10 * 3600 * 1000;
  strictEqual(M.raceAnchor({ synced: true, countUp: false, remainingMs: 200 * MIN }, null, 180 * MIN, now), null);
});

test('rival en su 1er stint (0 paradas, nunca visto en pit) → arranca en la salida de la carrera', () => {
  strictEqual(M.rivalStintStart(undefined, 0, 1000), 1000);
});

test('rival con salida de pit observada → esa salida', () => {
  strictEqual(M.rivalStintStart(5000, 3, 1000), 5000);
});

test('rival con paradas previas a conectar y salida no observada → desconocido (no inventa)', () => {
  strictEqual(M.rivalStintStart(undefined, 2, 1000), null);
});

test('rival en pit (null) → sin stint en curso', () => {
  strictEqual(M.rivalStintStart(null, 0, 1000), null);
});

test('seguimiento: un kart en pista nunca visto en pit NO recibe "now" como salida', () => {
  const map = {};
  M.trackRivalPitOut(map, { dorsal: '7', pit: false, pitState: null }, 9000);
  strictEqual(map['7'], undefined);
});

test('seguimiento: pit in → null; al volver a pista (aunque Apex salte el out) → now', () => {
  const map = {};
  M.trackRivalPitOut(map, { dorsal: '7', pit: true, pitState: 'in' }, 1000);
  strictEqual(map['7'], null);
  M.trackRivalPitOut(map, { dorsal: '7', pit: false, pitState: null }, 5000);
  strictEqual(map['7'], 5000);
  M.trackRivalPitOut(map, { dorsal: '7', pit: false, pitState: null }, 9000);
  strictEqual(map['7'], 5000, 'no se reescribe en cada tick');
});

test('seguimiento: estado out explícito → now', () => {
  const map = {};
  M.trackRivalPitOut(map, { dorsal: '7', pit: true, pitState: 'out' }, 3000);
  strictEqual(map['7'], 3000);
});

// ── #5 Mi kart no es un rival ─────────────────────────────────────────────
console.log('\n▸ Mi kart fuera de las listas de rivales\n');

test('isMine compara dorsales como texto', () => {
  ok(M.isMine({ dorsal: 7 }, '7'));
  ok(M.isMine({ dorsal: '7' }, ' 7 '));
  ok(!M.isMine({ dorsal: '17' }, '7'));
  ok(!M.isMine({ dorsal: '7' }, ''));
  ok(!M.isMine({ dorsal: '7' }, undefined));
});

// ── #6/#9 Cola con pesos: salida por tipo de box ─────────────────────────
console.log('\n▸ Cola del box — salida de un equipo\n');

const K = (quality, dorsal) => ({ quality, dorsal: dorsal || '?' });
const W = (q) => q.map(k => +M.weight(k).toFixed(3));
const approx = (a, b, msg) => ok(Math.abs(a - b) < 1e-6, `${msg || ''} esperado ${b}, obtenido ${a}`);

test('línea: sale exactamente el primero', () => {
  const q = M.applyPitOut([K('good', '1'), K('bad', '2'), K('neutral', '3')], 'line', 2);
  strictEqual(q.map(k => k.dorsal).join(','), '2,3');
});

test('batería (sorteo entre TODOS): cada kart pierde 1/N de su peso', () => {
  const q = M.applyPitOut([K('good'), K('bad'), K('bad'), K('neutral')], 'battery', 2);
  strictEqual(q.length, 4);
  W(q).forEach(w => approx(w, 0.75));
});

test('batería: el peso total baja exactamente en 1', () => {
  const q = M.applyPitOut([K('good'), K('bad'), K('neutral')], 'battery', 2);
  approx(q.reduce((a, k) => a + M.weight(k), 0), 2);
});

test('columnas (sorteo en fila 1): solo la fila 1 pierde peso', () => {
  const q = M.applyPitOut([K('good'), K('bad'), K('neutral'), K('good')], 'columns', 2);
  const w = W(q);
  approx(w[0], 0.5); approx(w[1], 0.5); approx(w[2], 1); approx(w[3], 1);
});

test('columnas: tras una salida, la fila 1 es la primera unidad de peso acumulado', () => {
  let q = [K('good', 'a'), K('bad', 'b'), K('neutral', 'c'), K('good', 'd')];
  q = M.applyPitOut(q, 'columns', 2); // a:.5 b:.5 c:1 d:1 → zona = a,b + c
  const z = M.accessibleZone(q, 'columns', 2);
  approx(z.reduce((a, x) => a + x.share, 0), 2, 'zona = 2 karts');
  approx(z.find(x => x.k.dorsal === 'c').share, 1);
  ok(!z.find(x => x.k.dorsal === 'd'), 'd sigue bloqueado');
});

test('los karts con peso residual (<5%) se podan', () => {
  let q = [K('good'), K('bad')];
  q = M.applyPitOut(q, 'battery', 2); // .5 .5
  q = M.applyPitOut(q, 'battery', 2); // 0 0
  strictEqual(q.length, 0);
});

test('salida con la cola vacía no rompe', () => {
  strictEqual(M.applyPitOut([], 'battery', 2).length, 0);
});

test('applyPitOut no muta la cola original', () => {
  const orig = [K('good'), K('bad')];
  M.applyPitOut(orig, 'battery', 2);
  strictEqual(orig[0].w, undefined);
});

// ── #7 Una sola métrica: probabilidad de acceso ──────────────────────────
console.log('\n▸ Probabilidad de acceso (misma métrica en todos los bloques)\n');

test('línea: primero bueno → 100, primero neutro → 0 (neutro no es bueno)', () => {
  strictEqual(M.accessProb([K('good'), K('bad')], 'line', 2).prob, 100);
  strictEqual(M.accessProb([K('neutral'), K('good')], 'line', 2).prob, 0);
});

test('línea: primero desconocido → sin datos (null), no 50 inventado', () => {
  strictEqual(M.accessProb([K('unknown'), K('good')], 'line', 2).prob, null);
});

test('batería: % de buenos entre TODA la cola (sin puestos ni espera)', () => {
  strictEqual(M.accessProb([K('good'), K('bad'), K('bad'), K('good'), K('good'), K('bad')], 'battery', 2).prob, 50);
});

test('columnas: % de buenos en la fila 1', () => {
  strictEqual(M.accessProb([K('good'), K('bad'), K('good'), K('good')], 'columns', 2).prob, 50);
});

test('los desconocidos no cuentan como malos: se estima sobre los conocidos y se marca parcial', () => {
  const r = M.accessProb([K('good'), K('unknown'), K('unknown'), K('bad')], 'battery', 2);
  strictEqual(r.prob, 50);
  approx(r.knownShare, 0.5);
});

test('cola toda desconocida o vacía → null', () => {
  strictEqual(M.accessProb([K('unknown'), K('unknown')], 'battery', 2).prob, null);
  strictEqual(M.accessProb([], 'battery', 2).prob, null);
});

test('los pesos cuentan: kart bueno medio-sacado pesa la mitad', () => {
  const r = M.accessProb([{ ...K('good'), w: 0.5 }, K('bad')], 'battery', 2);
  strictEqual(r.prob, 33);
});

// ── #3/#7/#8 Previsión de box ─────────────────────────────────────────────
console.log('\n▸ Previsión de box\n');

test('previsión: "Ahora" coincide con la probabilidad de acceso de arriba', () => {
  const q = [K('good'), K('bad'), K('bad'), K('bad')];
  const f = M.forecast(q, 'line', 2, []);
  strictEqual(f.now, M.accessProb(q, 'line', 2).prob);
});

test('batería: un rival con kart NEUTRO que para baja la probabilidad (se puede llevar un bueno)', () => {
  const q = [K('good'), K('good'), K('bad'), K('bad')]; // 50%
  const f = M.forecast(q, 'battery', 2, [{ quality: 'neutral', minLeft: 3 }]);
  ok(f.steps[0].prob < 50, `esperado <50, obtenido ${f.steps[0].prob}`);
});

test('batería: rival con kart bueno sube, con kart malo baja', () => {
  const q = [K('good'), K('bad')];
  ok(M.forecast(q, 'battery', 2, [{ quality: 'good', minLeft: 1 }]).steps[0].prob > 50);
  ok(M.forecast(q, 'battery', 2, [{ quality: 'bad', minLeft: 1 }]).steps[0].prob < 50);
});

test('línea: la previsión dice qué kart quedaría primero tras cada parada rival', () => {
  const q = [K('bad'), K('good'), K('bad')];
  const f = M.forecast(q, 'line', 2, [{ quality: 'neutral', minLeft: 2 }, { quality: 'good', minLeft: 5 }]);
  strictEqual(f.now, 0);
  strictEqual(f.steps[0].prob, 100, 'tras la 1ª parada el primero es el bueno');
  strictEqual(f.steps[1].prob, 0, 'tras la 2ª, el malo');
});

test('previsión no muta la cola real', () => {
  const q = [K('good'), K('bad')];
  M.forecast(q, 'battery', 2, [{ quality: 'bad', minLeft: 1 }]);
  strictEqual(q.length, 2); strictEqual(q[0].w, undefined);
});

// ── #4 Paradas obligadas por el stint máximo ─────────────────────────────
console.log('\n▸ Paradas necesarias\n');

test('60 min restantes, stint máx 40, recién salido → 1 parada (no 2)', () => {
  strictEqual(M.stopsNeeded(60 * MIN, 40 * MIN, 0, 0), 1);
});

test('descuenta lo que ya llevas de stint: 30 min restantes, 35 de 40 hechos → 1 parada', () => {
  strictEqual(M.stopsNeeded(30 * MIN, 40 * MIN, 35 * MIN, 0), 1);
});

test('si el stint actual llega a meta → 0 paradas', () => {
  strictEqual(M.stopsNeeded(30 * MIN, 40 * MIN, 5 * MIN, 0), 0);
});

test('la parada consume reloj: 81 min, máx 40, parada 2 → 2 paradas', () => {
  // stint actual 40 → quedan 41; una parada (2) + stint (40) = 42 ≥ 41 → 1… con
  // elapsed 0: 81−40 = 41 → ceil(41/42) = 1
  strictEqual(M.stopsNeeded(81 * MIN, 40 * MIN, 0, 2 * MIN), 1);
  strictEqual(M.stopsNeeded(125 * MIN, 40 * MIN, 0, 2 * MIN), 3);
});

test('sin stint máximo o sin reloj → null (no se puede calcular)', () => {
  strictEqual(M.stopsNeeded(60 * MIN, 0, 0, 0), null);
  strictEqual(M.stopsNeeded(0, 40 * MIN, 0, 0), null);
});

console.log(`\n${passed} pasan, ${failed} fallan\n`);
process.exit(failed ? 1 : 0);
