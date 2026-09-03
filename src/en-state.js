// ── en-state.js — fragmento de endurance.js ──
// ── Endurance Dashboard v1.0 ─────────────────────────────────────────────────
// Basado en Sprint + funciones específicas de endurance

// ── Estado de sesión (se resetea entre carreras) ──────────────────────────
const EnSession = {
  data:             { equipos:[], leaderLap:0 }, // datos en vivo del conector
  colMapSeen:       {},   // último colMap no vacío recibido de Apex (uno vacío conserva el actual, uno no vacío lo sustituye entero)
  stintStart:       null,   // timestamp inicio stint de mi equipo
  stintFrozen:      null,   // ms congelados cuando acaba sesión
  _myPitInDetected: false,  // el freeze de stintFrozen viene de un pit-in real (no de fin de sesión)
  currentPilot:     0,      // índice del piloto actual
  stintHistory:     [],     // historial de stints completados
  posIn:            null,   // posición al entrar a pista
  stintBestLap:     null,   // mejor vuelta del stint actual
  stintLapTimes:    [],     // vueltas del stint actual
  linePasses:       {},     // dorsal → timestamp del último pase por meta
  pitOutCalibration:[],     // segundos entre pit out y siguiente pase por meta
  pitOutPending:    {},     // dorsal → timestamp del pit out (esperando primer pase)
  rivalPitOut:      {},     // dorsal → timestamp del último pit out
  pitCosts:         {},     // dorsal → [costes reales de parada en segundos (último |*| antes pit in → primer |*| tras pit out)]
  pitCounts:        {},     // dorsal → número de paradas
  pitInLastPass:    {},     // dorsal → timestamp del último |*| antes del pit in
  kartAutoState:    {},     // dorsal → {quality, badCount, stintStartIdx}
  lastTrackAvg:     null,   // último valor válido de media de pista (caché anti-parpadeo)
  myPitInAt:        null,   // timestamp real de mi pit-in (ancla el túnel de salida mientras estoy en boxes)
  raceStart:        null,   // {at, clock, source} salida oficial (com|) — ancla del stint 1
  flag:             null,   // bandera del panel de luces: 'green'|'red'|'yellow'|null
  raceStopped:      false,  // carrera detenida por bandera roja (con carrera activa)
  raceEvents:       [],     // eventos de detención/reanudación de la sesión
  messages:         [],     // sanciones y avisos de dirección de carrera (canal msg|), el más reciente primero
  msgUnread:        { mias: false, otras: false }, // luz del botón: roja parpadeante (mías) / ámbar fija (rivales)
};

// ── Historial de pilotos (logger o URL configurada en modo Apex/Replay) ──
let _enPilotHistory = null;      // null = no cargado, {} = cargado (puede estar vacío)
let _enPilotHistoryFetching = false;

async function _enFetchPilotHistory(karts, slug) {
  if (_enPilotHistoryFetching) return;
  const _rUrl = Logger?._serverUrl || (window.AppState?.loggerUrl || '').replace(/\/$/, '');
  if (!_rUrl) return;
  const names = karts.map(k => k.name).filter(n => n && n.length > 2);
  if (!names.length) return;
  _enPilotHistoryFetching = true;
  try {
    const encoded = names.map(n => encodeURIComponent(n)).join(',');
    const res = await fetch(`${_rUrl}/api/circuit/${slug}/pilots/batch?names=${encoded}`, {
      headers: await Logger._authHeaders(),
    });
    _enPilotHistory = res.ok ? await res.json() : {};
  } catch(e) { _enPilotHistory = {}; }
  _enPilotHistoryFetching = false;
}

// ── Ratings de pilotos — score 0-1000 por circuito ───────────────────────
// Cargado del logger si disponible, si no del caché localStorage (7 días)
let _enPilotRatings = {};        // name → score (número o null)
let _enPilotRatingsFetching = false;
const _RATINGS_TTL = 7 * 24 * 3600 * 1000;

