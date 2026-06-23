// ── en-strategy.js — fragmento de endurance.js ──
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

// Parsea el string de gap de Apex a segundos. "+30.000" → 30, "+2v" → 2*lapTime, "" → 0
function _enParseGap(gapStr, lapTime){
  if(!gapStr)return 0;
  const s=String(gapStr).replace(/^\+/,'').trim();
  if(s.endsWith('v')){
    const laps=parseInt(s);
    return isNaN(laps)?0:laps*(lapTime||67);
  }
  const t=parseFloat(s);
  return isNaN(t)?0:t;
}

function _enShowEstimatedClassification(){
  const eq=EnSession.data.equipos||[];
  const trackAvg=_enTrackAvgLive(eq);
  if(!eq.length)return;

  // Coste medio de parada
  let allCosts=[];
  Object.values(EnSession.pitCosts).forEach(arr=>allCosts=allCosts.concat(arr));
  const validCosts=allCosts.filter(c=>c>=EnBox.pitDuration*0.8);
  const avgPitCost=validCosts.length>0
    ?validCosts.reduce((a,b)=>a+b,0)/validCosts.length
    :EnBox.pitDuration*1.1;
  const costSource=validCosts.length>0?`medido (${validCosts.length} paradas)`:'estimado por duración oficial';

  // Paradas por equipo
  const getStops=(e)=>e.standsCount>0?e.standsCount:(EnSession.pitCounts[e.dorsal]||0);
  const maxStops=Math.max(...eq.map(getStops),1);
  const usingOfficial=eq.some(e=>e.standsCount>0);

  // ── Clasificación estimada ────────────────────────────────────────────────
  // Fórmula: estimatedGap = gapRealActual + (paradasPendientes × costePit)
  //
  // gapRealActual: lo que ya llevas de diferencia con el líder AHORA MISMO.
  // Fuente preferida: e.gap de Apex (en segundos). Fallback: vueltas × ritmo.
  // Así el que paró antes no "borra" su gap previo — mantiene lo que ya llevaba.
  //
  // paradasPendientes × costePit: lo que perderán los que aún no han parado.
  //
  // Resultado: "si todos hicieran las paradas que les faltan, ¿en qué orden quedarían?"

  const onTrack=eq.filter(e=>!e.pit);

  // Referencia de vueltas: líder de clasificación (pos=1), para el fallback de gap
  const classLeader=onTrack.find(e=>e.pos===1);
  const leaderTours=classLeader?(classLeader.tours||0):Math.max(...onTrack.map(e=>e.tours||0),0);

  // ¿Hay gap de Apex disponible? (al menos un kart no-líder lo tiene en segundos)
  const hasApexGap=onTrack.some(e=>e.pos!==1&&e.gap&&!String(e.gap).includes('v')&&parseFloat(String(e.gap).replace(/^\+/,''))>0);

  const estimated=onTrack.map(e=>{
    const stops=getStops(e);
    const diff=maxStops-stops;
    const avg5=_enAvg5(e.lapHistory);
    const lapTime=avg5||trackAvg||67;

    // Coste individual del equipo si está medido; sino media del circuito
    const teamCosts=(EnSession.pitCosts[e.dorsal]||[]).filter(c=>c>=EnBox.pitDuration*0.8);
    const teamAvgCost=teamCosts.length?teamCosts.reduce((a,b)=>a+b,0)/teamCosts.length:avgPitCost;
    const penalty=diff*teamAvgCost;

    // Gap real actual al líder
    const lapsBehind=Math.max(0,leaderTours-(e.tours||0));
    const gapFromLaps=lapsBehind*lapTime;
    const gapFromApex=_enParseGap(e.gap, lapTime);
    // Preferimos el gap de Apex si está disponible en segundos (más preciso que laps*ritmo)
    const gapReal=hasApexGap?Math.max(gapFromApex, gapFromLaps):gapFromLaps;

    const estimatedGap=gapReal+penalty;
    const quality=_enEffectiveQuality(e.dorsal, e, trackAvg);

    return {
      dorsal:e.dorsal, name:e.name, pos:e.pos, stops, tours:e.tours||0,
      gapReal, penalty, estimatedGap, avg5, quality, diff, lapsBehind,
      gapFromApex, gapFromLaps,
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
    const qBorder=e.quality==='good'?'#22c55e':e.quality==='bad'?'#ef4444':e.quality==='neutral'?'#fbbf24':kc.border;
    const penaltyStr=e.diff>0?`<span style="color:#ef4444">+${e.diff}pit (${e.penalty.toFixed(0)}s)</span>`:'';
    const estGapStr=i===0?'—':'+'+e.estimatedGap.toFixed(1)+'s';
    const realGapStr=e.lapsBehind>0?`-${e.lapsBehind}v`:e.gapReal>0?'+'+e.gapReal.toFixed(1)+'s':'—';
    const posChange=e.pos-(i+1);
    const posStr=posChange>0?`<span style="color:#22c55e">↑${posChange}</span>`:posChange<0?`<span style="color:#ef4444">↓${Math.abs(posChange)}</span>`:'<span style="color:#bdc2cc">=</span>';

    rows+=`<div style="display:grid;grid-template-columns:28px 34px 1fr 44px 60px 60px 80px 36px;align-items:center;padding:5px 0;border-bottom:0.5px solid #1a1b22;gap:8px">
      <span style="font-size:15px;font-weight:600;color:#e4e6ed;text-align:center">${i+1}</span>
      <div style="width:30px;height:22px;border-radius:5px;background:${kc.bg};color:${kc.text};border:1.5px solid ${qBorder};display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700">${_esc(e.dorsal)}${e.diff>0?'':' ★'}</div>
      <span style="font-size:15px;color:#e4e6ed;font-family:sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(e.name)}</span>
      <span style="font-size:15px;color:${e.stops===maxStops?'#22c55e':'#9ca3af'};font-family:monospace;text-align:center">${e.stops}</span>
      <span style="font-size:15px;color:${e.lapsBehind>0?'#ef4444':e.gapReal>0?'#9ca3af':'#555'};font-family:monospace;text-align:right">${realGapStr}</span>
      <span style="font-size:15px;color:#5b8dee;font-family:monospace;text-align:right;font-weight:600">${estGapStr}</span>
      <span style="font-size:13px;font-family:sans-serif;text-align:right">${penaltyStr}</span>
      <span style="font-size:15px;text-align:center">${posStr}</span>
    </div>`;
  });

  overlay.innerHTML=`
    <div style="background:#13141a;border:0.5px solid #2a2b2e;border-radius:12px;padding:24px;max-width:700px;width:95%;max-height:80vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div>
          <div style="font-size:18px;font-weight:600;color:#e4e6ed;font-family:sans-serif">📊 Clasificación estimada</div>
          <div style="font-size:15px;color:#bdc2cc;font-family:sans-serif;margin-top:2px">Normalizada a ${maxStops} paradas · Coste pit: ${avgPitCost.toFixed(1)}s (${costSource}) · Gap: ${hasApexGap?'Apex':'vueltas×ritmo'}</div>
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

        // Cargar ratings del snapshot del logger (cross-device, sin fetch adicional)
        if(data._isHistory && data.pilotRatings && Array.isArray(data.pilotRatings)){
          const map=Object.fromEntries(data.pilotRatings.map(p=>[p.name,p.score]));
          if(Object.keys(map).length) _enPilotRatings=map;
        }

        // Reconstruir stintStartIdx desde stintLapCount del snapshot del logger
        // stintLapCount = vueltas completadas por el kart actual desde el último pit out
        if(data._isHistory){
          (data.equipos||[]).forEach(e=>{
            if(!e.dorsal||e.stintLapCount===undefined)return;
            if(!EnSession.kartAutoState[e.dorsal])
              EnSession.kartAutoState[e.dorsal]={quality:null,badCount:0,stintStartIdx:0};
            EnSession.kartAutoState[e.dorsal].stintStartIdx=
              Math.max(0,(e.lapHistory||[]).length-e.stintLapCount);
          });
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
