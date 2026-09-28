// ── en-wave.js — pestaña 🌊 Olas (Wave Detection) ──────────────────────────
// Anticipa los racimos de paradas del pelotón. NO recalcula: consume el motor
// puro en-pit-windows.js (mismas ventanas de parada que Estrategia) y reusa
// _enRivalStintStart / _enEffectiveQuality de los otros módulos. Presentación:
// lista de rivales con contador de stint, agrupados en olas (cluster de ≥3 que
// paran juntos) con un color común según lo cerca que esté la ola; por debajo de
// 3 equipos no hay ola y van sin color ("paradas sueltas"). Tokens de estado
// existentes + estética de cristal.

// Color por urgencia de la ola (cuándo llega el primero). Común a toda la ola.
function _enWaveUrgencyColor(min){
  if(min<=2) return 'var(--state-alert)';
  if(min<=5) return 'var(--state-warn)';
  return '#60a5fa';
}
// Color por calidad de kart (idéntico al resto de la app).
function _enWaveQualColor(q){
  return q==='good'?'#22c55e':q==='neutral'?'#fbbf24':q==='bad'?'#ef4444':'#555';
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
  if(comp.unknown)parts.push(dot('#555',comp.unknown));
  return parts.join('<span style="color:var(--text-3);margin:0 1px">·</span>');
}

// Una fila de rival con su contador de stint. accent = color de la ola (o null).
function _enWaveRivalRow(k, accent){
  const qc=_enWaveQualColor(k.quality);
  const elapsedMin=k.elapsedMs!=null?Math.floor(k.elapsedMs/60000):null;
  const capMin=k.capMs!=null?Math.round(k.capMs/60000):null;
  const pct=(k.elapsedMs!=null&&k.capMs>0)?Math.min(100,Math.max(0,k.elapsedMs/k.capMs*100)):0;
  const barCol=accent||qc;
  // Contador: cuánto lleva de stint y cuánto le queda para tener que parar.
  const left=k.canPitNow===false
    ? `<span style="color:var(--text-3)">puede en ${k.minUntilCanPit}m</span>`
    : `queda <b style="color:${accent||'var(--text-1)'}">~${k.minLeft}m</b>`;
  const name=(k.name||'').length>18?k.name.slice(0,17)+'…':(k.name||'');
  return `
  <div style="display:flex;align-items:center;gap:10px;padding:7px 10px;border-left:3px solid ${accent||'transparent'};background:${accent?accent.replace('var(--state-alert)','#ef444410').replace('var(--state-warn)','#fbbf2410').replace('#60a5fa','#60a5fa10'):'transparent'};border-radius:6px;margin-bottom:4px">
    <span style="width:9px;height:9px;border-radius:50%;background:${qc};flex-shrink:0" title="calidad"></span>
    <span style="font-size:13.5px;font-family:monospace;color:var(--text-1);width:34px;flex-shrink:0">#${k.dorsal}</span>
    <span style="font-size:13px;font-family:sans-serif;color:var(--text-2);flex:1;min-width:70px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${name}</span>
    <div style="width:90px;flex-shrink:0" title="stint ${elapsedMin!=null?elapsedMin+'m':'?'} de ${capMin!=null?capMin+'m':'?'}">
      <div style="position:relative;height:5px;background:#0e0f11;border-radius:3px;overflow:hidden">
        <div style="position:absolute;left:0;top:0;bottom:0;width:${pct}%;background:${barCol};border-radius:3px"></div>
      </div>
      <div style="font-size:10px;color:var(--text-3);font-family:monospace;margin-top:2px">${elapsedMin!=null?elapsedMin+'m':'—'} stint</div>
    </div>
    <span style="font-size:12.5px;font-family:monospace;color:var(--text-2);width:96px;text-align:right;flex-shrink:0">${left}</span>
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
  const {waves}=EnPitWindows.detectWaves(windows, {bandwidthMin, minSize:3});

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
    head=`<div style="font-size:15px;font-weight:500;color:var(--text-2);font-family:sans-serif">🌊 Sin olas previstas <span style="font-size:12.5px;color:var(--text-3)">(hacen falta ≥3 equipos parando juntos)</span></div>`;
  }

  // Qué karts van en cada ola (por dorsal) para no repetirlos en "sueltas".
  const inWave=new Set();
  waves.forEach(w=>w.karts.forEach(k=>inWave.add(String(k.dorsal))));

  // ── Grupos de ola: cabecera de ola + sus filas, color común ──
  let groups='';
  waves.forEach((w,i)=>{
    const c=_enWaveUrgencyColor(w.earliestMin);
    groups+=`
    <div style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px;padding:6px 10px;background:#131318;border:0.5px solid #1a1b22;border-left:3px solid ${c};border-radius:7px 7px 0 0">
        <span style="font-size:14.5px;font-weight:600;color:${c};font-family:monospace">🌊 Ola ${i+1}</span>
        <span style="font-size:13px;color:var(--text-1);font-family:monospace">${_enWaveWinLabel(w)}</span>
        <span style="font-size:12.5px;color:var(--text-3);font-family:sans-serif">${w.count} karts</span>
        <span style="margin-left:auto;font-size:12.5px;font-family:monospace">${_enWaveCompDots(w.composition)}</span>
      </div>
      <div style="padding:6px 4px 0">
        ${w.karts.map(k=>_enWaveRivalRow(k, c)).join('')}
      </div>
    </div>`;
  });

  // ── Paradas sueltas: rivales con ventana que no forman ola (sin color) ──
  const singles=windows
    .filter(k=>!k.inPit && k.minLeft!=null && k.minLeft>=0 && !inWave.has(String(k.dorsal)))
    .sort((a,b)=>a.minLeft-b.minLeft);
  let loose='';
  if(singles.length){
    loose=`
    <div style="margin-top:6px">
      <div style="font-size:11.5px;color:var(--text-3);font-family:sans-serif;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Paradas sueltas</div>
      ${singles.map(k=>_enWaveRivalRow(k, null)).join('')}
    </div>`;
  }

  const empty=(waves.length===0&&singles.length===0)
    ?`<div style="padding:16px;text-align:center;color:var(--text-3);font-family:sans-serif;font-size:13px">Nadie en ventana de parada todavía.</div>`:'';

  // ── Pie: ancho de banda ──
  const bands=[3,5,8];
  const bandBtns=bands.map(b=>`<button onclick="_enSetWaveBandwidth(${b})" style="padding:3px 9px;border-radius:4px;border:0.5px solid ${bandwidthMin===b?'#60a5fa':'#2a2b2e'};background:${bandwidthMin===b?'#60a5fa18':'transparent'};color:${bandwidthMin===b?'#60a5fa':'var(--text-2)'};font-size:12px;cursor:pointer;font-family:monospace">±${b}m</button>`).join('');

  return `
  <div style="padding:12px 14px">
    <div style="margin-bottom:12px">${head}</div>
    ${groups}
    ${loose}
    ${empty}
    <div style="display:flex;align-items:center;gap:8px;margin-top:14px;padding-top:10px;border-top:0.5px solid #1a1b22">
      <span style="font-size:12px;color:var(--text-3);font-family:sans-serif">Agrupar olas dentro de</span>
      ${bandBtns}
      <span style="margin-left:auto;font-size:11px;color:var(--text-3);font-family:sans-serif">ola = ≥3 equipos</span>
    </div>
  </div>`;
}

// Cambia el ancho de banda del clustering y repinta.
function _enSetWaveBandwidth(v){
  if(typeof EnUi==='object')EnUi.waveBandwidthMin=v;
  if(typeof _enRender==='function')_enRender();
}
