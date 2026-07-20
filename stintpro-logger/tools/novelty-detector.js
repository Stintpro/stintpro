#!/usr/bin/env node
// ── Detector de novedades del protocolo Apex ───────────────────────────────
// Barre los raw logs (.ndjson) y marca SOLO lo que no está en el catálogo
// (novelty-baseline.json): tokens, columnas (dtype), cabeceras, prefijos de
// mensaje y códigos de bandera/countdown nuevos. Objetivo: enterarnos cuando
// Apex cambia algo según el tipo de carrera, antes de que rompa el parseo.
//
// Uso:  node novelty-detector.js <dir-con-ndjson>
//   (por defecto usa el 1er argumento; imprime un informe legible)
//
// Cuando una novedad resulte inofensiva, añádela al baseline para silenciarla.

const fs   = require('fs');
const path = require('path');

const DIR = process.argv[2];
if (!DIR || !fs.existsSync(DIR)) {
  console.error('Uso: node novelty-detector.js <directorio-con-.ndjson>');
  process.exit(2);
}

const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'novelty-baseline.json'), 'utf8'));
const KNOWN = {
  dtypes:   new Set(baseline.gridDtypes),
  tokens:   new Set(baseline.cellTokens),
  tokenRe:  baseline.cellTokenRegexes.map(r => new RegExp(r)),
  prefixes: new Set(baseline.linePrefixes),
  light:    new Set(baseline.lightCodes),
  dyn1:     new Set(baseline.dyn1Subtypes),
  struct:   baseline.structuralLinePatterns.map(r => new RegExp(r)),
  headers:  new Set(baseline.knownColumnHeaders),
  noise:    baseline.scannerNoisePrefixes,
};

// ── Acumuladores de novedades ──────────────────────────────────────────────
const nov = {
  dtype:   new Map(), // dtype -> {count, circuits:Set, headers:Set}
  token:   new Map(), // token -> {count, circuits:Set, dtypes:Set, samples:[]}
  prefix:  new Map(), // prefijo -> {count, circuits:Set, samples:[]}
  light:   new Map(), // código -> {count, circuits:Set}
  dyn1:    new Map(), // subtipo -> {count, circuits:Set, samples:[]}
  header:  new Map(), // texto cabecera -> {count, circuits:Set}  (solo informativo)
};
function bump(map, key, circuit, sample) {
  if (!map.has(key)) map.set(key, { count: 0, circuits: new Set(), samples: [] });
  const e = map.get(key);
  e.count++; e.circuits.add(circuit);
  if (sample && e.samples.length < 4) e.samples.push(sample);
  return e;
}

const re_cell   = /^(r\d+)(c\d+)\|([^|]*)\|?(.*)$/;
const re_hdrCol = /data-id="(c\d+)"\s+data-type="([^"]*)"[^>]*>([^<]*)</g;

let files = 0, lines = 0, noiseLines = 0;
let knownCells = 0, knownLines = 0;
// colmap por circuito para saber el dtype de cada celda
const colmap = {}; // circuit -> { cN: dtype }
// Apex define clases CSS al vuelo (`css|no33023|border-bottom-color:#FF8000`) y
// luego las manda como "token" de la celda a la que aplican, a veces con espacio
// delante (`r12c6| no33023|12`). No son tokens de protocolo, son estilo: se
// recogen aquí para no reportarlos como novedad.
const cssClasses = {}; // circuit -> Set(nombre de clase)

// El feed WS de Apex retransmite MUCHA basura de escáneres de internet (TLS,
// SSH, sondas de proxy, protocolo Fox de Niagara, JSON suelto…). Todo eso NO es
// protocolo Apex. Heurística: el protocolo Apex es pipe-delimitado y sus líneas
// son `rN...` o un prefijo de palabra + `|` (o el token pelado `S#`). Cualquier
// otra cosa —binario, texto sin `|`, o firmas de escáner— es ruido, no novedad.
function isNoise(line) {
  // binario: carácter de reemplazo (UTF-8 inválido de un frame binario) o control
  if (/[�\x00-\x08\x0e-\x1f]/.test(line)) return true;
  // no-protocolo: Apex siempre lleva '|' salvo 'S#'. Sin '|' y no empieza por rN → escáner
  if (!line.includes('|') && !/^r\d+/.test(line) && line !== 'S#') return true;
  // firmas de escáner conocidas (texto plano con '|' pero no-Apex)
  for (const p of KNOWN.noise) if (line.startsWith(p)) return true;
  return false;
}

