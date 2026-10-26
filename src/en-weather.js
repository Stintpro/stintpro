// ── en-weather.js — riesgo de lluvia (Open-Meteo) para el KPI «Media pista» ──
// Apex no manda meteo (wth1-3 vacías), así que se pide a Open-Meteo por las
// coordenadas del circuito (CircuitDB.coordsOf). La lluvia de chubasco falla por
// km y por 30-60 min: se muestra como RIESGO en una ventana, nunca como minuto
// exacto, y se confirma con la subida de tiempos del pelotón (rainByLapTimes, la
// misma regla que la alerta de lluvia de en-ai-alerts.js).
// Parte pura (tests/weather.test.js) + instancia con estado (createWeather).
// Funciona en browser (window.EnWeatherCore / window.EnWeather) y Node.js.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EnWeatherCore = api; root.EnWeather = api.createWeather(); }
})(typeof window !== 'undefined' ? window : this, function () {
  const MM_RAIN_NOW = 0.1;   // mm en el tramo actual → "lloviendo"
  const MM_RISK = 0.2;       // mm en un tramo futuro → riesgo
  const PROB_HIGH = 60;      // % de la hora en curso → riesgo alto
  const PROB_MED = 30;       // % de la hora en curso → riesgo medio
  const SLOT_MS = 15 * 60 * 1000;
  const POLL_MS = 10 * 60 * 1000;
  const STALE_MS = 30 * 60 * 1000;
  const TIMEOUT_MS = 10 * 1000;
  const LAP_RISE_S = 1.5, LAP_BASE_MIN_MS = 9 * 60 * 1000, LAP_KEEP_MS = 15 * 60 * 1000;
  const API = 'https://api.open-meteo.com/v1/forecast';
  const COLOR = { rain: '#60a5fa', medium: '#fbbf24', stale: 'var(--text-3)' };

  function buildUrl(lat, lon) {
    return API + '?latitude=' + lat + '&longitude=' + lon +
      '&minutely_15=precipitation&hourly=precipitation_probability' +
      '&forecast_minutely_15=12&past_minutely_15=1&forecast_hours=3' +
      '&timeformat=unixtime&timezone=UTC';
  }

  function rainRisk(data, nowMs) {
    const out = { level: null, etaMin: null, slots: [], probNextHour: null };
    const m = data && data.minutely_15, h = data && data.hourly;
    if (!m || !Array.isArray(m.time) || !Array.isArray(m.precipitation)) return out;
    for (let i = 0; i < m.time.length; i++) {
      const t = m.time[i] * 1000, mm = m.precipitation[i];
      if (!Number.isFinite(t) || typeof mm !== 'number' || t + SLOT_MS <= nowMs || t > nowMs + 60 * 60 * 1000) continue;
      out.slots.push({ t, mm });
    }
    if (h && Array.isArray(h.time) && Array.isArray(h.precipitation_probability)) {
      for (let i = 0; i < h.time.length; i++) {
        const t = h.time[i] * 1000, p = h.precipitation_probability[i];
        if (t <= nowMs && nowMs < t + 60 * 60 * 1000 && typeof p === 'number') out.probNextHour = p;
      }
    }
    const cur = out.slots.find(s => s.t <= nowMs);
    const first = out.slots.find(s => s.t > nowMs && s.mm >= MM_RAIN_NOW);
    if (first) out.etaMin = Math.max(5, Math.round((first.t - nowMs) / 60000 / 5) * 5);
    const risky = (fromMin, toMin) => out.slots.some(s => {
      const dt = (s.t - nowMs) / 60000;
      return s.mm >= MM_RISK && dt > fromMin && dt <= toMin;
    });
    const p = out.probNextHour;
    if (cur && cur.mm >= MM_RAIN_NOW) out.level = 'raining';
    else if (risky(0, 30) || (p != null && p >= PROB_HIGH)) out.level = 'high';
    else if (risky(30, 60) || (p != null && p >= PROB_MED)) out.level = 'medium';
    return out;
  }

  // Subida colectiva de tiempos: media de pista actual > 1,5 s por encima de la
  // muestra más antigua que tenga ≥ 9 min (quien llama guarda solo 15 min).
  function rainByLapTimes(history, nowMs, trackAvgS) {
    const no = { rising: false, deltaS: null, baselineAvg: null, baselineTs: null };
    if (!trackAvgS || !Array.isArray(history)) return no;
    const base = history.find(s => nowMs - s.ts >= LAP_BASE_MIN_MS);
    if (!base) return no;
    const deltaS = trackAvgS - base.avg;
    return { rising: deltaS > LAP_RISE_S, deltaS, baselineAvg: base.avg, baselineTs: base.ts };
  }

  const fmtS = v => v.toFixed(1).replace('.', ',');

  // Línea del KPI. Prioridad: tiempos subiendo > previsión > sin datos.
  function lineFor(cur) {
    const lap = cur && cur.lap, r = cur && cur.risk;
    if (lap && lap.rising) return { text: '🌧 Lloviendo · tiempos +' + fmtS(lap.deltaS) + ' s', color: COLOR.rain, kind: 'raining' };
    if (r && r.level === 'raining') return { text: '🌧 Lloviendo', color: COLOR.rain, kind: 'raining' };
    if (r && r.level === 'high') return { text: '🌧 Riesgo alto · ' + (r.etaMin != null ? '~' + r.etaMin + ' min' : 'próx. 30 min'), color: COLOR.rain, kind: 'high' };
    if (r && r.level === 'medium') return { text: '🌦 Riesgo medio · 30-60 min', color: COLOR.medium, kind: 'medium' };
    if (cur && cur.stale) return { text: 'meteo sin datos', color: COLOR.stale, kind: 'stale' };
    return null;
  }

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const hhmm = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

  // Instancia con estado: un circuito a la vez. tick() se llama en cada render del
  // panel (en-grid.js): guarda la media de pista y, si toca, lanza la consulta.
  // Como _enRender solo corre con el panel abierto, no hace falta start/stop.
  function createWeather(deps) {
    const d = Object.assign({
      fetch: typeof fetch === 'function' ? (u, o) => fetch(u, o) : null,
      now: () => Date.now(),
      isLive: () => typeof window !== 'undefined' && !!window.ApexConnector && window.ApexConnector !== window.ReplayConnector,
      // Bandera amarilla/roja o carrera parada: todo el pelotón va lento sin que llueva.
      neutralized: () => typeof EnSession !== 'undefined' && !!EnSession &&
        (EnSession.flag === 'yellow' || EnSession.flag === 'red' || !!EnSession.raceStopped),
      // Excluir dorsales/categorías de la media cambia trackAvg al instante.
      avgFilterKey: () => {
        if (typeof EnUi === 'undefined' || !EnUi) return '';
        const ks = o => Object.keys(o || {}).filter(k => o[k]).sort();
        return JSON.stringify([ks(EnUi.excludedFromAvg), ks(EnUi.excludedCategories)]);
      },
      coordsOf: slug => (typeof window !== 'undefined' && window.CircuitDB && window.CircuitDB.coordsOf) ? window.CircuitDB.coordsOf(slug) : null,
    }, deps || {});
    const st = { slug: null, since: 0, data: null, fetchedAt: 0, lastTryAt: 0, inFlight: false, error: null, avgHist: [], filterKey: null };

    function tick(slug, trackAvgS) {
      const now = d.now();
      if (slug !== st.slug) Object.assign(st, { slug, since: now, data: null, fetchedAt: 0, lastTryAt: 0, inFlight: false, error: null, avgHist: [], filterKey: null });
      // Neutralización: se vacía el historial y no se guardan muestras. La línea de
      // tiempos necesita ≥ 9 min de base, así que queda suprimida ~9-15 min tras
      // acabar la bandera. La previsión (risk) no se suprime.
      if (d.neutralized()) st.avgHist.length = 0;
      else if (trackAvgS) {
        const key = d.avgFilterKey();
        if (st.filterKey !== null && key !== st.filterKey) st.avgHist.length = 0;
        st.filterKey = key;
        st.avgHist.push({ ts: now, avg: trackAvgS });
        while (st.avgHist.length && now - st.avgHist[0].ts > LAP_KEEP_MS) st.avgHist.shift();
      }
      const c = d.coordsOf(slug);
      if (!c || !d.isLive() || !d.fetch || st.inFlight || (st.lastTryAt && now - st.lastTryAt < POLL_MS)) return null;
      st.inFlight = true; st.lastTryAt = now;
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
      return Promise.resolve()
        .then(() => d.fetch(buildUrl(c[0], c[1]), ctrl ? { signal: ctrl.signal } : undefined))
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(j => { if (slug === st.slug) { st.data = j; st.fetchedAt = d.now(); st.error = null; } })
        .catch(e => { if (slug === st.slug) st.error = (e && e.message) || String(e); })
        .then(() => { if (slug === st.slug) st.inFlight = false; if (timer) clearTimeout(timer); });
    }

    function current() {
      const now = d.now();
      const enabled = !!d.coordsOf(st.slug) && d.isLive();
      const fresh = !!st.data && now - st.fetchedAt <= STALE_MS;
      const lastAvg = st.avgHist.length ? st.avgHist[st.avgHist.length - 1].avg : null;
      return {
        enabled,
        risk: fresh && enabled ? rainRisk(st.data, now) : null,
        lap: rainByLapTimes(st.avgHist, now, lastAvg),
        stale: enabled && !fresh && now - Math.max(st.since, st.fetchedAt) > STALE_MS,
        fetchedAt: st.fetchedAt,
        error: st.error,
      };
    }

    function kpiLineHtml() {
      const cur = current();
      const line = lineFor(cur);
      if (!line) return '';
      const parts = [];
      if (cur.risk) {
        parts.push(cur.risk.slots.map(s => hhmm(s.t) + ' ' + fmtS(s.mm) + ' mm').join(' · '));
        if (cur.risk.probNextHour != null) parts.push('Probabilidad esta hora: ' + cur.risk.probNextHour + ' %');
      }
      if (cur.lap && cur.lap.deltaS != null) parts.push('Media de pista ' + (cur.lap.deltaS >= 0 ? '+' : '') + fmtS(cur.lap.deltaS) + ' s frente a hace ' + Math.round((d.now() - cur.lap.baselineTs) / 60000) + ' min');
      parts.push(cur.fetchedAt ? 'Actualizado ' + hhmm(cur.fetchedAt) : 'Sin previsión todavía');
      parts.push('Open-Meteo, cuadrícula ~1,5-9 km');
      return '<div class="sp-kpi-sub" style="color:' + line.color + ';margin-top:2px" title="' + esc(parts.join('\n')) + '">' + esc(line.text) + '</div>';
    }

    return { tick, current, kpiLineHtml, _state: st };
  }

  return {
    buildUrl, rainRisk, rainByLapTimes, lineFor, createWeather,
    MM_RAIN_NOW, MM_RISK, PROB_HIGH, PROB_MED, SLOT_MS, POLL_MS, STALE_MS, TIMEOUT_MS,
  };
});
