// ── en-wave.js — pestaña 🌊 Olas (Wave Detection) ──────────────────────────
// Anticipa los racimos de paradas del pelotón. NO recalcula: consume el motor
// puro en-pit-windows.js (mismas ventanas de parada que Estrategia) y reusa
// _enRivalStintStart / _enEffectiveQuality / _enKartColor / _enFmt* de los otros
// módulos. Presentación: tarjetas de rival al estilo de la cola de box (la
// CALIDAD es el color de fondo de la tarjeta), con nombre de EQUIPO, tiempo de
// stint y vuelta rápida. Las que paran juntas (cluster de ≥3) se enmarcan en una
// ola con un color común según lo cerca que esté; por debajo de 3 no hay ola.

// Color por urgencia de la ola (cuándo llega el primero). Enmarca el grupo.
function _enWaveUrgencyColor(min){
  if(min<=2) return 'var(--state-alert)';
  if(min<=5) return 'var(--state-warn)';
  return '#60a5fa';
}
// Calidad = fondo COMPLETO de la tarjeta (idéntico a la cola de box en-strategy).
function _enWaveQBg(q){ return q==='good'?'#22c55e':q==='bad'?'#ef4444':q==='neutral'?'#fbbf24':'#2f3138'; }
function _enWaveQTxt(q){ return q==='neutral'?'#3a2a02':q==='unknown'?'#c7ced6':'#0b1a10'; }
function _enWaveQSub(q){ return q==='neutral'?'#5a4310':q==='unknown'?'#9ca3af':q==='bad'?'#2a0808':'#0e3a1d'; }

function _enWaveWinLabel(w){
  return w.earliestMin===w.latestMin?`~${w.earliestMin} min`:`~${w.earliestMin}-${w.latestMin} min`;
}
function _enWaveCompDots(comp){
  const dot=(c,n)=>`<span style="display:inline-flex;align-items:center;gap:3px"><span style="width:8px;height:8px;border-radius:2px;background:${c}"></span>${n}</span>`;
  const parts=[];
  if(comp.good)parts.push(dot('#22c55e',comp.good));
  if(comp.neutral)parts.push(dot('#fbbf24',comp.neutral));
  if(comp.bad)parts.push(dot('#ef4444',comp.bad));
  if(comp.unknown)parts.push(dot('#555',comp.unknown));
  return parts.join('<span style="color:var(--text-3);margin:0 1px">·</span>');
}

// Tarjeta de rival. k = ventana del motor; e = objeto equipo (para nombre de
// equipo, color de categoría y vuelta rápida). waveTag = {n,color} si pertenece
// a una ola (se muestra como badge en el modo "ordenar por calidad").
function _enWaveRivalCard(k, e, waveTag){
  const bg=_enWaveQBg(k.quality), txt=_enWaveQTxt(k.quality), sub=_enWaveQSub(k.quality);
  const kc=(typeof _enKartColor==='function')?_enKartColor(k.dorsal, e&&e.catColor):{bg:'#1a1b22',text:'#fff'};
  const team=(e&&(e.teamName||e.name))||k.name||('#'+k.dorsal);
  const teamTxt=team.length>26?team.slice(0,25)+'…':team;
  const stint=(k.elapsedMs!=null&&typeof _enFmtStint==='function')?_enFmtStint(k.elapsedMs):'—';
  const fast=(e&&e.bestLap&&typeof _enFmt==='function')?_enFmt(e.bestLap):null;
  const laps=(e&&e.tours>0)?e.tours+'v':null;
  // Contador: cuánto le queda para tener que parar / cuándo podrá parar.
  const count=k.canPitNow===false
    ? `<span style="font-size:11px;color:${sub}">puede en</span> <b style="font-size:15px;color:${txt}">${k.minUntilCanPit}m</b>`
    : `<span style="font-size:11px;color:${sub}">queda</span> <b style="font-size:15px;color:${txt}">~${k.minLeft}m</b>`;
  return `
  <div style="display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:8px;background:${bg};color:${txt};border:1px solid rgba(0,0,0,0.25);margin-bottom:4px">
    <div style="width:34px;height:26px;border-radius:5px;background:${kc.bg};color:${kc.text};display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0;box-shadow:0 0 0 1px rgba(0,0,0,0.25)">${_esc(k.dorsal)}</div>
    <div style="flex:1;min-width:0">
      <div style="font-size:13.5px;font-weight:700;font-family:sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(teamTxt)}${waveTag?` <span style="font-size:10px;font-weight:700;font-family:monospace;color:${waveTag.color};background:rgba(0,0,0,0.25);border-radius:4px;padding:1px 5px;vertical-align:middle">🌊${waveTag.n}</span>`:''}</div>
      <div style="font-size:11px;color:${sub};font-family:monospace">🏁 ${stint} stint${fast?` · ⚡ ${fast}`:''}${laps?` · ${laps}`:''}</div>
    </div>
    <div style="text-align:right;flex-shrink:0;font-family:monospace">${count}</div>
  </div>`;
}