async function _enFetchPilotRatings(slug) {
  if (_enPilotRatingsFetching) return;

  // Intentar del logger si está disponible (o URL configurada en AppState para modo Apex/Replay)
  const _rUrl = Logger?._serverUrl || (window.AppState?.loggerUrl || '').replace(/\/$/, '');
  if (_rUrl) {
    try {
      _enPilotRatingsFetching = true;
      const res = await fetch(`${_rUrl}/api/circuit/${slug}/pilot-ratings`, {
        headers: await Logger._authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        const map = Object.fromEntries(data.map(p => [p.name, p]));
        _enPilotRatings = map;
        // Guardar en caché para cuando no haya logger
        try {
          localStorage.setItem(`stintpro_ratings_${slug}`, JSON.stringify({ ts: Date.now(), data: map }));
        } catch(e) {}
        _enPilotRatingsFetching = false;
        return;
      }
    } catch(e) {}
    _enPilotRatingsFetching = false;
  }

  // Fallback: caché localStorage
  try {
    const raw = localStorage.getItem(`stintpro_ratings_${slug}`);
    if (raw) {
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts < _RATINGS_TTL) { _enPilotRatings = data; return; }
    }
  } catch(e) {}
}

function _enScoreColor(score) {
  if (score == null) return '#475569';
  if (score >= 800)  return '#22c55e';
  if (score >= 600)  return '#84cc16';
  if (score >= 400)  return '#fbbf24';
  if (score >= 200)  return '#f97316';
  return '#ef4444';
}

// ── Configuración del box (persistente en la sesión) ──────────────────────
const EnBox = {
  config:         { type:'line', positions:4, columns:2 },
  queue:          [],    // [{quality, dorsal, time}]
  queueInited:    false,
  pitDuration:    180,   // duración de parada en segundos (marca la organización)
  _pitDurUserSet: false, // el usuario editó la duración a mano → no auto-sobrescribir con la de Apex (otr)
  pilotMinTime:   0,     // minutos mínimos por piloto
  totalStops:     3,     // paradas obligatorias totales de la carrera
  stratConfigured:false, // si el usuario ya configuró stint min/max
};

// ── Estado de la UI (display e interacción del usuario) ───────────────────
const EnUi = {
  tab:           'grid', // 'grid' | 'team' | 'strat' | 'adv'
  pinned:        null,   // dorsal fijado para seguimiento visual
  sortMode:      'pos',  // 'pos' | 'm5v'
  kartQuality:   {},     // dorsal → 'good'|'neutral'|'bad'|'auto'|null (overrides manuales)
  excludedFromAvg:{},    // dorsal → true si excluido de la media de pista
};

// ── Timers (handles — no son estado de dominio) ───────────────────────────
let _enTimer      = null;
let _enLastRenderAt = 0;   // ts del último render en vivo — techo del throttle (_enScheduleRender)
let _enClockTimer = null;
let _enSimTimer   = null;
let _enBarTimer   = null;
let _enAdvRafId   = null;
let _enAdvPlanTimer = null;

