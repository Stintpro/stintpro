// ── en-track.js — pestaña 🗺️ Pista: todos los karts sobre el trazado ──
// Trazado GPS real (src/tracks/<slug>.json, tools/track-from-gps.js) o un óvalo
// genérico. La posición la calcula el motor puro en-track-pos.js. El SVG se crea
// UNA vez por trazado y en cada fotograma solo cambian los transform de los
// dorsales: recrearlo con innerHTML reiniciaría las transiciones (misma lección
// que el destello de vuelta reiniciado, ver en-grid.js).

const EnTrack = {
  engine: null, track: null, key: null, shellFor: null, nodes: {},
  raf: null, lastFrame: 0, lastSide: 0, selected: null, cache: {},
};

// Reloj del mapa: el mismo que usa lastLapAt. En un replay es el tiempo de la
// grabación (apex-protocol recibe `now` del ReplayConnector), no Date.now().
function _enTrackNow(){
  const R=typeof window!=='undefined'?window.ReplayConnector:null;
  if(R&&R._lines&&R._lines.length&&R._playing){
    const lineT=R._lines[R._currentIdx]?.t;
    if(lineT==null)return Date.now();
    if(R._paused||!(R.speed>0))return lineT;
    // Interpola entre líneas con el reloj de pared, pero nunca fuera de
    // [línea actual, +5 s]: si alguien sustituye Date.now() (el banco con
    // reloj virtual lo hace) la fórmula deja de ser fiable.
    const t=R._mediaStart+(Date.now()-R._wallStart)*R.speed;
    return Math.min(Math.max(t,lineT),lineT+5000);
  }
  return Date.now();
}

