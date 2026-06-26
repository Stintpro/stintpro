// ── en-team.js — fragmento de endurance.js ──
// ── Edición de stints ────────────────────────────────────────────────────
function _enDeleteStint(idx){
  if(idx<0||idx>=EnSession.stintHistory.length)return;
  const s=EnSession.stintHistory[idx];
  let overlay=document.getElementById('en-pilot-overlay');
  if(overlay)overlay.remove();
  overlay=document.createElement('div');
  overlay.id='en-pilot-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:999;';
  overlay.innerHTML=`
    <div style="background:#1a1b22;border:0.5px solid #2a2b2e;border-radius:12px;padding:24px;max-width:320px;width:90%;text-align:center">
      <div style="font-size:14px;font-weight:500;color:#d0d2db;margin-bottom:8px;font-family:sans-serif">🗑 Borrar stint #${idx+1}</div>
      <div style="font-size:12px;color:#9ca3af;margin-bottom:6px;font-family:sans-serif">${s.pilot} · ${_enFmtStint(s.durationMs)}</div>
      <div style="font-size:11px;color:#ef4444;margin-bottom:18px;font-family:sans-serif">Esta acción no se puede deshacer</div>
      <div style="display:flex;gap:8px">
        <button onclick="_enDismissOverlay()" style="flex:1;padding:8px;border-radius:6px;border:0.5px solid #2a2b2e;background:transparent;color:#555;font-size:12px;cursor:pointer;font-family:sans-serif">Cancelar</button>
        <button onclick="_enConfirmDeleteStint(${idx})" style="flex:1;padding:8px;border-radius:6px;border:0.5px solid #ef4444;background:#ef444418;color:#ef4444;font-size:12px;cursor:pointer;font-family:sans-serif">Borrar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function _enConfirmDeleteStint(idx){
  if(idx>=0&&idx<EnSession.stintHistory.length){
    EnSession.stintHistory.splice(idx,1);
  }
  _enDismissOverlay();
  _enRender();
}

function _enStintDetail(idx){
  if(idx<0||idx>=EnSession.stintHistory.length)return;
  const s=EnSession.stintHistory[idx];
  const laps=s.lapTimes||[];
  const best=laps.length?Math.min(...laps):s.best;
  const avg=laps.length?laps.reduce((a,b)=>a+b,0)/laps.length:null;
  const avg5=laps.length>=5?laps.slice(-5).reduce((a,b)=>a+b,0)/5:avg;
  const cons=laps.length>=3?Math.max(...laps.slice(-5))-Math.min(...laps.slice(-5)):null;

  let overlay=document.getElementById('en-pilot-overlay');
  if(overlay)overlay.remove();
  overlay=document.createElement('div');
  overlay.id='en-pilot-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:999;';

  let lapRows='';
  laps.forEach((l,i)=>{
    const isBest=l===best;
    const col=isBest?'#22c55e':avg&&l>avg+1?'#ef4444':avg&&l<avg-0.3?'#60a5fa':'#9ca3af';
    lapRows+=`<div style="display:flex;justify-content:space-between;padding:3px 8px;border-radius:4px;background:${isBest?'#22c55e11':'transparent'}">
      <span style="font-size:11px;color:#555">${i+1}</span>
      <span style="font-size:12px;color:${col};font-family:monospace;font-weight:${isBest?'600':'400'}">${_enFmt(l)}${isBest?' ★':''}</span>
    </div>`;
  });

  const posIn=s.posIn||'—';
  const posOut=s.posOut||'—';
  const posChange=s.posIn&&s.posOut?s.posIn-s.posOut:0;
  const posStr=posChange>0?`<span style="color:#22c55e">↑${posChange}</span>`:posChange<0?`<span style="color:#ef4444">↓${Math.abs(posChange)}</span>`:'<span style="color:#555">=</span>';

  overlay.innerHTML=`
    <div style="background:#13141a;border:0.5px solid #2a2b2e;border-radius:12px;padding:24px;max-width:400px;width:95%;max-height:85vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div>
          <div style="font-size:16px;font-weight:600;color:#d0d2db;font-family:sans-serif">📊 Stint #${idx+1}</div>
          <div style="font-size:12px;color:#5b8dee;font-family:sans-serif;margin-top:2px">${s.pilot}</div>
        </div>
        <button onclick="_enDismissOverlay()" style="background:none;border:none;color:#555;font-size:18px;cursor:pointer;padding:4px">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
        <div style="background:#0e0f11;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:9px;color:#555;text-transform:uppercase;margin-bottom:3px">Duración</div>
          <div style="font-size:16px;font-weight:500;color:#d0d2db;font-family:monospace">${_enFmtStint(s.durationMs)}</div>
        </div>
        <div style="background:#0e0f11;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:9px;color:#555;text-transform:uppercase;margin-bottom:3px">Posición</div>
          <div style="font-size:16px;font-weight:500;color:#d0d2db;font-family:monospace">P${posIn}→P${posOut} ${posStr}</div>
        </div>
        <div style="background:#0e0f11;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:9px;color:#555;text-transform:uppercase;margin-bottom:3px">Vueltas</div>
          <div style="font-size:16px;font-weight:500;color:#5b8dee;font-family:monospace">${laps.length}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
        <div style="background:#0e0f11;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:9px;color:#555;text-transform:uppercase;margin-bottom:3px">Mejor</div>
          <div style="font-size:16px;font-weight:500;color:#22c55e;font-family:monospace">${best?_enFmt(best):'—'}</div>
        </div>
        <div style="background:#0e0f11;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:9px;color:#555;text-transform:uppercase;margin-bottom:3px">M5v</div>
          <div style="font-size:16px;font-weight:500;color:#d0d2db;font-family:monospace">${avg5?_enFmt(avg5):'—'}</div>
        </div>
        <div style="background:#0e0f11;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:9px;color:#555;text-transform:uppercase;margin-bottom:3px">Consist.</div>
          <div style="font-size:16px;font-weight:500;color:${cons&&cons<0.5?'#22c55e':cons&&cons<1?'#fbbf24':'#ef4444'};font-family:monospace">${cons?cons.toFixed(2)+'s':'—'}</div>
        </div>
      </div>

      ${laps.length?`
      <div style="font-size:10px;color:#3a3b42;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;padding-top:10px;border-top:0.5px solid #1a1b22">Listado de vueltas</div>
      <div style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:1px">
        ${lapRows}
      </div>
      `:'<div style="font-size:11px;color:#555;text-align:center;padding:12px">Sin datos de vueltas para este stint</div>'}

      ${s.pitTime?`<div style="font-size:11px;color:#555;text-align:center;margin-top:10px;padding-top:8px;border-top:0.5px solid #1a1b22">Parada: ${_enFmtStint(s.pitTime)}</div>`:''}
    </div>`;
  document.body.appendChild(overlay);
}

function _enEditStintPilot(stintIdx){
  const cfg=window.AppState?.config;
  const pilotos=cfg?.pilotos||[];
  if(!pilotos.length)return;
  const colors=['#5b8dee','#22c55e','#f97316','#c084fc','#f87171','#fbbf24'];
  const stint=EnSession.stintHistory[stintIdx];
  if(!stint)return;

  const durMin=Math.floor((stint.durationMs||0)/60000);
  const durSec=Math.floor(((stint.durationMs||0)%60000)/1000);
  const pitMin=Math.floor((stint.pitStopMs||0)/60000);
  const pitSec=Math.floor(((stint.pitStopMs||0)%60000)/1000);

  let overlay=document.getElementById('en-pilot-overlay');
  if(overlay)overlay.remove();
  overlay=document.createElement('div');
  overlay.id='en-pilot-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:999;';
  overlay.innerHTML=`
    <div style="background:#1a1b22;border:0.5px solid #2a2b2e;border-radius:12px;padding:24px;max-width:360px;width:90%;">
      <div style="font-size:14px;font-weight:500;color:#d0d2db;margin-bottom:14px;font-family:sans-serif">✏️ Editar stint #${stintIdx+1}</div>
      <div style="font-size:11px;color:#666;margin-bottom:6px;font-family:sans-serif">Piloto</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
        ${pilotos.map((p,i)=>`
          <button id="en-edit-pilot-${i}" onclick="document.querySelectorAll('[id^=en-edit-pilot]').forEach(b=>b.style.borderColor='#2a2b2e');this.style.borderColor='${colors[i%colors.length]}';document.getElementById('en-edit-pidx').value=${i}" style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;border:1.5px solid ${i===stint.pilotIdx?colors[i%colors.length]:'#2a2b2e'};background:#13141a;cursor:pointer;font-size:12px;color:#d0d2db;font-family:sans-serif">
            <div style="width:20px;height:20px;border-radius:50%;background:${colors[i%colors.length]};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff">${p.name.charAt(0)}</div>
            ${p.name}
          </button>
        `).join('')}
      </div>
      <input type="hidden" id="en-edit-pidx" value="${stint.pilotIdx}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
        <div>
          <div style="font-size:11px;color:#666;margin-bottom:4px;font-family:sans-serif">Duración stint</div>
          <div style="display:flex;gap:4px;align-items:center">
            <input type="number" id="en-edit-durmin" value="${durMin}" min="0" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:6px;border-radius:4px;font-size:12px;width:50px;font-family:monospace;text-align:right">
            <span style="color:#555;font-size:11px">m</span>
            <input type="number" id="en-edit-dursec" value="${durSec}" min="0" max="59" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:6px;border-radius:4px;font-size:12px;width:50px;font-family:monospace;text-align:right">
            <span style="color:#555;font-size:11px">s</span>
          </div>
        </div>
        <div>
          <div style="font-size:11px;color:#666;margin-bottom:4px;font-family:sans-serif">Parada pit</div>
          <div style="display:flex;gap:4px;align-items:center">
            <input type="number" id="en-edit-pitmin" value="${pitMin}" min="0" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:6px;border-radius:4px;font-size:12px;width:50px;font-family:monospace;text-align:right">
            <span style="color:#555;font-size:11px">m</span>
            <input type="number" id="en-edit-pitsec" value="${pitSec}" min="0" max="59" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:6px;border-radius:4px;font-size:12px;width:50px;font-family:monospace;text-align:right">
            <span style="color:#555;font-size:11px">s</span>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="_enApplyStintEdit(${stintIdx})" style="flex:1;padding:8px;border-radius:6px;border:0.5px solid #5b8dee;background:#5b8dee22;color:#5b8dee;font-size:11px;cursor:pointer;font-family:sans-serif">Guardar</button>
        <button onclick="_enDismissOverlay()" style="flex:1;padding:8px;border-radius:6px;border:0.5px solid #2a2b2e;background:transparent;color:#555;font-size:11px;cursor:pointer;font-family:sans-serif">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function _enApplyStintEdit(stintIdx){
  const cfg=window.AppState?.config;
  const pilotos=cfg?.pilotos||[];
  const s=EnSession.stintHistory[stintIdx];
  if(!s)return;
  const pidx=parseInt(document.getElementById('en-edit-pidx')?.value)||0;
  if(pilotos[pidx]){s.pilot=pilotos[pidx].name; s.pilotIdx=pidx;}
  const durMin=parseInt(document.getElementById('en-edit-durmin')?.value)||0;
  const durSec=parseInt(document.getElementById('en-edit-dursec')?.value)||0;
  s.durationMs=(durMin*60+durSec)*1000;
  const pitMin=parseInt(document.getElementById('en-edit-pitmin')?.value)||0;
  const pitSec=parseInt(document.getElementById('en-edit-pitsec')?.value)||0;
  s.pitStopMs=(pitMin*60+pitSec)*1000;
  _enDismissOverlay();
  _enRender();
}

function _enAddStint(){
  const cfg=window.AppState?.config;
  const pilotos=cfg?.pilotos||[];
  if(!pilotos.length)return;
  const colors=['#5b8dee','#22c55e','#f97316','#c084fc','#f87171','#fbbf24'];

  let overlay=document.getElementById('en-pilot-overlay');
  if(overlay)overlay.remove();
  overlay=document.createElement('div');
  overlay.id='en-pilot-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:999;';
  overlay.innerHTML=`
    <div style="background:#1a1b22;border:0.5px solid #2a2b2e;border-radius:12px;padding:24px;max-width:360px;width:90%;">
      <div style="font-size:14px;font-weight:500;color:#d0d2db;margin-bottom:14px;font-family:sans-serif">➕ Añadir stint manual</div>
      <div style="font-size:11px;color:#666;margin-bottom:6px;font-family:sans-serif">Piloto</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
        ${pilotos.map((p,i)=>`
          <button id="en-add-pilot-${i}" onclick="document.querySelectorAll('[id^=en-add-pilot]').forEach(b=>b.style.borderColor='#2a2b2e');this.style.borderColor='${colors[i%colors.length]}';document.getElementById('en-add-pidx').value=${i}" style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;border:1.5px solid ${i===0?colors[0]:'#2a2b2e'};background:#13141a;cursor:pointer;font-size:12px;color:#d0d2db;font-family:sans-serif">
            <div style="width:20px;height:20px;border-radius:50%;background:${colors[i%colors.length]};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff">${p.name.charAt(0)}</div>
            ${p.name}
          </button>
        `).join('')}
      </div>
      <input type="hidden" id="en-add-pidx" value="0">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
        <div>
          <div style="font-size:11px;color:#666;margin-bottom:4px;font-family:sans-serif">Duración stint</div>
          <div style="display:flex;gap:4px;align-items:center">
            <input type="number" id="en-add-durmin" value="0" min="0" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:6px;border-radius:4px;font-size:12px;width:50px;font-family:monospace;text-align:right">
            <span style="color:#555;font-size:11px">m</span>
            <input type="number" id="en-add-dursec" value="0" min="0" max="59" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:6px;border-radius:4px;font-size:12px;width:50px;font-family:monospace;text-align:right">
            <span style="color:#555;font-size:11px">s</span>
          </div>
        </div>
        <div>
          <div style="font-size:11px;color:#666;margin-bottom:4px;font-family:sans-serif">Parada pit</div>
          <div style="display:flex;gap:4px;align-items:center">
            <input type="number" id="en-add-pitmin" value="0" min="0" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:6px;border-radius:4px;font-size:12px;width:50px;font-family:monospace;text-align:right">
            <span style="color:#555;font-size:11px">m</span>
            <input type="number" id="en-add-pitsec" value="0" min="0" max="59" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:6px;border-radius:4px;font-size:12px;width:50px;font-family:monospace;text-align:right">
            <span style="color:#555;font-size:11px">s</span>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="_enApplyAddStint()" style="flex:1;padding:8px;border-radius:6px;border:0.5px solid #5b8dee;background:#5b8dee22;color:#5b8dee;font-size:11px;cursor:pointer;font-family:sans-serif">Añadir</button>
        <button onclick="_enDismissOverlay()" style="flex:1;padding:8px;border-radius:6px;border:0.5px solid #2a2b2e;background:transparent;color:#555;font-size:11px;cursor:pointer;font-family:sans-serif">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function _enApplyAddStint(){
  const cfg=window.AppState?.config;
  const pilotos=cfg?.pilotos||[];
  const pidx=parseInt(document.getElementById('en-add-pidx')?.value)||0;
  if(!pilotos[pidx])return;
  const durMin=parseInt(document.getElementById('en-add-durmin')?.value)||0;
  const durSec=parseInt(document.getElementById('en-add-dursec')?.value)||0;
  const pitMin=parseInt(document.getElementById('en-add-pitmin')?.value)||0;
  const pitSec=parseInt(document.getElementById('en-add-pitsec')?.value)||0;
  EnSession.stintHistory.push({
    pilot:pilotos[pidx].name,
    pilotIdx:pidx,
    durationMs:(durMin*60+durSec)*1000,
    laps:0,
    avg:null,
    best:null,
    posIn:null,
    posOut:null,
    pitStopMs:(pitMin*60+pitSec)*1000,
    endTime:new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}),
  });
  _enDismissOverlay();
  _enRender();
}

// ── Historial de vueltas (click en consistencia) ─────────────────────────
function _enShowLapHistory(dorsal, ev){
  ev.stopPropagation();
  const kart=EnSession.data.equipos.find(e=>e.dorsal===dorsal);
  if(!kart||!kart.lapHistory||!kart.lapHistory.length)return;

  const trackAvg=_enTrackAvgLive(EnSession.data.equipos);
  const hist=kart.lapHistory.filter(t=>t<180);
  const best=Math.min(...hist);
  const worst=Math.max(...hist);
  const avg=hist.reduce((a,b)=>a+b,0)/hist.length;
  const range=worst-best;
  const cons=_enCons(kart.lapHistory);

  let overlay=document.getElementById('en-pilot-overlay');
  if(overlay)overlay.remove();
  overlay=document.createElement('div');
  overlay.id='en-pilot-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:999;';

  let lapsHtml='';
  hist.forEach((t,i)=>{
    let col='#9ca3af';
    if(trackAvg){
      const d=t-trackAvg;
      if(d<-0.5)col='#c084fc';
      else if(d<-0.2)col='#22c55e';
      else if(d>0.5)col='#ef4444';
      else if(d>0.2)col='#fbbf24';
    }
    const isBest=Math.abs(t-best)<0.001;
    const isWorst=Math.abs(t-worst)<0.001;
    lapsHtml+=`<div style="display:flex;justify-content:space-between;padding:3px 8px;border-radius:4px;${isBest?'background:#22c55e15;':''}${isWorst?'background:#ef444415;':''}">
      <span style="color:#555;font-size:10px;font-family:sans-serif">${hist.length-i}</span>
      <span style="color:${col};font-family:monospace;font-size:13px;font-weight:${isBest||isWorst?'600':'400'}">${_enFmt(t)}</span>
    </div>`;
  });

  const kc=_enKartColor(dorsal);
  const quality=_enEffectiveQuality(dorsal, kart, trackAvg);
  const qBadge=quality==='good'?'🟢':quality==='bad'?'🔴':'⚪';

  overlay.innerHTML=`
    <div style="background:#1a1b22;border:0.5px solid #2a2b2e;border-radius:12px;padding:24px;max-width:320px;width:90%;max-height:80vh;display:flex;flex-direction:column;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div style="width:32px;height:32px;border-radius:6px;background:${kc.bg};color:${kc.text};border:1.5px solid ${kc.border};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px">${dorsal}</div>
        <div style="flex:1">
          <div style="font-size:14px;color:#d0d2db;font-family:sans-serif">${kart.name}</div>
          <div style="font-size:10px;color:#555;font-family:sans-serif">${qBadge} ${cons?cons.label:'—'} · Rango: ${range.toFixed(3)}s</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
        <div style="text-align:center">
          <div style="font-size:10px;color:#333;font-family:sans-serif">Media</div>
          <div style="font-size:13px;color:#60a5fa;font-family:monospace">${_enFmt(avg)}</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:10px;color:#333;font-family:sans-serif">Mejor</div>
          <div style="font-size:13px;color:#22c55e;font-family:monospace">${_enFmt(best)}</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:10px;color:#333;font-family:sans-serif">Peor</div>
          <div style="font-size:13px;color:#ef4444;font-family:monospace">${_enFmt(worst)}</div>
        </div>
      </div>
      <div style="font-size:10px;color:#333;margin-bottom:6px;font-family:sans-serif">Últimas ${hist.length} vueltas (reciente arriba)</div>
      <div style="overflow-y:auto;flex:1;display:flex;flex-direction:column-reverse;gap:2px">
        ${lapsHtml}
      </div>
      <button onclick="_enDismissOverlay()" style="width:100%;margin-top:12px;padding:8px;border-radius:6px;border:0.5px solid #2a2b2e;background:transparent;color:#555;font-size:11px;cursor:pointer;font-family:sans-serif">Cerrar</button>
    </div>`;
  document.body.appendChild(overlay);
}

// ── Cambio manual (botón) ────────────────────────────────────────────────
function _enChangePilot(){
  const cfg=window.AppState?.config;
  const pilotos=cfg?.pilotos||[];
  const myDorsal=cfg?.myDorsal;
  const myK=EnSession.data.equipos.find(e=>e.dorsal===myDorsal);

  // Guardar stint actual
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
      avg:_enAvg5(myK?.lapHistory),
      best:EnSession.stintBestLap,
      posIn:EnSession.posIn,
      posOut:myK?.pos||null,
      endTime:new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}),
    });
  }

  // Resetear stint
  EnSession.stintStart=Date.now();
  EnSession.stintFrozen=null;
  EnSession.data._stintStartTours=myK?.tours||0;
  EnSession.posIn=myK?.pos||null;
  EnSession.stintBestLap=null;
  EnSession.stintLapTimes=[];
  EnSession.data._lastMyLap=null;

  _enShowPilotSelect(false);
}

// ── Render vista equipo ──────────────────────────────────────────────────
function _enRenderTeamConfig(){
  return `<div class="en-team-card" style="padding:10px 14px">
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:12.5px;color:#666;font-family:sans-serif">Mínimo por piloto:</span>
        <input type="number" value="${EnBox.pilotMinTime}" min="0" placeholder="min" onchange="_enSetPilotMinTime(this.value)" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:4px 8px;border-radius:4px;font-size:12.5px;width:60px;font-family:monospace;text-align:right">
        <span style="font-size:10px;color:#555;font-family:sans-serif">min</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:12.5px;color:#666;font-family:sans-serif">Paradas obligatorias:</span>
        <input type="number" value="${EnBox.totalStops}" min="0" placeholder="total" onchange="_enSetTotalStops(this.value)" style="background:#0e0f11;border:0.5px solid #2a2b2e;color:#9ca3af;padding:4px 8px;border-radius:4px;font-size:12.5px;width:60px;font-family:monospace;text-align:right">
        <span style="font-size:10px;color:#555;font-family:sans-serif">total carrera</span>
      </div>
    </div>
  </div>`;
}

function _enSetPilotMinTime(v){EnBox.pilotMinTime=parseInt(v)||0;}
function _enSetTotalStops(v){EnBox.totalStops=parseInt(v)||0;}

function _enRenderTeam(myKart, trackAvg){
  const cfg=window.AppState?.config;
  const pilotos=cfg?.pilotos||[];
  const currentPilot=pilotos[EnSession.currentPilot]||{name:'Sin definir'};
  const stintMs=EnSession.stintFrozen?EnSession.stintFrozen:(EnSession.stintStart?(Date.now()-EnSession.stintStart):0);
  const stintLaps=_enStintLaps(myKart);
  const colors=['#5b8dee','#22c55e','#f97316','#c084fc','#f87171','#fbbf24'];

  let html='';

  // ── Piloto actual ──────────────────────────────────────────
  html+=`<div class="en-team-card">
    <div class="en-team-title">Piloto en pista</div>
    <div class="en-pilot-current">
      <div class="en-pilot-avatar" style="background:${colors[EnSession.currentPilot%colors.length]}">${currentPilot.name.charAt(0)}</div>
      <div class="en-pilot-info">
        <div class="en-pilot-name">${currentPilot.name}</div>
        <div class="en-pilot-sub">Stint: ${_enFmtStint(stintMs)}${myKart?' · P'+myKart.pos:''}${EnSession.posIn?' (entró P'+EnSession.posIn+')':''}${EnSession.stintBestLap?' · Best: '+_enFmt(EnSession.stintBestLap):''}</div>
      </div>
      <button class="en-change-btn" style="background:#5b8dee;color:#fff" onclick="_enChangePilot()">🔄 Cambio</button>
    </div>
  </div>`;

  // ── Cola de pilotos ────────────────────────────────────────
  if(pilotos.length>1){
    html+=`<div class="en-team-card">
      <div class="en-team-title">Cola de pilotos</div>`;
    const queueOrder=[];
    for(let i=1;i<pilotos.length;i++){
      const idx=(EnSession.currentPilot+i)%pilotos.length;
      queueOrder.push(idx);
    }
    queueOrder.forEach((idx,i)=>{
      const p=pilotos[idx];
      const stints=EnSession.stintHistory.filter(s=>s.pilotIdx===idx);
      const totalMs=stints.reduce((a,s)=>a+s.durationMs,0);
      const totalLaps=stints.reduce((a,s)=>a+s.laps,0);
      html+=`<div class="en-queue-item">
        <div class="en-queue-num" style="${i===0?'background:#5b8dee;color:#fff':''}">${i+1}</div>
        <div class="en-queue-name" style="${i===0?'color:#d0d2db;font-weight:500':''}">${p.name}${i===0?' ← siguiente':''}</div>
        <div class="en-queue-stat">${stints.length}st · ${totalLaps}v · ${_enFmtStint(totalMs)}</div>
      </div>`;
    });
    html+=`</div>`;
  }

  // ── Historial de stints ────────────────────────────────────
  html+=`<div class="en-team-card">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="en-team-title">Historial de stints</div>
      <button onclick="_enAddStint()" style="font-size:10px;padding:3px 10px;border-radius:4px;border:0.5px solid #2a2b2e;background:#1a1b22;color:#666;cursor:pointer;font-family:sans-serif">➕ Añadir</button>
    </div>`;
  if(EnSession.stintHistory.length===0){
    html+=`<div style="color:#333;font-size:12px;font-family:sans-serif;padding:8px 0">Sin stints completados todavía</div>`;
  } else {
    html+=`<div class="en-stint-row en-stint-head">
      <span>#</span><span>Piloto</span><span>Stint</span><span>Pit</span><span>Media</span><span>Mejor</span><span>Pos</span><span></span>
    </div>`;
    EnSession.stintHistory.forEach((s,i)=>{
      const col=colors[s.pilotIdx%colors.length];
      const posStr=s.posIn&&s.posOut?`P${s.posIn}→P${s.posOut}`:(s.posIn?`P${s.posIn}`:'—');
      const posCol=s.posIn&&s.posOut?(s.posOut<s.posIn?'#22c55e':s.posOut>s.posIn?'#ef4444':'#6b7280'):'#6b7280';
      const pitStr=s.pitStopMs?_enFmtStint(s.pitStopMs):'—';
      html+=`<div class="en-stint-row">
        <span style="color:${col};font-weight:600">${i+1}</span>
        <span style="color:#9ca3af">${s.pilot}</span>
        <span style="color:#6b7280">${_enFmtStint(s.durationMs)}</span>
        <span style="color:#555">${pitStr}</span>
        <span style="color:#6b7280">${s.avg?_enFmt(s.avg):'—'}</span>
        <span style="color:#22c55e">${s.best?_enFmt(s.best):'—'}</span>
        <span style="color:${posCol};font-size:10px">${posStr}</span>
        <span style="display:flex;gap:2px">
          <button onclick="_enStintDetail(${i})" style="font-size:9px;background:none;border:none;color:#60a5fa;cursor:pointer;padding:2px" title="Detalle del stint">📊</button>
          <button onclick="_enEditStintPilot(${i})" style="font-size:9px;background:none;border:none;color:#5b8dee;cursor:pointer;padding:2px" title="Editar stint">✏️</button>
          <button onclick="_enDeleteStint(${i})" style="font-size:9px;background:none;border:none;color:#555;cursor:pointer;padding:2px" title="Borrar stint">🗑</button>
        </span>
      </div>`;
    });
  }
  html+=`</div>`;

  // ── Estrategia de paradas ────────────────────────────────────
  if(EnBox.totalStops>0){
    const stopsDone=EnSession.stintHistory.length;
    const stopsRemaining=Math.max(0,EnBox.totalStops-stopsDone);
    const cfg=window.AppState?.config;
    const stintMaxMin=(cfg?.stintMax||999);
    const stintMaxMs2=stintMaxMin*60*1000;

    // Tiempo restante de carrera
    let raceRemainingMs=0;
    if(window.ApexClock&&window.ApexClock._synced&&!window.ApexClock.isCountUp()){
      raceRemainingMs=Math.max(0,window.ApexClock.remainingMs());
    }
    const raceRemainingMin=Math.round(raceRemainingMs/60000);

    // Paradas mínimas necesarias para cubrir el tiempo restante
    const minNecessary=stintMaxMin<999?Math.ceil(raceRemainingMin/stintMaxMin):stopsRemaining;
    const strategic=Math.max(0,stopsRemaining-minNecessary);

    // Stint medio necesario
    const avgStintNeeded=stopsRemaining>0?Math.round(raceRemainingMin/stopsRemaining):0;

    // Colores
    const stratColor=strategic>0?'#22c55e':'#fbbf24';
    const avgColor=avgStintNeeded<stintMaxMin*0.7?'#22c55e':avgStintNeeded<stintMaxMin?'#fbbf24':'#ef4444';

    html+=`<div class="en-team-card">
      <div class="en-strat-title">Estrategia de paradas</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;text-align:center">
        <div>
          <div style="font-size:10px;color:#555;font-family:sans-serif">Hechas</div>
          <div style="font-size:22px;font-weight:600;color:#9ca3af;font-family:monospace">${stopsDone}/${EnBox.totalStops}</div>
        </div>
        <div>
          <div style="font-size:10px;color:#555;font-family:sans-serif">Restantes</div>
          <div style="font-size:22px;font-weight:600;color:#60a5fa;font-family:monospace">${stopsRemaining}</div>
        </div>
        <div>
          <div style="font-size:10px;color:#555;font-family:sans-serif">Estratégicas</div>
          <div style="font-size:22px;font-weight:600;color:${stratColor};font-family:monospace">${strategic}</div>
        </div>
        <div>
          <div style="font-size:10px;color:#555;font-family:sans-serif">Stint medio</div>
          <div style="font-size:22px;font-weight:600;color:${avgColor};font-family:monospace">${avgStintNeeded}m</div>
          <div style="font-size:9px;color:#555;font-family:sans-serif">máx ${stintMaxMin}m</div>
        </div>
      </div>
      ${strategic>0?`<div style="margin-top:10px;padding:6px 10px;border-radius:6px;background:#22c55e11;border:0.5px solid #22c55e33">
        <span style="font-size:11px;color:#22c55e;font-family:sans-serif">🎯 Tienes <b>${strategic}</b> parada${strategic>1?'s':''} estratégica${strategic>1?'s':''} disponible${strategic>1?'s':''} para cazar kart bueno</span>
      </div>`:`<div style="margin-top:10px;padding:6px 10px;border-radius:6px;background:#fbbf2411;border:0.5px solid #fbbf2433">
        <span style="font-size:11px;color:#fbbf24;font-family:sans-serif">⚠ Sin paradas estratégicas — apura cada stint al máximo</span>
      </div>`}
    </div>`;
  }

  // ── Resumen por piloto ─────────────────────────────────────
  html+=`<div class="en-team-card">
    <div class="en-team-title">Resumen por piloto${EnBox.pilotMinTime?' · Mínimo: '+EnBox.pilotMinTime+' min':''}</div>`;
  const minMs=EnBox.pilotMinTime*60*1000;
  pilotos.forEach((p,idx)=>{
    const stints=EnSession.stintHistory.filter(s=>s.pilotIdx===idx);
    let totalMs=stints.reduce((a,s)=>a+s.durationMs,0);
    const totalPitMs=stints.reduce((a,s)=>a+(s.pitStopMs||0),0);
    // Añadir stint actual si es el piloto en pista
    const isCurrent=idx===EnSession.currentPilot;
    if(isCurrent){
      const currentStintMs=EnSession.stintFrozen?EnSession.stintFrozen:(EnSession.stintStart?(Date.now()-EnSession.stintStart):0);
      totalMs+=currentStintMs;
    }
    const avgs=stints.filter(s=>s.avg).map(s=>s.avg);
    const avgAll=avgs.length?avgs.reduce((a,b)=>a+b,0)/avgs.length:null;
    const bests=stints.filter(s=>s.best).map(s=>s.best);
    const bestAll=bests.length?Math.min(...bests):null;
    const col=colors[idx%colors.length];

    // Tiempo restante al mínimo
    let remainStr='';
    let remainCol='#555';
    if(minMs>0){
      const remaining=minMs-totalMs;
      if(remaining<=0){remainStr='✅ Mínimo cumplido'; remainCol='#22c55e';}
      else{remainStr='Faltan '+_enFmtStint(remaining); remainCol='#ef4444';}
    }

    // Barra de progreso hacia mínimo
    const pct=minMs>0?Math.min(100,totalMs/minMs*100):0;

    const _pr=_enPilotRatings[p.name];
    const _prObj=(_pr && typeof _pr==='object') ? _pr : null;
    const _prScore=_prObj?.score ?? (typeof _pr==='number'?_pr:null);
    const _scoreBadge=(val,max,label)=>{
      if(val==null) return '';
      const pct=val/max;
      const c=pct>=0.8?'#22c55e':pct>=0.55?'#84cc16':pct>=0.35?'#fbbf24':pct>=0.15?'#f97316':'#ef4444';
      return `<span style="font-size:10px;color:${c};font-family:monospace;font-weight:600" title="${label}: ${val}/${max}">${label} ${val}</span>`;
    };
    const _scoreRow=_prObj?`<div style="display:flex;gap:8px;margin-top:2px">${_scoreBadge(_prObj.pace_score,500,'Pace')}${_scoreBadge(_prObj.position_score,300,'Pos')}${_scoreBadge(_prObj.consistency_score,200,'Con')}</div>`:'';
    html+=`<div class="en-queue-item" style="flex-wrap:wrap">
      <div class="en-pilot-avatar" style="background:${col};width:34px;height:34px;font-size:14px">${p.name.charAt(0)}</div>
      <div style="flex:1;min-width:120px">
        <div style="font-size:14.5px;color:${isCurrent?'#d0d2db':'#9ca3af'};font-family:sans-serif">${p.name}${isCurrent?' 🟢':''}</div>
        <div style="font-size:12.5px;color:#555;font-family:sans-serif">${stints.length} stints · ${_enFmtStint(totalMs)} pista${totalPitMs?' · '+_enFmtStint(totalPitMs)+' pit':''}</div>
        ${_scoreRow}
      </div>
      <div style="text-align:right;min-width:90px">
        <div style="font-size:14.5px;color:#6b7280;font-family:monospace">${avgAll?_enFmt(avgAll):'—'}</div>
        <div style="font-size:12.5px;color:#22c55e;font-family:monospace">${bestAll?_enFmt(bestAll):'—'}</div>
      </div>
      ${minMs>0?`<div style="width:100%;margin-top:4px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="flex:1;height:5px;border-radius:2px;background:#1e1f25;margin-right:8px"><div style="height:100%;border-radius:2px;background:${pct>=100?'#22c55e':'#5b8dee'};width:${pct}%"></div></div>
          <span style="font-size:11.5px;color:${remainCol};font-family:sans-serif;white-space:nowrap">${remainStr}</span>
        </div>
      </div>`:''}
    </div>`;
  });
  html+=`</div>`;

  return html;
}

