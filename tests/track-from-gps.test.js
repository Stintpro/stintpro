// StintPro — tests de la herramienta GPS → trazado (tools/track-from-gps.js)
// con un circuito SINTÉTICO de geometría y velocidades conocidas.
// Ejecutar: node tests/track-from-gps.test.js
'use strict';

const { ok, strictEqual, deepStrictEqual, throws } = require('assert');
const G = require('../tools/track-from-gps');
const P = require('../src/en-track-pos');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}
const near = (a, b, eps) => ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

// Estadio: recta 200 m · curva r=30 m · recta 200 m · curva r=30 m.
// Rectas a 20 m/s, curvas a 10 m/s → vuelta de 38,85 s (20 + 18,85).
const R = 30, ST = 200, L = 2 * ST + 2 * Math.PI * R;
function pathAt(s) {
  s = ((s % L) + L) % L;
  if (s < ST) return [s, 0];
  s -= ST; if (s < Math.PI * R) { const a = s / R; return [ST + R * Math.sin(a), R - R * Math.cos(a)]; }
  s -= Math.PI * R; if (s < ST) return [ST - s, 2 * R];
  s -= ST; const a = s / R; return [-R * Math.sin(a), R + R * Math.cos(a)];
}
const speedAt = s => { s = ((s % L) + L) % L; return (s < ST || (s >= ST + Math.PI * R && s < 2 * ST + Math.PI * R)) ? 20 : 10; };
function rows({ laps = 4, hz = 25, faster = {}, gap = null }) {
  const out = [];
  let t = 0, s = 0;
  while (s < L * (laps - 0.5)) {
    const lap = Math.floor(s / L) + 1;
    const [x, y] = pathAt(s);
    const lat = 40 - y / 111320, lon = -3 + x / (111320 * Math.cos(40 * Math.PI / 180));
    if (!(gap && t > gap[0] && t < gap[1])) out.push({ t, lat, lon, lap });
    s += speedAt(s) * (faster[lap] || 1) / hz; t += 1 / hz;
  }
  return out;
}
const raceBox = rs => ['Record,Time,Latitude,Longitude,Altitude,KPH,X,Y,Z,Lap,GyroX,GyroY,GyroZ',
  ...rs.map((r, i) => `${i + 1},${r.t.toFixed(3)},${r.lat.toFixed(7)},${r.lon.toFixed(7)},600,0,0,0,0,${r.lap},0,0,0`)].join('\n');
const raceChrono = rs => ['This file is created using RaceChrono Pro v10.2.4 ( http://racechrono.com/ ).',
  'Session title,"Test"', '',
  'Time (s),Session fragment #,Lap #,Trap name,Distance (m),Speed (m/s),Latitude (deg),Longitude (deg)',
  ...rs.map(r => `${(1784748579 + r.t).toFixed(3)},0,${r.lap},,0,0,${r.lat.toFixed(7)},${r.lon.toFixed(7)}`)].join('\n');

const LAPS = rows({ faster: { 3: 1.05 } });

test('lee CSV de RaceBox', () => {
  const s = G.parseGpsCsv(raceBox(LAPS));
  strictEqual(s.length, LAPS.length);
  strictEqual(s[0].lap, 1);
});

test('lee CSV de RaceChrono (cabecera tras el preámbulo)', () => {
  const s = G.parseGpsCsv(raceChrono(LAPS));
  strictEqual(s.length, LAPS.length);
  near(s[1].t - s[0].t, 0.04, 1e-3);
});

test('CSV desconocido → error claro', () => {
  throws(() => G.parseGpsCsv('a,b,c\n1,2,3'), /cabecera/);
});

test('vueltas: solo las completas que empiezan en la meta (2 y 3)', () => {
  const laps = G.splitLaps(G.parseGpsCsv(raceBox(LAPS)));
  deepStrictEqual(laps.map(l => l.lap), [2, 3]);
  near(laps[0].timeS, 38.85, 0.1);
  near(laps[1].timeS, 38.85 / 1.05, 0.1);
});

test('un hueco de datos > 2 s invalida la vuelta', () => {
  const laps = G.splitLaps(G.parseGpsCsv(raceBox(rows({ gap: [45, 48] }))));
  deepStrictEqual(laps.map(l => l.lap), [3]);
});

