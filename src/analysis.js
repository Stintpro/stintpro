// ── StintPro Analysis — funciones puras de cálculo ───────────────────────
// Sin DOM, sin globals, sin side effects. Cada función depende solo de sus
// argumentos. Testeable de forma aislada.

// ── Formato tiempo (segundos → "1:07.234" o "47.234") ─────────────────────
function _enFmt(s){
  if(!s&&s!==0)return'—';
  const m=Math.floor(s/60),sec=(s%60).toFixed(3).padStart(6,'0');
  return m>0?`${m}:${sec}`:sec;
}

function _enFmtGap(ms){
  if(!ms||ms<=0)return'—';
  const s=ms/1000;
  const m=Math.floor(s/60),sec=(s%60).toFixed(3).padStart(6,'0');
  return m>0?`+${m}:${sec}`:`+${s.toFixed(3)}`;
}

function _enFmtDelta(d){
  if(d===null||d===undefined||isNaN(d))return'—';
  const sign=d>=0?'+':'';
  return sign+d.toFixed(3);
}

// ── Stint timer (ms → "9:32") ─────────────────────────────────────────────
function _enFmtStint(ms){
  if(!ms||ms<0)return'0:00';
  const s=Math.floor(ms/1000);
  const m=Math.floor(s/60);
  const sec=s%60;
  return`${m}:${sec.toString().padStart(2,'0')}`;
}

// ── Color delta vs media de pista ─────────────────────────────────────────
function _enDeltaColor(d){
  if(d===null||d===undefined||isNaN(d))return'#2d2f38';
  if(d<-0.5)return'#c084fc'; // mucho más rápido
  if(d<-0.2)return'#22c55e'; // más rápido
  if(d<0.2)return'#9ca3af';  // neutral
  if(d<0.5)return'#fbbf24';  // más lento
  return'#ef4444';            // mucho más lento
}

// ── Vueltas limpias ───────────────────────────────────────────────────────
// Filtra outliers: vueltas ≥ 180s (pit, incidente), vueltas > mediana + 2s,
// y vueltas parciales del circuito (< mediana × 0.7 — tiempos imposibles
// que Apex registra cuando un kart cruza meta desde el pit exit).
function _enCleanLaps(hist){
  if(!hist||hist.length<2)return[];
  const clean=hist.filter(t=>t<180);
  if(clean.length<2)return clean;
  const sorted=[...clean].sort((a,b)=>a-b);
  const median=sorted[Math.floor(sorted.length/2)];
  return clean.filter(t=>t>=median*0.7&&t<=median+2);
}

// ── Consistencia últimas 5 vueltas → {label, color} ──────────────────────
function _enCons(hist){
  const clean=_enCleanLaps(hist);
  const l=clean.slice(-5);
  if(l.length<2)return null;
  const mn=Math.min(...l),mx=Math.max(...l),r=mx-mn;
  if(r<0.3)return{label:'Muy regular',color:'#22c55e'};
  if(r<0.5)return{label:'Regular',color:'#4ade80'};
  if(r<1.0)return{label:'Irregular',color:'#fbbf24'};
  return{label:'Errático',color:'#ef4444'};
}

// ── Media de las últimas 5 vueltas limpias ────────────────────────────────
function _enAvg5(hist){
  if(!hist||hist.length<2)return null;
  const clean=_enCleanLaps(hist);
  const last5=clean.slice(-5);
  if(last5.length<2)return null;
  return last5.reduce((a,b)=>a+b,0)/last5.length;
}

// ── Tendencia de ritmo (últimas 3 vueltas vs las 3 anteriores) ────────────
function _enTrend(hist){
  if(!hist||hist.length<6)return{arrow:'',color:'#333'};
  const clean=_enCleanLaps(hist);
  if(clean.length<6)return{arrow:'',color:'#333'};
  const recent=clean.slice(-3);
  const prev=clean.slice(-6,-3);
  const avgR=recent.reduce((a,b)=>a+b,0)/3;
  const avgP=prev.reduce((a,b)=>a+b,0)/3;
  const diff=avgR-avgP;
  if(diff<-0.15)return{arrow:'↑',color:'#22c55e'}; // mejorando
  if(diff>0.15)return{arrow:'↓',color:'#ef4444'};   // empeorando
  return{arrow:'→',color:'#555'};                    // estable
}

