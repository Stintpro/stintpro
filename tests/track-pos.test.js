// StintPro — tests del motor del mapa de pista (en-track-pos.js).
// Ejecutar: node tests/track-pos.test.js
'use strict';

const { ok, strictEqual, deepStrictEqual } = require('assert');
const P = require('../src/en-track-pos');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}
const near = (a, b, eps = 1e-6) => ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const nearPt = (p, q, eps = 1e-6) => { near(p[0], q[0], eps); near(p[1], q[1], eps); };

// Cuadrado de 100 de lado, 8 puntos a distancia uniforme (esquinas y puntos medios),
// con un perfil de tiempo NO lineal (lento en el lado de arriba).
const SQ = {
  version: 1, slug: 'sq', name: 'Cuadrado', lengthM: 400,
  viewBox: { w: 200, h: 200 }, widthUnits: 10,
  points: [[50, 50], [100, 50], [150, 50], [150, 100], [150, 150], [100, 150], [50, 150], [50, 100]],
  pitLane: { inFrac: 0.8, outFrac: 0.05 },
  profiles: { normal: { timeFrac: [0, 0.05, 0.10, 0.30, 0.50, 0.55, 0.60, 0.80], source: 'test' }, inverso: null },
};

console.log('\ntrazado y geometría');

test('óvalo: 120 puntos, perfil lineal, genérico', () => {
  const o = P.ovalTrack();
  strictEqual(o.points.length, 120);
  strictEqual(o.timeFrac.length, 120);
  near(o.timeFrac[30], 0.25);
  strictEqual(o.generic, true);
  strictEqual(o.pitLane, null);
});

test('pointAt: 0 es la meta, 0,25 es el punto 30 y se envuelve', () => {
  const o = P.ovalTrack();
  nearPt(P.pointAt(o, 0), o.points[0]);
  nearPt(P.pointAt(o, 0.25), o.points[30]);
  nearPt(P.pointAt(o, 1.25), P.pointAt(o, 0.25));
});

test('loadTrack: fichero válido → trazado real, perfil propio', () => {
  const t = P.loadTrack(SQ, 'normal');
  ok(t);
  strictEqual(t.generic, false);
  strictEqual(t.approxProfile, false);
  deepStrictEqual(t.timeFrac, SQ.profiles.normal.timeFrac);
  deepStrictEqual(t.pitLane, { inFrac: 0.8, outFrac: 0.05 });
});

test('pointAt interpola en TIEMPO: 0,075 cae a mitad del tramo 1→2', () => {
  const t = P.loadTrack(SQ, 'normal');
  nearPt(P.pointAt(t, 0.075), [125, 50]);
  nearPt(P.pointAt(t, 0.40), [150, 125]); // tramo lento 3→4: 0,30→0,50
});

test('distToTime y pointAtDist', () => {
  const t = P.loadTrack(SQ, 'normal');
  near(P.distToTime(t, 0.25), 0.10);
  near(P.distToTime(t, 0.3125), 0.20);
  nearPt(P.pointAtDist(t, 0.0625), [75, 50]);
});

test('timeToDist es la inversa de distToTime (también al dar la vuelta)', () => {
  const t = P.loadTrack(SQ, 'normal');
  near(P.timeToDist(t, 0.10), 0.25);
  near(P.timeToDist(t, 0.20), 0.3125);
  [0, 0.07, 0.33, 0.61, 0.999].forEach(d => near(P.timeToDist(t, P.distToTime(t, d)), d));
  near(P.timeToDist(t, 1.10), 0.25);
});

test('trackLengthUnits: perímetro cerrado del trazado en unidades del SVG', () => {
  const t = P.loadTrack(SQ, 'normal');
  near(P.trackLengthUnits(t), 400);
});

