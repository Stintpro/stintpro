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
    .sp-topbar{display:flex;align-items:center;gap:10px;margin-bottom:12px;}
    .sp-topbar>*{-webkit-app-region:no-drag;}
    .sp-wdot{width:11px;height:11px;border-radius:50%;}
    .sp-session{font-size:12.5px;color:#444;font-family:sans-serif;margin-left:4px;flex:1;}
    .sp-clock{text-align:right;}
    .sp-clock-val{font-size:27.5px;font-weight:500;color:#fff;font-family:monospace;letter-spacing:-1px;line-height:1;}
    .sp-clock-lbl{font-size:11.5px;color:#3a3b42;margin-top:1px;}
    .en-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;width:100%;-webkit-app-region:no-drag;}
    .sp-kpi{background:#0e0f11;border-radius:8px;padding:10px 14px;border:0.5px solid #1e1f25;}
    .sp-kpi-lbl{font-size:11.5px;color:#3a3b42;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;font-family:sans-serif;}
    .sp-kpi-val{font-size:23.5px;font-weight:500;font-family:monospace;line-height:1.1;letter-spacing:-0.5px;}
    .sp-kpi-sub{font-size:11.5px;color:#444;margin-top:3px;font-family:sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .en-thead{display:grid;grid-template-columns:20px 42px 42px 1fr 44px 86px 86px 78px 62px 64px 62px 68px 38px;column-gap:10px;padding:5px 14px;border-bottom:0.5px solid #1a1b20;flex-shrink:0;}
    .en-thead span{font-size:11.5px;color:#333;text-transform:uppercase;letter-spacing:0.5px;text-align:right;}
    .en-thead span:nth-child(4){text-align:left;}
    .en-thead span:nth-child(1),.en-thead span:nth-child(2){text-align:center;}
    .sp-body{overflow-y:auto;flex:1;}
    .sp-rowwrap{position:relative;}
    .en-row{display:grid;grid-template-columns:20px 42px 42px 1fr 44px 86px 86px 78px 62px 64px 62px 68px 38px;column-gap:10px;padding:7px 14px;border-bottom:0.5px solid #111213;align-items:center;cursor:pointer;position:relative;}
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

  // Pit OUT: kart NUEVO → reset total SOLO en la transición (el estado 'out' persiste varios ticks)
  if(e.pitState==='out'){
    if(state._lastPitState!=='out'){
      state.quality=null;
      state.badCount=0;
      state.prePitQuality=null;
      state.stintStartIdx=e.lapHistory.length; // las vueltas anteriores son del kart viejo
    }
    state._lastPitState='out';
    return null; // sin datos del kart nuevo
  }
  state._lastPitState=e.pitState||null;

  // Solo vueltas del KART ACTUAL (desde el último pit out)
  const startIdx=Math.min(state.stintStartIdx||0, e.lapHistory.length);
  const stintLaps=e.lapHistory.slice(startIdx);
  const clean=_enCleanLaps(stintLaps);
  if(clean.length<3)return null; // el kart actual aún no tiene datos suficientes
  const last5=clean.slice(-5);
  const mn=Math.min(...last5), mx=Math.max(...last5);
  const range=mx-mn;
  const avg5=last5.reduce((a,b)=>a+b,0)/last5.length;
  const isRegular=range<0.5;
  // Mejor vuelta del KART ACTUAL, no de toda la carrera (el best global puede ser de otro kart)
  const stintBest=Math.min(...clean);

  // Calcular calidad instantánea
  let instant=null;
  if(isRegular){
    const delta=avg5-trackAvg;
    if(delta<-0.5)instant='good';
    else if(delta>0.5)instant='bad';
  } else {
    const delta=stintBest-trackAvg;
    if(delta<-0.5)instant='good';
    else if(delta>0.5)instant='bad';
  }

  // Bloqueo: si rueda POR ENCIMA de la media, no puede ser bueno
  // salvo que tenga una vuelta rápida < media - 0.5s (del kart actual)
  if(instant==='good'&&avg5>trackAvg){
    const hasFastLap=stintBest<trackAvg-0.5;
    if(!hasFastLap)instant=null;
  }

  // Malo si rueda +2.0s más lento que la vuelta rápida del kart actual
  if(avg5>stintBest+2.0)instant='bad';

  // Si no es bueno ni malo → neutro
  if(!instant)instant='neutral';

  // Si era bueno, se mantiene verde (solo se quita en pit o manual)
  if(state.quality==='good'){
    return state.quality;
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
  const avg5=_enAvg5(e.lapHistory);
  const cons=_enCons(e.lapHistory);
  if(!avg5||!trackAvg){
    const cleanLaps=(e.lapHistory||[]).length;
    return `SIN DATOS\nVueltas: ${cleanLaps} (necesita 5)`;
  }
  // Calcular rango numérico para el tooltip (independiente del objeto cons)
  const cleanH=_enCleanLaps(e.lapHistory);
  const last5H=cleanH.slice(-5);
  const consRange=last5H.length>=2?(Math.max(...last5H)-Math.min(...last5H)):null;
  const isRegular=consRange!==null&&consRange<0.5;
  const effective=_enEffectiveQuality(dorsal, e, trackAvg);
  const labels={good:'BUENO',neutral:'NEUTRO',bad:'MALO'};
  const label=labels[effective]||'SIN DATOS';
  if(isRegular){
    const delta=(avg5-trackAvg).toFixed(3);
    return `${label} (auto)\nM5v: ${_enFmt(avg5)} · Media: ${_enFmt(trackAvg)}\nDelta: ${delta>0?'+':''}${delta}s (umbral: ±0.5s)\nPiloto regular (rango ${consRange.toFixed(2)}s)`;
  } else {
    const best=e.bestLap;
    const delta=best?(best-trackAvg).toFixed(3):'—';
    return `${label} (auto)\nMejor: ${best?_enFmt(best):'—'} · Media: ${_enFmt(trackAvg)}\nDelta: ${delta>0?'+':''}${delta}s (umbral: ±0.5s)\nPiloto ${consRange>1?'errático':'irregular'} (rango ${consRange!==null?consRange.toFixed(2):'—'}s) → evalúa mejor vuelta\nM5v: ${_enFmt(avg5)} (no fiable)`;
  }
}


// ── Barra de progreso ─────────────────────────────────────────────────────
function _enUpdateBars(){
  const now=Date.now();
  EnSession.data.equipos.forEach(e=>{
    if(!e.lastLap||e.pit||!e._lapStart)return;
    const elapsed=(now-e._lapStart)/1000;
    const pct=Math.min(100,(elapsed/e.lastLap)*100);
    const bar=document.getElementById('en-bar-'+e.dorsal);
    if(bar)bar.style.width=pct+'%';
  });
}

// ── Render principal ───────────────────────────────────────────────────────
function _enRender(){
  const el=document.getElementById('screen-dash');
  if(!el||!el.classList.contains('active'))return;

  const eq=EnSession.data.equipos;
  const bests=eq.filter(e=>e.bestLap).map(e=>e.bestLap).sort((a,b)=>a-b);
  const trackAvg=_enTrackAvgLive(eq)||EnSession.lastTrackAvg||( bests.length?bests[Math.floor(bests.length/2)]:null );
  const bestSess=bests[0]||null;
  const inPit=eq.filter(e=>e.pit).length;
  const leader=eq.find(e=>e.pos===1);
  const clk=window.ApexClock?window.ApexClock.fmtMs(window.ApexClock.remainingMs()):'—';
  const isSimMode=window.AppState?.config?.simMode;
  const myDorsal=window.AppState?.config?.myDorsal;
  const myKart=eq.find(e=>e.dorsal===myDorsal);

  if(!el.querySelector('.sp-body')){
    _enRenderSkeleton(el, clk, isSimMode, leader, trackAvg, bestSess, inPit, myKart, myDorsal);
  } else {
    const clkEl=el.querySelector('#sp-clk');
    if(clkEl)clkEl.textContent=clk;
    try{_enUpdateKpis(el, leader, trackAvg, bestSess, inPit, myKart, myDorsal, eq);}
    catch(err){console.error('[StintPro] Error KPIs:',err);}
  }

  // Cargar historial de pilotos desde el logger (solo primera vez por sesión)
  if(_enPilotHistory===null && Logger?._serverUrl && eq.length){
    const cfg=window.AppState?.config;
    if(cfg?.slug) _enFetchPilotHistory(eq, cfg.slug);
  }

  try{
    const body=el.querySelector('#en-grid-body');
    if(body)body.innerHTML=_enRenderRows(eq, trackAvg, bestSess, leader, myDorsal);
  }catch(err){console.error('[StintPro] Error grid:',err);}

  try{
    const teamBody=el.querySelector('#en-team-body');
    if(teamBody&&EnUi.tab==='team'){
      const tcfg=teamBody.querySelector('#en-team-config');
      const tdyn=teamBody.querySelector('#en-team-dynamic');
      if(tcfg&&!tcfg.innerHTML)tcfg.innerHTML=_enRenderTeamConfig();
      if(tdyn)tdyn.innerHTML=_enRenderTeam(myKart, trackAvg);
    }
  }catch(err){console.error('[StintPro] Error mi equipo:',err);}

  try{
    const stratBody=el.querySelector('#en-strat-body');
    if(stratBody&&EnUi.tab==='strat'){
      const configDiv=stratBody.querySelector('#en-strat-config');
      const dynDiv=stratBody.querySelector('#en-strat-dynamic');
      if(configDiv&&!configDiv.innerHTML)configDiv.innerHTML=_enRenderStratConfig();
      if(dynDiv)dynDiv.innerHTML=_enRenderStrategy(eq, trackAvg);
    }
  }catch(err){console.error('[StintPro] Error estrategia:',err);}

  try{
    const advBody=el.querySelector('#en-adv-body');
    if(advBody&&EnUi.tab==='adv'){
      const advCfg=advBody.querySelector('#en-adv-config');
      if(advCfg&&!advCfg.innerHTML)advCfg.innerHTML=_enRenderAdvConfig();
      // Túnel: esqueleto estático pintado una sola vez, chips actualizados por RAF
      const advTunnel=advBody.querySelector('#en-adv-tunnel');
      if(advTunnel&&!advTunnel.innerHTML){
        const calibrated=EnSession.pitOutCalibration.length>=2;
        const offset=calibrated?EnSession.pitOutCalibration.reduce((a,b)=>a+b,0)/EnSession.pitOutCalibration.length:0;
        advTunnel.innerHTML=_enRenderTunnelShell(calibrated, EnSession.pitOutCalibration.length, offset);
        _enStartAdvRaf();
      }
      // Plan de paradas: se actualiza cada 5s
      const advPlan=advBody.querySelector('#en-adv-plan');
      if(advPlan){
        const now=Date.now();
        if(!advPlan._lastRender||now-advPlan._lastRender>5000){
          advPlan.innerHTML=_enRenderAdvPlan();
          advPlan._lastRender=now;
        }
      }
    }
  }catch(err){console.error('[StintPro] Error avanzado:',err);}
}

function _enRenderSkeleton(el, clk, isSimMode, leader, trackAvg, bestSess, inPit, myKart, myDorsal){
  const cfg=window.AppState?.config;
  el.innerHTML=`
  <div class="sp-header">
    <div class="sp-topbar">
      <div style="display:flex;gap:5px">
      </div>
      <span class="sp-session">
        ${cfg?.name||'Endurance'}
        ${isSimMode?'<span class="sp-sim-badge">SIMULACIÓN</span>':''}
      </span>
      <button class="sp-back" onclick="window._enGoBack()">← Setup</button>
      <div class="sp-clock">
        <div class="sp-clock-val" id="sp-clk">${clk}</div>
        <div class="sp-clock-lbl" id="sp-clk-lbl">tiempo restante</div>
      </div>
    </div>
    <div class="en-kpis" id="en-kpis">
      ${_enKpisHtml(leader, trackAvg, bestSess, inPit, myKart, myDorsal, EnSession.data.equipos)}
    </div>
  </div>
  <div class="en-tabs">
    <div class="en-tab ${EnUi.tab==='grid'?'active':''}" onclick="_enSetTab('grid')">📊 Clasificación</div>
    <div class="en-tab ${EnUi.tab==='team'?'active':''}" onclick="_enSetTab('team')">👥 Mi equipo</div>
    <div class="en-tab ${EnUi.tab==='strat'?'active':''}" onclick="_enSetTab('strat')">🎯 Estrategia</div>
    <div class="en-tab ${EnUi.tab==='adv'?'active':''}" onclick="_enSetTab('adv')">🔬 Avanzado</div>
  </div>
  <div class="en-thead" id="en-thead" style="${EnUi.tab==='grid'?'':'display:none'}">${_enTheadHtml()}</div>
  <div class="sp-body" id="en-grid-body" style="${EnUi.tab==='grid'?'':'display:none'}"></div>
  <div class="en-team" id="en-team-body" style="${EnUi.tab==='team'?'':'display:none'}">
    <div id="en-team-config"></div>
    <div id="en-team-dynamic"></div>
  </div>
  <div class="en-strat" id="en-strat-body" style="${EnUi.tab==='strat'?'':'display:none'}">
    <div id="en-strat-config"></div>
    <div id="en-strat-dynamic"></div>
  </div>
  <div class="en-strat" id="en-adv-body" style="${EnUi.tab==='adv'?'':'display:none'}">
    <div id="en-adv-config"></div>
    <div id="en-adv-tunnel"></div>
    <div id="en-adv-plan"></div>
  </div>
  <div class="sp-footer">
    <div class="sp-fl"><div class="sp-fldot" style="background:#22c55e"></div>En pista</div>
    <div class="sp-fl"><div class="sp-fldot" style="background:#ef4444"></div>En boxes</div>
    <div class="sp-fl"><div class="sp-fldot" style="background:#f97316"></div>Saliendo pit</div>
    <div class="sp-fl" style="margin-left:8px">Click kart = 🟢 → 🟡 → 🔴 → auto · Click fila = fijar</div>
  </div>`;
}

function _enKpisHtml(leader, trackAvg, bestSess, inPit, myKart, myDorsal, eq){
  // Stint timer
  const stintMs=EnSession.stintFrozen?EnSession.stintFrozen:(EnSession.stintStart?(Date.now()-EnSession.stintStart):0);
  const stintStr=_enFmtStint(stintMs);
  const stintCfg=window.AppState?.config;
  const stintMaxMs=(stintCfg?.stintMax||999)*60*1000;
  const stintMinMs=(stintCfg?.stintMin||0)*60*1000;
  const stintPct=stintMaxMs>0?Math.min(100,stintMs/stintMaxMs*100):0;
  const stintColor=stintPct>85?'#ef4444':stintPct>70?'#fbbf24':'#22c55e';
  const stintLaps=_enStintLaps(myKart);

  // Ventana de pit
  let pitWindow='';
  if(stintMinMs>0&&stintMaxMs<999*60*1000){
    const minLeft=Math.max(0,Math.ceil((stintMinMs-stintMs)/60000));
    const maxLeft=Math.max(0,Math.ceil((stintMaxMs-stintMs)/60000));
    if(stintMs<stintMinMs)pitWindow=`Pit en ${minLeft}-${maxLeft} min`;
    else if(stintMs<stintMaxMs)pitWindow=`⚠ Ventana abierta · ${maxLeft} min`;
    else pitWindow='🔴 Fuera de ventana';
  }

  // Semáforo stint
  let stintLight='⚪'; let stintLightCol='#555';
  if(stintMinMs>0||stintMaxMs<999*60*1000){
    if(stintMs<stintMinMs){stintLight='🔴'; stintLightCol='#ef4444';}
    else if(stintMs<stintMaxMs){stintLight='🟢'; stintLightCol='#22c55e';}
    else {stintLight='🔴'; stintLightCol='#ef4444';}
  }

  // Mi equipo info
  const myPos=myKart?myKart.pos:'—';
  const myLast=myKart&&myKart.lastLap?_enFmt(myKart.lastLap):'—';
  const myAvg5=myKart?_enAvg5(myKart.lapHistory):null;
  const myAvg5Str=myAvg5?_enFmt(myAvg5):'—';
  const myTrend=myKart?_enTrend(myKart.lapHistory):{arrow:'',color:'#333'};

  // Media pista live
  const trackStr=trackAvg?_enFmt(trackAvg):'—';

  // Vueltas restantes estimadas
  const estLaps=_enEstLaps(trackAvg);
  const estStr=estLaps!==null?estLaps:'—';

  // Mejor sesión — buscar quién la tiene
  const bestKart=eq?.find(e=>e.bestLap&&bestSess&&Math.abs(e.bestLap-bestSess)<0.001);

  return `
  <div class="sp-kpi">
    <div class="sp-kpi-lbl">Mi equipo · #${myDorsal||'—'}</div>
    <div class="sp-kpi-val" style="color:#5b8dee">P${myPos} <span style="font-size:12px;color:${myTrend.color}">${myTrend.arrow}</span></div>
    <div class="sp-kpi-sub">Últ: ${myLast} · M5v: ${myAvg5Str}${EnSession.stintBestLap?' · Best: '+_enFmt(EnSession.stintBestLap):''}</div>
  </div>
  <div class="sp-kpi">
    <div class="sp-kpi-lbl">${stintLight} Stint · ${stintLaps}v</div>
    <div class="sp-kpi-val" style="color:${stintColor}">${stintStr}</div>
    <div class="sp-kpi-sub" style="background:linear-gradient(90deg,${stintColor}22 ${stintPct}%,transparent ${stintPct}%);border-radius:2px;padding:1px 4px">${pitWindow||(stintPct>85?'⚠ Cambio pronto':stintPct>70?'Atención':'En stint')}</div>
  </div>
  <div class="sp-kpi" style="cursor:pointer" onclick="_enShowAvgFilter()">
    <div class="sp-kpi-lbl">Media pista ${Object.values(EnUi.excludedFromAvg).filter(Boolean).length?'<span style="color:#f97316">('+Object.values(EnUi.excludedFromAvg).filter(Boolean).length+' excl.)</span>':''}</div>
    <div class="sp-kpi-val" style="color:#60a5fa">${trackStr}</div>
    <div class="sp-kpi-sub">click para filtrar equipos</div>
  </div>
  <div class="sp-kpi">
    <div class="sp-kpi-lbl">Mejor sesión</div>
    <div class="sp-kpi-val" style="color:#c084fc">${bestSess?_enFmt(bestSess):'—'}</div>
    <div class="sp-kpi-sub">${bestKart?bestKart.name:''}</div>
  </div>
  <div class="sp-kpi">
    <div class="sp-kpi-lbl">En boxes</div>
    <div class="sp-kpi-val" style="color:${inPit>0?'#f87171':'#22c55e'}">${inPit}</div>
    <div class="sp-kpi-sub">karts actualmente</div>
  </div>`;
}

function _enUpdateKpis(el, leader, trackAvg, bestSess, inPit, myKart, myDorsal, eq){
  const kpis=el.querySelector('#en-kpis');
  if(kpis)kpis.innerHTML=_enKpisHtml(leader, trackAvg, bestSess, inPit, myKart, myDorsal, eq);
}

// ── Deriva todos los valores calculados para una fila del grid ───────────
// Función pura de cómputo: sin DOM, sin side effects.
// Si algo aquí lanza, el error se aísla a esta fila — no congela el grid.
function _enDeriveRow(e, trackAvg, bestSess, leader, myDorsal){
  const now=Date.now();
  const kc=_enKartColor(e.dorsal);
  const avg5=_enAvg5(e.lapHistory);
  const quality=_enEffectiveQuality(e.dorsal, e, trackAvg);
  const trend=_enTrend(e.lapHistory);
  const cons=_enCons(e.lapHistory);

  // Color última vuelta vs media pista
  let lastCol='#9ca3af';
  if(e.lastLap&&trackAvg){
    const d=e.lastLap-trackAvg;
    if(d<-0.5)lastCol='#c084fc';
    else if(d<0)lastCol='#22c55e';
    else if(d>1.0)lastCol='#ef4444';
    else if(d>0.3)lastCol='#fbbf24';
  }
  const bestCol=e.bestLap&&bestSess&&Math.abs(e.bestLap-bestSess)<0.001?'#c084fc':'#9ca3af';

  // Delta vs pista
  const delta=avg5&&trackAvg?(avg5-trackAvg):null;
  const deltaStr=_enFmtDelta(delta);
  const deltaCol=_enDeltaColor(delta);

  // Color media 5 vueltas
  let m5Col='#6b7280';
  if(avg5&&trackAvg){
    const d=avg5-trackAvg;
    if(d<-0.3)m5Col='#22c55e';
    else if(d>0.5)m5Col='#ef4444';
  }

  // Flecha de cambio de posición
  let arrow='';
  if(e.posChange){
    arrow=e.posChange.delta>0
      ?`<span class="sp-au">▲${e.posChange.delta}</span>`
      :`<span class="sp-ad">▼${Math.abs(e.posChange.delta)}</span>`;
  }

  // Color del punto de estado
  let dotColor='#22c55e';
  if(e.pit&&e.pitState==='out')dotColor='#f97316';
  else if(e.pit)dotColor='#ef4444';
  else if(e.state==='su'||e.state==='sd')dotColor='#f97316';
  if(e.checkered)dotColor='#c084fc';

  // Badges de texto
  const pitBadge=e.pit?(e.pitState==='out'
    ?`<span class="sp-out-b">OUT${e.pitS?` ${e.pitS}s`:''}</span>`
    :`<span class="sp-pit-b">PIT${e.pitS?` ${e.pitS}s`:''}</span>`):'';
  const fixBadge=EnUi.pinned===e.dorsal?`<span class="sp-fix-b">fijado</span>`:'';
  const chkBadge=e.checkered?`<span style="font-size:11px" title="Sesión finalizada">🏁</span>`:'';

  // Borde del dorsal según calidad
  let kartBorder=kc.border;
  if(quality==='good')kartBorder='#22c55e';
  else if(quality==='neutral')kartBorder='#fbbf24';
  else if(quality==='bad')kartBorder='#ef4444';

  // Barra de progreso de vuelta
  let barPct=0, barClass='';
  if(e.lastLap&&e._lapStart&&!e.pit){
    const elapsed=(now-e._lapStart)/1000;
    barPct=Math.min(100,(elapsed/e.lastLap)*100);
    if(trackAvg){
      const d=e.lastLap-trackAvg;
      if(d<0)barClass='fast';
      else if(d>0.5)barClass='slow';
    }
  }

  // HTML del gap (extrae la IIFE inline a variable nombrada)
  let gapHtml='—';
  if(e.pos===1)gapHtml='—';
  else if(e.gap&&e.gap.includes('v'))gapHtml=`<span style="color:#f97316">${e.gap}</span>`;
  else if(e.gapMs>0)gapHtml=_enFmtGap(e.gapMs);
  else if(e.gap)gapHtml=e.gap;
  else if(leader&&leader.tours&&e.tours<leader.tours){
    const d=leader.tours-e.tours;
    gapHtml=`<span style="color:#f97316">+${d}v</span>`;
  }

  return{
    kc, avg5, quality, trend, cons,
    lastCol, bestCol, delta, deltaStr, deltaCol, m5Col,
    arrow, dotColor, pitBadge, fixBadge, chkBadge,
    kartBorder, barPct, barClass, gapHtml,
    flash:e.lapFlash?'sp-flash':'',
    pinned:EnUi.pinned===e.dorsal,
    isMe:e.dorsal===myDorsal,
    tooltip:_enQualityTooltip(e.dorsal, e, trackAvg),
    qualityBadge:_enQualityBadge(e.dorsal, e, trackAvg),
  };
}

// ── Renderiza el HTML de una fila a partir de los valores derivados ────────
// Solo construye strings — sin cálculos, sin lógica condicional de negocio.
function _enRenderRow(e, d){
  return`
  <div class="sp-rowwrap">
    <div class="en-row ${d.flash}${d.pinned?' sp-pinned':''}${d.isMe?' en-myrow':''}" onclick="_enPin('${e.dorsal}')">
      <div class="sp-dot" style="background:${d.dotColor}"></div>
      <div class="sp-pos">${e.pos===99?'—':e.pos}${d.arrow}</div>
      <div><div class="en-kart" style="background:${d.kc.bg};color:${d.kc.text};border:1.5px solid ${d.kartBorder}" onclick="_enToggleQuality('${e.dorsal}',event)" title="${d.tooltip}">${e.dorsal}${d.qualityBadge}</div></div>
      <div class="sp-name">${d.chkBadge}${e.name}${d.pitBadge}${d.fixBadge}${_enPilotHistory?.[e.name]?`<span class="en-info-btn" onclick="_enShowPilotHistory('${(e.name||'').replace(/'/g,"\\'")}',event)" title="Ver historial">ℹ</span>`:''}</div>
      <div class="sp-vtas">${e.tours}</div>
      <div class="sp-t" style="color:${e.lastLap?d.lastCol:'#2d2f38'}">${_enFmt(e.lastLap)}</div>
      <div class="sp-t" style="color:${e.bestLap?d.bestCol:'#2d2f38'}">${_enFmt(e.bestLap)}</div>
      <div class="en-m5" style="color:${d.m5Col}">${d.avg5?_enFmt(d.avg5):'—'}<span style="color:${d.trend.color};font-size:10px;margin-left:2px">${d.trend.arrow}</span></div>
      <div class="en-delta" style="color:${d.deltaCol}">${d.deltaStr}</div>
      <div class="sp-gap">${d.gapHtml}</div>
      <div class="sp-gap">${e.interval||'—'}</div>
      <div class="sp-cons" style="font-size:9px;cursor:pointer" onclick="_enShowLapHistory('${e.dorsal}',event)">${d.cons?`<span style="color:${d.cons.color}">${d.cons.label}</span>`:'—'}</div>
      <div class="sp-pitc">${e.standsCount||0}</div>
      <div class="sp-lapbar ${d.barClass}" id="en-bar-${e.dorsal}" style="width:${d.barPct}%"></div>
    </div>
  </div>`;
}

// ── Orquestador: ordena, deriva y renderiza todas las filas ───────────────
function _enRenderRows(eq, trackAvg, bestSess, leader, myDorsal){
  if(!eq.length)return`<div class="sp-empty" style="color:#333;font-size:12px;padding:20px">Sin datos — esperando conexión</div>`;

  let html='';

  if(EnUi.sortMode==='m5v'){
    eq=[...eq].sort((a,b)=>{
      const a5=_enAvg5(a.lapHistory);
      const b5=_enAvg5(b.lapHistory);
      if(!a5&&!b5)return(a.pos||99)-(b.pos||99);
      if(!a5)return 1;
      if(!b5)return-1;
      return a5-b5;
    });
    html+=`<div onclick="_enToggleSort()" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:6px;background:#5b8dee18;border-bottom:1px solid #5b8dee;cursor:pointer" title="Click para volver a la clasificación real">
      <span style="font-size:11px;color:#5b8dee;font-weight:600;letter-spacing:1px;font-family:sans-serif">⚡ ORDENADO POR RITMO (M5v) — NO ES LA CLASIFICACIÓN REAL</span>
    </div>`;
  }

  eq.forEach(e=>{
    try{
      html+=_enRenderRow(e, _enDeriveRow(e, trackAvg, bestSess, leader, myDorsal));
    }catch(err){
      console.error('[StintPro] Error en fila kart',e.dorsal,err);
      html+=`<div class="sp-rowwrap"><div class="en-row"><div class="sp-dot"></div><div class="sp-pos">${e.pos||'?'}</div><div></div><div class="sp-name">${e.dorsal}</div></div></div>`;
    }
  });
  return html;
}

function _enPin(dorsal){
  EnUi.pinned=(EnUi.pinned===dorsal)?null:dorsal;
  _enRender();
}

// ── Pestañas ──────────────────────────────────────────────────────────────
function _enSetTab(tab){
  EnUi.tab=tab;
  const thead=document.getElementById('en-thead');
  const grid=document.getElementById('en-grid-body');
  const team=document.getElementById('en-team-body');
  const strat=document.getElementById('en-strat-body');
  const adv=document.getElementById('en-adv-body');
  if(thead)thead.style.display=tab==='grid'?'':'none';
  if(grid)grid.style.display=tab==='grid'?'':'none';
  if(team)team.style.display=tab==='team'?'':'none';
  if(strat)strat.style.display=tab==='strat'?'':'none';
  if(adv)adv.style.display=tab==='adv'?'':'none';
  if(tab!=='adv')_enStopAdvRaf(); else _enStartAdvRaf();
  // Reset config cuando se entra a estrategia
  if(tab==='strat'){
    const cfgDiv=document.getElementById('en-strat-config');
    if(cfgDiv)cfgDiv.innerHTML=_enRenderStratConfig();
    // Recordar configurar stint si no se ha hecho
    const cfg=window.AppState?.config;
    if(!EnBox.stratConfigured&&(!cfg?.stintMax||cfg.stintMax>=999)){
      setTimeout(()=>{
        let overlay=document.getElementById('en-pilot-overlay');
        if(overlay)overlay.remove();
        overlay=document.createElement('div');
        overlay.id='en-pilot-overlay';
        overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:999;';
        overlay.innerHTML=`
          <div style="background:#1a1b22;border:0.5px solid #2a2b2e;border-radius:12px;padding:24px;max-width:340px;width:90%;text-align:center">
            <div style="font-size:24px;margin-bottom:8px">⚙️</div>
            <div style="font-size:14px;font-weight:500;color:#d0d2db;margin-bottom:8px;font-family:sans-serif">Configura la estrategia</div>
            <div style="font-size:12px;color:#9ca3af;margin-bottom:18px;font-family:sans-serif;line-height:1.5">Recuerda configurar el <b style="color:#fbbf24">stint mínimo y máximo</b> en la parte superior para que las previsiones y recomendaciones funcionen correctamente.</div>
            <button onclick="EnBox.stratConfigured=true;_enDismissOverlay()" style="width:100%;padding:10px;border-radius:6px;border:0.5px solid #5b8dee;background:#5b8dee18;color:#5b8dee;font-size:13px;cursor:pointer;font-family:sans-serif">Entendido</button>
          </div>`;
        document.body.appendChild(overlay);
      },300);
    }
  }
  if(tab==='team'){
    const tcfg=document.getElementById('en-team-config');
    if(tcfg)tcfg.innerHTML=_enRenderTeamConfig();
  }
  document.querySelectorAll('.en-tab').forEach((t,i)=>{
    t.classList.toggle('active',i===(tab==='grid'?0:tab==='team'?1:tab==='strat'?2:3));
  });
  _enRender();
}

// ── Cambio de piloto ──────────────────────────────────────────────────────
function _enShowPilotSelect(auto){
  const cfg=window.AppState?.config;
  const pilotos=cfg?.pilotos||[];
  if(!pilotos.length)return;
  const colors=['#5b8dee','#22c55e','#f97316','#c084fc','#f87171','#fbbf24'];

  // Crear overlay
  let overlay=document.getElementById('en-pilot-overlay');
  if(overlay)overlay.remove();
  overlay=document.createElement('div');
  overlay.id='en-pilot-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:999;';
  overlay.innerHTML=`
    <div style="background:#1a1b22;border:0.5px solid #2a2b2e;border-radius:12px;padding:24px;max-width:340px;width:90%;">
      <div style="font-size:14px;font-weight:500;color:#d0d2db;margin-bottom:4px;font-family:sans-serif">${auto?'🔄 Pit Out detectado':'🔄 Cambio de piloto'}</div>
      <div style="font-size:11px;color:#555;margin-bottom:18px;font-family:sans-serif">¿Quién está rodando ahora?</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${pilotos.map((p,i)=>`
          <button onclick="_enSelectPilot(${i})" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;border:0.5px solid ${i===EnSession.currentPilot?colors[i%colors.length]:'#2a2b2e'};background:${i===EnSession.currentPilot?colors[i%colors.length]+'15':'#13141a'};cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='${colors[i%colors.length]}'" onmouseout="this.style.borderColor='${i===EnSession.currentPilot?colors[i%colors.length]:'#2a2b2e'}'">
            <div style="width:28px;height:28px;border-radius:50%;background:${colors[i%colors.length]};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff">${p.name.charAt(0)}</div>
            <div style="flex:1;text-align:left">
              <div style="font-size:13px;color:#d0d2db;font-family:sans-serif">${p.name}</div>
              <div style="font-size:10px;color:#555;font-family:sans-serif">${i===EnSession.currentPilot?'En pista actualmente':'Disponible'}</div>
            </div>
          </button>
        `).join('')}
      </div>
      <button onclick="_enDismissOverlay()" style="width:100%;margin-top:12px;padding:8px;border-radius:6px;border:0.5px solid #2a2b2e;background:transparent;color:#555;font-size:11px;cursor:pointer;font-family:sans-serif">Cancelar</button>
    </div>`;
  document.body.appendChild(overlay);
}

function _enSelectPilot(idx){
  EnSession.currentPilot=idx;
  _enDismissOverlay();
  _enRender();
}

function _enDismissOverlay(){
  const overlay=document.getElementById('en-pilot-overlay');
  if(overlay)overlay.remove();
}

// ── Ficha de rival (historial desde logger) ────────────────────────────
function _enShowPilotHistory(name, evt) {
  evt.stopPropagation();
  const data = _enPilotHistory?.[name];
  if (!data) return;

  let existing = document.getElementById('en-pilot-history-overlay');
  if (existing) existing.remove();

  function fmtMs(ms) {
    if (!ms) return '—';
    const m = Math.floor(ms/60000);
    const s = ((ms%60000)/1000).toFixed(3).padStart(6,'0');
    return `${m}:${s}`;
  }
  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  }

  const sessRows = (data.sessions||[]).map(s=>`
    <tr>
      <td style="padding:7px 12px;font-size:12px;color:#64748b">${fmtDate(s.started_at)}</td>
      <td style="padding:7px 12px;font-size:12px;font-family:monospace;color:#22c55e;text-align:right">${fmtMs(s.best_ms)}</td>
      <td style="padding:7px 12px;font-size:12px;font-family:monospace;color:#5b8dee;text-align:right">${fmtMs(s.avg_ms)}</td>
      <td style="padding:7px 12px;font-size:12px;color:#475569;text-align:right">${s.laps}</td>
    </tr>`).join('');

  const overlay = document.createElement('div');
  overlay.id = 'en-pilot-history-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:998;';
  overlay.onclick = e => { if(e.target===overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div style="background:#0e0f11;border:1px solid #2a2d3a;border-radius:10px;width:min(500px,92vw);overflow:hidden">
      <div style="padding:14px 18px;border-bottom:1px solid #1e2130;display:flex;align-items:center;gap:10px">
        <span style="font-size:15px;font-weight:700;color:#e2e8f0;flex:1">${name}</span>
        <button onclick="document.getElementById('en-pilot-history-overlay').remove()" style="background:transparent;border:1px solid #2a2d3a;border-radius:6px;color:#64748b;padding:3px 8px;cursor:pointer;font-size:13px">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#1e2130;border-bottom:1px solid #1e2130">
        <div style="background:#0e0f11;padding:12px 16px">
          <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Mejor vuelta</div>
          <div style="font-size:20px;font-weight:700;color:#22c55e;font-family:monospace">${fmtMs(data.best_ms)}</div>
        </div>
        <div style="background:#0e0f11;padding:12px 16px">
          <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Ritmo medio</div>
          <div style="font-size:20px;font-weight:700;color:#5b8dee;font-family:monospace">${fmtMs(data.avg_ms)}</div>
        </div>
        <div style="background:#0e0f11;padding:12px 16px">
          <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Sesiones · Vueltas</div>
          <div style="font-size:20px;font-weight:700;color:#e2e8f0">${data.session_count} · <span style="color:#64748b;font-size:16px">${data.total_laps}</span></div>
        </div>
      </div>
      <div style="padding:12px 0;max-height:220px;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#13141a">
            <th style="padding:6px 12px;font-size:10px;color:#475569;text-transform:uppercase;text-align:left">Sesión</th>
            <th style="padding:6px 12px;font-size:10px;color:#475569;text-transform:uppercase;text-align:right">Mejor</th>
            <th style="padding:6px 12px;font-size:10px;color:#475569;text-transform:uppercase;text-align:right">Media</th>
            <th style="padding:6px 12px;font-size:10px;color:#475569;text-transform:uppercase;text-align:right">Vlts</th>
          </tr></thead>
          <tbody>${sessRows || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#475569;font-size:12px">Sin sesiones anteriores</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

// ── Filtro media pista ──────────────────────────────────────────────────
function _enToggleSort(){
  EnUi.sortMode=EnUi.sortMode==='pos'?'m5v':'pos';
  // Actualizar el header (está en el skeleton estático, no se re-renderiza solo)
  const thead=document.getElementById('en-thead');
  if(thead)thead.innerHTML=_enTheadHtml();
  _enRender();
}

function _enTheadHtml(){
  return `<span></span><span style="cursor:pointer;color:${EnUi.sortMode==='pos'?'#5b8dee':'#333'};text-decoration:underline dotted;text-underline-offset:3px" onclick="_enToggleSort()" title="Ordenar por posición real">Pos${EnUi.sortMode==='pos'?' ▼':''}</span><span>Kart</span>
    <span style="text-align:left">Equipo</span>
    <span>Vtas</span><span>Última</span><span>Mejor</span>
    <span style="cursor:pointer;color:${EnUi.sortMode==='m5v'?'#5b8dee':'#333'};text-decoration:underline dotted;text-underline-offset:3px" onclick="_enToggleSort()" title="Ordenar por media de 5 vueltas (ritmo real)">M5v${EnUi.sortMode==='m5v'?' ▼':''}</span>
    <span>Δ Pista</span>
    <span>Gap</span>
    <span>Int</span>
    <span>Consist.</span>
    <span>Pit</span>`;
}

// ── Config estática de la pestaña Avanzado (solo se pinta una vez) ────────
function _enRenderAdvConfig(){
  return `<div style="margin:14px 14px 0;background:#13141a;border:0.5px solid #1a1b22;border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:12px">
    <span style="font-size:12px;color:#9ca3af;font-family:sans-serif">⏱ Duración de parada (marcada por organización):</span>
    <input type="number" value="${EnBox.pitDuration}" min="30" max="600" onchange="EnBox.pitDuration=parseInt(this.value)||120" style="width:70px;padding:5px 8px;border-radius:6px;border:0.5px solid #2a2b2e;background:#0e0f11;color:#d0d2db;font-size:13px;text-align:center">
    <span style="font-size:12px;color:#555">segundos</span>
  </div>`;
}

// ── Pestaña Avanzado: túnel de salida de box (RAF loop) ──────────────────────────

// Calcula proyecciones estáticas desde datos de Apex — se llama solo cuando llegan datos nuevos
function _enComputeTunnelProjections(eq, myDorsal, offset){
  const trackAvg=_enTrackAvgLive(eq);
  const projections=[];
  eq.forEach(e=>{
    if(e.dorsal===myDorsal)return;
    if(e.pit)return;
    const lastPass=EnSession.linePasses[e.dorsal];
    const avg5=_enAvg5(e.lapHistory);
    if(!lastPass||!avg5)return;
    const quality=_enEffectiveQuality(e.dorsal, e, trackAvg);
    projections.push({dorsal:e.dorsal, name:e.name, lastPass, avg5, quality});
  });
  return {projections, offset};
}

// Renderiza el esqueleto del túnel + orden de paso (una vez) — valores actualizados por RAF
function _enRenderTunnelShell(calibrated, calibCount, offset){
  if(!calibrated){
    return `<div style="padding:14px 14px 0"><div style="background:#13141a;border:0.5px solid #1a1b22;border-radius:10px;padding:14px 16px;margin-bottom:12px">
      <div style="font-size:13px;font-weight:500;color:#d0d2db;font-family:sans-serif;margin-bottom:10px">🚦 Salida de box <span style="font-size:10px;color:#555;font-weight:400">(si paras ahora)</span></div>
      <div style="font-size:12px;color:#fbbf24;font-family:sans-serif;padding:8px 0">⏳ Calibrando — esperando paradas observadas (${calibCount}/2)</div>
      <div style="font-size:10px;color:#555;font-family:sans-serif">El sistema mide automáticamente el tiempo entre pit out y el primer pase por meta para calibrar la posición de salida en este circuito.</div>
    </div>
    <div style="background:#13141a;border:0.5px solid #1a1b22;border-radius:10px;padding:14px 16px;margin-bottom:12px">
      <div style="font-size:13px;font-weight:500;color:#d0d2db;font-family:sans-serif;margin-bottom:10px">🏁 Orden de paso por meta</div>
      <div id="en-cross-rows"></div>
    </div></div>`;
  }
  return `<div style="padding:14px 14px 0">
    <div style="background:#13141a;border:0.5px solid #1a1b22;border-radius:10px;padding:14px 16px;margin-bottom:12px">
      <div style="font-size:13px;font-weight:500;color:#d0d2db;font-family:sans-serif;margin-bottom:10px">🚦 Salida de box <span style="font-size:10px;color:#555;font-weight:400">(si paras ahora)</span></div>
      <div id="en-tunnel-nocfg" style="display:none;font-size:12px;color:#555;font-family:sans-serif">Configura tu dorsal en Estrategia para ver tu proyección de salida</div>
      <div id="en-tunnel-live" style="display:none">
        <div style="position:relative;height:70px;background:#0e0f11;border-radius:8px;margin:10px 0;overflow:hidden">
          <div style="position:absolute;top:32px;left:0;right:0;height:2px;background:#1e1f25"></div>
          <div style="position:absolute;top:14px;left:50%;transform:translateX(-50%);text-align:center;z-index:2">
            <div style="width:34px;height:24px;border-radius:5px;background:#5b8dee;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff">TÚ</div>
            <div style="font-size:8px;color:#5b8dee;margin-top:2px">sales aquí</div>
          </div>
          <div id="en-tunnel-chips"></div>
        </div>
        <div style="display:flex;gap:14px;align-items:center;margin-top:8px">
          <span id="en-tunnel-semaforo" style="font-size:13px;font-family:sans-serif;font-weight:500"></span>
          <span id="en-tunnel-hueco" style="font-size:11px;color:#9ca3af;font-family:sans-serif"></span>
          <span id="en-tunnel-zona" style="font-size:11px;color:#555;font-family:sans-serif"></span>
        </div>
        <div style="font-size:9px;color:#3a3b42;font-family:sans-serif;margin-top:6px">Calibración: ✓ ${calibCount} paradas observadas · offset ${offset.toFixed(0)}s · Estimación con margen ±5s</div>
      </div>
    </div>
    <div style="background:#13141a;border:0.5px solid #1a1b22;border-radius:10px;padding:14px 16px;margin-bottom:12px">
      <div style="font-size:13px;font-weight:500;color:#d0d2db;font-family:sans-serif;margin-bottom:10px">🏁 Orden de paso por meta</div>
      <div id="en-cross-rows"></div>
    </div>
  </div>`;
}

// RAF loop — solo mueve chips de posición, no reconstruye DOM
function _enAdvRafTick(){
  const tunnelLive=document.getElementById('en-tunnel-live');
  const tunnelNoCfg=document.getElementById('en-tunnel-nocfg');
  if(!tunnelLive){_enAdvRafId=null;return;}

  const eq=EnSession.data.equipos||[];
  const cfg=window.AppState?.config;
  const myDorsal=cfg?.myDorsal;
  const calibrated=EnSession.pitOutCalibration.length>=2;
  // Si acaba de calibrarse, regenerar el shell para mostrar el túnel live
  const advTunnel=document.getElementById('en-adv-tunnel');
  if(advTunnel&&calibrated&&!document.getElementById('en-tunnel-live')){
    const offset2=EnSession.pitOutCalibration.reduce((a,b)=>a+b,0)/EnSession.pitOutCalibration.length;
    advTunnel.innerHTML=_enRenderTunnelShell(true, EnSession.pitOutCalibration.length, offset2);
  }
  if(!calibrated){_enAdvRafId=requestAnimationFrame(_enAdvRafTick);return;}

  const offset=EnSession.pitOutCalibration.reduce((a,b)=>a+b,0)/EnSession.pitOutCalibration.length;

  if(!myDorsal||!eq.find(e=>e.dorsal===myDorsal)){
    tunnelLive.style.display='none';
    if(tunnelNoCfg)tunnelNoCfg.style.display='';
    _enAdvRafId=requestAnimationFrame(_enAdvRafTick);
    return;
  }
  tunnelLive.style.display='';
  if(tunnelNoCfg)tunnelNoCfg.style.display='none';

  const now=Date.now();
  const myExitTime=now+(EnBox.pitDuration+offset)*1000;
  const trackAvg=_enTrackAvgLive(eq);

  const projections=[];
  eq.forEach(e=>{
    if(e.dorsal===myDorsal||e.pit)return;
    const lastPass=EnSession.linePasses[e.dorsal];
    const avg5=_enAvg5(e.lapHistory);
    if(!lastPass||!avg5)return;
    const elapsed=(myExitTime-lastPass)/1000;
    const fraction=(elapsed/avg5)-Math.floor(elapsed/avg5);
    let delta=fraction*avg5;
    if(delta>avg5/2)delta=delta-avg5;
    const quality=_enEffectiveQuality(e.dorsal, e, trackAvg);
    projections.push({dorsal:e.dorsal, delta, quality});
  });
  projections.sort((a,b)=>a.delta-b.delta);

  // Actualizar chips individualmente sin reconstruir el contenedor
  const chipsEl=document.getElementById('en-tunnel-chips');
  if(chipsEl){
    const visible=projections.filter(p=>Math.abs(p.delta)<=20).slice(0,8);
    const seen=new Set();
    visible.forEach(p=>{
      seen.add(String(p.dorsal));
      const pct=50+(p.delta/20)*45;
      if(pct<2||pct>98)return;
      const qc=p.quality==='good'?'#22c55e':p.quality==='bad'?'#ef4444':p.quality==='neutral'?'#fbbf24':'#555';
      let chip=chipsEl.querySelector(`[data-d="${p.dorsal}"]`);
      if(!chip){
        chip=document.createElement('div');
        chip.dataset.d=String(p.dorsal);
        chip.style.cssText='position:absolute;top:18px;text-align:center;transition:left 0.4s ease';
        chip.innerHTML=`<div style="width:28px;height:20px;border-radius:4px;background:#1a1b22;color:#d0d2db;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;border:1.5px solid ${qc}" data-border>${p.dorsal}</div><div style="font-size:8px;color:#555;margin-top:2px" data-lbl></div>`;
        chipsEl.appendChild(chip);
      }
      chip.style.left=`${pct}%`;
      chip.style.transform='translateX(-50%)';
      const border=chip.querySelector('[data-border]');
      if(border)border.style.borderColor=qc;
      const lbl=chip.querySelector('[data-lbl]');
      if(lbl)lbl.textContent=`${p.delta>0?'+':''}${p.delta.toFixed(0)}s`;
    });
    // Eliminar chips que ya no están en rango
    chipsEl.querySelectorAll('[data-d]').forEach(el=>{
      if(!seen.has(el.dataset.d))el.remove();
    });
  }

  // Actualizar semáforo y resumen
  const inZone=projections.filter(p=>Math.abs(p.delta)<=15);
  let trafficIcon='🟢', trafficLabel='Aire limpio', trafficColor='#22c55e';
  if(inZone.length>=3){trafficIcon='🔴';trafficLabel='Tráfico denso';trafficColor='#ef4444';}
  else if(inZone.length>=1){trafficIcon='🟡';trafficLabel='Tráfico moderado';trafficColor='#fbbf24';}
  const sem=document.getElementById('en-tunnel-semaforo');
  if(sem){sem.style.color=trafficColor;sem.textContent=`${trafficIcon} ${trafficLabel}`;}
  const nearestAhead=projections.filter(p=>p.delta>0)[0];
  const nearestBehind=projections.filter(p=>p.delta<0).slice(-1)[0];
  const huecoEl=document.getElementById('en-tunnel-hueco');
  if(huecoEl)huecoEl.textContent=`Hueco: ${nearestAhead?nearestAhead.delta.toFixed(0)+'s':'∞'} delante · ${nearestBehind?Math.abs(nearestBehind.delta).toFixed(0)+'s':'∞'} detrás`;
  const zonaEl=document.getElementById('en-tunnel-zona');
  if(zonaEl)zonaEl.textContent=`${inZone.length} kart${inZone.length!==1?'s':''} en zona ±15s`;

  // ── Orden de paso por meta ──
  const crossEl=document.getElementById('en-cross-rows');
  if(crossEl){
    const leader=eq.find(e=>e.pos===1);
    const leaderTours=leader?.tours||0;

    // Construir lista de todos los karts con tiempo hasta su próximo cruce
    const crossList=[];
    eq.forEach(e=>{
      const lastPass=EnSession.linePasses[e.dorsal];
      const avg5=_enAvg5(e.lapHistory);
      if(!lastPass||!avg5)return;
      const elapsed=(now-lastPass)/1000;
      const lapFraction=elapsed/avg5;
      // Tiempo restante hasta el siguiente cruce
      const timeUntil=(1-(lapFraction-Math.floor(lapFraction)))*avg5;
      // Progreso en la vuelta actual (0–1)
      const progress=lapFraction-Math.floor(lapFraction);
      const lapped=leaderTours>0?(leaderTours-(e.tours||0)):0;
      const quality=_enEffectiveQuality(e.dorsal, e, trackAvg);
      crossList.push({dorsal:e.dorsal, name:e.name, pos:e.pos, timeUntil, progress, lapped, quality, inPit:!!e.pit});
    });
    // Ordenar: primero los que van a cruzar antes; los que están en pit al final
    crossList.sort((a,b)=>{
      if(a.inPit!==b.inPit)return a.inPit?1:-1;
      return a.timeUntil-b.timeUntil;
    });

    const seen=new Set();
    crossList.forEach((k,i)=>{
      seen.add(String(k.dorsal));
      const qc=k.quality==='good'?'#22c55e':k.quality==='bad'?'#ef4444':k.quality==='neutral'?'#fbbf24':'#555';
      const dimmed=k.lapped>0||k.inPit;
      const progPct=Math.min(100,Math.round(k.progress*100));
      const untilTxt=k.inPit?'en pit':`${Math.round(k.timeUntil)}s`;
      const lappedBadge=k.lapped>0?`<span style="font-size:9px;color:#f97316;background:#f9731618;border:0.5px solid #f9731640;border-radius:3px;padding:1px 4px;margin-left:4px">+${k.lapped}v</span>`:'';

      let row=crossEl.querySelector(`[data-cd="${k.dorsal}"]`);
      if(!row){
        row=document.createElement('div');
        row.dataset.cd=String(k.dorsal);
        row.style.cssText='display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid #1a1b22';
        row.innerHTML=`
          <span data-ord style="font-size:10px;color:#555;font-family:monospace;width:22px;text-align:right;flex-shrink:0"></span>
          <span data-pos style="font-size:11px;font-family:monospace;width:26px;font-weight:600;flex-shrink:0"></span>
          <span data-dor style="font-size:11px;color:#d0d2db;font-family:monospace;width:28px;flex-shrink:0"></span>
          <span data-nm style="font-size:11px;color:#9ca3af;font-family:sans-serif;flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis"></span>
          <span data-lp></span>
          <div style="width:60px;height:4px;background:#1e1f25;border-radius:2px;flex-shrink:0;overflow:hidden">
            <div data-bar style="height:4px;border-radius:2px;transition:width 0.5s linear"></div>
          </div>
          <span data-til style="font-size:10px;color:#555;font-family:monospace;width:28px;text-align:right;flex-shrink:0"></span>`;
        crossEl.appendChild(row);
      }
      // Actualizar solo los valores que cambian
      row.style.opacity=dimmed?'0.45':'1';
      const ord=row.querySelector('[data-ord]');if(ord)ord.textContent=`${i+1}º`;
      const pos=row.querySelector('[data-pos]');if(pos){pos.textContent=`P${k.pos}`;pos.style.color=k.lapped>0?'#6b7280':'#d0d2db';}
      const dor=row.querySelector('[data-dor]');if(dor)dor.textContent=`#${k.dorsal}`;
      const nm=row.querySelector('[data-nm]');if(nm)nm.textContent=k.name||'';
      const lp=row.querySelector('[data-lp]');if(lp)lp.innerHTML=lappedBadge;
      const bar=row.querySelector('[data-bar]');if(bar){bar.style.width=`${progPct}%`;bar.style.background=qc;}
      const til=row.querySelector('[data-til]');if(til)til.textContent=untilTxt;
    });
    // Eliminar filas de karts que ya no tienen datos
    crossEl.querySelectorAll('[data-cd]').forEach(el=>{
      if(!seen.has(el.dataset.cd))el.remove();
    });
    // Reordenar filas en el DOM según el nuevo orden
    crossList.forEach(k=>{
      const row=crossEl.querySelector(`[data-cd="${k.dorsal}"]`);
      if(row)crossEl.appendChild(row);
    });
  }

  _enAdvRafId=requestAnimationFrame(_enAdvRafTick);
}

// Arranca el RAF del túnel cuando se entra a la pestaña Avanzado
function _enStartAdvRaf(){
  if(_enAdvRafId)return;
  _enAdvRafId=requestAnimationFrame(_enAdvRafTick);
}

function _enStopAdvRaf(){
  if(_enAdvRafId){cancelAnimationFrame(_enAdvRafId);_enAdvRafId=null;}
}

// ── Plan de paradas restantes (se actualiza cada 5s, no cada tick Apex) ──
function _enRenderAdvPlan(){
  const eq=EnSession.data.equipos||[];
  const cfg=window.AppState?.config;
  const myDorsal=cfg?.myDorsal;
  const totalStops=EnBox.totalStops||0;
  const stintMinM=cfg?.stintMin||0;
  const stintMaxM=cfg?.stintMax||0;
  const remainMs=window.ApexClock?window.ApexClock.remainingMs():0;
  const myK=eq.find(e=>e.dorsal===myDorsal);

  let html='';
  if(totalStops>0&&remainMs>0&&!window.ApexClock?.isCountUp()){
    const myStops=myK&&myK.standsCount>0?myK.standsCount:(EnSession.stintHistory.length||0);
    const stopsLeft=Math.max(0,totalStops-myStops);
    const remainMin=remainMs/60000;
    const pitDurMin=EnBox.pitDuration/60;
    const trackTimeMin=remainMin-(stopsLeft*pitDurMin);
    const avgStintAvail=stopsLeft>=0?trackTimeMin/(stopsLeft+1):remainMin;

    let canPush=null, afterPushAvg=null;
    if(stintMaxM>0&&stintMaxM<999&&stopsLeft>0){
      const afterPushTrack=trackTimeMin-stintMaxM;
      afterPushAvg=afterPushTrack/stopsLeft;
      canPush=afterPushAvg>=stintMinM;
    }

    let planColor='#22c55e', planIcon='🟢', planMsg='Plan holgado';
    if(stintMinM>0&&avgStintAvail<stintMinM){planColor='#ef4444';planIcon='🔴';planMsg='IMPOSIBLE cumplir paradas — stint medio por debajo del mínimo';}
    else if(stintMinM>0&&avgStintAvail<stintMinM*1.25){planColor='#fbbf24';planIcon='🟡';planMsg='Plan ajustado — poco margen';}

    html+=`<div style="padding:0 14px 14px"><div style="background:#13141a;border:0.5px solid #1a1b22;border-radius:10px;padding:14px 16px;margin-bottom:12px">`;
    html+=`<div style="font-size:13px;font-weight:500;color:#d0d2db;font-family:sans-serif;margin-bottom:10px">📐 Plan de paradas restantes</div>`;
    html+=`<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px">
      <div style="background:#0e0f11;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:9px;color:#555;text-transform:uppercase;margin-bottom:3px">Paradas</div>
        <div style="font-size:17px;font-weight:500;color:#d0d2db;font-family:monospace">${myStops}/${totalStops}</div>
      </div>
      <div style="background:#0e0f11;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:9px;color:#555;text-transform:uppercase;margin-bottom:3px">Faltan</div>
        <div style="font-size:17px;font-weight:500;color:${stopsLeft>3?'#fbbf24':'#5b8dee'};font-family:monospace">${stopsLeft}</div>
      </div>
      <div style="background:#0e0f11;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:9px;color:#555;text-transform:uppercase;margin-bottom:3px">Stint medio disp.</div>
        <div style="font-size:17px;font-weight:500;color:${planColor};font-family:monospace">${avgStintAvail>0?avgStintAvail.toFixed(0):'—'}m</div>
      </div>
      <div style="background:#0e0f11;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:9px;color:#555;text-transform:uppercase;margin-bottom:3px">¿Apurar máx?</div>
        <div style="font-size:17px;font-weight:500;color:${canPush===null?'#555':canPush?'#22c55e':'#ef4444'};font-family:monospace">${canPush===null?'—':canPush?'SÍ':'NO'}</div>
      </div>
    </div>`;
    html+=`<div style="font-size:12px;color:${planColor};font-family:sans-serif">${planIcon} ${planMsg}</div>`;
    if(canPush!==null&&stintMaxM>0){
      html+=`<div style="font-size:10px;color:#555;font-family:sans-serif;margin-top:4px">Si apuras ${stintMaxM}m ahora → los ${stopsLeft} stints restantes quedan a ${afterPushAvg.toFixed(0)}m de media${canPush?'':' (por debajo del mínimo de '+stintMinM+'m)'}</div>`;
    }

    // Rivales comprometidos — incluye equipos con 0 paradas hechas (los más expuestos)
    const compromised=eq.filter(e=>!e.pit&&e.dorsal!==myDorsal).map(e=>{
      const rStopsLeft=Math.max(0,totalStops-(e.standsCount||0));
      const rTrackTime=remainMin-(rStopsLeft*pitDurMin);
      const rAvg=rTrackTime/(rStopsLeft+1);
      return {dorsal:e.dorsal, name:e.name, pos:e.pos, stops:e.standsCount||0, stopsLeft:rStopsLeft, avgStint:rAvg};
    }).filter(r=>r.stopsLeft>0&&stintMinM>0&&r.avgStint<stintMinM*1.3).sort((a,b)=>a.avgStint-b.avgStint);

    if(compromised.length){
      html+=`<div style="font-size:10px;color:#3a3b42;text-transform:uppercase;letter-spacing:0.5px;margin-top:12px;padding-top:10px;border-top:0.5px solid #1a1b22;margin-bottom:6px">⚠ Rivales comprometidos (deuda de paradas)</div>`;
      compromised.slice(0,5).forEach(r=>{
        const critical=r.avgStint<stintMinM;
        html+=`<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:11px;font-family:sans-serif">
          <span style="color:#fbbf24;font-family:monospace;width:24px">P${r.pos}</span>
          <span style="color:#d0d2db;flex:1">#${r.dorsal} ${r.name}</span>
          <span style="color:#555;font-family:monospace">${r.stops}/${totalStops} pits</span>
          <span style="color:${critical?'#ef4444':'#fbbf24'};font-family:monospace">${critical?'va a caer':'stints de '+r.avgStint.toFixed(0)+'m'}</span>
        </div>`;
      });
    }
    html+=`</div>`;
    html+=`<div style="font-size:10px;color:#3a3b42;font-family:sans-serif;text-align:center;padding:4px 0 14px">Información orientativa — el pool del box prima sobre el tráfico de salida</div>`;
    html+=`</div>`;
  } else if(totalStops<=0){
    html=`<div style="padding:0 14px 14px"><div style="background:#13141a;border:0.5px solid #1a1b22;border-radius:10px;padding:12px 16px;margin-bottom:12px;font-size:11px;color:#555;font-family:sans-serif">📐 Plan de paradas: configura las paradas obligatorias en Mi equipo para activar la proyección</div></div>`;
  } else {
    html=`<div style="padding:0 14px 14px"><div style="background:#13141a;border:0.5px solid #1a1b22;border-radius:10px;padding:12px 16px;margin-bottom:12px;font-size:11px;color:#555;font-family:sans-serif">📐 Plan de paradas: esperando countdown de carrera del circuito (sesión sin iniciar)</div></div>`;
  }
  return html;
}

function _enShowAvgFilter(){
  const eq=[...EnSession.data.equipos].sort((a,b)=>(a.lastLap||999)-(b.lastLap||999));
  const trackAvg=_enTrackAvgLive(EnSession.data.equipos);

  let overlay=document.getElementById('en-pilot-overlay');
  if(overlay)overlay.remove();
  overlay=document.createElement('div');
  overlay.id='en-pilot-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:999;';

  let rows='';
  eq.forEach(e=>{
    if(!e.lastLap||e.pit)return;
    const excluded=!!EnUi.excludedFromAvg[e.dorsal];
    const kc=_enKartColor(e.dorsal);
    let lapCol='#9ca3af';
    if(trackAvg){
      const d=(e.lastLap||0)-trackAvg;
      if(d<-0.5)lapCol='#c084fc';
      else if(d<0)lapCol='#22c55e';
      else if(d>0.5)lapCol='#ef4444';
      else if(d>0.2)lapCol='#fbbf24';
    }
    rows+=`<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;border:0.5px solid ${excluded?'#1a1b20':'#1e1f25'};background:${excluded?'#0e0f11':'#13141a'};cursor:pointer;opacity:${excluded?'0.4':'1'}" onclick="_enToggleAvgExclude('${e.dorsal}')">
      <div style="width:24px;height:18px;border-radius:4px;background:${kc.bg};color:${kc.text};border:1px solid ${kc.border};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">${e.dorsal}</div>
      <div style="flex:1;font-size:11px;color:${excluded?'#333':'#9ca3af'};font-family:sans-serif">${e.name}</div>
      <div style="font-size:12px;color:${excluded?'#333':lapCol};font-family:monospace">${_enFmt(e.lastLap)}</div>
      <div style="width:18px;height:18px;border-radius:3px;border:1.5px solid ${excluded?'#333':'#5b8dee'};background:${excluded?'transparent':'#5b8dee'};display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff">${excluded?'':'✓'}</div>
    </div>`;
  });

  overlay.innerHTML=`
    <div style="background:#1a1b22;border:0.5px solid #2a2b2e;border-radius:12px;padding:24px;max-width:380px;width:90%;max-height:80vh;display:flex;flex-direction:column">
      <div style="font-size:14px;font-weight:500;color:#d0d2db;margin-bottom:4px;font-family:sans-serif">📊 Filtro media pista</div>
      <div style="font-size:11px;color:#555;margin-bottom:14px;font-family:sans-serif">Click para incluir/excluir del cálculo. Media actual: <span style="color:#60a5fa">${trackAvg?_enFmt(trackAvg):'—'}</span></div>
      <div style="overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:4px">
        ${rows}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button onclick="_enResetAvgFilter()" style="flex:1;padding:8px;border-radius:6px;border:0.5px solid #2a2b2e;background:transparent;color:#555;font-size:11px;cursor:pointer;font-family:sans-serif">Reset (incluir todos)</button>
        <button onclick="_enDismissOverlay();_enRender()" style="flex:1;padding:8px;border-radius:6px;border:0.5px solid #5b8dee;background:#5b8dee22;color:#5b8dee;font-size:11px;cursor:pointer;font-family:sans-serif">Cerrar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function _enToggleAvgExclude(dorsal){
  EnUi.excludedFromAvg[dorsal]=!EnUi.excludedFromAvg[dorsal];
  _enShowAvgFilter(); // refrescar popup
}

function _enResetAvgFilter(){
  EnUi.excludedFromAvg={};
  _enShowAvgFilter();
}

// ── Edición de stints ────────────────────────────────────────────────────
function _enDeleteStint(idx){
  if(idx<0||idx>=EnSession.stintHistory.length)return;
  const s=EnSession.stintHistory[idx];
  let overlay=document.getElementById('en-pilot-overlay');
  if(overlay)overlay.remove();
  overlay=document.createElement('div');
  overlay.id='en-pilot-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:999;';
  overlay.innerHTML=`
    <div style="background:#1a1b22;border:0.5px solid #2a2b2e;border-radius:12px;padding:24px;max-width:320px;width:90%;text-align:center">
      <div style="font-size:14px;font-weight:500;color:#d0d2db;margin-bottom:8px;font-family:sans-serif">🗑 Borrar stint #${idx+1}</div>
      <div style="font-size:12px;color:#9ca3af;margin-bottom:6px;font-family:sans-serif">${s.pilot} · ${_enFmtStint(s.durationMs)}</div>
      <div style="font-size:11px;color:#ef4444;margin-bottom:18px;font-family:sans-serif">Esta acción no se puede deshacer</div>
      <div style="display:flex;gap:8px">
        <button onclick="_enDismissOverlay()" style="flex:1;padding:8px;border-radius:6px;border:0.5px solid #2a2b2e;background:transparent;color:#555;font-size:12px;cursor:pointer;font-family:sans-serif">Cancelar</button>
        <button onclick="_enConfirmDeleteStint(${idx})" style="flex:1;padding:8px;border-radius:6px;border:0.5px solid #ef4444;background:#ef444418;color:#ef4444;font-size:12px;cursor:pointer;font-family:sans-serif">Borrar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function _enConfirmDeleteStint(idx){
  if(idx>=0&&idx<EnSession.stintHistory.length){
    EnSession.stintHistory.splice(idx,1);
  }
  _enDismissOverlay();
  _enRender();
}

function _enStintDetail(idx){
  if(idx<0||idx>=EnSession.stintHistory.length)return;
  const s=EnSession.stintHistory[idx];
  const laps=s.lapTimes||[];
  const best=laps.length?Math.min(...laps):s.best;
  const avg=laps.length?laps.reduce((a,b)=>a+b,0)/laps.length:null;
  const avg5=laps.length>=5?laps.slice(-5).reduce((a,b)=>a+b,0)/5:avg;
  const cons=laps.length>=3?Math.max(...laps.slice(-5))-Math.min(...laps.slice(-5)):null;

  let overlay=document.getElementById('en-pilot-overlay');
  if(overlay)overlay.remove();
  overlay=document.createElement('div');
  overlay.id='en-pilot-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:999;';

  let lapRows='';
  laps.forEach((l,i)=>{
    const isBest=l===best;
    const col=isBest?'#22c55e':avg&&l>avg+1?'#ef4444':avg&&l<avg-0.3?'#60a5fa':'#9ca3af';
    lapRows+=`<div style="display:flex;justify-content:space-between;padding:3px 8px;border-radius:4px;background:${isBest?'#22c55e11':'transparent'}">
      <span style="font-size:11px;color:#555">${i+1}</span>
      <span style="font-size:12px;color:${col};font-family:monospace;font-weight:${isBest?'600':'400'}">${_enFmt(l)}${isBest?' ★':''}</span>
    </div>`;
  });

  const posIn=s.posIn||'—';
  const posOut=s.posOut||'—';
  const posChange=s.posIn&&s.posOut?s.posIn-s.posOut:0;
  const posStr=posChange>0?`<span style="color:#22c55e">↑${posChange}</span>`:posChange<0?`<span style="color:#ef4444">↓${Math.abs(posChange)}</span>`:'<span style="color:#555">=</span>';

  overlay.innerHTML=`
    <div style="background:#13141a;border:0.5px solid #2a2b2e;border-radius:12px;padding:24px;max-width:400px;width:95%;max-height:85vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div>
          <div style="font-size:16px;font-weight:600;color:#d0d2db;font-family:sans-serif">📊 Stint #${idx+1}</div>
          <div style="font-size:12px;color:#5b8dee;font-family:sans-serif;margin-top:2px">${s.pilot}</div>
        </div>
        <button onclick="_enDismissOverlay()" style="background:none;border:none;color:#555;font-size:18px;cursor:pointer;padding:4px">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
        <div style="background:#0e0f11;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:9px;color:#555;text-transform:uppercase;margin-bottom:3px">Duración</div>
          <div style="font-size:16px;font-weight:500;color:#d0d2db;font-family:monospace">${_enFmtStint(s.durationMs)}</div>
        </div>
        <div style="background:#0e0f11;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:9px;color:#555;text-transform:uppercase;margin-bottom:3px">Posición</div>
          <div style="font-size:16px;font-weight:500;color:#d0d2db;font-family:monospace">P${posIn}→P${posOut} ${posStr}</div>
        </div>
        <div style="background:#0e0f11;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:9px;color:#555;text-transform:uppercase;margin-bottom:3px">Vueltas</div>
          <div style="font-size:16px;font-weight:500;color:#5b8dee;font-family:monospace">${laps.length}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
        <div style="background:#0e0f11;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:9px;color:#555;text-transform:uppercase;margin-bottom:3px">Mejor</div>
          <div style="font-size:16px;font-weight:500;color:#22c55e;font-family:monospace">${best?_enFmt(best):'—'}</div>
        </div>
        <div style="background:#0e0f11;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:9px;color:#555;text-transform:uppercase;margin-bottom:3px">M5v</div>
          <div style="font-size:16px;font-weight:500;color:#d0d2db;font-family:monospace">${avg5?_enFmt(avg5):'—'}</div>
        </div>
        <div style="background:#0e0f11;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:9px;color:#555;text-transform:uppercase;margin-bottom:3px">Consist.</div>
          <div style="font-size:16px;font-weight:500;color:${cons&&cons<0.5?'#22c55e':cons&&cons<1?'#fbbf24':'#ef4444'};font-family:monospace">${cons?cons.toFixed(2)+'s':'—'}</div>
        </div>
      </div>

      ${laps.length?`
      <div style="font-size:10px;color:#3a3b42;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;padding-top:10px;border-top:0.5px solid #1a1b22">Listado de vueltas</div>
      <div style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:1px">
        ${lapRows}
      </div>
      `:'<div style="font-size:11px;color:#555;text-align:center;padding:12px">Sin datos de vueltas para este stint</div>'}

      ${s.pitTime?`<div style="font-size:11px;color:#555;text-align:center;margin-top:10px;padding-top:8px;border-top:0.5px solid #1a1b22">Parada: ${_enFmtStint(s.pitTime)}</div>`:''}
    </div>`;
  document.body.appendChild(overlay);
}

function _enEditStintPilot(stintIdx){
  const cfg=window.AppState?.config;
  const pilotos=cfg?.pilotos||[];
  if(!pilotos.length)return;
  const colors=['#5b8dee','#22c55e','#f97316','#c084fc','#f87171','#fbbf24'];
  const stint=EnSession.stintHistory[stintIdx];
  if(!stint)return;

  const durMin=Math.floor((stint.durationMs||0)/60000);
  const durSec=Math.floor(((stint.durationMs||0)%60000)/1000);
  const pitMin=Math.floor((stint.pitStopMs||0)/60000);
  const pitSec=Math.floor(((stint.pitStopMs||0)%60000)/1000);

  let overlay=document.getElementById('en-pilot-overlay');
  if(overlay)overlay.remove();
  overlay=document.createElement('div');
  overlay.id='en-pilot-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:999;';
  overlay.innerHTML=`
    <div style="background:#1a1b22;border:0.5px solid #2a2b2e;border-radius:12px;padding:24px;max-width:360px;width:90%;">
      <div style="font-size:14px;font-weight:500;color:#d0d2db;margin-bottom:14px;font-family:sans-serif">✏️ Editar stint #${stintIdx+1}</div>
      <div style="font-size:11px;color:#666;margin-bottom:6px;font-family:sans-serif">Piloto</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
        ${pilotos.map((p,i)=>`
          <button id="en-edit-pilot-${i}" onclick="document.querySelectorAll('[id^=en-edit-pilot]').forEach(b=>b.style.borderColor='#2a2b2e');this.style.borderColor='${colors[i%colors.length]}';document.getElementById('en-edit-pidx').value=${i}" style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;border:1.5px solid ${i===stint.pilotIdx?colors[i%colors.length]:'#2a2b2e'};background:#13141a;cursor:pointer;font-size:12px;color:#d0d2db;font-family:sans-serif">
            <div style="width:20px;height:20px;border-radius:50%;background:${colors[i%colors.length]};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff">${p.name.charAt(0)}</div>
            ${p.name}
          </button>
        `).join('')}
      </div>
      <input type="hidden" id="en-edit-pidx" value="${stint.pilotIdx}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
        <div>
          <div style="font-size:11px;color:#666;margin-bottom:4px;font-family:sans-serif">Duración stint</div>
          <div style="display:flex;gap:4px;align-items:center">
            <input type="number" id="en-edit-durmin" value="${durMin}" min="0" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:6px;border-radius:4px;font-size:12px;width:50px;font-family:monospace;text-align:right">
            <span style="color:#555;font-size:11px">m</span>
            <input type="number" id="en-edit-dursec" value="${durSec}" min="0" max="59" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:6px;border-radius:4px;font-size:12px;width:50px;font-family:monospace;text-align:right">
            <span style="color:#555;font-size:11px">s</span>
          </div>
        </div>
        <div>
          <div style="font-size:11px;color:#666;margin-bottom:4px;font-family:sans-serif">Parada pit</div>
          <div style="display:flex;gap:4px;align-items:center">
            <input type="number" id="en-edit-pitmin" value="${pitMin}" min="0" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:6px;border-radius:4px;font-size:12px;width:50px;font-family:monospace;text-align:right">
            <span style="color:#555;font-size:11px">m</span>
            <input type="number" id="en-edit-pitsec" value="${pitSec}" min="0" max="59" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:6px;border-radius:4px;font-size:12px;width:50px;font-family:monospace;text-align:right">
            <span style="color:#555;font-size:11px">s</span>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="_enApplyStintEdit(${stintIdx})" style="flex:1;padding:8px;border-radius:6px;border:0.5px solid #5b8dee;background:#5b8dee22;color:#5b8dee;font-size:11px;cursor:pointer;font-family:sans-serif">Guardar</button>
        <button onclick="_enDismissOverlay()" style="flex:1;padding:8px;border-radius:6px;border:0.5px solid #2a2b2e;background:transparent;color:#555;font-size:11px;cursor:pointer;font-family:sans-serif">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function _enApplyStintEdit(stintIdx){
  const cfg=window.AppState?.config;
  const pilotos=cfg?.pilotos||[];
  const s=EnSession.stintHistory[stintIdx];
  if(!s)return;
  const pidx=parseInt(document.getElementById('en-edit-pidx')?.value)||0;
  if(pilotos[pidx]){s.pilot=pilotos[pidx].name; s.pilotIdx=pidx;}
  const durMin=parseInt(document.getElementById('en-edit-durmin')?.value)||0;
  const durSec=parseInt(document.getElementById('en-edit-dursec')?.value)||0;
  s.durationMs=(durMin*60+durSec)*1000;
  const pitMin=parseInt(document.getElementById('en-edit-pitmin')?.value)||0;
  const pitSec=parseInt(document.getElementById('en-edit-pitsec')?.value)||0;
  s.pitStopMs=(pitMin*60+pitSec)*1000;
  _enDismissOverlay();
  _enRender();
}

function _enAddStint(){
  const cfg=window.AppState?.config;
  const pilotos=cfg?.pilotos||[];
  if(!pilotos.length)return;
  const colors=['#5b8dee','#22c55e','#f97316','#c084fc','#f87171','#fbbf24'];

  let overlay=document.getElementById('en-pilot-overlay');
  if(overlay)overlay.remove();
  overlay=document.createElement('div');
  overlay.id='en-pilot-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:999;';
  overlay.innerHTML=`
    <div style="background:#1a1b22;border:0.5px solid #2a2b2e;border-radius:12px;padding:24px;max-width:360px;width:90%;">
      <div style="font-size:14px;font-weight:500;color:#d0d2db;margin-bottom:14px;font-family:sans-serif">➕ Añadir stint manual</div>
      <div style="font-size:11px;color:#666;margin-bottom:6px;font-family:sans-serif">Piloto</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
        ${pilotos.map((p,i)=>`
          <button id="en-add-pilot-${i}" onclick="document.querySelectorAll('[id^=en-add-pilot]').forEach(b=>b.style.borderColor='#2a2b2e');this.style.borderColor='${colors[i%colors.length]}';document.getElementById('en-add-pidx').value=${i}" style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;border:1.5px solid ${i===0?colors[0]:'#2a2b2e'};background:#13141a;cursor:pointer;font-size:12px;color:#d0d2db;font-family:sans-serif">
            <div style="width:20px;height:20px;border-radius:50%;background:${colors[i%colors.length]};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff">${p.name.charAt(0)}</div>
            ${p.name}
          </button>
        `).join('')}
      </div>
      <input type="hidden" id="en-add-pidx" value="0">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
        <div>
          <div style="font-size:11px;color:#666;margin-bottom:4px;font-family:sans-serif">Duración stint</div>
          <div style="display:flex;gap:4px;align-items:center">
            <input type="number" id="en-add-durmin" value="0" min="0" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:6px;border-radius:4px;font-size:12px;width:50px;font-family:monospace;text-align:right">
            <span style="color:#555;font-size:11px">m</span>
            <input type="number" id="en-add-dursec" value="0" min="0" max="59" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:6px;border-radius:4px;font-size:12px;width:50px;font-family:monospace;text-align:right">
            <span style="color:#555;font-size:11px">s</span>
          </div>
        </div>
        <div>
          <div style="font-size:11px;color:#666;margin-bottom:4px;font-family:sans-serif">Parada pit</div>
          <div style="display:flex;gap:4px;align-items:center">
            <input type="number" id="en-add-pitmin" value="0" min="0" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:6px;border-radius:4px;font-size:12px;width:50px;font-family:monospace;text-align:right">
            <span style="color:#555;font-size:11px">m</span>
            <input type="number" id="en-add-pitsec" value="0" min="0" max="59" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:6px;border-radius:4px;font-size:12px;width:50px;font-family:monospace;text-align:right">
            <span style="color:#555;font-size:11px">s</span>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="_enApplyAddStint()" style="flex:1;padding:8px;border-radius:6px;border:0.5px solid #5b8dee;background:#5b8dee22;color:#5b8dee;font-size:11px;cursor:pointer;font-family:sans-serif">Añadir</button>
        <button onclick="_enDismissOverlay()" style="flex:1;padding:8px;border-radius:6px;border:0.5px solid #2a2b2e;background:transparent;color:#555;font-size:11px;cursor:pointer;font-family:sans-serif">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function _enApplyAddStint(){
  const cfg=window.AppState?.config;
  const pilotos=cfg?.pilotos||[];
  const pidx=parseInt(document.getElementById('en-add-pidx')?.value)||0;
  if(!pilotos[pidx])return;
  const durMin=parseInt(document.getElementById('en-add-durmin')?.value)||0;
  const durSec=parseInt(document.getElementById('en-add-dursec')?.value)||0;
  const pitMin=parseInt(document.getElementById('en-add-pitmin')?.value)||0;
  const pitSec=parseInt(document.getElementById('en-add-pitsec')?.value)||0;
  EnSession.stintHistory.push({
    pilot:pilotos[pidx].name,
    pilotIdx:pidx,
    durationMs:(durMin*60+durSec)*1000,
    laps:0,
    avg:null,
    best:null,
    posIn:null,
    posOut:null,
    pitStopMs:(pitMin*60+pitSec)*1000,
    endTime:new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}),
  });
  _enDismissOverlay();
  _enRender();
}

// ── Historial de vueltas (click en consistencia) ─────────────────────────
function _enShowLapHistory(dorsal, ev){
  ev.stopPropagation();
  const kart=EnSession.data.equipos.find(e=>e.dorsal===dorsal);
  if(!kart||!kart.lapHistory||!kart.lapHistory.length)return;

  const trackAvg=_enTrackAvgLive(EnSession.data.equipos);
  const hist=kart.lapHistory.filter(t=>t<180);
  const best=Math.min(...hist);
  const worst=Math.max(...hist);
  const avg=hist.reduce((a,b)=>a+b,0)/hist.length;
  const range=worst-best;
  const cons=_enCons(kart.lapHistory);

  let overlay=document.getElementById('en-pilot-overlay');
  if(overlay)overlay.remove();
  overlay=document.createElement('div');
  overlay.id='en-pilot-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:999;';

  let lapsHtml='';
  hist.forEach((t,i)=>{
    let col='#9ca3af';
    if(trackAvg){
      const d=t-trackAvg;
      if(d<-0.5)col='#c084fc';
      else if(d<-0.2)col='#22c55e';
      else if(d>0.5)col='#ef4444';
      else if(d>0.2)col='#fbbf24';
    }
    const isBest=Math.abs(t-best)<0.001;
    const isWorst=Math.abs(t-worst)<0.001;
    lapsHtml+=`<div style="display:flex;justify-content:space-between;padding:3px 8px;border-radius:4px;${isBest?'background:#22c55e15;':''}${isWorst?'background:#ef444415;':''}">
      <span style="color:#555;font-size:10px;font-family:sans-serif">${hist.length-i}</span>
      <span style="color:${col};font-family:monospace;font-size:13px;font-weight:${isBest||isWorst?'600':'400'}">${_enFmt(t)}</span>
    </div>`;
  });

  const kc=_enKartColor(dorsal);
  const quality=_enEffectiveQuality(dorsal, kart, trackAvg);
  const qBadge=quality==='good'?'🟢':quality==='bad'?'🔴':'⚪';

  overlay.innerHTML=`
    <div style="background:#1a1b22;border:0.5px solid #2a2b2e;border-radius:12px;padding:24px;max-width:320px;width:90%;max-height:80vh;display:flex;flex-direction:column;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div style="width:32px;height:32px;border-radius:6px;background:${kc.bg};color:${kc.text};border:1.5px solid ${kc.border};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px">${dorsal}</div>
        <div style="flex:1">
          <div style="font-size:14px;color:#d0d2db;font-family:sans-serif">${kart.name}</div>
          <div style="font-size:10px;color:#555;font-family:sans-serif">${qBadge} ${cons?cons.label:'—'} · Rango: ${range.toFixed(3)}s</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
        <div style="text-align:center">
          <div style="font-size:10px;color:#333;font-family:sans-serif">Media</div>
          <div style="font-size:13px;color:#60a5fa;font-family:monospace">${_enFmt(avg)}</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:10px;color:#333;font-family:sans-serif">Mejor</div>
          <div style="font-size:13px;color:#22c55e;font-family:monospace">${_enFmt(best)}</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:10px;color:#333;font-family:sans-serif">Peor</div>
          <div style="font-size:13px;color:#ef4444;font-family:monospace">${_enFmt(worst)}</div>
        </div>
      </div>
      <div style="font-size:10px;color:#333;margin-bottom:6px;font-family:sans-serif">Últimas ${hist.length} vueltas (reciente arriba)</div>
      <div style="overflow-y:auto;flex:1;display:flex;flex-direction:column-reverse;gap:2px">
        ${lapsHtml}
      </div>
      <button onclick="_enDismissOverlay()" style="width:100%;margin-top:12px;padding:8px;border-radius:6px;border:0.5px solid #2a2b2e;background:transparent;color:#555;font-size:11px;cursor:pointer;font-family:sans-serif">Cerrar</button>
    </div>`;
  document.body.appendChild(overlay);
}

// ── Cambio manual (botón) ────────────────────────────────────────────────
function _enChangePilot(){
  const cfg=window.AppState?.config;
  const pilotos=cfg?.pilotos||[];
  const myDorsal=cfg?.myDorsal;
  const myK=EnSession.data.equipos.find(e=>e.dorsal===myDorsal);

  // Guardar stint actual
  const stintMs=EnSession.stintFrozen?EnSession.stintFrozen:(EnSession.stintStart?(Date.now()-EnSession.stintStart):0);
  const stintLaps=_enStintLaps(myK);
  const pilotName=pilotos[EnSession.currentPilot]?.name||`Piloto ${EnSession.currentPilot+1}`;
  if(stintMs>5000){
    EnSession.stintHistory.push({
      pilot:pilotName,
      pilotIdx:EnSession.currentPilot,
      durationMs:stintMs,
      laps:stintLaps,
      lapTimes:[...EnSession.stintLapTimes],
      avg:_enAvg5(myK?.lapHistory),
      best:EnSession.stintBestLap,
      posIn:EnSession.posIn,
      posOut:myK?.pos||null,
      endTime:new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}),
    });
  }

  // Resetear stint
  EnSession.stintStart=Date.now();
  EnSession.stintFrozen=null;
  EnSession.data._stintStartTours=myK?.tours||0;
  EnSession.posIn=myK?.pos||null;
  EnSession.stintBestLap=null;
  EnSession.stintLapTimes=[];
  EnSession.data._lastMyLap=null;

  _enShowPilotSelect(false);
}

// ── Render vista equipo ──────────────────────────────────────────────────
function _enRenderTeamConfig(){
  return `<div class="en-team-card" style="padding:10px 14px">
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:12.5px;color:#666;font-family:sans-serif">Mínimo por piloto:</span>
        <input type="number" value="${EnBox.pilotMinTime}" min="0" placeholder="min" onchange="_enSetPilotMinTime(this.value)" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:4px 8px;border-radius:4px;font-size:12.5px;width:60px;font-family:monospace;text-align:right">
        <span style="font-size:10px;color:#555;font-family:sans-serif">min</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:12.5px;color:#666;font-family:sans-serif">Paradas obligatorias:</span>
        <input type="number" value="${EnBox.totalStops}" min="0" placeholder="total" onchange="_enSetTotalStops(this.value)" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:4px 8px;border-radius:4px;font-size:12.5px;width:60px;font-family:monospace;text-align:right">
        <span style="font-size:10px;color:#555;font-family:sans-serif">total carrera</span>
      </div>
    </div>
  </div>`;
}

function _enSetPilotMinTime(v){EnBox.pilotMinTime=parseInt(v)||0;}
function _enSetTotalStops(v){EnBox.totalStops=parseInt(v)||0;}

function _enRenderTeam(myKart, trackAvg){
  const cfg=window.AppState?.config;
  const pilotos=cfg?.pilotos||[];
  const currentPilot=pilotos[EnSession.currentPilot]||{name:'Sin definir'};
  const stintMs=EnSession.stintFrozen?EnSession.stintFrozen:(EnSession.stintStart?(Date.now()-EnSession.stintStart):0);
  const stintLaps=_enStintLaps(myKart);
  const colors=['#5b8dee','#22c55e','#f97316','#c084fc','#f87171','#fbbf24'];

  let html='';

  // ── Piloto actual ──────────────────────────────────────────
  html+=`<div class="en-team-card">
    <div class="en-team-title">Piloto en pista</div>
    <div class="en-pilot-current">
      <div class="en-pilot-avatar" style="background:${colors[EnSession.currentPilot%colors.length]}">${currentPilot.name.charAt(0)}</div>
      <div class="en-pilot-info">
        <div class="en-pilot-name">${currentPilot.name}</div>
        <div class="en-pilot-sub">Stint: ${_enFmtStint(stintMs)}${myKart?' · P'+myKart.pos:''}${EnSession.posIn?' (entró P'+EnSession.posIn+')':''}${EnSession.stintBestLap?' · Best: '+_enFmt(EnSession.stintBestLap):''}</div>
      </div>
      <button class="en-change-btn" style="background:#5b8dee;color:#fff" onclick="_enChangePilot()">🔄 Cambio</button>
    </div>
  </div>`;

  // ── Cola de pilotos ────────────────────────────────────────
  if(pilotos.length>1){
    html+=`<div class="en-team-card">
      <div class="en-team-title">Cola de pilotos</div>`;
    const queueOrder=[];
    for(let i=1;i<pilotos.length;i++){
      const idx=(EnSession.currentPilot+i)%pilotos.length;
      queueOrder.push(idx);
    }
    queueOrder.forEach((idx,i)=>{
      const p=pilotos[idx];
      const stints=EnSession.stintHistory.filter(s=>s.pilotIdx===idx);
      const totalMs=stints.reduce((a,s)=>a+s.durationMs,0);
      const totalLaps=stints.reduce((a,s)=>a+s.laps,0);
      html+=`<div class="en-queue-item">
        <div class="en-queue-num" style="${i===0?'background:#5b8dee;color:#fff':''}">${i+1}</div>
        <div class="en-queue-name" style="${i===0?'color:#d0d2db;font-weight:500':''}">${p.name}${i===0?' ← siguiente':''}</div>
        <div class="en-queue-stat">${stints.length}st · ${totalLaps}v · ${_enFmtStint(totalMs)}</div>
      </div>`;
    });
    html+=`</div>`;
  }

  // ── Historial de stints ────────────────────────────────────
  html+=`<div class="en-team-card">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="en-team-title">Historial de stints</div>
      <button onclick="_enAddStint()" style="font-size:10px;padding:3px 10px;border-radius:4px;border:0.5px solid #2a2b2e;background:#1a1b22;color:#666;cursor:pointer;font-family:sans-serif">➕ Añadir</button>
    </div>`;
  if(EnSession.stintHistory.length===0){
    html+=`<div style="color:#333;font-size:12px;font-family:sans-serif;padding:8px 0">Sin stints completados todavía</div>`;
  } else {
    html+=`<div class="en-stint-row en-stint-head">
      <span>#</span><span>Piloto</span><span>Stint</span><span>Pit</span><span>Media</span><span>Mejor</span><span>Pos</span><span></span>
    </div>`;
    EnSession.stintHistory.forEach((s,i)=>{
      const col=colors[s.pilotIdx%colors.length];
      const posStr=s.posIn&&s.posOut?`P${s.posIn}→P${s.posOut}`:(s.posIn?`P${s.posIn}`:'—');
      const posCol=s.posIn&&s.posOut?(s.posOut<s.posIn?'#22c55e':s.posOut>s.posIn?'#ef4444':'#6b7280'):'#6b7280';
      const pitStr=s.pitStopMs?_enFmtStint(s.pitStopMs):'—';
      html+=`<div class="en-stint-row">
        <span style="color:${col};font-weight:600">${i+1}</span>
        <span style="color:#9ca3af">${s.pilot}</span>
        <span style="color:#6b7280">${_enFmtStint(s.durationMs)}</span>
        <span style="color:#555">${pitStr}</span>
        <span style="color:#6b7280">${s.avg?_enFmt(s.avg):'—'}</span>
        <span style="color:#22c55e">${s.best?_enFmt(s.best):'—'}</span>
        <span style="color:${posCol};font-size:10px">${posStr}</span>
        <span style="display:flex;gap:2px">
          <button onclick="_enStintDetail(${i})" style="font-size:9px;background:none;border:none;color:#60a5fa;cursor:pointer;padding:2px" title="Detalle del stint">📊</button>
          <button onclick="_enEditStintPilot(${i})" style="font-size:9px;background:none;border:none;color:#5b8dee;cursor:pointer;padding:2px" title="Editar stint">✏️</button>
          <button onclick="_enDeleteStint(${i})" style="font-size:9px;background:none;border:none;color:#555;cursor:pointer;padding:2px" title="Borrar stint">🗑</button>
        </span>
      </div>`;
    });
  }
  html+=`</div>`;

  // ── Estrategia de paradas ────────────────────────────────────
  if(EnBox.totalStops>0){
    const stopsDone=EnSession.stintHistory.length;
    const stopsRemaining=Math.max(0,EnBox.totalStops-stopsDone);
    const cfg=window.AppState?.config;
    const stintMaxMin=(cfg?.stintMax||999);
    const stintMaxMs2=stintMaxMin*60*1000;

    // Tiempo restante de carrera
    let raceRemainingMs=0;
    if(window.ApexClock&&window.ApexClock._synced&&!window.ApexClock.isCountUp()){
      raceRemainingMs=Math.max(0,window.ApexClock.remainingMs());
    }
    const raceRemainingMin=Math.round(raceRemainingMs/60000);

    // Paradas mínimas necesarias para cubrir el tiempo restante
    const minNecessary=stintMaxMin<999?Math.ceil(raceRemainingMin/stintMaxMin):stopsRemaining;
    const strategic=Math.max(0,stopsRemaining-minNecessary);

    // Stint medio necesario
    const avgStintNeeded=stopsRemaining>0?Math.round(raceRemainingMin/stopsRemaining):0;

    // Colores
    const stratColor=strategic>0?'#22c55e':'#fbbf24';
    const avgColor=avgStintNeeded<stintMaxMin*0.7?'#22c55e':avgStintNeeded<stintMaxMin?'#fbbf24':'#ef4444';

    html+=`<div class="en-team-card">
      <div class="en-strat-title">Estrategia de paradas</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;text-align:center">
        <div>
          <div style="font-size:10px;color:#555;font-family:sans-serif">Hechas</div>
          <div style="font-size:22px;font-weight:600;color:#9ca3af;font-family:monospace">${stopsDone}/${EnBox.totalStops}</div>
        </div>
        <div>
          <div style="font-size:10px;color:#555;font-family:sans-serif">Restantes</div>
          <div style="font-size:22px;font-weight:600;color:#60a5fa;font-family:monospace">${stopsRemaining}</div>
        </div>
        <div>
          <div style="font-size:10px;color:#555;font-family:sans-serif">Estratégicas</div>
          <div style="font-size:22px;font-weight:600;color:${stratColor};font-family:monospace">${strategic}</div>
        </div>
        <div>
          <div style="font-size:10px;color:#555;font-family:sans-serif">Stint medio</div>
          <div style="font-size:22px;font-weight:600;color:${avgColor};font-family:monospace">${avgStintNeeded}m</div>
          <div style="font-size:9px;color:#555;font-family:sans-serif">máx ${stintMaxMin}m</div>
        </div>
      </div>
      ${strategic>0?`<div style="margin-top:10px;padding:6px 10px;border-radius:6px;background:#22c55e11;border:0.5px solid #22c55e33">
        <span style="font-size:11px;color:#22c55e;font-family:sans-serif">🎯 Tienes <b>${strategic}</b> parada${strategic>1?'s':''} estratégica${strategic>1?'s':''} disponible${strategic>1?'s':''} para cazar kart bueno</span>
      </div>`:`<div style="margin-top:10px;padding:6px 10px;border-radius:6px;background:#fbbf2411;border:0.5px solid #fbbf2433">
        <span style="font-size:11px;color:#fbbf24;font-family:sans-serif">⚠ Sin paradas estratégicas — apura cada stint al máximo</span>
      </div>`}
    </div>`;
  }

  // ── Resumen por piloto ─────────────────────────────────────
  html+=`<div class="en-team-card">
    <div class="en-team-title">Resumen por piloto${EnBox.pilotMinTime?' · Mínimo: '+EnBox.pilotMinTime+' min':''}</div>`;
  const minMs=EnBox.pilotMinTime*60*1000;
  pilotos.forEach((p,idx)=>{
    const stints=EnSession.stintHistory.filter(s=>s.pilotIdx===idx);
    let totalMs=stints.reduce((a,s)=>a+s.durationMs,0);
    const totalPitMs=stints.reduce((a,s)=>a+(s.pitStopMs||0),0);
    // Añadir stint actual si es el piloto en pista
    const isCurrent=idx===EnSession.currentPilot;
    if(isCurrent){
      const currentStintMs=EnSession.stintFrozen?EnSession.stintFrozen:(EnSession.stintStart?(Date.now()-EnSession.stintStart):0);
      totalMs+=currentStintMs;
    }
    const avgs=stints.filter(s=>s.avg).map(s=>s.avg);
    const avgAll=avgs.length?avgs.reduce((a,b)=>a+b,0)/avgs.length:null;
    const bests=stints.filter(s=>s.best).map(s=>s.best);
    const bestAll=bests.length?Math.min(...bests):null;
    const col=colors[idx%colors.length];

    // Tiempo restante al mínimo
    let remainStr='';
    let remainCol='#555';
    if(minMs>0){
      const remaining=minMs-totalMs;
      if(remaining<=0){remainStr='✅ Mínimo cumplido'; remainCol='#22c55e';}
      else{remainStr='Faltan '+_enFmtStint(remaining); remainCol='#ef4444';}
    }

    // Barra de progreso hacia mínimo
    const pct=minMs>0?Math.min(100,totalMs/minMs*100):0;

    html+=`<div class="en-queue-item" style="flex-wrap:wrap">
      <div class="en-pilot-avatar" style="background:${col};width:34px;height:34px;font-size:14px">${p.name.charAt(0)}</div>
      <div style="flex:1;min-width:120px">
        <div style="font-size:14.5px;color:${isCurrent?'#d0d2db':'#9ca3af'};font-family:sans-serif">${p.name}${isCurrent?' 🟢':''}</div>
        <div style="font-size:12.5px;color:#555;font-family:sans-serif">${stints.length} stints · ${_enFmtStint(totalMs)} pista${totalPitMs?' · '+_enFmtStint(totalPitMs)+' pit':''}</div>
      </div>
      <div style="text-align:right;min-width:90px">
        <div style="font-size:14.5px;color:#6b7280;font-family:monospace">${avgAll?_enFmt(avgAll):'—'}</div>
        <div style="font-size:12.5px;color:#22c55e;font-family:monospace">${bestAll?_enFmt(bestAll):'—'}</div>
      </div>
      ${minMs>0?`<div style="width:100%;margin-top:4px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="flex:1;height:5px;border-radius:2px;background:#1e1f25;margin-right:8px"><div style="height:100%;border-radius:2px;background:${pct>=100?'#22c55e':'#5b8dee'};width:${pct}%"></div></div>
          <span style="font-size:11.5px;color:${remainCol};font-family:sans-serif;white-space:nowrap">${remainStr}</span>
        </div>
      </div>`:''}
    </div>`;
  });
  html+=`</div>`;

  return html;
}

// ── Estrategia ─────────────────────────────────────────────────────────────
function _enRenderStratConfig(){
  const showCols=EnBox.config.type==='columns';
  const cfg=window.AppState?.config||{};
  return `<div class="en-strat-card" style="padding:10px 14px">
    <div class="en-strat-title">Configuración de estrategia</div>
    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:13.5px;color:#666;font-family:sans-serif">Box:</span>
        <select onchange="_enSetBoxType(this.value)" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#bdc2cc;padding:5px 10px;border-radius:4px;font-size:13.5px;font-family:sans-serif">
          <option value="line" ${EnBox.config.type==='line'?'selected':''}>Línea</option>
          <option value="battery" ${EnBox.config.type==='battery'?'selected':''}>Batería</option>
          <option value="columns" ${EnBox.config.type==='columns'?'selected':''}>Columnas</option>
        </select>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:13.5px;color:#666;font-family:sans-serif">Karts:</span>
        <input type="number" value="${EnBox.config.positions}" min="1" max="20" onchange="_enSetBoxPositions(this.value)" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#bdc2cc;padding:5px 10px;border-radius:4px;font-size:13.5px;width:50px;font-family:monospace;text-align:right">
      </div>
      ${showCols?`<div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:13.5px;color:#666;font-family:sans-serif">Cols:</span>
        <input type="number" value="${EnBox.config.columns||2}" min="1" max="10" onchange="_enSetBoxColumns(this.value)" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#bdc2cc;padding:5px 10px;border-radius:4px;font-size:13.5px;width:50px;font-family:monospace;text-align:right">
      </div>`:''}
      <div style="border-left:0.5px solid #2a2b2e;height:20px"></div>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:13.5px;color:#666;font-family:sans-serif">Stint min:</span>
        <input id="en-stint-min-input" type="number" value="${cfg.stintMin||0}" min="0" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#bdc2cc;padding:5px 10px;border-radius:4px;font-size:13.5px;width:50px;font-family:monospace;text-align:right">
        <span style="font-size:15px;color:#bdc2cc">m</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:13.5px;color:#666;font-family:sans-serif">Stint max:</span>
        <input id="en-stint-max-input" type="number" value="${cfg.stintMax||0}" min="0" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#bdc2cc;padding:5px 10px;border-radius:4px;font-size:13.5px;width:50px;font-family:monospace;text-align:right">
        <span style="font-size:15px;color:#bdc2cc">m</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center" title="Duración mínima de parada marcada por la organización. Usada para la clasificación estimada y la proyección de salida.">
        <span style="font-size:13.5px;color:#666;font-family:sans-serif">Parada:</span>
        <input type="number" value="${EnBox.pitDuration}" min="30" max="600" onchange="EnBox.pitDuration=parseInt(this.value)||120;_enRender()" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#bdc2cc;padding:5px 10px;border-radius:4px;font-size:13.5px;width:55px;font-family:monospace;text-align:right">
        <span style="font-size:15px;color:#bdc2cc">s</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:13.5px;color:#666;font-family:sans-serif">Dorsal:</span>
        <input type="text" value="${cfg.myDorsal||''}" onchange="_enUpdateCfg('myDorsal',this.value)" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#bdc2cc;padding:5px 10px;border-radius:4px;font-size:13.5px;width:50px;font-family:monospace;text-align:center">
      </div>
      <button id="en-stint-confirm-btn" onclick="_enConfirmStint()" style="padding:5px 12px;border-radius:4px;border:0.5px solid #5b8dee;background:#5b8dee18;color:#5b8dee;font-size:15px;cursor:pointer;font-family:sans-serif;white-space:nowrap">Confirmar</button>
    </div>
  </div>`;
}

function _enRenderStrategy(eq, trackAvg){
  const cfg=window.AppState?.config;
  const stintMaxMs=(cfg?.stintMax||999)*60*1000;
  const stintMinMs=(cfg?.stintMin||0)*60*1000;

  // Karts en pit con su calidad y tiempo
  const inPit=eq.filter(e=>e.pit);
  const pitKarts=inPit.map(e=>{
    const quality=_enEffectiveQuality(e.dorsal, e, trackAvg);
    const pitTime=e.pitS||0;
    // Stint mínimo → kart malo inmediatamente
    // Si entró con poco tiempo de stint, probablemente es malo
    return {dorsal:e.dorsal, name:e.name, quality, pitTime, pitState:e.pitState};
  });

  const goodInPit=pitKarts.filter(k=>k.quality==='good').length;
  const badInPit=pitKarts.filter(k=>k.quality==='bad').length;
  const neutralInPit=pitKarts.filter(k=>k.quality==='neutral').length;
  const unknownInPit=pitKarts.filter(k=>!k.quality||k.quality===null||k.quality===undefined).length;
  const totalInPit=pitKarts.length;

  // Probabilidad según configuración del box
  const boxPos=EnBox.config.positions||4;
  const boxType=EnBox.config.type||'parallel';

  // Probabilidad de presencia (karts buenos entre todos)
  let probPresencia=0;
  if(totalInPit>0)probPresencia=Math.round((goodInPit/totalInPit)*100);

  // Probabilidad de acceso basada en la cola real
  let probAcceso=0;
  let probExplain='';

  if(EnBox.queue.length===0){
    probAcceso=0;
    probExplain='Cola vacía';
  } else if(boxType==='line'){
    // Línea: solo el primero importa
    const first=EnBox.queue[0];
    if(first.quality==='good'){probAcceso=100; probExplain='Primero en cola: BUENO';}
    else if(first.quality==='bad'){probAcceso=0; probExplain='Primero en cola: MALO';}
    else if(first.quality==='neutral'){probAcceso=40; probExplain='Primero en cola: NEUTRO';}
    else{probAcceso=50; probExplain='Primero en cola: DESCONOCIDO';}
  } else if(boxType==='battery'){
    // Batería: sorteo entre los karts EN LOS PUESTOS (primeros N de la cola); el resto espera
    const inSlots=EnBox.queue.slice(0,boxPos);
    const goodQ=inSlots.filter(k=>k.quality==='good').length;
    probAcceso=inSlots.length>0?Math.round((goodQ/inSlots.length)*100):0;
    const waiting=EnBox.queue.length-inSlots.length;
    probExplain=`Sorteo entre ${inSlots.length} en puestos · ${goodQ} buenos${waiting>0?' · '+waiting+' en espera':''}`;
  } else if(boxType==='columns'){
    // Columnas: los primeros de cada columna son los disponibles
    const nCols=EnBox.config.columns||2;
    const frontKarts=[];
    for(let c=0;c<nCols&&c<EnBox.queue.length;c++){
      frontKarts.push(EnBox.queue[c]);
    }
    const goodFront=frontKarts.filter(k=>k.quality==='good').length;
    probAcceso=frontKarts.length>0?Math.round((goodFront/frontKarts.length)*100):0;
    probExplain=`${nCols} columnas · ${goodFront} con bueno delante`;
  }
  if(probAcceso>100)probAcceso=100;

  // Si toda la cola es desconocida, no hay datos reales
  const allUnknown=EnBox.queue.length>0&&EnBox.queue.every(k=>k.quality==='unknown');
  const knownCount=EnBox.queue.filter(k=>k.quality!=='unknown').length;
  const knownRatio=EnBox.queue.length>0?knownCount/EnBox.queue.length:0;
  const partialData=!allUnknown&&knownRatio<0.5;
  let noBoxData=false;
  if(allUnknown){
    probAcceso=-1;
    probPresencia=0;
    probExplain='Sin movimientos registrados en el box';
    noBoxData=true;
  }

  // Color según probabilidad de acceso
  let probColor='#9ca3af';
  let probLabel='';
  if(noBoxData){probColor='#555'; probLabel='';}
  else if(probAcceso>=70){probColor='#22c55e'; probLabel='⚠ REVISAR BOX — alta probabilidad';}
  else if(probAcceso>=51){probColor='#60a5fa'; probLabel='📊 REVISAR BOX — probabilidad favorable';}
  else if(probAcceso>=30){probColor='#fbbf24'; probLabel='';}
  else if(totalInPit>0){probColor='#ef4444'; probLabel='🔴 Box desfavorable';}

  // Karts en pista por calidad
  // Techo del stint actual de cada rival: puede apurar al MÁXIMO mientras los stints
  // posteriores quepan con el mínimo. Solo cuando la deuda aprieta, el techo cae.
  // Fórmula: techo = elapsed + T_restante − paradas_pendientes × (parada + stint_mín)
  // Se auto-actualiza con cada parada (standsCount) y cada segundo (T_restante).
  const remainMsAll=window.ApexClock&&!window.ApexClock.isCountUp()?window.ApexClock.remainingMs():0;
  const stintMinMsRiv=(cfg?.stintMin||0)*60*1000;
  const rivalStintCapMs=(e, elapsed)=>{
    if(stintMaxMs>=999*60*1000)return stintMaxMs;
    if(!EnBox.totalStops||remainMsAll<=0||!(e.standsCount>0))return stintMaxMs;
    const stopsLeft=Math.max(0,EnBox.totalStops-e.standsCount);
    if(stopsLeft<=0)return stintMaxMs;
    const cap=(elapsed||0)+remainMsAll-stopsLeft*(EnBox.pitDuration*1000+stintMinMsRiv);
    return Math.max(0,Math.min(stintMaxMs,cap));
  };
  const mapOnTrack=(filterQ)=>eq.filter(e=>!e.pit&&_enEffectiveQuality(e.dorsal, e, trackAvg)===filterQ)
    .map(e=>{
      const pitOutTime=EnSession.rivalPitOut[e.dorsal];
      const elapsed=pitOutTime?(Date.now()-pitOutTime):null;
      const capMs=rivalStintCapMs(e, elapsed||0);
      const debtLimited=capMs<stintMaxMs*0.97; // su techo real es menor que el máximo
      const remaining=(elapsed!==null&&stintMaxMs<999*60*1000)?Math.max(0,capMs-elapsed):Infinity;
      const minLeft=remaining<Infinity?Math.ceil(remaining/60000):null;
      return {...e, _stintRemaining:remaining, _minLeft:minLeft, _debtLimited:debtLimited};
    })
    .sort((a,b)=>a._stintRemaining-b._stintRemaining);

  const goodOnTrack=mapOnTrack('good');
  const neutralOnTrack=mapOnTrack('neutral');
  const badOnTrack=mapOnTrack('bad');

  let html='';

  // ═══ ROW 1: Probabilidad (ancho completo) ═══
  html+=`<div class="en-strat-card">
    <div class="en-strat-title">Probabilidad de kart bueno</div>
    <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">
      <div>
        <div style="font-size:15px;color:#bdc2cc;font-family:sans-serif">Acceso</div>
        ${noBoxData?`<span style="font-size:18px;font-weight:500;color:#bdc2cc;font-family:sans-serif">SIN DATOS DE BOX</span>`:`<span style="font-size:28px;font-weight:600;color:${probColor};font-family:monospace">${probAcceso}%</span>${partialData?`<span style="font-size:11px;color:#fbbf24;background:#fbbf2418;border:0.5px solid #fbbf2444;border-radius:4px;padding:2px 5px;margin-left:6px;font-family:sans-serif;vertical-align:middle">⚠ datos parciales (${knownCount}/${EnBox.queue.length})</span>`:''}`}
      </div>
      <div title="% de karts buenos entre todos los que están físicamente en boxes ahora mismo (según cronometraje)">
        <div style="font-size:15px;color:#bdc2cc;font-family:sans-serif">En pit ahora</div>
        <span style="font-size:18px;font-weight:500;color:#bdc2cc;font-family:monospace">${probPresencia}%</span>
      </div>
      <span style="font-size:15px;color:${probColor};font-family:sans-serif;margin-left:auto">${probLabel}</span>
    </div>
    <div class="en-prob-bar"><div class="en-prob-fill" style="width:${probAcceso}%;background:${probColor}"></div></div>
    <div style="font-size:15px;color:#bdc2cc;font-family:sans-serif;margin-top:4px">${probExplain}</div>
    <div style="display:flex;gap:8px;margin-top:6px">
      <div style="display:flex;align-items:center;gap:3px"><div style="width:8px;height:8px;border-radius:2px;background:#22c55e"></div><span style="font-size:15px;color:#888">${goodInPit}</span></div>
      <div style="display:flex;align-items:center;gap:3px"><div style="width:8px;height:8px;border-radius:2px;background:#fbbf24"></div><span style="font-size:15px;color:#888">${neutralInPit}</span></div>
      <div style="display:flex;align-items:center;gap:3px"><div style="width:8px;height:8px;border-radius:2px;background:#ef4444"></div><span style="font-size:15px;color:#888">${badInPit}</span></div>
      <div style="display:flex;align-items:center;gap:3px"><div style="width:8px;height:8px;border-radius:2px;background:#333;border:0.5px solid #555"></div><span style="font-size:15px;color:#888">${unknownInPit}</span></div>
      <span style="font-size:15px;color:#bdc2cc;margin-left:auto">${totalInPit} en pit · ${EnBox.queue.length} en cola</span>
    </div>
  </div>`;

  // ═══ ROW 2: Karts en pista + (Cola + Movimientos) ═══
  html+=`<div style="display:grid;grid-template-columns:3fr 2fr;gap:10px;margin-bottom:10px">`;

  // Helper para renderizar kart como en dashboard
  const kartRow=(e,minStr,minCol)=>{
    const kc=_enKartColor(e.dorsal);
    const quality=_enEffectiveQuality(e.dorsal, e, trackAvg);
    let kartBorder=kc.border;
    if(quality==='good')kartBorder='#22c55e';
    else if(quality==='neutral')kartBorder='#fbbf24';
    else if(quality==='bad')kartBorder='#ef4444';
    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:0.5px solid #111">
      <div style="width:30px;height:22px;border-radius:5px;background:${kc.bg};color:${kc.text};border:1.5px solid ${kartBorder};display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;flex-shrink:0">${e.dorsal}</div>
      <div style="flex:1;font-size:15px;color:#e4e6ed;font-family:sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.name}</div>
      <span style="font-size:15px;color:${minCol};font-family:monospace;flex-shrink:0">${minStr}</span>
    </div>`;
  };

  // ── Karts en pista (3 sub-columnas) ──
  html+=`<div class="en-strat-card" style="margin:0">
    <div class="en-strat-title">Karts en pista</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">`;

  // Buenos
  html+=`<div>
    <div style="font-size:15px;color:#22c55e;margin-bottom:6px;font-weight:500">Buenos (${goodOnTrack.length})</div>`;
  if(goodOnTrack.length===0)html+=`<div style="font-size:15px;color:#333">—</div>`;
  goodOnTrack.slice(0,8).forEach(e=>{
    const minCol=e._minLeft!==null?(e._minLeft<=2?'#22c55e':e._minLeft<=5?'#fbbf24':'#555'):'#555';
    const minStr=e._minLeft!==null?e._minLeft+'m'+(e._debtLimited?'⚠':''):'';
    html+=kartRow(e, minStr, minCol);
  });
  html+=`</div>`;

  // Neutros
  html+=`<div>
    <div style="font-size:15px;color:#fbbf24;margin-bottom:6px;font-weight:500">Neutros (${neutralOnTrack.length})</div>`;
  if(neutralOnTrack.length===0)html+=`<div style="font-size:15px;color:#333">—</div>`;
  neutralOnTrack.slice(0,8).forEach(e=>{
    const minStr=e._minLeft!==null?e._minLeft+'m'+(e._debtLimited?'⚠':''):'';
    html+=kartRow(e, minStr, '#555');
  });
  html+=`</div>`;

  // Malos
  html+=`<div>
    <div style="font-size:15px;color:#ef4444;margin-bottom:6px;font-weight:500">Malos (${badOnTrack.length})</div>`;
  if(badOnTrack.length===0)html+=`<div style="font-size:15px;color:#333">—</div>`;
  badOnTrack.slice(0,8).forEach(e=>{
    const minStr=e._minLeft!==null?e._minLeft+'m'+(e._debtLimited?'⚠':''):'';
    html+=kartRow(e, minStr, '#555');
  });
  html+=`</div>`;

  html+=`</div></div>`; // cierra grid 3 cols + card

  // ── Columna derecha: Cola + Movimientos ──
  html+=`<div style="display:flex;flex-direction:column;gap:10px">`;

  // Cola del box
  html+=`<div class="en-strat-card" style="margin:0">
    <div class="en-strat-title">Cola del box (${EnBox.queue.length} karts)</div>`;
  if(EnBox.queue.length===0){
    html+=`<div style="color:#333;font-size:15px;font-family:sans-serif;padding:8px 0">Cola vacía</div>`;
  } else {
    const myD=(cfg?.myDorsal||'').toString().trim();
    const myQueueIdx=myD?EnBox.queue.findIndex(k=>k.dorsal?.toString()===myD):-1;
    html+=`<div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap;margin-bottom:6px">
      <span style="font-size:15px;color:#bdc2cc;margin-right:2px">ENTRA</span>`;
    [...EnBox.queue].reverse().forEach((k,i)=>{
      let bg='#fbbf24';
      if(k.quality==='good')bg='#22c55e';
      else if(k.quality==='bad')bg='#ef4444';
      else if(k.quality==='unknown')bg='#333';
      const isFirst=i===EnBox.queue.length-1; // primero en salir
      const isMe=myD&&k.dorsal?.toString()===myD;
      const border=isMe?'3px solid #fff':isFirst?'2px solid #aaa':'1px solid transparent';
      const rivalTextColor=k.quality==='good'?'#bbf7d0':k.quality==='bad'?'#fecaca':k.quality==='neutral'?'#fef08a':'#888';
      const label=isMe?(k.dorsal||'YO'):(k.dorsal&&k.dorsal!=='?'?k.dorsal:(k.quality==='unknown'?'?':''));
      const title=isMe?`TU KART (#${k.dorsal})`:(k.quality==='unknown'?'Sin info':(k.name||'#'+k.dorsal));
      const textColor=isMe?'#fff':rivalTextColor;
      html+=`<div style="width:${isMe?'30px':'28px'};height:${isMe?'22px':'20px'};border-radius:3px;background:${bg};display:inline-flex;align-items:center;justify-content:center;margin:1px;border:${border};font-size:11px;color:${textColor};font-weight:700" title="${title}">${label}</div>`;
    });
    html+=`<span style="font-size:15px;color:#bdc2cc;margin-left:2px">SALE</span></div>`;
    const qGood=EnBox.queue.filter(k=>k.quality==='good').length;
    const qBad=EnBox.queue.filter(k=>k.quality==='bad').length;
    const qNeutral=EnBox.queue.filter(k=>k.quality==='neutral').length;
    const qUnknown=EnBox.queue.filter(k=>k.quality==='unknown').length;
    html+=`<div style="font-size:15px;color:#bdc2cc;font-family:sans-serif">${qGood} buenos · ${qNeutral} neutros · ${qBad} malos · ${qUnknown} sin info</div>`;
    html+=`<div style="font-size:15px;color:#bdc2cc;margin-top:2px">Primero: <b style="color:${EnBox.queue[0]?.quality==='good'?'#22c55e':EnBox.queue[0]?.quality==='bad'?'#ef4444':EnBox.queue[0]?.quality==='neutral'?'#fbbf24':'#555'}">${({good:'bueno',bad:'malo',neutral:'neutro',unknown:'desconocido'})[EnBox.queue[0]?.quality]||'?'}</b></div>`;
    if(myQueueIdx>=0){
      const ahead=myQueueIdx;
      html+=`<div style="font-size:15px;color:#5b8dee;margin-top:3px;font-weight:600">${ahead===0?'⬆ Tu kart es el próximo en salir':`⬆ ${ahead} kart${ahead>1?'s':''} delante del tuyo`}</div>`;
    }

    // ── Diagrama visual del box ──
    const qLen=EnBox.queue.length;
    const qColor=(k)=>k.quality==='good'?'#22c55e':k.quality==='bad'?'#ef4444':k.quality==='neutral'?'#fbbf24':'#333';
    const qLabel=(k)=>k.quality==='unknown'?'?':'';
    const qBorder=(k,accessible)=>accessible?'1.5px solid #fff':'1.5px dashed #2a2b2e';
    const qTitle=(k)=>k.quality==='unknown'?'Sin info':(k.name||'#'+k.dorsal)+' ('+({good:'bueno',bad:'malo',neutral:'neutro'}[k.quality]||'?')+')';

    if(qLen>0){
      html+=`<div style="margin-top:10px;padding-top:8px;border-top:0.5px solid #1a1b22">`;
      html+=`<div style="font-size:15px;color:#bdc2cc;margin-bottom:6px;letter-spacing:0.5px">DIAGRAMA DEL BOX (${qLen} karts)</div>`;

      if(boxType==='battery'){
        // Batería: los primeros N en puestos (accesibles por sorteo), el resto en espera
        const inSlots=EnBox.queue.slice(0,boxPos);
        const waiting=EnBox.queue.slice(boxPos);
        html+=`<div style="display:flex;gap:6px;justify-content:center;padding:8px 0;flex-wrap:wrap">`;
        inSlots.forEach(k=>{
          html+=`<div style="width:36px;height:28px;border-radius:5px;background:${qColor(k)};border:${qBorder(k,true)};display:flex;align-items:center;justify-content:center;font-size:15px;color:#fff;font-weight:600;box-shadow:0 0 6px ${qColor(k)}44" title="${qTitle(k)}">${qLabel(k)}</div>`;
        });
        html+=`</div>`;
        if(waiting.length){
          html+=`<div style="text-align:center;font-size:8px;color:#bdc2cc;margin-bottom:4px">— en espera (${waiting.length}) —</div>`;
          html+=`<div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap;padding-bottom:6px">`;
          waiting.forEach(k=>{
            html+=`<div style="width:28px;height:22px;border-radius:4px;background:${qColor(k)};border:${qBorder(k,false)};display:flex;align-items:center;justify-content:center;font-size:15px;color:#fff;font-weight:600;opacity:0.55" title="${qTitle(k)} (en espera)">${qLabel(k)}</div>`;
          });
          html+=`</div>`;
        }
        html+=`<div style="text-align:center;font-size:15px;color:#bdc2cc">Puestos: sorteo aleatorio · Espera: entran a puestos al vaciarse</div>`;

      } else if(boxType==='line'){
        // Línea: cola horizontal completa con wrap, solo el primero accesible
        html+=`<div style="display:flex;align-items:center;gap:4px;justify-content:flex-start;padding:8px 0;flex-wrap:wrap">`;
        EnBox.queue.forEach((k,i)=>{
          const isFirst=i===0;
          html+=`<div style="width:32px;height:26px;border-radius:5px;background:${qColor(k)};border:${qBorder(k,isFirst)};display:flex;align-items:center;justify-content:center;font-size:15px;color:#fff;font-weight:600;${isFirst?'box-shadow:0 0 6px '+qColor(k)+'66;':'opacity:0.8;'}" title="#${i+1} · ${qTitle(k)}">${qLabel(k)}</div>`;
          if(i<qLen-1)html+=`<span style="color:#2a2b2e;font-size:15px">→</span>`;
        });
        html+=`</div>`;
        html+=`<div style="text-align:center;font-size:15px;color:#bdc2cc">Solo el primero accesible · ${qLen} karts en cola</div>`;

      } else if(boxType==='columns'){
        // Columnas: TODAS las filas según la cola real
        const nCols=EnBox.config.columns||2;
        const nRows=Math.ceil(qLen/nCols);
        html+=`<div style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 0;max-height:160px;overflow-y:auto">`;
        for(let r=0;r<nRows;r++){
          html+=`<div style="display:flex;gap:6px;align-items:center">`;
          html+=`<span style="font-size:8px;color:${r===0?'#555':'#333'};width:32px;text-align:right">fila ${r+1} →</span>`;
          for(let c=0;c<nCols;c++){
            const idx=r*nCols+c;
            if(idx<qLen){
              const k=EnBox.queue[idx];
              const accessible=r===0;
              html+=`<div style="width:34px;height:26px;border-radius:5px;background:${qColor(k)};border:${qBorder(k,accessible)};display:flex;align-items:center;justify-content:center;font-size:15px;color:#fff;font-weight:600;${accessible?'box-shadow:0 0 6px '+qColor(k)+'44;':'opacity:0.55;'}" title="${qTitle(k)}${accessible?'':' (fila '+(r+1)+', bloqueado)'}">${qLabel(k)}</div>`;
            } else {
              html+=`<div style="width:34px;height:26px;border-radius:5px;background:transparent;border:1px dashed #1a1b22"></div>`;
            }
          }
          html+=`</div>`;
        }
        html+=`</div>`;
        const goodBlocked=EnBox.queue.slice(nCols).filter(k=>k.quality==='good').length;
        if(goodBlocked>0){
          html+=`<div style="text-align:center;font-size:15px;color:#fbbf24">${goodBlocked} kart${goodBlocked>1?'s':''} bueno${goodBlocked>1?'s':''} en fila 2+ — necesita${goodBlocked>1?'n':''} salidas para desbloquearse</div>`;
        } else {
          html+=`<div style="text-align:center;font-size:15px;color:#bdc2cc">Fila 1: sorteo aleatorio entre columnas · Fila 2+: bloqueada hasta que se vacíe fila 1 · ${nRows} fila${nRows>1?'s':''}</div>`;
        }
      }
      html+=`</div>`;
    }
  }
  html+=`</div>`;

  // Movimientos recientes
  html+=`<div class="en-strat-card" style="margin:0">
    <div class="en-strat-title">Movimientos recientes</div>`;
  const pitEvents=eq.filter(e=>e.pit||e.pitState==='out').slice(0,6);
  if(pitEvents.length===0){
    html+=`<div style="color:#333;font-size:15px;font-family:sans-serif;padding:8px 0">Sin movimientos</div>`;
  } else {
    pitEvents.forEach(e=>{
      const kc=_enKartColor(e.dorsal);
      const quality=_enEffectiveQuality(e.dorsal, e, trackAvg);
      let qBorder=quality==='good'?'#22c55e':quality==='bad'?'#ef4444':quality==='neutral'?'#fbbf24':kc.border;
      const stateLabel=e.pitState==='in'?'IN':e.pitState==='out'?'OUT':'PIT';
      const stateCol=e.pitState==='in'?'#ef4444':e.pitState==='out'?'#f97316':'#555';
      html+=`<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:0.5px solid #111">
        <div style="width:30px;height:22px;border-radius:5px;background:${kc.bg};color:${kc.text};border:1.5px solid ${qBorder};display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;flex-shrink:0">${e.dorsal}</div>
        <span style="font-size:15px;color:#bdc2cc;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.name}</span>
        <span style="font-size:15px;color:${stateCol};font-weight:600">${stateLabel}</span>
        <span style="font-size:15px;color:#bdc2cc;width:32px;text-align:right">${e.pitS?e.pitS+'s':''}</span>
      </div>`;
    });
  }
  html+=`</div>`;
  html+=`</div>`; // cierra columna derecha
  html+=`</div>`; // cierra row 2
  html+=`<div class="en-strat-card">
    <div class="en-strat-title">Previsión de box</div>`;

  // Calcular previsión: karts buenos que van a parar pronto
  const N=EnBox.queue.length||boxPos;
  const G=EnBox.queue.filter(k=>k.quality==='good').length;
  const probNow=N>0?Math.round((G/N)*100):0;

  // Equipos que van a parar en los próximos minutos (por stint timer)
  const predictions=[];
  const allOnTrack=eq.filter(e=>!e.pit);
  allOnTrack.forEach(e=>{
    const pitOutTime=EnSession.rivalPitOut[e.dorsal];
    if(!pitOutTime||stintMaxMs>=999*60*1000)return;
    const elapsed=Date.now()-pitOutTime;
    const remaining=Math.max(0,stintMaxMs-elapsed);
    const minLeft=Math.ceil(remaining/60000);
    if(minLeft<=10){
      const q=_enEffectiveQuality(e.dorsal, e, trackAvg)||'neutral';
      predictions.push({dorsal:e.dorsal, name:e.name, quality:q, minLeft, remaining});
    }
  });
  predictions.sort((a,b)=>a.remaining-b.remaining);

  if(predictions.length===0){
    html+=`<div style="color:#333;font-size:15px;font-family:sans-serif;padding:8px 0">Sin previsión de paradas próximas</div>`;
  } else {
    // Simular evolución del pool
    let simG=G;
    let simN=N;
    let simQueue=[...EnBox.queue]; // copia para avanzar la simulación sin mutar la real
    let timeline=[];
    timeline.push({min:'Ahora', prob:probNow, event:'Estado actual', color:'#9ca3af'});

    predictions.forEach(p=>{
      // Cuando este rival entra: toma 1 aleatorio, deja el suyo
      if(boxType==='battery'){
        // P(pool mejora) = P(no cogió bueno) × (trae bueno)
        if(p.quality==='good'){
          const pNotTakeGood=simN>0?(simN-simG)/simN:1;
          simG=simG+pNotTakeGood;
        } else if(p.quality==='bad'){
          const pTakeGood=simN>0?simG/simN:0;
          simG=simG-pTakeGood;
        }
        simQueue.push({quality:p.quality});
      } else {
        // Línea/columnas: el nuevo kart va al final, sale el primero de la cola simulada
        simQueue.push({quality:p.quality});
        const removed=simQueue.length>0?simQueue.shift():null;
        simG=simQueue.filter(k=>k.quality==='good').length;
        simN=simQueue.length;
      }

      const futureProb=simN>0?Math.round(Math.min(100,Math.max(0,(simG/simN)*100))):0;
      const delta=futureProb-probNow;
      const arrow=delta>0?'↑':delta<0?'↓':'→';
      const evColor=p.quality==='good'?'#22c55e':p.quality==='bad'?'#ef4444':'#fbbf24';
      timeline.push({
        min:`~${p.minLeft} min`,
        prob:futureProb,
        event:`${p.name} (${p.quality==='good'?'bueno':p.quality==='bad'?'malo':'neutro'})`,
        dorsal:p.dorsal,
        delta, arrow, evColor
      });
    });

    // Renderizar timeline
    timeline.forEach((t,i)=>{
      const isNow=i===0;
      const probCol=t.prob>=50?'#22c55e':t.prob>=25?'#fbbf24':'#ef4444';
      html+=`<div style="display:flex;align-items:center;gap:10px;padding:5px 0;${!isNow?'border-top:0.5px solid #111':''}">
        <span style="font-size:15px;color:#bdc2cc;font-family:sans-serif;width:55px;flex-shrink:0">${t.min}</span>
        <span style="font-size:18px;font-weight:600;color:${probCol};font-family:monospace;width:50px">${t.prob}%</span>
        <div style="flex:1">
          <span style="font-size:15px;color:${t.evColor||'#555'};font-family:sans-serif">${t.event}</span>
        </div>
        ${t.delta!==undefined&&!isNow?`<span style="font-size:15px;color:${t.delta>0?'#22c55e':'#ef4444'};font-family:monospace;font-weight:600">${t.arrow}${Math.abs(t.delta)}%</span>`:''}
      </div>`;
    });

    // Recomendación
    const bestMoment=timeline.reduce((best,t)=>t.prob>best.prob?t:best,timeline[0]);
    if(bestMoment!==timeline[0]&&bestMoment.prob>probNow+5){
      html+=`<div style="margin-top:8px;padding:8px 12px;border-radius:6px;background:#22c55e11;border:0.5px solid #22c55e33">
        <span style="font-size:15px;color:#22c55e;font-family:sans-serif">💡 Espera ${bestMoment.min} → probabilidad sube a <b>${bestMoment.prob}%</b></span>
      </div>`;
    } else if(probNow>0){
      const worstFuture=timeline.reduce((w,t)=>t.prob<w.prob?t:w,timeline[0]);
      if(worstFuture.prob<probNow-5){
        html+=`<div style="margin-top:8px;padding:8px 12px;border-radius:6px;background:#ef444411;border:0.5px solid #ef444433">
          <span style="font-size:15px;color:#ef4444;font-family:sans-serif">⚠ Pool empeora en ${worstFuture.min} — considerar parar antes</span>
        </div>`;
      }
    }
  }
  html+=`</div>`;

  // ── Calcular mejor momento futuro para recomendación ──
  let bestFutureProb=probNow;
  let bestFutureMin='';
  let worstFutureProb=probNow;
  let worstFutureMin='';
  if(predictions.length>0){
    let simG2=G;
    predictions.forEach(p=>{
      if(boxType==='battery'){
        if(p.quality==='good'){simG2=simG2+(N-simG2)/N;}
        else if(p.quality==='bad'){simG2=simG2-simG2/N;}
      }
      const fp=N>0?Math.round(Math.min(100,Math.max(0,(simG2/N)*100))):0;
      if(fp>bestFutureProb){bestFutureProb=fp; bestFutureMin=`~${p.minLeft} min`;}
      if(fp<worstFutureProb){worstFutureProb=fp; worstFutureMin=`~${p.minLeft} min`;}
    });
  }

  // ── Recomendación táctica ─────────────────────────────────
  {
    const stopsDone=EnSession.stintHistory.length;
    const stopsRemaining=EnBox.totalStops>0?Math.max(0,EnBox.totalStops-stopsDone):0;
    const cfg2=window.AppState?.config;
    const stintMaxMin2=(cfg2?.stintMax||999);
    const stintMaxMs2=stintMaxMin2*60*1000;
    let raceRemMs=0;
    if(window.ApexClock&&window.ApexClock._synced&&!window.ApexClock.isCountUp())raceRemMs=Math.max(0,window.ApexClock.remainingMs());
    const raceRemMin=Math.round(raceRemMs/60000);
    const minNec=stintMaxMin2<999?Math.ceil(raceRemMin/stintMaxMin2):stopsRemaining;
    const strategic=EnBox.totalStops>0?Math.max(0,stopsRemaining-minNec):0;

    // Calidad kart actual de mi equipo
    const myDorsal=cfg2?.myDorsal;
    const myKart=eq.find(e=>e.dorsal===myDorsal);
    const myQuality=myKart?_enEffectiveQuality(myDorsal, myKart, trackAvg):null;

    // Progreso del stint actual
    const stintElapsedMs=EnSession.stintFrozen?EnSession.stintFrozen:(EnSession.stintStart?(Date.now()-EnSession.stintStart):0);
    const stintPct=stintMaxMs2>0&&stintMaxMs2<999*60*1000?Math.round(stintElapsedMs/stintMaxMs2*100):0;

    // Semáforo de stint
    const stintMinMs2=(cfg2?.stintMin||0)*60*1000;
    const canPit=stintMinMs2<=0||stintElapsedMs>=stintMinMs2; // verde o sin mínimo
    const stintMinLeft=canPit?0:Math.ceil((stintMinMs2-stintElapsedMs)/60000);

    let tacticHtml='';
    let tacticIcon='';
    let tacticColor='';

    // Si no puede parar (semáforo rojo), override cualquier sugerencia de parada
    if(!canPit){
      if(myQuality==='bad'){
        tacticIcon='🔴'; tacticColor='#ef4444';
        tacticHtml=`Kart malo pero stint mínimo no cumplido — <b>faltan ${stintMinLeft} min para poder parar</b>`;
      } else if(myQuality==='good'){
        tacticIcon='🏎'; tacticColor='#22c55e';
        tacticHtml=`Kart bueno · Stint mínimo en ${stintMinLeft} min → <b>Aprovecha el kart</b>`;
      } else {
        tacticIcon='🔴'; tacticColor='#fbbf24';
        tacticHtml=`Stint mínimo no cumplido — <b>faltan ${stintMinLeft} min</b>`;
      }
    } else if(myQuality==='good'&&strategic>0&&(stintPct>=30||raceRemMin<stintMaxMin2*1.5)&&probAcceso>=70){
      tacticIcon='💎'; tacticColor='#c084fc';
      tacticHtml=`Kart bueno (${stintPct}% stint) + pool excelente (${probAcceso}%) + parada extra → <b>Considerar parada anticipada para asegurar stint y medio con kart top</b>`;
    } else if(myQuality==='good'&&strategic>0&&(stintPct>=30||raceRemMin<stintMaxMin2*1.5)&&probAcceso>=40){
      tacticIcon='🤔'; tacticColor='#60a5fa';
      tacticHtml=`Kart bueno (${stintPct}% stint) + pool favorable (${probAcceso}%) → <b>Valorar parada anticipada</b>`;
    } else if(myQuality==='bad'&&(strategic>0||EnBox.totalStops===0)&&probAcceso>=25){
      tacticIcon='🎯'; tacticColor='#22c55e';
      tacticHtml=`Kart malo + pool ${probAcceso}% → <b>Oportunidad de caza</b>`;
    } else if(myQuality==='bad'&&(strategic>0||EnBox.totalStops===0)&&probAcceso<25&&bestFutureProb>=25){
      tacticIcon='⏳'; tacticColor='#fbbf24';
      tacticHtml=`Kart malo + pool bajo (${probAcceso}%) pero sube a ${bestFutureProb}% en ${bestFutureMin} → <b>Espera ${bestFutureMin}</b>`;
    } else if(myQuality==='bad'&&(strategic>0||EnBox.totalStops===0)&&probAcceso<25){
      tacticIcon='⏳'; tacticColor='#fbbf24';
      tacticHtml=`Kart malo + pool bajo (${probAcceso}%) → <b>Espera mejor momento</b>`;
    } else if(myQuality==='bad'&&strategic===0&&EnBox.totalStops>0){
      tacticIcon='😤'; tacticColor='#ef4444';
      tacticHtml=`Kart malo + sin paradas extra → <b>Apura stint, no puedes cazar</b>`;
    } else if(myQuality==='good'&&worstFutureProb<probAcceso-10){
      tacticIcon='🏎'; tacticColor='#22c55e';
      tacticHtml=`Kart bueno → <b>Apura stint máximo</b> (pool empeora en ${worstFutureMin})`;
    } else if(myQuality==='good'){
      tacticIcon='🏎'; tacticColor='#22c55e';
      tacticHtml=`Kart bueno → <b>Apura stint máximo, exprímelo</b>`;
    } else if(myQuality==='neutral'&&probAcceso>=40){
      tacticIcon='🤔'; tacticColor='#60a5fa';
      tacticHtml=`Kart neutro + pool favorable (${probAcceso}%) → <b>Valorar parada táctica</b>`;
    } else if(myQuality==='neutral'&&probAcceso<25&&bestFutureProb>=40){
      tacticIcon='⏳'; tacticColor='#60a5fa';
      tacticHtml=`Kart neutro + pool sube a ${bestFutureProb}% en ${bestFutureMin} → <b>Espera y valora</b>`;
    } else if(myQuality==='bad'){
      tacticIcon='📊'; tacticColor='#ef4444';
      tacticHtml=`Kart malo · Pool ${probAcceso}%`;
    } else if(myQuality==='neutral'){
      tacticIcon='📊'; tacticColor='#fbbf24';
      tacticHtml=`Kart neutro · Pool ${probAcceso}%`;
    } else {
      tacticIcon='📊'; tacticColor='#9ca3af';
      tacticHtml=`Pool ${probAcceso}% · Kart ${myQuality||'sin info'}`;
    }

    html+=`<div class="en-strat-card">
      <div class="en-strat-title">Recomendación táctica</div>
      <div style="padding:8px 12px;border-radius:6px;background:${tacticColor}11;border:0.5px solid ${tacticColor}33">
        <span style="font-size:15px;color:${tacticColor};font-family:sans-serif">${tacticIcon} ${tacticHtml}</span>
      </div>
      <div style="font-size:15px;color:#bdc2cc;margin-top:6px;font-family:sans-serif">${EnBox.totalStops>0?'Paradas: '+stopsDone+'/'+EnBox.totalStops+' · Estratégicas: '+strategic+' · ':''} Pool: ${probAcceso}% · Mi kart: ${myQuality||'sin info'}</div>
    </div>`;
  }

  // ── Botón clasificación estimada ──
  html+=`<div style="text-align:center;margin:10px 0">
    <button onclick="_enShowEstimatedClassification()" style="padding:10px 24px;border-radius:8px;border:0.5px solid #5b8dee;background:#5b8dee18;color:#5b8dee;font-size:15px;font-weight:500;cursor:pointer;font-family:sans-serif;transition:all .15s">📊 Clasificación estimada</button>
  </div>`;


  return html;
}

function _enSetBoxType(v){
  EnBox.config.type=v;
  // Re-render config para mostrar/ocultar campo columnas
  const cfgDiv=document.getElementById('en-strat-config');
  if(cfgDiv)cfgDiv.innerHTML=_enRenderStratConfig();
}
function _enSetBoxPositions(v){
  const newN=parseInt(v)||4;
  EnBox.config.positions=newN;
  // La cola es dinámica (crece con entradas, decrece con salidas).
  // Las posiciones solo definen los karts de reserva iniciales y la zona accesible.
  if(newN>EnBox.queue.length){
    // Más reserva de la que tenemos → añadir desconocidos
    while(EnBox.queue.length<newN)EnBox.queue.push({quality:'unknown',dorsal:'?',time:Date.now()});
  } else if(newN<EnBox.queue.length){
    // Reducir: solo quitar DESCONOCIDOS del final — nunca karts reales observados
    while(EnBox.queue.length>newN){
      const last=EnBox.queue[EnBox.queue.length-1];
      if(last.quality==='unknown'&&last.dorsal==='?')EnBox.queue.pop();
      else break;
    }
  }
}
function _enSetBoxColumns(v){EnBox.config.columns=parseInt(v)||2;}

function _enShowEstimatedClassification(){
  const eq=EnSession.data.equipos||[];
  const trackAvg=_enTrackAvgLive(eq);
  if(!eq.length)return;

  // Calcular coste medio de parada del circuito
  // Validación: un coste medido < duración oficial es dato corrupto (imposible parar menos del mínimo)
  let allCosts=[];
  Object.values(EnSession.pitCosts).forEach(arr=>allCosts=allCosts.concat(arr));
  const validCosts=allCosts.filter(c=>c>=EnBox.pitDuration*0.8); // margen 20% por variaciones de medición
  // Fallback: sin datos medidos → duración oficial + ~10% (vuelta lenta de salida)
  const avgPitCost=validCosts.length>0
    ?validCosts.reduce((a,b)=>a+b,0)/validCosts.length
    :EnBox.pitDuration*1.1;
  const costSource=validCosts.length>0?`medido (${validCosts.length} paradas)`:'estimado por duración oficial';

  // Paradas por equipo — prioridad: standsCount oficial de Apex (fiable aunque conectes tarde),
  // fallback: nuestro conteo observado (EnSession.pitCounts)
  const getStops=(e)=>e.standsCount>0?e.standsCount:(EnSession.pitCounts[e.dorsal]||0);
  const maxStops=Math.max(...eq.map(getStops),1);
  // Fiabilidad del conteo: si Apex da standsCount lo usamos (oficial); si no, advertimos
  const usingOfficial=eq.some(e=>e.standsCount>0);

  // Calcular clasificación estimada
  // Usamos vueltas (tours) como base del gap — fiable siempre, no depende del string de gap de Apex
  const onTrack=eq.filter(e=>!e.pit);
  const leaderTours=Math.max(...onTrack.map(e=>e.tours||0), 0);

  const estimated=onTrack.map(e=>{
    const stops=getStops(e);
    const diff=maxStops-stops;
    // Coste individual si lo tenemos (validado), sino media del circuito
    const teamCosts=(EnSession.pitCosts[e.dorsal]||[]).filter(c=>c>=EnBox.pitDuration*0.8);
    const teamAvgCost=teamCosts.length?teamCosts.reduce((a,b)=>a+b,0)/teamCosts.length:avgPitCost;
    const penalty=diff*teamAvgCost;

    // Gap calculado desde vueltas completadas — robusto con doblados y gaps vacíos
    const avg5=_enAvg5(e.lapHistory);
    const lapTime=avg5||trackAvg||67;
    const lapsBehind=Math.max(0, leaderTours-(e.tours||0));
    const gapS=lapsBehind*lapTime;

    const estimatedGap=gapS+penalty;
    const quality=_enEffectiveQuality(e.dorsal, e, trackAvg);

    return {
      dorsal:e.dorsal, name:e.name, pos:e.pos, stops, tours:e.tours||0,
      gapS, penalty, estimatedGap, avg5, quality, diff, lapsBehind
    };
  }).sort((a,b)=>a.estimatedGap-b.estimatedGap);

  // Render popup
  let overlay=document.getElementById('en-pilot-overlay');
  if(overlay)overlay.remove();
  overlay=document.createElement('div');
  overlay.id='en-pilot-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:999;';

  let rows='';
  estimated.forEach((e,i)=>{
    const kc=_enKartColor(e.dorsal);
    let qBorder=e.quality==='good'?'#22c55e':e.quality==='bad'?'#ef4444':e.quality==='neutral'?'#fbbf24':kc.border;
    const penaltyStr=e.diff>0?`<span style="color:#ef4444">+${e.diff} pit (${e.penalty.toFixed(1)}s)</span>`:'';
    const estGapStr=i===0?'—':'+'+e.estimatedGap.toFixed(1)+'s';
    const realGapStr=e.lapsBehind>0?`-${e.lapsBehind}v`:e.gapS>0?'+'+e.gapS.toFixed(1)+'s':'—';
    const posChange=e.pos-(i+1);
    const posStr=posChange>0?`<span style="color:#22c55e">↑${posChange}</span>`:posChange<0?`<span style="color:#ef4444">↓${Math.abs(posChange)}</span>`:'<span style="color:#bdc2cc">=</span>';

    rows+=`<div style="display:grid;grid-template-columns:28px 34px 1fr 44px 60px 60px 80px 36px;align-items:center;padding:5px 0;border-bottom:0.5px solid #1a1b22;gap:8px">
      <span style="font-size:15px;font-weight:600;color:#e4e6ed;text-align:center">${i+1}</span>
      <div style="width:30px;height:22px;border-radius:5px;background:${kc.bg};color:${kc.text};border:1.5px solid ${qBorder};display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700">${e.dorsal}</div>
      <span style="font-size:15px;color:#e4e6ed;font-family:sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.name}</span>
      <span style="font-size:15px;color:${e.stops===maxStops?'#22c55e':'#9ca3af'};font-family:monospace;text-align:center">${e.stops}${e.stops===maxStops?' ★':''}</span>
      <span style="font-size:15px;color:${e.lapsBehind>0?'#ef4444':'#9ca3af'};font-family:monospace;text-align:right">${realGapStr}</span>
      <span style="font-size:15px;color:#5b8dee;font-family:monospace;text-align:right;font-weight:600">${estGapStr}</span>
      <span style="font-size:15px;font-family:sans-serif;text-align:right">${penaltyStr}</span>
      <span style="font-size:15px;text-align:center">${posStr}</span>
    </div>`;
  });

  overlay.innerHTML=`
    <div style="background:#13141a;border:0.5px solid #2a2b2e;border-radius:12px;padding:24px;max-width:700px;width:95%;max-height:80vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div>
          <div style="font-size:18px;font-weight:600;color:#e4e6ed;font-family:sans-serif">📊 Clasificación estimada</div>
          <div style="font-size:15px;color:#bdc2cc;font-family:sans-serif;margin-top:2px">Normalizada a ${maxStops} paradas (ref: equipo con más paradas) · Coste pit: ${avgPitCost.toFixed(1)}s (${costSource})</div>
          ${!usingOfficial?'<div style="font-size:15px;color:#fbbf24;font-family:sans-serif;margin-top:2px">⚠ Conteo de paradas observado localmente — puede estar incompleto si conectaste a mitad de carrera</div>':''}
        </div>
        <button onclick="_enDismissOverlay()" style="background:none;border:none;color:#bdc2cc;font-size:18px;cursor:pointer;padding:4px">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:28px 34px 1fr 44px 60px 60px 80px 36px;padding:4px 0;border-bottom:0.5px solid #2a2b2e;gap:8px;margin-bottom:4px">
        <span style="font-size:15px;color:#bdc2cc;text-align:center">EST</span>
        <span style="font-size:15px;color:#bdc2cc">KART</span>
        <span style="font-size:15px;color:#bdc2cc">EQUIPO</span>
        <span style="font-size:15px;color:#bdc2cc;text-align:center">PITS</span>
        <span style="font-size:15px;color:#bdc2cc;text-align:right">GAP</span>
        <span style="font-size:15px;color:#5b8dee;text-align:right">EST</span>
        <span style="font-size:15px;color:#bdc2cc;text-align:right">PENALIZ.</span>
        <span style="font-size:15px;color:#bdc2cc;text-align:center">Δ</span>
      </div>
      ${rows}
    </div>`;
  document.body.appendChild(overlay);
}

function _enConfirmStint(){
  const minInput=document.getElementById('en-stint-min-input');
  const maxInput=document.getElementById('en-stint-max-input');
  if(minInput)_enUpdateCfg('stintMin', minInput.value);
  if(maxInput)_enUpdateCfg('stintMax', maxInput.value);
  minInput&&minInput.blur();
  maxInput&&maxInput.blur();
  _enRender();
  const btn=document.getElementById('en-stint-confirm-btn');
  if(btn){
    btn.textContent='✓ Aplicado';
    btn.style.color='#22c55e';
    btn.style.borderColor='#22c55e';
    btn.style.background='#22c55e18';
    setTimeout(()=>{
      const b=document.getElementById('en-stint-confirm-btn');
      if(b){b.textContent='Confirmar';b.style.color='#5b8dee';b.style.borderColor='#5b8dee';b.style.background='#5b8dee18';}
    },2000);
  }
}

function _enUpdateCfg(key, val){
  if(!window.AppState)window.AppState={};
  if(!window.AppState.config)window.AppState.config={};
  if(key==='stintMin'||key==='stintMax'){
    window.AppState.config[key]=parseInt(val)||0;
    EnBox.stratConfigured=true;
  } else {
    window.AppState.config[key]=val;
  }
}

// ── Simulación ─────────────────────────────────────────────────────────────
function _enInitSim(){
  const nombres=['EQUIPE 1','EQUIPE 2','EQUIPE 3','EQUIPE 4','EQUIPE 5',
                 'EQUIPE 6','EQUIPE 7','EQUIPE 8','EQUIPE 9','EQUIPE 10'];
  const dorsales=['7','9','15','11','12','14','10','13','6','8'];
  const bases=[67.2,67.8,68.1,68.5,69.0,69.3,69.8,70.2,71.0,72.5];
  const now=Date.now();
  EnSession.stintStart=now;
  EnSession.data.equipos=nombres.map((name,i)=>({
    dorsal:dorsales[i], name, pos:i+1,
    lastLap:null, bestLap:bases[i],
    lapHistory:[bases[i],bases[i]+0.2,bases[i]-0.1,bases[i]+0.3,bases[i]-0.2],
    gapMs:i===0?0:Math.round((bases[i]-bases[0])*1000*(i+1)),
    gap:'', interval:'',
    pit:false, pitS:0, pitState:null, state:'sr',
    tours:Math.floor(20-i*0.5),
    standsCount:1, stops:1, checkered:false,
    lapFlash:false, posChange:null,
    _lapStart:now-Math.random()*bases[i]*1000,
  }));
  EnSession.data.leaderLap=20;
  if(window.ApexClock)window.ApexClock.sync(90*60*1000);
  if(_enSimTimer)clearInterval(_enSimTimer);
  _enSimTimer=setInterval(()=>{
    const now=Date.now();
    EnSession.data.equipos.forEach(e=>{
      if(e.pit){
        e.pitS=(e.pitS||0)+1;
        if(e.pitS>15){e.pit=false;e.pitS=0;e.pitState=null;e.state='sr';e._lapStart=now;}
        return;
      }
      if(!e._lapStart)return;
      const elapsed=(now-e._lapStart)/1000;
      const lapTime=e.bestLap+(Math.random()-0.5)*1.5;
      if(elapsed>=lapTime){
        e.lastLap=parseFloat(lapTime.toFixed(3));
        if(!e.bestLap||e.lastLap<e.bestLap)e.bestLap=e.lastLap;
        e.lapHistory=e.lapHistory||[];
        e.lapHistory.push(e.lastLap);
        if(e.lapHistory.length>20)e.lapHistory.shift();
        e.tours=(e.tours||0)+1;
        e._lapStart=now;
        e.lapFlash=true;
        setTimeout(()=>{e.lapFlash=false;},2000);
        if(Math.random()<0.03&&e.standsCount<3){
          e.pit=true; e.state='si'; e.pitState='in'; e.pitS=0; e.standsCount++;
        }
      }
    });
    EnSession.data.equipos.sort((a,b)=>b.tours-a.tours||(a.bestLap-b.bestLap));
    EnSession.data.equipos.forEach((e,i)=>{
      if(e.pos!==i+1){
        e.posChange={from:e.pos,to:i+1,delta:e.pos-(i+1),time:Date.now()};
        setTimeout(()=>{e.posChange=null;},5000);
      }
      e.pos=i+1;
    });
    const leaderLaps=EnSession.data.equipos[0]?.tours||0;
    const leaderBest=EnSession.data.equipos[0]?.bestLap||70;
    EnSession.data.equipos.forEach((e,i)=>{
      e.gapMs=i===0?0:Math.round((e.bestLap-leaderBest)*1000*(e.pos));
    });
    EnSession.data.leaderLap=leaderLaps;
    if(_enTimer)clearTimeout(_enTimer);
    _enTimer=setTimeout(_enRender,80);
  },1000);
}

// ── API pública ───────────────────────────────────────────────────────────
window.showEnduranceDashboard=function(cfg){
  _enInjectStyles();
  EnUi.pinned=null;
  EnSession.stintStart=null; // Stint empieza cuando arranca el countdown
  EnSession.stintFrozen=null;

  if(window.ApexClock&&!window.ApexClock.fmt){
    window.ApexClock.fmt=function(){return this.fmtMs(this.remainingMs());};
  }

  document.getElementById('screen-setup').classList.remove('active');
  const el=document.getElementById('screen-dash');
  el.classList.add('active');
  el.innerHTML=''; // Limpiar dashboard anterior

  // Renderizar dashboard completo inmediatamente (vacío pero navegable)
  _enRender();

  if(_enClockTimer)clearInterval(_enClockTimer);
  _enClockTimer=setInterval(()=>{
    const cv=document.getElementById('sp-clk');
    const lbl=document.getElementById('sp-clk-lbl');
    if(cv&&window.ApexClock){
      cv.textContent=window.ApexClock.fmtMs(window.ApexClock.remainingMs());
      if(lbl)lbl.textContent=window.ApexClock.isCountUp()?'tiempo transcurrido':'tiempo restante';
      // Iniciar stint cuando el reloj arranca por primera vez
      if(!EnSession.stintStart&&window.ApexClock._synced)EnSession.stintStart=Date.now();
      // Congelar stint cuando countdown llega a 0
      if(EnSession.stintStart&&!EnSession.stintFrozen&&!window.ApexClock.isCountUp()){
        const rem=window.ApexClock.remainingMs();
        if(rem!==null&&rem<=0)EnSession.stintFrozen=Date.now()-EnSession.stintStart;
      }
    }
    // Actualizar stint en KPIs cada segundo
    _enUpdateKpis(document.getElementById('screen-dash'),
      EnSession.data.equipos.find(e=>e.pos===1),
      _enTrackAvgLive(EnSession.data.equipos),
      EnSession.data.equipos.filter(e=>e.bestLap).map(e=>e.bestLap).sort((a,b)=>a-b)[0]||null,
      EnSession.data.equipos.filter(e=>e.pit).length,
      EnSession.data.equipos.find(e=>e.dorsal===cfg.myDorsal),
      cfg.myDorsal,
      EnSession.data.equipos
    );
    // Actualizar vista equipo cada segundo si está activa
    if(EnUi.tab==='team'){
      const tdyn=document.getElementById('en-team-dynamic');
      const myKart=EnSession.data.equipos.find(e=>e.dorsal===cfg.myDorsal);
      const trackAvg=_enTrackAvgLive(EnSession.data.equipos);
      if(tdyn)tdyn.innerHTML=_enRenderTeam(myKart, trackAvg);
    }
    if(EnUi.tab==='strat'){
      const dynDiv=document.getElementById('en-strat-dynamic');
      if(dynDiv)dynDiv.innerHTML=_enRenderStrategy(EnSession.data.equipos, _enTrackAvgLive(EnSession.data.equipos));
    }
  },1000);

  if(_enBarTimer)clearInterval(_enBarTimer);
  _enBarTimer=setInterval(_enUpdateBars,100);

  if(cfg.simMode){
    _enInitSim();
    setTimeout(_enRender,100);
  } else {
    ApexConnector.connect(
      cfg.slug,
      (data)=>{
        const now=Date.now();
        (data.equipos||[]).forEach(e=>{
          const prev=EnSession.data.equipos.find(p=>p.dorsal===e.dorsal);
          if(prev&&prev.lastLap!==e.lastLap)e._lapStart=now;
          else if(prev)e._lapStart=prev._lapStart;
          else e._lapStart=now;
          // En live updates el servidor envía solo las últimas 10 vueltas —
          // preservar el historial completo que ya teníamos y añadir nuevas.
          if(!data._isHistory&&prev&&(prev.lapHistory||[]).length>(e.lapHistory||[]).length){
            const prevH=prev.lapHistory;
            const newLaps=(e.lapHistory||[]).filter(t=>!prevH.some(h=>Math.abs(h-t)<0.05));
            e.lapHistory=newLaps.length>0?[...prevH,...newLaps]:prevH;
          }
        });
        EnSession.data.equipos=data.equipos||[];
        EnSession.data.leaderLap=data.leaderLap||0;

        // ── Countdown desde logger (no llega por protocolo Apex bruto) ─────────
        if(data.countdown!=null&&window.ApexClock){
          const mode=data.countdownMode||(data.countdown>0?'countdown':'count');
          if(data.countdown!==EnSession._lastCountdown){
            EnSession._lastCountdown=data.countdown;
            const age=data.countdownTs?Math.max(0,Date.now()-data.countdownTs):0;
            const adjusted=mode==='countdown'?Math.max(0,data.countdown-age):data.countdown+age;
            window.ApexClock.sync(adjusted,mode);
          }
        }

        // ── Reconstrucción de estado desde snapshot histórico del logger ──────
        // Cuando conectamos tarde, el logger envía _isHistory:true + pitEvents[]
        // que permiten reconstruir cola FIFO, pitCounts y rivalPitOut.
        if(data._isHistory && Array.isArray(data.pitEvents) && !EnBox.queueInited){
          try{
            const boxPos=EnBox.config.positions||4;
            // Inicializar cola con karts desconocidos (reserva inicial)
            EnBox.queue=Array.from({length:boxPos},()=>({quality:'unknown',dorsal:'?',time:now}));
            // Reproducir eventos de pit en orden cronológico
            data.pitEvents.forEach(ev=>{
              if(ev.event==='in'){
                if(!EnSession.pitCounts[ev.dorsal])EnSession.pitCounts[ev.dorsal]=0;
                EnSession.pitCounts[ev.dorsal]++;
                EnBox.queue.push({quality:'unknown',dorsal:ev.dorsal,time:ev.time});
                EnSession.rivalPitOut[ev.dorsal]=null;
              } else if(ev.event==='out'){
                if(EnBox.queue.length>0)EnBox.queue.shift();
                EnSession.rivalPitOut[ev.dorsal]=ev.time;
              }
            });
            // Cruzar cola con el grid actual para inferir calidad de karts que siguen en box
            // data.equipos tiene el estado real del momento de conexión con lapHistory y bestLap
            if(Array.isArray(data.equipos)&&data.equipos.length>0){
              const snapAvg=_enTrackAvgLive(data.equipos);
              EnBox.queue.forEach(k=>{
                if(k.quality!=='unknown'||!k.dorsal||k.dorsal==='?')return;
                const snap=data.equipos.find(e=>e.dorsal?.toString()===k.dorsal?.toString());
                if(snap){
                  const q=_enEffectiveQuality(snap.dorsal, snap, snapAvg);
                  if(q&&q!=='unknown')k.quality=q;
                  if(snap.name)k.name=snap.name;
                }
              });
            }
            EnBox.queueInited=true;
          }catch(e){}
        }

        // ── Tracking blindado: un error aquí NUNCA debe congelar el dashboard ──
        try{
        // Trackear pit out de todos los karts para estimar stint restante
        // + gestionar cola del box
        const trackAvgNow=_enTrackAvgLive(EnSession.data.equipos);
        if(!EnBox.queueInited){
          const boxPos=EnBox.config.positions||4;
          EnBox.queue=Array.from({length:boxPos},()=>({quality:'unknown',dorsal:'?',time:now}));
          EnBox.queueInited=true;
        }
        if(!EnSession.data._prevPitState)EnSession.data._prevPitState={};
        EnSession.data.equipos.forEach(e=>{
          const prev=EnSession.data._prevPitState[e.dorsal];
          // Pit IN: el equipo entrega su kart → la cola CRECE (sin límite, refleja la realidad)
          if(e.pitState==='in'&&prev!=='in'){
            if(!EnSession.pitCounts[e.dorsal])EnSession.pitCounts[e.dorsal]=0;
            EnSession.pitCounts[e.dorsal]++;
            const q=_enEffectiveQuality(e.dorsal, e, trackAvgNow)||'unknown';
            EnBox.queue.push({quality:q, dorsal:e.dorsal, name:e.name, time:now});
            // Guardar timestamp del último pase por meta antes del pit in
            if(EnSession.linePasses[e.dorsal])
              EnSession.pitInLastPass[e.dorsal]=EnSession.linePasses[e.dorsal];
          }
          // Pit OUT: el equipo se lleva el PRIMERO de la cola → la cola DECRECE
          if(e.pitState==='out'&&prev!=='out'){
            if(EnBox.queue.length>0)EnBox.queue.shift();
          }
          // Pit OUT: iniciar calibración de offset pit exit → meta
          if(e.pitState==='out'&&prev!=='out'){
            EnSession.pitOutPending[e.dorsal]=now;
          }
          // Pase por meta (lapFlash) → registrar timestamp + completar calibración + coste real de parada
          if(e.lapFlash&&!e.pit){
            EnSession.linePasses[e.dorsal]=now;
            if(EnSession.pitOutPending[e.dorsal]){
              const offset=(now-EnSession.pitOutPending[e.dorsal])/1000;
              if(offset>3&&offset<300)EnSession.pitOutCalibration.push(offset);
              if(EnSession.pitOutCalibration.length>20)EnSession.pitOutCalibration.shift();
              delete EnSession.pitOutPending[e.dorsal];
              // Coste real = tiempo desde último |*| antes del pit in hasta este |*| post pit out
              if(EnSession.pitInLastPass[e.dorsal]){
                const realCost=(now-EnSession.pitInLastPass[e.dorsal])/1000;
                if(realCost>=EnBox.pitDuration*0.8&&realCost<600){
                  if(!EnSession.pitCosts[e.dorsal])EnSession.pitCosts[e.dorsal]=[];
                  EnSession.pitCosts[e.dorsal].push(realCost);
                }
                delete EnSession.pitInLastPass[e.dorsal];
              }
            }
          }
          EnSession.data._prevPitState[e.dorsal]=e.pitState||null;

          // Stint timer tracking
          if(!e.pit&&!EnSession.rivalPitOut[e.dorsal])EnSession.rivalPitOut[e.dorsal]=now;
          if(e.pitState==='out'&&!EnSession.rivalPitOut[e.dorsal])EnSession.rivalPitOut[e.dorsal]=now;
          if(e.pitState==='in')EnSession.rivalPitOut[e.dorsal]=null;
        });

        // Detectar pit IN → guardar stint actual
        const myD=cfg.myDorsal;
        const myK=EnSession.data.equipos.find(e=>e.dorsal===myD);
        if(myK&&myK.pitState==='in'&&!EnSession.data._myWasIn){
          EnSession.data._myWasIn=true;

          // Guardar stint actual en historial
          const pilotos=cfg?.pilotos||[];
          const stintMs=EnSession.stintFrozen?EnSession.stintFrozen:(EnSession.stintStart?(Date.now()-EnSession.stintStart):0);
          const stintLaps=_enStintLaps(myK);
          const pilotName=pilotos[EnSession.currentPilot]?.name||`Piloto ${EnSession.currentPilot+1}`;
          if(stintMs>5000){
            EnSession.stintHistory.push({
              pilot:pilotName,
              pilotIdx:EnSession.currentPilot,
              durationMs:stintMs,
              laps:stintLaps,
              lapTimes:[...EnSession.stintLapTimes],
              avg:_enAvg5(myK.lapHistory),
              best:EnSession.stintBestLap,
              posIn:EnSession.posIn,
              posOut:myK.pos,
              endTime:new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}),
            });
          }
          // Congelar stint
          EnSession.stintFrozen=EnSession.stintStart?(Date.now()-EnSession.stintStart):0;
        }
        if(myK&&!myK.pit)EnSession.data._myWasIn=false;

        // Detectar pit OUT → resetear timer + popup piloto
        if(myK&&myK.pitState==='out'&&!EnSession.data._myWasOut){
          EnSession.data._myWasOut=true;
          EnSession.stintStart=Date.now();
          EnSession.stintFrozen=null;
          EnSession.data._stintStartTours=myK.tours;
          EnSession.posIn=myK.pos;
          EnSession.stintBestLap=null;
          EnSession.stintLapTimes=[];
          EnSession.data._lastMyLap=null;
          setTimeout(()=>_enShowPilotSelect(true),500);
        }
        if(myK&&myK.pitState!=='out')EnSession.data._myWasOut=false;

        // Trackear mejor vuelta del stint y posición
        if(myK&&myK.lastLap&&!myK.pit){
          if(myK.lastLap!==EnSession.data._lastMyLap){
            EnSession.stintLapTimes.push(myK.lastLap);
            EnSession.data._lastMyLap=myK.lastLap;
          }
          if(!EnSession.stintBestLap||myK.lastLap<EnSession.stintBestLap)EnSession.stintBestLap=myK.lastLap;
          if(!EnSession.posIn)EnSession.posIn=myK.pos;
        }
        }catch(err){console.error('[StintPro] Error en tracking (render continúa):',err);}

        if(_enTimer)clearTimeout(_enTimer);
        _enTimer=setTimeout(_enRender,80);
      },
      (status,msg)=>console.log('[Apex]',status,msg),
      (comment)=>console.log('[Apex]',comment),
      cfg.port||7913
    );
  }
};

