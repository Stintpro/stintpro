#!/usr/bin/env node
// tools/track-from-gps.js — una vuelta GPS → src/tracks/<slug>.json (pestaña 🗺️ Pista)
//
// Lee un CSV de RaceBox o de RaceChrono (un Dragy se convierte antes con
// ~/track-engineer/tools/dragy_to_csv.py, que sale en formato RaceBox), elige la
// vuelta limpia más rápida (o --lap N), la remuestrea a 400 puntos por distancia
// y guarda la geometría NORMALIZADA (sin lat/lon) + el perfil de tiempo medido.
// Escribe además tools/_tracks/<slug>.preview.svg con marcas cada 0,05 para
// elegir a ojo --pit-in / --pit-out (fracciones de distancia, sentido normal).
//
// Uso: node tools/track-from-gps.js <sesion.csv> --slug <slug> [--name "Nombre"]
//        [--lap N] [--direction normal|inverso] [--pit-in F --pit-out F] [--out src/tracks]
'use strict';

const fs = require('fs');
const path = require('path');

const N_POINTS = 400;
const GAP_MAX_S = 2.0;      // hueco en los datos: la vuelta no vale (misma regla que Track Engineer)
const MIN_LAP_S = 20;
const R_EARTH = 6371000;
const MARGIN = 40, SPAN = 920, TRACK_WIDTH_M = 8;

function fmtLap(s) {
  const ms = Math.round(s * 1000), m = Math.floor(ms / 60000), r = ms - m * 60000;
  return `${m}:${String(Math.floor(r / 1000)).padStart(2, '0')}.${String(r % 1000).padStart(3, '0')}`;
}

