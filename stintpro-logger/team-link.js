'use strict';
// Mensajes del panel al piloto en pista.
// En resistencia cada piloto lleva su móvil y todos se suscriben al mismo dorsal.
// El panel publica la lista de pilotos y cuál va en pista (team_roster); cada
// móvil se suscribe con su índice en esa lista; un team_msg con `pilot` solo
// llega a los móviles de ese índice. Todo en memoria: tras un reinicio el
// panel republica la lista al reconectar.
// Latido (solo móviles): un socket medio abierto (el móvil perdió cobertura sin
// cerrar) seguiría contando como «Entregado». Cada heartbeatMs se le hace ping;
// si no contestó pong desde el ping anterior se corta → presencia al día.

const TONES       = new Set(['red', 'orange', 'blue']);
const MAX_PILOTS  = 10;   // = MAX_PILOTS del panel (src/en-race-config.js)
const MAX_NAME    = 40;
const MAX_DORSAL  = 16;
const MAX_TEXT    = 500;  // team_msg sin piloto (compatibilidad)
const MAX_TEXT_TO = 40;   // team_msg dirigido: se lee de un vistazo en el kart
const MAX_ID      = 64;
const OPEN        = 1;

function send(ws, obj) {
  if (ws.readyState === OPEN) try { ws.send(JSON.stringify(obj)); } catch (e) {}
}

function cleanDorsal(v) { return String(v ?? '').trim(); }

function validateRoster(msg) {
  const dorsal = cleanDorsal(msg.dorsal);
  if (!dorsal || dorsal.length > MAX_DORSAL) return { error: 'dorsal requerido (≤16)' };
  if (!Array.isArray(msg.pilotos) || msg.pilotos.length < 1 || msg.pilotos.length > MAX_PILOTS) {
    return { error: 'pilotos: entre 1 y 10' };
  }
  const pilotos = msg.pilotos.map(p => String(p ?? '').trim());
  if (pilotos.some(p => !p || p.length > MAX_NAME)) return { error: 'nombre de piloto vacío o de más de 40' };
  const current = msg.current ?? null;
  if (current !== null && !(Number.isInteger(current) && current >= 0 && current < pilotos.length)) {
    return { error: 'current fuera de rango' };
  }
  return { dorsal, pilotos, current };
}

function validatePilotIndex(v) {
  if (v === undefined || v === null) return { pilot: null };
  if (!Number.isInteger(v) || v < 0 || v >= MAX_PILOTS) return { error: 'pilot inválido' };
  return { pilot: v };
}

function validateTeamMsg(msg) {
  const dorsal = cleanDorsal(msg.dorsal);
  const text   = String(msg.text ?? '').trim();
  if (!dorsal || !text) return { error: 'slug, dorsal y text requeridos' };
  if (dorsal.length > MAX_DORSAL || text.length > MAX_TEXT) {
    return { error: 'dorsal (≤16) o text (≤500) demasiado largos' };
  }
  const p = validatePilotIndex(msg.pilot);
  if (p.error) return p;
  if (p.pilot !== null && text.length > MAX_TEXT_TO) return { error: 'text (≤40) demasiado largo para el piloto' };
  const tone = msg.tone ?? 'orange';
  if (!TONES.has(tone)) return { error: 'tone inválido' };
  const id = msg.id ?? null;
  if (id !== null && (typeof id !== 'string' || id.length > MAX_ID)) return { error: 'id inválido' };
  return { dorsal, text, pilot: p.pilot, tone, id };
}

function createTeamLink({ heartbeatMs = 10000 } = {}) {
  const rosters = new Map();  // `${slug}|${dorsal}` → { dorsal, pilotos, current, publishers:Set<ws> }
  const pilots  = new Map();  // ws (móvil) → { key, pilot:number|null }
  const keyOf   = (slug, dorsal) => `${slug}|${dorsal}`;

  // Latido: en cada vuelta, el móvil que no contestó el ping anterior se corta
  // (y sale de la presencia ya, sin esperar al 'close'); el resto, nuevo ping.
  // Fallo detectado en ≤ 2·heartbeatMs (~20 s). Los paneles no entran.
  function beat() {
    for (const ws of [...pilots.keys()]) {
      if (ws._teamLinkAwaitingPong) {
        try { ws.terminate(); } catch (e) {}
        drop(ws);
        continue;
      }
      ws._teamLinkAwaitingPong = true;
      try { ws.ping(); } catch (e) {}
    }
  }
  const timer = heartbeatMs > 0 ? setInterval(beat, heartbeatMs) : null;
  if (timer && timer.unref) timer.unref();
  function stop() { if (timer) clearInterval(timer); }

  function hook(ws) {
    if (ws._teamLinkHooked) return;
    ws._teamLinkHooked = true;
    ws.on('close', () => drop(ws));
  }

  function connectedFor(key) {
    const s = new Set();
    for (const e of pilots.values()) if (e.key === key && e.pilot !== null) s.add(e.pilot);
    return [...s].sort((a, b) => a - b);
  }

  // A los paneles del dorsal (o solo a `only`): qué pilotos tienen móvil conectado.
  function presence(key, only) {
    const r = rosters.get(key);
    if (!r) return;
    const msg = { type: 'pilot_presence', dorsal: r.dorsal, connected: connectedFor(key) };
    for (const ws of (only ? [only] : r.publishers)) send(ws, msg);
  }

  function setRoster(ws, slug, roster) {
    const key = keyOf(slug, roster.dorsal);
    let r = rosters.get(key);
    if (!r) { r = { dorsal: roster.dorsal, publishers: new Set() }; rosters.set(key, r); }
    r.pilotos = roster.pilotos;
    r.current = roster.current;
    r.publishers.add(ws);
    hook(ws);
    const out = { type: 'team_roster', pilotos: r.pilotos, current: r.current };
    for (const [m, e] of pilots) if (e.key === key) send(m, out);
    presence(key, ws);
  }

  function getRoster(slug, dorsal) {
    const r = rosters.get(keyOf(slug, cleanDorsal(dorsal)));
    return r ? { pilotos: r.pilotos, current: r.current } : null;
  }

  function registerPilot(ws, slug, dorsal, pilot) {
    const key  = keyOf(slug, cleanDorsal(dorsal));
    const prev = pilots.get(ws);
    pilots.set(ws, { key, pilot: Number.isInteger(pilot) ? pilot : null });
    hook(ws);
    if (!ws._teamLinkBeat) {
      ws._teamLinkBeat = true;
      ws.on('pong', () => { ws._teamLinkAwaitingPong = false; });
    }
    if (prev && prev.key !== key) presence(prev.key);
    presence(key);
    const r = rosters.get(key);
    if (r) send(ws, { type: 'team_roster', pilotos: r.pilotos, current: r.current });
  }

  function deliver(slug, { dorsal, text, tone, pilot }) {
    const key = keyOf(slug, dorsal);
    const out = { type: 'team_msg', text, tone };
    let n = 0;
    for (const [m, e] of pilots) {
      if (e.key !== key || m.readyState !== OPEN) continue;
      if (pilot !== null && e.pilot !== pilot) continue;
      send(m, out);
      n++;
    }
    return n;
  }

  function drop(ws) {
    const e = pilots.get(ws);
    if (e) { pilots.delete(ws); presence(e.key); }
    for (const r of rosters.values()) r.publishers.delete(ws);
  }

  return { setRoster, getRoster, registerPilot, deliver, drop, stop };
}

module.exports = { createTeamLink, validateRoster, validatePilotIndex, validateTeamMsg, TONES };
