// StintPro — paridad visual del refactor de columnas
// El HTML generado desde el catálogo debe ser idéntico, carácter a carácter, al
// que producía _enRenderRow() cableada (src/en-grid.js:404, commit 097c8b1).
// Ejecutar: node tests/columns-parity.test.js
'use strict';

const { strictEqual } = require('assert/strict');
const { COLUMNS, visibleColumns, rowCells, defaultSelection } = require('../src/en-columns');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.log('  ✗', name, '→', e.message); failed++; }
}

global._esc            = s => String(s == null ? '' : s);
global._enFmt          = t => (t == null ? '—' : String(t));
global._enPilotHistory = {};
global._enPilotRatings = {};
global._enScoreColor   = () => '#22c55e';

const e = {
  dorsal: '7', name: 'PILOTO A', teamName: 'EQUIPO A', pos: 3, tours: 42,
  lastLap: 47.2, bestLap: 46.9, interval: '+1.203', standsCount: 2,
};
const d = {
  // Contador oficial de Apex: es el caso que debe ser byte a byte idéntico
  // al HTML de antes del refactor. Las otras fuentes (propio/suelo) pintan
  // distinto a propósito y se prueban en columns.test.js.
  toursSrc: 'apex',
  kc: { bg: '#111', text: '#eee' }, kartBorder: '#22c55e', tooltip: 'tt', qualityBadge: '',
  dotColor: '#22c55e', arrow: '', chkBadge: '', pitBadge: '', fixBadge: '',
  lastCol: '#aaa', bestCol: '#bbb', m5Col: '#ccc', avg5: 47.05,
  trend: { color: '#ddd', arrow: '→' }, deltaCol: '#eee', deltaStr: '+0.150',
  gapHtml: '+2.100',
};

// Copia literal del cuerpo de _enRenderRow() ANTES del refactor
const ESPERADO =
  `<div class="sp-dot" style="background:${d.dotColor}"></div>` +
  `<div class="sp-pos">${e.pos === 99 ? '—' : e.pos}${d.arrow}</div>` +
  `<div><div class="en-kart" style="background:${d.kc.bg};color:${d.kc.text};border:1.5px solid ${d.kartBorder}" onclick="_enToggleQuality('${e.dorsal}',event)" title="${d.tooltip}">${e.dorsal}${d.qualityBadge}</div></div>` +
  `<div class="sp-name">${d.chkBadge}${global._esc(e.name)}${d.pitBadge}${d.fixBadge}</div>` +
  `<div class="sp-name" style="font-size:12px;color:var(--text-3)">${global._esc(e.teamName)}</div>` +
  `<div class="sp-vtas">${e.tours}</div>` +
  `<div class="sp-t" style="color:${d.lastCol}">${global._enFmt(e.lastLap)}</div>` +
  `<div class="sp-t" style="color:${d.bestCol}">${global._enFmt(e.bestLap)}</div>` +
  `<div class="en-m5" style="color:${d.m5Col}">${global._enFmt(d.avg5)}<span style="color:${d.trend.color};font-size:10px;margin-left:2px">${d.trend.arrow}</span></div>` +
  `<div class="en-delta" style="color:${d.deltaCol}">${d.deltaStr}</div>` +
  `<div class="sp-gap">${d.gapHtml}</div>` +
  `<div class="sp-gap">${e.interval}</div>` +
  `<div class="sp-cons" style="cursor:pointer" onclick="_enShowLapHistory('${e.dorsal}',event)" title="Ver vueltas de la sesión"><span style="color:#2d2f38">—</span></div>` +
  `<div class="sp-pitc">${e.standsCount}</div>`;

const FULL_COLMAP = { rk: 'c1', no: 'c2', dr: 'c3', lc: 'c6', llp: 'c7', blp: 'c8', gap: 'c9', int: 'c10', pit: 'c11' };

console.log('\nparidad de la fila');

test('el catálogo reproduce la fila cableada carácter a carácter', () => {
  strictEqual(rowCells(visibleColumns(FULL_COLMAP, defaultSelection()), e, d), ESPERADO);
});

console.log(`\n${passed} pasados, ${failed} fallados`);
process.exit(failed ? 1 : 0);
