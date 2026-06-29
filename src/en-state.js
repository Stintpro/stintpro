// ── en-state.js — fragmento de endurance.js ──
// ── Endurance Dashboard v1.0 ─────────────────────────────────────────────────
// Basado en Sprint + funciones específicas de endurance

// ── Estado de sesión (se resetea entre carreras) ──────────────────────────
const EnSession = {
  data:             { equipos:[], leaderLap:0 }, // datos en vivo del conector
  stintStart:       null,   // timestamp inicio stint de mi equipo
  stintFrozen:      null,   // ms congelados cuando acaba sesión
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
};

// ── Historial de pilotos desde el logger (modo logger) ───────────────────
let _enPilotHistory = null;      // null = no cargado, {} = cargado (puede estar vacío)
let _enPilotHistoryFetching = false;

async function _enFetchPilotHistory(karts, slug) {
  if (_enPilotHistoryFetching || !Logger?._serverUrl) return;
  const names = karts.map(k => k.name).filter(n => n && n.length > 2);
  if (!names.length) return;
  _enPilotHistoryFetching = true;
  _enPilotHistory = await Logger.fetchPilotHistory(slug, names);
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
  const _rKey = Logger?._apiKey    || window.AppState?.loggerApiKey || '';
  if (_rUrl) {
    try {
      _enPilotRatingsFetching = true;
      const res = await fetch(`${_rUrl}/api/circuit/${slug}/pilot-ratings`, {
        headers: _rKey ? { 'X-API-Key': _rKey } : {},
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
  pitDuration:    120,   // duración de parada en segundos (marca la organización)
  pilotMinTime:   0,     // minutos mínimos por piloto
  totalStops:     0,     // paradas obligatorias totales de la carrera
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
    #screen-dash{background:#0e0f11;display:flex;flex-direction:column;height:100vh;overflow:hidden;}
    .sp-header{background:#13141a;border-bottom:0.5px solid #252630;padding:12px 18px;flex-shrink:0;-webkit-app-region:drag;}
    .sp-topbar{position:relative;display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-left:270px;padding-right:16px;}
    .sp-topbar>*{-webkit-app-region:no-drag;}
    .sp-wdot{width:11px;height:11px;border-radius:50%;}
    .sp-session{font-size:12.5px;color:#444;font-family:sans-serif;position:fixed;left:0;right:0;text-align:center;pointer-events:none;}
    .sp-clock{text-align:right;margin-left:auto;}
    .sp-clock-val{font-size:27.5px;font-weight:500;color:#fff;font-family:monospace;letter-spacing:-1px;line-height:1;}
    .sp-clock-lbl{font-size:11.5px;color:#3a3b42;margin-top:1px;}
    .en-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;width:100%;-webkit-app-region:no-drag;}
    .sp-kpi{background:#0e0f11;border-radius:8px;padding:10px 14px;border:0.5px solid #1e1f25;}
    .sp-kpi-lbl{font-size:11.5px;color:#3a3b42;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;font-family:sans-serif;}
    .sp-kpi-val{font-size:23.5px;font-weight:500;font-family:monospace;line-height:1.1;letter-spacing:-0.5px;}
    .sp-kpi-sub{font-size:11.5px;color:#444;margin-top:3px;font-family:sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .en-thead{display:grid;grid-template-columns:20px 42px 42px 1fr minmax(0,120px) 44px 86px 86px 78px 62px 64px 62px 68px 38px;column-gap:10px;padding:5px 14px;border-bottom:0.5px solid #1a1b20;flex-shrink:0;}
    .en-thead span{font-size:11.5px;color:#333;text-transform:uppercase;letter-spacing:0.5px;text-align:right;}
    .en-thead span:nth-child(4),.en-thead span:nth-child(5){text-align:left;}
    .en-thead span:nth-child(1),.en-thead span:nth-child(2){text-align:center;}
    .sp-body{overflow-y:auto;flex:1;}
    .sp-rowwrap{position:relative;}
    .en-row{display:grid;grid-template-columns:20px 42px 42px 1fr minmax(0,120px) 44px 86px 86px 78px 62px 64px 62px 68px 38px;column-gap:10px;padding:7px 14px;border-bottom:0.5px solid #111213;align-items:center;cursor:pointer;position:relative;}
    .en-row:nth-child(odd){background:rgba(255,255,255,0.01);}
    .en-row:hover{background:#15161d!important;}
    @keyframes spFlash{0%{background:rgba(251,146,60,0.2);}100%{background:transparent;}}
    .sp-flash{animation:spFlash 2s ease-out forwards;}
    .sp-pinned{border-left:2px solid #5b8dee!important;background:#12182a!important;}
    .sp-dot{width:8px;height:8px;border-radius:50%;margin:auto;}
    .sp-pos{font-size:14.5px;font-weight:500;color:#bbb;text-align:center;}
    .en-kart{display:inline-flex;align-items:center;justify-content:center;width:30px;height:22px;border-radius:5px;font-size:13.5px;font-weight:700;margin:auto;cursor:pointer;position:relative;}
    .en-kart-q{position:absolute;top:-3px;right:-3px;font-size:8.5px;line-height:1;}
    .sp-name{font-size:14.5px;color:#d0d2db;font-family:sans-serif;display:flex;align-items:center;gap:7px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
    .en-info-btn{flex-shrink:0;font-size:11px;font-weight:700;color:#5b8dee;background:#0d1520;border:1px solid #1d3a6e;border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;line-height:1;font-style:normal;}
    .en-info-btn:hover{background:#1a2d4a;}
    .sp-pit-b{background:#ef4444;color:#fff;font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:4px;flex-shrink:0;}
    .sp-out-b{background:#f97316;color:#fff;font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:4px;flex-shrink:0;}
    .sp-fix-b{font-size:10.5px;color:#5b8dee;border:0.5px solid #5b8dee;padding:1px 5px;border-radius:3px;flex-shrink:0;}
    .sp-vtas{font-size:13.5px;color:#8b8d97;text-align:right;font-family:monospace;}
    .sp-t{font-size:14.5px;text-align:right;font-family:monospace;font-variant-numeric:tabular-nums;}
    .en-m5{font-size:13.5px;text-align:right;font-family:monospace;color:#6b7280;}
    .en-delta{font-size:12.5px;text-align:right;font-family:monospace;}
    .sp-cons{font-size:11.5px;text-align:center;}
    .sp-gap{font-size:13.5px;text-align:right;font-family:monospace;color:#6b7280;}
    .sp-pitc{font-size:13.5px;color:#8b8d97;text-align:right;font-family:monospace;}
    .sp-au{color:#22c55e;font-size:11.5px;font-weight:700;margin-left:2px;}
    .sp-ad{color:#ef4444;font-size:11.5px;font-weight:700;margin-left:2px;}
    .sp-footer{padding:7px 14px;display:flex;gap:16px;border-top:0.5px solid #181920;flex-shrink:0;}
    .sp-fl{font-size:11.5px;color:#2d2f38;display:flex;align-items:center;gap:4px;}
    .sp-fldot{width:7px;height:7px;border-radius:50%;}
    .sp-back{font-size:12.5px;padding:4px 12px;border-radius:6px;border:0.5px solid #2a2b2e;background:#1a1b22;color:#666;cursor:pointer;}
    .sp-back:hover{color:#aaa;border-color:#444;}
    .sp-empty{color:#3a3b42;padding:60px;text-align:center;font-family:sans-serif;}
    .sp-sim-badge{font-size:10.5px;padding:2px 7px;border-radius:20px;background:rgba(34,197,94,0.1);color:#22c55e;border:0.5px solid #22c55e;margin-left:6px;}
    .sp-lapbar{position:absolute;bottom:0;left:0;height:2px;background:rgba(91,156,238,0.4);transition:width 0.1s linear;pointer-events:none;}
    .sp-lapbar.fast{background:rgba(34,197,94,0.5);}
    .sp-lapbar.slow{background:rgba(239,68,68,0.4);}
    .en-myrow{background:rgba(91,141,238,0.05)!important;border-left:2px solid #5b8dee;}
    /* Pestañas */
    .en-tabs{display:flex;border-bottom:0.5px solid #1a1b20;flex-shrink:0;}
    .en-tab{flex:1;padding:8px 0;text-align:center;font-size:12.5px;color:#444;cursor:pointer;border-bottom:2px solid transparent;font-family:sans-serif;transition:all .15s;}
    .en-tab:hover{color:#888;}
    .en-tab.active{color:#5b8dee;border-bottom-color:#5b8dee;}
    /* Vista equipo */
    .en-team{padding:14px 18px;overflow-y:auto;flex:1;}
    .en-team-card{background:#13141a;border:0.5px solid #1e1f25;border-radius:8px;padding:14px;margin-bottom:12px;}
    .en-team-title{font-size:12.5px;color:#3a3b42;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;font-family:sans-serif;}
    .en-pilot-current{display:flex;align-items:center;gap:14px;margin-bottom:10px;}
    .en-pilot-avatar{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17.5px;font-weight:700;color:#fff;}
    .en-pilot-info{flex:1;}
    .en-pilot-name{font-size:16.5px;font-weight:500;color:#d0d2db;font-family:sans-serif;}
    .en-pilot-sub{font-size:12.5px;color:#555;font-family:sans-serif;margin-top:2px;}
    .en-change-btn{padding:8px 18px;border-radius:6px;border:none;font-size:13.5px;font-weight:600;cursor:pointer;font-family:sans-serif;transition:all .15s;}
    .en-queue-item{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid #111;}
    .en-queue-item:last-child{border-bottom:none;}
    .en-queue-num{width:20px;height:20px;border-radius:50%;background:#1e1f25;color:#555;font-size:11.5px;display:flex;align-items:center;justify-content:center;font-weight:600;}
    .en-queue-name{font-size:14.5px;color:#9ca3af;font-family:sans-serif;flex:1;}
    .en-queue-stat{font-size:11.5px;color:#555;font-family:monospace;}
    .en-stint-row{display:grid;grid-template-columns:24px 1fr 62px 46px 82px 82px 64px 48px;padding:6px 0;border-bottom:0.5px solid #111;align-items:center;font-size:13.5px;font-family:monospace;}
    .en-stint-row:last-child{border-bottom:none;}
    .en-stint-head{color:#333;font-size:11.5px;text-transform:uppercase;font-family:sans-serif;letter-spacing:0.5px;}
    /* Estrategia */
    .en-strat{padding:14px 18px;overflow-y:auto;flex:1;}
    .en-strat-card{background:#13141a;border:0.5px solid #1e1f25;border-radius:8px;padding:14px;margin-bottom:12px;}
    .en-strat-title{font-size:12.5px;color:#3a3b42;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;font-family:sans-serif;}
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

// ── Calidad automática del kart ──────────────────────────────────────────

function _enAutoKartQuality(e, trackAvg){
  if(!trackAvg||!e.lapHistory||e.lapHistory.length<3)return null;

  // Estado previo
  if(!EnSession.kartAutoState[e.dorsal])EnSession.kartAutoState[e.dorsal]={quality:null,badCount:0,stintStartIdx:0};
  const state=EnSession.kartAutoState[e.dorsal];

  // Pit IN: guardar calidad previa (para tracking de box)
  if(e.pitState==='in'){
    if(state.quality)state.prePitQuality=state.quality;
    return state.prePitQuality||state.quality||null;
  }

  // Pit OUT: kart NUEVO → reset total SOLO en la transición
  if(e.pitState==='out'){
    if(state._lastPitState!=='out'){
      state.quality=null;
      state.badCount=0;
      state.prePitQuality=null;
      state.stintStartIdx=e.lapHistory.length; // las vueltas anteriores son del kart viejo
    }
    state._lastPitState='out';
    // No retornamos null incondicionalmente: pitState='out' puede persistir mucho tiempo
    // sin que llegue sr/su. Si ya hay vueltas del kart nuevo, evaluamos normalmente.
    // Si no hay suficientes (< 3), el bloque de abajo retorna null igualmente.
  } else {
    state._lastPitState=e.pitState||null;
  }

  // Solo vueltas del KART ACTUAL (desde el último pit out)
  const startIdx=Math.min(state.stintStartIdx||0, e.lapHistory.length);
  const stintLaps=e.lapHistory.slice(startIdx);
  const clean=_enCleanLaps(stintLaps);
  if(clean.length<3)return null;
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

  // Kart bueno: aguanta 5 evaluaciones consecutivas fuera del umbral antes de bajar
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
  if(manual==='good'||manual==='neutral'||manual==='bad')return manual;
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

  const state=EnSession.kartAutoState?.[dorsal];
  const stintStartIdx=state?.stintStartIdx||0;
  const stintLaps=(e.lapHistory||[]).slice(stintStartIdx);
  const cleanStint=_enCleanLaps(stintLaps);
  const fewDataNote=cleanStint.length<5?`\n⚠ Datos provisionales (${cleanStint.length}/5 vueltas del kart actual)`:'';

  const avg5=_enAvg5(e.lapHistory);
  if(!avg5||!trackAvg)
    return `SIN DATOS\nVueltas del kart actual: ${cleanStint.length} (necesita 5)`;

  const stintBest=cleanStint.length?Math.min(...cleanStint):null;
  const _pr=_enPilotRatings[e.name]??null;
  const pilotScore=typeof _pr==='object'?_pr?.score:_pr;
  const isReliable=pilotScore!=null?pilotScore>=600:false;
  const threshold=pilotScore>=800?0.3:pilotScore>=600?0.5:pilotScore>=400?0.7:1.0;
  const ref=isReliable?avg5:stintBest;
  const delta=ref!=null?(ref-trackAvg):null;
  const deltaStr=delta!=null?`${delta>=0?'+':''}${delta.toFixed(3)}s`:'—';

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
  const refLine=isReliable
    ?`Referencia: M5v ${_enFmt(avg5)} (piloto fiable)`
    :`Referencia: mejor vuelta ${stintBest?_enFmt(stintBest):'—'} (piloto no fiable / sin datos)`;

  return `${label} (auto)\n${pilotLine}\n${refLine}\nDelta: ${deltaStr} · Media pista: ${_enFmt(trackAvg)}${fewDataNote}`;
}

