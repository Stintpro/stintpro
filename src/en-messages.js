// ── en-messages.js — mensajes de dirección de carrera (canal msg| de Apex) ──
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

  // Añade un mensaje ya clasificado (ver classifyApexMessage) al estado de sesión.
  //   S        → EnSession (muta S.messages y S.msgUnread)
  //   info     → {kind, dorsal, team, reason, penalty, text}
  //   myDorsal → dorsal propio de la config (puede llegar como número)
  // Devuelve la entrada añadida, o null si era duplicado o no aplicable.
  function ingestMessage(S, info, myDorsal, now) {
    if (!S || !info || !info.text) return null;
    const ts = now == null ? Date.now() : now;

    if (!Array.isArray(S.messages)) S.messages = [];
    if (!S.msgUnread) S.msgUnread = { mias: false, otras: false };

    const dup = S.messages.find(m => m.text === info.text && (ts - m.ts) < DEDUPE_MS);
    if (dup) return null;

    const mine = info.dorsal != null && myDorsal != null &&
                 String(info.dorsal).trim() === String(myDorsal).trim();

    const entry = { ...info, ts, mine };
    S.messages.unshift(entry);
    if (S.messages.length > MAX_MESSAGES) S.messages.length = MAX_MESSAGES;

    if (mine) S.msgUnread.mias  = true;
    else      S.msgUnread.otras = true;

    return entry;
  }

  // Apaga las dos luces del botón. El historial se conserva.
  function clearUnread(S) {
    if (!S) return;
    S.msgUnread = { mias: false, otras: false };
  }

  return { ingestMessage, clearUnread, MAX_MESSAGES, DEDUPE_MS };
});
