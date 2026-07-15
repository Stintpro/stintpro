// ── StintPro Logger Connector ─────────────────────────────────────────────
// Connects to the NAS logger instead of Apex directly.
// Same interface as Apex connector: connect(slug, onData, onStatus, onComment, port)
const Logger = {
  ws: null,
  slug: null,
  connected: false,
  onData: null,
  onStatus: null,
  _reconnectTimer: null,
  _serverUrl: null,
  _raceStart: null,   // ancla de salida oficial reenviada por el logger (type:'raceStart')
  _flag: null,        // última bandera del panel reenviada por el logger
  _raceStopped: false,// ¿carrera detenida por roja con carrera activa?

  connect(slug, onData, onStatus, onComment, port) {
    this.slug = slug;
    this.onData = onData;
    this.onStatus = onStatus;
    this._raceStart = null;
    this._flag = null;
    this._raceStopped = false;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    // Desarmar el socket anterior ANTES de cerrarlo: su onclose (async) vería
    // this.slug ya fijado y programaría una reconexión paralela a los 5s →
    // dos sockets vivos recibiendo live/history a la vez.
    this._disarm(this.ws); this.ws = null;

    // URL del logger — guardada en AppState o localStorage
    const loggerUrl = window.AppState?.loggerUrl || localStorage.getItem('stintpro_logger_url') || '';
    if (!loggerUrl) {
      if (this.onStatus) this.onStatus('error', '● Logger no configurado');
      return;
    }
    this._serverUrl = loggerUrl.replace(/\/$/, '');
    // Auth: se prefiere el JWT de Supabase (por usuario). La API key solo si el
    // admin la configura explícitamente; ya NO se incrusta ninguna key por defecto.
    this._apiKey = window.AppState?.loggerApiKey || localStorage.getItem('stintpro_logger_apikey') || '';
    this._doConnect();
  },

  _doConnect() {
    try {
      const wsUrl = this._serverUrl.replace('http://', 'ws://').replace('https://', 'wss://');
      if (this.onStatus) this.onStatus('connecting', '● Conectando al logger...');
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = async () => {
        // Auth como primer mensaje: JWT de Supabase preferente; API key de reserva.
        const token = await this._getToken();
        if (token) {
          this.ws.send(JSON.stringify({ type: 'auth', token }));
        } else if (this._apiKey) {
          this.ws.send(JSON.stringify({ type: 'auth', apikey: this._apiKey }));
        }
        // Suscribirse al circuito
        this.ws.send(JSON.stringify({ type: 'subscribe', slug: this.slug }));
        this.connected = true;
        if (this.onStatus) this.onStatus('connected', '● Logger conectado');
      };

      this.ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);

          // Ancla de salida oficial (com|) reenviada por el logger. Se cachea y
          // se adjunta a los payloads live/history para que el dashboard la vea
          // igual que en modo directo (data.raceStart).
          if (msg.type === 'raceStart') {
            this._raceStart = { at: msg.at, clock: msg.clock, source: msg.source };
          }

          // Bandera del panel (roja/verde/amarilla). Se emite un payload ligero
          // _flagOnly para que el cartel reaccione al instante sin pisar equipos.
          if (msg.type === 'flag') {
            this._flag = msg.flag;
            this._raceStopped = !!msg.raceStopped;
            if (this.onData) this.onData({ _flagOnly: true, flag: this._flag, raceStopped: this._raceStopped });
          }

          if (msg.type === 'live' && msg.data && this.onData) {
            if (this._raceStart && !msg.data.raceStart) msg.data.raceStart = this._raceStart;
            if (msg.data.raceStopped === undefined) msg.data.raceStopped = this._raceStopped;
            this.onData(msg.data);
          }

          // Reloj de sesión (countdown) reenviado por el logger — sincroniza ApexClock
          // igual que el conector directo a Apex, para que el cronómetro funcione vía logger.
          if (msg.type === 'clock' && window.ApexClock) {
            if (msg.mode === 'stop' || msg.ms == null) ApexClock.stop();
            else ApexClock.sync(msg.ms, msg.mode);
          }

          if (msg.type === 'history' && msg.snapshot && this.onData) {
            // Reloj reconstruido en el snapshot (ajustado por el logger) al conectar a mitad
            if (msg.snapshot.clock && window.ApexClock) {
              ApexClock.sync(msg.snapshot.clock.ms, msg.snapshot.clock.mode);
            }
            // El snapshot ya trae raceStart si el logger lo tenía; cachearlo para
            // los ticks live siguientes (que no lo reenvían).
            if (msg.snapshot.raceStart) this._raceStart = msg.snapshot.raceStart;
            else if (this._raceStart) msg.snapshot.raceStart = this._raceStart;
            // Igual con el estado de carrera detenida (bandera roja).
            if (msg.snapshot.raceStopped !== undefined) this._raceStopped = !!msg.snapshot.raceStopped;
            this._flag = msg.snapshot.flag || null;
            // Marcar como snapshot histórico para que el cliente reconstruya estado derivado
            this.onData({ ...msg.snapshot, _isHistory: true });
          }

          if (msg.type === 'error') {
            const reason = msg.msg || msg.message || 'Error del servidor';
            if (this.onStatus) this.onStatus('error', `● Logger: ${reason}`);
            if (msg.fatal) { this.slug = null; this.ws && this.ws.close(); }
          }
        } catch(e) {}
      };

      this.ws.onerror = () => {
        this.connected = false;
        if (this.onStatus) this.onStatus('error', '● Error de conexión al logger');
      };

      this.ws.onclose = () => {
        this.connected = false;
        if (this.onStatus) this.onStatus('disconnected', '● Logger desconectado, reconectando...');
        if (this.slug) this._reconnectTimer = setTimeout(() => this._doConnect(), 5000);
      };
    } catch(e) {
      if (this.onStatus) this.onStatus('error', '● No se pudo conectar al logger');
      this._reconnectTimer = setTimeout(() => this._doConnect(), 5000);
    }
  },

  // Quita los handlers y cierra el socket — un ws reemplazado no debe volver a
  // hablar (mensajes tardíos, onclose que reconecta).
  _disarm(ws) {
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try { ws.close(); } catch(e) {}
  },

  disconnect() {
    this.slug = null;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this._disarm(this.ws); this.ws = null;
    this.connected = false;
  },

  // Token de sesión de Supabase (para autenticar lecturas y WS por usuario).
  // getSession() no refresca si el timer de fondo no ha corrido (p.ej. pestaña
  // suspendida en Safari/iPad al cambiar de app) → puede devolver un access_token
  // ya caducado. Se fuerza un refresco activo cuando falta <60s o ya caducó.
  async _getToken() {
    try {
      const client = window.supabaseClient;
      let session = (await client?.auth?.getSession())?.data?.session;
      const nearExpiry = session?.expires_at && (session.expires_at * 1000 - Date.now() < 60000);
      if (session && nearExpiry) {
        session = (await client.auth.refreshSession())?.data?.session || session;
      }
      return session?.access_token || '';
    } catch(e) { return ''; }
  },

  // Cabeceras de auth para las lecturas: JWT de Supabase preferente; API key de
  // reserva solo si el admin la configuró (AppState/localStorage). Autónomo:
  // usable desde cualquier módulo (p.ej. en-state.js) sin depender del estado.
  async _authHeaders() {
    const token = await this._getToken();
    if (token) return { 'Authorization': 'Bearer ' + token };
    const key = this._apiKey || window.AppState?.loggerApiKey || localStorage.getItem('stintpro_logger_apikey') || '';
    if (key) return { 'X-API-Key': key };
    return {};
  },

  // Consulta histórico de pilotos al logger (para ℹ en el grid)
  async fetchPilotHistory(slug, names) {
    if (!this._serverUrl || !names.length) return {};
    try {
      const encoded = names.map(n => encodeURIComponent(n)).join(',');
      const url = `${this._serverUrl}/api/circuit/${slug}/pilots/batch?names=${encoded}`;
      const headers = await this._authHeaders();
      const res = await fetch(url, { headers });
      if (!res.ok) return {};
      return await res.json();
    } catch(e) { return {}; }
  },

  // Verificar conexión al logger
  async test(url, apiKey) {
    return new Promise((resolve) => {
      try {
        const wsBase = url.replace('http://', 'ws://').replace('https://', 'wss://');
        const ws = new WebSocket(wsBase);
        const timer = setTimeout(() => { ws.close(); resolve(false); }, 5000);
        ws.onopen = async () => {
          const token = await Logger._getToken();
          if (token) ws.send(JSON.stringify({ type: 'auth', token }));
          else if (apiKey) ws.send(JSON.stringify({ type: 'auth', apikey: apiKey }));
          ws.send(JSON.stringify({ type: 'list' }));
        };
        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === 'error') {
              clearTimeout(timer);
              ws.close();
              resolve(false);
              return;
            }
            if (msg.type === 'circuits') {
              clearTimeout(timer);
              ws.close();
              resolve(msg.circuits);
              return;
            }
            // auth_ok u otro mensaje intermedio: seguir esperando la respuesta real a 'list'
          } catch(e) { clearTimeout(timer); ws.close(); resolve(true); }
        };
        ws.onerror = () => { clearTimeout(timer); try { ws.close(); } catch(e) {} resolve(false); };
      } catch(e) { resolve(false); }
    });
  }
};
