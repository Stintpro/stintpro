// ── apex-archive.js — copia de la tanda archivada en request.php de Apex ──
//
// Algunos circuitos (Campillos, port 9370) guardan en Apex sus ÚLTIMAS 5 tandas:
//   request=S#        → "64#FP27 - FP27\n63#FP26 - FP26\n…"
//   request=S#<id>    → la tanda entera ("0@0@init|p|…" + título + parrilla final)
// Lo que sale de la lista se borra (~1 h de margen en un día de tandas). La
// mayoría de circuitos devuelve vacío.
//
// Sirve de respaldo y para reparar una tanda que arrancó sin parrilla nueva:
// sus vueltas se grabaron con el rowId como dorsal y sin piloto (Campillos FP15
// #3880, 2026-11-13). La parrilla del archivo dice qué kart y piloto era cada fila.

const ApexParser = require('./apex-parser');

// Solape mínimo de filas para dar el archivo por ESTA sesión (los rowIds son
// únicos por tanda, así que en la práctica el solape es todo o nada).
const MIN_OVERLAP = 0.5;

function parseSessionList(text) {
  return String(text || '').split('\n')
    .map(l => l.trim().match(/^(\d+)#(.*)$/))
    .filter(Boolean)
    .map(m => ({ id: Number(m[1]), title: m[2].trim() }));
}

// Pasa el archivo por el mismo parser del logger (colMap por data-type, multiidioma).
function readArchive(text) {
  const rows = new Map();
  let title = null;
  const raw = String(text || '').replace(/^\d+@\d+@/, '');
  if (!raw.includes('grid|')) return { title, rows };
  const p = new ApexParser({ onTitle: t => { title = t; } });
  try { p.parse(raw); } catch (e) { return { title, rows }; }
  const byDorsal = new Map(p.getState().equipos.map(e => [String(e.dorsal), e]));
  for (const { rowId, dorsal } of p.getKartIds()) {
    const e = byDorsal.get(String(dorsal)) || {};
    rows.set(rowId.replace(/^r/, ''), { dorsal: String(dorsal), name: e.name || null });
  }
  return { title, rows };
}

// archives: [{ id, title, rows }]; rowIds: Set de filas (sin la r) de la sesión.
function pickArchive(archives, rowIds) {
  if (!rowIds || !rowIds.size) return null;
  let best = null, bestHit = 0;
  for (const a of archives) {
    let hit = 0;
    for (const id of rowIds) if (a.rows.has(id)) hit++;
    if (hit > bestHit) { best = a; bestHit = hit; }
  }
  return best && bestHit / rowIds.size >= MIN_OVERLAP ? best : null;
}

// Vueltas grabadas con el rowId como dorsal y sin piloto → { from, to, name }.
function planRepair(laps, rows) {
  const plan = new Map();
  for (const l of laps) {
    if (l.name) continue;
    const r = rows.get(String(l.dorsal));
    if (r && !plan.has(String(l.dorsal))) plan.set(String(l.dorsal), { from: String(l.dorsal), to: r.dorsal, name: r.name });
  }
  return [...plan.values()];
}

module.exports = { parseSessionList, readArchive, pickArchive, planRepair, MIN_OVERLAP };
