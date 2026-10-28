// ── radio-core.js — lógica pura de la radio web móvil (radio.html) ─────────
// Qué lista de pilotos usar (la del panel si hay uno conectado; si no, la
// plantilla de Apex publicada como source:'radio'), a quién va cada mensaje y
// qué se manda al logger. Sin DOM: va con tests (tests/radio-core.test.js).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RadioCore = api;
})(typeof window !== 'undefined' ? window : this, function () {

  const MAX_PILOTS = 10, MAX_NAME = 40, MAX_TEXT = 40;  // = team-link.js del logger
  const TONES = ['red', 'orange', 'blue'];
  const COOLDOWN_MS = 2000;

  // Compara la lista de pilotos y el piloto en pista de dos rosters.
  const same = (a, b) => JSON.stringify([a.pilotos, a.current]) === JSON.stringify([b.pilotos, b.current]);

  // .INF de Apex → { pilotos, current } o null si no hay plantilla.
  function rosterFromInf(inf) {
    const ds = (inf && Array.isArray(inf.drivers) ? inf.drivers : []).slice(0, MAX_PILOTS);
    const pilotos = ds.map(d => String(d.name || '').trim().slice(0, MAX_NAME));
    if (!pilotos.length || pilotos.some(p => !p)) return null;
    const i = ds.findIndex(d => d.current);
    return { pilotos, current: i >= 0 ? i : null };
  }

  // server: último team_roster recibido como observador; apex: rosterFromInf o null.
  function chooseRoster(server, apex) {
    const srv = server && Array.isArray(server.pilotos) ? server : null;
    // Panel conectado: manda su lista y la web no republica nada.
    if (srv && srv.source === 'panel' && srv.panel) {
      return { mode: 'panel', pilotos: srv.pilotos, current: srv.current, publish: false };
    }
    // Sin panel pero con plantilla de Apex: la web toma el relevo y la publica
    // solo si el servidor no tiene ya esa misma lista.
    if (apex) {
      const publish = !srv || srv.source !== 'radio' || !same(srv, apex);
      return { mode: 'radio', pilotos: apex.pilotos, current: apex.current, publish };
    }
    // Sin Apex: lo que haya en el servidor, sin publicar.
    if (srv) return { mode: srv.source === 'radio' ? 'radio' : 'panel', pilotos: srv.pilotos, current: srv.current, publish: false };
    // Nada de nada: solo se puede mandar por dorsal (a todos los móviles del kart).
    return { mode: 'dorsal', pilotos: [], current: null, publish: false };
  }

  // Si cambia el piloto en pista (o la lista), la elección manual caduca: un BOX
  // no puede acabar en el móvil del piloto que acaba de bajarse.
  function keepPick(picked, prev, next) {
    if (picked === null || picked === undefined || !prev || !next) return null;
    return same(prev, next) ? picked : null;
  }

  // Elección manual válida si existe; si no, el piloto que va en pista.
  function pickTarget(picked, roster) {
    if (!roster || roster.mode === 'dorsal') return null;
    if (Number.isInteger(picked) && picked >= 0 && picked < roster.pilotos.length) return picked;
    return roster.current;
  }

  function rosterMessage(slug, dorsal, roster) {
    return { type: 'team_roster', slug, dorsal: String(dorsal), pilotos: roster.pilotos, current: roster.current, source: 'radio' };
  }

  // Mensaje hacia el logger. Con lista lleva el índice del piloto destinatario.
  function teamMessage({ slug, dorsal, roster, target, text, tone, id }) {
    const t = String(text || '').trim();
    if (!t) return { error: 'Mensaje vacío' };
    if (t.length > MAX_TEXT) return { error: `Máximo ${MAX_TEXT} caracteres` };
    const msg = { type: 'team_msg', slug, dorsal: String(dorsal), text: t, tone: TONES.includes(tone) ? tone : 'orange', id };
    if (roster && roster.mode !== 'dorsal') {
      if (!Number.isInteger(target)) return { error: 'Elige a quién va' };
      msg.pilot = target;
    }
    return msg;
  }

  // name = null en modo dorsal (el mensaje fue a todos los móviles del dorsal).
  function resultLabel(ack, name, dorsal) {
    const n = (ack && ack.delivered) || 0;
    if (name) return n > 0 ? { ok: true, text: `Entregado a ${name} ✓` } : { ok: false, text: `No entregado: ${name} sin móvil conectado` };
    return n > 0
      ? { ok: true, text: `Entregado a ${n} ${n === 1 ? 'móvil' : 'móviles'} del #${dorsal} ✓` }
      : { ok: false, text: `No entregado: ningún móvil conectado en el #${dorsal}` };
  }

  // Anti-repetición: la misma clave no vuelve a dispararse dentro de `ms`.
  function createCooldown(ms = COOLDOWN_MS) {
    const last = new Map();
    return {
      tryFire(key, now) {
        const t = last.get(key);
        if (t !== undefined && now - t < ms) return false;
        last.set(key, now);
        return true;
      },
    };
  }

  // Reconexión: 1 s, 2 s y luego 5 s para siempre.
  const reconnectDelay = attempt => [1000, 2000, 5000][Math.min(attempt, 2)];

  return { MAX_TEXT, COOLDOWN_MS, rosterFromInf, chooseRoster, keepPick, pickTarget,
           rosterMessage, teamMessage, resultLabel, createCooldown, reconnectDelay };
});