// Motor de olas para la vista: monta el contexto desde el estado de la app y
// devuelve ventanas + olas. Lo comparten la pestaña 🌊 Olas y el KPI "Próxima
// ola" de en-grid.js (un solo cálculo). hasMax=false si no hay stint máximo.
function _enComputeWaves(eq, trackAvg){
  const cfg=window.AppState?.config||{};
  const stintMaxMs=(cfg.stintMax||999)*60*1000;
  const stintMinMs=(cfg.stintMin||0)*60*1000;
  const myDorsal=cfg.myDorsal;
  const C=window.ApexClock;
  const remainingMs=(C&&!C.isCountUp())?C.remainingMs():0;
  if(stintMaxMs>=999*60*1000) return {hasMax:false, windows:[], waves:[], next:null, eqByDorsal:{}};
  const ctx={
    stintMaxMs, stintMinMs,
    pitDurationMs:(EnBox.pitDuration||120)*1000,
    totalStops:EnBox.totalStops||0,
    remainingMs,
    nowMs:Date.now(),
  };
  const eqByDorsal={};
  (eq||[]).forEach(e=>{ if(e.dorsal!=null)eqByDorsal[String(e.dorsal).trim()]=e; });
  const rivals=(eq||[]).filter(e=>!EnBoxModel.isMine(e, myDorsal)).map(e=>{
    const startMs=(typeof _enRivalStintStart==='function')?_enRivalStintStart(e):null;
    const elapsedMs=startMs?(Date.now()-startMs):null;
    return {
      dorsal:e.dorsal, name:e.name,
      quality:_enEffectiveQuality(e.dorsal, e, trackAvg),
      pit:!!e.pit,
      standsCount:(typeof _enRivalStops==='function')?_enRivalStops(e):(e.standsCount||0),
      elapsedMs,
    };
  });
  const windows=EnPitWindows.computeWindows(rivals, ctx);
  const bandwidthMin=(typeof EnUi==='object'&&EnUi.waveBandwidthMin)||5;
  const {waves}=EnPitWindows.detectWaves(windows, {bandwidthMin, minSize:3});
  return {hasMax:true, windows, waves, next:EnPitWindows.nextWave(waves), eqByDorsal};
}

