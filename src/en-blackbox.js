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

// _scrub: redacta secretos/PII con copia profunda.
const _SECRET_RE = /api[_-]?key|token|secret|password|bearer|authorization/i;
const _NAME_RE   = /^(nombre|piloto|driver|name|fullname)$/i;

function _scrub(v, seen){
  seen = seen || new Set();
  if (v === null || typeof v !== 'object') return v;
  if (seen.has(v)) return '[circular]';
  seen.add(v);
  if (Array.isArray(v)) return v.map(x => _scrub(x, seen));
  const out = {};
  for (const k of Object.keys(v)) {
    if (_NAME_RE.test(k)) continue;               // PII: fuera
    if (_SECRET_RE.test(k)) { out[k] = '[redactado]'; continue; }
    out[k] = _scrub(v[k], seen);
  }
  return out;
}

const _theRing = _makeRing(MAX_EVENTS, MAX_MS);

function event(grifo, tipo, datos){
  try {
    _theRing.push({ ts: Date.now(), grifo, tipo, datos: _scrub(datos) });
  } catch (_) { /* fail-safe: jamás propaga */ }
}

function clear(){ try { _theRing.clear(); } catch(_){} }

function _serialize(events, meta){
  meta = meta || {};
  const porTipo = {};
  for (const e of events) {
    const k = e.grifo + ':' + e.tipo;
    porTipo[k] = (porTipo[k] || 0) + 1;
  }
  const ultimosErrores = events.filter(e => e.tipo === 'error').slice(-10);
  return {
    resumen: {
      app: meta.app || null,
      circuito: meta.circuito || null,
      sesion: meta.sesion != null ? meta.sesion : null,
      desde: events.length ? events[0].ts : null,
      hasta: events.length ? events[events.length - 1].ts : null,
      totalEventos: events.length,
      porTipo,
      ultimosErrores,
      estadoConexion: meta.estadoConexion || null,
    },
    eventos: events,
  };
}

const Blackbox = { event, clear, _makeRing, _scrub, _serialize, _ring: () => _theRing, MAX_EVENTS, MAX_MS };

if (typeof window !== 'undefined') window.Blackbox = Blackbox;
if (typeof module !== 'undefined') module.exports = Blackbox;
