// Vercel Serverless Function — StintPro Race Report
// Compone el resumen de carrera de UN kart en UNA sesión, listo para la
// tarjeta de Instagram. Habla servidor-a-servidor con el logger (VPS) para
// que la API key NUNCA viaje al navegador. Reusa endpoints ya existentes:
//   GET /api/sessions            → catálogo de sesiones
//   GET /api/laps/:sessionId     → vueltas de TODOS los karts (dorsal, lap_time_ms, timestamp)
//   GET /api/pits/:sessionId     → eventos de pit
//
// La POSICIÓN no se guarda en la BD: se DERIVA aquí a partir de los cruces de
// meta (nº de vueltas completadas + instante del cruce = orden de carrera).
//
// Rutas:
//   GET /api/report?list=1                     → lista de sesiones con vueltas
//   GET /api/report?session=ID                 → karts disponibles en la sesión
//   GET /api/report?session=ID&kart=DORSAL     → informe completo del kart

const LOGGER_URL = (process.env.LOGGER_URL || 'https://stintpro.duckdns.org').replace(/\/$/, '');
const LOGGER_API_KEY = process.env.LOGGER_API_KEY || '';

async function loggerGet(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const headers = {};
    if (LOGGER_API_KEY) headers['x-api-key'] = LOGGER_API_KEY;
    const r = await fetch(`${LOGGER_URL}${path}`, { headers, signal: controller.signal });
    if (!r.ok) throw new Error(`logger ${path} → ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

const norm = s => String(s == null ? '' : s).trim();

// Un "dorsal" >= 1000 es en realidad un identificador interno de Apex (nº de
// transponder), no un dorsal de carrera. Aparece en sesiones grabadas sin la
// columna 'no' del grid (competición federada; ver fix del logger). El informe
// no los ofrece ni genera tarjetas por ellos: no son dorsales reales.
const isTransponder = d => { const n = parseInt(d, 10); return Number.isFinite(n) && n >= 1000; };

// progressAt: nº de cruces de meta de un kart hasta el instante t (inclusive)
function makeProgress(times) {
  // times: array ascendente de timestamps de cruce
  return t => {
    let lo = 0, hi = times.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid + 1; else hi = mid; }
    return lo; // nº de cruces con ts <= t
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const q = req.query || {};

  try {
    // ── 1) Catálogo de sesiones ──────────────────────────────────────────
    if (q.list) {
      const sessions = await loggerGet('/api/sessions');
      const out = (sessions || [])
        .filter(s => (s.lap_count || 0) > 0)
        .map(s => ({
          id: s.id,
          title: s.title || null,
          circuit: s.circuit_name || s.slug,
          slug: s.slug,
          startedAt: s.started_at || null,
          lapCount: s.lap_count || 0,
        }));
      return res.status(200).json({ sessions: out });
    }

    const sessionId = parseInt(q.session);
    if (isNaN(sessionId)) return res.status(400).json({ error: 'Falta ?session=ID' });

    const [sessions, laps, pits, snapshot] = await Promise.all([
      loggerGet('/api/sessions'),
      loggerGet(`/api/laps/${sessionId}`),
      loggerGet(`/api/pits/${sessionId}`).catch(() => []),
      loggerGet(`/api/snapshot/${sessionId}`).catch(() => null),
    ]);
    const session = (sessions || []).find(s => s.id === sessionId) || {};
    // Clasificación oficial de Apex (autoritativa) por dorsal, si hay snapshot.
    const official = new Map();
    if (snapshot && Array.isArray(snapshot.equipos)) {
      for (const e of snapshot.equipos) official.set(norm(e.dorsal), e);
    }
    const fieldFromSnap = snapshot && Array.isArray(snapshot.equipos) ? snapshot.equipos.length : 0;
    const snapTitle = snapshot ? [snapshot.title1, snapshot.title2].filter(Boolean).join(' · ') : '';

    // Agrupar cruces por dorsal (ya vienen ordenados por timestamp asc)
    const byKart = new Map();
    for (const l of laps || []) {
      const d = norm(l.dorsal);
      if (!d) continue;
      if (!byKart.has(d)) byKart.set(d, { dorsal: d, laps: [] });
      const k = byKart.get(d);
      k.laps.push({ ms: l.lap_time_ms, t: l.timestamp, n: l.lap_number });
    }

    // ── 2) Karts disponibles ─────────────────────────────────────────────
    // Solo dorsal + nº de vueltas: sin nombre de piloto ni de equipo
    // (protección de datos — la identificación es siempre por dorsal).
    if (!q.kart) {
      const all = [...byKart.values()].map(k => ({ dorsal: k.dorsal, laps: k.laps.length }));
      // Ocultar los transponders: no son dorsales de carrera, no se ofrecen.
      const karts = all.filter(k => !isTransponder(k.dorsal))
        .sort((a, b) => (parseInt(a.dorsal) || 999) - (parseInt(b.dorsal) || 999));
      return res.status(200).json({
        session: { id: sessionId, title: session.title || null, circuit: session.circuit_name || session.slug },
        karts,
        hiddenAnomalous: all.length - karts.length,
      });
    }

    // ── 3) Informe completo de un kart ───────────────────────────────────
    if (isTransponder(q.kart)) {
      return res.status(422).json({ error: `El dorsal ${q.kart} es un identificador interno (transponder), no un dorsal de carrera. Esta sesión se grabó sin los dorsales reales, así que no se puede generar un informe fiable por dorsal.` });
    }
    const target = byKart.get(norm(q.kart));
    if (!target) {
      const anom = [...byKart.keys()].filter(isTransponder).length;
      const hint = anom > 0 ? ' Esta sesión se grabó con identificadores internos (transponders) en vez de dorsales de carrera.' : '';
      return res.status(404).json({ error: `El kart ${q.kart} no está en esta sesión.${hint}` });
    }

    // t0 = primer cruce de la sesión (eje de minutos)
    let t0 = Infinity;
    for (const k of byKart.values()) for (const l of k.laps) if (l.t && l.t < t0) t0 = l.t;
    if (!isFinite(t0)) t0 = target.laps[0]?.t || 0;

    // Precomputar timestamps por kart (rival) para derivar posición
    const rivals = [...byKart.values()].map(k => ({
      dorsal: k.dorsal,
      times: k.laps.map(l => l.t).filter(Boolean),
    }));
    rivals.forEach(r => { r.times.sort((a, b) => a - b); r.progressAt = makeProgress(r.times); });

    const targetTimes = target.laps.map(l => l.t).filter(Boolean).sort((a, b) => a - b);

    // Serie de tiempos por vuelta (segundos) + marca de pit (vueltas largas)
    const PIT_MS = 120000;
    const lapSeries = [];
    for (const l of target.laps) {
      if (!l.ms || !l.t) continue;
      const s = l.ms / 1000;
      if (s < 15 || s > 900) continue; // saneo básico
      lapSeries.push({ min: +((l.t - t0) / 60000).toFixed(2), s: +s.toFixed(3), pit: l.ms >= PIT_MS });
    }

    // Serie de posición: en cada cruce del kart objetivo
    const posSeries = [];
    targetTimes.forEach((t, i) => {
      const myProg = i + 1; // vueltas completadas por mí en t
      let ahead = 0;
      for (const r of rivals) {
        if (r.dorsal === target.dorsal) continue;
        const p = r.progressAt(t);
        if (p > myProg) ahead++;
        else if (p === myProg && r.times[p - 1] < t) ahead++; // mismo nº de vueltas, cruzó antes
      }
      const pos = ahead + 1;
      const min = +((t - t0) / 60000).toFixed(2);
      if (!posSeries.length || posSeries[posSeries.length - 1].pos !== pos) posSeries.push({ min, pos });
    });

    // Estadísticas (ritmo/mejor desde vueltas; posición/nº vueltas/paradas
    // prefieren la clasificación OFICIAL del snapshot de Apex si existe)
    const off = official.get(target.dorsal) || null;
    const racing = lapSeries.filter(l => !l.pit).map(l => l.s).sort((a, b) => a - b);
    const median = racing.length ? racing[Math.floor(racing.length / 2)] : null;
    const clean = median ? racing.filter(s => s < median * 1.08) : racing;
    const avg = clean.length ? clean.reduce((a, s) => a + s, 0) / clean.length : null;
    const bestLap = (off && off.bestLap >= 20 && off.bestLap < 300) ? off.bestLap
                    : (racing.length ? racing[0] : null);

    const totalLaps = (off && off.tours > 0) ? off.tours : target.laps.length;
    const fieldSize = fieldFromSnap || byKart.size;

    // Posición final: la oficial de Apex manda; la derivada es el respaldo.
    const derivedFinal = posSeries.length ? posSeries[posSeries.length - 1].pos : null;
    const finalPos = (off && off.pos > 0 && off.pos !== 99) ? off.pos : derivedFinal;
    // Anclar el final del trazado a la posición oficial (que la gráfica no
    // contradiga el número grande de la tarjeta).
    if (finalPos != null && posSeries.length && posSeries[posSeries.length - 1].pos !== finalPos) {
      const lastMin = posSeries[posSeries.length - 1].min;
      posSeries.push({ min: lastMin, pos: finalPos });
    }
    const posOnly = posSeries.map(p => p.pos);
    const bestPos = posOnly.length ? Math.min(...posOnly) : null;
    const worstPos = posOnly.length ? Math.max(...posOnly) : null;

    // Paradas: oficial (standsCount/stops) → eventos de pit → vueltas largas
    const dorsalPits = (pits || []).filter(p => norm(p.dorsal) === target.dorsal);
    let stops = Math.max(off ? (off.standsCount || 0) : 0, off ? (off.stops || 0) : 0);
    if (!stops) stops = dorsalPits.filter(p => /in|si|entry/i.test(norm(p.event_type))).length;
    if (!stops) stops = lapSeries.filter(l => l.pit).length;

    return res.status(200).json({
      session: {
        id: sessionId,
        title: session.title || snapTitle || null,
        circuit: session.circuit_name || session.slug || null,
        startedAt: session.started_at || t0 || null,
        durationMin: lapSeries.length ? lapSeries[lapSeries.length - 1].min : null,
      },
      // Solo dorsal — sin nombre de piloto ni de equipo (protección de datos).
      kart: { dorsal: target.dorsal },
      stats: { finalPos, fieldSize, bestLap, avg: avg ? +avg.toFixed(3) : null, totalLaps, stops, bestPos, worstPos },
      lapSeries,
      posSeries,
    });
  } catch (e) {
    return res.status(502).json({ error: 'No se pudo generar el informe', detail: String(e.message || e) });
  }
};