test('loadTrack rechaza ficheros inválidos', () => {
  strictEqual(P.loadTrack(null, 'normal'), null);
  strictEqual(P.loadTrack({ ...SQ, version: 2 }, 'normal'), null);
  strictEqual(P.loadTrack({ ...SQ, points: SQ.points.slice(0, 5) }, 'normal'), null);
  strictEqual(P.loadTrack({ ...SQ, profiles: { normal: { timeFrac: [0, 0.2, 0.1, 0.3, 0.5, 0.55, 0.6, 0.8] } } }, 'normal'), null);
  strictEqual(P.loadTrack({ ...SQ, profiles: { normal: { timeFrac: [0, 0.1] } } }, 'normal'), null);
});

test('mirrorProfile invierte el orden de los tramos', () => {
  const m = P.mirrorProfile([0, 0.1, 0.3, 0.6]);
  [0, 0.4, 0.7, 0.9].forEach((v, i) => near(m[i], v));
});

test('inverso sin perfil propio: trazado al revés, perfil espejado, aproximado', () => {
  const t = P.loadTrack(SQ, 'inverso');
  ok(t);
  deepStrictEqual(t.points[0], SQ.points[0]);
  deepStrictEqual(t.points[1], SQ.points[7]);
  strictEqual(t.approxProfile, true);
  deepStrictEqual(t.timeFrac, P.mirrorProfile(SQ.profiles.normal.timeFrac));
  near(t.pitLane.inFrac, 0.95);
  near(t.pitLane.outFrac, 0.2);
});

test('sin ningún perfil: lineal y aproximado', () => {
  const t = P.loadTrack({ ...SQ, profiles: {} }, 'normal');
  ok(t);
  strictEqual(t.approxProfile, true);
  near(t.timeFrac[4], 0.5);
});

test('pit lane: 40 puntos, por FUERA de la pista; sin pitLane → null', () => {
  const o = { ...P.ovalTrack(), pitLane: { inFrac: 0.92, outFrac: 0.06 } };
  const pl = P.pitLanePolyline(o, 20);
  strictEqual(pl.length, 40);
  const c = [500, 330];
  const mid = pl[20];
  const span = (1 - o.pitLane.inFrac) + o.pitLane.outFrac;
  const onTrack = P.pointAtDist(o, o.pitLane.inFrac + span * 20 / 39);
  ok(Math.hypot(mid[0] - c[0], mid[1] - c[1]) > Math.hypot(onTrack[0] - c[0], onTrack[1] - c[1]));
  strictEqual(P.pitLanePolyline({ ...o, pitLane: null }, 20), null);
});

test('pitSlot reparte los karts a lo largo del pit lane', () => {
  const o = { ...P.ovalTrack(), pitLane: { inFrac: 0.92, outFrac: 0.06 } };
  const pl = P.pitLanePolyline(o, 20);
  const a = P.pitSlot(o, 0, 2, 20), b = P.pitSlot(o, 1, 2, 20);
  ok(pl.some(p => p[0] === a[0] && p[1] === a[1]));
  ok(a[0] !== b[0] || a[1] !== b[1]);
  strictEqual(P.pitSlot({ ...o, pitLane: null }, 0, 1, 20), null);
});

console.log('\nritmo y posición en pista');

const S = 1000;
const kart = (d, lastLapAt, extra = {}) => ({
  dorsal: d, teamName: 'Equipo ' + d, lastLap: 60, lastLapAt,
  lapHistory: [60, 60, 60, 60, 60], pit: false, pitS: 0, ...extra,
});

test('refLapMs: mediana de las 5 últimas limpias, sin vueltas de box', () => {
  strictEqual(P.refLapMs([60.1, 60.3, 59.9, 60.0, 60.2]), 60100);
  strictEqual(P.refLapMs([60.1, 60.3, 150, 59.9, 60.0, 60.2]), 60100);
  strictEqual(P.refLapMs([70, 70, 70, 60, 60, 60, 60, 60]), 60000);
  strictEqual(P.refLapMs([]), null);
  strictEqual(P.refLapMs(undefined), null);
});

