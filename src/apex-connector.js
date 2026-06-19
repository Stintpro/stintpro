// ── Apex Timing WebSocket Connector v2.0 ─────────────────────────────────
// Reescrito desde cero basado en análisis de logs reales de 10+ circuitos.
// Protocolo confirmado: llp/blp siempre llevan valor; |*| llega después.

window.ApexConnector = {
  ws:null, slug:null, port:7913, connected:false,
  onData:null, onStatus:null, onComment:null,
  _karts:{}, _comments:[], _reconnectTimer:null,
  _sessionActive:false, _sessionFinished:false, _leaderLap:0,
  _colMap:{}, _colByNum:{}, _lastLapTime:0,
  _httpPort:null, _historyFetched:false,

  connect(slug, onData, onStatus, onComment, port){
    this.slug=slug; this.port=port||7913;
    this.onData=onData; this.onStatus=onStatus; this.onComment=onComment;
    this._karts={}; this._comments=[];
    this._sessionActive=false; this._sessionFinished=false;
    this._leaderLap=0; this._colMap={}; this._colByNum={}; this._lastLapTime=0;
    this._httpPort=null; this._historyFetched=false;
    if(this.ws){try{this.ws.close();}catch(e){} this.ws=null;}
    if(this._reconnectTimer){clearTimeout(this._reconnectTimer);this._reconnectTimer=null;}
    this._doConnect();
    this._fetchHttpPort();
  },

  _doConnect(){
    try{
      this.ws=new WebSocket(`wss://live-data.apex-timing.com:${this.port}/`);
      this.ws.onopen=()=>{
        this.connected=true;
        if(this.onStatus)this.onStatus('connected','● Apex conectado');
        this.ws.send(this.slug);
      };
      this.ws.onmessage=(e)=>this._parse(e.data);
      this.ws.onerror=()=>{if(this.onStatus)this.onStatus('error','● Error de conexión');};
      this.ws.onclose=()=>{
        this.connected=false;
        if(this.onStatus)this.onStatus('disconnected','● Reconectando...');
        if(this.slug)this._reconnectTimer=setTimeout(()=>this._doConnect(),5000);
      };
    }catch(e){if(this.onStatus)this.onStatus('error','● No se pudo conectar');}
  },

  disconnect(){
    this.slug=null;
    if(this._reconnectTimer){clearTimeout(this._reconnectTimer);this._reconnectTimer=null;}
    if(this.ws){try{this.ws.close();}catch(e){} this.ws=null;}
    this.connected=false;
  },

  _parse(raw){
    const lines=raw.split('\n'); let changed=false;
    for(let line of lines){
      line=line.trim(); if(!line)continue;

      // ── VUELTA COMPLETA: r1|*|67234|24403 ───────────────────────
      const lapM=line.match(/^(r\d+)\|\*\|(\d+)\|(\d*)$/);
      if(lapM){
        const k=this._kart(lapM[1]), ms=parseInt(lapM[2]);
        if(ms>=20000&&ms<300000){
          this._lastLapTime=Date.now();
          if(!k._lapInvalid){
            k._lapFlash=Date.now();
            // |*| registra siempre — respuesta inmediata al cruzar meta.
            // Si llega llp después, lo refina (sin duplicar) sea cual sea la diferencia.
            const t=parseFloat((ms/1000).toFixed(3));
            const lastH=k.lapHistory[k.lapHistory.length-1];
            if(lastH===undefined||Math.abs(lastH-t)>0.05){
              k.lastLap=t;
              k.lapHistory.push(t);
              if(k.lapHistory.length>1500)k.lapHistory.shift();
              if(!k.bestLap||t<k.bestLap)k.bestLap=t;
            }
            k._lapFromFlash=t;
            k._lapFromFlashTs=Date.now();
          }
          k._lapInvalid=false;
          // S1 en circuitos con sectores
          const val2=parseInt(lapM[3]);
          if(!isNaN(val2)&&val2>0&&this._colMap.s1)k.s1Ms=val2;
        }
        changed=true; continue;
      }

      // ── PIT MARKERS: r1|*in|0 / r1|*out|0 / r1|*|| ─────────────
      if(line.match(/^r\d+\|\*(in|out)\|0$/)){
        this._kart(line.split('|')[0])._lapInvalid=true;
        changed=true; continue;
      }
      if(line.match(/^r\d+\|\*\|\|$/)){changed=true; continue;}

      // ── SECTOR PARCIAL: r1|*i1|ms ───────────────────────────────
      if(line.match(/^r\d+\|\*i\d+\|/)){changed=true; continue;}

      // ── POSICIÓN DIRECTA: r1|#|5 ────────────────────────────────
      const posM=line.match(/^(r\d+)\|#\|(\d+)$/);
      if(posM){
        const p=parseInt(posM[2]);
        if(p>0){
          const k=this._kart(posM[1]);
          if(k.pos&&k.pos!==p)k._posChange={from:k.pos,to:p,delta:k.pos-p,time:Date.now()};
          k.pos=p;
        }
        changed=true; continue;
      }

      // ── GRID ─────────────────────────────────────────────────────
      if(line.startsWith('grid|')){
        // Nueva sesión si: bandera a cuadros recibida, O si no hay vueltas en >10 min
        const inactiveTooLong=this._lastLapTime&&(Date.now()-this._lastLapTime)>600000;
        if(this._sessionActive&&(this._sessionFinished||inactiveTooLong)){
          this._karts={}; this._leaderLap=0;
          this._sessionFinished=false; this._lastLapTime=0;
          if(window.ApexClock&&window.ApexClock.reset)window.ApexClock.reset();
          if(this.onStatus)this.onStatus('connected','● Nueva sesión');
        }
        this._sessionActive=true;
        this._parseGrid(line.substring(5));
        changed=true; continue;
      }

      // ── RELOJ COUNTDOWN ─────────────────────────────────────────
      if(line.startsWith('dyn1|countdown|')){
        const ms=parseInt(line.split('|')[2])||null;
        if(ms!==null&&window.ApexClock)window.ApexClock.sync(ms,'countdown');
        changed=true; continue;
      }

      // ── RELOJ ASCENDENTE ────────────────────────────────────────
      if(line.startsWith('dyn1|count|')){
        const ms=parseInt(line.split('|')[2])||null;
        if(ms!==null&&window.ApexClock)window.ApexClock.sync(ms,'count');
        changed=true; continue;
      }

      // ── TEXTO DYN1 ──────────────────────────────────────────────
      if(line.startsWith('dyn1|text|')){
        const txt=line.substring(10).trim();
        const lapTxt=txt.match(/Lap\s+(\d+)\/(\d+)/i);
        if(lapTxt)this._leaderLap=parseInt(lapTxt[1]);
        if(!txt&&window.ApexClock)window.ApexClock.stop();
        changed=true; continue;
      }

      // ── BANDERA A CUADROS ────────────────────────────────────────
      if(line.startsWith('light|lf')){
        this._sessionFinished=true;
        if(window.ApexClock)window.ApexClock.stop();
        changed=true; continue;
      }

      // ── COMENTARIOS ──────────────────────────────────────────────
      if(line.startsWith('com|')){
        const html=line.substring(line.indexOf('|',4)+1);
        if(html&&html.trim()&&html!=='<p></p>'&&html.length>5)this._parseComment(html);
        changed=true; continue;
      }

      // ── CELDA CON VALOR: r1c6|ti|1:04.893 ───────────────────────
      const cellM=line.match(/^(r\d+)(c\d+)\|([^|]*)\|(.*)/);
      if(cellM){this._applyCell(this._kart(cellM[1]),cellM[2],cellM[3],cellM[4]); changed=true; continue;}

      // ── CELDA SIN VALOR: r1c6|ti ────────────────────────────────
      const cellM2=line.match(/^(r\d+)(c\d+)\|([^|]*)$/);
      if(cellM2){this._applyCell(this._kart(cellM2[1]),cellM2[2],cellM2[3],''); changed=true;}
    }
    if(changed)this._emit();
  },

  _kart(rowId){
    if(!this._karts[rowId])this._karts[rowId]={
      _rowId:rowId, lapHistory:[], state:'sr', tours:0,
      pit:false, pitState:null, pitS:0, pitDuration:0,
      standsCount:0, stops:0, _lapInvalid:false, checkered:false,
      _lapFlash:0, _pitInTime:null, _pitTimerActive:false, _nextLapDirty:false,
    };
    return this._karts[rowId];
  },

  _applyCell(k, col, type, val){
    const dtype=this._colByNum[col]||'';
    const v=(val!==undefined&&val!=='')?val:type;

    // ── Estado ──────────────────────────────────────────────────
    const STATE=['si','so','sr','su','sd','ss','sf','gs','gf','gl','gm'];
    const isStateCol=dtype==='grp'||dtype==='sta';
    const isStateCode=!dtype&&STATE.includes(type);
    if(isStateCol||isStateCode){
      if(type==='in')return;
      k.state=type;
      if(type==='ss')k._lapInvalid=true;
      else if(type==='sr'||type==='su'||type==='sd'||
              type==='gs'||type==='gf'||type==='gl'||type==='gm')k._lapInvalid=false;
      // PIT — si/so activan _lapInvalid para bloquear parcial box→meta
      if(type==='si'){k.pit=true; k.pitState='in'; k._pitInTime=Date.now(); k._lapInvalid=true;}
      else if(type==='so'){k.pit=true; k.pitState='out'; k.pitS=0; k._pitTimerActive=false; k._pitInTime=null; k._lapInvalid=true;}
      else if(type==='sr'||type==='su'){if(!k._pitTimerActive)k.pit=false; k.pitState=null; k._pitInTime=null;}
      if(type==='sf')k.checkered=true;
      return;
    }

    // ── Posición ────────────────────────────────────────────────
    if(dtype==='rk'){
      const p=parseInt(v); if(!isNaN(p)&&p>0){
        if(k.pos&&k.pos!==p)k._posChange={from:k.pos,to:p,delta:k.pos-p,time:Date.now()};
        k.pos=p;
      }
      return;
    }

    // ── Dorsal ──────────────────────────────────────────────────
    if(dtype==='no'){
      const d=(v||'').trim();
      if(d&&!isNaN(parseInt(d)))k.dorsal=d;
      return;
    }

    // ── Nombre ───────────────────────────────────────────────────
    if(dtype==='dr'){
      const n=(v||'').trim();
      const skip=['in','tn','ti','tb','ib','sr','sd','su','si','ss','sf','gf','gl','gm','gs','to','so'];
      if(n&&n.length>1&&isNaN(parseInt(n))&&!skip.includes(n))k.name=n;
      return;
    }

    // ── Sectores ─────────────────────────────────────────────────
    if(dtype==='s1'){const x=parseFloat(v);if(!isNaN(x)&&x>0&&x<120)k.s1=x; return;}
    if(dtype==='s2'){const x=parseFloat(v);if(!isNaN(x)&&x>0&&x<120)k.s2=x; return;}
    if(dtype==='s3'){const x=parseFloat(v);if(!isNaN(x)&&x>0&&x<120)k.s3=x; return;}

    // ── Última vuelta ────────────────────────────────────────────
    // Los logs confirman que llp siempre lleva el tiempo (tb/ti/tn con valor).
    // No se necesita anti-duplicado con |*|: llp llega antes que |*| siempre.
    if(dtype==='llp'){
      const t=this._pt(v);
      if(t&&t>=20&&t<300){
        if(!k.lapHistory)k.lapHistory=[];
        // Si |*| registró esta vuelta hace menos de 5s → refinar, no duplicar.
        // Ventana de 5s: llp tardío (>5s) es de otra vuelta y crea entrada nueva.
        const flashAge=k._lapFromFlashTs?Date.now()-k._lapFromFlashTs:Infinity;
        if(k._lapFromFlash!==undefined&&flashAge<5000&&k.lapHistory.length){
          k.lapHistory[k.lapHistory.length-1]=t;
          k.lastLap=t;
        } else {
          k.lastLap=t;
          k.lapHistory.push(t);
          if(k.lapHistory.length>1500)k.lapHistory.shift();
        }
        k._lapFromFlash=undefined;
        k._lapFromFlashTs=undefined;
        if(!k.bestLap||t<k.bestLap)k.bestLap=t;
      }
      return;
    }

    // ── Mejor vuelta ─────────────────────────────────────────────
    if(dtype==='blp'){
      const t=this._pt(v);
      if(t&&t>=20&&t<300&&(!k.bestLap||t<k.bestLap))k.bestLap=t;
      return;
    }

    // ── Gap al líder ─────────────────────────────────────────────
    if(dtype==='gap'){
      const vRaw=v||'';
      if(/tour|lap|tr\b/i.test(vRaw)){
        const n=parseInt(vRaw.replace(/[^\d]/g,''));
        k.gap=(!isNaN(n)&&n>0)?'+'+n+'v':'';
        return;
      }
      const raw=vRaw.replace(/[a-zA-Z]/g,'').trim();
      if(!raw){k.gap='';return;}
      const t=raw.includes(':')?parseFloat(raw.split(':')[0])*60+parseFloat(raw.split(':')[1]):parseFloat(raw);
      if(!isNaN(t)&&t>=0)k.gap=t>0?'+'+t.toFixed(3):'';
      return;
    }

    // ── Intervalo ────────────────────────────────────────────────
    if(dtype==='int'){
      const raw=(v||'').replace(/[a-zA-Z]/g,'').trim();
      if(!raw){k.interval='';return;}
      const t=raw.includes(':')?parseFloat(raw.split(':')[0])*60+parseFloat(raw.split(':')[1]):parseFloat(raw);
      if(!isNaN(t)&&t>=0)k.interval=t>0?'+'+t.toFixed(3):'';
      return;
    }

    // ── Vueltas ──────────────────────────────────────────────────
    if(dtype==='tlp'||dtype==='lc'){
      const n=parseInt(v);
      if(!isNaN(n)&&n>0)k.tours=n;
      return;
    }

    // ── Pit stops ────────────────────────────────────────────────
    if(dtype==='pit'){
      if(type==='to'){
        const s=this._parsePitTimer(v);
        if(s!==null){k.pitS=s; k.pit=true; k._pitTimerActive=true;}
      }else if(type==='in'){
        k._pitTimerActive=false;
        if(k.state==='sr'||k.state==='su')k.pit=false;
        const n=parseInt(v);
        if(!isNaN(n)&&n>0)k.standsCount=n;
      }
      return;
    }

    // ── Tiempo en pista ──────────────────────────────────────────
    if(dtype==='otr')return;

    // ── Columnas sin dtype — solo pit timer y sf ─────────────────
    if(type==='to'){
      const s=this._parsePitTimer(v);
      if(s!==null){k.pitS=s; k.pit=true; k._pitTimerActive=true;}
      return;
    }
    if(type==='sf'){k.checkered=true; return;}
  },

  _parsePitTimer(v){
    if(!v)return null;
    v=v.replace(/\.$/,'').trim();
    if(v.includes(':')){
      const p=v.split(':');
      const s=parseInt(p[0])*60+parseFloat(p[1]);
      return isNaN(s)?null:Math.round(s);
    }
    const s=parseFloat(v);
    return isNaN(s)?null:Math.round(s);
  },

  _pt(str){
    if(!str)return null;
    str=str.replace(/[a-zA-Z]/g,'').replace(/\.$/,'').trim();
    if(!str||str.length<2)return null;
    if(str.includes(':')){
      const p=str.split(':');
      const v=parseFloat(p[0])*60+parseFloat(p[1]);
      return isNaN(v)?null:parseFloat(v.toFixed(3));
    }
    const n=parseFloat(str);
    if(isNaN(n)||n<1)return null;
    return n>1000?parseFloat((n/1000).toFixed(3)):n;
  },

  _parseGrid(html){
    if(!html||html.length<10)return;
    try{
      const doc=new DOMParser().parseFromString(
        `<table><tbody>${html}</tbody></table>`,'text/html');

      // Construir colMap desde r0
      const r0=doc.querySelector('tr[data-id="r0"]');
      if(r0){
        this._colMap={}; this._colByNum={};
        r0.querySelectorAll('td[data-id]').forEach(td=>{
          const cid=td.getAttribute('data-id');
          const dtype=(td.getAttribute('data-type')||'').trim();
          if(cid&&dtype){this._colMap[dtype]=cid; this._colByNum[cid]=dtype;}
        });
      }

      // Parsear filas de karts
      let gridPos=0;
      doc.querySelectorAll('tr[data-id]').forEach(row=>{
        const rowId=row.getAttribute('data-id');
        if(!rowId||rowId==='r0')return;
        gridPos++;
        const k=this._kart(rowId);

        // Estado
        const stCol=this._colMap.grp||this._colMap.sta||'c1';
        const stCell=row.querySelector(`[data-id$="${stCol}"]`);
        if(stCell){const cls=stCell.className.trim();if(cls&&cls!=='in'){
          k.state=cls; if(cls==='sf')k.checkered=true;
        }}

        // Posición
        const rkP=row.querySelector('td.rk p');
        if(rkP){const p=parseInt(rkP.textContent.trim());if(!isNaN(p)&&p>0)k.pos=p;}
        else k.pos=k.pos||gridPos;

        // Dorsal
        const noCol=this._colMap.no;
        if(noCol){
          const noDiv=row.querySelector(`[data-id$="${noCol}"] div`)||row.querySelector('td.no div');
          if(noDiv){const d=noDiv.textContent.trim();if(d&&!isNaN(parseInt(d)))k.dorsal=d;}
        }

        // Nombre
        const drCol=this._colMap.dr;
        const drCell=drCol?row.querySelector(`[data-id$="${drCol}"]`):row.querySelector('.dr');
        if(drCell){const t=drCell.textContent.trim();if(t&&isNaN(parseInt(t)))k.name=t;}

        // Mejor vuelta
        const blpCol=this._colMap.blp;
        if(blpCol){
          const blpCell=row.querySelector(`[data-id$="${blpCol}"]`);
          if(blpCell){const t=this._pt(blpCell.textContent);if(t&&t>=20&&t<300)k.bestLap=t;}
        }

        // Última vuelta — solo si no hay valor en vivo todavía
        const llpCol=this._colMap.llp;
        if(llpCol){
          const llpCell=row.querySelector(`[data-id$="${llpCol}"]`);
          if(llpCell){const t=this._pt(llpCell.textContent);if(t&&t>=20&&t<300&&!k.lastLap)k.lastLap=t;}
        }

        // Vueltas
        const tlpCol=this._colMap.tlp;
        if(tlpCol){
          const tlpCell=row.querySelector(`[data-id$="${tlpCol}"]`);
          if(tlpCell){const n=parseInt(tlpCell.textContent.trim());if(!isNaN(n)&&n>0)k.tours=n;}
        }

        // Pit stops
        const pitCol=this._colMap.pit;
        if(pitCol){
          const pitCell=row.querySelector(`[data-id$="${pitCol}"]`);
          if(pitCell){const n=parseInt(pitCell.textContent.trim());if(!isNaN(n)&&n>=0)k.standsCount=n;}
        }

        k.tours=k.tours||0;
      });

      // Disparar fetch de historial de vueltas en cuanto tengamos el grid
      // Solo una vez por sesión; se cancela solo si no hay puerto HTTP disponible
      if(!this._historyFetched)this._fetchLapHistories();
    }catch(e){console.error('parseGrid:',e);}
  },

  _parseComment(html){
    try{
      const doc=new DOMParser().parseFromString(`<div>${html}</div>`,'text/html');
      const entries=[];
      doc.querySelectorAll('p').forEach(p=>{
        const txt=p.textContent.trim();
        if(txt&&txt.length>2){
          const m=txt.match(/^(\d{1,2}:\d{2})/);
          const time=m?m[1]:new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
          const text=m?txt.substring(m[0].length).trim():txt;
          if(text)entries.push({text,time});
        }
      });
      if(!entries.length){
        const txt=doc.body.textContent.trim();
        if(txt&&txt.length>2)entries.push({text:txt,
          time:new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})});
      }
      entries.forEach(e=>{
        this._comments.unshift(e);
        if(this._comments.length>100)this._comments.pop();
        if(this.onComment)this.onComment(e,this._comments);
      });
    }catch(e){}
  },

  async _fetchHttpPort(){
    if(!this.slug)return;
    try{
      const res=await fetch(`https://live.apex-timing.com/${this.slug}/javascript/config.js`,
        {signal:AbortSignal.timeout?AbortSignal.timeout(5000):undefined});
      const text=await res.text();
      const m=text.match(/var configPort\s*=\s*(\d+)/);
      if(m)this._httpPort=parseInt(m[1]);
    }catch(e){}
  },

  async _fetchLapHistories(){
    if(this._historyFetched)return;
    if(!this._httpPort)return;
    const kartEntries=Object.entries(this._karts).filter(([,k])=>k.dorsal);
    if(!kartEntries.length)return;
    this._historyFetched=true;
    if(this.onStatus)this.onStatus('connected','● Cargando historial...');

    const BASE='https://live-data.apex-timing.com/live-timing/commonv2/functions/request.php';
    const port=this._httpPort;

    // Fetch en paralelo, máx 30 karts
    await Promise.allSettled(kartEntries.slice(0,30).map(async([rowId,k])=>{
      const id=rowId.replace('r','');
      try{
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),8000);
        // Formato combinado requerido por el servidor: .L + .P + .B + .INF
        const req=`D%23-100%23D${id}.L%23-999%23D${id}.P%232%23D${id}.B%231%23D${id}.INF`;
        const res=await fetch(BASE,{
          method:'POST',
          headers:{'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest'},
          body:`port=${port}&request=${req}`,
          signal:controller.signal,
        });
        clearTimeout(timer);
        const text=(await res.text()).trim();
        if(!text||text==='error')return;

        // Parsear líneas: D{id}.L{n}#{s1}|{s2}|{s3}|{lapMs}{color}
        const laps=[];
        text.split('\n').forEach(line=>{
          const m=line.match(new RegExp(`^D${id}\\.L(\\d+)#[^|]*\\|[^|]*\\|[^|]*\\|([\\da-zA-Z]+)`));
          if(!m)return;
          const ms=parseInt(m[2].replace(/[a-zA-Z]/g,''));
          if(isNaN(ms)||ms<20000||ms>=300000)return;
          laps.push({n:parseInt(m[1]),t:parseFloat((ms/1000).toFixed(3))});
        });

        // Ordenar por número de vuelta y poblar lapHistory
        laps.sort((a,b)=>a.n-b.n);
        if(laps.length){
          // Usar el estado ACTUAL de lapHistory al momento del merge (no al inicio del fetch)
          // — durante el fetch el WS puede haber añadido vueltas nuevas
          const currentLaps=k.lapHistory;
          const httpTimes=laps.map(l=>l.t);
          // Filtrar HTTP: no añadir vueltas que el WS ya registró (anti-duplicado)
          const toAdd=httpTimes.filter(t=>!currentLaps.some(l=>Math.abs(l-t)<0.05));
          // HTTP va al principio (historial antiguo), WS al final (más reciente)
          k.lapHistory=[...toAdd,...currentLaps];
          if(k.lapHistory.length>1500)k.lapHistory=k.lapHistory.slice(-1500);
          // NO setear lastLap desde HTTP — solo el WS (llp/|*|) es fuente de verdad para Última
          // tours: usar el máximo entre lo que ya tenía el WS y el nº de vueltas del HTTP
          k.tours=Math.max(k.tours||0, laps.length);
          const best=Math.min(...k.lapHistory);
          if(!k.bestLap||best<k.bestLap)k.bestLap=best;
        }
      }catch(e){}
    }));

    if(this.onStatus)this.onStatus('connected','● Apex conectado');
    this._emit();
  },

  _emit(){
    if(!this.onData)return;
    const now=Date.now();
    const equipos=Object.values(this._karts)
      .filter(k=>k.dorsal||k._rowId)
      .map(k=>{if(!k.dorsal)k.dorsal=k._rowId.replace('r',''); return k;})
      .map(k=>({
        dorsal:k.dorsal, name:k.name||`#${k.dorsal}`,
        pos:k.pos||99, lastLap:k.lastLap||null, bestLap:k.bestLap||null,
        lapHistory:k.lapHistory||[], gap:k.gap||'', interval:k.interval||'',
        pit:!!k.pit, pitState:k.pitState||null,
        pitS:k._pitTimerActive?k.pitS:(k.pit&&k._pitInTime?Math.round((now-k._pitInTime)/1000):k.pitS||0),
        pitDuration:k.pitDuration||0,
        state:k.state||'sr', s1:k.s1, s2:k.s2, s3:k.s3,
        tours:k.tours||0, standsCount:k.standsCount||0, stops:k.stops||0,
        checkered:!!k.checkered, gapMs:k.gapMs||0,
        lapFlash:!!(k._lapFlash&&(now-k._lapFlash)<2000),
        posChange:k._posChange&&(now-k._posChange.time)<5000?k._posChange:null,
        sessionFinished:this._sessionFinished,
      }))
      .sort((a,b)=>a.pos===99&&b.pos===99?parseInt(a.dorsal)-parseInt(b.dorsal):a.pos-b.pos);
    this.onData({
      equipos, leaderLap:this._leaderLap,
      timestamp:now, sessionFinished:this._sessionFinished,
      colMap:this._colMap,
    });
  }
};
