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

// Escrutinio de CONTENIDO de strings: enmascara credenciales/tokens y URLs con
// usuario:contraseña. Patrones conservadores para no tocar telemetría normal
// (números, tiempos de vuelta, dorsales). NOTA: no intenta borrar nombres de
// piloto embebidos en un string de error crudo (no son detectables por patrón);
// es una limitación aceptada y documentada.
const _STR_URLCRED_RE = /([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;
const _STR_BEARER_RE  = /\bbearer\s+\S+/gi;
const _STR_SECRET_RE  = /\b(api[_-]?key|key|token|secret|password|bearer|authorization)\b(\s*[:=]\s*)(\S+)/gi;

function _scrubString(s){
  try {
    return s
      .replace(_STR_URLCRED_RE, '$1[redactado]@')
      .replace(_STR_BEARER_RE, 'Bearer [redactado]')
      .replace(_STR_SECRET_RE, (m, kw, sep) => kw + sep + '[redactado]');
  } catch (_) { return s; }
}

function _scrub(v, seen){
  seen = seen || new Set();
  if (typeof v === 'string') return _scrubString(v);
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

let _store = null;               // se inyecta (_setStore) o se crea el IDB real en el navegador
const _meta = { app: null, circuito: null, sesion: null, estadoConexion: null };

function setMeta(m){ Object.assign(_meta, m || {}); }
function _setStore(s){ _store = s; }

function _sesionKey(){
  const d = new Date().toISOString().slice(0, 10);
  return `${d}_${_meta.circuito || 'sin-circuito'}_${_meta.sesion != null ? _meta.sesion : 0}`;
}

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

async function _flush(){
  if (!_store) return;
  // Sin eventos ni circuito no hay nada que guardar: admin.html carga su propia
  // copia del módulo y llenaba IndexedDB de claves vacías "…_sin-circuito_0".
  if (!_theRing.size && !_meta.circuito) return;
  const payload = _serialize(_theRing.snapshot(), _meta);
  await _store.put(_sesionKey(), payload);
}

// Clave → día (YYYY-MM-DD) dentro de los últimos `days` días
const RETAIN_DAYS = 7;
function _keyDay(k){ return String(k).slice(0, 10); }
function _cutoffDay(days){ return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); }

// La carrera guardada más reciente de los últimos días (no solo la de hoy UTC:
// una carrera de ayer o que cruza la medianoche UTC también cuenta).
async function recoverLast(days){
  if (!_store) return null;
  const desde = _cutoffDay(days != null ? days : RETAIN_DAYS);
  const actual = _sesionKey();
  const keys = (await _store.listKeys())
    .filter(k => _keyDay(k) >= desde && k !== actual);
  if (!keys.length) return null;
  let best = null, bestHasta = -Infinity;
  for (const key of keys) {
    const payload = await _store.get(key);
    if (!payload) continue;
    const hasta = (payload.resumen && payload.resumen.hasta != null) ? payload.resumen.hasta : -Infinity;
    if (!best || hasta > bestHasta) { best = { key, resumen: payload.resumen }; bestHasta = hasta; }
  }
  return best;
}

function _filename(circuito){
  const n = new Date();
  const p = x => String(x).padStart(2, '0');
  const stamp = `${n.getFullYear()}-${p(n.getMonth()+1)}-${p(n.getDate())}_${p(n.getHours())}${p(n.getMinutes())}`;
  return `stintpro-blackbox_${circuito || _meta.circuito || 'sesion'}_${stamp}.json`;
}

// Sin clave: lo que lleva esta página (ring en memoria). Con clave: la carrera
// guardada en IndexedDB — es lo que exporta admin → Diagnóstico, cuya copia del
// módulo no tiene en memoria los eventos de la carrera (los grabó index.html).
async function exportLog(key){
  let payload = null;
  if (key && _store) payload = await _store.get(key);
  if (!payload) {
    await _flush();
    payload = _serialize(_theRing.snapshot(), _meta);
  }
  const filename = _filename(payload.resumen && payload.resumen.circuito);
  if (typeof document !== 'undefined' && typeof Blob !== 'undefined') {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { filename, payload };
}

// Sin clave: el log de esta página. Con clave: esa carrera guardada.
async function clear(key){
  if (key) { try { if (_store) await _store.del(key); } catch(_){} return; }
  try { _theRing.clear(); } catch(_){}
  try { if (_store) await _store.del(_sesionKey()); } catch(_){}
}

// Cada conexión abre una clave nueva (sesion = Date.now()) de hasta 5000
// eventos: sin limpieza IndexedDB crecía sin fin. Se borra lo de más de N días.
async function gc(days){
  if (!_store) return;
  const desde = _cutoffDay(days != null ? days : RETAIN_DAYS);
  try {
    for (const k of await _store.listKeys()) if (_keyDay(k) < desde) await _store.del(k);
  } catch (_) { /* fail-safe */ }
}

// _armAutoFlush: vuelca a IndexedDB de forma periódica y en eventos de ciclo de
// vida (visibilitychange oculto + beforeunload). Sin esto la caja negra solo se
// guardaría en el export manual y NO sobreviviría a un reload/crash. Todos los
// callbacks van envueltos en try/catch: jamás pueden romper la carrera.
let _autoFlushArmed = false;
function _armAutoFlush(opts){
  opts = opts || {};
  const intervalMs     = opts.intervalMs != null ? opts.intervalMs : 5000;
  const setIntervalFn  = 'setIntervalFn'  in opts ? opts.setIntervalFn  : (typeof setInterval  !== 'undefined' ? setInterval  : null);
  const clearIntervalFn= 'clearIntervalFn' in opts ? opts.clearIntervalFn : (typeof clearInterval !== 'undefined' ? clearInterval : null);
  const doc            = 'doc' in opts ? opts.doc : (typeof document !== 'undefined' ? document : null);
  const win            = 'win' in opts ? opts.win : (typeof window   !== 'undefined' ? window   : null);

  if (_autoFlushArmed) return function(){};   // no apilar intervalos duplicados
  _autoFlushArmed = true;

  const safeFlush = () => {
    try {
      const p = _flush();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) { /* fail-safe */ }
  };
  const onVis = () => { try { if (doc && doc.visibilityState === 'hidden') safeFlush(); } catch (_) {} };
  const onUnload = () => { safeFlush(); };

  let timer = null;
  if (typeof setIntervalFn === 'function') {
    try { timer = setIntervalFn(safeFlush, intervalMs); } catch (_) {}
  }
  if (doc && typeof doc.addEventListener === 'function') {
    try { doc.addEventListener('visibilitychange', onVis); } catch (_) {}
  }
  if (win && typeof win.addEventListener === 'function') {
    try { win.addEventListener('beforeunload', onUnload); } catch (_) {}
  }

  return function stop(){
    try { if (timer != null && typeof clearIntervalFn === 'function') clearIntervalFn(timer); } catch (_) {}
    try { if (doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVis); } catch (_) {}
    try { if (win && typeof win.removeEventListener === 'function') win.removeEventListener('beforeunload', onUnload); } catch (_) {}
    _autoFlushArmed = false;
  };
}

function _idbStore(dbName, storeName){
  // Con flush cada ~5s, abrir indexedDB.open() por operación abriría miles de
  // conexiones en una carrera de 24h. Memoizamos la conexión y la reutilizamos;
  // si se cierra o falla, se permite reabrir (se anula la caché).
  let _dbPromise = null;
  function open(){
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((res, rej) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(storeName);
      req.onsuccess = () => {
        const db = req.result;
        try {
          db.onclose = () => { _dbPromise = null; };
          db.onerror = () => { _dbPromise = null; };
        } catch (_) {}
        res(db);
      };
      req.onerror = () => { _dbPromise = null; rej(req.error); };
    });
    _dbPromise.catch(() => { _dbPromise = null; });   // reintento tras rechazo
    return _dbPromise;
  }
  function tx(mode, fn){
    return open().then(db => new Promise((res, rej) => {
      let t;
      try { t = db.transaction(storeName, mode); }
      catch (e) { _dbPromise = null; return rej(e); }   // conexión inválida → reabrir
      const s = t.objectStore(storeName);
      const out = fn(s);
      t.oncomplete = () => res(out._result);
      t.onerror = () => rej(t.error);
    }));
  }
  return {
    put(k, v){ return tx('readwrite', s => { s.put(v, k); return {}; }); },
    get(k){ return tx('readonly', s => { const r = s.get(k); const o = {}; r.onsuccess = () => o._result = r.result || null; return o; }); },
    listKeys(){ return tx('readonly', s => { const r = s.getAllKeys(); const o = {}; r.onsuccess = () => o._result = r.result || []; return o; }); },
    del(k){ return tx('readwrite', s => { s.delete(k); return {}; }); },
  };
}

const Blackbox = {
  event, clear, _makeRing, _scrub, _serialize, _ring: () => _theRing, MAX_EVENTS, MAX_MS,
  setMeta, _setStore, _flush, recoverLast, export: exportLog, gc, _idbStore, _armAutoFlush,
};

if (typeof window !== 'undefined') window.Blackbox = Blackbox;
if (typeof module !== 'undefined') module.exports = Blackbox;

if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
  try {
    _setStore(_idbStore('stintpro', 'blackbox')); _armAutoFlush();
    const p = gc(); if (p && p.catch) p.catch(() => {});
  } catch(_){}
}
