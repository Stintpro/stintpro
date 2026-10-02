// ── en-track.js — pestaña 🗺️ Pista: todos los karts sobre el trazado ──
// Trazado GPS real (src/tracks/<slug>.json, tools/track-from-gps.js) o un óvalo
// genérico. La posición la calcula el motor puro en-track-pos.js. El SVG se crea
// UNA vez por trazado y en cada fotograma solo cambian los transform de los
// dorsales: recrearlo con innerHTML reiniciaría las transiciones (misma lección
// que el destello de vuelta reiniciado, ver en-grid.js).

const EnTrack = {
  engine: null, track: null, key: null, shellFor: null, nodes: {},
  raf: null, lastFrame: 0, lastSide: 0, selected: null, cache: {},
  pills: {}, groupOf: {}, dirDismissedAt: null,
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
function _enTrackFmtGap(s){
  if(!Number.isFinite(s))return '—';
  if(Math.abs(s)<0.05)return '+0,0 s';
  return (s>=0?'+':'−')+Math.abs(s).toFixed(1).replace('.',',')+' s';
}
function _enTrackClock(s){ s=Math.max(0,Math.round(s)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
function _enTrackFmtLap(ms){
  if(ms==null)return '—';
  ms=Math.round(ms);
  const m=Math.floor(ms/60000), r=Math.round(ms-m*60000);
  return `${m}:${String(Math.floor(r/1000)).padStart(2,'0')}.${String(r%1000).padStart(3,'0')}`;
}

// ── HTML puro (testeado en tests/track-ui.test.js) ─────────────────────────
// Tipografía y medidas del resto del panel (styles.css/en-state.js): Inter para
// el texto, JetBrains Mono con cifras tabulares para tiempos y huecos.
const _ENTRK_TXT="font-family:var(--font-sans,'Inter',sans-serif);font-size:12.5px";
const _ENTRK_MONO="font-family:var(--font-mono,'JetBrains Mono',monospace);font-variant-numeric:tabular-nums";
const _ENTRK_ME='#F5A623';

// Tira de huecos = marcador de tres casillas: delante | MI KART | detrás. El
// hueco es lo que se lee de un vistazo, así que es lo más grande de la tira.
function _enTrackGapStripHtml(gaps, me){
  if(!me)return `<div style="${_ENTRK_TXT};color:var(--text-3);text-align:center;padding:2px 0">Configura tu dorsal para ver tus huecos en pista</div>`;
  const side=(g,arrow,sign,align)=>{
    const base=`display:flex;flex-direction:column;gap:1px;min-width:0;align-items:${align}`;
    if(!g)return `<div style="${base}"><span style="${_ENTRK_MONO};font-size:15.5px;color:var(--text-3)">${arrow} —</span></div>`;
    return `<div style="${base}">
      <span style="${_ENTRK_MONO};font-size:15.5px;font-weight:600;color:var(--text-1);white-space:nowrap"><span style="color:var(--text-3);font-size:11.5px">${arrow}</span> ${_enTrackFmtGap(sign*g.gapS)}</span>
      <span style="max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-2)"><b style="color:var(--text-1);font-weight:600">#${_enTrackEsc(g.dorsal)}</b> ${_enTrackEsc(g.name)}</span></div>`;
  };
  const g=gaps||{ahead:null,behind:null};
  return `<div style="display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:12px;align-items:center;${_ENTRK_TXT}">
    ${side(g.ahead,'▲',1,'flex-start')}
    <span style="${_ENTRK_MONO};font-size:12.5px;font-weight:700;letter-spacing:.06em;color:${_ENTRK_ME};padding:4px 10px;border-radius:999px;border:0.5px solid rgba(245,166,35,0.55);background:rgba(245,166,35,0.10);white-space:nowrap">MI KART #${_enTrackEsc(me)}</span>
    ${side(g.behind,'▼',-1,'flex-end')}</div>`;
}

// Columna "En box": cada fila dice quién, cuánto lleva parado y —lo que se mira—
// cuándo sale (ámbar) o cuánto se ha pasado (rojo).
function _enTrackPitListHtml(list){
  const me=typeof window!=='undefined'?String(window.AppState?.config?.myDorsal||''):'';
  const head=`<div class="en-strat-title" style="display:flex;align-items:baseline;margin-bottom:8px">En box · ${list.length}</div>`;
  if(!list.length)return head+`<div style="${_ENTRK_TXT};color:var(--text-3)">Nadie en box</div>`;
  return head+list.map(p=>{
    const over=p.remainingS<0, mine=me&&String(p.dorsal)===me;
    const txt=over?`+${_enTrackClock(-p.remainingS)}`:`Sale en ${_enTrackClock(p.remainingS)}`;
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;background:rgba(255,255,255,0.035);border:0.5px solid ${mine?'rgba(245,166,35,0.55)':'rgba(255,255,255,0.06)'};margin-bottom:5px;${_ENTRK_TXT}">
      <span style="min-width:32px;text-align:center;${_ENTRK_MONO};font-size:13.5px;font-weight:700;color:${mine?'#1a1205':'#fff'};background:${mine?_ENTRK_ME:'#1b1d24'};border:0.5px solid rgba(255,255,255,0.18);border-radius:6px;padding:2px 5px">${_enTrackEsc(p.dorsal)}</span>
      <span style="flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-1)">${_enTrackEsc(p.name)}</span>
        <span style="font-size:11.5px;color:var(--text-3)">parado <span style="${_ENTRK_MONO}">${_enTrackClock(p.pitS)}</span></span></span>
      <span style="${_ENTRK_MONO};font-size:13.5px;font-weight:600;white-space:nowrap;color:${over?'#ef4444':'#fbbf24'}">${txt}</span></div>`;
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
  const v=ms=>`<span style="${_ENTRK_MONO};color:var(--text-1)">${_enTrackFmtLap(ms)}</span>`;
  return `<div style="display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline;${_ENTRK_TXT};color:var(--text-2)">
    <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b style="color:var(--text-1);font-weight:600">#${_enTrackEsc(info.dorsal)}</b> ${_enTrackEsc(info.name)}</span>
    <span>Última ${v(info.lastLapMs)}</span>
    <span>Ritmo ${v(info.refMs)}</span></div>`;
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
  if(EnTrack.key!=null&&EnTrack.key!==key)EnTrack.engine.reset();   // otro circuito/sentido
  EnTrack.key=key;
  EnTrack.track=P.ovalTrack();
  const apply=j=>{ if(EnTrack.key!==key)return; const t=j&&P.loadTrack(j,dir); if(t)EnTrack.track=t; };
  if(slug){
    if(slug in EnTrack.cache)apply(EnTrack.cache[slug]);
    // Solo se cachea un JSON bueno o un 404 (no hay trazado): un fallo de red o
    // del servidor se reintenta en el próximo cambio de clave o al recargar.
    else fetch((window.EnTrackBase||'tracks/')+encodeURIComponent(slug)+'.json')
      .then(r=>r.ok?r.json():(r.status===404?null:Promise.reject(r.status)))
      .then(j=>{EnTrack.cache[slug]=j;apply(j);},()=>{});
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
  // El mapa se acota a la altura visible (62vh) y se centra conservando la
  // proporción: así mapa + tira caben en pantalla y "En box" queda al lado.
  return `<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start">
    <div style="flex:1 1 380px;min-width:0">
      <div id="en-trk-gaps" class="en-strat-card" style="padding:10px 14px;margin-bottom:10px"></div>
      <div class="en-strat-card" style="padding:10px 12px;margin-bottom:0">
      <div id="en-trk-dir" style="display:flex;justify-content:flex-end;margin-bottom:4px"></div>
      <svg id="en-trk-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;max-height:62vh;display:block;margin:0 auto" role="img" aria-label="Mapa de pista">
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
        <g id="en-trk-pills"></g>
      </svg>
      <div style="display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:0.5px solid rgba(255,255,255,0.07)">
        <div id="en-trk-sel" style="min-height:19px;min-width:0"></div>
        <div id="en-trk-note" style="font-family:var(--font-sans,'Inter',sans-serif);font-size:11.5px;color:var(--text-3)"></div>
      </div>
      </div>
    </div>
    <div id="en-trk-pit" class="en-strat-card" style="flex:0 1 270px;min-width:220px;margin-bottom:0;padding:12px 12px 7px"></div>
  </div>`;
}

function _enTrackKartNode(dorsal, isMe, wu){
  const NS='http://www.w3.org/2000/svg';
  const r=isMe?wu*0.95:wu*0.72;
  const g=document.createElementNS(NS,'g');
  g.setAttribute('data-d',dorsal);
  g.style.cursor='pointer';
  // Canto oscuro: separa los dorsales que quedan pegados tras el desplazamiento.
  const rim=document.createElementNS(NS,'circle');
  rim.setAttribute('r',(r+wu*0.14).toFixed(1));
  rim.setAttribute('fill','rgba(8,9,10,0.6)');
  g.appendChild(rim);
  if(isMe){
    const halo=document.createElementNS(NS,'circle');
    halo.setAttribute('r',(r*1.55).toFixed(1));
    halo.setAttribute('fill','rgba(245,166,35,0.22)');
    g.insertBefore(halo,rim);
  }
  const c=document.createElementNS(NS,'circle');
  c.setAttribute('r',r.toFixed(1));
  c.setAttribute('fill',isMe?'#F5A623':'#1b1d24');
  c.setAttribute('stroke',isMe?'#fff5e0':'rgba(255,255,255,0.55)');
  c.setAttribute('stroke-width',(wu*0.09).toFixed(1));
  g.appendChild(c);
  const t=document.createElementNS(NS,'text');
  t.textContent=dorsal;
  t.setAttribute('text-anchor','middle');
  t.setAttribute('dominant-baseline','central');
  t.setAttribute('font-family',"Inter, sans-serif");
  t.setAttribute('font-weight','700');
  t.setAttribute('letter-spacing',dorsal.length>=3?'-0.04em':'0');
  t.setAttribute('font-size',(r*(dorsal.length>=3?0.82:dorsal.length===2?1.0:1.12)).toFixed(1));
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

// ── Motor (cada tick de _enRender, en TODAS las pestañas) ─────────────────
// Si solo se actualizara con la pestaña Pista abierta, el motor se perdería las
// salidas de box ocurridas mientras se mira otra pestaña.
function _enTrackUpdate(eq){
  if(!window.EnTrackPos)return;
  const P=window.EnTrackPos;
  const track=_enTrackEnsure();
  EnTrack.engine.update(eq,_enTrackNow(),{
    pitDurationS:(typeof EnBox!=='undefined'&&EnBox.pitDuration)||120,
    tunnelOffsetS:_enTunnelOffsetS(),
    outTimeFrac:track.pitLane?P.distToTime(track,track.pitLane.outFrac):null,
  });
}

// ── Render (solo con la pestaña Pista abierta) y animación (~10 Hz) ───────
function _enRenderTrack(eq){
  const body=document.getElementById('en-track-body');
  if(!body||!window.EnTrackPos)return;
  const track=_enTrackEnsure();
  if(EnTrack.shellFor!==track||!body.querySelector('#en-trk-karts')){
    body.innerHTML=_enTrackShellHtml(track);
    EnTrack.shellFor=track;
    EnTrack.nodes={};
    EnTrack.pills={};
    EnTrack.groupOf={};
    EnTrack.lastSide=0;
  }
  _enStartTrackRaf();
}

// ── Karts juntos → una píldora ────────────────────────────────────────────
// Antes se abrían en abanico a los lados de la pista y, con mucho tráfico,
// quedaba un racimo de círculos pisándose. Ahora los que se tocan se funden en
// UNA píldora horizontal con sus dorsales en fila (el que va delante, primero),
// centrada en el grupo. Se agrupa de forma iterativa: si una píldora al crecer
// pisa a otro kart u otra píldora, se los traga → nunca hay solapes.
const _ENTRK_PILL_ROW=6;   // dorsales por fila; más → la píldora se parte en filas

// Maquetado de una píldora en unidades del SVG, relativo a su centro. r = radio
// de un dorsal suelto (la píldora tiene su misma altura para que lean igual).
function _enTrackPillLayout(dorsals, r){
  const fs=r*1.05, padX=r*0.35, rowH=r*1.8;
  const cw=d=>Math.max(fs*1.25,String(d).length*fs*0.6+fs*0.5);
  const n=dorsals.length, rows=Math.max(1,Math.ceil(n/_ENTRK_PILL_ROW)), per=Math.ceil(n/rows);
  const lines=[];
  for(let i=0;i<n;i+=per)lines.push(dorsals.slice(i,i+per));
  const widths=lines.map(l=>l.reduce((a,d)=>a+cw(d),0));
  const w=Math.max(...widths)+padX*2, h=rows===1?r*2:rows*rowH+r*0.3;
  const chips=[];
  lines.forEach((l,ri)=>{
    let x=-widths[ri]/2;
    const y=rows===1?0:-h/2+r*0.15+rowH*(ri+0.5);
    l.forEach(d=>{const cwd=cw(d);chips.push({d:String(d),x:x+cwd/2,y,w:cwd});x+=cwd;});
  });
  return {w,h,rows,fs,chips};
}

// items: {d, x, y, t, me, stale} (t=null → en box, no se agrupa). prevOf: dorsal →
// clave del grupo en el fotograma anterior (histéresis: los que iban juntos solo
// se separan con algo más de aire, para que la píldora no parpadee). Devuelve
// grupos {members (el que va delante primero), x, y, layout|null si va solo}.
function _enTrackGroup(items, r, prevOf){
  prevOf=prevOf||{};
  const box=g=>g.members.length===1
    ?{hw:r*(g.members[0].me?1.32:1),hh:r*(g.members[0].me?1.32:1)}
    :{hw:g.layout.w/2,hh:g.layout.h/2};
  const make=members=>{
    const L=members.filter(m=>m.t!=null);
    if(L.length>1){
      const t0=L[0].t, rel=t=>((t-t0)%1+1.5)%1-0.5;
      members=[...members].sort((a,b)=>rel(b.t)-rel(a.t)||String(a.d).localeCompare(String(b.d)));
    }
    const x=members.reduce((a,m)=>a+m.x,0)/members.length, y=members.reduce((a,m)=>a+m.y,0)/members.length;
    return {members,x,y,layout:members.length>1?_enTrackPillLayout(members.map(m=>m.d),r):null};
  };
  const wasWith=(a,b)=>a.members.some(m=>prevOf[m.d]&&b.members.some(o=>prevOf[o.d]===prevOf[m.d]));
  let groups=items.map(it=>make([it]));
  for(let merged=true;merged;){
    merged=false;
    for(let i=0;i<groups.length&&!merged;i++){
      if(groups[i].members[0].t==null)continue;
      for(let j=i+1;j<groups.length;j++){
        if(groups[j].members[0].t==null)continue;
        const a=groups[i], b=groups[j], A=box(a), B=box(b);
        const m=wasWith(a,b)?r*0.8:r*0.1;
        if(Math.abs(a.x-b.x)<A.hw+B.hw+m&&Math.abs(a.y-b.y)<A.hh+B.hh+m){
          groups[i]=make([...a.members,...b.members]);
          groups.splice(j,1);
          merged=true; break;
        }
      }
    }
  }
  return groups;
}

// Nodo SVG de una píldora. Se reutiliza mientras no cambien sus miembros (solo
// se mueve su transform); el clic en un dorsal lo selecciona como un kart suelto.
function _enTrackPillNode(group, r){
  const NS='http://www.w3.org/2000/svg', L=group.layout;
  const hasMe=group.members.some(m=>m.me);
  const el=(tag,attrs,parent)=>{const e=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));parent.appendChild(e);return e;};
  const g=document.createElementNS(NS,'g');
  g.style.cursor='pointer';
  const rx=L.rows===1?L.h/2:r*0.9;
  el('rect',{x:(-L.w/2-r*0.14).toFixed(1),y:(-L.h/2-r*0.14).toFixed(1),width:(L.w+r*0.28).toFixed(1),height:(L.h+r*0.28).toFixed(1),rx:(rx+r*0.14).toFixed(1),fill:'rgba(8,9,10,0.6)'},g);
  el('rect',{x:(-L.w/2).toFixed(1),y:(-L.h/2).toFixed(1),width:L.w.toFixed(1),height:L.h.toFixed(1),rx:rx.toFixed(1),
    fill:'#1b1d24',stroke:hasMe?'rgba(245,166,35,0.85)':'rgba(255,255,255,0.55)','stroke-width':(r*0.125).toFixed(1)},g);
  L.chips.forEach((c,i)=>{
    const m=group.members[i];
    const prev=L.chips[i-1];
    if(prev&&prev.y===c.y)el('line',{x1:(c.x-c.w/2).toFixed(1),x2:(c.x-c.w/2).toFixed(1),y1:(c.y-r*0.5).toFixed(1),y2:(c.y+r*0.5).toFixed(1),stroke:'rgba(255,255,255,0.18)','stroke-width':(r*0.08).toFixed(1)},g);
    const cg=el('g',{'data-d':c.d},g);
    if(m.stale)cg.setAttribute('opacity','0.4');
    if(m.me)el('rect',{x:(c.x-c.w/2+r*0.12).toFixed(1),y:(c.y-r*0.78).toFixed(1),width:(c.w-r*0.24).toFixed(1),height:(r*1.56).toFixed(1),rx:(r*0.6).toFixed(1),fill:_ENTRK_ME},cg);
    else el('rect',{x:(c.x-c.w/2).toFixed(1),y:(c.y-r*0.8).toFixed(1),width:c.w.toFixed(1),height:(r*1.6).toFixed(1),fill:'transparent'},cg);
    const t=el('text',{x:c.x.toFixed(1),y:c.y.toFixed(1),'text-anchor':'middle','dominant-baseline':'central','font-family':'Inter, sans-serif','font-weight':'700',
      'font-size':(L.fs*(c.d.length>=3?0.86:1)).toFixed(1),fill:m.me?'#1a1205':'#ffffff'},cg);
    t.textContent=c.d;
    cg.addEventListener('click',()=>_enTrackSelect(c.d));
  });
  return g;
}

// ── Sentido de pista ───────────────────────────────────────────────────────
// Apex NO manda el sentido (ni en henakart, que lo invierte a mitad de la COPA
// PISTON). Se cambia a mano desde el mapa y, cuando casi toda la parrilla entra a
// box a la vez (la única firma de ese cambio), se pregunta.
function _enTrackDirBarHtml(dir, prompt){
  const other=dir==='inverso'?'normal':'inverso';
  const lbl=d=>d==='inverso'?'Inverso':'Normal';
  const btn=`<button type="button" onclick="_enTrackSetDirection('${other}')" style="${_ENTRK_TXT};font-size:12px;padding:4px 10px;border-radius:999px;border:0.5px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.05);color:var(--text-1);cursor:pointer;white-space:nowrap">⇄ Invertir</button>`;
  if(prompt)return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;${_ENTRK_TXT};padding:8px 12px;border-radius:8px;background:rgba(245,166,35,0.10);border:0.5px solid rgba(245,166,35,0.55);margin-bottom:8px;width:100%">
    <span style="flex:1;min-width:180px;color:var(--text-1)"><b style="color:${_ENTRK_ME}">${prompt.n} karts</b> han entrado a box a la vez. ¿Ha cambiado el sentido? <span style="color:var(--text-3)">Ahora: ${lbl(dir)}</span></span>
    <button type="button" onclick="_enTrackSetDirection('${other}')" style="${_ENTRK_TXT};font-size:12px;font-weight:600;padding:5px 12px;border-radius:999px;border:0;background:${_ENTRK_ME};color:#1a1205;cursor:pointer">Pasar a ${lbl(other)}</button>
    <button type="button" onclick="_enTrackDismissDirPrompt()" style="${_ENTRK_TXT};font-size:12px;padding:5px 10px;border-radius:999px;border:0.5px solid rgba(255,255,255,0.18);background:transparent;color:var(--text-2);cursor:pointer">No</button></div>`;
  return `<div style="display:flex;align-items:center;gap:8px;${_ENTRK_TXT};color:var(--text-3)">Sentido <b style="color:var(--text-1);font-weight:600">${lbl(dir)}</b>${btn}</div>`;
}

// ¿Tiene sentido ofrecer el cambio? Con trazado GPS (el mapa se invierte) o si
// el circuito tiene túnel distinto por sentido. En el óvalo genérico, no.
function _enTrackCanFlip(track){
  const slug=window.AppState?.config?.slug;
  return !!slug&&(!(track&&track.generic)||!!window.CircuitDB?.hasDirectionVariants?.(slug));
}

function _enTrackSetDirection(dir){
  const cfg=window.AppState?.config;
  if(!cfg||!cfg.slug||(cfg.trackDirection||'normal')===dir)return;
  // Con túnel por sentido, el cambio completo (offset + mediciones en vuelo) es
  // el de Avanzado; si no, solo cambia el trazado del mapa.
  if(window.CircuitDB?.hasDirectionVariants?.(cfg.slug)&&typeof _enSetTrackDirection==='function')_enSetTrackDirection(dir);
  else cfg.trackDirection=dir;
  EnTrack.dirPromptAt=null;
  EnTrack.lastSide=0;
  _enRenderTrack();
}

function _enTrackDismissDirPrompt(){
  const m=EnTrack.engine&&EnTrack.engine.massPit();
  EnTrack.dirDismissedAt=m?m.at:Date.now();
  EnTrack.lastSide=0;
}

// Aviso vigente: parada masiva no descartada y de hace menos de 10 minutos.
function _enTrackDirPrompt(now){
  const m=EnTrack.engine&&EnTrack.engine.massPit();
  if(!m||m.at===EnTrack.dirDismissedAt||now-m.at>600000)return null;
  return m;
}

function _enTrackFrame(){
  EnTrack.raf=requestAnimationFrame(_enTrackFrame);
  const wall=Date.now();
  if(wall-EnTrack.lastFrame<100)return;
  EnTrack.lastFrame=wall;
  const g=document.getElementById('en-trk-karts');
  if(!g){_enStopTrackRaf();return;}
  // Llegó otro trazado y el SVG aún es del anterior: espera a que _enRenderTrack lo reconstruya.
  if(EnTrack.shellFor!==EnTrack.track)return;
  const P=window.EnTrackPos, track=EnTrack.track, now=_enTrackNow();
  const me=String(window.AppState?.config?.myDorsal||'');
  const pos=EnTrack.engine.positions(now);
  const inPit=pos.filter(p=>p.mode==='pit');
  const seen=new Set(), items=[];
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
    items.push({node,x:pt[0],y:pt[1],t:p.mode==='pit'?null:p.t,me:p.dorsal===me,d:p.dorsal,stale:p.mode==='stale'});
    node.style.opacity=p.mode==='stale'?'0.35':'1';
  });
  Object.keys(EnTrack.nodes).forEach(d=>{ if(!seen.has(d)){EnTrack.nodes[d].remove();delete EnTrack.nodes[d];} });
  // Juntos → píldora; solos → su círculo. Las píldoras se reutilizan mientras no
  // cambien sus miembros (ni quién va delante): así el clic no cae en un nodo
  // recién destruido y no se recrea el DOM 10 veces por segundo.
  const r=track.widthUnits*0.72, W=track.viewBox.w, H=track.viewBox.h;
  const groups=_enTrackGroup(items,r,EnTrack.groupOf);
  const pl=document.getElementById('en-trk-pills');
  const keep={}, groupOf={};
  groups.forEach(gr=>{
    if(!gr.layout){
      const it=gr.members[0];
      it.node.style.display='';
      it.node.setAttribute('transform',`translate(${it.x.toFixed(1)} ${it.y.toFixed(1)})`);
      return;
    }
    const key=gr.members.map(m=>m.d+(m.me?'*':'')+(m.stale?'~':'')).join('|');
    gr.members.forEach(m=>{m.node.style.display='none';groupOf[m.d]=key;});
    if(!pl)return;
    let node=EnTrack.pills[key];
    if(!node){node=_enTrackPillNode(gr,r);pl.appendChild(node);}
    keep[key]=node;
    const L=gr.layout, x=Math.min(Math.max(gr.x,L.w/2),W-L.w/2), y=Math.min(Math.max(gr.y,L.h/2),H-L.h/2);
    node.setAttribute('transform',`translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  });
  Object.keys(EnTrack.pills).forEach(k=>{ if(!keep[k])EnTrack.pills[k].remove(); });
  EnTrack.pills=keep; EnTrack.groupOf=groupOf;
  if(wall-EnTrack.lastSide>=250){
    EnTrack.lastSide=wall;
    const gaps=document.getElementById('en-trk-gaps');
    if(gaps)gaps.innerHTML=_enTrackGapStripHtml(me?EnTrack.engine.gapsFor(me,now):null,me);
    const pit=document.getElementById('en-trk-pit');
    if(pit)pit.innerHTML=_enTrackPitListHtml(EnTrack.engine.pitList(now));
    const dirEl=document.getElementById('en-trk-dir');
    if(dirEl){   // solo si cambia: recrear el botón cada 250 ms se comería clics
      const html=_enTrackCanFlip(track)?_enTrackDirBarHtml(window.AppState?.config?.trackDirection||'normal',_enTrackDirPrompt(now)):'';
      if(dirEl.dataset.html!==html){dirEl.innerHTML=html;dirEl.dataset.html=html;}
    }
    const note=document.getElementById('en-trk-note');
    if(note)note.innerHTML=_enTrackNoteHtml(track,EnTrack.engine.errorStats());
    if(EnTrack.selected){const sel=document.getElementById('en-trk-sel');if(sel)sel.innerHTML=_enTrackSelHtml(EnTrack.engine.info(EnTrack.selected));}
  }
}

function _enStartTrackRaf(){ if(EnTrack.raf==null&&typeof requestAnimationFrame==='function')EnTrack.raf=requestAnimationFrame(_enTrackFrame); }
function _enStopTrackRaf(){ if(EnTrack.raf!=null&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(EnTrack.raf); EnTrack.raf=null; }

if (typeof module !== 'undefined') {
  module.exports = { EnTrack, _enTrackUpdate, _enRenderTrack, _enTrackEnsure, _enTrackFrame, _enTrackNow, _enTrackEsc, _enTrackFmtGap, _enTrackClock, _enTrackFmtLap,
    _enTrackGapStripHtml, _enTrackPitListHtml, _enTrackNoteHtml, _enTrackSelHtml,
    _enTrackPillLayout, _enTrackGroup, _enTrackDirBarHtml, _enTrackDirPrompt, _enTrackSetDirection };
}
