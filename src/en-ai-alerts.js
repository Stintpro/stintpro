// ── en-ai-alerts.js — fragmento de endurance.js ──
// Alertas por evento del ingeniero de pista: a diferencia del boletín (100%
// manual), estas SÍ se disparan solas — es el propósito de una alerta — pero
// acotadas: la detección de los 4 eventos es un diff barato en local (sin
// llamar a la IA) y solo cuando cruza un umbral real se construye snapshot y
// se llama a Claude (tipo 'alert', Haiku 4.5 en api/ai-engineer.js). Cada tipo
// tiene su propio cooldown para no repetir la misma alerta cada pocos segundos.
// Aviso visual: parpadeo naranja en la pestaña "Avanzado" (ver _enMarkAlertUnread),
// no un toast — así se nota estés en la pestaña que estés, sin interrumpir.

const _enAiAlerts = {
  enabled:          false, // toggle maestro: alertas automáticas OFF por defecto (evita gasto de API en pruebas)
  log:              [],   // {ts, text} más reciente primero, máx 15
  fetching:         false,
  cooldowns:        {},   // type -> timestamp del último disparo
  COOLDOWN_MS:      4*60*1000, // 4 min por tipo
  trackAvgHistory:  [],   // {ts, avg} ring buffer para detectar subida colectiva (lluvia)
  gapHistory:       {},   // dorsal -> [{ts, gap}] ring buffer para detectar rival recortando
  unread:           false, // controla el parpadeo de la pestaña Avanzado
};

// Restaura la preferencia guardada — persiste entre reinicios de la app.
// Si nunca se activó (localStorage vacío) → queda desactivado (default seguro).
try { _enAiAlerts.enabled = localStorage.getItem('stintpro_ai_alerts_enabled')==='1'; } catch(e){}

// Activa/desactiva las alertas automáticas de la IA y guarda la preferencia.
function _enToggleAiAlerts(){
  _enAiAlerts.enabled=!_enAiAlerts.enabled;
  try { localStorage.setItem('stintpro_ai_alerts_enabled', _enAiAlerts.enabled?'1':'0'); } catch(e){}
  if(!_enAiAlerts.enabled)_enClearAlertBlink(); // al apagar, corta el parpadeo pendiente
  _enRepaintAiPanel(document.getElementById('en-adv-ai-engineer'));
}

function _enClearAlertBlink(){
  _enAiAlerts.unread=false;
  const tab=document.getElementById('en-tab-adv');
  if(tab)tab.classList.remove('en-tab-alert');
}

function _enMarkAlertUnread(){
  _enAiAlerts.unread=true;
  const tab=document.getElementById('en-tab-adv');
  if(tab&&EnUi.tab!=='adv')tab.classList.add('en-tab-alert');
}

