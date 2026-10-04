// ── en-messages.js — mensajes de dirección de carrera (canales msg| y com| de Apex) ──
// Funciona en browser (window.EnMessages) y Node.js (module.exports). Sin DOM.
//
// POR QUÉ EXISTE COMO MÓDULO AISLADO:
//   La atribución ("¿esta sanción es de MI equipo?") es la única decisión con
//   consecuencia visible —enciende la luz roja del botón del panel— y estaba
//   condenada a vivir dentro del handler de datos de en-strategy.js, que no
//   tiene test. Aislada aquí es verificable.
//
// ATRIBUCIÓN: por DORSAL, nunca por nombre. Verificado sobre el corpus de raw
// logs del VPS (749 sesiones, 12 circuitos): de los 115 mensajes con prefijo
// numérico, los 115 dorsales existían en su parrilla; el nombre del equipo en
// cambio discrepa (Le Mans lo abrevia, worldkarts ni siquiera manda un equipo).
//
// ANTI-DUPLICADO: Apex reenvía el mismo texto varias veces —10 repeticiones de
// "N°7 RED RACING : Avertissement - LIGNE DE COURSE" en las 24H de RKC—. Se
// descarta el texto repetido dentro de una ventana; pasada la ventana entra,
// porque una reincidencia real horas después SÍ es un aviso nuevo.

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports && typeof window === 'undefined') {
    module.exports = factory();
  } else {
    root.EnMessages = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_MESSAGES = 60;        // anillo: una carrera larga no pasa de unas decenas
  const DEDUPE_MS    = 10 * 60 * 1000;

  const norm = v => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();
  const dorsalsOf = info => (Array.isArray(info.dorsals) ? info.dorsals : (info.dorsal != null ? [info.dorsal] : []))
    .map(d => String(d).trim());
  // Misma sanción vista por los dos canales (msg| trae "Nº.51 EQUIPO : Penalización
  // - motivo - castigo"; el tablón com| trae el dorsal aparte y solo el cuerpo).
  const crossKey = info => dorsalsOf(info).slice().sort().join(',') + '|' + norm(info.reason) + '|' + norm(info.penalty);

  // Hora de una entrada del tablón ("18:32") → instante: la última vez que el
  // reloj marcó esa hora antes de `now` (con 5 min de margen por desfase).
  function tsFromClock(clock, now) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(clock || ''));
    if (!m) return now;
    const d = new Date(now);
    d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
    let ts = d.getTime();
    if (ts - now > 5 * 60 * 1000) ts -= 24 * 3600 * 1000;
    return ts;
  }

  // Añade un mensaje ya clasificado (classifyApexMessage / classifyComEntry) al
  // estado de sesión.
  //   S        → EnSession (muta S.messages y S.msgUnread)
  //   info     → {kind, dorsal, dorsals, team, reason, penalty, text, source, clock, history}
  //   myDorsal → dorsal propio de la config (puede llegar como número)
  // Tres destinatarios, por los dorsales del mensaje:
  //   mío      → mi dorsal está entre ellos (luz roja parpadeante)
  //   general  → no nombra a nadie: aviso de la organización para TODOS (su luz
  //              y la franja del panel hasta que se cierre o se abra el buzón)
  //   rival    → nombra a otros (luz ámbar)
  // `history` (ya estaba en el tablón al conectar): se lista con su hora, sin
  // luces ni franja.
  // Devuelve la entrada añadida, o null si era duplicado o no aplicable.
  function ingestMessage(S, info, myDorsal, now) {
    if (!S || !info || !info.text) return null;
    const at = now == null ? Date.now() : now;
    const ts = info.history && info.clock ? tsFromClock(info.clock, at) : at;

    if (!Array.isArray(S.messages)) S.messages = [];
    S.msgUnread = { mias: false, otras: false, general: false, ...(S.msgUnread || {}) };

    const key = crossKey(info);
    const dup = S.messages.find(m => Math.abs(ts - m.ts) < DEDUPE_MS &&
      (m.text === info.text || ((m.source || 'msg') !== (info.source || 'msg') && crossKey(m) === key)));
    if (dup) return null;

    const dorsals = dorsalsOf(info);
    const mine = myDorsal != null && dorsals.includes(String(myDorsal).trim());
    const general = dorsals.length === 0;

    const entry = { ...info, ts, mine, general, banner: general && !info.history };
    S.messages.unshift(entry);
    if (S.messages.length > MAX_MESSAGES) S.messages.length = MAX_MESSAGES;

    if (!info.history) {
      if (mine)         S.msgUnread.mias    = true;
      else if (general) S.msgUnread.general = true;
      else              S.msgUnread.otras   = true;
    }

    return entry;
  }

  // Avisos generales pendientes de leer (los que pinta la franja), el más reciente primero.
  function bannerMessages(S) {
    return ((S && S.messages) || []).filter(m => m.banner);
  }

  // Cierra la franja (✕) sin abrir el buzón: los avisos generales quedan leídos;
  // las luces de mi dorsal y de rivales no se tocan.
  function dismissBanner(S) {
    if (!S) return;
    (S.messages || []).forEach(m => { m.banner = false; });
    if (S.msgUnread) S.msgUnread.general = false;
  }

  // Apaga las luces del botón y retira la franja. El historial se conserva.
  function clearUnread(S) {
    if (!S) return;
    S.msgUnread = { mias: false, otras: false, general: false };
    (S.messages || []).forEach(m => { m.banner = false; });
  }

  return { ingestMessage, clearUnread, bannerMessages, dismissBanner, MAX_MESSAGES, DEDUPE_MS };
});
