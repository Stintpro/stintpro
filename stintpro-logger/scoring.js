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

// ── Parámetros ──────────────────────────────────────────────────────────────

const PACE_FLOOR    = 0.12;  // 12% sobre la referencia = 0 puntos de pace
const MIN_LAPS      = 10;    // vueltas mínimas para puntuar a un piloto
const WET_THRESHOLD = 1.12;  // sesión >12% más lenta que su grupo = lluvia

// Separación de trazados. Un mismo slug de circuito mezcla recorridos distintos
// (Campillos rueda a 40s y a 90s; Henakart a 36s y a 53s) y el récord del
// trazado corto hundía a todo el que rodaba en el largo. Dos sesiones son de
// trazados distintos si su ritmo difiere más de un 35%: la lluvia infla un
// 12-25% (no separa, la caza el detector de lluvia), un recorrido distinto
// infla un 40-150% (sí separa).
const LAYOUT_SPLIT     = 0.35;
const MIN_CLUSTER_ROWS = 5;  // grupo minoritario con menos filas: no puntúa pace

// Referencia robusta dentro de un grupo. El mínimo absoluto lo fijaba cualquier
// vuelta anómala (Campillos: una sesión de 1 piloto y 10 vueltas marcaba el
// récord de todo el circuito), así que se usa un percentil bajo y solo cuentan
// sesiones con pilotos suficientes.
// Percentil 2 medido sobre los datos reales del VPS: el mínimo absoluto (o un
// percentil 1) deja que una vuelta anómala vuelva a fijar la referencia
// (Campillos: 76% de pilotos a 0), y un percentil 5 pega demasiada gente al
// techo de 500 (26%). El 2 deja suelo y techo en su sitio.
const REF_PCTL       = 0.02;
const MIN_REF_ROWS   = 8;    // filas elegibles mínimas para exigir elegibilidad
const MIN_REF_LAPS   = 10;
const MIN_REF_PILOTS = 3;    // una sesión de 1-2 pilotos no fija la referencia

// Referencia de la propia sesión. Es la vía principal: agrupar por ritmo no
// separa trazado de lluvia (Henakart tiene tres recorridos a 36s, 42s y 51s, y
// los saltos entre ellos —12% y 19%— caen dentro del rango en que la lluvia
// infla los tiempos). Da igual: para puntuar, trazado distinto y lluvia son lo
// mismo — la referencia de un piloto tiene que ser el ritmo alcanzable en las
// condiciones en que rodó. Ese ritmo es el extremo rápido de su propia parrilla.
// Cubre el 88-100% de las filas según circuito; el resto cae al grupo.
const SESSION_REF_PILOTS = 5;
const SESSION_REF_PCTL   = 0.10;

// Regularidad: dispersión ABSOLUTA de los gaps. Antes era un coeficiente de
// variación (desviación / media), que castigaba justo a los rápidos: al estar
// pegados a la referencia el divisor se hace diminuto y cualquier variación
// mínima dispara el coeficiente. Un piloto anclado en +10/+11/+12% sacaba ~150;
// otro en +1,2/+1,6/+2,7% —la misma variación real— sacaba 25.
const SPREAD_FULL = 0.03;

function _percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p))];
}

/**
 * Agrupa sesiones por trazado a partir de su ritmo representativo.
 * Corta la lista ordenada allí donde el salto relativo supera LAYOUT_SPLIT.
 *
 * @param {Object<string, number>} sessionPace  session_id → ritmo (ms)
 * @returns {Object<string, number>} session_id → índice de grupo
 */