test('trazado: 400 puntos, longitud ±1 %, perfil de TIEMPO medido', () => {
  const s = G.parseGpsCsv(raceBox(LAPS));
  const lap = G.splitLaps(s)[0];
  const j = G.buildTrack(s, lap, { slug: 'test', name: 'Test' });
  strictEqual(j.version, 1);
  strictEqual(j.points.length, 400);
  near(j.lengthM, L, L * 0.01);
  const tf = j.profiles.normal.timeFrac;
  strictEqual(tf.length, 400);
  strictEqual(tf[0], 0);
  ok(tf.every((v, i) => i === 0 || v > tf[i - 1]) && tf[399] < 1);
  // fin de la 1ª recta: 34 % de la distancia pero solo 25,7 % del tiempo
  near(tf[Math.round(400 * ST / L)], 10 / 38.85, 0.01);
  strictEqual(j.profiles.inverso, null);
  strictEqual(j.pitLane, null);
});

test('geometría normalizada al viewBox, sin lat/lon', () => {
  const s = G.parseGpsCsv(raceBox(LAPS));
  const j = G.buildTrack(s, G.splitLaps(s)[0], { slug: 'test' });
  ok(j.points.every(([x, y]) => x >= 0 && x <= j.viewBox.w && y >= 0 && y <= j.viewBox.h));
  ok(Math.max(j.viewBox.w, j.viewBox.h) === 1000);
  ok(!('lat' in j) && !('lon' in j));
});

test('grabado en sentido inverso: puntos en orden normal, perfil en "inverso"', () => {
  const s = G.parseGpsCsv(raceBox(LAPS));
  const lap = G.splitLaps(s)[0];
  const n = G.buildTrack(s, lap, { slug: 't' });
  const inv = G.buildTrack(s, lap, { slug: 't', direction: 'inverso' });
  deepStrictEqual(inv.points[0], n.points[0]);
  deepStrictEqual(inv.points[1], n.points[399]);
  strictEqual(inv.profiles.normal, null);
  deepStrictEqual(inv.profiles.inverso.timeFrac, n.profiles.normal.timeFrac);
});

test('pit in / pit out a mano', () => {
  const s = G.parseGpsCsv(raceBox(LAPS));
  const j = G.buildTrack(s, G.splitLaps(s)[0], { slug: 't', pitIn: 0.9, pitOut: 0.05 });
  deepStrictEqual(j.pitLane, { inFrac: 0.9, outFrac: 0.05 });
});

test('el motor del mapa carga lo que genera la herramienta, en los dos sentidos', () => {
  const s = G.parseGpsCsv(raceBox(LAPS));
  const j = G.buildTrack(s, G.splitLaps(s)[0], { slug: 't', pitIn: 0.9, pitOut: 0.05 });
  const a = P.loadTrack(j, 'normal'), b = P.loadTrack(j, 'inverso');
  ok(a && a.approxProfile === false);
  ok(b && b.approxProfile === true);
});

test('vista previa SVG con marcas de fracción', () => {
  const s = G.parseGpsCsv(raceBox(LAPS));
  const svg = G.previewSvg(G.buildTrack(s, G.splitLaps(s)[0], { slug: 't' }));
  ok(svg.startsWith('<svg') && svg.includes('0.50') && svg.includes('sentido normal'));
});

test('fmtLap en m:ss.sss', () => {
  strictEqual(G.fmtLap(66.321), '1:06.321');
  strictEqual(G.fmtLap(38.85), '0:38.850');
});

test('CSV real de RaceBox con preámbulo e ISO-8601 Time', () => {
  const baseTime = Date.UTC(2026, 3, 19, 8, 21, 7);
  const raceBoxRealWithPreamble = rs => [
    'Format,RaceBox CSV',
    'Track,Henakart sentido Normal',
    'Lap 1, 36.648, sectors, 10.167,12.115,0,14.366',
    '',
    'Record,Time,Latitude,Longitude,Altitude (m),Speed (m/s),GForceX (g),GForceY (g),GForceZ (g),Lap,Heading,GyroX (deg/s),GyroY (deg/s),GyroZ (deg/s)',
    ...rs.map((r, i) => {
      const isoTime = new Date(baseTime + r.t * 1000).toISOString();
      return `${i + 1},${isoTime},${r.lat.toFixed(7)},${r.lon.toFixed(7)},582.4,1.43,-0.755,-0.031,0.693,${r.lap},51.95,1.84,0.81,-1.33`;
    })
  ].join('\n') + '\n';
  const s = G.parseGpsCsv(raceBoxRealWithPreamble(LAPS));
  strictEqual(s.length, LAPS.length);
  near(s[1].t - s[0].t, 0.04, 1e-3);
  const laps = G.splitLaps(s);
  deepStrictEqual(laps.map(l => l.lap), [2, 3]);
});

console.log(`\n${passed} OK, ${failed} fallos\n`);
if (failed) process.exit(1);