// ── Ruido de ritmo (desviación típica de las últimas vueltas limpias) ─────
// Cuánto oscila un equipo de vuelta a vuelta. Es el "yardstick" de la
// incertidumbre: si dos equipos están más juntos que este ruido, no se
// pueden separar con honestidad.
function _enPaceStd(hist){
  const DEFAULT_STD=0.4; // s — oscilación típica de un kart si no hay datos
  const clean=_enCleanLaps(hist).slice(-10);
  if(clean.length<3)return DEFAULT_STD;
  const m=clean.reduce((a,b)=>a+b,0)/clean.length;
  const v=clean.reduce((a,b)=>a+(b-m)*(b-m),0)/clean.length;
  return Math.max(0.05, Math.sqrt(v));
}

// ── Densidad / confianza de la clasificación estimada ─────────────────────
// Agrupa equipos consecutivos cuya diferencia de gap estimado es menor que el
// "swing" plausible sobre las vueltas restantes. Modelo: el hueco entre dos
// karts de ritmo similar hace un paseo aleatorio con paso = ruido combinado,
// así que su deriva tras R vueltas ≈ ruido·√R. Si la diferencia real cabe
// dentro de ese swing, las posiciones son intercambiables → mismo tier.
//
// Propiedad buscada: al principio (R grande) casi todo es un tier (no se puede
// precisar, honesto); al final (R→0) el swing→0 y todo se separa.
//
// entries: [{estimatedGap:Number, lapHistory:[...]}] ORDENADOS por estimatedGap asc.
// remainingLaps: vueltas que faltan (0 = fin).
// k: sensibilidad (1 = un swing de 1σ; menor = más estricto).
// Devuelve array de tier-id (mismo id en consecutivos = grupo "en juego").
function _enDensityTiers(entries, remainingLaps, k){
  if(k===undefined)k=1.0;
  const R=Math.max(0, remainingLaps||0);
  const tiers=new Array(entries.length).fill(0);
  for(let i=1;i<entries.length;i++){
    const d=entries[i].estimatedGap-entries[i-1].estimatedGap;
    const sA=_enPaceStd(entries[i].lapHistory);
    const sB=_enPaceStd(entries[i-1].lapHistory);
    const swing=Math.sqrt(sA*sA+sB*sB)*Math.sqrt(R);
    tiers[i]= d < k*swing ? tiers[i-1] : tiers[i-1]+1;
  }
  return tiers;
}

// ── Saneo del gap al líder (artefacto de las paradas) ─────────────────────
// El gap de Apex es la distancia EN PISTA ahora mismo. Cuando un equipo acaba
// de parar, se dispara ~un ciclo de pit (p.ej. +152s) sin reflejar su posición
// real de carrera → el estimador lo hunde injustamente. En esos momentos el
// gap por POSICIÓN DE VUELTAS (vueltas de diferencia × ritmo) es más estable.
//
// Regla:
//  - En boxes (inPit) → el gap de Apex no vale → usar gap por vueltas.
//  - Pico de pit: si el gap de Apex supera al de vueltas por más de medio coste
//    de parada, es un artefacto de rejoin → usar gap por vueltas.
//  - Normal → preferir el gap de Apex (segundos, más fino), con suelo en vueltas.
// Requiere que lapsGap sea fiable (depende del fix de vueltas por lapHistory).
function _enResolveGap(opts){
  const apexGap=opts.apexGap||0;
  const lapsGap=opts.lapsGap||0;
  const inPit=!!opts.inPit;
  const pitCost=opts.pitCost||120;
  if(inPit) return lapsGap;
  if(apexGap > lapsGap + pitCost*0.5) return lapsGap; // spike de rejoin tras parada
  return Math.max(apexGap, lapsGap);
}

// ── Orden de la clasificación estimada: SIEMPRE la posición de Apex ────────
// Apex es la fuente del dato y su posición es la verdad de carrera; conoce el gap
// al segundo. Reordenar por `estimatedGap` (gap normalizado por paradas pendientes,
// que se mueve en vueltas enteras) mete ruido sobre una señal ya buena.
//
// Medido en 4 carreras reales (2026-07-31, concordancia de pares vs clasificación
// final): Apex gana SIEMPRE en enduro de alquiler de una categoría —
//   IRONMAN Los Santos  0.829 vs 0.784  (−0.044)
//   3H por equipos      0.733 vs 0.468  (−0.265, el caso más limpio y el peor)
//   RKC 2 HEURES        0.824 vs 0.744
// La única victoria (Le Mans 6H) era artefacto de tener dos categorías en pista.
// El "7/7 de Ariza" que fundó el diseño anterior era UN instante (min 75), no la
// media: en la carrera completa ya perdía 0.725 vs 0.853.
//
// `estimatedGap` NO se tira: sigue siendo información útil (deuda de paradas y lo
// que vale en segundos) y lo consume el detector "closing" de en-ai-alerts.js como
// valor numérico. Lo que se retira es su papel de criterio de ORDEN.
// Mutación in situ (Array.sort); orden total → transitivo y estable.
function _enOrderEstimated(items){
  if(!Array.isArray(items)||items.length===0)return items;
  return items.sort((a,b)=>(a.pos==null?99:a.pos)-(b.pos==null?99:b.pos));
}