// ── Estilos ───────────────────────────────────────────────────────────────
function _enInjectStyles(){
  if(document.getElementById('en-styles'))return;
  const s=document.createElement('style');
  s.id='en-styles';
  s.textContent=`
    /* El chrome compartido con el otro modo vive en src/panel.css.
       Aquí solo lo específico de endurance. */
    .en-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;width:100%;-webkit-app-region:no-drag;}
    .en-thead{display:grid;column-gap:10px;padding:5px 14px;border-bottom:0.5px solid #1a1b20;flex-shrink:0;overflow-x:auto;scrollbar-width:none;}
    .en-thead::-webkit-scrollbar{display:none;}
    .en-thead span{font-size:11.5px;color:#333;text-transform:uppercase;letter-spacing:0.5px;text-align:right;}
    .en-col-bar{position:relative;flex-shrink:0;}
    .en-col-btn{cursor:pointer;}
    .en-col-panel{position:absolute;z-index:50;top:30px;left:0;background:var(--panel-surface);border:0.5px solid var(--panel-line);border-radius:10px;padding:10px 12px;display:flex;gap:18px;box-shadow:0 8px 24px rgba(0,0,0,.5);}
    .en-col-title{font-size:10px;color:#F5A623;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;white-space:nowrap;}
    .en-col-item{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text-2);padding:3px 0;cursor:pointer;white-space:nowrap;}
    .en-col-item.en-col-off{opacity:.45;cursor:default;}
    .sp-body{overflow-y:auto;overflow-x:auto;flex:1;}
    .en-row{display:grid;column-gap:10px;padding:4px 14px;border-bottom:0.5px solid #111213;align-items:center;cursor:pointer;position:relative;}
    .en-row:nth-child(odd){background:rgba(255,255,255,0.01);}
    .en-row:hover{background:#15161d!important;}
    .sp-cls{font-size:12px;color:var(--text-3);text-align:center;}
    /* Pantallas estrechas (iPad y similares, no afecta a Electron/desktop ≥1100px):
       columnas y fuentes del grid de clasificación reducidas para que las 13
       quepan sin solaparse ni cortarse fuera de la pantalla. */
    /* Un selector movido a un fichero que carga antes (panel.css) invierte su orden
       respecto a un @media que lo redeclara aquí: el @media y el selector base tienen
       que vivir en el mismo fichero, o el @media empieza a ganar donde antes perdía.
       .sp-pos, .sp-name, .sp-t y .sp-gap viven ahora en panel.css: sus reglas quedan
       fuera de este bloque a propósito, para no reactivar un tamaño que era letra
       muerta antes de esta rama. */
    @media (max-width:900px){
      .en-thead,.en-row{column-gap:4px;padding-left:8px;padding-right:8px;}
      .en-thead span{font-size:10px;}
      .en-kart{width:26px;height:20px;font-size:12px;}
      .sp-vtas,.en-m5,.en-delta,.sp-pitc{font-size:12px;}
    }
    .en-kart{display:inline-flex;align-items:center;justify-content:center;width:30px;height:22px;border-radius:5px;font-size:13.5px;font-weight:700;margin:auto;cursor:pointer;position:relative;}
    .en-kart-q{position:absolute;top:-3px;right:-3px;font-size:8.5px;line-height:1;}
    .en-info-btn{flex-shrink:0;font-size:11px;font-weight:700;color:#F5A623;background:#1a1500;border:1px solid #3a2800;border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;line-height:1;font-style:normal;}
    .en-info-btn:hover{background:#1a2d4a;}
    .sp-vtas{font-size:13.5px;color:var(--text-2);text-align:right;font-family:monospace;}
    /* Vueltas contadas por StintPro (Apex no manda contador en esta sesión):
       mismo gris apagado que las columnas calculadas, para que no se confunda
       con el dato oficial de un vistazo. */
    .sp-vtas-prop{color:var(--text-3);}
    .en-m5{font-size:13.5px;text-align:right;font-family:monospace;color:var(--text-3);}
    .en-delta{font-size:12.5px;text-align:right;font-family:monospace;}
    .sp-pitc{font-size:13.5px;color:var(--text-2);text-align:right;font-family:monospace;}
    .en-myrow{background:linear-gradient(90deg,rgba(245,166,35,0.28),rgba(245,166,35,0.07) 55%,transparent)!important;box-shadow:inset 4px 0 0 0 #F5A623;}
    .en-myrow:nth-child(odd){background:linear-gradient(90deg,rgba(245,166,35,0.32),rgba(245,166,35,0.08) 55%,transparent)!important;}
    /* Pestañas */
    .en-tabs{display:flex;border-bottom:0.5px solid #1a1b20;flex-shrink:0;}
    .en-tab{flex:1;padding:8px 0;text-align:center;font-size:12.5px;color:var(--text-3);cursor:pointer;border-bottom:2px solid transparent;font-family:sans-serif;transition:all .15s;}
    .en-tab:hover{color:var(--text-2);}
    .en-tab.active{color:#F5A623;border-bottom-color:#F5A623;}
    /* Vista equipo */
    .en-team{padding:14px 18px;overflow-y:auto;flex:1;}
    .en-team-card{background:var(--panel-surface);border:0.5px solid var(--panel-line-soft);border-radius:8px;padding:14px;margin-bottom:12px;}
    .en-team-title{font-size:12.5px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;font-family:sans-serif;}
    .en-pilot-current{display:flex;align-items:center;gap:14px;margin-bottom:10px;}
    .en-pilot-avatar{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17.5px;font-weight:700;color:#fff;}
    .en-pilot-info{flex:1;}
    .en-pilot-name{font-size:16.5px;font-weight:500;color:var(--text-1);font-family:sans-serif;}
    .en-pilot-sub{font-size:12.5px;color:var(--text-3);font-family:sans-serif;margin-top:2px;}
    .en-change-btn{padding:8px 18px;border-radius:6px;border:none;font-size:13.5px;font-weight:600;cursor:pointer;font-family:sans-serif;transition:all .15s;}
    .en-queue-item{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid #111;}
    .en-queue-item:last-child{border-bottom:none;}
    .en-queue-num{width:20px;height:20px;border-radius:50%;background:#1e1f25;color:var(--text-3);font-size:11.5px;display:flex;align-items:center;justify-content:center;font-weight:600;}
    .en-queue-name{font-size:14.5px;color:var(--text-2);font-family:sans-serif;flex:1;}
    .en-queue-stat{font-size:11.5px;color:var(--text-3);font-family:monospace;}
    .en-stint-row{display:grid;grid-template-columns:24px 1fr 62px 46px 82px 82px 64px 48px;padding:6px 0;border-bottom:0.5px solid #111;align-items:center;font-size:13.5px;font-family:monospace;}
    .en-stint-row:last-child{border-bottom:none;}
    .en-stint-head{color:#333;font-size:11.5px;text-transform:uppercase;font-family:sans-serif;letter-spacing:0.5px;}
    /* Estrategia */
    .en-strat{padding:14px 18px;overflow-y:auto;flex:1;}
    .en-strat-card{background:var(--panel-surface);border:0.5px solid var(--panel-line-soft);border-radius:8px;padding:14px;margin-bottom:12px;}
    .en-strat-title{font-size:12.5px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;font-family:sans-serif;}
    .en-prob-bar{height:8px;border-radius:4px;background:#1e1f25;overflow:hidden;margin:8px 0;}
    .en-prob-fill{height:100%;border-radius:4px;transition:width 0.3s;}
    .en-pit-kart{display:inline-flex;align-items:center;justify-content:center;width:36px;height:28px;border-radius:6px;font-size:13.5px;font-weight:700;margin:3px;}
    .en-pred-row{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:0.5px solid #111;font-family:sans-serif;}
    .en-pred-row:last-child{border-bottom:none;}
  `;
  document.head.appendChild(s);
}


