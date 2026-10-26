// ── en-pilot-link-core.js — mensajes al piloto en pista (núcleo puro) ───────
// Construye lo que el panel manda al VPS: la lista de pilotos de mi equipo con
// el que va en pista (team_roster) y los mensajes (team_msg) dirigidos a él.
// Sin DOM ni WebSocket: la conexión y la UI viven en en-pilot-link.js.
// Tests: tests/pilot-link.test.js.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EnPilotLinkCore = api;
})(typeof window !== 'undefined' ? window : this, function () {

  const MAX_TEXT = 40;    // se lee de un vistazo en el kart
  const MAX_PILOTS = 10;  // = MAX_PILOTS de en-race-config.js
  const MAX_NAME = 40;
  const TONES = ['red', 'orange', 'blue'];

  // Orden = orden del modal (primera fila, Box). Box en rojo; bandera azul en azul.
  const QUICK_MESSAGES = [
    { text: 'BOX', tone: 'red' }, { text: 'BOX PRÓXIMA', tone: 'red' },
    { text: 'NO ENTRES', tone: 'red' }, { text: 'UNA VUELTA MÁS', tone: 'red' },
    { text: 'PUSH', tone: 'orange' }, { text: 'MANTÉN RITMO', tone: 'orange' }, { text: 'TRANQUILO', tone: 'orange' },
    { text: 'RIVAL DETRÁS', tone: 'orange' }, { text: 'ATACA', tone: 'orange' },
    { text: 'BANDERA AZUL', tone: 'blue' }, { text: 'LÍMITES DE PISTA', tone: 'orange' }, { text: 'SANCIÓN', tone: 'orange' },
    { text: 'OK', tone: 'orange' },
  ];

  function buildRoster(cfg, session) {
    const slug = String(cfg?.slug || '').trim();
    const dorsal = String(cfg?.myDorsal ?? '').trim();
    const list = Array.isArray(cfg?.pilotos) ? cfg.pilotos.slice(0, MAX_PILOTS) : [];
    if (!slug || !dorsal || !list.length) return null;
    const pilotos = list.map((p, i) => (String(p?.name || '').trim() || `Piloto ${i + 1}`).slice(0, MAX_NAME));
    const c = session?.currentPilot;
    const current = Number.isInteger(c) && c >= 0 && c < pilotos.length ? c : null;
    return { type: 'team_roster', slug, dorsal, pilotos, current };
  }

  function rosterSignature(roster) { return roster ? JSON.stringify(roster) : ''; }

  function buildTeamMsg(roster, text, tone, id) {
    if (!roster) return { error: 'Configura tu dorsal y tus pilotos' };
    if (roster.current === null) return { error: 'Marca quién va en pista' };
    const t = String(text || '').trim();
    if (!t) return { error: 'Mensaje vacío' };
    if (t.length > MAX_TEXT) return { error: `Máximo ${MAX_TEXT} caracteres` };
    return { type: 'team_msg', slug: roster.slug, dorsal: roster.dorsal, text: t,
             tone: TONES.includes(tone) ? tone : 'orange', pilot: roster.current, id };
  }

  function currentPilotName(roster) {
    return roster && roster.current !== null ? roster.pilotos[roster.current] : null;
  }

  function deliveryLabel(ack, name) {
    return ack && ack.delivered > 0
      ? { ok: true, text: `Entregado a ${name}` }
      : { ok: false, text: `No entregado: ${name} no tiene el móvil conectado` };
  }

  return { QUICK_MESSAGES, MAX_TEXT, buildRoster, rosterSignature, buildTeamMsg, currentPilotName, deliveryLabel };
});
