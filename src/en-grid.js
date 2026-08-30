// ── en-grid.js — fragmento de endurance.js ──

// Columnas visibles ahora mismo: selección del usuario ∩ lo que manda Apex.
// Se recalcula en cada render porque el colMap cambia al empezar sesión.
function _enActiveColumns(){
  return EnColumns.visibleColumns(EnSession.colMapSeen, EnColumns.loadSelection());
}

// El grid-template-columns deja de estar cableado en el CSS: se calcula desde
// los anchos del catálogo. Dos reglas, una por breakpoint, en un <style> propio.
function _enApplyColumnStyle(cols){
  let el=document.getElementById('en-col-style');
  if(!el){ el=document.createElement('style'); el.id='en-col-style'; document.head.appendChild(el); }
  const ancho=EnColumns.gridTemplate(cols,false);
  const estrecho=EnColumns.gridTemplate(cols,true);
  el.textContent=
    `.en-thead,.en-row{grid-template-columns:${ancho};}`+
    `@media (max-width:900px){.en-thead,.en-row{grid-template-columns:${estrecho};}}`;
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

// ── Throttle del render en vivo ─────────────────────────────────────────────
// Un debounce puro (setTimeout que se reinicia con CADA frame) se starva bajo
// inundación: si los frames llegan más rápido que la espera, el timer se reinicia
// sin parar y el dashboard se congela. Pasa en circuitos que mandan el pit como
// timer en streaming (sin si/so, p.ej. Campillos) durante un pit en masa, y también
// con ráfagas de reconexión o dyn|countdown. Solución agnóstica al feed: techo duro
// _EN_RENDER_MAXWAIT — la espera se encoge conforme nos acercamos al techo, así que
// SIEMPRE se dispara aunque los frames no paren. Nunca más de ~1 render/techo.
const _EN_RENDER_DEBOUNCE = 80;    // espera tras el último frame cuando el feed va tranquilo
const _EN_RENDER_MAXWAIT  = 300;   // techo: pinta al menos cada 300ms aunque no pare de llegar
function _enScheduleRender(){
  const sinceLast = Date.now() - _enLastRenderAt;
  if(_enTimer) clearTimeout(_enTimer);
  // Conforme sinceLast se acerca al techo, wait→0, garantizando el disparo bajo inundación.
  const wait = sinceLast >= _EN_RENDER_MAXWAIT
    ? 0
    : Math.min(_EN_RENDER_DEBOUNCE, _EN_RENDER_MAXWAIT - sinceLast);
  _enTimer = setTimeout(()=>{
    _enTimer = null;
    _enLastRenderAt = Date.now();
    _enRender();
  }, wait);
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

  // Fase de sesión (clasificación/carrera) desde el p/r de Apex (init|p| / init|r|)
  const _phEl=el.querySelector('#sp-phase');
  if(_phEl){
    const m=EnSession.data.sessionMode;
    const lbl=m==='p'?'CLASIFICACIÓN':m==='r'?'CARRERA':'';
    if(_phEl.textContent!==lbl){_phEl.textContent=lbl;_phEl.style.display=lbl?'':'none';}
  }

  // Cargar historial de pilotos desde el logger (solo primera vez por sesión)
  if(_enPilotHistory===null && Logger?._serverUrl && eq.length){
    const cfg=window.AppState?.config;
    if(cfg?.slug) _enFetchPilotHistory(eq, cfg.slug);
  }

  // Cargar ratings de pilotos (logger o caché localStorage)
  if(!Object.keys(_enPilotRatings).length){
    const cfg=window.AppState?.config;
    if(cfg?.slug) _enFetchPilotRatings(cfg.slug);
  }

  // Alertas por evento del ingeniero de pista: se comprueban en cada tick,
  // independiente de la pestaña activa, para avisar aunque no se esté
  // mirando "Avanzado" (parpadeo de la pestaña, ver en-ai-alerts.js)
  try{ if(typeof _enCheckAlerts==='function')_enCheckAlerts(eq, trackAvg); }
  catch(err){console.error('[StintPro] Error alertas IA:',err);}

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
      // Ingeniero de pista IA: repinta el panel cada 5s (solo refresca el "hace X min";
      // el boletín en sí es 100% manual, botón "Boletín" — nunca se dispara solo)
      const advAi=advBody.querySelector('#en-adv-ai-engineer');
      if(advAi){
        const now=Date.now();
        if(!advAi._lastRender||now-advAi._lastRender>5000){
          advAi.innerHTML=_enRenderAiEngineerPanel();
          advAi._lastRender=now;
        }
      }
    }
  }catch(err){console.error('[StintPro] Error avanzado:',err);}
}