// ── Vueltas restantes estimadas ──────────────────────────────────────────
function _enEstLaps(trackAvg){
  if(!trackAvg||!window.ApexClock||!window.ApexClock._synced)return null;
  const remaining=window.ApexClock.remainingMs();
  if(!remaining||remaining<=0||window.ApexClock.isCountUp())return null;
  return Math.floor(remaining/1000/trackAvg);
}

// ── Vueltas en stint actual (mi equipo) ──────────────────────────────────
function _enStintLaps(myKart){
  if(!myKart||!EnSession.stintStart)return 0;
  if(!EnSession.data._stintStartTours&&myKart.tours>0)EnSession.data._stintStartTours=myKart.tours;
  if(!EnSession.data._stintStartTours)return 0;
  return Math.max(0, myKart.tours-EnSession.data._stintStartTours);
}

// ── Media de pista en vivo (usando últimas vueltas de todos) ──────────────
function _enTrackAvgLive(eq){
  const laps=[];
  eq.forEach(e=>{
    // Excluir: en pit, saliendo de pit, vueltas >180s, equipos excluidos manualmente
    const m5=_enAvg5(e.lapHistory);
    if(m5&&m5<180&&!e.pit&&e.pitState!=='out'&&!EnUi.excludedFromAvg[e.dorsal])laps.push(m5);
  });
  if(laps.length<2)return null;
  laps.sort((a,b)=>a-b);
  // Media recortada al 10%: descarta el 10% más rápido y el 10% más lento
  const cut=Math.max(1,Math.round(laps.length*0.1));
  const trimmed=laps.length>=3?laps.slice(cut, laps.length-cut):laps;
  const result=trimmed.reduce((a,b)=>a+b,0)/trimmed.length;
  EnSession.lastTrackAvg=result;
  return result;
}

