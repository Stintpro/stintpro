// ── en-stint-machine.js — máquina de estados del timer de MI stint (pit in/out) ──
// Funciona en browser (window.EnStintMachine) y Node.js (module.exports).
// Sin dependencias de DOM: los efectos que necesitan el navegador (push al historial,
// guardar estado, popup de piloto) entran como callbacks (`hooks`).
//
// POR QUÉ EXISTE COMO MÓDULO AISLADO:
//   El freeze/unfreeze del timer vivía incrustado en el handler de datos de
//   en-strategy.js (~400 líneas, ligado a DOM) y por eso no tenía test. Un bug de
//   congelación (Apex salta pitState 'in'→null sin muestrear 'out' → el timer se
//   quedaba congelado para siempre) sobrevivió sin cobertura. Al aislarlo, la lógica
//   exacta queda verificable. Ver memoria [[project-stintpro-stint-timer]].
//
// CONTRATO DE ESTADO (muta `S` = EnSession y `S.data`):
//   S.stintStart        timestamp de arranque del stint en curso (null si no arrancó)
//   S.stintFrozen       ms congelados (null = corriendo). Dos orígenes:
//                         a) pit-in real  → debe descongelarse al volver a pista
//                         b) countdown=0 (fin de sesión) → debe QUEDARSE congelado
//   S._myPitInDetected  true SOLO si el freeze vino de un pit-in real (distingue a vs b)
//   S.data._myWasIn     flanco: ya procesamos el pit-in de este ciclo
//   S.data._myWasOut    flanco: ya procesamos el pit-out de este ciclo

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports && typeof window === 'undefined') {
    module.exports = factory();
  } else {
    root.EnStintMachine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Avanza la máquina de estados de MI stint un tick.
  //   myK   → objeto de mi kart en el feed (o undefined si aún no llegó)
  //   S     → EnSession (se muta)
  //   now   → Date.now() del tick (inyectado para poder testear con reloj fijo)
  //   hooks → { onPitIn, onPitOut, onSave } — efectos de navegador, opcionales
  function updateMyStintState(myK, S, now, hooks) {
    hooks = hooks || {};
    const D = S.data;

    // ── Pit IN → guardar stint actual y CONGELAR el timer ──
    if (myK && myK.pitState === 'in' && !D._myWasIn) {
      D._myWasIn = true;
      if (hooks.onPitIn) hooks.onPitIn();              // push a stintHistory (usa now)
      S.stintFrozen = S.stintStart ? (now - S.stintStart) : 0;
      S._myPitInDetected = true;                       // el freeze viene de un pit-in REAL
      if (hooks.onSave) hooks.onSave();
    }
    if (myK && !myK.pit) D._myWasIn = false;

    // ── Fallback anti-congelación ──────────────────────────────────────────
    // Apex puede saltar pitState 'in'→null/'sr' sin que la app llegue a muestrear
    // el 'out' transitorio (snapshots ~2s). Sin esto el timer se queda congelado
    // para siempre. Solo aplica si el freeze vino de un pit-in REAL
    // (_myPitInDetected) — así NO toca el freeze legítimo de fin de sesión
    // (countdown=0), que debe permanecer congelado.
    if (myK && !myK.pit && S._myPitInDetected && S.stintFrozen !== null && !D._myWasOut) {
      S.stintStart = now;
      S.stintFrozen = null;
      S._myPitInDetected = false;
      S.stintBestLap = null;
      S.stintLapTimes = [];
      D._lastMyLap = null;
      if (hooks.onSave) hooks.onSave();
    }

    // ── Pit OUT → resetear timer + popup de selección de piloto ──
    if (myK && myK.pitState === 'out' && !D._myWasOut) {
      D._myWasOut = true;
      S._myPitInDetected = false;
      S.stintStart = now;
      S.stintFrozen = null;
      D._stintStartTours = myK.tours;
      S.posIn = myK.pos;
      S.stintBestLap = null;
      S.stintLapTimes = [];
      D._lastMyLap = null;
      if (hooks.onSave) hooks.onSave();
      if (hooks.onPitOut) hooks.onPitOut();
    }
    if (myK && myK.pitState !== 'out') D._myWasOut = false;
  }

  return { updateMyStintState };
});
