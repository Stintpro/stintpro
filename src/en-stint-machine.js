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

  // ── Arranque del PRIMER stint de la carrera ─────────────────────────────
  // Decide si el primer stint debe arrancar y en QUÉ instante. Devuelve el
  // timestamp de arranque, o null si la carrera aún no ha empezado (mostrar
  // "esperando salida").
  //
  // POR QUÉ: antes el stint arrancaba en cuanto ApexClock se sincronizaba, y eso
  // NO es "carrera arrancada". Contrastado con raw logs del VPS:
  //   · Prácticas/warmup → `dyn1|count|` ASCENDENTE desde antes de la salida
  //     (campillos_10: ya en 212027 ms en t=0, verde a los +730s). Sincronizaba
  //     el reloj y disparaba el stint 2-10 min antes de la carrera real.
  //   · Resistencias → `dyn1|countdown|` REGRESIVO justo al dar la verde.
  // Un reloj ascendente NO es señal de carrera → nunca arranca el stint por sí
  // solo. Sí lo hacen la salida oficial (verde com|) o el countdown regresivo.
  //
  //   clock      → { synced, countUp, remainingMs } (snapshot de ApexClock) | null
  //   raceStart  → EnSession.raceStart { at } | null (ancla de la verde com|)
  //   raceDurMs  → duración configurada en ms (0 si desconocida)
  //   now        → Date.now() (inyectado para testear con reloj fijo)
  // Un reloj de carrera arranca ~100% de la duración; un timer de pre-carrera
  // (circuitosona: 4min sobre 4H) queda muy por debajo de la mitad.
  const RACE_CLOCK_MIN_FRACTION = 0.5;
  // Sin duración configurada: umbral absoluto. Una resistencia real dura >15 min.
  const RACE_CLOCK_MIN_MS = 15 * 60 * 1000;

  function raceStintStart(clock, raceStart, raceDurMs, now) {
    // 1) Salida oficial (verde com|): la señal más fiable, vale para cualquier
    //    reloj (incluso circuitos que cuentan hacia arriba). Guardas de cordura:
    //    ni futura ni de hace más de 24h.
    if (raceStart && raceStart.at && now - raceStart.at >= 0 && now - raceStart.at < 24 * 3600 * 1000) {
      return raceStart.at;
    }
    // 2) Cuenta atrás REGRESIVA en marcha = la carrera arrancó. Dos filtros:
    //    · El reloj ASCENDENTE (warmup/prácticas) se ignora a propósito.
    //    · Un countdown corto de PRE-CARRERA no es el reloj de carrera. Visto en
    //      circuitosona (ENDURANCE-4H manda un countdown de 4 min que decrece a 0
    //      ANTES de rodar). El reloj de carrera arranca cerca de la duración
    //      total; un timer de pre-carrera queda muy por debajo → se descarta y el
    //      stint arranca luego con la 1ª vuelta (salvaguarda en en-strategy.js).
    if (clock && clock.synced && !clock.countUp) {
      const rem = clock.remainingMs;
      if (rem !== null && rem !== undefined && rem > 0) {
        if (raceDurMs > 0) {
          // Con duración conocida: solo si el reloj está cerca de la duración
          // (rem ≥ 50%). circuitosona: 4min/4H = 1,7% → descartado. Una conexión
          // a mitad de carrera también cae aquí → la cubre la 1ª vuelta.
          if (rem >= raceDurMs * RACE_CLOCK_MIN_FRACTION) return now - Math.max(0, raceDurMs - rem);
        } else if (rem >= RACE_CLOCK_MIN_MS) {
          // Sin duración configurada: una resistencia real dura >15 min; un timer
          // de pre-carrera (≤~5 min) o un sprint corto se descartan por magnitud.
          return now;
        }
      }
    }
    return null;
  }

  return { updateMyStintState, raceStintStart };
});
