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
      pitLane: { inFrac: 0.92, outFrac: 0.06 }, approxProfile: false,
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

  return {
    ovalTrack, loadTrack, mirrorProfile, pointAt, distToTime, pointAtDist,
    pitLanePolyline, pitSlot, median, quantile,
  };
});