function _enRenderWave(eq, trackAvg){
  const wc=_enComputeWaves(eq, trackAvg);

  // Sin stint máximo no hay ventana de parada calculable → guía al usuario.
  if(!wc.hasMax){
    return `<div style="padding:20px;text-align:center;color:var(--text-3);font-family:sans-serif;font-size:13.5px">Configura el <b>stint máximo</b> en la pestaña 🎯 Estrategia para detectar olas de paradas.</div>`;
  }

  const {windows, waves, eqByDorsal}=wc;
  const bandwidthMin=(typeof EnUi==='object'&&EnUi.waveBandwidthMin)||5;
  const card=(k)=>_enWaveRivalCard(k, eqByDorsal[String(k.dorsal).trim()]);

  // ── Cabecera ──
  const next=wc.next;
  let head;
  if(next){
    const c=_enWaveUrgencyColor(next.earliestMin);
    head=`<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
      <span style="font-size:22px;font-weight:600;color:${c};font-family:monospace">🌊 ${waves.length} ola${waves.length!==1?'s':''}</span>
      <span style="font-size:13.5px;color:var(--text-2);font-family:sans-serif">próxima en <b style="color:${c}">~${next.earliestMin} min</b> · ${next.count} equipos</span>
    </div>`;
  } else {
    head=`<div style="font-size:15px;font-weight:500;color:var(--text-2);font-family:sans-serif">🌊 Sin olas previstas <span style="font-size:12.5px;color:var(--text-3)">(hacen falta ≥3 equipos parando juntos)</span></div>`;
  }

  // Mapa dorsal→ola (índice + color) para badges en el modo "calidad".
  const waveOf={};
  waves.forEach((w,i)=>{ const c=_enWaveUrgencyColor(w.earliestMin); w.karts.forEach(k=>{ waveOf[String(k.dorsal)]={n:i+1,color:c}; }); });
  const inWave=new Set(Object.keys(waveOf));

  const sortMode=(typeof EnUi==='object'&&EnUi.waveSort==='quality')?'quality':'wave';
  let body='';

  if(sortMode==='wave'){
    // ── Grupos de ola: marco con color común + tarjetas de calidad dentro ──
    waves.forEach((w,i)=>{
      const c=_enWaveUrgencyColor(w.earliestMin);
      body+=`
      <div style="margin-bottom:12px;border:1px solid color-mix(in srgb, ${c} 45%, transparent);border-radius:9px;overflow:hidden">
        <div style="display:flex;align-items:center;gap:10px;padding:6px 10px;background:color-mix(in srgb, ${c} 12%, transparent);border-bottom:1px solid color-mix(in srgb, ${c} 30%, transparent)">
          <span style="font-size:14.5px;font-weight:700;color:${c};font-family:monospace">🌊 Ola ${i+1}</span>
          <span style="font-size:13px;color:var(--text-1);font-family:monospace">${_enWaveWinLabel(w)}</span>
          <span style="font-size:12.5px;color:var(--text-3);font-family:sans-serif">${w.count} equipos</span>
          <span style="margin-left:auto;font-size:12.5px;font-family:monospace">${_enWaveCompDots(w.composition)}</span>
        </div>
        <div style="padding:6px">
          ${w.karts.map(card).join('')}
        </div>
      </div>`;
    });
    // Paradas sueltas: rivales con ventana que no forman ola.
    const singles=windows
      .filter(k=>!k.inPit && k.minLeft!=null && k.minLeft>=0 && !inWave.has(String(k.dorsal)))
      .sort((a,b)=>a.minLeft-b.minLeft);
    if(singles.length){
      body+=`
      <div style="margin-top:6px">
        <div style="font-size:11.5px;color:var(--text-3);font-family:sans-serif;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Paradas sueltas</div>
        ${singles.map(card).join('')}
      </div>`;
    }
  } else {
    // ── Orden por calidad: todos los rivales, buenos→neutros→malos ──
    const qRank={good:0,neutral:1,bad:2,unknown:3};
    const all=windows
      .filter(k=>!k.inPit && k.minLeft!=null && k.minLeft>=0)
      .sort((a,b)=>(qRank[a.quality]-qRank[b.quality])||(a.minLeft-b.minLeft));
    body=all.map(k=>_enWaveRivalCard(k, eqByDorsal[String(k.dorsal).trim()], waveOf[String(k.dorsal)])).join('');
  }

  const anyRival=windows.some(k=>!k.inPit && k.minLeft!=null && k.minLeft>=0);
  const empty=!anyRival
    ?`<div style="padding:16px;text-align:center;color:var(--text-3);font-family:sans-serif;font-size:13px">Nadie en ventana de parada todavía.</div>`:'';

  // ── Pie: orden + ancho de banda ──
  const sortBtn=(v,lbl)=>`<button onclick="_enSetWaveSort('${v}')" style="padding:3px 9px;border-radius:4px;border:0.5px solid ${sortMode===v?'#60a5fa':'#2a2b2e'};background:${sortMode===v?'#60a5fa18':'transparent'};color:${sortMode===v?'#60a5fa':'var(--text-2)'};font-size:12px;cursor:pointer;font-family:sans-serif">${lbl}</button>`;
  const bands=[3,5,8];
  const bandBtns=bands.map(b=>`<button onclick="_enSetWaveBandwidth(${b})" style="padding:3px 9px;border-radius:4px;border:0.5px solid ${bandwidthMin===b?'#60a5fa':'#2a2b2e'};background:${bandwidthMin===b?'#60a5fa18':'transparent'};color:${bandwidthMin===b?'#60a5fa':'var(--text-2)'};font-size:12px;cursor:pointer;font-family:monospace">±${b}m</button>`).join('');

  return `
  <div style="padding:12px 14px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
      <div style="flex:1;min-width:180px">${head}</div>
      <div style="display:flex;align-items:center;gap:5px">${sortBtn('wave','🌊 Ola')}${sortBtn('quality','⬤ Calidad')}</div>
    </div>
    ${body}
    ${empty}
    <div style="display:flex;align-items:center;gap:8px;margin-top:14px;padding-top:10px;border-top:0.5px solid #1a1b22">
      <span style="font-size:12px;color:var(--text-3);font-family:sans-serif">Agrupar olas dentro de</span>
      ${bandBtns}
      <span style="margin-left:auto;font-size:11px;color:var(--text-3);font-family:sans-serif">ola = ≥3 equipos</span>
    </div>
  </div>`;
}

