// ── en-ai-engineer.js — fragmento de endurance.js ──
// IA "ingeniero de pista": snapshot compacto del estado de carrera + llamada
// al endpoint serverless /api/ai-engineer (Claude vía Vercel Function) para
// generar un boletín periódico. Alertas por evento y consulta bajo demanda
// se añaden en una siguiente iteración reusando _enBuildAiSnapshot/_enFetchAiEngineer.

const _enAiEngineer = {
  lastBulletin:         null,  // texto del último boletín generado
  lastBulletinAt:       null,  // timestamp del último boletín recibido
  fetching:             false,
  lastError:            null,
  BULLETIN_INTERVAL_MS: 12 * 60 * 1000, // cada 12 minutos
};

// ── Snapshot compacto para la IA (≈1-2 KB) ───────────────────────────────
// Reusa exactamente las mismas lecturas que _enRenderAdvPlan (plan de paradas)
// y _enComputeEstimatedClassification (gap estimado/deuda de paradas de rivales)
// para no duplicar ni divergir de los cálculos ya mostrados en la UI.
function _enBuildAiSnapshot(){
  const eq=EnSession.data.equipos||[];
  if(!eq.length)return null;
  const cfg=window.AppState?.config||{};
  const myDorsal=cfg.myDorsal;
  const myK=eq.find(e=>e.dorsal===myDorsal);
  if(!myK)return null;

  const remainMs=window.ApexClock?window.ApexClock.remainingMs():0;
  const totalStops=EnBox.totalStops||0;
  const stintMinM=cfg.stintMin||0;
  const myStops=myK.standsCount>0?myK.standsCount:(EnSession.stintHistory.length||0);
  const stopsLeft=Math.max(0,totalStops-myStops);
  const remainMin=remainMs/60000;
  const pitDurMin=EnBox.pitDuration/60;
  const trackTimeMin=remainMin-(stopsLeft*pitDurMin);
  const avgStintAvail=stopsLeft>=0?trackTimeMin/(stopsLeft+1):remainMin;

  let planStatus='green';
  if(totalStops>0&&stintMinM>0&&avgStintAvail<stintMinM)planStatus='red';
  else if(totalStops>0&&stintMinM>0&&avgStintAvail<stintMinM*1.25)planStatus='yellow';

  const computed=_enComputeEstimatedClassification();
  let rivals=[];
  if(computed?.estimated?.length){
    // Si mi equipo está en boxes ahora mismo, _enComputeEstimatedClassification
    // lo excluye de `estimated` (onTrack=eq.filter(e=>!e.pit)) y myEst es undefined.
    // No hay que asumir gap=0 en ese caso (me pondría como líder falsamente) —
    // se cae al orden de clasificación estimada (más cercanos al líder primero).
    const myEst=computed.estimated.find(e=>e.dorsal===myDorsal);
    const myGap=myEst?.estimatedGap;
    rivals=computed.estimated
      .filter(e=>e.dorsal!==myDorsal)
      .sort((a,b)=>myGap!=null
        ?Math.abs(a.estimatedGap-myGap)-Math.abs(b.estimatedGap-myGap)
        :a.estimatedGap-b.estimatedGap)
      .slice(0,5)
      .map(e=>({
        pos:          e.pos,
        estimatedGap: Math.round(e.estimatedGap*10)/10,
        stopsLeft:    e.diff,
        quality:      e.quality,
        avg5:         e.avg5?Math.round(e.avg5*100)/100:null,
      }));
  }

  const goodInQueue=EnBox.queue.filter(k=>k.quality==='good').length;
  const pilotName=cfg.pilotos?.[EnSession.currentPilot]?.name||null;

  return {
    remainingMin: remainMin>0?Math.round(remainMin*10)/10:null,
    myTeam:{
      pos:            myK.pos||null,
      inPit:          myK.pit===true,
      stops:          myStops,
      stopsLeft,
      avgStintAvailMin: totalStops>0&&avgStintAvail>0?Math.round(avgStintAvail*10)/10:null,
      planStatus,
      currentPilot:   pilotName,
    },
    boxQueue:{ totalInQueue: EnBox.queue.length, goodInQueue },
    rivals,
  };
}

