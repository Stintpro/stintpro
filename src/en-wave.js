// ── en-wave.js — pestaña 🌊 Olas (Wave Detection) ──────────────────────────
// Anticipa los racimos de paradas del pelotón. NO recalcula: consume el motor
// puro en-pit-windows.js (mismas ventanas de parada que Estrategia) y lo reusa
// _enRivalStintStart / _enEffectiveQuality de los otros módulos. Firma temporal:
// una línea de tiempo donde las olas aparecen como bandas rodando hacia AHORA,
// y debajo una fila por ola. Estética de cristal + tokens de estado existentes.

const _EN_WAVE_HORIZON_DEFAULT = 15; // min visibles en la línea de tiempo

// Color por urgencia de la ola (cuándo llega el primero).
function _enWaveUrgencyColor(min){
  if(min<=2) return 'var(--state-alert)';
  if(min<=5) return 'var(--state-warn)';
  return '#60a5fa';
}
// Color por calidad de kart (idéntico al resto de la app).
function _enWaveQualColor(q){
  return q==='good'?'#22c55e':q==='neutral'?'#fbbf24':q==='bad'?'#ef4444':'#333';
}
function _enWaveWinLabel(w){
  return w.earliestMin===w.latestMin?`~${w.earliestMin} min`:`~${w.earliestMin}-${w.latestMin} min`;
}
function _enWaveCompDots(comp){
  const dot=(c,n)=>`<span style="display:inline-flex;align-items:center;gap:3px"><span style="width:8px;height:8px;border-radius:2px;background:${c}"></span>${n}</span>`;
  const parts=[];
  if(comp.good)parts.push(dot('#22c55e',comp.good));
  if(comp.neutral)parts.push(dot('#fbbf24',comp.neutral));
  if(comp.bad)parts.push(dot('#ef4444',comp.bad));
  if(comp.unknown)parts.push(dot('#333',comp.unknown));
  return parts.join('<span style="color:var(--text-3)">·</span>');
}
function _enWaveChip(k){
  const qc=_enWaveQualColor(k.quality);
  const can=k.canPitNow===true?'✓':k.canPitNow===false?`${k.minUntilCanPit}m`:'';
  return `<span title="Dorsal #${k.dorsal}${k.canPitNow===false?` · puede parar en ${k.minUntilCanPit} min`:k.canPitNow===true?' · ya puede parar':''}" style="display:inline-flex;align-items:center;gap:4px;background:#1a1b22;border:1.5px solid ${qc};border-radius:5px;padding:2px 7px;font-size:12.5px;font-family:monospace;color:var(--text-1)">#${k.dorsal}${can?`<span style="font-size:10.5px;color:var(--text-3)">${can}</span>`:''}</span>`;
}

// Línea de tiempo: bandas (olas) + ticks (karts) sobre un eje 0→horizonte.
function _enWaveTimeline(waves, singletons, horizon){
  const gridMarks=[5,10,15,20,25,30].filter(m=>m<=horizon);
  const gridHtml=gridMarks.map(m=>`<div style="position:absolute;left:${m/horizon*100}%;top:0;bottom:0;width:1px;background:#1a1b22"></div><div style="position:absolute;left:${m/horizon*100}%;bottom:-16px;transform:translateX(-50%);font-size:10px;color:var(--text-3);font-family:monospace">${m}m</div>`).join('');
  const bandsHtml=waves.map(w=>{
    const c=_enWaveUrgencyColor(w.earliestMin);
    const left=Math.max(0,w.earliestMin/horizon*100);
    const width=Math.max(2.5,(w.latestMin-w.earliestMin)/horizon*100);
    return `<div style="position:absolute;left:${left}%;width:${width}%;top:4px;bottom:20px;background:${c};opacity:0.14;border-left:2px solid ${c};border-radius:3px"></div>`;
  }).join('');
  const allK=[...waves.flatMap(w=>w.karts.map(k=>({...k,inWave:true}))),...singletons.map(k=>({...k,inWave:false}))];
  const ticksHtml=allK.filter(k=>k.minLeft<=horizon).map(k=>{
    const qc=_enWaveQualColor(k.quality);
    return `<div title="#${k.dorsal} · ~${k.minLeft}m" style="position:absolute;left:${k.minLeft/horizon*100}%;top:${k.inWave?'26px':'40px'};transform:translateX(-50%);width:9px;height:9px;border-radius:50%;background:${qc};border:1px solid #0e0f11;box-shadow:0 0 0 1px ${k.inWave?qc:'transparent'}"></div>`;
  }).join('');
  return `
  <div style="position:relative;margin:6px 4px 26px;height:64px">
    <div style="position:absolute;left:0;top:0;bottom:20px;display:flex;align-items:center;font-size:10.5px;color:var(--text-2);font-family:sans-serif;font-weight:600;background:#0e0f11;padding-right:6px;z-index:2">AHORA</div>
    <div style="position:absolute;left:0;right:0;top:0;bottom:20px;border-left:2px solid var(--text-2);border-radius:2px;overflow:visible">
      ${gridHtml}${bandsHtml}${ticksHtml}
    </div>
  </div>`;
}