test('fracción = tiempo desde el pase / ritmo', () => {
  const e = P.createTrackPos();
  e.update([kart('7', 100 * S)], 100 * S);
  const p = e.positions(130 * S)[0];
  strictEqual(p.mode, 'track');
  near(p.t, 0.5);
  strictEqual(p.name, 'Equipo 7');
});

test('positions expone los dos últimos pases por meta (para la regla del churro)', () => {
  const e = P.createTrackPos();
  e.update([kart('7', 100 * S)], 100 * S);
  let p = e.positions(110 * S)[0];
  strictEqual(p.lastLapAt, 100 * S);
  strictEqual(p.prevLapAt, null);
  e.update([kart('7', 160 * S)], 160 * S);
  p = e.positions(165 * S)[0];
  strictEqual(p.lastLapAt, 160 * S);
  strictEqual(p.prevLapAt, 100 * S);
});

test('tope 0,98: si va lento espera en la meta, no da otra vuelta', () => {
  const e = P.createTrackPos();
  e.update([kart('7', 100 * S)], 100 * S);
  near(e.positions(165 * S)[0].t, P.CAP);
});

test('más de 3 vueltas de ritmo sin pase → sin datos', () => {
  const e = P.createTrackPos();
  e.update([kart('7', 100 * S)], 100 * S);
  strictEqual(e.positions(290 * S)[0].mode, 'stale');
});

test('sin historial propio usa el ritmo de la pista; sin nada → sin datos', () => {
  const e = P.createTrackPos();
  e.update([kart('7', 100 * S), kart('9', 100 * S, { lapHistory: [] })], 100 * S);
  near(e.positions(115 * S).find(p => p.dorsal === '9').t, 0.25);
  const solo = P.createTrackPos();
  solo.update([kart('9', 100 * S, { lapHistory: [] })], 100 * S);
  strictEqual(solo.positions(115 * S)[0].mode, 'stale');
});

test('al llegar el pase se desliza hasta la meta en 0,4 s, sin saltar', () => {
  const e = P.createTrackPos();
  e.update([kart('7', 100 * S)], 100 * S);
  const before = e.positions(158 * S)[0].t;            // 0,9667
  e.update([kart('7', 159 * S)], 159 * S);
  const mid = e.positions(159 * S + 200)[0].t;
  ok(mid > before && mid < 1, `mid ${mid}`);
  near(e.positions(159 * S + 500)[0].t, 500 / 60000);
});

test('un kart que desaparece del estado sale del mapa', () => {
  const e = P.createTrackPos();
  e.update([kart('7', 100 * S), kart('9', 100 * S)], 100 * S);
  e.update([kart('7', 100 * S)], 101 * S);
  deepStrictEqual(e.positions(102 * S).map(p => p.dorsal), ['7']);
});

test('info: nombre, ritmo y última vuelta en ms', () => {
  const e = P.createTrackPos();
  e.update([kart('7', 100 * S, { lastLap: 61.234 })], 100 * S);
  deepStrictEqual(e.info('7'), { dorsal: '7', name: 'Equipo 7', refMs: 60000, lastLapMs: 61234 });
  strictEqual(e.info('99'), null);
});

test('error en vivo: |vuelta real − ritmo previsto| en cada pase limpio', () => {
  const e = P.createTrackPos();
  let at = 100 * S;
  e.update([kart('7', at)], at);
  for (let i = 0; i < 5; i++) { at += 60300; e.update([kart('7', at)], at); }
  const st = e.errorStats();
  strictEqual(st.n, 5);
  near(st.medianS, 0.3, 1e-9);
  strictEqual(P.createTrackPos().errorStats().n, 0);
});

test('desfase de reloj: si el VPS va 3 s por detrás, se compensa', () => {
  const e = P.createTrackPos();
  let L = 0;
  for (let i = 0; i < 6; i++) { L = 100 * S + i * 60 * S; e.update([kart('7', L)], L + 3000); }
  near(e.clockSkewMs(), 3000, 1e-6);
  near(e.positions(L + 3000 + 30000)[0].t, 0.5, 1e-6);
});

