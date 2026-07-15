// ── ApexProtocol — módulo compartido de parseo del protocolo Apex Timing ──
// Funciona en browser (window.ApexProtocol) y Node.js (module.exports).
// Sin dependencias de DOM ni Node.js — los wrappers aportan el parsing HTML del grid.
//
// Comportamiento canónico (fuente de verdad única):
//   |*|  → si !colMap.llp: registra vuelta + guarda _lapFromFlash/_lapFromFlashTs para anti-dedup
//   llp  → ventana 5s: si |*| llegó hace <5s → refina; si no → vuelta nueva
//   so   → activa _lapInvalid para bloquear el parcial box→meta
//   sr   → limpia _lapInvalid y pit
//   Sesión nueva: sessionFinished O inactividad >10 min sin vueltas

(function (root, factory) {
  // En Electron el renderer tiene 'module' definido pero también tiene 'window'/DOM
  // → usar siempre el path de browser cuando hay DOM, aunque module exista
  if (typeof module !== 'undefined' && module.exports && typeof window === 'undefined') {
    module.exports = factory();
  } else {
    root.ApexProtocol = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STATE_CODES = new Set(['si','so','sr','su','sd','ss','sf','gs','gf','gl','gm']);
  const RUN_STATES  = new Set(['sr','su','sd','gs','gf','gl','gm']);
  const SKIP_NAMES  = new Set(['in','tn','ti','tb','ib','sr','sd','su','si','ss','sf','gf','gl','gm','gs','to','so']);

  // ── Utilidades puras (también exportadas para los wrappers de grid) ────────

  function parseTime(str) {
    if (!str) return null;
    str = str.replace(/[a-zA-Z]/g, '').replace(/\.$/, '').trim();
    if (!str || str.length < 2) return null;
    if (str.includes(':')) {
      const [m, s] = str.split(':');
      const v = parseFloat(m) * 60 + parseFloat(s);
      return isNaN(v) ? null : parseFloat(v.toFixed(3));
    }
    const n = parseFloat(str);
    if (isNaN(n) || n < 1) return null;
    return n > 1000 ? parseFloat((n / 1000).toFixed(3)) : n;
  }

  function parsePitTimer(v) {
    if (!v) return null;
    v = v.replace(/\.$/, '').trim();
    if (v.includes(':')) {
      const [m, s] = v.split(':');
      const secs = parseInt(m) * 60 + parseFloat(s);
      return isNaN(secs) ? null : Math.round(secs);
    }
    const s = parseFloat(v);
    return isNaN(s) ? null : Math.round(s);
  }

  // ── Vuelta imposible (glitch de baliza al entrar/salir de boxes) ───────────
  // Una entrada a pit puede hacer que la baliza cuente un trozo de vuelta como
  // vuelta entera: un tiempo anormalmente corto que, al ser el más bajo, falsea
  // la vuelta rápida. Se descarta esa vuelta.
  // Referencia = la MEJOR vuelta del propio kart (no la mediana): la mediana se
  // contamina con vueltas lentas/paradas y clava falsos positivos, mientras que
  // la mejor refleja el ritmo real y es imposible batirla por un 35%.
  //   · Kart con ritmo (≥3 vueltas): se descarta lo que baje del 65% de su mejor
  //     vuelta (un glitch de pit es 30-55% del ritmo; una vuelta real jamás es
  //     >35% más rápida que la mejor del propio kart → 0 falsos positivos).
  //   · Kart sin ritmo aún (p.ej. su 1ª vuelta): se usa el ritmo de PISTA
  //     (mediana del resto de karts) al 60%. Solo caza glitches groseros.
  function isGlitchLap(hist, t, fieldMedian) {
    if (hist && hist.length >= 3) {
      let best = Infinity;
      for (const l of hist) if (l < best) best = l;
      return t < best * 0.65;
    }
    if (fieldMedian) return t < fieldMedian * 0.60;
    return false;
  }

  // ── Factory ───────────────────────────────────────────────────────────────

  function createParser(callbacks = {}) {
    let _karts           = {};
    let _colMap          = {};
    let _colByNum        = {};
    let _sessionActive   = false;
    let _sessionFinished = false;
    let _leaderLap       = 0;
    let _lastLapTime     = 0;
    let _title1          = '';
    let _title2          = '';
    let _sessionMode     = '';   // 'p' = practice/clasificación · 'r' = carrera (letra del init|X|)
    let _recentLaps      = [];   // últimas vueltas válidas de la sesión (ritmo de pista, para filtro de glitches)
    let _flag            = null; // bandera del panel de luces: 'green'|'red'|'yellow'|null (lg/lr/ly)

    // Ritmo de pista: mediana de las últimas vueltas aceptadas de todos los karts.
    // Sirve de referencia cuando un kart aún no tiene vueltas propias suficientes.
    function _fieldMedian() {
      if (_recentLaps.length < 5) return null;
      const s = _recentLaps.slice().sort((a, b) => a - b);
      return s[s.length >> 1];
    }
    function _pushRecent(t) {
      _recentLaps.push(t);
      if (_recentLaps.length > 40) _recentLaps.shift();
      _lastLapTime = Date.now();   // señal de actividad (cubre también circuitos solo-llp)
    }

    function _kart(rowId) {
      if (!_karts[rowId]) _karts[rowId] = {
        _rowId: rowId, lapHistory: [], state: 'sr', tours: 0,
        pit: false, pitState: null, pitS: 0, pitDuration: 0,
        standsCount: 0, _lapInvalid: false, checkered: false,
        _lapFlash: 0, _pitInTime: null, _pitTimerActive: false,
        _lapFromFlash: undefined, _lapFromFlashTs: 0,
        _pilotName: undefined, // solo se actualiza con nombres que llevan [X:XX] (carreras por equipos)
        _pendingPitEvent: undefined, // si/so llegó antes que el dorsal — se dispara al fijarlo
      };
      return _karts[rowId];
    }

    // Señal de nueva sesión: cambio del título de sesión de Apex (title1/title2),
    // que suele llegar ANTES del grid. PERO el título PARPADEA: algunos feeds lo
    // cambian y lo revierten en segundos durante una carrera en marcha (visto en
    // Los Santos: IRONMAN→ENTRENOS→IRONMAN en 14s). Un parpadeo así NO puede borrar
    // una carrera en vivo (perderíamos historial, stints, paradas a mitad de carrera).
    // Regla: solo se acepta el borrado por título si la sesión anterior YA terminó
    // (bandera a cuadros) o lleva ≥60s sin vueltas. Si hay vueltas fluyendo y sin
    // bandera, es un parpadeo (o una inyección en el feed) y se ignora — la detección
    // por grid (solapamiento de dorsales / inactividad >10min) cazará una sesión
    // nueva real cuando llegue su parrilla.
    // El guard de karts>0 evita disparar dos veces en el mismo init (title1 y title2
    // juntos) y en la primera conexión.
    function _maybeNewSessionByTitle() {
      if (!(_sessionActive && Object.keys(_karts).length > 0)) return;
      const lapFlowing = _lastLapTime && (Date.now() - _lastLapTime) < 60000;
      if (lapFlowing && !_sessionFinished) return;   // parpadeo/inyección → no borrar
      _karts = {}; _leaderLap = 0; _sessionFinished = false; _lastLapTime = 0; _recentLaps = [];
      if (callbacks.onNewSession) callbacks.onNewSession();
    }

    function _applyCell(k, col, type, val) {
      const dtype = _colByNum[col] || '';
      const v = (val !== undefined && val !== '') ? val : type;

      // ── Estado ────────────────────────────────────────────────────────
      const isStateCol  = dtype === 'grp' || dtype === 'sta';
      const isStateCode = !dtype && STATE_CODES.has(type);
      if (isStateCol || isStateCode) {
        if (type === 'in') return;
        k.state = type;
        if (type === 'ss') {
          k._lapInvalid = true;
        } else if (RUN_STATES.has(type)) {
          k._lapInvalid = false;
        }
        if (type === 'si') {
          k.pit = true; k.pitState = 'in'; k._pitInTime = Date.now(); k._lapInvalid = true;
          if (callbacks.onPit) {
            // La celda de estado puede llegar antes que la del dorsal en el mismo lote de
            // diffs (orden por número de columna) — sin dorsal aún no hay a quién avisar,
            // así que se pospone el evento en vez de perderlo (se dispara al fijar 'no').
            if (k.dorsal) callbacks.onPit(k.dorsal, 'in', k.standsCount, Date.now());
            else k._pendingPitEvent = { type: 'in', standsCount: k.standsCount, time: Date.now() };
          }
        } else if (type === 'so') {
          k.pit = true; k.pitState = 'out'; k.pitS = 0; k._pitTimerActive = false; k._pitInTime = null;
          k._lapInvalid = true;
          if (callbacks.onPit) {
            if (k.dorsal) callbacks.onPit(k.dorsal, 'out', k.standsCount, Date.now());
            else k._pendingPitEvent = { type: 'out', standsCount: k.standsCount, time: Date.now() };
          }
        } else if (type === 'sr' || type === 'su') {
          if (!k._pitTimerActive) k.pit = false;
          k.pitState = null; k._pitInTime = null;
        }
        if (type === 'sf') k.checkered = true;
        return;
      }

      // ── Posición ──────────────────────────────────────────────────────
      if (dtype === 'rk') {
        const p = parseInt(v);
        if (!isNaN(p) && p > 0) {
          if (k.pos && k.pos !== p) k._posChange = { from: k.pos, to: p, delta: k.pos - p, time: Date.now() };
          k.pos = p;
        }
        return;
      }

      // ── Dorsal ────────────────────────────────────────────────────────
      if (dtype === 'no') {
        const d = (v || '').trim();
        if (d && !isNaN(parseInt(d))) {
          k.dorsal = d;
          if (k._pendingPitEvent && callbacks.onPit) {
            const pe = k._pendingPitEvent;
            callbacks.onPit(k.dorsal, pe.type, pe.standsCount, pe.time);
          }
          k._pendingPitEvent = undefined;
        }
        return;
      }

      // ── Nombre ────────────────────────────────────────────────────────
      if (dtype === 'dr') {
        const n = (v || '').trim();
        // Rechaza solo valores puramente numéricos (dorsales) o de tiempo, no
        // nombres que empiezan por dígito ("24H Racing", "1000 Millas") — antes
        // isNaN(parseInt) los descartaba y ese equipo se quedaba sin nombre.
        if (n && n.length > 1 && !/^\d+(\.\d+)?$/.test(n) && !/^\d{1,2}:\d{2}/.test(n) && !SKIP_NAMES.has(n)) {
          const pm = n.match(/^(.*?)\s*\[\d+:\d+\]$/);
          if (pm) {
            // Nombre con brackets = piloto confirmado (carreras por equipos)
            k.name = pm[1].trim();
            k._pilotName = pm[1].trim();
          } else {
            // Sin brackets = nombre de equipo (o piloto en carrera individual)
            k.teamName = n;
            if (!k._pilotName) k.name = n; // no sobreescribir si ya hay piloto confirmado
          }
        }
        return;
      }

      // ── Sectores ──────────────────────────────────────────────────────
      if (dtype === 's1') { const x = parseFloat(v); if (!isNaN(x) && x > 0 && x < 120) k.s1 = x; return; }
      if (dtype === 's2') { const x = parseFloat(v); if (!isNaN(x) && x > 0 && x < 120) k.s2 = x; return; }
      if (dtype === 's3') { const x = parseFloat(v); if (!isNaN(x) && x > 0 && x < 120) k.s3 = x; return; }

      // ── Nombre vía drteam (algunos circuitos usan tipo 'drteam' en col llp) ──
      if (type === 'drteam') {
        const n = (val || '').trim();
        if (n && n.length > 1 && !/^\d+(\.\d+)?$/.test(n) && !/^\d{1,2}:\d{2}/.test(n) && !SKIP_NAMES.has(n)) {
          const pm = n.match(/^(.*?)\s*\[\d+:\d+\]$/);
          if (pm) {
            k.name = pm[1].trim();
            k._pilotName = pm[1].trim();
          } else {
            k.teamName = n;
            if (!k._pilotName) k.name = n;
          }
        }
        return;
      }

      // ── Última vuelta ─────────────────────────────────────────────────
      if (dtype === 'llp') {
        const t = parseTime(v);
        if (t && t >= 20 && t < 300) {
          if (!k._lapInvalid && !isGlitchLap(k.lapHistory, t, _fieldMedian())) {
            const flashAge = k._lapFromFlashTs ? Date.now() - k._lapFromFlashTs : Infinity;
            if (k._lapFromFlash !== undefined && flashAge < 5000 && k.lapHistory.length) {
              // Refinamiento: llp llegó poco después de |*| (misma vuelta)
              k.lapHistory[k.lapHistory.length - 1] = t;
              k.lastLap = t;
              if (!k.bestLap || t < k.bestLap) k.bestLap = t;
            } else {
              // Vuelta nueva (sin |*| previo, o llp tardío)
              k.lastLap = t;
              k.lapHistory.push(t); _pushRecent(t);
              if (k.lapHistory.length > 1500) k.lapHistory.shift();
              if (!k.bestLap || t < k.bestLap) k.bestLap = t;
              if (callbacks.onLap && k.dorsal)
                callbacks.onLap(k.dorsal, k._pilotName || k.name, k._pilotName ? (k.teamName || null) : null, Math.round(t * 1000), k.lapHistory.length, Date.now());
            }
          }
          k._lapInvalid = false;
          k._lapFromFlash  = undefined;
          k._lapFromFlashTs = 0;
        }
        return;
      }

      // ── Mejor vuelta ──────────────────────────────────────────────────
      if (dtype === 'blp') {
        const t = parseTime(v);
        if (t && t >= 20 && t < 300 && !isGlitchLap(k.lapHistory, t, _fieldMedian()) && (!k.bestLap || t < k.bestLap)) k.bestLap = t;
        return;
      }

      // ── Gap ───────────────────────────────────────────────────────────
      if (dtype === 'gap') {
        const vRaw = v || '';
        if (/tour|lap|tr\b/i.test(vRaw)) {
          const n = parseInt(vRaw.replace(/[^\d]/g, ''));
          k.gap = !isNaN(n) && n > 0 ? '+' + n + 'v' : '';
          return;
        }
        const raw = vRaw.replace(/[a-zA-Z]/g, '').trim();
        if (!raw) { k.gap = ''; return; }
        const t = raw.includes(':')
          ? parseFloat(raw.split(':')[0]) * 60 + parseFloat(raw.split(':')[1])
          : parseFloat(raw);
        if (!isNaN(t) && t >= 0) k.gap = t > 0 ? '+' + t.toFixed(3) : '';
        return;
      }

      // ── Intervalo ─────────────────────────────────────────────────────
      if (dtype === 'int') {
        const raw = (v || '').replace(/[a-zA-Z]/g, '').trim();
        if (!raw) { k.interval = ''; return; }
        const t = raw.includes(':')
          ? parseFloat(raw.split(':')[0]) * 60 + parseFloat(raw.split(':')[1])
          : parseFloat(raw);
        if (!isNaN(t) && t >= 0) k.interval = t > 0 ? '+' + t.toFixed(3) : '';
        return;
      }

      // ── Vueltas ───────────────────────────────────────────────────────
      if (dtype === 'tlp' || dtype === 'lc') {
        const n = parseInt(v);
        if (!isNaN(n) && n > 0) k.tours = n;
        return;
      }

      // ── Pit stops ─────────────────────────────────────────────────────
      if (dtype === 'pit') {
        if (type === 'to') {
          const s = parsePitTimer(v);
          if (s !== null) { k.pitS = s; k.pit = true; k._pitTimerActive = true; }
        } else if (type === 'in') {
          k._pitTimerActive = false;
          if (k.state === 'sr' || k.state === 'su') k.pit = false;
          const n = parseInt(v);
          if (!isNaN(n) && n > 0) k.standsCount = n;
        }
        return;
      }

      if (dtype === 'otr') return;

      // ── Sin dtype mapeado ─────────────────────────────────────────────
      if (type === 'to') {
        const s = parsePitTimer((val !== undefined && val !== '') ? val : type);
        if (s !== null) { k.pitS = s; k.pit = true; k._pitTimerActive = true; }
        return;
      }
      if (type === 'sf') { k.checkered = true; return; }
    }

    function _parseLine(line) {
      // ── TIPO DE SESIÓN: init|p| (clasi) / init|r| (carrera) ───────────
      // Apex manda esta línea de primera en cada init, antes del grid. La
      // letra p/r discrimina la fase sin depender de la elección manual.
      if (line.startsWith('init|')) {
        _sessionMode = line.split('|')[1] || '';
        if (callbacks.onMode) callbacks.onMode(_sessionMode);
        return true;
      }

      // ── VUELTA COMPLETA: r1|*|67234|24403 ────────────────────────────
      const lapM = line.match(/^(r\d+)\|\*\|(\d+)\|(\d*)$/);
      if (lapM) {
        const k  = _kart(lapM[1]);
        const ms = parseInt(lapM[2]);
        if (ms >= 20000 && ms < 300000) {
          _lastLapTime = Date.now();
          k._lapFlash  = Date.now();
          if (!k._lapInvalid) {
            const t = parseFloat((ms / 1000).toFixed(3));
            if (!_colMap.llp && !isGlitchLap(k.lapHistory, t, _fieldMedian())) {
              // Sin columna llp → |*| es la fuente de verdad de tiempos
              const lastH = k.lapHistory[k.lapHistory.length - 1];
              if (lastH === undefined || Math.abs(lastH - t) > 0.05) {
                k.lastLap = t;
                k.lapHistory.push(t); _pushRecent(t);
                if (k.lapHistory.length > 1500) k.lapHistory.shift();
                if (!k.bestLap || t < k.bestLap) k.bestLap = t;
                if (callbacks.onLap && k.dorsal)
                  callbacks.onLap(k.dorsal, k._pilotName || k.name, k._pilotName ? (k.teamName || null) : null, ms, k.lapHistory.length, Date.now());
              }
              // Anti-dedup solo cuando |*| empujó: si llp llega después refina esa entrada
              // Con colMap.llp, |*| no empuja → llp siempre crea entrada nueva (no hay nada que refinar)
              k._lapFromFlash   = t;
              k._lapFromFlashTs = Date.now();
            }
          }
          k._lapInvalid = false;
          const s1 = parseInt(lapM[3]);
          if (!isNaN(s1) && s1 > 0 && _colMap.s1) k.s1Ms = s1;
        }
        return true;
      }

      // ── VUELTA ANULADA ────────────────────────────────────────────────
      if (line.match(/^r\d+\|\*(in|out)\|0$/)) {
        _kart(line.split('|')[0])._lapInvalid = true;
        return true;
      }
      if (line.match(/^r\d+\|\*\|\|$/)) return true;

      // ── SECTOR PARCIAL ────────────────────────────────────────────────
      if (line.match(/^r\d+\|\*i\d+\|/)) return true;

      // ── POSICIÓN DIRECTA: r1|#|5 ──────────────────────────────────────
      const posM = line.match(/^(r\d+)\|#\|(\d+)$/);
      if (posM) {
        const p = parseInt(posM[2]);
        if (p > 0) {
          const k = _kart(posM[1]);
          if (k.pos && k.pos !== p) k._posChange = { from: k.pos, to: p, delta: k.pos - p, time: Date.now() };
          k.pos = p;
        }
        return true;
      }

      // ── GRID ──────────────────────────────────────────────────────────
      if (line.startsWith('grid|')) {
        const inactiveTooLong = _lastLapTime && (Date.now() - _lastLapTime) > 600000;
        if (_sessionActive && (_sessionFinished || inactiveTooLong)) {
          _karts = {}; _leaderLap = 0; _sessionFinished = false; _lastLapTime = 0; _recentLaps = [];
          if (callbacks.onNewSession) callbacks.onNewSession();
        }
        _sessionActive = true;
        if (callbacks.onGrid) callbacks.onGrid(line.substring(5));
        return true;
      }

      // ── COUNTDOWN ─────────────────────────────────────────────────────
      if (line.startsWith('dyn1|countdown|')) {
        const ms = parseInt(line.split('|')[2]) || null;
        if (ms !== null && callbacks.onCountdown) callbacks.onCountdown(ms, 'countdown');
        return true;
      }
      if (line.startsWith('dyn1|count|')) {
        const ms = parseInt(line.split('|')[2]) || null;
        if (ms !== null && callbacks.onCountdown) callbacks.onCountdown(ms, 'count');
        return true;
      }

      // ── TEXTO DYN1 ────────────────────────────────────────────────────
      if (line.startsWith('dyn1|text|')) {
        const txt = line.substring(10).trim();
        const lm  = txt.match(/(?:Lap|Vuelta)\s+(\d+)\/(\d+)/i);
        if (lm) _leaderLap = parseInt(lm[1]);
        if (!txt && callbacks.onCountdown) callbacks.onCountdown(null, 'stop');
        return true;
      }

      // ── PANEL DE LUCES: cuadros (lf) / verde (lg) / roja (lr) / amarilla (ly) ──
      // El panel emite roja también como estado de reposo ENTRE sesiones (visto
      // en la auditoría: 82% de las rojas caen sin carrera). Por eso el parser
      // solo surface la bandera cruda + si hay carrera activa; la decisión de
      // "carrera detenida/reanudada" la toma createFlagTracker con ese contexto.
      if (line.startsWith('light|')) {
        const code = line.substring(6, 8);
        if (code === 'lf') {
          _sessionFinished = true;
          if (callbacks.onSessionEnd) callbacks.onSessionEnd();
          return true;
        }
        const flag = code === 'lr' ? 'red' : code === 'lg' ? 'green' : code === 'ly' ? 'yellow' : null;
        if (flag) {
          _flag = flag;
          if (callbacks.onFlag) {
            const raceActive = _sessionActive && !_sessionFinished &&
                               !!_lastLapTime && (Date.now() - _lastLapTime) < 90000;
            callbacks.onFlag(flag, { raceActive });
          }
        }
        return true;
      }

      // ── TÍTULOS DE SESIÓN ─────────────────────────────────────────────
      if (line.startsWith('title1|')) {
        const v = line.split('|')[2] || '';
        if (v && v !== _title1) {
          _maybeNewSessionByTitle();
          _title1 = v;
          const t = [_title1, _title2].filter(Boolean).join(' · ');
          if (callbacks.onTitle) callbacks.onTitle(t);
        }
        return true;
      }
      if (line.startsWith('title2|')) {
        const v = line.split('|')[2] || '';
        if (v && v !== _title2) {
          _maybeNewSessionByTitle();
          _title2 = v;
          const t = [_title1, _title2].filter(Boolean).join(' · ');
          if (callbacks.onTitle) callbacks.onTitle(t);
        }
        return true;
      }

      // ── COMENTARIOS ───────────────────────────────────────────────────
      if (line.startsWith('com|')) {
        if (callbacks.onComment) {
          const html = line.substring(line.indexOf('|', 4) + 1);
          if (html && html.trim() && html !== '<p></p>' && html.length > 5)
            callbacks.onComment(html);
        }
        return true;
      }

      // ── CELDA CON VALOR: r1c6|ti|1:04.893 ────────────────────────────
      const cellM = line.match(/^(r\d+)(c\d+)\|([^|]*)\|(.*)/);
      if (cellM) { _applyCell(_kart(cellM[1]), cellM[2], cellM[3], cellM[4]); return true; }

      // ── CELDA SIN VALOR: r1c6|ti ──────────────────────────────────────
      const cellM2 = line.match(/^(r\d+)(c\d+)\|([^|]*)$/);
      if (cellM2) { _applyCell(_kart(cellM2[1]), cellM2[2], cellM2[3], ''); return true; }

      return false;
    }

    function getState() {
      const now = Date.now();
      const equipos = Object.values(_karts)
        .filter(k => k.dorsal || k._rowId)
        .map(k => {
          if (!k.dorsal) k.dorsal = k._rowId.replace('r', '');
          return {
            dorsal: k.dorsal, name: k.name || `#${k.dorsal}`, teamName: k.teamName || null,
            pos: k.pos || 99, lastLap: k.lastLap || null, bestLap: k.bestLap || null,
            lapHistory: k.lapHistory || [], gap: k.gap || '', interval: k.interval || '',
            pit: !!k.pit, pitState: k.pitState || null,
            pitS: k._pitTimerActive ? k.pitS : (k.pit && k._pitInTime ? Math.round((now - k._pitInTime) / 1000) : k.pitS || 0),
            pitDuration: k.pitDuration || 0,
            state: k.state || 'sr', s1: k.s1, s2: k.s2, s3: k.s3,
            tours: Math.max(k.tours || 0, (k.lapHistory || []).length), standsCount: k.standsCount || 0, stops: k.stops || 0,
            checkered: !!k.checkered, gapMs: k.gapMs || 0,
            lapFlash: !!(k._lapFlash && (now - k._lapFlash) < 2000),
            posChange: k._posChange && (now - k._posChange.time) < 5000 ? k._posChange : null,
            sessionFinished: _sessionFinished,
          };
        })
        .sort((a, b) => a.pos === 99 && b.pos === 99
          ? parseInt(a.dorsal) - parseInt(b.dorsal)
          : a.pos - b.pos);
      return { equipos, leaderLap: _leaderLap, timestamp: now, sessionFinished: _sessionFinished, colMap: _colMap,
               title1: _title1, title2: _title2, sessionMode: _sessionMode, flag: _flag };
    }

    return {
      parse(raw) {
        const lines = raw.split('\n');
        let changed = false;
        for (let line of lines) {
          line = line.trim();
          if (!line) continue;
          if (_parseLine(line)) changed = true;
        }
        if (changed && callbacks.onChange) callbacks.onChange(getState());
      },

      // Llamado por el wrapper tras parsear el HTML del grid con DOMParser/node-html-parser
      setGrid({ colMap, colByNum, karts: gridKarts } = {}) {
        _colMap   = colMap   || {};
        _colByNum = colByNum || {};

        // Detección de nueva sesión por cambio de parrilla: si el grid entrante comparte
        // pocos dorsales con el estado actual, es una parrilla nueva y hay que limpiar el
        // estado para no acumular vueltas de la sesión anterior (grids repetidos sin
        // bandera a cuadros previa). Exige ≥3 karts a cada lado para evitar falsos positivos.
        const _newDorsals = new Set((gridKarts || []).map(kg => kg.dorsal).filter(Boolean));
        if (_newDorsals.size >= 3) {
          const _curDorsals = Object.values(_karts).map(k => k.dorsal).filter(Boolean);
          if (_curDorsals.length >= 3) {
            const _overlap = _curDorsals.filter(d => _newDorsals.has(d)).length;
            if (_overlap < _curDorsals.length * 0.4) {
              _karts = {}; _leaderLap = 0; _sessionFinished = false; _lastLapTime = 0; _recentLaps = [];
              if (callbacks.onNewSession) callbacks.onNewSession();
            }
          }
        }

        for (const kg of (gridKarts || [])) {
          const k = _kart(kg.rowId);
          if (kg.state && kg.state !== 'in') { k.state = kg.state; if (kg.state === 'sf') k.checkered = true; }
          if (kg.pos)                          k.pos          = kg.pos;
          if (kg.dorsal)                       k.dorsal       = kg.dorsal;
          if (kg.pilotName && !k._pilotName) k._pilotName = kg.pilotName; // nombre con [X:XX] confirmado
          if (kg.name) {
            const pm = kg.name.match(/^(.*?)\s*\[\d+:\d+\]$/);
            if (pm) {
              if (!k.name) k.name = pm[1].trim();
              if (!k._pilotName) k._pilotName = pm[1].trim();
            }
            else { if (!k.teamName) k.teamName = kg.name; if (!k.name) k.name = kg.name; }
          }
          if (kg.bestLap && !k.bestLap && !isGlitchLap(k.lapHistory, kg.bestLap, _fieldMedian())) k.bestLap = kg.bestLap;
          if (kg.lastLap && !k.lastLap)        k.lastLap      = kg.lastLap;
          if (kg.tours)                        k.tours        = kg.tours;
          if (kg.standsCount !== undefined)    k.standsCount  = kg.standsCount;
          k.tours = k.tours || 0;
        }
      },

      getState,
      reset() {
        _karts = {}; _colMap = {}; _colByNum = {};
        _sessionActive = false; _sessionFinished = false;
        _leaderLap = 0; _lastLapTime = 0; _title1 = ''; _title2 = ''; _sessionMode = ''; _recentLaps = []; _flag = null;
      },

      get colMap()          { return _colMap; },
      get sessionFinished() { return _sessionFinished; },
      get leaderLap()       { return _leaderLap; },
      get sessionMode()     { return _sessionMode; },
      get kartCount()       { return Object.values(_karts).filter(k => k.dorsal).length; },

      // Listado de rowId → dorsal para fetch HTTP externo
      getKartIds() {
        return Object.entries(_karts)
          .filter(([, k]) => k.dorsal)
          .map(([rowId, k]) => ({ rowId, dorsal: k.dorsal }));
      },

      // Inyectar historial de vueltas desde fuente HTTP (Apex REST)
      // HTTP va al principio (historial antiguo), WS permanece al final (más reciente)
      // Nunca sobreescribe lastLap — el WS (llp/|*|) es la fuente de verdad para Última
      mergeHttpHistory(rowId, lapTimes, tourCount) {
        const k = _kart(rowId);
        if (!lapTimes.length) return;
        const current = k.lapHistory;
        const toAdd   = lapTimes.filter(t => !current.some(l => Math.abs(l - t) < 0.05));
        k.lapHistory  = [...toAdd, ...current];
        if (k.lapHistory.length > 1500) k.lapHistory = k.lapHistory.slice(-1500);
        k.tours = Math.max(k.tours || 0, tourCount);
        const best = Math.min(...k.lapHistory.filter(t => t >= 20 && t < 300 && !isGlitchLap(k.lapHistory, t, _fieldMedian())));
        if (!isNaN(best) && (!k.bestLap || best < k.bestLap)) k.bestLap = best;
      },
    };
  }

  // ── Ancla de salida oficial (canal com| de dirección de carrera) ──────────
  // Apex publica el cronograma como HTML acumulativo, evento más reciente
  // primero, y REENVÍA el historial completo de la sesión en cada mensaje:
  //   <p><b>18:15</b><span data-flag="green"></span>Start</p>
  // La etiqueta ("Start"/"Départ"/"Partenza") depende del idioma; data-flag no.
  // Una verde nueva en cabeza = salida real (el mensaje llega segundos después
  // de ondear la bandera). Gracias al historial, una conexión a mitad de carrera
  // también recupera la hora de salida (precisión de minuto).
  //
  // Lógica compartida por el logger (circuit-monitor) y el conector directo de
  // la app (apex-connector): ambos reciben el mismo com| replayeado al conectar.
  // `ingest(html, { raceInProgress })` → devuelve el ancla {at, clock, source}
  // SOLO cuando cambia (verde nueva); null en cualquier otro caso.
  function createRaceStartTracker() {
    let _raceStart = null;    // {at, clock, source:'live'|'history'}
    let _timeline  = [];
    const _seen    = new Set();
    let _primed    = false;

    // Hora de pared HH:MM del cronograma → instante más reciente ≤ ahora con esa
    // hora. Los circuitos actuales (ES/FR/IT/BE/NL) comparten huso Europe/Madrid.
    function _clockToEpoch(hhmm) {
      try {
        const [h, min] = hhmm.split(':').map(Number);
        if (isNaN(h) || isNaN(min)) return null;
        const [nh, nm] = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).format(new Date()).split(':').map(Number);
        let diffMin = (nh * 60 + nm) - (h * 60 + min);
        if (diffMin < 0) diffMin += 24 * 60; // esa hora aún no ha pasado hoy → fue ayer
        return Date.now() - diffMin * 60000;
      } catch (e) { return null; }
    }

    function ingest(html, opts = {}) {
      const entries = [];
      const re = /<p><b>(\d{1,2}:\d{2})<\/b><span data-flag="([a-z]+)"><\/span>([^<]*)<\/p>/g;
      let m;
      while ((m = re.exec(html)) !== null)
        entries.push({ clock: m[1], flag: m[2], label: m[3].trim() });
      if (!entries.length) return null;
      _timeline = entries;

      if (!_primed) {
        // Primer com| tras conectar: es un replay del historial, no eventos en
        // vivo (anclar con Date.now() aquí marcaría como salida el momento de
        // conexión). Sembrar lo visto y, si hay carrera EN MARCHA (la entrada
        // más reciente es una verde), reconstruir desde su HH:MM.
        _primed = true;
        for (const e of entries) _seen.add(e.clock + '|' + e.flag);
        if (entries[0].flag === 'green') {
          const at = _clockToEpoch(entries[0].clock);
          if (at && Date.now() - at < 8 * 3600000) {
            _raceStart = { at, clock: entries[0].clock, source: 'history' };
            return _raceStart;
          }
        }
        return null;
      }

      const newest = entries[0];
      const isNew  = !_seen.has(newest.clock + '|' + newest.flag);
      for (const e of entries) _seen.add(e.clock + '|' + e.flag);
      if (!isNew || newest.flag !== 'green') return null;

      // Verde con carrera ya en marcha y ancla fijada = reanudación tras una
      // interrupción (roja→verde) → se conserva el ancla original de la salida.
      if (opts.raceInProgress && _raceStart) return null;

      // Publicada en vivo → Date.now(). Si la hora de pared queda >2 min atrás,
      // la verde ondeó durante un hueco de reconexión → mejor la hora de pared.
      let at = Date.now();
      const fromClock = _clockToEpoch(newest.clock);
      if (fromClock && at - fromClock > 2 * 60000) at = fromClock;
      _raceStart = { at, clock: newest.clock, source: 'live' };
      return _raceStart;
    }

    return {
      ingest,
      get raceStart() { return _raceStart; },
      get timeline()  { return _timeline; },
      // Fin de sesión (bandera a cuadros): el ancla ya quedó persistida; que no
      // la herede la sesión siguiente.
      clear() { _raceStart = null; },
      // Sesión nueva detectada por el parser: la verde de la sesión entrante
      // suele llegar ANTES → un ancla reciente se conserva; una vieja (>30 min,
      // de la carrera anterior acabada sin bandera) se descarta.
      onNewSession() { if (_raceStart && Date.now() - _raceStart.at > 30 * 60000) _raceStart = null; },
    };
  }

  // ── Estado de carrera detenida por bandera roja ───────────────────────────
  // Convierte el flujo crudo de banderas (onFlag del parser) en eventos de alto
  // nivel "detenida"/"reanudada". Solo una ROJA con carrera activa detiene: las
  // rojas de reposo entre sesiones (82% en la auditoría) NO tienen carrera
  // activa y se ignoran. La reanudación es la primera verde tras una detención.
  // La amarilla se guarda como bandera cruda (para el cartel) pero no detiene.
  // Compartido por el logger (circuit-monitor) y el conector directo de la app.
  function createFlagTracker() {
    let _flag      = null;   // última bandera cruda vista: 'green'|'red'|'yellow'
    let _stopped   = false;  // ¿carrera detenida por roja con carrera activa?
    let _stoppedAt = null;   // timestamp de la roja que detuvo

    // Devuelve {type:'stopped'|'resumed', ...} SOLO en la transición; si no, null.
    function ingest(flag, opts = {}) {
      _flag = flag;
      if (flag === 'red' && opts.raceActive && !_stopped) {
        _stopped = true; _stoppedAt = Date.now();
        return { type: 'stopped', at: _stoppedAt };
      }
      if (flag === 'green' && _stopped) {
        const at = _stoppedAt;
        _stopped = false; _stoppedAt = null;
        return { type: 'resumed', at: Date.now(), stoppedAt: at, durationMs: at ? Date.now() - at : null };
      }
      return null;
    }

    return {
      ingest,
      get flag()      { return _flag; },
      get stopped()   { return _stopped; },
      get stoppedAt() { return _stoppedAt; },
      // Fin de sesión / sesión nueva: la carrera siguiente arranca sin detención.
      reset() { _flag = null; _stopped = false; _stoppedAt = null; },
    };
  }

  return { createParser, parseTime, isGlitchLap, createRaceStartTracker, createFlagTracker };
});
