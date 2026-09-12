'use strict';
// Caja negra de diagnóstico. Aislada, fail-safe: NUNCA puede romper la carrera.

const MAX_EVENTS = 5000;
const MAX_MS = 30 * 60 * 1000;

function _makeRing(maxEvents, maxMs){
  let buf = [];
  return {
    push(ev){
      buf.push(ev);
      const cutoff = ev.ts - maxMs;
      while (buf.length && buf[0].ts < cutoff) buf.shift();
      if (buf.length > maxEvents) buf = buf.slice(buf.length - maxEvents);
    },
    snapshot(){ return buf.slice(); },
    clear(){ buf = []; },
    get size(){ return buf.length; }
  };
}

// _scrub: en Task 2 redacta secretos/PII. De momento, identidad segura.
function _scrub(v){ return v; }

const _theRing = _makeRing(MAX_EVENTS, MAX_MS);

function event(grifo, tipo, datos){
  try {
    _theRing.push({ ts: Date.now(), grifo, tipo, datos: _scrub(datos) });
  } catch (_) { /* fail-safe: jamás propaga */ }
}

function clear(){ try { _theRing.clear(); } catch(_){} }

const Blackbox = { event, clear, _makeRing, _scrub, _ring: () => _theRing, MAX_EVENTS, MAX_MS };

if (typeof window !== 'undefined') window.Blackbox = Blackbox;
if (typeof module !== 'undefined') module.exports = Blackbox;