function _enRenderWave(eq, trackAvg){
  const cfg=window.AppState?.config||{};
  const stintMaxMs=(cfg.stintMax||999)*60*1000;
  const stintMinMs=(cfg.stintMin||0)*60*1000;
  const myDorsal=cfg.myDorsal;
  const C=window.ApexClock;
  const remainingMs=(C&&!C.isCountUp())?C.remainingMs():0;

  // Sin stint máximo no hay ventana de parada calculable → guía al usuario.
  if(stintMaxMs>=999*60*1000){
    return `<div style="padding:20px;text-align:center;color:var(--text-3);font-family:sans-serif;font-size:13.5px">Configura el <b>stint máximo</b> en la pestaña 🎯 Estrategia para detectar olas de paradas.</div>`;
  }

  const ctx={
    stintMaxMs, stintMinMs,
    pitDurationMs:(EnBox.pitDuration||120)*1000,
    totalStops:EnBox.totalStops||0,
    remainingMs,
    nowMs:Date.now(),
  };

  const rivals=(eq||[]).filter(e=>!EnBoxModel.isMine(e, myDorsal)).map(e=>{
    const startMs=(typeof _enRivalStintStart==='function')?_enRivalStintStart(e):null;
    const elapsedMs=startMs?(Date.now()-startMs):null;
    return {
      dorsal:e.dorsal, name:e.name,
      quality:_enEffectiveQuality(e.dorsal, e, trackAvg),
      pit:!!e.pit,
      standsCount:e.standsCount||0,
      elapsedMs,
    };
  });

  const windows=EnPitWindows.computeWindows(rivals, ctx);
  const bandwidthMin=(typeof EnUi==='object'&&EnUi.waveBandwidthMin)||5;
  const {waves, singletons}=EnPitWindows.detectWaves(windows, {bandwidthMin});

  // Horizonte visible: 15 min por defecto, ampliado si la última ola cae más lejos.
  const maxWaveMin=waves.length?waves[waves.length-1].latestMin:0;
  const horizon=Math.min(40,Math.max(_EN_WAVE_HORIZON_DEFAULT, maxWaveMin+2));

  // ── Cabecera ──
  const next=EnPitWindows.nextWave(waves);
  let head;
  if(next){
    const c=_enWaveUrgencyColor(next.earliestMin);
    head=`<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
      <span style="font-size:22px;font-weight:600;color:${c};font-family:monospace">🌊 ${waves.length} ola${waves.length!==1?'s':''}</span>
      <span style="font-size:13.5px;color:var(--text-2);font-family:sans-serif">próxima en <b style="color:${c}">~${next.earliestMin} min</b> · ${next.count} karts</span>
    </div>`;
  } else {
    const soon=singletons.slice().sort((a,b)=>a.minLeft-b.minLeft)[0];
    head=`<div style="font-size:15px;font-weight:500;color:var(--text-2);font-family:sans-serif">🌊 Sin olas previstas${soon?` · próxima parada suelta: #${soon.dorsal} en ~${soon.minLeft} min`:''}</div>`;
  }

  // ── Filas de olas ──
  let rows='';
  waves.forEach((w,i)=>{
    const c=_enWaveUrgencyColor(w.earliestMin);
    const bandLeft=Math.max(0,w.earliestMin/horizon*100);
    const bandW=Math.max(3,(w.latestMin-w.earliestMin)/horizon*100);
    rows+=`
    <div style="border-left:3px solid ${c};background:#131318;border:0.5px solid #1a1b22;border-left:3px solid ${c};border-radius:8px;padding:10px 12px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="min-width:92px">
          <div style="font-size:18px;font-weight:600;color:${c};font-family:monospace">${_enWaveWinLabel(w)}</div>
          <div style="font-size:11px;color:var(--text-3);font-family:sans-serif">ola ${i+1}</div>
        </div>
        <div style="flex:1;min-width:120px">
          <div style="position:relative;height:6px;background:#0e0f11;border-radius:3px;overflow:hidden">
            <div style="position:absolute;left:${bandLeft}%;width:${bandW}%;top:0;bottom:0;background:${c};opacity:0.7;border-radius:3px"></div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-2);font-family:monospace">
          <b style="color:var(--text-1)">${w.count}</b> karts <span style="color:var(--text-3)">·</span> ${_enWaveCompDots(w.composition)}
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:9px">
        ${w.karts.map(_enWaveChip).join('')}
      </div>
    </div>`;
  });

  // ── Paradas sueltas (no forman ola) ──
  let loose='';
  const sortedSingles=singletons.slice().sort((a,b)=>a.minLeft-b.minLeft);
  if(sortedSingles.length){
    loose=`
    <div style="margin-top:14px">
      <div style="font-size:12px;color:var(--text-3);font-family:sans-serif;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Paradas sueltas</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">${sortedSingles.map(k=>`${_enWaveChip(k)}<span style="font-size:11px;color:var(--text-3);font-family:monospace;align-self:center">~${k.minLeft}m</span>`).join('<span style="width:6px"></span>')}</div>
    </div>`;
  }

  // ── Pie: ancho de banda + filtro ──
  const bands=[3,5,8];
  const bandBtns=bands.map(b=>`<button onclick="_enSetWaveBandwidth(${b})" style="padding:3px 9px;border-radius:4px;border:0.5px solid ${bandwidthMin===b?'#60a5fa':'#2a2b2e'};background:${bandwidthMin===b?'#60a5fa18':'transparent'};color:${bandwidthMin===b?'#60a5fa':'var(--text-2)'};font-size:12px;cursor:pointer;font-family:monospace">±${b}m</button>`).join('');

  const empty=(waves.length===0&&sortedSingles.length===0)
    ?`<div style="padding:16px;text-align:center;color:var(--text-3);font-family:sans-serif;font-size:13px">Nadie en ventana de parada todavía.</div>`:'';

  return `
  <div style="padding:12px 14px">
    <div style="margin-bottom:10px">${head}</div>
    ${(waves.length||sortedSingles.length)?_enWaveTimeline(waves, sortedSingles, horizon):''}
    ${rows}
    ${loose}
    ${empty}
    <div style="display:flex;align-items:center;gap:8px;margin-top:14px;padding-top:10px;border-top:0.5px solid #1a1b22">
      <span style="font-size:12px;color:var(--text-3);font-family:sans-serif">Agrupar olas dentro de</span>
      ${bandBtns}
    </div>
  </div>`;
}

// Cambia el ancho de banda del clustering y repinta.
function _enSetWaveBandwidth(v){
  if(typeof EnUi==='object')EnUi.waveBandwidthMin=v;
  if(typeof _enRender==='function')_enRender();
}
