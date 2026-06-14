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
    this._apiKey = window.AppState?.loggerApiKey || localStorage.getItem('stintpro_logger_apikey') || '';
    this._doConnect();
  },

  _doConnect() {
    try {
      const wsUrl = this._serverUrl.replace('http://', 'ws://').replace('https://', 'wss://');
      if (this.onStatus) this.onStatus('connecting', '● Conectando al logger...');
      const wsUrlWithKey = this._apiKey ? `${wsUrl}?apikey=${this._apiKey}` : wsUrl;
      this.ws = new WebSocket(wsUrlWithKey);

      this.ws.onopen = () => {
        this.connected = true;
        if (this.onStatus) this.onStatus('connected', '● Logger conectado');
        // Suscribirse al circuito
        this.ws.send(JSON.stringify({ type: 'subscribe', slug: this.slug }));
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

  // Verificar conexión al logger
  async test(url, apiKey) {
    return new Promise((resolve) => {
      try {
        const wsBase = url.replace('http://', 'ws://').replace('https://', 'wss://');
        const wsUrl = apiKey ? `${wsBase}?apikey=${apiKey}` : wsBase;
        const ws = new WebSocket(wsUrl);
        const timer = setTimeout(() => { ws.close(); resolve(false); }, 5000);
        ws.onopen = () => {
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
