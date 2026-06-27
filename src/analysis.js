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

if(typeof module!=='undefined')module.exports={_enFmt,_enFmtGap,_enFmtDelta,_enFmtStint,_enDeltaColor,_enCleanLaps,_enCons,_enAvg5,_enTrend};