window._enGoBack=function(){
  if(!window.AppState?.config?.simMode)ApexConnector.disconnect();
  if(window.ApexClock)window.ApexClock.reset();
  if(_enTimer)clearTimeout(_enTimer);
  if(_enClockTimer){clearInterval(_enClockTimer);_enClockTimer=null;}
  if(_enSimTimer){clearInterval(_enSimTimer);_enSimTimer=null;}
  if(_enBarTimer){clearInterval(_enBarTimer);_enBarTimer=null;}
  _enStopAdvRaf();
  EnSession.data={equipos:[],leaderLap:0,_stintStartTours:0,_myWasOut:false,_myWasIn:false};
  EnSession.lastTrackAvg=null;
  EnSession.stintStart=null;
  EnSession.stintFrozen=null;
  EnUi.tab='grid';
  EnSession.currentPilot=0;
  EnSession.stintHistory=[];
  EnSession.kartAutoState={};
  EnUi.kartQuality={};
  EnUi.pinned=null;
  EnSession.posIn=null;
  EnSession.stintBestLap=null;
  EnUi.excludedFromAvg={};
  EnBox.config={type:'line',positions:4,columns:2};
  EnSession.rivalPitOut={};
  EnBox.pilotMinTime=0;
  EnBox.totalStops=0;
  EnBox.queue=[];
  EnBox.queueInited=false;
  EnSession.pitCosts={};
  EnSession.pitCounts={};
  EnBox.stratConfigured=false;
  EnSession.stintLapTimes=[];
  EnUi.sortMode='pos';
  EnSession.linePasses={};
  EnSession.pitOutCalibration=[];
  EnSession.pitOutPending={};
  EnSession.pitInLastPass={};
  document.getElementById('screen-dash').classList.remove('active');
  document.getElementById('screen-setup').classList.add('active');
  if(typeof renderSetup==='function')renderSetup();
};
