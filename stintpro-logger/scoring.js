'use strict';

// Nombres inválidos: dorsales puros, placeholders genéricos
function _validName(n) {
  if (!n || typeof n !== 'string') return false;
  const s = n.trim();
  if (s.length < 3) return false;
  if (/^\d+$/.test(s)) return false;
  if (/^kart\s*\d+$/i.test(s)) return false;
  if (/^(equipo|team|piloto|driver)\s*\d*$/i.test(s)) return false;
  if (/^\(sin nombre\)$/i.test(s)) return false;
  return true;
}

/**
 * Calcula los scores de pilotos a partir de filas de sesión.
 *
 * @param {Array<{name, session_id, best_ms, avg_ms, laps}>} rows
 *   Filas de getPilotSessionsByCircuit — una fila por piloto×sesión.
 * @returns {Array} Pilotos ordenados por score desc.
 */
function computePilotRatings(rows) {
  const validRows = rows.filter(r => _validName(r.name));
  if (!validRows.length) return [];

  // ── Detección de sesiones lluviosas ──────────────────────────────────────
  const sessionPace = {};
  for (const r of validRows) {
    if (!sessionPace[r.session_id]) sessionPace[r.session_id] = { sum: 0, laps: 0 };
    sessionPace[r.session_id].sum  += r.avg_ms * r.laps;
    sessionPace[r.session_id].laps += r.laps;
  }
  const sessionAvgs = Object.entries(sessionPace)
    .filter(([, d]) => d.laps >= 5)
    .map(([sid, d]) => ({ session_id: parseInt(sid), avg: d.sum / d.laps }))
    .sort((a, b) => a.avg - b.avg);

  // Referencia seca = P25 de ritmos de sesión
  const dryRef = sessionAvgs.length
    ? sessionAvgs[Math.floor(sessionAvgs.length * 0.25)].avg
    : null;

  // Sesión lluviosa: ritmo medio >12% sobre la referencia seca
  const WET_THRESHOLD = 1.12;
  const wetSessions = new Set(
    dryRef
      ? sessionAvgs.filter(s => s.avg / dryRef > WET_THRESHOLD).map(s => s.session_id)
      : []
  );

  // Récord absoluto del circuito en sesiones secas
  const dryRows = validRows.filter(r => !wetSessions.has(r.session_id));
  const circuitRecord = Math.min(...(dryRows.length ? dryRows : validRows).map(r => r.best_ms));

  // Agrupar por sesión para ranking por sesión (solo sesiones secas)
  const bySession = {};
  for (const r of dryRows) {
    if (!bySession[r.session_id]) bySession[r.session_id] = [];
    bySession[r.session_id].push(r);
  }
  for (const sid of Object.keys(bySession)) {
    bySession[sid].sort((a, b) => a.best_ms - b.best_ms);
  }

  // Agregar por piloto
  const pilotMap = {};
  for (const r of dryRows) {
    const key = r.name.trim();
    if (!pilotMap[key]) pilotMap[key] = { name: key, sessions: [], total_laps: 0 };
    const rank = bySession[r.session_id];
    const pos  = rank.findIndex(x => x.name === r.name) + 1;
    pilotMap[key].sessions.push({ best_ms: r.best_ms, laps: r.laps, position: pos, total: rank.length });
    pilotMap[key].total_laps += r.laps;
  }

  // 12% sobre récord = 0 puntos de pace
  const PACE_FLOOR = 0.12;
  const MIN_LAPS   = 10;

  const results = [];

  for (const p of Object.values(pilotMap)) {
    const pilot_best = Math.min(...p.sessions.map(s => s.best_ms));
    const n_sessions = p.sessions.length;
    const total_laps = p.total_laps;

    if (total_laps < MIN_LAPS) {
      results.push({
        name: p.name, score: null, tier: 'Sin datos',
        pace_score: null, position_score: null, consistency_score: null,
        pilot_best_ms: pilot_best, circuit_record_ms: circuitRecord,
        gap_to_record_pct: null, session_count: n_sessions, total_laps,
      });
      continue;
    }

    // Componente 1: Pace (0-500)
    const pace_raw   = (pilot_best - circuitRecord) / circuitRecord;
    const pace_score = Math.round(Math.max(0, 1 - pace_raw / PACE_FLOOR) * 500);

    // Componente 2: Posición (0-300)
    const compSessions = p.sessions.filter(s => s.total >= 5);
    let position_score = 150;
    if (compSessions.length > 0) {
      const avgPct = compSessions.reduce((sum, s) =>
        sum + (1 - (s.position - 1) / Math.max(1, s.total - 1)), 0
      ) / compSessions.length;
      position_score = Math.round(avgPct * 300);
    }

    // Componente 3: Consistencia (0-200) — mitad mejor de sesiones
    let consistency_score = 100;
    if (n_sessions >= 2) {
      const paces = p.sessions
        .map(s => (s.best_ms - circuitRecord) / circuitRecord)
        .sort((a, b) => a - b)
        .slice(0, Math.ceil(n_sessions / 2));
      const mean   = paces.reduce((a, b) => a + b, 0) / paces.length;
      const stddev = Math.sqrt(paces.reduce((a, b) => a + (b - mean) ** 2, 0) / paces.length);
      const cv     = stddev / (mean + 0.001);
      consistency_score = Math.round(Math.max(0, 1 - cv / 0.3) * 200);
    }

    results.push({
      name: p.name,
      score: null,
      raw_score: pace_score + position_score + consistency_score,
      pace_score,
      position_score,
      consistency_score,
      pilot_best_ms:     pilot_best,
      circuit_record_ms: circuitRecord,
      gap_to_record_pct: Math.round(pace_raw * 1000) / 10,
      session_count:     n_sessions,
      total_laps,
    });
  }

  // Shrinkage bayesiano — K=4 sesiones como prior
  const scored = results.filter(p => p.raw_score != null);
  const circuitMean = scored.length
    ? scored.reduce((s, p) => s + p.raw_score, 0) / scored.length
    : 500;

  const K = 4;
  for (const p of results) {
    if (p.raw_score == null) continue;
    const w = p.session_count / (p.session_count + K);
    p.score = Math.round(w * p.raw_score + (1 - w) * circuitMean);
  }

  return results.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

module.exports = { computePilotRatings };
