// ── Apex Timing WebSocket Connector v3.0 ─────────────────────────────────
// Wrapper browser sobre ApexProtocol (src/apex-protocol.js).
// Responsabilidades: WebSocket, grid HTML (DOMParser), ApexClock, comentarios.

// URL absoluta a propósito: la usan tanto la web (stintpro.vercel.app) como
// la app Electron (origen file://), que no puede resolver rutas relativas.
const APEX_PROXY_URL = 'https://stintpro.vercel.app/api/apex-proxy';

// CAT_HEADER / stripAccents / RESERVED_DTYPES viven en apex-grid.js.

window.ApexConnector = {
  ws: null, slug: null, port: 7913, connected: false,
  onData: null, onStatus: null, onComment: null, onTitle: null, onMessage: null,
  _reconnectTimer: null,
  _parser: null,
  _comments: [],
  _httpPort: null,
  _historyFetched: false,
  _raceTracker: null,   // ancla de salida oficial (com|) — ver apex-protocol
  _raceStart: null,     // {at, clock, source} cacheado para adjuntar al estado
  _flagTracker: null,   // bandera del panel + estado carrera detenida — ver apex-protocol
  _raceStopped: false,  // ¿carrera detenida por roja con carrera activa?

  // onNewSession: Apex abrió otra sesión en esta conexión (qualy → carrera) → el
  // dashboard reinicia su estado derivado.
  connect(slug, onData, onStatus, onComment, port, onTitle, onMessage, onNewSession) {
    this.slug = slug; this.port = port || 7913;
    this.onData = onData; this.onStatus = onStatus; this.onComment = onComment; this.onTitle = onTitle || null;
    this.onMessage = onMessage || null;
    this.onNewSession = onNewSession || null;
    this._comments = [];
    this._httpPort = null; this._historyFetched = false;
    this._raceTracker = ApexProtocol.createRaceStartTracker();
    this._raceStart = null;
    this._flagTracker = ApexProtocol.createFlagTracker();
    this._raceStopped = false;
    this._comTracker = ApexProtocol.createComBoardTracker();
    // Desarmar el socket anterior ANTES de cerrarlo: su onclose se dispara en
    // async (después de que connect() retorne) con this.slug ya apuntando a la
    // sesión nueva, y programaría una reconexión paralela a los 5s → dos
    // sockets alimentando el mismo parser (vueltas duplicadas vía llp).
    this._disarm(this.ws); this.ws = null;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }

    window.EnTraffic?.reset();
    this._parser = ApexProtocol.createParser({
      onGrid:       (html)     => this._parseGrid(html),
      onCountdown:  (ms, mode) => {
        if (!window.ApexClock) return;
        if (mode === 'stop') ApexClock.stop();
        else ApexClock.sync(ms, mode);
      },
      onNewSession: ()         => {
        if (window.ApexClock?.reset) ApexClock.reset();
        window.EnTraffic?.reset();
        if (this._raceTracker) this._raceTracker.onNewSession();
        this._raceStart = this._raceTracker ? this._raceTracker.raceStart : null;
        if (this._flagTracker) this._flagTracker.reset();
        this._raceStopped = false;
        if (this.onStatus) this.onStatus('connected', '● Nueva sesión');
        window.Blackbox?.event('in', 'status', { conn: 'connected' });
        if (this.onNewSession) this.onNewSession();
      },
      onSessionEnd: ()         => {
        if (window.ApexClock) ApexClock.stop();
        if (this._raceTracker) this._raceTracker.clear();
        this._raceStart = null;
        if (this._flagTracker) this._flagTracker.reset();
        this._raceStopped = false;
      },
      onTitle:      (title)    => { if (this.onTitle) this.onTitle(title); },
      onComment:    (html)     => this._parseComment(html),
      // Mensajes de dirección de carrera (canal msg|). Las mejores vueltas del
      // evento se descartan aquí igual que en el logger: son 684 de 887 y no
      // son señal.
      onMessage:    (info)     => {
        if (!info || info.kind === 'best') return;
        if (this.onMessage) this.onMessage({ ...info, ts: Date.now() });
      },
      // Avisos de la organización en el tablón (canal com|): los que no salen
      // por msg|. El tracker entrega solo los nuevos (y, al conectar, el historial).
      onComBoard:   (html)     => {
        if (!this._comTracker || !this.onMessage) return;
        this._comTracker.ingest(html).forEach(m => this.onMessage({ ...m, ts: Date.now() }));
      },
      onFlag:       (flag, ctx)=> {
        this._flagTracker.ingest(flag, ctx || {});
        this._raceStopped = this._flagTracker.stopped;
        // Re-emitir ya para que el cartel reaccione sin esperar al siguiente tick
        if (this._parser) this._emit(this._parser.getState());
      },
      onChange:     (state)    => this._emit(state),
    });

    this._doConnect();
    this._fetchHttpPort();
  },

  _doConnect() {
    try {
      this.ws = new WebSocket(`wss://live-data.apex-timing.com:${this.port}/`);
      this.ws.onopen = () => {
        this.connected = true;
        if (this.onStatus) this.onStatus('connected', '● Apex conectado');
        window.Blackbox?.event('in', 'status', { conn: 'connected' });
        this.ws.send(this.slug);
      };
      this.ws.onmessage = (e) => {
        try { this._parser.parse(e.data); } catch(err) {
          console.error('[ApexConnector]', err);
          window.Blackbox?.event('in', 'error', { fuente: 'apex', raw: String(e.data).slice(0, 500) });
        }
      };
      this.ws.onerror  = () => {
        if (this.onStatus) this.onStatus('error', '● Error de conexión');
        window.Blackbox?.event('in', 'status', { conn: 'error' });
      };
      this.ws.onclose  = () => {
        this.connected = false;
        if (this.onStatus) this.onStatus('disconnected', '● Reconectando...');
        window.Blackbox?.event('in', 'status', { conn: 'disconnected' });
        if (this.slug) this._reconnectTimer = setTimeout(() => this._doConnect(), 5000);
      };
    } catch(e) { if (this.onStatus) this.onStatus('error', '● No se pudo conectar'); }
  },

  // Quita los handlers y cierra el socket — un ws reemplazado no debe volver a
  // hablar (onmessage tardío contra un parser nulo, onclose que reconecta).
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
    this._parser = null;
  },

  _parseGrid(html) {
    if (!html || html.length < 10) return;
    try {
      // Lectura común con ReplayConnector: src/apex-grid.js
      this._parser.setGrid(ApexGrid.parseGridHtml(html));
      if (!this._historyFetched) this._fetchLapHistories();
    } catch(e) { console.error('[ApexConnector] parseGrid:', e); }
  },

  _parseComment(html) {
    // Ancla de salida oficial: el com| crudo trae el cronograma con data-flag.
    // Se alimenta el tracker ANTES de aplanar el HTML a texto para el feed de
    // comentarios. Una verde nueva → se cachea y se re-emite el estado ya, para
    // que el dashboard reancle el stint 1 sin esperar al siguiente tick.
    if (this._raceTracker) {
      const raceInProgress = !!(window.ApexClock && window.ApexClock._synced);
      const rs = this._raceTracker.ingest(html, { raceInProgress });
      if (rs) { this._raceStart = rs; if (this._parser) this._emit(this._parser.getState()); }
    }
    try {
      const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
      const entries = [];
      doc.querySelectorAll('p').forEach(p => {
        const txt = p.textContent.trim();
        if (txt && txt.length > 2) {
          const m    = txt.match(/^(\d{1,2}:\d{2})/);
          const time = m ? m[1] : new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
          const text = m ? txt.substring(m[0].length).trim() : txt;
          if (text) entries.push({ text, time });
        }
      });
      if (!entries.length) {
        const txt = doc.body.textContent.trim();
        if (txt && txt.length > 2)
          entries.push({ text: txt, time: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) });
      }
      entries.forEach(e => {
        this._comments.unshift(e);
        if (this._comments.length > 100) this._comments.pop();
        if (this.onComment) this.onComment(e, this._comments);
      });
    } catch(e) {}
  },

  async _fetchHttpPort() {
    if (!this.slug) return;
    try {
      // apex-timing.com no manda Access-Control-Allow-Origin → el navegador bloquea
      // la lectura de la respuesta si se pide directamente. Se pasa por nuestro
      // proxy (api/apex-proxy.js), que hace el fetch servidor-a-servidor.
      const res  = await fetch(APEX_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'config', slug: this.slug }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      });
      const { text } = await res.json();
      const m = (text || '').match(/var configPort\s*=\s*(\d+)/);
      if (m) this._httpPort = parseInt(m[1]);
      // Si el grid llegó antes que el puerto, el historial no se pudo pedir
      // entonces: pedirlo ahora (no habrá otro grid en una carrera estable).
      if (!this._historyFetched && this._parser && this._parser.getKartIds().length)
        this._fetchLapHistories();
    } catch(e) {}
  },

  // Puerto de request.php: el configPort de Apex si se pudo leer; si no,
  // puerto del WebSocket − 3 (config.js da 404 en varios circuitos).
  _requestPort() {
    return this._httpPort || (parseInt(this.port, 10) - 3) || null;
  },

  // Historial de vueltas de toda la parrilla al conectar en directo.
  // 1º directo a Apex desde el navegador (request.php manda CORS *): TODAS las
  // vueltas de cada kart, varios karts por petición. Si falla, el proxy de
  // siempre (limitado a las últimas 100 vueltas por kart).
  async _fetchLapHistories() {
    const port = this._requestPort();
    if (this._historyFetched || !port || !this._parser) return;
    const kartIds = this._parser.getKartIds();
    if (!kartIds.length) return;
    this._historyFetched = true;
    if (this.onStatus) this.onStatus('connected', '● Cargando historial...');

    const merge = (rowId, laps) => {
      if (laps && laps.length && this._parser) this._parser.mergeHttpHistory(rowId, laps, laps.length);
    };

    const fetchDirect = async (batch) => {
      const A = window.EnApexTeam;
      if (!A) throw new Error('sin EnApexTeam');
      const ids = batch.map(k => k.rowId.replace('r', ''));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(A.REQUEST_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'port=' + port + '&request=' + encodeURIComponent(A.lapsRequest(ids)),
          signal: controller.signal,
        });
        const text = (await res.text()).trim();
        if (!res.ok || text === 'error') throw new Error('Apex ' + res.status);
        const by = A.parseLapsById(text);
        batch.forEach(k => merge(k.rowId, by[k.rowId.replace('r', '')]));
      } finally { clearTimeout(timer); }
    };

    const fetchViaProxy = async ({ rowId }) => {
      const id = rowId.replace('r', '');
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const req = `D%23-100%23D${id}.L%23-999%23D${id}.P%232%23D${id}.B%231%23D${id}.INF`;
        const res = await fetch(APEX_PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'history', port, request: req }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        const { text: rawText } = await res.json();
        const text = (rawText || '').trim();
        if (!text || text === 'error') return;
        const laps = [];
        text.split('\n').forEach(line => {
          const m = line.match(new RegExp(`^D${id}\\.L(\\d+)#[^|]*\\|[^|]*\\|[^|]*\\|([\\da-zA-Z]+)`));
          if (!m) return;
          const ms = parseInt(m[2].replace(/[a-zA-Z]/g, ''));
          if (isNaN(ms) || ms < 20000 || ms >= 300000) return;
          laps.push({ n: parseInt(m[1]), t: parseFloat((ms / 1000).toFixed(3)) });
        });
        laps.sort((a, b) => a.n - b.n);
        merge(rowId, laps.map(l => l.t));
      } catch(e) {}
    };

    // Lotes de 8 karts por petición directa; el lote que falle cae al proxy.
    const BATCH = 8;
    const batches = [];
    for (let i = 0; i < kartIds.length; i += BATCH) batches.push(kartIds.slice(i, i + BATCH));
    await Promise.allSettled(batches.map(async batch => {
      try { await fetchDirect(batch); }
      catch(e) { await Promise.allSettled(batch.map(fetchViaProxy)); }
    }));

    if (this.onStatus) this.onStatus('connected', '● Apex conectado');
    if (this._parser) this._emit(this._parser.getState());
  },

  _emit(state) {
    if (this._raceStart) state.raceStart = this._raceStart;
    state.raceStopped = this._raceStopped;   // state.flag ya viene de getState()
    window.Blackbox?.event('in', 'live', { karts: state?.equipos?.length });
    if (this.onData) this.onData(state);
  },
};
