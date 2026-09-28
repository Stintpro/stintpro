// ── en-pit-windows.js — motor de ventanas de parada y detección de olas ──
// Lógica pura de la pestaña Estrategia + pestaña Olas (Wave Detection). Sin DOM
// ni globals: todo entra por parámetros para poder testearlo
// (tests/pit-windows.test.js). Lo consumen: en-strategy.js (Karts en pista),
// en-wave.js (olas) y el KPI "Próxima ola" de en-grid.js — un solo cálculo,
// tres consumidores.
// Funciona en browser (window.EnPitWindows) y Node.js (module.exports).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EnPitWindows = api;
})(typeof window !== 'undefined' ? window : this, function () {

  const MIN = 60 * 1000;
  const NO_MAX = 999 * MIN; // centinela: "sin stint máximo configurado"

  // Techo real del stint de un rival = como TARDE puede seguir en pista.
  // Sin deuda de paradas es el stint máximo; cuando la deuda aprieta (le quedan
  // paradas y poco reloj), el techo cae para que las paradas pendientes quepan
  // con el stint mínimo. Réplica exacta de rivalStintCapMs (en-strategy.js).
  //   techo = elapsed + T_restante − paradas_pendientes × (parada + stint_mín)
  function stintCapMs(elapsedMs, standsCount, ctx) {
    const { stintMaxMs, stintMinMs, pitDurationMs, totalStops, remainingMs } = ctx;
    if (stintMaxMs >= NO_MAX) return stintMaxMs;
    if (!totalStops || remainingMs <= 0 || !(standsCount > 0)) return stintMaxMs;
    const stopsLeft = Math.max(0, totalStops - standsCount);
    if (stopsLeft <= 0) return stintMaxMs;
    const cap = (elapsedMs || 0) + remainingMs - stopsLeft * (pitDurationMs + stintMinMs);
    return Math.max(0, Math.min(stintMaxMs, cap));
  }

  // Ventana de parada de un rival a partir de su tiempo de stint transcurrido.
  // rival: { dorsal, name, quality, elapsedMs (null=desconocido), standsCount }
  // Devuelve los campos que hoy calcula en-strategy.js (_stintRemaining, _minLeft,
  // _canPitNow, _minUntilCanPit, _debtLimited) más el dato de entrada útil.
  function computeWindow(rival, ctx) {
    const { stintMaxMs, stintMinMs } = ctx;
    const elapsedMs = (rival.elapsedMs == null) ? null : rival.elapsedMs;
    const capMs = stintCapMs(elapsedMs || 0, rival.standsCount, ctx);
    const debtLimited = capMs < stintMaxMs * 0.97; // techo real por debajo del máximo
    const hasMax = stintMaxMs < NO_MAX;
    const remainingMs = (elapsedMs !== null && hasMax) ? Math.max(0, capMs - elapsedMs) : Infinity;
    const minLeft = remainingMs < Infinity ? Math.ceil(remainingMs / MIN) : null;
    const canPitNow = (elapsedMs !== null && stintMinMs > 0) ? elapsedMs >= stintMinMs : null;
    const minUntilCanPit = (canPitNow === false) ? Math.ceil((stintMinMs - elapsedMs) / MIN) : null;
    return {
      dorsal: rival.dorsal,
      name: rival.name,
      quality: rival.quality || 'unknown',
      inPit: !!rival.pit,
      elapsedMs,
      capMs,
      remainingMs,
      minLeft,
      canPitNow,
      minUntilCanPit,
      debtLimited,
    };
  }

  // Aplica computeWindow a una lista de rivales (ya sin mi kart).
  function computeWindows(rivals, ctx) {
    return (rivals || []).map(r => computeWindow(r, ctx));
  }

  const _emptyComp = () => ({ good: 0, neutral: 0, bad: 0, unknown: 0 });

  // Agrupa ventanas en "olas": clusters de rivales cuyas paradas caen juntas.
  // Agrupación voraz por minLeft (tiempo hasta que TIENE que parar): se abre un
  // cluster con el más inminente y se le añaden los que estén dentro de
  // bandwidthMin de ese primero. Ola = cluster de ≥minSize (por defecto 3): con
  // menos equipos no se considera ola y va sin color. Los que no forman ola son
  // "singletons". Excluye a los que están en boxes (ya paran) y a los sin minLeft.
  function detectWaves(windows, opts) {
    const bandwidthMin = (opts && opts.bandwidthMin) || 5;
    const minSize = (opts && opts.minSize) || 3;
    const elig = (windows || [])
      .filter(w => !w.inPit && w.minLeft != null && w.minLeft >= 0)
      .slice()
      .sort((a, b) => a.minLeft - b.minLeft);

    const waves = [];
    const singletons = [];
    const used = new Array(elig.length).fill(false);

    for (let i = 0; i < elig.length; i++) {
      if (used[i]) continue;
      const cluster = [elig[i]];
      used[i] = true;
      for (let j = i + 1; j < elig.length; j++) {
        if (used[j]) continue;
        if (elig[j].minLeft - elig[i].minLeft <= bandwidthMin) { cluster.push(elig[j]); used[j] = true; }
      }
      if (cluster.length >= minSize) {
        const composition = _emptyComp();
        cluster.forEach(k => { composition[k.quality] = (composition[k.quality] || 0) + 1; });
        waves.push({
          earliestMin: cluster[0].minLeft,
          latestMin: cluster[cluster.length - 1].minLeft,
          count: cluster.length,
          composition,
          karts: cluster,
        });
      } else {
        cluster.forEach(k => singletons.push(k));
      }
    }
    waves.sort((a, b) => a.earliestMin - b.earliestMin);
    return { waves, singletons };
  }

  // La ola más inminente, para el KPI de cabecera. null si no hay ninguna.
  function nextWave(waves) {
    if (!waves || waves.length === 0) return null;
    const w = waves[0];
    return { earliestMin: w.earliestMin, latestMin: w.latestMin, count: w.count, composition: w.composition };
  }

  return { stintCapMs, computeWindow, computeWindows, detectWaves, nextWave, NO_MAX };
});
