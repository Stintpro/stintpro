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

  connect(slug, onData, onStatus, onComment, port) {
    this.slug = slug;
    this.onData = onData;
    this.onStatus = onStatus;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch(e) {} this.ws = null; }

    // URL del logger — guardada en AppState o localStorage
    const loggerUrl = window.AppState?.loggerUrl || localStorage.getItem('stintpro_logger_url') || '';
    if (!loggerUrl) {
      if (this.onStatus) this.onStatus('error', '● Logger no configurado');
      return;
    }
    this._serverUrl = loggerUrl.replace(/\/$/, '');
    this._apiKey = window.AppState?.loggerApiKey || localStorage.getItem('stintpro_logger_apikey') || 'dbbbf9772c9f69fdfc6f56cf7b41085aa2091b95f9ae28a63069c90ae7a0c34f';
    this._doConnect();
  },

  _doConnect() {
    try {
      const wsUrl = this._serverUrl.replace('http://', 'ws://').replace('https://', 'wss://');
      if (this.onStatus) this.onStatus('connecting', '● Conectando al logger...');
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        // Auth como primer mensaje (sin key en URL)
        if (this._apiKey) {
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

          if (msg.type === 'live' && msg.data && this.onData) {
            this.onData(msg.data);
          }

          if (msg.type === 'history' && msg.snapshot && this.onData) {
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

  disconnect() {
    this.slug = null;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch(e) {} this.ws = null; }
    this.connected = false;
  },

  // Consulta histórico de pilotos al logger (para ℹ en el grid)
  async fetchPilotHistory(slug, names) {
    if (!this._serverUrl || !names.length) return {};
    try {
      const encoded = names.map(n => encodeURIComponent(n)).join(',');
      const url = `${this._serverUrl}/api/circuit/${slug}/pilots/batch?names=${encoded}`;
      const headers = this._apiKey ? { 'X-API-Key': this._apiKey } : {};
      const res = await fetch(url, { headers });
      if (!res.ok) return {};
      return await res.json();
    } catch(e) { return {}; }
  },

  // Consulta histórico de equipos al logger (para T en el grid)
  async fetchTeamHistory(slug) {
    if (!this._serverUrl || !slug) return {};
    try {
      const url = `${this._serverUrl}/api/circuit/${slug}/teams`;
      const headers = this._apiKey ? { 'X-API-Key': this._apiKey } : {};
      const res = await fetch(url, { headers });
      if (!res.ok) return {};
      const list = await res.json();
      // Convertir array a mapa por nombre de equipo
      const map = {};
      for (const t of list) map[t.name] = t;
      return map;
    } catch(e) { return {}; }
  },

  // Verificar conexión al logger
  async test(url, apiKey) {
    return new Promise((resolve) => {
      try {
        const wsBase = url.replace('http://', 'ws://').replace('https://', 'wss://');
        const ws = new WebSocket(wsBase);
        const timer = setTimeout(() => { ws.close(); resolve(false); }, 5000);
        ws.onopen = () => {
          if (apiKey) ws.send(JSON.stringify({ type: 'auth', apikey: apiKey }));
          ws.send(JSON.stringify({ type: 'list' }));
        };
        ws.onmessage = (evt) => {
          clearTimeout(timer);
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === 'circuits') {
              ws.close();
              resolve(msg.circuits);
            } else {
              ws.close();
              resolve(true);
            }
          } catch(e) { ws.close(); resolve(true); }
        };
        ws.onerror = () => { clearTimeout(timer); try { ws.close(); } catch(e) {} resolve(false); };
      } catch(e) { resolve(false); }
    });
  }
};