function _enRenderSkeleton(el, clk, isSimMode, leader, trackAvg, bestSess, inPit, myKart, myDorsal){
  const cfg=window.AppState?.config;
  el.innerHTML=`
  <div class="sp-header">
    ${window.ApexConnector === window.ReplayConnector && window._spUserRole === 'admin' ? `
    <div id="en-replay-bar" style="-webkit-app-region:no-drag;display:flex;align-items:center;gap:10px;padding:6px 14px;background:#0e0f11;border-bottom:0.5px solid #1a1b22;font-family:sans-serif">
      <span style="font-size:11px;color:#a78bfa;font-weight:600;flex-shrink:0;-webkit-app-region:no-drag">📼 REPLAY</span>
      <button data-replay-btn
        style="-webkit-app-region:no-drag;width:24px;height:24px;border-radius:4px;border:0.5px solid #a78bfa44;background:rgba(167,139,250,0.1);color:#a78bfa;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0"
        onclick="(function(){if(window.ReplayConnector._paused){window.ReplayConnector.resume();}else{window.ReplayConnector.pause();}})()">⏸</button>
      <div style="-webkit-app-region:no-drag;flex:1;height:12px;display:flex;align-items:center;cursor:pointer"
        onclick="(function(e){var r=e.currentTarget.getBoundingClientRect();var pct=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));window.ReplayConnector.seekTo(pct);})(event)">
        <div style="width:100%;height:4px;background:#1e1f25;border-radius:2px;overflow:hidden;pointer-events:none">
          <div data-replay-prog style="height:4px;background:#a78bfa;border-radius:2px;width:0%;transition:width 0.4s linear"></div>
        </div>
      </div>
      <span data-replay-time style="font-size:10px;color:var(--text-3);font-family:monospace;flex-shrink:0;-webkit-app-region:no-drag">0:00 / 0:00</span>
      <span style="font-size:10px;color:var(--text-3);flex-shrink:0;-webkit-app-region:no-drag">vel:</span>
      ${[1,2,5,10].map(s=>`<span data-spd="${s}" onclick="window.ReplayConnector.setSpeed(${s})" style="-webkit-app-region:no-drag;font-size:10px;font-family:monospace;padding:2px 6px;border-radius:3px;cursor:pointer;border:0.5px solid #2a2b2e;color:var(--text-3)">${s}×</span>`).join('')}
    </div>
    ` : ''}
    <div class="sp-topbar">
      <div style="display:flex;gap:5px">
      </div>
      <span class="sp-session">
        ${_esc(cfg?.name||'Endurance')}
        <span id="sp-phase" class="sp-phase-badge" style="display:none"></span>
        ${isSimMode?'<span class="sp-sim-badge">SIMULACIÓN</span>':''}
      </span>
      <div class="sp-clock">
        <div class="sp-clock-val" id="sp-clk">${clk}</div>
        <div class="sp-clock-lbl" id="sp-clk-lbl">tiempo restante</div>
      </div>
    </div>
    <div id="en-flag-banner" style="display:none;align-items:center;justify-content:center;gap:8px;padding:7px 12px;margin:0 0 6px;border-radius:5px;font-weight:700;font-size:13px;letter-spacing:.3px"></div>
    <div class="en-kpis" id="en-kpis">
      ${_enKpisHtml(leader, trackAvg, bestSess, inPit, myKart, myDorsal, EnSession.data.equipos)}
    </div>
  </div>
  <div class="en-tabs">
    <div class="en-tab ${EnUi.tab==='grid'?'active':''}" onclick="_enSetTab('grid')">📊 Clasificación</div>
    <div class="en-tab ${EnUi.tab==='team'?'active':''}" onclick="_enSetTab('team')">👥 Mi equipo</div>
    <div class="en-tab ${EnUi.tab==='strat'?'active':''}" onclick="_enSetTab('strat')">🎯 Estrategia</div>
    <div class="en-tab ${EnUi.tab==='adv'?'active':''}" id="en-tab-adv" onclick="_enSetTab('adv')">🔬 Avanzado</div>
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
    <div id="en-adv-ai-engineer"></div>
  </div>
  <div class="sp-footer">
    <div class="sp-fl"><div class="sp-fldot" style="background:#22c55e"></div>En pista</div>
    <div class="sp-fl"><div class="sp-fldot" style="background:#ef4444"></div>En boxes</div>
    <div class="sp-fl"><div class="sp-fldot" style="background:#f97316"></div>Saliendo pit</div>
    <div class="sp-fl" style="margin-left:8px">Click kart = 🟢 → 🟡 → 🔴 → auto · Click fila = fijar</div>
  </div>`;

  // Cabecera y cuerpo scrollean juntos en horizontal
  const _b=el.querySelector('#en-grid-body'), _h=el.querySelector('#en-thead');
  if(_b&&_h)_b.addEventListener('scroll',()=>{ _h.scrollLeft=_b.scrollLeft; });
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
    <div class="sp-kpi-val" style="color:#F5A623">P${myPos} <span style="font-size:12px;color:${myTrend.color}">${myTrend.arrow}</span></div>
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
    <div class="sp-kpi-sub">${bestKart?_esc(bestKart.name):''}</div>
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

  // Color de la última vuelta. Prioridad al token oficial de Apex (morada=mejor
  // absoluta de la sesión, verde=mejor personal — validado con datos: tb/ti);
  // si el circuito no manda token, se cae a la heurística de ritmo vs media pista.
  let lastCol='#9ca3af';
  if(e.lastLapKind==='purple')lastCol='#c084fc';
  else if(e.lastLapKind==='green')lastCol='#22c55e';
  else if(e.lastLap&&trackAvg){
    const d=e.lastLap-trackAvg;
    if(d<-0.5)lastCol='#c084fc';
    else if(d<0)lastCol='#22c55e';
    else if(d>1.0)lastCol='#ef4444';
    else if(d>0.3)lastCol='#fbbf24';
  }
  // Mejor vuelta morada si este kart tiene la mejor absoluta (token Apex bestOverall,
  // o el cálculo local como respaldo).
  const bestCol=(e.bestOverall||(e.bestLap&&bestSess&&Math.abs(e.bestLap-bestSess)<0.001))?'#c084fc':'#9ca3af';

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
function _enRenderRow(e, d, cols){
  return`
  <div class="sp-rowwrap">
    <div class="en-row ${d.flash}${d.pinned?' sp-pinned':''}${d.isMe?' en-myrow':''}" onclick="_enPin('${e.dorsal}')">
      ${EnColumns.rowCells(cols, e, d)}
      <div class="sp-lapbar ${d.barClass}" id="en-bar-${e.dorsal}" style="width:${d.barPct}%"></div>
    </div>
  </div>`;
}

// ── Orquestador: ordena, deriva y renderiza todas las filas ───────────────
function _enRenderRows(eq, trackAvg, bestSess, leader, myDorsal){
  if(!eq.length)return`<div class="sp-empty" style="color:#333;font-size:12px;padding:20px">Sin datos — esperando conexión</div>`;

  let html='';
  const cols=_enActiveColumns();
  _enApplyColumnStyle(cols);

  if(EnUi.sortMode==='m5v'){
    eq=[...eq].sort((a,b)=>{
      const a5=_enAvg5(a.lapHistory);
      const b5=_enAvg5(b.lapHistory);
      if(!a5&&!b5)return(a.pos||99)-(b.pos||99);
      if(!a5)return 1;
      if(!b5)return-1;
      return a5-b5;
    });
    html+=`<div onclick="_enToggleSort()" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:6px;background:#F5A62318;border-bottom:1px solid #F5A623;cursor:pointer" title="Click para volver a la clasificación real">
      <span style="font-size:11px;color:#F5A623;font-weight:600;letter-spacing:1px;font-family:sans-serif">⚡ ORDENADO POR RITMO (M5v) — NO ES LA CLASIFICACIÓN REAL</span>
    </div>`;
  }

  eq.forEach(e=>{
    try{
      html+=_enRenderRow(e, _enDeriveRow(e, trackAvg, bestSess, leader, myDorsal), cols);
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
  // Entrar en Avanzado apaga el parpadeo de alertas del ingeniero de pista
  if(tab==='adv'&&typeof _enClearAlertBlink==='function')_enClearAlertBlink();
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
            <div style="font-size:14px;font-weight:500;color:var(--text-1);margin-bottom:8px;font-family:sans-serif">Configura la estrategia</div>
            <div style="font-size:12px;color:var(--text-2);margin-bottom:18px;font-family:sans-serif;line-height:1.5">Recuerda configurar el <b style="color:#fbbf24">stint mínimo y máximo</b> en la parte superior para que las previsiones y recomendaciones funcionen correctamente.</div>
            <button onclick="EnBox.stratConfigured=true;_enDismissOverlay()" style="width:100%;padding:10px;border-radius:6px;border:0.5px solid #F5A623;background:#F5A62318;color:#F5A623;font-size:13px;cursor:pointer;font-family:sans-serif">Entendido</button>
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
  // Endurance individual (1 solo piloto): no hay nada que confirmar, el stint se registra igual
  if(auto&&pilotos.length===1)return;
  const colors=['#F5A623','#22c55e','#f97316','#c084fc','#f87171','#fbbf24'];

  // Crear overlay
  let overlay=document.getElementById('en-pilot-overlay');
  if(overlay)overlay.remove();
  overlay=document.createElement('div');
  overlay.id='en-pilot-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:999;';
  overlay.innerHTML=`
    <div style="background:#1a1b22;border:0.5px solid #2a2b2e;border-radius:12px;padding:24px;max-width:340px;width:90%;">
      <div style="font-size:14px;font-weight:500;color:var(--text-1);margin-bottom:4px;font-family:sans-serif">${auto?'🔄 Pit Out detectado':'🔄 Cambio de piloto'}</div>
      <div style="font-size:11px;color:var(--text-3);margin-bottom:18px;font-family:sans-serif">¿Quién está rodando ahora?</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${pilotos.map((p,i)=>`
          <button onclick="_enSelectPilot(${i})" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;border:0.5px solid ${i===EnSession.currentPilot?colors[i%colors.length]:'#2a2b2e'};background:${i===EnSession.currentPilot?colors[i%colors.length]+'15':'#13141a'};cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='${colors[i%colors.length]}'" onmouseout="this.style.borderColor='${i===EnSession.currentPilot?colors[i%colors.length]:'#2a2b2e'}'">
            <div style="width:28px;height:28px;border-radius:50%;background:${colors[i%colors.length]};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff">${_esc(p.name.charAt(0))}</div>
            <div style="flex:1;text-align:left">
              <div style="font-size:13px;color:var(--text-1);font-family:sans-serif">${_esc(p.name)}</div>
              <div style="font-size:10px;color:var(--text-3);font-family:sans-serif">${i===EnSession.currentPilot?'En pista actualmente':'Disponible'}</div>
            </div>
          </button>
        `).join('')}
      </div>
      <button onclick="_enDismissOverlay()" style="width:100%;margin-top:12px;padding:8px;border-radius:6px;border:0.5px solid #2a2b2e;background:transparent;color:var(--text-3);font-size:11px;cursor:pointer;font-family:sans-serif">Cancelar</button>
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
      <td style="padding:7px 12px;font-size:12px;color:var(--text-3)">${fmtDate(s.started_at)}</td>
      <td style="padding:7px 12px;font-size:12px;font-family:monospace;color:#22c55e;text-align:right">${fmtMs(s.best_ms)}</td>
      <td style="padding:7px 12px;font-size:12px;font-family:monospace;color:#F5A623;text-align:right">${fmtMs(s.avg_ms)}</td>
      <td style="padding:7px 12px;font-size:12px;color:var(--text-3);text-align:right">${s.laps}</td>
    </tr>`).join('');

  const overlay = document.createElement('div');
  overlay.id = 'en-pilot-history-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:998;';
  overlay.onclick = e => { if(e.target===overlay) overlay.remove(); };
  const _r = _enPilotRatings[name] ?? null;
  const score = _r?.score ?? _r;
  const scoreColor = _enScoreColor(score);
  const scoreLabel = score>=800?'Elite':score>=600?'Avanzado':score>=400?'Intermedio':score>=200?'Novato':score!=null?'Principiante':'Sin datos';

  overlay.innerHTML = `
    <div style="background:#0e0f11;border:1px solid #2a2d3a;border-radius:10px;width:min(500px,92vw);overflow:hidden">
      <div style="padding:14px 18px;border-bottom:1px solid #1e2130;display:flex;align-items:center;gap:10px">
        <span style="font-size:15px;font-weight:700;color:var(--text-1);flex:1">${_esc(name)}</span>
        ${score!=null?`<span style="font-size:20px;font-weight:700;color:${scoreColor};font-family:monospace">${score}</span><span style="font-size:11px;color:${scoreColor};opacity:.8">${scoreLabel}</span>`:''}
        <button onclick="document.getElementById('en-pilot-history-overlay').remove()" style="background:transparent;border:1px solid #2a2d3a;border-radius:6px;color:var(--text-3);padding:3px 8px;cursor:pointer;font-size:13px">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#1e2130;border-bottom:1px solid #1e2130">
        <div style="background:#0e0f11;padding:12px 16px">
          <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Mejor vuelta</div>
          <div style="font-size:20px;font-weight:700;color:#22c55e;font-family:monospace">${fmtMs(data.best_ms)}</div>
        </div>
        <div style="background:#0e0f11;padding:12px 16px">
          <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Ritmo medio</div>
          <div style="font-size:20px;font-weight:700;color:#F5A623;font-family:monospace">${fmtMs(data.avg_ms)}</div>
        </div>
        <div style="background:#0e0f11;padding:12px 16px">
          <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Sesiones · Vueltas</div>
          <div style="font-size:20px;font-weight:700;color:var(--text-1)">${data.session_count} · <span style="color:var(--text-3);font-size:16px">${data.total_laps}</span></div>
        </div>
      </div>
      <div style="padding:12px 0;max-height:220px;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#13141a">
            <th style="padding:6px 12px;font-size:10px;color:var(--text-3);text-transform:uppercase;text-align:left">Sesión</th>
            <th style="padding:6px 12px;font-size:10px;color:var(--text-3);text-transform:uppercase;text-align:right">Mejor</th>
            <th style="padding:6px 12px;font-size:10px;color:var(--text-3);text-transform:uppercase;text-align:right">Media</th>
            <th style="padding:6px 12px;font-size:10px;color:var(--text-3);text-transform:uppercase;text-align:right">Vlts</th>
          </tr></thead>
          <tbody>${sessRows || '<tr><td colspan="4" style="padding:12px;text-align:center;color:var(--text-3);font-size:12px">Sin sesiones anteriores</td></tr>'}</tbody>
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
  return EnColumns.theadHtml(_enActiveColumns(), EnUi.sortMode);
}

