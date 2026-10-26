// ── en-pilot-link.js — mensajes al piloto en pista (conexión + UI) ──────────
// Conexión propia al WS del VPS, independiente del modo de datos (Logger,
// directo a Apex o replay): los mensajes funcionan aunque los datos vengan de
// Apex. Publica la lista de pilotos y cuál va en pista (EnSession.currentPilot,
// que Apex actualiza solo en el relevo) y manda los team_msg dirigidos.
// Núcleo puro en en-pilot-link-core.js.

window.EnPilotLink = {
  ws: null, authed: false, presence: [], lastStatus: null,
  _started: false, _timer: null, _sig: '', _pending: new Map(), _listeners: new Set(),

  start() {
    if (this._started) return;
    this._started = true;
    this._connect();
    // La lista cambia desde muchos sitios (setup, relevo por Apex, selección
    // manual): se compara cada 2 s en vez de enganchar cada punto de cambio.
    setInterval(() => this._syncRoster(), 2000);
  },

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); },
  _emit() { this._listeners.forEach(fn => { try { fn(); } catch (e) { console.error('[StintPro] pilot-link', e); } }); },

  // EnSession es un `const` global (en-state.js): accesible por nombre, no como window.EnSession.
  roster() { return EnPilotLinkCore.buildRoster(window.AppState?.config, typeof EnSession !== 'undefined' ? EnSession : null); },

  _url() {
    const u = window.AppState?.loggerUrl || localStorage.getItem('stintpro_logger_url') || '';
    return u ? u.replace(/\/$/, '').replace('http://', 'ws://').replace('https://', 'wss://') : '';
  },

  _retry() { clearTimeout(this._timer); this._timer = setTimeout(() => this._connect(), 5000); },

  _connect() {
    const url = this._url();
    if (!url) return this._retry();
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return this._retry(); }
    this.ws = ws;
    ws.onopen = async () => {
      let token = '';
      try { token = window.SPAuth ? await window.SPAuth.idToken() : ''; } catch (e) {}
      const apikey = window.AppState?.loggerApiKey || localStorage.getItem('stintpro_logger_apikey') || '';
      if (token) ws.send(JSON.stringify({ type: 'auth', token }));
      else if (apikey) ws.send(JSON.stringify({ type: 'auth', apikey }));
    };
    ws.onmessage = (evt) => {
      let m; try { m = JSON.parse(evt.data); } catch (e) { return; }
      this._onMsg(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null; this.authed = false; this.presence = []; this._sig = '';
      for (const p of this._pending.values()) { clearTimeout(p.t); p.reject(new Error('sin conexión')); }
      this._pending.clear();
      this._emit();
      this._retry();
    };
  },

  _onMsg(m) {
    if (m.type === 'auth_ok') {
      this.authed = true; this._sig = '';
      this._syncRoster(); this._emit();
    } else if (m.type === 'pilot_presence') {
      this.presence = Array.isArray(m.connected) ? m.connected : [];
      this._emit();
    } else if (m.type === 'team_msg_sent' && m.id && this._pending.has(m.id)) {
      const p = this._pending.get(m.id);
      this._pending.delete(m.id); clearTimeout(p.t); p.resolve(m);
    }
  },

  _syncRoster() {
    if (!this.authed || !this.ws) return;
    const r = this.roster();
    const sig = EnPilotLinkCore.rosterSignature(r);
    if (!r || sig === this._sig) return;
    this._sig = sig;
    this.ws.send(JSON.stringify(r));
    this._emit();
  },

  send(text, tone) {
    return new Promise((resolve, reject) => {
      if (!this.authed || !this.ws) return reject(new Error('Sin conexión con el servidor'));
      this._syncRoster(); // que el VPS tenga el piloto en pista actual antes del mensaje
      const id = 'm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      const msg = EnPilotLinkCore.buildTeamMsg(this.roster(), text, tone, id);
      if (msg.error) return reject(new Error(msg.error));
      const t = setTimeout(() => { this._pending.delete(id); reject(new Error('Sin respuesta del servidor')); }, 5000);
      this._pending.set(id, { resolve, reject, t });
      this.ws.send(JSON.stringify(msg));
    });
  },
};

// ── UI: botón 📻 RADIO en Mi equipo (tarjeta «Piloto en pista») + modal ─────

