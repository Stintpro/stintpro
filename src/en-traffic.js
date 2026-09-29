// ── en-traffic.js — tráfico por vuelta: tren (rebufo), bloqueo o limpia ──
// Lógica pura, sin DOM: se alimenta con los pases por meta (dorsal, tiempo de
// vuelta, instante) y etiqueta cada vuelta mirando al kart que cruzó justo
// delante EN PISTA (no en la clasificación). Lo consumen en-state.js (calidad
// de kart y media de pista, que excluyen las vueltas con tráfico), en-grid.js
// (glifo ≋/▮ + tooltip) y el popup de Media pista ("Rebufo hoy").
//
// Umbrales validados con 7 carreras reales (spike 2026-09-29, ver
// docs/superpowers/specs/2026-09-29-rebufo-design.md): tren sostenido −0,10 s
// de mediana, bloqueo +0,22 s. Un hueco < 0,2 s es artefacto (cruces que Apex
// manda en el mismo mensaje) y nunca etiqueta.
// Funciona en browser (window.EnTraffic = instancia) y Node.js (module.exports).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EnTraffic = Object.assign(api.createTraffic(), api);
})(typeof window !== 'undefined' ? window : this, function () {

  const GAP_MIN = 0.2;     // s — por debajo, artefacto de mensaje
  const TRAIN_MAX = 1.2;   // s — tren: mismo kart delante a [0,2 ; 1,2] al empezar y al acabar
  const BLOCK_FROM = 1.5;  // s — bloqueo: empezó con más de esto libre…
  const BLOCK_TO = 0.6;    // s — …y acaba a menos de esto
  const MIN_GIFT_N = 100;  // vueltas de cada tipo para dar "Rebufo hoy"
  const RING = 40;         // últimos pases globales para buscar el de delante
  const TAGS_MAX = 60;     // etiquetas recordadas por dorsal
  const WIN = 15;          // vueltas limpias de referencia para el regalo
  const WIN_MIN = 6;
  const DELTA_GATE = 0.08; // solo vueltas a ±8 % de su referencia

  function median(a) {
    const s = [...a].sort((x, y) => x - y);
    const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  function createTraffic() {
    let ring, byDorsal, dTrain, dClean, giftCache, seenAt;

    function reset() {
      ring = [];          // [{dorsal, ts}]
      byDorsal = {};      // dorsal → {gap, ahead, win[], tags: Map(lapMs→rec)}
      dTrain = []; dClean = [];
      giftCache = null;
      seenAt = {};        // dorsal → último lastLapAt ingerido
    }
    reset();

    function onCrossing(dorsal, lapMs, ts) {
      dorsal = String(dorsal);
      lapMs = Math.round(lapMs);
      // El de delante en pista = el pase más reciente de OTRO dorsal no posterior al mío
      let ahead = null;
      for (let i = ring.length - 1; i >= 0; i--) {
        const c = ring[i];
        if (c.dorsal !== dorsal && c.ts <= ts && (!ahead || c.ts > ahead.ts)) ahead = c;
      }
      const gapEnd = ahead ? (ts - ahead.ts) / 1000 : null;
      const st = byDorsal[dorsal] || (byDorsal[dorsal] = { gap: null, ahead: null, win: [], tags: new Map() });

      let tag = 'clean';
      if (gapEnd != null && st.gap != null && gapEnd >= GAP_MIN) {
        if (st.ahead === ahead.dorsal && st.gap >= GAP_MIN && st.gap <= TRAIN_MAX && gapEnd <= TRAIN_MAX) tag = 'train';
        else if (st.gap > BLOCK_FROM && gapEnd < BLOCK_TO) tag = 'blocked';
      }
      const rec = { lapMs, ts, tag, aheadDorsal: ahead ? ahead.dorsal : null, gapStart: st.gap, gapEnd };

      // Muestra del regalo: Δ contra la referencia LIMPIA del propio kart (así un
      // tren largo no absorbe su propio rebufo).
      if (st.win.length >= WIN_MIN && tag !== 'blocked') {
        const ref = median(st.win);
        if (Math.abs(lapMs - ref) <= ref * DELTA_GATE) {
          (tag === 'train' ? dTrain : dClean).push((lapMs - ref) / 1000);
          giftCache = null;
        }
      }
      if (tag === 'clean') { st.win.push(lapMs); if (st.win.length > WIN) st.win.shift(); }

      st.tags.set(lapMs, rec);
      if (st.tags.size > TAGS_MAX) st.tags.delete(st.tags.keys().next().value);
      st.gap = gapEnd; st.ahead = ahead ? ahead.dorsal : null;
      ring.push({ dorsal, ts });
      if (ring.length > RING) ring.shift();
      return rec;
    }

    // Alimenta desde el estado (equipos[] con lastLap en s y lastLapAt en ms):
    // solo los karts cuyo lastLapAt cambió, en orden temporal.
    function ingest(equipos) {
      const fresh = [];
      (equipos || []).forEach(e => {
        if (!e || !e.dorsal || !e.lastLapAt || !e.lastLap) return;
        const d = String(e.dorsal);
        if (seenAt[d] === e.lastLapAt) return;
        seenAt[d] = e.lastLapAt;
        fresh.push({ d, lapMs: Math.round(e.lastLap * 1000), ts: e.lastLapAt });
      });
      fresh.sort((a, b) => a.ts - b.ts).forEach(c => onCrossing(c.d, c.lapMs, c.ts));
    }

    function tagOf(dorsal, lapMs) {
      const st = byDorsal[String(dorsal)];
      if (!st) return null;
      const k = Math.round(lapMs);
      return st.tags.get(k) || st.tags.get(k - 1) || st.tags.get(k + 1) || null;
    }

    function isTraffic(dorsal, lapSec) {
      const r = tagOf(dorsal, lapSec * 1000);
      return r && r.tag !== 'clean' ? r.tag : null;
    }

    function giftToday() {
      if (giftCache) return giftCache;
      const nTrain = dTrain.length, nClean = dClean.length;
      const giftSec = (nTrain >= MIN_GIFT_N && nClean >= MIN_GIFT_N) ? median(dTrain) - median(dClean) : null;
      return (giftCache = { giftSec, nTrain, nClean });
    }

    return { onCrossing, ingest, tagOf, isTraffic, giftToday, reset };
  }

  return { createTraffic, GAP_MIN, TRAIN_MAX, BLOCK_FROM, BLOCK_TO, MIN_GIFT_N };
});