// ── Kart quality ──────────────────────────────────────────────────────────
function _enKartColor(dorsal){
  const colors=[
    {bg:'#0f1e2e',text:'#60a5fa',border:'#1e3f60'},
    {bg:'#2a0f0f',text:'#f87171',border:'#5f1e1e'},
    {bg:'#0f2a15',text:'#86efac',border:'#1e5f2a'},
    {bg:'#2a2a0f',text:'#fde68a',border:'#5f5a1e'},
    {bg:'#1a0f2a',text:'#c4b5fd',border:'#3a1e5f'},
    {bg:'#0f1a2a',text:'#93c5fd',border:'#1e3a5f'},
    {bg:'#2a1a0f',text:'#fdba74',border:'#5f3a1e'},
    {bg:'#0f2a2a',text:'#6ee7b7',border:'#1e5f5f'},
    {bg:'#2a0f20',text:'#f9a8d4',border:'#5f1e3a'},
    {bg:'#1a2a0f',text:'#bef264',border:'#3a5f1e'},
    {bg:'#1f0f2a',text:'#d8b4fe',border:'#4a1e5f'},
    {bg:'#0f2a20',text:'#5eead4',border:'#1e5f4a'},
    {bg:'#2a1f0f',text:'#fcd34d',border:'#5f4a1e'},
    {bg:'#0f1f2a',text:'#7dd3fc',border:'#1e4a5f'},
    {bg:'#2a0f15',text:'#fda4af',border:'#5f1e2a'},
  ];
  const n=parseInt(dorsal)||0;
  return colors[n%colors.length];
}

function _enToggleQuality(dorsal, ev){
  ev.stopPropagation();
  const cur=EnUi.kartQuality[dorsal]||null;
  if(!cur)EnUi.kartQuality[dorsal]='good';
  else if(cur==='good')EnUi.kartQuality[dorsal]='neutral';
  else if(cur==='neutral')EnUi.kartQuality[dorsal]='bad';
  else if(cur==='bad')EnUi.kartQuality[dorsal]='auto';
  else EnUi.kartQuality[dorsal]=null;
  _enRender();
}

// ── Máquina de estados del stint (pit in/out) ────────────────────────────
// Debe correr en CADA tick, incluso con override manual activo, para que
// stintStartIdx siga al kart físico. Sin esto, al volver de un override a
// 'auto' se evaluarían vueltas del kart anterior como si fueran del actual (B4).
// Devuelve el objeto de estado del dorsal (nunca null si e.lapHistory existe).
function _enTrackKartStint(e){
  if(!e||!e.lapHistory)return null;
  if(!EnSession.kartAutoState[e.dorsal])EnSession.kartAutoState[e.dorsal]={quality:null,badCount:0,stintStartIdx:0};
  const state=EnSession.kartAutoState[e.dorsal];

  // Pit IN: guardar calidad previa (para tracking de box)
  if(e.pitState==='in'){
    if(state.quality)state.prePitQuality=state.quality;
    return state;
  }

  // Pit OUT: kart NUEVO → reset total SOLO en la transición
  if(e.pitState==='out'){
    if(state._lastPitState!=='out'){
      state.quality=null;
      state.badCount=0;
      state.prePitQuality=null;
      state.stintStartIdx=e.lapHistory.length; // las vueltas anteriores son del kart viejo
      state.lastEvalKey=null;                  // fuerza reevaluar el kart nuevo (gate B1)
    }
    state._lastPitState='out';
    // 'out' puede persistir muchos ticks sin sr/su. No reseteamos de nuevo:
    // si ya hay vueltas del kart nuevo se evalúa normal, si no, retorna null abajo.
  } else {
    state._lastPitState=e.pitState||null;
  }
  return state;
}

// ── Calidad automática del kart ──────────────────────────────────────────

