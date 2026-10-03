// ── en-driver-time.js — tiempo OFICIAL por piloto ([h:mm] de Apex) ──
// En las resistencias por equipos Apex manda junto al nombre del piloto sus
// minutos acumulados en pista en la sesión (siguen entre stints, no cuentan el
// box). El parser los expone por kart en driver/driverMin/drivers. Aquí se
// emparejan esos nombres ("ALEX LOPEZ") con los pilotos del setup ("Alex").
// Funciona en browser (window.EnDriverTime) y Node.js (tests/driver-time.test.js).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EnDriverTime = api;
})(typeof window !== 'undefined' ? window : this, function () {

  function tokens(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  }
  const subset = (a, b) => a.length > 0 && a.every(t => b.includes(t));

  // Índice del piloto del setup que corresponde al nombre de Apex, o -1.
  // Vale el nombre igual, o que uno contenga todas las palabras del otro
  // ("Alex" ↔ "ALEX LOPEZ"). Si encajan varios, -1: mejor preguntar que adivinar.
  function matchPilot(apexName, pilotos) {
    const a = tokens(apexName);
    if (!a.length || !Array.isArray(pilotos)) return -1;
    const exact = pilotos.findIndex(p => tokens(p && p.name).join(' ') === a.join(' '));
    if (exact >= 0) return exact;
    const hits = [];
    pilotos.forEach((p, i) => {
      const t = tokens(p && p.name);
      if (subset(t, a) || subset(a, t)) hits.push(i);
    });
    return hits.length === 1 ? hits[0] : -1;
  }

  // Minutos oficiales de cada piloto del setup (null si Apex no lo conoce),
  // el piloto en pista según Apex y los nombres de Apex que no están en el setup.
  function officialByPilot(kart, pilotos) {
    const list = Array.isArray(pilotos) ? pilotos : [];
    const out = { minutes: list.map(() => null), currentIdx: -1, unmatched: [] };
    const drivers = (kart && kart.drivers) || [];
    for (const d of drivers) {
      const i = matchPilot(d.name, list);
      if (i < 0) { out.unmatched.push({ name: d.name, min: d.min }); continue; }
      out.minutes[i] = (out.minutes[i] || 0) + d.min;
    }
    if (kart && kart.driver) out.currentIdx = matchPilot(kart.driver, list);
    return out;
  }

  // Nombre de relleno del setup ("Piloto 2", "Yo"): nadie lo escribió a mano.
  const isPlaceholder = name => /^(piloto\s*\d+|yo)$/i.test(String(name || '').trim());
  const MAX_PILOTS = 10;

  // Índice del piloto del setup para el nombre de Apex, ADOPTÁNDOLO si no está:
  // la identificación no puede depender de que el usuario haya tecleado en el
  // setup los mismos nombres que usa el cronometraje. Si no encaja con nadie,
  // ocupa un hueco de relleno que no tenga stints a su nombre (usedIdx) o se
  // añade al final. Muta `pilotos`. -1 solo sin nombre o con la lista llena.
  function adoptPilot(apexName, pilotos, usedIdx) {
    const name = String(apexName || '').trim();
    if (!name || !Array.isArray(pilotos)) return -1;
    const hit = matchPilot(name, pilotos);
    if (hit >= 0) return hit;
    const used = usedIdx || new Set();
    const free = pilotos.findIndex((p, i) => isPlaceholder(p && p.name) && !used.has(i));
    if (free >= 0) { pilotos[free] = { ...pilotos[free], name }; return free; }
    if (pilotos.length >= MAX_PILOTS) return -1;
    const minutos = (pilotos[0] && pilotos[0].minutos) || 90;
    pilotos.push({ name, minutos });
    return pilotos.length - 1;
  }

  // Stints ya CERRADOS de un dorsal, reconstruidos desde lo que grabó el logger
  // (para quien abre el panel a mitad de carrera): uno por cada pit-in.
  //   laps: [{name, lap_time_ms, timestamp}]   pits: [{event_type, timestamp, duration_ms}]
  // El stint va del pit-out anterior (o la salida de carrera) al pit-in; el
  // piloto es el nombre que más se repite en sus vueltas (la BD guarda quién
  // iba en cada vuelta). Las vueltas hechas con el kart en el box no cuentan.
  function rebuildStints(laps, pits, raceStart) {
    const L = (laps || []).filter(l => l && l.timestamp).slice().sort((a, b) => a.timestamp - b.timestamp);
    const P = (pits || []).filter(p => p && p.timestamp).slice().sort((a, b) => a.timestamp - b.timestamp);
    let start = raceStart || (L.length ? L[0].timestamp - (L[0].lap_time_ms || 0) : null);
    const out = [];
    let open = null;                     // stint cerrado a la espera de su pit-out
    for (const p of P) {
      if (p.event_type === 'in') {
        if (open || start == null) continue;        // segundo "in" sin "out": ruido
        const mine = L.filter(l => l.timestamp > start && l.timestamp <= p.timestamp);
        const times = mine.map(l => l.lap_time_ms / 1000);
        const valid = times.filter(t => t >= 20 && t < 300);
        const votes = {};
        mine.forEach(l => { if (l.name) votes[l.name] = (votes[l.name] || 0) + 1; });
        const pilot = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0] || null;
        open = { pilot, durationMs: p.timestamp - start, laps: mine.length, lapTimes: times,
                 best: valid.length ? Math.min(...valid) : null, endTs: p.timestamp, pitStopMs: null };
        out.push(open);
        start = null;
      } else if (p.event_type === 'out') {
        if (open) open.pitStopMs = p.duration_ms || (p.timestamp - open.endTs);
        open = null;
        start = p.timestamp;
      }
    }
    return out;
  }

  return { matchPilot, officialByPilot, adoptPilot, isPlaceholder, rebuildStints };
});
