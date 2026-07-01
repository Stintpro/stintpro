// ── en-advanced.js — fragmento de endurance.js ──
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
            <div style="width:34px;height:24px;border-radius:5px;background:#F5A623;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff">TÚ</div>
            <div style="font-size:8px;color:#F5A623;margin-top:2px">sales aquí</div>
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
        <div style="font-size:17px;font-weight:500;color:${stopsLeft>3?'#fbbf24':'#F5A623'};font-family:monospace">${stopsLeft}</div>
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
      <div style="width:18px;height:18px;border-radius:3px;border:1.5px solid ${excluded?'#333':'#F5A623'};background:${excluded?'transparent':'#F5A623'};display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff">${excluded?'':'✓'}</div>
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
        <button onclick="_enDismissOverlay();_enRender()" style="flex:1;padding:8px;border-radius:6px;border:0.5px solid #F5A623;background:#F5A62322;color:#F5A623;font-size:11px;cursor:pointer;font-family:sans-serif">Cerrar</button>
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

