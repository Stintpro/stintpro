window.H = {
  med(a)  { if(!a||!a.length)return null; const s=[...a].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; },
  best(a) { return a&&a.length?Math.min(...a):null; },

  cons(a) {
    const r=_enCons(a);
    if(!r)return null;
    if(r.label==='Muy regular')return 100;
    if(r.label==='Regular')    return 80;
    if(r.label==='Irregular')  return 50;
    return 20;
  },

  diag(laps,trackAvg) {
    if(!laps||laps.length<3||!trackAvg)return{label:'Sin datos',cls:'b-gray',fast:false,reliable:false};
    laps=laps.slice(-5);
    const med=this.med(laps),best=this.best(laps),cons=this.cons(laps);
    const delta=trackAvg-med,bestDelta=trackAvg-best;
    if(cons>=70&&delta>0.5) return{label:'Kart bueno',cls:'b-bueno',fast:true,reliable:true,detail:'Regular · kart rápido confirmado'};
    if(cons>=70&&delta<-0.5)return{label:'Kart malo',cls:'b-malo',fast:false,reliable:true,detail:'Regular · kart lento confirmado'};
    if(cons>=70)            return{label:'Neutral',cls:'b-neutral',fast:false,reliable:true,detail:'Regular · kart en la media'};
    if(cons<50&&bestDelta>0.5)return{label:'Techo alto',cls:'b-neutral',fast:true,reliable:false,detail:'Errático · kart con potencial'};
    if(cons<50&&delta<-0.3) return{label:'Sin conclusión',cls:'b-gray',fast:false,reliable:false,detail:'Errático · kart aparentemente lento'};
    return{label:'Neutral',cls:'b-neutral',fast:false,reliable:false,detail:'Datos insuficientes'};
  },

  consColor(v){ if(v===null)return 'var(--text-3)'; if(v>=80)return 'var(--green)'; if(v>=50)return 'var(--orange)'; return 'var(--red)'; },
  consLabel(v){ if(v===null)return '—'; if(v>=90)return 'Muy regular'; if(v>=70)return 'Regular'; if(v>=40)return 'Irregular'; return 'Errático'; },

  fmtLap(s) {
    if(!s||s<=0)return '—';
    if(window.ApexClock)return window.ApexClock.fmtLapS(s);
    if(s>=60){const m=Math.floor(s/60),sc=(s%60).toFixed(3);return`${m}:${sc.padStart(6,'0')}`;}
    return`${s.toFixed(3)}s`;
  },

  fmtT(s) {
    s=Math.floor(Math.abs(s));
    const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60;
    return h>0?`${h}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`:`${m}:${String(sc).padStart(2,'0')}`;
  },

  fmtM(s) { s=Math.abs(s); return`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`; },
  fmtMs(ms){ if(!ms||ms<=0)return '—'; return this.fmtM(Math.floor(ms/1000)); },

  trackAvg(equipos) {
    const vals=equipos.filter(e=>!e.pit&&e.laps&&e.laps.length>=3)
      .map(e=>this.med(e.laps)).filter(v=>v&&v>20&&v<300);
    if(vals.length<2)return null;
    vals.sort((a,b)=>a-b);
    return vals[Math.floor(vals.length/2)];
  },

  stateLabel(s){ const m={sr:'En pista',si:'En boxes',sd:'Entrando pit',su:'Saliendo pit',so:'Finalizado',ss:'Parado'}; return m[s]||'En pista'; },
  isPit(s){ return s==='si'; }, // solo si cronómetro pit activo (c13|to|XX.)

  stintUrgency(se,stintMax,stintMin) {
    if(!se||se===0)return 'unknown';
    const pct=se/stintMax;
    if(se<stintMin)return 'forbidden';
    if(pct>=0.95)  return 'critical';
    if(pct>=0.80)  return 'warning';
    return 'ok';
  },

  stintColor(u){ const m={forbidden:'var(--red)',critical:'var(--red)',warning:'var(--orange)',ok:'var(--green)',unknown:'var(--text-3)'}; return m[u]||'var(--text-3)'; },

  calcOLA(equipos){ return[...equipos].filter(e=>!e.pit).sort((a,b)=>(a.posEnPista||a.pos||99)-(b.posEnPista||b.pos||99)); },

  calcClasifEstimada(equipos,cfg,clkS) {
    const raceDurS=cfg.duration*3600, remaining=Math.max(0,raceDurS-clkS);
    return equipos.map(e=>{
      const m=this.med(e.laps)||50;
      const vueltasYa=Math.round(Math.max(0,(clkS-(e.tPit||0))/m));
      const paradasPend=Math.max(0,cfg.stops-(e.paradas||0));
      const tiempoFut=Math.max(0,remaining-paradasPend*cfg.pitMinTime*60);
      const vueltasFut=Math.round(tiempoFut/m);
      return{...e,vueltasYa,vueltasFut,vueltasTotal:vueltasYa+vueltasFut,paradasPend};
    }).sort((a,b)=>b.vueltasTotal-a.vueltasTotal);
  },

  calcPitProb(pitKarts,nKarts,pitLayout) {
    const total=nKarts;
    const buenos=pitKarts.filter(k=>k.diag&&k.diag.fast).length;
    const neutrales=pitKarts.filter(k=>k.diag&&!k.diag.fast&&k.diag.label!=='Sin datos'&&k.diag.label!=='Kart malo').length;
    const malos=pitKarts.filter(k=>k.diag&&k.diag.label==='Kart malo').length;
    const sinDatos=pitKarts.filter(k=>!k.diag||k.diag.label==='Sin datos').length;
    const cols=pitLayout==='fila1'?1:pitLayout==='fila2'?2:total;
    const fr=Math.min(cols,total)/total;
    const prob1=buenos>0?Math.round((buenos/total)*fr*100):0;
    const prob2=buenos>0&&pitLayout!=='libre'?Math.round((buenos/total)*Math.min(cols*2,total)/total*100):prob1;
    return{prob1,prob2,buenos,neutrales,malos,sinDatos,total};
  }
};
