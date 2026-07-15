// ── en-persist.js — recuperación de gestión de equipo tras un corte de conexión/apagón ──
// Guarda solo lo que ninguna otra fuente puede reconstruir (roster, historial de stints,
// piloto/stint en curso). Todo lo demás (grid en vivo, cola de box, calidad de karts...)
// se repuebla solo del feed de Apex/Logger al reconectar.

const _EN_PERSIST_KEY = 'stintpro_racestate_v1';
const _EN_PERSIST_TTL_MARGIN_MS = 3 * 60 * 60 * 1000; // margen tras el fin de carrera estimado

function _enSaveRaceState() {
  const cfg = window.AppState?.config;
  if (!cfg || cfg.slug === 'replay' || cfg._noPersist) return;
  try {
    const snapshot = {
      v: 1,
      ts: Date.now(),
      finished: !!EnSession._finished,
      connMode: (typeof _connMode !== 'undefined') ? _connMode : 'apex',
      cfg,
      en: {
        currentPilot: EnSession.currentPilot,
        stintHistory: EnSession.stintHistory,
        stintStart: EnSession.stintStart,
        stintFrozen: EnSession.stintFrozen,
        posIn: EnSession.posIn,
        stintBestLap: EnSession.stintBestLap,
        stintLapTimes: EnSession.stintLapTimes,
        stintStartTours: EnSession.data?._stintStartTours || 0,
        raceStart: EnSession.raceStart,
      },
      // Reglas de la organización configuradas a mano — el feed de Apex/Logger no las
      // manda, así que no hay forma de reconstruirlas al reconectar (a diferencia de la
      // cola de box o la calidad de karts, que sí se repueblan solas).
      box: {
        config: EnBox.config,
        pitDuration: EnBox.pitDuration,
        totalStops: EnBox.totalStops,
        pilotMinTime: EnBox.pilotMinTime,
        stratConfigured: EnBox.stratConfigured,
      },
    };
    localStorage.setItem(_EN_PERSIST_KEY, JSON.stringify(snapshot));
  } catch (e) { console.warn('[StintPro] No se pudo guardar el estado de carrera:', e); }
}

function _enLoadRaceState() {
  try {
    const raw = localStorage.getItem(_EN_PERSIST_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (!snap || snap.v !== 1 || !snap.cfg || !snap.en) return null;
    // TTL atado a la duración estimada de la carrera (stintMax × paradas), no a un valor fijo,
    // para no descartar el snapshot de una resistencia larga (24h) tras un corte prolongado.
    const stintMaxMin = (snap.cfg.stintMax && snap.cfg.stintMax < 999) ? snap.cfg.stintMax : 90;
    const stops = Math.max(snap.cfg.stops || 1, 1);
    const raceDurationEstimateMs = Math.max(stintMaxMin * 60 * 1000 * stops, 3 * 60 * 60 * 1000);
    const ttl = raceDurationEstimateMs + _EN_PERSIST_TTL_MARGIN_MS;
    if (Date.now() - snap.ts > ttl) { _enClearRaceState(); return null; }
    return snap;
  } catch (e) {
    console.warn('[StintPro] Estado de carrera guardado corrupto, se descarta:', e);
    return null;
  }
}

function _enClearRaceState() {
  try { localStorage.removeItem(_EN_PERSIST_KEY); } catch (e) {}
}

function _enApplyRaceState(snap) {
  // showEnduranceDashboard usa el conector global window.ApexConnector tal cual esté
  // en ese momento (normalmente lo fija selectRaceType() según el modo elegido en el
  // setup) — al saltarnos el setup hay que fijarlo a mano según el modo guardado.
  if (typeof _connMode !== 'undefined') _connMode = snap.connMode || 'apex';
  if (snap.connMode === 'logger' && typeof Logger !== 'undefined') window.ApexConnector = Logger;
  else if (typeof _origApex !== 'undefined') window.ApexConnector = _origApex;
  if (typeof _loggerUrl !== 'undefined') window.AppState.loggerUrl = _loggerUrl;
  if (typeof _loggerApiKey !== 'undefined') window.AppState.loggerApiKey = _loggerApiKey;

  window.AppState.config = snap.cfg;
  window.showEnduranceDashboard(snap.cfg); // resetea EnSession.stintStart/stintFrozen/EnUi.pinned
  EnSession.currentPilot = snap.en.currentPilot || 0;
  EnSession.stintHistory = snap.en.stintHistory || [];
  EnSession.stintStart = snap.en.stintStart || null;
  EnSession.stintFrozen = snap.en.stintFrozen || null;
  EnSession.posIn = snap.en.posIn || null;
  EnSession.stintBestLap = snap.en.stintBestLap || null;
  EnSession.stintLapTimes = snap.en.stintLapTimes || [];
  EnSession.data._stintStartTours = snap.en.stintStartTours || 0;
  EnSession.raceStart = snap.en.raceStart || null;
  // showEnduranceDashboard() ya reseteó EnBox a sus valores por defecto — restauramos
  // encima solo si el snapshot trae `box` (snapshots guardados antes de este fix no lo
  // tienen; en ese caso se quedan los valores por defecto, no un crash).
  if (snap.box) {
    EnBox.config = snap.box.config || EnBox.config;
    EnBox.pitDuration = snap.box.pitDuration ?? EnBox.pitDuration;
    EnBox.totalStops = snap.box.totalStops ?? EnBox.totalStops;
    EnBox.pilotMinTime = snap.box.pilotMinTime ?? EnBox.pilotMinTime;
    EnBox.stratConfigured = snap.box.stratConfigured ?? EnBox.stratConfigured;
  }
  // No confiar en el snapshot a ciegas: verificar contra standsCount de Apex (fuente
  // oficial de paradas) en cuanto llegue el primer dato en vivo de nuestro kart.
  EnSession._reconcilePending = true;
  EnSession._reconcileDeadline = Date.now() + 4000;
  _enSaveRaceState();
}

// Comparar el historial restaurado contra la realidad en vivo de Apex. Se llama en cada
// tick de datos; se resuelve una sola vez (o cuando expira el margen de espera de la señal).
function _enCheckReconcile(myK) {
  if (!EnSession._reconcilePending || !myK) return;
  const hasSignal = myK.standsCount > 0;
  const timedOut = Date.now() > (EnSession._reconcileDeadline || 0);
  if (!hasSignal && !timedOut) return;
  EnSession._reconcilePending = false;
  if (hasSignal && myK.standsCount !== EnSession.stintHistory.length) {
    _enShowReconcileWarning(myK.standsCount, EnSession.stintHistory.length);
  }
}

function _enShowReconcileWarning(official, saved) {
  if (document.getElementById('en-reconcile-banner')) return;
  const b = document.createElement('div');
  b.id = 'en-reconcile-banner';
  b.style.cssText = 'position:fixed;top:32px;left:50%;transform:translateX(-50%);z-index:9997;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.5);border-radius:6px;padding:8px 16px;display:flex;align-items:center;gap:12px;font-family:sans-serif;font-size:11.5px;color:#ef4444;max-width:90vw;backdrop-filter:blur(8px);';
  b.innerHTML = `⚠ Paradas oficiales Apex: ${official} · guardadas: ${saved} — puede haber una parada real que la app no registró mientras estaba cerrada. Revisa el piloto/stint actual.
    <button onclick="document.getElementById('en-reconcile-banner')?.remove()" style="background:transparent;border:none;color:#ef4444;cursor:pointer;font-size:14px;padding:0 4px;flex-shrink:0">✕</button>`;
  document.body.appendChild(b);
}
