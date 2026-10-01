// ── en-track-pos.js — dónde va cada kart en pista (pestaña 🗺️ Pista) ──
// Lógica pura, sin DOM. No hay GPS en vivo: la posición se deduce del último
// pase por meta (lastLapAt) y del ritmo del kart, recorrida con el perfil de
// tiempo MEDIDO por GPS (src/tracks/<slug>.json, ver tools/track-from-gps.js)
// o con un óvalo de perfil lineal si el circuito no tiene trazado.
// Validado con la 7H Los Santos real: mediana 0,20 s · p90 0,66 s de error al
// prever cada pase (tests/track-pos-real.test.js).
// Funciona en browser (window.EnTrackPos) y Node.js (module.exports).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EnTrackPos = api;
})(typeof window !== 'undefined' ? window : this, function () {

  const wrap = x => { const f = x % 1; return f < 0 ? f + 1 : f; };

  function median(a) {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function quantile(a, q) {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(q * (s.length - 1))];
  }

  // ── Trazado ────────────────────────────────────────────────────────────────
  // points: polilínea a distancia uniforme, points[0] = meta, orden = sentido de
  // marcha. timeFrac[i]: fracción del tiempo de vuelta al llegar a points[i].

  function ovalTrack() {
    const N = 120, points = [], timeFrac = [];
    for (let i = 0; i < N; i++) {
      const a = 2 * Math.PI * i / N;
      points.push([500 + 420 * Math.sin(a), 330 - 280 * Math.cos(a)]);
      timeFrac.push(i / N);
    }
    return {
      slug: null, name: 'Óvalo', generic: true, lengthM: null,
      viewBox: { w: 1000, h: 660 }, widthUnits: 16, points, timeFrac,
      pitLane: null, approxProfile: false,
    };
  }

  // Perfil del sentido contrario: los mismos tramos recorridos al revés.
  function mirrorProfile(tf) {
    const n = tf.length, dt = [];
    for (let k = 0; k < n; k++) dt.push((k + 1 < n ? tf[k + 1] : 1) - tf[k]);
    const out = [0];
    for (let j = 1; j < n; j++) out.push(out[j - 1] + dt[n - j]);
    return out;
  }

  function monotonic(tf) {
    if (tf[0] !== 0) return false;
    for (let i = 1; i < tf.length; i++) if (!(tf[i] > tf[i - 1])) return false;
    return tf[tf.length - 1] < 1;
  }

  function loadTrack(json, direction) {
    try {
      if (!json || json.version !== 1 || !Array.isArray(json.points) || json.points.length < 8) return null;
      const n = json.points.length;
      const want = direction === 'inverso' ? 'inverso' : 'normal';
      const other = want === 'normal' ? 'inverso' : 'normal';
      const profs = json.profiles || {};
      let points = json.points.map(p => [Number(p[0]), Number(p[1])]);
      let pitLane = json.pitLane && Number.isFinite(json.pitLane.inFrac) && Number.isFinite(json.pitLane.outFrac)
        ? { inFrac: json.pitLane.inFrac, outFrac: json.pitLane.outFrac } : null;
      if (want === 'inverso') {
        // Al revés empezando en la meta; el pit lane cambia de extremo.
        points = [points[0], ...points.slice(1).reverse()];
        if (pitLane) pitLane = { inFrac: wrap(1 - pitLane.outFrac), outFrac: wrap(1 - pitLane.inFrac) };
      }
      let timeFrac = profs[want] && profs[want].timeFrac, approxProfile = false;
      if (!timeFrac && profs[other] && profs[other].timeFrac) { timeFrac = mirrorProfile(profs[other].timeFrac); approxProfile = true; }
      if (!timeFrac) { timeFrac = points.map((_, i) => i / n); approxProfile = true; }
      if (timeFrac.length !== n || !monotonic(timeFrac)) return null;
      return {
        slug: json.slug || null, name: json.name || json.slug || '', generic: false,
        lengthM: json.lengthM || null, viewBox: json.viewBox, widthUnits: json.widthUnits || 14,
        points, timeFrac, pitLane, approxProfile,
      };
    } catch (e) { return null; }
  }

  const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

  function pointAt(track, t) {
    const tf = track.timeFrac, P = track.points, n = P.length;
    t = wrap(t);
    let lo = 0, hi = n - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tf[m] <= t) lo = m; else hi = m - 1; }
    const tNext = lo + 1 < n ? tf[lo + 1] : 1;
    const k = tNext > tf[lo] ? (t - tf[lo]) / (tNext - tf[lo]) : 0;
    return lerp(P[lo], P[(lo + 1) % n], k);
  }

  function distToTime(track, d) {
    const tf = track.timeFrac, n = tf.length;
    const x = wrap(d) * n, i = Math.floor(x) % n, k = x - Math.floor(x);
    const tNext = i + 1 < n ? tf[i + 1] : 1;
    return tf[i] + (tNext - tf[i]) * k;
  }

  function pointAtDist(track, d) {
    const P = track.points, n = P.length;
    const x = wrap(d) * n, i = Math.floor(x) % n;
    return lerp(P[i], P[(i + 1) % n], x - Math.floor(x));
  }

  // Pit lane dibujado en paralelo a la pista, por el lado de FUERA, entre la
  // entrada (inFrac) y la salida (outFrac), cruzando la meta si hace falta.
  function pitLanePolyline(track, offset) {
    if (!track.pitLane) return null;
    const { inFrac, outFrac } = track.pitLane, M = 40;
    const span = wrap(outFrac - inFrac) || 1;
    const P = track.points;
    const c = [P.reduce((s, p) => s + p[0], 0) / P.length, P.reduce((s, p) => s + p[1], 0) / P.length];
    const normalAt = d => {
      const a = pointAtDist(track, d - 0.002), b = pointAtDist(track, d + 0.002);
      const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
      return [ty / l, -tx / l];
    };
    const dMid = inFrac + span / 2, pMid = pointAtDist(track, dMid), nMid = normalAt(dMid);
    const side = (nMid[0] * (pMid[0] - c[0]) + nMid[1] * (pMid[1] - c[1])) >= 0 ? 1 : -1;
    const out = [];
    for (let j = 0; j < M; j++) {
      const d = inFrac + span * j / (M - 1), p = pointAtDist(track, d), nv = normalAt(d);
      out.push([p[0] + side * nv[0] * offset, p[1] + side * nv[1] * offset]);
    }
    return out;
  }

  function pitSlot(track, i, n, offset) {
    const pl = pitLanePolyline(track, offset);
    if (!pl) return null;
    const f = 0.15 + 0.7 * (i + 0.5) / Math.max(n, 1);
    return pl[Math.min(pl.length - 1, Math.max(0, Math.round(f * (pl.length - 1))))];
  }

  const CAP = 0.98;        // fracción máxima sin pase real: espera en la meta
  const SLIDE_MS = 400;    // deslizamiento hasta la meta al llegar el pase
  const STALE_LAPS = 3;    // vueltas de ritmo sin pase → sin datos
  const REF_N = 5;         // vueltas limpias para el ritmo de referencia
  const OUTLIER = 1.5;     // vuelta > 1,5× la mediana = no limpia (box, incidente)

  // ── Ritmo ──────────────────────────────────────────────────────────────────
  // lapHistory llega en SEGUNDOS (como en apex-protocol.js); se devuelve en ms.
  // Solo las últimas 40 vueltas: basta para la mediana de control y evita
  // ordenar historiales de cientos de vueltas en cada tick.
  function refLapMs(lapHistory) {
    const laps = (lapHistory || []).filter(t => typeof t === 'number' && t > 0)
      .slice(-40).map(t => Math.round(t * 1000));
    if (!laps.length) return null;
    const med = median(laps);
    return median(laps.filter(ms => ms < med * OUTLIER).slice(-REF_N));
  }

  // ── Motor ──────────────────────────────────────────────────────────────────
  function createTrackPos(opts) {
    const errRing = (opts && opts.errRing) || 200;
    const karts = new Map();   // dorsal → estado interno
    const errs = [];           // |vuelta real − ritmo previsto| en s
    let fieldRef = null;
    let ctx = { pitDurationS: 120, tunnelOffsetS: null, outTimeFrac: null };

    function update(equipos, nowMs, c) {
      if (c) ctx = Object.assign({}, ctx, c);
      const refs = [], seen = new Set();
      (equipos || []).forEach(e => {
        if (!e || !e.dorsal) return;
        const d = String(e.dorsal);
        seen.add(d);
        let k = karts.get(d);
        if (!k) {
          k = { dorsal: d, lastLapAt: 0, pit: false, outAt: null, slideFrom: null, slideAt: 0, shown: 0, ref: null };
          karts.set(d, k);
        }
        k.name = e.teamName || e.name || ('#' + d);
        k.lastLapMs = e.lastLap ? Math.round(e.lastLap * 1000) : null;
        const pit = !!e.pit;
        const at = e.lastLapAt || 0;
        if (at && at !== k.lastLapAt) {
          // Error en vivo con el ritmo de ANTES de esta vuelta
          const lap = k.lastLapAt ? at - k.lastLapAt : null;
          if (lap && k.ref && !k.pit && !pit && !k.outAt && lap < k.ref * OUTLIER) {
            errs.push(Math.abs(lap - k.ref) / 1000);
            if (errs.length > errRing) errs.shift();
          }
          // Desliza hasta la meta solo si venía de la 2ª mitad de la vuelta: un kart
          // que no se estaba pintando (shown≈0) barrería la vuelta entera en 0,4 s.
          if (k.lastLapAt && k.shown > 0.5) { k.slideFrom = k.shown; k.slideAt = nowMs; }
          else k.slideFrom = null;
          k.lastLapAt = at;
          if (k.outAt && at > k.outAt) k.outAt = null;   // el pase cierra la vuelta de salida
        }
        if (k.pit && !pit) k.outAt = nowMs;               // acaba de salir de box
        if (pit) k.outAt = null;
        k.pit = pit;
        k.pitS = e.pitS || 0;
        k.pitSAt = nowMs;
        k.ref = refLapMs(e.lapHistory);
        if (k.ref) refs.push(k.ref);
      });
      for (const d of [...karts.keys()]) if (!seen.has(d)) karts.delete(d);
      fieldRef = median(refs);
    }

    // mode: 'track'|'outlap'|'pit'|'stale'|'hidden' (hidden: salió de box sin pit lane ni offset)
    function place(k, now) {
      const ref = k.ref || fieldRef;
      if (k.pit) return { mode: 'pit', t: null };
      if (k.outAt) {
        const el = now - k.outAt;
        if (ref && el > STALE_LAPS * ref) return { mode: 'stale', t: k.shown };
        let out = ctx.outTimeFrac;
        if (out == null) {
          // Sin pit lane conocido: la salida queda a "offset del túnel" de la meta.
          // Sin offset no sabemos dónde reaparece → oculto hasta su siguiente pase.
          if (!(ctx.tunnelOffsetS > 0) || !ref) return { mode: 'hidden', t: null };
          out = wrap(1 - Math.min(ctx.tunnelOffsetS * 1000, ref * CAP) / ref);
        }
        // p = avance hacia la meta (0..1): por el offset del túnel si se conoce, si no por ritmo
        const p = ctx.tunnelOffsetS > 0 ? el / (ctx.tunnelOffsetS * 1000)
          : ref ? (el / ref) / (1 - out || 1) : 0;
        return { mode: 'outlap', t: wrap(out + (1 - out) * Math.min(p, CAP)) };
      }
      if (!k.lastLapAt || !ref) return { mode: 'stale', t: k.shown || 0 };
      const el = now - k.lastLapAt;
      if (el > STALE_LAPS * ref) return { mode: 'stale', t: k.shown };
      if (k.slideFrom != null) {
        const s = (now - k.slideAt) / SLIDE_MS;
        if (s < 1) return { mode: 'track', t: k.slideFrom + (1 - k.slideFrom) * s };
        k.slideFrom = null;
      }
      return { mode: 'track', t: Math.min(el / ref, CAP) };
    }

    function positions(now) {
      const out = [];
      karts.forEach(k => {
        const p = place(k, now);
        if (p.t != null) k.shown = p.t;
        out.push({ dorsal: k.dorsal, name: k.name, mode: p.mode, t: p.t });
      });
      return out;
    }

    function info(dorsal) {
      const k = karts.get(String(dorsal));
      return k ? { dorsal: k.dorsal, name: k.name, refMs: k.ref || fieldRef, lastLapMs: k.lastLapMs } : null;
    }

    function pitList(now) {
      const out = [];
      karts.forEach(k => {
        if (!k.pit) return;
        const pitS = k.pitS + Math.max(0, now - k.pitSAt) / 1000;
        out.push({ dorsal: k.dorsal, name: k.name, pitS, remainingS: (ctx.pitDurationS || 0) - pitS });
      });
      return out.sort((a, b) => a.remainingS - b.remainingS);
    }

    // Huecos EN PISTA (no en clasificación): el primero por delante y el primero
    // por detrás, sin karts en box ni sin datos, en segundos con MI ritmo.
    function gapsFor(dorsal, now) {
      const none = { ahead: null, behind: null };
      const me = karts.get(String(dorsal));
      if (!me) return none;
      const pos = positions(now).filter(p => p.mode === 'track' || p.mode === 'outlap');
      const mine = pos.find(p => p.dorsal === me.dorsal);
      if (!mine) return none;
      const ref = me.ref || fieldRef;
      if (!ref) return none;
      let ahead = null, behind = null;
      pos.forEach(p => {
        if (p.dorsal === me.dorsal) return;
        const delta = wrap(p.t - mine.t);
        if (delta === 0) return;
        if (!ahead || delta < ahead.delta) ahead = { p, delta };
        if (!behind || delta > behind.delta) behind = { p, delta };
      });
      const out = (x, frac) => x && { dorsal: x.p.dorsal, name: x.p.name, gapS: frac * ref / 1000 };
      return { ahead: out(ahead, ahead && ahead.delta), behind: out(behind, behind && (1 - behind.delta)) };
    }

    function errorStats() {
      return { medianS: median(errs), p90S: quantile(errs, 0.9), n: errs.length };
    }

    return { update, positions, info, errorStats, pitList, gapsFor, _karts: karts, _ctx: () => ctx, _fieldRef: () => fieldRef };
  }

  return {
    CAP, ovalTrack, loadTrack, mirrorProfile, pointAt, distToTime, pointAtDist,
    pitLanePolyline, pitSlot, median, quantile, refLapMs, createTrackPos,
  };
});
