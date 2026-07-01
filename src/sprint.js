// ── Sprint Dashboard v1.0 ─────────────────────────────────────────────────

let _spData    = { equipos:[], leaderLap:0 };
let _spPinned  = null;
let _spTimer   = null;
let _spClockTimer = null;
let _spSimTimer   = null;
let _spBarTimer   = null; // timer barra de progreso 100ms

// ── Estilos ───────────────────────────────────────────────────────────────
function _spInjectSetupBtn() {
  const nav = document.getElementById('sp-topnav');
  if (!nav || nav.querySelector('.sp-nav-setup')) return;
  const btn = document.createElement('button');
  btn.className = 'sp-nav-btn sp-nav-setup';
  btn.style.cssText = 'color:#F5A623;border-color:#F5A623;';
  btn.textContent = '← Setup';
  btn.onclick = () => window._spGoBack();
  nav.appendChild(btn);
}

function _spInjectStyles(){
  if(document.getElementById('sp-styles'))return;
  const s=document.createElement('style');
  s.id='sp-styles';
  s.textContent=`
    #screen-dash{background:#0e0f11;display:flex;flex-direction:column;height:100vh;overflow:hidden;}
    .sp-header{background:#13141a;border-bottom:0.5px solid #252630;padding:12px 18px;flex-shrink:0;-webkit-app-region:drag;}
    .sp-topbar{position:relative;display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-left:270px;padding-right:16px;}
    .sp-topbar>*{-webkit-app-region:no-drag;}
    .sp-wdot{width:11px;height:11px;border-radius:50%;}
    .sp-session{font-size:12.5px;color:var(--text-3);font-family:sans-serif;position:fixed;left:0;right:0;text-align:center;pointer-events:none;}
    .sp-clock{text-align:right;margin-left:auto;}
    .sp-clock-val{font-size:27.5px;font-weight:500;color:#fff;font-family:monospace;letter-spacing:-1px;line-height:1;}
    .sp-clock-lbl{font-size:11.5px;color:var(--text-3);margin-top:1px;}
    .sp-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;-webkit-app-region:no-drag;}
    .sp-kpi{background:#0e0f11;border-radius:8px;padding:10px 14px;border:0.5px solid #1e1f25;}
    .sp-kpi-lbl{font-size:11.5px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;font-family:sans-serif;}
    .sp-kpi-val{font-size:23.5px;font-weight:500;font-family:monospace;line-height:1.1;letter-spacing:-0.5px;}
    .sp-kpi-sub{font-size:11.5px;color:var(--text-3);margin-top:3px;font-family:sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .sp-thead{display:grid;grid-template-columns:20px 48px 44px 1fr 48px 88px 88px 72px 64px 76px 36px;padding:5px 14px;border-bottom:0.5px solid #1a1b20;flex-shrink:0;}
    .sp-thead span{font-size:11.5px;color:#333;text-transform:uppercase;letter-spacing:0.5px;text-align:right;}
    .sp-thead span:nth-child(4){text-align:left;}
    .sp-thead span:nth-child(1),.sp-thead span:nth-child(2){text-align:center;}
    .sp-body{overflow-y:auto;flex:1;}
    .sp-rowwrap{position:relative;}
    .sp-row{display:grid;grid-template-columns:20px 48px 44px 1fr 48px 88px 88px 72px 64px 76px 36px;padding:7px 14px;border-bottom:0.5px solid #111213;align-items:center;cursor:pointer;position:relative;}
    .sp-row:nth-child(odd){background:rgba(255,255,255,0.01);}
    .sp-row:hover{background:#15161d!important;}
    @keyframes spFlash{0%{background:rgba(251,146,60,0.2);}100%{background:transparent;}}
    .sp-flash{animation:spFlash 2s ease-out forwards;}
    .sp-pinned{border-left:2px solid #F5A623!important;background:#1a1500!important;}
    .sp-dot{width:8px;height:8px;border-radius:50%;margin:auto;}
    .sp-pos{font-size:14.5px;font-weight:500;color:#bbb;text-align:center;}
    .sp-kart{display:inline-flex;align-items:center;justify-content:center;width:30px;height:22px;border-radius:5px;font-size:13.5px;font-weight:700;margin:auto;}
    .sp-name{font-size:14.5px;color:var(--text-1);font-family:sans-serif;display:flex;align-items:center;gap:7px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
    .sp-pit-b{background:#ef4444;color:#fff;font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:4px;flex-shrink:0;}
    .sp-out-b{background:#f97316;color:#fff;font-size:10.5px;font-weight:700;padding:2px 6px;border-radius:4px;flex-shrink:0;}
    .sp-fix-b{font-size:10.5px;color:#F5A623;border:0.5px solid #F5A623;padding:1px 5px;border-radius:3px;flex-shrink:0;}
    .sp-vtas{font-size:13.5px;color:var(--text-3);text-align:right;font-family:monospace;}
    .sp-t{font-size:14.5px;text-align:right;font-family:monospace;font-variant-numeric:tabular-nums;}
    .sp-gap{font-size:13.5px;text-align:right;font-family:monospace;color:var(--text-3);}
    .sp-sec{font-size:12.5px;color:#333;text-align:right;font-family:monospace;}
    .sp-cons{font-size:11.5px;text-align:center;}
    .sp-pitc{font-size:12.5px;color:#333;text-align:right;font-family:monospace;}
    .sp-au{color:#22c55e;font-size:11.5px;font-weight:700;margin-left:2px;}
    .sp-ad{color:#ef4444;font-size:11.5px;font-weight:700;margin-left:2px;}
    .sp-footer{padding:7px 14px;display:flex;gap:16px;border-top:0.5px solid #181920;flex-shrink:0;}
    .sp-fl{font-size:11.5px;color:#2d2f38;display:flex;align-items:center;gap:4px;}
    .sp-fldot{width:7px;height:7px;border-radius:50%;}
    .sp-back{font-size:12.5px;padding:4px 12px;border-radius:6px;border:0.5px solid #2a2b2e;background:#1a1b22;color:var(--text-2);cursor:pointer;}
    .sp-back:hover{color:var(--text-2);border-color:var(--text-3);}
    .sp-empty{color:var(--text-3);padding:60px;text-align:center;font-family:sans-serif;}
    .sp-sim-badge{font-size:10.5px;padding:2px 7px;border-radius:20px;background:rgba(34,197,94,0.1);color:#22c55e;border:0.5px solid #22c55e;margin-left:6px;}
    /* Barra de progreso de vuelta */
    .sp-lapbar{position:absolute;bottom:0;left:0;height:2px;background:rgba(245,166,35,0.4);transition:width 0.1s linear;pointer-events:none;}
    .sp-lapbar.fast{background:rgba(34,197,94,0.5);}
    .sp-lapbar.slow{background:rgba(239,68,68,0.4);}
  `;
  document.head.appendChild(s);
}