function parseGpsCsv(text) {
  const lines = text.split(/\r?\n/);
  const hi = lines.findIndex(l => /latitude/i.test(l) && /(^|,)\s*lap( #)?\s*(,|$)/i.test(l));
  if (hi < 0) throw new Error('no encuentro la cabecera (Latitude/Longitude/Lap): ¿es un CSV de RaceBox o RaceChrono?');
  const cols = lines[hi].split(',').map(c => c.trim());
  const find = re => cols.findIndex(c => re.test(c));
  const iT = find(/^time( \(s\))?$/i), iLat = find(/^latitude/i), iLon = find(/^longitude/i), iLap = find(/^lap( #)?$/i);
  if ([iT, iLat, iLon, iLap].some(i => i < 0)) throw new Error('faltan columnas Time/Latitude/Longitude/Lap en la cabecera');
  const samples = [];
  for (let r = hi + 1; r < lines.length; r++) {
    const f = lines[r].split(',');
    const t = parseFloat(f[iT]), lat = parseFloat(f[iLat]), lon = parseFloat(f[iLon]), lap = parseInt(f[iLap], 10);
    if ([t, lat, lon].some(Number.isNaN)) continue;
    samples.push({ t, lat, lon, lap: Number.isNaN(lap) ? 0 : lap });
  }
  return samples;
}

// Vueltas completas: de un cambio de número de vuelta al siguiente. Se descarta
// la que empieza en la primera muestra (no consta que arrancara en la meta) y
// cualquiera con un hueco de datos > GAP_MAX_S.
function splitLaps(samples) {
  const starts = [];
  for (let i = 0; i < samples.length; i++)
    if (samples[i].lap > 0 && (i === 0 || samples[i].lap !== samples[i - 1].lap)) starts.push(i);
  const laps = [];
  for (let j = 0; j + 1 < starts.length; j++) {
    const a = starts[j], b = starts[j + 1];
    if (a === 0) continue;
    let ok = true;
    for (let i = a + 1; i <= b; i++) if (samples[i].t - samples[i - 1].t > GAP_MAX_S) { ok = false; break; }
    const timeS = samples[b].t - samples[a].t;
    if (ok && timeS >= MIN_LAP_S) laps.push({ lap: samples[a].lap, start: a, end: b, timeS });
  }
  return laps;
}

function buildTrack(samples, lapInfo, opts) {
  const o = opts || {};
  const seg = samples.slice(lapInfo.start, lapInfo.end + 1);
  const lat0 = seg.reduce((s, p) => s + p.lat, 0) / seg.length;
  const lon0 = seg.reduce((s, p) => s + p.lon, 0) / seg.length;
  const ky = R_EARTH * Math.PI / 180, kx = Math.cos(lat0 * Math.PI / 180) * ky;
  const xy = seg.map(p => [(p.lon - lon0) * kx, -(p.lat - lat0) * ky]);   // norte arriba
  const t0 = seg[0].t, T = seg[seg.length - 1].t - t0;
  const dist = [0];
  for (let i = 1; i < xy.length; i++) dist.push(dist[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  const L = dist[dist.length - 1];

  const pts = [], tf = [];
  let j = 0;
  for (let n = 0; n < N_POINTS; n++) {
    const s = L * n / N_POINTS;
    while (j < dist.length - 2 && dist[j + 1] < s) j++;
    const span = dist[j + 1] - dist[j], k = span > 0 ? (s - dist[j]) / span : 0;
    pts.push([xy[j][0] + (xy[j + 1][0] - xy[j][0]) * k, xy[j][1] + (xy[j + 1][1] - xy[j][1]) * k]);
    tf.push((seg[j].t + (seg[j + 1].t - seg[j].t) * k - t0) / T);
  }

  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX, spanY = Math.max(...ys) - minY;
  const scale = SPAN / Math.max(spanX, spanY);
  const r1 = v => Math.round(v * 10) / 10;
  let points = pts.map(([x, y]) => [r1(MARGIN + (x - minX) * scale), r1(MARGIN + (y - minY) * scale)]);
  const viewBox = { w: Math.round(spanX * scale + 2 * MARGIN), h: Math.round(spanY * scale + 2 * MARGIN) };
  const timeFrac = tf.map(v => Math.round(v * 1e6) / 1e6);

  // El fichero guarda SIEMPRE los puntos en el orden del sentido normal.
  const dir = o.direction === 'inverso' ? 'inverso' : 'normal';
  if (dir === 'inverso') points = [points[0], ...points.slice(1).reverse()];
  const source = `${o.sourceLabel || 'gps'} V${lapInfo.lap} ${fmtLap(lapInfo.timeS)}`;
  const pitLane = (o.pitIn != null && o.pitOut != null) ? { inFrac: Number(o.pitIn), outFrac: Number(o.pitOut) } : null;
  return {
    version: 1, slug: o.slug, name: o.name || o.slug, lengthM: Math.round(L), viewBox,
    widthUnits: Math.max(10, r1(TRACK_WIDTH_M * scale)), points, pitLane,
    profiles: {
      normal: dir === 'normal' ? { timeFrac, source } : null,
      inverso: dir === 'inverso' ? { timeFrac, source } : null,
    },
  };
}

function previewSvg(json) {
  const { w, h } = json.viewBox, P = json.points, n = P.length;
  const d = P.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ') + ' Z';
  let ticks = '';
  for (let k = 0; k < 20; k++) {
    const [x, y] = P[Math.round(k * n / 20) % n];
    ticks += `<circle cx="${x}" cy="${y}" r="6" fill="${k ? '#5b8dee' : '#22c55e'}"/>` +
      `<text x="${x + 9}" y="${y - 9}" font-size="18" font-family="sans-serif" fill="#e5e7eb">${(k / 20).toFixed(2)}</text>`;
  }
  const a = P[Math.round(n * 0.03)];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="background:#0e0f11">` +
    `<path d="${d}" fill="none" stroke="#9ca3af" stroke-width="${json.widthUnits}" stroke-linejoin="round" opacity=".45"/>` +
    `${ticks}<text x="${a[0] + 9}" y="${a[1] + 28}" font-size="16" font-family="sans-serif" fill="#22c55e">→ sentido normal (0.00 = meta)</text></svg>`;
}

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { a[argv[i].slice(2)] = argv[i + 1]; i++; }
    else a._.push(argv[i]);
  }
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a._[0] || !a.slug) {
    console.error('uso: node tools/track-from-gps.js <sesion.csv> --slug <slug> [--name "Nombre"] [--lap N] [--direction normal|inverso] [--pit-in F --pit-out F] [--out src/tracks]');
    process.exit(2);
  }
  const samples = parseGpsCsv(fs.readFileSync(a._[0], 'utf8'));
  const laps = splitLaps(samples);
  if (!laps.length) throw new Error('no hay ninguna vuelta completa y continua en el fichero');
  laps.forEach(l => console.log(`  V${l.lap}  ${fmtLap(l.timeS)}`));
  const pick = a.lap ? laps.find(l => l.lap === Number(a.lap)) : laps.reduce((b, l) => (l.timeS < b.timeS ? l : b));
  if (!pick) throw new Error(`la vuelta ${a.lap} no está o no es válida`);
  const json = buildTrack(samples, pick, {
    slug: a.slug, name: a.name, direction: a.direction,
    pitIn: a['pit-in'] != null ? Number(a['pit-in']) : null,
    pitOut: a['pit-out'] != null ? Number(a['pit-out']) : null,
    sourceLabel: path.basename(a._[0]),
  });
  const outDir = a.out || path.join(__dirname, '..', 'src', 'tracks');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, a.slug + '.json');
  fs.writeFileSync(outFile, JSON.stringify(json) + '\n');
  const prevDir = path.join(__dirname, '_tracks');
  fs.mkdirSync(prevDir, { recursive: true });
  const prev = path.join(prevDir, a.slug + '.preview.svg');
  fs.writeFileSync(prev, previewSvg(json));
  console.log(`✓ ${outFile}  (${json.lengthM} m · V${pick.lap} ${fmtLap(pick.timeS)})\n  vista previa: ${prev}`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('✗', e.message); process.exit(1); }
}

module.exports = { parseGpsCsv, splitLaps, buildTrack, previewSvg, fmtLap };