function _groupSessionsByLayout(sessionPace) {
  const entries = Object.entries(sessionPace).sort((a, b) => a[1] - b[1]);
  const groupOf = {};
  let group = 0;
  for (let i = 0; i < entries.length; i++) {
    if (i > 0) {
      const prev = entries[i - 1][1];
      if (prev > 0 && (entries[i][1] - prev) / prev > LAYOUT_SPLIT) group++;
    }
    groupOf[entries[i][0]] = group;
  }
  return groupOf;
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

  // ── Sesiones: filas y nº de pilotos ──────────────────────────────────────
  const rowsBySession   = {};
  const pilotsPerSession = {};
  for (const r of validRows) {
    (rowsBySession[r.session_id] = rowsBySession[r.session_id] || []).push(r);
    pilotsPerSession[r.session_id] = (pilotsPerSession[r.session_id] || 0) + 1;
  }

  // ── Agrupación por trazado (ritmo = mediana de mejores vueltas) ───────────
  const sessionPace = {};
  for (const [sid, rs] of Object.entries(rowsBySession)) {
    const bests = rs.map(r => r.best_ms).sort((a, b) => a - b);
    sessionPace[sid] = bests[Math.floor(bests.length / 2)];
  }
  const groupOf    = _groupSessionsByLayout(sessionPace);
  const groupIds   = [...new Set(Object.values(groupOf))];
  const multiGroup = groupIds.length > 1;

  // ── Referencia de cada sesión con parrilla suficiente ────────────────────
  const sessionRef = {};
  for (const [sid, rs] of Object.entries(rowsBySession)) {
    const eligible = rs.filter(r => r.laps >= MIN_REF_LAPS);
    if (eligible.length < SESSION_REF_PILOTS) continue;
    sessionRef[sid] = _percentile(
      eligible.map(r => r.best_ms).sort((a, b) => a - b), SESSION_REF_PCTL);
  }

  // ── Por grupo: lluvia + referencia de ritmo ──────────────────────────────
  const wetSessions = new Set();
  const refByGroup  = {};   // grupo → referencia de ritmo (ms)
  const rowsByGroup = {};   // grupo → filas secas

  for (const g of groupIds) {
    const groupRows = validRows.filter(r => groupOf[r.session_id] === g);

    // Lluvia: relativa al propio grupo, nunca al circuito entero
    const pace = {};
    for (const r of groupRows) {
      if (!pace[r.session_id]) pace[r.session_id] = { sum: 0, laps: 0 };
      pace[r.session_id].sum  += r.avg_ms * r.laps;
      pace[r.session_id].laps += r.laps;
    }
    const avgs = Object.entries(pace)
      .filter(([, d]) => d.laps >= 5)
      .map(([sid, d]) => ({ session_id: parseInt(sid), avg: d.sum / d.laps }))
      .sort((a, b) => a.avg - b.avg);
    const dryRef = avgs.length ? avgs[Math.floor(avgs.length * 0.25)].avg : null;
    if (dryRef) {
      for (const s of avgs) {
        if (s.avg / dryRef > WET_THRESHOLD) wetSessions.add(s.session_id);
      }
    }

    const dry = groupRows.filter(r => !wetSessions.has(r.session_id));
    const pool = dry.length ? dry : groupRows;
    rowsByGroup[g] = pool;

    // Referencia: percentil bajo sobre las filas que pueden fijarla
    const eligible = pool.filter(r =>
      r.laps >= MIN_REF_LAPS && pilotsPerSession[r.session_id] >= MIN_REF_PILOTS);
    const source = eligible.length >= MIN_REF_ROWS ? eligible : pool;
    refByGroup[g] = _percentile(source.map(r => r.best_ms).sort((a, b) => a - b), REF_PCTL);
  }

  // Un grupo minoritario (pocas filas) no da una referencia creíble: sus filas
  // no puntúan pace. Solo aplica si de verdad hay varios trazados.
  const scorableGroup = {};
  for (const g of groupIds) {
    scorableGroup[g] = !multiGroup || rowsByGroup[g].length >= MIN_CLUSTER_ROWS;
  }

  // Referencia aplicable a una fila: la de su sesión si la parrilla daba para
  // calcularla; si no, la del grupo, y ahí sí hay que descartar la lluvia
  // (la referencia del grupo se calculó con sesiones secas).
  function _refFor(r) {
    if (sessionRef[r.session_id] != null) return sessionRef[r.session_id];
    if (wetSessions.has(r.session_id)) return null;
    const g = groupOf[r.session_id];
    return scorableGroup[g] ? refByGroup[g] : null;
  }

  // ── Ranking dentro de cada sesión (para el componente de posición) ────────
  // Se ordena la parrilla completa: dentro de una sesión todos corrieron en las
  // mismas condiciones, llueva o no.
  const bySession = {};
  for (const r of validRows) {
    if (!bySession[r.session_id]) bySession[r.session_id] = [];
    bySession[r.session_id].push(r);
  }
  for (const sid of Object.keys(bySession)) {
    bySession[sid].sort((a, b) => a.best_ms - b.best_ms);
  }

  // ── Agregar por piloto ───────────────────────────────────────────────────
  const pilotMap = {};
  for (const r of validRows) {
    const key = r.name.trim();
    if (!pilotMap[key]) pilotMap[key] = { name: key, sessions: [], total_laps: 0 };
    const rank  = bySession[r.session_id];
    const pos   = rank.findIndex(x => x.name === r.name) + 1;
    const g     = groupOf[r.session_id];
    const ref   = _refFor(r);
    pilotMap[key].sessions.push({
      best_ms: r.best_ms, laps: r.laps, position: pos, total: rank.length,
      group: g, reference_ms: ref,
      gap: ref ? (r.best_ms - ref) / ref : null,
    });
    pilotMap[key].total_laps += r.laps;
  }

  const results = [];

  for (const p of Object.values(pilotMap)) {
    const n_sessions = p.sessions.length;
    const total_laps = p.total_laps;
    const scorable   = p.sessions.filter(s => s.gap != null);

    // Mejor actuación = menor gap relativo a la referencia de SU trazado
    // (comparar mejores vueltas en bruto no significa nada entre trazados).
    const bestSession = scorable.length
      ? scorable.reduce((a, b) => (b.gap < a.gap ? b : a))
      : null;
    const pilot_best  = bestSession ? bestSession.best_ms
                                    : Math.min(...p.sessions.map(s => s.best_ms));

    if (total_laps < MIN_LAPS || !bestSession) {
      results.push({
        name: p.name, score: null, tier: 'Sin datos',
        pace_score: null, position_score: null, consistency_score: null,
        pilot_best_ms: pilot_best,
        circuit_record_ms: bestSession ? bestSession.reference_ms : null,
        gap_to_record_pct: null, session_count: n_sessions, total_laps,
        layout_group: bestSession ? bestSession.group : null,
        layout_count: groupIds.length,
      });
      continue;
    }

    // Componente 1: Pace (0-500)
    const pace_raw   = bestSession.gap;
    const pace_score = Math.round(
      Math.min(1, Math.max(0, 1 - pace_raw / PACE_FLOOR)) * 500);

    // Componente 2: Posición (0-300)
    const compSessions = p.sessions.filter(s => s.total >= 5);
    let position_score = 150;
    if (compSessions.length > 0) {
      const avgPct = compSessions.reduce((sum, s) =>
        sum + (1 - (s.position - 1) / Math.max(1, s.total - 1)), 0
      ) / compSessions.length;
      position_score = Math.round(avgPct * 300);
    }

    // Componente 3: Consistencia (0-200) — mitad mejor de sesiones puntuables
    let consistency_score = 100;
    if (scorable.length >= 2) {
      // Mitad mejor, pero nunca menos de dos sesiones: la dispersión de un
      // único valor es cero, y con 2-3 sesiones eso regalaba el máximo.
      const paces = scorable
        .map(s => s.gap)
        .sort((a, b) => a - b)
        .slice(0, Math.max(2, Math.ceil(scorable.length / 2)));
      const mean   = paces.reduce((a, b) => a + b, 0) / paces.length;
      const stddev = Math.sqrt(paces.reduce((a, b) => a + (b - mean) ** 2, 0) / paces.length);
      // Dispersión absoluta: cuánto varía el piloto, no cuánto varía en
      // proporción a lo cerca que está de la referencia.
      consistency_score = Math.round(
        Math.min(1, Math.max(0, 1 - stddev / SPREAD_FULL)) * 200);
    }

    results.push({
      name: p.name,
      score: null,
      raw_score: pace_score + position_score + consistency_score,
      pace_score,
      position_score,
      consistency_score,
      pilot_best_ms:     pilot_best,
      circuit_record_ms: bestSession.reference_ms,
      gap_to_record_pct: Math.round(pace_raw * 1000) / 10,
      session_count:     n_sessions,
      total_laps,
      layout_group:      bestSession.group,
      layout_count:      groupIds.length,
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

module.exports = { computePilotRatings, _groupSessionsByLayout };
