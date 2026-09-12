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
  const payload = _serialize(_theRing.snapshot(), _meta);
  await _store.put(_sesionKey(), payload);
}

async function recoverLast(){
  if (!_store) return null;
  const hoy = new Date().toISOString().slice(0, 10);
  const actual = _sesionKey();
  const keys = (await _store.listKeys())
    .filter(k => k.startsWith(hoy) && k !== actual)
    .sort();
  if (!keys.length) return null;
  const key = keys[keys.length - 1];
  const payload = await _store.get(key);
  return payload ? { key, resumen: payload.resumen } : null;
}

function _filename(){
  const n = new Date();
  const p = x => String(x).padStart(2, '0');
  const stamp = `${n.getFullYear()}-${p(n.getMonth()+1)}-${p(n.getDate())}_${p(n.getHours())}${p(n.getMinutes())}`;
  return `stintpro-blackbox_${_meta.circuito || 'sesion'}_${stamp}.json`;
}

async function exportLog(){
  await _flush();
  const payload = _serialize(_theRing.snapshot(), _meta);
  const filename = _filename();
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

async function clear(){
  try { _theRing.clear(); } catch(_){}
  try { if (_store) await _store.del(_sesionKey()); } catch(_){}
}

function _idbStore(dbName, storeName){
  function open(){
    return new Promise((res, rej) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(storeName);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  function tx(mode, fn){
    return open().then(db => new Promise((res, rej) => {
      const t = db.transaction(storeName, mode);
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
  setMeta, _setStore, _flush, recoverLast, export: exportLog, _idbStore,
};

if (typeof window !== 'undefined') window.Blackbox = Blackbox;
if (typeof module !== 'undefined') module.exports = Blackbox;

if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
  try { _setStore(_idbStore('stintpro', 'blackbox')); } catch(_){}
}