test('pases viejos (historial al conectar) no cuentan para el desfase', () => {
  const e = P.createTrackPos();
  for (let i = 0; i < 6; i++) { const at = 100 * S + i * 60 * S; e.update([kart('7', at)], at + 120000); }
  strictEqual(e.clockSkewMs(), 0);
});

console.log('\nbox, salida y huecos');

test('en box: aparcado y con cuenta atrás que corre entre updates', () => {
  const e = P.createTrackPos();
  e.update([kart('7', 100 * S, { pit: true, pitS: 30 })], 200 * S, { pitDurationS: 120 });
  strictEqual(e.positions(200 * S)[0].mode, 'pit');
  const a = e.pitList(200 * S)[0];
  strictEqual(a.dorsal, '7');
  near(a.remainingS, 90);
  near(e.pitList(210 * S)[0].remainingS, 80);
  near(e.pitList(210 * S)[0].pitS, 40);
});

test('se pasa de la parada → remainingS negativo; orden por salida más próxima', () => {
  const e = P.createTrackPos();
  e.update([
    kart('7', 100 * S, { pit: true, pitS: 40 }),
    kart('9', 100 * S, { pit: true, pitS: 150 }),
    kart('3', 100 * S, { pit: true, pitS: 100 }),
  ], 200 * S, { pitDurationS: 120 });
  deepStrictEqual(e.pitList(200 * S).map(p => p.dorsal), ['9', '3', '7']);
  near(e.pitList(200 * S)[0].remainingS, -30);
});

test('vuelta de salida con offset de túnel: avanza de la salida a la meta', () => {
  const e = P.createTrackPos();
  const ctx = { pitDurationS: 120, tunnelOffsetS: 20, outTimeFrac: 0.5 };
  e.update([kart('7', 100 * S, { pit: true })], 300 * S, ctx);
  e.update([kart('7', 100 * S, { pit: false })], 400 * S, ctx);
  const p = e.positions(410 * S)[0];
  strictEqual(p.mode, 'outlap');
  near(p.t, 0.75);
  near(e.positions(440 * S)[0].t, 0.5 + 0.5 * P.CAP);
});

test('vuelta de salida sin offset: avanza a su ritmo', () => {
  const e = P.createTrackPos();
  const ctx = { pitDurationS: 120, tunnelOffsetS: null, outTimeFrac: 0.5 };
  e.update([kart('7', 100 * S, { pit: true })], 300 * S, ctx);
  e.update([kart('7', 100 * S, { pit: false })], 400 * S, ctx);
  near(e.positions(415 * S)[0].t, 0.75);
});

test('el primer pase tras salir cierra la vuelta de salida', () => {
  const e = P.createTrackPos();
  const ctx = { tunnelOffsetS: 20, outTimeFrac: 0.5 };
  e.update([kart('7', 100 * S, { pit: true })], 300 * S, ctx);
  e.update([kart('7', 100 * S)], 400 * S, ctx);
  e.update([kart('7', 420 * S)], 420 * S, ctx);
  strictEqual(e.positions(430 * S)[0].mode, 'track');
});

test('el primer pase tras salir cierra la vuelta aunque el reloj del VPS vaya por detrás', () => {
  const e = P.createTrackPos();
  const ctx = { tunnelOffsetS: 20, outTimeFrac: 0.5 };
  e.update([kart('7', 100 * S, { pit: true })], 300 * S, ctx);
  e.update([kart('7', 100 * S, { pit: false })], 400 * S, ctx);
  e.update([kart('7', 395 * S)], 420 * S, ctx);       // lastLapAt por detrás del outAt local
  strictEqual(e.positions(425 * S)[0].mode, 'track');
});

test('salida y pase en el mismo update cierran la vuelta de salida', () => {
  const e = P.createTrackPos();
  const ctx = { tunnelOffsetS: 20, outTimeFrac: 0.5 };
  e.update([kart('7', 100 * S, { pit: true })], 300 * S, ctx);
  e.update([kart('7', 399 * S, { pit: false })], 400 * S, ctx);
  strictEqual(e.positions(405 * S)[0].mode, 'track');
});

