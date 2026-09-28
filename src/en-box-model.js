// ── en-box-model.js — lógica pura de la pestaña Estrategia (box, rivales, táctica) ──
// Funciona en browser (window.EnBoxModel) y Node.js (module.exports).
// Sin DOM ni globals: todo entra por parámetros para poder testearlo
// (tests/box-model.test.js). en-strategy.js solo pinta lo que sale de aquí.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EnBoxModel = api;
})(typeof window !== 'undefined' ? window : this, function () {

  // ¿Es este kart el mío? Compara como texto (Apex manda dorsales como string
  // o número según circuito; el input de config siempre es string).
  function isMine(e, myDorsal) {
    const my = (myDorsal == null ? '' : String(myDorsal)).trim();
    if (!my || !e || e.dorsal == null) return false;
    return String(e.dorsal).trim() === my;
  }

  // Instante de salida de la carrera, estable a lo largo de la sesión (ancla del
  // primer stint de los rivales). A diferencia de EnStintMachine.raceStintStart
  // —que decide CUÁNDO arrancar mi timer y devuelve "now" en ciertos casos—, esto
  // solo devuelve un ancla si es reconstruible con certeza:
  //   1) salida oficial (verde com|), o
  //   2) cuenta atrás regresiva + duración configurada: now − (duración − restante).
  // En otro caso null: mejor no mostrar countdown que mostrar uno inventado.
  function raceAnchor(clock, raceStart, raceDurMs, now) {
    if (raceStart && raceStart.at && now - raceStart.at >= 0 && now - raceStart.at < 24 * 3600 * 1000) {
      return raceStart.at;
    }
    if (clock && clock.synced && !clock.countUp && raceDurMs > 0) {
      const rem = clock.remainingMs;
      if (rem != null && rem > 0 && rem <= raceDurMs) return now - (raceDurMs - rem);
    }
    return null;
  }

  // Inicio del stint en curso de un rival.
  //   pitOut → EnSession.rivalPitOut[dorsal]: número = salida observada,
  //            null = está/estuvo en pit sin salida aún, undefined = nunca visto en pit.
  //   stops  → paradas oficiales (standsCount) o contadas.
  // Nunca visto en pit y 0 paradas = sigue en su primer stint → ancla de carrera.
  // Nunca visto en pit pero con paradas = paró antes de conectar → desconocido.
  function rivalStintStart(pitOut, stops, anchor) {
    if (typeof pitOut === 'number') return pitOut;
    if (pitOut === undefined && !(stops > 0) && anchor) return anchor;
    return null;
  }

  // Actualiza EnSession.rivalPitOut con el estado de un kart en este tick.
  // Solo registra salidas OBSERVADAS: antes se ponía "now" a cualquier kart en
  // pista sin registro, y los rivales en su primer stint aparecían recién salidos
  // al conectar. Tras un pit in (null), la vuelta a pista cuenta como salida
  // aunque Apex se salte el estado 'out'.
  function trackRivalPitOut(map, e, now) {
    const d = e.dorsal;
    if (e.pitState === 'in') { map[d] = null; return; }
    if (e.pitState === 'out' && typeof map[d] !== 'number') { map[d] = now; return; }
    if (!e.pit && map[d] === null) map[d] = now;
  }

  function poolLabel(prob) {
    return prob == null ? 'sin datos' : prob + '%';
  }

  // Árbol de la recomendación táctica. probAcceso null = sin datos de box: las
  // reglas que dependen del pool no se aplican (antes llegaba -1 y salía
  // "pool bajo (-1%) → espera").
  function tacticalAdvice(p) {
    const q = p.myQuality;
    const pool = p.probAcceso;
    const known = pool != null;
    const P = poolLabel(pool);
    const free = p.strategic > 0 || p.totalStops === 0;
    const lateEnough = p.stintPct >= 30 || p.raceRemMin < p.stintMaxMin * 1.5;
    const r = (icon, color, html) => ({ icon, color, html });

    if (!p.canPit) {
      if (q === 'bad') return r('🔴', 'var(--state-alert)', `Kart malo pero stint mínimo no cumplido — <b>faltan ${p.stintMinLeft} min para poder parar</b>`);
      if (q === 'good') return r('🏎', 'var(--state-ok)', `Kart bueno · Stint mínimo en ${p.stintMinLeft} min → <b>Aprovecha el kart</b>`);
      return r('🔴', 'var(--state-warn)', `Stint mínimo no cumplido — <b>faltan ${p.stintMinLeft} min</b>`);
    }
    if (known) {
      if (q === 'good' && p.strategic > 0 && lateEnough && pool >= 70)
        return r('💎', '#c084fc', `Kart bueno (${p.stintPct}% stint) + pool excelente (${P}) + parada extra → <b>Considerar parada anticipada para asegurar stint y medio con kart top</b>`);
      if (q === 'good' && p.strategic > 0 && lateEnough && pool >= 40)
        return r('🤔', '#60a5fa', `Kart bueno (${p.stintPct}% stint) + pool favorable (${P}) → <b>Valorar parada anticipada</b>`);
      if (q === 'bad' && free && pool >= 25)
        return r('🎯', 'var(--state-ok)', `Kart malo + pool ${P} → <b>Oportunidad de caza</b>`);
      if (q === 'bad' && free && pool < 25 && p.bestFutureProb >= 25)
        return r('⏳', 'var(--state-warn)', `Kart malo + pool bajo (${P}) pero sube a ${p.bestFutureProb}% en ${p.bestFutureMin} → <b>Espera ${p.bestFutureMin}</b>`);
      if (q === 'bad' && free && pool < 25)
        return r('⏳', 'var(--state-warn)', `Kart malo + pool bajo (${P}) → <b>Espera mejor momento</b>`);
    }
    if (q === 'bad' && p.strategic === 0 && p.totalStops > 0)
      return r('😤', 'var(--state-alert)', `Kart malo + sin paradas extra → <b>Apura stint, no puedes cazar</b>`);
    if (q === 'bad' && !known)
      return r('📊', 'var(--state-alert)', `Kart malo · <b>Sin datos de box</b> — no se puede valorar un cambio de kart`);
    if (known && q === 'good' && p.worstFutureProb < pool - 10)
      return r('🏎', 'var(--state-ok)', `Kart bueno → <b>Apura stint máximo</b> (pool empeora en ${p.worstFutureMin})`);
    if (q === 'good')
      return r('🏎', 'var(--state-ok)', `Kart bueno → <b>Apura stint máximo, exprímelo</b>`);
    if (known && q === 'neutral' && pool >= 40)
      return r('🤔', '#60a5fa', `Kart neutro + pool favorable (${P}) → <b>Valorar parada táctica</b>`);
    if (known && q === 'neutral' && pool < 25 && p.bestFutureProb >= 40)
      return r('⏳', '#60a5fa', `Kart neutro + pool sube a ${p.bestFutureProb}% en ${p.bestFutureMin} → <b>Espera y valora</b>`);
    const box = known ? `Pool ${P}` : 'Sin datos de box';
    if (q === 'bad') return r('📊', 'var(--state-alert)', `Kart malo · ${box}`);
    if (q === 'neutral') return r('📊', 'var(--state-warn)', `Kart neutro · ${box}`);
    return r('📊', '#9ca3af', `${box} · Kart ${q || 'sin info'}`);
  }

  // ── Cola del box con pesos ──────────────────────────────────────────────
  // Cada kart de la cola lleva un peso w ∈ (0,1]: la probabilidad de que siga
  // en el box (sin w = 1). Cuando un equipo sale no sabemos QUÉ kart se llevó
  // salvo en línea, así que se resta 1 kart en valor esperado, repartido
  // uniformemente por la zona accesible:
  //   línea    → la primera unidad de peso (el primero de la cola)
  //   columnas → las primeras N unidades (fila 1, sorteo entre columnas)
  //   batería  → toda la cola (sorteo entre TODOS)
  // Línea = columnas con N=1; batería = columnas con N=∞. Una sola regla.
  const MIN_W = 0.05;

  function weight(k) { return k && k.w != null ? k.w : 1; }

  function zoneSize(type, cols) {
    if (type === 'line') return 1;
    if (type === 'columns') return Math.max(1, cols || 2);
    return Infinity; // battery
  }

  // Parte del peso de cada kart que cae dentro de la zona accesible.
  function accessibleZone(queue, type, cols) {
    const size = zoneSize(type, cols);
    const out = [];
    let cum = 0;
    for (const k of queue) {
      const w = weight(k);
      const share = Math.max(0, Math.min(cum + w, size) - cum);
      if (share > 1e-9) out.push({ k, share });
      cum += w;
      if (cum >= size) break;
    }
    return out;
  }

  // Salida de un equipo: devuelve una cola NUEVA (no muta la original).
  function applyPitOut(queue, type, cols) {
    const zone = accessibleZone(queue, type, cols);
    const zoneTotal = zone.reduce((a, z) => a + z.share, 0);
    if (zoneTotal <= 0) return queue.slice();
    const take = Math.min(1, zoneTotal);
    const cut = new Map(zone.map(z => [z.k, z.share / zoneTotal * take]));
    return queue
      .map(k => cut.has(k) ? { ...k, w: weight(k) - cut.get(k) } : k)
      .filter(k => weight(k) >= MIN_W);
  }

  // Probabilidad de que te toque un kart BUENO si sales ahora. Los desconocidos
  // no cuentan como malos: la estimación se hace sobre los conocidos de la zona
  // y knownShare dice qué parte de la zona es conocida (aviso de datos parciales).
  function accessProb(queue, type, cols) {
    const zone = accessibleZone(queue, type, cols);
    const sum = { good: 0, neutral: 0, bad: 0, unknown: 0 };
    zone.forEach(z => {
      const q = z.k.quality;
      sum[q === 'good' || q === 'neutral' || q === 'bad' ? q : 'unknown'] += z.share;
    });
    const total = sum.good + sum.neutral + sum.bad + sum.unknown;
    const known = total - sum.unknown;
    return {
      prob: known > 1e-9 ? Math.round(sum.good / known * 100) : null,
      knownShare: total > 0 ? known / total : 0,
      zoneTotal: total,
      ...sum,
    };
  }

  // Previsión: cada rival que para deja su kart al final de la cola y sale con
  // uno de la zona accesible. predictions en el orden en que van a parar.
  function forecast(queue, type, cols, predictions) {
    let q = queue.slice();
    const steps = [];
    for (const p of predictions) {
      const qual = p.quality === 'good' || p.quality === 'neutral' || p.quality === 'bad' ? p.quality : 'unknown';
      q = applyPitOut(q.concat([{ quality: qual, dorsal: p.dorsal, name: p.name }]), type, cols);
      steps.push({ ...p, prob: accessProb(q, type, cols).prob });
    }
    return { now: accessProb(queue, type, cols).prob, steps };
  }

  // Paradas que el stint máximo te OBLIGA a hacer de aquí a meta: el stint
  // actual puede llegar hasta el máximo; cada parada consume reloj (pitMs) y da
  // otro stint máximo. null si falta el stint máximo o el reloj.
  function stopsNeeded(raceRemMs, stintMaxMs, stintElapsedMs, pitMs) {
    if (!(stintMaxMs > 0) || !(raceRemMs > 0)) return null;
    const rest = raceRemMs - Math.max(0, stintMaxMs - (stintElapsedMs || 0));
    if (rest <= 0) return 0;
    return Math.ceil(rest / (stintMaxMs + (pitMs || 0)));
  }

  return { isMine, raceAnchor, rivalStintStart, trackRivalPitOut, poolLabel, tacticalAdvice,
    weight, accessibleZone, applyPitOut, accessProb, forecast, stopsNeeded };
});
