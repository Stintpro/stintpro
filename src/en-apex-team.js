// ── en-apex-team.js — plantilla y stints OFICIALES de mi equipo ─────────────
// Apex responde bajo demanda (request.php, lo mismo que su web al pulsar en un
// equipo) con tres cosas que el canal en vivo no da enteras:
//   .INF  plantilla del equipo: todos los pilotos inscritos (aunque no hayan
//         rodado) y cuál va en pista.
//   .P    una línea por parada: entrada, salida, duración, duración y vueltas
//         del stint que acaba, piloto de ese stint y su tiempo ACUMULADO (ms).
//   .L    todas las vueltas con sus sectores.
// Con eso «Mi equipo» se rellena solo en cualquier modo de conexión (Logger o
// directo), con el tiempo por piloto exacto en vez del [h:mm] de un minuto.
//
// El núcleo (EnApexTeam) es puro y va con tests (tests/apex-team.test.js).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EnApexTeam = api;
})(typeof window !== 'undefined' ? window : this, function () {

  const REQUEST_URL = 'https://live-data.apex-timing.com/live-timing/commonv2/functions/request.php';

  // Una sola "D" inicial y pares (cantidad, elemento): repetir la D devuelve vacío.
  const requestFor = id => `D#-999#D${id}.L#-999#D${id}.P#1#D${id}.INF`;

  const attr = (tag, name) => { const m = new RegExp('\\b' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; };

  // .INF → { team, drivers:[{id, num, name, current}] }. La primera etiqueta
  // <driver> es el equipo; las siguientes, sus pilotos.
  function parseInf(text) {
    const line = String(text || '').split('\n').find(l => /\.INF#/.test(l)) || '';
    const tags = line.match(/<driver\b[^>]*>/g) || [];
    if (!tags.length) return { team: null, drivers: [] };
    const team = (attr(tags[0], 'name') || '').trim() || null;
    const drivers = tags.slice(1).map(t => ({
      id: attr(t, 'id'), num: parseInt(attr(t, 'num'), 10) || 0,
      name: (attr(t, 'name') || '').replace(/\s+/g, ' ').trim(),
      current: attr(t, 'current') === '1',
    })).filter(d => d.id && d.name);
    return { team, drivers };
  }

  // .P → paradas en orden: [{n, lap, inMs, outMs|null, durMs, stintMs, stintLaps, driverId, driverTotalMs}]
  // Tiempos relativos al inicio de la sesión. outMs vacío = sigue en el box.
  function parsePits(text) {
    const out = [];
    String(text || '').split('\n').forEach(l => {
      const m = /\.P\d+#(.*)$/.exec(l.trim());
      if (!m) return;
      const p = m[1].split('|');
      const num = i => { const v = parseInt(p[i], 10); return isNaN(v) ? null : v; };
      if (num(0) == null || num(2) == null) return;
      out.push({ n: num(0), lap: num(1) || 0, inMs: num(2), outMs: num(3), durMs: num(4),
                 stintMs: num(5) || 0, stintLaps: num(6) || 0,
                 driverId: p[7] && p[7] !== '0' ? p[7] : null, driverTotalMs: num(8) });
    });
    return out.sort((a, b) => a.n - b.n);
  }

  // .L → vueltas por número: [{n, ms}] (las marcas g/p de mejor vuelta se quitan).
  function parseLaps(text) {
    const out = [];
    String(text || '').split('\n').forEach(l => {
      const m = /\.L(\d+)#[^|]*\|[^|]*\|[^|]*\|([\da-zA-Z]+)/.exec(l.trim());
      if (!m) return;
      const ms = parseInt(m[2].replace(/[a-zA-Z]/g, ''), 10);
      if (!isNaN(ms)) out.push({ n: parseInt(m[1], 10), ms });
    });
    return out.sort((a, b) => a.n - b.n);
  }

  // Todo junto → lo que necesita «Mi equipo»:
  //   drivers    plantilla (nombres) y `current` = quién va en pista
  //   stints     stints CERRADOS (uno por parada), con piloto, duración, vueltas,
  //              tiempos de vuelta, mejor y duración de la parada
  //   totals     tiempo acumulado exacto por piloto tras su último stint cerrado
  //   stops      paradas que Apex lleva contadas
  function build(text) {
    const inf = parseInf(text), pits = parsePits(text), laps = parseLaps(text);
    const nameOf = {};
    inf.drivers.forEach(d => { nameOf[d.id] = d.name; });
    const totals = {};
    let prevLap = 0;
    const stints = pits.map((p, i) => {
      let mine = laps.filter(l => l.n > prevLap && l.n <= p.lap).map(l => l.ms / 1000);
      // La primera vuelta tras una parada lleva dentro el tiempo de box.
      if (i > 0 && mine.length > 1) mine = mine.slice(1);
      prevLap = p.lap;
      const valid = mine.filter(t => t >= 20 && t < 300);
      const pilot = (p.driverId && nameOf[p.driverId]) || null;
      if (pilot && p.driverTotalMs != null) totals[pilot] = Math.max(totals[pilot] || 0, p.driverTotalMs);
      return { pilot, durationMs: p.stintMs, laps: p.stintLaps || mine.length, lapTimes: mine,
               best: valid.length ? Math.min(...valid) : null, endOffsetMs: p.inMs,
               pitStopMs: p.outMs != null ? (p.durMs || (p.outMs - p.inMs)) : null };
    });
    const cur = inf.drivers.find(d => d.current);
    return { team: inf.team, drivers: inf.drivers.map(d => d.name), current: cur ? cur.name : null,
             stints, totals, stops: pits.length };
  }

  return { REQUEST_URL, requestFor, parseInf, parsePits, parseLaps, build };
});

// ── Pegamento con el panel (solo navegador) ──────────────────────────────────
if (typeof window !== 'undefined' && typeof document !== 'undefined') {

  // Fila de Apex (rNNN) de mi dorsal. En modo directo la sabe el conector; en
  // modo Logger el estado no la trae, así que se lee la parrilla con una
  // conexión puntual a Apex que se cierra en cuanto llega.
  function _apexRowIdOf(cfg) {
    const my = String(cfg.myDorsal).trim();
    const pick = karts => { const k = (karts || []).find(x => String(x.dorsal).trim() === my); return k ? k.rowId : null; };
    try {
      const p = window.ApexConnector && window.ApexConnector._parser;
      const id = p && p.getKartIds && pick(p.getKartIds());
      if (id) return Promise.resolve(id);
    } catch (e) {}
    if (!cfg.port || !cfg.slug || typeof WebSocket === 'undefined' || !window.ApexGrid) return Promise.resolve(null);
    return new Promise(resolve => {
      let done = false, ws = null;
      const end = v => { if (done) return; done = true; clearTimeout(timer); try { ws.onmessage = ws.onerror = ws.onclose = null; ws.close(); } catch (e) {} resolve(v); };
      const timer = setTimeout(() => end(null), 12000);
      try {
        ws = new WebSocket(`wss://live-data.apex-timing.com:${cfg.port}/`);
        ws.onopen = () => { try { ws.send(cfg.slug); } catch (e) {} };
        ws.onmessage = ev => {
          const line = String(ev.data).split('\n').find(l => l.startsWith('grid|'));
          if (!line) return;
          try { end(pick(window.ApexGrid.parseGridHtml(line.substring(5)).karts)); } catch (e) { end(null); }
        };
        ws.onerror = () => end(null);
        ws.onclose = () => end(null);
      } catch (e) { end(null); }
    });
  }

  // Plantilla + stints + tiempos oficiales de mi equipo, o null si Apex no los da
  // (sin fila, circuito sin esta función, sesión ya cambiada, sin red).
  window._enApexTeamFetch = async function () {
    const cfg = window.AppState && window.AppState.config;
    if (!cfg || cfg.simMode || cfg.slug === 'replay' || !cfg.myDorsal) return null;
    const key = cfg.slug + '|' + cfg.myDorsal;
    if (!EnSession._apexRow || EnSession._apexRow.key !== key) {
      const rowId = await _apexRowIdOf(cfg);
      if (!rowId) return null;
      EnSession._apexRow = { key, rowId };
    }
    // Puerto de las peticiones = puerto del WebSocket − 3 (el del conector, si lo tiene).
    const port = (window.ApexConnector && window.ApexConnector._httpPort) || (parseInt(cfg.port, 10) - 3);
    if (!port || port < 1) return null;
    const id = EnSession._apexRow.rowId.replace('r', '');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(EnApexTeam.REQUEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'port=' + port + '&request=' + encodeURIComponent(EnApexTeam.requestFor(id)),
        signal: ctrl.signal,
      });
      const text = (await res.text()).trim();
      if (!res.ok || !text || text === 'error') return null;
      const data = EnApexTeam.build(text);
      if (!data.drivers.length && !data.stints.length) return null;
      data.at = Date.now();
      EnSession._apexTeamData = data;
      return data;
    } catch (e) { return null; }
    finally { clearTimeout(t); }
  };

  // Aplica la parte que nunca pisa nada: la plantilla (los inscritos entran en
  // la lista de pilotos aunque no hayan rodado) y los tiempos oficiales exactos.
  window._enApexTeamApply = function (data) {
    const cfg = window.AppState && window.AppState.config;
    if (!data || !cfg || !window.EnDriverTime) return;
    if (!Array.isArray(cfg.pilotos)) cfg.pilotos = [];
    const used = new Set((EnSession.stintHistory || []).map(s => s.pilotIdx));
    used.add(EnSession.currentPilot);
    const before = JSON.stringify(cfg.pilotos);
    data.drivers.forEach(n => { const i = EnDriverTime.adoptPilot(n, cfg.pilotos, used); if (i >= 0) used.add(i); });
    EnSession.apexTeam = { at: data.at, stops: data.stops, totals: data.totals, drivers: data.drivers, current: data.current };
    if (JSON.stringify(cfg.pilotos) !== before) { try { _enSaveRaceState(); } catch (e) {} }
  };

  // Tiempo oficial exacto (ms) de un piloto del setup, o null. Suma el stint en
  // curso si es el que va en pista (las paradas solo cuentan stints cerrados).
  window._enApexPilotMs = function (pilotName, isCurrent) {
    const t = EnSession.apexTeam;
    if (!t || !t.drivers || !t.drivers.length || !window.EnDriverTime) return null;
    let ms = null, known = false;
    t.drivers.forEach(n => {
      if (EnDriverTime.matchPilot(n, [{ name: pilotName }]) !== 0) return;
      known = true;
      if (t.totals[n] != null) ms = (ms || 0) + t.totals[n];
    });
    if (!known) return null;
    ms = ms || 0;
    if (isCurrent) ms += EnSession.stintFrozen ? EnSession.stintFrozen : (EnSession.stintStart ? (Date.now() - EnSession.stintStart) : 0);
    return ms;
  };

  // En cada tick: trae la plantilla y los tiempos oficiales al abrir el panel y
  // los refresca tras cada parada mía (una petición por parada, no un sondeo).
  // Con mi kart en el box espera: Apex aún está cerrando ese stint.
  window._enAutoApexTeam = function () {
    const cfg = window.AppState && window.AppState.config;
    if (!cfg || cfg.simMode || cfg.slug === 'replay' || !window.EnBoxModel) return;
    const myK = (EnSession.data.equipos || []).find(e => EnBoxModel.isMine(e, cfg.myDorsal));
    if (!myK || myK.pit || myK.pitState === 'in' || EnSession.stintFrozen) return;
    const have = EnSession.apexTeam;
    if (have && have.stops >= _enMyStops()) return;
    const now = Date.now();
    if (EnSession._apexTeamBusy || now < (EnSession._apexTeamNext || 0)) return;
    EnSession._apexTeamBusy = true;
    window._enApexTeamFetch().then(data => {
      // Sin respuesta (circuito sin esta función, sin red): reintento espaciado.
      EnSession._apexTeamNext = Date.now() + (data ? 60000 : 300000);
      if (!data) return;
      window._enApexTeamApply(data);
      _enRender();
    }).catch(() => { EnSession._apexTeamNext = Date.now() + 300000; })
      .finally(() => { EnSession._apexTeamBusy = false; });
  };
}
