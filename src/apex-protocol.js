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

  // ── Factory ───────────────────────────────────────────────────────────────

  function createParser(callbacks = {}) {
    let _karts           = {};
    let _colMap          = {};
    let _colByNum        = {};
    let _sessionActive   = false;
    let _sessionFinished = false;
    let _leaderLap       = 0;
    let _lastLapTime     = 0;

    function _kart(rowId) {
      if (!_karts[rowId]) _karts[rowId] = {
        _rowId: rowId, lapHistory: [], state: 'sr', tours: 0,
        pit: false, pitState: null, pitS: 0, pitDuration: 0,
        standsCount: 0, _lapInvalid: false, checkered: false,
        _lapFlash: 0, _pitInTime: null, _pitTimerActive: false,
        _lapFromFlash: undefined, _lapFromFlashTs: 0,
        _pilotName: undefined, // solo se actualiza con nombres que llevan [X:XX] (carreras por equipos)
      };
      return _karts[rowId];
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
          if (callbacks.onPit && k.dorsal) callbacks.onPit(k.dorsal, 'in', k.standsCount, Date.now());
        } else if (type === 'so') {
          k.pit = true; k.pitState = 'out'; k.pitS = 0; k._pitTimerActive = false; k._pitInTime = null;
          k._lapInvalid = true;
          if (callbacks.onPit && k.dorsal) callbacks.onPit(k.dorsal, 'out', k.standsCount, Date.now());
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
        if (d && !isNaN(parseInt(d))) k.dorsal = d;
        return;
      }

      // ── Nombre ────────────────────────────────────────────────────────
      if (dtype === 'dr') {
        const n = (v || '').trim();
        if (n && n.length > 1 && isNaN(parseInt(n)) && !SKIP_NAMES.has(n)) {
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

      // ── Última vuelta ─────────────────────────────────────────────────
      if (dtype === 'llp') {
        const t = parseTime(v);
        if (t && t >= 20 && t < 300) {
          const flashAge = k._lapFromFlashTs ? Date.now() - k._lapFromFlashTs : Infinity;
          if (k._lapFromFlash !== undefined && flashAge < 5000 && k.lapHistory.length) {
            // Refinamiento: llp llegó poco después de |*| (misma vuelta)
            k.lapHistory[k.lapHistory.length - 1] = t;
            k.lastLap = t;
            if (!k.bestLap || t < k.bestLap) k.bestLap = t;
          } else {
            // Vuelta nueva (sin |*| previo, o llp tardío)
            k.lastLap = t;
            k.lapHistory.push(t);
            if (k.lapHistory.length > 1500) k.lapHistory.shift();
            if (!k.bestLap || t < k.bestLap) k.bestLap = t;
            if (callbacks.onLap && k.dorsal)
              callbacks.onLap(k.dorsal, k._pilotName || k.name, Math.round(t * 1000), k.lapHistory.length, Date.now());
          }
          k._lapFromFlash  = undefined;
          k._lapFromFlashTs = 0;
        }
        return;
      }

      // ── Mejor vuelta ──────────────────────────────────────────────────
      if (dtype === 'blp') {
        const t = parseTime(v);
        if (t && t >= 20 && t < 300 && (!k.bestLap || t < k.bestLap)) k.bestLap = t;
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
            if (!_colMap.llp) {
              // Sin columna llp → |*| es la fuente de verdad de tiempos
              const lastH = k.lapHistory[k.lapHistory.length - 1];
              if (lastH === undefined || Math.abs(lastH - t) > 0.05) {
                k.lastLap = t;
                k.lapHistory.push(t);
                if (k.lapHistory.length > 1500) k.lapHistory.shift();
                if (!k.bestLap || t < k.bestLap) k.bestLap = t;
                if (callbacks.onLap && k.dorsal)
                  callbacks.onLap(k.dorsal, k._pilotName || k.name, ms, k.lapHistory.length, Date.now());
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
          _karts = {}; _leaderLap = 0; _sessionFinished = false; _lastLapTime = 0;
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
        const lm  = txt.match(/Lap\s+(\d+)\/(\d+)/i);
        if (lm) _leaderLap = parseInt(lm[1]);
        if (!txt && callbacks.onCountdown) callbacks.onCountdown(null, 'stop');
        return true;
      }

      // ── BANDERA A CUADROS ─────────────────────────────────────────────
      if (line.startsWith('light|lf')) {
        _sessionFinished = true;
        if (callbacks.onSessionEnd) callbacks.onSessionEnd();
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
            tours: k.tours || 0, standsCount: k.standsCount || 0, stops: k.stops || 0,
            checkered: !!k.checkered, gapMs: k.gapMs || 0,
            lapFlash: !!(k._lapFlash && (now - k._lapFlash) < 2000),
            posChange: k._posChange && (now - k._posChange.time) < 5000 ? k._posChange : null,
            sessionFinished: _sessionFinished,
          };
        })
        .sort((a, b) => a.pos === 99 && b.pos === 99
          ? parseInt(a.dorsal) - parseInt(b.dorsal)
          : a.pos - b.pos);
      return { equipos, leaderLap: _leaderLap, timestamp: now, sessionFinished: _sessionFinished, colMap: _colMap };
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
          if (kg.bestLap && !k.bestLap)        k.bestLap      = kg.bestLap;
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
        _leaderLap = 0; _lastLapTime = 0;
      },

      get colMap()          { return _colMap; },
      get sessionFinished() { return _sessionFinished; },
      get leaderLap()       { return _leaderLap; },
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
        const best = Math.min(...k.lapHistory.filter(t => t >= 20 && t < 300));
        if (!isNaN(best) && (!k.bestLap || best < k.bestLap)) k.bestLap = best;
      },
    };
  }

  return { createParser, parseTime };
});
