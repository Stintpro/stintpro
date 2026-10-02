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

  return { matchPilot, officialByPilot };
});