function classify(circuit, line) {
  lines++;
  if (!colmap[circuit]) colmap[circuit] = {};
  if (!cssClasses[circuit]) cssClasses[circuit] = new Set();

  // Ruido de escáner PRIMERO — antes de intentar interpretarlo como protocolo.
  if (isNoise(line)) { noiseLines++; return; }

  // css|<clase>|<reglas> → registra la clase para no confundirla con un token.
  if (line.startsWith('css|')) {
    const name = line.split('|')[1];
    if (name) cssClasses[circuit].add(name.trim());
  }

  // grid: refresca colmap; marca dtypes de columna no catalogados.
  if (line.startsWith('grid|')) {
    knownLines++;
    let m;
    while ((m = re_hdrCol.exec(line)) !== null) {
      colmap[circuit][m[1]] = m[2];
      const dtype = m[2];
      if (!KNOWN.dtypes.has(dtype)) {
        const e = nov.dtype.get(dtype) || { count: 0, circuits: new Set(), headers: new Set() };
        const header = (m[3] || '').trim();
        e.count++; e.circuits.add(circuit); if (header) e.headers.add(header);
        nov.dtype.set(dtype, e);
      }
    }
    return;
  }

  // líneas estructurales conocidas (vuelta, pos, sector, celdas)
  for (const rx of KNOWN.struct) if (rx.test(line)) {
    // celda: revisar dtype+token contra catálogo
    const cm = re_cell.exec(line);
    if (cm) {
      const [, , col, token] = cm;
      const dtype = colmap[circuit][col];
      const tokenKnown = !token || KNOWN.tokens.has(token.trim())
        || KNOWN.tokenRe.some(r => r.test(token.trim()))
        || cssClasses[circuit].has(token.trim());
      const dtypeKnown = dtype === undefined || KNOWN.dtypes.has(dtype);
      if (!tokenKnown) {
        const e = bump(nov.token, token, circuit, line.slice(0, 60));
        e.dtypes = e.dtypes || new Set(); if (dtype) e.dtypes.add(dtype);
      }
      if (!dtypeKnown) {
        const e = nov.dtype.get(dtype) || { count: 0, circuits: new Set(), headers: new Set() };
        e.count++; e.circuits.add(circuit); nov.dtype.set(dtype, e);
      }
      if (tokenKnown && dtypeKnown) knownCells++;
      return;
    }
    knownLines++; return;
  }

  // prefijos no-celda
  const prefix = line.split('|')[0];
  if (line.startsWith('light|')) {
    const code = line.slice(6, 8);
    if (!KNOWN.light.has(code)) bump(nov.light, code, circuit, line.slice(0, 40));
    else knownLines++;
    return;
  }
  if (line.startsWith('dyn1|')) {
    const sub = line.split('|')[1] || '';
    if (!KNOWN.dyn1.has(sub)) bump(nov.dyn1, sub, circuit, line.slice(0, 60));
    else knownLines++;
    return;
  }
  if (KNOWN.prefixes.has(prefix)) { knownLines++; return; }

  // prefijo desconocido de verdad (ya filtrado el ruido al principio)
  bump(nov.prefix, prefix.slice(0, 24), circuit, line.slice(0, 80));
}

// ── Barrido ────────────────────────────────────────────────────────────────
for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.ndjson'))) {
  files++;
  const circuit = f.split('_')[0];
  const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
  for (const row of raw.split('\n')) {
    if (!row.trim()) continue;
    let obj; try { obj = JSON.parse(row); } catch (e) { continue; }
    const data = obj.raw || '';
    for (let ln of data.split('\n')) { ln = ln.trim(); if (ln) classify(circuit, ln); }
  }
}

// ── Informe ─────────────────────────────────────────────────────────────────
const totalNov = nov.dtype.size + nov.token.size + nov.prefix.size + nov.light.size + nov.dyn1.size;
const S = s => [...s].sort().join(', ');
console.log('='.repeat(74));
console.log(`DETECTOR DE NOVEDADES — ${files} logs · ${lines.toLocaleString()} líneas de protocolo`);
console.log(`(${new Date().toISOString().slice(0,16).replace('T',' ')})`);
console.log('='.repeat(74));

if (totalNov === 0) {
  console.log('\n✅ SIN NOVEDADES — todo lo recibido casa con el catálogo conocido.');
} else {
  console.log(`\n⚠️  ${totalNov} NOVEDAD(ES) — revisar:\n`);
  for (const [d, e] of nov.dtype)
    console.log(`  [COLUMNA nueva] dtype='${d}'  x${e.count}  circuitos: ${S(e.circuits)}` + (e.headers && e.headers.size ? `  cabeceras: ${S(e.headers)}` : ''));
  for (const [t, e] of nov.token) {
    console.log(`  [TOKEN nuevo] '${t}'  x${e.count}  columnas: ${e.dtypes ? S(e.dtypes) : '?'}  circuitos: ${S(e.circuits)}`);
    e.samples.forEach(s => console.log(`       ej: ${s}`));
  }
  for (const [p, e] of nov.prefix) {
    console.log(`  [MENSAJE nuevo] prefijo '${p}'  x${e.count}  circuitos: ${S(e.circuits)}`);
    e.samples.forEach(s => console.log(`       ej: ${s}`));
  }
  for (const [c, e] of nov.light)
    console.log(`  [BANDERA nueva] light|${c}  x${e.count}  circuitos: ${S(e.circuits)}`);
  for (const [s, e] of nov.dyn1) {
    console.log(`  [DYN1 nuevo] subtipo '${s}'  x${e.count}  circuitos: ${S(e.circuits)}`);
    e.samples.forEach(x => console.log(`       ej: ${x}`));
  }
}

console.log('\n── Resumen ──');
console.log(`  celdas conocidas: ${knownCells.toLocaleString()} · otras líneas conocidas: ${knownLines.toLocaleString()} · ruido de escáner ignorado: ${noiseLines.toLocaleString()}`);
process.exit(totalNov > 0 ? 1 : 0);