test('huecos en pista: delante y detrás, en segundos con mi ritmo', () => {
  const now = 1000 * S;
  const e = P.createTrackPos();
  e.update([
    kart('1', now - 30000),                         // yo, en 0,50
    kart('2', now - 33000),                         // 0,55 → delante a 3,0 s
    kart('3', now - 27000),                         // 0,45 → detrás a 3,0 s
    kart('4', now - 31000, { pit: true }),          // en box: no cuenta
  ], now);
  const g = e.gapsFor('1', now);
  strictEqual(g.ahead.dorsal, '2');
  near(g.ahead.gapS, 3.0, 1e-9);
  strictEqual(g.behind.dorsal, '3');
  near(g.behind.gapS, 3.0, 1e-9);
});

test('huecos que cruzan la meta', () => {
  const now = 1000 * S;
  const e = P.createTrackPos();
  e.update([kart('1', now - 57000), kart('2', now - 1200)], now); // yo 0,95 · él 0,02
  const g = e.gapsFor('1', now);
  strictEqual(g.ahead.dorsal, '2');
  near(g.ahead.gapS, 4.2, 1e-9);
});

test('sin mi kart o con mi kart en box → sin huecos', () => {
  const now = 1000 * S;
  const e = P.createTrackPos();
  e.update([kart('1', now - 30000, { pit: true }), kart('2', now - 33000)], now);
  deepStrictEqual(e.gapsFor('1', now), { ahead: null, behind: null });
  deepStrictEqual(e.gapsFor('99', now), { ahead: null, behind: null });
});

console.log('\nsin pit lane (sin marcas de box)');

test('salida de box sin pit lane: reaparece a "offset del túnel" de la meta', () => {
  const e = P.createTrackPos();
  const ctx = { pitDurationS: 120, tunnelOffsetS: 20, outTimeFrac: null };
  e.update([kart('7', 100 * S, { pit: true })], 300 * S, ctx);
  e.update([kart('7', 100 * S)], 400 * S, ctx);
  const p = e.positions(410 * S)[0];
  strictEqual(p.mode, 'outlap');
  near(p.t, (1 - 20 / 60) + (20 / 60) * 0.5, 1e-9);   // salida en 0,667 y a mitad de camino
});

test('salida de box sin pit lane ni offset: oculto hasta el siguiente pase', () => {
  const e = P.createTrackPos();
  const ctx = { pitDurationS: 120, tunnelOffsetS: null, outTimeFrac: null };
  e.update([kart('7', 100 * S, { pit: true }), kart('1', 395 * S)], 300 * S, ctx);
  e.update([kart('7', 100 * S), kart('1', 395 * S)], 400 * S, ctx);
  const p = e.positions(410 * S).find(x => x.dorsal === '7');
  strictEqual(p.mode, 'hidden');
  strictEqual(p.t, null);
  deepStrictEqual(e.gapsFor('1', 410 * S), { ahead: null, behind: null });
  e.update([kart('7', 420 * S), kart('1', 395 * S)], 420 * S, ctx);
  strictEqual(e.positions(425 * S).find(x => x.dorsal === '7').mode, 'track');
});

test('por defecto (sin ctx) no hay pit lane: la salida va oculta', () => {
  const e = P.createTrackPos();
  e.update([kart('7', 100 * S, { pit: true })], 300 * S);
  e.update([kart('7', 100 * S)], 400 * S);
  strictEqual(e.positions(405 * S)[0].mode, 'hidden');
});

console.log('\nmenores (revisión final)');

test('error en vivo: una vuelta negativa (seek del replay / cambio de sesión) no cuenta', () => {
  const e = P.createTrackPos();
  e.update([kart('7', 100 * S)], 100 * S);
  e.update([kart('7', 50 * S)], 101 * S);
  strictEqual(e.errorStats().n, 0);
});

