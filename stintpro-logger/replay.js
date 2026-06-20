#!/usr/bin/env node
// ── StintPro Replay — reproduce un raw log de Apex para depuración local ──
// Uso: node replay.js <archivo.ndjson> [--speed 10] [--quiet] [--dump-state]
//
//   --speed N   : velocidad de reproducción (10 = 10×, 0 = instantáneo)
//   --quiet     : solo errores y resumen (sin línea por vuelta/pit)
//   --dump-state: imprime el estado completo al final en JSON

'use strict';

const fs   = require('fs');
const path = require('path');
const { createParser } = require('../src/apex-protocol');

// ── Argumentos ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log([
    'Uso: node replay.js <archivo.ndjson> [opciones]',
    '',
    'Opciones:',
    '  --speed N     Velocidad de reproducción (default: 0 = instantáneo)',
    '  --quiet       Solo errores y resumen final',
    '  --dump-state  Imprime el estado completo al final en JSON',
    '',
    'Ejemplos:',
    '  node replay.js recordings/rkc_2026-06-20.ndjson',
    '  node replay.js recordings/rkc_2026-06-20.ndjson --speed 60 --quiet',
    '  node replay.js recordings/rkc_2026-06-20.ndjson --dump-state',
    '',
    'Archivos disponibles en ./recordings/:',
  ].join('\n'));
  const recDir = path.join(__dirname, 'recordings');
  if (fs.existsSync(recDir)) {
    fs.readdirSync(recDir).filter(f => f.endsWith('.ndjson')).sort().reverse().forEach(f => {
      const stat = fs.statSync(path.join(recDir, f));
      console.log(`  ${f}  (${(stat.size / 1024).toFixed(1)} KB)`);
    });
  } else {
    console.log('  (directorio recordings/ no existe aún)');
  }
  process.exit(0);
}

const file  = args.find(a => !a.startsWith('--'));
const speed = (() => {
  const idx = args.indexOf('--speed');
  if (idx !== -1 && args[idx + 1]) return parseFloat(args[idx + 1]);
  const eq = args.find(a => a.startsWith('--speed='));
  if (eq) return parseFloat(eq.split('=')[1]);
  return 0; // instantáneo por defecto
})();
const quiet     = args.includes('--quiet');
const dumpState = args.includes('--dump-state');

const absFile = path.resolve(file);
if (!fs.existsSync(absFile)) {
  console.error(`Error: archivo no encontrado: ${absFile}`);
  process.exit(1);
}

// ── Parser con callbacks ─────────────────────────────────────────────────────

let lapCount = 0;
let pitCount = 0;
let lastState = null;

const parser = createParser({
  onLap: (dorsal, name, ms, lapN, ts) => {
    lapCount++;
    if (!quiet) {
      const t = (ms / 1000).toFixed(3);
      console.log(`  LAP  #${String(lapN).padStart(3)} | kart ${String(dorsal).padStart(3)} | ${(name || '').padEnd(20)} | ${t}s`);
    }
  },
  onPit: (dorsal, type, stands, ts) => {
    pitCount++;
    if (!quiet) console.log(`  PIT  ${type.toUpperCase().padEnd(4)} | kart ${String(dorsal).padStart(3)} | stands=${stands}`);
  },
  onSessionEnd: () => { if (!quiet) console.log('  ── SESIÓN FINALIZADA (bandera) ──'); },
  onNewSession: () => {
    if (!quiet) console.log('  ── NUEVA SESIÓN DETECTADA ──');
    lapCount = 0;
    pitCount = 0;
  },
  onChange: (s) => { lastState = s; },
});

// ── Reproducción ─────────────────────────────────────────────────────────────

async function replay() {
  const content = fs.readFileSync(absFile, 'utf8');
  const lines   = content.split('\n').filter(Boolean);

  if (!lines.length) {
    console.error('Error: archivo vacío');
    process.exit(1);
  }

  console.log(`Reproduciendo ${lines.length} mensajes de ${path.basename(absFile)}${speed > 0 ? ` a ${speed}×` : ' (instantáneo)'}`);
  if (!quiet) console.log('');

  const instant = speed <= 0 || speed >= 10000;

  if (instant) {
    for (const line of lines) {
      try {
        const { raw } = JSON.parse(line);
        parser.parse(raw);
      } catch(e) { /* línea malformada — ignorar */ }
    }
  } else {
    let first;
    try { first = JSON.parse(lines[0]); } catch(e) { console.error('Primera línea inválida'); process.exit(1); }
    const t0        = first.t;
    const wallStart = Date.now();

    for (const line of lines) {
      try {
        const entry  = JSON.parse(line);
        const target = (entry.t - t0) / speed;
        const wait   = target - (Date.now() - wallStart);
        if (wait > 1) await new Promise(r => setTimeout(r, wait));
        parser.parse(entry.raw);
      } catch(e) { /* línea malformada — ignorar */ }
    }
  }

  // ── Resumen ────────────────────────────────────────────────────────────────
  if (!quiet) console.log('');
  console.log(`Finalizado — ${lapCount} vueltas, ${pitCount} pit events`);

  if (lastState) {
    const karts = lastState.equipos || [];
    console.log(`Karts activos: ${karts.length}`);
    if (!quiet && karts.length) {
      console.log('');
      console.log('Pos | Kart | Equipo               | Vtas | Mejor    | Última');
      console.log('----+------+----------------------+------+----------+--------');
      [...karts]
        .sort((a, b) => (a.pos || 99) - (b.pos || 99))
        .slice(0, 20)
        .forEach(k => {
          const pos    = String(k.pos   || '?').padStart(3);
          const dorsal = String(k.dorsal || '?').padStart(4);
          const name   = (k.name || '').padEnd(20).slice(0, 20);
          const tours  = String(k.tours  || 0).padStart(4);
          const best   = k.bestLap ? k.bestLap.toFixed(3).padStart(8) : '       ?';
          const last   = k.lastLap ? k.lastLap.toFixed(3).padStart(6) : '     ?';
          console.log(` ${pos} | ${dorsal} | ${name} | ${tours} | ${best} | ${last}`);
        });
    }
  }

  if (dumpState && lastState) {
    console.log('\n── Estado completo (JSON) ──');
    console.log(JSON.stringify(lastState, null, 2));
  }
}

replay().catch(err => { console.error('Error:', err.message); process.exit(1); });
