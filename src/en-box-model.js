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
    // strategic null = sin reloj de carrera: no se sabe si sobran paradas, así
    // que ni caza ni parada anticipada (gastarías una que el stint máx exige).
    const unknownStops = p.strategic == null && p.totalStops > 0;
    const free = !unknownStops && (p.strategic > 0 || p.totalStops === 0);
    const lateEnough = p.stintPct >= 30 || (p.raceRemMin != null && p.raceRemMin < p.stintMaxMin * 1.5);
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
    if (q === 'bad' && unknownStops)
      return r('📊', 'var(--state-warn)', `Kart malo · <b>Sin reloj de carrera</b> — no se sabe si te sobra alguna parada para cambiar de kart`);
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

  // Filas del box en columnas para pintarlo. Se reparten por PESO acumulado, no
  // por número de tarjetas: un kart al 50% ocupa medio hueco. Contar tarjetas
  // abría filas que no existen en la pista (2×2 con 8 entradas pintaba 4 filas).
  // Cada kart va a la fila donde empieza su peso, así la fila 1 coincide con
  // accessibleZone.
  function rowsByWeight(queue, cols) {
    const n = Math.max(1, cols || 2);
    const rows = [];
    let cum = 0;
    for (const k of queue) {
      const r = Math.floor((cum + 1e-9) / n);
      (rows[r] = rows[r] || []).push(k);
      cum += weight(k);
    }
    return rows.filter(Boolean);
  }

  // Salida de un equipo: devuelve una cola NUEVA (no muta la original).
  function applyPitOut(queue, type, cols) {
    return pitOutWithCut(queue, type, cols).queue;
  }

  // Igual que applyPitOut, pero además devuelve cuánto se restó a cada kart
  // (id → peso): es lo que luego corrige resolvePending con el ritmo del rival.
  function pitOutWithCut(queue, type, cols) {
    const q0 = queue.map(k => (k.id ? k : { ...k, id: newId() }));
    const zone = accessibleZone(q0, type, cols);
    const zoneTotal = zone.reduce((a, z) => a + z.share, 0);
    if (zoneTotal <= 0) return { queue: q0, cut: {} };
    const take = Math.min(1, zoneTotal);
    const cut = {};
    zone.forEach(z => { cut[z.k.id] = z.share / zoneTotal * take; });
    const after = q0.map(k => cut[k.id] != null ? { ...k, w: weight(k) - cut[k.id] } : k);
    return { queue: prune(after), cut };
  }

  // Inferencia por ritmo: en batería/columnas no sabemos qué kart se llevó un
  // rival, así que se restó "un poco de cada uno". Cuando su kart nuevo ya tiene
  // calidad (vueltas posteriores al intercambio), se rehace esa resta pesando
  // cada candidato por lo compatible que es con lo observado:
  //   misma calidad → 1 · desconocido → 0.4 · otra calidad → 0.1
  // (no cero: la clasificación de calidad puede equivocarse). Se conserva la
  // masa: solo cambia DE QUIÉN se restó. Consume el pendiente.
  const LIKE_SAME = 1, LIKE_UNKNOWN = 0.4, LIKE_OTHER = 0.1;
  function resolvePending(queue, pending, dorsal, observed) {
    const d = String(dorsal);
    const p = pending && pending[d];
    if (!p || !(observed === 'good' || observed === 'neutral' || observed === 'bad')) return queue.slice();
    delete pending[d];
    const like = (k) => k.quality === observed ? LIKE_SAME
      : (k.quality === 'good' || k.quality === 'neutral' || k.quality === 'bad') ? LIKE_OTHER : LIKE_UNKNOWN;
    const present = queue.filter(k => k.id && p.cut[k.id] != null);
    const tot = present.reduce((a, k) => a + p.cut[k.id], 0);
    const norm = present.reduce((a, k) => a + p.cut[k.id] * like(k), 0);
    if (tot <= 1e-9 || norm <= 1e-9) return queue.slice();
    // Se deshace la resta original (cap = peso si no se le hubiera restado) y se
    // vuelve a restar `tot` repartido por compatibilidad. Reparto por turnos
    // ("water-filling"): lo que un kart no puede dar —se quedaría <0, porque
    // intercambios posteriores ya le restaron— pasa a los demás. Así la masa se
    // conserva aunque haya muchos intercambios solapados (olas).
    const cap = new Map(present.map(k => [k.id, weight(k) + p.cut[k.id]]));
    const take = new Map(present.map(k => [k.id, Math.max(0, cap.get(k.id) - 1)])); // no pasar de 1
    let rest = tot - [...take.values()].reduce((a, b) => a + b, 0);
    let open = present.filter(k => cap.get(k.id) - take.get(k.id) > 1e-12);
    for (let it = 0; it < 50 && rest > 1e-12 && open.length; it++) {
      const pw = open.reduce((a, k) => a + p.cut[k.id] * like(k), 0);
      if (pw <= 1e-12) break;
      let spill = 0;
      const next = [];
      open.forEach(k => {
        const want = rest * p.cut[k.id] * like(k) / pw;
        const room = cap.get(k.id) - take.get(k.id);
        if (want >= room) { take.set(k.id, take.get(k.id) + room); spill += want - room; }
        else { take.set(k.id, take.get(k.id) + want); next.push(k); }
      });
      rest = spill;
      open = next;
    }
    const after = queue.map(k => cap.has(k.id)
      ? { ...k, w: Math.min(1, Math.max(0, cap.get(k.id) - take.get(k.id))) } : k);
    return prune(after);
  }

  // Quita los restos (<5%) sin perder masa: su peso se reparte entre los que
  // quedan según el hueco de cada uno hasta 1 (un kart no puede pesar más de 1),
  // para que el tamaño de la reserva no se vaya encogiendo.
  function prune(queue) {
    const kept = queue.filter(k => weight(k) >= MIN_W);
    const lost = queue.reduce((a, k) => a + (weight(k) >= MIN_W ? 0 : weight(k)), 0);
    const room = kept.reduce((a, k) => a + (1 - weight(k)), 0);
    if (lost < 1e-9 || room <= 1e-9) return kept;
    const f = Math.min(1, lost / room);
    return kept.map(k => weight(k) < 1 ? { ...k, w: weight(k) + (1 - weight(k)) * f } : k);
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
  // uno de la zona accesible. Se ordenan por minuto aquí (el llamante las pasa
  // por posición) y cada paso es el mismo intercambio que boxOnPitEvent:
  // primero se lleva uno de la zona y luego deja el suyo al final.
  function forecast(queue, type, cols, predictions) {
    let q = queue.slice();
    const steps = [];
    const ordered = predictions.slice().sort((a, b) => (a.minLeft ?? Infinity) - (b.minLeft ?? Infinity));
    for (const p of ordered) {
      const qual = p.quality === 'good' || p.quality === 'neutral' || p.quality === 'bad' ? p.quality : 'unknown';
      q = pitOutWithCut(q, type, cols).queue.concat([{ quality: qual, dorsal: p.dorsal, name: p.name }]);
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

  // Tiempo de carrera que queda, o null si no se puede saber. Cuenta atrás →
  // lo que marca; ascendente → duración configurada − transcurrido.
  //   clock → { synced, countUp, remainingMs } (en ascendente remainingMs es lo transcurrido)
  function raceRemainingMs(clock, raceDurMs) {
    if (!clock || !clock.synced || clock.remainingMs == null) return null;
    if (!clock.countUp) return Math.max(0, clock.remainingMs);
    if (!(raceDurMs > 0)) return null;
    return Math.max(0, raceDurMs - clock.remainingMs);
  }

  // Plan de paradas de MI equipo, el mismo para Estrategia y Mi equipo.
  // standsCount de Apex manda (correcto aunque conectes tarde); el historial
  // local es el respaldo. raceRemMs null = sin reloj → estratégicas desconocidas
  // (null), nunca "todas libres". stintMaxMs null/0 = sin stint máximo.
  function stopPlan(p) {
    const stopsDone = p.standsCount > 0 ? p.standsCount : (p.histLen || 0);
    const stopsRemaining = p.totalStops > 0 ? Math.max(0, p.totalStops - stopsDone) : 0;
    const hasMax = p.stintMaxMs > 0;
    const pitMs = p.pitMs || 0;
    let minNec, strategic;
    if (!hasMax) { minNec = stopsRemaining; strategic = 0; }
    else if (p.raceRemMs == null) { minNec = null; strategic = null; }
    else {
      minNec = p.raceRemMs > 0 ? stopsNeeded(p.raceRemMs, p.stintMaxMs, p.stintElapsedMs, pitMs) : 0;
      strategic = p.totalStops > 0 ? Math.max(0, stopsRemaining - minNec) : 0;
    }
    // Duración media de los stints que quedan (el actual completo + los nuevos).
    const avgStintMin = p.raceRemMs == null ? null
      : Math.round(Math.max(0, p.raceRemMs - stopsRemaining * pitMs + (p.stintElapsedMs || 0)) / (stopsRemaining + 1) / 60000);
    return { stopsDone, stopsRemaining, minNec, strategic, avgStintMin };
  }

  // ¿Apurar el stint máximo? trackTimeMin ya incluye lo que queda del stint en
  // curso, así que apurar consume solo lo que falta hasta el máximo, no un
  // stint máximo entero. canPush null = no aplica (sin máximo o sin paradas).
  function pushCheck(p) {
    if (!(p.stintMaxM > 0 && p.stintMaxM < 999) || !(p.stopsLeft > 0)) return { canPush: null, afterPushAvg: null, pushLeftMin: null };
    const pushLeftMin = Math.max(0, p.stintMaxM - (p.stintElapsedMin || 0));
    const afterPushAvg = (p.trackTimeMin - pushLeftMin) / p.stopsLeft;
    return { canPush: afterPushAvg >= (p.stintMinM || 0), afterPushAvg, pushLeftMin };
  }

  // Una parada es un INTERCAMBIO: el equipo se lleva un kart de la zona
  // accesible y deja el suyo al final, así que la reserva no cambia de tamaño.
  // El intercambio se hace en el PIT IN: desde que entra, el kart que se llevará
  // ya está comprometido por su orden de llegada, aunque físicamente lo coja al
  // salir. Antes la cola sumaba en el si y restaba en el so: en una ola de 15
  // paradas de 3 min con 10 de reserva marcaba 25 karts disponibles.
  // El so solo intercambia si no se vio el si de esa parada (conexión a mitad).
  //   swapped → mapa dorsal → true mientras la parada en curso ya intercambió.
  //   ev      → { dorsal, kind:'in'|'out'|'track', quality, name, time }
  //             'track' = el kart vuelve a rodar: cierra la parada (Apex a veces
  //             salta del si a en pista sin mandar so).
  //   pending → (opcional) mapa dorsal → { cut, lapIdx, time }: en batería/columnas
  //             guarda cuánto se restó a cada kart para corregirlo después con
  //             el ritmo del rival (resolvePending). ev.lapIdx = nº de vueltas
  //             del rival en el intercambio (las del kart nuevo van detrás).
  function boxOnPitEvent(queue, swapped, ev, type, cols, pending) {
    const d = String(ev.dorsal);
    // De vuelta en pista: la parada terminó aunque no se viera el so.
    if (ev.kind === 'track') { delete swapped[d]; return queue.slice(); }
    if (ev.kind === 'in' && swapped[d]) return queue.slice();
    if (ev.kind === 'out' && swapped[d]) { delete swapped[d]; return queue.slice(); }
    const q = ev.quality === 'good' || ev.quality === 'neutral' || ev.quality === 'bad' ? ev.quality : 'unknown';
    const out = pitOutWithCut(queue, type, cols);
    if (pending) {
      if (type !== 'line' && Object.keys(out.cut).length > 1) pending[d] = { cut: out.cut, lapIdx: ev.lapIdx, time: ev.time };
      else delete pending[d];
    }
    const next = out.queue
      .concat([{ id: newId(), quality: q, dorsal: ev.dorsal, name: ev.name, time: ev.time,
        // Foto del stint que DEJÓ el kart: tras el cambio, los datos en vivo de
        // ese dorsal ya son de su kart nuevo y de otro piloto.
        team: ev.team || null, pilot: ev.pilot || null,
        stintBest: (ev.stintBest > 0) ? ev.stintBest : null }]);
    if (ev.kind === 'in') swapped[d] = true;
    return next;
  }

  // ── Reserva, desincronización y reset ─────────────────────────────────────
  // Id estable por kart de la cola: sobrevive a las copias ({...k}) que hacen
  // applyPitOut/prune y permite referirse a él más tarde (inferencia por ritmo).
  let _seq = 0;
  function newId() { return 'k' + (++_seq).toString(36) + Date.now().toString(36); }

  function makeReserve(n, time) {
    return Array.from({ length: Math.max(0, n | 0) },
      () => ({ id: newId(), quality: 'unknown', dorsal: '?', time: time || Date.now() }));
  }

  // Con "parada = intercambio" la cola siempre pesa lo que la reserva
  // configurada. Si se aleja más de medio kart, algo se perdió (paradas no
  // vistas, reconexiones, cambio de "Karts" a mitad) → aviso + reset.
  function queueDrift(queue, reserve) {
    const total = queue.reduce((a, k) => a + weight(k), 0);
    return { total, reserve, drift: reserve > 0 && Math.abs(total - reserve) >= 0.5 };
  }

  // Rehace la cola con la reserva N:
  //   'unknown'  → N desconocidos (no te fías de nada de lo que había)
  //   'keepLast' → los últimos N karts por peso (los devueltos más recientes; el
  //                más antiguo se recorta si hace falta) y desconocidos delante
  //                si no llegan a N.
  function resetQueue(queue, n, mode) {
    if (mode !== 'keepLast') return makeReserve(n);
    const kept = [];
    let sum = 0;
    for (let i = queue.length - 1; i >= 0 && sum < n - 1e-9; i--) {
      const k = queue[i];
      const w = Math.min(weight(k), n - sum);
      kept.unshift(w < weight(k) ? { ...k, w } : k);
      sum += w;
    }
    // Relleno con desconocidos hasta pesar justo N: si falta una fracción,
    // el primero (el más antiguo) lleva solo esa fracción.
    const missing = n - sum;
    const pad = Math.ceil(missing - 1e-9);
    const fill = makeReserve(pad);
    if (pad > 0) {
      const frac = missing - (pad - 1);
      if (frac < 1 - 1e-9) fill[0].w = frac;
    }
    return fill.concat(kept);
  }

  // Equipos en boxes cuya parada ya hizo el intercambio: su kart está asignado
  // aunque no hayan salido. Explica por qué en plena ola el box "parece lleno"
  // y la probabilidad no sube.
  function committedCount(eq, swapped) {
    if (!swapped || !eq) return 0;
    return eq.filter(e => e.pit && swapped[String(e.dorsal)]).length;
  }

  // Box en línea: el kart que te toca si entras ahora (el primero, ya descontados
  // los intercambios de quien entró antes que tú).
  function nextKartLine(queue) {
    return queue.length ? queue[0] : null;
  }

  // Modelo de una TARJETA del box (incremento 1 del Tablero de Box). Decide solo
  // las cosas no-presentacionales; el score, colores y formato de tiempos los pone
  // en-strategy.js con sus helpers. `k` = item de la cola {dorsal,name,quality};
  // `kart` = entrada de `eq` que casa por dorsal (o null si es reserva sin dato).
  // opts: { myDorsal, isNextOut }.
  function boxCardVM(k, kart, opts) {
    opts = opts || {};
    const dorsalStr = (k && k.dorsal != null) ? String(k.dorsal).trim() : '';
    const isUnknown = !dorsalStr || dorsalStr === '?' || (k && k.quality === 'unknown');
    const myD = opts.myDorsal != null ? String(opts.myDorsal).trim() : '';
    const isMe = !!(myD && dorsalStr && dorsalStr === myD);
    const name = isUnknown ? null : ((k && k.name) || (kart && kart.name) || null);
    // El equipo no cambia con el kart: vale el dato en vivo como respaldo. El
    // piloto y la vuelta rápida SOLO del stint guardado (en vivo ya son de otro).
    const team = isUnknown ? null : ((k && k.team) || (kart && kart.teamName) || name);
    const pilotRaw = isUnknown ? null : ((k && k.pilot) || null);
    const pilot = (pilotRaw && pilotRaw !== team) ? pilotRaw : null;
    return {
      dorsal: isUnknown ? '?' : dorsalStr,
      name,
      team,
      pilot,
      stintBest: (!isUnknown && k && k.stintBest > 0) ? k.stintBest : null,
      quality: (k && k.quality) || 'unknown',
      isMe,
      isUnknown,
      hasData: !!kart && !isUnknown,
      isNextOut: !!opts.isNextOut,
    };
  }

  // Emoji de calidad que acompaña al color de la tarjeta (se lee sin color).
  const QUALITY_EMOJI = { good: '🚀', neutral: '🚗', bad: '🐢', unknown: '🎲' };
  function qualityEmoji(q) { return QUALITY_EMOJI[q] || QUALITY_EMOJI.unknown; }

  // Vuelta rápida de un stint (segundos). Fuera vueltas de box/bandera (≥180 s)
  // y cortes imposibles (<70% de la mediana), como _enCleanLaps.
  function stintBest(laps) {
    const ok = (laps || []).filter(t => typeof t === 'number' && t > 0 && t < 180);
    if (!ok.length) return null;
    const sorted = ok.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const clean = sorted.filter(t => t >= median * 0.7);
    return clean.length ? clean[0] : null;
  }

  // Disposición de las tarjetas según el tipo de box (hace de diagrama):
  //   línea    → una columna (solo sale el de arriba)
  //   batería  → una fila (sorteo entre todos)
  //   columnas → rejilla de N columnas, una fila por fila del box (por peso)
  // Cada item lleva su índice en la cola (0 = próximo en salir).
  function boxLayout(queue, type, cols) {
    const items = queue.map((k, i) => ({ k, i }));
    if (type === 'columns') {
      const n = Math.max(1, cols || 2);
      let i = 0;
      const rows = rowsByWeight(queue, n).map(r => r.map(k => ({ k, i: i++ })));
      return { kind: 'grid', cols: n, rows };
    }
    if (type === 'battery') return { kind: 'row', cols: items.length, rows: [items] };
    return { kind: 'column', cols: 1, rows: items.map(it => [it]) };
  }

  // ── Box como REJILLA FIJA de sitios ─────────────────────────────────────────
  // El box tiene siempre los karts configurados: C columnas, cada una una fila
  // india (FIFO). Los tres tipos son la misma rejilla:
  //   línea    → 1 columna de N
  //   columnas → C columnas de N/C (las primeras N%C llevan uno más)
  //   batería  → N columnas de 1
  // Parada (intercambio): se sortea una columna, el equipo se lleva su primer
  // kart, la columna AVANZA y el kart que deja entra al FINAL de esa columna.
  // Como no sabemos qué columna salió, cada sitio guarda la probabilidad de
  // cada kart que puede estar ahí (marginal por sitio, exacta: el sitio es una
  // mezcla de "avanzó" (π) y "no avanzó" (1−π)). El tamaño nunca cambia.
  // El estado se puede rehacer siempre desde base + registro de eventos: así un
  // cambio de configuración o lo que revela el ritmo del rival recalculan todo.
  const SLOT_MIN_P = 0.02;

  function gridDims(type, n, cols) {
    n = Math.max(1, n | 0 || 1);
    if (type === 'battery') return Array(n).fill(1);
    if (type === 'columns') {
      const C = Math.max(1, Math.min(cols | 0 || 2, n));
      const base = Math.floor(n / C), extra = n % C;
      return Array.from({ length: C }, (_, c) => base + (c < extra ? 1 : 0));
    }
    return [n];
  }

  // Orden de llenado/lectura: fila a fila (profundidad), columna a columna.
  function fillOrder(lens) {
    const out = [];
    const R = Math.max(...lens);
    for (let d = 0; d < R; d++) for (let c = 0; c < lens.length; c++) if (d < lens[c]) out.push([c, d]);
    return out;
  }

  function mixDist(a, wa, b, wb) {
    const m = new Map();
    if (wa > 0) for (const [id, p] of a) m.set(id, (m.get(id) || 0) + p * wa);
    if (wb > 0) for (const [id, p] of b) m.set(id, (m.get(id) || 0) + p * wb);
    return normDist([...m.entries()]);
  }
  function normDist(d) {
    let kept = d.filter(([, p]) => p >= SLOT_MIN_P);
    if (!kept.length && d.length) kept = [d.reduce((x, y) => (y[1] > x[1] ? y : x))];
    const t = kept.reduce((a, [, p]) => a + p, 0);
    return kept.map(([id, p]) => [id, p / t]).sort((x, y) => y[1] - x[1]);
  }

  // Un paso sobre los sitios (puro). ev:
  //   {t:'swap', item, pi?}  intercambio; pi[c] = prob. de que saliera la columna c
  //   {t:'fix', c, d, id}    "este kart está aquí" (corrección manual)
  //   {t:'move', c, d, dir}  intercambia el sitio con el de arriba/abajo de su columna
  function stepSlots(slots, ev) {
    const C = slots.length;
    if (ev.t === 'swap') {
      const pi = (ev.pi && ev.pi.length === C) ? ev.pi : Array(C).fill(1 / C);
      return slots.map((col, c) => {
        const q = pi[c] || 0;
        if (q <= 0) return col;
        return col.map((slot, d) => (d < col.length - 1)
          ? mixDist(col[d + 1], q, slot, 1 - q)
          : mixDist([[ev.item.id, 1]], q, slot, 1 - q));
      });
    }
    if (ev.t === 'fix') {
      return slots.map((col, c) => col.map((slot, d) => {
        if (c === ev.c && d === ev.d) return [[ev.id, 1]];
        const rest = slot.filter(([id]) => id !== ev.id);
        return rest.length ? normDist(rest) : slot;
      }));
    }
    if (ev.t === 'move') {
      const col = slots[ev.c];
      if (!col) return slots;
      const j = ev.dir === 'up' ? ev.d - 1 : ev.d + 1;
      if (j < 0 || j >= col.length || ev.d < 0 || ev.d >= col.length) return slots;
      const nc = col.slice(); const t = nc[ev.d]; nc[ev.d] = nc[j]; nc[j] = t;
      return slots.map((x, c) => (c === ev.c ? nc : x));
    }
    return slots;
  }

  function buildSlots(lens, base) {
    const slots = lens.map(len => Array.from({ length: len }, () => []));
    fillOrder(lens).forEach(([c, d], i) => { slots[c][d] = [[base[i], 1]]; });
    return slots;
  }

  // Crea el box. baseItems (opcional, del más antiguo al más reciente) ocupan
  // los últimos sitios; delante, reserva desconocida hasta completar N.
  function gridCreate(type, n, cols, baseItems, time) {
    const lens = gridDims(type, n, cols);
    const N = lens.reduce((a, b) => a + b, 0);
    const given = (baseItems || []).slice(-N);
    const items = {};
    const base = makeReserve(N - given.length, time).concat(given).map(it => { items[it.id] = it; return it.id; });
    return { type, n: N, cols, lens, items, base, log: [], slots: buildSlots(lens, base) };
  }

  function replay(B, lens, base, log) {
    let slots = buildSlots(lens, base);
    for (const ev of log) slots = stepSlots(slots, ev);
    return { ...B, lens, base, log, slots };
  }

  // Aplica un evento y lo registra.
  function gridEvent(B, ev) {
    if (ev.t === 'swap') B = { ...B, items: { ...B.items, [ev.item.id]: ev.item } };
    return { ...B, log: B.log.concat([ev]), slots: stepSlots(B.slots, ev) };
  }

  // Cambio de configuración (tipo, karts o columnas): misma base + registro sobre
  // la rejilla nueva. Si cambia N, la base se recorta por delante o se completa
  // con reserva desconocida.
  function gridRetopo(B, type, n, cols) {
    const lens = gridDims(type, n, cols);
    const N = lens.reduce((a, b) => a + b, 0);
    let base = B.base.slice(-N);
    const items = { ...B.items };
    if (base.length < N) base = makeReserve(N - base.length).map(it => { items[it.id] = it; return it.id; }).concat(base);
    const log = B.log.filter(ev => ev.t === 'swap'); // fix/move se refieren a la rejilla vieja
    return replay({ ...B, type, n: N, cols, items }, lens, base, log);
  }

  // Parada vista en el feed (misma semántica que boxOnPitEvent: intercambio en
  // el pit in; el so solo intercambia si no se vio el si; volver a pista cierra).
  function gridOnPitEvent(B, swapped, ev, pending) {
    const d = String(ev.dorsal);
    if (ev.kind === 'track') { delete swapped[d]; return B; }
    if (ev.kind === 'in' && swapped[d]) return B;
    if (ev.kind === 'out' && swapped[d]) { delete swapped[d]; return B; }
    const q = ev.quality === 'good' || ev.quality === 'neutral' || ev.quality === 'bad' ? ev.quality : 'unknown';
    const item = { id: newId(), quality: q, dorsal: ev.dorsal, name: ev.name, time: ev.time,
      team: ev.team || null, pilot: ev.pilot || null, stintBest: (ev.stintBest > 0) ? ev.stintBest : null };
    const multi = B.lens.length > 1;
    const out = gridEvent(B, { t: 'swap', item, dorsal: d, pending: multi });
    if (pending) {
      if (multi) pending[d] = { lapIdx: ev.lapIdx, time: ev.time };
      else delete pending[d];
    }
    if (ev.kind === 'in') swapped[d] = true;
    return out;
  }

  // Inferencia por ritmo: el kart nuevo del rival ya tiene calidad → se rehace
  // el sorteo de SU intercambio pesando cada columna por lo compatible que es su
  // primer kart con lo observado, y se recalcula todo lo posterior.
  function gridResolve(B, pending, dorsal, observed) {
    const d = String(dorsal);
    if (pending) delete pending[d];
    if (!(observed === 'good' || observed === 'neutral' || observed === 'bad')) return B;
    let idx = -1;
    for (let i = B.log.length - 1; i >= 0; i--) {
      const ev = B.log[i];
      if (ev.t === 'swap' && ev.pending && ev.dorsal === d) { idx = i; break; }
    }
    if (idx < 0) return B;
    let before = buildSlots(B.lens, B.base);
    for (let i = 0; i < idx; i++) before = stepSlots(before, B.log[i]);
    const like = (it) => !it ? LIKE_UNKNOWN : it.quality === observed ? LIKE_SAME
      : (it.quality === 'good' || it.quality === 'neutral' || it.quality === 'bad') ? LIKE_OTHER : LIKE_UNKNOWN;
    const L = before.map(col => col[0].reduce((a, [id, p]) => a + p * like(B.items[id]), 0));
    const tot = L.reduce((a, b) => a + b, 0);
    const pi = tot > 1e-9 ? L.map(x => x / tot) : null;
    const log = B.log.slice();
    log[idx] = { ...log[idx], pi, pending: false };
    return replay(B, B.lens, B.base, log);
  }

  // Reinicio: N desconocidos, o los últimos N karts que entraron (más antiguo
  // delante) completados con desconocidos.
  function gridReset(B, n, mode) {
    if (mode !== 'keepLast') return gridCreate(B.type, n, B.cols);
    const seen = new Set(); const last = [];
    for (let i = B.log.length - 1; i >= 0; i--) {
      const ev = B.log[i];
      if (ev.t === 'swap' && !seen.has(ev.item.id)) { seen.add(ev.item.id); last.unshift(ev.item); }
    }
    return gridCreate(B.type, n, B.cols, last);
  }

  // Mismo resultado que accessProb, sobre la rejilla: la zona accesible son los
  // primeros sitios de cada columna (sorteo uniforme entre columnas).
  function gridAccess(B) {
    const sum = { good: 0, neutral: 0, bad: 0, unknown: 0 };
    for (const col of B.slots) for (const [id, p] of col[0]) {
      const q = (B.items[id] || {}).quality;
      sum[q === 'good' || q === 'neutral' || q === 'bad' ? q : 'unknown'] += p;
    }
    const total = sum.good + sum.neutral + sum.bad + sum.unknown;
    const known = total - sum.unknown;
    return { prob: known > 1e-9 ? Math.round(sum.good / known * 100) : null,
      knownShare: total > 0 ? known / total : 0, zoneTotal: total, ...sum };
  }

  function gridForecast(B, predictions) {
    let slots = B.slots; const items = { ...B.items };
    const steps = [];
    const ordered = predictions.slice().sort((a, b) => (a.minLeft ?? Infinity) - (b.minLeft ?? Infinity));
    for (const p of ordered) {
      const qual = p.quality === 'good' || p.quality === 'neutral' || p.quality === 'bad' ? p.quality : 'unknown';
      const item = { id: newId(), quality: qual, dorsal: p.dorsal, name: p.name };
      items[item.id] = item;
      slots = stepSlots(slots, { t: 'swap', item });
      steps.push({ ...p, prob: gridAccess({ ...B, slots, items }).prob });
    }
    return { now: gridAccess(B).prob, steps };
  }

  // Lista plana compatible con la cola de antes: cada kart con w = probabilidad
  // de estar en el box (suma = N), en orden de salida esperado.
  function gridPresence(B) {
    const acc = new Map();
    fillOrder(B.lens).forEach(([c, d], i) => {
      for (const [id, p] of B.slots[c][d]) {
        const a = acc.get(id) || { w: 0, pos: 0 };
        a.w += p; a.pos += p * i; acc.set(id, a);
      }
    });
    return [...acc.entries()]
      .map(([id, a]) => ({ ...B.items[id], w: a.w, _pos: a.pos / a.w }))
      .sort((x, y) => x._pos - y._pos)
      .map(({ _pos, ...k }) => k);
  }

  // Lo que pinta un sitio: un kart seguro, o los candidatos con su %.
  const SLOT_SURE = 0.95;
  function slotVM(B, c, d) {
    const dist = (B.slots[c] && B.slots[c][d]) || [];
    // Las reservas sin dato son indistinguibles: se agrupan en una sola entrada.
    const cands = [];
    let reserve = null;
    for (const [id, p] of dist) {
      const item = B.items[id];
      if (!item) continue;
      if (String(item.dorsal) === '?') {
        if (reserve) reserve.p += p; else cands.push(reserve = { item, p });
      } else cands.push({ item, p });
    }
    cands.sort((a, b) => b.p - a.p);
    return { c, d, sure: cands.length && cands[0].p >= SLOT_SURE ? cands[0].item : null, candidates: cands };
  }

  // Corrección manual (incremento 2): mover un kart de la cola por su id.
  // dir: 'up'/'down' (un puesto) o 'front'/'back' (extremos). El índice 0 es el
  // próximo en salir (extremo SALE); 'up' acerca a SALE, 'down' a ENTRA.
  // Devuelve un array NUEVO; si el id no está o el movimiento no aplica, el
  // mismo array (por referencia) para que el llamante pueda detectar "sin cambio".
  function moveInQueue(queue, id, dir) {
    const i = queue.findIndex(k => k && k.id === id);
    if (i < 0) return queue;
    const arr = queue.slice();
    if (dir === 'up' || dir === 'down') {
      const j = dir === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= arr.length) return queue;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      return arr;
    }
    if (dir === 'front' || dir === 'back') {
      const j = dir === 'front' ? 0 : arr.length - 1;
      if (j === i) return queue;
      const [item] = arr.splice(i, 1);
      arr.splice(j, 0, item);
      return arr;
    }
    return queue;
  }

  return { raceRemainingMs, stopPlan, pushCheck, committedCount, nextKartLine, boxCardVM, qualityEmoji, stintBest, boxLayout, moveInQueue,
    gridDims, gridCreate, gridEvent, gridRetopo, gridOnPitEvent, gridResolve, gridReset, gridAccess, gridForecast, gridPresence, slotVM, resolvePending, makeReserve, queueDrift, resetQueue, boxOnPitEvent, isMine, raceAnchor, rivalStintStart, trackRivalPitOut, poolLabel, tacticalAdvice,
    weight, accessibleZone, rowsByWeight, applyPitOut, accessProb, forecast, stopsNeeded };
});