test('kart sin ningún pase todavía → oculto, sin huecos', () => {
  const now = 1000 * S;
  const e = P.createTrackPos();
  e.update([kart('1', now - 30000), kart('9', 0)], now);
  const p = e.positions(now).find(x => x.dorsal === '9');
  strictEqual(p.mode, 'hidden');
  strictEqual(p.t, null);
  const g = e.gapsFor('1', now);
  ok(!g.ahead || g.ahead.dorsal !== '9');
  ok(!g.behind || g.behind.dorsal !== '9');
});

test('reset() vacía karts, errores y desfase', () => {
  const e = P.createTrackPos();
  let at = 100 * S;
  for (let i = 0; i < 6; i++) { e.update([kart('7', at)], at + 2000); at += 60300; }
  ok(e.errorStats().n > 0);
  e.reset();
  strictEqual(e.errorStats().n, 0);
  deepStrictEqual(e.positions(at), []);
  strictEqual(e.clockSkewMs(), 0);
  strictEqual(e._fieldRef(), null);
});

test('un solo rival: delante sí, detrás null (no el mismo kart dos veces)', () => {
  const now = 1000 * S;
  const e = P.createTrackPos();
  e.update([kart('1', now - 30000), kart('2', now - 33000)], now);
  const g = e.gapsFor('1', now);
  strictEqual(g.ahead.dorsal, '2');
  strictEqual(g.behind, null);
});


console.log('\nparada masiva (firma del cambio de sentido)');

const field = (n, at, pit) => Array.from({ length: n }, (_, i) => kart(String(i + 1), at, { pit: pit(i) }));

test('casi toda la parrilla entra a box en <90 s → massPit con el instante', () => {
  const e = P.createTrackPos();
  e.update(field(10, 50 * S, () => false), 0);
  e.update(field(10, 50 * S, () => false), 100 * S);
  strictEqual(e.massPit(), null);
  e.update(field(10, 50 * S, i => i < 4), 120 * S);
  strictEqual(e.massPit(), null, '4/10 aún no es masiva');
  e.update(field(10, 50 * S, i => i < 8), 150 * S);
  const m = e.massPit();
  ok(m, 'detectada');
  strictEqual(m.at, 150 * S);
  strictEqual(m.n, 8);
});
test('paradas escalonadas (estrategia normal) no cuentan como masivas', () => {
  const e = P.createTrackPos();
  e.update(field(10, 50 * S, () => false), 0);
  for (let i = 0; i < 10; i++) {
    e.update(field(10, 50 * S, j => j === i), (100 + i * 120) * S);
  }
  strictEqual(e.massPit(), null);
});
test('karts que YA estaban en box al conectar no cuentan', () => {
  const e = P.createTrackPos();
  e.update(field(10, 50 * S, () => true), 100 * S);
  strictEqual(e.massPit(), null);
});
test('al conectar, la parrilla entera pasando a box en el primer minuto no cuenta', () => {
  const e = P.createTrackPos();
  e.update(field(10, 50 * S, () => false), 100 * S);
  e.update(field(10, 50 * S, () => true), 102 * S);
  strictEqual(e.massPit(), null);
});
test('antes de la salida (sin ningún pase por meta) no cuenta', () => {
  const e = P.createTrackPos();
  e.update(field(10, 0, () => false), 0);
  e.update(field(10, 0, () => true), 100 * S);
  strictEqual(e.massPit(), null);
});
test('parrilla pequeña: hacen falta al menos 5 karts', () => {
  const e = P.createTrackPos();
  e.update(field(4, 50 * S, () => false), 0);
  e.update(field(4, 50 * S, () => false), 100 * S);
  e.update(field(4, 50 * S, () => true), 110 * S);
  strictEqual(e.massPit(), null);
});
test('reset olvida la parada masiva', () => {
  const e = P.createTrackPos();
  e.update(field(6, 50 * S, () => false), 0);
  e.update(field(6, 50 * S, () => false), 100 * S);
  e.update(field(6, 50 * S, () => true), 110 * S);
  ok(e.massPit());
  e.reset();
  strictEqual(e.massPit(), null);
});

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
