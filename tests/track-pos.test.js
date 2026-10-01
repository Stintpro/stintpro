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
  ok(o.pitLane && o.pitLane.inFrac > 0.5 && o.pitLane.outFrac < 0.5);
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
  const o = P.ovalTrack();
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
  const o = P.ovalTrack();
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

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