// ── Fetch autenticado al endpoint serverless ─────────────────────────────
// Mismo patrón que src/supabase.js: JWT de la sesión Supabase del cliente
// como Bearer token; el endpoint verifica el usuario y guarda la key de
// Anthropic solo como env var de Vercel (nunca llega al navegador).
async function _enFetchAiEngineer(type, snapshot, question){
  const token=(await window.supabaseClient?.auth?.getSession())?.data?.session?.access_token;
  if(!token)throw new Error('Sin sesión de Supabase');
  // Timeout explícito: sin esto, una red inestable en boxes puede dejar el fetch
  // colgado indefinidamente y con él _enAiEngineer.fetching=true para siempre
  // (bloquea el disparo automático y el botón "Actualizar" el resto de la carrera).
  const controller=new AbortController();
  const timeoutId=setTimeout(()=>controller.abort(), 20000);
  try {
    const res=await fetch('/api/ai-engineer', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+token },
      body:JSON.stringify({ type, snapshot, question }),
      signal:controller.signal,
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'Error del servidor');
    return data.message;
  } catch(e){
    if(e.name==='AbortError')throw new Error('Tiempo de espera agotado');
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Boletín periódico ─────────────────────────────────────────────────────
// Se invoca en cada tick de _enRender() (independiente de la pestaña activa)
// pero solo construye snapshot y llama a la API cada BULLETIN_INTERVAL_MS.
function _enMaybeFetchBulletin(){
  if(_enAiEngineer.fetching)return;
  const now=Date.now();
  if(_enAiEngineer.lastBulletinAt&&now-_enAiEngineer.lastBulletinAt<_enAiEngineer.BULLETIN_INTERVAL_MS)return;

  const snapshot=_enBuildAiSnapshot();
  if(!snapshot)return;

  _enAiEngineer.fetching=true;
  _enFetchAiEngineer('bulletin', snapshot)
    .then(msg=>{
      _enAiEngineer.lastBulletin=msg;
      _enAiEngineer.lastBulletinAt=Date.now();
      _enAiEngineer.lastError=null;
    })
    .catch(err=>{ _enAiEngineer.lastError=err.message; })
    .finally(()=>{
      _enAiEngineer.fetching=false;
      const el=document.getElementById('en-adv-ai-engineer');
      if(el)el.innerHTML=_enRenderAiEngineerPanel(true);
    });
}

// Botón "Actualizar" — fuerza un boletín nuevo ignorando el intervalo
function _enForceBulletinNow(){
  _enAiEngineer.lastBulletinAt=null;
  _enMaybeFetchBulletin();
  const el=document.getElementById('en-adv-ai-engineer');
  if(el)el.innerHTML=_enRenderAiEngineerPanel(true);
}

// ── Panel HTML (pestaña Avanzado) ────────────────────────────────────────
// skipTrigger=true cuando el disparo ya lo hizo _enRender() globalmente
// (evita duplicar el chequeo de intervalo en cada pintado del panel).
function _enRenderAiEngineerPanel(skipTrigger){
  if(!skipTrigger)_enMaybeFetchBulletin();

  const ago=_enAiEngineer.lastBulletinAt
    ?Math.round((Date.now()-_enAiEngineer.lastBulletinAt)/60000)
    :null;

  let body;
  if(_enAiEngineer.fetching&&!_enAiEngineer.lastBulletin){
    body=`<div style="font-size:13.5px;color:var(--text-3);font-family:sans-serif">Generando primer boletín…</div>`;
  } else if(_enAiEngineer.lastBulletin){
    body=`<div style="font-size:13.5px;color:var(--text-1);font-family:sans-serif;line-height:1.5">${_esc(_enAiEngineer.lastBulletin)}</div>
      <div style="font-size:11px;color:var(--text-3);font-family:sans-serif;margin-top:8px">Hace ${ago===0?'menos de 1':ago} min${_enAiEngineer.fetching?' · actualizando…':''}</div>`;
  } else if(_enAiEngineer.lastError){
    body=`<div style="font-size:12.5px;color:#ef4444;font-family:sans-serif">Error: ${_esc(_enAiEngineer.lastError)}</div>`;
  } else {
    body=`<div style="font-size:12.5px;color:var(--text-3);font-family:sans-serif">Esperando datos de carrera…</div>`;
  }

  return `<div style="padding:0 14px 14px"><div style="background:#13141a;border:0.5px solid #1a1b22;border-radius:10px;padding:14px 16px;margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-size:13.5px;font-weight:500;color:var(--text-1);font-family:sans-serif">🎙️ Ingeniero de pista</div>
      <button onclick="_enForceBulletinNow()" style="font-size:11px;color:#F5A623;border:0.5px solid #F5A623;background:#F5A62318;border-radius:5px;padding:3px 8px;cursor:pointer;font-family:sans-serif">Actualizar</button>
    </div>
    ${body}
  </div></div>`;
}

if (typeof module !== 'undefined') {
  module.exports = { _enBuildAiSnapshot, _enAiEngineer };
}
