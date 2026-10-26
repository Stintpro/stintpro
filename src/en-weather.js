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
      if (typeof mm !== 'number' || t + SLOT_MS <= nowMs || t > nowMs + 60 * 60 * 1000) continue;
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

  function createWeather() { return null; }   // la implementa la Task 4

  return {
    buildUrl, rainRisk, rainByLapTimes, lineFor, createWeather,
    MM_RAIN_NOW, MM_RISK, PROB_HIGH, PROB_MED, SLOT_MS, POLL_MS, STALE_MS, TIMEOUT_MS,
  };
});