// ── Offset del túnel según el sentido de pista ─────────────────────────────
// Un circuito puede correrse en los dos sentidos y el offset pit-exit→meta cambia
// radicalmente (Henakart: 39.5s normal vs 20.0s inverso). Apex no dice el sentido
// en el feed, así que lo elige el usuario — en el setup o, si cambia a mitad de
// carrera, desde el toggle de la pestaña Avanzado.
//
// `own`  = lo calibrado en ESTE dispositivo para ese sentido (localStorage).
// `known`= el valor de fábrica medido en sesiones reales (CircuitDB.knownOffsets).
// Lo propio manda por ser más reciente y afinado, pero solo si es creíble: el mismo
// rango de cordura (>3s y <300s) que ya aplicaba el setup. Devuelve null cuando no
// hay valor utilizable — ese sentido se calibra en vivo (p.ej. Ariza en normal,
// que nunca se ha medido).
function _enSaneOffset(v){
  const n=parseFloat(v);
  return (!isNaN(n)&&n>3&&n<300)?n:null;
}
function _enResolveDirectionOffset(own, known){
  const propio=_enSaneOffset(own);
  if(propio!=null)return propio;
  return _enSaneOffset(known);
}

// Estado de calibración tras cambiar de sentido A MITAD DE CARRERA.
// Además de recargar el offset del nuevo sentido, **descarta las mediciones en
// vuelo**: el offset se sella al salir de boxes y se resuelve en el siguiente paso
// por meta, así que una medición que cruza el cambio salió en un sentido y cruzó
// meta en el otro — incoherente. Antes se guardaba en la clave del sentido NUEVO y
// lo contaminaba. En Henakart el sentido se invierte en una parada SINCRONIZADA de
// toda la parrilla, con lo que ese caso no es la excepción sino la norma.
// `pitOutPending` se recibe solo para dejar explícito que se tira.
function _enDirectionSwitchState(own, known, pitOutPending){
  const off=_enResolveDirectionOffset(own, known);
  return {
    pitOutCalibration: off!=null?[off,off]:[],
    pitOutPending: {},
  };
}

// ── Merge del historial de vueltas (modo logger) ──────────────────────────
// Los updates live del logger llevan solo las últimas N vueltas (ventana) más
// el contador total del parser (lapHistoryTotal). Se añaden al historial
// acumulado exactamente las vueltas nuevas según la diferencia de contadores.
// NUNCA dedup por valor: los tiempos de vuelta se repiten (±0.05s) y ese
// criterio descartaba vueltas reales, congelando el historial en carreras largas.
//
// prevHist: historial acumulado en el cliente · prevTotal: contador ya procesado
// window: ventana recibida (últimas N) · total: contador actual del servidor
// Devuelve el historial fusionado, o null si falta algún contador (el llamante
// decide el fallback para servidores antiguos sin lapHistoryTotal).
function _enMergeLapHistory(prevHist, prevTotal, window, total){
  if(total==null||prevTotal==null)return null;
  prevHist=prevHist||[]; window=window||[];
  const newCount=total-prevTotal;
  // Sin vueltas nuevas — o contador hacia atrás (reinicio del servidor a mitad
  // de sesión): conservar lo acumulado, el contador se resincroniza fuera.
  if(newCount<=0)return prevHist;
  const tail=window.slice(-Math.min(newCount,window.length));
  const merged=[...prevHist,...tail];
  return merged.length>1500?merged.slice(-1500):merged;
}

if(typeof module!=='undefined')module.exports={_enFmt,_enFmtGap,_enFmtDelta,_enFmtStint,_enDeltaColor,_enCleanLaps,_enCons,_enAvg5,_enTrend,_enPaceStd,_enDensityTiers,_enResolveGap,_enOrderEstimated,_enMergeLapHistory,_enResolveDirectionOffset,_enDirectionSwitchState};
