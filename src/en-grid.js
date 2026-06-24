// ── en-grid.js — fragmento de endurance.js ──
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

  // Cargar ratings de pilotos (logger o caché localStorage)
  if(!Object.keys(_enPilotRatings).length){
    const cfg=window.AppState?.config;
    if(cfg?.slug) _enFetchPilotRatings(cfg.slug);
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
    ${window.ApexConnector === window.ReplayConnector ? `
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
      <span data-replay-time style="font-size:10px;color:#6b7280;font-family:monospace;flex-shrink:0;-webkit-app-region:no-drag">0:00 / 0:00</span>
      <span style="font-size:10px;color:#555;flex-shrink:0;-webkit-app-region:no-drag">vel:</span>
      ${[1,2,5,10].map(s=>`<span data-spd="${s}" onclick="window.ReplayConnector.setSpeed(${s})" style="-webkit-app-region:no-drag;font-size:10px;font-family:monospace;padding:2px 6px;border-radius:3px;cursor:pointer;border:0.5px solid #2a2b2e;color:#6b7280">${s}×</span>`).join('')}
    </div>
    ` : ''}
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
      <div class="sp-name" style="font-size:12px;color:#555">${(e.teamName&&e.teamName!==e.name)?e.teamName:'—'}</div>
      <div class="sp-vtas">${e.tours}</div>
      <div class="sp-t" style="color:${e.lastLap?d.lastCol:'#2d2f38'}">${_enFmt(e.lastLap)}</div>
      <div class="sp-t" style="color:${e.bestLap?d.bestCol:'#2d2f38'}">${_enFmt(e.bestLap)}</div>
      <div class="en-m5" style="color:${d.m5Col}">${d.avg5?_enFmt(d.avg5):'—'}<span style="color:${d.trend.color};font-size:10px;margin-left:2px">${d.trend.arrow}</span></div>
      <div class="en-delta" style="color:${d.deltaCol}">${d.deltaStr}</div>
      <div class="sp-gap">${d.gapHtml}</div>
      <div class="sp-gap">${e.interval||'—'}</div>
      <div class="sp-cons">${(()=>{const s=_enPilotRatings[e.name];return s!=null?`<span style="color:${_enScoreColor(s)};font-weight:600;font-size:12px">${s}</span>`:'<span style="color:#2d2f38">—</span>';})()}</div>
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
  const score = _enPilotRatings[name] ?? null;
  const scoreColor = _enScoreColor(score);
  const scoreLabel = score>=800?'Elite':score>=600?'Avanzado':score>=400?'Intermedio':score>=200?'Novato':score!=null?'Principiante':'Sin datos';

  overlay.innerHTML = `
    <div style="background:#0e0f11;border:1px solid #2a2d3a;border-radius:10px;width:min(500px,92vw);overflow:hidden">
      <div style="padding:14px 18px;border-bottom:1px solid #1e2130;display:flex;align-items:center;gap:10px">
        <span style="font-size:15px;font-weight:700;color:#e2e8f0;flex:1">${name}</span>
        ${score!=null?`<span style="font-size:20px;font-weight:700;color:${scoreColor};font-family:monospace">${score}</span><span style="font-size:11px;color:${scoreColor};opacity:.8">${scoreLabel}</span>`:''}
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
    <span style="text-align:left">Piloto</span>
    <span style="text-align:left">Equipo</span>
    <span>Vtas</span><span>Última</span><span>Mejor</span>
    <span style="cursor:pointer;color:${EnUi.sortMode==='m5v'?'#5b8dee':'#333'};text-decoration:underline dotted;text-underline-offset:3px" onclick="_enToggleSort()" title="Ordenar por media de 5 vueltas (ritmo real)">M5v${EnUi.sortMode==='m5v'?' ▼':''}</span>
    <span>Δ Pista</span>
    <span>Gap</span>
    <span>Int</span>
    <span>Score</span>
    <span>Pit</span>`;
}