// ── Formato tiempo ─────────────────────────────────────────────────────────
function _spFmt(s){
  if(!s&&s!==0)return'—';
  const m=Math.floor(s/60),sec=(s%60).toFixed(3).padStart(6,'0');
  return m>0?`${m}:${sec}`:sec;
}

function _spFmtGap(ms){
  if(!ms||ms<=0)return'—';
  const s=ms/1000;
  const m=Math.floor(s/60),sec=(s%60).toFixed(3).padStart(6,'0');
  return m>0?`+${m}:${sec}`:`+${s.toFixed(3)}`;
}

// ── Consistencia últimas 5 vueltas ─────────────────────────────────────────
function _spCons(hist){
  if(!hist||hist.length<2)return null;
  const l=hist.slice(-5),mn=Math.min(...l),mx=Math.max(...l),r=mx-mn;
  if(r<0.3)return{label:'Muy regular',color:'#22c55e'};
  if(r<0.5)return{label:'Regular',color:'#4ade80'};
  if(r<1.0)return{label:'Irregular',color:'#fbbf24'};
  return{label:'Errático',color:'#ef4444'};
}

// ── Color del kart por dorsal ──────────────────────────────────────────────
function _spKartColor(dorsal){
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

// ── Barra de progreso — actualiza sin re-render completo ───────────────────
function _spUpdateBars(){
  const now=Date.now();
  _spData.equipos.forEach(e=>{
    if(!e.lastLap||e.pit||!e._lapStart)return;
    const elapsed=(now-e._lapStart)/1000;
    const pct=Math.min(100,(elapsed/e.lastLap)*100);
    const bar=document.getElementById('sp-bar-'+e.dorsal);
    if(bar)bar.style.width=pct+'%';
  });
}

// ── Render principal ───────────────────────────────────────────────────────
function _spRender(){
  const el=document.getElementById('screen-dash');
  if(!el||!el.classList.contains('active'))return;

  const eq=_spData.equipos;
  const bests=eq.filter(e=>e.bestLap).map(e=>e.bestLap).sort((a,b)=>a-b);
  const trackAvg=bests.length?bests[Math.floor(bests.length/2)]:null;
  const bestSess=bests[0]||null;
  const inPit=eq.filter(e=>e.pit).length;
  const leader=eq.find(e=>e.pos===1);
  const clk=window.ApexClock?window.ApexClock.fmtMs(window.ApexClock.remainingMs()):'—';
  const isSimMode=window.AppState?.config?.simMode;

  // Si el esqueleto no existe aún, construirlo completo
  if(!el.querySelector('.sp-body')){
    _spRenderSkeleton(el, clk, isSimMode, leader, trackAvg, bestSess, inPit);
  } else {
    // Solo actualizar KPIs y reloj sin tocar el body
    const clkEl=el.querySelector('#sp-clk');
    if(clkEl)clkEl.textContent=clk;
    _spUpdateKpis(el, leader, trackAvg, bestSess, inPit);
  }

  // Actualizar solo el contenido del body — preserva scrollTop automáticamente
  const body=el.querySelector('.sp-body');
  if(!body)return;
  body.innerHTML=_spRenderRows(eq, trackAvg, bestSess, leader);
}

function _spRenderSkeleton(el, clk, isSimMode, leader, trackAvg, bestSess, inPit){
  const cfg=window.AppState?.config;
  el.innerHTML=`
  <div class="sp-header">
    <div class="sp-topbar">
      <div style="display:flex;gap:5px">
      </div>
      <span class="sp-session">
        ${cfg?.name||'Sprint'}
        ${isSimMode?'<span class="sp-sim-badge">SIMULACIÓN</span>':''}
      </span>
      <div class="sp-clock">
        <div class="sp-clock-val" id="sp-clk">${clk}</div>
        <div class="sp-clock-lbl" id="sp-clk-lbl">tiempo restante</div>
      </div>
    </div>
    <div class="sp-kpis" id="sp-kpis">
      ${_spKpisHtml(leader, trackAvg, bestSess, inPit)}
    </div>
  </div>
  <div class="sp-thead">
    <span></span><span>Pos</span><span>Kart</span>
    <span style="text-align:left">Equipo</span>
    <span>Vtas</span><span>Última</span><span>Mejor</span>
    <span>Gap</span>
    <span>Int</span>
    <span>Consist.</span><span>Pit</span>
  </div>
  <div class="sp-body"></div>
  <div class="sp-footer">
    <div class="sp-fl"><div class="sp-fldot" style="background:#22c55e"></div>En pista</div>
    <div class="sp-fl"><div class="sp-fldot" style="background:#ef4444"></div>En boxes</div>
    <div class="sp-fl"><div class="sp-fldot" style="background:#f97316"></div>Saliendo pit</div>
    <div class="sp-fl" style="margin-left:8px">Naranja = cruzando línea · Click = fijar fila</div>
  </div>`;
}

function _spKpisHtml(leader, trackAvg, bestSess, inPit){
  return `
  <div class="sp-kpi">
    <div class="sp-kpi-lbl">Vuelta líder</div>
    <div class="sp-kpi-val" style="color:#fff">${_spData.leaderLap||'—'}</div>
    <div class="sp-kpi-sub">${leader?`${leader.name} · kart ${leader.dorsal}`:''}</div>
  </div>
  <div class="sp-kpi">
    <div class="sp-kpi-lbl">Media pista</div>
    <div class="sp-kpi-val" style="color:#60a5fa">${trackAvg?_spFmt(trackAvg):'—'}</div>
    <div class="sp-kpi-sub">mediana de mejores</div>
  </div>
  <div class="sp-kpi">
    <div class="sp-kpi-lbl">Mejor sesión</div>
    <div class="sp-kpi-val" style="color:#c084fc">${bestSess?_spFmt(bestSess):'—'}</div>
    <div class="sp-kpi-sub">${bestSess&&leader?leader.name:''}</div>
  </div>
  <div class="sp-kpi">
    <div class="sp-kpi-lbl">En boxes</div>
    <div class="sp-kpi-val" style="color:${inPit>0?'#f87171':'#22c55e'}">${inPit}</div>
    <div class="sp-kpi-sub">karts actualmente</div>
  </div>`;
}

function _spUpdateKpis(el, leader, trackAvg, bestSess, inPit){
  const kpis=el.querySelector('#sp-kpis');
  if(kpis)kpis.innerHTML=_spKpisHtml(leader, trackAvg, bestSess, inPit);
}

function _spRenderRows(eq, trackAvg, bestSess, leader){
  if(!eq.length)return`<div class="sp-empty" style="color:#333;font-size:12px;padding:20px">Sin datos — esperando conexión</div>`;
  let html='';
  eq.forEach(e=>{
    const pinned=_spPinned===e.dorsal;
    const flash=e.lapFlash?'sp-flash':'';
    const cons=_spCons(e.lapHistory);
    const kc=_spKartColor(e.dorsal);

    let lastCol='#9ca3af';
    if(e.lastLap&&trackAvg){
      const d=e.lastLap-trackAvg;
      if(d<-0.5)lastCol='#c084fc';
      else if(d<0)lastCol='#22c55e';
      else if(d>1.0)lastCol='#ef4444';
      else if(d>0.3)lastCol='#fbbf24';
    }
    const bestCol=e.bestLap&&bestSess&&Math.abs(e.bestLap-bestSess)<0.001?'#c084fc':'#9ca3af';

    let arrow='';
    if(e.posChange){
      arrow=e.posChange.delta>0
        ?`<span class="sp-au">▲${e.posChange.delta}</span>`
        :`<span class="sp-ad">▼${Math.abs(e.posChange.delta)}</span>`;
    }

    let dotColor='#22c55e';
    if(e.pit&&e.pitState==='out')dotColor='#f97316';
    else if(e.pit)dotColor='#ef4444';
    else if(e.state==='su'||e.state==='sd')dotColor='#f97316';
    if(e.checkered)dotColor='#c084fc';

    const pitBadge=e.pit?(e.pitState==='out'?`<span class="sp-out-b">OUT${e.pitS?` ${e.pitS}s`:''}</span>`:`<span class="sp-pit-b">PIT${e.pitS?` ${e.pitS}s`:''}</span>`):'';
    const fixBadge=pinned?`<span class="sp-fix-b">fijado</span>`:'';
    const chkBadge=e.checkered?`<span style="font-size:12.5px" title="Sesión finalizada">🏁</span>`:'';

    const now=Date.now();
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

    html+=`
    <div class="sp-rowwrap">
      <div class="sp-row ${flash}${pinned?' sp-pinned':''}" onclick="_spPin('${e.dorsal}')">
        <div class="sp-dot" style="background:${dotColor}"></div>
        <div class="sp-pos">${e.pos===99?'—':e.pos}${arrow}</div>
        <div><div class="sp-kart" style="background:${kc.bg};color:${kc.text};border:0.5px solid ${kc.border}">${e.dorsal}</div></div>
        <div class="sp-name">${chkBadge}${e.name}${pitBadge}${fixBadge}</div>
        <div class="sp-vtas">${e.tours}</div>
        <div class="sp-t" style="color:${e.lastLap?lastCol:'#2d2f38'}">${_spFmt(e.lastLap)}</div>
        <div class="sp-t" style="color:${e.bestLap?bestCol:'#2d2f38'}">${_spFmt(e.bestLap)}</div>
        <div class="sp-gap">${(()=>{
          if(e.pos===1)return'—';
          if(e.gap&&e.gap.includes('v'))return'<span style="color:#f97316">'+e.gap+'</span>';
          if(e.gapMs>0)return _spFmtGap(e.gapMs);
          if(e.gap)return e.gap;
          if(leader&&leader.tours&&e.tours<leader.tours){const d=leader.tours-e.tours;return'<span style="color:#f97316">+'+d+'v</span>';}
          return'—';
        })()}</div>
        <div class="sp-gap">${e.interval||'—'}</div>
        <div class="sp-cons">${cons?`<span style="color:${cons.color}">${cons.label}</span>`:'—'}</div>
        <div class="sp-pitc">${e.standsCount||0}</div>
        <div class="sp-lapbar ${barClass}" id="sp-bar-${e.dorsal}" style="width:${barPct}%"></div>
      </div>
    </div>`;
  });
  return html;
}


function _spPin(dorsal){
  _spPinned=(_spPinned===dorsal)?null:dorsal;
  _spRender();
}

// ── Simulación ─────────────────────────────────────────────────────────────
function _spInitSim(){
  const nombres=['EQUIPE 1','EQUIPE 2','EQUIPE 3','EQUIPE 4','EQUIPE 5',
                 'EQUIPE 6','EQUIPE 7','EQUIPE 8','EQUIPE 9','EQUIPE 10'];
  const dorsales=['7','9','15','11','12','14','10','13','6','8'];
  const bases=[67.2,67.8,68.1,68.5,69.0,69.3,69.8,70.2,71.0,72.5];

  const now=Date.now();
  _spData.equipos=nombres.map((name,i)=>({
    dorsal:dorsales[i], name, pos:i+1,
    lastLap:null, bestLap:bases[i],
    lapHistory:[bases[i],bases[i]+0.2,bases[i]-0.1],
    gapMs:i===0?0:Math.round((bases[i]-bases[0])*1000*(i+1)),
    pit:false, pitS:0, state:'sr',
    s1:null, s2:null, s3:null,
    tours:Math.floor(20-i*0.5),
    standsCount:1, stops:1, checkered:false,
    lapFlash:false, posChange:null,
    _lapStart:now-Math.random()*bases[i]*1000,
  }));
  _spData.leaderLap=20;

  // Sincronizar reloj simulado
  if(window.ApexClock)window.ApexClock.sync(90*60*1000);

  // Tick de simulación — cada ~3-5s un kart completa vuelta
  if(_spSimTimer)clearInterval(_spSimTimer);
  _spSimTimer=setInterval(()=>{
    const now=Date.now();
    _spData.equipos.forEach(e=>{
      if(e.pit){
        e.pitS=(e.pitS||0)+1;
        if(e.pitS>15){e.pit=false;e.pitS=0;e.state='sr';e._lapStart=now;}
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
        if(e.lapHistory.length>10)e.lapHistory.shift();
        e.tours=(e.tours||0)+1;
        e._lapStart=now;
        e.lapFlash=true;
        setTimeout(()=>{e.lapFlash=false;},2000);
        // Simular pit ocasional
        if(Math.random()<0.03&&e.standsCount<3){
          e.pit=true; e.state='si'; e.pitS=0; e.standsCount++;
        }
      }
    });
    // Re-ordenar por vueltas y tiempo
    _spData.equipos.sort((a,b)=>b.tours-a.tours||(a.bestLap-b.bestLap));
    _spData.equipos.forEach((e,i)=>{
      if(e.pos!==i+1){
        e.posChange={from:e.pos,to:i+1,delta:e.pos-(i+1),time:Date.now()};
        setTimeout(()=>{e.posChange=null;},5000);
      }
      e.pos=i+1;
    });
    // Gap al líder
    const leaderLaps=_spData.equipos[0]?.tours||0;
    const leaderBest=_spData.equipos[0]?.bestLap||70;
    _spData.equipos.forEach((e,i)=>{
      e.gapMs=i===0?0:Math.round((e.bestLap-leaderBest)*1000*(e.pos));
    });
    _spData.leaderLap=leaderLaps;
    if(_spTimer)clearTimeout(_spTimer);
    _spTimer=setTimeout(_spRender,80);
  },1000);
}

// ── API pública ───────────────────────────────────────────────────────────
window.showSprintDashboard=function(cfg){
  _spInjectStyles();
  _spPinned=null;

  // Compatibilidad reloj
  if(window.ApexClock&&!window.ApexClock.fmt){
    window.ApexClock.fmt=function(){return this.fmtMs(this.remainingMs());};
  }

  document.getElementById('screen-setup').classList.remove('active');
  const el=document.getElementById('screen-dash');
  el.classList.add('active');
  el.innerHTML=''; // Limpiar dashboard anterior
  _spInjectSetupBtn();

  // Renderizar dashboard completo inmediatamente
  _spRender();

  // Reloj cada segundo
  if(_spClockTimer)clearInterval(_spClockTimer);
  _spClockTimer=setInterval(()=>{
    const cv=document.getElementById('sp-clk');
    const lbl=document.getElementById('sp-clk-lbl');
    if(cv&&window.ApexClock){
      cv.textContent=window.ApexClock.fmtMs(window.ApexClock.remainingMs());
      if(lbl)lbl.textContent=window.ApexClock.isCountUp()?'tiempo transcurrido':'tiempo restante';
    }
  },1000);

  // Barra de progreso cada 100ms
  if(_spBarTimer)clearInterval(_spBarTimer);
  _spBarTimer=setInterval(_spUpdateBars,100);

  if(cfg.simMode){
    _spInitSim();
    setTimeout(_spRender,100);
  } else {
    ApexConnector.connect(
      cfg.slug,
      (data)=>{
        // Guardar _lapStart para barra de progreso
        const now=Date.now();
        (data.equipos||[]).forEach(e=>{
          const prev=_spData.equipos.find(p=>p.dorsal===e.dorsal);
          if(prev&&prev.lastLap!==e.lastLap)e._lapStart=now;
          else if(prev)e._lapStart=prev._lapStart;
          else e._lapStart=now;
        });
        _spData.equipos=data.equipos||[];
        _spData.leaderLap=data.leaderLap||0;
        if(_spTimer)clearTimeout(_spTimer);
        _spTimer=setTimeout(_spRender,80);
      },
      (status,msg)=>console.log('[Apex]',status,msg),
      (comment)=>console.log('[Apex]',comment),
      cfg.port||7913
    );
  }
};

window._spGoBack=function(){
  document.querySelector('.sp-nav-setup')?.remove();
  if(!window.AppState?.config?.simMode)ApexConnector.disconnect();
  if(window.ApexClock)window.ApexClock.reset();
  if(_spTimer)clearTimeout(_spTimer);
  if(_spClockTimer){clearInterval(_spClockTimer);_spClockTimer=null;}
  if(_spSimTimer){clearInterval(_spSimTimer);_spSimTimer=null;}
  if(_spBarTimer){clearInterval(_spBarTimer);_spBarTimer=null;}
  _spData={equipos:[],leaderLap:0};
  document.getElementById('screen-dash').classList.remove('active');
  document.getElementById('screen-setup').classList.add('active');
  if(typeof renderSetup==='function')renderSetup();
};