function _enTrackEsc(s){
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _enTrackFmtGap(s){ return (s>=0?'+':'−')+Math.abs(s).toFixed(1).replace('.',',')+' s'; }
function _enTrackClock(s){ s=Math.max(0,Math.round(s)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
function _enTrackFmtLap(ms){
  if(ms==null)return '—';
  const m=Math.floor(ms/60000), r=Math.round(ms-m*60000);
  return `${m}:${String(Math.floor(r/1000)).padStart(2,'0')}.${String(r%1000).padStart(3,'0')}`;
}

// ── HTML puro (testeado en tests/track-ui.test.js) ─────────────────────────
const _ENTRK_TXT='font-family:sans-serif;font-size:12.5px';

function _enTrackGapStripHtml(gaps, me){
  if(!me)return `<span style="${_ENTRK_TXT};color:var(--text-3)">Configura tu dorsal para ver tus huecos en pista</span>`;
  const side=(g,arrow,sign)=>g
    ?`<span style="white-space:nowrap">${arrow} <b style="color:var(--text-1)">#${_enTrackEsc(g.dorsal)}</b> <span style="color:var(--text-2)">${_enTrackEsc(g.name)}</span> <span style="font-family:'JetBrains Mono',monospace;color:var(--text-1)">${_enTrackFmtGap(sign*g.gapS)}</span></span>`
    :`<span style="color:var(--text-3)">${arrow} —</span>`;
  const g=gaps||{ahead:null,behind:null};
  return `<div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;${_ENTRK_TXT}">
    ${side(g.ahead,'▲',1)}
    <span style="color:#F5A623;font-weight:600;letter-spacing:.04em">· MI KART #${_enTrackEsc(me)} ·</span>
    ${side(g.behind,'▼',-1)}</div>`;
}

function _enTrackPitListHtml(list){
  const head=`<div style="${_ENTRK_TXT};color:var(--text-2);margin-bottom:6px">🅿︎ En box · ${list.length}</div>`;
  if(!list.length)return head+`<div style="${_ENTRK_TXT};color:var(--text-3)">Nadie en box</div>`;
  return head+list.map(p=>{
    const over=p.remainingS<0;
    const txt=over?`+${_enTrackClock(-p.remainingS)}`:`Sale en ${_enTrackClock(p.remainingS)}`;
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,0.035);margin-bottom:4px;${_ENTRK_TXT}">
      <span style="min-width:30px;text-align:center;font-weight:600;color:#fff;background:#1b1d24;border-radius:5px;padding:2px 4px">${_enTrackEsc(p.dorsal)}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-1)">${_enTrackEsc(p.name)}</span>
      <span style="font-family:'JetBrains Mono',monospace;color:var(--text-3)">${_enTrackClock(p.pitS)}</span>
      <span style="font-family:'JetBrains Mono',monospace;color:${over?'#ef4444':'#fbbf24'}">${txt}</span></div>`;
  }).join('');
}

function _enTrackNoteHtml(track, err){
  if(!track||track.generic)return 'Trazado genérico · posición aproximada';
  const prof=track.approxProfile?' (perfil aproximado en este sentido)':'';
  const e=err&&err.n>=20&&err.medianS!=null?`error medio ±${err.medianS.toFixed(2).replace('.',',')} s`:'error midiendo…';
  return `Trazado GPS · ${_enTrackEsc(track.name)}${prof} · ${e}`;
}

function _enTrackSelHtml(info){
  if(!info)return '';
  return `<div style="display:flex;gap:12px;align-items:center;${_ENTRK_TXT};color:var(--text-2)">
    <b style="color:var(--text-1)">#${_enTrackEsc(info.dorsal)}</b> ${_enTrackEsc(info.name)}
    <span>Última <span style="font-family:'JetBrains Mono',monospace;color:var(--text-1)">${_enTrackFmtLap(info.lastLapMs)}</span></span>
    <span>Ritmo <span style="font-family:'JetBrains Mono',monospace;color:var(--text-1)">${_enTrackFmtLap(info.refMs)}</span></span></div>`;
}

// ── Trazado y contexto ─────────────────────────────────────────────────────
function _enTunnelOffsetS(){
  const cal=(typeof EnSession!=='undefined'&&EnSession.pitOutCalibration)||[];
  if(cal.length>=2)return cal.reduce((a,b)=>a+b,0)/cal.length;
  const cfg=window.AppState?.config;
  const v=cfg?.slug&&window.CircuitDB?.getKnownOffset?.(cfg.slug,cfg.trackDirection||'normal');
  return typeof v==='number'&&v>0?v:null;
}

// Un trazado por circuito+sentido. Mientras llega (o si no hay fichero o está
// roto) se usa el óvalo: la pestaña nunca se queda en blanco.
function _enTrackEnsure(){
  const P=window.EnTrackPos;
  const cfg=window.AppState?.config||{};
  const slug=cfg.slug||'', dir=cfg.trackDirection||'normal', key=slug+'|'+dir;
  if(!EnTrack.engine)EnTrack.engine=P.createTrackPos();
  if(EnTrack.key===key&&EnTrack.track)return EnTrack.track;
  EnTrack.key=key;
  EnTrack.track=P.ovalTrack();
  const apply=j=>{ if(EnTrack.key!==key)return; const t=j&&P.loadTrack(j,dir); if(t)EnTrack.track=t; };
  if(slug){
    if(slug in EnTrack.cache)apply(EnTrack.cache[slug]);
    else fetch((window.EnTrackBase||'tracks/')+encodeURIComponent(slug)+'.json')
      .then(r=>r.ok?r.json():null).catch(()=>null)
      .then(j=>{EnTrack.cache[slug]=j;apply(j);});
  }
  return EnTrack.track;
}

// ── SVG ────────────────────────────────────────────────────────────────────
function _enTrackShellHtml(track){
  const P=window.EnTrackPos;
  const pts=track.points, w=track.viewBox.w, h=track.viewBox.h, wu=track.widthUnits;
  const f=v=>v.toFixed(1);
  const d=pts.map((p,i)=>(i?'L':'M')+f(p[0])+' '+f(p[1])).join(' ')+' Z';
  const pit=P.pitLanePolyline(track,wu*1.6);
  const pitD=pit?pit.map((p,i)=>(i?'L':'M')+f(p[0])+' '+f(p[1])).join(' '):'';
  const a=pts[pts.length-1], b=pts[1], tx=b[0]-a[0], ty=b[1]-a[1], tl=Math.hypot(tx,ty)||1;
  const nx=-ty/tl, ny=tx/tl, m=pts[0], half=wu*0.8;
  const q=P.pointAtDist(track,0.03), q2=P.pointAtDist(track,0.045);
  const ang=Math.atan2(q2[1]-q[1],q2[0]-q[0])*180/Math.PI;
  const fs=Math.max(14,wu*0.85);
  return `<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;padding:4px 2px">
    <div style="flex:1 1 420px;min-width:0">
      <div id="en-trk-gaps" style="padding:8px 12px;border-radius:10px;background:rgba(255,255,255,0.035);border:0.5px solid var(--glass-border,#22242b);margin-bottom:8px"></div>
      <svg id="en-trk-svg" viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block" role="img" aria-label="Mapa de pista">
        <defs><pattern id="en-trk-chk" width="${wu/2}" height="${wu/2}" patternUnits="userSpaceOnUse">
          <rect width="${wu/4}" height="${wu/4}" fill="#f5f5f5"/><rect x="${wu/4}" y="${wu/4}" width="${wu/4}" height="${wu/4}" fill="#f5f5f5"/>
          <rect x="${wu/4}" width="${wu/4}" height="${wu/4}" fill="#111"/><rect y="${wu/4}" width="${wu/4}" height="${wu/4}" fill="#111"/></pattern></defs>
        <path d="${d}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="${wu*1.9}" stroke-linejoin="round"/>
        <path d="${d}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="${wu}" stroke-linejoin="round"/>
        ${pit?`<path d="${pitD}" fill="none" stroke="rgba(251,191,36,0.38)" stroke-width="${wu*0.55}" stroke-dasharray="${wu*0.8} ${wu*0.5}" stroke-linecap="round"/>
        <text x="${f(pit[0][0])}" y="${f(pit[0][1]-wu)}" font-size="${fs}" fill="#fbbf24" text-anchor="middle" font-family="sans-serif">PIT IN</text>
        <text x="${f(pit[pit.length-1][0])}" y="${f(pit[pit.length-1][1]-wu)}" font-size="${fs}" fill="#fbbf24" text-anchor="middle" font-family="sans-serif">PIT OUT</text>`:''}
        <line x1="${f(m[0]-nx*half)}" y1="${f(m[1]-ny*half)}" x2="${f(m[0]+nx*half)}" y2="${f(m[1]+ny*half)}" stroke="url(#en-trk-chk)" stroke-width="${wu*0.5}"/>
        <path d="M0 ${f(-wu*0.45)} L${f(wu*0.9)} 0 L0 ${f(wu*0.45)} Z" fill="rgba(255,255,255,0.5)" transform="translate(${f(q[0])} ${f(q[1])}) rotate(${ang.toFixed(1)})"/>
        <g id="en-trk-karts"></g>
      </svg>
      <div id="en-trk-sel" style="margin-top:6px;min-height:18px"></div>
      <div id="en-trk-note" style="font-family:sans-serif;font-size:11px;color:var(--text-3);margin-top:4px"></div>
    </div>
    <div id="en-trk-pit" style="flex:1 1 240px;min-width:220px"></div>
  </div>`;
}

function _enTrackKartNode(dorsal, isMe, wu){
  const NS='http://www.w3.org/2000/svg';
  const r=isMe?wu*0.95:wu*0.72;
  const g=document.createElementNS(NS,'g');
  g.setAttribute('data-d',dorsal);
  g.style.cursor='pointer';
  if(isMe){
    const halo=document.createElementNS(NS,'circle');
    halo.setAttribute('r',(r*1.55).toFixed(1));
    halo.setAttribute('fill','rgba(245,166,35,0.22)');
    g.appendChild(halo);
  }
  const c=document.createElementNS(NS,'circle');
  c.setAttribute('r',r.toFixed(1));
  c.setAttribute('fill',isMe?'#F5A623':'#1b1d24');
  c.setAttribute('stroke',isMe?'#fff5e0':'rgba(255,255,255,0.45)');
  c.setAttribute('stroke-width',(wu*0.09).toFixed(1));
  g.appendChild(c);
  const t=document.createElementNS(NS,'text');
  t.textContent=dorsal;
  t.setAttribute('text-anchor','middle');
  t.setAttribute('dominant-baseline','central');
  t.setAttribute('font-family','sans-serif');
  t.setAttribute('font-weight','700');
  t.setAttribute('font-size',(r*(dorsal.length>=3?0.8:1.0)).toFixed(1));
  t.setAttribute('fill',isMe?'#1a1205':'#ffffff');
  g.appendChild(t);
  g.addEventListener('click',()=>_enTrackSelect(dorsal));
  return g;
}

function _enTrackSelect(dorsal){
  EnTrack.selected=EnTrack.selected===dorsal?null:dorsal;
  const el=document.getElementById('en-trk-sel');
  if(el)el.innerHTML=EnTrack.selected?_enTrackSelHtml(EnTrack.engine.info(EnTrack.selected)):'';
}

// ── Render (cada tick de _enRender) y animación (~10 Hz) ──────────────────
function _enRenderTrack(eq){
  const body=document.getElementById('en-track-body');
  if(!body||!window.EnTrackPos)return;
  const P=window.EnTrackPos;
  const track=_enTrackEnsure();
  EnTrack.engine.update(eq,_enTrackNow(),{
    pitDurationS:(typeof EnBox!=='undefined'&&EnBox.pitDuration)||120,
    tunnelOffsetS:_enTunnelOffsetS(),
    outTimeFrac:track.pitLane?P.distToTime(track,track.pitLane.outFrac):null,
  });
  if(EnTrack.shellFor!==track||!body.querySelector('#en-trk-karts')){
    body.innerHTML=_enTrackShellHtml(track);
    EnTrack.shellFor=track;
    EnTrack.nodes={};
    EnTrack.lastSide=0;
  }
  _enStartTrackRaf();
}

function _enTrackFrame(){
  EnTrack.raf=requestAnimationFrame(_enTrackFrame);
  const wall=Date.now();
  if(wall-EnTrack.lastFrame<100)return;
  EnTrack.lastFrame=wall;
  const g=document.getElementById('en-trk-karts');
  if(!g){_enStopTrackRaf();return;}
  const P=window.EnTrackPos, track=EnTrack.track, now=_enTrackNow();
  const me=String(window.AppState?.config?.myDorsal||'');
  const pos=EnTrack.engine.positions(now);
  const inPit=pos.filter(p=>p.mode==='pit');
  const seen=new Set();
  pos.forEach(p=>{
    if(p.mode==='hidden')return;
    // en box: fuera del mapa (solo en la columna "En box") salvo que el trazado tenga pit lane
    const pt=p.mode==='pit'
      ?P.pitSlot(track,inPit.indexOf(p),inPit.length,track.widthUnits*1.6)
      :P.pointAt(track,p.t);
    if(!pt)return;
    seen.add(p.dorsal);
    let node=EnTrack.nodes[p.dorsal];
    if(!node){
      node=_enTrackKartNode(p.dorsal,p.dorsal===me,track.widthUnits);
      EnTrack.nodes[p.dorsal]=node;
      if(p.dorsal===me)g.appendChild(node); else g.insertBefore(node,g.firstChild);   // mi kart, encima
    }
    node.setAttribute('transform',`translate(${pt[0].toFixed(1)} ${pt[1].toFixed(1)})`);
    node.style.opacity=p.mode==='stale'?'0.35':'1';
  });
  Object.keys(EnTrack.nodes).forEach(d=>{ if(!seen.has(d)){EnTrack.nodes[d].remove();delete EnTrack.nodes[d];} });
  if(wall-EnTrack.lastSide>=250){
    EnTrack.lastSide=wall;
    const gaps=document.getElementById('en-trk-gaps');
    if(gaps)gaps.innerHTML=_enTrackGapStripHtml(me?EnTrack.engine.gapsFor(me,now):null,me);
    const pit=document.getElementById('en-trk-pit');
    if(pit)pit.innerHTML=_enTrackPitListHtml(EnTrack.engine.pitList(now));
    const note=document.getElementById('en-trk-note');
    if(note)note.innerHTML=_enTrackNoteHtml(track,EnTrack.engine.errorStats());
    if(EnTrack.selected){const sel=document.getElementById('en-trk-sel');if(sel)sel.innerHTML=_enTrackSelHtml(EnTrack.engine.info(EnTrack.selected));}
  }
}

function _enStartTrackRaf(){ if(EnTrack.raf==null&&typeof requestAnimationFrame==='function')EnTrack.raf=requestAnimationFrame(_enTrackFrame); }
function _enStopTrackRaf(){ if(EnTrack.raf!=null&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(EnTrack.raf); EnTrack.raf=null; }

if (typeof module !== 'undefined') {
  module.exports = { _enTrackNow, _enTrackEsc, _enTrackFmtGap, _enTrackClock, _enTrackFmtLap,
    _enTrackGapStripHtml, _enTrackPitListHtml, _enTrackNoteHtml, _enTrackSelHtml };
}