function _enAutoKartQuality(e, trackAvg){
  if(!trackAvg||!e.lapHistory||e.lapHistory.length<3)return null;

  const state=_enTrackKartStint(e);
  if(!state)return null;

  // En boxes: mostrar la calidad previa (el kart entregado, para tracking de box)
  if(e.pitState==='in')return state.prePitQuality||state.quality||null;

  // Solo vueltas del KART ACTUAL (desde el último pit out)
  const startIdx=Math.min(state.stintStartIdx||0, e.lapHistory.length);
  const stintLaps=e.lapHistory.slice(startIdx);
  const clean=_enCleanLaps(stintLaps);
  if(clean.length<3)return null;

  // Gate B1: la histéresis (badCount) y el cálculo avanzan SOLO cuando entra
  // una vuelta nueva. La función se llama 6-8 veces por render (grid +
  // estrategia); sin este gate el badCount subía en cada llamada y las "5
  // vueltas de gracia" del kart bueno se gastaban en 1-2 s con los mismos
  // datos. Ahora la histéresis cuenta vueltas reales, no renders.
  //
  // La llave incluye stintStartIdx (no solo la longitud) para que CUALQUIER
  // cambio de kart invalide el caché, incluidos los escritores externos del
  // índice — p.ej. la reconstrucción desde stintLapCount al reconectar con el
  // logger (en-strategy.js, snapshot _isHistory), que no conoce este caché.
  // Nota: si lapHistory llegara al tope de 1500 la longitud dejaría de crecer
  // y el caché se congelaría dentro de un mismo stint; inalcanzable en la
  // práctica (9 h a ~65 s/vuelta ≈ 500 vueltas por kart).
  const evalKey=startIdx+':'+e.lapHistory.length;
  if(state.lastEvalKey===evalKey)return state.quality;
  state.lastEvalKey=evalKey;

  const last5=clean.slice(-5);
  const avg5=last5.reduce((a,b)=>a+b,0)/last5.length;
  const stintBest=Math.min(...clean);
  const mn=stintBest, mx=Math.max(...clean);

  // Score histórico del piloto → decide qué referencia y qué umbral usar
  const _pr=_enPilotRatings[e.name]??null;
  const pilotScore=typeof _pr==='object'?_pr?.score:_pr;

  // Piloto fiable (score≥600) → M5v es representativo, usar avg5
  // Piloto errático o sin datos → usar mejor vuelta del stint (más resistente a incidentes)
  const isReliable=pilotScore!=null?pilotScore>=600:(mx-mn)<0.5;
  const ref=isReliable?avg5:stintBest;

  // Umbral ajustado por nivel: un Elite rodando +0.3s ya indica kart malo;
  // un Novato necesita +1.0s para descartar que sea el piloto
  const threshold=pilotScore>=800?0.3
                 :pilotScore>=600?0.5
                 :pilotScore>=400?0.7
                 :                1.0;

  // Calcular calidad instantánea
  let instant=null;
  const delta=ref-trackAvg;
  if(delta<-threshold)instant='good';
  else if(delta>threshold)instant='bad';

  // Bloqueo: si rueda POR ENCIMA de la media no puede ser bueno
  // salvo que tenga una vuelta rápida clara (del kart actual)
  if(instant==='good'&&avg5>trackAvg){
    if(stintBest>=trackAvg-threshold)instant=null;
  }

  // Malo si rueda +2.0s más lento que su mejor vuelta (degradación mecánica)
  if(avg5>stintBest+2.0)instant='bad';

  // Si no es bueno ni malo → neutro
  if(!instant)instant='neutral';

  // Kart bueno: aguanta 5 vueltas nuevas consecutivas fuera del umbral antes de bajar
  // (el gate B1 garantiza que cada incremento de badCount es una vuelta real)
  if(state.quality==='good'){
    if(instant==='good'){state.badCount=0;return'good';}
    state.badCount=(state.badCount||0)+1;
    if(state.badCount<5)return'good';
  }

  // Si no era bueno, actualizar directamente
  state.quality=instant;
  state.badCount=0;
  return instant;
}

// ── Calidad efectiva (manual > auto) ─────────────────────────────────────
function _enEffectiveQuality(dorsal, e, trackAvg){
  const manual=EnUi.kartQuality[dorsal];
  if(manual==='good'||manual==='neutral'||manual==='bad'){
    // B4: aunque el display use el valor manual, seguimos rastreando el kart
    // físico (pit in/out → stintStartIdx) para que al volver a 'auto' la
    // evaluación no arrastre vueltas del kart anterior.
    _enTrackKartStint(e);
    return manual;
  }
  if(manual==='auto'||!manual)return _enAutoKartQuality(e, trackAvg);
  return 'neutral';
}