// ── Detección de eventos (sin llamar a la IA) — se llama en cada tick de
// _enRender(), independiente de la pestaña activa, para que siga vigilando
// aunque no se esté mirando Avanzado. Dispara como mucho una alerta por tick.
function _enCheckAlerts(eq, trackAvg){
  if(!_enAiAlerts.enabled)return; // toggle maestro apagado (p. ej. en pruebas) → ni detección ni llamadas
  if(_enAiAlerts.fetching)return; // solo una alerta en curso a la vez
  if(!eq||!eq.length||!trackAvg)return;
  const cfg=window.AppState?.config||{};
  const myDorsal=cfg.myDorsal;
  if(!myDorsal)return;
  const now=Date.now();
  const onCooldown=(type)=>_enAiAlerts.cooldowns[type]&&(now-_enAiAlerts.cooldowns[type]<_enAiAlerts.COOLDOWN_MS);

  // 1) Subida colectiva de tiempos → probable lluvia: trackAvg (mediana del pelotón)
  // sube de forma sostenida frente a una muestra de hace 9-15 min.
  _enAiAlerts.trackAvgHistory.push({ts:now, avg:trackAvg});
  while(_enAiAlerts.trackAvgHistory.length&&now-_enAiAlerts.trackAvgHistory[0].ts>15*60*1000)
    _enAiAlerts.trackAvgHistory.shift();
  if(!onCooldown('rain')){
    const baseline=_enAiAlerts.trackAvgHistory.find(s=>now-s.ts>=9*60*1000);
    if(baseline&&trackAvg-baseline.avg>1.5){
      _enFireAlert('rain', {
        trackAvgNowS:    Math.round(trackAvg*100)/100,
        trackAvgBeforeS: Math.round(baseline.avg*100)/100,
        minutesAgo:      Math.round((now-baseline.ts)/60000),
      });
      return;
    }
  }

  // 2) Rival en deuda crítica de paradas (atrapado): mismo cálculo que la
  // ventana "puede/tiene que parar" de la pestaña Estrategia (en-strategy.js) —
  // la deuda obliga a salir ANTES de cumplir el stint mínimo propio del rival.
  const stintMinMs=(cfg.stintMin||0)*60*1000;
  const stintMaxMs=(cfg.stintMax||999)*60*1000;
  const remainMsAll=window.ApexClock&&!window.ApexClock.isCountUp()?window.ApexClock.remainingMs():0;
  if(!onCooldown('trapped')&&EnBox.totalStops&&remainMsAll>0&&stintMaxMs<999*60*1000){
    for(const e of eq){
      if(e.pit||e.dorsal===myDorsal||!(e.standsCount>0))continue;
      const pitOutTime=EnSession.rivalPitOut[e.dorsal];
      if(!pitOutTime)continue;
      const elapsed=now-pitOutTime;
      const stopsLeft=Math.max(0,EnBox.totalStops-e.standsCount);
      if(stopsLeft<=0)continue;
      const cap=elapsed+remainMsAll-stopsLeft*(EnBox.pitDuration*1000+stintMinMs);
      const capMs=Math.max(0,Math.min(stintMaxMs,cap));
      const minLeft=Math.ceil(Math.max(0,capMs-elapsed)/60000);
      const canPitNow=stintMinMs<=0||elapsed>=stintMinMs;
      const minUntilCanPit=canPitNow?0:Math.ceil((stintMinMs-elapsed)/60000);
      if(!canPitNow&&minLeft<=minUntilCanPit){
        _enFireAlert('trapped', {
          rivalPos:              e.pos||null,
          rivalDorsal:           e.dorsal,
          minutesUntilMustStop:  minLeft,
          minutesUntilAllowedMin:minUntilCanPit,
        });
        return;
      }
    }
  }

  // 3) Rival recortando con kart bueno: el gap estimado (ya corregido por
  // paradas pendientes) se cierra de forma sostenida en los últimos ~3 min.
  if(!onCooldown('closing')){
    const computed=_enComputeEstimatedClassification();
    const myEst=computed?.estimated?.find(e=>e.dorsal===myDorsal);
    if(myEst){
      for(const r of computed.estimated){
        if(r.dorsal===myDorsal)continue;
        const gapNow=r.estimatedGap-myEst.estimatedGap; // negativo = por delante, positivo = por detrás
        const hist=_enAiAlerts.gapHistory[r.dorsal]=_enAiAlerts.gapHistory[r.dorsal]||[];
        hist.push({ts:now, gap:gapNow});
        while(hist.length&&now-hist[0].ts>4*60*1000)hist.shift();
        if(r.quality!=='good')continue;
        const baseline=hist.find(s=>now-s.ts>=2.5*60*1000);
        if(!baseline)continue;
        const closedS=baseline.gap-gapNow; // positivo = se ha acercado
        if(closedS>1.5&&Math.abs(gapNow)<20){
          _enFireAlert('closing', {
            rivalPos:     r.pos||null,
            rivalDorsal:  r.dorsal,
            estimatedGapS:Math.round(gapNow*10)/10,
            stopsLeft:    r.diff,
            closedLastMinS:Math.round(closedS*10)/10,
          });
          return;
        }
      }
    }
  }

  // 4) Ventana buena de parada: cola del box favorable Y ya cumplo mi stint mínimo.
  if(!onCooldown('window')){
    const myK=eq.find(e=>e.dorsal===myDorsal);
    if(myK&&!myK.pit&&EnSession.stintStart&&!EnSession.stintFrozen){
      const myElapsed=now-EnSession.stintStart;
      const myCanPit=stintMinMs<=0||myElapsed>=stintMinMs;
      const queue=EnBox.queue||[];
      const goodInQueue=queue.filter(k=>k.quality==='good').length;
      const goodRatio=queue.length?goodInQueue/queue.length:0;
      if(myCanPit&&queue.length>=2&&goodRatio>=0.6){
        _enFireAlert('window', { goodInQueue, totalInQueue:queue.length });
        return;
      }
    }
  }
}

// ── Dispara la llamada a la IA para un evento ya detectado localmente ────
function _enFireAlert(type, details){
  const snapshot=_enBuildAiSnapshot();
  if(!snapshot)return;
  snapshot.triggerEvent={ type, ...details };
  _enAiAlerts.cooldowns[type]=Date.now();
  _enAiAlerts.fetching=true;
  _enFetchAiEngineer('alert', snapshot)
    .then(msg=>{
      _enAiAlerts.log.unshift({ ts:Date.now(), text:msg });
      if(_enAiAlerts.log.length>15)_enAiAlerts.log.length=15;
      _enMarkAlertUnread();
    })
    .catch(err=>{ console.error('[StintPro] Error alerta IA:', err.message); })
    .finally(()=>{
      _enAiAlerts.fetching=false;
      _enRepaintAiPanel(document.getElementById('en-adv-ai-engineer'));
    });
}

// ── Log de alertas recientes (se pinta dentro del panel del ingeniero de pista) ──
function _enRenderAlertsLog(){
  if(!_enAiAlerts.log.length)return '';
  const rows=_enAiAlerts.log.map(a=>{
    const ago=Math.round((Date.now()-a.ts)/60000);
    return `<div style="padding:8px 0;border-bottom:0.5px solid #1a1b22">
      <div style="font-size:13px;color:var(--text-1);font-family:sans-serif;line-height:1.4">${_esc(a.text)}</div>
      <div style="font-size:10.5px;color:var(--text-3);font-family:sans-serif;margin-top:3px">Hace ${ago===0?'menos de 1':ago} min</div>
    </div>`;
  }).join('');
  return `<div style="padding:0 14px 14px"><div style="background:#13141a;border:0.5px solid #1a1b22;border-radius:10px;padding:14px 16px">
    <div style="font-size:13.5px;font-weight:500;color:var(--text-1);font-family:sans-serif;margin-bottom:6px">🔔 Alertas recientes</div>
    ${rows}
  </div></div>`;
}

if (typeof module !== 'undefined') {
  module.exports = { _enAiAlerts, _enCheckAlerts };
}