// Cambia el criterio de orden (ola / calidad) y repinta.
function _enSetWaveSort(v){
  if(typeof EnUi==='object')EnUi.waveSort=v;
  if(typeof _enRender==='function')_enRender();
}

// Cambia el ancho de banda del clustering y repinta.
function _enSetWaveBandwidth(v){
  if(typeof EnUi==='object')EnUi.waveBandwidthMin=v;
  if(typeof _enRender==='function')_enRender();
}

// KPI de cabecera "Próxima ola" (en-grid.js). Reusa el motor compartido; al
// clicar abre la pestaña 🌊 Olas. Sustituye al KPI "En boxes" (redundante con
// "Estado de Box", que ya muestra los karts en pit).
function _enWaveKpiHtml(eq, trackAvg){
  const wc=_enComputeWaves(eq, trackAvg);
  // color arranca en --text-3 (sin stint máx: tenue pero legible) y se declara
  // con valor para que el barrido de baldosas de tests/contrast.test.js lo resuelva.
  let color='var(--text-3)', val, sub;
  if(!wc.hasMax){ val='—'; sub='configura stint máx'; }
  else if(wc.next){
    const n=wc.next;
    color=_enWaveUrgencyColor(n.earliestMin);
    val=`~${n.earliestMin}m`;
    sub=`${n.count} equipos · ${_enWaveCompDots(n.composition)}`;
  } else { val='—'; color='var(--state-ok)'; sub='sin olas previstas'; }
  return `<div class="sp-kpi" style="cursor:pointer" onclick="_enSetTab('wave')" title="Ir a la pestaña 🌊 Olas">
    <div class="sp-kpi-lbl">🌊 Próxima ola</div>
    <div class="sp-kpi-val" style="color:${color}">${val}</div>
    <div class="sp-kpi-sub">${sub}</div>
  </div>`;
}