function _enQualityBadge(dorsal, e, trackAvg){
  const manual=EnUi.kartQuality[dorsal];
  const effective=_enEffectiveQuality(dorsal, e, trackAvg);
  const isManual=manual==='good'||manual==='neutral'||manual==='bad';
  if(effective==='good')return`<span class="en-kart-q">${isManual?'🟢':'🟩'}</span>`;
  if(effective==='neutral')return`<span class="en-kart-q">${isManual?'🟡':'🟨'}</span>`;
  if(effective==='bad')return`<span class="en-kart-q">${isManual?'🔴':'🟥'}</span>`;
  return'';
}

function _enQualityTooltip(dorsal, e, trackAvg){
  const manual=EnUi.kartQuality[dorsal];
  if(manual==='good'||manual==='neutral'||manual==='bad'){
    const labels={good:'BUENO',neutral:'NEUTRO',bad:'MALO'};
    return `${labels[manual]} (manual)`;
  }

  // B3: usar EXACTAMENTE los mismos datos que la decisión (_enAutoKartQuality):
  // solo vueltas del stint actual y el mismo criterio de fiabilidad. Antes el
  // tooltip calculaba avg5 sobre el historial completo y fijaba isReliable=false
  // sin score, mostrando un delta que no era el que produjo el color.
  const state=EnSession.kartAutoState?.[dorsal];
  const stintStartIdx=state?.stintStartIdx||0;
  const stintLaps=(e.lapHistory||[]).slice(stintStartIdx);
  const cleanStint=_enCleanLaps(stintLaps);
  const fewDataNote=cleanStint.length<5?`\n⚠ Datos provisionales (${cleanStint.length}/5 vueltas del kart actual)`:'';

  if(cleanStint.length<3||!trackAvg)
    return `SIN DATOS\nVueltas del kart actual: ${cleanStint.length} (necesita 3)`;

  const last5=cleanStint.slice(-5);
  const avg5=last5.reduce((a,b)=>a+b,0)/last5.length;
  const stintBest=Math.min(...cleanStint);
  const stintMax=Math.max(...cleanStint);
  const _pr=_enPilotRatings[e.name]??null;
  const pilotScore=typeof _pr==='object'?_pr?.score:_pr;
  const isReliable=pilotScore!=null?pilotScore>=600:(stintMax-stintBest)<0.5;
  const threshold=pilotScore>=800?0.3:pilotScore>=600?0.5:pilotScore>=400?0.7:1.0;
  const ref=isReliable?avg5:stintBest;
  const delta=ref-trackAvg;
  const deltaStr=`${delta>=0?'+':''}${delta.toFixed(3)}s`;

  const effective=_enEffectiveQuality(dorsal, e, trackAvg);
  const label={good:'BUENO',neutral:'NEUTRO',bad:'MALO'}[effective]||'SIN DATOS';

  const pilotLabel=pilotScore>=800?'Elite'
                  :pilotScore>=600?'Avanzado'
                  :pilotScore>=400?'Intermedio'
                  :pilotScore>=200?'Novato'
                  :pilotScore!=null?'Principiante'
                  :'Sin datos';
  const pilotLine=pilotScore!=null
    ?`Piloto: ${pilotLabel} (${pilotScore}) · umbral ±${threshold}s`
    :`Piloto: sin score histórico · umbral ±${threshold}s`;
  const reliableReason=pilotScore>=600?'score fiable':'rodada consistente';
  const erraticReason=pilotScore!=null?'score bajo':'sin score, rodada irregular';
  const refLine=isReliable
    ?`Referencia: M5v del stint ${_enFmt(avg5)} (${reliableReason})`
    :`Referencia: mejor vuelta del stint ${_enFmt(stintBest)} (${erraticReason})`;

  return `${label} (auto)\n${pilotLine}\n${refLine}\nDelta: ${deltaStr} · Media pista: ${_enFmt(trackAvg)}${fewDataNote}`;
}

if (typeof module !== 'undefined') {
  module.exports = { _enAutoKartQuality, _enEffectiveQuality, EnSession, EnUi, _enPilotRatings };
}

