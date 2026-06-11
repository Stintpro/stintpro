window.ApexClock = {
  _sessionMs:null, _refTime:null, _raceDurMs:null,
  _synced:false, _timer:null, _callbacks:[],
  _mode:'countdown', // 'countdown' | 'count'

  init(raceDurMs) {
    this._raceDurMs=raceDurMs||null;
    this._sessionMs=null; this._refTime=null;
    this._synced=false; this._mode='countdown';
    this._startTimer();
  },

  sync(ms, mode) {
    this._sessionMs=ms; this._refTime=Date.now();
    this._synced=true;
    if(mode) this._mode=mode;
    this._emit();
  },

  remainingMs() {
    if(!this._synced||this._sessionMs===null) return null;
    if(this._mode==='count') {
      // Reloj ascendente — devolvemos el tiempo transcurrido
      return this._sessionMs+(Date.now()-this._refTime);
    }
    return Math.max(0, this._sessionMs-(Date.now()-this._refTime));
  },

  isCountUp() { return this._mode==='count'; },

  // Desincroniza sin parar el timer ni borrar callbacks — para cambio de sesión/circuito
  reset() {
    this._synced=false; this._sessionMs=null; this._refTime=null; this._mode='countdown';
  },

  elapsedMs() {
    if(!this._raceDurMs||!this._synced) return null;
    const r=this.remainingMs();
    return r!==null?Math.max(0,this._raceDurMs-r):null;
  },

  elapsedS() { const ms=this.elapsedMs(); return ms!==null?Math.floor(ms/1000):0; },

  onTick(fn)       { this._callbacks.push(fn); },
  clearCallbacks() { this._callbacks=[]; },

  stop() {
    if(this._timer){clearInterval(this._timer);this._timer=null;}
    this.clearCallbacks();
    this._synced=false; this._sessionMs=null; this._refTime=null;
  },

  _startTimer() {
    if(this._timer)clearInterval(this._timer);
    this._timer=setInterval(()=>this._emit(),100);
  },

  _emit() {
    const rem=this.remainingMs(), ela=this.elapsedMs();
    this._callbacks.forEach(fn=>{try{fn({remainingMs:rem,elapsedMs:ela});}catch(e){}});
  },

  fmtMs(ms) {
    if(ms===null||ms===undefined||ms<0) return '—';
    const s=Math.floor(ms/1000), h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sc=s%60;
    if(h>0) return `${h}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`;
    return `${m}:${String(sc).padStart(2,'0')}`;
  },

  fmtLapS(s) {
    if(!s||s<=0) return '—';
    if(s>=60){const m=Math.floor(s/60),sc=(s%60).toFixed(3);return `${m}:${sc.padStart(6,'0')}`;}
    return `${s.toFixed(3)}s`;
  }
};
