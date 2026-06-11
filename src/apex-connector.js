// ── Apex Timing WebSocket Connector v1.1 ─────────────────────────────────
// Mapeo dinámico de columnas desde data-type del grid r0
// Protocolo confirmado con datos reales de 10+ circuitos

window.ApexConnector = {
  ws:null, slug:null, connected:false,
  onData:null, onStatus:null, onComment:null,
  _karts:{}, _comments:[], _reconnectTimer:null,
  _sessionActive:false, _leaderLap:0,
  _colMap:{},        // data-type → número de columna (ej: {llp:'c9', blp:'c10', ...})
  _colByNum:{},      // número de columna → data-type (ej: {c9:'llp', c10:'blp', ...})
  _sessionFinished:false,

  connect(slug, onData, onStatus, onComment, port) {
    this.slug=slug; this.port=port||7913;
    this.onData=onData; this.onStatus=onStatus; this.onComment=onComment;
    this._karts={}; this._comments=[];
    this._sessionActive=false; this._sessionFinished=false;
    this._leaderLap=0; this._colMap={}; this._colByNum={};
    if(this.ws){try{this.ws.close();}catch(e){} this.ws=null;}
    if(this._reconnectTimer){clearTimeout(this._reconnectTimer);this._reconnectTimer=null;}
    this._doConnect();
  },

  _doConnect() {
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

  disconnect() {
    this.slug=null;
    if(this._reconnectTimer){clearTimeout(this._reconnectTimer);this._reconnectTimer=null;}
    if(this.ws){try{this.ws.close();}catch(e){} this.ws=null;}
    this.connected=false;
  },

  _parse(raw) {
    const lines=raw.split('\n'); let changed=false;
    lines.forEach(line=>{
      line=line.trim(); if(!line) return;

      // ── VUELTA COMPLETA ──────────────────────────────────────────
      const lapM=line.match(/^(r\d+)\|\*\|(\d+)\|(\d*)$/);
      if(lapM){
        const k=this._kart(lapM[1]), ms=parseInt(lapM[2]);
        if(ms>=20000&&ms<300000){
          if(!k.lapHistory)k.lapHistory=[];
          if(!k._lapInvalid){
            k._lapFlash=Date.now();
            // FALLBACK: registrar el tiempo desde |*| — llp lo refinará si llega.
            // Sin esto, si las celdas llp no llegan (colMap/circuito), nadie muestra tiempos.
            const t=parseFloat((ms/1000).toFixed(3));
            const lastH=k.lapHistory[k.lapHistory.length-1];
            if(lastH===undefined||Math.abs(lastH-t)>0.05){
              k.lastLap=t;
              k.lapHistory.push(t);
              if(k.lapHistory.length>1500)k.lapHistory.shift();
              if(!k.bestLap||t<k.bestLap)k.bestLap=t;
              k._lapFromFlash=t; // marca para que llp no duplique
            }
          }
          k._lapInvalid=false;
        }
        // Segundo valor: S1 en ms en circuitos con sectores — ignorar para gap
        // El gap real viene de la columna gap del grid vía _applyCell
        const val2=parseInt(lapM[3]);
        if(!isNaN(val2)&&val2>0&&this._colMap.s1){
          k.s1Ms=val2;
        }
        changed=true; return;
      }

      // ── VUELTA ANULADA (pit in/out) ──────────────────────────────
      if(line.match(/^r\d+\|\*in\|0$/) || line.match(/^r\d+\|\*out\|0$/)){
        const rowId=line.split('|')[0];
        const k=this._kart(rowId);
        k._lapInvalid=true; // próxima vuelta ignorar para consistencia
        changed=true; return;
      }

      // ── SECTOR PARCIAL ───────────────────────────────────────────
      if(line.match(/^r\d+\|\*i\d+\|/)){changed=true; return;}

      // ── POSICIÓN DIRECTA ─────────────────────────────────────────
      const posM=line.match(/^(r\d+)\|#\|(\d+)$/);
      if(posM){
        const p=parseInt(posM[2]);
        if(p>0){
          const k=this._kart(posM[1]);
          if(k.pos&&k.pos!==p)k._posChange={from:k.pos,to:p,delta:k.pos-p,time:Date.now()};
          k.pos=p;
        }
        changed=true; return;
      }

      // ── GRID INICIAL ─────────────────────────────────────────────
      if(line.startsWith('grid|')){
        // Apex reenvía grid| periódicamente (refresh). Solo es NUEVA sesión
        // si la anterior terminó (bandera de cuadros vista). Si no: merge sin borrar.
        if(this._sessionActive&&this._sessionFinished){
          this._karts={}; this._leaderLap=0;
          this._sessionFinished=false;
          if(window.ApexClock&&window.ApexClock.reset)window.ApexClock.reset();
          if(this.onStatus)this.onStatus('connected','● Nueva sesión');
        }
        this._sessionActive=true;
        this._parseGrid(line.substring(5));
        changed=true; return;
      }

      // ── RELOJ COUNTDOWN ─────────────────────────────────────────
      if(line.startsWith('dyn1|countdown|')){
        const ms=parseInt(line.split('|')[2])||null;
        if(ms!==null&&window.ApexClock)window.ApexClock.sync(ms,'countdown');
        changed=true; return;
      }

      // ── RELOJ ASCENDENTE (Campillos) ────────────────────────────
      if(line.startsWith('dyn1|count|')){
        const ms=parseInt(line.split('|')[2])||null;
        if(ms!==null&&window.ApexClock)window.ApexClock.sync(ms,'count');
        changed=true; return;
      }

      // ── TEXTO DYN1 ──────────────────────────────────────────────
      if(line.startsWith('dyn1|text|')){
        const txt=line.substring(10).trim();
        // Lap X/Y — vuelta del líder
        const lapTxt=txt.match(/Lap\s+(\d+)\/(\d+)/i);
        if(lapTxt)this._leaderLap=parseInt(lapTxt[1]);
        // Vacío = fin de sesión
        if(!txt&&window.ApexClock)window.ApexClock.stop();
        changed=true; return;
      }

      // ── BANDERA A CUADROS ────────────────────────────────────────
      if(line==='light|lf|'){
        this._sessionFinished=true;
        if(window.ApexClock)window.ApexClock.stop();
        changed=true; return;
      }

      // ── COMENTARIOS ──────────────────────────────────────────────
      if(line.startsWith('com|')){
        const html=line.substring(line.indexOf('|',4)+1);
        if(html&&html.trim()&&html!=='<p></p>'&&html.length>5)this._parseComment(html);
        changed=true; return;
      }

      // ── CELDA CON VALOR ──────────────────────────────────────────
      const cellM=line.match(/^(r\d+)(c\d+)\|([^|]*)\|(.*)/);
      if(cellM){this._applyCell(this._kart(cellM[1]),cellM[2],cellM[3],cellM[4]); changed=true; return;}

      // ── CELDA SIN VALOR ──────────────────────────────────────────
      const cellM2=line.match(/^(r\d+)(c\d+)\|([^|]*)$/);
      if(cellM2){this._applyCell(this._kart(cellM2[1]),cellM2[2],cellM2[3],''); changed=true;}
    });
    if(changed)this._emit();
  },

  _kart(rowId){
    if(!this._karts[rowId])this._karts[rowId]={
      _rowId:rowId, lapHistory:[], state:'sr', tours:0,
      pit:false, pitS:0, pitDuration:0, standsCount:0, stops:0,
      _lapInvalid:false, checkered:false,
    };
    return this._karts[rowId];
  },

  // Aplica una actualización de celda usando colMap dinámico
  _applyCell(k, col, type, val){
    const dtype=this._colByNum[col]||'';
    const v=(val!==undefined&&val!=='')?val:type;

    // Códigos de estado inconfundibles — detectarlos VENGAN DE LA COLUMNA QUE VENGAN.
    // Protege contra colMap roto/incompleto (circuitos cuyo grid no mapea la columna de estado).
    const STATE_CODES=['si','so','sr','su','sd','ss','sf','gs','gf','gl','gm'];
    const isStateCol=dtype==='grp'||dtype==='sta'||(col==='c1'&&!this._colMap.grp)||
       (col==='c2'&&!this._colByNum['c2']);
    const isStateCode=STATE_CODES.includes(type)&&!dtype; // columna sin mapear con código claro

    // ── Estado (columna grp/sta o código inconfundible) ─────────
    if(isStateCol||isStateCode){
      if(type==='in')return;
      const prev=k.state;
      k.state=type;
      // Bandera amarilla — marcar vueltas como inválidas
      if(type==='ss')k._lapInvalid=true;
      else if(type==='sr'||type==='su'||type==='sd'||
              type==='gs'||type==='gf'||type==='gl'||type==='gm')k._lapInvalid=false;
      // PIT
      if(type==='si'){k.pit=true; k.pitState='in'; k._pitInTime=Date.now();}
      else if(type==='so'){k.pit=true; k.pitState='out'; k.pitS=0; k._pitTimerActive=false; k._pitInTime=null;}
      else if(type==='sr'||type==='su'){if(!k._pitTimerActive)k.pit=false; k.pitState=null; k._pitInTime=null;}
      // Session finish
      if(type==='sf'){k.checkered=true;}
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

    // ── Nombre/equipo ────────────────────────────────────────────
    if(dtype==='dr'){
      const n=(v||'').trim();
      const skip=['in','tn','ti','tb','ib','sr','sd','su','si','ss',
                  'sf','gf','gl','gm','gs','to','so'];
      if(n&&n.length>1&&isNaN(parseInt(n))&&!skip.includes(n))k.name=n;
      return;
    }

    // ── Sectores ─────────────────────────────────────────────────
    if(dtype==='s1'){const x=parseFloat(v);if(!isNaN(x)&&x>0&&x<120)k.s1=x; return;}
    if(dtype==='s2'){const x=parseFloat(v);if(!isNaN(x)&&x>0&&x<120)k.s2=x; return;}
    if(dtype==='s3'){const x=parseFloat(v);if(!isNaN(x)&&x>0&&x<120)k.s3=x; return;}

    // ── Último tiempo ────────────────────────────────────────────
    if(dtype==='llp'){
      const t=this._pt(v);
      if(t&&t>=20&&t<300){
        if(!k.lapHistory)k.lapHistory=[];
        // Si el flash |*| ya registró esta misma vuelta → refinar el valor, no duplicar
        if(k._lapFromFlash!==undefined&&Math.abs(k._lapFromFlash-t)<=0.05&&k.lapHistory.length){
          k.lapHistory[k.lapHistory.length-1]=t;
          k.lastLap=t;
          k._lapFromFlash=undefined;
        } else {
          k.lastLap=t;
          k.lapHistory.push(t);
          if(k.lapHistory.length>1500)k.lapHistory.shift();
          k._lapFromFlash=undefined;
        }
        // Actualizar bestLap si esta vuelta es mejor
        if(!k.bestLap||t<k.bestLap)k.bestLap=t;
      }
      return;
    }

    // ── Mejor tiempo ─────────────────────────────────────────────
    if(dtype==='blp'){
      const t=this._pt(v);
      if(t&&t>=20&&t<300&&(!k.bestLap||t<k.bestLap))k.bestLap=t;
      return;
    }

    // ── Gap al líder ─────────────────────────────────────────────
    if(dtype==='gap'){
      // Detectar gap de vueltas ("1 Tour", "2 Tours", "3 Tr")
      const vRaw=v||'';
      if(/tour|lap|tr\b/i.test(vRaw)){
        const n=parseInt(vRaw.replace(/[^\d]/g,''));
        if(!isNaN(n)&&n>0)k.gap='+'+n+'v';
        else k.gap='';
        return;
      }
      // Gap de tiempo normal
      const raw=vRaw.replace(/[a-zA-Z]/g,'').trim();
      if(!raw){k.gap='';return;}
      let t;
      if(raw.includes(':')){
        const p=raw.split(':');
        t=parseFloat(p[0])*60+parseFloat(p[1]);
      } else {
        t=parseFloat(raw);
      }
      if(!isNaN(t)&&t>=0)k.gap=t>0?'+'+t.toFixed(3):'';
      return;
    }

    // ── Vueltas ──────────────────────────────────────────────────
    if(dtype==='tlp'){
      const n=parseInt(v);
      if(!isNaN(n)&&n>0)k.tours=n;
      return;
    }

    // ── Pit stops (contador) ─────────────────────────────────────
    if(dtype==='pit'){
      // Puede ser cronómetro de pit o contador de paradas
      if(type==='to'){
        // Cronómetro activo — formato XX. o 1:XX.
        const s=this._parsePitTimer(v);
        if(s!==null){k.pitS=s; k.pit=true; k._pitTimerActive=true;}
      } else if(type==='in'){
        k._pitTimerActive=false;
        if(k.state==='sr'||k.state==='su')k.pit=false;
        const n=parseInt(v);
        if(!isNaN(n)&&n>0)k.standsCount=n;
      }
      return;
    }

    // ── Intervalo al kart precedente ──────────────────────────────
    if(dtype==='int'){
      const raw=(v||'').replace(/[a-zA-Z]/g,'').trim();
      if(!raw){k.interval='';return;}
      let t;
      if(raw.includes(':')){
        const p=raw.split(':');
        t=parseFloat(p[0])*60+parseFloat(p[1]);
      } else {
        t=parseFloat(raw);
      }
      if(!isNaN(t)&&t>=0)k.interval=t>0?'+'+t.toFixed(3):'';
      return;
    }

    // ── Tiempo en pista ──────────────────────────────────────────
    if(dtype==='otr')return; // solo informativo

    // ── Pit timer (puede llegar en columna sin data-type) ─────────
    if(type==='to'){
      const s=this._parsePitTimer((val!==undefined&&val!=='')?val:type);
      if(s!==null){k.pitS=s; k.pit=true; k._pitTimerActive=true;}
      return;
    }
    if(type==='sf'){k.checkered=true; return;}

    // ── Columnas sin data-type — ignorar ─────────────────────────
    if(dtype==='')return;

    // ── Fallback por número de columna (circuitos sin colMap) ────
    this._applyCellFallback(k, col, type, val);
  },

  // Fallback para cuando no hay colMap (init|r| sin nuevo grid)
  _applyCellFallback(k, col, type, val){
    const v=(val!==undefined&&val!=='')?val:type;
    if(type==='sf'){k.checkered=true; return;}
    if(type==='to'){
      const s=this._parsePitTimer(v);
      if(s!==null){k.pitS=s; k.pit=true; k._pitTimerActive=true;}
    }
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

  // ── PARSE GRID ────────────────────────────────────────────────
  _parseGrid(html){
    if(!html||html.length<10)return;
    try{
      const doc=new DOMParser().parseFromString(
        `<table><tbody>${html}</tbody></table>`,'text/html');

      // Leer colMap desde r0
      const r0=doc.querySelector('tr[data-id="r0"]');
      if(r0){
        this._colMap={}; this._colByNum={};
        r0.querySelectorAll('td[data-id]').forEach(td=>{
          const cid=td.getAttribute('data-id'); // ej "c6"
          const dtype=(td.getAttribute('data-type')||'').trim();
          if(cid&&dtype){
            this._colMap[dtype]=cid;
            this._colByNum[cid]=dtype;
          }
        });
      }

      // Parsear filas de karts
      let gridPos=0;
      doc.querySelectorAll('tr[data-id]').forEach(row=>{
        const rowId=row.getAttribute('data-id');
        if(!rowId||rowId==='r0')return;
        gridPos++;
        const k=this._kart(rowId);

        // Estado desde columna grp o sta
        const stCol=this._colMap.grp||this._colMap.sta||'c1';
        const stCell=row.querySelector(`[data-id$="${stCol}"]`);
        if(stCell){const cls=stCell.className.trim();if(cls&&cls!=='in'){
          k.state=cls;
          if(cls==='sf')k.checkered=true;
        }}

        // Posición
        const rkP=row.querySelector('td.rk p');
        if(rkP){const p=parseInt(rkP.textContent.trim());if(!isNaN(p)&&p>0)k.pos=p;}
        else k.pos=k.pos||gridPos;

        // Dorsal desde columna no
        const noCol=this._colMap.no;
        if(noCol){
          const noDiv=row.querySelector(`[data-id$="${noCol}"] div`)||
                      row.querySelector('td.no div');
          if(noDiv){const d=noDiv.textContent.trim();if(d&&!isNaN(parseInt(d)))k.dorsal=d;}
        }

        // Nombre desde columna dr
        const drCol=this._colMap.dr;
        if(drCol){
          const drCell=row.querySelector(`[data-id$="${drCol}"]`);
          if(drCell){const t=drCell.textContent.trim();if(t&&isNaN(parseInt(t)))k.name=t;}
        } else {
          const drCell=row.querySelector('.dr');
          if(drCell){const t=drCell.textContent.trim();if(t&&isNaN(parseInt(t)))k.name=t;}
        }

        // Mejor tiempo desde columna blp
        const blpCol=this._colMap.blp;
        if(blpCol){
          const blpCell=row.querySelector(`[data-id$="${blpCol}"]`);
          if(blpCell){const t=this._pt(blpCell.textContent);if(t&&t>=20&&t<300)k.bestLap=t;}
        }

        // Último tiempo desde columna llp
        const llpCol=this._colMap.llp;
        if(llpCol){
          const llpCell=row.querySelector(`[data-id$="${llpCol}"]`);
          if(llpCell){const t=this._pt(llpCell.textContent);if(t&&t>=20&&t<300)k.lastLap=t;}
        }

        // Vueltas desde columna tlp
        const tlpCol=this._colMap.tlp;
        if(tlpCol){
          const tlpCell=row.querySelector(`[data-id$="${tlpCol}"]`);
          if(tlpCell){const n=parseInt(tlpCell.textContent.trim());if(!isNaN(n)&&n>0)k.tours=n;}
        }

        // Pit stops desde columna pit
        const pitCol=this._colMap.pit;
        if(pitCol){
          const pitCell=row.querySelector(`[data-id$="${pitCol}"]`);
          if(pitCell){const n=parseInt(pitCell.textContent.trim());if(!isNaN(n)&&n>=0)k.standsCount=n;}
        }

        k.tours=k.tours||0;
      });
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
        checkered:!!k.checkered,
        gapMs:k.gapMs||0,
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