function _enRadioBtnHtml(){
  EnPilotLink.start();
  const ok=EnPilotLink.authed;
  const title=ok?'Mensaje al piloto en pista':'Radio: sin conexión con el servidor';
  return `<button class="en-change-btn en-radio-btn" title="${title}" ${ok?'':'disabled'} onclick="event.stopPropagation();_enShowPilotMsg()">📻 RADIO</button>`;
}

function _enShowPilotMsg(){
  let overlay=document.getElementById('en-pilot-overlay');
  if(overlay)overlay.remove();
  overlay=document.createElement('div');
  overlay.id='en-pilot-overlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:999;';
  overlay.onclick=(e)=>{ if(e.target===overlay)_enDismissOverlay(); };
  const box=document.createElement('div');
  box.className='sp-modal en-pmsg';
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const render=()=>{
    if(!document.body.contains(box)){ off(); return; }
    _enRenderPilotMsg(box);
  };
  const off=EnPilotLink.onChange(render);
  render();
}

function _enRenderPilotMsg(box){
  const C=EnPilotLinkCore;
  const r=EnPilotLink.roster();
  const name=C.currentPilotName(r);
  const conectado=r&&r.current!==null&&EnPilotLink.presence.includes(r.current);
  const enabled=EnPilotLink.authed&&!!name;
  let head;
  if(!EnPilotLink.authed) head='<span class="en-pmsg-warn">Sin conexión con el servidor</span>';
  else if(!r) head='<span class="en-pmsg-warn">Configura tu dorsal y tus pilotos</span>';
  else if(!name) head='<span class="en-pmsg-warn">Marca quién va en pista</span>';
  else head=`Para: <b>${_esc(name)}</b> (en pista) · <span class="${conectado?'en-pmsg-on':'en-pmsg-off'}">📱 ${conectado?'conectado':'sin móvil'}</span>`;
  const st=EnPilotLink.lastStatus;
  // Conservar lo escrito en el campo libre entre re-renders (presencia, acuses).
  const prev=box.querySelector('#en-pmsg-free')?.value||'';
  box.innerHTML=`
    <div class="en-pmsg-title">📻 Radio al piloto</div>
    <div class="en-pmsg-head">${head}</div>
    <div class="en-pmsg-grid">
      ${C.QUICK_MESSAGES.map((m,i)=>`<button class="en-pmsg-q ${m.tone}" ${enabled?'':'disabled'} onclick="_enSendQuick(${i})">${_esc(m.text)}</button>`).join('')}
    </div>
    <div class="en-pmsg-free">
      <input id="en-pmsg-free" maxlength="${C.MAX_TEXT}" placeholder="Texto libre (máx. ${C.MAX_TEXT})" ${enabled?'':'disabled'}
             onkeydown="if(event.key==='Enter')_enSendFree()">
      <button class="en-pmsg-send" ${enabled?'':'disabled'} onclick="_enSendFree()">Enviar</button>
    </div>
    <div class="en-pmsg-status ${st?(st.ok?'ok':'ko'):''}">${st?_esc(st.text):''}</div>
    <button class="en-pmsg-close" onclick="_enDismissOverlay()">Cerrar</button>`;
  const inp=box.querySelector('#en-pmsg-free');
  if(inp)inp.value=prev;
}

async function _enSendPilotMsg(text,tone){
  const name=EnPilotLinkCore.currentPilotName(EnPilotLink.roster())||'el piloto';
  EnPilotLink.lastStatus={ok:true,text:'Enviando…'};
  EnPilotLink._emit();
  try{
    const ack=await EnPilotLink.send(text,tone);
    EnPilotLink.lastStatus=EnPilotLinkCore.deliveryLabel(ack,name);
    return true;
  }catch(e){
    EnPilotLink.lastStatus={ok:false,text:'No enviado: '+e.message};
    return false;
  }finally{
    EnPilotLink._emit();
  }
}

function _enSendQuick(i){
  const m=EnPilotLinkCore.QUICK_MESSAGES[i];
  if(m)_enSendPilotMsg(m.text,m.tone);
}

async function _enSendFree(){
  const inp=document.getElementById('en-pmsg-free');
  if(!inp||!inp.value.trim())return;
  const text=inp.value;
  inp.value='';
  if(!(await _enSendPilotMsg(text,'orange'))){
    const again=document.getElementById('en-pmsg-free');
    if(again&&!again.value)again.value=text;
  }
}
